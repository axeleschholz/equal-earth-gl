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
        const {featureGeometryHelper} = await import('../../geo/projection/tile_warp.ts');
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

describe('queries and shading of mercator tiles in equal-earth', () => {
    test('gives the features of labels their lng/lat from the grid of their tile', async () => {
        const {queryRenderedSymbols} = await import('../../source/query_features.ts');
        const {equalEarthWorldCoordinateHelper} = await import('../../geo/projection/equal_earth_world.ts');
        const {mercatorWorldCoordinateHelper} = await import('../../geo/mercator_coordinate.ts');
        const lookups: any[] = [];
        const featureIndex = {lookupSymbolFeatures: (...args: any[]) => { lookups.push(args[4].worldCoordinateHelper); return {}; }};
        const tileID = {overscaledZ: 0, canonical: {x: 0, y: 0}, wrap: 0};
        const retained = {
            1: {bucketInstanceId: 1, featureIndex, tileID, tileGrid: undefined},
            2: {bucketInstanceId: 2, featureIndex, tileID, tileGrid: 'plane'},
        } as any;
        const collisionIndex = {queryRenderedSymbols: () => ({1: [0], 2: [0]})} as any;
        queryRenderedSymbols({}, {}, {}, [], {} as any, collisionIndex, retained, equalEarthWorldCoordinateHelper);
        expect(lookups).toEqual([mercatorWorldCoordinateHelper, equalEarthWorldCoordinateHelper]);
    });

    test('scales hillshade slopes by the latitudes of the mercator tile', async () => {
        const {getTileLatRange} = await import('../../webgl/program/hillshade_program.ts');
        const {equalEarthWorldCoordinateHelper} = await import('../../geo/projection/equal_earth_world.ts');
        const {mercatorWorldCoordinateHelper} = await import('../../geo/mercator_coordinate.ts');
        const {OverscaledTileID} = await import('../../tile/tile_id.ts');
        for (const [z, x, y] of [[3, 4, 1], [3, 4, 0], [5, 5, 12], [2, 1, 3]]) {
            const tileID = new OverscaledTileID(z, 0, z, x, y);
            const onMercator = getTileLatRange(mercatorWorldCoordinateHelper, tileID);
            const onEqualEarth = getTileLatRange(equalEarthWorldCoordinateHelper, tileID);
            expect(onEqualEarth[0]).toBeCloseTo(onMercator[0], 9);
            expect(onEqualEarth[1]).toBeCloseTo(onMercator[1], 9);
            expect(Math.abs(onEqualEarth[0])).toBeLessThan(86);
        }
    });
});

describe('controls on a map in equal-earth', () => {
    test('the scale control shows the distance across its bar at the middle of the map', async () => {
        const {ScaleControl} = await import('../control/scale_control.ts');
        for (const lat of [0, 60]) {
            const map = createMap({zoom: 4, center: [10, lat], style: {version: 8, sources: {}, layers: [], projection: {type: 'equal-earth'}}});
            await map.once('style.load');
            const control = new ScaleControl({maxWidth: 100});
            map.addControl(control);
            map.jumpTo({center: [10, lat], zoom: 4});
            const text = map.getContainer().querySelector('.maplibregl-ctrl-scale').textContent;
            const shown = parseFloat(text);
            expect(text).toMatch(/km$/);
            const meters = map.unproject([50, 100]).distanceTo(map.unproject([150, 100]));
            expect(shown * 1000).toBeLessThanOrEqual(meters * 1.001);
            expect(shown * 1000).toBeGreaterThan(meters / 2.6);
            expect(Math.abs(map.unproject([50, 100]).lat - lat)).toBeLessThan(1e-6);
            map.remove();
        }
    });

    test('fitBounds puts a country in view', async () => {
        const map = createMap({style: {version: 8, sources: {}, layers: [], projection: {type: 'equal-earth'}}});
        await map.once('style.load');
        map.fitBounds([[-9.5, 36], [3.3, 43.8]], {duration: 0, padding: 10});
        for (const corner of [[-9.5, 36], [3.3, 43.8], [-9.5, 43.8], [3.3, 36]] as Array<[number, number]>) {
            const point = map.project(corner);
            expect(point.x).toBeGreaterThanOrEqual(9);
            expect(point.x).toBeLessThanOrEqual(191);
            expect(point.y).toBeGreaterThanOrEqual(9);
            expect(point.y).toBeLessThanOrEqual(191);
        }
        expect(map.getZoom()).toBeGreaterThan(2);
    });
});
