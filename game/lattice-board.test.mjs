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
import {latticeTargetModel} from './lattice-guide.mjs';

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
  const model = latticeTargetModel(snap.cocs, match.arena, player);
  const local = localBoardCards(cocsBoard(snap.cocs, player), snap.cocs, player, {spend: cocsSpendView(snap.cocs, player), model});
  const merged = mergeLocalBoard(authority, local);
  assert.ok(local.length > 0, 'a fresh Operations match has locally derivable cards');
  assert.ok(merged.listboxIds.length > 0, 'the board listbox is never empty');
  assert.ok(merged.cards.every(card => card.id && card.statusLabel), 'every card is renderable');
  for (const card of local.filter(entry => entry.source === LOCAL_CARD_SOURCE.ORDER)) {
    const node = model.byId[card.target];
    assert.ok(node, `${card.id} names a model node`);
    assert.equal(node.legal, true, `${card.id} is legally adjacent`);
    assert.equal(node.attackable, true, `${card.id} is a capture/retake`);
    assert.doesNotMatch(card.targetLabel, /^(front|relay|econ|hq)-/, `${card.id} uses an authored label`);
  }
});

// ---------------------------------------------------------------------------
// F04 — legal adjacency, frontier retakes, authored labels and the siege slot.
// ---------------------------------------------------------------------------
const f04Map = {
  nodes: [
    {id: 'hq-0', x: 0, z: 0, r: 4, archetype: 'hq', label: 'West Command'},
    {id: 'front-0', x: -40, z: 0, r: 8, archetype: 'front', label: 'West Bastion'},
    {id: 'relay-0', x: 0, z: -30, r: 8, archetype: 'relay', label: 'Foundry Relay'},
    {id: 'front-1', x: 40, z: 0, r: 8, archetype: 'front', label: 'East Bastion'},
    {id: 'econ-x', x: 100, z: 0, r: 8, archetype: 'economy', label: 'Far Siphon'},
  ],
  lattice: [['hq-0', 'front-0'], ['hq-0', 'relay-0'], ['relay-0', 'front-1'], ['front-1', 'econ-x']],
};
const f04Board = () => ({nodes: [], live: [], front: null});
const f04Snapshot = ({front0 = null, front1 = 1, relay = 0, siege = null} = {}) => ({
  tick: 500,
  nodes: [
    {id: 'hq-0', owner: 0, archetype: 'hq', live: false, x: 0, z: 0, progress: [0, 0]},
    {id: 'front-0', owner: front0, archetype: 'front', live: true, x: -40, z: 0, progress: [0, 0], contested: false},
    {id: 'relay-0', owner: relay, archetype: 'relay', live: true, x: 0, z: -30, progress: [0, 0], contested: false},
    {id: 'front-1', owner: front1, archetype: 'front', live: true, x: 40, z: 0, progress: [0, 0], contested: false},
    {id: 'econ-x', owner: null, archetype: 'economy', live: true, x: 100, z: 0, progress: [0, 0], contested: false},
  ],
  director: siege ? {siege} : undefined,
});
const F04_PLAYER = {id: 0, team: 0, x: -36, z: 0};

test('F04 neutral cards require adjacency and enemy frontier nodes get a retake card', () => {
  const snapshot = f04Snapshot();
  const model = latticeTargetModel(snapshot, f04Map, F04_PLAYER);
  const cards = localBoardCards(f04Board(), snapshot, F04_PLAYER, {model});
  const capture = cards.find(card => card.id === 'local-node-front-0');
  assert.ok(capture, 'a neutral node adjacent to owned ground is capturable');
  assert.equal(capture.targetLabel, 'West Bastion', 'the card uses the authored label');
  assert.equal(capture.impact, 'CAPTURABLE · ADJACENT');
  assert.equal(capture.actionLabel, 'ISSUE CAPTURE');
  const retake = cards.find(card => card.id === 'local-node-front-1');
  assert.ok(retake, 'an enemy-owned frontier node gets an equivalent attack/retake card');
  assert.equal(retake.impact, 'ENEMY FRONTIER · RETAKABLE');
  assert.equal(retake.actionLabel, 'ISSUE RETAK');
  assert.ok(!cards.some(card => card.id === 'local-node-econ-x'), 'a neutral node with no owned neighbour is not offered');
  for (const card of cards.filter(entry => entry.source === LOCAL_CARD_SOURCE.ORDER && entry.id !== 'local-siege')) {
    const node = model.byId[card.target];
    assert.equal(node.legal, true, `${card.id} is a legal target`);
    assert.equal(node.reachable, true, `${card.id} has a ground route`);
  }
  assert.doesNotMatch(cards.map(card => card.targetLabel).join(' '), /front-0|econ-x/, 'no raw node ids in user copy');
});

test('F04 enemy recapture options remain when no neutral node exists', () => {
  const snapshot = f04Snapshot({front0: 1, relay: 0});
  const cards = localBoardCards(f04Board(), snapshot, F04_PLAYER, {map: f04Map});
  assert.ok(!cards.some(card => card.id === 'local-node-relay-0'), 'an owned node is never an attack card');
  const retakes = cards.filter(card => card.id.startsWith('local-node-') && card.actionLabel === 'ISSUE RETAK');
  assert.ok(retakes.length > 0, 'enemy frontier nodes stay retakeable with no neutral node on the map');
  assert.ok(retakes.every(card => card.targetLabel && !card.targetLabel.includes('-')), 'retake copy stays authored');
});

test('F04 an Operations HQ siege overrides and defers optional forward pushes', () => {
  const snapshot = f04Snapshot({siege: {armed: true, hqId: 'hq-0', health: 55, max: 100, attackers: 3, defenders: 1}});
  const cards = localBoardCards(f04Board(), snapshot, F04_PLAYER, {map: f04Map});
  assert.equal(cards[0].id, 'local-siege', 'the HQ defence card leads the board');
  assert.equal(cards[0].targetLabel, 'West Command');
  assert.equal(cards[0].actionLabel, 'DEFEND HQ');
  assert.match(cards[0].impact, /SIEGE · HQ 55%/);
  const forward = cards.find(card => card.id === 'local-node-front-0');
  assert.ok(forward, 'the optional push remains available');
  assert.equal(forward.siegeDeferred, true);
  assert.equal(forward.impact, 'DEFERRED · SIEGE AT West Command');
  const lifted = localBoardCards(f04Board(), f04Snapshot(), F04_PLAYER, {map: f04Map});
  assert.ok(!lifted.some(card => card.id === 'local-siege'), 'a lifted siege removes the override');
  assert.match(lifted.find(card => card.id === 'local-node-front-0').impact, /^CAPTURABLE/);
});
