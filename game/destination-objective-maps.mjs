// Destination objective maps. Layout first, dressing second: the route and
// marker reservations below are also useful to the serialized traversal audit.
import {createLevel} from './levelgen.mjs';
import {freeze, wall} from './map-schema.mjs';

const segmentDistance = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};

// A single supported ground surface, with material changes rather than noisy
// height changes. Only addCauseway subsequently raises the traversable ground.
const ground = (bounds, materialAt) => {
  const buckets = new Map();
  for (let x = bounds.minX; x < bounds.maxX; x += 6) {
    for (let z = bounds.minZ; z < bounds.maxZ; z += 6) {
      const x1 = Math.min(x + 6, bounds.maxX), z1 = Math.min(z + 6, bounds.maxZ);
      const material = materialAt((x + x1) / 2, (z + z1) / 2);
      if (!buckets.has(material)) buckets.set(material, {id: `ground-${material}`, material, vertices: [], triangles: []});
      const surface = buckets.get(material), index = surface.vertices.length;
      surface.vertices.push([x, 0, z], [x, 0, z1], [x1, 0, z1], [x1, 0, z]);
      surface.triangles.push([index, index + 1, index + 2], [index, index + 2, index + 3]);
    }
  }
  return {surfaces: [...buckets.values()], walls: [], maxSlope: .85, height: () => 0, base: 0, amplitude: 0};
};

const route = (id, label, width, points) => ({id, label, width, points});
const reserve = (ctx, routes) => {
  for (const {points} of routes) for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
    for (let j = 0; j <= steps; j++) ctx.addNav(a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps);
  }
  const markers = [...ctx.spawns, ...Object.values(ctx.teamSpawns).flat(),
    ...ctx.pickups.map(([, x, z]) => [x, z]), ...Object.values(ctx.flagSpawns).map(p => [p.x, p.z]),
    ...ctx.objectiveZones.map(p => [p.x, p.z]), ...ctx.vehicles.map(p => [p.x, p.z])];
  for (const [x, z] of markers) ctx.addNav(x, z);
  return (x, z, radius) => !markers.some(p => Math.hypot(x - p[0], z - p[1]) < radius + 3)
    && !routes.some(r => r.points.slice(1).some((b, i) => segmentDistance(x, z, r.points[i], b) < radius + r.width / 2))
    && !ctx.blocks.some(b => Math.abs(x - b.x) < b.w / 2 + radius + .75 && Math.abs(z - b.z) < b.d / 2 + radius + .75);
};

// The stock building roof/windows are supported independently of its collision
// walls. Open its opposite wall too, producing a real through-room rather than
// a one-door pickup trap. All local/world axes here are deliberately unrotated.
const throughRoom = (ctx, {x, z, w = 18, d = 12, h = 5, roof = 'gable', label}) => {
  const thickness = .6, doorWidth = 5;
  ctx.addBuilding({x, z, w, d, h, wall: thickness, door: 'west', doorWidth, roof, windows: true});
  const east = x + w / 2 - thickness / 2;
  ctx.blocks = ctx.blocks.filter(b => !(b.kind === 'building' && Math.abs(b.x - east) < .001 && b.z === z && b.w === thickness && b.d === d));
  const length = (d - doorWidth) / 2;
  for (const side of [-1, 1]) ctx.addBlock(wall(east, z + side * (doorWidth / 2 + length / 2), thickness, length, h, 'building'));
  ctx.structures = ctx.structures.filter(s => !(s.type === 'windows' && s.side === 'east' && s.frame.parent.x === x && s.frame.parent.z === z));
  for (let px = x - w / 2 - 4; px <= x + w / 2 + 4; px += 1.5) ctx.addNav(px, z);
  const room = ctx.structures.findLast(s => s.type === 'building');
  room.label = label;
  room.exits = [{x: x - w / 2, y: 0, z}, {x: x + w / 2, y: 0, z}];
};

// Arch posts have actual collision, while the high arch span remains clear.
const gateway = (ctx, x, z, width, height, rot = Math.PI / 2) => {
  ctx.addArch({x, y: 0, z, width, height, rot});
  for (const sign of [-1, 1]) ctx.addBlock(wall(x + Math.cos(rot) * width / 2 * sign,
    z - Math.sin(rot) * width / 2 * sign, .8, .8, height, 'pillar'));
};

const vehicle = (id, kind, x, z, team) => ({id, kind, x, y: 0, z, team, yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2});
const landmark = (label, x, z, y = 3) => ({label, x, z, y});

// Barrels, ice spikes and ruins are visual-only in levelgen. Supply conservative
// proxies explicitly; use hidden next-gen proxy kinds, not duplicate box meshes.
const solidDressing = (ctx, type, x, z, scale) => {
  if (type === 'iceSpike') {
    ctx.addProp({type, x, z, y: 0, scale, seed: 70});
    ctx.addBlock(wall(x, z, scale * 1.1, scale * 1.1, scale * 2.2, 'rock'));
  } else {
    ctx[`add${type[0].toUpperCase()}${type.slice(1)}`]({x, z, scale});
    if (type === 'barrel') ctx.addBlock(wall(x, z, scale, scale, scale * 1.16, 'crate'));
    if (type === 'ruin') {
      const p = ctx.props.at(-1), count = 2 + p.seed % 3;
      for (let i = 0; i < count; i++) {
        const angle = p.seed * .7 + i * 1.05, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
        ctx.addBlock(wall(x + Math.cos(angle) * 1.3 * scale, z + Math.sin(angle) * 1.3 * scale,
          (2.6 * c + .45 * s) * scale, (.45 * c + 2.6 * s) * scale, 2.7 * scale, 'rock'));
      }
    }
  }
};

// -------------------------------------------------------------------------
// TIDAL CITADEL — reflection across X preserves each team's distances, cover,
// weapon access, three gate widths and vehicle bays, including the flank rooms.
// -------------------------------------------------------------------------
const tidalBounds = {minX: -90, maxX: 90, minZ: -54, maxZ: 54};
const tidalRoutes = [
  route('tidal-gate-road', 'Tide Gate / armoured road', 12, [[-72, 0], [-54, 0], [-26, 0], [0, 8], [26, 0], [54, 0], [72, 0]]),
  route('tidal-ice-gallery', 'Ice Gallery / covered infantry flank', 5, [[-72, 0], [-72, -30], [-38, -30], [0, -30], [38, -30], [72, -30], [72, 0]]),
  route('tidal-seawall', 'Seawall / ramped coastal flank', 6, [[-72, 0], [-72, 30], [-44, 30], [0, 30], [44, 30], [72, 30], [72, 0]]),
  ...[-1, 1].map(s => route(`tidal-cross-${s}`, 'Gatehouse cross passage', 6, [[s * 24, -42], [s * 24, -30], [s * 24, 0], [s * 24, 30], [s * 24, 42]])),
];

const tidalCitadel = createLevel({
  id: 'tidal-citadel', name: 'Tidal Citadel', tag: 'COASTAL FORTRESS / THREE-ROUTE CTF',
  description: 'Two snowbound naval forts face the Tide Engine. Carry the flag through vaulted Ice Galleries, the broad gate road, or a low ramped seawall above the frozen harbour. Cross passages turn every assault into a choice of loops.',
  color: '#afd5e5', background: '#122d40', seed: 931701, bounds: tidalBounds,
  terrain: ground(tidalBounds, (x, z) => z > 40 ? 'ice' : Math.abs(z) < 9 || Math.abs(x) > 60 && Math.abs(z) < 24 ? 'concrete' : 'snow'),
  biome: 'snow', relief: 0,
  layout(ctx) {
    // All required markers are placed before any cover or decorative scatter.
    ctx.teamSpawns = {0: [[-80, -10], [-80, 10], [-76, -17], [-76, 17]], 1: [[80, -10], [80, 10], [76, -17], [76, 17]]};
    ctx.spawns = [...ctx.teamSpawns[0].map(p => [...p]), ...ctx.teamSpawns[1].map(p => [...p]), [-52, -30], [52, -30], [-58, 30], [58, 30]];
    ctx.flagSpawns = {0: {x: -72, z: 0}, 1: {x: 72, z: 0}};
    for (const [x, z, label] of [[-48, 0, 'WEST TIDE GATE'], [0, 8, 'TIDE ENGINE'], [48, 0, 'EAST TIDE GATE']]) {
      ctx.addObjective(x, z, 5); ctx.objectiveZones.at(-1).label = label;
    }
    for (const sign of [-1, 1]) {
      for (const [kind, x, z] of [
        ['health', 80, -4], ['armor', 80, 4], ['scatter', 66, -14], ['plasma', 66, 14],
        ['rocket', 44, 14], ['rail', 38, -30], ['health', 44, 30], ['grenade', 54, -42],
        ['flak', 18, 20], ['recon', 18, -42], ['cloak', 54, 42], ['haste', 56, 10], ['overcharge', 38, 42],
      ]) ctx.addPickup(kind, sign * x, z);
      const team = sign < 0 ? 0 : 1;
      ctx.addVehicle(vehicle(`tidal-${team}-puma`, 'puma', sign * 56, -12, team));
      ctx.addVehicle(vehicle(`tidal-${team}-scout`, 'scout', sign * 60, 40, team));
    }
    ctx.addPickup('overshield', 0, 30);
    ctx.addPickup('shock', 0, -30);
    const clear = reserve(ctx, tidalRoutes);

    for (const sign of [-1, 1]) {
      // A flag courtyard with a 16 m front gate and independent 10 m side gates.
      ctx.addBlock(wall(sign * 86, 0, 1.2, 46, 6.5, 'base-wall'));
      for (const side of [-1, 1]) {
        ctx.addBlock(wall(sign * 60, side * 16, 1.2, 16, 5.6, 'base-wall'));
        ctx.addBlock(wall(sign * 63, side * 23, 8, 1.2, 5.6, 'base-wall'));
        ctx.addBlock(wall(sign * 82, side * 23, 10, 1.2, 5.6, 'base-wall'));
        ctx.addColumn({x: sign * 61, z: side * 22, y: 0, radius: 1.4, height: 8.5});
        ctx.addColumn({x: sign * 84, z: side * 22, y: 0, radius: 1.1, height: 7});
      }
      gateway(ctx, sign * 60, 0, 16, 6.2);
      gateway(ctx, sign * 72, -23, 10, 5, 0);
      gateway(ctx, sign * 72, 23, 10, 5, 0);
      throughRoom(ctx, {x: sign * 38, z: -30, w: 20, d: 14, h: 5.6, label: sign < 0 ? 'WEST ICE GALLERY' : 'EAST ICE GALLERY'});
      throughRoom(ctx, {x: sign * 44, z: 30, w: 16, d: 14, h: 4.7, roof: 'flat', label: sign < 0 ? 'WEST BOAT HOUSE' : 'EAST BOAT HOUSE'});
      // Short screens break the fort-to-fort ray without blocking the gate road.
      for (const [x, z, w, d] of [[39, -10, 8, 2], [30, 15, 6, 2], [13, -18, 4, 2], [13, 20, 3, 2], [46, -44, 5, 2], [30, 44, 5, 2]]) {
        ctx.addBlock(wall(sign * x, z, w, d, 1.7, 'cover'));
      }
      // Perimeter merlons leave broad walking gaps and a readable fortress edge.
      for (const x of [12, 36, 60, 80]) {
        ctx.addBlock(wall(sign * x, -50, 7, 2, 3.6, 'base-wall'));
        ctx.addBlock(wall(sign * x, 50, 7, 2, 1.8, 'base-wall'));
      }
    }

    // The engine is a vertical silhouette, not a disconnected playable tower.
    ctx.addColumn({x: 0, y: 0, z: -10, radius: 3.2, height: 16});
    for (const x of [-6, 6]) ctx.addColumn({x, y: 0, z: -10, radius: .9, height: 8});
    gateway(ctx, 0, -10, 12, 9, 0);
    ctx.addCauseway({x: 0, z: -30, w: 20, d: 8, y: 1.2, ramp: 8});
    ctx.addCauseway({x: 0, z: 30, w: 24, d: 8, y: 1.2, ramp: 8});
    // Offset buttresses protect the ramped walk without sealing its toes.
    for (const x of [-8, 8]) for (const z of [-36, 36]) ctx.addBlock(wall(x, z, 4, 1.4, 2.4, 'cover'));

    // Mirrored authored dressing; a candidate is accepted only as a pair.
    for (const [type, x, z, scale] of [
      ['rock', 8, -44, 2.1], ['rock', 18, 46, 1.8], ['rock', 48, -18, 1.4],
      ['crate', 34, -24, 1.1], ['crate', 48, 24, 1.2], ['crate', 81, 15, 1],
      ['barrel', 32, 37, 1.2], ['barrel', 51, -36, 1.1], ['tree', 80, -42, 1.6],
      ['tree', 68, -46, 1.4], ['iceSpike', 6, 47, 1.8], ['iceSpike', 44, 47, 1.3],
      ['iceSpike', 78, 48, 2.1], ['rock', 86, 35, 1.6],
    ]) {
      const radius = type === 'tree' ? scale * 1.2 : scale * 1.4;
      if (!clear(x, z, radius) || !clear(-x, z, radius)) continue;
      for (const sign of [-1, 1]) {
        solidDressing(ctx, type, sign * x, z, scale);
      }
    }
  },
});
tidalCitadel.biome = 'snow';
tidalCitadel.sky = 'day';
tidalCitadel.timeOfDay = false;
tidalCitadel.scatter = false;
tidalCitadel.floorColor = '#b9d0da';
tidalCitadel.arena = {group: 'outdoor', scale: 'warzone', play: ['ctf', 'teamdeathmatch', 'domination', 'assault', 'team-elimination']};
tidalCitadel.routes = tidalRoutes;
tidalCitadel.landmarks = [landmark('WEST CITADEL', -72, 0), landmark('EAST CITADEL', 72, 0),
  landmark('TIDE ENGINE', 0, -10, 17), landmark('ICE GALLERY', 0, -30, 3.2), landmark('FROZEN HARBOUR', 0, 46),
  landmark('SEAWALL WALK', 0, 30, 3.2), landmark('WEST BOAT HOUSE', -44, 30), landmark('EAST BOAT HOUSE', 44, 30)];

// -------------------------------------------------------------------------
// SUNSCAR CONVOY — a dogleg freight road, not a reskin of a straight lane.
// Payload currently anchors to FIRST TEAM SPAWNS. Those deliberately match the
// first/last objectives; the physical refinery dividers force the two bends.
// -------------------------------------------------------------------------
const sunscarBounds = {minX: -96, maxX: 96, minZ: -60, maxZ: 60};
const freightRoad = [[-78, -10], [-54, -10], [-44, 18], [0, 18], [14, -18], [54, -18], [78, -18]];
const sunscarRoutes = [
  route('sunscar-freight-road', 'Freight road / three-phase escort', 12, freightRoad),
  route('sunscar-quarry-flank', 'Quarry cut / infantry bypass', 5, [[-78, -10], [-80, -10], [-80, -42], [-44, -42], [-40, -53], [-30, -53], [-20, -53], [-16, -42], [-16, -18], [14, -18]]),
  route('sunscar-aqueduct-flank', 'Aqueduct / infantry bypass', 5, [[-44, 18], [-44, 43], [-16, 43], [16, 43], [20, 53], [30, 53], [40, 53], [42, 43], [78, 43], [84, 43], [84, -18], [78, -18]]),
  route('sunscar-south-service', 'Refinery service loop', 6, [[-16, -18], [-18, -18], [-18, -42], [16, -42], [44, -42], [44, -38], [60, -38], [76, -38], [76, -18], [78, -18]]),
  route('sunscar-motor-pool', 'Loading yard / vehicle deployment', 9, [[-78, 30], [-44, 30], [-44, 18]]),
];

const sunscarConvoy = createLevel({
  id: 'sunscar-convoy', name: 'Sunscar Convoy', tag: 'CANYON FREIGHT ROUTE / PAYLOAD + COMBINED ARMS',
  description: 'Escort a freight convoy from the Broken Weighbridge, weave around the towering Twin Retorts, and deliver beneath the Sun Gate ruins. Broad armour turns compete with quarry rooms, service alleys, and a ramped aqueduct flank.',
  color: '#d8a16e', background: '#412620', seed: 931702, bounds: sunscarBounds,
  terrain: ground(sunscarBounds, (x, z) => freightRoad.slice(1).some((b, i) => segmentDistance(x, z, freightRoad[i], b) < 7) ? 'dirt' : x > 42 && z > 8 ? 'stone' : 'sand'),
  biome: 'canyon', relief: 0,
  layout(ctx) {
    ctx.teamSpawns = {0: [[-78, -10], [-86, -28], [-86, 2], [-76, 16]], 1: [[78, -18], [86, -28], [86, 2], [78, 12]]};
    ctx.spawns = [...ctx.teamSpawns[0].map(p => [...p]), ...ctx.teamSpawns[1].map(p => [...p]), [-54, 18], [-16, -42], [16, 43], [54, -42]];
    for (const [x, z, label] of [[-78, -10, 'BROKEN WEIGHBRIDGE'], [0, 18, 'TWIN RETORTS'], [78, -18, 'SUN GATE DELIVERY']]) {
      ctx.addObjective(x, z, 6); ctx.objectiveZones.at(-1).label = label;
    }
    for (const [kind, x, z] of [
      ['health', -86, -12], ['armor', -86, -4], ['scatter', -62, -30], ['plasma', -62, 6],
      ['rocket', -44, -42], ['rail', -60, -42], ['grenade', -48, 42], ['haste', -68, 20],
      ['health', -16, 18], ['armor', 16, -18], ['shock', -12, -26], ['flak', 8, 30],
      ['recon', -8, 43], ['cloak', 8, -42], ['overshield', 0, 0], ['overcharge', 60, 24],
      ['rocket', 44, 43], ['rail', 60, 43], ['health', 86, -12], ['armor', 86, -4],
      ['plasma', 54, -30], ['scatter', 72, 6], ['marksman', 50, 10], ['smg', -50, 4],
    ]) ctx.addPickup(kind, x, z);
    for (const sign of [-1, 1]) {
      const team = sign < 0 ? 0 : 1;
      // Aircraft pads stay beyond the road and room roofs; Titans deploy onto
      // the open yard rather than facing a narrow infantry doorway.
      for (const [kind, x, z] of [['puma', 62, -4], ['titan', 52, 8], ['scout', 82, -44], ['transport', 64, 44], ['hornet', 84, 46]]) {
        ctx.addVehicle(vehicle(`sunscar-${team}-${kind}`, kind, sign * x, z, team));
      }
    }
    const clear = reserve(ctx, sunscarRoutes);

    // PHASE 1: weighbridge. Split loading sheds, a gantry, and a quarry bench.
    throughRoom(ctx, {x: -62, z: -30, w: 18, d: 10, h: 4.6, roof: 'flat', label: 'QUARRY STORES'});
    throughRoom(ctx, {x: -58, z: 20, w: 18, d: 10, h: 5.2, label: 'FREIGHT OFFICE'});
    gateway(ctx, -78, -10, 18, 6.5);
    ctx.addCauseway({x: -60, z: -42, w: 18, d: 7, y: 1.2, ramp: 7});
    for (const z of [-50, 50]) for (const x of [-88, -72, -54]) {
      ctx.addColumn({x, z, y: 0, radius: 1.2, height: x === -72 ? 9 : 6});
    }
    for (const [x, z, w, d, h] of [[-89, 18, 3, 18, 4], [-70, 4, 8, 2, 2], [-60, 2, 7, 2, 1.8], [-84, -40, 5, 2, 1.7]]) {
      ctx.addBlock(wall(x, z, w, d, h, 'cover'));
    }

    // PHASE 2: offset refinery walls force an S-shaped ground route. Each has
    // a 6 m remote infantry opening (Z=-53 / +53) and a broad road-side turn.
    // Their tall solids are retaining walls, never advertised as playable decks.
    for (const [x, z, d] of [[-30, -22, 56], [-30, -58, 4], [30, 22, 56], [30, 58, 4]]) {
      ctx.addBlock(wall(x, z, 4, d, 7.4, 'bulkhead'));
    }
    gateway(ctx, -30, 18, 18, 7);
    gateway(ctx, 30, -18, 18, 7);
    for (const [x, z] of [[-22, -20], [-22, -32], [22, 20], [22, 32]]) {
      ctx.addColumn({x, z, y: 0, radius: 2.5, height: Math.abs(z) === 20 ? 18 : 12});
    }
    throughRoom(ctx, {x: -8, z: -28, w: 14, d: 10, h: 5.2, roof: 'flat', label: 'PUMP CONTROL'});
    throughRoom(ctx, {x: 8, z: 30, w: 14, d: 10, h: 5.8, roof: 'flat', label: 'SWITCH HOUSE'});
    ctx.addCauseway({x: -8, z: 43, w: 18, d: 6, y: 1, ramp: 6});
    for (const [x, z] of [[-12, -8], [12, 8], [-12, 30], [12, -30], [-6, 53], [6, -52]]) {
      ctx.addBlock(wall(x, z, 4, 2, 1.8, 'cover'));
    }

    // PHASE 3: a freight terminus built through a broken desert sanctuary.
    ctx.addCauseway({x: 60, z: 24, w: 24, d: 10, y: 1.5, ramp: 8});
    throughRoom(ctx, {x: 60, z: -38, w: 20, d: 12, h: 5.4, label: 'RELIC WAREHOUSE'});
    gateway(ctx, 78, -18, 20, 9);
    gateway(ctx, 60, 24, 14, 7);
    for (const x of [46, 60, 74]) for (const z of [14, 34]) {
      ctx.addColumn({x, z, y: 0, radius: 1, height: x === 60 ? 10 : 6.5});
    }
    for (const [x, z, w, d, h] of [[90, 20, 3, 20, 5], [90, -44, 3, 14, 5], [44, -6, 8, 2, 1.8], [70, -4, 6, 2, 2], [44, 36, 4, 2, 1.8], [80, 30, 3, 5, 2.4]]) {
      ctx.addBlock(wall(x, z, w, d, h, 'cover'));
    }

    // Rim strata are architectural silhouettes on flat ground; they do not
    // introduce steep terrain cells or a hidden roof route.
    for (const x of [-84, -60, -12, 12, 60, 84]) for (const sign of [-1, 1]) {
      if (clear(x, sign * 56, 3.5)) ctx.addRock({x, z: sign * 56, scale: 3.5});
    }
    for (const [type, x, z, scale] of [
      ['crate', -72, -32, 1.3], ['crate', -46, 30, 1.2], ['barrel', -74, 10, 1.3],
      ['rock', -42, -12, 2.6], ['rock', -40, -30, 2], ['ruin', -44, 50, 1.1],
      ['barrel', -18, -8, 1.5], ['barrel', 18, 8, 1.5], ['crate', -6, -20, 1.2],
      ['crate', 6, 22, 1.3], ['ruin', 50, 50, 1.5], ['ruin', 72, 52, 1.6],
      ['ruin', 88, 34, 1.1], ['rock', 40, -28, 2.2], ['barrel', 72, -30, 1.1],
      ['crate', 82, 22, 1.3], ['rock', -90, 34, 2.8], ['rock', 90, -54, 2.8],
    ]) {
      if (!clear(x, z, scale * (type === 'ruin' ? 3 : 1.5))) continue;
      solidDressing(ctx, type, x, z, scale);
    }
  },
});
sunscarConvoy.biome = 'canyon';
sunscarConvoy.sky = 'dusk';
sunscarConvoy.timeOfDay = false;
sunscarConvoy.scatter = false;
sunscarConvoy.floorColor = '#b79368';
sunscarConvoy.arena = {group: 'combined', scale: 'warzone', play: ['payload', 'assault', 'combined-arms', 'teamdeathmatch', 'domination', 'vip-escort']};
sunscarConvoy.routes = sunscarRoutes;
sunscarConvoy.landmarks = [landmark('1 / BROKEN WEIGHBRIDGE', -78, -10, 8), landmark('QUARRY CUT', -60, -42, 3),
  landmark('2 / TWIN RETORTS', 0, 18, 6), landmark('NORTH RETORT', 22, 20, 19), landmark('SOUTH RETORT', -22, -20, 19),
  landmark('AQUEDUCT FLANK', -8, 43, 3), landmark('3 / SUN GATE', 78, -18, 11), landmark('RELIC COURT', 60, 24, 4)];

tidalCitadel.collection='destinations';sunscarConvoy.collection='destinations';
export const DESTINATION_OBJECTIVE_MAPS = freeze([tidalCitadel, sunscarConvoy]);
