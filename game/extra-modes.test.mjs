import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {normalizeConfig,modeRule,teamMode,DIFFICULTIES,GAME_MODES} from './config.mjs';
import {coverPoint} from './bots.mjs';
const rng=()=>.5;
const seeded=()=>{let n=41;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
test('objective metadata and target ranges are shared and legal',()=>{assert.equal(modeRule('koth').objective.captureSeconds,5);assert.equal(teamMode('domination'),true);assert.equal(teamMode('deathmatch'),false);assert.equal(normalizeConfig({mode:'koth'}).fragLimit,100);assert.equal(normalizeConfig({mode:'koth',fragLimit:9999}).fragLimit,900);assert.equal(normalizeConfig({mode:'domination',fragLimit:0}).fragLimit,1);});
test('KOTH scores by dt and publishes a deterministic winner snapshot',()=>{const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'koth',botCount:0,fragLimit:5});const a=m.actors[0],z=m.objectiveState.zones[0];Object.assign(a,{x:z.x,z:z.z,health:100});m.updateObjectives(.5);assert.equal(m.teamScores[0],0);for(let i=0;i<9;i++)m.updateObjectives(.5);assert.equal(m.teamScores[0],0);assert.equal(z.owner,0);for(let i=0;i<10;i++)m.updateObjectives(.5);assert.equal(m.teamScores[0],5);assert.equal(m.over,true);assert.equal(m.snapshot().winner,0);assert.equal(m.snapshot().objectives.winner,0);assert.deepEqual(m.snapshot(),m.snapshot());assert.ok(m.events.some(e=>e.type==='zone-score'));});
test('Domination freezes contested capture and neutralizes before recapture',()=>{const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'domination',botCount:1,fragLimit:5});const [a,b]=m.actors,z=m.objectiveState.zones[0];Object.assign(a,{x:z.x,z:z.z,health:100});Object.assign(b,{x:z.x,z:z.z,health:100});for(let i=0;i<10;i++)m.updateObjectives(.5);assert.equal(z.contested,true);assert.equal(z.progress,0);b.health=0;for(let i=0;i<10;i++)m.updateObjectives(.5);assert.equal(z.owner,0);Object.assign(a,{x:10,z:10});b.health=100;Object.assign(b,{x:z.x,z:z.z});for(let i=0;i<10;i++)m.updateObjectives(.5);assert.equal(z.owner,null);assert.ok(m.events.some(e=>e.type==='zone-neutralized'));assert.equal(m.snapshot().objectives.zones.length,3);});

test('objective stats split owned time and count contest transitions',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'domination',botCount:2,fragLimit:50}),[a,b,c]=m.actors,z=m.objectiveState.zones[0];
 [a,b].forEach(actor=>Object.assign(actor,{team:0,x:z.x,z:z.z,health:100}));c.health=0;
 for(let i=0;i<10;i++)m.updateObjectives(.5);assert.equal(z.owner,0);m.updateObjectives(.5);
 assert.equal(a.scoreStats.objectiveTime,.25);assert.equal(b.scoreStats.objectiveTime,.25);assert.equal(a.scoreStats.objectiveCaptures,1);assert.equal(b.scoreStats.objectiveCaptures,1);
 Object.assign(c,{team:1,x:z.x,z:z.z,health:100});m.updateObjectives(.5);assert.equal(z.contested,true);assert.equal(a.scoreStats.objectiveContests,1);assert.equal(c.scoreStats.objectiveContests,1);
 a.health=0;b.health=0;for(let i=0;i<10;i++)m.updateObjectives(.5);assert.equal(z.owner,null);assert.equal(c.scoreStats.objectiveNeutralizations,1);
});

test('objective progress and score events are bucketed',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'koth',botCount:0,fragLimit:50}),a=m.actors[0],z=m.objectiveState.zones[0];Object.assign(a,{x:z.x,z:z.z,health:100});
 for(let i=0;i<60;i++)m.updateObjectives(1/60);
 assert.ok(m.events.filter(e=>e.type==='zone-progress').length<60);assert.ok(m.events.filter(e=>e.type==='zone-score').length<10);
});

test('urgent bot supply diversion precedes objective routing',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'koth',botCount:1}),b=m.actors[1];b.health=1;b.bot.think=0;m.pickups.push({id:99,kind:'health',x:b.x+1,z:b.z,y:b.y,wait:0});
 m.botInput(b,1/60);assert.equal(b.bot.state,'seek');assert.equal(b.bot.destination.id,99);
});

test('team objective bots do not chase optional weapons with unlimited Pulse ammo',()=>{
 for(const mode of ['ctf','koth','domination','teamdeathmatch']){
  const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode,botCount:1}),b=m.actors[1];
  m.pickups=m.pickups.filter(p=>p.kind==='rocket');m.pickups.push({id:99,kind:'rocket',x:b.x+2,z:b.z,y:b.y,wait:0});b.bot.think=0;m.botInput(b,1/60);
  assert.notEqual(b.bot.state,'seek',mode);assert.notEqual(b.bot.destination?.kind,'rocket',mode);
  assert.ok(['flag-attack','flag-defend','objective','engage','roam','pursue'].includes(b.bot.state),`${mode}: ${b.bot.state}`);
 }
});

test('objective bot follows the selected nearby strategic pickup',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'koth',botCount:1}),b=m.actors[1];
 const optional={id:98,kind:'rocket',x:b.x+1,z:b.z,y:b.y,wait:0},strategic={id:99,kind:'armor',x:b.x+2,z:b.z,y:b.y,wait:0};
 m.pickups=[optional,strategic];b.bot.think=0;m.botInput(b,1/60);
 assert.equal(b.bot.state,'seek');assert.equal(b.bot.destination,strategic);
});

test('combined-arms establishes domination zones and routes bots to them',()=>{
 const m=new Match('chatgpt','openclaw',rng,'titan-valley',{mode:'combined-arms',botCount:1});
 assert.equal(m.objectiveState.kind,'domination');assert.equal(m.objectiveState.zones.length,3);
 const b=m.actors[1];m.pickups=[];b.bot.think=0;m.botInput(b,1/60);
 assert.equal(b.bot.state,'objective');
 assert.ok(Number.isFinite(b.bot.destination?.x)&&Number.isFinite(b.bot.destination?.z));
});

test('assault bots push or hold the active sector',()=>{
 const m=new Match('chatgpt','openclaw',rng,'rampart',{mode:'assault',botCount:1});
 const b=m.actors[1];m.pickups=[];b.bot.think=0;m.botInput(b,1/60);
 assert.ok(['objective','hold'].includes(b.bot.state),b.bot.state);
 const active=m.objectiveState.sectors[0];
 assert.ok(Math.hypot((b.bot.destination?.x??0)-active.x,(b.bot.destination?.z??0)-active.z)<12);
});
test('assault snapshots expose the active sector, teams and breach state',()=>{
 const m=new Match('chatgpt','openclaw',rng,'rampart',{mode:'assault',botCount:1,fragLimit:3});
 const o=m.snapshot().objectives;
 assert.equal(o.kind,'assault');
 assert.equal(o.zones.length,3);
 assert.equal(o.active,0);
 assert.ok([0,1].includes(o.attacker));
 assert.notEqual(o.attacker,o.defender);
 assert.equal(o.breached,false);
});
test('objective capture ignores actors far above the zone', () => {
  const m = new Match('chatgpt', 'openclaw', rng, 'crosswire', {mode:'domination', botCount:0});
  const zone = m.objectiveState.zones[0], a = m.actors[0];
  Object.assign(a, {team:0, x:zone.x, z:zone.z, y:(zone.y ?? 0) + 12, health:100});
  for (let i = 0; i < 400; i++) m.updateObjectives(1/60);
  assert.equal(zone.owner, null, 'a roof camper should not capture a ground zone');
  a.y = zone.y ?? 0;
  for (let i = 0; i < 400; i++) m.updateObjectives(1/60);
  assert.equal(zone.owner, 0);
});

test('assault defenders win the round if time expires without a breach', () => {
  const m = new Match('chatgpt', 'openclaw', rng, 'rampart', {mode:'assault', botCount:1, timeLimit:60, fragLimit:3});
  m.time = 59.999;
  m.step(1/60);
  assert.equal(m.over, true);
  assert.equal(m.snapshot().winner, m.objectiveState.defender);
});

test('combined-arms fields vehicles on a vehicle map while zone modes do not',()=>{
  const domination=new Match('chatgpt','openclaw',rng,'titan-valley',{mode:'domination',botCount:0});
  assert.equal(domination.vehicles.length,0,'domination must not clone the combined-arms vehicle field');
  const combined=new Match('chatgpt','openclaw',rng,'titan-valley',{mode:'combined-arms',botCount:0});
  assert.ok(combined.vehicles.length>0,'combined-arms keeps its armour');
  assert.equal(modeRule('combined-arms').vehicles,true);
  assert.equal(modeRule('domination').vehicles,false);
});

test('KOTH rotates the hill between authored points after the interval',()=>{
  const m=new Match('chatgpt','openclaw',rng,'titan-valley',{mode:'koth',botCount:0});
  const state=m.objectiveState,hill=state.zones[0];
  assert.ok(Array.isArray(state.rotation)&&state.rotation.length>1,'authored hill rotation points are loaded');
  const before={id:hill.id,x:hill.x,z:hill.z};
  state.rotationTimer=0;
  m.updateObjectives(1/60);
  assert.notEqual(hill.id,before.id,'the hill identity changes with the rotation');
  assert.ok(Math.hypot(hill.x-before.x,hill.z-before.z)>1e-6,'the hill position moves');
  assert.ok(Math.abs(state.rotationTimer-state.rotationEvery)<1e-9,'the rotation timer resets');
  assert.ok(m.events.some(e=>e.type==='hill-rotate'));
});

test('KOTH rotates hills on maps whose points come from the authored table or nav candidates',()=>{
  for(const id of ['exchange','frostline']){
    const m=new Match('chatgpt','openclaw',rng,id,{mode:'koth',botCount:0});
    const state=m.objectiveState,hill=state.zones[0];
    assert.ok(Array.isArray(state.rotation)&&state.rotation.length>1,`${id} builds a moving hill`);
    assert.deepEqual([...state.rotation.map(point=>point.id)].sort(),['alpha','bravo','charlie'],`${id} rotation carries authored point ids`);
    assert.ok(state.rotation.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.z)),`${id} rotation points are finite`);
    const roundTrip=JSON.parse(JSON.stringify(state.rotation));
    assert.deepEqual(roundTrip,state.rotation,`${id} rotation stays snapshottable`);
    const repeat=new Match('chatgpt','openclaw',rng,id,{mode:'koth',botCount:0});
    assert.deepEqual(repeat.objectiveState.rotation,state.rotation,`${id} rotation is deterministic`);
    const before={id:hill.id,x:hill.x,z:hill.z};
    state.rotationTimer=0;
    m.updateObjectives(1/60);
    assert.notEqual(hill.id,before.id,`${id} rotates off the opening hill`);
    assert.ok(Math.hypot(hill.x-before.x,hill.z-before.z)>1e-6,`${id} hill position moves`);
    assert.ok(m.events.some(event=>event.type==='hill-rotate'),`${id} announces the rotation`);
  }
});

test('domination and KOTH ownership grants the mapped powerup to occupants',()=>{
  const domination=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'domination',botCount:0});
  const [a]=domination.actors,alpha=domination.objectiveState.zones.find(z=>z.id==='alpha');
  Object.assign(a,{team:0,x:alpha.x,z:alpha.z,y:alpha.y??0,health:100});
  for(let i=0;i<12;i++)domination.updateObjectives(.5);
  assert.equal(alpha.owner,0);
  a.powerups={};
  domination.updateObjectives(.5);
  assert.ok(a.powerups.overshield>0,'alpha grants overshield');

  const koth=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'koth',botCount:0});
  const [k]=koth.actors,hill=koth.objectiveState.zones[0];
  Object.assign(k,{team:0,x:hill.x,z:hill.z,y:hill.y??0,health:100});
  for(let i=0;i<12;i++)koth.updateObjectives(.5);
  assert.equal(hill.owner,0);
  k.powerups={};
  koth.updateObjectives(.5);
  assert.ok(k.powerups.haste>0,'the hill grants its mapped powerup');
});

test('Juggernaut banks hold points and transfers the powered role on death',()=>{
  const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'juggernaut',botCount:0,humanCount:2,timeLimit:120,fragLimit:50});
  const [a,b]=m.actors;
  assert.equal(m.objectiveState.kind,'juggernaut');
  assert.equal(m.objectiveState.juggernautId,a.id);
  assert.equal(a.juggernaut,true);
  assert.equal(a.juggernautDamage,1.4);
  assert.ok(a.juggernautShield>0,'the juggernaut carries an extra health buffer');
  Object.assign(a,{health:1,protection:0,armor:0,juggernautShield:0});
  m.damage(a,999,b);
  assert.equal(m.objectiveState.juggernautId,b.id,'the killer inherits the role');
  assert.equal(b.juggernaut,true);
  assert.equal(a.juggernaut,false);
  assert.equal(a.juggernautDamage,1);
  assert.ok(b.juggernautShield>0,'the new juggernaut is re-buffed');
  assert.ok((m.objectiveState.points[b.id]||0)>=3,'killing the juggernaut pays the bounty');
  assert.ok(m.events.some(e=>e.type==='juggernaut-transfer'&&e.from===a.id&&e.to===b.id),'carrier transfer is announced');
  const before=m.objectiveState.points[b.id];
  m.updateObjectives(1);
  assert.ok(m.objectiveState.points[b.id]>=before+.7,'holding the role banks points');
  assert.equal(b.points,m.objectiveState.points[b.id],'carrier points reach the actor snapshot');
  assert.equal(b.scoreStats.points,m.objectiveState.points[b.id],'carrier points reach the scoreboard');
  m.objectiveState.points[b.id]=m.config.fragLimit-0.5;
  m.updateObjectives(1);
  assert.equal(m.over,true);
  assert.equal(m.snapshot().winner,b.id);
  assert.ok(m.events.some(e=>e.type==='juggernaut-win'&&e.actor===b.id));
});

test('Juggernaut reassigns the role when the carrier falls without a killer',()=>{
  const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'juggernaut',botCount:0,humanCount:3,timeLimit:120,fragLimit:50});
  const [a,b,c]=m.actors;
  assert.equal(m.objectiveState.juggernautId,a.id);
  m.fall(a);
  assert.notEqual(m.objectiveState.juggernautId,a.id);
  assert.ok([b.id,c.id].includes(m.objectiveState.juggernautId),'a living teammate picks up the role');
});

test('Team Elimination spends shared tickets and ends when a side is exhausted',()=>{
  const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'team-elimination',botCount:1,humanCount:2,fragLimit:2,timeLimit:600});
  const [a0,a1]=m.actors;
  assert.equal(m.objectiveState.kind,'elimination');
  assert.equal(m.objectiveState.livesPerTeam,2);
  assert.equal(teamMode('team-elimination'),true);
  const kill=victim=>{m.spawn(victim);Object.assign(victim,{health:1,protection:0,armor:0,juggernautShield:0});m.damage(victim,999,a0);m.updateObjectives(1/60);};
  kill(a1);
  assert.equal(m.objectiveState.lives[1],1,'each death burns one shared ticket');
  assert.equal(m.over,false);
  assert.ok(m.events.some(e=>e.type==='elimination-life'&&e.team===1&&e.lives===1),'ticket spend is announced');
  kill(a1);
  assert.equal(m.objectiveState.lives[1],0);
  assert.equal(m.over,true);
  assert.equal(m.snapshot().winner,0);
  assert.equal(m.snapshot().objectives.winner,0);
  assert.ok(m.events.some(e=>e.type==='elimination-win'&&e.team===0));
  assert.equal(m.respawnDelay(),3,'elimination delays respawns so tickets matter');
  assert.equal(new Match('chatgpt','openclaw',rng,'crosswire',{mode:'deathmatch',botCount:1}).respawnDelay(),2,'other modes keep the standard respawn');
});

test('Juggernaut enters a sudden-death window and has a deterministic time tiebreak',()=>{
  const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'juggernaut',botCount:0,humanCount:3,timeLimit:60,fragLimit:50});
  const [a,b,c]=m.actors;
  m.objectiveState.points={[a.id]:4,[b.id]:4};
  m.setJuggernaut(c.id);
  m.time=40;
  m.updateObjectives(1/60);
  assert.equal(m.objectiveState.suddenDeath,true,'a tied score opens sudden death in the final window');
  assert.ok(m.events.some(e=>e.type==='sudden-death'&&e.mode==='juggernaut'));
  m.objectiveState.points[b.id]=5;
  m.updateObjectives(1/60);
  assert.equal(m.over,true);
  assert.equal(m.snapshot().winner,b.id,'the first side to break the tie takes the crown');
  const t=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'juggernaut',botCount:0,humanCount:3,timeLimit:60,fragLimit:50});
  const [d,e,f]=t.actors;
  t.objectiveState.points={[d.id]:4,[e.id]:4};
  t.setJuggernaut(f.id);
  t.time=60;
  t.updateObjectives(1/60);
  assert.equal(t.over,true);
  assert.ok([d.id,e.id].includes(t.snapshot().winner),'a still-tied clock resolves to a deterministic winner');
  assert.ok(t.events.some(entry=>entry.type==='objective-tiebreak'));
});

test('Team Elimination starts a sudden-death window and resolves a dead-even clock',()=>{
  const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'team-elimination',botCount:0,humanCount:2,timeLimit:60,fragLimit:20});
  const [a,b]=m.actors;
  m.time=40;
  m.updateObjectives(1/60);
  assert.equal(m.objectiveState.suddenDeath,true,'a tied ticket pool opens sudden death');
  b.deaths=1;
  m.time=40.02;
  m.updateObjectives(1/60);
  assert.equal(m.over,true);
  assert.equal(m.snapshot().winner,a.team,'the first side to take a ticket lead wins sudden death');
  assert.equal(m.overReason,'sudden-death');
  const t=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'team-elimination',botCount:0,humanCount:2,timeLimit:60,fragLimit:20});
  t.time=60;
  t.updateObjectives(1/60);
  assert.equal(t.over,true);
  assert.ok([0,1].includes(t.snapshot().winner),'a dead-even clock still declares a winner');
  assert.ok(t.events.some(entry=>entry.type==='objective-tiebreak'));
});

test('Team Elimination attrition bleeds the trailing side once the round runs long',()=>{
  const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'team-elimination',botCount:0,humanCount:2,timeLimit:300,fragLimit:10});
  m.time=44.9;m.updateObjectives(1/60);
  const before=m.objectiveState.lives[0];
  m.actors[1].frags=2;
  m.time=45;m.objectiveState.attritionTimer=1/60;
  m.updateObjectives(1/60);
  assert.equal(m.objectiveState.lives[0],before-1,'the trailing side loses a ticket to attrition');
  assert.ok(m.events.some(entry=>entry.type==='elimination-life'&&entry.cause==='attrition'&&entry.team===0));
  assert.ok(m.snapshot().objectives.attrition[0]>=1,'attrition reaches the objective snapshot');
});

test('bots value the new objective modes instead of ignoring them',()=>{
  const jug=new Match('chatgpt','openclaw',rng,'throne',{mode:'juggernaut',botCount:2,humanCount:1});
  jug.pickups=[];const carrier=jug.actors[jug.objectiveState.juggernautId],hunter=jug.actors.find(a=>a.id!==carrier.id);
  hunter.bot.think=0;jug.botInput(hunter,1/60);
  assert.equal(hunter.bot.state,'objective','hunters push the crown carrier');
  assert.ok(Math.hypot((hunter.bot.destination?.x??0)-carrier.x,(hunter.bot.destination?.z??0)-carrier.z)<40,'hunters head for the carrier');
  jug.setJuggernaut(hunter.id);hunter.bot.think=0;jug.botInput(hunter,1/60);
  assert.equal(hunter.bot.state,'objective','the carrier defends the crown');
  assert.ok(Number.isFinite(hunter.bot.destination?.x),'the carrier gets a hold position');
  const elim=new Match('chatgpt','openclaw',rng,'gauntlet',{mode:'team-elimination',botCount:1,humanCount:1});
  elim.pickups=[];const bot=elim.actors[1];bot.bot.think=0;elim.botInput(bot,1/60);
  assert.equal(bot.bot.state,'objective','elimination teams push the centre');
  assert.ok((elim.objectiveState.zones||[]).some(zone=>Math.hypot((bot.bot.destination?.x??0)-zone.x,(bot.bot.destination?.z??0)-zone.z)<10),'the push targets an objective anchor');
});

test('VIP Escort registers a distinct extraction objective and terminates',()=>{
 const mode=GAME_MODES.find(m=>m.id==='vip-escort');
 assert.ok(mode,'vip-escort is registered');
 assert.equal(mode.name,'VIP Escort');
 assert.equal(mode.rules.team,true);
 assert.equal(mode.rules.score,'extraction');
 assert.equal(mode.rules.objective.kind,'extraction');
 assert.equal(normalizeConfig({mode:'vip-escort'}).fragLimit,1);
 assert.ok(!modeRule('vip-escort').objective.escortRadius||modeRule('vip-escort').objective.escortRadius>0);
 for(const difficulty of DIFFICULTIES){
  const m=new Match('kimi','roo',seeded(),'gauntlet',{mode:'vip-escort',difficulty:difficulty.id,botCount:6,timeLimit:60,fragLimit:1});
  for(let i=0;i<60*60+120&&!m.over;i++)m.step(1/60);
  assert.ok(m.over,`vip-escort/${difficulty.id} completes`);
  assert.ok(m.stats.shots>0,`vip-escort/${difficulty.id} fires`);
  const winner=m.snapshot().winner;
  assert.ok(winner!==null&&winner!==undefined,`vip-escort/${difficulty.id} declares a winner`);
  assert.ok(m.actors.every(a=>[a.x,a.y,a.z,a.health,a.frags].every(Number.isFinite)),`vip-escort/${difficulty.id} stays finite`);
 }
});

test('escorting the VIP to the beacon wins the round',()=>{
 const m=new Match('chatgpt','openclaw',rng,'gauntlet',{mode:'vip-escort',botCount:0,humanCount:2,timeLimit:120,fragLimit:1});
 const [a,b]=m.actors;
 m.updateObjectives(1/60);
 const vip=m.actors.find(actor=>actor.isVip);
 assert.ok(vip,'the VIP deploys');
 assert.equal(vip.team,0);
 assert.ok(m.events.some(e=>e.type==='vip-deploy'));
 const state=m.objectiveState;
 for(let i=0;i<Math.round(state.captureSeconds*60)+5&&!m.over;i++){
  vip.x=state.extract.x;vip.z=state.extract.z;vip.y=state.extract.y??0;vip.health=vip.maxHealth;
  a.x=state.extract.x+1;a.z=state.extract.z;a.health=100;
  b.x=0;b.z=0;b.health=100;
  m.updateObjectives(1/60);
 }
 assert.equal(m.over,true);
 assert.equal(m.snapshot().winner,0);
 assert.ok(a.scoreStats.objectiveTime>0,'escort time is credited to the escort');
 assert.ok(a.scoreStats.objectiveCaptures>=1,'the extraction credits an objective capture');
 assert.ok(m.events.some(e=>e.type==='vip-extracted'));
 assert.ok(m.events.some(e=>e.type==='objective-win'&&e.team===0));
});

test('losing the VIP hands the round to the hunters',()=>{
 const m=new Match('chatgpt','openclaw',rng,'gauntlet',{mode:'vip-escort',botCount:0,humanCount:2,timeLimit:120,fragLimit:1});
 m.updateObjectives(1/60);
 const vip=m.actors.find(actor=>actor.isVip);
 vip.health=0;
 m.updateObjectives(1/60);
 assert.equal(m.over,true);
 assert.equal(m.snapshot().winner,1);
 assert.ok(m.events.some(e=>e.type==='vip-down'));
});

test('both new modes complete with a winner at every difficulty',()=>{
  for(const mode of ['juggernaut','team-elimination'])for(const difficulty of DIFFICULTIES){
    const m=new Match('kimi','roo',seeded(),'crosswire',{mode,difficulty:difficulty.id,botCount:6,timeLimit:60,fragLimit:2});
    for(let i=0;i<60*60+120&&!m.over;i++)m.step(1/60);
    const snapshot=m.snapshot();
    assert.ok(m.over,`${mode}/${difficulty.id} completes`);
    assert.ok(snapshot.winner!==null&&snapshot.winner!==undefined,`${mode}/${difficulty.id} declares a winner`);
    assert.ok(m.stats.shots>0,`${mode}/${difficulty.id} fires`);
    assert.ok(m.actors.every(a=>[a.x,a.y,a.z,a.health,a.frags].every(Number.isFinite)),`${mode}/${difficulty.id} stays finite`);
  }
});

test('score modes publish a bounded sudden-death window that resolves a tie',()=>{
  for(const mode of ['deathmatch','ctf','koth','domination','teamdeathmatch','combined-arms','instagib','rockets','arsenal'])assert.ok(modeRule(mode).suddenDeathSeconds>0&&modeRule(mode).suddenDeathSeconds<=60,`${mode} sudden death`);
  // The loadout FFA modes had been inheriting the Deathmatch fallback; pin the
  // window on the mode entry itself so a data edit cannot silently drop it.
  for(const mode of ['instagib','rockets','arsenal']){
    const entry=GAME_MODES.find(value=>value.id===mode);
    assert.ok(entry.rules&&Number.isFinite(entry.rules.suddenDeathSeconds),`${mode} declares its own sudden-death window`);
    assert.equal(entry.rules.team,false);
    assert.equal(entry.rules.score,'frags');
    assert.equal(entry.rules.fragLimit,15);
    const tied=new Match('chatgpt','openclaw',seeded(),'crosswire',{mode,botCount:0,humanCount:2,timeLimit:60,fragLimit:50});
    const [first,second]=tied.actors;
    first.frags=3;second.frags=3;
    tied.time=tied.config.timeLimit-modeRule(mode).suddenDeathSeconds;
    tied.step(1/60);
    assert.equal(tied.suddenDeath,true,`${mode} opens sudden death on a level score`);
  }
  const m=new Match('chatgpt','openclaw',seeded(),'crosswire',{mode:'deathmatch',botCount:0,humanCount:2,timeLimit:60,fragLimit:50});
  const [a,b]=m.actors;
  a.frags=3;b.frags=3;
  m.time=m.config.timeLimit-modeRule('deathmatch').suddenDeathSeconds;
  m.step(1/60);
  assert.equal(m.suddenDeath,true,'a level score opens sudden death in the final window');
  assert.ok(m.events.some(entry=>entry.type==='sudden-death'&&entry.mode==='deathmatch'),'sudden death is announced');
  a.frags=4;
  m.step(1/60);
  assert.equal(m.over,true);
  assert.equal(m.overReason,'sudden-death','the first side to break the tie takes it');
  const t=new Match('chatgpt','openclaw',seeded(),'crosswire',{mode:'deathmatch',botCount:0,humanCount:2,timeLimit:60,fragLimit:50});
  const [c,d]=t.actors;
  c.frags=2;d.frags=2;
  t.time=t.config.timeLimit;
  t.step(1/60);
  assert.equal(t.over,true,'a still-level clock ends at the deadline');
  assert.ok(t.suddenDeath,'the tie still runs the sudden-death window');
});

test('low-health objective bots break line of sight instead of trading',()=>{
  const m=new Match('chatgpt','openclaw',seeded(),'crosswire',{mode:'koth',botCount:1,difficulty:'normal',timeLimit:120,fragLimit:50});
  m.pickups=[];
  const bot=m.actors.find(actor=>actor.bot),human=m.actors.find(actor=>!actor.bot),zone=m.objectiveState.zones[0];
  Object.assign(bot,{health:bot.maxHealth*.15,x:zone.x,z:zone.z,vx:0,vz:0});
  Object.assign(human,{health:human.maxHealth,x:zone.x+8,z:zone.z});
  Object.assign(bot.bot,{target:human.id,memory:1.5,think:0,route:[],destination:null,state:'objective'});
  m.botInput(bot,1/60);
  assert.equal(bot.bot.state,'cover','a hurt objective bot breaks contact');
  assert.ok(Number.isFinite(bot.bot.destination?.x)&&Number.isFinite(bot.bot.destination?.z),'cover destination is a real point');
  assert.ok(Math.hypot((bot.bot.destination?.x??zone.x)-human.x,(bot.bot.destination?.z??zone.z)-human.z)>0,'cover is not the threat position');
});

test('coverPoint prefers a node that breaks line of sight to the threat',()=>{
 const match={nav:[{x:0,y:0,z:0},{x:-6,y:0,z:0},{x:6,y:0,z:0}],arena:{blocks:[]},visible:(from,to)=>Math.abs(from.z-to.z)<2};
 const bot={x:0,y:0,z:0},threat={x:0,y:0,z:6};
 const cover=coverPoint(match,bot,threat);
 assert.ok(cover,'a hidden node is found');
 assert.equal(cover.x,-6,'the deterministic nearest hidden node wins the tie');
 assert.equal(coverPoint({nav:[],arena:{},visible:()=>false},bot,threat),null,'no nav means no cover');
 assert.equal(coverPoint(match,bot,{x:0,y:0,z:0}),null,'a threat already at the bot finds no separation');
});

test('Holdout wins when a team holds the quorum for the full window',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'holdout',botCount:0,humanCount:3,timeLimit:600,fragLimit:100});
 const state=m.objectiveState,[a,b,c]=m.actors;
 assert.equal(state.holdCount,2);
 // Two zones owned by team 0, the third neutral: team 0 is one short of quorum.
 state.zones[0].owner=0;state.zones[1].owner=0;state.zones[2].owner=1;
 state.holdProgress={0:state.holdSeconds-1/60,1:0};
 for(const actor of [a,b,c])actor.health=0;
 m.updateObjectives(1/60);
 assert.equal(m.over,true,'a completed hold window ends the round');
 assert.equal(m.snapshot().winner,0);
 assert.equal(m.snapshot().objectives.holdTeam,0);
 assert.ok(m.events.some(event=>event.type==='holdout-win'&&event.team===0));
 assert.ok(m.events.some(event=>event.type==='objective-win'&&event.team===0));
});

test('Holdout resets progress the moment the quorum breaks',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'holdout',botCount:0,humanCount:2,timeLimit:600,fragLimit:100});
 const state=m.objectiveState;
 state.zones.forEach(zone=>{zone.owner=0;});
 m.updateObjectives(1);
 assert.ok(state.holdProgress[0]>0,'a full quorum builds progress');
 state.zones[1].owner=1;state.zones[2].owner=1;
 m.updateObjectives(1/60);
 assert.equal(state.holdProgress[0],0,'losing the quorum resets the window');
 assert.equal(m.over,false);
});

test('Holdout resolves a winner on time expiry even without a completed window',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'holdout',botCount:0,humanCount:2,timeLimit:60,fragLimit:100});
 const state=m.objectiveState;
 state.zones[0].owner=0;state.zones[1].owner=0;state.zones[2].owner=1;
 state.holdProgress={0:8,1:2};
 m.time=60;
 m.updateObjectives(1/60);
 assert.equal(m.over,true);
 assert.equal(m.snapshot().winner,0,'the side with more hold progress takes the clock');
 assert.ok(m.events.some(event=>event.type==='objective-tiebreak'&&event.team===0));
});

test('Uplink banks a stage per capture and advances the relay to the next node',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'uplink',botCount:0,humanCount:2,timeLimit:600,fragLimit:100});
 const state=m.objectiveState,hill=state.zones[0],a=m.actors[0];
 assert.equal(state.stage,0);
 // Force the first stage to be owned by team 0; the pass banks it and moves on.
 hill.owner=0;hill.progress=100;
 m.updateObjectives(1/60);
 assert.equal(state.stage,1,'the capture banks a stage');
 assert.equal(state.stageCaptures[0],1);
 assert.equal(hill.id,'uplink-2','the relay advances to the next authored node');
 assert.equal(hill.owner,null,'the new node starts neutral');
 assert.ok(m.events.some(event=>event.type==='uplink-capture'&&event.team===0&&event.stage===1));
 assert.ok(m.events.some(event=>event.type==='uplink-stage'&&event.stage===2));
});

test('Uplink ends when a team captures every stage',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'uplink',botCount:0,humanCount:2,timeLimit:600,fragLimit:100});
 const state=m.objectiveState,hill=state.zones[0];
 for(let stage=0;stage<state.stageCount;stage++){
  hill.owner=0;hill.progress=100;
  m.updateObjectives(1/60);
 }
 assert.equal(m.over,true);
 assert.equal(m.snapshot().winner,0);
 assert.equal(state.stageCaptures[0],state.stageCount);
 assert.ok(m.events.some(event=>event.type==='uplink-win'&&event.team===0));
 assert.ok(m.events.some(event=>event.type==='objective-win'&&event.team===0));
});

test('Uplink resolves a winner on time expiry from banked stages',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'uplink',botCount:0,humanCount:2,timeLimit:60,fragLimit:100});
 const state=m.objectiveState;
 state.stage=1;state.stageCaptures={0:1,1:0};
 m.time=60;
 m.updateObjectives(1/60);
 assert.equal(m.over,true);
 assert.equal(m.snapshot().winner,0,'the side with more banked stages takes the clock');
 assert.ok(m.events.some(event=>event.type==='objective-tiebreak'&&event.mode==='uplink'));
});

test('holdout and uplink complete with a winner at every difficulty',()=>{
 for(const mode of ['holdout','uplink'])for(const difficulty of DIFFICULTIES){
  const m=new Match('kimi','roo',seeded(),'crosswire',{mode,difficulty:difficulty.id,botCount:6,timeLimit:60,fragLimit:5});
  for(let i=0;i<60*60+120&&!m.over;i++)m.step(1/60);
  const snapshot=m.snapshot();
  assert.ok(m.over,`${mode}/${difficulty.id} completes`);
  assert.ok(snapshot.winner!==null&&snapshot.winner!==undefined,`${mode}/${difficulty.id} declares a winner`);
  assert.ok(m.stats.shots>0,`${mode}/${difficulty.id} fires`);
  assert.ok(m.actors.every(actor=>[actor.x,actor.y,actor.z,actor.health,actor.frags].every(Number.isFinite)),`${mode}/${difficulty.id} stays finite`);
 }
});

