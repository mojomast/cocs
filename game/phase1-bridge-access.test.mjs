import test from 'node:test';
import assert from 'node:assert/strict';
import {NEXTGEN_MAPS} from './nextgen-maps.mjs';
import {terrainField} from './levelgen.mjs';
import {stampTerrainFloor, terrainRayHit, terrainSupportAt, terrainTriangles} from './terrain.mjs';
import {facadeFrame} from './structures.mjs';
import {floorAt, obstructed, walkEdge, moveActor, navigation} from './core.mjs';

test('opt-in ground fill has visible ray-hit side faces and a single authoritative top',()=>{
  const terrain=terrainField({minX:-10,maxX:10,minZ:-10,maxZ:10},{height:()=>0,step:2});
  stampTerrainFloor(terrain,[[-2,-2],[2,-2],[2,2],[-2,2]],()=>2,'causeway-floor',{skirts:true});
  assert.equal(terrainSupportAt(0,0,terrain).y,2);
  assert.equal(terrainSupportAt(3,0,terrain).y,0);
  const hit=terrainRayHit([3,1,0],[-1,0,0],2,terrain);
  assert.ok(hit,'visible ground-supported side face must block a ray');
  assert.ok(Math.abs(hit.distance-1)<1e-8);
  assert.ok(terrainTriangles(terrain).some(t=>t.surfaceId==='causeway-floor-sides'&&!t.walkable));
  stampTerrainFloor(terrain,[[5,5],[7,5],[7,7],[5,7]],()=>1,'causeway-floor',{skirts:true});
  assert.equal(terrain.surfaces.filter(s=>s.id==='causeway-floor-sides').length,1,'retaining sides share a bounded surface bucket');
});

const counts = {'sunken-hill':8, atrium:2, slagworks:2, forge:1, 'dune-ravine':4, 'ember-caldera':2};
const point = (map,x,z) => ({x,z,y:floorAt(x,z,map)});
function walk(map, from, to) {
  const distance=Math.hypot(to.x-from.x,to.z-from.z), steps=Math.ceil(distance/.5);
  let previous=point(map,from.x,from.z);
  assert.notEqual(previous.y,null);
  for(let i=0;i<=steps;i++){
    const p=point(map,from.x+(to.x-from.x)*i/steps,from.z+(to.z-from.z)*i/steps);
    assert.notEqual(p.y,null);
    assert.equal(obstructed(p.x,p.y,p.z,.52,map),false,`${map.id}: obstructed ${JSON.stringify(p)}`);
    assert.ok(walkEdge(previous,p,map),`${map.id}: edge ${JSON.stringify(previous)} -> ${JSON.stringify(p)}`);
    previous=p;
  }
  const actor={...point(map,from.x,from.z),vx:0,vy:0,vz:0,grounded:true,moveSpeed:5,jumpBuffer:0,coyote:0};
  for(let i=0;i<Math.ceil(distance*60)+120&&Math.hypot(to.x-actor.x,to.z-actor.z)>.12;i++){
    const dx=to.x-actor.x,dz=to.z-actor.z,l=Math.hypot(dx,dz);
    moveActor(actor,{x:dx/l,z:dz/l},1/60,map);
  }
  assert.ok(Math.hypot(to.x-actor.x,to.z-actor.z)<.12,`${map.id}: actor stopped ${JSON.stringify(actor)} targeting ${JSON.stringify(to)}`);
  assert.ok(Math.abs(actor.y-floorAt(actor.x,actor.z,map))<.15,`${map.id}: not on floor`);
}

for(const [id,count] of Object.entries(counts))test(`${id}: every crossing has bidirectional approach/deck/exit movement`,()=>{
  const map=NEXTGEN_MAPS.find(m=>m.id===id);
  const crossings=map.structures.filter(s=>s.type==='bridge'||s.type==='causeway');
  assert.equal(crossings.length,count);
  for(const s of crossings){
    // Before correction this asserts the exact reported buried-floor defect.
    assert.equal(obstructed(s.x,floorAt(s.x,s.z,map),s.z,.52,map),false,`${id}: blocked crossing centre (${s.x},${s.z})`);
    assert.equal(s.type,'causeway');
    const points=s.accessPath.map(([x,,z])=>({x,z}));
    const nx=Math.cos(s.rot),nz=Math.sin(s.rot);
    points.unshift({x:points[0].x-2*nx,z:points[0].z-2*nz});
    points.push({x:points.at(-1).x+2*nx,z:points.at(-1).z+2*nz});
    // Centre and both shoulder lanes include untouched ground beyond each toe.
    for(const offset of [-.5,0,.5]){
      const lane=points.map(p=>({x:p.x-nz*offset,z:p.z+nx*offset}));
      for(let i=1;i<lane.length;i++){walk(map,lane[i-1],lane[i]);walk(map,lane[i],lane[i-1]);}
    }
    for(const [x,y,z] of s.accessPath){
      assert.ok(Math.abs(floorAt(x,z,map)-y)<1e-6,`${id}: crossing floor disagrees with authored path`);
      const hit=terrainRayHit([x,y+2,z],[0,-1,0],3,map.terrain);
      assert.ok(hit&&Math.abs(hit.distance-2)<1e-6,`${id}: visible/ray floor mismatch`);
    }
  }
});

for(const id of Object.keys(counts))test(`${id}: crossings and retained markers attach to the same real navigation graph`,()=>{
  const map=NEXTGEN_MAPS.find(m=>m.id===id),nav=navigation(map);
  const targets=[...map.spawns,...Object.values(map.teamSpawns||{}).flat(),
    ...map.pickups.map(([,x,z])=>[x,z]),...map.objectiveZones.map(p=>[p.x,p.z]),
    ...Object.values(map.flagSpawns||{}),
    ...map.structures.filter(s=>s.type==='causeway').flatMap(s=>s.accessPath.map(([x,,z])=>[x,z]))];
  const attached=targets.map(([x,z])=>{
    const p=point(map,x,z);
    assert.notEqual(p.y,null);
    assert.equal(obstructed(x,p.y,z,.52,map),false,`${id}: blocked marker ${JSON.stringify(p)}`);
    const n=nav.nodes.findIndex(q=>Math.hypot(x-q.x,z-q.z)<=6.5&&walkEdge(p,q,map)&&walkEdge(q,p,map));
    assert.ok(n>=0,`${id}: no bidirectional nav attachment ${JSON.stringify(p)}`);
    return n;
  });
  const seen=new Set([attached[0]]),queue=[attached[0]];
  for(let i=0;i<queue.length;i++)for(const n of nav.edges[queue[i]])if(!seen.has(n)){seen.add(n);queue.push(n);}
  for(const n of attached)assert.ok(seen.has(n),`${id}: isolated required route`);
  const exterior=new Set([attached[0]]),flank=[attached[0]];
  for(let i=0;i<flank.length;i++)for(const n of nav.edges[flank[i]])if(!exterior.has(n)&&Math.hypot(nav.nodes[n].x,nav.nodes[n].z)>8){exterior.add(n);flank.push(n);}
  const spawns=[...map.spawns,...Object.values(map.teamSpawns||{}).flat()];
  const farthest=spawns.reduce((best,p,i)=>Math.hypot(p[0]-spawns[0][0],p[1]-spawns[0][1])>Math.hypot(spawns[best][0]-spawns[0][0],spawns[best][1]-spawns[0][1])?i:best,0);
  assert.ok(exterior.has(attached[farthest]),`${id}: original centre-avoiding ground flank lost`);
});

test('retained building doorways and Sunken Hill cavern portals still work both ways',()=>{
  for(const id of Object.keys(counts)){
    const map=NEXTGEN_MAPS.find(m=>m.id===id);
    for(const s of map.structures.filter(s=>s.type==='building')){
      const f=facadeFrame(s,s.door),a={x:f.origin.x+f.normal.x*2,z:f.origin.z+f.normal.z*2},b={x:f.origin.x-f.normal.x*2,z:f.origin.z-f.normal.z*2};
      walk(map,a,b);walk(map,b,a);
    }
    for(const s of map.structures.filter(s=>s.type==='cavern'))for(const angle of [Math.PI/16,Math.PI+Math.PI/16]){
      const a={x:s.x+Math.cos(angle)*(s.radius-2),z:s.z+Math.sin(angle)*(s.radius-2)},b={x:s.x+Math.cos(angle)*(s.radius+2),z:s.z+Math.sin(angle)*(s.radius+2)};
      walk(map,a,b);walk(map,b,a);
    }
  }
});
