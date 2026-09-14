import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGE_COUNT,
  CHALLENGE_POOL,
  applyMatch,
  challengeMatches,
  challengeStatus,
  completedChallenges,
  currentDaySeed,
  dailyChallenges,
  daySeedFor,
  metricsFor,
  normalizeChallengeState,
} from './challenges.mjs';

// A match result that only advances the "play matches" objective, so reward
// accounting can be observed in isolation.
const matchOnly = {mode: '__none__', actor: {frags: 0, scoreStats: {}}};

const playDay = () => {
  for (let day = 0; day < 500; day++) if (dailyChallenges(day).some(c => c.id === 'play-matches')) return day;
  throw new Error('no rotation contained play-matches');
};

test('dailyChallenges is deterministic and returns three distinct objectives', () => {
  const first = dailyChallenges(12345);
  const again = dailyChallenges(12345);
  assert.deepEqual(first, again);
  assert.equal(first.length, CHALLENGE_COUNT);
  assert.equal(new Set(first.map(c => c.id)).size, CHALLENGE_COUNT);
  for (const challenge of first) {
    assert.equal(typeof challenge.id, 'string');
    assert.equal(typeof challenge.label, 'string');
    assert.ok(challenge.label.length > 0);
    assert.ok(challenge.target > 0);
    assert.ok(challenge.reward > 0);
    assert.doesNotMatch(challenge.label, /\{target\}/);
  }
  const other = dailyChallenges(999);
  assert.notDeepEqual(first.map(c => c.id), other.map(c => c.id));
  assert.ok(CHALLENGE_POOL.length >= CHALLENGE_COUNT);
});

test('day seeds are stable per day and normalize strings/numbers', () => {
  assert.equal(daySeedFor(new Date('2024-03-01T12:00:00Z')), daySeedFor(new Date('2024-03-01T23:59:59Z')));
  assert.notEqual(daySeedFor(new Date('2024-03-01T12:00:00Z')), daySeedFor(new Date('2024-03-02T12:00:00Z')));
  assert.equal(typeof currentDaySeed(), 'number');
  assert.equal(typeof dailyChallenges('seed-text')[0].id, 'string');
});

test('metricsFor extracts career counters from a match result', () => {
  const metrics = metricsFor({win: true, bestStreak: 7, actor: {frags: 12, deaths: 3, streak: 4, scoreStats: {captures: 2, flagReturns: 1, objectiveCaptures: 3, objectiveTime: 42}}});
  assert.deepEqual(metrics, {matches: 1, wins: 1, kills: 12, deaths: 3, captures: 2, flagReturns: 1, objectiveCaptures: 3, objectiveTime: 42, bestStreak: 7});
  assert.equal(metricsFor({}).matches, 1);
  assert.equal(metricsFor({actor: {frags: -5}}).kills, 0);
  assert.equal(metricsFor({actor: {streak: 4}}).bestStreak, 4);
});

test('applyMatch advances counters and grants bonus XP exactly once', () => {
  const day = playDay();
  const state = normalizeChallengeState(null, day);
  const play = dailyChallenges(day).find(c => c.id === 'play-matches');
  let current = state, gainedTotal = 0;
  for (let i = 1; i <= play.target; i++) {
    const result = applyMatch(current, matchOnly);
    current = result.state;
    gainedTotal += result.gained;
    assert.equal(current.progress[play.id], i);
    if (i < play.target) {
      assert.equal(result.completed.some(c => c.id === play.id), false);
      assert.equal(result.gained, 0);
    } else {
      assert.equal(result.completed.some(c => c.id === play.id), true);
      assert.equal(result.gained, play.reward);
    }
  }
  assert.equal(gainedTotal, play.reward);
  const after = applyMatch(current, matchOnly);
  assert.equal(after.gained, 0, 'a completed objective never pays out twice');
  assert.equal(after.state.done[play.id], true);
});

test('mode and team gates limit which matches count', () => {
  const winDeathmatch = CHALLENGE_POOL.find(c => c.id === 'win-deathmatches');
  assert.equal(challengeMatches(winDeathmatch, {mode: 'deathmatch'}), true);
  assert.equal(challengeMatches(winDeathmatch, {mode: 'ctf'}), false);
  const teamChallenge = CHALLENGE_POOL.find(c => c.id === 'win-team-matches');
  assert.equal(challengeMatches(teamChallenge, {mode: 'ctf', team: true}), true);
  assert.equal(challengeMatches(teamChallenge, {mode: 'ctf', team: false}), false);
});

test('normalizeChallengeState rolls the objectives when the day changes', () => {
  const state = normalizeChallengeState(null, 10);
  const firstId = Object.keys(state.progress)[0];
  state.progress[firstId] = 5;
  const same = normalizeChallengeState(state, 10);
  assert.equal(same.progress[firstId], 5);
  const rolled = normalizeChallengeState(state, 11);
  assert.equal(rolled.daySeed, 11);
  assert.equal(Object.values(rolled.progress).every(value => value === 0), true);
  assert.equal(Object.values(rolled.done).every(value => value === false), true);
});

test('challengeStatus and completedChallenges summarize progress', () => {
  const day = playDay();
  const play = dailyChallenges(day).find(c => c.id === 'play-matches');
  let state = normalizeChallengeState(null, day);
  for (let i = 0; i < play.target; i++) state = applyMatch(state, matchOnly).state;
  const status = challengeStatus(state);
  assert.equal(status.length, CHALLENGE_COUNT);
  const entry = status.find(c => c.id === play.id);
  assert.equal(entry.done, true);
  assert.equal(entry.progress, play.target);
  assert.ok(status.every(c => c.progress <= c.target));
  assert.equal(completedChallenges(state).some(c => c.id === play.id), true);
});
