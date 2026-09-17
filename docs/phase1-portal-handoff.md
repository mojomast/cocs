# Phase 1 portal diagnosis — original proposal and integration record

LEAD UPDATE: The proposal below was subsequently applied after the bridge worker released ownership. Production regression mode passed, then became the default with additional lane, floor/ray/headroom and source-stability checks (7 production tests). The combined portal/nextgen/Convoy batch passed 30 tests. Do NOT reapply the retained patch. The default test invocation now tests integrated production behavior; PORTAL_INTEGRATED=0 is historical diagnosis for pre-patch source only. Statements below saying NOT integrated describe the original worker handoff, not current status.

## Scope / ownership

This review created ONLY:

- `game/phase1-portal-review.test.mjs`
- `docs/phase1-portal-handoff.md`
- `docs/phase1-portal-proposed.patch`

All production sources and all old tests were read-only. No production patch was applied, no new map/mode was added, and no Phase 2 work, full suite/build, commit, deployment or delegation was performed. Existing dirty production files belong to other workers. In particular, the bridge worker owns `structures/terrain/levelgen/nextgen`; lead owns `core/view`.

The patch is two map-local hunks in `game/nextgen-maps.mjs`. It makes no shared collision, nav, renderer or block-schema change. It must be coordinated with the bridge worker AFTER that worker finishes. Passing fixtures are not integrated production success, visual approval, or a completed Phase 1 gate.

## Findings against the actual current source

### Frost Gate: rock-corner NAV clearance, not a reproduced terrain seam

The earlier `phase1-nextgen-handoff.md` correctly reported a west portal walk-edge failure but left the cause unresolved after checking a clear endpoint near radius 11.2. Sampling the entire edge explains the apparent contradiction:

- Cavern center `(0,-20)`, radius 13, west ray angle `PI + PI/16`.
- At radius 11, feet are `(-10.788638084435535, 5.834899373263367, -22.14599354217741)` (XYZ).
- The overlapping rock block is centered at XZ `(-8.034441853748637,-24.72746942367399)`, W=D `4.496308248117566`, absolute H `8.589440649892135`.
- At radius 11.2, XZ `(-10.98479514051618,-22.185011606580638)`, no AABB overlaps. `walkEdge` still rejects the edge because it samples the blocked START/intermediate clearance, not just this endpoint.
- Fine samples from radius 11 through 15 have terrain support; the inner floor is flat at cavern Y and the outer approach is continuous. Removing blocks ONLY in the diagnostic query reveals no terrain-wall collision along these samples. No ground rewrite is justified by this repro.
- IMPORTANT: `walkEdge` uses radius `.52`, but authoritative `RULES.radius` is `.42`. Real `moveActor` traverses this exact baseline ray in BOTH directions. This is a reproduced NAV-clearance defect, NOT a reproduced actor stall on that exact ray. The tests explicitly preserve this distinction.

Cause: cavern geometry/nav realization runs after authored scatter. Unlike Titan Valley's already reserved approaches, Frost's future cavern portal did not reserve prop clearance before rocks were placed.

Proposal hunk 1, adjacent to the existing `ctx.addCavern({ x: 0, z: -20, radius: 13, height: 9 })`: reserve both default rays with `ctx.addNav` at radii 10..17, BEFORE the ring/scatter. Existing `blocksApproach` rejects exactly the offending rock through the normal generator path. Both its rendered prop and its collision block disappear; no invisible/noncolliding rock is retained. The initial experimental reservation extended to 19 and removed an unrelated east-side rock; it was reduced to 17 and re-tested. Final fixture removes exactly ONE rock, with every other prop preserved, terrain and structures unchanged, and both portal directions passing nav and movement.

### Catacombs: diagonal tunnel-wall clipping and constrained chamber exits

All five cavern centers `(-26,-26), (26,-26), (26,26), (-26,26), (0,0)` have the same failure on both default diagonal rays:

- Baseline tunnel radius is 2.4, rendered semicircle radius is `.95*2.4 = 2.28`.
- Side collision boxes are centered at offset `.95*2.4 + sqrt(2)*.8 = 3.411370849898476`, with W=D=1.6.
- On a radius-10 cavern, the diagonal ray's transverse displacement is already about 2.10 at radius 10.75. The `.52` clearance envelope hits those boxes. At radius 12, transverse displacement is about 2.34: even the center has left the rendered shell's baseline half-width.
- Example east ray from cavern `(-26,-26)`: first fine obstruction near XZ `(-15.456558235665234,-23.902779038326614)` at radius 10.75, overlapping tunnel block centered `(-14.925373134328357,-22.588629150101525)`.
- Real `.42` actors started at radius 8 and steered toward radius 12 slide against the side and stop roughly `.15001` short of the diagonal target on ALL TEN rays. The target itself is obstructed. This is not a sealed horizontal tunnel: all three full 80-unit centerlines pass actual movement in both directions on the baseline.

Do NOT repair this by deleting tunnel boxes, adjusting only `openSegments`, ignoring selected kinds in `obstructed`, or clearing nav flags. That would leave the visible shell and/or actual floor inconsistent with the alleged passage.

Proposal hunk 2: change ONLY the radius argument of the three existing east/west lanes from 2.4 to 4, retaining endpoints `(-40,z)..(40,z)` and z values `[-26,0,26]`. The existing generator then regenerates floor strips, wall proxies and connected cavern openings from the same descriptor the renderer consumes. This is a minimal SOURCE patch, not a claim that 4 is the mathematically smallest possible radius; narrower collision-only clearance ignores headroom. Width/balance and sightline consequences require lead/visual review.

The fixture proves:

- All ten diagonal portals have clear `.52` nav edges and real actor movement both ways.
- All three complete widened tunnel centerlines still pass both ways.
- Portal runtime floor equals the authored tunnel floor interpolation. Downward rays hit those same rendered terrain triangles exactly one unit below the ray origin.
- A conservative body envelope (half-width .52, height 1.8) fits INSIDE the actual eight-facet rendered shell's inscribed cross-section, not merely inside an ideal circle. Test checks the current `view.mjs` consumer formulas and shared clipping/arcs. This is numerical geometry evidence, not a screenshot or WebGL walkthrough.
- Shared cavern collision opening indices change from `[0,1,7,8,9,15]` to `[0,1,2,6,7,8,9,10,14,15]`. `cavernShell(...,openSegments)` supplies matching visible arcs; no renderer override is needed.

### Center-avoiding route: fixed within the handoff's contract, NOT an independent flank

The exact selected spawn pair is `(-40,0)` to `(40,40)` (farthest from first spawn, with the original reduction tie behavior). Attachments use actual `walkEdge`, not nearest-node distance alone.

- Baseline: 777 nav nodes; radius-8 node mask reaches 375 nodes and has NO route to the target.
- Proposed fixture: 844 nav nodes; the stricter graph search also excludes any edge whose continuous centerline enters radius 8. It reaches 812 nodes and yields a 28-waypoint route, INCLUDING both real spawn connectors.
- A single real actor is steered along the complete route with velocity preserved at waypoints, no resets/teleports/jumps and no collision bypass. Minimum actor CENTER radius observed: `8.139918890262736`. All per-frame obstruction checks pass.
- The route passes through the central cavern's outer annulus. It is not independent of that chamber. The actor footprint can overlap the radius-8 disk even while its center stays outside; this does not prove an actor-body exclusion zone.
- A stronger radius-12 NODE mask STILL HAS NO ROUTE. The test explicitly retains that limitation. Do not market this as a new independent exterior flank or two disjoint corridors. Further alternate-route design is outside this minimal proposal.

Physical cause of the annular bottleneck is observable, not just missing graph proximity: baseline central cave boxes at `(7.071067811865474,-7.071067811865477)` and `(7.0710678118654755,7.071067811865475)`, W=D=4.5, H=5.8578905627116304, obstruct the relevant outer-annulus edges. Widening the actual connected tunnels changes the shared opening calculation to remove those segments from BOTH collision and shell arcs. Floor and wall regeneration—not a graph-only edit—makes the tested route possible.

## Legacy and placement guarantees

- No `minY`, slab or elevated/pass-under semantics are introduced. Legacy blocks remain solid `[0,h]`; tests add misleading metadata to a cloned existing rock and verify both collision and ray queries still treat it as ground-to-h.
- Both maps' final spawns, team spawns, flag spawns and pickup arrays compare exactly equal baseline versus fixture. Objective X/Z/radius are preserved. Objective Y must remain terrain-derived and should be resampled after layout integration; no authored campaign coordinates are changed.
- Frost's full terrain representation (excluding its function field) and structures compare unchanged; exactly one rendered rock/collider pair is removed. Catacombs' larger ground strips and larger openings are intentional geometry changes, not preserved terrain claims.
- The earlier `ghost-wire` RIDGE marker concern is not resolved by this patch. No campaign execution was performed. Catacombs combat balance and misleading enclosure/exterior cues remain visual/play review items.

## Focused evidence and commands

Run from repository root. No command below applies the patch.

```sh
node --test game/phase1-portal-review.test.mjs
# Final: 11 tests passed, 0 failed, 0 skipped; about 18.34 s.
# Includes integrated baseline characterization and EXPLICITLY LABELED proposed fixtures.

PORTAL_INTEGRATED=1 node --test game/phase1-portal-review.test.mjs
# Final before integration: 3 tests FAILED for the expected exact defects.
# Frost blocked west nav edge; Catacombs blocked diagonal nav edge; no radius-8 route.
# Expected RED, not a claimed successful production fix.

git apply --check docs/phase1-portal-proposed.patch
# Passed against recorded source; --check only, no production writes.
node --check game/phase1-portal-review.test.mjs
# Passed.
```

The desired tests were first run RED (3/3 failures) before proposal creation. The default diagnostic tests intentionally assert baseline defects, so their green result MUST NOT be interpreted as production being fixed. The proposal fixture reads and strictly context-matches the exact docs patch in memory, extracts only the two existing layouts, and uses the current unmodified real `createLevel`, collision, floor, nav and movement code. It is not an independently handwritten collision simulation. Production import initializes the usual registry; no whole-map/application suite is run.

## Source dependency and lead coordination

The patch targets bridge-owned `game/nextgen-maps.mjs`, at the Frost cavern/scatter join (near line 62) and the Catacombs lane loop (near line 156). It depends on the CURRENT shared implementation:

1. `levelgen.mjs`: deferred caverns/tunnels, `blocksApproach`, `floorStrip`, connected-segment opening calculation and 1.6-wide tunnel proxies.
2. `structures.mjs`: `pathFloorAt`, `tunnelRenderPaths`, `cavernShell`/render arcs.
3. `terrain.mjs`: authoritative stamped triangles and support/ray contract.
4. Lead-owned `core.mjs`: `.52` nav clearance, authoritative actor motion and unchanged legacy solids; `data.mjs`: `.42` actor radius, height 1.8.
5. Lead-owned `view.mjs`: radius `.95*r`, eight-segment semicircular shell, shared clipped tunnel paths/open-segment cavern arcs, and terrain triangles.

Recorded SHA-256 fingerprints from the final passing run (the test also checks no dependency changed DURING that run):

| Source | SHA-256 |
|---|---|
| nextgen-maps.mjs | 42673a8d4b800f71bf3ef26de5f082e4532291b8263ea1abfbff6ec61df22631 |
| levelgen.mjs | 3a5b2285b1a9703cded463bdffa0cc73f38b75b427e0ce9371919c646a4dd38b |
| structures.mjs | 1204e76806111b90b9c53447b8e0e642d32b3b25a1a5dbecdfc1c03afadc0449 |
| terrain.mjs | 723b38626b91f36b916eceb55d3c638d45cf85c14641534aa56f7b82651c0639 |
| core.mjs | 344fd799c241e27a0b72d719798dade071f1f27a11f81597b9f9886018f15f79 |
| view.mjs | e857945e98458ca7ec01ca9d04b9c65370484491162aef107f5ee374aae640e5 |
| data.mjs | 974bf646c79a8fbf76e021ca819f56e1d0b26fa43ccdcfb13a23c92ec7b5c86a |

Lead sequence:

1. Wait for bridge worker's final shared-source state. Review differences from the fingerprints; do not overwrite or revert any bridge/core/view edits.
2. Re-run the default diagnostic against that final state and `git apply --check` on the exact two-hunk patch. Context failure or changed characterization is a reason to re-evaluate, not force-apply or weaken tests.
3. If acceptable, coordinate application of the two nextgen hunks with its owner. No core/view/shared-generator production hunk is required by this proposal.
4. AFTER application, run `PORTAL_INTEGRATED=1 node --test game/phase1-portal-review.test.mjs`. All three desired production checks must now pass. The default baseline-characterization mode is intentionally PRE-patch evidence and will no longer be appropriate after integration; do not confuse that with a regression.
5. Re-run the existing focused `game/phase1-nextgen-review.test.mjs` (particularly Frost doors/tunnel/placements) and bridge worker's relevant focused checks; this worker did not claim those post-integration runs. Preserve every old assertion. Revalidate campaign markers/objective support where needed.
6. Perform rendered walkthroughs of both portals, wider Catacombs lanes and annular route. Keep independent-flank and balance limitations open. Update lead-owned coverage only after integrated/visual evidence exists.
