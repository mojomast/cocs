// ---------------------------------------------------------------------------
// COCS operator signature verbs — the nine always-on class passives of Phase 2
// (docs/design/CLASS_OVERHAUL.md §3.2, rules §4.6, bounded stacking §4.7).
//
// One pure, deterministic module owns the nine verbs. It is data plus small
// hook functions and never imports view/app/three.js/DOM code, never touches
// an actor or a Match, never reads a clock and never rolls an RNG. The lead
// wires it into `Match` at the sites listed below.
//
// API shape (one namespace per verb, all frozen):
//   OPERATOR_VERBS[id]           frozen descriptor: operator, numbers, integration
//   createOperatorVerbState(c)   per-actor state factory (null for other characters)
//   resetOperatorVerbState(s,r)  clears per-life resources at spawn and death
//   stepOperatorVerbState(s,dt,ctx)  routes to the verb's own step(dt)
//   setOperatorVerbActive(s,on)  race/soccer and instagib inert switches
//   operatorVerbSnapshot(s)      plain numeric snapshot for HUD/net
//   EFFORTLESS / REVISION / ...  hook namespaces; every hook takes (state, inputs)
//   operatorHooks(character|state|verbId) -> namespace | null
//
// Contract:
//   - Nothing applies unless the actor's verb is active: every hook returns a
//     neutral value (identity multiplier, zero, empty list, null) for a null,
//     foreign or disabled state.
//   - Hooks read the verb's own state; only `step` and the explicit `on*`
//     functions write it, and they write nothing else.
//   - Numbers are either pinned by the plan (§3.2/§3.7/§4.7/§13.3) or chosen
//     where the plan is silent; every chosen number is marked `chosen` beside
//     its constant below.
//
// Integration contract for `Match` (core.mjs line refs from commit 095a982):
//
//   common
//     Match.actor()           core.mjs:328  verbState: createOperatorVerbState(l.character)
//     Match.spawn()           core.mjs:394  resetOperatorVerbState(a.verbState, 'spawn')
//     death (damage/fall)     core.mjs:406,418  resetOperatorVerbState(a.verbState, 'death')
//     Match.step() actor tick core.mjs:518  stepOperatorVerbState(a.verbState, dt,
//                                            {firing, grounded, sprinting})
//                                            (call after controls resolve at :523 so `firing`
//                                            is the trigger state for this tick)
//     Match.snapshot()        core.mjs:569  verbState: operatorVerbSnapshot(a.verbState)
//
//   actor fields the verbs read (all plain numbers/flags, no new allocation):
//     a.verbState              module state (add to actor, snapshot and quantize)
//     a.grounded / a.sprinting / a.crouching   step inputs, Braced knockback
//     firing                   resolved trigger (ext.fire or bot controls.fire)
//     a.spawnArmor             class spawn armor only — stats.armor, never gear.armor
//     a.armor                  Braced regen cap comparison
//     a.maxHealth              DeepSeek one-shot ceiling
//     a.weapon / a.ammo        Revision/Adaptive swaps, Qwen partial reload
//
//   per-verb call sites are in OPERATOR_VERBS[id].integration.
// ---------------------------------------------------------------------------

import {OPERATOR_KITS} from './kits.mjs';

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

const finiteOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const clamp01 = value => Math.max(0, Math.min(1, value));
// Positive seconds or 0; negative/NaN dt is a no-op that keeps runs deterministic.
const stepSeconds = dt => {
  const seconds = Number(dt);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};
// Delayed decay shared by Heat and Deep Compute: the idle timer absorbs its
// remaining time first, then the meter drains at `rate` per second.
const decayAfterDelay = (state, timerKey, meterKey, seconds, rate) => {
  let remaining = seconds;
  if (state[timerKey] > 0) {
    const used = Math.min(remaining, state[timerKey]);
    state[timerKey] -= used;
    remaining -= used;
  }
  if (remaining > 0 && state[meterKey] > 0) {
    state[meterKey] = Math.max(0, state[meterKey] - rate * remaining);
  }
};
// A hook only applies when the state exists, is enabled and belongs to the verb.
const verbInactive = (state, verb) => !state || typeof state !== 'object' || state.active !== true || state.verb !== verb;

// Shared neutral results (returned by identity, frozen, never allocated on the
// hot path).
const NEUTRAL_AIR_CONTROL = deepFreeze({airAccelMultiplier: 1, airCapMultiplier: 1});
const NEUTRAL_SLIDE = deepFreeze({boostMultiplier: 1, frictionMultiplier: 1, minSecondsBonus: 0});
const NEUTRAL_HOP_WINDOW = deepFreeze({jumpBufferBonus: 0, coyoteBonus: 0});
const NEUTRAL_HANDLING = deepFreeze({interval: 1, spread: 1});
const NEUTRAL_REVIEW = deepFreeze({meter: 0, pool: 0, poolIn: 0, suppressed: false, active: false});

// ---------------------------------------------------------------------------
// Mistral · Effortless — stronger air control, longer slides, forgiving
// slide-hop timing. Movement shape only: no top-speed, damage or resistance
// multiplier, so the §4.7 temporary-speed cap is untouched. Plan silent on the
// exact multipliers; kept small and inside one movement family.
// ---------------------------------------------------------------------------
const EFFORTLESS_AIR_ACCEL_MULTIPLIER = 1.35; // chosen: MOVE.airAccel 3.5 -> 4.725
const EFFORTLESS_AIR_CAP_MULTIPLIER = 1.2; // chosen: MOVE.airCap 1.6 -> 1.92
const EFFORTLESS_SLIDE_BOOST_MULTIPLIER = 1.15; // chosen: MOVE.slideBoost 9.6 -> 11.04
const EFFORTLESS_SLIDE_FRICTION_MULTIPLIER = .8; // chosen: MOVE.slideFriction 2.5 -> 2.0
const EFFORTLESS_SLIDE_MIN_BONUS = .12; // chosen: MOVE.slideMin .35 -> .47 s
const EFFORTLESS_HOP_BUFFER_BONUS = .04; // chosen: jump buffer .12 -> .16 s
const EFFORTLESS_HOP_COYOTE_BONUS = .03; // chosen: coyote .1 -> .13 s

// ---------------------------------------------------------------------------
// Gemini · Revision — two primaries; swapping between them skips holster
// time. The band source is the operator kit itself: the first two entries of
// OPERATOR_KITS.gemini.preferred (slots 0-1, the historical pair, [3, 2]).
// Mode-pinned and Arms Race loads cannot switch at all (core.mjs:447-450), so
// the verb degrades there exactly as §3.2 says, with no extra branch.
// ---------------------------------------------------------------------------
export const REVISION_PRIMARY_BAND = Object.freeze(
  (OPERATOR_KITS.find(kit => kit.id === 'gemini')?.preferred ?? []).slice(0, 2),
);

// ---------------------------------------------------------------------------
// Grok · Heat — consecutive hits build up to +12% fire rate; it decays 1.5 s
// after the last hit and resets on death. Per-hit step and decay rate are
// chosen; the cap and the decay delay are pinned by §3.2/§4.7.
// ---------------------------------------------------------------------------
const HEAT_PER_HIT = .02; // chosen: six consecutive hits reach the cap
const HEAT_MAX = .12; // §3.2/§4.7: +12% fire rate
const HEAT_DECAY_DELAY = 1.5; // §3.2/§4.7: decay starts 1.5 s after the last hit
const HEAT_DECAY_PER_SECOND = .12; // chosen: a full meter drains in 1 s once decay starts

// ---------------------------------------------------------------------------
// DeepSeek · Deep Compute — sustained fire charges the next shot for bonus
// damage. It takes the max with attachment charge (never the product), and the
// final direct hit is clamped so it can never remove more than 90% of a
// full-health target and never more than the §4.7 90-damage single-hit cap.
// ---------------------------------------------------------------------------
const DEEP_COMPUTE_MAX_BONUS = .35; // chosen: +35% at full charge
const DEEP_COMPUTE_BUILD_SECONDS = 1.2; // chosen: 1.2 s of sustained fire fills the meter
const DEEP_COMPUTE_DECAY_DELAY = 1.5; // chosen, mirrors Heat
const DEEP_COMPUTE_DECAY_PER_SECOND = .5; // chosen: half a meter per second
export const SINGLE_HIT_CAP = 90; // §4.7: <= 90 damage on a full-HP/0-armor target
export const ONE_SHOT_HEALTH_FRACTION = .9; // §3.2: the charged shot tops out at ~90% of full HP

// ---------------------------------------------------------------------------
// Meta · Braced — spawn armor (stats.armor, never gear armor) regenerates out
// of combat; disabled while airborne and for 1.5 s after damage; crouching
// without firing halves knockback. Regen rate is chosen.
// ---------------------------------------------------------------------------
const BRACED_COMBAT_SECONDS = 1.5; // §3.2: disabled for 1.5 s after damage
const BRACED_REGEN_PER_SECOND = 5; // chosen: 20 spawn armor in 4 s
const BRACED_KNOCKBACK_MULTIPLIER = .5; // §3.2: crouching halves knockback

// ---------------------------------------------------------------------------
// Claude · Alignment Review — holding ground (grounded, not sprinting, not
// firing) builds a meter; at threshold it grants a temporary absorb pool of 35
// HP for 2.5 s. Absorb, never a resistance multiplier, so it cannot collide
// with Guardrail's 50% clamp. Charge time and the damage pause are chosen;
// pool size and duration are pinned by §3.2.
// ---------------------------------------------------------------------------
const REVIEW_CHARGE_SECONDS = 3; // chosen: 3 s of holding ground fills the meter
const REVIEW_SUPPRESS_SECONDS = 1.5; // chosen: damage pauses the build (does not reset it)
const REVIEW_ABSORB = 35; // §3.2: ~35 HP
const REVIEW_DURATION = 2.5; // §3.2: 2.5 s

// ---------------------------------------------------------------------------
// ChatGPT · Adaptive — fastest weapon swap; the first magazine after a swap
// keeps a small handling bonus. Holster multiplier and handling bonus are
// chosen; the 6 s ceiling bounds infinite-magazine weapons.
// ---------------------------------------------------------------------------
const ADAPTIVE_SWAP_MULTIPLIER = .5; // chosen: .45 s holster -> .225 s, the fastest swap
const ADAPTIVE_FIRST_MAG_SECONDS = 6; // chosen: window ceiling when the magazine never ends
const ADAPTIVE_INTERVAL_MULTIPLIER = .94; // chosen: -6% interval, far under §4.7's /2.2
const ADAPTIVE_SPREAD_MULTIPLIER = .95; // chosen

// ---------------------------------------------------------------------------
// Kimi · Long Context — enemies leave brief radar trails and the range band
// pushes slightly past other operators. TTL and cadence are pinned by
// §3.2/§4.7; the range multiplier is chosen.
// ---------------------------------------------------------------------------
const LONG_CONTEXT_TRAIL_TTL = 1.5; // §3.2/§4.7: TTL <= 1.5 s
const LONG_CONTEXT_TRAIL_INTERVAL = 3; // §3.2/§4.7: one trail per enemy per 3 s
const LONG_CONTEXT_RANGE_MULTIPLIER = 1.08; // chosen: "slightly longer" band

// ---------------------------------------------------------------------------
// Qwen · Tool Use — faster pickups and timed objectives (cap 1.35x, never on
// flag pickup/capture), better vehicles, plus a bounded combat floor: a
// partial reload and 2 s of faster handling on ammo/weapon pickups, and +15%
// melee reach. Vehicle handling combines with a harness skill by max, never
// product; the repair tick is the only additive vehicle effect (§4.7).
// ---------------------------------------------------------------------------
const TOOL_USE_INTERACTION_CAP = 1.35; // §3.2/§4.7: interaction cap
const TOOL_USE_HANDLING_SECONDS = 2; // §3.2: 2 s of faster handling after a pickup
const TOOL_USE_INTERVAL_MULTIPLIER = .92; // chosen: -8% interval
const TOOL_USE_SPREAD_MULTIPLIER = .94; // chosen
const TOOL_USE_RELOAD_FRACTION = .5; // chosen: partial reload = half a magazine
const TOOL_USE_MELEE_REACH_MULTIPLIER = 1.15; // §3.2: +15% melee/tool reach
const TOOL_USE_VEHICLE = deepFreeze({traverse: 1.15, speed: 1.05, boost: 1.1, repairPerSecond: 4});

// ---------------------------------------------------------------------------
// Hook namespaces. Every hook returns plain numbers/flags (or a frozen object
// of them) and no-ops to its neutral value unless the verb is active.
// ---------------------------------------------------------------------------

export const EFFORTLESS = Object.freeze({
  id: 'effortless',
  // moveActor air branch: scale MOVE.airAccel and the MOVE.airCap add-cap.
  airControl(state) {
    if (verbInactive(state, 'effortless')) return NEUTRAL_AIR_CONTROL;
    return {
      airAccelMultiplier: EFFORTLESS_AIR_ACCEL_MULTIPLIER,
      airCapMultiplier: EFFORTLESS_AIR_CAP_MULTIPLIER,
    };
  },
  // moveActor slide branch: scale MOVE.slideBoost, MOVE.slideFriction and add
  // seconds on top of MOVE.slideMin.
  slide(state) {
    if (verbInactive(state, 'effortless')) return NEUTRAL_SLIDE;
    return {
      boostMultiplier: EFFORTLESS_SLIDE_BOOST_MULTIPLIER,
      frictionMultiplier: EFFORTLESS_SLIDE_FRICTION_MULTIPLIER,
      minSecondsBonus: EFFORTLESS_SLIDE_MIN_BONUS,
    };
  },
  // moveActor hop branch: add seconds to the jump buffer (.12) and coyote (.1).
  hopWindow(state) {
    if (verbInactive(state, 'effortless')) return NEUTRAL_HOP_WINDOW;
    return {jumpBufferBonus: EFFORTLESS_HOP_BUFFER_BONUS, coyoteBonus: EFFORTLESS_HOP_COYOTE_BONUS};
  },
  step(state) {
    return state;
  },
  snapshot() {
    return {};
  },
});

export const REVISION = Object.freeze({
  id: 'revision',
  // The frozen two-primary band (source: OPERATOR_KITS.gemini.preferred[0..1]).
  band() {
    return REVISION_PRIMARY_BAND;
  },
  isPrimary(index) {
    return Number.isInteger(index) && REVISION_PRIMARY_BAND.includes(index);
  },
  // Does this swap skip holster time? Both endpoints must be band primaries.
  skipsHolster(state, {from, to} = {}) {
    if (verbInactive(state, 'revision')) return false;
    return REVISION.isPrimary(from) && REVISION.isPrimary(to);
  },
  // Holster seconds for Match.switchWeapon: 0 between the two primaries, the
  // caller's base otherwise.
  swapSeconds(state, {from, to, base = .45} = {}) {
    const holster = Math.max(0, finiteOr(base, .45));
    return REVISION.skipsHolster(state, {from, to}) ? 0 : holster;
  },
  step(state) {
    return state;
  },
  snapshot() {
    return {};
  },
});

const heatValue = state => (verbInactive(state, 'heat') ? 0 : Math.max(0, state.heat || 0));

export const HEAT = Object.freeze({
  id: 'heat',
  // One landed hit adds a stack and re-arms the 1.5 s idle decay.
  onHitLanded(state, {amount = 1} = {}) {
    if (verbInactive(state, 'heat')) return 0;
    const stacks = finiteOr(amount, 0);
    if (!(stacks > 0)) return state.heat || 0;
    state.heat = Math.min(HEAT_MAX, (state.heat || 0) + HEAT_PER_HIT * stacks);
    state.decayIn = HEAT_DECAY_DELAY;
    return state.heat;
  },
  step(state, dt) {
    if (verbInactive(state, 'heat')) return 0;
    const seconds = stepSeconds(dt);
    if (seconds <= 0) return state.heat || 0;
    decayAfterDelay(state, 'decayIn', 'heat', seconds, HEAT_DECAY_PER_SECOND);
    return state.heat;
  },
  // Match.fire(): a.shotWait /= HEAT.fireRateMultiplier(state).
  fireRateMultiplier(state) {
    if (verbInactive(state, 'heat')) return 1;
    return 1 + Math.min(HEAT_MAX, Math.max(0, state.heat || 0));
  },
  heat(state) {
    return heatValue(state);
  },
  // 0..1 for the visible glow / HUD meter.
  glow(state) {
    return clamp01(heatValue(state) / HEAT_MAX);
  },
  snapshot(state) {
    return {heat: verbInactive(state, 'heat') ? 0 : state.heat || 0, decayIn: state?.decayIn || 0};
  },
});

const deepComputeMultiplier = (state, attachmentCharge) => {
  const attachment = Math.max(1, finiteOr(attachmentCharge, 1));
  if (verbInactive(state, 'deep-compute')) return attachment;
  const compute = 1 + DEEP_COMPUTE_MAX_BONUS * clamp01(state.charge || 0);
  return Math.max(1, attachment, compute);
};

export const DEEP_COMPUTE = Object.freeze({
  id: 'deep-compute',
  // Hold-fire step: builds while the trigger is held, decays 1.5 s after.
  step(state, dt, {firing = false} = {}) {
    if (verbInactive(state, 'deep-compute')) return 0;
    const seconds = stepSeconds(dt);
    if (seconds <= 0) return state.charge || 0;
    if (firing === true) {
      state.charge = clamp01((state.charge || 0) + seconds / DEEP_COMPUTE_BUILD_SECONDS);
      state.decayIn = DEEP_COMPUTE_DECAY_DELAY;
    } else {
      decayAfterDelay(state, 'decayIn', 'charge', seconds, DEEP_COMPUTE_DECAY_PER_SECOND);
    }
    return state.charge;
  },
  charge(state) {
    return verbInactive(state, 'deep-compute') ? 0 : clamp01(state.charge || 0);
  },
  // Effective bonus multiplier: max of the compute charge and the attachment
  // charge — never the product. No target clamp here; `onShot` applies it.
  multiplier(state, {attachmentCharge = 1} = {}) {
    return deepComputeMultiplier(state, attachmentCharge);
  },
  // Match.fire() direct-hit damage. `baseDamage` is the weapon direct damage
  // before the charge scale, `attachmentCharge` the resolved charge-coil style
  // multiplier (1 when none), `targetHealth` the target's full health. Consumes
  // the charge exactly like a fired shot.
  onShot(state, {baseDamage = 0, damageScale = 1, attachmentCharge = 1, targetHealth} = {}) {
    const base = Math.max(0, finiteOr(baseDamage, 0)) * Math.max(0, finiteOr(damageScale, 1));
    if (verbInactive(state, 'deep-compute')) {
      const attachment = Math.max(1, finiteOr(attachmentCharge, 1));
      const damage = base * attachment;
      return {multiplier: attachment, damage, bonus: Math.max(0, damage - base), charge: 0, capped: false, ceiling: null};
    }
    const charge = clamp01(state.charge || 0);
    const multiplier = deepComputeMultiplier(state, attachmentCharge);
    const raw = base * multiplier;
    const ceiling = singleHitCeiling(targetHealth);
    const damage = Math.min(raw, ceiling);
    state.charge = 0;
    state.decayIn = 0;
    return {
      multiplier: base > 0 ? damage / base : multiplier,
      damage,
      bonus: Math.max(0, damage - base),
      charge,
      capped: damage < raw,
      ceiling,
    };
  },
  // Pure clamp for call sites that already built the charged damage (rockets,
  // splash, chain): never above the §4.7 90 cap and never above 90% of the
  // target's full health.
  clampShot(state, damage, {targetHealth} = {}) {
    const value = Math.max(0, finiteOr(damage, 0));
    if (verbInactive(state, 'deep-compute')) return value;
    return Math.min(value, singleHitCeiling(targetHealth));
  },
  snapshot(state) {
    return {charge: verbInactive(state, 'deep-compute') ? 0 : clamp01(state.charge || 0), decayIn: state?.decayIn || 0};
  },
});

export const BRACED = Object.freeze({
  id: 'braced',
  // Any actual damage taken restarts the 1.5 s out-of-combat window (Braced).
  onDamage(state) {
    if (verbInactive(state, 'braced')) return 0;
    state.combatIn = BRACED_COMBAT_SECONDS;
    return state.combatIn;
  },
  step(state, dt) {
    if (verbInactive(state, 'braced')) return 0;
    const seconds = stepSeconds(dt);
    if (seconds > 0) state.combatIn = Math.max(0, (state.combatIn || 0) - seconds);
    return state.combatIn;
  },
  // Armor restored this step, capped at the class spawn armor (stats.armor,
  // never gear.armor) and at whatever is missing. Zero while airborne,
  // suppressed, or already at the cap.
  armorRegen(state, dt, {spawnArmor = 0, currentArmor = 0, grounded = true} = {}) {
    if (verbInactive(state, 'braced')) return 0;
    const cap = Math.max(0, finiteOr(spawnArmor, 0));
    const current = Math.max(0, finiteOr(currentArmor, 0));
    if (cap <= 0 || current >= cap) return 0;
    if (grounded !== true || (state.combatIn || 0) > 0) return 0;
    const seconds = stepSeconds(dt);
    if (seconds <= 0) return 0;
    return Math.min(cap - current, BRACED_REGEN_PER_SECOND * seconds);
  },
  regenActive(state, {spawnArmor = 0, currentArmor = 0, grounded = true} = {}) {
    if (verbInactive(state, 'braced')) return false;
    const cap = Math.max(0, finiteOr(spawnArmor, 0));
    const current = Math.max(0, finiteOr(currentArmor, 0));
    return cap > 0 && current < cap && grounded === true && (state.combatIn || 0) <= 0;
  },
  // Crouching without firing halves incoming knockback; all other states are 1.
  knockbackMultiplier(state, {crouching = false, firing = false} = {}) {
    if (verbInactive(state, 'braced')) return 1;
    return crouching === true && firing !== true ? BRACED_KNOCKBACK_MULTIPLIER : 1;
  },
  snapshot(state) {
    return {combatIn: verbInactive(state, 'braced') ? 0 : state?.combatIn || 0};
  },
});

const reviewStatus = state => {
  if (verbInactive(state, 'alignment-review')) return NEUTRAL_REVIEW;
  return {
    meter: clamp01(state.meter || 0),
    pool: Math.max(0, state.pool || 0),
    poolIn: Math.max(0, state.poolIn || 0),
    suppressed: (state.suppressIn || 0) > 0,
    active: (state.pool || 0) > 0,
  };
};

export const ALIGNMENT_REVIEW = Object.freeze({
  id: 'alignment-review',
  // Hold-ground step: builds while grounded and not sprinting/firing, pauses
  // 1.5 s after damage, grants the pool at 100%, ticks the pool down.
  step(state, dt, {grounded = true, sprinting = false, firing = false} = {}) {
    if (verbInactive(state, 'alignment-review')) return NEUTRAL_REVIEW;
    const seconds = stepSeconds(dt);
    if (seconds > 0) {
      if (state.suppressIn > 0) state.suppressIn = Math.max(0, state.suppressIn - seconds);
      if (state.pool > 0) {
        state.poolIn = Math.max(0, state.poolIn - seconds);
        if (state.poolIn === 0) {
          state.pool = 0;
          state.meter = 0;
        }
      } else if (state.suppressIn === 0 && grounded === true && sprinting !== true && firing !== true) {
        state.meter = clamp01((state.meter || 0) + seconds / REVIEW_CHARGE_SECONDS);
        if (state.meter >= 1) {
          state.meter = 0;
          state.pool = REVIEW_ABSORB;
          state.poolIn = REVIEW_DURATION;
        }
      }
    }
    return reviewStatus(state);
  },
  onDamage(state) {
    if (verbInactive(state, 'alignment-review')) return 0;
    state.suppressIn = REVIEW_SUPPRESS_SECONDS;
    return state.suppressIn;
  },
  status(state) {
    return reviewStatus(state);
  },
  meter(state) {
    return reviewStatus(state).meter;
  },
  absorbActive(state) {
    return reviewStatus(state).active;
  },
  absorbPool(state) {
    return reviewStatus(state).pool;
  },
  // Consume the absorb pool before armor/health. Returns plain numbers; the
  // pool caps at 35 and expires on its own, so it can never stack.
  absorb(state, damage) {
    const incoming = Math.max(0, finiteOr(damage, 0));
    if (verbInactive(state, 'alignment-review')) return {absorbed: 0, remaining: incoming, pool: 0, broke: false};
    const pool = Math.max(0, state.pool || 0);
    const absorbed = Math.min(pool, incoming);
    state.pool = pool - absorbed;
    const broke = absorbed > 0 && state.pool <= 0;
    if (broke) {
      state.pool = 0;
      state.poolIn = 0;
      state.meter = 0;
    }
    return {absorbed, remaining: incoming - absorbed, pool: state.pool, broke};
  },
  snapshot(state) {
    if (verbInactive(state, 'alignment-review')) return {meter: 0, pool: 0, poolIn: 0, suppressIn: 0};
    return {
      meter: clamp01(state.meter || 0),
      pool: Math.max(0, state.pool || 0),
      poolIn: Math.max(0, state.poolIn || 0),
      suppressIn: Math.max(0, state.suppressIn || 0),
    };
  },
});

export const ADAPTIVE = Object.freeze({
  id: 'adaptive',
  // Match.switchWeapon(): scale the .45 s holster by half.
  swapDelay(state, baseHolster = .45) {
    const base = Math.max(0, finiteOr(baseHolster, .45));
    return verbInactive(state, 'adaptive') ? base : base * ADAPTIVE_SWAP_MULTIPLIER;
  },
  // Call after a successful swap. `magazine` is the new weapon's rounds per
  // magazine (w.ammo), or 0 when unlimited/unknown: the 6 s window still ends.
  onSwap(state, {magazine = 0} = {}) {
    if (verbInactive(state, 'adaptive')) return false;
    const rounds = finiteOr(magazine, 0);
    state.open = true;
    state.windowIn = ADAPTIVE_FIRST_MAG_SECONDS;
    state.shotsLeft = rounds > 0 ? Math.ceil(rounds) : 0;
    return true;
  },
  onShot(state) {
    if (verbInactive(state, 'adaptive') || state.open !== true) return 0;
    if (state.shotsLeft > 0) {
      state.shotsLeft -= 1;
      if (state.shotsLeft <= 0) state.open = false;
    }
    return state.shotsLeft;
  },
  onReload(state) {
    if (verbInactive(state, 'adaptive')) return false;
    state.open = false;
    state.windowIn = 0;
    state.shotsLeft = 0;
    return true;
  },
  step(state, dt) {
    if (verbInactive(state, 'adaptive') || state.open !== true) return false;
    const seconds = stepSeconds(dt);
    if (seconds > 0) state.windowIn = Math.max(0, (state.windowIn || 0) - seconds);
    if (state.windowIn <= 0) {
      state.open = false;
      state.shotsLeft = 0;
    }
    return state.open;
  },
  windowActive(state) {
    return !verbInactive(state, 'adaptive') && state.open === true;
  },
  // Match.fire(): shotWait *= handling.interval; effectiveSpread *= handling.spread.
  handling(state) {
    if (!ADAPTIVE.windowActive(state)) return NEUTRAL_HANDLING;
    return {interval: ADAPTIVE_INTERVAL_MULTIPLIER, spread: ADAPTIVE_SPREAD_MULTIPLIER};
  },
  snapshot(state) {
    return {
      open: !verbInactive(state, 'adaptive') && state.open === true,
      windowIn: Math.max(0, state?.windowIn || 0),
      shotsLeft: Math.max(0, state?.shotsLeft || 0),
    };
  },
});

export const LONG_CONTEXT = Object.freeze({
  id: 'long-context',
  // Record a radar trail for one enemy. Rejects cloaked/invisible enemies and
  // enforces one trail per enemy per 3 s; each trail lives at most 1.5 s.
  record(state, {enemyId, x, z, cloaked = false, visible = true} = {}) {
    if (verbInactive(state, 'long-context') || cloaked === true || visible === false) return null;
    if (!Number.isInteger(enemyId)) return null;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    if ((state.cooldowns[enemyId] || 0) > 0) return null;
    const existing = state.trails.findIndex(trail => trail.enemyId === enemyId);
    if (existing >= 0) state.trails.splice(existing, 1);
    const trail = {enemyId, x, z, ttl: LONG_CONTEXT_TRAIL_TTL};
    state.trails.push(trail);
    state.cooldowns[enemyId] = LONG_CONTEXT_TRAIL_INTERVAL;
    return trail;
  },
  step(state, dt) {
    if (verbInactive(state, 'long-context')) return 0;
    const seconds = stepSeconds(dt);
    if (seconds <= 0) return state.trails.length;
    for (const trail of state.trails) trail.ttl -= seconds;
    state.trails = state.trails.filter(trail => trail.ttl > 0);
    for (const id of Object.keys(state.cooldowns)) {
      const left = state.cooldowns[id] - seconds;
      if (left <= 0) delete state.cooldowns[id];
      else state.cooldowns[id] = left;
    }
    return state.trails.length;
  },
  trails(state) {
    if (verbInactive(state, 'long-context')) return [];
    return state.trails.map(trail => ({...trail}));
  },
  // Match.fire() range sites: scale w.range and falloff start/end distances.
  rangeMultiplier(state) {
    return verbInactive(state, 'long-context') ? 1 : LONG_CONTEXT_RANGE_MULTIPLIER;
  },
  snapshot(state) {
    if (verbInactive(state, 'long-context')) return {trails: [], cooldowns: {}};
    return {
      trails: state.trails.map(trail => ({...trail})),
      cooldowns: {...state.cooldowns},
    };
  },
});

export const TOOL_USE = Object.freeze({
  id: 'tool-use',
  // Rate multiplier for anything with a duration. 'objective' covers timed
  // objectives; 'pickup' covers pickup interactions that have a channel.
  // Flags (pickup or capture) always return 1 per §3.7/§4.7.
  interactionMultiplier(state, {kind = 'objective'} = {}) {
    if (verbInactive(state, 'tool-use')) return 1;
    return kind === 'objective' || kind === 'pickup' ? TOOL_USE_INTERACTION_CAP : 1;
  },
  // Ammo/weapon pickup floor: partial reload + a 2 s handling window; returns
  // the rounds to add and whether the window opened; `reload` is bounded by
  // the missing ammo and refuses infinite magazines.
  onPickup(state, {magazine = 0, ammo = 0, cap = 0} = {}) {
    if (verbInactive(state, 'tool-use')) return {reload: 0, active: false};
    state.windowIn = TOOL_USE_HANDLING_SECONDS;
    const rounds = finiteOr(magazine, 0);
    const limit = finiteOr(cap, 0);
    const have = finiteOr(ammo, 0);
    if (!(rounds > 0) || !(limit > 0)) return {reload: 0, active: true};
    const missing = Math.max(0, limit - have);
    return {reload: Math.min(missing, Math.ceil(rounds * TOOL_USE_RELOAD_FRACTION)), active: true};
  },
  step(state, dt) {
    if (verbInactive(state, 'tool-use')) return false;
    const seconds = stepSeconds(dt);
    if (seconds > 0) state.windowIn = Math.max(0, (state.windowIn || 0) - seconds);
    return (state.windowIn || 0) > 0;
  },
  windowActive(state) {
    return !verbInactive(state, 'tool-use') && (state.windowIn || 0) > 0;
  },
  handling(state) {
    if (!TOOL_USE.windowActive(state)) return NEUTRAL_HANDLING;
    return {interval: TOOL_USE_INTERVAL_MULTIPLIER, spread: TOOL_USE_SPREAD_MULTIPLIER};
  },
  // Match.melee(): MELEE.range * meleeRange multiplier.
  meleeRange(state, baseRange = 2.4) {
    const base = Math.max(0, finiteOr(baseRange, 2.4));
    if (verbInactive(state, 'tool-use')) return base;
    return base * TOOL_USE_MELEE_REACH_MULTIPLIER;
  },
  // Vehicle trait: handling combines with a harness skill by max, never
  // product; repairPerSecond is added (the only additive vehicle effect).
  vehicle(state) {
    return verbInactive(state, 'tool-use') ? null : TOOL_USE_VEHICLE;
  },
  snapshot(state) {
    return {windowIn: verbInactive(state, 'tool-use') ? 0 : Math.max(0, state?.windowIn || 0)};
  },
});

export const OPERATOR_HOOKS = deepFreeze({
  effortless: EFFORTLESS,
  revision: REVISION,
  heat: HEAT,
  'deep-compute': DEEP_COMPUTE,
  braced: BRACED,
  'alignment-review': ALIGNMENT_REVIEW,
  adaptive: ADAPTIVE,
  'long-context': LONG_CONTEXT,
  'tool-use': TOOL_USE,
});

// ---------------------------------------------------------------------------
// Descriptors: what each verb is, the exact numbers it applies, and the core
// sites that call it. `numbers` mirrors the constants above (single source).
// ---------------------------------------------------------------------------
const rawVerbs = {
  effortless: {
    id: 'effortless',
    name: 'Effortless',
    operator: 'mistral',
    wing: 'striker',
    summary: 'Stronger air control, longer slides and a more forgiving slide-hop window; movement shape only, never a top-speed multiplier.',
    numbers: {
      airAccelMultiplier: EFFORTLESS_AIR_ACCEL_MULTIPLIER,
      airCapMultiplier: EFFORTLESS_AIR_CAP_MULTIPLIER,
      slideBoostMultiplier: EFFORTLESS_SLIDE_BOOST_MULTIPLIER,
      slideFrictionMultiplier: EFFORTLESS_SLIDE_FRICTION_MULTIPLIER,
      slideMinSecondsBonus: EFFORTLESS_SLIDE_MIN_BONUS,
      hopJumpBufferBonus: EFFORTLESS_HOP_BUFFER_BONUS,
      hopCoyoteBonus: EFFORTLESS_HOP_COYOTE_BONUS,
    },
    integration: [
      {site: 'moveActor air branch (core.mjs:135-142)', call: 'EFFORTLESS.airControl(state)', effect: 'scale MOVE.airAccel and the MOVE.airCap add-cap'},
      {site: 'moveActor slide enter/friction (core.mjs:118-131)', call: 'EFFORTLESS.slide(state)', effect: 'scale MOVE.slideBoost / MOVE.slideFriction, add to MOVE.slideMin'},
      {site: 'moveActor hop buffer/coyote (core.mjs:126-147)', call: 'EFFORTLESS.hopWindow(state)', effect: 'add seconds to the jump buffer (.12) and coyote (.1)'},
    ],
  },
  revision: {
    id: 'revision',
    name: 'Revision',
    operator: 'gemini',
    wing: 'striker',
    summary: 'Carries two primaries; swapping between them skips holster time. Bloom persistence and mode-pinned/Arms Race degradation are the existing core rules.',
    numbers: {band: REVISION_PRIMARY_BAND.slice(), holsterSeconds: 0, fallbackHolsterSeconds: .45},
    integration: [
      {site: 'Match.switchWeapon() holster (core.mjs:452)', call: 'REVISION.swapSeconds(state, {from: a.weapon, to: index, base: .45})', effect: '0 s holster between band primaries, .45 s otherwise'},
      {site: 'loadout/band source', call: 'REVISION.band(state)', effect: 'OPERATOR_KITS.gemini.preferred[0..1] = [3, 2]'},
    ],
  },
  heat: {
    id: 'heat',
    name: 'Heat',
    operator: 'grok',
    wing: 'striker',
    summary: 'Consecutive hits build Heat to +12% fire rate; it decays 1.5 s after the last hit and resets on death.',
    numbers: {perHit: HEAT_PER_HIT, maxFireRateBonus: HEAT_MAX, decayDelay: HEAT_DECAY_DELAY, decayPerSecond: HEAT_DECAY_PER_SECOND},
    integration: [
      {site: 'Match.damage() source side (core.mjs:396)', call: 'HEAT.onHitLanded(source.verbState)', effect: 'one stack per landed damaging hit; self and vehicle damage excluded'},
      {site: 'Match.step() actor tick (core.mjs:518)', call: 'HEAT.step(a.verbState, dt)', effect: 'idle decay starts 1.5 s after the last hit'},
      {site: 'Match.fire() interval (core.mjs:472)', call: 'HEAT.fireRateMultiplier(a.verbState)', effect: 'divide shotWait by up to 1.12 (within the §4.7 effectiveInterval rule)'},
      {site: 'HUD glow', call: 'HEAT.glow(a.verbState)', effect: '0..1 visible glow'},
    ],
  },
  'deep-compute': {
    id: 'deep-compute',
    name: 'Deep Compute',
    operator: 'deepseek',
    wing: 'vanguard',
    summary: 'Sustained fire charges the next shot for bonus damage, taking the max with attachment charge and never one-shotting a full-health target.',
    numbers: {
      maxBonusMultiplier: DEEP_COMPUTE_MAX_BONUS,
      buildSeconds: DEEP_COMPUTE_BUILD_SECONDS,
      decayDelay: DEEP_COMPUTE_DECAY_DELAY,
      decayPerSecond: DEEP_COMPUTE_DECAY_PER_SECOND,
      singleHitCap: SINGLE_HIT_CAP,
      oneShotHealthFraction: ONE_SHOT_HEALTH_FRACTION,
    },
    integration: [
      {site: 'Match.step() actor tick (core.mjs:518)', call: 'DEEP_COMPUTE.step(a.verbState, dt, {firing})', effect: 'builds while the trigger is held, decays 1.5 s after release'},
      {site: 'Match.fire() charge scale (core.mjs:469-471)', call: 'DEEP_COMPUTE.multiplier(a.verbState, {attachmentCharge: w.chargeTime > 0 ? (w.chargeDamage || 1) : 1})', effect: 'max(compute, attachment), never the product'},
      {site: 'Match.fire() direct hit (core.mjs:486) and projectile explode (core.mjs:495)', call: 'DEEP_COMPUTE.onShot / clampShot(a.verbState, damage, {targetHealth: target.maxHealth})', effect: 'consume charge; clamp to min(90, 90% of full health)'},
      {site: 'HUD charge meter', call: 'DEEP_COMPUTE.charge(a.verbState)', effect: '0..1 visible charge'},
    ],
  },
  braced: {
    id: 'braced',
    name: 'Braced',
    operator: 'meta',
    wing: 'vanguard',
    summary: 'Spawn armor regenerates out of combat (never gear armor, disabled airborne for 1.5 s after damage); crouching without firing halves knockback.',
    numbers: {combatSeconds: BRACED_COMBAT_SECONDS, regenPerSecond: BRACED_REGEN_PER_SECOND, knockbackMultiplier: BRACED_KNOCKBACK_MULTIPLIER},
    integration: [
      {site: 'Match.damage() target side (core.mjs:396)', call: 'BRACED.onDamage(target.verbState)', effect: 'restart the 1.5 s out-of-combat window'},
      {site: 'Match.spawn() store class armor (core.mjs:393-394)', call: 'a.spawnArmor = stats.armor', effect: 'regen cap; gear.armor must not raise it'},
      {site: 'Match.step() actor tick (core.mjs:518)', call: 'BRACED.armorRegen(state, dt, {spawnArmor: a.spawnArmor, currentArmor: a.armor, grounded: a.grounded})', effect: 'add the returned armor, capped at spawn armor'},
      {site: 'knockback impulse sites (core.mjs:429, 495, 548)', call: 'BRACED.knockbackMultiplier(b.verbState, {crouching: b.crouching, firing})', effect: 'halve the impulse while crouching and not firing'},
    ],
  },
  'alignment-review': {
    id: 'alignment-review',
    name: 'Alignment Review',
    operator: 'claude',
    wing: 'vanguard',
    summary: 'Holding ground builds a meter; at threshold it grants a 35 HP absorb pool for 2.5 s. Absorb, never a resistance multiplier.',
    numbers: {chargeSeconds: REVIEW_CHARGE_SECONDS, suppressSeconds: REVIEW_SUPPRESS_SECONDS, absorb: REVIEW_ABSORB, duration: REVIEW_DURATION},
    integration: [
      {site: 'Match.step() actor tick (core.mjs:518)', call: 'ALIGNMENT_REVIEW.step(state, dt, {grounded: a.grounded, sprinting: a.sprinting, firing})', effect: 'builds meter, grants/expires the absorb pool'},
      {site: 'Match.damage() target side (core.mjs:396)', call: 'ALIGNMENT_REVIEW.onDamage(target.verbState)', effect: 'pause the build for 1.5 s'},
      {site: 'Match.damage() shield stages (core.mjs:396)', call: 'ALIGNMENT_REVIEW.absorb(target.verbState, damage)', effect: 'consume the pool after temporaryShield/juggernautShield, before armor'},
      {site: 'HUD review meter', call: 'ALIGNMENT_REVIEW.status(state)', effect: 'meter/pool/seconds for the ring'},
    ],
  },
  adaptive: {
    id: 'adaptive',
    name: 'Adaptive',
    operator: 'chatgpt',
    wing: 'tactician',
    summary: 'Fastest weapon swap; the first magazine after a swap keeps a small interval/spread handling bonus, bounded by shots, reload, next swap or 6 s.',
    numbers: {
      swapMultiplier: ADAPTIVE_SWAP_MULTIPLIER,
      firstMagSeconds: ADAPTIVE_FIRST_MAG_SECONDS,
      intervalMultiplier: ADAPTIVE_INTERVAL_MULTIPLIER,
      spreadMultiplier: ADAPTIVE_SPREAD_MULTIPLIER,
    },
    integration: [
      {site: 'Match.switchWeapon() holster (core.mjs:452)', call: 'ADAPTIVE.swapDelay(a.verbState, .45)', effect: 'halve the holster; then ADAPTIVE.onSwap(state, {magazine: min(a.ammo[i], w.ammo)})'},
      {site: 'Match.fire() interval/spread (core.mjs:472, 478)', call: 'ADAPTIVE.handling(a.verbState)', effect: 'interval x.94, spread x.95 while the first magazine lasts'},
      {site: 'Match.fire() shot / Match.startReload() (core.mjs:472, 430-438)', call: 'ADAPTIVE.onShot(state) / ADAPTIVE.onReload(state)', effect: 'consume the window'},
      {site: 'Match.step() actor tick (core.mjs:518)', call: 'ADAPTIVE.step(a.verbState, dt)', effect: '6 s window ceiling'},
    ],
  },
  'long-context': {
    id: 'long-context',
    name: 'Long Context',
    operator: 'kimi',
    wing: 'tactician',
    summary: 'Enemy movement leaves brief radar trails (TTL 1.5 s, one per enemy per 3 s, cloak suppresses) and the range band pushes slightly past other operators.',
    numbers: {trailTtl: LONG_CONTEXT_TRAIL_TTL, trailInterval: LONG_CONTEXT_TRAIL_INTERVAL, rangeMultiplier: LONG_CONTEXT_RANGE_MULTIPLIER},
    integration: [
      {site: 'Match.step() actor tick (core.mjs:518)', call: 'LONG_CONTEXT.record(state, {enemyId, x, z, cloaked: Boolean(enemy.powerups?.cloak), visible})', effect: 'one fresh trail per enemy per 3 s while visible'},
      {site: 'Match.step() actor tick (core.mjs:518)', call: 'LONG_CONTEXT.step(state, dt)', effect: 'expire trails after 1.5 s and tick cooldowns'},
      {site: 'Match.fire() range/falloff (core.mjs:479-486)', call: 'LONG_CONTEXT.rangeMultiplier(state)', effect: 'scale w.range and falloff start/end by 1.08'},
      {site: 'HUD/radar (view.mjs)', call: 'LONG_CONTEXT.trails(state)', effect: 'draw copied trail points'},
    ],
  },
  'tool-use': {
    id: 'tool-use',
    name: 'Tool Use',
    operator: 'qwen',
    wing: 'tactician',
    summary: 'Faster timed objectives and pickup channels (cap 1.35x, never flags), better vehicles, plus a combat floor: partial reload + 2 s handling on pickups and +15% melee reach.',
    numbers: {
      interactionCap: TOOL_USE_INTERACTION_CAP,
      handlingSeconds: TOOL_USE_HANDLING_SECONDS,
      intervalMultiplier: TOOL_USE_INTERVAL_MULTIPLIER,
      spreadMultiplier: TOOL_USE_SPREAD_MULTIPLIER,
      reloadFraction: TOOL_USE_RELOAD_FRACTION,
      meleeReachMultiplier: TOOL_USE_MELEE_REACH_MULTIPLIER,
      vehicle: TOOL_USE_VEHICLE,
    },
    integration: [
      {site: 'objectives.mjs progress rates (zones/payload/uplink/extraction/holdout)', call: 'TOOL_USE.interactionMultiplier(state, {kind: "objective"})', effect: 'multiply progress dt by 1.35, never flag pickup/capture'},
      {site: 'Match.collect() ammo/weapon pickups (core.mjs:497)', call: 'TOOL_USE.onPickup(state, {magazine, ammo, cap})', effect: 'add the returned rounds, open the 2 s window'},
      {site: 'Match.fire() interval/spread (core.mjs:472, 478)', call: 'TOOL_USE.handling(state)', effect: 'interval x.92, spread x.94 during the window'},
      {site: 'Match.melee() range (core.mjs:494)', call: 'TOOL_USE.meleeRange(state, MELEE.range)', effect: '2.4 m -> 2.76 m'},
      {site: 'driveVehicle() (core.mjs:352)', call: 'TOOL_USE.vehicle(state)', effect: 'handling by max with harness skill; add repairPerSecond 4'},
      {site: 'Match.step() actor tick (core.mjs:518)', call: 'TOOL_USE.step(a.verbState, dt)', effect: '2 s window ceiling'},
    ],
  },
};

export const OPERATOR_VERBS = deepFreeze(rawVerbs);
export const OPERATOR_VERB_IDS = Object.freeze(Object.keys(rawVerbs));
const VERB_BY_ID = Object.fromEntries(OPERATOR_VERB_IDS.map(id => [id, OPERATOR_VERBS[id]]));
const KIT_BY_OPERATOR = Object.fromEntries(OPERATOR_KITS.map(kit => [kit.id, kit]));

// ---------------------------------------------------------------------------
// Public entry points.
// ---------------------------------------------------------------------------

export function operatorVerbById(id) {
  return typeof id === 'string' ? VERB_BY_ID[id] ?? null : null;
}

export function operatorVerbFor(character) {
  const kit = typeof character === 'string' ? KIT_BY_OPERATOR[character] : null;
  const id = kit && kit.verb && typeof kit.verb.id === 'string' ? kit.verb.id : null;
  return id ? VERB_BY_ID[id] ?? null : null;
}

export function operatorHooks(value) {
  const id = typeof value === 'string'
    ? (VERB_BY_ID[value] ? value : operatorVerbFor(value)?.id ?? null)
    : value && typeof value === 'object' ? value.verb ?? null : null;
  return id ? OPERATOR_HOOKS[id] ?? null : null;
}

export function createOperatorVerbState(character, {active = true} = {}) {
  const descriptor = operatorVerbFor(character);
  if (!descriptor) return null;
  const state = {verb: descriptor.id, operator: descriptor.operator, active: active === true, lastReset: 'create'};
  switch (descriptor.id) {
    case 'heat':
      state.heat = 0;
      state.decayIn = 0;
      break;
    case 'deep-compute':
      state.charge = 0;
      state.decayIn = 0;
      break;
    case 'braced':
      state.combatIn = 0;
      break;
    case 'alignment-review':
      state.meter = 0;
      state.pool = 0;
      state.poolIn = 0;
      state.suppressIn = 0;
      break;
    case 'adaptive':
      state.open = false;
      state.windowIn = 0;
      state.shotsLeft = 0;
      break;
    case 'long-context':
      state.trails = [];
      state.cooldowns = {};
      break;
    case 'tool-use':
      state.windowIn = 0;
      break;
    default:
      break;
  }
  return state;
}

function clearVerbFields(state) {
  switch (state.verb) {
    case 'heat':
      state.heat = 0;
      state.decayIn = 0;
      break;
    case 'deep-compute':
      state.charge = 0;
      state.decayIn = 0;
      break;
    case 'braced':
      state.combatIn = 0;
      break;
    case 'alignment-review':
      state.meter = 0;
      state.pool = 0;
      state.poolIn = 0;
      state.suppressIn = 0;
      break;
    case 'adaptive':
      state.open = false;
      state.windowIn = 0;
      state.shotsLeft = 0;
      break;
    case 'long-context':
      state.trails = [];
      state.cooldowns = {};
      break;
    case 'tool-use':
      state.windowIn = 0;
      break;
    default:
      break;
  }
}

// Spawn and death hook: clears every per-life resource (Heat stacks, Compute
// charge, Braced combat timer, Review meter/pool, Adaptive window, Kimi trails,
// Qwen window). `reason` is recorded for presentation only and is never part
// of the numeric snapshot.
export function resetOperatorVerbState(state, reason = 'spawn') {
  if (!state || typeof state !== 'object') return state;
  clearVerbFields(state);
  state.lastReset = typeof reason === 'string' && reason.length > 0 ? reason : 'spawn';
  return state;
}

export function setOperatorVerbActive(state, active) {
  if (!state || typeof state !== 'object') return state;
  const enabled = active === true;
  if (state.active === enabled) return state;
  state.active = enabled;
  if (!enabled) clearVerbFields(state);
  return state;
}

export function stepOperatorVerbState(state, dt, context = {}) {
  if (!state || typeof state !== 'object' || state.active !== true) return state;
  const hooks = operatorHooks(state);
  if (hooks && typeof hooks.step === 'function') hooks.step(state, dt, context);
  return state;
}

// Plain numeric snapshot for HUD/net/quantize. Excludes `lastReset`.
export function operatorVerbSnapshot(state) {
  if (!state || typeof state !== 'object' || !state.verb) return null;
  const hooks = operatorHooks(state);
  const fields = hooks && typeof hooks.snapshot === 'function' ? hooks.snapshot(state) : {};
  return {verb: state.verb, active: state.active === true, ...fields};
}

// The one-shot ceiling: never above §4.7's 90 damage, and never above 90% of
// the target's full health. Armor never raises the ceiling — a full-health
// target can never be removed by a single Deep Compute shot.
function singleHitCeiling(targetHealth) {
  const health = finiteOr(targetHealth, 0);
  if (!(health > 0)) return SINGLE_HIT_CAP;
  return Math.min(SINGLE_HIT_CAP, ONE_SHOT_HEALTH_FRACTION * health);
}
