# Testing COCS

How the project is verified and how to run it. The unit/integration suite is
Node's built-in test runner (`node:test` + `node:assert/strict`); there is no
external test framework. A separate, optional Playwright harness
(`scripts/verify-browser.mjs`, `npm run test:browser`) checks the running app in
a real browser and is documented below.

---

## Scripts (`package.json`)

| Script | Command | Purpose |
| --- | --- | --- |
| `test:game` | `node --test game/*.test.mjs` | Fast engine/sim/presentation unit suite |
| `test:server` | `node --test server/*.test.mjs` | Room, registry, protocol, persistence, matchmaking |
| `test:archive` | `node --test game/archive/*.test.mjs` | Slow, previously dominant integration tests (on demand) |
| `test:all` | `test:game` && `test:archive` | Every game-layer test |
| `typecheck` | `tsc --noEmit` | TypeScript check for `app/`, `components/`, `lib/` |
| `build` | `bash scripts/build-verified.sh` | Bounded `vinext build`, required before the SSR test |
| `lint` | `bash scripts/sites-env.sh -- eslint .` | ESLint over the repo (ignores `dist`, `.next`) |
| `deploy` | `bash scripts/deploy.sh` | Build + restart + verify + rollback |
| `test:browser` | `node scripts/verify-browser.mjs` | Browser evidence against an already-running app (not part of `npm test`) |
| `test:graphics-lab` | `node scripts/verify-graphics-lab.mjs` | GPU shader output + graphics-lab UI evidence against a running dev preview |
| `test:browser:install` | `playwright install chromium` | Install the pinned Chromium build for the browser harness |
| `test` | `test:game` && `test:server` && `typecheck` && `build` && `node --test tests/*.test.mjs` | Full CI-style gate |

`npm test` deliberately rebuilds `dist/` because the top-level SSR test imports
the generated worker bundle. Run it in a checkout whose live service you are
willing to interrupt, or restart the web service afterward (see
`deploy/README.md`).

---

## The three layers

### 1. Game unit / simulation tests — `game/*.test.mjs`

Pure Node tests over the engine and its derivations. They exercise `Match`
deterministically with an injected RNG, plus config normalization, map schema
and layout, movement, weapons, objectives, modes, bots, vehicles, race, soccer,
single-player, HUD/radar/scoreboard helpers, replay/demo, and rendering *logic*
(quality tiers, interpolation, geometry helpers). Rendering tests assert
geometry/scene-graph/unit behaviour, not pixels.

Relevant examples: `game/core.test.mjs`, `game/config.test.mjs`,
`game/net.test.mjs`, `game/map-layout.test.mjs`, `game/arenas.test.mjs`,
`game/view.test.mjs`, `game/hud.test.mjs`, `game/software.test.mjs`,
`game/moth-bake-run.test.mjs`, `game/moth-bake-pixels.test.mjs`,
`game/moth-variants.test.mjs`, `game/moth-texture-variants.test.mjs`.

### 2. Server tests — `server/*.test.mjs`

Drive the authoritative server through its public API and the in-process
transport: rooms, registry, lifecycle/warmup/rematch, input dedup and edges,
event deltas, spectator, chat, voice, history, progression, matchmaking and
network behaviour. They do not open real sockets where an in-process transport
is sufficient.

Relevant examples: `server/room.test.mjs`, `server/rooms.test.mjs`,
`server/network.test.mjs`, `server/history.test.mjs`,
`server/progression.test.mjs`, `server/matchmaking.test.mjs`,
`server/spectator.test.mjs`, `server/resilience.test.mjs`,
`server/security.test.mjs`.

### 3. Contract / SSR / deployment tests — `tests/*.test.mjs`

- `tests/rendered-html.test.mjs` — imports the built worker
  (`dist/server/index.js`), issues a synthetic `Request`, and pins the
  server-rendered HTML: it must be `text/html`, reference at least one CSS and
  one JS asset that both exist under `dist/client`, contain no development
  preview metadata, and include specific pinned strings (`Colosseum Of
  Competitive Slop|COCS`, `Choose your intelligence`, `Claude Code`, the GitHub
  URL) and mode labels (`MATCH SETUP`, `Bot count`, `Casual Skirmish`,
  `Warmup`, `Rocket Party`, `SHUFFLE LOADOUT / MAP`, and at least four
  `GAME_MODES` names from `game/config.mjs`). This test requires a fresh
  `dist/`, which is why `build` precedes it in `npm test`.
- `tests/ui-contract.test.mjs` — parses the `const ui:UiBag={...}` literal in
  `app/page.tsx` and every field each `app/ui/screens/*.tsx` destructures or
  reads as `ui.<field>`, failing if a screen references a field the page never
  provides. This is the guard for the loosely typed `UiBag` contract.
- `tests/deployment-assets.test.mjs` — unit-tests
  `scripts/verify-deployment.mjs`: `linkedAssets` deduplicates asset URLs;
  `verifyDeployment` rejects a title footer that is not the exact
  `vX.Y · CODENAME` release string (even when the new version appears elsewhere
  in the HTML), missing CSS/JS, and an HTML fallback served with a 200 but the
  wrong content type.

---

## Optional local study recorder — `game/study-log.test.mjs`

WP3.2 adds `game/study-log.mjs`, a pure, deterministic, device-local recorder
that stays off until the player switches it on in **Settings → Study**. It is
inspectable (`DOWNLOAD JSON`) and deletable (`DELETE LOG`); nothing is persisted
and nothing is sent over the network.

What the tests pin (run `node --test game/study-log.test.mjs`):

- the versioned envelope (`schemaVersion`, `buildCommit`, ephemeral session id,
  `sequence`, non-decreasing `monotonicMs`, `eventName`, and the coarse
  `journeyStage` / `inputClass` / `viewportBucket` / `accessibilityFlags`);
- consent gating: a disabled log ignores every append, enabling starts a fresh
  ephemeral session, disabling deletes the buffer, and delete breaks
  linkability by minting a new session id;
- validation/clamping: unknown event names and payloads over 12 keys / 512
  bytes are rejected, forbidden identity/chat/voice/key/geometry keys reject
  the payload, and free text, UUID/IP-like or over-long values are dropped;
- the 512-event bounded ring buffer and its drop counter;
- monotonic offsets under a backwards clock (no `Date.now()` anywhere) and
  byte-identical serialization for equal logs;
- coverage of the required journey transitions (`surface_viewed` through
  `second_match_started`).

The page only wires emissions (`appendStudyEvent` no-ops without consent) and
the settings panel renders the controls. Payloads carry coarse tokens and
bounded numbers only: no player UUID/progress token, IP, name, chat, voice,
exact keys, raw input, precise positions or free text. Replays and voice
capture remain a separate consent decision and are untouched by this recorder.

---

## Archived tests — `game/archive/`

`game/archive/README.md` documents why. In short, these two files were the
dominant cost of the suite and largely duplicate faster, focused coverage, so
they are excluded from `npm test`/`test:game` and run only via `test:archive`:

- `game/archive/expansion.test.mjs` — once ~12 minutes on its own; its final
  test sweeps every classic map with a full 300 s three-bot match per map
  (18,001 steps each) while re-validating navigation, spawn clearance and
  pickups. That ground is covered faster by `game/map-layout.test.mjs`,
  `game/config.test.mjs`, `game/maps.test.mjs`, `game/arenas.test.mjs`, plus
  `game/harness-profiles.test.mjs`, `game/powerups.test.mjs`,
  `game/weapon-simulation.test.mjs` and `game/combat-integrity.test.mjs`.
- `game/archive/hardening.test.mjs` — once ~1 minute; an integration grab-bag
  (assault/payload wins, zone navigability, mounted bots, large-map progress)
  now covered by `game/payload.test.mjs`, `game/payload-layout.test.mjs`,
  `game/extra-modes.test.mjs`, `game/bot-behavior.test.mjs`,
  `game/vehicle-gameplay.test.mjs` and `game/map-layout.test.mjs`.

Archived tests import `../*.mjs`, so they must stay inside `game/archive/`. A
duplicate "every combat mode completes" loop was removed outright from
`game/bot-archetypes.test.mjs` because the canonical copy lives in
`game/config.test.mjs`.

---

## Tracked browser verification harness (`npm run test:browser`)

`scripts/verify-browser.mjs` is a dependency-light Playwright runner tracked for
the v8.4 improvement plan's cross-cutting browser gate (item 4, required before
WP1.1 acceptance). It is deliberately **not** wired into `npm test`: it needs an
already-running app and a Chromium build, and it is slower than the unit suites.

### Run it

```bash
npm install                        # installs the pinned playwright devDependency
npx playwright install chromium    # or: npm run test:browser:install
npm run dev -- --host 127.0.0.1 --port 4173   # in one shell (or npm start)
BROWSER_BASE_URL=http://127.0.0.1:4173 npm run test:browser
```

The app must be started separately — the harness never starts or stops the app,
the web service or the game server. `BROWSER_BASE_URL` defaults to
`http://127.0.0.1:3000`. When a Playwright cache already exists, the runner
reuses the first cache that contains the pinned Chromium revision
(`~/.cache/ms-playwright`, `~/.opencode-v2/cache/ms-playwright`, or an explicit
`PLAYWRIGHT_BROWSERS_PATH`) instead of downloading it again.

Useful options and environment: `--only=1366x768,844x390` (subset), `--headed`,
`--trace` (Playwright traces are large and off by default; enable with
`--trace` or `BROWSER_TRACE=1`), `--out=DIR`, `BROWSER_DPR`,
`BROWSER_TIMEOUT_MS`, `BROWSER_NAVIGATION_TIMEOUT_MS`, `BROWSER_HUD_TIMEOUT_MS`,
`BROWSER_LAUNCH_ATTEMPTS`, `BROWSER_SETTLE_MS`, `BROWSER_HEADED`.

### What it proves

For each required viewport — 1366x768, 1920x1080, 844x390, 390x844, and 844x390
repeated at `--ui-scale:1.4` — the runner starts from a fresh profile
(`token-arena-onboarded=1`), enters the title, opens the LATTICE / OPERATIONS
(`cocs-coop`) practice briefing, deploys, and asserts:

- no console or page errors during the flow (a tiny, explicitly listed set of
  documented preview-only messages is recorded in the manifest but ignored);
- the HUD is present (`.game-hud`, live match status, player status, LATTICE
  front readout and the order strip);
- `documentElement.scrollWidth <= innerWidth` and no visible element extends
  past the viewport horizontally (`document.scrollWidth` is not a Chromium
  property; the root scroll width is its portable equivalent);
- the persistent HUD panels do not intersect a crosshair corridor of at least
  48 CSS px around the crosshair;
- on touch viewports, `document.elementsFromPoint()` at the centre of every
  visible touch action button returns that button — the B1 touch-capture
  regression class, including jump/fire/interact.

Every run writes `artifacts/browser/<timestamp>-<commit>/<viewport>/hud.png`,
an optional `trace.zip`, and one `manifest.json` recording the commit and dirty
state, `/api/version`, browser name/version/launch flags, viewport, DPR, UI
scale, input mode, renderer, command, per-assertion geometry, console/network
logs and the result. `artifacts/` is gitignored. Stdout is one line of JSON
summary; human-readable progress goes to stderr. Exit codes: `0` pass, `1`
failed assertion or failed manifest write, `2` missing browser setup.

### What it does not prove

This harness is **technical evidence only**. It cannot show that the game is
fun, readable, comfortable, understandable or worth replaying, and it does not
replace physical-device or assistive-technology validation: Chromium
`hasTouch` emulation is not iOS Safari or Android Chrome multi-touch, and
geometry/hit tests are not human playtests, NVDA/VoiceOver listening or
hardware pointer-lock checks. An all-green matrix is not a release sign-off.
A non-zero exit while the correlated B1/C1 layout findings remain open is
useful evidence, not harness breakage.

---

## Graphics lab harness (`npm run test:graphics-lab`)

`scripts/verify-graphics-lab.mjs` is a second Playwright runner for the opt-in
Graphics lab preview. Like `test:browser` it is not part of `npm test` and never
starts or stops the app; unlike it, it imports source modules through Vite and
therefore targets a **dev server** (`BROWSER_BASE_URL`, default
`http://127.0.0.1:4173`), not a production build.

It proves two things. First, actual GPU output: a deterministic color/checker
`DataTexture` is rendered through the real `GraphicsLabPass` on a headless
WebGL renderer, and every catalogue layer (including the three layers built from
baked Moth assets, which are also exercised with every non-default asset
option), every starting recipe and the full stack must change pixels; zero-mix
and the original half of split mode must match the untouched image exactly; and
all combinations must reuse one shader program (uniform-only reconfiguration, no
recompilation). Second, the real UI: recipe loading, the SURPRISE ME randomizer,
independent layer stacking, A/B bypass, split mode, clipboard recipe copy
(including selected asset options), pasting and applying a recipe JSON, the
backquote toggles (` and Shift+`), reset-to-off, drawer geometry at the five
standard viewport/UI-scale cases, device-local persistence across reload, and
that the drawer opens from a paused match as the single modal dialog without
stealing the pause state.

Every run writes screenshots and `verification.json` to the gitignored
`artifacts/graphics-lab/`. It does **not** prove art-direction quality, human
preference, physical-device WebGL behaviour or performance on real hardware;
those remain human review items.

---

## What is pinned / contract-tested

- **SSR strings** — `tests/rendered-html.test.mjs` pins the rendered HTML
  contract (asset links, absence of preview metadata, brand/copy/mode labels).
- **`UiBag` field contract** — `tests/ui-contract.test.mjs` rejects any screen
  reading a `ui` field the page does not supply.
- **Title footer version** — `scripts/read-version.mjs` `footerVersion()`
  matches `app/page.tsx`'s title footer; `scripts/deploy.sh` uses it as the
  release-of-record and `tests/rendered-html.test.mjs` asserts the rendered
  asset set. (Note the footer version and `package.json` version are separate
  and may differ.)
- **Deployment assets** — `tests/deployment-assets.test.mjs` pins the behavior
  of `linkedAssets`/`verifyDeployment`, and `verifyDeployment` is what
  `deploy.sh` gates the live site on.
- **Map layout / schema** — `game/map-layout.test.mjs`, `game/arenas.test.mjs`,
  `game/map-schema.test.mjs` pin registry membership, placement validity,
  navigation round-trips and actor clearance.
- **Legacy HUD** — `game/race-ui.test.mjs`, `game/touch-ui.test.mjs` and
  `game/scoreboard.test.mjs` render `app/game-ui/*.tsx` and
  `game/scoreboard.mjs` by path; their exports, props and class strings are a
  hard contract.

---

## Current counts

Last verified on release v8.6 PRISM (2026-09-20); the v8.6 gate recorded:

- `npm run test:game` — **2,652 pass, 0 fail, 8 skipped** across the
  `game/*.test.mjs` suite (2,660 tests). The eight skips are the opt-in long
  simulations and
  the browser-only render: the D1-D4 sampled win-rate sweep, the exhaustive
  8-bot mode sweep, the 18k-step 4-bot match, the 10k-step 8-bot race, the
  4×1800-step platform-bot sweep, both `route-sweep` cases (movement verbs over
  all 41 arenas and bot navigation over all 39 non-race arenas) and the
  `OfflineAudioContext` soundtrack render. They are opt-in: run
  `npm run test:game:slow` (or `COCS_SLOW_TESTS=1 npm run test:game`) on a
  machine with the budget. `--test-timeout` is set on every script so a stuck
  test fails instead of hanging forever.
- `npm run test:server` — **209 pass, 0 fail**, across `server/*.test.mjs`.
- `node --test tests/*.test.mjs` — **82 pass, 0 fail**; SSR, UI contract,
  deployment assets, browser-harness helpers and the modal-stack DOM checks all
  green.
- `npx tsc --noEmit` — clean; `npm run lint` — 0 errors (warning baseline
  unchanged); bounded `vinext build` — green.
- `npm run test:browser` (against a running app) — **5/5 viewports pass** at
  1366×768, 1920×1080, 844×390, 390×844 and 844×390 at UI scale 1.4, with hit
  testing, reticle-corridor checks, overflow checks and console/page-error
  checks. The first v8.5 candidate run caught a real post-match crash this way;
  the harness is a release gate for the surfaces it covers.
- `npm run test:graphics-lab` (against a running dev preview) — **pass**: the
  real GPU shader changes pixels for all twelve effects, all six recipes and the
  full stack in one program; zero-mix and split-original are pixel-identical;
  the drawer, stacking, bypass, reset, persistence and paused-match modal
  behaviour pass at all five viewports. Run at v8.6 (2026-09-20).
- `game/archive/*.test.mjs` — 2 files, run on demand, not counted above.
  `game/archive/balance-sweep.test.mjs` is the opt-in balance sweep hook
  (`COCS_SLOW_TESTS=1` smoke, `COCS_SWEEP=full` full profile; tier alarms are
  signal, not failures). The CLI path is
  `node scripts/balance-sweep.mjs --profile smoke|full --print-tierlist`, which
  writes `reports/balance-<release>.json`.

These counts come from a real run on that release; re-run the suites to confirm
them after changes rather than trusting this table.

---

## Honest limitations

- **GPU output is verified by shader harness, not by frame pacing.** The
  graphics-lab harness compiles and executes the real shader in headless
  Chromium (SwiftShader in CI) and asserts pixel changes and identity for
  bypass/zero-mix. `view.test.mjs` and `software.test.mjs` verify geometry,
  scene-graph wiring, quality-tier logic and the CPU renderer's unit behaviour.
  None of these measure frame rate, shadow quality, texture quality at
  glancing angles or visual appeal on real hardware. A passing suite is not GPU
  performance evidence.
- **The archive suite is slow.** `expansion.test.mjs` was measured in the ~12
  minute range; expect `test:archive` to dominate any full run.
- **SSR tests require a build.** `tests/rendered-html.test.mjs` imports
  `dist/server/index.js`; a stale or missing `dist/` produces misleading
  failures. Rebuild first.
- **The `UiBag` guard is static.** It catches field-name mismatches, not wrong
  field types or runtime-only assumptions.
- **Deployment verification is a live-network test.** `verify:deployment`
  checks a running URL, not a local checkout.

---

## Adding a test for a new system

1. **Location.** Put pure engine/server tests as `game/<module>.test.mjs` or
   `server/<name>.test.mjs` so the `test:game`/`test:server` globs pick them up.
   Put SSR/asset/contract guards in `tests/*.test.mjs`. Put slow integration
   sweeps in `game/archive/` and document them in
   `game/archive/README.md`.
2. **Shape.** Use `import test from 'node:test'` and
   `import assert from 'node:assert/strict'`. Prefer small, named tests over
   one mega-test; one file per module is the prevailing convention.
3. **Determinism.** Inject an RNG into `Match` and avoid `Date.now()` /
   `Math.random()` in assertions. For netcode, drive `NetHarness` rather than a
   real socket so latency/jitter/loss are reproducible.
4. **Isolation.** A test must not depend on execution order or on shared
   mutable module state. Construct fresh `Match`/`Room`/store instances with
   injected paths (`historyPath`, `progressionPath`) instead of touching repo
   files.
5. **Run it.** `node --test game/your-module.test.mjs` (or
   `node --test server/your-module.test.mjs`) for the focused loop, then
   `npm run test:game` / `npm run test:server` and `npm run typecheck` for the
   layer.
6. **Update the pin.** If the change touches SSR output, the `UiBag` fields,
   legacy HUD exports/class strings, map registries, or the release footer,
   update the corresponding contract test in the same change. Never loosen a
   pin just to make a change pass.
