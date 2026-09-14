import * as T from 'three';

export function buildFlakCannon(g, ctx){
  const {box, cylinder, ring, geo, material, palette} = ctx;
  const {dark, light, glow} = palette;
  const steel = material('#9aa4ad', .82, .34);
  const plate = material('#4c5962', .68, .46);
  const bore = material('#0a0d10', .22, .9);

  const barrel = new T.Mesh(geo('flak-barrel|.2|.16|.68|28', () => new T.CylinderGeometry(.2, .16, .68, 28)), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, .03, -.6);
  barrel.name = 'flak-barrel';
  g.add(barrel);

  const barrelBore = new T.Mesh(geo('flak-barrel-bore|.135|.5|18', () => new T.CylinderGeometry(.135, .135, .5, 18)), bore);
  barrelBore.rotation.x = Math.PI / 2;
  barrelBore.position.set(0, .03, -.62);
  g.add(barrelBore);

  const bell = new T.Mesh(geo('flak-bell|.34|.2|.18|28', () => new T.CylinderGeometry(.34, .2, .18, 28)), light);
  bell.rotation.x = Math.PI / 2;
  bell.position.set(0, .03, -.9);
  g.add(bell);

  const bellBore = new T.Mesh(geo('flak-bell-bore|.255|.12|24', () => new T.CylinderGeometry(.255, .255, .12, 24)), bore);
  bellBore.rotation.x = Math.PI / 2;
  bellBore.position.set(0, .03, -.925);
  g.add(bellBore);

  ring(g, .35, .03, 0, .03, -.962, dark, 0);

  for(let i = 0; i < 16; i++){
    const a = i * Math.PI / 8;
    const slat = box(g, .035, .05, .46, Math.cos(a) * .205, .03 + Math.sin(a) * .205, -.58, dark);
    slat.rotation.z = a;
  }

  const collarA = cylinder(g, .215, .215, .05, 0, .03, -.35, light, 24);
  collarA.rotation.x = Math.PI / 2;
  const collarB = cylinder(g, .215, .215, .05, 0, .03, -.8, light, 24);
  collarB.rotation.x = Math.PI / 2;
  ring(g, .218, .02, 0, .03, -.44, dark, 0);
  ring(g, .218, .02, 0, .03, -.56, dark, 0);
  ring(g, .218, .02, 0, .03, -.68, dark, 0);

  box(g, .46, .42, .56, 0, .02, 0, dark);
  box(g, .48, .12, .5, 0, .28, -.02, light);
  box(g, .4, .09, .46, 0, -.21, -.02, light);
  box(g, .42, .34, .06, 0, .02, .3, plate);
  box(g, .06, .34, .44, -.245, .02, 0, plate);
  box(g, .06, .34, .44, .245, .02, 0, plate);
  const frontCollar = cylinder(g, .245, .245, .07, 0, .03, -.3, dark, 24);
  frontCollar.rotation.x = Math.PI / 2;

  for(const z of [-.18, -.06, .06, .18]){
    box(g, .028, .028, .028, -.28, .16, z, steel);
    box(g, .028, .028, .028, .28, .16, z, steel);
    box(g, .028, .028, .028, -.28, -.14, z, steel);
    box(g, .028, .028, .028, .28, -.14, z, steel);
  }
  for(const x of [-.16, .16]) for(const z of [-.16, .16]) box(g, .028, .028, .028, x, .35, z, steel);

  box(g, .05, .14, .06, -.15, .4, .06, dark);
  box(g, .05, .14, .06, .15, .4, .06, dark);
  box(g, .38, .05, .07, 0, .48, .06, light);
  box(g, .34, .02, .02, 0, .51, .06, glow);

  const gripL = box(g, .08, .24, .1, -.13, -.34, .12, dark);
  gripL.rotation.x = -.25;
  const gripR = box(g, .08, .24, .1, .13, -.34, .12, dark);
  gripR.rotation.x = -.25;
  box(g, .14, .03, .03, 0, -.42, .02, light);
  box(g, .03, .12, .03, -.07, -.35, .02, light);
  box(g, .03, .12, .03, .07, -.35, .02, light);
  box(g, .025, .09, .03, 0, -.31, .03, glow);

  box(g, .24, .26, .34, 0, -.02, .52, dark);
  box(g, .18, .06, .24, 0, .16, .52, light);
  box(g, .28, .3, .07, 0, -.02, .71, plate);
  const springL = cylinder(g, .05, .05, .3, -.09, -.14, .4, steel, 10);
  springL.rotation.x = Math.PI / 2;
  const springR = cylinder(g, .05, .05, .3, .09, -.14, .4, steel, 10);
  springR.rotation.x = Math.PI / 2;

  box(g, .2, .32, .38, .4, -.06, -.06, plate);
  box(g, .22, .06, .4, .4, .13, -.06, dark);
  box(g, .07, .05, .1, .4, .13, .13, glow);
  for(const y of [-.16, -.02, .12]) for(const z of [-.2, .06]) box(g, .025, .025, .025, .51, y, z, steel);

  for(let i = 0; i < 8; i++){
    const t = i / 7;
    box(g, .055, .05, .07, .3 - .16 * t, .06 + .12 * t, -.06 + .08 * t, dark);
  }
  const guideA = cylinder(g, .045, .045, .07, .26, .03, -.05, steel, 10);
  guideA.rotation.z = Math.PI / 2;
  const guideB = cylinder(g, .045, .045, .07, .18, .1, -.02, steel, 10);
  guideB.rotation.z = Math.PI / 2;
  box(g, .02, .1, .16, .29, .09, -.02, bore);

  for(let i = 0; i < 3; i++) box(g, .05, .06, .04, 0, .3, -.86 - i * .05, glow);
  box(g, .06, .05, .04, -.13, .03, -.86, glow);
  box(g, .06, .05, .04, .13, .03, -.86, glow);
}
