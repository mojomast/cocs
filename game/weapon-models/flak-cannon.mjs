import * as T from 'three';
import {attachIronSights} from '../sights.mjs';

export function buildFlakCannon(g, ctx){
  const {box, cylinder, ring, geo, material, palette} = ctx;
  const {dark, light, glow} = palette;
  const steel = material('#9aa4ad', .82, .34);
  const plate = material('#4c5962', .68, .46);
  const bore = material('#0a0d10', .22, .9);

  const barrel = new T.Mesh(geo('flak-barrel|.19|.19|.62|28', () => new T.CylinderGeometry(.19, .19, .62, 28)), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, .03, -.60);
  barrel.name = 'flak-barrel';
  g.add(barrel);

  const barrelBore = new T.Mesh(geo('flak-barrel-bore|.125|.56|18', () => new T.CylinderGeometry(.125, .125, .56, 18)), bore);
  barrelBore.rotation.x = Math.PI / 2;
  barrelBore.position.set(0, .03, -.60);
  g.add(barrelBore);

  const bell = new T.Mesh(geo('flak-bell|.34|.2|.19|28', () => new T.CylinderGeometry(.34, .2, .19, 28)), light);
  bell.rotation.x = Math.PI / 2;
  bell.position.set(0, .03, -.895);
  g.add(bell);

  const bellBore = new T.Mesh(geo('flak-bell-bore|.15|.08|24', () => new T.CylinderGeometry(.15, .15, .08, 24)), bore);
  bellBore.rotation.x = Math.PI / 2;
  bellBore.position.set(0, .03, -.945);
  g.add(bellBore);

  ring(g, .223, .03, 0, .03, -.755, dark, 0);
  ring(g, .223, .03, 0, .03, -.345, dark, 0);

  for(let i = 0; i < 16; i++){
    const a = i * Math.PI / 8;
    const slat = box(g, .035, .05, .34, Math.cos(a) * .225, .03 + Math.sin(a) * .225, -.55, dark);
    slat.rotation.z = a;
  }

  box(g, .46, .42, .56, 0, .02, 0, dark);
  box(g, .48, .12, .5, 0, .29, -.02, light);
  box(g, .4, .09, .46, 0, -.235, -.02, light);
  box(g, .42, .34, .06, 0, .02, .31, plate);
  box(g, .06, .34, .44, -.26, .02, 0, plate);

  // --- open iron sights on the top plate -----------------------------------
  const sights = attachIronSights(g, ctx, {
    rear: {x: 0, y: .59, z: .10, width: .08, height: .05, gap: .03},
    front: {x: 0, y: .59, z: -.72, width: .014, height: .05, depth: .014},
  });

  box(g, .22, .32, .38, .34, -.06, -.06, plate);
  box(g, .22, .06, .4, .34, .13, -.06, dark);
  box(g, .07, .05, .1, .34, .185, .13, glow);

  for(const z of [-.18, -.06, .06, .18]) for(const y of [.13, -.13]) box(g, .028, .028, .028, -.304, y, z, steel);

  box(g, .05, .14, .06, -.15, .40, .06, dark);
  box(g, .05, .14, .06, .15, .40, .06, dark);
  box(g, .38, .05, .07, 0, .49, .06, light);
  box(g, .34, .02, .02, 0, .525, .06, glow);

  const gripL = box(g, .08, .26, .1, -.13, -.40, .10, dark);
  gripL.rotation.x = -.22;
  const gripR = box(g, .08, .26, .1, .13, -.40, .10, dark);
  gripR.rotation.x = -.22;
  box(g, .18, .03, .03, 0, -.45, .10, light);
  box(g, .025, .08, .03, 0, -.31, .02, glow);

  box(g, .24, .26, .34, 0, -.02, .52, dark);
  box(g, .18, .06, .24, 0, .145, .52, light);
  box(g, .28, .3, .07, 0, -.02, .725, plate);
  const springL = cylinder(g, .045, .045, .3, -.09, -.34, .45, steel, 10);
  springL.rotation.x = Math.PI / 2;
  const springR = cylinder(g, .045, .045, .3, .09, -.34, .45, steel, 10);
  springR.rotation.x = Math.PI / 2;

  for(const y of [-.16, -.02, .12]) for(const z of [-.2, .06]) box(g, .025, .025, .025, .4625, y, z, steel);

  for(let i = 0; i < 4; i++){
    const t = i / 3;
    box(g, .04, .03, .03, -.31, .05 + .12 * t, -.09 + .12 * t, dark);
  }

  g.userData.sights = sights;
}
