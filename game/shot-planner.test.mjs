import test from 'node:test';
import assert from 'node:assert/strict';
import {planShot,SHOT_RIGS,SHOT_RIG_TO_RIG,PLANNER,SCORING} from './shot-planner.mjs';

const seeded=(seed=1)=>{let state=seed>>>0;return()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};};
const actor=(id,x,z,extra={})=>({id,name:`A${id}`,character:'chatgpt',team:id%2,x,y:0,z,yaw:0,pitch:0,vx:0,vz:0,health:100,dead:0,vehicleId:null,frags:0,...extra});
const snap=(time,actors,extra={})=>({time,mapId:'flat',actors,vehicles:[],objectives:null,events:[],...extra});
const damage=(time,actor,source,amount=12)=>({type:'damage',time,actor,source,amount});
// A flat, unbounded safety world: the planner tests exercise framing and
// selection, while the arena-backed callbacks are covered in director.test.mjs.
const OPEN={floorAt:()=>0,obstructed:()=>false,rayVisible:()=>true,interiorAt:()=>null,bounds:null};
const call=(state,{previous=null,rng=seeded(3),safety=OPEN,events=state.events,...extra}={})=>planShot({state,events,previous,time:state.time,dt:1/60,safety,random:rng,...extra});

test('planShot is deterministic and never mutates the state it is given',()=>{
 const build=()=>{
  const rng=seeded(17);
  let previous=null;
  const out=[];
  for(let i=0;i<60;i++){
   const t=i/60;
   const actors=[actor(1,0,0),actor(2,8,1),actor(3,-30,-30,{team:0})];
   const events=[damage(t,2,1,9),damage(t,1,2,9)];
   const state=snap(t,actors,{events});
   const before=JSON.stringify(state);
   previous=planShot({state,events,previous,time:t,dt:1/60,safety:OPEN,random:rng});
   assert.equal(JSON.stringify(state),before,'planner must treat the state as read-only');
   out.push(previous);
   if(i===0){
    assert.ok(SHOT_RIGS.includes(previous.rig),`unknown rig ${previous.rig}`);
    assert.ok(Number.isFinite(previous.minUntil)&&Number.isFinite(previous.score));
    assert.ok(Number.isFinite(previous.pose.x)&&Number.isFinite(previous.pose.yaw)&&Number.isFinite(previous.pose.pitch));
   }
  }
  return out;
 };
 const first=build(),second=build();
 assert.deepEqual(first,second,'identical inputs and rng seeds produce identical plans');
});

test('a firefight beats a teammate-only cluster',()=>{
 const cluster=[actor(1,-25,-25,{team:0}),actor(2,-24,-24,{team:0}),actor(3,-26,-24,{team:0}),actor(4,-25,-23,{team:0})];
 const duel=[actor(5,20,20,{team:0}),actor(6,22,20,{team:1})];
 const events=[damage(1,6,5,20),damage(1,5,6,20)];
 const plan=call(snap(1,[...cluster,...duel],{events}));
 assert.equal(plan.subjectKind,'firefight');
 assert.deepEqual(plan.targets,[5,6]);
 assert.ok(!plan.targets.some(id=>id<5),'the idle cluster is not the subject');
 assert.ok(Math.hypot(plan.anchor.x-21,plan.anchor.z-20)<5,`anchor ${plan.anchor.x},${plan.anchor.z}`);
 assert.ok(plan.score>0);
});

test('a kill resolves the current encounter without cutting away and is then held',()=>{
 const actors=[actor(1,0,0,{team:0}),actor(2,6,0,{team:1}),actor(3,20,20,{team:0}),actor(4,22,20,{team:1})];
 const firefight=[damage(1,2,1,15),damage(1,1,2,15)];
 let previous=call(snap(1,actors,{events:firefight}));
 assert.equal(previous.subjectKind,'firefight');
 const killEvent={type:'death',id:9,time:1.2,actor:2,killer:1,pos:{x:6,y:0,z:0}};
 const events=[...firefight,killEvent];
 const kill=call(snap(1.2,actors,{events}),{previous});
 assert.equal(kill.subjectKind,'kill');
  assert.equal(kill.incumbent,true);
  assert.equal(kill.transition.type,'blend','the watched encounter resolves in the same shot');
  assert.equal(kill.rig,previous.rig);
 assert.ok(kill.minUntil>=1.2+PLANNER.killHold-1e-9,`minUntil ${kill.minUntil}`);
 assert.deepEqual(kill.targets,[1,2]);
 const held=call(snap(1.3,actors,{events}),{previous:kill});
 assert.equal(held.incumbent,true,'the kill beat is held, not immediately cut away');
 assert.deepEqual(held.targets,kill.targets);
 assert.ok(held.minUntil>=kill.minUntil-1e-9);
 assert.ok(held.pose.x===kill.pose.x||Number.isFinite(held.pose.x));
});

test('contested objectives are chosen and protected by their hold window',()=>{
 const objectives={kind:'koth',zones:[{id:'hill',x:0,z:0,radius:6,owner:0,captureTeam:1,progress:40,contested:true}]};
 const actors=[actor(1,0,0,{team:0}),actor(2,2,1,{team:1})];
 const first=call(snap(0,actors,{objectives}));
 assert.equal(first.subjectKind,'objective');
 assert.equal(first.transition.type,'cut');
 assert.ok(first.minUntil>=PLANNER.objectiveHold-1e-9);
 // A strong firefight appears elsewhere; the contested objective is a beat, so
 // the hold window keeps it until the fight is over.
 const extra=[actor(3,-20,-20,{team:0}),actor(4,-18,-20,{team:1})];
 const events=[damage(.5,4,3,40),damage(.5,3,4,40)];
 const held=call(snap(.5,[...actors,...extra],{objectives,events}),{previous:first});
 assert.equal(held.incumbent,true,'an objective beat holds through a nearby fight');
 assert.equal(held.subjectKind,'objective');
 assert.ok(held.minUntil>=first.minUntil-1e-9);
});

test('dead and missing targets are skipped, never invented',()=>{
 const pair=[actor(5,0,0,{team:0}),actor(6,8,0,{team:1})];
 const events=[damage(1,6,5,20),damage(1,5,6,20)];
 const first=call(snap(1,pair,{events}));
 assert.equal(first.subjectKind,'firefight');
 const dead=[{...pair[0],dead:1,health:0},{...pair[1],dead:1,health:0}];
 const after=call(snap(2,dead,{events}),{previous:first});
 assert.ok(!after.targets.includes(6),'a dead participant is never targeted');
 assert.ok(after.targets.every(id=>dead.some(a=>a.id===id)),'every target exists in the state');
 assert.notEqual(after.subjectKind,'firefight');
 assert.ok(Number.isFinite(after.pose.x)&&Number.isFinite(after.pose.z));
 // A kill with both participants gone is skipped as well.
 const killOnly=[{type:'death',id:3,time:2,actor:9,killer:8,pos:{x:4,y:0,z:4}}];
 const alone=call(snap(2,[], {events:killOnly}),{previous:first});
 assert.deepEqual(alone.targets,[]);
});

test('no-action states fall back to a safe establishing shot',()=>{
 const actors=[actor(1,-10,0,{team:0}),actor(2,10,0,{team:0}),actor(3,0,12,{team:0})];
 const plan=call(snap(0,actors));
 assert.ok(plan.subjectKind==='establish'||plan.subjectKind==='flyover',`kind ${plan.subjectKind}`);
 assert.deepEqual(plan.targets,[]);
 assert.ok(plan.score>0);
 assert.equal(plan.transition.type,'cut','the first plan places the camera');
 assert.ok(Number.isFinite(plan.pose.x)&&Number.isFinite(plan.pose.y)&&Number.isFinite(plan.pose.z));
 assert.ok(plan.minUntil>=PLANNER.minShot-1e-9);
});

test('flyover is context-only: cooldown/calm gated and disabled for reduced motion',()=>{
 const actors=[actor(1,0,0,{team:0}),actor(2,10,0,{team:0})];
 const first=call(snap(0,actors));
 assert.notEqual(first.rig,'flyover','the first shot never flies over');
 const calm={...first,watch:{...first.watch,calmSince:0,lastFlyoverAt:null}};
 const fly=call(snap(60,actors),{previous:calm});
 assert.equal(fly.rig,'flyover');
 assert.equal(fly.subjectKind,'flyover');
 assert.ok(fly.minUntil>=60+PLANNER.flyoverDuration-1e-9);
 assert.equal(fly.transition.type,'cut','flyover enters with an intentional cut');
 const reduced=call(snap(60,actors),{previous:calm,reduced:true});
 assert.notEqual(reduced.rig,'flyover','reduced motion never flies over');
});

test('an occluded composition is replaced by a visible one without oscillating',()=>{
 // A wall sits behind the fight at x=-3: the over-the-shoulder camera lands on
 // the far side of it, so the planner must pick a composition that can see the
 // subject and stay there instead of flipping between angles.
 const wall=(a,b)=>(a.x<-3)===(b.x<-3);
 const safety={...OPEN,rayVisible:wall};
 const actors=[actor(1,0,0,{team:0}),actor(2,5,0,{team:1})];
 const events=[damage(1,2,1,20),damage(1,1,2,20)];
 let previous=null;
 const decisions=[];
 for(let i=0;i<90;i++){
  const t=1+i/60;
  previous=call(snap(t,actors,{events}),{previous,safety});
  decisions.push(previous);
 }
 assert.ok(decisions[0].visibility>=.5,`first shot sees the subject (visibility ${decisions[0].visibility})`);
 for(const plan of decisions.slice(10)){
  assert.ok(plan.visibility>=.5,`a visible composition is kept (visibility ${plan.visibility}, rig ${plan.rig})`);
  assert.ok(Number.isFinite(plan.pose.x));
 }
 const tail=new Set(decisions.slice(45).map(p=>p.rig));
 assert.equal(tail.size,1,`rig oscillated: ${[...tail].join(',')}`);
 assert.ok(decisions.every(p=>p.visibility>=.5),'every shot in the run sees the subject');
});

test('an unsafe shot change becomes a cut and a safe one blends',()=>{
 const pair=[actor(1,0,0,{team:0}),actor(2,8,0,{team:1})];
 const events=[damage(1,2,1,20),damage(1,1,2,20)];
 const state=snap(1,pair,{events});
 const current=call(state);
 assert.equal(current.subjectKind,'firefight');
 // A previous shot on a subject that no longer exists, parked a few metres
 // from the new composition with the same heading: a nearby, compatible change.
  const previous={...current,incumbent:true,subjectKind:'firefight',subjectKey:'fight:97:98',targets:[97,98],primary:97,
  pose:{...current.pose,x:current.pose.x-3,z:current.pose.z-2},minUntil:0,startedAt:0,
  watch:{...current.watch,recentRigs:[],recentTargets:[],recentAngles:[]}};
 const safe=call(state,{previous});
 assert.equal(safe.incumbent,false);
 assert.equal(safe.transition.type,'blend','a nearby, clear change blends');
 assert.ok(Array.isArray(safe.transition.path)&&safe.transition.path.length>2,'a blend publishes its sampled path');
 const midX=(previous.pose.x+safe.pose.x)/2;
 const walled={...OPEN,obstructed:(x)=>Math.abs(x-midX)<1.4};
 const cut=call(state,{previous,safety:walled});
 assert.equal(cut.transition.type,'cut','a blocked path is cut, never pushed through');
 assert.equal(cut.transition.reason,'blocked');
 assert.ok(Number.isFinite(cut.pose.x)&&Number.isFinite(cut.pose.y));
 // A far-away compatible subject is also cut rather than blended across the map.
 const far={...previous,pose:{x:previous.pose.x+40,y:previous.pose.y,z:previous.pose.z}};
 const farCut=call(state,{previous:far});
 assert.equal(farCut.transition.type,'cut');
});

test('reduced motion holds longer and reframes more slowly',()=>{
 const actors=[actor(1,0,0,{team:0}),actor(2,9,0,{team:1})];
 const events=[damage(1,2,1,20),damage(1,1,2,20)];
 const normal=call(snap(1,actors,{events}));
 const reduced=call(snap(1,actors,{events}),{reduced:true});
 assert.ok(normal.minUntil-1>=PLANNER.minShot-1e-9);
 assert.ok(reduced.minUntil-1>=PLANNER.reducedMinShot-1e-9);
 assert.ok(reduced.minUntil>normal.minUntil,'reduced motion holds shots longer');
 assert.equal(reduced.visibility>=.5,true);
 // A short safe change blends in both, but reduced motion takes longer.
 const pair=[actor(1,0,0,{team:0}),actor(2,8,0,{team:1})];
 const state=snap(1,pair,{events});
 const current=call(state);
 const prior={...current,incumbent:true,pose:{...current.pose,x:current.pose.x-3,z:current.pose.z-2},minUntil:0,startedAt:0,
  watch:{...current.watch,recentRigs:[],recentTargets:[],recentAngles:[]}};
 const fast=call(state,{previous:prior});
 const slow=call(state,{previous:prior,reduced:true});
 assert.equal(fast.transition.type,'blend');
 assert.equal(slow.transition.type,'blend');
 assert.ok(slow.transition.dur>fast.transition.dur,`${slow.transition.dur} should exceed ${fast.transition.dur}`);
});

test('minimum shot duration and hysteresis ignore small score changes',()=>{
 const objectives={kind:'koth',zones:[{id:'hill',x:0,z:0,radius:6,owner:0,captureTeam:1,progress:35,contested:true}]};
 const actors=[actor(1,0,0,{team:0}),actor(2,2,1,{team:1})];
 const first=call(snap(1,actors,{objectives}));
 assert.equal(first.subjectKind,'objective');
 const extra=[actor(3,-20,-20,{team:0}),actor(4,-18,-20,{team:1})];
 const events=[damage(1.1,4,3,42),damage(1.1,3,4,42)];
 const tiny=call(snap(1.1,[...actors,...extra],{objectives,events}),{previous:first});
 assert.equal(tiny.incumbent,true,'a better-looking rival inside the hold does not steal the shot');
 assert.equal(tiny.subjectKind,'objective');
 const killEvent={type:'death',id:4,time:1.2,actor:4,killer:3,pos:{x:-19,y:0,z:-20}};
 const kill=call(snap(1.2,[...actors,...extra],{objectives,events:[...events,killEvent]}),{previous:tiny});
  assert.equal(kill.incumbent,true,'an unrelated kill cannot interrupt a resolving beat');
  assert.equal(kill.subjectKind,'objective');
  const requested=call(snap(1.2,[...actors,...extra],{objectives,events:[...events,killEvent]}),{previous:tiny,forceCut:true});
  assert.equal(requested.incumbent,false,'an explicit cut still overrides the hold');
  assert.equal(requested.subjectKind,'kill');
  assert.equal(requested.transition.type,'cut');
});

test('the repetition penalty prefers a fresh rig over an immediate repeat',()=>{
 const pairA=[actor(1,-40,0,{team:0}),actor(2,-32,0,{team:1})];
 const pairB=[actor(3,40,0,{team:0}),actor(4,48,0,{team:1})];
 const eventsA=[damage(1,2,1,20),damage(1,1,2,20)];
 const first=call(snap(1,pairA,{events:eventsA}));
 const control=call(snap(2,pairB,{events:[damage(2,4,3,20),damage(2,3,4,20)]}));
 assert.equal(control.rig,first.rig,'identical geometry normally asks for the same rig');
 const dead=[{...pairA[0],dead:1,health:0},{...pairA[1],dead:1,health:0}];
 const repeat=call(snap(2,[...dead,...pairB],{events:[...eventsA,damage(2,4,3,20),damage(2,3,4,20)]}),{previous:first});
 assert.notEqual(repeat.rig,first.rig,'an immediate rig repeat is penalised when alternatives exist');
 assert.equal(repeat.incumbent,false);
 assert.ok(repeat.score>0);
});

test('first-person is only used when the subject\'s aim is readable',()=>{
 const actors=[actor(1,0,0,{team:0}),actor(2,9,0,{team:1})];
 // One-way fire: actor 2 hits actor 1, so the subject has not aimed at anyone.
 const events=[damage(1,1,2,20)];
 // Only an eye-level camera can see the subject: every rig pose further away
 // than a metre loses its visibility score.
 const eyeOnly={...OPEN,rayVisible:(a,b)=>Math.hypot(a.x-b.x,a.z-b.z)<1};
 let previous=null;
 for(let i=0;i<60;i++){
  previous=call(snap(1+i/60,actors,{events}),{previous,safety:eyeOnly});
  assert.notEqual(previous.rig,'firstperson','no readable aim: no first-person shot');
 }
 const aimed=[...events,{type:'shot',id:2,time:1,actor:1,weapon:0}];
 const readable=call(snap(1,actors,{events:aimed}),{previous:null,safety:eyeOnly});
 assert.equal(readable.rig,'firstperson','a fresh shot by the subject makes the aim readable');
 assert.equal(readable.visibility,1);
});

test('race packs, soccer attacks and vehicle duels are all valid subjects',()=>{
 const racers=[actor(1,0,0,{team:0,vehicleId:1}),actor(2,6,0,{team:1,vehicleId:2})];
 const raceVehicles=[{id:1,kind:'puma',x:0,y:0,z:0,health:100,driver:1,gunner:null},{id:2,kind:'puma',x:6,y:0,z:0,health:100,driver:2,gunner:null}];
 const raceState=snap(1,racers,{vehicles:raceVehicles,race:{kind:'race',phase:'racing',standings:[
  {actorId:1,vehicleId:1,progress:.50,completedLaps:0},{actorId:2,vehicleId:2,progress:.46,completedLaps:0}]}});
 const race=call(raceState,{previous:{...call(raceState),watch:{raceOrder:[2,1]}}});
 assert.equal(race.subjectKind,'race');
 assert.deepEqual(race.targets,[1,2]);
 assert.ok(race.reason.startsWith('overtake'),`reason ${race.reason}`);
 const soccerVehicles=[{id:1,kind:'puma',x:8,y:0,z:1,health:100,driver:1},{id:2,kind:'puma',x:12,y:0,z:-1,health:100,driver:2}];
 const soccerState=snap(1,racers,{vehicles:soccerVehicles,race:{kind:'soccer',phase:'playing',
  ball:{x:10,y:.4,z:0,vx:6,vz:0,r:1},
  goals:[{team:0,x:20,z:0},{team:1,x:-20,z:0}],
  standings:[{actorId:1,team:0,vehicleId:1},{actorId:2,team:1,vehicleId:2}]}});
 const soccer=call(soccerState);
 assert.equal(soccer.subjectKind,'soccer');
 assert.ok(soccer.anchor.x>10,'the ball is led by its velocity');
 const duelVehicles=[{id:1,kind:'guntruck',x:0,y:0,z:0,health:80,driver:1,gunner:null},{id:2,kind:'guntruck',x:14,y:0,z:0,health:70,driver:2,gunner:null}];
 const duelState=snap(1,racers,{vehicles:duelVehicles,events:[{type:'vehicle-damage',time:1,vehicle:2,actor:1,amount:30}]});
 const duel=call(duelState);
 assert.equal(duel.subjectKind,'vehicle');
 assert.deepEqual(duel.targets,[1,2]);
});

test('the planner only ever returns known rigs, finite poses and bounded scores',()=>{
 const rng=seeded(23);
 let previous=null;
 for(let i=0;i<120;i++){
  const t=i/60;
  const actors=[actor(1,0,0,{team:0}),actor(2,7,2,{team:1}),actor(3,-6,-3,{team:0}),actor(4,-2,-7,{team:1})];
  const events=[damage(t,2,1,6),damage(t,1,2,6),damage(t,4,3,6),damage(t,3,4,6)];
  previous=planShot({state:snap(t,actors,{events}),events,previous,time:t,dt:1/60,safety:OPEN,random:rng});
  assert.ok(SHOT_RIGS.includes(previous.rig),`unknown rig ${previous.rig}`);
  assert.ok(previous.score>=0&&previous.score<1.2,`score out of range: ${previous.score}`);
  assert.ok(Number.isFinite(previous.pose.x)&&Number.isFinite(previous.pose.y)&&Number.isFinite(previous.pose.z));
  assert.ok(Number.isFinite(previous.pose.yaw)&&Number.isFinite(previous.pose.pitch)&&Number.isFinite(previous.pose.fov));
  assert.ok(Number.isFinite(previous.minUntil));
  assert.ok(previous.transition.type==='cut'||previous.transition.type==='blend');
  assert.ok(previous.targets.every(id=>actors.some(a=>a.id===id)),'targets always exist in the state');
  assert.ok(SHOT_RIG_TO_RIG[previous.rig],'every planner rig maps onto a director rig');
 }
});

test('an incumbent keeps its exact encounter when a stronger fight shares its actor',()=>{
 const actors=[actor(1,0,0),actor(2,8,0),actor(4,-12,0)];
 const events=[damage(1,2,1,10)];
 const first=call(snap(1,actors,{events}));
 const rival=[...events,damage(1.1,4,1,100),damage(1.1,1,4,100)];
 const held=call(snap(1.1,actors,{events:rival}),{previous:first});
 assert.equal(held.incumbent,true);
 assert.deepEqual(held.targets,[1,2],'sharing a shooter does not silently replace the opponent');
 assert.deepEqual(held.anchor,first.anchor);
 // Flood the ranking with other encounters: shortlist eviction is not a cut.
 for(let i=10;i<24;i+=2){
  actors.push(actor(i,30,i),actor(i+1,32,i));
  rival.push(damage(1.2,i,i+1,100),damage(1.2,i+1,i,100));
 }
 const crowded=call(snap(1.2,actors,{events:rival}),{previous:held});
 assert.equal(crowded.incumbent,true);
 assert.deepEqual(crowded.targets,[1,2]);
});

test('a burst of highlights holds the original beat instead of chasing each explosion',()=>{
 const actors=[actor(1,0,0),actor(2,6,0),actor(3,35,0),actor(4,40,0)];
 const firstEvent={type:'death',id:1,time:0,actor:2,killer:1,pos:{x:6,y:0,z:0}};
 const events=[firstEvent];
 let previous=call(snap(0,actors,{events}),{options:{minShot:4,allowFirstPerson:false}});
 const first=previous;
 for(let frame=1;frame<=180;frame++){
  const time=frame/60;
  if(frame%15===0)events.push({type:'explosion',id:frame,time,pos:{x:frame%30===0?4:38,y:0,z:0}});
  previous=call(snap(time,actors,{events}),{previous,options:{minShot:4,allowFirstPerson:false}});
  assert.equal(previous.incumbent,true,`unexpected switch at ${time}`);
  assert.equal(previous.subjectKey,first.subjectKey);
  assert.deepEqual(previous.anchor,first.anchor);
 }
});

test('a shot exchange attracts the camera before damage and upgrades without changing encounter',()=>{
 const actors=[actor(1,12,0),actor(2,20,0),actor(3,-30,0,{team:1})];
 const previous=call(snap(0,actors));
 const shot={type:'shot',id:1,time:.1,actor:1,from:{x:12,y:1,z:0},to:{x:24,y:1,z:1}};
 const exchange=call(snap(.1,actors,{events:[shot]}),{previous,options:{allowFirstPerson:false}});
 assert.equal(exchange.subjectKind,'firefight');
 assert.deepEqual(exchange.targets,[1,2]);
 const lull=call(snap(2,actors,{events:[shot]}),{previous:exchange,options:{allowFirstPerson:false}});
 assert.equal(lull.incumbent,true,'a reload between shots does not bounce back to the wide fallback');
 const hit=call(snap(.2,actors,{events:[shot,damage(.2,2,1,20)]}),{previous:exchange});
 assert.equal(hit.incumbent,true);
 assert.equal(hit.subjectKey,exchange.subjectKey);
 const empty=call(snap(.1,actors,{events:[{...shot,to:{x:12,y:1,z:24}}]}));
 assert.equal(empty.subjectKind,'establish','shooting empty scenery is not an encounter');
});

test('objective composition keeps its side when the primary crosses the anchor',()=>{
 const objectives={zones:[{id:'hill',x:0,z:0,radius:6,contested:true}]};
 const actors=[actor(1,-.1,0),actor(2,1,1)];
 const first=call(snap(0,actors,{objectives}),{options:{maxRigsPerSubject:1}});
 assert.equal(first.rig,'objective');
 const crossed=call(snap(.1,[{...actors[0],x:.1},actors[1]],{objectives}),{previous:first});
 assert.equal(crossed.incumbent,true);
 assert.ok(Math.hypot(crossed.pose.x-first.pose.x,crossed.pose.z-first.pose.z)<.01,'no 180-degree flip across the objective');
});

test('the death of the watched opponent retains the killer and camera side',()=>{
 const actors=[actor(1,0,0),actor(2,8,0),actor(3,35,0),actor(4,40,0)];
 const events=[damage(0,2,1,30),damage(0,1,2,30)];
 const first=call(snap(0,actors,{events}),{options:{allowFirstPerson:false}});
 const death={type:'death',id:99,time:.2,actor:2,killer:1,pos:{x:8,y:0,z:0}};
 const after=call(snap(.2,[actors[0],{...actors[1],dead:1,health:0},...actors.slice(2)],
  {events:[...events,death,damage(.2,4,3,100),damage(.2,3,4,100)]}),{previous:first,options:{allowFirstPerson:false}});
 assert.equal(after.incumbent,true);
 assert.equal(after.primary,1);
 assert.deepEqual(after.targets,[1]);
 assert.equal(after.rig,first.rig);
 assert.ok(Math.hypot(after.pose.x-first.pose.x,after.pose.z-first.pose.z)<.1,'the victim disappearing does not swing the camera around');
});
