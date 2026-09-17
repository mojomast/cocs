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

import {scoreboardGroups,streakLabel,pingLabel,actorKitChip} from './scoreboard.mjs';

test('scoreboard rows carry a null-safe wing/spec chip',()=>{
 assert.equal(actorKitChip({}),null);
 assert.equal(actorKitChip({character:'mistral'}),null,'a harness is required');
 assert.equal(actorKitChip({harness:'cline'}),null,'a character is required');
 assert.equal(actorKitChip(null),null);
 const chip=actorKitChip({character:'mistral',harness:'cline'});
 assert.equal(chip.wing.id,'striker');
 assert.equal(chip.wing.label,'STRIKER');
 assert.equal(chip.spec.name,'Cline');
 assert.equal(chip.spec.power,'Phase Step');
 assert.equal(actorKitChip({character:'claude',harness:'hermes'}).spec.id,'claudecode','the Claude lock normalises like every loadout path');
 const html=renderToStaticMarkup(renderScoreboard({config:{mode:'deathmatch'},actorId:0,actors:[
  {id:0,name:'Mistral',character:'mistral',harness:'cline',frags:2,deaths:0},
  {id:1,name:'Rookie',frags:1,deaths:1},
 ]}));
 assert.ok(html.includes('STRIKER'),'the wing chip renders');
 assert.ok(html.includes('CLINE'),'the spec chip renders');
 assert.ok(html.includes('Rookie'),'an actor without class data still renders a plain row');
 assert.ok(html.indexOf('wing-striker')>0);
});

test('streak and ping labels bucket values and hide absent data',()=>{
 assert.equal(streakLabel({streak:0}),null);
 assert.equal(streakLabel({streak:-2}),null);
 assert.deepEqual(streakLabel({streak:5}),{streak:5,label:'5'});
 assert.equal(pingLabel({}),null);
 assert.equal(pingLabel({ping:-1}),null);
 assert.deepEqual(pingLabel({ping:42}),{ping:42,quality:'good',label:'42'});
 assert.equal(pingLabel({ping:90}).quality,'fair');
 assert.equal(pingLabel({ping:200}).quality,'poor');
});

test('scoreboardGroups groups team modes and keeps free-for-all in one group',()=>{
 const source={config:{mode:'teamdeathmatch'},teamScores:{0:5,1:9},actorId:1,actors:[
  {id:1,name:'A',team:0,frags:3,deaths:1,streak:2},
  {id:2,name:'B',team:1,frags:7,deaths:0,streak:4,ping:30},
 ]};
 const groups=scoreboardGroups(source);
 assert.equal(groups.length,2);
 assert.equal(groups[0].team,1,'the winning team is first');
 assert.equal(groups[0].actors[0].id,2);
 const ffa=scoreboardGroups({config:{mode:'deathmatch'},actors:[{id:1,frags:1,team:0},{id:2,frags:5,team:1}]});
 assert.equal(ffa.length,1);
 assert.equal(ffa[0].actors[0].id,2,'ffa sorts by frags');
});

test('objective team modes group players by team instead of free-for-all',()=>{
 for(const mode of ['team-elimination','vip-escort','holdout','uplink']){
  const snapshot={config:{mode},actorId:0,teamScores:{0:3,1:2},actors:[{id:0,name:'Claude',team:0,frags:2,scoreStats:{}},{id:1,name:'Grok',team:1,frags:4,scoreStats:{}}]};
  const html=renderToStaticMarkup(renderScoreboard(snapshot));
  assert.ok(html.includes('score-team-heading'),`${mode} renders team groups`);
  assert.ok(html.includes('RED')&&html.includes('BLUE'),`${mode} labels both teams`);
 }
});

test('absent ping and null team are never coerced to healthy values', () => {
  assert.equal(pingLabel({ping: null}), null, 'a null ping hides the column');
  assert.equal(pingLabel({ping: ''}), null, 'an empty ping hides the column');
  const groups = scoreboardGroups({config: {mode: 'teamdeathmatch'}, teamScores: {}, actors: [{id: 1, name: 'A', team: null, frags: 1}]});
  assert.equal(groups.length, 1);
  assert.equal(groups[0].team, null, 'an unassigned actor is not grouped under RED');
  assert.equal(groups[0].label, 'UNASSIGNED');
});
