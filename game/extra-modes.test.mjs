import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {normalizeConfig,modeRule,teamMode} from './config.mjs';
const rng=()=>.5;
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

