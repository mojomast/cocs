// ---------------------------------------------------------------------------
// LATTICE STRIKE: OPERATIONS (`cocs-coop`) — terminals (O1c).
//
// Spec authority: COCS-MODE-SPEC.md §4.3 (terminals), §4.8 (`PRIME`), §8.1
// (`HARVESTER`), and COCS-OPERATIONS.md §7.3 (terminals `HACK`/`DEPLOY`/`VAULT`
// and the active prime).
//
// Terminals are the first interactable-entity concept in the game and live in a
// separate `state.terminals` tree, never in `deployables`. Placement is a pure
// function of the authored lattice:
//
//   * an ARRAY RELAY node hosts `HACK` (flip a contested node's capture progress
//     at 2x for 6 s), `DEPLOY` (connected local intel + a unique courier shard)
//     and a `SABOTAGE` link (income denied for 45 s or until repaired);
//   * an HQ hosts `VAULT` (deliver a carried shard / consume a banked shard
//     and 8 FLUX for the existing 6 REQ effect).
//
// Determinism: pure data, sorted iteration, one fixed tick clock, no RNG and no
// wall-clock read. The engine half (`stepCocsTerminals`) is a pure function of
// the previous state + `dt` + living actor positions. Terminals are created only
// for `cocs-coop`, so PvPvE `cocs` behaviour and snapshots stay byte-identical.
// ---------------------------------------------------------------------------

import {RULES} from './data.mjs';
import {latticeInteractionRate} from './lattice-support.mjs';
import {capturableBy, connectedToHq} from './cocs.mjs';
import {ROLE_ABILITIES} from './cocs-roles.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const num = (value, fallback = 0) => (finite(value) ? value : fallback);
const round = (value, places = 3) => {
  const scale = 10 ** places;
  return Math.round(num(value, 0) * scale) / scale;
};
const ticks = seconds => Math.max(1, Math.round(num(seconds, 0) / (RULES.dt || 1 / 60)));
const distance = (a, b) => Math.hypot(num(a?.x, 0) - num(b?.x, 0), num(a?.z, 0) - num(b?.z, 0));

// §4.3/§6A.7 published terminals. Kept as data so the UI renders one table.
export const TERMINAL_KINDS = Object.freeze({
  HACK: Object.freeze({verb: 'HACK', label: 'HACK RELAY', channelSeconds: 3, effectSeconds: 6, captureMultiplier: 2, reach: 6}),
  DEPLOY: Object.freeze({verb: 'DEPLOY', label: 'DEPLOY ORACLE', channelSeconds: 2, reach: 6}),
  VAULT: Object.freeze({verb: 'VAULT', label: 'VAULT', reach: 6, pullCost: 8, pullReq: 6}),
  SABOTAGE: Object.freeze({verb: 'SABOTAGE', label: 'SABOTAGE LINK', channelSeconds: 3, cutSeconds: 45, reach: 6}),
});
export const TERMINAL_VERBS = Object.freeze(['HACK', 'DEPLOY', 'VAULT', 'SABOTAGE']);
export const TERMINAL_INTERACT_SECONDS = 3;
// Allied-bot cadence between terminal actions (10 s at RULES.dt). The HACK
// window is 6 s, so a parked bot cannot keep a relay permanently doubled.
export const BOT_TERMINAL_COOLDOWN_TICKS = 600;

/** The deterministic terminal catalog derived from the authored lattice. */
export function readTerminals(state) {
  const out = [];
  const nodes = [...(state?.nodes ?? [])].filter(Boolean).sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
  for (const node of nodes) {
    if (node.archetype === 'relay' || node.archetype === 'array') {
      out.push({id: `hack-${node.id}`, kind: 'HACK', nodeId: node.id, x: num(node.x, 0), z: num(node.z, 0)});
      out.push({id: `deploy-${node.id}`, kind: 'DEPLOY', nodeId: node.id, x: num(node.x, 0), z: num(node.z, 0)});
      out.push({id: `sabotage-${node.id}`, kind: 'SABOTAGE', nodeId: node.id, x: num(node.x, 0), z: num(node.z, 0)});
    } else if (node.archetype === 'hq') {
      out.push({id: `vault-${node.id}`, kind: 'VAULT', nodeId: node.id, x: num(node.x, 0), z: num(node.z, 0)});
    }
  }
  return out;
}

/** Fresh terminal state, or null when the lattice hosts no terminal. */
export function createTerminalState(state) {
  const catalog = readTerminals(state);
  if (!catalog.length) return null;
  const terminals = {};
  for (const entry of catalog) {
    terminals[entry.id] = {
      ...entry,
      y: num(nodeById(state, entry.nodeId)?.y, 0),
      state: 'live',
      timer: 0,
      channel: null,
      owner: nodeById(state, entry.nodeId)?.owner ?? null,
      uses: 0,
      hacks: 0,
      deploys: 0,
      sabotages: 0,
      repairs: 0,
      hackedTeam: null,
      deployedTeam: null,
      contested: false,
      hostiles: {0: false, 1: false},
      blockedReason: null,
      // One authored shard per team/source for the entire operation. Losing
      // ground or reinstalling ORACLE cannot mint additional withdrawal rewards.
      ...(entry.kind === 'DEPLOY' ? {shards: {0: 'unresolved', 1: 'unresolved'}} : {}),
    };
  }
  return {
    tick: 0,
    terminals,
    vault: {stores: 0, pulls: 0, last: null, byNode: {}, cargo: {}},
    stats: {interacts: 0, hacks: 0, deploys: 0, sabotages: 0, repairs: 0, vaultStores: 0, vaultPulls: 0},
  };
}

function nodeById(state, id) {
  return (state?.nodes ?? []).find(node => String(node.id) === String(id)) ?? null;
}

function terminalReach(terminal) {
  return num(TERMINAL_KINDS[terminal.kind]?.reach, 6);
}

function actorAtTerminal(actor, terminal) {
  if (!actor || actor.health <= 0) return false;
  if (actor.team !== 0 && actor.team !== 1) return false;
  return distance(actor, terminal) <= terminalReach(terminal) && Math.abs(num(actor.y, 0) - num(terminal.y, 0)) <= 5;
}

function enemyNear(match, terminal, team, meters = 6) {
  for (const actor of match?.actors ?? []) {
    if (!actor || actor.health <= 0) continue;
    if (actor.team !== 0 && actor.team !== 1) continue;
    if (actor.team === team) continue;
    if (distance(actor, terminal) <= meters && Math.abs(num(actor.y, 0) - num(terminal.y, 0)) <= 5) return true;
  }
  return false;
}

function refreshOwnership(state, terminal) {
  const node = nodeById(state, terminal.nodeId);
  terminal.owner = node && (node.owner === 0 || node.owner === 1) ? node.owner : null;
  return node;
}

function terminalGate(state, terminal, team, verb = terminal.kind) {
  const node = nodeById(state, terminal.nodeId);
  if (!node) return 'missing';
  if (verb === 'REPAIR') {
    if (terminal.state !== 'cut' && terminal.state !== 'locked') return 'terminal-state';
    return node.owner === team ? null : 'not-owned';
  }
  if (terminal.state !== 'live') return 'terminal-state';
  if (verb === 'HACK') {
    if (node.hack && state.tick <= node.hack.until) return 'cooldown';
    if (node.owner === team) return 'already-owned';
    if (!capturableBy(state, node.id, team)) return 'adjacency';
  }
  if (verb === 'DEPLOY' || verb === 'VAULT') {
    if (node.owner !== team) return 'not-owned';
    if (!connectedToHq(state, node.id, team)) return 'disconnected';
  }
  if (verb === 'DEPLOY' && node.oracle?.team === team) return 'deployed';
  if (verb === 'SABOTAGE') {
    if (node.owner !== 1 - team) return 'not-enemy';
    if ((state.cuts ?? []).includes(node.id)) return 'already-cut';
  }
  return null;
}

function cancelChannel(match, terminal, reason) {
  if (!terminal.channel) return;
  const {actor, action, team} = terminal.channel;
  terminal.channel = null;
  terminal.blockedReason = reason;
  match?.emit?.('cocs-terminal-interrupted', {terminal: terminal.id, node: terminal.nodeId, actor, action, team, reason});
}

/** Read-only preflight for protocol terminal actions. The server can call this
 * before queueing; channels still revalidate every tick at authoritative time. */
export function terminalActionGate(match, state, terminal, actor, action) {
  if (!terminal || !actor) return {ok: false, reason: 'missing'};
  if (!actorAtTerminal(actor, terminal)) return {ok: false, reason: 'range'};
  const verb = {hack: 'HACK', deploy: 'DEPLOY', cut: 'SABOTAGE', sabotage: 'SABOTAGE', repair: 'REPAIR', 'vault-store': 'VAULT', 'vault-pull': 'VAULT'}[String(action).toLowerCase()];
  if (!verb || (terminal.kind !== verb && !(verb === 'REPAIR' && terminal.kind === 'SABOTAGE'))) return {ok: false, reason: 'wrong-terminal'};
  if (terminal.channel) return {ok: false, reason: 'busy'};
  if (enemyNear(match, terminal, actor.team)) return {ok: false, reason: 'contested'};
  let reason = terminalGate(state, terminal, actor.team, verb);
  if (verb === 'DEPLOY' && reason === 'deployed' && terminal.shards?.[actor.team] === 'ready') {
    reason = state.terminals.vault.cargo[actor.id] ? 'carrying' : null;
  }
  if (!reason && verb === 'VAULT') {
    if (action === 'vault-store') {
      const cargo = state.terminals.vault.cargo[actor.id];
      if (!cargo || cargo.team !== actor.team || cargo.deaths !== num(actor.deaths, 0)) reason = 'no-shard';
    } else if (!(state.terminals.vault.byNode[terminal.nodeId]?.[actor.team]?.length > 0)) reason = 'empty';
    else if (num(state.flux?.[actor.team], 0) + 1e-9 < TERMINAL_KINDS.VAULT.pullCost) reason = 'flux';
  }
  return {ok: !reason, reason};
}

/** Start a terminal channel for one actor. Returns `{ok, reason}`. */
export function startTerminalChannel(match, state, terminal, actor, verb) {
  if (!terminal || !actor) return {ok: false, reason: 'missing'};
  const kind = verb === 'REPAIR' ? {channelSeconds: ROLE_ABILITIES.builder.find(ability => ability.id === 'repair').seconds} : TERMINAL_KINDS[verb];
  if (!kind) return {ok: false, reason: 'unknown-verb'};
  if (terminal.kind !== verb && !(verb === 'REPAIR' && terminal.kind === 'SABOTAGE')) return {ok: false, reason: 'wrong-terminal'};
  refreshOwnership(state, terminal);
  if (!actorAtTerminal(actor, terminal)) return {ok: false, reason: 'range'};
  if (terminal.channel) return {ok: false, reason: 'busy'};
  if (enemyNear(match, terminal, actor.team)) return {ok: false, reason: 'contested'};
  const reason = terminalGate(state, terminal, actor.team, verb);
  if (reason) return {ok: false, reason};
  if (verb === 'VAULT') return {ok: false, reason: 'vault-action-required'};
  const seconds = num(kind.channelSeconds, TERMINAL_INTERACT_SECONDS);
  // One physical operator cannot run three colocated consoles simultaneously.
  for (const other of Object.values(state.terminals.terminals)) {
    if (other.channel?.actor === actor.id) cancelChannel(match, other, 'switched');
  }
  terminal.channel = {actor: actor.id, team: actor.team, deaths: num(actor.deaths, 0), action: verb, remaining: seconds, total: seconds};
  terminal.blockedReason = null;
  state.terminals.stats.interacts = num(state.terminals.stats.interacts, 0) + 1;
  match?.emit?.('cocs-terminal-start', {terminal: terminal.id, node: terminal.nodeId, actor: actor.id, team: actor.team, action: verb, seconds});
  return {ok: true, reason: null};
}

function completeTerminalChannel(match, state, terminal) {
  const channel = terminal.channel;
  if (!channel) return false;
  const node = refreshOwnership(state, terminal);
  const action = channel.action;
  terminal.channel = null;
  if (action === 'REPAIR') {
    const repaired = repairTerminal(state, terminal);
    if (repaired) match?.emit?.('cocs-terminal-repair', {terminal: terminal.id, node: terminal.nodeId, actor: channel.actor, team: channel.team});
    return repaired;
  }
  if (action === 'HACK') {
    if (!node) return false;
    node.hack = {team: terminal.hackerTeam ?? channel.team ?? node.owner, until: num(state.tick, 0) + ticks(TERMINAL_KINDS.HACK.effectSeconds), multiplier: TERMINAL_KINDS.HACK.captureMultiplier};
    // `channel.team` is stamped at start; fall back to the node's current owner.
    node.hack.team = channel.team === 0 || channel.team === 1 ? channel.team : node.owner;
    terminal.hacks = num(terminal.hacks, 0) + 1;
    terminal.hackedTeam = node.hack.team;
    state.terminals.stats.hacks = num(state.terminals.stats.hacks, 0) + 1;
    match?.emit?.('cocs-terminal-hack', {terminal: terminal.id, node: node.id, team: node.hack.team, seconds: TERMINAL_KINDS.HACK.effectSeconds, multiplier: node.hack.multiplier});
    return true;
  }
  if (action === 'DEPLOY') {
    terminal.deploys = num(terminal.deploys, 0) + 1;
    terminal.deployedTeam = channel.team;
    if (node) node.oracle = {team: channel.team, active: true};
    if (terminal.shards[channel.team] === 'unresolved') terminal.shards[channel.team] = 'ready';
    const actor = (match?.actors ?? []).find(entry => entry?.id === channel.actor);
    if (actor && actor.bot == null) collectShard(match, state, terminal, actor);
    state.terminals.stats.deploys = num(state.terminals.stats.deploys, 0) + 1;
    match?.emit?.('cocs-terminal-deploy', {terminal: terminal.id, node: terminal.nodeId, team: channel.team, oracle: true, shard: terminal.shards[channel.team]});
    return true;
  }
  if (action === 'SABOTAGE') {
    terminal.state = 'cut';
    terminal.timer = num(TERMINAL_KINDS.SABOTAGE.cutSeconds, 45);
    terminal.sabotages = num(terminal.sabotages, 0) + 1;
    state.terminals.stats.sabotages = num(state.terminals.stats.sabotages, 0) + 1;
    if (node && !(state.cuts ?? []).includes(node.id)) (state.cuts ??= []).push(node.id);
    match?.emit?.('cocs-terminal-sabotage', {terminal: terminal.id, node: terminal.nodeId, team: channel.team, seconds: terminal.timer});
    return true;
  }
  return false;
}

function tickTerminalChannel(match, state, terminal, dt) {
  const channel = terminal.channel;
  if (!channel) return;
  const actor = (match?.actors ?? []).find(entry => entry && entry.id === channel.actor) ?? null;
  const reason = !actor || actor.health <= 0 || num(actor.deaths, 0) !== channel.deaths ? 'actor-lost'
    : actor.team !== channel.team ? 'team-changed'
    : !actorAtTerminal(actor, terminal) ? 'range'
    : enemyNear(match, terminal, actor.team) ? 'contested'
    : terminalGate(state, terminal, actor.team, channel.action);
  if (reason) { cancelChannel(match, terminal, reason); return; }
  channel.remaining = Math.max(0, num(channel.remaining, 0) - dt * latticeInteractionRate(match, actor));
  if (!(channel.remaining > 0)) completeTerminalChannel(match, state, terminal);
}

/** Repair a cut/locked terminal (the `REPAIR` sink + the BUILDER role). */
export function repairTerminal(state, terminal) {
  if (!terminal) return false;
  if (terminal.state === 'live') return false;
  terminal.state = 'live';
  terminal.timer = 0;
  terminal.channel = null;
  terminal.repairs = num(terminal.repairs, 0) + 1;
  state.terminals.stats.repairs = num(state.terminals.stats.repairs, 0) + 1;
  const node = nodeById(state, terminal.nodeId);
  if (node && Array.isArray(state.cuts)) state.cuts = state.cuts.filter(id => id !== node.id);
  if (node) delete state.sabotage?.[node.id];
  return true;
}

function collectShard(match, state, terminal, actor) {
  const vault = state.terminals.vault;
  if (terminal.shards?.[actor.team] !== 'ready') return {ok: false, reason: 'no-shard'};
  if (vault.cargo[actor.id]) return {ok: false, reason: 'carrying'};
  vault.cargo[actor.id] = {actor: actor.id, team: actor.team, source: terminal.id, deaths: num(actor.deaths, 0)};
  terminal.shards[actor.team] = 'carried';
  match?.emit?.('cocs-terminal-shard', {terminal: terminal.id, node: terminal.nodeId, actor: actor.id, team: actor.team, action: 'collect'});
  return {ok: true, reason: null, action: 'collect'};
}

/** VAULT action: `store` archives a shard (free); `pull` spends 8 FLUX. */
export function vaultAction(match, state, terminal, actor, action) {
  if (!terminal || terminal.kind !== 'VAULT' || !actor) return {ok: false, reason: 'vault'};
  if (!actorAtTerminal(actor, terminal)) return {ok: false, reason: 'range'};
  refreshOwnership(state, terminal);
  const reason = terminalGate(state, terminal, actor.team);
  if (reason) return {ok: false, reason};
  if (enemyNear(match, terminal, actor.team)) return {ok: false, reason: 'contested'};
  const vault = state.terminals.vault;
  const bank = vault.byNode[terminal.nodeId] ??= {0: [], 1: []};
  if (String(action).toLowerCase() === 'store') {
    const cargo = vault.cargo[actor.id];
    if (!cargo || cargo.team !== actor.team || cargo.deaths !== num(actor.deaths, 0)) return {ok: false, reason: 'no-shard'};
    bank[actor.team].push(cargo.source);
    state.terminals.terminals[cargo.source].shards[actor.team] = 'banked';
    delete vault.cargo[actor.id];
    vault.stores = num(vault.stores, 0) + 1;
    terminal.uses = num(terminal.uses, 0) + 1;
    state.terminals.stats.vaultStores = num(state.terminals.stats.vaultStores, 0) + 1;
    vault.last = {action: 'store', team: actor.team, node: terminal.nodeId, tick: num(state.tick, 0)};
    match?.emit?.('cocs-terminal-vault', {terminal: terminal.id, node: terminal.nodeId, actor: actor.id, action: 'store', team: actor.team, stores: vault.stores, source: cargo.source, banked: bank[actor.team].length});
    return {ok: true, reason: null, action: 'store', cost: 0};
  }
  if (String(action).toLowerCase() !== 'pull') return {ok: false, reason: 'unknown-action'};
  if (!bank[actor.team].length) return {ok: false, reason: 'empty'};
  const cost = num(TERMINAL_KINDS.VAULT.pullCost, 8);
  const flux = num(state.flux?.[actor.team], 0);
  if (flux + 1e-9 < cost) return {ok: false, reason: 'flux'};
  const source = bank[actor.team].shift();
  state.terminals.terminals[source].shards[actor.team] = 'spent';
  state.flux[actor.team] = flux - cost;
  state.fluxSpent[actor.team] = num(state.fluxSpent?.[actor.team], 0) + cost;
  vault.pulls = num(vault.pulls, 0) + 1;
  terminal.uses = num(terminal.uses, 0) + 1;
  state.terminals.stats.vaultPulls = num(state.terminals.stats.vaultPulls, 0) + 1;
  const req = num(TERMINAL_KINDS.VAULT.pullReq, 6);
  actor.req = num(actor.req, 0) + req;
  actor.reqEarned = num(actor.reqEarned, 0) + req;
  vault.last = {action: 'pull', team: actor.team, node: terminal.nodeId, tick: num(state.tick, 0), req};
  match?.emit?.('cocs-terminal-vault', {terminal: terminal.id, node: terminal.nodeId, actor: actor.id, action: 'pull', team: actor.team, cost, req, pulls: vault.pulls, source, banked: bank[actor.team].length});
  return {ok: true, reason: null, action: 'pull', cost, req};
}

/** Explicit interact entry (the `interact` edge / tests). */
export function terminalInteract(match, state, actorId, terminalId, verb = null, action = null) {
  const terminals = state?.terminals;
  if (!terminals) return {ok: false, reason: 'no-terminals'};
  const terminal = terminals.terminals?.[terminalId];
  const actor = (match?.actors ?? []).find(entry => entry && entry.id === actorId) ?? null;
  if (!terminal || !actor) return {ok: false, reason: 'missing'};
  if (terminal.kind === 'VAULT') return vaultAction(match, state, terminal, actor, action ?? 'store');
  const resolved = String(verb ?? terminal.kind).toUpperCase();
  if (resolved === 'DEPLOY' && terminal.kind === 'DEPLOY' && nodeById(state, terminal.nodeId)?.oracle?.team === actor.team) {
    if (terminal.state !== 'live') return {ok: false, reason: 'terminal-state'};
    if (!actorAtTerminal(actor, terminal)) return {ok: false, reason: 'range'};
    if (nodeById(state, terminal.nodeId)?.owner !== actor.team) return {ok: false, reason: 'not-owned'};
    if (!connectedToHq(state, terminal.nodeId, actor.team)) return {ok: false, reason: 'disconnected'};
    if (enemyNear(match, terminal, actor.team)) return {ok: false, reason: 'contested'};
    return collectShard(match, state, terminal, actor);
  }
  const started = startTerminalChannel(match, state, terminal, actor, resolved);
  if (started.ok) terminal.channel.team = actor.team;
  return started;
}

// Fixed tie-break for the three terminals a relay/array authors at the same
// spot: prefer DEPLOY (own node) then HACK (enemy/neutral node) then VAULT, with
// SABOTAGE last. Within a tie the sorted id keeps the pick deterministic.
const HUMAN_TERMINAL_ORDER = Object.freeze(['DEPLOY', 'HACK', 'VAULT', 'SABOTAGE']);

function terminalActionable(match, state, terminal, actor, kind) {
  refreshOwnership(state, terminal);
  if (!actorAtTerminal(actor, terminal) || terminal.channel || enemyNear(match, terminal, actor.team)) return false;
  const verb = kind === 'SABOTAGE' && terminal.state === 'cut' && terminal.owner === actor.team ? 'REPAIR' : kind;
  const reason = terminalGate(state, terminal, actor.team, verb);
  if (kind === 'DEPLOY' && reason === 'deployed') return actor.bot == null && terminal.shards?.[actor.team] === 'ready' && !state.terminals.vault.cargo[actor.id];
  if (reason) return false;
  if (kind === 'VAULT') return Boolean(state.terminals.vault.cargo[actor.id])
    || ((state.terminals.vault.byNode[terminal.nodeId]?.[actor.team]?.length ?? 0) > 0 && num(state.flux?.[actor.team], 0) >= TERMINAL_KINDS.VAULT.pullCost);
  return true;
}

/**
 * The human `interact` edge against the O1c terminal layer. Sorted and
 * deterministic: the nearest terminal within its reach whose verb is currently
 * actionable for the actor, ties on the fixed `DEPLOY/HACK/VAULT/SABOTAGE`
 * order. Returns `{terminalId, kind, action}` or null. `cocs` PvPvE authors no
 * terminals, so this is a no-op there.
 */
export function humanTerminalInteract(match, state, actor) {
  const terminals = state?.terminals?.terminals;
  if (!terminals || !actor || actor.health <= 0) return null;
  if (actor.team !== 0 && actor.team !== 1) return null;
  let chosen = null;
  let chosenDistance = Infinity;
  let chosenRank = Infinity;
  for (const id of Object.keys(terminals).sort()) {
    const terminal = terminals[id];
    if (!terminal) continue;
    const reach = terminalReach(terminal);
    const d = distance(actor, terminal);
    if (!(d <= reach)) continue;
    const kind = String(terminal.kind ?? '').toUpperCase();
    if (!terminalActionable(match, state, terminal, actor, kind)) continue;
    const rank = HUMAN_TERMINAL_ORDER.indexOf(kind);
    if (chosen === null || d < chosenDistance - 1e-9
      || (Math.abs(d - chosenDistance) <= 1e-9 && rank < chosenRank)
      || (Math.abs(d - chosenDistance) <= 1e-9 && rank === chosenRank && id < chosen.id)) {
      chosen = terminal;
      chosenDistance = d;
      chosenRank = rank;
    }
  }
  if (!chosen) return null;
  const kind = String(chosen.kind ?? '').toUpperCase();
  if (kind === 'VAULT') {
    const action = state.terminals.vault.cargo[actor.id] ? 'store' : 'pull';
    const stored = terminalInteract(match, state, actor.id, chosen.id, 'VAULT', action);
    return stored.ok ? {terminalId: chosen.id, kind, action} : null;
  }
  const verb = kind === 'SABOTAGE' && chosen.state === 'cut' && chosen.owner === actor.team ? 'REPAIR' : kind;
  const started = terminalInteract(match, state, actor.id, chosen.id, verb);
  return started.ok ? {terminalId: chosen.id, kind, action: started.action ?? verb.toLowerCase()} : null;
}

/**
 * The allied-bot `interact` edge against the O1c terminal layer. Bots go
 * through the *same* `startTerminalChannel`/`vaultAction` entry points as the
 * human edge, so range, ownership (`DEPLOY` only while owned) and contest
 * (`HACK`/`SABOTAGE` only with no enemy inside 6 m) are identical by
 * construction. A per-actor cadence prevents a bot parked on a relay from
 * re-channeling every tick. Bots leave ORACLE shards ready for human couriers;
 * VAULT can only store real cargo. SABOTAGE is not auto-fired by allies (the Director
 * force owns denial; allies HACK/DEPLOY/VAULT). Deterministic: sorted
 * terminals, fixed tie-break, no RNG and no wall clock.
 *
 * @returns {{terminalId:string,kind:string,action:string}|null}
 */
export function botTerminalInteract(match, state, actor) {
  const terminals = state?.terminals?.terminals;
  if (!terminals || !actor || actor.health <= 0) return null;
  // Allied team only, and only AI-controlled actors: a human peer's own input
  // owns their interactions.
  if (actor.team !== 0) return null;
  if (actor.bot == null || actor.isScout === true || actor.isDirectorWave === true) return null;
  const tick = num(state.tick, 0);
  if (tick - num(actor.bot.terminalAt, -Infinity) < BOT_TERMINAL_COOLDOWN_TICKS) return null;
  let chosen = null;
  let chosenDistance = Infinity;
  let chosenRank = Infinity;
  for (const id of Object.keys(terminals).sort()) {
    const terminal = terminals[id];
    if (!terminal || terminal.channel) continue;
    const reach = terminalReach(terminal);
    const d = distance(actor, terminal);
    if (!(d <= reach)) continue;
    const kind = String(terminal.kind ?? '').toUpperCase();
    if (kind === 'SABOTAGE') continue;
    if (!terminalActionable(match, state, terminal, actor, kind)) continue;
    const rank = HUMAN_TERMINAL_ORDER.indexOf(kind);
    if (chosen === null || d < chosenDistance - 1e-9
      || (Math.abs(d - chosenDistance) <= 1e-9 && rank < chosenRank)
      || (Math.abs(d - chosenDistance) <= 1e-9 && rank === chosenRank && id < chosen.id)) {
      chosen = terminal;
      chosenDistance = d;
      chosenRank = rank;
    }
  }
  if (!chosen) return null;
  const kind = String(chosen.kind ?? '').toUpperCase();
  // Stamp the cadence before the action so a failed attempt still pays it.
  actor.bot.terminalAt = tick;
  if (kind === 'VAULT') {
    const stored = vaultAction(match, state, chosen, actor, 'store');
    return stored.ok ? {terminalId: chosen.id, kind, action: 'store'} : null;
  }
  const started = startTerminalChannel(match, state, chosen, actor, kind);
  if (!started.ok) return null;
  chosen.channel.team = actor.team;
  return {terminalId: chosen.id, kind, action: kind.toLowerCase()};
}

/** Advance one fixed tick. Called by `stepCocs` in co-op only. */
export function stepCocsTerminals(match, state, dt) {
  const terminals = state?.terminals;
  if (!terminals) return null;
  terminals.tick = num(terminals.tick, 0) + 1;
  // A lost courier returns the unique shard to its source, rather than letting
  // respawn teleport cargo home or deleting a team's finite reward forever.
  for (const id of Object.keys(terminals.vault.cargo).sort()) {
    const cargo = terminals.vault.cargo[id];
    const actor = (match?.actors ?? []).find(entry => entry && String(entry.id) === id);
    if (actor && actor.health > 0 && actor.team === cargo.team && num(actor.deaths, 0) === cargo.deaths) continue;
    terminals.terminals[cargo.source].shards[cargo.team] = 'ready';
    delete terminals.vault.cargo[id];
    match?.emit?.('cocs-terminal-shard', {terminal: cargo.source, actor: cargo.actor, team: cargo.team, action: 'returned'});
  }
  const ids = Object.keys(terminals.terminals ?? {}).sort();
  for (const id of ids) {
    const terminal = terminals.terminals[id];
    if (!terminal) continue;
    const node = refreshOwnership(state, terminal);
    terminal.hostiles = {0: enemyNear(match, terminal, 0), 1: enemyNear(match, terminal, 1)};
    terminal.contested = terminal.hostiles[0] && terminal.hostiles[1];
    if (terminal.timer > 0) {
      terminal.timer = Math.max(0, terminal.timer - dt);
      if (terminal.timer <= 1e-9 && terminal.state !== 'live') {
        terminal.timer = 0;
        terminal.state = 'live';
        terminal.channel = null;
        // A separate saboteur's later cut owns its own expiry.
        if (!(state.sabotage?.[terminal.nodeId]?.until > state.tick)) state.cuts = (state.cuts ?? []).filter(id => id !== terminal.nodeId);
        match?.emit?.('cocs-terminal-restored', {terminal: terminal.id, node: terminal.nodeId, reason: 'expired'});
      }
    }
    if (terminal.kind === 'DEPLOY' && node?.oracle && node.owner !== node.oracle.team) {
      node.oracle = null;
      terminal.deployedTeam = null;
      match?.emit?.('cocs-terminal-offline', {terminal: terminal.id, node: terminal.nodeId, reason: 'ownership'});
    }
    tickTerminalChannel(match, state, terminal, dt);
  }
  // Expire the HACK window on the fixed tick clock.
  for (const node of state.nodes ?? []) {
    if (node?.hack && num(state.tick, 0) > num(node.hack.until, 0)) node.hack = null;
  }
  // ORACLE resolves only its physical node footprint while connected and clear.
  // It supplies intel-only spots, never SCAN/SCOUT's damage bonus, never sees
  // cloak or through walls. Rebuild its marks so a cut immediately removes them.
  state.spots ??= {};
  for (const id of Object.keys(state.spots)) if (state.spots[id]?.oracle) delete state.spots[id];
  for (const id of ids) {
    const terminal = terminals.terminals[id];
    const node = nodeById(state, terminal.nodeId);
    if (terminal.kind !== 'DEPLOY' || !node?.oracle) continue;
    const oracle = node.oracle;
    oracle.active = node.owner === oracle.team && connectedToHq(state, node.id, oracle.team) && !terminal.contested;
    oracle.targets = [];
    if (!oracle.active) continue;
    for (const actor of [...(match?.actors ?? [])].filter(Boolean).sort((a, b) => a.id - b.id)) {
      if (actor.health <= 0 || actor.team !== 1 - oracle.team || actor.powerups?.cloak > 0
        || distance(actor, node) > num(node.r, terminalReach(terminal)) || Math.abs(num(actor.y, 0) - num(node.y, 0)) > 5) continue;
      if (match?.visible && !match.visible({x: node.x, y: num(node.y, 0) + 1, z: node.z}, {x: actor.x, y: num(actor.y, 0) + 1, z: actor.z})) continue;
      oracle.targets.push(actor.id);
      const spot = state.spots[actor.id];
      if (spot && !spot.oracle && spot.until > state.tick) continue;
      state.spots[actor.id] = {team: oracle.team, until: state.tick + 1, atTick: state.tick, x: actor.x, z: actor.z, intelOnly: true, oracle: terminal.id};
    }
  }
  // Allied bots then take their interact opportunity, id-sorted.
  if (state.coop) {
    const actors = (match?.actors ?? [])
      .filter(actor => actor && actor.health > 0 && actor.team === 0 && actor.bot != null)
      .sort((a, b) => a.id - b.id);
    for (const actor of actors) botTerminalInteract(match, state, actor);
  }
  return terminals;
}

/** Additive protocol-3 objective detail, shared by both terminal projections. */
export function terminalMechanicsSnapshot(state, terminal) {
  const node = nodeById(state, terminal.nodeId);
  const vault = state.terminals.vault;
  const effectRemainingSeconds = terminal.kind === 'HACK' && node?.hack
    ? Math.max(0, (node.hack.until - state.tick) * RULES.dt) : num(terminal.timer, 0);
  const reasons = {}, actions = {};
  for (const team of [0, 1]) {
    const repair = terminal.kind === 'SABOTAGE' && terminal.state === 'cut' && node?.owner === team;
    let reason = terminal.channel ? 'busy' : terminalGate(state, terminal, team, repair ? 'REPAIR' : terminal.kind);
    if (terminal.hostiles?.[team]) reason = 'contested';
    if (terminal.kind === 'DEPLOY' && reason === 'deployed' && terminal.shards?.[team] === 'ready') reason = null;
    if (terminal.kind === 'VAULT' && !reason) {
      actions[team] = [...(Object.values(vault.cargo).some(cargo => cargo.team === team) ? ['vault-store'] : []), ...((vault.byNode[terminal.nodeId]?.[team]?.length ?? 0) > 0 && num(state.flux?.[team], 0) >= TERMINAL_KINDS.VAULT.pullCost ? ['vault-pull'] : [])];
    } else actions[team] = reason ? [] : [repair ? 'repair' : terminal.kind === 'SABOTAGE' ? 'cut' : terminal.kind.toLowerCase()];
    reasons[team] = reason;
  }
  return {
    y: round(terminal.y),
    reach: terminalReach(terminal),
    purpose: {HACK: 'Double legal capture for 6s', DEPLOY: 'Install local intel; carry its shard to HQ', SABOTAGE: 'Deny the enemy supply path for 45s', VAULT: 'Bank a carried shard; spend 8 FLUX to withdraw 6 REQ'}[terminal.kind],
    phase: terminal.channel ? 'channeling' : terminal.state === 'cut' ? 'cut'
      : terminal.kind === 'HACK' && effectRemainingSeconds > 0 ? 'boosted'
      : terminal.kind === 'DEPLOY' && node?.oracle ? (node.oracle.active ? 'online' : 'offline')
      : terminal.kind === 'VAULT' ? 'bank' : 'ready',
    contested: terminal.contested === true,
    blockedReason: terminal.contested ? 'contested' : terminal.state !== 'live' ? 'terminal-state' : null,
    lastInterruptedReason: terminal.blockedReason ?? null,
    blockedReasonByTeam: reasons,
    actionsByTeam: actions,
    effectRemainingSeconds: round(effectRemainingSeconds),
    cooldownSeconds: round(terminal.kind === 'HACK' ? effectRemainingSeconds : 0),
    oracleActive: terminal.kind === 'DEPLOY' && node?.oracle?.active === true,
    resolvedTargets: terminal.kind === 'DEPLOY' ? [...(node?.oracle?.targets ?? [])] : [],
    shards: terminal.kind === 'DEPLOY' ? {...terminal.shards} : null,
    banked: terminal.kind === 'VAULT' ? {0: vault.byNode[terminal.nodeId]?.[0]?.length ?? 0, 1: vault.byNode[terminal.nodeId]?.[1]?.length ?? 0} : null,
    cargo: terminal.kind === 'VAULT' ? Object.values(vault.cargo).sort((a, b) => a.actor - b.actor).map(({actor, team, source}) => ({actor, team, source})) : [],
  };
}

/**
 * @deprecated Legacy raw-tree projection consumed by `cocs.mjs` as
 * `snapshot.cocs.terminalState`. The single UI contract is the flat, id-sorted
 * `snapshot.cocs.terminals` array (`coopTerminalSnapshot`) built from the same
 * `state.terminals.terminals` tree, plus its `stats` on `terminalStats`.
 * Kept only until the engine consumer drops the duplicate field.
 */
export function cocsTerminalsSnapshot(state) {
  const terminals = state?.terminals;
  if (!terminals) return null;
  const list = Object.keys(terminals.terminals ?? {}).sort().map(id => {
    const terminal = terminals.terminals[id];
    return {
      ...terminalMechanicsSnapshot(state, terminal),
      id,
      kind: terminal.kind,
      nodeId: terminal.nodeId,
      x: round(terminal.x),
      z: round(terminal.z),
      owner: terminal.owner,
      state: terminal.state,
      timer: round(terminal.timer),
      channel: terminal.channel ? {actor: terminal.channel.actor, action: terminal.channel.action, remaining: round(terminal.channel.remaining), total: round(terminal.channel.total)} : null,
      hackedTeam: terminal.hackedTeam,
      deployedTeam: terminal.deployedTeam,
      uses: num(terminal.uses, 0),
      hacks: num(terminal.hacks, 0),
      deploys: num(terminal.deploys, 0),
    };
  });
  return {
    tick: num(terminals.tick, 0),
    terminals: list,
    vault: {stores: num(terminals.vault?.stores, 0), pulls: num(terminals.vault?.pulls, 0), last: terminals.vault?.last ? {...terminals.vault.last} : null},
    stats: {...(terminals.stats ?? {})},
  };
}
