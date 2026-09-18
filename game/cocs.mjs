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
//   * live-node selection (a frontier node — owned or adjacent to owned — is
//     always live so adjacency-gated capture can never be frozen out; neutral
//     nodes are padded in to the opening/mid floor, and the endgame opens the
//     whole capturable lattice);
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
import {
  FLUX_CAP, FLUX_PASSIVE_PER_SECOND, FLUX_START, ORDER_REWARD, REQ_EARN, SUBAGENTS,
  neglectPassiveFlux, neglectState, neglectTick, scoreEvent, subagentUpkeep,
} from './cocs-economy.mjs';
import {createTraversalState, stepCocsTraversal, cocsTraversalSnapshot} from './cocs-traversal.mjs';

export const COCS_KIND = 'cocs';
// The frozen node archetypes. Authored maps may spell a few of these
// differently (`infrastructure`/`foundry` are the map-spec names for a relay);
// `normalizeArchetype` folds them onto this set.
export const COCS_ARCHETYPES = Object.freeze(['front', 'economy', 'relay', 'hq', 'array']);
export const COCS_CAPTURABLE = Object.freeze(['front', 'economy', 'relay']);
export const COCS_ANCHORS = Object.freeze(['hq', 'array']);
export const COCS_ORDER_VERBS = Object.freeze(['HOLD', 'ATTACK', 'SCAN']);
// FLUX/second a connected node pays. Mirrors mode spec §4.2; the §6.5 passive
// +1/s team term is added on top by `stepCocs`.
export const COCS_INCOME = Object.freeze({front: 1, economy: 3, relay: 0, hq: 0, array: 0});
// §8.1 SCOUT as a first-class unit. `SCAN` marks enemies in the target area as
// `SPOT`ted for the spotting team; with no fog in V1 the payoff is the §8.1
// +15% team damage bonus against a marked target.
export const COCS_SCOUT = Object.freeze({
  role: 'scout',
  spawnCost: SUBAGENTS.scout.spawnCost,
  lifespanSeconds: SUBAGENTS.scout.lifespanSeconds,
  refundFraction: SUBAGENTS.scout.refundFraction,
  cap: SUBAGENTS.scout.cap,
});
export const COCS_SCAN_RADIUS = 12;
export const COCS_SCAN_ARRIVE = 4;
export const COCS_SPOT_SECONDS = 8;
export const COCS_SPOT_DAMAGE_BONUS = 0.15;
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
  // Dominance arms only on an OUTRIGHT majority of the capturable lattice
  // (`> n/2`, i.e. 3 of 5 on the V0a slice). A mere plurality is not enough, so
  // one won relay fight can no longer start the 90 s ratchet: the losing side
  // keeps a legal recapture and a comeback window. `dominanceCount` can still be
  // overridden per mode/config.
  const majority = Math.floor(capturable.length / 2) + 1;
  const dominanceCount = Math.max(1, Math.round(num(objective.dominanceCount, majority)));
  // The fast hold needs one node beyond the bare majority (4 of 5 on the V0a
  // slice); the sustained hold is the outright-majority window itself. Either
  // timer resets the moment the majority is lost, so a swallowed lead is
  // always recoverable by taking a node back.
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
    // --- §6.5/§6A.5 two-layer economy ---------------------------------------
    flux: {0: FLUX_START, 1: FLUX_START},
    fluxCap: FLUX_CAP,
    fluxEarned: {0: 0, 1: 0},
    fluxSpent: {0: 0, 1: 0},
    fluxUpkeep: {0: 0, 1: 0},
    fluxIncome: {0: 0, 1: 0},
    neglect: {0: neglectState(), 1: neglectState()},
    // --- §8 SCOUT subagent ---------------------------------------------------
    scoutCap: Math.max(1, Math.round(num(config?.objective?.scoutCap, COCS_SCOUT.cap))),
    scanRadius: COCS_SCAN_RADIUS,
    spotSeconds: COCS_SPOT_SECONDS,
    spotBonus: COCS_SPOT_DAMAGE_BONUS,
    scans: {0: null, 1: null},
    scouts: {0: null, 1: null},
    scoutSlots: {0: null, 1: null},
    scoutStats: {0: {spawned: 0, killed: 0, expired: 0, scans: 0}, 1: {spawned: 0, killed: 0, expired: 0, scans: 0}},
    spots: {},
    orderStats: {issued: 0, completed: 0, byVerb: {HOLD: 0, ATTACK: 0, SCAN: 0}},
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
  // §6A traversal layer (V0b): authored devices/depots only. An unauthored map
  // stays `null` so every prior mode/behaviour is untouched.
  state.traversal = createTraversalState(arena, {botUse: config?.objective?.traversalBotUse === true});
  updateLiveNodes(state);
  state.front = frontState(state);
  return state;
}

// ---------------------------------------------------------------------------
// Live-node selection. A capturable node is frontier when it is owned or
// adjacent to an owned node — i.e. a node either team could legally take or
// must legally defend. Every frontier node is ALWAYS live: capture is
// adjacency-gated, so de-listing a frontier (as a hard cap smaller than the
// frontier would) freezes that team's own progression and lets one side lock
// the other out of its own gate. The phase floor only pads *neutral* nodes in,
// to the opening/mid `liveMin` or the endgame `endgameLive`; `liveMax` is the
// intended lattice scale, not a truncation cap.
// ---------------------------------------------------------------------------
export function updateLiveNodes(state) {
  const capturable = capturableNodes(state);
  const index = new Map(state.nodes.map(node => [node.id, node]));
  const frontier = new Set();
  for (const node of capturable) if (node.owner === 0 || node.owner === 1) frontier.add(node.id);
  for (const node of capturable) {
    if (frontier.has(node.id)) continue;
    if (neighbors(state, node.id).some(id => { const other = index.get(id); return other && (other.owner === 0 || other.owner === 1); })) frontier.add(node.id);
  }
  const live = capturable.filter(node => frontier.has(node.id)).map(node => node.id);
  const floor = state.endgame ? state.endgameLive : state.liveMin;
  const target = Math.min(capturable.length, Math.max(floor, live.length));
  for (const node of capturable) {
    if (live.length >= target) break;
    if (!frontier.has(node.id)) live.push(node.id);
  }
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
  if (verb === 'SCAN') {
    const ok = issueScanOrder(match, state, team, node);
    entry.ok = ok;
    state.orderLog.push(entry);
    trimOrderLog(state);
    if (!ok) return false;
    state.orderStats.issued = num(state.orderStats.issued, 0) + 1;
    state.orderStats.byVerb[verb] = num(state.orderStats.byVerb?.[verb], 0) + 1;
    if (state.scans?.[team]) { state.scans[team].peerId = entry.peerId; state.scans[team].cardId = entry.cardId; }
    match?.emit?.('cocs-order', {team, verb, node: node.id, tick: entry.tick, peerId: entry.peerId, cardId: entry.cardId});
    return true;
  }
  const owned = node.owner === team;
  if (verb === 'ATTACK' && !capturableBy(state, node.id, team)) return reject();
  if (verb === 'HOLD' && !owned && !capturableBy(state, node.id, team)) return reject();
  state.tasks[team] = {verb, nodeId: node.id, tick: entry.tick, until: state.tick + state.orderTtlTicks, peerId: entry.peerId, cardId: entry.cardId};
  entry.ok = true;
  state.orderLog.push(entry);
  trimOrderLog(state);
  state.orderStats.issued = num(state.orderStats.issued, 0) + 1;
  state.orderStats.byVerb[verb] = num(state.orderStats.byVerb?.[verb], 0) + 1;
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
// §6A.5 Personal REQUISITION (`REQ`) — per-actor accrual.
// ---------------------------------------------------------------------------
// `REQ` lives on the actor (`actor.req`) and mirrors into `scoreStats` so the
// objective-first scoreboard and the §6A.9 conversion can read one number. The
// helpers are pure; `stepCocs` owns the clock.
export function addActorReq(actor, amount) {
  if (!actor) return 0;
  const delta = Math.max(0, num(amount, 0));
  if (!(delta > 0)) return num(actor.req, 0);
  actor.req = num(actor.req, 0) + delta;
  actor.reqEarned = num(actor.reqEarned, 0) + delta;
  if (!actor.scoreStats || typeof actor.scoreStats !== 'object') actor.scoreStats = {};
  actor.scoreStats.reqEarned = num(actor.scoreStats.reqEarned, 0) + delta;
  return actor.req;
}

// ---------------------------------------------------------------------------
// §8 SCOUT subagent (V0b). One first-class actor per team, spawned by a `SCAN`
// order, driven by the RNG-free `cocsScoutInput` policy in `cocs-bots.mjs`,
// retired on lifespan or death. `match.actors[id]` index identity is load-
// bearing across the engine, so a scout slot is *recycled* rather than spliced
// out of the roster: the actor stays at the tail with a stable id.
// ---------------------------------------------------------------------------
function nextActorId(match) {
  let next = 0;
  for (const actor of match?.actors ?? []) if (num(actor?.id, -1) >= next) next = actor.id + 1;
  return next;
}

function hqNodeFor(state, team) {
  return (state?.nodes ?? []).find(node => node.archetype === 'hq' && node.owner === team) ?? null;
}

// Lattice hop count between two nodes; 0 when they are the same/unreachable.
function latticeHops(state, fromId, toId) {
  if (!fromId || !toId) return 0;
  if (fromId === toId) return 0;
  const seen = new Set([fromId]);
  const queue = [[fromId, 0]];
  while (queue.length) {
    const [id, depth] = queue.shift();
    for (const next of neighbors(state, id)) {
      if (seen.has(next)) continue;
      if (next === toId) return depth + 1;
      seen.add(next);
      queue.push([next, depth + 1]);
    }
  }
  return 0;
}

export function activeScoutActor(match, state, team) {
  const actor = scoutSlotActor(match, state, team);
  if (!actor || actor.health <= 0) return null;
  return actor;
}

// The recycled slot actor even while dead — used by the lifecycle step to retire
// a killed scout and pay the bounty.
function scoutSlotActor(match, state, team) {
  const id = state?.scouts?.[team];
  if (id === null || id === undefined) return null;
  const actor = match?.actors?.[id];
  if (!actor || actor.isScout !== true || actor.scoutActive === false) return null;
  return actor;
}

function ensureScoutSlot(match, state, team) {
  const slotId = state.scoutSlots?.[team];
  if (slotId !== null && slotId !== undefined && match.actors[slotId]) return match.actors[slotId];
  const actor = match.actor(nextActorId(match), 'chatgpt', 'openclaw');
  actor.team = team;
  actor.isNpc = true;
  actor.isScout = true;
  actor.scoutTeam = team;
  actor.scoutActive = false;
  actor.name = 'Scout';
  actor.meleeDamage = 0;
  actor.npcProfile = {health: SUBAGENTS.scout.health, armor: SUBAGENTS.scout.armor, speedMult: 1, damageMult: 0.15, scale: 0.82, color: team === 0 ? '#7fd4ff' : '#ffb27f', accent: '#0b1a24', points: 0};
  match.actors.push(actor);
  state.scoutSlots[team] = actor.id;
  return actor;
}

function scoutTargetPoint(state, nodeId) {
  const node = nodeById(state, nodeId);
  return node ? {x: node.x, y: num(node.y, 0), z: node.z} : null;
}

// Spawn (or re-activate) a team's scout against a target node. Deducts the
// §8.1 spawn cost from the team `FLUX` pool; returns null when unaffordable or
// the cap is already filled.
export function spawnScout(match, state, team, nodeId) {
  if (!match || !state) return null;
  if (activeScoutActor(match, state, team)) return null;
  if (num(state.flux?.[team], 0) < COCS_SCOUT.spawnCost) return null;
  const actor = ensureScoutSlot(match, state, team);
  state.flux[team] = num(state.flux[team], 0) - COCS_SCOUT.spawnCost;
  state.fluxSpent[team] = num(state.fluxSpent[team], 0) + COCS_SCOUT.spawnCost;
  state.scouts[team] = actor.id;
  actor.scoutActive = true;
  actor.scoutScanned = false;
  actor.scoutReturning = false;
  actor.scoutIdle = false;
  actor.scoutScans = 0;
  actor.scoutTargetNode = nodeId ?? null;
  actor.scoutTarget = scoutTargetPoint(state, nodeId);
  actor.scoutExpireTick = num(state.tick, 0) + Math.max(1, Math.round(COCS_SCOUT.lifespanSeconds / (RULES.dt || 1 / 60)));
  if (!actor.bot) actor.bot = {route: [], think: 0, target: -1, memory: 0, reaction: 0, stuck: 0, last: {x: 0, y: 0, z: 0}, state: 'roam', patrol: 0, flank: null, flankDone: false, recover: 0, suppressed: 0, threat: -1, standoff: null, strafeReverse: -99};
  match.spawn(actor);
  // Park the scout at its own HQ: a deterministic, legible rally point that
  // does not depend on the engine's spawn-scoring roll.
  const home = hqNodeFor(state, team);
  if (home) {
    actor.x = home.x; actor.z = home.z; actor.y = num(home.y, 0);
    actor.lastValid = {x: actor.x, y: actor.y, z: actor.z};
    actor.vx = actor.vy = actor.vz = 0;
  }
  actor.isScout = true;
  actor.scoutActive = true;
  state.scoutStats[team].spawned = num(state.scoutStats[team].spawned, 0) + 1;
  match.emit?.('cocs-scout-spawn', {team, actor: actor.id, node: nodeId ?? null, cost: COCS_SCOUT.spawnCost, target: actor.scoutTarget});
  return actor;
}

// Retire a scout without touching roster indices. Dead/expired slots stay in
// `match.actors` with health 0 and an effectively infinite respawn timer so the
// engine never revives them; the slot is reused by the next spawn.
function retireScout(match, state, team, actor, reason = 'expire') {
  if (!actor || actor.isScout !== true || actor.scoutActive === false) return false;
  const stats = state.scoutStats[team] ?? (state.scoutStats[team] = {spawned: 0, killed: 0, expired: 0, scans: 0});
  const completed = actor.scoutScanned === true;
  if (reason === 'killed') {
    stats.killed = num(stats.killed, 0) + 1;
    // §8.2 bounty: the enemy team is paid `clamp(round(15 x upkeep), 6, 48)`
    // FLUX, plus the §6A.4 kill-subagent score. The figure is the subagent's
    // live supply-load cost, captured on the last economy tick.
    const upkeep = num(actor.scoutUpkeep, subagentUpkeep(SUBAGENTS.scout.id, 1, {hops: 0, foundries: 0}));
    const bounty = Math.max(6, Math.min(48, Math.round(15 * upkeep)));
    state.flux[1 - team] = Math.min(num(state.fluxCap, FLUX_CAP), num(state.flux[1 - team], 0) + bounty);
    state.fluxEarned[1 - team] = num(state.fluxEarned[1 - team], 0) + bounty;
    const reward = scoreEvent({kind: 'killSubagent'});
    state.scores[1 - team] = num(state.scores[1 - team], 0) + (typeof reward.teamOP === 'number' ? reward.teamOP : 0);
    const killer = num(actor.lastHitBy, -1) >= 0 ? match.actors[actor.lastHitBy] : null;
    if (killer && killer.team !== team) {
      addActorReq(killer, reward.req);
      killer.scoreStats.objectivePoints = num(killer.scoreStats.objectivePoints, 0) + reward.personalOP;
      killer.scoreStats.subagentKills = num(killer.scoreStats.subagentKills, 0) + 1;
    }
    match.emit?.('cocs-scout-killed', {team, actor: actor.id, killer: killer?.id ?? null, bounty, x: actor.x, z: actor.z});
  } else {
    stats.expired = num(stats.expired, 0) + 1;
    if (completed) {
      const refund = Math.round(COCS_SCOUT.spawnCost * COCS_SCOUT.refundFraction);
      state.flux[team] = Math.min(num(state.fluxCap, FLUX_CAP), num(state.flux[team], 0) + refund);
      state.fluxEarned[team] = num(state.fluxEarned[team], 0) + refund;
    }
    match.emit?.('cocs-scout-expire', {team, actor: actor.id, scanned: completed, reason});
  }
  actor.scoutActive = false;
  actor.health = 0;
  actor.dead = 1e9;
  actor.bot = null;
  actor.scoutTarget = null;
  actor.scoutTargetNode = null;
  actor.scoutReturning = false;
  actor.scoutIdle = false;
  actor.vx = actor.vy = actor.vz = 0;
  const home = hqNodeFor(state, team);
  if (home) { actor.x = home.x; actor.z = home.z; actor.y = num(home.y, 0); }
  state.scouts[team] = null;
  return true;
}

// Mark every living enemy inside the scan area. Deterministic: actor order is
// the roster order, and the marks are pure state (no RNG, no wall clock).
function performScan(match, state, team, actor, at) {
  const spots = state.spots ?? (state.spots = {});
  const until = num(state.tick, 0) + Math.max(1, Math.round(COCS_SPOT_SECONDS / (RULES.dt || 1 / 60)));
  let marked = 0;
  for (const target of match.actors ?? []) {
    if (!target || target.health <= 0) continue;
    if (target.team !== 0 && target.team !== 1) continue;
    if (target.team === team) continue;
    if (Math.hypot(num(target.x, 0) - at.x, num(target.z, 0) - at.z) > COCS_SCAN_RADIUS) continue;
    spots[target.id] = {team, until, by: actor.id, x: num(target.x, 0), z: num(target.z, 0), atTick: num(state.tick, 0)};
    marked++;
  }
  actor.scoutScans = num(actor.scoutScans, 0) + 1;
  state.scoutStats[team].scans = num(state.scoutStats[team].scans, 0) + 1;
  match.emit?.('cocs-scan', {team, actor: actor.id, x: at.x, z: at.z, marked, until});
  return marked;
}

// Issue a `SCAN` order. Spawns a scout when the team has none (and can pay);
// otherwise re-targets the live one. Returns false when the order is illegal.
export function issueScanOrder(match, state, team, node) {
  const active = activeScoutActor(match, state, team);
  if (!active) {
    const spawned = spawnScout(match, state, team, node.id);
    if (!spawned) return false;
  } else {
    active.scoutTargetNode = node.id;
    active.scoutTarget = scoutTargetPoint(state, node.id);
    active.scoutReturning = false;
    active.scoutScanned = false;
  }
  state.scans[team] = {nodeId: node.id, tick: num(state.tick, 0), until: num(state.tick, 0) + Math.max(1, num(state.orderTtlTicks, 1)), peerId: null, cardId: null};
  return true;
}

// Advance one team's scout one fixed step: arrive -> scan -> return -> retire.
function stepScoutTeam(match, state, team, dt) {
  const actor = scoutSlotActor(match, state, team);
  if (!actor) return;
  if (actor.health <= 0) { retireScout(match, state, team, actor, 'killed'); return; }
  if (num(state.tick, 0) >= num(actor.scoutExpireTick, Infinity)) { retireScout(match, state, team, actor, 'expire'); return; }
  const scan = state.scans?.[team];
  if (scan && actor.scoutReturning !== true) {
    const node = nodeById(state, scan.nodeId);
    if (node) {
      actor.scoutTargetNode = node.id;
      actor.scoutTarget = scoutTargetPoint(state, node.id);
    }
  }
  if (actor.scoutScanned !== true) {
    const target = actor.scoutTarget;
    if (target && Math.hypot(actor.x - target.x, actor.z - target.z) <= COCS_SCAN_ARRIVE) {
      performScan(match, state, team, actor, target);
      actor.scoutScanned = true;
      actor.scoutReturning = true;
      const home = hqNodeFor(state, team);
      actor.scoutTargetNode = home ? home.id : null;
      actor.scoutTarget = home ? {x: home.x, y: num(home.y, 0), z: home.z} : null;
    }
  } else if (actor.scoutReturning === true) {
    const home = hqNodeFor(state, team);
    if (!home || Math.hypot(actor.x - home.x, actor.z - home.z) <= COCS_SCAN_ARRIVE) retireScout(match, state, team, actor, 'return');
  }
  void dt;
}

// Objective presence `REQ` (§6A.5): +0.25/s while a living player stands in a
// node radius their team owns or that is contested. No AFK drip.
function accruePresenceReq(match, state, dt) {
  for (const node of capturableNodes(state)) {
    for (const actor of match.actors ?? []) {
      if (!actor || actor.health <= 0) continue;
      if (actor.team !== 0 && actor.team !== 1) continue;
      if (actor.isScout === true) continue;
      if (node.owner !== actor.team && node.contested !== true) continue;
      if (Math.hypot(actor.x - node.x, actor.z - node.z) > node.r) continue;
      addActorReq(actor, REQ_EARN.objectivePresencePerSecond * dt);
    }
  }
}

// ---------------------------------------------------------------------------
// §8.1 SPOT combat leverage. Read by `Match.damage` (mode-guarded): a damage
// source on the spotting team deals `+15%` to a marked target while its mark is
// live. Pure; returns 1 for every non-cocs path.
// ---------------------------------------------------------------------------
export function cocsSpotDamageScale(match, source, target) {
  const state = match?.objectiveState;
  if (!state || state.kind !== COCS_KIND) return 1;
  if (!source || !target || source === target) return 1;
  if (source.team !== 0 && source.team !== 1) return 1;
  const spot = state.spots?.[target.id];
  if (!spot || spot.team !== source.team) return 1;
  if (num(state.tick, 0) > num(spot.until, 0)) return 1;
  return 1 + COCS_SPOT_DAMAGE_BONUS;
}

// ---------------------------------------------------------------------------
// Capture. Two distinct concepts:
//   * **actor presence** — living actors inside the node radius; the only thing
//     that can contest or freeze another team's progress.
//   * **order presence** — a live HOLD/ATTACK task on the node. It can push an
//     uncontested capture (a lone duty order still takes an empty node) but it
//     can never contest against, or block, an actual enemy actor. That is what
//     stops a standing order from making an owned node effectively
//     uncapturable while its squad is somewhere else.
// Contesting rolls both sides back at .75/s; holding an owned node bleeds the
// enemy's progress and banks objective time.
// ---------------------------------------------------------------------------
function nodeActors(match, node) {
  const present = {0: false, 1: false};
  const actors = {0: [], 1: []};
  for (const actor of match?.actors ?? []) {
    if (!actor || actor.health <= 0 || (actor.team !== 0 && actor.team !== 1)) continue;
    if (Math.hypot(actor.x - node.x, actor.z - node.z) > node.r) continue;
    if (Math.abs(num(actor.y, 0) - node.y) > 5) continue;
    present[actor.team] = true;
    actors[actor.team].push(actor);
  }
  return {present, actors};
}

// Live order tasks, keyed by team, for one node.
function nodeOrderTeams(state, node) {
  const ordered = {0: false, 1: false};
  for (const team of [0, 1]) {
    const task = state.tasks?.[team];
    if (task && task.nodeId === node.id && state.tick <= task.until) ordered[team] = true;
  }
  return ordered;
}

function captureNode(match, state, node, team, actors) {
  node.owner = team;
  node.progress = {0: 0, 1: 0};
  node.contested = false;
  state.scores[team] = num(state.scores[team], 0) + (COCS_CAPTURE_POINTS[node.archetype] ?? 0);
  // §6A.4/§6A.5 capture reward: each participating actor banks `+8 REQ` and the
  // personal objective term from the one economy table.
  const capture = scoreEvent({kind: 'capture'});
  const participants = [...(actors ?? [])].sort((a, b) => a.id - b.id);
  for (const actor of participants) {
    actor.scoreStats.objectiveCaptures = (actor.scoreStats.objectiveCaptures ?? 0) + 1;
    addActorReq(actor, capture.req);
    actor.scoreStats.objectivePoints = num(actor.scoreStats.objectivePoints, 0) + capture.personalOP;
  }
  // §6A.6 order completion: a live HOLD/ATTACK task on the captured node pays
  // `+20` team OP and `+15 REQ` to every contributor in radius, capped so a
  // whole team cannot farm one order. The issuer's extra personal OP needs a
  // seat id; the V0b duty Chief is not a player, so only contributors are paid.
  if (nodeOrderTeams(state, node)[team] && state.tasks?.[team]) {
    state.tasks[team] = null;
    state.scores[team] = num(state.scores[team], 0) + ORDER_REWARD.teamOP;
    state.orderStats.completed = num(state.orderStats.completed, 0) + 1;
    const contributors = participants.slice(0, Math.max(1, ORDER_REWARD.contributorCap));
    for (const actor of contributors) {
      const reward = scoreEvent({kind: 'order', role: 'contributor'});
      addActorReq(actor, reward.req);
      actor.scoreStats.objectivePoints = num(actor.scoreStats.objectivePoints, 0) + reward.personalOP;
      actor.scoreStats.ordersContributed = num(actor.scoreStats.ordersContributed, 0) + 1;
      actor.ordersContributed = num(actor.ordersContributed, 0) + 1;
    }
    match?.emit?.('cocs-order-complete', {team, node: node.id, contributors: contributors.map(actor => actor.id), teamOP: ORDER_REWARD.teamOP});
  }
  if (node.archetype === 'array') state.arrayWinner = team;
  match?.emit?.('cocs-capture', {node: node.id, team, archetype: node.archetype, score: state.scores[team]});
  updateLiveNodes(state);
}

function captureNodeStep(match, state, node, dt, rate) {
  const {present, actors} = nodeActors(match, node);
  const ordered = nodeOrderTeams(state, node);
  // A team works the node when it has actors there, or an active order there
  // with no enemy actor on the point. Only actual actors can contest.
  const engaged = [];
  for (const team of [0, 1]) {
    if (!present[team] && !(ordered[team] && !present[1 - team])) continue;
    if (node.owner === team || capturableBy(state, node.id, team)) engaged.push(team);
  }
  node.contested = engaged.length > 1;
  if (engaged.length === 0) return;
  if (engaged.length > 1) {
    for (const team of engaged) node.progress[team] = Math.max(0, num(node.progress[team], 0) - rate * 0.75);
    return;
  }
  const team = engaged[0], other = team === 0 ? 1 : 0;
  node.progress[other] = Math.max(0, num(node.progress[other], 0) - rate * 0.75);
  if (node.owner === team) {
    for (const actor of actors[team]) actor.scoreStats.objectiveTime = (actor.scoreStats.objectiveTime ?? 0) + dt;
    return;
  }
  node.progress[team] = clamp01(num(node.progress[team], 0) + rate);
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
// Snapshot subtree. Id-keyed and delta-friendly: `nodes`, `scores`,
// `liveNodeIds` and `winner` are the frozen V0a interface; the V0b economy adds
// `flux`/`req`/`scouts`/`spots` additively (no base64, no actor object copies).
// ---------------------------------------------------------------------------
export function cocsSnapshot(match) {
  const state = match?.objectiveState;
  if (!state || state.kind !== COCS_KIND) return null;
  const scouts = [];
  for (const team of [0, 1]) {
    const actor = activeScoutActor(match, state, team);
    if (!actor) continue;
    scouts.push({
      id: actor.id, team,
      node: actor.scoutTargetNode ?? null,
      x: num(actor.x, 0), z: num(actor.z, 0),
      scanned: actor.scoutScanned === true,
      returning: actor.scoutReturning === true,
      idle: actor.scoutIdle === true,
      expireTick: num(actor.scoutExpireTick, 0),
    });
  }
  const spots = [];
  for (const id of Object.keys(state.spots ?? {}).map(Number).sort((a, b) => a - b)) {
    const spot = state.spots[id];
    if (!spot) continue;
    spots.push({id, team: spot.team, until: num(spot.until, 0), x: num(spot.x, 0), z: num(spot.z, 0), by: spot.by ?? null});
  }
  const req = (match?.actors ?? [])
    .filter(actor => actor && (actor.team === 0 || actor.team === 1))
    .sort((a, b) => a.id - b.id)
    .map(actor => ({id: actor.id, req: num(actor.req, 0), earned: num(actor.reqEarned, 0), spent: num(actor.reqSpent, 0)}));
  return {
    // Sim tick. `spots[].until` is a tick, so presentation subtracts this to
    // age the SPOT window without reaching into the live state.
    tick: num(state.tick, 0),
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
    // --- V0b economy / subagent surface (UI: exact field names) ------------
    flux: {0: num(state.flux?.[0], 0), 1: num(state.flux?.[1], 0)},
    fluxCap: num(state.fluxCap, FLUX_CAP),
    fluxIncome: {0: num(state.fluxIncome?.[0], 0), 1: num(state.fluxIncome?.[1], 0)},
    fluxUpkeep: {0: num(state.fluxUpkeep?.[0], 0), 1: num(state.fluxUpkeep?.[1], 0)},
    fluxSpent: {0: num(state.fluxSpent?.[0], 0), 1: num(state.fluxSpent?.[1], 0)},
    neglect: {0: num(state.neglect?.[0]?.value, 0), 1: num(state.neglect?.[1]?.value, 0)},
    req,
    scouts,
    scoutStats: {
      0: {...(state.scoutStats?.[0] ?? {})},
      1: {...(state.scoutStats?.[1] ?? {})},
    },
    spots,
    scans: {0: state.scans?.[0]?.nodeId ?? null, 1: state.scans?.[1]?.nodeId ?? null},
    orderStats: {issued: num(state.orderStats?.issued, 0), completed: num(state.orderStats?.completed, 0), byVerb: {...(state.orderStats?.byVerb ?? {HOLD: 0, ATTACK: 0, SCAN: 0})}},
    scoutCap: num(state.scoutCap, COCS_SCOUT.cap),
    scanRadius: COCS_SCAN_RADIUS,
    spotSeconds: COCS_SPOT_SECONDS,
    spotBonus: COCS_SPOT_DAMAGE_BONUS,
    // --- §6A traversal devices/depots (V0b) --------------------------------
    traversal: cocsTraversalSnapshot(state),
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

  // 4a. §6A.5 objective presence `REQ` (personal).
  accruePresenceReq(match, state, dt);

  // 4b. §6.5 team `FLUX`: passive + connected-node income, then the §6.5
  //     supply-load upkeep of every active subagent. `NEGLECT` only ever scales
  //     the passive term and is inert without a seated human commander.
  for (const team of [0, 1]) {
    const neglect = neglectTick(state.neglect?.[team] ?? neglectState(), dt, {humanCommander: false, activeOrder: false, contributed: false});
    state.neglect[team] = neglect;
    const passive = neglectPassiveFlux(FLUX_PASSIVE_PER_SECOND, neglect);
    const rate = passive + income[team];
    state.fluxIncome[team] = rate;
    const before = num(state.flux[team], 0);
    const grown = Math.min(num(state.fluxCap, FLUX_CAP), before + rate * dt);
    state.fluxEarned[team] = num(state.fluxEarned[team], 0) + Math.max(0, grown - before);
    state.flux[team] = grown;
  }
  for (const team of [0, 1]) {
    const scout = activeScoutActor(match, state, team);
    let upkeep = 0;
    if (scout) {
      const home = hqNodeFor(state, team);
      const hops = scout.scoutTargetNode && home ? latticeHops(state, home.id, scout.scoutTargetNode) : 0;
      upkeep = subagentUpkeep(SUBAGENTS.scout.id, 1, {hops, foundries: 0});
    }
    state.fluxUpkeep[team] = upkeep;
    if (scout) {
      scout.scoutUpkeep = upkeep;
      const drain = upkeep * dt;
      if (num(state.flux[team], 0) >= drain) {
        state.flux[team] = num(state.flux[team], 0) - drain;
        scout.scoutIdle = false;
      } else {
        // `FLUX` 0: the agent goes IDLE rather than dying (§6.5).
        state.flux[team] = 0;
        scout.scoutIdle = true;
      }
    }
  }

  // 4c. §8 SCOUT lifecycle: arrive -> scan -> return -> retire, plus expiry.
  for (const team of [0, 1]) stepScoutTeam(match, state, team, dt);

  // 4d. Expire `SPOT` marks on the fixed tick clock.
  for (const key of Object.keys(state.spots ?? {})) {
    const spot = state.spots[key];
    if (!spot || num(state.tick, 0) > num(spot.until, 0)) delete state.spots[key];
  }

  // 4e. §6A traversal layer: neutral device cut/lock/repair state, the 2.5 s
  //     shared cooldown, arrival protection and depot capture/loaners. All on
  //     the same fixed tick as every other cocs timer, with no RNG draw.
  stepCocsTraversal(match, state, dt);

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
