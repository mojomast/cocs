// Shared, three.js-free rules for next-gen structure geometry so the level
// generator (collision) and the renderer (smooth geometry) agree on where a
// cavern's entrances are and how tall its shell is.

export const CAVERN_SEGMENTS = 16;

// Two opposite entrances: the first two of every eight wall segments are open.
export const cavernOpening = i => i % 8 < 2;

// Angular arcs for the solid wall ring between the entrances, in radians.
export function cavernArcs(segments = CAVERN_SEGMENTS) {
  const span = (Math.PI * 2) / segments;
  const arcs = [];
  let start = null;
  for (let i = 0; i <= segments; i++) {
    const include = i < segments && !cavernOpening(i);
    if (include && start === null) start = i;
    if (!include && start !== null) { arcs.push({ thetaStart: (start - .5) * span, thetaLength: (i - start) * span }); start = null; }
  }
  return arcs;
}

// Convert the collision-space arc ranges into three.js CylinderGeometry theta
// ranges. Collision places a wall segment at (cos a, sin a), while a cylinder
// vertex at theta sits at (sin theta, cos theta), so theta = PI/2 - a. Without
// this conversion the visible openings land on solid collision segments.
export function cavernRenderArcs(segments = CAVERN_SEGMENTS) {
  return cavernArcs(segments).map(({ thetaStart, thetaLength }) => ({
    thetaStart: Math.PI / 2 - (thetaStart + thetaLength),
    thetaLength,
  }));
}

// A cavern is a low stone drum with a domed roof, open at two opposite points.
export function cavernShell(radius = 12, height = 8, segments = CAVERN_SEGMENTS) {
  const r = Math.max(1, Number(radius) || 12), h = Math.max(1, Number(height) || 8);
  return { radius: r, wallHeight: h * .52, domeHeight: h * .66, arcs: cavernArcs(segments), renderArcs: cavernRenderArcs(segments) };
}

// ---- Destructible props ---------------------------------------------------
//
// Lightweight, deterministic prop-break rules shared by the simulation and the
// renderer. Props are presentation-only: breaking one never edits collision
// blocks or authoritative movement, so a replay stays byte-identical whether or
// not a client renders debris. Debris is emitted as a pure, pooled plan (a fixed
// count of chunks with bounded velocities) so the CPU renderer can skip it and
// the WebGL renderer can reuse one instanced/pooled draw.

// Only these prop families are breakable; rocks/trees/ruins are static scenery.
export const BREAKABLE_PROPS = Object.freeze(new Set(['crate', 'barrel']));

// Per-family break profile. `threshold` is the damage that shatters the prop,
// `pieces` the pooled debris count, `force` the launch speed and `spread` the
// half-angle of the burst. Values are deliberately small so a busy firefight
// cannot flood the debris pool.
const BREAK_TABLE = Object.freeze({
  crate: Object.freeze({kind: 'crate', threshold: 30, pieces: 6, force: 4.2, spread: 1, color: '#6b4a2f', material: 'wood', sound: 'splat'}),
  barrel: Object.freeze({kind: 'barrel', threshold: 22, pieces: 5, force: 5.4, spread: .8, color: '#b0703f', material: 'metal', sound: 'burst'}),
});

export const BREAK_KINDS = Object.freeze(Object.keys(BREAK_TABLE));

// Pure deterministic hash (FNV-1a over quantized numbers) so the same prop and
// hit always produce the same shatter, independent of frame timing or renderer.
export function propHash(...values) {
  let h = 2166136261 >>> 0;
  for (const value of values) { const n = Math.floor((Number.isFinite(value) ? value : 0) * 1000); h ^= (n >>> 0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
export const propHashUnit = (...values) => propHash(...values) / 4294967296;

export function breakProfile(kind) { return BREAK_TABLE[kind] || null; }
export function isBreakable(kind) { return BREAKABLE_PROPS.has(kind); }

// A prop's stable identity: index in the map's authored prop list plus its
// position. The index keeps two props at the same coordinate distinct.
export function propId(prop, index = 0) {
  const seed = Number.isFinite(prop?.seed) ? prop.seed : index;
  return `${prop?.type || 'prop'}:${index}:${Math.round((prop?.x || 0) * 10)}:${Math.round((prop?.z || 0) * 10)}:${seed}`;
}

// Apply damage to a prop's break state. Returns the previous and next state so
// the caller can fire the shatter exactly once. `state` is a plain map keyed by
// propId; the function never mutates the prop itself.
export function applyPropDamage(state, id, kind, amount) {
  const profile = breakProfile(kind);
  if (!profile || !Number.isFinite(amount) || amount <= 0) return null;
  const current = state.get(id) || { hp: profile.threshold, broken: false };
  if (current.broken) return { id, kind, broken: true, wasBroken: true, hp: 0, profile };
  const hp = current.hp - amount;
  if (hp > 0) { state.set(id, { hp, broken: false }); return { id, kind, broken: false, wasBroken: false, hp, profile }; }
  state.set(id, { hp: 0, broken: true });
  return { id, kind, broken: true, wasBroken: false, hp: 0, profile };
}

// Deterministic debris plan for a shattered prop. Pure: same prop, same hit
// origin and same serial always yield the same chunks. Each chunk has a bounded
// velocity and spin so the pooled debris cannot escape its lifetime budget.
export function propBreakPlan(prop, { origin = null, serial = 0, reduced = false } = {}) {
  const profile = breakProfile(prop?.type);
  if (!profile) return null;
  const seed = propHash(prop?.seed ?? 0, prop?.x ?? 0, prop?.z ?? 0, serial);
  const baseX = Number(prop?.x) || 0, baseY = Number(prop?.y) || 0, baseZ = Number(prop?.z) || 0;
  const ox = Number.isFinite(origin?.x) ? origin.x : baseX + 1, oy = Number.isFinite(origin?.y) ? origin.y : baseY + .6, oz = Number.isFinite(origin?.z) ? origin.z : baseZ + 1;
  const count = Math.max(0, reduced ? Math.min(2, profile.pieces) : profile.pieces);
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const a = propHashUnit(seed, i * 7 + 1) * Math.PI * 2;
    const elevation = .25 + propHashUnit(seed, i * 7 + 2) * .9;
    const speed = profile.force * (.55 + propHashUnit(seed, i * 7 + 3) * .8);
    const dx = baseX - ox, dz = baseZ - oz, len = Math.hypot(dx, dz) || 1;
    const outward = .6 + profile.spread * .4;
    // Clamp the launch vector so a burst can never exceed the profile's budget.
    let vx = (Math.cos(a) + dx / len * outward) * speed, vy = (elevation + .35) * speed, vz = (Math.sin(a) + dz / len * outward) * speed;
    const magnitude = Math.hypot(vx, vy, vz), cap = profile.force * 2.2;
    if (magnitude > cap) { const k = cap / magnitude; vx *= k; vy *= k; vz *= k; }
    pieces.push({
      offset: { x: (propHashUnit(seed, i * 7 + 4) - .5) * .5, y: propHashUnit(seed, i * 7 + 5) * .4, z: (propHashUnit(seed, i * 7 + 6) - .5) * .5 },
      velocity: { x: vx, y: vy, z: vz },
      spin: { x: (propHashUnit(seed, i * 7 + 7) - .5) * 12, y: (propHashUnit(seed, i * 7 + 8) - .5) * 12, z: (propHashUnit(seed, i * 7 + 9) - .5) * 12 },
      scale: .55 + propHashUnit(seed, i * 7 + 10) * .7,
      life: .9 + propHashUnit(seed, i * 7 + 11) * .7,
    });
  }
  return { id: prop?.id ?? null, kind: prop.type, color: profile.color, material: profile.material, sound: profile.sound, pieces, count };
}
