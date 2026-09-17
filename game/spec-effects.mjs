import {resolveLoadout} from './data.mjs';
import {OPERATOR_KITS, SPECS} from './kits.mjs';

// ===========================================================================
// Phase 3B: the one place the engine turns the kits.mjs spec descriptors into
// numbers (docs/design/CLASS_OVERHAUL.md §3.3, §3.6, §4.7, §12.2 Phase 3).
//
// Pure, deterministic and **id-free**: every lookup reads a descriptor and
// dispatches on the shared trigger / effect / target vocabulary, never on a
// harness or operator id. `game/wing-riders.test.mjs` scans this source and
// fails if a spec/operator id ever appears here.
//
// Every numeric shaper is clamped to the frozen `EFFECT_BOUNDS` table (§4.7),
// so a future kit-table edit cannot smuggle an unbounded multiplier into the
// sim: the bounds are the last line of defence, and the descriptor tests pin
// the values the engine actually reads.
// ===========================================================================

const KIT_BY_ID = Object.fromEntries(OPERATOR_KITS.map(kit => [kit.id, kit]));
const SPEC_BY_ID = Object.fromEntries(SPECS.map(spec => [spec.id, spec]));

const clampRange = (value, [min, max]) => Math.max(min, Math.min(max, value));

// §4.7 caps, keyed by effect type and numeric field. Types carrying only
// string switches (sprint/placement/holster/cleanse/unstoppable) have no entry.
export const EFFECT_BOUNDS = Object.freeze({
  'melee-arc': {scale: [1, 1.5]},
  reload: {scale: [.7, 1]},
  'air-control': {scale: [1, 1.5]},
  slide: {bonus: [0, .35]},
  radius: {scale: [1, 1.5], bonus: [0, 2]},
  damage: {scale: [.9, 1]},
  distance: {scale: [.5, 1.5]},
  mitigation: {amount: [0, .6]},
  overheal: {amount: [0, .15]},
  slow: {scale: [1, 1.3]},
  speed: {bonus: [0, 1.2], duration: [0, 5]},
  duration: {bonus: [0, 2]},
  cooldown: {bonus: [-1.5, 0]},
  pull: {reel: [0, 12]},
  knockback: {bonus: [0, 6]},
  'threat-ping': {bonus: [0, 2], duration: [.25, 2], range: [5, 35], cooldown: [1, 10]},
  feint: {duration: [.25, 2]},
});

// ---------------------------------------------------------------------------
// Descriptor lookup
// ---------------------------------------------------------------------------

const passiveCache = new Map();

/** The spec's behavioural passive descriptor, or null for unknown harnesses. */
export function passiveOf(harness) {
  if (typeof harness !== 'string') return null;
  if (!passiveCache.has(harness)) {
    const spec = SPEC_BY_ID[harness];
    passiveCache.set(harness, spec ? spec.passive : null);
  }
  return passiveCache.get(harness);
}

const riderCache = new Map();

/**
 * The wing rider for a character x harness pick, or null when either id is
 * missing/unknown. Normalises through `resolveLoadout`, so the Claude Code lock
 * resolves the same way every other loadout path does. Hand-built actors
 * without a character/harness (movement tests) get a neutral null rider.
 */
export function riderOf(character, harness) {
  if (typeof character !== 'string' || typeof harness !== 'string') return null;
  const loadout = resolveLoadout(character, harness);
  const key = `${loadout.character}|${loadout.harness}`;
  let rider = riderCache.get(key);
  if (rider === undefined) {
    const kit = KIT_BY_ID[loadout.character];
    const spec = SPEC_BY_ID[loadout.harness];
    rider = kit && spec ? spec.riders[kit.wing] : null;
    riderCache.set(key, rider);
  }
  return rider;
}

// ---------------------------------------------------------------------------
// Vocabulary dispatch
// ---------------------------------------------------------------------------

const matches = (effect, query) => {
  if (!effect) return false;
  for (const key of Object.keys(query)) {
    if (query[key] === undefined) continue;
    if (effect[key] !== query[key]) return false;
  }
  return true;
};

/** First effect of `type` on `effects` matching every non-undefined query field. */
export function effectOf(effects, type, query = {}) {
  if (!Array.isArray(effects)) return null;
  for (const effect of effects) {
    if (effect.type === type && matches(effect, query)) return effect;
  }
  return null;
}

const bounded = (effect, field, fallback) => {
  const value = Number.isFinite(effect?.[field]) ? effect[field] : fallback;
  const range = effect ? EFFECT_BOUNDS[effect.type]?.[field] : null;
  return range ? clampRange(value, range) : value;
};

/** Effect of `type` on the actor's passive. `query.trigger` dispatches on the
 *  descriptor's own trigger; the remaining fields match the effect entry. */
export function passiveEffect(harness, type, query = {}) {
  const passive = passiveOf(harness);
  if (!passive) return null;
  const {trigger, ...effectQuery} = query;
  if (trigger !== undefined && passive.trigger !== trigger) return null;
  return effectOf(passive.effects, type, effectQuery);
}

/** Bounded `scale` field of a passive effect (1 = neutral fallback). */
export function passiveScale(harness, type, fallback = 1, query = {}) {
  return bounded(passiveEffect(harness, type, query), 'scale', fallback);
}

/** Bounded `bonus` field of a passive effect (0 = neutral fallback). */
export function passiveBonus(harness, type, fallback = 0, query = {}) {
  return bounded(passiveEffect(harness, type, query), 'bonus', fallback);
}

/** Effect of `type` on the character x harness rider. `query.trigger` dispatches
 *  on the rider's own trigger; the remaining fields match the effect entry. */
export function riderEffect(character, harness, type, query = {}) {
  const rider = riderOf(character, harness);
  if (!rider) return null;
  const {trigger, ...effectQuery} = query;
  if (trigger !== undefined && rider.trigger !== trigger) return null;
  return effectOf(rider.effects, type, effectQuery);
}

/** Bounded `scale` field of a rider effect (1 = neutral fallback). */
export function riderScale(character, harness, type, fallback = 1, query = {}) {
  return bounded(riderEffect(character, harness, type, query), 'scale', fallback);
}

/** Bounded `bonus` field of a rider effect (0 = neutral fallback). */
export function riderBonus(character, harness, type, fallback = 0, query = {}) {
  return bounded(riderEffect(character, harness, type, query), 'bonus', fallback);
}

/** Bounded `amount` field of a rider effect (0 = neutral fallback). */
export function riderAmount(character, harness, type, fallback = 0, query = {}) {
  return bounded(riderEffect(character, harness, type, query), 'amount', fallback);
}
