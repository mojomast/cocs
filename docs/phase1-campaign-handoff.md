# Phase 1 campaign bounded integration handoff

## Ownership and scope

This batch reviews and revises **convoy-run / The Long Haul / convoy-line only**. It is not campaign-wide or map-family approval.

Written: `game/campaign-data.mjs`, `game/singleplayer.mjs`, `game/story.mjs`, new `game/campaign-anchors.mjs`, new `game/phase1-campaign.test.mjs`, this handoff. `game/campaign.mjs` was inspected and did not require changes. No core, view, map-family, levelgen, existing test, progress ledger, phase 2, deployment, or commit changes were made by this worker. Other workers' edits were retained.

Mission coverage:

| Mission | Review in this batch |
| --- | --- |
| convoy-run | Authored route, all five steps, all six authored script IDs, four lore lines, every required group, start, checkpoint 3, terminal checkpoint 5, exit reviewed and revised. |
| reactor-run | Campaign source inspected for context only; no route review, revisions, or runtime test. |
| throne-siege | Campaign source inspected for context only; no route review, revisions, or runtime test. |
| ghost-wire | Campaign source inspected for context only; no route review, revisions, or runtime test. |
| crown-duel | Campaign/story module inspected for context; no route review, revisions, or runtime test. |

## Read-only geometry findings and dependencies

`game/nextgen-maps.mjs` convoy definition has depot buildings at (-64,0) and (64,0), tenements at (-36,+/-20), (-8,+/-24), (22,+/-20), (46,+/-22), a tunnel along z=0 from x=-48 to 48, and a central elevated bridge. The old rally was inside the depot, the boss at (64,0) inside the east depot, and several spawn groups overlapped buildings or mixed the tunnel axis with above-ground objectives.

The revised route deliberately stays on the exterior service road, uses a crossing south of the bridge, and fights outside the east depot. Authored tunnel points are FLOOR coordinates; this worker did not reinterpret or offset them. No tunnel or interior objective is claimed reviewed here.

Dependencies remain explicit:

- Shared generator terrain stamping, authoritative `floorAt`, obstruction tests, and `Match.nav` / `Match.edges` must remain mutually consistent. The helper imports no core or map code, avoiding a core -> singleplayer -> core cycle.
- Named anchors resolve to actual floor nodes with an explicit local snap bound and Y range. Both forward and reverse graph reachability from the entrance are required. Actor placements stay within 1.25 vertical units of the resolved anchor and at least 1.5 horizontal units apart/from live actors.
- An unavailable anchor or insufficient connected spawn slots throws an actionable error before silently creating an unreachable required group. It does NOT attempt to repair map geometry or fake objective completion.
- Map-family review must recheck these anchor contracts after geometry changes. The current navigation implementation remains the authority; this is not a new multilayer navigation implementation or proof that every interior is accessible.

## Stable named anchors and revised coordinates

All coordinates below are (x,z). Runtime Y is authoritative navigation floor Y, not a hardcoded actor/eye height. Every anchor currently resolves at its authored X/Z. All use minY=-2, maxY=4; maxSnap is 3 except tenements/roadblock, which allow 4.

| Anchor | Authored X/Z | Consumer / change from old location |
| --- | --- | --- |
| entrance | (-66,-12) | Start unchanged horizontally; now uses the named supported floor. |
| approach.depot | (-54,-12) | rally marker moved from (-64,0) inside depot to exterior apron. |
| encounter.opening | (-48,-12) | Replaces opening spawns at (-60,-6), (-54,-16). |
| encounter.tenements | (-30,-10) | Marker formerly (-32,0); replaces group origins (-36,-18), (-24,8). |
| encounter.bridge | (0,12) | Marker formerly (0,6); crossing now below/south of bridge, not its deck. Replaces origins (-8,0), (8,12). |
| checkpoint.roadblock | (12,12) | Checkpoint step 3 now restores to the cleared crossing's east approach rather than mission start. |
| encounter.roadblock | (34,10) | Marker formerly (34,0); replaces origins (40,-14), (28,12). |
| encounter.yard | (54,12) | Marker formerly (58,0); replaces boss (64,0) and guards (48,-18) with outside apron. |
| exit | (54,12) | Terminal checkpoint 5 and fallback exit; formerly fallback (58,0). |

All reviewed trigger markers use halfHeight=1.5. The shared runtime default is 2 for legacy markers after resolving their floor Y. Vertical separation now rejects enter-zone, hold, and player-in-zone script completion; dead players cannot satisfy these volumes.

### Exact observed defender placements

At the tested generated map state, the 19 defenders occupy these X/Z floor nodes. The focused test checks each node's floor height, actor clearance, entrance connectivity, and every walking edge along an entrance route.

- opening: husks (-48,-12), (-49.5,-10.5).
- tenements: husks (-30,-10), (-30,-12), (-34,-10); spitters (-30,-14), (-30,-6).
- bridge: husks (0,12), (-2,10), (-2,14); spitters (2,10), (2,14).
- roadblock: husks (34,10), (36,12), (30,10); brute (34,6).
- yard: Warden (54,12); brutes (54,10), (54,14).

Group sampling radii: opening 6, tenements 8, bridge 9, roadblock 8, yard 8. All use hold-zone behavior. Existing enemy archetype leash/difficulty behavior remains in effect. Placements can change when map geometry changes; the named anchors, not these sampled per-actor coordinates, are the persistent authoring interface.

## Integrated progression, scripts and recovery

- Mission ID, five step IDs (`rally`, `tenements`, `bridge`, `roadblock`, `yard`), and authored checkpoint indices 3 and 5 are preserved. All six convoy script IDs and lore IDs are preserved.
- Approach: exterior rally, then clear the opening patrol and tenement group. Opening patrol is explicitly required rather than left behind as an untracked threat.
- Encounter: clear bridge guards, then hold the correct-height service-road volume for 20 seconds. Hold progress resets if required guards remain or the player leaves the volume.
- Recovery: bridge completion grants one supply action and checkpoint 3 before the roadblock approach. Health minimum and finite owned/current weapon reserve minimum are 100% / 80% / 60% / 40% on easy / normal / hard / nightmare; armor minimum is 60 times that fraction. Larger existing reserves are retained. Infinite starter ammo remains infinite, and unowned empty weapons are not granted. Existing health regeneration is unchanged.
- Final encounter: kill the outside Yardmaster and both guards. Checkpoint 5 is recorded before the victory action, avoiding the previous action-loop early return.
- All 19 required actors are predeployed during initialization, before the first visible simulation frame. Step onStart actions recognize already-deployed specifications and do not duplicate actors. This is an intentional bounded alternative to unsafe in-view reinforcement spawning.
- Old optional scripted reinforcement spawns are removed from this mission. Their stable script IDs now carry step-scoped tactical chatter, weather, or boss phase changes. Boss phase escalation still operates, but this mission no longer adds bodies on top of the player during those phases. Warden is not the summoning Harbinger archetype.
- Convoy lore is step-scoped and no longer claims rooftop enemies, riverbed climbers, or an inside-depot boss. Trigger flags remain once-only during a run.
- Fallback win evaluation cannot bypass an unfinished linear objective chain. This shared fix and height-aware volumes affect other campaigns too, but those campaigns were not runtime-reviewed in this batch.

Checkpoint restoration reconstructs the future encounter state, not an exact combat save: it clears old NPCs, projectiles/deployables and stale captions; resets dense actor IDs for core projectile-owner indexing; predeploys only current/future groups; suppresses earlier-step scripts/lore; restores earlier weather actions and minimum supplies; and places the player at the checkpoint floor. Repeated restore followed by onStart does not duplicate groups. Non-checkpoint numeric requests normalize down to an authored checkpoint (or entrance 0), preventing restoration into a step with missing prerequisite groups. Global match time, lives and player inventory are not rewound as a full save-state system.

## Exact focused evidence

Command, from repository root:

```
node --test game/phase1-campaign.test.mjs
```

Final focused file contains 11 tests, covering:

1. No early fallback extraction; opening and bridge guards gate advancement.
2. Step-scoped, height-aware bridge trigger fires once.
3. Checkpoint position, future-only groups, dense actor IDs, no duplicate deployment, easy/nightmare exact health/armor/ammo recovery, no new weapons, restored weather.
4. Named anchors integrated in actual Match state; required groups present before the first tick; no onStart pop-in.
5. Different-elevation rally cannot complete.
6. Step-scoped lore, prior-script suppression and stale checkpoint hazard removal.
7. All 9 anchors plus 19 defenders (28 route targets) have supported, unobstructed nodes and continuously validated walking paths from entrance.
8. Disconnected anchors, wrong-floor anchors, unknown names and insufficient spawn slots reject explicitly.
9. Bounded objective-state playthrough from entrance and checkpoint 3 reaches step/checkpoint 5 and victory with required groups dead.
10. Actual `Match.step`: 120 frames from entrance and 120 from config checkpoint 3; finite actor positions, live height-bearing waypoint, no duplicate/in-view deployment, no premature win.
11. Invalid intermediate checkpoint requests normalize safely to entrance/3.

Final run: **11 passed, 0 failed, 0 skipped; exit code 0; duration_ms 5890.161689**. Red tests were observed for planar objective completion, missing anchor/predeployment integration, early extraction, unscoped bridge triggers, wrong checkpoint placement, unscoped lore, sparse restored actor IDs and invalid checkpoint normalization before their respective fixes.

Also run: `git diff --check -- game/campaign-data.mjs game/singleplayer.mjs game/story.mjs game/campaign-anchors.mjs game/phase1-campaign.test.mjs docs/phase1-campaign-handoff.md`.

## Limitations / remaining work

- Objective-state playthrough intentionally places the player at markers and directly clears required groups. It is a sequencing/softlock regression, NOT evidence of a human combat win. Walking-edge checks establish static routes; actual Match.step smoke is bounded to two seconds per start mode, not a full movement/combat campaign run.
- No browser/visual review, full campaign sweep, npm test, full suite, difficulty win-rate measurement, render/performance claim or deployment was performed.
- Difficulty recovery policy is tested at easy/nightmare endpoints; normal/hard fractions are authored but no combat-balance certification is claimed. Predeploying all defenders changes pressure distribution and needs human pacing review after map-family geometry review.
- Other four missions still need named-anchor/encounter authoring and checkpoint reconstruction migration. They retain legacy coordinate spawning and legacy restore behavior. Shared height-aware triggers and linear win gating are not proof those routes are valid.
- Existing campaign autoplay tests assume single-group clears, x/z-only teleports and dynamically spawned early low-health actors. Those assumptions do not fully express this revised predeployed, height-aware, multi-required-group mission. Existing tests were not edited or swept under this worker's ownership; focused replacements here explicitly exercise the new contract. The owning test-maintenance batch should reconcile those older harness assumptions before a future full suite.
- Future predeploy missions must author onStart anchored spawns and avoid unreviewed script/onComplete deployment. The helper is not a general hidden-spawn system or automatic map repair.
- Checkpoint reconstruction does not serialize exact enemy health, projectiles, player status effects, or a complete world snapshot. It is intended for supported mission checkpoint entry, not arbitrary mid-combat rollback.
