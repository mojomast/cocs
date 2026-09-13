import test from 'node:test';
import assert from 'node:assert/strict';
import {clamp, clamp01, lerp} from './math.mjs';

test('clamp keeps values inside the range and pins the boundaries', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
  assert.equal(clamp(-2, -1, 1), -1);
  assert.equal(clamp(2, -1, 1), 1);
});

test('clamp follows Math.max(min, Math.min(max, value)) for inverted ranges', () => {
  assert.equal(clamp(5, 10, 0), 10);
  assert.equal(clamp(15, 10, 0), 10);
  assert.equal(clamp(-5, 10, 0), 10);
});

test('clamp propagates NaN', () => {
  assert.ok(Number.isNaN(clamp(NaN, 0, 1)));
  assert.ok(Number.isNaN(clamp(5, NaN, 1)));
  assert.ok(Number.isNaN(clamp(5, 0, NaN)));
});

test('clamp01 pins values to the unit interval', () => {
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(0), 0);
  assert.equal(clamp01(1), 1);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
});

test('clamp01 propagates NaN', () => {
  assert.ok(Number.isNaN(clamp01(NaN)));
});

test('lerp interpolates and extrapolates linearly', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(10, 0, 0.25), 7.5);
  assert.equal(lerp(-4, 4, 0.5), 0);
});

test('lerp does not clamp t', () => {
  assert.equal(lerp(0, 10, 2), 20);
  assert.equal(lerp(0, 10, -1), -10);
});

test('lerp propagates NaN', () => {
  assert.ok(Number.isNaN(lerp(NaN, 10, 0.5)));
  assert.ok(Number.isNaN(lerp(0, NaN, 0.5)));
  assert.ok(Number.isNaN(lerp(0, 10, NaN)));
});
