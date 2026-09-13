import {teamMode} from './config.mjs';

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
  if (mode === 'armsrace') {
    // Rank by ladder first, then frags, mirroring Match.leaders so the awarded
    // winner matches the in-match leaderboard on time/sudden-death endings.
    const ladder = item => Number(item.ladder) || 0;
    const frags = item => Number(item.frags) || 0;
    const top = Math.max(0, ...(result.actors ?? []).map(ladder));
    const cascade = (result.actors ?? []).filter(item => ladder(item) === top);
    const max = cascade.length ? Math.max(0, ...cascade.map(frags)) : 0;
    return (top > 0 || max > 0) && ladder(actor) === top && frags(actor) === max;
  }
  const frags = (result.actors ?? []).map(item => Number(item.frags) || 0);
  const max = frags.length ? Math.max(...frags) : 0;
  return max > 0 && (Number(actor.frags) || 0) === max;
}
