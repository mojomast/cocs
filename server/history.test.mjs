import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MatchHistory} from './history.mjs';
import {Room} from './room.mjs';
function rng(){let n=11;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);}
const tmpDir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'token-arena-history-'));
const actors=[{name:'Alice',character:'chatgpt',harness:'openclaw',frags:7,deaths:3},{name:'Bob',character:'claude',harness:'claudecode',frags:4,deaths:6},{name:'Bot-1',character:'gemini',harness:'cline',frags:2,deaths:5}];
const stats={captures:2,flagPickups:3,flagReturns:4,flagDrops:1,objectiveTime:12.5,objectiveCaptures:2,objectiveNeutralizations:1,objectiveContests:3};
test('record builds a complete history entry and leader',()=>{
 const h=new MatchHistory();
 const entry=h.record({roomId:'ABCD',mapId:'crosswire',config:{mode:'deathmatch',fragLimit:5,timeLimit:60},time:42.3,actors});
 assert.equal(h.all().length,1);
 assert.equal(typeof entry.id,'string');
 assert.equal(entry.roomId,'ABCD');
 assert.equal(entry.mapId,'crosswire');
 assert.equal(entry.mode,'deathmatch');
 assert.equal(entry.fragLimit,5);
 assert.equal(entry.timeLimit,60);
 assert.equal(entry.endedBy,'frag');
 assert.equal(entry.duration,42.3);
 assert.equal(entry.leader,'Alice');
 assert.deepEqual(entry.players,[{name:'Alice',character:'chatgpt',harness:'openclaw',frags:7,deaths:3},{name:'Bob',character:'claude',harness:'claudecode',frags:4,deaths:6},{name:'Bot-1',character:'gemini',harness:'cline',frags:2,deaths:5}]);
});
test('a match ending on the clock is recorded as time and leader ties join',()=>{
 const h=new MatchHistory();
 h.record({roomId:'LOCAL',mapId:'foundry',config:{mode:'deathmatch',fragLimit:5,timeLimit:60},time:60,actors:[{name:'A',character:'chatgpt',harness:'openclaw',frags:2,deaths:1},{name:'B',character:'claude',harness:'claudecode',frags:2,deaths:1}]});
 const [e]=h.all();
 assert.equal(e.endedBy,'time');
 assert.equal(e.leader,'A & B');
 });
test('objective history records the winning team, scores, and objective ending reason',()=>{
 const h=new MatchHistory();
 const entry=h.record({config:{mode:'koth',fragLimit:100,timeLimit:60},time:25,teamScores:{0:100,1:72.5},actors:[]});
 assert.equal(entry.winner,0);
 assert.deepEqual(entry.teamScores,{0:100,1:72.5});
 assert.equal(entry.endedBy,'objective');
});
test('objective scoreStats survive history round-trip without mutation',()=>{
 const h=new MatchHistory(), actor={...actors[0],scoreStats:{...stats}};
 h.record({config:{mode:'ctf',fragLimit:5,timeLimit:60},actors:[actor],teamScores:{0:5,1:2},winner:0});
 actor.scoreStats.captures=99;
 assert.deepEqual(h.all()[0].players[0].scoreStats,stats);
 assert.deepEqual(h.all()[0].teamScores,{0:5,1:2});
});
test('history leaders use the mode objective ranking and retain legacy entries',()=>{
 const h=new MatchHistory();
 const ctf=h.record({config:{mode:'ctf'},actors:[{name:'Frags',frags:9,scoreStats:{...stats,captures:0}},{name:'Carrier',frags:1,scoreStats:{...stats,captures:1}}]});
 assert.equal(ctf.leader,'Carrier');
 const koth=h.record({config:{mode:'koth'},actors:[{name:'Objective',frags:1,scoreStats:{...stats,objectiveTime:4}},{name:'Slayer',frags:8,scoreStats:{...stats,objectiveTime:3}}]});
 assert.equal(koth.leader,'Objective');
 const arms=h.record({config:{mode:'armsrace',fragLimit:10},actors:[{name:'FragLeader',frags:9,ladder:1},{name:'RungLeader',frags:1,ladder:5}]});
 assert.equal(arms.leader,'RungLeader','arms race ranks by ladder, not frags');
 const armsTie=h.record({config:{mode:'armsrace',fragLimit:10},actors:[{name:'Lower',frags:9,ladder:2},{name:'Higher',frags:4,ladder:2}]});
 assert.equal(armsTie.leader,'Lower','frags break a ladder tie');
 const legacy={id:'legacy',players:[{name:'Old',frags:2,deaths:1}]};
 h.matches.push(legacy);
 assert.deepEqual(h.all().at(-1),legacy);
});
test('team deathmatch derives team scores without changing deathmatch entries',()=>{
 const h=new MatchHistory();
 const entry=h.record({config:{mode:'teamdeathmatch',fragLimit:5,timeLimit:60},time:12,actors:[
  {name:'A',team:0,frags:5,deaths:1},{name:'B',team:1,frags:2,deaths:3}
 ]});
 assert.equal(entry.winner,0);
 assert.deepEqual(entry.teamScores,{0:5,1:2});
 assert.equal(entry.endedBy,'frag');
 });
test('partial team scores are normalized to finite values',()=>{
 const h=new MatchHistory();
 const entry=h.record({config:{mode:'ctf',fragLimit:5,timeLimit:60},teamScores:{0:5},actors:[]});
 assert.deepEqual(entry.teamScores,{0:5,1:0});
 assert.equal(entry.winner,0);
});
test('malformed persisted history entries are ignored',()=>{
 const dir=tmpDir(),file=path.join(dir,'history.json');
 fs.writeFileSync(file,JSON.stringify([{id:'bad'}, {id:'good',players:[]}])) ;
 const h=new MatchHistory(file);
 assert.deepEqual(h.all().map(entry=>entry.id),['good']);
});
test('file round-trip loads matches at boot and persists atomically',()=>{
 const dir=tmpDir();
 const file=path.join(dir,'history.json');
 const h=new MatchHistory(file);
 assert.equal(h.all().length,0,'missing file boots empty');
 h.record({roomId:'WXYZ',mapId:'exchange',config:{mode:'deathmatch',fragLimit:10,timeLimit:120},time:12,actors:[{name:'Nia',character:'gemini',harness:'cline',frags:3,deaths:2}]});
 assert.ok(fs.existsSync(file));
 const reloaded=new MatchHistory(file);
 assert.equal(reloaded.all().length,1);
 assert.equal(reloaded.all()[0].roomId,'WXYZ');
 assert.equal(reloaded.all()[0].players[0].name,'Nia');
 assert.ok(fs.readdirSync(dir).every(f=>!f.includes('.tmp')),'no stray temp files');
});
test('cap enforcement keeps only the newest matches',()=>{
 const dir=tmpDir();
 const h=new MatchHistory(path.join(dir,'h.json'),{max:3});
 for(let i=0;i<7;i++)h.record({roomId:'ROOM',mapId:'crosswire',config:{mode:'deathmatch',fragLimit:5,timeLimit:60},time:i,actors:[{name:`P${i}`,character:'chatgpt',harness:'openclaw',frags:i,deaths:0}]});
 const all=h.all();
 assert.equal(all.length,3);
 assert.equal(all[0].players[0].name,'P6','newest first');
 assert.equal(all[2].players[0].name,'P4');
 const reloaded=new MatchHistory(path.join(dir,'h.json'),{max:3});
 assert.equal(reloaded.all().length,3);
});
test('no file is written when history has no path',()=>{
 const dir=tmpDir();
 const h=new MatchHistory(null);
 h.record({roomId:'ROOM',mapId:'crosswire',config:{mode:'deathmatch',fragLimit:5,timeLimit:60},time:1,actors});
 assert.equal(h.all().length,1);
 assert.equal(fs.readdirSync(dir).length,0);
});
test('a completed Room match records into the shared history',()=>{
 const h=new MatchHistory();
 const room=new Room('TEST',rng(),{history:h});
 room.join(1,'A');room.join(2,'B');
 room.host(1,{botCount:0,fragLimit:1,timeLimit:60,respawn:1},'crosswire');
 room.start(1);
 room.drain();
 const [a,b]=room.match.actors;
 Object.assign(a,{x:-10,y:0,z:3.3,weapon:1,ammo:[Infinity,1,0,0,0],protection:0,shotWait:0,yaw:0,pitch:0});
 Object.assign(b,{x:-10,y:0,z:-3.3,protection:0,health:40});
 room.input(1,{yaw:0,fire:true});
 for(let i=0;i<3700&&!room.roundOver;i++)room.tick(1/60);
 assert.equal(room.roundOver,true);
 assert.equal(h.all().length,1);
 const [e]=h.all();
 assert.equal(e.roomId,'TEST');
 assert.equal(e.mapId,'crosswire');
 assert.equal(e.mode,'deathmatch');
 assert.equal(e.fragLimit,5,'config normalized to the 5 frag floor');
 assert.equal(e.endedBy,'time','single frag under the floor ends on the clock; frag endings are covered by record() above');
 assert.equal(e.duration,Math.round(room.match.time*10)/10,'duration is the match clock rounded to 0.1s');
 assert.ok(e.players.some(p=>p.name==='A'));
 assert.ok(e.players.some(p=>p.name==='B'));
});
test('team history retains winner and scores for every team mode',()=>{
 for(const mode of ['ctf','teamdeathmatch','koth','domination','assault','payload','combined-arms']){
  const h=new MatchHistory();
  const entry=h.record({config:{mode,fragLimit:3,timeLimit:60},time:20,actors,teamScores:{0:2,1:1},winner:0});
  assert.equal(entry.mode,mode);
  assert.deepEqual(entry.teamScores,{0:2,1:1},`${mode} scores`);
  assert.equal(entry.winner,0,`${mode} winner`);
 }
});
test('an explicit ending reason overrides the score-limit inference',()=>{
 const h=new MatchHistory();
 const timed=h.record({config:{mode:'teamdeathmatch',fragLimit:30,timeLimit:60},time:60,actors,teamScores:{0:1,1:0},winner:0,endingReason:'time'});
 assert.equal(timed.endedBy,'time');
 const frag=h.record({config:{mode:'teamdeathmatch',fragLimit:30,timeLimit:60},time:60,actors,teamScores:{0:30,1:0},winner:0,endingReason:'frag'});
 assert.equal(frag.endedBy,'frag');
});

test('race finish and timeout winners survive copying and file round-trip',()=>{
 const dir=tmpDir(),file=path.join(dir,'race.json');
 try {
  const h=new MatchHistory(file);
  for(const [winnerId,overReason] of [[7,'race-finish'],[0,'time']]){
   const result={config:{mode:'puma-race',fragLimit:3,timeLimit:120},mapId:'puma-circuit',time:120,over:true,overReason,winner:winnerId,
    teamScores:{0:0,1:0},actors:[{...actors[0],id:0,team:7,frags:0},{...actors[1],id:7,team:0,frags:0}],
    race:{winnerId,elapsed:117,laps:3,phase:'finished',gates:[{x:99}],hazards:[{x:42}],standings:[winnerId,winnerId===0?7:0].map((actorId,index)=>({
     actorId,vehicleId:`puma-${actorId}`,position:index+1,lap:index===0?3:2,completedLaps:index===0&&overReason==='race-finish'?3:1,nextGate:2,progress:20-index,
     finishTime:index===0&&overReason==='race-finish'?116.5:null,item:index===0?'shield':null,effects:{turbo:0,shield:2,slow:0},internal:'omit'
    }))}};
   const entry=h.record({roomId:'RACE',result});
   assert.equal(entry.winnerActorId,winnerId);
   assert.equal(entry.leader,winnerId===0?'Alice':'Bob');
   assert.equal(entry.endedBy,overReason);
   assert.equal(entry.mode,'puma-race');
   assert.equal(entry.duration,120);
   assert.equal(entry.mapId,'puma-circuit');
   assert.equal('winner' in entry,false,'race winner is not a team winner');
   assert.equal('teamScores' in entry,false);
   assert.deepEqual(Object.keys(entry.race).sort(),['elapsed','laps','phase','standings','winnerId']);
   assert.equal('internal' in entry.race.standings[0],false);
   for(const player of entry.players){
    assert.deepEqual(player.race,entry.race.standings.find(s=>s.actorId===player.actorId));
    assert.equal(player.race.position,player.actorId===winnerId?1:2);
   }
   const expected=structuredClone(entry);
   result.race.standings[0].effects.shield=99;
   result.race.standings[0].position=99;
   result.race.standings.push({actorId:99});
   const copy=h.all()[0];
   copy.race.standings[0].effects.shield=100;
   copy.race.standings.pop();
   copy.players[0].race.effects.shield=100;
   assert.deepEqual(h.all()[0],expected);
   const reloaded=new MatchHistory(file);
   assert.deepEqual(reloaded.all(),h.all());
   reloaded.all()[0].players[0].race.effects.shield=200;
   assert.deepEqual(reloaded.all()[0],expected);
  }
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('race history supports explicit race data and missing legacy race fields',()=>{
 const h=new MatchHistory();
 const entry=h.record({config:{mode:'puma-race'},actors:[{...actors[0],id:0}],race:{winnerId:0,standings:[{actorId:0,position:1,finishTime:10}]}});
 assert.equal(entry.winnerActorId,0);
 assert.equal(entry.leader,'Alice');
 assert.equal(entry.endedBy,'race-finish');
 const missing=h.record({config:{mode:'puma-race'},actors:[{...actors[0],id:0}]});
 assert.equal(missing.winnerActorId,null);
 assert.equal(missing.leader,'Arena');
 assert.equal('race' in missing,false);
 const legacy={id:'old-race',mode:'puma-race',players:[{name:'Old'}]};
 h.matches.push(legacy);
 assert.deepEqual(h.all().at(-1),legacy);
});
