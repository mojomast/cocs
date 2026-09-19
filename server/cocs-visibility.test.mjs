// LATTICE STRIKE V2 per-team snapshot filtering at the server seam
// (§11.4/§12.7): a real two-peer room proves that a team-1 client can never
// read team-0 private fields (intel, contacts, spots, order board, role board,
// command seat, wallets) while shared lattice truth still arrives. Also covers
// the spectator view, the co-op command board, the event feed, delta-chain
// isolation, determinism, bandwidth before/after, and offline/local isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room} from './room.mjs';
import {RULES} from '../game/data.mjs';
import {SNAPSHOT_DELTA_VERSION,SNAPSHOT_DELTA_MIN_BYTES,snapshotDelta,applySnapshotDelta,wireSize,MESSAGE} from '../game/protocol.mjs';
import {filterCocsSnapshot} from '../game/cocs-intel.mjs';

function seeded(seed = 11) {
 let n = seed;
 return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const lastTo = (msgs, type, to) => [...msgs].reverse().find(m => m.msg.type === type && m.to === to)?.msg;
const keysOf = value => Object.keys(value ?? {}).sort();

// Two human peers on opposite teams, bots balancing the roster. `keyframeEvery`
// 1 makes every frame a full snapshot, which the inspection tests read directly.
function harness({seed = 11, botCount = 4, keyframeEvery = 1, delta = false, spectator = false} = {}) {
 const room = new Room('r', seeded(seed), {snapshotHz: 30, keyframeEvery});
 const deltaVersion = delta ? SNAPSHOT_DELTA_VERSION : 0;
 room.join(1, 'P1', 'chatgpt', 'openclaw', '', false, '', '', deltaVersion);
 room.join(2, 'P2', 'claude', 'hermes', '', false, '', '', deltaVersion);
 if (spectator) room.join(3, 'Spec', 'gemini', 'cline', '', true, '', '', deltaVersion);
 room.host(1, {mode: 'cocs', botCount, timeLimit: 300}, 'lattice-slice');
 room.start(1);
 room.drain();
 return room;
}

// Inject the same class of private truth a live match produces: team intel,
// spots, field-support recon, REQ wallets, command seats, role cards and orders.
function seedPrivate(room) {
 const state = room.match.objectiveState;
 const caps = state.nodes.filter(entry => ['front', 'economy', 'relay'].includes(entry.archetype));
 const team0Node = caps.find(entry => entry.archetype === 'front') ?? caps[0];
 const team1Node = caps.find(entry => entry !== team0Node && entry.archetype === 'front') ?? caps.find(entry => entry !== team0Node);
 team0Node.owner = 0; team0Node.progress = {0: 0, 1: 0};
 team1Node.owner = 1; team1Node.progress = {0: 0, 1: 0};
 state.flux[0] = 111; state.flux[1] = 222;
 state.spots[0] = {id: 0, team: 0, until: 1e9, x: 1, z: 1, by: 0, intelOnly: true};
 state.spots[1] = {id: 1, team: 1, until: 1e9, x: 2, z: 2, by: 1, intelOnly: true};
 state.fieldSupport = {actors: {}, recipients: {}, nodes: {}, intel: {0: {}, 1: {}}};
 state.fieldSupport.intel[0][1] = {until: 1e9, x: 5, z: 5, by: 0};
 state.fieldSupport.intel[1][0] = {until: 1e9, x: 6, z: 6, by: 1};
 room.match.actors[0].req = 50; room.match.actors[0].reqBuff = 'haste'; room.match.actors[0].ordersCompleted = 2;
 room.match.actors[1].req = 60; room.match.actors[1].reqSpent = 4;
 room.command(1, {cardId: 'seat-0', action: 'take'});
 room.command(2, {cardId: 'seat-1', action: 'take'});
 assert.equal(room.order(1, {cardId: 'order-0', verb: 'HOLD', target: team0Node.id}), true);
 assert.equal(room.order(2, {cardId: 'order-1', verb: 'HOLD', target: team1Node.id}), true);
 return {team0Node, team1Node};
}

function tickFrames(room, ticks = 4) {
 for (let i = 0; i < ticks; i++) room.tick(RULES.dt);
 return room.drain();
}

test('a team-1 peer cannot read team-0 private sections while shared fields still arrive', () => {
 const room = harness();
 const {team0Node, team1Node} = seedPrivate(room);
 const msgs = tickFrames(room);
 const snap0 = lastTo(msgs, 'snapshot', 1).state; // peer 1 owns team 0
 const snap1 = lastTo(msgs, 'snapshot', 2).state; // peer 2 owns team 1
 assert.ok(snap0?.cocs && snap1?.cocs);

 // Team 0 truth reaches peer 1 and never peer 2.
 for (const path of ['intel', 'contacts', 'roleBoard', 'flux', 'fluxIncome', 'fluxUpkeep', 'fluxSpent', 'neglect', 'scoutStats', 'scans']) {
  assert.deepEqual(keysOf(snap0.cocs[path]), ['0'], `team-0 snapshot keeps ${path}[0]`);
  assert.deepEqual(keysOf(snap1.cocs[path]), ['1'], `team-1 snapshot keeps ${path}[1]`);
 }
 assert.deepEqual(keysOf(snap0.cocs.commander.seat), ['0']);
 assert.equal(snap0.cocs.commander.seat[0], '0');
 assert.deepEqual(keysOf(snap1.cocs.commander.seat), ['1']);
 assert.equal(snap1.cocs.commander.seat[1], '1');
 assert.equal(snap0.cocs.commander.seat[1], undefined, 'the enemy command seat never reaches team 0');
 assert.equal(snap1.cocs.commander.seat[0], undefined, 'the enemy command seat never reaches team 1');
 assert.deepEqual(keysOf(snap0.cocs.fieldSupport.intel), ['0']);
 assert.deepEqual(keysOf(snap1.cocs.fieldSupport.intel), ['1']);

 // Spots, wallets and the order board are filtered by team.
 assert.deepEqual(snap0.cocs.spots.map(entry => entry.team), [0]);
 assert.deepEqual(snap1.cocs.spots.map(entry => entry.team), [1]);
 const teams = new Map(room.match.actors.map(actor => [actor.id, actor.team]));
 assert.ok(snap0.cocs.req.every(entry => teams.get(entry.id) === 0), 'only team-0 wallets');
 assert.ok(snap1.cocs.req.every(entry => teams.get(entry.id) === 1), 'only team-1 wallets');
 assert.deepEqual(snap0.cocs.cards.map(card => card.id).sort(), ['order-0', 'seat-0'], 'team 0 sees its own board only');
 assert.deepEqual(snap1.cocs.cards.map(card => card.id).sort(), ['order-1', 'seat-1'], 'team 1 sees its own board only');

 // Personal REQ ships on the actor (§11.3): the enemy actor's wallet is stripped.
 const wireOwn0 = snap0.actors.find(actor => actor.id === 0);
 const wireEnemy1 = snap0.actors.find(actor => actor.id === 1);
 assert.equal(wireOwn0.req, 50, 'own wallet stays on the actor');
 assert.equal(wireOwn0.reqBuff, 'haste');
 assert.equal('req' in wireEnemy1, false, 'the enemy wallet is gone');
 assert.equal('reqBuff' in wireEnemy1, false, 'the enemy purchase buff is gone');
 const wireOwn1 = snap1.actors.find(actor => actor.id === 1);
 const wireEnemy0 = snap1.actors.find(actor => actor.id === 0);
 assert.equal(wireOwn1.req, 60);
 assert.equal(wireOwn1.reqSpent, 4);
 assert.equal('req' in wireEnemy0, false, 'team 1 never sees team 0 REQ');
 assert.equal('ordersCompleted' in wireEnemy0, false);

 // Shared lattice truth is identical for both peers and matches the raw seam.
 const raw = room.wireState().cocs;
 for (const key of ['tick', 'scores', 'liveNodeIds', 'winner', 'fluxCap', 'orderStats', 'rung', 'traversal']) {
  assert.deepEqual(snap0.cocs[key], snap1.cocs[key], `${key} is shared`);
  assert.deepEqual(snap0.cocs[key], raw[key], `${key} matches the authoritative projection`);
 }
 assert.deepEqual(snap0.cocs.nodes, raw.nodes);
 assert.deepEqual(snap1.cocs.nodes, raw.nodes);
 assert.deepEqual(keysOf(raw.intel), ['0', '1'], 'the authoritative seam stays complete for diagnostics');
 assert.equal(team0Node.id !== team1Node.id, true);
});

test('a spectator receives shared truth only and can never be an oracle', () => {
 const room = harness({spectator: true});
 seedPrivate(room);
 const msgs = tickFrames(room);
 const spec = lastTo(msgs, 'snapshot', 3).state;
 assert.ok(spec?.cocs);
 for (const path of ['intel', 'contacts', 'roleBoard', 'flux', 'fluxIncome', 'fluxUpkeep', 'fluxSpent', 'neglect', 'scoutStats', 'scans']) {
  assert.deepEqual(spec.cocs[path], {}, `spectator ${path} is empty`);
 }
 assert.deepEqual(spec.cocs.commander.seat, {});
 assert.deepEqual(spec.cocs.spots, []);
 assert.deepEqual(spec.cocs.cards, []);
 assert.deepEqual(spec.cocs.req, []);
 assert.deepEqual(spec.cocs.fieldSupport.intel, {});
 assert.ok(spec.actors.every(actor => !('req' in actor) && !('reqBuff' in actor) && !('ordersCompleted' in actor)), 'spectators see no personal wallets');
 assert.ok(Array.isArray(spec.cocs.nodes) && spec.cocs.nodes.length > 0, 'shared lattice still arrives');
 assert.equal(spec.cocs.fluxCap, room.wireState().cocs.fluxCap);
});

test('the OPERATIONS command board is team 0 only and redacted for spectators', () => {
 const room = new Room('coop', seeded(5), {snapshotHz: 30, keyframeEvery: 1});
 room.join(1, 'P1', 'chatgpt', 'openclaw');
 room.join(2, 'Spec', 'gemini', 'cline', '', true);
 room.host(1, {mode: 'cocs-coop', botCount: 2, timeLimit: 900}, 'warfront');
 room.start(1);
 room.drain();
 assert.equal(room.command(1, {cardId: 'm1', action: 'take'}), true);
 const msgs = tickFrames(room);
 const player = lastTo(msgs, 'snapshot', 1).state;
 const spec = lastTo(msgs, 'snapshot', 2).state;
 assert.deepEqual(keysOf(player.cocs.command.seat), ['0'], 'per-team map inside the co-op board is filtered');
 assert.equal(player.cocs.command.seat[0], '0');
 assert.ok(player.cocs.command.slices.length >= 1, 'team 0 keeps its own slices');
 assert.deepEqual(keysOf(player.cocs.flux), ['0'], 'the Director team FLUX is not shipped');
 assert.equal(spec.cocs.command, null, 'spectator command board is redacted');
 assert.deepEqual(spec.cocs.flux, {});
 assert.ok(spec.cocs.director, 'the public Director surface still arrives');
});

test('team-private COCS events never cross teams; world events reach both', () => {
 const room = harness();
 const {team0Node} = seedPrivate(room);
 room.drain();
 room.match.emit('cocs-order', {team: 0, verb: 'ATTACK', node: team0Node.id, peerId: '1', cardId: 'ev-0'});
 room.match.emit('cocs-buy', {team: 1, actor: 1, itemId: 'haste', cost: 10, req: 50});
 room.match.emit('cocs-capture', {team: 0, node: team0Node.id, archetype: 'front', score: 1});
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 const msgs = room.drain();
 const itemsTo = to => msgs.filter(m => m.to === to && m.msg.type === 'events').flatMap(m => m.msg.items);
 const peer0 = itemsTo(1);
 const peer1 = itemsTo(2);
 assert.ok(peer0.some(event => event.type === 'cocs-order' && event.team === 0), 'own order event arrives');
 assert.ok(!peer1.some(event => event.type === 'cocs-order' && event.team === 0), 'the enemy order feed is filtered');
 assert.ok(!peer0.some(event => event.type === 'cocs-buy' && event.team === 1), 'the enemy wallet event is filtered');
 assert.ok(peer1.some(event => event.type === 'cocs-buy' && event.team === 1), 'own wallet event arrives');
 assert.ok(peer0.some(event => event.type === 'cocs-capture'), 'world capture event reaches the capturing team');
 assert.ok(peer1.some(event => event.type === 'cocs-capture'), 'world capture event reaches the other team (lost cue)');
 // The raw sim feed is untouched.
 assert.ok(room.match.events.some(event => event.type === 'cocs-order'));
});

test('delta chains stay isolated per team, apply cleanly, and rebuild redacted states', () => {
 const room = harness({delta: true, keyframeEvery: 30, botCount: 4});
 seedPrivate(room);
 const bases = new Map([[1, null], [2, null]]);
 let deltas = 0, fulls = 0;
 for (let i = 0; i < 300; i++) {
  room.tick(RULES.dt);
  for (const {to, msg} of room.drain()) {
   if (msg.type !== 'snapshot' && msg.type !== 'snapshot-delta') continue;
   if (msg.type === 'snapshot') { bases.set(to, {seq: msg.seq, state: msg.state}); fulls++; continue; }
   const base = bases.get(to)?.state;
   assert.ok(base, `peer ${to} has a delta base`);
   bases.set(to, {seq: msg.seq, state: applySnapshotDelta(base, msg.patch)});
   deltas++;
  }
 }
 assert.ok(deltas > 0, 'the delta stream is exercised');
 assert.ok(fulls > 0, 'keyframes still resync');
 const team0 = bases.get(1).state.cocs;
 const team1 = bases.get(2).state.cocs;
 assert.deepEqual(keysOf(team0.intel), ['0']);
 assert.deepEqual(keysOf(team1.intel), ['1']);
 assert.deepEqual(keysOf(team0.commander.seat), ['0']);
 assert.deepEqual(keysOf(team1.commander.seat), ['1']);
 assert.ok(team0.req.every(entry => room.match.actors[entry.id].team === 0));
 assert.ok(team1.req.every(entry => room.match.actors[entry.id].team === 1));
 assert.equal('req' in bases.get(1).state.actors.find(actor => actor.id === 1), false, 'rebuilt team-0 state has no enemy wallet');
 assert.equal('req' in bases.get(2).state.actors.find(actor => actor.id === 0), false, 'rebuilt team-1 state has no enemy wallet');
 assert.deepEqual(team0.nodes, team1.nodes, 'shared nodes rebuild identically');
});

test('the same seed and actions produce byte-identical per-team frame streams', () => {
 const run = () => {
  const room = harness({seed: 9, keyframeEvery: 5});
  seedPrivate(room);
  const frames = {1: [], 2: []};
  for (let i = 0; i < 180; i++) {
   room.tick(RULES.dt);
   for (const {to, msg} of room.drain()) if (frames[to] && (msg.type === 'snapshot' || msg.type === 'snapshot-delta')) frames[to].push(JSON.stringify(msg));
  }
  return frames;
 };
 const first = run();
 const second = run();
 assert.equal(JSON.stringify(first[1]), JSON.stringify(second[1]), 'team-0 stream is deterministic');
 assert.equal(JSON.stringify(first[2]), JSON.stringify(second[2]), 'team-1 stream is deterministic');
 assert.notEqual(JSON.stringify(first[1]), JSON.stringify(first[2]), 'the two team streams are genuinely different');
});

test('per-peer bandwidth drops after filtering (before vs after)', () => {
 const room = harness({seed: 21, delta: true, keyframeEvery: 30, botCount: 4});
 seedPrivate(room);
 const ticks = 600;
 let afterBytes = 0, beforeBytes = 0, afterKey = 0, beforeKey = 0, afterDelta = 0, beforeDelta = 0;
 let frames = 0, rawFrames = 0;
 let prevRaw = null, prevRawSeq = 0;
 for (let i = 0; i < ticks; i++) {
  room.tick(RULES.dt);
  let broadcastSeq = 0;
  for (const {to, msg} of room.drain()) {
   if (to !== 1 || (msg.type !== 'snapshot' && msg.type !== 'snapshot-delta')) continue;
   const size = wireSize(msg);
   afterBytes += size; frames++;
   if (msg.type === 'snapshot') afterKey = Math.max(afterKey, size); else afterDelta = Math.max(afterDelta, size);
   broadcastSeq = msg.seq;
  }
  if (!broadcastSeq) continue;
  // Mirror the exact server frame policy on the unfiltered state for this tick.
  const raw = room.wireState();
  const keyframe = room.keyframeEvery > 0 && broadcastSeq % room.keyframeEvery === 0;
  const acks = {};
  for (const p of room.peers.values()) if (p.actorId !== null) acks[p.actorId] = p.appliedSeq;
  let frame = null;
  if (!keyframe && prevRaw) {
   const patch = snapshotDelta(prevRaw, raw);
   if (patch && wireSize({type: MESSAGE.SNAPSHOT_DELTA, seq: broadcastSeq, base: prevRawSeq, acks, patch}) + SNAPSHOT_DELTA_MIN_BYTES < wireSize({type: MESSAGE.SNAPSHOT, seq: broadcastSeq, acks, state: raw})) {
    frame = {type: MESSAGE.SNAPSHOT_DELTA, seq: broadcastSeq, base: prevRawSeq, acks, patch};
   }
  }
  if (!frame) frame = {type: MESSAGE.SNAPSHOT, seq: broadcastSeq, acks, state: raw};
  const size = wireSize(frame);
  beforeBytes += size; rawFrames++;
  if (frame.type === MESSAGE.SNAPSHOT) beforeKey = Math.max(beforeKey, size); else beforeDelta = Math.max(beforeDelta, size);
  prevRaw = raw; prevRawSeq = broadcastSeq;
 }
 assert.ok(frames > 0 && rawFrames === frames, `measured every frame (${frames})`);
 const seconds = ticks * RULES.dt;
 console.log(`[cocs-visibility] team-0 egress before=${beforeBytes}B (${(beforeBytes / seconds / 1024).toFixed(1)} KiB/s, key ${(beforeKey / 1024).toFixed(1)} KiB, delta ${(beforeDelta / 1024).toFixed(1)} KiB) after=${afterBytes}B (${(afterBytes / seconds / 1024).toFixed(1)} KiB/s, key ${(afterKey / 1024).toFixed(1)} KiB, delta ${(afterDelta / 1024).toFixed(1)} KiB)`);
 assert.ok(afterBytes < beforeBytes, `filtered egress ${afterBytes}B < raw ${beforeBytes}B`);
 assert.ok(afterKey < beforeKey, `filtered keyframe ${afterKey}B < raw keyframe ${beforeKey}B`);
 assert.ok(afterDelta <= beforeDelta, `filtered delta ${afterDelta}B <= raw delta ${beforeDelta}B`);
});

test('offline/local and non-COCS rooms are byte-identical at the seam', () => {
 // A non-COCS room broadcasts the raw projection unchanged to every peer.
 const room = new Room('ffa', seeded(31), {snapshotHz: 30, keyframeEvery: 1});
 room.join(1, 'A', 'chatgpt', 'openclaw');
 room.join(2, 'B', 'claude', 'hermes');
 room.host(1, {mode: 'deathmatch', botCount: 2, timeLimit: 60}, 'crosswire');
 room.start(1);
 room.drain();
 for (let i = 0; i < 4; i++) room.tick(RULES.dt);
 const msgs = room.drain();
 const snap1 = lastTo(msgs, 'snapshot', 1).state;
 const snap2 = lastTo(msgs, 'snapshot', 2).state;
 assert.equal(JSON.stringify(snap1), JSON.stringify(snap2), 'non-COCS peers share one state');
 assert.equal(JSON.stringify(snap1), JSON.stringify(room.wireState()), 'the state is the raw projection');
 assert.equal(filterCocsSnapshot(snap1, 0), snap1, 'the filter is identity without a cocs subtree');
 // A reconnect to a live non-COCS match also receives the raw projection.
 const token = room.peers.get(2).token;
 room.disconnect(2);
 room.join(9, 'B', 'claude', 'hermes', token);
 const reconnect = lastTo(room.drain(), 'snapshot', 9).state;
 assert.equal(JSON.stringify(reconnect), JSON.stringify(room.wireState()));
});
