import {ErrorEvent, Evented} from '../util/evented.ts';
import {MapSourceDataEvent, type SourceEventType} from '../ui/events.ts';
import {ensureError, extend, pick} from '../util/util.ts';
import {loadTileJson} from './load_tilejson.ts';
import {TileBounds} from '../tile/tile_bounds.ts';
import {ResourceType} from '../util/request_manager.ts';
import {MessageType} from '../util/actor_messages.ts';
import {isAbortError} from '../util/abort_error.ts';
import {TileManager} from '../tile/tile_manager.ts';
import {resolveSourceTileGrid, sourceGridHasTile, sourceGridHelper, type TileGridSourceOption} from './source_tile_grid.ts';
import {SubdivisionGranularitySetting} from '../render/subdivision_granularity_settings.ts';
import {mercatorWorldCoordinateHelper} from '../geo/mercator_coordinate.ts';

import type {Source} from './source.ts';
import type {TileGrid} from '../geo/projection/tile_warp.ts';
import type {WorldCoordinateHelper} from '../geo/world_types.ts';
import type {TileMatrixSet} from '../geo/projection/tile_matrix_set.ts';
import type {CanonicalTileID, OverscaledTileID} from '../tile/tile_id.ts';
import type {Map} from '../ui/map.ts';
import type {Dispatcher} from '../util/dispatcher.ts';
import type {Tile} from '../tile/tile.ts';
import type {VectorSourceSpecification, PromoteIdSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {RequestParameters} from '../util/ajax';
import type {WorkerTileParameters, OverzoomParameters, WorkerTileResult, TileEncoding} from './worker_source.ts';

export type VectorTileSourceOptions = VectorSourceSpecification & {
    collectResourceTiming?: boolean;
    tileSize?: number;
    /**
     * Whether the tileset leaves tiles out. When `true`, a tile the server answers with a 404 shows the part of the
     * nearest ancestor that exists, up to 10 zoom levels up and no lower than the source's minzoom, sliced the way an
     * overzoomed tile is sliced from the source's maxzoom tile. When `false`, a missing tile loads empty. The source's
     * TileJSON can set it too, with the source option winning.
     * @defaultValue false
     * @experimental
     */
    sparse?: boolean;
};

export type LoadTileResult = {
    /**
     * Indicates that the tile requested was not modified.
     */
    unmodified?: boolean;
};

/**
 * A source containing vector tiles in [Maplibre Vector Tile format](https://maplibre.org/maplibre-tile-spec/) or [Mapbox Vector Tile format](https://docs.mapbox.com/vector-tiles/reference/).
 * (See the [Style Specification](https://maplibre.org/maplibre-style-spec/) for detailed documentation of options.)
 *
 * @group Sources
 *
 * @example
 * ```ts
 * map.addSource('some id', {
 *     type: 'vector',
 *     url: 'https://demotiles.maplibre.org/tiles/tiles.json'
 * });
 * ```
 *
 * @example
 * ```ts
 * map.addSource('some id', {
 *     type: 'vector',
 *     tiles: ['https://d25uarhxywzl1j.cloudfront.net/v0.1/{z}/{x}/{y}.mvt'],
 *     minzoom: 6,
 *     maxzoom: 14
 * });
 * ```
 *
 * @example
 * ```ts
 * map.getSource('some id').setUrl("https://demotiles.maplibre.org/tiles/tiles.json");
 * ```
 *
 * @example
 * ```ts
 * map.getSource('some id').setTiles(['https://d25uarhxywzl1j.cloudfront.net/v0.1/{z}/{x}/{y}.mvt']);
 * ```
 * @see [Add a vector tile source](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-vector-tile-source/)
 */
export class VectorTileSource extends Evented<SourceEventType> implements Source {
    type: 'vector';
    id: string;
    minzoom: number;
    maxzoom: number;
    url: string;
    scheme: string;
    encoding: TileEncoding;
    tileSize: number;
    sparse: boolean;
    promoteId: PromoteIdSpecification;

    _options: VectorSourceSpecification & TileGridSourceOption;
    _collectResourceTiming: boolean;
    dispatcher: Dispatcher;
    map: Map;
    bounds: [number, number, number, number];
    tiles: string[];
    tileBounds: TileBounds;
    /** The world mapping of the tiles' grid, see `sourceGridHelper`, as of the plane the source last looked at. */
    _gridHelper: WorldCoordinateHelper | null | undefined;
    reparseOverscaled: boolean;
    isTileClipped: boolean;
    _tileJSONRequest: AbortController;
    _loaded: boolean;

    constructor(id: string, options: VectorTileSourceOptions, dispatcher: Dispatcher, eventedParent: Evented) {
        super();
        this.id = id;
        this.dispatcher = dispatcher;

        this.type = 'vector';
        this.minzoom = 0;
        this.maxzoom = 22;
        this.scheme = 'xyz';
        this.tileSize = 512;
        this.sparse = false;
        this.reparseOverscaled = true;
        this.isTileClipped = true;
        this._loaded = false;

        extend(this, pick(options, ['url', 'scheme', 'tileSize', 'promoteId', 'encoding']));
        this._options = extend({type: 'vector'}, options);

        this._collectResourceTiming = options.collectResourceTiming;

        if (this.tileSize !== 512) {
            throw new Error('vector tile sources must have a tileSize of 512');
        }

        this.setEventedParent(eventedParent);
    }

    async load(sourceDataChanged: boolean = false): Promise<void> {
        this._loaded = false;
        this.fire(new MapSourceDataEvent('dataloading'));
        this._tileJSONRequest = new AbortController();
        try {
            const tileJSON = await loadTileJson(this._options, this.map._requestManager, this._tileJSONRequest, this.map._ownerWindow);
            this._tileJSONRequest = null;
            this._loaded = true;
            if (tileJSON) {
                extend(this, tileJSON);
                if (this.bounds || this._options.tileGrid !== undefined) this._updateTileBounds();

                // `content` is included here to prevent a race condition where `Style._updateSources` is called
                // before the TileJSON arrives. this makes sure the tiles needed are loaded once TileJSON arrives
                // ref: https://github.com/mapbox/mapbox-gl-js/pull/4347#discussion_r104418088
                this.fire(new MapSourceDataEvent('data', {sourceDataType: 'metadata'}));
                this.fire(new MapSourceDataEvent('data', {sourceDataType: 'content', sourceDataChanged}));
            }
        } catch (err) {
            this._tileJSONRequest = null;
            this._loaded = true; // let's pretend it's loaded so the source will be ignored

            // only fire error event if it is not due to aborting the request
            if (!isAbortError(err)) {
                this.fire(new ErrorEvent(ensureError(err)));
            }
        }
    }

    loaded(): boolean {
        return this._loaded;
    }

    /**
     * The grid the tiles are drawn in on the map's plane when the `tileGrid` option makes it another than the
     * plane's sources are taken to be cut in.
     */
    get tileGrid(): TileGrid | undefined {
        if (this._options.tileGrid === undefined || !this.map) return undefined;
        return resolveSourceTileGrid(this._options.tileGrid, this.map.style.projection.worldCoordinateHelper, !!this.map.terrain) ?? undefined;
    }

    /**
     * The tiles are of use on another plane as long as their grid is drawn there the same way, which mercator
     * tiles are in every built-in projection. Tiles of a plane's own grid are not, so they are dropped. A source
     * that has neither bounds nor a `tileGrid` holds nothing that depends on the plane.
     */
    onProjectionChange(): boolean {
        const previous = this._gridHelper;
        if (previous === undefined) return false;
        this._updateTileBounds();
        return previous !== this._gridHelper;
    }

    /** Takes the world mapping of the tiles' grid on the map's plane, and expresses the source's bounds in it. */
    _updateTileBounds(): void {
        this._gridHelper = sourceGridHelper(this._options.tileGrid, this.map.style.projection.worldCoordinateHelper, !!this.map.terrain);
        if (this.bounds && this._gridHelper) this.tileBounds = new TileBounds(this.bounds, this.minzoom, this.maxzoom, this._gridHelper);
    }

    /** The tile matrix set of the tiles' grid, which the `{bbox}` of a tile URL is expressed in. */
    _getTileMatrixSet(): TileMatrixSet {
        return (sourceGridHelper(this._options.tileGrid, this.map.style.projection.worldCoordinateHelper, !!this.map.terrain) ?? mercatorWorldCoordinateHelper).tileMatrixSet;
    }

    hasTile(tileID: OverscaledTileID): boolean {
        if (this._options.tileGrid !== undefined && !sourceGridHasTile(this._options.tileGrid, this.map.style.projection.worldCoordinateHelper, tileID.canonical, !!this.map.terrain)) return false;
        return !this.tileBounds || this.tileBounds.contains(tileID.canonical);
    }

    onAdd(map: Map): void {
        this.map = map;
        this.load();
    }

    setSourceProperty(callback: Function): void {
        if (this._tileJSONRequest) {
            this._tileJSONRequest.abort();
        }

        callback();

        this.load(true);
    }

    /**
     * Sets the source `tiles` property and re-renders the map.
     *
     * @param tiles - An array of one or more tile source URLs, as in the TileJSON spec.
     */
    setTiles(tiles: string[]): this {
        this.setSourceProperty(() => {
            this.tiles = tiles;
            this._options.tiles = tiles;
        });

        return this;
    }

    /**
     * Sets the source `url` property and re-renders the map.
     *
     * @param url - A URL to a TileJSON resource. Supported protocols are `http:` and `https:`.
     */
    setUrl(url: string): this {
        this.setSourceProperty(() => {
            this.url = url;
            this._options.url = url;
        });

        return this;
    }

    onRemove(): void {
        if (this._tileJSONRequest) {
            this._tileJSONRequest.abort();
            this._tileJSONRequest = null;
        }
    }

    serialize(): VectorSourceSpecification & TileGridSourceOption {
        return extend({}, this._options);
    }

    async loadTile(tile: Tile): Promise<LoadTileResult | void> {
        const url = tile.tileID.canonical.url(this.tiles, this.map.getPixelRatio(), this.scheme, this._getTileMatrixSet());
        const params: WorkerTileParameters = {
            request: await this.map._requestManager.transformRequest(url, ResourceType.Tile),
            uid: tile.uid,
            tileID: tile.tileID,
            zoom: tile.tileID.overscaledZ,
            tileSize: this.tileSize * tile.tileID.overscaleFactor(),
            type: this.type,
            source: this.id,
            pixelRatio: this.map.getPixelRatio(),
            showCollisionBoxes: this.map.showCollisionBoxes,
            promoteId: this.promoteId,
            subdivisionGranularity: this.tileGrid === 'plane' ? SubdivisionGranularitySetting.noSubdivision : this.map.style.projection.subdivisionGranularity,
            encoding: this.encoding,
            overzoomParameters: await this._getOverzoomParameters(tile),
            etag: tile.etag
        };
        this._setAcceptHeader(params.request);
        params.request.collectResourceTiming = this._collectResourceTiming;
        await this.dispatcher.waitForInitComplete();
        if (tile.aborted) {
            return;
        }
        let messageType: MessageType.loadTile | MessageType.reloadTile = MessageType.reloadTile;
        if (!tile.actor || tile.state === 'expired') {
            tile.actor = this.dispatcher.getReadyActor();
            messageType = MessageType.loadTile;
        } else if (tile.state === 'loading') {
            return new Promise<void>((resolve, reject) => {
                tile.reloadPromise = {resolve, reject};
            });
        }
        tile.abortController = new AbortController();
        let data: WorkerTileResult | null;
        try {
            data = await tile.actor.sendAsync({type: messageType, data: params}, tile.abortController);
        } catch (err) {
            delete tile.abortController;

            if (tile.aborted || isAbortError(err)) {
                return;
            }
            if (err && err.status !== 404) {
                throw err;
            }
            data = null;
        }
        delete tile.abortController;

        if (tile.aborted) {
            return;
        }
        const result: LoadTileResult = {};
        if (data?.resourceTiming) {
            tile.resourceTiming = data.resourceTiming;
        }
        if (data === null && this.sparse) {
            data = await this._loadFromNearestAncestor(tile, params);
            if (tile.aborted) {
                return;
            }
        }
        this._afterTileLoadWorkerResponse(tile, data);
        if (data?.etagUnmodified) result.unmodified = true;
        this._reloadIfRequestedWhileLoading(tile);
        return result;
    }

    /**
     * Loads a tile the server answered with a 404 from the nearest ancestor that exists, sliced to the tile the way an
     * overzoomed tile is sliced from the source's maxzoom tile. The search starts one level above the tile that was fetched
     * (the maxzoom tile when the tile is overzoomed) and goes up at most `TileManager.maxUnderzooming` levels, as far as
     * the tile manager looks for a loaded parent to show in place of a missing raster tile, and no further than the
     * source's minzoom. Returns null when every ancestor in reach answered with a 404 too: the tile then loads empty and
     * draws nothing, as it does after a 404 when the source is not sparse.
     */
    private async _loadFromNearestAncestor(tile: Tile, params: WorkerTileParameters): Promise<WorkerTileResult | null> {
        const fetchedZ = Math.min(tile.tileID.canonical.z, this.maxzoom);
        const lowestZ = Math.max(fetchedZ - TileManager.maxUnderzooming, this.minzoom);
        for (let z = fetchedZ - 1; z >= lowestZ; z--) {
            const ancestorID = tile.tileID.scaledTo(z).canonical;
            params.overzoomParameters = {
                maxZoomTileID: ancestorID,
                overzoomRequest: await this._getTileRequest(ancestorID)
            };
            tile.abortController = new AbortController();
            try {
                const data = await tile.actor.sendAsync({type: MessageType.loadTile, data: params}, tile.abortController);
                delete tile.abortController;
                return data;
            } catch (err) {
                delete tile.abortController;
                if (tile.aborted || isAbortError(err)) {
                    return null;
                }
                if (err && err.status !== 404) {
                    throw err;
                }
            }
        }
        return null;
    }

    /**
     * When the requested tile has a higher canonical Z than source maxzoom, pass overzoom parameters so worker can load the
     * deepest tile at source max zoom to generate sub tiles using geojsonvt for highest performance on vector overscaling
     */
    private async _getOverzoomParameters(tile: Tile): Promise<OverzoomParameters | undefined> {
        if (tile.tileID.canonical.z <= this.maxzoom) {
            return undefined;
        }
        if (this.map._zoomLevelsToOverscale === undefined) {
            return undefined;
        }
        const maxZoomTileID = tile.tileID.scaledTo(this.maxzoom).canonical;
        return {
            maxZoomTileID,
            overzoomRequest: await this._getTileRequest(maxZoomTileID)
        };
    }

    private async _getTileRequest(tileID: CanonicalTileID): Promise<RequestParameters> {
        const url = tileID.url(this.tiles, this.map.getPixelRatio(), this.scheme, this._getTileMatrixSet());
        const request = await this.map._requestManager.transformRequest(url, ResourceType.Tile);
        this._setAcceptHeader(request);
        return request;
    }

    /**
     * Sets the Accept header specifically for MLT requests.
     * 
     * @param request - parameters to update.
     * @see {@link https://github.com/maplibre/maplibre-native/pull/4231#discussion_r4216650681}
     */
    private _setAcceptHeader(request: RequestParameters) {
        if (this.encoding === 'mlt') {
            request.headers ??= {};
            request.headers.Accept ??= 'application/vnd.maplibre-tile';
        }
    }

    private _afterTileLoadWorkerResponse(tile: Tile, data: WorkerTileResult | null) {
        if (data && this.map._refreshExpiredTiles) {
            tile.setExpiryData(data);
        }
        tile.etag = data?.etag;
        tile.loadVectorData(data, this.map.style);
    }

    private _reloadIfRequestedWhileLoading(tile: Tile) {
        if (tile.reloadPromise) {
            const reloadPromise = tile.reloadPromise;
            tile.reloadPromise = null;
            this.loadTile(tile).then(reloadPromise.resolve).catch(reloadPromise.reject);
        }
    }

    async abortTile(tile: Tile): Promise<void> {
        if (tile.abortController) {
            tile.abortController.abort();
            delete tile.abortController;
        }
        if (tile.actor) {
            await tile.actor.sendAsync({
                type: MessageType.abortTile,
                data: {uid: tile.uid, type: this.type, source: this.id}
            });
        }
    }

    /**
     * Removes the tile from every worker, since an expired tile may be reloaded on a different worker.
     */
    async unloadTile(tile: Tile): Promise<void> {
        tile.unloadVectorData();
        if (tile.actor) {
            await this.dispatcher.broadcast(MessageType.removeTile, {uid: tile.uid, type: this.type, source: this.id});
        }
    }

    hasTransition() {
        return false;
    }
}
