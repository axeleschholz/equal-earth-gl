import {describe, expect, test} from 'vitest';
import {projectGeoJSONAlongPaths} from './geojson_plane_paths.ts';
import {equalEarthWorldCoordinateHelper as helper, getEqualEarthWorldCoordinateHelper} from '../geo/projection/equal_earth_world.ts';
import {latFromMercatorY, mercatorYfromLat} from '../geo/mercator_coordinate.ts';

const TOLERANCE = 1e-7;

function project<T extends GeoJSON.GeoJSON>(data: T): any {
    return projectGeoJSONAlongPaths(data, helper, TOLERANCE);
}

function world(lng: number, lat: number): [number, number] {
    const {x, y} = helper.worldFromLngLat(lng, lat);
    return [x, y];
}

function expectPositionClose(actual: number[], expected: number[]): void {
    expect(actual[0]).toBeCloseTo(expected[0], 9);
    expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe('projectGeoJSONAlongPaths', () => {
    test('projects a point', () => {
        const result = project({type: 'Point', coordinates: [10, 20, 5]});
        expectPositionClose(result.coordinates, world(10, 20));
        expect(result.coordinates[2]).toBe(5);
    });

    test('brings a point past the antimeridian back into the world', () => {
        expectPositionClose(project({type: 'Point', coordinates: [190, 10]}).coordinates, world(-170, 10));
        expectPositionClose(project({type: 'MultiPoint', coordinates: [[-200, 10], [540, 0]]}).coordinates[0], world(160, 10));
    });

    test('leaves a short line with the positions it has', () => {
        const result = project({type: 'LineString', coordinates: [[10, 10], [10.001, 10.001]]});
        expect(result.type).toBe('LineString');
        expect(result.coordinates).toHaveLength(2);
        expectPositionClose(result.coordinates[1], world(10.001, 10.001));
    });

    test('leaves a line along a parallel straight, which it is on the plane', () => {
        const result = project({type: 'LineString', coordinates: [[-170, 40], [170, 40]]});
        expect(result.coordinates).toHaveLength(2);
    });

    test('adds positions to a long line so that it follows its path within the tolerance', () => {
        const result = project({type: 'LineString', coordinates: [[-180, -80], [-180, 80]]});
        expect(result.coordinates.length).toBeGreaterThan(20);
        for (let i = 1; i < result.coordinates.length; i++) {
            const [ax, ay] = result.coordinates[i - 1];
            const [bx, by] = result.coordinates[i];
            const middle = helper.lngLatFromWorld((ax + bx) / 2, (ay + by) / 2);
            const onPath = world(-180, middle.lat);
            expect(Math.hypot(onPath[0] - (ax + bx) / 2, onPath[1] - (ay + by) / 2)).toBeLessThan(4 * TOLERANCE);
        }
        expectPositionClose(result.coordinates[0], world(-180, -80));
        expectPositionClose(result.coordinates[result.coordinates.length - 1], world(-180, 80));
    });

    test('takes a long line along the path that is straight on a mercator map', () => {
        const result = project({type: 'LineString', coordinates: [[0, 0], [90, 60]]});
        const halfway = world(45, latFromMercatorY((mercatorYfromLat(0) + mercatorYfromLat(60)) / 2));
        const nearest = Math.min(...result.coordinates.map((position: number[]) => Math.hypot(position[0] - halfway[0], position[1] - halfway[1])));
        expect(nearest).toBeLessThan(1e-9);
    });

    test('takes a line to a pole along evenly spaced latitudes, where mercator has no path', () => {
        const result = project({type: 'LineString', coordinates: [[20, 80], [20, 90]]});
        expectPositionClose(result.coordinates[result.coordinates.length - 1], world(20, 90));
        for (const position of result.coordinates) {
            expect(Number.isFinite(position[0]) && Number.isFinite(position[1])).toBe(true);
        }
    });

    test('cuts a line where it crosses the antimeridian', () => {
        const result = project({type: 'LineString', coordinates: [[170, 0], [190, 0]]});
        expect(result.type).toBe('MultiLineString');
        expect(result.coordinates).toHaveLength(2);
        expectPositionClose(result.coordinates[0][0], world(170, 0));
        expectPositionClose(result.coordinates[0][result.coordinates[0].length - 1], world(180, 0));
        expectPositionClose(result.coordinates[1][0], world(-180, 0));
        expectPositionClose(result.coordinates[1][result.coordinates[1].length - 1], world(-170, 0));
    });

    test('cuts a line that goes around the world more than once', () => {
        const result = project({type: 'LineString', coordinates: [[-170, 10], [550, 10]]});
        expect(result.type).toBe('MultiLineString');
        expect(result.coordinates).toHaveLength(3);
        for (const piece of result.coordinates) {
            for (const position of piece) {
                expect(position[0]).toBeGreaterThanOrEqual(-1e-12);
                expect(position[0]).toBeLessThanOrEqual(1 + 1e-12);
            }
        }
    });

    test('keeps a line that only touches the antimeridian whole', () => {
        const result = project({type: 'LineString', coordinates: [[170, 0], [180, 5], [175, 10]]});
        expect(result.type).toBe('LineString');
    });

    test('cuts a polygon that crosses the antimeridian in two', () => {
        const fiji: GeoJSON.Polygon = {type: 'Polygon', coordinates: [[[177, -16], [183, -16], [183, -19], [177, -19], [177, -16]]]};
        const result = project(fiji);
        expect(result.type).toBe('MultiPolygon');
        expect(result.coordinates).toHaveLength(2);
        const xs = result.coordinates.map((polygon: number[][][]) => polygon[0].map((position) => position[0]));
        expect(Math.max(...xs[0])).toBeCloseTo(world(180, -16)[0], 6);
        expect(Math.min(...xs[0])).toBeCloseTo(world(177, -19)[0], 6);
        expect(Math.min(...xs[1])).toBeCloseTo(world(-180, -16)[0], 6);
        expect(Math.max(...xs[1])).toBeCloseTo(world(-177, -19)[0], 6);
        for (const polygon of result.coordinates) {
            const ring = polygon[0];
            expect(ring[0]).toEqual(ring[ring.length - 1]);
            expect(ring.length).toBeGreaterThanOrEqual(4);
        }
    });

    test('keeps the holes of a cut polygon with the part they are in', () => {
        const withHole: GeoJSON.Polygon = {type: 'Polygon', coordinates: [
            [[170, -10], [190, -10], [190, 10], [170, 10], [170, -10]],
            [[172, -2], [174, -2], [174, 2], [172, 2], [172, -2]],
        ]};
        const result = project(withHole);
        expect(result.type).toBe('MultiPolygon');
        expect(result.coordinates[0]).toHaveLength(2);
        expect(result.coordinates[1]).toHaveLength(1);
    });

    test('draws the polygon of the whole world along the outline', () => {
        const everything: GeoJSON.Polygon = {type: 'Polygon', coordinates: [[[-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90]]]};
        const result = project(everything);
        expect(result.type).toBe('Polygon');
        const ring: number[][] = result.coordinates[0];
        expect(ring.length).toBeGreaterThan(50);
        const equatorEdge = ring.filter((position) => Math.abs(position[1] - 0.5) < 0.02);
        expect(equatorEdge.length).toBeGreaterThan(0);
        for (const position of equatorEdge) {
            expect(Math.min(position[0], 1 - position[0])).toBeLessThan(0.002);
        }
    });

    test('carries features through with their properties and ids, and does not change the input', () => {
        const input: GeoJSON.FeatureCollection = {type: 'FeatureCollection', features: [
            {type: 'Feature', id: 7, properties: {name: 'a'}, geometry: {type: 'LineString', coordinates: [[170, 0], [190, 0]]}},
            {type: 'Feature', properties: null, geometry: null},
            {type: 'Feature', properties: {}, geometry: {type: 'GeometryCollection', geometries: [{type: 'Point', coordinates: [1, 2]}]}},
        ]};
        const copy = JSON.parse(JSON.stringify(input));
        const result = project(input);
        expect(input).toEqual(copy);
        expect(result.features[0].id).toBe(7);
        expect(result.features[0].properties).toEqual({name: 'a'});
        expect(result.features[0].geometry.type).toBe('MultiLineString');
        expect(result.features[1].geometry).toBeNull();
        expectPositionClose(result.features[2].geometry.geometries[0].coordinates, world(1, 2));
    });

    test('handles multi geometries and empty ones', () => {
        const lines = project({type: 'MultiLineString', coordinates: [[[170, 0], [190, 0]], [[0, 0], [1, 1]], []]});
        expect(lines.type).toBe('MultiLineString');
        expect(lines.coordinates).toHaveLength(3);
        const polygons = project({type: 'MultiPolygon', coordinates: [[[[177, -16], [183, -16], [183, -19], [177, -16]]], [[[0, 0], [1, 0], [1, 1], [0, 0]]]]});
        expect(polygons.coordinates).toHaveLength(3);
    });

    test('leaves out positions that are not finite or lie absurdly far around the world, without hanging', () => {
        const nan = project({type: 'LineString', coordinates: [[NaN, 0], [10, 0], [20, 0]]});
        expect(nan.coordinates).toHaveLength(2);
        const missing = project({type: 'LineString', coordinates: [[10, 0], [undefined, undefined], [20, 0]]} as any);
        expect(missing.type).toBe('LineString');
        expect(missing.coordinates).toHaveLength(2);
        const infinite = project({type: 'Polygon', coordinates: [[[0, 0], [Infinity, 0], [10, 10], [0, 10], [0, 0]]]});
        expect(infinite.type).toBe('Polygon');
        expect(infinite.coordinates[0].length).toBeGreaterThanOrEqual(4);
        const far = project({type: 'LineString', coordinates: [[0, 0], [1e12, 0], [5, 5]]});
        expect(far.type).toBe('LineString');
        expect(far.coordinates.length).toBeLessThan(1000);
        const allBad = project({type: 'LineString', coordinates: [[NaN, NaN], [Infinity, 2]]});
        expect(allBad.coordinates).toEqual([]);
        const point = project({type: 'Point', coordinates: [NaN, 0]});
        expect(point.type).toBe('Point');
    });

    test('leaves a line across the antimeridian whole on a plane centered on it, and cuts one across the plane\'s own edge', () => {
        const pacific = getEqualEarthWorldCoordinateHelper(180);
        const acrossTheAntimeridian: GeoJSON.LineString = {type: 'LineString', coordinates: [[170, 10], [190, 10]]};
        const acrossGreenwich: GeoJSON.LineString = {type: 'LineString', coordinates: [[-10, 0], [10, 0]]};

        const whole = projectGeoJSONAlongPaths(acrossTheAntimeridian, pacific, 1e-4) as GeoJSON.Geometry;
        const cut = projectGeoJSONAlongPaths(acrossGreenwich, pacific, 1e-4) as GeoJSON.Geometry as GeoJSON.MultiLineString;

        expect(whole.type).toBe('LineString');
        const xs = (whole as GeoJSON.LineString).coordinates.map(position => position[0]);
        expect(Math.min(...xs)).toBeGreaterThan(0.45);
        expect(Math.max(...xs)).toBeLessThan(0.55);
        expect(cut.type).toBe('MultiLineString');
        expect(cut.coordinates).toHaveLength(2);
        const ends = cut.coordinates.map(line => line.map(position => position[0]));
        expect(Math.max(...ends[0])).toBeCloseTo(1, 9);
        expect(Math.min(...ends[1])).toBeCloseTo(0, 9);
    });

    test('puts a point where the re-centred plane puts it', () => {
        const pacific = getEqualEarthWorldCoordinateHelper(150);

        const point = projectGeoJSONAlongPaths({type: 'Point', coordinates: [-100, 40]}, pacific, 1e-4);

        const expected = pacific.worldFromLngLat(-100, 40);
        expect(point.coordinates[0]).toBeCloseTo(expected.x, 12);
        expect(point.coordinates[1]).toBeCloseTo(expected.y, 12);
    });
});
