import * as T from 'three';
import {terrainSupportAt} from './terrain.mjs';
import {clamp} from './math.mjs';

// Procedural backdrop: a vertex-colored gradient dome, a single-draw-call ring
// of distant low-poly mountains, and instanced terrain scatter. Nothing here is
// loaded from disk and every mesh is disposable by the caller's world teardown.

const rng=seed=>{let state=seed>>>0;return()=>{state=(state+0x6d2b79f5)|0;let t=Math.imul(state^(state>>>15),1|state);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};};

export const SKY_PHASES=Object.freeze(['day','dusk','night']);

// Maps whose signature is a ring/orbit motif get a halo ring.
export const HALO_MAPS=Object.freeze(new Set(['aether','skybreak']));

// Hand-picked dark arenas so the look is stable even if a background hex shifts.
export const NIGHT_MAPS=Object.freeze(new Set(['exchange','launchpad','crosswire','derelict-station','skybreak','aether','neon-vertical','substation','skyfall-basin','signal-ridge','catwalk-breach','ironfall-megastructure','puma-circuit','puma-pitch','colosseum','frost-gate','sunken-hill','catacombs','titan-valley','convoy-line','proving-grounds','atrium']));

// Three.js Color stores components in the linear working space already, so this
// is a plain linear-luminance dot product (no second sRGB decode).
export function skyLuminance(hex){
 const c=new T.Color(hex);
 return .2126*c.r+.7152*c.g+.0722*c.b;
}

export function skyPhase(map={}){
 if(typeof map?.sky==='string'&&SKY_PHASES.includes(map.sky))return map.sky;
 if(NIGHT_MAPS.has(map?.id))return 'night';
 const luminance=skyLuminance(map?.background||'#090f17');
 return luminance<.06?'night':luminance<.18?'dusk':'day';
}

// Pure, deterministic palette. Returns hex strings so both renderers can use it.
// `haze` is the warm/cool band that softens the horizon-to-sky transition.
export function skyPalette(background='#090f17',phase='day'){
 const base=new T.Color(background),mix=(target,amount)=>'#'+base.clone().lerp(new T.Color(target),amount).getHexString();
 if(phase==='night')return Object.freeze({zenith:mix('#050912',.62),horizon:mix('#16233d',.4),ground:mix('#000000',.72),haze:mix('#2a4a6e',.28),star:'#ffffff',starDim:'#9fb6ff',disk:'#e6ecff',diskGlow:'#7fa6ff',halo:'#8fe6ff'});
 if(phase==='dusk')return Object.freeze({zenith:mix('#1b1436',.5),horizon:mix('#ff8a4c',.5),ground:mix('#000000',.6),haze:mix('#ffb066',.34),star:'#fff2cf',starDim:'#ffb27a',disk:'#ffb066',diskGlow:'#ff7a3c',halo:'#ffd9a0'});
 return Object.freeze({zenith:mix('#ffffff',.4),horizon:mix('#ffffff',.08),ground:mix('#000000',.5),haze:mix('#dff1ff',.26),star:'#ffffff',starDim:'#cfe4ff',disk:'#fff3c4',diskGlow:'#ffd98a',halo:'#bff0ff'});
}

// Smooth horizon-weighted dome gradient. `t` is the normalized dome height
// ([-1,1]): the sky eases toward the zenith instead of clamping early, while a
// thin haze band thickens the horizon so distant terrain meets the dome softly.
// Returns a plain {r,g,b} in the working color space; deterministic and finite.
export function skyGradientAt(t,palette){
 const u=clamp(Number.isFinite(t)?t:0,-1,1),zenith=new T.Color(palette?.zenith||'#ffffff'),horizon=new T.Color(palette?.horizon||'#000000'),ground=new T.Color(palette?.ground||'#000000'),haze=new T.Color(palette?.haze||palette?.horizon||'#000000'),color=new T.Color();
 if(u>=0){const k=Math.pow(u,.72)*.92;color.copy(horizon).lerp(zenith,k);const band=Math.max(0,1-u/.22)*.3;if(band>0)color.lerp(haze,band);}
 else color.copy(horizon).lerp(ground,Math.min(1,-u*1.35));
 return {r:color.r,g:color.g,b:color.b};
}

// Deterministic upper-hemisphere star dome. Pure: same seed, same stars.
export function makeStarField(seed,{count=420,minY=.02}={}){
 const total=Math.max(0,Math.round(count)),random=rng((seed>>>0)||1),positions=new Float32Array(total*3),sizes=new Float32Array(total),colors=new Float32Array(total*3),color=new T.Color(),warm=new T.Color('#ffd9a8'),cool=new T.Color('#bcd4ff');
 for(let i=0;i<total;i++){
  const y=minY+(1-minY)*random(),phi=random()*Math.PI*2,r=Math.sqrt(Math.max(0,1-y*y));
  positions[i*3]=Math.cos(phi)*r;positions[i*3+1]=y;positions[i*3+2]=Math.sin(phi)*r;
  sizes[i]=.7+random()*1.9;
  const roll=random();color.set('#ffffff');
  if(roll>.78)color.lerp(warm,.6);else if(roll<.26)color.lerp(cool,.55);
  colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;
 }
 return {positions,sizes,colors,count:total};
}

export function addSky(world,{background='#090f17',radius=185,phase='day',seed=1,starCount=0,halo=false,sunDir=[18,24,10]}={}){
 const palette=skyPalette(background,phase);
 // Finer dome tessellation so the vertex-gradient horizon band stays smooth on WebGL.
 const geometry=new T.SphereGeometry(radius,48,32),position=geometry.attributes.position,colors=new Float32Array(position.count*3);
 for(let i=0;i<position.count;i++){
  const t=clamp(position.getY(i)/radius,-1,1),sample=skyGradientAt(t,palette);
  colors[i*3]=sample.r;colors[i*3+1]=sample.g;colors[i*3+2]=sample.b;
 }
 geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 const material=new T.MeshBasicMaterial({vertexColors:true,side:T.BackSide,fog:false,depthWrite:false});
 const mesh=new T.Mesh(geometry,material);
 mesh.frustumCulled=false;mesh.renderOrder=-1;mesh.userData.environment=true;mesh.userData.sky=true;mesh.userData.phase=phase;
 if(Number(starCount)>0){
  const field=makeStarField(seed,{count:Math.max(1,Math.round(starCount))}),starGeometry=new T.BufferGeometry();
  starGeometry.setAttribute('position',new T.Float32BufferAttribute(field.positions,3));
  starGeometry.setAttribute('color',new T.Float32BufferAttribute(field.colors,3));
  const starMaterial=new T.PointsMaterial({vertexColors:true,size:Math.max(1.2,radius*.0085),sizeAttenuation:false,transparent:true,opacity:.95,depthWrite:false,fog:false,blending:T.AdditiveBlending});
  const stars=new T.Points(starGeometry,starMaterial);
  stars.scale.setScalar(radius*.99);stars.frustumCulled=false;stars.renderOrder=-1;stars.userData.environment=true;stars.userData.stars=true;
  mesh.add(stars);
 }
 const direction=new T.Vector3(sunDir[0],sunDir[1],sunDir[2]).normalize();
 const disc=new T.Mesh(new T.CircleGeometry(radius*.05,32),new T.MeshBasicMaterial({color:palette.disk,fog:false,depthWrite:false,transparent:true,opacity:.95}));
 disc.position.copy(direction).multiplyScalar(radius*.92);disc.lookAt(0,0,0);disc.frustumCulled=false;disc.renderOrder=-1;disc.userData.environment=true;disc.userData.sun=true;
 mesh.add(disc);
 const glow=new T.Mesh(new T.CircleGeometry(radius*.13,32),new T.MeshBasicMaterial({color:palette.diskGlow,fog:false,depthWrite:false,transparent:true,opacity:.22,blending:T.AdditiveBlending}));
 glow.position.copy(direction).multiplyScalar(radius*.9);glow.lookAt(0,0,0);glow.frustumCulled=false;glow.renderOrder=-1;glow.userData.environment=true;
 mesh.add(glow);
 // Additive horizon haze band so distant terrain meets the gradient softly.
 const haze=new T.Mesh(new T.SphereGeometry(radius*.985,32,8,0,Math.PI*2,Math.PI*.34,Math.PI*.24),new T.MeshBasicMaterial({color:palette.horizon,transparent:true,opacity:phase==='night'?.12:.2,side:T.BackSide,depthWrite:false,fog:false,blending:T.AdditiveBlending}));
 haze.frustumCulled=false;haze.renderOrder=-1;haze.userData.environment=true;haze.userData.atmosphere=true;
 mesh.add(haze);
 if(halo){
  const ring=new T.Mesh(new T.TorusGeometry(radius*.62,radius*.006,6,96),new T.MeshBasicMaterial({color:palette.halo,fog:false,depthWrite:false,transparent:true,opacity:.55,blending:T.AdditiveBlending}));
  ring.rotation.x=Math.PI*.5;ring.frustumCulled=false;ring.renderOrder=-1;ring.userData.environment=true;ring.userData.halo=true;
  mesh.add(ring);
 }
 world.add(mesh);
 return mesh;
}

export function addMountains(world,{background='#090f17',radius=150,count=26,seed=1,base=-10,detail=1}={}){
 const segments=clamp(Math.round((Number.isFinite(detail)?detail:1)*5),3,6),random=rng(seed),geometry=new T.ConeGeometry(1,1,segments,1),haze=new T.Color(background),rock=new T.Color('#4d4636');
 const material=new T.MeshStandardMaterial({color:'#ffffff',roughness:1,metalness:0,flatShading:true});
 const mesh=new T.InstancedMesh(geometry,material,count),dummy=new T.Object3D(),color=new T.Color();
 for(let i=0;i<count;i++){
  const angle=(i/count)*Math.PI*2+random()*.14,dist=radius*(.86+random()*.22),height=26+random()*34,width=18+random()*22;
  dummy.position.set(Math.cos(angle)*dist,base+height/2,Math.sin(angle)*dist);
  dummy.rotation.set(0,random()*Math.PI,0);
  dummy.scale.set(width,height,width*(.7+random()*.5));
  dummy.updateMatrix();
  mesh.setMatrixAt(i,dummy.matrix);
  color.copy(rock).lerp(haze,clamp(.35+random()*.4,0,1));
  mesh.setColorAt(i,color);
 }
 mesh.instanceMatrix.needsUpdate=true;
 if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
 mesh.frustumCulled=false;mesh.userData.environment=true;mesh.userData.mountains=true;
 world.add(mesh);
 return mesh;
}

// Per-biome scatter families. These layer richer ground detail (mesas, ice,
// lava rock, undergrowth, rubble, stalagmites) on top of the shared grass/rock/
// fern pass. Counts are deliberately small and `addScatter` trims the whole
// scatter to a triangle budget so the CPU renderer never inherits a huge bill.
export const SCATTER_TRIANGLE_BUDGET=120000;
export const BIOME_PROP_FAMILIES=Object.freeze({
 canyon:Object.freeze([
  Object.freeze({kind:'mesa',count:22,color:'#b08a5a',shape:'mesa'}),
  Object.freeze({kind:'shard',count:30,color:'#9a7a52',shape:'shard'}),
 ]),
 snow:Object.freeze([
  Object.freeze({kind:'ice',count:26,color:'#bcd8e8',shape:'ice'}),
  Object.freeze({kind:'drift',count:24,color:'#e8f2fa',shape:'drift'}),
 ]),
 volcanic:Object.freeze([
  Object.freeze({kind:'lavaRock',count:26,color:'#4a2a20',shape:'rock',emissive:'#ff6a2a'}),
  Object.freeze({kind:'emberVent',count:12,color:'#2a1a14',shape:'vent',emissive:'#ff8a3c'}),
 ]),
 forest:Object.freeze([
  Object.freeze({kind:'bush',count:36,color:'#4f8f4a',shape:'bush'}),
 ]),
 ruins:Object.freeze([
  Object.freeze({kind:'rubble',count:28,color:'#8a8378',shape:'rubble'}),
 ]),
 urban:Object.freeze([]),
 cavern:Object.freeze([
  Object.freeze({kind:'stalag',count:20,color:'#6a6258',shape:'stalag'}),
 ]),
});
export function biomePropFamilies(biome){return BIOME_PROP_FAMILIES[biome]||BIOME_PROP_FAMILIES.canyon;}

// Deterministic triangle cost of a scatter list, used to trim the bill without
// changing the placement layout (families are dropped whole, largest last).
export function scatterTriangles(meshes){
 return (Array.isArray(meshes)?meshes:[]).reduce((sum,mesh)=>sum+mesh.count*(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.attributes.position.count)/3,0);
}

export function addScatter(world,{terrain,bounds,seed=1,software=false,wind=false,density=1,detail=1,biome=null,triangleBudget=SCATTER_TRIANGLE_BUDGET}={}){
 if(!terrain||!bounds)return [];
 const minX=bounds.minX??-40,maxX=bounds.maxX??40,minZ=bounds.minZ??-40,maxZ=bounds.maxZ??40,width=maxX-minX,depth=maxZ-minZ;
 // WebGL gets the rounded rocks and denser cones; the CPU guard keeps the base
 // low-poly shells so the software renderer's triangle budget stays bounded.
 // `density` scales instance counts and `detail` the shell tessellation so a
 // quality tier can shrink the triangle bill without changing placement layout.
 const spread=Math.max(0,Math.min(2,Number.isFinite(density)?density:1)),lod=Math.max(0,Math.min(1,Number.isFinite(detail)?detail:1));
 const budget=Number.isFinite(triangleBudget)&&triangleBudget>0?triangleBudget:SCATTER_TRIANGLE_BUDGET;
 const countFor=base=>Math.max(0,Math.round(base*spread));
 const coneSegments=software?3:clamp(Math.round(lod*5),3,5),rockDetail=software?0:lod>=.75?1:0;
 const reserved=Math.min(width,depth)*.3,random=rng(seed+977),meshes=[];
 const swaying=new Set(['grass','fern','bush']);
 const windRandom=rng((seed>>>0)+1313);
 const build=(kind,geometry,material,count,filter,place)=>{
  const mesh=new T.InstancedMesh(geometry,material,count),dummy=new T.Object3D(),color=new T.Color();
  let used=0,attempts=0;
  while(used<count&&attempts<count*14){
   attempts++;
   const x=minX+random()*width,z=minZ+random()*depth;
   if(Math.hypot(x,z)<reserved)continue;
   const support=terrainSupportAt(x,z,terrain);
   if(!support||!filter(support))continue;
   place(dummy,color,x,z,support,random);
   dummy.updateMatrix();
   mesh.setMatrixAt(used,dummy.matrix);
   mesh.setColorAt(used,color);
   used++;
  }
  mesh.count=used;
  mesh.instanceMatrix.needsUpdate=true;
  if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  mesh.frustumCulled=false;mesh.userData.environment=true;mesh.userData.scatter=true;mesh.userData.scatterKind=kind;
  // Capture per-instance base transforms plus a deterministic phase/amplitude so
  // the WebGL renderer can sway the vegetation without per-frame allocation.
  if(wind&&swaying.has(kind)&&used>0){
   const phase=new Float32Array(used),amp=new Float32Array(used);
   for(let i=0;i<used;i++){phase[i]=windRandom()*Math.PI*2;amp[i]=.016+windRandom()*.028;}
   mesh.userData.scatterWind={base:Float32Array.from(mesh.instanceMatrix.array.subarray(0,used*16)),phase,amp};
  }
  if(used>0){world.add(mesh);meshes.push(mesh);}else{geometry.dispose();material.dispose();}
 };
 build('grass',new T.ConeGeometry(.09,.5,coneSegments),new T.MeshStandardMaterial({color:'#8fa05a',roughness:.95,metalness:0,flatShading:true}),countFor(360),
  support=>support.normal[1]>.82&&support.material!=='cliff'&&support.material!=='concrete',
  (dummy,color,x,z,support,random)=>{dummy.position.set(x,support.y+.24,z);dummy.rotation.set(0,random()*Math.PI,0);dummy.scale.set(.7+random()*.7,.7+random()*.9,.7+random()*.7);color.setRGB(.5+random()*.2,.6+random()*.2,.32+random()*.15);});
 build('rock',new T.IcosahedronGeometry(.34,rockDetail),new T.MeshStandardMaterial({color:'#8a8172',roughness:1,metalness:0,flatShading:true}),countFor(150),
  support=>support.normal[1]>.6,
  (dummy,color,x,z,support,random)=>{dummy.position.set(x,support.y+.14,z);dummy.rotation.set(random()*.4,random()*Math.PI,random()*.4);dummy.scale.set(.6+random()*.9,.5+random()*.7,.6+random()*.9);color.setRGB(.52+random()*.16,.49+random()*.14,.44+random()*.12);});
 // Small fern/leaf tufts add low ground variety; WebGL gets rounder cones.
 build('fern',new T.ConeGeometry(.07,.32,coneSegments),new T.MeshStandardMaterial({color:'#6f9a4e',roughness:.95,metalness:0,flatShading:true}),countFor(220),
  support=>support.normal[1]>.8&&support.material!=='cliff'&&support.material!=='concrete',
  (dummy,color,x,z,support,random)=>{dummy.position.set(x,support.y+.12,z);dummy.rotation.set((random()-.5)*.3,random()*Math.PI*2,(random()-.5)*.3);dummy.scale.set(.7+random()*.8,.6+random()*.9,.7+random()*.8);color.setRGB(.34+random()*.16,.5+random()*.2,.24+random()*.12);});
 // Biome-specific families. Each is a single instanced draw using the same
 // terrain-support filter, so a mesa/ice/lava layer reads as part of the ground
 // rather than a placed prop. `emissive` families glow (lava, ember vents).
 for(const family of biome?biomePropFamilies(biome):[]){
  const {kind,shape,color:hex,emissive}=family,count=countFor(family.count);
  if(count<=0)continue;
  const material=new T.MeshStandardMaterial({color:hex,roughness:.95,metalness:0,flatShading:true,...(emissive?{emissive,emissiveIntensity:1.1}:{})});
  const geometry=scatterShape(shape,coneSegments,rockDetail);
  const filter=support=>shape==='ice'?support.normal[1]>.55:support.normal[1]>.6;
  build(kind,geometry,material,count,filter,(dummy,c,x,z,support,random)=>{
   const y=support.y+(shape==='mesa'?.5:shape==='drift'?.05:shape==='vent'?.02:.16);
   dummy.position.set(x,y,z);
   dummy.rotation.set(shape==='mesa'?0:(random()-.5)*.4,random()*Math.PI*2,shape==='mesa'?0:(random()-.5)*.4);
   const s=.7+random()*.7;
   dummy.scale.set(shape==='mesa'?s*1.4:s,s*(shape==='mesa'?1.1:shape==='stalag'?1.5:.8),shape==='mesa'?s*1.4:s);
   c.set(hex);c.offsetHSL(0,0,(random()-.5)*.08);
  });
 }
 // Hard triangle ceiling: drop whole families (largest first) until the bill
 // fits. Placement layout is untouched; only the trailing detail layer shrinks.
 while(meshes.length&&scatterTriangles(meshes)>budget){
  const largest=meshes.reduce((a,b)=>scatterTriangles([b])>scatterTriangles([a])?b:a);
  world.remove(largest);meshes.splice(meshes.indexOf(largest),1);largest.geometry.dispose();largest.material.dispose();
 }
 return meshes;
}

// Scatter shell shapes. Kept as small helpers so the biome families share the
// same low-poly vocabulary and the software renderer always gets cheap shells.
function scatterShape(shape,coneSegments,rockDetail){
 switch(shape){
  case 'mesa':return new T.CylinderGeometry(.55,.85,1.1,coneSegments+1,1);
  case 'shard':return new T.ConeGeometry(.28,.9,coneSegments);
  case 'ice':return new T.ConeGeometry(.4,1.1,coneSegments);
  case 'drift':return new T.SphereGeometry(.5,coneSegments+1,Math.max(2,coneSegments-1));
  case 'bush':return new T.IcosahedronGeometry(.42,rockDetail);
  case 'rubble':return new T.IcosahedronGeometry(.34,rockDetail);
  case 'stalag':return new T.ConeGeometry(.22,1.2,coneSegments);
  case 'vent':return new T.CylinderGeometry(.26,.4,.5,coneSegments);
  default:return new T.IcosahedronGeometry(.34,rockDetail);
 }
}

// Subtle wind sway for the tagged vegetation instanced meshes. Mutates only the
// instance matrices from their captured base transforms; never allocates GPU
// resources. Skipped for any mesh without scatterWind (rocks) and when the CPU
// renderer owns the scene.
export function updateScatterSway(meshes,time,{strength=1}={}){
 if(!Array.isArray(meshes)||!Number.isFinite(time))return 0;
 const baseMatrix=new T.Matrix4(),spin=new T.Matrix4(),leanMatrix=new T.Matrix4(),gain=Number.isFinite(strength)?strength:1;
 let swayed=0;
 for(const mesh of meshes){
  const wind=mesh?.userData?.scatterWind;
  if(!wind||!mesh.isInstancedMesh)continue;
  for(let i=0;i<mesh.count;i++){
   const phase=wind.phase[i],amp=wind.amp[i]*gain;
   const wobble=Math.sin(time*1.7+phase)*amp,lean=Math.cos(time*.9+phase*.5)*amp*.5;
   spin.makeRotationZ(wobble);leanMatrix.makeRotationX(lean);spin.multiply(leanMatrix);
   baseMatrix.fromArray(wind.base,i*16);baseMatrix.multiply(spin);
   mesh.setMatrixAt(i,baseMatrix);swayed++;
  }
  mesh.instanceMatrix.needsUpdate=true;
 }
 return swayed;
}

// Biome/phase ambient particle profile. Pure and deterministic so the view can
// gate the pooled emitters on WebGL without changing the look per frame.
export const AMBIENT_KINDS=Object.freeze(['dust','leaf','ember','ash','snow','spore']);
const AMBIENT_TABLE=Object.freeze({
 dust:{color:'#c9d8e6',size:.03,life:3.6,rate:5,drift:.6,rise:.08,additive:false,smoke:null},
 leaf:{color:'#c9a24a',size:.05,life:4.2,rate:4,drift:1.1,rise:.05,additive:false,smoke:{color:'#8f9a86',size:.3,life:6,rise:.5,rate:2}},
 ember:{color:'#ff9a4c',size:.04,life:3.2,rate:6,drift:.8,rise:.5,additive:true,smoke:{color:'#5b5348',size:.34,life:6.5,rise:.6,rate:2}},
 ash:{color:'#9aa0a6',size:.035,life:4.6,rate:5,drift:.7,rise:.12,additive:false,smoke:{color:'#6f6a63',size:.32,life:6,rise:.55,rate:2}},
 snow:{color:'#eef6ff',size:.045,life:5.4,rate:6,drift:.9,rise:-.06,additive:false,smoke:null},
 spore:{color:'#a8f0c0',size:.035,life:4.4,rate:4,drift:.5,rise:.1,additive:true,smoke:null},
});
// Explicit biome -> ambient particle mapping. An authored `arena.biome` wins so
// procedural maps (dune-ravine, ember-caldera) pick the right motes even when
// their id does not match a legacy regex.
const BIOME_AMBIENT=Object.freeze({canyon:'dust',forest:'leaf',snow:'snow',volcanic:'ember',urban:'dust',ruins:'ash',cavern:'dust'});
export function ambientProfile(arena={},phase='day'){
 const id=String(arena?.id||'').toLowerCase(),declared=BIOME_AMBIENT[String(arena?.biome||'').toLowerCase()];
 let kind=declared||'dust';
 if(!declared){
  if(/snow|frost|ice|glacier|tundra/.test(id))kind='snow';
  else if(/lava|forge|slag|foundry|ember|ashen|sunscar|gauntlet|magma/.test(id))kind='ember';
  else if(/ash|warfront|trench|convoy|derelict|exchange|substation|signal|ironfall/.test(id))kind='ash';
  else if(/gulch|river|titan|sunken|proving|plateau|colosseum|catacomb|atrium|throne|citadel|fortress|longreach/.test(id))kind='leaf';
  else if(/neon|aether|skybreak|skyfall/.test(id))kind='spore';
  else if(phase==='night')kind='dust';
 }
 const table=AMBIENT_TABLE[kind]||AMBIENT_TABLE.dust;
 return Object.freeze({kind,...table});
}

// Deterministic weather layer. Presets are pure data so selection, material
// tinting, fog density and audio mood stay identical between the WebGL and CPU
// renderers. `material` carries the wet/dark tint the view applies to the fog
// and lights; `density` is the fog multiplier and `audio` the ambient bed mood.
export const WEATHER_KINDS=Object.freeze(['clear','overcast','rain','snow','ash','storm']);
export const PRECIP_KINDS=Object.freeze(new Set(['rain','snow','ash','storm']));
const WEATHER_PRESETS=Object.freeze({
 clear:Object.freeze({kind:'clear',particles:0,streakRatio:.4,color:'#cfe0ef',size:.03,life:3.4,speed:5,drift:.4,fall:1,density:1,exposure:1,audio:'default',material:Object.freeze({tint:'#000000',wet:0,dark:0}),lightning:null,wind:1}),
 overcast:Object.freeze({kind:'overcast',particles:0,streakRatio:.4,color:'#c9d3dc',size:.03,life:4,speed:4,drift:.5,fall:1,density:1.12,exposure:.86,audio:'storm',material:Object.freeze({tint:'#2c3540',wet:.04,dark:.06}),lightning:Object.freeze({chance:.12,interval:Object.freeze([5,11]),thunder:Object.freeze([.9,2.4])}),wind:1.25}),
 rain:Object.freeze({kind:'rain',particles:90,streakRatio:1.3,color:'#aebccb',size:.028,life:1.15,speed:17,drift:.25,fall:19,density:1.35,exposure:.8,audio:'storm',material:Object.freeze({tint:'#28323d',wet:.16,dark:.1}),lightning:Object.freeze({chance:.22,interval:Object.freeze([4,9]),thunder:Object.freeze([.7,2])}),wind:1.5}),
 snow:Object.freeze({kind:'snow',particles:72,streakRatio:.4,color:'#eef6ff',size:.045,life:3.4,speed:2.4,drift:1,fall:2.4,density:1.2,exposure:1.04,audio:'cold',material:Object.freeze({tint:'#c3d1de',wet:.05,dark:0}),lightning:null,wind:1.1}),
 ash:Object.freeze({kind:'ash',particles:64,streakRatio:.4,color:'#9aa0a6',size:.035,life:3.8,speed:1.8,drift:.8,fall:.9,density:1.25,exposure:.85,audio:'hot',material:Object.freeze({tint:'#3a3129',wet:0,dark:.12}),lightning:null,wind:1.2}),
 storm:Object.freeze({kind:'storm',particles:130,streakRatio:1.15,color:'#9fb0c2',size:.03,life:1.4,speed:13,drift:.7,fall:15,density:1.6,exposure:.7,audio:'storm',material:Object.freeze({tint:'#1e2833',wet:.22,dark:.16}),lightning:Object.freeze({chance:1,interval:Object.freeze([2.2,5.5]),thunder:Object.freeze([.5,1.6])}),wind:2}),
});
// Per-biome mood, tint and particle character. `biome` names match the level
// generator families so a procedurally built map picks the same ambience.
const BIOME_TABLE=Object.freeze({
 canyon:{biome:'canyon',mood:'hot',tint:'#8a6a44',particles:'dust'},
 forest:{biome:'forest',mood:'default',tint:'#4f7a44',particles:'leaf'},
 snow:{biome:'snow',mood:'cold',tint:'#c7dbe8',particles:'snow'},
 volcanic:{biome:'volcanic',mood:'hot',tint:'#7a3a24',particles:'ember'},
 urban:{biome:'urban',mood:'default',tint:'#6d747b',particles:'dust'},
 ruins:{biome:'ruins',mood:'default',tint:'#9a8258',particles:'ash'},
 cavern:{biome:'cavern',mood:'night',tint:'#4a4550',particles:'dust'},
});
const hashUnit2=(seed,salt=0)=>{let h=(Math.imul(seed>>>0||1,2654435761)^Math.imul((salt|0)+2246822519,3266489917))|0;h=Math.imul(h^(h>>>15),1274126177);h^=h>>>13;h=(h^(h>>>16))>>>0;return h/4294967295;};

// Biome ambience for the arena. Ids win over the raw terrain material so the
// hand-authored maps stay distinct, then the ambient profile is the fallback.
export function biomeAmbience(arena={}){
 const id=String(arena?.id||'').toLowerCase(),declared=String(arena?.biome||'').toLowerCase();
 if(BIOME_TABLE[declared]){const base=BIOME_TABLE[declared];return Object.freeze({biome:base.biome,mood:base.mood,tint:base.tint,particles:base.particles});}
 const byId=(pattern,biome)=>(pattern.test(id)?BIOME_TABLE[biome]:null);
 const direct=byId(/frost|snow|ice|glacier|tundra/,'snow')||byId(/lava|forge|slag|foundry|ember|sunscar|gauntlet|magma|ashen/,'volcanic')||byId(/warfront|trench|ash|derelict|exchange|substation|signal|ironfall/,'ruins')||byId(/gulch|river|titan|sunken|proving|plateau|colosseum|catacomb|atrium|throne|citadel|fortress|longreach/,'forest')||byId(/neon|aether|skybreak|skyfall/,'urban')||byId(/canyon|sunscar|dune/,'canyon');
 const base=direct||BIOME_TABLE.canyon;
 return Object.freeze({biome:base.biome,mood:base.mood,tint:base.tint,particles:base.particles});
}

// Direct preset lookup (used when a caller pins a kind explicitly).
export function weatherPreset(kind){return WEATHER_PRESETS[kind]||WEATHER_PRESETS.clear;}

// Weighted, deterministic weather selection. Clear is always the plurality;
// snow maps snow, ashen maps ash, wet maps rain, and the storm biome can roll a
// full storm. Same arena, mode and seed always resolve to the same preset.
export function selectWeather(arena={},timeOfDay={},seed=1,{reduced=false}={}){
 const id=String(arena?.id||'').toLowerCase();
 if(reduced||arena?.reducedMotion===true)return WEATHER_PRESETS.clear;
 const wet=biomeAmbience(arena).mood,biome=String(arena?.biome||'').toLowerCase();
 const roll=hashUnit2(seed,Math.round(Number(timeOfDay?.t)||0));
 let kind='clear';
 if(biome==='snow')kind=roll<.55?'snow':'clear';
 else if(biome==='volcanic')kind=roll<.36?'ash':'clear';
 else if(biome==='canyon')kind=roll<.3?'overcast':'clear';
 else if(biome==='forest')kind=roll<.3?'overcast':'clear';
 else if(biome==='cavern')kind=roll<.25?'overcast':'clear';
 else if(biome==='ruins')kind=roll<.42?'ash':'clear';
 else if(/snow|frost|ice|glacier|tundra/.test(id))kind=roll<.55?'snow':'clear';
 else if(/lava|forge|slag|foundry|ember|sunscar|ashen|gauntlet|magma/.test(id))kind=roll<.36?'ash':'clear';
 else if(/gulch|river|titan|sunken|proving|plateau|atrium/.test(id))kind=roll<.3?'overcast':'clear';
 else if(/neon|aether|skybreak|skyfall|storm/.test(id))kind=roll<.22?'storm':roll<.5?'rain':roll<.72?'overcast':'clear';
 else if(/warfront|derelict|exchange|substation|signal|ironfall|ruins|trench/.test(id))kind=roll<.42?'ash':'clear';
 else if(wet==='cold'&&roll<.4)kind='snow';
 else if(wet==='hot'&&roll<.28)kind='ash';
 else if(roll<.16)kind='rain';
 else if(roll<.32)kind='overcast';
 return WEATHER_PRESETS[kind]||WEATHER_PRESETS.clear;
}

// Smooth time-of-day. A short cycle is used for menu/showcase modes so a title
// screen visibly drifts through the phases; play modes use a long, slow cycle
// seeded per arena so two maps are not in lockstep. Reduced motion pins the
// arena's authored phase. Pure: elapsed time and arena always map identically.
export const TOD_PERIODS=Object.freeze({menu:90,play:600});
export function timeOfDayAt(arena={},elapsed=0,mode='playing'){
 const authored=skyPhase(arena);
 if(arena?.reducedMotion===true||arena?.timeOfDay===false||arena?.timeOfDayOverride===false)return Object.freeze({phase:authored,t:0,cycle:authored});
 const menu=mode==='selection'||mode==='theater'||mode==='progression',period=menu?TOD_PERIODS.menu:TOD_PERIODS.play;
 const seed=arenaSeedNumber(arena),speed=period*(1+((seed%7)-3)*.05);
 const t=(Number.isFinite(elapsed)?Math.max(0,elapsed):0)/Math.max(30,speed);
 const u=t-Math.floor(t),order=['day','dusk','night','dusk'];
 const index=Math.min(order.length-1,Math.floor(u*order.length)),local=u*order.length-index;
 const current=order[index],next=order[Math.min(order.length-1,index+1)];
 return Object.freeze({phase:local>=.5?next:current,from:current,to:next,blend:local,cycle:current,t});
}
function arenaSeedNumber(arena){return String(arena?.id||'arena').split('').reduce((hash,char)=>(Math.imul(hash,31)+char.charCodeAt(0))>>>0,7);}

// Deterministic precipitation spawns for one frame. Pure: the same serial, kind
// and origin always emit identical particles, so a replay matches visually and
// the CPU renderer (which never calls this) stays byte-identical to a no-op.
export function precipParticleAdds(serial,kind,origin={},radius=9,preset=null){
 const profile=preset&&typeof preset==='object'?preset:WEATHER_PRESETS[kind];if(!profile||!(profile.particles>0))return [];
 const count=Math.max(1,Math.round(profile.particles/6)),r=Math.max(2,Number(radius)||9),ox=Number(origin.x)||0,oy=Number(origin.y)||0,oz=Number(origin.z)||0,streak=Math.max(.1,profile.streakRatio||.4),adds=[];
 for(let i=0;i<count;i++){
  const salt=(serial|0)*17+i*131;
  const a=hashUnit2(salt,1)*Math.PI*2,dist=Math.sqrt(hashUnit2(salt,2))*r;
  const x=ox+Math.cos(a)*dist,z=oz+Math.sin(a)*dist,y=oy+4+hashUnit2(salt,3)*6;
  const life=profile.life*(.8+hashUnit2(salt,4)*.4),fall=profile.fall*(.85+hashUnit2(salt,5)*.3);
  adds.push({pos:{x,y,z},color:profile.color,size:profile.size*(.8+hashUnit2(salt,6)*.5),life,velocity:{x:(hashUnit2(salt,7)-.5)*profile.drift,y:-fall,z:(hashUnit2(salt,8)-.5)*profile.drift},additive:profile.kind==='snow'||profile.kind==='ash',streak});
 }
 return adds;
}

// Deterministic lightning schedule for a storm. Pure: the same seed and window
// always yield the same strikes, so a replay flashes and thunders identically.
// Each strike carries a time offset, a 0..1 brightness, a distance and the
// resulting thunder delay/pan. Presets without a lightning profile return [].
export function lightningSchedule(preset,{seed=1,window=60,count=4}={}){
 const profile=preset?.lightning;if(!profile)return [];
 const [minGap,maxGap]=Array.isArray(profile.interval)?profile.interval:[3,8];
 const [minThunder,maxThunder]=Array.isArray(profile.thunder)?profile.thunder:[.7,2];
 const total=Math.max(0,Math.min(24,Math.round(Number(count)||0))),span=Number.isFinite(window)&&window>0?window:60;
 let state=(seed>>>0)||1;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 // `chance` is the probability this storm produces any lightning at all, so an
 // overcast sky is usually quiet and a full storm almost always rumbles.
 if(random()>(Number.isFinite(profile.chance)?profile.chance:1))return [];
 const strikes=[];let t=random()*Math.max(.2,minGap);
 for(let i=0;i<total&&t<span;i++){
  const distance=.35+random()*.65,intensity=.5+random()*.5,thunderGain=minThunder+random()*Math.max(0,maxThunder-minThunder);
  strikes.push(Object.freeze({time:t,intensity,distance,thunderGain,thunderDelay:.12+distance*1.7,pan:random()*2-1}));
  t+=Math.max(.2,minGap)+random()*Math.max(0,maxGap-minGap);
 }
 return strikes;
}

// Smooth deterministic wind gust multiplier. `time` in seconds, `seed` fixes
// the phase so two clients agree. Returns a bounded ~0.4..1.7 scale the view
// applies to vegetation sway and particle drift. `strength` scales the swing.
export function windGustAt(time,{seed=1,strength=1}={}){
 const t=Number.isFinite(time)?time:0,s=(seed>>>0)||1;
 const p1=hashUnit2(s,1)*Math.PI*2,p2=hashUnit2(s,2)*Math.PI*2,p3=hashUnit2(s,3)*Math.PI*2;
 const raw=.5+.5*Math.sin(t*.21+p1)+.28*Math.sin(t*.53+p2)+.14*Math.sin(t*1.07+p3);
 const norm=Math.max(0,Math.min(1,raw/1.92)),amp=Math.max(0,Math.min(2,Number.isFinite(Number(strength))?Number(strength):1));
 return Math.max(.4,Math.min(1.7,1+(norm-.5)*amp*1.3));
}

// Wet-surface look for a given wetness (0..1). Pure so the view can apply the
// same sheen to floor materials on WebGL while the CPU renderer reads only the
// scalar fields. `roughness` scales the base roughness, `metalness` adds a
// damp gloss and `sheen` drives a subtle additive highlight.
export function wetSheen(wetness=0){
 const w=clamp(Number.isFinite(wetness)?wetness:0,0,1);
 return Object.freeze({wetness:w,roughness:1-w*.55,metalness:Math.min(.35,w*.3),sheen:w*.5,reflection:w});
}

// Deterministic distant-smoke anchor points inside the arena footprint. Pure:
// the same bounds and seed always yield the same emitters.
export function smokeAnchors(bounds,seed=1,count=4){
 const minX=bounds?.minX??-40,maxX=bounds?.maxX??40,minZ=bounds?.minZ??-40,maxZ=bounds?.maxZ??40;
 let state=((seed>>>0)||1);const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const total=Math.max(0,Math.min(12,Math.round(count)||0)),anchors=[];
 for(let i=0;i<total;i++)anchors.push({x:minX+random()*(maxX-minX),y:.4,z:minZ+random()*(maxZ-minZ)});
 return anchors;
}
