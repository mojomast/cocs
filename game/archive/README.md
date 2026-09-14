# Archived tests

These tests are **not** part of `npm test` / `npm run test:game`. They were the
dominant cost of the suite (see below) and largely duplicate faster, focused
coverage, so they are kept here to run on demand rather than on every pass.

Run them explicitly:

```
npm run test:archive            # all archived tests
node --test game/archive/*.test.mjs
```

They import `../*.mjs`, so they must stay inside `game/archive/`.

## Why each file is archived

- **`expansion.test.mjs`** (~12 minutes on its own). Its final test sweeps every
  classic map and runs a full 300-second three-bot match per map (18,001 steps
  each) while also re-validating navigation, spawn clearance and pickups. That
  same ground is covered faster by:
  - `game/map-layout.test.mjs` — every arena × every supported mode placement,
    navigation round-trip and actor clearance.
  - `game/config.test.mjs` — every mode completes at every difficulty.
  - `game/maps.test.mjs`, `game/arenas.test.mjs` — registry/schema contracts.
  The file's fast, unique harness/weapon checks are covered by
  `game/harness-profiles.test.mjs`, `game/powerups.test.mjs`,
  `game/weapon-simulation.test.mjs` and `game/combat-integrity.test.mjs`.

- **`hardening.test.mjs`** (~1 minute). A grab-bag of integration regressions
  (assault/payload wins, zone navigability, mounted-bot behaviour, large-map
  objective progress). Each is covered by the dedicated suite:
  `game/payload.test.mjs`, `game/payload-layout.test.mjs`,
  `game/extra-modes.test.mjs`, `game/bot-behavior.test.mjs`,
  `game/vehicle-gameplay.test.mjs` and `game/map-layout.test.mjs`.

The duplicate "every combat mode completes" loop that also lived in
`game/bot-archetypes.test.mjs` was removed there (not archived) because the
canonical copy is in `game/config.test.mjs`.
