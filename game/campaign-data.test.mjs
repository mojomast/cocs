import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGN_MISSIONS,campaignOrder,missionFor,CAMPAIGN_MISSION_IDS} from './campaign-data.mjs';
import {getMap} from './maps.mjs';
import {arenaSupportsMode} from './arenas.mjs';
import {ENEMY_TYPE_IDS} from './enemy-types.mjs';

test('campaign missions are frozen, uniquely identified and ordered',()=>{
 assert.ok(CAMPAIGN_MISSIONS.length>=2);
 assert.equal(new Set(CAMPAIGN_MISSION_IDS).size,CAMPAIGN_MISSION_IDS.length);
 assert.deepEqual(campaignOrder(),CAMPAIGN_MISSIONS.slice().sort((a,b)=>(a.order??0)-(b.order??0)).map(m=>m.id));
 for(const mission of CAMPAIGN_MISSIONS){
  assert.equal(getMap(mission.mapId).id,mission.mapId,`${mission.id} map exists`);
  assert.ok(arenaSupportsMode(mission.mapId,'campaign'),`${mission.id} map supports campaign`);
  assert.ok(Number.isFinite(mission.start.x)&&Number.isFinite(mission.start.z),`${mission.id} start`);
  assert.ok(Number.isFinite(mission.start.yaw),`${mission.id} yaw`);
  assert.ok(mission.steps.length>=3,`${mission.id} has a real objective chain`);
  assert.ok(mission.lives>=1);
 }
});

test('campaign steps and encounters are well-formed',()=>{
 const kinds=new Set(['enter-zone','group-dead','boss-dead','timer','hold']);
 for(const mission of CAMPAIGN_MISSIONS){
  const stepIds=new Set();
  for(const step of mission.steps){
   assert.ok(step.id&&step.text,`${mission.id} step id/text`);
   assert.ok(!stepIds.has(step.id),`${mission.id} unique step ${step.id}`);
   stepIds.add(step.id);
   assert.ok(kinds.has(step.complete.kind),`${mission.id}/${step.id} completion kind`);
   if(step.complete.kind==='group-dead')assert.ok(typeof step.complete.group==='string');
   for(const action of [...(step.onStart||[]),...(step.onComplete||[])])if(action.spawn)assert.ok(ENEMY_TYPE_IDS.includes(action.spawn.type)||action.spawn.boss===true,`${mission.id}/${step.id} enemy type`);
  }
 }
});

test('the authored campaign starts on the bigger maps',()=>{
 for(const mission of CAMPAIGN_MISSIONS){
  const bounds=getMap(mission.mapId).bounds;
  const span=bounds?Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ):0;
  assert.ok(span>=100,`${mission.id} uses a large map (${span}m)`);
 }
 assert.equal(missionFor('missing').id,CAMPAIGN_MISSIONS[0].id);
});

test('campaign missions author scripts, barks, boss phases and win conditions',()=>{
 const winKinds=new Set(['eliminate','survive','assassinate','reach','defend']);
 for(const mission of CAMPAIGN_MISSIONS){
  assert.ok(mission.win&&winKinds.has(mission.win.kind),`${mission.id} win condition`);
  assert.ok(Array.isArray(mission.script)&&mission.script.length>0,`${mission.id} has a script`);
  const scriptIds=new Set();
  for(const event of mission.script){
   assert.ok(event.id&&!scriptIds.has(event.id),`${mission.id} unique script id`);
   scriptIds.add(event.id);
   assert.ok(Number.isFinite(event.at)||Number.isFinite(event.after)||typeof event.when==='string',`${mission.id}/${event.id} trigger`);
   if(event.spawn){
    assert.ok(ENEMY_TYPE_IDS.includes(event.spawn.type)||event.spawn.boss===true,`${mission.id}/${event.id} spawn type`);
    assert.ok(Number.isFinite(event.spawn.x)&&Number.isFinite(event.spawn.z),`${mission.id}/${event.id} spawn point`);
   }
   if(event.bark)assert.ok(typeof event.bark.text==='string'&&event.bark.text.length>0,`${mission.id}/${event.id} bark text`);
   if(event.bossPhase!==undefined)assert.ok(Number.isFinite(event.bossPhase)&&event.bossPhase>0,`${mission.id}/${event.id} boss phase`);
   if(typeof event.when==='string'&&event.when.startsWith('boss-hp:'))assert.match(event.when,/^boss-hp:\d+(?:\.\d+)?$/);
  }
 }
 const convoy=missionFor('convoy-run');
 assert.ok(convoy.script.some(event=>Number.isFinite(event.at)&&event.bark),'timed barked reinforcement');
 assert.ok(convoy.script.some(event=>event.when==='cleared'||event.when==='player-in-zone'),'conditional ambush');
 assert.ok(convoy.script.some(event=>typeof event.when==='string'&&event.when.startsWith('boss-hp:')&&Number.isFinite(event.bossPhase)),'boss phase beats');
 assert.equal(convoy.win.kind,'reach');
 const reactor=missionFor('reactor-run');
 assert.equal(reactor.win.kind,'reach','the reactor falls back to a cleared exit volume');
 assert.equal(reactor.win.requireCleared,true,'the reactor exit only counts once the route is cleared');
 assert.ok(reactor.script.some(event=>typeof event.when==='string'&&event.when.startsWith('boss-hp:')),'warden phases');
});

test('the third mission is a checkpointed throne finale with named boss phases',()=>{
 const mission=missionFor('throne-siege');
 assert.equal(mission.mapId,'throne');
 assert.equal(mission.win.kind,'defend');
 assert.ok(Number.isFinite(mission.win.seconds)&&mission.win.seconds>0,'the finale has a hold window');
 assert.ok(mission.steps.some(step=>step.complete.kind==='hold'),'the finale is a hold objective');
 const spawns=mission.steps.flatMap(step=>[...(step.onStart||[]),...(step.onComplete||[])]).filter(action=>action.spawn).map(action=>action.spawn.type);
 assert.ok(spawns.includes('warden'),'the finale has a Warden set-piece');
 assert.ok(spawns.includes('bulwark')&&spawns.includes('mortar'),'the finale fields the new tank and artillery classes');
 const actions=[...(mission.script||[]),...mission.steps.flatMap(step=>[...(step.onStart||[]),...(step.onComplete||[])])];
 assert.ok(actions.some(action=>action.checkpoint),'the finale banks a checkpoint');
 assert.ok(mission.script.some(event=>event.when==='boss-hp:0.6'&&Number.isFinite(event.bossPhase)&&event.name),'named phase two');
 assert.ok(mission.script.some(event=>event.when==='boss-hp:0.25'&&Number.isFinite(event.bossPhase)&&event.name),'named phase three');
 assert.ok(!mission.script.some(event=>event.spawn),'the finale predeploys reinforcements instead of live script spawns');
 assert.ok(mission.script.some(event=>event.when==='boss-hp:0.6'&&event.bark),'the finale script barks on its phase beat');
});

test('campaign missions author checkpoints and named boss phases',()=>{
 for(const mission of CAMPAIGN_MISSIONS){
  const actions=[...(mission.script||[]),...mission.steps.flatMap(step=>[...(step.onStart||[]),...(step.onComplete||[])])];
  assert.ok(actions.some(action=>action.checkpoint),`${mission.id} has a resumable checkpoint`);
  for(const event of mission.script)if(event.bossPhase!==undefined){
   assert.ok(typeof event.name==='string'&&event.name.length>0,`${mission.id}/${event.id} names its boss phase`);
  }
 }
 const named=CAMPAIGN_MISSIONS.flatMap(mission=>mission.script).filter(event=>event.bossPhase!==undefined&&event.name);
 assert.ok(named.length>=2,'boss phases carry presentation names');
});

test('the campaign fields five missions with distinct tags and verbs',()=>{
 assert.equal(CAMPAIGN_MISSIONS.length,5);
 for(const id of ['convoy-run','reactor-run','throne-siege','ghost-wire','crown-duel'])assert.ok(CAMPAIGN_MISSION_IDS.includes(id),`${id} exists`);
 const tags=CAMPAIGN_MISSIONS.map(mission=>mission.tag);
 assert.equal(new Set(tags).size,tags.length,'every mission has a distinct tag');
 const kinds=new Set(CAMPAIGN_MISSIONS.flatMap(mission=>mission.steps.map(step=>step.complete.kind)));
 for(const kind of ['enter-zone','group-dead','hold'])assert.ok(kinds.has(kind),`the campaign uses ${kind} objectives`);
});

test('ghost-wire is a checkpointed stealth mission with a no-kill exfil',()=>{
 const mission=missionFor('ghost-wire');
 assert.equal(mission.mapId,'frost-gate');
 assert.equal(mission.tag,'STEALTH');
 assert.equal(mission.win.kind,'reach');
 assert.equal(mission.win.requireCleared,false,'the exfil does not require clearing the map');
 assert.ok(mission.steps.every(step=>step.complete.kind!=='group-dead'),'stealth steps never require a wipe');
 assert.ok(mission.steps.some(step=>step.complete.kind==='hold'),'the relay splice is a hold');
 const spawns=mission.steps.flatMap(step=>[...(step.onStart||[]),...(step.onComplete||[])]).filter(action=>action.spawn).map(action=>action.spawn.type);
 assert.ok(spawns.includes('lancer'),'the stealth route fields flankers');
 assert.ok(spawns.includes('sentinel'),'the stealth route fields a shield-bearer');
 const actions=[...(mission.script||[]),...mission.steps.flatMap(step=>[...(step.onStart||[]),...(step.onComplete||[])])];
 assert.ok(actions.some(action=>action.checkpoint),'the stealth mission banks a checkpoint');
 assert.ok(mission.script.some(event=>event.bark),'the stealth mission barks guidance');
});

test('crown-duel is a checkpointed Harbinger boss duel with named phases',()=>{
 const mission=missionFor('crown-duel');
 assert.equal(mission.mapId,'fortress');
 assert.equal(mission.tag,'DUEL');
 assert.equal(mission.win.kind,'reach','the duel ends at the cleared exit once the Harbinger falls');
 assert.equal(mission.win.requireCleared,true,'the exit only counts once the Harbinger is down');
 assert.ok(mission.script.some(event=>event.when==='boss-hp:0.65'&&event.bossPhase===2&&event.name),'named phase two');
 assert.ok(mission.script.some(event=>event.when==='boss-hp:0.3'&&event.bossPhase===3&&event.name),'named phase three');
 const spawns=mission.steps.flatMap(step=>[...(step.onStart||[]),...(step.onComplete||[])]).filter(action=>action.spawn).map(action=>action.spawn.type);
 assert.ok(spawns.includes('harbinger'),'the duel fields the new boss');
 assert.ok(spawns.includes('sentinel')&&spawns.includes('lancer'),'the duel fields the new roles');
 const actions=[...(mission.script||[]),...mission.steps.flatMap(step=>[...(step.onStart||[]),...(step.onComplete||[])])];
 assert.ok(actions.some(action=>action.checkpoint),'the duel banks a checkpoint');
 assert.ok(!mission.script.some(event=>event.spawn),'the duel predeploys its adds instead of live script spawns');
 assert.ok(mission.script.some(event=>event.when==='boss-hp:0.65'&&event.bark),'the duel script barks on its phase beats');
});
