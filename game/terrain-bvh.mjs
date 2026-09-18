// Baked bounding-volume hierarchy over the terrain surface + wall triangles.
//
// `terrainRayHit` linearly scan-runs every terrain triangle *and* rebuilds every
// wall triangle per ray (`wallTriangles` is not cached; on a wall-heavy map such
// as frostline that is ~250 us per ray). This module precomputes the combined
// surface+wall triangle set once, then answers `terrainRayHitFast` in
// O(log triangles) with the exact same Moller-Trumbore arithmetic, so nearest
// hits are bit-identical to the brute path.
//
// Determinism: the build is a pure function of the triangle list and the leaf
// size. Splits use the median of centroids on the widest axis with the original
// triangle index as the tie-break, so identical input always produces identical
// node bounds / leaf order. `terrainBvhHash` folds the baked bytes for a
// serialized/versioned comparison.
//
// The cache is a WeakMap keyed by the terrain object. `stampTerrainFloor`
// reassigns `terrain.surfaces`/`terrain.walls`, so it invalidates this module
// exactly like the floor lattice (see terrain.mjs + docs/M0-MIGRATION.md).

import {terrainTriangles, terrainWallTriangles} from './terrain.mjs';

const EPSILON = 1e-9;
// Extra AABB slack so a triangle that numerically sits a hair outside its node
// (or a slab boundary rounding) can never be pruned away. The triangle test
// itself always uses the raw vertices, so this only affects traversal, never
// the returned distance.
const BOUND_PAD = 1e-7;
const DEFAULT_LEAF = 12;
const MAX_STACK = 512;

export const TERRAIN_BVH_VERSION = 1;
export const DEFAULT_TERRAIN_BVH_LEAF = DEFAULT_LEAF;

const finite = value => typeof value === 'number' && Number.isFinite(value);

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

/** Stable content hash of a baked BVH. Cached on the bvh object. */
export function terrainBvhHash(bvh) {
  if (!bvh || typeof bvh !== 'object') throw new TypeError('Invalid terrain bvh');
  if (typeof bvh.hash === 'string') return bvh.hash;
  let h = 0x811c9dc5;
  h = fnvBytes(h, bvh.nodeBounds);
  h = fnvBytes(h, bvh.nodeLeft);
  h = fnvBytes(h, bvh.nodeRight);
  h = fnvBytes(h, bvh.nodeStart);
  h = fnvBytes(h, bvh.nodeCount);
  h = fnvBytes(h, bvh.triVerts);
  h = fnvBytes(h, bvh.triNormals);
  h = fnvBytes(h, bvh.triIndex);
  const hex = (`0000000${h.toString(16)}`).slice(-8);
  bvh.hash = `${TERRAIN_BVH_VERSION}:${hex}`;
  return bvh.hash;
}

// ---- build ----------------------------------------------------------------

// Exactly the triangle set `terrainRayHit` scans, in the same order: cached
// surface triangles first, then cached wall triangles.
export function terrainRayTriangles(terrain) {
  return [...terrainTriangles(terrain), ...terrainWallTriangles(terrain)];
}

/**
 * Bake a BVH over `terrainRayTriangles(terrain)`. Pure and uncached; use
 * `ensureTerrainBvh` on the hot path. `options.leafSize` is for tests/perf
 * exploration and participates in the build determinism.
 */
export function bakeTerrainBvh(terrain, options = {}) {
  if (!terrain || typeof terrain !== 'object') throw new TypeError('Invalid terrain');
  const leafSize = Math.max(1, Math.floor(options.leafSize ?? DEFAULT_LEAF));
  if (!finite(leafSize)) throw new TypeError('Invalid terrain bvh leaf size');

  const triangles = terrainRayTriangles(terrain);
  const count = triangles.length;
  const triVerts = new Float64Array(count * 9);
  const triNormals = new Float64Array(count * 3);
  const surfaceIds = new Array(count);
  const materials = new Array(count);
  const centroids = new Float64Array(count * 3);

  for (let i = 0; i < count; i++) {
    const triangle = triangles[i];
    const [a, b, c] = triangle.vertices;
    const base = i * 9;
    triVerts[base] = a[0]; triVerts[base + 1] = a[1]; triVerts[base + 2] = a[2];
    triVerts[base + 3] = b[0]; triVerts[base + 4] = b[1]; triVerts[base + 5] = b[2];
    triVerts[base + 6] = c[0]; triVerts[base + 7] = c[1]; triVerts[base + 8] = c[2];
    const nb = i * 3;
    triNormals[nb] = triangle.normal[0];
    triNormals[nb + 1] = triangle.normal[1];
    triNormals[nb + 2] = triangle.normal[2];
    surfaceIds[i] = triangle.surfaceId;
    materials[i] = triangle.material;
    centroids[nb] = (a[0] + b[0] + c[0]) / 3;
    centroids[nb + 1] = (a[1] + b[1] + c[1]) / 3;
    centroids[nb + 2] = (a[2] + b[2] + c[2]) / 3;
  }

  const order = new Int32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;

  const nodeBounds = [];
  const nodeLeft = [];
  const nodeRight = [];
  const nodeStart = [];
  const nodeCount = [];

  const addNode = (minX, minY, minZ, maxX, maxY, maxZ, left, right, start, leafCount) => {
    nodeBounds.push(
      minX - BOUND_PAD, minY - BOUND_PAD, minZ - BOUND_PAD,
      maxX + BOUND_PAD, maxY + BOUND_PAD, maxZ + BOUND_PAD,
    );
    nodeLeft.push(left); nodeRight.push(right); nodeStart.push(start); nodeCount.push(leafCount);
    return nodeLeft.length - 1;
  };

  // Top-down median split on the widest centroid axis. Returns the node index;
  // children are appended before their parent so the root is the last node.
  const buildRange = (lo, hi) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity, cMinZ = Infinity, cMaxZ = -Infinity;
    for (let p = lo; p < hi; p++) {
      const t = order[p], base = t * 9;
      const ax = triVerts[base], ay = triVerts[base + 1], az = triVerts[base + 2];
      const bx = triVerts[base + 3], by = triVerts[base + 4], bz = triVerts[base + 5];
      const cx = triVerts[base + 6], cy = triVerts[base + 7], cz = triVerts[base + 8];
      if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
      if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
      if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
      if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
      if (by < minY) minY = by; if (by > maxY) maxY = by;
      if (bz < minZ) minZ = bz; if (bz > maxZ) maxZ = bz;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;
      const cb = t * 3;
      const gx = centroids[cb], gy = centroids[cb + 1], gz = centroids[cb + 2];
      if (gx < cMinX) cMinX = gx; if (gx > cMaxX) cMaxX = gx;
      if (gy < cMinY) cMinY = gy; if (gy > cMaxY) cMaxY = gy;
      if (gz < cMinZ) cMinZ = gz; if (gz > cMaxZ) cMaxZ = gz;
    }
    const span = Math.max(cMaxX - cMinX, cMaxY - cMinY, cMaxZ - cMinZ);
    const rangeCount = hi - lo;
    if (rangeCount <= leafSize || !(span > 1e-12)) {
      return addNode(minX, minY, minZ, maxX, maxY, maxZ, -1, -1, lo, rangeCount);
    }
    const ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ;
    const axis = ey > ex && ey >= ez ? 1 : ez > ex ? 2 : 0;
    // Median split with the original index as the stable tie-break.
    order.subarray(lo, hi).sort((p, q) => {
      const d = centroids[p * 3 + axis] - centroids[q * 3 + axis];
      return d !== 0 ? d : p - q;
    });
    const mid = (lo + hi) >> 1;
    const left = buildRange(lo, mid);
    const right = buildRange(mid, hi);
    return addNode(minX, minY, minZ, maxX, maxY, maxZ, left, right, -1, -1);
  };

  const root = count > 0 ? buildRange(0, count) : -1;
  const bvh = {
    version: TERRAIN_BVH_VERSION,
    leafSize,
    triangles: count,
    root,
    nodeBounds: Float64Array.from(nodeBounds),
    nodeLeft: Int32Array.from(nodeLeft),
    nodeRight: Int32Array.from(nodeRight),
    nodeStart: Int32Array.from(nodeStart),
    nodeCount: Int32Array.from(nodeCount),
    triVerts,
    triNormals,
    triIndex: order,
    surfaceIds,
    materials,
    hash: null,
  };
  terrainBvhHash(bvh);
  return bvh;
}

// ---- cache ----------------------------------------------------------------

const bvhCache = new WeakMap();

/** Baked-BVH cache keyed by the (frozen) terrain object + leaf size. */
export function ensureTerrainBvh(terrain, leafSize = DEFAULT_LEAF) {
  if (!terrain || typeof terrain !== 'object') throw new TypeError('Invalid terrain');
  let map = bvhCache.get(terrain);
  if (!map) { map = new Map(); bvhCache.set(terrain, map); }
  let bvh = map.get(leafSize);
  if (!bvh) { bvh = bakeTerrainBvh(terrain, {leafSize}); map.set(leafSize, bvh); }
  return bvh;
}

/** Drop cached BVHs for a terrain (generation-time stamps mutate in place). */
export function invalidateTerrainBvh(terrain) {
  if (terrain && typeof terrain === 'object') bvhCache.delete(terrain);
}

// ---- ray lookup -----------------------------------------------------------

const stack = new Int32Array(MAX_STACK);
const stackEntry = new Float64Array(MAX_STACK);

// Slab test against one node. Returns the entry distance, or -1 when the ray
// misses. `maxT` is the current best distance (Infinity allowed).
function nodeEntry(bvh, index, ox, oy, oz, dx, dy, dz, maxT) {
  const bounds = bvh.nodeBounds;
  const base = index * 6;
  let tmin = 0, tmax = maxT;
  const minX = bounds[base], minY = bounds[base + 1], minZ = bounds[base + 2];
  const maxX = bounds[base + 3], maxY = bounds[base + 4], maxZ = bounds[base + 5];
  if (Math.abs(dx) < 1e-12) { if (ox < minX || ox > maxX) return -1; }
  else { const inv = 1 / dx; let t1 = (minX - ox) * inv, t2 = (maxX - ox) * inv; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(dy) < 1e-12) { if (oy < minY || oy > maxY) return -1; }
  else { const inv = 1 / dy; let t1 = (minY - oy) * inv, t2 = (maxY - oy) * inv; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(dz) < 1e-12) { if (oz < minZ || oz > maxZ) return -1; }
  else { const inv = 1 / dz; let t1 = (minZ - oz) * inv, t2 = (maxZ - oz) * inv; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  return tmin;
}

// Bit-for-bit the arithmetic of terrain.mjs rayTriangle, on scalars.
function rayTriangleFast(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) <= EPSILON) return null;
  const inv = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = inv * (sx * hx + sy * hy + sz * hz);
  if (u < -EPSILON || u > 1 + EPSILON) return null;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = inv * (dx * qx + dy * qy + dz * qz);
  if (v < -EPSILON || u + v > 1 + EPSILON) return null;
  const distance = inv * (e2x * qx + e2y * qy + e2z * qz);
  return distance >= -EPSILON ? Math.max(0, distance) : null;
}

/**
 * Nearest surface+wall triangle hit for a ray, equivalent to
 * `terrainRayHit(origin, direction, maxDistance, terrain)` but accelerated by
 * `bvh` (from `ensureTerrainBvh`). Returns `{distance,normal,surfaceId,material}`
 * or `null`. Ties (equal distance) resolve to the lowest triangle index, i.e.
 * the first one the brute scan would have kept.
 */
export function terrainRayHitFast(bvh, origin, direction, maxDistance = Infinity) {
  if (!bvh || typeof bvh !== 'object') throw new TypeError('Invalid terrain bvh');
  if (!origin || !direction) throw new TypeError('Invalid ray query');
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const dx = direction.x, dy = direction.y, dz = direction.z;
  if (!finite(ox) || !finite(oy) || !finite(oz) || !finite(dx) || !finite(dy) || !finite(dz)) throw new TypeError('Invalid ray query');
  if ((!finite(maxDistance) && maxDistance !== Infinity) || maxDistance < 0) throw new TypeError('Invalid ray query');
  if (bvh.root < 0) return null;
  const limit = maxDistance + EPSILON;
  const triVerts = bvh.triVerts;
  let best = maxDistance, bestTri = -1;
  const rootEntry = nodeEntry(bvh, bvh.root, ox, oy, oz, dx, dy, dz, maxDistance);
  if (rootEntry < 0) return null;
  stack[0] = bvh.root;
  stackEntry[0] = rootEntry;
  let sp = 1;
  while (sp > 0) {
    --sp;
    const node = stack[sp];
    if (stackEntry[sp] > best + EPSILON) continue;
    const leafCount = bvh.nodeCount[node];
    if (leafCount >= 0) {
      const start = bvh.nodeStart[node];
      for (let p = start; p < start + leafCount; p++) {
        const t = bvh.triIndex[p], base = t * 9;
        const distance = rayTriangleFast(
          ox, oy, oz, dx, dy, dz,
          triVerts[base], triVerts[base + 1], triVerts[base + 2],
          triVerts[base + 3], triVerts[base + 4], triVerts[base + 5],
          triVerts[base + 6], triVerts[base + 7], triVerts[base + 8],
        );
        if (distance === null || distance > limit) continue;
        if (bestTri < 0 || distance < best - EPSILON || (distance <= best + EPSILON && t < bestTri)) { best = distance; bestTri = t; }
      }
      continue;
    }
    const left = bvh.nodeLeft[node], right = bvh.nodeRight[node];
    const leftEntry = nodeEntry(bvh, left, ox, oy, oz, dx, dy, dz, best);
    const rightEntry = nodeEntry(bvh, right, ox, oy, oz, dx, dy, dz, best);
    const leftOk = leftEntry >= 0 && leftEntry <= best + EPSILON;
    const rightOk = rightEntry >= 0 && rightEntry <= best + EPSILON;
    if (leftOk && rightOk) {
      if (sp + 2 > MAX_STACK) return terrainRayHitFastFallback(bvh, origin, direction, maxDistance);
      if (leftEntry < rightEntry) { stack[sp] = right; stackEntry[sp] = rightEntry; sp++; stack[sp] = left; stackEntry[sp] = leftEntry; sp++; }
      else { stack[sp] = left; stackEntry[sp] = leftEntry; sp++; stack[sp] = right; stackEntry[sp] = rightEntry; sp++; }
    } else if (leftOk) { stack[sp] = left; stackEntry[sp] = leftEntry; sp++; }
    else if (rightOk) { stack[sp] = right; stackEntry[sp] = rightEntry; sp++; }
  }
  if (bestTri < 0) return null;
  const nb = bestTri * 3;
  return {distance: best, normal: [bvh.triNormals[nb], bvh.triNormals[nb + 1], bvh.triNormals[nb + 2]], surfaceId: bvh.surfaceIds[bestTri], material: bvh.materials[bestTri]};
}

// Unreachable for a balanced median-split BVH (depth ~ log2 N); kept so a
// pathological stack request can never silently drop a hit.
function terrainRayHitFastFallback(bvh, origin, direction, maxDistance) {
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const dx = direction.x, dy = direction.y, dz = direction.z;
  const triVerts = bvh.triVerts;
  const limit = maxDistance + EPSILON;
  let best = maxDistance, bestTri = -1;
  for (let t = 0; t < bvh.triangles; t++) {
    const base = t * 9;
    const distance = rayTriangleFast(ox, oy, oz, dx, dy, dz, triVerts[base], triVerts[base + 1], triVerts[base + 2], triVerts[base + 3], triVerts[base + 4], triVerts[base + 5], triVerts[base + 6], triVerts[base + 7], triVerts[base + 8]);
    if (distance === null || distance > limit) continue;
    if (bestTri < 0 || distance < best - EPSILON || (distance <= best + EPSILON && t < bestTri)) { best = distance; bestTri = t; }
  }
  if (bestTri < 0) return null;
  const nb = bestTri * 3;
  return {distance: best, normal: [bvh.triNormals[nb], bvh.triNormals[nb + 1], bvh.triNormals[nb + 2]], surfaceId: bvh.surfaceIds[bestTri], material: bvh.materials[bestTri]};
}
