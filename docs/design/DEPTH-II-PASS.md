# Depth II pass and the vehicle model pack

**Date:** 2026-09-20
**Scope:** a second broad pass across gameplay objectives, audio dynamics,
readability graphics, accessibility/input and menus — plus the four
`asset-workshop` vehicle model PRs (Hornet, Titan, Scout, Transport) integrated
into the renderer. Companion to [DEPTH-PASS.md](DEPTH-PASS.md) and
[QOL-PASS.md](QOL-PASS.md).

## Vehicle model pack

Four open PRs (#2-#5) each replaced one vehicle's silhouette in `game/view.mjs`:
a TIE/X-wing hybrid Hornet, a tracked Titan siege tank, a recon Scout buggy and
a six-wheel Transport APC with a twin turret. Integration notes:

- **WebGL-only dedicated models.** The four builders are used when the WebGL
  renderer is active; the software renderer keeps the previous compact shared
  hull plus the per-kind silhouette kits, so the CPU path's draw calls and
  triangle budget are unchanged. Puma keeps its pinned hull, accessories and
  guns on both renderers.
- **Batching.** The raw builds produced 200-600 meshes per vehicle. A shared
  `batchVehicleModel` pass merges each container's stationary meshes into one
  mesh per material (visiting the root, wheel groups, turrets and wings) while
  leaving animated parts intact: wheel groups still spin, turrets still yaw,
  and gun mounts/barrels/muzzle flashes are never merged. Result: Hornet 201→53
  meshes, Scout 315→29, Transport 601→52, Titan already batched at 86.
- **Contracts kept.** Every model keeps `userData` `{kind, vehicle, wheels,
  turret, barrels, guns, flashUntil, color}` and the authored ground/hover
  clearance (the new Hornet hull is shifted +0.72 m to match the compact model's
  landing clearance). Muzzles stay at the simulation's authored positions.
- Tests: per-kind dedicated-model assertions (names, wheels/turrets/guns,
  batched mesh bounds, distinct silhouettes), software-kit coverage retained,
  and a ground/hover clearance pin. The Puma pins are untouched.

## Objectives and vehicles

- **CTF flag relay + carrier contest.** A carrier's interact tap passes the flag
  to the nearest living same-team actor on foot within 2.5 m (deterministic:
  distance then id) or drops it at their feet with a 1 s re-pick lock; captures
  are blocked while a living enemy holds the home stand, with a bucketed
  `flag-contest` beat and `flag-pass` events.
- **Payload defender contest** credits defenders standing in a contested cart
  ring with `objectiveTime` and emits one `payload-contest` per contest.
- **Passenger field repair** lets riders patch the hull at the same rates the
  driver uses, sharing the throttled `vehicle-repair` heartbeat.
- **Horde upgrades** grew from the five powerups to nine idempotent run
  upgrades (vitality, weapon promotion, coolant cooldown, resupply sentry).
- **VIP escort bots** follow the payload-bot order pattern: escorts hold a ring
  at 60% of the escort radius and hunters converge on the VIP/beacon.

## Audio

- **Remote actor footsteps and landings**: a bounded per-actor stride planner
  (existing `strideFrequency`/`advancePhase`, match-time deltas, 20 m gate,
  two remote steps per frame, deterministic seeds) plays panned, attenuated
  steps for other actors.
- **Result beat**: `sting(outcome)` now also fires the announcer's victory/defeat
  take, and `recordSting()`/`noteRecord()` expose the already-written `award`
  music response with a bounded fallback.
- **Crowd ambience** for race and soccer: a continuous noise/LFO layer driven by
  nearby vehicles and race/soccer phase, silent at zero.
- **Cue coverage** for the new objective beats plus a `setMenuTab` forward so
  the tested menu ornaments reach players.

## Readability graphics

- A pooled follow marker tracks the actor the camera is on (manual follow,
  spectator target or the local spectate director) and a killer bracket during
  the kill-cam; both hidden by default, static under reduced motion.
- The flag carrier gets a mini banner on their model; contested zones pulse and
  keep an owner mark; the payload cart shows checkpoint ticks and push/contest/
  delivered state on its existing rings.
- Effects-quality leftovers: explosion smoke and low-health smoke follow the
  particle scale, muzzle lights are tier-sized (2/3/4) and prefer nearby
  flashes, and tracer scaling now covers rail/shock/vehicle/alt-fire.

## Accessibility, input and menus

- **Scoreboard semantics**: a real table grid with column headers, cells, a row
  header and `aria-current` plus an sr-only `YOU` on the local row — no class or
  CSS changes.
- **Subtitle options** (size, background, position) and **hold-vs-toggle**
  preferences for ADS, crouch and sprint, all defaulting to the shipped
  behavior and staying within the 44 px and reduced-motion contracts.
- **Per-zoom ADS sensitivity**, **keybind JSON export/import**, and live-region
  demotions for the churning readouts (Operations Director bonus, demo free
  speed, the duplicate command-board chip, mode detail, update banner).
- **Audio host wiring**: kill-cam/spectator mix profiles, menu-tab ornaments and
  the local result sting/announcer now reach the engine.
- **Theater/progression**: demo winners read RED/BLUE with an explicit
  `winnerTeam`, bookmarks persist in demo metadata, retention can keep-N or
  cap-MB, a copy-summary action exists, the next three unlocks surface on
  selection/results, the Arsenal gained a weapon comparison table, and Help has
  a filter. Personal bests (`newPersonalBests`) produce `NEW RECORD` award chips
  and captions cover the new objective beats.

## LATTICE wiring

A player report ("LATTICE vehicles are invisible, and other things feel
unwired") led to a full audit and three fixes:

- **Depot loaners now get models.** LATTICE spawns its vehicles at runtime from
  the depot traversal layer, after `setMatch`; `updateVehicleModels` now runs a
  cheap roster gate and calls `syncVehicles` only when a live vehicle id is
  missing a model (or stale models remain), so late loaner spawns appear,
  recalls are disposed, and unchanged frames never rebuild.
- **The silent depot loop now talks.** `cocs-depot-vehicle-spawn` gets a
  `LOANER READY` banner plus friend/enemy earcon variants, and depot purchases,
  terminal sabotage, sapper cuts, siphons, scans, role deploy/loss/retire/rally/
  repair/spot and the prime beats all gained bounded sound + caption + banner
  rows (one voice per event, per-team repeat windows, distinct priorities).
- **Team FLUX is a player lever.** The PvP command readout now renders
  REINFORCE cards for the rung-legal roles and a SCAN card, with cost and a
  single disabled reason each, dispatched through the authoritative
  `spendCocs`/`net.economy` paths (and local practice now accepts the page's
  `verb` shape). NEGLECT — the authored comeback meter — is fed real
  commander/order-contribution signals instead of `false`, is exposed through
  the economy view, and renders as a `NEGLECT n · NOMINAL/DEGRADED/CAPPED`
  chip. Spectators get the read-only readout only: the order strip, board
  button and purchase strip are hidden and spectator queues are drained, so
  spectating can no longer swallow input or grow unbounded.

## Default graphics recipe

The Graphics Lab ships an authored default look instead of all-off: the
player's electric/contrast/hatch world stack plus a circuit-pixel weapon stack
and an ink-contour bot stack (mix 0.825057562220778, palette `electric`,
enabled). `game/graphics-lab.mjs` exports the frozen `GRAPHICS_LAB_DEFAULT` and
`defaultGraphicsLab()`; `useGraphicsLab` hydrates from it when storage is empty
or unreadable (saved recipes still win), and the lab panel gained a `RESTORE
DEFAULT LOOK` action alongside `RESET ALL / OFF`. `normalizeGraphicsLab({})`
stays all-off so the normalizer pins are unchanged.

## Verification

Counts and deployment records are in `docs/VERIFICATION.md`; focused suites:
`game/particle-logo.test.mjs`, `game/follow-marker.test.mjs`,
`game/feedback-remote.test.mjs`, `game/cocs-spend-surface.test.mjs`, the
extended vehicle/economy/mode/bot suites, the new scoreboard/config/captions/
records pins, and the graphics-lab default-recipe tests, plus a LATTICE
browser check confirming depot loaners exist in the sim and the FLUX/NEGLECT
surface renders.

