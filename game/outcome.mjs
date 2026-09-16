import {teamMode} from './config.mjs';

// Shared end-of-match ranking so the in-match leaderboard (Match.leaders), the
// award path (actorWon) and match history all read the same ordering.
const SCORE_STAT_FIELDS = ['captures', 'flagPickups', 'flagReturns', 'flagDrops', 'objectiveTime', 'objectiveCaptures', 'objectiveNeutralizations', 'objectiveContests', 'goals', 'shots', 'hits', 'damage'];
// Objective ranking counts only objective actions, never the raw shot/hit/damage
// output added for the end-of-match awards.
const OBJECTIVE_STAT_FIELDS = ['flagPickups', 'flagReturns', 'flagDrops', 'objectiveTime', 'objectiveCaptures', 'objectiveNeutralizations', 'objectiveContests', 'goals'];
const ZERO_STATS = Object.freeze(Object.fromEntries(SCORE_STAT_FIELDS.map(field => [field, 0])));
const objectiveActions = stats => OBJECTIVE_STAT_FIELDS.reduce((total, field) => total + stats[field], 0);

export const scoreStatsOf = actor => {
  const source = actor?.scoreStats;
  if (!source || typeof source !== 'object') return null;
  return Object.fromEntries(SCORE_STAT_FIELDS.map(field => [field, Number.isFinite(Number(source[field])) ? Number(source[field]) : 0]));
};

export const rankTuple = (actor, mode) => {
  const frags = Number(actor?.frags) || 0;
  if (mode === 'ctf' || mode === 'koth' || mode === 'domination' || mode === 'combined-arms' || mode === 'assault' || mode === 'payload' || mode === 'holdout' || mode === 'uplink' || mode === 'vip-escort') {
    const stats = scoreStatsOf(actor) ?? ZERO_STATS;
    if (mode === 'ctf') return [stats.captures, objectiveActions(stats), frags];
    if (mode === 'assault' || mode === 'payload') return [stats.objectiveCaptures, stats.objectiveTime, frags];
    if (mode === 'uplink') return [stats.objectiveCaptures, stats.objectiveContests, frags];
    if (mode === 'vip-escort') return [stats.objectiveCaptures, stats.objectiveTime, frags];
    return [stats.objectiveTime, stats.objectiveCaptures, frags];
  }
  if (mode === 'puma-soccer') return [scoreStatsOf(actor)?.goals ?? 0, frags];
  if (mode === 'armsrace') return [Number(actor?.ladder) || 0, frags];
  if (mode === 'juggernaut') return [Number(actor?.points) || 0, frags];
  return [frags];
};

export const compareRanks = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0; };

export const rankLeaders = (actors, mode) => {
  const list = (actors ?? []).map(actor => ({actor, rank: rankTuple(actor, mode)}));
  const best = list.reduce((winner, current) => !winner || compareRanks(current.rank, winner.rank) < 0 ? current : winner, null);
  return list.filter(item => compareRanks(item.rank, best?.rank ?? [0]) === 0).map(item => item.actor);
};

const topRank = (actors, mode) => (actors ?? []).reduce((top, item) => { const rank = rankTuple(item, mode); return !top || compareRanks(rank, top) < 0 ? rank : top; }, null);

// Shared end-of-match win decision for the local and authoritative award paths.
// Team modes must compare the actor's team against the authoritative winner;
// frag modes award everyone tied on the highest frag count (existing behavior).
export function actorWon(result, mode, actor) {
  if (!result || !actor) return false;
  if (mode === 'puma-race') {
    const winner = result.race?.winnerId ?? result.winner;
    return winner !== null && winner !== undefined && winner === actor.id;
  }
  if (teamMode(mode)) return result.winner !== null && result.winner !== undefined && result.winner === actor.team;
  if (mode === 'juggernaut') {
    // The crown is decided by points, not frags. The authoritative winner is the
    // crown holder at the end; fall back to the points ranking on time endings.
    if (result.winner !== null && result.winner !== undefined) return result.winner === actor.id;
    const best = topRank(result.actors, 'juggernaut');
    return Boolean(best) && best[0] > 0 && compareRanks(rankTuple(actor, 'juggernaut'), best) === 0;
  }
  if (mode === 'armsrace') {
    // An explicit finisher outranks any re-derived ladder/frag ranking.
    if (result.winner !== null && result.winner !== undefined) return result.winner === actor.id;
    // Rank by ladder first, then frags, mirroring Match.leaders so the awarded
    // winner matches the in-match leaderboard on time/sudden-death endings.
    const best = topRank(result.actors, 'armsrace');
    if (!best || (best[0] === 0 && best[1] === 0)) return false;
    return compareRanks(rankTuple(actor, 'armsrace'), best) === 0;
  }
  const best = topRank(result.actors, mode);
  return Boolean(best) && best[0] > 0 && compareRanks(rankTuple(actor, mode), best) === 0;
}
