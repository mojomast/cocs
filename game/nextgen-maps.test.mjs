import test from 'node:test';
import assert from 'node:assert/strict';
import {NEXTGEN_MAPS} from './nextgen-maps.mjs';
import {MAPS,getMap} from './maps.mjs';
import {GAME_MODES} from './config.mjs';
import {floorAt,obstructed,moveActor,navigation,walkEdge} from './core.mjs';
import {arenaMeta,arenaSupportsMode} from './arenas.mjs';
import {createLevel,terrainField,mulberry32,fbm} from './levelgen.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const within = (map, x, z) => x >= map.bounds.minX && x <= map.bounds.maxX && z >= map.bounds.minZ && z <= map.bounds.maxZ;
const primaryMode = map => arenaMeta(map.id).play[0];

test('every combat game mode has a next-gen map and the canonical set is one-per-mode', () => {
  // Puma Race ships its own dedicated circuit (RACE_MAPS) rather than a
  // procedurally generated combat arena, and the single-player Horde/Campaign
  // modes reuse the existing arenas. VIP Escort, Holdout and Uplink are
  // objective variants layered on existing combat arenas, so they reuse a map
  // rather than claiming a new canonical next-gen arena. LATTICE STRIKE (both
  // `cocs` and the co-op `cocs-coop`) reuses its authored `lattice-slice`.
  const combatModes = GAME_MODES.filter(mode => !['puma-race','puma-soccer','horde','campaign','vip-escort','holdout','uplink','cocs','cocs-coop'].includes(mode.id));
  assert.equal(new Set(NEXTGEN_MAPS.map(map => map.id)).size, NEXTGEN_MAPS.length);
  const modes = new Set(NEXTGEN_MAPS.map(primaryMode));
  for (const mode of combatModes) assert.ok(modes.has(mode.id), `missing next-gen map for ${mode.id}`);
  // Maps flagged `variant` extend the rotation without claiming a mode slot, so
  // the canonical set must still cover every combat mode exactly once.
  const canonical = NEXTGEN_MAPS.filter(map => map.variant !== true);
  assert.equal(canonical.length, combatModes.length, 'one canonical next-gen map per combat mode');
  assert.equal(new Set(canonical.map(primaryMode)).size, canonical.length, 'canonical modes are unique');
  assert.ok(NEXTGEN_MAPS.length >= combatModes.length);
  assert.ok(NEXTGEN_MAPS.some(map => map.variant === true), 'biome variants exist');
  for (const map of NEXTGEN_MAPS) assert.equal(getMap(map.id), map, `${map.id} is registered`);
});

test('next-gen maps have valid, in-bounds geometry', () => {
  for (const map of NEXTGEN_MAPS) {
    assert.ok(map.nextGen === true, `${map.id} marks nextGen`);
    assert.ok(map.bounds.minX < map.bounds.maxX && map.bounds.minZ < map.bounds.maxZ, `${map.id} bounds`);
    assert.ok(typeof map.description === 'string' && map.description.length > 20, `${map.id} description`);
    for (const block of map.blocks) {
      assert.ok([block.x, block.z, block.w, block.d, block.h].every(finite), `${map.id} block finite`);
      assert.ok(block.w > 0 && block.d > 0 && block.h > 0, `${map.id} block size`);
      assert.ok(within(map, block.x - block.w / 2, block.z - block.d / 2) && within(map, block.x + block.w / 2, block.z + block.d / 2), `${map.id} block in bounds`);
    }
    for (const [x, z] of map.spawns) assert.ok(within(map, x, z), `${map.id} spawn`);
    for (const points of Object.values(map.teamSpawns || {})) for (const [x, z] of points) assert.ok(within(map, x, z), `${map.id} team spawn`);
    for (const [, x, z] of map.pickups) assert.ok(within(map, x, z), `${map.id} pickup`);
    assert.ok(map.objectiveZones.length >= 3, `${map.id} objective zones`);
    assert.ok(map.navNodes.length >= 8, `${map.id} nav nodes`);
  }
});

test('next-gen terrain is finite and triangulated', () => {
  for (const map of NEXTGEN_MAPS) {
    assert.ok(map.terrain?.surfaces?.length, `${map.id} terrain surfaces`);
    for (const surface of map.terrain.surfaces) {
      for (const vertex of surface.vertices) assert.ok(Array.isArray(vertex) && vertex.length === 3 && vertex.every(finite), `${map.id} terrain vertex`);
      for (const tri of surface.triangles) assert.ok(tri.every(i => Number.isInteger(i) && i >= 0 && i < surface.vertices.length), `${map.id} terrain triangle`);
    }
    assert.ok(typeof map.terrain.height === 'function', `${map.id} height function`);
  }
});

test('next-gen spawns stand on supported, unobstructed ground', () => {
  for (const map of NEXTGEN_MAPS) {
    const points = [...map.spawns, ...Object.values(map.teamSpawns || {}).flat()];
    for (const [x, z] of points) {
      const y = floorAt(x, z, map);
      assert.notEqual(y, null, `${map.id} spawn support at ${x},${z}`);
      assert.equal(obstructed(x, y, z, 0.6, map), false, `${map.id} spawn clearance at ${x},${z}`);
    }
  }
});

test('every required next-gen placement walk-connects to retained navigation', () => {
  for (const map of NEXTGEN_MAPS) {
    const { nodes, edges } = navigation(map);
    const seen = new Set([0]), queue = [0];
    while (queue.length) for (const next of edges[queue.shift()]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    const main = nodes.filter((_, index) => seen.has(index));
    const placements = [
      ...map.spawns.map(p => ['spawn', ...p]),
      ...Object.values(map.teamSpawns || {}).flat().map(p => ['team spawn', ...p]),
      ...Object.values(map.flagSpawns || {}).map(p => ['flag', ...p]),
      ...map.pickups,
      ...map.objectiveZones.map(p => ['zone', p.x, p.z]),
    ];
    assert.ok(main.length > 8, `${map.id} has retained navigation`);
    for (const [kind, x, z] of placements) {
      const y = floorAt(x, z, map), label = `${map.id} ${kind} at ${x},${z}`;
      assert.notEqual(y, null, `${label} support`);
      assert.equal(obstructed(x, y, z, .6, map), false, `${label} clearance`);
      // Exclude the placement itself: a zero-length edge can hide an island.
      assert.ok(main.some(node => Math.hypot(node.x - x, node.z - z) > .1 && walkEdge({x, y, z}, node, map) && walkEdge(node, {x, y, z}, map)), `${label} walk-connects to main component`);
    }
  }
});

test('next-gen objectives sit clear of all ground-level solids, including decks', () => {
  for (const map of NEXTGEN_MAPS) {
    for (const zone of map.objectiveZones) {
      const y = floorAt(zone.x, zone.z, map);
      assert.notEqual(y, null, `${map.id} objective support at ${zone.x},${zone.z}`);
      assert.ok(Number.isFinite(zone.y), `${map.id} objective height at ${zone.x},${zone.z}`);
      assert.equal(zone.y, y, `${map.id} objective uses runtime floor height`);
      assert.equal(obstructed(zone.x, y, zone.z, .6, map), false, `${map.id} objective clearance at ${zone.x},${zone.z}`);
    }
  }
});

test('next-gen maps advertise only modes they can actually play', () => {
  for (const map of NEXTGEN_MAPS) {
    const mode = primaryMode(map);
    assert.ok(arenaSupportsMode(map.id, mode), `${map.id} supports its own mode`);
    assert.ok(arenaMeta(map.id).play.includes(mode), `${map.id} play list`);
  }
});

test('next-gen flag metadata only ships on maps that advertise CTF', () => {
  for (const map of NEXTGEN_MAPS) assert.equal(Boolean(map.flagSpawns), arenaSupportsMode(map.id, 'ctf'), `${map.id} flag metadata matches ctf`);
});

test('the ctf opt-in synthesizes flag bases from team spawns', () => {
  const bounds = {minX: -30, maxX: 30, minZ: -30, maxZ: 30};
  const terrain = terrainField(bounds, {height: () => 0, amplitude: 0});
  const fixture = ctf => createLevel({id: 'ctf-fixture', bounds, terrain, ctf, layout(ctx) {
    ctx.teamSpawns[0] = [[-10, 0]]; ctx.teamSpawns[1] = [[10, 0]];
  }});
  assert.ok(fixture(true).flagSpawns, 'opt-in map synthesizes flag bases');
  assert.equal(fixture(false).flagSpawns, undefined, 'opt-out map ships no flag metadata');
});

test('quarter-turned buildings size window props to the rotated wall', () => {
  const bounds = {minX: -30, maxX: 30, minZ: -30, maxZ: 30};
  const terrain = terrainField(bounds, {height: () => 0, amplitude: 0});
  const map = createLevel({id: 'window-fixture', bounds, terrain, layout(ctx) {
    ctx.addBuilding({x: 0, z: 0, w: 10, d: 6, h: 5, rot: 0, door: 'east'});
    ctx.addBuilding({x: 20, z: 0, w: 10, d: 6, h: 5, rot: Math.PI / 2, door: 'east'});
  }});
  const windows = map.structures.filter(s => s.type === 'windows');
  const span = (x, z) => windows.find(s => Math.abs(s.x - x) < .01 && Math.abs(s.z - z) < .01)?.w;
  // Phase 1 facade frames sit on the OUTER wall plane, not the wall-box centre
  // (docs/phase1-spatial-handoff.md). North/south spans keep the authored width
  // and east/west keep depth without a second swap after the quarter turn, so
  // the rotated building's long faces carry 10 and its short face 6.
  assert.equal(span(0, -3), 10);
  assert.equal(span(0, 3), 10);
  assert.equal(span(-5, 0), 6);
  assert.equal(span(23, 0), 10);
  assert.equal(span(17, 0), 10);
  assert.equal(span(20, -5), 6);
});

test('level generation is deterministic for a fixed seed', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.equal(fbm(1.5, 2.5, 7), fbm(1.5, 2.5, 7));
  assert.notEqual(fbm(1.5, 2.5, 7), fbm(1.5, 2.5, 99));
});

test('every canonical map still resolves its own metadata after the new maps', () => {
  for (const map of MAPS) assert.equal(arenaMeta(map.id).id, map.id);
});

test('next-gen cover is solid from above', () => {
  for (const map of NEXTGEN_MAPS) {
    const cover = map.blocks.find(block => block.kind === 'cover');
    assert.ok(cover, `${map.id} has cover`);
    const actor = {x: cover.x, z: cover.z, y: cover.h + 0.1, vx: 0, vy: -40, vz: 0, grounded: false, active: 0, coyote: 0, jumpBuffer: 0};
    moveActor(actor, {}, 1 / 30, map, {speed: 1, gravity: 1});
    assert.equal(actor.y, cover.h, `${map.id} lands on cover`);
  }
});
test('the CTF next-gen map keeps its authored flag bases and picks up its centre hill', () => {
  const frost = NEXTGEN_MAPS.find(map => map.id === 'frost-gate');
  assert.deepEqual(frost.flagSpawns[0], [-48, 0]);
  assert.deepEqual(frost.flagSpawns[1], [48, 0]);
  assert.deepEqual(frost.flags, frost.flagSpawns);
});

test('rotated team bases face inward and Frost Gate has an unobstructed central route', () => {
  for (const id of ['frost-gate', 'titan-valley', 'convoy-line']) {
    const map = NEXTGEN_MAPS.find(map => map.id === id);
    for (const base of map.structures.filter(s => s.type === 'building' && Math.abs(s.x) >= 48 && s.z === 0)) {
      assert.equal(base.door, 'north', `${id} local north faces centre after rotation`);
      const sign = -Math.sign(base.x), doorX = base.x + sign * (base.d / 2 - .25);
      const a = {x: doorX - sign, z: 0}, b = {x: doorX + sign, z: 0};
      a.y = floorAt(a.x, a.z, map); b.y = floorAt(b.x, b.z, map);
      assert.ok(walkEdge(a, b, map), `${id} doorway is physically passable`);
    }
  }
  const frost = NEXTGEN_MAPS.find(map => map.id === 'frost-gate');
  for (let x = -48; x < 48; x += 2) {
    assert.ok(walkEdge({x, y: floorAt(x, 0, frost), z: 0}, {x: x + 2, y: floorAt(x + 2, 0, frost), z: 0}, frost), `Frost Gate central route at ${x}`);
  }
});

test('automatic team powerups and cover have exact mirrored partners', () => {
  for (const map of NEXTGEN_MAPS.filter(map => map.teamSpawns)) {
    for (const kind of ['haste', 'overcharge', 'overshield', 'recon', 'cloak']) {
      const supplies = map.pickups.filter(p => p[0] === kind);
      assert.equal(supplies.length, 2, `${map.id} paired ${kind}`);
      assert.equal(supplies[0][1], -supplies[1][1], `${map.id} ${kind} mirrored x`);
      assert.equal(supplies[0][2], -supplies[1][2], `${map.id} ${kind} mirrored z`);
    }
    const cover = map.blocks.filter(b => b.kind === 'cover');
    for (const block of cover) assert.ok(cover.some(b => b !== block && b.x === -block.x && b.z === -block.z && b.w === block.w && b.d === block.d), `${map.id} mirrored cover`);
  }
});

test('next-gen supplies are never stacked and tunnel collision is not doubled', () => {
  const key = (x, z) => `${Math.round(x * 100) / 100}:${Math.round(z * 100) / 100}`;
  for (const map of NEXTGEN_MAPS) {
    const supplies = map.pickups.map(([, x, z]) => key(x, z));
    assert.equal(new Set(supplies).size, supplies.length, `${map.id} supplies share no quantized coordinate`);
    const tunnels = map.blocks.filter(block => block.kind === 'tunnel').map(block => key(block.x, block.z));
    assert.equal(new Set(tunnels).size, tunnels.length, `${map.id} tunnel collision blocks are unique`);
  }
});

test('final placement repair uses triangulated ground and includes decks and later cover', () => {
  const bounds = {minX: -20, maxX: 20, minZ: -20, maxZ: 20};
  const terrain = terrainField(bounds, {height: () => 0, amplitude: 0});
  // The source noise function is not the runtime triangle support surface.
  terrain.height = () => 9;
  const map = createLevel({id: 'placement-fixture', bounds, terrain, layout(ctx) {
    ctx.addBlock({x: 0, z: 0, w: 4, d: 4, h: 3, kind: 'deck'});
    ctx.addSpawn(0, 0);
    ctx.addObjective(0, 0);
    ctx.addObjective(-5, 4); // Automatic cover is added here after layout.
    ctx.addPickup('health', 0, 0);
    ctx.flagSpawns = {0: [0, 0], 1: [-5, 4]};
  }});
  const points = [...map.spawns, ...map.pickups.map(p => p.slice(1)), ...Object.values(map.flagSpawns), ...map.objectiveZones.map(p => [p.x, p.z])];
  for (const [x, z] of points) assert.equal(obstructed(x, floorAt(x, z, map), z, .6, map), false, `repaired fixture placement ${x},${z}`);
  for (const zone of map.objectiveZones) assert.equal(zone.y, 0);
});

test('the campaign finale arena is large enough for a next-gen mission',()=>{
 const throne=getMap('throne');
 const span=Math.max(throne.bounds.maxX-throne.bounds.minX,throne.bounds.maxZ-throne.bounds.minZ);
 assert.ok(span>=100,`throne is mission scale (${span}m)`);
 assert.ok(arenaSupportsMode('throne','campaign'),'throne hosts campaign missions');
 assert.ok(arenaSupportsMode('throne','juggernaut'),'throne keeps its primary mode');
});

test('the biome next-gen maps ship distinct biomes, props and hazards', () => {
  const dune = NEXTGEN_MAPS.find(map => map.id === 'dune-ravine');
  const caldera = NEXTGEN_MAPS.find(map => map.id === 'ember-caldera');
  assert.equal(dune.biome, 'canyon');
  assert.equal(caldera.biome, 'volcanic');
  assert.notEqual(dune.biome, caldera.biome, 'the two new maps occupy distinct biomes');
  for (const map of [dune, caldera]) {
    assert.ok(map.props.some(prop => prop.type === 'lavaCrack'), `${map.id} has lava cracks`);
    assert.ok(map.props.some(prop => prop.type === 'iceSpike'), `${map.id} has ice spikes`);
    assert.ok(map.props.some(prop => prop.type === 'crate'), `${map.id} has breakable crates`);
    assert.ok(map.props.some(prop => prop.type === 'barrel'), `${map.id} has breakable barrels`);
    assert.ok(map.blocks.some(block => block.kind === 'ridge'), `${map.id} has terrain ridges`);
    assert.ok(map.objectiveZones.length >= 3, `${map.id} objectives`);
    assert.ok(map.spawns.length >= 8, `${map.id} spawns`);
  }
  assert.ok(dune.blocks.some(block => block.kind === 'terrace'), 'the desert mesa has tiered terraces');
});

test('the biome maps advertise only their authored combat modes', () => {
  for (const id of ['dune-ravine', 'ember-caldera']) {
    const meta = arenaMeta(id);
    assert.ok(meta && meta.play.length >= 4, `${id} has an authored play list`);
    for (const mode of meta.play) assert.ok(arenaSupportsMode(id, mode), `${id} supports ${mode}`);
    assert.ok(arenaSupportsMode(id, meta.play[0]), `${id} primary mode`);
  }
});

test('the new objective maps carry layered cover and dressing', () => {
  for (const id of ['throne', 'gauntlet']) {
    const map = NEXTGEN_MAPS.find(value => value.id === id);
    const cover = map.blocks.filter(block => block.kind === 'cover');
    assert.ok(cover.length >= 4, `${id} has layered cover`);
    assert.ok(map.props.length >= 6, `${id} has dressing props`);
    assert.ok(map.props.some(prop => prop.type === 'barrel'), `${id} has barrels`);
    if (map.teamSpawns) for (const block of cover) assert.ok(cover.some(other => other !== block && other.x === -block.x && other.z === -block.z && other.w === block.w && other.d === block.d), `${id} cover stays mirrored`);
  }
});

import {degenerateLayout} from './levelgen.mjs';

test('degenerateLayout rejects invalid schemas and accepts a complete fixture',()=>{
 const bounds={minX:-30,maxX:30,minZ:-30,maxZ:30};
 const terrain=terrainField(bounds,{height:()=>0,amplitude:0});
 const good=createLevel({id:'degenerate-fixture',name:'Degenerate',bounds,terrain,layout(ctx){
  ctx.addSpawn(0,0);ctx.addObjective(0,0);ctx.addNav(0,0);
 }});
 assert.equal(degenerateLayout(good),null);
 assert.match(degenerateLayout({id:'x',name:'x',bounds,blocks:[],spawns:[],pickups:[],navNodes:[],objectiveZones:[]}),/schema|objective/i);
});

test('compound, terrace and tower primitives produce walkable, validated geometry',()=>{
 const bounds={minX:-40,maxX:40,minZ:-40,maxZ:40};
 const terrain=terrainField(bounds,{height:()=>0,amplitude:0});
 const map=createLevel({id:'primitive-fixture',name:'Primitives',bounds,terrain,layout(ctx){
  ctx.addCompound({x:-20,z:0,w:12,d:8,h:6,rooms:[2,2]});
  ctx.addTerrace({x:20,z:0,tiers:3,size:16});
  ctx.addTower({x:0,z:20,radius:3,height:12,decks:3});
  ctx.addSpawn(0,-20);ctx.addObjective(-20,0);ctx.addNav(0,0);
 }});
 assert.ok(map.structures.some(s=>s.type==='compound'&&s.rooms[0]===2&&s.rooms[1]===2));
 assert.ok(map.structures.some(s=>s.type==='terrace'&&s.tiers===3));
 assert.ok(map.structures.some(s=>s.type==='tower'&&s.decks===3));
 assert.ok(map.blocks.some(b=>b.kind==='partition'));
 assert.ok(map.blocks.some(b=>b.kind==='terrace'));
 assert.ok(map.blocks.some(b=>b.kind==='tower'));
 assert.equal(degenerateLayout(map),null);
});
