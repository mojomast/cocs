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

export function addScatter(world,{terrain,bounds,seed=1,software=false,wind=false,density=1,detail=1}={}){
 if(!terrain||!bounds)return [];
 const minX=bounds.minX??-40,maxX=bounds.maxX??40,minZ=bounds.minZ??-40,maxZ=bounds.maxZ??40,width=maxX-minX,depth=maxZ-minZ;
 // WebGL gets the rounded rocks and denser cones; the CPU guard keeps the base
 // low-poly shells so the software renderer's triangle budget stays bounded.
 // `density` scales instance counts and `detail` the shell tessellation so a
 // quality tier can shrink the triangle bill without changing placement layout.
 const spread=Math.max(0,Math.min(2,Number.isFinite(density)?density:1)),lod=Math.max(0,Math.min(1,Number.isFinite(detail)?detail:1));
 const countFor=base=>Math.max(0,Math.round(base*spread));
 const coneSegments=software?3:clamp(Math.round(lod*5),3,5),rockDetail=software?0:lod>=.75?1:0;
 const reserved=Math.min(width,depth)*.3,random=rng(seed+977),meshes=[];
 const swaying=new Set(['grass','fern']);
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
 return meshes;
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
export function ambientProfile(arena={},phase='day'){
 const id=String(arena?.id||'').toLowerCase();
 let kind='dust';
 if(/snow|frost|ice|glacier|tundra/.test(id))kind='snow';
 else if(/lava|forge|slag|foundry|ember|ashen|sunscar|gauntlet|magma/.test(id))kind='ember';
 else if(/ash|warfront|trench|convoy|derelict|exchange|substation|signal|ironfall/.test(id))kind='ash';
 else if(/gulch|river|titan|sunken|proving|plateau|colosseum|catacomb|atrium|throne|citadel|fortress|longreach/.test(id))kind='leaf';
 else if(/neon|aether|skybreak|skyfall/.test(id))kind='spore';
 else if(phase==='night')kind='dust';
 const table=AMBIENT_TABLE[kind]||AMBIENT_TABLE.dust;
 return Object.freeze({kind,...table});
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
