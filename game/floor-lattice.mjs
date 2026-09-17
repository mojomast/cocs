// Baked, triangle-exact floor lattice for the triangulated terrain meshes.
//
// `terrainSupportAt` linearly scans every terrain triangle for every query
// (~45-77 us on the large maps). This module rasterizes the post-stamp walkable
// triangles into a uniform grid keyed by the *triangle index*, then reproduces
// the mesh query exactly at lookup time by re-running the same barycentric
// interpolation `terrainSupportAt` uses. The grid only narrows the candidate
// set; it never approximates the surface (a bilinear height field diverges up
// to ~0.48 m on steep cells and is deliberately not used here).
//
// Determinism: the bake is a pure function of (terrain triangles, cell size,
// coverage bounds), and `latticeHash` folds the raw component bytes so a
// serialized/versioned lattice can be compared byte-for-byte.
//
// This module is additive: it does not edit core.mjs/terrain.mjs. Integration
// (and the cache-miss plan) lives in docs/M0-MIGRATION.md.

import {terrainSupportAt, terrainTriangles} from './terrain.mjs';

const EPSILON = 1e-9;
// Rasterized AABBs grow by this margin so a query point that terrainSupportAt
// accepts within its barycentric EPSILON but that sits a hair outside the raw
// triangle AABB still lands in a cell that registered the triangle.
const RASTER_MARGIN = 1e-6;
export const FLOOR_LATTICE_VERSION = 1;
export const DEFAULT_FLOOR_CELL = 1;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clampInt = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

// ---- deterministic hashing ------------------------------------------------

function fnvBytes(hash, array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let h = hash >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function fnvNumber(hash, value) {
  return fnvBytes(hash, Float64Array.of(Number.isFinite(value) ? value : 0));
}

/** Stable content hash of a baked lattice. Cached on the lattice object. */
export function latticeHash(lattice) {
  if (!lattice || typeof lattice !== 'object') throw new TypeError('Invalid floor lattice');
  if (typeof lattice.hash === 'string') return lattice.hash;
  let h = 0x811c9dc5;
  h = fnvNumber(h, lattice.cell);
  h = fnvNumber(h, lattice.cols);
  h = fnvNumber(h, lattice.rows);
  h = fnvNumber(h, lattice.bounds?.minX);
  h = fnvNumber(h, lattice.bounds?.minZ);
  h = fnvNumber(h, lattice.bounds?.maxX);
  h = fnvNumber(h, lattice.bounds?.maxZ);
  h = fnvBytes(h, lattice.cellStart);
  h = fnvBytes(h, lattice.cellTriangles);
  h = fnvBytes(h, lattice.triVerts);
  h = fnvBytes(h, lattice.triNormals);
  const hex = (`0000000${h.toString(16)}`).slice(-8);
  lattice.hash = `${FLOOR_LATTICE_VERSION}:${hex}`;
  return lattice.hash;
}

// ---- bake -----------------------------------------------------------------

function coverageBounds(triangles, options) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const triangle of triangles) {
    for (const v of triangle.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const hint = options?.bounds;
  if (hint && finite(hint.minX) && finite(hint.maxX) && finite(hint.minZ) && finite(hint.maxZ)) {
    minX = Math.min(minX, hint.minX);
    maxX = Math.max(maxX, hint.maxX);
    minZ = Math.min(minZ, hint.minZ);
    maxZ = Math.max(maxZ, hint.maxZ);
  }
  if (!Number.isFinite(minX)) { minX = 0; maxX = 0; minZ = 0; maxZ = 0; }
  return {minX, maxX, minZ, maxZ};
}

// Barycentric denominator shared by bake and lookup so the two cannot drift.
const denominatorOf = (ax, az, bx, bz, cx, cz) => (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);

/**
 * Rasterize the walkable terrain triangles into a Float64-backed lattice.
 * Only triangles `terrainSupportAt` could ever return are baked: `walkable`
 * surfaces with a positive-up normal. `maxSlope` is applied at lookup time so
 * one bake serves every slope budget.
 */
export function bakeFloorLattice(terrain, cell = DEFAULT_FLOOR_CELL, options = {}) {
  if (!terrain || typeof terrain !== 'object') throw new TypeError('Invalid terrain');
  if (!finite(cell) || cell <= 0) throw new TypeError('Invalid lattice cell');

  const source = terrainTriangles(terrain);
  const included = [];
  for (const triangle of source) {
    if (triangle.walkable === false) continue;
    const normal = triangle.normal;
    if (!(normal[1] > EPSILON)) continue;
    const [a, b, c] = triangle.vertices;
    if (Math.abs(denominatorOf(a[0], a[2], b[0], b[2], c[0], c[2])) <= EPSILON) continue;
    included.push(triangle);
  }

  const extent = coverageBounds(included, options);
  // One extra row/column keeps points that land exactly on the far edge inside
  // the grid, so lookup never rejects a coordinate the mesh would answer.
  const cols = Math.max(1, Math.ceil((extent.maxX - extent.minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((extent.maxZ - extent.minZ) / cell) + 1);
  const bounds = {minX: extent.minX, minZ: extent.minZ, maxX: extent.minX + cols * cell, maxZ: extent.minZ + rows * cell};

  const cells = Array.from({length: cols * rows}, () => []);
  const count = included.length;
  const triVerts = new Float64Array(count * 9);
  const triNormals = new Float64Array(count * 3);
  const surfaceIds = new Array(count);
  const materials = new Array(count);

  for (let ti = 0; ti < count; ti++) {
    const triangle = included[ti];
    const [a, b, c] = triangle.vertices;
    const base = ti * 9;
    triVerts[base] = a[0]; triVerts[base + 1] = a[1]; triVerts[base + 2] = a[2];
    triVerts[base + 3] = b[0]; triVerts[base + 4] = b[1]; triVerts[base + 5] = b[2];
    triVerts[base + 6] = c[0]; triVerts[base + 7] = c[1]; triVerts[base + 8] = c[2];
    const nb = ti * 3;
    triNormals[nb] = triangle.normal[0];
    triNormals[nb + 1] = triangle.normal[1];
    triNormals[nb + 2] = triangle.normal[2];
    surfaceIds[ti] = triangle.surfaceId;
    materials[ti] = triangle.material;

    const tminX = Math.min(a[0], b[0], c[0]), tmaxX = Math.max(a[0], b[0], c[0]);
    const tminZ = Math.min(a[2], b[2], c[2]), tmaxZ = Math.max(a[2], b[2], c[2]);
    const c0 = clampInt(Math.floor((tminX - RASTER_MARGIN - bounds.minX) / cell), 0, cols - 1);
    const c1 = clampInt(Math.floor((tmaxX + RASTER_MARGIN - bounds.minX) / cell), 0, cols - 1);
    const r0 = clampInt(Math.floor((tminZ - RASTER_MARGIN - bounds.minZ) / cell), 0, rows - 1);
    const r1 = clampInt(Math.floor((tmaxZ + RASTER_MARGIN - bounds.minZ) / cell), 0, rows - 1);
    for (let r = r0; r <= r1; r++) {
      const rowBase = r * cols;
      for (let c = c0; c <= c1; c++) cells[rowBase + c].push(ti);
    }
  }

  let total = 0;
  for (const bucket of cells) total += bucket.length;
  const cellStart = new Int32Array(cols * rows + 1);
  const cellTriangles = new Int32Array(total);
  let offset = 0;
  for (let i = 0; i < cells.length; i++) {
    cellStart[i] = offset;
    for (const ti of cells[i]) cellTriangles[offset++] = ti;
  }
  cellStart[cells.length] = offset;

  const lattice = {
    version: FLOOR_LATTICE_VERSION,
    cell,
    cols,
    rows,
    bounds,
    playBounds: options?.bounds ?? options?.playBounds ?? null,
    triangles: count,
    cellStart,
    cellTriangles,
    triVerts,
    triNormals,
    surfaceIds,
    materials,
    hash: null,
  };
  latticeHash(lattice);
  return lattice;
}

const latticeCache = new WeakMap();
const cacheKey = (cell, options) => {
  const b = options?.bounds;
  const boundsKey = b && finite(b.minX) ? `${b.minX},${b.maxX},${b.minZ},${b.maxZ}` : '';
  return `${cell}|${boundsKey}`;
};

/** Baked-lattice cache keyed by the (frozen) terrain object + cell/coverage. */
export function ensureFloorLattice(terrain, cell = DEFAULT_FLOOR_CELL, options = {}) {
  if (!terrain || typeof terrain !== 'object') throw new TypeError('Invalid terrain');
  let map = latticeCache.get(terrain);
  if (!map) { map = new Map(); latticeCache.set(terrain, map); }
  const key = cacheKey(cell, options);
  let lattice = map.get(key);
  if (!lattice) { lattice = bakeFloorLattice(terrain, cell, options); map.set(key, lattice); }
  return lattice;
}

/**
 * Drop cached lattices for a terrain. Generation-time stamps mutate a terrain
 * in place, so any later integration that calls `stampTerrainFloor` must
 * invalidate here (bake again after generation, never mid-stamp).
 */
export function invalidateFloorLattice(terrain) {
  if (terrain && typeof terrain === 'object') latticeCache.delete(terrain);
}

// ---- lookup ---------------------------------------------------------------

// One-entry memo for the slope budget: makeFloorQuery pins a single maxSlope,
// so this removes a Math.cos from every movement query without changing output.
let slopeInput = null;
let slopeCos = -Infinity;
const cosSlopeLimit = maxSlope => {
  if (maxSlope === Infinity) return -Infinity;
  if (maxSlope !== slopeInput) { slopeInput = maxSlope; slopeCos = Math.cos(maxSlope); }
  return slopeCos;
};

// Shared scan: identical arithmetic and filter order to terrainSupportAt.
function scanLattice(lattice, x, z, maxSlope, wantRecord) {
  const {cell, cols, rows, bounds, cellStart, cellTriangles, triVerts, triNormals} = lattice;
  if (x < bounds.minX || z < bounds.minZ) return null;
  const col = Math.floor((x - bounds.minX) / cell);
  const row = Math.floor((z - bounds.minZ) / cell);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  const bucket = row * cols + col;
  const start = cellStart[bucket], end = cellStart[bucket + 1];
  const cosLimit = cosSlopeLimit(maxSlope);
  let bestY = null, bestTri = -1;
  for (let p = start; p < end; p++) {
    const ti = cellTriangles[p], base = ti * 9;
    const ax = triVerts[base], ay = triVerts[base + 1], az = triVerts[base + 2];
    const bx = triVerts[base + 3], by = triVerts[base + 4], bz = triVerts[base + 5];
    const cx = triVerts[base + 6], cy = triVerts[base + 7], cz = triVerts[base + 8];
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) <= EPSILON) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
    const w = 1 - u - v;
    if (u < -EPSILON || v < -EPSILON || w < -EPSILON) continue;
    const ny = triNormals[ti * 3 + 1];
    if (ny <= EPSILON) continue;
    if (ny < cosLimit - EPSILON) continue;
    const y = u * ay + v * by + w * cy;
    if (bestY === null || y > bestY + EPSILON) { bestY = y; bestTri = ti; }
  }
  if (bestY === null) return null;
  if (!wantRecord) return bestY;
  const nb = bestTri * 3;
  return {y: bestY, normal: [triNormals[nb], triNormals[nb + 1], triNormals[nb + 2]], surfaceId: lattice.surfaceIds[bestTri], material: lattice.materials[bestTri]};
}

/** Full support record, byte-for-byte the shape terrainSupportAt returns. */
export function floorAtLattice(lattice, x, z, maxSlope = Infinity) {
  if (!lattice || typeof lattice !== 'object') throw new TypeError('Invalid floor lattice');
  if (!finite(x) || !finite(z) || (!finite(maxSlope) && maxSlope !== Infinity) || maxSlope < 0) throw new TypeError('Invalid support query');
  return scanLattice(lattice, x, z, maxSlope, true);
}

/** Allocation-free height-only query for the hot movement/nav paths. */
export function floorHeightAtLattice(lattice, x, z, maxSlope = Infinity) {
  if (!lattice || typeof lattice !== 'object') throw new TypeError('Invalid floor lattice');
  if (!finite(x) || !finite(z) || (!finite(maxSlope) && maxSlope !== Infinity) || maxSlope < 0) throw new TypeError('Invalid support query');
  return scanLattice(lattice, x, z, maxSlope, false);
}

// ---- integration facade ---------------------------------------------------

/**
 * Support query for an arena, mirroring `floorAt`'s terrain branch:
 * `floorAt(x,z,arena) === makeFloorQuery(arena)(x,z)?.y ?? null`.
 *
 * Maps without terrain resolve to `null`; maps without a baked lattice fall
 * back to `terrainSupportAt`. Call `query.bake()` to rasterize once (or pass
 * `{bake:true}`/`{lattice}`), and `query.source` reports which path is active.
 */
export function makeFloorQuery(arena, options = {}) {
  const terrain = arena?.terrain ?? null;
  const maxSlope = options.maxSlope ?? (terrain?.maxSlope ?? 0.9);
  if (!terrain) {
    const query = () => null;
    query.source = 'none';
    query.terrain = null;
    query.arena = arena ?? null;
    query.maxSlope = maxSlope;
    query.cell = options.cell ?? DEFAULT_FLOOR_CELL;
    query.playBounds = arena?.playBounds ?? arena?.bounds ?? null;
    query.lattice = null;
    query.bake = () => null;
    return query;
  }
  const cell = options.cell ?? DEFAULT_FLOOR_CELL;
  const playBounds = options.playBounds ?? arena.playBounds ?? arena.bounds ?? null;
  let lattice = options.lattice ?? null;
  if (!lattice && options.bake === true) lattice = ensureFloorLattice(terrain, cell, {bounds: playBounds});
  const query = (x, z) => (lattice ? floorAtLattice(lattice, x, z, maxSlope) : terrainSupportAt(x, z, terrain, maxSlope));
  query.source = lattice ? 'lattice' : 'terrain';
  query.terrain = terrain;
  query.arena = arena;
  query.maxSlope = maxSlope;
  query.cell = cell;
  query.playBounds = playBounds;
  query.lattice = lattice;
  query.bake = (opts = {}) => {
    lattice = ensureFloorLattice(terrain, opts.cell ?? cell, {bounds: opts.bounds ?? playBounds});
    query.lattice = lattice;
    query.cell = lattice.cell;
    query.source = 'lattice';
    return lattice;
  };
  return query;
}
