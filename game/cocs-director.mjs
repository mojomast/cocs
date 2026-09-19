// ---------------------------------------------------------------------------
// LATTICE STRIKE: OPERATIONS — the Operations Director planner (pure).
//
// The Director is a visible, deterministic PRESSURE budget + scheduler, not a
// third team and not the cinematic `director.mjs`. This module owns the parts
// that can be reasoned about without an engine: the pacing machine, budget
// accrual, weakest-front retargeting, and LoS-safe telegraphed spawn selection.
//
// It imports NOTHING: every function takes plain `state`/`actors`/`nav` data
// and an injected `canSee(actor, point)` predicate. That keeps it cycle-free
// and unit-testable in isolation. The engine wiring lives in `cocs-coop.mjs`.
// ---------------------------------------------------------------------------

import {COOP_PACING, directorTier, normalizeCocsTier} from './cocs-difficulty.mjs';

const CAPTURABLE = Object.freeze(['front', 'economy', 'relay']);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const isCapturable = node => CAPTURABLE.includes(node?.archetype);
const idSort = (a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''));

export const DIRECTOR_PHASES = Object.freeze(['intermission', 'build_up', 'peak', 'relax']);

// L4D pacing machine. `into` and `length` are tick counts inside the wave.
export function directorPhase(intoTicks, waveTicks, intermission = false) {
  if (intermission) return 'intermission';
  const length = Math.max(1, num(waveTicks, 1));
  const into = Math.max(0, num(intoTicks, 0));
  if (into < length * COOP_PACING.buildUpFraction) return 'build_up';
  if (into < length * COOP_PACING.peakFraction) return 'peak';
  return 'relax';
}

// PRESSURE/second for a tier at a phase. RELAX keeps a trickle so the wave can
// still be topped up, but the PEAK is where the budget actually threatens.
export function directorRate(tierId, phase) {
  const tier = directorTier(normalizeCocsTier(tierId));
  const factor = COOP_PACING.rateFactor[phase] ?? 0;
  return tier.rate * factor;
}

export function directorCap(tierId) {
  return directorTier(normalizeCocsTier(tierId)).cap;
}

export function directorSpend(current, cost, cap = Infinity) {
  const have = Math.max(0, num(current, 0));
  const price = Math.max(0, num(cost, 0));
  if (have + 1e-9 < price) return null;
  return Math.min(num(cap, Infinity), have - price);
}

export function directorAccrue(current, tickRate, dt, cap) {
  const grown = Math.max(0, num(current, 0)) + Math.max(0, num(tickRate, 0)) * Math.max(0, num(dt, 0));
  return Math.min(num(cap, Infinity), grown);
}

// Weakness of a node from the Director's (team 1) point of view. Mirrors
// `cocsWeakness` in cocs-bots.mjs: fewer living defenders first, then the
// defenders' banked progress, then how much the Director has already banked.
// Lower is weaker. Actor-array-order independent.
export function directorWeakness(actors, node, team = 1) {
  const other = 1 - team;
  const pad = 10;
  let defenders = 0;
  for (const actor of actors ?? []) {
    if (!actor || actor.health <= 0 || actor.team !== other) continue;
    if (Math.hypot(num(actor.x, 0) - node.x, num(actor.z, 0) - node.z) <= (node.r ?? 4) + pad) defenders++;
  }
  const enemyProgress = num(node.progress?.[other], 0);
  const ownProgress = num(node.progress?.[team], 0);
  return defenders * 4 + enemyProgress * 3 - ownProgress * 3;
}

// The weakest team-0-held capturable nodes the Director can legally pressure
// (any held node adjacent to Director territory). Ties break by node id, never
// by array order. `count` simultaneous fronts come back weakest-first.
export function directorFronts(state, actors, {team = 1, count = 1, tier = null} = {}) {
  const wanted = Math.max(1, num(count, 1));
  const adjacency = state?.adjacency ?? {};
  const nodes = (state?.nodes ?? []).filter(node => isCapturable(node) && node.owner === 1 - team);
  const reachable = nodes.filter(node => {
    const neighbours = adjacency[node.id] ?? [];
    return neighbours.some(id => (state.nodes ?? []).find(entry => entry.id === id)?.owner === team);
  });
  const pool = reachable.length ? reachable : nodes;
  const ranked = [...pool].sort((a, b) =>
    directorWeakness(actors, a, team) - directorWeakness(actors, b, team) || idSort(a, b));
  void tier;
  return ranked.slice(0, wanted).map(node => ({nodeId: node.id, weakness: directorWeakness(actors, node, team)}));
}

// Deterministic reinforcement order for a wave: authored composition order,
// highest count first then type name, so the same plan always spends the same.
export function directorReinforcementOrder(composition) {
  return Object.entries(composition ?? {})
    .filter(([, count]) => Math.max(0, Math.round(num(count, 0))) > 0)
    .sort((a, b) => (Math.round(num(b[1], 0)) - Math.round(num(a[1], 0))) || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({type, count: Math.max(1, Math.round(num(count, 0)))}));
}

// Boss alternation: one documented draw from `match.random()` at run start.
export function directorBossType(roll) {
  return num(roll, 0) < 0.5 ? 'warden' : 'harbinger';
}

// Legal spawn points: candidates sorted deterministically, filtered to be out
// of every living team-0 player's line of sight, >= minDistance from every one
// of them, and outside every capture radius (map spec §6.8 arrival doctrine).
export function directorSpawnCandidates(state, nav = []) {
  const points = [];
  const seen = new Set();
  const push = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const key = `${x.toFixed(3)},${z.toFixed(3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push({x, z});
  };
  for (const node of state?.nodes ?? []) push(node.x, node.z);
  for (const point of nav ?? []) push(point.x, point.z);
  return points;
}

export function directorPickSpawn(state, actors, nav, {
  nodeId = null, minDistance = 15, canSee = null, spawnRadius = 8,
} = {}) {
  const target = (state?.nodes ?? []).find(node => node.id === nodeId) ?? null;
  const players = (actors ?? []).filter(actor => actor && actor.health > 0 && actor.team === 0);
  const candidates = directorSpawnCandidates(state, nav).map(point => ({
    ...point,
    distance: target ? Math.hypot(point.x - target.x, point.z - target.z) : 0,
  })).sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
  const nodes = state?.nodes ?? [];
  for (const point of candidates) {
    let legal = true;
    for (const actor of players) {
      if (Math.hypot(actor.x - point.x, actor.z - point.z) < minDistance) { legal = false; break; }
      if (typeof canSee === 'function' && canSee(actor, point)) { legal = false; break; }
    }
    if (!legal) continue;
    for (const node of nodes) {
      if (Math.hypot(node.x - point.x, node.z - point.z) <= (node.r ?? 4) + 2) { legal = false; break; }
    }
    if (!legal) continue;
    return {x: point.x, z: point.z, nodeId, radius: spawnRadius};
  }
  return null;
}

// True when every id in `ids` is dead (missing ids count as dead). Mirrors the
// horde `aliveEnemies(...) === 0` clear check.
export function directorForceAlive(actors, ids) {
  for (const id of ids ?? []) {
    const actor = (actors ?? []).find(entry => entry && entry.id === id);
    if (actor && actor.health > 0) return true;
  }
  return false;
}

// SIEGE_KEYS is the published, player-facing arm rule. The engine applies it;
// this pure helper exists so the rule can be unit-tested without a match.
export function siegeShouldArm({armed, wave, waveArm, ownsCapturable, armMajority}) {
  if (ownsCapturable >= 5) return true;
  if (wave >= waveArm && ownsCapturable >= armMajority) return true;
  return armed === true;
}

export function siegeShouldLift({armed, ownsCapturable, armMajority}) {
  return armed === true && ownsCapturable < armMajority;
}
