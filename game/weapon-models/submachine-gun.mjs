import * as T from 'three';

// Type index 9 - "Submachine Gun" (#8affc1). Compact high-rate SMG: short
// barrel with a small muzzle device, boxy receiver, curved magazine, top
// picatinny rail with folding irons, vertical foregrip, side-folding wire
// stock, angled pistol grip. The shortest silhouette in the arsenal; the
// muzzle ends near z = -0.83 to match the shared per-type muzzle point.
export function buildSubmachineGun(g, ctx){
  const {box,cylinder,ring,geo,material,palette}=ctx;
  const {dark,light,glow}=palette;
  const accent=material('#8affc1',.55,.3);

  // Boxy compact receiver.
  box(g,.22,.2,.4,0,.02,-.16,dark);
  box(g,.18,.07,.36,0,.155,-.14,dark);
  box(g,.16,.11,.2,0,-.1,0,dark);
  box(g,.2,.03,.1,0,-.02,.12,dark);

  // Top picatinny rail: base plus repeated teeth.
  box(g,.08,.03,.36,0,.2,-.13,light);
  for(let i=0;i<9;i++)box(g,.086,.024,.026,0,.226,-.3+i*.04,dark);
  for(const z of [-.3,-.18])box(g,.032,.014,.03,0,.242,z,glow);

  // Folding iron sights, front post and rear aperture.
  box(g,.07,.05,.05,0,.235,-.47,dark);
  box(g,.014,.055,.014,0,.28,-.47,glow);
  for(const x of [-.02,.02])box(g,.01,.05,.014,x,.255,-.47,dark);
  box(g,.08,.05,.05,0,.235,-.02,dark);
  ring(g,.021,.007,0,.272,-.02,glow,0);
  box(g,.05,.03,.03,0,.25,.02,dark);

  // Short barrel with cooling shroud and stepped muzzle device.
  const barrel=cylinder(g,.042,.042,.44,0,.05,-.6,light,16);barrel.rotation.x=Math.PI/2;
  const shroud=cylinder(g,.06,.06,.18,0,.05,-.46,dark,16);shroud.rotation.x=Math.PI/2;
  box(g,.07,.08,.06,0,.05,-.52,dark);
  const brakeGeo=geo('smg|brake|.058|.038|.09|16',()=>new T.LatheGeometry([
    new T.Vector2(.038,-.045),new T.Vector2(.058,-.02),
    new T.Vector2(.058,.02),new T.Vector2(.046,.045),
  ],16));
  const brake=new T.Mesh(brakeGeo,glow);
  brake.rotation.x=Math.PI/2;brake.position.set(0,.05,-.785);g.add(brake);
  ring(g,.052,.009,0,.05,-.83,light,0);

  // Handguard venting around the barrel.
  for(let i=0;i<6;i++){
    const z=-.4-i*.05;
    box(g,.012,.02,.02,.062,.02,z,glow);
    box(g,.012,.02,.02,-.062,.02,z,glow);
  }
  box(g,.05,.05,.2,0,-.02,-.46,dark);

  // Ejection port and charging handle.
  box(g,.012,.05,.11,.115,.06,-.18,accent);
  box(g,.016,.062,.12,.12,.06,-.2,light);
  box(g,.04,.024,.08,-.1,.12,-.06,light);
  const charge=cylinder(g,.014,.014,.05,-.14,.12,-.06,glow,8);charge.rotation.z=Math.PI/2;

  // Vertical foregrip with green grip ribs.
  box(g,.05,.15,.06,0,-.12,-.44,dark);
  for(let i=0;i<3;i++)box(g,.056,.014,.066,0,-.06-i*.038,-.44,glow);
  box(g,.05,.02,.06,0,-.2,-.44,dark);

  // Angled pistol grip, trigger guard and trigger.
  const grip=box(g,.06,.16,.08,0,-.12,.03,dark);grip.rotation.x=.4;
  const gripBase=box(g,.07,.02,.09,0,-.2,.07,dark);gripBase.rotation.x=.4;
  for(let i=0;i<2;i++)box(g,.064,.012,.084,0,-.08-i*.04,.02+i*.016,glow);
  const guard=ring(g,.05,.012,0,-.06,-.02,light,0);guard.rotation.y=Math.PI/2;
  box(g,.015,.05,.02,0,-.07,-.03,glow);
  box(g,.03,.02,.03,0,-.1,-.06,accent);

  // Curved magazine from stacked angled boxes.
  box(g,.075,.06,.14,0,-.17,-.07,dark);
  for(let i=0;i<7;i++){
    const y=-.22-i*.072,z=-.08-i*.018,tilt=-.07-i*.055;
    const seg=box(g,.08,.075,.15,0,y,z,dark);seg.rotation.x=tilt;
    if(i%2===0){const mark=box(g,.084,.013,.154,0,y,z,glow);mark.rotation.x=tilt;}
  }
  box(g,.09,.025,.16,0,-.73,-.2,light);
  box(g,.03,.02,.04,.05,-.18,-.05,accent);
  // Magazine witness holes.
  for(let i=0;i<4;i++)box(g,.086,.018,.028,0,-.27-i*.14,-.11-i*.028,glow);

  // Side-folding wire stock: hinge, twin wires, brace and butt plate.
  box(g,.05,.06,.04,0,.04,.03,dark);
  const hingePin=cylinder(g,.022,.022,.07,0,-.04,.03,dark,8);hingePin.rotation.z=Math.PI/2;
  box(g,.03,.03,.03,.08,.02,.05,glow);
  box(g,.03,.03,.03,-.08,.02,.05,glow);
  for(const x of [-.06,.06]){
    const wireTop=cylinder(g,.011,.011,.22,x,.055,.15,light,8);wireTop.rotation.x=Math.PI/2;
    const wireBottom=cylinder(g,.011,.011,.22,x,-.015,.15,light,8);wireBottom.rotation.x=Math.PI/2;
  }
  box(g,.14,.02,.02,0,.02,.26,dark);
  box(g,.15,.13,.025,0,0,.275,dark);
  box(g,.16,.14,.02,0,0,.29,light);
  box(g,.1,.035,.08,0,.085,.2,dark);
  box(g,.02,.08,.03,.075,.02,.2,accent);
  // Stock lightening holes.
  for(let i=0;i<3;i++)box(g,.03,.03,.03,-.04+i*.04,.02,.29,glow);

  // Side accessory rails and green accents.
  box(g,.02,.045,.2,.115,-.01,-.14,dark);
  box(g,.02,.045,.2,-.115,-.01,-.14,dark);
  box(g,.09,.012,.26,0,.24,-.12,glow);
  ring(g,.025,.008,-.07,-.05,.06,glow,0);
  box(g,.05,.02,.04,.1,-.03,.05,accent);
  box(g,.04,.04,.05,-.11,.04,-.05,light);

  // Fire selector and bolt release.
  const selector=cylinder(g,.018,.018,.03,.12,-.02,-.04,glow,8);selector.rotation.z=Math.PI/2;
  box(g,.025,.03,.05,.125,-.02,-.0,light);
  box(g,.04,.025,.06,-.09,-.02,-.24,dark);
}
