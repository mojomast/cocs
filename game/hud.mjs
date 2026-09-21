import {raceDisplay,soccerDisplay} from './race-ui.mjs';
import {WEAPONS} from './data.mjs';
import {ALT_FIRE,altSpecFor} from './alt-fire.mjs';
import {teamMode,isCocsMode} from './config.mjs';
import {latticeCaption} from './lattice-feedback.mjs';
import {formatNumber,formatCountdown} from './format-ui.mjs';
import {DEFAULT_BINDINGS,bindingLabel} from './keybinds.mjs';
import {ASSISTIVE_PRIORITY} from './assistive-announce.mjs';
import {OVERKILL_GIB} from './deaths.mjs';

// Every prompt below is a function of the live bindings, never a literal key.
// `bindings` is optional so pure callers and tests keep a sensible default.
const boundLabel = (bindings, action) =>
  bindingLabel((bindings ?? {})[action] ?? DEFAULT_BINDINGS[action]).toUpperCase();

export function vehicleHud(player, vehicles = [], flags = [], spectate = false, bindings = {}) {
  if (spectate || !player || !(player.health > 0)) return {vehicle: null, prompt: ''};
  const interact = boundLabel(bindings, 'interact');
  const vehicle = vehicles.find(v => v.id === player.vehicleId && v.health > 0 && (v.driver === player.id || v.gunner === player.id || (Array.isArray(v.passengers) && v.passengers.includes(player.id))));
  if (vehicle) return {vehicle, prompt: `${interact} / EXIT PUMA`};
  const canEnter = player.vehicleId == null && !flags.some(flag => flag.carrier === player.id) && vehicles.some(v =>
    v.health > 0 && v.respawnTimer <= 0 && v.driver === null && Math.hypot(player.x - v.x, player.z - v.z) < 2.4);
  return {vehicle: null, prompt: canEnter ? `${interact} / ENTER PUMA` : ''};
}

// Escape is shell-owned and cannot be rebound (`RESERVED_CODES`), so it stays
// literal in every hint. Vehicle, voice and spectator copy resolve through the
// binding model instead.
export const escapeHint = online => online ? 'ESC / LOBBY (MATCH CONTINUES)' : 'ESC / PAUSE';

export const voiceHint = (enabled, mode, bindings = {}) => {
  if (!enabled) return null;
  if (mode === 'ptt') return `${boundLabel(bindings, 'voice')} / TALK`;
  if (mode === 'auto') return 'VOICE / AUTO TALK';
  return 'VOICE ON';
};

// Spectator camera/roster keys are page-owned fixed codes rather than player
// bindings, so they are rendered through `bindingLabel` and marked RESERVED:
// a player who remaps `command` (default B) or `melee` (default F) must not
// read the old default as if it still followed that binding. The free-camera
// movement line genuinely does follow the movement bindings.
export const SPECTATOR_RESERVED_KEYS = Object.freeze({camera: 'KeyB', freeCam: 'KeyF', hideHud: 'KeyH', thirdPerson: 'KeyP'});

export function spectatorControls({local = false, cursorKey = 'ALT', bindings = {}} = {}) {
  const reserved = bindingLabel;
  if (local) {
    const movement = ['forward', 'left', 'back', 'right'].map(action => boundLabel(bindings, action)).join('');
    return `${cursorKey} cursor · RESERVED: [ / ] follow, ${reserved(SPECTATOR_RESERVED_KEYS.camera)} camera, ${reserved(SPECTATOR_RESERVED_KEYS.freeCam)} free cam, ${reserved(SPECTATOR_RESERVED_KEYS.hideHud)} hide HUD · ESC menu. Free cam: ${movement} / ${boundLabel(bindings, 'jump')} / ${boundLabel(bindings, 'sprint')} / ${boundLabel(bindings, 'crouch')}.`;
  }
  return `RESERVED: [ / ] follow, ${reserved(SPECTATOR_RESERVED_KEYS.hideHud)} hide HUD, ${reserved(SPECTATOR_RESERVED_KEYS.thirdPerson)} third person · ESC lobby`;
}

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
  if (!hud?.hit && !hud?.kill && !hud?.shieldBreak) return null;
  const latest = hud?.feed?.[0], when = Number(hud?.time), at = Number(latest?.time);
  const killed = Boolean(hud?.kill || (latest && player && latest.killer === player.name && !latest.self && (!Number.isFinite(when) || !Number.isFinite(at) || when - at < 0.6)));
  if (killed) return 'kill';
  if (hud?.critical) return 'critical';
  // A shield break is its own parry beat: a distinct marker shape plus the
  // BREAK word, so it never reads as a stronger normal hit alone.
  if (hud?.shieldBreak) return 'shieldbreak';
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

export function killBanner(hud, player, weapons = []) {
  const latest = hud?.feed?.[0], when = Number(hud?.time), at = Number(latest?.time);
  if (!latest || !player || !Number.isFinite(at) || !Number.isFinite(when)) return null;
  const age = Math.max(0, when - at);
  const ability = latest.ability === true && typeof latest.abilityName === 'string' && latest.abilityName.length > 0
    ? latest.abilityName.toUpperCase() : null;
  // Attribution rides in `detail` so the pinned text lines stay exactly as they
  // are; the HUD only renders the detail when it is present. An ability names
  // the lethal blow; otherwise the killer's weapon index resolves through the
  // shared weapon table, so a plain weapon kill is attributed too.
  const weapon = ability ? null : killFeedWeapon(latest, weapons);
  const detail = ability ?? weapon;
  if (latest.self && latest.victim === player.name) return {kind: 'self', text: 'ELIMINATED', age, ...(detail ? {detail} : {})};
  if (latest.killer === player.name && latest.victim !== player.name) return {kind: 'kill', text: `YOU ELIMINATED ${latest.victim ?? ''}`.trim(), age, ...(detail ? {detail: ability ? `WITH ${ability}` : `WITH ${weapon}`} : {})};
  if (latest.victim === player.name && latest.killer !== player.name) return {kind: 'death', text: `${latest.killer ?? 'ARENA'} ELIMINATED YOU`, age, ...(detail ? {detail} : {})};
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

// Short weapon name for a kill-feed entry, or the harness ability when the
// killing blow was ability-tagged (§6.2/§6.4). Null for environment kills.
// `fallbackAbility` is the enriched kill metadata's ability name: the page
// threads the authoritative death event onto the feed copy, so a caller can
// still name the lethal ability when the frozen feed entry itself carries no
// name. Passing nothing keeps the historical two-argument behavior exactly.
export function killFeedWeapon(entry, weapons = [], fallbackAbility = null) {
  if (!entry) return null;
  const abilityName = typeof entry.abilityName === 'string' && entry.abilityName.length > 0
    ? entry.abilityName
    : typeof fallbackAbility === 'string' && fallbackAbility.length > 0 ? fallbackAbility : '';
  if (entry.ability === true && abilityName) {
    return abilityName.toUpperCase();
  }
  if (!Number.isInteger(entry.weapon)) return null;
  return weapons[entry.weapon]?.short ?? null;
}

// Non-color kill-feed badges. The simulation computes overkill, the victim's
// streak at death and the freshly credited killer streak; the page threads
// them (plus the client-side ASSIST credit) onto each feed entry. Every badge
// is a word or a worded marker, so the feed reads without color, and none of
// them are live regions.
export function killFeedBadges(entry, {overkillThreshold = OVERKILL_GIB} = {}) {
  if (!entry || entry.self === true || entry.fall === true) return [];
  const badges = [];
  if (entry.assist === true) badges.push({id: 'assist', label: 'ASSIST', title: 'You damaged this victim before the kill'});
  const victimStreak = Math.max(0, Math.floor(Number(entry.victimStreak) || 0));
  if (victimStreak >= 2) badges.push({id: 'streak-ended', label: 'STREAK ENDED', title: `Ended a ${victimStreak} kill streak`});
  const overkill = Math.max(0, Math.round(Number(entry.overkill) || 0));
  const threshold = Number.isFinite(Number(overkillThreshold)) && Number(overkillThreshold) > 0 ? Number(overkillThreshold) : OVERKILL_GIB;
  if (overkill >= threshold) badges.push({id: 'overkill', label: 'OVERKILL', title: `Overkill by ${overkill} damage`});
  const killerStreak = Math.max(0, Math.floor(Number(entry.killerStreak) || 0));
  if (killerStreak >= 2) badges.push({id: 'killer-streak', label: `×${killerStreak} STREAK`, title: `${entry.killer ?? 'The killer'} is on a ${killerStreak} kill streak`});
  return badges;
}

export const teamName = team => Number(team) === 0 ? 'RED' : Number(team) === 1 ? 'BLUE' : `TEAM ${team}`;

// ---------------------------------------------------------------------------
// Team status + economy HUD models (QoL wave). Both are pure reads of the
// frozen snapshot: `teamScores`, the elimination/extraction objective fields,
// actor health/team, the payload's distance/contested flags and the snapshot's
// `deployables`/`upgradeTimer`/`upgradeWeapon`. The match page renders them as
// one non-live `role="group"` strip, so the single polite live region contract
// is untouched. Every helper tolerates absence and returns null when there is
// nothing worth reading.
// ---------------------------------------------------------------------------
const hudTeam = value => value === 0 || value === 1 ? Number(value) : null;
const hudWhole = value => Math.max(0, Math.round(Number(value) || 0));
const hudPercent = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const hudMeters = value => { const n = Math.max(0, Number(value) || 0); return formatNumber(n, n < 10 ? 1 : 0); };
const cleanLabel = parts => parts.filter(Boolean).join(' ');
const spoken = text => text.replace(/\s*·\s*/g, ', ');

export function teamStatusHud(player, hud) {
 if (!player || !hud || hud.spectate === true) return null;
 const team = hudTeam(player.team), enemy = team === null ? null : team === 0 ? 1 : 0;
 const actors = Array.isArray(hud.actors) ? hud.actors : [];
 const objectives = hud.objectives && typeof hud.objectives === 'object' ? hud.objectives : null;
 const kind = objectives?.kind ?? null;
 // Elimination is a shared-ticket race: show each side's remaining lives and
 // the bleed that forced them down (deaths burn tickets, attrition eats them).
 let lives = null;
 if (objectives && kind === 'elimination') {
  const teams = [0, 1].map(t => {
   const count = hudWhole(objectives.lives?.[t]);
   return {team: t, name: teamName(t), lives: count, max: hudWhole(objectives.livesPerTeam),
    eliminations: hudWhole(objectives.eliminations?.[t]), attrition: hudWhole(objectives.attrition?.[t]),
    mine: t === team, out: count <= 0};
  });
  lives = {teams, suddenDeath: objectives.suddenDeath === true, text: teams.map(t => `${t.name} ${t.lives}`).join(' · ')};
 }
 // Ally chips: same side, local player excluded, dead allies kept as DOWN so a
 // wipe is visible at a glance. Capped so the strip stays compact.
 const allies = team === null ? [] : actors
  .filter(a => a && a.id !== player.id && hudTeam(a.team) === team)
  .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
  .slice(0, 6)
  .map(a => ({id: a.id, name: a.name || `A${a.id}`, health: hudWhole(a.health), armor: hudWhole(a.armor), down: !(Number(a.health) > 0)}));
 // One objective readout per mode family, all from the authoritative snapshot.
 const rows = Array.isArray(objectives?.zones) ? objectives.zones.map((zone, index) => {
  const owner = hudTeam(zone?.owner), captureTeam = hudTeam(zone?.captureTeam);
  return {id: String(zone?.id ?? index), label: String(zone?.id ?? index).toUpperCase(), owner, captureTeam,
   contested: zone?.contested === true, progress: hudPercent(zone?.progress),
   mine: owner !== null && owner === team, enemy: owner !== null && owner !== team};
 }) : null;
 let zones = null, hold = null, payload = null, vip = null, stages = null, assault = null;
 if (objectives) {
  if (kind === 'extraction') {
   const vipActor = objectives.vipId == null ? null : actors.find(a => a && a.id === objectives.vipId) || null;
   const dead = objectives.vipDead === true || (vipActor ? !(Number(vipActor.health) > 0) : false);
   vip = {id: objectives.vipId ?? null, name: vipActor?.name || 'VIP', health: vipActor ? hudWhole(vipActor.health) : 0,
    maxHealth: vipActor ? hudWhole(vipActor.maxHealth) : 0, dead, mine: team !== null && objectives.escortTeam === team,
    progress: hudWhole(objectives.progress), captureSeconds: hudWhole(objectives.captureSeconds),
    text: dead ? 'VIP DOWN' : `VIP ${vipActor ? hudWhole(vipActor.health) : 0} HP`};
  } else if (objectives.payload && typeof objectives.payload === 'object') {
   const state = objectives.payload, total = Math.max(0, Number(state.total) || 0), distance = Math.max(0, Number(state.distance) || 0);
   const pushing = hudTeam(state.pushing), percent = hudPercent(state.progress);
   const contested = state.contested === true, delivered = state.delivered === true, mine = pushing !== null && pushing === team;
   // Contest sides: the attacker owns the push, the defender stalls it. The
   // frozen objective carries both; a sliced payload object may repeat them, so
   // read either shape. `contested` and `mine` keep their pinned meanings.
   const attacker = hudTeam(objectives.attacker) ?? hudTeam(state.attacker);
   const defender = hudTeam(objectives.defender) ?? hudTeam(state.defender) ?? (attacker === null ? null : attacker === 0 ? 1 : 0);
   payload = {percent, distance, total, contested, delivered, pushing, mine, attacker, defender,
    defending: team !== null && defender !== null && defender === team,
    checkpointsReached: hudWhole(state.checkpointsReached), checkpointCount: hudWhole(state.checkpointCount),
    text: `PAYLOAD ${percent}% · ${hudMeters(distance)}/${hudMeters(total)}m${contested ? ' · CONTESTED' : delivered ? ' · DELIVERED' : mine ? ' · MOVING' : ''}`};
  } else if (kind === 'assault' && rows) {
   const index = Math.max(0, Math.min(rows.length - 1, hudWhole(objectives.active))), active = rows[index] ?? null;
   const attacker = hudTeam(objectives.attacker);
   assault = {index, total: rows.length, breached: objectives.breached === true, progress: active ? active.progress : 0,
    owner: active ? active.owner : null, attacker,
    text: `${objectives.breached === true ? 'BREACHED' : `SECTOR ${index + 1}/${rows.length}`} · ${active ? active.progress : 0}%${attacker !== null && attacker === team ? ' · ATTACK' : ' · DEFEND'}`};
  } else if (hudWhole(objectives.stageCount) > 0) {
   const captures = {0: hudWhole(objectives.stageCaptures?.[0]), 1: hudWhole(objectives.stageCaptures?.[1])};
   const count = Math.max(1, hudWhole(objectives.stageCount)), stage = hudWhole(objectives.stage);
   stages = {index: stage, count, captures, mine: team === null ? null : captures[team],
    text: `RELAY ${Math.min(stage + 1, count)}/${count}${team === null ? '' : ` · YOU ${captures[team]}`}`};
  } else if (rows && (kind === 'domination' || kind === 'koth')) {
   const owned = rows.filter(zone => zone.mine).length, enemyOwned = rows.filter(zone => zone.enemy).length, contested = rows.filter(zone => zone.contested).length;
   // The capture the player should read first: their own attempt, then any
   // contest, then the enemy's push.
   const focus = rows.find(zone => !zone.mine && zone.captureTeam === team && zone.progress > 0)
    ?? rows.find(zone => zone.contested)
    ?? rows.find(zone => zone.enemy && zone.progress > 0) ?? null;
   const focusText = !focus ? '' : focus.contested ? `${focus.label} CONTESTED`
    : focus.captureTeam === team ? `TAKING ${focus.label} ${focus.progress}%`
    : focus.captureTeam === enemy ? `${focus.label} ENEMY ${focus.progress}%` : `${focus.label} ${focus.progress}%`;
   zones = {rows, owned, enemyOwned, contested, total: rows.length, focus, focusText, text: `${owned}/${rows.length} ZONES · ${contested} CONTESTED`};
   if (hudWhole(objectives.holdCount) > 0) {
    const quota = hudWhole(objectives.holdCount), window = hudWhole(objectives.holdSeconds);
    const progress = {0: hudWhole(objectives.holdProgress?.[0]), 1: hudWhole(objectives.holdProgress?.[1])};
    const holder = hudTeam(objectives.holdTeam);
    hold = {quorum: quota, seconds: window, progress, team: holder, mine: holder !== null && holder === team,
     text: `HOLD ${team === null ? Math.max(progress[0], progress[1]) : progress[team]}s / ${window}s`};
   }
  }
 }
 const label = cleanLabel([
  lives && `Team lives: ${lives.teams.map(t => `${t.name} ${t.lives} of ${t.max}`).join(', ')}${lives.suddenDeath ? '. Sudden death' : ''}.`,
  allies.length && `Allies: ${allies.map(a => `${a.name} ${a.down ? 'down' : `${a.health} health ${a.armor} armor`}`).join(', ')}.`,
  vip && (vip.dead ? 'VIP down.' : `VIP ${vip.health} health.`),
  payload && `${spoken(payload.text)}.`,
  zones && `${spoken(zones.text)}${zones.focusText ? `, ${spoken(zones.focusText)}` : ''}.`,
  hold && `${spoken(hold.text)}.`,
  stages && `${spoken(stages.text)}.`,
  assault && `${spoken(assault.text)}.`,
 ]);
 if (!label) return null;
 return {team, kind, lives, allies, vip, payload, zones, hold, stages, assault, label};
}

// Economy feedback: the held weapon-upgrade window and any sentries the local
// team actually owns. `alive` follows the snapshot's own life/health fields;
// an expired sentry is reported down rather than silently dropped.
export function economyHud(player, hud, weapons = WEAPONS) {
 if (!player || !hud) return null;
 const timer = Number(player.upgradeTimer) || 0;
 const index = Number.isInteger(player.upgradeWeapon) ? player.upgradeWeapon : null;
 const weapon = index !== null ? weapons?.[index] : null;
 const upgrade = timer > 0 && index !== null ? {index, timer, weapon: weapon?.short ?? weapon?.name ?? null,
  text: `UPGRADE ${weapon?.short ?? weapon?.name ?? `#${index}`} · ${formatCountdown(timer)}s`} : null;
 const deployables = (Array.isArray(hud.deployables) ? hud.deployables : []).filter(s => s && typeof s === 'object').map(s => {
  const life = Math.max(0, Number(s.life) || 0), health = hudWhole(s.health);
  const owner = Number.isInteger(s.owner) ? s.owner : null;
  const mine = owner !== null && owner === player.id;
  const sameTeam = (player.team === 0 || player.team === 1) && hudTeam(s.team) === hudTeam(player.team);
  const friendly = mine || sameTeam;
  const alive = life > 0 && health > 0;
  return {id: s.id ?? null, owner, team: hudTeam(s.team), health, life, cooldown: Math.max(0, Number(s.cooldown) || 0),
   mine, friendly, alive, text: alive ? `SENTRY ${health} HP · ${formatCountdown(life)}s` : 'SENTRY DOWN'};
 }).sort((a, b) => (Number(b.mine) - Number(a.mine)) || (Number(b.friendly) - Number(a.friendly)) || ((Number(a.id) || 0) - (Number(b.id) || 0)));
 if (!upgrade && !deployables.length) return null;
 const label = cleanLabel([
  upgrade && `Weapon upgrade ${upgrade.weapon ?? ''} ${formatCountdown(upgrade.timer)} seconds.`.replace(/\s+/g, ' '),
  ...deployables.map(s => s.mine ? `Your sentry ${s.alive ? `at ${s.health} health, ${formatCountdown(s.life)} seconds left` : 'is down'}.`
   : s.friendly ? `Friendly sentry ${s.alive ? `at ${s.health} health` : 'down'}.` : 'Enemy sentry.'),
 ]);
 return {upgrade, deployables, mine: deployables.filter(s => s.mine), friendly: deployables.filter(s => s.friendly && !s.mine),
  enemy: deployables.filter(s => !s.friendly), label};
}

export function suddenDeathBanner(hud) {
  return (hud?.suddenDeath === true || hud?.objectives?.suddenDeath === true) && hud?.over !== true ? { text: 'SUDDEN DEATH', detail: 'NEXT SCORE WINS' } : null;
}

const CAPTION_EVENTS = Object.freeze({shot:'Gunfire',explosion:'Explosion','vehicle-shot':'Vehicle gunfire',grenade:'Grenade out',melee:'Melee',reload:'Reloading',pickup:'Pickup',powerup:'Powerup','vehicle-enter':'Mounted vehicle','vehicle-exit':'Dismounted vehicle','vehicle-destroyed':'Vehicle destroyed','vehicle-splatter':'Vehicle splatter','zone-capture':'Zone captured','zone-score':'Objective scoring','zone-neutralized':'Zone neutralized','flag-pickup':'Flag taken','flag-return':'Flag returned','flag-drop':'Flag dropped','flag-pass':'Flag passed','flag-contest':'Flag contested',capture:'Flag captured','assault-sector-captured':'Sector captured','assault-sector-lost':'Sector lost','assault-breach':'Sector breached','payload-checkpoint':'Checkpoint reached','payload-delivered':'Payload delivered','payload-contest':'Payload contested','soccer-goal':'Goal','killstreak':'Killstreak',death:'Elimination','mission-message':'Mission update','mission-won':'Mission complete','mission-lost':'Mission failed','horde-wave':'Wave incoming','horde-wave-cleared':'Wave cleared','horde-resupply':'Resupplied','horde-upgrade':'Upgrade available','horde-upgrade-selected':'Upgrade acquired','enemy-detonate':'Sapper detonation','singleplayer-checkpoint':'Checkpoint saved','npc-deploy':'Contacts','story-line':'Mission briefing','npc-bark':'Transmission','boss-phase':'Boss phase','armsrace-promote':'Ladder up','armsrace-demote':'Ladder down','juggernaut-transfer':'Crown taken','elimination-life':'Team life lost','vip-deploy':'VIP deployed','vip-down':'VIP down','vip-extracted':'VIP extracted','holdout-progress':'Holdout progress','holdout-win':'Holdout won','uplink-capture':'Uplink captured','uplink-stage':'Uplink advanced','uplink-win':'Uplink won','objective-win':'Objective secured','enemy-telegraph':'Incoming attack','boss-slam':'Boss slam','boss-summon':'Boss summon','mender-heal':'Ally healed','overseer-aura':'Overseer aura','phalanx-shield':'Phalanx shield','enemy-flank':'Flanking','enemy-artillery':'Artillery incoming','race-coin':'Coin collected','race-box':'Item box','race-boost':'Speed boost','race-item':'Item deployed','race-hazard-hit':'Hazard hit','race-lap':'Lap complete','race-finish':'Race finish',power:'Ability activated','threat-ping':'Threat ping',feint:'Radar feint','move-start':'Movement ability','move-end':'Movement ended','windup-start':'Movement wind-up','windup-end':'Movement wind-up ended','charge-start':'Movement charge','charge-release':'Movement released','charge-cancel':'Movement charge cancelled','slam-launch':'Slam launch','slam-impact':'Slam impact','grapple-hook':'Grapple hooked','grapple-release':'Grapple released','rope-place':'Rope deployed','rope-expire':'Rope expired','move-miss':'Movement missed','rope-miss':'Rope missed','move-blocked':'Movement blocked','fuel-empty':'Fuel empty','no-lift':'Movement blocked','chain-cancel':'Movement chained','landing-recovery':'Landing recovery','vehicle-damage':'Vehicle damaged','deployable':'Sentry deployed','deployable-fire':'Sentry firing','deployable-expire':'Sentry expired','weapon-upgrade':'Weapon upgrade',dryfire:'Empty magazine','weapon-switch':'Weapon switch','loadout-switch':'Loadout changed','horde-modifier':'Wave modifier','lattice-support':'Lattice support','vehicle-repair':'Vehicle repaired','deployable-destroyed':'Sentry destroyed','deployable-repaired':'Sentry repaired','objective-tiebreak':'Objective tiebreak','sudden-death':'Sudden death','weather-change':'Weather change','time-change':'Time of day change','bounty':'Bounty claimed','charge':'Charge','horde-summary':'Horde summary'});
export function ladderStatus(player, total = 10) {
  const rung = Math.max(0, Math.floor(Number(player?.ladder) || 0));
  const size = Math.max(1, Math.floor(Number(total) || 10));
  return { rung, total: size, label: rung >= size - 1 ? 'LADDER FINAL' : `LADDER ${rung + 1}/${size}` };
}

export function streakStatus(player) {
  const streak = Math.max(0, Math.floor(Number(player?.streak) || 0));
  return streak >= 2 ? { streak, label: `${streak} STREAK` } : null;
}

// Alt-fire identity for captions. `mode` may be the weapon/spec index, the
// spec id ('salvo' from `altId`), a pre-rendered label or the weapon index on a
// `shot` event; anything unknown returns '' so a caption never names the wrong
// mode.
export function altFireLabel(event) {
  const mode = event?.mode ?? event?.altMode ?? event?.altId ?? event?.weapon;
  const spec = altSpecFor(mode) ?? (typeof mode === 'string' ? ALT_FIRE.find(entry => entry.id === mode.toLowerCase()) ?? null : null);
  if (spec) return spec.label;
  const direct = event?.modeLabel ?? event?.label;
  return typeof direct === 'string' && direct ? direct.toUpperCase() : '';
}

// Bearing wording for the damage caption. `angle` is the relative bearing the
// HUD's damageBearing produced: 0 ahead, positive to the left, wrapped to the
// nearest 45-degree sector. Pure; unknown/NaN angles are handled by the caller.
const BEARING_WORDS = ['front', 'front-left', 'left', 'back-left', 'back', 'back-right', 'right', 'front-right'];
export function bearingWord(angle) {
  const a = Number(angle);
  if (!Number.isFinite(a)) return null;
  const sector = Math.round(a / (Math.PI / 4));
  return BEARING_WORDS[((sector % 8) + 8) % 8];
}

// Per-kind telegraph wording. The kinds are the sim's wave-force identities
// (game/singleplayer.mjs); the map is frozen so a caption can never drift from
// the voice table it describes.
const TELEGRAPH_CAPTIONS = Object.freeze({
  overseer: 'overseer aura',
  mender: 'mender pulse',
  flanker: 'flanker push',
  phalanx: 'phalanx shield',
  sapper: 'sapper charge',
  artillery: 'artillery',
  boss: 'boss slam',
});

export function audioCaption(event) {
  const type = event?.type;
  const lattice=latticeCaption(event);if(lattice)return {text:lattice};
  // Alt-fire captions: the held mode change (`alt-state`, emitted by Match when
  // `controls.altFire` flips) and each alt shot name the same mode label the HUD
  // chip shows; alt hitscan `shot`s and projectile `launch`es replace the
  // generic 'Gunfire' line instead of stacking a second caption.
  if (type === 'alt-state' || type === 'alt-mode') {
    const label = altFireLabel(event);
    const off = event?.alt === false || event?.on === false;
    return {text: `${off ? 'Alt mode off' : 'Alt mode'}${label ? ` · ${label}` : ''}`};
  }
  if (type === 'alt-fire' || ((type === 'shot' || type === 'launch') && event?.alt === true)) {
    const label = altFireLabel(event);
    return {text: label ? `Alt fire · ${label}` : 'Alt fire'};
  }
  if (type === 'alt-toggle') return {text: event?.on === false || event?.alt === false ? 'Alt fire off' : 'Alt fire on'};
  // LATTICE STRIKE command events route into the same captions pipeline (§13.4).
  if (type === 'cocs-order') return {text: `Order ${String(event.verb ?? '').toUpperCase()}${event.node ? ` ${event.node}` : ''}`};
  if (type === 'coop-spend') return {text: `Spend ${String(event.verb ?? '').toUpperCase()} · ${Math.round(Number(event.cost) || 0)} FLUX`};
  if (type === 'cocs-buy') return {text: `Requisition ${String(event.itemId ?? '').toUpperCase()}${event.depot ? ` · ${String(event.depot).toUpperCase()}` : ''} · ${Math.round(Number(event.cost) || 0)} REQ`};
  if (type === 'director-intermission') return {text: `Intermission · wave ${Number(event.nextWave) || ''}`.trim()};
  if (type === 'coop-intermission-open') return {text: 'Spend window open'};
  if (type === 'coop-reinforce') return {text: 'Reinforcements called'};
  if (type === 'coop-reserve') return {text: 'Reserve ticket burned'};
  if (type === 'operation-summary') return {text: `Operation summary · ${String(event.reason ?? '').replace(/-/g, ' ')}`};
  // Per-kind supply identity. A bare `pickup` keeps the historical 'Pickup'
  // table line; a known supply kind names itself and any other kind is a weapon.
  if (type === 'pickup') {
    const kind = String(event?.kind ?? '');
    const named = { health: 'Health acquired', armor: 'Armor acquired', ammo: 'Ammo acquired', megahealth: 'Mega health acquired' }[kind];
    return { text: named ?? (kind ? 'Weapon acquired' : 'Pickup') };
  }
  // A live spawn event carries its actor and position; the bare `{type:'spawn'}`
  // probe stays uncaptioned exactly as the historical table did.
  if (type === 'spawn') return event?.actor != null || event?.pos != null ? { text: 'Respawn' } : null;
  // Incoming damage: bearing wording when the host stamps the relative angle
  // hud.damageBearing produced, otherwise a plain incoming line.
  if (type === 'damage') {
    const word = bearingWord(event?.angle ?? event?.bearing);
    return { text: word ? `Damage taken · ${word}` : 'Damage taken' };
  }
  // Per-kind enemy telegraphs: the wave force carries a `kind` (feedback.mjs
  // voices a distinct motif per kind), so the caption names the threat without
  // waiting for the hit. Unknown/absent kinds keep the generic table line.
  if (type === 'enemy-telegraph') {
    const named = TELEGRAPH_CAPTIONS[String(event?.kind ?? '').toLowerCase()];
    return { text: named ? `Incoming attack · ${named}` : 'Incoming attack' };
  }
  // Charge-coil wind-up and release are weapon beats, not a generic row.
  if (type === 'charge') return { text: event?.state === 'ready' ? 'Charged shot ready' : 'Charging shot' };
  // Weather and time-of-day onsets name the new state when the event carries it.
  if (type === 'weather-change') {
    const kind = String(event?.kind ?? '').trim();
    return { text: kind ? `Weather · ${kind}` : 'Weather change' };
  }
  if (type === 'time-change') {
    const phase = String(event?.phase ?? '').trim();
    return { text: phase ? `Time of day · ${phase}` : 'Time of day change' };
  }
  const text = CAPTION_EVENTS[type];
  return text ? { text } : null;
}

// Short "who hit me" line for the non-live incoming-damage chip. The page
// threads the authoritative event fields (attacker name, the attacker's weapon
// index, the ability that landed the blow, the amount and the local actor's
// remaining health) into one payload; this formats it exactly once so the chip
// and any future surface cannot drift. Unknown parts never leave a dangling
// separator.
export function damageHitText(info, weapons = []) {
  if (!info || typeof info !== 'object') return '';
  const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const name = clean(info.name);
  const ability = clean(info.abilityName) || (typeof info.ability === 'string' ? clean(info.ability) : '');
  const index = Number.isInteger(info.weapon) ? info.weapon : null;
  const weapon = index !== null && weapons?.[index]?.short ? clean(weapons[index].short) : '';
  const amount = Math.max(0, Math.round(Number(info.amount) || 0));
  const health = Number.isFinite(Number(info.health)) ? Math.max(0, Math.round(Number(info.health))) : null;
  const parts = [name ? `HIT BY ${name.toUpperCase()}` : 'HIT'];
  const detail = ability ? ability.toUpperCase() : weapon.toUpperCase();
  if (detail) parts.push(detail);
  if (amount > 0) parts.push(String(amount));
  if (health !== null) parts.push(`${health} HP`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Client-side damage ledger (§WP2 death recap). The page keeps the last three
// incoming hits straight from the authoritative `damage` events; these pure
// helpers normalize one event into a ledger row, bound the ledger, age it
// against the snapshot clock and decide assist credit. No protocol change and
// no new live region: the recap is a non-live list on the death surface.
// ---------------------------------------------------------------------------
export const DAMAGE_LOG_LIMIT = 3;

export function damageLogEntry(info, at) {
  if (!info || typeof info !== 'object') return null;
  const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const name = clean(info.name);
  const ability = clean(info.abilityName) || clean(info.ability);
  const index = Number.isInteger(info.weapon) ? info.weapon : null;
  const amount = Math.max(0, Math.round(Number(info.amount) || 0));
  const when = Number.isFinite(Number(at)) ? Math.max(0, Number(at)) : 0;
  return {name, weapon: index, detail: ability || null, amount, at: when, source: clean(info.source) || null};
}

// Newest hit first, aged against the snapshot clock and bounded to `limit`.
// Rows for a readout are plain data: `{name, detail, amount, age}` plus the raw
// keys so a caller can render exactly what it needs.
export function damageRecap(log, now, {limit = DAMAGE_LOG_LIMIT} = {}) {
  const time = Number.isFinite(Number(now)) ? Number(now) : 0;
  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DAMAGE_LOG_LIMIT;
  const rows = (Array.isArray(log) ? log : []).filter(row => row && typeof row === 'object');
  return rows.slice(Math.max(0, rows.length - cap)).reverse().map(row => {
    const at = Number.isFinite(Number(row.at)) ? Number(row.at) : 0;
    return {...row, age: Math.max(0, time - at)};
  });
}

// Assist credit: true when the victim took local damage no more than `window`
// seconds before the death, judged on the caller's authoritative sim time (the
// page records the damage mark and reads the death from the same clock). A
// missing, future or stale mark never credits.
export function assistCredit(marks, victim, time, window = 5) {
  const id = victim === null || victim === undefined ? null : String(victim);
  if (id === null || !marks || typeof marks !== 'object') return false;
  const at = Number(marks[id] ?? marks[victim]);
  const when = Number(time);
  const span = Number(window) > 0 ? Number(window) : 5;
  if (!Number.isFinite(at) || !Number.isFinite(when)) return false;
  const age = when - at;
  return age >= 0 && age <= span;
}

// ---------------------------------------------------------------------------
// Caption replacement policy. Captions arrive event-by-event and are normally
// last-write-wins, but a burst of routine lines (gunfire, reloads, pickups)
// must not clobber an important beat (a mission failure, a boss phase, a
// wave call) that is still inside its display window. The ranks are the
// assistive channel's own priorities, so the two systems cannot disagree about
// what matters, and `CAPTION_TTL` keeps the page's existing 2.2 s lifetime.
export const CAPTION_TTL = 2.2;

const CAPTION_PRIORITY_BY_TYPE = Object.freeze({
  'mission-won': ASSISTIVE_PRIORITY.death,
  'mission-lost': ASSISTIVE_PRIORITY.death,
  death: ASSISTIVE_PRIORITY.death,
  'objective-win': ASSISTIVE_PRIORITY.objective,
  'zone-capture': ASSISTIVE_PRIORITY.objective,
  'zone-score': ASSISTIVE_PRIORITY.objective,
  'flag-pickup': ASSISTIVE_PRIORITY.objective,
  'flag-pass': ASSISTIVE_PRIORITY.objective,
  'payload-delivered': ASSISTIVE_PRIORITY.objective,
  'assault-breach': ASSISTIVE_PRIORITY.objective,
  // A stand or cart under contest is a threat alert, not routine chatter: it
  // holds its window in the callout band while a relay stays an objective beat.
  'flag-contest': ASSISTIVE_PRIORITY.callout,
  'payload-contest': ASSISTIVE_PRIORITY.callout,
  'boss-phase': ASSISTIVE_PRIORITY.sudden,
  'director-siege': ASSISTIVE_PRIORITY.sudden,
  // Sudden death and the time-limit tiebreak are objective-ending beats: they
  // own the sudden band, above every callout.
  'sudden-death': ASSISTIVE_PRIORITY.sudden,
  'objective-tiebreak': ASSISTIVE_PRIORITY.objective,
  'enemy-telegraph': ASSISTIVE_PRIORITY.callout,
  killstreak: ASSISTIVE_PRIORITY.callout,
  'vehicle-destroyed': ASSISTIVE_PRIORITY.callout,
  'horde-wave': ASSISTIVE_PRIORITY.callout,
  'horde-wave-cleared': ASSISTIVE_PRIORITY.callout,
  // Objective and threat beats keep the callout band: a wave-force aura, a
  // flank, an artillery warning or a lost sentry must hold its window.
  'overseer-aura': ASSISTIVE_PRIORITY.callout,
  'phalanx-shield': ASSISTIVE_PRIORITY.callout,
  'enemy-artillery': ASSISTIVE_PRIORITY.callout,
  'enemy-flank': ASSISTIVE_PRIORITY.callout,
  'boss-slam': ASSISTIVE_PRIORITY.callout,
  'boss-summon': ASSISTIVE_PRIORITY.callout,
  'deployable-destroyed': ASSISTIVE_PRIORITY.callout,
  bounty: ASSISTIVE_PRIORITY.callout,
  'horde-summary': ASSISTIVE_PRIORITY.objective,
  // Support and economy beats sit in the notice band. A holdout tick repeats
  // every five seconds of held time, so it reads as notice-band progress and
  // never claims the protection a discrete objective beat holds.
  'lattice-support': ASSISTIVE_PRIORITY.notice,
  // Depot logistics, role agents and the prime channel: a loaner rolling out, a
  // primed node and a cut link are discrete objective beats; the cadence role
  // beats stay notice-band so a siege or a capture loss still owns the channel.
  'cocs-depot-vehicle-spawn': ASSISTIVE_PRIORITY.objective,
  'cocs-depot-purchase': ASSISTIVE_PRIORITY.notice,
  'cocs-terminal-sabotage': ASSISTIVE_PRIORITY.objective,
  'cocs-sapper': ASSISTIVE_PRIORITY.objective,
  'cocs-siphon': ASSISTIVE_PRIORITY.notice,
  'cocs-scan': ASSISTIVE_PRIORITY.notice,
  'cocs-role-spawn': ASSISTIVE_PRIORITY.notice,
  'cocs-role-killed': ASSISTIVE_PRIORITY.callout,
  'cocs-role-expire': ASSISTIVE_PRIORITY.notice,
  'cocs-role-rally': ASSISTIVE_PRIORITY.notice,
  'cocs-role-repair': ASSISTIVE_PRIORITY.notice,
  'cocs-role-spot': ASSISTIVE_PRIORITY.notice,
  'cocs-prime-start': ASSISTIVE_PRIORITY.notice,
  'cocs-prime': ASSISTIVE_PRIORITY.objective,
  'cocs-prime-interrupt': ASSISTIVE_PRIORITY.callout,
  'holdout-progress': ASSISTIVE_PRIORITY.notice,
  'vehicle-repair': ASSISTIVE_PRIORITY.notice,
  'deployable-repaired': ASSISTIVE_PRIORITY.notice,
  'weapon-upgrade': ASSISTIVE_PRIORITY.notice,
  charge: ASSISTIVE_PRIORITY.notice,
  'weather-change': ASSISTIVE_PRIORITY.notice,
  'time-change': ASSISTIVE_PRIORITY.notice,
  'mission-message': ASSISTIVE_PRIORITY.notice,
  'director-intermission': ASSISTIVE_PRIORITY.notice,
  'singleplayer-checkpoint': ASSISTIVE_PRIORITY.notice,
  'story-line': ASSISTIVE_PRIORITY.notice,
  'npc-bark': ASSISTIVE_PRIORITY.notice,
  'npc-deploy': ASSISTIVE_PRIORITY.notice,
});

// Rank for a caption event. Unknown/routine events share the channel's lowest
// ranked band, so they never displace a protected line but still update freely.
export function captionPriority(event) {
  return CAPTION_PRIORITY_BY_TYPE[String(event?.type)] ?? ASSISTIVE_PRIORITY.order;
}

// Replacement policy: returns the entry to show (with `at`) or null when the
// showing line survives. A protected line (callout and above) holds its window
// against equal-or-lower ranks; routine captions stay last-write-wins; an
// identical line inside the window is deduped instead of restarting the clock.
export function acceptCaption(current, currentAt, candidate, at, ttl = CAPTION_TTL) {
  const text = typeof candidate?.text === 'string' ? candidate.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) return null;
  const when = Number.isFinite(Number(at)) ? Number(at) : 0;
  const priority = Number.isFinite(Number(candidate?.priority)) ? Number(candidate.priority) : ASSISTIVE_PRIORITY.order;
  const entry = {text, priority, at: when};
  const shown = typeof current === 'string' && current
    ? {text: current, priority: ASSISTIVE_PRIORITY.order}
    : current && typeof current.text === 'string' && current.text ? current : null;
  if (!shown) return entry;
  const shownAt = Number(currentAt);
  const age = Number.isFinite(shownAt) ? when - shownAt : Infinity;
  const window = Number(ttl) > 0 ? Number(ttl) : CAPTION_TTL;
  if (!(age >= 0) || age >= window) return entry;
  if (shown.text === text) return null;
  const shownPriority = Number.isFinite(Number(shown.priority)) ? Number(shown.priority) : ASSISTIVE_PRIORITY.order;
  if (shownPriority >= ASSISTIVE_PRIORITY.callout && priority <= shownPriority) return null;
  return entry;
}

export function grenadeStatus(player) {
  const cooldown = Math.max(0, Number(player?.grenadeCooldown) || 0);
  return { ready: cooldown <= 0, cooldown, label: cooldown <= 0 ? 'FRAG READY' : `FRAG ${formatCountdown(cooldown)}s` };
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
  // LATTICE STRIKE OP income is continuous, so every integer crossing would
  // fire an announcer. The dedicated lattice readout owns the score instead.
  if (isCocsMode(mode)) return null;
  for (const team of [0, 1]) {
    const before = Math.floor(Number(prevScores[team])), after = Math.floor(Number(scores[team]));
    if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) continue;
    return {team, kind: soccer ? 'goal' : capture ? 'capture' : 'score', text: soccer ? `${teamName(team)} GOAL` : capture ? 'FLAG CAPTURED' : `${teamName(team)} SCORES`, score: after, amount: after - before};
  }
  return null;
}

// LATTICE objective beats. One pure translation from an authoritative cocs
// event to the banner/announcer model the match page renders. Kept separate
// from `scoreAnnouncer` because OP income is continuous while these beats are
// event-driven: a capture, an order completing, a refusal, a terminal.
//
// `mine` reports friendly ownership only; it is deliberately NOT the banner
// filter (F02). An enemy capture of a friendly node ("lost") and of a neutral
// node ("taken") both have to reach the HUD, and the teamless Operations
// wave/siege beats describe the player's own mission. Relevance is explicit in
// `relevance`; replacement is the bounded policy in `acceptCocsAnnouncement`.
const reasonWords = value => String(value ?? 'blocked').replace(/-/g, ' ').toUpperCase();
// Role-agent names (`saboteur`, `harvester`, ...) share the same dash-to-space
// wording so a banner and a caption never spell one role two ways.
const roleWords = value => String(value ?? 'agent').replace(/-/g, ' ').toUpperCase();

// Bounded announcement ranks. A strictly higher rank replaces what is showing;
// equal rank replaces on a different dedupe key; identical keys are absorbed
// while live; anything lower cannot displace an urgent siege or capture-loss
// banner before its TTL expires.
export const COCS_ANNOUNCE_PRIORITY = Object.freeze({
  siegeLifted: 110,
  siege: 100,
  loss: 90,
  secure: 75,
  // Depot/role economy beats: a primed node and a loaner leaving the pad
  // outrank a neutral take but never a capture loss. Sabotage and a cut link
  // sit just below them; role agents, requisition and the cadence support
  // beats follow, and a scan sweep is the quietest of the family.
  prime: 68,
  loaner: 65,
  sabotage: 62,
  neutral: 60,
  wave: 55,
  sapper: 54,
  role: 52,
  requisition: 50,
  support: 46,
  order: 45,
  // Commander intent sits just below the objective beats: a stance or route is
  // a team-wide plan change, and seating/stepping down is informational.
  command: 43,
  policy: 42,
  route: 41,
  siphon: 44,
  terminal: 40,
  scan: 38,
  refused: 35,
  issued: 15,
});

// Per-beat display lifetime: urgent objective changes hold longer than a
// routine order beat, then expire so a stale banner never outlives the moment.
const COCS_ANNOUNCE_TTL = Object.freeze({siege: 6, loss: 5, secure: 4, loaner: 4, prime: 4, neutral: 3.5, wave: 3.5, sabotage: 3.5, sapper: 3.5, role: 3, requisition: 3, order: 3, support: 3, siphon: 3, terminal: 3, scan: 2.5, refused: 3, issued: 1.6, command: 3.5, policy: 3.5, route: 3.5});

export const cocsAnnouncePriority = beat => {
  const value = Number(beat?.priority);
  return Number.isFinite(value) ? value : 0;
};

export const cocsAnnouncementTTL = beat => {
  const value = Number(beat?.ttl);
  return Number.isFinite(value) && value > 0 ? value : 1.6;
};

// The single-cue replacement policy. Pure: returns `{cue, at}` when the new
// beat takes the banner, or null when the showing cue survives. `at` is the
// caller's authoritative match/snapshot time, never a wall clock.
export function acceptCocsAnnouncement(current, currentAt, beat, at) {
  if (!beat || typeof beat !== 'object') return null;
  const time = Number(at);
  const when = Number.isFinite(time) ? time : 0;
  if (!current || typeof current !== 'object') return {cue: beat, at: when};
  const shownAt = Number(currentAt);
  const age = Number.isFinite(shownAt) ? when - shownAt : Infinity;
  // A stale cue never blocks: notifications expire on their own TTL.
  if (!(age >= 0) || age >= cocsAnnouncementTTL(current)) return {cue: beat, at: when};
  // The same event replayed or repeated does not double-fire.
  if (beat.dedupeKey && beat.dedupeKey === current.dedupeKey) return null;
  const rank = cocsAnnouncePriority(beat), shown = cocsAnnouncePriority(current);
  if (rank > shown) return {cue: beat, at: when};
  if (rank === shown) return {cue: beat, at: when};
  return null;
}

export function cocsAnnouncement(event, player) {
  if (!event || typeof event !== 'object') return null;
  const team = player?.team === 1 ? 1 : 0;
  const mine = event.team === team;
  const paid = Array.isArray(event.participants) && event.participants.includes(player?.id);
  switch (event.type) {
    case 'cocs-capture': {
      const label = String(event.label ?? event.node ?? 'NODE').toUpperCase();
      const previousOwner = event.previousOwner === 0 || event.previousOwner === 1 ? Number(event.previousOwner) : null;
      const parts = [];
      if (Number(event.reward?.op) > 0) parts.push(`+${Number(event.reward.op)} OP`);
      if (paid && Number(event.reward?.req) > 0) parts.push(`+${Number(event.reward.req)} REQ`);
      if (event.orderCompleted === true) parts.push('ORDER COMPLETE');
      if (mine && previousOwner !== null && previousOwner !== team) parts.push(`TAKEN FROM ${teamName(previousOwner)}`);
      const common = {kind: 'capture', team: event.team, previousOwner,
        dedupeKey: `capture:${event.team}:${event.node ?? event.label ?? ''}`};
      if (mine) return {...common, mine: true, relevance: 'friendly', priority: COCS_ANNOUNCE_PRIORITY.secure, ttl: COCS_ANNOUNCE_TTL.secure,
        text: `OBJECTIVE SECURED · ${label}`, detail: parts.join(' · ')};
      // Losing a friendly node and an enemy taking a neutral point are
      // different beats: only the first one is "lost" to this team.
      if (previousOwner === team) return {...common, mine: false, relevance: 'enemy', priority: COCS_ANNOUNCE_PRIORITY.loss, ttl: COCS_ANNOUNCE_TTL.loss,
        text: `OBJECTIVE LOST · ${label}`, detail: parts.join(' · ')};
      return {...common, mine: false, relevance: 'enemy', priority: COCS_ANNOUNCE_PRIORITY.neutral, ttl: COCS_ANNOUNCE_TTL.neutral,
        text: `ENEMY SECURED · ${label}`, detail: [...parts, 'NEUTRAL NODE'].join(' · ')};
    }
    case 'cocs-order-complete': {
      if (event.team !== team) return null; // team-private order feed
      const label = String(event.label ?? event.node ?? 'NODE').toUpperCase();
      const contributed = Array.isArray(event.contributors) && event.contributors.includes(player?.id);
      return {kind: 'order', team: event.team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.order, ttl: COCS_ANNOUNCE_TTL.order,
        dedupeKey: `order:${event.team}:${event.node ?? ''}:${event.verb ?? ''}`,
        text: `ORDER COMPLETE · ${label}`,
        detail: [contributed ? 'YOUR SQUAD PAID' : 'TEAM PAID', Number(event.teamOP) > 0 ? `+${Number(event.teamOP)} TEAM OP` : ''].filter(Boolean).join(' · ')};
    }
    case 'cocs-order-rejected':
      if (event.team !== team) return null; // team-private order feed
      return {kind: 'refused', team: event.team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.refused, ttl: COCS_ANNOUNCE_TTL.refused,
        dedupeKey: `refused:order:${event.team}:${event.reason ?? ''}:${event.verb ?? ''}`,
        text: `ORDER REFUSED · ${reasonWords(event.reason)}`,
        detail: [event.verb, event.label ?? event.node].filter(Boolean).join(' · ').toUpperCase()};
    case 'coop-spend-rejected':
      return {kind: 'refused', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.refused, ttl: COCS_ANNOUNCE_TTL.refused,
        dedupeKey: `refused:spend:${event.reason ?? ''}:${event.verb ?? ''}`,
        text: `SPEND REFUSED · ${reasonWords(event.reason)}`, detail: String(event.verb ?? '').toUpperCase()};
    case 'cocs-order':
      if (event.team !== team) return null; // team-private order feed
      return {kind: 'order-issued', team: event.team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.issued, ttl: COCS_ANNOUNCE_TTL.issued,
        dedupeKey: `issued:${event.team}:${event.node ?? ''}:${event.verb ?? ''}`,
        text: `${String(event.verb ?? 'ORDER').toUpperCase()} · ${String(event.label ?? event.node ?? '').toUpperCase()}`,
        detail: 'ORDER SENT'};
    case 'cocs-terminal-hack':
    case 'cocs-terminal-deploy':
    case 'cocs-terminal-vault': {
      if (event.team !== team) return null;
      return {kind: 'terminal', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.terminal, ttl: COCS_ANNOUNCE_TTL.terminal,
        dedupeKey: `terminal:${event.type}:${event.terminal ?? ''}`,
        text: `${String(event.type.split('-')[2] ?? 'TERMINAL').toUpperCase()} COMPLETE`, detail: String(event.terminal ?? '').toUpperCase()};
    }
    // Depot logistics. The loaner spawn is world-visible: the owning team reads
    // LOANER READY, the other side reads ENEMY LOANER off the same event. The
    // REQ purchase is team-private like the order feed.
    case 'cocs-depot-vehicle-spawn': {
      const label = String(event.label ?? event.depot ?? event.vehicle ?? 'DEPOT').replace(/-/g, ' ').toUpperCase();
      // The sim always stamps the owning team; a hand-built beat without one
      // reads as the local side rather than inventing an enemy deployment.
      const owner = event.team === 0 || event.team === 1 ? Number(event.team) : team;
      const common = {kind: 'loaner', team: owner, previousOwner: null,
        dedupeKey: `loaner:${owner}:${event.depot ?? event.vehicle ?? ''}`};
      if (owner === team) return {...common, mine: true, relevance: 'friendly', priority: COCS_ANNOUNCE_PRIORITY.loaner, ttl: COCS_ANNOUNCE_TTL.loaner,
        text: `LOANER READY · ${label}`, detail: 'PUMA ON THE DEPOT PAD'};
      return {...common, mine: false, relevance: 'enemy', priority: COCS_ANNOUNCE_PRIORITY.loaner, ttl: COCS_ANNOUNCE_TTL.loaner,
        text: `ENEMY LOANER · ${label}`, detail: 'HOSTILE PUMA DEPLOYED'};
    }
    case 'cocs-depot-purchase':
      if (event.team !== team) return null;
      return {kind: 'requisition', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.requisition, ttl: COCS_ANNOUNCE_TTL.requisition,
        dedupeKey: `requisition:${event.depot ?? ''}:${event.vehicle ?? ''}`,
        text: `${String(event.item ?? 'PUMA').toUpperCase()} REQUISITIONED`,
        detail: String(event.depot ?? '').replace(/-/g, ' ').toUpperCase()};
    // Saboteur and scout kit. Team-private: only the acting side gets a banner.
    case 'cocs-terminal-sabotage':
      if (event.team !== team) return null;
      return {kind: 'sabotage', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.sabotage, ttl: COCS_ANNOUNCE_TTL.sabotage,
        dedupeKey: `sabotage:${event.terminal ?? ''}`,
        text: `SABOTAGE COMPLETE · ${String(event.terminal ?? 'TERMINAL').replace(/-/g, ' ').toUpperCase()}`,
        detail: event.node ? String(event.node).replace(/-/g, ' ').toUpperCase() : ''};
    case 'cocs-sapper': {
      if (event.team !== team) return null;
      const denied = Math.max(0, Math.round(Number(event.denied) || 0));
      return {kind: 'cut', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.sapper, ttl: COCS_ANNOUNCE_TTL.sapper,
        dedupeKey: `cut:${event.node ?? ''}:${event.until ?? ''}`,
        text: `LINK CUT · ${String(event.node ?? 'NODE').replace(/-/g, ' ').toUpperCase()}`,
        detail: [denied > 0 ? `${denied} NODE DENIED` : '', Number(event.bounty) > 0 ? `+${Math.round(Number(event.bounty))} FLUX` : ''].filter(Boolean).join(' · ')};
    }
    case 'cocs-siphon': {
      if (event.team !== team) return null;
      const flux = Math.max(0, Math.round(Number(event.flux) || 0));
      return {kind: 'siphon', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.siphon, ttl: COCS_ANNOUNCE_TTL.siphon,
        dedupeKey: `siphon:${event.node ?? ''}`,
        text: `FLUX SIPHONED · ${flux}`, detail: String(event.node ?? '').replace(/-/g, ' ').toUpperCase()};
    }
    case 'cocs-scan': {
      if (event.team !== team) return null;
      const marked = Math.max(0, Math.round(Number(event.marked) || 0));
      return {kind: 'scan', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.scan, ttl: COCS_ANNOUNCE_TTL.scan,
        dedupeKey: `scan:${event.actor ?? ''}:${event.until ?? ''}`,
        text: `SCAN SWEEP · ${marked} MARKED`, detail: ''};
    }
    // Role agents. Spawns, losses and expirations belong to the owning team.
    case 'cocs-role-spawn':
      if (event.team !== team) return null;
      return {kind: 'role', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.role, ttl: COCS_ANNOUNCE_TTL.role,
        dedupeKey: `role:spawn:${event.team}:${event.role ?? ''}:${event.actor ?? ''}`,
        text: `AGENT DEPLOYED · ${roleWords(event.role)}`,
        detail: event.node ? String(event.node).replace(/-/g, ' ').toUpperCase() : ''};
    case 'cocs-role-killed':
      if (event.team !== team) return null;
      return {kind: 'role', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.role, ttl: COCS_ANNOUNCE_TTL.role,
        dedupeKey: `role:killed:${event.team}:${event.role ?? ''}:${event.actor ?? ''}`,
        text: `AGENT LOST · ${roleWords(event.role)}`,
        detail: Number(event.bounty) > 0 ? `+${Math.round(Number(event.bounty))} FLUX TO THE KILLER` : ''};
    case 'cocs-role-expire':
      if (event.team !== team) return null;
      return {kind: 'role', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.role, ttl: COCS_ANNOUNCE_TTL.role,
        dedupeKey: `role:expire:${event.team}:${event.role ?? ''}:${event.actor ?? ''}`,
        text: `AGENT RETIRED · ${roleWords(event.role)}`,
        detail: Number(event.refund) > 0 ? `+${Math.round(Number(event.refund))} FLUX REFUNDED` : ''};
    // Teamless ally support beats: in OPERATIONS they are always the player's
    // own side, so they read mine/friendly without a team filter.
    case 'cocs-role-rally': {
      const targets = Array.isArray(event.targets) ? event.targets.length : 0;
      return {kind: 'role', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.role, ttl: COCS_ANNOUNCE_TTL.role,
        dedupeKey: `rally:${event.actor ?? ''}:${targets}`,
        text: `RALLY · ${targets} LINKED`, detail: Number(event.shield) > 0 ? `+${Math.round(Number(event.shield))} SHIELD` : ''};
    }
    case 'cocs-role-repair': {
      const repaired = Array.isArray(event.repaired) ? event.repaired.length : 0;
      return {kind: 'role', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.support, ttl: COCS_ANNOUNCE_TTL.support,
        dedupeKey: `repair:${event.actor ?? ''}:${repaired}`,
        text: `REPAIRS DONE · ${repaired} RESTORED`, detail: ''};
    }
    case 'cocs-role-spot': {
      const targets = Array.isArray(event.targets) ? event.targets.length : 0;
      return {kind: 'role', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.support, ttl: COCS_ANNOUNCE_TTL.support,
        dedupeKey: `spot:${event.actor ?? ''}:${targets}`,
        text: `SPOT · ${targets} MARKED`, detail: ''};
    }
    // The prime channel is world-visible: both sides watch a node come online.
    case 'cocs-prime-start':
      return {kind: 'prime', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.role, ttl: COCS_ANNOUNCE_TTL.role,
        dedupeKey: `prime-start:${event.node ?? ''}:${event.actor ?? ''}`,
        text: `PRIME STARTED · ${String(event.node ?? 'NODE').replace(/-/g, ' ').toUpperCase()}`,
        detail: Number(event.seconds) > 0 ? `${Math.round(Number(event.seconds))}s CHANNEL` : ''};
    case 'cocs-prime':
      return {kind: 'prime', team, mine: event.team === team || event.team === undefined, relevance: event.team === team || event.team === undefined ? 'friendly' : 'enemy', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.prime, ttl: COCS_ANNOUNCE_TTL.prime,
        dedupeKey: `prime:${event.node ?? ''}:${event.seconds ?? ''}`,
        text: `NODE PRIMED · ${String(event.node ?? 'NODE').replace(/-/g, ' ').toUpperCase()}`,
        detail: Number(event.seconds) > 0 ? `${Math.round(Number(event.seconds))}s FLUX WINDOW` : ''};
    case 'cocs-prime-interrupt':
      return {kind: 'prime', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.support, ttl: COCS_ANNOUNCE_TTL.support,
        dedupeKey: `prime-interrupt:${event.node ?? ''}:${event.actor ?? ''}`,
        text: `PRIME INTERRUPTED · ${String(event.node ?? 'NODE').replace(/-/g, ' ').toUpperCase()}`,
        detail: 'CHANNEL BROKEN'};
    case 'director-wave-cleared': {
      // Teamless in its normal shape: the Operations Director never clears a
      // wave, so this is always the player's own mission beat.
      const wave = Number(event.wave);
      const cleared = Number(event.cleared), total = Number(event.waveCount);
      const detail = Number.isFinite(cleared) && Number.isFinite(total) && total > 0
        ? `WAVES ${formatNumber(cleared, 0)}/${formatNumber(total, 0)}` : '';
      return {kind: 'wave', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.wave, ttl: COCS_ANNOUNCE_TTL.wave,
        dedupeKey: `wave:${Number.isFinite(wave) ? wave : ''}`,
        text: `WAVE ${Number.isFinite(wave) ? wave : ''} CLEARED`.trim(), detail};
    }
    case 'director-siege':
      return {kind: 'siege', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.siege, ttl: COCS_ANNOUNCE_TTL.siege,
        dedupeKey: `siege:${event.wave ?? ''}`, text: 'HQ UNDER SIEGE', detail: 'FALL BACK AND CLEAR THE BREACH'};
    case 'director-siege-lifted':
      return {kind: 'siege', team, mine: true, relevance: 'friendly', previousOwner: null,
        priority: COCS_ANNOUNCE_PRIORITY.siegeLifted, ttl: COCS_ANNOUNCE_TTL.siege,
        dedupeKey: `siege-lifted:${event.wave ?? ''}`, text: 'HQ SECURE', detail: 'SIEGE LIFTED'};
    // Commander command beats. Team-private: only the issuing side is voiced,
    // and every action has its own short line so the strip never needs to diff
    // the command state to explain itself.
    case 'cocs-command': {
      if (event.team !== team) return null;
      const stance = event.policy ? String(event.policy).toUpperCase() : null;
      const common = {kind: 'command', team, mine: true, relevance: 'friendly', previousOwner: null};
      if (event.action === 'take') return {...common, priority: COCS_ANNOUNCE_PRIORITY.command, ttl: COCS_ANNOUNCE_TTL.command,
        dedupeKey: `command:take:${team}`, text: 'COMMAND ASSUMED', detail: 'ORDERS AND STANCES ARE YOURS'};
      if (event.action === 'release') return {...common, priority: COCS_ANNOUNCE_PRIORITY.command, ttl: COCS_ANNOUNCE_TTL.command,
        dedupeKey: `command:release:${team}`, text: 'COMMAND RELEASED', detail: 'THE CHIEF HOLDS THE LINE'};
      if (event.action === 'mutiny-vote') {
        if (event.seat) return {...common, priority: COCS_ANNOUNCE_PRIORITY.command, ttl: COCS_ANNOUNCE_TTL.command,
          dedupeKey: `command:mutiny:${team}`, text: 'MUTINY CARRIED', detail: 'NEW COMMANDER SEATED'};
        return {...common, priority: COCS_ANNOUNCE_PRIORITY.policy, ttl: COCS_ANNOUNCE_TTL.policy,
          dedupeKey: `command:vote:${team}`, text: 'MUTINY VOTE', detail: `${Math.max(0, Number(event.votes) || 0)}/${Math.max(1, Number(event.needed) || 1)} VOTES`};
      }
      if (event.action === 'policy') {
        if (!stance) return {...common, priority: COCS_ANNOUNCE_PRIORITY.policy, ttl: COCS_ANNOUNCE_TTL.policy,
          dedupeKey: `command:policy:${team}`, text: 'STANCE CLEARED', detail: 'BALANCED PLAN'};
        const detail = stance === 'ASSAULT' ? 'PUSH EVERY NODE' : stance === 'FORTIFY' ? 'FALL BACK AND HOLD' : 'BALANCED PLAN';
        return {...common, priority: COCS_ANNOUNCE_PRIORITY.policy, ttl: COCS_ANNOUNCE_TTL.policy,
          dedupeKey: `command:policy:${team}`, text: `STANCE · ${stance}`, detail};
      }
      if (event.action === 'set-route') {
        const label = event.value ? String(event.value).replace(/-/g, ' ').toUpperCase() : 'AUTO';
        return {...common, priority: COCS_ANNOUNCE_PRIORITY.route, ttl: COCS_ANNOUNCE_TTL.route,
          dedupeKey: `command:route:${team}`, text: `ROUTE · ${label}`, detail: event.value ? 'THE SQUAD PUSHES IT' : 'ROUTE CLEARED'};
      }
      return null;
    }
    default:
      return null;
  }
}

// Which announcer cue a LATTICE beat uses. Pure so the view can consume it
// without duplicating the event table; only events that represent a completed
// team beat return a cue (issuing an order stays silent).
export function latticeAnnounceCue(event, playerId) {
  switch (event?.type) {
    case 'cocs-capture':
      return Array.isArray(event.participants) && event.participants.includes(playerId) ? 'capture' : 'objective';
    case 'cocs-order-complete':
    case 'cocs-terminal-hack':
    case 'cocs-terminal-deploy':
    case 'cocs-terminal-vault':
    // Depot loaners, the saboteur/scout kit, role agents and the prime beam are
    // completed friendly beats: the objective callout, not a warning.
    case 'cocs-depot-vehicle-spawn':
    case 'cocs-depot-purchase':
    case 'cocs-terminal-sabotage':
    case 'cocs-sapper':
    case 'cocs-siphon':
    case 'cocs-scan':
    case 'cocs-role-spawn':
    case 'cocs-role-rally':
    case 'cocs-role-repair':
    case 'cocs-role-spot':
    case 'cocs-command':
    case 'cocs-prime-start':
    case 'cocs-prime':
    case 'director-wave-cleared':
    case 'director-siege-lifted':
      return 'objective';
    case 'cocs-order-rejected':
    case 'cocs-role-killed':
    case 'cocs-role-expire':
    case 'cocs-prime-interrupt':
    case 'coop-spend-rejected':
      return 'feint';
    case 'director-siege':
    case 'director-boss':
    case 'director-phase':
    case 'director-overrun':
      return 'boss';
    case 'director-spawn-telegraph':
    case 'director-escalation':
    case 'director-retarget':
    case 'director-reinforce':
    case 'director-init':
    case 'director-intermission':
    case 'cocs-buy':
      return 'objective';
    case 'director-denial':
      return 'feint';
    case 'coop-resupply':
    case 'coop-bonus':
      return 'power';
    case 'coop-reserve':
      return 'defeat';
    default:
      return null;
  }
}

const awardScore = actor => (Number(actor?.frags) || 0) * 3 + stat(actor, 'objectiveTime') + stat(actor, 'captures') * 5 + stat(actor, 'flagReturns') * 2;const stat = (actor, field) => Number(actor?.scoreStats?.[field]) || 0;
const ratio = actor => { const kills = Number(actor?.frags) || 0, deaths = Number(actor?.deaths) || 0; return deaths > 0 ? kills / deaths : kills; };

// NEW RECORD chips for the results card. `records` is `newPersonalBests`'
// output (a record object or a bare label string); each maps onto the exact
// `{id,label,name,value}` card the award strip already renders, so the results
// screen can show a record without new markup, a new surface or a live region.
// `record: true` marks the chip for styling; undefined rows are dropped rather
// than rendered as an empty badge.
export function recordBadges(records = []) {
  const list = Array.isArray(records) ? records : [];
  return list.map((record, index) => {
    if (record === null || record === undefined) return null;
    const source = typeof record === 'object' ? record : {label: record};
    const label = typeof source.label === 'string' && source.label ? source.label : `RECORD ${index + 1}`;
    const value = source.value === undefined || source.value === null ? '' : String(source.value);
    const id = typeof source.id === 'string' && source.id ? source.id : String(index);
    return {id: `record-${id}`, label: 'NEW RECORD', name: label, value, record: true};
  }).filter(Boolean);
}

export function matchAwards(hud, records = []) {
  const badges = recordBadges(records);
  const actors = (Array.isArray(hud?.actors) ? hud.actors : []).filter(actor => actor && actor.name && Number.isFinite(Number(actor.id)));
  if (actors.length < 2) return badges;
  const top = score => actors.reduce((best, actor) => score(actor) > score(best) ? actor : best, actors[0]);
  const awards = [];
  const mvp = top(awardScore);
  if (awardScore(mvp) > 0) awards.push({id: 'mvp', label: 'MATCH MVP', name: mvp.name, value: `${Number(mvp.frags) || 0} FRAGS`});
  const objective = top(actor => stat(actor, 'objectiveTime'));
  if (stat(objective, 'objectiveTime') > 0) awards.push({id: 'objective', label: 'MOST OBJECTIVE TIME', name: objective.name, value: `${formatNumber(stat(objective, 'objectiveTime'))}s`});
  const runner = top(actor => stat(actor, 'captures') * 3 + stat(actor, 'flagReturns') * 2 + stat(actor, 'flagPickups'));
  if (stat(runner, 'captures') + stat(runner, 'flagReturns') + stat(runner, 'flagPickups') > 0) awards.push({id: 'flag', label: 'FLAG RUNNER', name: runner.name, value: `${stat(runner, 'captures')} CAP · ${stat(runner, 'flagReturns')} RET`});
  const accurate = top(ratio);
  if (ratio(accurate) >= 1) awards.push({id: 'ratio', label: 'BEST K/D', name: accurate.name, value: formatNumber(ratio(accurate),2)});
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
  // New records lead the strip: they describe the local result, while the
  // existing awards keep their relative order and object shape untouched.
  return [...badges, ...awards];
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

// The HUD note text for `connectionQuality`. Renders the measured round trip
// plus the estimator's jitter and loss, with one spoken sentence for on-demand
// reading; it is a plain non-live readout at the call site.
export function qualityNote(quality) {
  if (!quality || typeof quality !== 'object') return null;
  const label = typeof quality.label === 'string' && quality.label ? quality.label : 'GOOD';
  const ms = Math.max(0, Math.round(Number(quality.ms) || 0));
  const jitter = Math.max(0, Math.round(Number(quality.jitter) || 0));
  const loss = Math.max(0, Math.round(Number(quality.loss) || 0));
  return {
    label, tone: quality.tone ?? 'good', ms, jitter, loss,
    text: `${ms}MS · J${jitter}MS · L${loss}%`,
    spoken: `Connection ${label.toLowerCase()}. ${ms} milliseconds round trip, ${jitter} milliseconds jitter, ${loss} percent packet loss.`,
  };
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
// The compact roster includes inactive actors so team totals stay stable.
export function spectatorTeams(actors, targetId, {points = {}, includeInactive = false} = {}) {
  const roster = (Array.isArray(actors) ? actors : []).filter(a => a && (includeInactive || a.health > 0));
  const byTeam = new Map();
  for (const a of roster) {
    const team = a.team === undefined || a.team === null || Number.isNaN(Number(a.team)) ? null : Number(a.team);
    const key = team === null ? 'free' : `t${team}`;
    if (!byTeam.has(key)) byTeam.set(key, {key, team, players: []});
    byTeam.get(key).players.push({
      id: a.id,
      name: a.name || `A${a.id}`,
      team,
      health: a.health,
      armor: Number(a.armor) || 0,
      frags: Number(a.frags) || 0,
      deaths: Number(a.deaths) || 0,
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
  if (isCocsMode(mode?.id)) return 'LATTICE CONTROL';
  if (mode?.id === 'holdout') return 'QUORUM HOLD';
  if (mode?.id === 'uplink') return 'RELAY STAGES';
  if (score === 'laps') return 'LAPS';
  if (score === 'captures') return 'CAPTURES';
  if (score === 'extraction') return 'EXTRACTION';
  if (score === 'hillTime') return 'HILL CONTROL';
  if (score === 'zoneTime') return 'ZONE CONTROL';
  if (score === 'sectors') return 'SECTORS';
  if (score === 'payload') return 'CHECKPOINTS';
  if (score === 'teamFrags') return 'TEAM FRAGS';
  if (score === 'ladder') return 'LADDER';
  if (score === 'juggernaut') return 'CROWN POINTS';
  if (score === 'elimination') return 'TEAM LIVES';
  if (score === 'goals') return 'GOALS';
  return isTeamMode(mode) ? 'TEAM FRAGS' : 'FRAGS';
};

// One-line target readout reused by the match-start banner and the top bar.
export const modeTargetText = (mode, target) => {
  const limit = Number(target);
  if (mode?.id === 'armsrace') return 'CLIMB THE LADDER';
  if (mode?.id === 'juggernaut') return 'HOLD THE CROWN · MOST POINTS';
  if (mode?.id === 'team-elimination') return Number.isFinite(limit) ? `TEAM LIVES · ${limit} EACH` : 'TEAM LIVES REMAINING';
  if (mode?.id === 'holdout') return 'HOLD A QUORUM';
  if (mode?.id === 'uplink') return 'RUN THE RELAY';
  if (mode?.id === 'vip-escort') return 'ESCORT THE VIP';
  if (isCocsMode(mode?.id)) return mode?.id === 'cocs-coop' ? 'CLEAR EVERY WAVE · KEEP THE HQ' : 'HOLD THE LATTICE';
  const goal = modeGoal(mode);
  return Number.isFinite(limit) ? `FIRST TO ${limit} ${goal}` : goal;
};

export const scoreText = value => formatNumber(value);
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
// Per-flag read model for the compact CTF reader. A carried flag keeps naming
// its carrier, and a home stand under contest appends `· STAND CONTESTED`.
// Contest data is optional client-side state keyed by flag team: `true`, an
// enemy count, or an event-shaped `{count}`. The page can stash it on the
// snapshot (`hud.flagContests`) or pass it as the second argument; with no
// contest data the pinned `flagText` copy is byte-identical to the historical
// helper, so an older snapshot and every existing reader stay unchanged.
const flagContestCount = value => {
  if (value === true) return 1;
  const count = Number(value && typeof value === 'object' ? value.count : value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

export function flagStatus(hud, contests = hud?.flagContests) {
  if (!Array.isArray(hud?.flags) || !hud.flags.length) return [];
  return hud.flags.map(f => {
    const carrier = hud?.actors?.find(a => a.id === f.carrier);
    const count = flagContestCount(contests?.[f.team]);
    const label = f.state === 'at-base' ? 'HOME' : f.state === 'carried' ? `CARRIED BY ${carrier?.name?.toUpperCase() || `A${f.carrier}`}` : 'DROPPED';
    return {
      team: f.team, state: f.state ?? null, carrier: f.carrier ?? null, carrierName: carrier?.name ?? null,
      contested: count > 0, count,
      text: `${teamName(f.team)} FLAG ${label}${count > 0 ? ' · STAND CONTESTED' : ''}`,
    };
  });
}

export const flagText = (hud, contests) => flagStatus(hud, contests).map(row => row.text).join('  ·  ');

export const modeColumns = mode => mode === 'ctf' ? [['captures', 'CAP'], ['flagPickups', 'PICK'], ['flagReturns', 'RET'], ['flagDrops', 'DROP']]
  : isCocsMode(mode) ? [['objectiveCaptures', 'CAPTURES'], ['objectiveTime', 'NODE TIME']]
  : mode === 'koth' ? [['objectiveTime', 'HILL TIME'], ['objectiveCaptures', 'CAP'], ['objectiveContests', 'CONTEST']]
    : mode === 'holdout' ? [['objectiveTime', 'ZONE TIME'], ['objectiveCaptures', 'CAP'], ['objectiveContests', 'CONTEST']]
      : mode === 'uplink' ? [['objectiveCaptures', 'RELAY'], ['objectiveContests', 'CONTEST']]
        : mode === 'vip-escort' ? [['objectiveTime', 'ESCORT TIME'], ['objectiveCaptures', 'EXTRACT']]
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
  if (isCocsMode(mode)) return [stats.objectiveCaptures, stats.objectiveTime];
  if (mode === 'ctf') return [stats.captures, stats.flagPickups + stats.flagReturns + stats.flagDrops];
  if (mode === 'koth' || mode === 'domination' || mode === 'combined-arms') return [stats.objectiveTime, stats.objectiveCaptures];
  if (mode === 'holdout') return [stats.objectiveTime, stats.objectiveCaptures];
  if (mode === 'uplink') return [stats.objectiveCaptures, stats.objectiveContests];
  if (mode === 'vip-escort') return [stats.objectiveTime, stats.objectiveCaptures];
  if (mode === 'assault' || mode === 'payload') return [stats.objectiveCaptures, stats.objectiveTime];
  if (mode === 'armsrace') return [Number(actor?.ladder) || 0, Number(actor?.frags) || 0];
  if (mode === 'puma-soccer') return [Number(actor?.goals) || Number(actor?.scoreStats?.goals) || 0];
  if (mode === 'juggernaut') return [Number(actor?.points) || 0, actor?.juggernaut === true ? 1 : 0];
  if (mode === 'team-elimination') return [Number(actor?.eliminations) || 0, Number(actor?.frags) || 0];
  return [0];
};

// Match-rules copy for each scoring model. Null means the mode needs no extra note.
export const objectiveCopy = score => ({
  cocs: 'Take linked lattice nodes. A node is capturable only next to one your team already owns, and it only pays objective score while a supply line links it back to your HQ. Hold the lattice, not the frag count.',
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

// ---------------------------------------------------------------------------
// LATTICE STRIKE (`cocs`) front-line readout.
//
// The frozen cocs snapshot carries `{nodes, scores, liveNodeIds, winner}` and
// nothing else. Phase, dominance progress, income and the exact `front` pick are
// internal to `game/cocs.mjs`, so these helpers derive the player-facing readout
// from the snapshot alone and never depend on fields W7 has not frozen in. A
// node is `{id, archetype, owner, progress:[p0,p1], contested, live}`.
export const COCS_ARCHETYPE_LABELS = Object.freeze({front: 'FRONT', economy: 'ECON', relay: 'RELAY', hq: 'HQ', array: 'ARRAY'});
export const COCS_ARCHETYPE_MARKS = Object.freeze({front: '▲', economy: '◆', relay: '⬢', hq: '⌂', array: '⬣'});
export const cocsArchetypeLabel = archetype => COCS_ARCHETYPE_LABELS[String(archetype)] ?? 'NODE';
// Shape glyphs pair with the text label so ownership/state never reads by
// colour alone (the accessibility rule §8.1).
export const cocsArchetypeMark = archetype => COCS_ARCHETYPE_MARKS[String(archetype)] ?? '●';

const cocsProgress = value => Math.max(0, Math.min(1, Number(value) || 0));
const cocsOwnerStatus = (owner, contested, team) => contested ? 'CONTESTED'
  : owner === null || owner === undefined ? 'NEUTRAL'
    : team !== null && owner === team ? 'YOURS'
      : team !== null ? 'ENEMY'
        : teamName(owner);

export function cocsBoard(hud, player) {
  const state = hud?.cocs;
  const team = player?.team === 0 || player?.team === 1 ? Number(player.team) : null;
  const raw = Array.isArray(state?.nodes) ? state.nodes : [];
  const nodes = raw.map((node, index) => {
    const progress = Array.isArray(node?.progress) ? node.progress : [0, 0];
    const p0 = cocsProgress(progress[0]), p1 = cocsProgress(progress[1]);
    const owner = node?.owner === 0 || node?.owner === 1 ? node.owner : null;
    const contested = node?.contested === true, live = node?.live === true;
    const myProgress = team === 0 ? p0 : team === 1 ? p1 : 0;
    const enemyProgress = team === 0 ? p1 : team === 1 ? p0 : 0;
    return {
      id: String(node?.id ?? index),
      archetype: node?.archetype ?? 'front',
      label: cocsArchetypeLabel(node?.archetype),
      mark: cocsArchetypeMark(node?.archetype),
      owner, ownerLabel: cocsOwnerStatus(owner, contested, team),
      mine: owner !== null && team !== null && owner === team,
      enemy: owner !== null && team !== null && owner !== team,
      contested, live, progress: [p0, p1], myProgress, enemyProgress,
      progressPercent: Math.round(Math.max(p0, p1) * 100),
    };
  });
  const live = nodes.filter(node => node.live);
  const owned = {0: 0, 1: 0};
  for (const node of nodes) if (node.owner === 0 || node.owner === 1) owned[node.owner]++;
  const contested = nodes.filter(node => node.contested === true);
  // Mirror `frontState`'s global pick: the live node with the most combined
  // capture progress. Fall back to a contested live node, a node the player is
  // taking, then the first live node.
  let front = null, best = 0;
  for (const node of live) {
    const total = node.progress[0] + node.progress[1];
    if (total > best + 1e-9) { best = total; front = node; }
  }
  if (!front) front = live.find(node => node.contested) ?? live.find(node => node.myProgress > 0) ?? live[0] ?? null;
  const scores = {0: Number(state?.scores?.[0]) || 0, 1: Number(state?.scores?.[1]) || 0};
  const other = team === null ? null : team === 0 ? 1 : 0;
  let hint = 'CAPTURE A NODE ADJACENT TO ONE YOU OWN';
  if (front) {
    if (front.contested) hint = `CONTEST ${front.label} · ${front.progressPercent}%`;
    else if (!front.mine && front.myProgress > 0) hint = `CAPTURING ${front.label} · ${front.progressPercent}%`;
    else if (front.mine && front.enemyProgress > 0) hint = `DEFEND ${front.label} · ENEMY ${Math.round(front.enemyProgress * 100)}%`;
    else hint = `PUSH ${front.label} · ${front.ownerLabel}`;
  }
  const leader = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
  return {
    team, nodes, live, liveCount: live.length,
    owned, ownedCount: owned[0] + owned[1],
    contested, contestedCount: contested.length,
    myNodes: team === null ? null : owned[team],
    enemyNodes: other === null ? null : owned[other],
    scores, myScore: team === null ? null : scores[team], enemyScore: other === null ? null : scores[other],
    leader, front, hint, winner: state?.winner ?? null,
  };
}

// ---------------------------------------------------------------------------
// F03 public outcome progress. `snapshot.cocs.dominance` (PvP) and
// `snapshot.cocs.outcome` (Operations waves/HQ) are authoritative; these views
// only format them. Every field tolerates absence: an older or redacted
// snapshot reads as a neutral "no live race" state and never throws, and the
// remaining hold time is the sim's own `target - progress`, never a client
// countdown.
// ---------------------------------------------------------------------------
const cocsWhole = value => Math.max(0, Math.floor(Number(value) || 0));

export function cocsDominanceStatus(hud, player) {
  const state = hud?.cocs?.dominance ?? hud?.cocs?.outcome?.dominance;
  const viewer = player?.team === 0 || player?.team === 1 ? Number(player.team) : null;
  const team = state?.team === 0 || state?.team === 1 ? Number(state.team) : null;
  const target = Math.max(0, Number(state?.target) || 0);
  const progress = Math.max(0, Number(state?.progress) || 0);
  const remaining = Math.max(0, target - progress);
  const counts = {0: cocsWhole(state?.counts?.[0]), 1: cocsWhole(state?.counts?.[1])};
  const count = cocsWhole(state?.count);
  const leader = counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1;
  const holding = team !== null;
  return {
    team, holding,
    mine: holding && viewer !== null && team === viewer,
    progress, target, remaining,
    fast: state?.fast === true,
    count, fastCount: Math.max(count, cocsWhole(state?.fastCount)),
    counts, leader,
    // Nodes the other side must take to break the outright majority and reset
    // the ratchet; and nodes the current leader still needs to arm it.
    breakCount: holding && count > 0 ? Math.max(0, counts[team] - count + 1) : 0,
    needed: count > 0 && leader !== null ? Math.max(0, count - counts[leader]) : 0,
    timeText: holding ? `${formatCountdown(remaining)}s` : null,
  };
}

export function cocsOperationsStatus(hud) {
  const cocs = hud?.cocs;
  const waves = cocs?.outcome?.waves ?? cocs?.waves;
  const hq = cocs?.outcome?.hq ?? cocs?.director?.siege;
  const cleared = cocsWhole(waves?.cleared);
  const total = cocsWhole(waves?.par ?? waves?.total);
  const max = Math.max(0, Number(hq?.max) || 0);
  const health = Math.max(0, Number(hq?.health) || 0);
  const percent = Number.isFinite(Number(hq?.percent)) && Number(hq.percent) >= 0
    ? Math.max(0, Math.min(1, Number(hq.percent)))
    : max > 0 ? health / max : 0;
  const known = max > 0 || total > 0;
  return {
    waves: {cleared, total},
    waveText: total > 0 ? `${formatNumber(cleared, 0)} / ${formatNumber(total, 0)}` : 'UNKNOWN',
    hq: {id: hq?.hqId ?? hq?.id ?? null, health: Math.round(health), max: Math.round(max), percent, armed: hq?.armed === true},
    known,
    hqText: known ? `HQ ${formatNumber(percent * 100, 0)}%` : 'HQ STATUS UNKNOWN',
    siege: hq?.armed === true,
  };
}

// Mode-specific primary status for the objective bar. Operations leads with
// waves and HQ integrity (siege above the OP economy score); PvP leads with the
// dominance race and what resets it. Reads only the public snapshot.
export function cocsOutcomeView(hud, player, mode) {
  const id = mode?.id ?? hud?.config?.mode;
  const board = cocsBoard(hud, player);
  const team = teamName(player?.team);
  if (id === 'cocs-coop' || hud?.cocs?.coop === true || hud?.cocs?.outcome?.mode === 'operations') {
    const ops = cocsOperationsStatus(hud);
    const complete = ops.waves.total > 0 && ops.waves.cleared >= ops.waves.total;
    const economy = `${formatNumber(board.myScore ?? 0, 0)} OP SCORE · ${formatNumber(board.myNodes ?? 0, 0)} NODES`;
    return {
      mode: 'operations',
      title: ops.siege ? 'DEFEND THE HQ' : complete ? 'OPERATION COMPLETE' : 'CLEAR THE WAVES',
      action: ops.siege
        ? 'Fall back and clear the Director force from the HQ perimeter. Retake a node to lift the siege.'
        : complete
          ? 'All waves are down. Hold the field until the operation records.'
          : 'Clear every Director wave and keep the HQ standing. OP is the economy score, not the win condition.',
      detail: `WAVES ${ops.waveText} · ${ops.hqText} · ${economy}`,
      status: ops.siege
        ? `HQ UNDER SIEGE · ${ops.hqText} · WAVES ${ops.waveText}`
        : `${ops.hqText} · WAVES ${ops.waveText} · ${formatNumber(board.myNodes ?? 0, 0)} NODES`,
      operations: ops,
    };
  }
  const dom = cocsDominanceStatus(hud, player);
  const detail = `${team} ${scoreText(board.myScore ?? 0)} OP · ${board.myNodes ?? 0} NODES · ${board.liveCount} LIVE`;
  if (dom.holding) {
    const reset = dom.breakCount === 1 ? '1 NODE' : `${formatNumber(dom.breakCount, 0)} NODES`;
    return {
      mode: 'pvp',
      title: dom.mine ? 'HOLD THE LATTICE' : 'BREAK THE DOMINANCE',
      action: dom.mine
        ? 'Keep the outright majority; the dominance timer resets the moment you drop below it.'
        : `Break ${teamName(dom.team)}'s outright majority: ${dom.breakCount === 1 ? 'take a node' : `take ${formatNumber(dom.breakCount, 0)} nodes`} and the dominance timer resets.`,
      detail,
      status: dom.mine
        ? `${teamName(dom.team)} DOMINANCE · ${dom.timeText} LEFT${dom.fast ? ' · FAST' : ''} · KEEP ${formatNumber(dom.counts[dom.team], 0)} NODES`
        : `${teamName(dom.team)} DOMINANCE ${formatNumber(dom.counts[dom.team], 0)} NODES · ${dom.timeText} LEFT${dom.fast ? ' · FAST' : ''} · TAKE ${reset} TO RESET`,
      dominance: dom,
    };
  }
  return {
    mode: 'pvp',
    title: board.contestedCount ? 'BREAK THE LATTICE' : board.myNodes > 0 ? 'HOLD THE LATTICE' : 'TAKE THE LATTICE',
    action: 'Capture a node next to one you already own. A node only pays while a supply line links it back to your HQ.',
    detail,
    status: board.contestedCount ? `${board.contestedCount} CONTESTED · ${board.hint}` : board.front ? `${board.front.label} FRONT · ${board.hint}` : 'HOLD THE LATTICE',
    dominance: dom,
  };
}

// One-line "why did this end" for the results screen. Reads only the frozen
// snapshot plus `overReason` (which `Match.snapshot` already carries).
export function cocsResultSummary(hud, player) {
  if (hud?.objectives?.kind !== 'cocs' && !hud?.cocs) return null;
  const board = cocsBoard(hud, player);
  const winner = hud?.cocs?.winner ?? hud?.winner ?? null;
  const reason = String(hud?.overReason ?? '');
  const iWon = winner !== null && board.team !== null && winner === board.team;
  const why = reason === 'array' ? 'the ARRAY anchor was captured'
    : reason === 'dominance' ? 'the lattice was held to the dominance timer'
      : reason === 'operation-complete' ? 'all five waves were cleared'
        : reason === 'operation-failed' ? 'the operation clock ran out'
          : reason === 'hq-destroyed' ? 'the HQ fell to the Director siege'
            : reason === 'hq-lost' ? 'HQ control was lost'
              : reason === 'time' ? 'the clock ran out on objective score'
                : 'the lattice was decided';
  const outcome = winner === null ? 'The lattice was a draw' : iWon ? 'Your team took the lattice' : 'The enemy took the lattice';
  const line = `${teamName(0)} ${scoreText(board.scores[0])} – ${scoreText(board.scores[1])} ${teamName(1)} · ${board.owned[0]}–${board.owned[1]} nodes`;
  return `${outcome}: ${why}. ${line}.`;
}

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
  if (isCocsMode(id)) {
    const outcome = cocsOutcomeView(hud, player, mode);
    return {title: outcome.title, action: outcome.action, detail: outcome.detail, status: outcome.status};
  }
  if (id === 'armsrace') {
    const ladder = ladderStatus(player, WEAPONS.length);
    const current = WEAPONS[Number(player?.weapon)]?.name;
    const next = WEAPONS[Number(player?.weapon) + 1]?.name;
    return {title: 'CLIMB THE LADDER', action: 'Score an elimination to advance one weapon up the rack. Reach the final rung to win.', detail: `${ladder.label} · ${current ?? 'STARTING WEAPON'}`, status: next ? `NEXT WEAPON · ${next}` : 'FINAL RUNG · LAST WEAPON'};
  }
  if ((kind === 'koth' || id === 'koth') && id !== 'holdout' && id !== 'uplink' && id !== 'vip-escort') { const zone = objective?.zones?.[0], owner = zone?.owner === null || zone?.owner === undefined ? 'NEUTRAL' : teamName(zone.owner), held = zone?.owner === player?.team; return {title: zone?.contested ? 'CONTEST THE HILL' : held ? 'HOLD THE HILL' : zone?.owner === null ? 'CAPTURE THE HILL' : 'BREAK THEIR CONTROL', action: zone?.contested ? 'Clear the enemy from the hill to restart scoring.' : held ? 'Stay inside the hill and protect the zone.' : 'Push the hill and deny their control.', detail: `${team} ${scoreText(teamScore(hud, player?.team))} / ${target} · HILL ${owner}`, status: `${Math.round(zone?.progress ?? 0)}% CAPTURED · ${zone?.contested ? 'CONTESTED' : owner + ' CONTROL'}`}; }
  if (id === 'holdout') { const st = hud?.objectives, hp = st?.holdProgress ?? {}, held = Number(hp[player?.team]) || 0, need = Number(st?.holdSeconds) || 30, owner = st?.holdTeam === null || st?.holdTeam === undefined ? 'NOBODY' : teamName(st.holdTeam); return {title: 'HOLD THE QUORUM', action: 'Own a majority of the zones together and keep them for the full window to take the round.', detail: `${team} · ${Math.round(held)}s / ${need}s HELD`, status: `HOLDING · ${owner}`}; }
 if (id === 'uplink') { const st = hud?.objectives, stage = Number(st?.stage) || 0, total = Math.max(1, Number(st?.stageCount) || 1), caps = st?.stageCaptures ?? {}; return {title: 'RUN THE RELAY', action: 'Capture each relay point in sequence before the enemy takes the last one back.', detail: `${team} · RELAY ${stage + 1} / ${total}`, status: `CAPTURED · ${Number(caps[player?.team]) || 0} / ${total}`}; }
 if (id === 'vip-escort') { const st = hud?.objectives, down = st?.vipDead === true; return {title: down ? 'VIP DOWN' : 'ESCORT THE VIP', action: down ? 'The VIP is down; the defenders take the round.' : 'Move the VIP to the extraction beacon and hold the pad against the other squad.', detail: `${team} · VIP ${down ? 'DOWN' : 'ACTIVE'}`, status: down ? 'ROUND LOST' : 'HOLD THE PAD'}; }
 if (kind === 'domination' || id === 'domination' || id === 'combined-arms') { const zones = objective?.zones ?? [], owned = zones.filter(z => z.owner === player?.team).length, contested = zones.filter(z => z.contested).length, enemy = zones.filter(z => z.owner !== null && z.owner !== undefined && z.owner !== player?.team).length; return {title: contested ? 'BREAK THE CONTEST' : owned ? 'LOCK THE ZONES' : 'TAKE A CONTROL POINT', action: contested ? 'Collapse the contested point before the enemy retakes it.' : owned ? 'Hold your captured zones and rotate to the next weak point.' : 'Enter a control zone to begin the capture.', detail: `${team} ${scoreText(teamScore(hud, player?.team))} / ${target} · ${owned}/${zones.length} ZONES · ${dominationZoneText(zones, player?.team)}`, status: `${owned} OWNED · ${enemy} ENEMY · ${contested} CONTESTED`}; }
  if (kind === 'assault' || id === 'assault') { const st = hud?.objectives, sectors = st?.zones ?? [], total = Math.max(1, sectors.length), index = Math.min(st?.active ?? 0, total - 1), active = sectors[index], attacking = player?.team === st?.attacker, secured = sectors.filter(s => s.owner === player?.team).length; return {title: st?.breached ? 'FORTRESS BREACHED' : attacking ? 'BREACH THE NEXT SECTOR' : 'HOLD THE LINE', action: st?.breached ? 'The final sector has fallen.' : attacking ? 'Push into the active sector and capture it before the defenders reset it.' : 'Hold the active sector and deny the attackers their next breach.', detail: `${team} ${attacking ? 'ATTACKER' : 'DEFENDER'} · SECTOR ${index + 1} / ${total} · ${Math.round(active?.progress ?? 0)}% SECURED`, status: `${secured} SECTOR${secured === 1 ? '' : 'S'} HELD · ${attacking ? 'PUSH FORWARD' : 'HOLD POSITION'}`}; }
  if (kind === 'payload' || id === 'payload') { const st = hud?.objectives, p = st?.payload, attacking = player?.team === (st?.attacker ?? 0), total = Math.max(1, p?.checkpointCount ?? st?.zones?.length ?? target), reached = p?.checkpointsReached ?? 0, pct = Math.round(p?.progress ?? 0); return {title: p?.delivered ? 'PAYLOAD DELIVERED' : attacking ? (p?.contested ? 'CLEAR THE CART' : 'ESCORT THE PAYLOAD') : (p?.contested ? 'HOLD THE CART' : 'STOP THE PAYLOAD'), action: attacking ? (p?.contested ? 'Both teams are on the cart. Clear the defenders to get it moving again.' : 'Stay with the cart and push it through the next checkpoint before the clock runs out.') : (p?.contested ? 'You are on the cart. Keep the attackers off it to hold the line.' : 'Get bodies on the cart to stall it, then roll it back to the last checkpoint.'), detail: `${team} ${attacking ? 'ATTACKER' : 'DEFENDER'} · PAYLOAD ${pct}% · CHECKPOINT ${Math.min(reached + 1, total)} / ${total}`, status: `${reached} / ${total} CHECKPOINTS · ${p?.contested ? 'CONTESTED' : p?.delivered ? 'DELIVERED' : p?.pushing === player?.team ? 'MOVING' : 'HALTED'}`}; }
  if (id === 'teamdeathmatch') return {title: 'HOLD THE LINE', action: 'Stay with your team and take the next fight.', detail: `${team} FIRETEAM · FIRST TO ${target} TEAM FRAGS`, status: `${teamScore(hud, player?.team)} / ${target} TEAM FRAGS`};
  if (id === 'instagib') return {title: 'ONE SHOT. NO SECOND CHANCE.', action: 'Keep the rail angle. Land the first hit.', detail: `RAIL ONLY · UNLIMITED AMMO · POWERS OFF · FIRST TO ${target} FRAGS`};
  if (id === 'rockets') return {title: 'CONTROL THE BLAST ZONE', action: 'Take height, then force the next rocket duel.', detail: `ROCKETS LOCKED · HEALTH + ARMOR ACTIVE · FIRST TO ${target} FRAGS`};
  if (id === 'arsenal') return {title: 'OWN THE LOADOUT', action: 'Choose the weapon for the next engagement.', detail: `FULL ARSENAL · UNLIMITED AMMO · FIRST TO ${target} FRAGS`};
  return {title: 'HUNT THE NEXT TOKEN', action: 'Find an angle and secure the next frag.', detail: `FIRST TO ${target} FRAGS`};
}
