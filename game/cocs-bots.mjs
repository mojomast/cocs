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
//   * **Comeback / rotation pressure (W8)** — a team that trails on the node
//     tally (enemy outright majority) or the objective score stops camping the
//     held nodes: the garrison reaction is capped (never raised) and the surplus
//     re-concentrates on the enemy's most weakly held frontier, balanced across
//     the two weakest nodes so the enemy's single-node garrison cannot cover
//     both. Behavioural only, deterministic and mode-guarded; see
//     `cocsDeficit` / `cocsComebackTargets`.
//
// Determinism contract (mirrors game/cocs.mjs §11.6): no `Math.random`, no
// wall clock, every list sorted by id; a fixed seed yields a byte-identical
// replay. The only RNG the COCS path consumes is the shipped `match.random()`
// draws the combat AI already made, in the same order.
// ---------------------------------------------------------------------------

import {
  COCS_CAPTURE_POINTS, COCS_INCOME, COCS_KIND, COCS_SCAN_ARRIVE, COCS_SCAN_RADIUS,
  capturableBy, capturableNodes, nodeById,
} from './cocs.mjs';
import {SUBAGENTS} from './cocs-economy.mjs';

// A team may commit at most 60 % of its living roster to one node.
export const COCS_SPREAD_FRACTION = 0.6;
// Enemy actors within a node's radius + this pad count toward its threat.
const THREAT_PAD = 10;
// Duty policy cadence, in ticks at RULES.dt (45 ticks = 0.75 s; W1's task TTL
// is 2 s, so a task never lapses between reissues). Deliberately not 0 or 1 so
// tick 1 stays order-silent for the arrival-order tests.
const POLICY_INTERVAL = 45;
// SCAN cadence (900 ticks = 15 s): the duty Chief screens with a scout when one
// is not already alive and the team can pay the §8.1 spawn cost.
const POLICY_SCAN_INTERVAL = 900;
// --- W8 comeback / rotation pressure ---------------------------------------
// A team is "behind" when the enemy holds an outright majority of the
// capturable lattice (the same threshold that arms dominance) or is running a
// material score lead. This is a behavioural response only: it changes where
// the losing squad is sent, never a stat, speed or damage value.
//
// When behind, the squad stops camping the held nodes: the garrison reaction is
// capped to `COCS_COMEBACK_GARRISON` (only ever lowered, never raised) and the
// surplus re-concentrates on the enemy's most weakly held frontier. Down to the
// last node the recall tightens to `COCS_COMEBACK_DEEP` so the whole surviving
// squad can mount the re-clear. Attack allocation is split evenly across the
// two weakest frontier nodes (`COCS_COMEBACK_SPLIT`) so the enemy's single-node
// garrison cannot cover both — that keeps a second front alive and stops the
// re-concentrate from collapsing into one all-in stack.
export const COCS_COMEBACK_GARRISON = 1;
// The recapture is mounted once a team is down to its last node (or none).
export const COCS_COMEBACK_DEEP = 1;
// Half the roster per comeback node (ceil), i.e. a 2+2 split for a 4-bot squad.
export const COCS_COMEBACK_SPLIT = 0.5;
// Score deficit is measured relative to the combined objective score so the
// trigger scales with match length instead of firing on every early tick. It
// re-concentrates the attack but (unlike a node majority) does not recall the
// garrison: holding your remaining nodes is how a comeback stays alive.
export const COCS_SCORE_DEFICIT = 0.15;

// --- W20 tactical traversal + depot weighting ------------------------------
// A bot only routes through a device when the hop clearly shortens the remaining
// push (or buys a disengage) and the landing is not a defended trap. Thresholds
// are metres; no RNG, no clock read.
export const COCS_DEVICE_MIN_GAIN = 18;
export const COCS_DEVICE_MIN_FRACTION = 0.25;
export const COCS_DEVICE_MAX_DETOUR = 55;
export const COCS_DEVICE_LANDING_PAD = 6;
export const COCS_DEVICE_RETREAT_HEALTH = 0.45;
export const COCS_DEVICE_RETREAT_GAIN = 5;
// Depot weighting. A squad only spends a body on a depots once it can spare
// one: never while trailing (the W8 re-concentrate keeps every body on the
// lattice), never in the first contact window, and only on a depot near its own
// half so it never crosses the map for a loaner.
export const COCS_DEPOT_MIN_ROSTER = 4;
export const COCS_DEPOT_MIN_ATTACKS = 1;
export const COCS_DEPOT_OPENING_TICKS = 600;
export const COCS_DEPOT_MAX_DISTANCE = 90;

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

// `true` when the enemy holds an outright majority of the capturable lattice —
// the same count that arms dominance. This is the condition that warrants
// pulling the garrison off held nodes.
export function cocsNodeDeficit(state, team) {
  if (!state || state.kind !== COCS_KIND) return false;
  const capturable = capturableNodes(state);
  if (!capturable.length) return false;
  let owned = 0, enemy = 0;
  for (const node of capturable) {
    if (node.owner === team) owned++;
    else if (node.owner === 1 - team) enemy++;
  }
  const majority = Math.max(1, Math.round(state.dominanceCount ?? (Math.floor(capturable.length / 2) + 1)));
  return enemy > owned && enemy >= majority;
}

// `true` when the enemy is running a material objective-score lead, measured
// relative to the combined score so the trigger scales with match length.
export function cocsScoreDeficit(state, team) {
  if (!state || state.kind !== COCS_KIND) return false;
  const mine = Math.max(0, Number(state.scores?.[team]) || 0);
  const theirs = Math.max(0, Number(state.scores?.[1 - team]) || 0);
  return theirs > mine + COCS_SCORE_DEFICIT * (mine + theirs);
}

// Combined trail: either signal puts the squad into the re-concentrate stance.
export function cocsDeficit(state, team) {
  return cocsNodeDeficit(state, team) || cocsScoreDeficit(state, team);
}

// Weakness of a frontier node from the attacking team's point of view: fewest
// living defenders is the dominant term, with the enemy's banked capture
// progress as a secondary at-risk signal and our own progress as a reason to
// finish what we started. Lower is weaker. Deterministic, actor-order
// independent (localPresence only counts).
export function cocsWeakness(actors, node, team) {
  const {hostile} = localPresence(actors, node, team, THREAT_PAD);
  const enemyProgress = node.progress?.[1 - team] ?? 0;
  const ownProgress = node.progress?.[team] ?? 0;
  return hostile * 4 + enemyProgress * 3 - ownProgress * 3;
}

// The enemy-held frontier nodes, weakest first. The squad's focus therefore
// rotates to whichever enemy node is currently thinnest as ownership and
// presence shift, while the least-defended node is always the primary. Falls
// back to neutral frontier nodes when the enemy owns none that we can legally
// reach (e.g. only our own captured gate is open).
export function cocsComebackTargets(state, actors, team, targets = null) {
  if (!state || state.kind !== COCS_KIND) return [];
  const pool = (targets ?? cocsAttackTargets(state, team)).filter(entry => entry?.node);
  const held = pool.filter(entry => entry.node.owner === 1 - team);
  const source = held.length ? held : pool;
  return [...source].sort((a, b) =>
    cocsWeakness(actors, a.node, team) - cocsWeakness(actors, b.node, team) ||
    b.value - a.value || idSort(a.node, b.node));
}

// Deterministic squad plan: a duty slot per living roster index. Exposed (not
// just consumed inside `cocsAssignment`) so the spread/defence rules are
// directly testable without a running bot loop.
export function cocsTeamPlan(match, state, team) {
  const actors = match?.actors ?? [];
  const roster = actors
    .filter(actor => actor && actor.health > 0 && actor.team === team && actor.isDirectorWave !== true && actor.subagentRetired !== true)
    .sort((a, b) => a.id - b.id);
  const targets = cocsAttackTargets(state, team);
  const task = (state.tasks?.[team] && state.tick <= state.tasks[team].until) ? state.tasks[team] : null;
  const defence = cocsDefenceNode(actors, state, team);
  const cap = Math.max(1, Math.ceil(roster.length * COCS_SPREAD_FRACTION));
  const deficit = cocsDeficit(state, team);
  const nodeDeficit = cocsNodeDeficit(state, team);
  const comeback = deficit ? cocsComebackTargets(state, actors, team, targets) : [];
  // A defence may reinforce up to the same per-node spread cap, so a front that
  // is genuinely being pushed can be met with numbers instead of fed in piecemeal.
  const maxDefenders = cap;
  // Comeback stance balances the attack across the two weakest frontier nodes
  // (half the roster each) instead of leaning on one, so the enemy's single-node
  // garrison cannot cover both and multi-front pressure survives.
  const attackCap = deficit ? Math.max(1, Math.ceil(roster.length * COCS_COMEBACK_SPLIT)) : cap;
  // Garrison: reinforce the most-threatened owned node to roughly the enemy
  // numbers on it, capped by the spread rule. When the enemy holds a majority
  // (W8) the reaction is only ever *capped* — down to `COCS_COMEBACK_GARRISON`,
  // and to the token once we are down to our last node — so the surplus
  // re-concentrates without ever stripping a genuinely pushed front.
  const holds = [];
  if (task && task.verb === 'HOLD') holds.push({nodeId: task.nodeId, count: 1});
  if (defence && defence.threat > 0) {
    const {hostile} = localPresence(actors, defence.node, team, THREAT_PAD);
    let count = Math.max(1, Math.min(maxDefenders, Math.round(hostile)));
    if (nodeDeficit) {
      const owned = capturableNodes(state).filter(node => node.owner === team).length;
      const recallCap = owned <= COCS_COMEBACK_DEEP ? Math.max(1, COCS_COMEBACK_GARRISON) : maxDefenders;
      count = Math.min(count, recallCap);
    }
    const existing = holds.find(hold => hold.nodeId === defence.node.id);
    if (existing) existing.count = Math.max(existing.count, count);
    else holds.push({nodeId: defence.node.id, count});
  }
  const duties = [];
  for (const hold of holds) for (let index = 0; index < hold.count; index++) duties.push({nodeId: hold.nodeId, kind: 'hold'});
  if (deficit && comeback.length) {
    // Weakest frontier first, then the next-weakest, so the squad keeps a second
    // threat alive and the re-concentrate never collapses into one all-in stack.
    for (const entry of comeback) {
      if (!duties.some(duty => duty.nodeId === entry.node.id && duty.kind === 'attack')) {
        duties.push({nodeId: entry.node.id, kind: 'attack'});
      }
    }
  } else if (task && task.verb === 'ATTACK') {
    duties.push({nodeId: task.nodeId, kind: 'attack'});
  }
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
  // 2. Attack: fill each duty to the attack cap (spread cap normally, the
  //    balanced comeback split when trailing), primary (weakest task) first.
  for (const duty of duties) {
    if (duty.kind !== 'attack') continue;
    while ((used.get(duty.nodeId) ?? 0) < attackCap && slots.length < roster.length) place(duty.nodeId, 'attack');
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
  // 4. W20 depot weighting: when the squad can spare a body (not trailing, a
  //    legal attack still mounted, a depot near its own half) the weakest attack
  //    slot takes the forward depot instead. It keeps its node as the fallback
  //    push, so once the depot is secured the same bot walks back to the front
  //    and can pick up the loaner on the way.
  const depotDuty = cocsDepotDuty(state, actors, team, {roster, duties});
  let vehicleDuty = null;
  if (depotDuty) {
    let replaceIndex = -1;
    for (let index = slots.length - 1; index >= 0; index--) if (slots[index].kind === 'attack') { replaceIndex = index; break; }
    if (replaceIndex >= 0) {
      const fallbackNode = slots[replaceIndex].nodeId;
      slots[replaceIndex] = {nodeId: fallbackNode, kind: 'depot', depotId: depotDuty.depotId, depotFallback: fallbackNode};
    }
  } else {
    // 4b. W20 vehicle weighting: with the forward depot already ours, one spare
    //     attacker crews the forward loaner and drives it to the front.
    vehicleDuty = cocsVehicleDuty(match, state, team, {roster, duties});
    if (vehicleDuty) {
      let replaceIndex = -1;
      for (let index = slots.length - 1; index >= 0; index--) if (slots[index].kind === 'attack') { replaceIndex = index; break; }
      if (replaceIndex >= 0) {
        const fallbackNode = slots[replaceIndex].nodeId;
        slots[replaceIndex] = {nodeId: fallbackNode, kind: 'vehicle', vehicleId: vehicleDuty.vehicleId, vehicleDepotId: vehicleDuty.depotId, depotFallback: fallbackNode};
      }
    }
  }
  return {roster, duties, slots, cap, maxDefenders, defence, targets, task, holds, deficit, nodeDeficit, comeback, attackCap, depotDuty, vehicleDuty};
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
  return {nodeId: slot.nodeId, kind: slot.kind, role: slot.kind, depotId: slot.depotId ?? null, vehicleId: slot.vehicleId ?? null, depotFallback: slot.depotFallback ?? null, index, team, plan};
}

// ---------------------------------------------------------------------------
// O1c role-agent destinations. Any subagent bought through REINFORCE walks to
// the place its verb works: HARVESTER -> an owned siphon with no hostile inside
// its radius + 10 m (the §8.1 "never enters a contested zone" rule), BUILDER ->
// the nearest broken terminal/device, SCOUT -> its screen node. The plain
// lattice slot is the fallback, so an agent whose verb has no legal target keeps
// fighting with its squad. All lists sorted; no RNG, no actor id branching.
// ---------------------------------------------------------------------------
function hostileNear(match, node, meters) {
  for (const actor of match?.actors ?? []) {
    if (!actor || actor.health <= 0 || actor.team !== 1) continue;
    if (Math.hypot(num(actor.x, 0) - node.x, num(actor.z, 0) - node.z) <= meters) return true;
  }
  return false;
}

function nearestBrokenTarget(match, a, state) {
  let best = null;
  let bestDistance = Infinity;
  const consider = (id, point, y) => {
    if (!point) return;
    const distance = Math.hypot(num(point.x, 0) - num(a.x, 0), num(point.z, 0) - num(a.z, 0));
    if (distance > bestDistance + 1e-9) return;
    if (distance < bestDistance - 1e-9 || !best || id < best.id) {
      bestDistance = distance;
      best = {id, x: num(point.x, 0), y: num(y, 0), z: num(point.z, 0)};
    }
  };
  const devices = state?.traversal?.devices ?? {};
  for (const id of Object.keys(devices).sort()) {
    const device = devices[id];
    if (!device || device.state === 'live') continue;
    consider(id, device.from, device.from?.y);
  }
  const terminals = state?.terminals?.terminals ?? {};
  for (const id of Object.keys(terminals).sort()) {
    const terminal = terminals[id];
    if (!terminal || terminal.state === 'live') continue;
    consider(id, terminal, terminal.y);
  }
  return best;
}

/** The role agent's authored verb destination, or null for the normal duty. */
export function cocsRoleDestination(match, a, state = match?.objectiveState) {
  const role = a?.subagentRole;
  if (!state?.coop || !role || !a || a.health <= 0) return null;
  if (role === 'harvester') {
    // Stay on the node this harvester is already channeling: starting a prime
    // must not move the agent off the channel it just started.
    const channelNode = a.subagentNode ? nodeById(state, a.subagentNode) : null;
    if (channelNode?.primeChannel && channelNode.primeChannel.actor === a.id) {
      return {x: channelNode.x, y: num(channelNode.y, 0), z: channelNode.z};
    }
    const tick = num(state.tick, 0);
    const primed = node => node.primeChannel || (node.prime && tick <= num(node.prime.until, 0));
    for (const node of capturableNodes(state).filter(entry => entry.archetype === 'economy' && entry.owner === 0 && !primed(entry)).sort(idSort)) {
      if (hostileNear(match, node, node.r + 10)) continue;
      return {x: node.x, y: num(node.y, 0), z: node.z};
    }
    return null;
  }
  if (role === 'builder') {
    const target = nearestBrokenTarget(match, a, state);
    return target ? {x: target.x, y: target.y, z: target.z} : null;
  }
  // FIGHTER and SCOUT stay with the squad on the lattice point: the fighter's
  // RALLY and the scout's SPOT both fire in contact, so neither wanders off the
  // front (the SCAN scout already owns long-range screening).
  return null;
}

// A destination inside the target node's radius. `Match.zoneSlot` places
// attackers on a ring facing their own spawn (so the two teams meet across the
// point) and defenders on a defensive ring; reusing it keeps the existing
// cover/step-up reachability checks. A `depot` slot targets the forward depot
// until it is ours, then falls back to its node so the same bot returns to the
// lattice push (and can grab the freshly spawned loaner on the way out).
export function cocsBotDestination(match, a, assignment, state = match?.objectiveState) {
  if (!assignment) return null;
  // An actively channeling HARVESTER holds its node even if its lattice duty
  // changed: starting a prime must not move the agent off the channel.
  const channelNode = a?.subagentNode ? nodeById(state, a.subagentNode) : null;
  if (channelNode?.primeChannel && channelNode.primeChannel.actor === a.id) {
    return {x: channelNode.x, y: num(channelNode.y, 0), z: channelNode.z};
  }
  // OPERATIONS role agents walk to their authored verb before falling back to
  // the normal lattice duty: a HARVESTER to an owned siphon, a BUILDER to a
  // broken terminal/device, a SCOUT to its screen node. Pure and id-free.
  if (assignment.kind === 'hold' || assignment.kind === 'attack') {
    const roleDestination = cocsRoleDestination(match, a, state);
    if (roleDestination) return roleDestination;
  }
  if (assignment.kind === 'depot' && assignment.depotId) {
    const depot = state?.traversal?.depots?.[assignment.depotId];
    if (depot && depot.owner !== a?.team) {
      return {x: num(depot.x, 0), y: num(depot.y, 0), z: num(depot.z, 0)};
    }
    if (depot) assignment = {...assignment, nodeId: assignment.depotFallback ?? assignment.nodeId};
  }
  if (assignment.kind === 'vehicle' && assignment.vehicleId) {
    const vehicle = match?.vehicles?.find(entry => entry && entry.id === assignment.vehicleId);
    // While walking to the loaner the destination is the vehicle; once mounted
    // the same slot routes to the fallback node so the driver takes it forward.
    if (vehicle && vehicle.health > 0 && a?.vehicleId !== assignment.vehicleId) {
      return {x: num(vehicle.position?.x, 0), y: num(vehicle.position?.y, 0), z: num(vehicle.position?.z, 0)};
    }
    if (vehicle) assignment = {...assignment, nodeId: assignment.depotFallback ?? assignment.nodeId};
  }
  if (assignment.nodeId === null || assignment.nodeId === undefined) return null;
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

// ---------------------------------------------------------------------------
// W20 tactical traversal choice. Pure and deterministic: given the bot's
// current destination it returns the one device worth routing through, or null.
// A device is used only when it saves real travel (or opens a disengage) and
// its landing is not a defended trap; a dead/cut/locked device is never chosen.
// `state.traversal.botUse` gates the whole pass, so bot-use-off is byte-identical.
// ---------------------------------------------------------------------------
const toDevicePoint = value => {
  if (!value) return null;
  const x = Array.isArray(value) ? value[0] : value.x;
  const z = Array.isArray(value) ? value[1] : value.z;
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) return null;
  const y = Array.isArray(value) ? value[2] : value.y;
  return {x: Number(x), z: Number(z), y: Number.isFinite(Number(y)) ? Number(y) : 0, r: Number.isFinite(Number(value.r)) ? Number(value.r) : 5};
};

function nearestHostile(actors, at, team) {
  let best = Infinity;
  for (const actor of actors ?? []) {
    if (!actor || actor.health <= 0 || actor.team !== 1 - team) continue;
    best = Math.min(best, Math.hypot((actor.x ?? 0) - at.x, (actor.z ?? 0) - at.z));
  }
  return best;
}

export function cocsTraversalChoice(match, a, destination, state = match?.objectiveState) {
  const traversal = state?.traversal;
  if (!traversal || traversal.botUse !== true || !a || !destination) return null;
  if (traversal.botUseTeam !== null && traversal.botUseTeam !== undefined && a.team !== traversal.botUseTeam) return null;
  if (a.vehicleId !== null && a.vehicleId !== undefined) return null;
  if (a.health <= 0) return null;
  if (num(traversal.cooldowns?.[a.id], 0) > 0) return null;
  const dest = {x: num(destination.x, 0), z: num(destination.z, 0)};
  const direct = Math.hypot(dest.x - num(a.x, 0), dest.z - num(a.z, 0));
  if (!(direct > 1)) return null;
  const actors = match?.actors ?? [];
  const team = a.team;
  const health = num(a.health, 0) / Math.max(1, num(a.maxHealth, 100));
  const retreating = health <= COCS_DEVICE_RETREAT_HEALTH || num(a.bot?.suppressed, 0) > 0;
  const hostilesBefore = nearestHostile(actors, {x: num(a.x, 0), z: num(a.z, 0)}, team);
  let best = null;
  for (const id of Object.keys(traversal.devices ?? {}).sort()) {
    const device = traversal.devices[id];
    if (!device || device.state !== 'live' || !device.from) continue;
    if (device.kind === 'jump-pad' && a.grounded !== true) continue;
    const anchor = toDevicePoint(device.from);
    const landing = toDevicePoint(device.arrival ?? device.target ?? device.to);
    if (!anchor || !landing) continue;
    const reach = Math.hypot(anchor.x - num(a.x, 0), anchor.z - num(a.z, 0));
    const after = Math.hypot(landing.x - dest.x, landing.z - dest.z);
    const gain = direct - (reach + after);
    const threshold = Math.max(COCS_DEVICE_MIN_GAIN, direct * COCS_DEVICE_MIN_FRACTION);
    const presence = localPresence(actors, {x: landing.x, z: landing.z, r: landing.r}, team, COCS_DEVICE_LANDING_PAD);
    let score = null;
    // Push: the hop must beat walking and the landing must not be an enemy
    // ambush — a push hop is only taken when nobody hostile waits on the pad.
    if (gain >= threshold && reach <= direct + COCS_DEVICE_MAX_DETOUR && presence.hostile === 0) score = gain;
    if (score === null && retreating && reach <= direct + COCS_DEVICE_MAX_DETOUR) {
      const hostilesAfter = nearestHostile(actors, {x: landing.x, z: landing.z}, team);
      if (hostilesAfter > hostilesBefore + COCS_DEVICE_RETREAT_GAIN && hostilesAfter > landing.r + COCS_DEVICE_LANDING_PAD) score = hostilesAfter - hostilesBefore;
    }
    if (score === null) continue;
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && id < best.deviceId)) {
      best = {deviceId: id, kind: device.kind, lane: device.lane ?? null, x: anchor.x, y: anchor.y, z: anchor.z, score, gain, reason: gain >= threshold && score === gain ? 'route' : 'retreat'};
    }
  }
  return best;
}

// The neutral/enemy forward depots a team could take, best first: value then
// distance from the team HQ. Only depots near the team's own half qualify, so a
// squad never crosses the map for a loaner.
export function cocsDepotTargets(state, actors = [], team) {
  const traversal = state?.traversal;
  if (!state || state.kind !== COCS_KIND || !traversal?.depots) return [];
  const hq = hqFor(state, team) ?? {x: 0, z: 0};
  const list = [];
  for (const id of Object.keys(traversal.depots).sort()) {
    const depot = traversal.depots[id];
    if (!depot || depot.hq === true) continue;
    const owner = depot.owner === 0 || depot.owner === 1 ? depot.owner : null;
    if (owner === team) continue;
    const distance = Math.hypot(depot.x - hq.x, depot.z - hq.z);
    if (distance > COCS_DEPOT_MAX_DISTANCE) continue;
    const value = (owner === null ? 3 : 2) - (depot.contested === true ? 1 : 0);
    list.push({depot, depotId: id, distance, value, owner, contested: depot.contested === true});
  }
  return list.sort((a, b) => (b.value - a.value) || (a.distance - b.distance) || (a.depotId < b.depotId ? -1 : 1));
}

// One depot duty per team when the squad can spare a body. Never while trailing
// (the W8 comeback keeps every body on the lattice), never before first contact,
// and only if the plan still mounts a legal attack.
export function cocsDepotDuty(state, actors = [], team, plan = null) {
  const traversal = state?.traversal;
  if (!state || state.kind !== COCS_KIND || !traversal?.depots) return null;
  // The whole W20 autopilot is opt-in: with `traversalBotUse` off the squad
  // keeps the pre-W20 pure-lattice behaviour, so the W7/W8/W10 gates are
  // untouched by default.
  if (traversal.botUse !== true) return null;
  if (traversal.botUseTeam !== null && traversal.botUseTeam !== undefined && traversal.botUseTeam !== team) return null;
  if (cocsDeficit(state, team)) return null;
  const roster = plan?.roster ?? [];
  if (roster.length < COCS_DEPOT_MIN_ROSTER) return null;
  if ((plan?.duties ?? []).filter(duty => duty.kind === 'attack').length < COCS_DEPOT_MIN_ATTACKS) return null;
  if (num(state.tick, 0) < COCS_DEPOT_OPENING_TICKS) return null;
  const targets = cocsDepotTargets(state, actors, team);
  return targets[0] ?? null;
}

// One vehicle duty per team when a ready loaner exists: a bot walks to the
// nearest forward-available depot Puma, drives it to its fallback node and
// dismounts there (the driver-dismount rule in `bots.mjs`). Deterministic and
// only one body at a time, so it never strips the front.
export function cocsVehicleDuty(match, state, team, plan = null) {
  const traversal = state?.traversal;
  if (!state || state.kind !== COCS_KIND || !traversal?.depots || traversal.botUse !== true) return null;
  if (traversal.botUseTeam !== null && traversal.botUseTeam !== undefined && traversal.botUseTeam !== team) return null;
  if (cocsDeficit(state, team)) return null;
  const roster = plan?.roster ?? [];
  if (roster.length < COCS_DEPOT_MIN_ROSTER) return null;
  if (num(state.tick, 0) < COCS_DEPOT_OPENING_TICKS) return null;
  const enemy = hqFor(state, 1 - team) ?? {x: 0, z: 0};
  const vehicles = match?.vehicles ?? [];
  let best = null;
  for (const id of Object.keys(traversal.depots).sort()) {
    const depot = traversal.depots[id];
    if (!depot || depot.owner !== team || depot.vehicleId === null || depot.vehicleId === undefined) continue;
    const vehicle = vehicles.find(entry => entry && entry.id === depot.vehicleId);
    if (!vehicle || !(vehicle.health > 0) || vehicle.driver !== null) continue;
    if (num(vehicle.spawnImmunity, 0) > 0) continue;
    const distance = Math.hypot(depot.x - enemy.x, depot.z - enemy.z);
    if (!best || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) < 1e-9 && id < best.depotId)) {
      best = {vehicleId: vehicle.id, depotId: id, distance, x: num(vehicle.position?.x, depot.x), y: num(vehicle.position?.y, 0), z: num(vehicle.position?.z, depot.z)};
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// §8 SCOUT policy (V0b). `cocsScoutInput` is deliberately RNG-free and never
// reaches the combat branch of `botInput`: a scout walks to its scan area, then
// home, and does not fire. `cocsScanTarget` picks the screen node the Chief
// asks for: an enemy-held node first, then a contested one, never an owned
// quiet rear.
// ---------------------------------------------------------------------------
export function cocsScanTarget(state, team) {
  let best = null;
  let bestScore = -Infinity;
  for (const node of capturableNodes(state).filter(entry => entry.live === true).sort(idSort)) {
    const enemyHeld = node.owner === 1 - team;
    const contested = (node.progress?.[team] ?? 0) > 0 || (node.progress?.[1 - team] ?? 0) > 0;
    const score = (enemyHeld ? 3 : 0) + (contested ? 2 : 0) + (node.owner === team ? -1 : 0);
    if (score > bestScore) { bestScore = score; best = node; }
  }
  return best;
}

// A live scout from the policy's point of view (the actor roster, not the
// engine's slot table, so unit tests can drive this with plain objects).
function liveScout(actors, state, team) {
  const id = state?.scouts?.[team];
  if (id === null || id === undefined) return null;
  const actor = (actors ?? []).find(entry => entry && entry.id === id);
  if (!actor || actor.isScout !== true || actor.scoutActive === false || actor.health <= 0) return null;
  return actor;
}

// Lightweight deterministic nav routing for scouts. The engine's bot brain
// already owns `route`, so scout routing reuses that field; it is a plain
// unweighted BFS over the cached nav graph and never draws the RNG.
function scoutNearestNode(match, x, z) {
  let best = 0;
  let bestDistance = Infinity;
  const nav = match?.nav ?? [];
  for (let index = 0; index < nav.length; index++) {
    const distance = Math.hypot(nav[index].x - x, nav[index].z - z);
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  }
  return best;
}

function scoutRoute(match, from, to) {
  const nav = match?.nav ?? [];
  const edges = match?.edges ?? [];
  if (!nav.length) return null;
  const start = scoutNearestNode(match, from.x, from.z);
  const goal = scoutNearestNode(match, to.x, to.z);
  if (start === goal) return [start];
  const prev = new Int32Array(nav.length).fill(-1);
  const seen = new Uint8Array(nav.length);
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    if (node === goal) break;
    for (const next of edges[node] ?? []) {
      if (!Number.isInteger(next) || next < 0 || next >= nav.length || seen[next]) continue;
      seen[next] = 1;
      prev[next] = node;
      queue.push(next);
    }
  }
  if (!seen[goal]) return null;
  const route = [];
  for (let node = goal; node !== -1; node = prev[node]) route.push(node);
  route.reverse();
  return route;
}

// Scout movement: pure, deterministic, no RNG and no combat. The engine's actor
// loop integrates the returned input through the normal movement path.
export function cocsScoutInput(match, a) {
  const state = match?.objectiveState;
  if (!state || state.kind !== COCS_KIND) return {};
  if (!a || a.isScout !== true || a.scoutActive === false) return {};
  if (a.scoutIdle === true) return {};
  const target = a.scoutTarget;
  if (!target) return {};
  const arrive = a.scoutReturning === true ? COCS_SCAN_ARRIVE : Math.max(1.5, COCS_SCAN_ARRIVE * 0.75);
  const direct = Math.hypot(target.x - a.x, target.z - a.z);
  if (direct <= arrive) return {};
  const b = a.bot ?? (a.bot = {route: []});
  // Replan when the route is empty, the destination drifts, or ~0.9 s elapses.
  const drifted = !b.routeDest || Math.hypot(target.x - b.routeDest.x, target.z - b.routeDest.z) > 2;
  if (!b.route?.length || drifted || num(b.routeAt, -1) <= num(match.time, 0)) {
    b.route = scoutRoute(match, {x: a.x, z: a.z}, target) ?? [];
    b.routeAt = num(match.time, 0) + 0.9;
    b.routeDest = {x: target.x, z: target.z};
  }
  while (b.route.length > 1) {
    const node = match.nav?.[b.route[0]];
    if (node && Math.hypot(node.x - a.x, node.z - a.z) < 2) b.route.shift();
    else break;
  }
  const waypoint = b.route.length ? match.nav?.[b.route[0]] : null;
  const point = waypoint ?? target;
  const dx = point.x - a.x, dz = point.z - a.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.5) return {};
  return {x: dx / distance, z: dz / distance, sprint: true};
}

function num(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
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
    // §8 SCAN: on the slower screening cadence, ask for a scout when none is
    // alive and the team can pay. Appended after the duty order so the
    // HOLD/ATTACK surface is unchanged and sorts first by cardId.
    if (tick % POLICY_SCAN_INTERVAL === 0 && !liveScout(actors, state, team) && (Number(state.flux?.[team]) || 0) >= SUBAGENTS.scout.spawnCost) {
      const scan = cocsScanTarget(state, team);
      if (scan) orders.push({tick, peerId: `chief-${team}`, cardId: `scan-${team}-${tick}`, team, verb: 'SCAN', target: scan.id});
    }
  }
  return orders;
}
