// Active-sight resolver and reticle policy.
//
// One pure place that answers "which sight is the player actually looking
// through right now?" from three inputs: the weapon's built-in sight, the
// equipped optic override, and whether the player is aiming. The renderer uses
// it to derive the ADS field of view; the HUD uses the same result to pick the
// reticle style, so the reticle and the magnification can never disagree.
//
// No three.js import: this module is safe for the React HUD and for SSR.

// Built-in sight shipped by each weapon model (game/weapon-models/*). Keep this
// in sync with the model registry: weapons 2 and 8 mount integrated scopes.
export const BUILTIN_SIGHT = Object.freeze(['iron', 'iron', 'scope', 'iron', 'iron', 'iron', 'iron', 'iron', 'scope', 'iron']);

// Weapons whose built-in scope is a hard-zoom optic, keyed by weapon index.
export const BUILTIN_MAGNIFICATION = Object.freeze({ 2: 3.6, 8: 3.0 });

// Magnification of a rail-mounted optic. A precision scope is a middle ground
// between iron sights and the rail/marksman integrated optics.
export const OPTIC_MAGNIFICATION = Object.freeze({ scope: 2.4, holo: 1, iron: 1 });

export const SIGHT_KINDS = Object.freeze(['iron', 'holo', 'scope']);

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Resolve the active sight. `optic` is the attachment's visual.optic value
// ('none' | 'iron' | 'holo' | 'scope'). A mounted scope never downgrades a
// weapon that already carries a stronger integrated scope: the stronger of the
// two magnifications wins, which keeps the Rail Lance and Marksman Rifle zoomed.
export function resolveActiveSight({ weapon = 0, optic = null, aiming = false } = {}) {
  const index = Number.isInteger(weapon) && weapon >= 0 && weapon < BUILTIN_SIGHT.length ? weapon : 0;
  const builtin = BUILTIN_SIGHT[index] || 'iron';
  const builtinMag = finite(BUILTIN_MAGNIFICATION[index], 1);
  let kind = builtin;
  let source = 'builtin';
  if (optic === 'scope') { kind = 'scope'; source = builtin === 'scope' ? 'builtin+optic' : 'attachment'; }
  else if (optic === 'holo') { kind = builtin === 'scope' ? 'scope' : 'holo'; source = builtin === 'scope' ? 'builtin' : 'attachment'; }
  else if (optic === 'iron') { if (builtin !== 'scope') { kind = 'iron'; source = 'attachment'; } }
  const opticMag = OPTIC_MAGNIFICATION[optic] ?? 1;
  const magnification = Math.max(1, builtinMag, opticMag);
  const scope = kind === 'scope';
  return Object.freeze({
    kind,
    source,
    reticle: scope ? 'cross' : 'dot',
    magnification,
    lensWarp: scope,
    aiming: aiming === true,
    label: scope ? `×${magnification.toFixed(1)}` : '',
  });
}

// ADS field of view for a resolved sight. Iron/holo keep the historical mild
// ADS pull-in; a scope divides the base FOV by its magnification so high-zoom
// optics actually zoom in. Floors keep the projection stable.
export function adsFieldOfView(baseFov, sight, { ironFloor = 55, scopeFloor = 15 } = {}) {
  const base = Math.max(30, finite(baseFov, 82));
  const mag = Math.max(1, finite(sight?.magnification, 1));
  if (mag <= 1.0001) return Math.max(ironFloor, base * 0.82);
  return Math.max(scopeFloor, base / mag);
}

// Smallest FOV the camera may reach for a sight. Scopes are allowed well below
// the iron-sight floor.
export function sightFovFloor(sight, { ironFloor = 55, scopeFloor = 12 } = {}) {
  return sight?.kind === 'scope' ? scopeFloor : ironFloor;
}

// Barrel/pincushion bow, in reticle viewBox units (0-100), that sells the lens
// magnification. Grows with magnification and stays bounded.
export function reticleWarp(sight) {
  if (sight?.kind !== 'scope') return 0;
  const mag = Math.max(1, finite(sight.magnification, 1));
  return Math.max(1.4, Math.min(5, (mag - 1) * 1.6));
}

export const RETICLE_EXPORTS = Object.freeze(['BUILTIN_SIGHT', 'BUILTIN_MAGNIFICATION', 'OPTIC_MAGNIFICATION', 'resolveActiveSight', 'adsFieldOfView', 'sightFovFloor', 'reticleWarp']);
