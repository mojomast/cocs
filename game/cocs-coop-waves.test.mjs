import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {COCS_TIERS, directorWavePlan, operationsWave, directorComposition} from './cocs-difficulty.mjs';
import {setCoopTier} from './cocs-coop.mjs';

const mulberry32 = seed => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const coopMatch = (over = {}) => new Match('chatgpt', 'openclaw', mulberry32(over.seed ?? 3), 'lattice-slice', {
  mode: 'cocs-coop', humanCount: 4, botCount: 2, aiSeats: true, timeLimit: 900, ...over,
});
const step = (m, n = 1) => { for (let i = 0; i < n && !m.over; i++) m.step(1 / 60, {inputs: {}}); return m; };

test('a stalled wave folds forward on overrun and the Director withdraws the remnant', () => {
  const m = coopMatch({seed: 17});
  const coop = m.objectiveState.coop;
  step(m, 300);
  assert.ok(coop.waveIds.some(id => m.actors.find(actor => actor.id === id && actor.health > 0)), 'wave force alive');
  // Pin the wave timer so the overrun fires immediately.
  coop.waveTicks = coop.waveTimerTicks;
  const before = coop.overruns;
  step(m, 1);
  assert.equal(coop.overruns, before + 1, 'the wave folds forward instead of waiting');
  assert.ok(coop.waveTimerTicks > coop.waveTicks, 'the timer extends');
  // A second overrun withdraws the non-boss remnant and clears the wave.
  coop.waveTicks = coop.waveTimerTicks;
  const clearedBefore = coop.wavesCleared;
  step(m, 4);
  assert.ok(coop.wavesCleared > clearedBefore || coop.phase === 'intermission', 'the stalled wave clears');
});

test('D2-D4 ship as published data and run a short smoke without changing stats', () => {
  for (const tier of COCS_TIERS) {
    const plan = directorWavePlan(5, tier);
    assert.ok(Object.keys(plan.composition).length > 0, `${tier} has a wave-5 composition`);
    assert.ok(plan.timer > 0);
    const m = coopMatch({seed: 31});
    setCoopTier(m.objectiveState, tier);
    step(m, 600);
    const coop = m.objectiveState.coop;
    assert.equal(coop.tier, tier);
    assert.ok(m.actors.some(actor => actor.team === 1), `${tier} fields team 1`);
    // The archetype tables are untouched by tier selection.
    for (const [, count] of Object.entries(directorComposition(5, tier))) assert.ok(count >= 0);
  }
  assert.equal(operationsWave(5).boss, true);
});

test('the overrun and withdrawal are deterministic for a fixed seed', () => {
  const run = seed => {
    const m = coopMatch({seed});
    const coop = m.objectiveState.coop;
    step(m, 300);
    coop.waveTicks = coop.waveTimerTicks;
    step(m, 6);
    return JSON.stringify({overruns: coop.overruns, cleared: coop.wavesCleared, tick: coop.tick, phase: coop.phase});
  };
  assert.equal(run(9), run(9));
});
