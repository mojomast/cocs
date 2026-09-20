// Renderer post-processing helpers, kept three.js-free so sizing, disposal and
// the reduced-motion policy can be verified without a WebGL context.

export function reducedMotion(appPreference, osPreference) {
  return appPreference === true || osPreference === true;
}

// Presentation-only quality tiers. The simulation never reads these; they only
// scale particle budgets, decal/death slots, shadow cadence, ambient motes and
// backdrop density. A frame-rate controller may step a tier down but never
// above the configured ceiling, so a slow machine degrades gracefully.
export const QUALITY_LEVELS = Object.freeze(['low', 'medium', 'high']);

// Explicit tier wins; otherwise a software renderer drops to low, reduced motion
// keeps medium, and a hardware renderer defaults to high.
export function normalizeQuality(value, { software = false, reduced = false } = {}) {
  if (typeof value === 'string' && QUALITY_LEVELS.includes(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const index = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, Math.round(value)));
    return QUALITY_LEVELS[index];
  }
  if (software === true) return 'low';
  return reduced === true ? 'medium' : 'high';
}

// `triangleBudget` is the hard per-frame ceiling the CPU SoftwareRenderer
// rasterizes. It is the last line of defence: even a pathological scene (a
// dozen actors, debris, weather and a full scatter field) can never make the
// software path spend unbounded raster work. WebGL ignores it because the GPU
// clips and culls cheaply, but the value still scales monotonically so a
// hardware tier can lower its own scatter budget from the same table.
//
// The table also carries the controls that actually change GPU work at a fixed
// resolution: `bloomScale`/`bloomMax` budget the bloom mip extraction
// independently of the world, `bloom` is a strength multiplier, `fxaa` and
// `vignette` enable/disable whole full-screen passes, `shadowHz` is the
// elapsed-time dynamic-shadow refresh rate (20-30 Hz), `shadowMap` resizes the
// shadow target, and `modelDetail`/`lodDistance` drive geometry LOD. `shadows`
// is retained as the legacy frame cadence for callers that still read it.
// `finish` is the display-space tail of the chain: `dither` is a static
// 1/255 triangular dither that breaks 8-bit gradient banding (nearly free, so
// every tier keeps it) and `sharpen` is a small contrast-adaptive unsharp that
// recovers what FXAA softens (kept off the low tier). `environment` scales the
// PMREM ambient/reflection contribution, which is what makes metal read as
// metal; it is the cheapest material-quality lever the renderer has.
const QUALITY_TABLE = Object.freeze({
  low: Object.freeze({ tier: 0, particles: .4, decals: 8, deaths: 36, splats: 10, shadows: 4, shadowHz: 20, shadowMap: 1024, stars: .45, scatter: .5, scatterDetail: .35, ambientMotes: 3, tracers: .72, bloom: .6, bloomScale: .25, bloomMax: 256, fxaa: false, vignette: false, dither: 1, sharpen: 0, environment: .4, modelDetail: 0, lodDistance: 26, triangleBudget: 90000 }),
  medium: Object.freeze({ tier: 1, particles: .7, decals: 14, deaths: 56, splats: 14, shadows: 3, shadowHz: 25, shadowMap: 1536, stars: .8, scatter: .78, scatterDetail: .7, ambientMotes: 5, tracers: .86, bloom: .85, bloomScale: .4, bloomMax: 512, fxaa: true, vignette: true, dither: 1, sharpen: .28, environment: .5, modelDetail: .6, lodDistance: 34, triangleBudget: 140000 }),
  high: Object.freeze({ tier: 2, particles: 1, decals: 18, deaths: 72, splats: 16, shadows: 2, shadowHz: 30, shadowMap: 2048, stars: 1, scatter: 1, scatterDetail: 1, ambientMotes: 6, tracers: 1, bloom: 1, bloomScale: .5, bloomMax: 1024, fxaa: true, vignette: true, dither: 1, sharpen: .34, environment: .6, modelDetail: 1, lodDistance: 46, triangleBudget: 200000 }),
});

// Only the three fixed tiers are a real override. The saved default is the
// string "auto", which must stay automatic: storing it as an override made the
// frame-rate governor bail out (`_qualityOverride != null`) while
// `normalizeQuality("auto")` silently fell back to High. Anything that is not a
// fixed tier (including "auto", null, undefined and junk) normalizes to null.
export function normalizeQualityOverride(value) {
  if (typeof value === 'string' && QUALITY_LEVELS.includes(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const index = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, Math.round(value)));
    return QUALITY_LEVELS[index];
  }
  return null;
}

// Bloom extraction resolution budget, independent of the world and final image.
// The built-in bloom already builds a half-resolution mip chain; this caps the
// *base* extraction size so a 4K canvas cannot spawn a 2K-wide bloom chain.
export function bloomResolution(width, height, { scale = 0.5, maxDim = 1024 } = {}) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const ratio = Math.min(Math.max(Number(scale) || 0.5, 0.05), 1);
  const cap = Math.max(8, Number(maxDim) || 1024);
  const largest = Math.max(w, h) * ratio;
  const clamp = largest > cap ? cap / largest : 1;
  return { width: Math.max(1, Math.round(w * ratio * clamp)), height: Math.max(1, Math.round(h * ratio * clamp)) };
}

// Sustained-threshold quality governor. Unlike the single-sample
// `nextQualityTier`, this requires the frame time to stay past a threshold for
// `sustain` seconds before switching, then holds a `cooldown` before the next
// change, so quality cannot oscillate once per second. It never rises above the
// configured ceiling and never leaves the fixed tier table.
export function nextQualityState(state, frameMs, { ceiling = 'high', minFps = 45, maxFps = 58, sustain = 1.5, cooldown = 4, software = false } = {}) {
  const levels = QUALITY_LEVELS;
  const level = levels.includes(state?.level) ? state.level : (levels.includes(state?.tier) ? state.tier : ceiling);
  const ceilingIndex = Math.max(0, levels.indexOf(normalizeQuality(ceiling, { software })));
  const index = Math.max(0, levels.indexOf(level));
  let bad = Number.isFinite(state?.bad) ? state.bad : 0;
  let good = Number.isFinite(state?.good) ? state.good : 0;
  let cool = Number.isFinite(state?.cool) ? Math.max(0, state.cool) : 0;
  const dt = Number.isFinite(frameMs) && frameMs > 0 ? frameMs / 1000 : 0;
  if (cool > 0) return { level, bad: 0, good: 0, cool: Math.max(0, cool - dt), changed: false, frameMs };
  if (dt <= 0) return { level, bad, good, cool, changed: false, frameMs };
  const maxFrame = 1000 / Math.max(1, minFps);
  const minFrame = 1000 / Math.max(1, maxFps);
  if (frameMs > maxFrame) { bad += dt; good = 0; } else if (frameMs < minFrame) { good += dt; bad = 0; } else { bad = 0; good = 0; }
  let next = level, changed = false;
  if (bad >= sustain && index > 0) { next = levels[index - 1]; changed = true; }
  else if (good >= sustain && index < ceilingIndex) { next = levels[index + 1]; changed = true; }
  if (changed) return { level: next, bad: 0, good: 0, cool: cooldown, changed: true, frameMs };
  return { level, bad, good, cool, changed: false, frameMs };
}

// Rolling frame-time window with median and p95, used for the debug snapshot.
// Bounded so the array never grows without limit.
export function createFrameWindow(capacity = 120) {
  const size = Math.max(4, Math.floor(capacity) || 120);
  return { size, values: [] };
}
export function pushFrameTime(window, frameMs) {
  if (!window || !Number.isFinite(frameMs) || frameMs <= 0) return window;
  window.values.push(frameMs);
  if (window.values.length > window.size) window.values.splice(0, window.values.length - window.size);
  return window;
}
export function framePercentiles(window, percentiles = [0.5, 0.95]) {
  const values = window?.values ? [...window.values] : [];
  if (!values.length) return percentiles.map(() => 0);
  values.sort((a, b) => a - b);
  const pick = p => values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * p)))];
  return percentiles.map(pick);
}

// Normalize an arbitrary budget into a finite, positive triangle ceiling.
// Non-finite or non-positive values disable the cap (Infinity) so a caller can
// explicitly opt out, matching SoftwareRenderer.setTriangleBudget.
export function clampTriangleBudget(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : Infinity;
}

// Pick the CPU triangle ceiling for a tier. A software renderer can only ever
// run the low tier, but an explicit override may raise it, so the value is
// always the tier's own budget rather than a hard-coded software constant.
export function frameTriangleBudget(level, options) {
  return clampTriangleBudget(qualitySettings(level, options).triangleBudget);
}

export function qualitySettings(level, options) {
  return QUALITY_TABLE[normalizeQuality(level, options)];
}

export function qualityIndex(level, options) {
  return QUALITY_LEVELS.indexOf(normalizeQuality(level, options));
}

// Pure hysteresis controller: demote below minFps, promote above maxFps. The
// caller clamps promotion to its configured ceiling. Non-finite FPS is a no-op.
export function nextQualityTier(current, fps, { minFps = 45, maxFps = 58, software = false } = {}) {
  const index = qualityIndex(current, { software });
  const tier = QUALITY_LEVELS[Math.max(0, index)] ?? 'high';
  if (!(Number.isFinite(fps) && fps > 0)) return tier;
  if (fps < minFps && index > 0) return QUALITY_LEVELS[index - 1];
  if (fps > maxFps && index < QUALITY_LEVELS.length - 1) return QUALITY_LEVELS[index + 1];
  return tier;
}

// Post-processing runs on a hardware renderer whenever the player keeps it on.
// Composer eligibility is independent of bloom strength (a zero-strength bloom
// pass still leaves antialiasing and the vignette running) and of resolution
// scale, so those controls never silently disable unrelated processing.
export function postStage({ eligible = false, reduced = false, postFx = true } = {}) {
  return eligible === true && reduced !== true && postFx !== false;
}

// EffectComposer already multiplies the size it is given by its own pixel
// ratio, so callers must pass CSS dimensions and set the ratio separately.
// Passing device pixels here would apply the ratio twice.
export function applyComposerSize(composer, width, height, pixelRatio) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  composer?.setPixelRatio?.(ratio);
  composer?.setSize?.(w, h);
  return { width: w, height: h, pixelRatio: ratio };
}

// EffectComposer.dispose() releases its own targets and copy pass but not the
// passes added on top (bloom, vignette, output), so dispose those explicitly.
export function disposeComposer(composer) {
  if (!composer) return;
  const passes = Array.isArray(composer.passes) ? composer.passes : [];
  for (const pass of passes) { try { pass?.dispose?.(); } catch {} }
  try { composer.dispose?.(); } catch {}
}
