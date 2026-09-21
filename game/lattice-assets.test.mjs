import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {latticeAssetRecords, latticeAssetTerminals, latticeCargoRecords, latticeMachineState, latticeMachinePlacement, LATTICE_MACHINE_KINDS} from './lattice-asset-state.mjs';
import {buildLatticeMachineGeometry, latticeToolPose} from './lattice-machines.mjs';
import {LatticeWorldAssets, updateLatticeWorld, clearLatticeWorld} from './lattice-view.mjs';

const arena = {nodes: [{id: 'r', x: 0, z: 0, y: 4, r: 9, archetype: 'relay'}], terrain: {height: () => 4},
  blocks: [{x: 0, z: 4, w: 7, d: 1, h: 8}]};
const relay = {id: 'r', x: 0, z: 0, owner: 0, archetype: 'relay', live: true, progress: [0, 0]};
const terminal = (kind, extra = {}) => ({id: `${kind}-r`, nodeId: 'r', kind, x: 0, z: 0, owner: 0, state: 'available', ...extra});
const frame = (terminals = [], extra = {}) => ({time: 1, objectives: {kind: 'cocs'}, cocs: {tick: 10, nodes: [relay], terminals, ...extra}});

test('compact public snapshots preserve terrain height, map radius and actual terminal focal points', () => {
  const match = frame([terminal('HACK', {x: 2, z: 1, y: 5, reach: 4})]);
  const records = latticeAssetRecords(match, arena);
  const node = records.find(record => !record.terminal), hack = records.find(record => record.terminal);
  assert.equal(node.y, 4); assert.equal(node.radius, 9);
  assert.deepEqual([hack.x, hack.y, hack.z, hack.reach], [2, 5, 1, 4]);
  assert.equal(latticeAssetRecords({objectives: {kind: 'domination', zones: []}}, arena).length, 0);
  assert.equal(latticeAssetRecords(frame(), {...arena, terminals: [terminal('DEPLOY')]}).length, 1, 'map metadata cannot spawn a gameplay terminal');
  assert.deepEqual(latticeAssetTerminals({terminals: [], terminalState: {terminals: [terminal('HACK')]}}), []);
  assert.equal(latticeAssetTerminals({terminalState: {terminals: {'a': terminal('HACK')}}}).length, 1);
});

test('live state separates ownership, contest, channel charge, expired effects and lifetime telemetry', () => {
  const snapshot = {tick: 20}, node = {...relay, hack: {until: 19, team: 0}};
  const idle = latticeMachineState(terminal('HACK', {hacks: 50, hackedTeam: 0}), snapshot, node);
  assert.equal(idle.active, false); assert.equal(idle.charge, 0);
  const channel = terminal('HACK', {channel: {remaining: 1, total: 4}});
  const active = latticeMachineState(channel, snapshot, node);
  assert.equal(active.charge, .75); assert.equal(active.moving, true);
  const contested = latticeMachineState({...channel, contested: true}, snapshot, node);
  assert.equal(contested.owner, 0); assert.equal(contested.status, 'contested'); assert.equal(contested.moving, false);
  assert.equal(latticeMachineState(terminal('SABOTAGE', {simState: 'cut'}), snapshot, node).blocked, true);
  const deployed = terminal('DEPLOY', {deployedTeam: 0, deploys: 12, oracleActive: false, phase: 'offline'});
  assert.equal(latticeMachineState(deployed, snapshot, {...node, oracle: {team: 0, active: true}}).active, false, 'explicit public false outranks legacy state');
  assert.equal(latticeMachineState(deployed, snapshot, node).status, 'offline');
  assert.equal(latticeMachineState({...deployed, oracleActive: true}, snapshot, node).oracle, true);
});

test('prime channels, field expiry, shards, cargo and vault banks use current authoritative data', () => {
  const ward = {team: 0, until: 21};
  const snapshot = {tick: 20, fieldSupport: {nodes: {r: {ward}}}};
  const node = {...relay, primeChannel: {total: 3, remaining: 2}, prime: {until: 21}};
  const state = latticeMachineState(node, snapshot);
  assert.equal(state.support, true); assert.equal(state.prime, true); assert.ok(Math.abs(state.charge - 1 / 3) < 1e-8);
  assert.equal(latticeMachineState(node, {...snapshot, tick: 21}).support, false);
  assert.equal(latticeMachineState({...node, owner: 1}, snapshot).support, false);
  assert.deepEqual(latticeMachineState(terminal('DEPLOY', {shards: {0: 'ready', 1: 'carried'}}), snapshot, relay).shards, [true, false]);
  assert.deepEqual(latticeMachineState(terminal('VAULT', {uses: 22, banked: {0: 2, 1: 0}}), snapshot, relay).banked, [2, 0]);
  const cargo = [{actor: 7, team: 0, source: 'deploy-r'}];
  const match = {...frame([terminal('VAULT', {cargo}), terminal('VAULT', {id: 'vault-other', cargo})]), actors: [{id: 7, team: 0, x: 8, y: 4, z: 9, health: 100}]};
  assert.equal(latticeCargoRecords(match).length, 1, 'repeated vault cargo list makes one carrier marker');
  assert.equal(latticeCargoRecords({...match, actors: [{...match.actors[0], health: 0}]}).length, 0);
  const raw = {kind: 'cocs', nodes: [relay], terminals: {terminals: {v: terminal('VAULT')}, vault: {byNode: {r: {0: ['source'], 1: []}}, cargo: {7: cargo[0]}}}};
  assert.deepEqual(latticeAssetRecords({objectiveState: raw}, arena).find(r => r.terminal).state.banked, [1, 0]);
});

test('equipment mounts use existing solid faces within reach and leave open courts clear', () => {
  const records = latticeAssetRecords(frame(['HACK', 'DEPLOY', 'SABOTAGE'].map(kind => terminal(kind))), arena).filter(r => r.terminal);
  const used = [];
  for (const record of records) {
    const mount = latticeMachinePlacement(record, arena, used); used.push(mount);
    assert.equal(mount.projected, false);
    assert.ok(Math.hypot(mount.x - record.x, mount.z - record.z) < record.reach);
    assert.ok(mount.y >= 4 && mount.y + 3.1 * mount.scale <= 8.01);
    assert.ok(Math.abs(mount.z - 3.5) < .1, 'cladding is centimetres from collision face');
    assert.deepEqual([record.x, record.z], [0, 0], 'interaction position is not relocated');
  }
  for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) assert.ok(Math.hypot(used[i].x - used[j].x, used[i].z - used[j].z) >= 1.6);
  const floating = latticeMachinePlacement(records[0], {...arena, blocks: []});
  assert.equal(floating.projected, true); assert.ok(floating.y >= 7.2);
});

test('nine procedural silhouettes have distinct geometry and tools stay bounded under reduced motion', () => {
  const signatures = new Set();
  for (const kind of LATTICE_MACHINE_KINDS) {
    const template = buildLatticeMachineGeometry(kind, {simple: true});
    const p = template.body.attributes.position;
    signatures.add(`${p.count}:${Array.from(p.array).reduce((sum, value, i) => sum + value * (i % 17), 0).toFixed(3)}`);
    assert.ok(p.count < 3000, `${kind} simplified chassis stays small`);
    assert.ok(template.body.boundingBox.max.y < 3);
    const reducedA = latticeToolPose(kind, {moving: true}, 0, true), reducedB = latticeToolPose(kind, {moving: true}, 99, true);
    assert.deepEqual(reducedA, reducedB);
    const active = latticeToolPose(kind, {moving: true}, 1, false);
    assert.ok(Math.abs(active.x) <= .43 && Math.abs(active.rz) <= .12);
    assert.deepEqual(latticeToolPose(kind, {moving: false}, 1), latticeToolPose(kind, {moving: false}, 20));
    template.body.dispose(); template.tool.dispose();
  }
  assert.equal(signatures.size, LATTICE_MACHINE_KINDS.length);
});

test('scene reuses stationary batches/resources, reflects shard removal and disposes each owned resource once', () => {
  const assets = new LatticeWorldAssets({software: true}), root = new T.Group(); root.add(assets.root);
  const match = frame([terminal('DEPLOY', {oracleActive: true, shards: {0: 'ready'}})]);
  assert.equal(assets.update(match, arena), 2);
  const meshes = [...assets.stationary.meshes.values()], resources = assets.resources.size;
  const matrixVersion = meshes[0].instanceMatrix.version;
  const resourceDisposals = new Map();
  for (const resource of assets.resources) resource.addEventListener('dispose', () => resourceDisposals.set(resource, (resourceDisposals.get(resource) ?? 0) + 1));
  assets.update({...match, time: 30}, arena);
  assert.equal(assets.resources.size, resources); assert.deepEqual([...assets.stationary.meshes.values()], meshes);
  assert.equal(meshes[0].instanceMatrix.version, matrixVersion, 'stationary transforms never upload on quiet frames');
  assert.equal(assets.dynamic.meshes.get('shards:team0').count, 1);
  assets.update(frame([terminal('DEPLOY', {oracleActive: false, shards: {0: 'carried'}})]), arena);
  assert.equal(assets.dynamic.meshes.get('shards:team0').count, 0);
  assets.dispose(); assets.dispose();
  assert.equal(root.children.length, 0); assert.equal(assets.resources.size, 0);
  assert.ok([...resourceDisposals.values()].every(count => count === 1));
  assert.equal(resourceDisposals.size, resources);
});

test('ArenaView integration replaces generic node silhouettes and has an independent clear lifecycle', () => {
  const marker = new T.Group(); marker.userData = {cocsNode: true, beacon: new T.Group(), emblem: new T.Group(), cocsLabel: new T.Group()};
  const view = {worldGroup: new T.Group(), renderer: {isSoftware: true}, objectiveModels: new Map([['r', marker]]), objectiveColor: () => '#bbddcc', reduced: () => true};
  assert.equal(updateLatticeWorld(view, frame([terminal('HACK')]), arena), 2);
  assert.equal(marker.userData.beacon.visible, true); assert.equal(marker.userData.emblem.visible, false);
  assert.equal(view.worldGroup.children.length, 1);
  clearLatticeWorld(view); assert.equal(view.worldGroup.children.length, 0); assert.equal(view.latticeWorldAssets, null);
});
