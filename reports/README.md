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
