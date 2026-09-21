import test from 'node:test';
import assert from 'node:assert/strict';
import {postStage,applyComposerSize,disposeComposer,reducedMotion,QUALITY_LEVELS,normalizeQuality,normalizeQualityOverride,qualitySettings,qualityIndex,nextQualityTier,nextQualityState,nextLabBudget,labBudgetLabel,clampTriangleBudget,frameTriangleBudget,bloomResolution,createFrameWindow,pushFrameTime,framePercentiles} from './post.mjs';

const fakeComposer = () => {
  const calls = [];
  const composer = {
    passes: [],
    ratio: 1,
    target: { w: 0, h: 0 },
    setPixelRatio(ratio) { calls.push(['ratio', ratio]); composer.ratio = ratio; },
    setSize(w, h) { calls.push(['size', w, h]); composer.target = { w: Math.round(w * composer.ratio), h: Math.round(h * composer.ratio) }; },
    dispose() { calls.push(['dispose']); },
  };
  return { composer, calls };
};

test('post-processing is enabled on a hardware renderer unless disabled or reduced', () => {
  assert.equal(postStage({ eligible: true, reduced: false }), true);
  assert.equal(postStage({ eligible: true, reduced: true }), false);
  assert.equal(postStage({ eligible: false, reduced: false }), false);
  assert.equal(postStage({ eligible: true, reduced: false, postFx: false }), false);
  assert.equal(postStage({ eligible: true, reduced: false, bloom: 0 }), true, 'zero bloom no longer disables the composer');
  assert.equal(postStage({ eligible: true, reduced: false, bloom: .5 }), true);
  assert.equal(postStage({ eligible: true, reduced: false, scale: .5, bloom: .5 }), true, 'resolution scale no longer disables glow');
});

test('composer sizing applies the pixel ratio exactly once', () => {
  const { composer } = fakeComposer();
  applyComposerSize(composer, 800, 450, 1.5);
  assert.deepEqual(composer.target, { w: 1200, h: 675 }, 'CSS pixels must be passed, not device pixels');
  applyComposerSize(composer, 800, 450, 1);
  assert.deepEqual(composer.target, { w: 800, h: 450 }, 'a DPR change re-sizes the targets');
  applyComposerSize(composer, 800, 450, 0);
  assert.deepEqual(composer.target, { w: 800, h: 450 }, 'an invalid ratio falls back to 1');
});

test('disposing a composer releases added passes and then the composer', () => {
  let passDisposed = 0, composerDisposed = 0;
  disposeComposer({ passes: [{ dispose: () => { passDisposed++; } }, { dispose: () => { passDisposed++; } }], dispose: () => { composerDisposed++; } });
  assert.equal(passDisposed, 2);
  assert.equal(composerDisposed, 1);
  assert.doesNotThrow(() => disposeComposer(null));
  assert.doesNotThrow(() => disposeComposer({}));
});

test('reduced motion combines the app preference with the OS preference', () => {
  assert.equal(reducedMotion(false, false), false);
  assert.equal(reducedMotion(true, false), true);
  assert.equal(reducedMotion(false, true), true);
  assert.equal(reducedMotion(true, true), true);
});

test('quality tiers normalize from explicit levels, numbers and the renderer', () => {
  assert.deepEqual(QUALITY_LEVELS, ['low', 'medium', 'high']);
  assert.equal(normalizeQuality('high'), 'high');
  assert.equal(normalizeQuality('bogus'), 'high', 'an unknown string falls back to the hardware default');
  assert.equal(normalizeQuality(0), 'low');
  assert.equal(normalizeQuality(1.4), 'medium');
  assert.equal(normalizeQuality(99), 'high', 'numeric tiers clamp to the ends');
  assert.equal(normalizeQuality(undefined, { software: true }), 'low', 'software renders default low');
  assert.equal(normalizeQuality(undefined, { reduced: true }), 'medium', 'reduced motion keeps medium');
  assert.equal(normalizeQuality('low', { software: true }), 'low', 'an explicit tier always wins');
  assert.equal(normalizeQuality('high', { software: true }), 'high');
});

test('quality budgets are frozen, ordered and scale expensive work monotonically', () => {
  const low = qualitySettings('low'), medium = qualitySettings('medium'), high = qualitySettings('high');
  for (const tier of [low, medium, high]) {
    assert.ok(Object.isFrozen(tier));
    assert.ok(tier.tier >= 0 && tier.tier <= 2);
    for (const key of ['particles', 'decals', 'deaths', 'splats', 'shadows', 'shadowMap', 'stars', 'scatter', 'scatterDetail', 'ambientMotes', 'tracers', 'bloom', 'triangleBudget', 'dither', 'sharpen', 'environment']) {
      assert.ok(Number.isFinite(tier[key]), `${key} is finite`);
    }
  }
  assert.ok(low.triangleBudget < medium.triangleBudget && medium.triangleBudget < high.triangleBudget, 'the CPU triangle ceiling grows with tier');
  assert.ok(low.particles < medium.particles && medium.particles < high.particles, 'particle budget grows with tier');
  assert.ok(low.decals <= medium.decals && medium.decals <= high.decals, 'decal slots never shrink as tier rises');
  assert.ok(low.deaths <= medium.deaths && medium.deaths <= high.deaths, 'death slots never shrink as tier rises');
  assert.ok(low.shadowMap <= medium.shadowMap && medium.shadowMap <= high.shadowMap, 'shadow map resolution tracks tier');
  assert.ok(low.scatter <= medium.scatter && medium.scatter <= high.scatter, 'backdrop density tracks tier');
  assert.ok(low.sharpen <= medium.sharpen && medium.sharpen <= high.sharpen, 'sharpness tracks tier');
  assert.ok(low.environment <= medium.environment && medium.environment <= high.environment, 'environment contribution tracks tier');
  assert.ok(low.dither > 0 && medium.dither > 0 && high.dither > 0, 'banding dither stays on at every tier');
  assert.equal(qualitySettings('low'), low, 'the same tier returns the same frozen table');
});

test('the CPU triangle budget clamps invalid values and resolves per tier', () => {
  assert.equal(clampTriangleBudget(0), Infinity, 'a non-positive budget disables the cap');
  assert.equal(clampTriangleBudget(-10), Infinity);
  assert.equal(clampTriangleBudget(NaN), Infinity);
  assert.equal(clampTriangleBudget(Infinity), Infinity);
  assert.equal(clampTriangleBudget(1234.9), 1234, 'a finite budget floors to whole triangles');
  assert.equal(frameTriangleBudget('low', { software: true }), qualitySettings('low').triangleBudget);
  assert.equal(frameTriangleBudget('high'), qualitySettings('high').triangleBudget);
  assert.equal(frameTriangleBudget('bogus'), qualitySettings('high').triangleBudget, 'an unknown tier falls back to the hardware default');
  assert.ok(frameTriangleBudget('low', { software: true }) <= frameTriangleBudget('medium') && frameTriangleBudget('medium') <= frameTriangleBudget('high'));
});

test('the frame-rate controller demotes below minFps and promotes above maxFps with hysteresis', () => {
  assert.equal(nextQualityTier('high', 30), 'medium', 'a slow high tier steps down');
  assert.equal(nextQualityTier('medium', 30), 'low');
  assert.equal(nextQualityTier('low', 30), 'low', 'the lowest tier cannot step further down');
  assert.equal(nextQualityTier('low', 120), 'medium', 'a fast low tier can recover');
  assert.equal(nextQualityTier('medium', 120), 'high');
  assert.equal(nextQualityTier('high', 120), 'high', 'high is the top tier');
  assert.equal(nextQualityTier('medium', 50), 'medium', 'fps inside the hysteresis band is unchanged');
  assert.equal(nextQualityTier('medium', NaN), 'medium', 'non-finite fps is a no-op');
  assert.equal(nextQualityTier(undefined, 30, { software: true }), 'low');
  assert.equal(qualityIndex('high'), 2);
  assert.equal(qualityIndex('low'), 0);
});

test('the saved "auto" quality is never stored as a fixed override', () => {
  assert.equal(normalizeQualityOverride('auto'), null, 'auto means automatic, not a pinned tier');
  assert.equal(normalizeQualityOverride(null), null);
  assert.equal(normalizeQualityOverride(undefined), null);
  assert.equal(normalizeQualityOverride('bogus'), null);
  assert.equal(normalizeQualityOverride('high'), 'high');
  assert.equal(normalizeQualityOverride('low'), 'low');
  assert.equal(normalizeQualityOverride(0), 'low');
  assert.equal(normalizeQualityOverride(2), 'high');
});

test('quality tiers expose real effect-resolution and pass controls, ordered by tier', () => {
  const low = qualitySettings('low'), medium = qualitySettings('medium'), high = qualitySettings('high');
  for (const tier of [low, medium, high]) {
    for (const key of ['bloomScale', 'bloomMax', 'shadowHz', 'modelDetail', 'lodDistance']) assert.ok(Number.isFinite(tier[key]), `${key} is finite`);
    assert.equal(typeof tier.fxaa, 'boolean');
    assert.equal(typeof tier.vignette, 'boolean');
  }
  assert.ok(low.bloomScale < medium.bloomScale && medium.bloomScale < high.bloomScale, 'bloom extraction shrinks on lower tiers');
  assert.ok(low.shadowHz <= medium.shadowHz && medium.shadowHz <= high.shadowHz, 'shadow budget falls with tier');
  assert.ok(low.modelDetail < high.modelDetail, 'geometry detail falls with tier');
});

test('the bloom budget caps extraction independently of the full-resolution image', () => {
  const full = bloomResolution(3840, 2160, { scale: 0.5, maxDim: 1024 });
  assert.ok(full.width <= 1024 && full.height <= 1024, 'a 4K canvas cannot spawn a 2K-wide bloom chain');
  const small = bloomResolution(1280, 720, { scale: 0.5, maxDim: 1024 });
  assert.equal(small.width, 640);
  assert.equal(small.height, 360);
  assert.ok(bloomResolution(0, 0).width >= 1, 'degenerate sizes stay at least one texel');
});

test('the sustained governor demotes slowly, holds a cooldown and promotes gradually', () => {
  let state = { level: 'high', bad: 0, good: 0, cool: 0 };
  for (let i = 0; i < 5; i++) state = nextQualityState(state, 200, { ceiling: 'high' });
  assert.equal(state.level, 'high', '1s of slow frames is not enough');
  for (let i = 0; i < 4 && state.level === 'high'; i++) state = nextQualityState(state, 200, { ceiling: 'high' });
  assert.equal(state.level, 'medium', 'sustained slow frames demote one tier');
  assert.ok(state.cool > 0, 'a cooldown follows a change');
  const during = nextQualityState(state, 200, { ceiling: 'high' });
  assert.equal(during.level, 'medium', 'no change during the cooldown');
  let fast = { level: 'low', bad: 0, good: 0, cool: 0 };
  for (let i = 0; i < 300 && fast.level === 'low'; i++) fast = nextQualityState(fast, 8, { ceiling: 'high' });
  assert.equal(fast.level, 'medium', 'fast frames promote one tier');
  // A software ceiling cannot be raised by fast frames.
  let soft = { level: 'low', bad: 0, good: 0, cool: 0 };
  for (let i = 0; i < 400; i++) soft = nextQualityState(soft, 8, { ceiling: 'low', software: true });
  assert.equal(soft.level, 'low');
});

test('the rolling frame window reports bounded median and p95 percentiles', () => {
  const window = createFrameWindow(10);
  for (let i = 1; i <= 100; i++) pushFrameTime(window, i);
  assert.equal(window.values.length, 10, 'the window is bounded');
  const [median, p95] = framePercentiles(window, [0.5, 0.95]);
  assert.equal(median, 96);
  assert.ok(p95 >= median && p95 <= 100);
  assert.deepEqual(framePercentiles(createFrameWindow(4), [0.5, 0.95]), [0, 0]);
});

test('the lab budget stays full on healthy frames and ignores hitches and bad input', () => {
  let state = { level: 0, slow: 0, fast: 0, cool: 0 };
  for (let i = 0; i < 600; i++) state = nextLabBudget(state, 16);
  assert.equal(state.level, 0, '60 fps never sheds styling');
  assert.equal(labBudgetLabel(state.level), 'full');
  const hitch = nextLabBudget(state, 900);
  assert.equal(hitch.level, 0, 'a single long hitch is not sustained slowness');
  assert.equal(hitch.changed, false);
  const bad = nextLabBudget(state, NaN);
  assert.equal(bad.level, 0, 'a non-finite frame time leaves the level alone');
  assert.equal(nextLabBudget(state, 0).level, 0);
});

test('the lab budget sheds the heavy layers in order and only restores after a long fast window', () => {
  let state = { level: 0, slow: 0, fast: 0, cool: 0 };
  for (let i = 0; i < 120 && state.level === 0; i++) state = nextLabBudget(state, 25);
  assert.equal(state.level, 1, 'sustained slowness drops the weapon and bot stacks first');
  assert.equal(labBudgetLabel(state.level), 'world only');
  assert.ok(state.cool > 0, 'a cooldown follows each step');
  const during = nextLabBudget(state, 25);
  assert.equal(during.level, 1, 'no second step during the cooldown');
  for (let i = 0; i < 300 && state.level === 1; i++) state = nextLabBudget(state, 25);
  assert.equal(state.level, 2, 'continued slowness bypasses the lab entirely');
  assert.equal(labBudgetLabel(state.level), 'off');
  for (let i = 0; i < 300; i++) state = nextLabBudget(state, 25);
  assert.equal(state.level, 2, 'the governor never exceeds the level ceiling');
  // Recovery is deliberately much slower than the demotion.
  let recovering = state;
  for (let i = 0; i < 200 && recovering.level === 2; i++) recovering = nextLabBudget(recovering, 10);
  assert.equal(recovering.level, 2, 'two seconds of fast frames is not enough to restore');
  for (let i = 0; i < 2400 && recovering.level > 0; i++) recovering = nextLabBudget(recovering, 10);
  assert.equal(recovering.level, 0, 'a long, comfortably fast window restores the full look one step at a time');
});

test('the lab budget bands leave a dead zone so a frame time near the threshold cannot oscillate', () => {
  let state = { level: 1, slow: 0, fast: 0, cool: 0 };
  for (let i = 0; i < 600; i++) state = nextLabBudget(state, 16);
  assert.equal(state.level, 1, 'between slowMs and recoverMs the level holds');
});
