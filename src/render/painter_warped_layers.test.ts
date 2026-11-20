import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {Painter} from './painter.ts';
import {createNullGL} from '../util/test/null_gl.ts';
import {createTestCamera} from '../util/test/util.ts';
import {equalEarthWorldCoordinateHelper} from '../geo/projection/equal_earth_world.ts';
import {mercatorWorldCoordinateHelper} from '../geo/mercator_coordinate.ts';

import type {WorldCoordinateHelper} from '../geo/world_types.ts';
import type {TileGrid} from '../geo/projection/tile_warp.ts';

const DRAW_NAMES = {
    'symbol': 'symbol', 'circle': 'circle', 'heatmap': 'heatmap', 'hillshade': 'hillshade', 'color-relief': 'colorRelief',
    'fill-extrusion': 'fillExtrusion', 'fill': 'fill', 'line': 'line', 'raster': 'raster', 'background': 'background',
} as const;

type LayerType = keyof typeof DRAW_NAMES;

describe('layers on warped tiles', () => {
    let painter: Painter;
    let warn: ReturnType<typeof vi.spyOn>;
    let drawn: string[];

    beforeEach(() => {
        painter = new Painter(createNullGL());
        drawn = [];
        for (const name of Object.values(DRAW_NAMES)) {
            vi.spyOn(painter.drawFunctions, name).mockImplementation((() => { drawn.push(name); }));
        }
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => vi.restoreAllMocks());

    function render(type: LayerType, worldCoordinateHelper: WorldCoordinateHelper, sourceTileGrid?: TileGrid, id = `${type}-layer`) {
        const layer = {type, id, source: 'source', isHidden: () => false} as any;
        const tileManager = {getSource: () => ({tileGrid: sourceTileGrid})} as any;
        const frameRenderContext = {projectedCamera: createTestCamera().projectedCamera, worldCoordinateHelper} as any;
        painter.renderLayer(painter, tileManager, layer, [{} as any], frameRenderContext);
    }

    test('every layer type is drawn on the equal-earth plane, without a warning', () => {
        const types = Object.keys(DRAW_NAMES) as LayerType[];
        for (const type of types) render(type, equalEarthWorldCoordinateHelper);
        expect(drawn).toEqual(types.map(type => DRAW_NAMES[type]));
        expect(warn).not.toHaveBeenCalled();
    });

    test('are drawn on mercator', () => {
        for (const type of ['symbol', 'circle', 'heatmap', 'hillshade', 'color-relief', 'fill-extrusion'] as LayerType[]) render(type, mercatorWorldCoordinateHelper);
        expect(drawn).toEqual(['symbol', 'circle', 'heatmap', 'hillshade', 'colorRelief', 'fillExtrusion']);
        expect(warn).not.toHaveBeenCalled();
    });
});
