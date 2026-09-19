// Pure selection-screen copy for the operator class + harness spec (Phase 4,
// docs/design/CLASS_OVERHAUL.md §6.1 and docs/design/UI-AUDIT-v6.6.md I9).
//
// No DOM, no three, no React: app/ui/screens/SelectionScreen.tsx imports these
// helpers directly instead of growing the page's `UiBag`. Every helper is total
// — an unknown id returns null (or a normalised fallback through resolveKit)
// rather than throwing, because the screen renders on every keystroke.
import {CHARACTERS, HARNESSES} from './data.mjs';
import {formatNumber,formatWhole} from './format-ui.mjs';
import {MOVEMENT_VERBS, OPERATOR_KITS, SPECS, WINGS, resolveKit} from './kits.mjs';

const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));
const HARNESS_BY_ID = Object.fromEntries(HARNESSES.map(h => [h.id, h]));
const KIT_BY_ID = Object.fromEntries(OPERATOR_KITS.map(k => [k.id, k]));
const WING_BY_ID = Object.fromEntries(WINGS.map(w => [w.id, w]));
const VERB_BY_ID = Object.fromEntries(MOVEMENT_VERBS.map(v => [v.id, v]));
const SPEC_BY_ID = Object.fromEntries(SPECS.map(s => [s.id, s]));

const hasText = value => typeof value === 'string' && value.length > 0;
const upper = value => String(value ?? '').toUpperCase();
const num = value => Number.isFinite(Number(value)) ? Number(value) : null;

// The movement verb's input family, in human copy. `mobility` is the one new
// binding (§10 decision 11, KeyX); jump-family verbs reuse existing inputs.
export const INPUT_LABELS = Object.freeze({
  jump: 'JUMP',
  crouch: 'CROUCH',
  'jump-hold': 'HOLD JUMP',
  'crouch-jump': 'CROUCH + JUMP',
  mobility: 'X',
});

export const KIND_LABELS = Object.freeze({
  burst: 'BURST', buff: 'BUFF', dash: 'DASH', deploy: 'DEPLOY',
  heal: 'HEAL', recon: 'RECON', slow: 'SLOW', stance: 'STANCE',
});

export const HOOK_LABELS = Object.freeze({
  economy: 'ECONOMY', chaining: 'CHAINING', usage: 'USAGE',
  'landing-self': 'LANDING · SELF', 'landing-control': 'LANDING · CONTROL',
});

const TRIGGER_LABELS = Object.freeze({
  activate: 'ON ACTIVATION', active: 'WHILE ACTIVE', impact: 'ON IMPACT',
  air: 'AIRBORNE', land: 'ON LANDING', end: 'ON COOLDOWN', reload: 'WHILE RELOADING',
  swap: 'ON SWAP', melee: 'ON MELEE', threat: 'WHEN TARGETED', always: 'ALWAYS ON',
});

// Canonical budget order so every verb's line reads the same way. `key` is the
// MOVEMENT_VERBS budget field, `label` the unit suffix.
const BUDGET_FIELDS = Object.freeze([
  ['charges', value => `${value} ${value === 1 ? 'charge' : 'charges'}`],
  ['fuel', value => `${value} s fuel`],
  ['fuelRecharge', value => `${value} s recharge`],
  ['distance', value => `${value} m`],
  ['impulse', value => `${value} impulse`],
  ['reel', value => `${value} m/s reel`],
  ['climb', value => `${value} climb`],
  ['descent', value => `${value} m/s descent`],
  ['steer', value => `${value} steer`],
  ['windup', value => `${value} s wind-up`],
  ['radius', value => `${value} m radius`],
  ['knockback', value => `${value} knockback`],
  ['anchorLife', value => `${value} s anchor`],
  ['cooldown', value => `${value} s cooldown`],
  ['missCooldown', value => `${value} s on miss`],
  ['landing', value => `${value} s landing`],
]);

export function inputLabel(input) {
  return hasText(input) ? INPUT_LABELS[input] ?? upper(input) : null;
}

export function kindLabel(kind) {
  return hasText(kind) ? KIND_LABELS[kind] ?? upper(kind) : null;
}

export function hookLabel(hook) {
  return hasText(hook) ? HOOK_LABELS[hook] ?? upper(hook) : null;
}

export function triggerLabel(trigger) {
  return hasText(trigger) ? TRIGGER_LABELS[trigger] ?? upper(trigger) : null;
}

// One line of the movement verb's budget, e.g. '1 charge · 5.5 m · 3.5 s
// cooldown'. `null` marks a slot the plan left unspecified and is skipped.
export function budgetLine(verb) {
  const budget = verb?.budget;
  if (!budget || typeof budget !== 'object') return null;
  const parts = [];
  for (const [key, format] of BUDGET_FIELDS) {
    const value = num(budget[key]);
    if (value === null || value === 0) continue;
    parts.push(format(Number(formatNumber(value,2))));
  }
  return parts.length ? parts.join(' · ') : null;
}

// Wing chip data for a wing id, a wing record, or an operator id.
export function wingChip(value) {
  const id = hasText(value) ? (WING_BY_ID[value] ? value : KIT_BY_ID[value]?.wing ?? null)
    : value && typeof value === 'object' ? value.wing ?? value.id
      : null;
  const wing = WING_BY_ID[id];
  if (!wing) return null;
  return Object.freeze({
    id: wing.id,
    name: wing.name,
    label: wing.label,
    color: wing.color,
    family: wing.family,
    domain: wing.domain,
    pays: wing.pays,
    fantasy: wing.fantasy,
  });
}

// Movement verb view: name, family, input and the budget line. Accepts an
// operator id, a verb id or a MOVEMENT_VERBS record.
export function movementRow(value) {
  const verb = hasText(value) ? VERB_BY_ID[value] ?? VERB_BY_ID[KIT_BY_ID[value]?.movement] ?? null
    : value && typeof value === 'object' ? (value.budget || value.owner ? value : VERB_BY_ID[KIT_BY_ID[value.id]?.movement] ?? null)
      : null;
  if (!verb || !hasText(verb.id)) return null;
  return Object.freeze({
    id: verb.id,
    name: hasText(verb.name) ? verb.name : upper(verb.id),
    family: verb.family ?? null,
    input: verb.input ?? null,
    inputLabel: inputLabel(verb.input),
    budget: verb.budget ?? null,
    budgetLine: budgetLine(verb),
    carrier: verb.carrier ?? null,
  });
}

// Operator card: wing + role + signature verb + movement verb, all from the one
// class data source (game/kits.mjs). Flavour text stays on the character table.
export function operatorCard(character) {
  const kit = KIT_BY_ID[character];
  if (!kit) return null;
  const person = CHARACTER_BY_ID[character] ?? null;
  const wing = wingChip(kit.wing);
  const stats = person?.stats ?? null;
  return Object.freeze({
    id: kit.id,
    name: person?.name ?? upper(kit.id),
    color: person?.color ?? wing?.color ?? null,
    accent: person?.accent ?? null,
    tag: person?.tag ?? null,
    detail: person?.detail ?? null,
    wing,
    wingId: kit.wing,
    role: kit.role,
    roleLabel: upper(kit.role),
    signature: Object.freeze({
      id: kit.verb.id,
      name: kit.verb.name,
      line: kit.verb.description,
    }),
    movement: movementRow(kit.movement),
    strength: wing?.domain ?? null,
    weakness: wing?.pays ?? null,
    stats,
    statsLine: stats ? `${formatWhole(stats.health)} HP · ${formatWhole(stats.armor)} ARM · ${formatNumber(stats.speed)} m/s` : null,
  });
}

// Signature verb view (always-on operator trait).
export function signatureVerb(character) {
  const kit = KIT_BY_ID[character];
  if (!kit) return null;
  return Object.freeze({id: kit.verb.id, name: kit.verb.name, line: kit.verb.description});
}

// Harness spec sheet: the active, the behavioural tradeoff passive and the
// movement hook, keyed by harness id (the spec id and the harness id are one).
export function specSheet(harness) {
  const spec = SPEC_BY_ID[harness];
  if (!spec) return null;
  const harnessTable = HARNESS_BY_ID[spec.id] ?? null;
  return Object.freeze({
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    kindLabel: kindLabel(spec.kind),
    buff: spec.buff ?? null,
    active: Object.freeze({
      id: spec.id,
      name: spec.active?.name ?? harnessTable?.power ?? spec.name,
      description: harnessTable?.description ?? null,
      stat: harnessTable?.stat ?? null,
      cooldown: num(spec.active?.cooldown),
    }),
    tradeoff: Object.freeze({
      id: spec.tradeoff.id,
      name: spec.tradeoff.name,
      description: spec.tradeoff.description,
    }),
    passive: Object.freeze({
      trigger: spec.passive.trigger,
      triggerLabel: triggerLabel(spec.passive.trigger),
      effects: spec.passive.effects,
    }),
    movementHook: spec.movementHook ?? null,
    hookLabel: hookLabel(spec.movementHook),
  });
}

// Per-wing rider for one operator + harness pair, straight from resolveKit.
export function wingRider(character, harness) {
  const rider = resolveKit(character, harness).rider;
  if (!rider) return null;
  return Object.freeze({
    wing: rider.wing,
    id: rider.id,
    trigger: rider.trigger,
    triggerLabel: triggerLabel(rider.trigger),
    description: rider.description,
  });
}

// 'Mistral + Cline — Longest distance, weapon ready on arrival.' The rider
// sentence is the combo copy: it is already the one line that explains what the
// pair does differently.
export function comboLine(character, harness) {
  const kit = KIT_BY_ID[character];
  const spec = hasText(harness) ? resolveKit(character, harness) : null;
  const person = CHARACTER_BY_ID[kit?.id] ?? null;
  if (!person || !spec) return null;
  const rider = spec.rider?.description ? ` — ${spec.rider.description}` : '';
  return `${person.name} + ${spec.active?.name ?? upper(spec.harness)}${rider}`;
}

// The preview stage's KIT tab: one composed record from the resolved kit.
export function kitView(character, harness) {
  const kit = resolveKit(character, harness);
  const card = operatorCard(kit.character);
  const spec = specSheet(kit.harness);
  const rider = kit.rider ? Object.freeze({
    wing: kit.rider.wing,
    id: kit.rider.id,
    trigger: kit.rider.trigger,
    triggerLabel: triggerLabel(kit.rider.trigger),
    description: kit.rider.description,
  }) : null;
  return Object.freeze({
    character: kit.character,
    harness: kit.harness,
    name: card?.name ?? upper(kit.character),
    color: card?.color ?? null,
    role: card?.role ?? null,
    roleLabel: card?.roleLabel ?? null,
    wing: wingChip(kit.wing),
    signature: card?.signature ?? null,
    movement: movementRow(kit.movement),
    active: spec?.active ?? null,
    kind: kit.kind,
    kindLabel: kindLabel(kit.kind),
    tradeoff: kit.tradeoff ? Object.freeze({
      id: kit.tradeoff.id,
      name: kit.tradeoff.name,
      description: kit.tradeoff.description,
    }) : null,
    passive: spec?.passive ?? null,
    rider,
    movementHook: kit.movementHook ?? null,
    hookLabel: hookLabel(kit.movementHook),
    combo: comboLine(kit.character, kit.harness),
    statsLine: card?.statsLine ?? null,
  });
}

// Re-exported handles so a screen can render the roster in data order without
// importing kits.mjs itself.
export {MOVEMENT_VERBS, OPERATOR_KITS, SPECS, WINGS};
