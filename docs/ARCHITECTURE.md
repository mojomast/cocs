# COCS Architecture

Engineer-facing map of the Token Arena / COCS codebase: what each layer owns,
how data flows, and the invariants that keep the layers honest.

This document references modules and exported symbols. It intentionally avoids
line numbers so it survives refactors. Where a claim is an intended invariant
rather than something mechanically enforced, it is labelled as such.

## 1. Top-level layout

```
app/         Next/vinext React application (SSR + client runtime owner)
game/        Pure engine and rendering modules (*.mjs, no DOM at import time)
server/      Authoritative Node multiplayer server
scripts/     Build, version, deployment and verification scripts
tests/       SSR / UI-contract / deployment-asset guards
docs/        Spec, devplan, verification log, this document
deploy/      nginx vhost + systemd user units
worker/      Cloudflare Worker entry that forwards to the vinext handler
public/      Static assets served as-is (favicon, manifest, robots)
build/       Local vinext/Vite plugin used by vite.config.ts
dist/        Build output (generated; client/ + server/ bundles)
```

### `app/`

- `app/page.tsx` — the runtime owner. Holds all React state, the single
  `requestAnimationFrame` loop, the fixed-step accumulator, input listeners,
  audio event fan-out, and the `UiBag` it passes to presentational screens.
- `app/layout.tsx`, `app/error.tsx`, `app/global-error.tsx` — Next shells.
- `app/ui/` — the v3 design system (`contract.ts`, `primitives.tsx`,
  `screens/*.tsx`); `app/game-ui/` — legacy in-match HUD still rendered by the
  page; `app/legacy/README.md` documents the boundary between them.
- `app/styles/ui.css` — namespaced `ui-*`/`shell-*`/`panel-*`/`btn-*` design
  system, imported from `app/globals.css`.
- `components/ui/` and `lib/` — shadcn-style Radix primitives and the `cn`
  utility used by both UI layers.

### `game/`

Pure logic and rendering. Everything is ESM (`.mjs`). Engine modules must not
touch `window` or `document` at import time; renderer modules may, but only
inside functions/classes constructed in the browser.

- Engine: `core.mjs`, `data.mjs`, `config.mjs`, `maps.mjs`, `arenas.mjs`,
  `bots.mjs`, `objectives.mjs`, `race.mjs`, `soccer.mjs`, `vehicles.mjs`,
  `singleplayer.mjs`, `campaign-data.mjs`, `mode-data.mjs`, `enemy-types.mjs`.
- Rendering: `view.mjs`, `software.mjs`, `effects-fx.mjs`, `environment.mjs`,
  `textures.mjs`, `models.mjs`, `rig.mjs`, `character-anim.mjs`,
  `weapon-models/*.mjs`, `post.mjs`.
- Pure presentation helpers: `hud.mjs`, `radar.mjs`, `scoreboard.mjs`,
  `race-ui.mjs`, `singleplayer-ui.mjs`, `outcome.mjs`, `presentation.mjs`.
- Network client (`net.mjs`, `protocol.mjs`, `quantize.mjs`) and
  replay/theater/demo (`demo.mjs`, `demo-store.mjs`, `replay.mjs`,
  `showcase.mjs`, `showcase-build.mjs`, `spectate-build.mjs`).
- Tests: `game/*.test.mjs`; slow tests archived in `game/archive/`.

### `server/`

- `server/game-server.mjs` — `createGameServer()`: HTTP + `ws` server, socket
  dispatch/backpressure, matchmaking, persistence flush, heartbeat; runnable via
  `node server/game-server.mjs`.
- `server/rooms.mjs` — `RoomRegistry` (default `local` room plus on-demand coded
  rooms) and `Matchmaker`; `server/room.mjs` — `Room`, one authoritative `Match`
  plus lifecycle and snapshots.
- `server/history.mjs` (`MatchHistory`), `server/progression.mjs`
  (`ProgressionStore`), `server/demo-client.mjs` (headless smoke-test client).

### `scripts/`, `tests/`, `deploy/`, `worker/`

- `scripts/` (`build-verified.sh`, `deploy.sh`, `read-version.mjs`,
  `verify-deployment.mjs`, `sites-env.sh`, `install-ci.sh`) — see §7.
- `tests/` (`rendered-html.test.mjs`, `ui-contract.test.mjs`,
  `deployment-assets.test.mjs`) — see docs/TESTING.md.
- `deploy/` — nginx vhost and two systemd user units; `worker/index.ts` forwards
  to `vinext/server/app-router-entry`.

## 2. Data flow

### The runtime owner

`app/page.tsx` is the only long-lived stateful component. It has one
`requestAnimationFrame` loop and one set of window/document listeners for the
page lifetime, both installed in a single mount `useEffect` and removed on
unmount.

After a dynamic `import('../game/view.mjs')`, the page constructs a mutable
object at `runtime.current` holding `view, audio, keys, match, net, renderState,
look, display, touch, acc, fps, recorder, demo, showcase, spectateLocal,
cameraMode, spectateDirector, …`. Subsystems receive this object (or its fields)
rather than React state: `wireNet()` attaches `NetClient` callbacks,
`buildShowcase()` mutates `r.showcase`, the loop mutates `r.acc`/`r.fps`/
`r.look`. React `useState` is reserved for values the DOM must re-render on.

### The loop and fixed-step accumulator

`loop(now)` computes `elapsed = min(0.1, (now - last) / 1000)`, samples FPS
once per second, then branches on `modeRef.current`:

- Solo / local spectate: `r.acc = min(r.acc + elapsed, RULES.dt * 5)` then
  `while (r.acc >= RULES.dt) { r.match.step(RULES.dt, {inputs}); r.acc -= RULES.dt; }`,
  bounded to a small step count to prevent catch-up spirals.
- Networked play: the same accumulator drives `net.input(input)` and
  `net.predict(input)` per fixed step, then `net.renderState(now)` yields the
  interpolation/prediction state for rendering.
- Showcase (behind menus) and Theater demo states step their own local matches
  or sample a recorded `DemoPlayer`; menu modes still render through the same
  `view.render(...)` call.

`RULES.dt` (from `game/data.mjs`) is `1/60`, so simulation advances at 60 Hz
regardless of display refresh while rendering runs once per frame.

### HUD snapshots vs simulation

The renderer consumes raw state every frame, but React only receives a snapshot
when `now - hudAt > 80` ms (roughly 10–12 Hz). `decorate(snapshot, extra)` adds
transient presentation fields (fps, renderer kind, damage direction/numbers,
kill cue, captions, connection quality) and `setHud(...)` triggers a React
render. `game/hud.mjs` exports the pure derivations (`damageBearing`,
`projectToScreen`, `connectionQuality`, …) used by `decorate` and the screens.
The split is deliberate: 60 Hz simulation and 60 fps rendering never cause
React reconciliation at those rates.

### `app/ui/` vs `app/game-ui/`

- `app/ui/screens/*.tsx` are pure render functions of a single `ui: UiBag`
  prop. The page builds `const ui: UiBag = { ... }` inline and passes it in.
  Screens read state and call handlers from the bag; they own no engine state.
- `app/game-ui/*.tsx` (`configuration.tsx`, `race-hud.tsx`, `soccer-hud.tsx`,
  `singleplayer-hud.tsx`, `game-chat.tsx`, `touch-controls.tsx`) are the legacy
  in-match layer still rendered by the page. Their prop signatures and class
  strings are contract-tested by `game/race-ui.test.mjs`,
  `game/touch-ui.test.mjs` and `game/scoreboard.test.mjs`, so they must not
  change without updating those tests in the same change.

### The renderer never decides outcomes

`game/view.mjs` (`ArenaView`) is a consumer: it maps the current snapshot to
meshes, effects, camera and audio events. Damage, scoring, spawning, objective
progress and match end are computed in `game/core.mjs` and, in multiplayer, in
`server/room.mjs`. No renderer path writes `frags`, `teamScores`, `health` or
`objectiveState` — the central layering invariant.

## 3. The pure engine

### `game/core.mjs` — `Match`

`Match` is the authoritative simulation. Its constructor is approximately
`new Match(character, harness, random, mapId, options)`; `options` carries the
normalized config plus `humanCount`, `botCount` and per-actor `loadouts`.
Important methods/symbols:

- `step(dt, { inputs })` — advance one fixed step (movement, weapons,
  projectiles, pickups, vehicles, objectives, mode rules, bot logic).
- `snapshot()` — a serializable view (actors, pickups, vehicles, scores,
  objective/race state, winner, `overReason`, `time`).
- `endMatch`, `spawn`, `damage`, `melee`, `leaders`, `emit`.
- `emit` appends `{type, id, time, ...}` to `this.events` (capped at 300). Events
  are the presentation bus for view effects, HUD callouts and announcer audio.

Supporting pure exports: `moveActor`, `traversalTables`, `walkEdge`,
`damageFalloff`, `blastUnsafe`, `clamp`, `dist`, `aim`, `MOVE`/`MELEE`.

### `game/data.mjs`

Roster and rules constants: `CHARACTERS`, `HARNESSES`, `WEAPONS`, `POWERUPS`,
`ECONOMY_PICKUPS`/`ECONOMY_PICKUP_IDS`, `RULES` (fixed timestep, gravity, jump,
respawn, protection), and `validLoadout`/`resolveLoadout`.

### `game/config.mjs` — config normalization

`GAME_MODES`, `DIFFICULTIES`, `MUTATORS`, `DEFAULT_CONFIG` and
`DEFAULT_DISPLAY` are canonical tables. `normalizeConfig(value)` and
`normalizeDisplay(value)` are the only supported way to turn untrusted or
partial input into engine config: choices clamp to known enumerations, numbers
clamp to per-field ranges, mutator lists fold into canonical flags via
`applyMutators` (re-surfaced by `activeMutators`), and loadouts resolve through
`loadoutFor` / `loadoutStart` / `spawnInventory` / `spawnLoadout`, which every
spawn path (human, bot, server) shares. Engine code must never read a raw,
un-normalized config.

### Determinism

- `Match` takes an injected `random`; the server uses a per-room RNG and the
  client shadow its own. The simulation core must not call `Math.random` for
  authoritative decisions.
- Map templates in `game/maps.mjs` and `*/maps.mjs` are frozen (`freeze(MAPS)`);
  each `Match` owns its mutable collision/navigation context.
- `game/levelgen.mjs` and `game/textures.mjs` use seeded generators
  (`mulberry32`, value-noise/FBM).
- `NetHarness` (`game/net.mjs`) is a deterministic, seeded, socket-free
  server+client model so prediction/reconciliation can be asserted frame by
  frame.

## 4. Rendering pipeline

`ArenaView` (in `game/view.mjs`) owns the scene. The constructor picks a
backend:

```
webgl2 context available  -> THREE.WebGLRenderer
otherwise                 -> SoftwareRenderer (game/software.mjs)
```

The software path is approximate and slower: it disables shadows, IBL/PMREM,
bloom/vignette post and most GPU-only pools.

Pipeline components:

- **Arena build** — `buildArena(arena)` emits world geometry from the frozen
  arena definition (`blocks`, `ceilings`, terrain, structures, props, race
  track, flags, objectives) plus sky/backdrop from `environment.mjs` and
  procedural albedo/roughness/normal maps from `textures.mjs`.
- **Procedural assets** — `weapon-models/*.mjs` (`WEAPON_BUILDERS`,
  `buildWeaponBody`), `models.mjs`, `rig.mjs`, `character-anim.mjs`; materials
  and geometries are cached through `ModelAssets` (`effects-fx.mjs`).
- **Effects** — `effects-fx.mjs` pools (`MuzzleLightPool`, `RailBeamPool`,
  `DecalPool`, `DeathPool`, `HitReactionFX`, `CameraShake`,
  `LowHealthOverlay`); `game/feedback.mjs` provides `SynthAudio`.
- **Postprocessing** — `game/post.mjs` owns tiers and the stage
  (`QUALITY_LEVELS`, `normalizeQuality`, `qualitySettings`, `qualityIndex`,
  `nextQualityTier`, `frameTriangleBudget`, `postStage`, `applyComposerSize`,
  `disposeComposer`); `ArenaView._syncPost()` lazily builds an `EffectComposer`
  (Render, UnrealBloom, vignette, Output) only when eligible.
- **Quality controller** — `_quality()`/`_applyQuality()` resolve the tier;
  `_sampleQuality(delta)` demotes/promotes once per second on FPS unless
  `setQuality` set an override; `_onQualityChange()` resizes shadow maps, the
  software screen area, particle/mote caps and the software triangle budget.
- **Display** — `setDisplay(prefs)` normalizes via `normalizeDisplay`, then
  updates FOV/exposure/resolution scale and re-syncs post and resize.

### Disposal and lifecycle rules

- `setMatch(match)` rebuilds actor/pickup/vehicle/flag/objective models and
  clears every pool, corpse map, decal and camera effect.
- `disposeObject(obj)` disposes owned geometries/materials; shared assets are
  tracked separately and only disposed with the view.
- `ArenaView.dispose()` releases the renderer, composer, environment RT and
  tracked resources; the page calls it with `audio.dispose()` on unmount and
  closes the `NetClient`.
- Quality is presentation-only; it must never feed back into the simulation.

## 5. Networking architecture

### Wire protocol — `game/protocol.mjs`

- `PROTOCOL_VERSION = 2`, `SNAPSHOT_DELTA_VERSION = 2`. The envelope is
  additive: an older peer never emits/consumes a delta frame, so a bump cannot
  strand it. Revision 2 adds id-keyed array patches (`$A`), so the actor/rocket
  arrays are diffed element-wise instead of sent whole.
- `MESSAGE` is the single shared list of message `type` strings consumed by both
  client and server dispatch switches so they cannot drift.
- `parseInputEnvelope(msg)` validates/clamps input; `snapshotDelta(base, next)`
  and `applySnapshotDelta(base, patch)` encode deltas (`$d` deletes, `$a`/`$o`
  whole containers, `$A` id-keyed arrays with `order`/`set`/`add`); `wireSize`
  and `BandwidthMeter` account for them; `validPlayerId`, `validProgressToken`
  and `sanitizeText` validate identification and text.

### `game/net.mjs` — `NetClient`

Client-side transport and reconciliation:

- `connect`/`close`/`send` plus verbs `join`, `create`, `list`, `history`,
  `host`, `start`, `input`, `predict`, `gear`, `chat`, `voiceState`,
  `voiceSignal`. `onMessage` fills public state (`state`, `players`, `config`,
  `mapId`, `actorId`, `events`, `chatLog`, `progression`, `rooms`, `matches`)
  and fires the `on*` callbacks the page wires.
- **Snapshot buffer and interpolation**: `push` records arrival/server-clock
  samples, maintains a jitter-adaptive `bufferTarget` and `renderDelay`, and
  stores a bounded sequence→state `deltaBase` map. `pushDelta` rejects a frame
  whose base was lost so the next full snapshot re-syncs. `renderState(now)`
  interpolates actors/rockets/vehicles (shortest-arc angles), preferring a
  server clock.
- **Prediction shadow + reconciliation**: `createShadow(mapId, config)` builds a
  local `Match`; `predict(input)` steps it; on each snapshot
  `resync`/`resyncVehicles` copy the server's local actor/vehicle state in, then
  unacknowledged `pendingInputs` replay on the shadow. `renderState` substitutes
  the shadow actor once `resynced`. Vehicle modes skip the shadow.
- `interpolateSnapshots(prev, next, alpha, {localId, predicted})` is the pure
  helper shared by `renderState` and `NetHarness` (the deterministic,
  socket-free server+client test model).

### Server pipeline

`server/game-server.mjs` → `server/rooms.mjs` → `server/room.mjs`.

- `createGameServer()` builds an HTTP health endpoint plus a `ws.WebSocketServer`
  (64 KB payload cap), tracks `sockets`/`socketPeer`/`peerRoom`, enforces
  control-message rate limits, coalesces replaceable traffic
  (snapshots/events/voice) under a buffer limit, and guarantees essential
  transitions (welcome/start/lobby/results/errors) are pumped when the socket
  drains.
- `dispatch()` routes to the peer's `Room`; `Matchmaker` queues players and
  `draftQueue()` seats balanced teams; `RoomRegistry` owns the default `local`
  room, creates/retires on-demand rooms, drains outbound queues and calls
  `tickAll(dt)`.
- `Room` owns a `Match` and the deterministic lifecycle
  `['lobby','warmup','live','results']`. `input(peerId, input)` deduplicates and
  rate-limits sequenced input and records one-shot edges; `tick(dt)` advances at
  60 Hz (max 5 catch-up steps), emits snapshots at `snapshotHz` (default 30)
  with per-actor input acks, streams event deltas (`deliverEvents`), and on end
  records `history.record(...)`, awards progression, sets `phase='results'` and
  broadcasts the result.
- `wireState()` quantizes a deep copy so serialization never mutates the
  authoritative nested state.

### Persistence

- `server/history.mjs` — `MatchHistory` records each completed match
  (`{id, roomId, mapId, mode, …, players, result}`), `HISTORY_CAP = 50`, flushed
  atomically to `server/history.json` (path injectable).
- `server/progression.mjs` — `ProgressionStore` (`PLAYER_CAP = 500`,
  `sanityCheckResult`/`withinSanity`, `getOwned`/`awardOwned`/`setGearOwned`)
  keyed by `playerId` + `progressToken`; pinned in-room players resist eviction.
- Both flush from the server tick and on `close()`.

### Protocol versioning

Both sides read `PROTOCOL_VERSION`; the delta frame is a separate additive
`SNAPSHOT_DELTA` guarded by `SNAPSHOT_DELTA_VERSION`. New optional fields must be
additive and ignored when absent; changing or removing a required field is a
version bump plus a compatibility note.

## 6. UI architecture

- `app/ui/contract.ts` — `type UiBag = Record<string, any>` and
  `ScreenProps { ui: UiBag }`; deliberately loose because the page owns state
  and screens are pure.
- `app/ui/primitives.tsx` — `Shell`, `TopBar`, `PageHead`, `Panel`, `Btn`,
  `Segmented`, `Tabs`, `Stats`, `Field`, `Chip`, `Meter`, `Empty`, `Banner`,
  `Modal`, `ActionRail`, `SelectCard`, all `ui-*`/`panel-*`/`btn-*` styled from
  `app/styles/ui.css`.
- `app/ui/screens/` — `TitleScreen`, `SelectionScreen`, `ProgressionScreen`,
  `ChangelogScreen`, `BrowseScreen`/`LobbyScreen` (`NetScreens.tsx`), `SetupModal`/
  `SinglePlayerModal`/`OnboardingModal` (`SetupModals.tsx`),
  `PauseModal`/`ResultsModal` (`ResultModals.tsx`), `TheaterScreen`,
  `PlayingHud` (+ `SpectatorBoard`), `SettingsDialog`; each takes
  `{ ui }: ScreenProps`.
- `app/ui/DemoBroadcast.tsx` — the broadcast lower-third that overlays the menu
  demo; it is not under `app/ui/screens/`, so it takes explicit props instead of
  the `ui` bag. Its data comes from `game/broadcast.mjs`.
- `app/styles/ui.css` — the namespaced design system, imported once from
  `app/globals.css`. Legacy in-match components use their own class names.
- `tests/ui-contract.test.mjs` guarantees every field a screen destructures
  from `ui` (or reads as `ui.<field>`) exists in the `const ui:UiBag = {...}`
  literal in `app/page.tsx`. Because the bag is loosely typed, this static check
  is the only thing between a typo and a runtime crash.

### Title showcase / demo behind menus

`buildShowcaseFactory` (`game/showcase-build.mjs`) builds a real `Match` with
scripted bots, seated showcase vehicles and a `CinematicDirector`. While the page
is in `selection`/`browse`/`lobby`/`progression`/`changelog` (or Theater with no
demo), the loop steps that match and feeds it to `view.setShowcase(...)` with
`view.setPreviewRect(...)` when a menu preview rectangle is mounted. It is gated
by `showcaseOk()` (`showcaseEnabled !== false && !reducedMotion() &&
!software`). The same loop throttles a `demoBroadcast(...)` digest into
`DemoBroadcast`, and `view.setShowcaseExpected(true)` tells the view to render the
arena rather than the full-screen operator turntable if a frame lands before the
next showcase snapshot. The Theater demo path uses `DemoPlayer` (`game/demo.mjs`)
and the same director instead. The in-game patch notes are `game/changelog.mjs`
(data) rendered by `ChangelogScreen`, and `game/changelog.test.mjs` keeps its
newest version equal to the `title-footer` literal.

### Legacy boundary

`app/legacy/README.md` is the source of truth. The legacy `app/game-ui/*`
exports, prop signatures and class strings are pinned by
`game/race-ui.test.mjs`, `game/touch-ui.test.mjs` and
`game/scoreboard.test.mjs`; the old inline menu markup was deleted (preserved in
git history) rather than duplicated so it cannot drift.

## 7. Build & tooling

- `next.config.ts` — `poweredByHeader: false` plus security headers on every
  route: strict CSP (`default-src 'self'`, inline scripts/styles,
  `connect-src` for `ws:`/`wss:`), `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy` (microphone self for voice), `X-Frame-Options: DENY`.
- `vite.config.ts` — `vinext()`, the local `sites()` plugin
  (`build/sites-vite-plugin.ts`) and `@cloudflare/vite-plugin`; client-only code
  splitting groups `three-core`, `three` and a `director` chunk
  (`game/director|demo|demo-store|progression|cosmetics|showcase*|replay`).
- `scripts/build-verified.sh` — re-execs through `sites-env.sh`, requires GNU
  `timeout` and a local `vinext`, then runs a bounded `vinext build`
  (`SITES_BUILD_TIMEOUT`, default 3m).
- `scripts/read-version.mjs` — `footerVersion(html)` matches the
  `title-footer` span in `app/page.tsx`; this is the release-of-record, not
  `package.json` (which may lag).
- `scripts/verify-deployment.mjs` — `linkedAssets(html)` deduplicates
  `/assets/*.css|js`; `verifyDeployment(base, {fetchImpl, version})` asserts
  HTTP 200 + correct content type for the HTML and every linked asset (and
  optionally the release string).
- `scripts/deploy.sh` — backs up `dist/`, builds, restarts
  `token-arena-web.service` (and `token-arena-server.service` with
  `--with-game-server`), gates on `systemctl --user is-active`, verifies the
  public URL and rolls back on any failure. `deploy/` holds the nginx vhost
  (`/` → vinext :3000, `/ws` → game server :4000) and systemd units.

## 8. Invariants & extension guide

### Invariants

1. **Renderer never decides outcomes.** Damage/scoring/objective state comes
   only from `Match.step` (solo) or `Room.tick` (multiplayer).
2. **Bots and humans share one ruleset** (`moveActor`, weapons, pickups, powers,
   objectives).
3. **Config is normalized at the boundary.** `normalizeConfig` /
   `normalizeDisplay` are the only ingress; never read raw config in the engine.
4. **Determinism depends on injection.** Pass an RNG into `Match`, keep map
   templates frozen, use seeded generators.
5. **One loop, one listener set.** `app/page.tsx` owns the only RAF loop and
   registers/removes listeners once per page lifetime.
6. **Serialization copies.** `wireState()`/quantization never mutate the
   authoritative match.
7. **`UiBag` is checked** by `tests/ui-contract.test.mjs`.
8. **Legacy HUD is frozen.** `app/game-ui/*` changes require the pinning tests
   to change in the same commit.

### Where to add things

**A mode** — add a `GAME_MODES` entry in `game/config.mjs` (team, score, limits,
objective kind, maxBots); confirm objective handling in `game/mode-data.mjs`
(`objectiveTemplate`) and `game/core.mjs` (`step`, `snapshot`, `leaders`, win
checks). Update `game/arenas.mjs` (`arenaSupportsMode`) if the mode needs
specific arenas, add HUD copy in `game/hud.mjs` (`modeGoal`/`modePrimary`), and
cover it in `game/modes.test.mjs` + `game/config.test.mjs`.

**A map** — add a frozen template (usually a new `game/*-maps.mjs` array) spread
into `MAPS` in `game/maps.mjs`, plus `arenaMeta` in `game/arenas.mjs` (group,
scale, `play` modes, `legacy`). Validate with `game/map-layout.test.mjs`,
`game/arenas.test.mjs` and `game/map-schema.test.mjs`; generated maps come from
`game/levelgen.mjs` + `game/nextgen-maps.mjs`.

**A weapon** — append to `WEAPONS` in `game/data.mjs`, add a builder in
`game/weapon-models/` and register it in `weapon-models/index.mjs`
(`WEAPON_BUILDERS`, `WEAPON_MODEL_NAMES`), extend the ammo arrays in
`game/config.mjs` (`spawnInventory`) and `game/maps.mjs` (`pickupWeapon`). Cover
with the `game/weapon-*` tests plus `game/attachments.test.mjs` if applicable.

**An enemy** — add a type to `ENEMY_TYPES` in `game/enemy-types.mjs` (stats,
behavior, boss phases), wire it into a wave/roster (`game/singleplayer.mjs`, or
`game/levelgen.mjs`/`game/models.mjs` for rendering) and extend
`game/enemy-types.test.mjs`.

**A UI screen** — create `app/ui/screens/YourScreen.tsx` exporting
`function YourScreen({ ui }: ScreenProps)`, render it from `app/page.tsx`, and
add every field it reads to the `const ui:UiBag = {...}` literal. If the screen
is in-match, follow the legacy-pin rules before touching `app/game-ui/`.

**Any engine change** — run `npm run test:game` and `npm run typecheck`; add or
update the focused `*.test.mjs` for the module (see docs/TESTING.md).
