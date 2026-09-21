// Close-range, articulation-local hard-surface assemblies. Every assembly is a
// single vertex-coloured draw: paint, recesses, fasteners and exposed machinery
// share a material, while remaining actual bevelled geometry rather than decals.
import * as T from 'three';
import {armorPanel,joinedGeometry,placedGeometry} from './model-geometry.mjs';

export const OPERATOR_DETAIL_DISTANCE=5.8;
export const OPERATOR_DETAIL_PARTS=Object.freeze(['head','chest','waist','back','shoulder','arm','forearm','thigh','shin','guard','foot','hand']);
const outline=[[-1,-.75],[-.72,-1],[.72,-1],[1,-.75],[1,.75],[.72,1],[-.72,1],[-1,.75]];
const styles={chatgpt:0,claude:1,grok:2,meta:3,gemini:4,deepseek:5,mistral:6,kimi:7,qwen:8};

export function operatorDetailGeometry(id,part,{side=1,form,accent='#91b5b2'}={}){
 const pieces=[],style=styles[id]??0;
 const colors={metal:'#829798',edge:'#b9c5bf',dark:'#17262c',recess:'#070f15',rubber:'#303a40',copper:'#af825b',paint:new T.Color(accent).lerp(new T.Color('#d1dbce'),.30),accent:new T.Color(accent).lerp(new T.Color('#3d626c'),.35)};
 const add=(geometry,color='metal',position,rotation)=>{
  placedGeometry(geometry,position,rotation);
  const c=new T.Color(colors[color]??color),a=new Uint8Array(geometry.attributes.position.count*3);
  // A small, flat material palette needs normalized bytes, not twelve bytes
  // per vertex. Positions and normals retain full floating-point precision.
  for(let i=0;i<a.length;i+=3){a[i]=Math.round(c.r*255);a[i+1]=Math.round(c.g*255);a[i+2]=Math.round(c.b*255);}
  geometry.setAttribute('color',new T.BufferAttribute(a,3,true));pieces.push(geometry);
 };
 const box=(w,h,d,p,color='metal',rot)=>add(new T.BoxGeometry(w,h,d),color,p,rot);
 const plate=(w,h,d,p,color='paint',rot)=>add(armorPanel(outline.map(([x,y])=>[x*w/2,y*h/2]),d,{steps:1,bevel:.12}),color,p,rot);
 const bolt=(x,y,z,r=.007,rot)=>{
  add(new T.CylinderGeometry(r,r,r*.65,6,1),'edge',[x,y,z],rot??[Math.PI/2,0,0]);
  box(r*.85,r*.20,.0018,[x,y,z-r*.36],'recess');
 };
 const ring=(r,t,p,color='metal',rot)=>add(new T.TorusGeometry(r,t,5,20),color,p,rot);
 const cable=(points,r=.005,color='copper')=>add(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),12,r,5,false),color);
 const vent=(x,y,z,w,h,count=5)=>{
  plate(w+.012,h+.012,.008,[x,y,z+.004],'metal');
  box(w,h,.009,[x,y,z-.002],'recess');
  for(let i=0;i<count;i++)box(w*.90,.004,.007,[x,y-h*.4+i*h*.8/(count-1),z-.009],'metal',[.3,0,0]);
 };
 const panel=(x,y,z,w,h)=>{
  // The dark gasket, recessed face and proud rim read at combat scale too.
  plate(w,h,.009,[x,y,z],'dark');
  plate(w*.87,h*.87,.010,[x,y,z-.005],'paint');
  for(const s of [-1,1])bolt(x+s*w*.32,y+h*.31,z-.014,.005);
 };
 if(part==='head'){
  const f=form,w=f.width,d=f.depth;
  // Brow laminations and a machined face seal, clear of the existing optics.
  for(const s of [-1,1]){
   plate(w*.70,.024,.028,[s*w*.49,.058+f.visor*.35,-d*.92],'metal',[0,s*.20,s*.04]);
   bolt(s*w*.70,.058+f.visor*.35,-d*.99,.006);
   plate(.053,.070,.026,[s*w*.79,-.079,-d*.80],'paint',[0,s*.20,s*.15]);
   vent(s*w*.76,-.081,-d*.90,.031,.034,4);
   // Side comms concentric hubs, locking collars and recessed service sockets.
   ring(.034,.008,[s*(w+.020),.018,.005],'dark',[0,Math.PI/2,0]);
   ring(.023,.005,[s*(w+.027),.018,.005],'metal',[0,Math.PI/2,0]);
   for(let i=0;i<4;i++){
    const a=i*Math.PI/2;
    add(new T.CylinderGeometry(.004,.004,.004,6),'edge',[s*(w+.030),.018+Math.sin(a)*.027,.005+Math.cos(a)*.027],[0,0,Math.PI/2]);
   }
   cable([[s*w*.83,-.103,-d*.47],[s*w*.97,-.122,-.02],[s*w*.80,-.068,.10]],.005,'rubber');
  }
  // Individual face architecture, not the same detailed mask nine times.
  if(id==='deepseek'){
   for(const s of [-1,1]){ring(.034,.006,[s*.049,.018,-d*1.12],'metal');bolt(s*.078,-.034,-d*1.10);}
   vent(0,-.105,-.216,.041,.037,5);
  }else if(id==='grok'){
   ring(.024,.006,[.093,.016,-d*1.115],'edge');
   cable([[-.114,-.035,-.14],[-.12,-.10,-.155],[-.035,-.139,-.17]],.007,'copper');
  }else if(id==='kimi'){
   for(const [x,r] of [[0,.031],[-.07,.018],[.07,.018]])ring(r,.004,[x,x===0?.022:.028,-d*1.115],'metal');
   plate(.067,.020,.014,[0,-.11,-d*.88],'edge');
  }else if(id==='gemini'){
   for(const s of [-1,1])ring(.035,.005,[s*.071,.022,-d*1.115],'metal');
   plate(.018,.068,.014,[0,-.050,-d*1.05],'metal');
  }else if(id==='qwen'){
   for(let i=0;i<3;i++)panel(0,-.063-i*.026,-d*.96+i*.012,.14-i*.025,.024);
  }else{
   vent(0,-.101,-d*.95,w*(id==='meta'?1.0:.68),.039,id==='mistral'?3:5);
   for(const s of [-1,1])bolt(s*w*.33,-.132,-d*.76,.005);
  }
  // Split crown service strips are placed on the sloping front, below the
  // existing head envelope; no antenna or hitbox height extension.
  for(const s of [-1,1])box(.006,.046,.013,[s*.052,.099,-d*.76],'dark',[.5,0,0]);
 }else if(part==='chest'){
  const wide=['claude','meta','qwen'].includes(id),x=wide?.177:.148;
  for(const s of [-1,1]){
   panel(s*x,.079,-.137,.072,.096);
   // Collar mounting bolts and slim perimeter armor preserve the reactor view.
   bolt(s*.095,.173,-.110,.008);
   plate(.096,.026,.027,[s*.116,.160,-.121],'edge',[0,0,s*.13]);
   vent(s*(x+.004),-.091,-.155,.045,.063,5);
   cable([[s*.177,.072,-.139],[s*.201,-.025,-.126],[s*.143,-.170,-.108]],.006,style%2?'rubber':'copper');
   for(let i=0;i<3;i++)bolt(s*(.09+i*.027),-.194+i*.014,-.10-i*.010,.005);
  }
  if(id==='meta'||id==='deepseek')for(const s of id==='meta'?[-1,1]:[0]){
   const radius=id==='meta'?.052:.092,x=s*.115;
   ring(radius,.005,[x,-.02,-.247],'metal');
   for(let i=0;i<8;i++){const a=i*Math.PI/4;bolt(x+Math.cos(a)*radius,-.02+Math.sin(a)*radius,-.252,.004);}
  }
  else if(id==='chatgpt'||id==='kimi'){
   ring(.069,.005,[0,-.043,-.244],'metal');
   for(let i=0;i<8;i++){const a=i*Math.PI/4;bolt(Math.cos(a)*.082,-.043+Math.sin(a)*.082,-.227,.004);}
  }
  if(['chatgpt','deepseek','kimi','meta'].includes(id)){
   for(const x of id==='meta'?[-.115,.115]:[0]){
    const y=id==='meta'||id==='deepseek'?-.02:-.043,r=id==='deepseek'?.062:id==='meta'?.042:.036;
    ring(r,.003,[x,y,-.256],'dark');
    ring(r*.54,.003,[x,y,-.257],'metal');
    for(let i=0;i<4;i++){
     const a=i*Math.PI/2;
     box(.017,.006,.005,[x+Math.cos(a)*r*.83,y+Math.sin(a)*r*.83,-.257],'metal',[0,0,a]);
    }
   }
  }
  // Small inset instrument readout with three mechanically separated cells.
  plate(.067,.027,.012,[.072,-.147,-.184],'dark');
  for(let i=0;i<3;i++)box(.010,.009,.002,[.052+i*.019,-.147,-.192],i===2?'copper':'accent');
 }else if(part==='waist'){
  plate(.146,.238,.018,[0,-.044,-.151],'dark');
  for(let i=0;i<6;i++){
   const width=.125+Math.abs(i-2.5)*.012;
   plate(width,.018,.018,[0,-.13+i*.031,-.168],'metal');
   box(width*.73,.006,.005,[0,-.13+i*.031,-.179],'dark');
  }
  for(const s of [-1,1]){
   cable([[s*.091,-.18,-.118],[s*.093,-.04,-.154],[s*.141,.096,-.147]],.008,'rubber');
   for(let i=0;i<3;i++)plate(.024,.012,.021,[s*(.091+i*.011),-.10+i*.064,-.154],'metal');
  }
 }else if(part==='back'){
  // Rear service pack: radiator, screw-down battery cover and two actual cable
  // runs. Rotate the assembly once so its exposed surfaces face rearward.
  panel(0,.01,-.016,.24,.23);vent(0,.04,-.032,.173,.10,8);
  for(const s of [-1,1]){
   plate(.043,.21,.036,[s*.153,.01,-.016],'metal');
   for(let i=0;i<5;i++)box(.033,.011,.027,[s*.153,-.06+i*.036,-.038],'dark');
   cable([[s*.135,.11,-.01],[s*.185,.065,-.035],[s*.181,-.115,-.02],[s*.105,-.153,0]],.010,'rubber');
   bolt(s*.086,-.081,-.031,.007);
  }
 }else if(part==='shoulder'){
  const x=side*.017;
  // Offset inspection plate and two front quarter fasteners remain inside the
  // old shoulder depth. Kimi's ring stays open rather than becoming a badge.
  if(id!=='kimi'){
   panel(x,.02,-.115,id==='meta'?.21:.13,.070);
   for(const s of [-1,1])bolt(x+s*.057,.049,-.125,.007);
   for(let i=0;i<3;i++)box(.021,.005,.003,[x+side*.028,-.004+i*.012,-.128],'dark');
  }else{
   for(const s of [-1,1])ring(.018,.006,[s*.11,0,-.031],'metal');
  }
  for(let i=0;i<3;i++)plate(.027,.012,.04,[side*(.07+i*.022),-.04,-.043],'metal',[0,0,side*.2]);
 }else if(part==='hand'){
  // Segmented fingers, knuckle rollers and a thumb oppose the weapon grip.
  for(let i=0;i<4;i++){
   const x=(i-1.5)*.021;
   for(let k=0;k<2;k++)plate(.017,.024,.024,[x,-.01-k*.026,-.068],'metal');
   ring(.008,.003,[x,.008,-.083],'dark');
  }
  plate(.028,.046,.026,[side*.052,-.011,-.009],'paint',[0,0,side*-.5]);
  panel(0,.027,-.043,.063,.032);
 }else if(part==='guard'){
  panel(0,.025,-.032,.069,.106);
  vent(0,-.055,-.033,.040,.028,3);
  for(const s of [-1,1])box(.004,.095,.004,[s*.035,.018,-.044],'metal');
  for(let i=0;i<3;i++)box(.021,.004,.002,[.007,-.001+i*.017,-.049],i===2?'copper':'dark');
 }else if(part==='foot'){
  for(const s of [-1,1]){
   plate(.070,.058,.011,[s*.048,.067,-.035],'metal',[Math.PI/2,0,0]);
   bolt(s*.047,.052,-.103,.005);
  }
  for(let i=0;i<4;i++)box(.164,.011,.005,[0,-.025+i*.014,-.117],'dark');
  for(const s of [-1,1])box(.009,.041,.082,[s*.090,.008,.015],'rubber');
 }else{
  const leg=part==='thigh'||part==='shin',r=part==='thigh'?.10:part==='arm'||part==='shin'?.082:.068;
  const length=part==='thigh'?.45:part==='shin'?.394:part==='arm'?.364:.326;
  const w=r*(id==='meta'?1.32:1.08),z=-r+.018;
  panel(0,length*.10,z,w,length*.32);
  // Slim front face rails with visible endcaps, fasteners, cross-members and
  // knee/elbow inspection grilles. All stay inside the existing limb capsule.
  for(const s of [-1,1]){
   box(.007,length*.52,.009,[s*r*.66,0,-r*.60],'metal');
   for(const y of [-length*.22,length*.22])bolt(s*r*.63,y,-r*.70,.005);
  }
  vent(0,-length*(id==='deepseek'&&part==='arm'?.35:.23),-r+.014,w*.66,length*.15,leg?4:3);
  // Side hydraulic line sits beside the armor, not floating above its face.
  cable([[side*r*.73,-length*.23,.008],[side*r*.88,0,-.017],[side*r*.69,length*.21,.011]],.005,'rubber');
  for(const y of [-length*.17,length*.17])plate(.019,.015,.021,[side*r*.73,y,.003],'copper');
  if(leg){
   plate(w*.83,.036,.018,[0,length*.34,-r*.45],'edge');
   for(const s of [-1,1])bolt(s*w*.28,length*.34,-r*.465,.004);
  }
 }
 const geometry=joinedGeometry(pieces);geometry.name=`${id}-${part}-precision-assembly`;
 return geometry;
}

// A scaled menu mannequin should keep the same screen-size detail transition
// as its life-sized world counterpart. Hysteresis stops rapid LOD flickering.
export class OperatorDetailLOD extends T.LOD{
 update(camera){
  const scale=this.matrixWorld.getMaxScaleOnAxis();
  this.levels[1].distance=OPERATOR_DETAIL_DISTANCE*scale;
  super.update(camera);
 }
}
