// Shared scalar math helpers. Pure and dependency-free so every simulation and
// presentation module can use the exact same clamping and interpolation rules.

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const clamp01 = value => Math.max(0, Math.min(1, value));
export const lerp = (a, b, t) => a + (b - a) * t;
