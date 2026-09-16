// Shock Beam (type index 6) - compact Tesla/arc projector. Two forward prongs
// hold a glowing octahedral emitter; ceramic insulator rings, copper coil
// windings and a cage shroud wrap the barrel. Amber and pale-blue energy read
// against the dark receiver. Static, deterministic, -Z muzzle.
import * as T from 'three';
import {attachIronSights} from '../sights.mjs';

export function buildShockBeam(g, ctx){
  const {box,cylinder,ring,geo,material,palette}=ctx;const {dark,light,glow}=palette;
  const amber=material('#ffb347',.3,.35,true),ceramic=material('#cfd9de',.25,.7);
  const B=.02;

  // receiver / grip / stock
  box(g,.26,.26,.5,0,0,-.05,dark);
  box(g,.18,.06,.44,0,.16,-.1,light);
  box(g,.22,.12,.42,0,-.19,-.1,dark);
  box(g,.18,.18,.28,0,0,.34,light);
  box(g,.2,.24,.08,0,0,.52,dark);
  box(g,.11,.26,.14,0,-.26,.18,dark);
  box(g,.09,.08,.12,0,-.42,.18,amber);

  // side plates and amber accents
  box(g,.03,.16,.3,-.145,.02,-.06,light);
  box(g,.03,.16,.3,.145,.02,-.06,light);
  box(g,.015,.08,.12,-.168,.02,-.02,amber);
  box(g,.015,.08,.12,.168,.02,-.02,amber);

  // top coil housing
  const housing=cylinder(g,.05,.05,.34,0,.24,-.16,dark,12);housing.rotation.x=Math.PI/2;

  // open iron sights (rear notch on the receiver, front post over the barrel)
  const sights=attachIronSights(g,ctx,{
    rear:{x:0,y:.20,z:.05,width:.07,height:.045,gap:.025},
    front:{x:0,y:.20,z:-.62,width:.014,height:.14,depth:.014},
  });

  // barrel and collar
  const barrel=cylinder(g,.07,.07,.36,0,B,-.48,light,12);barrel.rotation.x=Math.PI/2;
  const collar=cylinder(g,.1,.09,.12,0,B,-.72,dark,12);collar.rotation.x=Math.PI/2;

  // stacked ceramic insulator rings along the barrel
  for(const z of [-.34,-.44,-.54])ring(g,.1,.028,0,B,z,ceramic,0);
  // copper coil windings
  for(const z of [-.39,-.49])ring(g,.085,.014,0,B,z,glow,0);

  // cage shroud rods around the barrel (offset half-step from the prongs)
  for(let i=0;i<8;i++){const a=(i+.5)*Math.PI/4;box(g,.028,.028,.46,Math.cos(a)*.16,B+Math.sin(a)*.16,-.54,light);}

  // prong braces (split so they meet the barrel instead of spearing it)
  for(const z of [-.6,-.64]){
    box(g,.055,.03,.04,-.0975,B,z,dark);
    box(g,.055,.03,.04,.0975,B,z,dark);
  }

  // forward prongs and tips
  for(const x of [-.15,.15]){
    const prong=cylinder(g,.028,.026,.47,x,B,-.72,light,12);prong.rotation.x=Math.PI/2;
    const tip=new T.Mesh(geo('shockbeam|tip|.018|0',()=>new T.OctahedronGeometry(.018,0)),glow);
    tip.position.set(x,B,-.973);g.add(tip);
  }

  // emitter cage rods framing the central emitter
  for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2;box(g,.02,.02,.22,Math.cos(a)*.16,B+Math.sin(a)*.16,-.87,light);}

  // central octahedral emitter (looked up by name) and inner core
  const emitter=new T.Mesh(geo('shockbeam|emitter|.12|2',()=>new T.OctahedronGeometry(.12,2)),glow);
  emitter.position.set(0,B,-.87);emitter.name='shock-emitter';g.add(emitter);
  const core=new T.Mesh(geo('shockbeam|core|.07|1',()=>new T.OctahedronGeometry(.07,1)),amber);
  core.position.set(0,B,-.87);g.add(core);

  // side capacitor cells
  cylinder(g,.035,.035,.18,-.195,-.05,.075,glow,12);
  cylinder(g,.035,.035,.18,.195,-.05,.075,glow,12);

  g.userData.sights=sights;
}
