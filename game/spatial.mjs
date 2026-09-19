// Static AABB broadphase for arena collision blocks.
//
// `obstructed` walks every block and `rayWorld` walks every block plus every
// terrain/wall triangle. Arena block lists are immutable map templates, so a
// cheap uniform grid keyed by the arena object (a WeakMap, because MAPS is
// frozen and cannot carry a cache property) narrows both queries to a handful
// of candidates. The exact box tests stay where they are: the grid only
// decides which blocks are worth testing, so `kind === 'deck'` handling, the
// next-gen invisible collision proxies and the y-range checks are unchanged.
//
// `makeBlockIndex` caches per arena. `candidates(x, z, r)` is a superset of the
// blocks whose XZ AABB is within `r` of the point; `rayCandidates(o, d, max)`
// is a superset of the blocks a world ray can hit. Callers apply the same
// predicate core.mjs already uses, so behaviour cannot drift.
//
// This module is additive: it does not edit core.mjs. Integration lives in
// docs/M0-MIGRATION.md.

import {RULES} from './data.mjs';
import {ensureFloorLattice, latticeHash} from './floor-lattice.mjs';
import {terrainWallSegments} from './terrain.mjs';

const EPSILON = 1e-9;
const MIN_CELL = 1;
const indexCache = new WeakMap();

// Nav graphs are keyed by this version in addition to the map id, generation
// seed and collision hash; bump it whenever the node/edge construction changes.
export const NAV_BAKE_VERSION = 1;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clampInt = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

const fnvNumber = (hash, value) => {
  const bytes = Float64Array.of(Number.isFinite(value) ? value : 0);
  let h = hash >>> 0;
  const view = new Uint8Array(bytes.buffer);
  for (let i = 0; i < view.length; i++) { h ^= view[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
};
const fnvString = (hash, value) => {
  let h = hash >>> 0;
  const text = String(value);
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
};
const hex = h => (`0000000${(h >>> 0).toString(16)}`).slice(-8);

function gridBounds(arena, blocks) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const hint = arena?.playBounds || arena?.bounds;
  if (hint && finite(hint.minX) && finite(hint.maxX) && finite(hint.minZ) && finite(hint.maxZ)) {
    minX = hint.minX; maxX = hint.maxX; minZ = hint.minZ; maxZ = hint.maxZ;
  }
  for (const block of blocks) {
    const hw = (Number.isFinite(block.w) ? block.w : 0) / 2;
    const hd = (Number.isFinite(block.d) ? block.d : 0) / 2;
    if (block.x - hw < minX) minX = block.x - hw;
    if (block.x + hw > maxX) maxX = block.x + hw;
    if (block.z - hd < minZ) minZ = block.z - hd;
    if (block.z + hd > maxZ) maxZ = block.z + hd;
  }
  if (!Number.isFinite(minX)) { minX = 0; maxX = 0; minZ = 0; maxZ = 0; }
  return {minX, maxX, minZ, maxZ};
}

/**
 * Build (or fetch) the broadphase for an arena. Cell size is the measured max
 * half-extent, so the largest block spans at most two cells per axis (a loose
 * grid); everything smaller packs densely.
 */
export function makeBlockIndex(arena) {
  if (!arena || typeof arena !== 'object') throw new TypeError('Invalid arena');
  const cached = indexCache.get(arena);
  const blocks = Array.isArray(arena.blocks) ? arena.blocks : [];
  // Deep-frozen map templates (MAPS via map-schema.freeze) are immutable, so
  // their grid is reused forever. A mutable arena (tests, tooling) is reindexed
  // when its block list identity or length changes; an in-place field edit must
  // call invalidateBlockIndex (the documented runtime-arena contract).
  if (cached && (Object.isFrozen(arena) || (cached.blocksRef === blocks && cached.blocksLength === blocks.length))) return cached;

  let maxHalf = 0;
  for (const block of blocks) maxHalf = Math.max(maxHalf, (block.w || 0) / 2, (block.d || 0) / 2);
  const cell = Math.max(maxHalf, MIN_CELL);
  const box = gridBounds(arena, blocks);
  const minX = box.minX - cell, minZ = box.minZ - cell;
  const cols = Math.max(1, Math.ceil((box.maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((box.maxZ - minZ) / cell) + 1);
  const cells = new Array(cols * rows);

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const hw = (block.w || 0) / 2, hd = (block.d || 0) / 2;
    const c0 = clampInt(Math.floor((block.x - hw - minX) / cell), 0, cols - 1);
    const c1 = clampInt(Math.floor((block.x + hw - minX) / cell), 0, cols - 1);
    const r0 = clampInt(Math.floor((block.z - hd - minZ) / cell), 0, rows - 1);
    const r1 = clampInt(Math.floor((block.z + hd - minZ) / cell), 0, rows - 1);
    for (let r = r0; r <= r1; r++) {
      const base = r * cols;
      for (let c = c0; c <= c1; c++) {
        const key = base + c;
        if (!cells[key]) cells[key] = [];
        cells[key].push(bi);
      }
    }
  }

  const state = {
    arena,
    blocks,
    cell,
    bounds: {minX, minZ, maxX: minX + cols * cell, maxZ: minZ + rows * cell},
    cols,
    rows,
    cells,
    serial: 0,
    seen: new Int32Array(blocks.length),
    blockBvh: null,
    blockBvhRef: null,
  };
  const rayBvh = () => {
    // In-place block edits on a mutable arena must go through
    // invalidateBlockIndex, which drops this whole state; a frozen template is
    // baked once. Identity/length changes already rebuild via the guard above.
    if (state.blockBvh && state.blockBvhRef === blocks) return state.blockBvh;
    state.blockBvh = bakeBlockBvh(blocks);
    state.blockBvhRef = blocks;
    return state.blockBvh;
  };
  const index = {
    arena,
    blocks,
    blocksRef: blocks,
    blocksLength: blocks.length,
    cell,
    bounds: state.bounds,
    cols,
    rows,
    candidates: (x, z, r) => candidateBlocks(state, x, z, r),
    rayCandidates: (origin, direction, max) => rayCandidateBlocks(state, origin, direction, max),
    rayBvh,
    rayBlockHit: (origin, direction, max) => rayBlockHit(rayBvh(), origin, direction, max),
  };
  indexCache.set(arena, index);
  return index;
}

// Collect the union of cells overlapping [x-r, x+r] x [z-r, z+r].
function candidateBlocks(state, x, z, r) {
  if (!finite(x) || !finite(z) || !finite(r) || r < 0) throw new TypeError('Invalid candidate query');
  const {cell, cols, rows, cells, blocks, bounds} = state;
  let c0 = Math.floor((x - r - bounds.minX) / cell);
  let c1 = Math.floor((x + r - bounds.minX) / cell);
  let r0 = Math.floor((z - r - bounds.minZ) / cell);
  let r1 = Math.floor((z + r - bounds.minZ) / cell);
  if (c1 < 0 || c0 > cols - 1 || r1 < 0 || r0 > rows - 1) return [];
  c0 = clampInt(c0, 0, cols - 1); c1 = clampInt(c1, 0, cols - 1);
  r0 = clampInt(r0, 0, rows - 1); r1 = clampInt(r1, 0, rows - 1);
  const serial = ++state.serial;
  const {seen} = state;
  const out = [];
  for (let row = r0; row <= r1; row++) {
    const base = row * cols;
    for (let col = c0; col <= c1; col++) {
      const bucket = cells[base + col];
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const bi = bucket[i];
        if (seen[bi] !== serial) { seen[bi] = serial; out.push(blocks[bi]); }
      }
    }
  }
  return out;
}

// Clip the XZ segment o + d*t, t in [t0, t1], to the grid rectangle.
function clipToGrid(state, ox, oz, dx, dz, t0, t1) {
  const {bounds} = state;
  let lo = t0, hi = t1;
  const axes = [[ox, dx, bounds.minX, bounds.maxX], [oz, dz, bounds.minZ, bounds.maxZ]];
  for (const [p, dir, mn, mx] of axes) {
    if (Math.abs(dir) <= EPSILON) { if (p < mn || p > mx) return null; continue; }
    let ta = (mn - p) / dir, tb = (mx - p) / dir;
    if (ta > tb) { const swap = ta; ta = tb; tb = swap; }
    if (ta > lo) lo = ta;
    if (tb < hi) hi = tb;
    if (lo > hi) return null;
  }
  return [lo, hi];
}

function rayCandidateBlocks(state, origin, direction, max) {
  if (!origin || !direction) throw new TypeError('Invalid ray query');
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const dx = direction.x, dy = direction.y, dz = direction.z;
  if (![ox, oy, oz, dx, dy, dz].every(finite)) throw new TypeError('Invalid ray query');
  if ((!Number.isFinite(max) && max !== Infinity) || max < 0) throw new TypeError('Invalid ray query');
  const blocks = state.blocks;
  if (!blocks.length) return [];
  const t1 = Number.isFinite(max) ? max : Infinity;
  const {cell, cols, rows, cells, bounds} = state;
  const serial = ++state.serial;
  const {seen} = state;
  const out = [];

  if (dx * dx + dz * dz <= EPSILON) {
    // No horizontal travel: only blocks sharing the origin column can be hit.
    const col = Math.floor((ox - bounds.minX) / cell), row = Math.floor((oz - bounds.minZ) / cell);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return [];
    const bucket = cells[row * cols + col];
    if (bucket) for (const bi of bucket) { if (seen[bi] !== serial) { seen[bi] = serial; out.push(blocks[bi]); } }
    return out;
  }

  const clipped = clipToGrid(state, ox, oz, dx, dz, 0, t1);
  if (!clipped) return [];
  const [lo, hi] = clipped;
  if (hi < lo) return [];

  // Amanatides-Woo 2D traversal over the XZ projection of the ray.
  const sx = ox + dx * lo, sz = oz + dz * lo;
  let cx = Math.floor((sx - bounds.minX) / cell);
  let cz = Math.floor((sz - bounds.minZ) / cell);
  cx = clampInt(cx, 0, cols - 1); cz = clampInt(cz, 0, rows - 1);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(cell / dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(cell / dz) : Infinity;
  let tMaxX = stepX > 0 ? ((cx + 1) * cell + bounds.minX - sx) / dx
    : stepX < 0 ? (cx * cell + bounds.minX - sx) / dx : Infinity;
  let tMaxZ = stepZ > 0 ? ((cz + 1) * cell + bounds.minZ - sz) / dz
    : stepZ < 0 ? (cz * cell + bounds.minZ - sz) / dz : Infinity;
  const span = hi - lo;

  const gather = () => {
    if (cx < 0 || cx >= cols || cz < 0 || cz >= rows) return;
    const bucket = cells[cz * cols + cx];
    if (!bucket) return;
    for (let i = 0; i < bucket.length; i++) {
      const bi = bucket[i];
      if (seen[bi] !== serial) { seen[bi] = serial; out.push(blocks[bi]); }
    }
  };
  gather();
  let guard = cols + rows + 4;
  while (guard-- > 0) {
    if (tMaxX < tMaxZ) {
      if (tMaxX > span) break;
      cx += stepX; tMaxX += tDeltaX;
    } else {
      if (tMaxZ > span) break;
      cz += stepZ; tMaxZ += tDeltaZ;
    }
    if (cx < 0 || cx >= cols || cz < 0 || cz >= rows) break;
    gather();
  }
  return out;
}

// ---- block ray BVH --------------------------------------------------------
//
// The uniform grid above narrows a world ray to a superset of blocks, but on a
// long ray across a dense map it still hands `boxHit` dozens of candidates. A
// deterministic median-split BVH over the static block AABBs prunes the tree by
// the current nearest hit instead, so `rayWorld` tests only the handful of
// boxes the ray actually reaches. The traversal returns the *same* nearest
// entry distance as the linear `min(boxHit)` scan: node AABBs are conservative
// hulls of their contents, the leaf test runs the identical box arithmetic
// (core.boxHit, mirrored below so spatial.mjs stays independent of core), and
// ties are distance-equal so the numeric result cannot drift.
//
// Build determinism mirrors terrain-bvh.mjs: median split on the widest centroid
// axis, original block index as the tie-break, so an arena always bakes the
// same tree. The BVH lives on the same cached index as the grid, so the
// documented `invalidateBlockIndex` contract (identity/length change on mutable
// arenas, frozen templates cached forever) covers both structures.

export const BLOCK_BVH_VERSION = 1;
export const DEFAULT_BLOCK_BVH_LEAF = 8;

const RAY_EPS = 1e-12;
const BOUND_PAD = 1e-7;
const MAX_BLOCK_STACK = 256;

// Bit-for-bit the arithmetic of core.mjs boxHit, unrolled over x, y, z. Kept
// local so the block semantics have one home and core's ray path can delegate.
function boxHitDistance(o, d, b, max) {
  let lo = 0, hi = max;
  const wx = b.w / 2, dz = b.d / 2;
  // x
  if (Math.abs(d.x) < 1e-8) { if (o.x < b.x - wx || o.x > b.x + wx) return null; }
  else { let t1 = (b.x - wx - o.x) / d.x, t2 = (b.x + wx - o.x) / d.x; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } lo = Math.max(lo, t1); hi = Math.min(hi, t2); if (lo > hi) return null; }
  // y (core's boxHit centres at b.h/2 with half-extent b.h/2, i.e. [0, b.h])
  if (Math.abs(d.y) < 1e-8) { if (o.y < 0 || o.y > b.h) return null; }
  else { let t1 = (0 - o.y) / d.y, t2 = (b.h - o.y) / d.y; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } lo = Math.max(lo, t1); hi = Math.min(hi, t2); if (lo > hi) return null; }
  // z
  if (Math.abs(d.z) < 1e-8) { if (o.z < b.z - dz || o.z > b.z + dz) return null; }
  else { let t1 = (b.z - dz - o.z) / d.z, t2 = (b.z + dz - o.z) / d.z; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } lo = Math.max(lo, t1); hi = Math.min(hi, t2); if (lo > hi) return null; }
  return lo;
}

/** Bake a block-AABB BVH. Pure; use `ensureBlockBvh` on the hot path. */
export function bakeBlockBvh(blocks, options = {}) {
  if (!Array.isArray(blocks)) throw new TypeError('Invalid block list');
  const leafSize = Math.max(1, Math.floor(options.leafSize ?? DEFAULT_BLOCK_BVH_LEAF));
  const count = blocks.length;
  const box = new Float64Array(count * 6);
  const centroid = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const b = blocks[i] || {};
    const w = Number.isFinite(b.w) ? b.w : 0, d = Number.isFinite(b.d) ? b.d : 0, h = Number.isFinite(b.h) ? b.h : 0;
    const x = Number.isFinite(b.x) ? b.x : 0, z = Number.isFinite(b.z) ? b.z : 0;
    const minX = x - w / 2, maxX = x + w / 2, minY = Math.min(0, h), maxY = Math.max(0, h), minZ = z - d / 2, maxZ = z + d / 2;
    const bb = i * 6;
    box[bb] = minX; box[bb + 1] = minY; box[bb + 2] = minZ; box[bb + 3] = maxX; box[bb + 4] = maxY; box[bb + 5] = maxZ;
    const cb = i * 3;
    centroid[cb] = (minX + maxX) / 2; centroid[cb + 1] = (minY + maxY) / 2; centroid[cb + 2] = (minZ + maxZ) / 2;
  }
  const order = new Int32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  const nodeBounds = [], nodeLeft = [], nodeRight = [], nodeStart = [], nodeCount = [];
  const addNode = (minX, minY, minZ, maxX, maxY, maxZ, left, right, start, count2) => {
    nodeBounds.push(minX - BOUND_PAD, minY - BOUND_PAD, minZ - BOUND_PAD, maxX + BOUND_PAD, maxY + BOUND_PAD, maxZ + BOUND_PAD);
    nodeLeft.push(left); nodeRight.push(right); nodeStart.push(start); nodeCount.push(count2);
    return nodeLeft.length - 1;
  };
  const buildRange = (lo, hi) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity, cMinZ = Infinity, cMaxZ = -Infinity;
    for (let p = lo; p < hi; p++) {
      const i = order[p], bb = i * 6;
      if (box[bb] < minX) minX = box[bb]; if (box[bb + 3] > maxX) maxX = box[bb + 3];
      if (box[bb + 1] < minY) minY = box[bb + 1]; if (box[bb + 4] > maxY) maxY = box[bb + 4];
      if (box[bb + 2] < minZ) minZ = box[bb + 2]; if (box[bb + 5] > maxZ) maxZ = box[bb + 5];
      const cb = i * 3;
      if (centroid[cb] < cMinX) cMinX = centroid[cb]; if (centroid[cb] > cMaxX) cMaxX = centroid[cb];
      if (centroid[cb + 1] < cMinY) cMinY = centroid[cb + 1]; if (centroid[cb + 1] > cMaxY) cMaxY = centroid[cb + 1];
      if (centroid[cb + 2] < cMinZ) cMinZ = centroid[cb + 2]; if (centroid[cb + 2] > cMaxZ) cMaxZ = centroid[cb + 2];
    }
    const span = Math.max(cMaxX - cMinX, cMaxY - cMinY, cMaxZ - cMinZ);
    const rangeCount = hi - lo;
    if (rangeCount <= leafSize || !(span > 1e-12)) return addNode(minX, minY, minZ, maxX, maxY, maxZ, -1, -1, lo, rangeCount);
    const ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ;
    const axis = ey > ex && ey >= ez ? 1 : ez > ex ? 2 : 0;
    order.subarray(lo, hi).sort((p, q) => {
      const diff = centroid[p * 3 + axis] - centroid[q * 3 + axis];
      return diff !== 0 ? diff : p - q;
    });
    const mid = (lo + hi) >> 1;
    const left = buildRange(lo, mid);
    const right = buildRange(mid, hi);
    return addNode(minX, minY, minZ, maxX, maxY, maxZ, left, right, -1, -1);
  };
  const root = count > 0 ? buildRange(0, count) : -1;
  return {
    version: BLOCK_BVH_VERSION,
    leafSize,
    blocks,
    count,
    root,
    nodeBounds: Float64Array.from(nodeBounds),
    nodeLeft: Int32Array.from(nodeLeft),
    nodeRight: Int32Array.from(nodeRight),
    nodeStart: Int32Array.from(nodeStart),
    nodeCount: Int32Array.from(nodeCount),
    order,
  };
}

// Slab entry distance to one node, or -1 on miss. Conservative (RAY_EPS is
// tighter than boxHit's 1e-8 parallel threshold) so it can only fail to prune.
function blockNodeEntry(bvh, index, ox, oy, oz, dx, dy, dz, maxT) {
  const bounds = bvh.nodeBounds, base = index * 6;
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < RAY_EPS) { if (ox < bounds[base] || ox > bounds[base + 3]) return -1; }
  else { const inv = 1 / dx; let t1 = (bounds[base] - ox) * inv, t2 = (bounds[base + 3] - ox) * inv; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(dy) < RAY_EPS) { if (oy < bounds[base + 1] || oy > bounds[base + 4]) return -1; }
  else { const inv = 1 / dy; let t1 = (bounds[base + 1] - oy) * inv, t2 = (bounds[base + 4] - oy) * inv; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(dz) < RAY_EPS) { if (oz < bounds[base + 2] || oz > bounds[base + 5]) return -1; }
  else { const inv = 1 / dz; let t1 = (bounds[base + 2] - oz) * inv, t2 = (bounds[base + 5] - oz) * inv; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  return tmin;
}

const blockStack = new Int32Array(MAX_BLOCK_STACK);
const blockStackEntry = new Float64Array(MAX_BLOCK_STACK);

/**
 * Nearest block entry distance for the ray, exactly equal to
 * `min(boxHit(o,d,b,max))` over the arena's blocks. Returns `max` when nothing
 * is hit (the caller combines it with terrain by strict `<`, so a tie keeps the
 * block result, matching the linear scan).
 */
export function rayBlockHit(bvh, origin, direction, max = Infinity) {
  if (!bvh || typeof bvh !== 'object') throw new TypeError('Invalid block bvh');
  if (!origin || !direction) throw new TypeError('Invalid ray query');
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const dx = direction.x, dy = direction.y, dz = direction.z;
  if (![ox, oy, oz, dx, dy, dz].every(finite)) throw new TypeError('Invalid ray query');
  if ((!Number.isFinite(max) && max !== Infinity) || max < 0) throw new TypeError('Invalid ray query');
  let best = max;
  if (bvh.root < 0) return best;
  const rootEntry = blockNodeEntry(bvh, bvh.root, ox, oy, oz, dx, dy, dz, max);
  if (rootEntry < 0) return best;
  blockStack[0] = bvh.root; blockStackEntry[0] = rootEntry;
  let sp = 1;
  const blocks = bvh.blocks;
  while (sp > 0) {
    --sp;
    const node = blockStack[sp];
    const leafCount = bvh.nodeCount[node];
    if (leafCount >= 0) {
      const start = bvh.nodeStart[node];
      for (let p = start; p < start + leafCount; p++) {
        const t = boxHitDistance(origin, direction, blocks[bvh.order[p]], best);
        if (t !== null && t < best) best = t;
      }
      continue;
    }
    const left = bvh.nodeLeft[node], right = bvh.nodeRight[node];
    const leftEntry = blockNodeEntry(bvh, left, ox, oy, oz, dx, dy, dz, best);
    const rightEntry = blockNodeEntry(bvh, right, ox, oy, oz, dx, dy, dz, best);
    if (leftEntry >= 0 && rightEntry >= 0) {
      if (sp + 2 > MAX_BLOCK_STACK) return best; // balanced tree: unreachable
      if (leftEntry < rightEntry) { blockStack[sp] = right; blockStackEntry[sp] = rightEntry; sp++; blockStack[sp] = left; blockStackEntry[sp] = leftEntry; sp++; }
      else { blockStack[sp] = left; blockStackEntry[sp] = leftEntry; sp++; blockStack[sp] = right; blockStackEntry[sp] = rightEntry; sp++; }
    } else if (leftEntry >= 0) { blockStack[sp] = left; blockStackEntry[sp] = leftEntry; sp++; }
    else if (rightEntry >= 0) { blockStack[sp] = right; blockStackEntry[sp] = rightEntry; sp++; }
  }
  return best;
}

/** Stable content hash of a baked block BVH (determinism / cache-key tests). */
export function blockBvhHash(bvh) {
  if (!bvh || typeof bvh !== 'object') throw new TypeError('Invalid block bvh');
  if (typeof bvh.hash === 'string') return bvh.hash;
  let h = 0x811c9dc5;
  const fold = array => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  };
  fold(bvh.nodeBounds); fold(bvh.nodeLeft); fold(bvh.nodeRight); fold(bvh.nodeStart); fold(bvh.nodeCount); fold(bvh.order);
  bvh.hash = `${BLOCK_BVH_VERSION}:${hex(h)}`;
  return bvh.hash;
}

// ---- top-level convenience + integration helpers --------------------------

export function candidates(arena, x, z, r) { return makeBlockIndex(arena).candidates(x, z, r); }
export function rayCandidates(arena, origin, direction, max) { return makeBlockIndex(arena).rayCandidates(origin, direction, max); }
export function rayWorldBlockHit(arena, origin, direction, max = Infinity) { return makeBlockIndex(arena).rayBlockHit(origin, direction, max); }

/**
 * The block half of core.obstructed, using the broadphase. Exact same
 * predicate: strict XZ overlap, feet below the solid top, head above its base.
 */
export function blockObstructed(arena, x, y, z, r = RULES.radius) {
  const list = makeBlockIndex(arena).candidates(x, z, r);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r && y < b.h - 1e-6 && y + RULES.height > 0) return true;
  }
  return false;
}

/**
 * The block half of supportAt (`kind !== 'deck'`), using the broadphase.
 * Returns the highest solid top at (x, z) within the actor radius, or null.
 */
export function blockSupportTop(arena, x, z, radius = RULES.radius) {
  const list = makeBlockIndex(arena).candidates(x, z, radius);
  let top = null;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.kind === 'deck') continue;
    if (Math.abs(x - b.x) <= b.w / 2 + radius && Math.abs(z - b.z) <= b.d / 2 + radius) top = top === null || b.h > top ? b.h : top;
  }
  return top;
}

/** Deterministic content hash of an arena's static block list. */
export function blockHash(arena) {
  const blocks = Array.isArray(arena?.blocks) ? arena.blocks : [];
  let h = 0x811c9dc5;
  h = fnvNumber(h, blocks.length);
  for (const block of blocks) {
    h = fnvNumber(h, block.x); h = fnvNumber(h, block.z);
    h = fnvNumber(h, block.w); h = fnvNumber(h, block.d); h = fnvNumber(h, block.h);
    h = fnvString(h, block.kind);
  }
  return hex(h);
}

/**
 * Collision-content signature for nav serialization: floors (baked lattice),
 * cliff/wall segments and static blocks. The nav cache key is
 * `(mapId, generationSeed, collisionHash(arena), NAV_BAKE_VERSION)`.
 */
export function collisionHash(arena) {
  if (!arena || typeof arena !== 'object') throw new TypeError('Invalid arena');
  let h = 0x811c9dc5;
  h = fnvString(h, blockHash(arena));
  if (arena.terrain) {
    const bounds = arena.playBounds || arena.bounds;
    const lattice = ensureFloorLattice(arena.terrain, 1, bounds ? {bounds} : {});
    h = fnvString(h, latticeHash(lattice));
    h = fnvNumber(h, arena.terrain.maxSlope ?? 0.9);
    for (const segment of terrainWallSegments(arena.terrain)) {
      h = fnvNumber(h, segment.a.x); h = fnvNumber(h, segment.a.y); h = fnvNumber(h, segment.a.z);
      h = fnvNumber(h, segment.b.x); h = fnvNumber(h, segment.b.y); h = fnvNumber(h, segment.b.z);
    }
  }
  return hex(h);
}

/** Drop a cached broadphase (runtime arenas only; MAPS templates are frozen). */
export function invalidateBlockIndex(arena) { return indexCache.delete(arena); }
