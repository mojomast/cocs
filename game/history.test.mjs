import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_LIMIT,
  PERSONAL_BEST_LABELS,
  emptyHistory,
  historyEntryFromResult,
  historyLeaderboard,
  historyModes,
  historyTotals,
  kdRatio,
  newPersonalBests,
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

test('newPersonalBests flags every record a first result sets, in board order', () => {
  const first = historyEntryFromResult(
    {win: true, actor: {frags: 12, deaths: 3, scoreStats: {}}, time: 92},
    {mode: 'ctf', at: 100, duration: 92, score: 12, id: 'first'}
  );
  const records = newPersonalBests(emptyHistory(), first);
  assert.deepEqual(records.map(record => [record.id, record.label, record.value]), [
    ['kills', 'BEST KILLS', '12'],
    ['kd', 'BEST K/D', '4'],
    ['score', 'BEST SCORE', '12'],
    ['time', 'FASTEST WIN', '92s'],
  ]);
  assert.equal(records[0].raw, 12);
  assert.equal(records[3].raw, 92);
  assert.ok(Object.isFrozen(PERSONAL_BEST_LABELS));
  // No stored board at all behaves exactly like an empty history.
  assert.deepEqual(newPersonalBests(null, first).map(record => record.id), ['kills', 'kd', 'score', 'time']);
});

test('newPersonalBests never re-flags a tie, a lower result or the stored entry', () => {
  const best = entry({id: 'best', mode: 'deathmatch', kills: 12, deaths: 3, score: 12, duration: 90, at: 50});
  const history = recordMatch(emptyHistory(), best);
  assert.deepEqual(newPersonalBests(history, entry({id: 'tie', mode: 'deathmatch', kills: 12, deaths: 3, score: 12, duration: 90, at: 60})), []);
  assert.deepEqual(newPersonalBests(history, entry({id: 'lower', mode: 'deathmatch', result: 'loss', kills: 4, deaths: 6, score: 4, duration: 300, at: 70})), []);
  // The stored result ties its own board, so an idempotent re-read is silent.
  assert.deepEqual(newPersonalBests(history, best), []);
  // One improved stat on an otherwise tied line still flags that stat alone.
  const improved = entry({id: 'improved', kills: 12, deaths: 6, score: 14, duration: 120, at: 80});
  assert.deepEqual(newPersonalBests(history, improved).map(record => record.id), ['score']);
  // A zero-stat round claims no record, not even a zero-value one.
  const zero = entry({id: 'zero', result: 'draw', kills: 0, deaths: 0, score: 0, duration: 0, at: 90});
  assert.deepEqual(newPersonalBests(history, zero), []);
  assert.deepEqual(newPersonalBests(emptyHistory(), zero), []);
});

test('newPersonalBests records only a faster win, per mode, without mutating history', () => {
  const history = normalizeHistory({entries: [
    entry({id: 'slow', mode: 'deathmatch', result: 'win', kills: 10, deaths: 2, duration: 180, at: 10}),
    entry({id: 'fast-loss', mode: 'deathmatch', result: 'loss', kills: 3, deaths: 9, duration: 40, at: 20}),
  ]});
  const before = JSON.stringify(history);
  const faster = entry({id: 'fast', mode: 'deathmatch', result: 'win', kills: 6, deaths: 3, duration: 75, at: 30});
  assert.deepEqual(newPersonalBests(history, faster).map(record => record.id), ['time']);
  assert.deepEqual(newPersonalBests(history, entry({id: 'quick-loss', mode: 'deathmatch', result: 'loss', kills: 6, deaths: 3, duration: 20, at: 40})), []);
  // Another mode's board never shields a first result in this mode.
  const firstCtf = entry({id: 'ctf-first', mode: 'ctf', kills: 5, deaths: 5, score: 5, duration: 120, at: 50});
  assert.deepEqual(newPersonalBests(history, firstCtf).map(record => record.id), ['kills', 'kd', 'score', 'time']);
  assert.equal(JSON.stringify(history), before, 'the stored history is never mutated');
  assert.deepEqual(newPersonalBests(history, firstCtf), newPersonalBests(history, firstCtf), 'deterministic across reads');
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
