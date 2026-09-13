import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {renderScoreboard} from './scoreboard.mjs';
import {PUMA_PITCH} from './soccer-maps.mjs';

const soccerSnapshot={
 config:{mode:'puma-soccer'},
 actorId:0,
 actors:[{id:0,name:'ChatGPT'},{id:3,name:'Grok'}],
 race:{kind:'soccer',phase:'playing',elapsed:65,goalLimit:5,scores:{0:2,1:1},standings:[
  {actorId:3,team:1,goals:3,vehicleId:3},
  {actorId:0,team:0,goals:1,vehicleId:0},
 ]},
};

test('soccer scoreboard sorts players by goals, shows teams and marks the local row',()=>{
 const html=renderToStaticMarkup(renderScoreboard(soccerSnapshot));
 assert.ok(html.includes('soccer-standings'));
 for(const name of ['Grok','ChatGPT','BLUE','RED'])assert.ok(html.includes(name),name);
 assert.ok(html.includes('ChatGPT / YOU'));
 assert.ok(html.indexOf('Grok')<html.indexOf('ChatGPT'),'the higher scorer is listed first');
});

test('soccer history keeps names and never labels a player as YOU',()=>{
 const history={...soccerSnapshot,players:[{actorId:3,name:'Grok'},{actorId:0,name:'ChatGPT'}],race:{...soccerSnapshot.race,phase:'over',winnerTeam:1}};
 const html=renderToStaticMarkup(renderScoreboard(history,true));
 assert.ok(html.includes('Grok')&&html.includes('ChatGPT'));
 assert.ok(!html.includes('YOU'));
});

test('the race standings branch still renders alongside the soccer branch',()=>{
 const race={mode:'puma-race',config:{mode:'puma-race'},race:{phase:'racing',laps:3,standings:[{actorId:0,position:1,completedLaps:1,finishTime:null}]},players:[{actorId:0,name:'Driver'}]};
 const html=renderToStaticMarkup(renderScoreboard(race,false));
 assert.ok(html.includes('race-standings'));
 assert.ok(!html.includes('soccer-standings'));
});

test('the soccer pitch map exposes the arena.race contract buildArena reads',()=>{
 assert.equal(PUMA_PITCH.race.kind,'soccer');
 assert.ok(Array.isArray(PUMA_PITCH.race.goals)&&PUMA_PITCH.race.goals.length===2);
 assert.ok(PUMA_PITCH.race.pitch&&Number.isFinite(PUMA_PITCH.race.pitch.minX));
});
