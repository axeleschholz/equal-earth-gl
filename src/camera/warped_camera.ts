import {resolveTileGrid, type TileGrid} from '../geo/projection/tile_warp.ts';

import type {MercatorProjectedCamera, ProjectedCamera} from './projected_camera.ts';
import type {WorldCoordinateHelper} from '../geo/world_types.ts';

/** The warped camera of each camera that was asked for one; a camera is never written to, so neither is its copy. */
const warpedCameras = new WeakMap<ProjectedCamera, MercatorProjectedCamera>();

/**
 * @internal
 * The camera that the tiles of a source are projected with on the CPU. On a plane that mercator tiles are warped
 * onto, a source of such tiles gets a copy of the camera that carries the warp, see
 * {@link MercatorProjectedCamera.tileWarp}, so that a position in one of its tiles is projected to where the
 * shaders draw it. Any other source, and every source on any other plane, gets the camera itself.
 *
 * @param ownTileGrid - the grid of the source's tiles when it has its own, see `Source.tileGrid`
 */
export function withTileWarp<C extends ProjectedCamera>(camera: C, worldCoordinateHelper: WorldCoordinateHelper, ownTileGrid: TileGrid | undefined): C {
    const warp = worldCoordinateHelper.mercatorTileWarp;
    if (!warp || camera.projection !== 'mercator' || resolveTileGrid(ownTileGrid, worldCoordinateHelper) !== 'mercator') return camera;
    let warped = warpedCameras.get(camera);
    if (!warped) {
        warped = {...(camera), tileWarp: warp};
        warpedCameras.set(camera, warped);
    }
    return warped as C;
}

/**
 * @internal
 * Whether a camera carries a tile warp, see {@link withTileWarp}. What is drawn with such a camera faces the
 * screen instead of lying on the map, since lying on the map would give it the stretch and shear of the warp.
 */
export function hasTileWarp(camera: ProjectedCamera): boolean {
    return camera.projection === 'mercator' && camera.tileWarp !== undefined;
}
