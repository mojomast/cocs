import * as T from 'three';
import {attachScope} from '../sights.mjs';
export function buildMarksmanRifle(g, ctx){
  const {box,cylinder,ring,geo,material,palette}=ctx;
  const {dark,light,glow}=palette;
  const wood=material('#6b4a2f',.1,.85);
  const woodDark=material('#4a3220',.1,.88);

  box(g,.13,.14,.56,0,0,0,dark);
  box(g,.02,.05,.12,.075,0,-.02,dark);

  box(g,.05,.02,.44,0,.08,-.04,dark);
  for(const z of [.14,.10,-.02,-.09])box(g,.054,.012,.014,0,.096,z,light);
  box(g,.05,.02,.10,0,.08,.23,dark);

  const barrel=cylinder(g,.042,.033,.55,0,.02,-.485,light,16);barrel.rotation.x=Math.PI/2;
  ring(g,.05,.012,0,.02,-.30,dark,0);

  box(g,.10,.07,.22,0,-.054,-.39,wood);
  box(g,.105,.07,.05,0,-.054,-.525,dark);
  box(g,.045,.015,.16,0,-.0965,-.40,dark);
  box(g,.03,.012,.01,0,-.096,-.485,glow);

  box(g,.01,.01,.14,0,.060,-.64,light);
  box(g,.01,.01,.14,0,-.020,-.64,light);
  box(g,.01,.01,.14,-.040,.02,-.64,light);
  box(g,.01,.01,.14,.040,.02,-.64,light);
  box(g,.014,.03,.02,0,.08,-.66,dark);

  const brake=cylinder(g,.046,.046,.07,0,.02,-.795,dark,12);brake.rotation.x=Math.PI/2;
  box(g,.02,.014,.016,0,.073,-.775,dark);
  box(g,.02,.014,.016,0,.073,-.805,dark);
  box(g,.014,.06,.016,.053,.02,-.79,dark);
  box(g,.014,.06,.016,-.053,.02,-.79,dark);
  ring(g,.047,.009,0,.02,-.834,glow,0);

  box(g,.03,.035,.05,0,.1075,-.19,dark);
  box(g,.03,.035,.05,0,.1075,.05,dark);
  const sights=attachScope(g,ctx,{x:0,y:.34,z:.22,length:.5,radius:.05,mount:true,mountY:.125});
  cylinder(g,.022,.022,.05,0,.25,-.06,dark,8);
  cylinder(g,.024,.024,.014,0,.282,-.06,light,8);
  const wind=cylinder(g,.02,.02,.045,.074,.175,-.06,dark,8);wind.rotation.z=Math.PI/2;
  const para=cylinder(g,.02,.02,.04,-.072,.175,-.06,dark,8);para.rotation.z=Math.PI/2;

  const bolt=cylinder(g,.014,.014,.09,.079,.02,.13,light,8);bolt.rotation.x=Math.PI/2;
  const handle=cylinder(g,.011,.011,.07,.12,.02,.13,light,6);handle.rotation.z=Math.PI/2;
  const knob=new T.Mesh(geo('dmr-bolt-knob|.02|8|6',()=>new T.SphereGeometry(.02,8,6)),light);
  knob.position.set(.165,.02,.13);g.add(knob);

  box(g,.10,.13,.32,0,-.005,.44,wood);
  box(g,.105,.15,.028,0,-.005,.614,light);
  box(g,.075,.035,.20,0,.0775,.44,woodDark);
  box(g,.012,.026,.028,0,.108,.36,light);
  box(g,.055,.02,.08,0,-.08,.34,dark);

  box(g,.05,.14,.065,0,-.14,.20,wood);
  box(g,.05,.012,.10,0,-.12,.10,dark);
  box(g,.05,.05,.012,0,-.095,.056,dark);
  box(g,.05,.05,.012,0,-.095,.144,dark);
  box(g,.012,.05,.012,0,-.095,.10,light);
  box(g,.072,.16,.10,0,-.15,-.05,dark);
  box(g,.082,.018,.11,0,-.239,-.05,light);
  box(g,.02,.03,.03,0,-.085,-.115,light);

  box(g,.05,.03,.05,0,-.104,-.525,dark);
  const legL=cylinder(g,.009,.009,.185,-.065,-.20,-.525,light,6);legL.rotation.z=-.5;
  const legR=cylinder(g,.009,.009,.185,.065,-.20,-.525,light,6);legR.rotation.z=.5;
  box(g,.028,.016,.03,-.109,-.289,-.525,dark);
  box(g,.028,.016,.03,.109,-.289,-.525,dark);
  box(g,.20,.012,.012,0,-.288,-.525,dark);

  cylinder(g,.007,.007,.028,0,-.10,-.30,dark,6);
  cylinder(g,.007,.007,.028,0,-.085,.52,dark,6);

  g.userData.sights=sights;
}
