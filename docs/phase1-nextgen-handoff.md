# Phase 1 nextgen maps — bounded review handoff

## Scope and status

Reviewed all 17 maps exported by `game/nextgen-maps.mjs`, including the imported baked Moth variant. Made six bounded map-layout corrections. This is an automated spatial review with focused authoritative-movement regressions, **not visual signoff, a completed Phase 1 gate, or approval for Phase 2**. Known traversal defects remain and are listed below.

This worker wrote ONLY:
- `game/nextgen-maps.mjs`
- NEW `game/phase1-nextgen-review.test.mjs`
- `docs/phase1-nextgen-handoff.md`

Read `docs/PHASE1-PROGRESS.md` and `docs/phase1-spatial-handoff.md`. No core/view/shared-generator/campaign writes, no new maps, no materials/audio/HUD work, no commits, deployment, delegation, full build or full test suite. Concurrent workers' changes were preserved.

## Evidence and interpretation

The review used actual `floorAt`, `obstructed`, `walkEdge`, `navigation`, `visible`, and (for corrected routes) `moveActor`, against the current shared spatial implementation. It did not substitute raw noise heights or nearest-node proximity for traversability.

- Every map's free/team spawns, pickups, objectives and flags were attached through real `walkEdge` edges to its navigation graph. All final reviewed placements connect to the main graph. This does NOT mean every structure surface or every route is usable.
- Building doorway probes extend two units inside/outside the actual transformed door frame. All final building doorway probes pass. Focused tests additionally walk actors both ways through doors on Colosseum, Frost Gate, Riverbend, Fortress and Convoy Line.
- Initial tunnel centerlines were sampled in one-unit sections: Frost Gate, Riverbend, Catacombs and Titan Valley had no failing sampled edges; Fortress had two failing sections per tunnel; Convoy had 18. Corrected Fortress/Convoy and adjusted Frost Gate tunnels now have bidirectional real movement tests.
- Alternate-route probe: first spawn to farthest spawn with nav nodes inside radius 8 around map origin excluded. Six changed maps have this regression. The all-map diagnostic finds a route in every map except Catacombs. This is a coarse node mask, not proof of two fully disjoint corridors or combat balance.
- Reward-route distances below are shortest weighted 3D graph travel from the first spawn's nearest **walk-connected** node; graph attachments may omit a small final connector distance. They are not straight-line distances or measured match times. LOS is an eye-height static ray probe, not a visibility screenshot.
- Cavern default-portal probes use angles pi/16 and pi+pi/16, from radius-2 to radius+2. They reveal remaining seam/side-clearance issues despite global connectivity.
- Bridge probes ask whether an actor at the runtime ground floor at each bridge center is obstructed. They expose the ground-to-top deck problem, not a successful test of upper-deck movement.

### Final geometric inventory

`Spawn gap` = minimum pairwise horizontal distance among authored free and team spawns combined, rounded to one decimal. `LOS` = minimum–maximum other visible spawn positions per spawn. These are diagnostics, not acceptable-balance thresholds. Titan's gap/LOS were sampled before its two portal-rock removals; no final LOS improvement is claimed. Its final graph count and required-placement connectivity were rerun.

| Map | Final nav nodes | Spawn gap | LOS | Centre-avoiding probe | Remaining blocked bridge centers |
|---|---:|---:|---:|---|---:|
| colosseum | 541 | 6.9 | 3–6 | yes | 0 |
| frost-gate | 877 | 10.0 | 1–2 | yes | 0 |
| sunken-hill | 848 | 5.8 | 3–9 | yes | 8 |
| riverbend | 976 | 8.9 | 0–2 | yes | 0 |
| fortress | 852 | 11.7 | 1–4 | yes | 0 |
| atrium | 756 | 8.0 | 1–2 | yes | 2 |
| catacombs | 777 | 40.0 | 1–2 | **no** | 0 |
| slagworks | 617 | 23.7 | 0–2 | yes | 2 |
| forge | 549 | 24.5 | 0–2 | yes | 1 |
| proving-grounds | 574 | 23.0 | 0–2 | yes | 0 |
| titan-valley | 1599 | 17.2 | 0–1* | yes | 0 |
| convoy-line | 1145 | 13.4 | 1–2 | yes | 0 (obstructing descriptor removed) |
| throne | 900 | 24.5 | 0–2 | yes | 0 |
| gauntlet | 672 | 8.5 | 2–5 | yes | 0 |
| dune-ravine | 717 | 30.6 | 0–1 | yes | 4 |
| ember-caldera | 731 | 29.1 | 1–4 | yes | 2 |
| moth-backrooms | 148 | 12.0 | 3–4 | yes | 0 |

## Per-map findings, edits and remaining checks

### 1. Colosseum — corrected

Two tier-one terrace solids around (+/-10,-17.32) occupied both rooms' inward doorways at (+/-11,-16). Reserved the room footprints and inward approaches when placing the seating ring; no building or mission coordinates moved. Doors now pass both navigation and actual bidirectional actor movement. The ground-level ring has an origin-avoiding route, but the description's tier/ramp promise has NOT been proven: terrace blocks still have legacy solid semantics. Reward risk is questionable at the first spawn: rail graph distance 1.0 versus rocket 17.0; spawn LOS 3–6 is high. Remaining visual checks: two newly opened seating gaps, door silhouettes, arches versus collision, and whether tiers misleadingly advertise accessible seating.

### 2. Frost Gate — corrected base entrances; cavern seam outstanding

The deferred tunnel's west approach lowered the base landing within actor-radius reach of its foundation, blocking entrance/exit. Shortened tunnel endpoints from x=+/-34 to +/-32 while retaining base, flag, objective X/Z and spawn coordinates. Both base doors and the entire tunnel now pass bidirectional actor movement. Exterior flank connectivity remains; the rail at (0,22) is about 64.3 graph units from first spawn, versus nearby rocket 20.5 and generated overshield 1.8. This does not establish symmetric race times.

Cavern east default portal probe passes; the west probe still fails near r=11.2. A fine probe had no AABB overlapping at the reported endpoint, so do not label it a prop blockage: intermediate terrain/wall/support seam investigation remains for the spatial owner. `ghost-wire` raw RIDGE coordinate (-12,-26) intersects a cave proxy (see campaign dependencies). Visual checks: snow floor-to-tunnel joins, base landing, west cavern opening and flank readability.

### 3. Sunken Hill — reviewed, unchanged, bridge defect remains

Both default cavern portal probes pass, and objective/reward ground routes connect. All eight bridges on the radius-30 ring have ground-level center obstruction: four low descriptors and four higher ones are not demonstrated walkable decks. The cavern is single-valued stamped ground, not proof of a traversable crown over a cavern. Origin-avoiding route exists; rail/rocket travel from first free spawn is approximately 56.4/56.5. Mixed free/team spawn gap is only 5.8 and LOS reaches 9. Visual checks: crown versus cavern claims, bridge approach elevations and silhouette, team/free-spawn use by mode. Shared-contract/layout follow-up required, not signed off.

### 4. Riverbend — corrected plazas and entrances

Both outer buildings' north-facing world doors discharged directly into the parallel tunnel wall. Outer objective placement had also been nudged into building interiors, and the center plaza was occupied by the building at (-4,0). Moved buildings (-34,0) and (34,0) to z=16, and (-4,0) to z=26; dimensions and deterministic rotation/door choices remain unchanged. All seven building doors pass actual movement, and all three original authored plazas (-30,0), (0,0), (30,0) now remain unnudged and directly approachable.

The tunnel remains connected and exterior alternate routing passes. Rewards changed incidentally through existing placement correction: south rocket moves to roughly (.707,30.707), southeast rail to (31,20). First-spawn graph travel is 50.2/91.4 to the two rockets, 15.6/122.9 to the rails. These are NOT team-balanced comparisons. Team spawn (36,18) now lies within the moved east building, while its coordinates remain unchanged: route safety passes but asymmetric shelter deserves play review. Visual checks: relocated buildings, all three plaza sightlines, the southeast rail's indoor risk and spawned-player egress.

### 5. Iron Fortress — corrected false tunnel-to-keep connections

Both tunnels ended at (18,+/-6), through the solid west keep wall and foundation, not its centered door. Endpoints now stop at (10,+/-14), exposing the forecourt; both paths continue around the tunnel end at x=13 to the real west doorway and the keep center (30,0). Focused tests exercise tunnels in both directions, both buildings' doors, and each forecourt route into the keep. Mission, spawn, objective and reward placement arrays are unchanged.

Ground alternate path exists, but all keep access still converges on a single door: this is a tactical choke, not two independent keep entrances. Rail routes are 59.7/79.0 from first attacker spawn; keeper armor remains in the interior objective. Visual checks: shortened mouths, open forecourt legibility and defender exposure at the mandatory door.

### 6. Atrium — reviewed, unchanged, mezzanine defect remains

All six room door probes pass. Ground lanes and an origin-avoiding route connect with spawn gap 8.0 and LOS 1–2. Both bridges centered at (0,+/-10), top 4.5, are obstructing solids above ground near .6; no connected mezzanine deck is proven. Rocket routes 41.2/77.3 and generated overcharge 1.8 from first spawn warrant risk review. Visual checks: whether the supposed two-level/mezzanine ring is visibly disconnected, room entries and bridge-end readability. Requires shared elevated-surface decision or explicit map reauthoring.

### 7. Catacombs — reviewed, unchanged, route/junction limitations remain

All three east/west tunnel centerlines pass sampled runtime edges; chambers and all required markers connect. The default *diagonal* portal rays on all five caverns hit adjacent tunnel side boxes around r=10.8 onward. This is not a sealed centerline: entering along the horizontal tunnel works, but the apparent opening is wider/differently aimed than its safe approach. No route survives the origin-radius-8 node mask between the selected opposite spawns; no independent flank is claimed. Rail routes vary greatly (14.0/66.0 on the central lane, 63.5/143.2 on the outer lanes), consistent with chokepoint risk. Spawn gap 40.0 avoids overlap but does not cure route concentration. Visual checks: chamber-to-tunnel silhouettes, misleading diagonal exits and safe-turn cues. Junction clearance/route design follow-up remains.

### 8. Slagworks — reviewed, unchanged, catwalk defect remains

Four furnace-building door probes pass, and ground perimeter routing connects all rewards. Both intersecting catwalk descriptors at origin, top 5.5, block ground movement (floor about 3.2); they are not traversable overhead crossings. The ground detour survives the center mask. Rocket routes range from about 21.7 to 72.4 from the first spawn; spawn gap 23.7 and LOS 0–2 do not prove fair rocket access. Visual checks: solid cross versus apparent open underside, catwalk landing points, furnace entries and safe ground crossings.

### 9. Forge — reviewed, unchanged, central platform defect remains

Four workshop doors pass and the outer ground ring is connected. The 11x11 center descriptor, top 2.7 over ground about .58, blocks its center; the generated objective nudge is not proof the raised center is accessible. Rocket/rail graph travel is 53.3/22.7 from first spawn, so the platform meaningfully changes approach costs. Spawn gap 24.5, LOS 0–2. Visual checks: honest ground-level routes around the center, missing platform access, workshop doors and spawn-to-weapon races.

### 10. Proving Grounds — reviewed, unchanged

Four workshop door probes, connected required placements and center-avoiding graph route pass. No bridge/tunnel traversal contract to repair here. Spawn gap 23.0, LOS 0–2; rocket/rail routes 42.9/44.1 from first spawn are comparable, while generated overcharge is only 1.8 away. This is a balance observation, not grounds for an arbitrary layout edit. Visual checks: door recognition, cover separation, weapon-ladder reward appropriateness and approach readability.

### 11. Titan Valley — corrected reward-cavern approaches

The first audit found the north cavern's west and south cavern's east default approaches obstructed by scattered rocks at approximately (-15.626,-33.975) and (9.905,32.873). Caverns realize after scatter, so their approach nodes did not yet reserve these routes. Added only local nav reservations along all four default portals before scatter, using the existing generator's clearance guard. Exactly those two rock props disappear; no broad prop removal. All four portals now pass actual bidirectional actor movement. Final graph has 1599 nodes and required-marker connectivity passes.

Spawns, objectives, pickups, flags and vehicles compare unchanged against the original nextgen definitions with the same current shared generator. Central tunnel and all building door probes passed the earlier diagnostic. First-spawn rail routes were 33.5/102.5 and cavern-side rockets 75.6/83.5 before removal; final race-time/exposure changes were not measured. Infantry navigation is NOT a vehicle-width navigation test. Visual checks: cavern lips after prop removal, high-relief terrain, vehicle turning clearance, bunker approaches and long-range advantage.

### 12. Convoy Line — removed the false overpass obstruction

The central 16x10 legacy deck occupied the tunnel from ground to its top and blocked 18 one-unit sampled sections. Removed that bridge descriptor/solid instead of pretending it was an overhead slab. The existing ground tunnel now works in both directions, building doors pass movement, and the center objective remains at authored (0,0) rather than being nudged to about (0,6). Updated the map description to state the actual tunnel/exterior-flank arrangement. No replacement bridge was invented.

Exterior origin-avoiding navigation remains. First-spawn rocket/rail travel is 53.4/89.4; exposed central pickup choice remains a risk tradeoff. Campaign has an `encounter.bridge` reference that needs semantic reconciliation (below). Visual checks: no dangling bridge expectation, corridor sightline length, roadblock/yard transitions, payload behavior and exterior flank entrances. These tests walk infantry, not the cart or a complete mission.

### 13. Throne — reviewed, unchanged

Both side-building door probes pass; ground ring gaps and required reward/objective paths connect with a center-avoiding route. Terraces remain ground-to-top solids, not verified ascendable seating. Rocket route is 49.3; generated center rail is 44.7, while overcharge near a spawn is only 1.6. Spawn gap 24.5, LOS 0–2. Visual checks: crown visibility, distinct ring exits, cover blocking the boss sightline and whether the description implies an unsupported raised throne. `throne-siege` was not edited or mission-tested.

### 14. Gauntlet — reviewed, unchanged

Both staging-base doors pass, all required placements connect and a center-avoiding route survives. Spawn gap 8.5 and LOS 2–5 show separation but significant exposure. Central rail costs about 45.2, rockets 23.7/73.2, versus generated spawn-side overshield 1.8. No demonstrated closed route justified speculative cover changes. Visual checks: cover heights, flank entrances, long sightlines into staging spawns and elimination-mode spawn safety.

### 15. Dune Ravine — reviewed, unchanged, four bridge defects remain

Ground routes connect across the broken mesa ring and an origin-avoiding path exists. All four bridge centers are blocked at runtime ground; their non-quarter-turn render orientations also need comparison against quarter-turned collision footprints. Do not count the description's four ramps as verified terrain ramps. Spawn gap 30.6, LOS 0–1; rocket/rail travel 76.6/52.6 reflects significant ground detours. Ridge supplies are subject to generator relocation and are not proof of reachable ridge tops. Visual checks: diagonal bridge proxies, mesa gap readability, cover grounding and supply silhouettes.

### 16. Ember Caldera — reviewed, unchanged, crossing defects remain

Broken rim crossings give connected ground routes and the origin-avoiding probe passes. Both crossing decks at origin, top 6.0 above ground about 1.53, remain blocked from the floor. Rocket graph routes include 19.3 versus 84.9 from the first spawn; spawn gap 29.1 and LOS 1–4 do not prove symmetric access. Existing supplies on open ground were not moved. Visual checks: ice/lava cues versus actual safe floor, misleading pass-under space, bridge landings and visibility across rim gaps.

### 17. Quantum Labyrinth / moth-backrooms — reviewed, unchanged

Imported baked layout has 148 connected nav nodes; all required markers attach through real walk edges and an origin-avoiding route exists. It does not use this generator's building/cavern/bridge descriptors, so descriptor-specific door tests are not applicable. Spawn gap 12.0, LOS 3–4; near-spawn rail is only 1.8 graph units away versus rocket 12.0. No map-factory changes were made. Visual checks: actual room door recognition, repeated-room disorientation, sightline-to-spawn exposure and reward contrast. Baked generation/quantum provenance was not retested.

## Campaign and coordinate dependencies

No campaign files, authored mission markers, spawn arrays, flag arrays or authored objective X/Z calls were changed. Comparisons used the original `HEAD:game/nextgen-maps.mjs` loaded in memory with the SAME current shared generators, isolating this batch from concurrent spatial changes.

- Colosseum: spawns, objectives and pickups unchanged.
- Frost Gate / `ghost-wire`: base/flag/spawn and objective X/Z unchanged; outer objective floor Ys change approximately 4.468 -> 4.374 (west), 4.814 -> 4.934 (east). Terrain-following mission/camera consumers should resample. A raw RIDGE marker at (-12,-26), radius 6, was observed intersecting cavern wall proxy centered near (-9.192,-29.192), size 5.85. This is a point-level warning, not proof its entire trigger region is inaccessible; campaign owner should resolve/check its actual trigger. No mission marker was moved here.
- Riverbend: no current mission association. Authored objectives restored exactly; generated old X/Z were (-30.707,.707), (-.707,.707), (31,0), now (-30,0), (0,0), (30,0). South rocket and southeast rail generated nudges are listed above. Spawn arrays unchanged but east spawn shelter changes with the building relocation.
- Fortress / `crown-duel`: placement arrays unchanged. Any external route expecting tunnel endpoints (18,+/-6) must now use forecourt exits (10,+/-14), then x=13 to the west door. Raw current mission marker centers at (-32,0), (-12,0), (0,0) were supported and unobstructed in the point probe. This is not a mission completion test.
- Titan Valley / `reactor-run`: all required placement and vehicle arrays unchanged; only two portal rocks removed and approach nav nodes added. Campaign owner retains responsibility for encounter/vehicle validation.
- Convoy Line / `convoy-run`: spawn/pickup arrays unchanged. Generated central objective changes from approximately (0,6), y=1.454, back to authored (0,0), y=1.496. A concurrent campaign snapshot uses `anchor:'encounter.bridge'`, step id `bridge`, label `BRIDGE`; the bridge descriptor is now absent. Keep the logical ground encounter if appropriate, but campaign owner must reconcile anchor semantics/dialogue and rerun its focused mission checks. Do not assume a raw anchor reference is an {x,z} coordinate: an initial diagnostic made that mistake and was corrected; no campaign output or fake success was fabricated.
- Throne / `throne-siege`: reviewed but unmodified.

Campaign files were active during this batch. Association/marker details are handoff observations, not a stable snapshot assertion against the other worker's final output.

## Outstanding runtime blockers and visual review

1. **19 bridge descriptors across six maps remain unverified as traversable upper surfaces and blocked at runtime ground centers:** Sunken Hill 8, Atrium 2, Slagworks 2, Forge 1, Dune Ravine 4, Ember Caldera 2. Shared `addBridge` still emits a legacy [0,h] deck. No metadata reinterpretation was attempted. Restoring true elevated crossings needs the lead/spatial owner's explicit simulation/render/nav representation plus map-specific landings, or separately approved ground-causeway reauthoring. This batch is not that shared feature.
2. Frost Gate west cavern portal seam remains a failed walk probe; Catacombs diagonal default exits collide with tunnel-side proxies despite clear horizontal centerlines. Catacombs alternate-route probe also fails. These are runtime follow-ups, not merely visual polish.
3. Generated spawn-side powerups often have almost no travel cost. This is a shared supply-placement/balance concern, not repaired by arbitrary per-map edits. Static spawn LOS is not a respawn fairness guarantee.
4. Bridges, terraces, roofs and cavern crowns must not be promoted to usable stacked levels in the coverage ledger. Ground connectivity alone does not validate the advertised vertical gameplay.
5. Every map still needs a rendered first-person walkthrough: entrances/exits legibility, alternate-route cues, collision/render alignment, reward exposure, spawn separation under actual mode, and structure-specific checks above. No screenshots, browser playthrough, hardware performance measurements or visual approval were produced.

## Focused verification

Each of the six defect-specific tests was observed RED for the expected real collision/nav failure before its production edit, then GREEN. The later required-placement/connectivity/spawn tests are characterization regressions, not invented pre-edit failures.

Final command:

```sh
node --test game/phase1-nextgen-review.test.mjs
# 12 tests, 12 passed, 0 failed, 0 skipped. Final recorded duration about 14.65s.
```

Only these six changed maps are asserted by that test file. Importing core initializes the registry but does not run the full map/application suite. The wider 17-map review used bounded read-only diagnostic probes, not the full suite.

```sh
git diff --check -- game/nextgen-maps.mjs game/phase1-nextgen-review.test.mjs docs/phase1-nextgen-handoff.md
node --check game/nextgen-maps.mjs
node --check game/phase1-nextgen-review.test.mjs
```

All final checks are scoped to owned artifacts. No deployment or commit was made. Lead should integrate this document's unresolved items into the lead-owned coverage ledger; automated success is explicitly not visual signoff.
