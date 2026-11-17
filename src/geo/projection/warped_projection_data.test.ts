import {describe, expect, test} from 'vitest';
import {vec4} from 'gl-matrix';
import {getWarpedProjectionData} from './warped_projection_data.ts';
import {equalEarthTileWarp as warp} from './equal_earth_tile_warp.ts';
import {equalEarthWorldCoordinateHelper as helper} from './equal_earth_world.ts';
import {mercatorXfromLng, mercatorYfromLat} from '../mercator_coordinate.ts';
import {OverscaledTileID} from '../../tile/tile_id.ts';
import {EXTENT} from '../../data/extent.ts';
import {createTestCamera} from '../../util/test/util.ts';
import {shaderPixels} from '../../../test/unit/lib/warped_shader_mirror.ts';

import type {MercatorProjectedCamera} from '../../camera/projected_camera.ts';

/** Where double precision puts a tile position on screen, in pixels from the middle of the viewport. */
function referencePixels(camera: MercatorProjectedCamera, tile: {x: number; y: number; z: number}, tx: number, ty: number): [number, number] {
    const world = warp.warp(tile, tx, ty, [0, 0]);
    const clip = vec4.transformMat4([], [world[0] * camera.worldSize, world[1] * camera.worldSize, 0, 1], camera.modelViewProjectionMatrix);
    return [clip[0] / clip[3] * camera.width / 2, clip[1] / clip[3] * camera.height / 2];
}

function cameraAt(lng: number, lat: number, zoom: number, pitch = 0, bearing = 0): MercatorProjectedCamera {
    return createTestCamera({width: 1024, height: 768, zoom, center: [lng, lat], pitch, bearing}, {projection: 'mercator', worldCoordinateHelper: helper}).projectedCamera as MercatorProjectedCamera;
}

function tileAt(lng: number, lat: number, z: number): OverscaledTileID {
    const tiles = Math.pow(2, z);
    const x = Math.min(tiles - 1, Math.floor(mercatorXfromLng(lng) * tiles));
    const y = Math.min(tiles - 1, Math.max(0, Math.floor(mercatorYfromLat(lat) * tiles)));
    return new OverscaledTileID(z, 0, z, x, y);
}

describe('getWarpedProjectionData', () => {
    test('uses the warp itself below the expansion zoom and the expansion from there', () => {
        const camera = cameraAt(0, 0, 2);
        expect(getWarpedProjectionData(camera, new OverscaledTileID(2, 0, 2, 1, 1), warp).projectionTransition).toBe(0);
        expect(getWarpedProjectionData(camera, new OverscaledTileID(3, 0, 3, 1, 1), warp).projectionTransition).toBe(1);
        expect(warp.expansionMinZoom).toBe(3);
    });

    test('carries the tile\'s place in the mercator square', () => {
        const data = getWarpedProjectionData(cameraAt(0, 0, 2), new OverscaledTileID(2, 0, 2, 3, 1), warp);
        expect(data.tileMercatorCoords).toEqual([0.75, 0.25, 1 / 4 / EXTENT, 1 / 4 / EXTENT]);
    });

    test('clips line fragments past the antimeridian in the first and last columns, and past the mercator square in the top and bottom rows', () => {
        const camera = cameraAt(0, 0, 3);
        const clip = (x: number, y: number, z = 3) => getWarpedProjectionData(camera, new OverscaledTileID(z, 0, z, x, y), warp).clipAntimeridian;
        expect(clip(4, 2)).toBe(0);
        expect(clip(0, 2)).toBe(1);
        expect(clip(7, 2)).toBe(1);
        expect(clip(4, 0)).toBe(2);
        expect(clip(4, 7)).toBe(4);
        expect(clip(0, 0)).toBe(3);
        expect(clip(7, 7)).toBe(5);
        expect(clip(0, 0, 0)).toBe(7);
    });

    test('has a uniform buffer key that tells warped tiles from flat ones', () => {
        const tileID = new OverscaledTileID(3, 0, 3, 4, 2);
        expect(getWarpedProjectionData(cameraAt(0, 0, 3), tileID, warp).uniformBufferKey).toBe(`${tileID.key}/warped`);
    });

    test('lets single precision land within 0.05 px of double precision at every zoom and latitude', () => {
        const views: Array<[number, number, number, number]> = [];
        for (const lat of [0, 45, 78, 84.5, -60]) {
            for (const lng of [0, -100, 179.9]) {
                for (const z of [0, 1, 2, 3, 4, 9, 14, 22]) {
                    views.push([lng, lat, z, z + 0.4]);
                    views.push([lng, lat, z, z + 2.7]);
                }
            }
        }
        for (const [lng, lat, z, viewZoom] of views) {
            const camera = cameraAt(lng, lat, viewZoom, z % 2 ? 40 : 0, z % 3 ? 25 : 0);
            const tileID = tileAt(lng, lat, z);
            const data = getWarpedProjectionData(camera, tileID, warp);
            for (let i = 0; i <= 4; i++) {
                for (let j = 0; j <= 4; j++) {
                    const tx = i / 4 * EXTENT;
                    const ty = j / 4 * EXTENT;
                    const expected = referencePixels(camera, tileID.canonical, tx, ty);
                    if (Math.abs(expected[0]) > 1500 || Math.abs(expected[1]) > 1500) continue;
                    const actual = shaderPixels(camera, data, tx, ty);
                    const label = `tile ${z}/${tileID.canonical.x}/${tileID.canonical.y} at ${tx}, ${ty}, view zoom ${viewZoom}`;
                    expect(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]), label).toBeLessThan(0.05);
                }
            }
        }
    });

    test('puts pole vertices on the pole line in both regimes', () => {
        for (const z of [1, 5]) {
            const camera = cameraAt(10, 88, z + 0.5);
            const tileID = tileAt(10, 88, z);
            const data = getWarpedProjectionData(camera, tileID, warp);
            const tiles = Math.pow(2, z);
            const lng = (tileID.canonical.x + 0.25) / tiles * 360 - 180;
            const world = helper.worldFromLngLat(lng, 90);
            const clip = vec4.transformMat4([], [world.x * camera.worldSize, world.y * camera.worldSize, 0, 1], camera.modelViewProjectionMatrix);
            const expected = [clip[0] / clip[3] * camera.width / 2, clip[1] / clip[3] * camera.height / 2];
            const actual = shaderPixels(camera, data, EXTENT / 4, -32768);
            expect(Math.hypot(actual[0] - expected[0], actual[1] - expected[1])).toBeLessThan(0.05);
        }
    });

    test('keeps buffer positions past the antimeridian on it', () => {
        for (const z of [1, 6]) {
            const camera = cameraAt(-179.5, 20, z + 0.5);
            const tileID = tileAt(-179.9, 20, z);
            const data = getWarpedProjectionData(camera, tileID, warp);
            expect(shaderPixels(camera, data, -300, 4000)).toEqual(shaderPixels(camera, data, 0, 4000));
        }
    });
});
