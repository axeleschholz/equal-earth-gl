import {describe, expect, test, vi} from 'vitest';
import {FrameRenderContext} from './frame_render_context.ts';
import {OverscaledTileID} from '../tile/tile_id.ts';
import {createFrameRenderData, createTestCamera} from '../util/test/util.ts';
import {equalEarthWorldCoordinateHelper} from '../geo/projection/equal_earth_world.ts';
import {EqualEarthShaderVariantKey} from '../geo/projection/equal_earth_projection.ts';
import {MercatorShaderVariantKey} from '../geo/projection/mercator_projection.ts';
import {shaders} from '../shaders/shaders.ts';
import {getCameraMath} from '../camera/camera_math_factory.ts';

function equalEarthFrame() {
    const {projectedCamera} = createTestCamera({width: 512, height: 512, zoom: 4}, {projection: 'mercator', worldCoordinateHelper: equalEarthWorldCoordinateHelper});
    const getProgram = vi.fn((_variant: any) => ({}));
    const data = {...createFrameRenderData(), useSubdivision: true, projectionShaderVariant: {name: EqualEarthShaderVariantKey, define: '#define PROJECTION_EQUAL_EARTH', prelude: shaders.projectionEqualEarth}};
    const frameRenderContext = new FrameRenderContext({projectedCamera, worldCoordinateHelper: equalEarthWorldCoordinateHelper, terrain: null, data, context: null, programCache: {getProgram} as any, currentPass: 'translucent', projection: null});
    return {frameRenderContext, projectedCamera, getProgram};
}

describe('a frame on a plane that mercator tiles are warped onto', () => {
    const tileID = new OverscaledTileID(4, 0, 4, 8, 7);

    test('draws tiles of the mercator grid through their warp', () => {
        const {frameRenderContext, getProgram} = equalEarthFrame();
        const data = frameRenderContext.getProjectionDataForTile(tileID);
        expect(data.projectionTransition).toBe(1);
        expect(data.uniformBufferKey).toBe(`${tileID.key}/warped`);
        frameRenderContext.useProgram('fill');
        expect(getProgram.mock.calls[0][0].projectionShaderVariant.name).toBe(EqualEarthShaderVariantKey);
    });

    test('draws the tiles of a source cut in the plane\'s own grid flat', () => {
        const {frameRenderContext, projectedCamera, getProgram} = equalEarthFrame();
        frameRenderContext.currentTileGrid = 'plane';
        const data = frameRenderContext.getProjectionDataForTile(tileID);
        const flat = getCameraMath(projectedCamera).getProjectionData(projectedCamera, {overscaledTileID: tileID, applyGlobeMatrix: true, applyTerrainMatrix: true});
        expect(data.mainMatrix).toEqual(flat.mainMatrix);
        expect(data.uniformBufferKey).toBe(tileID.key);
        frameRenderContext.useProgram('fill');
        expect(getProgram.mock.calls[0][0].projectionShaderVariant.name).toBe(MercatorShaderVariantKey);
    });

    test('goes back to the warp when the grid is unset', () => {
        const {frameRenderContext, getProgram} = equalEarthFrame();
        frameRenderContext.currentTileGrid = 'plane';
        frameRenderContext.currentTileGrid = undefined;
        expect(frameRenderContext.getProjectionDataForTile(tileID).uniformBufferKey).toBe(`${tileID.key}/warped`);
        frameRenderContext.useProgram('line');
        expect(getProgram.mock.calls[0][0].projectionShaderVariant.name).toBe(EqualEarthShaderVariantKey);
    });

    test('lets a draw name the grid of its tile', () => {
        const {frameRenderContext} = equalEarthFrame();
        expect(frameRenderContext.getProjectionDataForTile(tileID, {tileGrid: 'plane'}).uniformBufferKey).toBe(tileID.key);
    });
});
