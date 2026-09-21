// Read-only coaching: advice and the topology diagram come from the same map
// and authoritative snapshot as the match. This never issues orders or spends.
//
// F04: one shared legal-target model. `latticeTargetModel` is the single place
// that answers "what may this operator legally take next?" — adjacency comes
// from the authoritative snapshot/graph (never straight-line distance), while
// reachability and route cost come from the arena's authored navigation graph.
// The coach, the SCAN/GO/ATTACK strip
// (`cocs-orders.mjs`) and the local command board (`lattice-board.mjs`) all read
// the same model so they can never disagree about a legal target.
import {DEFAULT_BINDINGS, bindingLabel} from './keybinds.mjs';
import {spawnRouteContext} from './spawn-placement.mjs';
import {COCS_ENDGAME_FRACTION} from './cocs.mjs';
import {navigation as buildNavigation} from './core.mjs';

export const isLattice = mode => mode === 'cocs' || mode === 'cocs-coop';
// Quick-start must fill a real front rather than inherit a three-player FFA.
// Custom match setup still owns its explicit roster and time settings.
export const latticePracticeDefaults = mode => mode === 'cocs'
  ? {botCount: 7, timeLimit: 900, difficulty: 'normal', rung: '4v4'}
  : mode === 'cocs-coop' ? {botCount: 3, timeLimit: 900, difficulty: 'normal'} : {};
export function latticeKeys(bindings = {}) {
  const label = action => bindingLabel(bindings[action] ?? DEFAULT_BINDINGS[action]).toUpperCase();
  return Object.fromEntries(['interact', 'mobility', 'power', 'command', 'commandScan', 'commandGo', 'commandAttack', 'commandRoute'].map(action => [action, label(action)]));
}

export function latticeBriefing(mode, bindings = {}) {
  if (!isLattice(mode)) return null;
  const keys = latticeKeys(bindings), coop = mode === 'cocs-coop';
  return {
    title: coop ? 'OPERATIONS / FIELD GUIDE' : 'LATTICE STRIKE / FIELD GUIDE',
    objective: coop
      ? 'Clear five Director waves before time runs out. Keep your HQ alive and your supply line connected.'
      : 'Capture connected ground and hold a majority to win by dominance. At the time limit, objective score decides the match.',
    steps: [
      {title: '01 / TAKE YOUR FRONT', detail: 'Follow the link from your HQ to the front gate. Stand inside its capture ring and clear enemies. Capture is automatic; no interaction key is needed.'},
      {title: '02 / BUILD A SUPPLY LINE', detail: 'Only nodes adjacent to one your team owns can be taken. Push the relay or a side siphon, then defend the link home. Connected nodes earn team FLUX; a cut-off node stops paying.'},
      {title: '03 / SUPPORT THE PUSH', detail: `${keys.commandScan} SCAN, ${keys.commandGo} GO/HOLD, ${keys.commandAttack} ATTACK or ${keys.commandRoute} ROUTE → number key for a target → ENTER to issue. SCAN spends team FLUX. Hold ${keys.command} for the command board; release to return to the fight.`},
      {title: '04 / USE THE ROUTES', detail: `At a device anchor, press ${keys.interact} when the prompt says RIDE. Away from the anchor the same key can CUT/LOCK the route; on a broken route it REPAIRS. Depots capture by standing nearby; ${keys.interact} enters the loaner vehicle.`},
      ...(coop ? [{title: '05 / SURVIVE THE DIRECTOR', detail: `Between waves, spend FLUX on fortify, repair, resupply or reinforce. At a terminal, ${keys.interact} starts the displayed HACK, DEPLOY or VAULT action. Watch the HQ alarm and fall back before a siege breaks through.`}] : []),
    ],
    movement: `Every loadout has a ground route. ${keys.mobility} uses your operator’s mobility verb; grapple users aim at a higher solid surface and hold the key to reel upward, then release. ${keys.power} activates your harness ability.`,
    legend: [
      {mark: '⌂', name: 'HQ', detail: 'Home, supply origin and Operations siege target.'},
      {mark: '▲', name: 'FRONT', detail: 'Your first capture and the link into the battlefield.'},
      {mark: '⬢', name: 'RELAY', detail: 'Central junction: short rotations, exposed approaches.'},
      {mark: '◆', name: 'SIPHON', detail: 'Side objective: income and an alternative front.'},
      {mark: '⇢', name: 'ROUTE', detail: 'Device anchor; read RIDE / CUT / REPAIR before pressing.'},
      {mark: '▣', name: 'DEPOT', detail: 'Hold the apron to capture, then collect a loaner.'},
    ],
  };
}

const fallbackLabels = {'hq-0': 'WEST HQ', 'hq-1': 'EAST HQ', 'front-0': 'WEST FRONT', 'front-1': 'EAST FRONT', 'relay-0': 'FOUNDRY RELAY', 'econ-n': 'NORTH SIPHON', 'econ-s': 'SOUTH SIPHON'};
// User-facing node copy: authored label first, then any snapshot label, then a
// known authored-map name, then a readable form of the id (never a raw token
// like `front-0` when a label exists anywhere in reach).
export function latticeNodeLabel(node, map) {
  const authored = map?.nodes?.find(entry => entry.id === node?.id);
  const label = authored?.label ?? node?.label ?? fallbackLabels[node?.id];
  if (label) return String(label);
  if (node?.id === null || node?.id === undefined) return 'NODE';
  return String(node.id).replace(/[-_]+/g, ' ').toUpperCase();
}

// ---------------------------------------------------------------------------
// Shared legal-target model (F04).
// ---------------------------------------------------------------------------
export const LATTICE_CAPTURABLE_ARCHETYPES = Object.freeze(['front', 'economy', 'relay']);
export const LATTICE_NODE_MARKS = Object.freeze({hq: '⌂', front: '▲', relay: '⬢', economy: '◆', array: '⬣'});
export const latticeArchetypeMark = archetype => LATTICE_NODE_MARKS[String(archetype ?? '')] ?? '●';
// A candidate at or above this priority is an urgent event: it supersedes held
// advice. Everything below it must not make the coach oscillate on small
// positional changes.
export const LATTICE_URGENT_PRIORITY = 50;
export const LATTICE_SHORTLIST_LIMIT = 3;

const num = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const clamp01 = value => Math.max(0, Math.min(1, num(value, 0)));
const idOf = value => (value === null || value === undefined ? null : String(value));
const capturableArchetype = archetype => LATTICE_CAPTURABLE_ARCHETYPES.includes(String(archetype ?? ''));

function normalizeLatticeEdges(source, ids) {
  const seen = new Set(), edges = [];
  for (const raw of Array.isArray(source) ? source : []) {
    if (!raw) continue;
    const a = idOf(Array.isArray(raw) ? raw[0] : raw.a);
    const b = idOf(Array.isArray(raw) ? raw[1] : raw.b);
    if (a === null || b === null || a === b || !ids.has(a) || !ids.has(b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  return edges;
}

// Mirrors `chainEdges` in `game/cocs.mjs`: a deterministic fallback for an
// authored node list with no edges. This is topology only; it never claims to
// be a walking path.
function chainLatticeEdges(nodes) {
  const ordered = [...nodes].sort((a, b) => num(a.x, 0) - num(b.x, 0) || num(a.z, 0) - num(b.z, 0) || String(a.id).localeCompare(String(b.id)));
  const edges = [];
  for (let i = 1; i < ordered.length; i++) edges.push([ordered[i - 1].id, ordered[i].id]);
  return edges;
}

function adjacencyFromEdges(edges) {
  const adjacency = {};
  for (const [a, b] of edges) {
    (adjacency[a] ??= []).push(b);
    (adjacency[b] ??= []).push(a);
  }
  for (const key of Object.keys(adjacency)) adjacency[key] = [...new Set(adjacency[key])];
  return adjacency;
}

// Accepts the id-keyed adjacency map the sim keeps (`state.adjacency`) in any
// plain-object or Map shape. An authoritative adjacency map always wins over
// re-derived edges.
function adjacencyFromObject(source) {
  if (!source || typeof source !== 'object') return null;
  const adjacency = {};
  const entries = source instanceof Map ? [...source.entries()] : Object.entries(source);
  let seen = false;
  for (const [key, value] of entries) {
    const id = idOf(key);
    if (id === null) continue;
    const list = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
    const ids = list.map(idOf).filter(entry => entry !== null && entry !== id);
    if (ids.length) seen = true;
    adjacency[id] = [...new Set(ids)];
  }
  return seen ? adjacency : null;
}

/**
 * Build the shared lattice graph from the authoritative snapshot and the
 * authored map. Snapshot nodes are authoritative for ownership/live state; the
 * map supplies authored labels, radii and edges. Returns null when neither
 * source has nodes.
 */
export function latticeGraph(snapshot, map, options = {}) {
  const snap = snapshot?.cocs && typeof snapshot.cocs === 'object' ? snapshot.cocs : snapshot;
  const authoredList = (Array.isArray(map?.nodes) ? map.nodes : []).filter(Boolean);
  const authored = new Map(authoredList.map(node => [String(node.id), node]));
  const raw = Array.isArray(snap?.nodes) && snap.nodes.length ? snap.nodes : authoredList;
  if (!raw.length) return null;
  const nodes = [];
  const byId = new Map();
  for (const node of raw) {
    if (!node) continue;
    const id = String(node.id);
    if (byId.has(id)) continue;
    const merged = {...(authored.get(id) ?? {}), ...node, id, label: latticeNodeLabel({...authored.get(id), ...node, id}, map)};
    byId.set(id, merged);
    nodes.push(merged);
  }
  for (const node of authoredList) {
    const id = String(node.id);
    if (byId.has(id)) continue;
    const merged = {...node, id, label: latticeNodeLabel(node, map)};
    byId.set(id, merged);
    nodes.push(merged);
  }
  const ids = new Set(nodes.map(node => node.id));
  const explicit = options.adjacency ?? snap?.adjacency ?? null;
  let adjacency = adjacencyFromObject(explicit);
  let edges = null;
  let source = adjacency ? 'authoritative' : null;
  if (!adjacency) {
    const candidates = [options.edges, snap?.edges, map?.lattice?.edges, map?.lattice, map?.edges];
    for (const candidate of candidates) {
      edges = normalizeLatticeEdges(candidate, ids);
      if (edges.length) { source = 'map'; break; }
    }
    if (!edges?.length && ids.size > 1) { edges = chainLatticeEdges(nodes); source = 'chain'; }
    adjacency = adjacencyFromEdges(edges ?? []);
  } else if (!edges) {
    const pairs = [];
    for (const node of nodes) for (const next of adjacency[node.id] ?? []) if (node.id < next) pairs.push([node.id, next]);
    edges = pairs;
  }
  return {nodes, byId, adjacency, edges, source, bounds: map?.bounds ?? options.bounds ?? null};
}

// The owned nodes that still trace a supply line back to an owned HQ. Mirrors
// `connectedToHq` in `game/cocs.mjs`: a cut node breaks the chain behind it.
function ownedSupplyNodes(graph, team, cuts) {
  const owned = new Set(graph.nodes.filter(node => node.owner === team).map(node => node.id));
  const seen = new Set();
  const queue = [];
  for (const node of graph.nodes) {
    if (node.archetype === 'hq' && node.owner === team && !cuts.has(node.id)) { seen.add(node.id); queue.push(node.id); }
  }
  while (queue.length) {
    const id = queue.shift();
    for (const next of graph.adjacency[id] ?? []) {
      if (seen.has(next) || cuts.has(next) || !owned.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

// `spawnRouteContext` is the existing gameplay path-distance resolver. Maps are
// deep-frozen, so the built navigation graph and its bounded source caches live
// beside them in WeakMaps rather than being attached to map data during a
// render. `navigation()` is the same deterministic builder `Match` uses, so the
// authored production shape (`map.navNodes`) resolves real walkability instead
// of straight-line distance — and it is built at most once per map object.
const navigationGraphs = new WeakMap();
const navigationCaches = new WeakMap();

function mapNavigationGraph(map) {
  if (!map || typeof map !== 'object' || !Array.isArray(map.navNodes) || !map.navNodes.length) return null;
  let graph = navigationGraphs.get(map);
  if (!graph) {
    graph = buildNavigation(map);
    navigationGraphs.set(map, graph);
  }
  return graph;
}

// Route context precedence: an explicit `{nav, navEdges}` pair (the live Match
// navigation graph the page already built), the legacy `map.nav`/`map.edges`
// spelling, then the authored production shape (`map.navNodes`) through the
// real nav builder. Returns null when the player has no finite position or no
// graph. `navEdges` is deliberately distinct from the topology `edges` option.
function navigationRoute(map, player, options = {}) {
  if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.z)) return null;
  let source = null, nav = null, edges = null;
  if (Array.isArray(options.nav) && options.nav.length && Array.isArray(options.navEdges)) {
    source = options.nav; nav = options.nav; edges = options.navEdges;
  } else if (Array.isArray(map?.nav) && map.nav.length && Array.isArray(map.edges)) {
    source = map; nav = map.nav; edges = map.edges;
  } else {
    const graph = mapNavigationGraph(map);
    if (!graph?.nodes?.length || !Array.isArray(graph.edges)) return null;
    source = map; nav = graph.nodes; edges = graph.edges;
  }
  let cache = navigationCaches.get(source);
  if (!cache) { cache = new Map(); navigationCaches.set(source, cache); }
  return spawnRouteContext({nav, edges, _spawnRouteCache: cache}, player);
}

// Authority phase parity: `capturableBy` opens ARRAY anchors only while
// `state.endgame` is true. The sim derives that from the published clock
// fraction (`cocsPhase`) unless a test sets `forceEndgame`, so the view resolves
// the same inputs: an explicit option (local match state / tests), a snapshot
// field if one is published, then the clock fraction. Purely a read of the
// snapshot; never a sim decision.
export function latticeEndgameActive(snapshot, options = {}) {
  if (options.endgame === true) return true;
  const snap = snapshot?.cocs && typeof snapshot.cocs === 'object' ? snapshot.cocs : snapshot;
  if (snap?.endgame === true) return true;
  const limit = Number(snapshot?.config?.timeLimit);
  const time = Number(snapshot?.time);
  return limit > 0 && Number.isFinite(time) && time / limit >= COCS_ENDGAME_FRACTION;
}

function latticePriority(node, siegeActive) {
  if (siegeActive) return node.siegeDefence ? 100 : node.attackable ? 10 : node.mine ? 35 : 5;
  if (node.mine && node.contested) return 70 + Math.round(node.enemyProgress * 20);
  if (node.mine && node.enemyProgress > 0.02) return 48 + Math.round(node.enemyProgress * 15);
  if (node.attackable && node.contested) return 55;
  if (node.attackable && node.myProgress >= 0.34) return 52 + Math.round(node.myProgress * 5);
  if (node.attackable) {
    const archetype = node.archetype === 'front' ? 6 : node.archetype === 'relay' ? 5 : 4;
    return (node.connected ? 30 : 12) + archetype + Math.round(node.myProgress * 10);
  }
  if (node.mine) return node.connected ? 16 : 8;
  return 4;
}

/**
 * The one legal-target model. Every consumer (coach, strip, board) reads the
 * same node list, so adjacency, reachability and siege overrides can never
 * disagree between surfaces.
 *
 * Options: `{graph, adjacency, edges, cuts, endgame, route, nav, navEdges,
 * siege}`. `route` is either `{travel(point) -> number|null}` (the real
 * navigation route context, e.g. `spawnRouteContext`) or a plain function;
 * `nav`/`navEdges` are the live Match navigation graph when the caller already
 * has it. `cuts` is the team-visible supply-cut list; PvP snapshots also
 * publish it on `intel[team].cutNodes` and the model consumes both.
 */
export function latticeTargetModel(snapshot, map, player, options = {}) {
  const snap = snapshot?.cocs && typeof snapshot.cocs === 'object' ? snapshot.cocs : snapshot;
  if (!snap || typeof snap !== 'object') return null;
  const graph = options.graph ?? latticeGraph(snap, map, options);
  if (!graph || !graph.nodes.length) return null;
  const team = player?.team === 0 || player?.team === 1 ? Number(player.team) : null;
  const endgame = latticeEndgameActive(snapshot, options);
  // Per-team supply cuts are authoritative state: PvP snapshots publish them on
  // `intel[team].cutNodes` (game/cocs.mjs §11.4), and local/co-op callers may
  // hand the live sim list in `options.cuts`. Cuts change LINKED/CUT OFF supply
  // and ranking only — never capture legality.
  const intelCuts = team === null ? null : snap.intel?.[team]?.cutNodes;
  const cuts = new Set([
    ...(Array.isArray(options.cuts) ? options.cuts : []),
    ...(Array.isArray(intelCuts) ? intelCuts : []),
  ].map(String));
  const connected = team === null ? new Set() : ownedSupplyNodes(graph, team, cuts);
  const siegeRaw = snap.director?.siege && typeof snap.director.siege === 'object' ? snap.director.siege : null;
  const siegeNode = siegeRaw
    ? graph.byId.get(String(siegeRaw.hqId ?? '')) ?? graph.nodes.find(node => node.archetype === 'hq' && (team === null || node.owner === team)) ?? null
    : null;
  const siegeActive = Boolean(siegeRaw && siegeRaw.armed === true && num(siegeRaw.health, 0) > 0);
  const siege = siegeActive && siegeNode ? {
    active: true,
    nodeId: siegeNode.id,
    label: siegeNode.label,
    health: num(siegeRaw.health, 0),
    max: num(siegeRaw.max, 1),
    percent: Math.round(clamp01(num(siegeRaw.percent, num(siegeRaw.max, 1) > 0 ? num(siegeRaw.health, 0) / num(siegeRaw.max, 1) : 0)) * 100),
    attackers: num(siegeRaw.attackers, 0),
    defenders: num(siegeRaw.defenders, 0),
  } : null;
  const route = typeof options.route === 'function' || typeof options.route?.travel === 'function'
    ? options.route : navigationRoute(map, player, options);
  const routeFn = typeof route === 'function' ? route
    : route && typeof route.travel === 'function' ? point => route.travel(point) : null;
  const nodes = graph.nodes.map(raw => {
    const owner = raw.owner === 0 || raw.owner === 1 ? Number(raw.owner) : null;
    const archetype = String(raw.archetype ?? 'front');
    const capturable = capturableArchetype(archetype);
    const arrayAnchor = archetype === 'array';
    const arrayOpen = arrayAnchor && endgame;
    const mine = team !== null && owner === team;
    const enemy = team !== null && owner !== null && owner !== team;
    const live = raw.live === true || (capturable && owner !== null);
    const adjacentIds = (graph.adjacency[raw.id] ?? []).filter(id => graph.byId.get(id)?.owner === team);
    const adjacent = adjacentIds.length > 0;
    // `capturableBy` parity (game/cocs.mjs §5.2): HQ anchors are never
    // capturable, ARRAY anchors open only in the endgame and ignore the live
    // set, and every other capturable node must be live. Ownership and
    // adjacency stay the remaining gates. `mine` keeps HOLD/defend actionable on
    // an owned node — the authority simply never calls that a capture.
    const captureOpen = capturable ? live : arrayOpen;
    const legal = Boolean(team !== null && (capturable || arrayAnchor) && captureOpen && (mine || adjacent));
    const attackable = legal && !mine;
    const staging = adjacentIds.some(id => connected.has(id));
    const supplyConnected = mine ? connected.has(raw.id) : attackable ? staging : false;
    const captured = Array.isArray(raw.progress) ? raw.progress : [0, 0];
    const myProgress = team === null ? 0 : clamp01(captured[team]);
    const enemyProgress = team === null ? 0 : clamp01(captured[team === 0 ? 1 : 0]);
    let routeCost = null, routeHops = null, reachable = true;
    if (routeFn) {
      const travel = routeFn({x: num(raw.x, 0), y: num(raw.y, 0), z: num(raw.z, 0)});
      reachable = travel !== null && travel !== undefined && Number.isFinite(Number(travel));
      if (reachable) routeCost = Number(travel);
    }
    const distance = player && Number.isFinite(player.x) && Number.isFinite(player.z)
      ? Math.hypot(player.x - num(raw.x, 0), player.z - num(raw.z, 0)) : Infinity;
    const node = {
      id: raw.id,
      label: raw.label,
      mark: latticeArchetypeMark(archetype),
      archetype,
      x: num(raw.x, 0),
      z: num(raw.z, 0),
      r: num(raw.r, 6),
      owner,
      ownerLabel: team === null ? (owner === null ? 'NEUTRAL' : `TEAM ${owner}`) : mine ? 'YOURS' : owner === null ? 'NEUTRAL' : 'ENEMY',
      mine, enemy,
      live, contested: raw.contested === true,
      progress: [clamp01(captured[0]), clamp01(captured[1])],
      myProgress, enemyProgress,
      progressPercent: Math.round(Math.max(myProgress, enemyProgress) * 100),
      capturable,
      legal,
      attackable,
      adjacent,
      staging: adjacentIds,
      connected: supplyConnected,
      supply: capturable ? (mine || attackable ? (supplyConnected ? 'LINKED' : 'CUT OFF') : 'BLOCKED') : null,
      reachable,
      routeCost,
      routeHops,
      distance,
      status: raw.contested === true ? 'CONTESTED' : mine ? 'YOURS' : owner === null ? 'NEUTRAL' : 'ENEMY',
      siegeDefence: Boolean(siegeActive && siegeNode && raw.id === siegeNode.id),
      deferred: Boolean(siegeActive && attackable),
      priority: 0,
    };
    node.priority = latticePriority(node, siegeActive);
    return node;
  });
  const byId = {};
  for (const node of nodes) byId[node.id] = node;
  if (siege && siegeNode) siege.label = byId[siege.nodeId]?.label ?? siege.label;
  const ranked = nodes.filter(node => node.legal && node.reachable)
    .sort((a, b) => b.priority - a.priority
      || Number(b.connected) - Number(a.connected)
      || (num(a.routeCost, a.distance) - num(b.routeCost, b.distance))
      || a.distance - b.distance
      || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.floor(num(options.limit, LATTICE_SHORTLIST_LIMIT)));
  const siegeNodeState = siege ? byId[siege.nodeId] ?? null : null;
  const shortlist = siege ? [siegeNodeState].filter(Boolean) : ranked.slice(0, limit);
  const deferred = siege ? ranked.filter(node => node.attackable && !node.siegeDefence).slice(0, limit) : [];
  return {
    team,
    nodes,
    byId,
    adjacency: graph.adjacency,
    edges: graph.edges ?? [],
    bounds: graph.bounds,
    source: graph.source,
    legal: ranked,
    ranked,
    shortlist,
    deferred,
    siege,
    hq: nodes.find(node => node.archetype === 'hq' && (team === null || node.owner === team)) ?? null,
    routeSource: routeFn ? 'navigation' : 'none',
  };
}

/** The small ranked shortlist a surface should show (never more than a handful). */
export function latticeShortlist(model, options = {}) {
  if (!model) return [];
  const limit = Math.max(1, Math.floor(num(options.limit, LATTICE_SHORTLIST_LIMIT)));
  return (model.shortlist ?? model.ranked ?? []).slice(0, limit);
}

function adviceApplies(previous, node, model) {
  const kind = String(previous?.kind ?? '');
  if (kind === 'siege') return node.siegeDefence === true && model.siege?.active === true;
  if (kind === 'capture' || kind === 'advance') return node.mine !== true;
  if (kind === 'clear') return node.mine === true && node.contested === true;
  if (kind === 'defend') return node.mine === true && (node.contested === true || node.enemyProgress > 0.02);
  if (kind === 'hold') return node.mine === true;
  return node.legal === true;
}

function adviceKind(node) {
  if (node.siegeDefence) return 'siege';
  if (node.mine && node.contested) return 'clear';
  if (node.mine && node.enemyProgress > 0.02) return 'defend';
  if (node.mine) return 'hold';
  return node.distance <= node.r ? 'capture' : 'advance';
}

function shortEntry(node) {
  return {id: node.id, label: node.label, mark: node.mark, kind: adviceKind(node), priority: node.priority,
    distance: Math.round(node.distance), routeCost: Number.isFinite(node.routeCost) ? Math.round(node.routeCost) : null,
    connected: node.connected, contested: node.contested, mine: node.mine, status: node.status};
}

/**
 * The contextual coach. Now model-driven with hysteresis: pass the previous
 * result in `options.previous` and small positional changes cannot oscillate
 * the advice. It only re-targets when the held target becomes invalid or an
 * urgent event (siege, a contested/being-taken held node, a finishing capture)
 * supersedes it.
 */
export function latticeCoach(hud, player, map, options = {}) {
  if (!isLattice(hud?.config?.mode) || !hud?.cocs || !map?.nodes || !player) return null;
  const team = player.team;
  if (team !== 0 && team !== 1) return null;
  const model = options.model ?? latticeTargetModel(hud, map, player, options);
  if (!model) return null;
  const shared = {nodes: model.nodes, links: model.edges ?? [], player: {x: num(player.x, 0), z: num(player.z, 0)}, bounds: model.bounds, model,
    siege: model.siege, shortlist: (model.shortlist ?? []).map(shortEntry), advice: null, held: false};
  if (player.health <= 0) {
    return {...shared, title: 'REGROUP ON RESPAWN', detail: 'Protect the route from HQ to your front; a different operator or harness can fill a missing team role.', targetId: null,
      advice: {kind: 'regroup', targetId: null, priority: 0, urgent: false, held: false}};
  }
  const previous = options.previous && typeof options.previous === 'object' ? (options.previous.advice ?? options.previous) : null;
  const heldNode = previous?.targetId ? model.byId[String(previous.targetId)] ?? null : null;
  const heldUsable = Boolean(heldNode && (heldNode.legal || (heldNode.siegeDefence === true && model.siege?.active === true)) && heldNode.reachable !== false);
  const heldValid = Boolean(heldUsable && adviceApplies(previous, heldNode, model));
  const best = model.siege?.active ? model.byId[model.siege.nodeId] ?? model.ranked[0] ?? null : model.ranked[0] ?? null;
  let target = null, held = false;
  if (heldValid) {
    const siegeMust = Boolean(model.siege?.active && heldNode.siegeDefence !== true);
    const supersede = Boolean(best && best.id !== heldNode.id && best.priority >= LATTICE_URGENT_PRIORITY && best.priority > heldNode.priority);
    if (!siegeMust && !supersede) { target = heldNode; held = true; }
    else target = best;
  } else target = best;
  const kind = target ? adviceKind(target) : null;
  const advice = {kind, targetId: target?.id ?? null, priority: target?.priority ?? 0,
    urgent: Boolean(target && target.priority >= LATTICE_URGENT_PRIORITY), held};
  let title = 'KEEP YOUR SUPPLY LINE CONNECTED';
  let detail = 'Follow the links from your HQ to a live front. Ground ramps are available to every operator.';
  if (target && kind === 'siege') {
    title = `DEFEND ${target.label}`;
    detail = `The Director is breaking through ${model.siege.label} · HQ ${model.siege.percent}% · ${model.siege.attackers} attackers inside. Fall back now; forward pushes can wait.`;
  } else if (target && target.contested) {
    title = `CLEAR ${target.label}`;
    detail = 'Both teams are on the point. Clear the enemies so capture can resume.';
  } else if (target && target.mine && target.enemyProgress > 0.02) {
    title = `DEFEND ${target.label}`;
    detail = `Enemy capture at ${Math.round(target.enemyProgress * 100)}%. Get inside the ring and clear them before it flips.`;
  } else if (target && target.mine) {
    title = `DEFEND ${target.label}`;
    detail = target.connected
      ? `Hold ${target.mark} ${target.label} so the forward nodes keep earning FLUX.`
      : `${target.mark} ${target.label} is cut off from your HQ. Reconnect the line or fall back to a linked node.`;
  } else if (target && target.distance <= target.r) {
    title = `CAPTURE ${target.label}`;
    detail = 'Stay inside the ring. Capture is automatic — keep the approach covered.';
  } else if (target) {
    const meters = Number.isFinite(target.routeCost) ? Math.round(target.routeCost) : Math.round(target.distance);
    title = `ADVANCE TO ${target.label}`;
    detail = target.connected
      ? `Push ${target.mark} ${target.label} · ${meters} m by ground route · supply route linked.`
      : `Push ${target.mark} ${target.label} · ${meters} m by ground route · CUT OFF from HQ — reconnect the line first.`;
  }
  return {...shared, title, detail, targetId: target?.id ?? null, advice};
}

// A single keyboard router shared by local and online play. Returning null
// leaves chat, weapon selection and the ordinary pause handler in control.
export function latticeOrderKey({mode = '', spectate = false, code = '', action = '', armed = false, repeat = false} = {}) {
  if (!isLattice(mode) || spectate || repeat) return null;
  const verb = {commandScan: 'SCAN', commandGo: 'GO', commandAttack: 'ATTACK', commandRoute: 'ROUTE'}[action];
  if (verb) return {type: 'arm', verb};
  if (armed && /^Digit[1-9]$/.test(code)) return {type: 'pick', index: Number(code.slice(-1))};
  if (armed && code === 'Enter') return {type: 'issue'};
  if (armed && code === 'Escape') return {type: 'cancel'};
  return null;
}
