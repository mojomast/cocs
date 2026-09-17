import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMothArena, mothArena, MOTH_MAP_INFO } from './moth-maps.mjs';
import { degenerateLayout } from './levelgen.mjs';
import { configureMothAssets, resetMothAssets } from './moth-assets.mjs';
import { floorAt, obstructed, navigation, walkEdge } from './core.mjs';

const graph = (overrides = {}) => ({
  rows: 2, cols: 2, numQubits: 4, coupling: [[0, 1], [2, 3]],
  cells: [
    { i: 0, x: 0.1, y: 0, z: -0.2, radiating: true },
    { i: 1, x: 0.2, y: 0, z: 0.3, radiating: false },
    { i: 2, x: 0, y: 0, z: 0, radiating: false },
    { i: 3, x: -0.1, y: 0, z: -0.4, radiating: true },
  ],
  metrics: { szSamp: 0.3, mode: 'emu', backend: 'aer', shots: 256 },
  ...overrides,
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

test('a quantum graph builds a complete, non-degenerate arena', () => {
  const map = buildMothArena(graph());
  assert.equal(map.id, 'moth-arena');
  assert.equal(degenerateLayout(map), null, 'passes the shared map schema');
  assert.ok(map.blocks.length > 0, 'rooms have walls');
  assert.ok(map.spawns.length >= 4, 'spawns exist');
  assert.ok(map.navNodes.length >= 4, 'nav nodes exist');
  assert.ok(map.objectiveZones.length >= 3, 'a match gets at least three contested spaces');
  for (const block of map.blocks) {
    assert.ok([block.x, block.z, block.w, block.d, block.h].every(finite), 'block geometry is finite');
    assert.ok(block.w > 0 && block.d > 0 && block.h > 0, 'block geometry is positive');
  }
});

test('the same graph always produces the same arena', () => {
  const a = buildMothArena(graph());
  const b = buildMothArena(graph());
  assert.equal(JSON.stringify(a.blocks), JSON.stringify(b.blocks));
  assert.equal(JSON.stringify(a.objectiveZones), JSON.stringify(b.objectiveZones));
  assert.equal(JSON.stringify(a.spawns), JSON.stringify(b.spawns));
});

test('coupled qubits open a doorway while an already-connected uncoupled edge stays walled', () => {
  const cells = [0, 1, 2, 3].map((i) => ({ i, x: 0, y: 0, z: 0, radiating: false }));
  // 0-1 and 1-3 and 0-2 keep every room connected, so the 2-3 edge is not
  // needed and must stay a solid wall.
  const map = buildMothArena({ rows: 2, cols: 2, numQubits: 4, coupling: [[0, 1], [0, 2], [1, 3]], cells, metrics: {} });
  const solidAt = (x, z) => map.blocks.some((b) => Math.abs(b.x - x) < 0.1 && Math.abs(b.z - z) < 0.1);
  assert.equal(solidAt(0, -6), false, 'the coupled 0-1 edge leaves a walkable gap');
  assert.equal(solidAt(0, 6), true, 'the unneeded 2-3 edge is a solid wall');
});

test('an isolated coupling leaves no disconnected island', () => {
  const cells = [0, 1, 2, 3].map((i) => ({ i, x: 0, y: 0, z: 0, radiating: false }));
  // Cell 3 has no quantum coupling at all; the builder must still connect it.
  const map = buildMothArena({ rows: 2, cols: 2, numQubits: 4, coupling: [], cells, metrics: {} });
  assert.equal(degenerateLayout(map), null);
  const { nodes, edges } = navigation(map);
  const seen = new Set([0]), queue = [0];
  while (queue.length) for (const next of edges[queue.shift()]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  assert.equal(seen.size, nodes.length, 'every nav node is reachable from the first');
});

test('spawns land on supported, unobstructed ground in the main nav component', () => {
  const map = buildMothArena(graph());
  const { nodes, edges } = navigation(map);
  const seen = new Set([0]), queue = [0];
  while (queue.length) for (const next of edges[queue.shift()]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  assert.ok(seen.size > 4, 'the arena has a connected walkable component');
  for (const [x, z] of map.spawns) {
    const y = floorAt(x, z, map);
    assert.notEqual(y, null, `spawn support at ${x},${z}`);
    assert.equal(obstructed(x, y, z, 0.6, map), false, `spawn clearance at ${x},${z}`);
    assert.ok(nodes.some((node) => Math.hypot(node.x - x, node.z - z) > 0.1 && walkEdge({ x, y, z }, node, map) && walkEdge(node, { x, y, z }, map)), `spawn at ${x},${z} walk-connects`);
  }
});

test('invalid graphs are rejected', () => {
  assert.throws(() => buildMothArena(null), /invalid graph/);
  assert.throws(() => buildMothArena({ rows: 1.5, cols: 2 }), /invalid graph/);
});

test('mothArena reads a baked graph from the registry', () => {
  resetMothAssets();
  assert.equal(mothArena(), null, 'inert without a configured registry');
  configureMothAssets({
    version: 1, textures: {}, materials: {}, seeds: {}, motifs: {},
    levels: { 'moth-backrooms': graph() },
  });
  const map = mothArena();
  assert.equal(map.id, MOTH_MAP_INFO.id);
  assert.equal(degenerateLayout(map), null);
  // A different name falls through to null rather than throwing.
  assert.equal(mothArena('nope'), null);
  resetMothAssets();
});
