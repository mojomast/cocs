// Fieldwork v8.6 — the LATTICE STRIKE team-FLUX purchase surface and the
// NEGLECT readout. These are pure views: the purchase cards gate on the same
// rung/THREADS/FLUX facts the sim and the room enforce, and the NEGLECT chip
// pairs the source number with a word and the passive-income multiplier.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cocsCommandView, cocsEconomyView, cocsPurchaseReason, cocsPurchaseView, cocsStripState} from './cocs-orders.mjs';
import {NEGLECT} from './cocs-economy.mjs';

const PVP_ALLOW = ['fighter', 'harvester', 'builder', 'scout', 'saboteur'];
const ROLE_COSTS = {fighter: 12, harvester: 8, builder: 10, saboteur: 14, scout: 7};

const roleBoard = (over = {}) => ({
  team: 0,
  rung: '8v8',
  allow: [...PVP_ALLOW],
  threads: {used: 0, cap: 3},
  agents: [],
  ...over,
});

const pvpSnapshot = (over = {}) => ({
  tick: 30,
  rung: '8v8',
  flux: {0: 80, 1: 80},
  neglect: {0: 0, 1: 0},
  roleBoard: {0: roleBoard(), 1: roleBoard({team: 1})},
  nodes: [
    {id: 'front-w', archetype: 'front', owner: null, live: true, label: 'FRONT-W'},
    {id: 'econ-e', archetype: 'economy', owner: 1, live: true, label: 'ECON-E'},
    {id: 'hq-0', archetype: 'hq', owner: 0, live: true, label: 'HQ'},
  ],
  ...over,
});

const board = () => ({
  nodes: [{id: 'front-w', label: 'FRONT-W', mark: '▲', ownerLabel: 'NEUTRAL', mine: false, enemy: false, contested: false, live: true}],
  live: [{id: 'front-w', label: 'FRONT-W', mark: '▲', ownerLabel: 'NEUTRAL', mine: false, enemy: false, contested: false, live: true}],
  front: {id: 'front-w', label: 'FRONT-W', mark: '▲', ownerLabel: 'NEUTRAL', mine: false, enemy: false, contested: false, live: true},
  hint: 'TAKE FRONT-W',
  liveCount: 1,
});

test('cocsPurchaseView is mode- and team-isolated', () => {
  assert.equal(cocsPurchaseView(null, {team: 0}), null, 'no snapshot, no view');
  assert.equal(cocsPurchaseView(pvpSnapshot(), {team: null}), null, 'a spectator has no team board');
  const coop = pvpSnapshot();
  delete coop.roleBoard;
  assert.equal(cocsPurchaseView(coop, {team: 0}), null, 'co-op / non-laddered cocs has no role board');
  assert.equal(cocsPurchaseReason('NO-THREAD'), 'NO THREAD');
  assert.equal(cocsPurchaseReason('FLUX-LOW'), 'FLUX LOW');
  assert.equal(cocsPurchaseReason(null), null);
});

test('the 8v8 board offers one REINFORCE per legal role plus SCAN with a real target', () => {
  const view = cocsPurchaseView(pvpSnapshot(), {team: 0});
  assert.equal(view.visible, true);
  assert.equal(view.rung, '8v8');
  assert.equal(view.flux, 80);
  assert.deepEqual(view.threads, {used: 0, cap: 3});
  assert.deepEqual(view.cards.map(card => card.id), ['reinforce-fighter', 'reinforce-harvester', 'reinforce-builder', 'reinforce-saboteur', 'scan-scout']);
  for (const card of view.cards) {
    assert.equal(card.enabled, true, `${card.id} is affordable and thread-free`);
    assert.equal(card.cost, ROLE_COSTS[card.role], `${card.id} carries the economy-table cost`);
    assert.equal(card.reason, null);
  }
  const scan = view.cards.at(-1);
  assert.equal(scan.verb, 'SCAN');
  assert.equal(scan.action, 'spawn');
  assert.equal(scan.role, 'scout');
  assert.equal(scan.target, 'econ-e', 'SCAN suggests an enemy live node');
  assert.equal(scan.targetLabel, 'ECON-E');
  assert.equal(view.canSpend, true);
});

test('the rung, THREADS and FLUX gates disable the cards with one named reason each', () => {
  const four = pvpSnapshot({rung: '4v4', roleBoard: {0: roleBoard({rung: '4v4', allow: ['fighter', 'harvester', 'builder']}), 1: roleBoard()}});
  const fourView = cocsPurchaseView(four, {team: 0});
  assert.deepEqual(fourView.cards.map(card => card.role), ['fighter', 'harvester', 'builder', 'scout']);
  const fourScan = fourView.cards.at(-1);
  assert.equal(fourScan.enabled, false);
  assert.equal(fourScan.reason, 'ROLE-LOCKED', '4v4 cannot field the SCOUT');

  const capped = pvpSnapshot({roleBoard: {0: roleBoard({threads: {used: 3, cap: 3}}), 1: roleBoard()}});
  const capView = cocsPurchaseView(capped, {team: 0});
  assert.ok(capView.cards.every(card => card.reason === 'NO-THREAD' && card.enabled === false));
  assert.equal(capView.canSpend, false);

  const broke = pvpSnapshot({flux: {0: 5, 1: 80}});
  const brokeView = cocsPurchaseView(broke, {team: 0});
  assert.ok(brokeView.cards.every(card => card.reason === 'FLUX-LOW' && card.enabled === false));

  const noNodes = pvpSnapshot({nodes: [{id: 'hq-0', archetype: 'hq', owner: 0, live: true, label: 'HQ'}]});
  const nodeView = cocsPurchaseView(noNodes, {team: 0});
  assert.equal(nodeView.cards.at(-1).reason, 'NO-TARGET', 'a fresh scout needs a live capturable node');
  assert.ok(nodeView.cards.filter(card => card.role !== 'scout').every(card => card.enabled), 'REINFORCE needs no node');
});

test('spectators get no purchase surface at all', () => {
  const view = cocsPurchaseView(pvpSnapshot(), {team: 0}, {spectate: true});
  assert.equal(view.visible, false);
  assert.equal(view.canSpend, false);
  assert.ok(view.cards.every(card => card.enabled === false && card.reason === 'SPECTATING'));
  const flagged = cocsPurchaseView(pvpSnapshot(), {team: 0, spectate: true});
  assert.equal(flagged.visible, false, 'the player flag alone hides the surface');
});

test('cocsEconomyView exposes NEGLECT as a word, a number and the passive multiplier', () => {
  const nominal = cocsEconomyView(pvpSnapshot({neglect: {0: 49, 1: 0}}), {team: 0});
  assert.equal(nominal.neglect.value, 49);
  assert.equal(nominal.neglect.tier, 'none');
  assert.equal(nominal.neglect.label, 'NOMINAL');
  assert.equal(nominal.neglect.multiplier, 1);
  const degraded = cocsEconomyView(pvpSnapshot({neglect: {0: 60, 1: 0}}), {team: 0});
  assert.equal(degraded.neglect.label, 'DEGRADED');
  assert.equal(degraded.neglect.multiplier, 0.9);
  const capped = cocsEconomyView(pvpSnapshot({neglect: {0: NEGLECT.max, 1: 0}}), {team: 0});
  assert.equal(capped.neglect.label, 'CAPPED');
  assert.equal(capped.neglect.multiplier, 0.8);
  assert.equal(capped.neglect.capped, true);
  const spectator = cocsEconomyView(pvpSnapshot({neglect: {0: 90, 1: 0}}), {team: null});
  assert.equal(spectator.neglect.value, 0, 'no team, no meter');
});

test('the purchase dispatch rides net.economy with the role, target and card id', async () => {
  const {NetClient} = await import('./net.mjs');
  const client = new NetClient();
  const sent = [];
  client.send = message => { sent.push(message); return true; };
  client.economy('reinforce', {cardId: 'spend-0-10-1', role: 'fighter'});
  client.economy('spawn', {cardId: 'spend-0-10-2', role: 'scout', target: 'front-e'});
  assert.equal(sent[0].type, 'economy');
  assert.equal(sent[0].action, 'reinforce');
  assert.equal(sent[0].role, 'fighter');
  assert.equal(sent[1].action, 'spawn');
  assert.equal(sent[1].role, 'scout');
  assert.equal(sent[1].target, 'front-e');
  assert.equal(client.cocsPending.size, 2, 'both purchases stay optimistic until the snapshot/reject answers');
});

test('cocsCommandView folds the purchase view into the command bag and stays co-op dark', () => {
  const command = cocsCommandView(board(), pvpSnapshot(), {team: 0}, cocsStripState());
  assert.ok(command.purchases, 'the purchase view rides the command bag');
  assert.equal(command.purchases.cards.length, 5);
  const coop = pvpSnapshot();
  delete coop.roleBoard;
  const coopCommand = cocsCommandView(board(), coop, {team: 0}, cocsStripState());
  assert.equal(coopCommand.purchases, null, 'co-op keeps no team-FLUX purchase strip');
  const spectate = cocsCommandView(board(), pvpSnapshot(), {team: 0}, cocsStripState(), {spectate: true});
  assert.equal(spectate.purchases.visible, false);
});
