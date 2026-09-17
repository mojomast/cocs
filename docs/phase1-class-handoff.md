# Phase 1 handoff — class & harness overhaul (data-driven core)

Branch: `feat/class-overhaul` (worktree `/home/mojo/projects/tokenarena-class`),
based on `fb8dd74` (deployed phase-2 tip).
Plan: `docs/design/CLASS_OVERHAUL.md` §12.2 Phase 1, §13 (schema), §15 (kickoff).

## Landed

| Task | Commit | What |
| --- | --- | --- |
| 2 | `76835bb` | `game/kits.mjs`: frozen `KINDS`, `WINGS`, `OPERATOR_KITS` (9), `SPECS` (7), `MOVEMENT_VERBS` (9), `MOVEMENT_HOOK_BY_SPEC`, `resolveKit()`; `operator-profiles.mjs` is now a shim over `OPERATOR_KITS` with byte-compatible exports |
| 3 | `76835bb` | `kind`/`buff`/`magnitude` on the 7 resolved harness abilities + memoized `abilityOf()` |
| 4 | `76835bb` | `game/ability-parity.test.mjs` + `game/fixtures/ability-parity.json`: pre-router `power()` traces for all 7 harnesses across deathmatch and CTF (cooldown/active/activeSpeedMultiplier per step, event order, checkpointed effects, guards) |
| 5-6 | `fd03b4b` | `power()` routes on `ability.kind` (heal/dash/slow/burst) with byte-identical bookkeeping; speed/resistance/fire-rate reads go through `activeBuff()` |
| 7 | `fd03b4b` | Dead leftovers removed: `handling.activeFireRate` operand, unused `handling.affinity` copy (one pin upgraded to a stronger `favored` assertion), unreferenced vehicle labels |
| 8 | `fd03b4b` | `NetClient.createShadow(mapId, config, loadout)` + `NetHarness` `loadout` option; regression test proves the shadow predicts with the real operator/harness and movement stats |

## Verification

- Golden parity: `node --test game/ability-parity.test.mjs` — unchanged across the router refactor.
- Focused: kits/harness-profiles/operator-profiles/data/stats/core/net/parity — 98 tests, 97 pass, 1 skipped (browser-only audio render).
- Phase 1 gate (plan §12.3): **green** — `test:game` (0 failures, 5 skipped),
  `test:server` 153/153, `npx tsc --noEmit` clean, `npm run lint` 0 errors
  (428 pre-existing warnings). The first gate run surfaced one pre-existing lint
  error in `app/review/page.tsx` (synchronous `setState` in an effect); the
  reticle query now resolves in a cancellable `requestAnimationFrame`, so the
  behaviour is unchanged and the rule is satisfied.

## Decisions made where the plan was silent

- The ability dispatch fields ride on the resolved `ability` object (so `abilityOf() === harnessAbility()`), with `magnitude` mirroring the legacy harness table exactly — this is what keeps `power()` bookkeeping byte-identical.
- `preferred[3]`: slots 0-1 keep the legacy two-weapon order; the third is a per-role choice. Phase 2 may re-cut.
- `MOVEMENT_VERBS` budget fields live under `budget`; `carrier` is `{drop, weakened, lift}`; the shared weakened numbers stay one global §3.7 rule.
- `resolveKit().fingerprint = character:harness:verb:movement:kind`; gear is pass-through and excluded while inert.
- Plan typo corrected: OpenCode's Vanguards rider now reads "the burst lasts 1 s longer" (was "Guardrail lasts 1 s longer", Guardrail being Claude Code's active).

## Next (Phase 2, per §12.2)

Full `OPERATOR_KITS` + stat re-cut (`game/stats.test.mjs` re-pinned in the same
commit), per-wing signature verbs, the movement framework (fuel/charge/cooldown/
landing hooks, the `mobility` edge, snapshots), nine verbs, the carrier rule, bot
policies, movement netcode, SYSTEMS.md. The parity fixture must stay green; the
`mobility` bind and `PROTOCOL_VERSION` bump belong to Phase 4.
