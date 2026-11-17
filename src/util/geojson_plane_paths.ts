import {latFromMercatorY, mercatorYfromLat} from '../geo/mercator_coordinate.ts';
import {MAX_VALID_LATITUDE} from './util.ts';

import type {WorldCoordinateHelper} from '../geo/world_types.ts';

type Position = GeoJSON.Position;

/** How many times a segment is halved at most, which bounds the positions one segment can become. */
const MAX_DEPTH = 14;

/** The fractions of a segment at which its path is compared with the straight line between its ends. */
const CHECKED_FRACTIONS = [0.25, 0.5, 0.75];

/**
 * How a segment runs between its ends: straight on a mercator map, as lines and edges are drawn there, or, for a
 * segment that reaches past the latitudes mercator has, with latitude changing evenly with longitude.
 */
type PathKind = 'mercator' | 'lngLat';

function pathKind(a: Position, b: Position): PathKind {
    return Math.abs(a[1]) <= MAX_VALID_LATITUDE && Math.abs(b[1]) <= MAX_VALID_LATITUDE ? 'mercator' : 'lngLat';
}

/** The position a fraction `t` of the way along the path from `a` to `b`, with any further ordinates interpolated. */
function alongPath(a: Position, b: Position, t: number, kind: PathKind): Position {
    const position: Position = [a[0] + (b[0] - a[0]) * t, 0];
    if (kind === 'mercator') {
        const ay = mercatorYfromLat(a[1]);
        position[1] = latFromMercatorY(ay + (mercatorYfromLat(b[1]) - ay) * t);
    } else {
        position[1] = a[1] + (b[1] - a[1]) * t;
    }
    for (let i = 2; i < a.length; i++) {
        position.push(i < b.length ? a[i] + (b[i] - a[i]) * t : a[i]);
    }
    return position;
}

/**
 * Which copy of the world a longitude is in: 0 for -180 to 180, both included, 1 for the one east of it, and so on.
 * A longitude on the line between two copies past the first belongs to the one nearer the first.
 */
function bandOf(lng: number): number {
    if (lng >= -180 && lng <= 180) return 0;
    return lng > 180 ? Math.ceil((lng - 180) / 360) : Math.floor((lng + 180) / 360);
}

/** The position moved from the copy of the world `band` into the first one. */
function unshift(position: Position, band: number): Position {
    if (band === 0) return position;
    const moved = position.slice();
    moved[0] -= 360 * band;
    return moved;
}

/** How many copies of the world to either side of the first a position can be in and still be drawn. */
const MAX_BAND = 8;

/**
 * Whether a position can be put on the plane: its longitude and latitude are numbers, and it is not so many
 * times around the world that cutting a line to it would produce more pieces than anyone drew on purpose.
 */
function isPlaceable(position: Position): boolean {
    return Number.isFinite(position[0]) && Number.isFinite(position[1]) && Math.abs(position[0]) <= 180 + 360 * MAX_BAND;
}

/** A line or ring without the positions that cannot be put on the plane; the same array when it has none. */
function placeable(line: Position[]): Position[] {
    return line.every(isPlaceable) ? line : line.filter(isPlaceable);
}

function samePlace(a: Position, b: Position): boolean {
    return a[0] === b[0] && a[1] === b[1];
}

/**
 * Cuts a line wherever it passes from one copy of the world to the next, and returns the pieces with their
 * longitudes brought into -180 to 180. A line that stays in the first copy comes back as it is.
 */
function cutLine(line: Position[]): Position[][] {
    if (line.every(position => position[0] >= -180 && position[0] <= 180)) return [line];
    const pieces: Position[][] = [];
    let piece: Position[] = [];
    const push = (position: Position, band: number) => {
        const moved = unshift(position, band);
        if (!piece.length || !samePlace(piece[piece.length - 1], moved)) piece.push(moved);
    };
    const finish = () => {
        if (piece.length >= 2) pieces.push(piece);
        piece = [];
    };
    let band = bandOf(line[0][0]);
    push(line[0], band);
    for (let i = 1; i < line.length; i++) {
        const from = line[i - 1];
        const to = line[i];
        const toBand = bandOf(to[0]);
        const kind = pathKind(from, to);
        while (band !== toBand) {
            const step = toBand > band ? 1 : -1;
            const edge = 360 * band + 180 * step;
            const crossing = alongPath(from, to, (edge - from[0]) / (to[0] - from[0]), kind);
            crossing[0] = edge;
            push(crossing, band);
            finish();
            band += step;
            push(crossing, band);
        }
        push(to, band);
    }
    finish();
    return pieces;
}

/** The part of a ring on one side of a meridian, by Sutherland-Hodgman clipping; the ring is not closed. */
function clipRing(ring: Position[], edge: number, keepEast: boolean): Position[] {
    const inside = (position: Position) => keepEast ? position[0] >= edge : position[0] <= edge;
    const clipped: Position[] = [];
    for (let i = 0; i < ring.length; i++) {
        const from = ring[i];
        const to = ring[(i + 1) % ring.length];
        const fromInside = inside(from);
        if (fromInside) clipped.push(from);
        if (fromInside !== inside(to)) {
            const crossing = alongPath(from, to, (edge - from[0]) / (to[0] - from[0]), pathKind(from, to));
            crossing[0] = edge;
            clipped.push(crossing);
        }
    }
    return clipped;
}

/**
 * The part of a closed ring in one copy of the world, closed again and with its longitudes brought into -180 to 180,
 * or `null` when no area of it is there.
 */
function ringInBand(ring: Position[], band: number): Position[] | null {
    let open = samePlace(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
    open = clipRing(open, 360 * band - 180, true);
    open = clipRing(open, 360 * band + 180, false);
    const result: Position[] = [];
    for (const position of open) {
        const moved = unshift(position, band);
        if (!result.length || !samePlace(result[result.length - 1], moved)) result.push(moved);
    }
    if (result.length && samePlace(result[0], result[result.length - 1])) result.pop();
    if (result.length < 3) return null;
    result.push(result[0]);
    return result;
}

/**
 * Cuts a polygon along the lines between the copies of the world it reaches into, and returns the part in each,
 * with its longitudes brought into -180 to 180 and the holes that are in it. A polygon that stays in the first copy
 * comes back as it is.
 */
function cutPolygon(rings: Position[][]): Position[][][] {
    const outer = rings[0];
    if (!outer?.length) return [];
    let minBand = 0;
    let maxBand = 0;
    for (const position of outer) {
        const band = bandOf(position[0]);
        minBand = Math.min(minBand, band);
        maxBand = Math.max(maxBand, band);
    }
    if (minBand === 0 && maxBand === 0) return [rings];
    const polygons: Position[][][] = [];
    for (let band = minBand; band <= maxBand; band++) {
        const outerPart = ringInBand(outer, band);
        if (!outerPart) continue;
        const polygon = [outerPart];
        for (let i = 1; i < rings.length; i++) {
            const hole = rings[i].length ? ringInBand(rings[i], band) : null;
            if (hole) polygon.push(hole);
        }
        polygons.push(polygon);
    }
    return polygons;
}

/**
 * @internal
 * Rewrites every position of a GeoJSON object from lng/lat to the world coordinates of a plane that has an edge at
 * the antimeridian and on which straight lines of a mercator map are curves, x and y from 0 to 1 across the world
 * square with y growing down. Two things happen to lines and rings on the way, so that they are drawn where a
 * mercator map draws them:
 *
 * - Where one leaves -180 to 180 of longitude, it is cut, and the part beyond comes in from the other edge of the
 *   world, as it does on the world copy beside a mercator map. A line becomes several lines, a polygon several
 *   polygons; a point is moved.
 * - A segment gets positions added along its path, straight on a mercator map, until the straight lines between
 *   them on the plane are within `tolerance` of it, in world units. A segment that reaches past the latitudes
 *   mercator has runs with latitude changing evenly with longitude instead.
 *
 * A position whose longitude or latitude is not a finite number, or that is more than eight times around the world,
 * is left out of its line or ring, and a point at one is left as it is, which no tile holds.
 *
 * Returns a new object; the input is never mutated, and members that are not coordinates are carried over.
 */
export function projectGeoJSONAlongPaths<T extends GeoJSON.GeoJSON>(data: T, worldCoordinateHelper: Pick<WorldCoordinateHelper, 'worldFromLngLat'>, tolerance: number): T {
    const toWorld = (position: Position): Position => {
        const {x, y} = worldCoordinateHelper.worldFromLngLat(position[0], position[1]);
        const projected = position.slice();
        projected[0] = x;
        projected[1] = y;
        return projected;
    };

    const addBetween = (a: Position, b: Position, aWorld: Position, bWorld: Position, kind: PathKind, depth: number, out: Position[]) => {
        const span = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 360;
        if (depth >= MAX_DEPTH || span * span * 0.5 < tolerance) return;
        let middleWorld: Position;
        let bends = false;
        for (const t of CHECKED_FRACTIONS) {
            const onPath = toWorld(alongPath(a, b, t, kind));
            if (t === 0.5) middleWorld = onPath;
            if (Math.hypot(onPath[0] - (aWorld[0] + (bWorld[0] - aWorld[0]) * t), onPath[1] - (aWorld[1] + (bWorld[1] - aWorld[1]) * t)) > tolerance) bends = true;
        }
        if (!bends) return;
        const middle = alongPath(a, b, 0.5, kind);
        addBetween(a, middle, aWorld, middleWorld, kind, depth + 1, out);
        out.push(middleWorld);
        addBetween(middle, b, middleWorld, bWorld, kind, depth + 1, out);
    };

    const projectLine = (line: Position[]): Position[] => {
        if (!line.length) return [];
        const out: Position[] = [];
        let previousWorld = toWorld(line[0]);
        out.push(previousWorld);
        for (let i = 1; i < line.length; i++) {
            const world = toWorld(line[i]);
            addBetween(line[i - 1], line[i], previousWorld, world, pathKind(line[i - 1], line[i]), 0, out);
            out.push(world);
            previousWorld = world;
        }
        return out;
    };

    const projectPoint = (position: Position): Position => {
        if (!isPlaceable(position)) return position;
        return toWorld(unshift(position, bandOf(position[0])));
    };

    const projectLines = (lines: Position[][]): Position[][] => {
        return lines.map(placeable).flatMap(line => line.length ? cutLine(line) : []).map(projectLine);
    };

    const projectPolygons = (polygons: Position[][][]): Position[][][] => {
        return polygons.map(rings => rings.map(placeable)).flatMap(cutPolygon).map(rings => rings.map(projectLine));
    };

    const projectGeometry = (geometry: GeoJSON.Geometry): GeoJSON.Geometry => {
        switch (geometry.type) {
            case 'Point':
                return {...geometry, coordinates: projectPoint(geometry.coordinates)};
            case 'MultiPoint':
                return {...geometry, coordinates: geometry.coordinates.map(projectPoint)};
            case 'LineString': {
                const lines = projectLines([geometry.coordinates]);
                return lines.length === 1 ? {...geometry, coordinates: lines[0]} : {...geometry, type: lines.length ? 'MultiLineString' : 'LineString', coordinates: lines} as GeoJSON.Geometry;
            }
            case 'MultiLineString':
                return {...geometry, coordinates: projectLines(geometry.coordinates)};
            case 'Polygon': {
                const polygons = projectPolygons([geometry.coordinates]);
                return polygons.length === 1 ? {...geometry, coordinates: polygons[0]} : {...geometry, type: polygons.length ? 'MultiPolygon' : 'Polygon', coordinates: polygons} as GeoJSON.Geometry;
            }
            case 'MultiPolygon':
                return {...geometry, coordinates: projectPolygons(geometry.coordinates)};
            case 'GeometryCollection':
                return {...geometry, geometries: geometry.geometries.map(projectGeometry)};
            default:
                return geometry;
        }
    };

    const project = (object: GeoJSON.GeoJSON): GeoJSON.GeoJSON => {
        if (!object || typeof object !== 'object') return object;
        switch (object.type) {
            case 'FeatureCollection':
                return {...object, features: object.features.map(feature => project(feature) as GeoJSON.Feature)};
            case 'Feature':
                return {...object, geometry: object.geometry ? projectGeometry(object.geometry) : object.geometry};
            default:
                return projectGeometry(object);
        }
    };

    return project(data) as T;
}
