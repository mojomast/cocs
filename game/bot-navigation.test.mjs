import test from 'node:test';
import assert from 'node:assert/strict';
import {astar,path,coverPoint,flankDestination} from './bots.mjs';
import {Match,floorAt,obstructed,nearest,eye} from './core.mjs';
import {WEAPONS,RULES} from './data.mjs';

test('A* minimises route cost instead of edge count and reports reachability',()=>{
 // A direct 2-edge route via a far hub (H) versus a cheaper 3-edge route.
 const nodes=[{x:0,y:0,z:0},{x:100,y:0,z:0},{x:1,y:0,z:0},{x:.4,y:0,z:0},{x:.7,y:0,z:0}];
 const edges=[[1,3],[2],[],[4],[2]];
 const result=astar({x:0,y:0,z:0},{x:1,y:0,z:0},nodes,edges);
 assert.equal(result.reachable,true);
 assert.deepEqual(result.route,[0,3,4,2],'the cheaper three-hop route wins');
 assert.ok(Math.abs(result.cost-1)<1e-9,`cost is the summed distance (${result.cost})`);
 assert.deepEqual(path({x:0,y:0,z:0},{x:1,y:0,z:0},nodes,edges),result.route);
});

test('an unreachable destination is explicit rather than a one-node route',()=>{
 const nodes=[{x:0,y:0,z:0},{x:10,y:0,z:0},{x:40,y:0,z:40}];
 const edges=[[1],[0],[]];
 const result=astar({x:0,y:0,z:0},{x:40,y:0,z:40},nodes,edges);
 assert.equal(result.reachable,false);
 assert.equal(result.cost,Infinity);
 assert.deepEqual(result.route,[]);
 assert.deepEqual(path({x:0,y:0,z:0},{x:40,y:0,z:40},nodes,edges),[],'path returns an empty, explicitly unreachable route');
});

test('cover scoring keeps cover reachable and penalises enemy line of sight',()=>{
 const visibleSpy=[];const match={nav:[{x:0,y:0,z:0},{x:-6,y:0,z:0},{x:6,y:0,z:0}],arena:{blocks:[]},edges:[[1,2],[0],[0]],visible:(from,to)=>{visibleSpy.push([from,to]);return Math.abs(from.z-to.z)<2;}};
 const bot={x:0,y:0,z:0},threat={x:0,y:0,z:6};
 const cover=coverPoint(match,bot,threat);
 assert.ok(cover,'a reachable covered node is chosen');
 assert.ok(Math.abs(cover.z)<1e-9&&cover.x!==0,'the bot does not pick the node it already stands on');
 // Line-of-sight candidates are rejected before scoring.
 const open={nav:[{x:0,y:0,z:0}],arena:{blocks:[]},edges:[[],],visible:()=>true};
 assert.equal(coverPoint(open,bot,threat),null,'visible cover is rejected');
});

test('flank routing demands lateral separation and expires with the target',()=>{
 const match={time:0,nav:[{x:0,y:0,z:12},{x:12,y:0,z:12},{x:30,y:0,z:30}],arena:{}};
 const bot={x:0,y:0,z:0,bot:{target:5,flank:null,flankDone:false}},enemy={x:0,y:0,z:20};
 const pick=flankDestination(match,bot,enemy);
 assert.deepEqual({x:pick.x,z:pick.z},{x:12,z:12},'the lateral node is chosen over the straight-ahead node');
 assert.equal(bot.bot.flank.key,'5');
 // Same target and live window: the committed flank is reused.
 assert.equal(flankDestination(match,bot,enemy).x,12,'an active flank is reused');
 // Expired window recomputes from scratch rather than holding a stale route.
 match.time=10;bot.bot.flank.until=1;
 const refreshed=flankDestination(match,bot,enemy);
 assert.ok(refreshed&&Number.isFinite(refreshed.x),'an expired flank is recomputed');
 // A new target invalidates the previous flank.
 bot.bot.flank={x:99,y:0,z:99,key:'5',until:999};bot.bot.target=6;
 const retargeted=flankDestination(match,bot,enemy);
 assert.ok(retargeted.x!==99,'a retarget drops the stale flank');
 assert.equal(bot.bot.flank.key,'6');
});

// ---- W13 coverPoint equivalence -------------------------------------------
// The production coverPoint caches floods/geometry and visits candidates in
// ascending route cost so it can stop casting visibility rays early. This is a
// literal copy of the pre-W13 linear scan (same arithmetic, same index
// tie-break); every pinned scenario below must choose the identical node.
function heapPush(heap,item,priority){heap.push({item,priority});let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p].priority<=heap[i].priority)break;const s=heap[p];heap[p]=heap[i];heap[i]=s;i=p;}}
function heapPop(heap){const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;for(;;){const l=i*2+1,r=l+1;let m=i;if(l<heap.length&&heap[l].priority<heap[m].priority)m=l;if(r<heap.length&&heap[r].priority<heap[m].priority)m=r;if(m===i)break;const s=heap[m];heap[m]=heap[i];heap[i]=s;i=m;}}return top;}
function referenceDijkstra(from,nodes,edges){const dist=new Array(nodes.length).fill(Infinity);if(!Number.isInteger(from)||from<0||from>=nodes.length)return dist;dist[from]=0;const heap=[];heapPush(heap,from,0);while(heap.length){const current=heapPop(heap).item;for(const next of edges[current]||[]){if(!Number.isInteger(next)||next<0||next>=nodes.length)continue;const tentative=dist[current]+Math.hypot(nodes[current].x-nodes[next].x,nodes[current].z-nodes[next].z);if(tentative<dist[next]){dist[next]=tentative;heapPush(heap,next,tentative);}}}return dist;}
function referenceCover(match,a,threat){
 if(!a||!threat||!match?.nav?.length)return null;
 const nodes=match.nav,edges=Array.isArray(match.edges)?match.edges:null,threatEye=eye(threat),threatX=threat.x??0,threatZ=threat.z??0;
 const weaponRange=WEAPONS[a.weapon??0]?.range??70,costs=edges?referenceDijkstra(nearest(a,nodes),nodes,edges):null;
 let best=null,bestScore=Infinity;
 for(let index=0;index<nodes.length;index++){
  const node=nodes[index];
  if(!Number.isFinite(node.x)||!Number.isFinite(node.z))continue;
  const y=Number.isFinite(node.y)?node.y:(floorAt(node.x,node.z,match.arena)??0);
  if(obstructed(node.x,y,node.z,RULES.radius*.9,match.arena))continue;
  if(match.visible({x:node.x,y:y+1.2,z:node.z},threatEye))continue;
  const cost=costs?costs[index]:Math.hypot(a.x-node.x,a.z-node.z);
  if(!Number.isFinite(cost)||cost>34||cost<1.5)continue;
  const threatDistance=Math.hypot(node.x-threatX,node.z-threatZ),safety=Math.min(threatDistance,12)*.55,usable=threatDistance<=weaponRange?0:-6;
  const score=cost-safety+usable;
  if(score<bestScore){bestScore=score;best={x:node.x,y,z:node.z};}
 }
 return best;
}
test('optimized coverPoint matches the pre-W13 linear scan on pinned scenarios',()=>{
 // Deterministic argument-only visibility so candidate order cannot leak in.
 const visibleByHash=p=>{const h=Math.imul(Math.round(p.x*100)+1000,73856093)^Math.imul(Math.round(p.z*100)+1000,19349663)^Math.imul(Math.round(p.y*100)+1000,83492791);return (h>>>0)%3===0;};
 let state=987654321;
 const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
 let checked=0,nonNull=0;
 // Synthetic graphs: with edges (dijkstra costs) and without (straight-line).
 for(let i=0;i<600;i++){
  const n=1+Math.floor(random()*48);
  const nodes=Array.from({length:n},()=>({x:random()*40-20,y:random()*2,z:random()*40-20}));
  const edges=random()<.6?nodes.map(()=>[]):null;
  if(edges)for(let k=0;k<n;k++)for(let j=0;j<n;j++)if(k!==j&&random()<.12)edges[k].push(j);
  const match={nav:nodes,edges,arena:{blocks:[],bounds:{minX:-25,maxX:25,minZ:-25,maxZ:25}},visible:visibleByHash};
  const a={x:random()*40-20,y:random()*2,z:random()*40-20,weapon:Math.floor(random()*WEAPONS.length)};
  const threat={x:random()*40-20,y:random()*2,z:random()*40-20};
  const fast=coverPoint(match,a,threat),reference=referenceCover(match,a,threat);
  assert.deepEqual(fast,reference,`synthetic cover ${i} (${n} nodes)`);
  checked++;if(fast)nonNull++;
 }
 assert.ok(nonNull>20,'the synthetic scenarios exercise real cover choices');
 // Real nav graphs: compare over many bot/threat/weapon placements.
 let mapNonNull=0;
 for(const id of ['titan-valley','convoy-line','frostline','exchange']){
  const match=new Match('chatgpt','openclaw',()=>.5,id,{mode:'combined-arms',humanCount:0,botCount:2,difficulty:'normal',timeLimit:60});
  const bounds=match.arena.bounds||{minX:-13,maxX:13,minZ:-13,maxZ:13};
  for(let i=0;i<120;i++){
   const a={x:bounds.minX+random()*(bounds.maxX-bounds.minX),y:random()*4,z:bounds.minZ+random()*(bounds.maxZ-bounds.minZ),weapon:i%WEAPONS.length};
   const threat={x:bounds.minX+random()*(bounds.maxX-bounds.minX),y:random()*4,z:bounds.minZ+random()*(bounds.maxZ-bounds.minZ)};
   const fast=coverPoint(match,a,threat),reference=referenceCover(match,a,threat);
   assert.deepEqual(fast,reference,`${id} cover ${i}`);
   checked++;if(fast)mapNonNull++;
  }
 }
 assert.ok(mapNonNull>0,'the real-map scenarios choose a cover');
 assert.ok(checked>700,`compared ${checked} scenarios`);
});
