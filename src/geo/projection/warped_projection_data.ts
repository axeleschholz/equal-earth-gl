import {mat4} from 'gl-matrix';
import {EXTENT} from '../../data/extent.ts';
import {createIdentityMat4f32} from '../../util/util.ts';

import type {MercatorProjectedCamera} from '../../camera/projected_camera.ts';
import type {OverscaledTileID} from '../../tile/tile_id.ts';
import type {Mat4f64} from '../../util/util.ts';
import type {RendererProjectionData} from './projection_data.ts';
import type {TileWarp, WarpedTile} from './tile_warp.ts';

/** The single precision expansions of the tiles drawn lately, by tile and warp; a tile's never changes. */
const expansions = new WeakMap<TileWarp, Map<string, Float32Array>>();

/** How many expansions are kept for a warp before they are dropped to start over. */
const MAX_CACHED_EXPANSIONS = 4096;

function getExpansion(warp: TileWarp, tile: WarpedTile): Float32Array {
    let ofWarp = expansions.get(warp);
    if (!ofWarp) {
        ofWarp = new Map();
        expansions.set(warp, ofWarp);
    }
    const key = `${tile.z}/${tile.x}/${tile.y}/${tile.wrap ?? 0}`;
    let expansion = ofWarp.get(key);
    if (!expansion) {
        if (ofWarp.size >= MAX_CACHED_EXPANSIONS) ofWarp.clear();
        expansion = new Float32Array(warp.expansion(tile));
        ofWarp.set(key, expansion);
    }
    return expansion;
}

const scratchCenter: [number, number] = [0, 0];

/** The window given to the shader for a tile copy outside the world: an empty one, so all of it is discarded. */
const EMPTY_WINDOW: [number, number] = [0, 0];

/**
 * @internal
 * What the shaders of a projection that warps mercator tiles onto its plane need to draw one such tile, in the
 * uniforms every projection shares:
 *
 * - Below the warp's `expansionMinZoom`, `projectionTransition` is 0, the shader computes the warp itself, and
 *   `mainMatrix` takes the 0..1 world plane to clip space. `tileMercatorCoords` is the tile's place in the
 *   mercator square as on the globe, but with x counted from the world's west edge. Without a tile, it is that of
 *   the world tile for positions that are themselves mercator coordinates, 0..1, which a custom layer supplies.
 * - From that zoom, `projectionTransition` is 1, `fallbackMatrix` followed by `clippingPlane` hold the twenty
 *   coefficients of the tile's expansion, and `mainMatrix` takes an offset from the warp of the tile's center, in
 *   world units, to clip space. The center is placed in double precision here, so that single precision in the
 *   shader only has to carry the offset within the tile. The first two of `tileMercatorCoords` are then the
 *   tile x of the world's west and east edges, see `TileWarp.window`, which the shader could not derive at
 *   these zooms.
 * - `clipAntimeridian` names the sides at which fragments are discarded: 1 for those past an edge of the world,
 *   set where one runs through the tile or its buffer, and 2 and 4 for line fragments past the top or bottom of
 *   the mercator square in the tiles of the top and bottom row, whose pole caps would show the buffer.
 */
export function getWarpedProjectionData(projectedCamera: MercatorProjectedCamera, overscaledTileID: OverscaledTileID | null, warp: TileWarp): RendererProjectionData {
    const canonical = overscaledTileID ? overscaledTileID.canonical : {x: 0, y: 0, z: 0};
    const tile: WarpedTile = {x: canonical.x, y: canonical.y, z: canonical.z, wrap: overscaledTileID ? overscaledTileID.wrap : 0};
    const tiles = Math.pow(2, tile.z);
    const unitsAcross = tiles * (overscaledTileID ? EXTENT : 1);
    const worldSize = projectedCamera.worldSize;
    const matrix: Mat4f64 = new Float64Array(16);
    mat4.identity(matrix);
    const [windowMin, windowMax] = warp.window(tile) ?? EMPTY_WINDOW;
    const edgeIsNear = windowMin > -EXTENT || windowMax < 2 * EXTENT;

    const data: RendererProjectionData = {
        mainMatrix: null,
        tileMercatorCoords: [-windowMin / (tiles * EXTENT), tile.y / tiles, 1 / unitsAcross, 1 / unitsAcross],
        clippingPlane: [0, 0, 0, 0],
        projectionTransition: 0,
        fallbackMatrix: null,
        clipAntimeridian: (edgeIsNear ? 1 : 0) + (tile.y === 0 ? 2 : 0) + (tile.y === tiles - 1 ? 4 : 0),
    };

    if (tile.z < warp.expansionMinZoom) {
        mat4.scale(matrix, matrix, [worldSize, worldSize, 1]);
        data.fallbackMatrix = createIdentityMat4f32();
    } else {
        const center = warp.warp(tile, EXTENT / 2, EXTENT / 2, scratchCenter);
        mat4.translate(matrix, matrix, [center[0] * worldSize, center[1] * worldSize, 0]);
        mat4.scale(matrix, matrix, [worldSize, worldSize, 1]);
        const expansion = getExpansion(warp, tile);
        data.fallbackMatrix = expansion.subarray(0, 16);
        data.clippingPlane = [expansion[16], expansion[17], expansion[18], expansion[19]];
        data.projectionTransition = 1;
        data.tileMercatorCoords[0] = windowMin;
        data.tileMercatorCoords[1] = windowMax;
    }
    mat4.multiply(matrix, projectedCamera.modelViewProjectionMatrix, matrix);
    data.mainMatrix = new Float32Array(matrix);
    if (overscaledTileID) data.uniformBufferKey = `${overscaledTileID.key}/warped`;
    return data;
}
