import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {teamMode} from '../game/config.mjs';
import {rankLeaders, scoreStatsOf} from '../game/outcome.mjs';

export const HISTORY_CAP = 50;
const RACE_STANDING_FIELDS = ['actorId', 'vehicleId', 'position', 'lap', 'completedLaps', 'nextGate', 'progress', 'finishTime', 'item', 'effects'];

export class MatchHistory {
 constructor(file = null, options = {}) {
  this.file = file ? path.resolve(file) : null;
  this.max = Math.max(1, options.max ?? HISTORY_CAP);
  this.matches = [];
  this.version = 0;
  if (this.file) this.load();
 }
 load() {
  try {
   const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (Array.isArray(raw)) this.matches = raw.filter(m => m && typeof m === 'object' && Array.isArray(m.players)).slice(0, this.max);
  } catch { this.matches = []; }
 }
  record({ result = null, roomId = 'local', mapId = result?.mapId ?? 'exchange', config = result?.config ?? {}, time = result?.time ?? 0, actors = result?.actors ?? [], teamScores = null, winner = null, endingReason = null, race = null } = {}) {
   const fragLimit = Number.isFinite(config.fragLimit) ? config.fragLimit : 0;
   const mode = config.mode ?? 'deathmatch';
    const isTeamMode = teamMode(mode);
    const raceSource = mode === 'puma-race' ? race ?? result?.race : null;
    const raceResult = raceSource ? {
     ...Object.fromEntries(['winnerId', 'elapsed', 'laps', 'phase'].filter(field => field in raceSource).map(field => [field, raceSource[field]])),
     standings: (raceSource.standings ?? []).map(standing => structuredClone(Object.fromEntries(RACE_STANDING_FIELDS.filter(field => field in standing).map(field => [field, standing[field]]))))
    } : null;
    const winnerActorId = raceResult?.winnerId ?? result?.winner ?? winner;
   const scores = teamScores ?? result?.teamScores;
    let normalizedScores = scores && typeof scores === 'object' ? { 0: Number(scores[0]), 1: Number(scores[1]) } : null;
    if (normalizedScores) {
     normalizedScores[0] = Number.isFinite(normalizedScores[0]) ? normalizedScores[0] : 0;
     normalizedScores[1] = Number.isFinite(normalizedScores[1]) ? normalizedScores[1] : 0;
    }
   if (isTeamMode && !normalizedScores && mode === 'teamdeathmatch') {
    normalizedScores = { 0: 0, 1: 0 };
    for (const actor of actors) if (actor.team === 0 || actor.team === 1) normalizedScores[actor.team] += Number(actor.frags) || 0;
   }
   const scoreWinner = normalizedScores && normalizedScores[0] !== normalizedScores[1]
    ? (normalizedScores[0] > normalizedScores[1] ? 0 : 1) : null;
   const scoreReached = normalizedScores && fragLimit > 0 && [0, 1].some(team => normalizedScores[team] >= fragLimit);
    const reason = endingReason ?? result?.endingReason ?? (mode === 'puma-race' ? result?.overReason ?? (raceResult?.standings.some(s => s.finishTime != null) ? 'race-finish' : 'time') : null) ?? (isTeamMode
    ? (scoreReached ? (mode === 'ctf' ? 'capture' : mode === 'teamdeathmatch' ? 'frag' : 'objective') : 'time')
    : (fragLimit > 0 && actors.some(a => a.frags >= fragLimit) ? 'frag' : 'time'));
   const entry = {
   id: randomUUID(),
   roomId,
   mapId,
    mode,
   fragLimit,
   timeLimit: Number.isFinite(config.timeLimit) ? config.timeLimit : 0,
    endedBy: reason,
   duration: Math.round(time * 10) / 10,
     leader: (() => {
      if (mode === 'puma-race') return actors.find(actor => actor.id === winnerActorId)?.name || 'Arena';
     return rankLeaders(actors, mode).map(actor => actor.name).join(' & ') || 'Arena';
    })(),
    players: actors.map(a => ({ name: a.name, character: a.character, harness: a.harness, frags: a.frags, deaths: a.deaths, ...(scoreStatsOf(a) ? { scoreStats: scoreStatsOf(a) } : {}) }))
    };
    if (mode === 'puma-race') {
     entry.winnerActorId = winnerActorId;
     if (raceResult) entry.race = raceResult;
     entry.players.forEach((player, index) => {
      player.actorId = actors[index].id;
      const standing = raceResult?.standings.find(standing => standing.actorId === player.actorId);
      if (standing) player.race = structuredClone(standing);
     });
    }
   if (isTeamMode && normalizedScores) {
    entry.teamScores = normalizedScores;
    entry.winner = winner ?? result?.winner ?? scoreWinner;
   }
  this.matches.unshift(entry);
  this.matches = this.matches.slice(0, this.max);
  this.version++;
  this.persist();
  return entry;
 }
 persist() {
  if (!this.file) return true;
  const dir = path.dirname(this.file);
  const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
   fs.mkdirSync(dir, { recursive: true });
   fs.writeFileSync(tmp, JSON.stringify(this.matches, null, 1));
   fs.renameSync(tmp, this.file);
   this._dirty = false; this._retryAt = 0; this._failures = 0; this.lastPersistError = null;
   return true;
  } catch (error) {
   // Keep the newest in-memory record and retry later instead of throwing out
   // of the room tick (which would take the whole server process down).
   this._dirty = true; this.lastPersistError = error;
   this._failures = (this._failures ?? 0) + 1;
   this._retryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(this._failures - 1, 5));
   try { fs.unlinkSync(tmp); } catch {}
   return false;
  }
 }
 flush() {
  if (!this.file || !this._dirty) return true;
  if (this._retryAt && Date.now() < this._retryAt) return false;
  return this.persist();
 }
   all() { return structuredClone(this.matches); }
}
