import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,moveActor} from './core.mjs';
import {normalizeConfig,GAME_MODES} from './config.mjs';

const rng=()=>.5;
const map={id:'mode-test',name:'Mode Test',raised:false,blocks:[],spawns:[[-10,0],[10,0]],pickups:[],bounds:{minX:-20,maxX:20,minZ:-6,maxZ:6},teamSpawns:{0:[[-10,0]],1:[[10,0]]},flagSpawns:{0:[-10,0],1:[10,0]},trampolines:[{x:0,z:0,power:12,cooldown:1}],boostLaunchers:[{x:3,z:0,dir:[1,0],power:16,cooldown:2}]};

test('modes and mode-specific defaults preserve explicit limits',()=>{
 assert.ok(GAME_MODES.some(m=>m.id==='ctf')&&GAME_MODES.some(m=>m.id==='teamdeathmatch'));
  assert.equal(normalizeConfig({mode:'ctf'}).fragLimit,3);
 assert.equal(normalizeConfig({mode:'ctf',fragLimit:12}).fragLimit,12);
 assert.equal(normalizeConfig({mode:'teamdeathmatch'}).fragLimit,30);
});

test('CTF assigns teams, flag lifecycle and capture preconditions',()=>{
 const m=new Match('chatgpt','openclaw',rng,'exchange',{mode:'ctf',botCount:1,fragLimit:5});
 const [a,b]=m.actors;a.health=100;b.health=100;
 assert.equal(a.team,0);assert.equal(b.team,1);assert.deepEqual(m.snapshot().teamScores,{0:0,1:0});
 Object.assign(a,{x:m.flags[1].x,z:m.flags[1].z});m.objective(a);assert.equal(m.flags[1].state,'carried');
 Object.assign(a,{x:m.flags[0].x,z:m.flags[0].z});m.flags[0].state='dropped';m.objective(a);assert.equal(m.teamScores[0],0);
 m.flags[0].state='dropped';Object.assign(a,{x:m.flags[0].x,z:m.flags[0].z});m.objective(a);assert.equal(m.flags[0].state,'at-base');
 Object.assign(a,{x:m.flags[1].x,z:m.flags[1].z});m.objective(a);Object.assign(a,{x:m.flags[0].x,z:m.flags[0].z});m.objective(a);
 assert.equal(m.teamScores[0],1);assert.equal(m.over,false);assert.ok(m.events.some(e=>e.type==='capture'));
});

test('CTF drops a carried flag on death and emits lifecycle events',()=>{
 const m=new Match('chatgpt','openclaw',rng,'exchange',{mode:'ctf',botCount:1});const a=m.actors[0];
 Object.assign(a,{x:m.flags[1].x,z:m.flags[1].z});m.objective(a);assert.equal(m.flags[1].carrier,a.id);
 a.protection=0;m.damage(a,1000,m.actors[1]);assert.equal(m.flags[1].state,'dropped');assert.equal(m.flags[1].carrier,null);
 assert.ok(m.events.some(e=>e.type==='flag-pickup')&&m.events.some(e=>e.type==='flag-drop'));
});

test('CTF scoreStats records the complete flag lifecycle',()=>{
 const m=new Match('chatgpt','openclaw',rng,'exchange',{mode:'ctf',botCount:0,fragLimit:5}),a=m.actors[0];
 Object.assign(a,{x:m.flags[1].x,z:m.flags[1].z});m.objective(a);
 assert.equal(a.scoreStats.flagPickups,1);Object.assign(a,{x:m.flags[0].x,z:m.flags[0].z});m.flags[0].state='dropped';m.objective(a);
 assert.equal(a.scoreStats.flagReturns,1);Object.assign(a,{x:m.flagSpawns[1][0],z:m.flagSpawns[1][1]});m.objective(a);m.dropFlag(a);
 assert.equal(a.scoreStats.flagDrops,1);Object.assign(a,{x:m.flags[1].x,z:m.flags[1].z});m.objective(a);Object.assign(a,{x:m.flags[0].x,z:m.flags[0].z});m.objective(a);
 assert.equal(a.scoreStats.captures,1);assert.deepEqual(m.snapshot().actors[0].scoreStats,a.scoreStats);
});

test('team deathmatch wins by team score without changing deathmatch scoring',()=>{
 const t=new Match('chatgpt','openclaw',rng,'exchange',{mode:'teamdeathmatch',botCount:1,fragLimit:5});const [a,b]=t.actors;
 for(let i=0;i<5;i++){b.health=100;b.protection=0;t.damage(b,1000,a);}assert.equal(t.teamScores[a.team],5);assert.equal(t.over,true);
 const d=new Match('chatgpt','openclaw',rng,'exchange',{mode:'deathmatch',botCount:1,fragLimit:5});d.actors[1].protection=0;d.damage(d.actors[1],1000,d.actors[0]);assert.equal(d.actors[0].frags,1);assert.deepEqual(d.teamScores,{0:0,1:0});
});

test('CTF carriers move slower and cannot activate powers',()=>{
  const m=new Match('chatgpt','openclaw',rng,'exchange',{mode:'ctf',botCount:0});
  const a=m.actors[0];
  Object.assign(a,{x:m.flags[1].x,z:m.flags[1].z});
  m.objective(a);
  assert.equal(a.carryingFlag,true);
  assert.equal(a.carrySpeedMultiplier,.9);
  assert.equal(m.power(a),false,'a flag carrier cannot activate powers');
  m.dropFlag(a);
  assert.equal(a.carryingFlag,false);
  assert.equal(m.power(a),true,'dropping the flag restores the power');
  const carrier={...a,carryingFlag:true,carrySpeedMultiplier:.9,x:-5,z:0,y:0,grounded:true,vx:0,vy:0,vz:0};
  const runner={...a,carryingFlag:false,carrySpeedMultiplier:1,x:-5,z:0,y:0,grounded:true,vx:0,vy:0,vz:0};
  for(let i=0;i<60;i++){moveActor(carrier,{z:-1},1/60,map,m.config);moveActor(runner,{z:-1},1/60,map,m.config);}
  assert.ok(Math.hypot(carrier.vx,carrier.vz)<Math.hypot(runner.vx,runner.vz),'a carrier reaches a lower top speed');
});

test('bounds and traversal launch are deterministic, swept and cooldown gated',()=>{
 const m=new Match('chatgpt','openclaw',rng,'exchange',{botCount:0});const a=m.actors[0];Object.assign(a,{x:0,z:0,y:0,grounded:true,vx:0,vy:0,vz:0});
 moveActor(a,{},1/60,map,m.config);assert.ok(a.vy>0);const first=a.vy;assert.equal(a.traversalPad,'t0');
 moveActor(a,{},1/60,map,m.config);assert.ok(a.vy<first);
 Object.assign(a,{x:3,z:0,y:0,grounded:true,vx:0,vy:0,vz:0,traversalPad:null,traversalCooldown:0});moveActor(a,{},1/60,map,m.config);assert.ok(a.vx>0&&a.vy>0);assert.ok(a.x<=20);assert.ok(!Number.isNaN(a.x));
 Object.assign(a,{x:19.9,z:0,y:0,grounded:true,vx:100,vy:0,vz:0});moveActor(a,{},1,map,m.config);assert.ok(a.x<=20);assert.ok(a.y>=0);
});
