// ---------------------------------------------------------------------------
// LATTICE STRIKE (`cocs`) bot objective policy.
//
// The V0a lattice ships W1's template/step and W2/W3's map layer, but the
// shipped bot AI has no branch for `kind==='cocs'`: bots roam and fight near
// spawns, so the objective never converts a won fight into a front (the D0
// diagnosis: strict contested-node time 0.1 %, fight@point 0.4 %). This module
// is the missing half — a deterministic, objective-seeking policy that reaches
// the lattice, fights on the point and responds to the per-team `cocsPolicy`
// orders W1 installs.
//
// Design (all pure, no RNG):
//   * **Team plan** — the living roster is sorted by actor id; the plan maps
//     each slot to a `{nodeId, kind}` duty. Duties are, in order: an active
//     order task, the most-threatened owned node (a garrison), then the attack
//     targets. Attack targets are the live nodes adjacent to owned territory
//     (`capturableBy`, so back-caps are impossible) ranked by capture value +
//     income + our progress + how far toward the enemy HQ they sit.
//   * **Spread rule** — at most `ceil(roster · 0.6)` bots are committed to any
//     one node (garrison and attack share the cap), so a squad never stacks a
//     single point once a second front is legal.
//   * **Front preference** — a node closer to the enemy HQ (relay-0 in the V0a
//     slice) outranks the team's own gate, so both teams push the shared centre
//     and the fight happens on the same point. That is what strict contest and
//     fight@point measure.
//   * **Stance** — `cocsBotDestination` reuses `Match.zoneSlot` so the bot
//     seeks a slot *inside* the node radius (pulled further in toward the
//     centre), then the existing `botInput` combat/cover logic engages whatever
//     it can see while the objective state keeps its destination on the point.
//     A cocs-stance block in `bots.mjs` biases engaged movement back to the
//     node and caps the weapon standoff so a long-range duel cannot pull the
//     whole squad just outside the capture radius.
//   * **Duty policy** — `cocsDutyPolicy` issues one order per team on a fixed
//     45-tick cadence: ATTACK a target the squad already locally leads, else
//     HOLD the most-threatened owned node. It skips a node the enemy is
//     currently attacking so two standing attack orders cannot cancel into an
//     order-only deadlock; the bots themselves decide such a node.
//
// Determinism contract (mirrors game/cocs.mjs §11.6): no `Math.random`, no
// wall clock, every list sorted by id; a fixed seed yields a byte-identical
// replay. The only RNG the COCS path consumes is the shipped `match.random()`
// draws the combat AI already made, in the same order.
// ---------------------------------------------------------------------------

import {
  COCS_CAPTURE_POINTS, COCS_INCOME, COCS_KIND,
  capturableBy, capturableNodes, nodeById,
} from './cocs.mjs';

// A team may commit at most 60 % of its living roster to one node.
export const COCS_SPREAD_FRACTION = 0.6;
// Enemy actors within a node's radius + this pad count toward its threat.
const THREAT_PAD = 10;
// Duty policy cadence, in ticks at RULES.dt (45 ticks = 0.75 s; W1's task TTL
// is 2 s, so a task never lapses between reissues). Deliberately not 0 or 1 so
// tick 1 stays order-silent for the arrival-order tests.
const POLICY_INTERVAL = 45;

const idSort = (a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''));

function hqFor(state, team) {
  return (state?.nodes ?? []).find(node => node.archetype === 'hq' && node.owner === team) ?? null;
}

// How far a node sits toward the enemy HQ, in metres. The shared centre scores
// 0 for both sides, so it outranks each team's own gate and both teams push it.
function advanceBonus(state, node, team) {
  const own = hqFor(state, team);
  const enemy = hqFor(state, 1 - team);
  if (!own || !enemy) return 0;
  const dOwn = Math.hypot(own.x - node.x, own.z - node.z);
  const dEnemy = Math.hypot(enemy.x - node.x, enemy.z - node.z);
  return (dOwn - dEnemy) * 0.35;
}

// Attack priority: banked capture points, sustained income, finishing our
// in-progress capture, then how far the node advances us toward the enemy.
export function cocsNodeValue(state, node, team) {
  const points = COCS_CAPTURE_POINTS[node.archetype] ?? 0;
  const income = (COCS_INCOME[node.archetype] ?? 0) * 8;
  const progress = (node.progress?.[team] ?? 0) * 6;
  return points + income + progress + advanceBonus(state, node, team);
}

// Threat on an owned node: the enemy's capture progress, living enemy presence
// inside radius+THREAT_PAD, and whether an enemy-owned neighbour is adjacent.
// The adjacency term keeps a garrison anchored on the shared front even in a
// quiet moment, which is what stops the fight drifting off the point.
export function cocsThreat(actors, state, node, team) {
  const other = 1 - team;
  let threat = (node.progress?.[other] ?? 0) * 10;
  for (const actor of actors ?? []) {
    if (!actor || actor.health <= 0 || actor.team !== other) continue;
    const distance = Math.hypot((actor.x ?? 0) - node.x, (actor.z ?? 0) - node.z);
    if (distance <= node.r + THREAT_PAD) threat += 2 + (node.r + THREAT_PAD - distance) * 0.1;
  }
  for (const id of state.adjacency?.[node.id] ?? []) {
    if (nodeById(state, id)?.owner === other) { threat += 1; break; }
  }
  return threat;
}

// The owned capturable node most under pressure, or null when nothing is.
export function cocsDefenceNode(actors, state, team) {
  let best = null;
  let bestThreat = 0;
  for (const node of capturableNodes(state).filter(entry => entry.owner === team).sort(idSort)) {
    const threat = cocsThreat(actors, state, node, team);
    if (threat > bestThreat + 1e-9) { bestThreat = threat; best = node; }
  }
  return best ? {node: best, threat: bestThreat} : null;
}

// Live, adjacency-legal attack targets (no back-caps), highest value first.
export function cocsAttackTargets(state, team) {
  return capturableNodes(state)
    .filter(node => capturableBy(state, node.id, team))
    .map(node => ({node, value: cocsNodeValue(state, node, team)}))
    .sort((a, b) => b.value - a.value || idSort(a.node, b.node));
}

// Deterministic squad plan: a duty slot per living roster index. Exposed (not
// just consumed inside `cocsAssignment`) so the spread/defence rules are
// directly testable without a running bot loop.
export function cocsTeamPlan(match, state, team) {
  const actors = match?.actors ?? [];
  const roster = actors
    .filter(actor => actor && actor.health > 0 && actor.team === team)
    .sort((a, b) => a.id - b.id);
  const targets = cocsAttackTargets(state, team);
  const task = (state.tasks?.[team] && state.tick <= state.tasks[team].until) ? state.tasks[team] : null;
  const defence = cocsDefenceNode(actors, state, team);
  const cap = Math.max(1, Math.ceil(roster.length * COCS_SPREAD_FRACTION));
  // A defence may reinforce up to the same per-node spread cap, so a front that
  // is genuinely being pushed can be met with numbers instead of fed in piecemeal.
  const maxDefenders = cap;
  // Garrison slots: reinforce the most-threatened owned node to roughly the
  // enemy numbers on it when it is genuinely being pushed, so an under-strength
  // front cannot be picked apart one bot at a time. A safe rear node never
  // strips the front.
  const holds = [];
  if (task && task.verb === 'HOLD') holds.push({nodeId: task.nodeId, count: 1});
  if (defence && defence.threat > 0) {
    // Match the enemy numbers on the node (capped by the spread rule) so the
    // fight on the point is an even scrum instead of a piecemeal feed.
    const {hostile} = localPresence(actors, defence.node, team, THREAT_PAD);
    const count = Math.max(1, Math.min(maxDefenders, Math.round(hostile)));
    const existing = holds.find(hold => hold.nodeId === defence.node.id);
    if (existing) existing.count = Math.max(existing.count, count);
    else holds.push({nodeId: defence.node.id, count});
  }
  const duties = [];
  for (const hold of holds) for (let index = 0; index < hold.count; index++) duties.push({nodeId: hold.nodeId, kind: 'hold'});
  if (task && task.verb === 'ATTACK') duties.push({nodeId: task.nodeId, kind: 'attack'});
  for (const target of targets) {
    if (!duties.some(duty => duty.nodeId === target.node.id && duty.kind === 'attack')) {
      duties.push({nodeId: target.node.id, kind: 'attack'});
    }
  }
  const slots = [];
  const used = new Map();
  const place = (nodeId, kind) => { slots.push({nodeId, kind}); used.set(nodeId, (used.get(nodeId) ?? 0) + 1); };
  // 1. Garrison first (already count-limited).
  for (const hold of holds) {
    while ((used.get(hold.nodeId) ?? 0) < hold.count && slots.length < roster.length) place(hold.nodeId, 'hold');
    if (slots.length >= roster.length) break;
  }
  // 2. Attack: fill each duty to the spread cap, primary (task) first.
  for (const duty of duties) {
    if (duty.kind !== 'attack') continue;
    while ((used.get(duty.nodeId) ?? 0) < cap && slots.length < roster.length) place(duty.nodeId, 'attack');
    if (slots.length >= roster.length) break;
  }
  // 3. Overflow so every bot has a destination, never an infinite loop.
  let guard = 0;
  while (slots.length < roster.length && duties.length && guard++ < roster.length * 4) {
    for (const duty of duties) {
      if (slots.length >= roster.length) break;
      place(duty.nodeId, duty.kind);
    }
  }
  return {roster, duties, slots, cap, maxDefenders, defence, targets, task, holds};
}

// Per-actor assignment. Stable: the actor's position in the id-sorted living
// roster selects the slot, so identical state always yields the same duty.
export function cocsAssignment(match, a, state = match?.objectiveState) {
  if (!state || state.kind !== COCS_KIND || !a) return null;
  const team = a.team;
  if (team !== 0 && team !== 1) return null;
  const plan = cocsTeamPlan(match, state, team);
  if (!plan.slots.length) return {nodeId: null, kind: 'hold', role: 'hold', index: 0, team, plan};
  const index = Math.max(0, plan.roster.findIndex(actor => actor.id === a.id));
  const slot = plan.slots[Math.min(index, plan.slots.length - 1)];
  return {nodeId: slot.nodeId, kind: slot.kind, role: slot.kind, index, team, plan};
}

// A destination inside the target node's radius. `Match.zoneSlot` places
// attackers on a ring facing their own spawn (so the two teams meet across the
// point) and defenders on a defensive ring; reusing it keeps the existing
// cover/step-up reachability checks.
export function cocsBotDestination(match, a, assignment, state = match?.objectiveState) {
  if (!assignment || assignment.nodeId === null || assignment.nodeId === undefined) return null;
  const node = nodeById(state, assignment.nodeId);
  if (!node) return null;
  const zone = {
    id: node.id,
    x: node.x,
    z: node.z,
    y: Number.isFinite(node.y) ? node.y : (match?.center?.y ?? 0),
    radius: node.r ?? 4,
    owner: node.owner,
  };
  if (typeof match?.zoneSlot === 'function') {
    const slot = match.zoneSlot(a, zone, a.team);
    // Pull the reachable slot in toward the centre: the point is the fight,
    // and the capture radius is generous enough that a tight scrum stays legal.
    if (slot) return {x: node.x + (slot.x - node.x) * 0.4, y: slot.y, z: node.z + (slot.z - node.z) * 0.4};
  }
  return {x: node.x, y: zone.y, z: node.z};
}

// ---------------------------------------------------------------------------
// Duty policy. Deterministic (no RNG): one HOLD/ATTACK order per team on a
// fixed cadence. Skips a node the enemy is currently attacking so two standing
// attack orders cannot cancel into an order-only deadlock; the bots decide that
// node. Returns [] off-cadence so the step's RNG order is untouched.
// ---------------------------------------------------------------------------
function localPresence(actors, node, team, pad) {
  let friendly = 0;
  let hostile = 0;
  for (const actor of actors ?? []) {
    if (!actor || actor.health <= 0) continue;
    if (Math.hypot((actor.x ?? 0) - node.x, (actor.z ?? 0) - node.z) > node.r + pad) continue;
    if (actor.team === team) friendly++;
    else if (actor.team === 1 - team) hostile++;
  }
  return {friendly, hostile};
}

export function cocsDutyPolicy(state, context = {}) {
  const tick = Number.isFinite(context.tick) ? context.tick : (state?.tick ?? 0);
  if (tick <= 0 || tick % POLICY_INTERVAL !== 0) return [];
  if (!state || state.kind !== COCS_KIND) return [];
  const actors = context.actors ?? [];
  const orders = [];
  for (const team of [0, 1]) {
    const other = 1 - team;
    const enemyTask = (state.tasks?.[other] && state.tick <= state.tasks[other].until) ? state.tasks[other] : null;
    const blocked = enemyTask && enemyTask.verb === 'ATTACK' ? enemyTask.nodeId : null;
    const targets = cocsAttackTargets(state, team);
    // An ATTACK order counts as presence for its whole TTL. Issuing one where
    // the squad is not already locally winning hands the defender a free
    // garrison that pins a node (relay-0) contested forever and freezes the
    // score. The Chief therefore only orders an attack it can back: an
    // unblocked target where living friendlies outnumber living hostiles.
    let node = null;
    let verb = 'ATTACK';
    for (const entry of targets) {
      if (entry.node.id === blocked) continue;
      const {friendly, hostile} = localPresence(actors, entry.node, team, THREAT_PAD);
      if (friendly > 0 && friendly > hostile) { node = entry.node; break; }
    }
    if (!node) {
      const defence = cocsDefenceNode(actors, state, team);
      if (defence && defence.threat > 0) { node = defence.node; verb = 'HOLD'; }
      else {
        node = capturableNodes(state)
          .filter(entry => entry.owner === team)
          .sort((a, b) => cocsNodeValue(state, b, team) - cocsNodeValue(state, a, team) || idSort(a, b))[0] ?? null;
        verb = 'HOLD';
      }
    }
    if (!node) continue;
    if (node.owner === team) verb = 'HOLD';
    orders.push({tick, peerId: `chief-${team}`, cardId: `${team}-${tick}`, team, verb, target: node.id});
  }
  return orders;
}
