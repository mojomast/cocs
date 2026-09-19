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
//     at 2x for 6 s), `DEPLOY` (enable ORACLE resolution while owned) and a
//     `SABOTAGE` link (income denied until repaired);
//   * an HQ hosts `VAULT` (store a shard / pull a banked effect for 8 FLUX).
//
// Determinism: pure data, sorted iteration, one fixed tick clock, no RNG and no
// wall-clock read. The engine half (`stepCocsTerminals`) is a pure function of
// the previous state + `dt` + living actor positions. Terminals are created only
// for `cocs-coop`, so PvPvE `cocs` behaviour and snapshots stay byte-identical.
// ---------------------------------------------------------------------------

import {RULES} from './data.mjs';

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
      state: 'live',
      timer: 0,
      channel: null,
      owner: null,
      uses: 0,
      hacks: 0,
      deploys: 0,
      sabotages: 0,
      repairs: 0,
      hackedTeam: null,
      deployedTeam: null,
    };
  }
  return {
    tick: 0,
    terminals,
    vault: {stores: 0, pulls: 0, last: null, byNode: {}},
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
  return distance(actor, terminal) <= terminalReach(terminal);
}

function enemyNear(match, terminal, team, meters = 6) {
  for (const actor of match?.actors ?? []) {
    if (!actor || actor.health <= 0) continue;
    if (actor.team !== 0 && actor.team !== 1) continue;
    if (actor.team === team) continue;
    if (distance(actor, terminal) <= meters) return true;
  }
  return false;
}

function refreshOwnership(state, terminal) {
  const node = nodeById(state, terminal.nodeId);
  terminal.owner = node && (node.owner === 0 || node.owner === 1) ? node.owner : null;
  return node;
}

/** Start a terminal channel for one actor. Returns `{ok, reason}`. */
export function startTerminalChannel(match, state, terminal, actor, verb) {
  if (!terminal || !actor) return {ok: false, reason: 'missing'};
  const kind = TERMINAL_KINDS[verb];
  if (!kind) return {ok: false, reason: 'unknown-verb'};
  if (terminal.kind !== verb) return {ok: false, reason: 'wrong-terminal'};
  refreshOwnership(state, terminal);
  if (!actorAtTerminal(actor, terminal)) return {ok: false, reason: 'range'};
  if (verb === 'HACK' || verb === 'SABOTAGE') {
    if (terminal.state !== 'live') return {ok: false, reason: 'terminal-state'};
    if (enemyNear(match, terminal, actor.team)) return {ok: false, reason: 'contested'};
  }
  if (verb === 'DEPLOY' && terminal.owner !== actor.team) return {ok: false, reason: 'not-owned'};
  if (verb === 'VAULT') return {ok: false, reason: 'vault-action-required'};
  const seconds = num(kind.channelSeconds, TERMINAL_INTERACT_SECONDS);
  terminal.channel = {actor: actor.id, action: verb, remaining: seconds, total: seconds};
  state.terminals.stats.interacts = num(state.terminals.stats.interacts, 0) + 1;
  return {ok: true, reason: null};
}

function completeTerminalChannel(match, state, terminal) {
  const channel = terminal.channel;
  if (!channel) return false;
  const node = refreshOwnership(state, terminal);
  const action = channel.action;
  terminal.channel = null;
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
    state.terminals.stats.deploys = num(state.terminals.stats.deploys, 0) + 1;
    match?.emit?.('cocs-terminal-deploy', {terminal: terminal.id, node: terminal.nodeId, team: channel.team, oracle: true});
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
  const stable = actor && actor.health > 0 && actorAtTerminal(actor, terminal) && !enemyNear(match, terminal, actor.team);
  if (!stable) { terminal.channel = null; return; }
  channel.remaining = Math.max(0, num(channel.remaining, 0) - dt);
  if (!(channel.remaining > 0)) completeTerminalChannel(match, state, terminal);
}

/** Repair a cut/locked terminal (the `REPAIR` sink + the BUILDER role). */
export function repairTerminal(state, terminal) {
  if (!terminal) return false;
  if (terminal.state === 'live' && !terminal.channel) return false;
  terminal.state = 'live';
  terminal.timer = 0;
  terminal.channel = null;
  terminal.repairs = num(terminal.repairs, 0) + 1;
  state.terminals.stats.repairs = num(state.terminals.stats.repairs, 0) + 1;
  const node = nodeById(state, terminal.nodeId);
  if (node && Array.isArray(state.cuts)) state.cuts = state.cuts.filter(id => id !== node.id);
  return true;
}

/** VAULT action: `store` archives a shard (free); `pull` spends 8 FLUX. */
export function vaultAction(match, state, terminal, actor, action) {
  if (!terminal || terminal.kind !== 'VAULT' || !actor) return {ok: false, reason: 'vault'};
  if (!actorAtTerminal(actor, terminal)) return {ok: false, reason: 'range'};
  const vault = state.terminals.vault;
  if (String(action).toLowerCase() === 'store') {
    vault.stores = num(vault.stores, 0) + 1;
    terminal.uses = num(terminal.uses, 0) + 1;
    state.terminals.stats.vaultStores = num(state.terminals.stats.vaultStores, 0) + 1;
    vault.last = {action: 'store', team: actor.team, node: terminal.nodeId, tick: num(state.tick, 0)};
    match?.emit?.('cocs-terminal-vault', {terminal: terminal.id, action: 'store', team: actor.team, stores: vault.stores});
    return {ok: true, reason: null, action: 'store', cost: 0};
  }
  if (String(action).toLowerCase() !== 'pull') return {ok: false, reason: 'unknown-action'};
  const cost = num(TERMINAL_KINDS.VAULT.pullCost, 8);
  const flux = num(state.flux?.[actor.team], 0);
  if (flux + 1e-9 < cost) return {ok: false, reason: 'flux'};
  state.flux[actor.team] = flux - cost;
  state.fluxSpent[actor.team] = num(state.fluxSpent?.[actor.team], 0) + cost;
  vault.pulls = num(vault.pulls, 0) + 1;
  terminal.uses = num(terminal.uses, 0) + 1;
  state.terminals.stats.vaultPulls = num(state.terminals.stats.vaultPulls, 0) + 1;
  const req = num(TERMINAL_KINDS.VAULT.pullReq, 6);
  actor.req = num(actor.req, 0) + req;
  actor.reqEarned = num(actor.reqEarned, 0) + req;
  vault.last = {action: 'pull', team: actor.team, node: terminal.nodeId, tick: num(state.tick, 0), req};
  match?.emit?.('cocs-terminal-vault', {terminal: terminal.id, action: 'pull', team: actor.team, cost, req, pulls: vault.pulls});
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
  if (kind === 'DEPLOY') return terminal.owner === actor.team;
  if (kind === 'VAULT') return true;
  if (kind === 'HACK' || kind === 'SABOTAGE') {
    if (terminal.state !== 'live' || terminal.channel) return false;
    return !enemyNear(match, terminal, actor.team);
  }
  return false;
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
    const stored = terminalInteract(match, state, actor.id, chosen.id, 'VAULT', 'store');
    return stored.ok ? {terminalId: chosen.id, kind, action: 'store'} : null;
  }
  const started = terminalInteract(match, state, actor.id, chosen.id, kind);
  return started.ok ? {terminalId: chosen.id, kind, action: kind.toLowerCase()} : null;
}

/** Advance one fixed tick. Called by `stepCocs` in co-op only. */
export function stepCocsTerminals(match, state, dt) {
  const terminals = state?.terminals;
  if (!terminals) return null;
  terminals.tick = num(terminals.tick, 0) + 1;
  const ids = Object.keys(terminals.terminals ?? {}).sort();
  for (const id of ids) {
    const terminal = terminals.terminals[id];
    if (!terminal) continue;
    refreshOwnership(state, terminal);
    if (terminal.timer > 0) {
      terminal.timer = Math.max(0, terminal.timer - dt);
      if (terminal.timer <= 0 && terminal.state !== 'live') terminal.state = 'live';
    }
    tickTerminalChannel(match, state, terminal, dt);
  }
  // Expire the HACK window on the fixed tick clock.
  for (const node of state.nodes ?? []) {
    if (node?.hack && num(state.tick, 0) > num(node.hack.until, 0)) node.hack = null;
  }
  return terminals;
}

/** Additive, id-keyed snapshot tree for the HUD (delta-friendly). */
export function cocsTerminalsSnapshot(state) {
  const terminals = state?.terminals;
  if (!terminals) return null;
  const list = Object.keys(terminals.terminals ?? {}).sort().map(id => {
    const terminal = terminals.terminals[id];
    return {
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
