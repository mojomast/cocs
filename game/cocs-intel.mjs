// LATTICE STRIKE (`cocs` / `cocs-coop`) V2 per-team snapshot filtering.
//
// Design authority: docs/design/COCS-MODE-SPEC.md
//   §11.3  snapshot subtree: `intel[team]` / `contacts[team]` are per-team from
//          day one; `cards`, `orders`, `subagents`, `depots`, personal REQ are
//          id-keyed plain data.
//   §11.4  per-team visibility: V1 emits equal values to both teams; **V2 ships
//          the per-peer filtered `snapshot.cocs`** with the `cocs-visibility`
//          leak test as the gate.
//   §12.7  V2 scope: per-peer filtered `snapshot.cocs` + true fog.
//
// Contract
// --------
// `filterCocsSnapshot(snapshot, team)` takes the full wire state produced by
// `Room.wireState()` and returns a deterministic filtered copy for the
// recipient. `team` is `0`, `1`, or `null`:
//
//   * `0` / `1`  — the recipient's team keeps its own private sections; the
//                  other team's sections are redacted (map keys removed, array
//                  entries removed).
//   * `null`     — spectator view: shared/public fields only. A spectator can
//                  never be used as an oracle for either team's private state.
//
// Guarantees
// ----------
//   * Pure: no `Math.random`, no wall clock, no mutation of the input tree.
//   * Deterministic: identical `(snapshot, team)` always produce an identical
//     `JSON.stringify` result.
//   * Cheap: untouched sub-objects are shared by reference with the input. Only
//     the `cocs` subtree, the nested blocks named below, and (when present) the
//     enemy actors' REQ fields are copied or rebuilt.
//   * Offline/local: `Match.snapshot()` never passes through this module, so
//     solo play is byte-identical to V1. A snapshot without a `cocs` subtree is
//     returned by identity, so every non-COCS mode is untouched.
//
// Field table (`COCS_FILTER_RULES`, deep-frozen)
// ----------------------------------------------
// `kind` meanings:
//   team-map    a `{0,1}` map is reduced to `{[recipient]: value}` and becomes
//               `{}` for a spectator (other team's key is absent from the wire).
//   team-array  entries whose numeric `team` is not the recipient's are removed
//               (spectator: `[]`, including entries without a team).
//   actor-array entries are removed unless `entry.id` names an actor on the
//               recipient's team (spectator: `[]`).
//   actor-map   keys are removed unless the key names an actor on the
//               recipient's team (spectator: `{}`).
//   team-block  the whole block passes only to `rule.team`; every other
//               recipient receives `null` (the shape the client already
//               handles for a missing command board).
//   actor-field the named fields are deleted from enemy/spectated actors
//               (`COCS_ACTOR_PRIVATE_FIELDS`; own team keeps them).
//
//   path                     kind         why it is team-scoped
//   ----                     ----         ---------------------
//   flux                     team-map     team FLUX wallet/income/upkeep/spend
//   fluxIncome               team-map
//   fluxUpkeep               team-map
//   fluxSpent                team-map
//   neglect                  team-map     team underdog meter (§6A.6)
//   scoutStats               team-map     team SCAN history
//   scans                    team-map     team SCAN target node
//   intel                    team-map     per-team recon truth (§11.3/§11.4)
//   contacts                 team-map     per-team contact list (§11.3)
//   roleBoard                team-map     per-team agent board (§8.1)
//   commander.seat           team-map     per-team command seat + votes/route
//   commander.votes          team-map
//   commander.route          team-map
//   commander.policy         team-map
//   fieldSupport.intel       team-map     recon hook marks (enemy positions)
//   spots                    team-array   live SPOT/field marks (§4.7/§8.1)
//   scouts                   team-array   SCAN scout bodies and positions
//   sabotage                 team-array   SABOTEUR cuts (author + timer)
//   cards                    team-array   room card board / order feed (§11.2)
//   roles.agents             team-array   co-op role roster
//   req                      actor-array  personal REQUISITION wallets
//   command.slices           actor-array  co-op per-player FLUX slices
//   fieldSupport.actors      actor-map    per-actor support cooldown memory
//   fieldSupport.recipients  actor-map    per-recipient support memory
//   command                  team-block   co-op command board (team 0)
//   command.seat/votes/      team-map     its per-team maps
//     route/policy
//   actors[].req             actor-field  the §11.3 personal REQ fields ship on
//   actors[].reqSpent                      every actor; enemy actors are
//   actors[].reqBuff                       stripped to numbers-free copies
//   actors[].ordersCompleted              (own team keeps them for the board,
//   actors[].ordersContributed             spectators keep none)
//   actors[].ordersOptOut
//
// Kept shared because it is world-observable or a public aggregate (both teams
// see the same lattice / world truth, so it is not private information):
// `tick`, `fieldSupport.nodes`, `nodes` (owner/progress/contest/hack/prime),
// `scores`, `liveNodeIds`, `winner`, `dominance` (F03 public dominance race:
// controlling team, required majority, authoritative remaining hold time,
// accelerated state), `outcome` (F03 mode-aware public progress: Operations
// waves/HQ; PvP keeps its race in `dominance`), `fluxCap`, `orderStats`,
// `scoutCap`, `scanRadius`, `spotSeconds`, `spotBonus`, `traversal`
// (devices/depots/arrivals/stats), `rung`, `terminalState`, `terminals`,
// `primes`, the OPERATIONS
// `director`/`waves`/`bonus`/`reserves`/`rewards` surface, and the
// rest of the top-level `actors` array. `actors` still carries enemy positions
// and gear for every peer — the §11.4/§12.8-acknowledged V1 limitation that true
// fog (not this filter) is responsible for; this module never makes it worse.
//
// Events (`cocsEventVisible`)
// ---------------------------
// The shared `events` feed carries the same leak (orders, scans, buys, role
// spawns). Team-tagged `cocs-*` events are private to their team, except a
// documented allow-list of world-observable events that both teams need for
// presentation (`cocs-capture` drives the "secured"/"lost"/"enemy secured"
// banners and its additive `previousOwner` field is public world truth;
// terminals and traversal are visible world channels). Every non-`cocs-*` event
// and every event without a numeric `team` passes through unchanged.

const deepFreeze = value => {
 if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
 }
 return value;
};

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The explicit field table. Deep-frozen; `filterCocsSnapshot` walks it in order. */
export const COCS_FILTER_RULES = deepFreeze([
 // Per-team maps: the enemy key never reaches the wire.
 {path: 'flux', kind: 'team-map'},
 {path: 'fluxIncome', kind: 'team-map'},
 {path: 'fluxUpkeep', kind: 'team-map'},
 {path: 'fluxSpent', kind: 'team-map'},
 {path: 'neglect', kind: 'team-map'},
 {path: 'scoutStats', kind: 'team-map'},
 {path: 'scans', kind: 'team-map'},
 {path: 'intel', kind: 'team-map'},
 {path: 'contacts', kind: 'team-map'},
 {path: 'roleBoard', kind: 'team-map'},
 {path: 'commander.seat', kind: 'team-map'},
 {path: 'commander.votes', kind: 'team-map'},
 {path: 'commander.route', kind: 'team-map'},
 {path: 'commander.policy', kind: 'team-map'},
 {path: 'fieldSupport.intel', kind: 'team-map'},
 // Team-tagged arrays: enemy entries are removed (team-less entries too).
 {path: 'spots', kind: 'team-array'},
 {path: 'scouts', kind: 'team-array'},
 {path: 'sabotage', kind: 'team-array'},
 {path: 'cards', kind: 'team-array'},
 {path: 'roles.agents', kind: 'team-array'},
 // Actor-keyed collections: entries outside the recipient's team are removed.
 {path: 'req', kind: 'actor-array'},
 {path: 'command.slices', kind: 'actor-array'},
 {path: 'fieldSupport.actors', kind: 'actor-map'},
 {path: 'fieldSupport.recipients', kind: 'actor-map'},
 // A whole block owned by one team (OPERATIONS command board is team 0's).
 {path: 'command', kind: 'team-block', team: 0},
 // ...and its per-team seat/vote/route/policy maps, inside that block.
 {path: 'command.seat', kind: 'team-map'},
 {path: 'command.votes', kind: 'team-map'},
 {path: 'command.route', kind: 'team-map'},
 {path: 'command.policy', kind: 'team-map'},
]);

/**
 * Public additive snapshot fields (F03). They carry no team-private data, so
 * they deliberately have no filter rule: both teams and spectators receive the
 * identical object. Kept as an explicit list so the visibility test can prove
 * every one of them passes through unfiltered.
 */
export const COCS_PUBLIC_FIELDS = deepFreeze(['dominance', 'outcome']);

/**
 * COCS events that stay readable by both teams (and spectators) even though
 * they carry a numeric `team`: they describe world-observable state that drives
 * presentation for everyone (e.g. `cocs-capture` plays the secured cue for the
 * capturing team and the lost cue for the other). Everything else tagged
 * `cocs-*` with a team is private to that team.
 */
export const COCS_PUBLIC_EVENTS = deepFreeze([
 'cocs-capture',
 'cocs-depot-capture',
 'cocs-depot-vehicle-spawn',
 'cocs-device-use',
 'cocs-prime',
 'cocs-prime-start',
 'cocs-prime-interrupt',
 'cocs-terminal-hack',
 'cocs-terminal-deploy',
 'cocs-terminal-sabotage',
 'cocs-terminal-vault',
 'cocs-terminal-repair',
 'cocs-terminal-restored',
 'cocs-terminal-offline',
]);

const teamOf = value => (value === 0 || value === 1 ? Number(value) : null);

/**
 * Personal REQUISITION / order-surface fields carried on every actor (§11.3).
 * They are team-scoped information: an enemy peer must not read another
 * player's wallet, active purchase or order tally.
 */
export const COCS_ACTOR_PRIVATE_FIELDS = deepFreeze(['req', 'reqSpent', 'reqBuff', 'ordersCompleted', 'ordersContributed', 'ordersOptOut']);

/** Actor id -> team index, read from the same snapshot's `actors` array. */
function actorTeamIndex(actors) {
 const index = new Map();
 if (!Array.isArray(actors)) return index;
 for (const actor of actors) {
  if (!actor || (actor.team !== 0 && actor.team !== 1)) continue;
  const id = Number(actor.id);
  if (Number.isFinite(id)) index.set(id, actor.team);
 }
 return index;
}

function filterTeamMap(map, team) {
 if (!isObject(map)) return map;
 if (team === null) return {};
 return Object.hasOwn(map, team) ? {[team]: map[team]} : {};
}

function filterTeamArray(list, team) {
 if (!Array.isArray(list)) return list;
 if (team === null) return [];
 return list.filter(entry => isObject(entry) && entry.team === team);
}

function filterActorArray(list, team, teams) {
 if (!Array.isArray(list)) return list;
 if (team === null) return [];
 return list.filter(entry => isObject(entry) && teams.get(Number(entry.id)) === team);
}

function filterActorMap(map, team, teams) {
 if (!isObject(map)) return map;
 const out = {};
 if (team === null) return out;
 for (const key of Object.keys(map)) if (teams.get(Number(key)) === team) out[key] = map[key];
 return out;
}

// Enemy actors (and every actor for a spectator) lose the personal REQ fields.
// Own-team actors keep them: the board/economy readout is team-shared by design,
// and the client's prediction resync reads its own actor. The array reference is
// preserved when nothing had to be redacted.
function filterActorWallets(actors, team) {
 if (!Array.isArray(actors)) return actors;
 let changed = false;
 const out = actors.map(actor => {
  if (!isObject(actor)) return actor;
  if (team !== null && actor.team === team) return actor;
  let copy = null;
  for (const field of COCS_ACTOR_PRIVATE_FIELDS) {
   if (!Object.hasOwn(actor, field)) continue;
   if (copy === null) copy = {...actor};
   delete copy[field];
   changed = true;
  }
  return copy ?? actor;
 });
 return changed ? out : actors;
}

/**
 * Deterministic per-team copy of a full wire snapshot. See the field table in
 * the module header. Returns the input unchanged (by identity) when there is no
 * `cocs` subtree, which keeps every non-COCS mode byte-identical.
 */
export function filterCocsSnapshot(snapshot, team) {
 if (!isObject(snapshot) || !isObject(snapshot.cocs)) return snapshot;
 const recipient = teamOf(team);
 const cocs = snapshot.cocs;
 const teams = actorTeamIndex(snapshot.actors);
 const filtered = {...cocs};
 // Clone every nested parent named by a dotted rule once, so sibling rules can
 // write into the same copy.
 for (const rule of COCS_FILTER_RULES) {
  const dot = rule.path.indexOf('.');
  if (dot < 0) continue;
  const parent = rule.path.slice(0, dot);
  if (isObject(cocs[parent]) && filtered[parent] === cocs[parent]) filtered[parent] = {...cocs[parent]};
 }
 for (const rule of COCS_FILTER_RULES) {
  const dot = rule.path.indexOf('.');
  const parent = dot < 0 ? null : rule.path.slice(0, dot);
  const key = dot < 0 ? rule.path : rule.path.slice(dot + 1);
  const target = parent === null ? filtered : filtered[parent];
  if (!isObject(target) || !Object.hasOwn(target, key)) continue;
  if (rule.kind === 'team-map') target[key] = filterTeamMap(target[key], recipient);
  else if (rule.kind === 'team-array') target[key] = filterTeamArray(target[key], recipient);
  else if (rule.kind === 'actor-array') target[key] = filterActorArray(target[key], recipient, teams);
  else if (rule.kind === 'actor-map') target[key] = filterActorMap(target[key], recipient, teams);
  else if (rule.kind === 'team-block') target[key] = recipient === teamOf(rule.team) ? target[key] : null;
 }
 return {...snapshot, actors: filterActorWallets(snapshot.actors, recipient), cocs: filtered};
}

/**
 * `true` when `event` may reach a peer whose team is `team` (`null` =
 * spectator). Pure; see the event table in the module header.
 */
export function cocsEventVisible(event, team) {
 if (!isObject(event)) return false;
 const type = String(event.type ?? '');
 // Non-COCS events (and the shared event feed of every other mode) are never
 // filtered.
 if (!type.startsWith('cocs-')) return true;
 // Event without a team tag: shared world/news event.
 if (event.team !== 0 && event.team !== 1) return true;
 // World-observable event: both teams (and spectators) keep it.
 if (COCS_PUBLIC_EVENTS.includes(type)) return true;
 // Team-private intent (orders, scans, buys, role bodies): own team only.
 return team === event.team;
}

/** Filter an event list in order (convenience for tests and server loops). */
export function filterCocsEvents(events, team) {
 if (!Array.isArray(events)) return [];
 return events.filter(event => cocsEventVisible(event, team));
}
