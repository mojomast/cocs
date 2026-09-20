// Alt-fire viewmodel parts + per-weapon morph table. Presentation only: the
// shared `assembleWeapon` tail calls `buildAltParts` to bolt a handful of small,
// hidden meshes onto each weapon, and the view blends them in while the
// snapshot's `player.alt` flag holds. All materials and geometries go through
// `ctx` (cached, disposed with the model); the table below is the single source
// of truth for what each of the ten modes moves, shows and pulses. Identity
// (id/tracer colour) comes from the frozen alt-fire spec so presentation can
// never drift from the simulation table.
import * as T from 'three';
import {chassisFor} from './chassis.mjs';
import {ALT_FIRE} from '../alt-fire.mjs';

const move=(node,pos=null,rot=null,scale=null)=>Object.freeze({node,pos,rot,scale});
const show=(node,at)=>Object.freeze({node,at});
const pulse=(node,rate,amount)=>Object.freeze({node,rate,amount});

// Ten morphs. `show` bounds extra-part visibility (hidden at rest), `move`
// lerps a node from its authored rest transform toward a target delta, and
// `pulse` adds a deterministic reduced-motion-aware scale shimmer. Every node
// name exists in the matching build branch below.
export const ALT_MORPHS=Object.freeze([
 Object.freeze({id:'salvo', // 0 pulse: barrel splits into three prongs with heat fins
  show:[show('alt-salvo-prong-l',.1),show('alt-salvo-prong-c',.1),show('alt-salvo-prong-r',.1),show('alt-salvo-fins',.25)],
  move:[move('alt-salvo-prong-l',[-.032,.004,-.02],[0,.22,0]),move('alt-salvo-prong-c',[0,.02,-.01],[-.14,0,0]),move('alt-salvo-prong-r',[.032,.004,-.02],[0,-.22,0]),move('alt-salvo-fins',[0,0,.03])],
  pulse:[]}),
 Object.freeze({id:'cluster', // 1 rocket: tri-tube cluster pod unfolds over the muzzle
  show:[show('alt-cluster-hub',.05),show('alt-cluster-tube-a',.15),show('alt-cluster-tube-b',.25),show('alt-cluster-tube-c',.35)],
  move:[move('alt-cluster-hub',[0,0,-.05]),move('alt-cluster-tube-a',[0,-.06,-.04],[.32,0,0]),move('alt-cluster-tube-b',[.052,.03,-.04],[-.16,-.28,0]),move('alt-cluster-tube-c',[-.052,.03,-.04],[-.16,.28,0])],
  pulse:[]}),
 Object.freeze({id:'overload', // 2 rail: accelerator coils separate and glow white
  show:[show('alt-rail-coil-0',.15),show('alt-rail-coil-1',.35),show('alt-rail-coil-2',.55)],
  move:[move('alt-rail-coil-0',[0,0,-.05],null,[1.2,1.2,1.2]),move('alt-rail-coil-1',[0,0,-.15],null,[1.35,1.35,1.35]),move('alt-rail-coil-2',[0,0,-.25],null,[1.5,1.5,1.5])],
  pulse:[]}),
 Object.freeze({id:'slug', // 3 scatter: choke lifts and extends into a long single bore
  show:[show('alt-slug-choke',.15),show('alt-slug-ring',.5)],
  move:[move('alt-slug-choke',[0,.17,-.22]),move('alt-slug-ring',[0,.17,-.20],null,[1.4,1.4,1.4])],
  pulse:[]}),
 Object.freeze({id:'mortar', // 4 plasma: emitter dome tilts up and rounds out
  show:[show('alt-mortar-dome',.1),show('alt-mortar-ring',.3)],
  move:[move('alt-mortar-dome',[0,.02,-.01],[.55,0,0],[1.15,1.05,1.15]),move('alt-mortar-ring',[0,.02,-.01],[.55,0,0])],
  pulse:[]}),
 Object.freeze({id:'mine', // 5 grenade: drum seals and a sensor eye blinks blue
  show:[show('alt-mine-seal',.15),show('alt-mine-ring',.25),show('alt-mine-eye',.4)],
  move:[move('alt-mine-seal',[0,0,.03]),move('alt-mine-ring',[0,0,.03]),move('alt-mine-eye',[0,.006,.045],null,[1.1,1.1,1.1])],
  pulse:[pulse('alt-mine-eye',11,.55)]}),
 Object.freeze({id:'chain', // 6 shock: antenna prongs rise and crackle
  show:[show('alt-chain-prong-l',.12),show('alt-chain-prong-r',.12),show('alt-chain-bar',.3)],
  move:[move('alt-chain-prong-l',[0,.045,0],[0,0,1.15]),move('alt-chain-prong-r',[0,.045,0],[0,0,-1.15]),move('alt-chain-bar',[0,.045,0])],
  pulse:[pulse('alt-chain-prong-l',26,.1),pulse('alt-chain-prong-r',26,.1)]}),
 Object.freeze({id:'bomb', // 7 flak: bore opens into a wide flak funnel
  show:[show('alt-bomb-petal-e',.1),show('alt-bomb-petal-n',.2),show('alt-bomb-petal-w',.3),show('alt-bomb-petal-s',.4),show('alt-bomb-ring',.5)],
  move:[move('alt-bomb-petal-e',[.05,0,0],[0,.45,0]),move('alt-bomb-petal-n',[0,.05,0],[-.45,0,0]),move('alt-bomb-petal-w',[-.05,0,0],[0,-.45,0]),move('alt-bomb-petal-s',[0,-.05,0],[.45,0,0]),move('alt-bomb-ring',[0,0,-.03])],
  pulse:[]}),
 Object.freeze({id:'double', // 8 marksman: scope folds aside for canted iron sights
  show:[show('alt-double-cant-rear',.15),show('alt-double-cant-front',.3)],
  move:[move('alt-double-cant-rear',[0,.025,0]),move('alt-double-cant-front',[0,.025,0]),move('sight-assembly',[.02,-.02,0],[0,0,.85])],
  pulse:[]}),
 Object.freeze({id:'twin', // 9 SMG: second barrel and foregrip fold out
  show:[show('alt-twin-mount',.15),show('alt-twin-barrel',.3),show('alt-twin-grip',.5)],
  move:[move('alt-twin-mount',[-.03,0,-.09]),move('alt-twin-barrel',[-.043,0,-.1],[0,0,-1.3]),move('alt-twin-grip',[0,-.1,-.02],[1.2,0,0])],
  pulse:[]}),
]);

export const altMorphFor=index=>ALT_MORPHS[Number.isInteger(index)&&index>=0&&index<ALT_MORPHS.length?index:0];
export function altMorphNodes(index){
 const table=altMorphFor(index),names=new Set();
 for(const list of [table.show,table.move,table.pulse])for(const entry of list||[])names.add(entry.node);
 return [...names];
}

// Build the hidden extra meshes for one weapon. Names are stable so the morph
// table can drive them without the view knowing any coordinates.
export function buildAltParts(type,g,ctx){
 if(!g||!ctx?.geo||!ctx?.material)return null;
 const index=Number.isInteger(type)&&type>=0&&type<ALT_MORPHS.length?type:0;
 const [w,h,len,mz,my,r]=chassisFor(index),top=my+h/2;
 const accent=ctx.material(ALT_FIRE[index].tracer,.45,.35,true),shell=ctx.palette?.dark??accent,trim=ctx.palette?.light??accent;
 const parts=[];
 const group=name=>{const p=new T.Group();p.name=name;g.add(p);return p;};
 const add=(parent,name,geometry,material=accent)=>{const n=new T.Mesh(geometry,material);n.name=name;n.userData.altPart=true;n.visible=false;parent.add(n);parts.push(n);return n;};
 const at=(n,x,y,z)=>{n.position.set(x,y,z);return n;};
 const tube=(parent,name,radius,length,segments=8,material=trim)=>add(parent,name,ctx.geo(`alt-bore|${radius}|${length}|${segments}`,()=>new T.CylinderGeometry(radius,radius,length,segments)),material);

 if(index===0){
  const p=group('alt-salvo');
  for(const [name,x] of [['alt-salvo-prong-l',-.03],['alt-salvo-prong-c',0],['alt-salvo-prong-r',.03]]){
   const n=tube(p,name,.011,.20,8);
   n.rotation.x=Math.PI/2;at(n,x,my,mz-.09);
  }
  at(add(p,'alt-salvo-fins',ctx.geo('alt-salvo-fins',()=>new T.BoxGeometry(.14,.045,.11)),shell),0,my,mz+.06);
 }else if(index===1){
  const p=group('alt-cluster');
  const hub=tube(p,'alt-cluster-hub',.052,.13,10,shell);hub.rotation.x=Math.PI/2;at(hub,0,my,mz-.04);
  for(const [name,angle] of [['alt-cluster-tube-a',-Math.PI/2],['alt-cluster-tube-b',Math.PI/6],['alt-cluster-tube-c',Math.PI*5/6]]){
   const n=tube(p,name,.028,.17,8);
   n.rotation.x=Math.PI/2;n.rotation.z=angle;at(n,0,my,mz-.07);
  }
 }else if(index===2){
  const p=group('alt-rail');
  for(let i=0;i<3;i++)at(add(p,`alt-rail-coil-${i}`,ctx.geo('alt-rail-coil',()=>new T.TorusGeometry(r+.016,.011,5,14))),0,my,mz);
 }else if(index===3){
  const p=group('alt-slug');
  // At rest the choke and ring hang tucked under the barrels, clear of the ADS
  // bore ray (the sight solver raycasts the model regardless of visibility); the
  // morph lifts them onto the bore and extends them into the single long bore.
  const choke=add(p,'alt-slug-choke',ctx.geo('alt-slug-choke',()=>new T.CylinderGeometry(.11,.185,.22,10)),trim);
  choke.rotation.x=Math.PI/2;at(choke,0,my-.17,mz+.07);
  at(add(p,'alt-slug-ring',ctx.geo('alt-slug-ring',()=>new T.TorusGeometry(.105,.012,5,14))),0,my-.17,mz-.06);
 }else if(index===4){
  const p=group('alt-mortar');
  const dome=add(p,'alt-mortar-dome',ctx.geo('alt-mortar-dome',()=>new T.SphereGeometry(.095,10,6)));
  at(dome,0,my,mz-.01);dome.scale.set(.62,.5,.62);
  at(add(p,'alt-mortar-ring',ctx.geo('alt-mortar-ring',()=>new T.TorusGeometry(.064,.014,5,14))),0,my,mz);
 }else if(index===5){
  const p=group('alt-mine'),drumY=my-.17,drumZ=-.25;
  const seal=add(p,'alt-mine-seal',ctx.geo('alt-mine-seal',()=>new T.CylinderGeometry(.132,.132,.035,24)),trim);
  seal.rotation.x=Math.PI/2;at(seal,0,drumY,drumZ+.11);
  at(add(p,'alt-mine-ring',ctx.geo('alt-mine-ring',()=>new T.TorusGeometry(.136,.012,5,14))),0,drumY,drumZ+.12);
  at(add(p,'alt-mine-eye',ctx.geo('alt-mine-eye',()=>new T.SphereGeometry(.038,8,6))),0,drumY+.035,drumZ+.14);
 }else if(index===6){
  const p=group('alt-chain');
  for(const [name,s] of [['alt-chain-prong-l',-1],['alt-chain-prong-r',1]]){
   const n=add(p,name,ctx.geo('alt-chain-prong',()=>new T.CylinderGeometry(.009,.009,.17,6)));
   at(n,s*.052,my+.02,mz+.01);n.rotation.z=s*1.15;
  }
  at(add(p,'alt-chain-bar',ctx.geo('alt-chain-bar',()=>new T.BoxGeometry(.11,.018,.018)),trim),0,my+.02,mz+.01);
 }else if(index===7){
  const p=group('alt-bomb');
  for(const [key,angle] of [['e',0],['n',Math.PI/2],['w',Math.PI],['s',-Math.PI/2]]){
   const n=add(p,`alt-bomb-petal-${key}`,ctx.geo('alt-bomb-petal',()=>new T.BoxGeometry(.10,.022,.15)),trim);
   at(n,Math.cos(angle)*.10,my+Math.sin(angle)*.10,mz-.02);n.rotation.z=angle;
  }
  at(add(p,'alt-bomb-ring',ctx.geo('alt-bomb-ring',()=>new T.TorusGeometry(.078,.012,5,14))),0,my,mz);
 }else if(index===8){
  const p=group('alt-double');
  at(add(p,'alt-double-cant-rear',ctx.geo('alt-cant-rear',()=>new T.BoxGeometry(.05,.032,.028)),trim),.05,top+.055,-.12);
  at(add(p,'alt-double-cant-front',ctx.geo('alt-cant-post',()=>new T.BoxGeometry(.012,.045,.012))),.05,top+.055,-.56);
 }else{
  const p=group('alt-twin');
  at(add(p,'alt-twin-mount',ctx.geo('alt-twin-mount',()=>new T.BoxGeometry(.05,.045,.11)),shell),-.02,my,mz+.05);
  const barrel=tube(p,'alt-twin-barrel',.021,.26,8);barrel.rotation.x=Math.PI/2;at(barrel,-.015,my,mz+.04);barrel.rotation.z=1.3;
  const grip=add(p,'alt-twin-grip',ctx.geo('alt-twin-grip',()=>new T.BoxGeometry(.03,.13,.045)),trim);
  at(grip,-.05,my-.02,mz+.02);grip.rotation.x=-1.2;
 }
 // Resolve every node the morph table references now, when the model is whole,
 // and snapshot its rest transform so t=0 always restores the authored pose.
 const table=ALT_MORPHS[index],rig={move:[],show:[],pulse:[]},seen=new Set();
 for(const list of [table.show,table.move,table.pulse])for(const entry of list||[])seen.add(entry.node);
 for(const name of seen){
  const node=g.getObjectByName(name);if(!node)continue;
  if(!node.userData.altRest)node.userData.altRest={x:node.position.x,y:node.position.y,z:node.position.z,rx:node.rotation.x,ry:node.rotation.y,rz:node.rotation.z,sx:node.scale.x,sy:node.scale.y,sz:node.scale.z};
 }
 for(const entry of table.move)rig.move.push({entry,node:g.getObjectByName(entry.node)});
 for(const entry of table.show)rig.show.push({entry,node:g.getObjectByName(entry.node)});
 for(const entry of table.pulse)rig.pulse.push({entry,node:g.getObjectByName(entry.node)});
 if(rig.pulse.length){rig.pulseFor=new Map();for(const {entry,node} of rig.pulse)if(node)rig.pulseFor.set(node,entry);}
 g.userData.altParts=parts;g.userData.altMorph=table;g.userData.altRig=rig;g.userData.altAmount=0;
 return parts;
}

// Blend the rig for `amount` in 0..1. `reduced` drops the pulse term (static
// parts) but still applies the full transform, so reduced motion reads the
// transformation without any shimmer.
export function applyAltMorph(weapon,type,amount,{reduced=false,time=0}={}){
 const table=weapon?.userData?.altMorph??altMorphFor(type);
 if(!weapon||!table)return 0;
 const t=Math.max(0,Math.min(1,Number(amount)||0));
 const rig=weapon.userData.altRig??{move:[],show:[],pulse:[]},pulses=rig.pulseFor;
 const pulseValue=pulses?.size&&!reduced?node=>{const spec=pulses.get(node);return spec?1+(Number(spec.amount)||0)*Math.sin((Number(time)||0)*(Number(spec.rate)||0)):1;}:_=>1;
 const pulsed=pulses?.size?new Set():null;
 for(const {entry,node} of rig.move){
  if(!node?.userData?.altRest)continue;
  const rest=node.userData.altRest,pos=entry.pos||[0,0,0],rot=entry.rot||[0,0,0],scale=entry.scale||[1,1,1],f=pulseValue(node);
  node.position.set(rest.x+pos[0]*t,rest.y+pos[1]*t,rest.z+pos[2]*t);
  node.rotation.set(rest.rx+rot[0]*t,rest.ry+rot[1]*t,rest.rz+rot[2]*t);
  node.scale.set(rest.sx*(1+(scale[0]-1)*t)*f,rest.sy*(1+(scale[1]-1)*t)*f,rest.sz*(1+(scale[2]-1)*t)*f);
  if(pulses?.has(node))pulsed.add(node);
 }
 for(const {entry,node} of rig.pulse){
  if(!node?.userData?.altRest||pulsed?.has(node))continue;
  const rest=node.userData.altRest,f=pulseValue(node);
  node.scale.set(rest.sx*f,rest.sy*f,rest.sz*f);
 }
 for(const {entry,node} of rig.show)if(node)node.visible=t>=(Number(entry.at)||0);
 return t;
}
