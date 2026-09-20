import { compressDemo, decompressDemo, trimDemo, serializeDemo, parseDemo } from './demo.mjs';
import { teamMode as isTeamMode } from './config.mjs';
import { teamName } from './hud.mjs';

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
    // Library size for the Theater usage line. Reads only the stored bytes so
    // it never decompresses a replay just to report its size. `entries` is the
    // per-replay breakdown retention needs; the total stays authoritative.
    async usage() {
      const db = await openDb();
      const tx = db.transaction([META_STORE, DATA_STORE], 'readonly');
      const metas = await requestResult(tx.objectStore(META_STORE).getAll());
      const records = await requestResult(tx.objectStore(DATA_STORE).getAll());
      db.close();
      const entries = (records || []).map(record => ({id: record?.id ?? null, bytes: recordByteSize(record)}));
      return {
        count: (metas || []).length,
        bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
        entries,
      };
    },
  };
}

const recordByteSize = record => {
  const bytes = record?.bytes ?? record?.data;
  if (Number.isFinite(bytes?.byteLength)) return bytes.byteLength;
  if (Number.isFinite(bytes?.length)) return bytes.length;
  return 0;
};

let storage = createIndexedDbStorage();

export function setDemoStorage(next) {
  storage = next && typeof next === 'object' ? next : createIndexedDbStorage();
}

const HIGHLIGHT_EVENTS = new Set(['death', 'capture', 'killstreak']);

function actorNames(demo) {
  const names = new Map();
  const frames = Array.isArray(demo?.keyframes) ? demo.keyframes : [];
  for (const frame of frames) {
    const actors = frame?.state?.actors;
    if (!Array.isArray(actors)) continue;
    for (const actor of actors) {
      if (actor && actor.id !== undefined && !names.has(actor.id)) names.set(actor.id, actor.name || `Actor ${actor.id}`);
    }
  }
  return names;
}

export function demoHighlights(demo) {
  const events = Array.isArray(demo?.events) ? demo.events : [];
  const names = actorNames(demo);
  const label = id => names.get(id) || `Actor ${id}`;
  const highlights = [];
  for (const event of events) {
    if (!event || typeof event.time !== 'number' || !HIGHLIGHT_EVENTS.has(event.type)) continue;
    if (event.type === 'death') {
      const victim = label(event.actor);
      const killer = event.self === true ? null : event.killerName || (event.killer !== null && event.killer !== undefined ? label(event.killer) : null);
      highlights.push({ time: event.time, label: killer ? `${killer} eliminated ${victim}` : `${victim} was eliminated`, actor: event.killer ?? event.actor });
    } else if (event.type === 'capture') {
      highlights.push({ time: event.time, label: `${label(event.actor)} captured the flag`, actor: event.actor });
    } else {
      const streak = Number(event.streak) || 0;
      highlights.push({ time: event.time, label: `${label(event.actor)} hit a ${streak} killstreak`, actor: event.actor });
    }
  }
  return highlights.sort((a, b) => a.time - b.time);
}

const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function demoOutcome(demo) {
  const header = demo?.header || {};
  const frames = Array.isArray(demo?.keyframes) ? demo.keyframes : [];
  const state = frames.length ? frames[frames.length - 1]?.state || {} : {};
  const config = state.config || header.config || {};
  const teamScores = state.teamScores || header.teamScores || {};
  const teamMode = config?.team === true || isTeamMode(config?.mode);
  const actors = Array.isArray(state.actors) ? state.actors : [];
  if (teamMode) {
    const a = numeric(teamScores[0]), b = numeric(teamScores[1]);
    const winnerTeam = a === b ? null : a > b ? 0 : 1;
    const winner = winnerTeam === null ? null : teamName(winnerTeam);
    return {teamMode: true, winner, winnerTeam, scores: {0: a, 1: b}, score: `${a}–${b}`};
  }
  const ranked = actors.slice().sort((x, y) => numeric(y?.frags) - numeric(x?.frags));
  const top = ranked[0];
  const winner = top?.name || null;
  const frags = top ? numeric(top.frags) : 0;
  return {teamMode: false, winner, winnerTeam: null, scores: null, score: top ? `${frags} frags` : ''};
}

// ---------------------------------------------------------------------------
// Replay bookmarks. They live in the demo's own `meta` object, which saveDemo
// round-trips through compression, so a bookmark survives reload, export and
// re-import with the replay it marks. The summary surfaces the normalized list
// (sorted, de-duplicated, bounded) because the Theater dock reads summaries.
const BOOKMARK_LIMIT = 200;

export function demoBookmarks(demo) {
  const raw = Array.isArray(demo?.meta?.bookmarks) ? demo.meta.bookmarks : [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const time = Number(entry?.time);
    if (!Number.isFinite(time) || time < 0) continue;
    const stamp = Math.round(time * 100) / 100;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    const label = typeof entry?.label === 'string' ? entry.label.trim().slice(0, 80) : '';
    out.push(label ? {time: stamp, label} : {time: stamp});
  }
  return out.sort((a, b) => a.time - b.time).slice(0, BOOKMARK_LIMIT);
}

export async function addDemoBookmark(id, entry = {}) {
  const demo = await getDemo(id);
  if (!demo) return null;
  const rawTime = typeof entry === 'number' ? entry : entry?.time;
  const time = Number(rawTime);
  if (!Number.isFinite(time) || time < 0) throw new Error('Invalid bookmark time');
  const stamp = Math.round(time * 100) / 100;
  const requested = typeof entry?.label === 'string' ? entry.label.trim().slice(0, 80) : '';
  const existing = demoBookmarks(demo).find(mark => Math.abs(mark.time - stamp) < 0.005);
  // Re-marking the same stamp keeps an existing label unless the caller sends
  // a new one, so a plain time never silently erases a named bookmark.
  const label = requested || existing?.label || '';
  const bookmarks = [...demoBookmarks(demo).filter(mark => Math.abs(mark.time - stamp) >= 0.005), (label ? {time: stamp, label} : {time: stamp})]
    .sort((a, b) => a.time - b.time)
    .slice(0, BOOKMARK_LIMIT);
  demo.meta = {...(demo?.meta || {}), bookmarks};
  return saveDemo(demo);
}

export async function removeDemoBookmark(id, time) {
  const demo = await getDemo(id);
  if (!demo) return null;
  const target = Number(time);
  if (!Number.isFinite(target)) throw new Error('Invalid bookmark time');
  const bookmarks = demoBookmarks(demo).filter(mark => Math.abs(mark.time - target) >= 0.005);
  demo.meta = {...(demo?.meta || {}), bookmarks};
  return saveDemo(demo);
}

export function demoSummary(demo) {
  const header = demo?.header || {};
  const frames = Array.isArray(demo?.keyframes) ? demo.keyframes : [];
  const duration = frames.length > 1 ? frames[frames.length - 1].time - frames[0].time : 0;
  const outcome = demoOutcome(demo);
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
    highlights: demoHighlights(demo),
    bookmarks: demoBookmarks(demo),
    teamMode: outcome.teamMode,
    winner: outcome.winner,
    winnerTeam: outcome.winnerTeam,
    score: outcome.score,
  };
}

// One plain-text result summary for the Theater's COPY SUMMARY action. Kept
// pure so the exact clipboard payload is testable; the copy itself only reports
// success after the write resolves.
export function demoSummaryText(summary, {now = Date.now()} = {}) {
  const source = summary || {};
  const clock = value => {
    const total = Math.max(0, Math.round(Number(value) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };
  const iso = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(now).toISOString();
  };
  const highlights = Array.isArray(source.highlights) ? source.highlights : [];
  const bookmarks = Array.isArray(source.bookmarks) ? source.bookmarks : [];
  const lines = [
    'COCS · REPLAY SUMMARY',
    `${source.mapName || source.mapId || 'Unknown map'} · ${String(source.modeName || source.mode || 'match').toUpperCase()}`,
    `RESULT · ${source.winner ? `${source.winner} WINS` : 'NO WINNER'}${source.score ? ` (${source.score})` : ''}`,
    `DURATION · ${clock(source.duration)}`,
    `RECORDED · ${iso(source.createdAt || now)}`,
    `HIGHLIGHTS · ${highlights.length}`,
    ...(bookmarks.length ? [`BOOKMARKS · ${bookmarks.length}`] : []),
    `GENERATED · ${iso(now)}`,
  ];
  return lines.join('\n');
}

export function filterDemos(demos, {mode = 'all', mapId = 'all'} = {}) {
  return (Array.isArray(demos) ? demos : []).filter(demo => {
    if (mode !== 'all' && demo?.mode !== mode) return false;
    if (mapId !== 'all' && demo?.mapId !== mapId) return false;
    return true;
  });
}

export function sortDemos(demos, order = 'newest') {
  const list = (Array.isArray(demos) ? demos : []).slice();
  const newest = (a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''));
  if (order === 'oldest') return list.sort((a, b) => newest(b, a));
  if (order === 'longest') return list.sort((a, b) => numeric(b?.duration) - numeric(a?.duration) || newest(a, b));
  if (order === 'shortest') return list.sort((a, b) => numeric(a?.duration) - numeric(b?.duration) || newest(a, b));
  return list.sort(newest);
}

export function demoModes(demos) {
  return [...new Set((Array.isArray(demos) ? demos : []).map(demo => demo?.mode).filter(Boolean))];
}

export function demoMaps(demos) {
  return [...new Set((Array.isArray(demos) ? demos : []).map(demo => demo?.mapId).filter(Boolean))];
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
  const bytes = await compressDemo(finished);
  const summary = {...demoSummary(finished), bytes: byteLength(bytes)};
  await storage.save(summary, { id, bytes });
  return summary;
}

function byteLength(bytes) {
  if (Number.isFinite(bytes?.byteLength)) return bytes.byteLength;
  if (Number.isFinite(bytes?.length)) return bytes.length;
  return 0;
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

// ---------------------------------------------------------------------------
// Library usage. The IndexedDB store reports the stored byte total directly;
// any storage test double without `usage()` still gets a count, and `measured`
// tells the caller whether a size is real instead of guessed. Kept pure so the
// Theater line is testable without a browser.
// ---------------------------------------------------------------------------
export async function demoUsage() {
  if (typeof storage?.usage === 'function') {
    try {
      const usage = await storage.usage();
      const entries = Array.isArray(usage?.entries)
        ? usage.entries.map(entry => ({id: entry?.id ?? null, bytes: Math.max(0, Number(entry?.bytes) || 0)}))
        : null;
      return {
        count: Math.max(0, Math.floor(Number(usage?.count) || 0)),
        bytes: Math.max(0, Number(usage?.bytes) || 0),
        measured: true,
        ...(entries ? {entries} : {}),
      };
    } catch {}
  }
  const all = await storage.list();
  const list = Array.isArray(all) ? all : [];
  const bytes = list.reduce((total, demo) => total + (Number(demo?.bytes) || 0), 0);
  return {count: list.length, bytes, measured: bytes > 0};
}

// ---------------------------------------------------------------------------
// Retention. Opt-in and keep-everything by default: a keep-N policy removes
// everything past the newest N, and a max-MB policy removes oldest-first until
// the known total fits. The plan is pure and refuses to guess: when any kept
// replay has no measured size, size pruning is skipped (measured:false) instead
// of deleting based on a fabricated number. `keep` is a hard floor.
// ---------------------------------------------------------------------------
export function demoRetentionPlan(demos, {keep = 0, maxBytes = 0, sizes = null} = {}) {
  const list = sortDemos(demos, 'newest');
  const keepCount = Math.max(0, Math.min(list.length, Math.floor(Number(keep) || 0)));
  const limit = Math.max(0, Math.floor(Number(maxBytes) || 0));
  const sizeOf = demo => {
    const id = demo?.id;
    const known = sizes && typeof sizes.get === 'function' ? sizes.get(id) : sizes?.[id];
    const value = Number(known ?? demo?.bytes);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const remove = new Set();
  let measured = false;
  let sizeApplied = false;
  let keptBytes = 0;
  if (limit > 0) {
    measured = list.every(demo => sizeOf(demo) !== null);
    if (measured) {
      sizeApplied = true;
      for (const demo of list) remove.add(demo.id);
      for (const demo of list.slice(0, keepCount)) remove.delete(demo.id);
      let running = list.slice(0, keepCount).reduce((total, demo) => total + sizeOf(demo), 0);
      for (const demo of list.slice(keepCount)) {
        const size = sizeOf(demo);
        if (running + size <= limit) {
          running += size;
          remove.delete(demo.id);
        } else {
          break; // the oldest replays go first; a gap is never kept
        }
      }
      keptBytes = running;
    }
  }
  if (!sizeApplied && keepCount > 0) for (const demo of list.slice(keepCount)) remove.add(demo.id);
  if (!sizeApplied) {
    // Keep-policy-only plans report the known size of what stays, which is 0
    // for unsized legacy records rather than an invented number.
    keptBytes = list.reduce((total, demo) => remove.has(demo.id) ? total : total + (sizeOf(demo) ?? 0), 0);
  }
  return {
    keep: list.filter(demo => !remove.has(demo.id)).map(demo => demo.id),
    remove: list.filter(demo => remove.has(demo.id)).map(demo => demo.id),
    measured,
    bytes: keptBytes,
    limit,
    keepCount,
    sizeApplied,
  };
}

// Executes a retention policy against the live storage. Returns the plan plus
// the ids actually removed and the post-prune count; when a size limit is asked
// for and any replay has no measured size, nothing is deleted (measured:false,
// applied:false) rather than guessing.
export async function pruneDemos({keep = 0, maxMb = 0, maxBytes = 0} = {}) {
  const list = await listDemos();
  const usage = await demoUsage();
  const sizes = new Map((Array.isArray(usage?.entries) ? usage.entries : []).map(entry => [entry.id, entry.bytes]));
  const limit = Number(maxMb) > 0 ? Math.round(Number(maxMb) * 1024 * 1024) : Math.max(0, Math.floor(Number(maxBytes) || 0));
  const plan = demoRetentionPlan(list, {keep, maxBytes: limit, sizes});
  const removed = [];
  for (const id of plan.remove) {
    await storage.remove(id);
    removed.push(id);
  }
  return {
    ...plan,
    removed,
    removedCount: removed.length,
    count: list.length - removed.length,
    applied: plan.keepCount > 0 || plan.sizeApplied,
  };
}

export function demoUsageText(usage) {
  const count = Math.max(0, Math.floor(Number(usage?.count) || 0));
  const label = `${count} ${count === 1 ? 'REPLAY' : 'REPLAYS'}`;
  const bytes = Math.max(0, Number(usage?.bytes) || 0);
  if (!bytes) return label;
  const mb = bytes / (1024 * 1024);
  const size = mb >= 10 ? `${Math.round(mb)} MB` : mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${label} · ${size}`;
}

// ---------------------------------------------------------------------------
// Replay export / import. A demo is a plain JSON document, so export is a
// stable, human-readable serialization and import validates the version before
// handing the demo back to the caller. Kept storage-agnostic so the round-trip
// is testable without IndexedDB or a browser.
export function demoFileName(demo) {
  const stamp = String(demo?.createdAt || demo?.id || Date.now()).replace(/[^0-9a-z]/gi, '').slice(0, 24) || 'replay';
  const mode = String(demo?.header?.config?.mode || demo?.meta?.mode || 'match').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'match';
  return `cocs-replay-${mode}-${stamp}.json`;
}

export function exportDemo(demo) {
  if (!demo || typeof demo !== 'object') throw new Error('No demo to export');
  return { name: demoFileName(demo), text: serializeDemo(demo), demo };
}

export function importDemo(textOrBytes) {
  const demo = parseDemo(textOrBytes);
  const summary = demoSummary(demo);
  return { demo, summary };
}

// Import straight into the local library. The imported demo keeps its own id
// when present so re-importing an export replaces rather than duplicates it.
export async function importDemoToStore(textOrBytes) {
  const { demo } = importDemo(textOrBytes);
  const summary = await saveDemo(demo);
  return summary;
}
