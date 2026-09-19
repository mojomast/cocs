// Bounded, physically connected chassis. All resource ownership stays in ctx.
// Coordinates: +Z stock, -Z muzzle; points agree with view's existing flash table.
import * as T from 'three';
import {attachIronSights,attachScope} from '../sights.mjs';
import {currentAssets} from '../effects-fx.mjs';
import {barrelGeometry,beveledBox,joinedGeometry,placedGeometry} from '../model-geometry.mjs';

export const CHASSIS = Object.freeze([
 // width, receiver height, receiver length, muzzle Z/Y, barrel radius, stock length
 [.17,.17,.47,-.85,.01,.032,.24], // pulse: carbine, box feed
 [.26,.23,.55,-.76,0,.115,.17],   // rocket: shouldered launch tube
 [.18,.16,.56,-1.04,.025,.035,.25],// rail: twin accelerator rails and cell
 [.32,.15,.42,-.82,.03,.066,.25], // scatter: twin breech barrels
 [.22,.20,.46,-.77,0,.063,.19],   // plasma: vented chamber and power pack
 [.23,.19,.43,-.93,.04,.087,.22], // grenade: revolver drum and long bore
 [.21,.18,.50,-.99,0,.038,.18],   // shock: fork emitter and capacitor
 [.27,.22,.51,-.99,0,.093,.20],   // flak: heavy breech, ammunition box
 [.15,.15,.54,-.84,.02,.027,.28], // marksman: slim receiver and precision barrel
 [.16,.16,.35,-.835,.05,.028,.16],// SMG: stamped receiver, telescoping stock
].map(Object.freeze));
export const chassisFor=type=>CHASSIS[type]||CHASSIS[0];

export function buildChassis(type,g,ctx){
 const {cylinder,ring,geo,palette}=ctx,{dark,light,glow}=palette;
 const [w,h,len,mz,my,r,stockLen]=chassisFor(type),top=my+h/2,front=-len;
 const part=(name)=>{const p=new T.Group();p.name=name;g.add(p);return p;};
 const named=(name,n)=>{n.name=name;return n;};
 const b=(p,w,h,d,x,y,z,m=dark)=>machinedBox(ctx,p,w,h,d,x,y,z,m);
 const tube=(p,rad,length,x,y,z,name='barrel')=>{
   const n=new T.Mesh(geo('lattice-turned-bore-24',()=>barrelGeometry(24)),light);
  n.rotation.x=Math.PI/2;n.scale.set(rad,length,rad);n.position.set(x,y,z);p.add(n);n.name=name;return n;
 };
 // Broad-radius energy chambers, slab-sided kinetic breeches, and a rounded
 // launch housing have deliberately different cross sections at the same rig
 // envelope. All sight/muzzle coordinates remain defined by CHASSIS.
 const roundness=[.025,.095,.018,.035,.065,.04,.045,.025,.018,.022][type]??.025;
 const receiver=new T.Mesh(geo(`lattice-receiver-${type}`,()=>beveledBox(w,h,len,roundness,2)),dark);
 receiver.name='receiver';receiver.position.set(0,my,-len/2);g.add(receiver);
 // Lower receiver bridges grip/feed rather than separate floating blocks.
 b(g,w*.74,.055,len*.65,0,my-h/2-.02,-len*.36);
 const grip=named('grip',b(g,.065,.18,.095,0,my-h/2-.09,-.035));grip.rotation.x=-.22;
 // Open trigger guard: no solid plate occupying the trigger space.
 b(g,.024,.018,.13,0,my-h/2-.15,-.12,light);
 b(g,.024,.12,.018,0,my-h/2-.085,-.18,light);
 b(g,.014,.065,.014,0,my-h/2-.05,-.105,light);
 const stock=part('stock');
 if(type===9){for(const x of [-.056,.056])b(stock,.018,.025,stockLen,x,my,.065,light);}
 else if(type===1){b(stock,.16,.065,stockLen,0,my-h/2-.025,.045);}
 else {b(stock,w*.50,h*.5,stockLen,0,my-.025,stockLen/2-.02);}
 // Shoulder pads are narrower than the receiver. A receiver-width rear slab
 // dominated the ADS view, especially on the twin-barrel scattergun.
 b(stock,Math.min(.12,w*.65),h*.85,.026,0,my-.04,stockLen-.025,light);
 if(type===8||type===2)b(stock,.08,.028,stockLen*.7,0,top-.025,stockLen*.45);

 const barrel=part(type===7?'flak-barrel':type===6?'shock-emitter':'barrel-assembly');
 const barrelLength=front-mz;
 for(const x of type===3?[-.12,.12]:[0]){
  tube(barrel,r,barrelLength,x,my,(front+mz)/2);
  ring(barrel,r+.006,.008,x,my,mz+.008,dark,0);
 }
 // Handguard wraps rear barrel but leaves muzzle exposed.
 if(type!==1&&type!==3){
  const guardLen=barrelLength*.48;
  for(const s of [-1,1])b(g,.022,h*.85,guardLen,s*(w/2-.012),my,front-guardLen/2);
  b(g,w,.025,guardLen,0,my-h*.45,front-guardLen/2);
 }
 // Distinct functional silhouette accents, not repeated cosmetic bolts.
 if(type===1){
  // Short rear exhaust stays coaxial with the launch tube but does not
  // project a giant false aiming aperture immediately in front of the eye.
  tube(g,.125,.14,0,my,.03,'rear-venturi');
  ring(g,.132,.010,0,my,.10,dark,0);
 }else if(type===2||type===6){
  for(const s of [-1,1]){
   b(barrel,.026,.065,barrelLength*.95,s*(type===2?.066:.09),my,front-barrelLength*.48,light);
   b(barrel,.012,.024,barrelLength*.70,s*(type===2?.066:.09),my+.038,front-barrelLength*.48,glow);
  }
 }else if(type===3){
  b(barrel,.30,.04,.17,0,my-.07,front-.075);
 }else if(type===4){
  for(const z of [front-.015,front-.085,front-.155])ring(barrel,r+.02,.012,0,my,z,dark,0);
 }else if(type===7){
  b(g,.10,.04,.23,0,my-h/2-.08,front+.09,light);
 }
 const feed=part('feed');
 if(type===5){
   const drum=named('grenade-drum',cylinder(feed,.125,.125,.23,0,my-.17,-.25,light,24));drum.rotation.x=Math.PI/2;
  // Connected center axle and one indexing latch, not individual floating rounds.
  b(g,.065,.08,.09,0,my-.08,-.25);
  b(feed,.028,.07,.05,.125,my-.15,-.25);
 }else if(type===1){
  b(feed,.085,.07,.16,-.10,my-.13,-.30,light); // breech latch, not a rocket outside muzzle
 }else if([2,4,6].includes(type)){
  b(feed,.12,.15,.18,0,my-h/2-.09,-.28,light);
  b(feed,.09,.025,.15,0,my-h/2-.17,-.28);
  b(feed,.012,.09,.11,.066,my-h/2-.08,-.28,glow);
 }else if(type===7){
  b(feed,.18,.19,.20,-.07,my-h/2-.10,-.28,light);
 }else if(type===3){
  b(feed,.23,.055,.13,0,my-.04,-.18,light); // extractors/breech block
 }else {
  const mag=b(feed,type===9?.055:.078,type===8?.13:.24,.105,0,my-h/2-(type===8?.075:.125),-.24,light);mag.rotation.x=type===9?-.14:-.09;
  b(feed,type===9?.063:.085,.025,.115,0,my-h/2-(type===8?.14:.25),-.25);
 }
 const bolt=part('bolt');
 b(g,.012,.05,.16,w/2+.004,my+.015,-len*.48,light); // carrier race
 b(bolt,.023,.032,.075,w/2+.013,my+.015,-len*.45);
 b(bolt,.047,.024,.025,w/2+.032,my+.015,-len*.38,light);
 addChassisMachining(type,g,barrel,feed,ctx);
 // Rebase rotating assemblies at their actual hinge/cell center, preserving
 // every mesh's rest position. Existing runtime rotations must not orbit origin.
 for(const [node,pivot] of type===2?[[feed,[0,my-h/2-.09,-.28]]]:type===3?[[barrel,[0,my,front]]]:[]){
  node.position.set(...pivot);for(const child of node.children)child.position.sub(node.position);
 }
 g.userData.parts={magazine:feed,bolt,barrel,...([2,4,6].includes(type)?{cell:feed}:{})};
 // Both sight stations are seated on a receiver/handguard-spanning rib. Its
 // height is below the line, not a tall riser compensating for body clipping.
 const rearZ=-.065,frontZ=front-.04,railLen=rearZ-frontZ+.09;
 const rail=b(g,.072,.024,railLen,0,top+.012,(rearZ+frontZ)/2,light);rail.name='sight-rail';
 // Physical supports bridge the rib down to the barrel at the front station.
 b(g,.062,Math.max(.018,top-my-r),.08,0,(top+my+r)/2,frontZ);
 const sightAssembly=part('sight-assembly');g.userData.sightAssembly=sightAssembly;
 if(type===2||type===8){
  g.userData.sights=attachScope(sightAssembly,ctx,{y:top+.079,z:-.055,length:.30,radius:.039,bell:.006,mount:true,mountY:top+.024,ringMaterial:light});
 }else{
  g.userData.sights=attachIronSights(sightAssembly,ctx,{
   rear:{y:top+.075,z:rearZ,width:.080,height:.045,gap:.030,mountY:top+.024},
   front:{y:top+.075,z:frontZ,width:.010,height:.050,depth:.014,mountY:top+.024},
  });
 }
 g.userData.chassis={type,receiver,top,muzzle:[0,my,mz]};
}

// Five meshes: receiver, muzzle/barrel, shoulder support, grip, feed. This is
// intentional authored simplification; no detailed viewmodel is built/discarded.
export function buildSimpleWeaponBody(type,g,ctx){
 // The live world-body hook predates custom geo in its context. Honor that
 // contract through its active asset scope, also allowing standalone builders.
 if(!ctx.geo)ctx={...ctx,geo:(key,make)=>{const assets=currentAssets();return assets?assets.geometry(key,make):make();}};
 const {geo,palette:{dark,light}}=ctx;
 const box=(...args)=>machinedBox(ctx,...args);
 const [w,h,len,mz,my,r,stockLen]=chassisFor(type);
 const named=(name,n)=>{n.name=name;return n;};
 named('receiver',box(g,w,h,len,0,my,-len/2,dark));
 const barrel=new T.Mesh(geo(`lattice-world-bore-${type}`,()=>{
  const make=x=>placedGeometry(barrelGeometry(10).scale(r,-mz-len,r),[x,0,0],[Math.PI/2,0,0]);
  return type===3?joinedGeometry([make(-.12),make(.12)]):make(0);
 }),light);barrel.position.set(0,my,(mz-len)/2);g.add(barrel);named('barrel',barrel);
 named('stock',box(g,w*.75,h*.65,stockLen,0,my-.03,stockLen/2-.01,dark));
 named('grip',box(g,.07,.19,.09,0,my-h/2-.08,-.03,dark));
 if(type===5){const feed=new T.Mesh(geo('lattice-world-drum',()=>new T.CylinderGeometry(.125,.125,.23,12).rotateX(Math.PI/2)),light);feed.position.set(0,my-h/2-.09,-.25);g.add(named('feed',feed));}
 else named('feed',box(g,type===7?.20:.09,type===1?.07:type===9?.27:.16,.13,type===7?-.07:0,my-h/2-.09,-.25,light));
 g.userData.simple=true;g.userData.muzzlePoint=[0,my,mz];
}

function machinedBox(ctx,parent,w,h,d,x,y,z,material){
 const radius=Math.min(.018,Math.min(w,h,d)*.22);
 const mesh=new T.Mesh(ctx.geo(`lattice-bevel|${w}|${h}|${d}`,()=>beveledBox(w,h,d,radius)),material);
 mesh.position.set(x,y,z);parent.add(mesh);return mesh;
}

// Two batched machined assemblies per weapon, not a draw call per fastener.
// Barrel hardware follows break-action hinges; feed flutes follow reloads.
function addChassisMachining(type,g,barrel,feed,ctx){
 const [w,h,len,mz,my,r]=chassisFor(type),{light,dark}=ctx.palette;
 const add=(parent,key,material,make)=>{
  const n=new T.Mesh(ctx.geo(`lattice-machining-${type}-${key}`,()=>joinedGeometry(make())),material);
  n.name=`machined-${key}`;parent.add(n);return n;
 };
 const plate=(w,h,d,p,rotation)=>placedGeometry(beveledBox(w,h,d),p,rotation);
 add(g,'receiver-inlays',light,()=>{
  const parts=[];
  for(const s of [-1,1]){
   // Slender inset side rails leave the resolved weapon finish dominant.
   parts.push(plate(.008,h*.17,len*.70,[s*(w/2+.002),my-h*.20,-len*.50]));
   for(const z of [-len*.26,-len*.72]){
    const pin=new T.CylinderGeometry(.010,.010,.012,8);pin.rotateZ(Math.PI/2);pin.translate(s*(w/2+.004),my+.022,z);parts.push(pin);
   }
  }
  return parts;
 });
 if(type===5){
  add(feed,'drum-flutes',dark,()=>Array.from({length:6},(_,i)=>{
   const a=i*Math.PI/3;
   return plate(.038,.014,.18,[Math.sin(a)*.122,my-.17+Math.cos(a)*.122,-.25],[0,0,-a]);
  }));
 }else{
  add(barrel,'barrel-hardware',type===2||type===6?light:dark,()=>{
   const parts=[],length=-mz-len;
   if(type===2){
    for(const s of [-1,1])for(let i=0;i<3;i++)parts.push(plate(.042,.09,.022,[s*.066,my,-len-length*(.20+i*.24)]));
   }else if(type===6){
    // Open C-shaped induction yokes distinguish the shock fork from the
    // rail weapon's rectangular accelerator blocks, without obscuring its bore.
    for(let i=0;i<3;i++){
     const yoke=new T.TorusGeometry(.085,.012,6,20,Math.PI*1.65);
     yoke.rotateZ(Math.PI*.675);yoke.translate(0,my,-len-length*(.20+i*.24));parts.push(yoke);
    }
   }else if(type===1||type===4||type===7){
    // Large launch-tube collars, plasma cooling ribs, heavy flak heat sink.
    const count=type===4?4:2;
    for(let i=0;i<count;i++){
     const ring=new T.TorusGeometry(r*(type===1?1.07:1.16),type===1?.014:.009,6,24);
     ring.translate(0,my,-len-length*(.20+i*(.60/Math.max(1,count-1))));parts.push(ring);
    }
   }else{
    // Ribbed pump saddle, precision barrel ferrules or compact vented shroud.
    for(let i=0;i<(type===3?4:3);i++){
     const width=type===3?.29:type===8?.070:.095;
     parts.push(plate(width,.018,.026,[0,my-r*.80,-len-length*(.15+i*.15)]));
    }
   }
   return parts;
  });
 }
}
