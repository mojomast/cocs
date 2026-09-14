// Daily / rotating match challenges. Pure, deterministic and engine-free so the
// objective rotation, progress accounting and bonus-XP granting are testable and
// identical on every device for a given day seed.
export const CHALLENGE_VERSION = 1;
export const CHALLENGE_COUNT = 3;
export const CHALLENGE_STORAGE_KEY = 'token-arena-challenges';
export const MS_PER_DAY = 86400000;

// The rotating pool. `metric` names a counter derived from a match result; the
// optional `mode`/`team` gates decide which matches count toward the objective.
export const CHALLENGE_POOL = Object.freeze([
  {id: 'win-deathmatches', metric: 'wins', mode: 'deathmatch', target: 2, reward: 120, label: 'Win {target} Deathmatches'},
  {id: 'win-team-matches', metric: 'wins', team: true, target: 3, reward: 140, label: 'Win {target} team matches'},
  {id: 'capture-flags', metric: 'captures', mode: 'ctf', target: 3, reward: 150, label: 'Capture {target} enemy flags'},
  {id: 'return-flags', metric: 'flagReturns', mode: 'ctf', target: 2, reward: 120, label: 'Return {target} flags to base'},
  {id: 'reach-streak', metric: 'bestStreak', target: 5, reward: 160, label: 'Reach a {target} killstreak'},
  {id: 'eliminations', metric: 'kills', target: 25, reward: 130, label: 'Score {target} eliminations'},
  {id: 'objective-time', metric: 'objectiveTime', target: 60, reward: 110, label: 'Hold objectives for {target} seconds'},
  {id: 'play-matches', metric: 'matches', target: 3, reward: 90, label: 'Play {target} matches'},
  {id: 'win-matches', metric: 'wins', target: 3, reward: 130, label: 'Win {target} matches'},
  {id: 'win-objective', metric: 'wins', team: true, target: 2, reward: 150, label: 'Win {target} objective rounds'},
  {id: 'capture-zones', metric: 'objectiveCaptures', target: 2, reward: 150, label: 'Capture {target} control points'},
  {id: 'score-kills', metric: 'kills', target: 40, reward: 170, label: 'Score {target} eliminations'},
]);

function hashSeed(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function normalizeSeed(daySeed) {
  if (typeof daySeed === 'number' && Number.isFinite(daySeed)) return Math.floor(Math.abs(daySeed)) >>> 0;
  if (typeof daySeed === 'string' && daySeed) return hashSeed(daySeed);
  return 0;
}

export function daySeedFor(date = Date.now()) {
  const time = date instanceof Date ? date.getTime() : Number(date);
  if (!Number.isFinite(time)) return 0;
  return Math.floor(time / MS_PER_DAY);
}

export function currentDaySeed(now = Date.now()) {
  return daySeedFor(now);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function materialize(def) {
  return {...def, label: String(def.label).replace('{target}', String(def.target))};
}

export function dailyChallenges(daySeed = currentDaySeed()) {
  const seed = normalizeSeed(daySeed);
  const random = mulberry32(seed || 1);
  const pool = CHALLENGE_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool.slice(0, CHALLENGE_COUNT).map(materialize);
}

function nonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function normalizeChallengeState(value, daySeed) {
  const source = value && typeof value === 'object' ? value : {};
  const requested = daySeed === undefined ? (Number.isFinite(Number(source.daySeed)) ? source.daySeed : currentDaySeed()) : daySeed;
  const active = normalizeSeed(requested);
  const sameDay = Number.isFinite(Number(source.daySeed)) && normalizeSeed(source.daySeed) === active;
  const progress = {}, done = {};
  const sourceProgress = sameDay && source.progress && typeof source.progress === 'object' ? source.progress : {};
  const sourceDone = sameDay && source.done && typeof source.done === 'object' ? source.done : {};
  for (const def of dailyChallenges(active)) {
    progress[def.id] = nonNegative(sourceProgress[def.id]);
    done[def.id] = sourceDone[def.id] === true;
  }
  return {version: CHALLENGE_VERSION, daySeed: active, progress, done};
}

export function metricsFor(result = {}) {
  const actor = result?.actor || {};
  const stats = actor.scoreStats || {};
  return {
    matches: 1,
    wins: result?.win === true ? 1 : 0,
    kills: nonNegative(actor.frags),
    deaths: nonNegative(actor.deaths),
    captures: nonNegative(stats.captures),
    flagReturns: nonNegative(stats.flagReturns),
    objectiveCaptures: nonNegative(stats.objectiveCaptures),
    objectiveTime: nonNegative(stats.objectiveTime),
    bestStreak: Math.max(nonNegative(result?.bestStreak), nonNegative(actor.streak)),
  };
}

export function challengeMatches(def, result = {}) {
  if (def?.mode && result?.mode !== def.mode) return false;
  if (def?.team === true && result?.team !== true) return false;
  return true;
}

// Advance the day's counters by one match result and grant the bonus XP exactly
// once per objective. Safe to call on every match end: completed objectives are
// marked done and never pay out again.
export function applyMatch(state, result = {}) {
  const base = normalizeChallengeState(state);
  const metrics = metricsFor(result);
  const progress = {...base.progress};
  const done = {...base.done};
  let gained = 0;
  const completed = [];
  for (const def of dailyChallenges(base.daySeed)) {
    if (!challengeMatches(def, result)) continue;
    const current = nonNegative(progress[def.id]);
    const delta = nonNegative(metrics[def.metric]);
    progress[def.id] = current + delta;
    if (!done[def.id] && progress[def.id] >= def.target) {
      done[def.id] = true;
      gained += def.reward;
      completed.push(def);
    }
  }
  return {state: {version: CHALLENGE_VERSION, daySeed: base.daySeed, progress, done}, gained, completed, completedIds: completed.map(def => def.id)};
}

export function challengeStatus(state) {
  const normalized = normalizeChallengeState(state);
  return dailyChallenges(normalized.daySeed).map(def => {
    const progress = nonNegative(normalized.progress[def.id]);
    return {
      id: def.id,
      label: def.label,
      metric: def.metric,
      target: def.target,
      reward: def.reward,
      mode: def.mode ?? null,
      team: def.team === true,
      progress: Math.min(progress, def.target),
      done: normalized.done[def.id] === true,
    };
  });
}

export function completedChallenges(state) {
  return challengeStatus(state).filter(challenge => challenge.done);
}
