import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_VERSION, demoHeader, compressDemo } from './demo.mjs';
import { setDemoStorage, saveDemo, getDemo, listDemos, deleteDemo } from './demo-store.mjs';

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
