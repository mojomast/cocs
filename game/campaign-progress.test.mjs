import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGN_MISSIONS,missionFor} from './campaign-data.mjs';
import {CAMPAIGN_STORAGE_KEY,CAMPAIGN_PROGRESS_VERSION,defaultCampaignProgress,normalizeCampaignProgress,isMissionUnlocked,firstIncompleteMission,nextMissionId,missionIndex,recordMission,isMissionComplete,setCheckpoint,checkpointFor,clearCheckpoint,campaignMissionPar,missionEnemyBudget,missionScoreTarget,missionStars,missionMedal,missionReward,missionProgress,campaignStarTotal,campaignMedalCounts,campaignRewardTotal} from './campaign-progress.mjs';

test('default and normalized campaign progress are stable',()=>{
 const base=defaultCampaignProgress();
 assert.equal(base.version,CAMPAIGN_PROGRESS_VERSION);
 assert.deepEqual(base.completed,{});
 assert.equal(base.checkpoint,null);
 const normalized=normalizeCampaignProgress(null);
 assert.deepEqual(normalized.completed,{});
 assert.equal(normalized.checkpoint,null);
});

test('normalization ignores unknown missions and corrupt entries',()=>{
 const progress=normalizeCampaignProgress({completed:{'convoy-run':{won:true,wins:2,bestTime:120},bogus:{won:true}},checkpoint:{missionId:'nope',step:3}});
 assert.ok(progress.completed['convoy-run']);
 assert.equal(progress.completed.bogus,undefined);
 assert.equal(progress.checkpoint,null);
});

test('missions unlock sequentially in campaign order',()=>{
 const progress=defaultCampaignProgress();
 const order=CAMPAIGN_MISSIONS.map(m=>m.id);
 assert.equal(isMissionUnlocked(progress,order[0]),true);
 if(order.length>1)assert.equal(isMissionUnlocked(progress,order[1]),false);
 const after=recordMission(progress,{id:order[0],won:true,time:90,score:4});
 if(order.length>1)assert.equal(isMissionUnlocked(after,order[1]),true);
 if(order.length>2)assert.equal(isMissionUnlocked(after,order[2]),false);
 assert.equal(firstIncompleteMission(after),order.length>1?order[1]:order[0]);
 assert.equal(nextMissionId(after),order.length>1?order[1]:null);
 let full=defaultCampaignProgress();
 for(const id of order)full=recordMission(full,{id,won:true,time:60,score:1});
 assert.equal(nextMissionId(full),null,'a finished campaign has no next mission');
});

test('recording a mission keeps the best time and score',()=>{
 const order=CAMPAIGN_MISSIONS.map(m=>m.id);
 let progress=recordMission(defaultCampaignProgress(),{id:order[0],won:true,time:120,score:5});
 progress=recordMission(progress,{id:order[0],won:true,time:80,score:8});
 progress=recordMission(progress,{id:order[0],won:true,time:200,score:3});
 const entry=progress.completed[order[0]];
 assert.equal(entry.wins,3);
 assert.equal(entry.bestTime,80);
 assert.equal(entry.bestScore,8);
 assert.equal(recordMission(progress,{id:'nope',won:true}),progress);
 assert.ok(CAMPAIGN_STORAGE_KEY.length>0);
});

test('checkpoints round-trip for real missions only',()=>{
 const order=CAMPAIGN_MISSIONS.map(m=>m.id);
 const progress=setCheckpoint(defaultCampaignProgress(),order[0],2);
 assert.deepEqual(progress.checkpoint,{missionId:order[0],step:2});
 assert.equal(setCheckpoint(progress,'bogus',1).checkpoint.missionId,order[0]);
 assert.equal(missionIndex(order[0]),0);
});

test('checkpointFor resolves a mission resume step and clears cleanly',()=>{
 const order=CAMPAIGN_MISSIONS.map(m=>m.id);
 let progress=setCheckpoint(defaultCampaignProgress(),order[0],4);
 assert.equal(checkpointFor(progress,order[0]),4);
 assert.equal(checkpointFor(progress,'nope'),null);
 assert.equal(checkpointFor(defaultCampaignProgress(),order[0]),null);
 const cleared=clearCheckpoint(progress);
 assert.equal(cleared.checkpoint,null);
 assert.equal(checkpointFor(cleared,order[0]),null);
 assert.equal(clearCheckpoint(cleared),cleared,'clearing with no checkpoint is a no-op');
});

test('mission thresholds are deterministic functions of the authored mission',()=>{
 for(const mission of CAMPAIGN_MISSIONS){
  const par=campaignMissionPar(mission),budget=missionEnemyBudget(mission),target=missionScoreTarget(mission);
  assert.ok(Number.isFinite(par)&&par>0,`${mission.id} par`);
  assert.ok(Number.isInteger(budget)&&budget>0,`${mission.id} has authored enemies`);
  assert.ok(target>=1&&target<=budget,`${mission.id} score target sits inside its budget`);
  assert.equal(missionScoreTarget(mission),missionScoreTarget(mission),'stable across calls');
 }
 assert.equal(campaignMissionPar(undefined),120,'an unknown mission has a floor par');
});

test('stars and medals resolve from time, score and completion thresholds',()=>{
 assert.equal(missionStars(missionFor('convoy-run'),null),0,'no entry means no stars');
 assert.equal(missionMedal(missionFor('convoy-run'),null),null);
 assert.equal(missionReward(missionFor('convoy-run'),null),null);
 assert.equal(missionProgress(defaultCampaignProgress(),'nope'),null);
 const mission=missionFor('convoy-run'),par=campaignMissionPar(mission),target=missionScoreTarget(mission);
 // Completion alone is a bronze.
 assert.equal(missionStars(mission,{bestTime:par*3,bestScore:0}),1);
 assert.equal(missionMedal(mission,{bestTime:par*3,bestScore:0}),'BRONZE');
 // A strong result on either stat earns silver.
 assert.equal(missionStars(mission,{bestTime:par*1.2,bestScore:0}),2,'fast time alone is silver');
 assert.equal(missionStars(mission,{bestTime:par*3,bestScore:target*2}),2,'score alone is silver');
 // Gold needs both.
 assert.equal(missionStars(mission,{bestTime:par*.5,bestScore:target}),3);
 assert.equal(missionMedal(mission,{bestTime:par*.5,bestScore:target}),'GOLD');
 const reward=missionReward(mission,{bestTime:par*.5,bestScore:target});
 assert.equal(reward.missionId,mission.id);
 assert.equal(reward.stars,3);
 assert.equal(reward.medal,'GOLD');
 assert.ok(reward.xp>0&&reward.emblem.endsWith('-3'));
});

test('campaign totals aggregate stars, medals and rewards from stored results',()=>{
 const order=CAMPAIGN_MISSIONS.map(mission=>mission.id);
 assert.equal(campaignStarTotal(defaultCampaignProgress()),0);
 assert.deepEqual(campaignMedalCounts(defaultCampaignProgress()),{GOLD:0,SILVER:0,BRONZE:0});
 assert.equal(campaignRewardTotal(defaultCampaignProgress()),0);
 let progress=defaultCampaignProgress();
 for(const id of order)progress=recordMission(progress,{id,won:true,time:campaignMissionPar(missionFor(id))*.5,score:missionScoreTarget(missionFor(id))});
 assert.equal(campaignStarTotal(progress),order.length*3);
 assert.deepEqual(campaignMedalCounts(progress),{GOLD:order.length,SILVER:0,BRONZE:0});
 assert.ok(campaignRewardTotal(progress)>0);
 const view=missionProgress(progress,order[0]);
 assert.equal(view.completed,true);
 assert.equal(view.stars,3);
 assert.equal(view.medal,'GOLD');
 assert.equal(view.scoreTarget,missionScoreTarget(missionFor(order[0])));
 assert.ok(view.reward.xp>0);
});

test('match config preserves a validated campaign checkpoint step',async()=>{
 const {normalizeConfig}=await import('./config.mjs');
 assert.equal(normalizeConfig({mode:'campaign',checkpoint:3}).checkpoint,3);
 assert.equal(normalizeConfig({mode:'campaign',checkpoint:null}).checkpoint,null);
 assert.equal(normalizeConfig({mode:'campaign'}).checkpoint,null);
 assert.equal(normalizeConfig({mode:'campaign',checkpoint:-5}).checkpoint,null);
 assert.equal(normalizeConfig({mode:'campaign',checkpoint:'4.6'}).checkpoint,5);
});

test('a recorded win survives a save/load round-trip',()=>{
 const order=CAMPAIGN_MISSIONS.map(m=>m.id);
 let progress=recordMission(defaultCampaignProgress(),{id:order[0],won:true,time:90,score:4});
 const reloaded=normalizeCampaignProgress(JSON.parse(JSON.stringify(progress)));
 assert.ok(reloaded.completed[order[0]],'a recorded win is not dropped on reload');
 assert.equal(reloaded.completed[order[0]].wins,1);
 assert.equal(reloaded.completed[order[0]].bestTime,90);
 assert.equal(nextMissionId(reloaded),order.length>1?order[1]:null);
 if(order.length>1)assert.equal(isMissionUnlocked(reloaded,order[1]),true,'reload keeps unlocking the next mission');
});

test('losses count as attempts without completing or unlocking',()=>{
 const order=CAMPAIGN_MISSIONS.map(m=>m.id);
 let progress=recordMission(defaultCampaignProgress(),{id:order[0],won:false});
 assert.equal(progress.completed[order[0]].attempts,1);
 assert.equal(progress.completed[order[0]].wins,0);
 assert.equal(isMissionComplete(progress.completed[order[0]]),false);
 assert.equal(campaignStarTotal(progress),0,'a loss earns no stars');
 assert.equal(missionProgress(progress,order[0]).completed,false);
 assert.equal(nextMissionId(progress),order[0],'the lost mission is still the next one');
 if(order.length>1)assert.equal(isMissionUnlocked(progress,order[1]),false,'a loss does not unlock the next mission');
 progress=recordMission(progress,{id:order[0],won:false,time:5,score:99});
 assert.equal(progress.completed[order[0]].attempts,2);
 assert.equal(progress.completed[order[0]].bestTime,null,'a loss never sets a best time');
 progress=recordMission(progress,{id:order[0],won:true,time:50,score:2});
 assert.equal(progress.completed[order[0]].wins,1);
 assert.equal(progress.completed[order[0]].attempts,3);
 if(order.length>1)assert.equal(isMissionUnlocked(progress,order[1]),true);
});
