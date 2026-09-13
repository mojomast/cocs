# COCS — Colosseum Of Competitive Slop — development plan

> **Historical baseline — see [VERIFICATION.md](VERIFICATION.md) for current status.** This plan records the original MVP checkpoint and the authorized expansions up to the v1.4-era content ceiling (five weapons, three arenas). It is retained as history and is not a description of the current build.

MVP implementation complete. Automated gates pass. Browser gates passed on the software compatibility renderer, with the explicit limits in VERIFICATION.md. Hardware WebGL2 visual/performance validation remains unverified in this environment; it is not represented as passed. This opening table records the original MVP checkpoint; authorized expansions are recorded below.

| Step | Depends on | Delivered scope | Evidence | Status |
|---|---|---|---|---|
| 0 | — | Complete specification and contracts | SPEC.md maps the requested game and labels future scope | Complete |
| 1 | 0 | Arena, fixed-step movement, collision, camera | Equal diagonal cap, collision, jump and both ramps tested; real mouse/keyboard input | Implemented; logic and browser input verified |
| 2 | 1 | Pulse, bot combat, damage/death/respawn | Damage/scoring tests; browser combat and respawns | Implemented and verified |
| 3 | 2 | Timer/frag end, pause, results/rematch | Time/tie/reset tests; full browser match ends at 15; replay and pause | Implemented and verified |
| 4 | 3 | Five models/selection and compatibility | 20-pair compatibility matrix; all five operators enter via UI; Claude locks to Claude Code | Implemented; shared validation verified |
| 5 | 4 | Four powers, three weapons | Cover, direct/splash, armor, cooldown, ammo tests; Q and fire input observed | Implemented; core verified, exhaustive visual checks limited |
| 6 | 5 | Four bots, navigation, pickups, ramps | Entire graph connected; deterministic match and live browser match; pickups/powers/respawns occur | Implemented and verified |
| 7 | 6 | Feedback/audio/settings/polish | Production build, typecheck, server response; menu and HUD inspected; settings and mouse capture exercised | Implemented; GPU and listening checks unverified |
| STOP | 7 | Handoff | README.md, SPEC.md, VERIFICATION.md; no roadmap implementation | MVP feature work stopped; verification limits disclosed |

## Implementation adjustments

The managed browser has WebGL disabled. A CPU renderer was added to consume the same Three.js scene and simulation so the game remains playable in that environment. It is a compatibility path with approximate depth sorting, not a replacement for the normal WebGL2 renderer. No gameplay is stubbed for this path.

Navigation validation caught two unreachable nodes; they were repositioned and the graph connectivity gate now passes. Pickup routing now continues from the nearest graph node to the actual pickup. A short-click buffer prevents firing input from being lost between simulation ticks. Development hot reload safely returns to selection rather than retaining a stale HUD with an empty runtime.

## Remaining verification, not new features

Run a manual full match on a hardware-accelerated desktop at 1920×1080, inspect all first-person weapons and each active effect, listen to sound balance, and confirm sustained frame pacing. Deep heap profiling across many matches is not completed. These are validation gaps, not claims that the features have passed on that hardware.

# Authorized expansion 0.2 — 2026-09-06

The user's new request explicitly authorizes roster, harness, weapon and arena expansion beyond the original MVP gate.

| Milestone | Dependency | Outcome | Verification status |
|---|---|---|---|
| Preserve baseline | Original MVP commit | Original complete source archived before editing | ZIP integrity checked |
| Map ownership | Preserve baseline | Instance-specific collision, nav, supplies and renderer geometry | Connected graphs and independent-map tests pass |
| Roster and harnesses | Shared data | 4 new identities, 3 new powers; Claude rule retained | 63 combinations and new power rules pass |
| Weapons | Shared combat | Scattergun and Plasma Driver; five-slot ammo/switching | Pellet, ammo, projectile, impact and wall tests pass |
| Arenas and UI | Map ownership | Crosswire and Foundry, map selector, expanded scrolling lists | All map simulations complete; browser observations in report |
| Deliver expansion | Above | Updated source, docs, build and expanded ZIP | No additional roadmap content added |

Current totals: nine characters, seven harnesses, five weapons, three arenas. The earlier table describes the completed v0.1 milestone, not the current content ceiling.


## Authorized configuration expansion 0.3 — 2026-09-07

- Complete: four game modes; per-match normalized settings; 0–8 bots; four difficulty presets; configurable limits, respawn and starting weapon; six types of modifiers.
- Complete: persistent callsign and display controls; crosshair preview; immediate FOV, weapon visibility and FPS settings; reset actions; dynamic HUD and solo results.
- Verified: 34 simulation tests including all 16 mode/difficulty combinations at eight bots, plus per-actor multi-human input coverage. TypeScript, build and rendered response checks pass. Browser interaction and hardware performance of this expansion remain unverified.
- Delivered: updated source and ZIP; saved Site version. Publishing the existing Site remains a separate user action.


## Multi-human engine groundwork 0.4 — 2026-09-07 (P5 foundation)

First authorized step toward the separately scoped P5 multiplayer, hosted from this machine (no cloud platform). Engine, server, browser client, prediction/reconciliation and reconnection are complete; matchmaking/accounts remain.

| Milestone | Outcome | Verification status |
|---|---|---|
| Per-actor inputs | `Match.step(dt, {inputs: {id: ...}})` drives any actor; legacy `step(dt, input)` still drives actor 0 | 34 game tests pass |
| Human slots | `humanCount` 1–8; humans have `bot: null` and never run bot AI; difficulty fire delay applies to bots only | Creation and idle tests pass |
| Determinism | Mixed human/bot matches reproduce exactly under identical input traces | deepEqual snapshot test passes |
| Room logic | `server/room.mjs`: host rules, config normalization, per-peer actor slots, 60Hz authoritative tick, one-shot jump/power edges, event deltas, 20Hz snapshots, results, rematch, disconnect idle | 12 room tests pass |
| Transport | `server/game-server.mjs` HTTP+WebSocket on this machine (`npm run server`, port 4000); `tickDt` acceleration for tests; multi-room dispatch with per-room broadcast scoping | 6 real-socket E2E tests pass |
| Browser client | `game/net.mjs`: 60Hz inputs, snapshot interpolation at 120ms delay, event/audio pipeline; `app/page.tsx` lobby, host controls, net HUD/scoreboard/kill feed/results; `ArenaView` keyed by actor id | NetClient E2E test passes; typecheck/build green |
| Prediction + reconciliation | Local shadow `Match` stepped with sent inputs renders your own actor instantly; every snapshot reconciles it to server truth; remote actors stay interpolated | 3 shadow tests pass; live lead measured ~0.11u on localhost; NetClient E2E asserts predicted own actor |
| Reconnect + host migration | Session tokens persisted per server URL; dropped seats held for a 20s grace; token reattach restores identity, seat and inputs mid-match (server re-sends `start`); grace expiry or explicit leave hands the seat to a `· BOT` and migrates host duties; reconnected hosts keep host inside grace | 4 room tests + token storage test + drop-and-reconnect E2E pass |
| Room registry | `server/rooms.mjs`: one default `local` room plus on-demand rooms with collision-checked 4-letter codes; `list` summaries for the browser; tick/grace/drain across all rooms; empty on-demand rooms retired | 6 registry tests pass |
| Spectator mode | Peers join with `spectate: true`; no actor slot, excluded from `humanCount` and player limit, cannot host/start, inputs ignored, but receive event deltas, snapshots and results; lobby tags spectators | 7 spectator tests + spectator E2E pass |
| Match history | Completed matches recorded as `{id, roomId, mapId, mode, fragLimit, timeLimit, endedBy, duration, leader, players}`; persisted atomically to a JSON file (default `server/history.json`, capped at 50, path injectable, loaded at boot) | 6 history tests + history E2E pass |
| Room browser UI | `NetClient.list()/create()`, room code in the lobby header, browse screen with join/WATCH/create and a recent-matches panel reusing scoreboard styling | Typecheck/build green; browser flow compile-tested |
| Demo | `npm run demo` headless client joins, hosts and plays to results | Observed on this machine |
| Local verification | test:game 38/38, test:server 48/48, typecheck, production build, rendered response test | Complete |

Remaining for fully polished multiplayer: matchmaking, accounts/persistence, and manually playtested spectator camera switching.

## Menu cleanup 0.7 — 2026-09-07

| Milestone | Outcome | Verification status |
|---|---|---|
| Identity-first selection screen | Operator/harness/preview grid only; match rules and arena moved behind a CSS-hidden `MATCH SETUP` dialog (SSR content unchanged) | Rendered-response test green |
| Persistent action bar | Sticky summary + dominant `ENTER ARENA`, `PLAY ONLINE` (room browser; DISCONNECT while connected), `MATCH SETUP`, settings gear | Typecheck/build green |
| Progressive disclosure | Server address + QUICK JOIN tucked into the room browser; Escape closes dialogs; 200ms modal transitions | Typecheck/build green |
| Local verification | test:game 38/38, test:server 48/48, typecheck, production build, rendered response test | Complete |

## Room chat and multiplayer fixes 0.6 — 2026-09-07

| Milestone | Outcome | Verification status |
|---|---|---|
| Create always mints a fresh room | `create` no longer routes into an existing or persisted room; creator becomes host of a new 4-letter room; `NetClient.create` sends `roomId:''`; browse refreshes after create | Fresh-socket E2E + reconnect-to-created-room E2E pass |
| Abandoned rooms retired | `expireAll` runs `removeIfEmpty` after expiring seats; `local` never removed | Registry test + abrupt-disconnect E2E pass |
| Room chat | Sanitized (control chars stripped, 200-char cap), rate-limited (300ms per peer) `{type:'chat'}` broadcast to the room only; spectators chat; bounded client `chatLog` + `onChat`; lobby panel + in-game overlay (`T`/`Enter` opens, `Enter` sends, `Escape` closes); solo untouched | 5 chat unit tests + room-scoping/live-match E2E pass |
| Local verification | test:game 38/38, test:server 48/48, typecheck, production build, rendered response test | Complete |

## Combat feel, Warthog, arena rebuild and visuals 1.3 — 2026-09-10

Five parallel research subagents (Quake/Source movement and gunfeel, browser-shooter netcode, the Halo M12 Warthog, Blood Gulch/CTF level design, Three.js rendering budgets) produced a prioritized backlog. Six implementation subagents then worked in two non-overlapping waves (maps/renderer/vehicles/net, then core sim/input), with cross-agent seams reconciled and verified.

| Milestone | Outcome | Verification status |
|---|---|---|
| Movement rewrite | Quake/Source ground friction (6) + acceleration (10), air acceleration (1.0) with strafe acceleration, terminal cap, variable jump + apex hang (`gravity 26`, `jump 8.6`), sprint (×1.375), crouch (×0.4, eye 1.45→0.95), slide + slide-hop; coyote/buffer preserved | `arena-movement` tests + full game suite pass |
| Gunplay depth | Authoritative recoil aim-punch with per-weapon spray patterns, bloom growth/recovery, ADS, reload/auto-reload, holster/raise timing, retuned recoil/bloom/reload data; Pulse TTK ≈0.81 s | `weapon-simulation`, `gameplay`, `powerups` tests pass |
| Warthog | Recognizable M12 model (cage, bed, turret, corner tires) + lateral-slip drift, handbrake, boost, suspension/slope alignment, body roll/pitch, 360° turret, run-over splatter, paired-muzzle heat | `vehicles`, `vehicle-gameplay`, server vehicle tests pass |
| Blood Gulch rebuild | 160×70 m box canyon: central hill, two sniper ridges, two wall caves, multi-route bases with roof teleporters, warm sandstone palette, two Warthogs | `blood-gulch` tests pass; runtime CTF smoke clean |
| New CTF maps | Frostline, Derelict Station and Ashen Rift (three-lane, readable bases, flank routes, vehicles where themed) registered and navigation-connected | `maps` tests + runtime smoke pass |
| Visual overhaul | Directional shadows, PMREM IBL environment, procedural FBM albedo/roughness/normal textures, vertex/triangle variation, gradient sky + instanced mountains/scatter, tiered bloom/vignette/SMAA | `view` tests, typecheck and production build pass |
| Input + HUD | Sprint/crouch/ADS/reload bindings through a shared `controlsFromState` on solo and net paths; spread crosshair, hitmarker, reload bar, posture chip, low-ammo warning | `input`/`hud` tests pass |
| Netcode | Adaptive interpolation delay ~100 ms (90–160), jitter-adaptive snapshot buffer (4–16), server snapshots 20→30 Hz, reload edge + stance flags forwarded | `net`/`room` tests pass |
| Integration seams | Body-relative turret convention matched between sim/view/net; net `resyncVehicles` and local shadow carry turret/roll/pitch; server forwards sprint/crouch/ADS/reload; camera reflects recoil/crouch | Full game + server suites green |
| Local verification | test:game 293/293, test:server 80/80, typecheck, production build, rendered response test; runtime CTF smoke on all 14 maps | Complete |

Remaining known limitation: the pre-existing `ironfall-megastructure` and `longreach-plateau` platform maps have partially disconnected bot-navigation components (their upper shelves lack return routes), so bot CTF can stall there. This predates 1.3 and needs map-specific return links, not a navigation-engine change (a bidirectional-link attempt routed bots backward through one-way launchers and was reverted).

## Feedback, bot flow and platform-map connectivity 1.4 — 2026-09-10

| Milestone | Outcome | Verification status |
|---|---|---|
| Combat feedback HUD | Floating damage numbers, directional damage indicator, kill/death banner, weapon/ammo panel with reload state, and a match/objective announcer, all from existing snapshot/event data with pure `game/hud.mjs` helpers | 25 HUD/input tests pass; typecheck + build green |
| Renderer feel | Dynamic FOV (sprint/ADS), pooled muzzle lights, low-health overlay, bounded camera shake; shared material/geometry caches reduce per-model allocation | 29 view/feedback tests pass; build green |
| Bot engagement and objectives | Scan range scales with map size and difficulty (per-actor cached), purposeful destinations replace idle roam, CTF defenders hold a post and attackers vary approach, long rotations detour to vehicles | `expansion`/`gameplay`/`core`/`stats` tests pass; large-map smoke yields kills |
| Platform-map return routes | Ironfall and Longreach gained physical up/down launcher pairs; both nav graphs fully connected in both directions | New connectivity assertions in `maps`/`expansion-maps` tests pass; runtime smoke no longer stalls 0-0 |
| Local verification | test:game 315/315, test:server 80/80, typecheck, production build, rendered response test | Complete |
