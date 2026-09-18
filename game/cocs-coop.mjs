// ---------------------------------------------------------------------------
// LATTICE STRIKE: OPERATIONS (`cocs-coop`) — Director engine wiring.
//
// The Operations Director is an AI *scheduler* on team 1: a visible PRESSURE
// budget, an L4D-style BUILD_UP -> PEAK -> RELAX pacing machine, scripted
// per-wave escalations that ignore RELAX, weakest-front retargeting, and
// LoS-safe telegraphed spawns of the shipped `enemy-types.mjs` wave force.
//
// Two enemy layers (owner decision 2):
//   * a persistent **garrison** — normal team-1 bots on `cocsTeamPlan`;
//   * a non-respawning **wave force** — `singleplayer.spawnGroup` archetypes
//     tagged `isDirectorWave`, excluded from the lattice bot policy.
//
// Win = clear Wave 5 with `hq-0` intact. Lose = the Director arms dominance OR
// the operation clock expires OR the HQ siege destroys `hq-0` (owner decision 1).
//
// Determinism: one RNG (`match.random`) and exactly one documented draw point
// (the wave-5 boss alternation at run init). All lists sorted; all timers are
// tick counts at RULES.dt. Spawning goes through the tested `spawnGroup`.
// ---------------------------------------------------------------------------

import {RULES} from './data.mjs';
import {SUBAGENTS} from './cocs-economy.mjs';
import {capturableNodes, nodeById} from './cocs.mjs';
import {spawnGroup, updateEnemyRoles} from './singleplayer.mjs';
import {
  COOP_ECONOMY, COOP_PACING, COOP_SIEGE, DIRECTOR_COSTS,
  OPERATIONS_WAVE_COUNT, DEFAULT_COCS_TIER, directorTier, normalizeCocsTier,
  directorWavePlan,
} from './cocs-difficulty.mjs';
import {
  directorAccrue, directorBossType, directorCap, directorForceAlive, directorFronts,
  directorPhase, directorPickSpawn, directorRate, directorReinforcementOrder,
  directorSpend, siegeShouldArm, siegeShouldLift,
} from './cocs-director.mjs';

export const COOP_KIND = 'cocs-coop';
export const NPC_DEAD = 1e9;
export const COOP_RETARGET_SECONDS = 5;
// The live Director force cap keeps the total actor budget inside the measured
// <=24 envelope (4 garrison + 4 humans + <=14 wave force = 22).
export const COOP_WAVE_LIVE_CAP = 12;
export const COOP_EXECUTOR_LEASE_TICKS = 600; // 10 s at RULES.dt
export const COOP_THREAD_CAP = 6;

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp01 = value => Math.max(0, Math.min(1, value));
const ticks = seconds => Math.max(1, Math.round(num(seconds, 0) / (RULES.dt || 1 / 60)));
// Actor lookup by id, never by array index: the roster is not guaranteed to be
// id-indexed once other systems (scout slots, wave force) allocate ids.
const actorById = (match, id) => (match?.actors ?? []).find(actor => actor && actor.id === id) ?? null;

// ---------------------------------------------------------------------------
// State.
// ---------------------------------------------------------------------------
export function createCoopState(state, {tier = DEFAULT_COCS_TIER} = {}) {
  const tierId = normalizeCocsTier(tier);
  const data = directorTier(tierId);
  return {
    initialized: false,
    tier: tierId,
    tierLabel: data.label,
    wave: 0,
    waveCount: OPERATIONS_WAVE_COUNT,
    wavesCleared: 0,
    phase: 'intermission',
    intermission: true,
    intermissionTicks: ticks(COOP_PACING.intermissionLeadSeconds),
    phaseTicks: 0,
    waveTicks: 0,
    waveTimerTicks: 0,
    tick: 0,
    elapsed: 0,
    pressure: data.start,
    pressureSpent: 0,
    pressurePeak: data.start,
    pressureClampedTicks: 0,
    composition: {},
    modifier: null,
    label: null,
    fronts: [],
    targetNode: null,
    retargetTick: 0,
    reinforceTimer: 0,
    reinforceIndex: 0,
    reinforceOrder: [],
    eventsFired: [],
    overruns: 0,
    telegraphs: [],
    pending: [],
    lastTelegraph: null,
    nextId: 0,
    enemies: [],
    allies: [],
    groups: {},
    boss: null,
    bossId: null,
    bossType: null,
    bossRolled: false,
    bossPhase: 1,
    bossPhaseMax: 1,
    everHadEnemies: false,
    waveIds: [],
    allWaveIds: [],
    waveForceTotal: 0,
    siege: {
      hqId: COOP_SIEGE.hqId,
      health: COOP_SIEGE.maxHealth,
      max: COOP_SIEGE.maxHealth,
      armed: false,
      armedTick: 0,
      attackers: 0,
      defenders: 0,
      damage: 0,
      repairs: 0,
      dps: COOP_SIEGE.dpsPerAttacker,
      repair: COOP_SIEGE.repairPerDefender,
      radius: COOP_SIEGE.radius,
    },
    command: null,
    stats: {
      spawns: 0, spent: 0, reinforcements: 0, escalations: 0, overruns: 0,
      waveDurations: [], hqDamage: 0, hqRepairs: 0, peakPressure: data.start, clampedTicks: 0,
    },
    winner: null,
    message: null,
  };
}

// Rebuild the Director at a new tier (lobby/validator selection). Keeps the
// HQ/health so a mid-run tier change is a test-only convenience.
export function setCoopTier(state, tier) {
  const tierId = normalizeCocsTier(tier);
  const data = directorTier(tierId);
  const coop = state.coop ?? (state.coop = createCoopState(state, {tier: tierId}));
  coop.tier = tierId;
  coop.tierLabel = data.label;
  coop.pressure = data.start;
  coop.stats.peakPressure = data.start;
  coop.initialized = false;
  return coop;
}

function nextActorId(match) {
  let next = 0;
  for (const actor of match?.actors ?? []) if (num(actor?.id, -1) >= next) next = actor.id + 1;
  return next;
}

export function initCoop(match, state) {
  const coop = state.coop;
  if (!coop) return null;
  coop.nextId = Math.max(num(coop.nextId, 0), nextActorId(match));
  // The one documented RNG draw of the Operations Director: the wave-5 boss
  // alternation. Everything else is a pure function of sorted state.
  if (!coop.bossRolled) {
    coop.bossType = directorBossType(match.random());
    coop.bossRolled = true;
  }
  coop.bossPhase = directorTier(coop.tier).bossPhaseStart;
  coop.bossPhaseMax = 3;
  coop.initialized = true;
  coop.intermission = true;
  coop.phase = 'intermission';
  coop.intermissionTicks = ticks(COOP_PACING.intermissionLeadSeconds);
  match.emit?.('director-init', {tier: coop.tier, waveCount: coop.waveCount, boss: coop.bossType, hq: coop.siege.hqId});
  return coop;
}

// ---------------------------------------------------------------------------
// Command (owner decision 3): shared FLUX, per-player slice cap, rotating
// executor lease for big cards, THREADS concurrency gate. Pure reads of the
// live roster; the engine applies the gate in cocs.mjs.
// ---------------------------------------------------------------------------
export function coopHumanIds(match) {
  return (match?.actors ?? [])
    .filter(actor => actor && actor.health > 0 && actor.team === 0 && actor.isNpc !== true && actor.bot == null)
    .map(actor => actor.id)
    .sort((a, b) => a - b);
}

export function coopActiveThreads(match) {
  let used = 0;
  for (const actor of match?.actors ?? []) if (actor && actor.health > 0 && actor.isScout === true) used++;
  return used;
}

export function coopCommandState(match, state, nowTick = null) {
  const coop = state?.coop;
  if (!coop) return null;
  const tick = num(nowTick, num(coop.tick, 0));
  const humans = coopHumanIds(match);
  const sliceCount = Math.max(2, humans.length || 0) || 2;
  const flux = num(state.flux?.[0], 0);
  const allowance = Math.max(0, Math.floor(flux / sliceCount));
  const leaseSlot = Math.floor(tick / COOP_EXECUTOR_LEASE_TICKS) % Math.max(1, humans.length);
  const executor = humans.length ? humans[leaseSlot] : 'chief';
  return {
    humans: humans.length,
    slicePerPlayer: sliceCount,
    executor,
    leaseUntil: (Math.floor(tick / COOP_EXECUTOR_LEASE_TICKS) + 1) * COOP_EXECUTOR_LEASE_TICKS,
    threads: {used: coopActiveThreads(match), cap: Math.min(COOP_THREAD_CAP, (humans.length || 1) + 1)},
    slices: [{id: 0, allowance}, {id: 1, allowance}],
    flux,
  };
}

// Applies the co-op command gates to one order. Returns `{ok, reason}`.
// Big cards (SCAN) need the rotating executor lease; when no human holds it,
// the duty Chief proxies. Every spend must fit the player's FLUX slice.
export function coopOrderGate(match, state, {team, verb, peerId} = {}) {
  const coop = state?.coop;
  if (!coop) return {ok: true, reason: null};
  const command = coopCommandState(match, state);
  if (verb === 'SCAN') {
    const cost = num(SUBAGENTS?.scout?.spawnCost, 7);
    if (cost > (command.slices?.[team]?.allowance ?? Infinity)) return {ok: false, reason: 'slice'};
    const chief = String(peerId ?? '').startsWith('chief');
    if (command.humans > 0 && !chief && String(peerId) !== String(command.executor)) return {ok: false, reason: 'executor'};
  }
  return {ok: true, reason: null};
}

// ---------------------------------------------------------------------------
// Spawn adapter: a thin facade over `singleplayer.spawnGroup`. The coop object
// *is* the horde-shaped state spawnGroup expects (nextId/enemies/allies/groups/
// boss/everHadEnemies). Every returned id is tagged as Director wave force.
// ---------------------------------------------------------------------------
export function spawnDirectorGroup(match, state, spec = {}) {
  const coop = state.coop;
  if (!coop) return [];
  const request = {...spec, group: spec.group ?? `director-w${coop.wave}-${coop.stats.spawns + 1}`};
  // Recompute the id cursor from the live roster every spawn: the scout slot
  // allocates ids through its own cursor, so a cached value can collide.
  coop.nextId = Math.max(num(coop.nextId, 0), nextActorId(match));
  const ids = spawnGroup(match, coop, request, {team: 1});
  for (const id of ids) {
    const actor = actorById(match, id);
    if (!actor) continue;
    actor.isDirectorWave = true;
    actor.directorNode = spec.nodeId ?? coop.targetNode ?? null;
    actor.npcRole = actor.npcType;
    if (request.boss) {
      actor.isBoss = true;
      coop.bossId = id;
      // D1 is the tutorial tier: no summon adds, so a first-time team can focus
      // the boss. D2+ keep the summoner identity with a strict add cap. Content
      // only — no archetype HP/damage is touched.
      if (actor.npcSummon) actor.npcSummon = coop.tier === 'D1' ? null : {...actor.npcSummon, count: 1, maxAlive: 3, interval: 14};
    }
    const node = nodeById(state, actor.directorNode);
    if (node) actor.npcZone = {x: node.x, z: node.z, r: Math.max(num(node.r, 4), 8), leash: 200, kind: 'spawn'};
    coop.waveIds.push(id);
    coop.allWaveIds.push(id);
  }
  coop.waveForceTotal += ids.length;
  coop.stats.spawns += ids.length;
  if (ids.length) match.emit?.('director-spawn', {wave: coop.wave, count: ids.length, type: request.type ?? null, boss: Boolean(request.boss), node: spec.nodeId ?? coop.targetNode ?? null, ids});
  return ids;
}

// Retire dead wave actors permanently (the horde's NPC_DEAD contract). Called
// at the end of every step, after the engine's respawn loop.
export function pruneDirectorDead(match, state) {
  const coop = state.coop;
  if (!coop) return;
  for (const id of coop.allWaveIds) {
    const actor = actorById(match, id);
    if (actor && actor.health <= 0 && num(actor.dead, 0) < NPC_DEAD) {
      actor.dead = NPC_DEAD;
      actor.bot = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Telegraphed, LoS-safe scheduling.
// ---------------------------------------------------------------------------
function canSeePlayer(match, actor, point) {
  if (typeof match?.visible !== 'function') return false;
  try {
    return match.visible({x: actor.x, y: num(actor.y, 0) + num(actor.eyeHeight, 1.6), z: actor.z}, {x: point.x, y: 0.5, z: point.z}) === true;
  } catch {
    return false;
  }
}

function scheduleDirectorSpawn(match, state, spec, {nodeId, delayTicks}) {
  const coop = state.coop;
  const ticksNow = num(coop.tick, 0);
  const point = directorPickSpawn(state, match.actors, match.nav, {
    nodeId, minDistance: 23, canSee: (actor, at) => canSeePlayer(match, actor, at),
  }) ?? fallbackDirectorSpawn(state, match.actors, nodeId);
  if (!point) return false;
  const atTick = ticksNow + Math.max(1, Math.round(delayTicks ?? ticks(COOP_PACING.telegraphSeconds)));
  coop.pending.push({...spec, nodeId, point, atTick});
  coop.lastTelegraph = {kind: spec.boss ? 'boss' : 'spawn', nodeId, at: atTick, seconds: (atTick - ticksNow) * (RULES.dt || 1 / 60)};
  match.emit?.('director-spawn-telegraph', {kind: spec.boss ? 'boss' : 'spawn', wave: coop.wave, type: spec.type ?? null, count: spec.count ?? 1, node: nodeId, x: point.x, z: point.z, at: atTick, seconds: coop.lastTelegraph.seconds});
  return true;
}

// The permitted last resort: the Director's own rear anchor, only ever if it is
// >=15 m from every living team-0 actor. LoS is intentionally relaxed here (the
// rear is where the Director is allowed to stage), matching the design's
// hq-1 fallback clause.
function fallbackDirectorSpawn(state, actors, nodeId) {
  const hq = state.nodes?.find(node => node.archetype === 'hq' && node.owner === 1) ?? state.nodes?.find(node => node.id === 'hq-1');
  const point = hq ?? {x: state.nodes?.[0]?.x ?? 0, z: state.nodes?.[0]?.z ?? 0};
  for (const actor of actors ?? []) {
    if (!actor || actor.health <= 0 || actor.team !== 0) continue;
    if (Math.hypot(actor.x - point.x, actor.z - point.z) < 15) return null;
  }
  return {x: point.x, z: point.z, nodeId, radius: 8};
}

function flushPending(match, state) {
  const coop = state.coop;
  if (!coop.pending.length) return;
  const now = num(coop.tick, 0);
  const kept = [];
  for (const entry of coop.pending) {
    if (entry.atTick > now) { kept.push(entry); continue; }
    // Re-validate the staged point; re-pick or defer, never force an illegal one.
    let point = entry.point;
    const illegal = () => (match.actors ?? []).some(actor => actor && actor.health > 0 && actor.team === 0 && Math.hypot(actor.x - point.x, actor.z - point.z) < 15);
    if (illegal()) point = directorPickSpawn(state, match.actors, match.nav, {nodeId: entry.nodeId, minDistance: 23, canSee: (actor, at) => canSeePlayer(match, actor, at)}) ?? fallbackDirectorSpawn(state, match.actors, entry.nodeId);
    if (!point) { entry.atTick = now + ticks(COOP_PACING.telegraphSeconds); kept.push(entry); continue; }
    spawnDirectorGroup(match, state, {
      type: entry.type, count: entry.count, boss: entry.boss, elite: entry.elite,
      nodeId: entry.nodeId, x: point.x, z: point.z,
    });
  }
  coop.pending = kept;
}

// ---------------------------------------------------------------------------
// Targeting.
// ---------------------------------------------------------------------------
function ownedCapturableCount(state, team) {
  return capturableNodes(state).filter(node => node.owner === team).length;
}

function refreshTargets(match, state) {
  const coop = state.coop;
  const tier = directorTier(coop.tier);
  const hqOwned = nodeById(state, coop.siege.hqId)?.owner === 0;
  if (coop.siege.armed && hqOwned && coop.wave >= COOP_SIEGE.waveArm) {
    coop.fronts = [{nodeId: coop.siege.hqId, weakness: 0}];
    coop.targetNode = coop.siege.hqId;
    return;
  }
  let fronts = directorFronts(state, match.actors, {team: 1, count: tier.fronts, tier: coop.tier});
  if (!fronts.length) {
    const hq0 = nodeById(state, 'hq-0');
    const neutral = capturableNodes(state)
      .filter(node => node.owner === null || node.owner === 0)
      .sort((a, b) => (hq0 ? Math.hypot(a.x - hq0.x, a.z - hq0.z) - Math.hypot(b.x - hq0.x, b.z - hq0.z) : 0) || String(a.id).localeCompare(String(b.id)));
    fronts = neutral.slice(0, tier.fronts).map(node => ({nodeId: node.id, weakness: 0}));
  }
  if (!fronts.length) {
    const all = capturableNodes(state).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    fronts = all.slice(0, 1).map(node => ({nodeId: node.id, weakness: 0}));
  }
  coop.fronts = fronts;
  coop.targetNode = fronts[0]?.nodeId ?? null;
  retargetWaveActors(match, state);
}

// Keep the *whole* living wave force on the current front. A straggler left on
// an old node would stall the wave clear forever; the Director re-points it at
// the front every retarget (behaviour only, no stat change).
function retargetWaveActors(match, state) {
  const coop = state.coop;
  if (!coop.targetNode) return;
  const node = nodeById(state, coop.targetNode);
  for (const id of coop.allWaveIds) {
    const actor = actorById(match, id);
    if (!actor || actor.health <= 0 || actor.isDirectorWave !== true) continue;
    actor.directorNode = coop.targetNode;
    if (node) actor.npcZone = {x: node.x, z: node.z, r: Math.max(num(node.r, 4), 8), leash: 200, kind: 'spawn'};
  }
}

// ---------------------------------------------------------------------------
// Wave machine.
// ---------------------------------------------------------------------------
function startWave(match, state) {
  const coop = state.coop;
  const tier = directorTier(coop.tier);
  coop.wave += 1;
  coop.waveIds = [];
  coop.waveForceTotal = 0;
  coop.eventsFired = [];
  coop.reinforceTimer = 0;
  coop.reinforceIndex = 0;
  coop.overruns = 0;
  coop.waveTicks = 0;
  coop.phaseTicks = 0;
  coop.phase = 'build_up';
  coop.intermission = false;
  coop.targetNode = null;
  coop.fronts = [];
  refreshTargets(match, state);
  const plan = directorWavePlan(coop.wave, coop.tier);
  coop.composition = plan.composition;
  coop.modifier = plan.modifier;
  coop.label = plan.label;
  coop.waveTimerTicks = ticks(plan.timer);
  coop.reinforceOrder = directorReinforcementOrder(plan.composition);
  coop.retargetTick = num(coop.tick, 0) + ticks(COOP_RETARGET_SECONDS);
  match.emit?.('director-wave', {wave: coop.wave, waveCount: coop.waveCount, label: plan.label, modifier: plan.modifier, fronts: tier.fronts, timer: plan.timer, budget: coop.pressure, composition: {...plan.composition}, boss: Boolean(plan.boss)});
  match.emit?.('director-modifier', {wave: coop.wave, id: plan.modifier, name: String(plan.modifier).toUpperCase()});
  // The baseline force is free at wave start and staged with a telegraph.
  const order = directorReinforcementOrder(plan.composition);
  for (const entry of order) {
    const nodeId = frontsAt(coop, order.indexOf(entry));
    scheduleDirectorSpawn(match, state, {type: entry.type, count: entry.count, nodeId}, {nodeId, delayTicks: ticks(COOP_PACING.telegraphSeconds)});
  }
}

function frontsAt(coop, index) {
  const fronts = coop.fronts ?? [];
  if (!fronts.length) return coop.targetNode;
  return fronts[index % fronts.length].nodeId;
}

function clearWave(match, state) {
  const coop = state.coop;
  const tier = directorTier(coop.tier);
  coop.wavesCleared = Math.max(coop.wavesCleared, coop.wave);
  coop.stats.waveDurations.push(coop.waveTicks * (RULES.dt || 1 / 60));
  coop.pressurePeak = Math.max(coop.pressurePeak, coop.pressure);
  coop.stats.peakPressure = Math.max(coop.stats.peakPressure, coop.pressure);
  coopResupply(match, state);
  match.emit?.('director-wave-cleared', {wave: coop.wave, cleared: coop.wavesCleared, waveCount: coop.waveCount, duration: coop.waveTicks * (RULES.dt || 1 / 60), reward: rewardFor(coop, tier)});
  if (coop.wavesCleared >= coop.waveCount) {
    coop.phase = 'relax';
    coop.message = 'OPERATION COMPLETE';
    return;
  }
  coop.phase = 'intermission';
  coop.intermission = true;
  coop.intermissionTicks = ticks(tier.intermissionSeconds);
  coop.waveForceTotal = 0;
  match.emit?.('director-intermission', {wave: coop.wave, nextWave: coop.wave + 1, seconds: tier.intermissionSeconds, budget: coop.pressure});
}

function rewardFor(coop, tier) {
  return Math.round((COOP_ECONOMY.waveRewardBase + COOP_ECONOMY.waveRewardPerWave * coop.wave) * tier.rewardMultiplier);
}

export function coopResupply(match, state) {
  const coop = state.coop;
  if (!coop) return false;
  const tier = directorTier(coop.tier);
  let healed = 0;
  for (const actor of match.actors ?? []) {
    if (!actor || actor.health <= 0 || actor.team !== 0 || actor.isDirectorWave === true) continue;
    if (actor.health < actor.maxHealth) { healed += actor.maxHealth - actor.health; actor.health = actor.maxHealth; }
    if (Number.isFinite(actor.maxArmor)) actor.armor = Math.max(num(actor.armor, 0), actor.maxArmor);
  }
  const reward = rewardFor(coop, tier);
  const cap = num(state.fluxCap, COOP_ECONOMY.fluxCap);
  const before = num(state.flux?.[0], 0);
  state.flux[0] = Math.min(cap, before + reward);
  state.fluxEarned[0] = num(state.fluxEarned?.[0], 0) + Math.max(0, state.flux[0] - before);
  match.emit?.('coop-resupply', {wave: coop.wave, healed: Math.round(healed), flux: reward});
  return true;
}

// Scripted escalations ignore RELAX (design §2.3). They are free (authored).
function fireEscalation(match, state, event) {
  const coop = state.coop;
  coop.stats.escalations++;
  const nodeId = event.nodeId ?? frontsAt(coop, coop.stats.escalations);
  match.emit?.('director-escalation', {wave: coop.wave, kind: event.kind, node: nodeId});
  if (event.kind === 'REINFORCE') {
    const secondary = frontsAt(coop, 1);
    scheduleDirectorSpawn(match, state, {type: coop.wave >= 4 ? 'spitter' : 'husk', count: 2, nodeId: secondary}, {nodeId: secondary, delayTicks: ticks(1.0)});
  } else if (event.kind === 'DENIAL') {
    const econ = capturableNodes(state).filter(node => node.owner === 0 && node.archetype === 'economy').sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    const target = econ?.id ?? nodeId;
    scheduleDirectorSpawn(match, state, {type: 'sapper', count: 2, nodeId: target}, {nodeId: target, delayTicks: ticks(1.0)});
  } else if (event.kind === 'FLANK') {
    const flank = capturableNodes(state).find(node => node.id === 'front-0') ?? nodeById(state, nodeId);
    const target = flank?.id ?? nodeId;
    scheduleDirectorSpawn(match, state, {type: 'lancer', count: 1, nodeId: target}, {nodeId: target, delayTicks: ticks(0.8)});
    scheduleDirectorSpawn(match, state, {type: 'sentinel', count: 1, nodeId: target}, {nodeId: target, delayTicks: ticks(1.4)});
  } else if (event.kind === 'BOSS') {
    const target = coop.targetNode ?? nodeId;
    if (coop.bossId === null) {
      scheduleDirectorSpawn(match, state, {type: coop.bossType, count: 1, boss: true, nodeId: target}, {nodeId: target, delayTicks: ticks(3.0)});
      match.emit?.('director-boss', {wave: coop.wave, type: coop.bossType, node: target, phase: coop.bossPhase});
    }
  } else if (event.kind === 'COMBINED_ARMS') {
    const target = frontsAt(coop, 1);
    scheduleDirectorSpawn(match, state, {type: 'bulwark', count: 1, nodeId: target}, {nodeId: target, delayTicks: ticks(1.2)});
    scheduleDirectorSpawn(match, state, {type: 'mortar', count: 1, nodeId: target}, {nodeId: target, delayTicks: ticks(1.6)});
  }
}

function maybeReinforce(match, state) {
  const coop = state.coop;
  if (coop.phase !== 'build_up' && coop.phase !== 'peak') return;
  const tier = directorTier(coop.tier);
  // D1 ships the tutorial curve: baseline + scripted escalations only. D2+ add
  // periodic PRESSURE reinforcement spends (the tier table's reinforcement row).
  if ((tier.reinforceEvents ?? 0) <= 0) return;
  const live = coop.waveIds.reduce((count, id) => count + ((actorById(match, id)?.health ?? 0) > 0 ? 1 : 0), 0);
  if (live >= COOP_WAVE_LIVE_CAP) return;
  coop.reinforceTimer += RULES.dt;
  if (coop.reinforceTimer < tier.reinforceSeconds) return;
  coop.reinforceTimer = 0;
  if (!coop.reinforceOrder.length) return;
  const entry = coop.reinforceOrder[coop.reinforceIndex % coop.reinforceOrder.length];
  coop.reinforceIndex++;
  const cost = DIRECTOR_COSTS[entry.type] ?? 0;
  const remaining = directorSpend(coop.pressure, cost, directorCap(coop.tier));
  if (remaining === null) return;
  coop.pressure = remaining;
  coop.pressureSpent += cost;
  coop.stats.spent += cost;
  coop.stats.reinforcements++;
  const nodeId = frontsAt(coop, coop.stats.reinforcements);
  match.emit?.('director-reinforce', {wave: coop.wave, type: entry.type, node: nodeId, cost, budget: coop.pressure});
  scheduleDirectorSpawn(match, state, {type: entry.type, count: 1, nodeId}, {nodeId, delayTicks: ticks(COOP_PACING.telegraphSeconds)});
}

function stepWave(match, state, dt) {
  const coop = state.coop;
  coop.waveTicks += 1;
  coop.phaseTicks += 1;
  const phase = directorPhase(coop.waveTicks, coop.waveTimerTicks, false);
  if (phase !== coop.phase) {
    coop.phase = phase;
    coop.phaseTicks = 0;
    match.emit?.('director-phase', {wave: coop.wave, phase, budget: coop.pressure});
  }
  // Retarget on the fixed cadence.
  if (num(coop.tick, 0) >= num(coop.retargetTick, 0)) {
    coop.retargetTick = num(coop.tick, 0) + ticks(COOP_RETARGET_SECONDS);
    const before = coop.targetNode;
    refreshTargets(match, state);
    if (coop.targetNode !== before) match.emit?.('director-retarget', {wave: coop.wave, node: coop.targetNode, reason: 'weakest-front'});
  }
  // Scripted escalations (ignore RELAX).
  const plan = directorWavePlan(coop.wave, coop.tier);
  for (let i = 0; i < plan.events.length; i++) {
    if (coop.eventsFired[i]) continue;
    const event = plan.events[i];
    if (coop.waveTicks / Math.max(1, coop.waveTimerTicks) >= event.at) {
      coop.eventsFired[i] = true;
      fireEscalation(match, state, event);
    }
  }
  maybeReinforce(match, state);
  // Clear check.
  if (coop.waveForceTotal > 0 && coop.pending.length === 0 && !directorForceAlive(match.actors, coop.waveIds)) {
    clearWave(match, state);
    return;
  }
  // Overrun: the wave does not wait; the next wave's pressure folds in. If a
  // force is still stalled one full overrun later, the Director withdraws its
  // non-boss remnant (the operation must never lock on a wall-stuck straggler).
  if (coop.waveTicks >= coop.waveTimerTicks && directorForceAlive(match.actors, coop.waveIds)) {
    if (coop.overruns >= 1) {
      const retired = retireStalledWave(match, state);
      if (retired > 0 && !directorForceAlive(match.actors, coop.waveIds)) {
        clearWave(match, state);
        return;
      }
    } else {
      coop.waveTimerTicks += ticks(COOP_PACING.overrunSeconds);
      coop.overruns++;
      coop.stats.overruns++;
      const bonus = Math.round(dirTierRate(coop) * COOP_PACING.overrunSeconds);
      coop.pressure = Math.min(directorCap(coop.tier), coop.pressure + bonus);
      match.emit?.('director-overrun', {wave: coop.wave, bonus, budget: coop.pressure});
    }
  }
  void dt;
}

// Withdraw the non-boss remnant of a stalled wave (behaviour only). Bosses are
// never withdrawn: the wave-5 boss must be killed for the operation to complete.
function retireStalledWave(match, state) {
  const coop = state.coop;
  let retired = 0;
  for (const id of coop.waveIds) {
    const actor = actorById(match, id);
    if (!actor || actor.health <= 0 || actor.isBoss === true) continue;
    actor.health = 0;
    actor.dead = NPC_DEAD;
    actor.bot = null;
    retired++;
  }
  if (retired) match.emit?.('director-retire', {wave: coop.wave, count: retired});
  return retired;
}

function dirTierRate(coop) {
  return directorRate(coop.tier, 'peak');
}

function stepIntermission(match, state) {
  const coop = state.coop;
  coop.phaseTicks += 1;
  coop.intermissionTicks -= 1;
  if (coop.intermissionTicks <= 0) startWave(match, state);
}

// ---------------------------------------------------------------------------
// HQ siege (owner decision 1).
// ---------------------------------------------------------------------------
function stepSiege(match, state, dt) {
  const coop = state.coop;
  const siege = coop.siege;
  const owns = ownedCapturableCount(state, 1);
  if (siegeShouldArm({armed: siege.armed, wave: coop.wave, waveArm: COOP_SIEGE.waveArm, ownsCapturable: owns, armMajority: COOP_SIEGE.armMajority}) && !siege.armed) {
    siege.armed = true;
    siege.armedTick = num(coop.tick, 0);
    match.emit?.('director-siege', {wave: coop.wave, hq: siege.hqId, health: siege.health, owns});
  }
  if (siegeShouldLift({armed: siege.armed, ownsCapturable: owns, armMajority: COOP_SIEGE.armMajority})) {
    siege.armed = false;
    match.emit?.('director-siege-lifted', {wave: coop.wave, hq: siege.hqId, health: siege.health, owns});
  }
  const hq = nodeById(state, siege.hqId);
  let attackers = 0;
  let defenders = 0;
  if (hq) {
    for (const actor of match.actors ?? []) {
      if (!actor || actor.health <= 0) continue;
      if (Math.hypot(actor.x - hq.x, actor.z - hq.z) > siege.radius) continue;
      if (actor.team === 1) attackers++;
      else if (actor.team === 0 && actor.isDirectorWave !== true) defenders++;
    }
  }
  siege.attackers = attackers;
  siege.defenders = defenders;
  if (!siege.armed || siege.health <= 0) return;
  const damage = attackers * siege.dps * dt;
  const repair = defenders * siege.repair * dt;
  if (damage <= 0 && repair <= 0) return;
  const before = siege.health;
  siege.health = Math.max(0, Math.min(siege.max, siege.health - damage + repair));
  const delta = before - siege.health;
  if (delta > 0) { siege.damage += delta; coop.stats.hqDamage += delta; }
  else if (delta < 0) { siege.repairs += -delta; coop.stats.hqRepairs += -delta; }
  if (num(coop.tick, 0) % 30 === 0) {
    match.emit?.('director-hq-damage', {wave: coop.wave, hq: siege.hqId, health: Math.round(siege.health), max: siege.max, attackers, defenders, armed: siege.armed});
  }
}

// ---------------------------------------------------------------------------
// Step.
// ---------------------------------------------------------------------------
export function stepCoop(match, state, dt) {
  const coop = state?.coop;
  if (!coop || match.over) return coop;
  if (!coop.initialized) initCoop(match, state);
  coop.tick = num(coop.tick, 0) + 1;
  coop.elapsed += dt;
  coop.command = coopCommandState(match, state);
  // Dead wave force never respawns.
  pruneDirectorDead(match, state);
  // Budget accrual on the phase factor.
  const tickRate = directorRate(coop.tier, coop.phase);
  const cap = directorCap(coop.tier);
  coop.pressure = directorAccrue(coop.pressure, tickRate, dt, cap);
  if (coop.pressure >= cap - 1e-9) { coop.pressureClampedTicks++; coop.stats.clampedTicks++; }
  coop.pressurePeak = Math.max(coop.pressurePeak, coop.pressure);
  coop.stats.peakPressure = Math.max(coop.stats.peakPressure, coop.pressure);
  // Advance the wave machine.
  if (coop.phase === 'intermission') stepIntermission(match, state);
  else stepWave(match, state, dt);
  // Stage -> spawn.
  flushPending(match, state);
  // Siege + shipped enemy role abilities (boss stomp, mortar, sapper, auras).
  stepSiege(match, state, dt);
  updateEnemyRoles(match, coop, dt);
  // Boss summons arrive through `updateEnemyRoles`' own `spawnGroup` call. Tag
  // them as Director bodies (so they never capture the lattice) without adding
  // them to the wave-clear list: the wave is defined by its authored force.
  for (const actor of match.actors ?? []) {
    if (actor && actor.isNpc === true && actor.team === 1 && actor.isDirectorWave !== true) {
      actor.isDirectorWave = true;
      actor.directorNode = coop.targetNode ?? null;
    }
  }
  // Snapshot breadcrumbs.
  coop.front = coop.targetNode;
  return coop;
}

// ---------------------------------------------------------------------------
// Outcome. Win before the clock; lose to dominance, the clock, or the HQ.
// ---------------------------------------------------------------------------
export function coopOutcome(match, state) {
  const coop = state?.coop;
  if (!coop) return null;
  if (coop.siege.health <= 0) return {winner: 1, reason: 'hq-destroyed'};
  if (coop.wavesCleared >= coop.waveCount) {
    const hq = nodeById(state, coop.siege.hqId);
    if (!hq || hq.owner === 0) return {winner: 0, reason: 'operation-complete'};
    return {winner: 1, reason: 'hq-lost'};
  }
  const dominance = state.dominance;
  if (dominance && dominance.team === 1 && dominance.progress >= dominance.target) return {winner: 1, reason: 'dominance'};
  const limit = Math.max(1, num(match?.config?.timeLimit, RULES.timeLimit));
  if (num(match?.time, 0) >= limit) return {winner: 1, reason: 'operation-failed'};
  return null;
}

// ---------------------------------------------------------------------------
// Snapshot (`cocs.director`).
// ---------------------------------------------------------------------------
function phaseSecondsRemaining(coop) {
  if (coop.phase === 'intermission') return coop.intermissionTicks * (RULES.dt || 1 / 60);
  return Math.max(0, (coop.waveTimerTicks - coop.waveTicks) * (RULES.dt || 1 / 60));
}

export function cocsDirectorSnapshot(match, state) {
  const coop = state?.coop;
  if (!coop) return null;
  const budgetRate = directorRate(coop.tier, coop.phase);
  const siege = coop.siege;
  return {
    tier: coop.tier,
    tierLabel: coop.tierLabel,
    phase: coop.phase,
    wave: coop.wave,
    waveCount: coop.waveCount,
    waveLabel: coop.label,
    modifier: coop.modifier,
    budget: {
      current: Math.round(coop.pressure * 100) / 100,
      spent: Math.round(coop.pressureSpent * 100) / 100,
      rate: Math.round(budgetRate * 100) / 100,
      cap: directorCap(coop.tier),
      peak: Math.round(coop.pressurePeak * 100) / 100,
    },
    composition: {...coop.composition},
    fronts: (coop.fronts ?? []).map(front => ({nodeId: front.nodeId, strength: Math.round(front.weakness * 100) / 100})),
    waveEndsAt: num(coop.tick, 0) + Math.max(0, coop.waveTimerTicks - coop.waveTicks),
    nextWaveAt: coop.phase === 'intermission' ? num(coop.tick, 0) + Math.max(0, coop.intermissionTicks) : num(coop.tick, 0) + Math.max(0, coop.waveTimerTicks - coop.waveTicks),
    secondsRemaining: Math.round(phaseSecondsRemaining(coop) * 10) / 10,
    telegraph: coop.lastTelegraph ? {...coop.lastTelegraph} : null,
    boss: coop.bossId !== null ? {actorId: coop.bossId, type: coop.bossType, phase: coop.bossPhase} : null,
    retarget: coop.targetNode ? {nodeId: coop.targetNode, reason: coop.siege.armed ? 'siege' : 'weakest-front'} : null,
    pressure: clamp01(coop.pressure / Math.max(1, directorCap(coop.tier))),
    siege: {
      armed: siege.armed === true,
      hqId: siege.hqId,
      health: Math.round(siege.health),
      max: siege.max,
      percent: Math.round(clamp01(siege.health / siege.max) * 1000) / 1000,
      attackers: siege.attackers,
      defenders: siege.defenders,
      damage: Math.round(siege.damage),
      repairs: Math.round(siege.repairs),
    },
    stats: {
      wavesCleared: coop.wavesCleared,
      spawns: coop.stats.spawns,
      spent: Math.round(coop.stats.spent * 100) / 100,
      reinforcements: coop.stats.reinforcements,
      escalations: coop.stats.escalations,
      overruns: coop.stats.overruns,
      peakPressure: Math.round(coop.stats.peakPressure * 100) / 100,
    },
  };
}

export function cocsCoopSnapshot(match, state) {
  const coop = state?.coop;
  if (!coop) return null;
  const forceAlive = coop.waveIds.reduce((count, id) => count + ((actorById(match, id)?.health ?? 0) > 0 ? 1 : 0), 0);
  const command = coopCommandState(match, state);
  return {
    coop: true,
    tier: coop.tier,
    director: cocsDirectorSnapshot(match, state),
    waves: {
      cleared: coop.wavesCleared,
      par: coop.waveCount,
      forceAlive,
      forceTotal: coop.waveForceTotal,
      current: coop.wave,
      overruns: coop.stats.overruns,
    },
    command: command ? {
      humans: command.humans,
      slicePerPlayer: command.slicePerPlayer,
      executor: command.executor,
      leaseUntil: command.leaseUntil,
      threads: {...command.threads},
      slices: command.slices.map(entry => ({...entry})),
    } : null,
    bonus: [],
  };
}

export function coopKillReport(match, state) {
  const coop = state?.coop;
  if (!coop) return null;
  return {
    tier: coop.tier,
    wavesCleared: coop.wavesCleared,
    waveDurations: [...coop.stats.waveDurations],
    peakPressure: coop.stats.peakPressure,
    hqDamage: Math.round(coop.stats.hqDamage),
    hqRepairs: Math.round(coop.stats.hqRepairs),
    sieges: coop.siege.armed ? 1 : 0,
  };
}
