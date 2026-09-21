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

// Fixed pool of point lights so automatic fire never allocates per shot. The
// same pool carries the slower, wider explosion pulse: the slot budget is fixed
// at construction, so a barrel chain cannot grow the light count.
export class MuzzleLightPool{
 constructor(scene,count=2,intensity=3.4,distance=7){this.scene=scene;this.intensity=intensity;this.lights=[];this.index=0;for(let i=0;i<count;i++){const light=new T.PointLight('#ffffff',0,distance,2);light.visible=false;light.userData.remaining=0;light.userData.total=1;light.userData.peak=intensity;scene.add(light);this.lights.push(light);}}
 flash(color,position,life=.06,intensity=this.intensity){if(!this.lights.length)return;const light=this._slot(position);if(!light)return;const peak=Number.isFinite(Number(intensity))?Math.max(0,Number(intensity)):this.intensity;light.color.set(color);light.userData.remaining=life;light.userData.total=life;light.userData.peak=peak;light.intensity=peak;light.visible=true;if(position)light.position.set(position.x,position.y,position.z);return light;}
 // Slot choice: round-robin over the idle lights preserves the historical order
 // (the first flash of a burst keeps its old slot); once every light is pulsing,
 // recycle the pulse farthest from the new flash so nearby muzzle flashes keep
 // their own slot instead of all fighting for one light.
 _slot(position){
  if(!this.lights.length)return null;
  for(let step=0;step<this.lights.length;step++){
   this.index=(this.index+1)%this.lights.length;
   if(this.lights[this.index].userData.remaining<=0)return this.lights[this.index];
  }
  let best=this.lights[0],bestDistance=-1;
  for(const light of this.lights){
   const dx=light.position.x-(Number(position?.x)||0),dy=light.position.y-(Number(position?.y)||0),dz=light.position.z-(Number(position?.z)||0),distance=dx*dx+dy*dy+dz*dz;
   if(distance>bestDistance){bestDistance=distance;best=light;}
  }
  return best;
 }
 update(dt){for(const light of this.lights){if(light.userData.remaining<=0){if(light.visible){light.visible=false;light.intensity=0;}continue;}light.userData.remaining-=dt;if(light.userData.remaining<=0){light.visible=false;light.intensity=0;}else light.intensity=light.userData.peak*(light.userData.remaining/light.userData.total);}}
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
 spawn(from,to,color='#9fe8ff',reduced=false,widthScale=1){
  if(!from||!to)return null;
  const slot=this._slot();if(!slot)return null;
  this.from.set(from.x||0,from.y||0,from.z||0);this.to.set(to.x||0,to.y||0,to.z||0);
  this.dir.subVectors(this.to,this.from);const len=this.dir.length()||.001;this.dir.normalize();
  this.quat.setFromUnitVectors(this.axis,this.dir);
  const scale=Math.max(.2,Math.min(2.5,Number(widthScale)||1));
  const width=(reduced?.07:.12)*scale;
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

// Shared procedural alpha masks. One tiny canvas per pool, generated once: no
// baked asset, no texture per spawn. The optional rim adds a faint dense band,
// which is what makes a scorch read as a ring instead of a soft dot. Returns
// null without a DOM so headless/CI pools stay fully functional (untextured).
function makeRadialMask(size=64,{rim=0,rimWidth=.16}={}){
 if(typeof document==='undefined'||!document.createElement)return null;
 const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
 const ctx=canvas.getContext('2d');
 if(!ctx?.createImageData||!ctx?.putImageData)return null;
 const image=ctx.createImageData(size,size),data=image.data;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=(y*size+x)*4,dx=(x+.5)/size*2-1,dy=(y+.5)/size*2-1,d=Math.min(1,Math.hypot(dx,dy));
  let alpha=Math.pow(Math.max(0,1-d),1.6);
  if(rim>0)alpha=Math.min(1,alpha+rim*Math.exp(-Math.pow((d-.74)/rimWidth,2)));
  data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(255*Math.max(0,Math.min(1,alpha)));
 }
 ctx.putImageData(image,0,0);
 const texture=new T.CanvasTexture(canvas);
 texture.wrapS=texture.wrapT=T.ClampToEdgeWrapping;
 texture.needsUpdate=true;
 return texture;
}

// Impact/scorch decals: one shared quad and mask, a fixed slot pool and per-slot
// opacity so overlapping marks fade independently. The quad is laid perpendicular
// to the incoming shot so wall and ceiling hits stay on the surface; a missing
// direction (or an explicit flat request) keeps the legacy ground-parallel stamp.
// The view creates this only for WebGL and skips it on the CPU renderer to keep
// its draw-call budget flat.
export class DecalPool{
 constructor(scene,limit=18){
  this.scene=scene;this.limit=limit;this.slots=[];this.serial=0;
  this.geometry=new T.PlaneGeometry(1,1);
  this.mask=makeRadialMask(64,{rim:.2});
  this.axis=new T.Vector3(0,0,1);
  this.normal=new T.Vector3();
  this.tilt=new T.Quaternion();
  this.roll=new T.Quaternion();
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);return this.slots[0];}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,forceSinglePass:true,map:this.mask??null});
  const obj=new T.Mesh(this.geometry,material);obj.visible=false;obj.renderOrder=3;
  obj.userData.decal=true;this.scene.add(obj);slot={obj,material,active:false,serial:0,size:1,opacity:.58};this.slots.push(slot);return slot;
 }
 spawn(pos,{color='#171310',size=.32,life=5.5,reduced=false,seed=0,dir=null,flat=false}={}){
  if(!pos)return false;
  const slot=this._slot();if(!slot)return false;
  const yaw=hashUnit(seed||0)*Math.PI*2,scale=Math.max(.05,size);
  // Surface normal = opposite the ray. Near-vertical normals stay horizontal
  // (floor/ceiling), everything else follows the surface the impact is on.
  const dx=Number(dir?.x)||0,dy=Number(dir?.y)||0,dz=Number(dir?.z)||0,length=Math.hypot(dx,dy,dz);
  const oriented=!flat&&length>1e-6;
  this.normal.set(oriented?-dx/length:0,oriented?-dy/length:1,oriented?-dz/length:0);
  const vertical=Math.abs(this.normal.y)>.92;
  this.tilt.setFromUnitVectors(this.axis,this.normal);
  this.roll.setFromAxisAngle(this.normal,vertical?yaw:yaw*.35);
  // Spin about the surface normal first, then tilt the plane onto it, so the
  // quad normal stays exactly on the surface for both wall and floor hits.
  slot.obj.quaternion.copy(this.roll).multiply(this.tilt);
  slot.obj.material.color.set(color);
  slot.opacity=reduced?.46:.58;
  slot.obj.material.opacity=slot.opacity;
  slot.obj.visible=true;
  const lift=vertical?.025:.02;
  slot.obj.position.set((pos.x||0)+this.normal.x*lift,(pos.y||0)+this.normal.y*lift,(pos.z||0)+this.normal.z*lift);
  slot.obj.scale.setScalar(scale);
  slot.active=true;slot.serial=++this.serial;slot.size=scale;slot.life=slot.total=Math.max(.2,life);
  return true;
 }
 // A blast scorch: a broad soot ring plus a denser core, both stamped from the
 // same shared mask so an explosion allocates no material or texture of its own.
 scorch(pos,{color='#171310',size=.9,life=6,reduced=false,seed=0}={}){
  const outer=this.spawn(pos,{color,size:size*1.7,life:life*1.35,reduced,seed,flat:true});
  const inner=this.spawn(pos,{color,size,life,reduced,seed:(seed+13)>>>0,flat:true});
  return outer||inner;
 }
 update(dt){
  for(const slot of this.slots){
   if(!slot.active)continue;
   slot.life-=dt;
   if(slot.life<=0){slot.active=false;slot.obj.visible=false;continue;}
   const t=1-slot.life/slot.total;
   // Hold the stamp at full strength for the first 60% of its life, then fade
   // through the tail. The pool cap, slot count and stored lifetime are
   // unchanged; only the opacity curve moves.
   const hold=.6,held=t<=hold?1:Math.max(0,1-(t-hold)/(1-hold));
   slot.obj.material.opacity=(slot.opacity??.58)*held;
   slot.obj.scale.setScalar(slot.size*(1+t*.14));
  }
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.obj.visible=false;}}
 dispose(){for(const slot of this.slots){this.scene.remove(slot.obj);slot.material?.dispose();slot.material=null;}this.slots=[];this.geometry?.dispose();this.geometry=null;this.mask?.dispose();this.mask=null;}
}

// Pooled ground splashes for rain/storm. Each slot carries a landing delay so a
// ripple appears when its drop would have hit the ground, then expands and
// fades. One shared ring mask and one flat quad; a fixed slot budget reused
// oldest-first. Presentation only: the CPU renderer never allocates it.
export class RipplePool{
 constructor(scene,limit=18){
  this.scene=scene;this.limit=Math.max(2,limit|0);this.slots=[];this.serial=0;
  this.geometry=new T.PlaneGeometry(1,1).rotateX(-Math.PI/2);
  this.mask=makeRadialMask(48,{rim:.75,rimWidth:.1});
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);return this.slots[0];}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false,map:this.mask??null,blending:T.AdditiveBlending,side:T.DoubleSide,forceSinglePass:true});
  const obj=new T.Mesh(this.geometry,material);obj.visible=false;obj.renderOrder=2;
  obj.userData.ripple=true;this.scene.add(obj);slot={obj,material,active:false,serial:0,delay:0,life:0,total:1,base:.1,grow:.4,reduced:false};this.slots.push(slot);return slot;
 }
 // `delay` is the deterministic time-to-impact; the slot stays hidden until then
 // so a splash reads as ground contact rather than a spawn flash.
 spawn(pos,{color='#cfe0ef',delay=0,life=.5,size=.34,reduced=false,seed=0}={}){
  if(!pos)return null;
  const slot=this._slot();if(!slot)return null;
  slot.obj.position.set(Number(pos.x)||0,Number(pos.y)||0,Number(pos.z)||0);
  slot.obj.rotation.y=hashUnit(seed||0)*Math.PI*2;
  slot.obj.scale.setScalar(size*.42);
  slot.material.color.set(color);
  slot.material.opacity=0;
  slot.obj.visible=false;
  slot.delay=Math.max(0,Number(delay)||0);
  slot.life=slot.total=Math.max(.12,Number(life)||.5);
  slot.base=Math.max(.05,size*.42);
  slot.grow=Math.max(.05,Number(size)||.34);
  slot.reduced=reduced===true;
  slot.active=true;slot.serial=++this.serial;
  return slot;
 }
 update(dt){
  const step=Math.max(0,Math.min(Number(dt)||0,.1));
  for(const slot of this.slots){
   if(!slot.active)continue;
   if(slot.delay>0){slot.delay-=step;if(slot.delay>0)continue;slot.obj.visible=true;}
   slot.life-=step;
   if(slot.life<=0){slot.active=false;slot.obj.visible=false;continue;}
   const t=1-slot.life/slot.total;
   // Reduced motion keeps the splash static: no expansion, only the fade.
   slot.obj.scale.setScalar(slot.reduced?slot.base:slot.base+slot.grow*t);
   slot.material.opacity=.5*(1-t)*(1-t);
  }
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.delay=0;slot.obj.visible=false;}}
 dispose(){for(const slot of this.slots){this.scene.remove(slot.obj);slot.material?.dispose();slot.material=null;}this.slots=[];this.geometry?.dispose();this.geometry=null;this.mask?.dispose();this.mask=null;}
}

// WebGL contact shadows: a small fixed pool of soft radial quads that follow the
// presentation positions of actors and vehicles. They ground a character where
// the shadow map's bias loses contact; the CPU renderer keeps its per-model blob
// shadows and never allocates this pool. Keys are presentation ids, so a slot is
// reused frame to frame and the pool never grows past its limit.
export class ContactShadowPool{
 constructor(scene,limit=16){
  this.scene=scene;this.limit=Math.max(2,limit|0);this.slots=[];this.byId=new Map();this.frame=0;this.serial=0;
  this.geometry=new T.PlaneGeometry(1,1).rotateX(-Math.PI/2);
  this.mask=makeRadialMask(64);
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);return this.slots[0];}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,forceSinglePass:true,map:this.mask??null,color:'#05080b'});
  const obj=new T.Mesh(this.geometry,material);obj.visible=false;obj.renderOrder=2;
  obj.userData.contactShadow=true;this.scene.add(obj);
  slot={obj,material,active:false,serial:++this.serial,frame:-1};this.slots.push(slot);return slot;
 }
 // Track the shadow for one presentation id this frame. Missing ids are hidden by
 // the following `end()`; existing keys keep their slot so a moving actor's
 // shadow never flickers between pool entries.
 place(id,x,y,z,{radius=.6,opacity=.42}={}){
  if(id==null)return null;
  let slot=this.byId.get(id);
  if(!slot){
   slot=this._slot();if(!slot)return null;
   // A reused slot may still be keyed to a retired id; release that binding.
   for(const [key,entry] of this.byId)if(entry===slot)this.byId.delete(key);
   this.byId.set(id,slot);
  }
  slot.frame=this.frame;
  slot.obj.position.set(Number(x)||0,Number(y)||0,Number(z)||0);
  slot.obj.scale.setScalar(Math.max(.05,Number(radius)||.6));
  slot.material.opacity=Math.max(0,Math.min(1,Number(opacity)||0));
  slot.obj.visible=true;slot.active=true;
  return slot;
 }
 end(){
  for(const [id,slot] of this.byId)if(slot.frame!==this.frame){slot.obj.visible=false;slot.active=false;this.byId.delete(id);}
  this.frame++;
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.obj.visible=false;}this.byId.clear();}
 dispose(){for(const slot of this.slots){this.scene.remove(slot.obj);slot.material?.dispose();slot.material=null;}this.slots=[];this.byId.clear();this.geometry?.dispose();this.geometry=null;this.mask?.dispose();this.mask=null;}
}

// Spectator / kill-cam readability markers. One tiny pooled world marker built
// only from generated geometry: a ground ring, an overhead chevron and an
// optional killer bracket. `depthTest:false` keeps the followed subject
// readable through geometry; there is no camera math, no texture and no
// per-frame allocation. Slots are keyed by presentation role ('follow' /
// 'killer') so a reused slot never carries a stale mark. The pulse is
// presentational only: reduced motion (and the CPU renderer, which stays
// cheap) holds the marker static.
export const FOLLOW_MARKER_COLOR='#7fe7ff';
export const KILLER_MARKER_COLOR='#ff6b6b';
export class FollowMarkerPool{
 constructor(scene,limit=2){
  this.scene=scene;this.limit=Math.max(1,limit|0);this.slots=[];this.byKey=new Map();this.frame=0;this.serial=0;
  this.ringGeo=new T.TorusGeometry(.34,.035,6,24);
  this.chevronGeo=new T.ConeGeometry(.2,.3,4);
  this.bracketGeo=new T.BoxGeometry(.055,.16,.02);
 }
 _slot(){
  let slot=this.slots.find(entry=>!entry.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);return this.slots[0];}
  const material=new T.MeshBasicMaterial({color:FOLLOW_MARKER_COLOR,transparent:true,depthTest:false,depthWrite:false});
  const group=new T.Group();group.name='follow-marker';
  const ring=new T.Mesh(this.ringGeo,material);ring.rotation.x=Math.PI/2;ring.position.y=.07;
  const chevron=new T.Mesh(this.chevronGeo,material);chevron.rotation.x=Math.PI;chevron.position.y=1.72;
  const bracket=new T.Group();bracket.position.y=1.02;bracket.visible=false;
  for(const [x,y] of [[-.3,.3],[.3,.3],[-.3,-.3],[.3,-.3]]){
   const bar=new T.Mesh(this.bracketGeo,material);bar.position.set(x,y,0);bar.rotation.z=x*y>0?-.785:.785;bracket.add(bar);
  }
  group.add(ring,chevron,bracket);
  group.visible=false;group.frustumCulled=false;
  group.traverse(node=>{node.renderOrder=95;node.userData.followMarker=true;});
  this.scene.add(group);
  slot={group,ring,chevron,bracket,material,active:false,serial:0,frame:-1};
  this.slots.push(slot);return slot;
 }
 // Track one role for this frame. `kind` is 'follow' | 'killer'; the killer
 // role swaps the chevron for the bracket. `pulse` is the caller's
 // reduced-motion/software decision: false holds a static marker.
 place(key,x,y,z,{color=FOLLOW_MARKER_COLOR,kind='follow',time=0,pulse=false}={}){
  if(key==null)return null;
  let slot=this.byKey.get(key);
  if(!slot){
   slot=this._slot();if(!slot)return null;
   for(const [bound,entry] of this.byKey)if(entry===slot)this.byKey.delete(bound);
   this.byKey.set(key,slot);
  }
  const t=Number(time)||0,killer=kind==='killer';
  slot.frame=this.frame;
  slot.group.position.set(Number(x)||0,Number(y)||0,Number(z)||0);
  slot.material.color.set(color);
  slot.material.opacity=killer?.95:.85;
  const bob=pulse?Math.sin(t*3.6)*.07:0,beat=pulse?1+Math.sin(t*4.4)*.07:1;
  slot.ring.scale.setScalar(beat);
  slot.ring.visible=true;
  slot.chevron.visible=!killer;
  slot.chevron.position.y=1.72+bob;
  slot.chevron.rotation.y=pulse?t*1.9:0;
  slot.bracket.visible=killer;
  slot.bracket.rotation.y=pulse?t*.8:0;
  slot.group.visible=true;slot.active=true;
  return slot;
 }
 // Hide every role that was not placed this frame and release its key, so a
 // stopped follow or an ended kill-cam leaves nothing on screen.
 end(){
  for(const [key,slot] of this.byKey)if(slot.frame!==this.frame){slot.group.visible=false;slot.active=false;this.byKey.delete(key);}
  this.frame++;
  return this.byKey.size;
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.group.visible=false;}this.byKey.clear();return 0;}
 dispose(){for(const slot of this.slots){this.scene.remove(slot.group);slot.material?.dispose();slot.material=null;}this.slots=[];this.byKey.clear();this.ringGeo?.dispose();this.chevronGeo?.dispose();this.bracketGeo?.dispose();this.ringGeo=this.chevronGeo=this.bracketGeo=null;}
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

// Pooled ballistic shell casings. One shared box geometry and a fixed slot
// budget reused oldest-first, so sustained fire never allocates. The view
// spawns them at the viewmodel's ejection port with a deterministic fling;
// they fall, tumble and fade. Reduced motion and the CPU renderer never spawn.
const SHELL_GRAVITY=12;
export class ShellPool{
 constructor(scene,limit=24){
  this.scene=scene;this.limit=Math.max(2,limit|0);this.slots=[];this.serial=0;
  this.geometry=new T.BoxGeometry(.018,.018,.036);
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);return this.slots[0]||null;}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false});
  const obj=new T.Mesh(this.geometry,material);obj.visible=false;obj.frustumCulled=false;this.scene.add(obj);
  slot={obj,material,active:false,serial:0,velocity:{x:0,y:0,z:0},spin:{x:0,y:0,z:0}};
  this.slots.push(slot);return slot;
 }
 spawn(pos,{velocity=null,color='#d9b45b',life=.9,seed=0,reduced=false}={}){
  if(!pos||reduced)return null;
  const slot=this._slot();if(!slot)return null;
  const vx=Number.isFinite(velocity?.x)?velocity.x:0,vy=Number.isFinite(velocity?.y)?velocity.y:1.2,vz=Number.isFinite(velocity?.z)?velocity.z:0;
  slot.obj.visible=true;slot.material.color.set(color);slot.material.opacity=1;
  slot.obj.position.set(Number(pos.x)||0,Number(pos.y)||0,Number(pos.z)||0);
  slot.obj.rotation.set(hashUnit(seed,1)*Math.PI,hashUnit(seed,2)*Math.PI,hashUnit(seed,3)*Math.PI);
  slot.velocity={x:vx+(hashUnit(seed,4)-.5)*.7,y:vy+hashUnit(seed,5)*.5,z:vz+(hashUnit(seed,6)-.5)*.7};
  slot.spin={x:(hashUnit(seed,7)-.5)*18,y:(hashUnit(seed,8)-.5)*18,z:(hashUnit(seed,9)-.5)*18};
  slot.active=true;slot.serial=++this.serial;slot.life=slot.total=Math.max(.2,Math.min(2,Number(life)||.9));
  return slot;
 }
 update(dt){
  const step=Math.max(0,Math.min(Number(dt)||0,.1));
  for(const slot of this.slots){
   if(!slot.active)continue;
   slot.life-=step;
   if(slot.life<=0){slot.active=false;slot.obj.visible=false;continue;}
   const v=slot.velocity;v.y-=SHELL_GRAVITY*step;
   slot.obj.position.x+=v.x*step;slot.obj.position.y+=v.y*step;slot.obj.position.z+=v.z*step;
   slot.obj.rotation.x+=slot.spin.x*step;slot.obj.rotation.y+=slot.spin.y*step;slot.obj.rotation.z+=slot.spin.z*step;
   slot.material.opacity=Math.min(1,slot.life/(slot.total*.45));
  }
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.obj.visible=false;}}
 dispose(){for(const slot of this.slots){this.scene.remove(slot.obj);slot.material.dispose();}this.slots=[];this.geometry.dispose();}
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

// ---- Alt-fire projectile visuals -------------------------------------------
// Cluster pods, mortar orbs, flak shells and persistent proximity mines. One
// small group per tracked projectile, a fixed slot budget reused oldest-first,
// and shared pool geometry so a busy alt-fire match cannot grow GPU resources.
// Mines are keyed by projectile/pending id: they spawn from the `launch` event,
// keep updating from the snapshot `rockets` list (adopting the sim's id when it
// appears), blink once armed, and leave on the matching `explosion` event, an
// explicit remove, or their `life` expiry. Everything is presentation only.
export const ALT_PROJECTILE_COLORS=Object.freeze({cluster:'#ffb066',mortar:'#c9a6ff',mine:'#8fd9ff',bomb:'#ff9a7a'});
export const altProjectileColor=kind=>ALT_PROJECTILE_COLORS[kind]||'#ffb066';
const ALT_PROJECTILE_KINDS=new Set(['cluster','mortar','mine','bomb']);
// A snapshot rocket is an alt projectile when the sim tags it directly
// (`mine`/`bomblets`/`flak`) or via the alt flag/id. The weapon fallback keeps
// older snapshots readable.
export function altRocketKind(rocket){
 if(!rocket)return null;
 if(rocket.mine===true)return 'mine';
 if(Number(rocket.bomblets)>0)return 'cluster';
 if(Number(rocket.flak)>0)return 'bomb';
 if(rocket.alt!==true&&rocket.altId==null)return null;
 if(typeof rocket.altId==='string'&&ALT_PROJECTILE_KINDS.has(rocket.altId))return rocket.altId;
 const weapon=Number.isInteger(rocket.weapon)?rocket.weapon:-1;
 return weapon===1?'cluster':weapon===4?'mortar':weapon===5?'mine':weapon===7?'bomb':null;
}
const MINE_BLINK_HZ=7;
export class AltProjectilePool{
 constructor(scene,limit=12){
  this.scene=scene;this.limit=Math.max(4,limit|0);this.slots=[];this.byKey=new Map();this.serial=0;this.clock=0;
  this.podGeo=new T.CylinderGeometry(.05,.028,.17,8);
  this.orbGeo=new T.SphereGeometry(.155,10,8);
  this.shellGeo=new T.SphereGeometry(.12,10,8);
  this.mineGeo=new T.CylinderGeometry(.17,.17,.07,12);
  this.eyeGeo=new T.SphereGeometry(.042,8,6);
  this.prongGeo=new T.BoxGeometry(.016,.016,.13);
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){slot=this.slots.slice().sort((a,b)=>a.serial-b.serial)[0];this._release(slot);return slot;}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false});
  const group=new T.Group();group.name='alt-projectile';
  const body=new T.Mesh(this.orbGeo,material),disc=new T.Mesh(this.mineGeo,material),prongs=new T.Group(),eye=new T.Mesh(this.eyeGeo,material);
  for(const s of [-1,0,1]){const prong=new T.Mesh(this.prongGeo,material);prong.position.set(s*.055,0,-.045);prong.rotation.z=s*.35;prongs.add(prong);}
  group.add(body,disc,prongs,eye);group.visible=false;group.frustumCulled=false;this.scene.add(group);
  slot={group,body,disc,prongs,eye,material,active:false,serial:0,key:null,pendingKey:null,kind:null,pos:{x:0,y:0,z:0},expires:Infinity,armedAt:Infinity,lastSeen:-Infinity};
  this.slots.push(slot);return slot;
 }
 _release(slot){
  if(slot.key!=null)this.byKey.delete(slot.key);
  slot.key=null;slot.pendingKey=null;slot.kind=null;slot.active=false;slot.group.visible=false;slot.expires=Infinity;slot.armedAt=Infinity;slot.lastSeen=-Infinity;
 }
 _configure(slot){
  const mine=slot.kind==='mine';
  slot.body.visible=!mine;slot.disc.visible=mine;slot.prongs.visible=mine;slot.eye.visible=false;
  if(!mine)slot.body.geometry=slot.kind==='cluster'?this.podGeo:slot.kind==='mortar'?this.orbGeo:this.shellGeo;
  slot.material.color.set(altProjectileColor(slot.kind));
 }
 _place(slot,pos){
  slot.pos.x=Number(pos?.x)||0;slot.pos.y=Number(pos?.y)||0;slot.pos.z=Number(pos?.z)||0;
  slot.group.position.set(slot.pos.x,slot.pos.y,slot.pos.z);
 }
 // Immediate visual from a local `launch` event. The key is provisional: the
 // next snapshot adopt pass binds the sim's rocket id and keeps the identity.
 spawn({key=null,kind=null,pos=null,arm,life,mine=false,time=0}={}){
  if(!kind||!pos)return null;
  const now=Number.isFinite(time)?time:this.clock,slot=this._slot();
  slot.kind=kind;slot.pendingKey=key!=null?String(key):null;slot.active=true;slot.serial=++this.serial;slot.lastSeen=now;
  const isMine=mine||kind==='mine';
  slot.expires=now+(Number.isFinite(life)?Math.max(.2,life):(isMine?7:4));
  slot.armedAt=now+(isMine?(Number.isFinite(arm)?Math.max(0,arm):.45):0);
  this._configure(slot);this._place(slot,pos);slot.group.visible=true;
  return slot;
 }
 // Per-frame snapshot pass. Rows are {id,kind,pos,life,arm,mine}. Mines keep
 // their life/arm budget from the launch event unless the snapshot supplies a
 // shorter (remaining-time) value, so a constant total never extends them.
 sync(rows,{time=0,reduced=false}={}){
  const now=Number.isFinite(time)?time:this.clock;
  for(const row of rows||[]){
   if(!row?.kind||!row.pos)continue;
   const id=row.id!=null?String(row.id):null;
   let slot=id!=null?this.byKey.get(id):null;
   if(!slot)slot=this.slots.find(s=>s.active&&s.key==null&&s.kind===row.kind&&Math.hypot(s.pos.x-row.pos.x,s.pos.y-row.pos.y,s.pos.z-row.pos.z)<5);
   if(!slot)slot=this._slot();
   if(slot.key!=null&&slot.key!==id){this.byKey.delete(slot.key);slot.key=null;}
   if(slot.key==null&&id!=null){slot.key=id;this.byKey.set(id,slot);}
   slot.kind=row.kind;slot.active=true;slot.serial=++this.serial;slot.lastSeen=now;
   this._configure(slot);this._place(slot,row.pos);slot.group.visible=true;
   if(row.kind==='mine'){
    if(Number.isFinite(row.arm))slot.armedAt=Math.min(slot.armedAt,now+Math.max(0,row.arm));
    if(Number.isFinite(row.life)){const expires=now+Math.max(.2,row.life);if(expires<slot.expires)slot.expires=expires;}
   }
  }
  return this.activeCount();
 }
 activeCount(){let n=0;for(const slot of this.slots)if(slot.active)n++;return n;}
 // Remove the projectile named by key (projectile id / pending id) or the
 // nearest live one to an explosion position. Returns the removed identity so
 // the view can pick a matching burst.
 explode(key=null,pos=null){
  let slot=key!=null?this.byKey.get(String(key)):null;
  if(!slot&&key!=null)slot=this.slots.find(s=>s.active&&s.pendingKey===String(key))||null;
  if(!slot&&pos){let best=null,bestDistance=4;for(const s of this.slots){if(!s.active)continue;const d=Math.hypot(s.pos.x-(pos.x||0),s.pos.y-(pos.y||0),s.pos.z-(pos.z||0));if(d<bestDistance){best=s;bestDistance=d;}}slot=best;}
  if(!slot)return null;
  const info={kind:slot.kind,key:slot.key??slot.pendingKey,pos:{...slot.pos}};
  this._release(slot);
  return info;
 }
 // Arming/blink, life expiry and idle cleanup. Non-mine projectiles vanish
 // shortly after the snapshot stops listing them; mines hold until life ends.
 update(dt,{time=NaN,reduced=false}={}){
  const step=Math.max(0,Math.min(Number(dt)||0,.1));
  const now=Number.isFinite(time)?time:(this.clock+=step);
  for(const slot of this.slots){
   if(!slot.active)continue;
   if(slot.kind==='mine'){
    if(now>=slot.expires){this._release(slot);continue;}
    const armed=now>=slot.armedAt;
    slot.eye.visible=armed&&(reduced||Math.floor(now*MINE_BLINK_HZ)%2===0);
    slot.eye.scale.setScalar(armed?1:.6);
    if(!reduced){slot.prongs.rotation.z+=step*1.4;slot.disc.rotation.z+=step*.5;}
    else{slot.prongs.rotation.z=0;slot.disc.rotation.z=0;}
   }else{
    if(now>=slot.expires||now-slot.lastSeen>1.4){this._release(slot);continue;}
    if(!reduced){slot.body.rotation.z+=step*2.5;if(slot.kind==='mortar')slot.body.rotation.x+=step*1.4;}
   }
  }
  return this.activeCount();
 }
 clear(){for(const slot of this.slots)this._release(slot);}
 dispose(){
  for(const slot of this.slots){this.scene.remove(slot.group);slot.material.dispose();}
  this.slots=[];this.byKey.clear();
  for(const geo of [this.podGeo,this.orbGeo,this.shellGeo,this.mineGeo,this.eyeGeo,this.prongGeo])geo?.dispose();
  this.podGeo=this.orbGeo=this.shellGeo=this.mineGeo=this.eyeGeo=this.prongGeo=null;
 }
}
