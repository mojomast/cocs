// LATTICE STRIKE (`cocs`) W20 — device/depot HUD derivation and the tactical
// bot traversal/depot policy.
//
// Covers: the pure `cocsTraversalView` readout (device live/cut/locked + shape
// + word, cut/repair channels, depot owner/capture/loaner state, arrival
// telegraph), the opt-in contract (bot-use off is inert and byte-identical), the
// deterministic device-selection and depot-weighting policy, the engine
// consumption of `bot.cocsDevice`, and mode isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,floorAt} from './core.mjs';
import {LATTICE_MAPS} from './lattice-maps.mjs';
import {normalizeConfig} from './config.mjs';
import {cocsSnapshot} from './cocs.mjs';
import {
  cocsAssignment, cocsBotDestination, cocsDepotDuty, cocsDepotTargets,
  cocsTeamPlan, cocsTraversalChoice, cocsVehicleDuty,
} from './cocs-bots.mjs';
import {
  stepCocsTraversal, DEVICE_USE_REACH_METERS,
} from './cocs-traversal.mjs';
import {cocsCommandView, cocsTraversalView} from './cocs-orders.mjs';

const DT = 1 / 60;
const seeded = seed => { let n = seed >>> 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
const pin = (actor, x, z) => { actor.x = x; actor.z = z; actor.y = floorAt(x,z,LATTICE_MAPS[0]); actor.vx = actor.vy = actor.vz = 0; actor.grounded = true; actor.health = 200; actor.maxHealth = 200; actor.armor = 0; actor.protection = 0; };

const cocsMatch = (over = {}) => new Match('chatgpt', 'openclaw', seeded(0xC0C5), 'lattice-slice', {
  mode: 'cocs', humanCount: 1, botCount: 7, aiSeats: true, difficulty: 'normal', timeLimit: 600,
  cocsPolicy: () => [], objective: {traversalBotUse: true}, ...over,
});

// ---------------------------------------------------------------------------
// HUD derivation
// ---------------------------------------------------------------------------
const traversalSnapshot = () => ({
  tick: 100,
  traversal: {
    tick: 100,
    devices: [
      {id: 'zip-s-w', kind: 'zipline', lane: 'south-flank', state: 'live', timer: 0, x: -40, z: 50, to: {x: -6, z: 44}, channel: null},
      {id: 'pad-s-w', kind: 'jump-pad', lane: 'south-flank', state: 'cut', timer: 30, x: -26, z: 50, to: {x: -26, z: 44}, channel: {actor: 3, action: 'cut', remaining: 1.2, total: 3}},
      {id: 'tp-c-w', kind: 'teleporter', lane: 'centre-cqc', state: 'locked', timer: 20, x: -36, z: 0, to: {x: -20, z: 0}, channel: {actor: 5, action: 'repair', remaining: 2, total: 4}},
    ],
    depots: [
      {id: 'depot-fwd-w', lane: 'north-road', hq: false, x: -70, z: -50, owner: null, progress: [0.4, 0], contested: false, vehicle: {id: null, health: 0, respawn: 0}},
      {id: 'depot-hq-w', lane: 'north-road', hq: true, x: -100, z: -50, owner: 0, progress: [0, 0], contested: false, vehicle: {id: 'depot-depot-hq-w', health: 300, respawn: 0}},
      {id: 'depot-hq-e', lane: 'north-road', hq: true, x: 100, z: -50, owner: 1, progress: [0, 0], contested: true, vehicle: {id: 'depot-depot-hq-e', health: 0, respawn: 12.5}},
    ],
    arrivals: [{actor: 7, remaining: 1.1, telegraph: true, x: -6, z: 44}],
    stats: {},
  },
});

test('cocsTraversalView derives device state with a shape and a word, never colour alone', () => {
  const view = cocsTraversalView(traversalSnapshot(), {team: 0});
  assert.ok(view);
  assert.equal(view.deviceCount, 3);
  assert.equal(view.depotCount, 3);
  const zip = view.devices.find(device => device.id === 'zip-s-w');
  assert.equal(zip.label, 'ZIPLINE');
  assert.equal(zip.state, 'live');
  assert.equal(zip.stateLabel, 'LIVE');
  assert.ok(zip.mark.length > 0 && zip.stateMark.length > 0, 'each device carries two glyphs');
  assert.equal(zip.channel, null);
  const pad = view.devices.find(device => device.id === 'pad-s-w');
  assert.equal(pad.label, 'JUMP PAD');
  assert.equal(pad.stateLabel, 'CUT');
  assert.equal(pad.stateMark, '✂');
  assert.equal(pad.channel.label, 'CUTTING');
  assert.equal(pad.channel.remainingSeconds, 1.2);
  assert.equal(pad.channel.percent.toFixed(2), '0.60');
  const tp = view.devices.find(device => device.id === 'tp-c-w');
  assert.equal(tp.stateLabel, 'LOCKED');
  assert.equal(tp.channel.label, 'REPAIRING');
  for (const device of view.devices) assert.ok(device.text.includes(device.stateLabel), `${device.id} text`);
});

test('cocsTraversalView derives depot owner, capture and loaner-return state', () => {
  const view = cocsTraversalView(traversalSnapshot(), {team: 0});
  const forward = view.depots.find(depot => depot.id === 'depot-fwd-w');
  assert.equal(forward.ownerLabel, 'NEUTRAL');
  assert.equal(forward.capturePercent, 40);
  assert.equal(forward.mine, false);
  assert.equal(forward.vehicle.state, 'NONE');
  const own = view.depots.find(depot => depot.id === 'depot-hq-w');
  assert.equal(own.ownerLabel, 'YOURS');
  assert.equal(own.mine, true);
  assert.equal(own.vehicle.available, true);
  assert.equal(own.vehicle.state, 'READY');
  const enemy = view.depots.find(depot => depot.id === 'depot-hq-e');
  assert.equal(enemy.ownerLabel, 'CONTESTED');
  assert.equal(enemy.enemy, true);
  assert.equal(enemy.vehicle.respawnSeconds, 12.5);
  assert.equal(enemy.vehicle.state, 'RETURN 12.5s');
  for (const depot of view.depots) {
    assert.ok(depot.mark.length > 0, `${depot.id} mark`);
    assert.ok(depot.ownerLabel.length > 0, `${depot.id} owner word`);
  }
});

test('cocsTraversalView surfaces the channel, arrival telegraph and strip context', () => {
  const view = cocsTraversalView(traversalSnapshot(), {team: 0});
  assert.equal(view.channelDevice.id, 'pad-s-w');
  assert.equal(view.context, 'CUTTING JUMP PAD · 1.2s');
  assert.equal(view.arrivalActive, true);
  assert.equal(view.arrivals.length, 1);
  assert.equal(view.arrivalSeconds, 1.1);
  // Spectator-safe (no team) still reads owner words.
  const spectator = cocsTraversalView(traversalSnapshot(), {team: null});
  assert.equal(spectator.team, null);
  assert.equal(spectator.depots.find(depot => depot.id === 'depot-hq-w').ownerLabel, 'TEAM 0');
  // Mode isolation: no traversal subtree -> null.
  assert.equal(cocsTraversalView({tick: 1}, {team: 0}), null);
  assert.equal(cocsTraversalView({tick: 1, traversal: null}, {team: 0}), null);
  assert.equal(cocsTraversalView(null, {team: 0}), null);
});

test('cocsCommandView folds the traversal readout into the command bag', () => {
  const board = {nodes: [], live: []};
  const command = cocsCommandView(board, traversalSnapshot(), {team: 0}, null);
  assert.ok(command.traversal);
  assert.equal(command.traversal.deviceCount, 3);
  const empty = cocsCommandView(board, {tick: 1}, {team: 0}, null);
  assert.equal(empty.traversal, null, 'no traversal subtree means no traversal readout');
});

// ---------------------------------------------------------------------------
// Config seam
// ---------------------------------------------------------------------------
test('normalizeConfig preserves the explicit cocs objective override and defaults without one', () => {
  const on = normalizeConfig({mode: 'cocs', objective: {traversalBotUse: true}});
  assert.equal(on.objective.traversalBotUse, true);
  assert.equal(normalizeConfig({mode: 'cocs'}).objective, undefined, 'no override key when not supplied');
  assert.equal(normalizeConfig(null).objective, undefined);
});

// ---------------------------------------------------------------------------
// Tactical device selection
// ---------------------------------------------------------------------------
test('cocsTraversalChoice routes through a device only when it shortens the push', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  actor.bot = {};
  pin(actor, -88, 50);
  const toward = cocsTraversalChoice(match, actor, {x: 0, z: 25}, state);
  assert.ok(toward, 'the south zipline saves the western approach');
  assert.equal(toward.deviceId, 'zip-s-w2');
  assert.equal(toward.reason, 'route');
  assert.equal(toward.x, -88);
  assert.equal(toward.z, 50);
  // Deterministic and independent of repeated calls.
  assert.deepEqual(cocsTraversalChoice(match, actor, {x: 0, z: 25}, state), toward);
  // A destination the device does not help is a no-op.
  assert.equal(cocsTraversalChoice(match, actor, {x: -116, z: 0}, state), null);
});

test('cocsTraversalChoice refuses a defended landing and a dead device', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  actor.bot = {};
  pin(actor, -88, 50);
  // Park a hostile on the zip-s-w2 landing (-60, 46) and cut zip-s-w so no
  // clear alternative remains.
  state.traversal.devices['zip-s-w'].state = 'cut';
  const enemy = match.actors[1];
  enemy.team = 1;
  enemy.health = 100;
  enemy.x = -60;
  enemy.z = 46;
  assert.equal(cocsTraversalChoice(match, actor, {x: 0, z: 25}, state), null, 'a defended landing is refused');
  enemy.x = 100;
  enemy.z = 100;
  state.traversal.devices['zip-s-w'].state = 'live';
  assert.ok(cocsTraversalChoice(match, actor, {x: 0, z: 25}, state));
  state.traversal.devices['zip-s-w'].state = 'cut';
  state.traversal.devices['zip-s-w2'].state = 'cut';
  assert.equal(cocsTraversalChoice(match, actor, {x: 0, z: 25}, state), null, 'a cut device is never chosen');
});

test('cocsTraversalChoice is inert with bot-use off (the default gate-safe path)', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  state.traversal.botUse = false;
  const actor = match.actors[0];
  actor.team = 0;
  actor.bot = {};
  pin(actor, -88, 50);
  assert.equal(cocsTraversalChoice(match, actor, {x: 0, z: 25}, state), null);
  // The planner posts null so the engine never auto-fires for a planned bot.
  actor.bot.cocsDevice = null;
  assert.equal(stepCocsTraversal(match, state, DT).stats.uses, 0);
});

// ---------------------------------------------------------------------------
// Engine consumption of the planner intent
// ---------------------------------------------------------------------------
test('stepCocsTraversal fires a planned device once the bot reaches the anchor', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  actor.bot = {};
  pin(actor, -88, 50);
  actor.bot.cocsDevice = 'zip-s-w2';
  stepCocsTraversal(match, state, DT);
  assert.equal(state.traversal.stats.uses, 1);
  assert.ok(actor.zipRide, 'the bot boards the cable instead of blinking');
  assert.equal(actor.bot.cocsDevice, null, 'the fired intent is cleared');
  for (let i = 0; i < 400 && actor.zipRide; i++) match.step(DT, {inputs: {}});
  assert.ok(Math.abs(actor.x - (-60)) < 1e-6 && Math.abs(actor.z - 46) < 1e-6, `landed ${actor.x},${actor.z}`);
  assert.ok(actor.cocsArrival?.remaining > 1.4, 'arrival protection applied');
  const arrival = cocsSnapshot(match).traversal.arrivals.find(entry => entry.actor === actor.id);
  assert.ok(arrival && Math.abs(arrival.x - (-60)) < 1e-6 && Math.abs(arrival.z - 46) < 1e-6, 'arrival telegraph carries the landing');
});

test('a planned bot more than the reach from the anchor does not fire', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  actor.bot = {};
  const device = state.traversal.devices['zip-s-w2'];
  pin(actor, device.from.x + DEVICE_USE_REACH_METERS + 1, device.from.z);
  actor.bot.cocsDevice = 'zip-s-w2';
  stepCocsTraversal(match, state, DT);
  assert.equal(state.traversal.stats.uses, 0);
});

// ---------------------------------------------------------------------------
// Depot weighting
// ---------------------------------------------------------------------------
test('cocsDepotDuty commits one spare attacker to the near forward depot and is deterministic', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  state.tick = 1200;
  const plan = cocsTeamPlan(match, state, 0);
  assert.equal(plan.roster.length, 4);
  assert.ok(plan.depotDuty, 'a spare body is committed to a depot');
  assert.equal(plan.depotDuty.depotId, 'depot-fwd-w', 'only the depot near our own half qualifies');
  const depotSlot = plan.slots.find(slot => slot.kind === 'depot');
  assert.ok(depotSlot, 'the weakest attack slot becomes the depot duty');
  assert.equal(depotSlot.depotId, 'depot-fwd-w');
  assert.equal(depotSlot.nodeId, depotSlot.depotFallback, 'the node stays the fallback push');
  assert.deepEqual(cocsTeamPlan(match, state, 0).slots, plan.slots, 'identical state yields identical slots');
  // Every bot still has a slot.
  assert.equal(plan.slots.length, plan.roster.length);
});

test('depot weighting is opt-in and stands down while trailing', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  state.tick = 1200;
  const plan = cocsTeamPlan(match, state, 0);
  const ctx = {roster: plan.roster, duties: plan.duties};
  assert.ok(cocsDepotDuty(state, match.actors, 0, ctx));
  state.traversal.botUse = false;
  assert.equal(cocsDepotDuty(state, match.actors, 0, ctx), null, 'bot-use off keeps the pre-W20 squad shape');
  state.traversal.botUse = true;
  state.scores = {0: 0, 1: 5000};
  assert.equal(cocsDepotDuty(state, match.actors, 0, ctx), null, 'a material deficit recalls the depot runner');
  state.scores = {0: 0, 1: 0};
  assert.deepEqual(cocsDepotTargets(state, match.actors, 0).map(entry => entry.depotId), ['depot-fwd-w']);
});

test('a depot assignment targets the depot until it is ours, then falls back to the node', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  const slot = {kind: 'depot', nodeId: 'relay-0', depotId: 'depot-fwd-w', depotFallback: 'relay-0'};
  const assignment = {...slot};
  const before = cocsBotDestination(match, actor, assignment, state);
  assert.ok(Math.abs(before.x - (-70)) < 1e-6 && Math.abs(before.z - (-50)) < 1e-6, 'walks to the neutral depot');
  state.traversal.depots['depot-fwd-w'].owner = 0;
  const after = cocsBotDestination(match, actor, {...slot}, state);
  const node = state.nodes.find(entry => entry.id === 'relay-0');
  assert.ok(Math.hypot(after.x - node.x, after.z - node.z) <= (node.r ?? 4), 'returns to the lattice push once secured');
});

test('cocsAssignment exposes the depot slot for the engine route', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  state.tick = 1200;
  const plan = cocsTeamPlan(match, state, 0);
  const depotIndex = plan.slots.findIndex(slot => slot.kind === 'depot');
  const actor = plan.roster[depotIndex];
  const assignment = cocsAssignment(match, actor, state);
  assert.equal(assignment.kind, 'depot');
  assert.equal(assignment.depotId, 'depot-fwd-w');
  assert.equal(assignment.depotFallback, assignment.nodeId);
});

test('cocsVehicleDuty crews a ready loaner, drives to the fallback node and is deterministic', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  stepCocsTraversal(match, state, DT); // spawns the HQ-depot loaners
  for (const vehicle of match.vehicles) vehicle.spawnImmunity = 0;
  state.traversal.depots['depot-fwd-w'].owner = 0; // no depot duty remains
  state.tick = 1200;
  const plan = cocsTeamPlan(match, state, 0);
  assert.equal(plan.depotDuty, null, 'the forward depot is already ours');
  assert.ok(plan.vehicleDuty, 'a ready loaner draws a driver');
  const slot = plan.slots.find(entry => entry.kind === 'vehicle');
  assert.ok(slot, 'one attack slot becomes the vehicle duty');
  assert.equal(slot.vehicleId, plan.vehicleDuty.vehicleId);
  assert.equal(slot.nodeId, slot.depotFallback);
  assert.deepEqual(cocsTeamPlan(match, state, 0).vehicleDuty, plan.vehicleDuty, 'identical state yields the same duty');
  const actor = match.actors[0];
  actor.team = 0;
  const assignment = {kind: 'vehicle', vehicleId: plan.vehicleDuty.vehicleId, depotFallback: 'relay-0', nodeId: 'relay-0'};
  const vehicle = match.vehicles.find(entry => entry.id === plan.vehicleDuty.vehicleId);
  const walk = cocsBotDestination(match, actor, assignment, state);
  assert.ok(Math.abs(walk.x - vehicle.position.x) < 1e-6 && Math.abs(walk.z - vehicle.position.z) < 1e-6, 'walks to the loaner');
  actor.vehicleId = vehicle.id;
  const drive = cocsBotDestination(match, actor, assignment, state);
  const node = state.nodes.find(entry => entry.id === 'relay-0');
  assert.ok(Math.hypot(drive.x - node.x, drive.z - node.z) <= (node.r ?? 4), 'the mounted driver heads for the front');
  // No loaner, no duty.
  vehicle.health = 0;
  assert.equal(cocsVehicleDuty(match, state, 0, {roster: plan.roster, duties: plan.duties}), null);
});

// ---------------------------------------------------------------------------
// Mode isolation
// ---------------------------------------------------------------------------
test('W20 traversal policy and readout never leak outside cocs', () => {
  const match = new Match('chatgpt', 'openclaw', () => 0.5, 'warfront', {mode: 'domination', botCount: 3, aiSeats: true, timeLimit: 20});
  for (let i = 0; i < 120 && !match.over; i++) match.step(DT, {inputs: {}});
  assert.equal(match.objectiveState.traversal, undefined);
  const actor = match.actors[0];
  assert.equal(cocsTraversalChoice(match, actor, {x: 0, z: 0}, match.objectiveState), null);
  assert.equal(cocsDepotDuty(match.objectiveState, match.actors, 0, null), null);
  assert.equal(cocsTraversalView({tick: 5}, {team: 0}), null);
});

// ---------------------------------------------------------------------------
// Opt-in determinism: a seeded run with bot-use on is byte-identical.
// ---------------------------------------------------------------------------
test('a seeded bot-use-on cocs run is deterministic and draws no extra RNG', () => {
  const run = seed => {
    const draws = {count: 0};
    const base = seeded(seed);
    const random = () => { draws.count++; return base(); };
    const match = new Match('chatgpt', 'openclaw', random, 'lattice-slice', {
      mode: 'cocs', humanCount: 1, botCount: 7, aiSeats: true, difficulty: 'normal', timeLimit: 60,
      objective: {traversalBotUse: true},
    });
    match.pickups = [];
    for (let i = 0; i < 1800 && !match.over; i++) match.step(DT, {inputs: {}});
    return {snapshot: JSON.stringify(cocsSnapshot(match)), draws: draws.count, traversal: JSON.stringify(cocsSnapshot(match).traversal)};
  };
  const first = run(0xBEEF);
  const second = run(0xBEEF);
  assert.equal(first.snapshot, second.snapshot, 'same deterministic match');
  assert.equal(first.traversal, second.traversal, 'same deterministic traversal state');
  assert.equal(first.draws, second.draws, 'no extra RNG draws');
});
