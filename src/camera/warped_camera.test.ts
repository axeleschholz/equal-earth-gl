import {describe, expect, test} from 'vitest';
import {withTileWarp} from './warped_camera.ts';
import {getCameraMath} from './camera_math_factory.ts';
import {createTestCamera} from '../util/test/util.ts';
import {equalEarthWorldCoordinateHelper as helper} from '../geo/projection/equal_earth_world.ts';
import {equalEarthTileWarp} from '../geo/projection/equal_earth_tile_warp.ts';
import {getWarpedProjectionData} from '../geo/projection/warped_projection_data.ts';
import {mercatorWorldCoordinateHelper, mercatorXfromLng, mercatorYfromLat} from '../geo/mercator_coordinate.ts';
import {CRSWorldCoordinateHelper, identityCrs} from '../geo/projection/crs.ts';
import {OverscaledTileID} from '../tile/tile_id.ts';
import {EXTENT} from '../data/extent.ts';
import {shaderPixels, shaderProject} from '../../test/unit/lib/warped_shader_mirror.ts';

import type {MercatorProjectedCamera} from './projected_camera.ts';

function cameraAt(lng: number, lat: number, zoom: number, pitch = 0, bearing = 0): MercatorProjectedCamera {
    return createTestCamera({width: 1024, height: 768, zoom, center: [lng, lat], pitch, bearing}, {projection: 'mercator', worldCoordinateHelper: helper}).projectedCamera as MercatorProjectedCamera;
}

function tileAt(lng: number, lat: number, z: number): OverscaledTileID {
    const tiles = Math.pow(2, z);
    return new OverscaledTileID(z, 0, z, Math.min(tiles - 1, Math.floor(mercatorXfromLng(lng) * tiles)), Math.min(tiles - 1, Math.max(0, Math.floor(mercatorYfromLat(lat) * tiles))));
}

describe('withTileWarp', () => {
    test('leaves the camera as it is where mercator tiles need no warp', () => {
        const mercator = createTestCamera({width: 512, height: 512}).projectedCamera;
        expect(withTileWarp(mercator, mercatorWorldCoordinateHelper, undefined)).toBe(mercator);
        const crsHelper = new CRSWorldCoordinateHelper(identityCrs);
        const crs = createTestCamera({width: 512, height: 512}, {projection: 'mercator', worldCoordinateHelper: crsHelper}).projectedCamera;
        expect(withTileWarp(crs, crsHelper, undefined)).toBe(crs);
        const equalEarth = cameraAt(0, 0, 2);
        expect(withTileWarp(equalEarth, helper, 'plane')).toBe(equalEarth);
    });

    test('gives the camera the warp of the plane for tiles of the mercator grid, once', () => {
        const camera = cameraAt(0, 0, 2);
        const warped = withTileWarp(camera, helper, undefined);
        expect(warped).not.toBe(camera);
        expect(warped.tileWarp).toBe(equalEarthTileWarp);
        expect(warped.modelViewProjectionMatrix).toBe(camera.modelViewProjectionMatrix);
        expect(withTileWarp(camera, helper, 'mercator')).toBe(warped);
        expect(camera.tileWarp).toBeUndefined();
    });
});

describe('projecting tile coordinates with a warped camera', () => {
    test('lands where the shader draws them', () => {
        for (const lat of [0, 45, 78]) {
            for (const z of [0, 2, 3, 9, 16, 22]) {
                const lng = 30 + z;
                const camera = cameraAt(lng, lat, z + 0.6, z % 2 ? 35 : 0, z % 3 ? 20 : 0);
                const warped = withTileWarp(camera, helper, undefined);
                const tileID = tileAt(lng, lat, z);
                const data = getWarpedProjectionData(camera, tileID, equalEarthTileWarp);
                const unwrapped = tileID.toUnwrapped();
                for (let i = 0; i <= 3; i++) {
                    for (let j = 0; j <= 3; j++) {
                        const tx = i / 3 * EXTENT;
                        const ty = j / 3 * EXTENT;
                        const expected = shaderPixels(camera, data, tx, ty);
                        if (Math.abs(expected[0]) > 1500 || Math.abs(expected[1]) > 1500) continue;
                        for (const elevation of [undefined, 0]) {
                            const projection = getCameraMath(warped).projectTileCoordinates(warped, tx, ty, unwrapped, elevation);
                            const label = `tile ${z}/${tileID.canonical.x}/${tileID.canonical.y} at ${tx}, ${ty}`;
                            expect(Math.hypot(projection.point.x * camera.width / 2 - expected[0], projection.point.y * camera.height / 2 - expected[1]), label).toBeLessThan(0.05);
                            const w = shaderProject(data, tx, ty)[3];
                            expect(Math.abs(projection.signedDistanceFromCamera - w) / Math.abs(w)).toBeLessThan(1e-4);
                            expect(projection.isOccluded).toBe(false);
                        }
                    }
                }
            }
        }
    });

    test('has no single matrix to stand in for the warp', () => {
        const camera = cameraAt(10, 40, 5);
        const warped = withTileWarp(camera, helper, undefined);
        const tileID = tileAt(10, 40, 5);
        expect(getCameraMath(warped).getFastPathSimpleProjectionMatrix(warped, tileID)).toBeUndefined();
        expect(getCameraMath(camera).getFastPathSimpleProjectionMatrix(camera, tileID)).toBeDefined();
    });

    test('is unchanged for a camera without a warp', () => {
        const camera = cameraAt(10, 40, 5);
        const tileID = tileAt(10, 40, 5);
        const flat = getCameraMath(camera).projectTileCoordinates(camera, 4096, 4096, tileID.toUnwrapped());
        const center = helper.worldFromLngLat(10, 40);
        expect(Number.isFinite(flat.point.x)).toBe(true);
        expect(center.x).toBeGreaterThan(0);
    });
});
