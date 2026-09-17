import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS} from './maps.mjs';
import {terrainSupportAt,terrainTriangles} from './terrain.mjs';
import {
  DEFAULT_FLOOR_CELL,
  FLOOR_LATTICE_VERSION,
  bakeFloorLattice,
  ensureFloorLattice,
  floorAtLattice,
  floorHeightAtLattice,
  invalidateFloorLattice,
  latticeHash,
  makeFloorQuery,
} from './floor-lattice.mjs';

const TERRAIN_MAPS = MAPS.filter(map => map.terrain);
const DEFAULT_BOUNDS = {minX: -13.55, maxX: 13.55, minZ: -13.55, maxZ: 13.55};
const boundsOf = arena => arena.bounds || DEFAULT_BOUNDS;
const slopeOf = arena => arena.terrain.maxSlope ?? 0.9;

function rng(seed) {
  let n = seed >>> 0;
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function assertSameSupport(map, lattice, x, z, slope, label) {
  const expected = terrainSupportAt(x, z, map.terrain, slope);
  const actual = floorAtLattice(lattice, x, z, slope);
  if (expected === null || actual === null) {
    assert.equal(actual, expected, `${map.id} ${label} (${x.toFixed(4)},${z.toFixed(4)}) null mismatch`);
    return;
  }
  assert.ok(Math.abs(expected.y - actual.y) <= 1e-6, `${map.id} ${label} (${x.toFixed(4)},${z.toFixed(4)}) y ${expected.y} vs ${actual.y}`);
  assert.ok(actual.normal[1] > 0, `${map.id} ${label} normal faces up`);
}

test('floorAtLattice is triangle-exact on every terrain map (grid + authored floors)', () => {
  const random = rng(90210);
  for (const map of TERRAIN_MAPS) {
    const slope = slopeOf(map);
    const lattice = ensureFloorLattice(map.terrain, DEFAULT_FLOOR_CELL, {bounds: map.bounds});
    const bounds = boundsOf(map);
    // Dense grid, including the exact bounds/cell boundaries.
    for (let i = 0; i <= 24; i++) {
      for (let j = 0; j <= 24; j++) {
        const x = bounds.minX + (i / 24) * (bounds.maxX - bounds.minX);
        const z = bounds.minZ + (j / 24) * (bounds.maxZ - bounds.minZ);
        assertSameSupport(map, lattice, x, z, slope, 'grid');
      }
    }
    // Authored/stamped triangles: random barycentric points inside them. Maps
    // that only carry generated terrain fall back to sampling every triangle.
    const triangles = terrainTriangles(map.terrain);
    const authored = triangles.filter(t => !String(t.surfaceId ?? '').startsWith('terrain'));
    const pool = authored.length ? authored : triangles;
    for (let i = 0; i < 120; i++) {
      const t = pool[Math.floor(random() * pool.length)];
      let u = random(), v = random();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;
      const [a, b, c] = t.vertices;
      const x = u * a[0] + v * b[0] + w * c[0];
      const z = u * a[2] + v * b[2] + w * c[2];
      assertSameSupport(map, lattice, x, z, slope, 'authored');
    }
  }
});

test('bake is stable across cell sizes and maps without terrain resolve to null', () => {
  for (const map of TERRAIN_MAPS) {
    const slope = slopeOf(map);
    const bounds = boundsOf(map);
    for (const cell of [0.5, 2, 3]) {
      const lattice = bakeFloorLattice(map.terrain, cell, {bounds: map.bounds});
      for (let i = 0; i < 40; i++) {
        const x = bounds.minX + (i / 39) * (bounds.maxX - bounds.minX);
        const z = bounds.minZ + (((i * 7) % 40) / 39) * (bounds.maxZ - bounds.minZ);
        assertSameSupport(map, lattice, x, z, slope, `cell ${cell}`);
      }
    }
  }
  const plain = MAPS.find(m => !m.terrain);
  const query = makeFloorQuery(plain);
  assert.equal(query.source, 'none');
  assert.equal(query(0, 0), null);
  assert.equal(query.bake(), null);
  assert.throws(() => floorAtLattice(null, 0, 0));
  assert.throws(() => floorAtLattice(bakeFloorLattice(TERRAIN_MAPS[0].terrain), NaN, 0));
});

test('slope filtering and step-up/landing thresholds match the mesh exactly', () => {
  // Two flat shelves 0.3 m apart, plus a ramp that rises 0.25/0.30/0.35 m over
  // 1 m. The movement code treats a floor within .25 m as a step up and within
  // .35 m as a landing; the lattice must not shift either boundary.
  const terrain = {
    surfaces: [
      {id: 'low', material: 'grass', vertices: [[0, 0, 0], [0, 0, 4], [4, 0, 4], [4, 0, 0]]},
      {id: 'step', material: 'stone', walkable: true, vertices: [[6, 0.3, 0], [6, 0.3, 4], [10, 0.3, 4], [10, 0.3, 0]]},
      {id: 'ramp-25', material: 'dirt', vertices: [[12, 0, 0], [12, 0, 4], [13, 0.25, 4], [13, 0.25, 0]]},
      {id: 'ramp-30', material: 'dirt', vertices: [[15, 0, 0], [15, 0, 4], [16, 0.3, 4], [16, 0.3, 0]]},
      {id: 'ramp-35', material: 'dirt', vertices: [[18, 0, 0], [18, 0, 4], [19, 0.35, 4], [19, 0.35, 0]]},
    ],
  };
  const lattice = bakeFloorLattice(terrain, 0.5, {bounds: {minX: -1, maxX: 21, minZ: -1, maxZ: 5}});
  for (const slope of [0.2, 0.85, Math.PI / 2, Infinity]) {
    for (let x = -0.5; x <= 20.5; x += 0.25) {
      for (const z of [0, 0.25, 1, 2, 3.5, 4]) {
        const expected = terrainSupportAt(x, z, terrain, slope);
        const actual = floorAtLattice(lattice, x, z, slope);
        if (expected === null || actual === null) { assert.equal(actual, expected); continue; }
        assert.ok(Math.abs(expected.y - actual.y) <= 1e-6, `slope ${slope} (${x},${z})`);
      }
    }
  }
  assert.equal(floorAtLattice(lattice, 0.5, 2, Infinity).y, 0);
  assert.equal(floorAtLattice(lattice, 8, 2, Infinity).y, 0.3);
  assert.ok(Math.abs(floorAtLattice(lattice, 12.5, 2, Infinity).y - 0.125) <= 1e-6);
  assert.ok(Math.abs(floorAtLattice(lattice, 15.5, 2, Infinity).y - 0.15) <= 1e-6);
  assert.ok(Math.abs(floorAtLattice(lattice, 18.5, 2, Infinity).y - 0.175) <= 1e-6);
});

test('makeFloorQuery falls back to terrainSupportAt, then switches to the baked lattice', () => {
  const map = MAPS.find(m => m.terrain);
  const query = makeFloorQuery(map);
  const eager = makeFloorQuery(map, {bake: true, cell: query.cell});
  assert.equal(query.source, 'terrain');
  assert.equal(eager.source, 'lattice');
  const bounds = boundsOf(map);
  for (let i = 0; i < 25; i++) {
    const x = bounds.minX + (i / 24) * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + (i / 24) * (bounds.maxZ - bounds.minZ);
    const expected = terrainSupportAt(x, z, map.terrain, query.maxSlope);
    const fallback = query(x, z);
    if (expected === null || fallback === null) assert.equal(fallback, expected);
    else assert.ok(Math.abs(fallback.y - expected.y) <= 1e-6);
    assert.equal(eager(x, z)?.y ?? null, fallback?.y ?? null);
  }
  const lattice = query.bake();
  assert.equal(query.source, 'lattice');
  assert.equal(query.lattice, lattice);
  for (let i = 0; i < 25; i++) {
    const x = bounds.minX + (i / 24) * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + (i / 24) * (bounds.maxZ - bounds.minZ);
    assert.ok(Math.abs((eager(x, z)?.y ?? 0) - (query(x, z)?.y ?? 0)) <= 1e-6);
  }
});

test('latticeHash is stable, cached and content-derived', () => {
  const map = MAPS.find(m => m.id === 'titan-valley') || TERRAIN_MAPS[0];
  const first = bakeFloorLattice(map.terrain, 1, {bounds: map.bounds});
  const second = bakeFloorLattice(map.terrain, 1, {bounds: map.bounds});
  assert.equal(first.hash, second.hash);
  assert.equal(latticeHash(first), first.hash);
  assert.match(first.hash, new RegExp(`^${FLOOR_LATTICE_VERSION}:`));
  const clone = JSON.parse(JSON.stringify(map.terrain));
  const cloned = bakeFloorLattice(clone, 1, {bounds: map.bounds});
  assert.equal(cloned.hash, first.hash, 'content-identical terrain hashes identically');
  const coarse = bakeFloorLattice(map.terrain, 2, {bounds: map.bounds});
  assert.notEqual(coarse.hash, first.hash, 'cell size participates in the hash');
  assert.equal(ensureFloorLattice(map.terrain, 1, {bounds: map.bounds}), ensureFloorLattice(map.terrain, 1, {bounds: map.bounds}));
  const before = ensureFloorLattice(map.terrain, 1, {bounds: map.bounds});
  invalidateFloorLattice(map.terrain);
  const after = ensureFloorLattice(map.terrain, 1, {bounds: map.bounds});
  assert.notEqual(after, before, 'invalidate drops the cached bake');
  assert.equal(after.hash, before.hash, 're-baked lattice has identical content');
});

// ---- perf microbenchmark --------------------------------------------------

const PERF_BUDGET_US = 0.5; // floorAt p95 target
const PERF_MARGIN = 4; // generous CI margin; measured numbers are reported
const REFERENCE_MAPS = ['catacombs', 'convoy-line', 'riverbend', 'titan-valley', 'frost-gate'];

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

test('reference-map floorAt p95 stays within the 0.5 us budget', () => {
  const random = rng(4242);
  const report = [];
  for (const id of REFERENCE_MAPS) {
    const map = MAPS.find(m => m.id === id);
    assert.ok(map?.terrain, `${id} has terrain`);
    const slope = slopeOf(map);
    const lattice = bakeFloorLattice(map.terrain, 1, {bounds: map.bounds});
    const bounds = boundsOf(map);
    const points = Array.from({length: 120000}, () => [
      bounds.minX + random() * (bounds.maxX - bounds.minX),
      bounds.minZ + random() * (bounds.maxZ - bounds.minZ),
    ]);
    for (let i = 0; i < 20000; i++) floorHeightAtLattice(lattice, points[i][0], points[i][1], slope);
    const fast = timePerCall(i => floorHeightAtLattice(lattice, points[i][0], points[i][1], slope), points.length);
    const brutePoints = points.slice(0, 2000);
    for (let i = 0; i < 200; i++) terrainSupportAt(brutePoints[i][0], brutePoints[i][1], map.terrain, slope);
    const brute = timePerCall(i => terrainSupportAt(brutePoints[i][0], brutePoints[i][1], map.terrain, slope), brutePoints.length);
    const fastP50 = percentile(fast, 0.5) / 1000, fastP95 = percentile(fast, 0.95) / 1000;
    const bruteP50 = percentile(brute, 0.5) / 1000;
    report.push(`${id}: lattice p50 ${fastP50.toFixed(3)} us / p95 ${fastP95.toFixed(3)} us; mesh p50 ${bruteP50.toFixed(2)} us`);
    assert.ok(fastP50 <= PERF_BUDGET_US, `${id} lattice p50 ${fastP50} us <= ${PERF_BUDGET_US} us`);
    assert.ok(fastP95 <= PERF_BUDGET_US * PERF_MARGIN, `${id} lattice p95 ${fastP95} us <= ${PERF_BUDGET_US * PERF_MARGIN} us (margin ${PERF_MARGIN})`);
    assert.ok(bruteP50 > fastP50 * 5, `${id} lattice is at least 5x faster than the mesh scan`);
  }
  console.log(`[floor-lattice] ${report.join(' | ')}`);
});
