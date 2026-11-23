import {describe, test, expect, vi, afterEach} from 'vitest';
import {validateAndEmit, validateStyle, validateStyleAndEmit} from './validate_style.ts';
import {Evented, type ErrorEventType} from '../util/evented.ts';
import {latest as styleSpec} from '@maplibre/maplibre-gl-style-spec';

import type {StyleSpecification} from '@maplibre/maplibre-gl-style-spec';

class TestEmitter extends Evented<ErrorEventType> {}

afterEach(() => {
    vi.restoreAllMocks();
});

/** An emitter collecting the messages of the {@link ErrorEvent}s fired at it, plus a `console.warn` spy. */
function setup() {
    const emitter = new TestEmitter();
    const fired: string[] = [];
    emitter.on('error', ({error}) => fired.push(error.message));
    return {emitter, fired, warn: vi.spyOn(console, 'warn').mockImplementation(() => {})};
}

describe('validateAndEmit', () => {
    const key = 'layers.symbol.filter';

    test('fires an error and reports failure for a filter the spec rejects', () => {
        const {emitter, fired} = setup();

        const hasErrors = validateAndEmit(emitter, validateStyle.filter, {
            key,
            value: ['all', ['==', ['get', 'class'], 'rail'], ['nope', 1]]
        });

        expect(hasErrors).toBe(true);
        expect(fired).toEqual([expect.stringContaining('Unknown expression "nope"')]);
    });

    test('only warns for a filter that mixes legacy syntax into an expression, so the style keeps loading', () => {
        const {emitter, fired, warn} = setup();

        const hasErrors = validateAndEmit(emitter, validateStyle.filter, {
            key,
            value: ['all', ['==', ['get', 'class'], 'rail'], ['in', 'name', '']]
        });

        expect(hasErrors).toBe(false);
        expect(fired).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Mixing deprecated filter syntax with expression syntax'));
    });

    test('still fails when an error accompanies a warning, emitting only the error', () => {
        const {emitter, fired, warn} = setup();

        // `!in` has no expression equivalent, so the spec reports it as an error on top of the
        // warning about the mixing itself. A warning must not swallow that error.
        const hasErrors = validateAndEmit(emitter, validateStyle.filter, {
            key,
            value: ['all', ['==', ['get', 'class'], 'rail'], ['!in', 'name', 'a']]
        });

        expect(hasErrors).toBe(true);
        expect(fired).toEqual([expect.stringContaining('Unknown expression "!in"')]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Mixing deprecated filter syntax with expression syntax'));
    });

    test('skips validation entirely when the validate option is false', () => {
        const {emitter, fired} = setup();

        expect(validateAndEmit(emitter, validateStyle.filter, {key, value: 'notafilter'}, {validate: false})).toBe(false);
        expect(fired).toEqual([]);
    });
});

describe('validateStyleAndEmit', () => {
    const coordinates = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const styleWith = (sources: object, layers: object[] = []) =>
        ({version: 8, sources, layers}) as any as StyleSpecification;

    test('ignores sources the spec has no schema for, which MapLibre renders anyway', () => {
        const {emitter, fired} = setup();

        // `canvas` is not in the spec at all, and `addSourceType` can register anything else.
        const hasErrors = validateStyleAndEmit(emitter, styleWith({
            canvas: {type: 'canvas', canvas: 'c', coordinates},
            custom: {type: 'registered-at-runtime', url: 'https://example.com'}
        }, [{id: 'l', type: 'raster', source: 'canvas'}]));

        expect(hasErrors).toBe(false);
        expect(fired).toEqual([]);
    });

    test('still fails on a source the spec does know', () => {
        const {emitter, fired} = setup();

        const hasErrors = validateStyleAndEmit(emitter, styleWith({v: {type: 'vector', tiles: 'not-an-array'}}));

        expect(hasErrors).toBe(true);
        expect(fired).toEqual([expect.stringContaining('sources.v.tiles')]);
    });

    test('still fails elsewhere in a style that also holds an ignored source', () => {
        const {emitter, fired} = setup();

        const hasErrors = validateStyleAndEmit(emitter, styleWith(
            {canvas: {type: 'canvas', canvas: 'c', coordinates}},
            [{id: 'l', type: 'not-a-layer-type', source: 'canvas'}]
        ));

        expect(hasErrors).toBe(true);
        expect(fired).toEqual([expect.stringContaining('layers[0]')]);
    });
});

describe('validateStyle', () => {
    test('accepts the tileGrid option on tile sources, in a style and on a source alone', () => {
        const style = {version: 8, sources: {
            a: {type: 'vector', tiles: ['http://example.com/{z}/{x}/{y}.pbf'], tileGrid: 'equal-earth'},
            b: {type: 'raster', tiles: ['http://example.com/{z}/{x}/{y}.png'], tileGrid: 'mercator'},
            c: {type: 'raster-dem', tiles: ['http://example.com/{z}/{x}/{y}.png'], tileGrid: 'equal-earth'},
        }, layers: []} as any;

        expect(validateStyle(style)).toEqual([]);
        expect(validateStyle.source({key: 'sources.a', value: style.sources.a, styleSpec, style})).toEqual([]);
    });

    test('reports a tileGrid that names no grid', () => {
        const source = {type: 'vector', tiles: ['http://example.com/{z}/{x}/{y}.pbf'], tileGrid: 'foo'};

        const alone = validateStyle.source({key: 'sources.a', value: source, styleSpec, style: {}});
        const inStyle = validateStyle({version: 8, sources: {a: source}, layers: []});

        expect(alone.map(error => error.message)).toEqual(['sources.a.tileGrid: expected one of [mercator, equal-earth], "foo" found']);
        expect(inStyle.map(error => error.message)).toEqual(['sources.a.tileGrid: expected one of [mercator, equal-earth], "foo" found']);
    });

    test('still reports tileGrid as unknown on a source that has no tiles', () => {
        const errors = validateStyle({version: 8, sources: {a: {type: 'geojson', data: {type: 'FeatureCollection', features: []}, tileGrid: 'equal-earth'}}, layers: []});

        expect(errors.map(error => error.message)).toEqual(['sources.a: unknown property "tileGrid"']);
    });

    test('accepts a central meridian on the projection', () => {
        expect(validateStyle({version: 8, sources: {}, layers: [], projection: {'type': 'equal-earth', 'central-meridian': 150}})).toEqual([]);
    });

    test('reports a central meridian that is no longitude', () => {
        const tooFar = validateStyle({version: 8, sources: {}, layers: [], projection: {'type': 'equal-earth', 'central-meridian': 200}});
        const noNumber = validateStyle({version: 8, sources: {}, layers: [], projection: {'type': 'equal-earth', 'central-meridian': 'east'}});

        expect(tooFar.map(error => error.message)).toEqual(['projection.central-meridian: a number from -180 to 180 expected, 200 found']);
        expect(noNumber.map(error => error.message)).toEqual(['projection.central-meridian: a number from -180 to 180 expected, "east" found']);
    });
});
