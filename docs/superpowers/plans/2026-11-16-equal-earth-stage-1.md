# Equal Earth Stage 1 ("Draws") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public fork of MapLibre GL JS that draws background, fill, line, raster and GeoJSON content in the Equal Earth projection, from unmodified Mercator tile sources, at every zoom.

**Architecture:** A built-in `equal-earth` projection runs the existing flat camera on a native Equal Earth world plane. Mercator-grid tiles are bent onto that plane by a *tile warp* that exists twice, in float64 TypeScript and in a GLSL shader variant, and must agree. GeoJSON is tiled directly on the plane by the workers and drawn with the existing flat shader.

**Tech Stack:** TypeScript, WebGL2 GLSL, vitest (unit), the repo's puppeteer render-test harness, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-16-equal-earth-design.md`. This plan implements stage 1 of its section 6. Stages 2 to 4 get their own plans.

## Global Constraints

- Base is MapLibre GL JS v6.18.0 (`7db3d5028`). Licence stays BSD-3-Clause with upstream notices intact.
- No code copied or adapted from Mapbox GL JS v2 or later. Sources allowed: the Equal Earth paper (Šavrič, Patterson, Jenny 2018), PROJ documentation, this repo.
- Follow `AGENTS.md`: TSDoc on declarations, no in-body narration, no file preambles, no comments about how code came to be.
- Prefer new files. A shared file changes only to add a seam, never a branch on the projection's name.
- No fork of `@maplibre/maplibre-gl-style-spec`.
- Maps using `mercator`, `globe`, `vertical-perspective` or a registered CRS must behave and perform as before. Upstream test fixtures stay byte-identical.
- The projection stays Equal Earth at every zoom; no fallback to the mercator shader for Mercator-grid tiles.
- Seam and CPU/GPU agreement budget: 0.05 px.
- Equal Earth constants (EPSG:8857, WGS84): `A1 = 1.340264`, `A2 = -0.081106`, `A3 = 0.000893`, `A4 = 0.003796`, `M = sqrt(3)/2`, authalic radius `6371007.1809` m, `e² = 0.00669437999014`. Reference extents: `x(180°, 0°) = 17243959.06` m, `y(0°, 90°) = 8392927.60` m.
- Commit after every task with a conventional-commit subject and the trailer `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **Geometry crossing ±180°** (Russia, Fiji, a GeoJSON line from Tokyo to Los Angeles): no horizontal streak across the map; each part ends at its own edge. Test in Task 8.
2. **An unmodified basemap style with symbol, circle, heatmap, hillshade or fill-extrusion layers on a Mercator-grid source:** those layers are skipped with one warning each kind, nothing throws, the rest draws. Test in Task 7.
3. **Pointer or `unproject` outside the world outline, and dragging from there:** finite results on the outline, no throw, no camera jump. Test in Task 4.
4. **`setProjection` between `mercator` and `equal-earth` on a live map:** tiles and GeoJSON redraw correctly in the new projection without reload. Test in Task 8.
5. **Zoom 22 at high latitude (78°N) and on the equator:** adjacent tiles meet within 0.05 px, no jitter while panning. Test in Task 7.

## File Structure

New:

| File | Responsibility |
|---|---|
| `src/geo/projection/equal_earth_math.ts` | Forward, inverse, derivatives in metres. No map types. Imported by workers too. |
| `src/geo/projection/equal_earth_world.ts` | `EqualEarthWorldCoordinateHelper`, its `TileMatrixSet`, world bounds. |
| `src/geo/projection/default_projection.ts` | The default projection name and its setter. |
| `src/geo/projection/tile_warp.ts` | `TileGrid` and `TileWarp` types. |
| `src/geo/projection/equal_earth_tile_warp.ts` | CPU warp from Mercator tiles to the Equal Earth plane, bounds, per-tile expansion. |
| `src/geo/projection/equal_earth_covering_tiles_details_provider.ts` | Tile selection for Mercator-grid sources on the plane. |
| `src/geo/projection/equal_earth_projection.ts` | `Projection` implementation: shader variant, meshes, subdivision. |
| `src/geo/projection/equal_earth_projection_data.ts` | Builds `RendererProjectionData` for a warped tile. |
| `src/shaders/glsl/_projection_equal_earth.vertex.glsl`, `.fragment.glsl` | GLSL warp and world-outline clip. |
| `test/integration/render/tests/equal-earth/**` | Render tests. |
| `test/examples/display-a-map-in-equal-earth.html`, `docs/guides/equal-earth.md` | Example and guide. |

Modified (seams only): `src/geo/world_types.ts`, `src/geo/mercator_coordinate.ts`, `src/geo/projection/crs.ts`, `src/geo/projection/projection.ts`, `src/geo/projection/projection_factory.ts`, `src/geo/projection/covering_tiles_details_provider_factory.ts`, `src/geo/projection/covering_tiles.ts`, `src/camera/camera_constrain.ts`, `src/render/frame_render_context.ts`, `src/render/painter.ts`, `src/shaders/shaders.ts`, `src/style/style.ts`, `src/source/geojson_source.ts`, `src/source/geojson_worker_source.ts`, `src/source/projection_handler_worker.ts`, `src/webgl/program/hillshade_program.ts`, `src/tile/tile_manager.ts`, `src/index.ts`, test setup files, `package.json`, `README.md`, `CHANGELOG.md`.

---

### Task 1: Fork identity, public repository, green baseline

**Files:** Modify `package.json`, `README.md`.

- [ ] **Step 1:** Create the GitHub fork and wire remotes. `gh repo fork maplibre/maplibre-gl-js --fork-name equal-earth-gl --remote=false`, then `git remote rename origin upstream` and `git remote add origin https://github.com/<login>/equal-earth-gl.git` (`<login>` from `gh api user -q .login`). A GitHub fork of a public repository is public and keeps the "forked from" link that upstream pull requests need.
- [ ] **Step 2:** Create branch `equal-earth` from `equal-earth-design`; it is the fork's working branch. `main` stays a mirror of upstream `main`.
- [ ] **Step 3:** In `package.json` set `"name": "equal-earth-gl"`, `"version": "6.18.0-ee.0"`, and `repository`, `bugs`, `homepage` to the fork URL. Dist file names and the `maplibregl` global are unchanged in stage 1.
- [ ] **Step 4:** Put a section at the top of `README.md`, above upstream's content, with exactly this opening: "**equal-earth-gl** is a fork of [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) that draws maps in the Equal Earth projection. A style that names no projection renders in Equal Earth. Styles that name `mercator` or `globe` render as they do upstream. Status: stage 1 of 4, see `docs/superpowers/specs/2026-11-16-equal-earth-design.md`." Follow it with the stage list from spec section 6.
- [ ] **Step 5:** `npm ci`, then `npm run codegen && npm run typecheck && npm run test-unit && npm run build-dist && npm run test-render`. Record pass/fail counts in the commit message body. Any failure here is an upstream or machine baseline and is listed there, not fixed.
- [ ] **Step 6:** Commit, `git push -u origin equal-earth`, `gh repo edit --default-branch equal-earth --description "MapLibre GL JS in the Equal Earth projection"`. Verify with `gh repo view --json visibility,parent,defaultBranchRef`: expected `PUBLIC`, parent `maplibre/maplibre-gl-js`, `equal-earth`.

### Task 2: Equal Earth mathematics

**Files:** Create `src/geo/projection/equal_earth_math.ts`, `equal_earth_math.test.ts`. Add `proj4` to `devDependencies` (test use only).

**Interfaces — Produces:**

```ts
export const EQUAL_EARTH_HALF_WIDTH: number;   // x(180°, 0°) in metres
export const EQUAL_EARTH_HALF_HEIGHT: number;  // y(0°, 90°) in metres
/** lng/lat degrees to EPSG:8857 metres. */
export function equalEarthForward(lng: number, lat: number, out?: [number, number]): [number, number];
/** EPSG:8857 metres to lng/lat degrees, or null outside the world outline. */
export function equalEarthInverse(x: number, y: number, out?: [number, number]): [number, number] | null;
/** [dx/dlng, dx/dlat, dy/dlng, dy/dlat] in metres per degree. */
export function equalEarthJacobian(lng: number, lat: number): [number, number, number, number];
```

- [ ] **Step 1: Failing tests.**
  - `equalEarthForward(180, 0)` ≈ `[17243959.06, 0]` and `equalEarthForward(0, 90)` ≈ `[0, 8392927.60]`, both within 0.01 m.
  - For every lng in −180..180 step 15 and lat in −90..90 step 7.5: agrees with `proj4('+proj=eqearth +datum=WGS84 +units=m')` within 1e-6 m; `equalEarthInverse(equalEarthForward(p))` returns `p` within 1e-9°.
  - `equalEarthInverse(17243959, 8000000)` is `null` (inside the bounding box, outside the outline).
  - `equalEarthJacobian` matches central differences within 1e-6 relative.
  - Equal area: for 500 seeded random points with |lat| < 89, the Jacobian determinant divided by the ellipsoid's area per square degree at that latitude is constant within 1e-9 relative.
- [ ] **Step 2:** Run `npx vitest run --config vitest.config.unit.ts src/geo/projection/equal_earth_math.test.ts`; expect failures on missing exports.
- [ ] **Step 3: Implement.** Geodetic latitude φ to authalic latitude β with `sin β = q(φ)/q(90°)`, `q(φ) = (1−e²)·[sin φ/(1−e² sin² φ) − ln((1−e sin φ)/(1+e sin φ))/(2e)]`; then `sin θ = M·sin β`, `x = R·2√3·λ·cos θ / (3·(A1 + 3·A2·θ² + θ⁶·(7·A3 + 9·A4·θ²)))`, `y = R·θ·(A1 + A2·θ² + θ⁶·(A3 + A4·θ²))`. Inverse: Newton on `y(θ)` to 1e-12, then β, then φ from β by Newton on `q`. No allocation when `out` is passed.
- [ ] **Step 4:** Run the test file; expect pass. Run `npm run typecheck`.
- [ ] **Step 5:** Commit `feat: add Equal Earth forward, inverse and Jacobian`.

### Task 3: World plane, tile-grid seam, default projection

**Files:** Create `equal_earth_world.ts` (+ test), `default_projection.ts` (+ test), `tile_warp.ts`. Modify `world_types.ts`, `mercator_coordinate.ts`, `crs.ts`, `hillshade_program.ts`, `geojson_source.ts`, `projection_factory.ts`, `style.ts` (lines 516 and 1791), `src/index.ts`, unit test setup, render-test harness.

**Interfaces — Consumes:** Task 2 exports.

**Interfaces — Produces:**

```ts
// tile_warp.ts
/** The grid a source's tiles are cut in: Web Mercator, or the world plane's own quad grid. */
export type TileGrid = 'mercator' | 'plane';

// world_types.ts, added to WorldCoordinateHelper
/** The grid tile sources are cut in on this plane when a source does not say otherwise. */
readonly sourceTileGrid: TileGrid;
/** The part of the 0..1 world square the world occupies: [minX, minY, maxX, maxY]. */
readonly worldBounds: readonly [number, number, number, number];

// equal_earth_world.ts
export const equalEarthTileMatrixSet: TileMatrixSet; // origin [-HALF_WIDTH, HALF_WIDTH], extentAtZoom0 2*HALF_WIDTH
export class EqualEarthWorldCoordinateHelper implements WorldCoordinateHelper { /* name 'equal-earth', wraps false, sourceTileGrid 'mercator' */ }
export const equalEarthWorldCoordinateHelper: EqualEarthWorldCoordinateHelper;

// default_projection.ts, both re-exported from src/index.ts as @experimental
export function getDefaultProjection(): string;       // 'equal-earth' as shipped
export function setDefaultProjection(name: string): void;
```

- [ ] **Step 1: Failing tests** in `equal_earth_world.test.ts`: `worldFromLngLat(0,0)` is `(0.5, 0.5)`; `(180,0)` gives `x = 1`; `(0,90)` gives `y = 0.5 − 8392927.60/34487918.12`; `lngLatFromWorld` round-trips; `hasLngLat(0.01, 0.3)` is false and `lngLatFromWorld(0.01, 0.3)` returns a finite point whose forward lies on the outline; `metersPerWorldUnit` is `34487918.12` everywhere; `worldBounds` is `[0, y(90°N), 1, y(90°S)]`. For mercator and CRS helpers: `sourceTileGrid` is `'mercator'` and `'plane'`, `worldBounds` is `[0,0,1,1]`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement the helper and add the two members to the mercator and CRS helpers.
- [ ] **Step 4: Split the `wraps` flag.** `hillshade_program.ts:138,148` and `geojson_source.ts:545` plus `_getCRSParameters` currently read `wraps === false` to mean "tiles are in the plane's grid". Change exactly those to read the tile grid (`sourceTileGrid === 'plane'` for now; Task 8 makes GeoJSON per-source). Every other `wraps` read keeps its meaning. Existing tests for those files must pass unchanged.
- [ ] **Step 5: Default projection.** Failing test: with the default set to `'equal-earth'`, a `Style` loaded from a stylesheet without `projection` has `style.projection.name === 'equal-earth'`; with `projection: {type: 'mercator'}` it is `'mercator'`; `setProjection(undefined)` returns to the default. Implement; replace the two `'mercator'` literals in `style.ts`. In `projection_factory.ts` add case `'equal-earth'` returning `{projection: new MercatorProjection(equalEarthWorldCoordinateHelper), cameraProjection: 'mercator'}` (Task 7 swaps the class).
- [ ] **Step 6: Pin the upstream suites.** Call `setDefaultProjection('mercator')` in the unit setup file listed in `vitest.config.unit.ts` and in the render and query harness page before a map is created, unless the test's `style.json` metadata has `"test": {"defaultProjection": "equal-earth"}`.
- [ ] **Step 7:** If the style validator rejects `{"type": "equal-earth"}`, allow that one name where `style.ts` calls validation, without touching the spec package. Test: `new Map` with that style emits no error event.
- [ ] **Step 8:** `npm run typecheck && npm run test-unit`; all pass. Commit `feat: add the Equal Earth world plane and make it the default projection`.

### Task 4: Camera on the world outline

**Files:** Modify `src/camera/camera_constrain.ts` (+ its test). Create `test/integration/render/tests/equal-earth/camera-*`.

**Interfaces — Consumes:** `worldBounds`.

- [ ] **Step 1: Failing unit tests.** With the Equal Earth helper: a centre at `(0, 89.9)` is kept; a centre set to world `y = 0.1` is moved to `worldBounds[1]`; world `x = 1.2` moves to `1`; zoom is untouched at zoom 0 in a 2000 px viewport (no zoom floor). With the mercator and CRS helpers every existing constrain test passes unchanged.
- [ ] **Step 2: Failing unit tests for Review Focus 3.** On a `Map` with `equal-earth`: `map.unproject([0, 0])` at zoom 0 in a 1024×512 viewport returns finite `lng` and `lat` in range; a simulated drag from that corner pixel by 50 px changes the centre by a finite amount no larger than a 50 px drag from the map centre does.
- [ ] **Step 3:** Implement: `constrainToWorldSquare` clamps the centre to `worldBounds` instead of the square.
- [ ] **Step 4:** Run `src/camera` and `src/ui` unit tests; pass. Commit `feat: constrain the camera to the world outline`.

### Task 5: Tile warp on the CPU

**Files:** Create `equal_earth_tile_warp.ts` (+ test). Extend `tile_warp.ts`.

**Interfaces — Consumes:** Task 2 and 3 exports, `EXTENT`.

**Interfaces — Produces:**

```ts
// tile_warp.ts
export interface TileWarp {
    /** A Mercator tile position (0..EXTENT) to the 0..1 world plane. Latitude is clamped to ±90, longitude to ±180. */
    warp(tile: {x: number; y: number; z: number}, tx: number, ty: number, out: [number, number]): [number, number];
    /** The tile's bounding box on the world plane: [minX, minY, maxX, maxY]. Top and bottom rows include their pole cap. */
    bounds(tile: {x: number; y: number; z: number}): [number, number, number, number];
    /** World-plane units per tile unit at a tile position: [dX/dtx, dX/dty, dY/dtx, dY/dty]. */
    jacobian(tile: {x: number; y: number; z: number}, tx: number, ty: number): [number, number, number, number];
    /**
     * The warp about the tile centre as a cubic in u = tx/EXTENT - 0.5, v = ty/EXTENT - 0.5, relative to
     * warp(centre): 20 coefficients, X's ten then Y's ten, in the order 1, u, v, u², uv, v², u³, u²v, uv², v³.
     * In world units; float64.
     */
    expansion(tile: {x: number; y: number; z: number}): Float64Array;
    /** The lowest tile zoom at which `expansion` stays within 0.05 px of `warp` at any view zoom up to 24. */
    readonly expansionMinZoom: number;
}
// equal_earth_tile_warp.ts
export const equalEarthTileWarp: TileWarp;
/** Evaluates an expansion; the reference the GLSL is checked against. */
export function evaluateExpansion(c: Float64Array, u: number, v: number, out: [number, number]): [number, number];
```

- [ ] **Step 1: Failing tests.**
  - `warp({0,0,0}, 4096, 4096)` is `(0.5, 0.5)`; `warp({0,0,0}, 0, 4096)` has `x = 0`; `warp({0,0,0}, 4096, 0)` equals the helper's world point for `(0°, 85.0511°)`.
  - `warp` equals `helper.worldFromLngLat(mercatorTileToLngLat(...))` for 1000 seeded random tile points at zooms 0 to 22, within 1e-13.
  - `bounds` contains `warp` of a 17×17 grid over the tile, and is tight within 1% of the tile's extent, for 200 random tiles; for `y = 0` rows `bounds[1]` equals `helper.worldBounds[1]`.
  - `jacobian` matches central differences.
  - For 200 random tiles at each zoom from `expansionMinZoom` to 22 including rows touching ±85°: over a 9×9 grid extended one tile-buffer width past each edge, `|evaluateExpansion − (warp − warp(centre))| · 512 · 2^24 < 0.05`. The same check one zoom below `expansionMinZoom` fails for at least one tile.
  - Seam: for 200 random horizontally and vertically adjacent tile pairs at those zooms, the two tiles' expansions at 9 shared-edge points differ by less than 0.05 px at view zoom `tile zoom + 2`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement. Expansion coefficients come from analytic or high-order finite-difference derivatives in float64; determine `expansionMinZoom` by measurement and hard-code it with the measured margin in its TSDoc. Because level of detail can show a tile up to several zooms above its own, the budget is stated at view zoom 24.
- [ ] **Step 4:** Run; pass. Commit `feat: add the CPU tile warp from Mercator tiles to Equal Earth`.

### Task 6: Tile selection

**Files:** Create `equal_earth_covering_tiles_details_provider.ts` (+ test). Modify `covering_tiles_details_provider_factory.ts`, `covering_tiles.ts`, `tile_manager.ts`.

**Interfaces — Consumes:** `TileWarp.bounds`, `TileGrid`.

**Interfaces — Produces:** `getCoveringTilesDetailsProvider(projectedCamera, worldCoordinateHelper, tileGrid: TileGrid)`; `CoveringTilesOptionsInternal.tileGrid?: TileGrid` (defaults to the helper's `sourceTileGrid`), passed by `tile_manager.ts` from its source.

- [ ] **Step 1: Failing tests** (pattern: `globe_covering_tiles.test.ts`).
  - Zoom 0, 1024×512 viewport, centre `(0,0)`: covering tiles are exactly `0/0/0`.
  - Zoom 2, centre `(0,0)`, 512×512: every returned tile's `bounds` intersects the viewport's world rectangle, and no tile whose `bounds` intersects it is missing at the chosen zoom.
  - Level of detail: centre `(0, 0)` at zoom 5.0 returns z5 tiles around the centre; centre `(0, 80)` at zoom 5.0 returns tiles at z3 or z4 (projected area closest to a 512 px tile).
  - Viewport entirely outside the world outline (centre clamped, zoomed in on a corner of the bounding box): returns an empty list, does not throw.
  - Pitch 60 at zoom 6: tile count stays below 80.
  - With `tileGrid: 'plane'` on the Equal Earth helper, and for mercator and CRS helpers, results are identical to the mercator provider's.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement. `getWrap` returns 0 and `allowWorldCopies` false. Bounding volume is the axis-aligned box from `bounds` in the same units the mercator provider uses. `distanceToTile2d` measures to that box.
- [ ] **Step 4:** Run this test, `covering_tiles.test.ts`, `globe_covering_tiles.test.ts` and the `src/tile` tests; pass. Run `npx vitest bench --config vitest.config.bench.ts src/geo/projection/covering_tiles.bench.ts` before and after for a mercator camera; no slowdown beyond noise. Commit `feat: select Mercator tiles on the Equal Earth plane`.

### Task 7: Drawing Mercator-grid tiles in Equal Earth

**Files:** Create the two GLSL files, `equal_earth_projection.ts`, `equal_earth_projection_data.ts` (+ tests), render tests under `test/integration/render/tests/equal-earth/`. Modify `shaders.ts`, `projection.ts`, `projection_factory.ts`, `frame_render_context.ts`, `painter.ts`.

**Interfaces — Consumes:** `TileWarp`, `TileGrid`, covering tiles from Task 6.

**Interfaces — Produces:**

```ts
// projection.ts, added to Projection
/** The warp from Mercator-grid tiles to this projection's plane, or null when that grid is the plane. */
get tileWarp(): TileWarp | null;

// equal_earth_projection_data.ts
/** Projection data for one Mercator-grid tile drawn on the Equal Earth plane. */
export function getEqualEarthProjectionData(camera: MercatorProjectedCamera, tileID: OverscaledTileID | null, warp: TileWarp): RendererProjectionData;

// frame_render_context.ts
getProjectionDataForTile(tileID, params?: ProjectionDataParams & {tileGrid?: TileGrid}): RendererProjectionData;
```

Uniform packing (no change to the uniform buffer layout): `tileMercatorCoords` as globe uses it; `projectionTransition` is `0` for the exact regime and `1` for the expansion regime; in the expansion regime `fallbackMatrix` carries expansion coefficients 0..15 and `clippingPlane` coefficients 16..19, scaled to world pixels, and `mainMatrix` maps world pixels relative to the tile centre to clip space, built in float64; in the exact regime `mainMatrix` maps the 0..1 world plane to clip space.

- [ ] **Step 1: Failing unit tests** for `getEqualEarthProjectionData`: tile zoom below `expansionMinZoom` gives `projectionTransition === 0`; at or above gives `1`; in both regimes, transforming a CPU-warped tile point by the returned data (a TypeScript mirror of the GLSL arithmetic in float32 via `Math.fround`) lands within 0.05 px of `projectedCamera`'s own projection of the float64 world point, for 200 random tile points at zooms 0, 3, `expansionMinZoom ± 1`, 14, 22, at latitudes 0, 45, 78, 84.
- [ ] **Step 2: GLSL.** `_projection_equal_earth.vertex.glsl` defines the same function set as `_projection_mercator.vertex.glsl` (`projectTile` both overloads, `projectTileWithElevation`, `projectTileFor3D`, `projectLineThickness`, `projectCircleRadius`) under `#define PROJECTION_EQUAL_EARTH`. Exact regime: tile to Mercator via `u_projection_tile_mercator_coords`, to lng/lat, clamp to ±180/±90, Equal Earth forward with the constants in Global Constraints, to world 0..1. The fragment prelude discards fragments outside the world outline, using a varying of the plane position. Register the variant in `shaders.ts`; `npm run generate-shaders`.
- [ ] **Step 3: `EqualEarthProjection`.** `name` `'equal-earth'`, `tileWarp` `equalEarthTileWarp`, `useSubdivision` true, subdivided meshes with pole caps through the mesh builder that `vertical_perspective_projection.ts` uses for `getMeshFromTileID` (extract it to a shared function rather than copying). Subdivision granularity: start from globe's table. `MercatorProjection.tileWarp` and globe's return `null`. Swap the class into the factory case.
- [ ] **Step 4: Painter seam.** `frame_render_context.getProjectionDataForTile` and the painter's program selection use the Equal Earth variant when `projection.tileWarp` is non-null and the tile's grid is `'mercator'`; otherwise the existing path. Background draws on the plane grid.
- [ ] **Step 5: Layer gating (Review Focus 2).** For a Mercator-grid source on a projection with a `tileWarp`, the painter skips layer types `symbol`, `circle`, `heatmap`, `hillshade`, `color-relief`, `fill-extrusion` and warns once per type: "`<type>` layers on tile sources are not yet drawn in the equal-earth projection." Unit test: a style with one layer of each type on a vector source renders a frame without throwing and warns exactly six times.
- [ ] **Step 6: Render tests**, each a `style.json` with `metadata.test.defaultProjection` unset and `"projection": {"type": "equal-earth"}`, plus `expected.png`, using the local fixture tiles the existing render tests use:
  - `fill/world-z0`, `line/world-z0`, `raster/world-z0`, `background/world-z0` at 512×256, centre `(0,0)`: whole world, transparent outside the outline, pole caps filled.
  - `fill/north-pole-z2`, `raster/south-pole-z2`.
  - `line/antimeridian-z1` centred `(180, 0)`: content ends at the edge.
  - `fill/seam-regime` at view zooms `expansionMinZoom − 0.5` and `+ 0.5`, and `fill/z22-equator`, `fill/z22-lat78` (Review Focus 5): a single-colour polygon spanning four tiles renders with no gap or overlap pixels (use a semi-transparent fill so overlap shows).
  - `fill/pitched-z3` with pitch 45, bearing 30.
  - `combined/basemap-z1`: fill, line and raster together.
  Review each generated image by eye against an independent rendering of the same data (for example a quick proj4 plot) before accepting it as expected.
- [ ] **Step 7:** `npm run build-dist && npm run test-render`: new tests pass, upstream render tests unchanged. `npm run test-unit`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 8:** Tune subdivision granularity and confirm `expansionMinZoom` against the render seam tests; record the measured values in the TSDoc of the constants. Commit `feat: draw Mercator tiles in the Equal Earth projection`.

### Task 8: GeoJSON tiled on the plane, and switching projections

**Files:** Modify `projection_handler_worker.ts`, `geojson_worker_source.ts`, `geojson_source.ts`, `src/source/source.ts` (or wherever the source interface is declared), `tile_manager.ts`. Render tests under `equal-earth/geojson/`.

**Interfaces — Produces:** `Source.tileGrid?: TileGrid` (absent means the helper's `sourceTileGrid`); `GeoJSONSource.tileGrid` is `'plane'` whenever the map's projection is `equal-earth` or a registered CRS the workers can build.

- [ ] **Step 1: Failing unit tests.** `createWorkerCRSHelper({name: 'equal-earth', tileMatrixSet: equalEarthTileMatrixSet})` returns an Equal Earth helper with no projection handler set and no warning. `GeoJSONSource._getCRSParameters()` on an `equal-earth` map returns `{name: 'equal-earth', tileMatrixSet}`. A GeoJSON point at `(0, 89)` yields a feature in worker tile `0/0/0` at the plane position of `(0, 89)`.
- [ ] **Step 2:** Implement; the worker imports `equal_earth_math.ts` directly. The tile manager passes `source.tileGrid` to covering tiles and stamps it on tiles so the painter (Task 7 Step 4) picks the flat path.
- [ ] **Step 3: Render tests.** `geojson/countries-z0`: a world polygon fixture including Antarctica to −90°, fill plus outline, drawn over a Mercator raster source; coastlines of both coincide. `geojson/antimeridian` (Review Focus 1): a polygon for Fiji crossing ±180° and a LineString from `(139.7, 35.7)` to `(-118.2, 34.1)` written with longitudes crossing 180; no stroke spans the map interior. `geojson/symbols-and-circles`: symbol and circle layers on a GeoJSON source draw at the right places.
- [ ] **Step 4: Switching (Review Focus 4).** Unit test with the browser-free map harness: load a style with one GeoJSON and one vector source in `mercator`, call `map.setProjection({type: 'equal-earth'})`; the GeoJSON source sends a new `loadData` with `crs.name === 'equal-earth'`, its tiles reload, the vector source's tiles are kept, and the reverse switch restores `crs` undefined. Render test `runtime/set-projection` using the harness `operations` array: mercator, then equal-earth, expected image equals `combined` drawn directly in equal-earth.
- [ ] **Step 5:** Run unit and render suites; pass. Commit `feat: tile GeoJSON sources on the Equal Earth plane`.

### Task 9: Example, guide, acceptance, publish

**Files:** Create `test/examples/display-a-map-in-equal-earth.html`, `docs/guides/equal-earth.md`. Modify `CHANGELOG.md`, `README.md`, `package.json` (version `6.18.0-ee.1`).

- [ ] **Step 1:** Example page: a choropleth of a GeoJSON countries file over a public Mercator raster or vector basemap, no `projection` in the style, following the structure of the existing example pages.
- [ ] **Step 2:** Guide covering: what differs from Mercator (default projection, no world copies, transparent outside, zoom meaning from spec section 1, tile detail), what stage 1 draws and skips, `setDefaultProjection`, GeoJSON exact to the poles versus Mercator sources ending at ±85.051°.
- [ ] **Step 3:** Open the example in a real browser. Check by eye at zooms 0, 4, 10, 16: coastlines of basemap and GeoJSON coincide; pan, zoom, rotate and pitch are smooth; nothing draws outside the outline; console is clean apart from the documented layer-skip warnings. Fix what is found under the owning task's tests before continuing.
- [ ] **Step 4:** Benchmarks: the repo's bench suite on a mercator style before (`7db3d5028`) and after shows no regression beyond noise; Equal Earth frame time on the same style is within 1.5× of globe. Record numbers in the commit body.
- [ ] **Step 5:** Full gate: `npm run codegen && npm run typecheck && npm run lint && npm run test-unit && npm run build-dist && npm run test-render && npm run test-integration && npm run test-build`. Result must equal Task 1's baseline plus the new tests.
- [ ] **Step 6:** CHANGELOG entry under `main`; README status line updated to "stage 1 complete". Commit, push, tag `v6.18.0-ee.1`, push the tag. No npm publish.
