# Code Review Fix Plan

Reviewed baseline: `693d085`, 2026-09-12. Application code was not changed during
this review. Line references below describe that baseline; locate the named
functions rather than relying on line numbers after edits.

## Scope and Evidence

Three independent read-only reviews covered gameplay/simulation, server/client
networking, and UI/rendering. They identified 22 concrete defects. Some were
reproduced using deterministic in-memory probes; others were confirmed by control
flow or dependency-source inspection. The probes were not saved as test files.

The gameplay reviewer ran 122 focused tests. The networking reviewer ran 122
focused tests, including 11 real-WebSocket integration tests. The UI reviewer ran
the view, director, interiors, structures, camera, touch, input, HUD, and showcase
suites successfully. These counts overlap and are not an aggregate suite result.
The full test suite, typecheck, build, browser, and GPU checks were not run during
this review. Passing existing tests do not cover the defects below.

This is a broad review, not proof that every file or behavior is correct. Auth,
deployment, dependencies, progression/replay internals, all authored map routes,
real microphone/ICE/TURN behavior, and terrain-wide camera clearance did not receive
equally deep coverage. Do not claim those areas are fully audited.

## Execution Rules

1. Read repository instructions and inspect `git status --short` before editing.
2. Work in the batch order below. Complete one batch before starting another.
3. For each finding, reproduce it in a regression test, observe the failure, make
   the smallest correct fix, and rerun the relevant suite. Record actual results.
4. Reuse existing helpers (`teamMode`, vehicle collision/availability helpers).
   Do not replace established architecture, add dependencies, mass-format files,
   or do cosmetic cleanup unrelated to a finding.
5. Preserve user changes. Use `apply_patch` for manual edits. Keep modules ESM and
   preserve software-renderer fallback and SSR behavior.
6. Tests should exercise real behavior, not assert source strings or duplicate the
   implementation in test-only helpers. If a browser check is unavailable, record
   that limitation rather than calling it verified.
7. Do not commit, push, bump the release footer, restart services, or deploy without
   explicit authorization. A build creates output on the deployment host; it is
   not a deployment verification.
8. Update the checklist at the end as work completes. If interrupted, leave exact
   commands, failures, and the next finding ID so another agent can resume.

## Batch 1: Input and Presentation State

### UI-1 [P1] Idle touch state suppresses WASD

Locations: `app/page.tsx:105,131,143`; `game/input.mjs:37-39`.
The runtime always passes an initialized zero touch vector. `controlsFromState`
uses it instead of keyboard axes, including on desktop.

Fix: Pass no analog override when the joystick is inactive, or explicitly fall
back to keyboard input for an idle joystick. Preserve hybrid-device keyboard use.
Test disabled, idle, active, and released joystick states with WASD in both local
and network input paths. An active joystick must still produce analog movement.

### UI-2 [P1] Online resume keeps showcase rendering state

Locations: `app/page.tsx:135,146-147,220`, `resumeNet` and network view setup.
Entering the lobby can replace the view with a showcase while `netViewReady` stays
true. Resume skips restoring the online scene and camera.

Fix: Invalidate network view readiness and clear presentation-only state on resume;
restore network map, player ID, spectator mode, models, and camera before rendering.
Test online play -> lobby with showcase frames -> resume, including a spectator.

### UI-3 [P1] Stale local match overrides demo/showcase

Locations: `app/page.tsx:116,149-152,397,404`; `game/view.mjs:527`.
The final render prefers `r.match` even after switching to demo/menu modes.

Fix: Select render state explicitly by current mode rather than null-coalescing
unrelated sessions. Preserve paused local-match state without rendering it during
showcase or demo playback. Test local map A -> menu -> demo map B and verify actual
state passed to the renderer, models, and demo progress. Check local pause/resume.

### UI-4 [P2] Another actor's suicide displays local elimination banner

Location: `game/hud.mjs:99-105`, `killBanner`.
The `self` flag is checked before victim identity.

Fix: Only show the self-elimination banner when its victim is the local player.
Test another actor's suicide, local suicide, unrelated kills, and local kills.

## Batch 2: Movement and Powerups

### SIM-1 [P1] Airborne actors snap onto cover

Location: `game/core.mjs:110`, `moveActor`.
Horizontal collision processing assigns `ny=top` whenever `a.y >= top`, even with
zero horizontal velocity. An actor at y=10 above a height-2 block lands immediately.

Fix: Remove unconditional snapping and retain downward surface-crossing landing.
If seam support is necessary, constrain it to grounded actors near the surface.
Add tests in `game/gameplay.test.mjs` for hovering/falling above cover, jumping from
a block to a positive apex, normal descending landing, and walking across seams.

### SIM-2 [P2] Unrelated powerups refill depleted overshield

Locations: `game/core.mjs:293-294,333`, `refreshPowerups` and collection/expiry.
Recomputing multipliers reconstructs full temporary shield. Collect overshield,
take 50 damage (60 -> 10 shield), then collect haste: shield incorrectly returns 60.

Fix: Separate remaining shield from stat recomputation. Grant/refill only when
collecting overshield; clear on its expiry or respawn, not unrelated effect changes.
Extend `game/powerups.test.mjs`: haste/overcharge collection and expiration preserve
consumed shield; overshield collection refreshes it and expiry/respawn clear it.

## Batch 3: Vehicle Rules

### VEH-1 [P1] Seat synchronization overwrites gunner aim

Locations: `game/core.mjs:215,226`, `syncVehicleActor`, `gunnerVehicle`.
Gunner input is calculated, then non-driver yaw is reset to chassis/seat yaw before
`fireVehicle` uses it. Perpendicular aim fires in the wrong direction.

Fix: Preserve independent gunner aim through synchronization and firing while
retaining intended driver/passenger orientation. Extend `vehicle-seats.test.mjs`
with a heading-zero Puma, perpendicular target, unchanged gunner yaw, expected shot
direction and damage, across multiple ticks and seat changes.

### VEH-2 [P1] Projectiles pass through vehicle bodies

Location: `game/core.mjs:364-365`, projectile sweeping.
World and actor hits are swept, but vehicles are absent. A rocket traverses an empty
Puma without impact or health loss.

Fix: Include eligible vehicle intersections in nearest-hit ordering using existing
`hitVehicle`/`damageVehicle` helpers. Preserve friendly/own-vehicle policy and avoid
accidental duplicate direct/splash damage beyond intended weapon semantics.
Extend `weapon-simulation.test.mjs` with empty/occupied vehicle impacts, nearer
world/actor hits, farther world/actor hits, and own/friendly vehicle behavior.

### VEH-3 [P2] Gunner presence doubles weapon timer progression

Locations: `game/core.mjs:225-226,331,338`; `game/vehicles.mjs:562-571`.
Chassis stepping and gunner stepping both advance cooldown/heat. At 60 Hz, a .12
cooldown becomes .0866667 instead of .1033333 after one tick.

Fix: Give weapon timer progression exactly one owner per simulation tick. Preserve
existing public step helpers where their direct callers need timer progression.
Test driver-only, driver-plus-gunner, and gunner-only cases for equal elapsed-time
cooldown, cooling, overheat duration and sustained shot cadence. Check actor-order
independence so swapping driver/gunner iteration order does not change results.

### VEH-4 [P2] Actors and bots can enter wrecks

Locations: `game/core.mjs:217,295,300`; `game/vehicles.mjs:189-191,215-220`.
Seat availability bypasses health/respawn checks already present in stricter entry
logic. A health-0 vehicle with respawnTimer=1 accepts an actor.

Fix: Reuse a shared availability check for actual entry and bot candidate selection;
reject nonpositive health and active respawn countdowns. Extend vehicle gameplay
tests to reject wrecks, prevent bot selection, and allow entry after respawn.

## Batch 4: Client Prediction and Socket Ownership

### NET-1 [P1] Replay clock drift eventually disables prediction

Locations: `game/net.mjs:190-197,245-248,270-271`; `game/core.mjs:328,366`.
Snapshot rebase restores the actor, not the shadow match clock/terminal state.
Pending inputs repeatedly add elapsed time. With six pending inputs, a 60-second
shadow match was over at 20 seconds of authoritative time; later look was ignored.

Fix: Restore authoritative prediction-relevant match time and terminal state before
replay. Inspect other match-level replay mutations; do not simply clear `over` and
leave an inflated clock. Test long delayed-ack exchanges at 60-Hz input/30-Hz
snapshots; shadow time should be authoritative time plus pending input duration,
and prediction must remain responsive while the authoritative match is active.
Also verify true authoritative completion still behaves correctly.

### NET-2 [P2] Reconnect leaks sockets and accepts stale callbacks

Locations: `game/net.mjs:38-41,74-88`, `connect`, `reset`; `app/page.tsx:219`.
Replacing a connection discards the old socket without closing it. Old callbacks
can overwrite identity or mark the current socket disconnected.

Fix: Dispose superseded sockets and gate open/close/error/message callbacks on
socket identity or generation. Settle superseded pending connect promises rather
than leaving them hanging. With controllable socket doubles, deliver every stale
event after replacement; assert current identity/connectivity unchanged, previous
socket closed, no duplicate ownership, and pending promises settled safely.

## Batch 5: Transport and Persistence Safety

### SRV-1 [P1] Persistence failures escape tick and abort results delivery

Locations: `server/history.mjs:79-85`; `server/progression.mjs:53-58`;
`server/room.mjs:332-349`; `server/game-server.mjs:138`.
Synchronous write/rename errors escape the timer. `roundOver` is already set and
the results message has not been queued. One storage failure can stop all rooms.

Fix: Isolate each persistence failure from round completion; log/report it clearly,
continue independent stores and deliver results exactly once. Retain dirty data for
a bounded retry policy (no tight loops or unbounded queues), retry persistence
without awarding progression twice, and clean temporary files after failed writes.
Inject write and rename failures for each store using temp locations/stubs, never
the live data directory. Verify results once, other-room ticks, visible error,
successful later persistence and no duplicate rewards.

### SRV-2 [P1] Invalid-message errors bypass outbound buffer limits

Location: `server/game-server.mjs:124-127`.
Invalid JSON and dispatch exceptions use raw `ws.send`. A client at the traffic
buffer limit still receives queued errors for repeated invalid messages.

Fix: Route errors through a common ready-state/backpressure-checked sender. Bound
protocol-abuse responses and disconnect repeat offenders rather than adding an
unbounded error queue. Test invalid JSON and dispatch errors at/above the cap,
closed sockets and repeated violations; healthy clients must remain unaffected.

### SRV-3 [P2] Backpressure silently loses lifecycle messages

Locations: `server/game-server.mjs:93-115`; `server/room.mjs:47,349`.
Flush drains messages before checking capacity, losing welcome/start/results
permanently and leaving the client apparently connected in the wrong state.

Fix: Classify replaceable traffic versus lifecycle transitions. Prefer the smallest
safe policy: explicitly disconnect a congested client when an essential message
cannot be sent, if the reconnect path restores the required state. Otherwise use a
bounded ordered lifecycle queue. Do not add an unbounded queue or silently drop
transitions. Test congestion at join/start/results and verify ordered recovery or
explicit disconnect plus successful state-restoring reconnect. Prove completed
results can be recovered before relying on disconnect as the solution.

## Batch 6: Team Results and History

### RULE-1 [P2] Server team awards and history omit newer modes

Locations: `server/room.mjs:339-345`; `server/history.mjs:37,70-73`.
Awards omit Assault/Payload; history omits those plus Combined Arms. Losing players
can receive frag-based wins, and team result data is discarded.

Fix: Use `teamMode()` from `game/config.mjs` instead of independent lists. For team
modes use authoritative winner versus actor team, with no win for a null winner.
Parameterize tests over every declared team mode; cover winner with fewer frags,
loser with most frags, ties, attacker victory and defender timeout. Persist winner
and team scores; preserve FFA awards. Test history normalization/readback as well
as record creation, because persisted data must survive reloading.

### RULE-2 [P2] Local Assault/Payload awards use individual frags

Location: `app/page.tsx:143`, local end-of-match award branch.
Fix the same duplicated mode list with `teamMode()` and authoritative winner.
Test winner with fewer frags, losing frag leader, and tied/no-winner results. Ensure
tests cover the actual local award path, not only the already-correct shared helper.

### RULE-3 [P2] Timed team results are recorded as score-limit endings

Locations: `server/room.mjs:335-337`; `server/history.mjs:50-53`.
A non-null winner is treated as proof of a score-limit finish. A 60-second TDM
match at 1-0 with limit 30 records `frag` rather than `time`.

Fix: Use authoritative termination reason or actual score/objective completion;
winner existence is insufficient. Preserve valid existing history formats and
document precedence if timer and score complete on the same tick. Test unequal and
tied timeouts below goal and genuine score completion for CTF/TDM/KOTH/Domination;
also check Assault/Payload special completion and timeout semantics.

## Batch 7: Geometry, Rendering Resources and Accessibility

### RENDER-1 [P1] Visible cavern entrances differ from collision entrances

Locations: `game/structures.mjs:11-19`; `game/view.mjs:390`;
`game/levelgen.mjs:200-203`.
Collision uses (cos(a), sin(a)) in X/Z; Three CylinderGeometry uses
(sin(theta), cos(theta)). Passing the same scalar angles does not align openings.
A ray at intended entrance angle pi/16 hits rendered stone.

Fix: Convert start angle and arc direction correctly or generate both with the same
coordinate convention. Extend structures tests with real Three geometry/raycasting
through all intended openings and representative wall directions. Test a range of
shell sizes. Do not merely compare scalar angles or rotate by an unproven constant.

### RENDER-2 [P2] Post-processing toggle and disposal leak GPU resources

Locations: `game/view.mjs:261,539`, `_syncPost`, `dispose`.
Disabling post-processing drops the composer reference without disposal. Composer
disposal alone does not dispose its added bloom/vignette/output passes.

Fix: One cleanup path disposes owned added passes and composer exactly once, used
on disable/replacement/final disposal. Test repeated scale 1 -> .9 -> 1 toggles and
final cleanup with instrumented allocations/disposals. Preserve fallback behavior.

### RENDER-3 [P2] Composer applies DPR twice

Location: `game/view.mjs:261`, `_syncPost`.
Composer inherits renderer DPR, then receives dimensions already multiplied by DPR.
At DPR 1.5, 800x450 CSS pixels produce targets near 1800x1013 rather than 1200x675.

Fix: Set current composer pixel ratio and pass CSS dimensions, or consistently use
ratio 1 with physical dimensions. Handle live ratio changes. Test actual target
sizes at DPR 1/1.5, resolution scales and a changed DPR. Use a test harness that
enters the composer branch; current fallback-only stubs cannot catch this bug.

### RENDER-4 [P2] App Reduce Motion preference does not control effects

Locations: `app/page.tsx:187,190`; `game/view.mjs:245,527-528`.
The renderer only checks OS preference. The app toggle also fails to reconcile an
already-running showcase.

Fix: Apply app preference OR OS preference consistently to motion/flash effects;
immediately reconcile showcase/director eligibility when preference changes. Test
all app/OS combinations and live toggle during gameplay/showcase. Verify camera
shake and animated effects change without reload and OS preference is respected.

## Final Verification

Run focused tests after each batch. At the end run the repository's aggregate gate:

```bash
npm test
```

It runs game tests, server tests, typecheck, build, then SSR tests in order. If an
earlier gate fails, later gates have not run. Fix/re-run and report that accurately.
If diagnosing separately, these are the equivalent individual commands:

```bash
npm run test:game
npm run test:server
npm run typecheck
npm run build
node --test tests/*.test.mjs
```

Inspect `git diff --check`, `git diff --stat`, and the complete intended diff.
Do not mask build failures with output-truncation pipelines. Do not claim old test
counts as current results. If a test is flaky, record its initial failure and
isolated rerun; an isolated pass alone is not a clean aggregate gate.

Browser/GPU acceptance when available: desktop WASD; touch/hybrid input; online
lobby/resume including spectator; local/menu/demo on different maps; cavern doorway
visibility and traversal; gunner aim; repeated post-processing scale toggles; live
Reduce Motion. Report unavailable checks explicitly. No visual correctness claim
based solely on a successful build.

## Completion Checklist

- [x] Batch 1: UI-1, UI-2, UI-3, UI-4
- [x] Batch 2: SIM-1, SIM-2
- [x] Batch 3: VEH-1, VEH-2, VEH-3, VEH-4
- [x] Batch 4: NET-1, NET-2
- [x] Batch 5: SRV-1, SRV-2, SRV-3
- [x] Batch 6: RULE-1, RULE-2, RULE-3
- [x] Batch 7: RENDER-1, RENDER-2, RENDER-3, RENDER-4
- [x] Aggregate checks and final diff review
- [x] Browser checks completed or explicitly recorded as unavailable

Final handoff must list fixed IDs, changed files, new regression tests, exact
verification outcomes, deferred IDs with reasons, and remaining risks. Do not use
"all fixed" unless every finding has been addressed and its acceptance criteria
verified or a concrete disproof documented.

## Implementation Record (completed)

All 22 findings implemented in the working tree; nothing committed or deployed.
Every new regression test was confirmed to fail against the pre-fix modules before
the fix was applied (using `git stash` of the relevant files).

Added modules: `game/presentation.mjs`, `game/outcome.mjs`, `game/post.mjs`.
New test files: `game/presentation.test.mjs`, `game/outcome.test.mjs`,
`game/post.test.mjs`, `server/resilience.test.mjs`, `server/transport.test.mjs`.

Batches 1-7: UI-1..4, SIM-1..2, VEH-1..4, NET-1..2, SRV-1..3, RULE-1..3,
RENDER-1..4.

Focused pre-fix failure counts: UI 3, SIM 3, VEH 4, NET 4, SRV 6, RULE 4,
RENDER 2 (module-level for the new helpers).

Aggregate verification (run after all changes):
- `npm test` exit 0
- game: 588/588, fail 0, cancelled 0
- server: 107/107, fail 0, cancelled 0
- SSR `tests/*.test.mjs`: 1/1
- `npm run typecheck` clean, `npm run build` completes
- `git diff --check` clean

Pre-existing environment notes:
- `game/expansion.test.mjs` "classic maps" is very slow (minutes) and can exceed
  naive per-file timeouts; it passes with adequate time and is not a regression.
- `server/network.test.mjs` "two rooms play simultaneously and the browser lists
  both" is flaky under a full parallel run; it passed in isolation and on rerun.

Browser/GPU acceptance checks were not available in this environment (no WebGL,
no browser). Visual claims (cavern openings, composer sizing, camera/tunnels)
are geometry/unit-verified only and still need a real browser before release.

## Follow-up fix: teamless spawns on team-only maps

Reported as "WASD no longer works" and "only 1 spawn point on the map with the
columns". Root cause: maps that only author `teamSpawns` (riverbend, convoy-line,
titan-valley, frost-gate, fortress, atrium) have an empty `arena.spawns`. A
teamless mode (deathmatch/instagib/rockets/arsenal) therefore spawned every actor
at the single origin, and on riverbend/convoy-line that origin is inside geometry,
so the actor could not move.

Fix (`game/core.mjs`): when `arena.spawns` is empty, derive the FFA spawn list from
the navigation graph (points bots can actually reach); fall back to the team spawn
union if there is no nav. Regression test in `game/gameplay.test.mjs`
("team-only maps still give teamless modes valid, multiple spawns").

Verification: aggregate `npm test` exit 0 — game 589/589, server 107/107, SSR 1/1.
