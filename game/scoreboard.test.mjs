import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {renderScoreboard} from './scoreboard.mjs';
import {PUMA_PITCH} from './soccer-maps.mjs';

test('Lattice scoreboard shows real kills once and readable objective contribution',()=>{
 for(const mode of ['cocs','cocs-coop']){
  const html=renderToStaticMarkup(renderScoreboard({config:{mode},actorId:0,teamScores:{0:12.000000000001,1:4},actors:[{id:0,name:'Scout',team:0,frags:7,deaths:2,scoreStats:{objectiveCaptures:3,objectiveTime:20.000000000001}}]}));
  assert.match(html,/>KILLS</);
  assert.doesNotMatch(html,/>FRAGS</,'no redundant column backed by a missing score statistic');
  assert.match(html,/<strong role="cell">7<\/strong>/);
  assert.match(html,/>20s</);
  assert.doesNotMatch(html,/20\.0|000000/);
 }
});

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

import {scoreboardGroups,streakLabel,pingLabel,actorKitChip,stampLocalPing} from './scoreboard.mjs';

test('the client-measured RTT is stamped onto the local scoreboard row only',()=>{
 const source={config:{mode:'deathmatch'},actorId:1,actors:[{id:0,name:'A',ping:30},{id:1,name:'B'}]};
 const stamped=stampLocalPing(source,1,42);
 assert.equal(stamped.actors.find(a=>a.id===1).ping,42,'the local row carries the measured RTT');
 assert.equal(stamped.actors.find(a=>a.id===0).ping,30,'other rows keep the server value');
 assert.equal(source.actors[1].ping,undefined,'the source snapshot is never mutated');
 assert.equal(source.actors.length,stamped.actors.length);
 assert.equal(stampLocalPing(source,1,null),source,'no measurement leaves the snapshot untouched');
 assert.equal(stampLocalPing(source,1,undefined),source);
 assert.equal(stampLocalPing(source,1,-5),source,'a negative measurement is not a ping');
 assert.equal(stampLocalPing(source,null,42),source,'a spectator has no local row to stamp');
 assert.equal(stampLocalPing(source,9,42),source,'an absent local actor is never invented');
 const server={config:{mode:'deathmatch'},actorId:1,actors:[{id:1,name:'B',ping:80}]};
 assert.equal(stampLocalPing(server,1,42),server,'a server-reported value wins');
 const html=renderToStaticMarkup(renderScoreboard(stamped));
 assert.match(html,/<span role="cell" class="ping ping-good">42<\/span>/,'the measured ping renders in the PING column');
});

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

test('the scoreboard is one ARIA table with headers, cells and a marked local row', () => {
  const source = {config: {mode: 'teamdeathmatch'}, actorId: 1, teamScores: {0: 3, 1: 5}, actors: [
    {id: 0, name: 'A', team: 0, frags: 2, deaths: 1, ping: 30},
    {id: 1, name: 'B', team: 1, frags: 6, deaths: 0, ping: 42},
  ]};
  const html = renderToStaticMarkup(renderScoreboard(source));
  assert.match(html, /role="table" aria-label="teamdeathmatch standings"/, 'the root is the table and keeps its label');
  assert.doesNotMatch(html, /role="rowgroup"/, 'no rowgroup wrapper may break the direct-child .score-row CSS');
  assert.match(html, /<div class="score-row labels" role="row">/, 'the header row keeps its class, order and row role');
  assert.match(html, /<span role="columnheader">OPERATOR<\/span>/);
  assert.match(html, /<strong role="columnheader">KILLS<\/strong>/);
  assert.match(html, /<span role="columnheader">DEATHS<\/span>/);
  assert.match(html, /<span role="columnheader">STREAK<\/span>/);
  assert.match(html, /<span role="columnheader">PING<\/span>/);
  assert.match(html, /<strong role="cell">6<\/strong>/, 'frag totals are data cells');
  assert.match(html, /<span role="rowheader"><b>01<\/b><i><\/i>B<small aria-hidden="true">YOU<\/small>/, 'the operator cell is the row header and keeps its order');
  assert.match(html, /<div class="score-row you team-1" role="row" aria-current="true">/, 'the local row keeps its classes and gains aria-current');
  assert.match(html, /<small aria-hidden="true">YOU<\/small><span class="sr-only">YOU<\/span>/, 'the visible YOU yields to one screen-reader label');
  assert.match(html, /<strong role="rowheader">BLUE<\/strong><span role="cell">5<\/span>/, 'the team heading is a row, not an orphan div');
  assert.match(html, /style="--score-columns:4;--score-width:492px"/, 'the pinned inline geometry vars survive');
  assert.match(html, /class="scoreboard mode-scoreboard mode-scoreboard-teamdeathmatch"/, 'the class list and order survive');

  const history = renderToStaticMarkup(renderScoreboard(source, true));
  assert.doesNotMatch(history, /aria-current/, 'a history table never claims a local row');
  assert.doesNotMatch(history, /sr-only/, 'and never fabricates the YOU marker');
});

test('the free-for-all table keeps one group and the same table semantics', () => {
  const html = renderToStaticMarkup(renderScoreboard({config: {mode: 'deathmatch'}, actorId: 0, actors: [
    {id: 0, name: 'A', frags: 1, deaths: 2},
    {id: 1, name: 'B', frags: 5, deaths: 0},
  ]}));
  assert.match(html, /role="table"/);
  assert.match(html, /<div class="score-row you " role="row" aria-current="true">/, 'the local FFA row is marked');
  assert.match(html, /<span role="rowheader">/, 'every row exposes its operator as the row header');
  assert.match(html, /<strong role="cell">5<\/strong>/, 'FFA sort and frag rendering are untouched');
});
