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

describe('layers a projection does not draw on warped tiles yet', () => {
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

    test('are skipped on the equal-earth plane with one warning per type', () => {
        const skipped: LayerType[] = ['symbol', 'circle', 'heatmap', 'hillshade', 'color-relief', 'fill-extrusion'];
        for (const type of skipped) {
            render(type, equalEarthWorldCoordinateHelper);
            render(type, equalEarthWorldCoordinateHelper, undefined, `${type}-second-layer`);
        }
        expect(drawn).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(6);
        expect(warn.mock.calls[0][0]).toContain('symbol layers on tile sources are not yet drawn in the equal-earth projection');
    });

    test('leave fill, line, raster and background layers drawn on the equal-earth plane', () => {
        for (const type of ['fill', 'line', 'raster', 'background'] as LayerType[]) render(type, equalEarthWorldCoordinateHelper);
        expect(drawn).toEqual(['fill', 'line', 'raster', 'background']);
        expect(warn).not.toHaveBeenCalled();
    });

    test('are drawn for a source whose tiles are cut in the plane\'s own grid', () => {
        render('symbol', equalEarthWorldCoordinateHelper, 'plane');
        render('circle', equalEarthWorldCoordinateHelper, 'plane');
        expect(drawn).toEqual(['symbol', 'circle']);
        expect(warn).not.toHaveBeenCalled();
    });

    test('are drawn on mercator', () => {
        for (const type of ['symbol', 'circle', 'heatmap', 'hillshade', 'color-relief', 'fill-extrusion'] as LayerType[]) render(type, mercatorWorldCoordinateHelper);
        expect(drawn).toEqual(['symbol', 'circle', 'heatmap', 'hillshade', 'colorRelief', 'fillExtrusion']);
        expect(warn).not.toHaveBeenCalled();
    });
});
