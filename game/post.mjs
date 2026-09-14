// Renderer post-processing helpers, kept three.js-free so sizing, disposal and
// the reduced-motion policy can be verified without a WebGL context.

export function reducedMotion(appPreference, osPreference) {
  return appPreference === true || osPreference === true;
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
