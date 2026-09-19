// ---------------------------------------------------------------------------
// LATTICE STRIKE: OPERATIONS (`cocs-coop`) — the §8.1 subagent roles and their
// combat/denial abilities.
//
// Spec authority: COCS-MODE-SPEC.md §6.5 (economy role bases), §8.1 (the five
// launch roles and the four the OPERATIONS subset fields) and
// COCS-OPERATIONS.md §3.1/§7.3 (the `HARVESTER` active prime).
//
// This module is pure data + deterministic target selection. It imports only
// the economy's upkeep table (single source of role bases) and never touches
// `Match`, a clock or an RNG. The engine wiring (`cocs-coop.mjs`) applies the
// resolved effects. Every list is sorted by id so a seeded run is
// byte-identical regardless of actor-array order.
//
// The "multi-target" contract: a role ability declares a `target` scope and the
// resolver returns **every** eligible team-0 actor / node / device in a stable
// order, not just actor 0. A friendly-scoped ability (FIGHTER `RALLY`) therefore
// buffs the whole squad, which is the co-op rule the PvPvE path never had.
// ---------------------------------------------------------------------------

import {SUBAGENT_UPKEEP} from './cocs-economy.mjs';

export const COOP_ROLE_IDS = Object.freeze(['fighter', 'harvester', 'builder', 'scout']);
// The full launch set (§8.1). PvPvE `cocs` fields the role the rung's allow-list
// publishes: 4v4 is `FIGHTER/HARVESTER/BUILDER`, 8v8 is all five. OPERATIONS
// fields the first four; SABOTEUR joins PvPvE.
export const PVP_ROLE_IDS = Object.freeze(['fighter', 'harvester', 'builder', 'scout', 'saboteur']);
// The OPERATIONS subset is the first four roles (§8.1); SABOTEUR joins PvPvE.
export const COOP_ROLES = Object.freeze({
  fighter: Object.freeze({
    id: 'fighter', name: 'Fighter', verb: 'ATTACK', combat: true,
    spawnCost: 12, upkeep: SUBAGENT_UPKEEP.fighter, health: 160, armor: 0, speed: 8.5,
    lifespanSeconds: 120, refundFraction: 0.4, radius: 12,
  }),
  harvester: Object.freeze({
    id: 'harvester', name: 'Harvester', verb: 'PRIME', combat: false,
    spawnCost: 8, upkeep: SUBAGENT_UPKEEP.harvester, health: 90, armor: 0, speed: 7.5,
    lifespanSeconds: 120, refundFraction: 0.4, radius: 10,
  }),
  builder: Object.freeze({
    id: 'builder', name: 'Builder', verb: 'REPAIR', combat: false,
    spawnCost: 10, upkeep: SUBAGENT_UPKEEP.builder, health: 120, armor: 0, speed: 7.8,
    lifespanSeconds: 120, refundFraction: 0.4, radius: 10,
  }),
  scout: Object.freeze({
    id: 'scout', name: 'Scout', verb: 'SPOT', combat: false,
    spawnCost: 7, upkeep: SUBAGENT_UPKEEP.scout, health: 80, armor: 0, speed: 9.5,
    lifespanSeconds: 90, refundFraction: 0.4, radius: 12,
  }),
  // PvP-1 (§8.1): the fifth role. Cuts an enemy supply link (SAPPER) and
  // siphons an enemy node's income into its own pool (SIPHON). 8v8-only via the
  // rung allow-list; deterministic and RNG-free. Upkeep/spawn numbers come from
  // the one economy table like every other role.
  saboteur: Object.freeze({
    id: 'saboteur', name: 'Saboteur', verb: 'ATTACK', combat: true,
    spawnCost: 14, upkeep: SUBAGENT_UPKEEP.saboteur, health: 90, armor: 0, speed: 9.0,
    lifespanSeconds: 90, refundFraction: 0.4, radius: 12,
  }),
});

export const coopRole = id => COOP_ROLES[String(id ?? '').trim().toLowerCase()] ?? null;

// ---------------------------------------------------------------------------
// Ability descriptors. `target` is the scope the resolver expands to a list:
//   `friendly` — living team-0 actors inside `radius` of the caster (multi-target)
//   `node`     — one owned capturable node id (`PRIME`/`FORTIFY`)
//   `device`   — neutral traversal devices / terminals in a non-live state
//   `enemy`    — living enemy actors inside `radius` (SPOT, multi-target)
// `verb` is the field-readable action (§8.1 "every role has a combat or denial
// verb"). `seconds`/`amounts` are pure numbers; applying them is the engine's job.
// ---------------------------------------------------------------------------
export const ROLE_ABILITIES = Object.freeze({
  fighter: Object.freeze([
    Object.freeze({id: 'rally', verb: 'RALLY', label: 'RALLY', target: 'friendly', radius: 14, shield: 40, heal: 0, seconds: 8}),
  ]),
  harvester: Object.freeze([
    Object.freeze({id: 'prime', verb: 'PRIME', label: 'PRIME', target: 'node', archetypes: Object.freeze(['economy']), seconds: 8, fluxSeconds: 30, fluxBonus: 0.5, captureSeconds: 10, captureMultiplier: 1.5}),
    Object.freeze({id: 'relay-hit', verb: 'ATTACK', label: 'SABOTAGE', target: 'enemy', radius: 3, damage: 6}),
  ]),
  builder: Object.freeze([
    Object.freeze({id: 'repair', verb: 'REPAIR', label: 'REPAIR', target: 'device', seconds: 4}),
    Object.freeze({id: 'deny', verb: 'DENY', label: 'DENY', target: 'node', radius: 10, denySeconds: 8}),
  ]),
  scout: Object.freeze([
    Object.freeze({id: 'spot', verb: 'SPOT', label: 'SPOT', target: 'enemy', radius: 12, seconds: 8, damageBonus: 0.15}),
  ]),
  // PvP-1 SABOTEUR (§8.1). `sapper` cuts one enemy supply link for a window;
  // `siphon` pulls FLUX out of an enemy node's pool. Both are field-readable
  // denial verbs, both pure numbers applied by `cocs.mjs`, and both RNG-free.
  saboteur: Object.freeze([
    Object.freeze({id: 'sapper', verb: 'ATTACK', label: 'SAPPER', target: 'node', archetypes: Object.freeze(['relay', 'economy']), enemyOnly: true, cutSeconds: 45, bountyBase: 20, bountyPerNode: 5, deniedSeconds: 6}),
    Object.freeze({id: 'siphon', verb: 'SIPHON', label: 'SIPHON', target: 'node', archetypes: Object.freeze(['relay', 'economy']), enemyOnly: true, seconds: 8, flux: 12, req: 4}),
  ]),
});

export function roleAbility(roleId, verb) {
  const list = ROLE_ABILITIES[String(roleId ?? '').trim().toLowerCase()] ?? [];
  const key = String(verb ?? '').trim().toUpperCase();
  return list.find(ability => ability.verb === key) ?? (list.length === 1 ? list[0] : null);
}

export function roleAbilities(roleId) {
  return [...(ROLE_ABILITIES[String(roleId ?? '').trim().toLowerCase()] ?? [])];
}

// All abilities whose `target` is the friendly team — the multi-target set.
export function friendlyAbilities(roleId = null) {
  const roles = roleId ? [roleId] : COOP_ROLE_IDS;
  const out = [];
  for (const role of roles) for (const ability of ROLE_ABILITIES[role] ?? []) if (ability.target === 'friendly') out.push({role, ability});
  return out;
}

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const distance = (a, b) => Math.hypot(num(a?.x, 0) - num(b?.x, 0), num(a?.z, 0) - num(b?.z, 0));
const sortedActors = actors => [...(actors ?? [])].filter(Boolean).sort((a, b) => num(a.id, 0) - num(b.id, 0));
const sortedNodes = state => [...(state?.nodes ?? [])].filter(Boolean).sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));

/**
 * Expand a role ability into its deterministic target list. Pure: it reads the
 * roster/state and returns plain ids. `friendly` is the multi-target scope.
 * `origin` is the caster (may be null for a node-scoped call).
 */
export function roleAbilityTargets(match, state, origin, ability) {
  if (!ability || typeof ability !== 'object') return [];
  const scope = ability.target ?? 'self';
  const team = origin && (origin.team === 0 || origin.team === 1) ? Number(origin.team) : 0;
  const radius = Math.max(0, num(ability.radius, 0));
  if (scope === 'friendly') {
    const list = [];
    for (const actor of sortedActors(match?.actors)) {
      if (!actor || actor.health <= 0 || actor.team !== team) continue;
      if (origin && actor.id === origin.id && ability.includeSelf !== true) continue;
      if (radius > 0 && origin && distance(origin, actor) > radius) continue;
      list.push(actor.id);
    }
    return list;
  }
  if (scope === 'enemy') {
    const list = [];
    for (const actor of sortedActors(match?.actors)) {
      if (!actor || actor.health <= 0 || actor.team === team) continue;
      if (radius > 0 && origin && distance(origin, actor) > radius) continue;
      list.push(actor.id);
    }
    return list;
  }
  if (scope === 'node') {
    const archetypes = Array.isArray(ability.archetypes) ? ability.archetypes : null;
    const list = [];
    for (const node of sortedNodes(state)) {
      if (!node) continue;
      if (node.archetype === 'hq' || node.archetype === 'array') continue;
      if (archetypes && !archetypes.includes(node.archetype)) continue;
      // `enemyOnly` (SABOTEUR) targets a node the *other* team owns; neutral
      // and own nodes are never legal.
      if (ability.enemyOnly === true) { if (node.owner !== (1 - team)) continue; }
      else if (ability.ownedByTeam !== false && node.owner !== team) continue;
      if (radius > 0 && origin) {
        const r = num(node.r, 4) + radius;
        if (distance(origin, node) > r) continue;
      }
      list.push(node.id);
    }
    return list;
  }
  if (scope === 'device') {
    const devices = state?.traversal?.devices ?? {};
    const list = [];
    for (const id of Object.keys(devices).sort()) {
      const device = devices[id];
      if (!device) continue;
      if (ability.onlyBroken !== false && device.state === 'live') continue;
      list.push(id);
    }
    // Terminals in a cut/locked state a builder fixes are their own contract.
    for (const id of Object.keys(state?.terminals?.terminals ?? {}).sort()) {
      const terminal = state.terminals.terminals[id];
      if (!terminal) continue;
      if (ability.onlyBroken !== false && terminal.state === 'live') continue;
      list.push(`terminal:${id}`);
    }
    return list;
  }
  return origin ? [origin.id] : [];
}

/** A stable, HUD-ready description of what a role ability will hit. Pure. */
export function roleAbilityPreview(match, state, origin, ability) {
  const targets = roleAbilityTargets(match, state, origin, ability);
  return {
    role: origin?.subagentRole ?? (origin?.isScout === true ? 'scout' : null),
    id: ability?.id ?? null,
    verb: ability?.verb ?? null,
    label: ability?.label ?? ability?.verb ?? null,
    scope: ability?.target ?? 'self',
    targets,
    count: targets.length,
  };
}

const cocsRoles = {
  COOP_ROLE_IDS, PVP_ROLE_IDS, COOP_ROLES, coopRole, ROLE_ABILITIES, roleAbility, roleAbilities,
  friendlyAbilities, roleAbilityTargets, roleAbilityPreview,
};

export default cocsRoles;
