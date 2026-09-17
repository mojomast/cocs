# Balance sweep reports

Machine-generated evidence for the COCS balance sweep
(`docs/design/CLASS_OVERHAUL.md` §7.5 and §14), produced by
`node scripts/balance-sweep.mjs --profile smoke|full --print-tierlist`.

Each `balance-<release>.json` is one CLI run and contains two sweep runs:

- **policy-neutral** (one archetype for every seat) — the balance gate; tier
  alarms (god/garbage), locked-mode pairing floors, team-mode reachable
  answers, ability damage share and the §4.1 stat envelope are computed here.
- **policy-on** (class AI policies) — class expression; movement-verb usage
  floors are reported here.

Every run carries `{release, dataHash, seedManifest}` plus the executed item
log. The seed is `fnv1a32('mode|map|matchup|seedIndex|geared')`, so any alarm
is reproducible one match at a time:

```bash
node scripts/balance-sweep.mjs --profile smoke --policy neutral \
  --only=<mode>,<matchup>,<seed> --print-tierlist
```

Tier alarms are signal, not release blockers: Phase 5 owns the tuning pass
(compress outliers, one change at a time).

## Truncated runs are refused, not misread

`--budget-ms` clips whole manifest items from the tail, so a clipped run is not
the planned rotation and its low-sample rows are artifacts (the P3-D false
alarms; see commit `9ae6208`). The report therefore carries `truncated: true`
at both the run and top level, `computeAlarms` returns only a single
`kind: 'truncated'` warning (every tier/mode alarm is suppressed), and the CLI
prints a loud banner and exits non-zero. `--budget-ms 0` runs the whole profile.
A truncated report is evidence of a host problem, never a balance result.

## Mode viability at full sample

Every run's `metrics.modeViability` carries the team-mode "≥2 reachable
answers at ≤60% aggregate" count and the locked-mode worst-pairing floor,
computed over the full sample the run actually executed. The same numbers drive
the `team-answers` / `locked-floor` alarms.

## Stock vs max gear (§4.8.6)

Run `--gear max` with `--baseline reports/balance-v7-stock.json` and the report
gains `gearInvariant`: per-row Spearman rank correlation, max rank shift,
max win-rate gain and any class crossing 45/55 between the two neutral runs.
Gate: rho ≥ 0.85, shift ≤ 2, gain ≤ 4 points, no crossing.

## Route sweep

`game/route-sweep.test.mjs` is the opt-in (§7.9) all-arena check:

```bash
COCS_SLOW_TESTS=1 node --test game/route-sweep.test.mjs
```

It drives all nine movement verbs on all 41 registered arenas (bounds/ceiling
containment and per-activation translation budget) and runs a short bot match on
all 39 non-race arenas (no navigation stall, no bounds escape).

