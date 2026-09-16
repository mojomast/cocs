// Presentation interpolation between fixed simulation ticks.
//
// The simulation steps on a fixed 60 Hz clock; rendering may present at 60, 120
// or 144 Hz. These helpers blend the previous presented transform toward the
// current authoritative one by the fixed-step accumulator fraction so motion is
// smooth without ever touching simulation state. They are pure so the schedule
// coverage (60/120/144) can be verified against one simulation.
//
// Snapping is required whenever the two samples are not a continuous motion:
// respawns, teleports, map/lifecycle resets and large correction jumps. A snap
// simply returns the current sample unchanged.

export function lerp(a, b, t) { return a + (b - a) * t; }

// Shortest-path angle interpolation, so a yaw crossing ±π does not spin the long
// way around.
export function lerpAngle(a, b, t) {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

export function clamp01(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

// True when the two samples must not be interpolated (a discontinuity).
export function shouldSnap(previous, current, { maxDistance = 3, respawn = false } = {}) {
  if (!previous || !current) return true;
  if (respawn === true) return true;
  const dx = Number(current.x ?? 0) - Number(previous.x ?? 0);
  const dz = Number(current.z ?? 0) - Number(previous.z ?? 0);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return true;
  const dy = Number(current.y ?? 0) - Number(previous.y ?? 0);
  return Math.hypot(dx, dy, dz) > maxDistance;
}

// Blend a previous presented transform toward the current authoritative one.
// Returns the current sample verbatim when snapping, so callers can apply the
// result unconditionally.
export function interpolatePose(previous, current, alpha, options = {}) {
  const cur = current || {};
  if (shouldSnap(previous, cur, options)) return { x: cur.x ?? 0, y: cur.y ?? 0, z: cur.z ?? 0, yaw: cur.yaw ?? 0, snapped: true };
  const t = clamp01(alpha);
  return {
    x: lerp(Number(previous.x ?? 0), Number(cur.x ?? 0), t),
    y: lerp(Number(previous.y ?? 0), Number(cur.y ?? 0), t),
    z: lerp(Number(previous.z ?? 0), Number(cur.z ?? 0), t),
    yaw: lerpAngle(Number(previous.yaw ?? 0), Number(cur.yaw ?? 0), t),
    snapped: false,
  };
}

export const INTERPOLATION_EXPORTS = Object.freeze(['lerp', 'lerpAngle', 'clamp01', 'shouldSnap', 'interpolatePose']);
