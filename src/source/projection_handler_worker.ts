import {CRSWorldCoordinateHelper, identityCrs, type CRS} from '../geo/projection/crs.ts';
import {warnOnce} from '../util/util.ts';
import {equalEarthWorldCoordinateHelper, getEqualEarthWorldCoordinateHelper} from '../geo/projection/equal_earth_world.ts';

import type {GeoJSONPlaneHelper} from '../util/geojson_reproject.ts';

/**
 * @experimental
 * Builds the converter for a coordinate reference system from its definition string, the way `proj4(definition)`
 * does: `forward` takes lng/lat to CRS coordinates and `inverse` takes them back. A worker script sets one with
 * `self.setProjectionHandler`, loaded through {@link importScriptInWorkers}, so that GeoJSON sources follow a
 * registered projection that has a `definition`.
 */
export type ProjectionHandler = (definition: string) => CRS['projection'];

let projectionHandler: ProjectionHandler | null = null;

/**
 * The converters the projection handler has built, by the string it built each from, so that data loaded again in the
 * same projection does not make it parse the string again.
 */
const projections = new Map<string, CRS['projection']>();

/**
 * @internal
 * Sets the worker's projection handler; a later call replaces it, and `null` removes it.
 */
export function setProjectionHandler(handler: ProjectionHandler | null): void {
    projectionHandler = handler;
    projections.clear();
}

/**
 * The planes of the built-in projections that GeoJSON is tiled on in the workers, by projection name and for the
 * central meridian the map is drawn around. Their world mappings are part of the library, so they need neither a
 * definition string nor a projection handler.
 */
const builtInPlanes: Record<string, (centralMeridian: number) => GeoJSONPlaneHelper> = {
    [equalEarthWorldCoordinateHelper.name]: getEqualEarthWorldCoordinateHelper,
};

/**
 * What the main thread tells a worker of the plane it tiles GeoJSON on: a registered projection's name, definition
 * and tile matrix set, or a built-in plane's name and central meridian.
 */
export type WorkerPlaneParameters = Pick<CRS, 'name' | 'definition' | 'tileMatrixSet'> & {centralMeridian?: number};

/**
 * @internal
 * The world coordinate helper a worker uses for the projection the main thread describes: that of a built-in
 * plane by its name, or for a registered projection the one built from the definition string through the
 * projection handler, or the built-in identity CRS when there is none. `undefined`, with a warning, when a
 * definition string comes with no handler set.
 */
export function createWorkerCRSHelper(crs: WorkerPlaneParameters): GeoJSONPlaneHelper | undefined {
    if (!crs.definition && Object.hasOwn(builtInPlanes, crs.name)) return builtInPlanes[crs.name](crs.centralMeridian ?? 0);
    if (!crs.definition) return new CRSWorldCoordinateHelper(identityCrs);
    if (!projectionHandler) {
        warnOnce('GeoJSON sources are drawn in the wrong place: no projection handler is set in the workers, see `setProjectionHandler` in the custom CRS guide.');
        return undefined;
    }
    if (!projections.has(crs.definition)) projections.set(crs.definition, projectionHandler(crs.definition));
    return new CRSWorldCoordinateHelper({name: crs.name, definition: crs.definition, projection: projections.get(crs.definition), tileMatrixSet: crs.tileMatrixSet});
}
