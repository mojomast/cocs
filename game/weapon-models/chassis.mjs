// Bounded, physically connected chassis. All resource ownership stays in ctx.
// Coordinates: +Z stock, -Z muzzle; points agree with view's existing flash table.
import * as T from 'three';
import {attachIronSights,attachScope} from '../sights.mjs';

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
 const {box,cylinder,ring,geo,palette}=ctx,{dark,light,glow}=palette;
 const [w,h,len,mz,my,r,stockLen]=chassisFor(type),top=my+h/2,front=-len;
 const part=(name)=>{const p=new T.Group();p.name=name;g.add(p);return p;};
 const named=(name,n)=>{n.name=name;return n;};
 const b=(p,w,h,d,x,y,z,m=dark)=>box(p,w,h,d,x,y,z,m);
 const tube=(p,rad,length,x,y,z,name='barrel')=>{
  // Unit open tube: shared across all ten weapons, never a capped cylinder
  // pretending to be a bore. Wall thickness comes from the muzzle lip.
  const n=new T.Mesh(geo('phase1-open-tube-12',()=>new T.CylinderGeometry(1,1,1,12,1,true)),light);
  n.rotation.x=Math.PI/2;n.scale.set(rad,length,rad);n.position.set(x,y,z);p.add(n);n.name=name;return n;
 };
 const receiver=named('receiver',b(g,w,h,len,0,my,-len/2));
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
  const drum=named('grenade-drum',cylinder(feed,.125,.125,.23,0,my-.17,-.25,light,12));drum.rotation.x=Math.PI/2;
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
 const {box,cylinder,palette:{dark,light}}=ctx;
 const [w,h,len,mz,my,r,stockLen]=chassisFor(type);
 const named=(name,n)=>{n.name=name;return n;};
 named('receiver',box(g,w,h,len,0,my,-len/2,dark));
 const barrel=type===3?box(g,.31,.12,-mz-len,0,my,(mz-len)/2,light):cylinder(g,r,r,-mz-len,0,my,(mz-len)/2,light,8);
 if(type!==3)barrel.rotation.x=Math.PI/2;named('barrel',barrel);
 named('stock',box(g,w*.75,h*.65,stockLen,0,my-.03,stockLen/2-.01,dark));
 named('grip',box(g,.07,.19,.09,0,my-h/2-.08,-.03,dark));
 named('feed',box(g,type===7?.20:type===5?.23:.09,type===1?.07:type===9?.27:.16,type===5?.23:.13,type===7?-.07:0,my-h/2-.09,-.25,light));
 g.userData.simple=true;g.userData.muzzlePoint=[0,my,mz];
}
