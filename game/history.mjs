// Local match history and per-mode leaderboard. Pure and engine-free so the
// recording, normalization and ranking logic is unit-testable and behaves the
// same on every device; the page owns the localStorage wrapper.
export const HISTORY_VERSION = 1;
export const HISTORY_STORAGE_KEY = 'token-arena-history';
export const HISTORY_LIMIT = 60;

const RESULT_VALUES = new Set(['win', 'loss', 'draw']);

const clean = (value, max = 40) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
  : '';

const int = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
};

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeResult(value) {
  const text = String(value ?? '').toLowerCase();
  return RESULT_VALUES.has(text) ? text : 'loss';
}

// Kill/death ratio uses the same convention as the in-match HUD: a flawless
// round reports raw kills rather than infinity.
export function kdRatio(kills, deaths) {
  const k = int(kills), d = int(deaths);
  if (d <= 0) return k;
  return Math.round((k / d) * 100) / 100;
}

export function normalizeHistoryEntry(value) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = clean(source.mode, 40) || 'unknown';
  const kills = int(source.kills), deaths = int(source.deaths);
  const at = Number.isFinite(Number(source.at)) ? Math.max(0, Math.floor(Number(source.at))) : 0;
  return {
    id: clean(source.id, 80) || `${mode}-${at}`,
    mode,
    modeName: clean(source.modeName, 40) || null,
    mapId: clean(source.mapId, 60) || null,
    mapName: clean(source.mapName, 60) || null,
    result: normalizeResult(source.result),
    kills,
    deaths,
    assists: int(source.assists),
    captures: int(source.captures),
    score: int(source.score),
    objectiveTime: clamp(num(source.objectiveTime), 0, 1e6),
    duration: clamp(num(source.duration), 0, 1e6),
    at,
    kd: kdRatio(kills, deaths),
  };
}

export function normalizeHistory(value) {
  const source = value && typeof value === 'object' ? value : {};
  const raw = Array.isArray(source.entries) ? source.entries : Array.isArray(value) ? value : [];
  const entries = raw
    .filter(item => item && typeof item === 'object')
    .map(normalizeHistoryEntry)
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_LIMIT);
  return {version: HISTORY_VERSION, entries};
}

export function emptyHistory() {
  return {version: HISTORY_VERSION, entries: []};
}

// Build a compact record from a match snapshot plus its map/mode metadata.
export function historyEntryFromResult(result = {}, meta = {}) {
  const actor = result?.actor || {};
  const stats = actor.scoreStats || {};
  const mode = clean(meta.mode ?? result?.mode, 40) || 'unknown';
  const at = Number.isFinite(Number(meta.at)) ? Math.floor(Number(meta.at)) : Date.now();
  const win = result?.win === true;
  return normalizeHistoryEntry({
    id: meta.id ?? `${mode}-${at}-${int(actor.frags)}`,
    mode,
    modeName: meta.modeName,
    mapId: meta.mapId ?? result?.mapId,
    mapName: meta.mapName,
    result: result?.draw === true ? 'draw' : win ? 'win' : 'loss',
    kills: actor.frags ?? result?.kills,
    deaths: actor.deaths ?? result?.deaths,
    assists: actor.assists ?? stats.assists,
    captures: stats.captures ?? actor.captures,
    score: meta.score ?? actor.frags,
    objectiveTime: stats.objectiveTime ?? actor.objectiveTime,
    duration: meta.duration ?? result?.time,
    at,
  });
}

export function recordMatch(history, entry) {
  const base = normalizeHistory(history);
  const next = normalizeHistoryEntry(entry);
  const entries = [next, ...base.entries.filter(existing => existing.id !== next.id)].slice(0, HISTORY_LIMIT);
  return {version: HISTORY_VERSION, entries};
}

// One leaderboard row per mode: record, totals, personal bests.
export function historyLeaderboard(history, {mode = null} = {}) {
  const rows = new Map();
  for (const entry of normalizeHistory(history).entries) {
    if (mode && entry.mode !== mode) continue;
    const row = rows.get(entry.mode) || {
      mode: entry.mode, label: entry.modeName, matches: 0, wins: 0, losses: 0, draws: 0,
      kills: 0, deaths: 0, bestKills: 0, bestKd: 0, bestScore: 0, bestTime: null, objectiveTime: 0, lastAt: 0,
    };
    row.matches += 1;
    if (entry.result === 'win') row.wins += 1;
    else if (entry.result === 'draw') row.draws += 1;
    else row.losses += 1;
    row.kills += entry.kills;
    row.deaths += entry.deaths;
    row.bestKills = Math.max(row.bestKills, entry.kills);
    row.bestKd = Math.max(row.bestKd, entry.kd);
    row.bestScore = Math.max(row.bestScore, entry.score);
    row.objectiveTime += entry.objectiveTime;
    row.lastAt = Math.max(row.lastAt, entry.at);
    if (entry.result === 'win' && entry.duration > 0) {
      row.bestTime = row.bestTime === null ? entry.duration : Math.min(row.bestTime, entry.duration);
    }
    if (!row.label && entry.modeName) row.label = entry.modeName;
    rows.set(entry.mode, row);
  }
  return [...rows.values()]
    .map(row => ({...row, kd: kdRatio(row.kills, row.deaths), winRate: row.matches ? row.wins / row.matches : 0}))
    .sort((a, b) => (b.wins - a.wins) || (b.bestKills - a.bestKills) || (b.kd - a.kd) || (b.matches - a.matches) || a.mode.localeCompare(b.mode));
}

export function historyTotals(history) {
  const entries = normalizeHistory(history).entries;
  const totals = {matches: entries.length, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, bestKills: 0, bestKd: 0, minutes: 0};
  for (const entry of entries) {
    if (entry.result === 'win') totals.wins += 1;
    else if (entry.result === 'draw') totals.draws += 1;
    else totals.losses += 1;
    totals.kills += entry.kills;
    totals.deaths += entry.deaths;
    totals.bestKills = Math.max(totals.bestKills, entry.kills);
    totals.bestKd = Math.max(totals.bestKd, entry.kd);
    totals.minutes += entry.duration / 60;
  }
  totals.kd = kdRatio(totals.kills, totals.deaths);
  totals.winRate = totals.matches ? totals.wins / totals.matches : 0;
  totals.minutes = Math.round(totals.minutes * 10) / 10;
  return totals;
}

export function historyModes(history) {
  return [...new Set(normalizeHistory(history).entries.map(entry => entry.mode))];
}

export function loadHistory() {
  try {
    return normalizeHistory(JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || 'null'));
  } catch {
    return emptyHistory();
  }
}

export function saveHistory(history) {
  const normalized = normalizeHistory(history);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
  return normalized;
}
