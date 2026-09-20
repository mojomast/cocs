// Pure, engine- and DOM-free presentation math for the class HUD (Phase 4,
// docs/design/CLASS_OVERHAUL.md §6). Two callers:
//
//   abilityRing(player, ability, config, state)
//     The rider-aware harness-ability ring. It mirrors the exact guards and
//     cooldown formula of `Match.power` (game/core.mjs) instead of the old
//     cooldown/fastPowers-only math, so Haste (`cooldownMultiplier`), the
//     wing-rider cooldown bonus, mode/mutator/objective blocks and the vehicle
//     case all agree with the simulation.
//
//   movementHud(movement, kitMovement)
//     The movement card's economy view: fuel/charges, wind-up/active phase and
//     a snapshot-only `ready` flag. `kitMovement` is optional (the resolved
//     MOVEMENT_VERBS entry, e.g. `resolveKit(...).movement`) and only supplies
//     the display name and the budget cooldown used for ring progress.
//
//   verbMeters(player)
//     The operator signature-verb row: bounded 0..1 meters for whichever verb
//     state `player.verbState` (operator-verbs.mjs `operatorVerbSnapshot`)
//     exposes — Heat, Deep Compute, Braced, Alignment Review, Adaptive,
//     Long Context, Tool Use — plus a passive name chip for the two verbs with
//     no numeric state (Effortless, Revision).
//
// All helpers are total: malformed or partial snapshots return neutral values
// rather than throwing, because the HUD renders every 80 ms from network data.
import {riderBonus} from './spec-effects.mjs';
import {formatCountdown} from './format-ui.mjs';
import {OPERATOR_VERBS,DEEP_COMPUTE,HEAT,ALIGNMENT_REVIEW,ADAPTIVE,TOOL_USE} from './operator-verbs.mjs';

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp01 = value => Math.max(0, Math.min(1, value));
const hasText = value => typeof value === 'string' && value.length > 0;

// Reasons `Match.power` refuses an activation, most-specific first. The label
// branch in `abilityRing` keeps the historical 'DRIVING' / 'OFF' copy.
export const ABILITY_BLOCK_REASONS = Object.freeze([
  'over', 'race', 'dead', 'instagib', 'vehicle', 'carrier', 'vip', 'suppressed',
]);

/**
 * Why the harness active cannot fire right now, or null when it can. Mirrors
 * core `power()`: `this.race || this.over || a.health<=0 || instagib ||
 * flagCarrier(a) || a.isVip===true || movement.carrier.suppressActive`.
 * `state` may carry snapshot-level overrides: `{over, race, instagib, vehicle,
 * carrier, vip, suppressed}` (each optional; the actor/config values are read
 * when the override is absent).
 */
export function abilityBlockReason(player = {}, config = {}, state = {}) {
  const p = player && typeof player === 'object' ? player : {};
  const c = config && typeof config === 'object' ? config : {};
  const s = state && typeof state === 'object' ? state : {};
  const mode = s.mode ?? c.mode ?? null;
  if (s.over === true) return 'over';
  if (s.race === true || mode === 'puma-race' || mode === 'puma-soccer') return 'race';
  if (num(p.health, 1) <= 0) return 'dead';
  if (s.instagib === true || c.instagib === true || mode === 'instagib') return 'instagib';
  if (s.vehicle === true || p.vehicleId !== null && p.vehicleId !== undefined) return 'vehicle';
  const carrying = s.carrier ?? (mode === 'ctf' && p.carryingFlag === true);
  if (carrying === true) return 'carrier';
  if (s.vip === true || p.isVip === true) return 'vip';
  if (s.suppressed === true || p.movement?.carrier?.suppressActive === true) return 'suppressed';
  return null;
}

/**
 * Ring view for one harness active.
 *   - ratio: 0..1 fill. 1 while active; otherwise charge progress against the
 *     effective cooldown `(ability.cooldown) * (fastPowers ? .5 : 1) *
 *     player.cooldownMultiplier + riderBonus(...,'cooldown',... trigger 'end')`.
 *   - ready/active/disabled: mutually useful booleans (ready is false while the
 *     active window runs, matching the old HUD copy).
 *   - seconds: remaining active time while active, remaining cooldown otherwise.
 *   - label: 'DRIVING' | 'OFF' | 'ACTIVE 1.2s' | 'READY' | '3.4s'.
 *   - reason: the `ABILITY_BLOCK_REASONS` entry when disabled, else null.
 *   - max: the effective cooldown in seconds (0 when unknowable).
 */
export function abilityRing(player = {}, ability = null, config = {}, state = {}) {
  const p = player && typeof player === 'object' ? player : {};
  const cooldown = Math.max(0, num(p.cooldown));
  const activeSeconds = Math.max(0, num(p.active));
  const active = activeSeconds > 0;
  const fast = config?.fastPowers === true ? 0.5 : 1;
  const haste = num(p.cooldownMultiplier, 1) || 1;
  const base = Math.max(0, num(ability?.cooldown ?? ability?.cooldownSeconds));
  const rider = riderBonus(p.character, p.harness, 'cooldown', 0, {trigger: 'end'});
  const max = Math.max(0, base * fast * haste + rider);
  const ratio = active ? 1 : max > 0 ? clamp01(1 - cooldown / max) : cooldown > 0 ? 0 : 1;
  const reason = abilityBlockReason(p, config, state);
  const disabled = reason !== null;
  const ready = !disabled && !active && cooldown <= 0;
  const seconds = active ? activeSeconds : cooldown;
  const label = reason === 'vehicle' ? 'DRIVING'
    : disabled ? 'OFF'
    : active ? `ACTIVE ${formatCountdown(seconds)}s`
    : ready ? 'READY'
    : `${formatCountdown(seconds)}s`;
  return {ratio, ready, active, disabled, seconds, label, reason, max};
}

const titleCase = id => String(id)
  .split(/[-_\s]+/)
  .filter(Boolean)
  .map(word => word[0].toUpperCase() + word.slice(1))
  .join(' ');

/**
 * Movement card view from one `movementSnapshot` and the optional resolved kit
 * movement verb. Returns a plain, render-ready record:
 *   - phase: 'ready' | 'charging' | 'windup' | 'active'
 *   - charges/maxCharges, fuel/maxFuel, windup/windupTotal/charge, cooldown
 *   - verb (id) and name (official kit name when supplied, else title-cased id)
 *   - enabled: false when the mode/carrier rule stripped the verb
 *   - ready: enabled, idle phase, an available charge, fuel>0, cooldown done
 *   - progress: 0..1 ring fill (charges > fuel > cooldown-vs-budget > binary)
 *   - note: 'OFF' | 'CHARGING 42%' | 'WIND-UP' | 'ACTIVE' | '1/1' | '37%' |
 *     '3.4s' | 'READY' — the status line under the card label.
 */
export function movementHud(movement = null, kitMovement = null) {
  const m = movement && typeof movement === 'object' ? movement : null;
  if (!m) {
    const emptyKit = kitMovement && typeof kitMovement === 'object' ? kitMovement : null;
    return {
      phase: 'ready', charges: 0, maxCharges: 0, cooldown: 0, fuel: 0, maxFuel: 0,
      windup: 0, windupTotal: 0, charge: null,
      verb: emptyKit && hasText(emptyKit.id) ? emptyKit.id : null,
      name: emptyKit && hasText(emptyKit.name) ? emptyKit.name : 'MOVEMENT',
      ready: false, enabled: false, progress: 0, note: 'OFF',
    };
  }
  const kit = kitMovement && typeof kitMovement === 'object' ? kitMovement : null;
  const phase = hasText(m.phase) ? m.phase : 'ready';
  const enabled = m.enabled !== false;
  const maxCharges = Math.max(0, num(m.maxCharges));
  const rawCharges = Math.max(0, num(m.charges));
  const charges = maxCharges > 0 ? Math.min(rawCharges, maxCharges) : rawCharges;
  const maxFuel = Math.max(0, num(m.maxFuel));
  const fuel = Math.max(0, Math.min(maxFuel || num(m.fuel), num(m.fuel)));
  const cooldown = Math.max(0, num(m.cooldown));
  const windup = Math.max(0, num(m.windup));
  const windupTotal = Math.max(0, num(m.windupTotal));
  const charge = windupTotal > 0 ? clamp01(phase === 'charging' ? windup / windupTotal : 1 - windup / windupTotal) : null;
  const verb = hasText(m.verb) ? m.verb : hasText(kit?.id) ? kit.id : null;
  const name = hasText(kit?.name) ? kit.name : verb ? titleCase(verb) : 'MOVEMENT';
  const chargeOk = maxCharges === 0 || charges > 0;
  const fuelOk = maxFuel === 0 || fuel > 0;
  const ready = enabled && phase === 'ready' && chargeOk && fuelOk && cooldown <= 0;
  const budgetCooldown = Math.max(0, num(kit?.budget?.cooldown));
  let progress;
  if (phase === 'active') progress = 1;
  else if (maxCharges > 0) progress = clamp01(charges / maxCharges);
  else if (maxFuel > 0) progress = clamp01(fuel / maxFuel);
  else if (cooldown > 0 && budgetCooldown > 0) progress = clamp01(1 - cooldown / budgetCooldown);
  else progress = cooldown > 0 ? 0 : 1;
  const note = !enabled ? 'OFF'
    : phase === 'charging' || phase === 'windup' ? (charge === null ? 'WIND-UP' : `CHARGING ${Math.round(charge * 100)}%`)
    : phase === 'active' ? 'ACTIVE'
    : maxCharges > 0 ? `${Math.round(charges)}/${maxCharges}${cooldown > 0 ? ` · ${formatCountdown(cooldown)}s` : ''}`
    : maxFuel > 0 ? `${Math.round(clamp01(fuel / Math.max(1e-9, maxFuel)) * 100)}%${cooldown > 0 ? ` · ${formatCountdown(cooldown)}s` : ''}`
    : cooldown > 0 ? `${formatCountdown(cooldown)}s`
    : 'READY';
  return {phase, charges, maxCharges, cooldown, fuel, maxFuel, windup, windupTotal, charge, verb, name, ready, enabled, progress, note};
}

/**
 * Operator signature-verb meters from one `operatorVerbSnapshot()` record
 * (`player.verbState`). The hook namespaces own every scale (Heat's cap,
 * Deep Compute's charge, the Review absorb pool, the Adaptive first-mag and
 * Tool Use windows, Braced's out-of-combat timer), so a reading can never
 * drift from the behaviour it mirrors. Returns an empty list while the verb is
 * inert (race/soccer/instagib clear it) or unknown, otherwise:
 *   - id: stable key for React
 *   - label: short uppercase name for the meter/chip
 *   - value: bounded 0..1 reading (1 for passive chips)
 *   - text: short current reading, e.g. '+8%' | '64%' | 'OUT 1.2s' | '2'
 *   - passive: true when the verb has no numeric state; render a name chip
 *     instead of a bar.
 */
export function verbMeters(player = {}) {
  const state = player && typeof player === 'object' ? player.verbState : null;
  if (!state || typeof state !== 'object' || !hasText(state.verb) || state.active !== true) return [];
  const numbers = id => OPERATOR_VERBS[id]?.numbers ?? {};
  switch (state.verb) {
    case 'heat': {
      const max = Math.max(1e-9, num(numbers('heat').maxFireRateBonus, .12));
      const value = clamp01(num(HEAT.glow(state)));
      return [{id: 'heat', label: 'HEAT', value, text: value > 0 ? `+${Math.round(value * max * 100)}%` : 'IDLE'}];
    }
    case 'deep-compute': {
      const value = clamp01(num(DEEP_COMPUTE.charge(state)));
      return [{id: 'compute', label: 'COMPUTE', value, text: `${Math.round(value * 100)}%`}];
    }
    case 'braced': {
      const total = Math.max(1e-9, num(numbers('braced').combatSeconds, 1.5));
      const combat = Math.max(0, num(state.combatIn));
      return [{id: 'braced', label: 'BRACED', value: combat > 0 ? clamp01(1 - combat / total) : 1, text: combat > 0 ? `OUT ${formatCountdown(combat)}s` : 'REGEN'}];
    }
    case 'alignment-review': {
      // One reading at a time: the live absorb pool outranks the build meter.
      const status = ALIGNMENT_REVIEW.status(state);
      const absorb = Math.max(1, num(numbers('alignment-review').absorb, 35));
      if (status.pool > 0) return [{id: 'absorb', label: 'ABSORB', value: clamp01(status.pool / absorb), text: `${Math.round(status.pool)} HP`}];
      const text = status.meter > 0 ? `${Math.round(status.meter * 100)}%` : status.suppressed ? 'PAUSED' : 'HOLD';
      return [{id: 'align', label: 'ALIGN', value: clamp01(status.meter), text}];
    }
    case 'adaptive': {
      const total = Math.max(1e-9, num(numbers('adaptive').firstMagSeconds, 6));
      const left = Math.max(0, num(state.windowIn));
      const open = ADAPTIVE.windowActive(state);
      return [{id: 'first-mag', label: 'FIRST MAG', value: open ? clamp01(left / total) : 0, text: open ? `${formatCountdown(left)}s` : 'CLOSED'}];
    }
    case 'long-context': {
      // Trails are the only bounded reading Long Context exposes; three is the
      // display cap, not a sim limit.
      const trails = Array.isArray(state.trails) ? state.trails.filter(trail => trail && num(trail.ttl) > 0).length : 0;
      return [{id: 'trails', label: 'TRAILS', value: clamp01(trails / 3), text: `${trails}`}];
    }
    case 'tool-use': {
      const total = Math.max(1e-9, num(numbers('tool-use').handlingSeconds, 3));
      const left = Math.max(0, num(state.windowIn));
      const open = TOOL_USE.windowActive(state);
      return [{id: 'tool-use', label: 'TOOL USE', value: open ? clamp01(left / total) : 0, text: open ? `${formatCountdown(left)}s` : 'IDLE'}];
    }
    case 'effortless':
    case 'revision': {
      const name = OPERATOR_VERBS[state.verb]?.name ?? state.verb;
      return [{id: state.verb, label: String(name).toUpperCase(), value: 1, text: 'PASSIVE', passive: true}];
    }
    default:
      return [];
  }
}
