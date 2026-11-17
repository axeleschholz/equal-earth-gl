import {beforeEach, describe, expect, test, vi} from 'vitest';
import {beforeMapTest, createMap} from '../../util/test/util.ts';

beforeEach(() => {
    beforeMapTest();
});

describe('a map in equal-earth', () => {
    test('opens at the center and zoom it is given, which mercator would not allow', async () => {
        const map = createMap({zoom: 0, center: [0, 88], style: {version: 8, sources: {}, layers: [], projection: {type: 'equal-earth'}}});
        expect(map.getCenter().lat).toBeCloseTo(88, 6);
        expect(map.getZoom()).toBe(0);
        await map.once('style.load');
        expect(map.getCenter().lat).toBeCloseTo(88, 6);
        expect(map.getZoom()).toBe(0);
    });

    test('still opens a mercator map inside the mercator world', () => {
        const map = createMap({zoom: 0, center: [0, 88], style: {version: 8, sources: {}, layers: [], projection: {type: 'mercator'}}});
        expect(map.getCenter().lat).toBeLessThan(86);
    });

    test('gives the features of a mercator vector tile source their true positions', async () => {
        const {GeoJSONFeature} = await import('../../util/vectortile_to_geojson.ts');
        const {featureGeometryHelper} = await import('../../source/query_features.ts');
        const {equalEarthWorldCoordinateHelper} = await import('../../geo/projection/equal_earth_world.ts');
        const {mercatorWorldCoordinateHelper} = await import('../../geo/mercator_coordinate.ts');
        expect(featureGeometryHelper(undefined, equalEarthWorldCoordinateHelper)).toBe(mercatorWorldCoordinateHelper);
        expect(featureGeometryHelper('plane', equalEarthWorldCoordinateHelper)).toBe(equalEarthWorldCoordinateHelper);
        expect(featureGeometryHelper(undefined, mercatorWorldCoordinateHelper)).toBe(mercatorWorldCoordinateHelper);
        const Point = (await import('@mapbox/point-geometry')).default;
        const tileFeature = {type: 1, extent: 8192, properties: {}, loadGeometry: () => [[new Point(4096, 4096)]]} as any;
        const feature = new GeoJSONFeature(tileFeature, 2, 2, 1, 1, featureGeometryHelper(undefined, equalEarthWorldCoordinateHelper));
        const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
        expect(lng).toBeCloseTo(45, 6);
        expect(lat).toBeCloseTo(40.979898, 4);
    });

    test('answers a rendered query on a mercator tile source with nothing and a warning, rather than with features from elsewhere', async () => {
        const {queryRenderedFeatures} = await import('../../source/query_features.ts');
        const {equalEarthWorldCoordinateHelper} = await import('../../geo/projection/equal_earth_world.ts');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const tilesIn = vi.fn(() => []);
        const tileManager = {id: 'tiles', getSource: () => ({tileGrid: undefined}), tilesIn} as any;
        const map = createMap();
        const result = queryRenderedFeatures(tileManager, {}, {}, [], undefined, map.painter ? (map as any)._camera?.projectedCamera ?? (map as any).transform : undefined, equalEarthWorldCoordinateHelper, undefined);
        expect(result).toEqual({});
        expect(tilesIn).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('queryRenderedFeatures'));
        warn.mockRestore();
    });
});
