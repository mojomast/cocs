import {CHARACTERS, HARNESSES, WEAPONS, resolveLoadout} from './data.mjs';
import {abilityOf, harnessBotHints, harnessVehicle} from './harness-profiles.mjs';

// ---------------------------------------------------------------------------
// COCS class & harness data model (docs/design/CLASS_OVERHAUL.md §13).
//
// Operator = class: stat block (always read from data.mjs, never copied here),
// one always-on signature verb, one movement verb, a 3-weapon affinity band and
// a small AI policy. Harness = spec: one data-driven active ability, one
// behavioural tradeoff passive and one wing rider.
//
// This module is data plus one resolver. It imports no view/app code, never
// mutates data.mjs, and deep-freezes everything it exports. Phase 1 ships it as
// data only: operator-profiles.mjs reads it through the compatibility shim and
// no engine hot path touches it yet, so behaviour is unchanged.
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

// Spec descriptors keyed to the harness table order. `kind`, `buff` and the
// `active` descriptor itself come from harness-profiles.mjs (one source);
// `vehicle` and `bot` are the existing per-harness skill/hint tables.
const rawSpecs = {
  openclaw: {
    tradeoff: {id: 'grip', name: 'Grip', description: 'Melee arc +25%.'},
    riders: {
      striker: 'Pull-in on the claw pulse.',
      vanguard: 'Bigger knockback on the claw pulse.',
      tactician: 'Wider claw pulse radius.',
    },
  },
  hermes: {
    tradeoff: {id: 'express', name: 'Express', description: 'Can sprint while reloading.'},
    riders: {
      striker: 'Longer courier rush.',
      vanguard: '25% mitigation during the rush.',
      tactician: 'Courier rush cooldown −1 s.',
    },
  },
  opencode: {
    tradeoff: {id: 'multiplex', name: 'Multiplex', description: 'Reload continues while swapped.'},
    riders: {
      striker: 'Faster while the burst is active.',
      // §3.3's table cell read "Guardrail lasts 1 s longer" in OpenCode's row;
      // Guardrail is Claude Code's active, so this is the same rider's intent
      // expressed on OpenCode's own active (Phase-3 tuning text).
      vanguard: 'The burst lasts 1 s longer.',
      tactician: 'Skip the next holster.',
    },
  },
  claudecode: {
    tradeoff: {id: 'linted', name: 'Linted', description: 'Brief threat ping when an enemy holds a bead on you.'},
    riders: {
      striker: 'Cleanse slow on activation.',
      vanguard: '+10% mitigation while active.',
      tactician: 'Threat ping lasts longer.',
    },
  },
  codex: {
    tradeoff: {id: 'green-build', name: 'Green Build', description: 'Reload 15% faster.'},
    riders: {
      striker: 'Recompile also grants +1 s of speed.',
      vanguard: 'Overheal up to +15%.',
      tactician: 'Refill the equipped magazine.',
    },
  },
  cline: {
    tradeoff: {id: 'off-road', name: 'Off-road', description: 'Extra air control and a longer slide.'},
    // Worked rider row, §3.3.
    riders: {
      striker: 'Longest distance, weapon ready on arrival.',
      vanguard: 'Unstoppable during the dash, shorter distance.',
      tactician: 'The dash leaves a brief radar feint at the origin.',
    },
  },
  roo: {
    tradeoff: {id: 'flood-fill', name: 'Flood Fill', description: 'Ability radius +25%, damage −5%.'},
    riders: {
      striker: 'Drop the jam behind you.',
      vanguard: 'Stronger slow.',
      tactician: 'Wider jam radius.',
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
    riders: raw.riders,
    movementHook: MOVEMENT_HOOK_BY_SPEC[harness.id],
    vehicle: harnessVehicle(harness.id),
    bot: harnessBotHints(harness.id),
  };
}));

const SPEC_BY_ID = Object.fromEntries(SPECS.map(spec => [spec.id, spec]));

// The one resolver. Normalises through `resolveLoadout` first, so the Claude
// Code lock and the unknown-character/unknown-harness fallbacks behave exactly
// like every other loadout path. Stats always come from CHARACTERS. `gear` is
// passed through untouched (Phase 1 gear is inert, so it is not frozen and not
// part of the fingerprint); `fingerprint` is the deterministic identity of the
// resolved class/spec pair.
export function resolveKit(character, harness, gear) {
  const loadout = resolveLoadout(character, harness);
  const kit = KIT_BY_ID[loadout.character];
  const spec = SPEC_BY_ID[loadout.harness];
  const movement = VERB_BY_ID[kit.movement];
  const stats = CHARACTERS.find(entry => entry.id === loadout.character).stats;
  return Object.freeze({
    character: loadout.character,
    harness: loadout.harness,
    wing: kit.wing,
    kind: spec.kind,
    active: spec.active,
    tradeoff: spec.tradeoff,
    rider: spec.riders[kit.wing],
    movement,
    movementHook: spec.movementHook,
    stats: Object.freeze({...stats}),
    affinity: kit.affinity,
    gear: gear ?? null,
    fingerprint: `${loadout.character}:${loadout.harness}:${kit.verb.id}:${movement.id}:${spec.kind}`,
  });
}
