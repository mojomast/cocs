import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,floorAt,obstructed,walkEdge} from './core.mjs';
import {resolveCampaignAnchors,campaignPoint,campaignGroupPoints} from './campaign-anchors.mjs';
import {updateSinglePlayer, resumeSinglePlayer} from './singleplayer.mjs';

const make=(difficulty='easy')=>new Match('chatgpt','openclaw',()=>.5,'convoy-line',{mode:'campaign',mission:'convoy-run',difficulty,botCount:0,timeLimit:600});
const tick=m=>updateSinglePlayer(m,1/60);
const clear=(m,group)=>{for(const id of m.modeState.groups[group]||[]){const a=m.actors.find(a=>a.id===id);a.health=0;}};

test('convoy cannot extract early; required opening and crossing guards gate progression',()=>{
 const m=make(),s=m.modeState,p=m.actors[0];
 Object.assign(p,s.win);for(const a of m.actors.slice(1))a.health=0;
 tick(m);assert.equal(m.over,false,'fallback exit must not skip linear steps');
 const n=make(),t=n.modeState;
 Object.assign(n.actors[0],t.steps[0].marker);tick(n);
 clear(n,'tenements');tick(n);assert.equal(t.stepIndex,1,'opening patrol is required');
 clear(n,'opening');tick(n);assert.equal(t.stepIndex,2);
 Object.assign(n.actors[0],t.steps[2].marker);
 updateSinglePlayer(n,21);assert.equal(t.stepIndex,2,'guards gate hold');
 clear(n,'bridge');updateSinglePlayer(n,21);assert.equal(t.stepIndex,3);
});

test('convoy bridge volume is height aware, step scoped and fires only once',()=>{
 const m=make(),s=m.modeState,p=m.actors[0],events=[];
 const emit=m.emit.bind(m);m.emit=(kind,data)=>{events.push(kind);emit(kind,data);};
 const marker=s.steps[2].marker;
 Object.assign(p,marker);tick(m);assert.equal(s.fired['convoy-bridge-ambush'],undefined);
 s.stepIndex=2;Object.assign(p,{...marker,y:marker.y+8});tick(m);
 assert.equal(s.fired['convoy-bridge-ambush'],undefined);
 Object.assign(p,marker);tick(m);tick(m);
 assert.equal(events.filter(e=>e==='weather-change').length,1);
});

test('convoy checkpoint restores recovery floor, future groups only and finite difficulty supplies',()=>{
 for(const difficulty of ['easy','nightmare']){
  const m=make(difficulty),s=m.modeState,p=m.actors[0];
  p.health=1;p.armor=0;p.weapon=1;p.ammo[p.weapon]=1;
  assert.equal(resumeSinglePlayer(m,3),true);
  assert.deepEqual([p.x,p.y,p.z],[s.anchors['checkpoint.roadblock'].x,s.anchors['checkpoint.roadblock'].y,s.anchors['checkpoint.roadblock'].z]);
  assert.equal(s.groups.opening,undefined);
  assert.ok(s.groups.roadblock.length&&s.groups.yard.length);
  const fraction=difficulty==='easy'?1:.4;
  assert.equal(p.health,Math.ceil(p.maxHealth*fraction));
  assert.equal(p.armor,Math.round(60*fraction));
  assert.equal(p.ammo[p.weapon],Math.ceil(m.weaponForIndex(p,p.weapon).cap*fraction));
  assert.equal(p.ammo[0],Infinity,'starter remains infinite');
  assert.equal(p.ammo[2],0,'unowned weapon is not granted');
  assert.equal(s.weather,'rain');
  const count=m.actors.length;resumeSinglePlayer(m,3);assert.equal(m.actors.length,count);
  assert.ok(m.actors.every((a,i)=>a.id===i),'core projectile owners require dense actor IDs after restore');
  tick(m);assert.equal(m.actors.length,count,'restore plus onStart never duplicates');
 }
});

test('convoy named anchors resolve to connected floor nodes and mandatory groups deploy before play',()=>{
 const m=make(),s=m.modeState;
 assert.ok(s.anchors?.entrance,'named entrance is integrated');
 for(const name of ['encounter.tenements','encounter.bridge','checkpoint.roadblock','exit']){
  const a=s.anchors[name];
  assert.ok(a&&Number.isFinite(a.y),name);
  assert.ok(m.nav.some(n=>n.x===a.x&&n.y===a.y&&n.z===a.z),name);
 }
 for(const group of ['opening','tenements','bridge','roadblock','yard'])assert.ok(s.groups[group]?.length,group);
 const ids=m.actors.map(a=>a.id);
 tick(m);tick(m);
 assert.deepEqual(m.actors.map(a=>a.id),ids,'no visible onStart pop-in');
});

test('convoy objective cannot complete from a different elevation',()=>{
 const m=make(),s=m.modeState,p=m.actors[0];
 const marker=s.steps[0].marker;
 Object.assign(p,{x:marker.x,z:marker.z,y:(marker.y??0)+12});
 tick(m);
 assert.equal(s.stepIndex,0);
 Object.assign(p,{x:marker.x,z:marker.z,y:marker.y});
 tick(m);
 assert.equal(s.stepIndex,1);
});

test('convoy lore is step scoped and checkpoint removes stale combat hazards',()=>{
 const m=make(),s=m.modeState;
 assert.ok(s.script.filter(e=>e.lore).every(e=>e.step),'no premature victory chatter');
 m.rockets.push({owner:s.enemies[0]});
 resumeSinglePlayer(m,3);
 assert.equal(m.rockets.length,0);
 assert.ok(s.script.filter(e=>['rally','tenements','bridge'].includes(e.step)).every(e=>s.fired[e.id]));
});

test('convoy required actors and anchors have walking paths on supported floor',()=>{
 const m=make(),s=m.modeState;
 const start=m.nav.findIndex(n=>n.x===s.anchors.entrance.x&&n.z===s.anchors.entrance.z);
 const parents=new Map([[start,null]]),queue=[start];
 for(let q=0;q<queue.length;q++)for(const next of m.edges[queue[q]])if(!parents.has(next)){
  parents.set(next,queue[q]);queue.push(next);
 }
 let paths=0;
 for(const point of [...Object.values(s.anchors),...m.actors.slice(1)]){
  const index=m.nav.findIndex(n=>n.x===point.x&&n.y===point.y&&n.z===point.z);
  assert.ok(index>=0&&parents.has(index),'reachable node');
  assert.ok(Math.abs(floorAt(point.x,point.z,m.arena)-point.y)<.01,'authoritative floor');
  assert.equal(obstructed(point.x,point.y,point.z,.52,m.arena),false,'actor clearance');
  for(let i=index;parents.get(i)!==null;i=parents.get(i))assert.ok(walkEdge(m.nav[parents.get(i)],m.nav[i],m.arena),'continuous walk edge');
  paths++;
 }
 assert.equal(paths,28,'nine anchors plus nineteen defenders');
});

test('campaign anchor resolver rejects disconnected, wrong-floor and unknown references',()=>{
 const nav=[{x:0,y:0,z:0},{x:2,y:8,z:0},{x:4,y:0,z:0}],m={nav,edges:[[],[],[]]};
 assert.throws(()=>resolveCampaignAnchors(m,{id:'fixture',anchors:{entrance:{x:0,z:0},exit:{x:4,z:0,maxSnap:1}}}),/unreachable/);
 assert.throws(()=>resolveCampaignAnchors(m,{id:'fixture',anchors:{entrance:{x:2,z:0,y:0,maxSnap:1}}}),/supported floor/);
 assert.throws(()=>campaignPoint({}, {anchor:'absent'}),/Unknown/);
 assert.throws(()=>campaignGroupPoints({actors:[]},{anchors:{a:nav[0]},campaignReachable:[nav[0]]},{anchor:'a',group:'blocked'},2),/needs 2/);
});

test('bounded convoy objective and checkpoint playthrough reaches victory without leftover required groups',()=>{
 for(const checkpoint of [null,3]){
  const m=make(),s=m.modeState,p=m.actors[0];p.protection=1e9;
  if(checkpoint!==null)resumeSinglePlayer(m,checkpoint);
  const visited=[];
  for(let guard=0;guard<10&&!m.over;guard++){
   const step=s.steps[s.stepIndex];visited.push(step.id);
   Object.assign(p,{x:step.marker.x,y:step.marker.y,z:step.marker.z});
   tick(m);
   for(const group of [step.complete.group,...(step.complete.groups||[])].filter(Boolean))clear(m,group);
   updateSinglePlayer(m,step.complete.seconds?step.complete.seconds+.1:1/60);
  }
  assert.equal(m.over,true);assert.equal(s.winner,0);
  assert.equal(s.stepIndex,5);assert.equal(s.checkpoint,5);
  assert.ok(visited.includes('yard'));
  assert.ok(s.enemies.every(id=>m.actors.find(a=>a.id===id).health<=0));
 }
});

test('convoy runs bounded real Match.step frames before and after checkpoint loading',()=>{
 for(const checkpoint of [undefined,3]){
  const m=new Match('chatgpt','openclaw',()=>.5,'convoy-line',{mode:'campaign',mission:'convoy-run',checkpoint,botCount:0,timeLimit:600});
  const s=m.modeState,ids=m.actors.map(a=>a.id);m.actors[0].protection=1e9;
  for(let frame=0;frame<120;frame++)m.step(1/60,{inputs:{}});
  assert.equal(m.over,false);
  assert.deepEqual(m.actors.map(a=>a.id),ids,'no in-view script or step deployment');
  assert.ok(m.actors.every(a=>[a.x,a.y,a.z].every(Number.isFinite)));
  assert.ok(s.waypoint&&Number.isFinite(s.waypoint.y));
  assert.equal(s.stepIndex,checkpoint??0);
 }
});

test('convoy non-checkpoint requests normalize to an authored checkpoint without missing prerequisite groups',()=>{
 const m=make(),s=m.modeState;
 resumeSinglePlayer(m,1);
 assert.equal(s.stepIndex,0);
 assert.equal(m.actors[0].x,s.anchors.entrance.x);
 assert.ok(s.groups.opening.length);
 resumeSinglePlayer(m,4);
 assert.equal(s.stepIndex,3);
 assert.ok(s.groups.roadblock.length);
});
