# Equal Earth fork of MapLibre GL JS: design

Date: 2026-11-16
Base: MapLibre GL JS v6.18.0 (`7db3d5028`)
Status: awaiting approval

Items marked **(call)** were decided by the design author, not by the project owner, and are open to
correction.

## Intent

A fork of MapLibre GL JS whose map is drawn in the Equal Earth projection, and which does everything
the Mercator library does. The owner's first use is a thematic map. The wider purpose is a library
other people can build Equal Earth tools on, so parity and robustness matter more than a fast demo.

Equal Earth is an equal-area pseudocylindrical world projection (Šavrič, Patterson, Jenny, 2018). The
formula is published and free to implement.

## What exists upstream today

- `addProjection()` (experimental, since v6.15) registers a planar CRS: a forward/inverse pair plus a
  square quad tile grid. The flat camera, constraints, markers, hash and queries run on that CRS's
  plane through `WorldCoordinateHelper` (`src/geo/world_types.ts`). Equal Earth can be registered this
  way already.
- A registered CRS is drawn by `MercatorProjection` with the mercator shader variant: the tile grid
  *is* the world plane, and tile content is never reprojected. GeoJSON is the exception: workers
  project it into the CRS before tiling.
- Consequently every Mercator tile source (all standard basemaps) draws in the wrong place on such a
  map. Upstream tracks this as maplibre/maplibre#491 and lists it as unsupported in
  `docs/guides/custom-crs.md`.
- Globe shows the other half of what is needed: Mercator tiles bent in the vertex shader, subdivided
  tile meshes, pole caps, a covering-tiles provider that is not the mercator one, and CPU-side
  projection for symbols and queries.

The fork closes the gap between those two: a planar non-Mercator world plane **and** Mercator tiles
reprojected onto it.

## Goals

1. `projection: {type: 'equal-earth'}` is a built-in projection and the fork's default.
2. Any style that works on Mercator MapLibre renders correctly in Equal Earth with no change to its
   sources: vector, raster, raster-dem, GeoJSON, image, video, canvas.
3. The whole public API behaves sensibly: camera methods, `fitBounds`, `project`/`unproject`,
   `queryRenderedFeatures`, markers, popups, controls, hash, events, feature state.
4. The projection stays Equal Earth at every zoom. Areas on screen are proportional to areas on the
   earth at zoom 22 as at zoom 0.
5. Mercator, globe, vertical-perspective and registered CRSs keep working unchanged, so upstream
   releases can keep being merged.
6. The reprojection mechanism is written so it can be offered upstream for maplibre#491.

## Non-goals

- MapLibre Native.
- Removing Mercator or globe.
- A transition animation between Equal Earth and globe or Mercator.
- Tile generation tooling for native Equal Earth tiles (the renderer will read them in stage 4;
  producing them is someone else's tool).
- Interrupted or other world projections. The mechanism should not preclude them, but none ship.

## Anti-goals

- Falling back to Mercator rendering at high zoom, as globe does. That would silently break the
  equal-area property the fork exists for.
- Any change in behaviour or measurable slowdown of a map that uses `mercator` or `globe`.
- Code copied or adapted from Mapbox GL JS v2 or later, which has an Equal Earth implementation under
  a proprietary licence. This is a clean implementation from the published paper and from MapLibre's
  own BSD-3 code.
- Visible seams between tiles, or labels and click targets that disagree with the drawn geometry.

## Constraints

- Licence stays BSD-3-Clause with upstream notices intact.
- Follow the repo's `AGENTS.md` conventions (TSDoc on declarations, no change-narrating comments).
- Prefer new files over edits to shared files; where a shared file must change, add a seam rather
  than a branch on the projection name. This keeps merges from upstream cheap.
- The style specification lives in a separate package (`@maplibre/maplibre-gl-style-spec`). Stages
  1 to 3 must not need a forked style spec; the projection name is passed as a plain string, which
  the factory already tolerates. **(call)**

## Approaches

Three ways to draw existing tiles in Equal Earth were considered.

- **A. Package on upstream `addProjection`.** No fork; ship an Equal Earth CRS preset. Works for
  GeoJSON-only maps today. Rejected as the end state because no existing basemap renders.
- **B. GPU reprojection in a fork.** Bend Mercator tiles in the vertex shader on the flat camera, as
  globe does on the sphere. Every existing source works; cost is projection-aware coverage, meshes,
  labels and queries.
- **C. Re-tile in the workers.** Reproject and re-cut Mercator tiles into Equal Earth tiles before
  upload. Rejected: several source tiles per output tile, slow loads, seams, raster resampling loss.
- **D. Hard fork with Mercator removed.** Considered when the owner asked for the deepest option.
  Rejected: it ends upstream merges and plugin compatibility and still needs B's reprojection.

**Chosen by the owner: B+**, meaning B plus Equal Earth as the fork's identity: default projection,
native Equal Earth world plane and camera maths, native Equal Earth tile sources as first-class, own
package name.

## Design

### 1. The Equal Earth plane

A new `EqualEarthWorldCoordinateHelper` implements `WorldCoordinateHelper` with the closed-form
forward and a Newton-iteration inverse. It does not go through the generic `CRS` converter path, so
it needs no proj4 and no inverse-search fallbacks.

- Ellipsoidal form matching EPSG:8857 (WGS84, authalic latitude, authalic radius), so tiles cut by
  GDAL or PROJ in EPSG:8857 line up exactly in stage 4. **(call)**
- World square: side equals the projection's full width (about 34 487 918 m), centred on 0,0. The
  world occupies a centred band roughly 2.05:1 inside that square.
- No world copies, longitudes do not wrap, `renderWorldCopies` is ignored.
- Upstream's `WorldCoordinateHelper.wraps === false` currently means two things at once: "the plane
  does not wrap" and "tiles are already cut in this plane's grid" (it switches off the Mercator
  latitude correction in `hillshade_program.ts`, the latitude clamp in `mercator_utils.ts`, and turns
  on worker projection in `geojson_source.ts`). Equal Earth is the first plane where these differ.
  The flag is split in the shared interface: `wraps` keeps the first meaning, and the second moves to
  the per-source tile grid of section 2. This is a small edit to shared files, accepted because it
  is the seam upstream would need for maplibre#491 as well. **(call)**
- `hasLngLat` is false outside the world outline. `lngLatFromWorld` there returns the nearest point
  on the outline.
- Zoom keeps its meaning of "world square is 512 px at zoom 0". The equator therefore spans the same
  512 px as in Mercator, so east-west scale at the equator matches Mercator's, while north-south
  scale there is about 1.35 times Mercator's: equatorial Mercator tiles are drawn taller, not
  smaller. Documented, not compensated. **(call)**
- The helper takes a central meridian parameter, fixed at 0 until stage 4.

### 2. Decoupling the tile grid from the world plane

Today the code assumes a tile's square is an axis-aligned square of the world plane. The fork
introduces one concept to break that: a **tile grid** per source, and a **tile warp** from a grid to
the world plane.

- Grid `mercator` on plane `mercator`: identity warp, today's code path.
- Grid `mercator` on plane `equal-earth`: the Equal Earth warp, described below. This is every
  vector, raster and raster-dem source in stages 1 to 3.
- Grid equal to the plane: identity warp. This is a registered CRS today, GeoJSON sources on an Equal
  Earth map from stage 1, and native Equal Earth tile sources in stage 4.

GeoJSON is tiled natively on the Equal Earth plane, reusing upstream's worker-side projection path
with a built-in Equal Earth forward in the worker (no projection handler or `definition` string
needed). It is therefore exact to the poles and pays nothing for the warp, which matters for the
owner's thematic map. The grid is an internal per-source property from stage 1; stage 4 only makes it
a public source option. **(call)**

Mercator-grid sources carry no data beyond ±85.051°. Their pole caps are an extension of the edge
row, so goal 4's equal-area guarantee holds for the data such a source has, and for GeoJSON
everywhere.

The warp is one interface with a CPU implementation and a GLSL implementation that must agree:

```
warp(tileID, xInTile, yInTile) -> world x, y        // forward, exact in float64 on the CPU
bounds(tileID) -> axis-aligned box on the world plane
localScale(tileID, xInTile, yInTile) -> 2x2 Jacobian // for line width, circle radius, text along lines
```

Everything projection-dependent downstream (shaders, covering tiles, symbol projection, collision,
queries, image-source meshes) is written against this interface, not against Equal Earth, which is
what makes it upstreamable and leaves room for other projections.

### 3. Drawing

A new `EqualEarthProjection` implements `Projection` with its own shader variant
(`_projection_equal_earth.vertex.glsl` / `.fragment.glsl`) providing the same function set the
mercator and globe preludes provide (`projectTile`, `projectTileWithElevation`, `projectTileFor3D`,
`projectLineThickness`, `projectCircleRadius`), so layer shaders need no per-layer change beyond what
globe already required.

- **Precision.** 32-bit shader floats cannot evaluate the global formula accurately at high zoom. Two
  regimes, both Equal Earth:
  - low zoom: the exact formula, per vertex;
  - high zoom: a second-order expansion of the warp about the tile centre, with coefficients computed
    in float64 on the CPU and passed as per-tile uniforms.
  The switch zoom is chosen so that both regimes, and neighbouring tiles' expansions, agree to within
  0.05 px at the seam. The builder determines the zoom from measurement.
- **Subdivision.** Straight tile-space edges become curves, so fills, lines, raster quads and stencil
  masks use subdivided geometry through the existing `SubdivisionGranularitySetting` machinery.
  Granularity falls with zoom and reaches no subdivision once the curvature across a tile is below
  the same 0.05 px budget.
- **Poles.** Mercator tiles stop at ±85.051°. The caps to ±90° are filled by extending the edge row
  of the top and bottom tiles, reusing globe's pole-mesh approach (`allowPoles`).
- **Antimeridian.** The map has a left and right edge at ±180°. Tile-buffer geometry past the edge is
  clamped onto it and removed by the stencil.
- **Outside the world.** The background layer and all tile content are clipped to the world outline.
  The area outside is transparent, showing the page behind the canvas. **(call)**
- **Covering tiles.** A new `CoveringTilesDetailsProvider` computes each Mercator tile's bounding box
  on the Equal Earth plane from the warp and chooses level of detail by projected area: a Mercator
  tile is used at the zoom where its on-screen area is closest to a 512 px tile's. Equatorial tiles
  are then upsampled about 16% per axis on average and high-latitude tiles load at a lower Mercator
  zoom. This favours tile count over maximum sharpness. **(call)**
- **Screen-space quantities.** Line widths, circle radii with `pitch-alignment: viewport`, icons and
  text stay in pixels. Map-aligned quantities use the local Jacobian. Because Equal Earth is not
  conformal, a map-aligned circle is drawn with the area-preserving isotropic scale (square root of
  the Jacobian determinant), not as an ellipse. **(call)**

### 4. Camera

The flat ("mercator" kind) camera runs on the Equal Earth helper, as it does for a registered CRS.
Pitch and bearing work as on any flat map. Constraining follows upstream's behaviour for a
non-wrapping plane (`camera_constrain.ts`), with the rectangle narrowed: the camera centre is kept
inside the bounding rectangle of the world outline, not the square; the viewport may extend past it,
showing the transparent outside; there is no zoom floor beyond `minZoom`. This lets a thematic map
show the whole world with a margin. `maxBounds` works as upstream. **(call)** `fitBounds` and `cameraForBounds` take the bounding box on the plane
of the warped lng/lat rectangle, sampled along its edges, because a lng/lat rectangle is not a
rectangle in Equal Earth.

### 5. CPU-side parity

Each of these consumes the CPU warp, with a test asserting it lands where the GPU drew:

- symbol placement, text along lines, collision detection, symbol fading
- `queryRenderedFeatures`, `querySourceFeatures`, feature state hit-testing
- `project` / `unproject`, markers, popups, `getBounds`
- image, video and canvas sources (four lng/lat corners become a subdivided mesh)
- scale control: shows the scale along the parallel at the map centre, and says so in docs **(call)**
- hash, navigation, geolocate, attribution, fullscreen controls: expected to work unchanged; verified

### 6. Stages

Each stage ends releasable, with the existing upstream test suite still green.

1. **Draws.** Helper, built-in name, default projection, camera, covering tiles, warp (CPU and GLSL),
   subdivision, poles, world-outline clip, native GeoJSON tiling; layers background, fill, line,
   raster. Package identity
   and remotes. Result: the owner's thematic map on any Mercator basemap, without labels.
2. **Parity for flat maps.** Symbols and collision, queries, circle, heatmap, hillshade and
   color-relief, image/video/canvas sources, `fitBounds`, controls, pitch and bearing. Result: any
   2D style works.
3. **3D and extension points.** Fill-extrusion, terrain, sky, custom layers (projection data exposed
   to custom shaders the way globe exposes it).
4. **Equal Earth native.** Per-source tile grid option so native EPSG:8857 tiles draw with the
   identity warp alongside reprojected Mercator sources; central meridian option; these need a style
   spec extension, forked or proposed upstream at that point.

Stages 1 and 2 are the first public release. **(call)**

### 7. Testing and what "robust" means here

- Projection maths: unit tests against reference values from PROJ for EPSG:8857, forward/inverse
  round trips over a global grid including poles and ±180°.
- Equal-area property: a numerical test that sampled lng/lat cells keep a constant ratio of plane
  area to spherical area, through both shader regimes' CPU mirrors.
- CPU/GPU agreement and seams: render tests that draw known points and adjacent tiles at zooms either
  side of the regime switch and assert the 0.05 px budget.
- Render tests: an `equal-earth` suite alongside the existing ones in `test/integration/render`,
  covering every layer type per stage, poles, antimeridian, pitch, high zoom.
- The default projection is a single exported constant read where `style.ts` hard-codes
  `'mercator'` today. The library ships with it set to `equal-earth`. The test harness pins it to
  `mercator` for the upstream unit, render and query suites, whose fixtures stay byte-identical to
  upstream; the `equal-earth` suite runs with the shipped default. A style that names `mercator` or
  `globe` gets exactly that. A style that names no projection renders in Equal Earth after porting,
  which is the point of the fork and is stated at the top of the README. **(call)**
- Regression: the unmodified upstream unit, render and query suites pass under that pin. Benchmarks for a Mercator
  map show no regression; Equal Earth frame time is within 1.5x of globe on the same style. **(call)**

### 8. Fork identity and upkeep

- Package name `equal-earth-gl`, global `equalearthgl`, with the `maplibregl` API shape unchanged so
  existing code ports by changing the import. **(call; the name is the owner's to choose)**
- README states plainly that this is a fork of MapLibre GL JS and what differs.
- Git: `upstream` remote is maplibre/maplibre-gl-js; work happens on the fork's `main`; upstream
  releases are merged, not rebased. Version scheme tracks upstream with a suffix, for example
  `6.18.0-ee.1`. **(call)**
- No hosting, npm publishing or GitHub repository creation is part of this design; those are outward
  actions the owner triggers.

## Left to the builder

- Confirming that the style-spec validator accepts the plain name `equal-earth`; if it does not, the
  smallest local allowance that avoids forking the spec package.

- The regime-switch zoom and subdivision granularity table, from measurement against the budgets.
- The exact shape of the warp interface and how per-tile uniforms are threaded through the painter.
- Whether the covering-tiles provider subclasses the mercator one or stands alone.
- The Newton iteration count and tolerances for the inverse.
- How the world outline clip is implemented (stencil mesh or fragment test).
