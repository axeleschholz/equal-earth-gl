import {describe, expect, test} from 'vitest';
import {
    EQUAL_EARTH_HALF_HEIGHT,
    EQUAL_EARTH_HALF_WIDTH,
    equalEarthForward,
    equalEarthInverse,
    equalEarthJacobian,
} from './equal_earth_math.ts';
import {equalEarthReference} from './equal_earth_reference.test_data.ts';

/** A small deterministic random number generator, so failures reproduce. */
function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

/** The area, in square metres, of one square degree of the WGS84 ellipsoid at a latitude. */
function ellipsoidAreaPerSquareDegree(lat: number): number {
    const a = 6378137;
    const e2 = 0.00669437999014;
    const phi = lat * Math.PI / 180;
    const sin = Math.sin(phi);
    const w2 = 1 - e2 * sin * sin;
    const meridianRadius = a * (1 - e2) / Math.pow(w2, 1.5);
    const parallelRadius = a * Math.cos(phi) / Math.sqrt(w2);
    return meridianRadius * parallelRadius * (Math.PI / 180) * (Math.PI / 180);
}

describe('equalEarthForward', () => {
    test('reaches the EPSG:8857 extent at the antimeridian on the equator', () => {
        const [x, y] = equalEarthForward(180, 0);
        expect(x).toBeCloseTo(17243959.06, 1);
        expect(y).toBeCloseTo(0, 6);
        expect(EQUAL_EARTH_HALF_WIDTH).toBeCloseTo(17243959.06, 1);
    });

    test('reaches the EPSG:8857 extent at the north pole', () => {
        const [x, y] = equalEarthForward(0, 90);
        expect(x).toBeCloseTo(0, 6);
        expect(y).toBeCloseTo(8392927.60, 1);
        expect(EQUAL_EARTH_HALF_HEIGHT).toBeCloseTo(8392927.60, 1);
    });

    test('agrees with proj4 over the globe', () => {
        expect(equalEarthReference).toHaveLength(117);
        for (const [lng, lat, x, y] of equalEarthReference) {
            const actual = equalEarthForward(lng, lat);
            expect(Math.abs(actual[0] - x)).toBeLessThan(1e-6);
            expect(Math.abs(actual[1] - y)).toBeLessThan(1e-6);
        }
    });

    test('writes into the array it is given', () => {
        const out: [number, number] = [0, 0];
        expect(equalEarthForward(10, 20, out)).toBe(out);
        expect(out).toEqual(equalEarthForward(10, 20));
    });
});

describe('equalEarthInverse', () => {
    test('takes the forward of a position back to it', () => {
        for (let lng = -180; lng <= 180; lng += 15) {
            for (let lat = -82.5; lat <= 82.5; lat += 7.5) {
                const [x, y] = equalEarthForward(lng, lat);
                const back = equalEarthInverse(x, y);
                expect(back).not.toBeNull();
                expect(Math.abs(back[0] - lng)).toBeLessThan(1e-9);
                expect(Math.abs(back[1] - lat)).toBeLessThan(1e-9);
            }
        }
    });

    test('takes the pole lines back to the poles', () => {
        for (let lng = -180; lng <= 180; lng += 15) {
            for (const lat of [-90, 90]) {
                const [x, y] = equalEarthForward(lng, lat);
                const back = equalEarthInverse(x, y);
                expect(back).not.toBeNull();
                expect(Math.abs(back[1] - lat)).toBeLessThan(1e-9);
            }
        }
    });

    test('has no answer outside the world outline', () => {
        expect(equalEarthInverse(17243959, 8000000)).toBeNull();
        expect(equalEarthInverse(0, 8392928.5)).toBeNull();
        expect(equalEarthInverse(17243960.5, 0)).toBeNull();
        expect(equalEarthInverse(NaN, 0)).toBeNull();
    });
});

describe('equalEarthJacobian', () => {
    test('matches central differences', () => {
        const random = seededRandom(1);
        const h = 1e-5;
        for (let i = 0; i < 200; i++) {
            const lng = random() * 340 - 170;
            const lat = random() * 170 - 85;
            const [xE, yE] = equalEarthForward(lng + h, lat);
            const [xW, yW] = equalEarthForward(lng - h, lat);
            const [xN, yN] = equalEarthForward(lng, lat + h);
            const [xS, yS] = equalEarthForward(lng, lat - h);
            const expected = [(xE - xW) / (2 * h), (xN - xS) / (2 * h), (yE - yW) / (2 * h), (yN - yS) / (2 * h)];
            const actual = equalEarthJacobian(lng, lat);
            const scale = Math.hypot(...expected);
            for (let k = 0; k < 4; k++) {
                expect(Math.abs(actual[k] - expected[k]) / scale).toBeLessThan(1e-6);
            }
        }
    });

    test('keeps plane area proportional to ellipsoid area everywhere', () => {
        const random = seededRandom(2);
        for (let i = 0; i < 500; i++) {
            const lng = random() * 360 - 180;
            const lat = random() * 178 - 89;
            const [a, b, c, d] = equalEarthJacobian(lng, lat);
            const ratio = (a * d - b * c) / ellipsoidAreaPerSquareDegree(lat);
            expect(Math.abs(ratio - 1)).toBeLessThan(1e-9);
        }
    });
});
