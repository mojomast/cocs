// Plasma Driver (type index 4) - sci-fi plasma carbine. Chunky receiver with a
// glowing plasma orb chamber held in a cage at the front, three containment
// coils wrapping the barrel, side coolant canisters, cooling fins on top, an
// angled grip and a side digital readout panel. Bright blue emissive energy.
//
// Follows the shared (g, ctx) builder contract documented in ./index.mjs: every
// mesh attaches directly to `g`, all geometry/materials come from the ctx
// helpers, the barrel points down -Z and the muzzle ends near z = -0.77.
import * as T from 'three';
export function buildPlasmaDriver(g, ctx) {
  const {box, cylinder, ring, geo, palette} = ctx;
  const {dark, light, glow} = palette;

  // ---- Receiver / body -----------------------------------------------------
  box(g, .23, .22, .5, 0, 0, -.14, dark);
  box(g, .21, .1, .52, 0, .15, -.16, light);
  box(g, .19, .1, .4, 0, -.15, -.1, dark);
  box(g, .2, .2, .16, 0, -.01, .16, light);
  box(g, .18, .22, .06, 0, -.01, .26, dark);
  box(g, .1, .04, .44, 0, .22, -.14, light);
  box(g, .05, .02, .4, 0, .245, -.15, glow);

  // ---- Angled grip, trigger guard and magazine -----------------------------
  const grip = box(g, .08, .22, .11, 0, -.24, .04, dark);
  grip.rotation.x = -.3;
  box(g, .09, .03, .12, 0, -.35, .08, light);
  box(g, .09, .025, .14, 0, -.14, -.04, dark);
  box(g, .1, .2, .13, 0, -.26, -.02, light);
  box(g, .08, .03, .11, 0, -.35, -.02, glow);

  // ---- Digital readout panel on the right flank ----------------------------
  box(g, .05, .14, .16, .12, .06, -.12, dark);
  box(g, .02, .1, .12, .148, .06, -.12, glow);
  for (const z of [-.17, -.12, -.07]) box(g, .015, .02, .025, .16, .09, z, glow);

  // ---- Cooling fins along the top ------------------------------------------
  for (const z of [-.02, -.1, -.18, -.26, -.34]) box(g, .26, .05, .025, 0, .235, z, light);

  // ---- Side-mounted coolant canisters --------------------------------------
  for (const x of [-.18, .18]) {
    box(g, .06, .1, .1, x, -.02, -.06, dark);
    const canister = cylinder(g, .05, .05, .34, x, -.02, -.06, light, 12);
    canister.rotation.x = Math.PI / 2;
    const cap = cylinder(g, .052, .052, .03, x, -.02, -.24, glow, 8);
    cap.rotation.x = Math.PI / 2;
  }

  // ---- Barrel and containment coils wrapping it ----------------------------
  const barrel = cylinder(g, .045, .045, .4, 0, .02, -.58, light, 18);
  barrel.rotation.x = Math.PI / 2;
  for (const z of [-.42, -.5, -.58]) {
    const coil = new T.Mesh(geo(`plasma-driver|coil|.12|.022|${z}`, () => new T.TorusGeometry(.12, .022, 8, 28)), glow);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(0, .02, z);
    g.add(coil);
  }
  ring(g, .05, .012, 0, .02, -.76, glow, 0);
  const muzzle = cylinder(g, .05, .04, .03, 0, .02, -.775, light, 18);
  muzzle.rotation.x = Math.PI / 2;

  // ---- Plasma orb chamber in a caged front ring ----------------------------
  const orb = new T.Mesh(geo('plasma-driver|orb|.095|2', () => new T.IcosahedronGeometry(.095, 2)), glow);
  orb.position.set(0, .02, -.66);
  g.add(orb);
  const orbCore = new T.Mesh(geo('plasma-driver|orb-core|.05|1', () => new T.IcosahedronGeometry(.05, 1)), light);
  orbCore.position.set(0, .02, -.66);
  g.add(orbCore);
  for (const z of [-.58, -.66, -.74]) ring(g, .14, .016, 0, .02, z, light, 0);
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    box(g, .02, .02, .24, Math.cos(a) * .1, .02 + Math.sin(a) * .1, -.66, light);
  }
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    box(g, .03, .03, .03, Math.cos(a) * .13, .02 + Math.sin(a) * .13, -.66, glow);
  }
}
