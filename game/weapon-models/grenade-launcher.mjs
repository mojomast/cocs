import * as T from 'three';

export function buildGrenadeLauncher(g, ctx) {
  const { box, cylinder, ring, geo, palette } = ctx;
  const { dark, light, glow } = palette;

  box(g, .30, .24, .52, 0, .04, -.05, dark);
  box(g, .24, .10, .34, 0, -.13, -.02, dark);
  box(g, .22, .20, .10, 0, .06, .26, dark);
  box(g, .26, .24, .05, 0, .04, .335, light);
  box(g, .09, .20, .11, 0, -.28, .10, dark);
  box(g, .10, .04, .12, 0, -.40, .10, light);

  box(g, .26, .10, .50, 0, .21, -.06, light);
  box(g, .24, .045, .46, 0, .2825, -.04, dark);
  for (const z of [-.26, -.19, -.12, -.05, .02]) box(g, .11, .03, .05, 0, .32, z, light);
  for (const x of [-.10, .10]) box(g, .045, .13, .045, x, .37, -.06, light);
  box(g, .20, .05, .30, 0, .46, -.06, light);
  const handle = cylinder(g, .028, .028, .30, 0, .513, -.06, dark, 8);
  handle.rotation.x = Math.PI / 2;

  const shroud = cylinder(g, .115, .13, .32, 0, .045, -.47, dark, 16);
  shroud.rotation.x = Math.PI / 2;
  const barrel = cylinder(g, .085, .09, .12, 0, .045, -.69, light, 16);
  barrel.rotation.x = Math.PI / 2;
  const collar = cylinder(g, .14, .16, .06, 0, .045, -.78, dark, 20);
  collar.rotation.x = Math.PI / 2;
  const brake = cylinder(g, .16, .16, .14, 0, .045, -.88, light, 20);
  brake.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    box(g, .05, .05, .08, Math.cos(a) * .185, .045 + Math.sin(a) * .185, -.86, dark);
  }
  ring(g, .185, .025, 0, .045, -.94, glow, 0);
  box(g, .10, .03, .20, 0, .185, -.47, light);

  const drum = cylinder(g, .28, .28, .34, .32, -.06, -.16, light, 32);
  drum.rotation.z = Math.PI / 2;
  drum.name = 'grenade-drum';
  const drumRing = new T.Mesh(geo('gl-drumring|.25|.018', () => new T.TorusGeometry(.25, .018, 6, 32)), glow);
  drumRing.rotation.y = Math.PI / 2;
  drumRing.position.set(.508, -.06, -.16);
  g.add(drumRing);
  const hub = cylinder(g, .06, .06, .07, .525, -.06, -.16, glow, 12);
  hub.rotation.z = Math.PI / 2;
  const hubCap = cylinder(g, .09, .09, .04, .58, -.06, -.16, light, 12);
  hubCap.rotation.z = Math.PI / 2;
  box(g, .05, .06, .05, .32, .25, -.16, dark);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const y = -.06 + Math.cos(a) * .17;
    const z = -.16 + Math.sin(a) * .17;
    const chamber = cylinder(g, .052, .052, .34, .32, y, z, dark, 12);
    chamber.rotation.z = Math.PI / 2;
    const round = cylinder(g, .036, .036, .10, .54, y, z, glow, 10);
    round.rotation.z = Math.PI / 2;
    box(g, .03, .05, .05, .605, y, z, light);
  }

  box(g, .07, .14, .08, 0, -.15, -.36, dark);
  box(g, .14, .05, .20, 0, -.245, -.40, light);
  for (const x of [-.06, .06]) {
    const leg = cylinder(g, .018, .018, .20, x, -.37, -.42, dark, 8);
    leg.rotation.z = x < 0 ? .15 : -.15;
    box(g, .05, .03, .06, x, -.485, -.42, dark);
  }

  box(g, .03, .05, .30, -.165, .06, -.20, dark);
  box(g, .03, .05, .10, -.165, .13, -.10, dark);
  box(g, .03, .06, .14, -.135, -.12, -.02, light);
  box(g, .03, .06, .04, 0, .335, -.30, light);
  box(g, .05, .06, .04, 0, .335, .06, light);
}
