# Phase 1 bridge access — bounded runtime correction

## Status and ownership

Reauthored all **19 inaccessible bridge/platform descriptors across the six requested maps** as explicit, ground-supported causeways/platforms. Their approaches, tops and exits now pass real bidirectional infantry movement and navigation checks. This is NOT visual signoff, a full Phase 1 gate, campaign completion, or approval for Phase 2.

This worker changed only:
- `game/levelgen.mjs`: opt-in `ctx.addCauseway`; optional floor-strip stamp options.
- `game/terrain.mjs`: opt-in retaining faces for authored ground stamps, batched with existing surfaces.
- `game/nextgen-maps.mjs`: the six requested layouts and their inaccurate elevated-route descriptions/comments.
- NEW `game/phase1-bridge-access.test.mjs`.
- NEW `docs/phase1-bridge-handoff.md`.

`game/structures.mjs` needed no additional change. Existing spatial/nextgen worker fixes remain present. Core/view/schema were inspected, not edited. No campaign or legacy-map writes, commits, deployment, delegation, full suite, new maps/modes/weapons, or materials/audio/HUD phase-2 work.

Read `docs/phase1-nextgen-handoff.md` and `docs/phase1-spatial-handoff.md`. The old bridge-defect entries in the nextgen handoff are historical observations; this document supersedes those 19 descriptors only. It does not resolve that handoff's other blockers.

## Representation and runtime integration

The root cause was not a missing nav node: legacy `addBridge` emitted a solid `[0,h]` deck while the terrain floor underneath remained lower. An actor at that floor collided with the deck. Rotated descriptors could also advertise a different footprint from their quarter-turn proxy.

**Legacy blocks, including decks and records with unrelated y/minY metadata, remain ground-to-top solids. `addBridge` is unchanged.** No elevated slab, support-at-reference-height branch, underpass, stacked terrain, or new runtime collision schema was introduced.

`addCauseway({x,z,w,d,rot,y,ramp,rise})` is an explicit authoring opt-in:
- Rotation must be an explicit quarter turn. Width is the local longitudinal span; depth is lane width. Generator integer transforms define the exact world footprint.
- Default top is the existing whole-footprint terrain maximum plus a modest authored rise. An explicit `y` permits local cut/fill (used for the two shared-height crosses).
- The deck footprint replaces the existing ground with flat terrain triangles. A normal `kind:'foundation'` block fills from zero to that top.
- Each longitudinal end has a one-unit flat landing beyond the foundation, then a visible linear terrain ramp to a pre-sampled ground toe. Ramp length is four units, six on Slagworks. The helper rejects missing toe support and grades above .5; it is not a general route solver.
- The same short nav chains used by the prior spatial work reserve these approaches before scatter and enter the normal runtime graph.
- `type:'causeway'` and `accessPath` are audit metadata. They are NOT an alternate support/render implementation. No obsolete bridge rails are emitted for them.

`stampTerrainFloor(..., {skirts:true})` adds nonwalkable retaining triangles only at the edit perimeter. Their lower/upper edges meet the old clipped terrain and the new plane, including original triangle intersections. This avoids floating ramp sides. Tops and retaining faces go through the existing `terrainTriangles` render/ray path. Top and side buckets remain bounded by surface ID/material/walkability. Existing calls without the option retain their previous behavior, including outside-footprint cliff/wall preservation and cache invalidation.

The current lead-owned renderer already renders authoritative terrain triangles and foundation side-only geometry. Core already uses the same triangulated support for floor/nav/movement and terrain triangles for rays. **No additional core/view/schema integration patch is required.** Keep the prior spatial renderer integration (foundation sides with the duplicate top removed); do not revert it. A causeway descriptor alone is never sufficient geometry: the generator emits the terrain and foundation consumers already understand.

## Every repaired descriptor

Numbers follow each map's descriptor authoring order. Coordinates/top heights below are runtime output rounded to three decimals, not new authoring constants. Dimensions are local length x width before rotation. Tests extend two units beyond both listed toes onto untouched ground.

| Descriptor | Final centre X,Z | Size / rotation | Top Y | Ground toe X,Z → ground toe X,Z |
|---|---|---|---:|---|
| sunken-hill 1 | (30, 0) | 10 x 4 / 90° | 4.373 | (30, -10) → (30, 10) |
| sunken-hill 2 | (21.213, 21.213) | 10 x 4 / 180° | 4.438 | (31.213, 21.213) → (11.213, 21.213) |
| sunken-hill 3 | (0, 30) | 10 x 4 / 180° | 4.309 | (10, 30) → (-10, 30) |
| sunken-hill 4 | (-21.213, 21.213) | 10 x 4 / 270° | 3.785 | (-21.213, 31.213) → (-21.213, 11.213) |
| sunken-hill 5 | (-30, 0) | 10 x 4 / 270° | 4.342 | (-30, 10) → (-30, -10) |
| sunken-hill 6 | (-21.213, -21.213) | 10 x 4 / 0° | 4.530 | (-31.213, -21.213) → (-11.213, -21.213) |
| sunken-hill 7 | (0, -30) | 10 x 4 / 0° | 4.332 | (-10, -30) → (10, -30) |
| sunken-hill 8 | (21.213, -21.213) | 10 x 4 / 90° | 3.743 | (21.213, -31.213) → (21.213, -11.213) |
| atrium 1 | (0, -8) | 22 x 3 / 0° | 1.097 | (-16, -8) → (16, -8) |
| atrium 2 | (0, 8) | 22 x 3 / 0° | 1.136 | (-16, 8) → (16, 8) |
| slagworks 1 | (0, 0) | 44 x 4 / 0° | 4.203 | (-29, 0) → (29, 0) |
| slagworks 2 | (0, 0) | 40 x 4 / 90° | 4.203 | (0, -27) → (0, 27) |
| forge 1 | (0, 0) | 11 x 11 / 0° | 1.400 | (-10.5, 0) → (10.5, 0) |
| dune-ravine 1 | (25, 24) | 8 x 4 / 0° | 5.827 | (16, 24) → (34, 24) |
| dune-ravine 2 | (-25, 24) | 8 x 4 / 0° | 4.204 | (-34, 24) → (-16, 24) |
| dune-ravine 3 | (-25, -24) | 8 x 4 / 0° | 5.496 | (-34, -24) → (-16, -24) |
| dune-ravine 4 | (25, -24) | 8 x 4 / 0° | 4.277 | (16, -24) → (34, -24) |
| ember-caldera 1 | (0, 0) | 40 x 4 / 0° | 2.231 | (-25, 0) → (25, 0) |
| ember-caldera 2 | (0, 0) | 28 x 4 / 90° | 2.231 | (0, -19) → (0, 19) |

### Map-specific decisions and retained limitations

- **Sunken Hill 1–8:** Same eight radius-30 centres, all now low filled platforms with explicit cardinal orientations and endpoint access. Removed the old split between low and higher bridge slabs. Stamps stay outside the central cavern; both existing cavern portals still pass movement in both directions. No traversable crown over a cavern is claimed. The description now describes cavern plus exterior platforms, not stacked hill/cave gameplay.
- **Atrium 1–2:** Former centres (0,-10)/(0,10) move to (0,-8)/(0,8), avoiding the diagonal column bases. Lowered from the old 4.5 top to low filled plaza lanes. All six room doorways remain walkable. There is no mezzanine or second storey; description corrected.
- **Slagworks 1–2:** Retain both centre axes and spans; use one identical top at their intersection and six-unit end ramps. This is a same-level filled cross, not one catwalk above another. All four furnace-building doors remain usable. Perimeter movement remains available. Decorative lava/furnaces are not new hazard mechanics.
- **Forge 1:** Retains the 11x11 centre footprint, lowers the top, and provides west/east access. The centre objective now really occupies the accessible platform. No north/south ramps or under-platform route are promised. All four workshop doors remain usable.
- **Dune Ravine 1–4:** Replaces the four diagonal descriptors at polar angles `.4 + i*pi/2`, radius 22, with the four listed exterior flank platforms in the same order. The old short slabs did not connect usable mesa tops and conflicted with a cardinal collision model. The replacement platforms are 8x4, unrotated, outside the mesa solids. Mesa/ridge solids and ground gaps remain; no inaccessible ridge top is promoted to a usable route. This is intentional map reauthoring, not preservation of a fictional elevated route.
- **Ember Caldera 1–2:** Keep a shared-height filled central cross. East/west retains its 40-unit span. North/south shortens from 40 to 28 so its ramps terminate inside, rather than through, the solid rim. To reach the outer north/south lanes players still use the existing broken-rim gaps. Some approaches descend from higher natural ground to the cut/fill crossing; this is not an overhead deck. Existing decorative ice/lava remains and requires visual legibility review.

All six retain a tested centre-avoiding nav path from the first spawn to the farthest sampled spawn (nodes inside radius 8 excluded). This is only the same bounded diagnostic used in the prior review, not proof of two disjoint corridors, unchanged tactical balance, vehicle access, or every possible route.

## Placements and campaign-facing effects

No authored spawn, flag, objective, pickup or campaign coordinate arrays were changed. Generated placements can legitimately change because the former solids no longer force nudges. A read-only comparison loaded `HEAD:game/nextgen-maps.mjs` in memory with the SAME current shared generator; the six selected maps' prior nextgen-worker changes were outside these descriptor edits. This comparison isolates these layouts from older foundation behavior.

- All six maps: free spawns, team spawns and flags compare unchanged.
- Sunken Hill: outer objectives return from generated (-28,3)/(28,3) to authored (-28,0)/(28,0), with floor Y on their new platforms. Central cavern objective is unchanged. Rail/rocket return to (0,-34)/(0,34); health returns to (-34,0)/(34,0).
- Atrium: objective and pickup arrays compare unchanged.
- Slagworks: objective X/Z unchanged, floor Ys resample to ramps. Health/armor return from (-12,3)/(12,3) to authored (-12,0)/(12,0) on the crossing.
- Forge: centre objective returns from generated (7,0) to authored (0,0); generated haste also returns from (7,0) to (0,0). Other objective X/Z and pickup tuples are unchanged. Reward exposure/balance at the now-accessible centre needs play review.
- Dune Ravine: objective X/Z and pickups unchanged; outer objective Ys resample to the new approach landings.
- Ember Caldera: objective X/Z and pickups unchanged; no material objective-height change (only floating-point rounding at one sample).

Existing nav reservation excludes a few scatter props locally rather than blanket-clearing scenery: prop counts before/after are Sunken 32/31, Atrium 11/10, Slagworks 20/18, Forge 10/10, Dune 45/44, Ember 43/42. No random stream, global scatter policy or cavern/tunnel builder was changed.

Campaign owner should continue resolving dynamic anchor Y from runtime ground and should not depend on old generated nudges or `type:'bridge'` for these six maps. This worker did not edit campaign anchors, triggers, routes or labels and did not run a mission playthrough. The prior Convoy removal/ground-route fix remains intact and its focused tunnel regression passes.

## Executed focused evidence

The six map tests first failed at their original obstructed bridge centres. After the reauthoring they pass full approach/deck/exit movement, not just centre clearance. The retaining-face test separately failed for a missing ray-hit side, then passed. A repeated-side batching assertion failed with two buckets before the batching correction, then passed. Later graph/retained-door checks are characterization regressions, not claimed as initially failing tests.

`game/phase1-bridge-access.test.mjs` has 14 tests:
- Each of 19 descriptors: real `floorAt`, `obstructed`, `walkEdge`, `moveActor`, without jumping, along centre and +/-0.5 offset lanes, both directions for each segment, including two units of untouched ground beyond each toe.
- Authored path Y matches authoritative ground, and downward terrain rays meet the same top triangles.
- Every crossing path point, spawn, pickup, objective and flag has a real bidirectional walk-edge graph attachment; all attach to the same reachable graph. All six centre-avoiding diagnostics pass.
- Every retained building doorway on these six maps and both Sunken Hill cavern portals pass bidirectional movement.
- Synthetic fill retains outside ground, produces a ray-hit vertical retaining face and batches repeated side surfaces.

Final functional command after the side-batching change:

```sh
node --test game/phase1-bridge-access.test.mjs game/spatial-foundations.test.mjs game/spatial-foundations-runtime.test.mjs game/spatial-foundations-integration.test.mjs game/terrain.test.mjs game/interiors.test.mjs
# 38 tests, 38 passed, 0 failed, 0 skipped; about 10.71s.
```

Preservation regression run during the batch:

```sh
node --test game/phase1-bridge-access.test.mjs game/phase1-nextgen-review.test.mjs
# 26 tests, 26 passed, 0 failed, 0 skipped; about 18.76s.
```

The existing foundation/runtime tests explicitly retain legacy ground-to-top deck behavior, source-terrain immutability, outside-wall ray collision, building floors, tunnel approaches and cavern portals. The existing renderer integration smoke still reports 108 triangles/108 fills; that is its synthetic fixture, NOT a rendering of these six corrected maps.

Final combined rerun after all test edits:

```sh
node --test game/phase1-bridge-access.test.mjs game/phase1-nextgen-review.test.mjs game/spatial-foundations.test.mjs game/spatial-foundations-runtime.test.mjs game/spatial-foundations-integration.test.mjs game/terrain.test.mjs game/interiors.test.mjs
# 50 tests, 50 passed, 0 failed, 0 skipped; about 14.68s.
```

`node --check` passed for all three edited production modules and the new test. The scoped `git diff --check` also passed. No full suite was run.

## Remaining limits / visual checklist

**No browser playthrough, screenshot, pixel comparison or visual signoff was produced.** Shared visible terrain geometry and ray/movement agreement are automated evidence, not aesthetic or first-person legibility approval.

Lead should review each listed ramp toe, retaining face and foundation skirt in first person; the intersecting crosses; Atrium's column clearance; all eight forest platform orientations; Dune's relocated flank landmarks; Ember's inner-rim turnoffs; and Forge's centre reward exposure. Decorative props can still create misleading visual cover even when noncolliding; no broad prop cleanup was attempted.

This remains a single-valued ground heightfield. No usable underpasses, cavern crowns, roof decks, mezzanines, terrace tops or stacked crossings were added. Testing covers three longitudinal lanes per descriptor, not arbitrary side entry, every edge/corner, jumping, vehicles, PvP fairness or completed missions. Side faces are terrain/ray geometry; they are not a new elevated-solid schema. New use of the helper near overlapping structures, terrain boundaries, tunnels or caverns requires explicit layout review rather than relying on it to resolve conflicts automatically.

Frost Gate's separate west cavern seam, Catacombs' diagonal junction/alternate-route issues, other terrace/roof access, spawn-side supply balance and the broader Phase 1 visual gate remain outside this correction. Keep the prior worker handoffs and their fixes; do not treat this batch as a replacement for them.
