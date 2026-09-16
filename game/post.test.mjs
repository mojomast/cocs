import test from 'node:test';
import assert from 'node:assert/strict';
import {postStage,applyComposerSize,disposeComposer,reducedMotion,QUALITY_LEVELS,normalizeQuality,qualitySettings,qualityIndex,nextQualityTier,clampTriangleBudget,frameTriangleBudget} from './post.mjs';

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
    for (const key of ['particles', 'decals', 'deaths', 'splats', 'shadows', 'shadowMap', 'stars', 'scatter', 'scatterDetail', 'ambientMotes', 'tracers', 'bloom', 'triangleBudget']) {
      assert.ok(Number.isFinite(tier[key]), `${key} is finite`);
    }
  }
  assert.ok(low.triangleBudget < medium.triangleBudget && medium.triangleBudget < high.triangleBudget, 'the CPU triangle ceiling grows with tier');
  assert.ok(low.particles < medium.particles && medium.particles < high.particles, 'particle budget grows with tier');
  assert.ok(low.decals <= medium.decals && medium.decals <= high.decals, 'decal slots never shrink as tier rises');
  assert.ok(low.deaths <= medium.deaths && medium.deaths <= high.deaths, 'death slots never shrink as tier rises');
  assert.ok(low.shadowMap <= medium.shadowMap && medium.shadowMap <= high.shadowMap, 'shadow map resolution tracks tier');
  assert.ok(low.scatter <= medium.scatter && medium.scatter <= high.scatter, 'backdrop density tracks tier');
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
