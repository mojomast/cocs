#!/usr/bin/env node
// Balance sweep CLI — COCS class & harness overhaul Phase 3D
// (docs/design/CLASS_OVERHAUL.md §14).
//
//   node scripts/balance-sweep.mjs [--profile smoke|full] [--out reports/balance-<release>.json]
//        [--print-tierlist] [--only=<mode,matchup,seed>] [--policy neutral|on]
//        [--gear stock|max] [--budget-ms N] [--max-matches N] [--json] [--quiet]
//
// Runs the policy-neutral sweep first (the balance gate) and the policy-on
// sweep second (class expression, verb-usage floors). `--budget-ms` is the
// total wall-clock budget across runs; the sweep truncates whole manifest items
// from the tail only, so every remaining item stays reproducible with --only.
// A truncated run exits non-zero, prints a loud banner and suppresses every
// sample-derived tier alarm (§14 / P3-tune finding). `--budget-ms 0` runs the
// whole profile. `--baseline <stock report>` adds the §4.8.6 gear invariant.

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {footerVersion} from './read-version.mjs';
import {SEED_FORMULA, formatTierList, gearTierInvariant, runSweep, sweepSeed} from '../game/balance-sweep.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Total wall-clock budgets (across both policies) that keep the documented
// smoke ≈4–5 min / full ≈30–35 min envelopes on the calibration host.
const DEFAULT_BUDGET_MS = {smoke: 300000, full: 2100000};

const VALUED_FLAGS = new Set(['--profile', '--out', '--only', '--policy', '--gear', '--budget-ms', '--max-matches', '--modes', '--maps-per-mode', '--seeds', '--cycles', '--release', '--baseline']);

function parseArgs(argv) {
  const args = {profile: 'smoke', policies: ['neutral', 'on'], geared: 'stock', only: null, out: 'reports/balance-<release>.json', printTierlist: false, json: false, quiet: false, budgetMs: null, maxMatches: null, release: null, modes: null, mapsPerMode: null, seedIndexes: null, cycles: null, baseline: null};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const [flag, inline] = token.includes('=') ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)] : [token, null];
    const value = inline ?? (VALUED_FLAGS.has(flag) ? argv[++index] : true);
    if (flag === '--profile') args.profile = value;
    else if (flag === '--out') args.out = value;
    else if (flag === '--print-tierlist') args.printTierlist = true;
    else if (flag === '--only') args.only = value;
    else if (flag === '--policy') args.policies = String(value).split(',').map(entry => entry.trim()).filter(Boolean);
    else if (flag === '--gear') args.geared = value;
    else if (flag === '--budget-ms') args.budgetMs = Number(value);
    else if (flag === '--max-matches') args.maxMatches = Number(value);
    else if (flag === '--modes') args.modes = String(value).split(',').map(entry => entry.trim()).filter(Boolean);
    else if (flag === '--maps-per-mode') args.mapsPerMode = Number(value);
    else if (flag === '--seeds') args.seedIndexes = Number(value);
    else if (flag === '--cycles') args.cycles = Number(value);
    else if (flag === '--release') args.release = value;
    else if (flag === '--baseline') args.baseline = value;
    else if (flag === '--json') args.json = true;
    else if (flag === '--quiet') args.quiet = true;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`unknown argument ${token}`);
  }
  return args;
}

function readRelease(explicit) {
  if (explicit) return explicit;
  try {
    const html = readFileSync(resolve(ROOT, 'app/page.tsx'), 'utf8');
    const version = footerVersion(html);
    if (version) return version;
  } catch { /* fall through to the package version */ }
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  return pkg.version ? `v${pkg.version}` : 'unreleased';
}

function usage() {
  return [
    'usage: node scripts/balance-sweep.mjs [--profile smoke|full] [--out reports/balance-<release>.json]',
    '         [--print-tierlist] [--only=<mode,matchup,seed>] [--policy neutral|on]',
    '         [--gear stock|max] [--budget-ms N] [--max-matches N] [--json] [--quiet]',
    '         [--modes=a,b] [--maps-per-mode N] [--seeds N] [--cycles N]',
    '         [--baseline reports/balance-stock.json]  # §4.8.6 gear tier invariant',
    '',
    `default budget: smoke ${DEFAULT_BUDGET_MS.smoke / 1000}s · full ${DEFAULT_BUDGET_MS.full / 1000}s (total, split across policies)`,
    'budget 0 = run the whole profile; a clipped run exits non-zero and suppresses every tier alarm',
    `seed = fnv1a32('${SEED_FORMULA}'), e.g. ${sweepSeed('deathmatch', 'crosswire', 'ffa-0', 0, 'stock')}`,
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  const release = readRelease(args.release);
  const only = args.only || null;
  const policies = args.policies.length ? args.policies : ['neutral', 'on'];
  // `--budget-ms 0` (and any non-positive value) means "run the whole profile":
  // it is the explicit no-truncation run the §12.3 Phase-5 gate needs.
  const budgetExplicit = Number.isFinite(args.budgetMs);
  const budgetMs = budgetExplicit ? args.budgetMs : DEFAULT_BUDGET_MS[args.profile] ?? DEFAULT_BUDGET_MS.smoke;
  const unlimited = !Number.isFinite(budgetMs) || budgetMs <= 0;
  const started = Date.now();
  const runs = [];
  let progressAt = 0;
  for (const policy of policies) {
    const perRunBudget = unlimited ? null : Math.max(1, Math.floor(budgetMs / policies.length));
    const report = runSweep({
      profile: args.profile, policy, geared: args.geared, only, release,
      budgetMs: perRunBudget, maxMatches: args.maxMatches,
      modes: args.modes ?? undefined, mapsPerMode: args.mapsPerMode ?? undefined,
      seedIndexes: args.seedIndexes ?? undefined, cycles: args.cycles ?? undefined,
      onProgress: ({completed, planned, elapsedMs}) => {
        if (args.quiet || Date.now() - progressAt < 15000) return;
        progressAt = Date.now();
        process.stderr.write(`[${policy}] ${completed}/${planned} matches · ${(elapsedMs / 1000).toFixed(0)}s\n`);
      },
    });
    runs.push(report);
    if (!args.quiet) process.stderr.write(`[${policy}] ${report.completed}/${report.planned} matches in ${(report.elapsedMs / 1000).toFixed(1)}s${report.truncated ? ' (BUDGET-TRUNCATED)' : ''} · ${report.errors.length} errors\n`);
  }
  const neutral = runs.find(run => run.policy === 'neutral') ?? runs[0];
  const on = runs.find(run => run.policy === 'on');
  const truncated = runs.some(run => run.truncated === true);
  const alarms = truncated ? [] : [...(neutral?.alarms ?? []), ...(on?.alarms ?? []).filter(alarm => alarm.kind === 'expression')];
  const report = {
    format: 1,
    kind: 'balance-sweep',
    release,
    dataHash: neutral?.dataHash ?? null,
    generatedAt: new Date().toISOString(),
    seedFormula: SEED_FORMULA,
    profile: args.profile,
    geared: args.geared,
    only,
    truncated,
    budgetMs: budgetExplicit ? args.budgetMs : null,
    elapsedMs: Date.now() - started,
    alarms,
    podium: {
      neutral: truncated ? null : (neutral ? neutral.tierlist.operators.slice(0, 3) : null),
      on: truncated ? null : (on ? on.tierlist.operators.slice(0, 3) : null),
    },
    seedManifest: neutral?.seedManifest ?? runs[0]?.seedManifest ?? null,
    runs,
  };
  // §4.8.6: the stock-vs-max-gear tier invariant, computed against a baseline
  // report (the neutral run, same profile) when one is supplied.
  if (args.baseline) {
    try {
      const baselinePath = resolve(ROOT, args.baseline);
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
      const baselineNeutral = (baseline.runs ?? []).find(run => run.policy === 'neutral') ?? baseline.runs?.[0] ?? baseline;
      report.gearInvariant = {
        baseline: baselinePath,
        baselineRelease: baseline.release ?? baselineNeutral?.release ?? null,
        baselineDataHash: baseline.dataHash ?? baselineNeutral?.dataHash ?? null,
        baselineTruncated: baseline.truncated === true || baselineNeutral?.truncated === true,
        geared: args.geared,
        ...gearTierInvariant(baselineNeutral, neutral ?? runs[0]),
      };
    } catch (error) {
      report.gearInvariant = {error: error?.message ?? String(error)};
    }
  }
  if (args.out) {
    const target = resolve(ROOT, args.out.replace('<release>', release));
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, `${JSON.stringify(report, null, 1)}\n`);
    if (!args.quiet) process.stderr.write(`report: ${target}\n`);
  }
  if (args.json) console.log(JSON.stringify(report, null, 1));
  else if (args.printTierlist) console.log(formatTierList({...report, runs}));
  else console.log(`${release}: ${runs.map(run => `${run.policy} ${run.completed}/${run.planned}`).join(' · ')} · alarms ${alarms.length}`);
  if (report.gearInvariant && !report.gearInvariant.error && !args.quiet) {
    const kinds = Object.entries(report.gearInvariant.kinds ?? {}).map(([kind, entry]) => `${kind} rho=${entry.rho} shift<=${entry.maxShift} gain<=${entry.maxGain}pp ${entry.pass ? 'ok' : 'FAIL'}`).join(' · ');
    process.stderr.write(`gear invariant (${report.gearInvariant.pass ? 'PASS' : 'FAIL'}): ${kinds}\n`);
  }
  if (truncated) {
    // A clipped run is evidence of a host problem, not a balance result. Be
    // loud and exit non-zero so a scripted Phase-5 gate cannot read it as green.
    process.stderr.write(`\n!! TRUNCATED RUN: ${runs.filter(run => run.truncated).map(run => `${run.policy} ${run.completed}/${run.planned}`).join(', ')}. Tier alarms were suppressed. Re-run with --budget-ms 0 to completion before reading this report.\n`);
    process.exitCode = 2;
  }
}

main();
