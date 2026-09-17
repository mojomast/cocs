import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetedRatio, capBudget, nextDynamicScale, DPR_CAP, MIN_DYNAMIC_SCALE, RESOLUTION_CAP_IDS} from './resolution.mjs';
import {normalizeDisplay, DEFAULT_DISPLAY} from './config.mjs';

const pixels = (w, h, ratio) => w * h * ratio * ratio;

test('resolution caps map to pixel budgets', () => {
  assert.equal(capBudget('auto'), 1920 * 1080);
  assert.equal(capBudget('1080p'), 1920 * 1080);
  assert.equal(capBudget('1440p'), 2560 * 1440);
  assert.equal(capBudget('native'), 0);
  assert.equal(capBudget('bogus'), 1920 * 1080, 'unknown caps fall back to auto');
  assert.deepEqual([...RESOLUTION_CAP_IDS], ['auto', '1080p', '1440p', 'native']);
});

test('a 4K buffer is clamped to the auto budget at 100% scale', () => {
  const ratio = budgetedRatio({width: 3840, height: 2160, dpr: 1, scale: 1, cap: 'auto'});
  assert.ok(Math.abs(ratio - 0.5) < 1e-9, `expected ~0.5, got ${ratio}`);
  assert.ok(pixels(3840, 2160, ratio) <= 1920 * 1080 + 1);
});

test('a 2K buffer is clamped to ~75% at 100% scale', () => {
  const ratio = budgetedRatio({width: 2560, height: 1440, dpr: 1, scale: 1, cap: 'auto'});
  assert.ok(Math.abs(ratio - Math.sqrt((1920 * 1080) / (2560 * 1440))) < 1e-9);
  assert.ok(pixels(2560, 1440, ratio) <= 1920 * 1080 + 1);
});

test('1080p and smaller keep their requested ratio under auto', () => {
  assert.equal(budgetedRatio({width: 1920, height: 1080, dpr: 1, scale: 1, cap: 'auto'}), 1);
  assert.equal(budgetedRatio({width: 1280, height: 720, dpr: 1, scale: 1.5, cap: 'auto'}), 1.5, 'requested ratio is kept when it fits the budget');
});

test('native opt-in removes the clamp but keeps the DPR cap', () => {
  assert.equal(budgetedRatio({width: 3840, height: 2160, dpr: 1, scale: 1, cap: 'native'}), 1);
  assert.equal(budgetedRatio({width: 3840, height: 2160, dpr: 3, scale: 1, cap: 'native'}), DPR_CAP, 'device pixel ratio stays capped at 1.5');
  assert.equal(budgetedRatio({width: 3840, height: 2160, dpr: 2, scale: 0.5, cap: 'native'}), DPR_CAP * 0.5);
});

test('the budget applies after DPR and scale multiply', () => {
  const ratio = budgetedRatio({width: 3840, height: 2160, dpr: 2, scale: 0.5, cap: 'auto'});
  assert.ok(Math.abs(ratio - 0.5) < 1e-9, 'requested 1.5*0.5=0.75 is clamped to 0.5');
  const software = budgetedRatio({width: 1920, height: 1080, dpr: 1, scale: 1, cap: 'auto', software: true});
  assert.ok(Math.abs(software - 0.85) < 1e-9, 'the software renderer keeps its own baseline');
});

test('the dynamic multiplier may lower the ratio but never raise it', () => {
  const base = {width: 1920, height: 1080, dpr: 1, scale: 1, cap: 'auto'};
  assert.equal(budgetedRatio({...base, dynamic: 0.5}), 0.5);
  assert.equal(budgetedRatio({...base, dynamic: 2}), 1, 'a dynamic value above 1 cannot supersample');
  assert.equal(budgetedRatio({...base, dynamic: MIN_DYNAMIC_SCALE}), MIN_DYNAMIC_SCALE);
});

test('dynamic resolution lowers on slow frames and rises on comfortable ones', () => {
  const slow = nextDynamicScale({scale: 1, cool: 0}, {frameMs: 30, elapsedMs: 500});
  assert.equal(slow.scale, 0.95);
  assert.equal(slow.cool, 0.75);
  const blocked = nextDynamicScale({scale: slow.scale, cool: slow.cool}, {frameMs: 30, elapsedMs: 500});
  assert.equal(blocked.scale, slow.scale, 'cooldown blocks a second change');
  const ready = nextDynamicScale({scale: blocked.scale, cool: blocked.cool}, {frameMs: 30, elapsedMs: 500});
  assert.equal(ready.scale, 0.9, 'after the cooldown elapses the next step lands');
  const fast = nextDynamicScale({scale: 0.8, cool: 0}, {frameMs: 8, elapsedMs: 500});
  assert.equal(fast.scale, 0.825);
  assert.equal(nextDynamicScale({scale: 1, cool: 0}, {frameMs: 8, elapsedMs: 500}).scale, 1, 'never exceeds 1');
});

test('dynamic resolution floors at half and ignores neutral or invalid samples', () => {
  let state = {scale: 1, cool: 0};
  for (let i = 0; i < 40; i++) state = nextDynamicScale(state, {frameMs: 40, elapsedMs: 800});
  assert.equal(state.scale, MIN_DYNAMIC_SCALE);
  const neutral = nextDynamicScale({scale: 0.7, cool: 0}, {frameMs: 1000 / 50, elapsedMs: 500});
  assert.equal(neutral.scale, 0.7);
  assert.equal(neutral.cool, 0);
  assert.deepEqual(nextDynamicScale({scale: 0.7, cool: 0}, {frameMs: NaN, elapsedMs: 500}), {scale: 0.7, cool: 0});
});

test('dynamic resolution is deterministic across identical runs', () => {
  const run = () => {
    let state = {scale: 1, cool: 0};
    const out = [];
    for (let i = 0; i < 12; i++) state = nextDynamicScale(state, {frameMs: i % 3 === 0 ? 30 : 10, elapsedMs: 500});
    out.push(state);
    return out;
  };
  assert.deepEqual(run(), run());
});

test('display defaults and normalisation include the resolution cap', () => {
  assert.equal(DEFAULT_DISPLAY.resolutionCap, 'auto');
  assert.equal(normalizeDisplay({}).resolutionCap, 'auto');
  assert.equal(normalizeDisplay({resolutionCap: '1440p'}).resolutionCap, '1440p');
  assert.equal(normalizeDisplay({resolutionCap: 'native'}).resolutionCap, 'native');
  assert.equal(normalizeDisplay({resolutionCap: 'bogus'}).resolutionCap, 'auto');
  assert.equal(normalizeDisplay({resolutionCap: 42}).resolutionCap, 'auto');
});
