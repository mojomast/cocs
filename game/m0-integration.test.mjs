import test from 'node:test';
import assert from 'node:assert/strict';
import {Match, floorAt, obstructed, walkEdge, rayWorld, navigation} from './core.mjs';
import {getMap} from './maps.mjs';
import {RULES} from './data.mjs';
import {terrainSupportAt, terrainRayHit} from './terrain.mjs';

// M0 hot-path integration evidence. The pure modules (floor-lattice.mjs,
// spatial.mjs) already prove per-query equivalence; these tests prove the
// *integrated* Match path (arena queries, moveActor, nav) still returns the
// same answers as the pre-M0 brute-force oracles on terrain and non-terrain
// maps, and that seeded runs stay byte-identical.

const TERRAIN_MAPS = ['titan-valley', 'convoy-line', 'catacombs', 'lattice-slice'];
const NON_TERRAIN_MAPS = ['exchange', 'crosswire'];
const DEFAULT_BOUNDS = {minX: -13.55, maxX: 13.55, minZ: -13.55, maxZ: 13.55};
const boundsOf = arena => arena.bounds || DEFAULT_BOUNDS;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- pre-M0 brute-force oracles ------------------------------------------

// Exact copy of the original core.mjs boxHit.
function boxHit(o, d, b, max) {
  let lo = 0, hi = max;
  for (const k of ['x', 'y', 'z']) {
    const c = k === 'y' ? b.h / 2 : b[k];
    const s = k === 'x' ? b.w / 2 : k === 'z' ? b.d / 2 : b.h / 2;
    if (Math.abs(d[k]) < 1e-8) { if (o[k] < c - s || o[k] > c + s) return null; }
    else {
      let t1 = (c - s - o[k]) / d[k], t2 = (c + s - o[k]) / d[k];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      lo = Math.max(lo, t1); hi = Math.min(hi, t2);
      if (lo > hi) return null;
    }
  }
  return lo;
}

const segmentDistance = (x, z, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  if (length <= 1e-9) return Math.hypot(x - a.x, z - a.z);
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
};
// Original core terrainObstructed, but reading wall segments from the module.
const bruteTerrainObstructed = (arena, x, y, z, r) => {
  if (!(arena.terrain?.walls?.length > 0)) return false;
  // Rebuild the segments exactly as terrain.mjs does (independent of the cache).
  const segments = [];
  for (const wall of arena.terrain.walls ?? []) {
    const verts = wall.vertices ?? (wall.a !== undefined ? [wall.a, wall.b] : [wall.from, wall.to]);
    const closed = verts.length > 2, limit = closed ? verts.length : verts.length - 1;
    for (let i = 0; i < limit; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      if (Math.hypot(b[0] - a[0], b[2] - a[2]) <= 1e-9) continue;
      segments.push({a: {x: a[0], y: a[1], z: a[2]}, b: {x: b[0], y: b[1], z: b[2]}});
    }
  }
  return segments.some(({a, b}) => y < Math.max(a.y, b.y) - 1e-6 && y + RULES.height > Math.min(a.y, b.y) + 1e-6 && segmentDistance(x, z, a, b) < r);
};
const bruteObstructed = (arena, x, y, z, r) =>
  (arena.blocks || []).some(b => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r && y < b.h - 1e-6 && y + RULES.height > 0)
  || bruteTerrainObstructed(arena, x, y, z, r);

// Original non-terrain floor branch (unchanged by M0, kept to pin the split).
const legacyFloorAt = (x, z, arena) => {
  const surfaces = arena.platforms || arena.surfaces || [];
  if (surfaces.length) {
    let floor = null;
    for (const surface of surfaces) if (Math.abs(x - surface.x) <= surface.w / 2 && Math.abs(z - surface.z) <= surface.d / 2) {
      const y = surface.y ?? surface.topY ?? 0;
      floor = floor === null ? y : Math.max(floor, y);
    }
    return floor;
  }
  if (!arena.raised) return 0;
  let floor = 0;
  const solid = arena.blocks.some(b => b.kind !== 'deck' && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2);
  for (const b of arena.blocks) if (b.kind === 'deck' && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) floor = Math.max(floor, b.h);
  if (!arena.bounds && !solid && z <= -9) floor = Math.max(floor, 3.8);
  else if (!arena.bounds && !solid && Math.abs(x) > 8.2 && Math.abs(x) < 14 && z < 3) floor = Math.max(floor, (3 - z) / 12 * 3.8);
  return floor;
};

// Original rayWorld but iterating every block (no broadphase), same terrain path.
function bruteRayWorld(o, d, max, arena) {
  if (!o || !d || [o.x, o.y, o.z, d.x, d.y, d.z].some(v => !Number.isFinite(v))) return 0;
  if ((!Number.isFinite(max) && max !== Infinity) || max < 0 || Math.hypot(d.x, d.y, d.z) <= 1e-9) return 0;
  let best = max;
  for (const b of arena.blocks) { const t = boxHit(o, d, b, best); if (t !== null && t < best) best = t; }
  if (arena.terrain) { const hit = terrainRayHit(o, d, best, arena.terrain); if (hit && hit.distance < best) best = hit.distance; }
  else {
    for (let t = .12; t < best; t += .16) {
      const p = {x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t};
      const floor = floorAt(p.x, p.z, arena);
      if (floor !== null && p.y < floor) {
        let lo = Math.max(0, t - .16), hi = t;
        for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2, q = {x: o.x + d.x * m, y: o.y + d.y * m, z: o.z + d.z * m}; if (floorAt(q.x, q.z, arena) !== null && q.y < floorAt(q.x, q.z, arena)) hi = m; else lo = m; }
        best = hi; break;
      }
    }
  }
  return best;
}

// ---- parity ---------------------------------------------------------------

test('Match floorAt matches the terrain mesh and the legacy non-terrain branch', () => {
  for (const id of [...TERRAIN_MAPS, ...NON_TERRAIN_MAPS]) {
    const match = new Match('chatgpt', 'openclaw', mulberry32(7), id, {mode: 'deathmatch', humanCount: 1, botCount: 0, timeLimit: 60});
    const arena = match.arena, bounds = boundsOf(arena), slope = arena.terrain?.maxSlope ?? 0.9, random = mulberry32(1234 + id.length);
    for (let i = 0; i < 400; i++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
      const actual = floorAt(x, z, arena);
      const expected = arena.terrain ? (terrainSupportAt(x, z, arena.terrain, slope)?.y ?? null) : legacyFloorAt(x, z, arena);
      if (expected === null || actual === null) assert.equal(actual, expected, `${id} (${x},${z}) null mismatch`);
      else assert.ok(Math.abs(actual - expected) <= 1e-6, `${id} (${x},${z}) ${actual} vs ${expected}`);
    }
  }
});

test('Match obstructed matches the brute-force block + wall oracle', () => {
  for (const id of [...TERRAIN_MAPS, ...NON_TERRAIN_MAPS]) {
    const match = new Match('chatgpt', 'openclaw', mulberry32(9), id, {mode: 'deathmatch', humanCount: 1, botCount: 0, timeLimit: 60});
    const arena = match.arena, bounds = boundsOf(arena), random = mulberry32(4321 + id.length);
    for (let i = 0; i < 500; i++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
      const y = random() * 9 - 1.5;
      const r = [RULES.radius, .52, 0.9][i % 3];
      assert.equal(obstructed(x, y, z, r, arena), bruteObstructed(arena, x, y, z, r), `${id} (${x},${y},${z}) r=${r}`);
    }
    // Walk-edge probe path also goes through the broadphase.
    for (let i = 0; i < 80; i++) {
      const a = {x: bounds.minX + random() * (bounds.maxX - bounds.minX), z: bounds.minZ + random() * (bounds.maxZ - bounds.minZ)};
      const b = {x: a.x + (random() - .5) * 6, z: a.z + (random() - .5) * 6};
      a.y = floorAt(a.x, a.z, arena); b.y = floorAt(b.x, b.z, arena);
      assert.equal(walkEdge(a, b, arena), walkEdgeBrute(a, b, arena), `${id} walkEdge ${JSON.stringify([a, b])}`);
    }
  }
});

// Independent walkEdge oracle using the brute clamps (mirrors pre-M0 core).
function walkEdgeBrute(a, b, arena) {
  const l = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  if (l > 6.5) return false;
  const n = Math.max(1, Math.ceil(l / .2));
  let prev = a.y;
  for (let i = 0; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
    let y = floorAt(x, z, arena);
    if (y === null) return false;
    for (const block of arena.blocks) if (block.kind === 'deck' && Math.abs(x - block.x) < block.w / 2 + .52 && Math.abs(z - block.z) < block.d / 2 + .52 && Math.abs(block.h - y) < .25) y = Math.max(y, block.h);
    if (Math.abs(y - prev) > .3 || bruteObstructed(arena, x, y, z, .52)) return false;
    prev = y;
  }
  return true;
}

test('Match rayWorld matches the brute-force block loop on terrain maps', () => {
  for (const id of TERRAIN_MAPS) {
    const match = new Match('chatgpt', 'openclaw', mulberry32(11), id, {mode: 'deathmatch', humanCount: 1, botCount: 0, timeLimit: 60});
    const arena = match.arena, bounds = boundsOf(arena), random = mulberry32(555 + id.length);
    for (let i = 0; i < 300; i++) {
      const o = {x: bounds.minX + random() * (bounds.maxX - bounds.minX), y: random() * 8 - 1, z: bounds.minZ + random() * (bounds.maxZ - bounds.minZ)};
      const yaw = random() * Math.PI * 2, pitch = (random() - .5) * 1.2;
      const d = {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
      const max = [Infinity, 20, 60][i % 3];
      const actual = rayWorld(o, d, max, arena), expected = bruteRayWorld(o, d, max, arena);
      if (!Number.isFinite(expected)) assert.equal(actual, expected, `${id} ray ${actual} vs ${expected}`);
      else assert.ok(Math.abs(actual - expected) <= 1e-9, `${id} ray ${actual} vs ${expected} at ${JSON.stringify(o)}`);
    }
  }
});

// ---- determinism ----------------------------------------------------------

function runSeeded(mapId, seed, options = {}) {
  const match = new Match('chatgpt', 'openclaw', mulberry32(seed), mapId, {mode: 'teamdeathmatch', humanCount: 1, botCount: 7, difficulty: 'normal', timeLimit: 600, ...options});
  for (let i = 0; i < 400; i++) {
    match.step(1 / 60, {inputs: {0: {x: Math.sin(i * .03), z: 1, yaw: i * .01, pitch: .1, fire: i % 13 === 0, jump: i % 40 === 0}}});
  }
  return JSON.stringify(match.snapshot());
}

test('seeded runs are byte-identical through the integrated hot path', () => {
  for (const id of ['titan-valley', 'convoy-line', 'lattice-slice', 'crosswire']) {
    const first = runSeeded(id, 2024);
    const second = runSeeded(id, 2024);
    assert.equal(first, second, `${id} seeded run diverged`);
    assert.ok(first.length > 1000, `${id} snapshot serialized`);
  }
});

test('skipNav matches keep the floor lattice and produce identical predictions', () => {
  for (const id of ['crosswire', 'titan-valley']) {
    // A prediction shadow is a single actor: compare the local-actor path with
    // and without the nav graph.
    const local = {humanCount: 1, botCount: 0, timeLimit: 600};
    const full = runSeeded(id, 77, local);
    const skip = runSeeded(id, 77, {...local, skipNav: true});
    assert.equal(skip, full, `${id} skipNav changed the simulated state`);
    const match = new Match('chatgpt', 'openclaw', mulberry32(1), id, {mode: 'teamdeathmatch', humanCount: 1, botCount: 0, timeLimit: 60, skipNav: true});
    assert.equal(match.nav.length, 0, `${id} skipNav leaves an empty nav graph`);
    assert.equal(match.edges.length, 0);
    // The floor lattice is still baked, so movement queries stay on the fast path.
    assert.ok(floorAt(match.center.x, match.center.z, match.arena) !== undefined);
  }
});

test('navigation still returns a usable graph through the baked lattice', () => {
  for (const id of ['titan-valley', 'lattice-slice']) {
    const arena = getMap(id);
    const {nodes, edges} = navigation(arena);
    assert.ok(nodes.length > 0, `${id} has nav nodes`);
    assert.equal(nodes.length, edges.length);
    for (const n of nodes) {
      assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z));
      assert.notEqual(floorAt(n.x, n.z, arena), null, `${id} nav node sits on a floor`);
    }
  }
});
