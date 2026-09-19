import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {normalizeConfig, DEFAULT_CONFIG} from './config.mjs';
import {resolveMapForMode} from './arenas.mjs';
import {resolveLoadout} from './data.mjs';
import {cocsBoardView, cocsSpendView} from './cocs-orders.mjs';
import {cocsBoard} from './hud.mjs';
import {
  LOCAL_CARD_ACTION, LOCAL_CARD_SOURCE, hqSinkTarget, latticePeerId,
  localBoardCards, mergeLocalBoard, ownedSinkTargets, resolveSinkTarget, withSinkTargets,
} from './lattice-board.mjs';

const node = (id, owner, archetype, extra = {}) => ({id, label: id.toUpperCase(), owner, archetype, ...extra});

const snapshot = (overrides = {}) => ({
  tick: 120,
  nodes: [
    node('hq-0', 0, 'hq'),
    node('front-0', 0, 'front'),
    node('econ-n', 0, 'economy'),
    node('relay-0', null, 'relay'),
    node('front-1', 1, 'front'),
  ],
  flux: {0: 120, 1: 90},
  command: {humans: 1, threads: {used: 0, cap: 2}, slices: [{id: 0, allowance: 60, remaining: 60}]},
  roles: {threads: {used: 0, cap: 2}, byRole: {fighter: 1, scout: 0}},
  orderStats: {issued: 2, completed: 1, byVerb: {HOLD: 1, ATTACK: 1, SCAN: 0}},
  terminals: [{id: 'terminal-1', kind: 'HACK', label: 'RELAY', state: 'available', stateLabel: 'AVAILABLE', kindMark: '⌨'}],
  director: {intermission: {open: true, sinks: [
    {verb: 'FORTIFY', id: 'FORTIFY', label: 'FORTIFY', cost: 60, target: 'node', description: 'Harden a held node', available: true, affordable: true, enabled: true},
    {verb: 'RESUPPLY', id: 'RESUPPLY', label: 'RESUPPLY', cost: 35, target: 'team', description: 'Refill the team', available: true, affordable: true, enabled: true},
  ]}},
  ...overrides,
});

const viewBoard = () => ({
  front: {id: 'front-0', label: 'FRONT 0', mine: false, enemy: false, contested: false, progressPercent: 20, ownerLabel: 'NEUTRAL'},
  nodes: [
    {id: 'front-0', label: 'FRONT 0', mine: false, enemy: false, live: true, contested: false, progressPercent: 20},
    {id: 'econ-n', label: 'ECON N', mine: true, enemy: false, live: true, contested: false, progressPercent: 100},
  ],
  live: [
    {id: 'front-0', label: 'FRONT 0', mine: false, enemy: false, live: true, contested: false, progressPercent: 20},
    {id: 'econ-n', label: 'ECON N', mine: true, enemy: false, live: true, contested: false, progressPercent: 100},
    {id: 'front-1', label: 'FRONT 1', mine: false, enemy: true, live: true, contested: false, progressPercent: 100},
  ],
  myNodes: 1, enemyNodes: 1, hint: 'HOLD THE LATTICE',
});

test('latticePeerId sends the local actor id and never the literal human', () => {
  assert.equal(latticePeerId(null, {actors: [{id: 0, team: 0, bot: null}]}), '0');
  assert.equal(latticePeerId({started: false, peerId: 4}, {actors: [{id: 0, team: 0, bot: null}]}), '0', 'a connected but unstarted net client still uses the local actor');
  assert.equal(latticePeerId({started: true, peerId: 7}, {actors: [{id: 0, team: 0, bot: null}]}), '7');
  assert.equal(latticePeerId(null, null), '0', 'safe fallback for tests and warm-up');
  assert.notEqual(latticePeerId(null, {actors: [{id: 0, team: 0, bot: null}]}), 'human');
});

test('owned sink targets rank front, economy, relay and ignore the wrong owners', () => {
  const targets = ownedSinkTargets(snapshot(), {team: 0});
  assert.deepEqual(targets.map(target => target.id), ['front-0', 'econ-n']);
  assert.equal(ownedSinkTargets(snapshot(), {team: 1}).map(target => target.id).join(), 'front-1');
  assert.equal(hqSinkTarget(snapshot(), {team: 0}).id, 'hq-0');
  assert.equal(hqSinkTarget(snapshot(), {team: 1}), null, 'a team with no published HQ node has no hq target');
});

test('resolveSinkTarget names a concrete owned node or reports it missing', () => {
  const fortify = resolveSinkTarget({target: 'node'}, snapshot(), {team: 0});
  assert.equal(fortify.target, 'front-0');
  assert.equal(fortify.label, 'FRONT-0');
  assert.equal(fortify.missing, false);
  assert.equal(fortify.options.length, 2);
  const empty = resolveSinkTarget({target: 'node'}, snapshot({nodes: [node('hq-0', 0, 'hq')]}), {team: 0});
  assert.equal(empty.target, null);
  assert.equal(empty.missing, true, 'FORTIFY cannot be sent before a capturable node is held');
  const team = resolveSinkTarget({target: 'team'}, snapshot(), {team: 0});
  assert.equal(team.target, 'team');
  assert.equal(team.required, false);
});

test('withSinkTargets rewrites node sinks and disables them when no node is held', () => {
  const spend = withSinkTargets({open: true, sinks: [
    {id: 'FORTIFY', verb: 'FORTIFY', target: 'node', enabled: true, reason: null},
    {id: 'RESUPPLY', verb: 'RESUPPLY', target: 'team', enabled: true, reason: null},
  ]}, snapshot(), {team: 0});
  assert.equal(spend.sinks[0].target, 'front-0');
  assert.equal(spend.sinks[0].enabled, true);
  assert.equal(spend.sinks[0].targetOptions.length, 2);
  assert.equal(spend.sinks[1].target, 'team');
  const blocked = withSinkTargets({open: true, sinks: [{id: 'FORTIFY', verb: 'FORTIFY', target: 'node', enabled: true, reason: null}]}, snapshot({nodes: [node('hq-0', 0, 'hq')]}), {team: 0});
  assert.equal(blocked.sinks[0].enabled, false);
  assert.equal(blocked.sinks[0].reason, 'NO OWNED NODE');
});

test('localBoardCards is never empty and carries actionable order cards', () => {
  const cards = localBoardCards(viewBoard(), snapshot(), {team: 0}, {spend: withSinkTargets({sinks: snapshot().director.intermission.sinks}, snapshot(), {team: 0})});
  assert.ok(cards.length > 0, 'local board data always exists');
  const attack = cards.find(card => card.id === 'local-node-front-0');
  assert.ok(attack, 'a neutral live node becomes an ATTACK card');
  assert.equal(attack.source, LOCAL_CARD_SOURCE.ORDER);
  assert.equal(attack.action, LOCAL_CARD_ACTION.ISSUE);
  assert.equal(attack.target, 'front-0');
  const fortify = cards.find(card => card.id === 'local-sink-FORTIFY');
  assert.ok(fortify, 'intermission sinks appear on the board');
  assert.equal(fortify.target, 'front-0', 'the board spend card names a real node');
  assert.equal(fortify.action, LOCAL_CARD_ACTION.BUY);
  const terminal = cards.find(card => card.id === 'local-terminal-terminal-1');
  assert.equal(terminal.action, LOCAL_CARD_ACTION.CHECK);
  assert.ok(cards.find(card => card.id === 'local-orders'), 'orderStats surfaces as a status row');
  assert.ok(cards.find(card => card.id === 'local-threads'));
});

test('mergeLocalBoard keeps the board listbox populated and deduped', () => {
  const cards = localBoardCards(viewBoard(), snapshot(), {team: 0});
  const base = {
    widthPercent: 42, maxVisible: 8, cards: [], sections: [], visibleCards: [], visibleCount: 0,
    listboxIds: [], summary: {needsYou: 0, running: 0, done: 0, blocked: 0, chip: '⚠ 0 blocked · ▶ 0'},
  };
  const merged = mergeLocalBoard(base, cards);
  assert.ok(merged.cards.length > 0);
  assert.equal(merged.listboxIds.length, merged.visibleCards.length);
  assert.ok(merged.listboxIds.includes('local-node-front-0'));
  assert.equal(merged.summary.chip, `⚠ ${merged.summary.needsYou} blocked · ▶ ${merged.summary.running}`);
  const duplicate = mergeLocalBoard(merged, cards);
  assert.equal(duplicate.cards.length, merged.cards.length, 'merging twice adds nothing');
  const capped = mergeLocalBoard(base, cards, {maxVisible: 2});
  assert.ok(capped.sections.some(section => section.expandable));
  assert.equal(capped.visibleCards.length, 2);
});

test('a real fresh local snapshot produces a non-empty, mergeable board', () => {
  const loadout = resolveLoadout('chatgpt', 'openclaw');
  const config = normalizeConfig({...DEFAULT_CONFIG, mode: 'cocs-coop', botCount: 3, difficulty: 'normal', timeLimit: 900});
  const map = resolveMapForMode('lattice-slice', 'cocs-coop', {});
  const match = new Match(loadout.character, loadout.harness, Math.random, map, {...config, loadouts: {0: {character: loadout.character, harness: loadout.harness}}});
  if (match.objectiveState?.coop) match.objectiveState.coop.autoSpend = false;
  for (let i = 0; i < 240; i++) match.step(1 / 60, {inputs: {}});
  const snap = match.snapshot();
  const player = snap.cocs.actors?.[0] ?? {id: 0, team: 0, peerId: 0};
  const authority = cocsBoardView(cocsBoard(snap.cocs, player), snap.cocs, player);
  const local = localBoardCards(cocsBoard(snap.cocs, player), snap.cocs, player, {spend: cocsSpendView(snap.cocs, player)});
  const merged = mergeLocalBoard(authority, local);
  assert.ok(local.length > 0, 'a fresh Operations match has locally derivable cards');
  assert.ok(merged.listboxIds.length > 0, 'the board listbox is never empty');
  assert.ok(merged.cards.every(card => card.id && card.statusLabel), 'every card is renderable');
});
