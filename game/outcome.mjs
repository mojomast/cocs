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
  const frags = (result.actors ?? []).map(item => Number(item.frags) || 0);
  const max = frags.length ? Math.max(...frags) : 0;
  return max > 0 && (Number(actor.frags) || 0) === max;
}
