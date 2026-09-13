// Next-generation procedural level system for COCS.
//
// The legacy maps are hand-authored box arenas. This module builds richer
// levels from a deterministic seed: a heightfield terrain with biomes, plus
// structures (buildings with walkable interiors, tunnels, caverns, bridges,
// arches, columns), props (rocks, trees, crates, barrels) and authored routes.
//
// It emits the same schema the simulation already understands (blocks, terrain,
// spawns, pickups, navNodes, objectiveZones, vehicles, traversal) *plus* the
// visual layer (structures/props/roofs) that the renderer turns into smooth,
// non-boxy geometry. Collision stays on the proven box + heightfield path, so
// bots, projectiles and prediction keep working unchanged; only the look and the
// authored layout change.

import {cavernOpening} from './structures.mjs';
import {terrainSupportAt, terrainWallSegments} from './terrain.mjs';
import {RULES} from './data.mjs';

export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x6d2b79f5;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

// Deterministic hash-based value noise (no Math.random, stable across runs).
function hash2(x, y, seed) {
  let h = Math.imul((x | 0) + 374761393, 668265263) ^ Math.imul((y | 0) + 1274126177, 2246822519) ^ Math.imul(seed | 0, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, y, seed, octaves = 4) {
  let value = 0, amp = 0.5, freq = 1, total = 0;
  for (let i = 0; i < octaves; i++) { value += amp * valueNoise(x * freq, y * freq, seed + i * 101); total += amp; amp *= 0.5; freq *= 2; }
  return value / (total || 1);
}

// ---- Terrain --------------------------------------------------------------

const BIOME_MATERIAL = {
  canyon: { low: 'sand', mid: 'dirt', high: 'rock', peak: 'stone' },
  forest: { low: 'grass', mid: 'grass', high: 'rock', peak: 'rock' },
  snow: { low: 'snow', mid: 'snow', high: 'ice', peak: 'rock' },
  volcanic: { low: 'ash', mid: 'rock', high: 'rock', peak: 'ash' },
  urban: { low: 'concrete', mid: 'concrete', high: 'stone', peak: 'rock' },
  ruins: { low: 'sand', mid: 'stone', high: 'stone', peak: 'rock' },
  cavern: { low: 'stone', mid: 'rock', high: 'rock', peak: 'rock' },
};

// Build a triangulated heightfield over the level bounds. Materials are grouped
// per-surface so the renderer can texture each biome separately.
export function terrainField(bounds, opts = {}) {
  const step = opts.step ?? 7, seed = opts.seed ?? 1, biome = BIOME_MATERIAL[opts.biome] ?? BIOME_MATERIAL.canyon;
  const amplitude = opts.amplitude ?? 6, base = opts.base ?? amplitude * 0.55, relief = opts.relief ?? 1.6;
  const height = opts.height ?? ((x, z) => base + (fbm(x / 58, z / 58, seed, 4) - 0.5) * amplitude + (fbm(x / 15, z / 15, seed + 7, 3) - 0.5) * relief);
  const cols = Math.max(2, Math.round((bounds.maxX - bounds.minX) / step));
  const rows = Math.max(2, Math.round((bounds.maxZ - bounds.minZ) / step));
  const dx = (bounds.maxX - bounds.minX) / cols, dz = (bounds.maxZ - bounds.minZ) / rows;
  const heights = [];
  for (let j = 0; j <= rows; j++) {
    const row = [];
    for (let i = 0; i <= cols; i++) row.push(height(bounds.minX + i * dx, bounds.minZ + j * dz));
    heights.push(row);
  }
  const buckets = new Map();
  const pushTri = (mat, a, b, c) => {
    let bucket = buckets.get(mat);
    if (!bucket) { bucket = { id: `terrain-${mat}`, material: mat, walkable: true, vertices: [], triangles: [] }; buckets.set(mat, bucket); }
    const base = bucket.vertices.length;
    bucket.vertices.push(a, b, c);
    bucket.triangles.push([base, base + 1, base + 2]);
  };
  const yAt = (i, j) => heights[j][i];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x0 = bounds.minX + i * dx, x1 = x0 + dx, z0 = bounds.minZ + j * dz, z1 = z0 + dz;
    const y00 = yAt(i, j), y10 = yAt(i + 1, j), y01 = yAt(i, j + 1), y11 = yAt(i + 1, j + 1);
    const avg = (y00 + y10 + y01 + y11) / 4;
    const slope = Math.max(Math.abs(y00 - y11), Math.abs(y10 - y01)) / Math.max(dx, dz);
    const t = clamp((avg - base) / Math.max(1, amplitude), 0, 1);
    const mat = slope > 0.9 ? biome.peak : t > 0.72 ? biome.high : t > 0.42 ? biome.mid : biome.low;
    pushTri(mat, [x0, y00, z0], [x0, y01, z1], [x1, y11, z1]);
    pushTri(mat, [x0, y00, z0], [x1, y11, z1], [x1, y10, z0]);
  }
  // Steep cell edges become solid cliff segments (collision) plus visible cliff
  // faces (walkable:false surfaces, so they render and cast strata lines).
  const walls = [], cliffQuads = [];
  const cliffEdge = (x, z, x2, z2, y, y2) => {
    if (Math.abs(y2 - y) <= 2.2) return;
    const lo = Math.min(y, y2), hi = Math.max(y, y2);
    walls.push({ a: [x, lo, z], b: [x2, hi, z2] });
    cliffQuads.push([[x, lo, z], [x2, lo, z2], [x2, hi, z2], [x, hi, z]]);
  };
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const x = bounds.minX + i * dx, z = bounds.minZ + j * dz, y = yAt(i, j);
    if (i < cols) cliffEdge(x, z, x + dx, z, y, yAt(i + 1, j));
    if (j < rows) cliffEdge(x, z, x, z + dz, y, yAt(i, j + 1));
  }
  if (cliffQuads.length) {
    const surface = { id: 'terrain-cliff', material: 'cliff', walkable: false, vertices: [], triangles: [] };
    for (const quad of cliffQuads) { const b = surface.vertices.length; surface.vertices.push(quad[0], quad[1], quad[2], quad[3]); surface.triangles.push([b, b + 1, b + 2], [b, b + 2, b + 3]); }
    buckets.set('cliff', surface);
  }
  return { surfaces: [...buckets.values()], walls, maxSlope: opts.maxSlope ?? 0.85, height, base, amplitude };
}

// ---- Feature helpers ------------------------------------------------------

// Quarter-turn transform so authored buildings/tunnels stay axis-aligned while
// still facing different directions. Collision boxes are emitted in world space.
function quarter(rot) { return ((Math.round(rot / (Math.PI / 2)) % 4) + 4) % 4; }
function rotateLocal(lx, lz, q) {
  switch (q) { case 1: return [-lz, lx]; case 2: return [-lx, -lz]; case 3: return [lz, -lx]; default: return [lx, lz]; }
}

export function createLevel(spec) {
  const rng = mulberry32(spec.seed ?? 1);
  const size = spec.size ?? { w: 90, d: 90 };
  const bounds = { minX: -(size.w / 2), maxX: size.w / 2, minZ: -(size.d / 2), maxZ: size.d / 2, ...(spec.bounds ?? {}) };
  const ctx = {
    rng, bounds, structures: [], props: [], blocks: [], roofs: [],
    spawns: [], teamSpawns: { 0: [], 1: [] }, flagSpawns: {}, pickups: [], navNodes: [], objectiveZones: [], vehicles: [],
    traversal: { trampolines: [], boostLaunchers: [], teleporters: [], ziplines: [] },
    ground: (x, z) => terrain.height(x, z),
    addBlock: (b) => { ctx.blocks.push(b); return b; },
    addNav: (x, z) => { ctx.navNodes.push({ x, z }); },
    addSpawn: (x, z, team) => { if (team === undefined) ctx.spawns.push([x, z]); else ctx.teamSpawns[team]?.push([x, z]); },
    addPickup: (kind, x, z) => ctx.pickups.push([kind, x, z]),
    addObjective: (x, z, radius = 3.5) => ctx.objectiveZones.push({ x, z, radius, y: terrain.height(x, z) }),
    addVehicle: (v) => ctx.vehicles.push(v),
    addStructure: (s) => { ctx.structures.push(s); return s; },
    addProp: (p) => { ctx.props.push(p); return p; },
  };

  const terrain = spec.terrain ?? terrainField(bounds, { ...spec, seed: spec.seed });
  ctx.terrain = terrain;
  ctx.ground = (x, z) => terrain.height(x, z);

  // A building composed of four walls with an optional doorway, plus a roof and
  // a floor slab. Collision wall boxes leave a real, walkable door gap.
  ctx.addBuilding = (o) => {
    const { x, z, w, d, h = 6, wall = 0.5, rot = 0, roof = 'gable', door = 'south', doorWidth = 2.2, floors = 1, color, windows = true } = o;
    const q = quarter(rot), groundY = terrain.height(x, z), baseY = o.y ?? groundY;
    const place = (lx, lz, sw, sd, kind, hh = h, yy = baseY) => {
      const [rx, rz] = rotateLocal(lx, lz, q);
      const [sw2, sd2] = q % 2 === 0 ? [sw, sd] : [sd, sw];
      ctx.addBlock({ x: x + rx, z: z + rz, w: sw2, d: sd2, h: yy + hh, kind });
    };
    const sides = { north: [0, -d / 2 + wall / 2], south: [0, d / 2 - wall / 2], west: [-w / 2 + wall / 2, 0], east: [w / 2 - wall / 2, 0] };
    const sideDims = { north: [w, wall], south: [w, wall], west: [wall, d], east: [wall, d] };
    const sideSpan = { north: w, south: w, west: d, east: d };
    for (const name of Object.keys(sides)) {
      const [cx, cz] = sides[name], [sw, sd] = sideDims[name], span = sideSpan[name];
      if (name === door && doorWidth < span) {
        const seg = (span - doorWidth) / 2;
        const axis = name === 'north' || name === 'south' ? 'x' : 'z';
        if (axis === 'x') { place(cx - (doorWidth / 2 + seg / 2), cz, seg, sd, 'building'); place(cx + (doorWidth / 2 + seg / 2), cz, seg, sd, 'building'); }
        else { place(cx, cz - (doorWidth / 2 + seg / 2), sw, seg, 'building'); place(cx, cz + (doorWidth / 2 + seg / 2), sw, seg, 'building'); }
      } else place(cx, cz, sw, sd, 'building');
    }
    for (let f = 1; f < floors; f++) { const yy = baseY + f * (h / floors); const [fx, fz] = rotateLocal(0, 0, q); ctx.addBlock({ x: x + fx, z: z + fz, w: w - wall, d: d - wall, h: yy, kind: 'floor' }); }
    ctx.addStructure({ type: 'building', x, z, y: baseY, w, d, h, rot, roof, color, windows, floors, door });
    // Follow the actual local doorway through its quarter-turn, not the wall
    // nearest the map centre. Short steps preserve narrow entrances in nav.
    if (sides[door]) {
      const [dx, dz] = sides[door], length = Math.hypot(dx, dz);
      const [nx, nz] = rotateLocal(dx / length, dz / length, q);
      for (let t = 0; t <= length + 4; t += 1.5) ctx.addNav(x + nx * t, z + nz * t);
    }
    if (windows) for (const name of Object.keys(sides)) { if (name === door) continue; const [cx, cz] = sides[name]; const [rx, rz] = rotateLocal(cx, cz, q); ctx.addStructure({ type: 'windows', x: x + rx, z: z + rz, y: baseY + h * 0.45, w: (name === 'north' || name === 'south') ? w : d, rot, rows: Math.max(1, Math.floor(h / 3)) }); }
    return x;
  };

  // A hollow tunnel: side-wall collision boxes along the path and a smooth tube
  // mesh for the roof/arch. Points are [x,y,z]; y defaults to the terrain.
  ctx.addTunnel = (rawPoints, radius = 3) => {
    const points = rawPoints.map(p => [p[0], Number.isFinite(p[1]) ? p[1] : terrain.height(p[0], p[2]) + 1.2, p[2]]);
    ctx.addStructure({ type: 'tunnel', points, radius });
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dz) || 1, along = Math.atan2(dx, dz);
      const nx = Math.cos(along), nz = -Math.sin(along), count = Math.max(1, Math.ceil(len / 1.2));
      for (let k = i === 0 ? 0 : 1; k <= count; k++) {
        const t = k / count, px = a[0] + dx * t, pz = a[2] + dz * t, py = a[1] + dy * t;
        ctx.addNav(px, pz);
        for (const side of [-1, 1]) ctx.addBlock({ x: px + nx * side * radius, z: pz + nz * side * radius, w: 1.6, d: 1.6, h: py + radius + 1.4, kind: 'tunnel' });
      }
    }
    return points;
  };

  // A carved cavern: a bowl in the terrain with a ring of rock walls and a domed
  // roof. The floor is the terrain itself.
  ctx.addCavern = (o) => {
    const { x, z, radius = 12, height = 8 } = o;
    ctx.addStructure({ type: 'cavern', x, z, y: terrain.height(x, z), radius, height });
    const segments = 16;
    for (let i = 0; i < segments; i++) {
      if (cavernOpening(i)) continue; // two opposite entrances keep the cavern enterable
      const a = (i / segments) * Math.PI * 2, wx = x + Math.cos(a) * radius, wz = z + Math.sin(a) * radius, wy = terrain.height(wx, wz);
      ctx.addBlock({ x: wx, z: wz, w: radius * 0.45, d: radius * 0.45, h: wy + height, kind: 'cave' });
    }
  };

  ctx.addArch = (o) => ctx.addStructure({ type: 'arch', ...o });
  ctx.addColumn = (o) => { ctx.addStructure({ type: 'column', ...o }); if (o.collide !== false) ctx.addBlock({ x: o.x, z: o.z, w: (o.radius ?? 0.6) * 2, d: (o.radius ?? 0.6) * 2, h: (o.y ?? terrain.height(o.x, o.z)) + (o.height ?? 5), kind: 'column' }); };
  ctx.addBridge = (o) => { ctx.addStructure({ type: 'bridge', ...o }); const q = quarter(o.rot ?? 0), [w, d] = q % 2 === 0 ? [o.w, o.d] : [o.d, o.w]; ctx.addBlock({ x: o.x, z: o.z, w, d, h: (o.y ?? terrain.height(o.x, o.z)) + (o.thickness ?? 0.4), kind: 'deck' }); };
  const blocksApproach = (x, z, radius) => ctx.navNodes.some(p => Math.abs(x - p.x) < radius + 1 && Math.abs(z - p.z) < radius + 1);
  ctx.addRock = (o = {}) => { const x = o.x, z = o.z, s = o.scale ?? 1, seed = Math.floor(rng() * 1e6); if (o.collide !== false && s > .8 && blocksApproach(x, z, s)) return; ctx.addProp({ type: 'rock', x, z, y: o.y ?? terrain.height(x, z), scale: s, seed }); if (o.collide !== false && s > 0.8) ctx.addBlock({ x, z, w: s * 2, d: s * 2, h: (o.y ?? terrain.height(x, z)) + s * 1.4, kind: 'rock' }); };
  ctx.addTree = (o = {}) => { const x = o.x, z = o.z, s = o.scale ?? 1, seed = Math.floor(rng() * 1e6); if (o.collide !== false && blocksApproach(x, z, .25)) return; ctx.addProp({ type: 'tree', x, z, y: o.y ?? terrain.height(x, z), scale: s, seed }); if (o.collide !== false) ctx.addBlock({ x, z, w: .5, d: .5, h: (o.y ?? terrain.height(x, z)) + 2.4, kind: 'tree' }); };
  ctx.addCrate = (o = {}) => { const x = o.x, z = o.z, s = o.scale ?? 1; if (o.collide !== false && blocksApproach(x, z, s * .7)) return; ctx.addProp({ type: 'crate', x, z, y: o.y ?? terrain.height(x, z), scale: s }); if (o.collide !== false) ctx.addBlock({ x, z, w: s * 1.4, d: s * 1.4, h: (o.y ?? terrain.height(x, z)) + s * 1.4, kind: 'crate' }); };
  ctx.addBarrel = (o = {}) => { const x = o.x, z = o.z; ctx.addProp({ type: 'barrel', x, z, y: o.y ?? terrain.height(x, z), scale: o.scale ?? 1 }); };
  ctx.addRuin = (o = {}) => ctx.addProp({ type: 'ruin', x: o.x, z: o.z, y: o.y ?? terrain.height(o.x, o.z), scale: o.scale ?? 1, rot: o.rot ?? 0, seed: Math.floor(rng() * 1e6) });

  spec.layout?.(ctx, rng);

  // Default spawns/objectives when the layout does not author them.
  if (!ctx.spawns.length && !ctx.teamSpawns[0].length) {
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.spawns.push([Math.cos(a) * (size.w * 0.38), Math.sin(a) * (size.d * 0.38)]); }
  }
  if (ctx.teamSpawns[0].length && !ctx.teamSpawns[1].length) ctx.teamSpawns[1] = ctx.teamSpawns[0].map(([x, z]) => [-x, -z]);
  if (!ctx.objectiveZones.length) ctx.objectiveZones = [{ x: 0, z: 0, radius: 4, y: terrain.height(0, 0) }, { x: -size.w * 0.25, z: 0, radius: 3.5, y: terrain.height(-size.w * 0.25, 0) }, { x: size.w * 0.25, z: 0, radius: 3.5, y: terrain.height(size.w * 0.25, 0) }];
  const teamMap = ctx.teamSpawns[0].length > 0;
  // Scatter low cover near the action so lanes read and the turbo-jump cover
  // behaviour has anchors on every generated map.
  if (!ctx.blocks.some(b => b.kind === 'cover')) {
    const coverPoints = teamMap ? ctx.teamSpawns[0] : [...ctx.spawns, ...ctx.objectiveZones.map(z => [z.x, z.z])];
    for (let i = 0; i < Math.min(teamMap ? 3 : 6, Math.max(1, coverPoints.length)); i++) {
      const [ax, az] = coverPoints[i % coverPoints.length] || [0, 0];
      const x = clamp(ax + (i % 2 ? 5 : -5), bounds.minX + 3, bounds.maxX - 3), z = clamp(az + (i % 3 ? -4 : 4), bounds.minZ + 3, bounds.maxZ - 3);
      if (blocksApproach(x, z, 1.5) || (teamMap && blocksApproach(-x, -z, 1.5))) continue;
      ctx.addBlock({ x, z, w: 3, d: 1.4, h: terrain.height(x, z) + 1.9, kind: 'cover' });
      if (teamMap) ctx.addBlock({ x: -x, z: -z, w: 3, d: 1.4, h: terrain.height(-x, -z) + 1.9, kind: 'cover' });
    }
  }
  // Supplement authored approach chains; even diagonal grid edges fit walkEdge.
  for (let x = bounds.minX + 2; x < bounds.maxX; x += 4) for (let z = bounds.minZ + 2; z < bounds.maxZ; z += 4) ctx.addNav(x, z);
  // Guarantee the supplies a match expects (weapon tiers, health/armor and
  // powerups) and place any missing spawn points on supported ground.
  const anchors = [...ctx.objectiveZones.map(z => [z.x, z.z]).sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1])), ...ctx.spawns, ...Object.values(ctx.teamSpawns).flat()];
  const anchor = (i) => anchors.length ? anchors[i % anchors.length] : [0, 0];
  const pairedSupplies = [];
  const supplyOffset = i => {
    if (i === 0) return [0, 0];
    const ring = Math.ceil(i / 6), a = ((i - 1) % 6) / 6 * Math.PI * 2, radius = 1.8 * ring;
    return [Math.cos(a) * radius, Math.sin(a) * radius];
  };
  let supplyIndex = 0;
  const addSupply = kind => {
    const base = teamMap ? ctx.teamSpawns[0][supplyIndex % ctx.teamSpawns[0].length] : anchor(supplyIndex);
    const [ox, oz] = supplyOffset(supplyIndex);
    supplyIndex++;
    const ax = base[0] + ox, az = base[1] + oz;
    ctx.addPickup(kind, ax, az);
    if (teamMap) { const first = ctx.pickups.at(-1); ctx.addPickup(kind, -ax, -az); pairedSupplies.push([first, ctx.pickups.at(-1)]); }
  };
  const required = ['rocket', 'rail', 'scatter', 'plasma', 'health', 'armor', 'haste', 'overcharge', 'overshield', 'recon', 'cloak'];
  for (const kind of required) {
    if (ctx.pickups.some(([existing]) => existing === kind)) continue;
    addSupply(kind);
  }
  const filler = ['grenade', 'shock', 'flak', 'marksman', 'smg', 'health', 'armor'];
  while (ctx.pickups.length < 16) addSupply(filler[ctx.pickups.length % filler.length]);
  // Nudge any supply or spawn clear of collision boxes so matches never start a
  // player or pickup inside a wall.
  // Use the same triangulated support and wall segments as runtime, without
  // importing core (core -> maps -> levelgen). Decks are solids at ground level.
  const floor = (x, z) => terrainSupportAt(x, z, terrain, terrain.maxSlope ?? .9)?.y ?? null;
  const blockedAt = (x, z, r) => {
    if (x < bounds.minX + r || x > bounds.maxX - r || z < bounds.minZ + r || z > bounds.maxZ - r) return true;
    const y = floor(x, z);
    return y === null || ctx.blocks.some(b => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r && y < b.h - 1e-6 && y + RULES.height > 0) || terrainWallSegments(terrain).some(({a, b}) => {
      const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
      const t = length > 1e-9 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / length, 0, 1) : 0;
      return y < Math.max(a.y, b.y) - 1e-6 && y + RULES.height > Math.min(a.y, b.y) + 1e-6 && Math.hypot(x - a.x - t * dx, z - a.z - t * dz) < r;
    });
  };
  const supplyKey = (x, z) => `${Math.round(x * 100) / 100}:${Math.round(z * 100) / 100}`;
  const clearSpot = (x, z, r, mirrored = false, used = null) => {
    const clear = (x, z) => !blockedAt(x, z, r) && (!mirrored || !blockedAt(-x, -z, r)) && (!used || !used.has(supplyKey(x, z)));
    if (clear(x, z)) return [x, z];
    for (let ring = 1; ring <= 16; ring++) for (let a = 0; a < 8; a++) {
      const nx = x + Math.cos(a / 8 * Math.PI * 2) * ring, nz = z + Math.sin(a / 8 * Math.PI * 2) * ring;
      if (clear(nx, nz)) return [nx, nz];
    }
    throw new Error(`${spec.id}: no clear required placement near ${x},${z}`);
  };
  const usedSupplies = new Set();
  const paired = new Set(pairedSupplies.flat());
  for (const [a, b] of pairedSupplies) {
    const [x, z] = clearSpot(a[1], a[2], .65, true, usedSupplies);
    a[1] = x; a[2] = z; b[1] = -x; b[2] = -z;
    usedSupplies.add(supplyKey(a[1], a[2])); usedSupplies.add(supplyKey(b[1], b[2]));
  }
  for (const p of ctx.pickups) if (!paired.has(p)) { const spot = clearSpot(p[1], p[2], .65, false, usedSupplies); p[1] = spot[0]; p[2] = spot[1]; usedSupplies.add(supplyKey(p[1], p[2])); }
  for (const s of ctx.spawns) { const spot = clearSpot(s[0], s[1], .6); if (spot) { s[0] = spot[0]; s[1] = spot[1]; } }
  for (const team of [0, 1]) for (const s of ctx.teamSpawns[team]) { const spot = clearSpot(s[0], s[1], .6); if (spot) { s[0] = spot[0]; s[1] = spot[1]; } }
  for (const zone of ctx.objectiveZones) { [zone.x, zone.z] = clearSpot(zone.x, zone.z, .65); zone.y = floor(zone.x, zone.z); }

  const map = {
    id: spec.id, name: spec.name, tag: spec.tag, description: spec.description, color: spec.color, background: spec.background,
    bounds, terrain, blocks: ctx.blocks, spawns: ctx.spawns, pickups: ctx.pickups, navNodes: ctx.navNodes,
    objectiveZones: ctx.objectiveZones, vehicles: ctx.vehicles, traversal: ctx.traversal,
    structures: ctx.structures, props: ctx.props, roofs: ctx.roofs,
    group: spec.group, scale: spec.scale, mode: spec.mode, nextGen: true,
    // A kill plane below the terrain so any impossible fall still resolves to a death.
    voidY: spec.voidY ?? (terrain.base - terrain.amplitude - (spec.relief ?? 1.6) - 16),
  };
  if (ctx.teamSpawns[0].length) { map.teamSpawns = ctx.teamSpawns; }
  const authoredFlags = ctx.flagSpawns && (ctx.flagSpawns[0] || ctx.flagSpawns[1]) ? ctx.flagSpawns : null;
  const pair = value => Array.isArray(value) ? [value[0], value[1]] : value && Number.isFinite(value.x) ? [value.x, value.z] : null;
  if (authoredFlags && pair(authoredFlags[0]) && pair(authoredFlags[1])) {
    map.flagSpawns = { 0: pair(authoredFlags[0]), 1: pair(authoredFlags[1]) }; map.flags = map.flagSpawns;
  } else if (spec.flagSpawns) { map.flagSpawns = spec.flagSpawns; map.flags = spec.flagSpawns; }
  else if (ctx.teamSpawns[0].length) { map.flagSpawns = { 0: ctx.teamSpawns[0][0], 1: ctx.teamSpawns[1][0] }; }
  if (map.flagSpawns) {
    map.flagSpawns = Object.fromEntries(Object.entries(map.flagSpawns).map(([team, point]) => [team, clearSpot(...pair(point), .65)]));
    map.flags = map.flagSpawns;
  }
  return map;
}
