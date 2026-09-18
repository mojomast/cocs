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
    reinforceEvents: 0,
    compositionPool: 'core',
    countScale: 0.9,
    hardened: false,
    denial: false,
    bossPhaseStart: 1,
    rewardMultiplier: 1.0,
  }),
  D2: Object.freeze({
    id: 'D2', label: 'ENCIRCLED',
    fronts: 2,
    rate: 4.5, cap: 280, start: 50,
    intermissionSeconds: 28,
    waveTimerMultiplier: 0.95,
    reinforceSeconds: 9,
    reinforceEvents: 1,
    compositionPool: 'core+',
    countScale: 1.05,
    hardened: false,
    denial: false,
    bossPhaseStart: 1,
    rewardMultiplier: 1.25,
  }),
  D3: Object.freeze({
    id: 'D3', label: 'DENIAL',
    fronts: 2,
    rate: 5.2, cap: 320, start: 60,
    intermissionSeconds: 26,
    waveTimerMultiplier: 0.90,
    reinforceSeconds: 7,
    reinforceEvents: 2,
    compositionPool: 'denial',
    countScale: 1.10,
    hardened: true,
    denial: true,
    bossPhaseStart: 2,
    rewardMultiplier: 1.5,
  }),
  D4: Object.freeze({
    id: 'D4', label: 'OVERWATCH',
    fronts: 3,
    rate: 6, cap: 380, start: 70,
    intermissionSeconds: 24,
    waveTimerMultiplier: 0.80,
    reinforceSeconds: 6,
    reinforceEvents: 2,
    compositionPool: 'all',
    countScale: 1.15,
    hardened: true,
    denial: true,
    bossPhaseStart: 3,
    rewardMultiplier: 2.0,
  }),
});

export const directorTier = id => DIRECTOR_TIERS[id] ?? DIRECTOR_TIERS[DEFAULT_COCS_TIER];
export const isCocsTier = id => COCS_TIERS.includes(String(id ?? '').toUpperCase());
export const normalizeCocsTier = id => (isCocsTier(id) ? String(id).toUpperCase() : DEFAULT_COCS_TIER);

// The mode is 1–8 humans; the persistent Director garrison is capped so a solo
// player is never outnumbered 1v7 by the passive AI. Overflow bot seats fill
// team 0 as AI allies (the "bot-fillable, no queue floor" rule, design §1.2).
export const COOP_GARRISON_BOTS = 2;
// A first-time team is never smaller than this: a solo player is bot-filled up
// to the floor so the operation is winnable without a queue ("bot-fillable, no
// queue floor").
export const COOP_TEAM_FLOOR = 4;

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

// L4D-style pacing: BUILD_UP -> PEAK -> RELAX, with INTERMISSION between waves.
export const COOP_PACING = Object.freeze({
  buildUpFraction: 0.40,
  peakFraction: 0.75,
  rateFactor: Object.freeze({intermission: 0, build_up: 0.5, peak: 1, relax: 0.35}),
  telegraphSeconds: 1.5,
  reinforceSeconds: 6,
  overrunSeconds: 10,
  intermissionLeadSeconds: 3,   // a short "next wave" beat after a clear
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
    composition: Object.freeze({husk: 3, spitter: 1}), events: Object.freeze([]),
  }),
  Object.freeze({
    wave: 2, label: 'PRESSURE', modifier: 'mixed', timer: 150,
    composition: Object.freeze({husk: 4, spitter: 2, sapper: 1}),
    events: Object.freeze([Object.freeze({kind: 'REINFORCE', at: 0.85})]),
  }),
  Object.freeze({
    wave: 3, label: 'DENIAL', modifier: 'artillery', timer: 150,
    composition: Object.freeze({husk: 4, spitter: 2, mender: 1, sapper: 1}),
    events: Object.freeze([Object.freeze({kind: 'DENIAL', at: 0.50})]),
  }),
  Object.freeze({
    wave: 4, label: 'FLANK', modifier: 'flanked', timer: 150,
    composition: Object.freeze({husk: 5, spitter: 2, lancer: 2, brute: 1}),
    events: Object.freeze([Object.freeze({kind: 'FLANK', at: 0.60})]),
  }),
  Object.freeze({
    wave: 5, label: 'LEGION', modifier: 'champion', timer: 180, boss: true,
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
  const fronts = plan.wave === 1 ? 1 : Math.max(1, Math.min(5, tier.fronts));
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
