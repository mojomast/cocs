// WP1.4 contract: OPERATIONS executes the authored per-wave front plan.
//
// `directorWavePlan()` publishes per-wave/per-tier fronts (design §3.2). These
// tests verify the data wiring — runtime target selection, the emitted wave
// event, spawn distribution and deterministic retargeting — for every D1-D4 x
// wave pair. They are contract verification, not D2-D4 balance measurement.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {COCS_TIERS, directorWavePlan} from './cocs-difficulty.mjs';
import {cocsDirectorSnapshot} from './cocs-coop.mjs';
import {cocsSnapshot, nodeById} from './cocs.mjs';

const DT = 1 / 60;
const mulberry32 = seed => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const build = (tier, seed = 7) => new Match('chatgpt', 'openclaw', mulberry32(seed), 'lattice-slice', {
  mode: 'cocs-coop', humanCount: 4, botCount: 2, aiSeats: true, timeLimit: 900, objective: {tier},
});
const step = (m, n = 1) => { for (let i = 0; i < n && !m.over; i++) m.step(DT, {inputs: {}}); return m; };
const capturable = state => state.nodes.filter(node => ['front', 'economy', 'relay'].includes(node.archetype));
const livingWave = (m, coop) => coop.waveIds
  .map(id => m.actors.find(actor => actor.id === id))
  .filter(actor => actor && actor.health > 0 && actor.isDirectorWave === true);
const waveEvent = (m, wave) => [...m.events].reverse().find(event => event.type === 'director-wave' && event.wave === wave) ?? null;

// Drive the match straight to the opening of an authored wave with a neutral
// lattice, so every authored front slot has a legal target regardless of what
// the opening bots captured. The contract under test is target wiring, not a
// bot capture race.
const openWave = (tier, wave, seed = 7) => {
  const m = build(tier, seed);
  step(m, 1); // initialize the Director
  const state = m.objectiveState;
  const coop = state.coop;
  for (const node of capturable(state)) { node.owner = null; node.progress = {0: 0, 1: 0}; }
  coop.siege.armed = false;
  coop.siege.health = coop.siege.max;
  coop.wave = wave - 1;
  coop.phase = 'intermission';
  coop.intermission = true;
  coop.intermissionTicks = 1;
  m.step(DT, {inputs: {}}); // startWave
  return {m, state, coop};
};

test('every D1-D4 wave runs its authored front count in runtime, event and snapshot', () => {
  for (const tier of COCS_TIERS) {
    for (let wave = 1; wave <= 5; wave++) {
      const plan = directorWavePlan(wave, tier);
      const {m, state, coop} = openWave(tier, wave);
      const label = `${tier} wave ${wave}`;
      assert.equal(coop.wave, wave, `${label} started`);
      assert.equal(coop.fronts.length, plan.fronts, `${label} runtime fronts match the authored plan`);
      assert.equal(coop.targetNode, coop.fronts[0].nodeId, `${label} primary front is the first authored front`);
      const event = waveEvent(m, wave);
      assert.ok(event, `${label} emits director-wave`);
      assert.equal(event.fronts, plan.fronts, `${label} emitted wave fronts match the authored plan`);
      assert.equal(cocsDirectorSnapshot(m, state).fronts.length, plan.fronts, `${label} snapshot fronts match the authored plan`);
    }
  }
});

test('the wave baseline is staged across the authored fronts, deterministically', () => {
  for (const tier of COCS_TIERS) {
    for (let wave = 1; wave <= 5; wave++) {
      const plan = directorWavePlan(wave, tier);
      const label = `${tier} wave ${wave}`;
      const spawnRun = () => {
        const {m, coop} = openWave(tier, wave);
        step(m, 150); // the 1.5 s telegraph resolves the staged baseline
        return {
          fronts: coop.fronts.map(front => front.nodeId),
          assignment: livingWave(m, coop).map(actor => [actor.id, actor.directorNode]),
        };
      };
      const run = spawnRun();
      assert.ok(run.assignment.length > 0, `${label} fields a living baseline`);
      const fronts = new Set(run.fronts);
      for (const [id, node] of run.assignment) assert.ok(fronts.has(node), `${label} actor ${id} attacks a current front`);
      const attacked = new Set(run.assignment.map(([, node]) => node));
      if (plan.fronts === 1) assert.equal(attacked.size, 1, `${label} keeps one front`);
      else assert.ok(attacked.size > 1, `${label} spreads the force across more than one front`);
      assert.ok(attacked.size <= plan.fronts, `${label} never exceeds the authored front count`);
      assert.deepEqual(spawnRun(), run, `${label} spawn distribution is deterministic for one seed`);
    }
  }
});

test('a lost front redistributes only its own bodies, deterministically and legally', () => {
  for (const tier of COCS_TIERS) {
    for (let wave = 1; wave <= 5; wave++) {
      const label = `${tier} wave ${wave}`;
      const scenario = () => {
        const {m, state, coop} = openWave(tier, wave);
        step(m, 150);
        const before = livingWave(m, coop).map(actor => [actor.id, actor.directorNode]);
        // The Director takes the first front that currently holds bodies; every
        // body there loses its target and must be redistributed.
        const lost = coop.fronts.find(front => before.some(([, node]) => node === front.nodeId));
        assert.ok(lost, `${label} has a front with living bodies`);
        nodeById(state, lost.nodeId).owner = 1;
        coop.retargetTick = coop.tick; // force the periodic retarget on the next step
        m.step(DT, {inputs: {}});
        return {
          lost: lost.nodeId,
          fronts: coop.fronts.map(front => front.nodeId),
          before,
          after: livingWave(m, coop).map(actor => [actor.id, actor.directorNode]),
        };
      };
      const a = scenario();
      const b = scenario();
      assert.deepEqual(a, b, `${label} retarget is deterministic across two identical runs`);
      // No body may be left pointed at a front that is no longer targeted.
      const valid = new Set(a.fronts);
      for (const [id, node] of a.after) assert.ok(valid.has(node), `${label} actor ${id} holds a live front`);
      assert.equal(a.after.some(([, node]) => node === a.lost), false, `${label} the lost front is abandoned`);
      const beforeOf = id => a.before.find(([bid]) => bid === id)[1];
      const onLostFront = a.after.filter(([id]) => beforeOf(id) === a.lost);
      const onSurvivingFronts = a.after.filter(([id]) => beforeOf(id) !== a.lost);
      assert.ok(onLostFront.length > 0, `${label} had bodies on the lost front`);
      for (const [id, node] of onSurvivingFronts) assert.equal(node, beforeOf(id), `${label} surviving fronts keep actor ${id}`);
      // Redistribution is not a collapse onto the primary node.
      if (a.fronts.length > 1) assert.ok(new Set(a.after.map(([, node]) => node)).size > 1, `${label} keeps more than one front occupied`);
    }
  }
});

test('authored fronts keep the seeded run byte-identical in the published snapshot', () => {
  const run = () => {
    const {m, coop} = openWave('D4', 5, 0xC0DE);
    step(m, 400); // past the telegraph and two periodic retargets
    return {snapshot: JSON.stringify(cocsSnapshot(m)), fronts: coop.fronts.map(front => front.nodeId)};
  };
  const first = run();
  const second = run();
  assert.deepEqual(first, second, 'same seed, same published state');
});
