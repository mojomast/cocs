// New detailed weapon models, one builder per weapon type. The order of
// WEAPON_BUILDERS matches game/data.mjs WEAPONS and the type index used across
// the game (first-person view, actor gun anchors, and pickups).
//
// Builder contract (see any sibling module for the pattern):
//   export function build<Name>(g, ctx)
//     g   - THREE.Group to populate. Nested sight/mechanism groups are supported.
//     ctx - {
//             T,                 three namespace for custom geometry constructors
//             info,              WEAPONS[type]
//             material,          material(color,metal,rough,emissive) - cached
//             box,               box(parent,w,h,d,x,y,z,mat) - cached
//             cylinder,          cylinder(parent,r1,r2,h,x,y,z,mat,segments) - cached
//             ring,              ring(parent,r,t,x,y,z,mat,rx) - cached torus
//             geo,               geo(key, make) - cached custom geometry
//             palette,           {dark,light,glow} resolved finish materials
//           }
// Rules that keep the renderer, disposal and resource-sharing tests exact:
//   - Never call `new T.MeshStandardMaterial`/`new T.BoxGeometry` directly.
//     Build materials with ctx.material and geometry with ctx.box/cylinder/ring
//     or ctx.geo(key, () => new T.*Geometry(...)).
//   - Do not add muzzle anchors, a flash group, or set userData.{flash,muzzles,
//     muzzle,feel,type}; the shared tail in game/view.mjs owns those.
//   - Do not animate; models are static and the reduced-motion path is external.
//   - Keep the barrel down -Z and end the muzzle near the per-type muzzle point.
import {buildPulseRifle} from './pulse-rifle.mjs';
import {buildRocketLauncher} from './rocket-launcher.mjs';
import {buildRailLance} from './rail-lance.mjs';
import {buildScattergun} from './scattergun.mjs';
import {buildPlasmaDriver} from './plasma-driver.mjs';
import {buildGrenadeLauncher} from './grenade-launcher.mjs';
import {buildShockBeam} from './shock-beam.mjs';
import {buildFlakCannon} from './flak-cannon.mjs';
import {buildMarksmanRifle} from './marksman-rifle.mjs';
import {buildSubmachineGun} from './submachine-gun.mjs';

export const WEAPON_BUILDERS=[
  buildPulseRifle,
  buildRocketLauncher,
  buildRailLance,
  buildScattergun,
  buildPlasmaDriver,
  buildGrenadeLauncher,
  buildShockBeam,
  buildFlakCannon,
  buildMarksmanRifle,
  buildSubmachineGun,
];

export const WEAPON_MODEL_NAMES=['Pulse Rifle','Rocket Launcher','Rail Lance','Scattergun','Plasma Driver','Grenade Launcher','Shock Beam','Flak Cannon','Marksman Rifle','Submachine Gun'];

export function buildWeaponBody(type, g, ctx){
  const builder=WEAPON_BUILDERS[type]??WEAPON_BUILDERS[0];
  builder(g, ctx);
}
