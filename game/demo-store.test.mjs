import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_VERSION, demoHeader, compressDemo } from './demo.mjs';
import { setDemoStorage, saveDemo, getDemo, listDemos, deleteDemo, demoSummary, demoSummaryText, demoHighlights, demoOutcome, demoModes, demoMaps, filterDemos, sortDemos, demoFileName, demoUsage, demoUsageText, demoBookmarks, addDemoBookmark, removeDemoBookmark, demoRetentionPlan, pruneDemos, exportDemo, importDemo, importDemoToStore } from './demo-store.mjs';

function createMemoryStorage() {
  const meta = new Map();
  const data = new Map();
  return {
    meta,
    data,
    async save(summary, record) {
      meta.set(summary.id, summary);
      data.set(record.id, record);
    },
    async list() {
      return [...meta.values()];
    },
    async get(id) {
      return data.get(id) || null;
    },
    async remove(id) {
      meta.delete(id);
      data.delete(id);
    },
  };
}

function makeDemo({ timeLimit = 2, count = 6 } = {}) {
  const base = {
    config: { mode: 'deathmatch', timeLimit },
    modeName: 'Deathmatch',
    mapId: 'exchange',
    mapName: 'Exchange',
    teamScores: { 0: 0, 1: 0 },
  };
  const keyframes = [];
  const events = [];
  for (let i = 0; i < count; i++) {
    keyframes.push({ time: i, state: { ...base, time: i } });
    events.push({ type: 'shot', id: i, time: i });
  }
  return {
    version: DEMO_VERSION,
    createdAt: '2020-01-01T00:00:00.000Z',
    header: demoHeader(base),
    meta: { tag: 'roundtrip' },
    keyframes,
    events,
  };
}

test('saveDemo stores a compressed, trimmed record and getDemo parses it back', async () => {
  const storage = createMemoryStorage();
  setDemoStorage(storage);
  const summary = await saveDemo(makeDemo({ timeLimit: 2, count: 6 }));
  assert.equal(summary.frames, 3);
  assert.equal(summary.duration, 2);
  const stored = storage.data.get(summary.id);
  assert.ok(stored);
  assert.ok(stored.bytes instanceof Uint8Array);
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'keyframes'), false);
  if (typeof CompressionStream !== 'undefined') {
    assert.equal(stored.bytes[0], 0x1f);
    assert.equal(stored.bytes[1], 0x8b);
  }
  const demo = await getDemo(summary.id);
  assert.equal(demo.version, DEMO_VERSION);
  assert.equal(demo.id, summary.id);
  assert.equal(demo.meta.tag, 'roundtrip');
  assert.equal(demo.keyframes.length, 3);
  assert.equal(demo.keyframes.at(-1).time, 2);
  assert.deepEqual(demo.events.map(event => event.id), [0, 1, 2]);
  assert.equal((await listDemos()).length, 1);
  await deleteDemo(summary.id);
  assert.equal(await getDemo(summary.id), null);
  assert.equal((await listDemos()).length, 0);
});

test('demoSummary derives theater highlights from death, capture and killstreak events', () => {
  const base = {
    config: { mode: 'ctf', timeLimit: 5 },
    modeName: 'Capture the Flag',
    mapId: 'exchange',
    mapName: 'Exchange',
    teamScores: { 0: 0, 1: 0 },
    actors: [{ id: 0, name: 'Claude' }, { id: 1, name: 'ChatGPT' }],
  };
  const keyframes = [
    { time: 0, state: { ...base, time: 0 } },
    { time: 2, state: { ...base, time: 2 } },
  ];
  const events = [
    { type: 'shot', id: 1, time: 0.5 },
    { type: 'capture', id: 2, time: 1, actor: 0, team: 0 },
    { type: 'death', id: 3, time: 1.5, actor: 1, killer: 0, killerName: 'Claude' },
    { type: 'killstreak', id: 4, time: 1.8, actor: 0, streak: 3, reward: 'scavenger' },
  ];
  const summary = demoSummary({ version: DEMO_VERSION, header: demoHeader(base), keyframes, events });
  assert.deepEqual(summary.highlights.map(h => h.time), [1, 1.5, 1.8]);
  assert.match(summary.highlights[0].label, /Claude captured the flag/);
  assert.match(summary.highlights[1].label, /Claude eliminated ChatGPT/);
  assert.match(summary.highlights[2].label, /3 killstreak/);
  assert.deepEqual(summary.highlights.map(h => h.actor), [0, 0, 0]);
  assert.deepEqual(demoHighlights({ events: [] }), []);
  assert.deepEqual(demoHighlights({ events: [{ type: 'death', id: 9, time: 1, actor: 3 }] }).map(h => h.label), ['Actor 3 was eliminated']);
});

test('demo filtering, sorting and outcomes are deterministic', () => {
  const demos = [
    {id: 'a', mode: 'ctf', mapId: 'exchange', createdAt: '2020-01-01T00:00:00Z', duration: 10},
    {id: 'b', mode: 'deathmatch', mapId: 'forge', createdAt: '2020-02-01T00:00:00Z', duration: 30},
    {id: 'c', mode: 'ctf', mapId: 'exchange', createdAt: '2020-03-01T00:00:00Z', duration: 5},
  ];
  assert.deepEqual(filterDemos(demos, {mode: 'ctf'}).map(d => d.id), ['a', 'c']);
  assert.deepEqual(filterDemos(demos, {mapId: 'forge'}).map(d => d.id), ['b']);
  assert.deepEqual(filterDemos(demos, {mode: 'ctf', mapId: 'exchange'}).map(d => d.id), ['a', 'c']);
  assert.deepEqual(filterDemos(demos).map(d => d.id), ['a', 'b', 'c']);
  assert.deepEqual(sortDemos(demos, 'newest').map(d => d.id), ['c', 'b', 'a']);
  assert.deepEqual(sortDemos(demos, 'oldest').map(d => d.id), ['a', 'b', 'c']);
  assert.deepEqual(sortDemos(demos, 'longest').map(d => d.id), ['b', 'a', 'c']);
  assert.deepEqual(sortDemos(demos, 'shortest').map(d => d.id), ['c', 'a', 'b']);
  assert.deepEqual(sortDemos([], 'longest'), []);
  assert.deepEqual(demoModes(demos), ['ctf', 'deathmatch']);
  assert.deepEqual(demoMaps(demos), ['exchange', 'forge']);
  // Team modes use the game's own RED / BLUE names and an explicit numeric
  // winnerTeam slot so a caller never has to parse the display string.
  const team = {header: {config: {team: true}, teamScores: {0: 3, 1: 1}}, keyframes: [{time: 0, state: {config: {team: true}, teamScores: {0: 3, 1: 1}}}]};
  assert.deepEqual(demoOutcome(team), {teamMode: true, winner: 'RED', winnerTeam: 0, scores: {0: 3, 1: 1}, score: '3–1'});
  const ctf = {header: {config: {mode: 'ctf'}, mapId: 'exchange'}, keyframes: [{time: 0, state: {config: {mode: 'ctf'}, teamScores: {0: 5, 1: 2}}}]};
  assert.deepEqual(demoOutcome(ctf), {teamMode: true, winner: 'RED', winnerTeam: 0, scores: {0: 5, 1: 2}, score: '5–2'});
  const losing = {header: {config: {mode: 'teamdeathmatch'}}, keyframes: [{time: 0, state: {config: {mode: 'teamdeathmatch'}, teamScores: {0: 4, 1: 9}}}]};
  assert.equal(demoOutcome(losing).winner, 'BLUE');
  assert.equal(demoOutcome(losing).winnerTeam, 1);
  const ffa = {keyframes: [{time: 0, state: {config: {team: false}, actors: [{id: 0, name: 'Claude', frags: 4}, {id: 1, name: 'ChatGPT', frags: 9}]}}]};
  assert.deepEqual(demoOutcome(ffa), {teamMode: false, winner: 'ChatGPT', winnerTeam: null, scores: null, score: '9 frags'});
  const tie = {header: {config: {team: true}, teamScores: {}}};
  assert.equal(demoOutcome(tie).winner, null);
  assert.equal(demoOutcome(tie).winnerTeam, null);
  assert.equal(demoOutcome(tie).score, '0–0');
});

test('getDemo validates DEMO_VERSION on load', async () => {
  const storage = createMemoryStorage();
  setDemoStorage(storage);
  const bad = { ...makeDemo(), version: DEMO_VERSION + 1 };
  storage.data.set('bad', { id: 'bad', bytes: await compressDemo(bad) });
  await assert.rejects(() => getDemo('bad'), /version/);
});

test('exportDemo and importDemo round-trip a replay through JSON', () => {
  const demo = makeDemo({ timeLimit: 5, count: 4 });
  const exported = exportDemo(demo);
  assert.match(exported.name, /^cocs-replay-deathmatch-/);
  assert.match(exported.name, /\.json$/);
  assert.equal(typeof exported.text, 'string');
  const parsed = JSON.parse(exported.text);
  assert.equal(parsed.version, DEMO_VERSION);
  assert.equal(parsed.keyframes.length, 4);
  const { demo: restored, summary } = importDemo(exported.text);
  assert.deepEqual(restored, demo);
  assert.equal(summary.frames, 4);
  assert.equal(summary.mapId, 'exchange');
  assert.equal(summary.mode, 'deathmatch');
  // Bytes are accepted too, and a bad payload is rejected rather than stored.
  const fromBytes = importDemo(new TextEncoder().encode(exported.text));
  assert.deepEqual(fromBytes.demo, demo);
  assert.throws(() => importDemo('{"version":999}'), /version/);
  assert.throws(() => importDemo('not json'), /Invalid demo JSON/);
  assert.throws(() => exportDemo(null), /No demo/);
});

test('importDemoToStore persists an exported replay and de-duplicates by id', async () => {
  const storage = createMemoryStorage();
  setDemoStorage(storage);
  const demo = makeDemo({ timeLimit: 5, count: 4 });
  demo.id = 'fixed-replay';
  const first = await importDemoToStore(exportDemo(demo).text);
  assert.equal(first.id, 'fixed-replay');
  assert.equal((await listDemos()).length, 1);
  await importDemoToStore(exportDemo(demo).text);
  assert.equal((await listDemos()).length, 1, 're-importing replaces the same id');
  const loaded = await getDemo('fixed-replay');
  assert.equal(loaded.meta.tag, 'roundtrip');
});

test('demoFileName sanitizes the mode and stamp', () => {
  const name = demoFileName({createdAt: '2020-01-02T03:04:05.000Z', header: {config: {mode: 'team death/match'}}});
  assert.match(name, /^cocs-replay-teamdeathmatch-20200102T030405000Z\.json$/);
  assert.match(demoFileName({}), /^cocs-replay-match-\d+\.json$/);
});

test('demoUsage reports the library size when the store exposes it', async () => {
  const storage = createMemoryStorage();
  storage.usage = async () => ({count: 3, bytes: 5 * 1024 * 1024});
  setDemoStorage(storage);
  assert.deepEqual(await demoUsage(), {count: 3, bytes: 5 * 1024 * 1024, measured: true});
  assert.equal(demoUsageText({count: 3, bytes: 5 * 1024 * 1024}), '3 REPLAYS · 5.0 MB');
  assert.equal(demoUsageText({count: 1, bytes: 2 * 1024 * 1024}), '1 REPLAY · 2.0 MB');
  assert.equal(demoUsageText({count: 2, bytes: 12 * 1024 * 1024}), '2 REPLAYS · 12 MB');
  assert.equal(demoUsageText({count: 1, bytes: 0}), '1 REPLAY');
  assert.equal(demoUsageText({count: 2, bytes: 800}), '2 REPLAYS · 1 KB');
  assert.equal(demoUsageText(null), '0 REPLAYS');

  // A store without a usage() method counts from the summaries; a saved replay
  // now carries its real compressed size, so the fallback is measured too.
  setDemoStorage(createMemoryStorage());
  await saveDemo(makeDemo());
  const counted = await demoUsage();
  assert.equal(counted.count, 1);
  assert.equal(counted.measured, true);
  assert.ok(counted.bytes > 0);
  assert.match(demoUsageText(counted), /^1 REPLAY · \d+ KB$/);
  // Legacy meta entries with no size still count, but the byte total stays 0
  // and is never presented as a measurement.
  const legacy = createMemoryStorage();
  legacy.meta.set('legacy', { id: 'legacy', createdAt: '2020-01-01T00:00:00Z' });
  setDemoStorage(legacy);
  const unscoped = await demoUsage();
  assert.equal(unscoped.count, 1);
  assert.equal(unscoped.measured, false);
  assert.equal(demoUsageText(unscoped), '1 REPLAY');
});

test('saveDemo records the compressed byte count on the summary for retention', async () => {
  const storage = createMemoryStorage();
  setDemoStorage(storage);
  const summary = await saveDemo(makeDemo({ timeLimit: 5, count: 4 }));
  assert.ok(Number.isFinite(summary.bytes) && summary.bytes > 0, 'the summary carries the stored size');
  const [listed] = await listDemos();
  assert.equal(listed.bytes, summary.bytes, 'the stored summary matches what saveDemo returned');
});

test('replay bookmarks live in demo meta, surface on the summary and round-trip compression', async () => {
  const storage = createMemoryStorage();
  setDemoStorage(storage);
  const summary = await saveDemo(makeDemo({ timeLimit: 5, count: 4 }));
  assert.deepEqual(summary.bookmarks, [], 'a fresh replay has no bookmarks');

  const marked = await addDemoBookmark(summary.id, { time: 1.234, label: 'Nice shot' });
  assert.deepEqual(marked.bookmarks, [{ time: 1.23, label: 'Nice shot' }], 'the bookmark lands in the summary');
  await addDemoBookmark(summary.id, { time: 3.5 });
  // A duplicate stamp is ignored, and addDemoBookmark accepts a plain number.
  const deduped = await addDemoBookmark(summary.id, 1.234);
  assert.deepEqual(deduped.bookmarks, [{ time: 1.23, label: 'Nice shot' }, { time: 3.5 }]);
  assert.equal(deduped.id, summary.id, 'bookmarking never mints a new replay id');

  const loaded = await getDemo(summary.id);
  assert.deepEqual(loaded.meta.bookmarks, [{ time: 1.23, label: 'Nice shot' }, { time: 3.5 }], 'meta round-trips through compression');
  assert.equal(loaded.meta.tag, 'roundtrip', 'the original meta fields survive');

  const cleaned = await removeDemoBookmark(summary.id, 1.23);
  assert.deepEqual(cleaned.bookmarks, [{ time: 3.5 }]);
  assert.equal(await addDemoBookmark('missing', { time: 1 }), null, 'a missing replay is a null result, not a throw');
  await assert.rejects(() => addDemoBookmark(summary.id, { time: -1 }), /Invalid bookmark time/);
});

test('demoBookmarks normalizes hostile meta instead of trusting it', () => {
  assert.deepEqual(demoBookmarks(null), []);
  assert.deepEqual(demoBookmarks({ meta: { bookmarks: 'nope' } }), []);
  assert.deepEqual(demoBookmarks({ meta: { bookmarks: [{ time: NaN }, { time: -4 }, { time: 2.002 }, { time: 2.004 }, { time: '3', label: '  x  ' }] } }),
    [{ time: 2 }, { time: 3, label: 'x' }]);
});

test('demoRetentionPlan keeps everything by default and only removes past the policy', () => {
  const demos = [
    { id: 'newest', createdAt: '2024-03-01T00:00:00Z', bytes: 300 },
    { id: 'middle', createdAt: '2024-02-01T00:00:00Z', bytes: 200 },
    { id: 'oldest', createdAt: '2024-01-01T00:00:00Z', bytes: 100 },
  ];
  const off = demoRetentionPlan(demos);
  assert.deepEqual(off.remove, [], 'no policy removes nothing');
  assert.deepEqual(off.keep, ['newest', 'middle', 'oldest']);
  assert.equal(off.measured, false, 'a size of zero disables size pruning rather than guessing');

  const keepTwo = demoRetentionPlan(demos, { keep: 2 });
  assert.deepEqual(keepTwo.remove, ['oldest']);
  assert.deepEqual(keepTwo.keep, ['newest', 'middle']);

  const limit = demoRetentionPlan(demos, { maxBytes: 400 });
  assert.deepEqual(limit.remove, ['middle', 'oldest'], 'oldest-first deletion continues until the budget fits');
  assert.deepEqual(limit.keep, ['newest']);
  assert.equal(limit.measured, true);
  assert.equal(limit.bytes, 300);
  assert.equal(limit.sizeApplied, true);

  const keepOneWithLimit = demoRetentionPlan(demos, { keep: 1, maxBytes: 1 });
  assert.deepEqual(keepOneWithLimit.keep, ['newest'], 'keep is a hard floor even under a tiny byte limit');
  assert.deepEqual(keepOneWithLimit.remove, ['middle', 'oldest']);

  const unmeasured = demoRetentionPlan([{ id: 'a', createdAt: '2024-01-01T00:00:00Z' }], { maxBytes: 1 });
  assert.equal(unmeasured.measured, false, 'a missing size never authorizes deletion');
  assert.deepEqual(unmeasured.remove, []);
});

test('pruneDemos applies an opt-in policy against the live storage', async () => {
  const storage = createMemoryStorage();
  storage.usage = async () => ({
    count: storage.meta.size,
    bytes: [...storage.data.values()].reduce((total, record) => total + record.bytes.byteLength, 0),
    entries: [...storage.data.entries()].map(([id, record]) => ({ id, bytes: record.bytes.byteLength })),
  });
  setDemoStorage(storage);
  const first = await saveDemo({ ...makeDemo({ timeLimit: 2, count: 4 }), createdAt: '2024-01-01T00:00:00.000Z', id: 'keep-a' });
  const second = await saveDemo({ ...makeDemo({ timeLimit: 2, count: 4 }), createdAt: '2024-02-01T00:00:00.000Z', id: 'keep-b' });
  await saveDemo({ ...makeDemo({ timeLimit: 2, count: 40 }), createdAt: '2024-03-01T00:00:00.000Z', id: 'big-c' });
  assert.equal((await listDemos()).length, 3);

  const result = await pruneDemos({ keep: 2 });
  assert.equal(result.applied, true);
  assert.deepEqual(result.removed, ['keep-a'], 'keep-N prunes oldest-first');
  assert.equal(result.removedCount, 1);
  assert.equal(result.count, 2);
  const remaining = await listDemos();
  assert.deepEqual(remaining.map(demo => demo.id), ['big-c', 'keep-b']);
  assert.ok(remaining.every(demo => Number.isFinite(demo.bytes) && demo.bytes > 0), 'kept summaries report real sizes');
  assert.equal(first.id, 'keep-a');

  const noop = await pruneDemos({});
  assert.deepEqual(noop.removed, [], 'the default policy is keep-everything');
  assert.equal(noop.applied, false);
});

test('demoSummaryText builds a timestamped, truthful result summary', () => {
  const summary = { ...demoSummary(makeDemo({ timeLimit: 5, count: 4 })), winner: 'RED', score: '3–1', duration: 65 };
  const text = demoSummaryText(summary, { now: Date.UTC(2024, 5, 1, 12, 0, 0) });
  assert.match(text, /^COCS · REPLAY SUMMARY/);
  assert.match(text, /Exchange · DEATHMATCH/);
  assert.match(text, /RESULT · RED WINS \(3–1\)/);
  assert.match(text, /DURATION · 1:05/);
  assert.match(text, /RECORDED · 2020-01-01T00:00:00\.000Z/);
  assert.match(text, /GENERATED · 2024-06-01T12:00:00\.000Z/);
  assert.doesNotMatch(text, /BOOKMARKS/, 'an unbookmarked replay does not claim bookmarks');
  assert.match(demoSummaryText({ ...summary, bookmarks: [{ time: 1 }] }), /BOOKMARKS · 1/);
  assert.match(demoSummaryText({}, { now: 0 }), /NO WINNER/);
});

test('demoUsage surfaces the per-replay entries when the store measures them', async () => {
  const storage = createMemoryStorage();
  storage.usage = async () => ({ count: 2, bytes: 300, entries: [{ id: 'a', bytes: 100 }, { id: 'b', bytes: 200 }] });
  setDemoStorage(storage);
  const usage = await demoUsage();
  assert.deepEqual(usage.entries, [{ id: 'a', bytes: 100 }, { id: 'b', bytes: 200 }]);
  assert.equal(usage.bytes, 300);
  setDemoStorage(createMemoryStorage());
  const fallback = await demoUsage();
  assert.equal(fallback.entries, undefined, 'a store without entries keeps the old shape');
  assert.equal(fallback.count, 0);
});

test('trimDemo caps an oversized recording when saving', async () => {
  const storage = createMemoryStorage();
  setDemoStorage(storage);
  const summary = await saveDemo(makeDemo({ timeLimit: 1, count: 500 }));
  const demo = await getDemo(summary.id);
  assert.equal(summary.frames, 2);
  assert.equal(demo.keyframes.length, 2);
  assert.equal(demo.keyframes.at(-1).time, 1);
  assert.deepEqual(demo.events.map(event => event.id), [0, 1]);
});
