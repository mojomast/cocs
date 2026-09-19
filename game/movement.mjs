import {MOVEMENT_VERBS, MOVEMENT_HOOK_BY_SPEC, resolveKit} from './kits.mjs';
import {clamp01} from './math.mjs';

// ===========================================================================
// COCS movement-verb framework (docs/design/CLASS_OVERHAUL.md §3.4, §3.6, §3.7,
// §4.4, §4.7, §13.3).
//
// Pure, deterministic and engine-free: no DOM, no three.js, no `Match` import,
// no wall clock, no `Math.random`. Terrain is injected through `ctx` callbacks,
// so the same state machine runs in the sim, in the netcode shadow and in unit
// tests. `game/core.mjs` stays the only place that owns actors; a `Match` will
// attach one `movement` sub-object per actor and apply the per-tick `motion`
// and `actions` this module returns.
//
// ---------------------------------------------------------------------------
// INTEGRATION CONTRACT (for the core / net wiring)
// ---------------------------------------------------------------------------
//
// 1. Create once, per spawn:
//
//      actor.movement = createMovementState(
//        {character: actor.character, harness: actor.harness},   // or a resolveKit() result
//        {mode: match.config.mode}                                // carrier overrides below
//      );
//
//    `actor.movement` is a plain, JSON-safe object: every field is a number,
//    string, boolean or a shallow point object, so it rides snapshots and
//    replay state directly. Snapshot exactly the fields listed in
//    `movementSnapshot(state)` (see `MOVEMENT_SNAPSHOT_FIELDS`); on a net
//    resync copy them back with `applyMovementSnapshot(state, snap)`.
//    This module reads **no** actor fields: core passes the tick sample through
//    `ctx`. The only object it writes is the `movement` state it was given.
//
// 2. Reset on spawn / death / fall / vehicle board (`core.mjs` actor(), spawn(),
//    the death branch and fall() per §5):
//
//      resetMovement(actor.movement);                            // full refill
//      refreshMovementParams(actor.movement, {carrying: true});  // flag picked up
//
//    `refreshMovementParams` re-resolves mode/hook/carrier numbers without
//    touching timers; it also cancels an active verb when the carrier rule
//    disables it (Juggernaut keeps it, VIP loses it, boarding strips it).
//
// 3. Every tick, once per actor, before `moveActor`:
//
//      const frame = stepMovement(actor.movement, {
//        jump: jumpPressedEdge,        // true only on the tick the press happened
//        jumpHeld: controls.jump === true,
//        jumpReleased: jumpReleasedEdge,
//        crouch: controls.crouch === true,        // held
//        crouchReleased: crouchReleasedEdge,
//        mobility: mobilityPressedEdge,           // the one new `mobility` bind (KeyX)
//        mobilityReleased: mobilityReleasedEdge,
//        interrupted: false,                      // see (6)
//      }, {
//        dt,                                        // fixed sim step (seconds)
//        x: actor.x, y: actor.y, z: actor.z,        // feet position
//        vy: actor.vy,                              // vertical velocity (sign matters)
//        yaw: actor.yaw, pitch: actor.pitch,        // aim (or pass `aim` directly)
//        grounded: actor.grounded,
//        landed: cleanLanding,                      // see (5)
//        ceilingY: ceilingFor(match.arena),         // absolute Y = min(58, arena.ceiling ?? 24)
//        carrying: carrierFlag, vip: vipFlag, juggernaut: actor.juggernaut,
//        inVehicle: actor.vehicleId !== null, zipRide: !!actor.zipRide,
//        traversalFlight: !!actor.traversalFlight,
//        verbActive: classDashOrOtherVerbActive,    // see (4)
//        firing: controls.fire === true,
//        dead: actor.health <= 0,
//        // required only by translation verbs (dash / blink / grapple pull):
//        floorAt: (x, z) => floorAt(x, z, match.arena),
//        obstructed: (x, y, z, r) => obstructed(x, y, z, r, match.arena),
//        bounds: match.arena.bounds,
//        // required only by aimed verbs (grapple / rope), wire core's rayWorld:
//        castRay: (origin, dir, maxDistance) => ({x, y, z, distance}) | null,
//        // grapple body sweep and nearby standable ledge (optional):
//        sweepClear: (from, to, radius) => boolean,
//        grappleLanding: (hit, origin) => ({x, y, z}) | null,
//      });
//
//    Apply the frame in the same tick, in this order:
//      a. `frame.actions` — hook and impact effects (heal / brace / knockback /
//         slow-field / slam-impact / rope-place / rope-remove / cancel-verb).
//      b. `frame.motion` — `position` is an absolute translated point
//         (dash / blink / grapple pull); `vy` is an absolute vertical velocity
//         override (jump impulse, hover climb, glide / slam descent clamp);
//         `airControl` is a horizontal assist cap while gliding.
//      c. `frame.events` — presentation / net events; emit them like any other
//         core event (`frame.events.map(event => match.emit(event.type, ...))`).
//
// 4. "One movement source" (§3.6): the caller reports `ctx.verbActive = true`
//    whenever another movement verb, the class dash ability (Cline's Phase
//    Step) or traversal flight is active. This module refuses to start then,
//    except with the `chaining` hook (Cline), which is the only cancel and
//    emits `{type:'cancel-verb'}` for the caller to stop the other source.
//
// 5. `ctx.landed` is the §3.6 `land` event: grounded this tick with `vy <= 0`
//    and **not** from a vehicle, zipline, pad, teleport or respawn. The caller
//    owns that predicate; this module trusts it and fires the landing-self /
//    landing-control hooks (and landing recovery) only for clean landings.
//
// 6. Interruption: the caller may set `ctx.interrupted = true` (death, vehicle
//    boarding, severe knockback). An uncommitted wind-up or charge is cancelled
//    for free; committed resources (a spent dash charge, spent fuel) stay spent
//    because the effect already fired. `interruptMovement(state, reason)` is
//    the same entry point for code that does not run a step.
//
// ---------------------------------------------------------------------------
// NUMBERS
// ---------------------------------------------------------------------------
// Pinned by §13.3: air dash 5.5 m / 3.5 s / 1 charge / 0.15 s landing;
// double jump impulse 7.4, one charge; super jump 0.55 s charge / 12.5 impulse /
// 6 s; hover 2.5 s fuel / 1.8 s recharge / climb 0.35 / descent 2.2; slam
// 0.15 s wind-up / 4 m radius / 9 knockback / 8 s; glide descent 2 m/s, steer 4;
// grapple 14 m / 12 m/s reel / 7 s (3 s on miss); blink 6 m / 0.3 s wind-up /
// 6 s; rope 1 charge / 20 s anchor / 12 s.
// Pinned by §3.6: air dash 0.25 s active; chain link ×0.7, cap 1.4× (§4.7);
// economy +1 charge or +25% fuel and −20% cooldown; weakened carrier 1 charge,
// half fuel, +50% cooldown, no vertical lift; Juggernaut lift ×0.7.
// Pinned by §4.7: landing-control fields ≤3.5 m, ≤35% slow, 2.5 s; objective
// interaction cap 1.35×; ceiling min(vehicle maxAltitude 58, arena.ceiling ?? 24).
// Numbers the plan left open (documented, tunable in Phase 5): brace-slam leap
// 7.5 / slam descent 16 m/s / landing recovery 0.4 s; safety-glide fuel pool
// 2.5 s and recharge 1.8 s; rope placement range 14 m and ride speed 9 m/s
// (core's zipline default); landing-self Codex heal 8 / no fall damage and
// Claude Code brace 1.2 s, 10% mitigation, 50% knockback; landing-control
// OpenClaw 6 m/s knockback; hover without a held jump brakes the descent it
// already has (no free hover); every jet action burns fuel.
// ---------------------------------------------------------------------------

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// The nine verbs group into the three movement families (§3.4): burst for
// reactive strikers, deliberate for committed vanguards, tool for setup-based
// tacticians. `MOVEMENT_SPECS` preserves that order.
export const MOVEMENT_FAMILIES = deepFreeze(['burst', 'deliberate', 'tool']);

// The five hook names of §3.6. A spec maps to exactly one of them through
// `MOVEMENT_HOOK_BY_SPEC` (kits.mjs).
export const HOOK_NAMES = deepFreeze(['economy', 'chaining', 'usage', 'landing-self', 'landing-control']);

// §3.7 / §4.4: every verb clamps to min(vehicle maxAltitude, arena.ceiling ?? 24)
// metres. `ctx.ceilingY` is that value resolved to an absolute world Y.
export const VEHICLE_MAX_ALTITUDE = 58;
export const CEILING_DEFAULT = 24;

// §4.7 verb chain distance: ×0.7 per extra link, never past 1.4× the best
// single verb. §4.7 objective interaction: ≤1.35×.
export const CHAIN_LINK_SCALE = 0.7;
export const CHAIN_DISTANCE_CAP = 1.4;
export const INTERACTION_BONUS_CAP = 1.35;

// §3.7 weakened carrier exception (exactly one rule, most-specific first:
// Qwen's class, else the Hermes spec).
export const WEAKENED_CARRIER = deepFreeze({
  charges: 1,
  fuelScale: 0.5,
  cooldownScale: 1.5,
  liftScale: 0,
  suppressActive: true,
  interactionScale: 1,
});

// §3.7 Juggernaut: keeps the verb, lift ×0.7, shield frozen while airborne.
export const JUGGERNAUT_RULE = deepFreeze({liftScale: 0.7, shieldFrozenAirborne: true});

// Deterministic translation sampling mirrors Cline's dash loop (`core.mjs:406`):
// 0.12 m probes, a 0.48 m body for the dash and the standard 0.42 m radius for
// aimed translations. A single step is capped at 0.25 s so a huge dt can never
// tunnel a verb through geometry in one frame.
export const MOVEMENT_PROBE_STEP = 0.12;
export const DASH_PROBE_RADIUS = 0.48;
export const MOVE_PROBE_RADIUS = 0.42;
export const MAX_STEP_DT = 0.25;

// Why a verb did not activate. Stable strings for HUD/telemetry.
export const MOVEMENT_BLOCKS = deepFreeze([
  'disabled', 'dead', 'vehicle', 'zipride', 'traversal', 'busy', 'firing',
  'recovery', 'cooldown', 'resources', 'grounded', 'airborne', 'no-world',
]);

// Presentation / net events this module can return in `frame.events`.
export const MOVEMENT_EVENTS = deepFreeze([
  'move-start', 'move-end', 'move-blocked', 'move-miss',
  'windup-start', 'windup-end', 'windup-interrupt',
  'charge-start', 'charge-release', 'charge-cancel',
  'chain-cancel', 'fuel-empty', 'no-lift', 'landing-recovery',
  'slam-launch', 'slam-impact',
  'grapple-hook', 'grapple-release',
  'rope-place', 'rope-expire', 'rope-miss',
]);

// `movementSnapshot()` is the netcode field list: numbers, booleans, strings and
// anchor/arrival points. Everything else in the state object is derived or static.
export const MOVEMENT_SNAPSHOT_FIELDS = deepFreeze([
  'v', 'verb', 'phase', 'enabled', 'charges', 'maxCharges', 'cooldown',
  'fuel', 'maxFuel', 'fuelRecharge', 'windup', 'recovery', 'activeTime',
  'landingArmed', 'chains', 'miss', 'anchor', 'grapple', 'grappleLanding',
]);

// The input surface `stepMovement` reads. Jump-family verbs ride the existing
// jump / crouch semantics; only `mobility` is a new bind (§4.4 rule 6; KeyX,
// Phase 4 protocol work). `jump` / `mobility` are one-tick press edges.
export const MOVEMENT_INPUT_FIELDS = deepFreeze([
  'jump', 'jumpHeld', 'jumpReleased', 'crouch', 'crouchReleased',
  'mobility', 'mobilityReleased', 'interrupted',
]);

// ---------------------------------------------------------------------------
// Resolved verb table
// ---------------------------------------------------------------------------
// `MOVEMENT_VERBS` (kits.mjs) carries the §13.3 budget and the carrier policy;
// this table flattens it into the exact numbers the state machine reads and
// fills the slots the plan left open (see the header). Unused slots are 0, so
// arithmetic never branches on null.

const CHOSEN = {
  // §3.6: air dash "1 charge, 0.25 s" (the 0.25 s active window).
  'air-dash': {duration: 0.25},
  // §3.4/"commitment": no pinned leap, slam descent or landing recovery yet.
  'brace-slam': {leap: 7.5, slamDescent: 16, landing: 0.4, impactLift: 0},
  // §3.6 pins fuel/s for glide but not the pool; reuse hover's §13.3 pool shape.
  'safety-glide': {fuel: 2.5, fuelRecharge: 1.8},
  // Rope placement range is not pinned; share the grapple's 14 m. Ride speed is
  // core's zipline default (9 m/s). A miss is free (no pinned miss cooldown).
  'deployable-rope': {distance: 14, rideSpeed: 9, missCooldown: 0},
};

const buildSpec = verb => {
  const budget = verb.budget;
  const chosen = CHOSEN[verb.id] ?? {};
  return {
    id: verb.id,
    name: verb.name,
    family: verb.family,
    input: verb.input,
    maxCharges: num(budget.charges),
    cooldown: num(budget.cooldown),
    // `windup` is the charge time for super-jump and the wind-up for slam/blink.
    windup: num(budget.windup),
    landing: budget.landing === null ? num(chosen.landing) : num(budget.landing),
    duration: num(chosen.duration),
    impulse: num(budget.impulse),
    fuel: num(budget.fuel, num(chosen.fuel)),
    fuelRecharge: num(budget.fuelRecharge, num(chosen.fuelRecharge)),
    climb: num(budget.climb),
    descent: num(budget.descent),
    steer: num(budget.steer),
    distance: num(budget.distance, num(chosen.distance)),
    reel: num(budget.reel),
    missCooldown: num(budget.missCooldown, num(chosen.missCooldown)),
    radius: num(budget.radius),
    knockback: num(budget.knockback),
    leap: num(chosen.leap),
    slamDescent: num(chosen.slamDescent),
    impactLift: num(chosen.impactLift),
    anchorLife: num(budget.anchorLife),
    rideSpeed: num(chosen.rideSpeed),
    // Gemini's one charge "refreshes on ground" (§3.4); every other charge verb
    // recharges on its cooldown timer.
    refreshOnGround: verb.id === 'double-jump',
    // Whether the verb natively lifts (kits.mjs `carrier.lift`): only these are
    // affected by the "no vertical lift" clause of the weakened carrier rule.
    lifts: verb.carrier.lift === true,
    carrierDrop: verb.carrier.drop === true,
    carrierWeakenedClass: verb.carrier.weakened === true,
  };
};

export const MOVEMENT_SPECS = deepFreeze(MOVEMENT_VERBS.map(buildSpec));

const SPEC_BY_ID = Object.fromEntries(MOVEMENT_SPECS.map(spec => [spec.id, spec]));

// ---------------------------------------------------------------------------
// Hook tables (§3.4 / §3.6 / §4.7)
// ---------------------------------------------------------------------------
// Five hooks, small bounded numbers. `economy` resolves into the verb params at
// loadout/refresh time (+1 charge or +25% fuel, −20% cooldown); `chaining`,
// `usage` gate activation; `landing-self` and `landing-control` return effect
// actions from `movementLandingActions()`.
//
// Applying function per hook (all pure):
//   economy        → resolveMovementParams()
//   chaining       → canStart()/tryActivate() (the only cancel) + chainLinkScale()
//   usage          → canStart()
//   landing-self   → movementLandingActions()
//   landing-control→ movementLandingActions()
export const HOOK_VALUES = deepFreeze({
  economy: {chargeBonus: 1, fuelScale: 1.25, cooldownScale: 0.8},
  chaining: {linkScale: CHAIN_LINK_SCALE, distanceCap: CHAIN_DISTANCE_CAP, allowCancel: true},
  usage: {allowWhileFiring: true},
  // Landing hooks are a pure spec-id table now: each entry carries the complete
  // action payload, so the engine never branches on a spec id.
  'landing-self': {
    // §3.4 Codex: "landing repairs a little; no fall damage".
    codex: {action: 'heal', amount: 8, noFallDamage: true},
    // §3.4 Claude Code: "landing grants a brief brace". ≤60% mitigation cap (§4.7).
    claudecode: {action: 'brace', duration: 1.2, mitigation: 0.1, knockbackScale: 0.5},
  },
  'landing-control': {
    // §3.4 OpenClaw + §4.7 field caps: ≤3.5 m, ≤35% slow, 2.5 s per actor.
    openclaw: {action: 'knockback', radius: 3.5, knockback: 6, lift: 0},
    roo: {action: 'slow-field', radius: 3.5, slowMultiplier: 0.65, duration: 2.5},
  },
});

// §3.6 event vocabulary: which hooks fire on which shared trigger events.
// The state machine above is the one implementation; this table is the contract
// the HUD/audio and future specs are allowed to depend on.
export const MOVEMENT_HOOK_TRIGGERS = deepFreeze({
  economy: ['activate', 'end'],
  chaining: ['air'],
  usage: ['activate'],
  'landing-self': ['land'],
  'landing-control': ['land'],
});

// ---------------------------------------------------------------------------
// Mode coverage (§3.7)
// ---------------------------------------------------------------------------

// puma-race / puma-soccer disable movement verbs entirely.
const MODE_OFF = deepFreeze(['puma-race', 'puma-soccer']);
// Instagib / Rocket Arena / Full Arsenal run weakened: dash ≤4 m, blink
// wind-up 0.45 s.
const MODE_WEAKENED = deepFreeze({
  instagib: {dashDistanceMax: 4, blinkWindup: 0.45},
  rockets: {dashDistanceMax: 4, blinkWindup: 0.45},
  arsenal: {dashDistanceMax: 4, blinkWindup: 0.45},
});
// Modes where objective carriers drop the verb by default (§3.7).
export const CARRIER_DROP_MODES = deepFreeze([
  'ctf', 'koth', 'domination', 'assault', 'teamdeathmatch', 'payload',
  'combined-arms', 'holdout', 'uplink',
]);
// NPCs never inherit class kits; horde/campaign players keep theirs.
const MODE_NPC_NEVER = deepFreeze(['horde', 'campaign']);

const includes = (list, value) => list.indexOf(value) !== -1;

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Resolved verb descriptor (frozen) or null for an unknown id. */
export function movementSpec(verbId) {
  return SPEC_BY_ID[verbId] ?? null;
}

/** Hook name for a spec id via `MOVEMENT_HOOK_BY_SPEC`, or null. */
export function movementHookFor(specId) {
  return MOVEMENT_HOOK_BY_SPEC[specId] ?? null;
}

/**
 * Pure mode coverage record. `disabled` is true in puma modes; `npcDisabled`
 * is true in horde/campaign; `dashDistanceMax` / `blinkWindup` carry the
 * instagib-family weakening. Unknown modes are unrestricted.
 */
export function movementModeRule(modeId) {
  const weakened = MODE_WEAKENED[modeId] ?? null;
  return deepFreeze({
    mode: modeId ?? null,
    disabled: includes(MODE_OFF, modeId),
    npcDisabled: includes(MODE_NPC_NEVER, modeId),
    dashDistanceMax: weakened ? num(weakened.dashDistanceMax) : null,
    blinkWindup: weakened ? num(weakened.blinkWindup) : null,
  });
}

/** Whether actors may use movement verbs in a mode; NPCs never do in horde/campaign. */
export function movementAllowed(modeId, {npc = false} = {}) {
  const rule = movementModeRule(modeId);
  return !rule.disabled && !(npc === true && rule.npcDisabled);
}

/**
 * The §3.7 carrier rule. `carrying` is the caller's objective-carrier
 * predicate (CTF flag, VIP, payload pusher — the caller decides). Returns a
 * frozen record:
 *   - disabled: the verb is gone (default carrier, VIP, NPC, disabled mode)
 *   - weakened/reason: the one exception, resolved most-specific first —
 *     `'class'` for Qwen's class, else `'spec'` for the Hermes spec
 *   - liftScale: 0 weakened, 0.7 Juggernaut, else 1
 *   - suppressActive: the harness active is suppressed while carrying
 *   - interactionScale: 1 while weakened (no objective interaction bonus),
 *     else null (caller keeps the class value, capped at INTERACTION_BONUS_CAP)
 */
export function resolveCarrierRule({
  mode = null,
  npc = false,
  carrying = false,
  vip = false,
  juggernaut = false,
  character = null,
  harness = null,
} = {}) {
  const rule = movementModeRule(mode);
  const result = {
    carrying: carrying === true,
    disabled: false,
    weakened: false,
    reason: null,
    liftScale: 1,
    shieldFrozenAirborne: false,
    suppressActive: false,
    interactionScale: null,
  };
  if (npc === true || rule.disabled) {
    result.disabled = true;
    return deepFreeze(result);
  }
  // The VIP loses the verb for the round and the harness active with it (§3.7).
  if (vip === true) {
    result.disabled = true;
    result.suppressActive = true;
    return deepFreeze(result);
  }
  // Juggernaut keeps the verb; the shield is frozen while airborne.
  if (juggernaut === true) {
    result.liftScale = JUGGERNAUT_RULE.liftScale;
    result.shieldFrozenAirborne = JUGGERNAUT_RULE.shieldFrozenAirborne;
    return deepFreeze(result);
  }
  if (carrying !== true) return deepFreeze(result);
  const exception = character === 'qwen' ? 'class' : harness === 'hermes' ? 'spec' : null;
  if (exception === null) {
    result.disabled = true;
    return deepFreeze(result);
  }
  result.weakened = true;
  result.reason = exception;
  result.liftScale = WEAKENED_CARRIER.liftScale;
  result.suppressActive = WEAKENED_CARRIER.suppressActive;
  result.interactionScale = WEAKENED_CARRIER.interactionScale;
  return deepFreeze(result);
}

/**
 * Resolve one verb's effective numbers: §13.3 baseline → economy hook → mode
 * weakening → carrier weakening. Returns a frozen flat parameter object (same
 * shape as MOVEMENT_SPECS entries plus `hook`, `disabled`, `carrier` and
 * `liftScale`), or null for an unknown verb. Never mutates its inputs.
 */
export function resolveMovementParams(verbId, options = {}) {
  const base = SPEC_BY_ID[verbId];
  if (!base) return null;
  const hook = options.hook ?? movementHookFor(options.spec);
  const modeRule = movementModeRule(options.mode);
  const carrier = resolveCarrierRule({...options, harness: options.harness ?? options.spec});
  const params = {...base};
  params.hook = hook;
  params.liftScale = 1;
  params.disabled = false;
  if (hook === 'economy') {
    if (params.maxCharges > 0) params.maxCharges += HOOK_VALUES.economy.chargeBonus;
    params.fuel *= HOOK_VALUES.economy.fuelScale;
    params.cooldown *= HOOK_VALUES.economy.cooldownScale;
  }
  if (modeRule.disabled) params.disabled = true;
  if (verbId === 'air-dash' && modeRule.dashDistanceMax !== null) {
    params.distance = Math.min(params.distance, modeRule.dashDistanceMax);
  }
  if (verbId === 'blink-step' && modeRule.blinkWindup !== null) {
    params.windup = Math.max(params.windup, modeRule.blinkWindup);
  }
  if (carrier.disabled) params.disabled = true;
  if (carrier.weakened) {
    if (params.maxCharges > 0) params.maxCharges = Math.min(params.maxCharges, WEAKENED_CARRIER.charges);
    params.fuel *= WEAKENED_CARRIER.fuelScale;
    params.cooldown *= WEAKENED_CARRIER.cooldownScale;
  }
  params.liftScale = carrier.liftScale;
  params.carrier = carrier;
  return deepFreeze(params);
}

/**
 * §4.7 verb-chain scale: the first link is 1×, each extra link contributes
 * ×0.7 of the previous one, and the total never passes 1.4× the best single
 * verb. `links` is the number of airborne links already taken (0 = first use).
 */
export function chainLinkScale(links) {
  const count = Math.max(0, Math.floor(num(links)));
  let total = 0;
  let link = 1;
  for (let i = 0; i <= count; i++) {
    total += link;
    if (total >= CHAIN_DISTANCE_CAP) return CHAIN_DISTANCE_CAP;
    link *= CHAIN_LINK_SCALE;
  }
  return Math.min(CHAIN_DISTANCE_CAP, total);
}

/** Absolute ceiling for movement verbs: min(58, arena.ceiling ?? 24). */
export function ceilingFor(arena) {
  const ceiling = Number.isFinite(arena?.ceiling) ? arena.ceiling : CEILING_DEFAULT;
  return Math.min(VEHICLE_MAX_ALTITUDE, ceiling);
}

/** Aim unit vector matching `core.aim(yaw, pitch)`. */
export function aimVector(yaw = 0, pitch = 0) {
  const cosPitch = Math.cos(pitch);
  return {x: -Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: -Math.cos(yaw) * cosPitch};
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function baseState() {
  return {
    verb: null,
    family: null,
    input: null,
    character: null,
    harness: null,
    spec: null,
    hook: null,
    mode: null,
    npc: false,
    enabled: false,
    params: null,
    phase: 'ready',
    charges: 0,
    maxCharges: 0,
    cooldown: 0,
    fuel: 0,
    maxFuel: 0,
    fuelRecharge: 0,
    windup: 0,
    windupTotal: 0,
    recovery: 0,
    activeTime: 0,
    landingArmed: false,
    chains: 0,
    miss: 0,
    anchor: null,
    grapple: null,
    grappleLanding: null,
    carrier: null,
  };
}

/**
 * Build one actor's movement state. `loadout` may be a `resolveKit()` result or
 * a `{character, harness}` pair; `options` may carry `mode`, `npc`, `carrying`,
 * `vip`, `juggernaut`, a `verbId` override (tests / foreign actors) and
 * `spec` / `hook` overrides. The returned object is plain and mutable: the
 * framework owns it, core attaches it as `actor.movement`.
 */
export function createMovementState(loadout = {}, options = {}) {
  const character = loadout.character ?? options.character ?? 'chatgpt';
  const harness = loadout.harness ?? options.harness ?? 'openclaw';
  const kit = loadout.movement ? loadout : resolveKit(character, harness);
  const verbId = options.verbId ?? kit.movement.id;
  const spec = options.spec ?? loadout.harness ?? harness;
  const hook = options.hook !== undefined ? options.hook : (loadout.movementHook ?? movementHookFor(spec));
  const params = resolveMovementParams(verbId, {...options, character, harness, spec, hook});
  const state = baseState();
  state.verb = params.id;
  state.family = params.family;
  state.input = params.input;
  state.character = character;
  state.harness = harness;
  state.spec = spec;
  state.hook = hook;
  state.mode = options.mode ?? null;
  state.npc = options.npc === true;
  state.params = params;
  state.enabled = params.disabled !== true;
  state.charges = state.maxCharges = params.maxCharges;
  state.fuel = state.maxFuel = params.fuel;
  state.fuelRecharge = params.fuelRecharge;
  state.carrier = params.carrier;
  return state;
}

/**
 * Re-resolve mode / hook / carrier numbers in place (flag pickup, drop or
 * spawn switch) without touching timers. Charges and fuel are clamped to the
 * new maxima; a now-disabled verb cancels any charge, wind-up, active phase
 * and grapple anchor so a carrier can never finish a stripped verb.
 */
export function refreshMovementParams(state, options = {}) {
  if (!state || typeof state !== 'object') return null;
  const params = resolveMovementParams(state.verb, {
    mode: options.mode ?? state.mode,
    npc: options.npc ?? state.npc,
    carrying: options.carrying ?? state.carrier?.carrying,
    vip: options.vip,
    juggernaut: options.juggernaut,
    character: state.character,
    harness: state.harness,
    spec: state.spec,
    hook: state.hook,
  });
  if (!params) return state;
  state.params = params;
  state.carrier = params.carrier;
  state.enabled = params.disabled !== true;
  state.mode = options.mode ?? state.mode;
  state.npc = options.npc ?? state.npc;
  if (state.maxCharges !== params.maxCharges) {
    const used = Math.max(0, state.maxCharges - state.charges);
    state.maxCharges = params.maxCharges;
    state.charges = Math.max(0, params.maxCharges - used);
  }
  if (state.maxFuel !== params.fuel) {
    const ratio = state.maxFuel > 0 ? state.fuel / state.maxFuel : 1;
    state.maxFuel = params.fuel;
    state.fuel = Math.min(params.fuel, params.fuel * ratio);
  }
  state.fuelRecharge = params.fuelRecharge;
  if (state.enabled !== true && (state.phase !== 'ready' || state.grapple)) {
    interruptMovement(state, 'disabled');
  }
  return state;
}

/**
 * Full refill for spawn / death / fall / vehicle board (§5). Keeps the
 * loadout, mode and carrier wiring; clears every timer, link and anchor.
 */
export function resetMovement(state, options = {}) {
  if (!state || typeof state !== 'object') return null;
  if (options && Object.keys(options).length) refreshMovementParams(state, options);
  state.phase = 'ready';
  state.charges = state.maxCharges;
  state.cooldown = 0;
  state.fuel = state.maxFuel;
  state.windup = 0;
  state.windupTotal = 0;
  state.recovery = 0;
  state.activeTime = 0;
  state.landingArmed = false;
  state.chains = 0;
  state.miss = 0;
  state.anchor = null;
  state.grapple = null;
  state.grappleLanding = null;
  return state;
}

/** Whether a verb effect is currently steering the actor. */
export function movementActive(state) {
  return state?.phase === 'active';
}

/** Wind-up / charge progress in [0, 1] for the HUD (0 when nothing is charging). */
export function movementChargeProgress(state) {
  if (!state || state.phase === 'ready') return 0;
  const total = state.windupTotal;
  if (!(total > 0)) return 0;
  if (state.phase === 'charging') return clamp01(state.windup / total);
  return clamp01(1 - state.windup / total);
}

/** The per-match zipline line Qwen's anchor registers with, or null. */
export function ropeLine(state) {
  const anchor = state?.anchor;
  if (!anchor || !anchor.from) return null;
  return {
    from: {x: anchor.from.x, y: anchor.from.y, z: anchor.from.z},
    to: {x: anchor.x, y: anchor.y, z: anchor.z},
    speed: state.params?.rideSpeed ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Deterministic world sampling
// ---------------------------------------------------------------------------

const INF_BOUNDS = deepFreeze({minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity});

const horizontalAim = ctx => {
  if (ctx.aim && Number.isFinite(ctx.aim.x) && Number.isFinite(ctx.aim.z)) {
    const length = Math.hypot(ctx.aim.x, ctx.aim.z);
    if (length > 1e-9) return {x: ctx.aim.x / length, y: 0, z: ctx.aim.z / length};
  }
  const yaw = num(ctx.yaw);
  return {x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw)};
};

const fullAim = ctx => {
  if (ctx.aim && Number.isFinite(ctx.aim.x) && Number.isFinite(ctx.aim.y) && Number.isFinite(ctx.aim.z)) {
    const length = Math.hypot(ctx.aim.x, ctx.aim.y, ctx.aim.z);
    if (length > 1e-9) return {x: ctx.aim.x / length, y: ctx.aim.y / length, z: ctx.aim.z / length};
  }
  return aimVector(num(ctx.yaw), num(ctx.pitch));
};

const pointOf = ctx => ({x: num(ctx.x), y: num(ctx.y), z: num(ctx.z)});

const inBounds = (bounds, x, z) =>
  x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;

const hasWorld = ctx => typeof ctx.floorAt === 'function' && typeof ctx.obstructed === 'function';

// Cline-style horizontal dash: probe forward in 0.12 m steps, ride small floor
// rises, stop at a wall, a climb taller than 0.25 m, a void or the arena bounds.
function dashTranslation(from, direction, distance, ctx) {
  const bounds = ctx.bounds ?? INF_BOUNDS;
  const ceiling = Number.isFinite(ctx.ceilingY) ? ctx.ceilingY : Infinity;
  const maxDistance = Math.max(0, num(distance));
  const world = hasWorld(ctx);
  const ceilingBlocked = from.y > ceiling;
  let target = {...from};
  let moved = 0;
  let blocked = false;
  for (let step = MOVEMENT_PROBE_STEP; step <= maxDistance + 1e-9; step += MOVEMENT_PROBE_STEP) {
    const x = from.x + direction.x * step;
    const z = from.z + direction.z * step;
    if (ceilingBlocked || !inBounds(bounds, x, z)) {
      blocked = true;
      break;
    }
    if (world) {
      const ground = ctx.floorAt(x, z);
      if (ground === null || ground > from.y + 0.25 || ctx.obstructed(x, Math.max(from.y, ground), z, DASH_PROBE_RADIUS)) {
        blocked = true;
        break;
      }
      target = {x, y: Math.max(from.y, ground), z};
    } else {
      target = {x, y: from.y, z};
    }
    moved = step;
  }
  if (!world && maxDistance > 0) {
    // No world callbacks: straight-line fallback, still ceiling-clamped.
    target = {x: from.x + direction.x * maxDistance, y: Math.min(ceiling, from.y), z: from.z + direction.z * maxDistance};
    moved = maxDistance;
  }
  // The last probe usually stops just short of `distance` because it steps in
  // fixed 0.12 m increments; take the exact remaining sliver when it is clear.
  if (world && !blocked && moved < maxDistance) {
    const x = from.x + direction.x * maxDistance;
    const z = from.z + direction.z * maxDistance;
    const ground = ctx.floorAt(x, z);
    if (inBounds(bounds, x, z) && ground !== null && ground <= from.y + 0.25 && !ctx.obstructed(x, Math.max(from.y, ground), z, DASH_PROBE_RADIUS)) {
      target = {x, y: Math.max(from.y, ground), z};
      moved = maxDistance;
    }
  }
  return {x: target.x, y: Math.min(ceiling, target.y), z: target.z, moved, blocked};
}

// Aimed 3D translation (blink, grapple pull): probe along the direction, stop
// at an obstruction, a void, the arena bounds or the ceiling.
function directTranslation(from, direction, distance, ctx, radius = MOVE_PROBE_RADIUS) {
  const bounds = ctx.bounds ?? INF_BOUNDS;
  const ceiling = Number.isFinite(ctx.ceilingY) ? ctx.ceilingY : Infinity;
  const maxDistance = Math.max(0, num(distance));
  const world = hasWorld(ctx);
  let target = {...from};
  let moved = 0;
  let blocked = false;
  for (let step = MOVEMENT_PROBE_STEP; step <= maxDistance + 1e-9; step += MOVEMENT_PROBE_STEP) {
    const x = from.x + direction.x * step;
    const z = from.z + direction.z * step;
    const y = Math.min(ceiling, from.y + direction.y * step);
    if (!inBounds(bounds, x, z)) {
      blocked = true;
      break;
    }
    if (world) {
      const ground = ctx.floorAt(x, z);
      if (ground === null) {
        blocked = true;
        break;
      }
      const feet = Math.max(y, ground);
      if (ctx.obstructed(x, feet, z, radius)) {
        blocked = true;
        break;
      }
      target = {x, y: feet, z};
    } else {
      target = {x, y, z};
    }
    moved = step;
  }
  if (!world && maxDistance > 0) {
    target = {
      x: from.x + direction.x * maxDistance,
      y: Math.min(ceiling, from.y + direction.y * maxDistance),
      z: from.z + direction.z * maxDistance,
    };
    moved = maxDistance;
  }
  // Same exact-final-probe rule as the dash sampler.
  if (world && !blocked && moved < maxDistance) {
    const x = from.x + direction.x * maxDistance;
    const z = from.z + direction.z * maxDistance;
    const y = Math.min(ceiling, from.y + direction.y * maxDistance);
    const ground = ctx.floorAt(x, z);
    if (inBounds(bounds, x, z) && ground !== null && !ctx.obstructed(x, Math.max(y, ground), z, radius)) {
      target = {x, y: Math.max(y, ground), z};
      moved = maxDistance;
    }
  }
  target.y = Math.min(ceiling, target.y);
  return {x: target.x, y: target.y, z: target.z, moved, blocked};
}

// ---------------------------------------------------------------------------
// Landing hooks
// ---------------------------------------------------------------------------

/**
 * The landing-self / landing-control actions for a clean landing, resolved as a
 * `HOOK_VALUES[hook][spec]` table lookup (§3.6). Pure: same state in, same
 * action list out, and no spec or operator id in the code path.
 * Bounds are the frozen §4.7 values in HOOK_VALUES.
 */
export function movementLandingActions(state) {
  const actions = [];
  if (!state || state.enabled !== true) return actions;
  const entry = HOOK_VALUES[state.hook]?.[state.spec];
  if (!entry?.action) return actions;
  const {action, ...payload} = entry;
  actions.push({type: action, ...payload, source: 'movement'});
  return actions;
}

// ---------------------------------------------------------------------------
// Step internals
// ---------------------------------------------------------------------------

const emptyMotion = () => ({position: null, vy: null, airControl: null, keepMomentum: true, mode: null});

const frameOf = state => ({
  verb: state?.verb ?? null,
  family: state?.family ?? null,
  phase: state?.phase ?? null,
  enabled: state?.enabled === true,
  active: state?.phase === 'active',
  blocked: null,
  motion: emptyMotion(),
  actions: [],
  events: [],
});

function finishVerb(state, frame, {cooldown = null, recovery = null, reason = 'end'} = {}) {
  const params = state.params;
  const was = state.phase;
  state.phase = 'ready';
  state.activeTime = 0;
  state.windup = 0;
  state.windupTotal = 0;
  state.grapple = null;
  state.grappleLanding = null;
  const cd = cooldown === null ? params.cooldown : cooldown;
  if (state.maxCharges === 0) {
    if (cd > 0) state.cooldown = Math.max(state.cooldown, cd);
  } else if (state.charges < state.maxCharges && state.cooldown <= 0 && params.cooldown > 0) {
    state.cooldown = params.cooldown;
  }
  if (recovery !== null && recovery > 0) {
    state.recovery = Math.max(state.recovery, recovery);
    frame.events.push({type: 'landing-recovery', verb: state.verb, duration: recovery});
  }
  if (was !== 'ready') frame.events.push({type: 'move-end', verb: state.verb, reason});
}

function consumeCharge(state, frame, reason = 'move-start') {
  if (state.maxCharges > 0) state.charges = Math.max(0, state.charges - 1);
  frame.events.push({type: 'move-start', verb: state.verb, reason});
}

function canStart(state, ctx) {
  if (state.enabled !== true) return 'disabled';
  if (ctx.dead === true) return 'dead';
  if (ctx.inVehicle === true) return 'vehicle';
  if (ctx.zipRide === true) return 'zipride';
  if (ctx.traversalFlight === true && state.hook !== 'chaining') return 'traversal';
  if (ctx.verbActive === true && state.hook !== 'chaining') return 'busy';
  if (ctx.firing === true && state.hook !== 'usage') return 'firing';
  if (state.recovery > 0) return 'recovery';
  if (state.maxCharges > 0) {
    if (state.charges <= 0) return 'resources';
  } else if (state.cooldown > 0) {
    return 'cooldown';
  }
  return null;
}

// --- per-verb activation ---

const VERBS = {
  'air-dash'(state, ctx, input, frame) {
    if (input.jump !== true) return null;
    if (ctx.grounded === true) return 'grounded';
    const params = state.params;
    const direction = horizontalAim(ctx);
    const distance = params.distance * chainLinkScale(state.chains);
    const target = dashTranslation(pointOf(ctx), direction, distance, ctx);
    state.chains += 1;
    consumeCharge(state, frame, 'dash');
    state.phase = 'active';
    state.activeTime = 0;
    state.landingArmed = true;
    frame.motion = {position: target, vy: null, airControl: null, keepMomentum: true, mode: 'dash'};
    return true;
  },
  'double-jump'(state, ctx, input, frame) {
    if (input.jump !== true) return null;
    if (ctx.grounded === true) return 'grounded';
    const params = state.params;
    consumeCharge(state, frame, 'double-jump');
    state.landingArmed = true;
    if (params.impulse * params.liftScale > 0) {
      frame.motion.vy = params.impulse * params.liftScale;
    } else {
      frame.events.push({type: 'no-lift', verb: state.verb});
    }
    finishVerb(state, frame, {reason: 'double-jump'});
    return true;
  },
  'super-jump'(state, ctx, input, frame) {
    if (input.crouch !== true) return null;
    if (ctx.grounded !== true) return 'airborne';
    state.phase = 'charging';
    state.windup = 0;
    state.windupTotal = state.params.windup;
    frame.events.push({type: 'charge-start', verb: state.verb, duration: state.windupTotal});
    return true;
  },
  'hover-jets'(state, ctx, input, frame) {
    if (input.jumpHeld !== true && input.jump !== true) return null;
    if (ctx.grounded === true) return 'grounded';
    if (state.fuel <= 0) return 'resources';
    state.phase = 'active';
    state.activeTime = 0;
    state.landingArmed = true;
    frame.events.push({type: 'move-start', verb: state.verb, reason: 'hover'});
    return true;
  },
  'brace-slam'(state, ctx, input, frame) {
    const slam = input.slam === true || (input.jump === true && input.crouch === true);
    if (!slam) return null;
    if (ctx.grounded !== true) return 'airborne';
    state.phase = 'windup';
    state.windup = state.params.windup;
    state.windupTotal = state.params.windup;
    frame.events.push({type: 'windup-start', verb: state.verb, duration: state.windupTotal});
    return true;
  },
  'safety-glide'(state, ctx, input, frame) {
    if (input.jumpHeld !== true && input.jump !== true) return null;
    if (ctx.grounded === true) return 'grounded';
    if (state.fuel <= 0) return 'resources';
    if (num(ctx.vy) > 0.01) return null;
    state.phase = 'active';
    state.activeTime = 0;
    state.landingArmed = true;
    frame.events.push({type: 'move-start', verb: state.verb, reason: 'glide'});
    return true;
  },
  grapple(state, ctx, input, frame) {
    if (input.mobility !== true) return null;
    if (typeof ctx.castRay !== 'function') return 'no-world';
    const params = state.params;
    const origin = ctx.origin ?? {x: num(ctx.x), y: num(ctx.y) + num(ctx.eyeHeight, 1.45), z: num(ctx.z)};
    const hit = ctx.castRay(origin, fullAim(ctx), params.distance);
    if (!hit || !Number.isFinite(hit.x) || !Number.isFinite(hit.y) || !Number.isFinite(hit.z)) {
      state.miss = params.missCooldown;
      finishVerb(state, frame, {cooldown: params.missCooldown, reason: 'miss'});
      frame.events.push({type: 'move-miss', verb: state.verb});
      return true;
    }
    state.grapple = {x: hit.x, y: hit.y, z: hit.z};
    // The ray hits a surface, not a place where an actor's feet can stand.
    // Core may resolve a nearby ledge; every step toward it is still swept.
    state.grappleLanding = params.liftScale > 0 && typeof ctx.grappleLanding === 'function'
      ? ctx.grappleLanding(hit, origin) : null;
    state.phase = 'active';
    state.activeTime = 0;
    state.landingArmed = false;
    frame.events.push({type: 'grapple-hook', verb: state.verb, pos: {...state.grapple}});
    frame.events.push({type: 'move-start', verb: state.verb, reason: 'grapple'});
    return true;
  },
  'blink-step'(state, ctx, input, frame) {
    if (input.mobility !== true) return null;
    state.chains += 1;
    state.phase = 'windup';
    state.windup = state.params.windup;
    state.windupTotal = state.params.windup;
    frame.events.push({type: 'windup-start', verb: state.verb, duration: state.windupTotal});
    return true;
  },
  'deployable-rope'(state, ctx, input, frame) {
    if (input.mobility !== true) return null;
    if (typeof ctx.castRay !== 'function') return 'no-world';
    const params = state.params;
    const origin = ctx.origin ?? {x: num(ctx.x), y: num(ctx.y) + num(ctx.eyeHeight, 1.45), z: num(ctx.z)};
    const hit = ctx.castRay(origin, fullAim(ctx), params.distance);
    if (!hit || !Number.isFinite(hit.x) || !Number.isFinite(hit.y) || !Number.isFinite(hit.z)) {
      frame.events.push({type: 'rope-miss', verb: state.verb});
      return true;
    }
    state.anchor = {
      x: hit.x, y: hit.y, z: hit.z,
      life: params.anchorLife,
      from: {x: origin.x, y: origin.y, z: origin.z},
    };
    consumeCharge(state, frame, 'rope');
    finishVerb(state, frame, {reason: 'rope'});
    frame.actions.push({
      type: 'rope-place',
      from: {...state.anchor.from},
      to: {x: state.anchor.x, y: state.anchor.y, z: state.anchor.z},
      life: params.anchorLife,
      speed: params.rideSpeed,
    });
    frame.events.push({type: 'rope-place', verb: state.verb, pos: {x: hit.x, y: hit.y, z: hit.z}, life: params.anchorLife});
    return true;
  },
};

function tryActivate(state, ctx, input, frame) {
  const blocked = canStart(state, ctx);
  if (blocked) {
    frame.blocked = blocked;
    frame.events.push({type: 'move-blocked', verb: state.verb, reason: blocked});
    return;
  }
  const handler = VERBS[state.verb];
  if (!handler) return;
  const result = handler(state, ctx, input, frame);
  if (result === true) {
    // Cline's chaining hook is the only cancel (§3.6): the new link wins and
    // the caller stops the previous movement source.
    if (state.hook === 'chaining' && ctx.verbActive === true) {
      frame.actions.push({type: 'cancel-verb', reason: 'chain'});
      frame.events.push({type: 'chain-cancel', verb: state.verb});
    }
  } else if (typeof result === 'string') {
    frame.blocked = result;
    frame.events.push({type: 'move-blocked', verb: state.verb, reason: result});
  }
}

// --- phase advances ---

function advanceWindup(state, ctx, input, frame, dt) {
  const params = state.params;
  state.windup = Math.max(0, state.windup - dt);
  if (state.windup > 0) return;
  if (state.verb === 'blink-step') {
    const direction = fullAim(ctx);
    if (params.liftScale <= 0) {
      direction.y = 0;
      const length = Math.hypot(direction.x, direction.z) || 1;
      direction.x /= length;
      direction.z /= length;
    }
    const target = directTranslation(pointOf(ctx), direction, params.distance * chainLinkScale(Math.max(0, state.chains - 1)), ctx);
    consumeCharge(state, frame, 'blink');
    state.landingArmed = direction.y > 0;
    frame.motion = {position: target, vy: null, airControl: null, keepMomentum: false, mode: 'blink'};
    finishVerb(state, frame, {reason: 'blink'});
    frame.events.push({type: 'windup-end', verb: state.verb});
    return;
  }
  if (state.verb === 'brace-slam') {
    consumeCharge(state, frame, 'slam');
    state.phase = 'active';
    state.activeTime = 0;
    state.landingArmed = true;
    if (params.leap * params.liftScale > 0) frame.motion.vy = params.leap * params.liftScale;
    else frame.events.push({type: 'no-lift', verb: state.verb});
    frame.events.push({type: 'windup-end', verb: state.verb});
    frame.events.push({type: 'slam-launch', verb: state.verb});
  }
}

function advanceCharge(state, ctx, input, frame, dt) {
  const params = state.params;
  state.windup = Math.min(state.windupTotal, state.windup + dt);
  const held = input.crouch === true;
  if (held) return;
  if (state.windup >= state.windupTotal - 1e-9 && state.windupTotal > 0) {
    consumeCharge(state, frame, 'super-jump');
    state.landingArmed = true;
    if (params.impulse * params.liftScale > 0) frame.motion.vy = params.impulse * params.liftScale;
    else frame.events.push({type: 'no-lift', verb: state.verb});
    finishVerb(state, frame, {reason: 'super-jump'});
    frame.events.push({type: 'charge-release', verb: state.verb});
  } else {
    state.phase = 'ready';
    state.windup = 0;
    state.windupTotal = 0;
    frame.events.push({type: 'charge-cancel', verb: state.verb});
  }
}

// Slam: hold the leap until the apex, then drive down hard. Landing fires the
// §13.3 4 m / 9 knockback impulse and pays the chosen 0.4 s recovery.
function stepSlam(state, ctx, frame) {
  const params = state.params;
  if (ctx.grounded === true) {
    finishVerb(state, frame, {recovery: params.landing, reason: 'slam'});
    frame.actions.push({type: 'slam-impact', radius: params.radius, knockback: params.knockback, lift: params.impactLift, source: 'movement'});
    frame.events.push({type: 'slam-impact', verb: state.verb, radius: params.radius, knockback: params.knockback});
    return true;
  }
  if (num(ctx.vy) <= 0) frame.motion.vy = -params.slamDescent;
  return false;
}

// Hover: hold jump to climb 0.35 m/s, hold crouch to brake the descent to
// 2.2 m/s; both burn fuel. Release everything and the jets cut out.
function stepHover(state, ctx, input, frame, dt) {
  const params = state.params;
  if (ctx.grounded === true || state.fuel <= 0) {
    if (state.fuel <= 0) frame.events.push({type: 'fuel-empty', verb: state.verb});
    finishVerb(state, frame, {recovery: ctx.grounded === true ? params.landing : null, reason: ctx.grounded === true ? 'land' : 'fuel'});
    return true;
  }
  const climb = input.jumpHeld === true || input.jump === true;
  const brake = input.crouch === true;
  if (!climb && !brake) {
    finishVerb(state, frame, {reason: 'release'});
    return true;
  }
  state.fuel = Math.max(0, state.fuel - dt);
  if (climb && params.liftScale > 0) {
    const room = Number.isFinite(ctx.ceilingY) ? ctx.ceilingY - num(ctx.y) : Infinity;
    frame.motion.vy = Math.min(params.climb * params.liftScale, Math.max(0, room / dt));
  } else if (!climb && num(ctx.vy) < -params.descent) {
    frame.motion.vy = -params.descent;
  }
  return false;
}

// Glide: no lift, clamp the fall to 2 m/s and let the caller add up to 4 m/s
// of horizontal air control. Fuel drains while it holds.
function stepGlide(state, ctx, input, frame, dt) {
  const params = state.params;
  if (ctx.grounded === true || state.fuel <= 0) {
    if (state.fuel <= 0) frame.events.push({type: 'fuel-empty', verb: state.verb});
    finishVerb(state, frame, {recovery: ctx.grounded === true ? params.landing : null, reason: ctx.grounded === true ? 'land' : 'fuel'});
    return true;
  }
  if (input.jumpHeld !== true && input.jump !== true) {
    finishVerb(state, frame, {reason: 'release'});
    return true;
  }
  state.fuel = Math.max(0, state.fuel - dt);
  if (num(ctx.vy) < -params.descent) frame.motion.vy = -params.descent;
  frame.motion.airControl = params.steer;
  return false;
}

function stepGrapple(state, ctx, frame, dt) {
  const params = state.params;
  const anchor = state.grapple;
  if (!anchor) {
    finishVerb(state, frame, {cooldown: params.missCooldown, reason: 'miss'});
    return true;
  }
  const end = reason => {
    finishVerb(state, frame, {reason});
    frame.events.push({type: 'grapple-release', verb: state.verb, reason});
    return true;
  };
  state.activeTime += dt;
  // A held hook must never become an unlimited hover, even after a correction
  // or a carrier pickup removes the lift it was using.
  if (state.activeTime > params.distance / params.reel * 3 + 1) return end('timeout');
  const lifts = params.liftScale > 0;
  const target = lifts && state.grappleLanding ? state.grappleLanding : anchor;
  const dx = target.x - num(ctx.x);
  const dy = target.y - num(ctx.y);
  const dz = target.z - num(ctx.z);
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= (state.grappleLanding ? 0.08 : 0.35)) return end('arrive');
  const direction = {x: dx / distance, y: dy / distance, z: dz / distance};
  if (!lifts && direction.y > 0) {
    direction.y = 0;
    const length = Math.hypot(direction.x, direction.z) || 1;
    direction.x /= length;
    direction.z /= length;
  }
  if (direction.y > 0) direction.y *= params.liftScale;
  const stepDistance = Math.min(params.reel * dt, distance);
  const from = pointOf(ctx);
  let position = grappleTranslation(from, direction, stepDistance, ctx);
  // At a wall, climb along its outside before crossing the lip. Do not climb
  // above the resolved landing or invent an escape route around an overhang.
  if (position.blocked && lifts && state.grappleLanding && dy > 0.01) {
    const remaining = stepDistance - position.moved;
    const up = grappleTranslation(position, {x: 0, y: 1, z: 0}, Math.min(remaining * params.liftScale, dy), ctx);
    position = {...up, moved: position.moved + up.moved};
  }
  frame.motion = {position, vy: lifts ? 0 : null, airControl: null, keepMomentum: false, mode: 'pull'};
  state.landingArmed = state.landingArmed || position.y > from.y;
  if (position.moved < 1e-6) return end('blocked');
  return false;
}

// Unlike blink, reeling never snaps feet to the highest floor in the column:
// that floor may be a roof above us. Sweep the actual 3D path and stop at it.
function grappleTranslation(from, direction, distance, ctx) {
  let target = {x: from.x, y: from.y, z: from.z}, moved = 0;
  const steps = Math.ceil(distance / MOVEMENT_PROBE_STEP);
  for (let i = 1; i <= steps; i++) {
    const step = Math.min(distance, i * MOVEMENT_PROBE_STEP);
    const next = {x: from.x + direction.x * step, y: from.y + direction.y * step, z: from.z + direction.z * step};
    const ground = typeof ctx.floorAt === 'function' ? ctx.floorAt(next.x, next.z) : null;
    if (!inBounds(ctx.bounds ?? INF_BOUNDS, next.x, next.z) || next.y > (ctx.ceilingY ?? Infinity)
      || (ground !== null && ground > next.y + 1e-6)
      || ctx.obstructed?.(next.x, next.y, next.z, MOVE_PROBE_RADIUS)
      || (ctx.sweepClear && !ctx.sweepClear(target, next, MOVE_PROBE_RADIUS))) {
      return {...target, moved, blocked: true};
    }
    target = next;
    moved = step;
  }
  return {...target, moved, blocked: false};
}

function stepActive(state, ctx, input, frame, dt) {
  const params = state.params;
  switch (state.verb) {
    case 'air-dash': {
      state.activeTime += dt;
      if (ctx.grounded === true || state.activeTime >= params.duration) {
        // Landing recovery is paid on the ground; an airborne dash keeps its
        // `landingArmed` flag and pays it in `land()` instead.
        finishVerb(state, frame, {recovery: ctx.grounded === true ? params.landing : null, reason: 'dash'});
        return true;
      }
      return false;
    }
    case 'brace-slam':
      return stepSlam(state, ctx, frame);
    case 'hover-jets':
      return stepHover(state, ctx, input, frame, dt);
    case 'safety-glide':
      return stepGlide(state, ctx, input, frame, dt);
    case 'grapple':
      if (input.mobilityReleased === true) {
        finishVerb(state, frame, {reason: 'release'});
        frame.events.push({type: 'grapple-release', verb: state.verb, reason: 'release'});
        return true;
      }
      return stepGrapple(state, ctx, frame, dt);
    default:
      finishVerb(state, frame, {reason: 'idle'});
      return true;
  }
}

function land(state, frame) {
  state.chains = 0;
  if (state.params.refreshOnGround) {
    state.charges = state.maxCharges;
    state.cooldown = 0;
  }
  frame.actions.push(...movementLandingActions(state));
  if (state.phase !== 'active') {
    if (state.landingArmed && state.params.landing > 0) {
      state.recovery = Math.max(state.recovery, state.params.landing);
      frame.events.push({type: 'landing-recovery', verb: state.verb, duration: state.params.landing});
    }
    state.landingArmed = false;
  }
}

function recharge(state, ctx, dt) {
  const params = state.params;
  if (state.fuelRecharge > 0 && state.fuel < state.maxFuel && ctx.grounded === true && state.phase !== 'active') {
    state.fuel = Math.min(state.maxFuel, state.fuel + state.maxFuel / state.fuelRecharge * dt);
  }
  // A charge never regenerates while its effect is still in flight, and Gemini's
  // double jump only refreshes on the ground (§3.4).
  if (state.maxCharges > 0 && state.charges < state.maxCharges && state.phase === 'ready') {
    if (params.refreshOnGround) {
      if (ctx.grounded === true) {
        state.charges = state.maxCharges;
        state.cooldown = 0;
      }
    } else if (state.cooldown <= 0) {
      state.charges = Math.min(state.maxCharges, state.charges + 1);
      if (state.charges < state.maxCharges) state.cooldown = params.cooldown;
    }
  }
}

function tickAnchor(state, frame, dt) {
  const anchor = state.anchor;
  if (!anchor) return;
  anchor.life -= dt;
  if (anchor.life <= 0) {
    const pos = {x: anchor.x, y: anchor.y, z: anchor.z};
    state.anchor = null;
    frame.actions.push({type: 'rope-remove', pos, source: 'movement'});
    frame.events.push({type: 'rope-expire', verb: state.verb, pos});
  }
}

// ---------------------------------------------------------------------------
// Public stepping / interruption / snapshot
// ---------------------------------------------------------------------------

/**
 * Advance one actor's movement state by one fixed step. Deterministic: the
 * result depends only on (state, input, ctx), and the same triple always
 * produces the same frame and the same mutated state. Returns:
 *   {verb, family, phase, enabled, active, blocked, motion, actions, events}
 * See the header for the exact `input` / `ctx` contract and how to apply it.
 */
export function stepMovement(state, input = {}, ctx = {}) {
  if (!state || typeof state !== 'object') return frameOf(null);
  const frame = frameOf(state);
  const dt = Number.isFinite(ctx.dt) && ctx.dt > 0 ? Math.min(ctx.dt, MAX_STEP_DT) : 0;
  if (dt <= 0) return frame;

  // Timers that run in every phase.
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.recovery = Math.max(0, state.recovery - dt);
  state.miss = Math.max(0, state.miss - dt);
  tickAnchor(state, frame, dt);
  if (state.enabled !== true) {
    frame.blocked = 'disabled';
    return frame;
  }

  // An interruption cancels an uncommitted wind-up / charge for free.
  if (ctx.interrupted === true || input.interrupted === true) {
    const info = interruptMovement(state, ctx.interruptReason ?? input.interruptReason ?? 'external');
    if (info.interrupted) {
      frame.events.push({type: 'windup-interrupt', verb: state.verb, reason: info.reason, phase: info.phase});
    }
  }

  recharge(state, ctx, dt);

  // Landing resolves before the active phase so a slam / hover touching down
  // this tick ends in the same step it landed.
  if (ctx.landed === true) land(state, frame);

  const phaseAtStart = state.phase;
  if (phaseAtStart === 'windup') advanceWindup(state, ctx, input, frame, dt);
  else if (phaseAtStart === 'charging') advanceCharge(state, ctx, input, frame, dt);
  else if (phaseAtStart === 'active') stepActive(state, ctx, input, frame, dt);

  if (state.phase === 'ready') tryActivate(state, ctx, input, frame);

  frame.phase = state.phase;
  frame.active = state.phase === 'active';
  return frame;
}

/**
 * Cancel any in-flight verb. Returns `{interrupted, phase, reason, refunded}`;
 * `refunded` is the resource that was never committed (`'attempt'` for a
 * wind-up, `'charge'` for a charge, null once an effect has fired).
 */
export function interruptMovement(state, reason = 'external') {
  if (!state || typeof state !== 'object') return {interrupted: false, phase: null, reason: null, refunded: null};
  const phase = state.phase;
  if (phase !== 'charging' && phase !== 'windup' && phase !== 'active') {
    return {interrupted: false, phase, reason: null, refunded: null};
  }
  const refunded = phase === 'charging' ? 'charge' : phase === 'windup' ? 'attempt' : null;
  // An effect that already fired keeps its cost: start the recharge / lockout
  // timer the normal end would have started.
  if (phase === 'active' && (state.maxCharges > 0 || state.verb === 'grapple') && state.cooldown <= 0 && state.params.cooldown > 0) {
    state.cooldown = state.params.cooldown;
  }
  state.phase = 'ready';
  state.activeTime = 0;
  state.windup = 0;
  state.windupTotal = 0;
  state.grapple = null;
  state.landingArmed = false;
  state.grappleLanding = null;
  return {interrupted: true, phase, reason, refunded};
}

/**
 * The netcode snapshot field list (§5 "Movement net state"). Plain and JSON
 * safe; assign it into the actor snapshot as `movement`.
 */
export function movementSnapshot(state) {
  if (!state || typeof state !== 'object') return null;
  const anchor = state.anchor
    ? {
        x: state.anchor.x, y: state.anchor.y, z: state.anchor.z, life: state.anchor.life,
        from: state.anchor.from ? {x: state.anchor.from.x, y: state.anchor.from.y, z: state.anchor.from.z} : null,
      }
    : null;
  const grapple = state.grapple ? {x: state.grapple.x, y: state.grapple.y, z: state.grapple.z} : null;
  return {
    v: 1,
    verb: state.verb,
    phase: state.phase,
    enabled: state.enabled === true,
    charges: state.charges,
    maxCharges: state.maxCharges,
    cooldown: state.cooldown,
    fuel: state.fuel,
    maxFuel: state.maxFuel,
    fuelRecharge: state.fuelRecharge,
    windup: state.windup,
    recovery: state.recovery,
    activeTime: state.activeTime,
    landingArmed: state.landingArmed === true,
    chains: state.chains,
    miss: state.miss,
    anchor,
    grapple,
    grappleLanding: state.grappleLanding ? {...state.grappleLanding} : null,
  };
}

/**
 * Netcode reconciliation: copy a `movementSnapshot()` back onto a live state
 * without re-resolving params (the loadout is unchanged during a match).
 */
export function applyMovementSnapshot(state, snapshot) {
  if (!state || typeof state !== 'object' || !snapshot || typeof snapshot !== 'object') return state;
  for (const field of ['charges', 'maxCharges', 'cooldown', 'fuel', 'maxFuel', 'fuelRecharge', 'windup', 'recovery', 'activeTime', 'chains', 'miss']) {
    if (Number.isFinite(snapshot[field])) state[field] = snapshot[field];
  }
  if (typeof snapshot.phase === 'string') state.phase = snapshot.phase;
  if (snapshot.enabled !== undefined) state.enabled = snapshot.enabled === true;
  if (snapshot.landingArmed !== undefined) state.landingArmed = snapshot.landingArmed === true;
  state.anchor = snapshot.anchor && Number.isFinite(snapshot.anchor.x)
    ? {x: snapshot.anchor.x, y: snapshot.anchor.y, z: snapshot.anchor.z, life: snapshot.anchor.life, from: snapshot.anchor.from ? {...snapshot.anchor.from} : null}
    : null;
  state.grapple = snapshot.grapple && Number.isFinite(snapshot.grapple.x)
    ? {x: snapshot.grapple.x, y: snapshot.grapple.y, z: snapshot.grapple.z}
    : null;
  state.grappleLanding = snapshot.grappleLanding && Number.isFinite(snapshot.grappleLanding.x)
    ? {...snapshot.grappleLanding} : null;
  return state;
}

// ===========================================================================
// Zipline rides (cable path, sag, arc-length stepping, collision-safe resolve)
// ---------------------------------------------------------------------------
// A ride is a plain, JSON-safe object so it rides snapshots, deltas and the
// netcode shadow exactly like `movement`. `from`/`to` are the authored cable
// anchors; the rider's feet travel a quadratic (sagging) cable between them and
// blend down to the landing floor over the final metres. All math is closed
// form and deterministic: no RNG, no wall clock, no terrain generation. The
// caller injects the world through `resolveZipRide(ride, world)`, so the same
// path resolves identically in the sim and in the client shadow.
// ===========================================================================
export const ZIP_RIDE = deepFreeze({
  defaultSpeed: 9,
  minDuration: .85,
  lockSeconds: .35,
  maxLift: 6,
  liftStep: .5,
  clearance: .35,
  samples: 24,
  jumpSpeedScale: .92,
  jumpLift: 3.2,
  landingBlendMeters: 4.5,
});

const ZIP_ARC_SEGMENTS = 12;

const zipEase = t => t * t * (3 - 2 * t);
const zipWrap = angle => {
  let a = (angle + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

/** Raw cable point at curve parameter `u` in [0, 1] (sag only, no landing). */
export function zipCablePoint(ride, u) {
  const t = clamp01(num(u));
  const a = ride.from, b = ride.to, sag = Math.max(0, num(ride.sag));
  const it = 1 - t;
  const cy = (a.y + b.y) * .5 - 2 * sag;
  return {
    x: it * it * a.x + 2 * it * t * ((a.x + b.x) * .5) + t * t * b.x,
    y: it * it * a.y + 2 * it * t * cy + t * t * b.y,
    z: it * it * a.z + 2 * it * t * ((a.z + b.z) * .5) + t * t * b.z,
  };
}

/**
 * Rider feet at curve parameter `u` in [0, 1]. Identical to the cable except
 * for the final landing blend, which eases the feet down onto `ride.landY` so
 * a high anchor never ends airborne.
 */
export function zipRidePoint(ride, u) {
  const point = zipCablePoint(ride, u);
  const landY = ride.landY;
  if (Number.isFinite(landY)) {
    const from = num(ride.blendFrom, 1);
    const t = clamp01(num(u));
    if (from < 1 && t > from) {
      const k = zipEase((t - from) / (1 - from));
      point.y += (landY - point.y) * k;
    }
  }
  return point;
}

/** Cumulative arc lengths (normalised curve parameter samples) for one ride. */
export function zipArcTable(ride) {
  const table = new Array(ZIP_ARC_SEGMENTS + 1);
  let previous = zipRidePoint(ride, 0), total = 0;
  table[0] = 0;
  for (let i = 1; i <= ZIP_ARC_SEGMENTS; i++) {
    const point = zipRidePoint(ride, i / ZIP_ARC_SEGMENTS);
    total += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    table[i] = total;
    previous = point;
  }
  return table;
}

/** Approximate ridden path length in metres. */
export function zipRideLength(ride) {
  const table = zipArcTable(ride);
  return table[table.length - 1];
}

/**
 * Build a ride from authored cable anchors. Returns null without valid anchors.
 * `landY` is unknown until `resolveZipRide` sees the world; the initial length
 * and duration are the cable-only estimates and are refreshed on resolve.
 */
export function buildZipRide({
  id = null, from, to, speed, sag, cooldown, minDuration, jumpOff, blendMeters,
} = {}) {
  if (!from || !to) return null;
  const ride = {
    id: id === null || id === undefined ? null : String(id),
    from: {x: num(from.x), y: num(from.y), z: num(from.z)},
    to: {x: num(to.x), y: num(to.y), z: num(to.z)},
    speed: Math.max(.1, num(speed, ZIP_RIDE.defaultSpeed)),
    sag: Math.max(0, num(sag, 0)),
    minDuration: Math.max(.1, num(minDuration, ZIP_RIDE.minDuration)),
    blendMeters: Math.max(0, num(blendMeters, ZIP_RIDE.landingBlendMeters)),
    jumpOff: jumpOff !== false,
    cooldown: Math.max(0, num(cooldown, 0)),
    t: 0,
    length: 0,
    duration: 0,
    landY: null,
    blendFrom: 1,
    lift: 0,
    resolved: false,
    blocked: false,
    truncated: false,
  };
  const chord = Math.hypot(ride.to.x - ride.from.x, ride.to.z - ride.from.z);
  ride.blendFrom = Math.max(0, Math.min(.92, 1 - ride.blendMeters / Math.max(1, chord)));
  ride.length = zipRideLength(ride);
  ride.duration = Math.max(ride.minDuration, ride.length / ride.speed);
  return ride;
}

/**
 * Resolve a built ride against the world exactly once:
 *  1. if every rider sample is clear, keep the authored cable;
 *  2. otherwise raise the whole cable (up to `maxLift`) until it is clear;
 *  3. otherwise shorten the line to the last clear sample;
 *  4. if even the first sample is unsafe, block the ride.
 * `world` = `{floorAt(x,z), clear(x,y,z,r), radius, clearance?, maxLift?, liftStep?,
 * samples?}`. Mutates and returns `{blocked, ride, lifted?, truncated?}`.
 */
export function resolveZipRide(ride, world = {}) {
  if (!ride || typeof ride !== 'object') return {blocked: true, ride: null};
  if (ride.resolved === true) return {blocked: ride.blocked === true, ride};
  const floorAt = typeof world.floorAt === 'function' ? world.floorAt : null;
  const clear = typeof world.clear === 'function' ? world.clear : null;
  const radius = num(world.radius, .4);
  const samples = Math.max(4, Math.round(num(world.samples, ZIP_RIDE.samples)));
  const maxLift = Math.max(0, num(world.maxLift, ZIP_RIDE.maxLift));
  const liftStep = Math.max(.1, num(world.liftStep, ZIP_RIDE.liftStep));
  const settle = () => {
    const floor = floorAt ? floorAt(ride.to.x, ride.to.z) : null;
    const end = zipCablePoint(ride, 1);
    ride.landY = floor !== null && floor <= end.y + .05 ? floor : null;
    ride.length = zipRideLength(ride);
    ride.duration = Math.max(ride.minDuration, ride.length / ride.speed);
    ride.arc = null;
  };
  const unsafeAt = i => {
    const point = zipRidePoint(ride, i / samples);
    if (clear && !clear(point.x, point.y, point.z, radius)) return true;
    if (floorAt) {
      // Terrain clipping is riding *below* the floor; skimming just above it
      // (boarding ramps, ground-level ropes) is legal and stays readable.
      const floor = floorAt(point.x, point.z);
      if (floor !== null && point.y < floor - .01) return true;
    }
    return false;
  };
  const firstUnsafe = () => {
    for (let i = 0; i <= samples; i++) if (unsafeAt(i)) return i;
    return -1;
  };
  const base = {...ride.from}, baseTo = {...ride.to};
  settle();
  let unsafe = firstUnsafe();
  if (unsafe < 0) { ride.resolved = true; return {blocked: false, ride}; }
  for (let lift = liftStep; lift <= maxLift + 1e-9; lift += liftStep) {
    ride.from = {x: base.x, y: base.y + lift, z: base.z};
    ride.to = {x: baseTo.x, y: baseTo.y + lift, z: baseTo.z};
    settle();
    if (firstUnsafe() < 0) {
      ride.resolved = true;
      ride.lift = lift;
      return {blocked: false, ride, lifted: lift};
    }
  }
  ride.from = base;
  ride.to = baseTo;
  settle();
  let lastSafe = -1;
  for (let i = 0; i <= samples; i++) {
    if (unsafeAt(i)) break;
    lastSafe = i;
  }
  if (lastSafe <= 0) {
    ride.blocked = true;
    ride.resolved = true;
    return {blocked: true, ride};
  }
  const cut = Math.max(1, lastSafe - 1) / samples;
  const end = zipRidePoint(ride, cut);
  ride.to = {x: end.x, y: end.y, z: end.z};
  ride.blendFrom = 1;
  ride.truncated = true;
  settle();
  ride.resolved = true;
  return {blocked: firstUnsafe() >= 0, ride, truncated: true};
}

const ZIP_STEP = {x: 0, y: 0, z: 0, tx: 0, tz: 0, progress: 0, u: 0, done: false};

/**
 * Advance one fixed tick along the resolved cable at (up to) the authored
 * speed. Writes into `out` (defaults to a shared scratch object) and returns it.
 * Travel is monotonic: `progress` never decreases and `done` latches on the
 * final tick.
 */
export function stepZipRide(ride, dt, out = ZIP_STEP) {
  if (!ride) return out;
  const table = Array.isArray(ride.arc) && ride.arc.length > 1 ? ride.arc : (ride.arc = zipArcTable(ride));
  const total = table[table.length - 1] || 0;
  ride.t = Math.min(num(ride.duration, 0), num(ride.t, 0) + Math.max(0, num(dt)));
  const progress = ride.duration > 0 ? Math.min(1, ride.t / ride.duration) : 1;
  const target = total * progress;
  let index = 1;
  while (index < table.length - 1 && table[index] < target) index++;
  const span = table[index] - table[index - 1];
  const segment = span > 1e-9 ? (target - table[index - 1]) / span : 0;
  const u = ((index - 1) + segment) / (table.length - 1);
  const point = zipRidePoint(ride, u);
  const ahead = zipRidePoint(ride, Math.min(1, u + 1e-3));
  let tx = ahead.x - point.x, tz = ahead.z - point.z;
  const length = Math.hypot(tx, tz);
  if (length > 1e-9) { tx /= length; tz /= length; } else { tx = 0; tz = 0; }
  out.x = point.x; out.y = point.y; out.z = point.z;
  out.tx = tx; out.tz = tz;
  out.u = u; out.progress = progress;
  out.done = ride.t >= num(ride.duration, 0);
  return out;
}

/** Face the direction of travel, bounded to `rate` rad/s. Pure. */
export function zipRideFace(yaw, tx, tz, rate, dt) {
  if (!(Math.abs(tx) > 1e-6 || Math.abs(tz) > 1e-6)) return num(yaw);
  const target = Math.atan2(-tx, -tz);
  const turn = Math.max(-rate * dt, Math.min(rate * dt, zipWrap(target - num(yaw))));
  return num(yaw) + turn;
}

/** True when a rider at `point` can safely leave the cable and fall to ground. */
export function zipRideDetachClear(x, y, z, world = {}) {
  const floorAt = typeof world.floorAt === 'function' ? world.floorAt : null;
  const clear = typeof world.clear === 'function' ? world.clear : null;
  if (!floorAt || !clear) return true;
  const floor = floorAt(x, z);
  if (floor === null || floor > y + ZIP_RIDE.clearance) return false;
  return clear(x, floor + .05, z, num(world.radius, .4));
}
