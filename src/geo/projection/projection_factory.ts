import {warnOnce} from '../../util/util.ts';
import {MercatorProjection} from './mercator_projection.ts';
import {GlobeProjection} from './globe_projection.ts';
import {VerticalPerspectiveProjection} from './vertical_perspective_projection.ts';
import {CRSWorldCoordinateHelper} from './crs.ts';
import {getRegisteredProjection} from './projection_crud.ts';
import {EqualEarthProjection, type CentralMeridianProjectionOption} from './equal_earth_projection.ts';
import {equalEarthWorldCoordinateHelper} from './equal_earth_world.ts';

import type {ProjectionSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {Projection} from './projection.ts';
import type {CameraProjectionKind} from '../../camera/camera_context.ts';

/** The name of the Equal Earth projection, which the style specification's projection names do not include. */
const EQUAL_EARTH = 'equal-earth' as ProjectionSpecification['type'];

/**
 * @internal
 * The style projection of a projection name or expression, and the projection the camera is projected with in it.
 * The camera's world mapping is the style projection's, see {@link Projection.worldCoordinateHelper}.
 *
 * @param options - what the style's projection object holds besides the name
 */
export function createProjectionFromName(name: ProjectionSpecification['type'], globalState: Record<string, any>, options: CentralMeridianProjectionOption = {}): {
    projection: Projection;
    cameraProjection: CameraProjectionKind;
} {
    const centralMeridian = options['central-meridian'];
    if (centralMeridian !== undefined && name !== EQUAL_EARTH) {
        warnOnce('The "central-meridian" of the projection is only used by the "equal-earth" projection, and is ignored.');
    }
    if (Array.isArray(name)) {
        const registeredName = findRegisteredProjectionName(name);
        if (registeredName) {
            warnOnce(`Projection expressions cannot use the registered projection "${registeredName}", which only works as a plain name. Falling back to the globe projection.`);
        }
        const globeProjection = new GlobeProjection({type: name}, globalState);
        return {
            projection: globeProjection,
            cameraProjection: 'globe',
        };
    }
    const registered = getRegisteredProjection(name);
    if (registered) {
        const worldCoordinateHelper = new CRSWorldCoordinateHelper(registered);
        return {
            projection: new MercatorProjection(worldCoordinateHelper),
            cameraProjection: 'mercator',
        };
    }
    switch (name) {
        case 'mercator':
        {
            return {
                projection: new MercatorProjection(),
                cameraProjection: 'mercator',
            };
        }
        case 'globe':
        {
            const globeProjection = new GlobeProjection({type: [
                'interpolate',
                ['linear'],
                ['zoom'],
                11,
                'vertical-perspective',
                12,
                'mercator'
            ]}, {});
            return {
                projection: globeProjection,
                cameraProjection: 'globe',
            };
        }
        case EQUAL_EARTH:
        {
            return {
                projection: new EqualEarthProjection(centralMeridian),
                cameraProjection: 'mercator',
            };
        }
        case 'vertical-perspective':
        {
            return {
                projection: new VerticalPerspectiveProjection(),
                cameraProjection: 'vertical-perspective',
            };
        }
        default:
        {
            warnOnce(`Unknown projection name: ${name}. Falling back to mercator projection.`);
            return {
                projection: new MercatorProjection(),
                cameraProjection: 'mercator',
            };
        }
    }
}

/** The built-in projections that are flat maps on a plane of their own, by name. */
const builtInPlanes = new Set<unknown>([equalEarthWorldCoordinateHelper.name]);

/**
 * @internal
 * Whether a projection name is that of a flat map on a plane that is not mercator's: a built-in one, or one
 * registered with `addProjection`. A camera for such a map cannot be constrained the way a mercator camera is.
 */
export function hasOwnPlane(name: ProjectionSpecification['type'] | undefined): boolean {
    return builtInPlanes.has(name) || (typeof name === 'string' && getRegisteredProjection(name) !== undefined);
}

/**
 * The first registered projection named anywhere in a projection expression, or `undefined` if it names none.
 */
function findRegisteredProjectionName(expression: unknown[]): string | undefined {
    return expression.flat(Infinity).find((item): item is string => typeof item === 'string' && getRegisteredProjection(item) !== undefined);
}
