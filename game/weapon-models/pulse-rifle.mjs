import * as T from 'three';
export function buildPulseRifle(g, ctx){
  const {box, cylinder, ring, geo, material, palette} = ctx;
  const {dark, light, glow} = palette;
  const grip = material('#141a1f', .5, .66);
  const steel = material('#3b4750', .72, .34);
  const teal = material('#2f7c74', .5, .48);
  const energy = material('#70ffe6', .3, .2, true);
  const vent = material('#0b1014', .4, .72);

  box(g, .17, .19, .5, 0, .02, -.12, dark);
  box(g, .155, .11, .34, 0, .155, -.2, teal);
  box(g, .19, .08, .2, 0, .05, .1, dark);
  box(g, .125, .11, .3, 0, -.045, .02, dark);
  box(g, .1, .075, .22, 0, .17, .14, steel);
  box(g, .09, .06, .18, 0, .2, -.02, dark);

  box(g, .06, .02, .12, 0, -.12, -.03, steel);
  box(g, .014, .05, .12, .03, -.1, -.03, steel);
  box(g, .014, .05, .12, -.03, -.1, -.03, steel);
  const trigger = box(g, .014, .05, .02, 0, -.095, -.02, light);
  trigger.rotation.x = .25;

  box(g, .05, .14, .06, 0, .055, .235, dark);
  box(g, .05, .09, .06, 0, -.06, .235, dark);
  box(g, .04, .05, .17, 0, 0, .26, teal);
  box(g, .07, .22, .045, 0, 0, .315, steel);

  const pgrip = box(g, .06, .16, .09, 0, -.17, .02, grip);
  pgrip.rotation.x = -.18;
  box(g, .05, .05, .1, 0, -.125, 0, grip);

  box(g, .1, .12, .13, 0, -.13, -.16, dark);
  const mag = box(g, .07, .18, .1, 0, -.24, -.135, steel);
  mag.rotation.x = .18;
  box(g, .075, .02, .11, 0, -.325, -.115, teal);

  box(g, .045, .13, .05, 0, -.16, -.5, grip);
  box(g, .06, .03, .09, 0, -.225, -.5, teal);

  box(g, .12, .13, .3, 0, .03, -.44, dark);
  box(g, .085, .06, .26, 0, .115, -.46, teal);
  for(let i = 0; i < 3; i++) box(g, .16, .028, .026, 0, .02, -.35 - i * .06, vent);
  box(g, .022, .045, .3, .1, .055, -.44, steel);
  box(g, .022, .045, .3, -.1, .055, -.44, steel);
  box(g, .07, .03, .26, 0, -.085, -.44, steel);

  const barrel = cylinder(g, .038, .045, .5, 0, .03, -.6, light, 16);
  barrel.rotation.x = Math.PI / 2;
  const shroud = cylinder(g, .058, .058, .24, 0, .03, -.5, dark, 16);
  shroud.rotation.x = Math.PI / 2;
  const muzzle = cylinder(g, .062, .052, .06, 0, .03, -.82, steel, 16);
  muzzle.rotation.x = Math.PI / 2;
  const tip = cylinder(g, .024, .032, .1, 0, .03, -.8, energy, 12);
  tip.rotation.x = Math.PI / 2;

  const rod = cylinder(g, .022, .022, .52, 0, .15, -.44, energy, 12);
  rod.rotation.x = Math.PI / 2;
  for(let i = 0; i < 6; i++) ring(g, .055, .016, 0, .15, -.2 - i * .09, energy, 0);
  box(g, .07, .04, .44, 0, .185, -.44, steel);

  box(g, .085, .05, .12, 0, .2, -.02, dark);
  box(g, .016, .13, .05, .045, .28, -.02, steel);
  box(g, .016, .13, .05, -.045, .28, -.02, steel);
  box(g, .13, .022, .05, 0, .345, -.02, steel);
  box(g, .088, .085, .01, 0, .275, -.075, energy);
  box(g, .07, .012, .01, 0, .275, -.075, light);

  for(let i = 0; i < 5; i++) box(g, .052, .022, .03, 0, .255, -.2 - i * .07, steel);

  for(let i = 0; i < 4; i++){
    const bolt = cylinder(g, .014, .014, .022, .092, .07 - i * .06, -.12, steel, 8);
    bolt.rotation.z = Math.PI / 2;
    const bolt2 = cylinder(g, .014, .014, .022, -.092, .07 - i * .06, -.12, steel, 8);
    bolt2.rotation.z = Math.PI / 2;
  }

  for(let i = 0; i < 3; i++){
    box(g, .014, .07, .05, .075, -.02, .12 - i * .08, teal);
    box(g, .014, .07, .05, -.075, -.02, .12 - i * .08, teal);
  }

  const cable = cylinder(g, .009, .009, .34, .088, -.02, -.05, glow, 6);
  cable.rotation.set(Math.PI / 2, 0, .18);
  const cable2 = cylinder(g, .009, .009, .3, -.088, -.02, -.05, glow, 6);
  cable2.rotation.set(Math.PI / 2, 0, -.18);

  const cellGeo = geo('pulse-cell|.055|1', () => new T.IcosahedronGeometry(.055, 1));
  const cell = new T.Mesh(cellGeo, energy);
  cell.position.set(.1, .05, .12);
  g.add(cell);
  const cell2 = new T.Mesh(cellGeo, energy);
  cell2.position.set(-.1, .05, .12);
  g.add(cell2);

  const core = new T.Mesh(geo('pulse-core|.07|2', () => new T.IcosahedronGeometry(.07, 2)), glow);
  core.position.set(0, .12, -.5);
  g.add(core);

  const cheek = new T.Mesh(geo('pulse-cheek|.09|.05|.16', () => new T.BoxGeometry(.09, .05, .16)), steel);
  cheek.position.set(0, .215, .16);
  g.add(cheek);
}
