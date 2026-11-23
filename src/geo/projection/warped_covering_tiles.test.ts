import {describe, expect, test} from 'vitest';
import Point from '@mapbox/point-geometry';
import {coveringTiles} from './covering_tiles.ts';
import {tileLiesInWorld} from './tile_warp.ts';
import {equalEarthWorldCoordinateHelper as helper, getEqualEarthWorldCoordinateHelper} from './equal_earth_world.ts';
import {equalEarthTileWarp} from './equal_earth_tile_warp.ts';
import {mercatorWorldCoordinateHelper, mercatorYfromLat, mercatorXfromLng} from '../mercator_coordinate.ts';
import {getCameraMath} from '../../camera/camera_math_factory.ts';
import {createTestCamera} from '../../util/test/util.ts';

import type {OverscaledTileID} from '../../tile/tile_id.ts';
import type {WorldCoordinateHelper} from '../world_types.ts';

type CameraOptions = Parameters<typeof createTestCamera>[0];

function equalEarthCamera(options: CameraOptions) {
    return createTestCamera(options, {projection: 'mercator', worldCoordinateHelper: helper}).projectedCamera;
}

function keys(tiles: OverscaledTileID[]): string[] {
    return tiles.map((tile) => `${tile.canonical.z}/${tile.canonical.x}/${tile.canonical.y}`).sort();
}

/** Whether a mercator tile, with the pole cap of a top or bottom row, holds a lng/lat. */
function tileHolds(tile: OverscaledTileID, lng: number, lat: number): boolean {
    const {x, y, z} = tile.canonical;
    const tiles = Math.pow(2, z);
    const mercatorX = mercatorXfromLng(lng) * tiles;
    const mercatorY = Math.max(0, Math.min(tiles - 1e-9, mercatorYfromLat(Math.max(-89.999, Math.min(89.999, lat))) * tiles));
    const slack = 1e-6;
    return mercatorX >= x - slack && mercatorX <= x + 1 + slack && mercatorY >= y - slack && mercatorY <= y + 1 + slack;
}

/** Fails unless every screen point of a grid that shows the world is in one of the tiles. */
function expectCovered(camera: ReturnType<typeof equalEarthCamera>, tiles: OverscaledTileID[]): void {
    const cameraMath = getCameraMath(camera);
    let onMap = 0;
    for (let i = 0; i <= 12; i++) {
        for (let j = 0; j <= 12; j++) {
            const point = new Point(1 + i / 12 * (camera.width - 2), 1 + j / 12 * (camera.height - 2));
            if (!cameraMath.isPointOnMapSurface(camera, helper, point)) continue;
            onMap++;
            const location = cameraMath.screenPointToLocation(camera, helper, point);
            const holders = tiles.filter((tile) => tileHolds(tile, location.lng, location.lat));
            expect(holders.length, `no tile at ${location.lng}, ${location.lat}`).toBeGreaterThan(0);
        }
    }
    expect(onMap).toBeGreaterThan(0);
}

/** Fails if one of the tiles is inside another. */
function expectDisjoint(tiles: OverscaledTileID[]): void {
    for (const a of tiles) {
        for (const b of tiles) {
            if (a === b || a.canonical.z >= b.canonical.z) continue;
            const shift = b.canonical.z - a.canonical.z;
            const inside = (b.canonical.x >> shift) === a.canonical.x && (b.canonical.y >> shift) === a.canonical.y;
            expect(inside, `${keys([b])[0]} is inside ${keys([a])[0]}`).toBe(false);
        }
    }
}

describe('covering mercator tiles on the equal-earth plane', () => {
    test('the whole world at zoom 0 is the world tile', () => {
        const camera = equalEarthCamera({width: 1024, height: 512, zoom: 0});
        expect(keys(coveringTiles(camera, helper, {tileSize: 512}))).toEqual(['0/0/0']);
    });

    test('covers the view at the equator without overlap', () => {
        const camera = equalEarthCamera({width: 512, height: 512, zoom: 2});
        const tiles = coveringTiles(camera, helper, {tileSize: 512});
        expectCovered(camera, tiles);
        expectDisjoint(tiles);
        for (const tile of tiles) {
            const [minX, minY, maxX, maxY] = equalEarthTileWarp.bounds(tile.canonical);
            expect(maxX).toBeGreaterThan(0.5 - 0.125 - 1e-9);
            expect(minX).toBeLessThan(0.5 + 0.125 + 1e-9);
            expect(maxY).toBeGreaterThan(0.5 - 0.125 - 1e-9);
            expect(minY).toBeLessThan(0.5 + 0.125 + 1e-9);
        }
    });

    test('covers views across the world, at the edges and near the poles', () => {
        const views: CameraOptions[] = [
            {width: 800, height: 600, zoom: 3, center: [-100, 40]},
            {width: 800, height: 600, zoom: 5, center: [179.5, -17]},
            {width: 800, height: 600, zoom: 4, center: [20, 84]},
            {width: 800, height: 600, zoom: 6, center: [-60, -88]},
            {width: 800, height: 600, zoom: 9, center: [13.4, 52.5], bearing: 30},
            {width: 800, height: 600, zoom: 15.6, center: [151.2, -33.9]},
            {width: 800, height: 600, zoom: 1, center: [0, 0]},
        ];
        for (const view of views) {
            const camera = equalEarthCamera(view);
            const tiles = coveringTiles(camera, helper, {tileSize: 512});
            expectCovered(camera, tiles);
            expectDisjoint(tiles);
            expect(tiles.length).toBeLessThan(40);
        }
    });

    test('uses the view zoom at the equator and coarser tiles toward the poles', () => {
        const equator = coveringTiles(equalEarthCamera({width: 256, height: 256, zoom: 5}), helper, {tileSize: 512});
        expect(new Set(equator.map((tile) => tile.canonical.z))).toEqual(new Set([5]));

        const arctic = coveringTiles(equalEarthCamera({width: 256, height: 256, zoom: 5, center: [0, 80]}), helper, {tileSize: 512});
        expect(arctic.length).toBeGreaterThan(0);
        for (const tile of arctic) {
            expect(tile.canonical.z).toBeGreaterThanOrEqual(2);
            expect(tile.canonical.z).toBeLessThanOrEqual(3);
        }
    });

    test('keeps to the source zoom range', () => {
        const camera = equalEarthCamera({width: 512, height: 512, zoom: 9, center: [10, 10]});
        const tiles = coveringTiles(camera, helper, {tileSize: 512, maxzoom: 6, minzoom: 2});
        expect(new Set(tiles.map((tile) => tile.canonical.z))).toEqual(new Set([6]));
        expectCovered(camera, tiles);
    });

    test('a view on the corner of the world gets the corner tiles only', () => {
        const camera = equalEarthCamera({width: 300, height: 300, zoom: 8, center: [-180, 90]});
        const tiles = coveringTiles(camera, helper, {tileSize: 512});
        expect(tiles.length).toBeGreaterThan(0);
        expect(tiles.length).toBeLessThan(10);
        for (const tile of tiles) {
            expect(tile.canonical.y).toBe(0);
            expect(tile.canonical.x).toBe(0);
        }
    });

    test('a pitched view does not load an excessive number of tiles', () => {
        const camera = equalEarthCamera({width: 1024, height: 768, zoom: 6, center: [10, 45], pitch: 60});
        const tiles = coveringTiles(camera, helper, {tileSize: 512});
        expect(tiles.length).toBeGreaterThan(4);
        expect(tiles.length).toBeLessThan(80);
        expectDisjoint(tiles);
    });

    test('never wraps tiles', () => {
        const camera = equalEarthCamera({width: 1024, height: 512, zoom: 1, center: [170, 0]});
        for (const tile of coveringTiles(camera, helper, {tileSize: 512})) expect(tile.wrap).toBe(0);
    });
});

describe('covering tiles of the plane\'s own grid', () => {
    test('on the equal-earth plane are the squares of the plane', () => {
        const camera = equalEarthCamera({width: 512, height: 512, zoom: 2});
        const withoutWarp: WorldCoordinateHelper = Object.create(helper, {mercatorTileWarp: {value: null}});
        const planeTiles = keys(coveringTiles(camera, helper, {tileSize: 512, tileGrid: 'plane'}));
        expect(planeTiles).toEqual(keys(coveringTiles(camera, withoutWarp, {tileSize: 512})));
        expect(planeTiles).toEqual(['2/1/1', '2/1/2', '2/2/1', '2/2/2']);
    });

    test('on mercator are unchanged', () => {
        const camera = createTestCamera({width: 512, height: 512, zoom: 2}).projectedCamera;
        const tiles = keys(coveringTiles(camera, mercatorWorldCoordinateHelper, {tileSize: 512}));
        expect(tiles).toEqual(['2/1/1', '2/1/2', '2/2/1', '2/2/2']);
        expect(keys(coveringTiles(camera, mercatorWorldCoordinateHelper, {tileSize: 512, tileGrid: 'mercator'}))).toEqual(tiles);
    });
});

describe('covering mercator tiles on a re-centred equal-earth plane', () => {
    test('covers the whole world with a copy of the world tile for each end', () => {
        const pacific = getEqualEarthWorldCoordinateHelper(150);
        const {projectedCamera} = createTestCamera({width: 1024, height: 512, zoom: 0, center: [150, 0]}, {projection: 'mercator', worldCoordinateHelper: pacific});

        const tiles = coveringTiles(projectedCamera, pacific, {tileSize: 512, maxzoom: 0});

        expect(tiles.map(tile => `${tile.canonical.z}/${tile.canonical.x}/${tile.canonical.y} wrap ${tile.wrap}`).sort()).toEqual(['0/0/0 wrap -1', '0/0/0 wrap 0']);
    });

    test('gives the tiles on each side of the antimeridian the wrap that puts them next to each other', () => {
        const pacific = getEqualEarthWorldCoordinateHelper(150);
        const {projectedCamera} = createTestCamera({width: 512, height: 512, zoom: 3, center: [180, 0]}, {projection: 'mercator', worldCoordinateHelper: pacific});

        const tiles = coveringTiles(projectedCamera, pacific, {tileSize: 512});

        const westOfIt = tiles.filter(tile => tile.canonical.x === 7);
        const eastOfIt = tiles.filter(tile => tile.canonical.x === 0);
        expect(westOfIt.length).toBeGreaterThan(0);
        expect(eastOfIt.length).toBeGreaterThan(0);
        expect(westOfIt.every(tile => tile.wrap === -1)).toBe(true);
        expect(eastOfIt.every(tile => tile.wrap === 0)).toBe(true);
    });

    test('selects no copy of a tile that lies outside the world', () => {
        const pacific = getEqualEarthWorldCoordinateHelper(150);
        const warp = pacific.mercatorTileWarp;
        const {projectedCamera} = createTestCamera({width: 512, height: 512, zoom: 4, center: [-30.5, 10]}, {projection: 'mercator', worldCoordinateHelper: pacific});

        const tiles = coveringTiles(projectedCamera, pacific, {tileSize: 512});

        expect(tiles.length).toBeGreaterThan(0);
        for (const tile of tiles) {
            expect(tileLiesInWorld(warp.window({...tile.canonical, wrap: tile.wrap})), tile.toString()).toBe(true);
        }
    });
});
