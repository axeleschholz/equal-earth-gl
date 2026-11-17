# The Equal Earth projection

This library is a fork of MapLibre GL JS that draws maps in the [Equal Earth projection](https://en.wikipedia.org/wiki/Equal_Earth_projection): a map of the whole world on which areas keep their proportions, so that a country twice the size of another covers twice as much of the screen. It matches EPSG:8857 on the WGS84 ellipsoid.

A style that names no projection is drawn in Equal Earth. A style that names `mercator`, `globe`, `vertical-perspective` or a projection registered with `addProjection` is drawn as MapLibre GL JS draws it.

```js
// Equal Earth, because the style has no `projection`.
const map = new maplibregl.Map({container: 'map', style: 'https://demotiles.maplibre.org/style.json'});

// Equal Earth by name, and back.
map.setProjection({type: 'equal-earth'});
map.setProjection({type: 'mercator'});

// Draw styles without a `projection` in mercator, as MapLibre GL JS does.
maplibregl.setDefaultProjection('mercator');
```

`setDefaultProjection` and `getDefaultProjection` are experimental. The default applies to styles loaded and to `setProjection()` calls made after it is set.

## Your sources do not change

Tile sources stay as they are. Vector, raster and raster-dem sources serve Web Mercator tiles, and the map warps them onto the Equal Earth plane on the GPU as it draws them. The map stays Equal Earth at every zoom level; it does not turn into Mercator when you zoom in.

GeoJSON sources are tiled directly on the Equal Earth plane in the workers, so they are exact up to both poles. Before tiling, lines and polygons are cut where they cross the antimeridian, and long edges get extra positions so that they follow the path they have on a Mercator map.

Web Mercator tiles hold no data beyond 85.051° of latitude. The strip from there to each pole is filled by extending the edge of the last row of tiles, as on the globe.

## What is different from a Mercator map

- **One world.** There are no world copies: the map has a left and a right edge at the antimeridian, and `renderWorldCopies` has no effect. A longitude past the antimeridian is the same place inside the world, so a marker at 200° is drawn at -160°. Bounds that span the antimeridian, such as 170° to 190°, are fitted as the whole width of the world.
- **Around the world.** The area outside the outline of the world is transparent, so the page shows through. The camera's center stays inside the world; the view may extend past it.
- **Zoom.** At zoom 0 the world is 512 pixels wide, as on a Mercator map, and about 249 pixels high. East-west scale at the equator matches Mercator's at the same zoom. North-south scale there is about 1.35 times Mercator's.
- **Tile detail.** A Mercator tile covers less of the screen the closer it is to a pole, so the map loads coarser tiles there: it picks the zoom level at which a tile's area on screen is closest to that of a tile on a flat map.
- **Angles.** Equal Earth keeps areas, not shapes. Shapes are sheared away from the central meridian and flattened toward the poles.

## What is drawn so far

This is stage 1 of 4.

| | From tile sources | From GeoJSON sources |
|---|---|---|
| `background`, `fill`, `line`, `raster` | Yes | Yes |
| `symbol`, `circle`, `heatmap` | Not yet | Yes |
| `hillshade`, `color-relief`, `fill-extrusion` | Not yet | `fill-extrusion` is untested |

A layer that is not drawn yet is left out, with one console warning for its type: `symbol layers on tile sources are not yet drawn in the equal-earth projection.` The rest of the style is drawn.

Not covered yet either: terrain, the sky, custom layers, and image, video and canvas sources. `queryRenderedFeatures` finds the features of GeoJSON sources; for tile sources it returns nothing yet, with a console warning. `querySourceFeatures` works for both. `line-dasharray` and `line-pattern` on tile sources stretch with the projection. A line, circle or label from a GeoJSON source that lies on the edge of the world extends past it by its own size.

## Performance

A GeoJSON source with long straight edges gains positions when it is loaded, most of all near the antimeridian. The deviation allowed is three eighths of a pixel at the source's `maxzoom`, so a source that is never drawn at high zoom loads faster with a lower `maxzoom`. As a measure: a ring of 361 positions half a degree apart becomes about 8,000 at the default `maxzoom` of 18.
