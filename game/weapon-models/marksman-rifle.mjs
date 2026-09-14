import * as T from 'three';
export function buildMarksmanRifle(g, ctx){
  const {box,cylinder,ring,geo,material,palette}=ctx;
  const {dark,light,glow}=palette;
  const wood=material('#6b4a2f',.1,.85);
  const woodDark=material('#4a3220',.1,.88);

  box(g,.13,.14,.56,0,0,0,dark);
  box(g,.132,.052,.18,0,-.005,.07,dark);
  box(g,.055,.07,.34,0,.01,.43,dark);
  box(g,.10,.13,.30,0,-.005,.45,wood);
  box(g,.105,.15,.028,0,-.005,.605,light);
  box(g,.075,.035,.20,0,.075,.46,woodDark);
  box(g,.012,.026,.028,0,.088,.36,light);
  box(g,.05,.14,.065,0,-.10,.21,wood);
  box(g,.05,.011,.12,0,-.083,.12,dark);
  box(g,.012,.028,.012,0,-.062,.11,light);
  box(g,.072,.16,.10,0,-.135,-.03,dark);
  box(g,.082,.018,.11,0,-.222,-.03,light);
  box(g,.02,.03,.03,0,-.075,0,light);

  box(g,.05,.028,.44,0,.084,0,dark);
  for(const z of [.10,.04,-.02,-.08])box(g,.054,.008,.014,0,.10,z,light);
  box(g,.11,.02,.10,0,.07,.30,light);

  const barrel=cylinder(g,.042,.034,.62,0,.03,-.52,light,16);barrel.rotation.x=Math.PI/2;
  ring(g,.05,.012,0,.03,-.205,dark,0);
  box(g,.10,.085,.34,0,-.005,-.36,wood);
  box(g,.105,.09,.03,0,-.005,-.535,dark);
  box(g,.045,.02,.20,0,-.055,-.36,dark);
  box(g,.012,.012,.03,0,-.062,-.29,glow);
  box(g,.010,.010,.20,.030,.030,-.65,light);
  box(g,.010,.010,.20,-.030,.030,-.65,light);
  box(g,.010,.010,.20,0,.062,-.65,light);
  box(g,.010,.010,.20,0,-.002,-.65,light);

  const brake=cylinder(g,.046,.046,.07,0,.03,-.795,dark,12);brake.rotation.x=Math.PI/2;
  box(g,.06,.014,.016,0,.072,-.775,dark);
  box(g,.06,.014,.016,0,.072,-.805,dark);
  box(g,.014,.06,.016,.048,.03,-.79,dark);
  box(g,.014,.06,.016,-.048,.03,-.79,dark);
  ring(g,.047,.009,0,.03,-.832,glow,0);
  box(g,.014,.032,.02,0,.076,-.70,dark);

  box(g,.045,.05,.05,0,.12,-.18,dark);
  box(g,.045,.05,.05,0,.12,.06,dark);
  const tube=cylinder(g,.05,.05,.44,0,.175,-.06,dark,16);tube.rotation.x=Math.PI/2;
  ring(g,.056,.012,0,.175,-.18,dark,0);
  ring(g,.056,.012,0,.175,.06,dark,0);
  const bell=cylinder(g,.06,.06,.075,0,.175,-.30,dark,16);bell.rotation.x=Math.PI/2;
  const eye=cylinder(g,.055,.055,.07,0,.175,.18,dark,12);eye.rotation.x=Math.PI/2;
  const frontLens=cylinder(g,.052,.052,.010,0,.175,-.341,glow,12);frontLens.rotation.x=Math.PI/2;
  const rearLens=cylinder(g,.047,.047,.010,0,.175,.216,glow,12);rearLens.rotation.x=Math.PI/2;
  ring(g,.057,.008,0,.175,-.343,glow,0);
  ring(g,.052,.008,0,.175,.218,dark,0);
  cylinder(g,.022,.022,.05,0,.238,-.06,dark,8);
  cylinder(g,.024,.024,.014,0,.268,-.06,light,8);
  const wind=cylinder(g,.02,.02,.045,.074,.175,-.06,dark,8);wind.rotation.z=Math.PI/2;
  const para=cylinder(g,.02,.02,.04,-.072,.175,-.06,dark,8);para.rotation.z=Math.PI/2;

  const bolt=cylinder(g,.014,.014,.10,.046,.015,.13,light,8);bolt.rotation.x=Math.PI/2;
  const handle=cylinder(g,.011,.011,.07,.10,0,.16,light,6);handle.rotation.z=Math.PI/2;
  const knob=new T.Mesh(geo('dmr-bolt-knob|.02|8|6',()=>new T.SphereGeometry(.02,8,6)),light);
  knob.position.set(.14,-.005,.16);g.add(knob);

  box(g,.05,.03,.05,0,-.075,-.44,dark);
  const legL=cylinder(g,.009,.009,.18,-.055,-.155,-.44,light,6);legL.rotation.z=-.35;legL.rotation.x=-.25;
  const legR=cylinder(g,.009,.009,.18,.055,-.155,-.44,light,6);legR.rotation.z=.35;legR.rotation.x=-.25;
  box(g,.028,.016,.03,-.112,-.238,-.362,dark);
  box(g,.028,.016,.03,.112,-.238,-.362,dark);
  box(g,.14,.012,.012,0,-.175,-.42,dark);

  cylinder(g,.007,.007,.028,0,-.085,-.50,dark,6);
  cylinder(g,.007,.007,.028,0,-.10,.52,dark,6);
}
