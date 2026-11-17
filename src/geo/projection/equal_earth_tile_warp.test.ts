import {describe, expect, test} from 'vitest';
import {EXPANSION_OVERZOOM, equalEarthTileWarp as warp, evaluateExpansion} from './equal_earth_tile_warp.ts';
import {equalEarthWorldCoordinateHelper as helper} from './equal_earth_world.ts';
import {latFromMercatorY, lngFromMercatorX} from '../mercator_coordinate.ts';
import {EXTENT} from '../../data/extent.ts';

type Tile = {x: number; y: number; z: number};

/** A small deterministic random number generator, so failures reproduce. */
function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function randomTile(random: () => number, z: number): Tile {
    const tiles = Math.pow(2, z);
    return {z, x: Math.floor(random() * tiles), y: Math.floor(random() * tiles)};
}

/** How far the tile's buffer reaches past its edges, as a fraction of the tile, in the expansion tests. */
const BUFFER = 0.125;

/** The largest distance, in world units, between a tile's expansion and its warp over the tile and its buffer. */
function expansionError(tile: Tile): number {
    const coefficients = warp.expansion(tile);
    const center = warp.warp(tile, EXTENT / 2, EXTENT / 2, [0, 0]);
    const exact: [number, number] = [0, 0];
    const approximate: [number, number] = [0, 0];
    const tiles = Math.pow(2, tile.z);
    let worst = 0;
    for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
            let u = (i / 8 - 0.5) * (1 + 2 * BUFFER);
            const v = (j / 8 - 0.5) * (1 + 2 * BUFFER);
            if (tile.x === 0) u = Math.max(u, -0.5);
            if (tile.x === tiles - 1) u = Math.min(u, 0.5);
            warp.warp(tile, (u + 0.5) * EXTENT, (v + 0.5) * EXTENT, exact);
            evaluateExpansion(coefficients, u, v, approximate);
            worst = Math.max(worst, Math.hypot(approximate[0] - (exact[0] - center[0]), approximate[1] - (exact[1] - center[1])));
        }
    }
    return worst;
}

/** World units to pixels for a tile drawn {@link EXPANSION_OVERZOOM} zoom levels above its own. */
function overzoomedPixels(tile: Tile): number {
    return 512 * Math.pow(2, tile.z + EXPANSION_OVERZOOM);
}

describe('equalEarthTileWarp.warp', () => {
    test('puts the middle of the world tile at the middle of the world', () => {
        const [x, y] = warp.warp({x: 0, y: 0, z: 0}, EXTENT / 2, EXTENT / 2, [0, 0]);
        expect(x).toBeCloseTo(0.5, 14);
        expect(y).toBeCloseTo(0.5, 14);
    });

    test('puts the left edge of the world tile on the antimeridian', () => {
        const [x, y] = warp.warp({x: 0, y: 0, z: 0}, 0, EXTENT / 2, [0, 0]);
        expect(x).toBeCloseTo(0, 14);
        expect(y).toBeCloseTo(0.5, 14);
    });

    test('puts the top edge of the world tile at the mercator limit of latitude', () => {
        const [x, y] = warp.warp({x: 0, y: 0, z: 0}, EXTENT / 2, 0, [0, 0]);
        const expected = helper.worldFromLngLat(0, 85.0511287798066);
        expect(x).toBeCloseTo(expected.x, 12);
        expect(y).toBeCloseTo(expected.y, 12);
    });

    test('agrees with going through lng/lat at every zoom', () => {
        const random = seededRandom(3);
        const out: [number, number] = [0, 0];
        for (let i = 0; i < 1000; i++) {
            const tile = randomTile(random, Math.floor(random() * 23));
            const tx = random() * EXTENT;
            const ty = random() * EXTENT;
            const tiles = Math.pow(2, tile.z);
            const expected = helper.worldFromLngLat(lngFromMercatorX((tile.x + tx / EXTENT) / tiles), latFromMercatorY((tile.y + ty / EXTENT) / tiles));
            warp.warp(tile, tx, ty, out);
            expect(Math.abs(out[0] - expected.x)).toBeLessThan(1e-13);
            expect(Math.abs(out[1] - expected.y)).toBeLessThan(1e-13);
        }
    });

    test('keeps buffer positions past the antimeridian on it', () => {
        const left = warp.warp({x: 0, y: 1, z: 2}, -500, 100, [0, 0]);
        const onEdge = warp.warp({x: 0, y: 1, z: 2}, 0, 100, [0, 0]);
        expect(left).toEqual(onEdge);
        const right = warp.warp({x: 3, y: 1, z: 2}, EXTENT + 500, 100, [0, 0]);
        expect(right).toEqual(warp.warp({x: 3, y: 1, z: 2}, EXTENT, 100, [0, 0]));
    });

    test('keeps positions past the mercator square below the pole', () => {
        const [, y] = warp.warp({x: 0, y: 0, z: 0}, EXTENT / 2, -100 * EXTENT, [0, 0]);
        expect(y).toBeGreaterThanOrEqual(helper.worldBounds[1]);
        expect(y).toBeCloseTo(helper.worldBounds[1], 9);
    });
});

describe('equalEarthTileWarp.bounds', () => {
    test('contains the tile and is tight', () => {
        const random = seededRandom(4);
        const out: [number, number] = [0, 0];
        for (let i = 0; i < 200; i++) {
            const z = Math.floor(random() * 15);
            const tiles = Math.pow(2, z);
            const tile = {z, x: Math.floor(random() * tiles), y: 1 + Math.floor(random() * Math.max(1, tiles - 2))};
            if (tile.y >= tiles - 1 && tiles > 1) tile.y = tiles - 2;
            if (tiles <= 2) continue;
            const [minX, minY, maxX, maxY] = warp.bounds(tile);
            const slack = 1e-12;
            let seenMinX = Infinity, seenMinY = Infinity, seenMaxX = -Infinity, seenMaxY = -Infinity;
            for (let a = 0; a <= 16; a++) {
                for (let b = 0; b <= 16; b++) {
                    warp.warp(tile, a / 16 * EXTENT, b / 16 * EXTENT, out);
                    seenMinX = Math.min(seenMinX, out[0]);
                    seenMaxX = Math.max(seenMaxX, out[0]);
                    seenMinY = Math.min(seenMinY, out[1]);
                    seenMaxY = Math.max(seenMaxY, out[1]);
                }
            }
            expect(seenMinX).toBeGreaterThanOrEqual(minX - slack);
            expect(seenMinY).toBeGreaterThanOrEqual(minY - slack);
            expect(seenMaxX).toBeLessThanOrEqual(maxX + slack);
            expect(seenMaxY).toBeLessThanOrEqual(maxY + slack);
            const size = Math.max(maxX - minX, maxY - minY);
            expect(seenMinX - minX).toBeLessThan(0.01 * size);
            expect(maxX - seenMaxX).toBeLessThan(0.01 * size);
            expect(seenMinY - minY).toBeLessThan(0.01 * size);
            expect(maxY - seenMaxY).toBeLessThan(0.01 * size);
        }
    });

    test('reaches the pole in the top and bottom rows', () => {
        expect(warp.bounds({x: 0, y: 0, z: 0})).toEqual([0, helper.worldBounds[1], 1, helper.worldBounds[3]]);
        expect(warp.bounds({x: 2, y: 0, z: 3})[1]).toBe(helper.worldBounds[1]);
        expect(warp.bounds({x: 2, y: 7, z: 3})[3]).toBe(helper.worldBounds[3]);
        expect(warp.bounds({x: 2, y: 3, z: 3})[1]).toBeGreaterThan(helper.worldBounds[1]);
    });
});

describe('equalEarthTileWarp.jacobian', () => {
    test('matches central differences', () => {
        const random = seededRandom(5);
        const h = 1e-3;
        for (let i = 0; i < 200; i++) {
            const tile = randomTile(random, Math.floor(random() * 12));
            const tx = (0.05 + 0.9 * random()) * EXTENT;
            const ty = (0.05 + 0.9 * random()) * EXTENT;
            const east = warp.warp(tile, tx + h, ty, [0, 0]);
            const west = warp.warp(tile, tx - h, ty, [0, 0]);
            const south = warp.warp(tile, tx, ty + h, [0, 0]);
            const north = warp.warp(tile, tx, ty - h, [0, 0]);
            const expected = [(east[0] - west[0]) / (2 * h), (south[0] - north[0]) / (2 * h), (east[1] - west[1]) / (2 * h), (south[1] - north[1]) / (2 * h)];
            const actual = warp.jacobian(tile, tx, ty);
            const scale = Math.hypot(...expected);
            for (let k = 0; k < 4; k++) {
                expect(Math.abs(actual[k] - expected[k]) / scale).toBeLessThan(1e-5);
            }
        }
    });
});

describe('equalEarthTileWarp.expansion', () => {
    test('has twenty coefficients', () => {
        expect(warp.expansion({x: 5, y: 9, z: 4})).toHaveLength(20);
    });

    test('places the pole vertices of the top and bottom rows on the pole line', () => {
        const out: [number, number] = [0, 0];
        for (const z of [3, 7, 15]) {
            const tiles = Math.pow(2, z);
            for (const [tile, pole, lat] of [[{z, x: 0, y: 0}, 1, 90], [{z, x: tiles - 1, y: tiles - 1}, -1, -90], [{z, x: Math.floor(tiles / 3), y: 0}, 1, 90]] as Array<[Tile, 1 | -1, number]>) {
                const center = warp.warp(tile, EXTENT / 2, EXTENT / 2, [0, 0]);
                for (const u of [-0.5, -0.1, 0.5]) {
                    evaluateExpansion(warp.expansion(tile), u, 0.3, out, pole);
                    const expected = helper.worldFromLngLat((tile.x + u + 0.5) / tiles * 360 - 180, lat);
                    expect(Math.abs(out[0] + center[0] - expected.x) * overzoomedPixels(tile)).toBeLessThan(0.05);
                    expect(Math.abs(out[1] + center[1] - expected.y) * overzoomedPixels(tile)).toBeLessThan(0.05);
                }
            }
        }
    });

    test('has no pole in the rows between', () => {
        const coefficients = warp.expansion({z: 4, x: 3, y: 5});
        expect(coefficients[18]).toBe(0);
        expect(coefficients[19]).toBe(0);
    });

    test('stays within 0.05 px of the warp from expansionMinZoom up, for tiles drawn up to sixteen times their size', () => {
        const random = seededRandom(6);
        for (let z = warp.expansionMinZoom; z <= 22; z++) {
            const tiles = Math.pow(2, z);
            const sample: Tile[] = [
                {z, x: 0, y: 0}, {z, x: tiles - 1, y: tiles - 1}, {z, x: 0, y: tiles - 1}, {z, x: tiles - 1, y: 0},
                {z, x: Math.floor(tiles / 2), y: 0}, {z, x: 0, y: Math.floor(tiles / 2)},
            ];
            for (let i = 0; i < 200; i++) sample.push(randomTile(random, z));
            for (const tile of sample) {
                expect(expansionError(tile) * overzoomedPixels(tile), `tile ${z}/${tile.x}/${tile.y}`).toBeLessThan(0.05);
            }
        }
    });

    test('does not stay within the budget one zoom below expansionMinZoom', () => {
        const z = warp.expansionMinZoom - 1;
        expect(z).toBeGreaterThanOrEqual(0);
        const tiles = Math.pow(2, z);
        let worst = 0;
        for (let x = 0; x < tiles; x++) {
            for (let y = 0; y < tiles; y++) {
                worst = Math.max(worst, expansionError({z, x, y}) * overzoomedPixels({z, x, y}));
            }
        }
        expect(worst).toBeGreaterThan(0.05);
    });

    test('meets the neighbouring tile within 0.05 px along the shared edge', () => {
        const random = seededRandom(7);
        const a: [number, number] = [0, 0];
        const b: [number, number] = [0, 0];
        for (let z = Math.max(1, warp.expansionMinZoom); z <= 22; z++) {
            const tiles = Math.pow(2, z);
            for (let i = 0; i < 200; i++) {
                const tile = {z, x: Math.floor(random() * (tiles - 1)), y: Math.floor(random() * (tiles - 1))};
                const horizontal = random() < 0.5;
                const neighbour = horizontal ? {z, x: tile.x + 1, y: tile.y} : {z, x: tile.x, y: tile.y + 1};
                const tileCenter = warp.warp(tile, EXTENT / 2, EXTENT / 2, [0, 0]);
                const neighbourCenter = warp.warp(neighbour, EXTENT / 2, EXTENT / 2, [0, 0]);
                const tileExpansion = warp.expansion(tile);
                const neighbourExpansion = warp.expansion(neighbour);
                for (let k = 0; k <= 8; k++) {
                    const t = k / 8 - 0.5;
                    evaluateExpansion(tileExpansion, horizontal ? 0.5 : t, horizontal ? t : 0.5, a);
                    evaluateExpansion(neighbourExpansion, horizontal ? -0.5 : t, horizontal ? t : -0.5, b);
                    const gap = Math.hypot((a[0] + tileCenter[0]) - (b[0] + neighbourCenter[0]), (a[1] + tileCenter[1]) - (b[1] + neighbourCenter[1]));
                    expect(gap * 512 * Math.pow(2, z + 2), `tiles ${z}/${tile.x}/${tile.y}`).toBeLessThan(0.05);
                }
            }
        }
    });
});
