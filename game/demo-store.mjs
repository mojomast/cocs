import { compressDemo, decompressDemo, trimDemo } from './demo.mjs';

const DB_NAME = 'token-arena-demos';
const DB_VERSION = 1;
const META_STORE = 'meta';
const DATA_STORE = 'data';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createIndexedDbStorage() {
  return {
    async save(summary, record) {
      const db = await openDb();
      const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
      tx.objectStore(META_STORE).put(summary);
      tx.objectStore(DATA_STORE).put(record);
      await transactionDone(tx);
      db.close();
    },
    async list() {
      const db = await openDb();
      const tx = db.transaction(META_STORE, 'readonly');
      const all = await requestResult(tx.objectStore(META_STORE).getAll());
      db.close();
      return all || [];
    },
    async get(id) {
      const db = await openDb();
      const tx = db.transaction(DATA_STORE, 'readonly');
      const record = await requestResult(tx.objectStore(DATA_STORE).get(id));
      db.close();
      return record || null;
    },
    async remove(id) {
      const db = await openDb();
      const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
      tx.objectStore(META_STORE).delete(id);
      tx.objectStore(DATA_STORE).delete(id);
      await transactionDone(tx);
      db.close();
    },
  };
}

let storage = createIndexedDbStorage();

export function setDemoStorage(next) {
  storage = next && typeof next === 'object' ? next : createIndexedDbStorage();
}

export function demoSummary(demo) {
  const header = demo?.header || {};
  const frames = Array.isArray(demo?.keyframes) ? demo.keyframes : [];
  const duration = frames.length > 1 ? frames[frames.length - 1].time - frames[0].time : 0;
  return {
    id: demo?.id || null,
    createdAt: demo?.createdAt || null,
    mapId: header.mapId ?? null,
    mapName: header.mapName ?? null,
    modeName: header.modeName ?? null,
    mode: demo?.meta?.mode || header.config?.mode || 'deathmatch',
    player: demo?.meta?.player || null,
    network: demo?.meta?.net === true,
    duration,
    frames: frames.length,
  };
}

function trimSeconds(demo) {
  const limit = demo?.header?.config?.timeLimit ?? demo?.meta?.maxSeconds;
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

export async function saveDemo(demo) {
  const id = demo.id || `demo-${String(demo.createdAt || Date.now()).replace(/[^0-9]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { ...demo, id };
  const maxSeconds = trimSeconds(record);
  const finished = maxSeconds === null ? record : trimDemo(record, maxSeconds);
  const summary = demoSummary(finished);
  const bytes = await compressDemo(finished);
  await storage.save(summary, { id, bytes });
  return summary;
}

export async function listDemos() {
  const all = await storage.list();
  return (all || []).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function getDemo(id) {
  const record = await storage.get(id);
  if (!record) return null;
  const bytes = record.bytes ?? record.data ?? record;
  const demo = await decompressDemo(bytes);
  if (!demo.id) demo.id = record.id || id;
  return demo;
}

export async function deleteDemo(id) {
  await storage.remove(id);
}
