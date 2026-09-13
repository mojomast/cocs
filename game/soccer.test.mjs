import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSoccer,stepSoccer,soccerSnapshot,soccerStandings,soccerBotControls,SOCCER_MODE_ID} from './soccer.mjs';
import {PUMA_PITCH} from './soccer-maps.mjs';

function fixture(count=8,{seed=7,bot=false,timeLimit=180,goalLimit=3}={}){
 let state=seed>>>0;
 const match={
  arena:PUMA_PITCH,
  actors:Array.from({length:count},(_,id)=>({id,team:id<count/2?0:1,bot:bot?{}:null,yaw:0,ammo:[]})),
  vehicles:[],
  config:{timeLimit,fragLimit:goalLimit},
  random(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;},
  time:0,over:false,teamScores:{0:0,1:0},events:[],
  vehicleById(id){return this.vehicles.find(v=>v.id===id)||null;},
  vehicleCollision(next){return {...next,y:Number.isFinite(next.y)?next.y:0};},
  syncVehicleActor(a,v){a.vehicleId=v.id;a.vehicleSeat='driver';a.x=v.position.x;a.y=v.position.y;a.z=v.position.z;a.vx=v.velocity.x;a.vz=v.velocity.z;},
  emit(type,data={}){this.events.push({type,...data});},
  endMatch(reason){if(!this.over){this.over=true;this.overReason=reason;}},
 };
 initializeSoccer(match);
 return match;
}

function start(m,goalLimit){
 stepSoccer(m,3);
 if(goalLimit!==undefined) m.race.goalLimit=goalLimit;
}

test('initializeSoccer seats four per team as puma drivers and resets scores',()=>{
 const m=fixture(8);
 assert.equal(SOCCER_MODE_ID,'puma-soccer');
 assert.equal(m.race.kind,'soccer');assert.equal(m.race.phase,'kickoff');
 assert.equal(m.race.racers.length,8);
 assert.equal(m.race.racers.filter(r=>r.team===0).length,4);
 assert.equal(m.race.racers.filter(r=>r.team===1).length,4);
 assert.deepEqual(m.teamScores,{0:0,1:0});
 for(const racer of m.race.racers){
  const actor=m.actors.find(a=>a.id===racer.actorId),vehicle=m.vehicleById(racer.vehicleId);
  assert.equal(actor.team,racer.team);
  assert.equal(vehicle.driver,racer.actorId);
  assert.equal(vehicle.kind,'puma');
  assert.equal(vehicle.position.y,0);
 }
});

test('a ball crossing a goal line scores for the other team and resets to centre',()=>{
 const m=fixture(8,{bot:false,goalLimit:5});
 start(m);
 const ball=m.race.ball,scorer=m.race.racers.find(r=>r.team===1);
 m.race.lastTouch=scorer.actorId;
 ball.x=-29.9;ball.z=0;ball.y=1.1;ball.vx=-12;ball.vz=0;
 stepSoccer(m,1/60);
 assert.equal(m.race.scores[0],0);
 assert.equal(m.race.scores[1],1);
 assert.equal(m.teamScores[1],1);
 assert.equal(ball.x,0);assert.equal(ball.z,0);assert.equal(ball.vx,0);assert.equal(ball.vz,0);
 assert.ok(m.events.some(e=>e.type==='soccer-goal'&&e.team===1));
 assert.equal(soccerStandings(m.race).find(r=>r.actorId===scorer.actorId).goals,1);
 assert.equal(m.race.serial,1);
});

test('reaching the goal limit ends the match with the scoring team as winner',()=>{
 const m=fixture(8,{bot:false,goalLimit:1});
 start(m);
 const ball=m.race.ball;
 m.race.lastTouch=m.race.racers.find(r=>r.team===0).actorId;
 ball.x=29.9;ball.z=0;ball.y=1.1;ball.vx=12;ball.vz=0;
 stepSoccer(m,1/60);
 assert.equal(m.race.scores[0],1);
 assert.equal(m.race.winnerTeam,0);
 assert.equal(m.race.phase,'over');
 assert.equal(m.over,true);
 assert.equal(m.overReason,'score');
});

test('time limit picks the higher score or a draw',()=>{
 const m=fixture(4,{bot:false,timeLimit:.5,goalLimit:9});
 stepSoccer(m,3);
 m.race.scores[0]=2;m.race.scores[1]=1;
 stepSoccer(m,1);
 assert.equal(m.race.winnerTeam,0);
 assert.equal(m.overReason,'time');
 assert.equal(m.race.phase,'over');
});

test('stepSoccer is deterministic for a fixed seed and inputs over N ticks',()=>{
 const run=()=>{
  const m=fixture(8,{seed:99,bot:true,goalLimit:99,timeLimit:999});
  for(let i=0;i<600;i++) stepSoccer(m,1/60,{inputs:{}});
  return soccerSnapshot(m.race);
 };
 assert.deepEqual(run(),run());
});

test('soccerSnapshot JSON round-trips and every field stays finite',()=>{
 const m=fixture(8,{seed:5,bot:true,goalLimit:99,timeLimit:999});
 for(let i=0;i<300;i++) stepSoccer(m,1/60,{inputs:{}});
 const snap=soccerSnapshot(m.race),clone=JSON.parse(JSON.stringify(snap));
 assert.deepEqual(clone,snap);
 assert.equal(snap.kind,'soccer');
 assert.ok(['kickoff','playing','over'].includes(snap.phase));
 for(const n of [snap.ball.x,snap.ball.y,snap.ball.z,snap.ball.vx,snap.ball.vz,snap.ball.r]) assert.ok(Number.isFinite(n));
 for(const n of [snap.countdown,snap.elapsed,snap.timeLimit,snap.goalLimit]) assert.ok(Number.isFinite(n));
 for(const s of snap.standings){assert.ok(Number.isFinite(s.goals));assert.ok(Number.isFinite(s.actorId));}
 assert.ok(snap.standings.every(s=>s.goals>=0));
 for(const racer of m.race.racers){
  const v=m.vehicleById(racer.vehicleId);
  assert.ok(Number.isFinite(v.position.x)&&Number.isFinite(v.position.z)&&Number.isFinite(v.position.y));
 }
});

test('bot controls aim the car at the ball and opponent goal',()=>{
 const m=fixture(2,{bot:true});
 start(m);
 const racer=m.race.racers.find(r=>r.team===0);
 const controls=soccerBotControls(m,racer);
 assert.ok(['throttle','steer'].every(k=>Number.isFinite(controls[k])));
 assert.ok(controls.throttle>0);
 assert.ok(controls.steer>=-1&&controls.steer<=1);
});
