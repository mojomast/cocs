import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,moveActor} from './core.mjs';
import {resolveMapForMode} from './arenas.mjs';
import {DEFAULT_CONFIG,DEFAULT_DISPLAY,normalizeConfig,normalizeDisplay,GAME_MODES,DIFFICULTIES,modeRule} from './config.mjs';
const rng=()=>{let n=123;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
function fixture(options={}){const m=new Match('chatgpt','hermes',()=>.75,'crosswire',{botCount:1,...options});const [a,b]=m.actors;Object.assign(a,{x:0,z:8,y:0,health:100,armor:0,protection:0,shotWait:0,yaw:0,pitch:0});if(b)Object.assign(b,{x:0,z:5,y:0,health:100,armor:0,protection:0,shotWait:0,yaw:Math.PI,pitch:0});return [m,a,b];}

test('configuration sanitizes saved data and isolates each match',()=>{const c=normalizeConfig({botCount:99,difficulty:'bogus',timeLimit:NaN,fragLimit:-1,gravity:0,damage:Infinity,mode:'x',playerName:'  Kyle\u0000 D  ',lifeSteal:'yes'});assert.equal(c.botCount,8);assert.equal(c.fragLimit,5);assert.equal(c.timeLimit,300);assert.equal(c.mode,'deathmatch');assert.equal(c.gravity,1);assert.equal(c.damage,1);assert.equal(c.playerName,'Kyle D');assert.equal(c.lifeSteal,false);assert.deepEqual(normalizeConfig(null),DEFAULT_CONFIG);const options={botCount:0,fragLimit:5};const [m]=fixture(options);options.fragLimit=50;assert.equal(m.config.fragLimit,5);assert.equal(new Match().config.fragLimit,15);assert.deepEqual(normalizeDisplay({fov:999,color:'bad',size:NaN,crosshair:'x'}),{...DEFAULT_DISPLAY,fov:110});});
test('resolution scale defaults, clamps finite numbers and survives saved JSON',()=>{
 assert.deepEqual(normalizeDisplay(null),DEFAULT_DISPLAY);
 for(const resolutionScale of [undefined,null,'0.7',true,NaN,Infinity,-Infinity,{},[]])assert.equal(normalizeDisplay({resolutionScale}).resolutionScale,.5);
 for(const [input,expected] of [[-1,.5],[0,.5],[.5,.5],[.73,.73],[1,1],[1.5,1.5],[2,1.5]]){
  const display=normalizeDisplay({resolutionScale:input,fov:95,showWeapon:false});
  assert.equal(display.resolutionScale,expected);
  const saved=JSON.parse(JSON.stringify({config:DEFAULT_CONFIG,display,mapId:'crosswire'}));
  assert.deepEqual(normalizeDisplay(saved.display),display);
 }
 const legacy=JSON.parse('{"display":{"fov":90,"crosshair":"dot","showWeapon":false}}');
 assert.deepEqual(normalizeDisplay(legacy.display),{...DEFAULT_DISPLAY,fov:90,crosshair:'dot',showWeapon:false});
});
test('glow defaults off and resolution scaling defaults to 50 percent',()=>{
 const d=normalizeDisplay({});
 assert.equal(d.postFx,false);
 assert.equal(d.bloom,0);
 assert.equal(d.resolutionScale,.5);
 const on=normalizeDisplay({postFx:true,bloom:.5,resolutionScale:1});
 assert.equal(on.postFx,true);
 assert.equal(on.bloom,.5);
 assert.equal(on.resolutionScale,1);
});
test('0 through 8 bots create exact rosters; solo ends on configured time',()=>{for(let count=0;count<=8;count++){const [m]=fixture({botCount:count});assert.equal(m.actors.length,count+1);assert.equal(new Set(m.actors.map(a=>a.character)).size,count+1);assert.ok(m.actors.every(a=>a.character!=='claude'||a.harness==='claudecode'));}const [m]=fixture({botCount:0,timeLimit:60,playerName:'Kyle'});for(let i=0;i<3601;i++)m.step(1/60);assert.equal(m.over,true);assert.equal(m.stats.kills,0);assert.equal(m.snapshot().actors[0].name,'Kyle');});
test('Instagib locks rail, ignores supplies, disables powers and kills in one unprotected hit',()=>{const [m,a,b]=fixture({mode:'instagib'});assert.equal(m.pickups.length,0);assert.equal(m.power(a),false);assert.deepEqual(a.ammo,[0,0,Infinity,0,0,0,0,0,0,0]);b.protection=1;m.fire(a);assert.equal(b.health,100);a.shotWait=0;b.protection=0;b.armor=100;a.weapon=0;m.fire(a);assert.equal(a.weapon,2);assert.equal(b.health,0);assert.equal(a.frags,1);m.spawn(b);assert.equal(b.weapon,2);assert.equal(b.ammo[2],Infinity);});
test('Rocket Arena and Full Arsenal preserve unlimited inventories through firing and respawn',()=>{const [m,a]=fixture({mode:'rockets'});assert.ok(m.pickups.every(p=>['health','armor'].includes(p.kind)));a.weapon=0;m.fire(a);assert.equal(m.rockets[0].weapon,1);assert.equal(a.ammo[1],Infinity);m.spawn(a);assert.equal(a.weapon,1);const [n,c]=fixture({mode:'arsenal'});assert.ok(c.ammo.every(x=>x===Infinity));for(let i=0;i<5;i++){c.weapon=i;c.shotWait=0;n.fire(c);assert.equal(c.ammo[i],Infinity);}n.spawn(c);assert.ok(c.ammo.every(x=>x===Infinity));});
test('custom starting weapon, infinite pickups, respawn delay and frag limit take effect',()=>{const [m,a,b]=fixture({startingWeapon:4,unlimitedAmmo:true,respawn:5,fragLimit:5});assert.equal(a.weapon,4);assert.equal(a.ammo[4],Infinity);const rail=m.pickups.find(p=>p.kind==='rail');m.collect(a,rail);assert.equal(a.ammo[2],Infinity);m.damage(b,1000,a);assert.equal(b.dead,5);assert.equal(m.over,false);a.frags=4;m.spawn(b);b.protection=0;m.damage(b,1000,a);assert.equal(m.over,true);assert.equal(a.frags,5);m.spawn(a);assert.equal(a.weapon,4);assert.equal(a.ammo[2],0);});
 test('damage, life steal and ability cooldown modifiers respect damage actually dealt',()=>{const [m,a,b]=fixture({damage:2,lifeSteal:true,fastPowers:true});a.health=40;m.damage(b,10,a);assert.equal(b.health,80.8);assert.equal(a.health,44.8);b.health=4;m.damage(b,100,a);assert.equal(a.health,45.8);assert.ok(m.power(a));assert.equal(a.cooldown,6);a.health=50;m.damage(a,10,a);assert.equal(a.health,30);});
test('low gravity raises jump height and turbo changes movement without global rule mutation',()=>{const [m,a]=fixture({botCount:0});a.x=-11;const base={...a},moon={...a},turbo={...a};for(let i=0;i<30;i++){moveActor(base,{z:-1,jump:i===0},1/60,m.arena,{speed:1,gravity:1});moveActor(moon,{z:-1,jump:i===0},1/60,m.arena,{speed:1,gravity:.4});moveActor(turbo,{z:-1,jump:i===0},1/60,m.arena,{speed:1.5,gravity:1});}assert.ok(moon.y>base.y+1);assert.ok(Math.abs(turbo.vz)>Math.abs(base.vz));});
test('difficulty changes bot reaction, aim error and firing cadence without changing base health',()=>{const [easy,,e]=fixture({difficulty:'easy'}),[hard,,h]=fixture({difficulty:'nightmare'});easy.botInput(e,1/60);hard.botInput(h,1/60);assert.ok(e.bot.reaction>h.bot.reaction);assert.ok(Math.abs(e.bot.aimError.x)>Math.abs(h.bot.aimError.x));assert.ok(Math.abs(e.yaw-Math.PI)<=2.5/60);e.shotWait=h.shotWait=0;easy.fire(e);hard.fire(h);assert.ok(e.shotWait>h.shotWait);assert.equal(e.health,h.health);});
test('every combat mode completes with combat or an objective result at every difficulty; 8-bot matches stay finite',()=>{for(const mode of GAME_MODES.filter(mode=>mode.rules?.score!=='laps'&&mode.id!=='puma-soccer'))for(const difficulty of DIFFICULTIES){const m=new Match('kimi','roo',rng(),resolveMapForMode('crosswire',mode.id,{legacy:true}),{mode:mode.id,difficulty:difficulty.id,botCount:8,timeLimit:60,fragLimit:5});for(let i=0;i<3601&&!m.over;i++)m.step(1/60);assert.ok(m.over,`${mode.id}/${difficulty.id}`);assert.ok(m.stats.shots>0,`${mode.id}/${difficulty.id} shots`);const settled=m.stats.kills>0||m.events.some(event=>['capture','zone-capture','assault-breach','payload-checkpoint','payload-delivered','objective-win'].includes(event.type));assert.ok(settled,`${mode.id}/${difficulty.id} resolves by combat or objective`);assert.ok(m.actors.every(a=>[a.x,a.y,a.z,a.health,a.frags].every(Number.isFinite)));}});

test('Puma Circuit clamps laps and roster and neutralizes combat modifiers without mutating saved config',()=>{
 const saved={mode:'puma-race',botCount:99,fragLimit:99,speed:1.5,gravity:.4,damage:2,fastPowers:true,lifeSteal:true,unlimitedAmmo:true,suddenDeath:true,randomLoadout:true,oneShot:true,bounty:true,berserk:true,startingWeapon:9};
 const c=normalizeConfig(saved);
 assert.equal(c.botCount,7);assert.equal(c.fragLimit,10);
 assert.equal(normalizeConfig({mode:'puma-race'}).fragLimit,3);
 assert.equal(normalizeConfig({mode:'puma-race',fragLimit:0,botCount:0}).fragLimit,1);
 for(const key of ['speed','gravity','damage'])assert.equal(c[key],1);
 for(const key of ['fastPowers','lifeSteal','unlimitedAmmo','suddenDeath','randomLoadout','oneShot','bounty','berserk'])assert.equal(c[key],false);
 assert.equal(c.startingWeapon,0);assert.equal(saved.oneShot,true);assert.equal(saved.speed,1.5);
 const mode=GAME_MODES.find(mode=>mode.id==='puma-race');
 assert.equal(mode.name,'Puma Circuit');assert.equal(mode.rules.team,false);assert.equal(mode.rules.score,'laps');
});
test('Puma Soccer clamps the roster and neutralizes combat modifiers without mutating saved config',()=>{
 const saved={mode:'puma-soccer',botCount:99,fragLimit:99,speed:1.5,gravity:.4,damage:2,fastPowers:true,lifeSteal:true,unlimitedAmmo:true,suddenDeath:true,randomLoadout:true,oneShot:true,bounty:true,berserk:true,startingWeapon:9};
 const c=normalizeConfig(saved);
 assert.equal(c.botCount,3);assert.equal(c.fragLimit,15);
 assert.equal(normalizeConfig({mode:'puma-soccer'}).fragLimit,5);
 assert.equal(normalizeConfig({mode:'puma-soccer',fragLimit:0,botCount:0}).fragLimit,1);
 for(const key of ['speed','gravity','damage'])assert.equal(c[key],1);
 for(const key of ['fastPowers','lifeSteal','unlimitedAmmo','suddenDeath','randomLoadout','oneShot','bounty','berserk'])assert.equal(c[key],false);
 assert.equal(c.startingWeapon,0);assert.equal(saved.oneShot,true);assert.equal(saved.speed,1.5);
 const mode=GAME_MODES.find(mode=>mode.id==='puma-soccer');
 assert.equal(mode.name,'Puma Soccer');assert.equal(mode.rules.team,true);assert.equal(mode.rules.score,'goals');
});
test('starting weapon accepts the full ten-weapon arsenal',()=>{assert.equal(normalizeConfig({startingWeapon:9}).startingWeapon,9);assert.equal(normalizeConfig({startingWeapon:99}).startingWeapon,9);assert.equal(normalizeConfig({startingWeapon:-3}).startingWeapon,0);assert.equal(normalizeConfig({startingWeapon:8}).startingWeapon,8);});
test('mode rules gate vehicles, carrier speed and zone buffs without touching other modes',()=>{
  assert.equal(modeRule('combined-arms').vehicles,true);
  assert.equal(modeRule('puma-race').vehicles,true);
  assert.equal(modeRule('puma-soccer').vehicles,true);
  assert.equal(modeRule('domination').vehicles,false);
  assert.equal(modeRule('koth').vehicles,false);
  assert.equal(modeRule('ctf').carrierSpeed,.9);
  assert.equal(modeRule('domination').zoneBuffs.alpha,'overshield');
  assert.equal(modeRule('domination').zoneBuffs.bravo,'haste');
  assert.equal(modeRule('domination').zoneBuffs.charlie,'overcharge');
  assert.equal(modeRule('koth').zoneBuff,'haste');
  assert.equal(modeRule('deathmatch').vehicles,undefined,'untouched modes keep current vehicle defaults');
});

test('display configuration accepts a manual reduce-motion override', () => {
 const d = normalizeDisplay({ reducedMotion: true });
 assert.equal(d.reducedMotion, true);
 assert.equal(normalizeDisplay({}).reducedMotion, false);
 assert.equal(normalizeDisplay({ reducedMotion: 'yes' }).reducedMotion, false);
});

test('display preferences normalize invert and look sensitivities',()=>{
 const clamped=normalizeDisplay({invertY:true,adsSensitivity:9,touchSensitivity:0});
 assert.equal(clamped.invertY,true);
 assert.equal(clamped.adsSensitivity,1.5);
 assert.equal(clamped.touchSensitivity,.3);
 const defaults=normalizeDisplay({});
 assert.equal(defaults.invertY,false);
 assert.equal(defaults.adsSensitivity,.85);
 assert.equal(defaults.touchSensitivity,1);
});

test('display clarity and caption preferences default safely',()=>{
 const d=normalizeDisplay({});
 assert.equal(d.captions,false);
 assert.equal(d.showKillFeed,true);
 assert.equal(d.showDamageNumbers,true);
 assert.equal(d.showRadar,true);
 const on=normalizeDisplay({captions:true,showKillFeed:false,showDamageNumbers:false,showRadar:false});
 assert.equal(on.captions,true);
 assert.equal(on.showKillFeed,false);
 assert.equal(on.showDamageNumbers,false);
 assert.equal(on.showRadar,false);
});
