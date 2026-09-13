import {HARNESSES, WEAPONS} from './data.mjs';
import {clamp} from './math.mjs';

// Harness tuning is deliberately small. Core can apply one passive profile,
// one weapon adjustment, and one active ability at a time without compound
// multipliers becoming the new source of balance problems.
const WEAPON_IDS = Object.freeze(WEAPONS.map((_, index) => index));
const freeze = value => Object.freeze(value);

const rawProfiles = {
  openclaw: {
    passive: {speed: 1, damage: 1.02, resistance: 0},
    ability: {radius: 5, damage: 24, knockback: 12, lift: 4, cooldown: 10, vehicle: {autogunner: true, gunnerDamage: 1.12, label: 'Auto-Gunner'}},
    weapons: {preferred: [3, 7], damage: 1.04, interval: 1, spread: .96},
    bot: {personality: 'brawler', range: [3, 8], retreatHealth: .28, power: 'close'},
  },
  hermes: {
    passive: {speed: 1.05, damage: .98, resistance: 0},
    ability: {duration: 3, speed: 1.6, cooldown: 12, vehicle: {speed: 1.15, label: 'Overdrive'}},
    weapons: {preferred: [0, 4], damage: 1, interval: .97, spread: 1.08},
    bot: {personality: 'skirmisher', range: [8, 18], retreatHealth: .35, power: 'escape'},
  },
  opencode: {
    passive: {speed: 1, damage: 1, resistance: 0},
    ability: {duration: 3, fireRate: 1 / .6, cooldown: 14, vehicle: {autogunner: true, traverse: 1.5, label: 'Targeting Uplink'}},
    weapons: {preferred: [0, 4], damage: .98, interval: .9, spread: 1.04},
    bot: {personality: 'suppressor', range: [7, 20], retreatHealth: .3, power: 'visible'},
  },
  claudecode: {
    passive: {speed: .98, damage: 1, resistance: .04},
    ability: {duration: 3, resistance: .5, cooldown: 14, vehicle: {armor: .6, label: 'Reactive Plating'}},
    weapons: {preferred: [1, 5], damage: 1.03, interval: 1.03, spread: .94},
    bot: {personality: 'sentinel', range: [6, 16], retreatHealth: .62, power: 'hurt'},
  },
  codex: {
    passive: {speed: 1, damage: 1.01, resistance: 0},
    ability: {duration: 2, heal: 35, cooldown: 16, vehicle: {repair: 12, label: 'Field Repair'}},
    weapons: {preferred: [2, 6], damage: 1.05, interval: 1.05, spread: .9},
    bot: {personality: 'opportunist', range: [10, 24], retreatHealth: .65, power: 'hurt'},
  },
  cline: {
    passive: {speed: 1.03, damage: .99, resistance: 0},
    ability: {duration: .35, distance: 6, cooldown: 11, vehicle: {boost: 1.6, label: 'Nitro Boost'}},
    weapons: {preferred: [3, 6], damage: 1.02, interval: .98, spread: 1.12},
    bot: {personality: 'flanker', range: [5, 14], retreatHealth: .4, power: 'approach'},
  },
  roo: {
    passive: {speed: .99, damage: 1.03, resistance: .02},
    ability: {duration: 3, radius: 7, slow: .55, cooldown: 15, vehicle: {autogunner: true, gunnerDamage: 1.25, label: 'Gunner Drone'}},
    weapons: {preferred: [1, 5], damage: 1.02, interval: 1.02, spread: .97},
    bot: {personality: 'controller', range: [5, 13], retreatHealth: .48, power: 'cluster'},
  },
};

export const HARNESS_PROFILE_IDS = Object.freeze(HARNESSES.map(harness => harness.id));

function makeProfile(id, profile) {
  const ability = {...profile.ability, id, name: HARNESSES.find(h => h.id === id).power};
  const weaponAffinity = Object.fromEntries(WEAPON_IDS.map(index => [index, profile.weapons.preferred.includes(index) ? 1.08 : 1]));
  return freeze({
    id,
    passive: freeze({...profile.passive}),
    ability: freeze(ability),
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

export function harnessPassive(harnessId) {
  return getHarnessProfile(harnessId)?.passive ?? null;
}

export function harnessAbility(harnessId) {
  return getHarnessProfile(harnessId)?.ability ?? null;
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
    affinity: profile.weapons.affinity[weaponIndex],
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
