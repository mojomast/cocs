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

import {modeRule, cocsRung, cocsRungOf} from './config.mjs';
import {RULES} from './data.mjs';
import {COCS_SQUAD_ACTIONS, cocsCommandAuthority, cocsSquadAction, cocsSquadSnapshot} from './cocs-squads.mjs';
import {terrainSupportAt} from './terrain.mjs';
import {
  FLUX_CAP, FLUX_PASSIVE_PER_SECOND, FLUX_START, ORDER_REWARD, REQ_EARN, SUBAGENTS,
  neglectPassiveFlux, neglectState, neglectTick, reqItem, reqPurchase, scoreEvent, subagentUpkeep,
} from './cocs-economy.mjs';
import {PVP_ROLE_IDS, coopRole, roleAbility} from './cocs-roles.mjs';
import {createTraversalState, stepCocsTraversal, cocsTraversalSnapshot, humanDeviceInteract} from './cocs-traversal.mjs';
import {createTerminalState, stepCocsTerminals, cocsTerminalsSnapshot, humanTerminalInteract} from './cocs-terminals.mjs';
import {COOP_ECONOMY} from './cocs-difficulty.mjs';
import {COOP_PRIME_REACH, cocsCoopSnapshot, coopOrderGate, coopOutcome, coopPrimeNode, createCoopState, stepCoop} from './cocs-coop.mjs';
import {latticeCaptureRate, latticeCaptureResist, latticeSupportSnapshot, stepLatticeSupport} from './lattice-support.mjs';

export const COCS_KIND = 'cocs';
// The frozen node archetypes. Authored maps may spell a few of these
// differently (`infrastructure`/`foundry` are the map-spec names for a relay);
// `normalizeArchetype` folds them onto this set.
export const COCS_ARCHETYPES = Object.freeze(['front', 'economy', 'relay', 'hq', 'array']);
export const COCS_CAPTURABLE = Object.freeze(['front', 'economy', 'relay']);
export const COCS_ANCHORS = Object.freeze(['hq', 'array']);
export const COCS_ORDER_VERBS = Object.freeze(['HOLD', 'ATTACK', 'SCAN']);
// PvP-1 command stances (§5.7/§11.3). The `policy` command accepts exactly
// these; the bot plan reads them through `cocsCommandState` and biases the
// team's spread/garrison caps, and the field-support retreat threshold.
export const COCS_POLICIES = Object.freeze(['ASSAULT', 'HOLD', 'FORTIFY']);
export function normalizeCocsPolicy(value) {
  const stance = String(value ?? '').trim().toUpperCase();
  return COCS_POLICIES.includes(stance) ? stance : null;
}
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
// ---------------------------------------------------------------------------
// PvP-1 two-team command + role board (§3.1, §8.1, §12.3b).
//   * `COCS_ROLE_THREAD_BASE` is the §5.3 base concurrency (3), matching every
//     rung table; a rung overrides it and the PvP command caps concurrent
//     subagents/scouts at it.
//   * `COCS_ROLE_SPAWN_INTERVAL` is the duty board's deterministic role-unit
//     cadence (6 s). No RNG, no clock: every team issues on the same tick.
//   * `COCS_ROLE_TARGET_CONCURRENCY` keeps the board from flooding the lattice:
//     each team fields at most two role units on top of the free scout.
//   * `COCS_SABOTAGE_SECONDS` is the SABOTEUR sapper cut window when no ability
//     table value is present.
// ---------------------------------------------------------------------------
export const COCS_ROLE_THREAD_BASE = 3;
export const COCS_ROLE_SPAWN_INTERVAL = 360;
export const COCS_ROLE_TARGET_CONCURRENCY = 2;
export const COCS_SABOTAGE_SECONDS = 45;
export const COCS_SIPHON_FLUX = 12;
export const COCS_ROLE_REACH = 3;
export const COCS_VISIBILITY_TEAMS = Object.freeze([0, 1]);
// Objective score banked when a node flips. Objectives are primary (§6A.4).
export const COCS_CAPTURE_POINTS = Object.freeze({front: 10, economy: 15, relay: 20, hq: 0, array: 50});
export const COCS_OPENING_FRACTION = 0.22;
export const COCS_ENDGAME_FRACTION = 0.68;
export const COCS_ORDER_LOG_LIMIT = 64;
// PvP role-spend outcome log (the between-wave `coop.spendLog` analogue). The
// room mirrors every accepted action card as `running`; this bounded,
// deterministic log is the sim-side authority the room settles those cards
// from, so the board never depends on network-side guesses about an outcome.
// Plain state (not part of the snapshot) and trimmed like `orderLog`.
export const COCS_SPEND_LOG_LIMIT = 64;
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
    const label = typeof entry.label === 'string' && entry.label ? entry.label : null;
    return {id, x, z, y, r, archetype, owner, label, progress: {0: 0, 1: 0}, contested: false, live: false};
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
  // LATTICE STRIKE: OPERATIONS is the `coop:true` branch of the same objective
  // kind. It raises the one-sided economy, seeds the Operations Director state
  // and adds the HQ-siege loss. Non-coop `cocs` keeps its exact V0b constants.
  const coop = rules.coop === true;
  // PvP-1 rung ladder (§3.1). `cocs-coop` is a single human team and never
  // consults a rung; a PvP `cocs` match with no explicit rung stays on the full
  // five-role launch set (a practice match, not a laddered queue entry). The
  // rung owns the opening economy, the live-node floor and the role allow-list.
  const rungId = coop ? null : cocsRungOf(config);
  const rung = cocsRung(rungId);
  const economy = coop
    ? COOP_ECONOMY
    : {
      fluxStart: rung ? rung.fluxStart : FLUX_START,
      fluxCap: rung ? rung.fluxCap : FLUX_CAP,
      fluxPassivePerSecond: FLUX_PASSIVE_PER_SECOND,
      reqMultiplier: 1,
    };
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
  // A rung may scale the dominance window (§3.1 Skirmish shape): a larger 8v8
  // lattice gets a longer sustained hold so a swallowed lead stays recoverable,
  // while 4v4 keeps the published 90/45. This is content timing, never HP/damage.
  const dominanceHold = Math.max(1, rung ? rung.dominance.hold : num(objective.dominanceHold, 90));
  const dominanceFastSeconds = Math.max(1, rung ? rung.dominance.fast : num(objective.dominanceFast, 45));
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
    // The rung owns the live-node floor when present (§3.1); both published
    // rungs match the mode rules, so an un-laddered match is unchanged.
    liveMin: Math.max(1, Math.round(rung ? rung.live.opening : num(objective.liveOpening, 3))),
    liveMax: Math.max(1, Math.round(rung ? rung.live.max : num(objective.liveMax, 5))),
    endgameLive: Math.max(1, Math.round(rung ? rung.live.endgame : num(objective.endgameLive, 5))),
    dominanceCount,
    dominanceFastCount,
    dominanceHold,
    dominanceFast: dominanceFastSeconds,
    dominance: {team: null, progress: 0, target: dominanceHold, fast: false},
    scores: {0: 0, 1: 0},
    income: {0: 0, 1: 0},
    // --- §6.5/§6A.5 two-layer economy ---------------------------------------
    flux: {0: economy.fluxStart, 1: economy.fluxStart},
    fluxCap: economy.fluxCap,
    fluxPassive: economy.fluxPassivePerSecond,
    reqMult: economy.reqMultiplier,
    coop: false,
    coopMode: coop,
    coopTier: 'D1',
    fluxEarned: {0: 0, 1: 0},
    fluxSpent: {0: 0, 1: 0},
    fluxUpkeep: {0: 0, 1: 0},
    fluxIncome: {0: 0, 1: 0},
    neglect: {0: neglectState(), 1: neglectState()},
    // §6A.6 NEGLECT order-contribution telemetry. Plain state (never
    // snapshotted): `neglectEvents` records the authoritative completion
    // transition so the next economy tick can reset the meter, while a task
    // whose `until` has passed without completion expires. Both are read and
    // drained by `cocsNeglectContext` in `stepCocs`.
    neglectEvents: {0: {completed: false, cancelled: false}, 1: {completed: false, cancelled: false}},
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
    spendLog: [],
    orderTtlTicks: Math.max(1, Math.round(ORDER_TTL_SECONDS / (RULES.dt || 1 / 60))),
    // --- PvP-1 rung ladder + two-team command + role board -------------------
    // `rung` is null for co-op and for an un-laddered practice `cocs`; the role
    // allow-list is then the full launch set. `threads` is the §5.3 per-team
    // concurrency budget and `roleSpawns` the id-sorted live-role roster.
    rung: rungId,
    roleAllow: coop ? null : [...(rung ? rung.roles : PVP_ROLE_IDS)],
    threads: {
      0: {used: 0, cap: rung ? rung.threads : COCS_ROLE_THREAD_BASE},
      1: {used: 0, cap: rung ? rung.threads : COCS_ROLE_THREAD_BASE},
    },
    // PvP-1 per-team command seat (§5.7, §11.2/§11.3). The seat is an opaque
    // peer id (or null) per team; the room validates the transport peer, the sim
    // records it, and the snapshot round-trips it so a reconnect resyncs the
    // whole board. Co-op keeps its own `state.coop` command state and never
    // reads this.
    command: {seat: {0: null, 1: null}, votes: {0: {}, 1: {}}, route: {0: null, 1: null}, policy: {0: null, 1: null}},
    roleSpawns: {0: [], 1: []},
    roleStats: {
      0: {spawned: 0, killed: 0, expired: 0, byRole: {}},
      1: {spawned: 0, killed: 0, expired: 0, byRole: {}},
    },
    // SABOTEUR sapper windows, keyed by node id: {team, actor, until}. The
    // sapper cuts through the shared `cuts` list; this map only owns the repair
    // timer so a cut cannot outlive its window.
    sabotage: {},
    siphonStats: {0: {count: 0, flux: 0}, 1: {count: 0, flux: 0}},
    tick: 0,
    front: null,
    arrayWinner: null,
    winReason: null,
  };
  state.zones = capturable.map(node => ({id: node.id, x: node.x, z: node.z, y: node.y, radius: node.r}));
  // §6A traversal layer (V0b): authored devices/depots only. An unauthored map
  // stays `null` so every prior mode/behaviour is untouched.
  state.traversal = createTraversalState(arena, {botUse: config?.objective?.traversalBotUse === true});
  if (coop) {
    state.coopTier = config?.objective?.tier ?? config?.coopTier ?? 'D1';
    state.coop = createCoopState(state, {tier: state.coopTier});
    // O1c terminals are co-op only: PvPvE `cocs` behaviour and snapshots stay
    // byte-identical, and a non-coop state keeps `terminals === null`.
    state.terminals = createTerminalState(state);
  }
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
    // O1c HARVESTER PRIME (§4.8): an active prime on a node pays +50% FLUX.
    // PvPvE never sets `node.prime`, so this is exactly 1 there.
    const primed = node.prime && node.prime.team === owner && num(state.tick, 0) <= num(node.prime.until, 0);
    income[owner] += (COCS_INCOME[node.archetype] ?? 0) * (primed ? 1 + num(node.prime.fluxBonus, 0) : 1);
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
  const reject = (reason = entry.reason ?? 'blocked') => {
    entry.reason = reason;
    state.orderLog.push(entry);
    trimOrderLog(state);
    // Local matches have no wire `cocs-reject`; the sim event is what makes a
    // refused order visible (and it reaches the wire as a normal match event).
    match?.emit?.('cocs-order-rejected', {team, verb, node: entry.target, label: nodeById(state, entry.target)?.label ?? null, reason, peerId: entry.peerId, cardId: entry.cardId});
    return false;
  };
  if ((team !== 0 && team !== 1) || !COCS_ORDER_VERBS.includes(verb) || target === null) return reject();
  const node = nodeById(state, target);
  if (!node) return reject();
  // OPERATIONS command gates (owner decision 3): a big card (SCAN) needs the
  // rotating executor lease, and every spend must fit the player's FLUX slice.
  if (state.coopMode === true) {
    const gate = coopOrderGate(match, state, {team, verb, peerId: entry.peerId});
    if (!gate.ok) { entry.reason = gate.reason; return reject(gate.reason); }
  }
  if (verb === 'SCAN' && state.coopMode !== true) {
    // PvP-1 THREADS gate: a SCAN spawns a scout, which itself occupies a thread.
    // The duty board and the wire both honour the same per-team cap.
    if (cocsThreadsUsed(match, state, team) >= num(state.threads?.[team]?.cap, COCS_ROLE_THREAD_BASE)) { entry.reason = 'no-thread'; return reject(); }
  }
  if (verb === 'SCAN') {
    const ok = issueScanOrder(match, state, team, node);
    entry.ok = ok;
    state.orderLog.push(entry);
    trimOrderLog(state);
    if (!ok) return false;
    state.orderStats.issued = num(state.orderStats.issued, 0) + 1;
    state.orderStats.byVerb[verb] = num(state.orderStats.byVerb?.[verb], 0) + 1;
    if (state.scans?.[team]) { state.scans[team].peerId = entry.peerId; state.scans[team].cardId = entry.cardId; }
    match?.emit?.('cocs-order', {team, verb, node: node.id, label: node.label ?? null, tick: entry.tick, peerId: entry.peerId, cardId: entry.cardId});
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
  match?.emit?.('cocs-order', {team, verb, node: node.id, label: node.label ?? null, tick: entry.tick, peerId: entry.peerId, cardId: entry.cardId});
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
  // PvP-1 rung allow-list: a 4v4 rung fields FIGHTER/HARVESTER/BUILDER only, so
  // its board can never spawn the SCOUT. A null rung (practice/co-op) allows it.
  if (!cocsRoleAllowedOnRung(state, COCS_SCOUT.role)) return null;
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

// ===========================================================================
// PvP-1: two-team command, the per-team role board and per-team visibility.
//
// Every team runs its own duty Chief (`chief-0` / `chief-1`), its own FLUX and
// THREADS budget and its own role roster. Nothing here is shared between the
// teams: the revision-1 bug where both sides read one computed value cannot
// occur because `cocsTeamCommand` / `cocsTeamVisibility` are pure functions of
// `(match, state, team)`. All lists are id-sorted, every timer is a tick count
// at `RULES.dt`, and no code path draws the RNG.
// ===========================================================================
const nodeIdSort = (a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
const SABOTEUR_INTERVAL_TICKS = Math.max(1, Math.round(3 / (RULES.dt || 1 / 60)));

/** Living role-board actors for one team (excludes the free SCAN scout). */
export function cocsRoleActors(match, state, team) {
  const list = state?.roleSpawns?.[team] ?? [];
  const out = [];
  for (const id of list) {
    const actor = match?.actors?.[id];
    if (actor && actor.health > 0 && actor.isSubagent === true && actor.subagentTeam === team) out.push(actor);
  }
  return out;
}

/** THREADS in use by one team: every living subagent plus the SCAN scout. */
export function cocsThreadsUsed(match, state, team) {
  let used = 0;
  for (const actor of match?.actors ?? []) {
    if (!actor || actor.health <= 0) continue;
    if (actor.team !== team) continue;
    if (actor.isSubagent === true || actor.isScout === true) used++;
  }
  return used;
}

/** The published allow-list gate. A null rung (co-op / practice) allows all. */
export function cocsRoleAllowedOnRung(state, role) {
  const allow = state?.roleAllow;
  if (!Array.isArray(allow)) return true;
  return allow.includes(String(role ?? '').trim().toLowerCase());
}

/**
 * One team's command readout (section 5.3 + 5.9). Pure: no clock, no RNG. The
 * duty Chief for `team` reads exactly this, so FLUX and THREADS can never be
 * spent by the other team's board.
 */
export function cocsTeamCommand(match, state, team) {
  if (!state || state.kind !== COCS_KIND) return null;
  const t = team === 0 || team === 1 ? Number(team) : 0;
  const cap = num(state.threads?.[t]?.cap, COCS_ROLE_THREAD_BASE);
  const used = cocsThreadsUsed(match, state, t);
  const task = state.tasks?.[t] ?? null;
  return {
    team: t,
    rung: state.rung ?? null,
    chief: `chief-${t}`,
    flux: num(state.flux?.[t], 0),
    threads: {used, cap, free: Math.max(0, cap - used)},
    roles: [...(state.roleAllow ?? [])],
    task: task ? {verb: task.verb, nodeId: task.nodeId, until: task.until} : null,
    squads: cocsRoleActors(match, state, t).map(actor => ({
      id: actor.id, role: actor.subagentRole ?? null, health: num(actor.health, 0),
      max: num(actor.maxHealth, 0), nodeId: actor.subagentNode ?? null,
    })),
  };
}

// A deterministic hint node for a freshly-spawned role. Saboteurs and
// harvesters get their thematic target; other roles take the team's front.
function cocsRoleTargetNode(state, team, role) {
  const enemy = 1 - team;
  const capturable = [...capturableNodes(state)].sort(nodeIdSort);
  if (role === 'saboteur') {
    const enemyOwned = capturable.filter(node => node.owner === enemy && (node.archetype === 'relay' || node.archetype === 'economy'));
    return (enemyOwned[0] ?? capturable.find(node => node.owner === enemy) ?? null)?.id ?? null;
  }
  if (role === 'harvester') {
    return (capturable.find(node => node.owner === team && node.archetype === 'economy')
      ?? capturable.find(node => node.owner === team) ?? null)?.id ?? null;
  }
  if (role === 'builder') {
    return (capturable.find(node => node.owner === team) ?? capturable.find(node => node.owner === null) ?? null)?.id ?? null;
  }
  return frontState(state).byTeam?.[team]?.nodeId ?? capturable.find(node => node.owner === enemy)?.id ?? null;
}

/**
 * Spawn one PvP role unit for `team`. The allow-list is the hard gate: a 4v4
 * rung can never field SCOUT or SABOTEUR, and an 8v8 rung can. Returns the new
 * actor or null when the rung/economy/THREADS gate refuses.
 */
export function cocsRoleSpawn(match, state, team, roleId, nodeId = null) {
  if (!match || !state || state.coopMode === true) return null;
  if (team !== 0 && team !== 1) return null;
  const key = String(roleId ?? '').trim().toLowerCase();
  const def = coopRole(key);
  if (!def) return null;
  if (!cocsRoleAllowedOnRung(state, key)) return null;
  // Scouts ride the SCAN path (`spawnScout`); the role board never duplicates.
  if (key === 'scout') return null;
  const cap = num(state.threads?.[team]?.cap, COCS_ROLE_THREAD_BASE);
  if (cocsThreadsUsed(match, state, team) >= cap) return null;
  const cost = num(def.spawnCost, 0);
  if (num(state.flux?.[team], 0) + 1e-9 < cost) return null;
  const actor = match.actor(nextActorId(match), 'chatgpt', 'openclaw');
  actor.team = team;
  actor.isNpc = true;
  actor.isSubagent = true;
  actor.subagentRole = key;
  actor.subagentTeam = team;
  actor.subagentNode = nodeId ?? null;
  actor.subagentExpireTick = num(state.tick, 0) + Math.max(1, Math.round(num(def.lifespanSeconds, 90) / (RULES.dt || 1 / 60)));
  actor.name = def.name;
  actor.meleeDamage = 0;
  actor.npcProfile = {
    health: def.health, armor: def.armor, speedMult: 1,
    damageMult: key === 'fighter' || key === 'saboteur' ? 1 : 0.15,
    scale: 0.8, color: team === 0 ? '#7fd4ff' : '#ffb27f', accent: '#0b1a24', points: 0,
  };
  if (!actor.bot) actor.bot = {route: [], think: 0, target: -1, memory: 0, reaction: 0, stuck: 0, last: {x: 0, y: 0, z: 0}, state: 'roam', patrol: 0, flank: null, flankDone: false, recover: 0, suppressed: 0, threat: -1, standoff: null, strafeReverse: -99};
  match.actors.push(actor);
  match.spawn(actor);
  actor.maxHealth = def.health;
  actor.health = actor.maxHealth;
  state.flux[team] = num(state.flux[team], 0) - cost;
  state.fluxSpent[team] = num(state.fluxSpent[team], 0) + cost;
  (state.roleSpawns[team] ??= []).push(actor.id);
  const stats = state.roleStats[team] ?? (state.roleStats[team] = {spawned: 0, killed: 0, expired: 0, byRole: {}});
  stats.spawned = num(stats.spawned, 0) + 1;
  stats.byRole[key] = num(stats.byRole[key], 0) + 1;
  match.emit?.('cocs-role-spawn', {team, role: key, actor: actor.id, cost, node: nodeId ?? null});
  return actor;
}

// The economy nodes currently linked back to `team`'s HQ. Used to price a cut
// (`20 + 5 x deniedNodes`, section 9.2) deterministically.
function connectedNodeIds(state, team) {
  const out = [];
  for (const node of capturableNodes(state)) {
    if (node.owner !== team) continue;
    if (connectedToHq(state, node.id, team)) out.push(node.id);
  }
  return out;
}

/**
 * SABOTEUR `SAPPER` (section 8.1: "cut supply links"). Cuts the target enemy
 * node's link for its window and pays the section 9.2 cut bounty scaled by how
 * many downstream nodes the cut actually denies. Pure state mutation, no RNG.
 */
export function cocsSapper(match, state, actor, nodeId) {
  if (!actor || actor.subagentRole !== 'saboteur' || actor.health <= 0) return {ok: false, reason: 'role'};
  const team = actor.team;
  if (team !== 0 && team !== 1) return {ok: false, reason: 'team'};
  const node = nodeById(state, nodeId);
  if (!node) return {ok: false, reason: 'target'};
  if (node.owner !== 1 - team) return {ok: false, reason: 'target'};
  if (Math.hypot(num(actor.x, 0) - node.x, num(actor.z, 0) - node.z) > num(node.r, 4) + COCS_ROLE_REACH) return {ok: false, reason: 'range'};
  if ((state.sabotage ?? {})[node.id]) return {ok: false, reason: 'already-cut'};
  const ability = roleAbility('saboteur', 'ATTACK') ?? {};
  const seconds = num(ability.cutSeconds, COCS_SABOTAGE_SECONDS);
  const before = new Set(connectedNodeIds(state, node.owner));
  cutLink(state, node.id);
  const after = new Set(connectedNodeIds(state, node.owner));
  let denied = 0;
  for (const id of before) if (!after.has(id)) denied++;
  state.sabotage[node.id] = {team, actor: actor.id, until: num(state.tick, 0) + Math.max(1, Math.round(seconds / (RULES.dt || 1 / 60)))};
  const bounty = Math.max(6, Math.min(48, num(ability.bountyBase, 20) + num(ability.bountyPerNode, 5) * denied));
  state.flux[team] = Math.min(num(state.fluxCap, FLUX_CAP), num(state.flux[team], 0) + bounty);
  state.fluxEarned[team] = num(state.fluxEarned[team], 0) + bounty;
  const reward = scoreEvent({kind: 'cut', deniedNodes: denied});
  state.scores[team] = num(state.scores[team], 0) + (typeof reward.teamOP === 'number' ? reward.teamOP : 0);
  addActorReq(actor, reward.req);
  actor.scoreStats.objectivePoints = num(actor.scoreStats.objectivePoints, 0) + reward.personalOP;
  actor.scoreStats.cuts = num(actor.scoreStats.cuts, 0) + 1;
  match?.emit?.('cocs-sapper', {team, actor: actor.id, node: node.id, seconds, denied, bounty});
  return {ok: true, reason: null, node: node.id, denied, bounty};
}

/**
 * SABOTEUR `SIPHON` (section 8.1 / 6.5). Pulls FLUX out of the enemy pool on an
 * already-cut enemy node; a deterministic, bounded denial with no RNG.
 */
export function cocsSiphon(match, state, actor, nodeId) {
  if (!actor || actor.subagentRole !== 'saboteur' || actor.health <= 0) return {ok: false, reason: 'role'};
  const team = actor.team;
  if (team !== 0 && team !== 1) return {ok: false, reason: 'team'};
  const node = nodeById(state, nodeId);
  if (!node || node.owner !== 1 - team) return {ok: false, reason: 'target'};
  const ability = roleAbility('saboteur', 'SIPHON') ?? {};
  const amount = Math.max(0, num(ability.flux, COCS_SIPHON_FLUX));
  const enemy = 1 - team;
  const take = Math.min(amount, num(state.flux?.[enemy], 0));
  if (!(take > 0)) return {ok: false, reason: 'empty'};
  state.flux[enemy] = num(state.flux[enemy], 0) - take;
  state.flux[team] = Math.min(num(state.fluxCap, FLUX_CAP), num(state.flux[team], 0) + take);
  const stats = state.siphonStats[team] ?? (state.siphonStats[team] = {count: 0, flux: 0});
  stats.count = num(stats.count, 0) + 1;
  stats.flux = num(stats.flux, 0) + take;
  addActorReq(actor, num(ability.req, 0));
  actor.scoreStats.siphons = num(actor.scoreStats.siphons, 0) + 1;
  match?.emit?.('cocs-siphon', {team, actor: actor.id, node: node.id, enemy, flux: take});
  return {ok: true, reason: null, node: node.id, flux: take};
}

/** Use the SABOTEUR ability on the best target currently in reach. */
export function cocsSaboteurAct(match, state, actor) {
  if (!actor || actor.subagentRole !== 'saboteur' || actor.health <= 0) return null;
  const team = actor.team;
  if (team !== 0 && team !== 1) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const node of capturableNodes(state)) {
    if (node.owner !== 1 - team) continue;
    if (node.archetype !== 'relay' && node.archetype !== 'economy') continue;
    const distance = Math.hypot(num(actor.x, 0) - node.x, num(actor.z, 0) - node.z);
    if (distance > num(node.r, 4) + COCS_ROLE_REACH) continue;
    if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) < 1e-9 && best && String(node.id) < String(best.id))) {
      bestDistance = distance;
      best = node;
    }
  }
  if (!best) return null;
  // A cut node is already denied: the saboteur then siphons instead of
  // re-cutting, so both verbs are live in one deterministic rotation.
  if ((state.cuts ?? []).includes(best.id)) return cocsSiphon(match, state, actor, best.id);
  return cocsSapper(match, state, actor, best.id);
}

// Retire one role actor without touching roster indices. Dead/expired units stay
// in `match.actors` with health 0 and an infinite respawn timer so the engine
// never revives them; the slot is simply abandoned (ids are never reused).
function retireCocsRole(match, state, team, actor, reason = 'expire') {
  if (!actor || actor.isSubagent !== true || actor.subagentTeam !== team) return false;
  const role = actor.subagentRole ?? null;
  const def = coopRole(role);
  const stats = state.roleStats[team] ?? (state.roleStats[team] = {spawned: 0, killed: 0, expired: 0, byRole: {}});
  if (reason === 'killed') {
    stats.killed = num(stats.killed, 0) + 1;
    const upkeep = num(actor.subagentUpkeep, subagentUpkeep(role, 1, {hops: 0, foundries: 0}));
    const bounty = Math.max(6, Math.min(48, Math.round(15 * upkeep)));
    const enemy = 1 - team;
    state.flux[enemy] = Math.min(num(state.fluxCap, FLUX_CAP), num(state.flux[enemy], 0) + bounty);
    state.fluxEarned[enemy] = num(state.fluxEarned[enemy], 0) + bounty;
    const reward = scoreEvent({kind: 'killSubagent'});
    state.scores[enemy] = num(state.scores[enemy], 0) + (typeof reward.teamOP === 'number' ? reward.teamOP : 0);
    const killer = num(actor.lastHitBy, -1) >= 0 ? match.actors[actor.lastHitBy] : null;
    if (killer && killer.team !== team) {
      addActorReq(killer, reward.req);
      killer.scoreStats.objectivePoints = num(killer.scoreStats.objectivePoints, 0) + reward.personalOP;
      killer.scoreStats.subagentKills = num(killer.scoreStats.subagentKills, 0) + 1;
    }
    match?.emit?.('cocs-role-killed', {team, role, actor: actor.id, killer: killer?.id ?? null, bounty});
  } else {
    stats.expired = num(stats.expired, 0) + 1;
    const refund = Math.round(num(def?.spawnCost, 0) * num(def?.refundFraction, 0.4));
    state.flux[team] = Math.min(num(state.fluxCap, FLUX_CAP), num(state.flux[team], 0) + refund);
    state.fluxEarned[team] = num(state.fluxEarned[team], 0) + refund;
    match?.emit?.('cocs-role-expire', {team, role, actor: actor.id, refund});
  }
  actor.health = 0;
  actor.dead = 1e9;
  actor.bot = null;
  actor.vx = actor.vy = actor.vz = 0;
  return true;
}

// `true` when `team` trails on the node tally or the objective score, using the
// same signals as the W8 bot comeback (`game/cocs-bots.mjs`). Pure; the role
// board gives a trailing team an extra thread so the fifth role is a comeback
// option rather than a snowball lever (section 9).
function cocsTeamBehind(state, team) {
  const capturable = capturableNodes(state);
  if (!capturable.length) return false;
  let owned = 0, enemy = 0;
  for (const node of capturable) {
    if (node.owner === team) owned++;
    else if (node.owner === 1 - team) enemy++;
  }
  const majority = Math.max(1, Math.round(state.dominanceCount ?? (Math.floor(capturable.length / 2) + 1)));
  if (enemy > owned && enemy >= majority) return true;
  const mine = Math.max(0, Number(state.scores?.[team]) || 0);
  const theirs = Math.max(0, Number(state.scores?.[1 - team]) || 0);
  return theirs > mine + 0.15 * (mine + theirs);
}

// The duty board's deterministic spawn decision. Runs on the shared
// `COCS_ROLE_SPAWN_INTERVAL` tick. Role units are the section 9 "underdog gets
// new options" lever, not a snowball: a team trailing on the node tally or the
// objective score fields up to `COCS_ROLE_TARGET_CONCURRENCY` board units,
// while a level or leading team fields none. The rotation walks the rung
// allow-list (SCAN scouts excluded because `spawnScout` owns them). No RNG draw.
export function cocsDutyRolePolicy(match, state, context = {}) {
  if (!match || !state || state.kind !== COCS_KIND) return [];
  if (state.coopMode === true || !state.rung) return [];
  const tick = num(context.tick, num(state.tick, 0));
  if (tick <= 0 || tick % COCS_ROLE_SPAWN_INTERVAL !== 0) return [];
  const events = [];
  for (const team of [0, 1]) {
    const targetConcurrency = cocsTeamBehind(state, team) ? COCS_ROLE_TARGET_CONCURRENCY : 0;
    if (targetConcurrency <= 0) continue;
    if (cocsRoleActors(match, state, team).length >= targetConcurrency) continue;
    const candidates = (state.roleAllow ?? []).filter(role => role !== 'scout');
    if (!candidates.length) continue;
    const serial = num(state.roleStats?.[team]?.spawned, 0);
    const role = candidates[serial % candidates.length];
    const target = cocsRoleTargetNode(state, team, role);
    const actor = cocsRoleSpawn(match, state, team, role, target);
    if (actor) events.push({team, role, actor: actor.id, node: target});
  }
  return events;
}

/** Per-team role board snapshot (id-keyed, delta-friendly, sorted). */
export function cocsRoleBoardSnapshot(match, state, team) {
  const t = team === 0 || team === 1 ? Number(team) : 0;
  const stats = state?.roleStats?.[t] ?? {spawned: 0, killed: 0, expired: 0, byRole: {}};
  return {
    team: t,
    rung: state?.rung ?? null,
    allow: [...(state?.roleAllow ?? [])],
    threads: {used: cocsThreadsUsed(match, state, t), cap: num(state?.threads?.[t]?.cap, COCS_ROLE_THREAD_BASE)},
    spawned: num(stats.spawned, 0),
    killed: num(stats.killed, 0),
    expired: num(stats.expired, 0),
    byRole: {...(stats.byRole ?? {})},
    agents: cocsRoleActors(match, state, t).map(actor => ({
      id: actor.id, role: actor.subagentRole ?? null, team: t,
      health: num(actor.health, 0), max: num(actor.maxHealth, 0),
      nodeId: actor.subagentNode ?? null,
    })),
  };
}

/**
 * PvP-1/OPERATIONS command read (seat, route policy). PvP records them under
 * `state.command`; OPERATIONS keeps its own copy under `state.coop`. One
 * accessor keeps the bot plan, neglect and the presentation reading the same
 * authoritative record instead of each hard-coding the split.
 */
export function cocsCommandState(state, team) {
  const t = team === 1 ? 1 : 0;
  if (!state || state.kind !== COCS_KIND) return {seat: null, route: null, policy: null};
  if (state.coop) {
    return {
      seat: state.coop.commandSeat?.[t] ?? null,
      route: state.coop.commandRoute?.[t] ?? null,
      policy: state.coop.commandPolicy?.[t] ?? null,
    };
  }
  return {
    seat: state.command?.seat?.[t] ?? null,
    route: state.command?.route?.[t] ?? null,
    policy: state.command?.policy?.[t] ?? null,
  };
}

/**
 * PvP-1 command board action (§5.7/§11.2). The room validates the transport
 * peer and the team; this records the seat/route/policy on the authoritative
 * state so a reconnect resync is complete. Pure state mutation, no RNG, no
 * clock. Co-op routes to `coopCommandAction` instead.
 */
export function cocsCommandAction(match, state, record = {}) {
  if (!state || state.kind !== COCS_KIND || state.coopMode === true) return {ok: false, reason: 'no-command'};
  const authority = cocsCommandAuthority(match, state, record);
  if (!authority.ok) return {ok: false, reason: authority.reason};
  if (COCS_SQUAD_ACTIONS.includes(String(record.action).toLowerCase())) return cocsSquadAction(match, state, record);
  const cmd = state.command;
  if (!cmd) return {ok: false, reason: 'no-command'};
  cmd.seat ??= {0: null, 1: null};
  cmd.votes ??= {0: {}, 1: {}};
  cmd.route ??= {0: null, 1: null};
  cmd.policy ??= {0: null, 1: null};
  const team = record.team === 1 ? 1 : 0;
  const peerId = String(record.peerId ?? '');
  const action = String(record.action ?? '').toLowerCase();
  const tick = num(state.tick, 0);
  // Every successful action is mirrored as one sim event so the presentation
  // (captions, earcons, board chips) never has to diff the snapshot.
  const announce = (extra = {}) => {
    match?.emit?.('cocs-command', {team, action, peerId, tick, value: record.value ?? null, ...extra});
    return {ok: true, reason: null, ...extra};
  };
  if (action === 'take') {
    cmd.seat[team] = peerId || null;
    cmd.votes[team] = {};
    return announce({seat: cmd.seat[team]});
  }
  if (action === 'release') {
    if (cmd.seat[team] !== peerId) return {ok: false, reason: 'not-commander'};
    cmd.seat[team] = null;
    return announce({seat: null});
  }
  if (action === 'mutiny-vote') {
    cmd.votes[team][peerId] = true;
    // A mutiny needs a strict majority of the team's living human seats. Bots
    // never vote, so the duty Chief can never be replaced by AI seats.
    const humans = (match?.actors ?? [])
      .filter(actor => actor && actor.health > 0 && actor.team === team && actor.isNpc !== true && actor.bot == null)
      .map(actor => actor.id)
      .sort((a, b) => a - b);
    const needed = Math.max(1, Math.floor(humans.length / 2) + 1);
    const votes = cmd.votes[team];
    const count = humans.filter(id => votes[String(id)] === true).length;
    if (humans.length > 0 && count >= needed && cmd.seat[team] !== peerId) {
      cmd.seat[team] = peerId;
      cmd.votes[team] = {};
      return announce({votes: count, needed, seat: peerId});
    }
    return {ok: true, reason: null, votes: count, needed};
  }
  if (action === 'set-route') {
    const raw = record.value === null || record.value === undefined || record.value === '' ? null : String(record.value);
    // A route must name a real lattice node so every reader (bot plan, board,
    // reconnect snapshot) agrees on the destination.
    if (raw !== null && !nodeById(state, raw)) return {ok: false, reason: 'unknown-node'};
    cmd.route[team] = raw;
    return announce({route: raw});
  }
  if (action === 'policy') {
    const raw = record.value === null || record.value === undefined || record.value === '' ? null : normalizeCocsPolicy(record.value);
    if (record.value !== null && record.value !== undefined && record.value !== '' && raw === null) return {ok: false, reason: 'stance'};
    cmd.policy[team] = raw;
    return announce({policy: raw});
  }
  if (action === 'opt-out-orders') {
    const actor = authority.actor;
    if (!actor || actor.team !== team) return {ok: false, reason: 'missing'};
    actor.ordersOptOut = true;
    return {ok: true, reason: null};
  }
  return {ok: false, reason: 'unknown-action'};
}

/**
 * PvP-1 economy action (§11.2): a `spawn`/`reinforce` spend buys one role from
 * the team's rung allow-list out of its own FLUX under its own THREADS cap.
 * Sinks with no PvP implementation (FORTIFY/REPAIR/RESUPPLY) are refused. The
 * same gates apply here and in the duty board, so a wire spend can never exceed
 * what the deterministic Chief could do. Pure, id-sorted, no RNG.
 *
 * Public wrapper: applies the action and records its outcome in the bounded
 * `state.spendLog`, so the room can settle the action card it mirrored.
 */
export function cocsEconomyAction(match, state, record = {}) {
 const result = applyCocsEconomyAction(match, state, record);
 if (state && state.kind === COCS_KIND && state.coopMode !== true) {
  const log = state.spendLog ?? (state.spendLog = []);
  log.push({
   tick: num(record.tick, state.tick), peerId: String(record.peerId ?? ''), cardId: String(record.cardId ?? ''),
   team: record.team === 1 ? 1 : 0, verb: String(record.action ?? record.verb ?? '').toLowerCase(),
   role: record.role ?? null, target: record.target ?? null,
   ok: result.ok === true, reason: result.reason ?? null,
  });
  trimSpendLog(state);
 }
 return result;
}

function trimSpendLog(state) {
 const log = state.spendLog;
 if (Array.isArray(log) && log.length > COCS_SPEND_LOG_LIMIT) log.splice(0, log.length - COCS_SPEND_LOG_LIMIT);
}

function applyCocsEconomyAction(match, state, record = {}) {
  if (!match || !state || state.kind !== COCS_KIND || state.coopMode === true) return {ok: false, reason: 'no-economy'};
  const team = record.team === 1 ? 1 : 0;
  // Local practice queues the page's `{verb}` record shape; the wire and the
  // room queue `{action}`. Both are the same action id, so accept either and
  // normalise case (a local REINFORCE is never silently dropped).
  const action = String(record.action ?? record.verb ?? '').toLowerCase();
  if (action === 'opt-out-orders') {
    const actor = match.actors?.[record.actorId];
    if (!actor || actor.team !== team) return {ok: false, reason: 'missing'};
    actor.ordersOptOut = true;
    return {ok: true, reason: null};
  }
  if (action !== 'spawn' && action !== 'reinforce') return {ok: false, reason: 'no-sink'};
  const role = String(record.role ?? 'fighter').trim().toLowerCase();
  const cap = num(state.threads?.[team]?.cap, COCS_ROLE_THREAD_BASE);
  if (!cocsRoleAllowedOnRung(state, role)) return {ok: false, reason: 'role'};
  if (role === 'scout') {
    // A live scout retargets for free; only a fresh spawn consumes a new thread.
    const node = nodeById(state, record.target);
    if (!node) return {ok: false, reason: 'target'};
    const active = activeScoutActor(match, state, team);
    if (active) {
      active.scoutTargetNode = node.id;
      active.scoutTarget = scoutTargetPoint(state, node.id);
      active.scoutReturning = false;
      active.scoutScanned = false;
      return {ok: true, reason: null, role, actor: active.id, retargeted: true};
    }
    if (cocsThreadsUsed(match, state, team) >= cap) return {ok: false, reason: 'no-thread'};
    if (num(state.flux?.[team], 0) + 1e-9 < COCS_SCOUT.spawnCost) return {ok: false, reason: 'flux'};
    const actor = spawnScout(match, state, team, node.id);
    return actor ? {ok: true, reason: null, role, actor: actor.id} : {ok: false, reason: 'refused'};
  }
  if (cocsThreadsUsed(match, state, team) >= cap) return {ok: false, reason: 'no-thread'};
  const def = coopRole(role);
  if (!def) return {ok: false, reason: 'role'};
  if (num(state.flux?.[team], 0) + 1e-9 < num(def.spawnCost, 0)) return {ok: false, reason: 'flux'};
  const actor = cocsRoleSpawn(match, state, team, role, record.target ?? null);
  return actor ? {ok: true, reason: null, role, actor: actor.id} : {ok: false, reason: 'refused'};
}

/**
 * PvP-1 personal-REQ purchase (§6A.5/§6A.7). Mirrors the co-op buy path but reads
 * the PvP command seat instead of `state.coop.commandSeat`, so a commander-only
 * item is gated per team. Deterministic item effects; no RNG.
 */
export function cocsBuyAction(match, state, record = {}) {
  if (!state || state.kind !== COCS_KIND || state.coopMode === true) return {ok: false, reason: 'no-economy'};
  const actor = match?.actors?.[record.actorId];
  if (!actor || actor.health <= 0) return {ok: false, reason: 'missing'};
  const item = reqItem(record.itemId);
  if (!item) return {ok: false, reason: 'unknown-item'};
  if (item.launch !== true) return {ok: false, reason: 'not-launched'};
  const team = actor.team === 1 ? 1 : 0;
  const peerId = String(record.peerId ?? '');
  const isCommander = state?.command?.seat?.[team] === peerId;
  const relayOwned = (state?.nodes ?? []).some(node => node && node.archetype === 'relay' && node.owner === team);
  const result = reqPurchase(record.itemId, {
    balance: num(actor.req, 0),
    isCommander,
    activeBuffId: typeof actor.reqBuff === 'string' ? actor.reqBuff : null,
    relayOwned,
  });
  if (!result.ok) return {ok: false, reason: result.reason ?? 'purchase'};
  actor.req = result.balanceAfter;
  actor.reqSpent = num(actor.reqSpent, 0) + num(result.cost, 0);
  actor.reqBuff = item.id;
  if (item.id === 'field-repair') actor.health = Math.min(num(actor.maxHealth, actor.health), num(actor.health, 0) + 50);
  else if (item.id === 'overshield') actor.temporaryShield = Math.max(num(actor.temporaryShield, 0), 50);
  else if (item.id === 'haste') {
    actor.powerups ??= {};
    actor.powerups.haste = Math.max(num(actor.powerups.haste, 0), 15);
    match?.refreshPowerups?.(actor);
  } else if (item.id === 'ammo-crate' && Array.isArray(actor.ammo)) {
    for (let index = 0; index < actor.ammo.length; index++) {
      if (actor.ammo[index] === Infinity) continue;
      const weaponCap = match?.weaponForIndex?.(actor, index)?.cap;
      if (Number.isFinite(weaponCap) && actor.ammo[index] < weaponCap) actor.ammo[index] = weaponCap;
    }
  }
  match?.emit?.('cocs-buy', {actor: actor.id, team, itemId: item.id, cost: num(result.cost, 0), req: num(actor.req, 0)});
  return {ok: true, reason: null, itemId: item.id, cost: num(result.cost, 0)};
}

/**
 * Section 11.4 per-team visibility. `intel`/`contacts` are computed separately
 * for each team so one shared value can never leak between sides. V1 still emits
 * every actor to every peer, so both teams receive equal values; the shape is
 * what makes the V2 per-peer filter safe to add. Pure and id-sorted.
 */
export function cocsTeamVisibility(match, state, team) {
  const t = team === 0 || team === 1 ? Number(team) : 0;
  const contacts = [];
  for (const actor of match?.actors ?? []) {
    if (!actor || actor.health <= 0) continue;
    if (actor.team !== 0 && actor.team !== 1) continue;
    const own = actor.team === t;
    const spot = state.spots?.[actor.id];
    // Legacy SCAN contacts remain global in V1. Field recon is team-scoped and
    // information-only, while using the same shipped team-marker presentation.
    const spotted = Boolean(spot && (spot.intelOnly !== true || spot.team === t) && num(state.tick, 0) <= num(spot.until, 0));
    const fieldIntel = state.fieldSupport?.intel?.[t]?.[actor.id];
    const revealed = Boolean(fieldIntel && fieldIntel.until > state.tick && !(actor.powerups?.cloak > 0));
    if (!own && !spotted && !revealed) continue;
    contacts.push({
      id: actor.id, team: actor.team, own,
      x: revealed && !own && !spotted ? fieldIntel.x : num(actor.x, 0), z: revealed && !own && !spotted ? fieldIntel.z : num(actor.z, 0),
      spotted, ...(revealed ? {revealed: true} : {}), isSubagent: actor.isSubagent === true,
      role: actor.subagentRole ?? (actor.isScout === true ? 'scout' : null),
    });
  }
  contacts.sort((a, b) => a.id - b.id);
  const nodes = (state?.nodes ?? []).map(node => ({id: node.id, owner: node.owner ?? null, live: node.live === true}));
  const intel = {
    team: t,
    rung: state?.rung ?? null,
    // V1: known == owned or live (public lattice truth), so both teams read the
    // same values. The shape is per-team and ready for the V2 filter.
    knownNodes: nodes.filter(node => node.owner === t || node.live).map(node => node.id),
    enemyNodes: nodes.filter(node => node.owner === (1 - t)).map(node => node.id),
    contacts: contacts.map(entry => entry.id),
    spots: contacts.filter(entry => entry.spotted).map(entry => entry.id),
    flux: num(state?.flux?.[t], 0),
    cutNodes: [...(state?.cuts ?? [])].sort(),
  };
  return {intel, contacts};
}

// Advance the PvP role board one fixed step: retire dead/expired units, pay
// bounties, run the SABOTEUR verb and expire sapper windows. Called by
// `stepCocs` for PvP only; co-op keeps its own squad lifecycle.
export function stepCocsRoles(match, state, dt) {
  if (!match || !state || state.coopMode === true) return state;
  const tick = num(state.tick, 0);
  for (const team of [0, 1]) {
    const list = state.roleSpawns?.[team] ?? [];
    for (let index = list.length - 1; index >= 0; index--) {
      const actor = match.actors?.[list[index]];
      if (!actor || actor.isSubagent !== true || actor.subagentTeam !== team) { list.splice(index, 1); continue; }
      if (actor.health <= 0) { retireCocsRole(match, state, team, actor, 'killed'); list.splice(index, 1); continue; }
      if (tick >= num(actor.subagentExpireTick, Infinity)) { retireCocsRole(match, state, team, actor, 'expire'); list.splice(index, 1); continue; }
      if (actor.subagentRole === 'saboteur' && tick >= num(actor.saboteurReadyAt, 0)) {
        const acted = cocsSaboteurAct(match, state, actor);
        if (acted && acted.ok) actor.saboteurReadyAt = tick + SABOTEUR_INTERVAL_TICKS;
      }
    }
    state.threads[team].used = cocsThreadsUsed(match, state, team);
  }
  for (const nodeId of Object.keys(state.sabotage ?? {}).sort()) {
    const entry = state.sabotage[nodeId];
    if (!entry) continue;
    if (tick >= num(entry.until, 0)) { repairLink(state, nodeId); delete state.sabotage[nodeId]; }
  }
  void dt;
  return state;
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
      addActorReq(actor, REQ_EARN.objectivePresencePerSecond * num(state.reqMult, 1) * dt);
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
  if (!spot || spot.intelOnly === true || spot.team !== source.team) return 1;
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
    // Director wave force fights *for* the point but never captures it: the
    // persistent garrison owns ground, the non-respawning wave is the clear
    // condition. Boss summons carry no wave id but are still Director bodies.
    if (actor.isDirectorWave === true) continue;
    if (match?.objectiveState?.coop && actor.isNpc === true && actor.team === 1) continue;
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
  // Who held the node before this capture: `null` means it was neutral. The
  // HUD needs it to read "node lost" apart from "enemy took a neutral point"
  // (F02), and it is additive on the public capture event.
  const previousOwner = node.owner === 0 || node.owner === 1 ? node.owner : null;
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
  const orderTeam = nodeOrderTeams(state, node)[team];
  const orderTask = state.tasks?.[team] ?? null;
  let orderCompleted = false, orderVerb = null, contributors = [];
  if (orderTeam && orderTask) {
    orderVerb = orderTask.verb ?? null;
    state.tasks[team] = null;
    state.scores[team] = num(state.scores[team], 0) + ORDER_REWARD.teamOP;
    state.orderStats.completed = num(state.orderStats.completed, 0) + 1;
    contributors = participants.slice(0, Math.max(1, ORDER_REWARD.contributorCap));
    for (const actor of contributors) {
      const reward = scoreEvent({kind: 'order', role: 'contributor'});
      addActorReq(actor, reward.req);
      actor.scoreStats.objectivePoints = num(actor.scoreStats.objectivePoints, 0) + reward.personalOP;
      actor.scoreStats.ordersContributed = num(actor.scoreStats.ordersContributed, 0) + 1;
      actor.ordersContributed = num(actor.ordersContributed, 0) + 1;
    }
    orderCompleted = true;
    // §6A.6: the authoritative completion transition resets NEGLECT on the
    // next economy tick (`cocsNeglectContext` drains this flag).
    const neglectSignals = state.neglectEvents?.[team];
    if (neglectSignals) neglectSignals.completed = true;
    match?.emit?.('cocs-order-complete', {team, node: node.id, label: node.label, verb: orderVerb, peerId: orderTask.peerId ?? null, cardId: orderTask.cardId ?? null, contributors: contributors.map(actor => actor.id), teamOP: ORDER_REWARD.teamOP});
  }
  if (node.archetype === 'array') state.arrayWinner = team;
  // The objective beat carries everything the presentation needs to celebrate
  // (or mourn) it without re-deriving rewards from the snapshot: the authored
  // label, the exact OP/REQ paid to participants and whether a live order paid.
  match?.emit?.('cocs-capture', {
    node: node.id, label: node.label, team, archetype: node.archetype, score: state.scores[team],
    previousOwner,
    reward: {op: COCS_CAPTURE_POINTS[node.archetype] ?? 0, req: capture.req, personalOP: capture.personalOP},
    participants: participants.map(actor => actor.id),
    orderCompleted, orderVerb, teamOP: orderCompleted ? ORDER_REWARD.teamOP : 0,
  });
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
  // OPERATIONS FORTIFY and a field ward resist enemy capture. Take the stronger
  // effect; duplicate engineers cannot multiply the defensive budget.
  const resist = clamp01(Math.max(num(node.captureResist, 0), latticeCaptureResist(state, node, team)));
  // O1c terminal HACK (§4.3) and HARVESTER PRIME (§4.8/§8.1): both are
  // co-op-only node windows created by `cocs-terminals.mjs`/`cocs-coop.mjs`.
  // PvPvE never sets `node.hack`/`node.prime`, so this multiplies by 1 there.
  const hack = node.hack && node.hack.team === team && num(state.tick, 0) <= num(node.hack.until, 0)
    ? Math.max(1, num(node.hack.multiplier, 1)) : 1;
  const prime = node.prime && node.prime.team === team && num(state.tick, 0) <= num(node.prime.captureUntil, 0)
    ? Math.max(1, num(node.prime.captureMultiplier, 1)) : 1;
  // Preserve existing HACK/PRIME tuning; a field kit takes the max rather than
  // multiplying that budget or stacking with other contributors.
  const field = latticeCaptureRate(match, actors[team]);
  node.progress[team] = clamp01(num(node.progress[team], 0) + rate * (1 - resist) * Math.max(hack * prime, field));
  if (node.progress[team] >= 1 - EPSILON) captureNode(match, state, node, team, actors[team]);
}

// Capturable-node ownership tally. Shared by the dominance ratchet and the
// public snapshot view so both always agree on "how close" each team is.
function capturableCounts(state) {
  const counts = {0: 0, 1: 0};
  for (const node of capturableNodes(state)) if (node.owner === 0 || node.owner === 1) counts[node.owner]++;
  return counts;
}

function updateDominance(state, dt) {
  const counts = capturableCounts(state);
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
// F03 public outcome progress. A pure projection of authoritative state that
// both teams (and spectators) read through the same snapshot. The HUD never
// reconstructs a timer from client elapsed time; `remaining` is the sim's
// `target - progress`, `counts` answers "how close", and `breakCount` is how
// many capturable nodes the other side must take to drop the holder below the
// outright majority and reset the ratchet. Absent state reads neutral.
// ---------------------------------------------------------------------------
export function cocsDominanceView(state) {
  const dominance = state?.dominance;
  const counts = capturableCounts(state);
  const team = dominance?.team === 0 || dominance?.team === 1 ? Number(dominance.team) : null;
  const target = Math.max(0, num(dominance?.target, 0));
  const progress = Math.max(0, num(dominance?.progress, 0));
  const count = Math.max(0, Math.round(num(state?.dominanceCount, 0)));
  const fastCount = Math.max(count, Math.round(num(state?.dominanceFastCount, 0)));
  return {
    team,
    progress,
    target,
    remaining: Math.max(0, target - progress),
    fast: dominance?.fast === true,
    count,
    fastCount,
    counts,
    breakCount: team === null || count <= 0 ? 0 : Math.max(0, counts[team] - count + 1),
    hold: Math.max(0, num(state?.dominanceHold, 0)),
    fastHold: Math.max(0, num(state?.dominanceFast, 0)),
  };
}

// Mode-aware wrapper over the same public facts: PvP is the dominance race
// (`snapshot.cocs.dominance`); OPERATIONS publishes its wave clear and HQ
// integrity (the Director's dominance, when armed, is a loss condition already
// surfaced by the siege state). Additive and null-safe.
export function cocsOutcomeSnapshot(state) {
  if (!state || state.kind !== COCS_KIND) return null;
  const coop = state.coop;
  if (!coop) return {mode: 'pvp', waves: null, hq: null};
  const siege = coop.siege ?? {};
  const max = Math.max(0, num(siege.max, 0));
  const health = Math.max(0, num(siege.health, 0));
  return {
    mode: 'operations',
    waves: {cleared: Math.max(0, Math.round(num(coop.wavesCleared, 0))), total: Math.max(0, Math.round(num(coop.waveCount, 0)))},
    hq: {
      id: siege.hqId ?? null,
      health: Math.round(health),
      max: Math.round(max),
      percent: max > 0 ? Math.round(clamp01(health / max) * 1000) / 1000 : 0,
      armed: siege.armed === true,
    },
  };
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
    spots.push({id, team: spot.team, until: num(spot.until, 0), x: num(spot.x, 0), z: num(spot.z, 0), by: spot.by ?? null, ...(spot.intelOnly === true ? {intelOnly: true} : {})});
  }
  const req = (match?.actors ?? [])
    .filter(actor => actor && (actor.team === 0 || actor.team === 1))
    .sort((a, b) => a.id - b.id)
    .map(actor => ({id: actor.id, req: num(actor.req, 0), earned: num(actor.reqEarned, 0), spent: num(actor.reqSpent, 0)}));
  return {
    // Sim tick. `spots[].until` is a tick, so presentation subtracts this to
    // age the SPOT window without reaching into the live state.
    tick: num(state.tick, 0),
    fieldSupport: latticeSupportSnapshot(state),
    squadBoard: cocsSquadSnapshot(match, state),
    commandResults: (state.commandResults ?? []).slice(-32).map(entry => ({...entry})),
    nodes: state.nodes.map(node => ({
      id: node.id,
      x: node.x,
      z: node.z,
      archetype: node.archetype,
      ...(node.label ? {label: node.label} : {}),
      owner: node.owner ?? null,
      progress: [num(node.progress?.[0], 0), num(node.progress?.[1], 0)],
      contested: node.contested === true,
      live: node.live === true,
      // O1c terminal windows (co-op only; omitted in PvPvE so its snapshot
      // stays byte-identical).
      ...(node.hack ? {hack: {team: node.hack.team ?? null, until: num(node.hack.until, 0), multiplier: num(node.hack.multiplier, 1)}} : {}),
      ...(state.coop ? {
        y: num(node.y, 0), r: num(node.r, 4),
        ...(node.archetype === 'economy' ? {primeReach: Math.max(num(node.r, 4), COOP_PRIME_REACH)} : {}),
        primeChannel: node.primeChannel ? {actor: node.primeChannel.actor, remaining: num(node.primeChannel.remaining, 0), total: num(node.primeChannel.total, 0)} : null,
        oracle: node.oracle ? {team: node.oracle.team, active: node.oracle.active === true, targets: [...(node.oracle.targets ?? [])]} : null,
      } : {}),
      ...(node.prime ? {prime: {team: node.prime.team ?? null, until: num(node.prime.until, 0), fluxBonus: num(node.prime.fluxBonus, 0), captureUntil: num(node.prime.captureUntil, 0), captureMultiplier: num(node.prime.captureMultiplier, 1)}} : {}),
    })),
    scores: {0: num(state.scores?.[0], 0), 1: num(state.scores?.[1], 0)},
    liveNodeIds: [...(state.liveNodeIds ?? [])],
    winner: state.winner ?? null,
    // --- F03 public outcome progress (additive) -----------------------------
    // The authoritative dominance race / operations mission state. Both teams
    // and spectators read the same numbers; nothing here is reconstructed from
    // client elapsed time. A snapshot without these keys reads neutral.
    dominance: cocsDominanceView(state),
    outcome: cocsOutcomeSnapshot(state),
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
    // --- PvP-1 rung / two-team command / per-team visibility (§11.4) --------
    // Per-team `intel`/`contacts` are computed separately (so one shared value
    // can never leak between sides), though V1 still emits equal values to both
    // teams. Co-op keeps its own director/roles surface and adds none of these.
    ...(state.coop ? {} : (() => {
      const visibility0 = cocsTeamVisibility(match, state, 0);
      const visibility1 = cocsTeamVisibility(match, state, 1);
      return {
        rung: state.rung ?? null,
        intel: {0: visibility0.intel, 1: visibility1.intel},
        contacts: {0: visibility0.contacts, 1: visibility1.contacts},
        roleBoard: {0: cocsRoleBoardSnapshot(match, state, 0), 1: cocsRoleBoardSnapshot(match, state, 1)},
        // PvP-1 two-team command seat (§5.7/§11.3). The peer-id seat, live vote
        // tally, route and policy ride the frozen snapshot so a reconnect resyncs
        // the whole board. Pure numbers/strings, id-keyed by team.
        commander: {
          seat: {0: state.command?.seat?.[0] ?? null, 1: state.command?.seat?.[1] ?? null},
          votes: {0: Object.keys(state.command?.votes?.[0] ?? {}).filter(key => state.command.votes[0][key] === true).length,
                  1: Object.keys(state.command?.votes?.[1] ?? {}).filter(key => state.command.votes[1][key] === true).length},
          route: {0: state.command?.route?.[0] ?? null, 1: state.command?.route?.[1] ?? null},
          policy: {0: state.command?.policy?.[0] ?? null, 1: state.command?.policy?.[1] ?? null},
        },
        sabotage: Object.keys(state.sabotage ?? {}).sort().map(nodeId => ({nodeId, ...state.sabotage[nodeId]})),
      };
    })()),
    // --- O1c terminals (co-op only; absent in PvPvE) ------------------------
    // The UI reads the flat `terminals` array from `cocsCoopSnapshot`; the raw
    // id-keyed tree stays available as `terminalState` (vault + stats included).
    ...(state.terminals ? {terminalState: cocsTerminalsSnapshot(state)} : {}),
    // --- OPERATIONS (`cocs-coop`) director surface --------------------------
    ...(state.coop ? cocsCoopSnapshot(match, state) : {}),
  };
}

// ---------------------------------------------------------------------------
// Human interact edge. Called by `Match.step` once per actor on the rising edge
// of `controls.interact`, before the movement/vehicle branch. Devices win over
// terminals (they occupy different ground); both helpers are deterministic and
// bot-free. Returns the applied record or null when the edge hit nothing.
// ---------------------------------------------------------------------------
export function cocsHumanInteract(match, state, actorId) {
  if (!state || state.kind !== COCS_KIND) return null;
  const actor = (match?.actors ?? []).find(entry => entry?.id === actorId);
  if (!actor || actor.bot) return null;
  const device = humanDeviceInteract(match, state, actor);
  if (device) return {source: 'device', ...device};
  const terminal = humanTerminalInteract(match, state, actor);
  if (terminal) return {source: 'terminal', ...terminal};
  if (state.coop) {
    const nodes = state.nodes.filter(node => node.archetype === 'economy' && node.owner === actor.team)
      .sort((a, b) => Math.hypot(actor.x - a.x, actor.z - a.z) - Math.hypot(actor.x - b.x, actor.z - b.z) || String(a.id).localeCompare(String(b.id)));
    for (const node of nodes) if (coopPrimeNode(match, state, actor, node.id).ok) return {source: 'node', nodeId: node.id, kind: 'PRIME', action: 'prime'};
  }
  return null;
}

// ---------------------------------------------------------------------------
// §6A.6 NEGLECT order/command context. The anti-grief meter only ever moves
// for a team with a human commander: a seated peer, or — when the seat is
// empty (local practice has no wire identity) — living humans on the team.
// Order contribution is read from the authoritative order state: an active
// task keeps the meter ticking, a completion recorded by `captureNode` is the
// contribution that resets it, and a task whose `until` passed without
// completing expires. A task replaced by a new order is not a cancel: the duty
// Chief re-issues continuously, and only an explicit future cancel verb would
// set `neglectEvents[t].cancelled`. OPERATIONS keeps NEGLECT inert exactly as
// before (`coopMode` => all false). Pure: reads `state.tick`/`tasks`/
// `command`/`neglectEvents` and the roster, nothing else.
// ---------------------------------------------------------------------------
export function cocsNeglectContext(match, state, team) {
  const t = team === 1 ? 1 : 0;
  if (!state || state.kind !== COCS_KIND || state.coopMode === true) {
    return {humanCommander: false, activeOrder: false, contributed: false, completed: false, expired: false, cancelled: false};
  }
  const now = num(state.tick, 0);
  const task = state.tasks?.[t] ?? null;
  const events = state.neglectEvents?.[t] ?? null;
  const completed = events?.completed === true;
  const cancelled = events?.cancelled === true;
  if (events) { events.completed = false; events.cancelled = false; }
  const activeOrder = Boolean(task && now <= num(task.until, 0));
  const expired = Boolean(task && now > num(task.until, 0) && !completed);
  const seat = state.command?.seat?.[t];
  const seated = seat !== null && seat !== undefined && String(seat) !== '';
  let humans = false;
  if (!seated) {
    for (const actor of match?.actors ?? []) {
      if (!actor || actor.health <= 0 || actor.team !== t) continue;
      if (actor.bot || actor.isNpc === true || actor.isSubagent === true || actor.isScout === true) continue;
      humans = true;
      break;
    }
  }
  return {humanCommander: seated || humans, activeOrder, contributed: completed, completed, expired, cancelled};
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
    // In OPERATIONS the Operations Director is team 1's commander: the duty
    // Chief only issues team-0 orders, so an order-presence capture can never
    // hand the Director ground it is not physically holding.
    if (Array.isArray(produced)) for (const order of produced) if (order && !(state.coop && order.team === 1)) pending.push(order);
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

  // Physical presence and contest are current before field support executes.
  stepLatticeSupport(match, state, dt, {connectedToHq});

  // 4. Connectivity income and the objective score-at-time.
  const {income} = connectivityIncome(state);
  state.income = income;
  for (const team of [0, 1]) state.scores[team] = num(state.scores[team], 0) + income[team] * dt;

  // 4a. §6A.5 objective presence `REQ` (personal).
  accruePresenceReq(match, state, dt);

  // 4b. §6.5 team `FLUX`: passive + connected-node income, then the §6.5
  //     supply-load upkeep of every active subagent. `NEGLECT` only ever scales
  //     the passive term and is inert without a human commander; the order
  //     state supplies the active/contributed/completed/expired signal.
  for (const team of [0, 1]) {
    const neglect = neglectTick(state.neglect?.[team] ?? neglectState(), dt, cocsNeglectContext(match, state, team));
    state.neglect[team] = neglect;
    const passive = neglectPassiveFlux(num(state.fluxPassive, FLUX_PASSIVE_PER_SECOND), neglect);
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
    // PvP-1 role units ride the same §6.5 supply-load model, slot-priced in
    // id order, so the 4th–6th thread is genuinely expensive. Empty in co-op.
    const roleActors = state.coopMode === true ? [] : cocsRoleActors(match, state, team);
    let roleUpkeep = 0;
    for (let slot = 0; slot < roleActors.length; slot++) {
      const perSecond = subagentUpkeep(roleActors[slot].subagentRole, slot + 1, {hops: 0, foundries: 0});
      roleActors[slot].subagentUpkeep = perSecond;
      roleUpkeep += perSecond;
    }
    state.fluxUpkeep[team] = upkeep + roleUpkeep;
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
    for (const actor of roleActors) {
      const drain = num(actor.subagentUpkeep, 0) * dt;
      if (num(state.flux[team], 0) >= drain) {
        state.flux[team] = num(state.flux[team], 0) - drain;
        actor.subagentIdle = false;
      } else {
        state.flux[team] = 0;
        actor.subagentIdle = true;
      }
    }
  }

  // 4c. §8 SCOUT lifecycle: arrive -> scan -> return -> retire, plus expiry.
  for (const team of [0, 1]) stepScoutTeam(match, state, team, dt);

  // 4c-bis. PvP-1 role board: the duty Chief for each team spawns from its own
  //     rung allow-list, then the role lifecycle runs the SABOTEUR verb and
  //     expires sapper windows. Co-op is untouched (`state.rung` is null).
  cocsDutyRolePolicy(match, state, {tick: now, time: match.time, dt});
  stepCocsRoles(match, state, dt);

  // 4d. Expire `SPOT` marks on the fixed tick clock.
  for (const key of Object.keys(state.spots ?? {})) {
    const spot = state.spots[key];
    if (!spot || num(state.tick, 0) > num(spot.until, 0)) delete state.spots[key];
  }

  // 4e. §6A traversal layer: neutral device cut/lock/repair state, the 2.5 s
  //     shared cooldown, arrival protection and depot capture/loaners. All on
  //     the same fixed tick as every other cocs timer, with no RNG draw.
  stepCocsTraversal(match, state, dt);

  // 4e-bis. O1c terminals (HACK/DEPLOY/VAULT/SABOTAGE) + the HARVESTER prime.
  //     Co-op only; `state.terminals` is null in PvPvE so this is a no-op.
  if (state.terminals) stepCocsTerminals(match, state, dt);

  // 4f. OPERATIONS Director (co-op only): PRESSURE budget, pacing machine,
  //     scripted escalations, wave force spawning and the HQ siege. Non-coop
  //     `cocs` never enters this branch, so V0a/V0b behaviour is untouched.
  if (state.coop) stepCoop(match, state, dt);

  // 5. Dominance, front and the team-score mirror (HUD / Match.leaders).
  updateDominance(state, dt);
  state.front = frontState(state);
  match.teamScores[0] = state.scores[0];
  match.teamScores[1] = state.scores[1];

  // 6. Resolve once.
  const outcome = state.coop ? coopOutcome(match, state) : cocsOutcome(match);
  if (outcome) {
    state.winner = outcome.winner;
    state.winReason = outcome.reason;
    if (outcome.winner === 0 || outcome.winner === 1) match.emit('objective-win', {team: outcome.winner, score: state.scores[outcome.winner], reason: outcome.reason});
    match.endMatch(outcome.reason);
  }
  return state;
}

/**
 * Reconcile the objective result once the match has ended. The mode layer can
 * end a cocs match without `cocsOutcome` ever returning (a sudden-death window
 * broken by the score, a forfeit, a director path), which used to leave
 * `cocs.winner` null behind a decided scoreboard. Called by `Match.endMatch`;
 * pure, idempotent, and a no-op for a match with an already-decided winner or
 * a genuinely tied scoreboard.
 */
export function finalizeCocsResult(match) {
  const state = match?.objectiveState;
  if (!state || state.kind !== COCS_KIND) return state ?? null;
  if (state.winner === 0 || state.winner === 1) return state;
  const scores = state.scores ?? {0: 0, 1: 0};
  let winner = null;
  if (num(scores[0], 0) !== num(scores[1], 0)) winner = num(scores[0], 0) > num(scores[1], 0) ? 0 : 1;
  else {
    const owned = {0: 0, 1: 0};
    for (const node of capturableNodes(state)) if (node.owner === 0 || node.owner === 1) owned[node.owner]++;
    if (owned[0] !== owned[1]) winner = owned[0] > owned[1] ? 0 : 1;
  }
  if (winner === null) return state;
  state.winner = winner;
  state.tiebreak = state.tiebreak ?? (match.overReason === 'sudden-death' ? 'sudden-death' : 'time');
  state.winReason = state.winReason ?? match.overReason ?? 'time';
  match.emit?.('objective-tiebreak', {mode: 'cocs', team: winner, reason: state.tiebreak});
  return state;
}
