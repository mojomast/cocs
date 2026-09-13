const DEFAULT_RANGE = 55;

export const RADAR_COLORS = Object.freeze({
  default: Object.freeze({red: '#ed514b', blue: '#438eff', hostile: '#ff6b6b', self: '#8dffb0', teammate: '#7fe7ff', neutral: '#55ddcc', contested: '#ffd166', payload: '#ff9f43'}),
  colorblind: Object.freeze({red: '#ff9d2e', blue: '#2f9bff', hostile: '#ffb000', self: '#8dffb0', teammate: '#7fe7ff', neutral: '#55ddcc', contested: '#ffd166', payload: '#ffc04d'}),
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
    if (always && dist > 1e-6) return {x: right / dist, y: forward / dist, dist, clamped: true};
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
    contacts.push({kind: 'actor', id: actor.id, x: point.x, y: point.y, team: actor.team, self: actor.id === player.id, dead: !(Number(actor.health) > 0), vehicle: actor.vehicleId != null, revealed: point.clamped === true});
  }
  for (const zone of Array.isArray(hud.objectives?.zones) ? hud.objectives.zones : []) {
    const point = place(zone?.x, zone?.z);
    if (!point) continue;
    contacts.push({kind: 'zone', id: zone.id, label: zoneLabel(zone.id), x: point.x, y: point.y, owner: zone.owner ?? null, contested: zone.contested === true});
  }
  // The payload cart is always findable: clamp it to the rim like a revealed
  // contact so players can navigate toward it from anywhere on the map.
  const objective = hud.objectives;
  const payload = objective?.kind === 'payload' ? (objective.payload ?? objective) : null;
  if (payload?.position) {
    const point = place(payload.position.x, payload.position.z, true);
    if (point) contacts.push({kind: 'payload', id: 'payload', label: 'PAY', icon: 'payload', x: point.x, y: point.y, contested: payload.contested === true, pushing: payload.pushing ?? null, progress: Number.isFinite(payload.progress) ? payload.progress : null, delivered: payload.delivered === true, clamped: point.clamped === true});
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
  if (contact.kind === 'zone') return contact.contested ? colors.contested : contact.owner === null || contact.owner === undefined ? colors.neutral : colors[teamKey(contact.owner)];
  if (contact.kind === 'flag') return colors[teamKey(contact.team)];
  if (contact.self) return colors.self;
  if (player?.team !== null && player?.team !== undefined && contact.team === player.team) return colors.teammate;
  if (player?.team !== null && player?.team !== undefined && contact.team !== null && contact.team !== undefined) return colors[teamKey(contact.team)];
  return colors.hostile;
}
