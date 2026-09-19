// LATTICE STRIKE (`cocs`) V0b traversal devices, depots and light vehicles.
//
// Spec: docs/design/COCS-MODE-SPEC.md §6A.1–§6A.3 and
// docs/design/COCS-MAP-ARCHITECTURE.md §6.8. Covers the authored lattice-slice
// layer + validator acceptance/rejection, the device state machine (shared
// cooldown, cut/lock/repair channels), arrival protection (1.5 s / 50 % DR),
// depot capture/deny/vehicle lo/25 s respawn + apron/spawn immunity,
// determinism (no new RNG draws) and mode isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,floorAt} from './core.mjs';
import {LATTICE_MAPS} from './lattice-maps.mjs';
import {validateMapSchema,validateLattice} from './map-schema.mjs';
import {
 DEVICE_PARAMS, TRAVERSAL, LANE_IDENTITIES, validateLane, validateTraversal,
} from './cocs-economy.mjs';
import {
 createTraversalState, readTraversalLayer, stepCocsTraversal, useDevice, deviceInteract,
 arrivalDamageScale, applyArrivalProtection, depotApronImmune, cocsTraversalSnapshot,
} from './cocs-traversal.mjs';
import {cocsSnapshot} from './cocs.mjs';

const DT = 1 / 60;
const SLICE = LATTICE_MAPS[0];
const seeded = seed => { let n = seed >>> 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
const flatRng = () => 0.5;

const cocsMatch = (over = {}) => new Match('chatgpt', 'openclaw', flatRng, 'lattice-slice', {
 mode: 'cocs', botCount: 0, humanCount: 1, timeLimit: 120, cocsPolicy: () => [], ...over,
});
const pin = (actor, x, z, y = floorAt(x,z,SLICE)) => { actor.x = x; actor.z = z; actor.y = y; actor.vx = actor.vy = actor.vz = 0; actor.grounded = true; actor.health = 200; actor.maxHealth = 200; actor.armor = 0; actor.protection = 0; };
const hold = (match, actor, x, z, ticks) => { for (let i = 0; i < ticks; i++) { pin(actor, x, z); match.step(DT, {inputs: {}}); } };

// ---------------------------------------------------------------------------
// Authored layer + validators
// ---------------------------------------------------------------------------
test('lattice-slice authors the §6A traversal layer and every validator gate passes', () => {
 assert.deepEqual(validateMapSchema(SLICE), []);
 assert.deepEqual(validateLattice(SLICE), []);
 const layer = readTraversalLayer(SLICE);
 assert.ok(layer.devices.length >= 9, `device count ${layer.devices.length}`);
 assert.equal(layer.depots.length, 4);
 const kinds = new Set(layer.devices.map(device => device.kind));
 for (const kind of ['zipline', 'jump-pad', 'launcher', 'teleporter']) assert.ok(kinds.has(kind), `${kind} is authored`);
 // Vehicles cannot use a zipline/pad/launcher/teleporter.
 assert.ok(layer.devices.every(device => device.vehiclesAllowed !== true));
 // Lane identity table: exactly three unique identities, vehicle permission fixed.
 assert.equal(SLICE.lanes.length, 3);
 const identities = SLICE.lanes.map(lane => lane.identity ?? lane.kind);
 assert.deepEqual([...identities].sort(), ['cqc', 'vehicle-road', 'zipline-flank']);
 for (const lane of SLICE.lanes) {
  assert.ok(lane.bypassFraction >= TRAVERSAL.bypassMin && lane.bypassFraction <= TRAVERSAL.bypassMax, `${lane.id} bypass`);
  assert.ok(lane.chokepoints >= 1 && lane.chokepoints <= 2);
  assert.equal(typeof lane.landmark, 'string');
  assert.equal(lane.vehicles, lane.identity === 'vehicle-road');
  assert.deepEqual(validateLane(lane, {requireDoctrine: true}).errors, []);
 }
 for (const identity of LANE_IDENTITIES) assert.ok(identities.includes(identity.identity));
 // Depots sit on the vehicle road only.
 assert.ok(layer.depots.every(depot => depot.lane === 'north-road'));
});

test('validateMapSchema rejects a malformed authored traversal layer', () => {
 const clone = () => JSON.parse(JSON.stringify(SLICE));
 let map = clone();
 map.traversal[0].arrival = {x: -116, z: 0, r: 3, seconds: 0.5, approaches: 1};
 let errors = validateMapSchema(map);
 assert.ok(errors.some(error => error.includes('traversal[0]')), 'bad arrival is reported');
 map = clone();
 map.traversal[0].lane = 'centre-cqc';
 errors = validateMapSchema(map);
 assert.ok(errors.some(error => error.includes('may not sit on')), 'device/lane mismatch is reported');
 map = clone();
 map.traversal[0].vehiclesAllowed = true;
 errors = validateMapSchema(map);
 assert.ok(errors.some(error => error.includes('vehicles cannot use')), 'vehicle exclusion is reported');
 map = clone();
 map.depots[0].lane = 'south-flank';
 errors = validateMapSchema(map);
 assert.ok(errors.some(error => error.includes('depots[0]')), 'depot off the vehicle road is reported');
 map = clone();
 map.lanes[2].vehicles = true;
 errors = validateMapSchema(map);
 assert.ok(errors.some(error => error.includes('vehicle permission')), 'lane vehicle permission is reported');
 map = clone();
 map.traversal[0].bypassFraction = 0.9;
 errors = validateMapSchema(map);
 assert.ok(errors.some(error => error.includes('bypass')), 'bypass fraction is reported');
});

test('validateTraversal context rejects lane, arrival, siting and vehicle abuse', () => {
 const lanes = [
  {id: 'north', identity: 'vehicle-road', kind: 'vehicle-road', vehicles: true, bypassFraction: 0.5, chokepoints: 2, landmark: 'gantry'},
  {id: 'centre', identity: 'cqc', kind: 'cqc', vehicles: false, bypassFraction: 0.5, chokepoints: 2, landmark: 'chimney'},
  {id: 'south', identity: 'zipline-flank', kind: 'zipline-flank', vehicles: false, bypassFraction: 0.5, chokepoints: 1, landmark: 'spire'},
 ];
 const nodes = [{id: 'relay', x: 0, z: 0, r: 14, archetype: 'relay'}];
 const spawns = [{x: -116, z: 0}, {x: 116, z: 0}];
 const context = {lanes, nodes, spawns, requireLane: true, requireArrival: true};
 const zip = kind => ({kind, id: 'zip-1', lane: 'south', from: {x: -40, z: 50}, to: {x: -6, z: 44}, cuttable: true, speed: 9, vehiclesAllowed: false, bypassFraction: 0.5, approaches: 2, arrival: {x: -6, z: 44, r: 5, seconds: 1.5}});
 assert.equal(validateTraversal(zip('zipline'), context).ok, true);
 assert.equal(validateTraversal({...zip('zipline'), lane: 'centre'}, context).ok, false, 'zipline on a CQC lane');
 assert.equal(validateTraversal({kind: 'launcher', id: 'l-1', lane: 'south', target: {x: -6, z: 44}, lockable: true, approaches: 2, arrival: {x: -6, z: 44, r: 5, seconds: 1.5}}, context).ok, false, 'launcher on a zipline lane');
 assert.equal(validateTraversal({...zip('zipline'), vehiclesAllowed: true}, context).ok, false, 'vehicle-capable zipline');
 assert.equal(validateTraversal({...zip('zipline'), approaches: 1}, context).ok, false, 'dead-end arrival');
 assert.equal(validateTraversal({...zip('zipline'), arrival: {x: 0, z: 0, r: 5, seconds: 1.5}}, context).ok, false, 'arrival inside capture radius');
 assert.equal(validateTraversal({...zip('zipline'), arrival: {x: -110, z: 0, r: 5, seconds: 1.5}}, context).ok, false, 'arrival too close to a spawn');
 assert.equal(validateTraversal({...zip('zipline'), bypassFraction: 0.9}, context).ok, false, 'bypass > 0.75');
 assert.equal(validateTraversal({...zip('zipline'), lane: 'ghost'}, context).ok, false, 'unknown lane');
 const depot = {kind: 'depot', id: 'd-1', lane: 'north', x: -70, z: -50, exits: 2, nodeDistanceMeters: 40, chokepointDistanceMeters: 15};
 assert.equal(validateTraversal(depot, context).ok, true);
 assert.equal(validateTraversal({...depot, exits: 1}, context).ok, false, 'depot needs 2 exits');
 assert.equal(validateTraversal({...depot, lane: 'centre'}, context).ok, false, 'depot off the vehicle road');
});

test('validateLane doctrine requires the fixed identity fields once the layer opts in', () => {
 const base = {id: 'south', identity: 'zipline-flank', traversal: {kind: 'zipline-flank'}, vehicles: false, bypassFraction: 0.5, chokepoints: 1, landmark: 'spire'};
 assert.deepEqual(validateLane(base, {requireDoctrine: true}).errors, []);
 const missing = {...base}; delete missing.bypassFraction;
 assert.ok(validateLane(missing, {requireDoctrine: true}).errors.some(error => error.includes('bypass')));
 assert.ok(validateLane({...base, vehicles: true}, {requireDoctrine: true}).errors.some(error => error.includes('vehicle permission')));
 assert.ok(validateLane({...base, identity: 'cqc', traversal: {kind: 'zipline-flank'}}, {requireDoctrine: true}).errors.some(error => error.includes('must match')));
});

// ---------------------------------------------------------------------------
// Device state machine
// ---------------------------------------------------------------------------
test('device use boards a real ride, arrival protection lands with the rider and the shared cooldown holds', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const actor = match.actors[0];
 actor.team = 0;
 pin(actor, -40, 50);
 assert.equal(useDevice(match, state, actor.id, 'zip-s-w'), true);
 const device = state.traversal.devices['zip-s-w'];
 const target = device.to;
 // A zipline is ridden, not blinked: the ride is live and the actor is still
 // at the boarding anchor instead of the destination.
 assert.ok(actor.zipRide, 'the zipline ride is live');
 assert.ok(Math.hypot(actor.x-target.x,actor.z-target.z)>10, `not teleported (${actor.x},${actor.z})`);
 assert.ok(!actor.cocsArrival, 'arrival protection waits for the landing');
 assert.equal(state.traversal.stats.uses, 1);
 // Ride it out on the fixed clock; protection applies at the far anchor.
 for (let i = 0; i < 400 && actor.zipRide; i++) match.step(DT, {inputs: {}});
 assert.equal(actor.zipRide, null, 'the ride releases at the far anchor');
 assert.ok(Math.hypot(actor.x-target.x,actor.y-target.y,actor.z-target.z)<1e-6, `arrived at ${actor.x},${actor.z}`);
 assert.ok(actor.cocsArrival && actor.cocsArrival.remaining > 1.4 && actor.cocsArrival.damageReduction === 0.5);
 assert.equal(arrivalDamageScale(actor), 0.5);
 // The shared cooldown blocks a second traversal until it elapses.
 assert.equal(useDevice(match, state, actor.id, 'zip-s-w'), false);
 hold(match, actor, -40, 50, Math.round(DEVICE_PARAMS.zipline.sharedCooldown / DT) + 2);
 assert.equal(useDevice(match, state, actor.id, 'zip-s-w'), true);
 assert.equal(state.traversal.stats.uses, 2);
});

test('bot auto-use is opt-in: two ticks of intent trigger the device when enabled', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 state.traversal.botUse = true;
 const actor = match.actors[0];
 actor.team = 0;
 actor.bot = {};
 pin(actor, -40, 50);
 stepCocsTraversal(match, state, DT);
 assert.equal(state.traversal.stats.uses, 0, 'one tick only arms the intent');
 pin(actor, -40, 50);
 stepCocsTraversal(match, state, DT);
 assert.equal(state.traversal.stats.uses, 1, 'the second tick fires');
 assert.ok(actor.zipRide, 'the bot boards the cable instead of blinking');
 for (let i = 0; i < 400 && actor.zipRide; i++) match.step(DT, {inputs: {}});
 const target=state.traversal.devices['zip-s-w'].to;
 assert.ok(Math.hypot(actor.x-target.x,actor.y-target.y,actor.z-target.z)<1e-6);
});

test('a zipline cut needs a 3 s hold and lasts 45 s; either team may repair it in 6 s', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const actor = match.actors[0];
 actor.team = 0;
 const from = state.traversal.devices['zip-s-w'].from;
 // 5 m off the anchor: inside the 6 m interact range, outside the 0.9 m use range.
 const ax = from.x + 5;
 pin(actor, ax, from.z);
 assert.equal(deviceInteract(match, state, actor.id, 'zip-s-w', 'cut'), true);
 hold(match, actor, ax, from.z, Math.round(2.9 / DT));
 assert.equal(state.traversal.devices['zip-s-w'].state, 'live', 'not cut before the 3 s channel completes');
 hold(match, actor, ax, from.z, 10);
 assert.equal(state.traversal.devices['zip-s-w'].state, 'cut');
 assert.ok(state.traversal.devices['zip-s-w'].timer > TRAVERSAL.cutSeconds - 1);
 assert.equal(state.traversal.stats.cuts, 1);
 // Cutting denies both teams: a use attempt is refused while cut.
 assert.equal(useDevice(match, state, actor.id, 'zip-s-w'), false);
 pin(actor, ax, from.z);
 assert.equal(deviceInteract(match, state, actor.id, 'zip-s-w', 'repair'), true);
 hold(match, actor, ax, from.z, Math.round(6.1 / DT));
 assert.equal(state.traversal.devices['zip-s-w'].state, 'live');
 assert.equal(state.traversal.stats.repairs, 1);
});

test('a pad locks for 30 s behind a 2.5 s channel and repairs in 4 s', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const actor = match.actors[0];
 actor.team = 1;
 const from = state.traversal.devices['pad-s-w'].from;
 const ax = from.x - 5; // clear side of the Foundry freight baffle
 pin(actor, ax, from.z);
 assert.equal(deviceInteract(match, state, actor.id, 'pad-s-w', 'lock'), true);
 hold(match, actor, ax, from.z, Math.round(2.6 / DT));
 assert.equal(state.traversal.devices['pad-s-w'].state, 'locked');
 assert.ok(state.traversal.devices['pad-s-w'].timer > DEVICE_PARAMS['jump-pad'].lockSeconds - 1);
 assert.equal(state.traversal.stats.locks, 1);
 pin(actor, ax, from.z);
 assert.equal(deviceInteract(match, state, actor.id, 'pad-s-w', 'repair'), true);
 hold(match, actor, ax, from.z, Math.round(4.1 / DT));
 assert.equal(state.traversal.devices['pad-s-w'].state, 'live');
 assert.equal(state.traversal.stats.repairs, 1);
});

test('a locked device cannot be used until repaired, and arrival expires', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const actor = match.actors[0];
 actor.team = 0;
 const device = state.traversal.devices['zip-s-w'];
 device.state = 'cut';
 device.timer = 5;
 pin(actor, device.from.x, device.from.z);
 assert.equal(useDevice(match, state, actor.id, 'zip-s-w'), false);
 // Arrival protection ticks out on the fixed clock.
 applyArrivalProtection(state.traversal, actor, 1);
 assert.equal(arrivalDamageScale(actor), 0.5);
 stepCocsTraversal(match, state, TRAVERSAL.arrivalSeconds + 0.01);
 assert.equal(arrivalDamageScale(actor), 1);
});

test('traversal and depots never touch the FLUX economy (supply/upkeep non-interaction)', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const actor = match.actors[0];
 actor.team = 0;
 const before = state.flux[0];
 const spentBefore = state.fluxSpent[0];
 const device = state.traversal.devices['zip-s-w'];
 pin(actor, device.from.x + 5, device.from.z);
 deviceInteract(match, state, actor.id, 'zip-s-w', 'cut');
 hold(match, actor, device.from.x + 5, device.from.z, Math.round(3.2 / DT));
 assert.equal(state.traversal.devices['zip-s-w'].state, 'cut');
 // Cutting a zipline denies traversal, not team income; depots gate vehicles
 // and REQ spend only, never FLUX/THREADS.
 assert.equal(state.fluxSpent[0], spentBefore);
 assert.ok(state.flux[0] >= before, 'FLUX still only accrues');
 const depot = state.traversal.depots['depot-fwd-w'];
 hold(match, actor, depot.x, depot.z, Math.round(10.2 / DT));
 assert.equal(depot.owner, 0);
 assert.equal(state.fluxSpent[0], spentBefore, 'a captured depot spends no FLUX');
});

// ---------------------------------------------------------------------------
// Depots + light vehicles
// ---------------------------------------------------------------------------
test('a forward depot is captured in 10 s and spawns an owner loaner with 3 s immunity', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const actor = match.actors[0];
 actor.team = 0;
 const depot = state.traversal.depots['depot-fwd-w'];
 hold(match, actor, depot.x, depot.z, Math.round(9.5 / DT));
 assert.equal(depot.owner, null, 'not captured before the 10 s channel');
 hold(match, actor, depot.x, depot.z, Math.round(0.7 / DT));
 assert.equal(depot.owner, 0);
 assert.equal(state.traversal.stats.depotCaptures, 1);
 const vehicle = match.vehicles.find(entry => entry.depotId === 'depot-fwd-w');
 assert.ok(vehicle, 'the owned depot spawned its Puma');
 assert.ok(vehicle.spawnImmunity > 0 && vehicle.spawnImmunity <= DEVICE_PARAMS.depot.vehicleSpawnImmunitySeconds);
 // 3 s spawn immunity: no damage lands.
 const enemy = match.actor(1, 'chatgpt', 'openclaw');
 enemy.team = 1; enemy.health = 200; enemy.maxHealth = 200;
 assert.equal(match.damageVehicle(vehicle, 5000, enemy), 0, 'spawn immunity blocks damage');
 for (let i = 0; i < Math.round(3.1 / DT); i++) match.step(DT, {inputs: {}});
 assert.ok(match.damageVehicle(vehicle, 5000, enemy) > 0, 'damage lands after immunity');
 assert.equal(vehicle.health, 0);
 assert.equal(Math.round(vehicle.respawnTimer), DEVICE_PARAMS.depot.vehicleRespawnSeconds, '25 s depot respawn');
});

test('a destroyed loaner respawns at its depot after 25 s and the depot tracks the timer', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const depot = state.traversal.depots['depot-hq-w'];
 // The HQ depot owns from tick one, so its loaner exists immediately.
 stepCocsTraversal(match, state, DT);
 const vehicle = match.vehicles.find(entry => entry.depotId === 'depot-hq-w');
 assert.ok(vehicle, 'HQ depot loaner exists');
 vehicle.spawnImmunity = 0;
 const enemy = match.actor(1, 'chatgpt', 'openclaw');
 enemy.team = 1;
 match.damageVehicle(vehicle, 5000, enemy);
 assert.equal(vehicle.health, 0);
 stepCocsTraversal(match, state, DT);
 assert.ok(depot.respawn > 24 && depot.respawn <= 25, `depot respawn ${depot.respawn}`);
 assert.ok(Math.hypot(vehicle.spawn.x - depot.x, vehicle.spawn.z - depot.z) <= depot.radius, 'respawn anchors at the depot');
 for (let i = 0; i < Math.round(25.5 / DT); i++) match.step(DT, {inputs: {}});
 assert.ok(vehicle.health > 0, 'the loaner is back');
 assert.ok(Math.hypot(vehicle.position.x - depot.x, vehicle.position.z - depot.z) < 4, 'respawned within the depot');
});

test('depot capture is denied while both teams contest, and the apron is owner-only', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const blue = match.actors[0]; blue.team = 0;
 const red = match.actor(1, 'chatgpt', 'openclaw'); red.team = 1; red.health = 200; red.maxHealth = 200;
 match.actors.push(red);
 const depot = state.traversal.depots['depot-fwd-e'];
 for (let i = 0; i < 120; i++) { pin(blue, depot.x, depot.z); pin(red, depot.x + 1, depot.z); match.step(DT, {inputs: {}}); }
 assert.equal(depot.contested, true, 'both teams on the point contest');
 assert.equal(depot.owner, null, 'contested capture makes no progress');
 assert.equal(depot.progress[0], 0);
 // Apron: a friendly depot owner is immune to enemy fire inside 6 m.
 depot.owner = 0; depot.contested = false;
 pin(blue, depot.x + 2, depot.z);
 const source = {id: 999, team: 1};
 assert.equal(depotApronImmune(match, blue, source), true);
 assert.equal(match.damage(blue, 50, source), 0, 'owner-only apron blocks enemy damage');
 assert.equal(depotApronImmune(match, blue, {id: 0, team: 0}), false, 'friendly fire is unaffected');
 pin(blue, depot.x + 30, depot.z);
 assert.equal(depotApronImmune(match, blue, source), false, 'outside the apron is vulnerable');
});

// ---------------------------------------------------------------------------
// Snapshot, determinism, isolation
// ---------------------------------------------------------------------------
test('the cocs snapshot exposes id-keyed, delta-friendly traversal state', () => {
 const match = cocsMatch();
 match.step(DT, {inputs: {}});
 const snapshot = cocsSnapshot(match);
 assert.ok(snapshot.traversal);
 assert.equal(snapshot.traversal.devices.length, SLICE.traversal.length);
 assert.equal(snapshot.traversal.depots.length, 4);
 const zip = snapshot.traversal.devices.find(device => device.id === 'zip-s-w');
 assert.deepEqual(Object.keys(zip).sort(), ['channel', 'id', 'kind', 'lane', 'state', 'timer', 'to', 'x', 'z']);
 assert.ok(snapshot.traversal.stats.vehicleSpawns >= 2, 'HQ loaners counted');
});

test('seeded traversal runs are byte-identical and draw no extra RNG', () => {
 const run = seed => {
  const draws = {count: 0};
  const base = seeded(seed);
  const random = () => { draws.count++; return base(); };
  const match = new Match('chatgpt', 'openclaw', random, 'lattice-slice', {mode: 'cocs', botCount: 7, humanCount: 1, aiSeats: true, difficulty: 'normal', timeLimit: 90});
  for (let i = 0; i < 900 && !match.over; i++) match.step(DT, {inputs: {}});
  return {traversal: JSON.stringify(cocsSnapshot(match).traversal), draws: draws.count, over: match.over, time: match.time};
 };
 const first = run(7);
 const second = run(7);
 assert.equal(first.traversal, second.traversal, 'traversal state is deterministic');
 assert.equal(first.draws, second.draws, 'same RNG draw order');
 assert.equal(first.over, second.over);
});

test('mode isolation: non-cocs modes author no traversal state or depot vehicles', () => {
 const match = new Match('chatgpt', 'openclaw', flatRng, 'lattice-slice', {mode: 'domination', botCount: 2, humanCount: 1, difficulty: 'normal'});
 assert.equal(match.objectiveState.kind, 'domination');
 assert.equal(match.objectiveState.traversal, undefined);
 assert.equal(match.vehicles.length, 0, 'depot loaners never spawn outside cocs');
 for (let i = 0; i < 120; i++) match.step(DT, {inputs: {}});
 assert.equal(match.vehicles.length, 0);
 assert.equal(cocsSnapshot(match), null);
});
