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

describe('hillshade of tiles cut in the Equal Earth grid', () => {
    test('is not scaled by latitude, since a plane tile is the same size at every latitude', async () => {
        const {getTileLatRange} = await import('../../webgl/program/hillshade_program.ts');
        const {equalEarthWorldCoordinateHelper} = await import('../../geo/projection/equal_earth_world.ts');
        const {OverscaledTileID} = await import('../../tile/tile_id.ts');

        expect(getTileLatRange(equalEarthWorldCoordinateHelper, new OverscaledTileID(3, 0, 3, 4, 2), 'plane')).toEqual([0, 0]);
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

describe('terrain on a map in equal-earth', () => {
    /** A style with a DEM source of mercator tiles, or with `tileGrid` of tiles cut in that grid. */
    function demStyle(projection: string, tileGrid?: string): any {
        return {
            version: 8 as const,
            projection: {type: projection as any},
            sources: {dem: {type: 'raster-dem' as const, tiles: ['http://example.com/{z}/{x}/{y}.png'], tileSize: 256, ...(tileGrid ? {tileGrid} : {})}},
            layers: [],
        };
    }

    test('is drawn from a DEM source of mercator tiles, without a warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const map = createMap({style: demStyle('equal-earth')});
        await map.once('style.load');

        map.setTerrain({source: 'dem', exaggeration: 2});

        expect(map.terrain).not.toBeNull();
        expect(map.painter.renderToTexture).toBeTruthy();
        expect(map.getTerrain()).toEqual({source: 'dem', exaggeration: 2});
        expect(warn.mock.calls.filter(call => String(call[0]).includes('Terrain'))).toHaveLength(0);
        warn.mockRestore();
        map.remove();
    });

    test('comes with a style that carries it', async () => {
        const map = createMap({style: {...demStyle('equal-earth'), terrain: {source: 'dem'}}});
        await map.once('style.load');

        expect(map.terrain).not.toBeNull();
        map.remove();
    });

    test('has GeoJSON tiled in mercator while it is on, and on the plane again when it goes', async () => {
        const map = createMap({style: {...demStyle('equal-earth'), sources: {...demStyle('equal-earth').sources, points: {type: 'geojson', data: {type: 'Point', coordinates: [10, 46]}}}}});
        await map.once('style.load');
        const source = map.getSource('points');
        const clearTiles = vi.spyOn(map.style.tileManagers.points, 'clearTiles');
        expect(source.tileGrid).toBe('plane');

        map.setTerrain({source: 'dem'});
        expect(source.tileGrid).toBeUndefined();
        expect(clearTiles).toHaveBeenCalledTimes(1);

        map.setTerrain(null);
        expect(source.tileGrid).toBe('plane');
        expect(clearTiles).toHaveBeenCalledTimes(2);
        map.remove();
    });

    test('reloads the mercator tile that a change to GeoJSON data touches while it is on', async () => {
        const {OverscaledTileID} = await import('../../tile/tile_id.ts');
        const map = createMap({style: {...demStyle('equal-earth'), sources: {...demStyle('equal-earth').sources, points: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}}}});
        await map.once('style.load');
        map.setTerrain({source: 'dem'});
        const source = map.getSource('points');
        const tile = {tileID: new OverscaledTileID(6, 0, 6, 34, 22), latestFeatureIndex: {}, state: 'loaded'};
        const {LngLatBounds} = await import('../../geo/lng_lat_bounds.ts');

        expect(source.shouldReloadTile(tile as any, {affectedBounds: [new LngLatBounds([14.06, 47.01, 14.06, 47.01])]} as any)).toBe(true);
        map.remove();
    });

    test('does not touch image sources when it is turned on or off on a mercator map', async () => {
        const map = createMap({style: {...demStyle('mercator'), sources: {...demStyle('mercator').sources, image: {type: 'image', url: 'http://example.com/image.png', coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]]}}}});
        await map.once('style.load');
        const setCoordinates = vi.spyOn(map.getSource<any>('image'), 'setCoordinates');

        map.setTerrain({source: 'dem'});
        map.setTerrain(null);

        expect(setCoordinates).not.toHaveBeenCalled();
        map.remove();
    });

    test('leaves out tile sources cut in the Equal Earth grid while it is on', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const {OverscaledTileID} = await import('../../tile/tile_id.ts');
        const map = createMap({style: {...demStyle('equal-earth'), sources: {...demStyle('equal-earth').sources, native: {type: 'vector', tiles: ['http://example.com/{z}/{x}/{y}.pbf'], tileGrid: 'equal-earth'}}}});
        await map.once('style.load');
        const source = map.getSource('native');
        const tileID = new OverscaledTileID(2, 0, 2, 1, 1);
        await vi.waitFor(() => expect(source.loaded()).toBe(true));
        expect(source.hasTile(tileID)).toBe(true);

        map.setTerrain({source: 'dem'});
        expect(source.hasTile(tileID)).toBe(false);

        map.setTerrain(null);
        expect(source.hasTile(tileID)).toBe(true);
        warn.mockRestore();
        map.remove();
    });

    test('is kept off for a DEM source cut in the Equal Earth grid, with one warning, and remembered', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const map = createMap({style: demStyle('equal-earth', 'equal-earth')});
        await map.once('style.load');
        map.setTerrain({source: 'dem', exaggeration: 2});
        map.setTerrain({source: 'dem', exaggeration: 2});
        expect(map.terrain).toBeNull();
        expect(map.painter.renderToTexture).toBeFalsy();
        expect(map.getTerrain()).toEqual({source: 'dem', exaggeration: 2});
        const warnings = warn.mock.calls.filter(call => String(call[0]).includes('cannot be drawn in the equal-earth projection'));
        expect(warnings).toHaveLength(1);
        expect(map.getStyle().terrain).toEqual({source: 'dem', exaggeration: 2});
        warn.mockRestore();
        map.remove();
    });

    test('that was kept off comes on when the map moves to a projection that draws it, and goes off again on the way back', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const map = createMap({style: demStyle('equal-earth', 'equal-earth')});
        await map.once('style.load');
        map.setTerrain({source: 'dem'});
        expect(map.terrain).toBeNull();

        map.setProjection({type: 'mercator'});
        expect(map.terrain).not.toBeNull();
        expect(map.getTerrain()).toEqual({source: 'dem'});

        map.setProjection({type: 'equal-earth'});
        expect(map.terrain).toBeNull();
        expect(map.getTerrain()).toEqual({source: 'dem'});

        map.setTerrain(null);
        map.setProjection({type: 'mercator'});
        expect(map.terrain).toBeNull();
        expect(map.getTerrain()).toBeNull();
        warn.mockRestore();
        map.remove();
    });

    test('is not touched on mercator', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const map = createMap({style: demStyle('mercator')});
        await map.once('style.load');
        map.setTerrain({source: 'dem'});
        expect(map.terrain).not.toBeNull();
        expect(warn.mock.calls.filter(call => String(call[0]).includes('Terrain'))).toHaveLength(0);
        warn.mockRestore();
        map.remove();
    });

    test('reads back as upstream does on mercator: null once removed, unchanged when a request fails', async () => {
        const map = createMap({style: demStyle('mercator')});
        await map.once('style.load');
        expect(map.getTerrain()).toBeNull();
        map.setTerrain({source: 'dem'});
        map.setTerrain(undefined);
        expect(map.getTerrain()).toBeNull();
        map.setTerrain({source: 'dem', exaggeration: 2});
        expect(() => map.setTerrain({source: 'nope'})).toThrow('cannot load terrain');
        expect(map.getTerrain()).toEqual({source: 'dem', exaggeration: 2});
        expect(map.getStyle().terrain).toEqual({source: 'dem', exaggeration: 2});
        map.remove();
    });

    test('does not bring back the terrain of the style before when a new style is set', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const map = createMap({style: {...demStyle('equal-earth', 'equal-earth'), terrain: {source: 'dem', exaggeration: 3}}});
        await map.once('style.load');
        const events: any[] = [];
        map.on('terrain', (e: any) => events.push(e.terrain));
        map.setStyle(demStyle('mercator'), {diff: false});
        await map.once('style.load');
        expect(events.filter(terrain => terrain !== null)).toEqual([]);
        expect(map.terrain).toBeNull();
        expect(map.getTerrain()).toBeNull();
        warn.mockRestore();
        map.remove();
    });

    test('a style that carries terrain of a DEM source cut in the Equal Earth grid loads without it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const map = createMap({style: {...demStyle('equal-earth', 'equal-earth'), terrain: {source: 'dem'}}});
        await map.once('style.load');
        expect(map.terrain).toBeNull();
        expect(map.getTerrain()).toEqual({source: 'dem'});
        warn.mockRestore();
        map.remove();
    });
});

describe('the central meridian of a map in equal-earth', () => {
    test('is taken from the style, and puts that longitude in the middle of the world', async () => {
        const map = createMap({zoom: 0, center: [150, 0], style: {version: 8, sources: {}, layers: [], projection: {'type': 'equal-earth', 'central-meridian': 150}} as any});
        await map.once('style.load');

        expect(map.style.projection.worldCoordinateHelper.centralMeridian).toBe(150);
        expect(map.getProjection()).toEqual({'type': 'equal-earth', 'central-meridian': 150});
        const middle = map.project([150, 0]);
        const nearTheEastEdge = map.project([-31, 0]);
        const nearTheWestEdge = map.project([-29, 0]);
        expect(nearTheEastEdge.x - middle.x).toBeGreaterThan(200);
        expect(middle.x - nearTheWestEdge.x).toBeGreaterThan(200);
    });

    test('changes at runtime: the view stays on its lng/lat, GeoJSON is tiled again and tiles are redrawn', async () => {
        const map = createMap({zoom: 2, center: [170, -20], style: {version: 8, sources: {
            points: {type: 'geojson', data: {type: 'Point', coordinates: [170, -20]}},
        }, layers: [{id: 'points', type: 'circle', source: 'points'}], projection: {type: 'equal-earth'}}});
        await map.once('style.load');
        const source = map.getSource('points');
        const retiled = vi.spyOn(source, 'onProjectionChange');

        map.setProjection({'type': 'equal-earth', 'central-meridian': 180});

        expect(map.style.projection.worldCoordinateHelper.centralMeridian).toBe(180);
        expect(map.getCenter().lng).toBeCloseTo(170, 6);
        expect(map.getCenter().lat).toBeCloseTo(-20, 6);
        expect(retiled).toHaveReturnedWith(true);
        const center = map.project([170, -20]);
        const acrossTheAntimeridian = map.project([-170, -20]);
        expect(acrossTheAntimeridian.x - center.x).toBeGreaterThan(0);
        expect(acrossTheAntimeridian.x - center.x).toBeLessThan(200);
    });

    test('keeps the projection when it is set again with the same central meridian', async () => {
        const map = createMap({zoom: 0, center: [0, 0], style: {version: 8, sources: {}, layers: [], projection: {'type': 'equal-earth', 'central-meridian': 150}} as any});
        await map.once('style.load');
        const projection = map.style.projection;

        map.setProjection({'type': 'equal-earth', 'central-meridian': 150});

        expect(map.style.projection).toBe(projection);
    });

    test('is refused when it is no longitude, and ignored with a warning by another projection', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const map = createMap({zoom: 0, center: [0, 0], style: {version: 8, sources: {}, layers: [], projection: {type: 'equal-earth'}}});
        await map.once('style.load');
        const errors: string[] = [];
        map.on('error', event => errors.push(event.error.message));

        map.setProjection({'type': 'equal-earth', 'central-meridian': 200});
        expect(errors).toEqual(['projection.central-meridian: a number from -180 to 180 expected, 200 found']);
        expect(map.style.projection.worldCoordinateHelper.centralMeridian).toBe(0);

        map.setProjection({'type': 'mercator', 'central-meridian': 150});
        expect(map.style.projection.name).toBe('mercator');
        expect(warn.mock.calls.some(([message]) => String(message).includes('central-meridian'))).toBe(true);
    });
});

