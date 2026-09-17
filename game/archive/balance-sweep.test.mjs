// Integration hook for the balance sweep — Phase 3D of the COCS class &
// harness overhaul (docs/design/CLASS_OVERHAUL.md §7.5, §14).
//
//   COCS_SLOW_TESTS=1 node --test game/archive/balance-sweep.test.mjs   # smoke
//   COCS_SWEEP=full   node --test game/archive/balance-sweep.test.mjs   # full
//
// The smoke pass is budget-capped by default so the hook stays usable on a
// busy host; COCS_SWEEP_BUDGET_MS overrides it (0 = whole profile). Tier
// alarms are signal, not test failures — only crash/error rows fail the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import {slowTestsEnabled} from '../test-support.mjs';
import {formatTierList, runSweep} from '../balance-sweep.mjs';

const FULL = process.env.COCS_SWEEP === 'full';
const ENABLED = slowTestsEnabled() || FULL;
const SKIP = ENABLED ? false : 'slow test: set COCS_SLOW_TESTS=1 (smoke) or COCS_SWEEP=full (full profile)';
const BUDGET = Number(process.env.COCS_SWEEP_BUDGET_MS || (FULL ? 0 : 120000)) || null;
const RELEASE = process.env.COCS_RELEASE || 'sweep-test';

test('balance sweep smoke: no crash rows, a tier list and reproducible seeds', {skip: SKIP, timeout: FULL ? 3600000 : 900000}, () => {
  const started = Date.now();
  const report = runSweep({profile: FULL ? 'full' : 'smoke', policy: 'neutral', release: RELEASE, budgetMs: BUDGET});
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  assert.ok(report.completed > 0, 'the sweep must run at least one match');
  assert.deepEqual(report.errors, [], `no crash/error rows (${JSON.stringify(report.errors.slice(0, 3))})`);
  assert.ok(report.items.every(entry => entry.over === true), 'every completed match must be over');
  assert.ok(report.items.every(entry => entry.appearances.length > 0));
  assert.equal(report.release, RELEASE);
  assert.ok(report.dataHash > 0);
  assert.equal(report.seedManifest.items.length, report.planned);
  assert.ok(report.tierlist.operators.length >= 4);
  assert.ok(report.tierlist.specs.length >= 4);
  const seeds = new Set(report.seedManifest.items.map(item => item.seed));
  assert.equal(seeds.size, report.seedManifest.items.length, 'every manifest item has a distinct seed');
  console.log(`balance-sweep ${report.profile} (${report.policy}): ${report.completed}/${report.planned} matches in ${elapsed}s, ${report.alarms.length} alarms`);
  console.log(formatTierList(report));
});
