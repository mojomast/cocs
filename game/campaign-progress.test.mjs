import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGN_MISSIONS} from './campaign-data.mjs';
import {CAMPAIGN_STORAGE_KEY,CAMPAIGN_PROGRESS_VERSION,defaultCampaignProgress,normalizeCampaignProgress,isMissionUnlocked,firstIncompleteMission,nextMissionId,missionIndex,recordMission,setCheckpoint} from './campaign-progress.mjs';

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
 assert.equal(nextMissionId(after),order.length>2?order[1]:null);
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
