import * as T from 'three';
import {attachIronSights} from '../sights.mjs';

// Type index 9 - "Submachine Gun" (#8affc1). Compact high-rate SMG: short
// barrel with a small muzzle device, boxy receiver, curved magazine, top
// picatinny rail with folding irons, vertical foregrip, side-folding wire
// stock, angled pistol grip. The shortest silhouette in the arsenal; the
// muzzle ends near z = -0.83 to match the shared per-type muzzle point.
export function buildSubmachineGun(g, ctx){
  const {box,cylinder,ring,material,palette}=ctx;
  const {dark,light,glow}=palette;
  const accent=material('#8affc1',.55,.3);

  // ------------------------------------------------------------------
  // Boxy compact receiver. R1 is the core slab; R2 the upper deck, R3 the
  // lower/magwell block, R4 a short rear cap. Each meets the next on a face.
  // ------------------------------------------------------------------
  box(g,.22,.2,.4,0,.02,-.16,dark);
  box(g,.18,.07,.36,0,.155,-.14,dark);
  box(g,.14,.11,.16,0,-.135,-.12,dark);
  box(g,.2,.04,.1,0,-.02,.09,dark);

  // ------------------------------------------------------------------
  // Top picatinny rail: base plus repeated teeth, then two green index dots.
  // Teeth sit on the base top (y = .22); dots sit on the tooth tops.
  // ------------------------------------------------------------------
  box(g,.08,.03,.36,0,.205,-.14,light);
  for(let i=0;i<7;i++)box(g,.086,.024,.026,0,.232,-.3+i*.04,dark);
  box(g,.03,.008,.03,0,.248,-.3,glow);
  box(g,.03,.008,.03,0,.248,-.18,glow);

  // ------------------------------------------------------------------
  // Open folding iron sights: a rear notch on the rail and a front post on the
  // handguard. Uses the real rear aperture height (y = .288) rather than the
  // old shared anchor, so ADS lines up with the actual sights.
  // ------------------------------------------------------------------
  const sights=attachIronSights(g,ctx,{
    rear:{x:0,y:.31,z:.01,width:.06,height:.07,gap:.02},
    front:{x:0,y:.31,z:-.47,width:.014,height:.10,depth:.014},
  });

  // ------------------------------------------------------------------
  // Short barrel with a stepped muzzle device. The exposed barrel butts the
  // receiver front face; the brake butts the barrel and stops at z = -0.83.
  // ------------------------------------------------------------------
  const barrel=cylinder(g,.04,.04,.42,0,.05,-.57,light,16);barrel.rotation.x=Math.PI/2;
  const brake=cylinder(g,.052,.052,.05,0,.05,-.805,glow,16);brake.rotation.x=Math.PI/2;
  ring(g,.058,.009,0,.05,-.835,light,0);

  // ------------------------------------------------------------------
  // Squared handguard: four plates whose inner faces only touch the barrel.
  // They span back to the receiver front face so nothing floats.
  // ------------------------------------------------------------------
  box(g,.08,.016,.18,0,.098,-.45,dark);
  box(g,.08,.016,.18,0,.002,-.45,dark);
  box(g,.016,.1,.18,.048,.05,-.45,dark);
  box(g,.016,.1,.18,-.048,.05,-.45,dark);

  // ------------------------------------------------------------------
  // Vertical foregrip with green finger ribs on its front face, plus a cap.
  // ------------------------------------------------------------------
  box(g,.05,.14,.06,0,-.076,-.46,dark);
  for(let i=0;i<3;i++)box(g,.05,.012,.01,0,-.04-i*.038,-.495,glow);
  box(g,.05,.02,.06,0,-.156,-.46,dark);

  // ------------------------------------------------------------------
  // Angled pistol grip (rotated 0.4 rad) with rear ribs and a base plate.
  // The grip top tucks a little way into the receiver underside; the ribs
  // live on the exposed lower half so they are not swallowed by the body.
  // ------------------------------------------------------------------
  const grip=box(g,.06,.16,.08,0,-.13,0,dark);grip.rotation.x=.4;
  const gripBase=box(g,.07,.02,.05,0,-.213,-.035,dark);gripBase.rotation.x=.4;
  for(const yi of [-.01,-.045]){
    const y=-.13+.921*yi-.01945, z=.389*yi+.04605;
    const rib=box(g,.064,.012,.02,0,y,z,glow);rib.rotation.x=.4;
  }

  // ------------------------------------------------------------------
  // Squared trigger guard: a post and bottom bar under the magwell, with a
  // trigger blade meeting the same underside just ahead of the grip.
  // ------------------------------------------------------------------
  box(g,.012,.055,.012,0,-.2175,-.08,dark);
  box(g,.012,.012,.072,0,-.245,-.06,dark);
  box(g,.01,.045,.012,0,-.2125,-.07,glow);

  // ------------------------------------------------------------------
  // Curved magazine from stacked segments. The top segment meets the magwell
  // underside; each lower segment is spaced just under one box height so the
  // stack reads as a smooth curve. Witness holes are raised side plates.
  // ------------------------------------------------------------------
  // The magazine is grouped so reload animation can drop it out of the magwell.
  const mag=new T.Group();mag.name='smg-magazine';g.add(mag);
  for(let i=0;i<7;i++){
    const y=-.2275-i*.072,z=-.15-i*.018,tilt=-.07-i*.055;
    const seg=box(mag,.08,.075,.12,0,y,z,dark);seg.rotation.x=tilt;
  }
  for(const [i,sx] of [[1,.043],[2,-.043],[4,.043],[5,-.043]]){
    box(mag,.006,.016,.024,sx,-.2275-i*.072,-.15-i*.018,glow);
  }
  box(mag,.09,.025,.13,0,-.715,-.258,light);
  g.userData.parts={...(g.userData.parts||{}),magazine:mag};

  // ------------------------------------------------------------------
  // Ejection port and charging handle on the right face; a second charging
  // handle on the left. All sit proud of the receiver side plane.
  // ------------------------------------------------------------------
  box(g,.01,.05,.11,.115,.06,-.18,accent);
  box(g,.04,.04,.06,.13,.095,-.2,light);
  box(g,.02,.03,.03,.16,.095,-.2,light);
  box(g,.05,.018,.04,-.13,.09,-.06,light);
  box(g,.02,.03,.03,-.16,.09,-.06,glow);

  // ------------------------------------------------------------------
  // Side-folding wire stock: hinge on the rear cap, four parallel wire rods,
  // a cross brace and a two-tone butt plate with three lightening holes.
  // ------------------------------------------------------------------
  box(g,.12,.1,.05,0,0,.165,dark);
  for(const x of [-.05,.05])for(const y of [-.03,.03]){
    const rod=cylinder(g,.011,.011,.12,x,y,.25,light,8);rod.rotation.x=Math.PI/2;
  }
  box(g,.12,.07,.02,0,0,.32,dark);
  box(g,.15,.13,.02,0,0,.34,dark);
  box(g,.16,.14,.02,0,0,.357,light);
  for(const x of [-.045,0,.045])box(g,.03,.03,.008,x,0,.372,glow);

  // ------------------------------------------------------------------
  // Side accessory rails (proud of the receiver plane), left bolt housing,
  // fire selector and bolt release.
  // ------------------------------------------------------------------
  box(g,.02,.045,.2,.12,-.01,-.14,dark);
  box(g,.02,.045,.2,-.12,-.01,-.14,dark);
  box(g,.04,.04,.05,-.13,.04,-.05,light);
  const sel=cylinder(g,.018,.018,.03,.125,-.02,-.02,glow,8);sel.rotation.z=Math.PI/2;
  box(g,.025,.03,.05,.122,-.02,.03,light);
  box(g,.04,.025,.06,-.13,-.02,-.3,dark);

  g.userData.sights=sights;
}
