import {MercatorCoveringTilesDetailsProvider} from './mercator_covering_tiles_details_provider.ts';
import {GlobeCoveringTilesDetailsProvider} from './globe_covering_tiles_details_provider.ts';
import {WarpedCoveringTilesDetailsProvider} from './warped_covering_tiles_details_provider.ts';
import {renderedProjectedCamera} from '../../camera/projected_camera.ts';

import type {CoveringTilesDetailsProvider} from './covering_tiles_details_provider.ts';
import type {ProjectedCamera} from '../../camera/projected_camera.ts';
import type {WorldCoordinateHelper} from '../world_types.ts';
import type {TileGrid, TileWarp} from './tile_warp.ts';

/** The mercator provider. Neither provider holds anything of a map's, so one of each serves every map. */
let mercatorProvider: MercatorCoveringTilesDetailsProvider | null = null;

/** The globe provider, see {@link mercatorProvider}. */
let globeProvider: GlobeCoveringTilesDetailsProvider | null = null;

/** The provider of each tile warp, which holds nothing of a map's either. */
const warpedProviders = new WeakMap<TileWarp, WarpedCoveringTilesDetailsProvider>();

/**
 * @internal
 * Returns the covering tiles details of the projection a camera is drawn with: mercator, or the globe while it renders
 * as a globe. On a flat plane that mercator tiles are warped onto, tiles of the mercator grid get the details of
 * that warp; this takes the plane's world mapping and the grid of the tiles, which default to mercator's.
 */
export function getCoveringTilesDetailsProvider(projectedCamera: ProjectedCamera, worldCoordinateHelper?: WorldCoordinateHelper, tileGrid?: TileGrid): CoveringTilesDetailsProvider {
    if (renderedProjectedCamera(projectedCamera).projection === 'mercator') {
        const warp = worldCoordinateHelper?.mercatorTileWarp;
        if (warp && (tileGrid ?? worldCoordinateHelper.sourceTileGrid) === 'mercator') {
            let provider = warpedProviders.get(warp);
            if (!provider) {
                provider = new WarpedCoveringTilesDetailsProvider(warp);
                warpedProviders.set(warp, provider);
            }
            return provider;
        }
        mercatorProvider ??= new MercatorCoveringTilesDetailsProvider();
        return mercatorProvider;
    }
    globeProvider ??= new GlobeCoveringTilesDetailsProvider();
    return globeProvider;
}
