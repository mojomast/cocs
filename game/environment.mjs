import * as T from 'three';
import {terrainSupportAt} from './terrain.mjs';
import {clamp} from './math.mjs';

// Procedural backdrop: a vertex-colored gradient dome, a single-draw-call ring
// of distant low-poly mountains, and instanced terrain scatter. Nothing here is
// loaded from disk and every mesh is disposable by the caller's world teardown.

const rng=seed=>{let state=seed>>>0;return()=>{state=(state+0x6d2b79f5)|0;let t=Math.imul(state^(state>>>15),1|state);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};};

export function addSky(world,{background='#090f17',radius=185}={}){
 const base=new T.Color(background),zenith=base.clone().lerp(new T.Color('#ffffff'),.38),horizon=base.clone().lerp(new T.Color('#ffffff'),.06),ground=base.clone().lerp(new T.Color('#000000'),.55);
 const geometry=new T.SphereGeometry(radius,24,16),position=geometry.attributes.position,colors=new Float32Array(position.count*3),color=new T.Color();
 for(let i=0;i<position.count;i++){
  const t=clamp(position.getY(i)/radius,-1,1);
  if(t>=0)color.copy(horizon).lerp(zenith,t*t*.85);else color.copy(horizon).lerp(ground,Math.min(1,-t*1.4));
  colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;
 }
 geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 const material=new T.MeshBasicMaterial({vertexColors:true,side:T.BackSide,fog:false,depthWrite:false});
 const mesh=new T.Mesh(geometry,material);
 mesh.frustumCulled=false;mesh.renderOrder=-1;mesh.userData.environment=true;mesh.userData.sky=true;
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
