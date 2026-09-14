import * as T from 'three';
export function buildScattergun(g, ctx){
  const {box,cylinder,ring,material,palette}=ctx; const {dark,light,glow}=palette;
  const wood=material('#6b4a2f',.1,.85), woodDark=material('#573a24',.08,.88);
  const brass=material('#e6c06a',.7,.3,true), steel=material('#596269',.82,.34);
  const blued=material('#2c3339',.8,.4), boreMat=material('#0a0d0f',.35,.6);
  const etched=material('#d8b25e',.6,.35,true);
  const red=material('#cf3b2f',.3,.5);

  // --- twin barrels (down -Z, tips near z=-0.82 at x=+/-0.12) ---
  for(const x of [-.12,.12]){
    const barrel=cylinder(g,.05,.05,.80,x,.04,-.42,steel,24); barrel.rotation.x=Math.PI/2;
    const bore=cylinder(g,.037,.037,.06,x,.04,-.79,boreMat,16); bore.rotation.x=Math.PI/2;
    ring(g,.062,.011,x,.04,-.815,brass,0);
    box(g,.02,.02,.03,x,.10,-.79,glow);
  }
  // --- sight rib nestled between the twin barrels ---
  box(g,.14,.05,.70,0,.07,-.45,light);
  box(g,.03,.02,.45,0,.105,-.42,dark);
  box(g,.03,.03,.06,0,.11,-.78,glow);
  // --- barrel bands clamp the twin tubes together ---
  for(const z of [-.65,-.30]){
    for(const x of [-.12,.12]) ring(g,.062,.011,x,.04,z,brass,0);
    box(g,.14,.03,.05,0,.025,z,blued);
  }
  // --- break-action hinge at the breech ---
  const hinge=cylinder(g,.045,.045,.30,0,.00,-.06,steel,22); hinge.rotation.z=Math.PI/2;
  for(const x of [-.17,.17]){const knob=cylinder(g,.035,.035,.04,x,.00,-.06,blued,16); knob.rotation.z=Math.PI/2;}
  box(g,.28,.03,.04,0,-.06,-.05,blued);

  // --- engraved receiver ---
  box(g,.30,.16,.28,0,.00,.11,dark);
  box(g,.24,.05,.28,0,.105,.11,blued);
  box(g,.26,.04,.24,0,-.10,.10,blued);
  box(g,.26,.012,.22,0,.136,.12,etched);
  for(const x of [-.156,.156]){
    box(g,.012,.11,.24,x,.00,.11,brass);
    box(g,.008,.04,.16,x+Math.sign(x)*.010,0,.11,etched);
  }

  // --- twin exposed hammers ---
  for(const x of [-.055,.055]){
    cylinder(g,.014,.012,.09,x,.175,.20,steel,12);
    box(g,.026,.045,.03,x,.2425,.205,blued);
  }

  // --- trigger, guard and break lever ---
  box(g,.05,.06,.03,0,-.15,.06,blued);
  box(g,.022,.055,.02,0,-.205,.06,brass);
  const guard=ring(g,.05,.010,0,-.225,.055,brass,0); guard.rotation.set(0,Math.PI/2,0);
  box(g,.02,.02,.02,0,-.185,.005,blued);
  box(g,.05,.03,.10,0,.157,.05,blued);

  // --- wooden forend under the barrels ---
  box(g,.23,.08,.34,0,-.07,-.35,wood);
  box(g,.19,.025,.26,0,-.1225,-.38,woodDark);
  box(g,.20,.05,.04,0,-.07,-.535,woodDark);
  for(const x of [-.122,.122]) box(g,.012,.05,.24,x,-.07,-.35,woodDark);
  box(g,.06,.025,.06,0,-.1475,-.49,brass);

  // --- grip and wooden stock with drop comb ---
  box(g,.10,.15,.20,0,-.195,.22,wood);
  box(g,.115,.13,.22,0,-.075,.36,wood);
  box(g,.135,.19,.24,0,-.045,.58,wood);
  box(g,.12,.05,.22,0,.075,.55,wood);
  box(g,.15,.21,.03,0,-.045,.715,brass);
  box(g,.14,.03,.02,0,.065,.70,woodDark);
  box(g,.14,.03,.02,0,-.155,.70,woodDark);
  box(g,.01,.10,.20,.062,-.06,.40,woodDark);

  // --- shell holder and spare shells on the stock ---
  box(g,.02,.11,.20,-.0675,-.02,.45,blued);
  box(g,.022,.016,.21,-.069,.04,.45,dark);
  box(g,.022,.016,.21,-.069,-.08,.45,dark);
  for(let i=0;i<3;i++){
    const z=.38+i*.06;
    const shell=cylinder(g,.014,.014,.04,-.087,-.02,z,red,14); shell.rotation.x=Math.PI/2;
    const base=cylinder(g,.016,.016,.016,-.087,-.02,z+.028,brass,12); base.rotation.x=Math.PI/2;
  }

  // --- breech pins flanking the receiver ---
  for(const x of [-.172,.172]){const p=cylinder(g,.010,.010,.02,x,.05,.02,brass,8);p.rotation.z=Math.PI/2;}
}
