// Plasma Driver (type index 4) - sci-fi plasma carbine. Chunky receiver with a
// glowing plasma orb chamber held in a cage at the front, three containment
// coils wrapping the barrel, side coolant canisters, cooling fins on top, an
// angled grip and a side digital readout panel. Bright blue emissive energy.
//
// Follows the shared (g, ctx) builder contract documented in ./index.mjs: every
// mesh attaches directly to `g`, all geometry/materials come from the ctx
// helpers, the barrel points down -Z and the muzzle ends near z = -0.77.
// Parts are laid out to meet cleanly (touch or just clear) with no volume
// interpenetration apart from the plasma core hidden inside the orb.
import * as T from 'three';
import {attachIronSights} from '../sights.mjs';
export function buildPlasmaDriver(g, ctx) {
  const {box, cylinder, ring, geo, palette} = ctx;
  const {dark, light, glow} = palette;

  // ---- Receiver / body -----------------------------------------------------
  box(g, .23, .22, .5, 0, 0, -.14, dark);
  box(g, .21, .1, .52, 0, .16, -.16, light);
  box(g, .19, .1, .46, 0, -.16, -.07, dark);
  box(g, .2, .2, .16, 0, -.01, .19, light);
  box(g, .18, .22, .06, 0, -.01, .30, dark);

  // ---- Glow spine and cooling fins along the top ---------------------------
  box(g, .04, .03, .46, 0, .265, -.14, glow);
  for (const z of [-.02, -.1, -.18, -.26, -.34]) box(g, .24, .05, .03, 0, .235, z, light);

  // ---- Open iron sights along the top -------------------------------------
  const sights = attachIronSights(g, ctx, {
    rear: {x: 0, y: .30, z: -.02, width: .07, height: .05, gap: .025},
    front: {x: 0, y: .30, z: -.40, width: .014, height: .09, depth: .014},
  });

  // ---- Angled grip, trigger and magazine -----------------------------------
  const grip = box(g, .08, .2, .1, 0, -.3203, .10, dark);
  grip.rotation.x = -.3;
  box(g, .025, .07, .02, 0, -.245, -.005, dark);
  box(g, .1, .2, .13, 0, -.31, -.10, light);
  box(g, .12, .03, .15, 0, -.425, -.10, glow);

  // ---- Digital readout panel on the right flank ----------------------------
  box(g, .04, .16, .2, .135, .06, -.12, dark);
  box(g, .012, .1, .14, .161, .07, -.12, glow);
  for (const z of [-.08, -.12, -.16]) box(g, .012, .02, .025, .161, -.005, z, glow);

  // ---- Side-mounted coolant canisters --------------------------------------
  for (const x of [-.165, .165]) {
    const canister = cylinder(g, .05, .05, .28, x, -.06, -.13, light, 12);
    canister.rotation.x = Math.PI / 2;
    const frontCap = cylinder(g, .052, .052, .03, x, -.06, .025, glow, 8);
    frontCap.rotation.x = Math.PI / 2;
    const rearCap = cylinder(g, .052, .052, .03, x, -.06, -.285, glow, 8);
    rearCap.rotation.x = Math.PI / 2;
  }

  // ---- Barrel and containment coils wrapping it ----------------------------
  const barrel = cylinder(g, .045, .045, .25, 0, .02, -.495, light, 18);
  barrel.rotation.x = Math.PI / 2;
  for (const z of [-.42, -.47, -.52]) {
    const coil = new T.Mesh(geo(`plasma-driver|coil|.063|.018|${z}`, () => new T.TorusGeometry(.063, .018, 8, 28)), glow);
    coil.position.set(0, .02, z);
    g.add(coil);
  }

  // ---- Plasma orb chamber in a caged front ring ----------------------------
  const orb = new T.Mesh(geo('plasma-driver|orb|.08|2', () => new T.IcosahedronGeometry(.08, 2)), glow);
  orb.position.set(0, .02, -.65);
  g.add(orb);
  const orbCore = new T.Mesh(geo('plasma-driver|orb-core|.045|1', () => new T.IcosahedronGeometry(.045, 1)), light);
  orbCore.position.set(0, .02, -.65);
  g.add(orbCore);
  for (const z of [-.59, -.65, -.71]) ring(g, .13, .014, 0, .02, z, light, 0);
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    box(g, .02, .02, .17, Math.cos(a) * .105, .02 + Math.sin(a) * .105, -.65, light);
  }

  // ---- Tapered muzzle and muzzle ring --------------------------------------
  const muzzle = cylinder(g, .03, .04, .07, 0, .02, -.755, light, 18);
  muzzle.rotation.x = Math.PI / 2;
  ring(g, .05, .012, 0, .02, -.775, glow, 0);

  g.userData.sights = sights;
}
