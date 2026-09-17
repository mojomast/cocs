// Resolution budgeting and dynamic resolution scaling.
//
// The drawing buffer is `min(devicePixelRatio, 1.5) * resolutionScale` CSS
// pixels per axis, so pixel count grows quadratically with the scale slider.
// On 2K/4K displays a "100%" setting asks for 4-9x the pixels of the
// 1080p-class buffer the game is tuned around. These helpers cap the buffer at
// a pixel budget unless the player opts into native, and let the frame-time
// governor trade resolution before dropping quality tiers.
//
// Pure functions only: no DOM, no three.js, no wall clock.

export const RESOLUTION_CAPS = Object.freeze({
  auto: 1920 * 1080,
  '1080p': 1920 * 1080,
  '1440p': 2560 * 1440,
  native: 0,
});

export const RESOLUTION_CAP_IDS = Object.freeze(['auto', '1080p', '1440p', 'native']);
export const DPR_CAP = 1.5;
export const SOFTWARE_BASELINE = 0.85;
export const MIN_DYNAMIC_SCALE = 0.5;

export function capBudget(cap = 'auto') {
  if (typeof cap === 'number') return Number.isFinite(cap) && cap > 0 ? cap : 0;
  return RESOLUTION_CAPS[cap] ?? RESOLUTION_CAPS.auto;
}

// `dynamic` is the frame-time multiplier (0.5..1). It may lower the result but
// never raise it above the requested/budgeted ratio.
export function budgetedRatio({ width = 1, height = 1, dpr = 1, scale = 1, cap = 'auto', software = false, dynamic = 1 } = {}) {
  const baseline = software ? SOFTWARE_BASELINE : Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, DPR_CAP);
  const requested = baseline * Math.max(0.1, Number(scale) || 1);
  const budget = capBudget(cap);
  const capped = budget > 0 ? Math.min(requested, Math.max(0.25, Math.sqrt(budget / Math.max(1, width * height)))) : requested;
  const dyn = Math.min(1, Math.max(MIN_DYNAMIC_SCALE, Number(dynamic) || 1));
  return capped * dyn;
}

// Frame-time governor for resolution. Deterministic and hysteretic. Call once
// per sampling window with the window's average frame time and elapsed time:
// - sustained slow frames (> slowMs) lower the scale by `downStep`;
// - sustained comfortable frames (< fastMs) raise it by `upStep`;
// - neutral frames change nothing; cooldowns prevent oscillation.
export function nextDynamicScale(state = {}, { frameMs = 0, elapsedMs = 0 } = {}, {
  slowMs = 1000 / 48,
  fastMs = 1000 / 55,
  downStep = 0.05,
  upStep = 0.025,
  downCool = 0.75,
  upCool = 2,
  floor = MIN_DYNAMIC_SCALE,
} = {}) {
  const scale = Math.min(1, Math.max(MIN_DYNAMIC_SCALE, Number.isFinite(state?.scale) ? state.scale : 1));
  const cool = Math.max(0, Number.isFinite(state?.cool) ? state.cool : 0);
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs / 1000 : 0;
  const remaining = cool - elapsed;
  if (remaining > 0) return { scale, cool: remaining };
  if (!(Number.isFinite(frameMs) && frameMs > 0)) return { scale, cool: 0 };
  if (frameMs > slowMs && scale > floor) return { scale: Math.max(floor, +(scale - downStep).toFixed(4)), cool: downCool };
  if (frameMs < fastMs && scale < 1) return { scale: Math.min(1, +(scale + upStep).toFixed(4)), cool: upCool };
  return { scale, cool: 0 };
}
