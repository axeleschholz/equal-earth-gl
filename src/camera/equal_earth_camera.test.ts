import {describe, expect, test, vi} from 'vitest';
import {CRSWorldCoordinateHelper, identityCrs} from '../geo/projection/crs.ts';
import Point from '@mapbox/point-geometry';
import {defaultConstrain} from './camera_constrain.ts';
import {getCameraSolver} from './camera_solver_factory.ts';
import {getCameraMath} from './camera_math_factory.ts';
import {projectCamera} from './project_camera.ts';
import {LngLat} from '../geo/lng_lat.ts';
import {createTestCamera} from '../util/test/util.ts';
import {equalEarthWorldCoordinateHelper} from '../geo/projection/equal_earth_world.ts';

function equalEarthCamera(options: Parameters<typeof createTestCamera>[0]) {
    return createTestCamera(options, {projection: 'mercator', worldCoordinateHelper: equalEarthWorldCoordinateHelper});
}

describe('the camera constrain on the equal-earth plane', () => {
    test('keeps a center near the pole', () => {
        const {state, context} = equalEarthCamera({width: 1024, height: 512});
        const result = defaultConstrain(state, context, new LngLat(0, 89.9), 3);
        expect(result.center.lat).toBeCloseTo(89.9, 9);
        expect(result.center.lng).toBeCloseTo(0, 9);
        expect(result.zoom).toBe(3);
    });

    test('takes a center past the antimeridian to be the same place inside the world', () => {
        const {state, context} = equalEarthCamera({width: 1024, height: 512});
        const result = defaultConstrain(state, context, new LngLat(230, 60), 3);
        const helper = context.worldCoordinateHelper;
        const world = helper.worldFromLngLat(result.center.lng, result.center.lat);
        const expected = helper.worldFromLngLat(-130, 60);
        expect(world.x).toBeCloseTo(expected.x, 12);
        expect(world.y).toBeCloseTo(expected.y, 12);
        expect(helper.hasLngLat(world.x, world.y)).toBe(true);
    });

    test('does not ask a registered CRS whether the center has a lng/lat', () => {
        const crsHelper = new CRSWorldCoordinateHelper(identityCrs);
        const hasLngLat = vi.spyOn(crsHelper, 'hasLngLat');
        const {state, context} = createTestCamera({width: 512, height: 512}, {projection: 'mercator', worldCoordinateHelper: crsHelper});
        defaultConstrain(state, context, new LngLat(10, 10), 3);
        expect(hasLngLat).not.toHaveBeenCalled();
    });

    test('leaves the zoom alone when the world is smaller than the viewport', () => {
        const {state, context} = equalEarthCamera({width: 2000, height: 2000});
        expect(defaultConstrain(state, context, new LngLat(0, 0), 0).zoom).toBe(0);
    });
});

describe('screen points outside the world outline on the equal-earth plane', () => {
    test('unproject to a finite position on the outline', () => {
        const {projectedCamera, context} = equalEarthCamera({width: 1024, height: 512, zoom: 0});
        const cameraMath = getCameraMath(projectedCamera);
        for (const point of [new Point(0, 0), new Point(1023, 511), new Point(512, 2), new Point(2, 256)]) {
            const location = cameraMath.screenPointToLocation(projectedCamera, context.worldCoordinateHelper, point);
            expect(Number.isFinite(location.lng)).toBe(true);
            expect(Number.isFinite(location.lat)).toBe(true);
            expect(Math.abs(location.lng)).toBeLessThanOrEqual(180);
            expect(Math.abs(location.lat)).toBeLessThanOrEqual(90);
        }
    });

    test('are not on the map surface, so a drag or zoom that starts there has nothing to hold on to', () => {
        const {projectedCamera, context} = equalEarthCamera({width: 1024, height: 512, zoom: 0});
        const cameraMath = getCameraMath(projectedCamera);
        const helper = context.worldCoordinateHelper;
        expect(cameraMath.isPointOnMapSurface(projectedCamera, helper, new Point(512, 256))).toBe(true);
        expect(cameraMath.isPointOnMapSurface(projectedCamera, helper, new Point(1, 1))).toBe(false);
        expect(cameraMath.isPointOnMapSurface(projectedCamera, helper, new Point(1022, 510))).toBe(false);
        expect(cameraMath.isPointOnMapSurface(projectedCamera, helper, new Point(512, 1))).toBe(false);
    });

    test('dragging a position on the map keeps it under the pointer', () => {
        const {state, context} = equalEarthCamera({width: 1024, height: 512, zoom: 0});
        const projectedCamera = projectCamera(state, context);
        const cameraMath = getCameraMath(projectedCamera);
        const from = new Point(300, 200);
        const to = new Point(350, 230);
        const location = cameraMath.screenPointToLocation(projectedCamera, context.worldCoordinateHelper, from);
        const moved = getCameraSolver(context).setLocationAtPoint(state, context, location, to);
        const movedCamera = projectCamera(moved, context);
        const under = getCameraMath(movedCamera).screenPointToLocation(movedCamera, context.worldCoordinateHelper, to);
        expect(under.lng).toBeCloseTo(location.lng, 6);
        expect(under.lat).toBeCloseTo(location.lat, 6);
    });
});
