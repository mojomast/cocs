import {clamp} from './math.mjs';

// Canonical wire message types. Client and server share this list so the two
// dispatch switches cannot drift apart.
export const MESSAGE = Object.freeze({
 JOIN:'join', CREATE:'create', LIST:'list', HISTORY:'history', HOST:'host', GEAR:'gear',
 START:'start', INPUT:'input', CHAT:'chat', LEAVE:'leave', PING:'ping', PONG:'pong',
 WELCOME:'welcome', LOBBY:'lobby', ROOMS:'rooms', SNAPSHOT:'snapshot', EVENTS:'events',
 RESULTS:'results', PROGRESSION:'progression', ERROR:'error',
 VOICE_STATE:'voice-state', VOICE_SIGNAL:'voice-signal', VOICE_CONFIG:'voice-config',
});

export const validPlayerId = id => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
export const validProgressToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(token);

export const sanitizeText = (value, max) =>
 String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const axis = value => { const n = Number(value); return Number.isFinite(n) ? clamp(n, -1, 1) : 0; };

// Accepts either the wire envelope {input, seq} or the flattened ext payload the
// room uses internally, and returns validated, clamped input fields.
export function parseInputEnvelope(msg) {
 const envelope = object(msg) ? msg : {};
 const source = object(envelope.input) ? envelope.input : envelope;
 const seq = Number.isInteger(envelope.seq) && envelope.seq > 0 ? envelope.seq : source.seq;
 return {
  seq: Number.isInteger(seq) && seq > 0 ? seq : null,
  x: axis(source.x), z: axis(source.z),
  yaw: Number.isFinite(source.yaw) ? source.yaw : undefined,
  pitch: Number.isFinite(source.pitch) ? clamp(source.pitch, -1.45, 1.45) : undefined,
  weapon: Number.isInteger(source.weapon) ? source.weapon : undefined,
  fire: source.fire === true, jump: source.jump === true, power: source.power === true,
  interact: source.interact === true, sprint: source.sprint === true, crouch: source.crouch === true,
  ads: source.ads === true, reload: source.reload === true, melee: source.melee === true,
  grenade: source.grenade === true,
 };
}
