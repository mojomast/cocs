// LATTICE STRIKE networking backbone (N1). Deterministic two-client harness:
// two peers drive one OPERATIONS (`cocs-coop`) room through the same validated
// wire handlers the live server uses, with bots filling the roster. Every order
// / spend / terminal / command / buy enters `Match.step(dt,{cocs})`; a seeded
// run is byte-identical across repeats with a fixed action order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,PLAYER_LIMIT,COCS_PLAYER_LIMIT,playerLimit} from './room.mjs';
import {RULES} from '../game/data.mjs';

function seeded(seed = 11) {
 let n = seed;
 return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const find = (msgs, type, to) => msgs.find(m => m.msg.type === type && (to === undefined || m.to === to))?.msg;
const last = (msgs, type, to) => [...msgs].reverse().find(m => m.msg.type === type && (to === undefined || m.to === to))?.msg;

// Two connected peers + an OPERATIONS room with bots filling. Deterministic RNG.
function harness(seed = 11, botCount = 6) {
 const room = new Room('r', seeded(seed), { snapshotHz: 30, keyframeEvery: 5 });
 room.join(1, 'Alice', 'chatgpt', 'openclaw');
 room.join(2, 'Bob', 'claude', 'hermes');
 room.host(1, { mode: 'cocs-coop', botCount, timeLimit: 900 }, 'warfront');
 room.start(1);
 room.drain();
 return room;
}

// The fixed action schedule both repeats execute, in the same order.
function schedule(room) {
 const state = room.match.objectiveState;
 const front = state.nodes.find(node => node.archetype === 'front');
 const relay = state.nodes.find(node => node.archetype === 'relay');
 front.owner = 0;
 relay.owner = 0;
 state.flux[0] = 240;
 state.coop.phase = 'intermission';
 state.coop.intermission = true;
 state.coop.intermissionOpen = true;
 state.coop.intermissionTicks = 99999;
 const vaultId = Object.keys(state.terminals.terminals).find(id => state.terminals.terminals[id].kind === 'VAULT' && state.terminals.terminals[id].nodeId === 'hq-0');
 const vault = state.terminals.terminals[vaultId];
 const actor = room.match.actors[0];
 actor.x = vault.x; actor.z = vault.z; actor.y = 0;
 const accepted = {
  order: room.order(1, { cardId: 'o1', verb: 'HOLD', target: front.id, agent: 'chief' }),
  economy: room.economy(1, { cardId: 'e1', action: 'fortify', target: front.id }),
  command: room.command(2, { cardId: 'm1', action: 'take' }),
  terminal: room.terminal(1, { cardId: 't1', terminalId: vaultId, action: 'vault-store' }),
 };
 actor.req = 100;
 accepted.buy = room.buy(1, { cardId: 'b1', itemId: 'field-repair' });
 return { accepted, front, relay, vaultId, actor };
}

test('two-client OPERATIONS harness applies orders, spends, terminals, commands and buys', () => {
 const room = harness();
 const { accepted, front, vaultId, actor } = schedule(room);
 assert.deepEqual(accepted, { order: true, economy: true, command: true, terminal: true, buy: true }, 'every action is accepted');
 const state = room.match.objectiveState;
 for (let i = 0; i < 180; i++) room.tick(RULES.dt);
 assert.ok(state.orderLog.some(entry => entry.cardId === 'o1' && entry.ok === true), 'the HOLD order reached the sim order log');
 assert.ok(state.orderStats.byVerb.HOLD >= 1);
 assert.ok(state.coop.spendStats.FORTIFY >= 1, 'the between-wave spend applied');
 assert.ok(state.coop.spendLog.some(entry => entry.cardId === 'e1' && entry.ok === true), 'the spend was accepted by the sim');
 assert.equal(state.coop.commandSeat[0], '1', 'the command seat stores the acting actor id of peer 2');
 assert.ok(state.terminals.vault.stores >= 1, 'the vault store applied');
 assert.equal(actor.reqBuff, 'field-repair', 'the personal REQ purchase landed');
 assert.ok(actor.reqSpent >= 40, 'REQ was debited');
 assert.ok(state.nodes.find(node => node.id === front.id).captureResist > 0, 'fortify wrote node resist');
 // The card board rides the wire so a reconnect can rebuild it, and an accepted
 // order card is settled from the sim outcome instead of sticking at `running`.
 const cards = room.wireState().cocs.cards;
 assert.ok(cards.some(card => card.id === 'o1' && card.state === 'done'), 'the accepted order card reached a terminal state');
 assert.ok(cards.some(card => card.id === 't1' && card.reason === null));
});

test('a seeded OPERATIONS run is byte-identical across repeats with a fixed input order', () => {
 const run = () => {
  const room = harness(7, 4);
  schedule(room);
  for (let i = 0; i < 240; i++) room.tick(RULES.dt);
  return JSON.stringify(room.wireState());
 };
 const first = run();
 const second = run();
 assert.equal(first, second, 'same seed + same action order produce identical bytes');
});

test('server rejects unaffordable, wrong-team, no-thread and missing-executor actions', () => {
 const room = harness(3, 4);
 const state = room.match.objectiveState;
 const front = state.nodes.find(node => node.archetype === 'front');
 const relay = state.nodes.find(node => node.archetype === 'relay');
 front.owner = 0;
 relay.owner = 0;
 state.flux[0] = 240;
 state.coop.phase = 'intermission';
 state.coop.intermission = true;
 state.coop.intermissionOpen = true;
 state.coop.intermissionTicks = 99999;
 room.drain();

 // Unaffordable: zero authoritative FLUX.
 state.flux[0] = 0;
 assert.equal(room.economy(1, { cardId: 'x-flux', action: 'fortify', target: front.id }), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'flux');
 state.flux[0] = 240;

 // Wrong-team ownership: ATTACK on a node the peer already owns.
 assert.equal(room.order(1, { cardId: 'x-team', verb: 'ATTACK', target: front.id }), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'wrong-team');

 // No free THREAD: fill every subagent slot then ask for a REINFORCE squad.
 const threadsCap = Math.min(6, 2 + 1);
 for (let i = 0; i < threadsCap; i++) room.match.actors[i].isSubagent = true;
 assert.equal(room.economy(1, { cardId: 'x-thread', action: 'reinforce', role: 'fighter' }), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'no-thread');
 for (let i = 0; i < threadsCap; i++) room.match.actors[i].isSubagent = false;

 // Missing executor lease: the rotating executor is actor 0; peer 2 seats actor 1.
 assert.equal(room.order(2, { cardId: 'x-lease', verb: 'SCAN', target: front.id }), false);
 assert.equal(find(room.drain(), 'cocs-reject', 2).reason, 'executor');
});

test('a flood of one action kind is rate limited per peer', () => {
 const room = harness(5, 0);
 const state = room.match.objectiveState;
 const front = state.nodes.find(node => node.archetype === 'front');
 front.owner = 0;
 state.flux[0] = 240;
 room.drain();
 let accepted = 0;
 for (let i = 0; i < 14; i++) if (room.order(1, { cardId: `flood-${i}`, verb: 'HOLD', target: front.id })) accepted++;
 assert.equal(accepted, 10, 'the order token bucket admits ten per second');
 const reject = find(room.drain(), 'cocs-reject', 1);
 assert.equal(reject.reason, 'rate-limit');
});

test('a reconnect resends a full snapshot including cocs command state and cards', () => {
 const room = new Room('r', seeded(9), { graceMs: 60000 });
 room.join(1, 'Alice', 'chatgpt', 'openclaw');
 room.join(2, 'Bob', 'claude', 'hermes');
 room.host(1, { mode: 'cocs-coop', botCount: 2, timeLimit: 900 }, 'warfront');
 room.start(1);
 room.drain();
 const token = room.peers.get(2).token;
 room.command(2, { cardId: 'm1', action: 'take' });
 room.tick(RULES.dt);
 room.tick(RULES.dt);
 assert.equal(room.match.objectiveState.coop.commandSeat[0], '1', 'the seat holds actor 1 (peer 2)');
 room.disconnect(2);
 room.drain();
 room.join(9, 'ignored', 'claude', 'hermes', token);
 const messages = room.drain();
 const snapshot = find(messages, 'snapshot', 9);
 assert.ok(snapshot, 'the reconnected peer gets a full snapshot immediately');
 assert.equal(snapshot.state.cocs.command.seat[0], '1', 'command state round-trips through the snapshot');
 assert.ok(Array.isArray(snapshot.state.cocs.cards), 'the card board round-trips too');
});

test('the player limit is mode-aware: COCS admits 32 while default modes keep 8', () => {
 assert.equal(PLAYER_LIMIT, 8);
 assert.equal(COCS_PLAYER_LIMIT, 32);
 assert.equal(playerLimit('cocs-coop'), 32);
 assert.equal(playerLimit('cocs'), 32);
 assert.equal(playerLimit('deathmatch'), 8);
 assert.equal(playerLimit(null), 8);

 const ffa = new Room('ffa', seeded(1));
 for (let i = 1; i <= PLAYER_LIMIT; i++) ffa.join(i, `P${i}`);
 ffa.join(PLAYER_LIMIT + 1, 'Overflow');
 assert.ok(find(ffa.drain(), 'error', PLAYER_LIMIT + 1), 'the 9th default-mode player is still rejected');

 const cocs = new Room('cocs', seeded(1));
 cocs.join(1, 'Host');
 cocs.host(1, { mode: 'cocs-coop', botCount: 0, timeLimit: 900 }, 'warfront');
 for (let i = 2; i <= COCS_PLAYER_LIMIT; i++) cocs.join(i, `P${i}`);
 assert.equal([...cocs.peers.values()].filter(p => p.spectate !== true).length, COCS_PLAYER_LIMIT);
 cocs.join(COCS_PLAYER_LIMIT + 1, 'Overflow');
 assert.ok(find(cocs.drain(), 'error', COCS_PLAYER_LIMIT + 1), 'the 33rd COCS player is rejected');
});

test('the rate-only snapshot budget drops to 20 Hz above 32 actors', () => {
 const room = new Room('r', seeded(2), { snapshotHz: 30, keyframeEvery: 0 });
 room.join(1, 'Alice', 'chatgpt', 'openclaw');
 room.host(1, { mode: 'cocs-coop', botCount: 0, timeLimit: 900 }, 'warfront');
 room.start(1);
 room.drain();
 assert.equal(room.effectiveSnapshotHz(), 30, 'at or below 32 actors the configured rate holds');
 for (let i = 0; i < 40; i++) room.match.actors.push(room.match.actor(50 + i, 'chatgpt', 'openclaw'));
 assert.ok(room.match.actors.length > 32);
 assert.equal(room.effectiveSnapshotHz(), 20, 'above 32 actors the mode runs 20 Hz');
 let frames = 0;
 for (let i = 0; i < 60; i++) { room.tick(RULES.dt); frames += room.drain().filter(m => m.to !== null && (m.msg.type === 'snapshot' || m.msg.type === 'snapshot-delta')).length; }
 assert.ok(frames >= 18 && frames <= 22, `expected ~20 frames at 20 Hz, got ${frames}`);
});

// Coherence-audit regression (LATTICE-COHERENCE-AUDIT.md §2a): real lobby peer
// ids are transport ids, not actor ids. Every queued COCS record must carry the
// acting actor's id into the simulation (the executor/slice gates resolve actor
// ids), while replies, rate limits and the card mirror keep the transport id.
test('transport peer ids never enter the sim: a uuid peer still orders, spends and seats', () => {
 const room = new Room('uuid-room', seeded(23), { snapshotHz: 30, keyframeEvery: 1 });
 // UUID transport ids: no collision with the numeric actor ids 0/1.
 const A = '0000aaaa-1111-4222-8333-444455556666';
 const B = '0000bbbb-1111-4222-8333-444455556666';
 room.join(A, 'Ann', 'chatgpt', 'openclaw');
 room.join(B, 'Ben', 'claude', 'hermes');
 room.host(A, { mode: 'cocs-coop', botCount: 2, timeLimit: 900 }, 'warfront');
 room.start(A);
 room.drain();
 const state = room.match.objectiveState;
 const front = state.nodes.find(node => node.archetype === 'front');
 front.owner = 0;
 state.flux[0] = 240;
 state.coop.phase = 'intermission';
 state.coop.intermission = true;
 state.coop.intermissionOpen = true;
 state.coop.intermissionTicks = 99999;
 const ann = room.match.actors.find(actor => actor.name === 'Ann');
 const ben = room.match.actors.find(actor => actor.name === 'Ben');
 assert.equal(ann.id, 0);
 assert.equal(ben.id, 1);
 assert.notEqual(A, String(ann.id), 'the transport id is not an actor id');

 // Order: the room pre-gate and the sim executor gate both resolve Ann's actor.
 assert.equal(room.order(A, { cardId: 'u-order', verb: 'HOLD', target: front.id }), true);
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 const order = state.orderLog.find(entry => entry.cardId === 'u-order');
 assert.equal(order?.ok, true, 'the sim accepted the order');
 assert.equal(order?.peerId, '0', 'the queued order resolved to the actor id');
 assert.equal(state.tasks[0]?.peerId, '0', 'the live task is keyed by the actor id');
 const orderCard = room.cocsCardList().find(card => card.id === 'u-order');
 assert.equal(orderCard?.state, 'done', 'the accepted order card left running');
 assert.equal(orderCard?.peerId, A, 'the card mirror keeps the transport peer id');

 // Spend: the same uuid peer must pass the slice + executor gate and the sink.
 assert.equal(room.economy(A, { cardId: 'u-spend', action: 'fortify', target: front.id }), true);
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 const spend = state.coop.spendLog.find(entry => entry.cardId === 'u-spend');
 assert.equal(spend?.ok, true, 'the sim accepted the spend');
 assert.equal(spend?.peerId, '0', 'the queued spend resolved to the actor id');
 assert.ok(state.coop.spendStats.FORTIFY >= 1, 'the sink applied');
 const spendCard = room.cocsCardList().find(card => card.id === 'u-spend');
 assert.equal(spendCard?.state, 'done', 'the accepted spend card left running');
 assert.equal(spendCard?.peerId, A, 'the spend card keeps the transport peer id');

 // Command: the seat is the sim identity (actor id), never the uuid.
 assert.equal(room.command(B, { cardId: 'u-seat', action: 'take' }), true);
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 assert.equal(state.coop.commandSeat[0], '1', 'the seat holds Ben\'s actor id');
 const seatCard = room.cocsCardList().find(card => card.id === 'u-seat');
 assert.equal(seatCard?.state, 'done', 'the seat card settled from the sim state');
 assert.equal(seatCard?.peerId, B, 'the seat card keeps the transport peer id');
 // A non-commander release is still refused on the transport-facing reply path.
 assert.equal(room.command(A, { cardId: 'u-release', action: 'release' }), false);
 assert.equal(find(room.drain(), 'cocs-reject', A)?.reason, 'not-commander');
});
