# COCS — Steam release plan (orchestration-ready)

Status: proposed. This document is the execution contract for an orchestration
agent that will dispatch parallel subagents to ship the existing Three.js /
Next.js game (`COCS`) as a Steam title on **Windows + Linux/Steam Deck**.

It is deliberately self-contained: decisions, frozen interfaces, parallel
workstreams, file ownership, acceptance tests and a subagent prompt template.

---

## 1. How the orchestration agent must use this document

1. Read §3 (locked decisions) and §4 (frozen interfaces). Do **not** let a
   subagent change a frozen interface without an explicit integration step.
2. Dispatch work in **waves** (§6). Tasks inside a wave are parallel-safe only
   because their owned-file sets are disjoint (§7).
3. Never assign two concurrent subagents the same file. The ownership matrix in
   §7 is authoritative. `app/page.tsx`, `package.json`, `vite.config.ts`,
   `next.config.ts`, `package-lock.json` and `docs/*` are **serialized hotspots**:
   one writer per wave, orchestrator-merged.
4. After each wave: run the wave gate (§6), resolve seams, then start the next
   wave. Do not start a wave whose dependencies are unmet.
5. Each subagent gets a prompt built from §11 and returns the evidence listed in
   its task spec (§6). No evidence, no completion.
6. Track honesty: this repo has **no browser/GPU verification** in its normal
   environment (see `docs/TESTING.md`). Packaging, overlay and frame-pacing
   claims must be marked "manual, not verified here" unless actually run.

---

## 2. Research summary (best practices this plan follows)

| Area | Finding | Source |
|---|---|---|
| Steam onboarding | $100 USD app fee per product; **30-day** wait after fee before release; **2-week** public "coming soon" page; **1–5 day** review of store page + build. Start onboarding early; it is the long pole. | Steamworks *Onboarding* |
| Steam networking | SDR (`ISteamNetworkingSockets` + relays) is the modern path for P2P and dedicated servers, but the JS binding used here does **not** expose it (see gap below). Legacy `ISteamNetworking` P2P still does NAT traversal through Steam and is what `steamworks.js` binds. | Steamworks *Steam Datagram Relay*, `steamworks.js/client.d.ts` |
| **Binding gap** | `steamworks.js` exposes only `networking.sendP2PPacket` / `readP2PPacket` / `acceptP2PSession` plus `matchmaking` lobbies. There is **no** `ISteamNetworkingSockets` (SDR), `ISteamNetworkingMessages`, or FakeIP. Plan v1 around legacy P2P; treat a native SDR addon as a stretch task. | `steamworks.js` `client.d.ts` |
| Electron security | Follow all 20 Electron checklist items: `contextIsolation: true`, sandbox on, no `nodeIntegration`, **avoid `file://`; serve local content via a custom protocol**, define a restrictive CSP, validate every IPC `sender`, disable navigation/new windows, flip Fuses (`runAsNode`, `nodeCliInspect`). | Electron *Security* |
| Native module packaging | `steamworks.js` is a native addon. Unpack it from `asar` and ship the Steam redistributables (`steam_api64.dll`, `libsteam_api.so`) next to the executable. | `steamworks.js` README |
| Steam Deck | Target 1280×800, readable text, default controller config, detect Deck via `utils.isSteamRunningOnSteamDeck()`. Native Linux build is preferred; Proton is the fallback. | Steamworks *Steam Deck* |

The game-specific advantages already in this repo: the simulation is a pure,
deterministic ESM module (`game/core.mjs`), single-player already runs
client-side, and `server/room.mjs` is socket-agnostic with injected
history/progression stores. That makes a pluggable transport realistic.

---

## 3. Locked decisions

1. **Wrapper:** Electron (bundled Chromium) for identical WebGL behavior on
   every machine. Tauri's system webview is rejected for a 3D FPS.
2. **Authority:** both models behind one abstraction — **host-authoritative
   P2P** for casual play and **dedicated server** for ranked/persistent play.
   Single-player/bots stay fully offline.
3. **Discovery:** Steam Lobbies carry room metadata (`hostType`,
   `name`, `mode`, `map`, `capacity`). The existing `?room=CODE` links remain
   only for the browser/LAN build.
4. **Transport:** one `WebSocketLike`/`ServerTransport` seam. Backends:
   `ws` (web/LAN, unchanged), `steam-p2p` (legacy packets via `steamworks.js`).
5. **Client inside the wrapper:** a **client-only static build** served from a
   custom `app://` protocol (not `file://`). SSR/Cloudflare/Wrangler are not
   used in the desktop build.
6. **Saves:** Steam Cloud (Remote Storage) with localStorage fallback; the
   existing `ProgressionStore` anti-cheat clamps stay host-side.
7. **Targets:** Windows (NSIS) and Linux (AppImage + deb) depots. macOS is out
   of scope.
8. **Transport first:** the abstraction lands and every existing test passes
   before any Steam code is written.

### The one interface that must be frozen before parallel work

See §4. If a task needs to change it, stop and escalate to the orchestrator;
do not edit it in a feature task.

---

## 4. Frozen interfaces

### 4.1 `WebSocketLike` (renderer / client transport)

```js
// game/transport.mjs
export const OPEN = 1;
export interface WebSocketLike {
  readyState: number;          // 1 === OPEN
  bufferedAmount?: number;     // optional; server budgets use it
  send(data: string): void;    // text frames; transport does any encoding
  close(): void;
  onopen: ((ev?: any) => void) | null;
  onerror: ((ev?: any) => void) | null;
  onclose: ((ev?: any) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}
export interface ClientTransport {
  open(url: string): WebSocketLike;
}
export class WebSocketTransport { open(url) { return new WebSocket(url); } }
```

`NetClient` must accept `options.transport` (default `new WebSocketTransport()`)
and must not reference the global `WebSocket` directly after T1.1.

### 4.2 `ServerTransport` / `ServerSocketLike` (main process)

```js
// server/game-server.mjs — injected, defaults to the `ws` implementation
export interface ServerTransport {
  on(event: 'connection', cb: (ws: ServerSocketLike) => void): void;
  clients: Iterable<ServerSocketLike>;   // for broadcast flush()
  close(cb?: () => void): void;
}
export interface ServerSocketLike {
  readyState: number;                    // 1 === OPEN
  send(text: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  isAlive?: boolean;
  bufferedAmount: number;
  on(event: 'message', cb: (data: any) => void): void;
  on(event: 'close' | 'error' | 'pong', cb: (...args: any[]) => void): void;
}
```

`createGameServer({ createTransport })` calls
`createTransport(httpServer)` and uses the returned `ServerTransport`; the
default factory wraps `ws.WebSocketServer`. Extract the current
`wss.on('connection', ws => …)` body into an exported
`attachConnection(engine, ws)` so both backends reuse dispatch/flush/tick
verbatim. The first parameter is the **engine object returned by
`createGameServer`** (exposing its `sockets`, `socketPeer`, `peerRoom`,
`dispatch`, `flush`, `nextPeer`/`maxClients` state), **not** the `node:http`
server; §5's diagram is authoritative on this name.

### 4.3 Steam bridge (UI ↔ main), frozen so `app/page.tsx` has one writer

```ts
// app/game-ui/steam-bridge.ts
export interface SteamBridge {
  available: boolean;
  init(): Promise<void>;
  createLobby(opts: { name: string; mode: string; map: string; capacity: number }): Promise<string>; // lobbyId
  joinLobby(lobbyId: string): Promise<void>;
  listLobbies(): Promise<Array<{ id: string; name: string; mode: string; map: string; hostType: 'p2p' | 'dedicated' }>>;
  openInviteDialog(): void;
  onJoinRequested(cb: (lobbyId: string) => void): void;
  onRichPresence(key: string, value: string): void;
  syncCloud(key: string, value: string | null): Promise<void>;
  unlockAchievement(id: string): void;
  setStat(name: string, value: number): void;
}
export const steamBridge: SteamBridge; // no-op implementation when unavailable
```

### 4.4 Desktop build output contract

- `npm run build:desktop` produces **`dist-desktop/`** containing `index.html`
  and content-hashed assets, loadable without a network server.
- Electron serves it through the custom `app://` protocol.
- The desktop build must not require `worker/`, Wrangler bindings, or SSR.

---

## 5. Target architecture

```
Electron main process (desktop/main.mjs)
├── app:// protocol server  ── loads dist-desktop/ (renderer = existing game)
├── desktop/steam.mjs       ── steamworks.js init + lobbies/cloud/stats/presence
├── desktop/steam-server.mjs── ServerSocketLike over P2P; pump runCallbacks()
│      └── reuses server/game-server.mjs: attachConnection(engine, ws)
├── desktop/dedicated.mjs   ── headless authority for the dedicated depot
└── preload.mjs (contextBridge, frozen API) ── renderer
         renderer: NetClient({ transport: SteamTransport | WebSocketTransport })

Discovery: Steam Lobby (hostType=p2p|dedicated)  ──> roomId/steamId ──> transport
Fallback:  ws://<host>/ws  for the browser/LAN build (unchanged)
```

---

## 6. Work breakdown

### Wave gates

| Wave | Gate to pass before next wave |
|---|---|
| 0 | Contract frozen in this doc; deps installed; `npm test` still green on untouched baseline |
| 1 | `npm run test:game`, `npm run test:server`, `npm run typecheck` green; `dist-desktop/` builds; Electron window opens an offline bot match |
| 2 | A Steam P2P match runs between two Electron instances using the unchanged game code; lobby create/join/invite works |
| 3 | Windows + Linux installers produced; dedicated server boots headless; depot vdf validated by `steamcmd` dry-run |
| 4 | `npm test` fully green; packaged app smoke-tested on both OSes; docs/verification updated |

### Wave 0 — serial (orchestrator)

| ID | Task | Owned files |
|---|---|---|
| T0.1 | Add devDeps `electron`, `electron-builder`, `@electron/fuses`, `steamworks.js`; pin scripts. Commit lockfile. | `package.json`, `package-lock.json` |
| T0.2 | Freeze §4 in this document; no code. | `docs/STEAM_RELEASE_PLAN.md` |
| T0.3 | Create dirs + gitignore: `desktop/`, `scripts/steam/`, `release/`, `dist-desktop/`. | `.gitignore` |

### Wave 1 — parallel (5 subagents)

| ID | Task | Depends on | Owned files |
|---|---|---|---|
| T1.1 | **Core transport seam.** `game/transport.mjs` (`WebSocketTransport`, `OPEN`); refactor `NetClient.connect` to `options.transport`. Behavior-neutral. | T0 | `game/transport.mjs`, `game/net.mjs`, `game/transport.test.mjs`, `game/net.test.mjs` |
| T1.2 | **Server seam.** Isomorphic `Room` (`globalThis.crypto.randomUUID`, `TextEncoder`); extract `attachConnection`; `createGameServer({ createTransport })`. | T0 | `server/game-server.mjs`, `server/room.mjs`, `server/transport.test.mjs`, `server/room.test.mjs` |
| T1.3 | **Desktop client build.** Produce `dist-desktop/` static bundle decoupled from Cloudflare/SSR; add `build:desktop` script. | T0 | `vite.config.ts`, `next.config.ts`, `scripts/build-desktop.sh` |
| T1.4 | **Steamworks wrapper.** Thin, mockable wrapper over `steamworks.js` for init/lobbies/cloud/stats/presence/deck; no Electron. | T0 | `desktop/steam.mjs`, `desktop/steam.test.mjs` |
| T1.5 | **Electron shell.** Hardened main/preload, `app://` protocol server, window, fuses, `electron-builder.yml`. | T0, T1.3 contract | `desktop/main.mjs`, `desktop/preload.mjs`, `desktop/protocol.mjs`, `desktop/security.mjs`, `electron-builder.yml` |

### Wave 2 — parallel (4 subagents)

| ID | Task | Depends on | Owned files |
|---|---|---|---|
| T2.1 | **Steam transport adapters.** `SteamTransport` (renderer side) + `SteamServer` (`ServerSocketLike`); length/encoding framing; `runCallbacks` pump; accept by lobby membership. Snapshot-size check: send oversized frames reliable. | T1.1, T1.2, T1.4, T1.5 | `desktop/steam-transport.mjs`, `desktop/steam-server.mjs`, `desktop/steam-transport.test.mjs` |
| T2.2 | **Lobby discovery, invites, UI wiring.** Implement `SteamBridge` (§4.3); `hostType` routing; wire `app/page.tsx` (sole writer) to lobby screen + bridge. | T1.4, T0.3 | `game/steam.mjs`, `game/invite.mjs`, `app/ui/screens/SteamLobbyScreen.tsx`, `app/page.tsx`, `app/game-ui/steam-bridge.ts` |
| T2.3 | **Steam features mapping.** Pure mapping from `game/progression.mjs` achievements/stats; cloud save sync for the localStorage keys; rich presence. | T1.4 | `game/steam-achievements.mjs`, `game/steam-achievements.test.mjs`, `desktop/steam-features.mjs` |
| T2.4 | **Steam Deck / Linux.** Deck detection + defaults (1280×800, scaling), Steam Input action manifest, Proton notes. | T1.5 | `desktop/deck.mjs`, `desktop/deck.test.mjs`, `public/steam_input/steam_input_manifest.vdf` |

### Wave 3 — parallel (3 subagents)

| ID | Task | Depends on | Owned files |
|---|---|---|---|
| T3.1 | **Dedicated server mode.** Headless authority reusing `createGameServer` + `SteamServer`; anonymous Steam login; lobby advertises `hostType: dedicated`. | T1.2, T2.1 | `desktop/dedicated.mjs`, `desktop/dedicated.test.mjs` |
| T3.2 | **Packaging + depot pipeline.** electron-builder targets, redistributable shipping, NSIS/AppImage/deb, `steamcmd` vdf + upload script. | T1.5, T1.3, T1.4 | `scripts/package-desktop.sh`, `scripts/steam/app_build_windows.vdf`, `scripts/steam/app_build_linux.vdf`, `scripts/steam/upload.sh`, `desktop/resources/**` |
| T3.3 | **Docs + verification log.** Deployment/Steam sections, verification entries, docs index. | T1–T2 | `docs/DEPLOYMENT.md`, `docs/VERIFICATION.md`, `docs/README.md` |

### Wave 4 — serial (integration)

| ID | Task | Owner |
|---|---|---|
| T4.1 | Reconcile `app/page.tsx` wiring; resolve `package.json`/lockfile; run full `npm test` | orchestrator |
| T4.2 | Package + launch smoke test on Windows and Linux/Deck (manual; record honestly) | orchestrator |
| T4.3 | Update `docs/VERIFICATION.md`; freeze App ID / branch config | orchestrator |

---

## 7. File-ownership matrix (conflict prevention)

| Path | Sole writer |
|---|---|
| `game/transport.mjs`, `game/net*.mjs` | T1.1 |
| `server/game-server.mjs`, `server/room*.mjs`, `server/transport.test.mjs` | T1.2 |
| `vite.config.ts`, `next.config.ts`, `scripts/build-desktop.sh` | T1.3 |
| `desktop/steam.mjs` | T1.4 |
| `desktop/main.mjs`, `desktop/preload.mjs`, `desktop/protocol.mjs`, `desktop/security.mjs`, `electron-builder.yml` | T1.5 |
| `desktop/steam-transport.mjs`, `desktop/steam-server.mjs` | T2.1 |
| `game/steam.mjs`, `game/invite.mjs`, `app/ui/screens/SteamLobbyScreen.tsx`, `app/page.tsx`, `app/game-ui/steam-bridge.ts` | T2.2 |
| `game/steam-achievements.mjs`, `desktop/steam-features.mjs` | T2.3 |
| `desktop/deck.mjs`, `public/steam_input/**` | T2.4 |
| `desktop/dedicated.mjs` | T3.1 |
| `scripts/steam/**`, `scripts/package-desktop.sh`, `desktop/resources/**` | T3.2 |
| `docs/**` | T3.3 (then orchestrator) |
| `package.json`, `package-lock.json` | **orchestrator only** |

Rules:
- A subagent may **read** any file but may **write** only its owned set.
- If a task discovers a needed edit outside its set, it must leave a precise
  note in its final report; the orchestrator folds it into the next wave.
- `app/page.tsx` has exactly one writer per wave. Other tasks expose adapters
  (e.g. `steam-bridge.ts`) and never edit the page.

---

## 8. Verification plan

Per-wave focused commands (from `package.json`):

```bash
npm run test:game                 # game/*.test.mjs
npm run test:server               # server/*.test.mjs
npm run typecheck                 # tsc --noEmit
npm run build:desktop             # static desktop bundle -> dist-desktop/
npm run lint
node --test tests/*.test.mjs      # SSR / UI-contract / deployment guards
npm test                          # full gate, after build
```

Task-specific required tests:

- T1.1 `game/transport.test.mjs`: interface conformance, reconnect/close
  semantics, text passthrough, `bufferedAmount` tolerance.
- T1.2 `server/transport.test.mjs`: injected transport, `attachConnection`
  parity, `Room` runs with no Node-only APIs (grep-free assertion via a runtime
  guard).
- T2.1 `desktop/steam-transport.test.mjs`: text↔Buffer round trip, >1200-byte
  frames go reliable, packet ordering, `runCallbacks` pump with a fake binding.
- T2.3 `game/steam-achievements.test.mjs`: every `ACHIEVEMENTS` id maps, no
  duplicate stat names.
- T3.1 `desktop/dedicated.test.mjs`: boots, accepts one virtual peer, ticks a
  match to results.
- Non-test gates: `tests/ui-contract.test.mjs` must stay green after T2.2;
  `tests/rendered-html.test.mjs` must stay green (web build untouched).

Manual-only (record, do not claim):
- Steam overlay, cloud sync, invite dialog, Deck controller prompts,
  frame pacing, packaged-app launch on real hardware.

---

## 9. Steam release pipeline (product-side, not code)

1. **Onboarding first:** sign paperwork, pay $100, submit bank/tax/identity.
   The 30-day clock starts at payment.
2. **App setup:** create App ID, content/age survey, configure
   Windows/Linux depots, upload art (capsule sizes), screenshots, trailer.
3. **Store page:** publish the "coming soon" page and hold it ≥ 2 weeks.
4. **Builds:** `scripts/steam/upload.sh` → `steamcmd +run_app_build` to a
   `beta` branch; smoke-test via a Steam key; then set live for the 1–5 day
   review.
5. **Release:** set release date, press the button; keep the web/LAN build
   shipped unchanged from `arena.ussyco.de`.

---

## 10. Risks and decision log

| Risk | Impact | Mitigation |
|---|---|---|
| `steamworks.js` lacks SDR/NetworkingSockets | No modern relay/FakeIP; legacy P2P only | Ship legacy P2P v1; spike a native SDR addon as a separate stretch task (not on critical path) |
| Reliable packet size limits (1200 B unreliable / 1 MB reliable) | Snapshot frames may not fit unreliable | Send snapshots reliable or shard; measure `wireSize` in T2.1 |
| Renderer↔main IPC bridge complexity | Steam packets originate in main only | Freeze a narrow preload API in T1.5; T2.1 owns the adapter |
| Next/vinext static export fights SSR + Cloudflare plugins | `dist-desktop/` may need a dedicated entry | T1.3 is isolated; freeze output contract §4.4 before T1.5 |
| `app/page.tsx` is a large, contract-tested hotspot | Merge conflicts / broken `UiBag` | Single writer per wave; adapter files; `ui-contract` gate |
| Host authority exposed to cheating | Progression integrity | Keep ranked on the dedicated backend; run `sanityCheckResult` host-side |
| No host migration in `Room` | Host disconnect ends P2P match | Document as a limitation; dedicated backend is the mitigation |
| No GPU/browser verification here | False confidence | Honest verification log; mark manual checks |

---

## 11. Subagent prompt template

```
You are implementing task <TASK_ID> for the COCS Steam release.

GOAL: <one paragraph>

READ FIRST: docs/STEAM_RELEASE_PLAN.md (this plan), docs/ARCHITECTURE.md,
docs/TESTING.md, and the files you own.

OWNED FILES (write only these): <list>
DO NOT EDIT: <explicit list of other tasks' files>

FROZEN INTERFACES: §4 of the plan. Do not change them.

DELIVERABLE: <files + behavior>

ACCEPTANCE / EVIDENCE (must run and paste output):
  <focused test command(s)>

RULES:
  - Match existing conventions: ESM .mjs in game/ and server/, node:test with
    node:assert/strict, no comments unless the file already uses them.
  - Do not run npm install; package.json is orchestrator-owned.
  - Do not touch the lockfile.
  - Keep changes scoped to owned files.
  - If blocked, return a concise partial result and the exact blocker.

FINAL RESPONSE MUST INCLUDE: status, files changed, commands run + results,
seam/assumptions for the next wave, and any blocker.
```

---

## 12. Definition of done

- Web/LAN build and all existing tests unchanged and green (`npm test`).
- Desktop build starts offline to a playable bot match on Windows and Linux.
- Two Steam clients complete a P2P match through lobbies without modifying
  `game/core.mjs` or `server/room.mjs` game logic.
- Dedicated mode boots headless and accepts P2P clients.
- Windows + Linux installers and depot `vdf`s exist and have been uploaded to a
  beta branch.
- Steam features (achievements, cloud saves, rich presence, Deck defaults) work
  in a packaged build.
- `docs/DEPLOYMENT.md`, `docs/VERIFICATION.md` and `docs/README.md` reflect the
  new pipeline, with manual-only checks clearly labelled.
