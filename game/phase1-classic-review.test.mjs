import test from 'node:test';
import assert from 'node:assert/strict';
import {getMap} from './maps.mjs';
import {floorAt,obstructed,walkEdge,navigation,moveActor} from './core.mjs';
for(const id of ['exchange','crosswire','foundry','launchpad','citadel'])test(`${id}: separated rewards and exact connected spawn/reward approaches`,()=>{
 const map=getMap(id),nav=navigation(map),point=([x,z])=>({x,z,y:floorAt(x,z,map)});
 const spawns=map.spawns.map(point),rewards=map.pickups.map(([,x,z])=>point([x,z]));
 const attach=p=>nav.nodes.findIndex(n=>Math.hypot(n.x-p.x,n.z-p.z)<=4&&walkEdge(n,p,map)&&walkEdge(p,n,map));
 const flood=start=>{const seen=new Set([start]),queue=[start];for(let i=0;i<queue.length;i++)for(const n of nav.edges[queue[i]]||[])if(!seen.has(n)){seen.add(n);queue.push(n);}return seen;};
 const origin=attach(spawns[0]);assert.ok(origin>=0);const reachable=flood(origin);
 for(const p of [...spawns,...rewards,...Object.values(map.anchors||{}).map(p=>point([p.x,p.z]))]){
  assert.notEqual(p.y,null);assert.equal(obstructed(p.x,p.y,p.z,.52,map),false);
  const index=attach(p);assert.ok(index>=0&&reachable.has(index)&&flood(index).has(origin),JSON.stringify(p));
  const n=nav.nodes.find(n=>{const d=Math.hypot(n.x-p.x,n.z-p.z);return d>1&&d<=3&&walkEdge(n,p,map)&&walkEdge(p,n,map)});assert.ok(n,`local route ${JSON.stringify(p)}`);
  for(const [from,to] of [[p,n],[n,p]]){const actor={...from,vx:0,vy:0,vz:0,grounded:true,moveSpeed:5,traversalCooldown:999};for(let i=0;i<180&&Math.hypot(to.x-actor.x,to.z-actor.z)>.15;i++){const dx=to.x-actor.x,dz=to.z-actor.z,d=Math.hypot(dx,dz);moveActor(actor,{x:dx/d,z:dz/d},1/60,map);}assert.ok(Math.hypot(to.x-actor.x,to.z-actor.z)<.15,`movement ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);}
 }
 for(let i=0;i<rewards.length;i++)for(const b of rewards.slice(i+1)){const a=rewards[i];assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>=2.1,'collection spheres overlap');}
});
