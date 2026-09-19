// LATTICE STRIKE PvP-1 over the wire (section 12.3b / §11.2). Two human peers
// seated on opposite teams drive one PvP `cocs` room through the same validated
// wire handlers the live server uses, with bot seats filling the roster. Every
// order / spend / terminal / command / buy enters `Match.step(dt,{cocs})`; a
// seeded run is byte-identical across repeats and a reconnect resends the whole
// command board. The rung gate (section 3.1) is asserted alongside the wire.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,playerLimit} from './room.mjs';
import {RULES} from '../game/data.mjs';
import {cocsRungPlan,cocsRung} from '../game/config.mjs';
import {wireSize,SNAPSHOT_DELTA_VERSION} from '../game/protocol.mjs';

function seeded(seed = 11) {
 let n = seed;
 return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const find = (msgs, type, to) => msgs.find(m => m.msg.type === type && (to === undefined || m.to === to))?.msg;

// Two connected peers on a PvP `cocs` room with bots filling the rest. A
// laddered room (`rung`) enforces the §3.1 human floor; a practice room does not.
function harness({seed = 11, rung = null, botCount = 6, players = 2, mapId = 'lattice-slice'} = {}) {
 const room = new Room('r', seeded(seed), {snapshotHz: 30, keyframeEvery: 5});
 for (let i = 1; i <= players; i++) room.join(i, `P${i}`, 'chatgpt', i % 2 === 0 ? 'claude' : 'openclaw');
 room.host(1, {mode: 'cocs', botCount, timeLimit: 300, ...(rung ? {rung} : {})}, mapId);
 room.start(1);
 room.drain();
 return room;
}
// Give each team one owned capturable node so its HOLD order is legal and the
// two targets are distinct (the map author's ids differ from the stand-in
// lattice, so pick by archetype instead of hard-coding).
function seatFronts(state) {
 const caps = state.nodes.filter(entry => ['front', 'economy', 'relay'].includes(entry.archetype));
 const a = caps.find(entry => entry.archetype === 'front') ?? caps[0];
 const b = caps.find(entry => entry !== a && entry.archetype === 'front') ?? caps.find(entry => entry !== a);
 a.owner = 0; a.progress = {0: 0, 1: 0};
 b.owner = 1; b.progress = {0: 0, 1: 0};
 return {team0: a.id, team1: b.id};
}

test('two humans are seated on opposite teams with bots balancing the roster', () => {
 const room = harness({botCount: 6});
 const actors = room.match.actors;
 assert.equal(room.match.humanCount, 2);
 assert.equal(actors[0].team, 0, 'peer 1 owns team 0');
 assert.equal(actors[1].team, 1, 'peer 2 owns team 1');
 const counts = {0: 0, 1: 0};
 for (const actor of actors) counts[actor.team]++;
 assert.deepEqual(counts, {0: 4, 1: 4}, 'a 2-human + 6-bot roster is balanced per team');
 assert.equal(room.peers.get(1).actorId, 0);
 assert.equal(room.peers.get(2).actorId, 1);
});

test('orders from each team apply to their own team only', () => {
 const room = harness({botCount: 4});
 const state = room.match.objectiveState;
 const fronts = seatFronts(state);
 room.drain();
 // Team 0 (peer 1) holds its own front; team 1 (peer 2) holds its own.
 assert.equal(room.order(1, {cardId: 'o0', verb: 'HOLD', target: fronts.team0}), true);
 assert.equal(room.order(2, {cardId: 'o1', verb: 'HOLD', target: fronts.team1}), true);
 for (let i = 0; i < 4; i++) room.tick(RULES.dt);
 // Tasks are keyed by the acting actor id (peer 1 = actor 0, peer 2 = actor 1).
 assert.equal(state.tasks[0].peerId, '0');
 assert.equal(state.tasks[1].peerId, '1');
 assert.equal(state.tasks[0].nodeId, fronts.team0);
 assert.equal(state.tasks[1].nodeId, fronts.team1);
 assert.notEqual(state.tasks[0].nodeId, state.tasks[1].nodeId, 'a team order never becomes the other team task');
 assert.ok(state.orderLog.some(entry => entry.cardId === 'o0' && entry.team === 0 && entry.ok === true));
 assert.ok(state.orderLog.some(entry => entry.cardId === 'o1' && entry.team === 1 && entry.ok === true));
});

test('off-team, affordability and no-THREAD actions are rejected with cocs-reject + card blocker', () => {
 const room = harness({seed: 3, botCount: 4});
 const state = room.match.objectiveState;
 const fronts = seatFronts(state);
 room.drain();

 // Off-team: team 0 may not attack a node team 1 owns.
 assert.equal(room.order(1, {cardId: 'x-team', verb: 'ATTACK', target: fronts.team1}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'wrong-team');

 // Affordability: a SCAN with no FLUX is refused (no quantized client spend).
 state.flux[0] = 0;
 assert.equal(room.order(1, {cardId: 'x-flux', verb: 'SCAN', target: fronts.team0}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'flux');

 // No free THREAD: fill team 0's cap, then ask the role board to spawn.
 state.flux[0] = 240;
 const cap = state.threads[0].cap;
 const spare = room.match.actors.filter(a => a.team === 0 && !a.isSubagent && !a.isScout).slice(0, cap);
 for (const actor of spare) { actor.isSubagent = true; actor.subagentTeam = 0; actor.subagentRole = 'fighter'; actor.health = 100; }
 assert.equal(room.economy(1, {cardId: 'x-thread', action: 'reinforce', role: 'fighter'}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'no-thread');
 for (const actor of spare) { actor.isSubagent = false; actor.subagentTeam = undefined; actor.subagentRole = undefined; actor.health = 100; }

 // A non-commander cannot release a team seat.
 assert.equal(room.command(2, {cardId: 'x-seat', action: 'release'}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 2).reason, 'not-commander');

 // The card board carries the reason so a reconnect rebuilds the blocker.
 const blocker = room.wireState().cocs.cards.find(card => card.id === 'x-team');
 assert.equal(blocker.reason, 'wrong-team');
});

test('the PvP economy buys a rung-legal role and the command seat is team-scoped', () => {
 const room = harness({seed: 5, botCount: 4});
 const state = room.match.objectiveState;
 state.flux[0] = 240;
 state.flux[1] = 240;
 room.drain();
 assert.equal(room.command(1, {cardId: 'm0', action: 'take'}), true);
 assert.equal(room.command(2, {cardId: 'm1', action: 'take'}), true);
 assert.equal(room.economy(1, {cardId: 'e0', action: 'reinforce', role: 'fighter'}), true);
 const before = state.flux[0];
 for (let i = 0; i < 4; i++) room.tick(RULES.dt);
 assert.equal(state.command.seat[0], '0');
 assert.equal(state.command.seat[1], '1');
 assert.equal(state.roleSpawns[0].length, 1, 'team 0 fielded one role');
 assert.equal(state.roleSpawns[1].length, 0, 'the team-0 spend never touched team 1');
 assert.ok(state.flux[0] < before, 'the role cost came out of team 0 FLUX');
 const snapshot = room.wireState().cocs;
 assert.equal(snapshot.commander.seat[0], '0');
 assert.equal(snapshot.commander.seat[1], '1');
 assert.equal(snapshot.roleBoard[0].agents.length, 1);
 assert.equal(snapshot.roleBoard[1].agents.length, 0);
 // The accepted role spend settles its card from the sim spend log.
 const spend = state.spendLog.find(entry => entry.cardId === 'e0');
 assert.equal(spend?.ok, true, 'the sim recorded the accepted spend');
 assert.equal(spend?.peerId, '0', 'the sim log keys the acting actor id');
 assert.equal(room.cocsCardList().find(card => card.id === 'e0')?.state, 'done', 'the spend card reached a terminal state');
});

test('the PvP traversal terminal surface validates a device action', () => {
 const room = harness({seed: 7, botCount: 4});
 const state = room.match.objectiveState;
 const deviceId = Object.keys(state.traversal?.devices ?? {})[0];
 assert.ok(deviceId, 'the lattice-slice map authors traversal devices');
 const device = state.traversal.devices[deviceId];
 const actor = room.match.actors[0];
 actor.x = device.from.x; actor.z = device.from.z; actor.y = device.from.y ?? 0;
 room.drain();
 // `lock` requires a live device and the actor to be inside the §6A reach.
 const action = device.state === 'live' ? 'lock' : 'repair';
 assert.equal(room.terminal(1, {cardId: 't0', terminalId: deviceId, action}), true);
 // Out of range is rejected before it ever reaches the sim.
 actor.x = device.from.x + 500;
 assert.equal(room.terminal(2, {cardId: 't1', terminalId: deviceId, action}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 2).reason, 'range');
});

test('a seeded PvP run is byte-identical across repeats', () => {
 const run = () => {
  const room = harness({seed: 9, botCount: 4});
  const state = room.match.objectiveState;
  const fronts = seatFronts(state);
  state.flux[0] = 240; state.flux[1] = 240;
  room.drain();
  room.order(1, {cardId: 'd0', verb: 'HOLD', target: fronts.team0});
  room.order(2, {cardId: 'd1', verb: 'HOLD', target: fronts.team1});
  room.command(1, {cardId: 'd2', action: 'take'});
  room.economy(1, {cardId: 'd3', action: 'reinforce', role: 'fighter'});
  for (let i = 0; i < 180; i++) room.tick(RULES.dt);
  return JSON.stringify(room.wireState());
 };
 assert.equal(run(), run(), 'same seed + same action order produce identical bytes');
});

test('a reconnect resends the full PvP command board with cocs state', () => {
 const room = new Room('r', seeded(13), {graceMs: 60000});
 room.join(1, 'Alice', 'chatgpt', 'openclaw');
 room.join(2, 'Bob', 'claude', 'hermes');
 room.host(1, {mode: 'cocs', botCount: 2, timeLimit: 300}, 'lattice-slice');
 room.start(1);
 room.drain();
 const token = room.peers.get(1).token;
 assert.equal(room.command(1, {cardId: 'm1', action: 'take'}), true);
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 assert.equal(room.match.objectiveState.command.seat[0], '0', 'the seat holds actor 0 (peer 1)');
 room.disconnect(1);
 room.drain();
 room.join(9, 'ignored', 'chatgpt', 'openclaw', token);
 const snapshot = find(room.drain(), 'snapshot', 9);
 assert.ok(snapshot, 'the reconnected peer gets a full snapshot immediately');
 assert.equal(snapshot.state.cocs.commander.seat[0], '0', 'the PvP command seat round-trips');
 assert.ok(Array.isArray(snapshot.state.cocs.cards), 'the card board round-trips too');
});

// ---------------------------------------------------------------------------
// Rung gate (section 3.1).
// ---------------------------------------------------------------------------
test('a laddered room refuses to start below its human floor and names the fallback', () => {
 const room = new Room('r', seeded(2), {snapshotHz: 30});
 for (let i = 1; i <= 2; i++) room.join(i, `P${i}`);
 room.host(1, {mode: 'cocs', rung: '8v8', botCount: 0, timeLimit: 300}, 'lattice-slice');
 const lobby = room.lobby().cocs;
 assert.equal(lobby.rung, '8v8');
 assert.equal(lobby.meetsMinimum, false);
 assert.equal(lobby.belowMinimum, true);
 assert.equal(lobby.minHumans, 8);
 assert.equal(lobby.botFill, 14);
 assert.equal(lobby.fallback, '4v4');
 room.drain();
 assert.equal(room.start(1), false, 'the rung does not auto-start below its floor');
 const error = find(room.drain(), 'error', 1);
 assert.match(error.message, /below-minimum/);
 assert.match(error.message, /fall back to 4v4/);
 assert.equal(room.started, false);
});

test('the 4v4 rung starts on 8 humans and the 8v8 rung bot-fills 8 humans to 16', () => {
 const four = new Room('r4', seeded(4), {snapshotHz: 30});
 for (let i = 1; i <= 8; i++) four.join(i, `P${i}`);
 four.host(1, {mode: 'cocs', rung: '4v4', botCount: 0, timeLimit: 300}, 'lattice-slice');
 four.drain();
 assert.equal(four.start(1), true);
 assert.equal(four.match.config.rung, '4v4');
 assert.equal(four.match.actors.length, 8);
 assert.equal(four.match.config.botCount, 0);
 const fourCounts = {0: 0, 1: 0};
 for (const actor of four.match.actors) fourCounts[actor.team]++;
 assert.deepEqual(fourCounts, {0: 4, 1: 4});

 const eight = new Room('r8', seeded(4), {snapshotHz: 30});
 for (let i = 1; i <= 8; i++) eight.join(i, `P${i}`);
 eight.host(1, {mode: 'cocs', rung: '8v8', botCount: 0, timeLimit: 300}, 'lattice-slice');
 eight.drain();
 assert.equal(eight.start(1), true);
 assert.equal(eight.match.config.rung, '8v8');
 assert.equal(eight.match.humanCount, 8);
 assert.equal(eight.match.config.botCount, 8, 'the 8v8 rung bot-fills 8 humans to its 16 total');
 assert.equal(eight.match.actors.length, 16);
 const eightCounts = {0: 0, 1: 0};
 for (const actor of eight.match.actors) eightCounts[actor.team]++;
 assert.deepEqual(eightCounts, {0: 8, 1: 8}, 'the filled rung stays balanced per team');
 assert.equal(playerLimit('cocs'), 32, 'the PvP seam still admits up to 32 seats');
});

test('cocsRungPlan publishes the below-minimum and bot-fill state', () => {
 assert.equal(cocsRungPlan('4v4', 8).meetsMinimum, true);
 assert.equal(cocsRungPlan('4v4', 3).botFill, 5);
 assert.equal(cocsRungPlan('8v8', 8).botFill, 8);
 assert.equal(cocsRungPlan('8v8', 16).botFill, 0);
 const plan = cocsRungPlan('4v4', 8);
 assert.deepEqual(plan.roleAllow, ['fighter', 'harvester', 'builder']);
 assert.equal(cocsRung(plan.id).total, 8);
});

test('the PvP wire stays inside the rate-only budget at the 4v4 and 8v8 actor counts', () => {
 for (const [rung, humans] of [['4v4', 8], ['8v8', 8]]) {
  const room = new Room(`bw-${rung}`, seeded(6), {snapshotHz: 30, keyframeEvery: 30});
  // Modern clients advertise delta support; the rate-only budget is measured
  // against the delta stream (one keyframe a second, deltas in between).
  for (let i = 1; i <= humans; i++) room.join(i, `P${i}`, 'chatgpt', 'openclaw', '', false, '', '', SNAPSHOT_DELTA_VERSION);
  room.host(1, {mode: 'cocs', rung, botCount: 0, timeLimit: 300}, 'lattice-slice');
  room.start(1);
  room.drain();
  const expected = cocsRung(rung).total;
  assert.equal(room.match.actors.length, expected);
  let bytes = 0;
  let frames = 0;
  for (let i = 0; i < 600; i++) {
   room.tick(RULES.dt);
   for (const message of room.drain()) {
    if (message.to !== 1) continue; // per-client egress for one seated peer
    if (message.msg.type !== 'snapshot' && message.msg.type !== 'snapshot-delta') continue;
    bytes += wireSize(message.msg);
    frames++;
   }
  }
  const perSecond = bytes / (600 * RULES.dt);
  // §11.5 envelope: <=3 Mbps at 4v4 and <=3.5 Mbps at 8v8, at 30 Hz.
  const ceiling = rung === '4v4' ? 3_000_000 : 3_500_000;
  assert.ok(perSecond * 8 <= ceiling, `${rung} bandwidth ${(perSecond * 8 / 1e6).toFixed(2)}Mbps <= ${ceiling / 1e6}Mbps (frames ${frames})`);
 }
});
