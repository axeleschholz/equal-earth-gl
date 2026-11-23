import {warnOnce} from '../util/util.ts';
import {featureGeometryHelper} from '../geo/projection/tile_warp.ts';

import type {WorldCoordinateHelper} from '../geo/world_types.ts';
import type {TileGrid} from '../geo/projection/tile_warp.ts';

/**
 * The grid a tile source's tiles are cut in, as the source's `tileGrid` option names it:
 *
 * - `mercator`: Web Mercator tiles, which is what a source without the option serves.
 * - `equal-earth`: the quad grid over the Equal Earth plane, EPSG:8857. Its tile 0/0/0 is the square as wide as
 *   the world, 34 487 918.12 m, centered on the projection's origin; the world is a band across the middle of it,
 *   and tiles wholly above or below the band do not exist.
 */
export type SourceTileGrid = 'mercator' | 'equal-earth';

/**
 * What a tile source takes beyond the style specification.
 */
export type TileGridSourceOption = {
    /**
     * The grid the source's tiles are cut in. A source is drawn only in a projection that can place its grid:
     * `mercator` tiles in every built-in projection, `equal-earth` tiles in the `equal-earth` projection with
     * its central meridian at 0.
     * @defaultValue 'mercator'
     */
    tileGrid?: SourceTileGrid;
};

/** The values of {@link TileGridSourceOption.tileGrid}. */
export const SOURCE_TILE_GRIDS: readonly string[] = ['mercator', 'equal-earth'];

/**
 * @internal
 * A source's grid on a plane, from its `tileGrid` option: `undefined` for the grid the plane takes its sources to
 * be cut in, `plane` for the plane's own grid where that is another one, and `null` where tiles of that grid
 * cannot be drawn on the plane.
 */
export function resolveSourceTileGrid(option: string | undefined, plane: Pick<WorldCoordinateHelper, 'sourceTileGrid' | 'tileGridName'>): TileGrid | undefined | null {
    if (option === undefined) return undefined;
    if (option === 'mercator' && plane.sourceTileGrid === 'mercator') return undefined;
    if (option === plane.tileGridName) return 'plane';
    return null;
}

/**
 * @internal
 * Whether a tile source whose `tileGrid` option is `option` has a tile on a plane: none where its grid cannot be
 * drawn, which is warned about once, and in the plane's own grid only those that touch the world.
 */
export function sourceGridHasTile(option: string | undefined, plane: WorldCoordinateHelper, tile: {x: number; y: number; z: number}): boolean {
    const grid = resolveSourceTileGrid(option, plane);
    if (grid === null) {
        warnOnce(`A source with tileGrid "${option}" cannot be drawn in the map's projection as it is set up, and is left out.`);
        return false;
    }
    if (grid !== 'plane') return true;
    const tiles = Math.pow(2, tile.z);
    const [minX, minY, maxX, maxY] = plane.worldBounds;
    return tile.x + 1 > minX * tiles && tile.x < maxX * tiles && tile.y + 1 > minY * tiles && tile.y < maxY * tiles;
}

/**
 * @internal
 * The world mapping of the grid a tile source's tiles are cut in on a plane, which their tile matrix set, their
 * bounds and their features' coordinates are in: mercator's for mercator tiles, the plane's for tiles of the
 * plane's own grid, and `null` for a source that cannot be drawn on the plane.
 */
export function sourceGridHelper(option: string | undefined, plane: WorldCoordinateHelper): WorldCoordinateHelper | null {
    const grid = resolveSourceTileGrid(option, plane);
    return grid === null ? null : featureGeometryHelper(grid, plane);
}
