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

const teamLabel = team => Number(team) === 0 ? 'RED' : Number(team) === 1 ? 'BLUE' : `TEAM ${team}`;

export function suddenDeathBanner(hud) {
  return hud?.suddenDeath === true && hud?.over !== true ? { text: 'SUDDEN DEATH', detail: 'NEXT SCORE WINS' } : null;
}

const CAPTION_EVENTS = Object.freeze({shot:'Gunfire',explosion:'Explosion','vehicle-shot':'Vehicle gunfire',grenade:'Grenade out',melee:'Melee',reload:'Reloading',pickup:'Pickup',powerup:'Powerup','vehicle-destroyed':'Vehicle destroyed','zone-capture':'Zone captured','zone-score':'Objective scoring','zone-neutralized':'Zone neutralized','flag-pickup':'Flag taken','flag-return':'Flag returned','flag-drop':'Flag dropped',capture:'Flag captured','assault-breach':'Sector breached','payload-checkpoint':'Checkpoint reached','payload-delivered':'Payload delivered','killstreak':'Killstreak',death:'Elimination'});
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

export function matchStartBanner(hud, duration = 2.6) {
  const time = Number(hud?.time), limit = Number.isFinite(duration) && duration > 0 ? duration : 2.6;
  if (!Number.isFinite(time) || time < 0 || time >= limit) return null;
  const detail = [hud?.modeName, hud?.mapName].filter(Boolean).join(' · ').toUpperCase();
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
  const mode = hud?.config?.mode ?? hud?.mode, capture = mode === 'ctf';
  for (const team of [0, 1]) {
    const before = Math.floor(Number(prevScores[team])), after = Math.floor(Number(scores[team]));
    if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) continue;
    return {team, kind: capture ? 'capture' : 'score', text: capture ? 'FLAG CAPTURED' : `${teamLabel(team)} SCORES`, score: after, amount: after - before};
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

export function nextSpectateTarget(actors, currentId, step = 1) {
  const live = (Array.isArray(actors) ? actors : []).filter(a => a.health > 0);
  if (!live.length) return null;
  const cur = live.findIndex(a => a.id === currentId);
  if (cur < 0) return live[step >= 0 ? 0 : live.length - 1].id;
  const index = ((cur + (step >= 0 ? 1 : -1)) + live.length) % live.length;
  return live[index].id;
}
