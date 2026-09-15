import {TEAM_PALETTE,TEAM_PALETTE_COLORBLIND,NEUTRAL} from './team-presentation.mjs';

export {NEUTRAL};

const DEFAULT_RANGE = 55;

const radarColors = palette => ({
  red: palette[0].color,
  blue: palette[1].color,
  hostile: palette === TEAM_PALETTE ? '#ff6b6b' : '#ffb000',
  self: '#8dffb0',
  teammate: '#7fe7ff',
  neutral: NEUTRAL,
  contested: '#ffd166',
  payload: palette === TEAM_PALETTE ? '#ff9f43' : '#ffc04d',
  waypoint: '#ffe066',
  // Off-screen indicator ring and objective accent, kept distinct from the
  // contact fills so a clamped marker reads as "somewhere off the dial".
  offscreen: palette === TEAM_PALETTE ? '#ff8f6b' : '#ffce6b',
  objective: '#7fe7ff',
});

export const RADAR_COLORS = Object.freeze({
  default: Object.freeze(radarColors(TEAM_PALETTE)),
  colorblind: Object.freeze(radarColors(TEAM_PALETTE_COLORBLIND)),
});

export function radarPalette(mode) {
  return mode === 'colorblind' ? RADAR_COLORS.colorblind : RADAR_COLORS.default;
}

const teamKey = team => Number(team) === 1 ? 'blue' : 'red';

// Domination/KOTH zones read as short A/B/C tags on the radar instead of
// anonymous squares. Unknown ids fall back to their first alphanumeric.
const ZONE_LABELS = Object.freeze({alpha: 'A', bravo: 'B', charlie: 'C', hill: 'K', center: 'C'});
const zoneLabel = id => {
  const key = String(id ?? '').toLowerCase();
  if (ZONE_LABELS[key]) return ZONE_LABELS[key];
  const match = key.match(/[a-z0-9]/);
  return match ? match[0].toUpperCase() : '?';
};

// Projects the world onto a yaw-relative unit circle: +y is ahead, +x is the player's right.
export function radarContacts(hud, player, {range = DEFAULT_RANGE} = {}) {
  const contacts = [];
  const span = Number(range) > 0 ? Number(range) : DEFAULT_RANGE;
  const px = Number(player?.x), pz = Number(player?.z);
  if (!hud || !Number.isFinite(px) || !Number.isFinite(pz)) return {contacts, range: span};
  const yaw = Number(player.yaw) || 0, cos = Math.cos(yaw), sin = Math.sin(yaw);
  const reveal = (Number(player?.powerups?.recon) || 0) > 0;
  const place = (x, z, always = false) => {
    const dx = Number(x) - px, dz = Number(z) - pz;
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
    const right = dx * cos - dz * sin, forward = -dx * sin - dz * cos, dist = Math.hypot(right, forward);
    if (dist <= span) return {x: right / span, y: forward / span, dist};
    if (always && dist > 1e-6) {
      // Clamp to the rim and carry the bearing so the HUD can draw an
      // off-screen arrow pointing at the true direction.
      const nx = right / dist, ny = forward / dist;
      return {x: nx, y: ny, dist, clamped: true, offscreen: true, bearing: Math.atan2(nx, ny)};
    }
    return null;
  };
  for (const actor of Array.isArray(hud.actors) ? hud.actors : []) {
    const teammate = player?.team !== null && player?.team !== undefined && actor.team === player.team;
    const cloaked = (Number(actor?.powerups?.cloak) || 0) > 0;
    if (cloaked && actor.id !== player.id && !teammate && !reveal) {
      const rawDist = Math.hypot(Number(actor.x) - px, Number(actor.z) - pz);
      if (!(rawDist <= 8)) continue;
    }
    const point = place(actor?.x, actor?.z, reveal && actor.id !== player.id && !teammate);
    if (!point) continue;
    contacts.push({kind: 'actor', id: actor.id, x: point.x, y: point.y, team: actor.team, self: actor.id === player.id, dead: !(Number(actor.health) > 0), vehicle: actor.vehicleId != null, revealed: point.clamped === true, offscreen: point.offscreen === true, bearing: point.bearing ?? null});
  }
  for (const zone of Array.isArray(hud.objectives?.zones) ? hud.objectives.zones : []) {
    const point = place(zone?.x, zone?.z);
    if (!point) continue;
    contacts.push({kind: 'zone', id: zone.id, label: zoneLabel(zone.id), x: point.x, y: point.y, owner: zone.owner ?? null, contested: zone.contested === true, progress: Number.isFinite(zone.progress) ? zone.progress : null, captureTeam: zone.captureTeam ?? null});
  }
  // The current mission waypoint is always pinned to the rim so the player can
  // navigate toward it from anywhere, even before it comes into radar range.
  const waypoint = hud.singleplayer?.waypoint;
  if (waypoint && Number.isFinite(Number(waypoint.x)) && Number.isFinite(Number(waypoint.z))) {
    const point = place(waypoint.x, waypoint.z, true);
    if (point) contacts.push({kind: 'waypoint', id: waypoint.id ?? 'waypoint', label: waypoint.label ?? 'OBJ', x: point.x, y: point.y, distance: point.dist, clamped: point.clamped === true, offscreen: point.offscreen === true, bearing: point.bearing ?? null});
  }
  // Mission/objective markers beyond the single-player waypoint: any authored
  // marker with a world position is pinned to the rim like a waypoint so the
  // player can always orient toward it.
  for (const marker of Array.isArray(hud.markers) ? hud.markers : []) {
    if (!marker || !Number.isFinite(Number(marker.x)) || !Number.isFinite(Number(marker.z))) continue;
    const point = place(marker.x, marker.z, true);
    if (!point) continue;
    contacts.push({kind: 'marker', id: marker.id ?? `marker-${contacts.length}`, label: marker.label ?? 'OBJ', icon: marker.icon ?? null, team: marker.team ?? null, x: point.x, y: point.y, distance: point.dist, clamped: point.clamped === true, offscreen: point.offscreen === true, bearing: point.bearing ?? null});
  }
  // The payload cart is always findable: clamp it to the rim like a revealed
  // contact so players can navigate toward it from anywhere on the map.
  const objective = hud.objectives;
  const payload = objective?.kind === 'payload' ? (objective.payload ?? objective) : null;
  if (payload?.position) {
    const point = place(payload.position.x, payload.position.z, true);
    if (point) contacts.push({kind: 'payload', id: 'payload', label: 'PAY', icon: 'payload', x: point.x, y: point.y, contested: payload.contested === true, pushing: payload.pushing ?? null, progress: Number.isFinite(payload.progress) ? payload.progress : null, delivered: payload.delivered === true, clamped: point.clamped === true, offscreen: point.offscreen === true, bearing: point.bearing ?? null});
  }
  const flags = Array.isArray(hud.flags) ? hud.flags : [];
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index], point = place(flag?.x, flag?.z);
    if (!point) continue;
    contacts.push({kind: 'flag', index, team: flag.team, x: point.x, y: point.y, state: flag.state, carried: flag.carrier != null});
  }
  return {contacts, range: span};
}

/** @param {{red:string,blue:string,hostile:string,self:string,teammate:string,neutral:string,contested:string}} [palette] */
export function radarBlipColor(contact, player, palette = RADAR_COLORS.default) {
  const colors = palette ?? RADAR_COLORS.default;
  if (contact.kind === 'payload') return contact.contested ? colors.contested : colors.payload;
  if (contact.kind === 'waypoint') return colors.waypoint ?? colors.self;
  if (contact.kind === 'marker') return contact.team !== null && contact.team !== undefined ? colors[teamKey(contact.team)] : colors.objective ?? colors.self;
  if (contact.kind === 'zone') return contact.contested ? colors.contested : contact.owner === null || contact.owner === undefined ? colors.neutral : colors[teamKey(contact.owner)];
  if (contact.kind === 'flag') return colors[teamKey(contact.team)];
  if (contact.self) return colors.self;
  if (player?.team !== null && player?.team !== undefined && contact.team === player.team) return colors.teammate;
  if (player?.team !== null && player?.team !== undefined && contact.team !== null && contact.team !== undefined) return colors[teamKey(contact.team)];
  return colors.hostile;
}

// SVG-ready mapping for a single contact. The HUD only needs `shape`, the
// anchor, `fill` and the per-kind extras (zone label, flag triangle, payload
// icon/progress/delivered/clamped) instead of re-deriving them in JSX.
const radarAnchor = contact => {
  const x = Number(contact?.x), y = Number(contact?.y);
  const px = Number.isFinite(x) ? x : 0, py = Number.isFinite(y) ? y : 0;
  return {x: px, y: py, cx: px, cy: -py};
};

// Off-screen indicator geometry: an arrow on the rim pointing along the true
// bearing, plus the ring radius the HUD draws around it. Bearing is measured
// from +y (ahead) toward +x (right), matching the radar's unit circle.
const offscreenIndicator = contact => {
  if (contact?.offscreen !== true) return null;
  const bearing = Number.isFinite(contact.bearing) ? contact.bearing : Math.atan2(contact.x ?? 0, contact.y ?? 0);
  const r = .12, cx = Math.sin(bearing) * r, cy = -Math.cos(bearing) * r;
  const tip = .055, wing = .04;
  const ax = Math.sin(bearing), ay = -Math.cos(bearing);
  const px = -ay, py = ax;
  return {
    bearing,
    ring: {r: .105, thickness: .018},
    arrow: `${cx + ax * tip},${cy + ay * tip} ${cx - ax * tip + px * wing},${cy - ay * tip + py * wing} ${cx - ax * tip - px * wing},${cy - ay * tip - py * wing}`,
  };
};

/** @param {{red:string,blue:string,hostile:string,self:string,teammate:string,neutral:string,contested:string,payload:string}} [palette] */
export function radarBlip(contact, player, palette = RADAR_COLORS.default) {
  const colors = palette ?? RADAR_COLORS.default;
  const fill = radarBlipColor(contact, player, colors);
  const anchor = radarAnchor(contact);
  const offscreen = offscreenIndicator(contact);
  if (contact?.kind === 'actor') return {kind: 'actor', shape: 'circle', ...anchor, r: contact.self ? .07 : .05, fill, dead: contact.dead === true, revealed: contact.revealed === true, self: contact.self === true, offscreen: contact.offscreen === true, indicator: offscreen};
  if (contact?.kind === 'zone') return {kind: 'zone', shape: 'rect', ...anchor, rect: {x: anchor.cx - .06, y: anchor.cy - .06, width: .12, height: .12}, fill, label: contact.label ?? null, owner: contact.owner ?? null, contested: contact.contested === true, progress: Number.isFinite(contact.progress) ? contact.progress : null, captureTeam: contact.captureTeam ?? null};
  if (contact?.kind === 'payload') {
    const progress = Number.isFinite(contact.progress) ? contact.progress : null;
    return {kind: 'payload', shape: 'payload', ...anchor, fill, icon: contact.icon ?? 'payload', label: contact.label ?? 'PAY', progress, progressRatio: progress === null ? null : Math.max(0, Math.min(1, progress / 100)), delivered: contact.delivered === true, clamped: contact.clamped === true, contested: contact.contested === true, pushing: contact.pushing ?? null, offscreen: contact.offscreen === true, indicator: offscreen, ring: {r: .095, thickness: .022, progress}};
  }
  if (contact?.kind === 'waypoint') return {kind: 'waypoint', shape: 'polygon', ...anchor, fill, label: contact.label ?? 'OBJ', points: `${anchor.cx},${anchor.cy - .09} ${anchor.cx - .08},${anchor.cy} ${anchor.cx},${anchor.cy + .09} ${anchor.cx + .08},${anchor.cy}`, distance: contact.distance ?? null, clamped: contact.clamped === true, offscreen: contact.offscreen === true, indicator: offscreen};
  if (contact?.kind === 'marker') return {kind: 'marker', shape: 'diamond', ...anchor, fill, label: contact.label ?? 'OBJ', icon: contact.icon ?? null, team: contact.team ?? null, points: `${anchor.cx},${anchor.cy - .085} ${anchor.cx - .075},${anchor.cy} ${anchor.cx},${anchor.cy + .085} ${anchor.cx + .075},${anchor.cy}`, distance: contact.distance ?? null, clamped: contact.clamped === true, offscreen: contact.offscreen === true, indicator: offscreen};
  return {kind: 'flag', shape: 'triangle', ...anchor, fill, points: `${anchor.cx},${anchor.cy - .075} ${anchor.cx - .06},${anchor.cy + .05} ${anchor.cx + .06},${anchor.cy + .05}`, team: contact?.team ?? null, carried: contact?.carried === true, state: contact?.state ?? null, index: contact?.index ?? null};
}
export const radarContactVisual = radarBlip;
