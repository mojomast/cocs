# Phase 1 spatial foundations — bounded handoff

## Status and ownership

This foundations batch is implemented and focused checks pass. It is NOT a per-map visual review, a full Phase 1 gate, or approval to begin Phase 2.

Ownership was read from `docs/PHASE1-PROGRESS.md`. This worker changed only the production files and new focused tests listed below, plus the two requested handoff artifacts. No writes to `game/view.mjs`, `game/core.mjs`, map families, or other workers' files; no reverts, commits, deployments, delegation, dependency installs, full suites, or materials/audio/HUD work.

### Files changed by this worker

- `game/levelgen.mjs`: footprint foundations and doorway approaches; normalized facade parent frames; authored tunnel floors and approaches; deferred cavern/tunnel realization and connected portal clearance.
- `game/structures.mjs`: `facadeFrame`, `facadeDetails`, `pathFloorAt`, `tunnelFloorPath`, `tunnelRenderPaths`; optional cavern opening masks through `cavernArcs`, `cavernRenderArcs`, `cavernShell`.
- `game/terrain.mjs`: `terrainFootprintRange`, `stampTerrainFloor`; exact convex clipping, terrain/wall preservation outside edits, cache invalidation, floor-kind batching.
- `game/interiors.mjs`: explicit floor-path volumes and horizontal floor projection; legacy descriptors retain their prior interpretation.
- `game/map-schema.mjs`: additive validation of explicit floor paths, facade frames and cavern opening masks; legacy block semantics unchanged.
- NEW `game/spatial-foundations.test.mjs`: geometry, generation, determinism, batching and contract tests.
- NEW `game/spatial-foundations-runtime.test.mjs`: real `floorAt`, `walkEdge`, `moveActor`, `obstructed`, `rayWorld` checks.
- NEW `game/spatial-foundations-integration.test.mjs`: renderer patch evaluation in memory and bounded software geometry smoke test.
- `docs/phase1-spatial-integration.patch`: exact renderer integration diff, never applied by this worker.
- `docs/phase1-spatial-handoff.md`: this handoff.

`game/math.mjs` required no change. Other modified files in the working tree belong to concurrent workers and were preserved.

## Shared contracts

### Facades and details

`facadeFrame(parent, side)` describes the OUTER wall plane, not the wall-box center. Supported side names: north/south/east/west. The frame includes local origin/tangent/outward normal, the parent transform, world origin/tangent/normal, span and height. North/south spans use local width; east/west use local depth, without a second dimension swap after rotation.

The generator normalizes building rotation to the same quarter turn used by collision. Its positive planar rotation maps +X to +Z, opposite three.js positive Y yaw. `facadeDetails` emits the correct three.js yaw explicitly. Defaults: 1.5 x 1 x .14 rectangles, .35 edge margins, .5 sill/roof margins, .09 outward center offset. Narrow/short faces yield no details rather than spilling outside the wall. Single columns/rows are centered. Generated window descriptors carry `side` and `frame`; legacy scalar fields remain available for compatibility.

Renderer integration supports `type:'windows'` and `type:'facade-detail'` with the same `frame`; optional `detail` options control dimensions/packing. For custom thick details, author the outward offset to exceed half the detail depth. No map-family decorations were newly authored here.

### Whole-footprint foundations

`terrainFootprintRange(terrain, convexFootprint)` clips the actual triangulated terrain and computes min/max/covered area, including interior terrain vertices and edge intersections. It does not sample only the center or corners.

Buildings/compounds require full footprint terrain coverage. Default base Y is the exact footprint maximum; explicit `o.y` remains an authored cut/fill elevation. The footprint is replaced with a flat terrain floor. Compound partitions reuse the shell's actual resolved base. A positive base also emits a normal `kind:'foundation'` block with `h=baseY`, supporting the full footprint from zero to its top. Doorway approaches have a flat landing beyond the actor radius before a graded terrain strip.

The renderer must retain foundation sides but remove their duplicate coplanar top face, and skip legacy decoration on foundation fill. The patch includes this integration. IMPORTANT: the foundation box geometry is shared/cached by the renderer; clone it and register the clone before changing indices. The lead's concurrent implementation identified and supplied this safety refinement; the patch artifact now includes it.

### Authored ground, not a new elevated representation

Legacy `blocks` STILL represent `[0,h]` solids, including deck blocks and records carrying unrelated `y`/`minY` metadata. No bottom plane, overhead platform, or pass-under semantics were added. Movement and ray tests explicitly enforce this.

`stampTerrainFloor(terrain, convexFootprint, heightFunction, id)` is a generation-time GROUND REPLACEMENT. The callback describes a plane; piecewise paths stamp one segment at a time. It removes old terrain inside the footprint instead of layering a lower floor beneath a higher support surface. Existing terrain triangles, nonwalkable cliff geometry and polygon/segment walls outside the edit are preserved or clipped, not discarded globally. Polygon walls remain actual ray-hit polygons. Terrain caches are invalidated and `terrain.height` then queries the resulting triangles. Repeated floors of the same ID/material are merged into a shared surface bucket.

The level generator owns a separate terrain container and does not mutate supplied/frozen source surfaces. The terrain representation remains the existing renderer/simulation/nav representation; there is no new runtime support branch or hidden presentation-only collision floor.

### Tunnel floor paths

`ctx.addTunnel([[x,y,z], ...], radius)` now treats explicit Y as FLOOR Y. Omitted Y samples triangulated support once; it no longer adds a hidden 1.2 offset. It emits `floorPoints` and a compatibility `points` alias with identical coordinates. Radius must be at least 2; nonfinite, zero-horizontal-extent and over-maxSlope paths are rejected.

All new consumers use `tunnelFloorPath`/`floorPoints`; renderer shell Y must not be resampled from noise or shifted down independently. `pathFloorAt` uses horizontal projection, so changing camera eye height cannot shift the sampled floor along a slope. Old interior descriptors without `floorPoints` retain their prior behavior.

Tunnel floors and exterior approaches are real terrain strips. Conservative legacy wall boxes remain ground-to-top solids. Boxes are kept out of connected cavern interiors and crossing route center clearance. `tunnelRenderPaths` clips shell centerlines exactly against cavern circles and interpolates authored Y at each cut; crossing a cavern returns separate paths rather than bridging a mesh across its interior. Geometry cache keys retain full coordinates instead of rounding distinct paths together.

### Cavern portals

Caverns and tunnels are realized after layout, allowing either authoring order. A cavern gets a flat terrain footprint, supported approaches to its two default portals and an `openSegments` mask. Crossing tunnel corridors open the additional conservative wall segments they need. Collision emits only the remaining wall blocks. `cavernShell(radius,height,segments,openSegments)` must receive that same mask for rendering. Calls without a mask preserve the legacy two-opening behavior.

## Runtime integration points

- Renderer: `docs/phase1-spatial-integration.patch` updates the structure imports, foundation side-only geometry, local roof rotation, frame-aware windows/details, shared tunnel floor/shell clipping, and cavern masks. It retains shared geometry/material reuse and the existing software/WebGL paths. No render-scale or quality reduction is introduced.
- Core: ZERO functional integration lines are needed. `floorAt` already reads `terrainSupportAt`; movement and navigation already read that support and the existing terrain walls/blocks. `rayWorld` already calls `terrainRayHit`. The runtime tests exercise these real functions, not substitutes. Accordingly there is intentionally no gratuitous `core.mjs` hunk in the patch.
- Interiors: the shared floor path is integrated directly in the owned `interiors.mjs` file.

### Concurrent integration state

Initially the patch passed `git apply --check` and the renderer test applied it only in memory. During the final rerun the lead-owned `view.mjs` acquired the integration, including the shared-geometry clone refinement. This worker did not apply or revert it. The final patch matches that integrated state: `git apply --reverse --check docs/phase1-spatial-integration.patch` passes (CHECK ONLY; no reverse operation was performed). Do not blindly apply it a second time. The focused test accepts exact already-integrated hunks, otherwise applies matching old hunks only to an in-memory module.

## Executed evidence

Tests were first observed failing for missing facade frames/normalization, missing foundation support, blocked doorway lips, absent authored floor paths/portal masks, loss of polygon wall ray collision, repeated surface buckets, missing tunnel approaches, invalid spatial schema acceptance, and missing renderer consumption. Implementations were then exercised to green.

Final bounded commands from repository root:

```sh
node --test game/spatial-foundations.test.mjs game/spatial-foundations-runtime.test.mjs game/spatial-foundations-integration.test.mjs game/terrain.test.mjs game/interiors.test.mjs
# 24 tests, 24 passed, 0 failed, 0 skipped.

node --test --test-name-pattern='cavern' game/structures.test.mjs
# 4 tests, 4 passed, 0 failed, 0 skipped.

git apply --reverse --check docs/phase1-spatial-integration.patch
# Exit 0; read-only applicability check against concurrent integration.

git diff --check -- game/levelgen.mjs game/structures.mjs game/interiors.mjs game/map-schema.mjs game/terrain.mjs game/math.mjs
# Exit 0; no whitespace errors.
```

The renderer source with proposed hunks was also syntax-checked in memory with `node --input-type=module --check` (exit 0), without writing a temporary renderer file. Exact diff construction used raw source bytes because the tool's displayed read output redacted some long numeric hash constants; those constants were NOT rewritten.

Specific verified behavior:

- All four facade sides under all four quarter-turn parent rotations; normalized tangent/normal, correct span, edge/height margins and narrow-face omission.
- Off-center interior terrain peaks, exact footprint boundaries, rotated compound floor/partition agreement, source-terrain immutability, floor ray hits and preserved outside wall ray hits.
- Explicit tunnel floor below pre-existing higher terrain; interior floor projection independent of eye height; supported exterior approaches.
- Default raised cavern approaches and a north/south crossing tunnel through both cavern portals, in both builder orders.
- Real nav edges and bounded actor stepping across a raised building doorway and both cavern portals, without jumping or core changes.
- Legacy movement/rays still block underneath a high deck despite `y`/`minY` metadata.
- Deterministic repeated generation and bounded per-kind surface batching.
- Renderer integration creates expected frame-positioned detail meshes and a shell based at authored Y. SoftwareRenderer at a 96x64 mock canvas produced **108 triangles and 108 fill calls**. This is an actual software geometry/draw-path smoke test, NOT a pixel screenshot, visual review, browser end-to-end result, hardware FPS benchmark or performance improvement claim.

## Limits and remaining work for the integration/map owners

1. This batch validates bounded synthetic spatial fixtures and consumer contracts, not every map. Importing core initializes its registry, but does not constitute registry-wide navigation/visual coverage. No map families were reviewed or edited.
2. Stamping assumes a single-valued ground heightfield with convex edit footprints. It is NOT a multi-level/overhead/subterranean collision representation. Existing bridges, decks, towers and terraces retain legacy solid semantics; roofs/domes and tunnel arches remain presentation shells, not newly collidable overhead geometry.
3. Graded approaches use deterministic bounded sampling and a target grade, not a global route solver. Close neighboring structures, edge-of-map approaches, conflicting authored elevations, intersecting foundations, sharp folded tunnel bends and arbitrarily overlapping terrain layers still require authored-layout review. Later stamps have deterministic precedence; they do not automatically reconcile every intersecting structure's base.
4. Cavern/tunnel walls remain conservative AABB proxies rather than exact curved collision shells. The tested portal center corridors are clear; visual/collision silhouette equivalence away from those corridors is not claimed. Mixed sloping tunnel/flat cavern floors can leave lateral steps outside the crossing corridor.
5. Existing authored explicit tunnel Y values that intended the old implicit arch-center convention must be migrated to floor Y by their map owner. The new schema and handoff make the floor convention explicit; no map-family migration was attempted here.
6. Whole-footprint support/graded entry work here applies to buildings and compounds, plus tunnel/cavern ground routes. Other primitive families and props were not broadly retuned. Props authored before deferred carving may need map-owner grounding review.
7. Renderer integration still needs the lead's visual inspection at identical seed/scene/resolution/DPR/settings, particularly curved joins, exposed terrain cuts, foundation skirts and facade placement. The smoke test does not replace that review. No automatic quality reduction was used.
8. No full suite, full build, deployment, commit, Phase 2 feature or Phase 1 completion approval was performed. Keep the broader progress/coverage ledger under lead ownership.
