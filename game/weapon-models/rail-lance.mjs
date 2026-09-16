import * as T from 'three';
import {attachScope} from '../sights.mjs';

// Rail Lance (type 2) - long-range electromagnetic precision lance.
// Silhouette: the longest, narrowest weapon in the set. Twin accelerator rails
// run far forward under a long scope, stacked capacitor coils glow along the
// rails, a bipod-ish forward rest braces the muzzle, and a bulky rear breech
// with coolant tanks feeds a skeletal stock. Muzzle ends near z = -1.04.
export function buildRailLance(g, ctx) {
  const {box, cylinder, ring, geo, material, palette} = ctx;
  const {dark, light, glow} = palette;

  // --- central receiver ---------------------------------------------------
  box(g, .13, .15, .61, 0, .02, -.085, light);
  box(g, .14, .035, .58, 0, .11, -.09, dark);
  box(g, .11, .035, .56, 0, -.07, -.07, dark);
  for (const x of [-.073, .073]) box(g, .018, .09, .5, x, .02, -.05, dark);
  box(g, .012, .018, .2, .07, .091, -.05, glow);

  // heat fins along the receiver spine
  for (const z of [-.04, -.14, -.24, -.34]) box(g, .15, .022, .05, 0, .14, z, dark);

  // --- bulky rear breech --------------------------------------------------
  box(g, .24, .28, .36, 0, .02, .4, light);
  box(g, .2, .06, .3, 0, .19, .4, dark);
  box(g, .26, .32, .07, 0, .02, .615, dark);
  for (const x of [-.135, .135]) box(g, .03, .2, .3, x, .02, .4, light);
  // coolant tanks tucked under the breech flanks
  for (const x of [-.13, .13]) {
    const tank = cylinder(g, .05, .05, .3, x, -.17, .42, glow, 16);
    tank.rotation.x = Math.PI / 2;
  }
  // dorsal coolant tank
  const topTank = cylinder(g, .045, .045, .34, 0, .265, .42, dark, 16);
  topTank.rotation.x = Math.PI / 2;
  // breech face bolts
  for (const b of [[-.09, .12], [.09, .12], [-.09, -.08], [.09, -.08], [0, .14], [0, -.09]]) {
    const bolt = cylinder(g, .012, .012, .03, b[0], b[1], .207, light, 6);
    bolt.rotation.x = Math.PI / 2;
  }

  // --- skeletal stock -----------------------------------------------------
  for (const x of [-.09, .09]) box(g, .04, .055, .34, x, -.01, .9, light);
  box(g, .17, .04, .3, 0, .16, .86, dark);
  for (const x of [-.09, .09]) box(g, .03, .13, .04, x, .083, .86, dark);
  box(g, .14, .05, .05, 0, -.01, 1.0, light);
  box(g, .2, .24, .06, 0, 0, 1.1, dark);
  box(g, .05, .05, .3, 0, -.11, .9, dark);
  box(g, .06, .18, .08, 0, -.21, .5, dark);

  // --- twin accelerator rails --------------------------------------------
  for (const x of [-.075, .075]) {
    const rail = cylinder(g, .03, .028, .96, x, .05, -.48, light, 20);
    rail.rotation.x = Math.PI / 2;
    const tip = cylinder(g, .034, .02, .08, x, .05, -1.0, glow, 16);
    tip.rotation.x = Math.PI / 2;
  }
  for (const z of [-.45, -.62, -.78, -.92]) box(g, .09, .04, .04, 0, .05, z, dark);

  // --- stacked capacitor coils along the rails ---------------------------
  const coilGeo = (r, t) => geo(`rail-coil|${r}|${t}|5|12`, () => new T.TorusGeometry(r, t, 5, 12));
  // Grouped so the energy-cell reload can spin the capacitor stack.
  const coils = new T.Group();
  coils.name = 'rail-coils';
  g.add(coils);
  for (const x of [-.075, .075]) {
    for (let i = 0; i < 5; i++) {
      const coil = new T.Mesh(coilGeo(.062, .016), i % 2 ? glow : light);
      coil.position.set(x, .05, -.5 - i * .08);
      coils.add(coil);
    }
  }
  g.userData.parts = {...(g.userData.parts || {}), cell: coils};

  // --- long open scope on its mounting brackets ---------------------------
  box(g, .04, .06, .05, 0, .355, -.3, light);
  for (const z of [-.09, -.28]) box(g, .04, .088, .05, 0, .171, z, dark);
  const sights = attachScope(g, ctx, {x: 0, y: .44, z: .12, length: .5, radius: .05});

  // --- forward rest / bipod-ish brace ------------------------------------
  box(g, .06, .12, .08, 0, -.03, -.78, dark);
  box(g, .12, .04, .1, 0, -.105, -.78, light);
  box(g, .16, .02, .06, 0, -.135, -.78, light);
  for (const s of [-1, 1]) {
    const leg = cylinder(g, .015, .012, .16, s * .07, -.18, -.78, light, 8);
    leg.rotation.z = s * .35;
    box(g, .035, .02, .06, s * .097, -.255, -.78, dark);
  }

  // --- cable conduits back to the breech ---------------------------------
  for (const x of [-.12, .12]) {
    const cable = cylinder(g, .012, .012, .75, x, .12, -.15, dark, 8);
    cable.rotation.x = Math.PI / 2;
    box(g, .035, .035, .05, x, .12, .2, light);
  }
  box(g, .05, .05, .44, 0, -.08, -.58, dark);

  g.userData.sights = sights;
}
