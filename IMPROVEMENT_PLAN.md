# Codebase Audit & Improvement Plan

Audit baseline: `685b99f` (release v2.65), 2026-09-13.
Prior `CODE_REVIEW_PLAN.md` (baseline `693d085`) was already fully executed and is
not re-reported here except where it regressed.

Method: seven independent read-only subagents audited non-overlapping areas
(simulation/modes, AI/vehicles/maps/levelgen, rendering/presentation, client
net/input/audio/demo, server, app/deploy/tooling, and a repo-wide dead-code/test
lens). Findings were reproduced with Node probes where cheap. No repository files
were changed by the audit. Line references are from the baseline and should be
re-located by symbol, not trusted verbatim after edits.

Every item carries a source tag so it can be traced back:
`[SIM]` `[AI]` `[REN]` `[NET]` `[SRV]` `[APP]` `[X]` (cross-cutting).
Numbering is per-area from the audit; it does not match this plan's IDs.

Severity:
- **P0** - security, data loss, or breaks a shipped user flow / bricks the app.
- **P1** - high-impact correctness or performance defect.
- **P2** - real bug or structural debt with meaningful cost.
- **P3** - cleanup, polish, or narrow edge case.

Effort: **S** <= half day, **M** ~1-2 days, **L** > 2 days.

---

## Phase 0 - Critical: security, data loss, broken shipped flows

### SEC-1 [P0] Server trusts client `playerId`; progression is unauthenticated
`server/game-server.mjs:85,93,108`, `server/room.mjs:114,215-222,351-358`,
`game/net.mjs:65,112-113`. No ticket/HMAC/JWT exists anywhere (`grep ticket` is
empty). A client can join as any ID, receive that profile, overwrite gear, mint
unlimited profiles and LRU-evict real players (cap 500). `setGear` calls `ensure`.
Fix: issue signed short-TTL match tickets from the web app (HMAC over playerId +
room + exp), verify before join, bind the server session token to the identity,
never trust `playerId` unsigned. [SRV-F1]

### SEC-2 [P1] Essential lifecycle messages are silently dropped under backpressure
`server/game-server.mjs:42-48` uses a 64-entry FIFO and `shift()`s the oldest;
`welcome`/`lobby`/`start`/`results` can be evicted permanently, stranding a client
without identity or final state. Fix: never FIFO-evict lifecycle traffic - coalesce
by type keeping newest, or disconnect and rely on token reattach. [SRV-F2]

### SEC-3 [P1] No rate limiting or client cap on control messages/connections
`server/game-server.mjs:35,100-124,145-167`. Only input/chat/gear/voice have
budgets; `list`/`history`/`create`/`join`/`host`/`start`/`ping` are unlimited and
`history` deep-clones up to 50 matches per call (`server/history.mjs:123`). One
socket can DoS CPU/memory and churn rooms. Fix: per-connection token bucket for all
control frames, global client cap, per-peer `create` cap, cache serialized history.
[SRV-F3]

### SEC-4 [P1] Client events are dropped while `lastSerial` advances (unrecoverable)
`server/game-server.mjs:41,67-68`, `server/room.mjs:339-342`. `events` is replaceable
and `lastSerial` advances before delivery, so under congestion clients permanently
miss kill/damage/objective events (snapshots carry no event history). Fix: advance
`lastSerial` only after a successful send, or ship a "resync from id N" marker.
[SRV-F4]

### BUG-1 [P0] Weapon finishes render as unlit white and warn every build
`game/view.mjs:56,626,635` passes a finish **id** (`'finish-ion'`) into
`new THREE.Color`; Three falls back to white and logs `Unknown color`. The
converters that would fix it (`resolveFinish`, `finishRgb`, `applyFinishToColor`,
`game/cosmetics.mjs:40-46`) are referenced only by tests. Online is also broken:
`server/room.mjs:162` build loadouts omit `finish`/`crosshair`, so
`chooseFinish` (`app/page.tsx:236`) never sends them. Fix: resolve id -> palette in
`weaponModel`, apply finish to light/dark/glow accents, thread `finish` through the
gear message + room loadout + progression normalization, add a real render assert.
[REN-F1, REN-F2, X-F1]

### BUG-2 [P0] Bot melee is designed but never executed
`game/core.mjs:368` sets `input.melee=true` at point blank, but `step()` only calls
`this.melee(a)` inside the `if(ext)` human/external path (`:388,394`). Reproduced:
bot 1.2u from a target, `melee` returned true, target health unchanged, 0 events.
Fix: process `controls.melee` for bot controls too. [AI-F1]

### BUG-3 [P0] Arms Race finisher is credited a loss
`game/core.mjs:336` `advanceLadder` ends the match and emits `armsrace-win` but
never records a winner or bumps `a.ladder`; `snapshot().winner` is null, so
`leaders()`/`actorWon` re-derive by ladder-then-frags and can hand the win to
another player. Reproduced with equal ladder + higher enemy frags. The
`armsrace-win` event is unconsumed repo-wide. Fix: record an explicit
`armsraceWinner` (or set `a.ladder=WEAPONS.length`) and have snapshot/leaders/
actorWon prefer it; drive the finish UI from the event. [SIM-F1, SIM-F19]

### BUG-4 [P1] "Next arena" can start a combat mode on race-only `puma-circuit`
`game/replay.mjs:26`, `app/page.tsx:231`. `nextArenaSelection` ignores mode, and
the local `start()` never calls `resolveMapForMode` (only the server does). Fix:
filter the rotation by the active mode (`mapsForMode`) or resolve the map on the
client start path. [SIM-F2]

### BUG-5 [P1] Pressing Interact on foot eats a movement tick
`game/core.mjs:391-392`: `moveActor` is skipped whenever `interact` is set, even
when `enterVehicle` returns false. Reproduced: 1.12u -> 0.00u. Bound to `KeyE`.
Fix: only skip movement when the vehicle entry actually succeeds. [SIM-F4]

### BUG-6 [P1] `connect()` hangs forever if the socket closes before `open`
`game/net.mjs:97-99`: `onclose` clears `_pendingReject` without rejecting unless
`onerror` fired first. A clean pre-upgrade close (proxy/policy/1000) leaves
`await connect()` pending and the UI stuck with no error. Fix: reject the pending
promise in `onclose` when still armed. [NET-F1]

### BUG-7 [P1] A malformed snapshot throws uncaught mid-apply
`game/net.mjs:183,275-299`: `push`/`resync` dereference `actor.ammo.map`,
`vehicles`, etc. without shape guards; a null/partial frame throws after partially
mutating client state, with no try/catch around dispatch. Fix: guard array/object
shapes, skip bad entries, wrap frame application so one frame cannot escape.
[NET-F2]

### BUG-8 [P1] Renderer-init failure bricks the app with no recovery
`app/page.tsx:152,154`: `setReady(true)` is only in the `try`; the `catch` sets an
error but never schedules the render loop or unlocks entry buttons. RETRY re-enters
`start()` with a truthy runtime but no loop -> frozen black screen. Fix: set ready
and reload/reschedule the loop in `catch`. [APP-F2]

### BUG-9 [P1] Local Puma-race coins stay visible after collection
`game/view.mjs:656`: local coins are `{wait}`, snapshots are `{ready}`;
`model.visible=entry.ready!==false` leaves `wait>0` coins rendered. Reproduced.
Fix: `entry.ready ?? entry.wait<=0`. [REN-F3]

### OPS-1 [P1] Release version has no single source; documented deploy fails verification
Footer `app/page.tsx:265` is `v2.65`; README says `DEPLOY_VERSION=v2.64`;
`deploy/README.md` says `v2.62`. `scripts/verify-deployment.mjs:13` does a substring
check, so the documented command exits non-zero after the service was already
restarted. Fix: one build-time version constant (from package.json/env) used by the
footer and scripts; update both READMEs and default the deploy assertion. [APP-F1]

---

## Phase 1 - High-impact correctness and performance

### PERF-1 [P1] First `navigation()` build stalls the game thread 4-14s
`game/core.mjs:176` (`nodes.some` O(n^2) dedupe), `:183` (O(n^2) `walkEdge` scan
gated only on `arena.nextGen`), `:196,168` (`queue.shift()`). Measured `Match`
construction: titan-valley 14.3s, derelict-station 12.3s, ashen-rift 12.0s,
frostline 9.3s, blood-gulch 9.1s. Hand-authored maps bypass the spatial-grid edge
path. Fix: always use the grid/spatial edge path, hash-grid dedupe, head-index BFS
instead of `shift()`, lower node density, cache nav per map id. [SIM-F3, AI-F13]

### PERF-2 [P1] Bot pathing + terrain queries dominate next-gen matches
`game/core.mjs:346-347,196`, `game/terrain.mjs:90-127`. Titan-valley 8 bots ~6-10.5
ms/step vs exchange ~2.2ms; `floorAt` 20k calls = 152ms (titan-valley) vs 32ms
(exchange); one BFS ~0.2ms on a 1371-node graph. `supply` is computed every think
but ignored in 7/12 objective modes. Bots also route to unfiltered raw
`arena.navNodes` (`game/core.mjs:237-238`) - e.g. substation 8/13 nodes inside
geometry - causing oscillation. Fix: use `this.nav` in `patrolPoint`/
`flankDestination`, one reachability/BFS per think, skip `supply` work in objective
modes, add a terrain triangle broad-phase. [AI-F4, AI-F5, AI-F6]

### PERF-3 [P1] Levelgen stacks multiple pickups on one coordinate
`game/levelgen.mjs:253-266`. Required + filler supplies modulo-reuse few anchors;
e.g. frost-gate `scatter+overshield` share `-38,-16`, riverbend three supplies at
`-44,-22`, proving-grounds duplicates at `(30,0)`/`(21.2,21.2)`. The collect loop
picks up every useful pickup within 1.05u per tick. Fix: distinct offsets/ring
placement with a `used` set; add duplicate-position assertions to nextgen-maps test.
[AI-F2, AI-F3]

### BUG-10 [P1] History ranking ignores objective score for assault/payload/combined-arms
`server/history.mjs:15-21` handles only ctf/koth/domination/armsrace and otherwise
falls back to frags, so a 40-frag slayer "leads" a 120s objective player. Fix:
derive ranking from `modeRule(mode).score`/objective stats. [SRV-F6]

### BUG-11 [P1] Resuming a live match replays every buffered event as effects
`app/page.tsx:134,226`, `game/net.mjs:179-182`: `resetNetworkPresentation` leaves
the event cursor at 0, so the first frame processes up to 300 stale events (muzzle
flashes/explosions/deaths). Fix: seed `view.lastEvent` to the current max on resume;
reset audio and effects cursors together. [NET-F3]

### BUG-12 [P1] Pause/objective/payload scoring gaps
- Payload `objectiveTime`/capture credit has no vertical gate while
  `stepPayload.standing` requires `<=5`; an actor on a bridge/vehicle above the cart
  farms cart time. Reuse `standing`. [SIM-F5]
- `stats.kills` increments for every lethal call including self-damage; injected
  suicide yields `kills=1`, `frags=-1`. Only count `source!==target`. [SIM-F7]
- Void/suicide kill-feed entry omits `time`, so it is filtered out by every
  consumer (`app/page.tsx:392`, `game/hud.mjs:53,103`). Add `time`. [SIM-F8]
- `spawn()` safety net can't recover when `this.nav` is empty (race/ad-hoc maps):
  `nearest` returns 0 and `nav[0]` is undefined. [SIM-F17]
- CTF flag fallback can produce `undefined`/NaN flag coordinates when a CTF-capable
  map has no authored team spawns. Fall back to `center`/derived spawns + finite
  guard. [SIM-F18]

### NET-1 [P1] Demo recorder never caps events and the serialize/compress/trim API is dead
`game/demo.mjs:158-177,261-310`, `game/demo-store.mjs:53-63`, `app/page.tsx:114`.
Events keep appending past `maxSeconds` (probe: 1s cap -> 11 keyframes, 200
events); `saveDemo` stores the raw object, so IndexedDB grows with no compression,
version check or trim guard. Fix: stop event append at the cutoff, pass
`config.timeLimit`, and either wire `compressDemo`/`parseDemo`/`trimDemo` into the
store or delete them. [NET-F4, NET-F5, NET-F17, X-F4]

### NET-2 [P1] Voice signaling can be silently dropped; prefs never persist
`game/net.mjs:104-111,120-123`, `game/voice.mjs:324-328`: `send` returns false when
a signal exceeds 64KiB but the boolean is not propagated, so a lost SDP/ICE batch
reports success and the peer hangs "connecting". Voice volume/threshold live only in
a ref (`app/page.tsx:77,252`) and reset every reload. Fix: propagate the send
result and retry/close with a clear error; persist voice prefs. [NET-F6, NET-F7]

### NET-3 [P1] Predicted vehicle shadow drops authoritative fields
`game/net.mjs:280-299` applies only a subset of the server's vehicle fields
(`game/core.mjs:433` sends `vy`, `flight`, `altitude`, `gunner`, `passengers`).
The predicted shadow keeps construction defaults, so seat occupancy/autogunner/heat
and vertical velocity diverge. Fix: resync those fields with finite guards.
[NET-F8]

### REN-1 [P1] Unwired radar + attachment + finish data
- Radar contacts already carry `label`/`icon:'payload'`/`progress`/`delivered`/
  `clamped` (`game/radar.mjs:54,62`) but the SVG only reads `kind`/position, so
  zone identity and payload progress are dead. Render them. [REN-F4]
- Underbarrel attachments (`quickdraw-grip`, `burst-module`, `grenade-launcher`,
  `homing-beacon`, `chain-capacitor`) only set `visual:{color}` and produce no mesh;
  probe showed weapon mesh count unchanged. Add underbarrel geometry + use
  `visual.color`. Also the rank UI lists mods without honoring per-weapon
  compatibility, so mods can appear equippable but do nothing. [REN-F5, X-F16]
- `seatShowcaseVehicles` is dead (`SHOWCASES[0].seatVehicles=0`), and the
  "alternates Combined Arms / Instagib" comment is stale. [REN-F6]

### REN-2 [P1] Geometry/texture lifetime leaks and churn
- `view.dispose()` never calls `clearSurfaceTextures()`, so the last arena's canvas
  textures stay resident (`game/view.mjs:661`, `game/textures.mjs:37-39`). [REN-F9]
- `box/cylinder/ring` caching is bypassed during arena/race builds because
  `activeAssets` is null, so `raceTrackModel` allocates dozens of identical
  geometries per rebuild (`game/view.mjs:37-39,732-757`). [REN-F10]

---

## Phase 2 - Major architecture and de-duplication

### ARCH-1 [P2] Break up the three monoliths
`game/core.mjs` (Match: movement, collision, combat, powerups, vehicles, bot AI,
objectives, snapshots), `game/view.mjs` (757 lines, 13 subsystems per frame),
`app/page.tsx` (425 lines, 2.7k-char lines, duplicated JSX subtrees). These are the
root cause of most cross-cutting bugs. Fix: extract `sim/movement`, `sim/combat`,
`bots/`, `objectives/`, `ArenaBuilder`, `MarkerLayer`, `RacePresentation`,
`<MapPicker>`/`<ModeFilter>`, and move game logic into hooks/modules. [SIM-F14,
REN-F12, APP-F6, X-F9]

### ARCH-2 [P2] One ranking implementation
"Who is winning" exists three times (`game/core.mjs:430` `leaders()`,
`game/outcome.mjs:13-21` `actorWon`, `server/history.mjs:15-21` `leaderRank`) and
already drifted once in v2.65. Export one `compareRanks`/`rankActor` and call it
from all three. [X-F5, SRV-F6]

### ARCH-3 [P2] Shared math + team-mode + interpolation helpers
- `clamp` redefined 14x, `lerp` 4x, `clamp01` 3x across `game/`. Create
  `game/math.mjs`. [X-F6]
- `teamMode` (`game/config.mjs:28`, canonical) vs `isTeamMode`
  (`game/hud.mjs:287`, fragile id regex). [X-F7]
- Two interpolation engines: `game/net.mjs:327-354` vs `game/demo.mjs:51-109`.
  Extract `interpolateSnapshot`. [NET-F12]
- Two divergent payload route builders (`game/mode-data.mjs:90` unreachable branch
  vs `game/core.mjs:220`/`game/payload.mjs`). [SIM-F9, SIM-F16, AI-F16]
- Two explosion/splash routines and three copy-pasted target-hit scans
  (`game/core.mjs:306,340,328,253,416`). [SIM-F12]
- Ground/bounds helpers copied across mode files with drifting defaults
  (`game/mode-data.mjs`, `game/assault.mjs`, `game/payload.mjs`). [SIM-F13]
- Team colors/neutral hand-duplicated (`game/radar.mjs:4-5` vs
  `game/team-presentation.mjs:4-10`; `#55ddcc` hardcoded in `view.mjs`). [X-F18]

### ARCH-4 [P2] Shared protocol + map schema
- Message shapes are hand-maintained in `game/net.mjs` and
  `server/game-server.mjs`/`server/room.mjs`; the server also accepts an
  undocumented flattened input form. Extract `protocol.mjs` with
  builders/validators. [SRV-F14]
- `validPlayerId` and sanitization rules duplicated client/server; unify.
  [SRV-F15]
- Five `freeze` implementations and duplicated `wall/cover/pad/tp/zone/flagData`
  builders across map modules, plus inconsistent teleporter field names
  (`to` vs `target`). Create `map-schema.mjs` + shared layout test harness.
  [AI-F12, AI-F18]

### ARCH-5 [P2] Eliminate per-tick / per-peer allocations
- `moveActor` rebuilds traversal arrays and filters all blocks per axis/substep
  (`game/core.mjs:111,119,126`). Cache derived tables per arena. [SIM-F6]
- Objectives/step paths allocate/sort every tick (`payload.mjs:154,168`,
  `assault.mjs:52`, `core.mjs:289,397,416`). [SIM-F15]
- Server filters `match.events` per peer and `structuredClone`s per peer inside the
  sim loop, plus a full `structuredClone`+quantize per snapshot (`server/room.mjs:
  54-57,339-344`). Track one cursor, share one delta, make snapshot own its clones.
  [SRV-F10, SRV-F11]
- Director rebuilds POIs and O(n^2) action points per frame (`game/director.mjs:
  176-183,206-219`); cinematic camera allocates vectors + raycasts the whole world
  per frame (`game/view.mjs:571-591`). [AI-F19, REN-F14]

### ARCH-6 [P2] Client perf + build
- No code-splitting: `view-*.js` 688K, `page-*.js` 340K, `post-*.js` 260K, CSS
  204K. Lazy-load theater/demo/progression/online and `manualChunks` three.
  [APP-F5]
- 758-line monolithic `globals.css` with 17 `.selection-screen` redefinitions and a
  dead vendored shadcn 4.13 stylesheet. Split per screen, delete dead vendor.
  [APP-F7, X-F14]
- Per-frame full scan of up to 300 events and per-frame render-state allocation
  (`app/page.tsx:136`, `game/net.mjs:327-354`). Use a cursor. [NET-F14]

---

## Phase 3 - Dead code, stubs, unwired features

### DEAD-1 [P2] Dead UI surface and dependencies
Only 4/61 shadcn components are reachable (`slider`,`radio-group`,`switch`,
`select`). ~15 deps are unused or only referenced by dead components: `zod`,
`date-fns`, `@hookform/resolvers`, `cmdk`, `@base-ui/react`, `@shadcn/react`,
`embla-carousel-react`, `input-otp`, `next-themes`, `react-day-picker`,
`react-hook-form`, `react-resizable-panels`, `recharts`, `vaul`, `sonner`,
`class-variance-authority`. Fix: delete unreachable components + prune deps; move
`@types/three` to devDependencies. [APP-F4, APP-F23, X-F13]

### DEAD-2 [P2] Starter-template scaffolding
`app/chatgpt-auth.ts` (zero importers, routes `/signin-with-chatgpt` don't exist),
`db/index.ts`+`db/schema.ts`+`drizzle*`+`examples/d1/**` (only the example uses
`getDb`), `worker/index.ts` image route (`/_vinext/image` has no binding and no
`next/image` use), `hooks/use-mobile.ts`, `vendor/shadcn-*.css`, empty
`next.config.ts`, `export const routeContext`. Fix: delete or explicitly mark as
opt-in templates; reconcile `worker` Env with real bindings. [APP-F10, APP-F12,
APP-F13, APP-F16, APP-F19, X-F14]

### DEAD-3 [P2] Unwired module exports and fields
- Dead exports: `game/arenas.mjs:82 MODE_IDS`, `game/bot-personalities.mjs:147,154
  botBehaviorSummary/BOT_TAU`, `game/core.mjs:25 BLOCKS`, `game/payload.mjs:5
  PAYLOAD_MODE_ID`, `game/vehicles.mjs:224 vehicleOccupantCount`,
  `game/input.mjs:23 INPUT_CODES`, `game/onboarding.mjs:12-24` helpers. [SIM-F10,
  SIM-F11, NET-F10, NET-F11, X-F15]
- Write-only state: `b.threat` (`core.mjs:269`), `room.lastPersistError`
  (`room.mjs:350,357`), `userData.limbs`/`_occClear`/`teamLabel`/`identifier`/
  `barrels` (`view.mjs:200,263,455,458,500`). [AI-F15, SRV-F16, REN-F20]
- Dead map schema: `objectiveNodes` (read, never authored), `roofs` (written,
  never read), `variants`/`arenaVariant` (no producer), `map.flags`/`group`/
  `scale`/`mode` (set but unused). [AI-F8, AI-F9, AI-F10]
- Dead API: `game/cosmetics.mjs` resolvers (used only by tests - see BUG-1),
  `game/demo.mjs` serialize/compress/trim (NET-1), `seatShowcaseVehicles`/
  `SHOWCASE_DEMO_CAMERA` (`game/showcase.mjs:7,12`), `net.onVoiceConfig`
  (`game/net.mjs:34,143`), `bindingConflicts` UI (`app/page.tsx:238`). [REN-F7,
  REN-F8, NET-F9, NET-F13]

### DEAD-4 [P2] Lag compensation fully implemented but never enabled
`server/room.mjs:42,299-315,335`: no production path sets `lagCompEnabled=true`,
so `transformHistory` stays empty and all the machinery + tests are dead. Decide:
wire it behind config/env and use it in damage resolution, or delete it. [SRV-F9]

### DEAD-5 [P2] Multi-floor building generator and non-solid props
`game/levelgen.mjs:173` adds `kind:'floor'` blocks that fill the storey rather than
forming a slab; all authored buildings use `floors:1`, and `roofs` is dead.
`addArch`/`addBarrel`/`addRuin` have no collision, and ceilings don't block rays, so
indoor rockets pass through the substation roof. Fix: model floors as decks, and
either make props/ceilings solid or document them as decoration. [AI-F8, AI-F14]

### DEAD-6 [P2] Map metadata contradictions
- Team-only maps synthesize `flagSpawns` even when ctf is not advertised
  (`game/levelgen.mjs:312`, `fortress`), and combined-arms is advertised on the
  vehicle-less `ironfall-megastructure`/`longreach-plateau` (`game/arenas.mjs:
  28-29`). [AI-F10, AI-F11]
- `duplicate tunnel collision blocks` at interior waypoints
  (`game/levelgen.mjs:191-200`). [AI-F7]

---

## Phase 4 - Robustness, tooling, tests, docs

### ROBUST-1 [P2] Deploy has no rollback or health gating
`scripts/deploy.sh:11-23`: `npm run build` overwrites live `dist/`, restart, verify;
`DEPLOY_VERSION` defaults empty (version assertion skipped), no `is-active` gate, no
backup/restore. Fix: staging build dir, `systemctl is-active` gate, rollback on
verify failure, derive version from the build. [APP-F3]

### ROBUST-2 [P2] Server persistence, lifecycle, and shutdown
- Synchronous `fs.writeFileSync`+rename for history and progression runs inside the
  60Hz tick on match end (`server/room.mjs:349,356`, `history.mjs:98-117`,
  `progression.mjs:53-71`). Coalesce and use async writes off the tick. [SRV-F8]
- No SIGTERM/SIGINT handler; `close()` neither flushes nor awaits, so deploys lose
  dirty stores and active matches. [SRV-F13]
- `server/game-server.mjs:188` uses `URL.pathname` for persistence paths (not
  decoded); use `fileURLToPath`. [SRV-F21]
- Progression LRU can evict connected players; pin live profiles. [SRV-F12]
- `start` broadcasts `config:{}` when the host never sent `host`
  (`server/room.mjs:158,162,172`), and `Room.config`/`match.config` are two sources
  of truth (host can mutate settings mid-match and even restart a live round).
  Make `match.config` authoritative. [SRV-F5, SRV-F7, SRV-F20]
- `demo-client.mjs:38` looks up its actor by `peerId` instead of actor id.
  [SRV-F17]
- Lobby broadcasts each peer's `voiceSession` to everyone. [SRV-F19]

### SEC-5 [P2] No CSP or security headers; no error boundary
`next.config.ts` is empty and nginx has no `add_header`; add CSP,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
`X-Frame-Options`. Add `app/error.tsx` + `global-error.tsx`; a render exception
currently blanks the whole app. [APP-F8, APP-F9]

### TEST-1 [P1] No CI; lint is unusable
No `.github` or any pipeline runs the 848 game/118 server tests, typecheck or build.
`npm run lint` reports 191 errors (mostly `no-explicit-any`) and does not complete
within 180s. Fix: add a CI workflow (`npm ci`, typecheck, test, build), scope
eslint ignores to exclude `game/**/*.test.mjs`/`.sites-runtime`/`.wrangler`, add
lint to the pipeline, burn down `any`. [X-F2, X-F3]

### TEST-2 [P2] Tests assert source text / execute extracted page code
`game/race-ui.test.mjs:13-38`, `game/showcase.test.mjs:56-83`,
`game/touch-ui.test.mjs:11` parse `app/page.tsx` with the TypeScript compiler API,
locate nodes by identifier, transpile and `import()` data URLs. They break on
harmless refactors and let real bugs (BUG-1) slip through. Fix: extract importable
units/components and test behavior; keep one thin render smoke test. [X-F8]

### TEST-3 [P2] Coverage gaps and flaky suites
- No tests for `game/demo-store.mjs`, `game/environment.mjs`, `game/battle-maps.mjs`.
  [X-F17, AI-F17]
- Server tests miss auth/`playerId` ownership, start-without-host, event loss,
  essential-queue overflow, rate limiting, restart, and `gear`/`leave` over the
  wire. `server/extra-modes.test.mjs` is 5 lines. [SRV-F18]
- Client tests miss pre-open close, malformed actor payloads, voice send-drop,
  recorder event cap. [NET-F20]
- Known-flaky two-room socket/history test with 30s timeouts. Quarantine or make
  deterministic. [X-F12]
- No behavior/interaction test for the 425-line page; deploy tests only assert
  strings. [APP-F14]

### DOC-1 [P2] Documentation drift
- `README.md:245` says three powerups (actual 5); `:220` says "no touch gameplay
  controls" while touch is documented at `:187-192,531-558`; deploy example is one
  release stale. [X-F10]
- `DEVPLAN.md`/`SPEC.md` stop at v1.4 (five weapons/three arenas) but the app is
  v2.65 (10 weapons, 35 arenas) and README presents them as current. Add a status
  banner or mark as historical baseline. [X-F11]

### UX-1 [P3] Product polish
- Reduced-motion removes the entire static backdrop (sky/mountains/scatter), not
  just animation (`game/view.mjs:372`). [REN-F16]
- Software renderer treats `BackSide` as front-facing (latent fallback divergence).
  [REN-F17]
- First-person weapon doesn't rebuild on attachment/finish change
  (`game/view.mjs:635`). [REN-F18]
- Race chase camera implemented twice with different math (`view.mjs:628` vs
  `game/race-camera.mjs:118`). [REN-F13]
- Objective zone child meshes aren't tagged `objective`, so they pull in the
  cinematic camera; race barriers are tagged `objective` even though they're solid
  walls. Use a dedicated `noCameraOcclusion` tag. [REN-F21, REN-F22, REN-F23]
- `raceDisplay` checkpoint can be `NaN` for history-shaped rows
  (`game/race-ui.mjs:16`). [REN-F24]
- "RESET MATCH RULES" wipes the callsign (`app/game-ui/configuration.tsx:40`);
  preserve `playerName` like `presetConfig` does. [APP-F21]
- Default WS URL drops non-standard ports (`app/page.tsx:39`); preserve the port /
  allow env injection. [APP-F11]
- Viewport disables zoom (`app/layout.tsx:17-18`) - WCAG 1.4.4 failure. [APP-F15]
- Missing OpenGraph/manifest/robots/themeColor. [APP-F20]
- Dependency auditing disabled (`.npmrc audit=false`); run audit in CI.
  [APP-F17]
- Unnamed presets all collapse to "LOADOUT" and silently replace each other
  (`game/presets.mjs:10,28`). [NET-F19]
- Chat log stored twice with two caps (`game/net.mjs:186-189`,
  `app/page.tsx:214`). [NET-F18]
- Reconnect has no backoff and surfaces a raw "superseded" error. [NET-F22]
- Windows rendered as individual draw calls instead of instanced. [REN-F19]
- `_clearCamera` allocates vectors + raycasts whole world per frame (see ARCH-5).
  [REN-F14]

---

## Recommended execution order

Work in batches; each batch ends with focused tests, then the full gate
(`npm run typecheck`, `npm run test:game`, `npm run test:server`,
`node --test tests/*.test.mjs`), then commit/push/deploy per the project cadence.

1. **Batch A - Security & broken flows (Phase 0, P0/P1):** SEC-1..4, BUG-1..9,
   OPS-1, TEST-1. These are the smallest, highest-value fixes and several are
   one-liners. Security (SEC-1) is the largest; land the rest first if splitting.
2. **Batch B - Correctness & perf (Phase 1):** PERF-1..3, BUG-10..12, NET-1..3,
   REN-1..2. PERF-1/PERF-2 are the biggest levers and can be split into
   dedupe/BFS (safe) and terrain broad-phase (riskier).
3. **Batch C - Architecture (Phase 2):** ARCH-1..6. Do these immediately after B
   so later fixes aren't made against the monoliths. Land mechanically safe
   extractions first (math/team/interpolation/protocol/map-schema), then the
   `core.mjs`/`view.mjs`/`page.tsx` splits.
4. **Batch D - Dead code & unwired (Phase 3):** DEAD-1..6. Pure deletion mostly;
   low risk. Decide lag-comp wire-or-delete and map-schema fields explicitly.
5. **Batch E - Robustness & tooling (Phase 4):** ROBUST-1..2, SEC-5, TEST-2..3,
   DOC-1. Deploy rollback and CI should land before further releases.
6. **Batch F - Product polish (Phase 4/UX):** UX-1. Schedule opportunistically.

### Verification gates per batch
- New regression test per bug, confirmed failing pre-fix where practical.
- `game/expansion.test.mjs` is slow (minutes) - run intentionally, not in tight
  loops; `server/network.test.mjs` two-room test is known flaky - isolate/quarantine.
- No WebGL/browser in this environment: renderer/visual claims remain
  geometry/unit-verified until a real browser pass.

### Explicit non-goals / open questions
- **Auth model:** SEC-1 assumes progression is meant to be per-account. If it is
  deliberately non-sensitive local data, SEC-1 drops to P2 - decide first.
- **Lag compensation:** wire it or delete it; do not leave it half-present.
- **Map schema:** choose to either author/consume `objectiveNodes`/`roofs`/
  `variants` or remove them; do not keep dead fields "just in case".
- **Monolith split:** ARCH-1 is the riskiest item; stage it behind the frozen test
  suite and avoid behavior changes while extracting.

### Audit limitations
- No browser/GPU/RTC/real-WebSocket behavior was exercised; perf numbers are
  single-run, GC-sensitive measurements that show consistent direction, not
  benchmarks.
- Five server test modules named in earlier docs (`server/transport.mjs`,
  `spectator.mjs`, `chat.mjs`, `hardening.mjs`) do not exist; there are only test
  files. `game/hardening.test.mjs` has no owning module and is slow.
- Dead-code claims are based on a static relative-import/reference graph plus name
  greps; dynamic specifiers built from variables were searched for and none found.
