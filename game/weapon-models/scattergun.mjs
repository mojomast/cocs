import * as T from 'three';
export function buildScattergun(g, ctx){
  const {box,cylinder,ring,geo,material,palette}=ctx; const {dark,light,glow}=palette;
  const wood=material('#6b4a2f',.1,.85), woodDark=material('#573a24',.08,.88);
  const brass=material('#e6c06a',.7,.3,true), steel=material('#596269',.82,.34);
  const blued=material('#2c3339',.8,.4), boreMat=material('#0a0d0f',.35,.6);
  const etched=material('#d8b25e',.6,.35,true);

  // --- twin barrels (down -Z, tips near z=-0.82 at x=+/-0.12) ---
  for(const x of [-.12,.12]){
    const barrel=cylinder(g,.05,.055,.78,x,.04,-.43,steel,24); barrel.rotation.x=Math.PI/2;
    const choke=cylinder(g,.055,.048,.06,x,.04,-.80,blued,20); choke.rotation.x=Math.PI/2;
    const bore=cylinder(g,.041,.041,.09,x,.04,-.78,boreMat,20); bore.rotation.x=Math.PI/2;
    const rim=ring(g,.058,.011,x,.04,-.815,brass,0);
    rim.rotation.z=0;
  }
  // sight rib between the barrels
  box(g,.042,.022,.70,0,.096,-.44,light);
  box(g,.03,.028,.06,0,.104,-.78,glow);
  box(g,.018,.02,.5,0,.086,-.45,dark);
  // --- barrel bands clamp the twin tubes together ---
  for(const z of [-.63,-.27]){
    for(const x of [-.12,.12]) ring(g,.063,.014,x,.04,z,brass,0);
    box(g,.315,.024,.05,0,.104,z,blued);
    box(g,.30,.02,.05,0,-.022,z,blued);
  }
  // --- break-action hinge at the breech ---
  const hinge=cylinder(g,.052,.052,.31,0,.02,-.085,steel,22); hinge.rotation.z=Math.PI/2;
  for(const x of [-.175,.175]){const knob=cylinder(g,.04,.04,.04,x,.02,-.085,blued,16); knob.rotation.z=Math.PI/2;}
  box(g,.05,.03,.06,-.155,.05,-.10,brass);
  box(g,.20,.03,.05,0,.035,-.015,blued);
  box(g,.24,.055,.06,0,.02,-.045,dark);

  // --- engraved receiver ---
  box(g,.30,.17,.34,0,.015,.08,dark);
  box(g,.245,.06,.30,0,.125,.055,blued);
  box(g,.26,.05,.10,0,-.075,.02,blued);
  for(const x of [-.153,.153]){
    box(g,.008,.10,.235,x,.015,.075,brass);
    box(g,.01,.035,.16,x,.015,.075,etched);
    box(g,.01,.018,.05,x,.06,.02,dark);
    box(g,.01,.018,.05,x,-.03,.02,dark);
    box(g,.01,.018,.05,x,.06,.13,dark);
    box(g,.01,.018,.05,x,-.03,.13,dark);
  }
  box(g,.28,.02,.26,0,.006,.08,etched).rotation.z=0;
  for(const x of [-.10,-.034,.034,.10]) box(g,.03,.014,.02,x,-.07,.02,brass);
  box(g,.20,.13,.03,0,.02,-.10,light);

  // --- twin exposed hammers ---
  for(const x of [-.055,.055]){
    cylinder(g,.015,.013,.075,x,.155,.185,steel,14);
    box(g,.024,.05,.03,x,.195,.19,blued);
    box(g,.02,.025,.045,x,.205,.205,steel);
    const pin=cylinder(g,.011,.011,.035,x,.128,.168,brass,10); pin.rotation.z=Math.PI/2;
  }
  box(g,.11,.03,.05,0,.115,.155,dark);

  // --- trigger, guard and break lever ---
  box(g,.024,.06,.022,0,-.115,.055,brass);
  const guard=ring(g,.058,.012,0,-.135,.06,brass,0); guard.rotation.set(0,Math.PI/2,0);
  box(g,.02,.05,.02,0,-.098,.005,blued);
  box(g,.02,.05,.02,0,-.098,.115,blued);
  box(g,.03,.025,.14,0,-.145,.06,dark);

  // --- wooden forend under the barrels ---
  box(g,.235,.09,.36,0,-.062,-.36,wood);
  box(g,.20,.065,.05,0,-.07,-.545,woodDark);
  box(g,.18,.03,.30,0,-.115,-.37,woodDark);
  for(const x of [-.122,.122]){box(g,.014,.06,.24,x,-.055,-.36,woodDark);box(g,.01,.03,.05,x,-.055,-.50,brass);}
  box(g,.05,.04,.10,0,-.10,-.52,material('#8a6b45',.15,.8));

  // --- grip and wooden stock with drop comb ---
  box(g,.105,.17,.22,0,-.095,.215,wood);
  box(g,.128,.165,.34,0,-.035,.425,wood);
  box(g,.118,.055,.30,0,.055,.40,wood);
  box(g,.014,.075,.22,-.07,-.03,.40,woodDark);
  box(g,.075,.03,.30,0,-.135,.445,woodDark);
  box(g,.10,.045,.10,0,-.02,.30,wood);
  const butt=box(g,.142,.20,.04,0,-.055,.605,brass);
  box(g,.132,.03,.03,0,.045,.60,woodDark);
  box(g,.132,.03,.03,0,-.16,.60,woodDark);
  for(const x of [-.066,.066]) box(g,.012,.14,.26,x,-.03,.43,woodDark);

  // --- shell holder and spare shells on the stock ---
  box(g,.024,.11,.20,-.092,-.02,.36,blued);
  box(g,.03,.02,.21,-.096,.04,.36,dark);
  box(g,.03,.02,.21,-.096,-.08,.36,dark);
  for(let i=0;i<3;i++){
    const z=.305+i*.055;
    const shell=cylinder(g,.014,.014,.07,-.112,-.02,z,material('#cf3b2f',.3,.5),14); shell.rotation.x=Math.PI/2;
    const base=cylinder(g,.016,.016,.02,-.112,-.02,z+.04,brass,12); base.rotation.x=Math.PI/2;
    box(g,.028,.016,.012,-.108,-.075,z,brass);
  }
  box(g,.026,.10,.185,-.112,-.02,.36,material('#7d3a2c',.2,.6));
  // --- top tang, breech pins and barrel beads ---
  box(g,.06,.03,.14,0,.10,.23,blued);
  for(const x of [-.155,.155]){const p=cylinder(g,.012,.012,.02,x,.05,-.06,brass,10);p.rotation.z=Math.PI/2;}
  for(const x of [-.12,.12]) box(g,.02,.02,.03,x,.075,-.80,glow);
}
