// LATTICE STRIKE — the human `interact` edge (LATTICE-D1).
//
// Covers: a non-bot actor at a §6A device anchor uses a live device, a live
// cuttable/lockable device starts a cut/lock channel, a dead device starts a
// repair, the held edge never double-fires, the selection is deterministic and
// bots/modes are untouched; the O1c terminal HACK/DEPLOY/VAULT triggers; and the
// pure HUD prompts (verb, key, anchored/distance, channel progress) that make
// the map legible without colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,floorAt} from './core.mjs';
import {LATTICE_MAPS} from './lattice-maps.mjs';
import {cocsSnapshot} from './cocs.mjs';
import {cocsCommandView, cocsTerminalView, cocsTraversalView} from './cocs-orders.mjs';

const DT = 1 / 60;
const flatRng = () => 0.5;
const seeded = seed => { let n = seed >>> 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
const cocsMatch = (over = {}) => new Match('chatgpt', 'openclaw', flatRng, 'lattice-slice', {
  mode: 'cocs', botCount: 0, humanCount: 1, timeLimit: 120, cocsPolicy: () => [], ...over,
});
const coopMatch = (over = {}) => new Match('chatgpt', 'openclaw', flatRng, 'lattice-slice', {
  mode: 'cocs-coop', humanCount: 1, botCount: 0, timeLimit: 900, ...over,
});
const pin = (actor, x, z, y = floorAt(x,z,LATTICE_MAPS[0])) => {
  actor.x = x; actor.z = z; actor.y = y;
  actor.vx = actor.vy = actor.vz = 0; actor.grounded = true;
  actor.health = 200; actor.maxHealth = 200; actor.armor = 0; actor.protection = 0;
};
const interact = (match, id, held) => match.step(DT, {inputs: {[id]: {interact: held}}});
const holdEdge = (match, actor, x, z, ticks) => {
  for (let i = 0; i < ticks; i++) { pin(actor, x, z); interact(match, actor.id, true); }
};

// ---------------------------------------------------------------------------
// Device edge
// ---------------------------------------------------------------------------
test('a human actor at a device anchor rides it on the interact edge', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  assert.equal(actor.bot, null, 'actor 0 is a human seat');
  const device = state.traversal.devices['zip-s-w'];
  pin(actor, device.from.x, device.from.z);
  interact(match, actor.id, true);
  assert.equal(state.traversal.stats.uses, 1, 'the live zipline fired');
  // A zipline is ridden, not blinked: the ride is live and the actor has not
  // arrived yet. Arrival protection lands with the rider, not at boarding.
  assert.ok(actor.zipRide, 'the rider boards the cable');
  assert.ok(Math.hypot(actor.x-device.to.x,actor.z-device.to.z)>10, `still on the cable (${actor.x},${actor.z})`);
  for (let i = 0; i < 400 && actor.zipRide; i++) interact(match, actor.id, i === 0);
  assert.equal(actor.zipRide, null, 'released at the far anchor');
  assert.ok(Math.hypot(actor.x-device.to.x,actor.y-device.to.y,actor.z-device.to.z)<1e-6, `arrived at ${actor.x},${actor.z}`);
  assert.ok(actor.cocsArrival && actor.cocsArrival.remaining > 1.4, 'arrival protection applied');
  // A held interact tick at the destination must not re-fire (no device there)
  // and the shared cooldown keeps the far anchor from being re-used instantly.
  interact(match, actor.id, true);
  assert.equal(state.traversal.stats.uses, 1);
});

test('a human actor inside the band but off the anchor cuts a live device', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  const device = state.traversal.devices['zip-s-w'];
  const ax = device.from.x + 5; // inside the 6 m band, outside the 0.9 m use reach
  pin(actor, ax, device.from.z);
  interact(match, actor.id, true);
  assert.equal(device.channel?.action, 'cut', 'a cut channel starts');
  const before = state.traversal.stats.cuts;
  for (let i = 0; i < Math.round(3.2 / DT); i++) { pin(actor, ax, device.from.z); interact(match, actor.id, false); }
  assert.equal(device.state, 'cut');
  assert.equal(state.traversal.stats.cuts, before + 1);
});

test('a human actor repairs a dead device on the interact edge', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  const device = state.traversal.devices['zip-s-w'];
  device.state = 'cut';
  device.timer = 45;
  const ax = device.from.x + 5;
  pin(actor, ax, device.from.z);
  interact(match, actor.id, true);
  assert.equal(device.channel?.action, 'repair');
  for (let i = 0; i < Math.round(6.2 / DT); i++) { pin(actor, ax, device.from.z); interact(match, actor.id, false); }
  assert.equal(device.state, 'live');
  assert.equal(state.traversal.stats.repairs, 1);
});

test('a held interact edge never double-fires a channel', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  const device = state.traversal.devices['zip-s-w'];
  const ax = device.from.x + 5;
  // Hold interact for 6 s: one cut channel starts and resolves; the still-held
  // edge must not chain a repair behind it.
  holdEdge(match, actor, ax, device.from.z, Math.round(6 / DT));
  assert.equal(device.state, 'cut', 'only the cut resolved');
  assert.equal(state.traversal.stats.cuts, 1);
  assert.equal(state.traversal.stats.repairs, 0);
  assert.equal(device.channel, null);
});

test('the human interact path is deterministic across seeded runs', () => {
  const run = seed => {
    const match = new Match('chatgpt', 'openclaw', seeded(seed), 'lattice-slice', {
      mode: 'cocs', botCount: 3, humanCount: 1, aiSeats: true, difficulty: 'normal', timeLimit: 120, cocsPolicy: () => [],
    });
    const state = match.objectiveState;
    const actor = match.actors[0];
    actor.team = 0;
    const device = state.traversal.devices['zip-s-w'];
    const target = seed % 2 === 0 ? device.from : {x: device.from.x + 5, z: device.from.z};
    for (let i = 0; i < 400 && !match.over; i++) {
      if (i % 90 === 0) pin(actor, target.x, target.z);
      interact(match, actor.id, i % 90 === 0);
    }
    return {traversal: JSON.stringify(cocsSnapshot(match).traversal), time: match.time};
  };
  assert.equal(run(11).traversal, run(11).traversal, 'same seed, same traversal');
  assert.equal(run(11).time, run(11).time);
});

test('bots and non-cocs modes are untouched by the human interact edge', () => {
  const match = cocsMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  actor.bot = {}; // pretend a bot seat on the human id
  const device = state.traversal.devices['zip-s-w'];
  pin(actor, device.from.x, device.from.z);
  interact(match, actor.id, true);
  assert.equal(state.traversal.stats.uses, 0, 'a bot never rides through the human path');
  assert.equal(state.traversal.stats.cuts, 0);
  const dom = new Match('chatgpt', 'openclaw', flatRng, 'lattice-slice', {mode: 'domination', botCount: 2, humanCount: 1, difficulty: 'normal'});
  for (let i = 0; i < 30; i++) interact(dom, 0, true);
  assert.equal(dom.objectiveState.traversal, undefined, 'non-cocs still authors no traversal state');
  assert.equal(dom.objectiveState._interactHeld, undefined, 'edge bookkeeping stays inside cocs');
});

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------
test('a human actor at a terminal triggers HACK / DEPLOY / VAULT on the interact edge', () => {
  const match = coopMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.team = 0;
  const terminals = state.terminals.terminals;
  const hack = terminals['hack-relay-0'];
  const deploy = terminals['deploy-relay-0'];
  const vault = terminals['vault-hq-0'];
  const node = state.nodes.find(entry => entry.id === hack.nodeId);
  // Neutral node: DEPLOY is not actionable, HACK wins.
  node.owner = null;
  pin(actor, hack.x, hack.z);
  interact(match, actor.id, true);
  assert.equal(hack.channel?.action, 'HACK');
  // Owned node: DEPLOY outranks HACK.
  hack.channel = null;
  node.owner = 0;
  pin(actor, deploy.x, deploy.z);
  interact(match, actor.id, false);
  interact(match, actor.id, true);
  assert.equal(deploy.channel?.action, 'DEPLOY');
  // VAULT stores a shard.
  pin(actor, vault.x, vault.z);
  interact(match, actor.id, false);
  interact(match, actor.id, true);
  assert.equal(state.terminals.stats.vaultStores, 1);
  assert.ok(state.terminals.stats.interacts >= 2, 'HACK + DEPLOY counted as interacts');
});

// ---------------------------------------------------------------------------
// HUD prompts
// ---------------------------------------------------------------------------
const traversalSnapshot = () => ({
  tick: 10,
  traversal: {
    tick: 10,
    devices: [
      {id: 'zip-a', kind: 'zipline', lane: 'south', state: 'live', timer: 0, x: 0, z: 0, to: {x: 10, z: 0}, channel: null},
      {id: 'pad-b', kind: 'jump-pad', lane: 'south', state: 'live', timer: 0, x: 30, z: 0, to: {x: 30, z: -8}, channel: null},
      {id: 'tp-c', kind: 'teleporter', lane: 'centre', state: 'cut', timer: 20, x: 60, z: 0, to: {x: 70, z: 0}, channel: {actor: 2, action: 'repair', remaining: 1.5, total: 4}},
    ],
    depots: [
      {id: 'depot-fwd-w', lane: 'north', hq: false, x: 0, z: 8, owner: null, progress: [0.4, 0], contested: false, vehicle: {id: null, health: 0, respawn: 0}},
    ],
    arrivals: [],
    stats: {},
  },
});

test('cocsTraversalView prompts the verb, key, anchor and channel for the local player', () => {
  const snap = traversalSnapshot();
  const ride = cocsTraversalView(snap, {team: 0, x: 0, z: 0}, {interactKey: 'E'}).prompt;
  assert.equal(ride.source, 'device');
  assert.equal(ride.id, 'zip-a');
  assert.equal(ride.verb, 'RIDE');
  assert.equal(ride.key, 'E');
  assert.equal(ride.anchored, true);
  assert.equal(ride.distanceMeters, 0);
  assert.ok(ride.text.includes('RIDE') && ride.text.includes('ZIPLINE'));
  // 5 m off the same device: the band prompt is CUT, not RIDE.
  const cut = cocsTraversalView(snap, {team: 0, x: 5, z: 0}).prompt;
  assert.equal(cut.verb, 'CUT');
  assert.equal(cut.anchored, false);
  assert.equal(cut.distanceMeters, 5);
  // A pad in the band locks.
  const lock = cocsTraversalView(snap, {team: 0, x: 35, z: 0}).prompt;
  assert.equal(lock.id, 'pad-b');
  assert.equal(lock.verb, 'LOCK');
  // A dead device repairs and carries hold progress.
  const repair = cocsTraversalView(snap, {team: 0, x: 55, z: 0}).prompt;
  assert.equal(repair.id, 'tp-c');
  assert.equal(repair.verb, 'REPAIR');
  assert.equal(repair.channelPercent, 63);
  // No position (spectator) or no nearby device stays dark.
  assert.equal(cocsTraversalView(snap, {team: 0}).prompt, null);
  assert.equal(cocsTraversalView(snap, {team: 0, x: 500, z: 500}).prompt, null);
});

test('cocsTraversalView surfaces a depot capture/enter hint', () => {
  const snap = traversalSnapshot();
  const hint = cocsTraversalView(snap, {team: 0, x: 0, z: 0}).depotPrompt;
  assert.equal(hint.id, 'depot-fwd-w');
  assert.equal(hint.capturePercent, 40);
  assert.ok(hint.hint.includes('TO CAPTURE') && hint.hint.includes('40%'), hint.hint);
  // Owned depot with a loaner reads the enter hint.
  snap.traversal.depots[0].owner = 0;
  snap.traversal.depots[0].vehicle = {id: 'v', health: 300, respawn: 0};
  const enter = cocsTraversalView(snap, {team: 0, x: 0, z: 0}).depotPrompt;
  assert.ok(enter.hint.includes('ENTER LOANER'), enter.hint);
});

test('cocsTerminalView prompts the actionable terminal verb with the bound key', () => {
  const snapshot = {
    tick: 1,
    terminals: [
      {id: 'deploy-relay-0', kind: 'DEPLOY', x: 0, z: 0, state: 'available', owner: 0, progress: 0},
      {id: 'hack-relay-0', kind: 'HACK', x: 0, z: 0, state: 'available', owner: null, progress: 0},
      {id: 'vault-hq-0', kind: 'VAULT', x: 50, z: 0, state: 'available', owner: 0, progress: 0},
    ],
  };
  const board = {nodes: [], live: []};
  const mine = cocsTerminalView(snapshot, {team: 0, x: 0, z: 0}, board, {interactKey: 'KeyE'}).prompt;
  assert.equal(mine.verb, 'DEPLOY');
  assert.equal(mine.key, 'KeyE');
  const enemy = cocsTerminalView(snapshot, {team: 1, x: 0, z: 0}, board).prompt;
  assert.equal(enemy.verb, 'HACK', 'an unowned relay cannot DEPLOY');
  const vault = cocsTerminalView(snapshot, {team: 0, x: 50, z: 0}, board).prompt;
  assert.equal(vault.verb, 'VAULT');
  assert.equal(cocsTerminalView(snapshot, {team: 0}, board).prompt, null);
});

test('cocsCommandView folds the device prompt and depot hint together', () => {
  const board = {nodes: [], live: []};
  const snap = traversalSnapshot();
  const command = cocsCommandView(board, snap, {team: 0, x: 0, z: 0}, null, {interactKey: 'E'});
  assert.equal(command.interactPrompt.verb, 'RIDE');
  assert.equal(command.depotPrompt.id, 'depot-fwd-w');
  // Mode isolation: no traversal subtree -> no prompt.
  const empty = cocsCommandView(board, {tick: 1}, {team: 0, x: 0, z: 0}, null);
  assert.equal(empty.interactPrompt, null);
  assert.equal(empty.depotPrompt, null);
});
