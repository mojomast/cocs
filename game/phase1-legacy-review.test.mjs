import test from 'node:test';
import assert from 'node:assert/strict';
import {ISLAND_MAPS} from './island-maps.mjs';
import {EXPANSION_MAPS} from './expansion-maps.mjs';
import {CTF_MAPS} from './ctf-maps.mjs';
import {BATTLE_MAPS} from './battle-maps.mjs';
import {ARSENAL_MAPS} from './arsenal-maps.mjs';
import {BLOOD_GULCH} from './blood-gulch.mjs';
import {floorAt, obstructed, walkEdge, navigation, visible, moveActor} from './core.mjs';

// Intentionally import only the reviewed templates; never iterate the shared MAPS registry.
const maps = [...ISLAND_MAPS, ...EXPANSION_MAPS, ...CTF_MAPS, ...BATTLE_MAPS, ...ARSENAL_MAPS, BLOOD_GULCH];
const point = (map, x, z) => ({x, z, y: floorAt(x, z, map)});
const unique = values => [...new Map(values.map(p => [JSON.stringify(p), p])).values()];
for (const map of maps) test(`${map.id}: legacy navigation, collision, rewards and sightline review`, t => {
  const nav = navigation(map), issues = [];
  const spawns = unique([...map.spawns, ...Object.values(map.teamSpawns || {}).flat()]).map(([x,z]) => point(map,x,z));
  const rewards = map.pickups.map(([kind,x,z]) => ({kind,...point(map,x,z)}));
  const flags = unique(Object.values(map.flagSpawns || {})).map(p => point(map,p.x ?? p[0],p.z ?? p[1]));
  const targets = [...spawns,...rewards,...flags,...(map.objectiveZones || []).map(p=>point(map,p.x,p.z))];
  const attach = p => nav.nodes.findIndex(q => Math.hypot(p.x-q.x,p.z-q.z)<=6.5 && walkEdge(p,q,map));
  const reachable = start => {
    const seen=new Set([start]),queue=[start];
    for(let k=0;k<queue.length;k++) for(const j of nav.edges[queue[k]] || []) if(!seen.has(j)){seen.add(j);queue.push(j);}
    return seen;
  };
  const connected = reachable(attach(spawns[0]));
  // Check directed return routes too, not just outgoing links from one spawn.
  for(const p of spawns) if(!reachable(attach(p)).has(attach(spawns[0]))) issues.push(`no spawn return route ${JSON.stringify(p)}`);
  const actorAt = p => ({...p,vx:0,vy:0,vz:0,grounded:true,moveSpeed:5,jumpBuffer:0,coyote:0,vehicleId:null,traversalCooldown:999});
  const motion = (from,to) => {
    const actor=actorAt(from);
    for(let i=0;i<180 && Math.hypot(to.x-actor.x,to.z-actor.z)>.15;i++){
      const dx=to.x-actor.x,dz=to.z-actor.z,d=Math.hypot(dx,dz);
      moveActor(actor,{x:dx/d,z:dz/d},1/60,map);
    }
    return Math.hypot(to.x-actor.x,to.z-actor.z)<.15 && Math.abs(actor.y-to.y)<.35 && !obstructed(actor.x,actor.y,actor.z,.52,map);
  };
  // Bounded 3-unit local motion per spawn and reward. Cooldown deliberately
  // isolates pedestrian collision from traversal; changed devices are tested below.
  let spawnExits=0,rewardApproaches=0;
  for(const [points,isSpawn] of [[spawns,true],[rewards,false]]) for(const p of points){
    const candidates=Array.from({length:8},(_,i)=>point(map,p.x+3*Math.cos(i*Math.PI/4),p.z+3*Math.sin(i*Math.PI/4)))
      .filter(q=>q.x>=map.bounds.minX&&q.x<=map.bounds.maxX&&q.z>=map.bounds.minZ&&q.z<=map.bounds.maxZ&&q.y!==null&&walkEdge(p,q,map));
    const success=candidates.some(q=>isSpawn?motion(p,q):motion(q,p));
    if(!success) issues.push(`no local ${isSpawn?'spawn exit':'reward approach'} ${JSON.stringify(p)}`);
    else if(isSpawn) spawnExits++; else rewardApproaches++;
  }
  for(const p of targets){
    if(p.y===null || obstructed(p.x,p.y,p.z,.52,map)) issues.push(`blocked/unsupported ${JSON.stringify(p)}`);
    const index=attach(p);
    if(index<0 || !connected.has(index)) issues.push(`disconnected ${JSON.stringify(p)}`);
  }
  const clusters=[];
  for(let i=0;i<rewards.length;i++) for(const b of rewards.slice(i+1)){
    const a=rewards[i],d=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
    if(d<2.1) clusters.push(`${a.kind}@${a.x},${a.z}/${b.kind}@${b.x},${b.z}:${d.toFixed(2)}`);
  }
  // <2.1 means overlapping runtime collection spheres (radius 1.05).
  if(clusters.length) issues.push(`overlapping reward collection: ${clusters.join('; ')}`);
  const exposure=spawns.map(a=>spawns.filter(b=>a!==b&&visible({...a,y:a.y+1.45},{...b,y:b.y+1.45},map)).length);
  const traversalBlocked=[];
  for(const link of map.jumpLinks || []) for(const p of [link.source,link.target]){
    const q=point(map,p.x,p.z),index=attach(q);
    if(q.y===null || obstructed(q.x,q.y,q.z,.52,map) || index<0 || !connected.has(index)) issues.push(`unreachable jump endpoint ${link.id} ${JSON.stringify(q)}`);
  }
  for(const type of ['jumpPads','trampolines','boostLaunchers','teleporters']) for(const p of map.traversal?.[type] || []){
    const q=point(map,p.x,p.z);
    if(q.y===null || obstructed(q.x,q.y,q.z,.52,map)) traversalBlocked.push(p.id);
  }
  if(traversalBlocked.length) issues.push(`blocked traversal sources: ${traversalBlocked.join(', ')}`);
  for(const p of map.traversal?.teleporters || []){
    const q=p.target ?? p.to;
    if(obstructed(q.x,q.y??floorAt(q.x,q.z,map),q.z,.52,map)) issues.push(`blocked teleporter destination ${p.id}`);
  }
  t.diagnostic(JSON.stringify({id:map.id,nodes:nav.nodes.length,reachable:connected.size,spawns:spawns.length,rewards:rewards.length,spawnExits,rewardApproaches,exposure,clusters,traversalBlocked,issues}));
  assert.deepEqual(issues,[]);
});

test('skyfall-basin: relocated devices activate outside solids without auto-launching spawns',()=>{
  const map=maps.find(m=>m.id==='skyfall-basin');
  for(const pad of map.traversal.jumpPads.filter(p=>['sf-hop-w','sf-hop-e'].includes(p.id))){
    for(const [x,z] of [...map.spawns,...Object.values(map.teamSpawns).flat()])
      assert.ok(Math.hypot(x-pad.x,z-pad.z)>1.5,`${pad.id}: spawn activation trap`);
    const a={...point(map,pad.x,pad.z),vx:0,vy:0,vz:0,grounded:true,jumpBuffer:0,coyote:0,vehicleId:null};
    moveActor(a,{},1/60,map);
    assert.equal(a.traversalPad,pad.id);
    assert.ok(a.vy>0);
  }
  for(const p of map.traversal.teleporters){
    const a={...point(map,p.x,p.z),vx:0,vy:0,vz:0,grounded:true,jumpBuffer:0,coyote:0,vehicleId:null};
    moveActor(a,{},1/60,map);
    assert.equal(a.traversalEvent?.type,'teleport');
    assert.equal(a.x,p.target.x);
    assert.equal(a.z,p.target.z);
    assert.equal(obstructed(a.x,a.y,a.z,.52,map),false);
  }
});

test('reviewed legacy blocks remain solid ground-to-top, including decks',()=>{
  for(const map of maps) for(const b of map.blocks){
    // Isolate each authored solid from terrain/other overlapping solids.
    const arena={...map,terrain:undefined,blocks:[{...b,y:100,minY:100}]};
    assert.equal(obstructed(b.x,.01,b.z,.52,arena),true,`${map.id}: ground solid`);
    assert.equal(obstructed(b.x,b.h,b.z,.52,arena),false,`${map.id}: top`);
  }
});
