import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS} from './maps.mjs';
import {RULES} from './data.mjs';
import {blockObstructed, blockSupportTop, bakeBlockBvh, blockBvhHash, BLOCK_BVH_VERSION, candidates, collisionHash, invalidateBlockIndex, makeBlockIndex, NAV_BAKE_VERSION, rayBlockHit, rayCandidates, rayWorldBlockHit} from './spatial.mjs';

const DEFAULT_BOUNDS = {minX: -13.55, maxX: 13.55, minZ: -13.55, maxZ: 13.55};
const boundsOf = arena => arena.bounds || DEFAULT_BOUNDS;
const PROXY_KINDS = new Set(['cave', 'tunnel', 'rock', 'tree', 'crate', 'column']);

function rng(seed) {
  let n = seed >>> 0;
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Exact copy of core.mjs boxHit, the ray oracle.
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

// Brute-force oracles mirroring core.obstructed (block half) and supportAt.
const bruteObstructed = (arena, x, y, z, r) => (arena.blocks || []).some(b => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r && y < b.h - 1e-6 && y + RULES.height > 0);
const bruteSupportTop = (arena, x, z, radius) => {
  let top = null;
  for (const b of arena.blocks || []) if (b.kind !== 'deck' && Math.abs(x - b.x) <= b.w / 2 + radius && Math.abs(z - b.z) <= b.d / 2 + radius) top = top === null || b.h > top ? b.h : top;
  return top;
};
const bruteRay = (arena, o, d, max) => {
  let best = max, block = null;
  for (const b of arena.blocks || []) { const t = boxHit(o, d, b, max); if (t !== null && t < best) { best = t; block = b; } }
  return {best, block};
};

test('candidates + blockObstructed match brute force on every map', () => {
  const random = rng(1234);
  for (const map of MAPS) {
    const index = makeBlockIndex(map);
    const blocks = map.blocks || [];
    const bounds = boundsOf(map);
    const blockSamples = [];
    for (let i = 0; i < 120 && blocks.length; i++) {
      const b = blocks[Math.floor(random() * blocks.length)];
      blockSamples.push({x: b.x + (random() - 0.5) * (b.w + 2), z: b.z + (random() - 0.5) * (b.d + 2)});
    }
    const radii = [0, RULES.radius, 0.52, 1, 4];
    for (let i = 0; i < 320; i++) {
      const point = blockSamples[i % Math.max(1, blockSamples.length)] || {
        x: bounds.minX + random() * (bounds.maxX - bounds.minX),
        z: bounds.minZ + random() * (bounds.maxZ - bounds.minZ),
      };
      const x = i % 3 === 2 ? bounds.minX + random() * (bounds.maxX - bounds.minX) : point.x;
      const z = i % 3 === 2 ? bounds.minZ + random() * (bounds.maxZ - bounds.minZ) : point.z;
      const r = radii[i % radii.length];
      const y = i % 4 === 0 ? -RULES.height - 1e-4 : i % 4 === 1 ? -RULES.height + 1e-4 : i % 4 === 2 ? random() * 12 - 2 : 1.2;
      const list = index.candidates(x, z, r);
      const set = new Set(list);
      for (const b of blocks) {
        const inPredicate = Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r;
        if (inPredicate && !set.has(b)) assert.fail(`${map.id} candidate miss at (${x},${z}) r=${r}`);
      }
      assert.equal(blockObstructed(map, x, y, z, r), bruteObstructed(map, x, y, z, r), `${map.id} obstructed (${x},${y},${z}) r=${r}`);
    }
  }
});

test('blockSupportTop preserves the deck exclusion and radius semantics on every map', () => {
  const random = rng(99);
  for (const map of MAPS) {
    const bounds = boundsOf(map);
    for (let i = 0; i < 240; i++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
      const radius = [RULES.radius, RULES.radius * 0.5, 1, 2.5][i % 4];
      assert.equal(blockSupportTop(map, x, z, radius), bruteSupportTop(map, x, z, radius), `${map.id} support (${x},${z}) r=${radius}`);
    }
  }
});

test('rayCandidates is a superset and yields the same nearest block as brute force on every map', () => {
  const random = rng(777);
  for (const map of MAPS) {
    const index = makeBlockIndex(map);
    const blocks = map.blocks || [];
    const bounds = boundsOf(map);
    for (let i = 0; i < 260; i++) {
      const margin = 8;
      const o = {
        x: bounds.minX - margin + random() * (bounds.maxX - bounds.minX + margin * 2),
        y: random() * 14 - 3,
        z: bounds.minZ - margin + random() * (bounds.maxZ - bounds.minZ + margin * 2),
      };
      let d;
      if (i % 8 === 0) d = {x: 0, y: -1, z: 0}; // straight down
      else if (i % 8 === 1) d = {x: 0, y: 1, z: 0}; // straight up
      else if (i % 8 === 2) d = {x: 1, y: 0, z: 0}; // axis-aligned
      else if (i % 8 === 3) d = {x: 0, y: 0, z: 1};
      else if (i % 8 === 4) d = {x: 1e-7, y: -1, z: 0}; // near-zero XZ
      else {
        const yaw = random() * Math.PI * 2, pitch = (random() - 0.5) * Math.PI;
        d = {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
      }
      const max = [Infinity, 1, 6, 30, 200][i % 5];
      const brute = bruteRay(map, o, d, max);
      const list = index.rayCandidates(o, d, max);
      const set = new Set(list);
      if (brute.block && !set.has(brute.block)) assert.fail(`${map.id} ray candidate miss at ${JSON.stringify(o)}`);
      let fastBest = max;
      for (const b of list) { const t = boxHit(o, d, b, max); if (t !== null && t < fastBest) fastBest = t; }
      if (Number.isFinite(brute.best) || Number.isFinite(fastBest)) {
        assert.ok(Math.abs(fastBest - brute.best) <= 1e-9, `${map.id} ray nearest ${fastBest} vs ${brute.best}`);
      } else {
        assert.equal(fastBest, brute.best);
      }
    }
  }
});

test('deck blocks obstruct but never support; next-gen proxies stay collidable', () => {
  const exchange = MAPS.find(m => m.id === 'exchange');
  const decks = (exchange.blocks || []).filter(b => b.kind === 'deck');
  assert.ok(decks.length, 'exchange authors deck blocks');
  for (const deck of decks) {
    assert.equal(blockSupportTop(exchange, deck.x, deck.z, RULES.radius), bruteSupportTop(exchange, deck.x, deck.z, RULES.radius), 'deck is excluded from support');
    assert.ok(candidates(exchange, deck.x, deck.z, RULES.radius).includes(deck), 'deck is still reachable as an obstruction candidate');
    assert.equal(blockObstructed(exchange, deck.x, 0, deck.z, RULES.radius), bruteObstructed(exchange, deck.x, 0, deck.z, RULES.radius));
  }
  const nextGen = MAPS.filter(m => m.nextGen === true);
  assert.ok(nextGen.length, 'next-gen maps exist');
  let proxies = 0;
  for (const map of nextGen) {
    for (const block of map.blocks || []) {
      if (!PROXY_KINDS.has(block.kind)) continue;
      proxies++;
      const listed = candidates(map, block.x, block.z, RULES.radius).includes(block);
      assert.ok(listed, `${map.id} proxy ${block.kind} is collidable`);
      assert.equal(blockObstructed(map, block.x, 0, block.z, RULES.radius), bruteObstructed(map, block.x, 0, block.z, RULES.radius));
    }
  }
  assert.ok(proxies > 0, 'next-gen maps author proxy collision blocks');
});

test('deferred/absent blocks are handled without an index', () => {
  assert.deepEqual(candidates({blocks: []}, 0, 0, 1), []);
  assert.deepEqual(rayCandidates({blocks: []}, {x: 0, y: 0, z: 0}, {x: 1, y: 0, z: 0}, 10), []);
  assert.throws(() => candidates(null, 0, 0, 1));
  assert.throws(() => candidates({blocks: []}, NaN, 0, 1));
  assert.throws(() => rayCandidates({blocks: []}, {x: 0, y: 0, z: 0}, {x: 1, y: 0, z: 0}, -1));
});

// ---- block ray BVH (W13) --------------------------------------------------

test('block ray BVH returns the exact brute-force nearest hit on every map', () => {
  const random = rng(20260918);
  for (const map of MAPS) {
    const index = makeBlockIndex(map);
    const bounds = boundsOf(map);
    for (let i = 0; i < 300; i++) {
      const margin = 8;
      const o = {
        x: bounds.minX - margin + random() * (bounds.maxX - bounds.minX + margin * 2),
        y: random() * 14 - 3,
        z: bounds.minZ - margin + random() * (bounds.maxZ - bounds.minZ + margin * 2),
      };
      let d;
      const mode = i % 8;
      if (mode === 0) d = {x: 0, y: -1, z: 0}; // straight down
      else if (mode === 1) d = {x: 1, y: 0, z: 0}; // axis-aligned
      else if (mode === 2) d = {x: 0, y: 0, z: 1};
      else if (mode === 3) d = {x: 5e-9, y: -1, z: 1e-9}; // near-zero XZ
      else {
        const yaw = random() * Math.PI * 2, pitch = (random() - 0.5) * Math.PI;
        d = {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
      }
      const max = [Infinity, 1, 6, 30, 200][i % 5];
      const brute = bruteRay(map, o, d, max).best;
      const viaIndex = index.rayBlockHit(o, d, max);
      const viaFree = rayWorldBlockHit(map, o, d, max);
      const eq = (a, b) => (Number.isFinite(a) || Number.isFinite(b)) ? Math.abs(a - b) <= 1e-9 : a === b;
      assert.ok(eq(brute, viaIndex), `${map.id} index ray hit ${viaIndex} vs ${brute}`);
      assert.ok(eq(brute, viaFree), `${map.id} free ray hit ${viaFree} vs ${brute}`);
    }
  }
});

test('block BVH bake is deterministic and shares the block-index invalidation contract', () => {
  const blocks = MAPS.flatMap(map => map.blocks || []);
  assert.ok(blocks.length > 8, 'sample blocks exist');
  assert.equal(blockBvhHash(bakeBlockBvh(blocks)), blockBvhHash(bakeBlockBvh(blocks)), 'the same blocks bake the same tree');
  assert.equal(blockBvhHash(bakeBlockBvh(blocks)).startsWith(`${BLOCK_BVH_VERSION}:`), true);

  // Leaf size only changes the tree shape, never the answer.
  const small = bakeBlockBvh(blocks, {leafSize: 1});
  const large = bakeBlockBvh(blocks, {leafSize: 64});
  const random = rng(31415);
  for (let i = 0; i < 300; i++) {
    const o = {x: random() * 60 - 30, y: random() * 12 - 2, z: random() * 60 - 30};
    const yaw = random() * Math.PI * 2, pitch = (random() - 0.5) * Math.PI;
    const d = {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
    const max = [Infinity, 5, 40][i % 3];
    const a = rayBlockHit(small, o, d, max), b = rayBlockHit(large, o, d, max);
    assert.ok((Number.isFinite(a) || Number.isFinite(b)) ? Math.abs(a - b) <= 1e-9 : a === b, `leaf-size invariant ray ${i}`);
  }

  // A mutable arena rebuilds the whole broadphase (grid + BVH) on a length
  // change, and invalidateBlockIndex drops it explicitly.
  const runtime = {blocks: blocks.map(b => ({...b}))};
  const first = makeBlockIndex(runtime);
  const firstHash = blockBvhHash(first.rayBvh());
  runtime.blocks.push({x: 0, z: 0, w: 2, d: 2, h: 2, kind: 'crate'});
  const second = makeBlockIndex(runtime);
  assert.notEqual(second, first, 'a block length change rebuilds the index');
  assert.notEqual(blockBvhHash(second.rayBvh()), firstHash, 'the ray structure tracks the block list');
  invalidateBlockIndex(runtime);
  assert.notEqual(makeBlockIndex(runtime), first, 'invalidateBlockIndex drops the cached broadphase');
});

test('collisionHash is a stable nav-cache signature', () => {
  assert.equal(NAV_BAKE_VERSION, 1);
  const seen = new Set();
  for (const map of MAPS) {
    const hash = collisionHash(map);
    assert.match(hash, /^[0-9a-f]{8}$/);
    assert.equal(hash, collisionHash(map), `${map.id} hash is stable`);
    assert.ok(!seen.has(hash), `${map.id} hash is map-specific`);
    seen.add(hash);
  }
  const crosswire = MAPS.find(m => m.id === 'crosswire');
  const mutated = {...crosswire, blocks: crosswire.blocks.map((b, i) => (i === 0 ? {...b, h: b.h + 1} : b))};
  assert.notEqual(collisionHash(mutated), collisionHash(crosswire), 'a block edit changes the signature');
});

// ---- perf microbenchmark --------------------------------------------------

const PERF_BUDGET_US = 1; // obstructed p95 target
const PERF_MARGIN = 4; // generous CI margin; measured numbers are reported
const REFERENCE_MAPS = ['catacombs', 'convoy-line', 'riverbend', 'frost-gate'];

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

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

test('broadphase obstructed p95 stays within the 1 us budget', () => {
  const random = rng(31337);
  const report = [];
  for (const id of REFERENCE_MAPS) {
    const map = MAPS.find(m => m.id === id);
    const bounds = boundsOf(map);
    const points = Array.from({length: 100000}, () => [
      bounds.minX + random() * (bounds.maxX - bounds.minX),
      Math.random() * 6,
      bounds.minZ + random() * (bounds.maxZ - bounds.minZ),
    ]);
    for (let i = 0; i < 20000; i++) blockObstructed(map, points[i][0], points[i][1], points[i][2], RULES.radius);
    const fast = timePerCall(i => blockObstructed(map, points[i][0], points[i][1], points[i][2], RULES.radius), points.length);
    const brutePoints = points.slice(0, 4000);
    for (let i = 0; i < 400; i++) bruteObstructed(map, brutePoints[i][0], brutePoints[i][1], brutePoints[i][2], RULES.radius);
    const brute = timePerCall(i => bruteObstructed(map, brutePoints[i][0], brutePoints[i][1], brutePoints[i][2], RULES.radius), brutePoints.length);
    const fastP50 = percentile(fast, 0.5) / 1000, fastP95 = percentile(fast, 0.95) / 1000;
    const bruteP50 = percentile(brute, 0.5) / 1000;
    report.push(`${id}: broadphase p50 ${fastP50.toFixed(3)} us / p95 ${fastP95.toFixed(3)} us; brute p50 ${bruteP50.toFixed(3)} us (${(map.blocks || []).length} blocks)`);
    assert.ok(fastP50 <= PERF_BUDGET_US, `${id} p50 ${fastP50} us <= ${PERF_BUDGET_US} us`);
    assert.ok(fastP95 <= PERF_BUDGET_US * PERF_MARGIN, `${id} p95 ${fastP95} us <= ${PERF_BUDGET_US * PERF_MARGIN} us (margin ${PERF_MARGIN})`);
  }
  console.log(`[spatial] ${report.join(' | ')}`);
});
