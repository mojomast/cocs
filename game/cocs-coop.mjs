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
import {SUBAGENTS, convertCoopReq, reqItem, reqPurchase} from './cocs-economy.mjs';
import {addActorReq, capturableNodes, compareCocsOrders, connectivityIncome, cutLink, nodeById, repairLink} from './cocs.mjs';
import {deviceInteract} from './cocs-traversal.mjs';
import {spawnGroup, updateEnemyRoles} from './singleplayer.mjs';
import {
  COOP_AUTO_SPEND, COOP_BONUS_ORDER, COOP_DENIAL, COOP_ECONOMY, COOP_PACING,
  COOP_RESERVE, COOP_REWARDS, COOP_SIEGE, COOP_SINK_ORDER, COOP_SINKS, DIRECTOR_COSTS,
  OPERATIONS_WAVE_COUNT, DEFAULT_COCS_TIER, bonusObjective, coopSink, directorTier,
  directorTierCopy, normalizeCocsTier, directorWavePlan,
} from './cocs-difficulty.mjs';
import {
  directorAccrue, directorBossType, directorCap, directorForceAlive, directorFronts,
  directorPhase, directorPickSpawn, directorRate, directorReinforcementOrder,
  directorSpend, siegeShouldArm, siegeShouldLift,
} from './cocs-director.mjs';
import {COOP_ROLES, coopRole, roleAbility, roleAbilityTargets} from './cocs-roles.mjs';
import {TERMINAL_KINDS, repairTerminal, terminalInteract, vaultAction} from './cocs-terminals.mjs';

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
    intermissionOpen: false,
    intermissionTicks: ticks(COOP_PACING.intermissionLeadSeconds),
    phaseTicks: 0,
    // --- O1b intermission spend window ------------------------------------
    pendingSpends: [],
    spendLog: [],
    spendStats: {FORTIFY: 0, REPAIR: 0, RESUPPLY: 0, REINFORCE: 0, flux: 0, windows: 0},
    fortify: {},                 // nodeId -> {resist, untilWave}
    threadBonus: 0,
    squadIds: [],
    autoSpend: COOP_AUTO_SPEND.enabled,
    // --- O1b bonus objectives ---------------------------------------------
    bonus: {
      queue: [],
      open: [],
      state: [],                 // {id,label,state:'open'|'done'|'failed',progress,target}
      done: [],
      failed: [],
      flux: 0,
      req: 0,
      commendations: 0,
    },
    bonusHoldTicks: 0,
    gateLost: false,
    // --- O1c D3/D4 denial mechanics ---------------------------------------
    hardenedNodeId: null,
    denial: null,
    // --- O1b optional team-wipe RESERVE -----------------------------------
    reserve: {enabled: COOP_RESERVE.enabled, tickets: COOP_RESERVE.start, wipeTicks: 0, burns: 0},
    rewards: null,
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
    // --- N1 command board wire state (design §5.1, §11.6) ------------------
    // Commander seat/vote/route/policy are sim state: they are stepped on the
    // fixed clock, snapshotted through `cocsCoopSnapshot` and survive a
    // reconnect. `commandOrdersOptOut` is per actor (personal REQ order feed).
    commandSeat: {0: null, 1: null},
    commandVotes: {0: {}, 1: {}},
    commandRoute: {0: null, 1: null},
    commandPolicy: {0: null, 1: null},
    commandOrdersOptOut: {},
    // --- O1c per-player command gates -------------------------------------
    // Per-player spend is tracked for UI `remaining` and telemetry only; the
    // gate itself is the published cap check (`cost <= floor(flux/slices)`),
    // not a separate wallet. Reset at each wave start / intermission.
    commandSpent: {wave: 0, byPeer: {}, flux: 0},
    leaseRequests: [],
    pendingLease: null,
    // --- O1c subagents (roles) + role abilities ---------------------------
    subagents: {},                 // id -> {id, role, team, spawnedTick, nodeId}
    subagentIds: [],
    subagentStats: {spawned: 0, killed: 0, expired: 0, byRole: {fighter: 0, harvester: 0, builder: 0, scout: 0}},
    roleStats: {primes: 0, primeCompletions: 0, rallies: 0, repairs: 0, spots: 0},
    stats: {
      spawns: 0, spent: 0, reinforcements: 0, escalations: 0, overruns: 0,
      waveDurations: [], hqDamage: 0, hqRepairs: 0, peakPressure: data.start, clampedTicks: 0,
      fluxPinnedTicks: 0, reserveBurns: 0, partialPayouts: 0,
    },
    windowSpend: {FORTIFY: 0, REPAIR: 0, RESUPPLY: 0, REINFORCE: 0},
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
  // Bonus/queue and the tier's simultaneous-open budget are tier data, so a
  // mid-run tier change rebuilds them deterministically.
  coop.bonus = {queue: [], open: [], state: [], done: [], failed: [], flux: 0, req: 0, commendations: 0};
  coop.bonusHoldTicks = 0;
  coop.gateLost = false;
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
  coop.reserve.enabled = match?.config?.objective?.reserve === true || match?.config?.coopReserve === true || coop.reserve.enabled === true;
  if (!coop.bonus.queue.length && !coop.bonus.open.length && !coop.bonus.state.length) coop.bonus.queue = [...COOP_BONUS_ORDER];
  openBonuses(match, coop);
  match.emit?.('director-init', {tier: coop.tier, waveCount: coop.waveCount, boss: coop.bossType, hq: coop.siege.hqId});
  return coop;
}

// ---------------------------------------------------------------------------
// Command (owner decision 3): shared FLUX, per-player slice cap, rotating
// executor lease for big cards, THREADS concurrency gate. Pure reads of the
// live roster; the engine applies the gate in cocs.mjs and `coopSpend` applies
// it to the between-wave window.
// ---------------------------------------------------------------------------
// Big cards draw from the whole pool but need the rotating EXECUTOR lease
// (design §5.2). `SCAN` is the only big card at O1c; `REINFORCE` is the big
// between-wave sink (it consumes a THREAD). PvPvE never consults either set.
export const COOP_BIG_CARDS = Object.freeze(['SCAN']);
export const COOP_BIG_SINKS = Object.freeze(['REINFORCE']);

export function coopHumanIds(match) {
  return (match?.actors ?? [])
    .filter(actor => actor && actor.health > 0 && actor.team === 0 && actor.isNpc !== true && actor.bot == null)
    .map(actor => actor.id)
    .sort((a, b) => a - b);
}

/** Living team-0 humans as `{id, name}` (deterministic id order). */
export function coopHumans(match) {
  return (match?.actors ?? [])
    .filter(actor => actor && actor.health > 0 && actor.team === 0 && actor.isNpc !== true && actor.bot == null)
    .map(actor => ({id: actor.id, name: actor.name ?? `P${actor.id}`}))
    .sort((a, b) => a.id - b.id);
}

export function coopActiveThreads(match) {
  let used = 0;
  for (const actor of match?.actors ?? []) {
    if (!actor || actor.health <= 0) continue;
    if (actor.isSubagent === true || actor.isScout === true) used++;
  }
  return used;
}

// `slices = max(2, humans)` — the published per-player spend cap divisor.
export function coopSliceCount(humanCount) {
  return Math.max(2, Math.max(0, Math.round(num(humanCount, 0))));
}

// The rotating executor. A recorded lease request wins the next rotation for
// the requesting human (deterministic: earliest request tick, then peer id).
export function coopExecutorId(humans, coop, tick) {
  if (!humans.length) return 'chief';
  const start = Math.floor(tick / COOP_EXECUTOR_LEASE_TICKS);
  const slot = start % humans.length;
  const requests = [...(coop?.leaseRequests ?? [])]
    .filter(entry => entry && entry.tick <= start * COOP_EXECUTOR_LEASE_TICKS)
    .sort((a, b) => num(a.tick, 0) - num(b.tick, 0) || String(a.peerId).localeCompare(String(b.peerId)));
  for (const request of requests) {
    const id = humans.find(human => String(human) === String(request.peerId));
    if (id !== undefined) return id;
  }
  return humans[slot];
}

export function coopCommandState(match, state, nowTick = null) {
  const coop = state?.coop;
  if (!coop) return null;
  const tick = nowTick === null || nowTick === undefined ? num(coop.tick, 0) : num(nowTick, num(coop.tick, 0));
  const humans = coopHumanIds(match);
  const sliceCount = coopSliceCount(humans.length);
  const flux = num(state.flux?.[0], 0);
  const allowance = Math.max(0, Math.floor(flux / sliceCount));
  const spent = coop.commandSpent?.byPeer ?? {};
  const leaseStart = Math.floor(tick / COOP_EXECUTOR_LEASE_TICKS);
  const executor = coopExecutorId(humans, coop, tick);
  const slices = humans.length
    ? humans.map(id => {
      const byPlayer = Math.max(0, num(spent[String(id)], 0));
      return {id, allowance, remaining: Math.max(0, allowance - byPlayer), spent: byPlayer};
    })
    : [{id: 'chief', allowance: flux, remaining: flux, spent: 0}];
  return {
    humans: humans.length,
    slicePerPlayer: sliceCount,
    executor,
    leaseUntil: (leaseStart + 1) * COOP_EXECUTOR_LEASE_TICKS,
    threads: {used: coopActiveThreads(match), cap: Math.min(COOP_THREAD_CAP, humans.length + 1 + num(coop.threadBonus, 0))},
    slices,
    lease: {
      executor,
      until: (leaseStart + 1) * COOP_EXECUTOR_LEASE_TICKS,
      start: leaseStart * COOP_EXECUTOR_LEASE_TICKS,
      slot: humans.length ? leaseStart % humans.length : null,
      humans: humans.length,
      chief: humans.length === 0,
      requestable: humans.length > 1,
      requests: [...(coop.leaseRequests ?? [])].map(entry => ({peerId: String(entry.peerId), tick: num(entry.tick, 0)})),
    },
    flux,
    // N1 command board state, projected from the sim (deterministic + replay safe).
    seat: {0: coop.commandSeat?.[0] ?? null, 1: coop.commandSeat?.[1] ?? null},
    votes: {
      0: Object.keys(coop.commandVotes?.[0] ?? {}).filter(peer => coop.commandVotes[0][peer] === true).sort(),
      1: Object.keys(coop.commandVotes?.[1] ?? {}).filter(peer => coop.commandVotes[1][peer] === true).sort(),
    },
    route: {0: coop.commandRoute?.[0] ?? null, 1: coop.commandRoute?.[1] ?? null},
    policy: {0: coop.commandPolicy?.[0] ?? null, 1: coop.commandPolicy?.[1] ?? null},
  };
}

/** Record a lease request from a player; granted at the next rotation. */
export function coopRequestLease(state, peerId, tick = null) {
  const coop = state?.coop;
  if (!coop || peerId === null || peerId === undefined) return false;
  const requests = coop.leaseRequests ?? (coop.leaseRequests = []);
  const at = num(tick, num(coop.tick, 0));
  const existing = requests.find(entry => String(entry.peerId) === String(peerId));
  if (existing) { existing.tick = at; return true; }
  requests.push({peerId: String(peerId), tick: at});
  requests.sort((a, b) => num(a.tick, 0) - num(b.tick, 0) || String(a.peerId).localeCompare(String(b.peerId)));
  return true;
}

function commandPeerGate(command, {peerId}) {
  const id = String(peerId ?? '');
  const chief = id.startsWith('chief');
  const human = command.slices.find(entry => String(entry.id) === id) ?? null;
  if (command.humans > 0 && !chief && !human) return {human: null, chief, reject: 'executor'};
  return {human, chief, reject: null};
}

// Applies the co-op command gates to one order. Returns `{ok, reason}`.
// Big cards (SCAN) need the rotating executor lease; when no human holds it,
// the duty Chief proxies. Every spend must fit the player's FLUX slice.
export function coopOrderGate(match, state, {verb, peerId} = {}) {
  const coop = state?.coop;
  if (!coop) return {ok: true, reason: null};
  const command = coopCommandState(match, state);
  const gate = commandPeerGate(command, {peerId});
  if (gate.reject) return {ok: false, reason: gate.reject};
  const key = String(verb ?? '').toUpperCase();
  if (COOP_BIG_CARDS.includes(key)) {
    const cost = key === 'SCAN' ? num(SUBAGENTS?.scout?.spawnCost, 7) : 0;
    if (command.humans > 0 && !gate.chief && String(peerId) !== String(command.executor)) return {ok: false, reason: 'executor'};
    if (gate.human && cost > gate.human.allowance) return {ok: false, reason: 'slice'};
    if (!gate.human && command.humans === 0 && cost > command.flux) return {ok: false, reason: 'slice'};
  }
  return {ok: true, reason: null};
}

// The between-wave equivalent of `coopOrderGate`: the same slice + lease gates
// applied to a sink spend. Unknown/Chief peers fall back to the pooled path.
export function coopSpendGate(match, state, {verb, peerId} = {}) {
  const coop = state?.coop;
  if (!coop) return {ok: false, reason: 'no-coop'};
  const sink = coopSink(verb);
  if (!sink) return {ok: false, reason: 'unknown-sink'};
  const command = coopCommandState(match, state);
  const gate = commandPeerGate(command, {peerId});
  if (gate.reject) return {ok: false, reason: gate.reject};
  if (COOP_BIG_SINKS.includes(sink.id) && command.humans > 0 && !gate.chief && String(peerId) !== String(command.executor)) {
    return {ok: false, reason: 'executor'};
  }
  if (gate.human && sink.cost > gate.human.allowance) return {ok: false, reason: 'slice'};
  return {ok: true, reason: null};
}

function noteCommandSpend(coop, peerId, cost) {
  const id = String(peerId ?? '');
  if (!id || id.startsWith('chief')) return;
  coop.commandSpent ??= {wave: num(coop.wave, 0), byPeer: {}, flux: 0};
  coop.commandSpent.byPeer[id] = num(coop.commandSpent.byPeer[id], 0) + Math.max(0, num(cost, 0));
  coop.commandSpent.flux = num(coop.commandSpent.flux, 0) + Math.max(0, num(cost, 0));
}

function resetCommandSpend(coop) {
  coop.commandSpent = {wave: num(coop.wave, 0), byPeer: {}, flux: 0};
}


// ---------------------------------------------------------------------------
// O1b intermission spend window + FLUX sinks (design §3.3).
//
// The window is the between-wave `intermission` phase *after* at least one wave
// has been cleared (the pre-wave-1 deploy beat is not a spend window). Every
// spend is a `{tick, peerId, cardId, verb, target}` record that is queued on
// `coop.pendingSpends`, sorted by the same `(tick, peerId, cardId)` comparator as
// an order, and applied by `coopSpend`. Effects route through the shipped
// economy helpers (team FLUX debit, `addActorReq`, `repairLink`) — no parallel
// currency. `coopAutoSpend` lets a no-UI / AI-seat team exercise the sinks
// deterministically so FLUX no longer pins at the cap.
// ---------------------------------------------------------------------------
export function intermissionOpen(coop) {
  return Boolean(coop && coop.phase === 'intermission' && coop.intermissionOpen === true);
}

const CAPTURABLE_SINK_TARGETS = Object.freeze(['front', 'economy', 'relay']);

function sinkTargetValid(state, sink, target) {
  if (sink.target === 'node') {
    const node = nodeById(state, target);
    return Boolean(node && node.owner === 0 && CAPTURABLE_SINK_TARGETS.includes(node.archetype));
  }
  if (sink.target === 'hq') return nodeById(state, COOP_SIEGE.hqId) !== null;
  return true;
}

function repairOneDevice(state) {
  const devices = state?.traversal?.devices;
  if (!devices) return false;
  for (const id of Object.keys(devices).sort()) {
    const device = devices[id];
    if (device && device.state === 'cut') {
      device.state = 'live';
      device.timer = 0;
      return true;
    }
  }
  return false;
}

// O1c REPAIR depth: also bring a cut/locked terminal back and force an owned
// forward depot's loaner to respawn (the traversal step does the spawn work on
// the next tick, so this stays deterministic and allocation-free).
function repairOneTerminal(state) {
  const terminals = state?.terminals?.terminals;
  if (!terminals) return false;
  for (const id of Object.keys(terminals).sort()) {
    const terminal = terminals[id];
    if (terminal && terminal.state !== 'live') return repairTerminal(state, terminal);
  }
  return false;
}

function restoreDepotLoaner(state) {
  const depots = state?.traversal?.depots;
  const vehicles = state?.vehicles;
  if (!depots) return false;
  for (const id of Object.keys(depots).sort()) {
    const depot = depots[id];
    if (!depot || depot.owner !== 0 || depot.hq === true) continue;
    const vehicle = depot.vehicleId != null ? (vehicles ?? []).find(entry => entry && entry.id === depot.vehicleId) : null;
    if (vehicle && vehicle.health > 0) continue;
    depot.vehicleId = null;
    depot.respawn = 0;
    return true;
  }
  return false;
}

function applySink(match, state, sink, target, opts = {}) {
  const coop = state.coop;
  if (sink.verb === 'FORTIFY') {
    const node = nodeById(state, target);
    if (!node) return;
    node.captureResist = sink.captureResist;
    node.fortifiedWave = coop.wave;
    coop.fortify[node.id] = {resist: sink.captureResist, untilWave: coop.wave + Math.max(1, sink.waves), atTick: num(coop.tick, 0)};
    return;
  }
  if (sink.verb === 'REPAIR') {
    const before = coop.siege.health;
    coop.siege.health = Math.min(coop.siege.max, coop.siege.health + Math.max(0, num(sink.hqHeal, 0)));
    coop.stats.hqRepairs = num(coop.stats.hqRepairs, 0) + Math.max(0, coop.siege.health - before);
    const cut = [...(state.cuts ?? [])].sort((a, b) => String(a).localeCompare(String(b)))[0];
    if (cut) repairLink(state, cut);
    repairOneDevice(state);
    // O1c: terminals and depot loaners are part of "REPAIR a damaged terminal".
    repairOneTerminal(state);
    restoreDepotLoaner(state);
    return;
  }
  if (sink.verb === 'RESUPPLY') {
    const reqMult = num(state.reqMult, 1);
    for (const actor of match.actors ?? []) {
      if (!actor || actor.health <= 0 || actor.team !== 0 || actor.isDirectorWave === true) continue;
      if (actor.health < actor.maxHealth) actor.health = actor.maxHealth;
      if (Number.isFinite(actor.maxArmor)) actor.armor = Math.max(num(actor.armor, 0), actor.maxArmor);
      // Refill the ammo belt (the horde `resupplyHorde` pattern): only slots the
      // actor already carries, or its active weapon, and never an infinite one.
      if (Array.isArray(actor.ammo)) {
        for (let index = 0; index < actor.ammo.length; index++) {
          const amount = actor.ammo[index];
          if (amount === Infinity) continue;
          if (index !== actor.weapon && !(amount > 0)) continue;
          const cap = match?.weaponForIndex?.(actor, index)?.cap;
          if (Number.isFinite(cap)) actor.ammo[index] = cap;
        }
      }
      addActorReq(actor, Math.max(0, num(sink.req, 0)) * reqMult);
    }
    return;
  }
  if (sink.verb === 'REINFORCE') {
    spawnCoopSquad(match, state, {role: opts.role});
    coop.threadBonus = Math.min(COOP_THREAD_CAP, num(coop.threadBonus, 0) + Math.max(0, num(sink.threads, 0)));
  }
}

/** Apply one validated intermission spend. Returns `{ok, reason}`. */
export function coopSpend(match, state, spend = {}) {
  const coop = state?.coop;
  if (!coop) return {ok: false, reason: 'no-coop'};
  const verb = String(spend.verb ?? spend.id ?? '').trim().toUpperCase();
  const sink = coopSink(verb);
  if (!sink) return {ok: false, reason: 'unknown-sink'};
  if (!intermissionOpen(coop)) return {ok: false, reason: 'window-closed'};
  const target = spend.target ?? null;
  if (!sinkTargetValid(state, sink, target)) return {ok: false, reason: 'target'};
  // O1c per-player gate: slice cap + executor lease for big sinks. The duty
  // Chief (no humans, or a `chief-*` peer) proxies on the pooled path.
  const gate = coopSpendGate(match, state, {verb, peerId: spend.peerId});
  if (!gate.ok) return {ok: false, reason: gate.reason};
  const flux = num(state.flux?.[0], 0);
  if (flux + 1e-9 < sink.cost) return {ok: false, reason: 'flux'};
  applySink(match, state, sink, target, {role: spend.role});
  state.flux[0] = flux - sink.cost;
  state.fluxSpent[0] = num(state.fluxSpent?.[0], 0) + sink.cost;
  noteCommandSpend(coop, spend.peerId, sink.cost);
  coop.spendStats[verb] = num(coop.spendStats[verb], 0) + 1;
  coop.spendStats.flux = num(coop.spendStats.flux, 0) + sink.cost;
  coop.windowSpend[verb] = num(coop.windowSpend[verb], 0) + 1;
  coop.spendLog.push({
    tick: num(spend.tick, coop.tick), peerId: String(spend.peerId ?? ''), cardId: String(spend.cardId ?? ''),
    verb, cost: sink.cost, target: target === null ? null : String(target), ok: true,
  });
  match.emit?.('coop-spend', {wave: coop.wave, verb, cost: sink.cost, target, budget: Math.round(num(state.flux[0], 0) * 100) / 100});
  return {ok: true, reason: null, verb, cost: sink.cost, target};
}

/** Drain queued spends in the deterministic `(tick, peerId, cardId)` order. */
export function processCocsSpends(match, state) {
  const coop = state?.coop;
  if (!coop) return 0;
  const queued = (coop.pendingSpends ?? []).splice(0, coop.pendingSpends.length);
  queued.sort(compareCocsOrders);
  let applied = 0;
  for (const spend of queued) {
    if (!spend || typeof spend !== 'object') continue;
    if (!Number.isFinite(spend.tick)) spend.tick = num(coop.tick, 0);
    const result = coopSpend(match, state, spend);
    if (result.ok) { applied++; continue; }
    coop.spendLog.push({
      tick: num(spend.tick, coop.tick), peerId: String(spend.peerId ?? ''), cardId: String(spend.cardId ?? ''),
      verb: String(spend.verb ?? spend.id ?? '').toUpperCase(), cost: coopSink(spend.verb)?.cost ?? null,
      target: spend.target ?? null, ok: false, reason: result.reason,
    });
  }
  return applied;
}

// Friendly squad bot (REINFORCE). A normal AI ally on team 0, so the shipped
// bot brain and `cocsTeamPlan` drive it; it never captures for the Director and
// never counts as wave force. Capped so the actor budget stays ≤ 24.
//
// O1c: an optional `role` (`fighter|harvester|builder|scout`) selects the
// §8.1 role envelope and registers the actor on the co-op subagent roster so
// THREADS, upkeep and the role abilities all read one list.
export function spawnCoopSquad(match, state, {role = 'fighter'} = {}) {
  const coop = state?.coop;
  if (!coop) return null;
  const cap = Math.max(0, Math.round(num(COOP_SINKS.REINFORCE.squadCap, 1)));
  const live = (coop.squadIds ?? []).filter(id => (actorById(match, id)?.health ?? 0) > 0).length;
  if (live >= cap) return null;
  const def = coopRole(role) ?? COOP_ROLES.fighter;
  const id = nextActorId(match);
  const actor = match.actor(id, 'chatgpt', 'openclaw');
  actor.team = 0;
  actor.isCoopSquad = true;
  actor.isSubagent = true;
  actor.subagentRole = def.id;
  actor.subagentTick = num(coop.tick, 0);
  actor.name = def.name;
  if (!actor.bot) actor.bot = {route: [], think: 0, target: -1, memory: 0, reaction: 0, stuck: 0, last: {x: 0, y: 0, z: 0}, state: 'roam', patrol: 0, flank: null, flankDone: false, recover: 0, suppressed: 0, threat: -1, standoff: null, strafeReverse: -99};
  match.actors.push(actor);
  match.spawn(actor);
  // `spawn()` re-derives maxHealth from the class loadout; apply the role
  // envelope afterwards so the §8.1 numbers win.
  actor.maxHealth = def.health;
  actor.health = actor.maxHealth;
  coop.squadIds.push(id);
  coop.subagentIds.push(id);
  coop.subagents[id] = {id, role: def.id, team: 0, spawnedTick: num(coop.tick, 0), nodeId: null};
  coop.subagentStats.spawned = num(coop.subagentStats.spawned, 0) + 1;
  coop.subagentStats.byRole[def.id] = num(coop.subagentStats.byRole[def.id], 0) + 1;
  match.emit?.('coop-reinforce', {wave: coop.wave, actor: id, squad: live + 1, cap, role: def.id});
  return id;
}

// ---------------------------------------------------------------------------
// O1c subagents (roles): upkeep + the active prime. A co-op subagent is any
// team-0 actor tagged `isSubagent` (a REINFORCE squad) or the team-0 scout. The
// §6.5 superlinear supply load is applied by slot (id-sorted), so the 4th–6th
// agent is genuinely expensive.
// ---------------------------------------------------------------------------
export function coopSubagentActors(match, coop) {
  const ids = new Set([...(coop?.subagentIds ?? [])]);
  for (const actor of match?.actors ?? []) {
    if (actor && actor.health > 0 && (actor.isSubagent === true || actor.isScout === true)) ids.add(actor.id);
  }
  return [...ids].sort((a, b) => a - b).map(id => actorById(match, id)).filter(actor => actor && actor.health > 0);
}

function stepCoopSubagents(match, state, dt) {
  const coop = state.coop;
  // The team-0 scout's upkeep already rides the `stepCocs` scout lifecycle, so
  // only the REINFORCE squad roles are charged here (no double drain).
  const actors = coopSubagentActors(match, coop).filter(actor => actor.isScout !== true);
  let upkeep = 0;
  for (let index = 0; index < actors.length; index++) {
    const actor = actors[index];
    const role = actor.subagentRole ?? (actor.isScout === true ? 'scout' : 'fighter');
    const home = (state.nodes ?? []).find(node => node.archetype === 'hq' && node.owner === 0) ?? null;
    const target = nodeById(state, actor.subagentNode ?? coop.targetNode ?? null);
    const hops = home && target ? Math.max(0, Math.round(Math.hypot(home.x - target.x, home.z - target.z) / 62)) : 0;
    const perSecond = subagentUpkeepFor(role, index + 1, {hops});
    upkeep += perSecond;
    const drain = perSecond * dt;
    if (num(state.flux?.[0], 0) >= drain) {
      state.flux[0] = num(state.flux?.[0], 0) - drain;
      actor.subagentIdle = false;
    } else {
      state.flux[0] = 0;
      actor.subagentIdle = true;
    }
  }
  // The scout's own upkeep already rides the scout lifecycle; avoid double
  // draining by only charging the non-scout squad here.
  coop.subagentUpkeep = upkeep;
  void dt;
}

function subagentUpkeepFor(role, slot, ctx) {
  const def = coopRole(role) ?? COOP_ROLES.fighter;
  const base = num(def.upkeep, 0);
  const slotMultiplier = [1, 1, 1, 1.6, 2.2, 3][Math.max(0, Math.min(5, slot - 1))];
  const hopScale = 1 + Math.min(0.25, 0.05 * Math.max(0, num(ctx?.hops, 0)));
  return base * slotMultiplier * hopScale;
}

// ---------------------------------------------------------------------------
// Role abilities (O1c). The multi-target contract lives in `cocs-roles.mjs`;
// these are the engine effects. `PRIME` is the §4.8 logistics channel (one
// active prime per node; taking damage interrupts a human's channel, a
// HARVESTER never enters a contested zone), `RALLY` is the friendly multi-target
// ability, `REPAIR` fixes every broken device/terminal.
// ---------------------------------------------------------------------------
const PRIME_LEASH = 14;

/** Start the active HARVESTER/human prime on one owned economy node. */
export function coopPrimeNode(match, state, actor, nodeId) {
  const coop = state?.coop;
  if (!coop || !actor || actor.health <= 0) return {ok: false, reason: 'missing'};
  const node = nodeById(state, nodeId);
  if (!node || node.archetype !== 'economy' || node.owner !== 0) return {ok: false, reason: 'target'};
  if (node.primeChannel || (node.prime && num(state.tick, 0) <= num(node.prime.until, 0))) return {ok: false, reason: 'already-primed'};
  const ability = roleAbility('harvester', 'PRIME');
  const seconds = num(ability?.seconds, 8);
  node.primeChannel = {actor: actor.id, remaining: seconds, total: seconds};
  actor.subagentNode = node.id;
  coop.roleStats.primes = num(coop.roleStats.primes, 0) + 1;
  match?.emit?.('cocs-prime-start', {node: node.id, actor: actor.id, seconds});
  return {ok: true, reason: null, node: node.id};
}

function completePrime(match, state, node) {
  const channel = node.primeChannel;
  if (!channel) return false;
  const ability = roleAbility('harvester', 'PRIME');
  const actor = actorById(match, channel.actor);
  node.prime = {
    team: 0,
    by: channel.actor,
    until: num(state.tick, 0) + ticks(num(ability?.fluxSeconds, 30)),
    captureUntil: num(state.tick, 0) + ticks(num(ability?.captureSeconds, 10)),
    fluxBonus: num(ability?.fluxBonus, 0.5),
    captureMultiplier: num(ability?.captureMultiplier, 1.5),
  };
  node.primeChannel = null;
  const coop = state.coop;
  coop.roleStats.primeCompletions = num(coop.roleStats.primeCompletions, 0) + 1;
  match?.emit?.('cocs-prime', {node: node.id, actor: channel.actor, team: 0, seconds: num(ability?.fluxSeconds, 30)});
  void actor;
  return true;
}

function stepCoopPrimes(match, state, dt) {
  for (const node of state.nodes ?? []) {
    if (!node?.primeChannel) continue;
    const channel = node.primeChannel;
    const actor = actorById(match, channel.actor);
    const near = actor && actor.health > 0 && Math.hypot(num(actor.x, 0) - node.x, num(actor.z, 0) - node.z) <= Math.max(num(node.r, 4), PRIME_LEASH);
    if (!near || node.contested === true) { node.primeChannel = null; match?.emit?.('cocs-prime-interrupt', {node: node.id, actor: channel.actor}); continue; }
    channel.remaining = Math.max(0, num(channel.remaining, 0) - dt);
    if (!(channel.remaining > 0)) completePrime(match, state, node);
  }
  for (const node of state.nodes ?? []) if (node?.prime && num(state.tick, 0) > num(node.prime.until, 0)) node.prime = null;
}

// A HARVESTER autonomously primes owned rear siphons (design §4.8): it never
// enters a contested zone, only picks the lowest-id owned economy node with no
// hostile inside its radius + 10, and cannot replace a human on the front.
function maybeHarvesterPrime(match, state) {
  const coop = state.coop;
  const harvesters = coopSubagentActors(match, coop).filter(actor => actor.subagentRole === 'harvester' && actor.isScout !== true);
  if (!harvesters.length) return;
  const candidates = capturableNodes(state)
    .filter(node => node.archetype === 'economy' && node.owner === 0 && !node.primeChannel && !node.prime)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const node of candidates) {
    const hostile = (match.actors ?? []).some(actor => actor && actor.health > 0 && actor.team === 1 && Math.hypot(num(actor.x, 0) - node.x, num(actor.z, 0) - node.z) <= num(node.r, 4) + 10);
    if (hostile) continue;
    const harvester = harvesters.find(actor => !actor.subagentNode) ?? harvesters[0];
    if (harvester) { coopPrimeNode(match, state, harvester, node.id); return; }
  }
}

/** The friendly multi-target ability: buff every team-0 actor in radius. */
export function coopRoleRally(match, state, actor, ability = null) {
  const coop = state?.coop;
  if (!coop || !actor) return [];
  const def = ability ?? roleAbility('fighter', 'RALLY');
  const targets = roleAbilityTargets(match, state, actor, def);
  const shield = num(def?.shield, 0);
  const heal = num(def?.heal, 0);
  const seconds = num(def?.seconds, 0);
  for (const id of targets) {
    const target = actorById(match, id);
    if (!target) continue;
    if (shield > 0) target.temporaryShield = Math.max(num(target.temporaryShield, 0), shield);
    if (heal > 0) target.health = Math.min(target.maxHealth, num(target.health, 0) + heal);
  }
  if (targets.length) coop.roleStats.rallies = num(coop.roleStats.rallies, 0) + 1;
  match?.emit?.('cocs-role-rally', {actor: actor.id, role: actor.subagentRole ?? 'fighter', targets, shield, seconds});
  return targets;
}

/** Repair every broken device/terminal (the BUILDER multi-target ability). */
export function coopRoleRepair(match, state, actor) {
  const coop = state?.coop;
  if (!coop || !actor) return [];
  const def = roleAbility('builder', 'REPAIR');
  const targets = roleAbilityTargets(match, state, actor, def);
  const repaired = [];
  for (const id of targets) {
    if (String(id).startsWith('terminal:')) {
      const terminal = state.terminals?.terminals?.[String(id).slice('terminal:'.length)];
      if (terminal && repairTerminal(state, terminal)) repaired.push(id);
      continue;
    }
    const device = state?.traversal?.devices?.[id];
    if (device && device.state !== 'live') {
      device.state = 'live';
      device.timer = 0;
      device.repairs = num(device.repairs, 0) + 1;
      if (state.traversal?.stats) state.traversal.stats.repairs = num(state.traversal.stats.repairs, 0) + 1;
      repaired.push(id);
    }
  }
  if (repaired.length) coop.roleStats.repairs = num(coop.roleStats.repairs, 0) + 1;
  match?.emit?.('cocs-role-repair', {actor: actor.id, repaired});
  return repaired;
}

/**
 * Explicit role action entry point (tests / future UI).
 * `verb` is `RALLY|PRIME|REPAIR|SPOT`; `target` is a node id for PRIME.
 */
export function coopRoleAction(match, state, actorId, verb, {target = null} = {}) {
  const actor = actorById(match, actorId);
  if (!actor) return {ok: false, reason: 'missing'};
  const key = String(verb ?? '').toUpperCase();
  if (key === 'PRIME') return coopPrimeNode(match, state, actor, target);
  if (key === 'RALLY') return {ok: true, reason: null, targets: coopRoleRally(match, state, actor)};
  if (key === 'REPAIR') return {ok: true, reason: null, targets: coopRoleRepair(match, state, actor)};
  if (key === 'SPOT') {
    const def = roleAbility('scout', 'SPOT');
    const targets = roleAbilityTargets(match, state, actor, def);
    const coop = state?.coop;
    if (coop && targets.length) coop.roleStats.spots = num(coop.roleStats.spots, 0) + 1;
    match?.emit?.('cocs-role-spot', {actor: actor.id, targets});
    return {ok: true, reason: null, targets};
  }
  return {ok: false, reason: 'unknown-verb'};
}

function stepCoopRoles(match, state, dt) {
  stepCoopPrimes(match, state, dt);
  // Autonomous prime on a slow deterministic cadence (no RNG).
  if (num(state.tick, 0) > 0 && num(state.tick, 0) % 120 === 0) maybeHarvesterPrime(match, state);
  void dt;
}

function autoSinkLimit(coop, state, sink) {
  if (sink.verb === 'REPAIR') return 1;
  if (sink.verb === 'RESUPPLY') return 2;
  if (sink.verb === 'REINFORCE') return Math.max(0, Math.round(num(COOP_SINKS.REINFORCE.squadCap, 1)));
  if (sink.verb === 'FORTIFY') return Math.max(1, capturableNodes(state).filter(node => node.owner === 0).length);
  return 0;
}

function autoSinkTarget(match, state, sink) {
  if (sink.verb === 'FORTIFY') {
    const candidates = capturableNodes(state)
      .filter(node => node.owner === 0 && num(node.captureResist, 0) <= 0)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return candidates.length ? candidates[0].id : undefined;
  }
  if (sink.verb === 'REPAIR') {
    const hq = nodeById(state, COOP_SIEGE.hqId);
    const damaged = hq && state.coop.siege.health < state.coop.siege.max;
    const cut = (state.cuts ?? []).length > 0 || Boolean(state?.traversal?.devices && Object.values(state.traversal.devices).some(device => device?.state === 'cut'));
    return damaged || cut ? null : undefined;
  }
  if (sink.verb === 'REINFORCE') {
    const cap = Math.max(0, Math.round(num(COOP_SINKS.REINFORCE.squadCap, 1)));
    const live = (state.coop.squadIds ?? []).filter(id => (actorById(match, id)?.health ?? 0) > 0).length;
    return live < cap ? null : undefined;
  }
  return null;
}

/**
 * Deterministic no-UI auto-spend: after a cleared wave, convert pooled FLUX into
 * preparation until the reserve floor is reached (or no sink is applicable).
 * At most `autoSinkLimit` of each sink per window. Returns the spend count.
 */
export function coopAutoSpend(match, state) {
  const coop = state?.coop;
  if (!coop) return 0;
  const enabled = coop.autoSpend === true || coop.autoSpend === 'force';
  if (!enabled || !intermissionOpen(coop)) return 0;
  // The auto-spend is the **no-human fallback** (O1c §5.2): when any human is
  // seated the real per-player spend path owns the window, and only an explicit
  // `'force'` (validator/test) overrides that.
  if (coop.autoSpend !== 'force' && coopHumanIds(match).length > 0) return 0;
  const cap = num(state.fluxCap, COOP_ECONOMY.fluxCap);
  const floor = cap * Math.max(0, Math.min(0.9, num(COOP_AUTO_SPEND.reserveFraction, 0.15)));
  let spends = 0;
  let guard = 0;
  while (num(state.flux?.[0], 0) > floor + 1e-9 && guard++ < 64) {
    let did = false;
    for (const verb of COOP_SINK_ORDER) {
      const sink = COOP_SINKS[verb];
      if (num(coop.windowSpend[verb], 0) >= autoSinkLimit(coop, state, sink)) continue;
      const target = autoSinkTarget(match, state, sink);
      if (target === undefined) continue;
      // The AI-seat fallback fields the tuned combat squad; explicit callers can
      // still request any role through `coopSpend({role})`.
      const result = coopSpend(match, state, {
        tick: num(coop.tick, 0), peerId: 'chief-0',
        cardId: `auto-${verb}-${coop.wave}-${num(coop.windowSpend[verb], 0)}`,
        verb, target,
      });
      if (result.ok) { spends++; did = true; }
    }
    if (!did) break;
  }
  return spends;
}

// Fortify lasts one wave: clear any expired resist at the next wave start.
function expireFortify(coop, wave, state = null) {
  for (const id of Object.keys(coop.fortify ?? {})) {
    const entry = coop.fortify[id];
    if (entry && num(entry.untilWave, 0) >= wave) continue;
    delete coop.fortify[id];
    const node = state ? nodeById(state, id) : null;
    if (node) node.captureResist = 0;
  }
  return coop.fortify;
}

// ---------------------------------------------------------------------------
// O1b bonus objectives (design §3.4). One open at a time (tier `bonusOpen`
// allows two on D3/D4); rewards route into team FLUX + personal REQ +
// COMMENDATIONs, never a parallel currency.
// ---------------------------------------------------------------------------
function bonusProgressTarget(def) {
  if (def.kind === 'hold-all') return def.target;
  if (def.kind === 'wave-under-time') return 1;
  if (def.kind === 'own-siphons') return 2;
  return 1;
}

function openBonuses(match, coop) {
  const maxOpen = Math.max(1, Math.round(num(directorTier(coop.tier).bonusOpen, 1)));
  while (coop.bonus.open.length < maxOpen && coop.bonus.queue.length) {
    const id = coop.bonus.queue.shift();
    const def = bonusObjective(id);
    if (!def) continue;
    coop.bonus.open.push(id);
    coop.bonus.state.push({id, label: def.label, state: 'open', progress: 0, target: bonusProgressTarget(def)});
    coop.bonus.state.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    match?.emit?.('coop-bonus', {id, state: 'open', label: def.label});
  }
}

function resolveBonus(match, state, id, outcome) {
  const coop = state.coop;
  const index = coop.bonus.state.findIndex(entry => entry.id === id);
  if (index < 0 || coop.bonus.state[index].state !== 'open') return false;
  const entry = coop.bonus.state[index];
  if (outcome !== 'done') {
    entry.state = 'failed';
    coop.bonus.failed.push(id);
    coop.bonus.state.splice(index, 1);
    coop.bonus.open = coop.bonus.open.filter(value => value !== id);
    match.emit?.('coop-bonus', {id, state: 'failed', label: entry.label});
    openBonuses(match, coop);
    return false;
  }
  const def = bonusObjective(id);
  entry.state = 'done';
  entry.progress = entry.target;
  coop.bonus.done.push(id);
  coop.bonus.state.splice(index, 1);
  coop.bonus.open = coop.bonus.open.filter(value => value !== id);
  const tierMult = Math.max(0, num(directorTier(coop.tier).rewardMultiplier, 1));
  let flux = Math.round(Math.max(0, num(def.teamFlux, 0)) * tierMult);
  if (num(def.teamFluxPercent, 0) > 0) flux += Math.round(waveRewardFlux(coop, directorTier(coop.tier)) * num(def.teamFluxPercent, 0));
  if (flux > 0) {
    const cap = num(state.fluxCap, COOP_ECONOMY.fluxCap);
    const before = num(state.flux?.[0], 0);
    state.flux[0] = Math.min(cap, before + flux);
    state.fluxEarned[0] = num(state.fluxEarned?.[0], 0) + Math.max(0, state.flux[0] - before);
  }
  const req = Math.round(Math.max(0, num(def.req, 0)) * tierMult);
  if (req > 0) {
    for (const actor of match.actors ?? []) {
      if (!actor || actor.health <= 0 || actor.team !== 0 || actor.isDirectorWave === true) continue;
      addActorReq(actor, req * num(state.reqMult, 1));
    }
  }
  const commendations = Math.max(0, Math.round(num(def.commendations, 0)));
  coop.bonus.flux += flux;
  coop.bonus.req += req;
  coop.bonus.commendations += commendations;
  match.emit?.('coop-bonus', {id, state: 'done', label: entry.label, flux, req, commendations});
  openBonuses(match, coop);
  return true;
}

// Continuous bonus checks (hold-all latch, no-breach gate tracking).
// The `no-breach` gate is derived from `hq-0` adjacency, not hardcoded to
// `front-0`: the authored lattice always has a capturable gate next to the
// player HQ, and a retrofit map may name it anything.
export function coopBreachGateId(state) {
  const nodes = state?.nodes ?? [];
  const hq = nodes.find(node => node.id === 'hq-0') ?? nodes.find(node => node.archetype === 'hq' && node.owner === 0) ?? null;
  if (!hq) return 'front-0';
  const neighbours = [...(state.adjacency?.[hq.id] ?? [])].sort((a, b) => String(a).localeCompare(String(b)));
  for (const id of neighbours) {
    const node = nodeById(state, id);
    if (node && node.archetype !== 'hq' && node.archetype !== 'array') return node.id;
  }
  return 'front-0';
}

function stepCoopBonus(match, state) {
  const coop = state.coop;
  if (!coop.bonus.state.length) return;
  const capturable = capturableNodes(state);
  const held = capturable.filter(node => node.owner === 0).length;
  for (const entry of coop.bonus.state) {
    if (entry.state !== 'open') continue;
    const def = bonusObjective(entry.id);
    if (!def) continue;
    if (def.kind === 'hold-all') {
      entry.progress = held;
      entry.target = def.target;
      if (held >= def.target) {
        coop.bonusHoldTicks += 1;
        if (coop.bonusHoldTicks >= ticks(def.holdSeconds)) resolveBonus(match, state, entry.id, 'done');
      } else {
        coop.bonusHoldTicks = 0;
      }
    } else if (def.kind === 'hold-gate') {
      const gate = nodeById(state, coopBreachGateId(state));
      if (gate && gate.owner === 1) coop.gateLost = true;
    } else if (def.kind === 'own-siphons') {
      entry.progress = capturable.filter(node => node.archetype === 'economy' && node.owner === 0).length;
      entry.target = 2;
    }
  }
}

// Wave-clear bonus resolution: under-time and (on wave 3) flawless-siphon.
function resolveWaveBonuses(match, state) {
  const coop = state.coop;
  const open = new Set(coop.bonus.open);
  if (open.has('under-time')) {
    const def = bonusObjective('under-time');
    const fast = coop.waveTicks <= Math.max(1, coop.waveTimerTicks) * num(def.fraction, 0.7);
    resolveBonus(match, state, 'under-time', fast ? 'done' : 'failed');
  }
  if (open.has('flawless-siphon') && coop.wave === num(bonusObjective('flawless-siphon')?.wave, 3)) {
    const siphons = capturableNodes(state).filter(node => node.archetype === 'economy' && node.owner === 0).length;
    resolveBonus(match, state, 'flawless-siphon', siphons >= 2 ? 'done' : 'failed');
  }
}

// End-of-operation bonus resolution: close out anything still open.
function finalizeBonuses(match, state) {
  const coop = state.coop;
  for (const id of [...coop.bonus.open]) {
    const def = bonusObjective(id);
    if (!def) continue;
    if (def.kind === 'hold-gate') resolveBonus(match, state, id, coop.gateLost ? 'failed' : 'done');
    else resolveBonus(match, state, id, 'failed');
  }
}

// ---------------------------------------------------------------------------
// O1b partial rewards (design §3.5) + telemetry.
// ---------------------------------------------------------------------------
export function coopRewardSummary(match, state, {mvp = false, cfg = {}} = {}) {
  const coop = state?.coop;
  if (!coop) return null;
  const tier = directorTier(coop.tier);
  const win = coop.wavesCleared >= coop.waveCount;
  let leftover = 0;
  for (const actor of match.actors ?? []) {
    if (!actor || actor.team !== 0 || actor.isNpc === true || actor.isDirectorWave === true) continue;
    const earned = num(actor.reqEarned, num(actor.req, 0));
    const spent = num(actor.reqSpent, 0);
    leftover += Math.max(0, earned - spent);
  }
  const scores = state.scores ?? {0: 0, 1: 0};
  const objShare = num(scores[0], 0) + num(scores[1], 0) > 0 ? num(scores[0], 0) / (num(scores[0], 0) + num(scores[1], 0)) : 1;
  const conversion = convertCoopReq(leftover, objShare, win, mvp, {
    tierRewardMultiplier: tier.rewardMultiplier,
    failureRetention: COOP_REWARDS.failureRetention,
    bonusCommendations: coop.bonus.commendations,
    cfg,
  });
  return {
    tier: coop.tier, win, wavesCleared: coop.wavesCleared, waveCount: coop.waveCount,
    leftover: Math.round(leftover * 100) / 100,
    bonus: {done: [...coop.bonus.done], failed: [...coop.bonus.failed], flux: coop.bonus.flux, req: coop.bonus.req, commendations: coop.bonus.commendations},
    ...conversion,
  };
}

// Intermission/budget telemetry for the validator and the ops review.
export function coopSpendReport(match, state) {
  const coop = state?.coop;
  if (!coop) return null;
  const ticks = Math.max(1, num(coop.tick, 0));
  const cap = num(state.fluxCap, COOP_ECONOMY.fluxCap);
  return {
    windows: num(coop.spendStats.windows, 0),
    byType: {FORTIFY: num(coop.spendStats.FORTIFY, 0), REPAIR: num(coop.spendStats.REPAIR, 0), RESUPPLY: num(coop.spendStats.RESUPPLY, 0), REINFORCE: num(coop.spendStats.REINFORCE, 0)},
    fluxSpent: Math.round(num(coop.spendStats.flux, 0) * 100) / 100,
    budgetClampedFraction: Math.round((num(coop.stats.clampedTicks, 0) / ticks) * 1000) / 1000,
    fluxPinnedFraction: Math.round((num(coop.stats.fluxPinnedTicks, 0) / ticks) * 1000) / 1000,
    fluxCap: cap,
    bonusDone: [...coop.bonus.done],
    bonusFailed: [...coop.bonus.failed],
  };
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
  coop.intermissionOpen = false;
  coop.targetNode = null;
  coop.fronts = [];
  expireFortify(coop, coop.wave, state);
  coop.windowSpend = {FORTIFY: 0, REPAIR: 0, RESUPPLY: 0, REINFORCE: 0};
  resetCommandSpend(coop);
  refreshTargets(match, state);
  // D3/D4 hardened site: the Director's current front resists a recapture while
  // the Director holds it (content only, never a stat). Cleared at wave end.
  coop.hardenedNodeId = tier.hardened === true ? coop.targetNode : null;
  coop.denial = null;
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
  // O1b wave bonuses resolve on the clear (under-time, flawless-siphon).
  resolveWaveBonuses(match, state);
  if (coop.wavesCleared >= coop.waveCount) {
    coop.phase = 'relax';
    coop.intermissionOpen = false;
    coop.message = 'OPERATION COMPLETE';
    finalizeBonuses(match, state);
    return;
  }
  coop.phase = 'intermission';
  coop.intermission = true;
  coop.waveForceTotal = 0;
  coop.intermissionOpen = coop.wavesCleared > 0;
  coop.intermissionTicks = ticks(tier.intermissionSeconds);
  coop.windowSpend = {FORTIFY: 0, REPAIR: 0, RESUPPLY: 0, REINFORCE: 0};
  match.emit?.('director-intermission', {wave: coop.wave, nextWave: coop.wave + 1, seconds: tier.intermissionSeconds, budget: coop.pressure});
  if (coop.intermissionOpen) {
    coop.spendStats.windows = num(coop.spendStats.windows, 0) + 1;
    match.emit?.('coop-intermission-open', {wave: coop.wave, nextWave: coop.wave + 1, seconds: tier.intermissionSeconds, budget: Math.round(num(state.flux?.[0], 0) * 100) / 100});
    coopAutoSpend(match, state);
  }
}

function waveRewardFlux(coop, tier) {
  return Math.round((COOP_ECONOMY.waveRewardBase + COOP_ECONOMY.waveRewardPerWave * coop.wave) * tier.rewardMultiplier);
}

function rewardFor(coop, tier) {
  return waveRewardFlux(coop, tier);
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

// D3/D4 denial mechanics (design §4.1/§4.2): the Director periodically cuts one
// of the team's own supply links for a short window, and a hardened front
// resists a team-0 recapture while the Director holds it. Content only.
function stepCoopDenial(match, state) {
  const coop = state.coop;
  const tier = directorTier(coop.tier);
  if (coop.hardenedNodeId) {
    const node = nodeById(state, coop.hardenedNodeId);
    if (node) {
      if (node.owner === 1) node.captureResist = Math.max(num(node.captureResist, 0), 0.5);
      else if (num(node.captureResist, 0) > 0 && !coop.fortify?.[node.id]) node.captureResist = 0;
    }
  }
  if (tier.denial !== true) return;
  if (coop.denial) {
    if (num(coop.tick, 0) > num(coop.denial.until, 0)) {
      repairLink(state, coop.denial.nodeId);
      match.emit?.('director-denial-end', {node: coop.denial.nodeId, wave: coop.wave});
      coop.denial = null;
    }
    return;
  }
  if (coop.wave < COOP_DENIAL.minWave) return;
  const interval = ticks(COOP_DENIAL.intervalSeconds);
  if (!(interval > 0) || num(coop.tick, 0) % interval !== 0) return;
  const connected = new Set(connectivityIncome(state).connected[0] ?? []);
  const candidates = capturableNodes(state)
    .filter(node => node.owner === 0 && connected.has(node.id))
    .sort((a, b) => (a.archetype === 'relay' ? 0 : 1) - (b.archetype === 'relay' ? 0 : 1) || String(a.id).localeCompare(String(b.id)));
  const target = candidates[0];
  if (!target) return;
  cutLink(state, target.id);
  coop.denial = {nodeId: target.id, until: num(coop.tick, 0) + ticks(COOP_DENIAL.cutSeconds)};
  match.emit?.('director-denial', {node: target.id, wave: coop.wave, seconds: COOP_DENIAL.cutSeconds});
}

function maybeReinforce(match, state) {
  const coop = state.coop;
  if (coop.phase !== 'build_up' && coop.phase !== 'peak') return;
  const tier = directorTier(coop.tier);
  // D1 ships the tutorial curve: baseline + scripted escalations only. D2+ add
  // periodic PRESSURE reinforcement spends (the tier table's reinforcement row).
  // O1b: every tier (including D1) converts a *surplus* budget near the cap into
  // reinforcements on a short interval, so the visible meter is actually spent.
  const relief = coop.pressure >= directorCap(coop.tier) * COOP_PACING.reliefFraction;
  if ((tier.reinforceEvents ?? 0) <= 0 && !relief) return;
  const live = coop.waveIds.reduce((count, id) => count + ((actorById(match, id)?.health ?? 0) > 0 ? 1 : 0), 0);
  if (live >= COOP_WAVE_LIVE_CAP) return;
  coop.reinforceTimer += RULES.dt;
  // Relief uses the tier's published `reliefSeconds` (D1 3 s … D4 4 s), which is
  // faster than the authored reinforcement cadence so a surplus budget is spent
  // instead of pinning at the cap. Non-relief spending keeps `reinforceSeconds`.
  const interval = relief ? num(tier.reliefSeconds, Math.min(tier.reinforceSeconds, COOP_PACING.reliefSeconds)) : tier.reinforceSeconds;
  if (coop.reinforceTimer < interval) return;
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
  stepCoopDenial(match, state);
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
// Optional team-wipe RESERVE (design §1.3 / §7.2). Inert unless enabled. A full
// team wipe (no living team-0 actor for `wipeSeconds`) burns one reserve ticket;
// at zero tickets the operation is lost.
// ---------------------------------------------------------------------------
function stepReserve(match, state, dt) {
  const coop = state.coop;
  const reserve = coop.reserve;
  if (!reserve || reserve.enabled !== true) return;
  const anyTeam0 = (match.actors ?? []).some(actor => actor && actor.health > 0 && actor.team === 0 && actor.isDirectorWave !== true);
  if (anyTeam0) { reserve.wipeTicks = 0; return; }
  reserve.wipeTicks = num(reserve.wipeTicks, 0) + 1;
  if (reserve.wipeTicks < ticks(COOP_RESERVE.wipeSeconds)) return;
  reserve.wipeTicks = 0;
  reserve.tickets = Math.max(0, num(reserve.tickets, 0) - 1);
  reserve.burns = num(reserve.burns, 0) + 1;
  coop.stats.reserveBurns = num(coop.stats.reserveBurns, 0) + 1;
  match.emit?.('coop-reserve', {tickets: reserve.tickets, burn: reserve.burns, wave: coop.wave});
  void dt;
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
  // A player lease request queued by `prepareCocs` is recorded for the next
  // rotation (deterministic: earliest request tick, then peer id).
  if (coop.pendingLease !== null && coop.pendingLease !== undefined) {
    coopRequestLease(state, coop.pendingLease, coop.tick);
    coop.pendingLease = null;
  }
  coop.command = coopCommandState(match, state);
  // Consume any lease request granted by the current rotation window.
  if (Array.isArray(coop.leaseRequests) && coop.leaseRequests.length) {
    const leaseStart = Math.floor(num(coop.tick, 0) / COOP_EXECUTOR_LEASE_TICKS) * COOP_EXECUTOR_LEASE_TICKS;
    coop.leaseRequests = coop.leaseRequests.filter(request => num(request.tick, 0) > leaseStart);
  }
  // Dead wave force never respawns.
  pruneDirectorDead(match, state);
  // O1b intermission spends queue through the same deterministic order path.
  processCocsSpends(match, state);
  // Budget accrual on the phase factor.
  const tickRate = directorRate(coop.tier, coop.phase);
  const cap = directorCap(coop.tier);
  coop.pressure = directorAccrue(coop.pressure, tickRate, dt, cap);
  if (coop.pressure >= cap - 1e-9) { coop.pressureClampedTicks++; coop.stats.clampedTicks++; }
  coop.pressurePeak = Math.max(coop.pressurePeak, coop.pressure);
  coop.stats.peakPressure = Math.max(coop.stats.peakPressure, coop.pressure);
  // Team FLUX pin (the V0b acceptance gap O1b's sinks close).
  const fluxCap = num(state.fluxCap, COOP_ECONOMY.fluxCap);
  if (num(state.flux?.[0], 0) >= fluxCap - 1e-9) coop.stats.fluxPinnedTicks = num(coop.stats.fluxPinnedTicks, 0) + 1;
  // Advance the wave machine.
  if (coop.phase === 'intermission') stepIntermission(match, state);
  else stepWave(match, state, dt);
  // O1b bonus objective latch (hold-all / no-breach).
  stepCoopBonus(match, state);
  // O1c subagent upkeep (the §6.5 supply load) + role abilities (prime/rally/repair).
  stepCoopSubagents(match, state, dt);
  stepCoopRoles(match, state, dt);
  // Optional team-wipe RESERVE loss (inert unless enabled by config).
  stepReserve(match, state, dt);
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
  let outcome = null;
  if (coop.reserve?.enabled === true && num(coop.reserve.tickets, 0) <= 0) outcome = {winner: 1, reason: 'team-wipe'};
  else if (coop.siege.health <= 0) outcome = {winner: 1, reason: 'hq-destroyed'};
  else if (coop.wavesCleared >= coop.waveCount) {
    const hq = nodeById(state, coop.siege.hqId);
    outcome = (!hq || hq.owner === 0) ? {winner: 0, reason: 'operation-complete'} : {winner: 1, reason: 'hq-lost'};
  } else {
    const dominance = state.dominance;
    if (dominance && dominance.team === 1 && dominance.progress >= dominance.target) outcome = {winner: 1, reason: 'dominance'};
    else {
      const limit = Math.max(1, num(match?.config?.timeLimit, RULES.timeLimit));
      if (num(match?.time, 0) >= limit) outcome = {winner: 1, reason: 'operation-failed'};
    }
  }
  if (!outcome) return null;
  // O1b partial rewards: convert once, at the terminal frame, through the
  // existing REQ→COMMENDATIONS model, and emit the ops-review summary.
  if (!coop.rewards) {
    coop.rewards = coopRewardSummary(match, state);
    if (coop.stats.partialPayouts !== undefined) coop.stats.partialPayouts = outcome.winner === 0 ? 0 : 1;
    match.emit?.('operation-summary', {reason: outcome.reason, ...coop.rewards, spend: coopSpendReport(match, state)});
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Snapshot (`cocs.director`).
// ---------------------------------------------------------------------------
function phaseSecondsRemaining(coop) {
  if (coop.phase === 'intermission') return coop.intermissionTicks * (RULES.dt || 1 / 60);
  return Math.max(0, (coop.waveTimerTicks - coop.waveTicks) * (RULES.dt || 1 / 60));
}

// The spend-window catalog as a HUD-ready array: which sink can be bought now,
// what it costs and what it does. Pure read of state; no side effects.
function sinkViews(match, state) {
  const coop = state?.coop;
  const open = intermissionOpen(coop);
  const budget = num(state.flux?.[0], 0);
  const views = [];
  for (const verb of COOP_SINK_ORDER) {
    const sink = COOP_SINKS[verb];
    let available = true;
    if (sink.verb === 'FORTIFY') available = capturableNodes(state).some(node => node.owner === 0 && num(node.captureResist, 0) <= 0);
    else if (sink.verb === 'REPAIR') available = coop.siege.health < coop.siege.max || (state.cuts ?? []).length > 0 || Boolean(state?.traversal?.devices && Object.values(state.traversal.devices).some(device => device?.state === 'cut'));
    else if (sink.verb === 'REINFORCE') {
      const live = (coop.squadIds ?? []).filter(id => (actorById(match, id)?.health ?? 0) > 0).length;
      available = live < Math.max(0, Math.round(num(sink.squadCap, 1)));
    }
    views.push({
      verb, id: sink.id, label: sink.label, cost: sink.cost, target: sink.target,
      description: sink.description, available,
      affordable: budget + 1e-9 >= sink.cost,
      enabled: open && available && budget + 1e-9 >= sink.cost,
    });
  }
  return views;
}

export function cocsDirectorSnapshot(match, state) {
  const coop = state?.coop;
  if (!coop) return null;
  const budgetRate = directorRate(coop.tier, coop.phase);
  const siege = coop.siege;
  return {
    tier: coop.tier,
    tierLabel: coop.tierLabel,
    tierCopy: directorTierCopy(coop.tier),
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
    denial: coop.denial ? {nodeId: coop.denial.nodeId, until: num(coop.denial.until, 0)} : null,
    hardened: coop.hardenedNodeId ? {nodeId: coop.hardenedNodeId, resist: 0.5} : null,
    pressure: clamp01(coop.pressure / Math.max(1, directorCap(coop.tier))),
    intermission: {
      open: coop.intermissionOpen === true,
      secondsRemaining: coop.phase === 'intermission' ? Math.round(Math.max(0, coop.intermissionTicks) * (RULES.dt || 1 / 60) * 10) / 10 : 0,
      budget: Math.round(num(state.flux?.[0], 0) * 100) / 100,
      spent: Math.round(num(coop.spendStats.flux, 0) * 100) / 100,
      windows: num(coop.spendStats.windows, 0),
      byType: {
        FORTIFY: num(coop.spendStats.FORTIFY, 0), REPAIR: num(coop.spendStats.REPAIR, 0),
        RESUPPLY: num(coop.spendStats.RESUPPLY, 0), REINFORCE: num(coop.spendStats.REINFORCE, 0),
      },
      sinks: sinkViews(match, state),
      log: (coop.spendLog ?? []).slice(-8).map(entry => ({...entry})),
    },
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
      clampedTicks: num(coop.stats.clampedTicks, 0),
      fluxPinnedTicks: num(coop.stats.fluxPinnedTicks, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// O1c terminal HUD contract. The objective tree keeps terminals in
// `state.terminals.terminals` (id-keyed); the UI reads a flat array at
// `snapshot.cocs.terminals`. Each entry keeps every raw field and adds the
// presentation contract `{id, kind, nodeId, label, state, owner, progress,
// remainingSeconds, actor, hint}`. `state` is the UI state (`active` while a
// channel runs, `blocked`/`locked` for cut/locked, `complete` when finished,
// else `available`); the sim state is preserved as `simState`.
// ---------------------------------------------------------------------------
const COCS_TERMINAL_HINTS = Object.freeze({
  HACK: 'HACK THE RELAY',
  DEPLOY: 'DEPLOY THE ORACLE',
  VAULT: 'CRACK THE VAULT',
  SABOTAGE: 'CUT THE SUPPLY LINK',
});

function cocsTerminalUiState(terminal) {
  if (terminal?.channel) return 'active';
  const sim = String(terminal?.state ?? 'live').toLowerCase();
  if (sim === 'cut') return 'blocked';
  if (sim === 'locked') return 'locked';
  if (sim === 'complete' || sim === 'done') return 'complete';
  return 'available';
}

/** UI-contract array for `state.terminals.terminals` (id-sorted, delta-friendly). */
export function coopTerminalSnapshot(state) {
  const terminals = state?.terminals?.terminals;
  if (!terminals) return [];
  return Object.keys(terminals).sort().map(id => {
    const terminal = terminals[id];
    const kind = String(terminal.kind ?? '').toUpperCase();
    const def = TERMINAL_KINDS[kind] ?? null;
    const channel = terminal.channel ? {
      actor: terminal.channel.actor ?? null,
      action: terminal.channel.action ?? null,
      remaining: Math.round(num(terminal.channel.remaining, 0) * 10) / 10,
      total: Math.round(num(terminal.channel.total, 0) * 10) / 10,
    } : null;
    const total = num(terminal.channel?.total, 0);
    const progress = terminal.channel && total > 0
      ? clamp01(1 - num(terminal.channel.remaining, 0) / total)
      : 0;
    return {
      // --- UI contract -----------------------------------------------------
      id: String(id),
      kind,
      nodeId: terminal.nodeId ?? null,
      label: def?.label ?? kind,
      state: cocsTerminalUiState(terminal),
      owner: terminal.owner === 0 || terminal.owner === 1 ? Number(terminal.owner) : null,
      progress,
      progressPercent: Math.round(progress * 100),
      remainingSeconds: Math.round(num(channel ? channel.remaining : terminal.timer, 0) * 10) / 10,
      actor: channel?.actor ?? null,
      hint: COCS_TERMINAL_HINTS[kind] ?? 'USE TERMINAL',
      // --- raw fields preserved (the sim tree is untouched) ----------------
      simState: String(terminal.state ?? 'live'),
      x: Math.round(num(terminal.x, 0) * 1000) / 1000,
      z: Math.round(num(terminal.z, 0) * 1000) / 1000,
      timer: Math.round(num(terminal.timer, 0) * 1000) / 1000,
      channel,
      hackedTeam: terminal.hackedTeam ?? null,
      deployedTeam: terminal.deployedTeam ?? null,
      uses: num(terminal.uses, 0),
      hacks: num(terminal.hacks, 0),
      deploys: num(terminal.deploys, 0),
      sabotages: num(terminal.sabotages, 0),
      repairs: num(terminal.repairs, 0),
    };
  });
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
      // Per-player slices with the live allowance/remaining the HUD shows.
      slices: command.slices.map(entry => ({id: entry.id, allowance: entry.allowance, remaining: entry.remaining, spent: entry.spent})),
      // The rotating EXECUTOR lease, additively (design §5.2/§6.4).
      lease: {...command.lease, requests: command.lease.requests.map(entry => ({...entry}))},
      flux: command.flux,
      spent: {...(coop.commandSpent ?? {byPeer: {}}).byPeer},
      // N1 command board: seat/votes/route/policy round-trip through the
      // snapshot so a reconnect resyncs the whole command state (§11.2).
      seat: {...command.seat},
      votes: {0: [...command.votes[0]], 1: [...command.votes[1]]},
      route: {...command.route},
      policy: {...command.policy},
    } : null,
    // O1c terminal HUD contract (flat array; raw tree preserved on
    // `snapshot.cocs.terminalState`). Sorted by id, so delta-friendly.
    terminals: coopTerminalSnapshot(state),
    // O1c subagent roles + ability telemetry (additive).
    roles: {
      threads: {used: command ? command.threads.used : 0, cap: command ? command.threads.cap : 0},
      byRole: {...(coop.subagentStats?.byRole ?? {})},
      spawned: num(coop.subagentStats?.spawned, 0),
      stats: {...(coop.roleStats ?? {})},
      agents: coopSubagentActors(match, coop).map(actor => ({
        id: actor.id, role: actor.subagentRole ?? (actor.isScout === true ? 'scout' : 'fighter'),
        team: actor.team, health: Math.round(num(actor.health, 0)), max: Math.round(num(actor.maxHealth, 0)),
        nodeId: actor.subagentNode ?? null, idle: actor.subagentIdle === true,
      })),
    },
    primes: (state.nodes ?? [])
      .filter(node => node?.prime || node?.primeChannel)
      .map(node => ({
        nodeId: node.id,
        active: Boolean(node.prime && num(state.tick, 0) <= num(node.prime.until, 0)),
        until: node.prime ? num(node.prime.until, 0) : 0,
        channel: node.primeChannel ? {actor: node.primeChannel.actor, remaining: Math.round(num(node.primeChannel.remaining, 0) * 100) / 100} : null,
      }))
      .sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId))),
    bonus: (coop.bonus.state ?? [])
      .map(entry => ({id: entry.id, label: entry.label, state: entry.state, progress: num(entry.progress, 0), target: num(entry.target, 1)}))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    bonusTelemetry: {
      done: [...coop.bonus.done], failed: [...coop.bonus.failed],
      flux: coop.bonus.flux, req: coop.bonus.req, commendations: coop.bonus.commendations,
    },
    reserves: {
      enabled: coop.reserve.enabled === true,
      tickets: Math.max(0, num(coop.reserve.tickets, 0)),
      burns: num(coop.reserve.burns, 0),
    },
    rewards: coop.rewards,
  };
}

// ---------------------------------------------------------------------------
// N1 wire-action application (§11.2/§11.6). Every C→S action is validated and
// applied inside `Match.step` at the single fixed point (`prepareCocs`), so the
// live room, sweeps and NetHarness share one deterministic code path. These
// helpers are pure state transitions: no wall clock, no RNG, sorted iteration.
// ---------------------------------------------------------------------------

/** Apply one validated terminal action to the authoritative sim. */
export function coopTerminalAction(match, state, record = {}) {
  const actor = actorById(match, record.actorId);
  if (!actor || actor.health <= 0) return {ok: false, reason: 'missing'};
  const action = String(record.action ?? '').toLowerCase();
  const terminals = state?.terminals?.terminals;
  const terminal = terminals ? terminals[record.terminalId] : null;
  if (terminal) {
    if (action === 'hack' || action === 'deploy') {
      const started = terminalInteract(match, state, actor.id, record.terminalId, action.toUpperCase());
      return {ok: started.ok === true, reason: started.reason ?? null};
    }
    if (action === 'repair') return {ok: repairTerminal(state, terminal) === true, reason: null};
    if (action === 'vault-store') return vaultAction(match, state, terminal, actor, 'store');
    if (action === 'vault-pull') return vaultAction(match, state, terminal, actor, 'pull');
  }
  // Traversal devices share the same action namespace but a different id space.
  const device = state?.traversal?.devices?.[record.terminalId];
  if (device && (action === 'cut' || action === 'lock' || action === 'repair')) {
    const applied = deviceInteract(match, state, actor.id, record.terminalId, action);
    return {ok: applied === true, reason: applied ? null : 'device-state'};
  }
  return {ok: false, reason: 'missing'};
}

/** Apply one validated command-board action to the authoritative sim. */
export function coopCommandAction(match, state, record = {}) {
  const coop = state?.coop;
  if (!coop) return {ok: false, reason: 'no-command'};
  const team = record.team === 1 ? 1 : 0;
  const peerId = String(record.peerId ?? '');
  coop.commandSeat ??= {0: null, 1: null};
  coop.commandVotes ??= {0: {}, 1: {}};
  coop.commandRoute ??= {0: null, 1: null};
  coop.commandPolicy ??= {0: null, 1: null};
  const action = String(record.action ?? '').toLowerCase();
  if (action === 'take') {
    coop.commandSeat[team] = peerId || null;
    coop.commandVotes[team] = {};
    return {ok: true, reason: null};
  }
  if (action === 'release') {
    if (coop.commandSeat[team] !== peerId) return {ok: false, reason: 'not-commander'};
    coop.commandSeat[team] = null;
    return {ok: true, reason: null};
  }
  if (action === 'mutiny-vote') {
    coop.commandVotes[team][peerId] = true;
    const humans = team === 0 ? coopHumanIds(match) : (match?.actors ?? []).filter(actor => actor && actor.health > 0 && actor.team === 1 && actor.isNpc !== true && actor.bot == null).map(actor => actor.id).sort((a, b) => a - b);
    const needed = Math.max(1, Math.floor(humans.length / 2) + 1);
    const votes = coop.commandVotes[team];
    const count = Object.keys(votes).filter(key => votes[key] === true).length;
    if (humans.length > 0 && count >= needed && coop.commandSeat[team] !== peerId) {
      coop.commandSeat[team] = peerId;
      coop.commandVotes[team] = {};
    }
    return {ok: true, reason: null, votes: count, needed};
  }
  if (action === 'set-route') {
    coop.commandRoute[team] = record.value === null || record.value === undefined ? null : String(record.value);
    return {ok: true, reason: null};
  }
  if (action === 'policy') {
    coop.commandPolicy[team] = record.value === null || record.value === undefined ? null : String(record.value);
    return {ok: true, reason: null};
  }
  if (action === 'opt-out-orders') {
    // Per-actor personal REQ opt-out (design §6A.6). Lives on the roster so the
    // order-reward path can skip the actor without a parallel wallet.
    const actor = actorById(match, record.actorId);
    if (!actor) return {ok: false, reason: 'missing'};
    actor.ordersOptOut = true;
    coop.commandOrdersOptOut[String(actor.id)] = true;
    return {ok: true, reason: null};
  }
  return {ok: false, reason: 'unknown-action'};
}

/** Apply one validated personal-REQ purchase to the authoritative sim. */
export function coopBuyAction(match, state, record = {}) {
  const actor = actorById(match, record.actorId);
  if (!actor || actor.health <= 0) return {ok: false, reason: 'missing'};
  const item = reqItem(record.itemId);
  if (!item) return {ok: false, reason: 'unknown-item'};
  if (item.launch !== true) return {ok: false, reason: 'not-launched'};
  const team = actor.team === 1 ? 1 : 0;
  const peerId = String(record.peerId ?? '');
  const isCommander = state?.coop?.commandSeat?.[team] === peerId || (peerId === '' && item.commanderOnly !== true);
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
  // Deterministic personal effects. Team-wide/commander items only record the
  // purchase; their team payoff rides the existing economy in a later wave.
  if (item.id === 'field-repair') actor.health = Math.min(num(actor.maxHealth, actor.health), num(actor.health, 0) + 50);
  else if (item.id === 'overshield') actor.temporaryShield = Math.max(num(actor.temporaryShield, 0), 50);
  else if (item.id === 'haste') {
    actor.powerups ??= {};
    actor.powerups.haste = Math.max(num(actor.powerups.haste, 0), 15);
    match?.refreshPowerups?.(actor);
  } else if (item.id === 'ammo-crate' && Array.isArray(actor.ammo)) {
    for (let index = 0; index < actor.ammo.length; index++) {
      if (actor.ammo[index] === Infinity) continue;
      const cap = match?.weaponForIndex?.(actor, index)?.cap;
      if (Number.isFinite(cap) && actor.ammo[index] < cap) actor.ammo[index] = cap;
    }
  }
  match?.emit?.('cocs-buy', {actor: actor.id, team, itemId: item.id, cost: num(result.cost, 0), req: num(actor.req, 0)});
  return {ok: true, reason: null, itemId: item.id, cost: num(result.cost, 0)};
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
    spend: coopSpendReport(match, state),
    bonus: {done: [...coop.bonus.done], failed: [...coop.bonus.failed], flux: coop.bonus.flux, req: coop.bonus.req, commendations: coop.bonus.commendations},
    reserve: {enabled: coop.reserve.enabled === true, tickets: num(coop.reserve.tickets, 0), burns: num(coop.reserve.burns, 0)},
    rewards: coop.rewards ?? coopRewardSummary(match, state),
  };
}
