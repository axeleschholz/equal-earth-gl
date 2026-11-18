import {mercatorWorldCoordinateHelper} from '../mercator_coordinate.ts';

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
 * @internal
 * How the tiles of the mercator grid lie on a world plane that is not mercator: a tile's square becomes a curved
 * shape there, and everything that draws, selects or queries such tiles goes through this mapping. The shaders
 * of the projection compute the same mapping on the GPU.
 */
export interface TileWarp {
    /**
     * A position in a mercator tile, in tile units (0..EXTENT across the tile), to the 0..1 world plane.
     * A position in the tile's buffer past the antimeridian is kept on it, and one past the top or bottom of the
     * mercator square lies between there and the pole.
     *
     * @param out - the array the result is written to
     */
    warp(tile: {x: number; y: number; z: number}, tx: number, ty: number, out: [number, number]): [number, number];
    /**
     * The tile's bounding box on the world plane: `[minX, minY, maxX, maxY]`. The boxes of the top and bottom rows
     * of tiles reach the pole, since those tiles are drawn with a cap that covers it.
     */
    bounds(tile: {x: number; y: number; z: number}): [number, number, number, number];
    /**
     * World plane units per tile unit at a position in a tile: `[dX/dtx, dX/dty, dY/dtx, dY/dty]`.
     */
    jacobian(tile: {x: number; y: number; z: number}, tx: number, ty: number): [number, number, number, number];
    /**
     * The warp of one tile as twenty polynomial coefficients, see `evaluateExpansion` of the projection, which
     * give a position's offset on the world plane from the warp of the tile's center. A shader can evaluate them in
     * single precision at any zoom, where the warp itself would lose the position among the digits of the world.
     */
    expansion(tile: {x: number; y: number; z: number}): Float64Array;
    /**
     * The lowest tile zoom at which {@link TileWarp.expansion} is as good as the warp: within 0.05 px of it for a
     * tile drawn up to sixteen times its own size.
     */
    readonly expansionMinZoom: number;
}
