import type {ProjectionSpecification} from '@maplibre/maplibre-gl-style-spec';

/**
 * @internal
 * The projection of a map whose style names none, unless {@link setDefaultProjection} changed it.
 */
export const SHIPPED_DEFAULT_PROJECTION: ProjectionSpecification['type'] = 'equal-earth';

let defaultProjection: ProjectionSpecification['type'] = SHIPPED_DEFAULT_PROJECTION;

/**
 * @experimental
 * The name of the projection a map is drawn in when its style has no `projection`: `equal-earth`, unless
 * {@link setDefaultProjection} changed it.
 */
export function getDefaultProjection(): ProjectionSpecification['type'] {
    return defaultProjection;
}

/**
 * @experimental
 * Sets the projection that maps are drawn in when their style has no `projection`, for example `'mercator'` to
 * draw such styles the way MapLibre GL JS does. It applies to styles loaded and to `setProjection()` calls made
 * afterwards; a map that is already drawn keeps its projection.
 *
 * @param name - a built-in projection name, or the name of one registered with `addProjection`
 */
export function setDefaultProjection(name: ProjectionSpecification['type']): void {
    defaultProjection = name;
}
