# COCS verification report

## Release 2.69 - Whole-codebase audit: security, correctness, architecture

Baseline `685b99f`; findings consolidated in `IMPROVEMENT_PLAN.md` from seven
read-only audits. Shipped across commits `590f0a1`, `a7441d9`, `20e21db`,
`2130048`, `7c1769d`, `51c6c37`.

Security and lifecycle:
- Progression is now bound to a server-issued secret token instead of a
  client-chosen `playerId`; a wrong token gets a fresh identity and can never read
  or write another profile. Connected profiles are pinned against LRU eviction.
- Essential server messages coalesce by type instead of FIFO-evicting
  `welcome`/`start`/`results`; control frames are rate-limited, clients are capped,
  and dropped event batches rewind `lastSerial` so the delta is resent.
- Deploy now backs up `dist/`, health-gates both systemd units, verifies assets and
  rolls back on failure; nginx/Next add CSP and security headers; the app has
  route-level and global error boundaries.

Correctness and performance:
- Fixed the Arms Race finisher award, bot melee, on-foot interact movement,
  self-kill stats, void kill-feed timestamps, weapon-finish rendering and online
  finish/gear plumbing, local race coins, next-arena mode safety, renderer-init
  recovery, connect-before-open hangs and malformed-snapshot crashes.
- Payload objective credit now uses the cart stand check; leaders rank objective
  modes correctly and share one implementation; navigation construction is
  faster and bots use the filtered nav graph; supply placement no longer stacks;
  demos are event-capped and compressed; radar labels/progress and underbarrel
  meshes render.

Architecture and cleanup:
- Extracted shared `game/math.mjs`, `game/protocol.mjs`, canonical team palettes,
  and a single ranking API; cached core traversal tables and coalesced server
  event clones and snapshot quantization.
- Removed 57 unreachable shadcn components, dead scaffolding (`chatgpt-auth`,
  drizzle/db/examples/vendor), unused dependencies, dead map/generator fields and
  the unused lag-compensation path.
- Lint is now a real gate (0 errors; remaining client-interop findings are
  warnings) and `.github/workflows/ci.yml` runs typecheck, tests, build and lint.

Verification: game **916/916**, server **123/123**, SSR `tests/*.test.mjs`
**4/4**, `tsc --noEmit` clean, `npm run lint` exit 0, production build succeeds,
and the live deploy verified v2.69 (HTML + 9 assets 200; web and game services
active; game-server HTTP 200).

Known gaps not addressed in this pass: the `core.mjs`/`view.mjs`/`page.tsx`
monolith split, full map-builder schema consolidation, client code-splitting/CSS
decomposition, replacing the TSX-source-parsing tests with importable units, and
moving match-end persistence off the simulation tick. No browser/WebGL playtest
was possible, so visual and balance claims remain unit/geometry-verified only.

## Documentation drift and headless tests - 2026-09-13 (unreleased)

- README drift corrected: `game/data.mjs` documents **five** powerups (haste,
  overcharge, overshield, recon, cloak) instead of three; the pickup list names all
  ten weapons; the false "there are no touch gameplay controls" line is replaced
  with the actual coarse-pointer behavior; and a release-status banner near the top
  points at this file and the `app/page.tsx` footer version (v2.68). Historical
  version notes are untouched.
- `DEVPLAN.md` and `SPEC.md` now carry a prominent historical-baseline banner
  pointing here; their v1.4-era five-weapon/three-arena history is preserved.
- New headless tests: `game/environment.test.mjs` checks that the sky dome,
  instanced mountains and instanced terrain scatter build finite, environment-tagged
  scene graphs, skip missing/unsupported terrain, and do not throw with
  reduced-motion options; `game/battle-maps.test.mjs` checks the four battle maps'
  unique ids, in-bounds geometry, clear spawns/objectives/supplies and vehicle
  clearance where vehicles are declared. **13/13 pass**.
- `server/network.test.mjs` flake fix: room-list assertions now poll for room
  expiry/creation to settle (`waitForRooms`) instead of sleeping a fixed 1600 ms,
  and the two-room simultaneous-match result wait is 90 s. `node --test
  server/network.test.mjs` **12/12**.
- Limits: no browser/WebGL/GPU verification was performed; these are headless
  smoke and metadata checks only.

## Release 2.65 - Payload pig, objective clarity, bot variety

- Fixed local objective rendering: view now reads `objectives ?? objectiveState`, so
  KOTH/domination/assault markers and the payload render in offline play, not only
  over the network. The payload is rebuilt as a ~2.5m floating pig with bob, wing
  flap and beacon (all reduced-motion gated), a ground ring, and a distinct radar
  contact. Active assault sectors are highlighted and labelled; zones carry A/B/C.
- Slowed payload pacing from `total/30` (rounds ended in 14-68s) to a bounded
  `total/150` clamped `[1.5,4.0]`, giving ~67-123s full routes on the tested maps,
  and payload push time now accumulates `objectiveTime` so CART TIME is live.
- Assault now builds exactly `config.fragLimit` (1-9) sectors, credits
  capture/objective-time stats, and the HUD/scoreboard show the objective.
- Arms Race ranks by ladder (not frags) in `leaders()`, sudden-death/tie-break,
  `actorWon`, and history `leaderRank`, so a lower-ladder player cannot win on the
  clock. CTF flags dropped unsupported over the void now fall back to the carrier's
  last solid position or base instead of soft-locking the objective.
- Objective clarity: `commandBrief` keys on objective kind, adds Combined Arms
  (zone control) and Arms Race (ladder) branches, and instagib/rockets/arsenal name
  their frag target; `matchStartBanner` includes the goal; assault/combined-arms/
  arms-race scoreboards gained objective columns and team banners; setup copy added
  for frags/teamFrags/sectors/ladder and the weapon-locked modes.
- Bot variety: deterministic archetypes (rusher, flanker, defender, support,
  sharpshooter) resolved from operator role + harness personality + slot jitter,
  wired into engagement band (with hysteresis), strafe patterns, weapon-band
  preference, replan tempo, objective focus and retreat; difficulty still owns
  accuracy/reaction/tempo. Added `game/bot-archetypes.test.mjs`.
- Verification: full game suite **848/848**, server **118/118**, focused
  wave-one suite **204/204**, bot suite **80/80** plus a 96-test smoke, and
  `tsc --noEmit` clean. No browser/WebGL playtest of the pig or live balance.

## Release 2.64 - Kart items, coins and boost pads

- Expanded the item set from four to eight: Turbo, Shield, Oil Slick, Homing
  Pulse, Mine (stationary harder-slow trap), Triple Pulse (next three ahead),
  Lightning (all ahead), and Star (speed + immunity to every slow). Position
  weighting was retuned so the leader draws mostly defensive items and the
  trailer draws catch-up items (catch-up mass ~0.26 leader vs ~0.78 trailer).
- Added coins: each gives +1.2% top speed up to +12% at ten, and a slow hit
  drops two. Added always-on boost pads that grant a free short turbo on contact
  with a per-racer cooldown. Item boxes increased from six to ten.
- Track now authors 10 boost pads, 24 coins and 10 item boxes, all floor 0,
  clear for a 2.1-radius car, away from rails, and inside the racing line; boost
  pads are >=6 units apart. Snapshot exposes `race.coins`, per-racer `coins`, and
  `effects.star`, and hazards carry `type` (oil or mine).
- Rendering: flat glowing chevron boost pads oriented along the centerline,
  spinning gold coins that hide/dispose when collected and freeze under reduced
  motion, and a distinct spiked mine model vs the oil slick.
- HUD: race metrics gained a COINS readout, and item/effect text uses friendly
  labels for all eight items, including active Star time.
- Verification: focused race/map/render/UI/network suite **147/147**; full game
  suite **820/820**; server **118/118**; `tsc --noEmit` clean. No browser/WebGL
  playtest of the new visuals or a live driving balance pass.

## Release 2.63 - Race balance, collisions, track render, demo camera

- Balanced the race so the early leader is catchable: a clamped rubber-band pace
  (0.93 leader .. 1.10 trailer) applies to bots and humans, and each racer has a
  seeded skill factor (0.95-1.05) and racing-line offset so bots do not drive one
  identical line. Six fixed seeds produced multiple winners; the pole racer won
  0/6 in the fixture, versus a deterministic runaway before.
- Cars are solid. A guarded pairwise contact resolver pushes overlapping Pumas
  apart to a 3.4-unit separation along the contact normal and equalizes their
  normal velocity without pushing either into world geometry. After a 10 s race
  no pair overlaps (max residual 0.02 units), all positions stay finite, and the
  eight grid slots start 6.0 units apart. No grid nudge was needed.
- Mystery-box item rolls are position-weighted: the leader draws mostly shield/oil
  and the trailer mostly turbo/pulse (8k seeded draws: trailer catch-up items
  74.5% vs leader 24.8%), replacing the uniform roll.
- Fixed the flat-wall artifacts: the track no longer renders ~470 overlapping
  2x2x2.6 collision boxes. Rails are hidden collision boxes and the walls/stripes
  are drawn as continuous merged barrier geometry from `race.boundary` (outer and
  inner polygons, 12 points each). Collision boxes still seal the perimeter for a
  2.1-radius car with no car-sized gaps.
- The main-menu demo camera now alternates every 7 s through chase, orbit, flyover
  and trackside, rotating the featured car each segment, with damped transitions
  and a reduced-motion chase fallback. Non-cinematic local races keep the chase.
- Verification: focused race/camera/render/network/map suite **133/133**; full
  game suite fixed three fixture regressions caused by the race-only circuit
  (generic combat tests now skip maps with `arena.race`; the next-gen per-mode
  count excludes the dedicated `puma-race` circuit) and then passed **806/806**;
  server **118/118**; `tsc --noEmit` clean. No browser/WebGL playtest of wall
  geometry or the demo camera; collisions are sim-verified, not device-verified.

## Release 2.62 - Puma Circuit menu and deployment

- Main-menu showcase now runs only Puma Circuit: eight AI drivers, two laps,
  four seconds of fixed-tick warmup, and automatic restart after the finish.
  Cinematic title rendering uses the vehicle chase camera; menu diagnostics are
  exposed under `window.tokenArenaSnapshot().showcase`.
- Preserved disabled-showcase, reduced-motion and software-renderer fallbacks.
  Showcase/race-UI/view regression run passed **41/41**, including repeated
  completed races and title rendering without a local gameplay match.
- Release review caught and fixed an online race chat trap: T/Enter previously
  opened chat state while the race HUD omitted its input. Race and combat now
  share one visible chat panel. Updated race UI tests passed **12/12**.
- Reproduced the live CSS failure: the running web process referenced the deleted
  `/assets/index-Mzs69FxE.css`, which returned HTTP 502; service logs showed
  ENOENT for that stylesheet and old JavaScript chunks. The cause was rebuilding
  `dist` without reloading the running asset manifest, not invalid CSS syntax.
- Added `npm run deploy` to pair build/restart with public linked-asset checks,
  optionally restarting the game server. Deployment verifier tests **3/3** catch
  missing CSS, stale release HTML and HTML fallback responses for asset requests.
  Rendered-HTML tests now also check local build asset existence.
- This release includes the preceding map, gameplay/control and racing changes
  described below. Their unreleased labels record their original verification
  state before this combined release.

## Puma Circuit racing - 2026-09-13 (unreleased)

- Added `puma-race` and exclusive `puma-circuit` map: a closed flat circuit with
  continuous solid boundaries, distinct infield/apron, eight Puma grid slots,
  twelve checkpoint gates and six respawning mystery boxes. Vehicle-sized sweeps
  validate lane/corner clearance and authored navigation connects the full loop.
- Race-only simulation auto-mounts drivers, caps humans plus bots at eight, runs
  a three-second countdown and bypasses combat. All racers share chassis tuning.
  Ordered swept crossings include direction, gate width and height validation;
  reset teleports cannot score. Finish order resolves sub-tick crossing times.
- Turbo, Shield, Oil Slick and Homing Pulse use one held slot and rising-edge
  activation. Normal chassis boost and handbrake work offline and online.
  Checkpoint recovery preserves progress and imposes a two-second wait.
- Bots drive actual laps on the registered circuit without recovery resets in
  the deterministic completion test. The UI defaults to seven rivals on mode
  entry and exposes 0-7 rivals, without advertising unused combat difficulty.
- Race HUD, mobile actions, chase camera, numbered gate frames, checkered start,
  grid markings, item boxes and oil hazards are integrated. History names and
  winner awards handle actor IDs, including zero, rather than team/frag scores.
- Race clients do not construct an invalid single-racer prediction shadow.
  Server-authoritative snapshots interpolate all cars and preserve countdown,
  items, standings and slot-seven reconnect state. Held handbrake stays held;
  held item activation cannot consume a newly acquired item without release.
- Initial integrated race/config/network/history check: **102/102 passed**.
  Updated race UI/configuration/geometry tests: **10/10 passed**. Registry,
  presentation, touch, replay and progression check: **57/57 passed**, including
  all **35 maps / 256 supported map-mode combinations**. Full server suite:
  **118/118 passed**. Typecheck, final production build and rendered HTML
  (**1/1**) passed. The existing large-client-chunk build warning remains.
- Race setup avoids infantry navigation construction; independent public track
  navigation uses authored nodes instead of scanning the full arena. Isolated
  diagnostics reduced that validation from about 31 seconds to under a second.
- Limits: cars deliberately ghost rather than ram; the round ends at the first
  finisher and remaining racers are DNF. Multiplayer steering is interpolated,
  not locally predicted. No browser/device driving or high-latency playtest yet.
  Earlier uncommitted map/control repairs remain intact; no commit or deployment.

## Gameplay and controls improvements - 2026-09-13 (unreleased)

- Piercing rounds now continue beyond the first victim, with remaining weapon
  range and world occlusion enforced. Tests cover aligned victims, walls and
  targets beyond range.
- CTF pickup, return and capture require vertical proximity. Flag height follows
  the carrier and survives drops, events and snapshots. Drops select support
  below their actual position rather than teleporting onto nearby wall roofs;
  elevated bases and blocktop drops remain usable.
- Offline number-key, wheel and touch weapon selection now queues the same
  simulation input as multiplayer, preserving reload cancellation and equip
  delay. Rapid cycling starts from the pending selection.
- Mouse and touch fire/ADS holds are independent; touch fire taps latch until
  the next simulation tick. Pause/blur clears both sources and push-to-talk.
- Added the missing rendered GRENADE touch button, with an actual TSX-rendering
  test covering every declared touch action. Explicitly disabling touch controls
  persists on touch devices, and touch look respects ADS sensitivity.
- Occupied-key remapping swaps the two actions atomically and explains that
  behavior in settings, instead of silently normalizing away the user's choice.
- Spectator target buttons accept pointer input and have 44px minimum heights.
  An on-screen Return to Lobby button remains available with the HUD hidden.
  Spectator shortcuts precede voice handling, ignore repeat, and hidden HUD state
  no longer leaks into ordinary play.
- Final affected gameplay/input/rendering suites: **148/148 passed**. Full server
  suite: **110/110 passed**. Rendered HTML: **1/1 passed**. Typecheck and production
  build passed. The full game
  suite was not repeated after the preceding map pass; verification here targets
  the changed systems. Existing large-client-chunk build warning remains.
- No browser/device interaction playtest, commit or production restart performed.
  Pause-dialog focus management and remaining hardcoded remapped-key HUD prompts
  were identified by the audit but are outside this batch.

## Map layout repairs - 2026-09-13 (unreleased)

- Generated layouts now include short doorway and tunnel navigation chains and
  a 4m scaffold. Required placements must have actual bidirectional walking
  connections to retained navigation, not merely a nearby node across a wall.
- Frost Gate, Titan Valley and Convoy Line base doors face inward. Frost Gate's
  central approach is protected from solid props; Riverbend and Catacombs tunnel
  approaches are realigned. Forge workshop spawns connect through their doors.
- Final generated placement repair uses triangulated runtime terrain, includes
  decks, walls and late-added cover, repairs flags, and rejects exhausted repairs.
  Slagworks' ground objective is outside its deck-enclosed pocket.
- Automatic team supplies and cover have mirrored partners. Exchange, Foundry
  and Crosswire have explicit mirrored team spawn pools; Crosswire KOTH uses the
  north objective rather than favoring the west team through array-order ties.
- Launchpad launchers clear the reactor and land opposite their source, with
  authored bot links and sampled physical flight tests at 60/120/240 Hz.
  Launchpad, Citadel, Ironfall, Skybreak and Aether pickups/landing positions were
  cleared of navigation margins and solids. Skybreak/Aether authored spawn pools
  no longer depend on runtime emergency relocation to escape walls.
- Runtime payload routes follow clearance-validated walking edges and ground
  height, including Blood Gulch's hill and Convoy Line's obstacles. Checkpoints
  remain independent of path bends. Ironfall Megastructure and Longreach Plateau
  no longer advertise Payload because their crossings require launchers over void.
- Verified routes are cached for immutable runtime navigation identities, with
  independent per-match mutable state. Warm Riverbend/Convoy Match setup measured
  roughly 7-21ms instead of 1-1.7s; first-use route validation is still synchronous.
- `game/map-layout.test.mjs`: 34 maps, 255 supported map/mode combinations,
  10,258 placement inspections deduplicated to 976 distinct positions. Checks
  original spawn pools and final actors, objectives, flags and pickups against
  support, clearance, exact walking connectors and outward/return graph reach.
- `game/payload-layout.test.mjs`: all 19 advertised payload maps pass continuous
  ground/clearance and grounded-escort delivery checks; obstacle, curved-ground,
  disconnected-route and cache-isolation fixtures are included.
- Final gates: full game **734/734**, server **110/110**, rendered HTML **1/1**;
  `npm run typecheck`, production build and whitespace checks passed. Build still
  reports a large-client-chunk warning. No service restart or deployment performed.
- Limits: no browser/WebGL playthrough, statistical side-swapped win-rate study,
  or exhaustive vehicle swept-volume audit. Resource/spawn symmetry and connected
  objectives address structural advantages, not proof of complete combat balance.

## Bug-fix pass 2.61 - 2026-09-12

Three parallel read-only audits of the new features, input/UI wiring and core
lifecycle produced these fixes, each with a regression test verified failing
against the pre-fix source:

- Arms Race: ladder/weapon/ammo persist across respawn; weapon pickups do not
  bypass the lock; bounty frags (and any non-frag score mode) cannot end the
  match before the ladder finishes.
- Scoring: simultaneous objective score-limit ties are no longer awarded to
  team 0; assault breaches no longer inflate `teamScores` to the target.
- Actor lifecycle: death and falling clear `zipRide`/`traversalFlight` and reset
  the streak; spawn clears stale traversal cooldown/pad/event and `burstLeft`.
- Mutators: random loadout respects unlimited ammo.
- Keybinds: normalization is duplicate-free, reserved shell keys are rejected,
  the options list is shared with validation, `voice` is remappable, and the
  pause/settings legend derives from the active binds.
- Misc: grenade is a latched one-shot server edge; `radarContacts` preserves the
  requested range on invalid frames; `ladderStatus` distinguishes the final
  rung; preset buttons have accessible names.
- Suites: full game **665/665**, server **110/110**, SSR 1/1, build/`tsc` clean.

## Remappable keybinds 2.60 - 2026-09-12

- Pure `keybinds.mjs` (`normalizeBindings`, `actionForCode`,
  `bindingConflicts`, `DEFAULT_BINDINGS`) with validation, duplicate fallback
  and an 8-entry-safe default set. `controlsFromState`/`posture` accept a
  binding map; the page loads/saves bindings and edits them from a Controls
  panel. Tests cover normalization, duplicates, resolution and remapped
  movement/jump. Full game 654/654, server 109/109, SSR 1/1, build/`tsc` clean.

## Spectator controls 2.59 - 2026-09-12

- `spectatorBoard` pure helper plus a target board, **P** first/third person
  (`setSpectatorThird` offsets the camera behind the target) and **H** hides
  the HUD. Unit test for the board. Full game 650/650, server 109/109, SSR
  1/1, build/`tsc` clean.

## Loadout presets 2.58 - 2026-09-12

- Pure `presets.mjs` (`normalizePreset(s)`, `addPreset`, `removePreset`,
  `findPreset`) with validation against the roster, same-name replacement and
  an 8-entry cap. A `PresetsConfiguration` panel in match setup saves/loads/
  deletes, persisted to `token-arena-presets`. Unit tests cover validation,
  replacement, capping and removal. Full game 649/649, server 109/109, SSR
  1/1, build/`tsc` clean.

## Cloak powerup 2.57 - 2026-09-12

- New `cloak` powerup and `cloak` effect key; bot target selection skips
  cloaked enemies beyond 4m and radar hides them beyond 8m unless Recon is
  active. Procedural maps include a cloak pickup. Tests: radar hide/reveal,
  timed expiry, and bot non-acquisition. Full game 646/646, server 109/109,
  SSR 1/1, build/`tsc` clean.

## Bounty and Berserk mutators 2.56 - 2026-09-12

- `bounty` heals + bonuses ending a 3+ streak; `berserk` adds +20% damage at
  a 3+ streak. Config defaults and sim behaviour covered in `mutators.test.mjs`.
  Full game 643/643, server 109/109, SSR 1/1, build/`tsc` clean.

## Ladder and streak HUD chips 2.55 - 2026-09-12

- `ladderStatus` and `streakStatus` in `hud.mjs` drive Arms Race and killstreak
  chips; unit-tested. Full game 641/641, server 109/109, SSR 1/1, build and
  `tsc` clean.

## First-run coach 2.54 - 2026-09-12

- New pure `onboarding.mjs` (`ONBOARDING_STEPS`, `clampOnboardingStep`,
  `shouldShowOnboarding`) and a dismissible selection-screen overlay persisted
  to `token-arena-onboarded`. Unit tests cover step completeness and the
  show-once/clamp logic. Full game 640/640, server 109/109, SSR 1/1, build and
  `tsc` clean.

## Arms Race mode 2.53 - 2026-09-12

- New `armsrace` mode and `proving-grounds` map (`config.mjs`,
  `nextgen-maps.mjs`, `arenas.mjs`): `ladder` per actor, promoted on each kill,
  weapon forced to the ladder rung, win on a kill with the final weapon.
  Tests cover promotion, ammo on promote, the final-rung win, ignored manual
  switches, and bots keeping their rung. Full game 638/638, server 109/109,
  SSR 1/1, `tsc` clean.

## Recon Pulse 2.52 - 2026-09-12

- New `recon` powerup (`data.mjs`) with a `reveal` effect key; `radarContacts`
  clamps out-of-range enemies to the rim while active and flags them
  `revealed`; procedural maps include a recon pickup and the blip gets a rim
  stroke. Tests: radar reveal/clamp, timed expiry, content effect-key
  validation. Full game 635/635, server 109/109, SSR 1/1, `tsc` clean.

## Killstreaks, mutators and accessibility 2.51 - 2026-09-12

- **Killstreaks** (`core.mjs`): `applyKillstreak` rewards 3 kills (heal + ammo),
  5 (Overcharge) and 7 (Overshield) and emits a `killstreak` event; streaks reset
  on death and spawn. New test `killstreak rewards land at 3, 5 and 7 kills and
  reset on death`; `killstreakCallout` shows the reward.
- **Mutators** (`config.mjs`, `core.mjs`): `randomLoadout` picks a valid spawn
  weapon with ammo; `oneShot` makes any unprotected hit lethal. Tests cover both
  and their config defaults.
- **Captions** (`hud.mjs`, `config.mjs`, `app/page.tsx`): pure `audioCaption`
  maps the event stream to caption text; an optional strip renders it. Unit test
  added.
- **HUD clarity** (`config.mjs`, `app/page.tsx`): `showKillFeed`,
  `showDamageNumbers` and `showRadar` gate their HUD elements; display defaults
  and overrides unit-tested.
- Suites: full game **633/633**, server **109/109**, SSR 1/1, `tsc --noEmit`
  clean.

## Frag HUD chip 2.50 - 2026-09-12

- `grenadeStatus` in `hud.mjs` reports readiness/cooldown; a HUD chip renders
  beside the ability HUD. New unit test `grenade status reports readiness and
  remaining cooldown`. HUD/view/SSR suites 65/65, `tsc` clean.

## Grenade, sudden death and look controls 2.49 - 2026-09-12

- **Thrown frag grenade** (`core.mjs`, `input.mjs`, `server/room.mjs`, `touch.mjs`,
  `app/page.tsx`): edge-triggered on `G`, 7s cooldown, reuses the grenade
  projectile spec (arc, bounce, fuse), blocked while mounted. Bots throw when an
  enemy is visible at 7-20m.
- **Blast fairness** (`core.mjs`): `explode`/`detonate` lift the line-of-sight
  origin and ignore cover inside 60% of the radius, so ground-level frags damage
  nearby targets. New test `the thrown frag grenade arcs, explodes on its life
  and respects its cooldown`.
- **Sudden death** (`core.mjs`, `config.mjs`, `hud.mjs`, `app/page.tsx`): opt-in
  `suddenDeath` modifier (default off) enters overtime on a tie at the time
  limit, decided by the next score, bounded to 60s. Assault/Payload excluded.
  Tests cover entry, decision, bounded clock, and that decisive matches still end.
- **Look controls** (`config.mjs`, `touch.mjs`, `app/page.tsx`, settings UI):
  `invertY`, `adsSensitivity` (0.2-1.5), `touchSensitivity` (0.3-3), normalized
  and clamped; mouse and touch both route through them.
- Suites: full game **625/625**, server **109/109**, `tsc --noEmit` clean, SSR
  1/1. New features had no pre-fix baseline (additive); the blast-LOS change was
  covered by the existing explosion/weapon suites (151/151).

## Integrity pass 2.48 - 2026-09-12

Six parallel read-only audits (modes/objectives, bots/vehicles, net/server,
render/HUD/UI, plus two feature-idea passes) produced the findings below. Every
fix has a regression test confirmed failing against the pre-fix source.

- **Payload** (`payload.mjs`): anchor-seeded waypoint selection rejects duplicates
  by distance, so checkpoints have strictly increasing positive distances and
  award nothing while idle; route y comes from terrain support. New test
  `payload checkpoints never sit at zero distance or score while idle`.
- **Modes** (`core.mjs`, `mode-data.mjs`): time-limit block guarded by `!over`;
  score-limit tie-break awards the higher score; `clearZone` uses a nearest-clear
  search at player-scale clearance (fixes the catacombs hill test); authored
  objective data is finite-guarded with a `candidatePoints` fallback.
- **Vehicles/bots** (`core.mjs`, `vehicles.mjs`): orphaned gunners dismount;
  mounted bots skip personal fire; mounted actors skip flag interaction; flight
  exits keep altitude and clear `grounded`; empty vehicles remember `lastTeam`
  for friendly-fire; occupant count ignores trailing nulls.
- **Rendering/HUD** (`view.mjs`, `hud.mjs`, `character-anim.mjs`, `director.mjs`,
  `app/page.tsx`): flag geometries live in a reset-per-arena cache and model
  disposal runs before arena rebuild; flags recolor with the active palette; the
  low-health overlay is disposed once; cinematic directors receive the app
  Reduce Motion preference and update live; spectator cycling off-by-one fixed;
  chest bank preserved alongside focus.
- **Net/server** (`net.mjs`, `room.mjs`, `game-server.mjs`, `rooms.mjs`):
  malformed frames are tolerated; racing reconnects adopt the existing seat;
  reload reset on all lifecycles; history records `match.arena.id`; essential
  backpressure entries are room-tagged; `expireAll` isolates per room.
- Suites: full game **617/617**, server **109/109**, `tsc --noEmit` clean, SSR
  1/1. All new tests were run against `git stash`ed pre-fix sources and failed.

## Reachable capture points 2.47 - 2026-09-12

- A sweep of King of the Hill across every map found Frost Gate, Slagworks,
  The Forge and Convoy Line scoring exactly zero: their capture centres were
  authored on solid bridge/catwalk decks, which the movement model cannot climb
  (no step-up; jump apex 1.42m vs deck tops 2.7-5.5m), and the nav graph has no
  nodes on decks.
- `mode-data.mjs` now clears each KOTH/Domination zone onto unobstructed ground,
  and the `Match` constructor snaps any zone whose nearest nav node is >2.5m
  away (isolated walkable pockets left bots standing just outside the radius).
- KOTH now scores on Frost Gate/Forge/Slagworks/Convoy-line/Catacombs
  (22-33 per 40s window); Domination centre points are contestable.
- New assertion `objective zones land on navigable ground on every objective
  map` (confirmed failing pre-fix: `frost-gate koth zone hill ... nearest
  6.0m`).
- Suites: broad game regression 158/158, slow game/expansion.test.mjs 9/9,
  server 107/107, `tsc --noEmit` clean.

## Titan Valley traversal + objective fixes 2.46 - 2026-09-12

- Reachability sweep of all next-gen maps found titan-valley with 4/10 team
  spawns, 2/3 capture points and 3/6 vehicles outside the main nav component,
  because the central tunnel plus base bunkers sealed the northern half. The
  tunnel now spans [-24..24] instead of [-46..46]; the map goes from 339 to 662
  main-component nodes and every spawn/objective/vehicle is reachable.
- Bot drivers dismount after 3s without progress (5s re-board cooldown) instead
  of grinding against terrain all match.
- The closest teammate now holds an owned-but-empty KOTH/Domination/Combined-Arms
  zone, so capturing teams no longer abandon hills.
- New assertions (both confirmed failing against the pre-fix map): `next-gen
  team spawns sit in the main navigation component` and `combined-arms bots
  engage on titan-valley instead of idling on unreachable ground`.
- Suites: nextgen-maps 11/11, hardening 14/14, map/traversal 67/67,
  bot/mode/vehicle 119/119, slow game/expansion.test.mjs 9/9, server 107/107,
  `tsc --noEmit` clean. Combined Arms now ends on the objective with balanced
  scores instead of zero combat.

## Clear capture points 2.45 - 2026-09-12

- `createLevel` clears any objective zone that generated inside a non-deck solid
  to the nearest clear ground before cover, nav and pickups are placed. Deck
  (bridge/catwalk) centres are preserved. A sweep of all 33 maps shows zero
  buried objective zones.
- New assertion `next-gen objectives sit clear of walls and rocks` in
  `game/nextgen-maps.test.mjs`, confirmed failing against the pre-fix generator.
- Targeted map/mode suites 121/121 and the slow `game/expansion.test.mjs` 9/9
  (which exercises full next-gen bot matches) pass.

## Settings consistency 2.44 - 2026-09-12

- The "Unlimited unlocked ammo" toggle is enabled in every mode and reflects
  `config.unlimitedAmmo` (previously shown checked+disabled outside Deathmatch
  while the config did not apply it).
- Fixed a missing `recover` field in the showcase bot literal from 2.40; this was
  a `tsc --noEmit` failure (the vinext build does not typecheck). `tsc` and SSR
  now pass.

## Spawn safety net 2.43 - 2026-09-12

- `Match.spawn` nudges an actor to the nearest clear nav point when the chosen
  spawn is obstructed or unsupported, hardening every mode/map against bad
  authored spawns.
- New assertion in `game/hardening.test.mjs` (fails pre-fix). Targeted suites
  150/150. Full suite not rerun.

## No vehicle-seat churn 2.42 - 2026-09-12

- Bots only volunteer for a vehicle when a driver/gunner seat is open; the
  passenger bail-out from 2.40 no longer causes an enter/eject loop. Blood Gulch
  CTF: 97 enter / 94 exit over 20s dropped to 3 / 0, shots rose 160 -> 289.
- New assertion in `game/hardening.test.mjs` (fails pre-fix). Targeted suites
  141/141. Full suite not rerun.

## Reachable objective slots 2.41 - 2026-09-12

- `Match.zoneSlot` now falls back to the zone centre, then nearby nav nodes, then a
  widening ring of standable ground when a captured objective's slot is obstructed
  or off the nav grid, so bots no longer stall at blocked markers.
- New assertion in `game/hardening.test.mjs` (fails pre-fix). Targeted suites
  134/134. Full suite not rerun.

## Mode and bot hardening 2.40 - 2026-09-12

- Assault and payload end on their score-limit wins instead of running to the clock.
- Zero-frag FFA is a draw; payload routes are finite and non-degenerate.
- Bots: no self-vehicle parking, gunners fire, unreachable routes no longer stall
  them, ledge guard armed from spawn, passengers eject, Roo spares teammates,
  personality strafe blends, suppression degrades aim and encourages retreat.
- New `game/hardening.test.mjs`; all 10 cases fail against the pre-fix modules and
  pass now. Targeted suites 163/163 and 66/66. Full suite not rerun.

## Titan Valley spawn fix 2.39 - 2026-09-12

- Reproduced: two Pumas spawned inside the small valley buildings, two inside the
  cavern wall rings, and a Hornet inside cover.
- Moved the four Pumas and two Hornets to collision-free coordinates (checked with
  the vehicle radius plus 0.75m margin).
- Targeted map/mode suites pass 44/44 (`extra-modes`, `mode-data`,
  `expansion-maps`, `maps`, `arenas`). Full suite not rerun.

## Rapid chaingun 2.38 - 2026-09-12

- `CHAINGUN.interval` 0.12 -> 0.045s; heat/overheat removed (`heatPerShot: 0`)
  for unlimited sustained fire.
- Dedicated `SynthAudio._chaingun` voice for `vehicle-shot` with per-shot pitch
  wobble; paired barrels still dedupe to one report.
- Targeted vehicle/audio suites pass (44/44): `vehicles`, `vehicle-gameplay`,
  `vehicle-seats`, `feedback`, `weapon-simulation`. Full suite not rerun.

## Correctness pass 2.37 - 2026-09-12

- **Movement/spawns:** team-only maps derive FFA spawns from the nav graph (ten
  reachable points); airborne actors no longer snap onto cover; idle joysticks no
  longer override WASD.
- **Vehicles:** independent gunner aim, projectile vehicle impacts, single-owner
  gun timers, wreck entry rejection.
- **Networking:** socket disposal/stale-callback gating, prediction-clock rebasing.
- **Server:** retried persistence, bounded malformed-message replies, retained
  lifecycle messages under backpressure.
- **Results/history:** authoritative team wins for Assault/Payload/Combined Arms,
  and accurate timed-vs-score-limit endings.
- **Rendering:** collision-aligned cavern openings, post-processing disposal and
  single-DPR composer sizing, app-preference reduced motion.

Verification: `npm test` exit 0 — game 589/589, server 107/107, SSR 1/1;
`tsc --noEmit` clean; build succeeds. Every regression test was confirmed to fail
against the pre-fix modules. Browser/GPU visual checks remain outstanding (no
WebGL/browser in the build environment).

## Clean cavern tunnels 2.36 - 2026-09-11

- **Bug:** tunnels rendered as full `TubeGeometry` pipes centred ~1.2m above the
  terrain, so their lower half sank into the ground (z-fighting/shimmer along the
  whole length) and their tops poked through the dome shells near the walls. The
  double-sided tube also self-shadowed, adding shadow acne.
- **Fix** (`game/view.mjs`): a tunnel is now an open stone arch built from a
  terrain-following ribbon — the path is resampled every ~5m against
  `arena.terrain.height`, and a semicircular cross-section (feet on the ground,
  apex under the cavern wall top) is extruded along it. No buried geometry, no caps
  to intersect, and the tunnel mesh no longer casts shadows.

Verification: syntax check, `tsc --noEmit` clean, `npm run build` succeeds, SSR
`tests/*.test.mjs` 1/1. GPU-browser confirmation remains the honest final check.

## Interior-aware arena tour 2.35 - 2026-09-11

- **Change** (`game/interiors.mjs`, `game/director.mjs`, `app/page.tsx`): the
  director now receives the arena's structure volumes and, when the action cluster
  is inside a building, cavern or tunnel, shrinks the flyover orbit and drops to
  eye level inside that volume instead of circling the roof. When the fight moves
  back outside it eases out again, with an 0.8s hysteresis hold so a fight near a
  doorway does not flicker between indoor and outdoor framing.
- **Pure volume math** (`buildInteriors`, `interiorAt`, `interiorCenter`,
  `nearestOnSegment`): buildings become inset rotated boxes, caverns cylinders and
  tunnels capsule segments; `interiorAt` picks the containing volume with the
  least clearance.
- **Tests** (`game/interiors.test.mjs`, `game/director.test.mjs`): volume building
  (including rotated half-extents and skipped arches), containment/rejection, and a
  tour that stays under the roof and inside the room when the fight is indoors.

Verification: interiors + director suites pass, `tsc --noEmit` clean,
`npm run build` succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser confirmation
remains the honest final check.

## Action-following arena tour 2.34 - 2026-09-11

- **Bug:** the flyover orbited the arena centre, which is frequently a central
  building or roof, so the camera circled a rooftop while the fight happened
  elsewhere; the action point was also the mean of every bot, which pulls toward
  the middle on spread-out maps.
- **Fix** (`game/director.mjs`, `app/page.tsx`): the flyover now orbits the live
  action point itself (radius ~16–30m, altitude ~14m) so the fight stays framed.
  The action point is the centroid of the **densest cluster** of nearby live actors
  (falling back to the global centroid when players are spread out), eased over
  time. The action point is computed before the rig pose so the orbit and the aim
  agree on the same frame.
- **Tests** (`game/director.test.mjs`): the action point follows a three-actor
  cluster rather than the global mean, and the returned camera pose sits within the
  tour radius of the action.

Verification: `game/director.test.mjs` 12/12, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser confirmation remains the honest
final check.

## Steady arena tour 2.33 - 2026-09-11

- **Bug:** the menu camera kept zooming in and out. Three stacked causes: the
  flyover path's radius wove ±26% (a ~30s dolly), the tour FOV oscillated ±4°, and
  the occlusion pull-in engaged on cover near the action, dollying the camera a
  long way toward the fight.
- **Fix** (`game/director.mjs`, `game/view.mjs`): the tour orbit radius is now
  nearly constant (a gentle ±12% weave), the tour FOV is fixed at 72°, and the
  occlusion pull-in is skipped entirely for tours (`director.tour`) — the high
  flyover does not need it. Non-tour playback keeps a smoothed, asymmetric pull-in
  (fast tuck-in, slow held recovery) for genuine camera-behind-cover cases.
- **Tests**: director and camera suites still pass, including the tour no-cut and
  ease-toward-action cases.

Verification: `game/director.test.mjs` + `game/camera.test.mjs` pass, `tsc --noEmit`
clean, `npm run build` succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser
confirmation remains the honest final check.

## Arena-tour demo camera 2.32 - 2026-09-11

- **Change** (`game/director.mjs`, `app/page.tsx`, `game/view.mjs`): the menu
  showcase now runs a `tour` director. A new `flyover` rig orbits the whole arena
  on a smooth looping path (weaving radius and height) and aims at the live action
  centroid instead of a specific actor. Tours disable time and highlight cuts, so
  the camera never snaps to a new bot mid-shot.
- **Smooth aim** (`_actionPoint`): the aim is the centroid of live actors with an
  exponential ease, so deaths and spawns shift the view gradually instead of
  yanking it. The occlusion pull-in now rays from that aim point.
- **Reserved rig**: `flyover` has zero selection weight, so random Theater cuts
  never choose it; only a tour sets it.
- **Tests** (`game/director.test.mjs`): a tour never cuts (including on a death
  highlight), eases toward a distant action cluster rather than snapping, and the
  flyover rig is never picked by the normal rig chooser.

Verification: `game/director.test.mjs` 11/11, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser confirmation remains the honest
final check.

## Steady demo camera 2.31 - 2026-09-11

- **Bug:** the 2.30 occlusion pull-in was throttled to every other frame, so the
  camera alternated between the blocked director pose and the corrected pose at
  ~30 Hz — a high-speed flicker between two spots.
- **Fix** (`game/view.mjs`, `game/camera.mjs`): the correction now runs every frame
  and eases a single stand-off distance (`this._camWant`) toward the clear or
  blocked value, snapping only on a director cut, and leaves the director pose
  untouched once it is effectively clear. Oscillating ray hits are averaged by the
  easing instead of flickering. The distance decision is the pure
  `occlusionDistance` helper.
- **Tests** (`game/camera.test.mjs`): `occlusionDistance` returns the stand-off or
  the full distance, clamps to the minimum and degrades safely on missing input,
  alongside the existing `clearCameraPosition` cases.

Verification: `game/camera.test.mjs` 4/4, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser confirmation of the menu reel is
still the honest final check.

## Demo camera line-of-sight 2.30 - 2026-09-11

- **Bug:** the menu showcase director had no scene awareness, so orbit, tripod,
  dolly and crane rigs regularly placed the camera behind walls, roofs, domes and
  terrain, hiding the followed actor.
- **Fix** (`game/view.mjs`, `game/camera.mjs`, `app/page.tsx`): the cinematic
  branch now casts a ray from the followed actor's head back toward the camera
  against the arena group and, when scenery blocks the view, pulls the camera in
  front of the obstruction and re-aims it. The clamp/aim math is the pure
  `clearCameraPosition` helper (throttled to every other frame, menu-only, skipped
  for the software renderer). The showcase orbit radius dropped from 16 to 11 and
  rig weighting now favours chase/follow/crane over ground-level tripod/dolly.
- **Tests** (`game/camera.test.mjs`): pull-in along the same ray with correct
  yaw/pitch, no-op on clear or too-close views, and a minimum stand-off.

Verification: `game/camera.test.mjs` 3/3, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. A GPU-browser look at the menu reel is still
the honest final check.

## Cavern tunnel trim 2.29 - 2026-09-11

- **Fix** (`game/view.mjs`): tunnel tubes are built centre-to-centre, so after the
  2.28 wall rework they pierced the cavern shells. Each endpoint that lands within
  1.5u of a cavern centre is now moved `min(cavernRadius, segmentLength*.9)` toward
  its neighbour, so the visible tube terminates at the wall.

Verification: `tsc --noEmit` clean, `npm run build` succeeds, `game/structures`
and `game/maps` tests pass, SSR `tests/*.test.mjs` 1/1.

## Next-gen cavern rendering 2.28 - 2026-09-11

- **Bug:** caverns rendered as a lone floating hemisphere (equator ~30% up the
  wall, open all the way around) plus a full closed tube per tunnel. On The
  Catacombs (five caverns joined by four tunnels) the loose shells and tubes read
  as one merged, connected dome mass.
- **Fix** (`game/view.mjs`, `game/structures.mjs`): a cavern now renders as a
  stone drum split into two wall arcs with two opposite entrances, capped by a
  dome seated on the wall tops. The arc angles are computed from the same
  entrance rule the generator uses for its hidden collision ring, so the visible
  openings line up with the walkable gaps. Tunnels and caverns get their own
  materials instead of forcing the shared stone material double-sided.
- **Shared rule** (`game/structures.mjs`, `game/levelgen.mjs`): the entrance rule
  (`cavernOpening`) and shell dimensions (`cavernShell`) live once so the
  generator and renderer cannot drift.
- **Tests** (`game/structures.test.mjs`): entrance segments, the two wall arcs
  avoiding every entrance, and positive/finite shell dimensions. Map suites
  (`maps`, `nextgen-maps`, `expansion-maps`, `arenas`) still pass unchanged, so
  the collision/navigation geometry is identical.

Verification: 40/40 map and structure tests, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. A GPU-browser look at The Catacombs and Titan
Valley is the honest final visual check.

## Main-menu demo reel 2.27 - 2026-09-11

- **Root cause:** the showcase handed `view` a `Match.snapshot()`, which does not
  include the event stream, and forced `view.lastEvent=0`, so `view.effect()` never
  ran and the director never saw highlights. The menu therefore showed moving
  actors with no muzzle flashes, tracers, explosions, rail beams or death effects.
- **Fix** (`app/page.tsx`): the cinematic branch attaches the live `events` array
  and the match `serial` to the showcase state each frame, and both showcase
  `setMatch` calls seed the renderer cursor with the real serial (not zero). The
  renderer now plays the same effects a match does, and `CinematicDirector` receives
  real highlights to cut to.
- **More scenarios** (`game/showcase.mjs`): the reel grew from Combined Arms and
  Instagib to six — adding Rocket Arena, Capture the Flag, Payload and Assault —
  with shorter rounds and a tighter 2.1s cut cadence so the menu rotates features.
- **Director highlights** (`game/director.mjs`): explosions, flag pickups/returns,
  captures, vehicle destructions/splatters, payload deliveries, assault breaches
  and confirmed melee hits now prompt a cut (melee whiffs do not).
- **Tests**: `game/showcase.test.mjs` asserts the six-mode reel and wrap-around;
  `game/director.test.mjs` adds an explosion/melee-highlight test.

Verification: showcase/director tests pass, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. Effects are logic- and build-verified; a
GPU-browser look at the menu is still the honest final check.

## Spectator follow-target cycling 2.26 - 2026-09-11

- **Pure helpers** (`game/hud.mjs`, `game/hud.test.mjs`): `spectateActor(actors,
  targetId)` resolves the watched actor (falling back to the first live actor, then
  slot zero) and `nextSpectateTarget(actors, currentId, step)` cycles only through
  live actors in either direction. Tests cover dead-target fallback, forward and
  reverse cycling past dead actors, and the empty roster.
- **Camera** (`game/view.mjs`): when spectating, the render camera follows the
  selected target instead of always slot zero.
- **UI** (`app/page.tsx`): spectators cycle the followed actor with `[` / `]`
  (the HUD follows the same id so `FOLLOWING <name>` stays in sync) and the bottom
  HUD advertises `[ / ] FOLLOW`. The target resets to auto on a new match.

Verification: `npm run test:game` HUD tests pass, typecheck, production build and
the rendered response test green. Manual multi-client spectator playtesting on
hardware is still recommended.

## Manual reduce-motion override 2.25 - 2026-09-11

- **Display setting** (`game/config.mjs`, `game/config.test.mjs`):
  `normalizeDisplay` accepts a `reducedMotion` boolean (default false, non-boolean
  coerced to false). A test covers true/false/invalid input.
- **Runtime** (`app/page.tsx`, `app/game-ui/configuration.tsx`): the module-level
  `reducedMotion()` now returns true when a manual override is set or when the OS
  prefers reduced motion, and the override is synced from the display config on
  every change. Graphics & settings gains a **Reduce motion** toggle, so players
  can trim camera shake, animated menus, radar sweep and decorative effects even
  when their OS preference is not set.

Verification: `npm run test:game` config tests pass, typecheck, production build
and the rendered response test green.

## Server input rate limiting 2.24 - 2026-09-11

- **Per-peer budget** (`server/room.mjs`): each peer may submit at most 120 game
  inputs per rolling one-second window (`INPUT_RATE_LIMIT`); excess messages are
  dropped before any simulation work. Clients send at 60 Hz, so the budget leaves
  generous headroom while bounding the work a flooding client can force. The
  window resets on reconnect.
- **Test** (`server/room.test.mjs`): 300 rapid inputs accept at most the budget,
  and a fresh window accepts again.

Verification: `npm run test:server` 98/98 (the known flaky two-room socket test
passed on rerun), typecheck, production build and the rendered response test green.

## Connection quality indicator 2.23 - 2026-09-11

- **Pure grader** (`game/hud.mjs`, `game/hud.test.mjs`): `connectionQuality`
  grades the client's existing jitter/loss estimators into GOOD/FAIR/POOR with a
  colour tone and the current interpolation delay in milliseconds. A test covers
  each grade, the loss-driven POOR case and the empty-input default.
- **HUD** (`app/page.tsx`, `app/globals.css`): network matches show a colour-coded
  `GOOD · 100MS` chip in the bottom HUD, derived from the live NetClient timing
  state added to the decorated snapshot.

Verification: `npm run test:game` HUD tests pass, typecheck, production build and
the rendered response test green.

## Melee attack 2.22 - 2026-09-11

- **Simulation** (`game/core.mjs`): a new `Match.melee(actor)` swings a short
  forward arc (`MELEE`: 2.4u range, 45 damage, 0.6s cooldown). It requires a
  healthy actor, a live enemy inside the arc and a clear line of sight, consumes
  spawn protection on use, and emits a `melee` event carrying the hit actor (or
  null on a whiff). The cooldown decays in the step loop and each actor field is
  initialized on spawn. Bots swing at point-blank visible targets.
- **Input path** (`game/input.mjs`, `app/page.tsx`, `server/room.mjs`,
  `game/touch.mjs`): `controlsFromState` forwards `melee`; the page binds `F` and
  resets it after each step; the server converts a held melee into a consumed
  one-shot edge like reload; the touch cluster gains a `MELEE` button through the
  pure `applyTouchAction` helper. `TOUCH_BUTTONS` now lists 10 actions.
- **Tests**: `game/melee.test.mjs` covers a hit, cooldown refusal, out-of-range and
  behind misses, and teammate immunity; `game/input.test.mjs` covers the control;
  `server/room.test.mjs` covers edge latching, hold behaviour and re-arm;
  `game/touch.test.mjs` covers the touch action.

Verification: `npm run test:game` 536/536, `npm run test:server` 97/97, typecheck,
production build and the rendered response test green.

## Kill feed weapon labels 2.21 - 2026-09-11

- **Feed context** (`game/core.mjs`): death feed entries now carry the killing
  `weapon` index (or `null` for void deaths), matching the weapon already present
  on the `death` event.
- **Pure helper** (`game/hud.mjs`, `game/hud.test.mjs`): `killFeedWeapon(entry,
  weapons)` resolves that index to a short weapon name and returns `null` for
  environment kills or unknown indices. A test covers falloff-free mapping,
  missing/unknown weapons and null input.
- **HUD** (`app/page.tsx`): the in-match kill feed renders the weapon between the
  killer and victim.

Verification: `npm run test:game` HUD tests pass, typecheck, production build and
the rendered response test green.

## Weapon range readout 2.20 - 2026-09-11

- **Pure helpers** (`game/hud.mjs`, `game/hud.test.mjs`): `weaponRangeInfo` returns
  a SHORT/MID/LONG band, the full-damage `start` and falloff `end`, and the
  retained fraction; `weaponRangeLabel` formats it (e.g. `SHORT · 6–24m · 40%`).
  A new test covers falloff and non-falloff weapons and the empty case.
- **Settings/arsenal UI** (`app/page.tsx`, `app/globals.css`): the Graphics &
  settings arsenal list now shows each weapon's range band and effective distance,
  making the new falloff legible when choosing a loadout. The control reference
  gains a touch-controls row (`Left stick move · drag right to look · TALK to talk`).

Verification: `npm run test:game` passing (HUD tests included), typecheck,
production build and the rendered response test green.

## Touch controls v2 2.19 - 2026-09-11

- **Pure action mapping** (`game/touch.mjs`, `game/touch.test.mjs`): the on-screen
  button behaviour moved into `applyTouchAction(runtime,action,pressed)`, which
  tracks held actions (fire, ADS, crouch, voice push-to-talk) and latches one-shot
  actions (jump, reload, power, interact). `TOUCH_BUTTONS` now includes `voice`.
  A new test covers held tracking, one-shot latching, release behaviour and the
  null-runtime guard.
- **Right-zone look surface** (`app/globals.css`): the drag-look surface is now
  constrained to the right 62% of the screen instead of the whole viewport, so the
  left-hand HUD and thumbstick are not covered by an invisible touch target.
- **Push-to-talk button** (`app/game-ui/touch-controls.tsx`): a `TALK` button joins
  the action cluster and drives the existing voice push-to-talk gate; long-press
  context menus are suppressed on the control layer.

Verification: `npm run test:game` passing (touch tests included), typecheck,
production build and the rendered response test green.

## Bot threat awareness 2.18 - 2026-09-11

- **Hit reactions** (`game/core.mjs`): when a bot takes damage from another actor
  it now records the attacker as a remembered threat — refreshing `memory`,
  storing the attacker's position in `seen`, setting `target`/`threat` and opening
  a 1.4s `suppressed` window — and requests a prompt (but bounded, 60ms) re-plan.
  The existing `pursue` plan then sends the bot toward the last-known attacker
  position when the attacker is not currently visible, so it returns fire or
  investigates instead of ignoring unseen shots. Suppression decays over time and
  the bounded re-plan avoids recomputing the navigation path every frame under
  sustained fire.
- **State hygiene**: bot `suppressed`/`threat` are initialized on spawn and reset
  on respawn.
- **Tests** (`game/bot-suppression.test.mjs`): an unseen shot records the threat,
  forces a prompt re-plan, and drives a `pursue` toward the last-known position
  whose suppression decays; damaging a human writes no bot state.

Verification: `npm run test:game` 528/528, `npm run test:server` passing,
typecheck, production build and the rendered response test green.

## Snapshot quantization 2.17 - 2026-09-11

- **Payload trimming** (`game/quantize.mjs`, `game/quantize.test.mjs`): a pure
  `quantizeNumbers(tree, precision)` rounds every finite number in a snapshot or
  event tree to three decimals, leaving non-finite ammo sentinels, strings,
  booleans and nulls untouched, and preserving object identity.
- **Server wiring** (`server/room.mjs`): `wireState()` quantizes a
  `structuredClone` of the fresh snapshot so shared nested references (powerups,
  gear, attachments) are never mutated. Broadcast and join snapshots use
  `wireState()`, and event deltas are quantized from a clone. Positions and angles
  to the millimetre are visually identical but shorten every 30 Hz payload.
- **Tests**: three pure quantization tests (precision, identity, size) plus a room
  test proving the wired snapshot is quantized while the authoritative actor keeps
  full precision. `server/spectator.test.mjs` now compares against the quantized
  wire snapshot.

Verification: `npm run test:server` 96/96 (known flaky socket/history tests passed
on rerun), typecheck, production build and the rendered response test green.

## Server input hardening 2.16 - 2026-09-11

- **Bounded sequences** (`server/room.mjs`): input sequence numbers more than 600
  ahead of the last accepted value are snapped to the next expected sequence, so a
  rogue or buggy client can no longer jump `receivedSeq` forward and make every
  real input look stale. Duplicate and stale sequences are still ignored.
- **Clamped movement** (`server/room.mjs`): the `x`/`z` movement axes are coerced
  to finite values and clamped to `[-1,1]`; non-finite look values are dropped
  instead of forwarded.
- **Test** (`server/room.test.mjs`): a new room test covers axis clamping, the
  absurd-jump snap, stale-sequence rejection and non-finite axes/look.

Verification: `npm run test:server` 95/95 (one known flaky two-room socket test
passed on rerun), typecheck, production build and the rendered response test green.

## Weapon damage falloff 2.15 - 2026-09-11

- **Range identity** (`game/data.mjs`, `game/core.mjs`): hitscan weapons now carry
  an optional `falloff:{start,end,min}` band. Pulse, Scattergun, Shock Beam, Flak
  Cannon, Marksman Rifle and SMG keep full damage inside `start` and taper
  linearly to `min` at `end`. Rail Lance and the projectile/splash weapons are
  unchanged, so snipers and launchers own the long lane while spray and pellets
  lose bite with distance.
- **Pure helper** (`game/core.mjs`): exported `damageFalloff(weapon,distance)`
  returns `1` with no band or non-finite distance, `min` beyond `end`, and the
  interpolated value in between. The shotgun event now reports `falloff` for
  feedback consumers.
- **Tests** (`game/weapon-falloff.test.mjs`): the helper curve, a close-vs-far
  Pulse comparison (ratio ≈ 0.62 at 70u), a no-falloff Rail check (equal at both
  ranges), and a well-formedness sweep over every weapon.

Verification: `npm run test:game` 523/523, typecheck, production build and the
rendered response test green.

## Mobile touch controls 2.14 - 2026-09-11

- **Pure input math** (`game/touch.mjs`, `game/touch.test.mjs`): `joystickVector`
  clamps to the unit circle, `moveAxis` applies a deadzone, forward sign and the
  edge sprint threshold, and `applyLook` accumulates yaw and clamps pitch. Three
  tests cover these.
- **Shared controls** (`game/input.mjs`, `game/input.test.mjs`): `controlsFromState`
  accepts an analog `move` axis (overriding keys) and explicit `sprint`/`crouch`
  flags. A new test covers analog move, mixed key+analog priority and held posture.
- **On-screen controls** (`app/game-ui/touch-controls.tsx`, `app/page.tsx`):
  thumbstick, drag-look surface and action buttons write movement, look and
  held/tapped actions straight to the runtime; the loop feeds them through the
  same `controlsFromState` used by keyboard and netcode. Controls auto-enable on
  coarse pointers, toggle from Graphics & settings, and are persisted locally.
- **Mobile viewport** (`app/layout.tsx`, `app/globals.css`): device-width viewport
  with zoom disabled, plus `touch-action`/`overscroll-behavior`/safe-area rules so
  the arena fills the screen without pull-to-refresh.

Verification: `npm run test:game` 519/519, `npm run test:server` 94/94,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. Touch behaviour was validated by unit tests, typecheck and build; a real
phone browser playtest is still recommended.

## Payload mode 2.13 - 2026-09-11

- **Pure rules** (`game/payload.mjs`, `game/payload.test.mjs`): `payloadTemplate`
  builds an anchored, ordered route with checkpoints from the map's spawns and
  safe nav/objective points; `stepPayload` advances the cart for attackers, rolls
  it back (clamped to the last checkpoint) for defenders, freezes it under
  contest, banks checkpoints and declares a delivery winner. Eight tests cover
  config defaults, route shape, advance, stall/rollback, contest, delivery,
  timeout-to-defender and full 8-bot matches on supported arenas.
- **Sim integration** (`game/core.mjs`, `game/mode-data.mjs`, `game/config.mjs`):
  the `payload` mode is registered with checkpoint score rules; `updatePayload`
  emits `payload-checkpoint`/`payload-delivered`, sets the winner and keeps the
  snapshot's `objectives.payload` (position, distance, progress, pushing,
  contested, delivered, checkpoint count). Bots escort or hold the cart.
- **Content** (`game/nextgen-maps.mjs`, `game/arenas.mjs`): new generated map
  **Convoy Line** (`mode:'payload'`) satisfies the one-map-per-mode invariant and
  the geometry/spawn/cover checks; 20 arenas list `payload` in their play lists.
- **Renderer and UI** (`game/view.mjs`, `app/page.tsx`,
  `app/game-ui/configuration.tsx`): pooled cart model with spinning wheels and a
  contested/team beacon, plus the Payload command brief, `CHECKPOINTS` goal,
  scoreboard columns, target rule and objective copy.

Verification: `npm run test:game` 515/515, `npm run test:server` 94/94,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. The generic all-modes loop now resolves each mode to a supported arena and
accepts an objective result, not only kills. Cart visuals are not GPU-playtested
in this pass.

## Varied death effects 2.12 - 2026-09-11

- **Deterministic recipes** (`game/deaths.mjs`, `game/deaths.test.mjs`): a pure
  `deathPlan`/`deathStyleFor` maps weapon family, headshot and overkill to one of
  eight styles seeded per actor/death. Tests cover determinism, distribution,
  every weapon mapping to a valid plan, overkill escalating to gore, headshot
  bias and void-fall collapse.
- **Sim context** (`game/core.mjs`, `game/core.test.mjs`): `damage` and `fall`
  emit `death` events carrying `style`, `seed`, `weapon`, `overkill` and impact
  `direction`. New core tests assert the enriched event for a gore kill and a
  void fall.
- **Renderer** (`game/effects-fx.mjs`, `game/view.mjs`, `game/view.test.mjs`):
  new pooled `DeathPool` flings bounded limb/body chunks with gravity and spin and
  lays ground splats; `spawnDeath`/`poseCorpse`/`reviveCorpse` handle the debris
  and the toppling corpse. A view test proves piece and splat pools stay bounded
  and dispose cleanly.

Verification: `npm run test:game` 506/506, `npx tsc --noEmit` clean,
`npm run build` succeeds, `node --test tests/*.test.mjs` 1/1. `npm run
test:server` unchanged at 94/94. The effects were not GPU-playtested in a
browser in this pass.

## CTF bases, server bounds and shadow cadence 2.11 - 2026-09-11

- **CTF bases** (`game/maps.mjs`, `game/arsenal-maps.mjs`,
  `game/nextgen-maps.mjs`): Citadel, Trenchline, Signal Ridge and Sunken Hill now
  author red/blue `teamSpawns` and distinct `flagSpawns`. `game/arenas.test.mjs`
  asserts every CTF-capable arena has separated in-bounds bases and that a live
  CTF `Match` places both flags at them.
- **Mode/arena reconciliation** (`server/room.mjs`): `host` and `start` route the
  requested map through `resolveMapForMode(mapId, mode, {legacy:true})`, so an
  incompatible arena is repaired before the `Match` is built. New room tests
  cover a repaired CTF launch and a preserved compatible arena.
- **Room ceiling** (`server/rooms.mjs`, `server/game-server.mjs`): the registry
  caps concurrent rooms (`maxRooms`, default 64), evicts the oldest idle room
  under pressure, and returns `null` (surfaced as a client error) when no room
  can be freed. New registry test.
- **Kill-feed live region** (`app/page.tsx`): the kill feed is now
  `role="log" aria-live="polite"`.
- **Shadow cadence** (`game/view.mjs`): `shadowTick` refreshes shadows on a fixed
  cadence instead of every frame; `game/view.test.mjs` covers the sequence.

Verification: `npm run test:game` 497/497, `npm run test:server` 94/94,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Menu, playback, bot-posture and server-liveness batch 2.10 - 2026-09-11

- **Menu navigation** (`app/page.tsx`): Escape now backs out of browse,
  progression, theater-list and lobby; changing mode reconciles an incompatible
  arena via the new pure `resolveMapForMode` (`game/arenas.mjs`). Assault gains a
  sector-count rule (`app/game-ui/configuration.tsx`), a `SECTORS` goal and a live
  command brief.
- **Theater playback** (`game/demo.mjs`): `DemoPlayer.sample` now seeds from the
  nearest prior keyframe and merges/prunes actors, vehicles and rockets by id, so
  entities that spawn or despawn mid-recording play correctly; the recorder
  enforces `maxSeconds`. New `demo` tests.
- **Bot posture** (`game/core.mjs`): bots sprint on long rotations, aim down
  sights at mid range, and slide when critically hurt and sprinting. New
  `bot-behavior` tests; all mode/difficulty match tests still pass.
- **Maps and objectives** (`game/levelgen.mjs`, `game/core.mjs`,
  `game/assault.mjs`): the next-gen CTF map keeps its authored flag bases; zone
  and sector occupancy now require proximity on the vertical axis; Assault
  defenders win a round that reaches the timer without a breach. New
  `nextgen-maps` and `extra-modes` assertions.
- **Server liveness** (`server/game-server.mjs`, `server/room.mjs`): a 15s
  heartbeat terminates unresponsive sockets, `TRAFFIC_BUFFER_LIMIT` drops sends
  to a backing-up client, and spectators are capped at `SPECTATOR_LIMIT`. New
  spectator-cap test.

Verification: `npm run test:game` 494/494, `npm run test:server` 91/91,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Codebase-audit gap-fix batch 2.9 - 2026-09-11

A five-domain audit of the simulation, content, UI, server and renderer produced
a ranked gap list; the highest-impact correctness bugs were fixed:

- **Objective modes** (`game/mode-data.mjs`, `game/core.mjs`): `objectiveTemplate`
  now keys off `modeRule(mode).objective.kind`, so Combined Arms gets Domination
  zones; Assault and Combined Arms are objective-aware for bots; the KOTH hill is
  the authored zone nearest the arena center. Verified by new `mode-data` and
  `extra-modes` tests plus a probe (Combined Arms scores; Assault bots capture all
  three sectors).
- **Reload and arsenal** (`game/core.mjs`, `game/config.mjs`): the simulation
  consumes the forwarded one-shot `reload`, `startingWeapon` accepts indices 0-9,
  bots pick weapons 5-9, and the resolved attachment weapon drives reload cap,
  reload duration and pickup caps. New `gameplay`, `config`, `attachment-behavior`
  and `bot-behavior` assertions.
- **Balance correctness** (`game/core.mjs`, `game/progression.mjs`,
  `game/vehicles.mjs`): negative armour clamped at spawn and in absorption,
  harness passive damage applied, vehicle friendly-fire rules (crew excepted),
  mounted chainguns damage enemy vehicles, and vehicle speed/boost/traverse
  skills are honoured. New `vehicles`, `vehicle-gameplay` and `gameplay` tests.
- **Server hardening** (`server/rooms.mjs`, `server/room.mjs`,
  `server/progression.mjs`): room names sanitized/bounded, mid-match join sets
  `lastSerial` and becomes a spectator, gear writes reject spectators and are
  throttled, and `ProgressionStore` touches on access so eviction is LRU. New
  `rooms`/`room`/`progression` tests.
- **Renderer** (`game/software.mjs`, `game/view.mjs`, `game/textures.mjs`): the
  CPU renderer expands `InstancedMesh` instances, and surface textures are
  disposed exactly once on rebuild. New `textures` suite and a `view` instancing
  test.

Verification: `npm run test:game` 483/483, `npm run test:server` 90/90,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Five-pass polish batch 2.8 - 2026-09-11

- **Killstreak callouts** (`game/hud.mjs` `multikillLabel`/`spreeLabel`/`recentKills`/`killCallout`): rapid local kills produce DOUBLE/TRIPLE/OVERKILL/MONSTER/MEGA KILL labels and five-kill milestones produce spree names. `game/core.mjs` death events now include `killer`/`killerName`/`self` so the same pure logic serves solo and net. Covered by new `hud` tests plus the enriched-event path in `core`/`feedback`.
- **Post-match superlatives** (`matchAwards`): MVP, most objective time, flag runner, best K/D and feed provider, rendered on the results screen; returns nothing for solo practice. Covered by new `hud` tests.
- **Bot survival instincts** (`game/core.mjs`): `blastUnsafe` prevents a bot firing an explosive when the target is inside its own radius, and a critically hurt bot with no supply retreats instead of closing. New `bot-behavior` tests cover the blast threshold and the retreat vector, and the seven-bot flow test still passes.
- **Colorblind team palette** (`game/config.mjs`, `game/team-presentation.mjs`, `game/view.mjs`, settings): the default palette is unchanged; the colorblind palette swaps red/blue for Okabe-Ito orange/blue while preserving the bar-based world markers. New `team-presentation` and `config` assertions cover the switch.
- **Tactical radar** (`game/radar.mjs`): yaw-relative contacts for actors, objectives and flags with team/palette colours and a reduced-motion-aware sweep. New `radar` tests cover projection, yaw rotation, range clipping and palette mapping.

Verification: `npm run test:game` 468/468, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Arena fall fix and HUD 2.7 - 2026-09-11

- **Terrain edge free-fall fixed** (`game/core.mjs` `moveActor`): the horizontal
  step could move an actor past the heightfield boundary, where `floorAt` returns
  null; the vertical pass then never landed and the actor was clamped in-bounds
  only afterwards, producing an endless fall. The position is now clamped to the
  arena bounds *before* the floor query. `game/levelgen.mjs` also emits a
  `voidY` kill-plane on next-gen maps so any impossible fall kills and respawns.
  Verified by walking every edge of titan-valley / frost-gate / colosseum for
  2000 ticks (minimum y stayed at terrain, zero spurious deaths).
- **HUD v2.7** (`app/globals.css`): viewport-scaled readouts (`clamp()` on the
  clock, frags, health, armor, ability, weapon and command panel), stronger panel
  treatments, and cinematic announcement effects — glowing banner with a sweeping
  underline, popping kill banners, sliding kill feed and larger hitmarkers/damage
  numbers — all disabled under `prefers-reduced-motion`.

Verification: `npm run test:game` 455/455, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Next-generation graphics overhaul 2.6 - 2026-09-11

- **Articulated characters** (`game/character-anim.mjs`): engine-free pose solver
  (idle/run/crouch/air/ADS, bounded joints, contra-lateral limbs) and a joint rig
  applied to smooth capsule/ball operator models in `game/view.mjs`.
- **Natural bot facing** (`game/core.mjs`): every actor has a damped `bodyYaw`
  (difficulty-scaled turn rate) that trails their aim; exposed in snapshots and
  consumed by the rig for head/chest tracking and turn banking.
- **Procedural levels** (`game/levelgen.mjs`, `game/nextgen-maps.mjs`): ten
  seeded maps, one per mode, with heightfield terrain biomes, cliff faces and
  strata, enterable buildings, tunnels, caverns, bridges, arches, columns and
  props. Legacy maps are unchanged.
- **Renderer** (`game/view.mjs`): next-gen collision proxies (`cave`, `tunnel`,
  `rock`, `tree`, `crate`, `column`) render as smooth geometry instead of boxes;
  navigation uses a fast spatial-grid graph with largest-component pruning.

Verification: `npm run test:game` 455/455, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. New suites: `game/character-anim.test.mjs`, `game/bot-facing.test.mjs`,
`game/nextgen-maps.test.mjs`. Legacy movement invariants are scoped to the
legacy arenas; next-gen maps are covered by their own geometry, spawn-support,
navigation-connectivity and full-match suites.

## COCS rebrand 2.5 - 2026-09-11

- **Identity.** The game is now **COCS — Colosseum Of Competitive Slop**.
  `app/layout.tsx` metadata, the canvas/wordmark labels, `server/game-server.mjs`
  banner and the deploy labels all use the new name. In-app localStorage keys stay
  `token-arena-*` so existing saves are preserved.
- **Title screen** (`app/page.tsx`, `app/globals.css`): `C O C S` renders in big
  industrial type with `COLOSSEUM / OF / COMPETITIVE / SLOP` stacked under each
  letter, animated in one letter at a time (`.title-letter` / `@keyframes
  cocsSlide`) and disabled under `prefers-reduced-motion`.
- **Back out of the menu:** the loadout screen has a ✕ title-return button and
  Escape now returns to the title screen when no modal is open.
- **Copy pass:** operator tags/bios, harness descriptions, powerups, weapons,
  modes, difficulties, gear, attachments, finishes, reticles and rank titles were
  rewritten with tongue-in-cheek parody copy; the unlock track is grouped into
  Gear / Weapon Mods / Weapon Finishes / Reticles with per-group progress bars.

Verification: `npm run test:game` 437/437, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1 (the rendered-HTML test now asserts the COCS identity).

## Title demo and weapon effects 2.4 - 2026-09-11

- **Showcase scenarios** (`game/showcase.mjs`): the title screen cycles a
  Combined Arms battle (16 bots on skyfall-basin / trenchline / signal-ridge /
  warfront, vehicles pre-seated at 70% through `seatShowcaseVehicles`) and an
  Instagib rail match, with faster cinematic cuts.
- **Quake 2 rail** (`game/effects-fx.mjs` `RailBeamPool`): an additive
  spiral-textured cylinder with a white core and expanding muzzle ring, plus a
  starburst impact. Pooled, disposed, and safe without a DOM.
- **Per-weapon effects** (`game/view.mjs`): pulse, rail, scatter, plasma,
  grenade, shock, flak, marksman and SMG each compose distinct tracer, impact
  and explosion visuals; projectile rendering is per-weapon.

Verification: `npm run test:game` 437/437, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. New suites: `game/showcase.test.mjs`, `game/rail-effect.test.mjs`.

## Attachment behaviours and reticles 2.3 - 2026-09-11

- **Charge coil** (`game/core.mjs`): firing a charge weapon accumulates charge
  per frame until `chargeTime`, emits `charge` start/ready events, and fires a
  boosted shot (`chargeDamage`). Releasing early resets the charge.
- **Homing beacon** (`game/core.mjs`): rockets carry `homing`/`homingTurnRate`
  and steer toward the nearest enemy within range each step.
- **Burst module**: continues a burst after the initial trigger pull (already
  wired in 2.2, now covered by `game/attachment-behavior.test.mjs`).
- **Reticles** (`app/globals.css`, `game/config.mjs`,
  `app/game-ui/configuration.tsx`): all five reticle shapes render and are
  selectable; the dynamic gap transform excludes chevron/split.
- **Discoverability**: the harness panel now lists each harness's vehicle skill.

Verification: `npm run test:game` 433/433, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Attachments, vehicle overhaul, assault, cosmetics 2.2 - 2026-09-11

- **Weapon attachments** (`game/attachments.mjs`): four slots, fourteen mods,
  and a resolver that folds multiplicative/additive stat modifiers plus
  behaviour modules (`burst`, `charge`, `pierce`, `explosive`, `homing`,
  `chain`) into a derived weapon. `game/core.mjs` resolves a loadout's
  attachments per actor and applies them per weapon in `fire` (pierce, splash
  detonation, chaining and stat changes), while `game/view.mjs` adds optics,
  barrels and magazines to the 3D weapon models. Attachments persist through
  `game/progression.mjs` and the server JSON store.
- **Vehicle overhaul** (`game/vehicles.mjs`, `game/core.mjs`): inverted steering
  fixed; `driver`/`gunner`/`passenger` seats with mounted seat anchoring;
  occupants are visible and targetable (own-vehicle shielding no longer absorbs
  rider hits); a gunner fires the mounted gun without moving the vehicle; and
  harness vehicle skills (auto-gunner, plating, repair, boost, speed) are
  defined in `game/harness-profiles.mjs` and applied in core.
- **Assault mode** (`game/assault.mjs`, `game/mode-data.mjs`, `game/core.mjs`):
  ordered sector capture with contest/neutralise, breach at the final sector, and
  defender-holds behaviour; registered as a game mode and wired into the match
  snapshot and objective markers.
- **New maps** (`game/arsenal-maps.mjs`): trenchline, signal-ridge, rampart and
  catwalk-breach, registered in `game/maps.mjs` with arena metadata.
- **Finishes and reticles** (`game/cosmetics.mjs`): six weapon finishes recolor
  weapon glow materials and five reticle styles are unlockable cosmetics.

Verification: `npm run test:game` 429/429, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. New focused suites: `attachments`, `assault`, `assault-match`,
`arsenal-maps`, `cosmetics`, `vehicle-seats`.

## Arsenal expansion and balance 2.1 - 2026-09-11

- **`game/data.mjs`**: two new hitscan weapons (Marksman Rifle, SMG) appended
  after the original eight, plus balance tweaks to Scattergun bloom/interval,
  Plasma Driver interval and Flak Cannon interval. Every weapon still satisfies
  the generic fire contract (positive damage/interval/range/ammo/cap) and the
  original five names/order are preserved.
- **`game/config.mjs` / `game/maps.mjs`**: ten-slot `spawnInventory` and
  `pickupWeapon` mappings for `marksman`/`smg`.
- **`game/view.mjs`**: detailed 3D silhouettes for both new weapons with
  barrel-aligned muzzle anchors, plus pickup colours; `game/feedback.mjs`
  automatically synthesises their shot/launch audio from weapon feel.
- **Maps**: Marksman/SMG pickups added to Warfront Delta and Skyfall Basin.
- **Input**: number row binds 1–9 and 0; wheel cycles all ten.
- Updated contracts: `content.test` (length 10, appended shorts),
  `weapon-presentation` (ten distinct silhouettes, muzzle anchors for all),
  `powerups`/`expansion`/`config` (ten-slot inventories and instagib rail lock).

Verification: `npm run test:game` 378/378, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Progression, unlocks and gear 2.0 - 2026-09-11

- **`game/progression.mjs`**: deterministic XP curve, `levelFromXp`, rank
  titles, an 8-piece gear catalogue across three slots, level-gated unlocks,
  `resolveGear` modifiers (additive health/armour, multiplicative combat stats)
  and `awardMatch`. Covered by 7 tests.
- **`game/core.mjs`**: `options.loadouts[id].gear` is resolved per human actor
  and applied on every spawn (health/armour/speed/damage/spread); bots keep
  defaults. Snapshot stays deterministic with no gear.
- **`server/progression.mjs`**: JSON store mirroring `history.mjs` (atomic
  writes, player cap, validated ids) with `award`/`setGear`/`get`. Covered by 5
  tests including a full `Room` match that awards persistent XP and queues a
  `progression` message.
- **Protocol**: clients send a stable `playerId` on join/create, persist gear
  with a `gear` message, and receive `profile` on welcome plus `progression`
  updates with XP gained, level-ups and unlocks.
- **Client**: a new Rank screen (level, XP bar, career stats, unlock list, gear
  slots), unlock toasts, gear saved to localStorage and applied to solo matches
  and hosted lobbies.

Verification: `npm run test:game` 378/378, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Air combat: Hornet and Skyfall Basin 1.9 - 2026-09-10

- **`game/vehicles.mjs`** gains the `HORNET` flight chassis and a dedicated
  `stepFlight` integrator (lift/descend/hover, boost, ceiling clamp, altitude
  collision) plus kind-based `vehicleConfig` resolution and paired ground/flight
  muzzles. Covered by 4 tests in `game/vehicle-flight.test.mjs`.
- **`game/core.mjs`**: vehicle entry respects altitude, bots in vehicles fire the
  mounted gun, flight vehicles are excluded from run-over stomping, and the
  snapshot publishes `vy`, `flight` and `altitude`.
- **`game/view.mjs`**: `vehicleModel('hornet')` builds the aircraft (wings, tail,
  canopy, twin engines, nose guns).
- **`game/battle-maps.mjs`**: new `skyfall-basin` (span 144, four vehicles: two
  Puma, two Hornet), passing bounds, navigation, clearance, render/dispose and
  full 3-bot match contracts.

Verification: `npm run test:game` 371/371, `npm run test:server` 80/80,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Arena framework, traversal v2 and combined arms 1.8 - 2026-09-10

- **`game/arenas.mjs`** adds an arena registry: group/scale/mode-whitelist/legacy
  metadata derived from authored overrides or map shape, with `activeMaps`,
  `mapsForMode`, `maxBotsFor`, `recommendedBots`, `groupedMaps` and
  `arenaVariant`. Covered by 6 tests.
- **Legacy gating:** Exchange, Crosswire, Foundry, Launchpad, Citadel and Blood
  Gulch are `legacy`; the setup/host map pickers, `shuffleSelection` and
  `nextArenaSelection` exclude them unless Games & settings → *Legacy arenas*
  is on. Rotation tests cover both paths.
- **Traversal v2:** trampolines/jump pads, boost launchers, **ziplines** and
  **teleporters** are parsed and simulated in `game/core.mjs` (with teleporter
  nav edges), rendered in `game/view.mjs`, and exercised by 5 traversal tests
  (launch, teleport relocation + cooldown, zipline ride, nav bridge, event
  forwarding).
- **New maps** (`game/battle-maps.mjs`): `neon-vertical` (urban, jump pads,
  rooftop ziplines, teleporters), `substation` (indoor, ceiling array,
  bulkheads, teleporters), `warfront` (large combined-arms, four Pumas). Each
  passes the all-map contracts: block bounds, connected navigation, grounded
  and clear spawns/pickups/flags/zones, distinct material/fog signature,
  render/dispose invariants, cover landings and full 3-bot match completion.
- **Combined Arms mode** (`game/config.mjs`) with `maxBots:16`; `normalizeConfig`
  clamps bot count to the mode cap and `MatchConfiguration` follows it.

Verification: `npm run test:game` 365/365, `npm run test:server` 80/80,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Bot personalities and mode balance 1.7 - 2026-09-10

- **`game/bot-personalities.mjs`** blends the existing operator `role` and harness
  `personality` tables into one bounded behavior descriptor (aggression, hold,
  flank, objective, supply, vehicle, strafe, engagement `range`, `spacing`,
  `retreat`) with deterministic per-id jitter. Covered by 6 tests.
- **`game/core.mjs`** now uses that descriptor: varied target ranking (ally-lock
  penalty, opportunist/ambusher biases), behaviour-driven engagement ranges and
  strafing, gated vehicle use, spread supply selection, ground-only separation
  steering, and `zoneSlot` perimeter positions that fall back to the zone centre
  when a slot would sit over the void. Attackers keep advancing while firing.
- **Balance:** `updateObjectives` now decays a holder's progress while the zone is
  contested (faster neutralisation, no stalemate), while uncontested owners still
  score. Regression tests: a seven-bot match fields >=5 distinct behaviors with
  low clustering, objective slots are spread, contested control decays, and an
  uncontested owner still scores. Measured: 7/7 distinct behaviors and ~0.25-1.3
  bots within 2 m (peak 2-3) versus the previous shared behaviour.

Verification: `npm run test:game` 348/348 (incl. 4 bot-behaviour and 6
bot-personality tests), `npm run test:server` 80/80, `npx tsc --noEmit` clean,
`npm run build` succeeds, `node --test tests/*.test.mjs` 1/1.

## Theater, cinematic camera and live menu showcase 1.6 - 2026-09-10

- **`game/demo.mjs`** records snapshot keyframes at 18 Hz, interpolates
  positions/yaw (shortest-angle) on playback, exposes the event stream for
  effects, and serializes/parses plus gzip (de)compression. **`game/demo-store.mjs`**
  persists recordings in IndexedDB (summary + data stores).
- **`game/director.mjs`** is a pure-math cinematic director: seven rigs, damped
  motion between hard cuts, auto-cuts on `death`/`explosion`/`capture`, target
  selection from highlight events or nearby explosions, and manual rig/target/
  free-look control. It returns a `{x,y,z,yaw,pitch,roll,fov,cut}` pose that the
  renderer copies onto the existing camera (so bloom post-processing keeps working).
- **`game/view.mjs`** gained a cinema path (`setCinema`/`setDirector`/`setShowcase`),
  renders the gameplay scene with the director pose, hides the first-person view
  model, suppresses local-player shake, null-guards `match.events`, and composites
  the selected operator's menu model into the customization panel with a scissored
  viewport pass over the showcase (`setPreviewRect`).
- **`app/page.tsx`** runs a live bot showcase behind the menu (fully bot-driven,
  rotating map/mode), records solo and network matches, and adds a Theater screen
  with playback controls, rig chips and keyboard shortcuts. The showcase can be
  disabled in settings and is automatically skipped for the CPU renderer and
  `prefers-reduced-motion`.

Verification: `npm run test:game` 338/338 (incl. 13 demo and 8 director tests),
`npm run test:server` 80/80, `npx tsc --noEmit` clean, `npm run build` succeeds,
`node --test tests/*.test.mjs` 1/1. The showcase/theater integration lives in the
client render loop and is exercised by the build + SSR test rather than a headless
WebGL test.

## Bunny-hop fix and audio upgrade 1.5 - 2026-09-10

- **Bunny-hopping**: previously each landing applied ground friction before the
  buffered jump fired, so chained hops lost ~10% speed per landing, and holding
  Space did not auto-hop. `moveActor` now skips ground friction on a frame where a
  held/buffered hop is about to land, `controlsFromState` treats a held `Space` as
  jump (autohop), and air acceleration was retuned (`MOVE.airAccel 3.5`,
  `airCap 1.6`, `terminal 2.2`). Measured in a deterministic harness: forward
  autohop holds 8.00 m/s, strafe autohop builds to ~9.3 m/s, standstill autohop
  reaches ~6.9 m/s. New regression tests cover speed preservation and strafe gain.
- **Audio**: `SynthAudio` was rewritten to layer filtered-noise transients with
  tonal bodies and sub thumps (per-weapon rifle/heavy/zap/burst/plasma character),
  plus improved explosions, reload/weapon-switch clicks, hit and kill cues,
  per-surface-agnostic footsteps with landing thuds, a speed-tracking Warthog
  engine, distance falloff and stereo panning. Remote events without a position
  stay silent. Tests updated to the new engine's routing contract.

Verification: `npm run test:game` 317/317, `npm run test:server` 80/80,
`npx tsc --noEmit` clean, `npm run build` succeeds, rendered-HTML test passes.

## Live deployment and in-game source link - 2026-09-10

Public site: https://arena.ussyco.de (nginx + wildcard TLS) proxying the
production `vinext start` app on `127.0.0.1:3000` and the Node game server on
`127.0.0.1:4000` at `/ws`. Both run as `mojo` user systemd units on this host.

- Added a GitHub source link (`https://github.com/mojomast/tokenarena`) to the
  selection/browse/lobby top bars, the Graphics & settings dialog, and the pause
  menu, using an inline GitHub mark (lucide 1.31 dropped brand icons).
- The rendered-HTML gate now asserts the source link is present in the
  server-rendered selection screen.
- Redeployed: `npm run build` then `systemctl --user restart
  token-arena-web.service` (reloads the server bundle and asset manifest) and
  `token-arena-server.service` (loads the 1.3/1.4 netcode; disconnects active
  multiplayer clients briefly).

Live verification (curl + WebSocket, 2026-09-10):

| Check | Result |
|---|---|
| `https://arena.ussyco.de/` | HTTP 200, new asset hash `assets/page-CgTUMVNQ.js` |
| Referenced page asset | HTTP 200, contains `github.com/mojomast/tokenarena` |
| `https://arena.ussyco.de/ws` | WebSocket opens and returns `{"type":"rooms",...}` |
| `node --test tests/*.test.mjs` | pass (now also asserts the source link) |

## Combat feedback, bot flow and platform-map connectivity 1.4 - 2026-09-10

A follow-up pass of four parallel subagents on non-overlapping files (maps, HUD/UI, renderer, bot AI), then reconciled and verified.

- **Combat feedback HUD** (`game/hud.mjs`, `app/page.tsx`, `app/globals.css`): floating damage numbers (victim world position projected to CSS px through `view.camera`), a directional damage indicator, bright kill/death banners, a weapon/ammo panel with auto/semi and reload state, and a match/objective announcer. Pure helpers (`projectToScreen`, `damageBearing`, `killBanner`, `weaponTag`, `ammoText`, `matchStartBanner`, `scoreAnnouncer`) are unit-tested; rendering is bounded and reduced-motion aware.
- **Renderer feel** (`game/view.mjs`, new `game/effects-fx.mjs`): dynamic FOV (sprint widens, ADS narrows to `max(55, fov*0.82)`), a two-light pooled muzzle flash, a low-health camera overlay, and bounded camera shake on local damage/death. A shared material cache and scoped geometry cache reduce per-model allocation/GPU state churn. All effects are disabled for `SoftwareRenderer` and `prefers-reduced-motion`.
- **Bot AI** (`game/core.mjs`): per-actor scan range scales with difficulty and arena diagonal; roam always has a destination (objective or patrol); CTF defenders hold a post near their own flag, attackers vary approach routes, and long rotations detour to a nearby vehicle. Large maps now yield kills and ended matches instead of 0-0 stalls.
- **Platform-map connectivity** (`game/expansion-maps.mjs`, tests): Ironfall Megastructure and Longreach Plateau gained physical up/down launcher pairs and re-aimed shelf launchers; both directed nav graphs are now a single connected component, so bots can cycle the map. No navigation-engine change was needed (the bidirectional-link approach remains rejected).

Automated evidence (2026-09-10):

| Gate | Command | Result |
|---|---|---|
| Game logic, AI, maps, movement, weapons, vehicles, view, HUD, net | `npm run test:game` | **315/315 pass** |
| Rooms, voice, history, server vehicle | `npm run test:server` | **80/80 pass** |
| TypeScript | `npx tsc --noEmit` | clean |
| Production build | `npm run build` | succeeds |
| Rendered response | `node --test tests/*.test.mjs` | pass |
| Runtime smoke (all 14 maps, CTF, 3 bots, 300 s) | scripted `Match` harness | finite state; Ironfall/Longreach now score and end (were 0-0) |

Known limits: damage numbers are emitted on the ~10 Hz HUD tick and smoothed by CSS, and camera projection uses the previous frame's camera (≤1 frame lag). Platform-map void falls remain the main rough edge (combat knockback near ledges). GPU frame pacing of the new overlays/lights still needs a hardware browser playtest.

## Combat feel, Warthog, arena rebuild and visual overhaul - 2026-09-10

Scope: a "make it not feel generic" pass built from five parallel research
subagents (Quake/Source movement + gunfeel, browser-shooter netcode, Halo M12
Warthog, Blood Gulch/CTF level design, Three.js rendering budgets) and six
implementation subagents in two non-overlapping file-ownership waves.

Implemented:

- **Movement** (`game/core.mjs`): Quake/Source ground friction (6) and
  acceleration (10), air acceleration (1.0) so strafe jumps build speed, terminal
  cap, variable jump with apex hang (`gravity 26`, `jump 8.6`), sprint (×1.375),
  crouch (×0.4), momentum-preserving slide + slide-hop. Coyote .10 s / buffer
  .12 s retained. `MOVE` constants are exported for tests.
- **Gunplay** (`game/core.mjs`, `game/data.mjs`): authoritative recoil aim-punch
  with per-weapon spray patterns, bloom spread with recovery, ADS, reload /
  auto-reload, weapon holster/raise, retuned recoil/bloom/reload per weapon
  (Pulse TTK ≈0.81 s). Camera applies `punchYaw`/`punchPitch` and `eyeHeight`.
- **Warthog** (`game/vehicles.mjs`, `game/view.mjs`): recognizable M12 model and
  arcade physics (engine/drag, speed-sensitive steering, lateral-slip drift,
  handbrake, boost, four-wheel suspension/slope alignment, body roll/pitch, 360°
  turret, paired-muzzle heat); deterministic run-over splatter in `Match.step`.
- **Maps** (`game/blood-gulch.mjs`, new `game/ctf-maps.mjs`): Blood Gulch rebuilt
  to a 160×70 m box canyon (central hill, two sniper ridges, two caves, multi-route
  bases with roof teleporters, two Warthogs); new Frostline, Derelict Station and
  Ashen Rift CTF maps registered in `game/maps.mjs`.
- **Graphics** (`game/view.mjs`, new `game/textures.mjs`, `game/environment.mjs`):
  directional shadows, PMREM IBL environment, deterministic FBM albedo/roughness/
  normal textures, vertex/triangle color variation, gradient sky with instanced
  mountains and terrain scatter, tiered bloom/vignette/SMAA postprocessing
  (bypassed by the software renderer and reduced-motion).
- **Input/HUD** (`app/page.tsx`, `game/input.mjs`, `game/hud.mjs`,
  `app/globals.css`): Shift sprint, Ctrl/C crouch, R reload, RMB ADS, shared
  `controlsFromState` on solo and net paths; spread crosshair, hitmarker, reload
  bar, posture chip, low-ammo warning.
- **Netcode** (`game/net.mjs`, `server/room.mjs`): adaptive interpolation delay
  ~100 ms (floor 90 / ceiling 160), jitter-adaptive snapshot buffer (4–16),
  server snapshot rate 20→30 Hz (configurable), reload one-shot edge and
  sprint/crouch/ADS flags forwarded.

Automated evidence (run on this machine, 2026-09-10):

| Gate | Command | Result |
|---|---|---|
| Game logic, maps, movement, weapons, vehicles, view, input, HUD, net | `npm run test:game` | **293/293 pass** |
| Rooms, chairs/grace, voice, history, server vehicle | `npm run test:server` | **80/80 pass** |
| TypeScript | `npx tsc --noEmit` | clean |
| Production Worker/RSC build | `npm run build` | succeeds |
| Rendered response | `node --test tests/*.test.mjs` | pass |
| Runtime smoke (all 14 maps, CTF, 3 bots, 300 s) + Warthog drive/turret/run-over | scripted `Match` harness | no NaN positions, no floor desync, captures/vehicles/projectiles behave |

Integration seams fixed and re-verified: the turret yaw is body-relative in
sim/view/net; `NetClient.resyncVehicles` and the local shadow carry
`turretYaw`/`roll`/`pitchBody`; `server/room.mjs` forwards `sprint`/`crouch`/`ads`
and a `reload` edge; the first-person camera applies recoil and crouch eye height;
`server/vehicle.test.mjs` was updated for the rebuilt Blood Gulch spawns.

Unverified / limits: shadows, bloom and procedural textures compile and pass
mocked view tests, but GPU frame pacing still needs a hardware browser playtest
(the CPU fallback intentionally disables them). The pre-existing
`ironfall-megastructure` and `longreach-plateau` maps retain partially
disconnected bot-navigation components (missing return routes on upper shelves);
a bidirectional-link navigation change was attempted and reverted because it let
bots route backward through one-way launchers and tripped the platform-map
traversal test. Pre-existing `@typescript-eslint/no-explicit-any` lint errors
remain project-wide; lint is not part of `npm test`.

## Voice HUD ergonomics and relay reliability - 2026-09-08

- The in-match voice panel now collapses to a compact status pill (`VOICE · MIC
  OFF`, enabled status, or `TRANSMITTING`) so it no longer covers the arena on
  desktop or overlaps the bottom HUD on mobile. Clicking the pill opens the full
  controls with a minimize button. PTT mode shows a `V / TALK` hint in the bottom
  HUD, and the settings dialog documents the push-to-talk binding.
- Transient ICE candidate failures (for example a UDP TURN allocate timeout while
  a TCP relay candidate succeeds) no longer surface as a hard voice error while
  the connection is still establishing. Real connection failures keep their
  message and now include the last candidate error for context.
- The Coturn relay port range was widened from 41 to 201 UDP ports
  (`49160-49360`) to reduce allocation contention for concurrent rooms, and the
  relay was restarted with that configuration.
- Verification: 31 voice controller tests and 4 HUD tests pass, including a new
  test that a `TURN allocate request timed out` candidate error stays quiet while
  connected and appears only as context after a real failure. TypeScript,
  production build, and rendered HTML pass. Both production services and the TURN
  container are active; all public assets load without failures.
- Public browser checks at `1440x900` and `390x844` pass all 15 checks: pill by
  default, open/minimize, voice ready, `V` hold transmitting and release,
  `V / TALK` hint, and no overlaps or horizontal overflow for the pill and the
  open panel. Pointer-locked matches capture mouse events by design, so in-match
  HUD buttons are used in the unlocked fallback state or the lobby.
- Cross-network relay reliability with real restrictive NATs remains unverified.

## HUD layering and responsive scoreboard - 2026-09-08

- Live standings now render in an explicit high-priority centered layer above the
  command/objective panels, with an opaque surface, blur, border, shadow, and
  internal scrolling. The objective remains available when the scoreboard closes
  instead of competing for the same visual layer.
- Responsive sizing keeps the scoreboard inside the safe viewport at desktop and
  mobile widths. It accepts pointer interaction for scrolling and preserves the
  existing Tab scoreboard workflow.
- Browser validation passed KOTH, Domination, and CTF at `1440x900` and `390x844`:
  scoreboard hit testing resolves to the scoreboard above the command panel, all
  panels remain within the viewport, and there is no horizontal overflow or page
  error. TypeScript, production build, and rendered HTML also pass.

## Lobby chat and proximity voice - 2026-09-08

- Lobby chat follows new messages at the bottom, preserves manually scrolled
  history with a jump-to-latest button, and resets across room changes.
- Added explicit opt-in WebRTC voice: hold V/pointer PTT, RMS voice activation,
  receive volume, sensitivity, and visible mic state. Capture stops on disable,
  departure and connection teardown; pending permission requests can be canceled.
  Typing, hidden/blurred windows, menus and spectators suppress transmission.
- Active-match playback is full within 5 units, fading to zero at 30, using fresh
  actor positions even outside the gameplay screen. Pregame lobby audio is uniform.
  Proximity is client-side playback behavior, not an access-control boundary.
- Room-scoped, session-validated signaling has payload/rate bounds and excludes
  spectators. TURN_URLS and TURN_SECRET support one-hour HMAC TURN credentials.
  Coturn is now deployed at `turn.ussyco.de`; the server advertises STUN plus
  expiring TURN credentials. The relay exposes only `3478/tcp`, `3478/udp`, and
  UDP ports `49160-49200`.
- Full suite passed before final compatibility refinements: 252 game tests,
  77 server tests, rendered HTML, TypeScript and build. Subsequent focused voice
  checks passed, including 27 controller tests after the Chromium sink fix;
  TypeScript and final build passed. Both production services were restarted.
- Two fresh public browser clients verified chat scrolling with 25 messages,
  PTT, automatic detection, receive mute, RTC connection, and capture cleanup.
  A real Chromium receive-path failure was fixed using a muted media element to
  activate decoding; audible output still passes through WebAudio proximity gain.
- Final unmodified-app fake-microphone test measured nonzero received WebAudio
  samples (peak RMS 0.3053), zero master output when receive volume was zero, and
  silence after PTT release. Tests used one machine, not restrictive cross-network
  NATs. Audible human quality, live in-match attenuation, and TURN relay connectivity
  remain unverified. Audio is not recorded by this application. Direct peers may
  learn network addresses. Forced relay-only browser validation later confirmed
  relay-to-relay ICE and bidirectional RTP; cross-network audio quality remains
  unverified.

## Arena movement, weapons and team readability - 2026-09-08

- Ground acceleration is now direction-independent, with sharp braking and
  reversal. Projection-based air acceleration preserves momentum with bounded
  steering gain; launcher momentum, jump buffering, and coyote time remain.
  Shared movement continues to run in authority and shadow prediction.
- Fixed free-flight projectiles losing distance to an impact-only clearance
  epsilon. Team-mode self splash now permits self damage/boost without damaging
  teammates. Server input preserves short fire taps between ticks and clears them
  at lifecycle boundaries. Prediction owns cloned nested snapshot state.
- All eight weapons have dedicated detailed geometry and explicit muzzle anchors.
  Muzzle lifetime follows weapon profiles, and pooled mesh traces honor width.
  Team armor, flags, and zones use consistent red/blue colors with I/II markings;
  character accents and FFA appearance remain distinct.
- Fixed unlimited-ammo and rapid wheel switching, expanded editable-input guards,
  and cleared held controls on focus/capture loss. Vehicle HUD exposes enter/exit,
  health, and heat instead of infantry ammo. Online Escape explains lobby behavior.
- Full `npm test` passed: 230 game tests, 71 server tests, one rendered-HTML test,
  TypeScript and production build. `git diff --check` passed.
- Diagnosed public 502s as a stale in-memory manifest referencing removed assets
  after an in-place build. Restarted the web service to restore availability, then
  restarted both services immediately after the final successful build. Both are
  active. In-place builds still require coordinated restart; atomic deployment
  and historical asset retention are not implemented.
- Public Chromium checks at 1440x900 and 390x844 loaded all seven requested JS
  chunks including the dynamic renderer without failed requests or page errors.
  Blood Gulch Team Deathmatch entry, desktop movement, jumping and firing passed.
  Mobile header/command overlap is resolved at the tested size. Close-up team
  skins, touch gameplay, multiplayer latency feel, audio balance, and hardware GPU
  performance are not visually/playtest verified.
- Research: [Quake III movement behavior](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c),
  [fixed timestep](https://gafferongames.com/post/fix_your_timestep/), and
  [game feel](https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient).
  Movement implementation is original; GPL source was behavioral reference only.

## All-arena visual and canyon rebuild - 2026-09-08

- All ten arenas now have individual material and atmosphere palettes, batched
  architectural details, and clearer surface treatment. Island foundations have
  distinct supports, ribs, or rock layers; indoor structures gain panels, vents,
  trim, and reactor details. Launchpad gains runway markings.
- Blood Gulch now uses continuous rolling terrain, irregular enclosing cliffs,
  low opposing bunkers with four walkable roof ramps, clear flag approaches, and
  two vehicle lanes. Cliff strata and team-colored bunker cladding improve identity.
- Fixed overlapping mound geometry, floating traversal pads/targets, and vehicle
  movement ignoring collision-resolved terrain height. Bunkers remain solid with
  accessible roofs, not interiors; launch pads are not instant teleporters.
- Full `npm test` passed: 203 game tests, 65 server tests, one rendered-HTML test,
  TypeScript, and production build. The seeded 300-second Blood Gulch match logged
  16 kills and zero falls. The build retains its large-chunk warning.
- Installed Chromium/Playwright checked the isolated production build at 1440x900
  and 390x844: selection, map setup, and Blood Gulch entry passed with no captured
  page errors or failed requests and no horizontal page overflow. Screenshots were
  inspected. The mobile gameplay command panel partially overlaps the phase label;
  touch gameplay is not supported. SwiftShader performance is not a GPU benchmark.
- This pass was deployed after the build and the web service was restarted so the
  live asset manifest matched the build.

## Blood Gulch map fidelity pass - 2026-09-08

- Rebuilt **Blood Gulch** into a wider, more recognisable canyon arena while keeping it compact enough for bot matches.
- Expanded bounds to `{-42,42,-25,25}` with four-sided cliff walls, sloped north/south hills, and high sniper shelves.
- Added a contested **central mound** with a rocket launcher, plus landmark rock pieces for cover and bot channeling.
- Replaced simple base blocks with **U-shaped fortress bases**: a central keep, rear wall, and side wings framing each flag courtyard.
- Added **rear teleporter boost pads** behind each base that fling players to the opposing side shelves for flanking routes.
- Repositioned the two neutral **Puma** Warthogs and strategic pickups (sniper rifles on shelves, health/armor near bases, etc.).
- Updated focused tests in `game/blood-gulch.test.mjs`, `game/view.test.mjs`, `game/vehicle-gameplay.test.mjs`, and `server/vehicle.test.mjs` for the new layout.
- Full verification passes: **196 game tests**, **64 server tests**, TypeScript, production build, and rendered HTML (**261 automated checks total**).
- Deterministic 5-minute Blood Gulch simulation produced **13 kills, 231 shots, 24 pickups, 25 powers, and 16 respawns** with no falls, confirming bot connectivity on the new terrain.
- Public HTTP and fresh-room WSS checks passed with two flags and two Pumas in
  snapshots. Both production services were restarted. Browser layout checks were
  not performed for that checkpoint.

## Gameplay modes and leaderboards pass - 2026-09-08

- Added authoritative per-player `scoreStats` for CTF flag pickups, returns, drops,
  and captures, plus KOTH/Domination objective time, captures, neutralizations, and
  contest transitions. Continuous objective state remains snapshot-driven while
  progress/score events are bucketed to avoid a per-tick network flood.
- Objective bots now prioritize their mode objective and team combat, divert only for
  critical or immediately useful supplies, and pause steering during authored launch
  flights. Platform-map reverse launch routes and solid-top collision handling prevent
  bots from falling or being snapped onto reactor tops.
- Live standings, results, and recent-match history now keep kills and deaths while
  adding mode-specific metrics: CTF captures/pickups/returns/drops, KOTH hill time/
  captures/contests, Domination zone time/captures/neutralizations/contests, and
  Team Deathmatch team totals. History leaders use the mode's primary contribution.
- Full verification passes: **196 game tests**, **64 server tests**, TypeScript,
  production build, and rendered HTML (**261 automated checks total**).
- Deterministic 30-second simulations across Skybreak, Aether, Ironfall, and Longreach
  produced combat or objective activity in every team-mode combination. Public browser
  checks passed linked assets, responsive layouts, CTF hosting/resume, and mode-specific
  leaderboard columns with no runtime or resource errors. Both production services
  were restarted and remain active.

## Traversal and objective readability pass - 2026-09-08

- Sky-map targeted launchers now derive their authored direction from the actual
  source-to-target link, and the renderer uses that same link for launcher yaw. Pad
  stripes are parented to their launcher, so diagonal slingshots no longer point away
  from their landing route. Existing vertical-only outer trampolines remain explicit
  bounce pads rather than pretending to be cross-platform links.
- KOTH and Domination objectives now render as low-opacity, team-colored capture areas
  with a full-radius footprint, bright perimeter, progress indicator, and center
  emblem. Neutral zero-progress areas stay visible; ownership, capture, and contest
  states remain distinct in WebGL and the software renderer.
- Objective anchors are authored on supported, unobstructed surfaces for every
  canonical map. Raised Exchange/Foundry points use deck height, Ironfall uses its
  middle deck, and island zones stay within their platform footprints.
- The HUD now reports truthful terrain route context and per-zone Domination state
  instead of defaulting to CENTER or aggregate counts alone.
- Full verification passes: **185 game tests**, **61 server tests**, TypeScript,
  production build, and rendered HTML (**247 automated checks total**).

## Polish pass - 2026-09-08

- Added keyboard-accessible focus entry and Tab wrapping for setup, pause, and
  results dialogs. Escape closes setup predictably and returns focus to Match Setup;
  reduced motion now disables crosshair hit rotation.
- Objective progress rings reuse indexed WebGL geometry and update draw ranges rather
  than allocating a new ring every progress tick. The software fallback retains its
  existing geometry rebuild path for compatibility.
- Room input rejects non-finite movement values, reconnecting players and spectators
  receive completed-round results, partial team scores normalize to finite values,
  and malformed persisted history records are ignored.
- Full verification passes: **182 game tests**, **61 server tests**, TypeScript,
  production build, and rendered HTML (**244 automated checks total**).
- Public checks pass for linked assets, responsive selection/settings/HUD layouts,
  CTF setup and Resume, modal keyboard focus/Tab wrapping, and no browser runtime or
  resource errors. Both production services were restarted and remain active.

## Large map and objective modes pass - 2026-09-08

- Added three large arenas: **Sunscar Canyon**, **Ironfall Megastructure**, and
  **Longreach Plateau**. They are registered in the canonical map list, replay
  rotation, solo setup, multiplayer lobby, navigation, renderer, and tests.
- Added **King of the Hill** and **Domination**. Control points use authoritative
  fixed-step scoring, contest/neutralization rules, objective win state, bot routes,
  server events, snapshots, reconnect recovery, and persisted team outcomes.
- Added world-space control rings, progress arcs, beacons, and ownership/contest
  colors. Progress geometry is rebuilt only when progress changes, avoiding a
  per-frame allocation path.
- Reworked the in-match command layer so the player sees their team, match phase,
  score target, map route, current flag/control state, and a mode-specific next
  action. The semantic live region announces objective changes without making the
  full telemetry panel noisy for assistive technology.
- Added objective-aware setup labels, target ranges, map objective coordinates,
  history fields, and regression coverage for all new rules and geometry.
- After the production restart, public browser entry passed on Sunscar Canyon / CTF,
  Ironfall Megastructure / KOTH, and Longreach Plateau / Domination with WebGL and
  nonzero draw/triangle counters. Fresh-room public WSS checks also delivered the
  expected map, mode, flags, and control-zone snapshots.
- Full verification passes: **182 game tests**, **57 server tests**, TypeScript,
  production build, and rendered HTML (**240 automated checks total**).

## Polygon terrain renderer follow-up - 2026-09-08

- Added **Blood Gulch**, a semi-symmetric outdoor CTF canyon with a triangulated
  valley floor, interpolated north/south hills, walkable slopes, high plateaus,
  analytic terrain ray hits, cliff wall faces, central cover, and route-aware
  navigation. Terrain triangles are cached per immutable map and consumed by
  authoritative simulation and renderer geometry.
- Added two neutral **Puma** Warthog-style vehicles. A single living driver can
  enter/exit with `E`, drive using bounded forward/reverse arcade handling, and
  fire paired side-mounted chainguns. Heat, overheat, damage, driver release,
  respawn, CTF flag-carrier restrictions, snapshots, prediction rebasing, remote
  interpolation, WebGL rendering, software rendering, and bot takeover are covered.
- Added focused terrain, map, vehicle, gameplay, renderer, and server edge tests.
  Final verification passes: **170 game tests**, **53 server tests**, TypeScript,
  production build, and rendered HTML (**224 automated tests total**).
- Fixed the terrain-map renderer branch that incorrectly assumed every non-legacy
  map had `platforms`. Blood Gulch now builds its polygon surface mesh and cliff
  mesh independently; the scene regression asserts all 10 surface triangles and
  4 cliff-wall triangles are present.
- Public checks after restarting both services pass for linked assets, existing
  CTF/browser flows, and a live WSS Blood Gulch match whose snapshot exposes two
  `puma` vehicles with full health and two flags. No browser runtime errors or
  failed resources appeared.
- Arena entry now commits a local match only after `setMatch()` completes, keeps
  the RAF loop alive with a visible recovery message after a frame exception, and
  initializes network rendering from the first valid snapshot even before actor
  binding completes. Rebuilding terrain maps releases traversal resources instead
  of accumulating them.
- A ten-cycle headless browser lifecycle check entered and returned from Exchange,
  Blood Gulch, Skybreak Isles, Aether Ring, and Launchpad with nonzero renderer
  counters and no page errors. The managed SwiftShader environment is slow, so
  its wall-clock click timings are not a desktop performance claim.
- Research references: [Gaffer fixed timestep](https://gafferongames.com/post/fix_your_timestep/),
  [Gaffer networked physics](https://gafferongames.com/post/networked_physics_2004/),
  [Unity Wheel Collider concepts](https://docs.unity3d.com/Manual/WheelColliderTutorial.html),
  and [Halopedia Blood Gulch](https://www.halopedia.org/Blood_Gulch).
- Subjective Puma driving feel, chaingun audio balance, and competitive vehicle
  counterplay still require a human desktop multiplayer playtest.
- Added ray-safety coverage for zero-distance visibility, malformed directions,
  invalid ray bounds, invalid fire input, and explosions centered on vehicles.

## Launcher, weapon feel and identity pass - 2026-09-08

- Launcher flights now resolve authored `jumpLinks` into deterministic ballistic
  velocities, allow modest air correction, brake into the intended landing zone,
  and capture descending arrivals within a bounded radius. Regression tests cover
  every island launcher at normal gravity plus `0.75x` and `1.5x` speed settings.
- All eight weapons now carry distinct kick, shot/launch/impact, muzzle, tracer and
  impact-visual profiles. SynthAudio uses those profiles for local and nearby cues,
  preserves pellet deduplication and the voice cap, adds dry-fire feedback, and
  remains safe when muted or reduced motion is enabled.
- Harness profiles are integrated into authoritative movement, resistance,
  ability parameters, favored-weapon handling, bot ranges, weapon selection and
  power-use decisions. Operator profiles add deterministic bot weapon preferences
  and strafe styles without changing the existing roster or Claude compatibility.
- Final verification passes: **143 game tests**, **52 server tests**, TypeScript,
  production build, and the rendered-HTML check (**196 automated tests total**).
- Subjective audio balance, physical launcher feel, and competitive operator/
  harness balance still require human listening and desktop multiplayer playtests.

## Outdoor CTF and network smoothing pass - 2026-09-08

- Added **Skybreak Isles** and **Aether Ring**. Both are much larger than Launchpad,
  use disconnected outdoor platforms over a real void, provide north/middle/south
  routes, and include deterministic long-range boost arcs. Map data tests cover
  deep immutability, bounds, platform coverage, symmetry, route/link metadata,
  safe pickups/spawns, and descriptive map contracts.
- Island movement now returns `null` for uncovered void surfaces, preserves the last
  valid platform position, drops carried flags on fall, emits fall/death events,
  and respawns through normal team-aware spawn selection. Authored jump links are
  included in cached bot navigation; seeded launcher simulations land on platforms.
- The Three.js arena renderer draws individual island slabs, supports, route accents,
  and a deep void instead of a full rectangular floor. Selection previews derive
  their SVG viewBox from map bounds and draw platforms plus launch links.
- Multiplayer inputs now carry monotonic sequence numbers. Rooms acknowledge the
  latest input actually applied for each actor; clients rebase the shadow match and
  replay only unacknowledged inputs. Older snapshots are rejected, and remote actor
  interpolation uses smoothed server simulation time with a 160ms buffer.
- The full suite passes: **135 game tests**, **52 server tests**, TypeScript,
  production build, and the rendered-HTML check (**188 automated tests total**).
- Focused real-WebSocket tests pass for input acknowledgements, prediction replay,
  stale snapshot rejection, room reconnects, spectators, simultaneous rooms, and
  results delivery. Public deployment verification also passes after the service
  restart: both new maps load, CTF flags/team scores initialize, WSS hosting and
  movement remain functional, and no browser errors or failed resources appear.

## Replayability and gameplay pass - 2026-09-08

- 178 game/server tests pass after the combined collision, bot, presentation,
  replayability, map, mode, weapon, and powerup changes. This includes cover
  landings and embedded-state recovery on all maps at normal/low gravity, turbo
  ramp traversal, bot reacquisition and difficulty comparisons, cached-navigation
  isolation, recoil decay, effect/audio bounds, and preset/shuffle/map-rotation tests.
- In the fixed-seed, stationary 20-second firing-lane fixture, Easy dealt 88
  cumulative damage in 31 shots, Normal 418 in 58, and Hard 1,617 in 147. The
  fixture repeatedly replenishes target health to measure cumulative damage;
  these are relative tuning checks, not human win-rate or survival guarantees.
- Nine viewport sizes passed menu/setup/browser/lobby/HUD checks. Browser tests
  exercised all four presets, compatible shuffle, personal result stats, Next
  Arena with preserved rules, and CTF setup on Launchpad with three-capture
  scoring, team assignment, two flags, and resume. The results fixture advanced
  simulation time to the end of the round; it was not a full-duration human match.
- Real host/guest WebSocket browser tests passed movement, a multiplayer jump and
  clear landing, drag aim, capture recovery, chat, host resume, and solo/network
  transitions. Network snapshots preserve effect/recoil lifetimes between frames.
- TypeScript, the production build, and the rendered-HTML test pass (179 automated
  tests total). Both production services were restarted together; public checks
  passed linked assets, presets, WSS hosting, movement, jumping/landing, firing,
  captured relative aim, and host resume, without browser runtime errors.
- Weapon sound quality and competitive balance still need listening/human
  playtesting; no new hardware-GPU benchmark is claimed.

## Content expansion - 2026-09-08

- Added two maps: **Launchpad**, a large symmetric CTF field with red/blue bases,
  four trampolines, and four directional boost launchers; and **Citadel**, a larger
  fortress-lane arena. Map tests cover bounds, objective symmetry, traversal
  metadata, safe pickups/spawns, navigation connectivity, and map-state isolation.
- Added **Capture the Flag** with flag pickup, drop-on-death, return, capture-home
  preconditions, team scoring, objective-aware bots, team starts, snapshots, and
  lifecycle events. Added **Team Deathmatch** with shared scoring and disabled
  friendly fire. New CTF rounds default to three captures.
- Added Grenade Launcher (gravity/bounce splash projectile), Shock Beam, and Flak
  Cannon, expanding the inventory to eight weapons while preserving the original
  five IDs. Added Haste, Overcharge, and Overshield pickups with timed movement,
  cadence, damage, and shield effects. New content has focused contract, balance,
  lifecycle, and combat tests.
- The complete sequential suite passes: **178 game/server tests**, plus the
  rendered-HTML check. TypeScript, production build, and `git diff --check` pass.
- Browser checks pass across nine viewport sizes for the existing menus, room
  browser, lobby, HUD, presets, shuffle, and Next Arena. A dedicated CTF check
  passes Capture the Flag setup, Launchpad selection, three-capture scoring, team
  assignment, flag snapshots, and Resume.
- Production verification is performed after restarting both services so the
  versioned asset manifest cannot point at removed files. Human balance, audio
  tuning, and hardware-GPU performance remain manual validation items.

## Current verification - 2026-09-08

- **128 game/server tests and one rendered-HTML test pass**, including per-operator
  stats, healing limits, respawns, multiplayer loadouts, prediction, and resolution
  scaling. TypeScript and the production build pass.
- Headless Chromium checked menus, settings, setup, browser, lobby, and HUD at
  320x568, 390x844, 667x375, 768x1024, 1024x768, 1366x768, 1440x900,
  1920x1080, and 2560x1080. Operator lists have no internal clipping; all nine
  choices and the action bar fit the tested desktop viewports from 1366px wide.
- Two browser clients against a real isolated WebSocket server verified solo to
  multiplayer transitions, host and guest movement/camera updates, drag aiming
  with capture deliberately denied, host resume without restarting the match,
  neutral inputs while in lobby/chat, chat Escape isolation, real pointer lock
  acquisition/release/reacquisition, and return to solo play.
- The deployed public URL was checked after restarting both services. Linked
  CSS/JavaScript assets loaded successfully. A separate verification room exercised
  public WSS hosting, Claude's 115 maximum health and 8.2 m/s movement, WASD camera
  movement, capture, aiming, and the host Resume control. The test explicitly left
  its room after completion; no application runtime errors were observed.
- Captured aim on the public site used an injected relative mouse event: headless
  Chromium's absolute mouse automation emitted cancelling pointer-warp deltas.
  This verifies the input handler and network/render path, not physical mouse feel
  or a hardware GPU performance benchmark. Operator balance remains initial tuning.

The sections below preserve historical verification checkpoints.

Baseline MVP verified 2026-09-05; expansion evidence appears below. The MVP is implemented and playable. Automated checks pass and the local browser match loop was exercised with real inputs. The normal hardware WebGL2 path could not be visually benchmarked in this environment; the browser uses the implemented CPU compatibility renderer instead. These are explicitly separate claims.

## Automated evidence

- **12/12 simulation tests pass:** all 20 character/harness pairs and runtime correction; spawn protection; armor and Guardrail; one-time death/kill attribution; suicide scoring; frag-limit lock; time-limit ties; ray obstruction; open-line hits; pulse damage/knockback/cover; power duration and cooldown; ammunition/fire-rate rules; swept rockets and covered/self splash; equal diagonal movement; jump/landing/wall collision; climbing both ramps; connected navigation graph; pickup usefulness; clean match reset; complete deterministic four-bot match.
- Final deterministic match reached the stop condition at **79.85 simulated seconds**, with **760 shots, 51 deaths, 42 pickups, 34 powers and 53 total spawns** (including the five initial spawns). These are simulation observations, not frame-rate measurements.
- **TypeScript passes:** `npx tsc --noEmit`. The dormant starter database helper has explicit optional binding typing; no database is provisioned or used.
- **Production build passes:** the Sites build helper completes the client and Worker bundles. The only relevant bundle warning is the large Three.js chunk; this is not a failed build.
- **Server response test passes:** bundled Worker serves HTTP 200 HTML with TOKEN ARENA selection content and no starter development metadata.

## Browser evidence

The managed Chrome browser has WebGL disabled (GL_VENDOR / GL_RENDERER reported Disabled). The software renderer consumes the same Three.js scene, cameras, geometry and models; it does not substitute fake gameplay.

Real clicks and keyboard inputs verified:

- Fresh launch reaches selection and the renderer enables Enter Arena.
- All five characters enter a five-actor match. Claude auto-equips Claude Code and the other three harness buttons disable. The full compatibility matrix is also tested below the UI.
- WASD changes world position, Space gives positive vertical velocity and airborne height, mouse movement changes yaw/pitch, and actual pointer capture reports active.
- Q activates Claw Burst and advances the displayed cooldown. A quick click is buffered to the next simulation step; player shot count increases.
- Escape pauses and releases the pointer. Simulation time remained unchanged between separated paused-state reads; explicit Resume resumes it.
- Audio mute toggle and sensitivity slider accept interaction. Mute persisted when returning to selection. Subjective sound quality/listening was not verified.
- Bots visibly move and fight, kill feed and health update, the human dies and respawns, and match counters record pickups and powers.
- A complete observed browser match ended at about **01:13**, with **Meta 15, Claude 13, Qwen 12, Grok 9, human 0**. This was a mostly stationary observer run after control checks, not a claim of winning a human playtest. A subsequent small bot-perception correction was covered by the final deterministic simulation run.
- Results displayed the correct winner. Play Again reset time to 0, all frags/deaths to 0, projectiles to 0, and pickup/power counters to 0, with five initial actors. Return to Loadout worked; another four operator-start/pause/selection cycles also completed.
- Menu/HUD and original arena/robot/weapon geometry were visually inspected. No blocking application exception remained after the compatibility renderer was installed. Browser-extension metadata errors are separate from application logs.

## Performance observations and limits

Observed software-rendered gameplay snapshots ranged approximately **11–57 FPS** at the browser's roughly **1363×936 viewport**, with a brief transition sample around 5 FPS. The compatibility renderer uses an internal 0.85 resolution scale. This is a variable cloud CPU observation, not a sustained benchmark or a 1080p desktop GPU result.

The requested **60 FPS at 1080p** remains a target. Hardware details and hardware WebGL performance were unavailable, so no GPU benchmark is claimed. The GPU path uses Three.js 0.185.1, original low-poly models, a pixel-ratio cap of 1.5, and no postprocessing.

## Known limitations / unverified checks

- CPU rendering uses painter sorting, so intersecting surfaces and large floor triangles can show depth-order artifacts. WebGL2 is the preferred renderer; the fallback prioritizes continued play when WebGL is disabled.
- All weapons and powers have consequential logic tests, but exhaustive human-controlled weapon pickup/aim/fire and visual expiry checks for every combination were not completed in the cloud browser.
- Both ramp ascents and collision boundaries were tested in the shared controller; a manual human traversal of every map edge was not completed.
- One difficulty, simple waypoint routing and occasional recovery turns are deliberate prototype behavior. Fine competitive bot balancing is future work.
- Several rematches/selection cycles verified reset behavior. Deep heap profiling, long-duration soak testing and exhaustive listener-count instrumentation were not performed.
- Audio initialization and mute logic are implemented; audible balance is not listening-verified. Touch gameplay is not implemented; the interface states the desktop requirement.
- At the baseline MVP checkpoint, no online multiplayer, persistence backend, extra maps, progression or post-MVP content was built. The authorized expansion below supersedes the content restriction.

## Handoff gate

The baseline MVP checkpoint was complete. The runnable game, specification, plan and README are provided, with the remaining hardware and exhaustive manual validation limitations disclosed. Do not label those unverified checks as passed. A desktop hardware playtest is the next validation step, not permission to begin the post-MVP roadmap.


## Authorized content expansion 0.2 — 2026-09-06

The expanded source includes nine operators, seven harnesses, five weapons and three selectable arenas. Added operators are Gemini, DeepSeek, Mistral and Kimi; harnesses are Codex (healing), Cline (collision-aware dash) and Roo Code (line-of-sight slowing field); weapons are Scattergun and Plasma Driver; arenas are Crosswire and The Foundry.

- **20 simulation tests pass:** the original 12 plus eight expansion tests cover all 63 requested character/harness pairs (57 valid loadouts, with incompatible Claude choices corrected), healing caps/cooldowns, dash distance and cover, slowing/expiry/death cleanup, scatter pellet damage and one-shell cost, plasma impacts, map navigation, pickups, match completion and independent map state.
- All navigation graphs connect: Exchange 95/95 nodes, Crosswire 77/77, Foundry 84/84. Deterministic matches finish on all three maps, with shots, kills, pickups, powers and respawns observed.
- TypeScript, production build and the rendered HTML test pass (21 automated test cases in total).
- Browser inspection verified the expanded selection layout, Gemini preview, new harness controls, three arena radio options and five weapon entries. Crosswire selection was confirmed through the radio control. New power and weapon mechanics are verified in simulation; exhaustive manual playtesting of each addition is still pending.
- Hardware WebGL performance remains unverified. The baseline CPU renderer limitations still apply. No online multiplayer or progression backend is introduced.


## Custom matches 0.3 — 2026-09-07

- **34 simulation tests pass** (20 existing, nine configuration and five multi-human tests). New evidence covers malformed saved configuration, per-match isolation, exact counts from zero through eight bots, solo timer completion, Instagib protection/one-hit behavior and power restrictions, locked/unlimited mode inventories, spawn resets, configured scoring and respawn delay, damage/life-steal limits, cooldown modifier, gravity/speed effects, difficulty-dependent reaction/aim/firing cadence, human actor creation via `humanCount`, per-actor look/fire/movement/weapon inputs, idle humans never invoking bot AI, mixed human/bot determinism and the legacy single-input step shape.
- All **16 game mode × bot difficulty combinations** complete deterministic eight-bot matches with shots and kills and finite actor state.
- **TypeScript, production build and rendered HTML response test pass**; 30 automated test cases total. The response test checks that game setup controls are included in server-rendered content.
- Source review confirms FOV updates the Three camera projection, weapon visibility controls the first-person group, and crosshair/FPS preferences reach the HUD. Local storage input is normalized before runtime use. These are code checks, not manual browser observations.
- No browser or GPU benchmark was performed for this configuration pass. Larger matches may cost more CPU; the inherited renderer limitations still apply. UI interaction, persistence across real browser reloads, visual layout, and subjective difficulty balance should receive a desktop playtest.

## Local multiplayer 0.4 — 2026-09-07

- **15 server tests pass** (12 room + 3 real-WebSocket E2E). Room tests cover host rules, config clamping, per-peer actor slots and names, remote look/fire/events deltas, one-shot jump/power edges, timer results, disconnect idle, rematch, plus the new reconnection suite: seat held during grace with identity/seat/inputs restored on token reattach, grace expiry converting the seat to a `· BOT` and migrating host duties, immediate bot handoff on explicit leave, and host restoration for a reconnecting host inside grace. The E2E tests play full matches to results over real sockets; one drops a NetClient mid-match and reconnects it to the same seat (actor id preserved, prediction resynced, results received).
- **38 game tests pass**, including the three shadow-prediction tests and a token persistence test (issued on `welcome`, stored per server URL, reused across instances, cleared on explicit leave).
- TypeScript, production build and the rendered HTML test remain green.
- Two headless demo clients were observed on this machine playing a live match (deaths, respawns, frags, and snapshot streams on both connections). A live prediction measurement showed the shadow leading server truth by ~0.11 units on average (~one 60Hz tick of travel) and converging on each snapshot.
- The browser UI (lobby, host controls, net HUD, results) compiles and is exercised through the NetClient integration test; manual browser playtesting of the network match, interpolation feel, prediction feel, and the solo-vs-net mode switching still requires a desktop browser on this machine.

## Concurrent rooms, spectator mode and match history 0.5 — 2026-09-07

- **37 server tests pass** (12 room + 7 spectator + 6 registry + 6 history + 6 real-WebSocket E2E). The room suite is unchanged; the new spectator suite proves no-seat/no-host joins, player-limit exemption, `humanCount` exclusion, host/start rejection, ignored gameplay inputs, snapshot/event/results delivery and spectator token reattach; the registry suite covers create/join/list summaries, collision-checked 4-letter codes, empty-room retirement and cross-room tick/expire/drain drivers; the history suite covers entry shape, frag vs time endings, JSON file round-trip in a temp directory, 50-entry cap enforcement, no file writes without an injected path, and a completed `Room` match recording into the shared history.
- New real-socket E2E tests: two rooms play simultaneously to results with per-room broadcast scoping verified (room 2's players never see room 1's snapshots), a spectator receives snapshots, event deltas and results across a full match, and a `history` query returns the completed match entry (instagib, frag ending, four recorded players).
- **38 game tests pass**, untouched. TypeScript, production build and the rendered HTML test remain green.
- The room browser UI (join/WATCH/create, lobby room code, recent-matches panel) compiles and is exercised through the NetClient integration tests; manual desktop-browser playtesting of the browse screen, spectator camera-follow view, and history panel styling still requires a browser on this machine.

## Room chat and multiplayer fixes 0.6 — 2026-09-07

- **48 server tests pass** (12 room + 7 registry + 7 spectator + 6 history + 5 chat + 11 real-WebSocket E2E). The registry suite gains the regression that `expireAll` retires abandoned on-demand rooms while `local` persists; the five chat unit tests cover sanitization (control chars stripped, trimmed, 200-char cap), empty-text drops, the per-peer 300ms rate limit, unknown-peer ignoring, and spectator chat delivered as a room broadcast.
- New real-socket E2E tests: create always mints a fresh room even when the client carries a stored `roomId` (a second fresh socket lists it); a NetClient that drops after creating reattaches to its room via the stored token and chats; an abruptly abandoned room disappears from `list` after grace while `local` persists; create releases the previous room seat (no zombie peer lingers in the old room, which is then retired); and chat is room-scoped — every peer and spectator in the room receives it, a client in a different room and a non-member receive nothing (the non-member gets `not in a room`), and chat flows during a live match.
- **38 game tests pass**, untouched. TypeScript, production build and the rendered HTML test remain green.
- The chat UI (lobby panel under the player list, in-game overlay opened with T/Enter) compiles and is exercised through the NetClient chat test; manual desktop-browser playtesting of the overlay layout, key handling and spectator chat still requires a browser on this machine.

## Menu cleanup 0.7 — 2026-09-07

- Selection screen reorganized around game-menu best practices: identity first (operator, live preview, harness), match rules and arena behind a `MATCH SETUP` dialog (kept in the DOM and CSS-hidden so the server-rendered content is unchanged), and a persistent sticky action bar with one dominant primary action (`ENTER ARENA`) plus `PLAY ONLINE` / `DISCONNECT`, `MATCH SETUP` and settings gear.
- Progressive disclosure: the multiplayer panel and `ws://` server-address input left the selection screen and became a compact row in the room browser with a `QUICK JOIN` shortcut; Escape closes the setup dialog and settings panel; modals fade/scale in at 200ms.
- **All automated gates remain green**: 38 game tests, 48 server tests, typecheck, production build and the rendered-HTML test (which still finds MATCH SETUP, Instagib, Rocket Arena, Full Arsenal, Bot count, Bot difficulty, Your callsign and Movement speed in the server-rendered HTML). Manual desktop-browser playtesting of the new layout and modal flows is still pending on this machine.
