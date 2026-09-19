import test from 'node:test';
import assert from 'node:assert/strict';
import {CinematicDirector,CAMERA_RIGS,DIRECTOR_MOTION} from './director.mjs';
import {SHOT_RIG_TO_RIG} from './shot-planner.mjs';
import {obstructed} from './core.mjs';

function seeded(seed=1){
 let state=seed>>>0;
 return ()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
}

const actor=(id,x,z,extra={})=>({id,name:`A${id}`,character:'chatgpt',team:id%2,x,y:0,z,yaw:0,pitch:0,vx:0,vz:0,health:100,dead:0,vehicleId:null,frags:0,...extra});

const state=(time,actors,extra={})=>({time,mapId:'blood-gulch',actors,vehicles:[],objectives:null,events:[],rockets:[],...extra});

// Tests that assert framing/selection use an explicit open arena so the real
// map geometry (occluders, raised floors) cannot mask the planner behaviour.
const openArena={id:'test-flat',raised:false,terrain:null,structures:[],bounds:{minX:-60,maxX:60,minZ:-60,maxZ:60},blocks:[]};

const finite=pose=>{
 for(const key of ['x','y','z','yaw','pitch','roll','fov'])assert.ok(Number.isFinite(pose[key]),`${key} not finite: ${pose[key]}`);
 return pose;
};

test('every rig returns a finite pose and cycleRig traverses all rigs',()=>{
 const actors=[actor(1,0,0),actor(2,5,3)];
 for(const rig of CAMERA_RIGS){
  const d=new CinematicDirector({random:seeded(7+rig.length)});
  d.reframe(state(0,actors));
  d.update(state(0,actors),1/60,[]);
  assert.equal(d.setRig(rig),true);
  assert.equal(d.setTarget(1),true);
  const pose=finite(d.update(state(.1,actors),1/60,[]));
  assert.equal(pose.rig,rig);
  assert.equal(pose.cut,false);
 }
 const d=new CinematicDirector({random:seeded(3)});
 d.reframe(state(0,actors));
 const seen=new Set();
 for(let i=0;i<CAMERA_RIGS.length;i++)seen.add(d.cycleRig(1));
 assert.deepEqual([...seen].sort(),[...CAMERA_RIGS].sort());
 assert.equal(CAMERA_RIGS.includes(d.cycleRig(1)),true);
});

test('empty and malformed state never produce NaN',()=>{
 const d=new CinematicDirector({random:seeded(11)});
 const samples=[undefined,null,{},{time:0,actors:[]},{time:1,actors:[{id:1}]},{time:'x',actors:'nope'}];
 for(const sample of samples){
  finite(d.update(sample,1/60,[]));
  finite(d.update(sample,0,[]));
  finite(d.update(sample,1e9,[]));
 }
});

test('a death highlight cuts within a frame and targets the referenced actor',()=>{
 const rng=seeded(5);
 const d=new CinematicDirector({random:rng});
 const actors=[actor(1,0,0),actor(2,6,0),actor(3,-5,2)];
 d.reframe(state(0,actors));
 d.update(state(0,actors),1/60,[]);
 d.update(state(.05,actors),1/60,[]);
 const dead=state(.1,[actors[0],{...actors[1],dead:1,health:0},actors[2]]);
 const event={type:'death',id:50,time:.1,actor:2,pos:{x:6,y:1,z:0},killer:1};
 const pose=finite(d.update(dead,1/60,[event]));
 assert.equal(pose.cut,true);
 assert.ok(pose.target===1||pose.target===2,`unexpected target ${pose.target}`);
 assert.equal(d.targetId,pose.target);
 const repeat=finite(d.update(dead,1/60,[event]));
 assert.equal(repeat.cut,false);
});

test('setTarget and cycleTarget only ever select alive actors',()=>{
 const d=new CinematicDirector({random:seeded(9)});
 const actors=[actor(1,0,0),{...actor(2,4,0),dead:1,health:0},actor(3,-4,0)];
 const snapshot=state(0,actors);
 d.reframe(snapshot);
 d.update(snapshot,1/60,[]);
 assert.equal(d.setTarget(1),true);
 assert.equal(d.targetId,1);
 assert.equal(d.setTarget(2),false);
 assert.equal(d.targetId,1);
 assert.equal(d.setTarget(999),false);
 assert.equal(d.targetId,1);
 const seen=new Set();
 for(let i=0;i<4;i++)seen.add(d.cycleTarget(snapshot,1));
 assert.deepEqual([...seen].sort(),[1,3]);
 assert.ok(!seen.has(2));
 assert.equal(d.setTarget(null),true);
 assert.equal(d.targetId,null);
});

test('camera damps on non-cut frames and snaps on cut frames',()=>{
 const d=new CinematicDirector({random:seeded(21)});
 const list=[actor(1,6,6,{yaw:0})];
 d.reframe(state(0,list));
 d.update(state(0,list),1/60,[]);
 d.setTarget(1);
 d.setRig('orbit');
 const p0=finite(d.update(state(.05,list),1/60,[]));
 d.setRig('tripod');
 const p1=finite(d.update(state(.1,list),1/60,[]));
 assert.equal(p1.cut,false);
 d.cut();
 const p2=finite(d.update(state(.15,list),1/60,[]));
 assert.equal(p2.cut,true);
 const damped=Math.hypot(p1.x-p0.x,p1.y-p0.y,p1.z-p0.z);
 const snapped=Math.hypot(p2.x-p1.x,p2.y-p1.y,p2.z-p1.z);
 assert.ok(damped>0,`expected damping movement`);
 assert.ok(snapped>damped,`snap ${snapped} should exceed damp ${damped}`);
 const p3=finite(d.update(state(.2,list),1/60,[]));
 assert.equal(p3.cut,false);
 assert.ok(Math.hypot(p3.x-p2.x,p3.y-p2.y,p3.z-p2.z)<1e-6);
});

test('look offsets shift yaw, clamp pitch and reset',()=>{
 const d=new CinematicDirector({random:seeded(31)});
 const list=[actor(1,0,0,{yaw:.5,pitch:.1})];
 d.reframe(state(0,list));
 d.update(state(0,list),1/60,[]);
 d.setTarget(1);
 d.setRig('firstperson');
 d.resetLook();
 const base=finite(d.update(state(.02,list),1/60,[]));
 assert.ok(Math.abs(base.yaw-.5)<1e-9,`${base.yaw}`);
 assert.ok(Math.abs(base.pitch-.1)<1e-9,`${base.pitch}`);
 d.look(.4,0);
 const looked=finite(d.update(state(.04,list),1/60,[]));
 assert.ok(Math.abs(looked.yaw-.9)<1e-9,`${looked.yaw}`);
 d.look(0,10);
 const clamped=finite(d.update(state(.06,list),1/60,[]));
 assert.ok(clamped.pitch<=Math.PI/2);
 d.resetLook();
 const reset=finite(d.update(state(.08,list),1/60,[]));
 assert.ok(Math.abs(reset.yaw-.5)<1e-9,`${reset.yaw}`);
 assert.ok(Math.abs(reset.pitch-.1)<1e-9,`${reset.pitch}`);
});

test('reduced mode never emits a non-zero roll',()=>{
 const d=new CinematicDirector({random:seeded(41),reduced:true});
 const list=[actor(1,0,0,{vx:6,vz:3,yaw:.4})];
 d.reframe(state(0,list));
 for(let i=0;i<80;i++){
  const pose=finite(d.update(state(i*.05,list),1/60,[]));
  assert.equal(pose.roll,0);
 }
 d.setReduced(false);
 const lifted=finite(d.update(state(4.05,list),1/60,[]));
 assert.ok(Number.isFinite(lifted.roll));
});

test('pois derive from zones and poi index clamps',()=>{
 const d=new CinematicDirector({random:seeded(61)});
 const snapshot=state(0,[actor(1,0,0)],{objectives:{zones:[{id:'a',x:1,z:2},{id:'b',x:9,z:-3}]}});
 d.reframe(snapshot);
 assert.equal(d.setPoi(99),1);
 assert.equal(d.setPoi(-5),0);
 assert.equal(d.cyclePoi(1),1);
 assert.equal(d.cyclePoi(1),0);
});

test('explosions and confirmed melee hits prompt a cut; whiffs do not',()=>{
 const actors=[actor(1,0,0),actor(2,8,1)];
 const d=new CinematicDirector({random:seeded(21)});
 d.reframe(state(0,actors));d.update(state(0,actors),1/60,[]);d.update(state(.05,actors),1/60,[]);
 const explosion={type:'explosion',id:60,time:.1,pos:{x:8,y:1,z:1}};
 assert.equal(d.update(state(.1,actors),1/60,[explosion]).cut,true);
 const d2=new CinematicDirector({random:seeded(22)});
 d2.reframe(state(0,actors));d2.update(state(0,actors),1/60,[]);d2.update(state(.05,actors),1/60,[]);
 assert.equal(d2.update(state(.1,actors),1/60,[{type:'melee',id:70,time:.1,actor:1,hit:null}]).cut,false);
 assert.equal(d2.update(state(.2,actors),1/60,[{type:'melee',id:71,time:.2,actor:1,hit:2}]).cut,true);
});

// The old tour tests pinned a perpetual flyover orbit. That contract changed:
// `tour` is now an opt-in attract flag only and the shot planner drives every
// automatic frame, so these tests assert the new behaviour intentionally.
test('opt-in attract mode plans safe shots instead of a perpetual flyover',()=>{
 const d=new CinematicDirector({random:seeded(31),center:{x:0,z:0},radius:11,tour:true,tourRadius:30,arena:openArena});
 const actors=[actor(1,-10,0),actor(2,-8,2)];
 d.reframe(state(0,actors));
 assert.equal(d.tour,true,'the legacy opt-in flag is preserved');
 const first=finite(d.update(state(0,actors),1/60,[]));
 assert.equal(first.cut,true,'first frame places the camera');
 assert.ok(CAMERA_RIGS.includes(first.rig));
 assert.notEqual(first.rig,'flyover','attract mode is no longer a perpetual flyover');
 assert.ok(d.plan,'the planner owns automatic framing');
 for(let i=0;i<120;i++)finite(d.update(state(i/60,actors),1/60,[]));
 assert.ok(Number.isFinite(d.aim.x)&&Number.isFinite(d.aim.z),'aim stays a finite point');
 assert.ok(d.plan.score>=0,'the planner keeps a scored shot');
});

test('flyover stays context-only and never appears in action-directed cuts',()=>{
 const d=new CinematicDirector({random:seeded(42),cutEvery:.1,arena:openArena});
 const actors=[actor(1,0,0),actor(2,5,3),actor(3,-4,2)];
 d.reframe(state(0,actors));
 const seen=new Set();
 for(let i=0;i<300;i++){
  const t=i*.2;
  const events=[{type:'damage',time:t,actor:2,source:1,amount:8},{type:'damage',time:t,actor:1,source:2,amount:8}];
  seen.add(d.update(state(t,actors,{events}),1/60,events).rig);
 }
 assert.ok(!seen.has('flyover'),'a running firefight never drops to a flyover');
});

test('action cuts frame the firefight, not the idle teammate cluster',()=>{
 const d=new CinematicDirector({random:seeded(51),center:{x:0,z:0},radius:11,arena:openArena});
 const cluster=[actor(1,-20,-20),actor(2,-19,-19),actor(3,-21,-21),actor(4,-20,-18)];
 const duel=[actor(5,20,20),actor(6,22,21)];
 const actors=[...cluster,...duel];
 d.reframe(state(0,actors));
 for(let i=0;i<60;i++){
  const t=i/60;
  const events=[{type:'damage',time:t,actor:6,source:5,amount:12},{type:'damage',time:t,actor:5,source:6,amount:12}];
  d.update(state(t,actors,{events}),1/60,events);
 }
 assert.equal(d.plan.subjectKind,'firefight');
 assert.deepEqual(d.plan.targets,[5,6]);
 assert.ok(!d.plan.targets.some(id=>id<5),'idle teammates are not the subject');
 assert.ok(Math.hypot(d.plan.anchor.x-21,d.plan.anchor.z-20.5)<6,`anchor ${d.plan.anchor.x},${d.plan.anchor.z}`);
});

test('an indoor fight keeps the camera clear of walls and under the roof',()=>{
 const structures=[{type:'building',x:0,z:0,y:0,w:16,d:16,h:6,rot:0}];
 const arena={raised:false,bounds:{minX:-13,maxX:13,minZ:-13,maxZ:13},blocks:[
  {x:-8,z:0,w:1,d:17,h:6},{x:8,z:0,w:1,d:17,h:6},{x:0,z:-8,w:17,d:1,h:6},{x:0,z:8,w:17,d:1,h:6},
 ]};
 const d=new CinematicDirector({random:seeded(61),center:{x:0,z:0},radius:11,structures,arena});
 const actors=[actor(1,2,1),actor(2,-2,-1),actor(3,1,-2)];
 d.reframe(state(0,actors));
 let sawFirefight=false;
 for(let i=0;i<120;i++){
  const t=i/60;
  const events=[{type:'damage',time:t,actor:2,source:1,amount:6},{type:'damage',time:t,actor:1,source:2,amount:6}];
  const pose=finite(d.update(state(t,actors,{events}),1/60,events));
  assert.ok(!obstructed(pose.x,pose.y,pose.z,.55,arena),`camera inside geometry at ${pose.x.toFixed(1)},${pose.y.toFixed(1)},${pose.z.toFixed(1)}`);
  assert.ok(pose.y<=6.4,`camera under the roof, y=${pose.y.toFixed(2)}`);
  if(d.plan.subjectKind==='firefight')sawFirefight=true;
 }
 assert.ok(sawFirefight,'the indoor fight is what the camera watches');
});

test('autoCut:false keeps the rig and target across automatic cuts',()=>{
 const d=new CinematicDirector({random:seeded(77),cutEvery:.5,autoCut:false});
 const actors=[actor(1,0,0),actor(2,5,3),actor(3,-4,2)];
 d.reframe(state(0,actors));
 assert.equal(d.autoCut,false);
 d.update(state(0,actors),1/60,[]);
 d.setRig('chase');
 d.setTarget(1);
 const first=finite(d.update(state(.1,actors),1/60,[]));
 const second=finite(d.update(state(1,actors),1/60,[]));
 assert.equal(second.cut,true);
 assert.equal(second.rig,'chase');
 assert.equal(second.target,1);
 assert.equal(first.rig,'chase');
 assert.equal(first.target,1);
 d.setAutoCut(true);
 assert.equal(d.autoCut,true);
});

test('autoCut:true lets automatic cuts change the rig',()=>{
 const d=new CinematicDirector({random:seeded(13),cutEvery:.1});
 const actors=[actor(1,0,0),actor(2,5,3),actor(3,-4,2)];
 d.reframe(state(0,actors));
 const seen=new Set();
 for(let i=0;i<200;i++)seen.add(d.update(state(i*.02,actors),1/60,[]).rig);
 assert.ok(seen.size>1,`expected multiple rigs, saw ${[...seen].join(',')}`);
});

test('the planner drives automatic rigs and exposes the chosen shot',()=>{
 const d=new CinematicDirector({random:seeded(7),arena:openArena});
 const actors=[actor(1,0,0),actor(2,7,1),actor(3,-3,4)];
 d.reframe(state(0,actors));
 let planned=0;
 for(let i=0;i<90;i++){
  const t=i/60;
  const events=[{type:'damage',time:t,actor:2,source:1,amount:8},{type:'damage',time:t,actor:1,source:2,amount:8}];
  const pose=finite(d.update(state(t,actors,{events}),1/60,events));
  if(i>10){
   assert.ok(d.plan,'a plan exists once the camera is running');
   assert.equal(d.plan.incumbent,true,'the firefight shot is held, not re-cut every frame');
   assert.equal(pose.rig,SHOT_RIG_TO_RIG[d.plan.rig]);
   assert.equal(pose.target,d.plan.primary);
   planned++;
  }
 }
 assert.ok(planned>0);
});

test('manual rig and target ownership is respected until reframe clears it',()=>{
 const d=new CinematicDirector({random:seeded(9),arena:openArena});
 const actors=[actor(1,0,0),actor(2,6,1),actor(3,-4,2)];
 d.reframe(state(0,actors));
 d.update(state(0,actors),1/60,[]);
 d.setRig('tripod');
 d.setTarget(1);
 for(let i=0;i<120;i++){
  const t=i/60;
  const events=[{type:'damage',time:t,actor:2,source:3,amount:20},{type:'damage',time:t,actor:3,source:2,amount:20}];
  const pose=finite(d.update(state(t,actors,{events}),1/60,events));
  assert.equal(pose.rig,'tripod','a manual rig never changes under the planner');
  assert.equal(pose.target,1,'a manual target stays pinned');
  assert.equal(d.plan,null,'manual ownership suspends the planner');
 }
 d.reframe(state(2,actors));
 d.update(state(2.1,actors),1/60,[]);
 assert.ok(d.plan!==null,'reframe hands control back to the planner');
 assert.ok(CAMERA_RIGS.includes(d.rig));
});

test('identical seeded runs are deterministic and honour motion bounds',()=>{
 const build=()=>new CinematicDirector({random:seeded(5),cutEvery:4,arena:openArena});
 const actors=[actor(1,0,0),actor(2,8,1),actor(3,-5,3),actor(4,-9,4)];
 const run=d=>{
  d.reframe(state(0,actors));
  const out=[];
  let prev=null;
  for(let i=0;i<180;i++){
   const t=i/60;
   const events=[{type:'damage',time:t,actor:2,source:1,amount:9},{type:'damage',time:t,actor:1,source:2,amount:9}];
   const pose=finite(d.update(state(t,actors,{events}),1/60,events));
   if(prev&&!pose.cut){
    const step=Math.hypot(pose.x-prev.x,pose.y-prev.y,pose.z-prev.z);
    assert.ok(step<=DIRECTOR_MOTION.maxSpeed/60+1e-6,`camera step ${step} exceeds the cap`);
    const turn=Math.abs(Math.atan2(Math.sin(pose.yaw-prev.yaw),Math.cos(pose.yaw-prev.yaw)));
    assert.ok(turn<=DIRECTOR_MOTION.maxTurn/60+1e-6,`camera turn ${turn} exceeds the cap`);
   }
   out.push(pose);
   prev=pose;
  }
  return out;
 };
 const first=run(build()),second=run(build());
 assert.equal(first.length,second.length);
 for(let i=0;i<first.length;i++)assert.deepEqual(first[i],second[i],`frame ${i} diverged`);
});

test('reduced motion keeps stable, longer-held shots with zero roll',()=>{
 const d=new CinematicDirector({random:seeded(11),reduced:true,arena:openArena});
 const actors=[actor(1,0,0),actor(2,9,0)];
 d.reframe(state(0,actors));
 d.update(state(0,actors),1/60,[]);
 const t=1;
 const events=[{type:'damage',time:t,actor:2,source:1,amount:10},{type:'damage',time:t,actor:1,source:2,amount:10}];
 const pose=finite(d.update(state(t,actors,{events}),1/60,events));
 assert.equal(pose.roll,0);
 assert.ok(d.plan.minUntil-t>=3.3,`reduced hold ${d.plan.minUntil-t} should be the longer one`);
 assert.notEqual(d.plan.rig,'flyover');
});

test('small subject motion eases through the speed-cap threshold without a camera lurch',()=>{
 const d=new CinematicDirector({arena:openArena,allowFirstPerson:false,minShot:4,cutEvery:8});
 const actors=[actor(1,0,0),actor(2,8,0)];
 const events=[{type:'damage',time:0,actor:2,source:1,amount:20},{type:'damage',time:0,actor:1,source:2,amount:20}];
 const first=d.update(state(0,actors,{events}),1/60,events);
 const moved=actors.map(a=>({...a,x:a.x+.3}));
 const next=d.update(state(1/60,moved,{events}),1/60,events);
 assert.equal(next.cut,false);
 const distance=Math.hypot(next.x-first.x,next.y-first.y,next.z-first.z);
 assert.ok(distance>0&&distance<.05,`small tracking correction should ease, got ${distance}`);
});

test('rewinding resets held encounters and event deduplication',()=>{
 const d=new CinematicDirector({arena:openArena,allowFirstPerson:false});
 const actors=[actor(1,0,0),actor(2,8,0)];
 const event={type:'death',id:10,time:10,actor:2,killer:1,pos:{x:8,y:0,z:0}};
 d.update(state(10,actors),1/60,[event]);
 const rewind=d.update(state(0,actors),1/60,[]);
 assert.equal(rewind.cut,true);
 assert.equal(d.plan.subjectKind,'establish','a future kill does not survive a rewind');
 d.update(state(10,actors),1/60,[event]);
 assert.equal(d.plan.subjectKind,'kill','the replayed event can be ingested again');
});
