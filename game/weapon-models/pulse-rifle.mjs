import * as T from 'three';
import {attachIronSights} from '../sights.mjs';
export function buildPulseRifle(g, ctx){
  const {box, cylinder, ring, geo, material, palette} = ctx;
  const {dark, light, glow} = palette;
  const grip = material('#141a1f', .5, .66);
  const steel = material('#3b4750', .72, .34);
  const teal = material('#2f7c74', .5, .48);
  const energy = material('#70ffe6', .3, .2, true);
  const vent = material('#0b1014', .4, .72);

  // receiver + top spine + handguard
  box(g, .16, .18, .46, 0, .02, -.10, dark);
  box(g, .13, .07, .65, 0, .135, -.225, teal);
  box(g, .12, .16, .26, 0, .02, -.46, dark);

  // stock / butt
  box(g, .15, .16, .22, 0, 0, .24, dark);
  box(g, .16, .20, .03, 0, 0, .36, steel);

  // lower receiver, magwell, magazine
  box(g, .12, .08, .24, 0, -.11, -.09, dark);
  box(g, .10, .10, .12, 0, -.20, -.16, grip);
  box(g, .08, .16, .10, 0, -.33, -.17, steel);
  box(g, .085, .02, .11, 0, -.42, -.165, teal);

  // pistol grip
  const pg = box(g, .055, .15, .08, 0, -.13, .08, grip);
  pg.rotation.x = -.2;

  // trigger guard + trigger
  box(g, .05, .02, .14, 0, -.205, -.03, steel);
  box(g, .014, .04, .02, .028, -.175, -.07, steel);
  box(g, .014, .04, .02, -.028, -.175, -.07, steel);
  box(g, .014, .04, .02, .028, -.175, 0, steel);
  box(g, .014, .04, .02, -.028, -.175, 0, steel);
  const trig = box(g, .014, .05, .02, 0, -.17, -.05, light);
  trig.rotation.x = .25;

  // handguard side plates + bottom rail + foregrip
  box(g, .02, .04, .28, .068, -.01, -.46, steel);
  box(g, .02, .04, .28, -.068, -.01, -.46, steel);
  box(g, .06, .03, .26, 0, -.075, -.46, steel);
  box(g, .045, .13, .05, 0, -.155, -.48, grip);
  box(g, .055, .03, .09, 0, -.235, -.48, teal);

  // handguard vents
  for(let i = 0; i < 3; i++){
    box(g, .018, .05, .03, .068, .045, -.40 - i * .06, vent);
    box(g, .018, .05, .03, -.068, .045, -.40 - i * .06, vent);
  }

  // barrel / muzzle / energy tip (muzzle front stays near z = -0.85)
  const barrel = cylinder(g, .035, .035, .20, 0, .02, -.69, light, 16);
  barrel.rotation.x = Math.PI / 2;
  const muzzle = cylinder(g, .05, .045, .06, 0, .02, -.818, steel, 16);
  muzzle.rotation.x = Math.PI / 2;
  const tip = cylinder(g, .02, .02, .03, 0, .02, -.864, energy, 12);
  tip.rotation.x = Math.PI / 2;

  // energy conduit rod cradled by glowing rings above the spine
  const rod = cylinder(g, .02, .02, .45, 0, .214, -.275, energy, 12);
  rod.rotation.x = Math.PI / 2;
  for(let i = 0; i < 5; i++) ring(g, .032, .012, 0, .214, -.45 + i * .10, energy, 0);

  // open iron sights (rear notch + front post)
  const sights = attachIronSights(g, ctx, {
    rear: {x: 0, y: .215, z: .06, width: .09, height: .05, gap: .03},
    front: {x: 0, y: .21, z: -.53, width: .012, height: .05, depth: .014},
  });

  // side energy cells
  const cellGeo = geo('pulse-cell|.04|1', () => new T.IcosahedronGeometry(.04, 1));
  const cell = new T.Mesh(cellGeo, energy);
  cell.position.set(.105, .05, 0);
  g.add(cell);
  const cell2 = new T.Mesh(cellGeo, energy);
  cell2.position.set(-.105, .05, 0);
  g.add(cell2);

  // receiver side bolts
  for(let i = 0; i < 3; i++){
    const by = .07 - i * .07;
    const b1 = cylinder(g, .011, .011, .02, .088, by, -.24, steel, 8);
    b1.rotation.z = Math.PI / 2;
    const b2 = cylinder(g, .011, .011, .02, -.088, by, -.24, steel, 8);
    b2.rotation.z = Math.PI / 2;
  }

  // stock side panels
  box(g, .01, .06, .12, .078, 0, .24, teal);
  box(g, .01, .06, .12, -.078, 0, .24, teal);

  // front top accent
  box(g, .07, .03, .06, 0, .18, -.53, teal);

  // cheek rest + glow cables
  box(g, .09, .05, .16, 0, .105, .22, steel);
  const cable = cylinder(g, .009, .009, .25, .086, -.02, -.08, glow, 6);
  cable.rotation.x = Math.PI / 2;
  const cable2 = cylinder(g, .009, .009, .25, -.086, -.02, -.08, glow, 6);
  cable2.rotation.x = Math.PI / 2;

  g.userData.sights = sights;
}
