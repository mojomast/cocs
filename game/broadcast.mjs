import {GAME_MODES} from './config.mjs';
import {commandBrief,modeGoal,scoreText,teamName} from './hud.mjs';

// Turns a live menu-demo snapshot into the data behind the broadcast-style
// lower-third on the title screen: a news-desk readout of the current mode, map,
// score and objective. Pure data, no DOM, so the layout and the metric choice
// stay unit-testable and the React layer only renders.

const modeFor = id => GAME_MODES.find(mode => mode.id === id) || null;

export const formatClock = seconds => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const timeLeft = snap => {
  const limit = Number(snap?.config?.timeLimit), time = Number(snap?.time);
  if (!Number.isFinite(limit) || !Number.isFinite(time)) return null;
  return Math.max(0, limit - time);
};

const phaseFor = (snap, kind) => {
  if (kind === 'race') return String(snap?.race?.phase ?? 'racing').toUpperCase();
  if (kind === 'soccer') return String(snap?.race?.phase ?? 'live').toUpperCase();
  const limit = Number(snap?.config?.timeLimit), time = Number(snap?.time);
  const ratio = Number.isFinite(limit) && limit > 0 ? time / limit : 0;
  return ratio < 0.2 ? 'OPENING' : ratio < 0.72 ? 'CONTESTED' : 'CLOSING';
};

const kindFor = mode => {
  if (mode === 'puma-race') return 'race';
  if (mode === 'puma-soccer') return 'soccer';
  const rules = modeFor(mode)?.rules;
  return rules?.team ? 'team' : 'ffa';
};

const ranked = actors => [...(Array.isArray(actors) ? actors : [])]
  .filter(actor => actor && actor.spectator !== true)
  .sort((a, b) => (Number(b.frags) || 0) - (Number(a.frags) || 0));

const metric = (label, value) => ({label, value: value === null || value === undefined || value === '' ? '—' : typeof value === 'number' ? scoreText(value) : String(value)});

export function demoBroadcast(snapshot, options) {
  const {modeName = null, mapName = null} = options || {};
  const snap = snapshot || {};
  const mode = String(snap.config?.mode ?? snap.mode ?? 'deathmatch');
  const info = modeFor(mode);
  const label = modeName || info?.name || mode;
  const arena = mapName || snap.mapName || snap.mapId || 'ARENA';
  const actors = ranked(snap.actors);
  const brief = commandBrief(snap, actors[0], info);
  const kind = kindFor(mode);
  const goal = modeGoal(info);
  const left = timeLeft(snap);
  const clockText = left === null ? formatClock(snap.time) : formatClock(left);

  let teams = null;
  if (kind === 'team' && snap.teamScores) {
    teams = [0, 1].map(team => ({team, name: teamName(team), score: Number(snap.teamScores[team]) || 0}));
  }

  const leader = actors[0] || null;
  const standings = actors.slice(0, 3).map((actor, index) => ({rank: index + 1, name: String(actor.name || `BOT ${actor.id}`), frags: Number(actor.frags) || 0, team: Number.isFinite(actor.team) ? actor.team : null}));

  let metrics;
  if (kind === 'race') {
    const race = snap.race || {};
    const rows = Array.isArray(race.standings) ? [...race.standings].sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99)) : [];
    const front = rows[0];
    const laps = race.laps || snap.config?.fragLimit || 3;
    const gates = Array.isArray(race.gates) ? race.gates.length : (Number(race.gates) || 0);
    metrics = [
      metric('LEADER', front ? String(actors.find(actor => actor.id === front.actorId)?.name || front.name || `A${front.actorId}`) : '—'),
      metric('LAP', `${Math.min(laps, Number(front?.lap) || 1)} / ${laps}`),
      metric('GATES', gates || '—'),
      metric('TIME', clockText),
    ];
  } else if (kind === 'soccer') {
    const scores = snap.teamScores || {};
    metrics = [
      metric('RED', Number(scores[0]) || 0),
      metric('BLUE', Number(scores[1]) || 0),
      metric('PHASE', String(snap.race?.phase ?? 'live').toUpperCase()),
      metric('TIME', clockText),
    ];
  } else if (kind === 'team') {
    metrics = [
      metric(teams[0].name, teams[0].score),
      metric(teams[1].name, teams[1].score),
      metric(goal, snap.config?.fragLimit ?? '—'),
      metric('CLOCK', clockText),
    ];
  } else if (mode === 'armsrace') {
    metrics = [
      metric('LEADER', leader ? String(leader.name || `BOT ${leader.id}`) : '—'),
      metric('RUNG', `${(Number(leader?.ladder) || 0) + 1} / 10`),
      metric('FRAGS', Number(leader?.frags) || 0),
      metric('CLOCK', clockText),
    ];
  } else if (mode === 'juggernaut') {
    metrics = [
      metric('LEADER', leader ? String(leader.name || `BOT ${leader.id}`) : '—'),
      metric('POINTS', Number(leader?.points) || 0),
      metric('CROWN', leader?.juggernaut ? 'HELD' : 'OPEN'),
      metric('CLOCK', clockText),
    ];
  } else {
    metrics = [
      metric('LEADER', leader ? String(leader.name || `BOT ${leader.id}`) : '—'),
      metric(goal, Number(leader?.frags) || 0),
      metric('TARGET', snap.config?.fragLimit ?? '—'),
      metric('CLOCK', clockText),
    ];
  }

  const ticker = [
    `${actors.length} OPERATORS · ${label.toUpperCase()} · ${String(arena).toUpperCase()}`,
    brief?.status ? String(brief.status) : null,
    brief?.detail ? String(brief.detail) : null,
    leader ? `${String(leader.name || `BOT ${leader.id}`).toUpperCase()} SETS THE PACE · ${Number(leader.frags) || 0} ${goal}` : null,
  ].filter(Boolean);

  return {
    live: true,
    modeId: mode,
    modeName: label,
    mapName: arena,
    kind,
    phase: phaseFor(snap, kind),
    clock: clockText,
    goal,
    headline: brief?.title || label.toUpperCase(),
    action: brief?.action || '',
    status: brief?.status || '',
    detail: brief?.detail || '',
    teams,
    leader: leader ? {name: String(leader.name || `BOT ${leader.id}`), frags: Number(leader.frags) || 0} : null,
    standings,
    metrics,
    ticker: ticker.slice(0, 4),
    operatorCount: actors.length,
    scoreText: scoreText,
  };
}
