import test from 'node:test';
import assert from 'node:assert/strict';
import {demoBroadcast, formatClock} from './broadcast.mjs';

const actor = (id, name, frags = 0, team = 0) => ({id, name, frags, team, health: 100, weapon: 0, ammo: {0: 0}, scoreStats: {}});

test('formatClock renders a two-part match clock', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(65), '01:05');
  assert.equal(formatClock(-4), '00:00');
});

test('free-for-all broadcast reports the leader, target and clock', () => {
  const snap = {config: {mode: 'deathmatch', fragLimit: 15, timeLimit: 300, botCount: 4}, time: 60, actors: [actor(0, 'ChatGPT', 7), actor(1, 'Grok', 3)]};
  const data = demoBroadcast(snap, {modeName: 'Deathmatch', mapName: 'The Exchange'});
  assert.equal(data.kind, 'ffa');
  assert.equal(data.modeName, 'Deathmatch');
  assert.equal(data.mapName, 'The Exchange');
  assert.equal(data.leader.name, 'ChatGPT');
  assert.equal(data.leader.frags, 7);
  assert.equal(data.clock, '04:00');
  assert.equal(data.metrics.length, 4);
  assert.ok(data.headline.length > 0, 'a headline is present');
  assert.ok(data.ticker.length > 0, 'the ticker has facts');
  assert.equal(data.teams, null);
});

test('team broadcast surfaces both team scores', () => {
  const snap = {config: {mode: 'ctf', fragLimit: 3, timeLimit: 300}, time: 120, teamScores: {0: 1, 1: 2}, actors: [actor(0, 'Claude', 4, 0), actor(1, 'Gemini', 6, 1)], flags: [{team: 0, state: 'at-base'}, {team: 1, state: 'carried', carrier: 1}]};
  const data = demoBroadcast(snap);
  assert.equal(data.kind, 'team');
  assert.deepEqual(data.teams, [{team: 0, name: 'RED', score: 1}, {team: 1, name: 'BLUE', score: 2}]);
  assert.deepEqual(data.metrics.slice(0, 2).map(metric => metric.value), ['1', '2']);
});

test('race broadcast reports the front runner, lap and gates', () => {
  const snap = {config: {mode: 'puma-race', fragLimit: 3, timeLimit: 120}, time: 30, actors: [actor(0, 'Grok'), actor(1, 'Kimi')], race: {phase: 'racing', laps: 3, gates: [1, 2, 3, 4], standings: [{actorId: 1, position: 1, lap: 2}, {actorId: 0, position: 2, lap: 1}]}};
  const data = demoBroadcast(snap);
  assert.equal(data.kind, 'race');
  assert.equal(data.metrics[0].value, 'Kimi');
  assert.equal(data.metrics[1].value, '2 / 3');
  assert.equal(data.metrics[2].value, '4');
});

test('soccer broadcast reports both goals and the phase', () => {
  const snap = {config: {mode: 'puma-soccer', fragLimit: 5, timeLimit: 90}, time: 45, teamScores: {0: 2, 1: 1}, actors: [actor(0, 'Mistral', 0, 0), actor(1, 'Qwen', 0, 1)], race: {kind: 'soccer', phase: 'playing', elapsed: 45, scores: {0: 2, 1: 1}, goalLimit: 5}};
  const data = demoBroadcast(snap);
  assert.equal(data.kind, 'soccer');
  assert.deepEqual(data.metrics.slice(0, 2).map(metric => metric.value), ['2', '1']);
  assert.equal(data.metrics[2].value, 'PLAYING');
});

test('broadcast tolerates an empty snapshot without throwing', () => {
  const data = demoBroadcast({});
  assert.equal(data.live, true);
  assert.equal(data.operatorCount, 0);
  assert.ok(data.metrics.length > 0);
  assert.ok(data.headline.length > 0);
});
