// LATTICE STRIKE wire validators (§11.2). Pure parser tests: bounded ids,
// enum allow-lists and integer actor ids. Nothing here touches the sim, which
// is the point — a client value can never authorise a spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 MESSAGE,PROTOCOL_VERSION,
 parseOrderMessage,parseEconomyMessage,parseTerminalMessage,parseCommandMessage,parseBuyMessage,
 COCS_ORDER_VERBS,COCS_ECONOMY_ACTIONS,COCS_TERMINAL_ACTIONS,COCS_COMMAND_ACTIONS,
} from './protocol.mjs';
import {NetClient} from './net.mjs';

test('MESSAGE declares the five C→S actions and the cocs-reject frame', () => {
 assert.equal(MESSAGE.ORDER, 'order');
 assert.equal(MESSAGE.ECONOMY, 'economy');
 assert.equal(MESSAGE.TERMINAL, 'terminal');
 assert.equal(MESSAGE.COMMAND, 'command');
 assert.equal(MESSAGE.BUY, 'buy');
 assert.equal(MESSAGE.COCS_REJECT, 'cocs-reject');
 // The envelope is additive: old clients are untouched, so no version bump.
 assert.equal(PROTOCOL_VERSION, 3);
});

test('the order validator accepts canonical orders and bounds every field', () => {
 assert.deepEqual(parseOrderMessage({ cardId: 'c1', verb: 'ATTACK', target: 'front-0', agent: 'chief' }), { cardId: 'c1', verb: 'ATTACK', target: 'front-0', agent: 'chief', tick: null });
 assert.equal(parseOrderMessage({ cardId: 'c1', verb: 'hold', target: 'front-0' }).verb, 'HOLD', 'verbs are case-insensitive');
 assert.equal(parseOrderMessage({ cardId: 'c1', verb: 'SPAWN', target: 'front-0' }), null, 'unknown verb');
 assert.equal(parseOrderMessage({ cardId: 'bad id', verb: 'HOLD', target: 'front-0' }), null, 'ids are bounded');
 assert.equal(parseOrderMessage({ cardId: 'c'.repeat(65), verb: 'HOLD', target: 'front-0' }), null);
 assert.equal(parseOrderMessage({ cardId: 'c1', verb: 'HOLD', target: 'front-0', agent: 'a'.repeat(65) }), null);
 assert.equal(parseOrderMessage(null), null);
 assert.deepEqual(COCS_ORDER_VERBS, ['HOLD', 'ATTACK', 'SCAN']);
});

test('the economy validator accepts the sink aliases and rejects bad actions/actor ids', () => {
 assert.equal(parseEconomyMessage({ cardId: 'e1', action: 'spawn', role: 'harvester' }).action, 'spawn');
 assert.equal(parseEconomyMessage({ cardId: 'e1', action: 'fortify' }).action, 'fortify');
 assert.equal(parseEconomyMessage({ cardId: 'e1', action: 'not-a-verb' }), null);
 assert.equal(parseEconomyMessage({ cardId: 'e1', action: 'spawn', actorId: -1 }), null);
 assert.equal(parseEconomyMessage({ cardId: 'e1', action: 'spawn', actorId: 1.5 }), null);
 assert.equal(parseEconomyMessage({ cardId: 'e1', action: 'spawn', actorId: 3 }).actorId, 3);
 assert.ok(COCS_ECONOMY_ACTIONS.includes('reinforce'));
});

test('the terminal validator restricts the action allow-list', () => {
 assert.deepEqual(parseTerminalMessage({ terminalId: 'vault-hq-0', action: 'vault-pull' }).action, 'vault-pull');
 assert.equal(parseTerminalMessage({ terminalId: 'vault-hq-0', action: 'PULL' }), null, 'the allow-list is exact');
 assert.equal(parseTerminalMessage({ terminalId: '', action: 'hack' }), null);
 assert.ok(COCS_TERMINAL_ACTIONS.includes('depot-capture'));
});

test('the command and buy validators bound values and item ids', () => {
 assert.deepEqual(parseCommandMessage({ action: 'take' }), { action: 'take', value: null, cardId: null, tick: null });
 assert.equal(parseCommandMessage({ action: 'set-route', value: 'north' }).value, 'north');
 assert.equal(parseCommandMessage({ action: 'policy', value: 'x'.repeat(65) }), null);
 assert.equal(parseCommandMessage({ action: 'policy', value: {} }), null);
 assert.equal(parseCommandMessage({ action: 'fly' }), null);
 assert.ok(COCS_COMMAND_ACTIONS.includes('mutiny-vote'));
 assert.deepEqual(parseBuyMessage({ itemId: 'field-repair', depotId: 'depot-fwd-w' }), { itemId: 'field-repair', depotId: 'depot-fwd-w', targetCardId: null, cardId: null, actorId: null, tick: null });
 assert.equal(parseBuyMessage({ itemId: 'bad id' }), null);
 assert.equal(parseBuyMessage({}), null);
});

test('NetClient emits the five action frames and clears optimistic state on reject', () => {
 const client = new NetClient();
 const sent = [];
 client.send = msg => { sent.push(msg); return true; };
 client.order('c1', 'hold', 'front-0', 'chief');
 client.economy('fortify', { cardId: 'e1', target: 'front-0' });
 client.terminal('vault-hq-0', 'vault-pull', { cardId: 't1' });
 client.command('take', null, { cardId: 'm1' });
 client.buy('field-repair', { cardId: 'b1' });
 assert.deepEqual(sent.map(m => m.type), [MESSAGE.ORDER, MESSAGE.ECONOMY, MESSAGE.TERMINAL, MESSAGE.COMMAND, MESSAGE.BUY]);
 assert.deepEqual(sent[0], { type: MESSAGE.ORDER, cardId: 'c1', verb: 'HOLD', target: 'front-0', agent: 'chief' });
 assert.equal(sent[1].action, 'fortify');
 assert.equal(sent[2].action, 'vault-pull');
 assert.equal(sent[3].action, 'take');
 assert.equal(sent[4].itemId, 'field-repair');
 assert.equal(client.cocsPending.size, 5, 'every action is optimistic while in flight');
 let rejected = null;
 client.onCocsReject = msg => { rejected = msg; };
 client.onMessage(JSON.stringify({ type: MESSAGE.COCS_REJECT, cardId: 'e1', reason: 'flux' }));
 assert.equal(rejected.reason, 'flux');
 assert.ok(!client.cocsPending.has('e1'), 'the rejected optimistic card is cleared');
 assert.equal(client.cocsBlockers.get('e1').reason, 'flux');
 assert.equal(client.cocsRejects.length, 1);
});
