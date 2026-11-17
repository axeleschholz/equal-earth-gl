import {describe, expect, test} from 'vitest';
import {Placement} from './placement.ts';
import {createTestCamera} from '../util/test/util.ts';
import {equalEarthWorldCoordinateHelper} from '../geo/projection/equal_earth_world.ts';
import {mercatorWorldCoordinateHelper} from '../geo/mercator_coordinate.ts';
import {hasTileWarp} from '../camera/warped_camera.ts';

function emptyTile(tileGrid?: 'mercator' | 'plane'): any {
    return {tileGrid, getBucket: () => null, latestFeatureIndex: null};
}

describe('the camera a placement projects a tile\'s symbols with', () => {
    test('carries the warp for a tile of the mercator grid on the equal-earth plane', () => {
        const {projectedCamera} = createTestCamera({width: 512, height: 512, zoom: 3}, {projection: 'mercator', worldCoordinateHelper: equalEarthWorldCoordinateHelper});
        const placement = new Placement(projectedCamera, null, 0, true, undefined, equalEarthWorldCoordinateHelper);
        placement.getBucketParts([], {id: 'layer'} as any, emptyTile(), false);
        expect(hasTileWarp(placement.projectedCamera)).toBe(true);
        expect(placement.collisionIndex.projectedCamera).toBe(placement.projectedCamera);

        placement.getBucketParts([], {id: 'layer'} as any, emptyTile('plane'), false);
        expect(placement.projectedCamera).toBe(projectedCamera);
        expect(placement.collisionIndex.projectedCamera).toBe(projectedCamera);

        placement.updateLayerOpacities({id: 'layer'} as any, [emptyTile()]);
        expect(hasTileWarp(placement.projectedCamera)).toBe(true);
    });

    test('is the placement\'s own on mercator, and when no world mapping is given', () => {
        const {projectedCamera} = createTestCamera({width: 512, height: 512, zoom: 3});
        const withHelper = new Placement(projectedCamera, null, 0, true, undefined, mercatorWorldCoordinateHelper);
        withHelper.getBucketParts([], {id: 'layer'} as any, emptyTile(), false);
        expect(withHelper.projectedCamera).toBe(projectedCamera);
        const withoutHelper = new Placement(projectedCamera, null, 0, true);
        withoutHelper.getBucketParts([], {id: 'layer'} as any, emptyTile(), false);
        expect(withoutHelper.projectedCamera).toBe(projectedCamera);
        expect(hasTileWarp(projectedCamera)).toBe(false);
    });
});
