import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {cocsAnnouncement,latticeAnnounceCue,acceptCocsAnnouncement,cocsAnnouncePriority,cocsAnnouncementTTL,COCS_ANNOUNCE_PRIORITY} from './hud.mjs';

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
  const lost = cocsAnnouncement({type: 'cocs-capture', team: 1, node: 'front-0', label: 'West Bastion', previousOwner: 0, reward: {op: 10, req: 8}, participants: [3]}, {id: 0, team: 0});
  assert.equal(lost.text, 'OBJECTIVE LOST · WEST BASTION');
  assert.equal(lost.mine, false, 'relevance is not friendly ownership');
  assert.equal(lost.relevance, 'enemy');
  assert.doesNotMatch(lost.detail, /REQ/);
  const taken = cocsAnnouncement({type: 'cocs-capture', team: 1, node: 'front-0', label: 'West Bastion', reward: {op: 10, req: 8}, participants: [3]}, {id: 0, team: 0});
  assert.equal(taken.text, 'ENEMY SECURED · WEST BASTION', 'an absent previous owner reads neutral, never a friendly loss');
  assert.match(taken.detail, /NEUTRAL NODE/);
  assert.equal(taken.kind, 'capture');
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

test('a real neutral take and a real recapture carry previousOwner through the event', () => {
  const match = cocsMatch('lattice-slice', {humanCount: 2, botCount: 0});
  const state = match.objectiveState;
  const front0 = node(match, 'front-0'), front1 = node(match, 'front-1'), relay = node(match, 'relay-0');
  front0.owner = 0; front1.owner = 1;
  const [ally, enemy] = match.actors;
  ally.team = 0; enemy.team = 1;
  const captures = [];
  capture(match, 'cocs-capture', captures);
  place(match, ally, relay);
  place(match, enemy, {x: 1000, z: 1000, y: 0});
  for (let i = 0; i < 60 * 15 && captures.length < 1; i++) match.step(DT, {});
  assert.equal(captures.length, 1, 'the neutral relay falls to the local team');
  assert.equal(captures[0].team, 0);
  assert.equal(captures[0].previousOwner, null, 'the first capture of a neutral node says neutral');
  assert.equal(cocsAnnouncement(captures[0], {id: ally.id, team: 0}).text, 'OBJECTIVE SECURED · FOUNDRY RELAY');
  // The enemy recaptures the same node: previousOwner now names the losing team.
  place(match, ally, {x: 1000, z: 1000, y: 0});
  place(match, enemy, relay);
  for (let i = 0; i < 60 * 15 && captures.length < 2; i++) match.step(DT, {});
  assert.equal(captures.length, 2, 'the enemy retakes the relay');
  assert.equal(captures[1].team, 1);
  assert.equal(captures[1].previousOwner, 0, 'the capture event names the team that lost the node');
  const lost = cocsAnnouncement(captures[1], {id: ally.id, team: 0});
  assert.equal(lost.text, 'OBJECTIVE LOST · FOUNDRY RELAY');
  assert.equal(lost.mine, false);
  const enemyView = cocsAnnouncement(captures[1], {id: enemy.id, team: 1});
  assert.equal(enemyView.text, 'OBJECTIVE SECURED · FOUNDRY RELAY');
  assert.equal(enemyView.mine, true);
});

test('teamless wave and siege beats are the player mission beats, not discarded', () => {
  const wave = cocsAnnouncement({type: 'director-wave-cleared', wave: 2, cleared: 2, waveCount: 5}, {id: 0, team: 0});
  assert.equal(wave.kind, 'wave');
  assert.equal(wave.mine, true, 'the Director never clears a wave, so this is the player team beat');
  assert.equal(wave.relevance, 'friendly');
  assert.equal(wave.text, 'WAVE 2 CLEARED');
  assert.match(wave.detail, /WAVES 2\/5/);
  const siege = cocsAnnouncement({type: 'director-siege', wave: 2, hq: 'hq-0'}, {id: 0, team: 0});
  assert.equal(siege.kind, 'siege');
  assert.equal(siege.text, 'HQ UNDER SIEGE');
  assert.equal(cocsAnnouncePriority(siege), COCS_ANNOUNCE_PRIORITY.siege);
  const lifted = cocsAnnouncement({type: 'director-siege-lifted', wave: 2}, {id: 0, team: 0});
  assert.ok(cocsAnnouncePriority(lifted) > cocsAnnouncePriority(siege), 'the lift resolves the siege banner');
});

test('opponent-private orders and spend refusals never become a networked beat', () => {
  const enemyOrder = cocsAnnouncement({type: 'cocs-order', team: 1, verb: 'ATTACK', node: 'front-0', label: 'West Bastion'}, {id: 0, team: 0});
  assert.equal(enemyOrder, null);
  const enemyComplete = cocsAnnouncement({type: 'cocs-order-complete', team: 1, node: 'front-0', label: 'West Bastion', contributors: [3], teamOP: 20}, {id: 0, team: 0});
  assert.equal(enemyComplete, null);
  const enemyRefusal = cocsAnnouncement({type: 'cocs-order-rejected', team: 1, verb: 'ATTACK', node: 'hq-0', reason: 'illegal-target'}, {id: 0, team: 0});
  assert.equal(enemyRefusal, null);
  const ownRefusal = cocsAnnouncement({type: 'coop-spend-rejected', verb: 'FORTIFY', reason: 'window-closed'}, {id: 0, team: 0});
  assert.equal(ownRefusal.text, 'SPEND REFUSED · WINDOW CLOSED');
});

test('a routine beat cannot replace an urgent siege or capture loss before it expires', () => {
  const player = {id: 0, team: 0};
  const siege = cocsAnnouncement({type: 'director-siege', wave: 2, hq: 'hq-0'}, player);
  const order = cocsAnnouncement({type: 'cocs-order-complete', team: 0, node: 'front-0', label: 'West Bastion', contributors: [0], teamOP: 20}, player);
  const shown = acceptCocsAnnouncement(null, -10, siege, 10);
  assert.equal(shown.cue, siege);
  assert.equal(shown.at, 10);
  assert.equal(acceptCocsAnnouncement(shown.cue, shown.at, order, 10.25), null, 'a routine order is absorbed by the siege banner');
  // The lift outranks the siege; a loss outranks a secured node.
  const lifted = cocsAnnouncement({type: 'director-siege-lifted', wave: 2}, player);
  assert.equal(acceptCocsAnnouncement(shown.cue, shown.at, lifted, 10.5).cue, lifted);
  const loss = cocsAnnouncement({type: 'cocs-capture', team: 1, node: 'front-0', label: 'West Bastion', previousOwner: 0, reward: {op: 10}, participants: [3]}, player);
  assert.equal(acceptCocsAnnouncement(null, -10, loss, 10).cue, loss);
  assert.equal(acceptCocsAnnouncement(acceptCocsAnnouncement(null, -10, lifted, 10).cue, 10, loss, 10.4), null, 'a lower rank cannot displace the fresh lift');
  // Dedup: the same event cannot double-fire while its banner is live.
  const first = acceptCocsAnnouncement(null, -10, siege, 20);
  assert.equal(acceptCocsAnnouncement(first.cue, first.at, cocsAnnouncement({type: 'director-siege', wave: 2, hq: 'hq-0'}, player), 20.5), null);
  // Equal rank with a different key still updates (a second node falls).
  const otherLoss = cocsAnnouncement({type: 'cocs-capture', team: 1, node: 'front-1', label: 'East Bastion', previousOwner: 0, reward: {op: 10}, participants: [3]}, player);
  const liveLoss = acceptCocsAnnouncement(null, -10, loss, 21);
  assert.equal(acceptCocsAnnouncement(liveLoss.cue, liveLoss.at, otherLoss, 21.2).cue, otherLoss);
  // Stale banners expire on their own TTL.
  assert.ok(cocsAnnouncementTTL(loss) > cocsAnnouncementTTL(order));
  assert.equal(acceptCocsAnnouncement(liveLoss.cue, liveLoss.at, order, 21.2 + cocsAnnouncementTTL(loss) + .1).cue, order, 'an expired cue never blocks');
  assert.equal(acceptCocsAnnouncement(liveLoss.cue, liveLoss.at, order, 21.2), null);
});

test('a later capture-loss replaces an equally urgent capture-loss but not a siege', () => {
  const player = {id: 0, team: 0};
  const capture = cocsAnnouncement({type: 'cocs-capture', team: 1, node: 'front-0', label: 'West Bastion', previousOwner: 0, reward: {op: 10}, participants: [3]}, player);
  const wave = cocsAnnouncement({type: 'director-wave-cleared', wave: 3, cleared: 3, waveCount: 5}, player);
  const live = acceptCocsAnnouncement(null, -10, capture, 30);
  assert.equal(acceptCocsAnnouncement(live.cue, live.at, wave, 30.5), null, 'a wave clear is routine beside a lost node');
  const siege = cocsAnnouncement({type: 'director-siege', wave: 3, hq: 'hq-0'}, player);
  const siegeLive = acceptCocsAnnouncement(null, -10, siege, 31);
  assert.equal(acceptCocsAnnouncement(siegeLive.cue, siegeLive.at, capture, 31.2), null, 'a fresh siege survives a capture loss');
  assert.equal(acceptCocsAnnouncement(null, -10, {kind: 'capture', text: 'OLD'}, 30).cue.text, 'OLD');
  assert.deepEqual(acceptCocsAnnouncement(null, -10, null, 30), null);
});
