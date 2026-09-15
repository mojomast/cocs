# COCS — Colosseum Of Competitive Slop — game specification

> **Historical baseline — see [VERIFICATION.md](VERIFICATION.md) for current status.** This specification records the original MVP design and authorized expansions up to the v1.4-era content ceiling (five weapons, three arenas). It is retained as history and is not a description of the current build.

Status: MVP implementation complete; verification evidence and environment limitations are tracked separately in DEVPLAN.md and VERIFICATION.md. All identities are fictional robot adaptations, not claims about products.

## Pillars [MVP]
Fast readable first-person free-for-all; equal character stats; harnesses change tactics; map control rewards movement. Desktop keyboard and mouse, local simulation, no accounts or external services. Original geometry and synthesized sound only.

## Match and state ownership [MVP]
Selection → playing → paused → playing; playing → results → rematch or selection. One human plus four bots. Five minutes or 15 frags. Time expiry compares all scores; equal leaders produce a tie. Death suspends an actor for 2 seconds, then respawns at a point maximizing minimum live-enemy distance. 1.5 seconds of visible protection ends on firing or power use. Enemy kill +1; suicide −1; each death counted once. Start creates new simulation state and clears every effect/input. Pause freezes simulation time.

## Controls and movement [MVP]
WASD, pointer-lock mouse look, Space jump, left click fire, 1/2/3 and wheel weapon selection, Q power, Tab scoreboard, Esc pause. Sensitivity slider and mute are device-local preferences. Acceleration 55 units/s², ground speed 8, friction 10/s, modest air acceleration, gravity 24, jump velocity 9; equal diagonal speed. Fixed 1/60s simulation with at most 5 catch-up steps and discarded excess elapsed time. Player radius .42 and height 1.8; axis-separated cylinder versus AABB wall sliding, analytic ramps, floor support, bounded world, jump buffer .12s/coyote .10s. No forced head bob or motion blur. Projectiles use swept segments against solids and actors. Camera ray and muzzle clearance prevent wall penetration.

## Roster and selection [MVP]
ChatGPT teal/white rounded helmet and concentric details; Claude ivory/orange angular armor; Grok charcoal/silver asymmetric antenna; Meta blue/cyan twin rings; Qwen violet/white layered armor. Shared health 100, armor cap 100, dimensions and movement. Procedural head, torso, arms, legs, held weapon with gait/facing/firing animation and fragment death effect. Preview uses the same model builder as bots. Claude is restricted to Claude Code in UI and runtime; all other characters can select any harness. Character changes visibly correct incompatible loadouts.

## Harnesses [MVP]
All values in shared tuning data. One power per actor, no stacking/retrigger during cooldown. Cooldown starts on activation, all timers reset on death and restart. Same rules for bots and human.

| Harness | Power | Duration | Cooldown | Effect |
|---|---|---:|---:|---|
| OpenClaw | Claw Burst | instant | 10s | 5-unit line-of-sight radial pulse, 24 damage, outward impulse 12 and lift 4 |
| Hermes | Courier Rush | 3s | 12s | movement cap ×1.6, colored trail |
| OpenCode | Parallel Burst | 3s | 14s | fire interval ×0.6; normal ammo cost, damage and collision |
| Claude Code | Guardrail | 3s | 14s | incoming damage ×0.5, visible shield; never invulnerable |

Pulse expanding ring, rush trail, rapid-fire glow and shield show activation; timed effects disappear on expiry. HUD shows active duration then remaining cooldown.

## Weapons and combat [MVP]
Aim from camera to nearest target/solid, then verify muzzle-to-aim line; bot aiming includes error and reaction time. Starter always usable. All actors start with Pulse only. Rocket/rail pickups grant weapon and ammo; reloads are omitted.

| Weapon | Damage | Fire interval | Ammo | Rules |
|---|---:|---:|---|---|
| Pulse Rifle | 11 | .13s | unlimited | hitscan, range 70, cyan tracer |
| Rocket Launcher | 35 direct + up to 60 splash | .85s | pickup +6, cap 18 | speed 22, splash radius 4, distance falloff, cover blocks blast, self damage, impulse |
| Rail Lance | 78 | 1.25s | pickup +5, cap 15 | hitscan, range 90, violet beam, one target per shot |

Armor absorbs up to 60% of incoming damage limited by available armor. Spawn protection precedes armor; Guardrail halves damage before armor. Death guard prevents duplicate attribution. Projectiles retain actor ID across deaths. Health +35 capped at 100; armor +40 capped at 100; health/armor respawn 12s, weapons 15s. Pickups only consumed when useful. Pickup shapes/colors differ, hover and rotate. Held weapon geometry varies by type, with first-person muzzle, short recoil and muzzle flash. Hit marker, damage vignette, feed and tones confirm events.

## Arena: The Exchange [MVP]
30×30 bounded industrial chamber. Central reactor is a tall line-of-sight blocker; two main circuits run on either side. North deck is 3.8 units high, linked by east and west ramps. Four low barriers provide strafing cover. North gantry rail pickup rewards climbing; rockets are ground-side. Distributed health/armor and eight spawn points keep fights moving. Outer shell, floor panel lines, emissive route strips, reactor rings, wall numbers and suspended trusses establish landmarks. No borrowed maps or assets. Solid deck has no underpass. Ramp side barriers stop invalid side entry; all ascending access is from ramp foot.

## Bot AI [MVP]
Four bots use the same move/combat/power/pickup functions as player. Utility states roam, pursue, engage, seek pickup, recover. Bounded vision radius 25 with visibility test; target memory 1.5s stores last observed position only. Reaction delay .3–.55s and aim noise prevent instant perfect shots. Choose close rocket, distant rail, otherwise pulse; lead visible moving targets for rockets. Strafing during engagement. A small waypoint graph explicitly includes both ramps and the upper deck. Edges are sampled against collision and maximum traversable slope; shortest-path search navigates around reactor and cover. Movement progress watchdog resets the route and backs away if stuck. Choose useful pickups, prioritize health below 55. Power use depends on visible target distance and health. One difficulty only; no omniscient target tracking.

## Presentation, settings, accessibility [MVP]
Game-native selection screen: roster at left, live procedural character at center, harness panel at right. Teal-white display typography, black carbon panels, restrained orange tactical highlights. Start button leads straight into arena. HUD health/armor, ammo/weapon, cooldown, timer, rank, feed, crosshair; Tab scoreboard. Results list frags/deaths with rematch and selection actions. Pointer-lock loss or blur clears keys and pauses; explicit resume requests lock again. Pointer-lock unsupported/denied produces a helpful message and supported click-drag aiming fallback. Audio created on gesture, mute and sensitivity controls accessible from menu/pause. Desktop control requirement shown on small screens; no false mobile-play promise. Reduced motion disables decorative menu motion; play has no camera shake.

## Architecture [MVP]
`game/data.mjs`: tuning and compatibility. `game/core.mjs`: authoritative fixed-step state, collision, movement, weapons, effects events, scoring, pickups and bots. `game/software.mjs`: optional CPU compatibility rendering of the same scene when WebGL2 is disabled; approximate painter sorting, reduced performance. `game/view.mjs`: Three.js scene, shared procedural models, camera and pooled transient display; never changes combat outcomes. `app/page.tsx`: React state menus/HUD/input lifecycle and audio bridge. Rendering runs RAF, simulation runs bounded accumulator. No backend or LLM dependencies. React receives HUD snapshots at 10Hz, not every simulation step. Dispose scene resources/listeners on unmount. Local preferences only in localStorage.

## Performance and debugging [MVP]
Target 60fps at 1080p on a typical modern desktop; cap pixel ratio at 1.5, low-poly meshes, no expensive postprocessing, bounded particles/projectiles/feed. Report observed browser hardware context separately from target. Pure-logic test script exercises compatibility, damage/score, timing, resets and bot match. Read-only debug snapshot through `window.tokenArenaSnapshot()` and the canvas `data-snapshot` attribute exposes mode, entities and performance for verification; no dev cheat UI in production. Runtime exceptions must be addressed. Real input testing wherever browser supports it; explicitly record unsupported pointer-lock verification.

## Acceptance gate [MVP]
1. Fresh launch selects all five identities and enforces Claude restriction in both layers.
2. Start and resume enter controllable arena; WASD/jump/sliding/ramp traversal and bounds behave consistently.
3. All three weapons cause valid damage and stop at solids, with limited ammo and unlimited starter fallback.
4. Four powers share bot/human rules, expire and cool down; death/restart clear timers.
5. Four opponents route around cover/up ramps, fight each other and human, collect supplies, activate powers and respawn.
6. A full 15-frag or 300s match ends correctly, including tie and suicide; results/rematch/selection work repeatedly.
7. HUD/audio/feedback and pause/input cleanup function. No blocking runtime/build errors.
8. Build, meaningful pure-logic tests and requested browser tests reported honestly. Stop adding features at this gate; unsupported tests remain declared limitations, not fabricated passes.

## Roadmap [POST-MVP]
P1: optional advanced movement preset with measured strafe acceleration, configurable keybinds and two bot difficulty presets. P2: two additional original arenas (vertical tower and intersecting courtyards), team deathmatch and configurable match rules. P3: additional weapons (arcing grenade, short-range beam), two new harnesses with explicit tradeoffs, expanded robot roster, character passives balanced separately. P4: optional local progression with cosmetic unlocks, training challenges and campaign encounters. P5: separately scoped server-authoritative multiplayer, interpolation/reconciliation, accounts/matchmaking and persistence; requires its own infrastructure and security plan. None of these are implemented in this MVP.

## Content expansion 0.2 [POST-MVP — IMPLEMENTED]

The user explicitly authorized this expansion on 2026-09-06, superseding the original MVP stop gate for this bounded content pass. The original sections above preserve the v0.1 design baseline; this section defines the current additions. No networking or progression work is included.

### Operators [POST-MVP — IMPLEMENTED]
Nine playable identities total. Added Gemini (blue/gold, paired diamond visor), DeepSeek (cyan, tall central helmet fin), Mistral (amber, stepped crest and striped chest), and Kimi (pink/ivory, orbital helmet ring). They use the shared rig and equal base statistics, and appear as bots. All non-Claude characters can select all seven harnesses; Claude still requires Claude Code. The selection lists scroll rather than compressing the entire roster into unreadable cards.

### Harness additions [POST-MVP — IMPLEMENTED]
- Codex / Recompile: instantly heals 35, capped at 100; 16s cooldown; repair glow lasts 2s. Bots trigger below 65 health.
- Cline / Phase Step: moves up to 6m in facing direction with .12m collision samples, clamps at solid geometry/map boundary, traverses gentle ramps, never crosses a wall. 11s cooldown and .35s visual window. Bots trigger with a distant visible target.
- Roo Code / Context Jam: line-of-sight radius 7m; slows live, unprotected opponents to 55% speed for 3s. 15s cooldown. Visible victim shield tint and human status message. Debuff refreshes rather than stacks; death/respawn clears it. Bots trigger within 7m.

All new powers consume spawn protection on activation, share authoritative rules with bots and reset cooldown/active state on respawn. Identities and powers are fictional adaptations.

### Weapon additions [POST-MVP — IMPLEMENTED]
- Scattergun (slot 4): eight hitscan pellets, 8 damage each, .12 direction spread, 24m range, .72s shot interval. One shell per trigger; pickup grants 10, cap 30. Twin-barrel model and gold pellet tracers. Bots prefer it inside 8m.
- Plasma Driver (slot 5): projectile speed 34m/s; 25 direct damage plus up to 12 splash at radius 1.6m; .24s shot interval. Pickup grants 24, cap 72. Blue energy-coil model, blue plasma orbs and impact effect. Same swept collision, cover checks and self-damage rules as rockets. Bots use it when equipped and other range preferences do not win.

Number keys 1–5 and wheel select available weapons. Starter Pulse remains unlimited. Every map supplies all four limited-ammo weapons, health and armor. Inventories and projectile metadata are data-driven rather than limited to three slots.

### Arenas [POST-MVP — IMPLEMENTED]
- The Exchange remains the original central-reactor / north-gantry layout. Its pickup distribution now includes scatter and plasma.
- Crosswire: entirely ground-level; four offset bunkers around a low central block, open cross lanes, four corner approaches and a violet palette. No invisible raised floor or inherited ramps. Scatter at the center approach; rail at the far north.
- The Foundry: orange industrial room with two long furnace towers, a center lane, outer ramps and a north gantry. The twin cores create different cover angles from The Exchange; rear connectors are explicitly represented in navigation.

Each match owns its map reference, spawn positions, pickups and navigation. Floor queries, cylinder movement, visibility, rays, projectile impacts, dash collision and bot paths all receive that map context. Renderer geometry comes from the same block definitions. Selecting another map builds a fresh match and replaces/disposes the prior arena group. Small SVG plan thumbnails are derived directly from the collision blocks.

### Expansion gate [POST-MVP — IMPLEMENTED / VERIFICATION TRACKED]
All 63 character/harness pairs validate; all nine models build; new abilities and weapons have consequential tests; every map has safe spawns/useful reachable supplies, a connected graph and a deterministic match reaching completion; UI exposes map choice and all inventory slots; build/typecheck pass. Browser and performance observations are recorded separately in VERIFICATION.md, including the existing WebGL-disabled environment limitation.


## Custom match expansion 0.3 [POST-MVP — IMPLEMENTED]

Authorized 2026-09-07. This extension supersedes baseline restrictions on game modes, bot counts/difficulty and configuration. Existing nine operators, seven harnesses, five weapons and three maps remain available.

- Four modes: Deathmatch with configurable starting weapon; Instagib with unlimited rail, single-hit elimination, no supplies and disabled powers; Rocket Arena with unlimited rockets and only health/armor supplies; Full Arsenal with all weapons unlimited. Mode rules are enforced inside Match, including respawn and bot inventories.
- 0–8 bots and four presets: Easy (0.85s base reaction, 0.45s base decision interval, 0.19 aim error, +0.2s shot delay), Normal (0.3s/0.2s/0.045/no extra delay), Hard (0.16s/0.14s/0.023/no extra delay), Nightmare (0.08s/0.1s/0.01/no extra delay). Reaction adds up to 0.25s jitter, decision interval up to 0.15s. All presets retain visibility/cover requirements and equal base statistics.
- Match configuration: frag limit 5–50, timer 60–900s, respawn 1–5s, speed multipliers 0.75/1/1.25/1.5, gravity multipliers 0.4/0.7/1, damage multipliers 0.5/1/1.5/2. Optional unlimited ammo for unlocked weapons, 50% cooldowns and 25% life steal from actual enemy health damage, capped at 100 health. No healing from self-damage or protected targets.
- Display: FOV 65–110, cross/dot/ring crosshair, validated hex color, scale 0.6–1.8, optional weapon model and FPS counter. Callsign is sanitized and capped at 20 characters. Local storage persists match setup, selected arena and display preferences. Existing audio/sensitivity storage remains supported.
- Runtime copies normalized configuration per match. Timer, scoring, respawn, mode supply lists, player and bot weapons, movement and damage use the instance settings. No mutable global rule preset. Zero bots is a timed practice session; result text does not claim a competitive victory.
- Mode-specific controls visibly disable when overridden. Match setup exposes reset, opponents, limits and modifiers. Display controls apply immediately during pause; match rules take effect on the next start. Rematches reset all match state with the chosen settings.

Validation: 34 simulation tests, including complete 8-bot matches for all 16 mode/difficulty combinations, per-actor multi-human inputs and determinism, plus the rendered response test and TypeScript/build checks.

## Multi-human engine groundwork 0.4 [P5 FOUNDATION — IMPLEMENTED]

Authorized 2026-09-07 as the first step toward the separately scoped P5 multiplayer. Two parts: per-actor engine inputs (complete) and a local authoritative game server (complete). No browser client integration, lobby UI, matchmaking or accounts are included in this change.

### Per-actor engine inputs [IMPLEMENTED]

- `Match` now accepts `options.humanCount` (1–8, default 1). Actors with `id < humanCount` are humans (`bot: null`, never run bot AI); actors `id >= humanCount` remain bots. Total actors are `humanCount + botCount`.
- `Match.step(dt, inputs)` accepts either the legacy single-input shape (applies to actor 0) or `{inputs: {actorId: {...}, ...}}` keyed by actor id. External inputs may carry `x`/`z` movement, `yaw`/`pitch` look (pitch clamped to ±1.45), `fire`, `jump`, `power` and a `weapon` switch intent gated by owned ammo.
- Actors without an external input for a step use bot AI when they are bots, and idle safely when they are humans (disconnect-safe default).
- Difficulty fire delay applies to bots only; humans receive no artificial cadence. `snapshot()` reports `bot: null` for humans.

### Local game server [IMPLEMENTED]

- `server/room.mjs` is a socket-agnostic room: first joiner is host, players join with name/character/harness (Claude restriction enforced via `resolveLoadout`), the host sets map and match settings through `normalizeConfig`, and `start` builds a `Match` with one actor slot per peer plus bots.
- The room is authoritative. A fixed-step tick applies each peer's latest input to its actor, streams `events` deltas per client (tracked by per-peer serial), and broadcasts full snapshots at 20Hz. Match end broadcasts a `results` message once; the host may start a rematch.
- Leaving mid-match idles the actor; leaving before start frees the slot. Unknown message types, invalid JSON and non-host actions produce `error` messages instead of crashes.
- `server/game-server.mjs` exposes HTTP status + WebSocket on one port (default 4000), hosted from this machine. `tickDt`/`tickMs` options allow accelerated headless testing.
- Wire protocol: client sends `join`, `host`, `start`, `input`, `ping`, `leave`; server sends `welcome`, `lobby`, `start`, `events`, `snapshot`, `results`, `error`, `pong`.

### Wire protocol and transport [IMPLEMENTED]

- Client sends `join`, `host`, `start`, `input`, `ping`, `leave`; server sends `welcome`, `lobby`, `start`, `events`, `snapshot`, `results`, `error`, `pong`.
- Inputs are level fields (`x`, `z`, `yaw`, `pitch`, `fire`, `weapon`) plus `jump`/`power` one-shot edges that the server converts to single consumed flags, so holding a key never bunny-hops or re-casts.
- Snapshots include the full match state plus `feed` and rocket positions; `events` deltas are tracked per peer by serial.

### Browser client [IMPLEMENTED]

- `game/net.mjs` is the browser-side client: connect, join with current operator/harness/callsign, lobby state, host controls, 60Hz input send, snapshot buffering with 120ms render delay and position/rotation interpolation for actors and rockets, event accumulation for effects/audio, and a render-state adapter consumed by `ArenaView`.
- **Client prediction and reconciliation**: the client runs a local shadow `Match` (same map, config, `humanCount: 1`) and steps it with exactly the inputs it sends, so movement, aim and firing respond instantly. Every server snapshot reconciles the shadow's own actor to the authoritative state (position, velocity, health, armor, weapon, ammo, cooldowns, protection, timers). `renderState` substitutes the predicted actor for your own slot while remote actors stay interpolated. Measured on localhost: the shadow leads server truth by ~0.11 units on average, matching one 60Hz tick of travel, and converges every snapshot.
- `app/page.tsx` gains a network lobby screen (players, host controls, map, start), a net playing loop, and net-aware HUD, scoreboard, kill feed and results (host may restart, everyone is placed automatically). Solo local play is unchanged.
- `ArenaView` models are keyed by actor id and the camera/muzzle flash follow your assigned actor, not slot zero.

### Reconnection and host migration [IMPLEMENTED]

- Every join receives a session token in `welcome`; the client persists it (localStorage, scoped per server URL) and presents it on future joins.
- A dropped socket is marked disconnected but its seat is held for a grace period (20s default, configurable). The actor idles; the lobby shows `DISCONNECTED · SEAT HELD`. A reconnecting client with the matching token reattaches the same peer: identity, actor seat and inputs resume, and the server re-sends `start` so the client rebuilds its prediction shadow and is placed straight back into the running match.
- If grace expires or the player leaves explicitly, the vacated actor is handed to a bot (`· BOT` suffix) so the match stays active, and host duties migrate to the next connected player (a host who reconnects inside grace keeps the host role).
- Stale or unknown tokens never reuse a session; every fresh join mints a new token.

### Verification

Six engine tests and thirty-seven server tests pass locally: 38 simulation tests, shadow prediction and token persistence, room-level reattach/grace/bot-handoff/host-migration coverage, a real two-WebSocket-client match, the `NetClient` wrapper playing a predicted match to results, and a full drop-and-reconnect E2E where a client loses its socket mid-match, rejoins the same seat, keeps its actor id, and plays to results. TypeScript, production build and the rendered response test remain green. No new manual browser, GPU or performance benchmark is claimed for this expansion.

## Concurrent rooms, spectator mode and match history 0.5 — 2026-09-07

- **Room registry [IMPLEMENTED]**: `createGameServer` owns a registry of rooms — the default `local` room plus rooms created on demand, each with a collision-checked 4-letter code. `join` carries `roomId` (default `local`); `{type:'create', name, playerName, character, harness}` creates a room and makes the creator host (if the client persists its room code next to its session token, reconnects are routed straight back). `{type:'list'}` returns browser summaries (`roomId, name, players, started, mapId, config`). The tick/grace/drain drivers iterate every room; empty on-demand rooms are retired. Broadcasts are scoped per room — peers never receive another room's snapshots or results. `Room` itself changed minimally (spectate flag, room name, optional history sink).
- **Spectator mode [IMPLEMENTED]**: `join` accepts `spectate: true`. Spectators take no actor slot, are excluded from `humanCount` and the player limit, never become host and cannot host or start; gameplay inputs are ignored. They do receive event deltas, snapshots and results (per-peer `lastSerial` already tracked). The lobby tags spectators; the browser UI offers WATCH per room; the spectator HUD hides the crosshair/weapon/ability panels and shows a NO SEAT camera-follow view (`setSpectator` hides first-person hands, camera falls back to the first live actor).
- **Match history [IMPLEMENTED]**: each completed match is recorded as `{id, roomId, mapId, mode, fragLimit, timeLimit, endedBy:'frag'|'time', duration, leader, players:[{name,character,harness,frags,deaths}]}`. The per-server `MatchHistory` persists to a JSON file (default `server/history.json`, path injectable, loaded at boot, appended atomically via temp-file rename, capped at the newest 50). `{type:'history'}` returns all matches; the browser renders a recent-matches panel reusing scoreboard styling.

### Verification

Thirty-seven server tests pass: the twelve 0.4 room tests and three 0.4 E2E tests, six registry tests (create/join/list, code collisions, empty-room retirement, cross-room tick drivers), six history tests (entry shape, frag vs time endings, file round-trip in a temp dir, cap enforcement, no-write without a path, a completed `Room` match recording), seven spectator tests (no seat/host, player-limit exemption, `humanCount` exclusion, host/start rejection, input ignoring, snapshot/event/results delivery, token reattach), and three new real-socket E2E tests (two rooms playing simultaneously with room-scoped broadcasts, a spectator watching a live match to results, and a history query returning the completed match). The 38 game tests are untouched. TypeScript, production build and the rendered response test remain green; the browser flow compiles through the NetClient integration tests, with manual browser playtesting of the browse screen still pending on this machine.

## Room chat and multiplayer fixes 0.6 — 2026-09-07

- **Bug fix: `create` always mints a fresh room [IMPLEMENTED]**. `create` previously routed to any room whose id was sent alongside it — a client that had ever joined `local` persisted `roomId:'local'`, so CREATE silently acted like JOIN: no new room appeared anywhere and the creator sat in the old one (the "dead end" and "invisible room" reports). `createRoom` no longer consults the registry: it always creates a new collision-checked 4-letter room and joins the creator as host. `NetClient.create` sends `roomId:''` so no stale stored value is ever trusted; token reattach stays the `join` path (`token` + `roomId`); the browse screen refreshes its list after create. Regression: a client that joined `local` then creates twice gets two distinct fresh codes, `list` shows local plus the latest, and a second fresh socket sees it; a genuinely reconnecting client still reattaches to its created room via `join(token+roomId)`.
- **Bug fix: zombie rooms and orphaned seats [IMPLEMENTED]**. Closing a socket without an explicit `leave` left the seat marked disconnected; after `expireGrace` removed the seat nothing retired the room, so abandoned on-demand rooms accumulated forever and the browser listed stale empty rooms. `RoomRegistry.expireAll` now runs `removeIfEmpty` over every room after expiring seats; the default `local` room is never removed. Additionally, a peer that `join`/`create`d another room while still seated in one would orphan its old seat (connected forever, invisible to the room's expiry) — join and create now release any previous room seat server-side, so a socket is always in at most one room. Regression: abrupt disconnect, expired grace, room gone from `list` and the registry; create-without-leave vacates the old seat and retires the old room.
- **Room chat [IMPLEMENTED]**. `{type:'chat', text}` → `Room.chat(peerId, text)`: sanitize (control chars stripped, trimmed, capped at 200 characters, empty dropped), rate-limit per peer (one message per 300ms, silent drop), then broadcast to the room only as `{type:'chat', peerId, name, text, time}` through the existing room-scoped flush — spectators chat like any peer. A peer outside any room receives `error: 'not in a room'`. The client appends messages to a bounded `chatLog` (100 entries) and fires `onChat(msg)`; the UI renders a lobby panel under the player list and a bottom-left in-game overlay (`T`/`Enter` opens the input, `Enter` sends, `Escape` closes). Keys already claimed by gameplay (WASD/Space/Q/Tab/Escape/1–5) are untouched, and solo play has no chat UI.

### Verification

Forty-eight server tests pass: the twelve 0.4 room tests, seven registry tests (now including expireAll retiring abandoned rooms), seven spectator tests, six history tests, eleven real-socket E2E tests, and five chat unit tests (sanitize/cap, empty drop, rate limit, unknown peer ignored, spectator chat delivered with a room-broadcast envelope). The new E2E tests prove: create mints a fresh room even when the socket carries a stored `roomId` (a fresh socket lists it), a dropped NetClient reattaches to its created room via its stored token and chats, an abruptly abandoned room disappears from `list` after grace while `local` persists, create vacates the previous room seat so no zombie peer lingers in the old room, and chat is room-scoped — every peer and spectator in the room receives it while a second room and a non-member receive nothing, with chat flowing during a live match. The 38 game tests are untouched. TypeScript, production build and the rendered response test remain green; the chat overlay compiles through the NetClient tests, with manual desktop-browser playtesting still pending on this machine.

## Menu cleanup 0.7 — 2026-09-07

Applied game-menu best practices (clear hierarchy, ≤ 3 clicks to anything, one dominant primary action, progressive disclosure) to the first screen, without changing any game or network behavior:

- **Identity-first selection screen**: the grid is now just operator, live model preview and harness. Match rules and arena selection moved behind a `MATCH SETUP` dialog (kept in the DOM and CSS-hidden so server-rendered content — and the rendered-HTML gate — is unchanged).
- **Persistent action bar**: sticky bottom bar with a selection summary (operator, harness, map, mode, bots, live `ONLINE · ROOM` status) and the root actions — dominant `ENTER ARENA`, `PLAY ONLINE` (opens the room browser; while connected the same button becomes `DISCONNECT`), `MATCH SETUP` and a settings gear. The old inline multiplayer panel is gone; `CONNECT & JOIN` and the server-address field moved to the room browser as a compact row with a `QUICK JOIN` shortcut.
- **Overlay consistency**: Escape closes the match-setup dialog and settings panel; the backdrop click closes the dialog; modals animate in at 200ms (fade + scale).

Solo play, the lobby, prediction/reconciliation and the network protocol are untouched; the 38 game and 48 server tests pass unchanged, as do typecheck, production build and the rendered response test. Manual desktop-browser playtesting of the new layout is still pending on this machine.

## Combat feel, Warthog, arena rebuild and visuals 1.3 — 2026-09-10

A quality pass driven by research into Quake/Source movement, browser-shooter netcode, the Halo M12 Warthog, Blood Gulch/CTF level design, and Three.js rendering budgets. Goal: remove the "generic Three.js tech demo" feel across movement, gunplay, vehicles, maps and rendering while preserving the deterministic 60 Hz simulation and the existing network protocol.

- **Movement [IMPLEMENTED]**: `moveActor` uses a Quake/Source ground friction (`6`) + acceleration (`10`) model and air acceleration (`1.0`) so diagonal strafe jumps build speed; airborne speed is capped at a hard terminal rather than the old lateral clamp; jump uses variable release with apex hang (`gravity 26`, `jump 8.6`); `sprint` (×1.375), `crouch` (×0.4, eye 1.45→0.95) and a momentum-preserving `slide`/slide-hop are driven by `input.sprint`/`input.crouch`. Coyote time `.10 s` and jump buffering `.12 s` are retained.
- **Gunplay [IMPLEMENTED]**: per-weapon `recoil` (kick + spray pattern + recovery) drives an authoritative damped aim-punch (`punchYaw`/`punchPitch`) applied to rays; per-weapon `bloom` spreads grow on fire/move and recover at rest; ADS reduces spread and sensitivity; `reload`/auto-reload and holster/raise timing gate firing; `data.mjs` carries the new fields. Damage remains shared; Pulse TTK is ≈0.81 s.
- **Camera and HUD feedback [IMPLEMENTED]**: the first-person camera applies recoil and crouch eye height; `input.mjs`/`page.tsx` add Shift sprint, Ctrl/C crouch, R reload and RMB ADS through a shared `controlsFromState`; the HUD shows a spread-driven crosshair, hitmarker, reload bar, posture chip and low-ammo warning.
- **Warthog [IMPLEMENTED]**: `vehicleModel` builds a recognizable M12 (roll cage, open bed, corner off-road tires, 360° turret). `stepVehicle` adds engine/drag, speed-sensitive steering, lateral-slip drift, handbrake, boost, four-wheel suspension and slope alignment, body roll/pitch and a bounded turret traverse; the turret yaw is body-relative and shared by sim/view/net. `Match.step` adds deterministic run-over splatter damage.
- **Maps [IMPLEMENTED]**: Blood Gulch is rebuilt to a 160×70 m box canyon (central hill, two sniper ridges, two wall caves, multi-route bases with roof teleporters, warm sandstone palette, two Warthogs). New CTF maps Frostline, Derelict Station and Ashen Rift are registered.
- **Rendering [IMPLEMENTED]**: directional shadows, a PMREM image-based environment, deterministic FBM procedural textures, vertex/triangle color variation, a gradient sky with instanced mountains and terrain scatter, and tiered bloom/vignette/SMAA postprocessing — all bypassed by the software renderer and reduced-motion.
- **Netcode [IMPLEMENTED]**: adaptive client interpolation delay (~100 ms, floor 90 / ceiling 160) with a jitter-adaptive buffer (4–16), server snapshot rate raised from 20 Hz to a configurable 30 Hz, and the reload edge plus sprint/crouch/ADS flags forwarded by `Room.input`. Message types and JSON schema are unchanged.

### Verification

293 game tests and 80 server tests pass, alongside typecheck, the production build and the rendered-response test. A scripted runtime smoke ran full CTF matches with bots on all 14 maps plus a Warthog drive/turret/run-over scenario with no NaN positions, floor desync or crashes. Known limitation: the pre-existing `ironfall-megastructure` and `longreach-plateau` maps retain partially disconnected bot-navigation components; a bidirectional nav-link change was reverted because it routed bots backward through one-way launchers (the platform-map traversal test catches this). Shadows/bloom/textures are build- and mock-verified but not yet GPU-frame-pacing tested on hardware.

## Feedback, bot flow and platform-map connectivity 1.4 — 2026-09-10

- **Combat feedback [IMPLEMENTED]**: floating damage numbers, a directional damage indicator, kill/death banners, a weapon/ammo panel (auto/semi, `∞` ammo, reload state) and a match/objective announcer (`FIGHT · MODE · MAP`, `RED/BLUE SCORES`, `FLAG CAPTURED`). Derived client-side from existing snapshot and event data; the geometry/bearing/text helpers live in `game/hud.mjs` and are unit-tested.
- **Renderer feel [IMPLEMENTED]**: dynamic FOV (sprint +5°, ADS `max(55, fov*0.82)`), a pooled muzzle light, a low-health camera overlay and bounded camera shake, all gated off for the CPU fallback and reduced motion. Shared material and scoped geometry caches reduce per-model allocation and GPU state changes.
- **Bot engagement and objectives [IMPLEMENTED]**: scan range scales with difficulty and arena diagonal; bots always have a purposeful destination; CTF defenders hold a post near their flag and attackers vary their approach; long rotations detour to vehicles.
- **Platform-map return routes [IMPLEMENTED]**: Ironfall and Longreach gained physical up/down launcher pairs; both directed navigation graphs are fully connected and bot matches complete instead of stalling 0-0.

### Verification

315 game tests and 80 server tests pass, with typecheck, production build and the rendered-response test green. New tests assert full two-way navigation connectivity on every platform map and bot activity on large maps; the runtime smoke confirms Ironfall/Longreach now score. Remaining limits: damage numbers render on the ~10 Hz HUD tick, projection lags one frame, platform-map void falls persist from combat knockback, and the new overlays/lights are not yet GPU-frame-pacing tested on hardware.
