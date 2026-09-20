import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {extractionBotOrders,objectiveAssignment,teamCentroid} from './bots.mjs';

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

test('VIP escort orders slot escorts near the package and converge hunters on it',()=>{
 const m=new Match('kimi','roo',seeded(),'gauntlet',{mode:'vip-escort',botCount:5,humanCount:1,timeLimit:120,fragLimit:1});
 m.pickups=[];
 m.updateObjectives(1/60);
 const state=m.objectiveState,vip=m.actors.find(actor=>actor.isVip);
 assert.ok(vip,'the VIP deploys');
 const escorts=m.actors.filter(actor=>actor.bot&&actor.team===state.escortTeam),hunter=m.actors.find(actor=>actor.bot&&actor.team!==state.escortTeam);
 assert.ok(escorts.length>=2&&hunter,'the fixture fields escorts and hunters');
 const orders=extractionBotOrders(m,escorts[0]);
 assert.equal(orders.state,'objective');assert.equal(orders.role,'escort');
 assert.ok(Math.hypot(orders.destination.x-vip.x,orders.destination.z-vip.z)<=state.escortRadius+1e-9,'the escort slot sits inside the bubble');
 const hunt=extractionBotOrders(m,hunter);
 assert.equal(hunt.state,'objective');assert.equal(hunt.role,'hunt');
 assert.equal(hunt.destination.x,vip.x);assert.equal(hunt.destination.z,vip.z,'hunters converge on the live package');
 assert.deepEqual(extractionBotOrders(m,escorts[0]),orders,'identical state resolves identical orders');
 assert.notDeepEqual(extractionBotOrders(m,escorts[1]),orders,'actor ids spread across different slots');
 // Once the package stands on the beacon, the escort ring moves to the beacon.
 vip.x=state.extract.x;vip.z=state.extract.z;vip.y=state.extract.y??0;
 const atBeacon=extractionBotOrders(m,escorts[0]);
 assert.ok(Math.hypot(atBeacon.destination.x-state.extract.x,atBeacon.destination.z-state.extract.z)<=state.escortRadius+1e-9,'the beacon ring replaces the VIP ring');
 // botInput wires the order into the existing objective branch (no duel when
 // the other side is down, which is the branch's documented guard).
 for(const actor of m.actors)if(actor!==escorts[0]&&actor.bot)actor.health=0;
 escorts[0].bot.think=0;
 m.botInput(escorts[0],1/60);
 assert.equal(escorts[0].bot.state,'objective');
 assert.equal(escorts[0].bot.objectiveRole,'escort');
 assert.ok(Number.isFinite(escorts[0].bot.destination?.x)&&Number.isFinite(escorts[0].bot.destination?.z));
});
