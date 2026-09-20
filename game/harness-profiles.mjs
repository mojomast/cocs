import {HARNESSES, WEAPONS} from './data.mjs';
import {clamp} from './math.mjs';

// Harness tuning is deliberately small. Core applies one weapon adjustment and
// one active ability per harness; the tradeoff passive is *behavioural* and
// lives in kits.mjs `SPECS[i].passive` (§3.3, §10 decision 4). There is no
// hidden speed/damage/resistance profile here any more: every effect is a named
// thing dispatching on the shared trigger/type vocabulary (game/spec-effects.mjs).
const WEAPON_IDS = Object.freeze(WEAPONS.map((_, index) => index));
const freeze = value => Object.freeze(value);
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

// `kind` / `buff` are the data-driven dispatch vocabulary (§13.2); `magnitude`
// is filled from the harness table in `makeProfile` so the active's stored
// number has exactly one source. Kinds unused by today's roster are reserved
// vocabulary, not dead data.
const rawProfiles = {
  openclaw: {
    kind: 'burst', buff: null,
    ability: {radius: 6, damage: 30, knockback: 14, lift: 5, cooldown: 10, vehicle: {autogunner: true, gunnerDamage: 1.12}},
    weapons: {preferred: [3, 7], damage: 1.04, interval: 1, spread: .96},
    bot: {personality: 'brawler', range: [3, 8], retreatHealth: .28, power: 'close'},
  },
  hermes: {
    kind: 'buff', buff: 'speed',
    ability: {duration: 3.5, speed: 1.6, cooldown: 10, vehicle: {speed: 1.15}},
    weapons: {preferred: [0, 4], damage: 1, interval: .97, spread: 1.08},
    bot: {personality: 'skirmisher', range: [8, 18], retreatHealth: .35, power: 'escape'},
  },
  opencode: {
    kind: 'buff', buff: 'fireRate',
    ability: {duration: 3.5, fireRate: 1 / .55, cooldown: 14, vehicle: {autogunner: true, traverse: 1.5}},
    weapons: {preferred: [0, 4], damage: .98, interval: .9, spread: 1.04},
    bot: {personality: 'suppressor', range: [7, 20], retreatHealth: .3, power: 'visible'},
  },
  claudecode: {
    kind: 'buff', buff: 'resistance',
    ability: {duration: 3.5, resistance: .5, cooldown: 10, vehicle: {armor: .6}},
    weapons: {preferred: [1, 5], damage: 1.03, interval: 1.03, spread: .94},
    bot: {personality: 'sentinel', range: [6, 16], retreatHealth: .62, power: 'hurt'},
  },
  codex: {
    kind: 'heal', buff: null,
    ability: {duration: 2, heal: 45, cooldown: 16, vehicle: {repair: 12, label: 'Field Repair'}},
    weapons: {preferred: [2, 6], damage: 1.05, interval: 1.05, spread: .9},
    bot: {personality: 'opportunist', range: [10, 24], retreatHealth: .65, power: 'hurt'},
  },
  cline: {
    kind: 'dash', buff: null,
    ability: {duration: .35, distance: 7, cooldown: 11, vehicle: {boost: 1.6}},
    weapons: {preferred: [3, 6], damage: 1.02, interval: .98, spread: 1.12},
    bot: {personality: 'flanker', range: [5, 14], retreatHealth: .4, power: 'approach'},
  },
  roo: {
    kind: 'slow', buff: null,
    ability: {duration: 3, radius: 8, slow: .5, cooldown: 12, vehicle: {autogunner: true, gunnerDamage: 1.25}},
    weapons: {preferred: [1, 5], damage: 1.02, interval: 1.02, spread: .97},
    bot: {personality: 'controller', range: [5, 13], retreatHealth: .48, power: 'cluster'},
  },
};

export const HARNESS_PROFILE_IDS = Object.freeze(HARNESSES.map(harness => harness.id));

function makeProfile(id, profile) {
  const harness = HARNESSES.find(h => h.id === id);
  // The dispatch fields ride on the resolved active descriptor so `abilityOf`
  // and `harnessAbility` are the same frozen object. `magnitude` mirrors the
  // harness table exactly, which is what `power()` stores today.
  const ability = deepFreeze({
    ...profile.ability,
    id,
    name: harness.power,
    kind: profile.kind,
    buff: profile.buff ?? null,
    magnitude: harness.magnitude,
  });
  const weaponAffinity = Object.fromEntries(WEAPON_IDS.map(index => [index, profile.weapons.preferred.includes(index) ? 1.08 : 1]));
  return freeze({
    id,
    ability,
    weapons: freeze({...profile.weapons, preferred: freeze([...profile.weapons.preferred]), affinity: freeze(weaponAffinity)}),
    bot: freeze({...profile.bot, range: freeze([...profile.bot.range])}),
  });
}

export const HARNESS_PROFILES = freeze(Object.fromEntries(
  Object.entries(rawProfiles).map(([id, profile]) => [id, makeProfile(id, profile)]),
));

export function getHarnessProfile(harnessId) {
  return HARNESS_PROFILES[harnessId] ?? null;
}

// The tradeoff passive is behavioural and keyed to the spec, so it lives in
// kits.mjs `SPECS[i].passive` — one source for the UI and the engine. This
// module deliberately exports no passive stats accessor any more (§3.3).

export function harnessAbility(harnessId) {
  return getHarnessProfile(harnessId)?.ability ?? null;
}

// Memoized resolved ability descriptor for the kind router and the buff use
// sites: the same frozen object as `harnessAbility(id)`, carrying `id`, `name`,
// `kind`, `buff` and `magnitude`. Accepts a harness id or a profile object for
// convenience; unknown inputs return null. Because the descriptor is memoized
// by harness id, callers may compare descriptors by identity.
const abilityCache = new Map();
export function abilityOf(harnessIdOrProfile) {
  const id = typeof harnessIdOrProfile === 'string' ? harnessIdOrProfile
    : harnessIdOrProfile && typeof harnessIdOrProfile === 'object' ? harnessIdOrProfile.id
      : null;
  const profile = getHarnessProfile(id);
  if (!profile) return null;
  if (!abilityCache.has(profile.id)) abilityCache.set(profile.id, profile.ability);
  return abilityCache.get(profile.id);
}

// Vehicle skills ride on the active ability: auto-gunner, plating, repair, boost or speed.
export function harnessVehicle(harnessId) {
  return getHarnessProfile(harnessId)?.ability?.vehicle ?? null;
}

// Returns one bounded multiplier set. It is intentionally not a reducer over
// powerups or other harnesses: callers should apply this result once.
export function harnessWeaponHandling(harnessId, weaponIndex) {
  const profile = getHarnessProfile(harnessId);
  if (!profile || !Number.isInteger(weaponIndex) || !WEAPON_IDS.includes(weaponIndex)) return null;
  const favored = profile.weapons.affinity[weaponIndex] > 1;
  return freeze({
    damage: clamp(profile.weapons.damage * (favored ? 1.03 : 1), .9, 1.12),
    interval: clamp(profile.weapons.interval, .88, 1.08),
    spread: clamp(profile.weapons.spread, .88, 1.14),
    favored,
  });
}

export function harnessBotHints(harnessId) {
  return getHarnessProfile(harnessId)?.bot ?? null;
}

export function preferredHarnessWeapon(harnessId, available = WEAPON_IDS) {
  const profile = getHarnessProfile(harnessId);
  if (!profile) return null;
  return profile.weapons.preferred.find(index => available.includes(index)) ?? null;
}
