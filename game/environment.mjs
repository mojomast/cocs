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
export function skyPalette(background='#090f17',phase='day'){
 const base=new T.Color(background),mix=(target,amount)=>'#'+base.clone().lerp(new T.Color(target),amount).getHexString();
 if(phase==='night')return Object.freeze({zenith:mix('#050912',.62),horizon:mix('#16233d',.4),ground:mix('#000000',.72),star:'#ffffff',starDim:'#9fb6ff',disk:'#e6ecff',diskGlow:'#7fa6ff',halo:'#8fe6ff'});
 if(phase==='dusk')return Object.freeze({zenith:mix('#1b1436',.5),horizon:mix('#ff8a4c',.5),ground:mix('#000000',.6),star:'#fff2cf',starDim:'#ffb27a',disk:'#ffb066',diskGlow:'#ff7a3c',halo:'#ffd9a0'});
 return Object.freeze({zenith:mix('#ffffff',.4),horizon:mix('#ffffff',.08),ground:mix('#000000',.5),star:'#ffffff',starDim:'#cfe4ff',disk:'#fff3c4',diskGlow:'#ffd98a',halo:'#bff0ff'});
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
 const zenith=new T.Color(palette.zenith),horizon=new T.Color(palette.horizon),ground=new T.Color(palette.ground);
 const geometry=new T.SphereGeometry(radius,24,16),position=geometry.attributes.position,colors=new Float32Array(position.count*3),color=new T.Color();
 for(let i=0;i<position.count;i++){
  const t=clamp(position.getY(i)/radius,-1,1);
  if(t>=0)color.copy(horizon).lerp(zenith,t*t*.85);else color.copy(horizon).lerp(ground,Math.min(1,-t*1.4));
  colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;
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
 if(halo){
  const ring=new T.Mesh(new T.TorusGeometry(radius*.62,radius*.006,6,96),new T.MeshBasicMaterial({color:palette.halo,fog:false,depthWrite:false,transparent:true,opacity:.55,blending:T.AdditiveBlending}));
  ring.rotation.x=Math.PI*.5;ring.frustumCulled=false;ring.renderOrder=-1;ring.userData.environment=true;ring.userData.halo=true;
  mesh.add(ring);
 }
 world.add(mesh);
 return mesh;
}

export function addMountains(world,{background='#090f17',radius=150,count=26,seed=1,base=-10}={}){
 const random=rng(seed),geometry=new T.ConeGeometry(1,1,5,1),haze=new T.Color(background),rock=new T.Color('#4d4636');
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

export function addScatter(world,{terrain,bounds,seed=1}={}){
 if(!terrain||!bounds)return [];
 const minX=bounds.minX??-40,maxX=bounds.maxX??40,minZ=bounds.minZ??-40,maxZ=bounds.maxZ??40,width=maxX-minX,depth=maxZ-minZ;
 const reserved=Math.min(width,depth)*.3,random=rng(seed+977),meshes=[];
 const build=(geometry,material,count,filter,place)=>{
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
  mesh.frustumCulled=false;mesh.userData.environment=true;mesh.userData.scatter=true;
  if(used>0){world.add(mesh);meshes.push(mesh);}else{geometry.dispose();material.dispose();}
 };
 build(new T.ConeGeometry(.09,.5,3),new T.MeshStandardMaterial({color:'#8fa05a',roughness:.95,metalness:0,flatShading:true}),360,
  support=>support.normal[1]>.82&&support.material!=='cliff'&&support.material!=='concrete',
  (dummy,color,x,z,support,random)=>{dummy.position.set(x,support.y+.24,z);dummy.rotation.set(0,random()*Math.PI,0);dummy.scale.set(.7+random()*.7,.7+random()*.9,.7+random()*.7);color.setRGB(.5+random()*.2,.6+random()*.2,.32+random()*.15);});
 build(new T.IcosahedronGeometry(.34,0),new T.MeshStandardMaterial({color:'#8a8172',roughness:1,metalness:0,flatShading:true}),150,
  support=>support.normal[1]>.6,
  (dummy,color,x,z,support,random)=>{dummy.position.set(x,support.y+.14,z);dummy.rotation.set(random()*.4,random()*Math.PI,random()*.4);dummy.scale.set(.6+random()*.9,.5+random()*.7,.6+random()*.9);color.setRGB(.52+random()*.16,.49+random()*.14,.44+random()*.12);});
 return meshes;
}
