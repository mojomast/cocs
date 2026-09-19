import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {snapshotDelta, applySnapshotDelta} from './protocol.mjs';
import {cocsSnapshot} from './cocs.mjs';

const mulberry32 = seed => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const build = (seed, over = {}) => new Match('chatgpt', 'openclaw', mulberry32(seed), 'lattice-slice', {
  mode: 'cocs-coop', humanCount: 4, botCount: 2, aiSeats: true, timeLimit: 900, ...over,
});

const run = (seed, ticks) => {
  const m = build(seed);
  const frames = [];
  for (let i = 0; i < ticks && !m.over; i++) {
    m.step(1 / 60, {inputs: {}});
    if (i % 300 === 0) frames.push(JSON.stringify(m.snapshot()));
  }
  return {match: m, frames, events: JSON.stringify(m.events), over: m.over, reason: m.overReason};
};

test('a seeded D1 OPERATIONS run is byte-identical across two matches', () => {
  const a = run(42, 2400);
  const b = run(42, 2400);
  assert.deepEqual(a.frames, b.frames, 'snapshot frames match');
  assert.equal(a.events, b.events, 'the event stream matches');
  assert.equal(a.over, b.over);
  assert.equal(a.reason, b.reason);
  assert.ok(a.frames.length >= 4);
  // A different seed diverges, so the test is actually exercising the RNG.
  const c = run(43, 2400);
  assert.notDeepEqual(a.frames, c.frames);
});

test('the co-op snapshot survives a snapshotDelta round-trip', () => {
  const m = build(7);
  for (let i = 0; i < 900; i++) m.step(1 / 60, {inputs: {}});
  const base = cocsSnapshot(m);
  const state = m.objectiveState;
  // Mutate the director and command surfaces the way a tick would.
  state.coop.pressure += 12.5;
  state.coop.waveTicks += 3;
  state.coop.siege.health -= 40;
  state.coop.command.executor = 99;
  state.nodes.find(node => node.id === 'front-0').progress[0] = 0.42;
  const next = cocsSnapshot(m);
  const delta = snapshotDelta(base, next);
  assert.ok(delta, 'a changed co-op frame produces a patch');
  assert.deepEqual(applySnapshotDelta(base, delta), next, 'apply(delta) reconstructs the frame');
});
