import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_VERSION, demoHeader, compressDemo } from './demo.mjs';
import { setDemoStorage, saveDemo, getDemo, listDemos, deleteDemo, demoSummary, demoHighlights, demoOutcome, demoModes, demoMaps, filterDemos, sortDemos, demoFileName, exportDemo, importDemo, importDemoToStore } from './demo-store.mjs';

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
  const team = {header: {config: {team: true}, teamScores: {0: 3, 1: 1}}, keyframes: [{time: 0, state: {config: {team: true}, teamScores: {0: 3, 1: 1}}}]};
  assert.deepEqual(demoOutcome(team), {teamMode: true, winner: 'Team 1', scores: {0: 3, 1: 1}, score: '3–1'});
  const ctf = {header: {config: {mode: 'ctf'}, mapId: 'exchange'}, keyframes: [{time: 0, state: {config: {mode: 'ctf'}, teamScores: {0: 5, 1: 2}}}]};
  assert.deepEqual(demoOutcome(ctf), {teamMode: true, winner: 'Team 1', scores: {0: 5, 1: 2}, score: '5–2'});
  const losing = {header: {config: {mode: 'teamdeathmatch'}}, keyframes: [{time: 0, state: {config: {mode: 'teamdeathmatch'}, teamScores: {0: 4, 1: 9}}}]};
  assert.equal(demoOutcome(losing).winner, 'Team 2');
  const ffa = {keyframes: [{time: 0, state: {config: {team: false}, actors: [{id: 0, name: 'Claude', frags: 4}, {id: 1, name: 'ChatGPT', frags: 9}]}}]};
  assert.deepEqual(demoOutcome(ffa), {teamMode: false, winner: 'ChatGPT', scores: null, score: '9 frags'});
  const tie = {header: {config: {team: true}, teamScores: {}}};
  assert.equal(demoOutcome(tie).winner, null);
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
