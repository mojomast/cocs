// Balance sweep library tests — Phase 3D of the COCS class & harness overhaul
// (docs/design/CLASS_OVERHAUL.md §7.5, §14). Library only, in the fast gate:
// manifest determinism, Wilson math, seed formula, truncation and the alarm
// thresholds. The integration hook lives in game/archive/balance-sweep.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GEAR, MODE_GROUPS, NEUTRAL_POLICY, SEED_FORMULA, SWEEP_MAPS, SWEEP_PROFILES, WILSON_Z99,
  balanceDataHash, buildManifest, computeAlarms, envelopeReport, filterManifest, fnv1a32,
  formatTierList, gearTierInvariant, modeGroup, modeViability, mulberry32, objectiveCompletions,
  parseOnly, placementWinners, quantile, rankCorrelation,
  runManifestItem, runSweep, sweepMapsForMode, sweepSeed, wilsonInterval,
} from './balance-sweep.mjs';
import {arenaSupportsMode} from './arenas.mjs';

test('fnv1a32 matches the published FNV-1a 32-bit vectors', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
  assert.equal(fnv1a32('a'), fnv1a32('a'));
  assert.notEqual(fnv1a32('a'), fnv1a32('b'));
});

test('mulberry32 is deterministic and stays inside [0, 1)', () => {
  const first = mulberry32(0xc0c5), second = mulberry32(0xc0c5);
  for (let i = 0; i < 64; i++) {
    const value = first();
    assert.equal(value, second());
    assert.ok(value >= 0 && value < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('the seed formula is fnv1a32(mode|map|matchup|seedIndex|geared)', () => {
  const seed = sweepSeed('deathmatch', 'crosswire', 'ffa-0', 3, 'stock');
  assert.equal(seed, fnv1a32('deathmatch|crosswire|ffa-0|3|stock'));
  assert.notEqual(seed, sweepSeed('deathmatch', 'crosswire', 'ffa-0', 3, 'max'));
  assert.notEqual(seed, sweepSeed('deathmatch', 'crosswire', 'ffa-1', 3, 'stock'));
  assert.equal(SEED_FORMULA, 'mode|map|matchup|seedIndex|geared');
});

test('Wilson intervals bracket the observed rate and tighten with n', () => {
  const wide = wilsonInterval(1, 4), tight = wilsonInterval(250, 1000);
  assert.ok(wide.lower < 0.05 && wide.upper > 0.75 && wide.upper < 0.82, `${wide.lower}..${wide.upper}`);
  assert.ok(tight.lower > 0.21 && tight.upper < 0.29, `${tight.lower}..${tight.upper}`);
  assert.deepEqual(wilsonInterval(0, 0), {lower: 0, upper: 1});
  assert.ok(wilsonInterval(55, 100, WILSON_Z99).lower > 0.4 && wilsonInterval(55, 100, WILSON_Z99).upper < 0.7);
  // z=1.96 must be narrower than z=2.576 for the same sample.
  assert.ok(wilsonInterval(55, 100, 1.959964).upper < wilsonInterval(55, 100, WILSON_Z99).upper);
});

test('quantile interpolates and handles empty input', () => {
  assert.equal(quantile([], .5), null);
  assert.equal(quantile([2], .5), 2);
  assert.equal(quantile([1, 2, 3, 4], .5), 2.5);
  assert.ok(Math.abs(quantile([1, 2, 3, 4], .25) - 1.75) < 1e-9);
});

test('the smoke manifest plans 144 matches per policy with pinned actor ids', () => {
  const manifest = buildManifest({profile: 'smoke', policy: 'neutral'});
  assert.equal(manifest.items.length, 144);
  assert.equal(manifest.items.length, SWEEP_PROFILES.smoke.cycles * SWEEP_PROFILES.smoke.modes.length * SWEEP_PROFILES.smoke.mapsPerMode * SWEEP_PROFILES.smoke.seedIndexes);
  const seen = new Set();
  for (const item of manifest.items) {
    assert.equal(item.seed, sweepSeed(item.mode, item.map, item.matchup, item.seedIndex, item.geared));
    assert.ok(!seen.has(item.id), `duplicate manifest id ${item.id}`);
    seen.add(item.id);
    assert.deepEqual(item.actors.map(actor => actor.id), item.actors.map((_, index) => index), 'actor ids are pinned seat indexes');
    const distinct = new Set(item.actors.map(actor => actor.character));
    assert.equal(distinct.size, item.actors.length, `${item.id}: operators must be distinct inside a pod`);
    if (item.team) assert.deepEqual(item.actors.map(actor => actor.id % 2), [0, 1, 0, 1, 0, 1]);
    else assert.equal(item.actors.length, 4);
  }
  const full = buildManifest({profile: 'full', policy: 'on'});
  assert.equal(full.items.length, 900);
  const geared = buildManifest({profile: 'smoke', policy: 'neutral', geared: 'max'});
  assert.ok(geared.items.every(item => item.actors.every(actor => actor.gear && actor.gear.primary === MAX_GEAR.primary && actor.gear.utility === MAX_GEAR.utility)));
  assert.notEqual(geared.items[0].seed, manifest.items[0].seed);
});

test('manifest pods cover every operator and spec inside a full cycle', () => {
  const manifest = buildManifest({profile: 'smoke', policy: 'neutral', modes: ['deathmatch'], mapsPerMode: 1, seedIndexes: 1});
  const operators = new Map(), specs = new Map();
  for (const item of manifest.items) for (const actor of item.actors) {
    operators.set(actor.character, (operators.get(actor.character) || 0) + 1);
    specs.set(actor.harness, (specs.get(actor.harness) || 0) + 1);
  }
  assert.equal(operators.size, 9);
  assert.equal(specs.size, 7);
  const counts = [...operators.values()];
  assert.equal(new Set(counts).size, 1, `equal operator exposure per cycle: ${counts}`);
  const specCounts = [...specs.values()];
  assert.ok(Math.max(...specCounts) - Math.min(...specCounts) <= 1, `balanced spec exposure: ${specCounts}`);
});

test('parseOnly and filterManifest reproduce a single manifest item', () => {
  const manifest = buildManifest({profile: 'smoke', policy: 'neutral'});
  const item = manifest.items[7];
  const byIndex = filterManifest(manifest, `${item.mode},${item.matchup},${item.seedIndex}`);
  assert.ok(byIndex.length >= 1);
  assert.ok(byIndex.every(entry => entry.mode === item.mode && entry.matchup === item.matchup && entry.seedIndex === item.seedIndex));
  const bySeed = filterManifest(manifest, `${item.mode},${item.matchup},${item.seed}`);
  assert.ok(bySeed.some(entry => entry.id === item.id));
  assert.equal(filterManifest(manifest, `${item.mode},${item.matchup},${item.seedIndex},${item.map}`).length, 1);
  assert.deepEqual(parseOnly('a,b,c'), {mode: 'a', matchup: 'b', seed: 'c', map: null});
  assert.equal(parseOnly('a,b'), null);
  assert.equal(parseOnly(''), null);
});

test('FFA placement wins give every pod a 50% win baseline', () => {
  const actors = [
    {id: 0, frags: 9}, {id: 1, frags: 4}, {id: 2, frags: 4}, {id: 3, frags: 1},
  ];
  const winners = placementWinners({actors}, 'deathmatch');
  assert.deepEqual([...winners].sort((a, b) => a - b), [0, 1], 'top half wins; ties break by damage then actor id');
  assert.equal(placementWinners({actors}, 'teamdeathmatch'), null, 'team modes keep the team result');
  assert.equal(placementWinners({actors}, 'juggernaut'), null, 'the crown keeps actorWon');
  const tied = placementWinners({actors: [{id: 3, frags: 2}, {id: 2, frags: 2}, {id: 1, frags: 2}, {id: 0, frags: 2}]}, 'deathmatch');
  assert.deepEqual([...tied].sort((a, b) => a - b), [0, 1], 'all-tie pods still resolve deterministically');
});

test('FFA placement ties break by damage dealt, never by actor id', () => {
  // The aether bug: unattributed deaths leave the rank tuples tied, so the old
  // `a.id - b.id` tie-break handed low-id seats a free pod win. Damage dealt is
  // the fair, deterministic second key.
  const actors = [
    {id: 0, frags: 5, scoreStats: {damage: 10}},
    {id: 1, frags: 5, scoreStats: {damage: 900}},
    {id: 2, frags: 5, scoreStats: {damage: 800}},
    {id: 3, frags: 5, scoreStats: {damage: 700}},
  ];
  assert.deepEqual([...placementWinners({actors}, 'deathmatch')].sort((a, b) => a - b), [1, 2], 'the two highest-damage seats advance, not ids 0 and 1');
  // Input order must not matter: the sort is total on damage when frags tie.
  const shuffled = [actors[2], actors[0], actors[3], actors[1]];
  assert.deepEqual([...placementWinners({actors: shuffled}, 'deathmatch')].sort((a, b) => a - b), [1, 2], 'input order does not change the pod');
  // Damage ties fall through to the id fallback, so the pod is still deterministic.
  const damageTie = placementWinners({actors: [{id: 3, frags: 2, scoreStats: {damage: 50}}, {id: 2, frags: 2, scoreStats: {damage: 50}}, {id: 1, frags: 2, scoreStats: {damage: 50}}, {id: 0, frags: 2, scoreStats: {damage: 50}}]}, 'deathmatch');
  assert.deepEqual([...damageTie].sort((a, b) => a - b), [0, 1]);
});

test('objective completions map to per-mode score stats', () => {
  const actor = {points: 0, scoreStats: {captures: 2, objectiveCaptures: 3, goals: 1, objectiveTime: 9}};
  assert.equal(objectiveCompletions(actor, 'ctf'), 2);
  assert.equal(objectiveCompletions(actor, 'domination'), 3);
  assert.equal(objectiveCompletions(actor, 'payload'), 3);
  assert.equal(objectiveCompletions(actor, 'puma-soccer'), 1);
  assert.equal(objectiveCompletions(actor, 'deathmatch'), 0);
  assert.equal(objectiveCompletions({points: 4, scoreStats: {}}, 'juggernaut'), 1);
});

test('sweep map pools support their modes and stay compact', () => {
  for (const [mode, ids] of Object.entries(SWEEP_MAPS)) {
    assert.ok(ids.length >= 4, `${mode} needs a four-map full pool`);
    for (const id of ids) assert.ok(arenaSupportsMode(id, mode), `${id} must support ${mode}`);
  }
  assert.deepEqual(sweepMapsForMode('deathmatch', 2), ['crosswire', 'aether']);
  assert.deepEqual(sweepMapsForMode('ctf', 2), ['citadel', 'launchpad']);
  assert.equal(sweepMapsForMode('puma-race', 1).length, 1, 'uncurated modes fall back to a ranked pool');
});

test('modeGroup classifies locked, team and race modes', () => {
  assert.equal(modeGroup('deathmatch'), 'locked');
  assert.equal(modeGroup('ctf'), 'team');
  assert.equal(modeGroup('combined-arms'), 'team');
  assert.equal(modeGroup('puma-race'), 'race');
  assert.ok(MODE_GROUPS.locked.includes('juggernaut'));
});

test('a single manifest item runs deterministically and reports a finished match', () => {
  const manifest = buildManifest({profile: 'smoke', policy: 'neutral', modes: ['deathmatch'], mapsPerMode: 1, seedIndexes: 1, cycles: 1});
  const first = runManifestItem(manifest.items[0]);
  const second = runManifestItem(manifest.items[0]);
  assert.equal(first.over, true);
  assert.equal(first.overReason !== null, true);
  assert.deepEqual(first, second, 'the same manifest item must replay byte-for-byte');
  assert.equal(first.appearances.length, 4);
  assert.ok(first.appearances.every(appearance => appearance.character && appearance.harness));
  assert.ok(first.appearances.some(appearance => appearance.damage > 0), 'the pod must deal damage');
  // A different policy seed stream is not required to be identical, but it must
  // still finish cleanly.
  const onManifest = buildManifest({profile: 'smoke', policy: 'on', modes: ['deathmatch'], mapsPerMode: 1, seedIndexes: 1, cycles: 1});
  const on = runManifestItem(onManifest.items[0]);
  assert.equal(on.over, true);
});

test('runSweep carries release, dataHash and the seed manifest, and truncates whole items', () => {
  let ticks = 0;
  const report = runSweep({
    profile: 'smoke', policy: 'neutral', release: 'v-test',
    modes: ['deathmatch'], mapsPerMode: 1, seedIndexes: 1, cycles: 2,
    now: () => (ticks += 1000), budgetMs: 1,
  });
  assert.equal(report.release, 'v-test');
  assert.equal(report.dataHash, balanceDataHash());
  assert.equal(report.planned, 2);
  assert.equal(report.completed, 1, 'budget truncation drops whole items only');
  assert.equal(report.truncated, true);
  assert.equal(report.items.length, 1);
  assert.deepEqual(report.errors, []);
  assert.equal(report.seedManifest.items.length, 2);
  assert.ok(report.seedManifest.items.every(item => typeof item.seed === 'number' && item.seed >= 0));
  assert.equal(report.tierlist.operators.length, 4);
  assert.ok(report.tierlist.specs.length >= 3, `spec rows ${report.tierlist.specs.length}`);
  assert.ok(formatTierList(report).includes('podium:'));
  // maxMatches gives an exact, clock-free prefix.
  const capped = runSweep({profile: 'smoke', policy: 'neutral', modes: ['deathmatch'], mapsPerMode: 1, seedIndexes: 1, cycles: 1, maxMatches: 1});
  assert.equal(capped.completed, 1);
  assert.equal(capped.planned, 1);
  assert.equal(capped.truncated, false);
});

test('a budget-truncated run refuses tier alarms, marks itself, and prints a loud banner', () => {
  let ticks = 0;
  const truncated = runSweep({
    profile: 'smoke', policy: 'neutral', release: 'v-test',
    modes: ['deathmatch'], mapsPerMode: 1, seedIndexes: 1, cycles: 4,
    now: () => (ticks += 1000), budgetMs: 1,
  });
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.completed < truncated.planned, `expected a clipped run (${truncated.completed}/${truncated.planned})`);
  assert.deepEqual(truncated.metrics.truncation, {truncated: true, completed: truncated.completed, planned: truncated.planned, budgetMs: 1});
  assert.deepEqual(truncated.alarms.map(alarm => alarm.kind), ['truncated'], 'no sample-derived alarm may survive truncation');
  assert.equal(truncated.alarms[0].severity, 'warning');
  const rendered = formatTierList(truncated);
  assert.match(rendered, /TRUNCATED/);
  assert.match(rendered, /NOT a gate/);
  // Running the same manifest to completion is a gate again.
  const full = runSweep({profile: 'smoke', policy: 'neutral', modes: ['deathmatch'], mapsPerMode: 1, seedIndexes: 1, cycles: 4});
  assert.equal(full.truncated, false);
  assert.ok(full.alarms.every(alarm => alarm.kind !== 'truncated'), 'a completed run never carries the truncation warning');
});

test('rankCorrelation and gearTierInvariant pin the §4.8.6 stock-vs-max-gear gate', () => {
  const rows = list => list.map(([key, winRate]) => ({key, winRate}));
  const stock = rows([['a', .60], ['b', .55], ['c', .50], ['d', .45], ['e', .40]]);
  assert.deepEqual(rankCorrelation(stock, stock), {n: 5, rho: 1, maxShift: 0, maxGain: 0, crossings: []});
  const swapped = rows([['a', .40], ['b', .55], ['c', .50], ['d', .45], ['e', .60]]);
  const moved = gearTierInvariant({tierlist: {operators: stock, specs: stock, wings: stock}}, {tierlist: {operators: swapped, specs: stock, wings: stock}});
  assert.equal(moved.kinds.operators.pass, false);
  assert.equal(moved.kinds.specs.pass, true);
  assert.equal(moved.pass, false);
  // A class crossing 45/55 under max gear fails even if the rank order holds.
  const flip = gearTierInvariant(
    {tierlist: {operators: rows([['a', .44], ['b', .60]])}},
    {tierlist: {operators: rows([['a', .60], ['b', .44]])}},
  );
  assert.equal(flip.kinds.operators.crossings.length, 2);
  assert.equal(flip.kinds.operators.pass, false);
  // A single below-cap gain passes.
  const small = gearTierInvariant(
    {tierlist: {operators: rows([['a', .50], ['b', .48]])}},
    {tierlist: {operators: rows([['a', .52], ['b', .50]])}},
  );
  assert.equal(small.kinds.operators.pass, true);
  assert.equal(small.pass, true);
});

test('modeViability computes the team-answer and locked-floor gates at the reported sample', () => {
  const row = (key, n, byModeGroup = {}) => ({key, n, winRate: .5, lower: .4, upper: .6, damage: 0, abilityDamage: 0, abilityShare: 0, verbUsesPerMatch: 1, byMode: {}, byModeGroup});
  const summary = {
    operatorRows: [row('a', 30, {team: {n: 30}}), row('b', 30, {team: {n: 30}}), row('c', 6, {team: {n: 6}})],
    teamPairs: [
      {character: 'a', opponent: 'x', n: 10, winRate: .5},
      {character: 'a', opponent: 'y', n: 10, winRate: .7},
      {character: 'b', opponent: 'x', n: 10, winRate: .9},
    ],
    lockedPairs: [{a: 'a', b: 'b', n: 30, worst: .2}, {a: 'b', b: 'c', n: 10, worst: .1}],
  };
  const viability = modeViability(summary, {minSample: 24, answerSample: 8, answerCap: .6});
  const a = viability.teamAnswers.find(entry => entry.operator === 'a');
  assert.equal(a.answerCount, 1, 'only the ≤60% opponent counts as an answer');
  assert.equal(a.viable, false);
  const b = viability.teamAnswers.find(entry => entry.operator === 'b');
  assert.equal(b.answerCount, 0);
  assert.equal(b.viable, false);
  const c = viability.teamAnswers.find(entry => entry.operator === 'c');
  assert.equal(c.tested, false, 'a row below minSample is not tested');
  assert.equal(c.viable, true);
  assert.deepEqual(viability.lockedFloors.map(entry => entry.pass), [false], 'the n=10 pair is below minSample and excluded');
  assert.equal(viability.teamViable, false);
  assert.equal(viability.lockedViable, false);
  // The alarm path reads the same numbers.
  const alarms = computeAlarms({...summary, policy: 'neutral', geared: 'stock', profile: 'smoke', matches: 66, specRows: [], wingRows: [], modeGroupRows: []}, {envelope: {breaches: []}});
  assert.ok(alarms.some(alarm => alarm.kind === 'team-answers' && alarm.subject === 'a'));
  assert.ok(alarms.some(alarm => alarm.kind === 'locked-floor'));
});

test('envelope report stays inside the §4.1 stat envelope for stock and max gear', () => {
  const stock = envelopeReport('stock');
  assert.ok(stock.ehpRatio <= 1.5, `stock EHP ratio ${stock.ehpRatio}`);
  assert.deepEqual(stock.breaches, []);
  const geared = envelopeReport('max');
  assert.ok(geared.ehpRatio <= 1.5, `geared EHP ratio ${geared.ehpRatio}`);
  assert.deepEqual(geared.breaches, []);
  assert.notEqual(geared.rows[0].health, stock.rows[0].health);
});

test('alarms fire on the §14 thresholds from a synthetic summary', () => {
  const row = (key, n, wins, extra = {}) => ({
    key, label: key, n, wins, winRate: wins / n, ...wilsonInterval(wins, n),
    kills: 0, deaths: 0, kd: 0, damage: 10, damagePerLife: 1, objectives: 1, objectiveMatches: 0,
    verbUses: 0, verbUsesPerMatch: 0, powers: 0, abilityDamage: 0, abilityShare: 0, ttk: null,
    byMode: {}, byModeGroup: {}, ...extra,
  });
  const summary = {
    policy: 'neutral', geared: 'stock', profile: 'smoke', matches: 30,
    operatorRows: [
      row('god-op', 30, 25, {byModeGroup: {team: {n: 30}}}),
      row('garbage-op', 30, 6),
      row('ok-op', 30, 15, {byModeGroup: {team: {n: 30}}}),
    ],
    specRows: [], wingRows: [],
    lockedPairs: [{a: 'god-op', b: 'garbage-op', aWins: 27, bWins: 3, n: 30, aRate: .9, bRate: .1, worst: .1}],
    teamPairs: [
      {character: 'god-op', opponent: 'ok-op', n: 20, winRate: .9},
      {character: 'god-op', opponent: 'garbage-op', n: 20, winRate: .95},
    ],
    matchesRef: [],
  };
  const alarms = computeAlarms(summary, {envelope: {breaches: [{kind: 'ehp', ratio: 1.6, max: 'a', min: 'b'}]}});
  const kinds = alarms.map(alarm => `${alarm.kind}:${alarm.subject}`).sort();
  assert.ok(kinds.includes('god:god-op'), kinds.join(' '));
  assert.ok(kinds.includes('garbage:garbage-op'), kinds.join(' '));
  assert.ok(kinds.includes('locked-floor:god-op vs garbage-op'), kinds.join(' '));
  assert.ok(kinds.some(kind => kind.startsWith('team-answers:god-op')), kinds.join(' '));
  assert.ok(kinds.some(kind => kind.startsWith('envelope:')), kinds.join(' '));
  // Ability share above 30% alarms on the aggregate.
  const loud = {...summary, operatorRows: [row('openclaw', 30, 15, {damage: 100, abilityDamage: 50})], specRows: [], wingRows: [], lockedPairs: [], teamPairs: []};
  assert.ok(computeAlarms(loud, {envelope: {breaches: []}}).some(alarm => alarm.kind === 'ability-share'));
  // The neutral policy is the balance gate; expression floors are policy-on only.
  const quiet = {...summary, operatorRows: [row('ok-op', 30, 15)], specRows: [], wingRows: [], lockedPairs: [], teamPairs: []};
  assert.equal(computeAlarms(quiet, {envelope: {breaches: []}}).length, 0);
  assert.equal(computeAlarms({...quiet, policy: 'on'}, {envelope: {breaches: []}}).some(alarm => alarm.kind === 'expression'), true);
});

test('summary win rates always come from completed match appearances', () => {
  const report = runSweep({profile: 'smoke', policy: 'on', modes: ['teamdeathmatch'], mapsPerMode: 1, seedIndexes: 1, cycles: 1, maxMatches: 1});
  assert.equal(report.errors.length, 0);
  const row = report.tierlist.operators[0];
  assert.ok(row.n > 0);
  assert.ok(row.winRate >= 0 && row.winRate <= 1);
  assert.ok(Math.abs(report.tierlist.operators.reduce((sum, entry) => sum + entry.n, 0) - report.completed * 6) < 1e-9);
  assert.ok(report.metrics.teamSwapRate >= 0);
  assert.ok(report.metrics.envelope.ehpRatio <= 1.5);
  assert.equal(NEUTRAL_POLICY.archetype, 'flanker');
});
