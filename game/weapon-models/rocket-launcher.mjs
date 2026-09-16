import * as T from 'three';

// Rocket Launcher (type 1) - the shouldered anti-armour tube and the bulk of
// the set. A fat launch tube with an open front and a loaded warhead poking
// out, a ribbed heat shroud, side blast shields, a raised flip-up sight,
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
  ring(g, .235, .04, 0, .06, -.74, steel, 0);

  // ribbed heat shroud: rings resting on the taper of the tube
  for (const [r, z] of [[.236, -.42], [.233, -.26], [.231, -.1]])
    ring(g, r, .026, 0, .06, z, light, 0);

  // --- loaded warhead poking out the front ---------------------------------
  // Grouped so the reload can pull the round back into the tube.
  const warheadGroup = new T.Group();
  warheadGroup.name = 'rocket-warhead';
  g.add(warheadGroup);
  const body = cylinder(warheadGroup, .155, .15, .44, 0, .06, -.86, warhead, 18);
  body.rotation.x = Math.PI / 2;
  for (const z of [-.9, -.96, -1.02])
    ring(warheadGroup, .16, .016, 0, .06, z, hazard, 0);
  const nose = new T.Mesh(geo('rocket-nose|.15|.24|16', () => new T.ConeGeometry(.15, .24, 16)), warhead);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, .06, -1.2);
  warheadGroup.add(nose);
  const noseTip = new T.Mesh(geo('rocket-nose-tip|.05|.1|10', () => new T.ConeGeometry(.05, .1, 10)), glow);
  noseTip.rotation.x = -Math.PI / 2;
  noseTip.position.set(0, .06, -1.35);
  warheadGroup.add(noseTip);
  g.userData.parts = {...(g.userData.parts || {}), magazine: warheadGroup};

  // --- rear venturi, exhaust glow and rim ----------------------------------
  const venturi = cylinder(g, .27, .2, .2, 0, .06, .3, dark, 20);
  venturi.rotation.x = Math.PI / 2;
  ring(g, .31, .038, 0, .06, .4, steel, 0);
  const exhaust = cylinder(g, .1, .1, .22, 0, .06, .46, glow, 16);
  exhaust.rotation.x = Math.PI / 2;

  // --- side blast shields with mounting brackets ---------------------------
  for (const s of [-1, 1]) {
    box(g, .045, .34, .42, s * .3, .1, -.14, light);
    for (const z of [-.34, -.02]) box(g, .11, .05, .06, s * .243, .06, z, steel);
    box(g, .05, .1, .18, s * .3, .3, -.14, dark);
  }

  // --- raised flip-up sight ------------------------------------------------
  box(g, .06, .08, .06, 0, .3, -.56, steel);
  box(g, .1, .05, .14, 0, .365, -.56, dark);
  box(g, .03, .14, .03, 0, .45, -.56, steel);
  ring(g, .05, .012, 0, .53, -.56, glow, 0);
  box(g, .12, .03, .05, 0, .6, -.56, dark);

  // --- top rail and teeth --------------------------------------------------
  box(g, .07, .05, .5, 0, .29, -.26, dark);
  for (const z of [-.44, -.32, -.2, -.08]) box(g, .085, .022, .03, 0, .327, z, steel);

  // --- pistol grip and trigger guard --------------------------------------
  const grip = box(g, .09, .24, .12, .06, -.26, .03, dark);
  grip.rotation.x = -.24;
  box(g, .1, .05, .13, .06, -.4, .02, steel);
  box(g, .05, .06, .05, .05, -.16, -.18, dark);
  const guard = ring(g, .06, .012, .05, -.26, -.18, steel, 0);
  guard.rotation.y = Math.PI / 2;
  box(g, .02, .05, .02, .045, -.24, -.19, dark);

  // --- shoulder rest -------------------------------------------------------
  box(g, .18, .13, .18, 0, -.215, .14, light);
  box(g, .23, .05, .2, 0, -.307, .14, rubber);

  // --- under-barrel mounting bracket and rivets ---------------------------
  box(g, .1, .18, .26, 0, -.239, -.34, dark);
  for (const z of [-.44, -.36, -.28, -.2]) for (const s of [-1, 1])
    cylinder(g, .018, .018, .03, s * .03, -.34, z, steel, 8);
}
