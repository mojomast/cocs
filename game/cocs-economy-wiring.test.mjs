// LATTICE STRIKE (`cocs`) V0b economy + SCOUT wiring.
//
// Spec: docs/design/COCS-MODE-SPEC.md §6 (FLUX), §6A.4–§6A.6 (objective-first
// scoring, REQ, order rewards), §8 (subagents). Covers team FLUX income/spend/
// upkeep, per-actor REQ accrual and capture/order rewards, the SCOUT spawn/cap/
// scan/SPOT/expiry lifecycle, the additive snapshot surface, determinism and
// mode isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {snapshotDelta, applySnapshotDelta} from './protocol.mjs';
import {
  COCS_KIND, COCS_SPOT_DAMAGE_BONUS, activeScoutActor, cocsSnapshot, cocsSpotDamageScale,
  addActorReq, nodeById, sortCocsOrders,
} from './cocs.mjs';
import {SUBAGENTS, subagentUpkeep, supplySlotMultiplier} from './cocs-economy.mjs';
import {cocsDutyPolicy} from './cocs-bots.mjs';

const DT = 1 / 60;
const cocsMatch = (over = {}) => new Match('chatgpt', 'openclaw', () => 0.5, 'warfront', {
  mode: 'cocs', botCount: 0, humanCount: 1, timeLimit: 300, cocsPolicy: () => [], ...over,
});
const scanOrder = (tick, target, team = 0) => ({tick, peerId: `p${team}`, cardId: `s-${team}-${tick}`, team, verb: 'SCAN', target});
const attackOrder = (tick, target, team = 0) => ({tick, peerId: `p${team}`, cardId: `a-${team}-${tick}`, team, verb: 'ATTACK', target});
const place = (match, actor, node) => {
  actor.x = node.x; actor.z = node.z; actor.y = node.y;
  actor.health = 200; actor.maxHealth = 200; actor.armor = 0;
  return actor;
};

test('team FLUX accrues passive + connected-node income on the fixed clock', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  assert.equal(state.flux[0], 80, 'the §6.2 start bank is 80');
  assert.equal(state.fluxCap, 240);
  for (let i = 0; i < 60; i++) match.step(DT, {inputs: {}});
  assert.ok(Math.abs(state.flux[0] - 81) < 0.05, 'one second of +1/s passive');
  // Owning the linked front adds its +1/s node income.
  nodeById(state, 'front-w').owner = 0;
  const before = state.flux[0];
  for (let i = 0; i < 60; i++) match.step(DT, {inputs: {}});
  assert.ok(Math.abs((state.flux[0] - before) - 2) < 0.05, 'passive + front node = 2/s');
  assert.equal(state.fluxIncome[0], 2);
});

test('a SCAN order spends FLUX, spawns one scout, and upkeep drains the pool', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const before = state.flux[0];
  match.step(DT, {cocs: {orders: [scanOrder(1, 'relay-c')]}});
  assert.equal(state.scoutStats[0].spawned, 1);
  assert.equal(state.fluxSpent[0], SUBAGENTS.scout.spawnCost);
  assert.ok(state.flux[0] < before - SUBAGENTS.scout.spawnCost + 1, 'spawn cost was deducted');
  const scout = activeScoutActor(match, state, 0);
  assert.ok(scout, 'the scout is a real actor on the roster');
  assert.equal(scout.isScout, true);
  assert.equal(scout.team, 0);
  assert.ok(state.fluxUpkeep[0] > 0, 'active subagent upkeep is charged');
  // Net rate is passive + node income - upkeep, so strictly below passive.
  const f0 = state.flux[0];
  for (let i = 0; i < 120; i++) match.step(DT, {inputs: {}});
  const gained = state.flux[0] - f0;
  assert.ok(gained > 1.0 && gained < 1.3, `FLUX grew ${gained} over 2 s (passive minus upkeep)`);
});

test('a second SCAN does not exceed the per-team scout cap', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  match.step(DT, {cocs: {orders: [scanOrder(1, 'relay-c')]}});
  const first = activeScoutActor(match, state, 0);
  match.step(DT, {cocs: {orders: [scanOrder(2, 'front-e')]}});
  const second = activeScoutActor(match, state, 0);
  assert.equal(state.scoutStats[0].spawned, 1, 'cap 1: no second spawn');
  assert.equal(first.id, second.id, 'the live scout is re-targeted, not duplicated');
  assert.equal(second.scoutTargetNode, 'front-e');
  assert.ok(match.actors.filter(actor => actor.isScout === true).length <= 1);
});

test('a capture pays REQ to participants and a completed order pays team + contributors', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = place(match, match.actors[0], nodeById(state, 'front-w'));
  actor.team = 0;
  const before = state.scores[0];
  const ticks = Math.ceil(state.captureSeconds / DT) + 4;
  for (let i = 0; i < ticks; i++) match.step(DT, {cocs: {orders: [attackOrder(i + 1, 'front-w')]}});
  assert.equal(nodeById(state, 'front-w').owner, 0);
  assert.ok(actor.scoreStats.objectiveCaptures >= 1);
  // §6A.4/§6A.5: capture +10 team OP / +8 REQ, order +20 team OP / +15 REQ.
  assert.ok(state.scores[0] - before >= 30, 'capture points plus the order reward');
  assert.ok(actor.reqEarned >= 23, `captured REQ ${actor.reqEarned}`);
  assert.equal(actor.scoreStats.ordersContributed >= 1, true);
  assert.equal(state.orderStats.completed >= 1, true);
  assert.ok(state.orderStats.byVerb.ATTACK >= 1);
});

test('objective presence drips REQ to a holder and addActorReq mirrors scoreStats', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = place(match, match.actors[0], nodeById(state, 'front-w'));
  actor.team = 0;
  nodeById(state, 'front-w').owner = 0;
  for (let i = 0; i < 240; i++) match.step(DT, {inputs: {}});
  assert.ok(actor.reqEarned > 0.9 && actor.reqEarned < 1.1, `~1 s of 0.25/s presence: ${actor.reqEarned}`);
  assert.equal(actor.scoreStats.reqEarned, actor.reqEarned);
  addActorReq(actor, 5);
  assert.equal(actor.reqEarned, actor.scoreStats.reqEarned);
});

test('SCAN marks the area and SPOT adds +15% damage for the spotting team only', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const enemy = place(match, match.actors[0], nodeById(state, 'relay-c'));
  enemy.team = 1;
  const source = match.actor(1, 'chatgpt', 'openclaw');
  source.team = 0; source.health = 200; source.maxHealth = 200; source.bot = null;
  match.actors.push(source);
  match.step(DT, {cocs: {orders: [scanOrder(1, 'relay-c')]}});
  for (let i = 0; i < 900 && state.scoutStats[0].scans < 1; i++) match.step(DT, {inputs: {}});
  assert.equal(state.scoutStats[0].scans, 1, 'the scout reached the area and scanned');
  assert.ok(state.spots[enemy.id], 'the enemy is marked');
  assert.equal(state.spots[enemy.id].team, 0);
  assert.equal(cocsSpotDamageScale(match, source, enemy), 1 + COCS_SPOT_DAMAGE_BONUS);
  assert.equal(cocsSpotDamageScale(match, enemy, source), 1, 'the bonus is one-directional');
  const before = enemy.health;
  match.damage(enemy, 10, source);
  assert.ok(Math.abs((before - enemy.health) - 11.5) < 1e-6, '10 damage lands as 11.5');
  enemy.health = 200;
  assert.equal(enemy.lastHitBy, source.id, 'the kill attribution hook is set in cocs');
});

test('a scout retires cleanly at the end of its run and can be killed for a bounty', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  match.step(DT, {cocs: {orders: [scanOrder(1, 'relay-c')]}});
  const scout = activeScoutActor(match, state, 0);
  assert.ok(scout);
  // Expire it on demand: the lifecycle retires it, kills its respawn timer and
  // clears the active slot without splicing the roster.
  scout.scoutExpireTick = state.tick;
  match.step(DT, {inputs: {}});
  assert.equal(state.scoutStats[0].expired, 1);
  assert.equal(activeScoutActor(match, state, 0), null);
  assert.equal(scout.health, 0);
  assert.ok(scout.dead >= 1e8, 'never auto-respawns');
  assert.ok(match.actors.includes(scout), 'slot is recycled, roster length is stable');
  // A fresh SCAN reuses the same slot.
  match.step(DT, {cocs: {orders: [scanOrder(3, 'front-e')]}});
  assert.equal(state.scoutStats[0].spawned, 2);
  const reused = activeScoutActor(match, state, 0);
  assert.equal(reused.id, scout.id);
  assert.equal(match.actors.filter(actor => actor.isScout === true).length, 1);
  // Killing it pays the enemy team the §8.2 FLUX bounty plus the kill score.
  const enemyFlux = state.flux[1];
  const enemyScore = state.scores[1];
  reused.protection = 0;
  match.damage(reused, 500, match.actors[0]);
  match.step(DT, {inputs: {}});
  assert.equal(state.scoutStats[0].killed, 1);
  assert.ok(state.flux[1] > enemyFlux, 'enemy banked the bounty');
  assert.ok(state.scores[1] - enemyScore >= 2, 'kill-subagent objective score');
});

test('the cocs snapshot additions are id-keyed, delta-friendly and base64-free', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  for (let i = 0; i < 30; i++) match.step(DT, {inputs: {}});
  const base = cocsSnapshot(match);
  for (const key of ['flux', 'fluxCap', 'fluxIncome', 'fluxUpkeep', 'fluxSpent', 'neglect', 'req', 'scouts', 'scoutStats', 'spots', 'scans', 'orderStats', 'scoutCap', 'scanRadius', 'spotSeconds', 'spotBonus']) {
    assert.ok(Object.hasOwn(base, key), `snapshot exposes ${key}`);
  }
  assert.deepEqual(Object.keys(base.flux).sort(), ['0', '1']);
  assert.ok(Array.isArray(base.req) && base.req.every(entry => Number.isInteger(entry.id)));
  assert.ok(Array.isArray(base.scouts));
  assert.ok(Array.isArray(base.spots));
  assert.equal(snapshotDelta(base, base), null);
  assert.equal(JSON.stringify(base).includes('base64'), false);
  state.flux[0] += 7;
  match.actors[0].req = 12;
  state.spots[99] = {team: 1, until: state.tick + 30, x: 1, z: 2, by: 7};
  const next = cocsSnapshot(match);
  const delta = snapshotDelta(base, next);
  assert.ok(delta, 'changes produce a delta');
  assert.deepEqual(applySnapshotDelta(base, delta), next, 'apply(delta) reconstructs the frame');
});

test('a seeded duty-policy cocs match with scouts is byte-identical and RNG-stable', () => {
  const mulberry32 = seed => {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const counting = seed => { const base = mulberry32(seed); const fn = () => { fn.draws++; return base(); }; fn.draws = 0; return fn; };
  const run = seed => {
    const random = counting(seed);
    const match = new Match('chatgpt', 'openclaw', random, 'warfront', {mode: 'cocs', botCount: 3, humanCount: 1, aiSeats: true, difficulty: 'normal', timeLimit: 90});
    for (let i = 0; i < 3000 && !match.over; i++) match.step(DT, {inputs: {}});
    return {snapshot: match.snapshot(), draws: random.draws, spawns: match.objectiveState.scoutStats[0].spawned + match.objectiveState.scoutStats[1].spawned};
  };
  const first = run(0xB0B);
  const second = run(0xB0B);
  assert.ok(first.spawns > 0, 'the duty Chief screened with scouts');
  assert.equal(first.draws, second.draws, 'identical RNG consumption');
  assert.deepEqual(first.snapshot, second.snapshot, 'byte-identical replay');
  assert.notDeepEqual(run(0xB0C).snapshot, first.snapshot, 'a different seed diverges');
});

test('an empty-scan order and the scan sort stay deterministic', () => {
  const orders = [scanOrder(1, 'front-e', 1), scanOrder(1, 'relay-c', 0), attackOrder(1, 'front-w', 0)];
  assert.deepEqual(sortCocsOrders(orders).map(order => order.cardId), ['a-0-1', 's-0-1', 's-1-1']);
});

test('the duty policy issues a SCAN on its screening cadence without an RNG', () => {
  const match = cocsMatch({cocsPolicy: cocsDutyPolicy});
  const state = match.objectiveState;
  const actors = [{id: 0, team: 0, health: 100, x: -20, z: 0}, {id: 1, team: 1, health: 100, x: 20, z: 0}];
  const off = cocsDutyPolicy(state, {tick: 45, actors});
  assert.equal(off.some(order => order.verb === 'SCAN'), false, 'no scan off the cadence');
  state.tick = 900;
  const due = cocsDutyPolicy(state, {tick: 900, actors});
  assert.ok(due.some(order => order.verb === 'SCAN'), 'a scan is issued on the 15 s cadence');
  assert.doesNotThrow(() => cocsDutyPolicy(state, {tick: 900, actors, random: () => { throw new Error('rng'); }}));
});

test('non-cocs modes have no economy, scout or SPOT leakage', () => {
  const run = () => {
    const match = new Match('chatgpt', 'openclaw', () => 0.5, 'warfront', {mode: 'domination', botCount: 3, humanCount: 1, aiSeats: true, timeLimit: 20});
    for (let i = 0; i < 600 && !match.over; i++) match.step(DT, {inputs: {}});
    return match;
  };
  const match = run();
  const snap = match.snapshot();
  assert.notEqual(match.objectiveState.kind, COCS_KIND);
  assert.equal(snap.cocs, undefined, 'no cocs subtree in another mode');
  assert.equal(match.actors.some(actor => actor.isScout === true), false, 'no scout actors leak');
  assert.equal(cocsSpotDamageScale(match, {team: 0}, {id: 0, team: 1}), 1, 'SPOT is inert outside cocs');
  assert.deepEqual(run().snapshot(), snap, 'other modes stay deterministic');
});

test('supply-load upkeep follows the §6.5 slot/hop table', () => {
  assert.equal(supplySlotMultiplier(1), 1.0);
  assert.equal(supplySlotMultiplier(4), 1.6);
  assert.equal(supplySlotMultiplier(6), 3.0);
  assert.equal(subagentUpkeep('scout', 1), 0.4);
  assert.equal(subagentUpkeep('scout', 1, {hops: 1}), 0.42);
  assert.equal(subagentUpkeep('scout', 4, {hops: 5}), 0.8);
  assert.equal(subagentUpkeep('scout', 1, {hops: 9}), 0.5, 'hop surcharge caps at +25%');
  assert.equal(subagentUpkeep('unknown', 1), 0);
  assert.equal(SUBAGENTS.scout.spawnCost, 7);
});
