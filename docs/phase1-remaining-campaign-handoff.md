# Phase 1 remaining campaign — integrated bounded handoff

## Scope and ownership

Reviewed and integrated only **reactor-run, throne-siege, ghost-wire, crown-duel**. Read `docs/phase1-campaign-handoff.md` first. Convoy Run's mission block and lore were not edited; its existing anchor helper and predeployment/checkpoint contracts were reused.

Written by this batch:
- `game/campaign-data.mjs`
- `game/singleplayer.mjs`
- `game/story.mjs`
- new `game/phase1-remaining-campaign.test.mjs`
- this handoff

`game/campaign-anchors.mjs` was inspected and reused unchanged. No writes to nextgen-maps, shared core/view/generators, existing tests, phase 2 assets/audio/HUD, or progress ledgers. No delegation, commit, deployment, full suite, or complete five-mission campaign sweep. Other workers' existing edits remain in the working tree.

## Integrated runtime contract

- Every reviewed entrance, objective, encounter and checkpoint references a named FLOOR anchor. All new anchors have `maxSnap:3` and explicit Y bounds. Resolution uses the existing helper's bidirectionally entrance-reachable nav component; no map-wide fallback or geometry repair was added.
- Runtime markers have authoritative navigation Y and `halfHeight:1.5`. Kill objectives in the three assault missions now use `complete.requireZone:true`, consumed by `stepComplete`: clearing enemies remotely or from another elevation does not skip the route visit. Ghost remains a non-elimination mission.
- All onStart defenders are predeployed before visible simulation. Shared existing deployment identity tracking prevents later duplication. Each group uses connected floor slots, a 1.25-unit vertical placement band, actor clearance, and 1.5-unit placement separation. Insufficient slots remain a hard error, not an isolated or overlapping required group.
- Optional live script reinforcements were removed, preserving every script ID. Scripts and lore are step-scoped; phase changes, weather and tactical captions remain. Low-enemy-count chatter that would not fire with future groups already present is now step-scoped `at:0` chatter.
- Crown's Harbinger remains the Harbinger archetype, with authored boss phases. Its spawn explicitly has `summons:false`; `spawnGroup` consumes this by clearing that actor's summon ability after archetype fields are applied. This does not globally disable Harbingers or horde summons. Lore says its summon channels are jammed. Phase-script adds were also removed.
- A real Ghost Wire race was reproduced: step completion changed the active step before the matching zone script was evaluated. Predeployed campaign zone scripts now evaluate once before linear completion, using the same height-aware trigger and fired flags. The ordinary script loop skips those already fired. This is the only additional shared script-order change; Convoy's existing bridge event retains its volume/step/once-only gates.
- Authored checkpoints reconstruct current/future groups at their named floor, clear stale rockets/deployables/captions, suppress earlier-step scripts, retain dense actor IDs, and resupply through the existing difficulty policy. Recovery actions are present at the migrated checkpoints. Reactor and Crown record terminal checkpoints before victory; their fallback is now a cleared exit volume, still gated behind completion of the whole linear chain. Loading a terminal checkpoint no longer waits forever for an absent boss.

## Individual geometry inspection and routes

Inspected each relevant `nextgen-maps.mjs` layout read-only and instantiated each mission with its explicit map ID. The tests assert the actual arena ID. Coordinates below are authored X/Z; Y is resolved at runtime, not an eye height or tunnel center. Duplicate coordinates intentionally represent distinct encounter/objective/checkpoint roles.

### Reactor Run / titan-valley

Read-only findings: bases occupy (-60,0) and (60,0); smaller outposts occupy (+/-28,+/-30); the central tunnel runs through the origin; the north cavern is at (0,-30). The revised route avoids requiring entry into base/outpost buildings and does use the real connected north cavern floor. This is an explicit authored route revision, not a wide snap from a blocked legacy point.

| Anchor | X/Z | Floor Y range |
| --- | --- | --- |
| entrance | -60,-18 | 6..9 |
| encounter.outpost | -28,-20 | 5..8 |
| encounter.reactor | 0,12 | 4..8 |
| checkpoint.cavern | 0,12 | 4..8 |
| encounter.cavern | 0,-30 | 5..7 |
| encounter.south | 28,20 | 4..8 |
| encounter.warden | 46,0 | 4..7 |
| exit | 46,0 | 4..7 |

Observed floor examples: entrance Y=7.54348; outpost resolves locally to (-28,-20.33333), Y=6.36680; reactor apron Y=5.96733; cavern Y=6.04489; south resolves to (26.96552,20.62069), Y=5.94181; Warden approach resolves to (45.58417,approximately 0), Y=5.27869.

Groups: outpost 7, reactor 10, cavernA 9, south 5, warden 4. All 35 are initially deployed. The reactor group initially failed the 9-unit slot budget (last four requested, only two slots remained). Inspection of local supported nodes justified a bounded 12-unit encounter radius there; all other reactor group radii are 9. No snap bound was widened. Cavern now requires cavernA cleared before its 25-second hold. Every kill objective also requires visiting the correct-height marker.

Steps unchanged: outpost, reactor, cavern, south, warden. Checkpoints unchanged: 2 and 5. Checkpoint 2 restores to the cleared reactor apron; 5 restores at exit and wins on the next objective update without respawning a boss.

Evidence: 8 anchors + 35 defenders passed supported floor, unobstructed placement, bidirectional reachability and continuous walking-edge checks. Entrance graph reached 1599/1599 current nav nodes. Controlled walkthroughs from 0 and 2 reached step 5, checkpoint 5, won, with all required defenders dead. Actual Match.step: 120 frames at entrance with 36 actors, then a separate config-checkpoint-2 start with 19 actors; both retained their objective, finite positions and actor count.

Limitation: this revises the core encounter to the south apron and boss encounter to the east forecourt. It does not certify base interiors or vehicle/tunnel combat. Human pacing for 35 predeployed defenders remains unmeasured.

### The Broken Throne / throne

Read-only findings: terrace ring at radius 16, central columns at (+/-6,0)/(0,+/-6), additional diagonal columns/cover, buildings at (+/-26,0). The available central objective is on the actual supported arena floor, not an invented raised platform Y.

All anchors use Y=0..2 and maxSnap=3:
- entrance (0,42)
- encounter.approach (0,30)
- encounter.breach (0,12)
- checkpoint.midfield (0,24)
- encounter.midfield (0,-12)
- checkpoint.warden (0,-12)
- encounter.warden (0,0)
- checkpoint.throne (0,-12)
- encounter.throne (12,-24), the predeployed northeast reserve
- objective.throne (0,0), the final hold floor

Observed floor Y: entrance 0.81637; approach 1.00547; breach 1.05350; pit 1.00342; center 1.01595; northeast reserve 0.90844.

Groups: approach 4, breach 8, midfield 7, warden 3, throne 9; radius 9 throughout. Breach also requires the approach group, preventing abandoned opening defenders. Both holds require their own defenders cleared (18 seconds pit, 25 seconds throne). Final reserve is not materialized on the player at the center; it already occupies its reachable northeast sector. Checkpoint 4 restores on the cleared pit floor, away from the remaining reserve.

Steps unchanged: approach, breach, midfield, warden, throne. Checkpoints unchanged: 2, 3, 4; no new terminal checkpoint added.

Evidence: 10 anchors + 31 defenders passed floor/clearance/continuous path checks; 900/900 entrance-reachable nav nodes. Controlled walkthroughs from 0 and 2 reached step 5, checkpoint 4, won, without leftover required actors. Actual Match.step: 120 frames at entrance with 32 actors and separately checkpoint 3 with 13 actors; no deployment, nonfinite state or premature progress.

Limitation: the final reserve must be cleared northeast before holding center. This is not a timed reinforcement survival fight anymore. No visual review of terrace readability or human combat balance is claimed.

### Ghost Wire / frost-gate

Read-only findings: large bases at (+/-48,0), tunnel through the central X axis, north cavern at (0,-20), rock ring and scattered props. The route uses the north ridge, the supported central relay floor and southeast extraction. Narrative no longer directs the player into an east tunnel to reach an exit at (46,24).

All anchors use Y=2.5..6.5 and maxSnap=3:
- entrance (-50,-24), observed local resolution (-48,-24), Y=4.37174
- encounter.drop (-48,-30), Y=4.09377; marker radius 4 so the entrance does not immediately finish the drop
- encounter.ridge and checkpoint.slice (-14,-26), Y=5.18623
- encounter.slice and checkpoint.exfil (0,0), Y=5.16280
- encounter.exfil (34,18), the predeployed extraction defenders
- exit (46,24), observed local resolution (45.1,23.55885), Y=4.14562

Groups: drop 2, ridge 4, slice 7, exfil 4; radius 9 throughout. They remain optional combat. Drop/ridge/exfil need the correct-height route volume; the splice needs 14 seconds in its volume but does NOT require kills. Guard zones are held positions rather than new patrol/response bodies spawning on screen; captions were adjusted accordingly. The ridge script now fires before same-tick enter-zone advancement, and the exfil script can fire before victory.

Steps unchanged: drop, ridge, slice, exfil. Checkpoints unchanged: 2 and 3. Restoration omits prior optional groups by the existing checkpoint reconstruction contract; it is not an exact save of pursuers.

Evidence: 8 anchors + 17 defenders passed floor/clearance/path checks; 877/877 entrance-reachable nav nodes. Controlled walkthroughs from 0 and 2 won at step 4/checkpoint 3 with every reconstructed optional defender still alive. Actual Match.step: 120 frames entrance with 18 actors and checkpoint 2 with 12 actors; no pop-in or unintended progression. Explicit red/green test covers the ridge-script race; all zone scripts also reject the wrong height and fire once.

Limitation: the no-kill result uses controlled positions and player protection; it is not a demonstrated stealth movement route under live enemy fire. Central floor is validated against current floorAt/nav, not a claim of multilayer tunnel navigation.

### The Crown Duel / fortress

Read-only findings: gatehouse at (-34,0) blocks a straight push; keep at (30,0) has a real west doorway. Flank tunnels discharge into the forecourt rather than piercing keep walls. The revised first encounter is the north gatehouse apron, with final boss actually inside the keep rather than sharing the ring at (0,0).

| Anchor | X/Z | Floor Y range |
| --- | --- | --- |
| entrance | -46,0 | 1..4 |
| encounter.approach / checkpoint.shield-line | -32,-12 | 2..5 |
| encounter.shield-line / checkpoint.ring | -12,0 | 3..5 |
| encounter.ring / checkpoint.duel | 0,0 | 3..6 |
| encounter.duel / exit | 30,0 | 4..6 |

Observed floor Y: entrance 2.26553; approach locally resolves (-33.14286,-12.85714), Y=3.17802; shield line 3.97373; ring 4.54163; keep 4.78998. All nine named anchors remain within their 3-unit snap contract. Static continuous paths reach the keep floor from entrance.

Groups: approach 4, shield-line 8, ring 9, duel 2; radius 9 throughout. Ring requires its defenders cleared before the 18-second hold. Kill objectives require their marker floor. Boss and elite bulwark guard deploy inside the keep before play. The explicit summon override is tested by forcing the Harbinger timer to zero: actor count remains 24 and summonCount remains zero. Other boss phase mechanics remain available.

Steps unchanged: approach, shield-line, ring, duel. Checkpoints unchanged: 1, 2, 3, 4. Each nonterminal checkpoint restores on the preceding cleared encounter floor. Terminal checkpoint 4 now records before win and restores to a completable exit volume.

Evidence: 9 anchors + 23 defenders passed floor/clearance/path checks; 852/852 entrance-reachable nav nodes. Controlled walkthroughs from 0 and 1 won at step/checkpoint 4 with required defenders dead. Actual Match.step: 120 frames entrance with 24 actors and checkpoint 3 with only player/boss/guard (3 actors), no deployment or unintended progress.

Limitation: dynamic swarms are intentionally replaced by fixed defenders, not by a new hidden-spawn system. Actual walking/combat through the doorway and multi-phase difficulty balance need human/runtime traversal review beyond this bounded sample.

## Verification and reproducible command

From repository root:

```
node --test game/phase1-remaining-campaign.test.mjs
```

Final run: **22 tests passed, 0 failed, 0 skipped; exit 0; duration_ms 21185.761721**.

Coverage includes four individual map/nav checks; controlled entrance/checkpoint walkthroughs; every authored checkpoint's position, future-group reconstruction, dense IDs, recovery, hazard cleanup and prior-script suppression; terminal boss checkpoint completion; four bounded real Match.step tests; early-fallback rejection; height-aware once-only script volumes; Ghost ridge same-tick ordering; and forced Harbinger summon suppression.

Observed red tests before fixes: missing named-anchor integration separately for all four missions; Reactor's insufficient local group slots; wrong-height kill-objective completion in Reactor/Throne/Crown; bossless terminal checkpoint softlock in Reactor/Crown; Crown summon actor-count increase from 24 to 26; and skipped Ghost ridge zone script. Ghost's optional-kill traversal already passed its intended progression semantics and was retained.

Also executed:
- `node --check` for campaign-data, singleplayer and story.
- `git diff --check` restricted to owned files.
- Read-only comparison with HEAD of each changed mission's mission ID, ordered step IDs, ordered script IDs and authored checkpoint indices: all four returned `stable IDs true`.

## Remaining dependencies and limits

1. No necessary route is currently blocked in the inspected map/nav state. No geometry repair, cross-map snap or hidden map dependency was used. The map worker must rerun this focused file after geometry changes, particularly Titan cavern approaches, Frost central floor and the Fortress west keep door. Floor/nav/obstruction consistency remains a shared-core dependency, not something this worker repairs.
2. Static paths validate every walking edge along entrance-to-anchor/actor routes, with bidirectional component membership. They do not simulate a human physically following those paths or prove bots cannot become stuck during prolonged combat.
3. Controlled walkthroughs explicitly assign player positions, clear only required groups by setting health to zero, protect the player and use enlarged objective-update dt for holds. These are sequencing/softlock checks, not combat victories. Ghost deliberately clears no optional actors.
4. Actual Match.step samples use player protection and no movement input, 120 frames per start mode. NPCs and simulation run normally during those samples. They establish finite live state and absence of deployment/progression defects in the sample, not long-session balance, stealth feasibility, navigation performance or win rates.
5. Predeployment changes encounter pacing; shared leash and ability behavior remain. Recovery uses the existing difficulty policy; this batch checks easy recovery, not four-difficulty balance. Checkpoints are reconstructive, not exact combat saves.
6. Convoy was not swept or rewritten. Its original focused tests and handoff remain untouched. The shared opt-in requireZone and per-spawn summons fields do not affect its authored actions. Shared pre-completion zone-script ordering is noted above; this batch makes no new Convoy runtime certification.
7. No browser/visual review, full suite, complete campaign sweep, old-autoplay harness reconciliation, phase 2 changes, commit or deployment. Existing older tests may still assume planar teleports or dynamic spawning, as already noted in the Convoy handoff.
