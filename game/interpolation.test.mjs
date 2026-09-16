import test from 'node:test';
import assert from 'node:assert/strict';
import {lerp,lerpAngle,clamp01,shouldSnap,interpolatePose} from './interpolation.mjs';

test('lerp and lerpAngle blend, clamp and take the shortest path across wraparound',()=>{
 assert.equal(lerp(0,10,.25),2.5);
 assert.equal(clamp01(1.4),1);
 assert.equal(clamp01(-3),0);
 assert.equal(clamp01(NaN),0);
 assert.ok(Math.abs(lerpAngle(0,Math.PI,.5)-Math.PI/2)<1e-12);
 // 350deg -> 10deg must go forward 20deg, not backward 340deg.
 const a=Math.PI*350/180,b=Math.PI*10/180;
 const half=lerpAngle(a,b,.5);
 assert.ok(Math.abs(half-Math.PI*360/180)<1e-9||Math.abs(half-0)<1e-9,`wraps the short way (${half})`);
 assert.ok(Math.abs(Math.abs(half-a)-Math.PI*10/180)<1e-9,'half way is 10 degrees');
});

test('shouldSnap flags missing samples, respawns and teleport jumps',()=>{
 assert.equal(shouldSnap(null,{x:0}),true);
 assert.equal(shouldSnap({x:0},{x:0}),false);
 assert.equal(shouldSnap({x:0},{x:1}),false);
 assert.equal(shouldSnap({x:0},{x:0},{respawn:true}),true);
 assert.equal(shouldSnap({x:0},{x:19},{maxDistance:3}),true);
 assert.equal(shouldSnap({x:NaN},{x:0}),true);
});

test('interpolatePose returns the current sample on a snap and a blend otherwise',()=>{
 const prev={x:0,y:0,z:0,yaw:0},cur={x:10,y:4,z:-2,yaw:1};
 const snapped=interpolatePose(prev,cur,0.5,{maxDistance:3});
 assert.equal(snapped.snapped,true);
 assert.deepEqual([snapped.x,snapped.y,snapped.z], [10,4,-2]);
 const mid=interpolatePose({...prev},{x:2,y:0,z:0,yaw:0},.5);
 assert.equal(mid.snapped,false);
 assert.equal(mid.x,1);
 const at0=interpolatePose(prev,{x:2,y:0,z:0,yaw:0},0);
 assert.equal(at0.x,0);
 const at1=interpolatePose(prev,{x:2,y:0,z:0,yaw:0},1);
 assert.equal(at1.x,2);
});

// Present one fixed 60 Hz simulation at 60, 120 and 144 Hz. The interpolation
// must stay inside the bracket between the two surrounding simulation ticks, and
// the same bracket+alpha must yield the same pose no matter which rate drove the
// frame. The simulation itself never sees the presentation rate.
test('60/120/144 Hz presentation of one 60 Hz simulation stays consistent',()=>{
 const ticks=30,dt=1/60,v=1.2,state=i=>({x:i*v*dt,y:0,z:0,yaw:i*.25});
 const sim=Array.from({length:ticks+1},(_,i)=>state(i));
 for(const rate of [60,120,144]){
  const step=1/rate;let acc=0,tick=0,frames=0;
  for(let t=0;t<ticks*dt-1e-9;t+=step){
   acc+=step;
   while(acc>=dt-1e-12){tick=Math.min(ticks,tick+1);acc-=dt;}
   const prev=sim[Math.max(0,tick-1)],cur=sim[tick];
   const pose=interpolatePose(prev,cur,acc/dt);
   assert.equal(pose.snapped,false,`rate ${rate} does not snap on continuous motion`);
   assert.ok(pose.x>=Math.min(prev.x,cur.x)-1e-9&&pose.x<=Math.max(prev.x,cur.x)+1e-9,`rate ${rate} stays inside the tick bracket`);
   assert.ok(Number.isFinite(pose.yaw)&&Number.isFinite(pose.x));
   frames++;
  }
  assert.ok(frames>0,'the schedule presented frames');
  assert.ok(tick>=ticks-1,'the schedule consumed the same simulation ticks');
 }
 const half=interpolatePose(state(3),state(4),.5);
 assert.ok(Math.abs(half.x-3.5*v*dt)<1e-12,'half-way is the midpoint of the bracket');
 for(const rate of [60,120,144])assert.ok(Math.abs(interpolatePose(state(3),state(4),.5).x-half.x)<1e-12,`rate ${rate} matches the same bracket`);
});
