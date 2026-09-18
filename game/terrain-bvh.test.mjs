import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS, getMap} from './maps.mjs';
import {terrainTriangles, terrainWallTriangles, terrainRayHit, stampTerrainFloor} from './terrain.mjs';
import {Match, rayWorld, visible} from './core.mjs';
import {
  DEFAULT_TERRAIN_BVH_LEAF,
  TERRAIN_BVH_VERSION,
  bakeTerrainBvh,
  ensureTerrainBvh,
  invalidateTerrainBvh,
  terrainBvhHash,
  terrainRayHitFast,
} from './terrain-bvh.mjs';

const TERRAIN_MAPS = MAPS.filter(map => map.terrain);
const DEFAULT_BOUNDS = {minX: -13.55, maxX: 13.55, minZ: -13.55, maxZ: 13.55};
const boundsOf = arena => arena.bounds || DEFAULT_BOUNDS;

function rng(seed) {
  let n = seed >>> 0;
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sameNumber = (a, b) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9);

// Compare the accelerated hit with the brute oracle exactly: presence, distance
// (bit-identical in practice, 1e-9 tolerated) and the returned record fields.
function assertHitParity(map, bvh, o, d, max, label) {
  const brute = terrainRayHit(o, d, max, map.terrain);
  const fast = terrainRayHitFast(bvh, o, d, max);
  assert.equal(!!fast, !!brute, `${map.id} ${label} hit presence`);
  if (!brute) return;
  assert.ok(sameNumber(brute.distance, fast.distance), `${map.id} ${label} distance ${brute.distance} vs ${fast.distance}`);
  assert.equal(brute.surfaceId, fast.surfaceId, `${map.id} ${label} surfaceId`);
  assert.equal(brute.material, fast.material, `${map.id} ${label} material`);
  for (let i = 0; i < 3; i++) assert.ok(sameNumber(brute.normal[i], fast.normal[i]), `${map.id} ${label} normal[${i}]`);
}

function rayAt(map, random, kind) {
  const bounds = boundsOf(map);
  const x = bounds.minX + random() * (bounds.maxX - bounds.minX);
  const z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
  let o, d, max = Infinity;
  if (kind === 'horizontal') {
    o = {x, y: 2 + random() * 4, z};
    const yaw = random() * Math.PI * 2;
    d = {x: Math.sin(yaw), y: 0, z: Math.cos(yaw)};
  } else if (kind === 'near-zero') {
    o = {x, y: 2 + random() * 4, z};
    const yaw = random() * Math.PI * 2;
    d = {x: Math.sin(yaw), y: (random() - .5) * 1e-11, z: Math.cos(yaw)};
  } else if (kind === 'outside') {
    o = {x: bounds.maxX + 4 + random() * 40, y: 1 + random() * 6, z: bounds.maxZ + 4 + random() * 40};
    const yaw = random() * Math.PI * 2, pitch = (random() - .5) * 1.2;
    d = {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
    max = [Infinity, 25, 120][Math.floor(random() * 3)];
  } else if (kind === 'inside') {
    const triangles = terrainTriangles(map.terrain);
    const tri = triangles[Math.floor(random() * triangles.length)];
    let u = random(), v = random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const [a, b, c] = tri.vertices;
    o = {x: u * a[0] + v * b[0] + w * c[0], y: u * a[1] + v * b[1] + w * c[1] + 0.05, z: u * a[2] + v * b[2] + w * c[2]};
    const yaw = random() * Math.PI * 2, pitch = (random() - .5) * 1.4;
    d = {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
  } else if (kind === 'on-surface') {
    const triangles = terrainTriangles(map.terrain);
    const tri = triangles[Math.floor(random() * triangles.length)];
    const vertex = tri.vertices[Math.floor(random() * 3)];
    o = {x: vertex[0], y: vertex[1], z: vertex[2]};
    const yaw = random() * Math.PI * 2, pitch = (random() - .5) * 1.4;
    d = {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
  } else {
    o = {x, y: -2 + random() * 12, z};
    const yaw = random() * Math.PI * 2, pitch = (random() - .5) * 1.4;
    d = {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
    max = [Infinity, 10, 40, 120][Math.floor(random() * 4)];
  }
  return {o, d, max};
}

// ---- parity ---------------------------------------------------------------

test('terrainRayHitFast is bit-for-bit equivalent to terrainRayHit on every terrain map', () => {
  const kinds = ['random', 'horizontal', 'near-zero', 'outside', 'inside', 'on-surface'];
  let rays = 0;
  for (const map of TERRAIN_MAPS) {
    const bvh = bakeTerrainBvh(map.terrain);
    const random = rng(7001 + map.id.length);
    for (let i = 0; i < 600; i++) {
      const kind = kinds[i % kinds.length];
      const {o, d, max} = rayAt(map, random, kind);
      assertHitParity(map, bvh, o, d, max, `${kind} #${i}`);
      rays++;
    }
  }
  assert.ok(rays >= 22 * 600, 'hundreds of rays per terrain map');
});

test('ray hits exactly on a shared triangle edge resolve to the first triangle', () => {
  const shared = [0, 0, 0], left = [2, 0, 0], far = [2, 0, 2], near = [0, 0, 2];
  const terrain = {
    surfaces: [
      {id: 's0', material: 'm0', walkable: true, vertices: [shared, left, far], triangles: [[0, 1, 2]]},
      {id: 's1', material: 'm1', walkable: true, vertices: [shared, far, near], triangles: [[0, 1, 2]]},
    ],
  };
  const bvh = bakeTerrainBvh(terrain);
  // Straight down through the midpoint of the shared diagonal `shared-far`.
  const o = {x: 1, y: 5, z: 1}, d = {x: 0, y: -1, z: 0};
  const brute = terrainRayHit(o, d, Infinity, terrain), fast = terrainRayHitFast(bvh, o, d, Infinity);
  assert.ok(brute && fast);
  assert.equal(brute.distance, 5);
  assert.equal(fast.distance, 5);
  assert.equal(brute.surfaceId, 's0', 'brute keeps the first triangle');
  assert.equal(fast.surfaceId, 's0', 'fast tie-breaks to the lowest triangle index');
  assert.equal(fast.material, 'm0');
});

test('validation matches the brute module and degrades safely on empty terrain', () => {
  const empty = {surfaces: [], walls: []};
  const bvh = bakeTerrainBvh(empty);
  assert.equal(bvh.root, -1);
  assert.equal(terrainRayHitFast(bvh, {x: 0, y: 0, z: 0}, {x: 0, y: -1, z: 0}, Infinity), null);
  assert.throws(() => bakeTerrainBvh(null));
  assert.throws(() => terrainRayHitFast(null, {x: 0, y: 0, z: 0}, {x: 0, y: -1, z: 0}, Infinity));
  assert.throws(() => terrainRayHitFast(bvh, {x: NaN, y: 0, z: 0}, {x: 0, y: -1, z: 0}, Infinity));
  assert.throws(() => terrainRayHitFast(bvh, {x: 0, y: 0, z: 0}, {x: 0, y: -1, z: 0}, -1));
  // `maxDistance` very small excludes every hit; `0` is a miss, not an error.
  const map = getMap('titan-valley');
  const fast0 = terrainRayHitFast(ensureTerrainBvh(map.terrain), {x: 0, y: 50, z: 0}, {x: 0, y: -1, z: 0}, 0);
  assert.equal(fast0, null);
});

// ---- determinism ----------------------------------------------------------

test('bake is deterministic, content-hashed and cached by terrain identity', () => {
  const map = getMap('titan-valley');
  const first = bakeTerrainBvh(map.terrain), second = bakeTerrainBvh(map.terrain);
  assert.equal(first.hash, second.hash);
  assert.equal(terrainBvhHash(first), first.hash);
  assert.match(first.hash, new RegExp(`^${TERRAIN_BVH_VERSION}:`));
  const clone = JSON.parse(JSON.stringify(map.terrain));
  assert.equal(bakeTerrainBvh(clone).hash, first.hash, 'content-identical terrain hashes identically');
  assert.equal(bakeTerrainBvh(map.terrain, {leafSize: 24}).hash !== first.hash, true, 'leaf size participates in the hash');
  assert.equal(ensureTerrainBvh(map.terrain), ensureTerrainBvh(map.terrain));
  const before = ensureTerrainBvh(map.terrain);
  invalidateTerrainBvh(map.terrain);
  const after = ensureTerrainBvh(map.terrain);
  assert.notEqual(after, before, 'invalidate drops the cached bake');
  assert.equal(after.hash, before.hash, 're-baked BVH has identical content');
  assert.equal(DEFAULT_TERRAIN_BVH_LEAF, ensureTerrainBvh(map.terrain).leafSize);
});

test('stampTerrainFloor invalidates the cached BVH and the re-bake matches the new mesh', () => {
  const terrain = {
    surfaces: [{id: 'ground', material: 'dirt', walkable: true, vertices: [[-8, 0, -8], [-8, 0, 8], [8, 0, 8], [8, 0, -8]]}],
    walls: [],
  };
  const original = ensureTerrainBvh(terrain);
  assert.equal(ensureTerrainBvh(terrain), original, 'cache hit before stamp');
  const o = {x: 0, y: 10, z: 0}, d = {x: 0, y: -1, z: 0};
  assert.equal(terrainRayHitFast(original, o, d, Infinity).distance, 10);
  stampTerrainFloor(terrain, [[-2, -2], [-2, 2], [2, 2], [2, -2]], () => 3, 'raised');
  const rebuilt = ensureTerrainBvh(terrain);
  assert.notEqual(rebuilt, original, 'stamp drops the cached BVH');
  const brute = terrainRayHit(o, d, Infinity, terrain);
  assert.ok(Math.abs(brute.distance - 7) <= 1e-9, 'stamped floor ray hits the new surface');
  assertHitParity({id: 'stamped', terrain}, rebuilt, o, d, Infinity, 'post-stamp');
  // A direction that only the new mesh can answer (through the raised slab side).
  const side = {x: -6, y: 3, z: 0}, toward = {x: 1, y: 0, z: 0};
  assertHitParity({id: 'stamped', terrain}, rebuilt, side, toward, Infinity, 'post-stamp side');
});

test('seeded runs through the accelerated ray path stay byte-identical', () => {
  const runSeeded = (mapId, seed) => {
    const match = new Match('chatgpt', 'openclaw', mulberry32(seed), mapId, {mode: 'teamdeathmatch', humanCount: 1, botCount: 7, difficulty: 'normal', timeLimit: 600});
    for (let i = 0; i < 200; i++) match.step(1 / 60, {inputs: {0: {x: Math.sin(i * .03), z: 1, yaw: i * .01, pitch: .1, fire: i % 13 === 0}}});
    return JSON.stringify(match.snapshot());
  };
  for (const id of ['titan-valley', 'convoy-line']) {
    assert.equal(runSeeded(id, 4242), runSeeded(id, 4242), `${id} seeded run diverged`);
  }
});

test('rayWorld keeps brute terrain parity through the integrated Match path', () => {
  // `Match.rayWorld` is the production caller. Compare its output to a copy of
  // the brute block loop with the *original* terrainRayHit on a terrain map.
  const boxHit = (o, d, b, max) => {
    let lo = 0, hi = max;
    for (const k of ['x', 'y', 'z']) {
      const c = k === 'y' ? b.h / 2 : b[k], s = k === 'x' ? b.w / 2 : k === 'z' ? b.d / 2 : b.h / 2;
      if (Math.abs(d[k]) < 1e-8) { if (o[k] < c - s || o[k] > c + s) return null; }
      else { let t1 = (c - s - o[k]) / d[k], t2 = (c + s - o[k]) / d[k]; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } lo = Math.max(lo, t1); hi = Math.min(hi, t2); if (lo > hi) return null; }
    }
    return lo;
  };
  const map = getMap('convoy-line');
  const match = new Match('chatgpt', 'openclaw', mulberry32(11), 'convoy-line', {mode: 'deathmatch', humanCount: 1, botCount: 0, timeLimit: 60});
  const bounds = boundsOf(match.arena), random = rng(31337);
  for (let i = 0; i < 300; i++) {
    const o = {x: bounds.minX + random() * (bounds.maxX - bounds.minX), y: random() * 10, z: bounds.minZ + random() * (bounds.maxZ - bounds.minZ)};
    const yaw = random() * Math.PI * 2, pitch = (random() - .5) * 1.3;
    const d = {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
    const max = [Infinity, 15, 50][i % 3];
    let expected = max;
    for (const b of map.blocks) { const t = boxHit(o, d, b, expected); if (t !== null && t < expected) expected = t; }
    const hit = terrainRayHit(o, d, expected, map.terrain);
    if (hit && hit.distance < expected) expected = hit.distance;
    const actual = rayWorld(o, d, max, match.arena);
    assert.ok(sameNumber(actual, expected), `ray ${i}: ${actual} vs ${expected}`);
  }
  // `visible` agrees with a ray-length test on the same accelerated path.
  const a = {x: bounds.minX + 4, y: 3, z: bounds.minZ + 4}, b = {x: bounds.maxX - 4, y: 3, z: bounds.maxZ - 4};
  const delta = {x: b.x - a.x, y: b.y - a.y, z: b.z - a.z};
  const length = Math.hypot(delta.x, delta.y, delta.z);
  const direction = {x: delta.x / length, y: delta.y / length, z: delta.z / length};
  assert.equal(visible(a, b, match.arena), rayWorld(a, direction, length, match.arena) >= length - .08);
});

// ---- perf microbenchmark --------------------------------------------------

const FAST_P95_BUDGET_US = 15;
const PERF_MARGIN = 6;
const BUILD_BUDGET_MS = 100;
const REFERENCE_MAPS = ['titan-valley', 'convoy-line', 'frostline', 'catacombs', 'riverbend'];

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function timePerCall(fn, iterations) {
  const samples = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    fn(i);
    samples[i] = Number(process.hrtime.bigint() - start);
  }
  samples.sort((a, b) => a - b);
  return samples;
}

test('BVH bake is fast and accelerated rays stay within the microbenchmark budget', () => {
  const random = rng(20240918);
  const report = [];
  for (const id of REFERENCE_MAPS) {
    const map = getMap(id);
    assert.ok(map?.terrain, `${id} has terrain`);
    const builtAt = process.hrtime.bigint();
    const bvh = bakeTerrainBvh(map.terrain);
    const buildMs = Number(process.hrtime.bigint() - builtAt) / 1e6;
    assert.ok(buildMs <= BUILD_BUDGET_MS, `${id} build ${buildMs.toFixed(2)} ms <= ${BUILD_BUDGET_MS} ms`);
    const bounds = boundsOf(map);
    const rays = Array.from({length: 4000}, () => {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX), z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
      const yaw = random() * Math.PI * 2, pitch = (random() - .5) * 1.2;
      return {o: {x, y: 3 + random() * 4, z}, d: {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)}};
    });
    for (let i = 0; i < 2000; i++) terrainRayHitFast(bvh, rays[i].o, rays[i].d, 60);
    const fast = timePerCall(i => terrainRayHitFast(bvh, rays[i].o, rays[i].d, 60), rays.length);
    const bruteRays = rays.slice(0, 600);
    for (let i = 0; i < 100; i++) terrainRayHit(bruteRays[i].o, bruteRays[i].d, 60, map.terrain);
    const brute = timePerCall(i => terrainRayHit(bruteRays[i].o, bruteRays[i].d, 60, map.terrain), bruteRays.length);
    const fastP50 = percentile(fast, 0.5) / 1000, fastP95 = percentile(fast, 0.95) / 1000;
    const bruteP50 = percentile(brute, 0.5) / 1000;
    report.push(`${id} (${terrainTriangles(map.terrain).length + terrainWallTriangles(map.terrain).length} tris): bvh p50 ${fastP50.toFixed(2)} us / p95 ${fastP95.toFixed(2)} us; brute p50 ${bruteP50.toFixed(1)} us; build ${buildMs.toFixed(2)} ms; ${(bruteP50 / fastP50).toFixed(1)}x`);
    assert.ok(fastP95 <= FAST_P95_BUDGET_US * PERF_MARGIN, `${id} bvh p95 ${fastP95} us <= ${FAST_P95_BUDGET_US * PERF_MARGIN} us`);
    assert.ok(bruteP50 > fastP50 * 5, `${id} bvh is at least 5x faster than the linear scan`);
  }
  console.log(`[terrain-bvh] ${report.join(' | ')}`);
});
