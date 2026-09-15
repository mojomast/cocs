import { WEAPONS, RULES } from './data.mjs';

export { WEAPONS, RULES };

export const WEAPON_ROLES = Object.freeze({
  0: { role: 'STARTER_ALL_ROUNDER', tag: 'AUTO', optimalRange: [10, 45], burstTtk: 0.85, archetype: 'Versatile kinetic rifle' },
  1: { role: 'HEAVY_EXPLOSIVE', tag: 'SEMI', optimalRange: [15, 50], burstTtk: 0.85, archetype: 'Area denial & rocket splash' },
  2: { role: 'PRECISION_PIERCING', tag: 'SEMI', optimalRange: [25, 90], burstTtk: 1.2, archetype: 'High-damage piercing sniper' },
  3: { role: 'POINT_BLANK_SPREAD', tag: 'SEMI', optimalRange: [2, 14], burstTtk: 0.78, archetype: 'Close-quarters twin-barrel' },
  4: { role: 'SUPPRESSIVE_ENERGY', tag: 'AUTO', optimalRange: [12, 50], burstTtk: 0.78, archetype: 'Rapid plasma projectile stream' },
  5: { role: 'INDIRECT_ARTILLERY', tag: 'SEMI', optimalRange: [10, 45], burstTtk: 0.9, archetype: 'Bouncing indirect explosive' },
  6: { role: 'CONTINUOUS_BEAM', tag: 'SEMI', optimalRange: [12, 45], burstTtk: 1.2, archetype: 'Mid-range crackling disruptor' },
  7: { role: 'ROOM_CLEAR_BURST', tag: 'SEMI', optimalRange: [3, 16], burstTtk: 0.84, archetype: 'High-pellet flak scatter' },
  8: { role: 'MARKSMAN_MID_LONG', tag: 'SEMI', optimalRange: [20, 75], burstTtk: 0.92, archetype: 'Crisp semi-auto precision rifle' },
  9: { role: 'RUN_AND_GUN_SPRAY', tag: 'AUTO', optimalRange: [4, 22], burstTtk: 0.76, archetype: 'Rapid close-range shredder' },
});

export function weaponById(id) {
  const index = Number(id);
  if (!Number.isInteger(index) || index < 0 || index >= WEAPONS.length) return null;
  return WEAPONS[index];
}

export function weaponByName(name) {
  if (!name || typeof name !== 'string') return null;
  const lower = name.toLowerCase().trim();
  return WEAPONS.find(w => w.name.toLowerCase() === lower || w.short.toLowerCase() === lower) || null;
}

export function weaponDPS(weapon) {
  if (!weapon) return 0;
  const interval = Math.max(0.01, Number(weapon.interval) || 0.1);
  const pellets = Number(weapon.pellets) || 1;
  const perShotDamage = (Number(weapon.damage) || 0) * pellets + (Number(weapon.splash) || 0);
  return perShotDamage / interval;
}

export function weaponTTK(weapon, targetHealth = 100) {
  if (!weapon || targetHealth <= 0) return 0;
  const interval = Math.max(0.01, Number(weapon.interval) || 0.1);
  const pellets = Number(weapon.pellets) || 1;
  const perShotDamage = (Number(weapon.damage) || 0) * pellets + (Number(weapon.splash) || 0);
  if (perShotDamage <= 0) return Infinity;
  const shotsNeeded = Math.ceil(targetHealth / perShotDamage);
  return Math.max(0, (shotsNeeded - 1) * interval);
}

export function weaponBalanceSummary() {
  return WEAPONS.map((w, index) => {
    const role = WEAPON_ROLES[index] || {};
    return {
      index,
      name: w.name,
      short: w.short,
      damage: w.damage,
      pellets: w.pellets || 1,
      interval: w.interval,
      range: w.range,
      dps: Math.round(weaponDPS(w)),
      ttk100: Number(weaponTTK(w, 100).toFixed(3)),
      role: role.role || 'UNKNOWN',
      archetype: role.archetype || '',
    };
  });
}
