import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {objectiveAssignment,teamCentroid} from './bots.mjs';

const rng=()=>.5;
const seeded=(n=53)=>{let a=n;return()=>((a=(Math.imul(a,1664525)+1013904223)>>>0)/4294967296);};

test('objectiveAssignment splits a squad between defending and attacking',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'domination',botCount:5,humanCount:1,timeLimit:120,fragLimit:100});
 const zones=m.objectiveState.zones;
 zones[0].owner=0;zones[1].owner=1;zones[2].owner=null;
 const bots=m.actors.filter(actor=>actor.bot).sort((a,b)=>a.id-b.id);
 const assignments=bots.map(bot=>objectiveAssignment(m,bot,zones));
 assert.ok(assignments.every(Boolean),'every bot gets an assignment');
 const roles=new Set(assignments.map(assignment=>assignment.role));
 assert.ok(roles.has('defend'),'at least one bot defends the owned zone');
 assert.ok(roles.has('attack'),'at least one bot attacks an enemy zone');
 for(const assignment of assignments){
  assert.ok(assignment.zone,'the assignment carries a real zone');
  assert.ok(Number.isFinite(assignment.zone.x)&&Number.isFinite(assignment.zone.z));
 }
});

test('objectiveAssignment collapses on a contested zone before pushing elsewhere',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'domination',botCount:5,humanCount:1,timeLimit:120,fragLimit:100});
 const zones=m.objectiveState.zones;
 zones[0].owner=0;zones[1].owner=1;zones[1].contested=true;zones[2].owner=null;
 const bots=m.actors.filter(actor=>actor.bot).sort((a,b)=>a.id-b.id);
 const attackers=bots.map(bot=>objectiveAssignment(m,bot,zones)).filter(assignment=>assignment.role!=='defend');
 assert.ok(attackers.length>0,'there are attackers');
 assert.ok(attackers.every(assignment=>assignment.role==='regroup'),'attackers regroup on the contested zone');
 assert.ok(attackers.every(assignment=>assignment.zone===zones[1]),'the contested zone is the shared target');
});

test('objectiveAssignment is deterministic for identical state',()=>{
 const build=()=>{
  const m=new Match('chatgpt','openclaw',seeded(),'crosswire',{mode:'domination',botCount:5,humanCount:1,timeLimit:120,fragLimit:100});
  const zones=m.objectiveState.zones;
  zones[0].owner=0;zones[1].owner=1;zones[2].owner=null;
  return m.actors.filter(actor=>actor.bot).sort((a,b)=>a.id-b.id).map(bot=>objectiveAssignment(m,bot,zones));
 };
 const first=build(),second=build();
 assert.deepEqual(first.map(a=>[a.role,a.zoneId]),second.map(a=>[a.role,a.zoneId]));
});

test('teamCentroid averages living teammates and falls back to the map centre',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'domination',botCount:3,humanCount:1,timeLimit:120,fragLimit:100});
 const team0=m.actors.filter(actor=>actor.team===0);
 assert.ok(team0.length>=2,'the fixture fields multiple teammates');
 team0.forEach((actor,index)=>Object.assign(actor,{x:index*10,z:0,health:100}));
 const centroid=teamCentroid(m,team0[0]);
 assert.ok(Number.isFinite(centroid.x)&&Number.isFinite(centroid.z));
 const expected=team0.reduce((sum,_,index)=>sum+index*10,0)/team0.length;
 assert.equal(centroid.x,expected,'the centroid is the living-team average');
 team0.slice(1).forEach(actor=>{actor.health=0;});
 const solo=teamCentroid(m,team0[0]);
 assert.equal(solo.x,0,'dead teammates are excluded from the centroid');
});

test('zone-control bots expose an objective role and regroup when scattered',()=>{
 const m=new Match('chatgpt','openclaw',seeded(),'crosswire',{mode:'domination',botCount:5,humanCount:1,timeLimit:120,fragLimit:100});
 m.pickups=[];
 const zones=m.objectiveState.zones;
 zones[0].owner=0;zones[1].owner=1;zones[2].owner=null;
 const bots=m.actors.filter(actor=>actor.bot).sort((a,b)=>a.id-b.id);
 for(const bot of bots){bot.bot.think=0;m.botInput(bot,1/60);}
 assert.ok(bots.every(bot=>typeof bot.bot.objectiveRole==='string'),'each bot publishes an objective role');
 assert.ok(bots.some(bot=>bot.bot.objectiveRole==='defend'));
 assert.ok(bots.some(bot=>bot.bot.objectiveRole==='attack'));
 // Scatter one attacker far from the team; it should regroup toward the squad.
 const attacker=bots.find(bot=>bot.bot.objectiveRole==='attack');
 Object.assign(attacker,{x:60,z:60});
 attacker.bot.think=0;
 m.botInput(attacker,1/60);
 assert.equal(attacker.bot.state,'regroup','a scattered attacker regroups instead of lone-wolfing');
 assert.ok(Number.isFinite(attacker.bot.destination?.x)&&Number.isFinite(attacker.bot.destination?.z));
});

test('holdout and uplink bots route to their objective zones',()=>{
 for(const mode of ['holdout','uplink']){
  const m=new Match('chatgpt','openclaw',seeded(),'crosswire',{mode,botCount:5,humanCount:1,timeLimit:120,fragLimit:100});
  m.pickups=[];
  const bots=m.actors.filter(actor=>actor.bot);
  for(const bot of bots){bot.bot.think=0;m.botInput(bot,1/60);}
  assert.ok(bots.every(bot=>['objective','regroup','hold','roam'].includes(bot.bot.state)),`${mode}: ${bots.map(bot=>bot.bot.state).join(',')}`);
  assert.ok(bots.some(bot=>Number.isFinite(bot.bot.destination?.x)&&Number.isFinite(bot.bot.destination?.z)),`${mode} bots get a destination`);
 }
});
