import * as T from 'three';
import {hashUnit} from './deaths.mjs';
import {weaponPose,weaponInspect} from './structures.mjs';

// Shared per-model resources. Registrations are skipped by disposeObject and
// released exactly once when the owning ArenaView is disposed.
export class ModelAssets{
 constructor(){this.resources=new Set();this.materials=new Map();this.geometries=new Map();}
 register(resource){this.resources.add(resource);return resource;}
 material(key,make){let value=this.materials.get(key);if(!value){value=make();this.materials.set(key,value);this.register(value);}return value;}
 geometry(key,make){let value=this.geometries.get(key);if(!value){value=make();this.geometries.set(key,value);this.register(value);}return value;}
 dispose(){for(const resource of this.resources)resource.dispose();this.resources.clear();this.materials.clear();this.geometries.clear();}
}

let activeAssets=null;
export const currentAssets=()=>activeAssets;
export function withAssets(assets,run){const previous=activeAssets;activeAssets=assets??null;try{return run();}finally{activeAssets=previous;}}

// Presentation-only camera impulse; the authoritative aim ray never reads it.
export class CameraShake{
 constructor(){this.magnitude=0;this.seed=0;}
 reset(){this.magnitude=0;}
 add(amount){if(!(amount>0))return;this.magnitude=Math.min(1.4,this.magnitude+amount);this.seed=(this.seed+1)%97;}
 update(dt){this.magnitude*=Math.exp(-Math.max(0,dt||0)/.25);if(this.magnitude<.001)this.magnitude=0;}
 apply(camera,time,reduced,intensity=1){if(reduced||this.magnitude<=0||!camera)return;const scale=Math.max(0,Math.min(1.5,Number(intensity)||0));if(scale<=0)return;const m=this.magnitude*scale,t=(time||0)*38+this.seed*13.7;camera.position.x+=Math.sin(t)*m*.05;camera.position.y+=Math.cos(t*1.31)*m*.045;camera.rotation.z+=Math.sin(t*1.7)*m*.028;camera.rotation.x+=Math.cos(t*1.13)*m*.014;}
}

// Fixed pool of point lights so automatic fire never allocates per shot.
export class MuzzleLightPool{
 constructor(scene,count=2,intensity=3.4,distance=7){this.scene=scene;this.intensity=intensity;this.lights=[];this.index=0;for(let i=0;i<count;i++){const light=new T.PointLight('#ffffff',0,distance,2);light.visible=false;light.userData.remaining=0;light.userData.total=1;scene.add(light);this.lights.push(light);}}
 flash(color,position,life=.06){if(!this.lights.length)return;const light=this.lights[this.index=(this.index+1)%this.lights.length];light.color.set(color);light.userData.remaining=life;light.userData.total=life;light.intensity=this.intensity;light.visible=true;if(position)light.position.set(position.x,position.y,position.z);}
 update(dt){for(const light of this.lights){if(light.userData.remaining<=0){if(light.visible){light.visible=false;light.intensity=0;}continue;}light.userData.remaining-=dt;if(light.userData.remaining<=0){light.visible=false;light.intensity=0;}else light.intensity=this.intensity*(light.userData.remaining/light.userData.total);}}
 dispose(){for(const light of this.lights){light.parent?.remove(light);light.dispose?.();}this.lights=[];}
}

// Screen-space red vignette parented to the camera. Reduced motion keeps a
// static tint; the pulsing term is dropped.
export class LowHealthOverlay{
 constructor(camera,color='#ff2b3d'){this.mesh=null;this.opacity=0;if(!camera)return;const material=new T.ShaderMaterial({uniforms:{uColor:{value:new T.Color(color)},uOpacity:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vUv;uniform vec3 uColor;uniform float uOpacity;void main(){float d=distance(vUv,vec2(0.5));float v=smoothstep(0.18,0.72,d);gl_FragColor=vec4(uColor,v*uOpacity);}',transparent:true,depthTest:false,depthWrite:false,toneMapped:false});const mesh=new T.Mesh(new T.PlaneGeometry(1,1),material);mesh.frustumCulled=false;mesh.renderOrder=999;mesh.visible=false;mesh.position.z=-.11;camera.add(mesh);this.mesh=mesh;}
 update(active,time,dt,reduced,camera){this.active=active===true;if(!this.mesh)return;const step=Math.max(.0001,Math.min(dt||0,.1));const pulse=reduced?0:Math.sin((time||0)*5.5)*.5+.5;const target=this.active?.1+pulse*.16:0;this.opacity+=(target-this.opacity)*(1-Math.exp(-9*step));this.mesh.material.uniforms.uOpacity.value=this.opacity;this.mesh.visible=this.opacity>.002;if(this.mesh.visible&&camera){const half=Math.tan((camera.fov||82)*Math.PI/360)*.11,height=half*2,width=height*(camera.aspect||1);this.mesh.scale.set(width,height,1);}}
 dispose(){if(!this.mesh)return;this.mesh.parent?.remove(this.mesh);this.mesh.geometry.dispose();this.mesh.material.dispose();this.mesh=null;}
}

// Quake 2 style rail beam: an additive spiral-textured cylinder with a bright
// core and an expanding muzzle ring. The diagonal strip texture scrolls along
// the beam so it reads as a spinning coil. Generated once per pool.
function makeRailStrip(){
 if(typeof document==='undefined')return null;
 const size=128,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
 const ctx=canvas.getContext('2d'),img=ctx.createImageData(size,size),data=img.data;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size,v=y/size;
  const coil=Math.max(0,Math.sin(u*Math.PI*2+v*Math.PI*4));
  const glow=Math.pow(Math.max(0,Math.cos(u*Math.PI*4)),8);
  const a=Math.min(1,coil*.9+glow*.55);
  const i=(y*size+x)*4;
  data[i]=236;data[i+1]=248;data[i+2]=255;data[i+3]=Math.round(255*a);
 }
 ctx.putImageData(img,0,0);
 const tex=new T.CanvasTexture(canvas);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.needsUpdate=true;return tex;
}

export class RailBeamPool{
 constructor(scene,limit=8){
  this.scene=scene;this.limit=limit;this.slots=[];this.serial=0;this.texture=makeRailStrip();
  this.beamGeo=new T.CylinderGeometry(1,1,1,14,1,true).rotateX(Math.PI/2).translate(0,0,.5);
  this.coreGeo=new T.CylinderGeometry(1,1,1,8,1,true).rotateX(Math.PI/2).translate(0,0,.5);
  this.ringGeo=new T.TorusGeometry(1,.16,8,24);
  this.axis=new T.Vector3(0,0,1);this.dir=new T.Vector3();this.from=new T.Vector3();this.to=new T.Vector3();this.quat=new T.Quaternion();
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit)return this.slots.slice().sort((a,b)=>a.serial-b.serial)[0];
  const beamMat=new T.MeshBasicMaterial({color:'#9fe8ff',transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,opacity:.9});
  if(this.texture){const map=this.texture.clone();map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.set(1,4);map.needsUpdate=true;beamMat.map=map;}
  const coreMat=new T.MeshBasicMaterial({color:'#ffffff',transparent:true,depthWrite:false,blending:T.AdditiveBlending,opacity:.95});
  const ringMat=new T.MeshBasicMaterial({color:'#9fe8ff',transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,opacity:.9});
  const beam=new T.Mesh(this.beamGeo,beamMat),core=new T.Mesh(this.coreGeo,coreMat),ring=new T.Mesh(this.ringGeo,ringMat);
  for(const mesh of [beam,core,ring]){mesh.visible=false;mesh.frustumCulled=false;this.scene.add(mesh);}
  slot={beam,core,ring,beamMat,coreMat,ringMat,active:false,serial:0,life:0,total:1};
  this.slots.push(slot);return slot;
 }
 spawn(from,to,color='#9fe8ff',reduced=false){
  if(!from||!to)return null;
  const slot=this._slot();if(!slot)return null;
  this.from.set(from.x||0,from.y||0,from.z||0);this.to.set(to.x||0,to.y||0,to.z||0);
  this.dir.subVectors(this.to,this.from);const len=this.dir.length()||.001;this.dir.normalize();
  this.quat.setFromUnitVectors(this.axis,this.dir);
  const width=reduced?.07:.12;
  slot.beam.position.copy(this.from);slot.beam.quaternion.copy(this.quat);slot.beam.scale.set(width,width,len);
  slot.core.position.copy(this.from);slot.core.quaternion.copy(this.quat);slot.core.scale.set(width*.26,width*.26,len);
  slot.ring.position.copy(this.from);slot.ring.quaternion.copy(this.quat);slot.ring.scale.setScalar(.16);
  slot.beamMat.color.set(color);slot.ringMat.color.set(color);slot.coreMat.color.set(reduced?'#dff6ff':'#ffffff');
  if(slot.beamMat.map){slot.beamMat.map.repeat.set(1,Math.max(2,len/1.4));slot.beamMat.map.offset.set(0,0);}
  slot.active=true;slot.serial=++this.serial;slot.life=slot.total=reduced?.2:.45;
  slot.beam.visible=slot.core.visible=slot.ring.visible=true;return slot;
 }
 update(dt){for(const s of this.slots){if(!s.active)continue;s.life-=dt;if(s.life<=0){s.active=false;s.beam.visible=s.core.visible=s.ring.visible=false;continue;}const t=1-s.life/s.total,fade=1-t;s.beamMat.opacity=.95*fade;s.coreMat.opacity=.95*(1-t*.6);s.ringMat.opacity=.9*fade;if(s.beamMat.map)s.beamMat.map.offset.y=-t*3.2;s.ring.scale.setScalar(.16*(1+t*2.4));}}
 clear(){for(const s of this.slots){s.active=false;s.beam.visible=s.core.visible=s.ring.visible=false;}}
 dispose(){for(const s of this.slots){this.scene.remove(s.beam,s.core,s.ring);s.beamMat.map?.dispose();s.beamMat.dispose();s.coreMat.dispose();s.ringMat.dispose();}this.slots=[];this.beamGeo.dispose();this.coreGeo.dispose();this.ringGeo.dispose();this.texture?.dispose();this.texture=null;}
}

// Flat impact/scorch decals: one shared quad, a fixed slot pool and per-slot
// opacity so overlapping marks fade independently. The view creates this only
// for WebGL and skips it on the CPU renderer to keep its draw-call budget flat.
export class DecalPool{
 constructor(scene,limit=18){
  this.scene=scene;this.limit=limit;this.slots=[];this.serial=0;
  this.geometry=new T.PlaneGeometry(1,1);
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);return this.slots[0];}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false,side:T.DoubleSide});
  const obj=new T.Mesh(this.geometry,material);obj.visible=false;obj.frustumCulled=false;obj.renderOrder=3;
  obj.userData.decal=true;this.scene.add(obj);slot={obj,material,active:false,serial:0,size:1};this.slots.push(slot);return slot;
 }
 spawn(pos,{color='#171310',size=.32,life=5.5,reduced=false,seed=0}={}){
  if(!pos)return false;
  const slot=this._slot();if(!slot)return false;
  const yaw=hashUnit(seed||0)*Math.PI*2,scale=Math.max(.05,size);
  slot.obj.material.color.set(color);
  slot.obj.material.opacity=reduced?.46:.58;
  slot.obj.visible=true;
  slot.obj.position.set(pos.x||0,(pos.y||0)+.025,pos.z||0);
  slot.obj.rotation.set(-Math.PI/2,yaw,0);
  slot.obj.scale.setScalar(scale);
  slot.active=true;slot.serial=++this.serial;slot.size=scale;slot.life=slot.total=Math.max(.2,life);
  return true;
 }
 update(dt){
  for(const slot of this.slots){
   if(!slot.active)continue;
   slot.life-=dt;
   if(slot.life<=0){slot.active=false;slot.obj.visible=false;continue;}
   const t=1-slot.life/slot.total;
   slot.obj.material.opacity=Math.min(.58,slot.life/slot.total*.75);
   slot.obj.scale.setScalar(slot.size*(1+t*.14));
  }
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.obj.visible=false;}}
 dispose(){for(const slot of this.slots){this.scene.remove(slot.obj);slot.material?.dispose();slot.material=null;}this.slots=[];this.geometry?.dispose();this.geometry=null;}
}

// Pooled death debris: flung limb/body chunks and lingering ground splats.
// Slots are reused oldest-first so a burst of deaths cannot grow GPU resources.
const GIB_GRAVITY=26;
export class DeathPool{
 constructor(scene,limit=64,splatLimit=16){
  this.scene=scene;this.limit=limit;this.splatLimit=splatLimit;this.slots=[];this.splats=[];this.serial=0;
  this.limb=new T.BoxGeometry(.17,.5,.17);
  this.chunk=new T.IcosahedronGeometry(.2,0);
  this.splatGeo=new T.CircleGeometry(.62,14).rotateX(-Math.PI/2);
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);slot=this.slots[0];return slot;}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false});
  const obj=new T.Mesh(this.chunk,material);obj.visible=false;obj.frustumCulled=false;this.scene.add(obj);
  slot={obj,material,active:false};this.slots.push(slot);return slot;
 }
 spawn(pos,{pieces=6,force=6,color='#8f1a1a',reduced=false,seed=0,spin=1,splay=.5}={}){
  if(!pos)return 0;
  const count=Math.max(0,reduced?Math.min(2,pieces):pieces),baseY=Number.isFinite(pos.y)?pos.y+.9:.9;
  const active=this.slots.reduce((n,slot)=>n+(slot.active?1:0),0),budget=Math.max(0,Math.min(count,this.limit-active));
  const tumble=Math.max(-2,Math.min(2,Number.isFinite(spin)?spin:1)),spread=Math.max(0,Math.min(1,Number.isFinite(splay)?splay:.5));
  let spawned=0;
  for(let i=0;i<budget;i++){
   const slot=this._slot();if(!slot)break;
   const angle=hashUnit(seed,i*.37)*Math.PI*2,elevation=.25+hashUnit(seed,i*.37+1)*.75,speed=force*(.55+hashUnit(seed,i*.37+2)*.9);
   slot.obj.geometry=i%3===0?this.chunk:this.limb;
   slot.material.color.set(color);slot.material.opacity=1;
   slot.obj.visible=true;slot.obj.position.set(pos.x,baseY,pos.z);
   slot.obj.rotation.set(angle*(.6+spread*.8),elevation*3,angle*.5);
   slot.obj.scale.setScalar((.7+hashUnit(seed,i)*.8)*(.85+spread*.3));
   slot.velocity={x:Math.cos(angle)*speed*(.75+spread*.5),y:speed*(.5+elevation*spread),z:Math.sin(angle)*speed*(.75+spread*.5)};
   slot.spin={x:(hashUnit(seed,i+1)-.5)*14*tumble,y:(hashUnit(seed,i+2)-.5)*14*tumble,z:(hashUnit(seed,i+3)-.5)*14*tumble};
   slot.active=true;slot.serial=++this.serial;slot.life=slot.total=1.2+hashUnit(seed,i+4)*.9;
   spawned++;
  }
  return spawned;
 }
 splat(pos,{color='#5c0d0d',reduced=false,seed=0,life=reduced?2.5:6}={}){
  if(!pos)return false;
  let slot=this.splats.find(s=>!s.active);
  if(!slot){
   if(this.splats.length>=this.splatLimit){this.splats.sort((a,b)=>a.serial-b.serial);slot=this.splats[0];}
   else{const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false});const obj=new T.Mesh(this.splatGeo,material);obj.visible=false;obj.frustumCulled=false;obj.renderOrder=4;this.scene.add(obj);slot={obj,material,active:false};this.splats.push(slot);}
  }
  slot.obj.material.color.set(color);slot.obj.visible=true;
  slot.obj.position.set(pos.x,(Number.isFinite(pos.y)?pos.y:0)+.03,pos.z);
  slot.obj.rotation.y=hashUnit(seed)*Math.PI*2;slot.obj.scale.setScalar(.7+hashUnit(seed,1)*.9);
  slot.active=true;slot.serial=++this.serial;slot.life=slot.total=life;return true;
 }
 update(dt){
  for(const slot of this.slots){
   if(!slot.active)continue;
   slot.life-=dt;
   if(slot.life<=0){slot.active=false;slot.obj.visible=false;continue;}
   const v=slot.velocity;v.y-=GIB_GRAVITY*dt;
   slot.obj.position.x+=v.x*dt;slot.obj.position.y+=v.y*dt;slot.obj.position.z+=v.z*dt;
   slot.obj.rotation.x+=slot.spin.x*dt;slot.obj.rotation.y+=slot.spin.y*dt;slot.obj.rotation.z+=slot.spin.z*dt;
   slot.material.opacity=Math.min(1,slot.life/(slot.total*.35));
  }
  for(const slot of this.splats){
   if(!slot.active)continue;
   slot.life-=dt;
   if(slot.life<=0){slot.active=false;slot.obj.visible=false;continue;}
   slot.material.opacity=Math.min(.6,slot.life*.35);
  }
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.obj.visible=false;}for(const slot of this.splats){slot.active=false;slot.obj.visible=false;}}
 dispose(){
  for(const slot of this.slots){this.scene.remove(slot.obj);slot.material.dispose();}this.slots=[];
  for(const slot of this.splats){this.scene.remove(slot.obj);slot.material.dispose();}this.splats=[];
  this.limb.dispose();this.chunk.dispose();this.splatGeo.dispose();
 }
}

// Pooled, directional hit feedback for non-lethal damage. WebGL-only and
// presentation-only: it never touches the simulation. A hit spawns a short
// spray of blood/spark motes thrown along the incoming direction, all drawn
// from a fixed slot budget so a firefight cannot grow GPU resources. The
// companion flinch envelope is applied by the view through the actor rig's
// existing `hit` channel.
export class HitReactionFX{
 constructor(scene,limit=24){
  this.scene=scene;this.limit=Math.max(0,limit|0);this.slots=[];this.serial=0;
  this.mote=new T.IcosahedronGeometry(.05,0);
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);return this.slots[0]||null;}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false});
  const obj=new T.Mesh(this.mote,material);obj.visible=false;obj.frustumCulled=false;this.scene.add(obj);
  slot={obj,material,active:false};this.slots.push(slot);return slot;
 }
 // Spawn from a pure hitReaction plan. Returns the number of motes emitted.
 spawn(pos,reaction,{reduced=false}={}){
  if(!pos||!reaction||!this.limit)return 0;
  const count=Math.max(0,reduced?Math.min(2,reaction.count):reaction.count);
  const baseY=Number.isFinite(pos.y)?pos.y:0;
  let spawned=0;
  for(let i=0;i<count;i++){
   const slot=this._slot();if(!slot)break;
   const j=hashUnit(reaction.seed,i*.61+1),j2=hashUnit(reaction.seed,i*.61+2),j3=hashUnit(reaction.seed,i*.61+3);
   const spread=.7+reaction.strength;
   slot.obj.visible=true;slot.obj.material.color.set(reaction.color);slot.obj.material.opacity=1;
   slot.obj.position.set(Number.isFinite(pos.x)?pos.x:0,baseY,Number.isFinite(pos.z)?pos.z:0);
   slot.obj.scale.setScalar(.5+j*.9);
   slot.velocity={x:(reaction.sprayX*.6+(j-.5)*spread)*3.2,y:(.4+j2*1.4)*3.2,z:(reaction.sprayZ*.6+(j3-.5)*spread)*3.2};
   slot.active=true;slot.serial=++this.serial;slot.life=slot.total=.35+j3*.35;
   spawned++;
  }
  return spawned;
 }
 update(dt){
  const step=Math.max(0,Math.min(Number(dt)||0,.1));
  for(const slot of this.slots){
   if(!slot.active)continue;
   slot.life-=step;
   if(slot.life<=0){slot.active=false;slot.obj.visible=false;continue;}
   const v=slot.velocity||{x:0,y:0,z:0};v.y-=16*step;
   slot.obj.position.x+=v.x*step;slot.obj.position.y+=v.y*step;slot.obj.position.z+=v.z*step;
   slot.obj.material.opacity=Math.min(1,slot.life/(slot.total*.4));
  }
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.obj.visible=false;}}
 dispose(){for(const slot of this.slots){this.scene.remove(slot.obj);slot.material?.dispose();slot.material=null;}this.slots=[];this.mote?.dispose();this.mote=null;}
}

// Pooled telegraph cues for movement and spec events (wind-ups, dashes,
// landings, fuel-out sparks, slam shockwaves, grapple hooks, rope anchors and
// the Linted threat ping). A fixed slot budget with three shared unit
// geometries keeps a busy match from growing GPU resources: every emission
// reuses a slot and one material, and the slot is re-pointed at whichever of
// the cached geoms the cue needs. Presentation only — the simulation never
// reads this.
//   ring — a flat hoop            disc — a soft dust annulus
//   arc  — a directional wedge (used for warning cues aimed at a threat)
export class TelegraphPool{
 constructor(scene,limit=20){
  this.scene=scene;this.limit=Math.max(4,limit|0);this.slots=[];this.serial=0;
  this.ringGeo=new T.TorusGeometry(1,.055,6,26);
  this.discGeo=new T.RingGeometry(.52,1,26);
  this.arcGeo=new T.RingGeometry(.74,1,18,1,Math.PI/2-1,2);
 }
 _slot(){
  let slot=this.slots.find(entry=>!entry.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);return this.slots[0];}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false,side:T.DoubleSide});
  const holder=new T.Group(),mesh=new T.Mesh(this.ringGeo,material);
  mesh.rotation.x=-Math.PI/2;mesh.frustumCulled=false;mesh.renderOrder=2;
  holder.add(mesh);holder.visible=false;this.scene.add(holder);
  slot={holder,mesh,material,active:false,serial:0,life:0,total:1,grow:0,opacity:0};
  this.slots.push(slot);return slot;
 }
 // `kind` is 'ring' | 'disc' | 'arc'; `yaw` aims an arc at a world direction
 // (the arc is authored centred on the local forward, -z). `grow` is metres per
 // second of radius expansion.
 spawn({kind='ring',pos,color='#cfe9ff',radius=1,life=.4,grow=0,opacity=.6,yaw=0}={}){
  if(!pos)return null;
  const slot=this._slot();if(!slot)return null;
  slot.mesh.geometry=kind==='disc'?this.discGeo:kind==='arc'?this.arcGeo:this.ringGeo;
  slot.mesh.material.color.set(color);slot.mesh.material.opacity=opacity;
  slot.mesh.scale.setScalar(Math.max(.05,Number(radius)||1));
  slot.holder.position.set(Number(pos.x)||0,Number(pos.y)||0,Number(pos.z)||0);
  slot.holder.rotation.y=kind==='arc'?(Number(yaw)||0):0;
  slot.holder.visible=true;
  slot.active=true;slot.serial=++this.serial;slot.grow=Number(grow)||0;slot.opacity=opacity;
  slot.life=slot.total=Math.max(.05,Number(life)||.4);
  return slot;
 }
 update(dt){
  const step=Math.max(0,Math.min(Number(dt)||0,.25));
  for(const slot of this.slots){
   if(!slot.active)continue;
   slot.life-=step;
   if(slot.life<=0){slot.active=false;slot.holder.visible=false;continue;}
   const t=1-slot.life/slot.total;
   slot.material.opacity=slot.opacity*(1-t);
   if(slot.grow)slot.mesh.scale.setScalar(slot.mesh.scale.x+slot.grow*step);
  }
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.holder.visible=false;}}
 dispose(){for(const slot of this.slots){this.scene.remove(slot.holder);slot.material?.dispose();slot.material=null;}this.slots=[];this.ringGeo?.dispose();this.discGeo?.dispose();this.arcGeo?.dispose();this.ringGeo=this.discGeo=this.arcGeo=null;}
}

// Menu/showcase 3D weapon viewer. It owns a tiny scene with a turntable pivot
// and an inspect camera; mount() builds the weapon through the shared
// weaponModel + ModelAssets pipeline (so a preview reuses the exact same
// geometry/materials as gameplay and disposes exactly once), and frame() /
// update() apply the deterministic pose from structures.mjs. The host screen
// only needs the canvas and a mount rect; no app/** changes are required.
export class WeaponPreviewRig{
 constructor({weaponModel:build=null,assets=null,background='#0a1014'}={}){
  this.build=build;this.assets=assets;this._ownsAssets=!assets;this.scene=new T.Scene();
  this.scene.background=new T.Color(background);
  this.camera=new T.PerspectiveCamera(34,1,.05,60);
  this.pivot=new T.Group();this.scene.add(this.pivot);
  this.scene.add(new T.HemisphereLight('#cdeef2','#1b242b',2.6));
  const key=new T.DirectionalLight('#eafff6',3.4);key.position.set(-3,5,4);this.scene.add(key);
  const rim=new T.PointLight('#59e6d0',60,16);rim.position.set(3,2,-3);this.scene.add(rim);
  this.model=null;this.type=-1;this.visual=null;this.finish=null;this.radius=1;this.mounted=false;
 }
 // Build (or rebuild) the previewed weapon. Reuses the supplied ModelAssets so
 // materials/geometries survive weapon switches; only the previous model's
 // non-shared children are released.
 mount({type=0,visual=null,finish=null}={}){
  if(!this.build)return null;
  this.clear();
  this.type=type;this.visual=visual;this.finish=finish;
  if(!this.assets){this.assets=new ModelAssets();this._ownsAssets=true;}
  const assets=this.assets;
  this.model=withAssets(assets,()=>this.build(type,assets,visual,finish));
  this.pivot.add(this.model);
  const box=new T.Box3().setFromObject(this.model),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
  this.radius=Math.max(.25,Math.max(size.x,size.y,size.z)*.5);
  // Recenter so the turntable spins about the weapon's own middle, not its
  // muzzle origin, then frame the inspect camera from the bounding radius.
  this.model.position.set(-center.x,-center.y,-center.z);
  const frame=weaponInspect(this.radius);
  this.camera.position.set(0,frame.height,frame.distance);
  this.camera.lookAt(0,0,0);
  this.mounted=true;
  return this.model;
 }
 // Apply a deterministic pose. `time` drives the turntable; reduced motion
 // freezes it at a fixed three-quarter angle.
 frame(time,{reduced=false,spin=.35,pitch=-.18}={}){
  if(!this.pivot)return null;
  const pose=weaponPose({time,spin,pitch,reduced,index:this.type<0?0:this.type});
  this.pivot.rotation.set(pose.pitch,pose.yaw,pose.roll);
  return pose;
 }
 // Resize the inspect camera to a CSS mount rect. The host passes the same rect
 // it uses for the scissor viewport, so the preview matches the menu layout.
 resize(width,height){
  const w=Math.max(1,Number(width)||1),h=Math.max(1,Number(height)||1);
  this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
  return {width:w,height:h};
 }
 update(time,{reduced=false,spin=.35,pitch=-.18}={}){return this.frame(time,{reduced,spin,pitch});}
 setVisible(visible){this.pivot.visible=visible!==false;return this.pivot.visible;}
 clear(){
  if(!this.model)return;
  this.pivot.remove(this.model);
  // disposeObject-equivalent: release only resources not owned by ModelAssets.
  const owned=this.assets?.resources,geometries=new Set(),materials=new Set();
  this.model.traverse(n=>{if(n.geometry&&!owned?.has(n.geometry))geometries.add(n.geometry);if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])if(!owned?.has(m))materials.add(m);});
  for(const r of [...geometries,...materials])r.dispose();
  this.model=null;this.mounted=false;
 }
 dispose(){this.clear();if(this._ownsAssets)this.assets?.dispose?.();this.assets=null;this.pivot?.clear?.();this.scene?.clear?.();}
}

// Short, deterministic kill-cam framing. Camera math only: the authoritative
// simulation never reads this. The pose orbits the death anchor and pulls in,
// easing over the duration; reduced motion collapses to a fixed over-shoulder
// stand-off so the shot stays stable.
export const KILLCAM_DURATION=2.2;
export function killcamPose({elapsed=0,duration=KILLCAM_DURATION,focus=null,killer=null,seed=0,reduced=false}={}){
 const fx=focus&&Number.isFinite(focus.x)?focus:{x:0,y:0,z:0};
 const span=Number.isFinite(duration)&&duration>0?duration:KILLCAM_DURATION;
 const phase=Math.max(0,Math.min(1,(Number.isFinite(elapsed)?Math.max(0,elapsed):0)/span));
 const seedValue=(seed>>>0)||1;
 const angle=hashUnit(seedValue,3)*Math.PI*2;
 if(reduced){
  const x=fx.x+Math.sin(angle)*6.4,z=fx.z+Math.cos(angle)*6.4,y=fx.y+3;
  return {x,y,z,lookX:fx.x,lookY:fx.y+.65,lookZ:fx.z,fov:62,phase};
 }
 // Orbit radius shrinks through the shot while the killer is slowly revealed:
 // the first beat reads the death anchor, the tail frames the shooter.
 const radius=5.6-1.5*Math.sin(phase*Math.PI);
 const x=fx.x+Math.sin(angle+phase*1.7)*radius;
 const z=fx.z+Math.cos(angle+phase*1.7)*radius;
 const hasKiller=killer!=null&&Number.isFinite(killer.x)&&Number.isFinite(killer.z);
 const reveal=hasKiller?Math.max(0,(phase-.45)/.55):0;
 const y=fx.y+2.2+1.5*Math.sin(phase*Math.PI)+(hasKiller&&Number.isFinite(killer.y)?(killer.y-fx.y)*.22*reveal:0);
 const lookX=fx.x+(hasKiller?(killer.x-fx.x)*.34*reveal:0),lookZ=fx.z+(hasKiller?(killer.z-fx.z)*.34*reveal:0);
 return {x,y,z,lookX,lookY:fx.y+.7,lookZ,fov:58+9*(1-phase),phase};
}
