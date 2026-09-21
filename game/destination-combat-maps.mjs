// Authored infantry destinations. Geometry is deterministic; no scatter pass,
// roof decks, jump-only objectives or noise-height placement repairs are needed.
import {createLevel} from './levelgen.mjs';
import {freeze} from './map-schema.mjs';
import {facadeFrame} from './structures.mjs';
import {stampTerrainFloor} from './terrain.mjs';

const INFANTRY_PLAY = ['deathmatch', 'teamdeathmatch', 'instagib', 'rockets', 'arsenal', 'armsrace', 'koth', 'domination', 'holdout', 'uplink', 'horde', 'juggernaut'];
const route = (id, points, width = 3.2) => ({id, points, width});
const landmark = (label, x, z, y = 5) => ({label, x, z, y});

// Segment / expanded rectangle intersection: reserve the entire approach, not
// merely the sampled nav points. This includes each decoration's solid extent.
function crossesBox(a, b, box, margin) {
  let lo = 0, hi = 1;
  for (const [axis, half] of [[0, box.w / 2], [1, box.d / 2]]) {
    const center = axis === 0 ? box.x : box.z, delta = b[axis] - a[axis];
    const min = center - half - margin, max = center + half + margin;
    if (Math.abs(delta) < 1e-9) { if (a[axis] < min || a[axis] > max) return false; }
    else {
      const t0 = (min - a[axis]) / delta, t1 = (max - a[axis]) / delta;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      if (lo > hi) return false;
    }
  }
  return true;
}

function author(ctx, plan) {
  const anchors = [], conflicts = [];
  const reserve = (x, z, radius) => anchors.push({x, z, radius});
  for (const p of Object.values(plan.campaignAnchors || {})) reserve(p.x, p.z, p.radius);
  for (const [x, z] of plan.spawns) { ctx.addSpawn(x, z); reserve(x, z, 1.8); }
  for (const team of [0, 1]) for (const [x, z] of plan.teams[team]) { ctx.addSpawn(x, z, team); reserve(x, z, 1.8); }
  for (const [label, x, z, radius] of plan.objectives) {
    ctx.addObjective(x, z, radius); ctx.objectiveZones.at(-1).label = label;
    reserve(x, z, radius + .6);
  }
  for (const [kind, x, z] of plan.pickups) { ctx.addPickup(kind, x, z); reserve(x, z, 1.1); }
  for (const {points} of plan.routes) for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
    for (let k = 0; k <= n; k++) ctx.addNav(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n);
  }
  const solid = (x, z, w, d, h, kind = 'cover') => {
    const box = {x, z, w, d, h, kind};
    const anchorHit = anchors.some(p => Math.hypot(Math.max(0, Math.abs(x - p.x) - w / 2), Math.max(0, Math.abs(z - p.z) - d / 2)) < p.radius);
    const routeHit = plan.routes.some(r => r.points.slice(1).some((b, i) => crossesBox(r.points[i], b, box, r.width / 2)));
    if (anchorHit || routeHit) conflicts.push(`${kind} at ${x},${z}`);
    ctx.addBlock(box);
    return box;
  };
  // Multi-exit shells use supported building roofs/interior volumes and real
  // wall gaps. Windows are only attached to CLOSED facades, never across doors.
  const hall = ({x, z, w, d, h = 6, doors = ['west', 'east'], gap = 5, roof = 'flat', label}) => {
    const wall = .6, building = {type: roof === 'open' ? 'compound' : 'building', x, z, y: 0, w, d, h, wall, rot: 0, roof, door: doors[0], doorWidth: gap, doors, label};
    stampTerrainFloor(ctx.terrain, [[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]], () => 0, `${plan.id}-${label}-floor`);
    ctx.addStructure(building);
    for (const side of ['north', 'south', 'west', 'east']) {
      const alongX = side === 'north' || side === 'south', span = alongX ? w : d;
      const cx = x + (side === 'west' ? -(w - wall) / 2 : side === 'east' ? (w - wall) / 2 : 0);
      const cz = z + (side === 'north' ? -(d - wall) / 2 : side === 'south' ? (d - wall) / 2 : 0);
      if (doors.includes(side)) {
        const length = (span - gap) / 2, offset = (span + gap) / 4;
        for (const sign of [-1, 1]) solid(cx + (alongX ? sign * offset : 0), cz + (alongX ? 0 : sign * offset), alongX ? length : wall, alongX ? wall : length, h, 'building');
      } else {
        solid(cx, cz, alongX ? span : wall, alongX ? wall : span, h, 'building');
        if (roof !== 'open') ctx.addStructure({type: 'windows', frame: facadeFrame(building, side), rows: 2});
      }
    }
    // Non-walkable underside gives the visible roof authoritative projectile
    // and jump headroom collision without turning it into a disconnected floor.
    if (roof !== 'open') ctx.terrain.surfaces.push({id: `${plan.id}-${label}-ceiling`, material: 'metal', walkable: false,
      vertices: [[x-w/2, h, z-d/2], [x+w/2, h, z-d/2], [x+w/2, h, z+d/2], [x-w/2, h, z+d/2]], triangles: [[0, 1, 2], [0, 2, 3]]});
  };
  const column = (x, z, radius, height) => {
    solid(x, z, radius * 2.7, radius * 2.7, height, 'column');
    ctx.addStructure({type: 'column', x, z, y: 0, radius, height});
  };
  const arch = (x, z, width, height, rot = 0) => {
    for (const sign of [-1, 1]) solid(x + Math.cos(rot) * width / 2 * sign, z - Math.sin(rot) * width / 2 * sign, .7, .7, height, 'column');
    ctx.addArch({x, z, y: 0, width, height, rot});
    // The crown is a non-walkable collision ribbon inside the rendered torus;
    // its underside catches shots/jumps without filling the opening with a box.
    const vertices = [], triangles = [], radius = width / 2;
    for (let i = 0; i <= 16; i++) {
      const angle = Math.PI * i / 16;
      for (const r of [radius - .34, radius + .34]) {
        const local = Math.cos(angle) * r;
        vertices.push([x + Math.cos(rot) * local, height + Math.sin(angle) * r, z - Math.sin(rot) * local]);
      }
      if (i) { const n = i * 2; triangles.push([n-2, n, n+1], [n-2, n+1, n-1]); }
    }
    ctx.terrain.surfaces.push({id: `${plan.id}-arch-${x}-${z}`, material: 'stone', walkable: false, vertices, triangles});
  };
  const prop = (type, x, z, scale = 1) => {
    // Avoid uncollidable addBarrel/addRuin defaults. All tangible dressing owns
    // a matching solid; tree foliage is soft, while its scaled trunk is solid.
    const dimensions = type === 'tree' ? [.38 * scale, .38 * scale, 1.7 * scale]
      : type === 'rock' ? [2.6 * scale, 2.6 * scale, 1.5 * scale]
      : type === 'barrel' ? [scale, scale, 1.16 * scale] : [1.2 * scale, 1.2 * scale, 1.2 * scale];
    solid(x, z, ...dimensions, type === 'barrel' ? 'crate' : type);
    ctx.addProp({type, x, z, y: 0, scale, seed: type === 'crate' ? 0 : Math.floor(ctx.rng() * 100000)});
  };
  return {solid, hall, column, arch, prop, finish() {
    if (conflicts.length) throw new Error(`${plan.id}: solids overlap reserved approaches: ${conflicts.join('; ')}`);
  }};
}

function destination(spec, plan, layout) {
  const map = createLevel({...spec, amplitude: 0, relief: 0, base: 0, height: () => 0, step: 8,
    layout(ctx) { const tools = author(ctx, plan); layout(ctx, tools); tools.finish(); }});
  // A generator nudge would conceal an authored reservation mistake. Fail at
  // the source instead of silently relocating a supply or campaign encounter.
  const same = (a, b) => a.length === b.length && a.every((row, i) => row.every((value, j) => value === b[i][j]));
  if (!same(map.spawns, plan.spawns) || !same(map.pickups, plan.pickups)
    || [0, 1].some(team => !same(map.teamSpawns[team], plan.teams[team]))
    || map.objectiveZones.some((p, i) => p.x !== plan.objectives[i][1] || p.z !== plan.objectives[i][2])) {
    throw new Error(`${plan.id}: generator relocated an authored placement`);
  }
  // createLevel currently forwards geometry, not catalogue or art-direction
  // metadata. Keep the catalogue contract explicit on the exported map itself.
  Object.assign(map, {collection:'destinations',arena: {group: spec.group, scale: 'battle', play: [...INFANTRY_PLAY, ...(plan.campaignAnchors ? ['campaign'] : [])]},
    biome: spec.biome, sky: spec.sky, timeOfDay:false, floorColor: spec.floorColor, scatter: false, ...(plan.campaignAnchors ? {campaignAnchors: plan.campaignAnchors} : {}),
    landmarks: plan.landmarks,
    design: {name: spec.name, topology: plan.topology, routes: plan.routes, objectives: plan.objectives.map(([label, x, z, radius]) => ({label, x, z, radius})),
      elevation: 'Ground-supported causeways; both ends have continuous walking ramps.',
      assets: ['rough_stucco', 'rock', 'metal', 'brushed_metal', 'alien_chitin'], propBudget: 40}});
  return map;
}

const meridianPlan = {
  id: 'meridian-exchange',
  topology: 'Six connected civic buildings enclose the interchange: an archive/departure complex, customs cross-street, market/cafe circuit and signal house. Covered perimeter passages alternate with exposed ramped shortcuts.',
  spawns: [[-44,-34], [44,34], [-44,34], [44,-34], [-36,-6], [36,4], [4,-34], [8,34], [-44,10], [44,-8]],
  teams: {0: [[-44,-34], [-44,10], [-44,34], [-36,-6]], 1: [[44,34], [44,-8], [44,-34], [36,4]]},
  objectives: [['INTERCHANGE',0,0,3.5], ['DEPARTURE HALL',-14,-19,3.5], ['SIGNAL HOUSE',27,16,3.2]],
  pickups: [['rocket',-14,-19], ['rail',24,-30], ['scatter',-23,22], ['plasma',27,16], ['health',-44,-12], ['health',44,24], ['health',-6,22], ['health',12,-19],
    ['armor',-36,-19], ['armor',27,34], ['haste',-44,26], ['overcharge',0,0], ['overshield',8,16], ['recon',4,-34], ['cloak',-23,8], ['grenade',-36,34], ['shock',44,-20], ['flak',0,12], ['smg',-14,-8], ['marksman',36,-30]],
  routes: [
    route('civic-ring', [[-44,-34],[44,-34],[44,34],[-44,34],[-44,-34]]),
    route('interchange', [[-44,0],[-23,0],[-14,0],[0,0],[27,0],[44,0]]),
    route('departure-through', [[-44,-19],[-36,-19],[-14,-19],[12,-19],[36,-19],[44,-19]]),
    route('departure-plaza', [[-14,-19],[-14,-8],[-14,0]]),
    route('western-boulevard', [[-36,-34],[-36,-19],[-36,0],[-36,10],[-44,10]]),
    route('market-through', [[-44,22],[-23,22],[-6,22],[8,22],[8,34]]),
    route('market-plaza', [[-23,0],[-23,8],[-23,22],[-23,34]]),
    route('signal-through', [[0,12],[8,12],[8,16],[27,16],[44,16]]),
    route('signal-plaza', [[27,0],[27,16],[27,34]]),
    route('tram-platform', [[4,-34],[4,-30],[24,-30],[44,-30]]),
    route('east-connection', [[36,-34],[36,-19],[36,0],[44,0]]),
    route('archive-transfer', [[-14,-42],[-14,-35],[-14,-19]]),
    route('customs-cross-street', [[-44,-10],[-36,-10]]),
    route('cafe-courtyard', [[-4,22],[-4,34],[-4,41]])
  ],
  landmarks: [landmark('MERIDIAN INTERCHANGE',0,0,4), landmark('DEPARTURE HALL',-14,-19,8), landmark('SAFFRON MARKET',-23,22,7), landmark('SIGNAL HOUSE',27,16,9), landmark('TRAM PLATFORM',24,-30,4),
    landmark('CIVIC ARCHIVE',-14,-35,11),landmark('WEST CUSTOMS',-44,-10,9),landmark('NIGHT CAFE',-4,34,10)]
};

const meridian = destination({id: meridianPlan.id, name: 'Meridian Exchange', tag: 'URBAN / TRANSIT + CIVIC LOOPS', group: 'urban', biome: 'urban', sky: 'dusk',
  color: '#74ccd5', background: '#575777', floorColor: '#697a80', seed: 73021, size: {w: 104, d: 88},
  description: 'A dusk-lit metropolitan interchange: six enterable civic buildings turn the archive, customs streets and market courtyards into interlocking routes around the ramped tram plaza.'}, meridianPlan, (ctx, a) => {
  a.hall({x:-14,z:-19,w:28,d:18,h:7,doors:['west','east','south','north'],label:'departure'});
  a.hall({x:27,z:16,w:18,d:18,h:8,doors:['west','east','north','south'],label:'signal'});
  a.hall({x:-23,z:22,w:22,d:12,h:5.5,doors:['west','east','north','south'],label:'market'});
  // The perimeter now runs THROUGH districts. Archive doors also connect to
  // the departure hall; customs links the two west streets; the cafe returns
  // to the market via its north courtyard instead of being a dead-end room.
  a.hall({x:-14,z:-35,w:20,d:12,h:10,doors:['west','east','north','south'],gap:6,label:'archive'});
  a.hall({x:-44,z:-10,w:12,d:14,h:8,doors:['north','south','east'],gap:6,label:'customs'});
  a.hall({x:-4,z:34,w:16,d:14,h:5.8,doors:['west','east','north','south'],gap:6,roof:'gable',label:'cafe'});
  // Staggered ticket desks and baggage islands break the hall's long rail lane.
  a.solid(-22,-24,5,1.8,1.4); a.solid(-7,-14,5,1.8,1.4);
  a.solid(22,11,2,2,1.5); a.solid(32,21,2,2,1.5);
  a.solid(-29,25,3,1,1.3); a.solid(-17,19,3,1,1.3);
  a.solid(-25.7,-23, .6,2,3.4,'partition'); a.solid(-4.5,-15, .6,3,3.4,'partition');
  a.solid(-21,-38,3,1.2,2.4); a.solid(-7,-31.5,3,1.2,2.4);
  a.solid(-48,-14,2,2,1.6); a.solid(-9,38,2,2,2.4);
  ctx.addCauseway({x:0,z:0,w:14,d:10,rise:.9,ramp:6});
  ctx.addCauseway({x:24,z:-30,w:14,d:4,rise:.6,ramp:4});
  a.arch(0,10,11,5.5); a.arch(-36,-28,7,5);
  // Skyline pylons and planters give the streets silhouettes without sealing
  // the cross-streets; no tower has a disconnected playable deck.
  a.column(13,-10,1.1,10); a.column(-6,12,.8,6.5); a.column(39,28,.8,9);
  for (const [x,z,w,d] of [[-31,5,4,2],[13,7,3,2],[40,-10,2,3],[-31,-31,2,2],[16,30,3,2],[-8,30,3,2],[3,-12,3,2]]) a.solid(x,z,w,d,1.5);
  for (const [x,z,s] of [[-48,-26,1.8],[-48,18,1.7],[48,8,1.8],[18,38,1.6],[-16,39,1.7],[48,-28,1.8]]) a.prop('tree',x,z,s);
  for (const [x,z] of [[-30,-14],[-4,-25],[18,-24],[40,8],[-16,30]]) a.prop('crate',x,z,1.1);
  for (const [x,z] of [[-49,3],[47,29],[10,-38]]) a.prop('barrel',x,z);
});

// All five are flat, y=0 terrain anchors with a reserved 3.5 m radius. Campaign
// content can import this object without inferring floor heights from labels.
export const VERDANT_CAMPAIGN_ANCHORS = freeze({
  entrance: {label: 'FERN GATE', x: -42, y: 0, z: -36, radius: 3.5},
  encounter1: {label: 'ROOT CLOISTER', x: -28, y: 0, z: 10, radius: 3.5},
  hold: {label: 'HEART CAVERN', x: 8, y: 0, z: -4, radius: 3.5},
  encounter2: {label: 'SUN ALTAR APPROACH', x: 28, y: 0, z: 25, radius: 3.5},
  exit: {label: 'EAST GARDEN GATE', x: 40, y: 0, z: 34, radius: 3.5},
});

const verdantPlan = {
  id: 'verdant-reliquary',
  campaignAnchors: VERDANT_CAMPAIGN_ANCHORS,
  topology: 'An outer sanctuary of archive, refectory, ossuary and open astral court surrounds the cloister/cavern/altar triangle. Four-door chambers turn the garden perimeter into covered loops while preserving the northern crypt alternative.',
  spawns: [[-42,-36],[40,34],[-42,34],[40,-36],[-42,0],[40,8],[-16,-36],[28,34],[-28,30],[8,-36]],
  teams: {0: [[-42,-36],[-42,0],[-42,34],[-28,30]], 1: [[40,34],[40,8],[40,-36],[28,34]]},
  objectives: [['HEART CAVERN',8,-4,4],['ROOT CLOISTER',-28,10,3.5],['SUN ALTAR',8,25,3.5]],
  pickups: [['rocket',8,-4],['rail',8,25],['scatter',-28,10],['plasma',8,-24],['health',-42,-16],['health',40,18],['health',-28,30],['health',30,-4],
    ['armor',-16,-36],['armor',-12,25],['haste',-42,26],['overcharge',8,-10],['overshield',-28,-4],['recon',28,-36],['cloak',-28,16],['grenade',-42,-28],['shock',40,-24],['flak',28,25],['smg',-28,4],['marksman',40,30]],
  routes: [
    route('garden-ring',[[-42,-36],[40,-36],[40,34],[-42,34],[-42,-36]]),
    route('cavern-transept',[[-42,-4],[-28,-4],[-12,-4],[8,-4],[30,-4],[40,-4]]),
    route('northern-crypt',[[8,-36],[8,-24],[8,-4]]),
    route('cloister-through',[[-42,10],[-28,10],[-16,10],[-16,25]]),
    route('cloister-cross',[[-28,-4],[-28,10],[-28,30],[-28,34]]),
    route('sun-altar',[[-42,25],[-28,25],[-12,25],[8,25],[28,25],[40,25]]),
    route('west-fern-walk',[[-42,-24],[-16,-24],[-16,-36]]),
    route('archive-aisle',[[-42,-30],[-28,-30],[-16,-30]]),
    route('archive-cross',[[-28,-36],[-28,-30],[-28,-24]]),
    route('ossuary-through',[[24,10],[40,10],[49,10]]),
    route('astral-court-through',[[16,-25],[27,-25],[40,-25]]),
    route('astral-court-cross',[[27,-36],[27,-25],[27,-16]])
  ],
  landmarks: [landmark('HEART CAVERN',8,-4,14),landmark('ROOT CLOISTER',-28,10,8),landmark('SUN ALTAR',8,25,5),landmark('NORTH CRYPT',8,-24,5),landmark('FERN WALK',-28,-24,5),
    landmark('MEMORY ARCHIVE',-28,-30,11.5),landmark('EAST OSSUARY',40,10,12.5),landmark('MOSS REFECTORY',-43,25,7),landmark('ASTRAL COURT',27,-25,5)]
};

const verdant = destination({id: verdantPlan.id, name:'Verdant Reliquary',tag:'RUINS / CLOISTER + LIVING CAVERN',group:'outdoor',biome:'forest',sky:'day',
  color:'#b9d394',background:'#7faeb0',floorColor:'#527451',seed:73022,size:{w:104,d:92},
  description:'An overgrown sanctuary of memory archives, ossuary passages and a ruined astral court. Covered garden loops surround the three-mouth cavern, root cloister and ramped sun altar.'}, verdantPlan, (ctx,a) => {
  a.hall({x:-28,z:10,w:16,d:22,h:6.5,doors:['west','east','north','south'],label:'cloister'});
  a.hall({x:-28,z:-30,w:18,d:8,h:7.5,doors:['west','east','north','south'],gap:5,roof:'gable',label:'memory-archive'});
  a.hall({x:40,z:10,w:16,d:18,h:8.5,doors:['west','east','north','south'],gap:6,roof:'gable',label:'ossuary'});
  a.hall({x:-43,z:25,w:12,d:12,h:5.5,doors:['west','east','north','south'],gap:6,label:'refectory'});
  // Roofless court walls frame the old observatory arch and offer broken
  // waist/chest-height shelter without inventing another cavern dome.
  a.hall({x:27,z:-25,w:18,d:14,h:3.4,doors:['west','east','north','south'],gap:6,roof:'open',label:'astral-court'});
  a.solid(-34,-32.2,2,.8,2.5); a.solid(35,5,2,2,2.2); a.solid(45,15,2,2,2.4);
  a.solid(-47,29,1.4,1.4,2); a.solid(21,-20,2.4,1.2,1.5);
  ctx.addCavern({x:8,z:-4,radius:12,height:11});
  ctx.addTunnel([[-12,0,-4],[8,0,-4],[30,0,-4]],3.6);
  ctx.addTunnel([[8,0,-24],[8,0,-4]],3.3);
  ctx.addCauseway({x:8,z:25,w:18,d:8,rise:.8,ramp:6});
  a.arch(-28,-18,11,5.5); a.arch(-28,23,10,5.5); a.arch(32,25,11,5,Math.PI/2);
  a.arch(-4,30,8,4.5); a.arch(27,-31,10,5);
  // The broken aqueduct is an offset succession of arches and buttresses,
  // leaving fern-walk and altar circulation open rather than enclosing a box.
  a.solid(-34,-16,2,7,4,'wall'); a.solid(-21,-17,2,5,3.3,'wall');
  a.solid(-35,4,1.4,4,2.2); a.solid(-21,16,1.4,4,2.2);
  a.solid(-6,17,6,1.3,2); a.solid(25,16,1.5,7,2.5);
  a.column(-35,18,.7,5); a.column(-21,2,.7,4.2); a.column(34,-16,1,7);
  a.column(-10,30.5,.8,4); a.column(18,30.5,.8,5.5);
  for (const [x,z,s] of [[-47,-28,2.4],[-47,17,2.6],[-36,40,2.3],[-16,40,2.7],[32,40,2.5],[46,26,2.8],[46,-16,2.5],[30,-42,2.4],[-26,-42,2.5],[-4,-40,2.4],[-38,-40,2.1],[-9,16,2.2],[28,15,2.3]]) a.prop('tree',x,z,s);
  for (const [x,z,s] of [[-47,-10,1.2],[-47,7,1.1],[-35,30,1.1],[-7,38,1.2],[26,39,1.1],[46,4,1.2],[33,-29,1.1],[-25,-39.5,1.1],[-10,-17,1.2],[32,-21,1.1]]) a.prop('rock',x,z,s);
});

const emberPlan = {
  id:'ember-crucible',
  topology:'Six service buildings stitch the outer cooling loop into the four-furnace crucible. Ore processing, slag receiving and turbine galleries feed the original workshops; quench dispatch completes a covered southern return around the low platforms.',
  spawns:[[-44,-34],[44,34],[-44,34],[44,-34],[-44,-10],[44,10],[-30,34],[31,-34],[-12,-34],[28,34]],
  teams:{0:[[-44,-34],[-44,-10],[-44,34],[-30,34]],1:[[44,34],[44,10],[44,-34],[31,-34]]},
  objectives:[['CRUCIBLE',0,0,3.5],['FORGE CONTROL',-30,13,3.2],['COOLANT HOUSE',31,-16,3.2]],
  pickups:[['rocket',0,0],['rocket',-30,13],['rocket',31,-16],['rail',-6,-27],['scatter',-30,25],['plasma',8,27],['health',-44,-20],['health',44,22],['health',-20,-27],['health',22,27],
    ['armor',-30,-8],['armor',31,8],['haste',-44,26],['overcharge',0,20],['overshield',0,-18],['recon',31,-34],['cloak',-30,34],['grenade',-44,4],['shock',44,-4],['flak',-18,13],['smg',31,-6],['marksman',24,-34]],
  routes:[
    route('cooling-ring',[[-44,-34],[44,-34],[44,34],[-44,34],[-44,-34]],4),
    route('blast-crossing',[[-44,0],[-30,0],[0,0],[31,0],[44,0]],4),
    route('forge-through',[[-44,13],[-30,13],[-18,13],[-18,27]]),
    route('forge-cross',[[-30,-8],[-30,13],[-30,34]]),
    route('coolant-through',[[18,-16],[31,-16],[44,-16]]),
    route('coolant-cross',[[31,-34],[31,-16],[31,8],[31,34]]),
    route('north-service',[[-44,-27],[-20,-27],[-6,-27],[14,-27],[14,-16],[18,-16]]),
    route('south-service',[[-18,27],[8,27],[22,27],[31,27],[44,27]]),
    route('inner-north',[[-30,-18],[0,-18],[14,-18]]),
    route('inner-south',[[-18,20],[0,20],[31,20]]),
    route('crucible-north',[[0,-18],[0,0]]),
    route('crucible-south',[[0,0],[0,20]]),
    route('ore-transfer',[[-32,-34],[-32,-27],[-32,-18],[-30,-18]]),
    route('slag-receiving',[[-44,-13],[-30,-13],[-30,-18]]),
    route('slag-forge-link',[[-30,-13],[-30,0]]),
    route('turbine-gallery',[[31,11],[44,11],[49,11]]),
    route('quench-return',[[-18,35],[12,35],[24,35],[24,27]])
  ],
  landmarks:[landmark('EMBER CRUCIBLE',0,0,5),landmark('FORGE CONTROL',-30,13,9),landmark('COOLANT HOUSE',31,-16,8),landmark('CINDER RAMP',-6,-27,4),landmark('QUENCH PLATFORM',8,27,4),
    landmark('ORE PROCESSING',-32,-27,12),landmark('SLAG RECEIVING',-44,-13,10),landmark('TURBINE GALLERY',44,11,10),landmark('QUENCH DISPATCH',12,35,10.5)]
};

const ember = destination({id:emberPlan.id,name:'Ember Crucible',tag:'VOLCANIC / FURNACES + RAMPED FLANKS',group:'urban',biome:'volcanic',sky:'night',
  color:'#f6a15d',background:'#291a25',floorColor:'#493c36',seed:73023,size:{w:104,d:88},
  description:'A volcanic rocket foundry of six connected service buildings: ore processing and turbine galleries feed broad blast lanes around four furnaces, with low ramps and a covered quench-return route.'}, emberPlan,(ctx,a)=>{
  a.hall({x:-30,z:13,w:16,d:18,h:7,doors:['west','east','north','south'],gap:5.5,label:'forge'});
  a.hall({x:31,z:-16,w:18,d:16,h:6.5,doors:['west','east','north','south'],gap:5.5,label:'coolant'});
  a.hall({x:-32,z:-27,w:16,d:8,h:8,doors:['west','east','north','south'],gap:5.5,roof:'gable',label:'ore-processing'});
  a.hall({x:-44,z:-13,w:12,d:16,h:9,doors:['north','south','east'],gap:6,label:'slag-receiving'});
  a.hall({x:44,z:11,w:12,d:14,h:8.5,doors:['west','east','north','south'],gap:6,label:'turbine-gallery'});
  a.hall({x:12,z:35,w:20,d:8,h:6.5,doors:['west','east'],gap:7,roof:'gable',label:'quench-dispatch'});
  a.solid(-37,-29.3,2,.8,2.3); a.solid(-48,-17,1.6,2,2.4);
  a.solid(48,7,1.4,1.4,2.6); a.solid(6,38,3,1,1.6); a.solid(18,38,3,1,1.6);
  ctx.addCauseway({x:0,z:0,w:18,d:8,rise:1.2,ramp:8});
  ctx.addCauseway({x:0,z:0,w:18,d:8,y:1.2,ramp:8,rot:Math.PI/2});
  ctx.addCauseway({x:-6,z:-27,w:18,d:6,rise:.8,ramp:5});
  ctx.addCauseway({x:8,z:27,w:14,d:6,rise:.8,ramp:5});
  // Four asymmetric furnace silhouettes shield the low crossing. Their bases
  // are genuine solids; the orange seams are inset on their outer faces.
  for(const [x,z,r,h] of [[-10,-10,1.8,10],[12,-10,1.6,8.5],[-10,11,1.7,8],[12,11,2,11]]) a.column(x,z,r,h);
  a.arch(-39,-12,9,6,Math.PI/2); a.arch(36,18,10,6,Math.PI/2);
  a.solid(-35,8,2,2,1.8); a.solid(-25,18,2,2,1.8);
  a.solid(25,-21,2,2,1.6); a.solid(37,-11,2,2,1.6);
  for(const [x,z,w,d,h] of [[-36,-20.5,3,2,2.2],[-22,-8,2,5,2.8],[23,7,2,5,2.8],[37,30,3,2,2],[-24,30.5,3,2,1.8],[21,-30,2,2,2],[-36,29,2,3,2.3]]) a.solid(x,z,w,d,h);
  for(const [x,z,s] of [[-48,-27,1.1],[-48,18,1.2],[48,28,1.1],[48,-24,1.2],[-18,39,1.3],[18,39,1.2],[-22,-39,1.1],[12,-39,1.2]]) a.prop('rock',x,z,s);
  for(const [x,z] of [[-39,-6],[40,7],[-24,-22],[24,15],[-35,19],[36,-22]]) a.prop('barrel',x,z,1.2);
  for(const [x,z] of [[-40,30],[39,-30],[-20,5],[21,-9]]) a.prop('crate',x,z,1.2);
  // Lava is a thin, walkable emissive surface accent, not an invisible hazard.
  // Keep each seam outside the route envelope and give it its shallow solid.
  for(const [x,z] of [[-30,-40],[30,40],[-49,0],[49,0],[-6,39],[4,-39]]) {
    a.solid(x,z,4.2,.7,.13,'cover');
    ctx.addProp({type:'lavaCrack',x,z,y:0,scale:1,rot:0});
  }
});

export const DESTINATION_COMBAT_MAPS = freeze([meridian, verdant, ember]);
