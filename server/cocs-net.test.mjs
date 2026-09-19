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
 assert.equal(state.coop.commandSeat[0], '2', 'the command seat moved to peer 2');
 assert.ok(state.terminals.vault.stores >= 1, 'the vault store applied');
 assert.equal(actor.reqBuff, 'field-repair', 'the personal REQ purchase landed');
 assert.ok(actor.reqSpent >= 40, 'REQ was debited');
 assert.ok(state.nodes.find(node => node.id === front.id).captureResist > 0, 'fortify wrote node resist');
 // The card board rides the wire so a reconnect can rebuild it.
 const cards = room.wireState().cocs.cards;
 assert.ok(cards.some(card => card.id === 'o1' && card.state === 'running'), 'the accepted card is on the wire');
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
 assert.equal(room.match.objectiveState.coop.commandSeat[0], '2');
 room.disconnect(2);
 room.drain();
 room.join(9, 'ignored', 'claude', 'hermes', token);
 const messages = room.drain();
 const snapshot = find(messages, 'snapshot', 9);
 assert.ok(snapshot, 'the reconnected peer gets a full snapshot immediately');
 assert.equal(snapshot.state.cocs.command.seat[0], '2', 'command state round-trips through the snapshot');
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
