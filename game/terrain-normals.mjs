// Crease-aware normal smoothing for authored terrain.
//
// Terrain triangles arrive as non-indexed positions, so `computeVertexNormals`
// produces independent face normals and a faceted look. This averages normals
// across vertices that share a position *only* when their faces are within a
// crease angle, so continuous slopes read smooth while cliff edges and material
// seams keep a hard edge. Positions, winding and collision data are untouched.

const QUANT = 100; // weld within 1cm

export function smoothNormals(positions, { angleCos = 0.82 } = {}) {
  const count = Math.floor(positions.length / 3);
  const normals = new Float32Array(count * 3);
  if (count < 3) return normals;
  const faces = Math.floor(count / 3);
  const faceN = new Float32Array(faces * 3);
  for (let f = 0; f < faces; f++) {
    const a = f * 3, b = a + 1, c = a + 2;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    faceN[f * 3] = nx / len; faceN[f * 3 + 1] = ny / len; faceN[f * 3 + 2] = nz / len;
  }
  // Group vertices by quantized position.
  const buckets = new Map();
  const key = (i) => `${Math.round(positions[i * 3] * QUANT)},${Math.round(positions[i * 3 + 1] * QUANT)},${Math.round(positions[i * 3 + 2] * QUANT)}`;
  for (let v = 0; v < count; v++) {
    const k = key(v);
    let list = buckets.get(k);
    if (!list) { list = []; buckets.set(k, list); }
    list.push(v);
  }
  const threshold = Math.max(-1, Math.min(1, Number(angleCos)));
  for (let v = 0; v < count; v++) {
    const f = Math.floor(v / 3);
    const nx = faceN[f * 3], ny = faceN[f * 3 + 1], nz = faceN[f * 3 + 2];
    const list = buckets.get(key(v));
    let sx = 0, sy = 0, sz = 0;
    for (const u of list) {
      const fu = Math.floor(u / 3);
      const ux = faceN[fu * 3], uy = faceN[fu * 3 + 1], uz = faceN[fu * 3 + 2];
      if (ux * nx + uy * ny + uz * nz >= threshold) { sx += ux; sy += uy; sz += uz; }
    }
    if (sx === 0 && sy === 0 && sz === 0) { sx = nx; sy = ny; sz = nz; }
    const len = Math.hypot(sx, sy, sz) || 1;
    normals[v * 3] = sx / len; normals[v * 3 + 1] = sy / len; normals[v * 3 + 2] = sz / len;
  }
  return normals;
}

// Deterministic per-vertex luminance tint keyed by position, so a smoothed
// surface varies coherently instead of gaining a seam per triangle.
export function positionColors(positions, { seed = 1, jitter = 0.16, tint = [1, 1, 1] } = {}) {
  const count = Math.floor(positions.length / 3);
  const colors = new Float32Array(count * 3);
  const hash = (x, y, z) => {
    let h = Math.imul(Math.round(x * 7) + 374761393, 668265263) ^ Math.imul(Math.round(y * 7) + 1274126177, 2246822519) ^ Math.imul(Math.round(z * 7) + 2654435761, 3266489917) ^ Math.imul(seed | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295;
  };
  for (let v = 0; v < count; v++) {
    const m = (1 - jitter * 0.5) + jitter * hash(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    colors[v * 3] = tint[0] * m; colors[v * 3 + 1] = tint[1] * m; colors[v * 3 + 2] = tint[2] * m;
  }
  return colors;
}

export const TERRAIN_NORMAL_EXPORTS = Object.freeze(['smoothNormals', 'positionColors']);
