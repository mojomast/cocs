// WP0.3 round/action identity: the additive v3 fields on the five COCS action
// frames (`roundRev`, `actionSeq`) and their client-side generation. The parser
// contract is additive: an old frame without identity still parses exactly as
// before, a frame that carries identity must carry bounded safe integers, and
// the Board's SABOTAGE card maps to the protocol `cut` action.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 MESSAGE,PROTOCOL_VERSION,
 parseOrderMessage,parseEconomyMessage,parseTerminalMessage,parseCommandMessage,parseBuyMessage,
 COCS_TERMINAL_ALIASES,
} from './protocol.mjs';
import {NetClient} from './net.mjs';

test('the five action parsers accept optional roundRev/actionSeq without changing legacy frames', () => {
 assert.equal(PROTOCOL_VERSION, 3, 'the identity fields are additive and never bump the protocol');
 const order = parseOrderMessage({cardId: 'c1', verb: 'HOLD', target: 'front-0', roundRev: 4, actionSeq: 9});
 assert.equal(order.roundRev, 4);
 assert.equal(order.actionSeq, 9);
 const legacy = parseOrderMessage({cardId: 'c1', verb: 'HOLD', target: 'front-0'});
 assert.equal('roundRev' in legacy, false, 'an omitted revision adds no key');
 assert.equal('actionSeq' in legacy, false, 'an omitted sequence adds no key');
 assert.equal(parseEconomyMessage({cardId: 'e1', action: 'fortify', roundRev: 1, actionSeq: 2}).actionSeq, 2);
 assert.equal(parseTerminalMessage({terminalId: 'vault-hq-0', action: 'vault-pull', roundRev: 1, actionSeq: 3}).roundRev, 1);
 assert.equal(parseCommandMessage({action: 'take', roundRev: 1, actionSeq: 4}).actionSeq, 4);
 assert.equal(parseBuyMessage({itemId: 'field-repair', roundRev: 1, actionSeq: 5}).actionSeq, 5);
});

test('a present-but-invalid identity field is malformed, never silently ignored', () => {
 for (const bad of [{roundRev: -1}, {roundRev: 1.5}, {roundRev: '1'}, {roundRev: 2 ** 31}, {actionSeq: 0}, {actionSeq: -4}, {actionSeq: 1.2}, {actionSeq: 2 ** 31}]) {
  assert.equal(parseOrderMessage({cardId: 'c1', verb: 'HOLD', target: 'front-0', ...bad}), null, `order rejects ${JSON.stringify(bad)}`);
  assert.equal(parseBuyMessage({itemId: 'field-repair', ...bad}), null, `buy rejects ${JSON.stringify(bad)}`);
 }
 assert.equal(parseOrderMessage({cardId: 'c1', verb: 'HOLD', target: 'front-0', roundRev: null, actionSeq: null}).actionSeq, undefined, 'explicit null behaves as omitted');
});

test('the Board SABOTAGE verb maps to the protocol cut action', () => {
 assert.equal(COCS_TERMINAL_ALIASES.sabotage, 'cut');
 assert.equal(parseTerminalMessage({terminalId: 'sabotage-relay-0', action: 'SABOTAGE'}).action, 'cut');
 assert.equal(parseTerminalMessage({terminalId: 'sabotage-relay-0', action: 'sabotage'}).action, 'cut');
 assert.equal(parseTerminalMessage({terminalId: 'relay-0', action: 'cut'}).action, 'cut', 'the canonical verb is unchanged');
});

function cocsClient() {
 const client = new NetClient();
 const sent = [];
 client.send = msg => { sent.push(msg); return true; };
 // A real round announcement is what gives the client an identity to send.
 client.onMessage(JSON.stringify({type: MESSAGE.START, mapId: 'warfront', config: {mode: 'cocs-coop', humanCount: 1, botCount: 0, timeLimit: 60}, roundRevision: 1}));
 return {client, sent};
}

test('NetClient stamps the round revision and a monotonic sequence on all five senders', () => {
 const {client, sent} = cocsClient();
 assert.equal(client.roundRevision, 1);
 client.order('c1', 'hold', 'front-0', 'chief');
 client.economy('fortify', {cardId: 'e1', target: 'front-0'});
 client.terminal('vault-hq-0', 'vault-pull', {cardId: 't1'});
 client.command('take', null, {cardId: 'm1'});
 client.buy('field-repair', {cardId: 'b1'});
 for (const [index, frame] of sent.entries()) {
  assert.equal(frame.roundRev, 1, `frame ${index} carries the round revision`);
  assert.equal(frame.actionSeq, index + 1, `frame ${index} carries the next sequence`);
 }
 assert.deepEqual(sent.map(frame => frame.type), [MESSAGE.ORDER, MESSAGE.ECONOMY, MESSAGE.TERMINAL, MESSAGE.COMMAND, MESSAGE.BUY]);
});

test('the action sequence survives a reconnect reset but resets on a new round revision', () => {
 const {client, sent} = cocsClient();
 client.order('c1', 'hold', 'front-0');
 assert.equal(client.actionSeq, 1);
 client.cocsPending.set('inflight', {cardId: 'inflight', kind: 'order'});
 client.reset();
 assert.equal(client.roundRevision, 1, 'a reconnect keeps the round revision');
 assert.equal(client.actionSeq, 1, 'a reconnect keeps the sequence');
 assert.ok(client.cocsPending.has('inflight'), 'a reconnect keeps optimistic cards for snapshot reconciliation');
 client.order('c2', 'hold', 'front-0');
 assert.equal(sent.at(-1).actionSeq, 2, 'the sequence continues after reset');

 // The same revision is a reconnect: pending state is preserved.
 client.onMessage(JSON.stringify({type: MESSAGE.START, mapId: 'warfront', config: {mode: 'cocs-coop', humanCount: 1, botCount: 0, timeLimit: 60}, roundRevision: 1}));
 assert.ok(client.cocsPending.has('inflight'), 'a same-revision start reconciles instead of clearing');
 // A new revision is a new round: pending state clears and the sequence resets.
 client.onMessage(JSON.stringify({type: MESSAGE.START, mapId: 'warfront', config: {mode: 'cocs-coop', humanCount: 1, botCount: 0, timeLimit: 60}, roundRevision: 2}));
 assert.equal(client.cocsPending.size, 0, 'a new round clears optimistic cards');
 assert.equal(client.actionSeq, 0, 'a new round resets the sequence');
 client.order('c3', 'hold', 'front-0');
 assert.deepEqual({roundRev: sent.at(-1).roundRev, actionSeq: sent.at(-1).actionSeq}, {roundRev: 2, actionSeq: 1});
});

test('an authoritative blocked/expired card clears the optimistic row with a reason', () => {
 const {client} = cocsClient();
 client.order('blocked-card', 'hold', 'front-0');
 client.order('expired-card', 'hold', 'front-0');
 assert.equal(client.cocsPending.size, 2);
 client.onMessage(JSON.stringify({type: MESSAGE.SNAPSHOT, seq: 1, acks: {}, state: {time: 1, actors: [], cocs: {roundRevision: 1, cards: [
  {id: 'blocked-card', state: 'blocked', reason: 'flux', team: 0},
  {id: 'expired-card', state: 'expired', reason: 'ttl', team: 0},
  {id: 'authoritative-card', state: 'running', team: 0},
 ]}}}));
 assert.equal(client.cocsPending.size, 0, 'terminal authoritative cards are no longer pending');
 assert.equal(client.cocsBlockers.get('blocked-card').reason, 'flux');
 assert.equal(client.cocsBlockers.get('expired-card').reason, 'ttl');
});
