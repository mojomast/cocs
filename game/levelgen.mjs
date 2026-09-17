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

import {cavernOpening,facadeFrame,pathFloorAt,CAVERN_SEGMENTS,cavernShell} from './structures.mjs';
import {terrainSupportAt, terrainWallSegments,terrainFootprintRange,stampTerrainFloor} from './terrain.mjs';
import {RULES} from './data.mjs';
import {clamp, lerp} from './math.mjs';
import {validateMapSchema} from './map-schema.mjs';

export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x6d2b79f5;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// Biome-aware dressing. Each biome names the prop vocabulary that reads
// correctly on its surface, so a snow map never sprouts desert scrub. Builders
// resolve to the ctx.add* helpers, which already carry collision and clearance
// rules; `weight` biases the deterministic pick.
const BIOME_PROPS = {
  canyon: [{ type: 'rock', weight: 5 }, { type: 'crate', weight: 2 }, { type: 'ruin', weight: 1 }],
  forest: [{ type: 'tree', weight: 5 }, { type: 'rock', weight: 2 }, { type: 'crate', weight: 1 }],
  snow: [{ type: 'tree', weight: 3 }, { type: 'rock', weight: 4 }, { type: 'crate', weight: 1 }],
  volcanic: [{ type: 'rock', weight: 4 }, { type: 'barrel', weight: 3 }, { type: 'crate', weight: 1 }],
  urban: [{ type: 'crate', weight: 4 }, { type: 'barrel', weight: 2 }, { type: 'ruin', weight: 2 }],
  ruins: [{ type: 'ruin', weight: 4 }, { type: 'rock', weight: 3 }, { type: 'crate', weight: 1 }],
  cavern: [{ type: 'rock', weight: 4 }, { type: 'barrel', weight: 2 }, { type: 'ruin', weight: 1 }],
};
export const biomePropTable = biome => BIOME_PROPS[biome] || BIOME_PROPS.canyon;

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
    rng, bounds, structures: [], props: [], blocks: [],
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

  const sourceTerrain = spec.terrain ?? terrainField(bounds, { ...spec, seed: spec.seed });
  // Generation owns its terrain container; authored/frozen input is never edited.
  const terrain={...sourceTerrain,surfaces:[...(sourceTerrain.surfaces||[])],walls:[...(sourceTerrain.walls||[])]};
  ctx.terrain = terrain;
  ctx.ground = (x, z) => terrain.height(x, z);

  // Existing terrain triangles remain the single authoritative ground surface.
  const floorStrip=(a,b,width,id,options)=>{
    const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
    if(length<1e-6)return;
    const nx=-dz/length*width/2,nz=dx/length*width/2;
    stampTerrainFloor(terrain,[[a[0]+nx,a[2]+nz],[a[0]-nx,a[2]-nz],[b[0]-nx,b[2]-nz],[b[0]+nx,b[2]+nz]],(x,z)=>pathFloorAt(x,z,a,b).y,id,options);
    const n=Math.ceil(length/1.5);
    for(let i=0;i<=n;i++)ctx.addNav(a[0]+dx*i/n,a[2]+dz*i/n);
  };
  const approach=(x,z,y,nx,nz,width)=>{
    // Flat landing extends beyond the solid by more than the actor radius.
    const landing=[x+nx,z+nz];let length=4,endY=y;
    for(let i=0;i<8;i++){
      const ex=landing[0]+nx*length,ez=landing[1]+nz*length;
      const sample=terrainSupportAt(ex,ez,terrain)?.y;
      if(sample===undefined)break;
      endY=sample;
      const next=Math.max(4,Math.abs(y-endY)/.3);
      if(next<=length+.01)break;
      length=next;
    }
    floorStrip([x,y,z],[landing[0],y,landing[1]],width,'approach-floor');
    floorStrip([landing[0],y,landing[1]],[landing[0]+nx*length,endY,landing[1]+nz*length],width,'approach-floor');
  };

  // A building composed of four walls with an optional doorway and a roof.
  // Collision wall boxes leave a real, walkable door gap.
  ctx.addBuilding = (o) => {
    const { x, z, w, d, h = 6, wall = 0.5, rot = 0, roof = 'gable', door = 'south', doorWidth = 2.2, color, windows = true } = o;
    const q = quarter(rot),fw=q%2?d:w,fd=q%2?w:d;
    const footprint=[[x-fw/2,z-fd/2],[x+fw/2,z-fd/2],[x+fw/2,z+fd/2],[x-fw/2,z+fd/2]];
    const support=terrainFootprintRange(terrain,footprint);
    if(!support||support.area<fw*fd-1e-6)throw new RangeError('Building footprint must be fully supported by terrain');
    const baseY=o.y??support.max;
    stampTerrainFloor(terrain,footprint,()=>baseY,'foundation-floor');
    // Explicit ground-to-top solid fill. No minY/y semantics added to blocks.
    if(baseY>0)ctx.addBlock({x,z,w:fw,d:fd,h:baseY,kind:'foundation'});
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
    const building=ctx.addStructure({ type: 'building', x, z, y: baseY, w, d, h, rot:q*Math.PI/2, roof, color, windows, door, wall, doorWidth });
    // Follow the actual local doorway through its quarter-turn, not the wall
    // nearest the map centre. Short steps preserve narrow entrances in nav.
    if (sides[door]) {
      const [dx, dz] = sides[door], length = Math.hypot(dx, dz);
      const [nx, nz] = rotateLocal(dx / length, dz / length, q);
      const frame=facadeFrame(building,door);
      approach(frame.origin.x,frame.origin.z,baseY,nx,nz,Math.min(doorWidth,sideSpan[door]-2*wall));
      for (let t = 0; t <= length + 4; t += 1.5) ctx.addNav(x + nx * t, z + nz * t);
    }
    if (windows) for (const side of Object.keys(sides)) { if(side===door)continue; const frame=facadeFrame(building,side); ctx.addStructure({type:'windows',side,frame,x:frame.origin.x,y:baseY+h*.45,z:frame.origin.z,w:frame.span,rot:Math.atan2(frame.tangent.z,frame.tangent.x),rows:Math.max(1,Math.floor(h/3))}); }
    return x;
  };

  // A multi-room building: an outer shell plus interior partition walls that
  // leave doorways between rooms, so the interior is genuinely walkable and
  // reads as more than a hollow box. `rooms` is a grid [cols, rows]; each
  // partition gets a door gap centred on the wall. The shell reuses the
  // single-room builder so collision/doors/nav stay consistent.
  ctx.addCompound = (o) => {
    const { x, z, w, d, h = 6, rot = 0, rooms = [2, 1], wall = 0.5, door = 'south', doorWidth = 2.2, roof = 'gable', color, windows = true, y } = o;
    const q = quarter(rot);
    ctx.addBuilding({ x, z, w, d, h, rot, wall, door, doorWidth, roof, color, windows, y });
    const baseY=ctx.structures.findLast(s=>s.type==='building').y;
    const [cols, rows] = [Math.max(1, Math.round(rooms[0] || 1)), Math.max(1, Math.round(rooms[1] || 1))];
    const innerW = w - wall * 2, innerD = d - wall * 2;
    const place = (lx, lz, sw, sd, hh) => {
      const [rx, rz] = rotateLocal(lx, lz, q);
      const [sw2, sd2] = q % 2 === 0 ? [sw, sd] : [sd, sw];
      ctx.addBlock({ x: x + rx, z: z + rz, w: sw2, d: sd2, h: baseY + hh, kind: 'partition' });
    };
    const gap = Math.min(doorWidth, 2.4);
    for (let i = 1; i < cols; i++) {
      const lx = -innerW / 2 + (innerW * i) / cols;
      const seg = (innerD - gap) / 2;
      if (seg > 0.4) { place(lx, -innerD / 2 + seg / 2, wall, seg, h); place(lx, innerD / 2 - seg / 2, wall, seg, h); }
      else place(lx, 0, wall, innerD, h);
    }
    for (let j = 1; j < rows; j++) {
      const lz = -innerD / 2 + (innerD * j) / rows;
      const seg = (innerW - gap) / 2;
      if (seg > 0.4) { place(-innerW / 2 + seg / 2, lz, seg, wall, h); place(innerW / 2 - seg / 2, lz, seg, wall, h); }
      else place(0, lz, innerW, wall, h);
    }
    ctx.addStructure({ type: 'compound', x, z, y: baseY, w, d, h, rot, rooms: [cols, rows], roof, color, door });
    return { x, z, y: baseY, w, d, h, rooms: [cols, rows] };
  };

  // A stepped terrace: `tiers` concentric (or stacked) decks of rising height,
  // each with a ramp on alternating sides so every tier stays walkable. This is
  // the verticality primitive: a hilltop, a rooftop cluster or a ziggurat.
  ctx.addTerrace = (o) => {
    const { x, z, tiers = 3, size = 18, step = 4, rise = 1.6, rot = 0 } = o;
    const baseY = o.y ?? terrain.height(x, z);
    const q = quarter(rot);
    for (let tier = 0; tier < tiers; tier++) {
      const span = Math.max(3, size - tier * step * 2), height = baseY + rise * (tier + 1);
      ctx.addBlock({ x, z, w: span, d: span, h: height, kind: 'terrace' });
      const rampSpan = Math.max(2.5, span * 0.35), offset = span / 2 + step / 2;
      const [rx, rz] = rotateLocal(offset, 0, q);
      ctx.addBlock({ x: x + rx, z: z + rz, w: step, d: rampSpan, h: baseY + rise * tier + rise * 0.5, kind: 'ramp' });
      const [bx, bz] = rotateLocal(-offset, 0, q);
      ctx.addBlock({ x: x + bx, z: z + bz, w: step, d: rampSpan, h: baseY + rise * tier + rise * 0.5, kind: 'ramp' });
      for (let a = 0; a < 4; a++) { const angle = (a / 4) * Math.PI * 2 + Math.PI / 4; ctx.addNav(x + Math.cos(angle) * span * 0.4, z + Math.sin(angle) * span * 0.4); }
    }
    ctx.addStructure({ type: 'terrace', x, z, y: baseY, tiers, size, step, rise, rot });
    return { x, z, y: baseY, tiers };
  };

  // A vertical tower: a solid core with a ring of decks and a top platform,
  // connected by alternating ramps. Collision stays box-based; the renderer
  // smooths the silhouette. `height` is the top deck height above ground.
  ctx.addTower = (o) => {
    const { x, z, radius = 3, height = 12, decks = 3, deckSize = 7 } = o;
    const baseY = o.y ?? terrain.height(x, z);
    ctx.addBlock({ x, z, w: radius * 2, d: radius * 2, h: baseY + height, kind: 'tower' });
    for (let deck = 1; deck <= decks; deck++) {
      const y = baseY + (height * deck) / (decks + 1), angle = (deck % 2 ? 0 : Math.PI);
      ctx.addBlock({ x: x + Math.cos(angle) * deckSize, z: z + Math.sin(angle) * deckSize, w: deckSize, d: deckSize * 0.5, h: y, kind: 'deck' });
      ctx.addBlock({ x: x + Math.cos(angle + Math.PI / 2) * deckSize, z: z + Math.sin(angle + Math.PI / 2) * deckSize, w: deckSize * 0.5, d: deckSize, h: y, kind: 'deck' });
      ctx.addNav(x + Math.cos(angle) * deckSize, z + Math.sin(angle) * deckSize);
    }
    ctx.addStructure({ type: 'tower', x, z, y: baseY, radius, height, decks });
    return { x, z, y: baseY, height, decks };
  };

  // Biome-aware prop scatter. Deterministic (uses ctx.rng), respects the
  // collision/clearance rules of the underlying add* helpers, and never
  // overwrites authored props when `respectAuthored` is set.
  ctx.addBiomeProps = (o = {}) => {
    const biome = o.biome ?? spec.biome ?? 'canyon';
    const table = biomePropTable(biome);
    const count = Math.max(0, Math.round(o.count ?? 12));
    const margin = o.margin ?? 8;
    const rng = o.rng ?? rng;
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    const pick = () => { let roll = rng() * total; for (const entry of table) { roll -= entry.weight; if (roll <= 0) return entry.type; } return table[table.length - 1].type; };
    const builders = { rock: ctx.addRock, tree: ctx.addTree, crate: ctx.addCrate, barrel: ctx.addBarrel, ruin: ctx.addRuin };
    const placed = [];
    for (let i = 0; i < count; i++) {
      const x = bounds.minX + margin + rng() * (bounds.maxX - bounds.minX - margin * 2);
      const z = bounds.minZ + margin + rng() * (bounds.maxZ - bounds.minZ - margin * 2);
      const type = pick(), builder = builders[type];
      if (!builder) continue;
      const before = ctx.props.length;
      builder({ x, z, scale: 0.7 + rng() * 0.6 });
      if (ctx.props.length > before) placed.push({ type, x, z });
    }
    return placed;
  };

  // Points are authored FLOOR coordinates [x,y,z]; omitted Y samples the
  // triangulated ground once. No consumer independently re-samples or offsets Y.
  ctx.addTunnel = (rawPoints, radius = 3) => {
    if(!Array.isArray(rawPoints)||rawPoints.length<2||!Number.isFinite(radius)||radius<2)throw new RangeError('Tunnel needs two points and radius >= 2');
    const points=rawPoints.map(p=>{
      if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[2])||(p[1]!==undefined&&!Number.isFinite(p[1])))throw new TypeError('Invalid tunnel floor point');
      const y=p[1]??terrainSupportAt(p[0],p[2],terrain)?.y;
      if(!Number.isFinite(y))throw new RangeError('Unsupported tunnel point');
      return [p[0],y,p[2]];
    });
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],length=Math.hypot(b[0]-a[0],b[2]-a[2]);
      if(length<1e-6)throw new RangeError('Tunnel segments need horizontal extent');
      if(Math.atan2(Math.abs(b[1]-a[1]),length)>(terrain.maxSlope??.85))throw new RangeError('Tunnel floor exceeds terrain maxSlope');
      const n=Math.ceil(length/1.5);for(let k=0;k<=n;k++)ctx.addNav(a[0]+(b[0]-a[0])*k/n,a[2]+(b[2]-a[2])*k/n);
    }
    ctx.addStructure({type:'tunnel',points,floorPoints:points,radius});
    return points;
  };

  // Realization follows layout so connected portals do not depend on whether
  // the cavern or its crossing tunnel was authored first.
  ctx.addCavern = (o) => {
    const {x,z,radius=12,height=8}=o;
    if(![x,z,radius,height].every(Number.isFinite)||radius<3||height<4)throw new RangeError('Invalid cavern dimensions');
    return ctx.addStructure({type:'cavern',x,z,y:o.y??terrainSupportAt(x,z,terrain)?.y,radius,height});
  };

  ctx.addArch = (o) => ctx.addStructure({ type: 'arch', ...o });
  ctx.addColumn = (o) => { ctx.addStructure({ type: 'column', ...o }); if (o.collide !== false) ctx.addBlock({ x: o.x, z: o.z, w: (o.radius ?? 0.6) * 2, d: (o.radius ?? 0.6) * 2, h: (o.y ?? terrain.height(o.x, o.z)) + (o.height ?? 5), kind: 'column' }); };
  ctx.addBridge = (o) => { ctx.addStructure({ type: 'bridge', ...o }); const q = quarter(o.rot ?? 0), [w, d] = q % 2 === 0 ? [o.w, o.d] : [o.d, o.w]; ctx.addBlock({ x: o.x, z: o.z, w, d, h: (o.y ?? terrain.height(o.x, o.z)) + (o.thickness ?? 0.4), kind: 'deck' }); };
  // Explicit opt-in map reauthoring, not a reinterpretation of legacy bridges.
  // A filled platform and two end ramps replace ONLY their ground footprints.
  // All visible tops/sides use existing terrain triangles and foundation fill;
  // the descriptor is audit metadata, never a second collision/render surface.
  ctx.addCauseway = ({x,z,w,d,rot=0,y,ramp=4,rise=.5}) => {
    if(![x,z,w,d,rot,ramp,rise].every(Number.isFinite)||w<=0||d<2||ramp<2||Math.abs(rot/(Math.PI/2)-Math.round(rot/(Math.PI/2)))>1e-8)throw new RangeError('Causeway requires finite dimensions and an explicit quarter turn');
    const q=quarter(rot),[fw,fd]=q%2?[d,w]:[w,d], [nx,nz]=rotateLocal(1,0,q);
    const footprint=[[x-fw/2,z-fd/2],[x+fw/2,z-fd/2],[x+fw/2,z+fd/2],[x-fw/2,z+fd/2]];
    const support=terrainFootprintRange(terrain,footprint);
    if(!support||support.area<fw*fd-1e-6)throw new RangeError('Unsupported causeway');
    const top=y??support.max+rise;
    if(!Number.isFinite(top)||top<=0)throw new RangeError('Invalid causeway top');
    // Resolve both toes before editing. The one-unit landing keeps the actor
    // radius clear of the ground-to-top foundation before starting descent.
    const ends=[-1,1].map(sign=>{
      const edge=[x+nx*sign*w/2,top,z+nz*sign*w/2];
      const landing=[edge[0]+nx*sign,top,edge[2]+nz*sign];
      const toe=[landing[0]+nx*sign*ramp,0,landing[2]+nz*sign*ramp];
      toe[1]=terrainSupportAt(toe[0],toe[2],terrain)?.y;
      if(!Number.isFinite(toe[1])||Math.abs(top-toe[1])/ramp>.5)throw new RangeError('Causeway needs a longer supported ramp');
      return {edge,landing,toe};
    });
    stampTerrainFloor(terrain,footprint,()=>top,'causeway-floor');
    ctx.addBlock({x,z,w:fw,d:fd,h:top,kind:'foundation'});
    for(const {edge,landing,toe} of ends){
      floorStrip(edge,landing,d,'causeway-floor',{skirts:true});
      floorStrip(landing,toe,d,'causeway-ramp',{skirts:true});
    }
    floorStrip(ends[0].edge,ends[1].edge,d,'causeway-floor');
    return ctx.addStructure({type:'causeway',x,z,y:top,w,d,rot:q*Math.PI/2,
      accessPath:[ends[0].toe,ends[0].landing,ends[0].edge,[x,top,z],ends[1].edge,ends[1].landing,ends[1].toe]});
  };
  const blocksApproach = (x, z, radius) => ctx.navNodes.some(p => Math.abs(x - p.x) < radius + 1 && Math.abs(z - p.z) < radius + 1);
  ctx.addRock = (o = {}) => { const x = o.x, z = o.z, s = o.scale ?? 1, seed = Math.floor(rng() * 1e6); if (o.collide !== false && s > .8 && blocksApproach(x, z, s)) return; ctx.addProp({ type: 'rock', x, z, y: o.y ?? terrain.height(x, z), scale: s, seed }); if (o.collide !== false && s > 0.8) ctx.addBlock({ x, z, w: s * 2, d: s * 2, h: (o.y ?? terrain.height(x, z)) + s * 1.4, kind: 'rock' }); };
  ctx.addTree = (o = {}) => { const x = o.x, z = o.z, s = o.scale ?? 1, seed = Math.floor(rng() * 1e6); if (o.collide !== false && blocksApproach(x, z, .25)) return; ctx.addProp({ type: 'tree', x, z, y: o.y ?? terrain.height(x, z), scale: s, seed }); if (o.collide !== false) ctx.addBlock({ x, z, w: .5, d: .5, h: (o.y ?? terrain.height(x, z)) + 2.4, kind: 'tree' }); };
  ctx.addCrate = (o = {}) => { const x = o.x, z = o.z, s = o.scale ?? 1; if (o.collide !== false && blocksApproach(x, z, s * .7)) return; ctx.addProp({ type: 'crate', x, z, y: o.y ?? terrain.height(x, z), scale: s }); if (o.collide !== false) ctx.addBlock({ x, z, w: s * 1.4, d: s * 1.4, h: (o.y ?? terrain.height(x, z)) + s * 1.4, kind: 'crate' }); };
  ctx.addBarrel = (o = {}) => { const x = o.x, z = o.z; ctx.addProp({ type: 'barrel', x, z, y: o.y ?? terrain.height(x, z), scale: o.scale ?? 1 }); };
  ctx.addRuin = (o = {}) => ctx.addProp({ type: 'ruin', x: o.x, z: o.z, y: o.y ?? terrain.height(o.x, o.z), scale: o.scale ?? 1, rot: o.rot ?? 0, seed: Math.floor(rng() * 1e6) });

  spec.layout?.(ctx, rng);

  const tunnels=ctx.structures.filter(s=>s.type==='tunnel'),caverns=ctx.structures.filter(s=>s.type==='cavern');
  const tunnelSegments=tunnels.flatMap(s=>s.floorPoints.slice(1).map((b,i)=>({a:s.floorPoints[i],b,radius:s.radius})));
  for(const c of caverns){
    const polygon=Array.from({length:32},(_,i)=>{const a=i*Math.PI/16;return [c.x+Math.cos(a)*c.radius,c.z+Math.sin(a)*c.radius];});
    stampTerrainFloor(terrain,polygon,()=>c.y,'cavern-floor');
    c.openSegments=[];
    for(let i=0;i<CAVERN_SEGMENTS;i++){
      const a=i*Math.PI*2/CAVERN_SEGMENTS,x=c.x+Math.cos(a)*c.radius,z=c.z+Math.sin(a)*c.radius,size=c.radius*.45;
      const connected=tunnelSegments.some(s=>{const p=pathFloorAt(x,z,s.a,s.b);return Math.hypot(p.x-x,p.z-z)<s.radius+size/Math.SQRT2+.52;});
      if(cavernOpening(i)||connected){c.openSegments.push(i);continue;}
      ctx.addBlock({x,z,w:size,d:size,h:c.y+cavernShell(c.radius,c.height).wallHeight,kind:'cave'});
    }
    // Default opposite portals receive real floor approaches, not just a hole
    // in the visible drum. Connected tunnel strips below take precedence.
    for(const a of [Math.PI/16,Math.PI+Math.PI/16]){
      const nx=Math.cos(a),nz=Math.sin(a);
      approach(c.x+nx*(c.radius-1),c.z+nz*(c.radius-1),c.y,nx,nz,Math.max(1.4,c.radius*.3));
    }
  }
  for(const s of tunnels){
    const points=s.floorPoints;
    for(const [p,n] of [[points[0],points[1]],[points.at(-1),points.at(-2)]]){
      if(caverns.some(c=>Math.hypot(c.x-p[0],c.z-p[2])<c.radius))continue;
      const length=Math.hypot(p[0]-n[0],p[2]-n[2]);
      approach(p[0],p[2],p[1],(p[0]-n[0])/length,(p[2]-n[2])/length,s.radius*2);
    }
    for(let i=0;i<points.length-1;i++)floorStrip(points[i],points[i+1],s.radius*2,'tunnel-floor');
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length,count=Math.ceil(length/1.2);
      for(let k=0;k<=count;k++)for(const side of [-1,1]){
        const t=k/count,offset=s.radius*.95+Math.SQRT2*.8,x=a[0]+dx*t+nx*side*offset,z=a[2]+dz*t+nz*side*offset,y=a[1]+(b[1]-a[1])*t;
        if(caverns.some(c=>Math.hypot(c.x-x,c.z-z)<c.radius+Math.SQRT2*.8))continue;
        // An inner bend or another crossing route must not be sealed by a
        // neighbouring segment's conservative axis-aligned wall proxy.
        if(tunnelSegments.some(seg=>{const p=pathFloorAt(x,z,seg.a,seg.b);return Math.hypot(p.x-x,p.z-z)<Math.SQRT2*.8+.6;}))continue;
        ctx.addBlock({x,z,w:1.6,d:1.6,h:y+s.radius+1.4,kind:'tunnel'});
      }
    }
  }

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
  // Connected objective placement: lay a short nav chain between every pair of
  // consecutive objectives and from each team spawn to the nearest objective.
  // The grid above guarantees coverage; these chains guarantee the *authored*
  // objective order is walkable even when an objective sits on a deck or across
  // a narrow gap the coarse grid might straddle.
  const navChain = (ax, az, bx, bz) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
    for (let i = 0; i <= steps; i++) ctx.addNav(ax + (bx - ax) * i / steps, az + (bz - az) * i / steps);
  };
  const orderedObjectives = [...ctx.objectiveZones].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  for (let i = 1; i < orderedObjectives.length; i++) navChain(orderedObjectives[i - 1].x, orderedObjectives[i - 1].z, orderedObjectives[i].x, orderedObjectives[i].z);
  for (const team of [0, 1]) for (const [sx, sz] of ctx.teamSpawns[team]) {
    let nearest = null, bestDistance = Infinity;
    for (const zone of orderedObjectives) { const d = Math.hypot(zone.x - sx, zone.z - sz); if (d < bestDistance) { bestDistance = d; nearest = zone; } }
    if (nearest) navChain(sx, sz, nearest.x, nearest.z);
  }
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
    id: spec.id, name: spec.name ?? spec.id, tag: spec.tag, description: spec.description, color: spec.color, background: spec.background,
    bounds, terrain, blocks: ctx.blocks, spawns: ctx.spawns, pickups: ctx.pickups, navNodes: ctx.navNodes,
    objectiveZones: ctx.objectiveZones, vehicles: ctx.vehicles, traversal: ctx.traversal,
    structures: ctx.structures, props: ctx.props, nextGen: true,
    // A kill plane below the terrain so any impossible fall still resolves to a death.
    voidY: spec.voidY ?? (terrain.base - terrain.amplitude - (spec.relief ?? 1.6) - 16),
  };
  if (ctx.teamSpawns[0].length) { map.teamSpawns = ctx.teamSpawns; }
  const authoredFlags = ctx.flagSpawns && (ctx.flagSpawns[0] || ctx.flagSpawns[1]) ? ctx.flagSpawns : null;
  const pair = value => Array.isArray(value) ? [value[0], value[1]] : value && Number.isFinite(value.x) ? [value.x, value.z] : null;
  if (authoredFlags && pair(authoredFlags[0]) && pair(authoredFlags[1])) {
    map.flagSpawns = { 0: pair(authoredFlags[0]), 1: pair(authoredFlags[1]) }; map.flags = map.flagSpawns;
  } else if (spec.flagSpawns) { map.flagSpawns = spec.flagSpawns; map.flags = spec.flagSpawns; }
  else if (spec.ctf === true && ctx.teamSpawns[0].length) { map.flagSpawns = { 0: ctx.teamSpawns[0][0], 1: ctx.teamSpawns[1][0] }; }
  if (map.flagSpawns) {
    map.flagSpawns = Object.fromEntries(Object.entries(map.flagSpawns).map(([team, point]) => [team, clearSpot(...pair(point), .65)]));
    map.flags = map.flagSpawns;
  }
  // Schema validation pass: reject degenerate layouts before they reach the
  // simulation. `spec.validate === false` opts a fixture out (tests only).
  const schemaErrors = validateMapSchema(map);
  if (schemaErrors.length && spec.validate !== false) throw new Error(`${spec.id}: invalid map schema — ${schemaErrors.join('; ')}`);
  map.schemaErrors = schemaErrors;
  return map;
}

// Rejection helper used by tests and tooling: a layout is degenerate when the
// schema is invalid, when it has no walkable objective, or when a required
// placement still sits inside a solid. Returns a reason string, or null.
export function degenerateLayout(map) {
  const errors = validateMapSchema(map);
  if (errors.length) return errors.join('; ');
  if (!map.objectiveZones?.length) return 'no objective zones';
  if (!map.navNodes?.length) return 'no nav nodes';
  if (!map.spawns?.length && !Object.values(map.teamSpawns || {}).some(list => list?.length)) return 'no spawns';
  return null;
}

