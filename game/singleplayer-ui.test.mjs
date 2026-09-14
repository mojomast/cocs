import test from 'node:test';
import assert from 'node:assert/strict';
import {singlePlayerDisplay,singlePlayerResult,singlePlayerSummary,missionBrief} from './singleplayer-ui.mjs';

const horde={config:{mode:'horde'},actors:[{id:0,x:0,z:0}],singleplayer:{kind:'horde',phase:'wave',wave:3,waveTarget:10,waveTimer:0,enemiesAlive:4,enemiesTotal:6,lives:2,kills:9,deaths:1,elapsed:42,objective:'Survive 10 hostile waves.',message:'Second wave through the doors.',winner:null,steps:[]}};
const campaign={
 config:{mode:'campaign'},
 actors:[{id:0,x:10,z:10}],
 singleplayer:{kind:'campaign',phase:'active',enemiesAlive:2,enemiesTotal:4,lives:3,kills:5,deaths:0,elapsed:80,
  objective:'Take the central reactor.',message:'',winner:null,
  story:{speaker:'DISPATCH',text:'Reactor is dead ahead.'},
  waypoint:{id:'reactor',x:40,z:10,label:'REACTOR'},
  steps:[{id:'a',label:'A',text:'Reach the outpost',active:false,done:true},{id:'b',label:'B',text:'Take the reactor',active:true,done:false}],
  hold:{seconds:20,progress:8},
  mission:{id:'reactor-run',name:'Reactor Run',tag:'ASSAULT',chapter:'ACT I',index:1,total:2,brief:'x',intro:{speaker:'DISPATCH',lines:['a']},outro:{speaker:'WARDEN',lines:['b']}},
  boss:{name:'WARDEN',hp:300,maxHp:450,alive:true}},
};

test('horde display adapts waves and enemy counts',()=>{
 const display=singlePlayerDisplay(horde);
 assert.equal(display.horde,true);
 assert.equal(display.title,'HORDE');
 assert.equal(display.enemiesLabel,'4 / 6');
 assert.equal(display.lives,2);
 assert.equal(display.story,null);
 assert.equal(display.waypoint,null);
 assert.equal(singlePlayerDisplay({}),null);
});

test('campaign display surfaces waypoint distance, steps, story and boss',()=>{
 const display=singlePlayerDisplay(campaign);
 assert.equal(display.horde,false);
 assert.equal(display.title,'Reactor Run');
 assert.equal(display.chapter,'ACT I');
 assert.equal(display.stepIndex,1);
 assert.equal(display.stepTotal,2);
 assert.equal(display.waypoint.label,'REACTOR');
 assert.equal(display.waypoint.distance,30);
 assert.equal(display.story.speaker,'DISPATCH');
 assert.equal(display.hold.seconds,20);
 assert.equal(display.boss.name,'WARDEN');
 assert.equal(display.boss.ratio,300/450);
 assert.equal(display.missionLabel,'ACT I 2 / 2');
});

test('results and summaries reflect win or loss',()=>{
 assert.equal(singlePlayerResult(horde),'OVERRUN.');
 assert.equal(singlePlayerResult({...horde,singleplayer:{...horde.singleplayer,winner:0}}),'YOU SURVIVED 10 WAVES.');
 assert.match(singlePlayerResult({...campaign,singleplayer:{...campaign.singleplayer,winner:1}}),/REACTOR RUN FAILED/);
 assert.match(singlePlayerSummary(horde),/2 of 10 waves/);
 assert.match(singlePlayerSummary({...campaign,singleplayer:{...campaign.singleplayer,winner:1}}),/Objective failed/);
 assert.equal(missionBrief(campaign).name,'Reactor Run');
 assert.equal(missionBrief({}),null);
});
