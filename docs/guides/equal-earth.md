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

## What is drawn

This is stage 3 of 4: every layer type is drawn, from tile sources and from GeoJSON, so an ordinary basemap style renders complete, with its labels and its 3D buildings.

| | From tile sources | From GeoJSON sources |
|---|---|---|
| `background`, `fill`, `line`, `raster` | Yes | Yes |
| `symbol`, `circle`, `heatmap` | Yes | Yes |
| `hillshade`, `color-relief` | Yes | Does not apply |
| `fill-extrusion` | Yes | Yes |

Image, video and canvas sources are drawn too: their corners are placed in Web Mercator and the image is warped with the tiles. `queryRenderedFeatures` and `querySourceFeatures` work for every source. The sky and fog are drawn as on any flat map.

## Terrain

Terrain is not supported in `equal-earth` yet. `map.setTerrain()` and a style's `terrain` are kept, but the map is drawn without terrain, with one console warning. `map.getTerrain()` returns what was set. When the map moves to a projection that draws terrain, with `setProjection`, the terrain comes on; when it moves back, it goes off.

## Custom layers

A custom layer that projects with the shader prelude it is given works unchanged, as it does on the globe: with `shaderData.vertexShaderPrelude` and `shaderData.define` in its vertex shader and the uniforms of `defaultProjectionData`, `projectTileFor3D(mercatorXY, meters)` places a Mercator coordinate, 0 to 1, at an elevation in meters. Positions are computed in single precision, so a layer of building-sized detail jitters at high zoom, as on the globe.

A custom layer written for Mercator alone, which multiplies Mercator coordinates by `modelViewProjectionMatrix` or `defaultProjectionData.mainMatrix`, draws in the wrong place: on this map those matrices take positions on the Equal Earth plane. Use the prelude instead.

## Differences on tile sources

- **Labels and icons face the screen.** On a tile source, `text-pitch-alignment: map` and `icon-pitch-alignment: map` behave as `viewport`: text lying on the map would take on the stretch and shear of the projection. Labels along lines still follow their lines. Circles and heatmaps do lie on a pitched map and stay round.
- **Lengths that follow the tile.** `line-dasharray`, `line-pattern`, the spacing of labels along a line, and the `*-translate` properties are laid out in tile units, so they stretch with the projection, most toward the poles.
- **Tile zoom.** Away from the equator the map draws tiles of a lower zoom level than a Mercator map does at the same zoom, so a source's most detailed tiles appear a little later as you zoom in.
- **Clicks away from the equator.** `queryRenderedFeatures` measures the tolerance around a line or circle in tile units, which the projection stretches unevenly. It is set so that a feature can be hit wherever it is drawn, which makes it more generous than drawn along the other direction: at 70° north, up to about three times as wide east to west. A query at a place beyond 85.051° of latitude finds nothing from tile sources, which hold nothing there.

A line, circle or label from a GeoJSON source that lies on the edge of the world extends past it by its own size.

## Performance

A GeoJSON source with long straight edges gains positions when it is loaded, most of all near the antimeridian. The deviation allowed is three eighths of a pixel at the source's `maxzoom`, so a source that is never drawn at high zoom loads faster with a lower `maxzoom`. As a measure: a ring of 361 positions half a degree apart becomes about 8,000 at the default `maxzoom` of 18.
