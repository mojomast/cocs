import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,moveActor,obstructed,floorAt} from './core.mjs';
import {MAPS} from './maps.mjs';
import {RULES} from './data.mjs';
import {DEFAULT_CONFIG,normalizeConfig} from './config.mjs';
import {slowSkip} from './test-support.mjs';
const rng=()=>{let n=42;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
const actor=(arena,values={})=>Object.assign(new Match('chatgpt','openclaw',rng(),arena.id,{botCount:0}).actors[0],{vx:0,vy:0,vz:0,active:0,grounded:false},values);
const clear=(a,arena)=>assert.equal(obstructed(a.x,a.y,a.z,RULES.radius,arena),false,`${arena.id}: ${JSON.stringify({x:a.x,y:a.y,z:a.z})}`);

test('manual reload is consumed by the simulation and refills the magazine',()=>{
 const m=new Match('chatgpt','openclaw',rng(),'exchange',{mode:'deathmatch',botCount:0}),a=m.actors[0];
 a.weapon=1;a.ammo[1]=1;a.shotWait=0;a.protection=0;
 m.step(1/60,{reload:true});
 assert.equal(a.reloading,true,'R should start a reload');
 for(let i=0;i<240;i++)m.step(1/60,{});
 assert.ok(a.ammo[1]>1,`reload should add ammo (${a.ammo[1]})`);
});

test('casual defaults preserve explicit saved difficulty and roster',()=>{ assert.equal(DEFAULT_CONFIG.botCount,2);assert.equal(DEFAULT_CONFIG.difficulty,'easy');
 assert.deepEqual(normalizeConfig(),DEFAULT_CONFIG);
 assert.equal(new Match().actors.length,3);
 const saved=normalizeConfig(JSON.parse('{"botCount":4,"difficulty":"normal"}'));
 assert.equal(saved.botCount,4);assert.equal(saved.difficulty,'normal');
});

 for(const arena of MAPS.filter(arena=>!arena.platforms&&!arena.nextGen))for(const gravity of [1,.4])test(`${arena.id} gravity ${gravity}: solid landings, edges, recovery and turbo collision`,()=>{
 const config={speed:1.5,gravity};
 for(const b of arena.blocks.filter(b=>b.kind==='cover')){
  for(const offset of [0,b.w/2+RULES.radius-.01]){
   const a=actor(arena,{x:b.x+offset,z:b.z,y:b.h+.1,vy:-40});
   moveActor(a,{},1/30,arena,config);assert.equal(a.y,b.h);assert.equal(a.grounded,true);clear(a,arena);
   for(let i=0;i<20;i++)moveActor(a,{},1/60,arena,config);
   assert.equal(a.y,b.h);
  }
  const a=actor(arena,{x:b.x,z:b.z,y:b.h-.1,vy:-3});
  moveActor(a,{},1/60,arena,config);assert.equal(a.y,b.h);clear(a,arena);
  Object.assign(a,{x:b.x,z:b.z,y:0});moveActor(a,{},1/60,arena,config);clear(a,arena);assert.equal(a.y,0);
  Object.assign(a,{x:b.x,z:b.z+b.d/2+RULES.radius+.05,y:b.h-.05,vz:-60,vy:0,active:3});
  moveActor(a,{z:-1},1/30,arena,config);clear(a,arena);assert.ok(a.z>=b.z+b.d/2+RULES.radius);
   Object.assign(a,{x:b.x,z:b.z,y:b.h,vx:0,vy:0,vz:0,grounded:true,traversalCooldown:10});
  for(let i=0;i<90;i++){moveActor(a,{z:1},1/60,arena,config);clear(a,arena);}
   assert.ok(arena.terrain?a.y===floorAt(a.x,a.z,arena):a.y<b.h);assert.equal(a.y,floorAt(a.x,a.z,arena));
 }
});

 for(const arena of MAPS.filter(m=>m.raised&&!m.bounds))test(`${arena.id}: both ramps ascend, descend and accept low-gravity turbo landings`,()=>{
 for(const x of [-11,11])for(const gravity of [1,.4]){
  const config={speed:1.5,gravity},a=actor(arena,{x,z:7,y:0,grounded:true,active:3});
  for(let i=0;i<90;i++){moveActor(a,{z:-1},1/60,arena,config);clear(a,arena);}
  assert.equal(a.y,3.8);assert.ok(a.z<-9);
  for(let i=0;i<100;i++){moveActor(a,{z:1},1/60,arena,config);clear(a,arena);assert.equal(a.grounded,true);}
  assert.equal(a.y,0);
  Object.assign(a,{x,z:-3,y:5,vy:-30,vx:0,vz:0,grounded:false});
  for(let i=0;i<30;i++)moveActor(a,{},1/60,arena,config);
  assert.equal(a.y,floorAt(a.x,a.z,arena));assert.equal(a.grounded,true);clear(a,arena);
 }
});

test('low-gravity turbo jump crosses onto cover without embedding',()=>{
 for(const arena of MAPS.filter(arena=>!arena.nextGen&&!arena.race)){
  const b=arena.blocks.find(b=>b.kind==='cover'),a=actor(arena,{x:b.x,z:b.z+b.d/2+2,y:0,vz:-1.8,grounded:true});
  let landed=false;
  for(let i=0;i<240;i++){
   moveActor(a,{jump:i===0},1/60,arena,{speed:1.5,gravity:.4});clear(a,arena);
   if(a.grounded){landed=a.y===b.h;break;}
  }
  assert.ok(landed,arena.id);
 }
});

test('remembered targets require a new reaction after cover and turning is bounded',()=>{
 const m=new Match('chatgpt','hermes',rng(),'crosswire',{botCount:1,difficulty:'easy'}),[p,b]=m.actors;
 Object.assign(b,{x:0,y:0,z:8,yaw:Math.PI,pitch:0,protection:0,cooldown:100,shotWait:0});
 Object.assign(p,{x:0,y:0,z:4,protection:0});
 m.botInput(b,1/60);assert.ok(Math.abs(b.yaw-Math.PI)<=2.5/60+1e-9);
 b.bot.reaction=0;b.bot.think=1;
 Object.assign(p,{z:-4});m.botInput(b,1/60);assert.equal(b.bot.tracking,false);assert.equal(b.shots,0);
 assert.equal(b.bot.seen.z,4);
 Object.assign(p,{z:4});m.botInput(b,1/60);assert.ok(b.bot.reaction>=1.2);assert.equal(b.shots,0);
});

test('identical seeded firing lanes give easy opponents lower damage and longer survival',()=>{
 const run=difficulty=>{
  const m=new Match('chatgpt','hermes',rng(),'crosswire',{botCount:1,difficulty}),[p,b]=m.actors;
  Object.assign(p,{x:0,y:0,z:12,armor:0,protection:0});
  Object.assign(b,{x:0,y:0,z:4,yaw:Math.PI,pitch:0,cooldown:100,shotWait:0});
  let damage=0,death=Infinity;
  for(let i=0;i<1200;i++){
   m.time+=1/60;b.shotWait=Math.max(0,b.shotWait-1/60);m.botInput(b,1/60);
   damage+=100-p.health;if(p.health<=0&&death===Infinity)death=m.time;p.health=100;
   if(damage>=100&&death===Infinity)death=m.time;
  }
  return {damage,death,shots:b.shots};
 };
 const easy=run('easy'),normal=run('normal'),hard=run('hard');
 assert.ok(easy.damage<normal.damage,JSON.stringify({easy,normal}));
 assert.ok(normal.damage<hard.damage,JSON.stringify({normal,hard}));
 assert.ok(easy.death>normal.death);assert.ok(normal.death>hard.death);
 assert.ok(easy.shots<normal.shots);assert.ok(normal.shots<hard.shots);
 console.log('Seeded 20-second firing lane:',{easy,normal,hard});
});

test('matches share frozen map navigation but not mutable match state',()=>{
 for(const arena of MAPS){
  const a=new Match('chatgpt','hermes',rng(),arena.id),b=new Match('chatgpt','hermes',rng(),arena.id);
  assert.equal(a.nav,b.nav);assert.equal(a.edges,b.edges);assert.ok(Object.isFrozen(a.nav[0]));assert.ok(Object.isFrozen(a.edges[0]));
  assert.notEqual(a.pickups,b.pickups);assert.notEqual(a.actors[1].bot.route,b.actors[1].bot.route);
 }
});

test('seeded platform-map team bots traverse launchers instead of falling through routes',{skip:slowSkip('4x1800-step platform bot sweep: run with COCS_SLOW_TESTS=1')},()=>{
 const cases=[['skybreak','ctf'],['aether','koth'],['ironfall-megastructure','teamdeathmatch'],['longreach-plateau','domination']];
 for(const [map,mode] of cases){
  const m=new Match('chatgpt','openclaw',()=>.37,map,{mode,botCount:7,timeLimit:30,fragLimit:20});
  for(let i=0;i<1800;i++)m.step(1/60);
  assert.ok(m.actors.every(a=>[a.x,a.y,a.z].every(Number.isFinite)),`${map}: finite actor state`);
  assert.ok(m.stats.falls<30,`${map}: ${m.stats.falls} falls`);
  assert.ok(m.stats.shots>0,`${map}: bots fired`);
  if(mode==='koth'||mode==='domination')assert.ok(m.teamScores[0]+m.teamScores[1]>0||m.objectiveState.zones.some(z=>z.progress>0||z.owner!==null),`${map}: objective activity`);
  else if(mode==='ctf')assert.ok(m.teamScores[0]+m.teamScores[1]>0||m.events.some(e=>e.type==='flag-pickup'),`${map}: flag activity`);
  else assert.ok(m.stats.kills>0||m.stats.shots>0,`${map}: combat activity`);
 }
});

test('side approach to a solid never snaps onto its top',()=>{
 const arena={id:'reactor-side',raised:false,blocks:[{kind:'reactor',x:0,z:0,w:3,d:3,h:5}],spawns:[[0,0]],pickups:[],bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10}};
 const a=actor(arena,{x:-2.6,y:0,z:0,grounded:true});
 for(let i=0;i<60;i++)moveActor(a,{x:1},1/60,arena,{speed:1.5,gravity:1});
 assert.equal(a.y,0);assert.ok(a.x<-.5);clear(a,arena);
});

test('descending from above lands on a solid top',()=>{
 const arena={id:'reactor-landing',raised:false,blocks:[{kind:'reactor',x:0,z:0,w:3,d:3,h:5}],spawns:[[0,0]],pickups:[],bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10}};
 const a=actor(arena,{x:0,y:7,z:0,vy:-8});
 for(let i=0;i<30&&!a.grounded;i++)moveActor(a,{},1/60,arena,{speed:1.5,gravity:1});
 assert.equal(a.y,5);assert.equal(a.grounded,true);clear(a,arena);
});

test('an airborne actor above cover is not snapped down onto its top',()=>{
 const arena={id:'reactor-hover',raised:false,blocks:[{kind:'reactor',x:0,z:0,w:3,d:3,h:5}],spawns:[[0,0]],pickups:[],bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10}};
 const a=actor(arena,{x:0,y:20,z:0,vy:0});
 moveActor(a,{},1/60,arena,{speed:1,gravity:1});
 assert.ok(a.y>18,`expected to stay near the drop height, got ${a.y}`);
 for(let i=0;i<200&&!a.grounded;i++)moveActor(a,{},1/60,arena,{speed:1,gravity:1});
 assert.equal(a.y,5,'gravity should still land it on the block top');
 assert.equal(a.grounded,true);
});

test('jumping from a solid top reaches a positive apex',()=>{
 const arena={id:'reactor-jump',raised:false,blocks:[{kind:'reactor',x:0,z:0,w:6,d:6,h:2}],spawns:[[0,0]],pickups:[],bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10}};
 const a=actor(arena,{x:0,y:2,z:0,grounded:true,vy:0});
 let apex=a.y;
 for(let i=0;i<30;i++){moveActor(a,{jump:i===0},1/60,arena,{speed:1,gravity:1});apex=Math.max(apex,a.y);}
 assert.ok(apex>2.3,`expected a jump above the block, apex ${apex}`);
});

test('a grounded actor crossing a solid top stays supported',()=>{
 const arena={id:'reactor-walk',raised:false,blocks:[{kind:'reactor',x:0,z:0,w:6,d:6,h:2}],spawns:[[0,0]],pickups:[],bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10}};
 const a=actor(arena,{x:-2,y:2,z:0,grounded:true});
 for(let i=0;i<12;i++){moveActor(a,{x:1},1/60,arena,{speed:1.5,gravity:1});if(Math.abs(a.x)<3-RULES.radius-.1){assert.equal(a.y,2,`stayed on top at x=${a.x}`);assert.equal(a.grounded,true);}}
});

test('team-only maps still give teamless modes valid, multiple spawns',()=>{
 for(const map of MAPS){
  const m=new Match('chatgpt','openclaw',rng(),map.id,{mode:'deathmatch',botCount:0,humanCount:1});
  assert.ok(m.spawns.length>=2,`${map.id}: teamless spawn pool (${m.spawns.length})`);
  if(!map.spawns.length){
   const a=m.actors[0];
   assert.equal(obstructed(a.x,a.y,a.z,RULES.radius,m.arena),false,`${map.id}: actor ${a.id} spawns clear`);
  }
 }
});

test('bot engagement range scales with map size and difficulty then stays cached',()=>{
 const small=new Match('chatgpt','openclaw',rng(),'exchange',{botCount:1,difficulty:'easy'}).actors[0].botScan;
 const big=new Match('chatgpt','openclaw',rng(),'frostline',{botCount:1,difficulty:'easy'}).actors[0].botScan;
 const hard=new Match('chatgpt','openclaw',rng(),'exchange',{botCount:1,difficulty:'hard'}).actors[0].botScan;
 assert.ok(small>=33&&small<=44,`easy small ${small}`);
 assert.ok(big>small,`large map ${big} should exceed ${small}`);
 assert.ok(big<=44,`easy cap ${big}`);
 assert.ok(hard>small,`hard ${hard} should exceed easy ${small}`);
 const cached=new Match('chatgpt','openclaw',rng(),'exchange',{botCount:1,difficulty:'easy'}),bot=cached.actors[1];
 const initial=bot.botScan;
 for(let i=0;i<180;i++)cached.step(1/60);
 assert.equal(bot.botScan,initial);
});

test('large-map roam always picks a finite purposeful patrol destination',()=>{
 const m=new Match('chatgpt','openclaw',rng(),'ironfall-megastructure',{botCount:3,difficulty:'normal'}),bot=m.actors.filter(a=>a.bot)[0];
 m.actors=[bot];m.pickups=[];Object.assign(bot,{x:0,y:0,z:0,vx:0,vy:0,vz:0});
 m.botInput(bot,1/60);
 assert.equal(bot.bot.state,'roam');
 assert.ok(bot.bot.destination&&Number.isFinite(bot.bot.destination.x)&&Number.isFinite(bot.bot.destination.z));
 for(let i=0;i<180;i++)m.step(1/60);
 assert.ok(Math.hypot(bot.x,bot.z)>2,`roamer moved ${Math.hypot(bot.x,bot.z)}`);
});

test('ctf defenders hold a post between their flag base and the arena center',()=>{
 const m=new Match('chatgpt','openclaw',rng(),'blood-gulch',{mode:'ctf',botCount:3,difficulty:'normal'}),bot=m.actors.filter(a=>a.bot)[0];
 const base=m.flagSpawns[bot.team],post=m.defensivePost(bot),toBase=Math.hypot(post.x-base[0],post.z-base[1]);
 assert.ok(toBase>0&&toBase<=12.01,`post ${toBase} from base`);
 assert.ok(Math.hypot(post.x-m.center.x,post.z-m.center.z)<Math.hypot(base[0]-m.center.x,base[1]-m.center.z));
 assert.ok([post.x,post.y,post.z].every(Number.isFinite));
});
test('reduced-armour gear stays a tradeoff instead of amplifying damage',()=>{
 const m=new Match('chatgpt','openclaw',rng(),'exchange',{mode:'deathmatch',botCount:0,loadouts:{0:{character:'chatgpt',harness:'openclaw',gear:{primary:'light-frame'}}}});
 const a=m.actors[0];a.protection=0;a.armor=0;
 const before=a.health;m.damage(a,10,a);
 assert.equal(before-a.health,10,`light frame should not add damage (${before-a.health})`);
});
test('harness passive damage is applied to outgoing fire',()=>{
 const open=new Match('chatgpt','openclaw',rng(),'exchange',{mode:'deathmatch',botCount:0}).actors[0];
 const hermes=new Match('chatgpt','hermes',rng(),'exchange',{mode:'deathmatch',botCount:0}).actors[0];
 assert.ok(open.harnessDamageMultiplier>1,'OpenClaw passive should raise damage');
 assert.ok(hermes.harnessDamageMultiplier<1,'Hermes passive should lower damage');
});
