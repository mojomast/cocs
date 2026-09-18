import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {cocsTemplate,COCS_KIND} from './cocs.mjs';
import {
  COCS_SPREAD_FRACTION,cocsAssignment,cocsAttackTargets,cocsBotDestination,
  cocsDefenceNode,cocsDutyPolicy,cocsTeamPlan,cocsThreat,
} from './cocs-bots.mjs';

// A small authored lattice: both teams can reach the shared `hub` relay from
// their HQ, and each has its own FRONT gate. That gives a team two legal attack
// targets from tick 0, which is what the spread rule is about.
const arena = () => ({
  id: 'cocs-bots-test',
  bounds: {minX: -50, maxX: 50, minZ: -20, maxZ: 20},
  nodes: [
    {id: 'hq-0', kind: 'hq', x: -40, z: 0, radius: 4, owner: 0},
    {id: 'front-0', kind: 'front', x: -25, z: 0, radius: 4},
    {id: 'hub', kind: 'relay', x: 0, z: 0, radius: 4},
    {id: 'front-1', kind: 'front', x: 25, z: 0, radius: 4},
    {id: 'hq-1', kind: 'hq', x: 40, z: 0, radius: 4, owner: 1},
  ],
  lattice: {edges: [['hq-0', 'front-0'], ['front-0', 'hub'], ['hub', 'front-1'], ['front-1', 'hq-1'], ['hq-0', 'hub'], ['hq-1', 'hub']]},
});
const state = () => cocsTemplate('cocs', arena(), {});
const bots = (team, count, at = {}) => Array.from({length: count}, (_, i) => ({
  id: team + i * 2, team, health: 100, x: at.x ?? team * 30, z: at.z ?? 0,
}));
const matchFor = (roster, st) => ({actors: roster, objectiveState: st, center: {x: 0, y: 0, z: 0}});
const counts = plan => {
  const map = new Map();
  for (const slot of plan.slots) map.set(slot.nodeId, (map.get(slot.nodeId) ?? 0) + 1);
  return map;
};

test('attack targets are adjacency-legal (no back-caps) and prefer the shared centre', () => {
  const st = state();
  const targets = cocsAttackTargets(st, 0).map(entry => entry.node.id);
  assert.deepEqual([...targets].sort(), ['front-0', 'hub'], 'team 0 can only reach its own gate and the shared relay');
  assert.equal(targets[0], 'hub', 'the shared relay outranks the own-side gate');
  assert.equal(targets.includes('front-1'), false, 'the enemy front is not capturable without a link');
  // Taking the own gate opens nothing new toward the enemy until the relay is held.
  st.nodes.find(node => node.id === 'front-0').owner = 0;
  assert.deepEqual(cocsAttackTargets(st, 0).map(entry => entry.node.id), ['hub']);
  // Taking the relay opens the enemy front.
  st.nodes.find(node => node.id === 'hub').owner = 0;
  assert.ok(cocsAttackTargets(st, 0).map(entry => entry.node.id).includes('front-1'));
});

test('defence picks the most-threatened owned node and threat scales with enemy presence', () => {
  const st = state();
  st.nodes.find(node => node.id === 'front-0').owner = 0;
  st.nodes.find(node => node.id === 'hub').owner = 0;
  const quiet = [{id: 0, team: 0, health: 100, x: -30, z: 0}];
  const exposed = cocsDefenceNode(quiet, st, 0);
  assert.equal(exposed.node.id, 'hub', 'the relay bordering the enemy HQ is the structurally exposed node');
  assert.ok(exposed.threat > 0);
  assert.equal(cocsThreat(quiet, st, st.nodes.find(node => node.id === 'front-0'), 0), 0, 'the own-side gate behind the relay is quiet');
  const pushing = [{id: 0, team: 0, health: 100, x: -30, z: 0}, {id: 1, team: 1, health: 100, x: 2, z: 0}];
  const defence = cocsDefenceNode(pushing, st, 0);
  assert.equal(defence.node.id, 'hub', 'the relay with an enemy on it is the threatened node');
  assert.ok(defence.threat > exposed.threat, 'live enemy presence raises the threat above structural exposure');
});

test('the spread rule caps any one node and rotates the remainder to a second node', () => {
  const st = state();
  const roster = bots(0, 4);
  const plan = cocsTeamPlan(matchFor(roster, st), st, 0);
  assert.equal(plan.cap, Math.max(1, Math.ceil(4 * COCS_SPREAD_FRACTION)));
  assert.equal(plan.slots.length, 4, 'every living bot gets a slot');
  const byNode = counts(plan);
  for (const count of byNode.values()) assert.ok(count <= plan.cap, 'no node exceeds the spread cap');
  assert.ok((byNode.get('hub') ?? 0) >= 1 && (byNode.get('front-0') ?? 0) >= 1, 'a four-bot squad splits across both fronts');
  assert.ok((byNode.get('hub') ?? 0) <= plan.cap);
});

test('a garrison is reserved for a threatened owned node and the rest attack', () => {
  const st = state();
  st.nodes.find(node => node.id === 'hub').owner = 0;
  const roster = [...bots(0, 3, {x: 2, z: 0}), {id: 1, team: 1, health: 100, x: 3, z: 0}];
  const plan = cocsTeamPlan(matchFor(roster, st), st, 0);
  assert.equal(plan.slots[0].nodeId, 'hub');
  assert.equal(plan.slots[0].kind, 'hold', 'slot 0 garrisons the threatened relay');
  assert.ok(plan.slots.slice(1).every(slot => slot.kind === 'attack'));
});

test('an active team task becomes the plan priority', () => {
  const st = state();
  const roster = bots(0, 4);
  st.tasks[0] = {verb: 'ATTACK', nodeId: 'front-0', tick: st.tick, until: st.tick + 120};
  const plan = cocsTeamPlan(matchFor(roster, st), st, 0);
  assert.equal(plan.slots[0].nodeId, 'front-0');
  st.tick = 999;
  const expired = cocsTeamPlan(matchFor(roster, st), st, 0);
  assert.notEqual(expired.slots[0].nodeId, 'front-0', 'an expired task is ignored');
});

test('assignment is stable by id and deterministic for identical state', () => {
  const st = state();
  const roster = bots(0, 4);
  const match = matchFor(roster, st);
  const first = roster.map(actor => cocsAssignment(match, actor, st).nodeId);
  const second = roster.map(actor => cocsAssignment(match, actor, st).nodeId);
  assert.deepEqual(first, second);
  // Sorting is by id: the living roster order must not depend on array order.
  const shuffled = [...roster].reverse();
  const fromShuffled = shuffled.map(actor => cocsAssignment(matchFor(shuffled, st), actor, st).nodeId);
  assert.deepEqual([...fromShuffled].reverse(), first);
});

test('cocsBotDestination lands inside the target radius and is a no-op without a node', () => {
  const st = state();
  const match = matchFor(bots(0, 1), st);
  const actor = match.actors[0];
  const node = st.nodes.find(entry => entry.id === 'hub');
  const slot = cocsBotDestination(match, actor, {nodeId: 'hub'}, st);
  assert.ok(slot && Math.hypot(slot.x - node.x, slot.z - node.z) < node.r, 'the slot is inside the capture radius');
  assert.equal(cocsBotDestination(match, actor, {nodeId: null}, st), null);
});

test('the duty policy issues deterministic ATTACK/HOLD orders with no RNG and no deadlock fallback', () => {
  const st = state();
  assert.deepEqual(cocsDutyPolicy(st, {tick: 1, actors: []}), [], 'off-cadence is silent');
  // Team 0 has two bots on the relay and no enemy: order the attack.
  const actors = [
    {id: 0, team: 0, health: 100, x: 1, z: 0},
    {id: 2, team: 0, health: 100, x: -1, z: 0},
    {id: 1, team: 1, health: 100, x: -35, z: 0},
  ];
  const orders = cocsDutyPolicy(st, {tick: 45, actors});
  const team0 = orders.find(order => order.team === 0);
  assert.equal(team0.verb, 'ATTACK');
  assert.equal(team0.target, 'hub');
  assert.deepEqual(cocsDutyPolicy(st, {tick: 45, actors}), orders, 'identical state yields identical orders');
  // Hostiles outnumbering our bots on the only target block an unbacked attack;
  // the team then holds an owned node instead of cancelling the enemy order.
  st.nodes.find(node => node.id === 'front-0').owner = 0;
  const blocking = [
    {id: 0, team: 0, health: 100, x: 1, z: 0},
    {id: 1, team: 1, health: 100, x: 0, z: 0},
    {id: 3, team: 1, health: 100, x: -1, z: 0},
  ];
  const contested = cocsDutyPolicy(st, {tick: 45, actors: blocking});
  const t0 = contested.find(order => order.team === 0);
  assert.equal(t0.verb, 'HOLD');
  assert.equal(t0.target, 'front-0');
  // The policy never reaches for a random source.
  assert.doesNotThrow(() => cocsDutyPolicy(st, {tick: 45, actors, random: () => { throw new Error('rng'); }}));
});

test('the cocs policy is inert for every other mode', () => {
  const st = state();
  st.kind = COCS_KIND;
  // A non-cocs state short-circuits both helpers.
  const foreign = {...st, kind: 'domination'};
  assert.equal(cocsAssignment(matchFor(bots(0, 2), st), {id: 0, team: 0}, foreign), null);
  assert.deepEqual(cocsDutyPolicy(foreign, {tick: 45, actors: []}), []);
  // And a real non-cocs match never touches the cocs bot fields or snapshot.
  const run = () => {
    const match = new Match('chatgpt', 'openclaw', () => 0.5, 'warfront', {mode: 'domination', botCount: 3, aiSeats: true, timeLimit: 20});
    for (let i = 0; i < 600 && !match.over; i++) match.step(1 / 60, {inputs: {}});
    return match;
  };
  const match = run();
  assert.equal(match.snapshot().cocs, undefined, 'no cocs subtree leaks into another mode');
  assert.ok(match.actors.every(actor => actor.bot?.cocsNode === undefined), 'no bot is given a cocs node outside cocs');
  const again = run();
  assert.deepEqual(again.snapshot(), match.snapshot(), 'other modes stay deterministic');
});

test('a seeded cocs match with the duty policy is byte-identical across runs', () => {
  const run = seed => {
    const random = (() => {
      let n = seed >>> 0;
      return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
    })();
    const match = new Match('chatgpt', 'openclaw', random, 'lattice-slice', {
      mode: 'cocs', humanCount: 1, botCount: 7, aiSeats: true, difficulty: 'normal', timeLimit: 20,
    });
    match.pickups = [];
    for (let i = 0; i < 900 && !match.over; i++) match.step(1 / 60, {inputs: {}});
    return match;
  };
  const first = run(0xC0C5);
  const second = run(0xC0C5);
  assert.ok(first.objectiveState.orderLog.length > 0, 'the default duty policy issued orders');
  assert.ok(first.actors.some(actor => actor.bot?.cocsNode), 'bots were assigned to lattice nodes');
  assert.deepEqual(second.snapshot(), first.snapshot());
});
