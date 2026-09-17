import {CHARACTERS, HARNESSES, WEAPONS, resolveLoadout} from './data.mjs';
import {abilityOf, harnessBotHints, harnessVehicle} from './harness-profiles.mjs';
// Gear ids resolve through progression.mjs. Verified at Phase 3A: progression.mjs
// imports only attachments.mjs and cosmetics.mjs, and neither imports kits.mjs
// (or anything that imports it), so this static edge cannot form a cycle.
import {resolveGear} from './progression.mjs';

// ---------------------------------------------------------------------------
// COCS class & harness data model (docs/design/CLASS_OVERHAUL.md §13).
//
// Operator = class: stat block (always read from data.mjs, never copied here),
// one always-on signature verb, one movement verb, a 3-weapon affinity band and
// a small AI policy. Harness = spec: one data-driven active ability, one
// behavioural tradeoff passive and one wing rider.
//
// This module is data plus one resolver. It imports no view/app code, never
// mutates data.mjs, and deep-freezes everything it exports. Phase 3A promotes
// the 21 rider strings to structured, inert effect descriptors and adds the 7
// behavioural spec passives (§3.3/§3.6). No engine hot path consumes them yet,
// so behaviour is unchanged.
// ---------------------------------------------------------------------------

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

// Ability dispatch vocabulary (refines §3.5 / §13.2). Movement verbs are a
// separate namespace and never flow through the ability router.
export const KINDS = deepFreeze(['burst', 'buff', 'dash', 'heal', 'slow', 'deploy', 'recon', 'stance']);

// Three wings, three operators each (§3.1). `family` is the shared movement
// tempo; `domain` / `pays` are the one-line role summary used by the HUD and
// the selection screen in Phase 4.
export const WINGS = deepFreeze([
  {
    id: 'striker', name: 'Strikers', label: 'STRIKER', color: '#ff9d5c', family: 'burst',
    domain: 'close and mid-range fights, flanks and rotations',
    pays: 'sustain and range',
    fantasy: 'In your face, three flavours.',
  },
  {
    id: 'vanguard', name: 'Vanguards', label: 'VANGUARD', color: '#57b9ff', family: 'deliberate',
    domain: 'holding space, objectives and attrition',
    pays: 'mobility and range flexibility',
    fantasy: 'Hold the line, outlast you.',
  },
  {
    id: 'tactician', name: 'Tacticians', label: 'TACTICIAN', color: '#b797ff', family: 'tool',
    domain: 'long range, information, objectives and vehicles',
    pays: 'dominance on any single axis',
    fantasy: 'Win the map, not the duel.',
  },
]);

// One movement verb per operator (§3.4), in wing order. Budget numbers are the
// §13.3 Phase-2 baseline, tune in Phase 5; `null` marks a slot the plan left
// unspecified. `carrier` describes the objective-carrier rule for the verb:
// `drop` loses the verb by default, `weakened` marks the single class-level
// exception (§3.7: Qwen's class, else the Hermes spec), and `lift` records
// whether the weakened exception's "no vertical lift" clause bites.
export const MOVEMENT_VERBS = deepFreeze([
  {
    id: 'air-dash', name: 'Air Dash', owner: 'mistral', family: 'burst', input: 'jump',
    budget: {charges: 1, distance: 5.5, cooldown: 3.5, windup: 0, landing: .15},
    carrier: {drop: true, weakened: false, lift: false},
  },
  {
    id: 'double-jump', name: 'Double Jump', owner: 'gemini', family: 'burst', input: 'jump',
    budget: {charges: 1, impulse: 7.4, cooldown: 0, windup: 0, landing: 0},
    carrier: {drop: true, weakened: false, lift: true},
  },
  {
    id: 'super-jump', name: 'Super Jump', owner: 'grok', family: 'burst', input: 'crouch',
    budget: {charges: 1, impulse: 12.5, windup: .55, cooldown: 6, landing: .25},
    carrier: {drop: true, weakened: false, lift: true},
  },
  {
    id: 'hover-jets', name: 'Hover Jets', owner: 'deepseek', family: 'deliberate', input: 'jump-hold',
    budget: {fuel: 2.5, fuelRecharge: 1.8, climb: .35, descent: 2.2, windup: 0, landing: .2},
    carrier: {drop: true, weakened: false, lift: true},
  },
  {
    id: 'brace-slam', name: 'Brace Slam', owner: 'meta', family: 'deliberate', input: 'crouch-jump',
    // Landing recovery is "commitment" in §3.4 but has no pinned number yet.
    budget: {windup: .15, radius: 4, knockback: 9, cooldown: 8, landing: null},
    carrier: {drop: true, weakened: false, lift: true},
  },
  {
    id: 'safety-glide', name: 'Safety Glide', owner: 'claude', family: 'deliberate', input: 'jump-hold',
    // Glide fuel is a Phase-2 tuning slot: §3.6 pins fuel/s but not the pool.
    budget: {fuel: null, descent: 2, steer: 4, windup: 0, landing: 0},
    carrier: {drop: true, weakened: false, lift: false},
  },
  {
    id: 'grapple', name: 'Grapple', owner: 'chatgpt', family: 'tool', input: 'mobility',
    budget: {distance: 14, reel: 12, cooldown: 7, missCooldown: 3, windup: 0, landing: 0},
    carrier: {drop: true, weakened: false, lift: true},
  },
  {
    id: 'blink-step', name: 'Blink Step', owner: 'kimi', family: 'tool', input: 'mobility',
    budget: {distance: 6, windup: .3, cooldown: 6, landing: 0},
    carrier: {drop: true, weakened: false, lift: true},
  },
  {
    id: 'deployable-rope', name: 'Deployable Rope', owner: 'qwen', family: 'tool', input: 'mobility',
    budget: {charges: 1, anchorLife: 20, cooldown: 12, windup: 0, landing: 0},
    carrier: {drop: true, weakened: true, lift: true},
  },
]);

// Operator kits, grouped three per wing (§3.2). `preferred` carries the full
// 3-weapon affinity band; its first two entries are exactly the historical
// operator-profiles.mjs pair, in the historical order, so the shim stays
// byte-compatible. `movement` references MOVEMENT_VERBS by id; `bot` is the
// Phase-2 AI policy (existing archetype vocabulary + how the verb is spent).
const AFFINITY_BONUS = 1.08;
const WEAPON_IDS = WEAPONS.map((_, index) => index);
const affinityFor = preferred => Object.fromEntries(
  WEAPON_IDS.map(index => [index, preferred.includes(index) ? AFFINITY_BONUS : 1]),
);

const rawKits = [
  {
    id: 'mistral', wing: 'striker', role: 'flanker', preferred: [3, 7, 9], strafe: 1.08, movement: 'air-dash',
    verb: {id: 'effortless', name: 'Effortless', description: 'Stronger air control and longer slides; slide-hop timing is more forgiving.'},
    bot: {archetype: 'flanker', mobility: 'engage'},
  },
  {
    id: 'gemini', wing: 'striker', role: 'duelist', preferred: [3, 2, 8], strafe: 1, movement: 'double-jump',
    verb: {id: 'revision', name: 'Revision', description: 'Carries two primaries; swapping skips holster time and bloom already persists.'},
    bot: {archetype: 'flanker', mobility: 'engage'},
  },
  {
    id: 'grok', wing: 'striker', role: 'disruptor', preferred: [1, 5, 4], strafe: .9, movement: 'super-jump',
    verb: {id: 'heat', name: 'Heat', description: 'Consecutive hits build Heat up to +12% fire rate; it decays 1.5 s after the last hit and resets on death.'},
    bot: {archetype: 'rusher', mobility: 'engage'},
  },
  {
    id: 'deepseek', wing: 'vanguard', role: 'ambusher', preferred: [5, 4, 8], strafe: .52, movement: 'hover-jets',
    verb: {id: 'deep-compute', name: 'Deep Compute', description: 'Sustained fire builds a visible charge; the next shot releases bonus damage, taking the max with attachment charge.'},
    bot: {archetype: 'sharpshooter', mobility: 'hold'},
  },
  {
    id: 'meta', wing: 'vanguard', role: 'connector', preferred: [4, 6, 1], strafe: .68, movement: 'brace-slam',
    verb: {id: 'braced', name: 'Braced', description: 'Spawn armor slowly regenerates out of combat; crouching without firing halves knockback.'},
    bot: {archetype: 'defender', mobility: 'engage'},
  },
  {
    id: 'claude', wing: 'vanguard', role: 'anchor', preferred: [2, 6, 8], strafe: .58, movement: 'safety-glide',
    verb: {id: 'alignment-review', name: 'Alignment Review', description: 'Holding ground builds a review meter; at threshold it grants a temporary absorb pool of about 35 HP for 2.5 s.'},
    bot: {archetype: 'defender', mobility: 'escape'},
  },
  {
    id: 'chatgpt', wing: 'tactician', role: 'adaptive', preferred: [0, 4, 8], strafe: .78, movement: 'grapple',
    verb: {id: 'adaptive', name: 'Adaptive', description: 'Fastest weapon swap; after a swap, the first magazine keeps a small handling bonus.'},
    bot: {archetype: 'support', mobility: 'route'},
  },
  {
    id: 'kimi', wing: 'tactician', role: 'orbiter', preferred: [6, 0, 2], strafe: 1.16, movement: 'blink-step',
    verb: {id: 'long-context', name: 'Long Context', description: 'Enemy movement leaves brief radar trails and the range band pushes slightly past other operators.'},
    bot: {archetype: 'sharpshooter', mobility: 'reposition'},
  },
  {
    id: 'qwen', wing: 'tactician', role: 'optimizer', preferred: [0, 2, 9], strafe: .72, movement: 'deployable-rope',
    verb: {id: 'tool-use', name: 'Tool Use', description: 'Faster pickups and timed-objective interactions, better vehicle handling and repair, plus a bounded combat floor.'},
    bot: {archetype: 'support', mobility: 'route'},
  },
];

export const OPERATOR_KITS = deepFreeze(rawKits.map(kit => ({...kit, affinity: affinityFor(kit.preferred)})));

const KIT_BY_ID = Object.fromEntries(OPERATOR_KITS.map(kit => [kit.id, kit]));
const VERB_BY_ID = Object.fromEntries(MOVEMENT_VERBS.map(verb => [verb.id, verb]));

// Five movement hooks on four shared trigger events keep the spec matrix at
// five rules instead of 63 bespoke interactions (§3.4 / §3.6).
export const MOVEMENT_HOOK_BY_SPEC = deepFreeze({
  hermes: 'economy',
  cline: 'chaining',
  opencode: 'usage',
  codex: 'landing-self',
  claudecode: 'landing-self',
  openclaw: 'landing-control',
  roo: 'landing-control',
});

// ---------------------------------------------------------------------------
// Shared rider/passive vocabulary (§3.3 rider table, §3.6 events)
// ---------------------------------------------------------------------------
// Every rider and every passive picks exactly one trigger from this list. The
// engine may branch on these values, but never on a spec or operator id, so the
// same 21 rows keep working when Phase 4/5 rewires dispatch.
export const SPEC_TRIGGERS = deepFreeze([
  'activate', // §3.6 activate: the active/verb was accepted; resources paid.
  'active',   // the active window is running.
  'impact',   // the active connected with a target.
  'air',      // §3.6 air: off the ground with verb resources remaining.
  'land',     // §3.6 land: a clean landing this tick.
  'end',      // §3.6 end: fuel empty / charge spent / cooldown starts.
  'reload',   // a weapon reload is in progress.
  'swap',     // a weapon swap / holster is in progress.
  'melee',    // a melee arc swing.
  'threat',   // an enemy holds a bead on the actor.
  'always',   // continuous state; no discrete event.
]);

// Labelled effect axes for riders and passives. `type` names the thing being
// changed so a percentage can never be an unlabelled key; the parameters are
// bounded numbers in the axis' own unit:
//   scale  multiplicative factor (1 = unchanged)
//   bonus  additive delta (seconds / metres / m·s⁻¹ / charges)
//   amount fraction of a pool (mitigation/overheal) or a slow multiplier
//   duration/reel/range/cooldown  seconds or metres in the named unit
//   status/mode/during            string switches from the row's own text
export const SPEC_EFFECT_TYPES = deepFreeze([
  'pull', 'knockback', 'radius', 'duration', 'cooldown', 'distance',
  'speed', 'mitigation', 'cleanse', 'unstoppable', 'feint', 'placement',
  'slow', 'holster', 'overheal', 'ammo', 'threat-ping', 'melee-arc',
  'sprint', 'reload', 'air-control', 'slide', 'damage',
]);

export const SPEC_EFFECT_TARGETS = deepFreeze(['self', 'enemies', 'ability']);

// Spec descriptors keyed to the harness table order. `kind`, `buff` and the
// `active` descriptor itself come from harness-profiles.mjs (one source);
// `vehicle` and `bot` are the existing per-harness skill/hint tables.
//
// `passive` is the structured face of `tradeoff` (§3.3): the same id/name/
// description the UI shows, plus one shared trigger and labelled effects. No
// passive carries an unlabelled speed/damage/resistance multiplier.
//
// `riders` holds the 21 wing riders: one per spec × wing, each a shared trigger,
// labelled effect descriptors and the human sentence kept for UI legibility.
// Phase 3A keeps them inert data — no engine hot path reads them yet.
const makeRider = (wing, id, trigger, description, effects) => ({wing, id, trigger, description, effects});

const rawSpecs = {
  openclaw: {
    tradeoff: {id: 'grip', name: 'Grip', description: 'Melee arc +25%.'},
    passive: {
      trigger: 'melee',
      effects: [{type: 'melee-arc', target: 'self', scale: 1.25}],
    },
    riders: {
      striker: makeRider('striker', 'claw-pull', 'impact', 'Pull-in on the claw pulse.', [
        {type: 'pull', target: 'enemies', reel: 10},
      ]),
      vanguard: makeRider('vanguard', 'claw-knockback', 'impact', 'Bigger knockback on the claw pulse.', [
        {type: 'knockback', target: 'enemies', bonus: 4},
      ]),
      tactician: makeRider('tactician', 'claw-radius', 'activate', 'Wider claw pulse radius.', [
        {type: 'radius', target: 'ability', bonus: 1.5},
      ]),
    },
  },
  hermes: {
    tradeoff: {id: 'express', name: 'Express', description: 'Can sprint while reloading.'},
    passive: {
      trigger: 'reload',
      effects: [{type: 'sprint', target: 'self', during: 'reload'}],
    },
    riders: {
      striker: makeRider('striker', 'rush-duration', 'activate', 'Longer courier rush.', [
        {type: 'duration', target: 'ability', bonus: 1},
      ]),
      vanguard: makeRider('vanguard', 'rush-mitigation', 'active', '25% mitigation during the rush.', [
        {type: 'mitigation', target: 'self', amount: .25},
      ]),
      tactician: makeRider('tactician', 'rush-cooldown', 'end', 'Courier rush cooldown −1 s.', [
        {type: 'cooldown', target: 'ability', bonus: -1},
      ]),
    },
  },
  opencode: {
    tradeoff: {id: 'multiplex', name: 'Multiplex', description: 'Reload continues while swapped.'},
    passive: {
      trigger: 'swap',
      effects: [{type: 'reload', target: 'self', during: 'swap', mode: 'continue'}],
    },
    riders: {
      striker: makeRider('striker', 'burst-speed', 'active', 'Faster while the burst is active.', [
        {type: 'speed', target: 'self', bonus: .75},
      ]),
      // §3.3's table cell read "Guardrail lasts 1 s longer" in OpenCode's row;
      // Guardrail is Claude Code's active, so this is the same rider's intent
      // expressed on OpenCode's own active (Phase-3 tuning text).
      vanguard: makeRider('vanguard', 'burst-duration', 'activate', 'The burst lasts 1 s longer.', [
        {type: 'duration', target: 'ability', bonus: 1},
      ]),
      tactician: makeRider('tactician', 'burst-holster', 'activate', 'Skip the next holster.', [
        {type: 'holster', target: 'self', mode: 'skip', charges: 1},
      ]),
    },
  },
  claudecode: {
    tradeoff: {id: 'linted', name: 'Linted', description: 'Brief threat ping when an enemy holds a bead on you.'},
    passive: {
      trigger: 'threat',
      effects: [{type: 'threat-ping', target: 'self', range: 35, duration: .75, cooldown: 3}],
    },
    riders: {
      striker: makeRider('striker', 'guard-cleanse', 'activate', 'Cleanse slow on activation.', [
        {type: 'cleanse', target: 'self', status: 'slow'},
      ]),
      vanguard: makeRider('vanguard', 'guard-mitigation', 'active', '+10% mitigation while active.', [
        {type: 'mitigation', target: 'self', amount: .10},
      ]),
      tactician: makeRider('tactician', 'guard-ping', 'always', 'Threat ping lasts longer.', [
        {type: 'threat-ping', target: 'self', bonus: 1},
      ]),
    },
  },
  codex: {
    tradeoff: {id: 'green-build', name: 'Green Build', description: 'Reload 15% faster.'},
    passive: {
      trigger: 'reload',
      effects: [{type: 'reload', target: 'self', scale: .85}],
    },
    riders: {
      striker: makeRider('striker', 'recompile-speed', 'activate', 'Recompile also grants +1 s of speed.', [
        {type: 'speed', target: 'self', bonus: .6, duration: 1},
      ]),
      vanguard: makeRider('vanguard', 'recompile-overheal', 'activate', 'Overheal up to +15%.', [
        {type: 'overheal', target: 'self', amount: .15},
      ]),
      tactician: makeRider('tactician', 'recompile-ammo', 'activate', 'Refill the equipped magazine.', [
        {type: 'ammo', target: 'self', mode: 'refill'},
      ]),
    },
  },
  cline: {
    tradeoff: {id: 'off-road', name: 'Off-road', description: 'Extra air control and a longer slide.'},
    passive: {
      trigger: 'air',
      effects: [
        {type: 'air-control', target: 'self', scale: 1.25},
        {type: 'slide', target: 'self', bonus: .2},
      ],
    },
    // Worked rider row, §3.3.
    riders: {
      striker: makeRider('striker', 'step-distance', 'activate', 'Longest distance, weapon ready on arrival.', [
        {type: 'distance', target: 'ability', scale: 1.25},
        {type: 'holster', target: 'self', mode: 'ready'},
      ]),
      vanguard: makeRider('vanguard', 'step-unstoppable', 'active', 'Unstoppable during the dash, shorter distance.', [
        {type: 'unstoppable', target: 'self'},
        {type: 'distance', target: 'ability', scale: .8},
      ]),
      tactician: makeRider('tactician', 'step-feint', 'activate', 'The dash leaves a brief radar feint at the origin.', [
        {type: 'feint', target: 'enemies', duration: 1.5, mode: 'radar'},
      ]),
    },
  },
  roo: {
    tradeoff: {id: 'flood-fill', name: 'Flood Fill', description: 'Ability radius +25%, damage −5%.'},
    passive: {
      trigger: 'always',
      effects: [
        {type: 'radius', target: 'ability', scale: 1.25},
        {type: 'damage', target: 'self', scale: .95},
      ],
    },
    riders: {
      striker: makeRider('striker', 'jam-placement', 'activate', 'Drop the jam behind you.', [
        {type: 'placement', target: 'ability', mode: 'behind'},
      ]),
      vanguard: makeRider('vanguard', 'jam-slow', 'impact', 'Stronger slow.', [
        {type: 'slow', target: 'enemies', scale: 1.2},
      ]),
      tactician: makeRider('tactician', 'jam-radius', 'activate', 'Wider jam radius.', [
        {type: 'radius', target: 'ability', bonus: 1.5},
      ]),
    },
  },
};

export const SPECS = deepFreeze(HARNESSES.map(harness => {
  const active = abilityOf(harness.id);
  const raw = rawSpecs[harness.id];
  return {
    id: harness.id,
    name: harness.name,
    kind: active.kind,
    buff: active.buff,
    active,
    tradeoff: raw.tradeoff,
    // Same id/name/description as `tradeoff` (one source), plus the shared
    // trigger and labelled effects the Phase-3 engine will dispatch on.
    passive: {
      id: raw.tradeoff.id,
      name: raw.tradeoff.name,
      description: raw.tradeoff.description,
      trigger: raw.passive.trigger,
      effects: raw.passive.effects,
    },
    riders: raw.riders,
    movementHook: MOVEMENT_HOOK_BY_SPEC[harness.id],
    vehicle: harnessVehicle(harness.id),
    bot: harnessBotHints(harness.id),
  };
}));

const SPEC_BY_ID = Object.fromEntries(SPECS.map(spec => [spec.id, spec]));

// ---------------------------------------------------------------------------
// Gear resolution
// ---------------------------------------------------------------------------
// `resolveKit` accepts the same gear shapes `resolveGear` accepts (a
// `{slot: id}` map or an id array) or an already-resolved `{items, modifiers}`
// record, as core.mjs keeps `actor.gear` in the resolved shape. The result is
// a frozen *snapshot*: `clonePlain` copies the resolveGear output first so
// freezing it can never freeze the shared GEAR table or a caller's object.
const isResolvedGear = value => value !== null && typeof value === 'object'
  && Array.isArray(value.items)
  && value.modifiers !== null && typeof value.modifiers === 'object';

const clonePlain = value => {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = clonePlain(entry);
    return copy;
  }
  return value;
};

function resolveKitGear(gear) {
  if (gear === null || gear === undefined) return null;
  const resolved = isResolvedGear(gear) ? gear : resolveGear(gear);
  return deepFreeze(clonePlain(resolved));
}

// Fingerprint segment for resolved gear: item ids sorted so `{primary, utility}`
// and `{utility, primary}` hash the same. Supplied gear that resolves to no
// known item still gets a stable `gear-none` segment.
function gearFingerprintKey(gear) {
  if (gear === null) return null;
  const ids = gear.items.map(item => item.id).filter(Boolean).sort();
  return ids.length > 0 ? `gear-${ids.join('+')}` : 'gear-none';
}

// The one resolver. Normalises through `resolveLoadout` first, so the Claude
// Code lock and the unknown-character/unknown-harness fallbacks behave exactly
// like every other loadout path. Stats always come from CHARACTERS. `gear` is
// resolved through `resolveGear` (or accepted already-resolved) and frozen;
// `fingerprint` is the deterministic identity of the resolved class/spec pair,
// extended with the sorted gear item ids when gear is supplied.
export function resolveKit(character, harness, gear) {
  const loadout = resolveLoadout(character, harness);
  const kit = KIT_BY_ID[loadout.character];
  const spec = SPEC_BY_ID[loadout.harness];
  const movement = VERB_BY_ID[kit.movement];
  const stats = CHARACTERS.find(entry => entry.id === loadout.character).stats;
  const resolvedGear = resolveKitGear(gear);
  const gearKey = gearFingerprintKey(resolvedGear);
  return Object.freeze({
    character: loadout.character,
    harness: loadout.harness,
    wing: kit.wing,
    kind: spec.kind,
    active: spec.active,
    tradeoff: spec.tradeoff,
    passive: spec.passive,
    rider: spec.riders[kit.wing],
    movement,
    movementHook: spec.movementHook,
    stats: Object.freeze({...stats}),
    affinity: kit.affinity,
    gear: resolvedGear,
    fingerprint: [
      loadout.character, loadout.harness, kit.verb.id, movement.id, spec.kind,
      ...(gearKey === null ? [] : [gearKey]),
    ].join(':'),
  });
}
