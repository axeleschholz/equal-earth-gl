import {mat4} from 'gl-matrix';
import {EXTENT} from '../../data/extent.ts';
import {createIdentityMat4f32} from '../../util/util.ts';
import {getMercatorTileCoordinates} from './mercator_utils.ts';

import type {MercatorProjectedCamera} from '../../camera/projected_camera.ts';
import type {OverscaledTileID} from '../../tile/tile_id.ts';
import type {Mat4f64} from '../../util/util.ts';
import type {RendererProjectionData} from './projection_data.ts';
import type {TileWarp} from './tile_warp.ts';

/** The single precision expansions of the tiles drawn lately, by tile and warp; a tile's never changes. */
const expansions = new WeakMap<TileWarp, Map<string, Float32Array>>();

/** How many expansions are kept for a warp before they are dropped to start over. */
const MAX_CACHED_EXPANSIONS = 4096;

function getExpansion(warp: TileWarp, tile: {x: number; y: number; z: number}): Float32Array {
    let ofWarp = expansions.get(warp);
    if (!ofWarp) {
        ofWarp = new Map();
        expansions.set(warp, ofWarp);
    }
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    let expansion = ofWarp.get(key);
    if (!expansion) {
        if (ofWarp.size >= MAX_CACHED_EXPANSIONS) ofWarp.clear();
        expansion = new Float32Array(warp.expansion(tile));
        ofWarp.set(key, expansion);
    }
    return expansion;
}

const scratchCenter: [number, number] = [0, 0];

/**
 * @internal
 * What the shaders of a projection that warps mercator tiles onto its plane need to draw one such tile, in the
 * uniforms every projection shares:
 *
 * - `tileMercatorCoords` is the tile's place in the mercator square, as on the globe.
 * - Below the warp's `expansionMinZoom`, `projectionTransition` is 0, the shader computes the warp itself, and
 *   `mainMatrix` takes the 0..1 world plane to clip space.
 * - From that zoom, `projectionTransition` is 1, `fallbackMatrix` followed by `clippingPlane` hold the twenty
 *   coefficients of the tile's expansion, and `mainMatrix` takes an offset from the warp of the tile's center, in
 *   world units, to clip space. The center is placed in double precision here, so that single precision in the
 *   shader only has to carry the offset within the tile.
 * - `clipAntimeridian` names the sides at which line fragments in the tile's buffer are discarded: the antimeridian
 *   for the tiles of the first and last column, past which the world ends, and the top or bottom of the mercator
 *   square for the tiles of the top and bottom row, whose pole caps would show the buffer.
 */
export function getWarpedProjectionData(projectedCamera: MercatorProjectedCamera, overscaledTileID: OverscaledTileID | null, warp: TileWarp): RendererProjectionData {
    const canonical = overscaledTileID ? overscaledTileID.canonical : {x: 0, y: 0, z: 0};
    const tiles = Math.pow(2, canonical.z);
    const worldSize = projectedCamera.worldSize;
    const matrix: Mat4f64 = new Float64Array(16);
    mat4.identity(matrix);

    const data: RendererProjectionData = {
        mainMatrix: null,
        tileMercatorCoords: getMercatorTileCoordinates(overscaledTileID),
        clippingPlane: [0, 0, 0, 0],
        projectionTransition: 0,
        fallbackMatrix: null,
        clipAntimeridian: (canonical.x === 0 || canonical.x === tiles - 1 ? 1 : 0) + (canonical.y === 0 ? 2 : 0) + (canonical.y === tiles - 1 ? 4 : 0),
    };

    if (canonical.z < warp.expansionMinZoom) {
        mat4.scale(matrix, matrix, [worldSize, worldSize, 1]);
        data.fallbackMatrix = createIdentityMat4f32();
    } else {
        const center = warp.warp(canonical, EXTENT / 2, EXTENT / 2, scratchCenter);
        mat4.translate(matrix, matrix, [center[0] * worldSize, center[1] * worldSize, 0]);
        mat4.scale(matrix, matrix, [worldSize, worldSize, 1]);
        const expansion = getExpansion(warp, canonical);
        data.fallbackMatrix = expansion.subarray(0, 16);
        data.clippingPlane = [expansion[16], expansion[17], expansion[18], expansion[19]];
        data.projectionTransition = 1;
    }
    mat4.multiply(matrix, projectedCamera.modelViewProjectionMatrix, matrix);
    data.mainMatrix = new Float32Array(matrix);
    if (overscaledTileID) data.uniformBufferKey = `${overscaledTileID.key}/warped`;
    return data;
}
