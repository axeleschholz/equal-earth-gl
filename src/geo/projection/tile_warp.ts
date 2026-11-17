/**
 * The grid a source's tiles are cut in: `mercator` for Web Mercator tiles, or `plane` for the quad grid of the
 * world plane the map is drawn on. The two are the same grid on a mercator map.
 */
export type TileGrid = 'mercator' | 'plane';
