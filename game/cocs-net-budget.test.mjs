// LATTICE STRIKE entity budget (§11.5, rev 3.3): the rate-only snapshot budget.
// Asserts the actor cap, the fixed-step p95, the keyframe/delta byte ceilings and
// the per-second client bandwidth at the configured `snapshotHz` for 24 and 32
// actors. No actor-payload slimming is assumed; above 32 actors the mode lowers
// the rate instead (the server policy test lives in server/cocs-net.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,MAX_ACTORS} from './core.mjs';
import {snapshotDelta,wireSize} from './protocol.mjs';
import {RULES} from './data.mjs';

function seeded(seed) { let n = seed; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); }
const HZ = 30;
const INTERVAL = 1 / HZ;
const KEYFRAME_EVERY = HZ;

// Step a live match and account the exact frame stream a room would broadcast:
// one full keyframe a second and deltas in between when they save bytes.
function measure(actorCount) {
 const match = new Match('chatgpt', 'openclaw', seeded(1), 'warfront', { mode: 'cocs', humanCount: actorCount, botCount: 0, timeLimit: 900 });
 const steps = 600;
 const stepTimes = [];
 let acc = 0;
 let prev = null;
 let keyframeMax = 0;
 let deltaMax = 0;
 let bytes = 0;
 let frames = 0;
 for (let i = 0; i < steps; i++) {
  const started = performance.now();
  match.step(RULES.dt, { inputs: {} });
  stepTimes.push(performance.now() - started);
  acc += RULES.dt;
  if (acc + 1e-9 < INTERVAL) continue;
  acc = 0;
  frames++;
  const state = match.snapshot();
  const forceKey = KEYFRAME_EVERY > 0 && frames % KEYFRAME_EVERY === 0;
  let frame = null;
  if (prev && !forceKey) {
   const patch = snapshotDelta(prev, state);
   if (patch) {
    const candidate = { type: 'snapshot-delta', seq: frames, base: frames - 1, acks: {}, patch };
    const full = { type: 'snapshot', seq: frames, acks: {}, state };
    if (wireSize(candidate) + 48 < wireSize(full)) frame = candidate;
   }
  }
  if (!frame) frame = { type: 'snapshot', seq: frames, acks: {}, state };
  const size = wireSize(frame);
  if (frame.type === 'snapshot') keyframeMax = Math.max(keyframeMax, size);
  else deltaMax = Math.max(deltaMax, size);
  bytes += size;
  prev = state;
 }
 stepTimes.sort((a, b) => a - b);
 const p95 = stepTimes[Math.min(stepTimes.length - 1, Math.floor(stepTimes.length * 0.95))];
 return { match, p95, keyframeMax, deltaMax, bytesPerSecond: bytes / (steps * RULES.dt), frames };
}

test('24 actors stay inside the §11.5 actor, step, keyframe, delta and bandwidth budget', () => {
 const m = measure(24);
 assert.ok(m.match.actors.length <= MAX_ACTORS, `actors ${m.match.actors.length} <= ${MAX_ACTORS}`);
 assert.ok(m.match.actors.length <= 24, 'the 24-actor rung does not inflate');
 assert.ok(m.p95 <= 8, `step p95 ${m.p95.toFixed(2)}ms <= 8ms`);
 assert.ok(m.keyframeMax <= 78 * 1024, `keyframe ${(m.keyframeMax / 1024).toFixed(1)}KB <= 78KB`);
 assert.ok(m.deltaMax <= 10 * 1024, `delta ${(m.deltaMax / 1024).toFixed(1)}KB <= 10KB`);
 // Per-second client bandwidth at the configured 30 Hz, converted to bits.
 assert.ok(m.bytesPerSecond * 8 <= 3_000_000, `bandwidth ${(m.bytesPerSecond * 8 / 1e6).toFixed(2)}Mbps <= 3Mbps`);
});

test('32 actors stay inside the §11.5 actor, step, keyframe, delta and bandwidth budget', () => {
 const m = measure(32);
 assert.ok(m.match.actors.length <= MAX_ACTORS, `actors ${m.match.actors.length} <= ${MAX_ACTORS}`);
 assert.ok(m.match.actors.length <= 32, 'the 32-actor cap holds');
 assert.ok(m.p95 <= 12, `step p95 ${m.p95.toFixed(2)}ms <= 12ms`);
 assert.ok(m.keyframeMax <= 100 * 1024, `keyframe ${(m.keyframeMax / 1024).toFixed(1)}KB <= 100KB`);
 assert.ok(m.deltaMax <= 13 * 1024, `delta ${(m.deltaMax / 1024).toFixed(1)}KB <= 13KB`);
 assert.ok(m.bytesPerSecond * 8 <= 3_500_000, `bandwidth ${(m.bytesPerSecond * 8 / 1e6).toFixed(2)}Mbps <= 3.5Mbps`);
});

test('Match clamps the combined roster to MAX_ACTORS for every mode', () => {
 const cocs = new Match('chatgpt', 'openclaw', seeded(2), 'warfront', { mode: 'cocs-coop', humanCount: 32, botCount: 16, timeLimit: 900 });
 assert.ok(cocs.actors.length <= MAX_ACTORS, `clamped roster ${cocs.actors.length}`);
 assert.equal(cocs.humanCount, 32);
 const ffa = new Match('chatgpt', 'openclaw', seeded(2), 'crosswire', { mode: 'deathmatch', humanCount: 99, botCount: 99, timeLimit: 60 });
 assert.equal(ffa.humanCount, 8, 'non-COCS modes keep the 8-human envelope');
 assert.ok(ffa.actors.length <= MAX_ACTORS);
});
