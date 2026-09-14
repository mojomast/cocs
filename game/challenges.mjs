// Daily / rotating match challenges. Pure, deterministic and engine-free so the
// objective rotation, progress accounting and bonus-XP granting are testable and
// identical on every device for a given day seed.
export const CHALLENGE_VERSION = 1;
export const CHALLENGE_COUNT = 3;
export const WEEKLY_CHALLENGE_COUNT = 3;
export const CHALLENGE_STORAGE_KEY = 'token-arena-challenges';
export const MS_PER_DAY = 86400000;
export const MS_PER_WEEK = MS_PER_DAY * 7;

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

// The weekly rotation runs longer, pays more and leans on the rarer counters
// (flawless rounds, big objective holds) so it does not read like a louder
// daily. Selected from its own seed so the two rotations never move in step.
export const WEEKLY_POOL = Object.freeze([
  {id: 'week-eliminations', metric: 'kills', target: 60, reward: 320, label: 'Score {target} eliminations this week'},
  {id: 'week-wins', metric: 'wins', target: 6, reward: 340, label: 'Win {target} matches this week'},
  {id: 'week-captures', metric: 'captures', mode: 'ctf', target: 6, reward: 360, label: 'Capture {target} enemy flags this week'},
  {id: 'week-objective', metric: 'objectiveTime', target: 180, reward: 300, label: 'Hold objectives for {target} seconds this week'},
  {id: 'week-matches', metric: 'matches', target: 12, reward: 280, label: 'Play {target} matches this week'},
  {id: 'week-flawless', metric: 'flawlessWins', target: 2, reward: 400, label: 'Win {target} matches without dying'},
  {id: 'week-streak', metric: 'bestStreak', target: 8, reward: 360, label: 'Reach a {target} killstreak this week'},
  {id: 'week-zones', metric: 'objectiveCaptures', target: 5, reward: 340, label: 'Capture {target} control points this week'},
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

function shufflePool(pool, seed, count) {
  const random = mulberry32(seed || 1);
  const list = pool.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = list[i];
    list[i] = list[j];
    list[j] = swap;
  }
  return list.slice(0, count).map(materialize);
}

export function dailyChallenges(daySeed = currentDaySeed()) {
  return shufflePool(CHALLENGE_POOL, normalizeSeed(daySeed), CHALLENGE_COUNT);
}

// Weeks are anchored to Monday 2024-01-01 UTC so every device agrees on the
// rotation boundary regardless of timezone.
const WEEK_ANCHOR = Date.UTC(2024, 0, 1);
export function weekSeedFor(date = Date.now()) {
  const time = date instanceof Date ? date.getTime() : Number(date);
  if (!Number.isFinite(time)) return 0;
  return Math.floor((time - WEEK_ANCHOR) / MS_PER_WEEK);
}

export function currentWeekSeed(now = Date.now()) {
  return weekSeedFor(now);
}

export function weeklyChallenges(weekSeed = currentWeekSeed()) {
  const seed = (normalizeSeed(weekSeed) ^ 0x9e3779b9) >>> 0;
  return shufflePool(WEEKLY_POOL, seed, WEEKLY_CHALLENGE_COUNT);
}

function nonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function normalizeChallengeState(value, daySeed, weekSeed) {
  const source = value && typeof value === 'object' ? value : {};
  const requested = daySeed === undefined ? (Number.isFinite(Number(source.daySeed)) ? source.daySeed : currentDaySeed()) : daySeed;
  const active = normalizeSeed(requested);
  const sameDay = Number.isFinite(Number(source.daySeed)) && normalizeSeed(source.daySeed) === active;
  const requestedWeek = weekSeed === undefined ? (Number.isFinite(Number(source.weekSeed)) ? source.weekSeed : currentWeekSeed()) : weekSeed;
  const activeWeek = normalizeSeed(requestedWeek);
  const sameWeek = Number.isFinite(Number(source.weekSeed)) && normalizeSeed(source.weekSeed) === activeWeek;
  const progress = {}, done = {}, weeklyProgress = {}, weeklyDone = {};
  const sourceProgress = sameDay && source.progress && typeof source.progress === 'object' ? source.progress : {};
  const sourceDone = sameDay && source.done && typeof source.done === 'object' ? source.done : {};
  const sourceWeeklyProgress = sameWeek && source.weeklyProgress && typeof source.weeklyProgress === 'object' ? source.weeklyProgress : {};
  const sourceWeeklyDone = sameWeek && source.weeklyDone && typeof source.weeklyDone === 'object' ? source.weeklyDone : {};
  for (const def of dailyChallenges(active)) {
    progress[def.id] = nonNegative(sourceProgress[def.id]);
    done[def.id] = sourceDone[def.id] === true;
  }
  for (const def of weeklyChallenges(activeWeek)) {
    weeklyProgress[def.id] = nonNegative(sourceWeeklyProgress[def.id]);
    weeklyDone[def.id] = sourceWeeklyDone[def.id] === true;
  }
  return {version: CHALLENGE_VERSION, daySeed: active, weekSeed: activeWeek, progress, done, weeklyProgress, weeklyDone};
}

export function metricsFor(result = {}) {
  const actor = result?.actor || {};
  const stats = actor.scoreStats || {};
  const win = result?.win === true;
  return {
    matches: 1,
    wins: win ? 1 : 0,
    flawlessWins: win && nonNegative(actor.deaths) === 0 ? 1 : 0,
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

function advanceGroup(result, defs, progress, done) {
  const metrics = metricsFor(result);
  let gained = 0;
  const completed = [];
  for (const def of defs) {
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
  return {gained, completed};
}

// Advance the day's counters by one match result and grant the bonus XP exactly
// once per objective. Safe to call on every match end: completed objectives are
// marked done and never pay out again.
export function applyMatch(state, result = {}) {
  const base = normalizeChallengeState(state);
  const progress = {...base.progress};
  const done = {...base.done};
  const {gained, completed} = advanceGroup(result, dailyChallenges(base.daySeed), progress, done);
  return {state: {...base, progress, done}, gained, completed, completedIds: completed.map(def => def.id)};
}

// The weekly counterpart. Kept separate from applyMatch so existing callers
// (and tests) that only speak daily objectives keep their exact behaviour.
export function applyWeeklyMatch(state, result = {}) {
  const base = normalizeChallengeState(state);
  const weeklyProgress = {...base.weeklyProgress};
  const weeklyDone = {...base.weeklyDone};
  const {gained, completed} = advanceGroup(result, weeklyChallenges(base.weekSeed), weeklyProgress, weeklyDone);
  return {state: {...base, weeklyProgress, weeklyDone}, gained, completed, completedIds: completed.map(def => def.id)};
}

// One match end advances both rotations and reports the combined payout.
export function applyMatchAll(state, result = {}) {
  const daily = applyMatch(state, result);
  const weekly = applyWeeklyMatch(daily.state, result);
  const completed = [...daily.completed, ...weekly.completed];
  return {
    state: weekly.state,
    gained: daily.gained + weekly.gained,
    completed,
    completedIds: completed.map(def => def.id),
    daily,
    weekly,
  };
}

function statusRows(normalized, defs, progress, done) {
  return defs.map(def => {
    const value = nonNegative(progress[def.id]);
    return {
      id: def.id,
      label: def.label,
      metric: def.metric,
      target: def.target,
      reward: def.reward,
      mode: def.mode ?? null,
      team: def.team === true,
      progress: Math.min(value, def.target),
      done: done[def.id] === true,
    };
  });
}

export function challengeStatus(state) {
  const normalized = normalizeChallengeState(state);
  return statusRows(normalized, dailyChallenges(normalized.daySeed), normalized.progress, normalized.done);
}

export function weeklyStatus(state) {
  const normalized = normalizeChallengeState(state);
  return statusRows(normalized, weeklyChallenges(normalized.weekSeed), normalized.weeklyProgress, normalized.weeklyDone);
}

export function completedChallenges(state) {
  return challengeStatus(state).filter(challenge => challenge.done);
}

export function completedWeeklyChallenges(state) {
  return weeklyStatus(state).filter(challenge => challenge.done);
}
