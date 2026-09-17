import test from 'node:test';
import assert from 'node:assert/strict';
import {NEXTGEN_MAPS} from './nextgen-maps.mjs';
import {floorAt, obstructed, walkEdge, moveActor, navigation} from './core.mjs';
import {facadeFrame} from './structures.mjs';

const mapById = id => {
  const map = NEXTGEN_MAPS.find(m => m.id === id);
  assert.ok(map, id);
  return map;
};
const point = (map, x, z) => ({x, z, y: floorAt(x, z, map)});

// Exercise real nav edges and authoritative movement, not nearest-node distance.
function walk(map, from, to) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.ceil(distance);
  let prev = point(map, from.x, from.z);
  for (let i = 1; i <= steps; i++) {
    const next = point(map, from.x + (to.x - from.x) * i / steps, from.z + (to.z - from.z) * i / steps);
    assert.notEqual(next.y, null, `${map.id}: unsupported ${JSON.stringify(next)}`);
    assert.ok(walkEdge(prev, next, map), `${map.id}: blocked edge ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`);
    prev = next;
  }
  const actor = {...point(map, from.x, from.z), vx: 0, vy: 0, vz: 0, grounded: true, moveSpeed: 5, jumpBuffer: 0, coyote: 0};
  const input = {x: (to.x - from.x) / distance, z: (to.z - from.z) / distance};
  for (let i = 0; i < Math.ceil(distance * 60) + 120 && Math.hypot(to.x - actor.x, to.z - actor.z) > .18; i++) {
    moveActor(actor, input, 1 / 60, map);
  }
  assert.ok(Math.hypot(to.x - actor.x, to.z - actor.z) < .18, `${map.id}: actor stopped ${JSON.stringify(actor)}`);
  assert.equal(obstructed(actor.x, actor.y, actor.z, .52, map), false);
}

function checkDoors(map) {
  for (const building of map.structures.filter(s => s.type === 'building')) {
    const frame = facadeFrame(building, building.door);
    const outside = {x: frame.origin.x + frame.normal.x * 2, z: frame.origin.z + frame.normal.z * 2};
    const inside = {x: frame.origin.x - frame.normal.x * 2, z: frame.origin.z - frame.normal.z * 2};
    walk(map, outside, inside);
    walk(map, inside, outside);
  }
}

function checkTunnels(map) {
  for (const tunnel of map.structures.filter(s => s.type === 'tunnel')) {
    const points = tunnel.floorPoints;
    for (let i = 1; i < points.length; i++) {
      const from = {x: points[i - 1][0], z: points[i - 1][2]};
      const to = {x: points[i][0], z: points[i][2]};
      walk(map, from, to);
      walk(map, to, from);
    }
  }
}

test('fortress: both flank tunnels end in accessible forecourt, not solid keep walls', () => {
  const map = mapById('fortress');
  checkTunnels(map);
  checkDoors(map);
  for (const z of [-14, 14]) {
    walk(map, {x: 10, z}, {x: 13, z});
    walk(map, {x: 13, z}, {x: 13, z: 0});
  }
  walk(map, {x: 13, z: 0}, {x: 30, z: 0});
});

test('convoy-line: the complete central tunnel is traversable in both directions', () => {
  const map = mapById('convoy-line');
  checkTunnels(map);
  checkDoors(map);
  assert.deepEqual(map.objectiveZones.map(({x, z}) => [x, z]), [[-32, 0], [0, 0], [34, 0]]);
});

test('titan-valley: both portals of both reward caverns have clear approaches', () => {
  const map = mapById('titan-valley');
  for (const cavern of map.structures.filter(s => s.type === 'cavern')) {
    for (const angle of [Math.PI / 16, Math.PI + Math.PI / 16]) {
      const at = r => ({x: cavern.x + Math.cos(angle) * r, z: cavern.z + Math.sin(angle) * r});
      walk(map, at(cavern.radius - 2), at(cavern.radius + 2));
      walk(map, at(cavern.radius + 2), at(cavern.radius - 2));
    }
  }
});

test('colosseum: both room entrances and exits clear the seating terraces', () => {
  checkDoors(mapById('colosseum'));
});

test('frost-gate: tunnel approaches do not cut either base doorway landing', () => {
  const map = mapById('frost-gate');
  checkDoors(map);
  checkTunnels(map);
});

test('riverbend: town doors and authored plazas are accessible without nudging objectives', () => {
  const map = mapById('riverbend');
  checkDoors(map);
  assert.deepEqual(map.objectiveZones.map(({x, z}) => [x, z]), [[-30, 0], [0, 0], [30, 0]]);
  for (const {x, z} of map.objectiveZones) walk(map, {x, z: z + 3}, {x, z});
});

// Deliberately limited to changed maps, not the full map or application suite.
for (const id of ['colosseum', 'frost-gate', 'riverbend', 'fortress', 'convoy-line', 'titan-valley']) {
  test(`${id}: supported separated spawns, connected rewards/objectives and a centre-avoiding route`, () => {
    const map = mapById(id), nav = navigation(map);
    const spawns = [...map.spawns, ...Object.values(map.teamSpawns || {}).flat()].map(([x, z]) => point(map, x, z));
    const targets = [...spawns, ...map.pickups.map(([, x, z]) => point(map, x, z)),
      ...map.objectiveZones.map(({x, z}) => point(map, x, z)),
      ...Object.values(map.flagSpawns || {}).map(([x, z]) => point(map, x, z))];
    const attach = p => nav.nodes.findIndex(q => Math.hypot(q.x - p.x, q.z - p.z) <= 6.5 && walkEdge(p, q, map));
    const attached = targets.map(p => {
      assert.notEqual(p.y, null, `${id}: missing floor`);
      assert.equal(obstructed(p.x, p.y, p.z, .52, map), false, `${id}: blocked marker ${JSON.stringify(p)}`);
      const index = attach(p);
      assert.ok(index >= 0, `${id}: marker has no real walk edge to nav ${JSON.stringify(p)}`);
      return index;
    });
    const reachable = (start, avoidCentre = false) => {
      const seen = new Set([start]), queue = [start];
      for (let i = 0; i < queue.length; i++) for (const j of nav.edges[queue[i]]) {
        if (seen.has(j) || (avoidCentre && Math.hypot(nav.nodes[j].x, nav.nodes[j].z) <= 8)) continue;
        seen.add(j); queue.push(j);
      }
      return seen;
    };
    const connected = reachable(attached[0]);
    for (const i of attached) assert.ok(connected.has(i), `${id}: disconnected required marker`);
    for (let i = 0; i < spawns.length; i++) for (const b of spawns.slice(i + 1)) {
      assert.ok(Math.hypot(spawns[i].x - b.x, spawns[i].z - b.z) > 1.04, `${id}: overlapping spawn footprints`);
    }
    const start = spawns[0];
    const farthest = spawns.reduce((a, b) => Math.hypot(a.x - start.x, a.z - start.z) > Math.hypot(b.x - start.x, b.z - start.z) ? a : b);
    assert.ok(reachable(attached[0], true).has(attach(farthest)), `${id}: no centre-avoiding nav route`);
  });
}
