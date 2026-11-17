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

    test('tells its sources when the projection changes', async () => {
        const style = await loadStyle({projection: {type: 'mercator'}, sources: {geojson: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}}});
        const source = style.tileManagers['geojson'].getSource();
        const onProjectionChange = vi.spyOn(source as any, 'onProjectionChange').mockImplementation(() => {});
        style.setProjection({type: 'equal-earth'});
        expect(onProjectionChange).toHaveBeenCalledTimes(1);
        style.setProjection({type: 'equal-earth'});
        expect(onProjectionChange).toHaveBeenCalledTimes(1);
    });
});
