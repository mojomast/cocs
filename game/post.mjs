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

const QUALITY_TABLE = Object.freeze({
  low: Object.freeze({ tier: 0, particles: .4, decals: 8, deaths: 36, splats: 10, shadows: 4, shadowMap: 1024, stars: .45, scatter: .5, scatterDetail: .35, ambientMotes: 3, tracers: .72, bloom: .6 }),
  medium: Object.freeze({ tier: 1, particles: .7, decals: 14, deaths: 56, splats: 14, shadows: 3, shadowMap: 1536, stars: .8, scatter: .78, scatterDetail: .7, ambientMotes: 5, tracers: .86, bloom: .85 }),
  high: Object.freeze({ tier: 2, particles: 1, decals: 18, deaths: 72, splats: 16, shadows: 2, shadowMap: 2048, stars: 1, scatter: 1, scatterDetail: 1, ambientMotes: 6, tracers: 1, bloom: 1 }),
});

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

// Post-processing runs on a hardware renderer whenever the player keeps it on
// and asks for some glow. Resolution scale no longer switches it off, so glow is
// independent of the render scale.
export function postStage({ eligible = false, reduced = false, postFx = true, bloom = .34 } = {}) {
  return eligible === true && reduced !== true && postFx !== false && (Number(bloom) || 0) > 0;
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
