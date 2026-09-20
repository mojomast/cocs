// ---------------------------------------------------------------------------
// LATTICE STRIKE: OPERATIONS (`cocs-coop`) — pure difficulty & wave data.
//
// Owner decision: D1–D2 are tuned and played; D3–D4 ship as published data plus
// a smoke test. Tiers only ever add *content* (more simultaneous fronts, more
// reinforcement events, compressed timers, denial behaviours) — they never
// change an archetype's health, armour, damage or speed. That invariant is the
// whole point of this module being pure data, and it is asserted by
// `cocs-director-tiers.test.mjs`.
//
// This file imports nothing. It is safe to read from config.mjs (team seam),
// the planner (`cocs-director.mjs`) and the engine wiring (`cocs-coop.mjs`)
// without creating a cycle.
// ---------------------------------------------------------------------------

export const COCS_TIERS = Object.freeze(['D1', 'D2', 'D3', 'D4']);
export const DEFAULT_COCS_TIER = 'D1';

// Published tier table (design §4.1). No combat stat appears here on purpose.
export const DIRECTOR_TIERS = Object.freeze({
  D1: Object.freeze({
    id: 'D1', label: 'STANDARD',
    fronts: 1,
    rate: 4, cap: 240, start: 40,
    intermissionSeconds: 30,
    waveTimerMultiplier: 1.0,
    reinforceSeconds: 12,
    reliefSeconds: 4,
    reinforceEvents: 0,
    compositionPool: 'core',
    countScale: 0.85,
    hardened: false,
    denial: false,
    bossPhaseStart: 1,
    rewardMultiplier: 1.0,
    bonusOpen: 1,
    // Published player-facing copy (design §4.2). Surfaced verbatim by the HUD
    // and the validator; `band` is the documented win-rate band (§7.1/§7.2).
    copy: 'Five escalating waves, one contested front, the Director budget tutorialised.',
    modifiers: Object.freeze(['1 FRONT', 'NO MODIFIER']),
    band: Object.freeze([0.35, 0.65]),
  }),
  D2: Object.freeze({
    id: 'D2', label: 'ENCIRCLED',
    fronts: 2,
    rate: 4.5, cap: 280, start: 50,
    intermissionSeconds: 28,
    waveTimerMultiplier: 0.95,
    reinforceSeconds: 9,
    reliefSeconds: 4.5,
    reinforceEvents: 1,
    compositionPool: 'core+',
    countScale: 1.05,
    hardened: false,
    denial: false,
    bossPhaseStart: 1,
    rewardMultiplier: 1.25,
    bonusOpen: 1,
    copy: 'A second simultaneous front, intermission reinforcement events and a faster escalation clock.',
    modifiers: Object.freeze(['2 FRONTS', 'REINFORCEMENTS', 'FASTER CLOCK']),
    band: Object.freeze([0.28, 0.58]),
  }),
  D3: Object.freeze({
    id: 'D3', label: 'DENIAL',
    fronts: 2,
    rate: 5.2, cap: 320, start: 60,
    intermissionSeconds: 26,
    waveTimerMultiplier: 0.90,
    reinforceSeconds: 8,
    reliefSeconds: 4,
    reinforceEvents: 2,
    compositionPool: 'denial',
    countScale: 0.98,
    hardened: true,
    denial: true,
    bossPhaseStart: 2,
    rewardMultiplier: 1.5,
    bonusOpen: 2,
    copy: 'Denial and spotting bodies, a hardened Director front, and relay-sabotage events cut a link.',
    modifiers: Object.freeze(['2 FRONTS', 'DENIAL BODIES', 'HARDENED FRONT', 'RELAY SABOTAGE']),
    band: Object.freeze([0.20, 0.48]),
  }),
  D4: Object.freeze({
    id: 'D4', label: 'OVERWATCH',
    fronts: 3,
    rate: 6, cap: 380, start: 70,
    intermissionSeconds: 24,
    waveTimerMultiplier: 0.80,
    reinforceSeconds: 5,
    reliefSeconds: 4,
    reinforceEvents: 2,
    compositionPool: 'all',
    countScale: 1.35,
    hardened: true,
    denial: true,
    bossPhaseStart: 3,
    rewardMultiplier: 2.0,
    bonusOpen: 2,
    copy: 'Three fronts, supply-cut and relay-sabotage events, compressed timers, and a combined-arms final wave that starts the boss at phase 3.',
    modifiers: Object.freeze(['3 FRONTS', 'SUPPLY CUT', 'RELAY SABOTAGE', 'PHASE-3 BOSS']),
    band: Object.freeze([0.12, 0.40]),
  }),
});

export const directorTier = id => DIRECTOR_TIERS[id] ?? DIRECTOR_TIERS[DEFAULT_COCS_TIER];
export const isCocsTier = id => COCS_TIERS.includes(String(id ?? '').toUpperCase());
export const normalizeCocsTier = id => (isCocsTier(id) ? String(id).toUpperCase() : DEFAULT_COCS_TIER);

// The tier a config launches at. The engine seam is `config.objective.tier`
// (cocs.mjs); `config.coopTier` stays a documented legacy fallback. Unknown or
// absent values resolve to the new-player default, so an existing saved config
// stays valid. Pure, deterministic, no clock.
export function configuredDirectorTier(config) {
  const c = config && typeof config === 'object' ? config : {};
  return normalizeCocsTier(c.objective?.tier ?? c.coopTier);
}

// The mode is 1–8 humans; the persistent Director garrison is capped so a solo
// player is never outnumbered 1v7 by the passive AI. Overflow bot seats fill
// team 0 as AI allies (the "bot-fillable, no queue floor" rule, design §1.2).
export const COOP_GARRISON_BOTS = 2;
// A first-time team is never smaller than this: a solo player is bot-filled up
// to the floor so the operation is winnable without a queue ("bot-fillable, no
// queue floor").
export const COOP_TEAM_FLOOR = 4;

// ---------------------------------------------------------------------------
// OPERATIONS roster view (F06). `core.mjs` seatTeam fills the team floor from
// the first bot seats, then crews the persistent Director garrison, then sends
// any overflow back to team 0. This helper mirrors that exact order for the
// setup/preview screens; a focused test compares it against real Match rosters
// so the two cannot drift. `enemyBots` is the garrison only — the Director's
// wave force is spawned separately and is never a bot seat.
// ---------------------------------------------------------------------------
export function coopRoster({ humans = 1, bots = 0 } = {}) {
  const human = Math.max(1, Math.round(Number(humans) || 1));
  const botCount = Math.max(0, Math.round(Number(bots) || 0));
  const fill = Math.max(0, COOP_TEAM_FLOOR - human);
  let alliedBots = 0, garrisonBots = 0;
  for (let index = 0; index < botCount; index++) {
    if (index < fill) { alliedBots++; continue; }
    if (index - fill < COOP_GARRISON_BOTS) { garrisonBots++; continue; }
    alliedBots++;
  }
  return Object.freeze({
    humans: human,
    bots: botCount,
    alliedBots,
    allies: human + alliedBots,
    garrisonBots,
    enemyBots: garrisonBots,
    teamFloor: COOP_TEAM_FLOOR,
    garrisonCap: COOP_GARRISON_BOTS,
    autoFill: true,
  });
}

// Generous one-sided economy (design §1.5). Mode-local: `cocs` PvPvE keeps its
// tighter 80/240 constants.
export const COOP_ECONOMY = Object.freeze({
  fluxStart: 120,
  fluxCap: 300,
  fluxPassivePerSecond: 1.5,
  reqMultiplier: 1.25,
  waveRewardBase: 45,
  waveRewardPerWave: 15,
});

// ---------------------------------------------------------------------------
// O1b intermission sinks (design §3.3). Concrete FLUX sinks applied through the
// existing deterministic order/economy path: every spend is `{tick, peerId,
// cardId, verb, target}` and is sorted exactly like a `HOLD/ATTACK/SCAN` order,
// so the outcome cannot depend on network arrival order. `target` is a node id,
// the HQ id, or null for team-wide sinks.
//
// Costs are pure data. Effects resolve through the shipped economy helpers (team
// FLUX debit, `addActorReq`, `repairLink`) — no parallel currency is created.
// ---------------------------------------------------------------------------
export const COOP_SINKS = Object.freeze({
  FORTIFY: Object.freeze({
    id: 'FORTIFY', verb: 'FORTIFY', label: 'FORTIFY', target: 'node', cost: 60,
    captureResist: 0.5, waves: 1,
    description: 'Harden a held node: enemies capture it 50% slower for one wave.',
  }),
  REPAIR: Object.freeze({
    id: 'REPAIR', verb: 'REPAIR', label: 'REPAIR', target: 'hq', cost: 45,
    hqHeal: 420, links: 1,
    description: 'Restore HQ integrity and repair one cut supply link.',
  }),
  RESUPPLY: Object.freeze({
    id: 'RESUPPLY', verb: 'RESUPPLY', label: 'RESUPPLY', target: 'team', cost: 35,
    heal: 1, armor: 1, req: 24,
    description: 'Refill team health and armour; grant every operator REQ.',
  }),
  REINFORCE: Object.freeze({
    id: 'REINFORCE', verb: 'REINFORCE', label: 'REINFORCE', target: 'team', cost: 50,
    squad: 1, threads: 1, squadCap: 2,
    description: 'Call in one friendly squad bot and one extra THREAD for the next wave.',
  }),
});
export const COOP_SINK_ORDER = Object.freeze(['RESUPPLY', 'REPAIR', 'FORTIFY', 'REINFORCE']);
export const COOP_SINK_VERBS = Object.freeze(COOP_SINK_ORDER.map(id => COOP_SINKS[id].verb));
export const COOP_SINK_SPEND_FLOOR = 0.4; // auto-spend keeps below this fraction only when a sink is needed

// Auto-spend policy (validator / no-UI teams): the duty Chief converts pooled
// FLUX into preparation on wave clear. Deterministic priority, no RNG, at most
// one of each sink per intermission. A real player spends through the same
// `coopSpend` path; this only exists so an AI-driven team still exercises the
// sinks (and so FLUX stops pinning at the cap in the acceptance telemetry).
export const COOP_AUTO_SPEND = Object.freeze({ enabled: true, reserveFraction: 0.15 });

// O1b bonus objectives (design §3.4). One is open at a time (D3/D4 allow two);
// rewards route into the existing team FLUX + personal REQ + COMMENDATION model.
export const COOP_BONUS = Object.freeze({
  'hold-all': Object.freeze({
    id: 'hold-all', label: 'HOLD ALL', kind: 'hold-all', holdSeconds: 10,
    target: 5, teamFlux: 80, req: 40,
    description: 'Hold all five capturable nodes simultaneously for 10 s.',
  }),
  'under-time': Object.freeze({
    id: 'under-time', label: 'UNDER TIME', kind: 'wave-under-time', fraction: 0.7,
    teamFluxPercent: 0.1, req: 15,
    description: 'Clear a wave within 70% of its timer.',
  }),
  'flawless-siphon': Object.freeze({
    id: 'flawless-siphon', label: 'FLAWLESS SIPHON', kind: 'own-siphons', wave: 3,
    teamFlux: 40, req: 25,
    description: 'Own both siphons at the end of Wave 3.',
  }),
  'no-breach': Object.freeze({
    id: 'no-breach', label: 'NO BREACH', kind: 'hold-gate', gate: 'front-0',
    teamFlux: 0, req: 0, commendations: 1,
    description: 'Never lose the gate adjacent to hq-0 for the whole operation.',
  }),
});
export const COOP_BONUS_ORDER = Object.freeze(['hold-all', 'under-time', 'flawless-siphon', 'no-breach']);

// O1b partial rewards (design §3.5 / §4.3): a failed operation still converts
// 25% of the run's REQ; the tier reward multiplier scales the pool.
export const COOP_REWARDS = Object.freeze({
  failureRetention: 0.25,
  winRetention: 1.0,
});

// Optional team-wipe RESERVE lose condition (design §1.3 / §7.2). Inert by
// default; a mode config or test enables it. `wipeSeconds` is how long every
// team-0 operator must be simultaneously down before a reserve ticket burns.
export const COOP_RESERVE = Object.freeze({
  enabled: false, start: 6, wipeSeconds: 8, maxPerWave: 1,
});

// D3/D4 denial mechanics (design §4.1/§4.2). The Director periodically cuts one
// of the team's own supply links for a short window (relay sabotage / supply
// cut). Pure data; the engine picks the deterministic target.
export const COOP_DENIAL = Object.freeze({
  intervalSeconds: 45,
  cutSeconds: 20,
  minWave: 2,
});

// L4D-style pacing: BUILD_UP -> PEAK -> RELAX, with INTERMISSION between waves.
export const COOP_PACING = Object.freeze({
  buildUpFraction: 0.40,
  peakFraction: 0.75,
  rateFactor: Object.freeze({intermission: 0, build_up: 0.5, peak: 1, relax: 0.35}),
  telegraphSeconds: 1.5,
  reinforceSeconds: 6,
  overrunSeconds: 10,
  intermissionLeadSeconds: 3,   // a short "next wave" beat after a clear
  // PRESSURE relief (O1b): once the Director budget reaches this fraction of the
  // cap it converts the surplus into reinforcement bodies on a short interval,
  // even on a tier with no authored reinforcement events. This is what stops the
  // budget pinning at the cap for a whole match and keeps the meter meaningful.
  reliefFraction: 0.85,
  reliefSeconds: 3,
});

// Archetype PRESSURE costs. A reinforcement is only spawned when the budget
// covers it; the budget is the *only* source of enemy force beyond the wave
// baseline, so a seeded replay reconstructs every spend exactly.
export const DIRECTOR_COSTS = Object.freeze({
  husk: 4, spitter: 6, mender: 10, brute: 16, lancer: 14,
  bulwark: 20, mortar: 18, sentinel: 22, sapper: 12, overseer: 24,
  warden: 60, harbinger: 60,
});

// The 5-wave operation. `composition` is the baseline (free at wave start and
// spent from PRESSURE); `events` are scripted escalations that ignore RELAX.
export const OPERATIONS_WAVES = Object.freeze([
  Object.freeze({
    wave: 1, label: 'SIGNAL SPIKE', modifier: 'swarm', timer: 120,
    // Published per-wave simultaneous fronts (design §3.2, D1/D2/D3/D4). The
    // tier's `fronts` is the general cap; the authored wave overrides it where
    // the table raises it (W4 on D1, W5 on D3/D4).
    fronts: Object.freeze({D1: 1, D2: 1, D3: 1, D4: 1}),
    composition: Object.freeze({husk: 3, spitter: 1}), events: Object.freeze([]),
  }),
  Object.freeze({
    wave: 2, label: 'PRESSURE', modifier: 'mixed', timer: 150,
    fronts: Object.freeze({D1: 1, D2: 2, D3: 2, D4: 2}),
    composition: Object.freeze({husk: 4, spitter: 2, sapper: 1}),
    events: Object.freeze([Object.freeze({kind: 'REINFORCE', at: 0.85})]),
  }),
  Object.freeze({
    wave: 3, label: 'DENIAL', modifier: 'artillery', timer: 150,
    fronts: Object.freeze({D1: 1, D2: 2, D3: 2, D4: 3}),
    composition: Object.freeze({husk: 4, spitter: 2, mender: 1, sapper: 1}),
    events: Object.freeze([Object.freeze({kind: 'DENIAL', at: 0.50})]),
  }),
  Object.freeze({
    wave: 4, label: 'FLANK', modifier: 'flanked', timer: 150,
    fronts: Object.freeze({D1: 2, D2: 2, D3: 2, D4: 3}),
    composition: Object.freeze({husk: 5, spitter: 2, lancer: 2, brute: 1}),
    events: Object.freeze([Object.freeze({kind: 'FLANK', at: 0.60})]),
  }),
  Object.freeze({
    wave: 5, label: 'LEGION', modifier: 'champion', timer: 180, boss: true,
    fronts: Object.freeze({D1: 2, D2: 2, D3: 3, D4: 3}),
    composition: Object.freeze({husk: 6, spitter: 2, bulwark: 1, sentinel: 1, mortar: 1, lancer: 1}),
    events: Object.freeze([
      Object.freeze({kind: 'BOSS', at: 0.35}),
      Object.freeze({kind: 'COMBINED_ARMS', at: 0.70}),
    ]),
  }),
]);

export const OPERATIONS_WAVE_COUNT = OPERATIONS_WAVES.length;
export const operationsWave = index => OPERATIONS_WAVES[Math.max(0, Math.min(OPERATIONS_WAVES.length - 1, Math.round(index) - 1))];

// Tier composition pool extras are *added bodies*, never stat swaps. The pool
// is a pure-data list so the same wave scales identically for every seed.
const POOL_EXTRAS = Object.freeze({
  core: Object.freeze([]),
  'core+': Object.freeze([Object.freeze({type: 'sapper', every: 2})]),
  denial: Object.freeze([
    Object.freeze({type: 'sapper', every: 2}),
    Object.freeze({type: 'mender', every: 3}),
    Object.freeze({type: 'overseer', every: 4}),
  ]),
  all: Object.freeze([
    Object.freeze({type: 'bulwark', every: 2}),
    Object.freeze({type: 'mortar', every: 3}),
    Object.freeze({type: 'sentinel', every: 3}),
    Object.freeze({type: 'mender', every: 4}),
  ]),
});

// Deterministic, tier-scaled wave composition. Counts are a pure function of
// (wave, tier); the same inputs always yield the same plan.
export function directorComposition(waveIndex, tierId = DEFAULT_COCS_TIER) {
  const tier = directorTier(tierId);
  const plan = operationsWave(waveIndex);
  const counts = {};
  for (const [type, base] of Object.entries(plan.composition ?? {})) {
    const scaled = Math.max(0, Math.round((base ?? 0) * tier.countScale));
    if (scaled > 0) counts[type] = (counts[type] ?? 0) + scaled;
  }
  const extras = POOL_EXTRAS[tier.compositionPool] ?? [];
  for (const extra of extras) {
    if (plan.wave % extra.every !== 0) continue;
    counts[extra.type] = (counts[extra.type] ?? 0) + 1;
  }
  return counts;
}

// The full plan the engine consumes: composition, scripted events, timers and
// the per-wave front count (tier fronts, clamped to 1 for the tutorial wave).
export function directorWavePlan(waveIndex, tierId = DEFAULT_COCS_TIER) {
  const tier = directorTier(tierId);
  const plan = operationsWave(waveIndex);
  const composition = directorComposition(waveIndex, tierId);
  // Published per-wave fronts (design §3.2). The first wave is always the
  // tutorial: one front regardless of tier.
  const waveFronts = plan.fronts?.[tier.id];
  const resolvedFronts = Number.isFinite(Number(waveFronts)) ? Number(waveFronts) : tier.fronts;
  const fronts = plan.wave === 1 ? 1 : Math.max(1, Math.min(5, Math.round(resolvedFronts)));
  return {
    wave: plan.wave,
    label: plan.label,
    modifier: plan.modifier,
    timer: Math.max(30, Math.round(plan.timer * tier.waveTimerMultiplier)),
    fronts,
    composition,
    events: (plan.events ?? []).map(event => ({...event})),
    boss: plan.boss === true,
    intermission: tier.intermissionSeconds,
  };
}

// Setup-facing wave summary (F06): the same `directorWavePlan` data the engine
// consumes, reduced to the labels the Operations setup screen promises. Frozen
// and deterministic so both the preview and the match read one table.
export function coopWaveSummary(tierId = DEFAULT_COCS_TIER) {
  const tier = directorTier(tierId);
  const waves = OPERATIONS_WAVES.map(plan => directorWavePlan(plan.wave, tier.id));
  const fronts = waves.map(plan => plan.fronts);
  const timers = waves.map(plan => plan.timer);
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  const frontMin = Math.min(...fronts), frontMax = Math.max(...fronts);
  const timerMin = Math.min(...timers), timerMax = Math.max(...timers);
  const frontText = frontMin === frontMax ? `${frontMin} ${frontMin === 1 ? 'FRONT' : 'FRONTS'}` : `${frontMin}–${frontMax} FRONTS`;
  return Object.freeze({
    tier: tier.id,
    count: waves.length,
    frontMin,
    frontMax,
    timerMin,
    timerMax,
    timerText: `${clock(timerMin)}–${clock(timerMax)}`,
    copy: `${waves.length} WAVES · ${frontText} · ${clock(timerMin)}–${clock(timerMax)}`,
    waves: Object.freeze(waves.map(plan => Object.freeze({wave: plan.wave, label: plan.label, fronts: plan.fronts, timer: plan.timer, boss: plan.boss}))),
  });
}

// PRESSURE cost of a composition; used to guarantee "no free stats".
export function compositionCost(composition) {
  let total = 0;
  for (const [type, count] of Object.entries(composition ?? {})) {
    total += (DIRECTOR_COSTS[type] ?? 0) * Math.max(0, Math.round(count ?? 0));
  }
  return total;
}

// The HQ siege (owner decision 1). Once armed, the Director's wave force that
// reaches `hq-0` deals siege damage; team 0 standing on the point repairs it.
export const COOP_SIEGE = Object.freeze({
  hqId: 'hq-0',
  maxHealth: 1400,
  dpsPerAttacker: 8,
  repairPerDefender: 16,
  radius: 16,
  armSeconds: 8,
  armMajority: 3,       // capturable nodes team 1 must hold for the assault
  waveArm: 5,           // the final wave always threatens the HQ with a majority
});

export const SIEGE_ASSAULT_EVENT = 'director-siege';

// Published tier copy table for the HUD/help line. Frozen, pure data.
export function directorTierCopy(tierId = DEFAULT_COCS_TIER) {
  const tier = directorTier(tierId);
  return {
    id: tier.id,
    label: tier.label,
    copy: tier.copy ?? '',
    modifiers: [...(tier.modifiers ?? [])],
    band: [...(tier.band ?? [])],
  };
}

export const DIRECTOR_TIER_COPY = Object.freeze(
  COCS_TIERS.reduce((table, id) => { table[id] = Object.freeze(directorTierCopy(id)); return table; }, {}),
);

// Bonus descriptor by id (null when unknown). Frozen copy of the pure data.
export function bonusObjective(id) {
  const bonus = COOP_BONUS[id];
  return bonus ? {...bonus} : null;
}

// The bonus ids a tier opens, in authored order.
export function tierBonusObjectives(tierId = DEFAULT_COCS_TIER) {
  return COOP_BONUS_ORDER.slice(0, Math.max(0, Math.round(directorTier(tierId).bonusOpen ?? 1)));
}

// Sink descriptor by verb or id (null when unknown).
export function coopSink(idOrVerb) {
  const key = String(idOrVerb ?? '').trim().toUpperCase();
  const sink = COOP_SINKS[key] ?? Object.values(COOP_SINKS).find(entry => entry.id === key || entry.verb === key);
  return sink ? {...sink} : null;
}

// Sink cost for a verb (Infinity when unknown so it can never be afforded).
export function coopSinkCost(idOrVerb) {
  return coopSink(idOrVerb)?.cost ?? Infinity;
}
