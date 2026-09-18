# Testing COCS

How the project is verified and how to run it. The suite is Node's built-in
test runner (`node:test` + `node:assert/strict`); there is no browser test
runner and no external test framework.

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
`game/view.test.mjs`, `game/hud.test.mjs`, `game/software.test.mjs`.

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
  `verifyDeployment` rejects missing CSS/JS, a stale release string, and an
  HTML fallback served with a 200 but the wrong content type.

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

Last verified on release v7.2 (2026-09-18), on the `feat/moth-audio-wiring`
worktree (the Moth audio wiring merged fast-forward into production at
`4b9862b`):

- `npm run test:game` — **2018 tests: 2011 pass, 0 fail, 7 skipped**, across
  182 `game/*.test.mjs` files (553 s). The wiring pass adds
  `moth-audio-wiring` (deferred factory mount/dispose, scene routing, outcome
  motif selection, echo-map selection, reduced motion and the no-context path)
  and extends `moth-wiring` with the per-arena echo map, on top of the v7.1
  audio suites (sampled bank `sampler`, arrangement/leitmotif/form
  `music-arrangement`, the Moth bank and layer `moth-audio`, the audio bakers
  `moth-bake-audio` and the pass-3 generators `moth-bake-generators`); the
  all-arena `route-sweep` and the balance sweep remain opt-in. The production
  checkout re-ran `changelog` at **3/3**.
- The 7 skipped tests are long simulations (an exhaustive 8-bot all-modes sweep,
  an 18k-step 4-bot match, a 10k-step 8-bot race, a 4×1800-step platform-bot
  sweep, both opt-in `route-sweep` cases over all 41 arenas × 9 verbs and all 39
  non-race arenas, and an `OfflineAudioContext` soundtrack render that only runs
  in a browser) that take many minutes on a machine without 3D hardware. They are
  opt-in: run `npm run test:game:slow` (or `COCS_SLOW_TESTS=1 npm run test:game`)
  on a machine with the budget. `--test-timeout` is set on every script so a
  stuck test fails instead of hanging forever. The opt-in `route-sweep` passes
  all 41 arenas × 9 verbs plus bot navigation on all 39 non-race arenas.
- `npm run test:server` — **159 pass, 0 fail**, across 16 `server/*.test.mjs`
  files.
- `node --test tests/*.test.mjs` — **7 pass, 0 fail** (SSR, UI contract,
  deployment), re-ran against the v7.2 production build; the v7.2 deploy
  re-verifies the served assets.
- `npx tsc --noEmit` — clean; `npm run lint` — 0 errors (488 warnings only);
  bounded `vinext build` — green.
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

- **No browser or GPU verification in this environment.** `view.test.mjs` and
  `software.test.mjs` verify geometry, scene-graph wiring, quality-tier logic
  and the CPU renderer's unit behaviour. They do not verify WebGL output,
  shader compilation, shadow quality, bloom, or frame rate on real hardware.
  A passing suite is not GPU performance evidence.
- **Visual claims are geometry/unit-verified.** "The model has a muzzle anchor"
  is testable; "it looks correct" is not tested here.
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
