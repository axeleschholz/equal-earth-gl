import {EXTENT} from '../../data/extent.ts';
import {latFromMercatorY} from '../mercator_coordinate.ts';
import {EQUAL_EARTH_HALF_HEIGHT, EQUAL_EARTH_HALF_WIDTH, equalEarthJacobian, equalEarthParallel} from './equal_earth_math.ts';

import type {TileWarp} from './tile_warp.ts';

type TileCoordinates = {x: number; y: number; z: number; wrap?: number};

const WORLD_METERS = 2 * EQUAL_EARTH_HALF_WIDTH;

/**
 * @internal
 * How many zoom levels above its own a tile can be drawn with its expansion staying within 0.05 px of the warp:
 * the tiles near the poles are drawn a few levels above their own, and a source's last zoom level is drawn above
 * its own all the way in. Past this the error grows with the tile's size on screen, as single precision does.
 */
export const EXPANSION_OVERZOOM = 4;

/** How far past the tile's edges, as a fraction of the tile, an expansion is fitted, which takes in its buffer. */
const EXPANSION_BUFFER = 0.125;

/** The highest power of `v` an expansion has room for. */
const MAX_DEGREE = 8;

/** Where the parts of an expansion start in its twenty coefficients, see {@link evaluateExpansion}. */
const KAPPA = MAX_DEGREE + 1;
const C_BEFORE_FIRST = KAPPA;
const POLE_A = 2 * MAX_DEGREE + 2;
const POLE_C = POLE_A + 1;

/**
 * The degree of the polynomials an expansion is fitted with at a tile zoom. A tile spans less of the world with
 * every zoom level, so fewer terms describe it, and fitting more than that only fits rounding noise.
 */
function expansionDegree(z: number): number {
    if (z < 6) return MAX_DEGREE;
    if (z < 12) return 5;
    return 3;
}

/** The Chebyshev nodes on -1..1 for each number of nodes, which do not depend on the tile. */
const chebyshevNodes = new Map<number, Float64Array>();

function getChebyshevNodes(count: number): Float64Array {
    let nodes = chebyshevNodes.get(count);
    if (!nodes) {
        nodes = new Float64Array(count);
        for (let i = 0; i < count; i++) nodes[i] = Math.cos(Math.PI * (2 * i + 1) / (2 * count));
        chebyshevNodes.set(count, nodes);
    }
    return nodes;
}

/**
 * The coefficients, lowest power first, of the polynomial through `values` at `nodes`, by Gaussian elimination
 * with partial pivoting on the Vandermonde matrix. At Chebyshev nodes on -1..1 and the degrees used here the
 * matrix is well enough conditioned for double precision.
 */
function interpolate(nodes: Float64Array, values: Float64Array): Float64Array {
    const n = nodes.length;
    const matrix: number[][] = [];
    for (let i = 0; i < n; i++) {
        const row = new Array<number>(n + 1);
        let power = 1;
        for (let k = 0; k < n; k++) {
            row[k] = power;
            power *= nodes[i];
        }
        row[n] = values[i];
        matrix.push(row);
    }
    for (let column = 0; column < n; column++) {
        let pivot = column;
        for (let row = column + 1; row < n; row++) {
            if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
        }
        [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
        for (let row = column + 1; row < n; row++) {
            const factor = matrix[row][column] / matrix[column][column];
            for (let k = column; k <= n; k++) matrix[row][k] -= factor * matrix[column][k];
        }
    }
    const coefficients = new Float64Array(n);
    for (let row = n - 1; row >= 0; row--) {
        let sum = matrix[row][n];
        for (let k = row + 1; k < n; k++) sum -= matrix[row][k] * coefficients[k];
        coefficients[row] = sum / matrix[row][row];
    }
    return coefficients;
}

/**
 * @internal
 * Evaluates an expansion of {@link equalEarthTileWarp}: the offset on the world plane, from the warp of the tile's
 * center, of the position `u`, `v` in the tile, each -0.5..0.5 across it. The shader does the same arithmetic.
 *
 * On the Equal Earth plane a position's x is its longitude times a factor of its latitude alone, and its y depends
 * on its latitude alone. In a mercator tile, longitude is linear in `u` and latitude depends on `v` alone. So the
 * warp of a tile is two functions of `v`: with `A(v)` the x per unit of `u`, and `kappa` the tile center's
 * longitude in units of the tile's width, `x - x(center) = u * A(v) + kappa * (A(v) - A(0))`, and
 * `y - y(center) = C(v)` with `C(0) = 0`. The longitude is counted from the central meridian, and in a copy of a tile
 * that the edge of the world runs through, on the side of the world that the copy lies on.
 *
 * The coefficients are `A`'s nine, lowest power first, then `kappa`, then `C`'s eight from the first power, then
 * the values `A` and `C` take on the pole the tile's row touches, which is beyond any `v`, or zeros in the rows
 * between.
 *
 * @param out - the array the result is written to
 * @param pole - 1 or -1 for a vertex on the north or south pole, which uses the pole's values instead of `v`
 */
export function evaluateExpansion(coefficients: Float64Array, u: number, v: number, out: [number, number], pole: -1 | 0 | 1 = 0): [number, number] {
    let aDifference: number;
    if (pole) {
        aDifference = coefficients[POLE_A] - coefficients[0];
        out[1] = coefficients[POLE_C];
    } else {
        let aSlope = 0;
        let cSlope = 0;
        for (let k = MAX_DEGREE; k >= 1; k--) {
            aSlope = aSlope * v + coefficients[k];
            cSlope = cSlope * v + coefficients[C_BEFORE_FIRST + k];
        }
        aDifference = aSlope * v;
        out[1] = cSlope * v;
    }
    out[0] = u * (coefficients[0] + aDifference) + coefficients[KAPPA] * aDifference;
    return out;
}

/**
 * The latitude, in degrees, of a mercator y. Above the mercator square it keeps rising toward the pole, which it
 * never passes.
 */
function latitudeOfMercatorY(y: number): number {
    return Math.max(-90, Math.min(90, latFromMercatorY(y)));
}

class EqualEarthTileWarp implements TileWarp {
    /**
     * Measured over each zoom's tiles, drawn sixteen times their size: the worst expansion is well over 0.05 px
     * off at zoom 2 and well under it from zoom 3 to zoom 22. The tiles of zooms 0 to 2 span too much latitude
     * for nine terms.
     */
    readonly expansionMinZoom: number = 3;
    readonly copies: readonly number[];
    /**
     * The mercator x of the world's east edge, the meridian opposite the central one, in 0..1 and 1 when the edge
     * is the antimeridian. The world shows mercator x from one less than this up to it.
     */
    private readonly _edge: number;
    private readonly _parallel: [number, number] = [0, 0];

    constructor(centralMeridian: number) {
        const edge = ((centralMeridian / 360) % 1 + 1) % 1;
        this._edge = edge === 0 ? 1 : edge;
        this.copies = this._edge === 1 ? [0] : [0, -1];
    }

    /** Where the west edge of a tile copy lies across the world: 0 on the world's west edge, 1 on its east edge. */
    private _origin(tile: TileCoordinates): number {
        return tile.x / Math.pow(2, tile.z) + (tile.wrap ?? 0) + 1 - this._edge;
    }

    warp(tile: TileCoordinates, tx: number, ty: number, out: [number, number]): [number, number] {
        const tiles = Math.pow(2, tile.z);
        const across = this._origin(tile) + tx / EXTENT / tiles;
        const lat = latitudeOfMercatorY((tile.y + ty / EXTENT) / tiles);
        const [xPerDegree, y] = equalEarthParallel(lat, this._parallel);
        out[0] = 0.5 + (across * 360 - 180) * xPerDegree / WORLD_METERS;
        out[1] = 0.5 - y / WORLD_METERS;
        return out;
    }

    window(tile: TileCoordinates): [number, number] {
        const unitsAcross = Math.pow(2, tile.z) * EXTENT;
        const origin = this._origin(tile);
        return [-origin * unitsAcross, (1 - origin) * unitsAcross];
    }

    bounds(tile: TileCoordinates): [number, number, number, number] | null {
        const tiles = Math.pow(2, tile.z);
        const origin = this._origin(tile);
        const west = Math.max(-180, origin * 360 - 180);
        const east = Math.min(180, (origin + 1 / tiles) * 360 - 180);
        if (west >= east) return null;
        const north = tile.y === 0 ? 90 : latitudeOfMercatorY(tile.y / tiles);
        const south = tile.y === tiles - 1 ? -90 : latitudeOfMercatorY((tile.y + 1) / tiles);
        const [northXPerDegree, northY] = equalEarthParallel(north, this._parallel);
        const [southXPerDegree, southY] = equalEarthParallel(south, this._parallel);
        let widest = Math.max(northXPerDegree, southXPerDegree);
        const narrowest = Math.min(northXPerDegree, southXPerDegree);
        if (north > 0 && south < 0) widest = equalEarthParallel(0, this._parallel)[0];
        const minX = west * (west < 0 ? widest : narrowest);
        const maxX = east * (east > 0 ? widest : narrowest);
        return [
            Math.max(0, 0.5 + minX / WORLD_METERS),
            tile.y === 0 ? 0.5 - EQUAL_EARTH_HALF_HEIGHT / WORLD_METERS : 0.5 - northY / WORLD_METERS,
            Math.min(1, 0.5 + maxX / WORLD_METERS),
            tile.y === tiles - 1 ? 0.5 + EQUAL_EARTH_HALF_HEIGHT / WORLD_METERS : 0.5 - southY / WORLD_METERS,
        ];
    }

    jacobian(tile: TileCoordinates, tx: number, ty: number): [number, number, number, number] {
        const tiles = Math.pow(2, tile.z);
        const lng = (this._origin(tile) + tx / EXTENT / tiles) * 360 - 180;
        const lat = latitudeOfMercatorY((tile.y + ty / EXTENT) / tiles);
        const [xByLng, xByLat, , yByLat] = equalEarthJacobian(lng, lat);
        const lngByTx = 360 / (tiles * EXTENT);
        const latByTy = -360 * Math.cos(lat * Math.PI / 180) / (tiles * EXTENT);
        return [
            xByLng * lngByTx / WORLD_METERS,
            xByLat * latByTy / WORLD_METERS,
            0,
            -yByLat * latByTy / WORLD_METERS,
        ];
    }

    expansion(tile: TileCoordinates): Float64Array {
        const tiles = Math.pow(2, tile.z);
        const degree = expansionDegree(tile.z);
        const nodes = getChebyshevNodes(degree + 1);
        const halfRange = 0.5 + EXPANSION_BUFFER;
        const degreesAcross = 360 / tiles;
        const xPerU = new Float64Array(degree + 1);
        const y = new Float64Array(degree + 1);
        const centerY = equalEarthParallel(latitudeOfMercatorY((tile.y + 0.5) / tiles), this._parallel)[1];
        for (let i = 0; i <= degree; i++) {
            const parallel = equalEarthParallel(latitudeOfMercatorY((tile.y + 0.5 + nodes[i] * halfRange) / tiles), this._parallel);
            xPerU[i] = parallel[0] * degreesAcross / WORLD_METERS;
            y[i] = -(parallel[1] - centerY) / WORLD_METERS;
        }
        const a = interpolate(nodes, xPerU);
        const c = interpolate(nodes, y);
        const coefficients = new Float64Array(POLE_C + 1);
        let scale = 1;
        for (let k = 0; k <= degree; k++) {
            coefficients[k] = a[k] * scale;
            if (k >= 1) coefficients[C_BEFORE_FIRST + k] = c[k] * scale;
            scale /= halfRange;
        }
        coefficients[KAPPA] = this._origin(tile) * tiles + 0.5 - tiles / 2;
        if (tile.y === 0 || tile.y === tiles - 1) {
            const pole = equalEarthParallel(tile.y === 0 ? 90 : -90, this._parallel);
            coefficients[POLE_A] = pole[0] * degreesAcross / WORLD_METERS;
            coefficients[POLE_C] = -(pole[1] - centerY) / WORLD_METERS;
        }
        return coefficients;
    }
}

const warps = new Map<number, TileWarp>();

/**
 * @internal
 * The warp of mercator tiles onto the Equal Earth plane whose central meridian is the given longitude. It holds no
 * map's state, so every map with that central meridian shares it.
 */
export function getEqualEarthTileWarp(centralMeridian: number): TileWarp {
    let warp = warps.get(centralMeridian);
    if (!warp) {
        warp = new EqualEarthTileWarp(centralMeridian);
        warps.set(centralMeridian, warp);
    }
    return warp;
}

/**
 * @internal
 * The warp of mercator tiles onto the Equal Earth plane with its central meridian at 0.
 */
export const equalEarthTileWarp: TileWarp = getEqualEarthTileWarp(0);
