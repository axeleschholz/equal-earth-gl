import {describe, expect, test} from 'vitest';
import {vec4} from 'gl-matrix';
import {getWarpedProjectionData} from './warped_projection_data.ts';
import {equalEarthTileWarp as warp} from './equal_earth_tile_warp.ts';
import {equalEarthWorldCoordinateHelper as helper} from './equal_earth_world.ts';
import {mercatorXfromLng, mercatorYfromLat} from '../mercator_coordinate.ts';
import {OverscaledTileID} from '../../tile/tile_id.ts';
import {EXTENT} from '../../data/extent.ts';
import {createTestCamera} from '../../util/test/util.ts';

import type {MercatorProjectedCamera} from '../../camera/projected_camera.ts';
import type {RendererProjectionData} from './projection_data.ts';

const f = Math.fround;

const A1 = f(1.340264);
const A2 = f(-0.081106);
const A3 = f(0.000893);
const A4 = f(0.003796);
const M = f(Math.sqrt(3) / 2);
const E = f(Math.sqrt(0.00669437999014));
const E2 = f(0.00669437999014);
const Q_POLE = f(1.9955310875028371);
const Y_SCALE = f(Math.sqrt(3) / 2 * 1.340264 / (2 * Math.PI));

/**
 * The arithmetic of `_projection_equal_earth.vertex.glsl` in single precision: a tile position to clip space.
 */
function shaderProject(data: RendererProjectionData, tx: number, ty: number): [number, number, number, number] {
    const [offsetX, offsetY, scaleX, scaleY] = data.tileMercatorCoords.map(f);
    const x = Math.max(f(-offsetX / scaleX), Math.min(f(f(1 - offsetX) / scaleX), f(tx)));
    const pole = ty < -32767.5 ? 1 : ty > 32766.5 ? -1 : 0;
    let planeX: number;
    let planeY: number;
    if (data.projectionTransition < 0.5) {
        const mercatorX = f(offsetX + f(scaleX * x));
        const mercatorY = Math.max(-0.5, Math.min(1.5, f(offsetY + f(scaleY * f(ty)))));
        const t = f(Math.exp(f(Math.PI - f(2 * Math.PI * mercatorY))));
        const t2 = f(t * t);
        let sinLat = f(f(t2 - 1) / f(t2 + 1));
        if (pole) sinLat = pole;
        const eSin = f(E * sinLat);
        const q = f(f(1 - E2) * f(f(sinLat / f(1 - f(eSin * eSin))) + f(f(Math.atanh(eSin)) / E)));
        const sinTheta = f(M * Math.max(-1, Math.min(1, f(q / Q_POLE))));
        const theta = f(Math.asin(sinTheta));
        const cosTheta = f(Math.sqrt(f(1 - f(sinTheta * sinTheta))));
        const theta2 = f(theta * theta);
        const theta6 = f(f(theta2 * theta2) * theta2);
        const d = f(f(A1 + f(3 * A2 * theta2)) + f(theta6 * f(f(7 * A3) + f(9 * A4 * theta2))));
        planeX = f(0.5 + f(f(mercatorX - 0.5) * f(f(cosTheta * A1) / d)));
        planeY = f(0.5 - f(f(theta * f(f(A1 + f(A2 * theta2)) + f(theta6 * f(A3 + f(A4 * theta2))))) * Y_SCALE));
    } else {
        const c = [...data.fallbackMatrix, ...data.clippingPlane].map(f);
        const u = f(f(x / EXTENT) - 0.5);
        const v = f(f(ty / EXTENT) - 0.5);
        let aDifference: number;
        if (pole) {
            aDifference = f(c[18] - c[0]);
            planeY = c[19];
        } else {
            let aSlope = 0;
            let cSlope = 0;
            for (let k = 8; k >= 1; k--) {
                aSlope = f(f(aSlope * v) + c[k]);
                cSlope = f(f(cSlope * v) + c[9 + k]);
            }
            aDifference = f(aSlope * v);
            planeY = f(cSlope * v);
        }
        planeX = f(f(u * f(c[0] + aDifference)) + f(c[9] * aDifference));
    }
    const m = data.mainMatrix;
    const out: number[] = [];
    for (let row = 0; row < 4; row++) {
        out.push(f(f(f(m[row] * planeX) + f(m[4 + row] * planeY)) + m[12 + row]));
    }
    return out as [number, number, number, number];
}

/** Where double precision puts a tile position on screen, in pixels from the middle of the viewport. */
function referencePixels(camera: MercatorProjectedCamera, tile: {x: number; y: number; z: number}, tx: number, ty: number): [number, number] {
    const world = warp.warp(tile, tx, ty, [0, 0]);
    const clip = vec4.transformMat4([], [world[0] * camera.worldSize, world[1] * camera.worldSize, 0, 1], camera.modelViewProjectionMatrix);
    return [clip[0] / clip[3] * camera.width / 2, clip[1] / clip[3] * camera.height / 2];
}

function shaderPixels(camera: MercatorProjectedCamera, data: RendererProjectionData, tx: number, ty: number): [number, number] {
    const clip = shaderProject(data, tx, ty);
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

    test('clips at the antimeridian in the first and last columns only', () => {
        const camera = cameraAt(0, 0, 3);
        expect(getWarpedProjectionData(camera, new OverscaledTileID(3, 0, 3, 0, 2), warp).clipAntimeridian).toBe(true);
        expect(getWarpedProjectionData(camera, new OverscaledTileID(3, 0, 3, 7, 2), warp).clipAntimeridian).toBe(true);
        expect(getWarpedProjectionData(camera, new OverscaledTileID(3, 0, 3, 4, 2), warp).clipAntimeridian).toBe(false);
        expect(getWarpedProjectionData(camera, new OverscaledTileID(0, 0, 0, 0, 0), warp).clipAntimeridian).toBe(true);
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
