import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS,getMap} from './maps.mjs';
import {PUMA_CIRCUIT as arena,RACE_MAPS} from './race-maps.mjs';
import {GAME_MODES} from './config.mjs';
import {arenaSupportsMode,mapsForMode,maxBotsFor,resolveMapForMode} from './arenas.mjs';
import {floorAt,obstructed,navigation,walkEdge} from './core.mjs';

// Mirrors the generator: consecutive collinear boundary points collapse to one
// vertex so rails can be grouped per straight edge.
const mergeCollinear=polygon=>{
 const merged=[];
 for(let i=0;i<polygon.length;i++){
  const a=polygon[(i+polygon.length-1)%polygon.length],b=polygon[i],c=polygon[(i+1)%polygon.length];
  const cross=(b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x),span=Math.hypot(c.x-a.x,c.z-a.z)||1;
  if(Math.abs(cross)/span>1e-9)merged.push(b);
 }
 return merged;
};
const pointInPolygon=(polygon,{x,z})=>{
 let inside=false;
 for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[i],b=polygon[j];
  if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
 }
 return inside;
};
const railBoxes=side=>arena.blocks.filter(b=>b.kind==='race-rail'&&b.side===side);

test('Puma Circuit is immutable and exclusively registered for racing, including fallback metadata',()=>{
 assert.equal(getMap('puma-circuit'),arena);assert.deepEqual(RACE_MAPS,[arena]);
 assert.ok(Object.isFrozen(arena.race.grid[0]));
 assert.ok(Object.isFrozen(arena.race.boundary)&&Object.isFrozen(arena.race.boundary.outer)&&Object.isFrozen(arena.race.boundary.inner[0]));
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
});

test('exported boundary loops are finite and enclose the racing line',()=>{
 const {boundary,centerline}=arena.race;
 assert.deepEqual(Object.keys(boundary).sort(),['inner','outer']);
 for(const [side,polygon] of Object.entries(boundary)){
  assert.ok(polygon.length>=12,`${side} boundary has at least 12 points`);
  for(const p of polygon){assert.deepEqual(Object.keys(p).sort(),['x','z']);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z),`${side} point finite`);}
 }
 for(const p of boundary.inner)assert.ok(pointInPolygon(boundary.outer,p),'inner loop nests inside outer loop');
 for(const p of centerline){
  assert.ok(pointInPolygon(boundary.outer,p),'racing line inside outer loop');
  assert.equal(pointInPolygon(boundary.inner,p),false,'racing line outside inner loop');
 }
});

test('rail collision boxes abut along the boundary without car-sized gaps',()=>{
 const {boundary}=arena.race;
 for(const side of ['outer','inner']){
  const edges=mergeCollinear(boundary[side]),rails=railBoxes(side);
  assert.ok(rails.length>0,`${side} rails exist`);
  // Consecutive collision boxes along the boundary walk never sit more than the
  // 2.0 box width apart, so adjacent faces meet instead of leaving a gap.
  for(let i=0;i<rails.length;i++)assert.ok(Math.hypot(rails[i].x-rails[(i+1)%rails.length].x,rails[i].z-rails[(i+1)%rails.length].z)<=2+1e-9,`${side} rail gap ${i}`);
  // Every point of every straight boundary edge sits inside a 2x2 rail footprint.
  // That leaves no opening wide enough for a 2.1-radius car, including diagonals.
  for(let i=0;i<edges.length;i++){
   const a=edges[i],b=edges[(i+1)%edges.length],length=Math.hypot(b.x-a.x,b.z-a.z),samples=Math.max(2,Math.ceil(length/.25));
   for(let s=0;s<=samples;s++){
    const t=s/samples,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
    assert.ok(rails.some(r=>Math.abs(x-r.x)<=1+1e-9&&Math.abs(z-r.z)<=1+1e-9),`${side} edge ${i} point ${t} uncovered`);
   }
  }
 }
});

test('perimeter is sealed for a 2.1-radius car while the racing line stays clear',()=>{
 const {boundary,centerline}=arena.race;
 for(const [side,dir] of [['outer',1],['inner',-1]]){
  const polygon=boundary[side],cx=polygon.reduce((sum,p)=>sum+p.x,0)/polygon.length,cz=polygon.reduce((sum,p)=>sum+p.z,0)/polygon.length;
  const edges=mergeCollinear(polygon);
  for(let i=0;i<edges.length;i++){
   const a=edges[i],b=edges[(i+1)%edges.length],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
   let nx=dz/length,nz=-dx/length;
   const mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
   if(nx*(mx-cx)+nz*(mz-cz)<0){nx=-nx;nz=-nz;}
   const samples=Math.max(2,Math.ceil(length/.5));
   for(let s=0;s<=samples;s++){
    const t=s/samples,x=a.x+dx*t+dir*nx,z=a.z+dz*t+dir*nz;
    assert.equal(obstructed(x,0,z,2.1,arena),true,`${side} edge ${i} sample ${t} is not sealed`);
   }
  }
 }
 for(let i=0;i<centerline.length;i++){
  const a=centerline[i],b=centerline[(i+1)%centerline.length],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/2));
  for(let s=0;s<steps;s++){
   const t=s/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
   assert.equal(obstructed(x,0,z,2.1,arena),false,`racing line ${i}/${t} blocked`);
  }
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
