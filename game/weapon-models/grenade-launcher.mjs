import * as T from 'three';

export function buildGrenadeLauncher(g, ctx) {
  const { box, cylinder, ring, geo, palette } = ctx;
  const { dark, light, glow } = palette;

  box(g, .30, .24, .52, 0, .04, -.05, dark);
  box(g, .26, .10, .50, 0, .19, -.06, light);
  box(g, .24, .20, .10, 0, .06, .22, dark);
  box(g, .28, .24, .05, 0, .04, .28, light);
  box(g, .22, .10, .30, 0, -.10, -.02, dark);
  box(g, .18, .16, .06, 0, 0, .31, dark);

  box(g, .09, .045, .46, 0, .255, -.04, dark);
  for (const z of [-.26, -.19, -.12, -.05, .02]) box(g, .11, .03, .05, 0, .29, z, light);
  for (const x of [-.07, .07]) box(g, .045, .13, .045, x, .37, -.06, light);
  box(g, .20, .05, .30, 0, .445, -.06, light);
  const handle = cylinder(g, .028, .028, .30, 0, .50, -.06, dark, 8);
  handle.rotation.x = Math.PI / 2;

  const shroud = cylinder(g, .115, .13, .30, 0, .045, -.48, dark, 16);
  shroud.rotation.x = Math.PI / 2;
  const barrel = cylinder(g, .085, .09, .34, 0, .045, -.60, light, 16);
  barrel.rotation.x = Math.PI / 2;
  const bore = cylinder(g, .055, .055, .16, 0, .045, -.80, dark, 12);
  bore.rotation.x = Math.PI / 2;
  const brake = cylinder(g, .16, .16, .16, 0, .045, -.86, light, 20);
  brake.rotation.x = Math.PI / 2;
  const collar = cylinder(g, .14, .16, .06, 0, .045, -.76, dark, 20);
  collar.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    box(g, .055, .055, .10, Math.cos(a) * .15, .045 + Math.sin(a) * .15, -.86, dark);
  }
  ring(g, .165, .028, 0, .045, -.925, glow, 0);
  ring(g, .125, .022, 0, .045, -.65, light, 0);

  box(g, .10, .26, .20, .10, -.06, -.14, dark);
  const drum = cylinder(g, .28, .28, .34, .30, -.06, -.16, light, 32);
  drum.rotation.z = Math.PI / 2;
  drum.name = 'grenade-drum';
  const drumRing = new T.Mesh(geo('gl-drumring|.21|.022', () => new T.TorusGeometry(.21, .022, 6, 32)), glow);
  drumRing.rotation.y = Math.PI / 2;
  drumRing.position.set(.47, -.06, -.16);
  g.add(drumRing);
  const hub = cylinder(g, .06, .06, .40, .30, -.06, -.16, glow, 12);
  hub.rotation.z = Math.PI / 2;
  const hubCap = cylinder(g, .09, .09, .04, .50, -.06, -.16, light, 12);
  hubCap.rotation.z = Math.PI / 2;
  box(g, .05, .10, .05, .30, .19, -.16, dark);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const y = -.06 + Math.cos(a) * .17;
    const z = -.16 + Math.sin(a) * .17;
    const chamber = cylinder(g, .052, .052, .36, .30, y, z, dark, 12);
    chamber.rotation.z = Math.PI / 2;
    const round = cylinder(g, .036, .036, .10, .50, y, z, glow, 10);
    round.rotation.z = Math.PI / 2;
    box(g, .03, .05, .05, .55, y, z, light);
  }

  box(g, .08, .22, .10, 0, -.20, .10, dark);
  box(g, .09, .04, .12, 0, -.31, .13, light);
  for (const x of [-.04, .04]) box(g, .02, .09, .02, x, -.14, -.06, dark);
  box(g, .10, .02, .02, 0, -.18, -.06, dark);
  box(g, .02, .07, .02, 0, -.12, -.02, light);

  box(g, .10, .06, .12, 0, -.13, -.40, light);
  for (const x of [-.09, .09]) {
    const leg = cylinder(g, .018, .018, .22, x, -.24, -.42, dark, 8);
    leg.rotation.z = x < 0 ? .18 : -.18;
    box(g, .05, .03, .06, x, -.36, -.42, dark);
    box(g, .04, .04, .04, x, -.14, -.42, light);
  }

  box(g, .07, .14, .08, 0, -.16, -.36, dark);
  box(g, .12, .05, .24, 0, -.11, -.40, light);
  box(g, .03, .05, .30, -.17, .06, -.20, dark);
  box(g, .03, .05, .30, .17, .06, -.20, dark);
  box(g, .05, .04, .12, -.14, .10, -.24, light);
  box(g, .12, .04, .16, .10, .11, .03, light);
  box(g, .03, .08, .14, .16, .05, -.08, dark);
  box(g, .05, .05, .14, -.15, .06, -.06, light);
  box(g, .03, .06, .04, 0, .31, -.30, light);
  box(g, .05, .06, .04, 0, .31, .06, light);
  box(g, .04, .08, .22, -.13, .05, -.60, light);
  box(g, .04, .08, .22, .13, .05, -.60, light);
}
