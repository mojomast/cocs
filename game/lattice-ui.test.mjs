// LATTICE V0a HUD + mode-entry surface. Kept in one file so the merge with the
// cocs core wave only has to reconcile the three source modules, never shared
// test files. Covers: mode/map plumbing, a local bot match on the slice, the
// cocs HUD readout, the in-world node markers and the radar ownership blips.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from 'three';
import {cocsBoard,cocsArchetypeLabel,cocsArchetypeMark,cocsResultSummary,commandBrief,objectiveCopy,modeTargetText,modeGoal,scoreAnnouncer} from './hud.mjs';
import {COCS_SCAN_COST,cocsArmVerb,cocsClearStrip,cocsCommandView,cocsDirectorView,cocsEconomyView,cocsIssueOrder,cocsPickTarget,cocsSpotView,cocsStripState,cocsStripView,cocsSyncStrip,cocsTargetableNodes} from './cocs-orders.mjs';
import {GAME_MODES} from './config.mjs';
import {mapsForMode,resolveMapForMode,arenaSupportsMode,maxBotsFor,recommendedBots} from './arenas.mjs';
import {radarBlip,radarContacts} from './radar.mjs';
import {Match} from './core.mjs';
import {ArenaView} from './view.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';
import {MAPS} from './maps.mjs';

const modeById = id => GAME_MODES.find(mode => mode.id === id);
const arena = MAPS.find(map => map.id === 'lattice-slice');

const sampleHud = () => ({
  overReason: 'dominance',
  objectives: {kind: 'cocs'},
  cocs: {
    nodes: [
      {id: 'hq-0', x: -108, z: 0, archetype: 'hq', owner: 0, progress: [0, 0], contested: false, live: false},
      {id: 'front-0', x: -54, z: 0, archetype: 'front', owner: 0, progress: [0, 0], contested: false, live: true},
      {id: 'relay-0', x: 0, z: 0, archetype: 'relay', owner: null, progress: [0.6, 0.1], contested: false, live: true},
      {id: 'front-1', x: 54, z: 0, archetype: 'front', owner: 1, progress: [0, 0], contested: true, live: true},
    ],
    scores: {0: 42.5, 1: 30},
    liveNodeIds: ['front-0', 'relay-0', 'front-1'],
    winner: null,
  },
});

test('lattice strike is registered as a preview mode on the slice map', () => {
  const mode = modeById('cocs');
  assert.ok(mode, 'cocs mode row exists');
  assert.equal(mode.name, 'Lattice Strike');
  assert.equal(mode.rules.score, 'cocs');
  assert.equal(mode.rules.objective.kind, 'cocs');
  assert.equal(modeGoal(mode), 'LATTICE CONTROL');
  assert.equal(modeTargetText(mode), 'HOLD THE LATTICE');
  assert.ok(objectiveCopy('cocs') && objectiveCopy('cocs').length > 0, 'setup copy explains the lattice');

  // The V0a slice is the only arena advertising cocs, and an incompatible
  // arena repairs onto it for a one-click local start.
  assert.deepEqual(mapsForMode('cocs').map(map => map.id), ['lattice-slice']);
  assert.equal(arenaSupportsMode('lattice-slice', 'cocs'), true);
  assert.equal(arenaSupportsMode('exchange', 'cocs'), false);
  assert.equal(resolveMapForMode('colosseum', 'cocs'), 'lattice-slice');
  assert.equal(maxBotsFor('cocs'), 8);
  assert.equal(recommendedBots('cocs', 'lattice-slice'), 8);
});

test('a local cocs bot match starts on the slice and steps the lattice', () => {
  const match = new Match('chatgpt', 'openclaw', () => 0.5, 'lattice-slice', {mode: 'cocs', botCount: 3, humanCount: 1, timeLimit: 120});
  assert.equal(match.arena.id, 'lattice-slice');
  assert.equal(match.config.mode, 'cocs');
  assert.equal(match.objectiveState.kind, 'cocs');
  assert.ok(match.objectiveState.nodes.length >= 5, 'the slice authors a live lattice');
  assert.ok(match.objectiveState.nodes.some(node => node.archetype === 'hq'), 'HQ anchors exist');
  for (let i = 0; i < 180; i++) match.step(1 / 60, {inputs: {}});
  const snapshot = match.snapshot();
  assert.ok(snapshot.cocs, 'the snapshot carries the frozen cocs subtree');
  assert.ok(snapshot.cocs.nodes.length === match.objectiveState.nodes.length);
  assert.ok(Array.isArray(snapshot.cocs.liveNodeIds) && snapshot.cocs.liveNodeIds.length >= 3);
  assert.ok(Number.isFinite(snapshot.cocs.scores[0]) && Number.isFinite(snapshot.cocs.scores[1]));
});

test('cocsBoard derives the front line, OP score and capture hint from the snapshot', () => {
  const hud = sampleHud();
  const board = cocsBoard(hud, {team: 0});
  assert.equal(board.team, 0);
  assert.equal(board.liveCount, 3);
  assert.deepEqual(board.owned, {0: 2, 1: 1});
  assert.equal(board.myNodes, 2);
  assert.equal(board.enemyNodes, 1);
  assert.equal(board.contestedCount, 1);
  assert.equal(board.scores[0], 42.5);
  assert.equal(board.leader, 0);
  assert.equal(board.front.id, 'relay-0', 'the live node under the most pressure is the front');
  assert.equal(board.front.progressPercent, 60);
  assert.equal(board.hint, 'CAPTURING RELAY · 60%');
  assert.deepEqual(board.live.map(node => node.id), ['front-0', 'relay-0', 'front-1']);
  const relay = board.nodes.find(node => node.id === 'relay-0');
  assert.equal(relay.label, 'RELAY');
  assert.equal(relay.ownerLabel, 'NEUTRAL');
  assert.equal(relay.mark, cocsArchetypeMark('relay'));
  // Every node carries both a shape glyph and a word, never colour alone.
  for (const node of board.nodes) {
    assert.ok(node.label.length > 0, `${node.id} label`);
    assert.ok(node.mark.length > 0, `${node.id} mark`);
    assert.ok(node.ownerLabel.length > 0, `${node.id} owner text`);
  }
  assert.equal(cocsArchetypeLabel('economy'), 'ECON');
  assert.equal(cocsArchetypeLabel('unknown'), 'NODE');
  assert.equal(cocsArchetypeMark('array'), '⬣');
  assert.equal(cocsArchetypeMark('unknown'), '●');
});

test('cocsBoard is spectator-safe and stays empty for other modes', () => {
  const spectator = cocsBoard(sampleHud(), null);
  assert.equal(spectator.team, null);
  assert.equal(spectator.myNodes, null);
  assert.equal(spectator.myScore, null);
  assert.equal(spectator.enemyScore, null);
  assert.equal(spectator.liveCount, 3);
  const other = cocsBoard({cocs: null, objectives: {kind: 'koth'}}, {team: 0});
  assert.equal(other.liveCount, 0);
  assert.equal(other.front, null);
  assert.equal(other.hint, 'CAPTURE A NODE ADJACENT TO ONE YOU OWN');
});

test('commandBrief and the result summary read the cocs snapshot', () => {
  const hud = sampleHud();
  const brief = commandBrief(hud, {team: 0}, modeById('cocs'));
  assert.equal(brief.title, 'BREAK THE LATTICE', 'a contested lattice reads as pressure');
  assert.ok(brief.detail.includes('42.5 OP'), brief.detail);
  assert.ok(brief.detail.includes('2 NODES'), brief.detail);
  assert.ok(brief.detail.includes('3 LIVE'), brief.detail);
  assert.ok(brief.status.includes('CONTESTED'), brief.status);
  const summary = cocsResultSummary({...hud, winner: 1}, {team: 0});
  assert.ok(summary.startsWith('The enemy took the lattice'), summary);
  assert.ok(summary.includes('dominance timer'), summary);
  assert.ok(summary.includes('RED 42.5'), summary);
  assert.equal(cocsResultSummary({objectives: {kind: 'koth'}}, {team: 0}), null);
});

test('the continuous cocs OP score does not spam the generic announcer', () => {
  assert.equal(scoreAnnouncer({teamScores: {0: 12.4, 1: 9}, config: {mode: 'cocs'}}, {0: 11.9, 1: 9}), null);
  assert.deepEqual(scoreAnnouncer({teamScores: {0: 2, 1: 1}, config: {mode: 'teamdeathmatch'}}, {0: 1, 1: 1}), {team: 0, kind: 'score', text: 'RED SCORES', score: 2, amount: 1});
});

test('the radar dial shows real lattice ownership instead of anonymous zones', () => {
  const hud = sampleHud();
  hud.actors = [];
  const player = {id: 0, team: 0, x: 0, z: 0, yaw: 0};
  const {contacts} = radarContacts(hud, player, {range: 400});
  const byId = id => contacts.find(contact => contact.id === id);
  assert.ok(byId('front-0'), 'owned node is on the dial');
  assert.equal(byId('front-0').owner, 0);
  assert.equal(byId('relay-0').owner, null);
  assert.equal(byId('relay-0').progress, 60);
  assert.equal(byId('front-1').contested, true);
});

const markerView = software => Object.assign(Object.create(ArenaView.prototype), {
  scene: new T.Scene(), worldGroup: new T.Group(), objectiveModels: new Map(),
  motionQuery: {matches: false}, renderer: {isSoftware: software}, display: {...DEFAULT_DISPLAY},
});

const cocsState = () => ({kind: 'cocs', nodes: [
  {id: 'hq-0', x: -108, y: 0, z: 0, r: 12, archetype: 'hq', owner: 0, progress: [0, 0], contested: false, live: false},
  {id: 'front-0', x: -54, y: 0, z: 0, r: 10, archetype: 'front', owner: 0, progress: [0, 0], contested: false, live: true},
  {id: 'econ-0', x: 0, y: 0, z: 40, r: 10, archetype: 'economy', owner: null, progress: [0, 0], contested: false, live: false},
  {id: 'relay-0', x: 0, y: 0, z: 0, r: 10, archetype: 'relay', owner: null, progress: [0.6, 0.1], contested: false, live: true},
  {id: 'front-1', x: 54, y: 0, z: 0, r: 10, archetype: 'front', owner: 1, progress: [0, 0], contested: true, live: true},
  {id: 'array-e', x: 119, y: 0, z: 0, r: 3, archetype: 'array', owner: 1, progress: [0, 0], contested: false, live: false},
]});

test('cocs node markers render by archetype and owner on WebGL and software', () => {
  for (const software of [false, true]) {
    const view = markerView(software);
    view.updateObjectives({time: 2, objectiveState: cocsState()}, arena);
    assert.equal(view.objectiveModels.size, 6);
    assert.equal(view.worldGroup.children.length, 6, 'every node has a world marker');
    const shapes = {front: 'ConeGeometry', economy: 'BoxGeometry', relay: 'OctahedronGeometry', array: 'IcosahedronGeometry', hq: 'CylinderGeometry'};
    for (const [id, archetype] of [['front-0', 'front'], ['econ-0', 'economy'], ['relay-0', 'relay'], ['array-e', 'array'], ['hq-0', 'hq']]) {
      const model = view.objectiveModels.get(id);
      assert.equal(model.userData.cocsArchetype, archetype, `${id} archetype`);
      assert.equal(model.userData.emblem.geometry.type, shapes[archetype], `${id} emblem shape`);
      assert.equal(model.userData.cocsNode, true);
      assert.equal(model.userData.identifier, id);
    }
    // Owner tint, archetype tint for neutrals, amber for contested.
    assert.equal(view.objectiveModels.get('front-0').userData.baseMat.color.getHexString(), 'ed514b', 'owned node uses the team colour');
    assert.equal(view.objectiveModels.get('relay-0').userData.baseMat.color.getHexString(), 'bf9cff', 'neutral relay uses its archetype tint');
    assert.equal(view.objectiveModels.get('relay-0').userData.progressValue, 60);
    assert.equal(view.objectiveModels.get('front-1').userData.baseMat.color.getHexString(), 'ffd166', 'contested node is amber');
    // Not-live capturable nodes dim; live nodes and anchors keep the beacon.
    assert.equal(view.objectiveModels.get('econ-0').userData.baseMat.opacity, 0.38);
    assert.equal(view.objectiveModels.get('econ-0').userData.beacon.visible, false);
    assert.equal(view.objectiveModels.get('relay-0').userData.beacon.visible, true);
    assert.equal(view.objectiveModels.get('hq-0').userData.beacon.visible, true);
    assert.equal(view.objectiveModels.get('hq-0').userData.baseMat.opacity, 1);
  }
});

test('cocs markers prune stale nodes and clear on a mode switch', () => {
  const view = markerView(true);
  view.updateObjectives({time: 2, objectiveState: cocsState()}, arena);
  const stale = view.objectiveModels.get('relay-0'), disposed = [0];
  stale.userData.area.geometry.addEventListener('dispose', () => disposed[0]++);
  view.updateObjectives({time: 3, objectiveState: {kind: 'cocs', nodes: cocsState().nodes.slice(0, 1)}}, arena);
  assert.equal(view.objectiveModels.size, 1);
  assert.equal(view.worldGroup.children.length, 1);
  assert.equal(disposed[0], 1, 'the removed node disposes its geometry');
  view.updateObjectives({time: 4, objectives: {kind: 'koth', zones: []}}, arena);
  assert.equal(view.objectiveModels.size, 0);
  assert.equal(view.worldGroup.children.length, 0);
});

// ---------------------------------------------------------------------------
// V0b order strip + economy readout + SPOT presentation.
// ---------------------------------------------------------------------------
const economyHud = () => {
  const hud = sampleHud();
  Object.assign(hud.cocs, {
    tick: 100,
    flux: {0: 120.5, 1: 64},
    fluxCap: 240,
    fluxIncome: {0: 2, 1: 3},
    fluxUpkeep: {0: 0.42, 1: 0},
    fluxSpent: {0: 7, 1: 0},
    req: [{id: 0, req: 32.5, earned: 45, spent: 12.5}, {id: 1, req: 3, earned: 3, spent: 0}],
    scouts: [{id: 9, team: 0, node: 'relay-0', x: -2, z: 1, scanned: false, returning: false, idle: false, expireTick: 5400}],
    scoutStats: {0: {spawned: 2, killed: 1, expired: 1, scans: 3}, 1: {spawned: 0, killed: 0, expired: 0, scans: 0}},
    spots: [
      {id: 1, team: 0, until: 130, x: -50, z: 0, by: 9},
      {id: 2, team: 0, until: 80, x: 0, z: 0, by: 9},
      {id: 3, team: 1, until: 130, x: 50, z: 0, by: 9},
    ],
    scans: {0: 'relay-0', 1: null},
    orderStats: {issued: 5, completed: 2, byVerb: {HOLD: 1, ATTACK: 3, SCAN: 1}},
    scoutCap: 1,
    scanRadius: 12,
    spotSeconds: 8,
    spotBonus: 0.15,
  });
  return hud;
};

test('the V0b order strip arms a verb, picks a target and issues the engine verb', () => {
  const board = cocsBoard(economyHud(), {team: 0});
  assert.deepEqual(cocsTargetableNodes(board, null), []);
  let strip = cocsStripState();
  // GO collapses onto the engine's HOLD verb and toggles off when re-armed.
  strip = cocsArmVerb(strip, 'GO');
  assert.equal(strip.armed, 'GO');
  assert.equal(cocsArmVerb(strip, 'GO').armed, null, 're-arming disarms the strip');
  const goNodes = cocsTargetableNodes(board, strip.armed);
  const owned = goNodes.find(node => node.mine === true);
  assert.ok(owned, 'an owned node is a legal GO target');
  strip = cocsPickTarget(strip, owned.id, goNodes);
  assert.equal(strip.target, owned.id);
  const view = cocsStripView(strip, {tick: 100, flux: 120, nodes: goNodes});
  assert.equal(view.canIssue, true);
  assert.equal(view.armedLabel, 'GO');
  assert.equal(view.targetLabel, owned.label);
  const issued = cocsIssueOrder(strip, {tick: 100, peerId: 'me', team: 0, flux: 120});
  assert.equal(issued.order.verb, 'HOLD', 'GO maps to HOLD on the wire');
  assert.equal(issued.order.target, owned.id);
  assert.ok(issued.order.cardId.length > 0);
  assert.equal(issued.state.pending.verb, 'HOLD');
  assert.equal(issued.state.armed, null, 'issuing disarms');
  const pendingView = cocsStripView(issued.state, {tick: 100, flux: 120, nodes: goNodes, nodeLabels: {[owned.id]: {label: owned.label, mark: owned.mark}}});
  assert.equal(pendingView.pending.verb, 'HOLD');
  assert.equal(pendingView.pending.target, owned.id);
  assert.ok(pendingView.pending.text.includes(owned.label));
  const filed = cocsSyncStrip(issued.state, {tick: 100 + 121});
  assert.ok(filed.issued, 'the pending order files as issued');
  assert.equal(filed.pending, null);
  // Picking and issuing with no verb armed is a safe no-op.
  const blank = cocsIssueOrder(cocsStripState(), {tick: 0, team: 0, flux: 80});
  assert.equal(blank.order, null);
  assert.equal(blank.state.notice, 'ARM A VERB');
});

test('SCAN is disabled and rejected while FLUX is below the scout cost', () => {
  const board = cocsBoard(economyHud(), {team: 0});
  let strip = cocsArmVerb(cocsStripState(), 'SCAN');
  const nodes = cocsTargetableNodes(board, 'SCAN');
  strip = cocsPickTarget(strip, nodes[0].id, nodes);
  assert.equal(strip.target, nodes[0].id);
  const poor = cocsStripView(strip, {tick: 0, flux: COCS_SCAN_COST - 1, nodes, scanCost: COCS_SCAN_COST});
  const scanButton = poor.buttons.find(button => button.id === 'SCAN');
  assert.equal(scanButton.disabled, true);
  assert.equal(scanButton.reason, 'FLUX LOW');
  assert.equal(poor.canIssue, false);
  const rejected = cocsIssueOrder(strip, {tick: 0, team: 0, flux: COCS_SCAN_COST - 1});
  assert.equal(rejected.order, null);
  assert.equal(rejected.state.notice, 'FLUX LOW');
  const issued = cocsIssueOrder(strip, {tick: 0, team: 0, flux: COCS_SCAN_COST});
  assert.equal(issued.order.verb, 'SCAN');
  assert.equal(issued.order.target, nodes[0].id);
  assert.equal(COCS_SCAN_COST, 7, '§8.1 scout spawn cost');
});

test('the strip blocks a second issue inside the cooldown window', () => {
  const board = cocsBoard(economyHud(), {team: 0});
  const attackNodes = cocsTargetableNodes(board, 'ATTACK');
  assert.ok(attackNodes.length > 0);
  assert.equal(attackNodes.every(node => node.mine !== true), true, 'ATTACK never targets a node you own');
  const target = attackNodes[0].id;
  let strip = cocsPickTarget(cocsArmVerb(cocsStripState(), 'ATTACK'), target, attackNodes);
  const first = cocsIssueOrder(strip, {tick: 10, team: 0, flux: 80});
  assert.ok(first.order);
  strip = cocsPickTarget(cocsArmVerb(first.state, 'ATTACK'), target, cocsTargetableNodes(board, 'ATTACK'));
  const second = cocsIssueOrder(strip, {tick: 11, team: 0, flux: 80});
  assert.equal(second.order, null);
  assert.equal(second.state.notice, 'COOLDOWN');
  const later = cocsIssueOrder(strip, {tick: 100, team: 0, flux: 80});
  assert.ok(later.order, 'the cooldown expires on the tick clock');
  // A cleared strip drops the armed verb and target.
  const cleared = cocsClearStrip(strip);
  assert.equal(cleared.armed, null);
  assert.equal(cleared.target, null);
});

test('cocsTargetableNodes narrows by verb and the command view is mode-isolated', () => {
  const hud = economyHud();
  const board = cocsBoard(hud, {team: 0});
  const scan = cocsTargetableNodes(board, 'SCAN').map(node => node.id);
  const hold = cocsTargetableNodes(board, 'GO').map(node => node.id);
  const attack = cocsTargetableNodes(board, 'ATTACK').map(node => node.id);
  assert.deepEqual(scan, ['front-0', 'relay-0', 'front-1'], 'SCAN lists every capturable node');
  assert.ok(hold.includes('front-0'), 'GO keeps your own nodes');
  assert.equal(attack.includes('front-0'), false, 'ATTACK drops your own nodes');
  assert.ok(cocsTargetableNodes(board, 'SCAN').every(node => node.archetype !== 'hq'), 'HQ is never a strip target');
  assert.equal(cocsCommandView(null, hud.cocs, {team: 0}, cocsStripState()), null);
  assert.equal(cocsCommandView(board, null, {team: 0}, cocsStripState()), null);
  const command = cocsCommandView(board, hud.cocs, {team: 0}, cocsStripState());
  assert.ok(command);
  assert.equal(command.scanTarget.nodeId, 'relay-0');
  assert.equal(command.scanTarget.label, 'RELAY');
  assert.deepEqual(command.strip.buttons.map(button => button.label), ['SCAN', 'GO', 'ATTACK']);
  assert.equal(command.spots.length, 1, 'only the live friendly mark at tick 100');
});

test('cocsEconomyView reads the FLUX bar, REQ chip, order tally and scout card', () => {
  const hud = economyHud();
  const money = cocsEconomyView(hud.cocs, {id: 0, team: 0});
  assert.equal(money.team, 0);
  assert.equal(money.flux, 120.5);
  assert.equal(money.fluxCap, 240);
  assert.equal(money.income, 2);
  assert.equal(money.upkeep, 0.42);
  assert.equal(money.net, 1.58);
  assert.equal(money.spent, 7);
  assert.equal(money.req.value, 32.5);
  assert.equal(money.orders.issued, 5);
  assert.equal(money.orders.completed, 2);
  assert.deepEqual(money.orders.byVerb, {HOLD: 1, ATTACK: 3, SCAN: 1});
  assert.equal(money.scout.alive, true);
  assert.equal(money.scout.node, 'relay-0');
  assert.equal(money.scoutStats.scans, 3);
  assert.equal(money.scan.nodeId, 'relay-0');
  assert.equal(money.spotCount, 1);
  assert.equal(money.spotBonus, 0.15);
  assert.equal(cocsEconomyView(null, {team: 0}), null);
  const spectator = cocsEconomyView(hud.cocs, {team: null});
  assert.equal(spectator.team, null);
  assert.equal(spectator.flux, 0);
  assert.equal(spectator.req.value, 0);
});

test('cocsSpotView ages SPOT marks against the sim tick and drops expired ones', () => {
  const spots = cocsSpotView(economyHud().cocs, 0);
  assert.equal(spots.length, 1);
  assert.equal(spots[0].id, 1);
  assert.equal(spots[0].remainingSeconds, 0.5);
  assert.equal(spots[0].by, 9);
  const later = cocsSpotView({...economyHud().cocs, tick: 200}, 0);
  assert.equal(later.length, 0, 'the mark expires exactly on the tick');
  assert.deepEqual(cocsSpotView(null, 0), []);
  assert.deepEqual(cocsSpotView(economyHud().cocs, null), []);
});

test('the radar marks spotted enemies for the spotting team only', () => {
  const hud = economyHud();
  hud.actors = [{id: 0, team: 0, x: 0, z: 0, yaw: 0, health: 100}, {id: 1, team: 1, x: 10, z: 0, yaw: 0, health: 100}];
  const player = {id: 0, team: 0, x: 0, z: 0, yaw: 0};
  const {contacts} = radarContacts(hud, player, {range: 400});
  const enemy = contacts.find(contact => contact.kind === 'actor' && contact.id === 1);
  assert.ok(enemy);
  assert.equal(enemy.spotted, true);
  assert.equal(radarBlip(enemy, player).spotted, true);
  assert.equal(contacts.find(contact => contact.kind === 'actor' && contact.id === 0).spotted, false, 'you never spot yourself');
  // The enemy's own dial does not read the friendly mark.
  const enemyView = radarContacts(hud, {id: 1, team: 1, x: 10, z: 0, yaw: 0}, {range: 400});
  assert.equal(enemyView.contacts.find(contact => contact.kind === 'actor' && contact.id === 1).spotted, false);
  hud.cocs.tick = 200;
  const expired = radarContacts(hud, player, {range: 400}).contacts.find(contact => contact.kind === 'actor' && contact.id === 1);
  assert.equal(expired.spotted, false, 'an expired mark stops rendering');
});

test('spotted enemies carry a world mark that expires with the sim tick', () => {
  const view = markerView(false);
  const model = new T.Group();
  view.actorModels = new Map([[5, model]]);
  view.playerId = 0;
  const actors = [{id: 0, team: 0, x: 0, z: 0, health: 100}, {id: 5, team: 1, x: 10, z: 0, health: 100}];
  const match = {time: 1, actors, objectiveState: {kind: 'cocs', tick: 100, spots: {5: {team: 0, until: 130, by: 0, x: 10, z: 0}}}};
  view.updateSpots(match);
  const mark = model.userData.spotMark;
  assert.ok(mark, 'the mark is attached to the spotted actor');
  assert.equal(mark.visible, true, 'the mark renders in-world');
  assert.equal(mark.children.length, 2, 'ring plus chevron, a shape not just a colour');
  match.objectiveState.tick = 200;
  view.updateSpots(match);
  assert.equal(mark.visible, false, 'the mark expires on the tick clock');
  // Snapshot-shaped input (net/spectate) reads the same way.
  const snapshot = {time: 1, actors, cocs: {tick: 100, spots: [{id: 5, team: 0, until: 130, by: 0, x: 10, z: 0}]}};
  view.updateSpots(snapshot);
  assert.equal(mark.visible, true);
  // A mark for the other team never outlines the model for this player.
  const enemySource = {time: 1, actors, cocs: {tick: 100, spots: [{id: 5, team: 1, until: 130, by: 9, x: 10, z: 0}]}};
  view.updateSpots(enemySource);
  assert.equal(mark.visible, false);
});

test('the PlayingHud strip is wired to the page cocs command bag', async () => {
  const root = new URL('../', import.meta.url);
  const page = await readFile(new URL('app/page.tsx', root), 'utf8');
  const hud = await readFile(new URL('app/ui/screens/PlayingHud.tsx', root), 'utf8');
  for (const token of ['cocsCommand', 'armCocsVerb', 'pickCocsTarget', 'issueCocsOrder']) assert.ok(page.includes(token), `page wires ${token}`);
  assert.ok(page.includes('cocs:{orders:cocsOrders'), 'issued orders enter Match.step through the human path');
  assert.ok(page.includes('spends:cocsSpends'), 'queued intermission spends enter Match.step through the same path');
  assert.ok(hud.includes('cocsCommand') && hud.includes('ISSUE') && hud.includes('SCAN'), 'the strip renders its verbs and confirm');
  assert.ok(hud.includes('radar-spotted'), 'the radar renders the spot mark');
});

test('the Operations Director HUD surfaces the O1b spend window, sinks and tier copy', async () => {
  const root = new URL('../', import.meta.url);
  const hud = await readFile(new URL('app/ui/screens/OperationsDirectorHud.tsx', root), 'utf8');
  for (const token of ['tierCopy', 'intermission', 'sinks', 'bonus', 'SPEND WINDOW', 'modifiers']) {
    assert.ok(hud.includes(token), `OperationsDirectorHud surfaces ${token}`);
  }
  // The published modifier copy/table is exposed through the pure view too.
  const view = cocsDirectorView({
    coop: true,
    director: {
      tier: 'D4', tierLabel: 'OVERWATCH', phase: 'intermission', wave: 2, waveCount: 5, waveLabel: 'PRESSURE',
      tierCopy: {label: 'OVERWATCH', copy: 'Three fronts.', modifiers: ['3 FRONTS', 'SUPPLY CUT'], band: [0.12, 0.4]},
      budget: {current: 10, spent: 0, rate: 0, cap: 380, peak: 10}, pressure: 0.02,
      fronts: [], composition: {}, modifier: 'mixed',
      intermission: {
        open: true, secondsRemaining: 20, budget: 180, spent: 95, windows: 1,
        byType: {FORTIFY: 1, REPAIR: 0, RESUPPLY: 1, REINFORCE: 0},
        sinks: [{verb: 'RESUPPLY', label: 'RESUPPLY', cost: 35, target: 'team', available: true, affordable: true, enabled: true}],
        log: [],
      },
      siege: {armed: false, health: 1400, max: 1400, percent: 1, attackers: 0, defenders: 0},
      waves: {cleared: 1, par: 5, forceAlive: 0, forceTotal: 5},
    },
    waves: {cleared: 1, par: 5, forceAlive: 0, forceTotal: 5},
    bonus: [{id: 'hold-all', label: 'HOLD ALL', state: 'open', progress: 3, target: 5}],
    bonusTelemetry: {done: [], failed: [], flux: 0, req: 0, commendations: 0},
    reserves: {enabled: false, tickets: 6, burns: 0},
  });
  assert.ok(view);
  assert.equal(view.tierCopy.label, 'OVERWATCH');
  assert.deepEqual(view.tierCopy.modifiers, ['3 FRONTS', 'SUPPLY CUT']);
  assert.equal(view.intermission.open, true);
  assert.equal(view.intermission.sinks[0].cost, 35);
  assert.equal(view.intermission.sinks[0].enabled, true);
  assert.equal(view.bonus[0].id, 'hold-all');
  assert.equal(view.bonus[0].progress, 3);
  assert.equal(view.bonus[0].target, 5);
  // The PvPvE surface stays without an intermission/bonus lane.
  assert.equal(cocsDirectorView({coop: false, director: null}), null);
});
