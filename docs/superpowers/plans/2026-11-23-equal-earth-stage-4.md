# Equal Earth Stage 4 ("Equal Earth native") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tile sources cut in the Equal Earth grid draw beside warped Mercator sources, and the map can be centred on any meridian.

**Architecture:** The internal per-source tile grid becomes a public source option, `tileGrid`, which names the grid the tiles are cut in; a source whose grid is the plane's own draws with the identity warp, as GeoJSON does. The central meridian is a parameter of the Equal Earth plane and of its tile warp: a Mercator tile the edge of the world runs through is drawn as two copies, told apart by the tile ID's `wrap`, each cut at the edge in the fragment shader.

**Tech Stack:** TypeScript, WebGL2 GLSL, vitest, the repo's render-test harness.

**Spec:** `docs/superpowers/specs/2026-11-16-equal-earth-design.md`, section 6 stage 4, sections 1 and 2. Builds on stages 1 to 3 as shipped in `v6.18.0-ee.3`.

## Global Constraints

- Everything in the earlier stages' Global Constraints holds: BSD-3, no Mapbox GL JS v2+ code, `AGENTS.md`, seams not name branches, upstream fixtures byte-identical, `mercator`/`globe`/`vertical-perspective`/registered CRS behave and perform as before, CPU and GPU agree within 0.05 px.
- The style-spec package is not forked. The two extension keys are taken out of what the spec's validator sees and validated here.
- With central meridian 0 every existing Equal Earth render test passes unchanged.
- Commit after every task, trailer `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Decisions carried into every task

- **Source option.** `tileGrid?: 'mercator' | 'equal-earth'` on `vector`, `raster` and `raster-dem` sources. Absent means Mercator tiles, as before. `equal-earth` names the quad grid of EPSG:8857 with central meridian 0: tile 0/0/0 is the square of side 34 487 918.12 m centred on 0,0. Tiles wholly above or below the world do not exist and are not requested.
- **Resolving it.** `WorldCoordinateHelper.tileGridName?: string` is the public name of the plane's own grid (`mercator`, `equal-earth` at central meridian 0, none otherwise). `resolveSourceTileGrid(option, helper): TileGrid | undefined | null` gives `undefined` for no option, `'plane'` when the option names the plane's grid, `'mercator'` when it is `mercator` and the plane warps Mercator tiles, else `null`: the source cannot be drawn on this plane, has no tiles, and warns once.
- **Central meridian.** `projection: {type: 'equal-earth', 'central-meridian': 150}`, a number in -180..180, default 0. `getEqualEarthWorldCoordinateHelper(centralMeridian)` and `getEqualEarthTileWarp(centralMeridian)` return one shared instance per value. `WorldCoordinateHelper.centralMeridian?: number` carries it to the worker.
- **The window.** With central meridian λ0 the world shows Mercator x from `s - 1` to `s`, where `s = (λ0 / 360 mod 1)`, the Mercator x of the meridian opposite λ0, taken as 1 when 0. A tile copy with `wrap` w lies at Mercator x + w; copies with w = 0 and w = -1 are drawn. `TileWarp.window(tile, wrap): [minX, maxX] | null` gives the part of the copy inside the world in tile units, `null` when none is.
- **Cutting at the edge.** The vertex shader no longer clamps positions to the edge of the world. Every fragment shader that draws tile content calls `clipAntimeridian()`, which discards fragments whose tile x is outside the window when bit 1 of `u_projection_clip_antimeridian` is set. The window reaches the shader in `u_projection_tile_mercator_coords`: derived from x and z below the expansion zoom, and as `x = minX`, `y = maxX` from it.

## Review Focus

1. **A native raster and a native vector source over a warped Mercator basemap:** coastlines coincide to the pixel from z0 to the sources' maxzoom and when overzoomed.
2. **Central meridian 150 and -90 with a full basemap:** no gap or doubled content along either edge of the world, labels near the edge drawn once, the true antimeridian mid-map shows no seam.
3. **Clicking a feature in each of the two copies of a tile the edge runs through:** returned once.
4. **Changing the central meridian at runtime** with GeoJSON, a tile source and an image source loaded: everything redraws in the new place, no stale tiles.
5. **A `tileGrid: 'equal-earth'` source on a Mercator or globe map, or with a central meridian other than 0:** not drawn, one warning, no requests, no exception.

---

### Task 1: The `tileGrid` source option

**Files:** `src/geo/projection/tile_warp.ts`, `src/geo/world_types.ts`, `equal_earth_world.ts`, `mercator_coordinate.ts`, `src/style/validate_style.ts`, `src/source/vector_tile_source.ts`, `raster_tile_source.ts`, `raster_dem_tile_source.ts`, `src/source/tile_bounds.ts` or a new `src/source/tile_grid_option.ts`, `src/index.ts`.

- [ ] **Step 1: Failing tests.** `resolveSourceTileGrid` for each row of the decision above. `validateStyle.source` and whole-style validation accept `tileGrid: 'equal-earth'` on the three types and report `sources.x.tileGrid: expected one of [mercator, equal-earth], "foo" found` otherwise. A vector source with `tileGrid: 'equal-earth'` on an Equal Earth map: `source.tileGrid === 'plane'`, `serialize()` keeps the option, the tile URL's `{bbox}` is in Equal Earth meters, `hasTile` is false for 2/0/0 (above the world) and true for 2/1/1, and worker params carry no subdivision. The same source on a Mercator map: `hasTile` false for every tile and one warning. A source without the option on an Equal Earth map puts Mercator meters in `{bbox}`. Switching projection clears the tiles of a source whose resolved grid changes.
- [ ] **Step 2:** Implement. Commit `feat: tileGrid source option for tiles cut in the Equal Earth grid`.

### Task 2: Native sources drawn and queried

**Files:** fixtures under `test/integration/assets/tiles/equal-earth/`, render tests `native-*` in `test/integration/render/tests/projection/equal-earth/`.

- [ ] **Step 1:** Generate fixtures once: vector tiles z0 to z2 of the countries GeoJSON the stage 1 tests use, cut on the plane by the worker's own tiling; raster tiles z0 to z1 resampled from the Mercator raster fixture.
- [ ] **Step 2: Render tests:** `native-vector-world` (fill, line and symbol from the native source at z0), `native-vector-over-mercator` (native outlines over the warped Mercator fill of the same data at z2, 60°N: they coincide), `native-raster-world`, `native-raster-overzoom` (z4), `native-on-mercator-map` (nothing drawn). Unit test: `queryRenderedFeatures` at the screen position of a country returns it from the native source.
- [ ] **Step 3:** Fix what the tests show. Commit `test: native Equal Earth tile sources`.

### Task 3: The plane and the warp take a central meridian

**Files:** `equal_earth_world.ts`, `equal_earth_tile_warp.ts`, `tile_warp.ts`, `warped_projection_data.ts`, `_projection_equal_earth.*.glsl`, the fragment shaders that draw tile content, `test/unit/lib/warped_shader_mirror.ts`.

- [ ] **Step 1: Failing tests.** Helper at λ0 = 150: `worldFromLngLat(150, 0)` is the centre, `(-30, 0)` and `(-30.0001, 0)` land on opposite edges, round trip within 1e-9 for 200 positions, `tileGridName` undefined; at 0 it is the existing singleton. Warp at 150: `window` for z0 wrap 0 is `[0, s * 8192]` and wrap -1 `[s * 8192, 8192]`; for a z3 tile clear of the edge, one wrap gives `[-Infinity, Infinity]`-like bounds covering the tile and the other `null`; `warp` of a position equals the helper's `worldFromLngLat` of its lng/lat inside the window, for both copies. Shader mirror agrees with `warp` within 0.05 px at z0, 2, 3, 9, 16, 22 for both copies, and reports a fragment outside the window as discarded.
- [ ] **Step 2:** Implement: warp parametrised, `window`, expansion's kappa from the window, projection data (`tileMercatorCoords`, bit 1 when an edge is within one tile width of the tile), shader without the clamp, `clipAntimeridian()` reading the window, called from every tile-content fragment shader. Mercator and globe preludes keep their empty or existing definitions.
- [ ] **Step 3:** All existing render tests pass unchanged. Commit `feat: central meridian in the Equal Earth plane and tile warp`.

### Task 4: Tiles, placement and queries across the edge

**Files:** `covering_tiles.ts`, `warped_covering_tiles_details_provider.ts`, `src/symbol/placement.ts`, `src/tile/tile_manager.ts`, `src/source/image_source.ts`.

- [ ] **Step 1: Failing tests.** Covering tiles at λ0 = 150, z0: 0/0/0 with wraps 0 and -1; at z3 centred on the edge: tiles on the far side have the other wrap, none is outside its window. Placement: a symbol whose anchor is outside its copy's window is not placed; the same symbol in the other copy is. `tilesIn` for a point in each copy returns that copy with the point's tile coordinates; a box across the true antimeridian mid-map returns tiles on both sides of it with a connected query polygon.
- [ ] **Step 2:** Implement: provider seams `getRootWraps` and `hasTile`, placement check, query geometry in window coordinates.
- [ ] **Step 3:** Commit `feat: select, place and query tiles across the edge of a re-centred world`.

### Task 5: The projection option, GeoJSON and runtime changes

**Files:** `projection_factory.ts`, `src/style/style.ts`, `validate_style.ts`, `geojson_source.ts`, `geojson_worker_source.ts`, `projection_handler_worker.ts`, `src/util/geojson_plane_paths.ts`, `src/ui/map.ts` (docs).

- [ ] **Step 1: Failing tests.** Style with `projection: {type: 'equal-earth', 'central-meridian': 150}` validates; 200 or a string is an error. `map.setProjection` with a new meridian swaps the helper, keeps the centre's lng/lat, clears tile sources and re-tiles GeoJSON; `getProjection()` returns the option. On `mercator` the key is ignored with one warning. Worker: a line from 170°E to 170°W at λ0 = 180 is one unbroken path; a line from 10°W to 10°E is cut in two.
- [ ] **Step 2: Render tests** `meridian-150-world` (raster and vector basemap, z0), `meridian-150-geojson`, `meridian-minus-90-line-tiles`, `meridian-150-text` (labels at both edges), `meridian-150-z5-edge` (centred on the edge at z5), `meridian-runtime-change`.
- [ ] **Step 3:** Implement, inspect every image, commit `feat: central-meridian projection option`.

### Task 6: Guide, example, release

- [ ] **Step 1:** Guide: the tile grid definition with a TileMatrixSet JSON for GDAL and morecantile, the `tileGrid` option, the central meridian, limitations. Example `display-a-pacific-centred-map-in-equal-earth.html`. CHANGELOG, README, version `6.18.0-ee.4`.
- [ ] **Step 2:** Headless Chrome with OpenFreeMap "bright" at central meridians 150 and -90: Review Focus 2 to 4, console clean.
- [ ] **Step 3:** Full gate, whole-branch review by a fresh reviewer, one fix pass, tag `v6.18.0-ee.4`, push.
