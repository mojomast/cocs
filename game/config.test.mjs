import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,moveActor} from './core.mjs';
import {resolveMapForMode} from './arenas.mjs';
import {DEFAULT_CONFIG,DEFAULT_DISPLAY,normalizeConfig,normalizeDisplay,GAME_MODES,DIFFICULTIES,modeRule,MUTATORS,MUTATOR_IDS,activeMutators,mutatorEffects,applyMutators,loadoutFor,loadoutRule,loadoutAllows,loadoutStart,spawnInventory,spawnLoadout,LOADOUT_PRESETS,matchPlan,mutatorView,quickStartRules} from './config.mjs';
import {COOP_GARRISON_BOTS,COOP_TEAM_FLOOR,DEFAULT_COCS_TIER,OPERATIONS_WAVE_COUNT,configuredDirectorTier,coopRoster,coopWaveSummary} from './cocs-difficulty.mjs';
import {slowSkip} from './test-support.mjs';
import {CAMPAIGN_MISSIONS} from './campaign-data.mjs';
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
 test('damage, life steal and ability cooldown modifiers respect damage actually dealt',()=>{const [m,a,b]=fixture({damage:2,lifeSteal:true,fastPowers:true});a.health=40;m.damage(b,10,a);assert.equal(b.health,80,'20 modified damage lands with no hidden target resistance');assert.equal(a.health,45,'life steal pays 25% of the 20 actually dealt');b.health=4;m.damage(b,100,a);assert.equal(a.health,46);assert.ok(m.power(a));assert.equal(a.cooldown,4,'half of Hermes\' 10 s, minus the −1 s rider');a.health=50;m.damage(a,10,a);assert.equal(a.health,30);});
test('low gravity raises jump height and turbo changes movement without global rule mutation',()=>{const [m,a]=fixture({botCount:0});a.x=-11;const base={...a},moon={...a},turbo={...a};for(let i=0;i<30;i++){moveActor(base,{z:-1,jump:i===0},1/60,m.arena,{speed:1,gravity:1});moveActor(moon,{z:-1,jump:i===0},1/60,m.arena,{speed:1,gravity:.4});moveActor(turbo,{z:-1,jump:i===0},1/60,m.arena,{speed:1.5,gravity:1});}assert.ok(moon.y>base.y+1);assert.ok(Math.abs(turbo.vz)>Math.abs(base.vz));});
test('difficulty changes bot reaction, aim error and firing cadence without changing base health',()=>{const [easy,,e]=fixture({difficulty:'easy'}),[hard,,h]=fixture({difficulty:'nightmare'});easy.botInput(e,1/60);hard.botInput(h,1/60);assert.ok(e.bot.reaction>h.bot.reaction);assert.ok(Math.abs(e.bot.aimError.x)>Math.abs(h.bot.aimError.x));assert.ok(Math.abs(e.yaw-Math.PI)<=2.5/60);e.shotWait=h.shotWait=0;easy.fire(e);hard.fire(h);assert.ok(e.shotWait>h.shotWait);assert.equal(e.health,h.health);});
test('every combat mode completes with combat or an objective result at every difficulty; 8-bot matches stay finite',{skip:slowSkip('exhaustive 8-bot mode sweep: run with COCS_SLOW_TESTS=1')},()=>{
 // Campaign floor anchors are authored per mission on that mission's map;
 // resolving them elsewhere is a hard error by design (game/map-layout.test.mjs),
 // so pair the campaign sweep with the default mission and its arena instead of
 // the crosswire fallback used by the multiplayer modes.
 const campaign=CAMPAIGN_MISSIONS[0];
 for(const mode of GAME_MODES.filter(mode=>mode.rules?.score!=='laps'&&mode.id!=='puma-soccer'))for(const difficulty of DIFFICULTIES){
  const campaignMode=mode.id==='campaign';
  const m=new Match('kimi','roo',rng(),campaignMode?campaign.mapId:resolveMapForMode('crosswire',mode.id,{legacy:true}),{mode:mode.id,difficulty:difficulty.id,botCount:8,timeLimit:60,fragLimit:5,...(campaignMode?{mission:campaign.id}:{})});
  for(let i=0;i<3601&&!m.over;i++)m.step(1/60);
  assert.ok(m.over,`${mode.id}/${difficulty.id}`);
  assert.ok(m.stats.shots>0,`${mode.id}/${difficulty.id} shots`);
  // A mission win/loss is campaign's objective resolution; the other modes
  // resolve through a combat kill or one of the listed objective events.
  const settled=m.stats.kills>0||m.events.some(event=>['capture','zone-capture','assault-breach','payload-checkpoint','payload-delivered','objective-win','mission-won','mission-lost'].includes(event.type));
  assert.ok(settled,`${mode.id}/${difficulty.id} resolves by combat or objective`);
  assert.ok(m.actors.every(a=>[a.x,a.y,a.z,a.health,a.frags].every(Number.isFinite)));
 }
});

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

test('new mode balance rules are explicit, bounded and cannot stalemate',()=>{
 const jug=modeRule('juggernaut');
 assert.equal(jug.juggernautRate,.75,'carrier banks less than a point a second');
 assert.equal(jug.juggernautShield,125,'carrier buffer is tuned');
 assert.equal(jug.juggernautDamage,1.4,'carrier damage aura is tuned');
 assert.equal(jug.juggernautBounty,3);
 assert.equal(jug.juggernautKillBonus,2);
 assert.ok(jug.suddenDeathSeconds>0&&jug.suddenDeathSeconds<=60,'juggernaut has a bounded sudden-death window');
 const elim=modeRule('team-elimination');
 assert.equal(elim.eliminationRespawn,3,'elimination respawns are delayed');
 assert.ok(elim.eliminationAttritionStart>0&&elim.eliminationAttritionEvery>0,'elimination bleeds tickets so a passive match still ends');
 assert.ok(elim.eliminationAttritionStart+elim.fragLimit*elim.eliminationAttritionEvery<300,'the worst-case elimination match ends inside the default clock');
 assert.ok(elim.suddenDeathSeconds>0&&elim.suddenDeathSeconds<=60,'elimination has a bounded sudden-death window');
 assert.equal(normalizeConfig({mode:'team-elimination'}).respawn,2,'the shared respawn setting is untouched');
 const duel=normalizeConfig({mode:'juggernaut',fragLimit:9999});
 assert.equal(duel.fragLimit,99,'juggernaut target clamps');
 assert.equal(normalizeConfig({mode:'team-elimination',fragLimit:0}).fragLimit,1,'elimination target clamps');
});

test('endless defaults off and normalizes as a boolean',()=>{
 assert.equal(DEFAULT_CONFIG.endless,false);
 assert.equal(normalizeConfig({}).endless,false);
 assert.equal(normalizeConfig({endless:true}).endless,true);
 assert.equal(normalizeConfig({endless:'yes'}).endless,false);
 assert.equal(normalizeConfig({endless:1}).endless,false);
});

test('holdout and uplink register distinct objective variants without disturbing existing modes',()=>{
 const holdout=GAME_MODES.find(mode=>mode.id==='holdout');
 const uplink=GAME_MODES.find(mode=>mode.id==='uplink');
 assert.ok(holdout&&uplink,'both variants are registered');
 assert.equal(holdout.name,'Holdout');
 assert.equal(holdout.rules.team,true);
 assert.equal(holdout.rules.objective.kind,'domination','holdout reuses the domination capture loop');
 assert.equal(holdout.rules.objective.holdCount,2);
 assert.ok(holdout.rules.objective.holdSeconds>0);
 assert.equal(uplink.name,'Uplink');
 assert.equal(uplink.rules.team,true);
 assert.equal(uplink.rules.objective.kind,'koth','uplink reuses the single-hill capture loop');
 assert.ok(uplink.rules.objective.sequence>=2);
 assert.equal(new Set(GAME_MODES.map(mode=>mode.id)).size,GAME_MODES.length,'mode ids stay unique');
 assert.equal(new Set(GAME_MODES.map(mode=>mode.name)).size,GAME_MODES.length,'mode names stay unique');
 assert.equal(normalizeConfig({mode:'holdout'}).fragLimit,100);
 assert.equal(normalizeConfig({mode:'uplink'}).fragLimit,100);
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

test('mutators unify the legacy flags into one canonical, ordered set',()=>{
 const c=normalizeConfig({mutators:['noRecoil','turbo','oneShot','bigHead','lowGravity']});
 assert.equal(c.speed,1.25);
 assert.equal(c.gravity,.4);
 assert.equal(c.oneShot,true);
 assert.equal(c.bigHead,true);
 assert.equal(c.noRecoil,true);
 assert.deepEqual(c.mutators,['turbo','lowGravity','oneShot','bigHead','noRecoil']);
 assert.deepEqual(activeMutators(c),c.mutators,'activeMutators follows the canonical order');
 assert.ok(Object.isFrozen(c.mutators));
 // Explicit flags and the list compose; a bare flag still surfaces as a mutator.
 const flags=normalizeConfig({fastPowers:true,lifeSteal:true,unlimitedAmmo:true});
 assert.deepEqual(flags.mutators,['fastPowers','lifeSteal','unlimitedAmmo']);
 // Unknown ids are ignored, duplicates collapse, and the list never leaks through.
 const unknown=normalizeConfig({mutators:['turbo','turbo','bogus']});
 assert.deepEqual(unknown.mutators,['turbo']);
 assert.equal(normalizeConfig({}).mutators.length,0);
 assert.deepEqual(DEFAULT_CONFIG.mutators,[]);
 assert.equal(MUTATOR_IDS.length,MUTATORS.length);
 assert.equal(new Set(MUTATOR_IDS).size,MUTATOR_IDS.length,'mutator ids stay unique');
});

test('mutatorEffects folds the canonical order into one deterministic effect view',()=>{
 const a=mutatorEffects(normalizeConfig({mutators:['turbo','lowGravity','doubleDamage','oneShot','noRecoil','bigHead']}));
 assert.equal(a.speedMultiplier,1.25);
 assert.equal(a.gravityMultiplier,.4);
 assert.equal(a.damageMultiplier,1.5);
 assert.equal(a.oneShot,true);
 assert.equal(a.noRecoil,true);
 assert.equal(a.bigHead,true);
 assert.ok(Object.isFrozen(a)&&Object.isFrozen(a.active));
 // Instagib implies one-shot even without the flag, and the mode alone supplies it.
 const mode=mutatorEffects(normalizeConfig({mode:'instagib'}));
 assert.equal(mode.instagib,true);
 assert.equal(mode.oneShot,true);
 assert.ok(mode.active.includes('instagib'));
 // Two equivalent spellings resolve byte-for-byte.
 assert.deepEqual(mutatorEffects(normalizeConfig({mutators:['oneShot']})),mutatorEffects(normalizeConfig({oneShot:true})));
});

test('applyMutators sets canonical flags for every mutator id',()=>{
 const target={};
 applyMutators(target,MUTATOR_IDS);
 for(const mutator of MUTATORS){
  if(mutator.id==='turbo')assert.equal(target.speed,1.25);
  else if(mutator.id==='lowGravity')assert.equal(target.gravity,.4);
  else if(mutator.id==='doubleDamage')assert.equal(target.damage,1.5);
  else assert.equal(target[mutator.field],true,`${mutator.id} sets ${mutator.field}`);
 }
});

test('sudden death and endless surface through mutatorView and matchPlan',()=>{
 const c=normalizeConfig({mutators:['endless','suddenDeath']});
 assert.deepEqual(c.mutators,['suddenDeath','endless'],'the fold stays in canonical order');
 assert.equal(c.suddenDeath,true);
 assert.equal(c.endless,true);
 assert.deepEqual(mutatorView(c).map(entry=>entry.name),['Sudden Death','Endless']);
 assert.equal(matchPlan(c).modifierLabel,'Sudden Death · Endless');
 const flags=normalizeConfig({suddenDeath:true,endless:true});
 assert.deepEqual(flags.mutators,['suddenDeath','endless'],'bare flags are surfaced as mutators too');
 assert.equal(matchPlan({suddenDeath:true}).modifiers[0].name,'Sudden Death');
});

test('mode loadouts pin weapons, ammo and pickup availability without breaking legacy modes',()=>{
 const instagib=loadoutFor('instagib');
 assert.deepEqual(instagib.weapons,[2]);
 assert.equal(instagib.infinite,true);
 assert.equal(instagib.noPickups,true);
 assert.equal(loadoutRule('instagib').start,2);
 assert.equal(loadoutStart({mode:'instagib'}),2);
 assert.deepEqual(spawnInventory({mode:'instagib'}),[0,0,Infinity,0,0,0,0,0,0,0]);
 const rockets=spawnLoadout({mode:'rockets'});
 assert.equal(rockets.weapon,1);
 assert.equal(rockets.ammo[1],Infinity);
 const arsenal=spawnLoadout({mode:'arsenal'});
 assert.equal(arsenal.weapon,0);
 assert.ok(arsenal.ammo.every(n=>n===Infinity));
 assert.equal(loadoutFor('deathmatch'),null,'deathmatch keeps the classic free arsenal');
 assert.equal(loadoutRule('ctf'),null);
});

test('loadout overrides accept presets and validated objects and never mutate the tables',()=>{
 const sniper=loadoutFor('deathmatch','sniperOnly');
 assert.deepEqual(sniper.weapons,[2,8]);
 assert.equal(sniper.start,2);
 assert.equal(sniper.noAds,true);
 assert.equal(loadoutAllows(sniper,2),true);
 assert.equal(loadoutAllows(sniper,0),false);
 assert.equal(loadoutAllows(null,9),true,'no loadout allows everything');
 const pistols=loadoutFor('deathmatch',{weapons:[9,0,9],start:0,infinite:true});
 assert.deepEqual(pistols.weapons,[0,9],'weapon list is filtered, sorted and de-duplicated');
 assert.equal(loadoutFor('deathmatch',{weapons:[]}),null,'an empty weapon list is rejected');
 assert.equal(loadoutFor('deathmatch',{weapons:[99]}),null,'out-of-range weapons are rejected');
 assert.equal(loadoutFor('deathmatch','bogus'),null);
 assert.equal(loadoutFor('deathmatch',{noAds:true}).noAds,true);
 const before=JSON.stringify(LOADOUT_PRESETS);
 loadoutFor('deathmatch','sniperOnly').weapons.push(0);
 assert.equal(JSON.stringify(LOADOUT_PRESETS),before,'resolved arrays are copies');
 // Mode rules and overrides merge field-by-field.
 const merged=loadoutFor('instagib',{noAds:true});
 assert.equal(merged.noPickups,true);
 assert.equal(merged.noAds,true);
});

test('a match applies its mode loadout to every actor and the pickup field',()=>{
 const [m,a]=fixture({botCount:0,loadout:{weapons:[2,8],start:8,infinite:true,noAds:true}});
 assert.equal(a.weapon,8);
 assert.equal(a.ammo[8],Infinity);
 assert.ok(m.pickups.every(p=>['health','armor','megahealth','ammo'].includes(p.kind)||[2,8].includes({rocket:1,rail:2,scatter:3,plasma:4,grenade:5,shock:6,flak:7,marksman:8,smg:9}[p.kind])),'only allowed weapon pickups survive');
 // A stale weapon switch cannot bypass the restriction.
 a.weapon=0;a.shotWait=0;a.ammo[0]=5;
 m.fire(a);
 assert.equal(a.weapon,8,'fire falls back to the allowed starting weapon');
});

test('mirrored loadout pins every actor to the configured starting weapon',()=>{
 const [m,a,b]=fixture({botCount:1,humanCount:2,startingWeapon:4,mutators:['mirrorLoadout']});
 assert.equal(a.weapon,4);
 assert.equal(b.weapon,4);
 assert.equal(a.ammo[4],24);
 assert.equal(b.ammo[4],24);
 m.spawn(a);m.spawn(b);
 assert.equal(a.weapon,4,'mirror survives respawn');
 assert.equal(b.weapon,4);
});

test('the instagib mutator forces the rail-only loadout on any mode',()=>{
 const [m,a,b]=fixture({botCount:0,humanCount:2,mutators:['instagib']});
 assert.equal(a.weapon,2);
 assert.deepEqual(a.ammo,[0,0,Infinity,0,0,0,0,0,0,0]);
 assert.equal(m.pickups.length,0,'no supplies under the instagib mutator');
 assert.equal(m.power(a),false,'powers are disabled');
 b.protection=0;b.armor=100;a.shotWait=0;m.fire(a);
 assert.equal(b.health,0,'one unprotected hit is lethal');
});

test('big head enlarges hitboxes and no recoil removes kick and bloom',()=>{
 const [m,a,b]=fixture({botCount:0,humanCount:2,mutators:['bigHead']});
 assert.equal(a.hitScale,1.5);
 assert.equal(b.hitScale,1.5);
 const [n,c]=fixture({botCount:0,humanCount:2,mutators:['noRecoil']});
 c.shotWait=0;c.weapon=0;c.ammo[0]=Infinity;n.fire(c);
 assert.equal(c.punchPitch,0,'no recoil leaves no vertical kick');
 assert.equal(c.spread,0,'no recoil leaves no bloom');
});

// ---------------------------------------------------------------------------
// F06: setup promises must match effective rules and roster.
// ---------------------------------------------------------------------------
test('matchPlan derives duration, roster, fill and modifiers from normalizeConfig',()=>{
 const saved=normalizeConfig({...DEFAULT_CONFIG,mutators:['turbo','bounty'],botCount:2});
 const plan=matchPlan(saved);
 assert.equal(plan.mode.id,'deathmatch');
 assert.equal(plan.mode.name,'Deathmatch');
 assert.equal(plan.team,false);
 assert.equal(plan.coop,false);
 assert.deepEqual(plan.rules,normalizeConfig(saved),'the plan carries the launchable normalized config');
 assert.equal(plan.duration,'5 MIN');
 assert.deepEqual(plan.difficulty,{id:'easy',name:'Easy'});
 assert.equal(plan.rosterLabel,'YOU + 2 BOTS');
 assert.equal(plan.roster,null,'only OPERATIONS carries the co-op roster');
 assert.equal(plan.tier,null);
 assert.equal(plan.fill.auto,false);
 assert.equal(plan.fill.note,null);
 assert.deepEqual(plan.modifiers.map(entry=>entry.id),['turbo','bounty']);
 assert.equal(plan.modifiers[0].name,'Turbo');
 assert.equal(plan.modifiers[0].detail,'1.25× speed','the preview names the resolved value');
 assert.equal(plan.modifierLabel,'Turbo · Bounty');
 // Derived from the shared normalizer: a saved mode can never keep a stale name.
 const dm=GAME_MODES.find(entry=>entry.id==='deathmatch');
 assert.equal(plan.mode.name,dm.name);
 assert.equal(plan.mode.description,dm.description);
 assert.deepEqual(matchPlan(saved),matchPlan(saved),'the plan is deterministic');
 assert.ok(Object.isFrozen(plan));
});

test('soccer, race and lattice PvP explain their automatic fill instead of promising solo combat',()=>{
 const soccer=matchPlan({mode:'puma-soccer',botCount:0});
 assert.equal(soccer.rosterLabel,'2 v 2');
 assert.equal(soccer.fill.auto,true);
 assert.match(soccer.fill.note,/always filled by bots/);
 const race=matchPlan({mode:'puma-race',botCount:0});
 assert.equal(race.rosterLabel,'SOLO TIME TRIAL');
 assert.equal(race.fill.auto,true);
 assert.match(race.fill.note,/human drivers replace excess bots/);
 assert.match(race.fill.note,/solo time trial/i);
 const cocs=matchPlan({mode:'cocs',botCount:0});
 assert.equal(cocs.rosterLabel,'SOLO OPERATOR');
 assert.equal(cocs.fill.auto,true);
 assert.match(cocs.fill.note,/opposing team stays empty/);
 const filled=matchPlan({mode:'cocs',botCount:7,rung:'4v4'});
 assert.equal(filled.rosterLabel,'4 v 4');
 assert.match(filled.fill.note,/rung to 8 seats/);
 const teams=matchPlan({mode:'teamdeathmatch',botCount:3});
 assert.equal(teams.rosterLabel,'2 v 2','team seats read the real alternating split');
});

test('operations plan mirrors allied fill, Director garrison, waves and tier',()=>{
 const plan=matchPlan({mode:'cocs-coop',botCount:3});
 assert.equal(plan.coop,true);
 assert.equal(plan.tier.id,DEFAULT_COCS_TIER,'new players default to the tutorial tier');
 assert.equal(plan.tier.label,'STANDARD');
 assert.deepEqual(plan.tier.modifiers,['1 FRONT','NO MODIFIER']);
 assert.equal(plan.roster.allies,COOP_TEAM_FLOOR);
 assert.equal(plan.roster.garrisonBots,0);
 assert.equal(plan.waves.count,OPERATIONS_WAVE_COUNT);
 assert.match(plan.fill.note,new RegExp(`${COOP_TEAM_FLOOR}-operator floor`));
 assert.match(plan.fill.note,new RegExp(`${OPERATIONS_WAVE_COUNT}-wave`));
 const five=matchPlan({mode:'cocs-coop',botCount:5});
 assert.equal(five.roster.allies,4);
 assert.equal(five.roster.garrisonBots,COOP_GARRISON_BOTS);
 assert.equal(five.roster.alliedBots+five.roster.garrisonBots,5,'every bot seat is either an ally or the garrison');
 const seven=matchPlan({mode:'cocs-coop',botCount:7});
 assert.equal(seven.roster.allies,6);
 assert.equal(seven.roster.garrisonBots,2);
 // The pure helper matches real Match seating for every local bot count, so
 // the setup copy cannot drift from core.mjs seatTeam.
 for(const bots of [0,1,2,3,4,5,7]){
  const match=new Match('chatgpt','hermes',()=>.5,'lattice-slice',{mode:'cocs-coop',botCount:bots,timeLimit:900});
  const roster=coopRoster({humans:1,bots});
  assert.equal(match.actors.filter(actor=>actor.team===0).length,roster.allies,`team 0 at ${bots} bot seats`);
  assert.equal(match.actors.filter(actor=>actor.team===1).length,roster.garrisonBots,`garrison at ${bots} bot seats`);
 }
 assert.match(coopWaveSummary('D1').copy,/^5 WAVES · 1–2 FRONTS · 2:00–3:00$/);
 assert.ok(coopWaveSummary('D4').frontMax>coopWaveSummary('D1').frontMax);
 assert.ok(coopWaveSummary('D4').timerMax<coopWaveSummary('D1').timerMax,'higher tiers compress the wave clock');
});

test('the Director tier reads config.objective.tier with the legacy coopTier fallback',()=>{
 assert.equal(configuredDirectorTier({}),DEFAULT_COCS_TIER);
 assert.equal(configuredDirectorTier({objective:{tier:'d3'}}),'D3');
 assert.equal(configuredDirectorTier({coopTier:'D2'}),'D2');
 assert.equal(configuredDirectorTier({objective:{tier:'nope'}}),DEFAULT_COCS_TIER,'unknown tiers fall back');
 assert.equal(configuredDirectorTier({objective:{tier:'d4'},coopTier:'D1'}),'D4','the engine seam wins over the legacy fallback');
 const normalized=normalizeConfig({mode:'cocs-coop',objective:{tier:'d4',holdCount:3}});
 assert.equal(normalized.objective.tier,'D4');
 assert.equal(normalized.objective.holdCount,3,'unrelated objective overrides survive');
 assert.equal(normalizeConfig({mode:'cocs-coop',coopTier:'d2'}).objective.tier,'D2');
 assert.equal(normalizeConfig({mode:'cocs-coop'}).objective,undefined,'no override key when the saved config had none');
 assert.equal(normalizeConfig({mode:'cocs'}).objective,undefined,'PvPvE stays untouched');
 const match=new Match('chatgpt','hermes',()=>.5,'lattice-slice',{mode:'cocs-coop',botCount:3,timeLimit:900,objective:{tier:'D3'}});
 assert.equal(match.objectiveState.coopTier,'D3','the engine launches the tier the UI showed');
 assert.equal(matchPlan({mode:'cocs-coop',objective:{tier:'d3'}}).tier.id,'D3');
});

test('quick-start composition keeps saved rules, activity defaults and explicit overrides in order',()=>{
 const saved=normalizeConfig({...DEFAULT_CONFIG,mutators:['instagib','turbo'],botCount:4,objective:{tier:'D4'}});
 const activity=quickStartRules(saved,'cocs',{botCount:7,timeLimit:900,difficulty:'normal',rung:'4v4'});
 assert.equal(activity.mode,'cocs');
 assert.equal(activity.botCount,7,'activity defaults beat the saved roster');
 assert.equal(activity.timeLimit,900);
 assert.equal(activity.rung,'4v4');
 assert.equal(activity.instagib,true,'a plain quick start inherits saved modifiers');
 assert.deepEqual(matchPlan(activity).modifiers.map(entry=>entry.id),['turbo','instagib']);
 const overridden=quickStartRules(saved,'cocs',{botCount:7},{botCount:3,difficulty:'hard'});
 assert.equal(overridden.botCount,3,'explicit overrides beat activity defaults');
 assert.equal(overridden.difficulty,'hard');
 // The recommended beginner route rebuilds from the frozen default instead of
 // spreading saved rules: no saved mutator or Director tier can leak in.
 const beginner=normalizeConfig({...DEFAULT_CONFIG,playerName:saved.playerName});
 assert.deepEqual(beginner,matchPlan(beginner).rules);
 assert.equal(beginner.mutators.length,0);
 assert.equal(beginner.objective,undefined);
 assert.equal(beginner.botCount,DEFAULT_CONFIG.botCount);
 assert.equal(beginner.difficulty,DEFAULT_CONFIG.difficulty);
 assert.equal(beginner.instagib,false);
 assert.equal(matchPlan(beginner).modifierLabel,'NO MODIFIERS');
 assert.equal(mutatorView(beginner).length,0);
});
