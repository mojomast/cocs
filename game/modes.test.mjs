import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,moveActor} from './core.mjs';
import {normalizeConfig,GAME_MODES} from './config.mjs';
import {pickupWeapon} from './maps.mjs';

const rng=()=>.5;
const map={id:'mode-test',name:'Mode Test',raised:false,blocks:[],spawns:[[-10,0],[10,0]],pickups:[],bounds:{minX:-20,maxX:20,minZ:-6,maxZ:6},teamSpawns:{0:[[-10,0]],1:[[10,0]]},flagSpawns:{0:[-10,0],1:[10,0]},trampolines:[{x:0,z:0,power:12,cooldown:1}],boostLaunchers:[{x:3,z:0,dir:[1,0],power:16,cooldown:2}]};

test('modes and mode-specific defaults preserve explicit limits',()=>{
 assert.ok(GAME_MODES.some(m=>m.id==='ctf')&&GAME_MODES.some(m=>m.id==='teamdeathmatch'));
  assert.equal(normalizeConfig({mode:'ctf'}).fragLimit,3);
  assert.equal(normalizeConfig({mode:'ctf',fragLimit:12}).fragLimit,12);
  assert.equal(normalizeConfig({mode:'teamdeathmatch'}).fragLimit,30);
});

test('new modes register distinct mechanics without disturbing existing mode IDs',()=>{
  const juggernaut=GAME_MODES.find(m=>m.id==='juggernaut');
  const elimination=GAME_MODES.find(m=>m.id==='team-elimination');
  assert.ok(juggernaut&&elimination,'both new modes are registered');
  assert.equal(juggernaut.name,'Juggernaut');
  assert.equal(juggernaut.rules.team,false);
  assert.equal(juggernaut.rules.score,'juggernaut');
  assert.equal(juggernaut.rules.juggernaut,true);
  assert.equal(juggernaut.rules.objective.kind,'juggernaut');
  assert.equal(elimination.name,'Team Elimination');
  assert.equal(elimination.rules.team,true);
  assert.equal(elimination.rules.score,'elimination');
  assert.equal(elimination.rules.elimination,true);
  assert.equal(elimination.rules.objective.kind,'elimination');
  assert.equal(new Set(GAME_MODES.map(m=>m.id)).size,GAME_MODES.length,'mode ids stay unique');
  assert.equal(new Set(GAME_MODES.map(m=>m.name)).size,GAME_MODES.length,'mode names stay unique');
  assert.equal(normalizeConfig({mode:'juggernaut'}).fragLimit,30);
  assert.equal(normalizeConfig({mode:'juggernaut',fragLimit:9999}).fragLimit,99);
  assert.equal(normalizeConfig({mode:'team-elimination'}).fragLimit,10);
  assert.equal(normalizeConfig({mode:'team-elimination',fragLimit:0}).fragLimit,1);
  assert.equal(GAME_MODES.find(m=>m.id==='ctf').name,'Capture the Flag');
  assert.equal(GAME_MODES.find(m=>m.id==='ctf').rules.score,'captures');
  assert.equal(GAME_MODES.find(m=>m.id==='armsrace').name,'Arms Race');
  assert.equal(GAME_MODES.find(m=>m.id==='deathmatch').rules.score,'frags');
});

test('instagib, rockets and arsenal pin explicit FFA sudden-death defaults',()=>{
  for(const id of ['instagib','rockets','arsenal']){
    const mode=GAME_MODES.find(entry=>entry.id===id);
    assert.ok(mode?.rules,`${id} declares rules instead of borrowing Deathmatch`);
    assert.equal(mode.rules.team,false);
    assert.equal(mode.rules.score,'frags');
    assert.equal(mode.rules.fragLimit,15);
    assert.ok(mode.rules.suddenDeathSeconds>0&&mode.rules.suddenDeathSeconds<=60,`${id} sudden death`);
    assert.equal(normalizeConfig({mode:id}).fragLimit,15);
  }
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

test('bots pick only weapons the mode loadout allows',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'deathmatch',botCount:1,humanCount:1,loadout:{weapons:[2,8],start:2,infinite:true},timeLimit:60});
 const bot=m.actors.find(a=>a.bot),human=m.actors.find(a=>!a.bot);
 Object.assign(bot,{x:-11,z:10,health:bot.maxHealth,vx:0,vz:0});
 Object.assign(human,{x:-11,z:6,health:100});
 Object.assign(bot.bot,{target:human.id,memory:1.5,think:0,route:[],destination:null,state:'engage'});
 for(const distance of [4,12,30]){
  Object.assign(human,{x:bot.x,z:bot.z-distance});
  bot.bot.think=0;
  m.botInput(bot,1/60);
  assert.ok([2,8].includes(bot.weapon),`sniper-only bot picked ${bot.weapon} at ${distance}m`);
 }
});

test('a sniper-only loadout strips disallowed weapon pickups from the map',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'deathmatch',botCount:0,loadout:{weapons:[2,8],start:2,infinite:true},timeLimit:60});
 const weaponKinds=m.pickups.filter(p=>pickupWeapon(p.kind)!==undefined).map(p=>pickupWeapon(p.kind));
 assert.ok(weaponKinds.every(index=>[2,8].includes(index)),`unexpected weapon pickups ${weaponKinds}`);
 assert.ok(m.pickups.some(p=>p.kind==='health'),'health supplies remain');
});

test('a no-ADS loadout suppresses aim-down-sights for bots and humans',()=>{
 const m=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'deathmatch',botCount:1,humanCount:1,loadout:{weapons:[2,8],start:2,infinite:true,noAds:true},timeLimit:60});
 const bot=m.actors.find(a=>a.bot),human=m.actors.find(a=>!a.bot);
 Object.assign(bot,{x:-11,z:10,health:bot.maxHealth,vx:0,vz:0});
 Object.assign(human,{x:-11,z:6,health:100});
 Object.assign(bot.bot,{target:human.id,memory:1.5,think:0,route:[],destination:null,state:'engage'});
 const input=m.botInput(bot,1/60)||{};
 assert.notEqual(input.ads,true,'a no-ADS loadout never aims down sights');
});

test('bots raise their retreat threshold when a one-shot mutator is active',()=>{
 const base=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'deathmatch',botCount:1,humanCount:1,timeLimit:60});
 const lethal=new Match('chatgpt','openclaw',rng,'crosswire',{mode:'deathmatch',botCount:1,humanCount:1,oneShot:true,timeLimit:60});
 const setup=m=>{const bot=m.actors.find(a=>a.bot),human=m.actors.find(a=>!a.bot);m.pickups=[];Object.assign(bot,{health:bot.maxHealth*.78,x:-11,z:10,vx:0,vz:0});Object.assign(human,{health:100,x:-8,z:10});Object.assign(bot.bot,{target:human.id,memory:1.5,think:0,route:[],destination:null,state:'engage'});return {bot,human};};
 const a=setup(base),b=setup(lethal);
 base.botInput(a.bot,1/60);lethal.botInput(b.bot,1/60);
 assert.ok(b.bot.bot.standoff>a.bot.bot.standoff,'lethal mutators push bots to keep their distance');
});

test('bounds and traversal launch are deterministic, swept and cooldown gated',()=>{
 const m=new Match('chatgpt','openclaw',rng,'exchange',{botCount:0});const a=m.actors[0];Object.assign(a,{x:0,z:0,y:0,grounded:true,vx:0,vy:0,vz:0});
 moveActor(a,{},1/60,map,m.config);assert.ok(a.vy>0);const first=a.vy;assert.equal(a.traversalPad,'t0');
 moveActor(a,{},1/60,map,m.config);assert.ok(a.vy<first);
 Object.assign(a,{x:3,z:0,y:0,grounded:true,vx:0,vy:0,vz:0,traversalPad:null,traversalCooldown:0});moveActor(a,{},1/60,map,m.config);assert.ok(a.vx>0&&a.vy>0);assert.ok(a.x<=20);assert.ok(!Number.isNaN(a.x));
 Object.assign(a,{x:19.9,z:0,y:0,grounded:true,vx:100,vy:0,vz:0});moveActor(a,{},1,map,m.config);assert.ok(a.x<=20);assert.ok(a.y>=0);
});
