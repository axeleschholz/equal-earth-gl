import {afterEach, describe, expect, test, vi} from 'vitest';
import {createWorkerCRSHelper, setProjectionHandler} from './projection_handler_worker.ts';
import {equalEarthTileMatrixSet, equalEarthWorldCoordinateHelper} from '../geo/projection/equal_earth_world.ts';

describe('createWorkerCRSHelper', () => {
    afterEach(() => {
        setProjectionHandler(null);
        vi.restoreAllMocks();
    });

    test('has the equal-earth plane built in, without a projection handler or a definition', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const helper = createWorkerCRSHelper({name: 'equal-earth', tileMatrixSet: equalEarthTileMatrixSet});
        expect(helper).toBe(equalEarthWorldCoordinateHelper);
        expect(helper.latitudeRange).toEqual([-90, 90]);
        expect(warn).not.toHaveBeenCalled();
    });

    test('does not take a registered projection for a built-in one', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(createWorkerCRSHelper({name: 'custom:thing', definition: 'x', tileMatrixSet: equalEarthTileMatrixSet})).toBeUndefined();
    });
});
