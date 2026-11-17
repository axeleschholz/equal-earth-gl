import {describe, expect, test} from 'vitest';
import {equalEarthTileMatrixSet, equalEarthWorldCoordinateHelper as helper} from './equal_earth_world.ts';
import {mercatorWorldCoordinateHelper} from '../mercator_coordinate.ts';
import {CRSWorldCoordinateHelper, identityCrs} from './crs.ts';
import {LngLat} from '../lng_lat.ts';

const WORLD_WIDTH = 34487918.12;
const NORTH_POLE_Y = 0.5 - 8392927.60 / WORLD_WIDTH;

describe('EqualEarthWorldCoordinateHelper', () => {
    test('is named equal-earth and does not wrap', () => {
        expect(helper.name).toBe('equal-earth');
        expect(helper.wraps).toBe(false);
    });

    test('puts the world in a square as wide as the projection, centered on 0, 0', () => {
        expect(equalEarthTileMatrixSet.extentAtZoom0).toBeCloseTo(WORLD_WIDTH, 1);
        expect(equalEarthTileMatrixSet.origin[0]).toBeCloseTo(-WORLD_WIDTH / 2, 1);
        expect(equalEarthTileMatrixSet.origin[1]).toBeCloseTo(WORLD_WIDTH / 2, 1);
        expect(helper.tileMatrixSet).toBe(equalEarthTileMatrixSet);
    });

    test('maps lng/lat to the world square', () => {
        const center = helper.worldFromLngLat(0, 0);
        expect(center.x).toBeCloseTo(0.5, 12);
        expect(center.y).toBeCloseTo(0.5, 12);
        expect(center.z).toBe(0);
        expect(helper.worldFromLngLat(180, 0).x).toBeCloseTo(1, 12);
        expect(helper.worldFromLngLat(-180, 0).x).toBeCloseTo(0, 12);
        expect(helper.worldFromLngLat(0, 90).y).toBeCloseTo(NORTH_POLE_Y, 9);
    });

    test('scales altitude by the constant meters per world unit', () => {
        expect(helper.metersPerWorldUnit(0.5, 0.5)).toBeCloseTo(WORLD_WIDTH, 1);
        expect(helper.metersPerWorldUnit(0.1, 0.3)).toBe(helper.metersPerWorldUnit(0.5, 0.5));
        expect(helper.worldFromLngLat(10, 20, 1000).z).toBeCloseTo(1000 / WORLD_WIDTH, 12);
        expect(helper.worldZFromAltitude(1000, new LngLat(10, 20))).toBeCloseTo(1000 / WORLD_WIDTH, 12);
    });

    test('takes world positions back to lng/lat', () => {
        for (const [lng, lat] of [[0, 0], [-122.4, 37.8], [151.2, -33.9], [179.9, 84], [-45, -89]]) {
            const world = helper.worldFromLngLat(lng, lat);
            const back = helper.lngLatFromWorld(world.x, world.y);
            expect(back.lng).toBeCloseTo(lng, 9);
            expect(back.lat).toBeCloseTo(lat, 9);
        }
    });

    test('has no lng/lat outside the world outline', () => {
        expect(helper.hasLngLat(0.5, 0.5)).toBe(true);
        expect(helper.hasLngLat(0.01, 0.3)).toBe(false);
        expect(helper.hasLngLat(0.5, 0.1)).toBe(false);
        expect(helper.hasLngLat(1.2, 0.5)).toBe(false);
    });

    test('answers a position outside the outline with the nearest one on it at the same height', () => {
        const edge = helper.lngLatFromWorld(0.01, 0.3);
        expect(edge.lng).toBeCloseTo(-180, 6);
        expect(helper.worldFromLngLat(edge.lng, edge.lat).y).toBeCloseTo(0.3, 9);

        const pole = helper.lngLatFromWorld(0.5, 0.05);
        expect(pole.lat).toBeCloseTo(90, 6);
        expect(pole.lng).toBeCloseTo(0, 6);

        const corner = helper.lngLatFromWorld(-3, 7);
        expect(corner.lng).toBeCloseTo(-180, 6);
        expect(corner.lat).toBeCloseTo(-90, 6);
    });

    test('brings a longitude past the antimeridian back into the world, and keeps the antimeridian on its own edge', () => {
        const wrapped = helper.worldFromLngLat(200, 20);
        const direct = helper.worldFromLngLat(-160, 20);
        expect(wrapped.x).toBeCloseTo(direct.x, 12);
        expect(wrapped.y).toBeCloseTo(direct.y, 12);
        expect(helper.worldFromLngLat(-190, -5).x).toBeCloseTo(helper.worldFromLngLat(170, -5).x, 12);
        expect(helper.worldFromLngLat(180, 0).x).toBeCloseTo(1, 12);
        expect(helper.worldFromLngLat(-180, 0).x).toBeCloseTo(0, 12);
        expect(helper.hasLngLat(wrapped.x, wrapped.y)).toBe(true);
    });
    test('bounds the world to the band between the poles', () => {
        expect(helper.worldBounds[0]).toBe(0);
        expect(helper.worldBounds[1]).toBeCloseTo(NORTH_POLE_Y, 9);
        expect(helper.worldBounds[2]).toBe(1);
        expect(helper.worldBounds[3]).toBeCloseTo(1 - NORTH_POLE_Y, 9);
    });

    test('takes tile sources to be cut in the mercator grid', () => {
        expect(helper.sourceTileGrid).toBe('mercator');
    });
});

describe('the tile grid and bounds of the other world mappings', () => {
    test('mercator fills its square with mercator tiles', () => {
        expect(mercatorWorldCoordinateHelper.sourceTileGrid).toBe('mercator');
        expect(mercatorWorldCoordinateHelper.worldBounds).toEqual([0, 0, 1, 1]);
    });

    test('a registered CRS fills its square with tiles of its own grid', () => {
        const crsHelper = new CRSWorldCoordinateHelper(identityCrs);
        expect(crsHelper.sourceTileGrid).toBe('plane');
        expect(crsHelper.worldBounds).toEqual([0, 0, 1, 1]);
    });
});
