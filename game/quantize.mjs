// Network payload trimming: round every finite number in a snapshot/event tree to
// a fixed decimal precision. Positions and angles to the millimetre are visually
// indistinguishable but stringify several bytes smaller, which matters at the
// 30 Hz snapshot rate. Non-finite numbers (Infinity ammo, NaN) and non-number
// values are left untouched. Mutates and returns the given tree, which the server
// builds fresh for every send, so no shared state is affected.
export function quantizeNumbers(value, precision = 3) {
 const factor = 10 ** precision;
 const round = n => Math.round(n * factor) / factor;
 const walk = node => {
  if (Array.isArray(node)) {
   for (let i = 0; i < node.length; i++) {
    const v = node[i];
    if (typeof v === 'number') { if (Number.isFinite(v)) node[i] = round(v); }
    else if (v && typeof v === 'object') walk(v);
   }
  } else if (node && typeof node === 'object') {
   for (const key of Object.keys(node)) {
    const v = node[key];
    if (typeof v === 'number') { if (Number.isFinite(v)) node[key] = round(v); }
    else if (v && typeof v === 'object') walk(v);
   }
  }
  return node;
 };
 return walk(value);
}

// Non-mutating variant for callers that must keep the source tree intact (the
// client's authoritative snapshot buffer, demo keyframes). Same rounding rules
// as quantizeNumbers, including leaving Infinity/NaN sentinels untouched.
export function quantizeClone(value, precision = 3) {
 const factor = 10 ** precision;
 const round = n => Math.round(n * factor) / factor;
 const walk = node => {
  if (Array.isArray(node)) return node.map(item => typeof item === 'number' ? (Number.isFinite(item) ? round(item) : item) : item && typeof item === 'object' ? walk(item) : item);
  if (node && typeof node === 'object') {
   const out = {};
   for (const key of Object.keys(node)) {
    const v = node[key];
    out[key] = typeof v === 'number' ? (Number.isFinite(v) ? round(v) : v) : v && typeof v === 'object' ? walk(v) : v;
   }
   return out;
  }
  return node;
 };
 return walk(value);
}

// JSON byte length of a value as it would cross the wire.
export function wireBytes(value) {
 try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch { return 0; }
}

// Quantization saving report: how many bytes rounding removed, and the ratio.
// Useful for the bandwidth HUD and for asserting the codec actually helps.
export function quantizeSaving(value, precision = 3) {
 const raw = wireBytes(value);
 const quantized = wireBytes(quantizeClone(value, precision));
 return { raw, quantized, saved: Math.max(0, raw - quantized), ratio: raw > 0 ? (raw - quantized) / raw : 0 };
}
