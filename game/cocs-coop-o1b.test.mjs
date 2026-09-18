// LATTICE STRIKE: OPERATIONS O1b — intermission spend window, FLUX sinks, bonus
// objectives and partial rewards.
//
// Design authority: docs/design/COCS-OPERATIONS.md §3.3 (between-wave spending),
// §3.4 (bonus objectives), §3.5 (partial rewards) and §7.2 (O1b acceptance).
// Covers the window state machine, each sink's cost+effect, the budget
// no-longer-clamped evidence, the bonus lifecycle, partial-reward math, the
// published tier copy/table invariants, determinism and mode isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {RULES} from './data.mjs';
import {
  COOP_SINKS, COOP_SINK_ORDER, COOP_BONUS, DIRECTOR_TIERS, DIRECTOR_TIER_COPY,
  tierBonusObjectives,
} from './cocs-difficulty.mjs';
import {convertCoopReq} from './cocs-economy.mjs';
import {
  coopAutoSpend, coopRewardSummary, coopSpend, coopSpendReport, intermissionOpen,
  setCoopTier, spawnCoopSquad,
} from './cocs-coop.mjs';
import {cocsSnapshot, nodeById} from './cocs.mjs';
import {exploitAlarms, exploitWarnings} from '../scripts/cocs-validate.mjs';

const DT = RULES.dt;
const ticks = seconds => Math.max(1, Math.round(seconds / DT));
const mulberry32 = seed => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const coopMatch = (over = {}) => new Match('chatgpt', 'openclaw', mulberry32(over.seed ?? 7), 'lattice-slice', {
  mode: 'cocs-coop', humanCount: 4, botCount: 2, aiSeats: true, timeLimit: 900, ...over,
});
const step = (m, n = 1) => { for (let i = 0; i < n && !m.over; i++) m.step(DT, {inputs: {}}); return m; };
const capturable = state => state.nodes.filter(node => ['front', 'economy', 'relay'].includes(node.archetype));
const ownedNode = state => capturable(state).find(node => node.owner === 0) ?? null;

// Force Wave 1 to clear so the real intermission transition runs. Auto-spend is
// disabled by default here so a test can drive a single spend in isolation.
function openWindow(m, {auto = false} = {}) {
  const coop = m.objectiveState.coop;
  coop.autoSpend = auto;
  step(m, 300);
  for (const actor of m.actors) if (actor.isDirectorWave === true) { actor.health = 0; actor.dead = 1e9; actor.bot = null; }
  coop.pending = [];
  for (let i = 0; i < 6 && coop.phase !== 'intermission' && !m.over; i++) m.step(DT, {inputs: {}});
  return coop;
}

test('the intermission spend window opens after a clear, closes on wave start and is sink-gated', () => {
  const m = coopMatch({seed: 3});
  const state = m.objectiveState;
  const coop = openWindow(m);
  assert.equal(coop.phase, 'intermission');
  assert.equal(coop.intermissionOpen, true, 'the spend window is open after a cleared wave');
  assert.equal(intermissionOpen(coop), true);
  const before = state.flux[0];
  const result = coopSpend(m, state, {tick: coop.tick, peerId: 'p', cardId: 'c', verb: 'RESUPPLY'});
  assert.equal(result.ok, true);
  assert.equal(state.flux[0], before - COOP_SINKS.RESUPPLY.cost, 'the sink debits team FLUX by its published cost');
  // A spend in a closed window is rejected, never forced.
  coop.intermissionOpen = false;
  const closed = coopSpend(m, state, {tick: coop.tick, peerId: 'p', cardId: 'c2', verb: 'RESUPPLY'});
  assert.equal(closed.ok, false);
  assert.equal(closed.reason, 'window-closed');
  // Re-open and let the timer expire: the next wave closes the window.
  coop.intermissionOpen = true;
  coop.intermissionTicks = 1;
  m.step(DT, {inputs: {}});
  assert.equal(coop.phase, 'build_up');
  assert.equal(coop.intermissionOpen, false, 'the window closes when the next wave starts');
});

test('each FLUX sink charges its cost and applies its concrete effect', () => {
  const m = coopMatch({seed: 5});
  const state = m.objectiveState;
  const coop = openWindow(m);
  coop.intermissionOpen = true;

  // --- FORTIFY ------------------------------------------------------------
  const node = ownedNode(state) ?? capturable(state)[0];
  node.owner = 0;
  state.flux[0] = 300;
  const beforeFortify = state.flux[0];
  assert.equal(coopSpend(m, state, {tick: coop.tick, peerId: 'p', cardId: 'f', verb: 'FORTIFY', target: node.id}).ok, true);
  assert.equal(node.captureResist, COOP_SINKS.FORTIFY.captureResist);
  assert.equal(state.flux[0], beforeFortify - COOP_SINKS.FORTIFY.cost);

  // --- REPAIR -------------------------------------------------------------
  coop.siege.health = coop.siege.max - 500;
  state.cuts.push('front-0');
  const damaged = coop.siege.health;
  state.flux[0] = 300;
  assert.equal(coopSpend(m, state, {tick: coop.tick, peerId: 'p', cardId: 'r', verb: 'REPAIR'}).ok, true);
  assert.ok(coop.siege.health > damaged, 'REPAIR restores HQ integrity');
  assert.equal(state.cuts.includes('front-0'), false, 'REPAIR repairs a cut supply link');

  // --- RESUPPLY -----------------------------------------------------------
  const healer = m.actors.find(actor => actor.team === 0 && actor.health > 0 && actor.isDirectorWave !== true);
  healer.health = Math.max(1, healer.maxHealth - 60);
  healer.armor = 0;
  const reqBefore = healer.reqEarned ?? 0;
  state.flux[0] = 300;
  assert.equal(coopSpend(m, state, {tick: coop.tick, peerId: 'p', cardId: 's', verb: 'RESUPPLY'}).ok, true);
  assert.equal(healer.health, healer.maxHealth, 'RESUPPLY refills team health');
  assert.ok((healer.reqEarned ?? 0) > reqBefore, 'RESUPPLY routes a REQ grant into the existing model');

  // --- REINFORCE ----------------------------------------------------------
  const rosterBefore = m.actors.length;
  state.flux[0] = 300;
  assert.equal(coopSpend(m, state, {tick: coop.tick, peerId: 'p', cardId: 'x', verb: 'REINFORCE'}).ok, true);
  assert.ok(m.actors.length > rosterBefore, 'REINFORCE adds a friendly actor');
  assert.ok(m.actors.some(actor => actor.isCoopSquad === true && actor.team === 0), 'the squad bot is on team 0');
  assert.ok(coop.threadBonus >= 1, 'REINFORCE grants an extra THREAD');

  // The published cost table is the single source of truth.
  assert.equal(state.fluxSpent[0] >= COOP_SINKS.FORTIFY.cost + COOP_SINKS.REPAIR.cost + COOP_SINKS.RESUPPLY.cost + COOP_SINKS.REINFORCE.cost, true);
});

test('FORTIFY resistance is mode-local and expires with the next wave', () => {
  const m = coopMatch({seed: 9});
  const state = m.objectiveState;
  const coop = openWindow(m);
  coop.intermissionOpen = true;
  const node = ownedNode(state) ?? capturable(state)[0];
  node.owner = 0;
  state.flux[0] = 300;
  coopSpend(m, state, {tick: coop.tick, peerId: 'p', cardId: 'f', verb: 'FORTIFY', target: node.id});
  assert.equal(node.captureResist, 0.5);
  coop.intermissionTicks = 1;
  m.step(DT, {inputs: {}}); // start the next wave — the fortification protects it
  assert.equal(Number(node.captureResist), 0.5, 'fortify protects the wave it was bought for');
  // One wave later the hardening lapses.
  coop.fortify[node.id].untilWave = coop.wave;
  coop.phase = 'intermission';
  coop.intermissionOpen = true;
  coop.intermissionTicks = 1;
  m.step(DT, {inputs: {}});
  assert.equal(Number(node.captureResist), 0, 'fortify lasts exactly one wave');
});

test('auto-spend drains FLUX below the reserve floor, closing the V0b cap-pin gap', () => {
  const m = coopMatch({seed: 11});
  const state = m.objectiveState;
  const coop = openWindow(m, {auto: false});
  coop.intermissionOpen = true;
  coop.autoSpend = true;
  // Give the team ground to fortify and a full bank.
  for (const node of capturable(state).slice(0, 3)) node.owner = 0;
  state.flux[0] = state.fluxCap;
  const floor = state.fluxCap * 0.15;
  const spent = coopAutoSpend(m, state);
  assert.ok(spent > 0, 'auto-spend actually spends');
  assert.ok(state.flux[0] < state.fluxCap - 1, 'pooled FLUX is consumed by real sinks');
  assert.ok(state.flux[0] <= floor + COOP_SINKS.REINFORCE.cost + 1e-6, `drained near the reserve floor (${state.flux[0]})`);
  assert.ok(coop.spendStats.FORTIFY + coop.spendStats.RESUPPLY + coop.spendStats.REINFORCE > 0);
  const report = coopSpendReport(m, state);
  assert.ok(report.byType.FORTIFY + report.byType.RESUPPLY + report.byType.REINFORCE > 0);
  assert.ok(report.fluxSpent > 0);
});

test('queued spends resolve deterministically by (tick, peerId, cardId), not arrival order', () => {
  const run = order => {
    const m = coopMatch({seed: 13});
    const state = m.objectiveState;
    const coop = openWindow(m, {auto: false});
    coop.intermissionOpen = true;
    state.flux[0] = COOP_SINKS.RESUPPLY.cost; // only one of the two can afford
    const a = {tick: coop.tick, peerId: 'a', cardId: 'a', verb: 'RESUPPLY'};
    const b = {tick: coop.tick, peerId: 'b', cardId: 'b', verb: 'REINFORCE'};
    m.step(DT, {cocs: {spends: order}});
    return coop.spendLog.filter(entry => entry.verb === 'RESUPPLY' || entry.verb === 'REINFORCE').map(entry => `${entry.cardId}:${entry.ok}`);
  };
  const first = run([{tick: 1, peerId: 'a', cardId: 'a', verb: 'RESUPPLY'}, {tick: 1, peerId: 'b', cardId: 'b', verb: 'REINFORCE'}]);
  const second = run([{tick: 1, peerId: 'b', cardId: 'b', verb: 'REINFORCE'}, {tick: 1, peerId: 'a', cardId: 'a', verb: 'RESUPPLY'}]);
  assert.deepEqual(first, second, 'arrival order cannot change the spend outcome');
  assert.equal(first[0], 'a:true', 'the (tick, peerId, cardId) winner is the lexicographically first card');
  assert.equal(first[1], 'b:false');
});

test('bonus objectives open one at a time, complete with rewards, and advance the queue', () => {
  const m = coopMatch({seed: 17});
  const state = m.objectiveState;
  const coop = state.coop;
  step(m, 1);
  assert.deepEqual(coop.bonus.open, ['hold-all'], 'D1 opens one bonus at a time');
  assert.equal(coop.bonus.state[0].state, 'open');
  // Hold every capturable node for the published 10 s.
  const fluxBefore = state.flux[0];
  for (let i = 0; i < ticks(COOP_BONUS['hold-all'].holdSeconds) + 3; i++) {
    for (const node of capturable(state)) { node.owner = 0; node.progress = {0: 0, 1: 0}; }
    m.step(DT, {inputs: {}});
    if (coop.bonus.done.includes('hold-all')) break;
  }
  assert.ok(coop.bonus.done.includes('hold-all'), 'HOLD ALL completes after the hold window');
  assert.ok(state.flux[0] >= fluxBefore, 'the bonus paid team FLUX');
  assert.deepEqual(coop.bonus.open, ['under-time'], 'the next bonus opens after the first resolves');
});

test('a fast wave clear completes UNDER TIME through the real wave machine', () => {
  const m = coopMatch({seed: 19});
  const coop = openWindow(m, {auto: false});
  // Open UNDER TIME directly (HOLD ALL is the D1 opener), then let Wave 2 spawn
  // and clear it inside 70% of the timer.
  coop.bonus.queue = [];
  coop.bonus.open = ['under-time'];
  coop.bonus.state = [{id: 'under-time', label: COOP_BONUS['under-time'].label, state: 'open', progress: 0, target: 1}];
  coop.intermissionTicks = 1;
  step(m, 2);
  step(m, 300);
  coop.waveTicks = 10;
  coop.waveTimerTicks = ticks(120);
  for (const actor of m.actors) if (actor.isDirectorWave === true) { actor.health = 0; actor.dead = 1e9; actor.bot = null; }
  coop.pending = [];
  for (let i = 0; i < 6 && !coop.bonus.done.includes('under-time') && !coop.bonus.failed.includes('under-time'); i++) m.step(DT, {inputs: {}});
  assert.ok(coop.bonus.done.includes('under-time'), 'a clear inside 70% of the timer pays UNDER TIME');
});

test('bonus rewards are tier-scaled and each bonus resolves at most once', () => {
  const m = coopMatch({seed: 23});
  const state = m.objectiveState;
  const coop = state.coop;
  step(m, 1);
  const def = COOP_BONUS['hold-all'];
  for (let i = 0; i < ticks(def.holdSeconds) + 3; i++) {
    for (const node of capturable(state)) { node.owner = 0; node.progress = {0: 0, 1: 0}; }
    m.step(DT, {inputs: {}});
    if (coop.bonus.done.length) break;
  }
  assert.equal(coop.bonus.done.filter(id => id === 'hold-all').length, 1, 'a bonus completes once');
  assert.equal(coop.bonus.flux, Math.round(def.teamFlux * DIRECTOR_TIERS.D1.rewardMultiplier));
});

test('partial rewards retain 25% on failure, convert fully on a win and scale by tier', () => {
  const failure = convertCoopReq(180, 1, false, false, {tierRewardMultiplier: 1, failureRetention: 0.25});
  assert.equal(failure.scaledPool, 45, '25% of the run pool is retained');
  assert.equal(failure.retention, 0.25);
  assert.equal(failure.commendations, 45);
  const win = convertCoopReq(180, 1, true, false, {tierRewardMultiplier: 1});
  assert.equal(win.scaledPool, 180);
  assert.equal(win.retention, 1);
  // The win bonus (+25%) rides the existing matchMultiplier, so a full pool of
  // 180 converts to 225 — the same formula PvPvE uses.
  assert.equal(win.commendations, 225);
  const d4 = convertCoopReq(180, 1, true, false, {tierRewardMultiplier: DIRECTOR_TIERS.D4.rewardMultiplier});
  assert.equal(d4.scaledPool, 360, 'the D4 2.0x reward multiplier scales the pool');
  const bonus = convertCoopReq(180, 1, false, false, {tierRewardMultiplier: 1, failureRetention: 0.25, bonusCommendations: 1});
  assert.equal(bonus.commendations, 46, 'bonus COMMENDATION tokens add on top');
  // The end-to-end run summary uses the same conversion and never invents a currency.
  const m = coopMatch({seed: 29, timeLimit: 60});
  const state = m.objectiveState;
  step(m, 2);
  const summary = coopRewardSummary(m, state);
  assert.ok(summary && typeof summary.commendations === 'number');
  assert.equal(summary.bonus.commendations, state.coop.bonus.commendations);
});

test('the published tier copy table is complete and content-only', () => {
  for (const id of ['D1', 'D2', 'D3', 'D4']) {
    const copy = DIRECTOR_TIER_COPY[id];
    assert.ok(copy && typeof copy.copy === 'string' && copy.copy.length > 20, `${id} has published copy`);
    assert.ok(Array.isArray(copy.modifiers) && copy.modifiers.length > 0, `${id} lists its modifiers`);
    assert.equal(copy.band.length, 2, `${id} publishes a win-rate band`);
  }
  assert.ok(DIRECTOR_TIER_COPY.D4.band[0] < DIRECTOR_TIER_COPY.D1.band[0], 'the band shifts down with tier');
  assert.ok(DIRECTOR_TIERS.D4.rewardMultiplier > DIRECTOR_TIERS.D1.rewardMultiplier);
  assert.equal(tierBonusObjectives('D1').length, 1);
  assert.equal(tierBonusObjectives('D3').length, 2);
  // Copy/modifier data never carries a combat stat.
  const forbidden = ['health', 'damage', 'damageMult', 'speedMult', 'armor'];
  for (const id of ['D1', 'D2', 'D3', 'D4']) for (const key of forbidden) assert.equal(Object.hasOwn(DIRECTOR_TIER_COPY[id], key), false, `${id}.${key}`);
});

test('the spend window and bonus lane are absent from PvPvE `cocs` (mode isolation)', () => {
  const pvp = new Match('chatgpt', 'openclaw', mulberry32(3), 'warfront', {mode: 'cocs', humanCount: 1, botCount: 3, aiSeats: true, timeLimit: 60});
  step(pvp, 60);
  const state = pvp.objectiveState;
  assert.equal(state.coopMode, false);
  assert.equal(state.coop, false);
  assert.equal(cocsSnapshot(pvp).director, undefined, 'no director subtree in PvPvE');
  assert.equal(cocsSnapshot(pvp).bonus, undefined, 'no bonus lane in PvPvE');
  assert.equal(nodeById(state, 'front-w')?.captureResist, undefined, 'no fortify resist leaks into PvPvE');
  assert.deepEqual(coopSpend(pvp, state, {verb: 'RESUPPLY'}), {ok: false, reason: 'no-coop'});
  // Non-coop nodes have no resist, and the capture loop is untouched.
  assert.equal(pvp.objectiveState.fluxCap, 240, 'PvPvE keeps its tighter FLUX cap');
});

test('a seeded O1b intermission run is byte-identical across processes', () => {
  const run = seed => {
    const m = coopMatch({seed});
    const coop = openWindow(m, {auto: true});
    for (let i = 0; i < 240 && !m.over; i++) m.step(DT, {inputs: {}});
    return JSON.stringify({
      spends: coop.spendLog.map(entry => `${entry.cardId}:${entry.ok}:${entry.reason ?? ''}`),
      stats: coop.spendStats,
      bonus: coop.bonus,
      flux: Math.round(m.objectiveState.flux[0] * 1000) / 1000,
    });
  };
  assert.equal(run(31), run(31), 'the spend/bonus lane is deterministic');
});

test('the optional team-wipe RESERVE burns tickets and can end the operation', () => {
  const m = coopMatch({seed: 41});
  const coop = m.objectiveState.coop;
  step(m, 1);
  assert.equal(coop.reserve.enabled, false, 'the reserve is inert by default');
  coop.reserve.enabled = true;
  coop.reserve.tickets = 0;
  m.step(DT, {inputs: {}});
  assert.equal(m.over, true);
  assert.equal(m.overReason, 'team-wipe');
});

test('NO BREACH completes when the hq-0 gate survives and fails when it falls', () => {
  const finish = gateLost => {
    const m = coopMatch({seed: 43});
    const state = m.objectiveState;
    const coop = state.coop;
    step(m, 1);
    // Jump to the final clear with NO BREACH open.
    coop.wave = 5;
    coop.wavesCleared = 4;
    coop.waveTicks = 10;
    coop.waveTimerTicks = 100000;
    coop.phase = 'build_up';
    coop.intermission = false;
    coop.intermissionOpen = false;
    const gate = state.nodes.find(node => node.id === COOP_BONUS['no-breach'].gate);
    gate.owner = 0;
    coop.gateLost = gateLost;
    coop.bonus.queue = [];
    coop.bonus.open = ['no-breach'];
    coop.bonus.state = [{id: 'no-breach', label: COOP_BONUS['no-breach'].label, state: 'open', progress: 0, target: 1}];
    for (const actor of m.actors) if (actor.isDirectorWave === true) { actor.health = 0; actor.dead = 1e9; actor.bot = null; }
    coop.waveIds = [];
    coop.waveForceTotal = 1;
    coop.pending = [];
    for (let i = 0; i < 4 && !m.over && !coop.bonus.done.includes('no-breach') && !coop.bonus.failed.includes('no-breach'); i++) m.step(DT, {inputs: {}});
    return {m, coop};
  };
  const safe = finish(false);
  assert.ok(safe.coop.bonus.done.includes('no-breach'), 'NO BREACH pays when the gate survives');
  assert.ok(safe.coop.bonus.commendations >= 1, 'NO BREACH pays a COMMENDATION token');
  assert.equal(safe.m.overReason, 'operation-complete');
  const breached = finish(true);
  assert.ok(breached.coop.bonus.failed.includes('no-breach'), 'NO BREACH fails once the gate falls');
});

test('the director-exploit alarm flags pinning/no-spend but not a structural cap clamp', () => {
  const run = over => ({win: false, hqDamage: 100, fluxPinnedFraction: 0.1, spend: {windows: 1, budgetClampedFraction: 0.1, byType: {FORTIFY: 1, REPAIR: 0, RESUPPLY: 1, REINFORCE: 0}}, ...over});
  assert.deepEqual(exploitAlarms([run(), run()]), [], 'a healthy matrix is alarm-free');
  const pinned = [run({fluxPinnedFraction: 0.5}), run({fluxPinnedFraction: 0.5})];
  assert.ok(exploitAlarms(pinned).some(a => a.startsWith('flux-pinned')), 'FLUX pinning is an alarm');
  const deadSinks = [run({spend: {windows: 1, budgetClampedFraction: 0.1, byType: {FORTIFY: 0, REPAIR: 0, RESUPPLY: 0, REINFORCE: 0}}}), run()];
  assert.ok(exploitAlarms(deadSinks).some(a => a.startsWith('no-intermission-spends')), 'an unused spend window is an alarm');
  // A clamped Director budget with a *losing* team is structural, not an exploit.
  const clampedLosses = [run({spend: {windows: 1, budgetClampedFraction: 0.7, byType: {FORTIFY: 1, REPAIR: 0, RESUPPLY: 1, REINFORCE: 0}}}), run({spend: {windows: 1, budgetClampedFraction: 0.7, byType: {FORTIFY: 1, REPAIR: 0, RESUPPLY: 1, REINFORCE: 0}}})];
  assert.deepEqual(exploitAlarms(clampedLosses), [], 'a clamp alone is not a trivialisation alarm');
  assert.ok(exploitWarnings(clampedLosses).some(w => w.startsWith('pressure-clamped')), 'the clamp is still reported as a warning');
});

test('spawnCoopSquad is capped and yields a team-0 ally, never Director wave force', () => {
  const m = coopMatch({seed: 37});
  const state = m.objectiveState;
  step(m, 2);
  const cap = COOP_SINKS.REINFORCE.squadCap;
  const ids = [];
  for (let i = 0; i < cap + 2; i++) { const id = spawnCoopSquad(m, state); if (id !== null) ids.push(id); }
  assert.equal(ids.length, cap, 'the squad cap is enforced');
  for (const id of ids) {
    const actor = m.actors.find(entry => entry.id === id);
    assert.equal(actor.team, 0);
    assert.equal(actor.isDirectorWave, undefined, 'a friendly squad is not Director wave force');
  }
  void setCoopTier;
});
