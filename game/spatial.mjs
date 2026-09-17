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
  if (cached) return cached;
  const blocks = Array.isArray(arena.blocks) ? arena.blocks : [];

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
  };
  const index = {
    arena,
    blocks,
    cell,
    bounds: state.bounds,
    cols,
    rows,
    candidates: (x, z, r) => candidateBlocks(state, x, z, r),
    rayCandidates: (origin, direction, max) => rayCandidateBlocks(state, origin, direction, max),
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

// ---- top-level convenience + integration helpers --------------------------

export function candidates(arena, x, z, r) { return makeBlockIndex(arena).candidates(x, z, r); }
export function rayCandidates(arena, origin, direction, max) { return makeBlockIndex(arena).rayCandidates(origin, direction, max); }

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
