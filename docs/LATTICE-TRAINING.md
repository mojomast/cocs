# LATTICE FIELD TRAINING

A short, skippable, do-then-teach course that runs as an ordinary local match.
The point is to make the mode legible before a player's first real match:
capture, supply, orders, devices, depots — and, in Operations, the spend
window, terminals and waves.

## Principles

- **Play first, explain second.** Every step completes by doing the real thing
  in a real match; text explains *why* once it is done.
- **One step at a time.** The banner shows the current step only, with the
  next step locked until the current one completes. No checklist wall.
- **Never a gate.** Training is local, bots fill the enemy team, and the
  player can skip or leave at any step. It does not affect ranked or records.
- **Authoritative detection.** Steps advance from `Match.events` and the
  snapshot only (`game/lattice-training.mjs`), never from UI state, so a
  replay or a network match would teach identically.
- **Accessible by default.** Text + captions for every step, remappable keys
  in the copy, no timed steps, reduced-motion safe.

## Course

Both modes share the first-minute steps and then diverge. Steps in order:

| # | `cocs` | `cocs-coop` | Completes when |
|---|---|---|---|
| 1 | MOVE OUT | MOVE OUT | the player travels 12 m from spawn |
| 2 | LIVE FIRE | LIVE FIRE | 5 local `shot` events |
| 3 | TAKE YOUR FRONT | TAKE YOUR FRONT | a team-0 `cocs-capture` |
| 4 | KEEP THE LINE | KEEP THE LINE | an owned node links back to an owned HQ |
| 5 | ISSUE AN ORDER | SPEND THE WINDOW | a team `cocs-order` / `coop-spend` |
| 6 | RIDE THE ROUTE | ISSUE AN ORDER | `cocs-device-use` / team `cocs-order` |
| 7 | SECURE A DEPOT | START A TERMINAL | `cocs-depot-capture` / a terminal channel |
| 8 | — | HOLD THE WAVE | `director-wave-cleared` |
| 9 | — | RIDE THE ROUTE | `cocs-device-use` |

## Integration

- **Entry:** a FIELD TRAINING card in the Quick Start panel (above the two
  LATTICE modes). It starts a local `cocs` or `cocs-coop` match on Lattice
  Foundry with a low bot count and this plan attached.
- **In match:** a compact banner renders `trainingView(training)`: title,
  `index/total`, the current step's title and detail, and a completed tick
  list behind a details fold. The existing field coach and interaction
  prompts keep running.
- **Between steps:** the completed step's line stays for a few seconds as a
  "STEP CLEAR" beat with the usual announcer treatment.
- **Exit:** pause menu offers END TRAINING; completion offers a small XP
  award and a RETURN TO LOADOUT button. Skipping never blocks progression.
- **Operations extras:** the spend-window step waits for a real spend window
  and instructs the cursor-mode controls from the UX pass; the terminal step
  accepts any of HACK / DEPLOY / VAULT.

## Engine

`game/lattice-training.mjs` is a pure module:

- `createTraining(mode, {start})` → frozen plan cursor, `null` outside LATTICE.
- `evaluateTraining(training, {snapshot, events, playerId, lattice})` → the
  next state plus the step that just completed; never mutates inputs.
- `trainingView(training)` → banner model for the HUD.
- `skipTraining(training)` → idempotent early end.

`game/lattice-training.test.mjs` drives the whole course for both modes with
synthetic events and snapshots, proves enemy actions teach nothing, and
checks the supply-link step against the map lattice.
