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
