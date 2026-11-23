import {describe, test, expect, vi} from 'vitest';
import {resolveSourceTileGrid, sourceGridHasTile} from './source_tile_grid.ts';
import {mercatorWorldCoordinateHelper} from '../geo/mercator_coordinate.ts';
import {equalEarthWorldCoordinateHelper} from '../geo/projection/equal_earth_world.ts';
import {CRSWorldCoordinateHelper, identityCrs} from '../geo/projection/crs.ts';
import {CanonicalTileID} from '../tile/tile_id.ts';

describe('resolveSourceTileGrid', () => {
    test('leaves a source without the option to the grid the plane takes its sources to be cut in', () => {
        expect(resolveSourceTileGrid(undefined, equalEarthWorldCoordinateHelper)).toBeUndefined();
        expect(resolveSourceTileGrid(undefined, mercatorWorldCoordinateHelper)).toBeUndefined();
    });

    test('treats mercator tiles as the default where the plane takes its sources to be mercator tiles', () => {
        expect(resolveSourceTileGrid('mercator', mercatorWorldCoordinateHelper)).toBeUndefined();
        expect(resolveSourceTileGrid('mercator', equalEarthWorldCoordinateHelper)).toBeUndefined();
    });

    test('resolves the name of the plane\'s own grid to the plane grid', () => {
        expect(resolveSourceTileGrid('equal-earth', equalEarthWorldCoordinateHelper)).toBe('plane');
    });

    test('has no grid for tiles that cannot be drawn on the plane', () => {
        expect(resolveSourceTileGrid('equal-earth', mercatorWorldCoordinateHelper)).toBeNull();
        expect(resolveSourceTileGrid('mercator', new CRSWorldCoordinateHelper(identityCrs))).toBeNull();
    });
});

describe('sourceGridHasTile', () => {
    test('has the tiles of the plane grid that touch the world, and not those above or below it', () => {
        expect(sourceGridHasTile('equal-earth', equalEarthWorldCoordinateHelper, new CanonicalTileID(2, 1, 1))).toBe(true);
        expect(sourceGridHasTile('equal-earth', equalEarthWorldCoordinateHelper, new CanonicalTileID(2, 1, 0))).toBe(false);
        expect(sourceGridHasTile('equal-earth', equalEarthWorldCoordinateHelper, new CanonicalTileID(2, 2, 3))).toBe(false);
        expect(sourceGridHasTile('equal-earth', equalEarthWorldCoordinateHelper, new CanonicalTileID(0, 0, 0))).toBe(true);
    });

    test('has every mercator tile on a plane they are warped onto', () => {
        expect(sourceGridHasTile(undefined, equalEarthWorldCoordinateHelper, new CanonicalTileID(2, 1, 0))).toBe(true);
    });

    test('has no tiles, and warns once, for a grid that cannot be drawn on the plane', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(sourceGridHasTile('equal-earth', mercatorWorldCoordinateHelper, new CanonicalTileID(0, 0, 0))).toBe(false);
        expect(sourceGridHasTile('equal-earth', mercatorWorldCoordinateHelper, new CanonicalTileID(1, 0, 0))).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('"equal-earth"');
        warn.mockRestore();
    });
});
