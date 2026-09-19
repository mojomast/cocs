import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {cocsAnnouncement,latticeAnnounceCue} from './hud.mjs';

const DT = 1 / 60;
const cocsMatch = (mapId = 'warfront', over = {}) => new Match('chatgpt', 'openclaw', () => .5, mapId, {mode: 'cocs', botCount: 0, humanCount: 1, timeLimit: 300, cocsPolicy: () => [], ...over});
const node = (match, id) => match.objectiveState.nodes.find(entry => entry.id === id);
const place = (match, actor, target) => { actor.x = target.x; actor.z = target.z; actor.y = target.y; actor.health = 200; actor.maxHealth = 200; actor.armor = 0; };
const capture = (match, type, out) => {
  const original = match.emit.bind(match);
  match.emit = (event, data) => { if (event === type) out.push({type: event, ...data}); return original(event, data); };
};

test('captures carry the authored label, rewards and participants', () => {
  const match = cocsMatch('lattice-slice');
  const front = node(match, 'front-0');
  assert.equal(front.label, 'West Bastion', 'the foundry label reaches the sim node');
  const actor = match.actors[0];
  actor.team = 0;
  place(match, actor, front);
  const captures = [];
  capture(match, 'cocs-capture', captures);
  for (let i = 0; i < 60 * 30 && !captures.length; i++) match.step(DT, {});
  assert.equal(captures.length, 1);
  const cap = captures[0];
  assert.equal(cap.node, 'front-0');
  assert.equal(cap.label, 'West Bastion');
  assert.ok(cap.reward.op > 0, 'the capture pays team OP');
  assert.ok(cap.reward.req > 0, 'the capture pays participant REQ');
  assert.deepEqual(cap.participants, [actor.id]);
  assert.equal(cap.orderCompleted, false);
  assert.equal(match.snapshot().cocs.nodes.find(entry => entry.id === 'front-0').label, 'West Bastion');
});

test('an issued order carries its label and completes with the capture reward', () => {
  const match = cocsMatch('lattice-slice');
  const front = node(match, 'front-0');
  const actor = match.actors[0];
  actor.team = 0;
  place(match, actor, front);
  const issued = [], completed = [], captures = [];
  capture(match, 'cocs-order', issued);
  capture(match, 'cocs-order-complete', completed);
  capture(match, 'cocs-capture', captures);
  match.step(DT, {cocs: {orders: [{tick: match.objectiveState.tick + 1, peerId: '0', cardId: 'h-old', team: 0, verb: 'HOLD', target: 'front-0'}]}});
  match.step(DT, {});
  assert.equal(issued.length, 1);
  assert.equal(issued[0].label, 'West Bastion');
  assert.equal(issued[0].verb, 'HOLD');
  for (let i = 0; i < 60 * 30 && !captures.length; i++) {
    if (i > 0 && i % 60 === 0) match.step(DT, {cocs: {orders: [{tick: match.objectiveState.tick + 1, peerId: '0', cardId: `h-${i}`, team: 0, verb: 'HOLD', target: 'front-0'}]}});
    else match.step(DT, {});
  }
  assert.equal(completed.length, 1);
  assert.equal(completed[0].verb, 'HOLD');
  assert.equal(completed[0].label, 'West Bastion');
  assert.ok(completed[0].teamOP > 0);
  assert.equal(captures[0].orderCompleted, true);
  assert.equal(captures[0].teamOP, completed[0].teamOP);
});

test('a refused order surfaces as an event with a reason', () => {
  const match = cocsMatch('warfront');
  const actor = match.actors[0];
  actor.team = 0;
  place(match, actor, node(match, 'front-w'));
  const rejected = [];
  capture(match, 'cocs-order-rejected', rejected);
  match.step(DT, {cocs: {orders: [{tick: match.objectiveState.tick + 1, peerId: '0', cardId: 'bad', team: 0, verb: 'ATTACK', target: 'hq-1'}]}});
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].verb, 'ATTACK');
  assert.ok(typeof rejected[0].reason === 'string' && rejected[0].reason.length > 0);
  const view = cocsAnnouncement(rejected[0], {id: 0, team: 0});
  assert.match(view.text, /^ORDER REFUSED · /);
  assert.equal(view.kind, 'refused');
});

test('a refused intermission spend surfaces as an event', () => {
  const match = cocsMatch('lattice-slice', {mode: 'cocs-coop', humanCount: 4, botCount: 2});
  const rejected = [];
  capture(match, 'coop-spend-rejected', rejected);
  match.step(DT, {cocs: {spends: [{tick: match.objectiveState.tick + 1, peerId: '0', cardId: 's1', verb: 'FORTIFY', target: null}]}});
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'window-closed');
  assert.equal(rejected[0].verb, 'FORTIFY');
});

test('the objective-beat model distinguishes secured, lost, paid and refused', () => {
  const secured = cocsAnnouncement({type: 'cocs-capture', team: 0, node: 'front-0', label: 'West Bastion', reward: {op: 10, req: 8}, participants: [0]}, {id: 0, team: 0});
  assert.equal(secured.text, 'OBJECTIVE SECURED · WEST BASTION');
  assert.match(secured.detail, /\+10 OP/);
  assert.match(secured.detail, /\+8 REQ/);
  const lost = cocsAnnouncement({type: 'cocs-capture', team: 1, node: 'front-0', label: 'West Bastion', reward: {op: 10, req: 8}, participants: [3]}, {id: 0, team: 0});
  assert.equal(lost.text, 'OBJECTIVE LOST · WEST BASTION');
  assert.doesNotMatch(lost.detail, /REQ/);
  const paid = cocsAnnouncement({type: 'cocs-order-complete', team: 0, node: 'front-0', label: 'West Bastion', verb: 'HOLD', contributors: [0], teamOP: 20}, {id: 0, team: 0});
  assert.match(paid.text, /ORDER COMPLETE · WEST BASTION/);
  assert.match(paid.detail, /YOUR SQUAD PAID/);
  const refused = cocsAnnouncement({type: 'coop-spend-rejected', verb: 'FORTIFY', reason: 'window-closed'}, {id: 0, team: 0});
  assert.equal(refused.text, 'SPEND REFUSED · WINDOW CLOSED');
  assert.equal(cocsAnnouncement({type: 'damage'}, {id: 0, team: 0}), null);
});

test('announcer cues are reserved for completed beats and refusals', () => {
  assert.equal(latticeAnnounceCue({type: 'cocs-capture', participants: [0]}, 0), 'capture');
  assert.equal(latticeAnnounceCue({type: 'cocs-capture', participants: [4]}, 0), 'objective', 'losing a node is a neutral call');
  assert.equal(latticeAnnounceCue({type: 'cocs-order'}, 0), null, 'issuing an order stays silent');
  assert.equal(latticeAnnounceCue({type: 'cocs-order-complete'}, 0), 'objective');
  assert.equal(latticeAnnounceCue({type: 'cocs-order-rejected'}, 0), 'feint');
  assert.equal(latticeAnnounceCue({type: 'coop-spend-rejected'}, 0), 'feint');
  assert.equal(latticeAnnounceCue({type: 'director-siege'}, 0), 'boss');
  assert.equal(latticeAnnounceCue({type: 'damage'}, 0), null);
});
