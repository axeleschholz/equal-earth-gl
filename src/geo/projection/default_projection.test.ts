import {afterEach, describe, expect, test} from 'vitest';
import {getDefaultProjection, setDefaultProjection, SHIPPED_DEFAULT_PROJECTION} from './default_projection.ts';

describe('the default projection', () => {
    const before = getDefaultProjection();
    afterEach(() => setDefaultProjection(before));

    test('ships as equal-earth', () => {
        expect(SHIPPED_DEFAULT_PROJECTION).toBe('equal-earth');
    });

    test('is the name last set', () => {
        setDefaultProjection('globe');
        expect(getDefaultProjection()).toBe('globe');
        setDefaultProjection('equal-earth');
        expect(getDefaultProjection()).toBe('equal-earth');
    });
});
