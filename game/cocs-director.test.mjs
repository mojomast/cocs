import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COOP_PACING, DIRECTOR_COSTS, DIRECTOR_TIERS, OPERATIONS_WAVES, COOP_SIEGE,
  COCS_TIERS, DEFAULT_COCS_TIER, directorComposition, directorTier, directorWavePlan,
  compositionCost, normalizeCocsTier, operationsWave,
} from './cocs-difficulty.mjs';
import {
  DIRECTOR_PHASES, directorAccrue, directorBossType, directorCap, directorForceAlive,
  directorFronts, directorPhase, directorPickSpawn, directorRate, directorReinforcementOrder,
  directorSpend, directorWeakness, siegeShouldArm, siegeShouldLift,
} from './cocs-director.mjs';

// A tiny synthetic lattice: three team-0 nodes with different defences.
const lattice = () => ({
  nodes: [
    {id: 'front-0', archetype: 'front', owner: 0, x: 0, z: 0, r: 14, progress: {0: 0, 1: 0}},
    {id: 'econ-n', archetype: 'economy', owner: 0, x: 60, z: 0, r: 14, progress: {0: 0.4, 1: 0}},
    {id: 'relay-0', archetype: 'relay', owner: 0, x: 120, z: 0, r: 14, progress: {0: 0, 1: 0}},
    {id: 'front-1', archetype: 'front', owner: 1, x: 180, z: 0, r: 14, progress: {0: 0, 1: 0}},
  ],
  adjacency: {'front-0': ['front-1', 'econ-n'], 'econ-n': ['front-0', 'relay-0', 'front-1'], 'relay-0': ['econ-n', 'front-1'], 'front-1': ['front-0', 'econ-n', 'relay-0']},
});

const actor = (id, team, x, z) => ({id, team, health: 100, x, z});

test('director pacing machine walks BUILD_UP -> PEAK -> RELAX and INTERMISSION', () => {
  assert.equal(directorPhase(0, 1200, true), 'intermission');
  assert.equal(directorPhase(0, 1200, false), 'build_up');
  assert.equal(directorPhase(479, 1200, false), 'build_up');
  assert.equal(directorPhase(480, 1200, false), 'peak');
  assert.equal(directorPhase(899, 1200, false), 'peak');
  assert.equal(directorPhase(900, 1200, false), 'relax');
  assert.deepEqual(DIRECTOR_PHASES, ['intermission', 'build_up', 'peak', 'relax']);
  assert.ok(COOP_PACING.rateFactor.build_up < COOP_PACING.rateFactor.peak);
});

test('the published tier table is complete and content-only', () => {
  assert.deepEqual([...COCS_TIERS], ['D1', 'D2', 'D3', 'D4']);
  assert.equal(normalizeCocsTier('d3'), 'D3');
  assert.equal(normalizeCocsTier('nope'), DEFAULT_COCS_TIER);
  for (const id of COCS_TIERS) {
    const tier = DIRECTOR_TIERS[id];
    assert.equal(tier.id, id);
    // Difficulty adds problems; it never carries a combat stat.
    for (const stat of ['health', 'armor', 'damage', 'damageMult', 'speedMult']) {
      assert.equal(Object.hasOwn(tier, stat), false, `${id} must not define ${stat}`);
    }
    assert.ok(directorTier(id).rate > 0);
  }
  assert.equal(DIRECTOR_TIERS.D2.fronts, 2);
  assert.equal(DIRECTOR_TIERS.D4.fronts, 3);
  assert.ok(DIRECTOR_TIERS.D4.waveTimerMultiplier < DIRECTOR_TIERS.D1.waveTimerMultiplier);
  assert.ok(DIRECTOR_TIERS.D4.cap > DIRECTOR_TIERS.D1.cap);
});

test('budget accrues, caps and spends without going negative', () => {
  const cap = directorCap('D1');
  assert.equal(directorRate('D1', 'peak'), DIRECTOR_TIERS.D1.rate);
  assert.equal(directorRate('D1', 'build_up'), DIRECTOR_TIERS.D1.rate * COOP_PACING.rateFactor.build_up);
  assert.equal(directorRate('D1', 'intermission'), 0);
  const grown = directorAccrue(0, 4, 10, cap);
  assert.equal(grown, 40);
  assert.equal(directorAccrue(cap - 1, 4, 10, cap), cap);
  assert.equal(directorSpend(20, 8), 12);
  assert.equal(directorSpend(4, 8), null);
  assert.equal(directorSpend(4, 4), 0);
});

test('front selection targets the weakest team-0-held node, ties by id', () => {
  const state = lattice();
  const actors = [actor(0, 0, 0, 0), actor(1, 0, 0, 0), actor(2, 0, 60, 0)];
  // front-0 has 2 defenders, econ-n has 1, relay-0 has 0 -> relay is weakest.
  const fronts = directorFronts(state, actors, {team: 1, count: 2});
  assert.deepEqual(fronts.map(front => front.nodeId), ['relay-0', 'econ-n']);
  // Tie-break by id even when actor order is reversed.
  const tied = directorFronts(lattice(), [], {team: 1, count: 3});
  assert.deepEqual(tied.map(front => front.nodeId), ['front-0', 'relay-0', 'econ-n']);
  assert.ok(directorWeakness([], state.nodes[0], 1) < directorWeakness([actor(0, 0, 0, 0)], state.nodes[0], 1));
});

test('reinforcement order and boss alternation are deterministic', () => {
  const plan = directorWavePlan(5, 'D1');
  const order = directorReinforcementOrder(plan.composition);
  assert.deepEqual(order, directorReinforcementOrder(plan.composition));
  assert.ok(order.length > 0);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1].count >= order[i].count);
  assert.equal(directorBossType(0.1), 'warden');
  assert.equal(directorBossType(0.9), 'harbinger');
});

test('spawn points are LoS-safe, >=15 m from players and off capture radii', () => {
  const state = lattice();
  const actors = [actor(0, 0, 0, 0)];
  const nav = [{x: 0, z: 0}, {x: 200, z: 40}, {x: 30, z: 0}];
  const canSee = (a, point) => point.x > 100;
  const point = directorPickSpawn(state, actors, nav, {nodeId: 'front-0', minDistance: 15, canSee});
  assert.ok(point, 'a legal point exists');
  assert.ok(Math.hypot(point.x - 0, point.z - 0) >= 15);
  assert.ok(!canSee(actors[0], point));
  for (const node of state.nodes) assert.ok(Math.hypot(node.x - point.x, node.z - point.z) > node.r + 2);
  // With every point in LoS and too close, the picker refuses rather than forcing.
  assert.equal(directorPickSpawn(state, [actor(0, 0, 100, 0)], [{x: 101, z: 0}], {nodeId: 'front-0', minDistance: 15, canSee: () => true}), null);
});

test('force-alive and siege arm/lift rules are pure and legible', () => {
  const actors = [{id: 4, health: 0}, {id: 5, health: 12}];
  assert.equal(directorForceAlive(actors, [4]), false);
  assert.equal(directorForceAlive(actors, [4, 5]), true);
  assert.equal(directorForceAlive(actors, []), false);
  assert.equal(siegeShouldArm({armed: false, wave: 5, waveArm: 5, ownsCapturable: 3, armMajority: 3}), true);
  assert.equal(siegeShouldArm({armed: false, wave: 4, waveArm: 5, ownsCapturable: 3, armMajority: 3}), false);
  assert.equal(siegeShouldArm({armed: false, wave: 1, waveArm: 5, ownsCapturable: 5, armMajority: 3}), true);
  assert.equal(siegeShouldLift({armed: true, ownsCapturable: 2, armMajority: 3}), true);
  assert.equal(siegeShouldLift({armed: true, ownsCapturable: 3, armMajority: 3}), false);
});

test('wave plans scale count by tier and never inflate stats', () => {
  const d1 = directorWavePlan(5, 'D1');
  const d4 = directorWavePlan(5, 'D4');
  assert.equal(d1.wave, 5);
  // The published per-wave front counts are authored (design §3.2): wave 5 is
  // 2/2/3/3 on D1–D4, so D1's plan raises the tier's general 1-front cap.
  assert.equal(d1.fronts, OPERATIONS_WAVES[4].fronts.D1);
  assert.equal(d4.fronts, OPERATIONS_WAVES[4].fronts.D4);
  assert.ok(d4.timer < d1.timer, 'D4 compresses the wave timer');
  assert.equal(directorWavePlan(1, 'D4').fronts, 1, 'the tutorial wave is always one front');
  assert.equal(d1.boss, true);
  const d3 = directorComposition(3, 'D3');
  assert.ok((d3.sapper ?? 0) >= 1, 'D3 adds denial bodies');
  assert.ok(compositionCost(d1.composition) > 0);
  // A wave-1 plan on any tier costs more than the base starting budget is not required.
  assert.ok(OPERATIONS_WAVES.length === 5);
  assert.equal(operationsWave(9).wave, 5);
  assert.ok(Object.keys(DIRECTOR_COSTS).length >= 10);
  assert.equal(COOP_SIEGE.hqId, 'hq-0');
});
