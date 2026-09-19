import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView} from './view.mjs';
import {LATTICE_MAPS} from './lattice-maps.mjs';
import {timeOfDayAt} from './environment.mjs';

test('Foundry builds faithful terrain with bounded art batches and releases a rebuilt scene',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>ctx})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 // Software flag disables texture baking and atmosphere. Then invoke the real
 // WebGL block batching pass explicitly to measure the static arena submission.
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),renderResources:new Set(),renderer:{isSoftware:true}});
 view.scene.add(new T.HemisphereLight(),new T.DirectionalLight());
 const map=LATTICE_MAPS[0];
 for(const time of [0,300,900])assert.equal(timeOfDayAt(map,time,'playing').phase,'day','theatre lighting stays readable for the whole match');
 const build=()=>{
  view.buildArena(map);
  assert.ok(view.worldGroup.children.filter(n=>n.userData.arenaDetail).length<=8);
  const terrain=view.worldGroup.children.filter(n=>n.userData.terrain);
  assert.equal(terrain.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),map.terrain.surfaces.reduce((n,s)=>n+s.triangles.length,0));
  for(const n of view.worldGroup.children.filter(n=>Number.isInteger(n.userData.block))){
   const b=map.blocks[n.userData.block];assert.deepEqual(n.position.toArray(),[b.x,b.h/2,b.z]);
  }
  view.renderer={isWebGLRenderer:true};view._batchArenaBlocks(view.worldGroup);view.renderer={isSoftware:true};
  let triangles=0,calls=0;
  view.worldGroup.traverse(n=>{if(!n.visible||!n.isMesh)return;calls++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});
  assert.ok(calls<180,`static submission ${calls} calls`);
  assert.ok(triangles<90000,`static triangles ${triangles}`);
  return {calls,triangles};
 };
 const first=build(),resources=new Set();
 view.updateObjectives({time:0,objectives:{kind:'cocs',nodes:map.nodes,traversal:{
  devices:map.traversal.map(d=>({id:d.id,x:d.from.x,z:d.from.z,state:'live'})),
  depots:map.depots.map(d=>({id:d.id,x:d.x,z:d.z,owner:d.team})),
  arrivals:[{id:'probe',x:0,z:25,telegraph:true,remaining:1}],
 }}},map);
 for(const d of map.traversal)assert.equal(view.objectiveModels.get(`traversal:device:${d.id}`).position.y,d.from.y);
 for(const d of map.depots)assert.equal(view.objectiveModels.get(`traversal:depot:${d.id}`).position.y,d.y);
 assert.equal(view.objectiveModels.get('traversal:arrival:probe').position.y,1,'sunken arrival marker uses its real floor');
 for(const n of map.nodes){
  const marker=view.objectiveModels.get(n.id),area=marker.userData.area;
  assert.equal(area.geometry.type,'RingGeometry','capture areas have no filled disk');
  assert.ok(area.material.opacity<=.36,'terrain stays readable beneath capture boundaries');
  assert.ok(area.geometry.parameters.innerRadius>=n.r-.3,'only a narrow perimeter band is painted');
 }
 view.worldGroup.traverse(n=>{if(n.geometry)resources.add(n.geometry);if(n.material){resources.add(n.material);if(n.material.map)resources.add(n.material.map);}});
 for(const r of view.renderResources)resources.add(r);
 const counts=new Map([...resources].map(r=>[r,0]));
 for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));
 const second=build();assert.deepEqual(second,first);
 assert.ok([...counts.values()].every(n=>n===1),'each replaced resource disposed once');
 console.log(`Foundry static render: ${first.calls} mesh submissions, ${first.triangles} triangles (before culling; excludes sky/actors)`);
 view.disposeObject(view.worldGroup);for(const r of view.renderResources)r.dispose();
});
