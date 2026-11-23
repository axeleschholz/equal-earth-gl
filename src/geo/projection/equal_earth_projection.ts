import {SubdivisionGranularityExpression, SubdivisionGranularitySetting} from '../../render/subdivision_granularity_settings.ts';
import {type PreparedShader, shaders} from '../../shaders/shaders.ts';
import {createTileMeshWithBuffers, type CreateTileMeshOptions} from '../../util/create_tile_mesh.ts';
import {getEqualEarthWorldCoordinateHelper} from './equal_earth_world.ts';

import type {Mesh} from '../../render/mesh.ts';
import type {Projection, TileMeshUsage} from './projection.ts';
import type {CanonicalTileID} from '../../tile/tile_id.ts';
import type {Context} from '../../webgl/context.ts';
import type {WorldCoordinateHelper} from '../world_types.ts';

export const EqualEarthShaderDefine = '#define PROJECTION_EQUAL_EARTH';
export const EqualEarthShaderVariantKey = 'equal-earth';

/**
 * How finely geometry is subdivided so that edges that are straight in a mercator tile follow the curve the warp
 * gives them. Stencil granularity must never be higher than fill granularity, or the two leave gaps between them.
 */
const granularitySettingsEqualEarth: SubdivisionGranularitySetting = new SubdivisionGranularitySetting({
    fill: new SubdivisionGranularityExpression(128, 2),
    line: new SubdivisionGranularityExpression(512, 0),
    tile: new SubdivisionGranularityExpression(128, 32),
    stencil: new SubdivisionGranularityExpression(128, 1),
    circle: 3
});

/**
 * What the map's projection takes beyond the style specification.
 */
export type CentralMeridianProjectionOption = {
    /**
     * The longitude drawn down the middle of the world in the `equal-earth` projection, from -180 to 180. The world
     * ends at the meridian opposite it. Other projections do not use it.
     * @defaultValue 0
     */
    'central-meridian'?: number;
};

/**
 * The Equal Earth projection: a flat map of the whole world on which areas keep their proportions. Its plane is
 * its own, see {@link getEqualEarthWorldCoordinateHelper}, and the flat camera runs on it. Tiles of the mercator grid
 * are warped onto that plane by its shaders, from subdivided meshes whose top and bottom rows reach the poles.
 */
export class EqualEarthProjection implements Projection {
    private _tileMeshCache: {[_: string]: Mesh} = {};
    private readonly _worldCoordinateHelper: WorldCoordinateHelper;

    /**
     * @param centralMeridian - the longitude drawn down the middle of the world, -180 to 180
     */
    constructor(centralMeridian: number = 0) {
        this._worldCoordinateHelper = getEqualEarthWorldCoordinateHelper(centralMeridian);
    }

    get name(): 'equal-earth' {
        return 'equal-earth';
    }

    get worldCoordinateHelper(): WorldCoordinateHelper {
        return this._worldCoordinateHelper;
    }

    get transitionState(): number {
        return 0;
    }

    get useSubdivision(): boolean {
        return true;
    }

    get shaderVariantName(): string {
        return EqualEarthShaderVariantKey;
    }

    get shaderDefine(): string {
        return EqualEarthShaderDefine;
    }

    get shaderPreludeCode(): PreparedShader {
        return shaders.projectionEqualEarth;
    }

    get vertexShaderPreludeCode(): string {
        return shaders.projectionEqualEarth.vertexSource;
    }

    get subdivisionGranularity(): SubdivisionGranularitySetting {
        return granularitySettingsEqualEarth;
    }

    destroy(): void {
        for (const key in this._tileMeshCache) {
            this._tileMeshCache[key].destroy();
        }
        this._tileMeshCache = {};
    }

    getMeshFromTileID(context: Context, canonical: CanonicalTileID, hasBorder: boolean, allowPoles: boolean, usage: TileMeshUsage): Mesh {
        const granularityConfig = usage === 'stencil' ? granularitySettingsEqualEarth.stencil : granularitySettingsEqualEarth.tile;
        const options: CreateTileMeshOptions = {
            granularity: granularityConfig.getGranularityForZoomLevel(canonical.z),
            generateBorders: hasBorder,
            extendToNorthPole: (canonical.y === 0) && allowPoles,
            extendToSouthPole: (canonical.y === (1 << canonical.z) - 1) && allowPoles,
        };
        const key = `${options.granularity.toString(36)}_${options.generateBorders ? 'b' : ''}${options.extendToNorthPole ? 'n' : ''}${options.extendToSouthPole ? 's' : ''}`;
        this._tileMeshCache[key] ??= createTileMeshWithBuffers(context, options);
        return this._tileMeshCache[key];
    }

    recalculate(): void {
        // Nothing depends on the evaluation parameters.
    }

    hasTransition(): boolean {
        return false;
    }
}
