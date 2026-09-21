import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView,paintGeometry} from './view.mjs';
import {facadeFrame} from './structures.mjs';
import {updateRace} from './race-presentation.mjs';

const arena=(id='resource-a')=>({
 id,name:id,color:'#87c6dd',background:'#142335',bounds:{minX:-24,maxX:24,minZ:-24,maxZ:24},
 platforms:[{x:0,z:0,y:0,w:40,d:40}],
 blocks:[{x:5,z:5,w:2,h:3,d:2},{x:8,z:5,w:2,h:3,d:2}],
 ceilings:[{x:5,y:9,z:5,w:2,h:3,d:2},{x:8,y:9,z:5,w:2,h:3,d:2}],
 structures:[
  {type:'windows',rows:4,frame:facadeFrame({x:6,y:0,z:6,w:18,d:12,h:9,rot:.37},'south')},
  {type:'facade-detail',rows:3,frame:facadeFrame({x:6,y:0,z:6,w:18,d:12,h:9,rot:.37},'east')},
  {type:'windows',x:5,y:2,z:5,w:12,rows:3,rot:0},
 ],
 props:[{type:'ruin',x:7,y:0,z:7,scale:1.2,seed:4},{type:'ruin',x:10,y:0,z:8,scale:.8,seed:5}],
});
const fixture=()=>Object.assign(Object.create(ArenaView.prototype),{
 scene:new T.Scene(),renderResources:new Set(),sharedResources:new Set(),renderer:{isSoftware:true,dispose(){}},
 menu:{scene:new T.Scene()},_disposeLabTargets(){},_clearDebugDeaths(){},clearFreeMotion(){},resetFreeCam(){},
});

test('large arena camera range includes the whole overview and resets on a compact map',()=>{
 const view=fixture();view.camera=new T.PerspectiveCamera(82,1,.08,220);
 const wide=arena('large-destination');wide.bounds={minX:-120,maxX:120,minZ:-80,maxZ:80};
 view.buildArena(wide);assert.ok(view.camera.far>Math.hypot(240,160)*2);
 view.buildArena(arena());assert.equal(view.camera.far,220);view.dispose();
});

test('soccer ball panel geometry is released on every arena replacement',()=>{
 const view=fixture();view.reduced=()=>true;
 for(let i=0;i<3;i++){
  view.buildArena(arena(`soccer-${i}`));
  updateRace(view,{race:{kind:'soccer',ball:{x:0,y:1.1,z:0,r:1.1}}},0);
  const ball=view.raceModels.get('soccer-ball'),panels=ball.children.map(n=>n.geometry),counts=track(panels);
  for(const geometry of panels)assert.equal(view.sharedResources.has(geometry),false,'per-ball panels are not lifetime cache entries');
  view.buildArena(arena(`return-${i}`));disposedOnce(counts);
 }
 view.dispose();
});
const resources=view=>{
 const result=new Set([...view.renderResources,...view.arenaAssets.resources]);
 view.worldGroup.traverse(n=>{
  if(n.geometry)result.add(n.geometry);
  for(const m of n.material?(Array.isArray(n.material)?n.material:[n.material]):[]){
   result.add(m);for(const key of ['map','normalMap','roughnessMap'])if(m[key])result.add(m[key]);
  }
 });
 return result;
};
const track=list=>{
 const counts=new Map([...list].map(r=>[r,0]));
 for(const r of counts.keys())r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));
 return counts;
};
const disposedOnce=counts=>{for(const [resource,count] of counts)assert.equal(count,1,`${resource.type||resource.constructor.name} ${resource.uuid} disposed once`);};

test('arena A → B → A replaces cache ownership and releases attached and detached resources once',()=>{
 const view=fixture(),a=arena(),b=arena('resource-b');b.blocks[0].w=3;
 const build=map=>{
  view.buildArena(map);
  view.renderer.isWebGLRenderer=true;view._batchArenaBlocks(view.worldGroup);view.renderer.isWebGLRenderer=false;
 };
 build(a);
 const firstCache=view.arenaAssets,firstCacheSize=firstCache.resources.size,firstResources=resources(view),firstCounts=track(firstResources);
 const primitive=firstCache.geometries.get('b|2|3|2');assert.ok(primitive);
 // Disposing a removed child cannot release an asset still shared by this map.
 const detached=new T.Group(),cachedMat=firstCache.materials.values().next().value;
 detached.add(new T.Mesh(primitive,cachedMat));view.disposeObject(detached);
 assert.equal(firstCounts.get(primitive),0);assert.equal(firstCounts.get(cachedMat),0);
 const attached=new Set();view.worldGroup.traverse(n=>{if(n.geometry)attached.add(n.geometry);});
 assert.ok([...view.renderResources].some(r=>r.isBufferGeometry&&!attached.has(r)),'detached batch sources retain an owner');
 build(b);disposedOnce(firstCounts);assert.equal(firstCache.resources.size,0);assert.equal(firstCache.geometries.size,0);
 assert.notEqual(view.arenaAssets,firstCache);
 const secondCache=view.arenaAssets,secondCounts=track(resources(view));
 build(a);disposedOnce(secondCounts);assert.equal(secondCache.resources.size,0);
 assert.notEqual(view.arenaAssets.geometries.get('b|2|3|2'),primitive,'revisited maps get live primitives');
 assert.equal(view.arenaAssets.resources.size,firstCacheSize,'A returns to its original bounded cache size');
 const finalCounts=track(resources(view));view.dispose();disposedOnce(finalCounts);
 assert.equal(view.arenaAssets,null);assert.equal(view.renderResources.size,0);
});

test('duplicate-size blocks have independent seeded paint and leave cached primitives immutable',()=>{
 const view=fixture(),map=arena();view.buildArena(map);
 const blocks=view.worldGroup.children.filter(n=>Number.isInteger(n.userData.block)),primitive=view.arenaAssets.geometries.get('b|2|3|2');
 assert.equal(blocks.length,2);assert.ok(primitive);assert.equal(primitive.getAttribute('color'),undefined);
 assert.notEqual(blocks[0].geometry,blocks[1].geometry);assert.notEqual(blocks[0].geometry,primitive);
 assert.equal(blocks[0].material,blocks[1].material,'materials still share within a map');
 const ceilings=view.worldGroup.children.filter(n=>Number.isInteger(n.userData.ceiling));
 assert.equal(ceilings.length,2);for(const ceiling of ceilings)assert.equal(ceiling.geometry,primitive,'unpainted duplicate-size meshes keep sharing the pristine primitive');
 const seed=[...map.id].reduce((hash,char)=>(Math.imul(hash,31)+char.charCodeAt(0))>>>0,7);
 for(const [i,block] of blocks.entries()){
  const expected=paintGeometry(primitive.clone(),seed+i*13+1,.16);
  assert.deepEqual(block.geometry.attributes.color.array,expected.attributes.color.array);expected.dispose();
  assert.deepEqual(block.position.toArray(),[map.blocks[i].x,map.blocks[i].h/2,map.blocks[i].z]);
 }
 assert.notDeepEqual(blocks[0].geometry.attributes.color.array,blocks[1].geometry.attributes.color.array);
 view.dispose();
});

test('facade and ruin batching preserves authored solids, transforms and triangle counts',()=>{
 const view=fixture(),map=arena(),solids=structuredClone(map.blocks);view.buildArena(map);
 const candidates=view.worldGroup.children.filter(n=>n.userData.facadeDetail||n.userData.ruinDetail);
 assert.ok(candidates.length>30);assert.ok(candidates.some(n=>n.userData.ruinDetail));
 const triangles=meshes=>meshes.reduce((sum,n)=>sum+(n.geometry.index?.count??n.geometry.attributes.position.count)/3,0);
 const before=triangles(candidates),bounds=new T.Box3();for(const n of candidates)bounds.union(new T.Box3().setFromObject(n));
 view.renderer.isWebGLRenderer=true;view._batchArenaBlocks(view.worldGroup);
 const after=view.worldGroup.children.filter(n=>n.userData.architectureBatch||n.userData.facadeDetail||n.userData.ruinDetail);
 assert.equal(triangles(after),before);assert.ok(after.length<candidates.length/2);
 const mergedBounds=new T.Box3();for(const n of after)mergedBounds.union(new T.Box3().setFromObject(n));
 assert.ok(bounds.min.distanceTo(mergedBounds.min)<1e-5);assert.ok(bounds.max.distanceTo(mergedBounds.max)<1e-5);
 assert.deepEqual(map.blocks,solids);assert.equal(view.worldGroup.userData.blockBatchCount,2);
 view.dispose();
});

test('static batches bound dense cells and preserve vertex attributes and render flags',()=>{
 const view=fixture(),world=new T.Group();view.scene.add(world);view.worldGroup=world;
 const material=new T.MeshStandardMaterial(),geometry=paintGeometry(new T.BoxGeometry(1,2,3),12),sources=[];
 for(let i=0;i<300;i++){
  const mesh=new T.Mesh(geometry,material);mesh.position.set(5+i*.01,2,6);mesh.rotation.set(.2,.3,.1);mesh.scale.set(1.2,.8,1.7);
  mesh.userData.facadeDetail=true;mesh.receiveShadow=true;mesh.renderOrder=2;mesh.layers.set(3);world.add(mesh);sources.push(mesh);
 }
 const expected=sources.map(mesh=>{mesh.updateMatrix();return mesh.geometry.clone().applyMatrix4(mesh.matrix);});
 view.renderer.isWebGLRenderer=true;assert.equal(view._batchArenaBlocks(world),3);
 assert.equal(world.userData.architectureBatchCount,300);
 let offset=0;
 for(const batch of world.children){
  assert.ok(batch.userData.staticMeshes<=128);assert.equal(batch.material,material);assert.equal(batch.castShadow,false);assert.equal(batch.receiveShadow,true);assert.equal(batch.renderOrder,2);assert.equal(batch.layers.mask,8);
  for(const key of ['position','normal','uv','color']){
   const actual=batch.geometry.attributes[key].array,wanted=expected.slice(offset,offset+batch.userData.staticMeshes).flatMap(g=>Array.from(g.attributes[key].array));
   assert.equal(actual.length,wanted.length);for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-wanted[i])<1e-6,`${key}[${i}]`);
  }
  offset+=batch.userData.staticMeshes;
 }
 assert.equal(offset,300);for(const g of expected)g.dispose();
 view.dispose();
});

test('static batching leaves transparent, invisible and instanced meshes independent',()=>{
 const view=fixture(),world=new T.Group();view.scene.add(world);view.worldGroup=world;
 const geometry=new T.BoxGeometry(),opaque=new T.MeshBasicMaterial(),transparent=new T.MeshBasicMaterial({transparent:true,opacity:.5});
 for(let i=0;i<2;i++)for(const mesh of [new T.Mesh(geometry,transparent),new T.Mesh(geometry,opaque),new T.InstancedMesh(geometry,opaque,1)]){
  mesh.userData.facadeDetail=true;if(mesh.material===opaque&&!mesh.isInstancedMesh)mesh.visible=false;world.add(mesh);
 }
 view.renderer.isWebGLRenderer=true;assert.equal(view._batchArenaBlocks(world),0);assert.equal(world.children.length,6);
 view.dispose();
});
