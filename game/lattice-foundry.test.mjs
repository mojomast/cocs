import test from 'node:test';
import assert from 'node:assert/strict';
import {LATTICE_MAPS} from './lattice-maps.mjs';
import {foundryGeometry} from './lattice-foundry.mjs';
import {floorAt,obstructed,walkEdge,navigation,moveActor,visible,rayWorld,Match} from './core.mjs';
import {terrainSupportAt,terrainTriangles} from './terrain.mjs';
import {collisionHash} from './spatial.mjs';
import {mulberry32} from './levelgen.mjs';

const map=LATTICE_MAPS[0],graph=navigation(map);
const at=(x,z)=>({x,z,y:floorAt(x,z,map)});
const anchors=[...map.nodes,...map.terminals,...map.depots,
 ...map.spawns.map(([x,z])=>({x,z,id:'spawn'})),
 ...[0,1].flatMap(t=>map.teamSpawns[t].map(([x,z])=>({x,z,id:`team-${t}`}))),
 ...map.pickups.map(([id,x,z])=>({id,x,z})),
 ...map.traversal.flatMap(d=>[d.from,d.to??d.target??d.arrival].map(p=>({...p,id:d.id})))];

function checkSegment(a,b,{slope=Infinity,radius=.65}={}){
 const count=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5);let prev=at(a.x,a.z);
 for(let i=1;i<=count;i++){
  const next=at(a.x+(b.x-a.x)*i/count,a.z+(b.z-a.z)*i/count);
  assert.notEqual(next.y,null,`supported floor ${JSON.stringify(next)}`);
  assert.ok(walkEdge(prev,next,map),`walk edge ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`);
  assert.ok(!obstructed(next.x,next.y,next.z,radius,map),`clearance ${JSON.stringify(next)}`);
  assert.ok(Math.abs(next.y-prev.y)<=Math.hypot(next.x-prev.x,next.z-prev.z)*slope+1e-7,'lane slope');
  prev=next;
 }
}
function walk(a,b){
 checkSegment(a,b);
 const actor={...at(a.x,a.z),vx:0,vy:0,vz:0,grounded:true,moveSpeed:4,jumpBuffer:0,coyote:0};
 const distance=Math.hypot(b.x-a.x,b.z-a.z),input={x:(b.x-a.x)/distance,z:(b.z-a.z)/distance};
 for(let i=0;i<distance/4*60+180&&Math.hypot(actor.x-b.x,actor.z-b.z)>.15;i++)moveActor(actor,input,1/60,map);
 assert.ok(Math.hypot(actor.x-b.x,actor.z-b.z)<.15,`ordinary movement reaches ${JSON.stringify(b)}: ${JSON.stringify(actor)}`);
 assert.ok(Math.abs(actor.y-floorAt(actor.x,actor.z,map))<.03,'standing on the rendered floor');
}

test('all authored anchors attach to the same ground-only nav component at their real height',()=>{
 const seen=new Set([0]),queue=[0];
 for(let i=0;i<queue.length;i++)for(const j of graph.edges[queue[i]])if(!seen.has(j)){seen.add(j);queue.push(j);}
 assert.equal(seen.size,graph.nodes.length);
 for(const p of anchors){
  const start=at(p.x,p.z);
  assert.notEqual(start.y,null,p.id);
  if(p.y!==undefined)assert.ok(Math.abs(p.y-start.y)<1e-7,`${p.id} height ${p.y} = ${start.y}`);
  assert.equal(obstructed(p.x,start.y,p.z,.65,map),false,`${p.id} capsule clearance`);
  // Unlike a nearest-node test, this proves the anchor-to-graph edge itself is
  // walkable. Pruning a disconnected room/roof cannot make this check pass.
  assert.ok(graph.nodes.some(n=>Math.hypot(n.x-p.x,n.z-p.z)<6.4&&walkEdge(start,n,map)),`${p.id} attaches to ground nav`);
 }
 // Audit actual graph links, not merely BFS over possibly-invalid edges.
 for(let i=0;i<graph.nodes.length;i++)for(const j of graph.edges[i])if(j>i)
  assert.ok(walkEdge(graph.nodes[i],graph.nodes[j],map),`physical nav edge ${i}-${j}`);
});

test('all eight roofs have bilateral ordinary-operator ramp traversal and connected bots',()=>{
 assert.equal(map.foundry.roofs.length,8);
 for(const r of map.foundry.roofs){
  const a={x:r.x-r.length/2-r.ramp,z:r.z},b={x:r.x+r.length/2+r.ramp,z:r.z};
  assert.ok(floorAt(r.x,r.z,map)-floorAt(a.x,a.z,map)>=4-1e-7);
  walk(a,b);walk(b,a);
  const top=at(r.x,r.z);
  assert.ok(graph.nodes.some(n=>Math.hypot(n.x-top.x,n.z-top.z)<4&&walkEdge(top,n,map)),r.id);
 }
});

test('each lane and its rotational alternate is physically walkable with its declared slope',()=>{
 for(const lane of map.lanes)for(const route of [lane.waypoints,...lane.variants])
  for(let i=1;i<route.length;i++)checkSegment(at(...route[i-1]),at(...route[i]),{slope:lane.slopeCap,radius:lane.vehicles?1.8:.65});
 // Three separated cross-theatre lanes remain usable when every device is cut.
 assert.ok(Math.abs(map.lanes[0].waypoints[0][1]-map.lanes[2].waypoints[0][1])>=80);
});

test('terrain, pickups, depots and traversal affordances have rotational gameplay parity',()=>{
 assert.equal(new Set(map.nodes.map(n=>n.label)).size,7,'seven unique field-coach labels');
 assert.ok(map.nodes.find(n=>n.id==='econ-n').z<0&&map.nodes.find(n=>n.id==='econ-s').z>0,'cardinal siphon ids match world north/south');
 const random=mulberry32(19);
 for(let i=0;i<300;i++){
  const x=-119+random()*238,z=-71+random()*142,a=floorAt(x,z,map),b=floorAt(-x,-z,map);
  assert.ok(Math.abs(a-b)<1e-7,`rotated floor ${x},${z}: ${a}/${b}`);
  if(i<32)assert.ok(Math.abs(a-terrainSupportAt(x,z,map.terrain,.9).y)<1e-7,'baked support equals render triangle');
 }
 for(const [kind,x,z]of map.pickups)assert.ok(map.pickups.some(p=>p[0]===kind&&p[1]===-x&&p[2]===-z),kind);
 for(const d of map.depots)assert.ok(map.depots.some(p=>p.x===-d.x&&p.z===-d.z&&p.hq===d.hq&&p.team===(d.team===null?null:1-d.team)),d.id);
 for(const d of map.traversal){
  const twin=map.traversal.find(p=>p.kind===d.kind&&p.from.x===-d.from.x&&p.from.z===-d.from.z);
  assert.ok(twin,d.id);
  assert.ok(twin.arrival.x===-d.arrival.x&&twin.arrival.z===-d.arrival.z);
  assert.equal(twin.power,d.power);assert.equal(twin.speed,d.speed);
 }
 assert.equal(floorAt(0,25,map),1,'siphon is 3m below relay');
 assert.equal(floorAt(0,0,map),4);
});

test('spawn screens block enemy-objective/depot fire and main axial lanes break long sightlines',()=>{
 for(const team of [0,1])for(const [x,z]of map.teamSpawns[team]){
  const eye={...at(x,z),y:floorAt(x,z,map)+1.45};
  const targets=[...map.nodes.filter(n=>n.x*(team===0?1:-1)>=0),...map.depots.filter(d=>d.team!==team)];
  for(const n of targets)assert.equal(visible(eye,{...at(n.x,n.z),y:floorAt(n.x,n.z,map)+1.45},map),false,`spawn ${team} sees ${n.id}`);
 }
 // Sample the three combat corridors in both directions at operator eye height;
 // boundary distances limit the metric to actual in-bounds theatre sightlines.
 for(const z of [-50,0,50])for(let x=-108;x<=108;x+=12)for(const sign of [-1,1]){
  const p=at(x,z);if(obstructed(x,p.y,z,.65,map))continue;
  const range=Math.min(240,sign>0?120-x:x+120),hit=rayWorld({...p,y:p.y+1.45},{x:sign,y:0,z:0},range,map);
  assert.ok(hit<=120,`corridor sightline ${x},${z} dir ${sign}: ${hit}`);
 }
});

test('rebuilding geometry preserves the collision hash and modest static geometry budget',()=>{
 const rebuilt={...map,...foundryGeometry()};
 assert.equal(collisionHash(rebuilt),collisionHash(map));
 assert.ok(map.blocks.length<=140,map.blocks.length);
 assert.ok(terrainTriangles(map.terrain).length<=20000);
 assert.ok(graph.nodes.length<=1500);
});

test('actual 24-actor COCS matches step deterministically on the new terrain',()=>{
 const build=()=>new Match('chatgpt','openclaw',mulberry32(7619),'lattice-slice',{
  mode:'cocs',botCount:0,humanCount:24,aiSeats:true,difficulty:'normal',timeLimit:180});
 const start=performance.now(),a=build(),buildMs=performance.now()-start,b=build(),samples=[];
 assert.ok(buildMs<2000,`Match build ${buildMs.toFixed(0)}ms`);
 assert.equal(a.actors.length,24);
 const starts=a.actors.map(p=>({x:p.x,z:p.z}));let firstContest=null,multiFrontTicks=0;
 for(let tick=0;tick<1800;tick++){
  const start=performance.now();a.step(1/60,{inputs:{}});samples.push(performance.now()-start);
  b.step(1/60,{inputs:{}});
  if(tick%120===0)assert.deepEqual(a.snapshot(),b.snapshot(),`deterministic tick ${tick}`);
  const fronts=a.objectiveState.nodes.filter(n=>n.contested).length;
  if(fronts)firstContest??=a.time;
  if(fronts>=2)multiFrontTicks++;
  for(const p of a.actors)assert.ok([p.x,p.y,p.z].every(Number.isFinite));
 }
 assert.ok(a.actors.slice(0,starts.length).filter((p,i)=>Math.hypot(p.x-starts[i].x,p.z-starts[i].z)>8).length>=12,'bots leave the HQ compounds');
 assert.ok(firstContest!==null&&firstContest<30,`first contest ${firstContest}s`);
 assert.ok(multiFrontTicks>0,'seeded match produces simultaneous contested objectives');
 assert.ok(a.actors.some(p=>p.frags>0),'real combat occurs, not just movement');
 const sorted=samples.slice(30).sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*.95)];
 assert.ok(p95<50,`shared CI regression ceiling, p95 ${p95.toFixed(2)}ms`);
 console.log(`Foundry: ${map.blocks.length} solids, ${terrainTriangles(map.terrain).length} triangles, ${graph.nodes.length} nav; Match ${buildMs.toFixed(0)}ms; 24 actors p95 ${p95.toFixed(2)}ms; first contest ${firstContest.toFixed(2)}s; multi-front ${(multiFrontTicks/60).toFixed(1)}s`);
});
