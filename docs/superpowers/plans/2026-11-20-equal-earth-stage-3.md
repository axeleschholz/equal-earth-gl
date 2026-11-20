# Equal Earth Stage 3 ("3D and extension points") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill-extrusion layers, the sky, custom layers and terrain work on an `equal-earth` map, or, where one cannot be made right in this stage, are refused with a clear message instead of drawing wrongly.

**Architecture:** Stages 1 and 2 warp Mercator tiles on the GPU and the CPU through one `TileWarp`. Stage 3 routes the remaining draws that still multiply a tile position by a matrix directly through the same seams: the extrusion shader, the terrain mesh, and the projection data handed to custom layers. Terrain's elevation lookups, which find DEM tiles by world coordinate, go through the tile grid's own world mapping.

**Tech Stack:** TypeScript, WebGL2 GLSL, vitest, the repo's render-test harness.

**Spec:** `docs/superpowers/specs/2026-11-16-equal-earth-design.md`, section 6 stage 3. Builds on `v6.18.0-ee.2`.

## Global Constraints

- Everything in the stage 1 and 2 plans' Global Constraints holds: BSD-3, no Mapbox GL JS v2+ code, `AGENTS.md` comment rules, seams not name branches, no style-spec fork, upstream fixtures byte-identical, other projections behave and perform as before, CPU and GPU agree within 0.05 px.
- Nothing may draw in the wrong place silently. A feature that is not made right is left out with one `warnOnce` naming it and the projection, and the guide says so.
- Render tests go in `test/integration/render/tests/projection/equal-earth/`.
- Commit after every task with a conventional-commit subject and the trailer `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **A 3D-buildings basemap (OpenFreeMap "liberty") pitched at street level:** buildings stand on their footprints, upright, with no gaps between tiles and no flicker.
2. **Clicking a building:** `queryRenderedFeatures` returns the building under the pointer, including through its walls.
3. **A custom layer written for the globe** (using `shaderData.vertexShaderPrelude` and `projectTile`): draws in the right place on equal-earth without changes.
4. **A custom layer written for Mercator** (using `modelViewProjectionMatrix` with Mercator coordinates): the guide says what it must change; it does not crash the map.
5. **`map.setTerrain()` on an equal-earth map:** either correct terrain or a clear refusal; never a garbled frame, an exception, or a camera that jumps.

---

### Task 1: Fill-extrusion

**Files:** `src/shaders/glsl/fill_extrusion.vertex.glsl`, `fill_extrusion_pattern.vertex.glsl`, `src/render/painter.ts` (gating), render tests `fill-extrusion-*`.

- [ ] **Step 1:** Failing unit test: the painter draws `fill-extrusion` on a Mercator-grid source on the Equal Earth plane with no warning (`painter_warped_layers.test.ts`).
- [ ] **Step 2:** In both extrusion vertex shaders the non-globe branch computes `u_projection_matrix * vec4(posInTile, elevation, 1.0)`; replace it with `projectTileFor3D(posInTile, elevation)`, which is the same arithmetic on Mercator and the warp on Equal Earth. Remove `fill-extrusion` from the gate.
- [ ] **Step 3:** Render tests from the Berlin z14 `building` layer with a constant height: `fill-extrusion-tiles-city` (pitch 55, bearing 30: walls vertical, roofs over footprints drawn by a `fill` layer of the same source), `fill-extrusion-tiles-arctic` (one fixed tile at 78°N, pitched), `fill-extrusion-tiles-flat` (pitch 0: roofs coincide with footprints). Inspect.
- [ ] **Step 4:** Unit test: `queryIntersectsFeature` of the extrusion layer with a warped camera hits a point on a wall and misses one beside the building (pattern: existing fill-extrusion query tests).
- [ ] **Step 5:** Upstream fill-extrusion and globe render tests unchanged. Commit `feat: draw fill-extrusion layers on warped tiles`.

### Task 2: Sky

- [ ] **Step 1:** Render test `sky-pitched`: a style with a `sky` and pitch 80 on equal-earth shows the sky above the horizon and the map below. If it already passes by construction, keep the test and record that no code changed. `atmosphere-blend` has no effect on a flat map, as on Mercator.
- [ ] **Step 2:** Commit `test: cover the sky on an equal-earth map`.

### Task 3: Custom layers

**Files:** `src/webgl/draw/draw_custom.ts`, `src/camera/mercator_camera_math.ts` (`getProjectionDataForCustomLayer`), `src/style/style_layer/custom_style_layer.ts` (docs), render test `custom-layer`.

**Interfaces — Produces:** on a warped camera, `defaultProjectionData` is `getWarpedProjectionData(camera, null, warp)`: with `shaderData`'s prelude and define, `projectTile(mercatorCoordinate * 8192.0)` places a Mercator coordinate 0..1 on the Equal Earth plane, exactly as the same code does on the globe.

- [ ] **Step 1:** Failing unit test: `draw_custom` on an Equal Earth frame passes `defaultProjectionData` whose single-precision shader mirror puts Mercator (0.5, 0.5) at the map's (0°, 0°) and (0.75, 0.25) at (90°E, 66.51°N) within 0.05 px at zoom 1; `shaderData.variantName` is `equal-earth`.
- [ ] **Step 2:** Implement. Render test adapted from the globe `custom` fixtures.
- [ ] **Step 3:** Document in `CustomRenderMethodInput` and the guide: a layer that multiplies Mercator coordinates by `modelViewProjectionMatrix` must either use the prelude or give plane coordinates; the matrix takes world pixels of the map's plane. Commit `feat: give custom layers the projection data of the tile warp`.

### Task 4: Terrain

Terrain touches the camera (centre elevation, ray casts against the coverage index), elevation lookups by lng/lat, render-to-texture, the depth and coordinate framebuffers, and the terrain mesh. Assess first, then take one of two paths and record which as a ruling.

- [ ] **Step 1: Assess.** List every site where terrain code turns a plane world coordinate into a DEM tile position or back (`terrain.ts`, `terrain_coverage.ts`, `mercator_camera_math.ts` ray casts, `draw_terrain.ts`, `render_to_texture.ts`, coordinate framebuffer readback). Estimate against the stage: path A if the conversion can be confined to those sites behind the existing seams with unit tests for each; otherwise path B.
- [ ] **Path A (support):** elevation lookups and the coverage index take coordinates in the DEM's grid through `featureGeometryHelper`; the terrain mesh, depth and coordinate passes draw through the warp; coordinate readback returns plane coordinates. Unit tests per site; render tests `terrain-tiles` and `terrain-tiles-pitched` from the globe `terrain` fixture; a drag and a `queryTerrainElevation` check.
- [ ] **Path B (refuse cleanly):** `setTerrain` on a map whose plane warps Mercator tiles keeps terrain off and warns once: "Terrain is not yet supported in the equal-earth projection." A style that carries `terrain` loads without it. Switching to a projection that supports terrain applies the style's terrain. Unit tests for all three; guide updated.
- [ ] Commit `feat: support terrain in equal-earth` or `feat: refuse terrain in equal-earth until it is supported`.

### Task 5: Guide, release

- [ ] **Step 1:** Run the OpenFreeMap "liberty" style (3D buildings) in headless Chrome pitched at street level and at world view; inspect; click a building.
- [ ] **Step 2:** Update the guide, changelog, README status, version `6.18.0-ee.3`. Full gate including the integration suite. Whole-branch review by a fresh reviewer, one fix pass, tag `v6.18.0-ee.3`, push.
