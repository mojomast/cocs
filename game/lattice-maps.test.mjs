// Lattice slice map — V0a theatre stand-in (docs/design/COCS-MAP-ARCHITECTURE.md
// §1, §5; COCS-MODE-SPEC.md §4). Verifies the authored map satisfies the schema
// v3 contract, the lattice doctrine, nav reachability and the construction
// budget *before* the M0 nav bake exists.
import assert from 'node:assert/strict';
import test from 'node:test';
import {MAPS,getMap} from './maps.mjs';
import {LATTICE_MAPS} from './lattice-maps.mjs';
import {validateMapSchema,validateLattice,CAPTURABLE_ARCHETYPES} from './map-schema.mjs';
import {navigation} from './core.mjs';
import {Match} from './core.mjs';
import {arenaMeta} from './arenas.mjs';
import {GAME_MODES} from './config.mjs';

const SLICE=getMap('lattice-slice');
const TTC_SPEED=6; // m/s reference run speed for the doctrine TTC proxy.

function nearestIndex(graph,point){
 let best=0,distance=Infinity;
 graph.nodes.forEach((n,index)=>{const d=Math.hypot(n.x-point.x,n.z-point.z);if(d<distance){best=index;distance=d;}});
 return best;
}

// Dijkstra over the nav graph (edge weight = Euclidean step length).
function navDistance(graph,from,to){
 const distances=new Array(graph.nodes.length).fill(Infinity),visited=new Uint8Array(graph.nodes.length);
 distances[from]=0;
 for(;;){
  let current=-1,best=Infinity;
  for(let i=0;i<distances.length;i++)if(!visited[i]&&distances[i]<best){current=i;best=distances[i];}
  if(current<0||current===to)break;
  visited[current]=1;
  for(const next of graph.edges[current]){
   const a=graph.nodes[current],b=graph.nodes[next];
   const candidate=distances[current]+Math.hypot(b.x-a.x,b.z-a.z);
   if(candidate<distances[next])distances[next]=candidate;
  }
 }
 return distances[to];
}

test('the lattice slice is registered, immutable and schema v3 valid',()=>{
 assert.ok(LATTICE_MAPS.includes(SLICE),'slice is exported from lattice-maps');
 assert.ok(MAPS.includes(SLICE),'slice is registered in MAPS');
 assert.ok(Object.isFrozen(SLICE)&&Object.isFrozen(SLICE.nodes)&&Object.isFrozen(SLICE.lattice));
 assert.deepEqual(validateMapSchema(SLICE),[]);
 assert.deepEqual(validateLattice(SLICE),[]);
});

test('the slice authors the frozen lattice interface',()=>{
 const archetypes=SLICE.nodes.map(n=>n.archetype);
 assert.equal(SLICE.nodes.length,5,'five nodes');
 assert.deepEqual([...archetypes].sort(),['front','front','hq','hq','relay']);
 assert.equal(archetypes.filter(a=>a==='hq').length,2,'one HQ per side');
 assert.equal(SLICE.terminals.length,1);
 assert.equal(SLICE.lanes.length,3);
 assert.deepEqual(SLICE.lanes.map(l=>l.kind).sort(),['cqc','vehicle-road','zipline-flank']);
 assert.ok(SLICE.lanes.every(l=>l.traversal.kind===l.kind));
 assert.ok(SLICE.nodes.filter(n=>CAPTURABLE_ARCHETYPES.includes(n.archetype)).length>=3);
});

test('the slice layout is rotationally symmetric (x,z)->(-x,-z)',()=>{
 const find=(x,z)=>SLICE.nodes.find(n=>Math.abs(n.x+x)<1e-9&&Math.abs(n.z+z)<1e-9);
 for(const n of SLICE.nodes){
  const twin=find(n.x,n.z);
  assert.ok(twin,`${n.id} has a rot180 twin`);
  assert.equal(twin.archetype,n.archetype,`${n.id} twin archetype`);
 }
 for(const b of SLICE.blocks){
  const twin=SLICE.blocks.find(o=>o.kind===b.kind&&o.w===b.w&&o.d===b.d&&o.h===b.h&&Math.abs(o.x+b.x)<1e-9&&Math.abs(o.z+b.z)<1e-9);
  assert.ok(twin,`block ${b.kind}@${b.x},${b.z} has a rot180 twin`);
 }
});

test('playBounds, node spacing and lanes sit inside the doctrine bands',()=>{
 const p=SLICE.playBounds;
 assert.equal(p.frontage,240);
 assert.ok(p.frontage<=240);
 assert.ok(Math.max(p.maxX-p.minX,p.maxZ-p.minZ)<=240);
 assert.ok(p.laneSep<=80,p.laneSep);
 assert.ok(p.maxNodeSpacing<=140,p.maxNodeSpacing);
 for(const n of SLICE.nodes){
  assert.ok(n.x>=p.minX&&n.x<=p.maxX&&n.z>=p.minZ&&n.z<=p.maxZ,`${n.id} inside playBounds`);
  assert.ok(Number.isFinite(n.r)&&n.r>0);
 }
 // Adjacent lattice-node spacing is the doctrine measurement (<=140 m).
 const byId=new Map(SLICE.nodes.map(n=>[n.id,n]));
 for(const [a,b] of SLICE.lattice){
  const spacing=Math.hypot(byId.get(a).x-byId.get(b).x,byId.get(a).z-byId.get(b).z);
  assert.ok(spacing<=140,`${a}-${b} spacing ${spacing.toFixed(1)} m`);
 }
 for(const lane of SLICE.lanes)for(const [x,z] of lane.waypoints){
  assert.ok(x>=p.minX&&x<=p.maxX&&z>=p.minZ&&z<=p.maxZ,`${lane.id} waypoint in bounds`);
 }
 for(const lane of SLICE.lanes)if(lane.width!==undefined)assert.ok(lane.width>=6);
});

test('every lattice node and spawn is reachable in both directions',()=>{
 const graph=navigation(SLICE);
 assert.ok(graph.nodes.length>0&&graph.nodes.length<=2500,`modest nav graph (${graph.nodes.length} nodes)`);
 const incoming=graph.edges.map(()=>[]);
 graph.edges.forEach((list,from)=>list.forEach(to=>incoming[to].push(from)));
 for(const [label,edges] of [['forward',graph.edges],['return',incoming]]){
  const seen=new Set([0]),queue=[0];
  while(queue.length)for(const next of edges[queue.shift()])if(!seen.has(next)){seen.add(next);queue.push(next);}
  assert.equal(seen.size,graph.nodes.length,`${label} reachability`);
 }
 for(const n of SLICE.nodes){
  const index=nearestIndex(graph,n);
  assert.ok(Math.hypot(graph.nodes[index].x-n.x,graph.nodes[index].z-n.z)<=10,`${n.id} has a nav node nearby`);
 }
});

test('the level-design TTC proxy stays inside the doctrine bands',()=>{
 const graph=navigation(SLICE);
 const byId=new Map(SLICE.nodes.map(n=>[n.id,n]));
 const route=to=>navDistance(graph,nearestIndex(graph,{x:SLICE.teamSpawns[0][0][0],z:SLICE.teamSpawns[0][0][1]}),nearestIndex(graph,byId.get(to)))/TTC_SPEED;
 const firstContact=route('front-0');
 const rotate=navDistance(graph,nearestIndex(graph,byId.get('front-0')),nearestIndex(graph,byId.get('front-1')))/TTC_SPEED;
 assert.ok(firstContact<=30,`spawn->front TTC proxy ${firstContact.toFixed(1)} s <= 30 s`);
 assert.ok(firstContact<45,`first contact ${firstContact.toFixed(1)} s < 45 s`);
 assert.ok(rotate<=80,`front->front rotate proxy ${rotate.toFixed(1)} s <= 80 s`);
 console.log(`lattice-slice nav: ${graph.nodes.length} nodes, spawn->front ${firstContact.toFixed(1)} s, front->front ${rotate.toFixed(1)} s`);
});

test('the slice builds a Match inside the 2 s budget',()=>{
 const started=performance.now();
 const match=new Match('chatgpt','openclaw',()=>.5,'lattice-slice',{mode:'domination',botCount:8,humanCount:1,difficulty:'normal'});
 const elapsed=performance.now()-started;
 assert.ok(match.arena.id==='lattice-slice');
 assert.ok(elapsed<=2000,`new Match ${elapsed.toFixed(0)} ms <= 2000 ms`);
 assert.ok(match.nav.length<=2500,`nav nodes ${match.nav.length}`);
 console.log(`lattice-slice new Match: ${elapsed.toFixed(0)} ms, ${match.nav.length} nav nodes`);
});

test('arena metadata registers the slice for the cocs play list when the mode exists',()=>{
 const meta=arenaMeta('lattice-slice');
 assert.ok(meta);
 assert.equal(meta.group,'outdoor');
 assert.equal(meta.scale,'warzone');
 assert.equal(meta.legacy,false);
 assert.ok(meta.play.includes('domination')&&meta.play.includes('koth'));
 const hasCocs=GAME_MODES.some(mode=>mode.id==='cocs');
 assert.equal(meta.play.includes('cocs'),hasCocs,'cocs is advertised only when config lands the mode');
 for(const mode of meta.play)assert.ok(GAME_MODES.some(entry=>entry.id===mode),`${mode} is a real game mode`);
});
