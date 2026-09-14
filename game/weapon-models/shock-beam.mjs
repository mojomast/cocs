// Shock Beam (type index 6) - compact Tesla/arc projector. Two long forward
// prongs hold a glowing octahedral emitter; stacked ceramic insulator discs,
// copper coil windings and a cage shroud wrap the barrel. Amber and pale-blue
// energy read against the dark receiver. Static, deterministic, -Z muzzle.
import * as T from 'three';

export function buildShockBeam(g, ctx){
  const {box,cylinder,ring,geo,material,palette}=ctx;const {dark,light,glow}=palette;
  const amber=material('#ffb347',.3,.35,true),ceramic=material('#cfd9de',.25,.7);

  // receiver / grip / stock
  box(g,.26,.26,.54,0,0,-.06,dark);
  box(g,.18,.06,.44,0,.17,-.14,light);
  box(g,.22,.12,.42,0,-.17,-.14,dark);
  box(g,.18,.18,.3,0,0,.24,light);
  box(g,.2,.24,.08,0,0,.43,dark);
  box(g,.11,.28,.15,0,-.28,.06,dark);
  box(g,.09,.2,.05,0,-.3,.15,amber);
  box(g,.07,.05,.16,0,-.19,-.02,dark);
  box(g,.035,.1,.04,0,-.21,-.05,glow);
  box(g,.04,.16,.3,-.15,.02,-.06,light);
  box(g,.04,.16,.3,.15,.02,-.06,light);
  box(g,.02,.08,.12,-.16,.02,-.02,amber);
  box(g,.02,.08,.12,.16,.02,-.02,amber);
  box(g,.1,.05,.5,0,-.11,-.5,dark);

  // top coil housing
  const housing=cylinder(g,.07,.07,.42,0,.21,-.28,dark,12);housing.rotation.x=Math.PI/2;
  box(g,.1,.08,.08,0,.21,-.05,light);

  // barrel, collar, muzzle
  const barrel=cylinder(g,.075,.07,.52,0,.02,-.5,light,12);barrel.rotation.x=Math.PI/2;
  const collar=cylinder(g,.1,.09,.12,0,.02,-.78,dark,12);collar.rotation.x=Math.PI/2;
  ring(g,.095,.018,0,.02,-.86,glow,0);

  // stacked ceramic insulator discs along the barrel
  for(const z of [-.3,-.4,-.5,-.6,-.7]){const disc=cylinder(g,.115,.115,.035,0,.02,z,ceramic,12);disc.rotation.x=Math.PI/2;}
  // copper coil windings
  for(const z of [-.34,-.44,-.54,-.64])ring(g,.105,.016,0,.02,z,glow,0);

  // cage shroud rods around the barrel
  for(let i=0;i<8;i++){const a=i*Math.PI/4;box(g,.028,.028,.54,Math.cos(a)*.14,.02+Math.sin(a)*.14,-.5,light);}

  // prong braces
  box(g,.16,.03,.04,0,.02,-.58,dark);
  box(g,.16,.03,.04,0,.02,-.72,dark);

  // forward prongs and tips
  for(const x of [-.15,.15]){
    const prong=cylinder(g,.028,.024,.5,x,.02,-.74,light,12);prong.rotation.x=Math.PI/2;
    const tip=new T.Mesh(geo('shockbeam|tip|.035|0',()=>new T.OctahedronGeometry(.035,0)),glow);
    tip.position.set(x,.02,-.99);g.add(tip);
  }

  // central octahedral emitter (looked up by name) and inner core
  ring(g,.1,.016,0,.02,-.8,glow,0);
  const emitter=new T.Mesh(geo('shockbeam|emitter|.14|2',()=>new T.OctahedronGeometry(.14,2)),glow);
  emitter.position.set(0,.02,-.88);emitter.name='shock-emitter';g.add(emitter);
  const core=new T.Mesh(geo('shockbeam|core|.07|1',()=>new T.OctahedronGeometry(.07,1)),amber);
  core.position.set(0,.02,-.88);g.add(core);

  // emitter fins
  box(g,.03,.16,.03,-.12,.02,-.88,light);
  box(g,.03,.16,.03,.12,.02,-.88,light);
  box(g,.16,.03,.03,0,.15,-.88,light);
  box(g,.16,.03,.03,0,-.11,-.88,light);

  // side energy channels and capacitor cells
  box(g,.025,.04,.44,-.14,-.06,-.5,amber);
  box(g,.025,.04,.44,.14,-.06,-.5,amber);
  cylinder(g,.045,.045,.2,-.18,0,-.16,glow,12);
  cylinder(g,.045,.045,.2,.18,0,-.16,glow,12);
}
