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

test('there is exactly one next-gen map per combat game mode', () => {
  // Puma Race ships its own dedicated circuit (RACE_MAPS) rather than a
  // procedurally generated combat arena, so it is excluded from this count.
  const combatModes = GAME_MODES.filter(mode => mode.id !== 'puma-race');
  assert.equal(NEXTGEN_MAPS.length, combatModes.length);
  assert.equal(new Set(NEXTGEN_MAPS.map(map => map.id)).size, NEXTGEN_MAPS.length);
  const modes = new Set(NEXTGEN_MAPS.map(map => map.mode));
  for (const mode of combatModes) assert.ok(modes.has(mode.id), `missing next-gen map for ${mode.id}`);
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
    assert.ok(arenaSupportsMode(map.id, map.mode), `${map.id} supports its own mode`);
    assert.ok(arenaMeta(map.id).play.includes(map.mode), `${map.id} play list`);
  }
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
