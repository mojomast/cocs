import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {addSky,addMountains,addScatter} from './environment.mjs';
import {ArenaView} from './view.mjs';

const bounds={minX:-40,maxX:40,minZ:-40,maxZ:40};
const flatTerrain=()=>({surfaces:[{id:'ground',material:'grass',walkable:true,vertices:[[-40,0,-40],[40,0,-40],[40,0,40],[-40,0,40]],triangles:[[0,2,1],[0,3,2]]}]});
const emptyTerrain=()=>({surfaces:[]});
const decomposed=mesh=>{const matrix=new T.Matrix4(),position=new T.Vector3(),quaternion=new T.Quaternion(),scale=new T.Vector3();return index=>{mesh.getMatrixAt(index,matrix);matrix.decompose(position,quaternion,scale);return {position:position.clone(),scale:scale.clone()};};};

test('the sky dome is a finite, environment-tagged scene node',()=>{
 const world=new T.Group();
 const sky=addSky(world,{background:'#090f17',radius:120});
 assert.equal(world.children.length,1);
 assert.ok(sky.isMesh);
 assert.equal(sky.userData.environment,true);
 assert.equal(sky.userData.sky,true);
 assert.equal(sky.renderOrder,-1);
 assert.equal(sky.frustumCulled,false);
 const colors=sky.geometry.getAttribute('color');
 assert.ok(colors&&colors.count>0);
 for(const value of colors.array)assert.ok(Number.isFinite(value));
});

test('the mountain backdrop is one instanced mesh with finite transforms',()=>{
 const world=new T.Group();
 const count=18,mesh=addMountains(world,{background:'#090f17',radius:140,count,seed:7,base:-10});
 assert.equal(world.children.length,1);
 assert.ok(mesh.isInstancedMesh);
 assert.equal(mesh.count,count);
 assert.equal(mesh.userData.environment,true);
 assert.equal(mesh.userData.mountains,true);
 assert.ok(mesh.instanceColor&&mesh.instanceColor.count===count);
 const at=decomposed(mesh);
 for(let i=0;i<count;i++){
  const {position,scale}=at(i);
  assert.ok(Number.isFinite(position.x)&&Number.isFinite(position.y)&&Number.isFinite(position.z));
  assert.ok(scale.x>0&&scale.y>0&&scale.z>0);
 }
});

test('terrain scatter stays in bounds and produces finite instances',()=>{
 const world=new T.Group();
 const meshes=addScatter(world,{terrain:flatTerrain(),bounds,seed:3});
 assert.ok(meshes.length>0);
 for(const mesh of meshes){
  assert.equal(mesh.userData.environment,true);
  assert.equal(mesh.userData.scatter,true);
  assert.ok(mesh.isInstancedMesh);
  assert.ok(mesh.count>0);
  const at=decomposed(mesh);
  for(let i=0;i<mesh.count;i++){
   const {position,scale}=at(i);
   assert.ok(position.x>=bounds.minX&&position.x<=bounds.maxX,`scatter x ${position.x}`);
   assert.ok(position.z>=bounds.minZ&&position.z<=bounds.maxZ,`scatter z ${position.z}`);
   assert.ok(Number.isFinite(position.y));
   assert.ok(scale.x>0&&scale.y>0&&scale.z>0);
  }
 }
});

test('scatter skips missing terrain and unsupported ground without throwing',()=>{
 const world=new T.Group();
 assert.deepEqual(addScatter(world,{}),[]);
 assert.deepEqual(addScatter(world,{terrain:flatTerrain()}),[]);
 assert.deepEqual(addScatter(world,{terrain:emptyTerrain(),bounds}),[]);
 assert.equal(world.children.length,0);
});

test('the environment builders tolerate default and reduced-motion options alike',()=>{
 for(const options of [{},{reducedMotion:true}]){
  const world=new T.Group();
  addSky(world,{background:'#0a0f1e',radius:100,...options});
  addMountains(world,{background:'#0a0f1e',radius:120,count:8,seed:5,base:-8,...options});
  addScatter(world,{terrain:flatTerrain(),bounds,seed:5,...options});
  assert.ok(world.children.length>=3);
  for(const child of world.children)assert.equal(child.userData.environment,true);
 }
});

test('the view reduced-motion gate still keeps the static backdrop',()=>{
 const view=Object.create(ArenaView.prototype);
 view.display={reducedMotion:true};view.motionQuery={matches:false};
 assert.equal(view.reduced(),true);
 view.display={reducedMotion:false};view.motionQuery={matches:true};
 assert.equal(view.reduced(),true);
 view.display={reducedMotion:false};view.motionQuery={matches:false};
 assert.equal(view.reduced(),false);
});
