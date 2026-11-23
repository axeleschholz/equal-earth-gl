import {EXTENT} from '../../../src/data/extent.ts';

import type {MercatorProjectedCamera} from '../../../src/camera/projected_camera.ts';
import type {RendererProjectionData} from '../../../src/geo/projection/projection_data.ts';

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
export function shaderProject(data: RendererProjectionData, tx: number, ty: number): [number, number, number, number] {
    const [offsetX, offsetY, scaleX, scaleY] = data.tileMercatorCoords.map(f);
    const x = f(tx);
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

/**
 * Whether `clipWorldEdge()` of `_projection_equal_earth.fragment.glsl` discards a fragment at a tile x, in single
 * precision.
 */
export function shaderDiscards(data: RendererProjectionData, tx: number): boolean {
    if ((Number(data.clipAntimeridian) & 1) === 0) return false;
    const [x, y, z] = data.tileMercatorCoords.map(f);
    const west = data.projectionTransition < 0.5 ? f(-x / z) : x;
    const east = data.projectionTransition < 0.5 ? f(f(1 - x) / z) : y;
    return f(tx) < west || f(tx) >= east;
}

/** Where the shader puts a tile position on screen, in pixels from the middle of the viewport. */
export function shaderPixels(camera: MercatorProjectedCamera, data: RendererProjectionData, tx: number, ty: number): [number, number] {
    const clip = shaderProject(data, tx, ty);
    return [clip[0] / clip[3] * camera.width / 2, clip[1] / clip[3] * camera.height / 2];
}
