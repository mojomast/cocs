// LATTICE V0a HUD + mode-entry surface. Kept in one file so the merge with the
// cocs core wave only has to reconcile the three source modules, never shared
// test files. Covers: mode/map plumbing, a local bot match on the slice, the
// cocs HUD readout, the in-world node markers and the radar ownership blips.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {cocsBoard,cocsArchetypeLabel,cocsArchetypeMark,cocsResultSummary,commandBrief,objectiveCopy,modeTargetText,modeGoal,scoreAnnouncer} from './hud.mjs';
import {GAME_MODES} from './config.mjs';
import {mapsForMode,resolveMapForMode,arenaSupportsMode,maxBotsFor,recommendedBots} from './arenas.mjs';
import {radarContacts} from './radar.mjs';
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
