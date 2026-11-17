import {LngLat} from '../lng_lat.ts';
import {MercatorCoordinate} from '../mercator_coordinate.ts';
import {clamp} from '../../util/util.ts';
import {EQUAL_EARTH_HALF_HEIGHT, EQUAL_EARTH_HALF_WIDTH, equalEarthForward, equalEarthInverse} from './equal_earth_math.ts';
import {equalEarthTileWarp} from './equal_earth_tile_warp.ts';

import type {WorldCoordinateHelper} from '../world_types.ts';
import type {TileMatrixSet} from './tile_matrix_set.ts';
import type {TileGrid, TileWarp} from './tile_warp.ts';

/**
 * @internal
 * The quad tile matrix set over the Equal Earth plane (EPSG:8857 meters): tile 0/0/0 is the square as wide as
 * the world and centered on it, so the world is a band across its middle about half as high as the square.
 */
export const equalEarthTileMatrixSet: TileMatrixSet = {
    origin: [-EQUAL_EARTH_HALF_WIDTH, EQUAL_EARTH_HALF_WIDTH],
    extentAtZoom0: 2 * EQUAL_EARTH_HALF_WIDTH,
};

const EXTENT = 2 * EQUAL_EARTH_HALF_WIDTH;

/**
 * @internal
 * The world coordinate mapping of the `equal-earth` projection: world x/y are Equal Earth meters relative to the
 * top-left corner of {@link equalEarthTileMatrixSet}, scaled so that its tile 0/0/0 is the 0..1 square, with y
 * growing down. One world unit is the same number of meters everywhere on the plane.
 */
export class EqualEarthWorldCoordinateHelper implements WorldCoordinateHelper {
    readonly name = 'equal-earth';
    /** The world is a single bounded outline: no world copies and no wrapping across the antimeridian. */
    readonly wraps = false;
    readonly sourceTileGrid: TileGrid = 'mercator';
    readonly tileMatrixSet: TileMatrixSet = equalEarthTileMatrixSet;
    readonly mercatorTileWarp: TileWarp = equalEarthTileWarp;
    readonly bendsMercatorLines = true;
    /** The projection places every latitude, so GeoJSON is tiled up to both poles. */
    readonly latitudeRange: [number, number] = [-90, 90];
    readonly worldBounds: readonly [number, number, number, number] = [
        0,
        0.5 - EQUAL_EARTH_HALF_HEIGHT / EXTENT,
        1,
        0.5 + EQUAL_EARTH_HALF_HEIGHT / EXTENT,
    ];
    private readonly _scratch: [number, number] = [0, 0];

    /**
     * lng/lat to the world square. The world has one copy, so a longitude past the antimeridian is the same place
     * inside it: 200 is -160. The antimeridian itself stays on the edge it names, 180 east and -180 west.
     */
    worldFromLngLat(lng: number, lat: number, altitude?: number): MercatorCoordinate {
        if (lng > 180 || lng < -180) lng = ((lng + 180) % 360 + 360) % 360 - 180;
        const [x, y] = equalEarthForward(lng, lat, this._scratch);
        return new MercatorCoordinate((x + EQUAL_EARTH_HALF_WIDTH) / EXTENT, (EQUAL_EARTH_HALF_WIDTH - y) / EXTENT, altitude === undefined ? 0 : altitude / EXTENT);
    }

    /**
     * World square coordinates to lng/lat. A position outside the outline of the world (the space beside it, a
     * drag past its edge) is answered with the nearest position on the outline at the same height, or at the
     * pole's height when it lies above or below the world, so the mapping is total the way mercator's is.
     */
    lngLatFromWorld(x: number, y: number): LngLat {
        const crsX = x * EXTENT - EQUAL_EARTH_HALF_WIDTH;
        const crsY = EQUAL_EARTH_HALF_WIDTH - y * EXTENT;
        const position = equalEarthInverse(crsX, crsY, this._scratch);
        if (position) return new LngLat(position[0], position[1]);

        const lat = Math.abs(crsY) >= EQUAL_EARTH_HALF_HEIGHT ? Math.sign(crsY) * 90 : equalEarthInverse(0, crsY, this._scratch)[1];
        const halfWidthAtLat = equalEarthForward(180, lat, this._scratch)[0];
        return new LngLat(clamp(crsX / halfWidthAtLat, -1, 1) * 180, lat);
    }

    hasLngLat(x: number, y: number): boolean {
        return equalEarthInverse(x * EXTENT - EQUAL_EARTH_HALF_WIDTH, EQUAL_EARTH_HALF_WIDTH - y * EXTENT, this._scratch) !== null;
    }

    metersPerWorldUnit(_x: number, _y: number): number {
        return EXTENT;
    }

    worldZFromAltitude(altitude: number, _lngLat: LngLat): number {
        return altitude / EXTENT;
    }
}

/**
 * @internal
 * The one Equal Earth world mapping: it holds no map's state, so every map in the projection shares it.
 */
export const equalEarthWorldCoordinateHelper: EqualEarthWorldCoordinateHelper = new EqualEarthWorldCoordinateHelper();
