import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {cocsTemplate,COCS_KIND,updateLiveNodes} from './cocs.mjs';
import {
  COCS_COMEBACK_GARRISON, COCS_SPREAD_FRACTION, cocsAssignment, cocsAttackTargets,
  cocsBotDestination, cocsComebackTargets, cocsDefenceNode, cocsDeficit, cocsDutyPolicy,
  cocsNodeDeficit, cocsScoreDeficit, cocsTeamPlan, cocsThreat, cocsWeakness,
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

// ---------------------------------------------------------------------------
// W8 comeback / rotation pressure. A full five-capturable lattice so a trailing
// squad has three legal enemy-held targets to re-concentrate across.
// ---------------------------------------------------------------------------
const latticeArena = () => ({
  id: 'cocs-comeback-test',
  bounds: {minX: -120, maxX: 120, minZ: -120, maxZ: 120},
  nodes: [
    {id: 'hq-0', kind: 'hq', x: -108, z: 0, radius: 12, owner: 0},
    {id: 'front-0', kind: 'front', x: -54, z: 0, radius: 14},
    {id: 'econ-n', kind: 'economy', x: 0, z: 25, radius: 14},
    {id: 'relay-0', kind: 'relay', x: 0, z: 0, radius: 14},
    {id: 'econ-s', kind: 'economy', x: 0, z: -25, radius: 14},
    {id: 'front-1', kind: 'front', x: 54, z: 0, radius: 14},
    {id: 'hq-1', kind: 'hq', x: 108, z: 0, radius: 12, owner: 1},
  ],
  lattice: {edges: [
    ['hq-0', 'front-0'], ['hq-1', 'front-1'],
    ['front-0', 'relay-0'], ['relay-0', 'front-1'],
    ['front-0', 'econ-n'], ['front-1', 'econ-n'], ['relay-0', 'econ-n'],
    ['front-0', 'econ-s'], ['front-1', 'econ-s'], ['relay-0', 'econ-s'],
  ]},
});
const latticeState = () => cocsTemplate('cocs', latticeArena(), {});
const slotsByNode = plan => {
  const map = new Map();
  for (const slot of plan.slots) map.set(slot.nodeId, (map.get(slot.nodeId) ?? 0) + 1);
  return map;
};

test('deficit helpers fire on a lost node majority and on a score lead, never off-mode', () => {
  const st = state(); // 3 capturable -> outright majority is 2
  for (const node of st.nodes) if (node.id === 'hub' || node.id === 'front-1') node.owner = 1;
  assert.equal(cocsNodeDeficit(st, 0), true, 'team 0 is a node down to the enemy majority');
  assert.equal(cocsNodeDeficit(st, 1), false, 'the majority holder is not in deficit');
  assert.equal(cocsDeficit(st, 0), true);
  st.scores = {0: 100, 1: 10};
  assert.equal(cocsScoreDeficit(st, 1), true, 'a 10x score gap registers');
  assert.equal(cocsScoreDeficit(st, 0), false);
  assert.equal(cocsDeficit(st, 1), true, 'the score signal alone enters the stance');
  st.nodes.find(node => node.id === 'hub').owner = 0;
  assert.equal(cocsNodeDeficit(st, 0), false, 'node parity is not a deficit');
  const foreign = {...st, kind: 'domination'};
  assert.equal(cocsNodeDeficit(foreign, 0), false);
  assert.equal(cocsScoreDeficit(foreign, 0), false);
  assert.equal(cocsDeficit(foreign, 0), false);
  assert.deepEqual(cocsComebackTargets(foreign, [], 0), [], 'no comeback targets leak off-mode');
});

test('the comeback concentrates on the weakest frontier and splits across two nodes', () => {
  const st = latticeState();
  st.nodes.find(node => node.id === 'front-0').owner = 0;
  for (const id of ['relay-0', 'econ-n', 'econ-s']) st.nodes.find(node => node.id === id).owner = 1;
  updateLiveNodes(st);
  const roster = [
    ...bots(0, 4, {x: -54, z: 0}),
    {id: 1, team: 1, health: 100, x: 0, z: 25},   // econ-n defender
    {id: 3, team: 1, health: 100, x: 0, z: 0},    // relay defenders
    {id: 5, team: 1, health: 100, x: 5, z: 0},
  ];
  const plan = cocsTeamPlan(matchFor(roster, st), st, 0);
  assert.equal(plan.deficit, true);
  assert.equal(plan.nodeDeficit, true, 'the enemy holds an outright majority (3 of 5)');
  const node = id => st.nodes.find(entry => entry.id === id);
  assert.ok(cocsWeakness(roster, node('econ-s'), 0) < cocsWeakness(roster, node('relay-0'), 0), 'the undefended siphon is the weakest frontier');
  assert.deepEqual(plan.comeback.map(entry => entry.node.id), ['econ-s', 'econ-n', 'relay-0'], 'undefended siphon, then the singly-held siphon, then the relay');
  assert.ok(plan.comeback.map(entry => entry.node.id).indexOf('econ-s') < plan.comeback.map(entry => entry.node.id).indexOf('relay-0'));
  assert.equal(plan.attackCap, Math.ceil(4 * 0.5), 'two nodes carry the attack, never one all-in stack');
  const byNode = slotsByNode(plan);
  assert.equal(byNode.get('econ-s'), 2, 'the weakest node is the primary');
  assert.equal(byNode.get('econ-n'), 1, 'a second front stays alive');
  assert.equal(byNode.get('relay-0') ?? 0, 0, 'the strongest target is not fed the pack');
  assert.equal(byNode.get('front-0'), 1, 'the last held node keeps a token screen');
  assert.equal(plan.holds[0].count, COCS_COMEBACK_GARRISON, 'the garrison is recalled to a token');
  for (const [nodeId, count] of byNode) if (nodeId !== 'front-0') assert.ok(count <= plan.attackCap, `${nodeId} respects the comeback attack cap`);
});

test('the comeback target order is deterministic and independent of actor array order', () => {
  const st = latticeState();
  st.nodes.find(node => node.id === 'front-0').owner = 0;
  for (const id of ['relay-0', 'econ-n', 'econ-s']) st.nodes.find(node => node.id === id).owner = 1;
  updateLiveNodes(st);
  const roster = [
    ...bots(0, 4, {x: -54, z: 0}),
    {id: 1, team: 1, health: 100, x: 0, z: 25},
    {id: 3, team: 1, health: 100, x: 0, z: 0},
    {id: 5, team: 1, health: 100, x: 5, z: 0},
  ];
  const first = cocsTeamPlan(matchFor(roster, st), st, 0);
  const second = cocsTeamPlan(matchFor([...roster].reverse(), st), st, 0);
  assert.deepEqual(second.comeback.map(entry => entry.node.id), first.comeback.map(entry => entry.node.id));
  const slots = plan => plan.slots.map(slot => `${slot.nodeId}:${slot.kind}`).sort();
  assert.deepEqual(slots(second), slots(first), 'the slot multiset is identical under a shuffled roster');
  // Pure: planning never rewrites the objective state.
  const before = JSON.stringify(st.nodes.map(node => [node.id, node.owner, node.progress]));
  cocsTeamPlan(matchFor(roster, st), st, 0);
  assert.equal(JSON.stringify(st.nodes.map(node => [node.id, node.owner, node.progress])), before);
});

test('a score-only deficit re-concentrates the attack but keeps the garrison', () => {
  const st = latticeState();
  for (const id of ['front-0', 'econ-s']) st.nodes.find(node => node.id === id).owner = 0;
  for (const id of ['relay-0', 'econ-n']) st.nodes.find(node => node.id === id).owner = 1;
  st.scores = {0: 10, 1: 100};
  updateLiveNodes(st);
  const roster = [
    ...bots(0, 4, {x: -54, z: 0}),
    {id: 1, team: 1, health: 100, x: -52, z: 0},
    {id: 3, team: 1, health: 100, x: -56, z: 2},
    {id: 5, team: 1, health: 100, x: -56, z: -2},
  ];
  const plan = cocsTeamPlan(matchFor(roster, st), st, 0);
  assert.equal(plan.deficit, true);
  assert.equal(plan.nodeDeficit, false, 'node parity means no recall');
  assert.equal(plan.attackCap, Math.ceil(4 * 0.5), 'the attack still re-concentrates');
  assert.equal(plan.holds[0].count, 3, 'the pushed front is defended at full strength');
});

test('a leading team keeps the ordinary value order and spread cap', () => {
  const st = latticeState();
  for (const id of ['front-0', 'relay-0', 'econ-s']) st.nodes.find(node => node.id === id).owner = 0;
  for (const id of ['front-1', 'econ-n']) st.nodes.find(node => node.id === id).owner = 1;
  updateLiveNodes(st);
  const roster = bots(0, 4, {x: -54, z: 0});
  const plan = cocsTeamPlan(matchFor(roster, st), st, 0);
  assert.equal(plan.deficit, false, 'a node majority is not a deficit');
  assert.deepEqual(plan.comeback, []);
  assert.equal(plan.attackCap, plan.cap, 'the ordinary spread cap is retained');
  const firstAttack = plan.duties.find(duty => duty.kind === 'attack');
  assert.equal(firstAttack.nodeId, cocsAttackTargets(st, 0)[0].node.id, 'leading squads still push the highest-value node');
});

