import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {WEAPON_BUILDERS,buildWeaponBody} from './weapon-models/index.mjs';
import {solveSightPose,projectSightPoint,attachOptic} from './sights.mjs';
import {buildSimpleWeaponBody} from './weapon-models/chassis.mjs';

// Real Three geometry, shared caches like the renderer, no browser or view import.
function context(){
 const geometries=new Map(),materials=new Map();
 const geo=(key,make)=>{if(!geometries.has(key))geometries.set(key,make());return geometries.get(key);};
 const material=(color,metal=.5,rough=.5,emissive=false)=>{const key=[color,metal,rough,emissive].join('|');if(!materials.has(key))materials.set(key,new T.MeshStandardMaterial({color,metalness:metal,roughness:rough}));return materials.get(key);};
 const mesh=(p,g,m,x,y,z)=>{const n=new T.Mesh(g,m);n.position.set(x,y,z);p.add(n);return n;};
 const box=(p,w,h,d,x,y,z,m)=>{const n=mesh(p,geo('box',()=>new T.BoxGeometry()),m,x,y,z);n.scale.set(w,h,d);return n;};
 const cylinder=(p,r1,r2,h,x,y,z,m,s=12)=>mesh(p,geo(`c:${r1}:${r2}:${h}:${s}`,()=>new T.CylinderGeometry(r1,r2,h,s)),m,x,y,z);
 const ring=(p,r,t,x,y,z,m,rx=0)=>{const n=mesh(p,geo(`r:${r}:${t}`,()=>new T.TorusGeometry(r,t,6,16)),m,x,y,z);n.rotation.x=rx;return n;};
 return {T,geo,material,box,cylinder,ring,palette:{dark:material('#222f37'),light:material('#73848a'),glow:material('#80ffff')},geometries,materials};
}
const meshes=g=>{const a=[];g.traverse(n=>{if(n.isMesh)a.push(n);});return a;};

test('ten bodies provide bounded distinct silhouettes and actual mechanisms',()=>{
 const ctx=context(),signatures=[];
 for(let type=0;type<10;type++){
  const g=new T.Group();WEAPON_BUILDERS[type](g,ctx);
  for(const role of ['receiver','barrel','stock','grip','feed'])assert.ok(g.getObjectByName(role),`${type}: ${role}`);
  assert.ok(g.userData.parts.bolt?.children.length,`${type}: moving bolt geometry`);
  assert.ok(g.userData.parts.magazine?.children.length,`${type}: moving feed geometry`);
  if(type===2||type===3){const moving=type===2?g.userData.parts.cell:g.userData.parts.barrel;assert.ok(new T.Box3().setFromObject(moving).containsPoint(moving.position),`${type}: rotation pivot lies on mechanism rather than world origin`);}
  const m=meshes(g);assert.ok(m.length<=48,`${type}: ${m.length} body meshes`);
  for(const n of m){assert.equal(n.material.depthTest,true);assert.ok([...n.position,...n.scale].every(Number.isFinite));}
  const size=new T.Box3().setFromObject(g).getSize(new T.Vector3());
  assert.ok(size.z<1.7&&size.y<.85,`${type}: credible envelope ${size.toArray()}`);
  signatures.push(size.toArray().join(','));
 }
 assert.equal(new Set(signatures).size,10);
 const resources=[ctx.geometries.size,ctx.materials.size];
 for(let type=0;type<10;type++)buildWeaponBody(type,new T.Group(),ctx);
 assert.deepEqual([ctx.geometries.size,ctx.materials.size],resources,'repeat builds allocate no new cached resources');
});

test('every open sight has physical short mounts and an unobstructed target ray',()=>{
 for(let type=0;type<10;type++){
  const g=new T.Group(),ctx=context();buildWeaponBody(type,g,ctx);g.updateMatrixWorld(true);
  const {rear,front}=g.userData.sights;
  const pose=solveSightPose(rear,front,{scale:1.1,distance:.82});
  for(const point of [rear,front]){const projected=projectSightPoint(point,pose,1.1);assert.ok(Math.hypot(projected.x,projected.y)<1e-8);assert.ok(projected.z<-.05);}
  const mounts=meshes(g).filter(n=>n.userData.sightMount);
  assert.ok(mounts.length>=2,`${type}: seated mounts`);
  for(const n of mounts){const bounds=new T.Box3().setFromObject(n);assert.ok(bounds.max.y-bounds.min.y<.09,`${type}: no tall riser`);assert.ok(bounds.min.y<=g.userData.chassis.top+.025,`${type}: rail contact`);}
  const ray=new T.Raycaster(new T.Vector3(rear.x,rear.y+.003,.5),new T.Vector3(0,0,-1),0,2);
  assert.equal(ray.intersectObject(g,true).length,0,`${type}: clear target above front tip`);
 }
});

test('simple bodies retain ten silhouettes in five meshes with shared resources',()=>{
 const ctx=context(),shapes=[];
 for(let type=0;type<10;type++){
  const g=new T.Group();buildSimpleWeaponBody(type,g,ctx);
  assert.equal(meshes(g).length,5);assert.equal(g.userData.simple,true);
  shapes.push(new T.Box3().setFromObject(g).getSize(new T.Vector3()).toArray().join(','));
  const bounds=new T.Box3().setFromObject(g.getObjectByName('barrel'));
  assert.ok(Math.abs(bounds.min.z-g.userData.muzzlePoint[2])<1e-6);
 }
 assert.equal(new Set(shapes).size,10);
});

test('attachment optics replace built-in iron assemblies rather than stacking obstructions',()=>{
 for(const kind of ['holo','scope']){
  const g=new T.Group(),ctx=context();buildWeaponBody(0,g,ctx);
  const old=g.userData.sightAssembly;
  const s=g.userData.sights;
  const optic=attachOptic(g,ctx,kind,null,{x:0,y:s.rear.y,z:-.15});
  assert.equal(old?.visible,false,'built-in iron assembly is hidden');
  assert.equal(optic.kind,kind);
  assert.ok(meshes(g).some(n=>n.userData.sightMount&&n.parent!==old));
 }
});
