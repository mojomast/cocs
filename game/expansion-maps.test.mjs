import assert from 'node:assert/strict';
import test from 'node:test';
import {EXPANSION_MAPS} from './expansion-maps.mjs';
import {floorAt,navigation,obstructed} from './core.mjs';
import {terrainBounds,terrainTriangles} from './terrain.mjs';

const point=value=>Array.isArray(value)?{x:value[0],z:value[1],y:0}:value;
const inside=(map,value)=>{const p=point(value);return p.x>=map.bounds.minX&&p.x<=map.bounds.maxX&&p.z>=map.bounds.minZ&&p.z<=map.bounds.maxZ;};
const rectangle=(b)=>({minX:b.x-b.w/2,maxX:b.x+b.w/2,minZ:b.z-b.d/2,maxZ:b.z+b.d/2});
const traversal=map=>Object.values(map.traversal).flat();
const allPoints=map=>[...map.spawns,...Object.values(map.teamSpawns).flat(),...Object.values(map.flagSpawns),...map.pickups.map(([,x,z])=>({x,z})),...(map.objectiveZones||[]),...traversal(map),...(map.jumpLinks||[]).flatMap(link=>[link.source,link.target])];
const nearest=(p,nodes)=>nodes.reduce((best,node,index)=>dist(p,node)<best.distance?{index,distance:dist(p,node)}:best,{index:0,distance:Infinity}).index;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const reachable=(from,to,graph)=>{
  const start=nearest(from,graph.nodes),goal=nearest(to,graph.nodes),seen=new Set([start]),queue=[start];
  while(queue.length){for(const next of graph.edges[queue.shift()])if(!seen.has(next)){if(next===goal)return true;seen.add(next);queue.push(next);}}
  return start===goal;
};

test('expansion pack exports three large, deeply frozen unique maps',()=>{
  assert.equal(EXPANSION_MAPS.length,3);
  assert.equal(new Set(EXPANSION_MAPS.map(map=>map.id)).size,3);
  assert.ok(Object.isFrozen(EXPANSION_MAPS));
  for(const map of EXPANSION_MAPS){
    assert.ok(Object.isFrozen(map));
    assert.ok(map.bounds.maxX-map.bounds.minX>=100&&map.bounds.maxZ-map.bounds.minZ>=58,map.id);
    assert.ok(map.teamSpawns[0].length>=2&&map.teamSpawns[1].length>=2,map.id);
    assert.ok(map.flagSpawns[0]&&map.flagSpawns[1],map.id);
  }
});

test('all authored geometry, objectives, supplies, and routes stay inside full bounds',()=>{
  for(const map of EXPANSION_MAPS){
    for(const value of allPoints(map))assert.ok(inside(map,value),`${map.id} point`);
    for(const block of map.blocks){const r=rectangle(block);assert.ok(r.minX>=map.bounds.minX&&r.maxX<=map.bounds.maxX&&r.minZ>=map.bounds.minZ&&r.maxZ<=map.bounds.maxZ,map.id);}
    for(const p of map.platforms||[]){const r=rectangle(p);assert.ok(r.minX>=map.bounds.minX&&r.maxX<=map.bounds.maxX&&r.minZ>=map.bounds.minZ&&r.maxZ<=map.bounds.maxZ,map.id);}
    assert.ok(map.navNodes.length>=8&&map.landmarks.length>=3,map.id);
    assert.ok(map.jumpLinks.length>=map.traversal.boostLaunchers.length,map.id);
  }
});

test('spawns and supplies have support and are not embedded in authored blocks',()=>{
  for(const map of EXPANSION_MAPS){
    for(const value of [...map.spawns,...Object.values(map.teamSpawns).flat(),...Object.values(map.flagSpawns)]){
      const p=point(value),floor=floorAt(p.x,p.z,map);
      assert.notEqual(floor,null,`${map.id} unsupported ${p.x},${p.z}`);
      assert.equal(obstructed(p.x,floor,p.z,.42,map),false,`${map.id} obstructed ${p.x},${p.z}`);
    }
    for(const [,x,z] of map.pickups)assert.notEqual(floorAt(x,z,map),null,`${map.id} pickup support`);
  }
});

test('expansion vehicles sit on supported, clear ground',()=>{
  for(const map of EXPANSION_MAPS)for(const vehicle of map.vehicles||[]){
    const floor=floorAt(vehicle.x,vehicle.z,map);
    assert.notEqual(floor,null,`${map.id} vehicle support ${vehicle.id}`);
    assert.equal(obstructed(vehicle.x,floor,vehicle.z,2.1,map),false,`${map.id} vehicle clearance ${vehicle.id}`);
  }
});

test('terrain-backed canyon has valid non-degenerate support geometry',()=>{
  const canyon=EXPANSION_MAPS.find(map=>map.id==='sunscar-canyon');
  const bounds=terrainBounds(canyon.terrain);
  assert.deepEqual({minX:bounds.minX,maxX:bounds.maxX,minZ:bounds.minZ,maxZ:bounds.maxZ},{minX:-56,maxX:56,minZ:-27,maxZ:27});
  assert.ok(terrainTriangles(canyon.terrain).length>=10);
  assert.ok(terrainTriangles(canyon.terrain).every(triangle=>triangle.normal[1]>0));
});

test('maps advertise distinct navigation-friendly route metadata',()=>{
  assert.deepEqual(EXPANSION_MAPS.map(map=>map.tag),['OUTDOOR / VERTICAL CANYON CTF','INDUSTRIAL / BROKEN VERTICAL CTF','OUTDOOR / WIDE ISLAND ROUTES CTF']);
  for(const map of EXPANSION_MAPS){
    assert.ok(map.description.toLowerCase().includes('ctf'),map.id);
    assert.ok(map.traversal.trampolines.length>=2&&map.traversal.boostLaunchers.length>=4,map.id);
    const ids=new Set(traversal(map).map(item=>item.id));
    assert.equal(ids.size,traversal(map).length,map.id);
    for(const link of map.jumpLinks)assert.ok(ids.has(link.traversal),`${map.id} missing ${link.traversal}`);
  }
});

test('team spawns can reach every objective and return to either base',()=>{
  for(const map of EXPANSION_MAPS){
    const graph=navigation(map),objectives=map.objectiveZones,flagPoints=Object.values(map.flagSpawns);
    for(const spawn of Object.values(map.teamSpawns).flat())for(const objective of objectives)assert.equal(reachable(point(spawn),objective,graph),true,`${map.id} spawn to objective`);
    for(const objective of objectives)for(const flag of flagPoints)assert.equal(reachable(objective,point(flag),graph),true,`${map.id} objective to base`);
  }
});

test('every expansion navigation graph is fully connected in both directions',()=>{
  for(const map of EXPANSION_MAPS){
    const graph=navigation(map),incoming=graph.edges.map(()=>[]);
    graph.edges.forEach((list,from)=>list.forEach(to=>incoming[to].push(from)));
    for(const [label,edges] of [['forward',graph.edges],['return',incoming]]){
      const seen=new Set([0]),queue=[0];
      while(queue.length)for(const next of edges[queue.shift()])if(!seen.has(next)){seen.add(next);queue.push(next);}
      assert.equal(seen.size,graph.nodes.length,`${map.id} ${label} connectivity`);
    }
  }
});

test('launcher endpoints have player clearance and platform support',()=>{
  for(const map of EXPANSION_MAPS)for(const pad of map.traversal.boostLaunchers)for(const p of [{x:pad.x,z:pad.z,y:pad.y},pad.target]){
    const floor=floorAt(p.x,p.z,map);
    assert.notEqual(floor,null,`${map.id} launcher support ${pad.id}`);
    assert.ok(Math.abs(floor-p.y)<.36,`${map.id} launcher height ${pad.id}`);
    assert.equal(obstructed(p.x,floor,p.z,.42,map),false,`${map.id} launcher clearance ${pad.id}`);
  }
});
