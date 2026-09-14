import test from 'node:test';
import assert from 'node:assert/strict';
import {singlePlayerDisplay,singlePlayerResult,singlePlayerSummary} from './singleplayer-ui.mjs';

const horde={config:{mode:'horde'},singleplayer:{kind:'horde',phase:'wave',wave:3,waveTarget:10,waveTimer:0,enemiesAlive:4,enemiesTotal:6,lives:2,kills:9,deaths:1,elapsed:42,objective:'Survive 10 hostile waves.',message:'Second wave through the doors.',winner:null}};
const campaign={config:{mode:'campaign'},singleplayer:{kind:'campaign',phase:'lost',wave:0,waveTarget:0,waveTimer:0,enemiesAlive:2,enemiesTotal:4,lives:0,kills:5,deaths:2,elapsed:80,objective:'Reach the extraction beacon.',message:'',winner:1,mission:{id:'extraction',name:'Extraction',tag:'ESCORT',index:4,total:6,brief:'x'},boss:{name:'WARDEN',hp:120,maxHp:500,alive:true},defend:{seconds:45,progress:20}}};

test('single-player display adapts horde state',()=>{
 const display=singlePlayerDisplay(horde);
 assert.equal(display.horde,true);
 assert.equal(display.title,'HORDE');
 assert.equal(display.wave,3);
 assert.equal(display.enemiesLabel,'4 / 6');
 assert.equal(display.lives,2);
 assert.equal(display.message,'Second wave through the doors.');
 assert.equal(display.boss,null);
 assert.equal(display.defend,null);
 assert.ok(display.waveProgress>0&&display.waveProgress<1);
});

test('campaign display exposes mission, boss and defend state',()=>{
 const display=singlePlayerDisplay(campaign);
 assert.equal(display.horde,false);
 assert.equal(display.title,'Extraction');
 assert.equal(display.tag,'ESCORT');
 assert.equal(display.missionLabel,'MISSION 5 / 6');
 assert.equal(display.boss.name,'WARDEN');
 assert.equal(display.boss.ratio,.24);
 assert.equal(display.defend.ratio,20/45);
 assert.equal(singlePlayerDisplay({}),null);
});

test('results and summary reflect win or loss',()=>{
 assert.equal(singlePlayerResult(horde),'OVERRUN.');
 assert.equal(singlePlayerResult({...horde,singleplayer:{...horde.singleplayer,winner:0}}),'YOU SURVIVED 10 WAVES.');
 assert.equal(singlePlayerResult(campaign),'EXTRACTION FAILED.');
 assert.match(singlePlayerResult({...campaign,singleplayer:{...campaign.singleplayer,winner:0}}),/EXTRACTION COMPLETE/);
 assert.match(singlePlayerSummary(horde),/2 of 10 waves/);
 assert.match(singlePlayerSummary(campaign),/Objective failed/);
});
