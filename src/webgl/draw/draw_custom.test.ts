import {describe, test, expect, vi} from 'vitest';
import {OverscaledTileID} from '../../tile/tile_id.ts';
import {TileManager} from '../../tile/tile_manager.ts';
import {Tile} from '../../tile/tile.ts';
import {Painter} from '../../render/painter.ts';
import {FrameRenderContext} from '../../render/frame_render_context.ts';
import {drawCustom} from './draw_custom.ts';
import {CustomStyleLayer} from '../../style/style_layer/custom_style_layer.ts';
import {projectCamera} from '../../camera/project_camera.ts';
import {setMaxPitch, setMinPitch} from '../../camera/camera_updates.ts';
import {expectToBeCloseToArray, createFrameRenderData, createTestCamera} from '../../util/test/util.ts';

import type {CustomRenderMethodInput} from '../../style/style_layer/custom_style_layer.ts';
import type {Map} from '../../ui/map.ts';

vi.mock(import('../../render/painter'));
vi.mock(import('../program'));
vi.mock(import('../../tile/tile_manager'));
vi.mock(import('../../tile/tile'));
vi.mock(import('../../data/bucket/symbol_bucket'), () => {
    return {
        SymbolBucket: vi.fn()
    };
});
vi.mock(import('../../symbol/projection'));

describe('drawCustom', () => {
    test('should return custom render method inputs', () => {
        // same camera setup as in mercator_camera_math.test.ts, so its matrices should be the same
        const {state: view, context} = createTestCamera({minZoom: 0, maxZoom: 22, minPitch: 0, maxPitch: 60, renderWorldCopies: true, width: 500, height: 500});
        const projectedCamera = projectCamera(setMaxPitch(setMinPitch(view, 10), 10), context);
        const mockPainter = new Painter(null);
        mockPainter.context = {
            gl: {},
            setCustomLayerDefaults: () => {},
            setColorMode: () => {},
            setStencilMode: () => {},
            setDepthMode: () => {},
            setDirty: () => {},
            bindFramebuffer: {
                set: () => {}
            }
        } as any;
        const frameRenderContext = new FrameRenderContext({projectedCamera, worldCoordinateHelper: context.worldCoordinateHelper, terrain: null, data: createFrameRenderData(), context: mockPainter.context, programCache: null, currentPass: 'translucent', projection: null});

        const tileId = new OverscaledTileID(1, 0, 1, 0, 0);
        const tile = new Tile(tileId, 256);
        tile.tileID = tileId;
        tile.imageAtlasTexture = {
            bind: () => { }
        } as any;
        const tileManagerMock = new TileManager(null, null, null);
        (vi.mocked(tileManagerMock.getTile)).mockReturnValue(tile);
        tileManagerMock.map = {showCollisionBoxes: false} as any as Map;

        let result: {
            gl: WebGLRenderingContext | WebGL2RenderingContext;
            args: CustomRenderMethodInput;
        };
        const mockLayer = new CustomStyleLayer({
            id: 'custom-layer',
            type: 'custom',
            render(gl, args) {
                result = {
                    gl,
                    args
                };
            },
        }, {});
        drawCustom(mockPainter, tileManagerMock, mockLayer, [tileId], frameRenderContext);
        expect(result.gl).toBeDefined();
        expect(result.args.farZ).toBeCloseTo(804.8028169246645, 6);
        expect(result.args.farZ).toBe(projectedCamera.farZ);
        expect(result.args.nearZ).toBe(projectedCamera.nearZ);
        expect(result.args.fov).toBe(projectedCamera.fov * Math.PI / 180);
        expect(result.args.modelViewProjectionMatrix).toEqual(projectedCamera.modelViewProjectionMatrix);
        expect(result.args.projectionMatrix).toEqual(projectedCamera.projectionMatrix);
        expectToBeCloseToArray(result.args.defaultProjectionData.tileMercatorCoords, [0, 0, 1, 1]);
        expect(result.args.defaultProjectionData.mainMatrix).toBeInstanceOf(Float64Array);
        expect(result.args.defaultProjectionData.fallbackMatrix).toBeInstanceOf(Float64Array);
        expect(result.args.defaultProjectionData.mainMatrix[0]).toBe(1536);
        expect(result.args.defaultProjectionData.mainMatrix[5]).toBe(-1512.6647086267515);
        expect(result.args.defaultProjectionData.mainMatrix[15]).toEqual(794.4539334827342);
        expect(result.args.defaultProjectionData.projectionTransition).toBe(0);
        expect(result.args.defaultProjectionData.mainMatrix).toEqual(result.args.defaultProjectionData.fallbackMatrix);
        const tileProjectionData = result.args.getProjectionData({
            tileID: {
                wrap: 1,
                canonical: {
                    z: 1,
                    x: 1,
                    y: 0,
                }
            }
        });
        expectToBeCloseToArray(tileProjectionData.tileMercatorCoords, [0.5, 0, 0.00006103515625, 0.00006103515625]);
        expect(tileProjectionData.mainMatrix).toBeInstanceOf(Float32Array);
        expect(tileProjectionData.fallbackMatrix).toBeInstanceOf(Float32Array);
        expect(tileProjectionData.mainMatrix[0]).toBeCloseTo(0.09375, 6);
        expect(tileProjectionData.mainMatrix[5]).toBeCloseTo(-0.09232572466135025, 6);
        expect(tileProjectionData.mainMatrix[15]).toBeCloseTo(794.4539184570312, 6);
        expect(tileProjectionData.projectionTransition).toBe(0);
        expect(tileProjectionData.mainMatrix).toEqual(tileProjectionData.fallbackMatrix);
    });

    test('gives a layer on a plane that mercator tiles are warped onto the warp\'s data, for the world and for a tile', async () => {
        const {equalEarthWorldCoordinateHelper: helper} = await import('../../geo/projection/equal_earth_world.ts');
        const {getWarpedProjectionData} = await import('../../geo/projection/warped_projection_data.ts');
        const {shaders} = await import('../../shaders/shaders.ts');
        const {projectedCamera} = createTestCamera({width: 500, height: 500, zoom: 3, center: [20, 30]}, {projection: 'mercator', worldCoordinateHelper: helper});
        const mockPainter = new Painter(null);
        mockPainter.context = {gl: {}, setCustomLayerDefaults: () => {}, setColorMode: () => {}, setStencilMode: () => {}, setDepthMode: () => {}, setDirty: () => {}, bindFramebuffer: {set: () => {}}} as any;
        const data = {...createFrameRenderData(), projectionShaderVariant: {name: 'equal-earth', define: '#define PROJECTION_EQUAL_EARTH', prelude: shaders.projectionEqualEarth}};
        const frameRenderContext = new FrameRenderContext({projectedCamera, worldCoordinateHelper: helper, terrain: null, data, context: mockPainter.context, programCache: null, currentPass: 'translucent', projection: null});
        let args: CustomRenderMethodInput;
        const layer = new CustomStyleLayer({id: 'custom-layer', type: 'custom', render(_gl, renderArgs) { args = renderArgs; }}, {});
        drawCustom(mockPainter, new TileManager(null, null, null), layer, [], frameRenderContext);

        expect(args.shaderData.variantName).toBe('equal-earth');
        expect(args.shaderData.define).toBe('#define PROJECTION_EQUAL_EARTH');
        const world = getWarpedProjectionData(projectedCamera as any, null, helper.mercatorTileWarp);
        expect(Array.from(args.defaultProjectionData.mainMatrix)).toEqual(Array.from(world.mainMatrix));

        const tileID = new OverscaledTileID(3, 0, 3, 4, 2);
        const forTile = args.getProjectionData({tileID: {canonical: {z: 3, x: 4, y: 2}, wrap: 0}});
        const expected = getWarpedProjectionData(projectedCamera as any, tileID, helper.mercatorTileWarp);
        expect(forTile.projectionTransition).toBe(1);
        expect(Array.from(forTile.mainMatrix)).toEqual(Array.from(expected.mainMatrix));
        expect(Array.from(forTile.fallbackMatrix)).toEqual(Array.from(expected.fallbackMatrix));
        expect(forTile.clippingPlane).toEqual(expected.clippingPlane);
    });
});
