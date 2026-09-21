// LATTICE STRIKE networking backbone (N1). Deterministic two-client harness:
// two peers drive one OPERATIONS (`cocs-coop`) room through the same validated
// wire handlers the live server uses, with bots filling the roster. Every order
// / spend / terminal / command / buy enters `Match.step(dt,{cocs})`; a seeded
// run is byte-identical across repeats with a fixed action order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,PLAYER_LIMIT,COCS_PLAYER_LIMIT,playerLimit} from './room.mjs';
import {RULES} from '../game/data.mjs';
import {capturableBy,neighbors} from '../game/cocs.mjs';

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

test('command preflight refuses impossible routes and stances before claiming acceptance', () => {
 const room=harness(73,0);
 assert.equal(room.command(1,{cardId:'take-first',action:'take'}),true);
 room.tick(RULES.dt);
 assert.equal(room.command(1,{cardId:'bad-policy',action:'policy',value:'BERSERK'}),false);
 assert.equal(room.command(1,{cardId:'bad-route',action:'set-route',value:'missing-node'}),false);
 assert.equal(room.pendingCocs.commands.length,0);
 const messages=room.drain();
 assert.equal(last(messages,'cocs-reject',1)?.reason,'unknown-node');
 assert.equal(room.command(1,{cardId:'lower-policy',action:'policy',value:'fortify'}),true);
 assert.equal(room.pendingCocs.commands[0].value,'FORTIFY');
 room.tick(RULES.dt);
 assert.equal(room.cocsCards.get('lower-policy').state,'done','normalized stance also settles the action ledger');
});

test('a successful mutiny completes even though seating clears its vote list', () => {
 const room={match:{actors:[]}};
 const record={team:0,actorId:4,action:'mutiny-vote'};
 for(const state of [
  {command:{seat:{0:'4'},votes:{0:{}}}},
  {coop:{commandSeat:{0:'4'},commandVotes:{0:{}}}},
 ]) assert.deepEqual(Room.prototype.cocsCommandOutcome.call(room,record,state),{state:'done',ok:true,reason:null});
 assert.equal(Room.prototype.cocsCommandOutcome.call(room,record,{command:{seat:{0:'2'},votes:{0:{}}}}),null);
});

// The fixed action schedule both repeats execute, in the same order. Every
// frame carries the round revision and a per-peer action sequence (WP0.3).
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
  const source=Object.values(state.terminals.terminals).find(t=>t.kind==='DEPLOY');
  source.shards[actor.team]='carried';
  state.terminals.vault.cargo[actor.id]={actor:actor.id,team:actor.team,source:source.id,deaths:actor.deaths};
 const rev = room.roundRevision;
 const accepted = {
  order: room.order(1, { cardId: 'o1', verb: 'HOLD', target: front.id, agent: 'chief', roundRev: rev, actionSeq: 1 }),
  economy: room.economy(1, { cardId: 'e1', action: 'fortify', target: front.id, roundRev: rev, actionSeq: 2 }),
  command: room.command(2, { cardId: 'm1', action: 'take', roundRev: rev, actionSeq: 1 }),
  terminal: room.terminal(1, { cardId: 't1', terminalId: vaultId, action: 'vault-store', roundRev: rev, actionSeq: 3 }),
 };
 actor.req = 100;
 accepted.buy = room.buy(1, { cardId: 'b1', itemId: 'field-repair', roundRev: rev, actionSeq: 4 });
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
 // order card keeps its acceptance marker and moves monotonically to a terminal
 // state instead of being settled as `done` the moment it is queued.
 const cards = room.wireState().cocs.cards;
 const hold = cards.find(card => card.id === 'o1');
 assert.ok(hold, 'the accepted order card is on the board');
 assert.equal(hold.accepted, true, 'the accepted order carries the acceptance marker');
 assert.ok(['running', 'done', 'expired'].includes(hold.state), 'the order is in a documented outcome state');
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
 assert.equal(orderCard?.state, 'running', 'the accepted order stays running while its task is live');
 assert.equal(orderCard?.accepted, true, 'the accepted order carries its acceptance marker');
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

// ---------------------------------------------------------------------------
// WP0.3 — round-scoped idempotent actions and honest outcomes.
// ---------------------------------------------------------------------------

// Open the OPERATIONS intermission window and put team 0 on owned ground so
// order/spend/terminal/buy frames pass the room gates. Returns the same handles
// the N1 harness uses.
function openCoopWindow(room, {flux = 240, req = 0} = {}) {
 const state = room.match.objectiveState;
 const front = state.nodes.find(node => node.archetype === 'front');
 front.owner = 0;
 state.flux[0] = flux;
 state.coop.phase = 'intermission';
 state.coop.intermission = true;
 state.coop.intermissionOpen = true;
 state.coop.intermissionTicks = 99999;
 const actor = room.match.actors[0];
 if (req) actor.req = req;
 return {state, front, actor};
}
function vaultIdFor(state) {
 return Object.keys(state.terminals.terminals).find(id => state.terminals.terminals[id].kind === 'VAULT' && state.terminals.terminals[id].nodeId === 'hq-0');
}

test('a duplicate BUY charges once and survives presentation-card eviction', () => {
 const room = harness(11, 4);
 const {state, actor} = openCoopWindow(room, {req: 100});
 room.drain();
 const rev = room.roundRevision;
 const frame = {cardId: 'dup-buy', itemId: 'field-repair', roundRev: rev, actionSeq: 1};
 assert.equal(room.buy(1, frame), true, 'the first BUY is accepted');
 assert.equal(room.buy(1, frame), true, 'the exact retry returns the cached acceptance');
 assert.equal(room.pendingCocs.buys.length, 1, 'the retry was not enqueued');
 for (let i = 0; i < 320; i++) room.recordCocsCard(`filler-${i}`, {state: 'done', ok: true, team: 0});
 assert.equal(room.cocsCards.has('dup-buy'), false, '302 later cards evicted the presentation row');
 assert.equal(room.buy(1, frame), true, 'the round ledger still answers after card eviction');
 for (let i = 0; i < 3; i++) room.tick(RULES.dt);
 assert.equal(actor.reqSpent, 40, 'REQ was debited exactly once');
 assert.equal(actor.req, 60, 'the second delivery never charged again');
 assert.equal(actor.reqBuff, 'field-repair');
 assert.equal(state.coop.buyLog.filter(entry => entry.itemId === 'field-repair').length, 1, 'one sim purchase applied');
});

test('duplicate ORDER, ECONOMY, TERMINAL and COMMAND frames have one effect', () => {
 const room = harness(13, 4);
 const {state, front, actor} = openCoopWindow(room, {flux: 240});
 const vaultId = vaultIdFor(state);
  const vault = state.terminals.terminals[vaultId];
  actor.x = vault.x; actor.z = vault.z; actor.y = 0;
  const source=Object.values(state.terminals.terminals).find(t=>t.kind==='DEPLOY');
  source.shards[actor.team]='carried';
  state.terminals.vault.cargo[actor.id]={actor:actor.id,team:actor.team,source:source.id,deaths:actor.deaths};
 room.drain();
 const rev = room.roundRevision;
 const order = {cardId: 'dup-order', verb: 'HOLD', target: front.id, agent: 'chief', roundRev: rev, actionSeq: 1};
 const spend = {cardId: 'dup-spend', action: 'fortify', target: front.id, roundRev: rev, actionSeq: 2};
 const terminal = {cardId: 'dup-store', terminalId: vaultId, action: 'vault-store', roundRev: rev, actionSeq: 3};
 const command = {cardId: 'dup-seat', action: 'take', roundRev: rev, actionSeq: 4};
 assert.equal(room.order(1, order), true);
 assert.equal(room.order(1, order), true, 'the order retry returns the cached acceptance');
 assert.equal(room.economy(1, spend), true);
 assert.equal(room.economy(1, spend), true, 'the spend retry returns the cached acceptance');
 assert.equal(room.terminal(1, terminal), true);
 assert.equal(room.terminal(1, terminal), true, 'the terminal retry returns the cached acceptance');
 assert.equal(room.command(2, command), true);
 assert.equal(room.command(2, command), true, 'the command retry returns the cached acceptance');
 assert.equal(room.pendingCocs.orders.length, 1);
 assert.equal(room.pendingCocs.spends.length, 1);
 assert.equal(room.pendingCocs.terminals.length, 1);
 assert.equal(room.pendingCocs.commands.length, 1);
 for (let i = 0; i < 3; i++) room.tick(RULES.dt);
 assert.equal(state.orderLog.filter(entry => entry.cardId === 'dup-order').length, 1, 'one order reached the sim');
 assert.equal(state.coop.spendLog.filter(entry => entry.cardId === 'dup-spend').length, 1, 'one spend reached the sim');
 assert.equal(state.terminals.vault.stores, 1, 'one vault store applied');
 assert.equal(state.coop.commandSeat[0], String(room.match.actors[1].id), 'the seat took effect once');
 assert.equal(state.orderStats.byVerb.HOLD, 1);
});

test('a reused key with a different payload and a stale round are both refused', () => {
 const room = harness(17, 4);
 const {state, front, actor} = openCoopWindow(room, {req: 200, flux: 240});
 room.drain();
 const rev = room.roundRevision;
 assert.equal(room.buy(1, {cardId: 'reuse-buy', itemId: 'field-repair', roundRev: rev, actionSeq: 7}), true);
 assert.equal(room.buy(1, {cardId: 'reuse-buy', itemId: 'overshield', roundRev: rev, actionSeq: 7}), false);
 const reuse = find(room.drain(), 'cocs-reject', 1);
 assert.equal(reuse.reason, 'id-reuse', 'the same scoped key with a different payload is refused');
 assert.equal(reuse.actionSeq, 7);
 assert.equal(room.pendingCocs.buys.length, 1, 'the refused reuse never enqueued a second record');
 assert.equal(room.cocsCardList().find(card => card.id === 'reuse-buy')?.state, 'running', 'the accepted card is not clobbered by the refusal');

 // A definitive gate refusal is cached on its key as well: the world changing
 // afterwards cannot turn the exact same key into a second, different outcome.
 state.flux[0] = 0;
 const fluxFrame = {cardId: 'gate-flux', action: 'fortify', target: front.id, roundRev: rev, actionSeq: 11};
 assert.equal(room.economy(1, fluxFrame), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'flux');
 state.flux[0] = 240;
 assert.equal(room.economy(1, fluxFrame), false, 'the exact retry returns the cached refusal');
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'flux');
 assert.equal(room.economy(1, {...fluxFrame, action: 'reinforce', role: 'fighter'}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'id-reuse', 'a different payload on the refused key is id-reuse');

 assert.equal(room.order(1, {cardId: 'stale-order', verb: 'HOLD', target: front.id, roundRev: rev + 1, actionSeq: 8}), false);
 const stale = find(room.drain(), 'cocs-reject', 1);
 assert.equal(stale.reason, 'stale-round', 'a future round revision is refused');
 assert.equal(stale.roundRevision, rev, 'the refusal names the current round');

 assert.equal(room.order(1, {cardId: 'bad-seq', verb: 'HOLD', target: front.id, roundRev: rev, actionSeq: 0}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'malformed', 'a present-but-invalid action sequence is malformed');

 assert.equal(room.order(1, {cardId: 'fresh-order', verb: 'HOLD', target: front.id, roundRev: rev, actionSeq: 9}), true, 'the current round keeps accepting fresh keys');
 assert.equal(actor.reqBuff, undefined, 'no refused frame applied a purchase');
});

test('cross-actor identical raw cardIds get distinct scoped identities', () => {
 const room = harness(19, 4);
 const {state, front} = openCoopWindow(room);
 room.drain();
 const rev = room.roundRevision;
 assert.equal(room.order(1, {cardId: 'shared-id', verb: 'HOLD', target: front.id, roundRev: rev, actionSeq: 1}), true);
 assert.equal(room.order(2, {cardId: 'shared-id', verb: 'HOLD', target: front.id, roundRev: rev, actionSeq: 1}), true, 'a second actor is not deduped into the first');
 assert.equal(room.pendingCocs.orders.length, 2, 'both actors enqueued one order');
 for (let i = 0; i < 3; i++) room.tick(RULES.dt);
 const entries = state.orderLog.filter(entry => entry.cardId === 'shared-id' && entry.ok === true);
 assert.equal(entries.length, 2, 'both actors applied exactly once');
 assert.deepEqual(entries.map(entry => entry.peerId).sort(), ['0', '1']);
 // Legacy cardId-only frames are scoped by round + seat too.
 const beforeLegacy = room.pendingCocs.orders.length;
 assert.equal(room.order(1, {cardId: 'legacy-shared', verb: 'HOLD', target: front.id}), true);
 assert.equal(room.order(2, {cardId: 'legacy-shared', verb: 'HOLD', target: front.id}), true, 'the legacy path also separates actors');
 assert.equal(room.pendingCocs.orders.length, beforeLegacy + 2, 'each legacy actor enqueued its own order');
});

test('a legacy cardId-only frame is idempotent within its round and seat', () => {
 const room = harness(53, 4);
 const {front} = openCoopWindow(room);
 room.drain();
 assert.equal(room.order(1, {cardId: 'legacy-card', verb: 'HOLD', target: front.id}), true);
 assert.equal(room.pendingCocs.orders.length, 1);
 assert.equal(room.order(1, {cardId: 'legacy-card', verb: 'HOLD', target: front.id}), true, 'an exact legacy retry returns the cached acceptance');
 assert.equal(room.pendingCocs.orders.length, 1, 'the retry was not re-enqueued');
 assert.equal(room.order(1, {cardId: 'legacy-card', verb: 'ATTACK', target: front.id}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'id-reuse', 'a different legacy payload on the same cardId is id-reuse');
});

test('an accepted HOLD stays running until the task is replaced or expires', () => {
 const room = harness(23, 4);
 const {state, front} = openCoopWindow(room);
 room.drain();
 const rev = room.roundRevision;
 assert.equal(room.order(1, {cardId: 'hold-a', verb: 'HOLD', target: front.id, roundRev: rev, actionSeq: 1}), true);
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 const cardA = room.cocsCardList().find(card => card.id === 'hold-a');
 assert.equal(cardA?.state, 'running', 'acceptance alone never implies completion');
 assert.equal(cardA?.accepted, true);
 assert.ok(Number.isFinite(cardA?.acceptedTick), 'the acceptance tick is recorded');

 assert.equal(room.order(1, {cardId: 'hold-b', verb: 'HOLD', target: front.id, roundRev: rev, actionSeq: 2}), true);
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 const replaced = room.cocsCardList().find(card => card.id === 'hold-a');
 assert.equal(replaced?.state, 'done', 'a replaced task settles its card');
 assert.equal(replaced?.reason, 'replaced');
 assert.equal(room.cocsCardList().find(card => card.id === 'hold-b')?.state, 'running');

 state.tasks[0].until = state.tick - 1;
 room.tick(RULES.dt);
 const expired = room.cocsCardList().find(card => card.id === 'hold-b');
 assert.equal(expired?.state, 'expired', 'a lapsed task expires its card');
 assert.equal(expired?.reason, 'ttl');
});

test('a rematch mints a new round revision and drops the previous board and ledger', () => {
 const room = harness(29, 4);
 const {front} = openCoopWindow(room);
 room.drain();
 const firstRev = room.roundRevision;
 assert.equal(room.order(1, {cardId: 'round-1-card', verb: 'HOLD', target: front.id, roundRev: firstRev, actionSeq: 1}), true);
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 assert.ok(room.cocsCardList().some(card => card.id === 'round-1-card'));
 assert.ok(room.cocsLedger.size >= 1);
 assert.equal(room.start(1), true, 'the host starts the next match');
 assert.equal(room.roundRevision, firstRev + 1, 'every real start mints a new revision');
 const started = room.drain();
 assert.equal(find(started, 'lobby', null)?.roundRevision, firstRev + 1, 'the lobby frame carries the round revision');
 assert.equal(find(started, 'start', null)?.roundRevision, firstRev + 1, 'the start frame carries the round revision');
 assert.equal(room.lobby().roundRevision, firstRev + 1, 'the lobby projection carries the round revision');
 assert.equal(room.cocsCardList().length, 0, 'a new round carries no old cards');
 assert.equal(room.cocsLedger.size, 0, 'the dedupe ledger is round-scoped');
 assert.equal(room.cocsInFlight.size, 0, 'no in-flight marker survives the round');
 assert.equal(room.pendingCocs.orders.length, 0, 'no old queue survives the round');
 assert.equal(room.order(1, {cardId: 'round-1-card', verb: 'HOLD', target: front.id, roundRev: firstRev, actionSeq: 1}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'stale-round', 'the old round revision is refused');
});

test('a same-round reconnect preserves cards and never reapplies a retry', () => {
 const room = new Room('r', seeded(31), {graceMs: 60000});
 room.join(1, 'Alice', 'chatgpt', 'openclaw');
 room.join(2, 'Bob', 'claude', 'hermes');
 room.host(1, {mode: 'cocs-coop', botCount: 2, timeLimit: 900}, 'warfront');
 room.start(1);
 room.drain();
 const {state, front} = openCoopWindow(room);
 const token = room.peers.get(1).token;
 const rev = room.roundRevision;
 const frame = {cardId: 'reconnect-order', verb: 'HOLD', target: front.id, roundRev: rev, actionSeq: 1};
 assert.equal(room.order(1, frame), true);
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 room.disconnect(1);
 room.drain();
 room.join(9, 'ignored', 'chatgpt', 'openclaw', token);
 const messages = room.drain();
 const snapshot = find(messages, 'snapshot', 9);
 assert.ok(snapshot, 'the reconnected peer gets a full snapshot');
 assert.equal(snapshot.state.cocs.roundRevision, rev, 'the same round revision is carried');
 const card = snapshot.state.cocs.cards.find(entry => entry.id === 'reconnect-order');
 assert.ok(card && card.state === 'running' && card.accepted === true, 'the accepted card hydrates from the snapshot');
 assert.equal(room.order(9, frame), true, 'the exact retry returns the cached acceptance');
 assert.equal(room.pendingCocs.orders.length, 0, 'the retry is not re-enqueued');
 for (let i = 0; i < 2; i++) room.tick(RULES.dt);
 assert.equal(state.orderLog.filter(entry => entry.cardId === 'reconnect-order').length, 1, 'one effect after reconnect');
});

test('the mapped cut action reaches a traversal device and settles its card', () => {
 const room = new Room('r', seeded(37), {snapshotHz: 30, keyframeEvery: 5});
 room.join(1, 'Ann', 'chatgpt', 'openclaw');
 room.join(2, 'Ben', 'claude', 'hermes');
 room.host(1, {mode: 'cocs', botCount: 4, timeLimit: 300}, 'lattice-slice');
 room.start(1);
 room.drain();
 const state = room.match.objectiveState;
 const found = Object.entries(state.traversal?.devices ?? {}).find(([, device]) => device.state === 'live');
 assert.ok(found, 'the map authors a live traversal device');
 const [deviceId, device] = found;
 const actor = room.match.actors[0];
 actor.x = device.from.x; actor.z = device.from.z; actor.y = device.from.y ?? 0;
 const rev = room.roundRevision;
 assert.equal(room.terminal(1, {cardId: 'cut-1', terminalId: deviceId, action: 'cut', roundRev: rev, actionSeq: 1}), true, 'the mapped action is accepted');
 assert.equal(room.pendingCocs.terminals[0]?.action, 'cut', 'the mapped verb is what the sim receives');
 room.tick(RULES.dt);
 assert.ok(device.channel, 'the cut channel started inside the fixed step');
 device.channel.remaining = RULES.dt * 0.5;
 room.tick(RULES.dt);
 assert.equal(device.state, 'cut', 'the cut applied through the sim');
 const card = room.cocsCardList().find(entry => entry.id === 'cut-1');
 assert.equal(card?.state, 'done', 'the terminal card settled from the device state');
});

test('an accepted ATTACK completes when the sim retires its task on capture', () => {
 const room = harness(41, 4);
 const {state} = openCoopWindow(room);
 room.drain();
 const rev = room.roundRevision;
 // Pick a capturable non-HQ node; force one neighbour to team 0 and take the
 // node for team 1 so an ordered ATTACK is legal and can genuinely capture it.
 const target = state.nodes.find(node => node.archetype !== 'hq' && node.live === true && node.owner !== 0 && neighbors(state, node.id).length > 0);
 assert.ok(target, 'the lattice has a capturable non-HQ node');
 const neighbor = state.nodes.find(node => node.id === neighbors(state, target.id)[0]);
 neighbor.owner = 0;
 target.owner = 1;
 target.progress = {0: 0, 1: 0};
 assert.ok(capturableBy(state, target.id, 0), 'the target is adjacent to team 0');
 assert.equal(room.order(1, {cardId: 'capture-order', verb: 'ATTACK', target: target.id, roundRev: rev, actionSeq: 1}), true);
 room.tick(RULES.dt);
 assert.equal(room.cocsCardList().find(card => card.id === 'capture-order')?.state, 'running', 'acceptance alone is not completion');
 // Accelerate the ordered-only capture; `captureNode` retires the task itself.
 target.progress[0] = 0.999;
 for (let i = 0; i < 5 && target.owner !== 0; i++) room.tick(RULES.dt);
 const card = room.cocsCardList().find(entry => entry.id === 'capture-order');
 assert.equal(target.owner, 0, 'the ordered team captured the node');
 assert.equal(card?.state, 'done', 'the capture completed the card');
 assert.equal(card?.reason, 'complete');
 assert.equal(state.tasks[0], null, 'the sim retired the task');
});

test('an interrupted device channel ends the card with an interruption reason', () => {
 const room = new Room('r', seeded(43), {snapshotHz: 30, keyframeEvery: 5});
 room.join(1, 'Ann', 'chatgpt', 'openclaw');
 room.join(2, 'Ben', 'claude', 'hermes');
 room.host(1, {mode: 'cocs', botCount: 4, timeLimit: 300}, 'lattice-slice');
 room.start(1);
 room.drain();
 const state = room.match.objectiveState;
 const found = Object.entries(state.traversal?.devices ?? {}).find(([, device]) => device.state === 'live');
 assert.ok(found, 'the map authors a live traversal device');
 const [deviceId, device] = found;
 const actor = room.match.actors[0];
 actor.x = device.from.x; actor.z = device.from.z; actor.y = device.from.y ?? 0;
 assert.equal(room.terminal(1, {cardId: 'cut-interrupted', terminalId: deviceId, action: 'cut', roundRev: room.roundRevision, actionSeq: 1}), true);
 room.tick(RULES.dt);
 assert.ok(device.channel, 'the cut channel started');
 actor.x = device.from.x + 500; actor.z = device.from.z + 500;
 room.tick(RULES.dt);
 assert.equal(device.channel, null, 'leaving the anchor interrupts the channel');
 const card = room.cocsCardList().find(entry => entry.id === 'cut-interrupted');
 assert.equal(card?.state, 'blocked', 'the interrupted card is refused, not left running');
 assert.equal(card?.reason, 'interrupted');
});

test('round end expires an accepted in-flight card', () => {
 const room = harness(47, 4);
 const {front} = openCoopWindow(room);
 room.drain();
 assert.equal(room.order(1, {cardId: 'end-order', verb: 'HOLD', target: front.id, roundRev: room.roundRevision, actionSeq: 1}), true);
 room.tick(RULES.dt);
 assert.equal(room.cocsCardList().find(card => card.id === 'end-order')?.state, 'running');
 room.match.over = true;
 room.tick(RULES.dt);
 assert.equal(room.roundOver, true);
 const card = room.cocsCardList().find(entry => entry.id === 'end-order');
 assert.equal(card?.state, 'expired', 'a settled round never leaves an in-flight card');
 assert.equal(card?.reason, 'round-end');
});

test('dead, ended, disconnected and spectator requests all answer with a reason', () => {
 const room = harness(59, 4);
 const {front, actor} = openCoopWindow(room);
 room.drain();
 const rev = room.roundRevision;
 actor.health = 0;
 assert.equal(room.order(1, {cardId: 'dead-order', verb: 'HOLD', target: front.id, roundRev: rev, actionSeq: 1}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'dead');
 actor.health = 100;
 room.roundOver = true;
 assert.equal(room.buy(1, {cardId: 'ended-buy', itemId: 'field-repair', roundRev: rev, actionSeq: 2}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'round-over');
 room.roundOver = false;
 room.disconnect(1);
 assert.equal(room.command(1, {cardId: 'gone-seat', action: 'take', roundRev: rev, actionSeq: 3}), false);
 assert.equal(find(room.drain(), 'cocs-reject', 1).reason, 'disconnected');
 assert.equal(room.pendingCocs.orders.length + room.pendingCocs.commands.length, 0, 'no refused frame reached a queue');

 const spectator = new Room('spec', seeded(61));
 spectator.join(1, 'Host');
 spectator.join(2, 'Spec', 'gemini', 'cline', '', true);
 spectator.host(1, {mode: 'cocs-coop', botCount: 0, timeLimit: 60}, 'warfront');
 spectator.start(1);
 spectator.drain();
 assert.equal(spectator.order(2, {cardId: 'spec-order', verb: 'HOLD', target: front.id, roundRev: spectator.roundRevision, actionSeq: 1}), false);
 assert.equal(find(spectator.drain(), 'cocs-reject', 2).reason, 'spectator');
});

// ---------------------------------------------------------------------------
// WP1.3 — truthful personal REQ slice: the OPERATIONS Puma and launch-set
// gates through the real room. Messages carry roundRev/actionSeq (WP0.3), so a
// retry is idempotent and an effectless catalogue row never reaches a queue.
// ---------------------------------------------------------------------------

// A PvPvE `cocs` room with bots filling; no rung means a practice match.
function pvpHarness(seed = 67, botCount = 4) {
 const room = new Room('rp', seeded(seed), { snapshotHz: 30, keyframeEvery: 5 });
 room.join(1, 'Alice', 'chatgpt', 'openclaw');
 room.join(2, 'Bob', 'claude', 'hermes');
 room.host(1, { mode: 'cocs', botCount, timeLimit: 300 }, 'warfront');
 room.start(1);
 room.drain();
 return room;
}

test('the OPERATIONS Puma buys through Room.buy and spawns its depot vehicle', () => {
 const room = harness(23, 4);
 const { state, actor } = openCoopWindow(room, { req: 150 });
 const depot = state.traversal.depots['depot-hq-w'];
 assert.equal(depot.owner, 0, 'the OPERATIONS map authors a friendly depot');
 room.drain();
 const rev = room.roundRevision;
 assert.equal(room.buy(1, { cardId: 'puma-buy', itemId: 'puma', depotId: 'depot-hq-w', roundRev: rev, actionSeq: 1 }), true, 'a coopLaunch item is accepted in OPERATIONS');
 for (let i = 0; i < 3; i++) room.tick(RULES.dt);
 assert.equal(actor.req, 0, 'the exact 150 REQ is debited');
 assert.equal(actor.reqSpent, 150, 'the spend is recorded once');
 assert.ok(depot.purchaseId, 'the depot records the purchase');
 const vehicle = room.match.vehicles.find(entry => entry.id === depot.purchaseId);
 assert.ok(vehicle && vehicle.depotId === 'depot-hq-w', 'the Puma spawned at its depot');
 assert.equal(state.coop.buyLog.filter(entry => entry.itemId === 'puma').length, 1, 'one sim purchase applied');
 const card = room.cocsCardList().find(entry => entry.id === 'puma-buy');
 assert.equal(card?.state, 'done', 'the accepted buy settled from the sim state');
 assert.equal(card?.ok, true);
});

test('duplicate Puma frames charge once and one live depot Puma blocks a fresh identity', () => {
 const room = harness(29, 4);
 const { state, actor } = openCoopWindow(room, { req: 300 });
 room.drain();
 const rev = room.roundRevision;
 const frame = { cardId: 'puma-dup', itemId: 'puma', depotId: 'depot-hq-w', roundRev: rev, actionSeq: 2 };
 assert.equal(room.buy(1, frame), true);
 assert.equal(room.buy(1, frame), true, 'the exact retry returns the cached acceptance');
 assert.equal(room.pendingCocs.buys.length, 1, 'the retry is not re-enqueued');
 for (let i = 0; i < 3; i++) room.tick(RULES.dt);
 assert.equal(actor.req, 150, 'one Puma charged once');
 assert.equal(actor.reqSpent, 150);
 assert.equal(state.coop.buyLog.filter(entry => entry.itemId === 'puma').length, 1, 'one authoritative purchase');
 assert.equal(room.buy(1, { cardId: 'puma-again', itemId: 'puma', depotId: 'depot-hq-w', roundRev: rev, actionSeq: 3 }), false, 'a fresh identity for a live depot Puma is refused');
 assert.equal(find(room.drain(), 'cocs-reject', 1)?.reason, 'vehicle', 'the room mirrors the sim one-live-Puma rule');
 assert.equal(actor.req, 150, 'the refused second Puma never debits');
 assert.equal(room.pendingCocs.buys.length, 0);
});

test('the room gates coopLaunch to OPERATIONS and effectless catalogue rows out of both modes', () => {
 const pvp = pvpHarness(31, 4);
 const pvpActor = pvp.match.actors[0];
 pvpActor.req = 150;
 pvp.drain();
 assert.equal(pvp.buy(1, { cardId: 'pvp-puma', itemId: 'puma', depotId: 'depot-hq-w', roundRev: pvp.roundRevision, actionSeq: 1 }), false, 'PvPvE never accepts the OPERATIONS Puma');
 assert.equal(find(pvp.drain(), 'cocs-reject', 1)?.reason, 'wrong-mode');
 assert.equal(pvpActor.req, 150, 'the wrong-mode Puma never debits');
 assert.equal(pvp.pendingCocs.buys.length, 0, 'a refused Puma never reaches a queue');
 assert.equal(pvp.buy(1, { cardId: 'pvp-sentry', itemId: 'sentry', roundRev: pvp.roundRevision, actionSeq: 2 }, 5000), false, 'an effectless row is refused in PvPvE too');
 assert.equal(find(pvp.drain(), 'cocs-reject', 1)?.reason, 'not-launched');
 assert.equal(pvpActor.req, 150, 'the effectless row never debits');

 const coop = harness(37, 4);
 const { state, actor } = openCoopWindow(coop, { req: 500 });
 coop.drain();
 const unsupported = ['at-mine', 'barrier', 'sentry', 'supply-drop', 'fortify-doctrine', 'oracle-unlock'];
 unsupported.forEach((itemId, index) => {
  const now = 1000 + index * 1000; // one request per rate-limit window
  assert.equal(coop.buy(1, { cardId: `noop-${itemId}`, itemId, roundRev: coop.roundRevision, actionSeq: 10 + index }, now), false, `${itemId} is not purchasable`);
  assert.equal(find(coop.drain(), 'cocs-reject', 1)?.reason, 'not-launched', `${itemId} is refused as unlaunched`);
 });
 assert.equal(actor.req, 500, 'no effectless row debited');
 assert.equal(actor.reqSpent ?? 0, 0, 'no effectless row recorded a spend');
 assert.equal(actor.reqBuff, undefined);
 assert.equal((state.coop.buyLog ?? []).length, 0, 'no effectless row reached the sim');
});
