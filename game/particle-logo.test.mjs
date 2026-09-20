import test from 'node:test';
import assert from 'node:assert/strict';
import {logoRandom,sampleMaskTargets,createLogoParticles,stepLogoParticles,particleAlpha} from './particle-logo.mjs';

function mask(width, height, rects = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = 255;
    }
  }
  return data;
}

test('mask sampling stays inside the glyphs and respects the particle cap', () => {
  const width = 40, height = 20;
  const data = mask(width, height, [[8, 4, 24, 15]]);
  const full = sampleMaskTargets(data, width, height, {max: 4000, strideStart: 1, strideMax: 2});
  assert.ok(full.count > 40, `a filled block samples plenty of points (${full.count})`);
  for (let i = 0; i < full.count; i++) {
    assert.ok(full.x[i] >= 8 - width / 2 - 2 && full.x[i] <= 24 - width / 2 + 2, `x stays inside the rect (${full.x[i]})`);
    assert.ok(full.y[i] >= height / 2 - 15 - 2 && full.y[i] <= height / 2 - 4 + 2, `y stays inside the rect (${full.y[i]})`);
    assert.ok(full.alpha[i] > 0 && full.alpha[i] <= 1);
  }
  const capped = sampleMaskTargets(data, width, height, {max: 25});
  assert.ok(capped.count <= 25, `the cap bounds the cloud (${capped.count})`);
  assert.equal(sampleMaskTargets(new Uint8ClampedArray(width * height * 4), width, height, {max: 10}).count, 0, 'an empty mask has no targets');
  assert.equal(sampleMaskTargets(null, width, height).count, 0, 'a missing mask is safe');
});

test('mask sampling is deterministic for a given seed', () => {
  const data = mask(30, 16, [[4, 3, 18, 12]]);
  const a = sampleMaskTargets(data, 30, 16, {max: 120, seed: 5});
  const b = sampleMaskTargets(data, 30, 16, {max: 120, seed: 5});
  assert.deepEqual([...a.x], [...b.x]);
  assert.deepEqual([...a.y], [...b.y]);
  assert.notDeepEqual([...a.x], [...sampleMaskTargets(data, 30, 16, {max: 120, seed: 6}).x], 'a different seed moves the jitter');
});

test('particles start scattered, spring home and stream a bounded share', () => {
  const targets = {count: 300, x: new Float32Array(300), y: new Float32Array(300), alpha: new Float32Array(300).fill(1)};
  for (let i = 0; i < 300; i++) { targets.x[i] = (i % 20) - 10; targets.y[i] = Math.floor(i / 20) - 7; }
  const state = createLogoParticles(targets, {width: 400, height: 200, seed: 11});
  assert.equal(state.count, 300);
  let scattered = 0, furthest = 0, streams = 0;
  for (let i = 0; i < 300; i++) {
    const distance = Math.hypot(state.px[i] - state.hx[i], state.py[i] - state.hy[i]);
    if (distance > 12) scattered++;
    if (distance > furthest) furthest = distance;
    if (state.stream[i]) streams++;
  }
  assert.ok(scattered > 150, `most particles start as a loose haze (${scattered})`);
  assert.ok(furthest < 150, `the haze stays close to the mark instead of a far ring (${furthest.toFixed(0)})`);
  assert.ok(streams > 40 && streams < 120, `the wake keeps a bounded share (${streams})`);
  const before = avgDistance(state);
  for (let f = 0; f < 360; f++) stepLogoParticles(state, 1 / 60, {time: f / 60});
  const letterAvg = avgDistance(state, i => !state.stream[i] && !state.dust[i]);
  assert.ok(letterAvg < 14, `the letter particles settle on their targets (${letterAvg.toFixed(1)})`);
  const wake = avgDistance(state, i => state.stream[i] === 1);
  assert.ok(wake > before * .35, `the wake streams away from the mark (${wake.toFixed(1)})`);
  assert.ok(state.assembled > .9, 'the assembly flag fills in');
  for (let i = 0; i < 300; i++) assert.ok(Number.isFinite(state.px[i]) && Number.isFinite(state.py[i]) && Number.isFinite(state.pz[i]), 'no NaN');
});

test('a pointer shoves particles away and reduced motion pins them home', () => {
  const targets = {count: 120, x: new Float32Array(120), y: new Float32Array(120), alpha: new Float32Array(120).fill(1)};
  const state = createLogoParticles(targets, {width: 300, height: 160, seed: 3});
  for (let f = 0; f < 240; f++) stepLogoParticles(state, 1 / 60, {time: f / 60});
  const settled = avgDistance(state);
  for (let f = 0; f < 12; f++) stepLogoParticles(state, 1 / 60, {time: 4 + f / 60, pointer: {x: 0, y: 0}, pointerRadius: 500});
  const pushed = avgDistance(state);
  assert.ok(pushed > settled, `the pointer pushes the cloud out (${settled.toFixed(2)} -> ${pushed.toFixed(2)})`);
  stepLogoParticles(state, 1 / 60, {time: 5, reduced: true});
  for (let i = 0; i < 120; i++) {
    assert.equal(state.px[i], state.hx[i]);
    assert.equal(state.py[i], state.hy[i]);
    assert.equal(state.pz[i], state.hz[i]);
  }
  assert.equal(state.assembled, 1);
});

test('the simulation is deterministic and the wake alpha dissolves', () => {
  const targets = {count: 90, x: new Float32Array(90), y: new Float32Array(90), alpha: new Float32Array(90).fill(1)};
  const a = createLogoParticles(targets, {width: 200, height: 100, seed: 9});
  const b = createLogoParticles(targets, {width: 200, height: 100, seed: 9});
  for (let f = 0; f < 90; f++) { stepLogoParticles(a, 1 / 60, {time: f / 60}); stepLogoParticles(b, 1 / 60, {time: f / 60}); }
  assert.deepEqual([...a.px], [...b.px]);
  assert.deepEqual([...a.py], [...b.py]);
  const streamer = a.stream.findIndex(Boolean), steady = a.stream.findIndex(v => !v);
  assert.ok(streamer >= 0 && steady >= 0);
  const alphas = [];
  for (let f = 0; f < 60; f++) { stepLogoParticles(a, 1 / 60, {time: f * .2}); alphas.push(particleAlpha(a, streamer, f * .2)); }
  assert.ok(Math.max(...alphas) > Math.min(...alphas), 'the wake fades along its cycle');
  assert.ok(particleAlpha(a, steady, 1) > particleAlpha(a, streamer, 0) * 0, 'steady particles keep a positive alpha');
  assert.equal(particleAlpha(a, -1), 0);
  assert.equal(particleAlpha(a, 999), 0);
});

test('the logo PRNG is stable and bounded', () => {
  const a = logoRandom(42), b = logoRandom(42), c = logoRandom(43);
  const seqA = Array.from({length: 5}, () => a());
  assert.deepEqual(seqA, Array.from({length: 5}, () => b()));
  assert.notDeepEqual(seqA, Array.from({length: 5}, () => c()));
  for (const value of seqA) assert.ok(value >= 0 && value < 1);
});

function avgDistance(state, filter = null) {
  let total = 0, n = 0;
  for (let i = 0; i < state.count; i++) {
    if (filter && !filter(i)) continue;
    total += Math.hypot(state.px[i] - state.hx[i], state.py[i] - state.hy[i]);
    n++;
  }
  return total / Math.max(1, n);
}
