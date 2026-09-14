import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_VERSION, demoHeader, compressDemo } from './demo.mjs';
import { setDemoStorage, saveDemo, getDemo, listDemos, deleteDemo, demoSummary, demoHighlights } from './demo-store.mjs';

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

test('getDemo validates DEMO_VERSION on load', async () => {
  const storage = createMemoryStorage();
  setDemoStorage(storage);
  const bad = { ...makeDemo(), version: DEMO_VERSION + 1 };
  storage.data.set('bad', { id: 'bad', bytes: await compressDemo(bad) });
  await assert.rejects(() => getDemo('bad'), /version/);
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
