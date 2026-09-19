// LATTICE ziplines: a use is a RIDE, not a teleport.
//
// Covers the authored Foundry cables end to end through a real `Match.step`:
// many intermediate samples, arc-length travel at the authored speed, the sag
// and landing blend, collision-safe resolution (raise/truncate/block instead of
// clipping), jump-off, arrival protection, netcode prediction + snapshot
// resync, and the view/audio-facing effect events at both ends. The first test
// is the regression: the old behaviour moved the actor to `to` in one tick with
// `zipRide === null`, and this suite fails on that build.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {Match,floorAt,obstructed,rayWorld} from './core.mjs';
import {LATTICE_MAPS} from './lattice-maps.mjs';
import {RULES} from './data.mjs';
import {buildZipRide,resolveZipRide,zipRidePoint,ZIP_RIDE} from './movement.mjs';
import {ArenaView} from './view.mjs';

const DT = 1 / 60;
const SLICE = LATTICE_MAPS[0];
const flatRng = () => 0.5;
const cocsMatch = (over = {}) => new Match('chatgpt', 'openclaw', flatRng, 'lattice-slice', {
 mode: 'cocs', botCount: 0, humanCount: 1, timeLimit: 120, cocsPolicy: () => [], ...over,
});
const pin = (actor, x, z, y = floorAt(x, z, SLICE)) => {
 actor.x = x; actor.z = z; actor.y = y;
 actor.vx = actor.vy = actor.vz = 0; actor.grounded = true;
 actor.health = 200; actor.maxHealth = 200; actor.armor = 0; actor.protection = 0;
};

// ---------------------------------------------------------------------------
// Real Match.step ride (the regression)
// ---------------------------------------------------------------------------
test('a Lattice zipline use rides the cable over many ticks instead of teleporting', () => {
 const match = cocsMatch();
 const actor = match.actors[0];
 actor.team = 0;
 const device = match.objectiveState.traversal.devices['zip-s-w'];
 pin(actor, device.from.x, device.from.z);
 match.step(DT, {inputs: {0: {interact: true}}});
 // Old build: actor at (-6, 4, 46) with zipRide === null after this one tick.
 assert.ok(actor.zipRide, 'the ride is live on the first tick');
 assert.ok(Math.hypot(actor.x - device.to.x, actor.z - device.to.z) > 10, `still near the boarding anchor (${actor.x.toFixed(1)}, ${actor.z.toFixed(1)})`);
 const ride = actor.zipRide;
 const samples = [];
 for (let i = 0; i < 400 && actor.zipRide; i++) {
  match.step(DT, {inputs: {}});
  samples.push({x: actor.x, y: actor.y, z: actor.z, t: i * DT});
 }
 assert.equal(actor.zipRide, null, 'the ride releases');
 assert.ok(samples.length >= 100, `at least ~2 s of intermediate samples (${samples.length})`);
 assert.ok(Math.hypot(actor.x - device.to.x, actor.z - device.to.z) < 1e-6, `lands on the far pad (${actor.x.toFixed(2)}, ${actor.z.toFixed(2)})`);
 assert.ok(actor.grounded, 'lands grounded');
 // Monotonic travel along the cable: distance from the boarding anchor never
 // decreases and the actor never jumps a meaningful fraction of the line.
 const from = {x: ride.from.x, y: ride.from.y, z: ride.from.z};
 let previous = 0;
 for (const sample of samples) {
  const travelled = Math.hypot(sample.x - from.x, sample.y - from.y, sample.z - from.z);
  assert.ok(travelled >= previous - 1e-9, `travel is monotonic at ${sample.t.toFixed(2)} s`);
  assert.ok(travelled - previous < ride.length * .2 + 1, 'no teleport-sized step between samples');
  previous = travelled;
 }
 assert.ok(previous > ride.length - 2, 'the samples span the authored cable');
 // Event stream: start + arrival, both carrying the anchors.
 const types = match.events.map(event => event.type);
 assert.ok(types.includes('zipline'), 'a zipline start event is emitted');
 assert.ok(types.includes('zipline-arrival'), 'a zipline arrival event is emitted');
 const startEvent = match.events.find(event => event.type === 'zipline');
 const arrivalEvent = match.events.find(event => event.type === 'zipline-arrival');
 assert.deepEqual(startEvent.from, {x: device.from.x, y: device.from.y + 2.2, z: device.from.z});
 assert.ok(Math.hypot(arrivalEvent.to.x - device.to.x, arrivalEvent.to.z - device.to.z) < 1e-6);
});

test('the ride follows the authored sag, faces travel and keeps its speed bound', () => {
 const match = cocsMatch();
 const actor = match.actors[0];
 actor.team = 0;
 const device = match.objectiveState.traversal.devices['zip-s-w'];
 pin(actor, device.from.x, device.from.z);
 match.step(DT, {inputs: {0: {interact: true}}});
 match.step(DT, {inputs: {}});
 const ride = actor.zipRide;
 assert.ok(ride && ride.resolved === true, 'the ride resolves against the world');
 // Duration is never faster than the authored speed.
 assert.ok(ride.duration >= ride.length / ride.speed - 1e-9, `duration ${ride.duration.toFixed(3)} >= ${(ride.length / ride.speed).toFixed(3)}`);
 assert.ok(ride.duration >= ZIP_RIDE.minDuration - 1e-9, 'readable minimum duration');
 // The path sags below the straight chord.
 const mid = zipRidePoint(ride, .5);
 const chordMid = (ride.from.y + ride.to.y) / 2;
 assert.ok(mid.y < chordMid - .25, `sag reads (${mid.y.toFixed(2)} < ${chordMid.toFixed(2)})`);
 const startsAt = {x: actor.x, y: actor.y, z: actor.z};
 let faced = 0;
 for (let i = 0; i < 400 && actor.zipRide; i++) {
  match.step(DT, {inputs: {}});
  if (actor.zipRide) {
   // bodyYaw is the cable tangent: sin/cos convention matches the sim.
   const tx = -Math.sin(actor.bodyYaw), tz = -Math.cos(actor.bodyYaw);
   const dx = ride.to.x - ride.from.x, dz = ride.to.z - ride.from.z, d = Math.hypot(dx, dz);
   if ((tx * dx + tz * dz) / d > .98) faced++;
  }
 }
 assert.ok(faced >= 100, `faces the direction of travel for most of the ride (${faced} samples)`);
 assert.ok(Math.hypot(actor.x - device.to.x, actor.z - device.to.z) < 1e-6, 'arrives at the far anchor');
 assert.ok(startsAt.y > floorAt(startsAt.x, startsAt.z, SLICE) + 1.5, 'boards above the ground pad');
});

test('no intermediate ride sample clips Foundry terrain, solids or ceilings', () => {
 const match = cocsMatch();
 const actor = match.actors[0];
 actor.team = 0;
 const device = match.objectiveState.traversal.devices['zip-s-w'];
 pin(actor, device.from.x, device.from.z);
 match.step(DT, {inputs: {0: {interact: true}}});
 let checked = 0;
 for (let i = 0; i < 400 && actor.zipRide; i++) {
  match.step(DT, {inputs: {}});
  if (!actor.zipRide) break;
  const floor = floorAt(actor.x, actor.z, SLICE);
  assert.ok(floor !== null, 'the cable stays over authored ground');
  assert.ok(actor.y >= floor - .05, `never below the floor (${actor.y.toFixed(2)} >= ${floor.toFixed(2)})`);
  assert.ok(!obstructed(actor.x, actor.y + .05, actor.z, RULES.radius, SLICE), `never inside a solid at ${actor.x.toFixed(2)},${actor.z.toFixed(2)}`);
  const ceiling = rayWorld({x: actor.x, y: actor.y + .05, z: actor.z}, {x: 0, y: 1, z: 0}, RULES.height, SLICE);
  assert.ok(ceiling >= RULES.height - 1e-6, 'never threaded through a roof');
  checked++;
 }
 assert.ok(checked >= 100, `checked ${checked} live samples`);
});

test('jump-off detaches with cable momentum and a safe landing', () => {
 const match = cocsMatch();
 const actor = match.actors[0];
 actor.team = 0;
 const device = match.objectiveState.traversal.devices['zip-s-w'];
 pin(actor, device.from.x, device.from.z);
 match.step(DT, {inputs: {0: {interact: true}}});
 for (let i = 0; i < 40 && (actor.zipRide?.t ?? 0) < ZIP_RIDE.lockSeconds + .2; i++) match.step(DT, {inputs: {}});
 assert.ok(actor.zipRide, 'still riding before the jump');
 match.step(DT, {inputs: {0: {jump: true}}});
 assert.equal(actor.zipRide, null, 'jump-off releases the cable');
 assert.ok(actor.vy > 0 && !actor.grounded, 'the rider leaves with a hop');
 assert.ok(match.events.some(event => event.type === 'zipline-jump'), 'the jump-off event is emitted');
 for (let i = 0; i < 240 && !actor.grounded; i++) match.step(DT, {inputs: {}});
 assert.ok(actor.grounded, 'landed');
 const floor = floorAt(actor.x, actor.z, SLICE);
 assert.ok(floor !== null && !obstructed(actor.x, floor + .05, actor.z, RULES.radius, SLICE), 'landed in the clear');
});

test('a cocs teleporter emits the `teleport` event the view/audio consume', () => {
 const match = cocsMatch();
 const actor = match.actors[0];
 actor.team = 0;
 const device = match.objectiveState.traversal.devices['tp-c-w'];
 pin(actor, device.from.x, device.from.z);
 match.step(DT, {inputs: {0: {interact: true}}});
 assert.ok(Math.hypot(actor.x - device.to.x, actor.z - device.to.z) < 1e-6, 'teleporters stay instant by design');
 const event = match.events.find(entry => entry.type === 'teleport');
 assert.ok(event, 'the canonical teleport event is emitted for cocs devices');
 assert.ok(Math.hypot(event.from.x - device.from.x, event.from.z - device.from.z) < 1e-6);
 assert.ok(Math.hypot(event.to.x - device.to.x, event.to.z - device.to.z) < 1e-6);
 assert.ok(actor.cocsArrival?.remaining > 1.4, 'instant arrival protection lands at the exit');
});

test('a cocs launcher flies the authored arc over time and lands on its target', () => {
 const match = cocsMatch();
 const actor = match.actors[0];
 actor.team = 0;
 const device = match.objectiveState.traversal.devices['lap-n'];
 const target = device.target ?? device.to;
 pin(actor, device.from.x, device.from.z);
 match.step(DT, {inputs: {0: {interact: true}}});
 assert.ok(actor.traversalFlight === true, 'the launcher starts a ballistic flight');
 assert.ok(!actor.zipRide && Math.hypot(actor.x - target.x, actor.z - target.z) > 10, 'not blinked to the target');
 assert.ok(match.events.some(entry => entry.type === 'launcher'), 'the launcher event is emitted');
 const first = {x: actor.x, y: actor.y, z: actor.z};
 const samples = [];
 for (let i = 0; i < 300 && actor.traversalFlight; i++) {
  match.step(DT, {inputs: {}});
  samples.push({x: actor.x, y: actor.y, z: actor.z});
 }
 assert.ok(samples.length >= 20, `the flight is stepped over time (${samples.length} samples)`);
 assert.ok(actor.grounded, 'the flight lands');
 assert.ok(Math.hypot(actor.x - target.x, actor.z - target.z) < 1.5, `lands on the target (${actor.x.toFixed(1)}, ${actor.z.toFixed(1)})`);
 assert.ok(match.events.some(entry => entry.type === 'launcher-arrival'), 'the arrival event is emitted');
 assert.ok(actor.cocsArrival?.remaining > 1.4, 'arrival protection applies on touchdown');
 // The arc is monotonic along the launch direction and never dips below start.
 for (const sample of samples) {
  assert.ok(sample.y >= Math.min(first.y, target.y ?? first.y) - .05, 'the arc never sinks through the ground');
 }
});

// ---------------------------------------------------------------------------
// Collision-safe resolution (unit, engine-free)
// ---------------------------------------------------------------------------
test('a cable crossing a tall wall is truncated before the wall instead of clipping', () => {
 const arena = {id: 'zip-wall-kit', raised: false, bounds: {minX: -30, maxX: 30, minZ: -20, maxZ: 20}, blocks: [{kind: 'cover', x: 0, z: 0, w: 1, d: 40, h: 10}], spawns: [[-20, 0], [20, 0]], pickups: []};
 const ride = buildZipRide({from: {x: -10, y: 2, z: 0}, to: {x: 10, y: 2, z: 0}, speed: 9, sag: 0});
 const result = resolveZipRide(ride, {
  floorAt: (x, z) => floorAt(x, z, arena),
  clear: (x, y, z, r) => !obstructed(x, y, z, r, arena),
  radius: RULES.radius,
 });
 assert.equal(result.blocked, false, 'the ride still runs');
 assert.equal(ride.truncated, true, 'it is shortened at the obstruction');
 assert.ok(ride.to.x < 0, `it stops on the near side (${ride.to.x.toFixed(2)})`);
 for (let i = 0; i <= 24; i++) {
  const point = zipRidePoint(ride, i / 24);
  assert.ok(!obstructed(point.x, point.y, point.z, RULES.radius, arena), 'no resolved sample clips the wall');
 }
});

test('a cable under a slab is raised clear instead of clipping through it', () => {
 // The slab is authored as a platform surface: `floorAt` reports its top, so
 // an authored y=1 cable underneath is unsafe until the whole line is raised.
 const arena = {id: 'zip-slab-kit', raised: false, bounds: {minX: -30, maxX: 30, minZ: -20, maxZ: 20}, blocks: [], platforms: [{x: 0, z: 0, w: 8, d: 20, y: 3}], spawns: [[-20, 0], [20, 0]], pickups: []};
 const ride = buildZipRide({from: {x: -6, y: 1, z: 0}, to: {x: 6, y: 1, z: 0}, speed: 9, sag: 0});
 const result = resolveZipRide(ride, {
  floorAt: (x, z) => floorAt(x, z, arena),
  clear: (x, y, z, r) => !obstructed(x, y, z, r, arena),
  radius: RULES.radius,
 });
 assert.equal(result.blocked, false);
 assert.ok(result.lifted >= 2, `the line is raised clear (lift ${result.lifted})`);
 for (let i = 0; i <= 24; i++) {
  const point = zipRidePoint(ride, i / 24);
  const floor = floorAt(point.x, point.z, arena);
  assert.ok(floor === null || point.y >= floor - .01, 'the raised line never sits under the slab');
 }
});

test('a boarding anchor inside a solid blocks the ride entirely', () => {
 const arena = {id: 'zip-blocked-kit', raised: false, bounds: {minX: -30, maxX: 30, minZ: -20, maxZ: 20}, blocks: [{kind: 'cover', x: -10, z: 0, w: 6, d: 6, h: 10}], spawns: [[0, 0], [20, 0]], pickups: []};
 const ride = buildZipRide({from: {x: -10, y: 1, z: 0}, to: {x: 10, y: 1, z: 0}, speed: 9, sag: 0});
 const result = resolveZipRide(ride, {
  floorAt: (x, z) => floorAt(x, z, arena),
  clear: (x, y, z, r) => !obstructed(x, y, z, r, arena),
  radius: RULES.radius,
 });
 assert.equal(result.blocked, true, 'an embedded boarding anchor never starts a ride');
});

// ---------------------------------------------------------------------------
// Netcode prediction + snapshot reconciliation
// ---------------------------------------------------------------------------
test('netcode shadow prediction and actor resync keep the ride byte-stable', () => {
 const server = cocsMatch();
 const shadow = cocsMatch();
 const anchor = server.objectiveState.traversal.devices['zip-s-w'].from;
 pin(server.actors[0], anchor.x, anchor.z);
 pin(shadow.actors[0], anchor.x, anchor.z);
 for (let i = 0; i < 2; i++) {
  server.step(DT, {inputs: {0: {interact: i === 0}}});
  shadow.step(DT, {inputs: {0: {interact: i === 0}}});
 }
 assert.ok(server.actors[0].zipRide && shadow.actors[0].zipRide, 'both predict the ride');
 // Mid-ride reconciliation: the shadow copies the authoritative actor exactly
 // as net.mjs resync does.
 const snapshot = server.snapshot();
 const authoritative = structuredClone(snapshot.actors.find(actor => actor.id === 0));
 assert.ok(authoritative.zipRide, 'the wire snapshot carries the ride state');
 Object.assign(shadow.actors[0], authoritative);
 let maxDrift = 0;
 for (let i = 0; i < 400 && server.actors[0].zipRide; i++) {
  server.step(DT, {inputs: {}});
  shadow.step(DT, {inputs: {}});
  const a = server.actors[0], b = shadow.actors[0];
  maxDrift = Math.max(maxDrift, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
 }
 assert.equal(server.actors[0].zipRide, null, 'server ride completes');
 assert.equal(shadow.actors[0].zipRide, null, 'shadow ride completes');
 assert.ok(maxDrift < 1e-9, `no divergence after resync (max drift ${maxDrift})`);
 const a = server.actors[0], b = shadow.actors[0];
 assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9, 'arrivals match');
});

// ---------------------------------------------------------------------------
// Presentation events
// ---------------------------------------------------------------------------
test('view spawns zipline launch/arrival effects and a local teleporter FOV pulse', () => {
 const view = Object.assign(Object.create(ArenaView.prototype), {
  scene: new T.Scene(), renderResources: new Set(), sharedResources: new Set(),
  renderer: { isSoftware: true }, reduced: () => false, playerId: 1,
  _quality: () => ({ particles: 1, tracers: 1 }),
 });
 const active = () => view.effectPool?.slots.filter(slot => slot.active).length ?? 0;
 view.effect({type: 'zipline', actor: 1, from: {x: 0, y: 5, z: 0}, to: {x: 20, y: 5, z: 4}});
 assert.ok(active() > 0, 'launch beat spawns pooled effects');
 view.effectPool.clear();
 view.effect({type: 'zipline-arrival', actor: 1, from: {x: 0, y: 5, z: 0}, to: {x: 20, y: 5, z: 4}});
 assert.ok(active() > 0, 'arrival beat spawns pooled effects');
 view.effectPool.clear();
 assert.equal(view._fovPulse, undefined, 'no pulse before the local teleport');
 view.effect({type: 'teleport', actor: 1, from: {x: 0, y: 5, z: 0}, to: {x: 18, y: 5, z: 0}});
 assert.ok(active() > 0, 'both teleporter ends spawn pooled effects');
 assert.ok(view._fovPulse > 0, 'the local teleporter pulses the FOV');
 view.effectPool.clear();
 view.motionQuery = { matches: true };
 view.effect({type: 'zipline-arrival', actor: 1, from: {x: 0, y: 5, z: 0}, to: {x: 20, y: 5, z: 4}});
 assert.ok(active() > 0, 'reduced motion keeps a static arrival cue');
 view.effectPool.clear();
 view.effect({type: 'teleporter', actor: 1, from: {x: 0, y: 5, z: 0}, to: {x: 18, y: 5, z: 0}});
 assert.ok(active() > 0, 'the device-kind teleporter alias paints both ends');
 view.effectPool.clear();
 view.effect({type: 'launcher', actor: 1, from: {x: 0, y: 5, z: 0}, to: {x: 20, y: 6, z: 4}});
 assert.ok(active() > 0, 'launcher departure beat spawns pooled effects');
 view.effectPool.clear();
 view.effect({type: 'launcher-arrival', actor: 1, from: null, to: {x: 20, y: 6, z: 4}});
 assert.ok(active() > 0, 'launcher arrival beat spawns pooled effects');
 view.effectPool.dispose();
 view.disposeObject(view.scene);
});

test('view attaches a pooled carriage to riding actors and removes it on landing', () => {
 const view = Object.assign(Object.create(ArenaView.prototype), {
  scene: new T.Scene(), renderResources: new Set(), sharedResources: new Set(),
  renderer: { isSoftware: true }, reduced: () => false, playerId: 1,
  _quality: () => ({ particles: 1 }),
 });
 const actor = {id: 1, x: 3, y: 6, z: -2, bodyYaw: 1.2, zipRide: {speed: 12}};
 const match = {actors: [actor], time: 0};
 view.updateZipRides(match, .016, false);
 assert.equal(view.zipCarriages.size, 1, 'a carriage is attached to the rider');
 const model = view.zipCarriages.get(1);
 assert.ok(model.position.y > actor.y + 1, 'the carriage rides the cable above the rider');
 assert.ok(view.effectPool.slots.some(slot => slot.active), 'sparks/wind lines are emitted while riding');
 match.time = .08;
 view.updateZipRides(match, .016, false);
 actor.zipRide = null;
 view.updateZipRides(match, .016, false);
 assert.equal(view.zipCarriages.size, 0, 'the carriage is pooled back on dismount');
 view.effectPool.dispose();
 view.disposeObject(view.scene);
});
