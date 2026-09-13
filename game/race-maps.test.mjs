import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS,getMap} from './maps.mjs';
import {PUMA_CIRCUIT as arena,RACE_MAPS} from './race-maps.mjs';
import {GAME_MODES} from './config.mjs';
import {arenaSupportsMode,mapsForMode,maxBotsFor,resolveMapForMode} from './arenas.mjs';
import {floorAt,obstructed,navigation,walkEdge} from './core.mjs';

test('Puma Circuit is immutable and exclusively registered for racing, including fallback metadata',()=>{
 assert.equal(getMap('puma-circuit'),arena);assert.deepEqual(RACE_MAPS,[arena]);
 assert.ok(Object.isFrozen(arena.race.grid[0]));
 assert.deepEqual(mapsForMode('puma-race'),[arena]);assert.equal(maxBotsFor('puma-race'),7);
 assert.equal(resolveMapForMode('exchange','puma-race'),'puma-circuit');
 for(const map of MAPS)assert.equal(arenaSupportsMode(map.id,'puma-race'),map===arena);
 for(const mode of GAME_MODES)assert.equal(arenaSupportsMode(arena.id,mode.id),mode.id==='puma-race');
 assert.equal(arenaSupportsMode({id:'unlisted',blocks:[]},'puma-race'),false);
 assert.equal(arenaSupportsMode({id:'unlisted',blocks:[]},'deathmatch'),true);
});

test('race gates, grid and eight Puma templates satisfy the ground contract',()=>{
 const {centerline,gates,grid,itemBoxes}=arena.race;
 assert.equal(centerline.length,12);assert.equal(gates.length,12);assert.equal(grid.length,8);
 assert.equal(gates[0].nx,1);assert.equal(gates[0].nz,0);
 for(const [i,gate] of gates.entries()){
  assert.equal(gate.halfWidth,12);assert.ok(Math.abs(Math.hypot(gate.nx,gate.nz)-1)<1e-12);
  const prev=centerline[(i+11)%12],next=centerline[(i+1)%12];
  assert.ok(gate.nx*(next.x-prev.x)+gate.nz*(next.z-prev.z)>0);
 }
 assert.deepEqual(arena.vehicles.map(v=>v.id),[0,1,2,3,4,5,6,7]);
 for(const [id,p] of grid.entries()){
  assert.deepEqual(p,{x:-8-6*Math.floor(id/2),z:-48+(id%2?3:-3),heading:Math.PI/2});
  assert.deepEqual(arena.spawns[id],[p.x,p.z]);
  assert.deepEqual(arena.vehicles[id],{id,kind:'puma',x:p.x,y:0,z:p.z,yaw:p.heading});
 }
 assert.equal(new Set(itemBoxes.map(p=>p.id)).size,itemBoxes.length);assert.ok(itemBoxes.length>=6);
 assert.deepEqual(arena.pickups,[]);
 for(const p of [...centerline,...gates,...grid,...itemBoxes,...arena.navNodes,...arena.vehicles]){
  assert.equal(floorAt(p.x,p.z,arena),0);assert.equal(obstructed(p.x,0,p.z,2.1,arena),false,JSON.stringify(p));
 }
});

test('Puma-sized sweeps clear every segment and corner across the racing lanes',()=>{
 const points=arena.race.centerline;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],length=Math.hypot(b.x-a.x,b.z-a.z);
  for(let step=0;step<=Math.ceil(length*4);step++)for(const lane of [-6,0,6]){
   const t=step/Math.ceil(length*4),x=a.x+(b.x-a.x)*t-(b.z-a.z)/length*lane,z=a.z+(b.z-a.z)*t+(b.x-a.x)/length*lane;
   assert.equal(floorAt(x,z,arena),0);assert.equal(obstructed(x,0,z,2.1,arena),false,`${i}/${t}/${lane}`);
  }
 }
 assert.equal(obstructed(0,0,0,2.1,arena),true);
 for(const side of ['inner','outer']){
  const rails=arena.blocks.filter(b=>b.kind==='race-rail'&&b.side===side);
  for(let i=0;i<rails.length;i++)assert.ok(Math.hypot(rails[i].x-rails[(i+1)%rails.length].x,rails[i].z-rails[(i+1)%rails.length].z)<=1.501);
 }
});

test('navigation connects the full circuit, item boxes and starting grid in both directions',()=>{
 const {nodes,edges}=navigation(arena),reverse=edges.map(()=>[]);
 edges.forEach((list,i)=>list.forEach(j=>reverse[j].push(i)));
 for(const graph of [edges,reverse]){
  const seen=new Set([0]),queue=[0];
  for(let i=0;i<queue.length;i++)for(const j of graph[queue[i]])if(!seen.has(j)){seen.add(j);queue.push(j);}
  assert.equal(seen.size,nodes.length);
 }
 for(const p of arena.navNodes)assert.ok(nodes.some(n=>Math.hypot(n.x-p.x,n.z-p.z)<.1));
 for(const p of [...arena.race.grid,...arena.race.itemBoxes])assert.ok(nodes.some(n=>Math.hypot(n.x-p.x,n.z-p.z)>.1&&walkEdge({...p,y:0},n,arena)&&walkEdge(n,{...p,y:0},arena)));
});
