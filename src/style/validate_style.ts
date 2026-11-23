import {latest as styleSpec, validateStyleMin, ValidationError} from '@maplibre/maplibre-gl-style-spec';
import {SOURCE_TILE_GRIDS} from '../source/source_tile_grid.ts';
import {ErrorEvent} from '../util/evented.ts';
import {extend, warnOnce} from '../util/util.ts';

import type {StyleSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {Evented} from '../util/evented.ts';
import type {StyleSetterOptions} from './style.ts';

/**
 * Validates a single part of a style, e.g. a source, a filter or a paint property.
 * The options it takes are the ones assembled by {@link validateAndEmit}.
 */
export type Validator = (options: any) => readonly ValidationError[];

type ValidateStyle = {
    source: Validator;
    sprite: Validator;
    glyphs: Validator;
    layer: Validator;
    light: Validator;
    sky: Validator;
    terrain: Validator;
    filter: Validator;
    paintProperty: Validator;
    layoutProperty: Validator;
    (b: any, a?: any | null): readonly ValidationError[];
};

const specValidateStyle = (validateStyleMin as unknown as ValidateStyle);

/** The source types that take the `tileGrid` option, see `TileGridSourceOption`. */
const TILE_GRID_SOURCE_TYPES: ReadonlySet<unknown> = new Set(['vector', 'raster', 'raster-dem']);

/** The projection's central meridian, see `CentralMeridianProjectionOption`. */
const CENTRAL_MERIDIAN = 'central-meridian';

function hasTileGrid(source: any): boolean {
    return source && typeof source === 'object' && source.tileGrid !== undefined && TILE_GRID_SOURCE_TYPES.has(source.type);
}

function withoutKey<T extends object>(object: T, key: string): T {
    const copy = {...object};
    delete copy[key];
    return copy;
}

function validateTileGrid(key: string, source: any): ValidationError[] {
    if (!hasTileGrid(source) || SOURCE_TILE_GRIDS.includes(source.tileGrid)) return [];
    return [new ValidationError(`${key}.tileGrid`, source.tileGrid, `expected one of [${SOURCE_TILE_GRIDS.join(', ')}], ${JSON.stringify(source.tileGrid)} found`)];
}

/**
 * Validates what a projection object holds beyond the style specification: its `central-meridian`.
 */
export function validateCentralMeridian(projection: any): ValidationError[] {
    const value = projection?.[CENTRAL_MERIDIAN];
    if (value === undefined || (typeof value === 'number' && value >= -180 && value <= 180)) return [];
    return [new ValidationError(`projection.${CENTRAL_MERIDIAN}`, value, `a number from -180 to 180 expected, ${JSON.stringify(value)} found`)];
}

/**
 * A style as the specification's validator is given it: without the keys this library takes beyond the
 * specification, which that validator would report as unknown. They are a tile source's `tileGrid` and the
 * projection's `central-meridian`, which {@link validateStyle} checks itself.
 */
function withoutExtensions(style: any): any {
    if (!style || typeof style !== 'object') return style;
    let stripped = style;
    const sources = style.sources;
    if (sources && typeof sources === 'object' && Object.values(sources).some(hasTileGrid)) {
        const strippedSources = {};
        for (const id in sources) strippedSources[id] = hasTileGrid(sources[id]) ? withoutKey(sources[id], 'tileGrid') : sources[id];
        stripped = {...stripped, sources: strippedSources};
    }
    if (style.projection && typeof style.projection === 'object' && CENTRAL_MERIDIAN in style.projection) {
        stripped = {...stripped, projection: withoutKey(style.projection, CENTRAL_MERIDIAN)};
    }
    return stripped;
}

function validateExtensions(style: any): ValidationError[] {
    if (!style || typeof style !== 'object') return [];
    const errors = validateCentralMeridian(style.projection);
    const sources = style.sources;
    if (!sources || typeof sources !== 'object') return errors;
    for (const id in sources) errors.push(...validateTileGrid(`sources.${id}`, sources[id]));
    return errors;
}

function validateWholeStyle(style: any, spec?: any): readonly ValidationError[] {
    return [...specValidateStyle(withoutExtensions(style), spec), ...validateExtensions(style)];
}

function validateSource(options: any): readonly ValidationError[] {
    if (!hasTileGrid(options.value)) return specValidateStyle.source(options);
    return [
        ...specValidateStyle.source({...options, value: withoutKey(options.value, 'tileGrid')}),
        ...validateTileGrid(options.key, options.value),
    ];
}

/**
 * The style specification's validator, which also knows the keys this library takes beyond the specification:
 * the `tileGrid` of a tile source and the `central-meridian` of the projection.
 */
export const validateStyle: ValidateStyle = extend(validateWholeStyle, {
    source: validateSource,
    sprite: specValidateStyle.sprite,
    glyphs: specValidateStyle.glyphs,
    layer: specValidateStyle.layer,
    light: specValidateStyle.light,
    sky: specValidateStyle.sky,
    terrain: specValidateStyle.terrain,
    filter: specValidateStyle.filter,
    paintProperty: specValidateStyle.paintProperty,
    layoutProperty: specValidateStyle.layoutProperty,
});

/**
 * The source types the spec has a schema for, and therefore the only ones it can judge. Taken from
 * the spec itself so the two cannot drift apart.
 */
export const SPEC_SOURCE_TYPES: ReadonlySet<string> = new Set(
    Object.keys(styleSpec)
        .filter(key => key.startsWith('source_'))
        .map(key => key.slice('source_'.length).replaceAll('_', '-'))
);

/**
 * The sources whose type the spec has no schema for, so it rejects them outright even though we
 * render them: `canvas`, and anything registered with {@link addSourceType}. They are the renderer's
 * business rather than the spec's, so the spec's complaints about them are dropped -- otherwise
 * `map.setStyle(map.getStyle())` would fail on a source the user added correctly.
 *
 * Each such source produces a single error keyed by `sources.<id>`, which is what is matched here.
 * @param style - the style about to be validated
 * @returns the `sources.<id>` key prefixes whose errors should be ignored
 */
function unjudgeableSourceKeys(style: StyleSpecification): string[] {
    return Object.entries(style.sources ?? {})
        .filter(([, source]) => !SPEC_SOURCE_TYPES.has(source.type))
        .map(([id]) => `sources.${id}`);
}

/**
 * Validates a whole style and emits what it finds, ignoring the sources the spec cannot judge.
 *
 * @param emitter - the object to fire {@link ErrorEvent}s on
 * @param style - the style to validate
 * @returns whether validation failed, i.e. whether the caller should give up on the style
 */
export function validateStyleAndEmit(emitter: Evented, style: StyleSpecification): boolean {
    const ignored = unjudgeableSourceKeys(style);
    const errors = validateStyle(style).filter(({message}) =>
        !ignored.some(key => message.startsWith(`${key}:`) || message.startsWith(`${key}.`))
    );
    return emitValidationErrors(emitter, errors);
}

/**
 * Emits everything a validator found, and reports whether any of it was severe enough to abort.
 *
 * Warnings are logged rather than emitted as errors: the style still renders, just not necessarily
 * as its author intended (e.g. a filter mixing deprecated syntax into an expression tree). Treating
 * them as errors would abort the whole style load and leave a blank map.
 * See https://github.com/maplibre/maplibre-style-spec/issues/1751
 *
 * @param emitter - the object to fire {@link ErrorEvent}s on
 * @param errors - what validation turned up, if anything
 * @returns whether validation failed, i.e. whether the caller should give up on the value
 */
export function emitValidationErrors(emitter: Evented, errors: readonly ValidationError[]): boolean {
    let hasErrors = false;
    for (const error of errors) {
        if (error.severity === 'warning') {
            warnOnce(error.message);
            continue;
        }
        emitter.fire(new ErrorEvent(new Error(error.message)));
        hasErrors = true;
    }
    return hasErrors;
}

/**
 * Runs a validator over a value and emits whatever it finds.
 *
 * @param emitter - the object to fire {@link ErrorEvent}s on
 * @param validator - the validator to run, e.g. {@link validateFilter}
 * @param params - what to validate: the `value`, plus whatever context the validator needs, such as
 * the `key` locating it in the style, or the surrounding `style` that {@link validateStyle.layer} looks at
 * @param options - setter options; validation is skipped entirely when `validate` is `false`
 * @returns whether validation failed, i.e. whether the caller should give up on the value
 */
export function validateAndEmit(
    emitter: Evented,
    validator: Validator,
    params: {value: unknown} & Record<string, unknown>,
    options?: StyleSetterOptions
): boolean {
    if (options?.validate === false) {
        return false;
    }
    return emitValidationErrors(emitter, validator({
        styleSpec,
        ...params
    }));
}
