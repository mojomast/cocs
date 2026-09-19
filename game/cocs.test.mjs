import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {getMap} from './maps.mjs';
import {GAME_MODES,normalizeConfig,teamMode} from './config.mjs';
import {objectiveTemplate} from './mode-data.mjs';
import {updateObjectives} from './objectives.mjs';
import {actorWon,rankTuple} from './outcome.mjs';
import {snapshotDelta,applySnapshotDelta} from './protocol.mjs';
import {
 COCS_KIND,cocsTemplate,stepCocs,cocsSnapshot,cocsOutcome,
 capturableBy,connectedToHq,connectivityIncome,cutLink,repairLink,
 updateLiveNodes,enterEndgame,frontState,cocsPhase,
 sortCocsOrders,stubCocsPolicy,
} from './cocs.mjs';

// A fixed-RNG cocs match with a single (inert) actor so capture is driven only
// by whatever the test places or orders.
const cocsMatch = (over = {}) => new Match('chatgpt', 'openclaw', () => 0.5, 'warfront', {mode: 'cocs', botCount: 0, humanCount: 1, timeLimit: 300, ...over});
const node = (state, id) => state.nodes.find(entry => entry.id === id);
const place = (match, team, target) => {
 const actor = match.actors[0];
 actor.team = team;
 actor.x = target.x; actor.z = target.z; actor.y = target.y;
 actor.health = 100; actor.armor = 0;
 return actor;
};

function mulberry32(seed) {
 let a = seed >>> 0;
 return () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}
const countingRng = seed => {
 const base = mulberry32(seed);
 const fn = () => { fn.draws++; return base(); };
 fn.draws = 0;
 return fn;
};

test('cocs is registered as an objective-first team mode with sane limits', () => {
 const mode = GAME_MODES.find(entry => entry.id === 'cocs');
 assert.ok(mode, 'cocs mode row exists');
 assert.equal(mode.name, 'Lattice Strike');
 assert.equal(mode.rules.team, true);
 assert.equal(mode.rules.score, 'cocs');
 assert.equal(mode.rules.vehicles, false);
 assert.equal(mode.rules.objective.kind, 'cocs');
 assert.equal(teamMode('cocs'), true);
 const config = normalizeConfig({mode: 'cocs'});
 assert.equal(config.mode, 'cocs');
 assert.equal(config.fragLimit, 5);
 assert.equal(normalizeConfig({mode: 'cocs', fragLimit: 99}).fragLimit, 7);
});

test('the cocs template synthesizes the 5-capturable V0a lattice on warfront', () => {
 const state = objectiveTemplate('cocs', getMap('warfront'), {mode: 'cocs'});
 assert.equal(state.kind, COCS_KIND);
 assert.equal(state.synthesized, true, 'warfront has no authored lattice yet, so the stand-in is used');
 const capturable = state.nodes.filter(entry => ['front', 'economy', 'relay'].includes(entry.archetype));
 assert.equal(capturable.length, 5);
 assert.equal(state.nodes.filter(entry => entry.archetype === 'hq').length, 2);
 assert.equal(state.nodes.filter(entry => entry.archetype === 'array').length, 2);
 assert.equal(state.zones.length, 5, 'map-layout and the generic snapshot read capturable centres');
 assert.equal(state.liveNodeIds.length, 3);
 assert.deepEqual([...state.liveNodeIds].sort(), ['front-e', 'front-w', 'relay-c']);
 assert.ok(state.edges.length >= 5);
 for (const entry of state.nodes) assert.ok(Number.isFinite(entry.x) && Number.isFinite(entry.z));
 for (const hq of state.nodes.filter(entry => entry.archetype === 'hq')) assert.ok(hq.owner === 0 || hq.owner === 1, 'HQ anchors start owned');
 for (const entry of capturable) assert.equal(entry.owner, null, 'capturable nodes start neutral');
 for (const entry of state.nodes) assert.deepEqual(entry.progress, {0: 0, 1: 0});
});

test('dominance arms only on an outright majority of the capturable lattice', () => {
 const five = cocsTemplate('cocs', getMap('warfront'), {});
 assert.equal(five.dominanceCount, 3, 'five capturable nodes need three: a 2-of-3 plurality no longer arms dominance');
 assert.equal(five.dominanceFastCount, 4, 'four of five is the fast hold');
 // A three-capturable authored lattice still floors at a bare majority of two.
 const arena = {
  id: 'three-cap', bounds: {minX: -60, maxX: 60, minZ: -10, maxZ: 10},
  nodes: [
   {id: 'hq-0', kind: 'hq', x: -50, z: 0, radius: 4, owner: 0},
   {id: 'front-0', kind: 'front', x: -25, z: 0, radius: 4},
   {id: 'relay-c', kind: 'relay', x: 0, z: 0, radius: 4},
   {id: 'front-1', kind: 'front', x: 25, z: 0, radius: 4},
   {id: 'hq-1', kind: 'hq', x: 50, z: 0, radius: 4, owner: 1},
  ],
  lattice: [['hq-0', 'front-0'], ['front-0', 'relay-c'], ['relay-c', 'front-1'], ['front-1', 'hq-1']],
 };
 const three = cocsTemplate('cocs', arena, {});
 assert.equal(three.dominanceCount, 2);
 assert.equal(three.dominanceFastCount, 3);
});

test('dominance progress resets when the outright majority is broken', () => {
 const match = cocsMatch({cocsPolicy: () => []});
 const state = match.objectiveState;
 const capturable = state.nodes.filter(entry => ['front', 'economy', 'relay'].includes(entry.archetype));
 capturable[0].owner = 0; capturable[1].owner = 0; capturable[2].owner = 0;
 for (let i = 0; i < 10; i++) stepCocs(match, 1 / 60);
 assert.equal(state.dominance.team, 0, 'three of five arms the timer');
 assert.ok(state.dominance.progress > 0);
 // Flip one held node to the enemy: 2-1 with two neutral is still a plurality
 // but no longer an outright majority, so the ratchet must reset.
 capturable[2].owner = 1;
 stepCocs(match, 1 / 60);
 assert.equal(state.dominance.team, null);
 assert.equal(state.dominance.progress, 0);
});

test('the cocs template prefers an authored arena.nodes + arena.lattice', () => {
 const arena = {
  id: 'authored-test',
  bounds: {minX: -50, maxX: 50, minZ: -20, maxZ: 20},
  nodes: [
   {id: 'hq-0', kind: 'hq', x: -40, z: 0, radius: 4, owner: 0},
   {id: 'front-0', kind: 'front', x: -22, z: 0, radius: 4},
   {id: 'relay-c', kind: 'infrastructure', x: 0, z: 0, radius: 5},
   {id: 'front-1', kind: 'front', x: 22, z: 0, radius: 4},
   {id: 'hq-1', kind: 'hq', x: 40, z: 0, radius: 4, owner: 1},
  ],
  lattice: {edges: [['hq-0', 'front-0'], ['front-0', 'relay-c'], ['relay-c', 'front-1'], ['front-1', 'hq-1']]},
 };
 const state = cocsTemplate('cocs', arena, {});
 assert.equal(state.synthesized, false);
 assert.equal(state.nodes.length, 5);
 assert.equal(node(state, 'relay-c').archetype, 'relay', 'map-spec infrastructure folds onto the frozen relay archetype');
 assert.equal(node(state, 'relay-c').r, 5);
 assert.equal(state.edges.length, 4);
 assert.equal(state.liveNodeIds.length, 3, 'fronts plus the padding relay are live');
});

test('capture is adjacency-locked and back-caps are impossible', () => {
 const state = cocsTemplate('cocs', getMap('warfront'), {});
 assert.equal(capturableBy(state, 'front-w', 0), true, 'adjacent to own HQ');
 assert.equal(capturableBy(state, 'relay-c', 0), true, 'the shared centre touches the west HQ');
 assert.equal(capturableBy(state, 'front-e', 0), false, 'the enemy front touches only enemy anchors');
 assert.equal(capturableBy(state, 'econ-e', 0), false, 'behind the enemy front and not live');
 assert.equal(capturableBy(state, 'hq-e', 0), false, 'HQ anchors are never capturable');
 assert.equal(capturableBy(state, 'array-e', 0), false, 'ARRAY anchors are closed outside the endgame');
 state.phase = 'mid';
 node(state, 'front-w').owner = 0;
 updateLiveNodes(state);
 assert.equal(capturableBy(state, 'econ-w', 0), true, 'taking the front opens the economy node');
 assert.equal(capturableBy(state, 'front-w', 0), false, 'an owned node is not capturable by its owner');
 const econ = node(state, 'econ-e');
 assert.equal(econ.live, false, 'enemy-side economy stays dim until its front opens');
 const front = node(state, 'front-e');
 front.owner = 0;
 node(state, 'relay-c').owner = null;
 updateLiveNodes(state);
 assert.equal(capturableBy(state, 'econ-e', 0), true);
 assert.equal(capturableBy(state, 'econ-e', 1), false, 'team 1 no longer owns anything adjacent to it');
});

test('an adjacent actor captures a node and opens the next ring', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const front = node(state, 'front-w');
 const actor = place(match, 0, front);
 const ticks = Math.ceil(state.captureSeconds / (1 / 60)) + 4;
 for (let i = 0; i < ticks; i++) stepCocs(match, 1 / 60);
 assert.equal(front.owner, 0);
 assert.ok(state.scores[0] >= 10, 'a capture banks objective score');
 assert.equal(actor.scoreStats.objectiveCaptures, 1);
 assert.ok(state.liveNodeIds.includes('econ-w'), 'the captured front brings the economy node live');
 assert.ok(capturableBy(state, 'econ-w', 0));
});

test('a live node behind an enemy front cannot be captured without adjacency', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 node(state, 'front-e').owner = 1;
 updateLiveNodes(state);
 const econ = node(state, 'econ-e');
 assert.equal(econ.live, true, 'the enemy front makes the node live but not capturable by us');
 place(match, 0, econ);
 for (let i = 0; i < 420; i++) stepCocs(match, 1 / 60);
 assert.equal(econ.owner, null, 'no back-cap: the node never flips to team 0');
 assert.equal(econ.progress[0], 0);
});

test('connectivity income pays only linked nodes and a link cut denies downstream', () => {
 const state = cocsTemplate('cocs', getMap('warfront'), {});
 const own = (id, team) => { node(state, id).owner = team; };
 own('front-w', 0);
 own('econ-w', 0);
 let result = connectivityIncome(state);
 assert.equal(result.income[0], 4, 'front 1/s + economy 3/s');
 assert.deepEqual([...result.connected[0]].sort(), ['econ-w', 'front-w']);
 own('front-w', null);
 result = connectivityIncome(state);
 assert.equal(result.income[0], 0, 'an unlinked economy node starves');
 assert.equal(connectedToHq(state, 'econ-w', 0), false);
 own('front-w', 0);
 cutLink(state, 'front-w');
 result = connectivityIncome(state);
 assert.equal(result.income[0], 0, 'cutting the middle link denies the node and everything behind it');
 assert.equal(connectedToHq(state, 'front-w', 0), false);
 assert.equal(connectedToHq(state, 'econ-w', 0), false);
 assert.equal(repairLink(state, 'front-w'), true);
 assert.equal(connectivityIncome(state).income[0], 4, 'repairing the link restores income');
});

test('live nodes run 3 opening, up to 5 mid, and at least 5 in the endgame', () => {
 const state = cocsTemplate('cocs', getMap('warfront'), {});
 assert.equal(state.liveNodeIds.length, 3);
 state.phase = 'mid';
 node(state, 'front-w').owner = 0;
 updateLiveNodes(state);
 assert.equal(state.liveNodeIds.length, 4, 'the opened economy node joins without padding to five');
 assert.ok(state.liveNodeIds.includes('econ-w'));
 enterEndgame(state);
 assert.equal(state.liveNodeIds.length, 5);
 assert.ok(state.nodes.filter(entry => ['front', 'economy', 'relay'].includes(entry.archetype)).every(entry => entry.live === true));
 assert.equal(capturableBy(state, 'array-e', 0), false, 'an array still needs an adjacent owned node');
 node(state, 'front-e').owner = 0;
 assert.equal(capturableBy(state, 'array-e', 0), true, 'endgame + adjacency opens the enemy array');
});

test('front state points at the node each team is pressuring', () => {
 const state = cocsTemplate('cocs', getMap('warfront'), {});
 node(state, 'econ-e').owner = 0;
 node(state, 'front-e').progress[0] = 0.7;
 const front = frontState(state);
 assert.equal(front.byTeam[0].nodeId, 'front-e');
 assert.equal(front.nodeId, 'front-e');
 assert.equal(front.contested, false);
 node(state, 'front-e').progress[1] = 0.8;
 node(state, 'front-e').contested = true;
 const contested = frontState(state);
 assert.equal(contested.contested, true);
 assert.equal(contested.nodeId, 'front-e');
});

test('cocsPhase steps opening -> mid -> endgame off the fixed clock', () => {
 const state = cocsTemplate('cocs', getMap('warfront'), {});
 const match = {config: {timeLimit: 100}, time: 0};
 assert.equal(cocsPhase(match, state), 'opening');
 match.time = 30;
 assert.equal(cocsPhase(match, state), 'mid');
 match.time = 80;
 assert.equal(cocsPhase(match, state), 'endgame');
 state.forceEndgame = false;
});

test('rankTuple and actorWon follow COCS objective-first outcomes', () => {
 assert.deepEqual(rankTuple({frags: 5, scoreStats: {objectiveCaptures: 2, objectiveTime: 30}}, 'cocs'), [2, 30, 5]);
 assert.deepEqual(rankTuple({frags: 5, scoreStats: {}}, 'cocs'), [0, 0, 5]);
 assert.equal(actorWon({winner: 0, actors: []}, 'cocs', {team: 0}), true);
 assert.equal(actorWon({winner: 0, actors: []}, 'cocs', {team: 1}), false);
 assert.equal(actorWon({winner: null, actors: []}, 'cocs', {team: 1}), false, 'a draw awards nobody');
 assert.equal(actorWon({winner: null, cocs: {scores: {0: 3, 1: 9}}}, 'cocs', {team: 1}), true, 'score fallback');
 assert.equal(actorWon({winner: null, cocs: {scores: {0: 3, 1: 3}}}, 'cocs', {team: 1}), false);
});

test('cocsOutcome resolves array capture > dominance > score at time', () => {
 const match = cocsMatch({timeLimit: 300});
 const state = match.objectiveState;
 assert.equal(cocsOutcome(match), null);
 state.arrayWinner = 1;
 assert.deepEqual(cocsOutcome(match), {winner: 1, reason: 'array'});
 state.arrayWinner = null;
 state.dominance.team = 0;
 state.dominance.progress = state.dominance.target;
 assert.deepEqual(cocsOutcome(match), {winner: 0, reason: 'dominance'});
 state.dominance.team = null;
 state.dominance.progress = 0;
 match.time = 300;
 state.scores[0] = 5; state.scores[1] = 2;
 assert.deepEqual(cocsOutcome(match), {winner: 0, reason: 'time'});
 state.scores[1] = 5;
 assert.deepEqual(cocsOutcome(match), {winner: null, reason: 'time'}, 'a score draw stays a draw');
});

test('cocsSnapshot is id-keyed and round-trips through snapshotDelta', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const base = cocsSnapshot(match);
 assert.deepEqual(Object.keys(base).sort(), [
  'commander', 'contacts', 'flux', 'fluxCap', 'fluxIncome', 'fluxSpent', 'fluxUpkeep', 'intel', 'liveNodeIds', 'neglect',
  'nodes', 'orderStats', 'req', 'roleBoard', 'rung', 'sabotage', 'scanRadius', 'scans', 'scores', 'scoutCap',
  'scoutStats', 'scouts', 'spotBonus', 'spotSeconds', 'spots', 'tick', 'traversal', 'winner',
 ]);
 assert.equal(base.nodes.find(entry => entry.id === 'front-w').archetype, 'front');
 assert.ok(Array.isArray(base.nodes[0].progress));
 assert.equal(snapshotDelta(base, base), null);
 node(state, 'front-w').owner = 0;
 node(state, 'front-w').progress[0] = 0.5;
 state.scores[0] = 7;
 enterEndgame(state);
 const next = cocsSnapshot(match);
 const delta = snapshotDelta(base, next);
 assert.ok(delta, 'a changed subtree produces a patch');
 assert.deepEqual(applySnapshotDelta(base, delta), next, 'apply(delta) reconstructs the next frame');
});

test('stepCocs runs exactly once per Match.step and never the generic zone loop', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const before = state.tick;
 match.events.length = 0;
 updateObjectives(match, 1 / 60);
 assert.equal(state.tick, before + 1, 'one update per step');
 assert.equal(match.events.some(event => ['zone-progress', 'zone-capture', 'zone-neutralized'].includes(event.type)), false, 'the generic capture loop never runs for cocs');
 assert.equal(match.objectiveEventState.size, 0);
 const afterDirect = state.tick;
 match.step(1 / 60);
 assert.equal(state.tick, afterDirect + 1);
});

test('orders are processed in (tick, peerId, cardId) order and are arrival-independent', () => {
 const orders = [
  {tick: 1, peerId: 'b', cardId: '2', team: 0, verb: 'ATTACK', target: 'front-w'},
  {tick: 1, peerId: 'a', cardId: '1', team: 1, verb: 'ATTACK', target: 'front-e'},
  {tick: 1, peerId: 'a', cardId: '0', team: 0, verb: 'ATTACK', target: 'econ-e'},
 ];
 assert.deepEqual(sortCocsOrders(orders).map(order => order.cardId), ['0', '1', '2']);
 const run = arrival => {
  const match = cocsMatch();
  match.step(1 / 60, {cocs: {orders: arrival.map(order => ({...order}))}});
  return match.objectiveState;
 };
 const forward = run(orders);
 const reverse = run([...orders].reverse());
 assert.deepEqual(forward.orderLog.map(entry => [entry.cardId, entry.ok]), [['0', false], ['1', true], ['2', true]]);
 assert.deepEqual(reverse.orderLog, forward.orderLog, 'arrival order cannot change the result');
 assert.deepEqual(reverse.tasks, forward.tasks);
 assert.equal(forward.tasks[0].nodeId, 'front-w');
 assert.equal(forward.tasks[1].nodeId, 'front-e');
 assert.equal(reverse.orderLog[0].ok, false, 'the back-cap ATTACK is rejected');
});

test('a valid ATTACK order captures a node without any actor in the zone', () => {
 const match = cocsMatch();
 const state = match.objectiveState;
 const front = node(state, 'front-w');
 const ticks = Math.ceil(state.captureSeconds / (1 / 60)) + 4;
 for (let i = 0; i < ticks; i++) {
  match.step(1 / 60, {cocs: {orders: [{tick: i + 1, peerId: 'p', cardId: `c${i}`, team: 0, verb: 'ATTACK', target: 'front-w'}]}});
 }
 assert.equal(front.owner, 0);
 assert.equal(front.progress[0], 0, 'progress resets on capture');
});

test('a standing order cannot freeze a node against a real attacker', () => {
 const match = cocsMatch({cocsPolicy: () => []});
 const state = match.objectiveState;
 const front = node(state, 'front-w');
 front.owner = 1; // enemy holds the gate; team 0 reaches it through its own HQ
 place(match, 0, front);
 // The enemy commander keeps issuing HOLD, but has no body on the point.
 state.tasks[1] = {verb: 'HOLD', nodeId: 'front-w', tick: 0, until: 1e9, peerId: 'chief-1', cardId: 'hold'};
 const ticks = Math.ceil(state.captureSeconds / (1 / 60)) + 4;
 for (let i = 0; i < ticks; i++) stepCocs(match, 1 / 60);
 assert.equal(front.owner, 0, 'the order aura alone cannot hold an owned node');
 assert.equal(front.contested, false, 'an order is not a contest');
});

test('an enemy order alone cannot block a neutral capture', () => {
 const match = cocsMatch({cocsPolicy: () => []});
 const state = match.objectiveState;
 const front = node(state, 'front-w');
 place(match, 0, front);
 state.tasks[1] = {verb: 'ATTACK', nodeId: 'front-w', tick: 0, until: 1e9, peerId: 'chief-1', cardId: 'attack'};
 const ticks = Math.ceil(state.captureSeconds / (1 / 60)) + 4;
 for (let i = 0; i < ticks; i++) stepCocs(match, 1 / 60);
 assert.equal(front.owner, 0, 'the attacker with a body takes the node');
});

test('the stub cocsPolicy issues orders and a seeded run is byte-identical', () => {
 const run = seed => {
  const random = countingRng(seed);
  const match = new Match('chatgpt', 'openclaw', random, 'warfront', {mode: 'cocs', humanCount: 1, botCount: 3, difficulty: 'normal', timeLimit: 60, cocsPolicy: stubCocsPolicy});
  for (let i = 0; i < 3660 && !match.over; i++) match.step(1 / 60);
  return {snapshot: match.snapshot(), draws: random.draws, orders: match.objectiveState.orderLog.length, over: match.over};
 };
 const first = run(0xC0C5);
 const second = run(0xC0C5);
 assert.ok(first.orders > 0, 'the policy issued orders');
 assert.ok(first.over, 'the seeded match finished inside the time limit');
 assert.equal(first.draws, second.draws, 'identical RNG consumption');
 assert.deepEqual(first.snapshot, second.snapshot, 'byte-identical replay');
 const other = run(0xC0C6);
 assert.notDeepEqual(other.snapshot, first.snapshot, 'a different seed diverges');
});
