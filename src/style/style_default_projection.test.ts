import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {Style} from './style.ts';
import {StubMap} from '../util/test/util.ts';
import {getDefaultProjection, setDefaultProjection} from '../geo/projection/default_projection.ts';

import type {StyleSpecification} from '@maplibre/maplibre-gl-style-spec';

async function loadStyle(properties: Partial<StyleSpecification> = {}): Promise<Style> {
    const map = new StubMap() as any;
    const style = new Style(map);
    map.style = style;
    style.loadJSON({version: 8, sources: {}, layers: [], ...properties});
    await style.once('style.load');
    return style;
}

describe('a style drawn in the default projection', () => {
    let before: ReturnType<typeof getDefaultProjection>;
    beforeEach(() => {
        before = getDefaultProjection();
        setDefaultProjection('equal-earth');
    });
    afterEach(() => setDefaultProjection(before));

    test('is in equal-earth when it names no projection', async () => {
        const style = await loadStyle();
        expect(style.projection.name).toBe('equal-earth');
        expect(style.projection.worldCoordinateHelper.name).toBe('equal-earth');
        expect(style.serialize().projection).toBeUndefined();
    });

    test('is in the projection it names', async () => {
        const style = await loadStyle({projection: {type: 'mercator'}});
        expect(style.projection.name).toBe('mercator');
    });

    test('returns to the default when its projection is unset', async () => {
        const style = await loadStyle({projection: {type: 'mercator'}});
        style.setProjection(undefined);
        expect(style.projection.name).toBe('equal-earth');
        style.setProjection({type: 'mercator'});
        expect(style.projection.name).toBe('mercator');
    });

    test('accepts equal-earth by name without a validation error', async () => {
        const map = new StubMap() as any;
        const style = new Style(map);
        map.style = style;
        const errors: unknown[] = [];
        style.on('error', (e) => errors.push(e));
        style.loadJSON({version: 8, sources: {}, layers: [], projection: {type: 'equal-earth'}});
        await style.once('style.load');
        expect(errors).toEqual([]);
        expect(style.projection.name).toBe('equal-earth');
        style.setProjection({type: 'mercator'});
        style.setProjection({type: 'equal-earth'});
        expect(errors).toEqual([]);
        expect(style.projection.name).toBe('equal-earth');
    });

    test('follows a default of mercator', async () => {
        setDefaultProjection('mercator');
        const style = await loadStyle();
        expect(style.projection.name).toBe('mercator');
    });

    test('drops the tiles of a source that tiles its data again for the new projection, and reloads those of the others', async () => {
        const style = await loadStyle({projection: {type: 'mercator'}, sources: {
            geojson: {type: 'geojson', data: {type: 'FeatureCollection', features: []}},
            vector: {type: 'vector', tiles: ['http://example.com/{z}/{x}/{y}.pbf']},
        }});
        const geojson = style.tileManagers['geojson'];
        const vector = style.tileManagers['vector'];
        const onProjectionChange = vi.spyOn(geojson.getSource() as any, 'onProjectionChange');
        const spies = {
            geojsonClear: vi.spyOn(geojson, 'clearTiles'), geojsonReload: vi.spyOn(geojson, 'reload'),
            vectorClear: vi.spyOn(vector, 'clearTiles'), vectorReload: vi.spyOn(vector, 'reload'),
        };
        style.setProjection({type: 'equal-earth'});
        expect(onProjectionChange).toHaveBeenCalledTimes(1);
        expect(spies.geojsonClear).toHaveBeenCalledTimes(1);
        expect(spies.geojsonReload).not.toHaveBeenCalled();
        expect(spies.vectorReload).toHaveBeenCalledTimes(1);
        expect(spies.vectorClear).not.toHaveBeenCalled();

        style.setProjection({type: 'equal-earth'});
        expect(onProjectionChange).toHaveBeenCalledTimes(1);
    });
});
