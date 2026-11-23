import {OverscaledTileID} from '../../tile/tile_id.ts';
import {Aabb} from '../../util/primitives/aabb.ts';
import {EXTENT} from '../../data/extent.ts';
import {MercatorCoveringTilesDetailsProvider} from './mercator_covering_tiles_details_provider.ts';

import type {MercatorCoordinate} from '../mercator_coordinate.ts';
import type {CoveringTilesOptionsInternal} from './covering_tiles.ts';
import type {TileWarp} from './tile_warp.ts';

/** The bounds given for a tile copy that lies outside the world, which no view shows. */
const OUTSIDE_THE_WORLD: [number, number, number, number] = [-2, -2, -2, -2];

/**
 * @internal
 * How tiles of the mercator grid are selected on a flat plane they are warped onto. A tile is where its warp
 * puts it, so its bounding volume is the box of the warp's bounds. The warp also changes a tile's size: where it
 * shrinks tiles, fewer of them are needed to fill the screen, so a coarser zoom level is selected there.
 */
export class WarpedCoveringTilesDetailsProvider extends MercatorCoveringTilesDetailsProvider {
    private readonly _warp: TileWarp;

    constructor(warp: TileWarp) {
        super();
        this._warp = warp;
    }

    /** A tile keeps the wrap of the copy of the world it was reached in, see `TileWarp.copies`. */
    override getWrap(_centerCoord: MercatorCoordinate, _tileID: {x: number; y: number; z: number}, parentWrap: number): number {
        return parentWrap;
    }

    getRootWraps(): readonly number[] {
        return this._warp.copies;
    }

    hasTile(tileID: {x: number; y: number; z: number}, wrap: number): boolean {
        return this._warp.window({x: tileID.x, y: tileID.y, z: tileID.z, wrap}) !== null;
    }

    override getTileBoundingVolume(tileID: {x: number; y: number; z: number}, wrap: number, elevation: number, options: CoveringTilesOptionsInternal): Aabb {
        let minElevation = Math.min(0, elevation);
        let maxElevation = Math.max(0, elevation);
        if (options?.terrain) {
            const minMax = options.terrain.getMinMaxElevation(new OverscaledTileID(tileID.z, wrap, tileID.z, tileID.x, tileID.y));
            minElevation = minMax.minElevation ?? minElevation;
            maxElevation = minMax.maxElevation ?? maxElevation;
        }
        const [minX, minY, maxX, maxY] = this._warp.bounds({x: tileID.x, y: tileID.y, z: tileID.z, wrap}) ?? OUTSIDE_THE_WORLD;
        return new Aabb([minX, minY, minElevation], [maxX, maxY, maxElevation]);
    }

    override allowWorldCopies(): boolean {
        return false;
    }

    /**
     * Half the base 2 logarithm of how many times the area of a plane tile of the same zoom the tile covers,
     * where it covers the most: the zoom offset at which its area on screen is that of a tile of the view's
     * zoom. Taking the tile's largest part keeps a tile that needs more detail anywhere from being selected whole.
     */
    getTileZoomOffset(tileID: {x: number; y: number; z: number}): number {
        const tiles = Math.pow(2, tileID.z);
        const half = tiles / 2;
        let ty = EXTENT / 2;
        if (tileID.y >= half) ty = 0;
        else if (tileID.y + 1 <= half) ty = EXTENT;
        const [xByTx, , , yByTy] = this._warp.jacobian(tileID, EXTENT / 2, ty);
        const areaRatio = Math.abs(xByTx * yByTy) * EXTENT * EXTENT * tiles * tiles;
        return 0.5 * Math.log2(areaRatio);
    }
}
