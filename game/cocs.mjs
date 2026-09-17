// ---------------------------------------------------------------------------
// LATTICE STRIKE (`cocs`) — V0a "Lattice" slice.
//
// One self-contained module for the whole V0a objective: the template, the
// `stepCocs` update, the id-keyed snapshot subtree, the outcome helper and the
// pure lattice helpers (adjacency legality, connectivity income, live-node
// selection, front state). Dispatched by `objectiveState.kind==='cocs'`; it
// never falls through to the generic zone loop (game/objectives.mjs).
//
// V0a deliberately contains NO agents, FLUX/REQ economy, board, terminals,
// camera or networking. What it does contain:
//   * a 5-capturable-node lattice (plus 2 HQ + 2 ARRAY anchors), read from an
//     authored `arena.nodes` + `arena.lattice` when present, otherwise
//     synthesized deterministically from the map's objective zones / nav nodes
//     and clearly marked `synthesized:true`;
//   * adjacency-locked capture (a node is capturable only when adjacent to a
//     node the team already owns — back-caps are impossible);
//   * connectivity income (a node only pays while a same-team path links it
//     back to its HQ; a link-cut denies it and everything downstream);
//   * live-node selection (3 in the opening, up to 5 in the mid game, all
//     capturable nodes in the endgame);
//   * one front indicator plus a deterministic duty-AI order hook.
//
// Determinism contract (§11.6):
//   * one injected RNG (`match.random`) and nothing else; never `Math.random`;
//   * `stepCocs` is invoked exactly once per `Match.step`, from
//     `updateObjectives`, after the per-actor loop and before any generic
//     objective processing. That is the single fixed point where a
//     `cocsPolicy` may draw from `match.random`; the number of draws is
//     entirely policy-defined and therefore deterministic for a fixed dt;
//   * every order (from `options.cocsPolicy` or from
//     `match.step(dt,{cocs:{orders}})`) is sorted by `(tick, peerId, cardId)`
//     before it is applied, so the outcome cannot depend on network arrival
//     order;
//   * all timers are tick counts at `RULES.dt=1/60`, no wall-clock.
// ---------------------------------------------------------------------------

import {modeRule} from './config.mjs';
import {RULES} from './data.mjs';
import {terrainSupportAt} from './terrain.mjs';

export const COCS_KIND = 'cocs';
// The frozen node archetypes. Authored maps may spell a few of these
// differently (`infrastructure`/`foundry` are the map-spec names for a relay);
// `normalizeArchetype` folds them onto this set.
export const COCS_ARCHETYPES = Object.freeze(['front', 'economy', 'relay', 'hq', 'array']);
export const COCS_CAPTURABLE = Object.freeze(['front', 'economy', 'relay']);
export const COCS_ANCHORS = Object.freeze(['hq', 'array']);
export const COCS_ORDER_VERBS = Object.freeze(['HOLD', 'ATTACK']);
// FLUX/second a connected node pays (V0a has no FLUX pool yet, so this also
// seeds the objective score-at-time). Mirrors mode spec §4.2.
export const COCS_INCOME = Object.freeze({front: 1, economy: 3, relay: 0, hq: 0, array: 0});
// Objective score banked when a node flips. Objectives are primary (§6A.4).
export const COCS_CAPTURE_POINTS = Object.freeze({front: 10, economy: 15, relay: 20, hq: 0, array: 50});
export const COCS_OPENING_FRACTION = 0.22;
export const COCS_ENDGAME_FRACTION = 0.68;
export const COCS_ORDER_LOG_LIMIT = 64;
const DEFAULT_RADIUS = 4;
const DEFAULT_CAPTURE_SECONDS = 5;
const ORDER_TTL_SECONDS = 2;
const EPSILON = 1e-9;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const num = (value, fallback) => (finite(value) ? value : fallback);
const clamp01 = value => Math.max(0, Math.min(1, value));

// ---------------------------------------------------------------------------
// Pure small helpers.
// ---------------------------------------------------------------------------
const ARCHETYPE_ALIASES = Object.freeze({
  front: 'front', fort: 'front', bastion: 'front',
  economy: 'economy', econ: 'economy', siphon: 'economy', extractor: 'economy',
  relay: 'relay', infrastructure: 'relay', infra: 'relay', foundry: 'relay', 'array-relay': 'relay', arrayrelay: 'relay',
  hq: 'hq', headquarters: 'hq',
  array: 'array',
});

export function normalizeArchetype(kind) {
  const key = String(kind ?? '').trim().toLowerCase();
  return ARCHETYPE_ALIASES[key] ?? 'front';
}

export const isCapturableArchetype = archetype => COCS_CAPTURABLE.includes(archetype);

const arenaBounds = arena => arena?.playBounds ?? arena?.bounds ?? {minX: -64, maxX: 64, minZ: -44, maxZ: 44};

function groundY(arena, x, z) {
  if (!arena?.terrain) return 0;
  const support = terrainSupportAt(x, z, arena.terrain, arena.terrain.maxSlope ?? 0.9);
  return support ? num(support.y, 0) : 0;
}

const clearOfBlocks = (arena, x, z, r, y) =>
  !(arena?.blocks ?? []).some(block => Math.abs(x - block.x) < block.w / 2 + r && Math.abs(z - block.z) < block.d / 2 + r && y < block.h - 1e-6);

export function nodeById(state, id) {
  if (!state || id === null || id === undefined) return null;
  const key = String(id);
  return (state.nodes ?? []).find(node => node.id === key) ?? null;
}

export function capturableNodes(state) {
  return (state?.nodes ?? []).filter(node => isCapturableArchetype(node.archetype));
}

export function anchorNodes(state, archetype = null) {
  return (state?.nodes ?? []).filter(node => COCS_ANCHORS.includes(node.archetype) && (archetype === null || node.archetype === archetype));
}

export function neighbors(state, id) {
  const adjacency = state?.adjacency;
  if (adjacency && Object.hasOwn(adjacency, String(id))) return adjacency[String(id)];
  return [];
}

// ---------------------------------------------------------------------------
// Authored maps (`map.lattice` + `map.nodes`, map spec §5.1). Nodes use the
// map-spec `kind`/`radius` spelling and may declare `owner`/`team` for the HQ
// and ARRAY anchors. Edges may be a bare `[[a,b], ...]` array or nested under
// `arena.lattice.edges`. Anything the author omits is repaired deterministically.
// ---------------------------------------------------------------------------
function normalizeEdges(source, nodes) {
  const ids = new Set(nodes.map(node => node.id));
  const seen = new Set();
  const edges = [];
  for (const raw of source ?? []) {
    const a = String(Array.isArray(raw) ? raw[0] : raw?.a);
    const b = String(Array.isArray(raw) ? raw[1] : raw?.b);
    if (a === b || !ids.has(a) || !ids.has(b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  return edges;
}

function chainEdges(nodes) {
  // Deterministic fallback for an authored node list with no edges: a west-to
  // east chain, then any leftover node hung off its nearest neighbour.
  const ordered = [...nodes].sort((a, b) => a.x - b.x || a.z - b.z || a.id.localeCompare(b.id));
  const edges = [];
  for (let i = 1; i < ordered.length; i++) edges.push([ordered[i - 1].id, ordered[i].id]);
  return edges;
}

function readAuthoredLattice(arena) {
  const raw = arena?.nodes;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const centerX = (num(arenaBounds(arena).minX, 0) + num(arenaBounds(arena).maxX, 0)) / 2;
  const nodes = raw.map((entry, index) => {
    if (!entry) return null;
    const id = String(entry.id ?? `cocs-${index}`);
    const archetype = normalizeArchetype(entry.archetype ?? entry.kind);
    const x = num(entry.x, 0);
    const z = num(entry.z, 0);
    const r = num(entry.radius ?? entry.r, DEFAULT_RADIUS);
    const y = finite(entry.y) ? entry.y : groundY(arena, x, z);
    let owner = entry.owner ?? entry.team;
    if (owner === undefined || owner === null) {
      // Anchors default to the side of the map they sit on; capturable nodes
      // start neutral.
      if (archetype === 'hq' || archetype === 'array') owner = x < centerX ? 0 : 1;
      else owner = null;
    }
    if (owner !== 0 && owner !== 1) owner = null;
    return {id, x, z, y, r, archetype, owner, progress: {0: 0, 1: 0}, contested: false, live: false};
  }).filter(Boolean);
  if (!nodes.length) return null;
  let source = null;
  if (Array.isArray(arena.lattice)) source = arena.lattice;
  else if (Array.isArray(arena.lattice?.edges)) source = arena.lattice.edges;
  else if (Array.isArray(arena.edges)) source = arena.edges;
  let edges = normalizeEdges(source, nodes);
  if (!edges.length) edges = chainEdges(nodes);
  return {nodes, edges, synthesized: false};
}

// ---------------------------------------------------------------------------
// Deterministic V0a stand-in lattice.
//
// 5 capturable nodes (front-w, econ-w, relay-c, econ-e, front-e) plus the two
// HQ anchors and two ARRAY anchors the frozen archetype set expects. Positions
// are derived from the arena bounds (rot-180 symmetric) and snapped to the
// nearest clear authored objective/nav point so the stand-in still stands on
// walkable ground. Clearly marked `synthesized:true`; an authored
// `arena.nodes` + `arena.lattice` always wins.
// ---------------------------------------------------------------------------
function synthPool(arena) {
  const pool = [];
  const push = value => {
    const x = Array.isArray(value) ? value[0] : value?.x;
    const z = Array.isArray(value) ? value[1] : value?.z;
    if (!finite(x) || !finite(z)) return;
    if (pool.some(point => Math.abs(point.x - x) < 1e-6 && Math.abs(point.z - z) < 1e-6)) return;
    pool.push({x, z});
  };
  for (const zone of arena?.objectiveZones ?? []) push(zone);
  for (const node of arena?.navNodes ?? []) push(node);
  for (const spawn of arena?.spawns ?? []) push(spawn);
  return pool;
}

function snapClear(arena, x, z, pool, used, r) {
  const y = groundY(arena, x, z);
  if (clearOfBlocks(arena, x, z, r, y) && !used.has(`${x.toFixed(3)},${z.toFixed(3)}`)) {
    used.add(`${x.toFixed(3)},${z.toFixed(3)}`);
    return {x, z};
  }
  let best = null;
  let bestDistance = Infinity;
  for (const point of pool) {
    const key = `${point.x.toFixed(3)},${point.z.toFixed(3)}`;
    if (used.has(key)) continue;
    const py = groundY(arena, point.x, point.z);
    if (!clearOfBlocks(arena, point.x, point.z, r, py)) continue;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < bestDistance) { bestDistance = distance; best = point; }
  }
  if (best) {
    used.add(`${best.x.toFixed(3)},${best.z.toFixed(3)}`);
    return {x: best.x, z: best.z};
  }
  used.add(`${x.toFixed(3)},${z.toFixed(3)}`);
  return {x, z};
}

function synthesizeLattice(arena) {
  const bounds = arenaBounds(arena);
  const minX = num(bounds.minX, -64), maxX = num(bounds.maxX, 64);
  const minZ = num(bounds.minZ, -44), maxZ = num(bounds.maxZ, 44);
  const width = maxX - minX || 1, depth = maxZ - minZ || 1;
  const pool = synthPool(arena), used = new Set();
  // Fractions of the play band; z fractions keep the economy siphons off-lane.
  const place = (fx, fz) => snapClear(arena, minX + fx * width, minZ + fz * depth, pool, used, 1.2);
  const at = (fx, fz) => { const point = place(fx, fz); return {x: point.x, z: point.z}; };
  const make = (id, archetype, fx, fz, owner, radius = DEFAULT_RADIUS) => {
    const point = at(fx, fz);
    return {id, x: point.x, z: point.z, y: groundY(arena, point.x, point.z), r: radius, archetype, owner, progress: {0: 0, 1: 0}, contested: false, live: false};
  };
  const nodes = [
    make('hq-w', 'hq', 0.03, 0.5, 0),
    make('front-w', 'front', 0.20, 0.5, null),
    make('econ-w', 'economy', 0.34, 0.22, null),
    make('relay-c', 'relay', 0.50, 0.5, null),
    make('econ-e', 'economy', 0.66, 0.78, null),
    make('front-e', 'front', 0.80, 0.5, null),
    make('hq-e', 'hq', 0.97, 0.5, 1),
    make('array-w', 'array', 0.005, 0.5, 0, 3),
    make('array-e', 'array', 0.995, 0.5, 1, 3),
  ];
  const edges = [
    ['array-w', 'hq-w'], ['array-w', 'front-w'],
    ['hq-w', 'front-w'], ['hq-w', 'relay-c'],
    ['front-w', 'econ-w'], ['relay-c', 'econ-w'],
    ['relay-c', 'econ-e'], ['front-e', 'econ-e'],
    ['hq-e', 'front-e'], ['hq-e', 'relay-c'],
    ['array-e', 'hq-e'], ['array-e', 'front-e'],
  ];
  return {nodes, edges, synthesized: true};
}

function buildAdjacency(edges) {
  const adjacency = {};
  for (const [a, b] of edges ?? []) {
    (adjacency[a] ??= []).push(b);
    (adjacency[b] ??= []).push(a);
  }
  for (const key of Object.keys(adjacency)) adjacency[key] = [...new Set(adjacency[key])];
  return adjacency;
}

// ---------------------------------------------------------------------------
// Template.
// ---------------------------------------------------------------------------
export function cocsTemplate(mode, arena, config = {}) {
  const rules = modeRule(mode);
  const objective = rules.objective ?? {};
  const authored = readAuthoredLattice(arena);
  const source = authored ?? synthesizeLattice(arena);
  const captureSeconds = Math.max(0.5, num(config?.objective?.captureSeconds ?? objective.captureSeconds, DEFAULT_CAPTURE_SECONDS));
  const capturable = source.nodes.filter(node => isCapturableArchetype(node.archetype));
  // Standard: hold 5 of 7; Skirmish: hold 4 of 5. `ceil(2/3 · n)` agrees with
  // both, so an authored lattice scales without touching the mode row.
  const dominanceCount = Math.max(1, Math.round(num(objective.dominanceCount, Math.ceil(capturable.length * 2 / 3))));
  const dominanceFastCount = Math.max(dominanceCount, Math.round(num(objective.dominanceFastCount, Math.min(capturable.length, dominanceCount + 1))));
  const state = {
    kind: COCS_KIND,
    nodes: source.nodes,
    edges: source.edges,
    zones: [],                    // capturable node centres; kept for map-layout/snapshot compatibility
    liveNodeIds: [],
    winner: null,
    // --- internal V0a bookkeeping (never part of the frozen snapshot) ---
    synthesized: source.synthesized === true,
    adjacency: buildAdjacency(source.edges),
    phase: 'opening',
    endgame: false,
    captureSeconds,
    liveMin: Math.max(1, Math.round(num(objective.liveOpening, 3))),
    liveMax: Math.max(1, Math.round(num(objective.liveMax, 5))),
    endgameLive: Math.max(1, Math.round(num(objective.endgameLive, 5))),
    dominanceCount,
    dominanceFastCount,
    dominanceHold: Math.max(1, num(objective.dominanceHold, 90)),
    dominanceFast: Math.max(1, num(objective.dominanceFast, 45)),
    dominance: {team: null, progress: 0, target: Math.max(1, num(objective.dominanceHold, 90)), fast: false},
    scores: {0: 0, 1: 0},
    income: {0: 0, 1: 0},
    cuts: [],
    tasks: {0: null, 1: null},
    pendingOrders: [],
    orderLog: [],
    orderTtlTicks: Math.max(1, Math.round(ORDER_TTL_SECONDS / (RULES.dt || 1 / 60))),
    tick: 0,
    front: null,
    arrayWinner: null,
    winReason: null,
  };
  state.zones = capturable.map(node => ({id: node.id, x: node.x, z: node.z, y: node.y, radius: node.r}));
  updateLiveNodes(state);
  state.front = frontState(state);
  return state;
}

// ---------------------------------------------------------------------------
// Live-node selection. A capturable node is live when it is owned or adjacent
// to an owned node; the phase then clamps the set (3 opening / up to 5 mid /
// every capturable node endgame, after §3.2 and §4.1).
// ---------------------------------------------------------------------------
export function updateLiveNodes(state) {
  const capturable = capturableNodes(state);
  const index = new Map(state.nodes.map(node => [node.id, node]));
  const desired = new Set();
  for (const node of capturable) if (node.owner === 0 || node.owner === 1) desired.add(node.id);
  for (const node of capturable) {
    if (desired.has(node.id)) continue;
    if (neighbors(state, node.id).some(id => { const other = index.get(id); return other && (other.owner === 0 || other.owner === 1); })) desired.add(node.id);
  }
  let cap;
  if (state.endgame) cap = Math.max(state.endgameLive, desired.size);
  else if (state.phase === 'opening') cap = state.liveMin;
  else cap = state.liveMax;
  // Pad to the floor (3) and, in the endgame, to the guaranteed live count.
  for (const node of capturable) { if (desired.size >= state.liveMin) break; desired.add(node.id); }
  if (state.endgame) for (const node of capturable) { if (desired.size >= cap) break; desired.add(node.id); }
  const ordered = capturable.filter(node => desired.has(node.id)).map(node => node.id);
  const live = ordered.slice(0, cap);
  state.liveNodeIds = live;
  const liveSet = new Set(live);
  for (const node of state.nodes) node.live = liveSet.has(node.id);
  return live;
}

export function cocsPhase(match, state) {
  if (state?.forceEndgame === true) return 'endgame';
  const limit = Math.max(1, num(match?.config?.timeLimit, RULES.timeLimit));
  const fraction = Math.max(0, num(match?.time, 0)) / limit;
  if (fraction >= COCS_ENDGAME_FRACTION) return 'endgame';
  if (fraction >= COCS_OPENING_FRACTION) return 'mid';
  return 'opening';
}

// Explicit endgame entry (clock, a front-lane sweep, or a test). Keeping this
// as a named helper keeps the live-node rule deterministic and testable.
export function enterEndgame(state) {
  state.forceEndgame = true;
  state.endgame = true;
  state.phase = 'endgame';
  return updateLiveNodes(state);
}

// ---------------------------------------------------------------------------
// Adjacency legality. A node can only be captured by a team that already owns
// one of its neighbours; HQ anchors are never capturable, capturable nodes must
// be live, and ARRAY anchors only open in the endgame.
// ---------------------------------------------------------------------------
export function capturableBy(state, nodeId, team) {
  if (team !== 0 && team !== 1) return false;
  const node = nodeById(state, nodeId);
  if (!node || node.owner === team) return false;
  if (node.archetype === 'hq') return false;
  if (node.archetype === 'array') { if (state.endgame !== true) return false; }
  else if (node.live !== true) return false;
  return neighbors(state, node.id).some(id => nodeById(state, id)?.owner === team);
}

// ---------------------------------------------------------------------------
// Connectivity income. A node pays only while a same-team path links it back to
// a same-team HQ; a cut node is offline and blocks the path behind it (§4.4).
// ---------------------------------------------------------------------------
export function connectedToHq(state, nodeId, team = null) {
  const start = nodeById(state, nodeId);
  if (!start) return false;
  const owner = team ?? start.owner;
  if (owner !== 0 && owner !== 1) return false;
  const cuts = new Set(state.cuts ?? []);
  if (cuts.has(start.id)) return false;
  const seen = new Set([start.id]);
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift();
    const node = nodeById(state, id);
    if (node && node.archetype === 'hq' && node.owner === owner) return true;
    for (const next of neighbors(state, id)) {
      if (seen.has(next) || cuts.has(next)) continue;
      const other = nodeById(state, next);
      if (!other || other.owner !== owner) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

export function connectivityIncome(state) {
  const income = {0: 0, 1: 0};
  const connected = {0: [], 1: []};
  for (const node of capturableNodes(state)) {
    const owner = node.owner;
    if (owner !== 0 && owner !== 1) continue;
    if (!connectedToHq(state, node.id, owner)) continue;
    income[owner] += COCS_INCOME[node.archetype] ?? 0;
    connected[owner].push(node.id);
  }
  return {income, connected};
}

export function cutLink(state, nodeId) {
  const node = nodeById(state, nodeId);
  if (!node) return false;
  if (!(state.cuts ??= []).includes(node.id)) state.cuts.push(node.id);
  return true;
}

export function repairLink(state, nodeId) {
  const node = nodeById(state, nodeId);
  if (!node) return false;
  const index = (state.cuts ?? []).indexOf(node.id);
  if (index >= 0) state.cuts.splice(index, 1);
  return index >= 0;
}

// ---------------------------------------------------------------------------
// One front indicator: the live node a team is pressuring, plus the globally
// most-pressured live node (what the player's indicator points at).
// ---------------------------------------------------------------------------
export function frontState(state) {
  const capturable = capturableNodes(state);
  const byTeam = {0: {nodeId: null, progress: 0}, 1: {nodeId: null, progress: 0}};
  for (const team of [0, 1]) {
    let best = null, bestValue = -1;
    for (const node of capturable) {
      if (node.owner === team) continue;
      if (!capturableBy(state, node.id, team)) continue;
      const value = num(node.progress?.[team], 0);
      if (value > bestValue) { bestValue = value; best = node.id; }
    }
    byTeam[team] = {nodeId: best, progress: best === null ? 0 : bestValue};
  }
  let nodeId = null, contested = false, bestTotal = 0;
  for (const node of capturable) {
    if (node.live !== true) continue;
    const total = num(node.progress?.[0], 0) + num(node.progress?.[1], 0);
    if (total > bestTotal + EPSILON) { bestTotal = total; nodeId = node.id; contested = node.contested === true; }
  }
  if (nodeId === null) nodeId = byTeam[0].nodeId ?? byTeam[1].nodeId ?? capturable.find(node => node.live === true)?.id ?? null;
  return {nodeId, contested, byTeam};
}

// ---------------------------------------------------------------------------
// Orders. A `cocsPolicy` or the caller may hand in
// `{tick, peerId, cardId, team, verb:'HOLD'|'ATTACK', target}`. They are sorted
// by (tick, peerId, cardId) and applied in that order; a valid order installs
// one active task per team, which counts as a presence at the target for its
// TTL. That is the whole V0a order surface — no agents required.
// ---------------------------------------------------------------------------
export function compareCocsOrders(a, b) {
  const at = num(a?.tick, 0), bt = num(b?.tick, 0);
  if (at !== bt) return at - bt;
  const ap = String(a?.peerId ?? ''), bp = String(b?.peerId ?? '');
  if (ap !== bp) return ap < bp ? -1 : 1;
  const ac = String(a?.cardId ?? ''), bc = String(b?.cardId ?? '');
  if (ac !== bc) return ac < bc ? -1 : 1;
  return 0;
}

export const sortCocsOrders = orders => [...(orders ?? [])].sort(compareCocsOrders);

function trimOrderLog(state) {
  const log = state.orderLog;
  if (log.length > COCS_ORDER_LOG_LIMIT) log.splice(0, log.length - COCS_ORDER_LOG_LIMIT);
}

export function processCocsOrder(match, state, order) {
  const team = order?.team;
  const verb = String(order?.verb ?? '').toUpperCase();
  const target = order?.target ?? order?.node ?? null;
  const entry = {
    tick: num(order?.tick, state.tick),
    peerId: String(order?.peerId ?? ''),
    cardId: String(order?.cardId ?? ''),
    team, verb,
    target: target === null ? null : String(target),
    ok: false,
  };
  const reject = () => { state.orderLog.push(entry); trimOrderLog(state); return false; };
  if ((team !== 0 && team !== 1) || !COCS_ORDER_VERBS.includes(verb) || target === null) return reject();
  const node = nodeById(state, target);
  if (!node) return reject();
  const owned = node.owner === team;
  if (verb === 'ATTACK' && !capturableBy(state, node.id, team)) return reject();
  if (verb === 'HOLD' && !owned && !capturableBy(state, node.id, team)) return reject();
  state.tasks[team] = {verb, nodeId: node.id, tick: entry.tick, until: state.tick + state.orderTtlTicks, peerId: entry.peerId, cardId: entry.cardId};
  entry.ok = true;
  state.orderLog.push(entry);
  trimOrderLog(state);
  match?.emit?.('cocs-order', {team, verb, node: node.id, tick: entry.tick, peerId: entry.peerId, cardId: entry.cardId});
  return true;
}

// Deterministic stub duty policy used by tests and by any no-commander V0a
// match. Never draws the RNG; issues one ATTACK per team on the front node
// every 45 ticks. Replace with the real duty Chief in V0b.
export function stubCocsPolicy(state, context = {}) {
  const tick = num(context.tick, state?.tick ?? 0);
  if (tick % 45 !== 0) return [];
  const orders = [];
  for (const team of [0, 1]) {
    const front = frontState(state).byTeam[team]?.nodeId ?? null;
    if (front === null) continue;
    orders.push({tick, peerId: `chief-${team}`, cardId: `${team}-${tick}`, team, verb: 'ATTACK', target: front});
  }
  return orders;
}

// ---------------------------------------------------------------------------
// Capture. Presence is actors inside the node radius (plus an active order
// task); a team's presence only counts when it owns the node or the node is
// capturable by it. Contesting rolls both sides back at .75/s; holding an owned
// node bleeds the enemy's progress and banks objective time.
// ---------------------------------------------------------------------------
function nodePresence(match, state, node) {
  const present = {0: false, 1: false};
  const actors = {0: [], 1: []};
  for (const actor of match?.actors ?? []) {
    if (!actor || actor.health <= 0 || (actor.team !== 0 && actor.team !== 1)) continue;
    if (Math.hypot(actor.x - node.x, actor.z - node.z) > node.r) continue;
    if (Math.abs(num(actor.y, 0) - node.y) > 5) continue;
    present[actor.team] = true;
    actors[actor.team].push(actor);
  }
  for (const team of [0, 1]) {
    const task = state.tasks?.[team];
    if (task && task.nodeId === node.id && state.tick <= task.until) present[team] = true;
  }
  return {present, actors};
}

function captureNode(match, state, node, team, actors) {
  node.owner = team;
  node.progress = {0: 0, 1: 0};
  node.contested = false;
  state.scores[team] = num(state.scores[team], 0) + (COCS_CAPTURE_POINTS[node.archetype] ?? 0);
  for (const actor of actors ?? []) actor.scoreStats.objectiveCaptures = (actor.scoreStats.objectiveCaptures ?? 0) + 1;
  if (node.archetype === 'array') state.arrayWinner = team;
  match?.emit?.('cocs-capture', {node: node.id, team, archetype: node.archetype, score: state.scores[team]});
  updateLiveNodes(state);
}

function captureNodeStep(match, state, node, dt, rate) {
  const {present, actors} = nodePresence(match, state, node);
  const teams = [];
  for (const team of [0, 1]) {
    if (!present[team]) continue;
    if (node.owner === team || capturableBy(state, node.id, team)) teams.push(team);
  }
  node.contested = teams.length > 1;
  if (teams.length === 0) return;
  if (teams.length > 1) {
    for (const team of teams) node.progress[team] = Math.max(0, num(node.progress[team], 0) - rate * 0.75);
    return;
  }
  const team = teams[0], other = team === 0 ? 1 : 0;
  if (node.owner === team) {
    node.progress[other] = Math.max(0, num(node.progress[other], 0) - rate * 0.75);
    for (const actor of actors[team]) actor.scoreStats.objectiveTime = (actor.scoreStats.objectiveTime ?? 0) + dt;
    return;
  }
  node.progress[team] = clamp01(num(node.progress[team], 0) + rate);
  node.progress[other] = Math.max(0, num(node.progress[other], 0) - rate * 0.75);
  if (node.progress[team] >= 1 - EPSILON) captureNode(match, state, node, team, actors[team]);
}

function updateDominance(state, dt) {
  const capturable = capturableNodes(state);
  const counts = {0: 0, 1: 0};
  for (const node of capturable) if (node.owner === 0 || node.owner === 1) counts[node.owner]++;
  const team = counts[0] > counts[1] ? 0 : counts[1] > counts[0] ? 1 : null;
  const dominance = state.dominance;
  if (team === null || counts[team] < state.dominanceCount) {
    dominance.team = null;
    dominance.progress = 0;
    dominance.target = state.dominanceHold;
    dominance.fast = false;
    return;
  }
  const fast = counts[team] >= state.dominanceFastCount;
  if (dominance.team === team) dominance.progress += dt;
  else { dominance.team = team; dominance.progress = dt; }
  dominance.target = fast ? state.dominanceFast : state.dominanceHold;
  dominance.fast = fast;
}

// ---------------------------------------------------------------------------
// Outcome: array capture > sustained dominance > score at time. Pure; the
// step applies the result. Returns `{winner, reason}` or null.
// ---------------------------------------------------------------------------
export function cocsOutcome(match) {
  const state = match?.objectiveState;
  if (!state || state.kind !== COCS_KIND) return null;
  if (state.arrayWinner === 0 || state.arrayWinner === 1) return {winner: state.arrayWinner, reason: 'array'};
  const dominance = state.dominance;
  if (dominance && (dominance.team === 0 || dominance.team === 1) && dominance.progress >= dominance.target) return {winner: dominance.team, reason: 'dominance'};
  const limit = Math.max(1, num(match?.config?.timeLimit, RULES.timeLimit));
  if (num(match?.time, 0) >= limit) {
    const scores = state.scores ?? {0: 0, 1: 0};
    if (scores[0] !== scores[1]) return {winner: scores[0] > scores[1] ? 0 : 1, reason: 'time'};
    const owned = {0: 0, 1: 0};
    for (const node of capturableNodes(state)) if (node.owner === 0 || node.owner === 1) owned[node.owner]++;
    if (owned[0] !== owned[1]) return {winner: owned[0] > owned[1] ? 0 : 1, reason: 'time'};
    return {winner: null, reason: 'time'};
  }
  return null;
}

// ---------------------------------------------------------------------------
// Snapshot subtree. Byte-for-byte the frozen interface: id-keyed `nodes`,
// `scores`, `liveNodeIds` and `winner` (all delta-friendly).
// ---------------------------------------------------------------------------
export function cocsSnapshot(match) {
  const state = match?.objectiveState;
  if (!state || state.kind !== COCS_KIND) return null;
  return {
    nodes: state.nodes.map(node => ({
      id: node.id,
      x: node.x,
      z: node.z,
      archetype: node.archetype,
      owner: node.owner ?? null,
      progress: [num(node.progress?.[0], 0), num(node.progress?.[1], 0)],
      contested: node.contested === true,
      live: node.live === true,
    })),
    scores: {0: num(state.scores?.[0], 0), 1: num(state.scores?.[1], 0)},
    liveNodeIds: [...(state.liveNodeIds ?? [])],
    winner: state.winner ?? null,
  };
}

// ---------------------------------------------------------------------------
// Update. Runs once per step from updateObjectives, after the actor loop.
// ---------------------------------------------------------------------------
export function stepCocs(match, dt = RULES.dt) {
  const state = match?.objectiveState;
  if (!state || state.kind !== COCS_KIND || match.over) return state;
  state.tick = num(state.tick, 0) + 1;
  const now = state.tick;

  // 1. Pull pending orders (from `inputs.cocs`, queued by Match.step) plus any
  //    produced by the duty policy. This is the single documented RNG draw
  //    point for COCS.
  const pending = (state.pendingOrders ??= []).splice(0, state.pendingOrders.length);
  if (typeof match.cocsPolicy === 'function') {
    const produced = match.cocsPolicy(state, {tick: now, time: match.time, dt, random: match.random, actors: match.actors, mode: match.config?.mode});
    if (Array.isArray(produced)) for (const order of produced) if (order) pending.push(order);
  }
  for (const order of pending) if (order && !finite(order.tick)) order.tick = now;
  pending.sort(compareCocsOrders);
  for (const order of pending) processCocsOrder(match, state, order);

  // 2. Phase + live set before capture so legality uses the current set.
  state.phase = cocsPhase(match, state);
  state.endgame = state.phase === 'endgame';
  updateLiveNodes(state);

  // 3. Capture every live capturable node plus any opened ARRAY anchor.
  const rate = dt / Math.max(EPSILON, state.captureSeconds);
  for (const node of state.nodes) {
    if (node.archetype === 'hq') { node.contested = false; continue; }
    if (isCapturableArchetype(node.archetype) && node.live !== true) { node.contested = false; continue; }
    if (node.archetype === 'array' && state.endgame !== true) { node.contested = false; continue; }
    captureNodeStep(match, state, node, dt, rate);
  }

  // 4. Connectivity income and the objective score-at-time.
  const {income} = connectivityIncome(state);
  state.income = income;
  for (const team of [0, 1]) state.scores[team] = num(state.scores[team], 0) + income[team] * dt;

  // 5. Dominance, front and the team-score mirror (HUD / Match.leaders).
  updateDominance(state, dt);
  state.front = frontState(state);
  match.teamScores[0] = state.scores[0];
  match.teamScores[1] = state.scores[1];

  // 6. Resolve once.
  const outcome = cocsOutcome(match);
  if (outcome) {
    state.winner = outcome.winner;
    state.winReason = outcome.reason;
    if (outcome.winner === 0 || outcome.winner === 1) match.emit('objective-win', {team: outcome.winner, score: state.scores[outcome.winner], reason: outcome.reason});
    match.endMatch(outcome.reason);
  }
  return state;
}
