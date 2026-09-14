import {raceDisplay,soccerDisplay} from './race-ui.mjs';
import {WEAPONS} from './data.mjs';
import {teamMode} from './config.mjs';

export function vehicleHud(player, vehicles = [], flags = [], spectate = false) {
  if (spectate || !player || !(player.health > 0)) return {vehicle: null, prompt: ''};
  const vehicle = vehicles.find(v => v.id === player.vehicleId && v.driver === player.id && v.health > 0);
  if (vehicle) return {vehicle, prompt: 'E / EXIT PUMA'};
  const canEnter = player.vehicleId == null && !flags.some(flag => flag.carrier === player.id) && vehicles.some(v =>
    v.health > 0 && v.respawnTimer <= 0 && v.driver === null && Math.hypot(player.x - v.x, player.z - v.z) < 2.4);
  return {vehicle: null, prompt: canEnter ? 'E / ENTER PUMA' : ''};
}

export const escapeHint = online => online ? 'ESC / LOBBY (MATCH CONTINUES)' : 'ESC / PAUSE';

export const voiceHint = (enabled, mode) => {
  if (!enabled) return null;
  if (mode === 'ptt') return 'V / TALK';
  if (mode === 'auto') return 'VOICE / AUTO TALK';
  return 'VOICE ON';
};

export function reloadProgress(actor) {
  if (!actor?.reloading) return 0;
  const duration = Number(actor.reloadDuration), timer = Number(actor.reloadTimer);
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  const elapsed = Number.isFinite(timer) ? 1 - timer / duration : 1;
  return Math.max(0, Math.min(1, elapsed));
}

export function dynamicCrosshairGap(spread, base = 1) {
  const radians = Number.isFinite(spread) ? Math.max(0, spread) : 0;
  const scale = Number.isFinite(base) && base > 0 ? base : 1;
  return Math.round(Math.min(24, radians * 320) * scale * 10) / 10;
}

export function lowAmmo(actor, weapons = []) {
  const weapon = weapons?.[actor?.weapon];
  if (!weapon) return false;
  const cap = Number(weapon.cap), remaining = Number(actor?.ammo?.[actor.weapon]);
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(remaining)) return false;
  return remaining > 0 && remaining <= cap * .25;
}

export function postureLabel(actor) {
  if (!actor) return null;
  if (actor.sliding) return 'SLIDE';
  if (actor.crouching) return 'CROUCH';
  if (actor.sprinting) return 'SPRINT';
  return null;
}

export function hitMarker(hud, player) {
  const latest = hud?.feed?.[0], when = Number(hud?.time), at = Number(latest?.time);
  const killed = Boolean(latest && player && latest.killer === player.name && !latest.self && (!Number.isFinite(when) || !Number.isFinite(at) || when - at < 2));
  if (killed) return 'kill';
  return hud?.hit ? 'hit' : null;
}

const matrixPoint = (elements, x, y, z) => ({
  x: elements[0] * x + elements[4] * y + elements[8] * z + elements[12],
  y: elements[1] * x + elements[5] * y + elements[9] * z + elements[13],
  z: elements[2] * x + elements[6] * y + elements[10] * z + elements[14],
  w: elements[3] * x + elements[7] * y + elements[11] * z + elements[15],
});

export function projectToScreen(camera, rect, position) {
  const world = camera?.matrixWorldInverse?.elements, projection = camera?.projectionMatrix?.elements;
  if (!world || !projection || !rect || !position) return null;
  const x = Number(position.x), y = Number(position.y), z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const view = matrixPoint(world, x, y, z), clip = matrixPoint(projection, view.x, view.y, view.z);
  if (!Number.isFinite(clip.w) || clip.w <= 0) return null;
  const ndcX = clip.x / clip.w, ndcY = clip.y / clip.w, ndcZ = clip.z / clip.w;
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY) || !Number.isFinite(ndcZ) || ndcZ < -1 || ndcZ > 1) return null;
  const width = Number(rect.width) || 0, height = Number(rect.height) || 0;
  return {x: (Number(rect.left) || 0) + (ndcX + 1) * .5 * width, y: (Number(rect.top) || 0) + (1 - ndcY) * .5 * height, depth: ndcZ};
}

export function damageNumberStyle(age, {lifetime = .6, rise = 28, reduced = false} = {}) {
  const life = Number.isFinite(lifetime) && lifetime > 0 ? lifetime : .6;
  const progress = Math.max(0, Math.min(1, (Number.isFinite(age) ? Math.max(0, age) : 0) / life));
  return {opacity: 1 - progress * progress, dy: reduced || progress === 0 ? 0 : -rise * progress, done: progress >= 1};
}

export function boundList(list, item, cap = 12) {
  const limit = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 12;
  const next = Array.isArray(list) ? list.slice() : [];
  next.push(item);
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function damageBearing(local, target) {
  if (!local || !target) return null;
  const dx = Number(target.x) - Number(local.x), dz = Number(target.z) - Number(local.z);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  const yaw = Number.isFinite(Number(local.yaw)) ? Number(local.yaw) : 0;
  let angle = Math.atan2(-dx, -dz) - yaw;
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  return {angle, distance: Math.hypot(dx, dz)};
}

export function killBanner(hud, player) {
  const latest = hud?.feed?.[0], when = Number(hud?.time), at = Number(latest?.time);
  if (!latest || !player || !Number.isFinite(at) || !Number.isFinite(when)) return null;
  const age = Math.max(0, when - at);
  if (latest.self && latest.victim === player.name) return {kind: 'self', text: 'ELIMINATED', age};
  if (latest.killer === player.name && latest.victim !== player.name) return {kind: 'kill', text: `YOU ELIMINATED ${latest.victim ?? ''}`.trim(), age};
  if (latest.victim === player.name && latest.killer !== player.name) return {kind: 'death', text: `${latest.killer ?? 'ARENA'} ELIMINATED YOU`, age};
  return null;
}

export function weaponTag(weapon) {
  if (!weapon) return null;
  const interval = Number(weapon.interval);
  if (!Number.isFinite(interval)) return null;
  return interval <= .3 ? 'AUTO' : 'SEMI';
}

export function ammoText(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '∞';
}

// Short weapon name for a kill-feed entry, or null for environment kills.
export function killFeedWeapon(entry, weapons = []) {
  if (!entry || !Number.isInteger(entry.weapon)) return null;
  return weapons[entry.weapon]?.short ?? null;
}

export const teamName = team => Number(team) === 0 ? 'RED' : Number(team) === 1 ? 'BLUE' : `TEAM ${team}`;

export function suddenDeathBanner(hud) {
  return hud?.suddenDeath === true && hud?.over !== true ? { text: 'SUDDEN DEATH', detail: 'NEXT SCORE WINS' } : null;
}

const CAPTION_EVENTS = Object.freeze({shot:'Gunfire',explosion:'Explosion','vehicle-shot':'Vehicle gunfire',grenade:'Grenade out',melee:'Melee',reload:'Reloading',pickup:'Pickup',powerup:'Powerup','vehicle-destroyed':'Vehicle destroyed','zone-capture':'Zone captured','zone-score':'Objective scoring','zone-neutralized':'Zone neutralized','flag-pickup':'Flag taken','flag-return':'Flag returned','flag-drop':'Flag dropped',capture:'Flag captured','assault-breach':'Sector breached','payload-checkpoint':'Checkpoint reached','payload-delivered':'Payload delivered','soccer-goal':'Goal','killstreak':'Killstreak',death:'Elimination','mission-message':'Mission update','mission-won':'Mission complete','mission-lost':'Mission failed','horde-wave':'Wave incoming','horde-wave-cleared':'Wave cleared','horde-resupply':'Resupplied','horde-upgrade':'Upgrade available','horde-upgrade-selected':'Upgrade acquired','enemy-detonate':'Sapper detonation','singleplayer-checkpoint':'Checkpoint saved','npc-deploy':'Contacts','story-line':'Mission briefing','npc-bark':'Transmission','boss-phase':'Boss phase'});
export function ladderStatus(player, total = 10) {
  const rung = Math.max(0, Math.floor(Number(player?.ladder) || 0));
  const size = Math.max(1, Math.floor(Number(total) || 10));
  return { rung, total: size, label: rung >= size - 1 ? 'LADDER FINAL' : `LADDER ${rung + 1}/${size}` };
}

export function streakStatus(player) {
  const streak = Math.max(0, Math.floor(Number(player?.streak) || 0));
  return streak >= 2 ? { streak, label: `${streak} STREAK` } : null;
}

export function audioCaption(event) {
  const text = CAPTION_EVENTS[event?.type];
  return text ? { text } : null;
}

export function grenadeStatus(player) {
  const cooldown = Math.max(0, Number(player?.grenadeCooldown) || 0);
  return { ready: cooldown <= 0, cooldown, label: cooldown <= 0 ? 'FRAG READY' : `FRAG ${cooldown.toFixed(1)}s` };
}

export function matchStartBanner(hud, duration = 2.6, mode) {
  const time = Number(hud?.time), limit = Number.isFinite(duration) && duration > 0 ? duration : 2.6;
  if (!Number.isFinite(time) || time < 0 || time >= limit) return null;
  const target = Number(hud?.config?.fragLimit);
  const objective = mode ? modeTargetText(mode, target) : null;
  const detail = [hud?.modeName, hud?.mapName, objective].filter(Boolean).join(' · ').toUpperCase();
  return {text: 'FIGHT', detail, age: time, duration: limit};
}

const MULTIKILL_LABELS = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'OVERKILL', 'MONSTER KILL', 'MEGA KILL'];
const SPREE_LABELS = ['KILLING SPREE', 'RAMPAGE', 'DOMINATING', 'UNSTOPPABLE', 'GODLIKE', 'LEGENDARY'];

export function multikillLabel(count) {
  const n = Math.floor(Number(count) || 0);
  if (n < 2) return null;
  return MULTIKILL_LABELS[Math.min(n, MULTIKILL_LABELS.length - 1)];
}

export function killstreakCallout(event) {
  const streak = Math.floor(Number(event?.streak) || 0);
  if (streak <= 0 || !event?.reward) return null;
  return { kind: 'streak', text: `${streak} KILLSTREAK`, detail: String(event.reward).toUpperCase() };
}

export function spreeLabel(streak) {
  const n = Math.floor(Number(streak) || 0);
  if (n < 5 || n % 5 !== 0) return null;
  return SPREE_LABELS[Math.min(n / 5 - 1, SPREE_LABELS.length - 1)];
}

export function recentKills(kills, now, window = 4) {
  const t = Number(now), span = Number(window) > 0 ? Number(window) : 4;
  if (!Number.isFinite(t)) return 0;
  return (Array.isArray(kills) ? kills : []).filter(value => Number.isFinite(Number(value)) && t - Number(value) >= 0 && t - Number(value) <= span).length;
}

export function killCallout(kills, now, {window = 4} = {}) {
  const list = Array.isArray(kills) ? kills.filter(value => Number.isFinite(Number(value))) : [];
  const streak = list.length;
  if (streak <= 0) return null;
  const spree = spreeLabel(streak);
  if (spree) return {kind: 'spree', text: spree, detail: `${streak} KILL STREAK`, streak};
  const count = recentKills(list, now, window), multi = multikillLabel(count);
  if (multi) return {kind: 'multikill', text: multi, detail: `${streak} KILL STREAK`, streak, count};
  return null;
}

export function scoreAnnouncer(hud, prevScores) {
  const scores = hud?.teamScores;
  if (!scores || !prevScores) return null;
  const mode = hud?.config?.mode ?? hud?.mode, capture = mode === 'ctf', soccer = mode === 'puma-soccer';
  for (const team of [0, 1]) {
    const before = Math.floor(Number(prevScores[team])), after = Math.floor(Number(scores[team]));
    if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) continue;
    return {team, kind: soccer ? 'goal' : capture ? 'capture' : 'score', text: soccer ? `${teamName(team)} GOAL` : capture ? 'FLAG CAPTURED' : `${teamName(team)} SCORES`, score: after, amount: after - before};
  }
  return null;
}

const awardScore = actor => (Number(actor?.frags) || 0) * 3 + stat(actor, 'objectiveTime') + stat(actor, 'captures') * 5 + stat(actor, 'flagReturns') * 2;
const stat = (actor, field) => Number(actor?.scoreStats?.[field]) || 0;
const ratio = actor => { const kills = Number(actor?.frags) || 0, deaths = Number(actor?.deaths) || 0; return deaths > 0 ? kills / deaths : kills; };

export function matchAwards(hud) {
  const actors = (Array.isArray(hud?.actors) ? hud.actors : []).filter(actor => actor && actor.name && Number.isFinite(Number(actor.id)));
  if (actors.length < 2) return [];
  const top = score => actors.reduce((best, actor) => score(actor) > score(best) ? actor : best, actors[0]);
  const awards = [];
  const mvp = top(awardScore);
  if (awardScore(mvp) > 0) awards.push({id: 'mvp', label: 'MATCH MVP', name: mvp.name, value: `${Number(mvp.frags) || 0} FRAGS`});
  const objective = top(actor => stat(actor, 'objectiveTime'));
  if (stat(objective, 'objectiveTime') > 0) awards.push({id: 'objective', label: 'MOST OBJECTIVE TIME', name: objective.name, value: `${stat(objective, 'objectiveTime').toFixed(1)}s`});
  const runner = top(actor => stat(actor, 'captures') * 3 + stat(actor, 'flagReturns') * 2 + stat(actor, 'flagPickups'));
  if (stat(runner, 'captures') + stat(runner, 'flagReturns') + stat(runner, 'flagPickups') > 0) awards.push({id: 'flag', label: 'FLAG RUNNER', name: runner.name, value: `${stat(runner, 'captures')} CAP · ${stat(runner, 'flagReturns')} RET`});
  const accurate = top(ratio);
  if (ratio(accurate) >= 1) awards.push({id: 'ratio', label: 'BEST K/D', name: accurate.name, value: ratio(accurate).toFixed(2)});
  const flagHands = top(actor => stat(actor, 'captures'));
  if (stat(flagHands, 'captures') > 0) awards.push({id: 'captures', label: 'MOST CAPTURES', name: flagHands.name, value: `${stat(flagHands, 'captures')} CAP`});
  const sharpshooter = top(actor => { const shots = stat(actor, 'shots'); return shots > 0 ? stat(actor, 'hits') / shots : 0; });
  const shots = stat(sharpshooter, 'shots');
  if (shots > 0) awards.push({id: 'accuracy', label: 'BEST ACCURACY', name: sharpshooter.name, value: `${Math.round((stat(sharpshooter, 'hits') / shots) * 100)}%`});
  const bruiser = top(actor => stat(actor, 'damage'));
  if (stat(bruiser, 'damage') > 0) awards.push({id: 'damage', label: 'MOST DAMAGE', name: bruiser.name, value: `${Math.round(stat(bruiser, 'damage'))}`});
  const survivor = top(actor => (Number(actor.frags) || 0) > 0 && (Number(actor.deaths) || 0) === 0 ? 1 : 0);
  if ((Number(survivor.frags) || 0) > 0 && (Number(survivor.deaths) || 0) === 0) awards.push({id: 'flawless', label: 'UNTOUCHABLE · NO DEATHS', name: survivor.name, value: '0 DEATHS'});
  const generous = top(actor => Number(actor.deaths) || 0);
  if ((Number(generous.deaths) || 0) > 0) awards.push({id: 'deaths', label: 'FEED PROVIDER', name: generous.name, value: `${Number(generous.deaths) || 0} DEATHS`});
  return awards;
}

// Weapon range identity: a coarse SHORT/MID/LONG band plus the effective
// (full-damage) distance and, when the weapon falls off, the retained fraction.
export function weaponRangeInfo(weapon) {
  const range = Number(weapon?.range) || 0;
  const falloff = weapon?.falloff;
  const start = falloff ? Number(falloff.start) || 0 : range;
  const end = falloff ? Number(falloff.end) || range : range;
  const band = range <= 26 ? 'SHORT' : range <= 60 ? 'MID' : 'LONG';
  return { band, start, end, range, factor: falloff && Number.isFinite(Number(falloff.min)) ? Number(falloff.min) : 1 };
}

export function weaponRangeLabel(weapon) {
  const info = weaponRangeInfo(weapon);
  const span = info.factor < 1 ? `${Math.round(info.start)}–${Math.round(info.end)}m · ${Math.round(info.factor * 100)}%` : `${Math.round(info.range)}m`;
  return `${info.band} · ${span}`;
}

// Connection quality from the client's jitter/loss/interpolation estimators.
export function connectionQuality(state) {
  const jitter = Math.max(0, Number(state?.jitter) || 0);
  const loss = Math.max(0, Math.min(1, Number(state?.lossRate) || 0));
  const ms = Math.max(0, Math.round((Number(state?.renderDelay) || 0) * 1000));
  const label = loss >= .15 || jitter >= 80 ? 'POOR' : loss >= .04 || jitter >= 35 ? 'FAIR' : 'GOOD';
  return { label, tone: label === 'GOOD' ? 'good' : label === 'FAIR' ? 'fair' : 'poor', ms, jitter: Math.round(jitter), loss: Math.round(loss * 100) };
}

// Spectator follow helpers: resolve a watched actor and cycle to the next live one.
export function spectateActor(actors, targetId) {
  const list = Array.isArray(actors) ? actors : [];
  return list.find(a => a.id === targetId && a.health > 0) || list.find(a => a.health > 0) || list[0] || null;
}

export function spectatorBoard(actors, targetId) {
  return (Array.isArray(actors) ? actors : []).filter(a => a && a.health > 0).map(a => ({id: a.id, name: a.name || `A${a.id}`, team: a.team, health: a.health, current: a.id === targetId}));
}

// Spectator board, grouped by side. Free agents (no team) sort last so team
// modes read top-to-bottom like the scoreboard. `points` is the juggernaut
// point ledger keyed by actor id; it is not stored on the actor itself.
export function spectatorTeams(actors, targetId, {points = {}} = {}) {
  const live = (Array.isArray(actors) ? actors : []).filter(a => a && a.health > 0);
  const byTeam = new Map();
  for (const a of live) {
    const team = a.team === undefined || a.team === null || Number.isNaN(Number(a.team)) ? null : Number(a.team);
    const key = team === null ? 'free' : `t${team}`;
    if (!byTeam.has(key)) byTeam.set(key, {key, team, players: []});
    byTeam.get(key).players.push({
      id: a.id,
      name: a.name || `A${a.id}`,
      team,
      health: a.health,
      current: a.id === targetId,
      juggernaut: a.juggernaut === true,
      points: Number(points?.[a.id]) || 0,
    });
  }
  return [...byTeam.values()].sort((x, y) => x.team === null ? 1 : y.team === null ? -1 : x.team - y.team);
}

export function nextSpectateTarget(actors, currentId, step = 1) {
  const live = (Array.isArray(actors) ? actors : []).filter(a => a.health > 0);
  if (!live.length) return null;
  const cur = live.findIndex(a => a.id === currentId);
  if (cur < 0) return live[step >= 0 ? 0 : live.length - 1].id;
  const index = ((cur + (step >= 0 ? 1 : -1)) + live.length) % live.length;
  return live[index].id;
}

// ---------------------------------------------------------------------------
// Objective clarity helpers shared by the HUD and the match-setup screen.

export const isTeamMode = mode => teamMode(typeof mode === 'string' ? mode : (mode?.id ?? mode?.mode));

export const modeGoal = mode => {
  const score = mode?.rules?.score;
  if (score === 'laps') return 'LAPS';
  if (score === 'captures') return 'CAPTURES';
  if (score === 'hillTime') return 'HILL CONTROL';
  if (score === 'zoneTime') return 'ZONE CONTROL';
  if (score === 'sectors') return 'SECTORS';
  if (score === 'payload') return 'CHECKPOINTS';
  if (score === 'teamFrags') return 'TEAM FRAGS';
  if (score === 'ladder') return 'LADDER';
  if (score === 'goals') return 'GOALS';
  if (score === 'juggernaut') return 'CROWN POINTS';
  if (score === 'elimination') return 'TEAM LIVES';
  return isTeamMode(mode) ? 'TEAM FRAGS' : 'FRAGS';
};

// One-line target readout reused by the match-start banner and the top bar.
export const modeTargetText = (mode, target) => {
  const limit = Number(target);
  if (mode?.id === 'armsrace') return 'CLIMB THE LADDER';
  if (mode?.id === 'juggernaut') return 'HOLD THE CROWN · MOST POINTS';
  if (mode?.id === 'team-elimination') return Number.isFinite(limit) ? `TEAM LIVES · ${limit} EACH` : 'TEAM LIVES REMAINING';
  const goal = modeGoal(mode);
  return Number.isFinite(limit) ? `FIRST TO ${limit} ${goal}` : goal;
};

export const scoreText = value => Number.isInteger(Number(value)) ? String(Number(value)) : Number(value || 0).toFixed(1);
export const teamScore = (hud, team) => Number(hud?.teamScores?.[team] ?? 0);
export const teamScoreText = scores => Array.isArray(scores)
  ? scores.map(s => `${s.name ?? s.team ?? 'TEAM'} ${scoreText(s.score ?? s.captures ?? s.frags ?? 0)}`).join('  ·  ')
  : scores && typeof scores === 'object'
    ? Object.entries(scores).map(([team, score]) => `${teamName(team)} ${scoreText(score)}`).join('  ·  ')
    : '';

export const SCORE_STAT_FIELDS = ['captures', 'flagPickups', 'flagReturns', 'flagDrops', 'objectiveTime', 'objectiveCaptures', 'objectiveNeutralizations', 'objectiveContests', 'points', 'eliminations'];
export const scoreStats = actor => Object.fromEntries(SCORE_STAT_FIELDS.map(field => [field, Number.isFinite(Number(actor?.scoreStats?.[field])) ? Number(actor.scoreStats[field]) : 0]));

const zoneName = (zone, index) => String(zone?.id ?? '').toLowerCase() === 'alpha' ? 'A' : String(zone?.id ?? '').toLowerCase() === 'bravo' ? 'B' : String(zone?.id ?? '').toLowerCase() === 'charlie' ? 'C' : String.fromCharCode(65 + index);
export const dominationZoneText = (zones, playerTeam) => zones.map((zone, index) => `${zoneName(zone, index)} ${zone?.contested ? 'CONTESTED' : zone?.owner === null || zone?.owner === undefined ? 'NEUTRAL' : zone.owner === playerTeam ? 'YOUR CONTROL' : `${teamName(zone.owner)} CONTROL`}`).join(' · ');
export const flagText = hud => {
  if (!Array.isArray(hud?.flags) || !hud.flags.length) return '';
  return hud.flags.map(f => {
    const carrier = hud?.actors?.find(a => a.id === f.carrier);
    return `${teamName(f.team)} FLAG ${f.state === 'at-base' ? 'HOME' : f.state === 'carried' ? `CARRIED BY ${carrier?.name?.toUpperCase() || `A${f.carrier}`}` : 'DROPPED'}`;
  }).join('  ·  ');
};

export const modeColumns = mode => mode === 'ctf' ? [['captures', 'CAP'], ['flagPickups', 'PICK'], ['flagReturns', 'RET'], ['flagDrops', 'DROP']]
  : mode === 'koth' ? [['objectiveTime', 'HILL TIME'], ['objectiveCaptures', 'CAP'], ['objectiveContests', 'CONTEST']]
    : mode === 'domination' || mode === 'combined-arms' ? [['objectiveTime', 'ZONE TIME'], ['objectiveCaptures', 'CAP'], ['objectiveNeutralizations', 'NEUT'], ['objectiveContests', 'CONTEST']]
      : mode === 'assault' ? [['objectiveCaptures', 'SECTORS'], ['objectiveTime', 'SECTOR TIME']]
        : mode === 'payload' ? [['objectiveCaptures', 'CHECKPOINTS'], ['objectiveTime', 'CART TIME']]
          : mode === 'armsrace' ? [['ladder', 'RUNG'], ['weapon', 'WEAPON']]
            : mode === 'puma-soccer' ? [['goals', 'GOALS']]
              : mode === 'juggernaut' ? [['points', 'POINTS']]
                : mode === 'team-elimination' ? [['eliminations', 'ELIMS']]
                  : [];

export const modePrimary = (mode, actor) => {
  const stats = scoreStats(actor);
  if (mode === 'ctf') return [stats.captures, stats.flagPickups + stats.flagReturns + stats.flagDrops];
  if (mode === 'koth' || mode === 'domination' || mode === 'combined-arms') return [stats.objectiveTime, stats.objectiveCaptures];
  if (mode === 'assault' || mode === 'payload') return [stats.objectiveCaptures, stats.objectiveTime];
  if (mode === 'armsrace') return [Number(actor?.ladder) || 0, Number(actor?.frags) || 0];
  if (mode === 'puma-soccer') return [Number(actor?.goals) || Number(actor?.scoreStats?.goals) || 0];
  if (mode === 'juggernaut') return [Number(actor?.points) || 0, actor?.juggernaut === true ? 1 : 0];
  if (mode === 'team-elimination') return [Number(actor?.eliminations) || 0, Number(actor?.frags) || 0];
  return [0];
};

// Match-rules copy for each scoring model. Null means the mode needs no extra note.
export const objectiveCopy = score => ({
  laps: 'Race through every numbered checkpoint in order. First across the line wins. Mystery boxes hold turbo, shield, oil or pulse. All racers use equal Puma chassis; operator, harness and combat gear give no advantage.',
  frags: 'First operator to the frag target wins. Eliminate opponents to bank frags; every death sets your own count back.',
  teamFrags: 'Both teams race to the shared team-frag target. Kill together and avoid friendly fire to keep the lead.',
  captures: 'Capture the enemy flag and return it to your base. Your team scores when the enemy flag reaches home while your flag is safe.',
  hillTime: 'Hold the central hill to earn one point per second for your team. Contest it to stop the other team from scoring.',
  zoneTime: 'Capture and hold the three control zones. Your team earns one point per second for every zone it owns.',
  sectors: 'Attackers capture sectors in order while defenders hold them. Breach the final sector to win; defenders win on the clock.',
  payload: 'Escort the payload cart down the track to the final point. Standing with the cart pushes it forward; the defenders stall it and roll it back. Attackers win on delivery, defenders on the clock.',
  ladder: 'Every elimination promotes you one rung up the weapon rack. Reach the final rung to win; there is no frag target to chase.',
  goals: 'Both teams fight over one ball and smash it into the enemy goal. The first team to the goal target wins; each goal restarts play from the centre circle.',
  juggernaut: 'One powered operator carries a shield and a damage aura while everyone hunts them. Hold the crown to bank the most points; killing the juggernaut seizes the role and pays a bounty.',
  elimination: 'Shared team lives and no free respawns: every death burns a ticket for your side. The first team out of lives loses the round.',
})[score] || null;

export function commandBrief(hud, player, mode) {
  const id = mode?.id ?? hud?.config?.mode, objective = hud?.objectives, kind = objective?.kind, team = teamName(player?.team), target = hud?.config?.fragLimit ?? 0;
  const carrying = Array.isArray(hud?.flags) && hud.flags.some(f => f.carrier === player?.id);
  const enemyFlag = Array.isArray(hud?.flags) ? hud.flags.find(f => f.team !== player?.team) : null;
  const ownFlag = Array.isArray(hud?.flags) ? hud.flags.find(f => f.team === player?.team) : null;
  if (id === 'puma-race') { const race = raceDisplay(hud, player?.id); return {title: 'FOLLOW THE CIRCUIT', action: 'Pass every numbered gate in order. Collect mystery boxes and use your item.', detail: `LAP ${race.lap} / ${race.laps}`, status: `CHECKPOINT ${race.checkpoint} / ${race.gates}`}; }
  if (id === 'puma-soccer') {
    const soccer = soccerDisplay(hud, player?.id), mine = soccer.team, theirs = mine === 0 ? 1 : 0, myGoals = soccer.scores?.[mine] ?? 0, theirGoals = soccer.scores?.[theirs] ?? 0;
    const title = soccer.phase === 'kickoff' ? 'KICK OFF' : soccer.phase === 'over' ? (soccer.winner === mine ? 'YOU WIN' : soccer.winner === null || soccer.winner === undefined ? 'DRAW' : 'DEFEAT') : 'GO FOR GOAL';
    const action = soccer.phase === 'over' ? 'Full time. Check the final score and the standings.' : soccer.phase === 'kickoff' ? 'Hold the kickoff, win the ball and drive it at the enemy goal.' : 'Smash the ball into the enemy goal and fall back to defend your own.';
    return {title, action, detail: `${teamName(mine)} ${myGoals} \u2013 ${theirGoals} ${teamName(theirs)} \u00b7 GOALS ${myGoals} / ${soccer.goalLimit}`, status: `${soccer.ballInPlay ? 'BALL LIVE' : String(soccer.phase).toUpperCase()} \u00b7 ${soccer.time}`};
  }
  if (id === 'ctf') return {title: carrying ? 'RETURN THE FLAG' : 'BREAK THEIR LINE', action: carrying ? 'Reach your base to capture.' : enemyFlag?.state === 'carried' ? 'Escort the carrier home.' : ownFlag?.state === 'dropped' ? 'Recover your flag.' : 'Take the enemy flag.', detail: `${team} ${carrying ? 'CARRIER' : 'DEFENSE'} · ${flagText(hud)}`, status: `${teamScore(hud, player?.team)} / ${target} CAPTURES`};
  if (id === 'armsrace') {
    const ladder = ladderStatus(player, WEAPONS.length);
    const current = WEAPONS[Number(player?.weapon)]?.name;
    const next = WEAPONS[Number(player?.weapon) + 1]?.name;
    return {title: 'CLIMB THE LADDER', action: 'Score an elimination to advance one weapon up the rack. Reach the final rung to win.', detail: `${ladder.label} · ${current ?? 'STARTING WEAPON'}`, status: next ? `NEXT WEAPON · ${next}` : 'FINAL RUNG · LAST WEAPON'};
  }
  if (kind === 'koth' || id === 'koth') { const zone = objective?.zones?.[0], owner = zone?.owner === null || zone?.owner === undefined ? 'NEUTRAL' : teamName(zone.owner), held = zone?.owner === player?.team; return {title: zone?.contested ? 'CONTEST THE HILL' : held ? 'HOLD THE HILL' : zone?.owner === null ? 'CAPTURE THE HILL' : 'BREAK THEIR CONTROL', action: zone?.contested ? 'Clear the enemy from the hill to restart scoring.' : held ? 'Stay inside the hill and protect the zone.' : 'Push the hill and deny their control.', detail: `${team} ${scoreText(teamScore(hud, player?.team))} / ${target} · HILL ${owner}`, status: `${Math.round(zone?.progress ?? 0)}% CAPTURED · ${zone?.contested ? 'CONTESTED' : owner + ' CONTROL'}`}; }
  if (kind === 'domination' || id === 'domination' || id === 'combined-arms') { const zones = objective?.zones ?? [], owned = zones.filter(z => z.owner === player?.team).length, contested = zones.filter(z => z.contested).length, enemy = zones.filter(z => z.owner !== null && z.owner !== undefined && z.owner !== player?.team).length; return {title: contested ? 'BREAK THE CONTEST' : owned ? 'LOCK THE ZONES' : 'TAKE A CONTROL POINT', action: contested ? 'Collapse the contested point before the enemy retakes it.' : owned ? 'Hold your captured zones and rotate to the next weak point.' : 'Enter a control zone to begin the capture.', detail: `${team} ${scoreText(teamScore(hud, player?.team))} / ${target} · ${owned}/${zones.length} ZONES · ${dominationZoneText(zones, player?.team)}`, status: `${owned} OWNED · ${enemy} ENEMY · ${contested} CONTESTED`}; }
  if (kind === 'assault' || id === 'assault') { const st = hud?.objectives, sectors = st?.zones ?? [], total = Math.max(1, sectors.length), index = Math.min(st?.active ?? 0, total - 1), active = sectors[index], attacking = player?.team === st?.attacker, secured = sectors.filter(s => s.owner === player?.team).length; return {title: st?.breached ? 'FORTRESS BREACHED' : attacking ? 'BREACH THE NEXT SECTOR' : 'HOLD THE LINE', action: st?.breached ? 'The final sector has fallen.' : attacking ? 'Push into the active sector and capture it before the defenders reset it.' : 'Hold the active sector and deny the attackers their next breach.', detail: `${team} ${attacking ? 'ATTACKER' : 'DEFENDER'} · SECTOR ${index + 1} / ${total} · ${Math.round(active?.progress ?? 0)}% SECURED`, status: `${secured} SECTOR${secured === 1 ? '' : 'S'} HELD · ${attacking ? 'PUSH FORWARD' : 'HOLD POSITION'}`}; }
  if (kind === 'payload' || id === 'payload') { const st = hud?.objectives, p = st?.payload, attacking = player?.team === (st?.attacker ?? 0), total = Math.max(1, p?.checkpointCount ?? st?.zones?.length ?? target), reached = p?.checkpointsReached ?? 0, pct = Math.round(p?.progress ?? 0); return {title: p?.delivered ? 'PAYLOAD DELIVERED' : attacking ? (p?.contested ? 'CLEAR THE CART' : 'ESCORT THE PAYLOAD') : (p?.contested ? 'HOLD THE CART' : 'STOP THE PAYLOAD'), action: attacking ? (p?.contested ? 'Both teams are on the cart. Clear the defenders to get it moving again.' : 'Stay with the cart and push it through the next checkpoint before the clock runs out.') : (p?.contested ? 'You are on the cart. Keep the attackers off it to hold the line.' : 'Get bodies on the cart to stall it, then roll it back to the last checkpoint.'), detail: `${team} ${attacking ? 'ATTACKER' : 'DEFENDER'} · PAYLOAD ${pct}% · CHECKPOINT ${Math.min(reached + 1, total)} / ${total}`, status: `${reached} / ${total} CHECKPOINTS · ${p?.contested ? 'CONTESTED' : p?.delivered ? 'DELIVERED' : p?.pushing === player?.team ? 'MOVING' : 'HALTED'}`}; }
  if (id === 'teamdeathmatch') return {title: 'HOLD THE LINE', action: 'Stay with your team and take the next fight.', detail: `${team} FIRETEAM · FIRST TO ${target} TEAM FRAGS`, status: `${teamScore(hud, player?.team)} / ${target} TEAM FRAGS`};
  if (id === 'instagib') return {title: 'ONE SHOT. NO SECOND CHANCE.', action: 'Keep the rail angle. Land the first hit.', detail: `RAIL ONLY · UNLIMITED AMMO · POWERS OFF · FIRST TO ${target} FRAGS`};
  if (id === 'rockets') return {title: 'CONTROL THE BLAST ZONE', action: 'Take height, then force the next rocket duel.', detail: `ROCKETS LOCKED · HEALTH + ARMOR ACTIVE · FIRST TO ${target} FRAGS`};
  if (id === 'arsenal') return {title: 'OWN THE LOADOUT', action: 'Choose the weapon for the next engagement.', detail: `FULL ARSENAL · UNLIMITED AMMO · FIRST TO ${target} FRAGS`};
  return {title: 'HUNT THE NEXT TOKEN', action: 'Find an angle and secure the next frag.', detail: `FIRST TO ${target} FRAGS`};
}
