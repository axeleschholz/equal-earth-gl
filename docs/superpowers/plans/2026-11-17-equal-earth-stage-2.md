# Equal Earth Stage 2 ("Parity for flat maps") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every 2D layer type and feature query works on Mercator tile sources in the `equal-earth` projection, so an unmodified basemap style renders complete, with labels.

**Architecture:** Stage 1 warps Mercator tiles on the GPU. Stage 2 gives the CPU the same warp: a projected camera that carries the plane's `TileWarp` makes `projectTileCoordinates` warp tile positions, and every CPU consumer (symbol placement, collision, symbol drawing, queries) already goes through that function. Layers whose shaders extrude in tile space (map-pitched circles and text) are drawn viewport-pitched on warped tiles instead.

**Tech Stack:** TypeScript, WebGL2 GLSL, vitest, the repo's render-test harness.

**Spec:** `docs/superpowers/specs/2026-11-16-equal-earth-design.md`, section 6 stage 2 and section 5. Builds on `docs/superpowers/plans/2026-11-16-equal-earth-stage-1.md` as shipped in `v6.18.0-ee.1`.

## Global Constraints

- Everything in stage 1's Global Constraints still holds: BSD-3, no Mapbox GL JS v2+ code, `AGENTS.md` comment rules, seams not name branches, no style-spec fork, upstream fixtures byte-identical, `mercator`/`globe`/`vertical-perspective`/registered CRS behave and perform as before.
- CPU and GPU must agree: a position projected on the CPU lands within 0.05 px of where the shader draws it.
- Render tests go in `test/integration/render/tests/projection/equal-earth/`, name the projection in `style.json`, and use the local fixtures the globe tests use.
- Commit after every task with a conventional-commit subject and the trailer `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Decisions carried into every task

- **The warped camera.** `MercatorProjectedCamera` gains an optional `tileWarp: TileWarp`. `withTileWarp(camera, helper, tileGrid)` in `src/camera/warped_camera.ts` returns the camera itself unless the plane has a `mercatorTileWarp` and the grid resolves to `'mercator'`; then it returns a copy with `tileWarp` set, cached per camera. `MercatorCameraMath.projectTileCoordinates` warps when the camera has a `tileWarp`, and `getFastPathSimpleProjectionMatrix` returns `undefined` for it, which sends callers down the path the globe uses.
- **Which camera a tile gets.** `Tile.tileGrid` is stamped from its source when the tile manager creates it. `FrameRenderContext.projectedCamera` returns the warped camera while `currentTileGrid` resolves to `'mercator'` on a warp plane. Placement and queries resolve it per tile.
- **Viewport pitch on warped tiles.** On a warped source, `circle-pitch-alignment`, `text-pitch-alignment` and `icon-pitch-alignment` behave as `viewport`: circles, text and icons face the screen and keep their shape. Rotation alignment is unchanged, so labels still follow lines. Documented as a difference.

## Review Focus

1. **A full basemap style (OpenFreeMap "bright") at zooms 0 to 16:** labels sit on their features, do not overlap each other, and do not jitter or pop while panning.
2. **Labels and circles within a few pixels of the world outline and the poles:** drawn once, not clipped mid-glyph by a tile boundary, not duplicated across the antimeridian.
3. **Clicking a feature near a pole or at high zoom:** `queryRenderedFeatures` returns the feature under the pointer, and only that one.
4. **A box query that spans a large part of the world:** returns the features inside the box as drawn, not those inside the box's Mercator image.
5. **Switching projection while labels are fading in:** no exception, labels settle in the right places.

---

### Task 1: The warped camera

**Files:** Create `src/camera/warped_camera.ts` (+ test). Modify `src/camera/projected_camera.ts`, `src/camera/mercator_camera_math.ts`, `src/render/frame_render_context.ts`, `src/tile/tile.ts`, `src/tile/tile_manager.ts`.

**Interfaces — Produces:**

```ts
// projected_camera.ts, on MercatorProjectedCamera
/** The warp of mercator tiles onto this camera's plane, on a camera that tiles of the mercator grid are projected with there. */
readonly tileWarp?: TileWarp;

// warped_camera.ts
export function withTileWarp<C extends ProjectedCamera>(camera: C, worldCoordinateHelper: WorldCoordinateHelper, ownTileGrid: TileGrid | undefined): C;

// tile.ts
tileGrid: TileGrid | undefined; // the grid of its source, see Source.tileGrid
```

- [ ] **Step 1: Failing tests.** `withTileWarp` returns the same camera on mercator, on a CRS helper, and on the Equal Earth helper with grid `'plane'`; on the Equal Earth helper with grid `undefined` it returns a camera with `tileWarp === equalEarthTileWarp`, the same object on a second call. For that camera, `getCameraMath(c).projectTileCoordinates(c, tx, ty, unwrappedTileID)` lands within 0.05 px of `shaderPixels` (the single-precision shader mirror in `warped_projection_data.test.ts`, exported from a shared test helper) for 200 tile positions at zooms 0, 2, 3, 9, 16, 22 and latitudes 0, 45, 78, including one with elevation 0 passed explicitly; `signedDistanceFromCamera` equals the clip `w`; `getFastPathSimpleProjectionMatrix` is `undefined`. For a camera without `tileWarp` both functions return what they did before.
- [ ] **Step 2:** Implement. Stamp `tile.tileGrid` where the tile manager constructs tiles. Make `FrameRenderContext.projectedCamera` a getter over the frame's camera and `currentTileGrid`.
- [ ] **Step 3:** Unit suite green; `camera_hot_paths.bench.ts`-style timing of mercator `projectTileCoordinates` before and after shows no change beyond noise. Commit `feat: project tile coordinates through the tile warp on the CPU`.

### Task 2: Circles and heatmaps

**Files:** Modify `src/render/painter.ts` (gating set), `src/webgl/draw/draw_circle.ts`, `src/webgl/draw/draw_heatmap.ts`, their programs as needed. Render tests `circle-*`, `heatmap-*`.

- [ ] **Step 1: Failing unit test:** the painter draws `circle` and `heatmap` layers on a Mercator-grid source on the Equal Earth plane without a warning; `circleUniformValues` on a warped frame reports `u_pitch_with_map: false` for `circle-pitch-alignment: map`.
- [ ] **Step 2: Render tests** from vector-tile point data (the globe `circle-planet` and `heatmap` fixtures): `circle-tiles-world` (z0), `circle-tiles-arctic` (centre 78°N, z3), `circle-tiles-pitched` (pitch 50, `circle-pitch-alignment: map`: circles stay round), `heatmap-tiles-world`. A GeoJSON copy of the same points in a second colour must coincide with the tile circles in `circle-tiles-world`.
- [ ] **Step 3:** Implement, run, inspect images, commit `feat: draw circle and heatmap layers on warped tiles`.

### Task 3: Symbols

**Files:** Modify `src/symbol/placement.ts`, `src/symbol/collision_index.ts`, `src/symbol/projection.ts`, `src/webgl/draw/draw_symbol.ts`, `src/style/style.ts` (placement entry), `src/render/painter.ts` (gating). Render tests `text-*`, `icon-*`, `collision-*`.

- [ ] **Step 1: Failing unit tests.** Placement of a bucket from a warped tile projects its collision boxes with the warped camera (a point symbol at tile position P has its box centred within 0.05 px of the shader mirror's position for P); `text-pitch-alignment: map` on a warped tile places and draws as `viewport`; a bucket from a plane-grid tile in the same placement pass uses the unwarped camera.
- [ ] **Step 2: Render tests** adapted from the globe fixtures: `text-point-pole-to-pole`, `text-variable-anchor`, `collision-text-point-pole-to-pole`, `collision-text-line-equator`, `collision-text-line-pole-to-pole`, `text-pitched-rotated`, `icon-text-translate-viewport`, plus `text-antimeridian` (a label whose anchor is within 20 px of the world's edge at z1 is drawn once and whole) and `text-collision-debug` (collision boxes drawn with `collisionDebug` coincide with the glyphs).
- [ ] **Step 3:** Implement: resolve the camera per tile in placement, collision and drawing; force viewport pitch alignment on warped tiles at the one place each of placement and drawing reads the layout value.
- [ ] **Step 4:** Run, inspect every image, commit `feat: place and draw symbol layers on warped tiles`.

### Task 4: Feature queries

**Files:** Modify `src/tile/tile_manager.ts` (`tilesIn`), `src/source/query_features.ts`, `src/data/feature_index.ts` as needed. Query tests under `test/integration/query/tests/` if the harness can name a projection, else unit tests.

- [ ] **Step 1: Failing tests.** On an Equal Earth camera with a loaded Mercator vector tile: a point query at the screen position of a known polygon returns it; one 30 px outside it does not; a point query on a circle feature within its radius returns it at latitudes 0 and 78; a box query over a quarter of the world at z0 returns exactly the features whose drawn position is in the box; a query outside the world outline returns nothing and does not throw. `queryRenderedFeatures` no longer warns for tile sources.
- [ ] **Step 2:** Implement: for a warped source, `tilesIn` takes the query geometry from the plane to the mercator square through lng/lat (edges longer than 64 px are split first, so a box's straight sides stay close to their curved mercator image), then proceeds as on mercator; the feature index is handed the warped camera.
- [ ] **Step 3:** Commit `feat: query rendered features of tile sources in equal-earth`.

### Task 5: Hillshade and color-relief

**Files:** `src/render/painter.ts` (gating). Render tests `hillshade-tiles`, `color-relief-tiles` from the globe fixtures.

- [ ] **Step 1:** Remove the two types from the gate behind a failing unit test; add render tests at z1 and at 70°N z4 with pole caps; inspect.
- [ ] **Step 2:** Commit `feat: draw hillshade and color-relief layers on warped tiles`.

### Task 6: Image, video and canvas sources

**Files:** `src/tile/tile_manager.ts` (visibility of the source's tile), `src/source/image_source.ts` as needed. Render tests `image-*` from the globe `image` and `image-non-parallelogram` fixtures.

- [ ] **Step 1: Failing test:** an image source whose corners span 100°E to 160°E, 10°S to 45°S on an Equal Earth camera centred on it is in the tile manager's ideal tiles; one on the far side of the world from a zoomed-in camera is not required to be culled.
- [ ] **Step 2:** Implement, render tests (image corners land on the lng/lat they name, verified against a GeoJSON outline of the same four corners), commit `feat: draw image, video and canvas sources in equal-earth`.

### Task 7: Controls, guide, release

- [ ] **Step 1:** Unit tests on an Equal Earth map: `ScaleControl` shows the distance along the parallel through the centre (within 1% of the great-circle length of that screen segment at latitudes 0 and 60); `NavigationControl`, `AttributionControl`, hash and `fitBounds` to a country behave as on any flat map.
- [ ] **Step 2:** Open the stage 1 example with the OpenFreeMap "bright" style in headless Chrome at zooms 0, 3, 6, 10, 14, 16 and a pitched view; inspect screenshots for Review Focus 1 and 2; console clean.
- [ ] **Step 3:** Update `docs/guides/equal-earth.md` (what is drawn, viewport pitch alignment), `CHANGELOG.md`, README status, version `6.18.0-ee.2`. Full gate. Whole-branch review by a fresh reviewer, one fix pass, tag `v6.18.0-ee.2`, push.
