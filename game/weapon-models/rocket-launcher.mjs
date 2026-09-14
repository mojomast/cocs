import * as T from 'three';

// Rocket Launcher (type 1) - the shouldered anti-armour tube and the bulk of
// the set. A fat launch tube with an open front and a loaded warhead poking
// out, a perforated heat shroud, side blast shields, a raised flip-up sight,
// pistol grip with trigger guard, shoulder rest and a flared rear venturi with
// mounting brackets and rivets. The tube runs down -Z and ends near z = -0.76.
export function buildRocketLauncher(g, ctx){
  const {box, cylinder, ring, geo, material, palette} = ctx;
  const {dark, light, glow} = palette;

  const steel = material('#93a4ad', .85, .3);
  const hazard = material('#ffcf3f', .3, .55);
  const rubber = material('#101418', .15, .85);
  const warhead = material('#ff7a3d', .4, .4, true);

  // --- fat launch tube -----------------------------------------------------
  const tube = cylinder(g, .2, .215, .94, 0, .06, -.27, dark, 24);
  tube.rotation.x = Math.PI / 2;
  const shroud = cylinder(g, .238, .232, .6, 0, .06, -.18, light, 24);
  shroud.rotation.x = Math.PI / 2;
  ring(g, .24, .035, 0, .06, -.48, steel, 0);
  ring(g, .236, .035, 0, .06, .12, dark, 0);
  ring(g, .23, .042, 0, .06, -.74, steel, 0);
  const bore = cylinder(g, .172, .172, .06, 0, .06, -.77, dark, 20);
  bore.rotation.x = Math.PI / 2;

  // perforated heat shield punched along the shroud spine
  for (const [x, z] of [[-.05, -.42], [.05, -.34], [.05, -.26], [-.05, -.18], [.05, -.1], [-.05, -.02]])
    box(g, .05, .05, .06, x, .285, z, dark);

  // --- loaded warhead ------------------------------------------------------
  const body = cylinder(g, .145, .152, .44, 0, .06, -.46, warhead, 18);
  body.rotation.x = Math.PI / 2;
  for (const z of [-.52, -.58, -.64]) {
    const band = new T.Mesh(geo('rocket-band|.158|.02|6|16', () => new T.TorusGeometry(.158, .02, 6, 16)), hazard);
    band.position.set(0, .06, z);
    g.add(band);
  }
  const nose = new T.Mesh(geo('rocket-nose|.14|.29|16', () => new T.ConeGeometry(.14, .29, 16)), warhead);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, .06, -.66);
  g.add(nose);
  const noseTip = new T.Mesh(geo('rocket-nose-tip|.045|.11|10', () => new T.ConeGeometry(.045, .11, 10)), glow);
  noseTip.rotation.x = -Math.PI / 2;
  noseTip.position.set(0, .06, -.775);
  g.add(noseTip);

  // --- rear venturi and back plate ----------------------------------------
  const venturi = cylinder(g, .26, .18, .18, 0, .06, .24, dark, 20);
  venturi.rotation.x = Math.PI / 2;
  ring(g, .26, .048, 0, .06, .33, steel, 0);
  const venturiCore = cylinder(g, .11, .11, .12, 0, .06, .3, glow, 16);
  venturiCore.rotation.x = Math.PI / 2;
  box(g, .42, .42, .05, 0, .06, .17, light);

  // --- side blast shields with mounting struts ----------------------------
  for (const s of [-1, 1]) {
    box(g, .05, .4, .46, s * .28, .1, -.16, light);
    box(g, .07, .06, .5, s * .3, .31, -.16, steel);
    box(g, .14, .05, .1, s * .35, .06, -.4, dark);
    box(g, .014, .06, .3, s * .306, .12, -.16, hazard);
  }

  // --- raised flip-up sight -----------------------------------------------
  box(g, .1, .06, .16, 0, .32, -.5, dark);
  box(g, .035, .16, .035, 0, .43, -.5, steel);
  ring(g, .055, .012, 0, .5, -.5, glow, 0);
  box(g, .12, .03, .05, 0, .56, -.5, dark);
  box(g, .14, .04, .1, 0, .3, -.52, steel);

  // --- top rail and teeth --------------------------------------------------
  box(g, .07, .05, .56, 0, .31, -.28, dark);
  box(g, .1, .06, .14, 0, .29, 0, dark);
  for (const z of [-.46, -.34, -.22, -.1]) box(g, .085, .025, .035, 0, .335, z, steel);

  // --- pistol grip and trigger guard --------------------------------------
  const grip = box(g, .09, .26, .13, .07, -.27, .05, dark);
  grip.rotation.x = -.22;
  box(g, .095, .1, .115, .07, -.3, .03, steel);
  box(g, .11, .025, .17, .02, -.16, -.02, steel);
  box(g, .025, .1, .025, .075, -.13, -.06, steel);
  box(g, .028, .08, .03, .03, -.17, -.01, dark);

  // --- shoulder rest -------------------------------------------------------
  box(g, .18, .13, .32, 0, -.13, .19, light);
  box(g, .23, .06, .36, 0, -.2, .21, rubber);
  box(g, .06, .18, .08, 0, -.06, .05, steel);

  // --- under-barrel mounting bracket and rivets ---------------------------
  box(g, .1, .18, .26, 0, -.12, -.34, dark);
  for (const z of [-.42, -.3, -.18, -.06]) for (const s of [-1, 1]) {
    const rivet = cylinder(g, .02, .02, .03, s * .243, .06, z, steel, 8);
    rivet.rotation.z = Math.PI / 2;
  }
}
