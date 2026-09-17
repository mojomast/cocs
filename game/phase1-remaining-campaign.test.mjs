import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,floorAt,obstructed,walkEdge} from './core.mjs';
import {missionFor} from './campaign-data.mjs';
import {updateSinglePlayer,resumeSinglePlayer} from './singleplayer.mjs';

const make=(id,checkpoint)=>new Match('chatgpt','openclaw',()=>.5,missionFor(id).mapId,{mode:'campaign',mission:id,checkpoint,difficulty:'easy',botCount:0,timeLimit:600});
const tick=m=>updateSinglePlayer(m,1/60);
const clear=(m,group)=>{for(const id of m.modeState.groups[group]||[])m.actors.find(a=>a.id===id).health=0;};
const place=(p,point)=>Object.assign(p,{x:point.x,y:point.y,z:point.z,vx:0,vy:0,vz:0});

function inspect(id){
 test(`${id}: bounded anchors, supported walking paths and predeployment`,()=>{
  const m=make(id),s=m.modeState;
  assert.ok(s.anchors?.entrance,'named floor anchors must be integrated');
  assert.equal(s.mission.predeploy,true);
  assert.equal(m.arena.id,s.mission.mapId);
  const start=m.nav.findIndex(n=>n.x===s.anchors.entrance.x&&n.y===s.anchors.entrance.y&&n.z===s.anchors.entrance.z);
  const parents=new Map([[start,null]]),queue=[start];
  for(let q=0;q<queue.length;q++)for(const n of m.edges[queue[q]])if(!parents.has(n)){parents.set(n,queue[q]);queue.push(n);}
  for(const [name,a] of Object.entries(s.anchors)){
   const spec=s.mission.anchors[name];
   assert.ok(Math.hypot(a.x-spec.x,a.z-spec.z)<=spec.maxSnap,`${name}: local bound`);
  }
  for(const p of [...Object.values(s.anchors),...m.actors.slice(1)]){
   const index=m.nav.findIndex(n=>n.x===p.x&&n.y===p.y&&n.z===p.z);
   assert.ok(index>=0&&parents.has(index),'entrance walking path');
   assert.ok(s.campaignReachable.includes(m.nav[index]),'return path');
   assert.ok(Math.abs(floorAt(p.x,p.z,m.arena)-p.y)<.01,'supported floor');
   assert.equal(obstructed(p.x,p.y,p.z,.52,m.arena),false,'actor clearance');
   for(let n=index;parents.get(n)!==null;n=parents.get(n))assert.ok(walkEdge(m.nav[parents.get(n)],m.nav[n],m.arena),'continuous walking edge');
  }
  for(const step of s.steps){
   assert.ok(step.marker.anchor&&Number.isFinite(step.marker.y));
   for(const action of step.onStart||[])if(action.spawn)assert.equal(s.groups[action.spawn.group].length,step.onStart.filter(a=>a.spawn?.group===action.spawn.group).reduce((n,a)=>n+a.spawn.count,0));
  }
  assert.ok(s.script.every(e=>e.step),'all scripts and lore scoped');
  assert.ok(s.script.every(e=>!e.spawn),'no in-view script deployment');
  const count=m.actors.length;tick(m);assert.equal(m.actors.length,count);
  console.log(`${id}: ${Object.keys(s.anchors).length} anchors, ${count-1} defenders, ${queue.length}/${m.nav.length} reachable nav nodes`);
 });
}
inspect('reactor-run');
inspect('throne-siege');
inspect('ghost-wire');
inspect('crown-duel');

for(const id of ['reactor-run','throne-siege','ghost-wire','crown-duel']){
 test(`${id}: controlled position/kills walkthrough respects volumes and required groups`,()=>{
  for(const checkpoint of [undefined,Number(Object.keys(missionFor(id).checkpoints)[0])]){
  const m=make(id,checkpoint),s=m.modeState,p=m.actors[0],count=m.actors.length;p.protection=1e9;
  for(let index=s.stepIndex;index<s.steps.length;index++){
   const step=s.steps[index],c=step.complete;
   assert.equal(s.stepIndex,index);
   const groups=[...new Set([c.group,...(c.groups||[])].filter(Boolean))];
   place(p,step.marker);
   if(groups.length){
    updateSinglePlayer(m,(c.seconds||0)+1);
    assert.equal(s.stepIndex,index,'live defenders gate progress');
    for(const group of groups)clear(m,group);
   }
   place(p,{...step.marker,y:step.marker.y+8});
   updateSinglePlayer(m,(c.seconds||0)+1);
   assert.equal(s.stepIndex,index,'wrong elevation cannot finish the route objective');
   place(p,step.marker);
   updateSinglePlayer(m,(c.seconds||0)+1);
   assert.equal(s.stepIndex,index+1,step.id);
   assert.equal(m.actors.length,count,'no onStart/script/ability pop-in');
  }
  assert.equal(s.phase,'won');
  const terminal=s.mission.checkpoints?.[s.steps.length];
  if(terminal)assert.equal(s.checkpoint,s.steps.length,'checkpoint before victory');
  console.log(`${id}: controlled walkthrough from ${checkpoint??0} -> step ${s.stepIndex} ${s.phase}; checkpoint ${s.checkpoint}`);
  if(id==='ghost-wire')assert.equal(m.actors.filter(a=>a.isNpc&&a.health>0).length,count-1,'stealth never requires optional patrol kills');
  else assert.ok(m.actors.slice(1).every(a=>a.health<=0),'no required defenders left behind');
  }
 });
 test(`${id}: every authored checkpoint rebuilds future groups at its own floor`,()=>{
  for(const key of Object.keys(missionFor(id).checkpoints)){
   const m=make(id),s=m.modeState,p=m.actors[0],index=Number(key);
   m.rockets.push({owner:1});p.health=1;p.armor=0;
   resumeSinglePlayer(m,index);
   const anchor=s.anchors[s.mission.checkpoints[index]];
   assert.deepEqual([p.x,p.y,p.z],[anchor.x,anchor.y,anchor.z]);
   assert.equal(m.rockets.length,0);assert.equal(p.health,p.maxHealth);
   const future=new Set(s.steps.slice(index).flatMap(step=>step.onStart.filter(a=>a.spawn).map(a=>a.spawn.group)));
   assert.deepEqual(new Set(Object.keys(s.groups)),future);
   assert.ok(m.actors.every((a,i)=>a.id===i));
   const count=m.actors.length;resumeSinglePlayer(m,index);tick(m);assert.equal(m.actors.length,count);
   assert.ok(s.script.filter(e=>s.steps.findIndex(step=>step.id===e.step)<index).every(e=>s.fired[e.id]));
   if(index===s.steps.length)assert.equal(s.phase,'won','terminal checkpoint must not strand a bossless mission');
  }
 });
}

test('ghost-wire: ridge volume script fires before the enter-zone step advances',()=>{
 const m=make('ghost-wire'),s=m.modeState,p=m.actors[0];s.stepIndex=1;
 const point=s.steps[1].marker;
 place(p,{...point,y:point.y+8});tick(m);
 assert.equal(s.fired['ghost-ambush'],undefined);
 place(p,point);tick(m);
 assert.equal(s.stepIndex,2);
 assert.equal(s.fired['ghost-ambush'],true,'script must not be skipped by same-tick objective completion');
});

for(const [id,checkpoint] of [['reactor-run',2],['throne-siege',3],['ghost-wire',2],['crown-duel',3]]){
 test(`${id}: actual Match.step, 120 protected-player frames from entrance and checkpoint`,()=>{
  for(const cp of [undefined,checkpoint]){
   const m=make(id,cp),s=m.modeState,ids=m.actors.map(a=>a.id);m.actors[0].protection=1e9;
   for(let frame=0;frame<120;frame++)m.step(1/60,{inputs:{}});
   assert.equal(m.over,false);assert.equal(s.stepIndex,cp??0);
   assert.deepEqual(m.actors.map(a=>a.id),ids,'no visible step/script/ability deployment');
   assert.ok(m.actors.every(a=>[a.x,a.y,a.z].every(Number.isFinite)));
   assert.ok(s.waypoint&&Number.isFinite(s.waypoint.y));
   console.log(`${id}: Match.step start=${cp??0}, frames=120, actors=${ids.length}, step=${s.stepIndex}`);
  }
 });
 test(`${id}: fallback cannot skip the route; scripts are height-aware and once-only`,()=>{
  const m=make(id),s=m.modeState,p=m.actors[0];p.protection=1e9;
  place(p,s.win.anchor?s.win:s.steps.at(-1).marker);
  for(const a of m.actors.slice(1))a.health=0;
  tick(m);assert.equal(m.over,false);
  for(const event of s.script.filter(e=>e.when==='player-in-zone')){
   const n=make(id),t=n.modeState,player=n.actors[0];player.protection=1e9;
   const stepIndex=t.steps.findIndex(step=>step.id===event.step);
   t.stepIndex=stepIndex;
   const events=[],emit=n.emit.bind(n);n.emit=(kind,data)=>{events.push([kind,data]);emit(kind,data);};
   place(player,{...event,y:event.y+8});tick(n);assert.equal(t.fired[event.id],undefined);
   place(player,event);tick(n);assert.equal(t.fired[event.id],true);
   const fired=events.length;tick(n);
   // Once-only flag persists even if the objective changed or ended the match.
   assert.equal(t.fired[event.id],true);
   if(event.bark)assert.equal(events.filter(([kind,data])=>kind==='npc-bark'&&data.text===event.bark.text).length,1);
   assert.ok(events.length>=fired);
  }
 });
}

test('crown-duel: predeployed Harbinger cannot summon visible actors',()=>{
 const m=make('crown-duel'),s=m.modeState,boss=m.actors.find(a=>a.isBoss),count=m.actors.length;
 boss.summonTimer=0;
 tick(m);
 assert.equal(m.actors.length,count,'summon policy must be consumed by runtime, not unused mission schema');
 assert.equal(s.summonCount,0);
});
