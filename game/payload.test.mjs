import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {payloadTemplate,payloadPath,payloadPosition,payloadProgress,stepPayload,standing} from './payload.mjs';
import {getMap} from './maps.mjs';
import {GAME_MODES,normalizeConfig} from './config.mjs';
import {arenaSupportsMode,mapsForMode,resolveMapForMode} from './arenas.mjs';
const rng=()=>.5;

test('payload config exposes the mode with sane checkpoint limits',()=>{
 assert.ok(GAME_MODES.some(mode=>mode.id==='payload'));
 assert.equal(normalizeConfig({mode:'payload'}).fragLimit,3);
 assert.equal(normalizeConfig({mode:'payload',fragLimit:9}).fragLimit,6);
 assert.equal(normalizeConfig({mode:'payload',fragLimit:0}).fragLimit,1);
});

test('launcher-only island maps remain available for combat but not payload selection',()=>{
 for(const id of ['ironfall-megastructure','longreach-plateau']){
  assert.equal(arenaSupportsMode(id,'payload'),false,id);
  for(const mode of ['ctf','teamdeathmatch','deathmatch','koth','domination','combined-arms']){
   assert.equal(arenaSupportsMode(id,mode),true,`${id} retains ${mode}`);
   assert.equal(resolveMapForMode(id,mode),id);
  }
  for(const legacy of [false,true]){
   assert.ok(!mapsForMode('payload',{legacy}).some(map=>map.id===id));
   const replacement=resolveMapForMode(id,'payload',{legacy});
   assert.notEqual(replacement,id);
   assert.equal(arenaSupportsMode(replacement,'payload'),true);
  }
 }
});

test('payload template builds an anchored route with ordered checkpoints',()=>{
 const arena=getMap('sunscar-canyon'),state=payloadTemplate(arena,{segments:3});
 assert.equal(state.kind,'payload');
 assert.equal(state.path.length,4);
 assert.equal(state.checkpoints.length,3);
 assert.ok(state.total>0);
 assert.equal(state.distance,0);
 assert.deepEqual(state.zones,state.checkpoints);
 assert.equal(state.checkpoints[2].distance,state.total);
 const start=payloadPosition(state);
 assert.ok(Number.isFinite(start.x)&&Number.isFinite(start.z)&&Number.isFinite(start.y));
 assert.equal(payloadProgress(state),0);
});

test('payload pace targets a 90-240s unopposed route and is never instant',()=>{
 for(const id of ['blood-gulch','frostline','ashen-rift','trenchline','derelict-station']){
  const state=payloadTemplate(getMap(id),{segments:3});
  assert.ok(state.total>1e-6,`${id} route has length`);
  const time=state.total/state.speed;
  assert.ok(time>=90&&time<=240,`${id} pace ${time.toFixed(1)}s outside the 90-240s target`);
 }
});

test('attackers advance the cart and bank checkpoints',()=>{
 const arena=getMap('sunscar-canyon'),state=payloadTemplate(arena,{segments:3});
 const events=[],scores={0:0,1:0},attacker={id:0,team:state.attacker,health:100,scoreStats:{objectiveTime:0,objectiveCaptures:0},...state.position};
 // Slower default pace (fix 1) needs a longer window to reach the first checkpoint.
 for(let i=0;i<3000;i++){const pos=payloadPosition(state);Object.assign(attacker,{x:pos.x,y:pos.y,z:pos.z});stepPayload(state,[attacker],1/60,{emit:type=>events.push(type),teamScores:scores,scoreLimit:3});}
 assert.ok(state.distance>0);
 assert.ok(events.includes('payload-checkpoint'));
 assert.ok(state.checkpointsReached>=1);
 assert.equal(scores[0],state.checkpointsReached);
 assert.ok(payloadProgress(state)>0);
});

test('core accumulates cart time for attackers standing on the payload',()=>{
 const m=new Match('chatgpt','openclaw',()=>.5,'convoy-line',{mode:'payload',botCount:0,humanCount:2,timeLimit:60,fragLimit:3});
 const state=m.objectiveState,attacker=m.actors.find(a=>a.team===state.attacker);
 for(let i=0;i<120;i++){Object.assign(attacker,{x:state.position.x,y:state.position.y,z:state.position.z,health:100});m.updatePayload(1/60);}
 assert.ok(attacker.scoreStats.objectiveTime>1,`cart time accrued (${attacker.scoreStats.objectiveTime})`);
});

test('payload objective credit requires an actor at cart height',()=>{
 const arena=getMap('sunscar-canyon'),state=payloadTemplate(arena,{segments:3});
 state.position=payloadPosition(state);
 const atCart={id:0,team:state.attacker,health:100,x:state.position.x,y:state.position.y,z:state.position.z};
 const above={...atCart,y:state.position.y+50};
 const scores={0:0,1:0};
 stepPayload(state,[above],1/60,{teamScores:scores});
 assert.equal(state.distance,0,'an actor far above the cart does not push it');
 stepPayload(state,[atCart],1/60,{teamScores:scores});
 assert.ok(state.distance>0,'an actor at cart height pushes it');
 const objectiveTime=actor=>{let time=0;for(let i=0;i<120;i++)if(standing(state,actor))time+=1/60;return time;};
 assert.equal(objectiveTime(above),0,'an actor far above the cart earns no objective time');
 assert.ok(objectiveTime(atCart)>1,'an actor at cart height earns objective time');
});

test('defenders stall the cart and roll it back to the last checkpoint',()=>{
 const arena=getMap('sunscar-canyon'),state=payloadTemplate(arena,{segments:3});
 const attacker={id:0,team:0,health:100,...state.position};
 // Slower pace requires a longer push before the second checkpoint is banked.
 for(let i=0;i<3000;i++){const pos=payloadPosition(state);Object.assign(attacker,pos);stepPayload(state,[attacker],1/60,{teamScores:{0:0,1:0}});}
 assert.ok(state.checkpointsReached>=2);
 const floor=state.checkpoints[state.checkpointsReached-1].distance;
 assert.ok(state.distance>floor);
 const defender={id:1,team:1,health:100,...payloadPosition(state)};
 for(let i=0;i<1800;i++){const pos=payloadPosition(state);Object.assign(defender,pos);stepPayload(state,[defender],1/60,{teamScores:{0:0,1:0}});}
 assert.ok(Math.abs(state.distance-floor)<.5,'rolls back no further than the last checkpoint');
});

test('a contested cart freezes until one side holds it',()=>{
 const arena=getMap('sunscar-canyon'),state=payloadTemplate(arena,{segments:3});
 const attacker={id:0,team:0,health:100,...state.position},defender={id:1,team:1,health:100,...state.position};
 stepPayload(state,[attacker],1/60,{});
 const mark=state.distance;
 stepPayload(state,[attacker,defender],1/60,{});
 assert.equal(state.contested,true);
 assert.equal(state.distance,mark);
 assert.equal(state.pushing,null);
});

test('delivery reaches the total distance and declares the attacker winner',()=>{
 const arena=getMap('sunscar-canyon'),state=payloadTemplate(arena,{segments:3,radius:999});
 const attacker={id:0,team:0,health:100,...state.position};
 let delivered=false;
 for(let i=0;i<6000&&!delivered;i++){
  const pos=payloadPosition(state);Object.assign(attacker,{x:pos.x,y:pos.y,z:pos.z});
  delivered=stepPayload(state,[attacker],1/60,{teamScores:{0:0,1:0},scoreLimit:3}).delivered;
 }
 assert.equal(state.delivered,true);
 assert.equal(state.winner,0);
 assert.equal(state.distance,state.total);
});

test('payload matches run to completion on supported arenas and publish a payload snapshot',()=>{
  for(const id of ['launchpad','sunscar-canyon','convoy-line','warfront','riverbend']){
  const match=new Match('chatgpt','openclaw',rng,id,{mode:'payload',botCount:2,timeLimit:60,fragLimit:3});
  const participants=match.actors.length;
  for(let i=0;i<3721&&!match.over;i++)match.step(1/60);
  assert.ok(match.over,id);
  assert.ok(match.actors.every(actor=>[actor.x,actor.y,actor.z,actor.health].every(Number.isFinite)),id);
  assert.ok(match.actors.length===participants);
  const snapshot=match.snapshot();
  assert.equal(snapshot.objectives.kind,'payload');
  assert.ok(snapshot.objectives.payload);
  assert.ok(Number.isFinite(snapshot.objectives.payload.distance));
  assert.ok(snapshot.objectives.payload.checkpointCount>=1);
  assert.ok(snapshot.objectives.zones.length===snapshot.objectives.payload.checkpointCount);
  if(snapshot.winner!==null)assert.ok([0,1].includes(snapshot.winner),id);
 }
});

test('payload checkpoints never sit at zero distance or score while idle',()=>{
 for(const id of ['launchpad','colosseum','citadel','warfront','convoy-line','riverbend']){
  const map=getMap(id);
  if(!map||!map.teamSpawns)continue;
  for(const segments of [1,3,6]){
   const state=payloadTemplate(map,{segments});
   const distances=state.checkpoints.map(checkpoint=>checkpoint.distance);
   assert.ok(distances.every(distance=>distance>1e-6),`${id} seg${segments} positive distances`);
   assert.ok(distances.every((distance,index)=>index===0||distance>distances[index-1]),`${id} seg${segments} increasing distances`);
   const scores={0:0,1:0};
   stepPayload(state,[],1/60,{teamScores:scores,scoreLimit:99});
   assert.equal(state.checkpointsReached,0,`${id} seg${segments} idle must not reach a checkpoint`);
   assert.equal(scores[0]+scores[1],0,`${id} seg${segments} idle must not score`);
  }
 }
});

test('a payload timeout hands the round to the defenders',()=>{
 const match=new Match('chatgpt','openclaw',rng,'warfront',{mode:'payload',botCount:0,timeLimit:60,fragLimit:3});
 for(let i=0;i<3601&&!match.over;i++)match.step(1/60);
 assert.equal(match.over,true);
 assert.equal(match.snapshot().winner,1);
 assert.ok(match.events.some(event=>event.type==='payload-hold'));
});

// Neutral pins keep the contest rates comparable (no Tool Use multiplier).
const neutralLoadouts={0:{character:'chatgpt',harness:'openclaw'},1:{character:'chatgpt',harness:'openclaw'},2:{character:'chatgpt',harness:'openclaw'}};
const payloadFixture=(timeLimit=60)=>{
 const m=new Match('chatgpt','openclaw',rng,'sunscar-canyon',{mode:'payload',botCount:0,humanCount:3,timeLimit,fragLimit:3,loadouts:neutralLoadouts});
 const state=m.objectiveState;
 return {m,state,attacker:m.actors.find(actor=>actor.team===state.attacker),defender:m.actors.find(actor=>actor.team===state.defender)};
};
const toCart=state=>actor=>Object.assign(actor,{x:state.position.x,y:state.position.y,z:state.position.z,health:100,protection:0});

test('defenders bank the same cart objective time as attackers while contested',()=>{
 const {m,state,attacker,defender}=payloadFixture();
 const place=toCart(state);
 place(attacker);place(defender);
 m.updatePayload(1/60); // open the contest window
 assert.equal(state.contested,true);
 assert.equal(state.distance,0,'the contested cart never advances');
 attacker.scoreStats.objectiveTime=0;defender.scoreStats.objectiveTime=0;
 for(let i=0;i<120;i++){place(attacker);place(defender);m.updatePayload(1/60);}
 assert.equal(state.contested,true);
 assert.equal(state.distance,0,'the cart stays frozen for the whole window');
 assert.ok(defender.scoreStats.objectiveTime>1,`defender contest time accrued (${defender.scoreStats.objectiveTime})`);
 assert.ok(Math.abs(defender.scoreStats.objectiveTime-attacker.scoreStats.objectiveTime)<1e-9,`defenders earn the attacker rate (${defender.scoreStats.objectiveTime} vs ${attacker.scoreStats.objectiveTime})`);
});

test('a payload contest announces one bucketed beat per entry',()=>{
 const {m,state,attacker,defender}=payloadFixture(120);
 const place=toCart(state);
 place(attacker);place(defender);
 m.updatePayload(1/60);
 const beats=()=>m.events.filter(event=>event.type==='payload-contest');
 assert.equal(beats().length,1,'the contest start emits one beat');
 assert.equal(beats()[0].team,state.defender);
 assert.equal(beats()[0].attacker,state.attacker);
 for(let i=0;i<30;i++){place(attacker);place(defender);m.updatePayload(1/60);}
 assert.equal(beats().length,1,'a held contest never re-emits');
 // Walk the defender out of the ring: the freeze releases and the push resumes.
 Object.assign(defender,{x:state.position.x+60,z:state.position.z});
 for(let i=0;i<300;i++){place(attacker);m.updatePayload(1/60);}
 assert.equal(state.contested,false);
 assert.ok(state.distance>0,'the push resumes once the ring is clear');
 place(defender);
 m.updatePayload(1/60);
 assert.equal(beats().length,2,'a fresh contest entry re-announces');
});
