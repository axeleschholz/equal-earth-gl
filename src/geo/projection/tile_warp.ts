import {mercatorWorldCoordinateHelper} from '../mercator_coordinate.ts';
import {EXTENT} from '../../data/extent.ts';

import type {WorldCoordinateHelper} from '../world_types.ts';

/**
 * The grid a source's tiles are cut in: `mercator` for Web Mercator tiles, or `plane` for the quad grid of the
 * world plane the map is drawn on. The two are the same grid on a mercator map.
 */
export type TileGrid = 'mercator' | 'plane';

/**
 * @internal
 * The grid a source's tiles are cut in: its own when it has one, see `Source.tileGrid`, or else the one the map's
 * sources are taken to be cut in on the plane, see `WorldCoordinateHelper.sourceTileGrid`.
 */
export function resolveTileGrid(ownTileGrid: TileGrid | undefined, plane: {sourceTileGrid: TileGrid}): TileGrid {
    return ownTileGrid ?? plane.sourceTileGrid;
}

/**
 * @internal
 * The world mapping that turns the tile coordinates of a source's features back into lng/lat: the plane's, except
 * for a source of mercator tiles on a plane those are warped onto, whose tile coordinates are mercator's.
 */
export function featureGeometryHelper(sourceTileGrid: TileGrid | undefined, worldCoordinateHelper: WorldCoordinateHelper): WorldCoordinateHelper {
    const warped = worldCoordinateHelper.mercatorTileWarp && resolveTileGrid(sourceTileGrid, worldCoordinateHelper) === 'mercator';
    return warped ? mercatorWorldCoordinateHelper : worldCoordinateHelper;
}

/**
 * A tile of the mercator grid as a {@link TileWarp} takes it. `wrap` tells apart the copies of a tile that the
 * edge of the world runs through, see {@link TileWarp.copies}, and is 0 when left out.
 */
export type WarpedTile = {x: number; y: number; z: number; wrap?: number};

/**
 * @internal
 * Whether any of a tile copy lies in the world, given the copy's {@link TileWarp.window}.
 */
export function tileLiesInWorld(window: [number, number]): boolean {
    return window[1] > 0 && window[0] < EXTENT;
}

/**
 * @internal
 * How the tiles of the mercator grid lie on a world plane that is not mercator: a tile's square becomes a curved
 * shape there, and everything that draws, selects or queries such tiles goes through this mapping. The shaders
 * of the projection compute the same mapping on the GPU.
 */
export interface TileWarp {
    /**
     * The mercator x of the world's west edge, counted so that the world runs from it one unit eastward without a
     * break: 0 where the world ends at the antimeridian, and below 0 otherwise, by the part of the world that lies
     * east of the antimeridian. A tile copy with `wrap` w holds the mercator x of its tile plus w on this count.
     */
    readonly worldWest: number;
    /**
     * The values of `wrap` that tiles are drawn with. The world ends at the meridian opposite its central one,
     * which is the antimeridian only when the central meridian is 0. Otherwise the tiles on one side of the
     * antimeridian lie a whole world further along than their mercator x says, which their `wrap` of -1 stands
     * for, and a tile that the edge runs through is drawn once with each `wrap`, one part at each end of the world.
     */
    readonly copies: readonly number[];
    /**
     * A position in a mercator tile, in tile units (0..EXTENT across the tile), to the 0..1 world plane.
     * A position past the edge of the world is placed where the plane would continue, outside the world, and one
     * past the top or bottom of the mercator square lies between there and the pole.
     *
     * @param out - the array the result is written to
     */
    warp(tile: WarpedTile, tx: number, ty: number, out: [number, number]): [number, number];
    /**
     * The tile x of the world's west and east edges in a tile copy, which can be far outside the tile: the part
     * of the copy between them lies in the world. See {@link tileLiesInWorld}.
     */
    window(tile: WarpedTile): [number, number];
    /**
     * The bounding box on the world plane of the part of a tile copy that lies in the world, as
     * `[minX, minY, maxX, maxY]`, or `null` for a copy that lies wholly outside it. The boxes of the top and
     * bottom rows of tiles reach the pole, since those tiles are drawn with a cap that covers it.
     */
    bounds(tile: WarpedTile): [number, number, number, number] | null;
    /**
     * World plane units per tile unit at a position in a tile: `[dX/dtx, dX/dty, dY/dtx, dY/dty]`.
     */
    jacobian(tile: WarpedTile, tx: number, ty: number): [number, number, number, number];
    /**
     * The warp of one tile copy as twenty polynomial coefficients, see `evaluateExpansion` of the projection, which
     * give a position's offset on the world plane from the warp of the tile's center. A shader can evaluate them in
     * single precision at any zoom, where the warp itself would lose the position among the digits of the world.
     */
    expansion(tile: WarpedTile): Float64Array;
    /**
     * The lowest tile zoom at which {@link TileWarp.expansion} is as good as the warp: within 0.05 px of it for a
     * tile drawn up to sixteen times its own size.
     */
    readonly expansionMinZoom: number;
}
