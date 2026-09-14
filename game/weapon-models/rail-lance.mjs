import * as T from 'three';

// Rail Lance (type 2) - long-range electromagnetic precision lance.
// Silhouette: the longest, narrowest weapon in the set. Twin accelerator rails
// run far forward under a long scope, stacked capacitor coils glow along the
// rails, a bipod-ish forward rest braces the muzzle, and a bulky rear breech
// with coolant tanks feeds a skeletal stock. Barrel ends near z = -1.04.
export function buildRailLance(g, ctx) {
  const {box, cylinder, ring, geo, material, palette} = ctx;
  const {dark, light, glow} = palette;

  // --- central receiver ---------------------------------------------------
  box(g, .13, .15, .82, 0, .02, .02, light);
  box(g, .14, .035, .72, 0, .11, -.02, dark);
  box(g, .11, .035, .66, 0, -.07, -.02, dark);
  for (const x of [-.073, .073]) box(g, .018, .09, .5, x, .02, -.05, dark);
  box(g, .02, .05, .14, .07, .04, .12, glow);

  // heat fins along the receiver spine
  for (const z of [-.04, -.14, -.24, -.34]) box(g, .15, .022, .05, 0, .14, z, dark);

  // --- bulky rear breech --------------------------------------------------
  box(g, .24, .28, .36, 0, .02, .4, light);
  box(g, .2, .06, .3, 0, .19, .4, dark);
  box(g, .26, .32, .07, 0, .02, .6, dark);
  for (const x of [-.1, .1]) box(g, .05, .22, .14, x, -.05, .52, light);
  // coolant tanks
  for (const x of [-.1, .1]) {
    const tank = cylinder(g, .05, .05, .46, x, -.12, .56, glow, 16);
    tank.rotation.x = Math.PI / 2;
  }
  const topTank = cylinder(g, .045, .045, .34, 0, .225, .42, dark, 16);
  topTank.rotation.x = Math.PI / 2;
  // breech face bolts (deterministic layout)
  for (const b of [[-.09, .12], [.09, .12], [-.09, -.08], [.09, -.08], [0, .16], [0, -.14]]) {
    const bolt = cylinder(g, .012, .012, .03, b[0], b[1], .23, light, 6);
    bolt.rotation.x = Math.PI / 2;
  }

  // --- skeletal stock -----------------------------------------------------
  for (const x of [-.09, .09]) box(g, .04, .055, .34, x, -.01, .9, light);
  box(g, .17, .04, .3, 0, .16, .86, dark);
  box(g, .2, .05, .05, 0, -.01, 1.0, light);
  box(g, .2, .24, .06, 0, 0, 1.12, dark);
  box(g, .05, .05, .36, 0, -.11, .92, dark);
  box(g, .06, .18, .08, 0, -.14, .5, dark);

  // --- twin accelerator rails --------------------------------------------
  for (const x of [-.075, .075]) {
    const rail = cylinder(g, .03, .028, 1.06, x, .05, -.53, light, 20);
    rail.rotation.x = Math.PI / 2;
    box(g, .09, .09, .2, x, .05, -.72, dark);
    const tip = cylinder(g, .034, .02, .08, x, .05, -1.0, glow, 16);
    tip.rotation.x = Math.PI / 2;
  }
  box(g, .19, .05, .06, 0, .05, -.92, dark);
  for (const z of [-.35, -.6]) box(g, .19, .04, .04, 0, .05, z, dark);

  // --- stacked capacitor coils along the rails ---------------------------
  const coilGeo = (r, t) => geo(`rail-coil|${r}|${t}|5|12`, () => new T.TorusGeometry(r, t, 5, 12));
  for (const x of [-.075, .075]) {
    for (let i = 0; i < 6; i++) {
      const coil = new T.Mesh(coilGeo(.062, .016), i % 2 ? glow : light);
      coil.position.set(x, .05, -.15 - i * .13);
      g.add(coil);
    }
  }

  // --- long scope ---------------------------------------------------------
  const scopeTube = cylinder(g, .055, .055, .5, 0, .27, -.28, dark, 16);
  scopeTube.rotation.x = Math.PI / 2;
  const scopeBell = cylinder(g, .075, .055, .11, 0, .27, -.555, dark, 16);
  scopeBell.rotation.x = Math.PI / 2;
  const eye = cylinder(g, .06, .06, .1, 0, .27, 0, dark, 12);
  eye.rotation.x = Math.PI / 2;
  box(g, .04, .06, .05, 0, .34, -.3, light);
  for (const z of [-.15, -.42]) box(g, .04, .07, .05, 0, .2, z, dark);
  ring(g, .062, .012, 0, .27, -.605, glow, 0);
  ring(g, .062, .012, 0, .27, -.02, glow, 0);
  const lens = new T.Mesh(geo('rail-lens|.055|16', () => new T.CircleGeometry(.055, 16)), glow);
  lens.position.set(0, .27, -.612);
  lens.rotation.y = Math.PI;
  g.add(lens);

  // --- forward rest / bipod-ish brace ------------------------------------
  box(g, .08, .06, .1, 0, -.08, -.78, dark);
  box(g, .16, .03, .04, 0, -.1, -.78, light);
  for (const s of [-1, 1]) {
    const leg = cylinder(g, .015, .012, .18, s * .055, -.18, -.78, light, 8);
    leg.rotation.z = s * .3;
    box(g, .035, .02, .06, s * .09, -.27, -.78, dark);
  }

  // --- cable conduits back to the breech ---------------------------------
  for (const x of [-.1, .1]) {
    const cable = cylinder(g, .012, .012, .75, x, .12, -.15, dark, 8);
    cable.rotation.x = Math.PI / 2;
    box(g, .035, .035, .05, x, .12, .2, light);
  }
  box(g, .06, .04, .2, 0, -.11, -.5, dark);
}
