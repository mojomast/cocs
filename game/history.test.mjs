import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_LIMIT,
  emptyHistory,
  historyEntryFromResult,
  historyLeaderboard,
  historyModes,
  historyTotals,
  kdRatio,
  normalizeHistory,
  normalizeHistoryEntry,
  normalizeResult,
  recordMatch,
} from './history.mjs';

const entry = (over = {}) => ({mode: 'deathmatch', result: 'win', kills: 10, deaths: 2, at: 1000, duration: 120, ...over});

test('entries normalize counters, result and the flawless K/D convention', () => {
  const normalized = normalizeHistoryEntry({mode: 'ctf', result: 'WIN', kills: '7.9', deaths: -3, at: '5000', duration: '90'});
  assert.equal(normalized.mode, 'ctf');
  assert.equal(normalized.result, 'win');
  assert.equal(normalized.kills, 7);
  assert.equal(normalized.deaths, 0);
  assert.equal(normalized.at, 5000);
  assert.equal(normalized.kd, 7, 'no deaths reports raw kills');
  assert.equal(kdRatio(9, 3), 3);
  assert.equal(kdRatio(1, 3), 0.33);
  assert.equal(normalizeResult('nope'), 'loss');
  assert.equal(normalizeHistoryEntry({}).mode, 'unknown');
});

test('normalizeHistory keeps newest first and caps the log', () => {
  const entries = [];
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) entries.push(entry({at: i, id: `m${i}`}));
  const history = normalizeHistory({entries});
  assert.equal(history.entries.length, HISTORY_LIMIT);
  assert.equal(history.entries[0].at, HISTORY_LIMIT + 9);
  assert.equal(history.entries.at(-1).at, 10);
  assert.deepEqual(normalizeHistory(null).entries, []);
  assert.deepEqual(emptyHistory().entries, []);
});

test('historyEntryFromResult reads the actor counters and meta', () => {
  const built = historyEntryFromResult(
    {win: true, actor: {frags: 12, deaths: 4, scoreStats: {captures: 2, objectiveTime: 30}}, mapId: 'exchange', time: 240},
    {mode: 'ctf', modeName: 'Capture the Flag', mapId: 'exchange', mapName: 'Exchange', at: 9000, duration: 240}
  );
  assert.equal(built.mode, 'ctf');
  assert.equal(built.result, 'win');
  assert.equal(built.kills, 12);
  assert.equal(built.deaths, 4);
  assert.equal(built.captures, 2);
  assert.equal(built.objectiveTime, 30);
  assert.equal(built.mapName, 'Exchange');
  assert.equal(built.duration, 240);
  assert.equal(built.at, 9000);
  assert.equal(built.kd, 3);
  assert.equal(historyEntryFromResult({win: false, actor: {frags: 1, deaths: 5}}).result, 'loss');
  assert.equal(historyEntryFromResult({draw: true, actor: {}}).result, 'draw');
});

test('recordMatch prepends, de-duplicates ids and preserves the version', () => {
  let history = historyEntryFromResult({win: true, actor: {frags: 3, deaths: 1}}, {mode: 'deathmatch', at: 100, id: 'a'});
  history = recordMatch(emptyHistory(), history);
  assert.equal(history.entries.length, 1);
  const second = historyEntryFromResult({win: false, actor: {frags: 1, deaths: 4}}, {mode: 'ctf', at: 200, id: 'b'});
  history = recordMatch(history, second);
  assert.deepEqual(history.entries.map(item => item.id), ['b', 'a']);
  const replacement = historyEntryFromResult({win: true, actor: {frags: 9, deaths: 2}}, {mode: 'ctf', at: 300, id: 'b'});
  history = recordMatch(history, replacement);
  assert.deepEqual(history.entries.map(item => item.id), ['b', 'a']);
  assert.equal(history.entries[0].kills, 9);
  assert.equal(history.version, 1);
});

test('leaderboard groups by mode and ranks wins, best kills then K/D', () => {
  const history = normalizeHistory({entries: [
    entry({id: '1', mode: 'deathmatch', result: 'win', kills: 8, deaths: 4, at: 10}),
    entry({id: '2', mode: 'deathmatch', result: 'loss', kills: 12, deaths: 6, at: 20}),
    entry({id: '3', mode: 'ctf', result: 'win', kills: 9, deaths: 3, at: 30, score: 9}),
    entry({id: '4', mode: 'ctf', result: 'win', kills: 4, deaths: 4, at: 40, score: 4}),
  ]});
  const board = historyLeaderboard(history);
  assert.deepEqual(board.map(row => row.mode), ['ctf', 'deathmatch']);
  const ctf = board[0];
  assert.equal(ctf.matches, 2);
  assert.equal(ctf.wins, 2);
  assert.equal(ctf.bestKills, 9);
  assert.equal(ctf.kills, 13);
  assert.equal(ctf.bestKd, 3);
  assert.equal(ctf.winRate, 1);
  const dm = board[1];
  assert.equal(dm.matches, 2);
  assert.equal(dm.wins, 1);
  assert.equal(dm.bestKills, 12);
  assert.equal(dm.winRate, 0.5);
  assert.deepEqual(historyLeaderboard(history, {mode: 'deathmatch'}).map(row => row.mode), ['deathmatch']);
  assert.deepEqual(historyLeaderboard(emptyHistory()), []);
  assert.deepEqual(historyModes(history), ['ctf', 'deathmatch']);
});

test('leaderboard records the fastest winning round as a personal best', () => {
  const history = normalizeHistory({entries: [
    entry({id: 'slow', result: 'win', duration: 300, at: 10}),
    entry({id: 'fast', result: 'win', duration: 90, at: 20}),
    entry({id: 'loss', result: 'loss', duration: 30, at: 30}),
  ]});
  const row = historyLeaderboard(history)[0];
  assert.equal(row.bestTime, 90);
});

test('totals aggregate across every mode', () => {
  const history = normalizeHistory({entries: [
    entry({id: '1', result: 'win', kills: 6, deaths: 3, duration: 60}),
    entry({id: '2', result: 'loss', kills: 2, deaths: 8, duration: 120}),
    entry({id: '3', result: 'draw', kills: 4, deaths: 4, duration: 60}),
  ]});
  const totals = historyTotals(history);
  assert.equal(totals.matches, 3);
  assert.equal(totals.wins, 1);
  assert.equal(totals.losses, 1);
  assert.equal(totals.draws, 1);
  assert.equal(totals.kills, 12);
  assert.equal(totals.deaths, 15);
  assert.equal(totals.bestKills, 6);
  assert.equal(totals.bestKd, 2);
  assert.equal(totals.minutes, 4);
  assert.equal(totals.winRate, 1 / 3);
  assert.equal(historyTotals(emptyHistory()).kd, 0);
});
