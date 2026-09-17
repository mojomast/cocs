# Phase1 bounded legacy map review

## Scope and result

Reviewed all 17 templates in island-maps, expansion-maps, ctf-maps, battle-maps, arsenal-maps and blood-gulch individually. Changed seven maps in four map files; retained ten. Added `game/phase1-legacy-review.test.mjs`. CTF and arsenal source files are intentionally unchanged.

Only these owned paths were written: `game/island-maps.mjs`, `game/expansion-maps.mjs`, `game/battle-maps.mjs`, `game/blood-gulch.mjs`, the new test, and this handoff. No shared generator/schema, maps registry, core, view, nextgen, mode, weapon, texture, music, audio or HUD edits. No deployment, commits, delegation, or full suites. Existing concurrent work was not reverted.

**Geometric/runtime checks are NOT visual signoff.** This review uses the current concurrently edited core; rerun this bounded command after integration:

```sh
node --test game/phase1-legacy-review.test.mjs
```

Final execution: **19 tests passed, 0 failed**, about 7.1 seconds. Initial regression run: 10 passed, 7 failed (six reward-clustering cases and Skyfall's embedded traversal devices). A subsequent movement regression caught a proposed Skyfall pad relocation overlapping a spawn; final pads are offset to clear it. No production changes were made to blocks, terrain, platform dimensions, spawn coordinates, flags, objectives, vehicle rosters or weapon inventories.

## What the measurements establish

- Real `floorAt`, `obstructed` at radius 0.52, `walkEdge`, `navigation`, `visible`, and `moveActor`; no nearest-node-only connectivity claim.
- Every distinct authored ordinary/team spawn, pickup, flag and objective has support, body clearance, and an actual walk edge to the reachable navigation graph. Team aliases and identical ordinary/team spawn positions are deduplicated.
- Every spawn has a directed graph return path to the starting spawn's attachment. All authored jump-link endpoints have real walk attachments. Navigation includes authored traversal edges; this is not a claim that disconnected islands can be crossed on foot.
- Every spawn passed a 3-unit local walking exit and every pickup a 3-unit local walking approach, chosen from eight directions. Simulation is bounded to 180 frames at 60 Hz per candidate, with traversal cooldown set high to isolate walking collision. These are local movement checks, not end-to-end played matches.
- 219/219 unique spawn exits and 316/316 reward approaches passed. All inspected marker collision/connectivity checks passed.
- Pickup clustering threshold is 2.1 world units in 3D, twice runtime collection radius 1.05. Overlapping spheres permit one position to collect two rewards; this is a concrete placement issue rather than a general prohibition on nearby rewards. Final overlap count is zero on each reviewed map. Tests walk into collection range but do not assert inventory/economy mutation.
- Sightline column is the minimum–maximum number of other unique spawn positions visible from each spawn, at feet +1.45, through real world ray collision. It includes same-team positions; it is NOT enemy exposure probability or a balance grade. Since geometry and spawns were retained, these sightline counts did not change.
- Jump-pad/trampoline/boost/teleporter sources are checked against floor collision; teleporter destinations against collision. Skyfall's moved pads are actually activated through `moveActor`, with positive launch velocity, and both teleporters actually transport an actor to clear destinations.
- A separate regression checks every reviewed legacy block as solid from ground to top, including `deck`; misleading `y`/`minY` metadata cannot turn it into an elevated hollow solid. No legacy solid semantics were changed.

## Per-map measured evidence

Reachable/total = runtime navigation nodes reachable from the first spawn attachment. Exits and approaches are passed/total movement checks.

| Map | Reachable/total | Spawn exits | Reward approaches | Spawn sightlines |
|---|---:|---:|---:|---:|
| skybreak | 190/190 | 8/8 | 21/21 | 3–4 |
| aether | 194/194 | 8/8 | 21/21 | 1–2 |
| sunscar-canyon | 726/726 | 10/10 | 16/16 | 7–9 |
| ironfall-megastructure | 250/250 | 10/10 | 18/18 | 3–7 |
| longreach-plateau | 406/406 | 10/10 | 18/18 | 4–5 |
| frostline | 1730/1730 | 11/11 | 20/20 | 1–4 |
| derelict-station | 1751/1751 | 13/13 | 21/21 | 1–7 |
| ashen-rift | 1857/1857 | 11/11 | 20/20 | 1–6 |
| neon-vertical | 722/722 | 14/14 | 18/18 | 5–6 |
| substation | 486/486 | 14/14 | 18/18 | 3–7 |
| warfront | 1166/1166 | 16/16 | 20/20 | 3–6 |
| skyfall-basin | 1551/1551 | 14/14 | 20/20 | 2–4 |
| trenchline | 1564/1564 | 20/20 | 16/16 | 6–11 |
| signal-ridge | 1428/1428 | 20/20 | 16/16 | 6–10 |
| rampart | 1045/1045 | 12/12 | 15/15 | 2–6 |
| catwalk-breach | 939/939 | 12/12 | 16/16 | 2–6 |
| blood-gulch | 1227/1227 | 16/16 | 22/22 | 1–6 |

## Individual decisions and remaining dependencies

### Skybreak Isles — changed rewards; retained three-route islands

Three original collection overlaps: each central flak was 2 units from plasma, and south flak was 1 unit from overshield. Move flak `(0,-2)/(0,2)` to `(-8,-3)/(8,3)` on the same middle island. This spreads the central reward without moving its landmark, opening fake passages, changing flank rocket/rail incentives, or altering launch links. All 21 approaches pass; all 190 nodes remain connected. Visual dependency: confirm the two new central pickup silhouettes and edge readability during fast crossings, plus played launcher landings on all three routes.

### Aether Ring — changed rewards; retained diagonal ring

Four original grenade/shock-to-flak pairs were 2 units apart on the small north/south middle islands. Move flak from `(0,±22)` to `(0,±24)`, separating collection spheres while retaining each island's three rewards. All 21 approaches and 194 nodes pass. Visual dependency: verify the flak's one-unit center-to-platform-edge margin reads safely and does not visually overlap void trim; test ring crossings in both directions.

### Sunscar Canyon — retained

No blocked markers, disconnected required approaches or overlapping rewards found; 726 nodes and 16 rewards pass. Valley rocket/overshield and shelf rail distribution already distinguish low and high routes. Spawn visibility is high (7–9) but consistent with its open valley identity; visibility alone does not justify filling the canyon with cover. Legacy shelf blocks with tops below terrain remain unchanged rather than being silently lifted. Visual dependency: inspect shelf cover representation and launcher/ramp legibility, and playtest high exposure under fire.

### Ironfall Megastructure — changed rewards; retained broken vertical decks

Flak and overshield originally shared `(0,0)` exactly. Move only flak to `(0,-4)` on the middle platform, retaining the central power objective, upper rails and side machinery. All 18 approaches pass; 250 nodes now reachable (249 before the distinct reward node). Visual dependency: confirm the new pickup's separation from reactor silhouettes and validate elevated launcher landings/vehicle access. Low legacy machinery blocks are not reinterpreted as elevated cover.

### Longreach Plateau — changed rewards; retained broad table and flank islands

Flak and overshield also shared `(0,0)` exactly. Move flak to `(0,-4)`, leaving the table's lookout at z=-7 and flank rail/rocket placement intact. All 18 approaches pass; 406 connected nodes (405 before). Visual dependency: confirm flak reads against the lookout and long open approaches remain understandable at gameplay FOV; playtest flank launch timing.

### Frostline — retained

All 20 rewards, 11 exits, jump-link endpoints, and 1730 nodes pass; no collection overlaps. The bridge rocket, off-axis rail shelves and shield near the bridge edge remain deliberate risk choices. Fort spawn sightlines are low relative to exposed mid spawns (overall 1–4). Visual dependency: verify bridge/crevasse boundaries, ice-cave entrances and long flank launch landings; no claim of rendered snow/ice readability.

### Derelict Station — retained

All 21 rewards, 13 exits and 1751 nodes pass. Separated upper rocket, lower/upper rail, central shield and flank utilities retain its three-height station identity. Sightline spread 1–7 is recorded, not normalized by flattening the terrain or lifting ground-origin blocks. Visual dependency: confirm upper/lower deck silhouettes match collision and that lift destinations and lower-lane sightlines read correctly.

### Ashen Rift — retained

All 20 rewards, 11 exits, jump endpoints and 1857 nodes pass. Keep the intentional asymmetric west fortress/east refinery, bridge rocket/shield and tunnel-side rail incentives. No unsupported shield or disconnected cave marker was found by real floor checks. Visual dependency: inspect lava/bridge edge readability and tunnel mouths; playtest asymmetric approach timing rather than assuming symmetry from graph connectivity.

### Neon Vertical — retained

All 18 rewards, 14 exits and 722 nodes pass with no overlapping collection spheres. Central tower and offset city blocks already interrupt ground routes; arbitrary new openings would change identity. Visual dependency: render/ride rooftop launchers and ziplines, check rooftop/ground distinction and central pickup visibility. The pedestrian checks do not certify roof-to-roof travel.

### Substation 7 — retained

All 18 rewards, 14 exits and 486 nodes pass. Pillars/bulkheads permit access to the middle flak and separated inner rail pickups; no geometric reason to remove indoor cover was found. Visual dependency: inspect ceiling/headroom appearance, corridor readability and teleporter arrival awareness; no visual indoor signoff implied.

### Warfront Delta — changed reward; retained reactor and armour lanes

Overshield `(0,16)` and SMG `(0,14)` were 2 units apart. Move SMG to `(4,14)` on the same reactor-side approach, keeping the power reward contested and all existing weapon kinds/counts. All 20 approaches, 16 exits and 1166 nodes pass. Visual dependency: check reward visibility around the reactor and vehicle-width lanes with actual vehicles, not an infantry-radius assumption.

### Skyfall Basin — changed embedded traversal devices; retained mesa/base masses

Four sources were blocked: pads at `(±64,0)` and teleporters at `(±56,0)` lay inside base cores centered at `(±60,0)` with width 14/depth 24. Move pads to `(-70,-14)/(70,14)` outside solids and away from spawn activation radius. Move reciprocal teleporter sources AND destinations to `(±50,0)` on the clear inner aprons. No wall hollowing or legacy height reinterpretation. Both pads launch and both teleporters transport actors with real `moveActor`; 1551 nodes (1549 before), 14 exits and 20 rewards pass. Visual dependency: verify pad/teleporter signage and flight landing readability, plus armour/aircraft interactions on the aprons. The first proposed pad positions at `(±70,0)` were rejected by a failing spawn-activation regression before handoff.

### Trenchline — retained

All 16 rewards, 20 exits and 1564 nodes pass. Zig-zag trenches retain route friction and the central fort remains solid. Visibility is relatively high (6–11); connectivity alone does not prove safe spawning under opposing fire. Visual dependency: inspect trench silhouette/crouch cover and vehicle/pickup coexistence, especially transport positions sharing rocket locations; vehicle occupancy is outside these static infantry checks.

### Signal Ridge — retained

All 16 rewards, 20 exits and 1428 nodes pass. Side rockets and rail pickups near the north/south decks already spread the reward footprint without treating the solid ridge as a tunnel. Visibility range 6–10 is recorded for playtest. Visual dependency: inspect the cross-map zipline over the ridge, deck access and elevated silhouette readability; full zipline traversal was not certified here.

### Rampart — retained

All 15 rewards, 12 exits and 1045 nodes pass. Street walls/barricades route approaches around the capture sequence; central grenade and flank rocket/rail incentives are separated. No reason to cut additional passages through its urban walls. Visual dependency: walk both street detours in the renderer, checking ordered objective readability and alley corners under combat pressure.

### Catwalk Breach — retained

All 16 rewards, 12 exits and 939 nodes pass. Solid deck blocks remain solid; ground routes reach the three breach objectives and distributed rewards without inventing walk-under spaces. Visual dependency: verify catwalk/deck tops and jump-pad use in the renderer; name/theme must not be interpreted as proof of hollow platforms or navigable undersides.

### Blood Gulch — changed rewards; retained canyon/base terrain

Original flak at `(0,±20)` lay approximately 2.02 units in 3D from mid health/armor at `(0,±18)`, overlapping collection spheres. Move flak to `(0,±23)` toward ridge approaches, retaining the central hill rocket/shield and existing base/cave geography. All 22 approaches, 16 exits and 1227 nodes pass; no terrain or base-wall change. Visual dependency: confirm new flak visibility on the ridge slope, cave portals and roof launch landings. Actual vehicle navigation and base-roof routes need played review.

## Explicit remaining limits

No browser screenshots or human visual review were produced. No FPS/manual combat balance, all-mode match simulations, vehicle clearance sweep, full ballistic traversal sweep, zipline ride sweep or inventory mutation tests were run. The authored runtime graph can include jump/teleport edges; endpoint reachability alone does not certify the entire flight. Covered movement paths are bounded local checks, not an exhaustive traversal of every polygon. Modes and map identity were preserved by leaving metadata and shared registration alone. Rerun this file after the lead reconciles core/view/schema concurrent work, then perform the per-map visual dependencies above.
