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

    test('queries the tiles of a mercator tile source with the camera that carries the warp', async () => {
        const {queryRenderedFeatures} = await import('../../source/query_features.ts');
        const {equalEarthWorldCoordinateHelper} = await import('../../geo/projection/equal_earth_world.ts');
        const {mercatorWorldCoordinateHelper} = await import('../../geo/mercator_coordinate.ts');
        const {createTestCamera} = await import('../../util/test/util.ts');
        const {hasTileWarp} = await import('../../camera/warped_camera.ts');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const queried = vi.fn(() => ({}));
        const tile = {queryRenderedFeatures: queried};
        const tileID = {wrapped: () => ({key: 'k'}), overscaledZ: 0, canonical: {x: 0, y: 0}, wrap: 0};
        const tileManager = {id: 'tiles', getSource: () => ({tileGrid: undefined}), getState: () => ({}), tilesIn: () => [{tile, tileID, queryGeometry: [], cameraQueryGeometry: [], scale: 1}]} as any;
        const {projectedCamera} = createTestCamera({width: 512, height: 512}, {projection: 'mercator', worldCoordinateHelper: equalEarthWorldCoordinateHelper});
        queryRenderedFeatures(tileManager, {}, {}, [], undefined, projectedCamera, equalEarthWorldCoordinateHelper, undefined);
        expect(queried).toHaveBeenCalledTimes(1);
        const args = queried.mock.calls[0] as any[];
        expect(hasTileWarp(args[7])).toBe(true);
        expect(args[8]).toBe(mercatorWorldCoordinateHelper);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
