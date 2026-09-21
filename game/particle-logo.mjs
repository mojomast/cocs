// Deterministic point-cloud logo helpers: target sampling from a rasterised
// alpha mask (the title logo drawn to an offscreen canvas) plus the
// presentation-side particle simulation. Pure and DOM-free so the maths is
// testable in Node; the React canvas host owns rasterisation and the renderer.
//
// Coordinates are CSS pixels with the origin at the logo's centre and +y up,
// matching an orthographic camera of the same pixel size.

// Small deterministic PRNG (mulberry32) so a given logo always assembles and
// drifts the same way.
export function logoRandom(seed = 1) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick particle targets out of an RGBA alpha mask (ImageData.data). Scans one
// pixel grid (coarser only for very large masks), then thins the candidates
// evenly down to `max` and jitters inside each cell. Returns centred, +y-up
// pixel positions.
export function sampleMaskTargets(data, width, height, { max = 8000, threshold = 140, seed = 1, rand = null } = {}) {
  const w = Math.max(0, Math.floor(width) || 0), h = Math.max(0, Math.floor(height) || 0);
  const empty = { count: 0, x: new Float32Array(0), y: new Float32Array(0), alpha: new Float32Array(0) };
  if (!data || !w || !h || data.length < w * h * 4) return empty;
  const rng = typeof rand === 'function' ? rand : logoRandom(seed);
  const cap = Math.max(1, Math.floor(max) || 1);
  // One grid, then thin: a huge mask scans every other pixel to keep the
  // candidate list bounded, a normal logo box scans every pixel.
  const stride = w * h > 2_000_000 ? 2 : 1;
  const candidates = [];
  for (let y = 0; y < h; y += stride) for (let x = 0; x < w; x += stride) {
    const alpha = data[(y * w + x) * 4 + 3];
    if (alpha >= threshold) candidates.push(x, y, alpha);
  }
  const found = candidates.length / 3;
  if (!found) return empty;
  const take = Math.min(cap, found);
  const x = new Float32Array(take), y = new Float32Array(take), alpha = new Float32Array(take);
  const halfW = w / 2, halfH = h / 2;
  for (let i = 0; i < take; i++) {
    const src = (take === found ? i : Math.floor(i * found / take)) * 3;
    // Jitter inside the sampled cell so the grid never reads as a lattice.
    x[i] = candidates[src] + (rng() - .5) * stride - halfW;
    y[i] = halfH - (candidates[src + 1] + (rng() - .5) * stride);
    alpha[i] = Math.max(0, Math.min(1, candidates[src + 2] / 255));
  }
  return { count: take, x, y, alpha, stride };
}

// Build the particle state from sampled targets. Each particle starts on a
// scatter ring around the logo and springs home; a bounded share are streamers
// that periodically pour off the logo in the "wake" direction, and a small
// share are ambient dust that drifts through the whole box.
export function createLogoParticles(targets, { width = 800, height = 400, streamRatio = .24, dustRatio = .05, seed = 7, rand = null } = {}) {
  const count = Math.max(0, Math.floor(targets?.count) || 0);
  const w = Math.max(1, Number(width) || 1), h = Math.max(1, Number(height) || 1);
  const rng = typeof rand === 'function' ? rand : logoRandom(seed);
  const px = new Float32Array(count), py = new Float32Array(count), pz = new Float32Array(count);
  const vx = new Float32Array(count), vy = new Float32Array(count), vz = new Float32Array(count);
  const hx = new Float32Array(count), hy = new Float32Array(count), hz = new Float32Array(count);
  const alpha = new Float32Array(count), seedA = new Float32Array(count);
  const stream = new Uint8Array(count), dust = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    hx[i] = targets.x[i] ?? 0;
    hy[i] = targets.y[i] ?? 0;
    hz[i] = (rng() - .5) * 16;
    // Start as a loose haze around the mark (not a far ring) so the title is
    // legible immediately and sharpens as it settles.
    const spreadX = w * (.05 + rng() * .15), spreadY = h * (.05 + rng() * .13);
    px[i] = hx[i] + (rng() * 2 - 1) * spreadX;
    py[i] = hy[i] + (rng() * 2 - 1) * spreadY;
    pz[i] = (rng() - .5) * 180;
    alpha[i] = (targets.alpha?.[i] ?? 1) * (.55 + rng() * .45);
    seedA[i] = rng();
    const roll = rng();
    if (roll < streamRatio) stream[i] = 1;
    else if (roll < streamRatio + dustRatio) dust[i] = 1;
  }
  return { count, width: w, height: h, px, py, pz, vx, vy, vz, hx, hy, hz, alpha, seedA, stream, dust, assembled: 0 };
}

// Advance the simulation by one frame. `pointer` is in the same centred pixel
// space (null when the cursor is away). Reduced motion snaps every particle to
// its home immediately and never moves again.
/**
 * @param {any} state particle state from createLogoParticles
 * @param {number} dt elapsed seconds (clamped to 50 ms)
 * @param {{time?: number, pointer?: {x: number, y: number}|null, pointerRadius?: number, reduced?: boolean, flow?: number}} [opts]
 */
export function stepLogoParticles(state, dt, { time = 0, pointer = null, pointerRadius = 96, reduced = false, flow = 1 } = {}) {
  const s = state;
  if (!s || !s.count) return s;
  const step = Math.max(0, Math.min(.05, Number(dt) || 0));
  const { count, px, py, pz, vx, vy, vz, hx, hy, hz, seedA, stream, dust, width, height } = s;
  if (reduced) {
    for (let i = 0; i < count; i++) { px[i] = hx[i]; py[i] = hy[i]; pz[i] = hz[i]; vx[i] = vy[i] = vz[i] = 0; }
    s.assembled = 1;
    return s;
  }
  const spring = 16, damp = Math.exp(-step * 4.6), maxV = 640;
  const jitter = Math.max(0, Math.min(2, Number(flow) || 0));
  for (let i = 0; i < count; i++) {
    const seed = seedA[i];
    let ax = (hx[i] - px[i]) * spring, ay = (hy[i] - py[i]) * spring, az = (hz[i] - pz[i]) * spring * .45;
    if (dust[i]) {
      // Ambient motes drift across the box and wrap around its edges.
      const spanX = width * 1.25, spanY = height * 1.35;
      px[i] += (10 + seed * 16) * step * flow;
      py[i] += Math.sin(time * (.25 + seed * .4) + seed * 40) * 8 * step * flow;
      if (px[i] > spanX / 2) px[i] = -spanX / 2;
      if (py[i] > spanY / 2) py[i] = -spanY / 2;
      if (py[i] < -spanY / 2) py[i] = spanY / 2;
      vx[i] = vy[i] = vz[i] = 0;
      continue;
    } else if (stream[i]) {
      // Wake: pour off the logo towards the lower-left, fade, then respawn.
      const cycle = 2.6 + seed * 2.6;
      const phase = ((time / cycle) + seed * 1.7) % 1;
      const tx = hx[i] - width * (.34 + .7 * seed) * phase;
      const ty = hy[i] - height * (.08 + .2 * seed) * phase;
      const tz = hz[i] - 70 * phase;
      ax = (tx - px[i]) * spring * .6 + Math.sin(time * (1.1 + seed) + seed * 9) * 9 * flow;
      ay = (ty - py[i]) * spring * .6 + Math.cos(time * (.9 + seed * .7) + seed * 5) * 8 * flow;
      az = (tz - pz[i]) * spring * .5;
    } else {
      const wander = (6 + 13 * seed) * flow;
      ax += Math.sin(time * (.6 + seed * .5) + seed * 40) * wander;
      ay += Math.cos(time * (.5 + seed * .6) + seed * 70) * wander;
    }
    if (pointer) {
      const dx = px[i] - pointer.x, dy = py[i] - pointer.y, radius = pointerRadius;
      const d2 = dx * dx + dy * dy;
      if (d2 < radius * radius && d2 > 1e-4) {
        const d = Math.sqrt(d2), force = (1 - d / radius) * 320;
        ax += (dx / d) * force; ay += (dy / d) * force;
      }
    }
    vx[i] = (vx[i] + ax * step) * damp;
    vy[i] = (vy[i] + ay * step) * damp;
    vz[i] = (vz[i] + az * step) * damp;
    const speed = vx[i] * vx[i] + vy[i] * vy[i];
    if (speed > maxV * maxV) { const f = maxV / Math.sqrt(speed); vx[i] *= f; vy[i] *= f; }
    px[i] += vx[i] * step; py[i] += vy[i] * step; pz[i] += vz[i] * step;
  }
  s.assembled = Math.min(1, s.assembled + step * .8);
  return s;
}

// Per-particle render alpha: dense letters keep their mask weight, streamers
// fade along the wake phase so the tail dissolves instead of ending abruptly.
// The field opens up over the first ~1.3 s (and is frame-rate independent, so a
// slow first frame still shows a legible logo almost immediately).
export function particleAlpha(state, i, time = 0) {
  const s = state;
  if (!s || i < 0 || i >= s.count) return 0;
  const open = Math.min(1, Math.max(s.assembled, (Number(time) || 0) / 1.3));
  const base = s.alpha[i] * (.62 + .38 * open) * (s.dust[i] ? .3 : 1);
  if (s.stream[i]) {
    const seed = s.seedA[i], cycle = 2.6 + seed * 2.6;
    const phase = ((time / cycle) + seed * 1.7) % 1;
    return base * (1 - phase * .82);
  }
  return base;
}
