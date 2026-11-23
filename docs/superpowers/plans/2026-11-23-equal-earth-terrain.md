# Equal Earth Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3D terrain from a Web Mercator raster-dem source is drawn in the `equal-earth` projection, with layers draped on it and the camera, queries and markers following it.

**Architecture:** Terrain lives in the grid of its DEM source. Its tiles are Mercator tiles, selected and drawn through the tile warp like any other; layers are rendered into their textures flat, in tile space, where no warp applies. Everything that asks the terrain about a place asks in the DEM's grid: lng/lat lookups go through the grid's world mapping, and the camera's ray, which is straight on the Equal Earth plane, is taken to the grid at each sample.

**Tech Stack:** TypeScript, WebGL2 GLSL, vitest, the repo's render-test harness.

**Spec:** `docs/superpowers/specs/2026-11-16-equal-earth-design.md`, section 6 stage 3 (terrain), deferred from `v6.18.0-ee.3`.

## Global Constraints

- All constraints of stages 1 to 4 hold. Terrain on `mercator`, `globe` and a registered CRS behaves and performs as before; upstream terrain render tests pass unchanged.
- No fallback to a Mercator view. CPU and GPU agree within 0.05 px at elevation 0 and within 0.5 px on terrain.
- Commit after every task, trailer `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Decisions carried into every task

- **The terrain's grid.** `Terrain` is given the world mapping of its DEM source's grid, `featureGeometryHelper(source.tileGrid, plane)`, so `getElevationForLngLat`, the coverage and the tile lookups are Mercator's on the Equal Earth plane.
- **Ray casts.** `TerrainCoverageIndex` lookups from the camera's plane go through `planeToGrid(x, y)`, set on a plane that warps the DEM's tiles and absent elsewhere.
- **Draping.** While rendering to a terrain tile's texture the Mercator shader variant is used with flat tile matrices. Only sources in the DEM's grid can be draped: while terrain is on, GeoJSON sources are tiled in Mercator, and tile sources with `tileGrid: 'equal-earth'` are not drawn, with one warning.
- **Refusal that stays.** Terrain from a raster-dem source with `tileGrid: 'equal-earth'` stays off, with the existing warning and the request remembered.
- **Poles and edges.** Terrain meshes of the top and bottom rows carry pole vertices as on the globe; the terrain fragment shaders call `clipWorldEdge()`.

## Review Focus

1. **A pitched view of mountains at 46°N and at 70°N:** terrain, draped fills and lines, labels and 3D buildings coincide; no cracks between terrain tiles of different zoom.
2. **Clicking and dragging on a slope:** the picked lng/lat is the one drawn under the pointer; `queryRenderedFeatures` returns the draped feature there.
3. **A marker and a popup on a summit:** drawn on the surface, hidden when behind a ridge.
4. **Turning terrain on and off at runtime, and changing projection with terrain on:** GeoJSON redraws in the right place each time, no stale tiles, no exception.
5. **Terrain with a central meridian other than 0, across the world's edge and across the antimeridian.**

---

### Task 1: Terrain answers in its DEM's grid

**Files:** `src/render/terrain.ts`, `src/render/terrain_coverage.ts`, `src/camera/mercator_camera_math.ts`, `src/ui/map.ts`.

- [ ] **Step 1: Failing tests.** With the Equal Earth helper and a DEM tile whose elevation is a known function of lng/lat: `getElevationForLngLat` returns it at (10, 46) and (20, 70) as a terrain on a Mercator map does; `coverage.sample` likewise; `raycastTerrain` from a pitched camera returns a plane coordinate whose lng/lat has the elevation the ray's height has there, within 1 m.
- [ ] **Step 2:** Implement. Commit `feat: look terrain up in the grid of its DEM on a warped plane`.

### Task 2: Draw terrain through the warp

**Files:** `src/render/frame_render_context.ts`, `src/webgl/draw/draw_terrain.ts`, `src/render/terrain.ts`, `src/camera/mercator_camera_math.ts` (fog matrix), `terrain*.fragment.glsl`, `src/webgl/render_to_texture.ts`, `src/render/painter.ts`.

- [ ] **Step 1: Failing tests.** Rendering to texture on the Equal Earth plane uses the Mercator shader variant; `getProjectionDataForTile` for a terrain tile outside the texture pass is the warp's; the terrain mesh of a top-row tile has pole vertices; the fog matrix of a warped camera takes a tile position to within 1% of the fog depth of its warped position.
- [ ] **Step 2:** Implement, commit `feat: draw terrain tiles through the tile warp`.

### Task 3: Sources on terrain, and turning it on

**Files:** `src/source/geojson_source.ts`, `src/source/source_tile_grid.ts`, tile sources, `src/ui/map.ts`, `src/style/style.ts`.

- [ ] **Step 1: Failing tests.** `setTerrain` on an Equal Earth map with a Mercator DEM turns terrain on, with no warning; with a `tileGrid: 'equal-earth'` DEM it stays off as before. A GeoJSON source's `tileGrid` is `undefined` while terrain is on and `'plane'` when it is off, and toggling re-sends its data to the workers and drops its tiles. A `tileGrid: 'equal-earth'` vector source has no tiles while terrain is on.
- [ ] **Step 2:** Implement, commit `feat: terrain in the equal-earth projection`.

### Task 4: Render tests and a real DEM

- [ ] **Step 1:** Render tests in `projection/equal-earth/` from the upstream `terrain/` fixtures: `terrain-fill`, `terrain-hillshade-pitched`, `terrain-symbols-circles`, `terrain-fill-extrusion`, `terrain-geojson`, `terrain-fog`, `terrain-arctic`, `terrain-meridian-150`. Inspect each.
- [ ] **Step 2:** Headless Chrome with a public DEM and basemap: Review Focus 1 to 4.
- [ ] **Step 3:** Commit `test: terrain in equal-earth`.

### Task 5: Guide, release

- [ ] Guide terrain section, examples un-pinned where terrain was the only reason, CHANGELOG, README, version `6.18.0-ee.5`. Full gate, fresh whole-branch review, one fix pass, tag `v6.18.0-ee.5`, push.
