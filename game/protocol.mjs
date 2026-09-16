import {clamp} from './math.mjs';

// Wire-format revisions. The envelope is additive: a peer that only knows
// version 1 simply never emits or consumes the version-2 snapshot-delta frame,
// so bumping this constant cannot strand an older client.
export const PROTOCOL_VERSION = 2;
export const SNAPSHOT_DELTA_VERSION = 1;

// Canonical wire message types. Client and server share this list so the two
// dispatch switches cannot drift apart.
export const MESSAGE = Object.freeze({
 JOIN:'join', CREATE:'create', LIST:'list', HISTORY:'history', HOST:'host', GEAR:'gear',
 START:'start', INPUT:'input', CHAT:'chat', LEAVE:'leave', PING:'ping', PONG:'pong',
 WELCOME:'welcome', LOBBY:'lobby', ROOMS:'rooms', SNAPSHOT:'snapshot', EVENTS:'events',
 RESULTS:'results', PROGRESSION:'progression', ERROR:'error',
 VOICE_STATE:'voice-state', VOICE_SIGNAL:'voice-signal', VOICE_CONFIG:'voice-config',
 // Lobby/matchmaking verbs the authoritative server dispatches (the web client
 // does not yet send them, but declaring them keeps the two switches in sync).
 READY:'ready', MAP_VOTE:'map-vote', REMATCH:'rematch', WARMUP:'warmup',
 QUEUE:'queue', QUEUE_LEAVE:'queue-leave', QUEUE_LIST:'queue-list',
 LEADERBOARD:'leaderboard', PROFILE:'profile', MATCHMADE:'matchmade',
 // Additive v2 frame: a snapshot expressed as a patch against a prior sequence.
 SNAPSHOT_DELTA:'snapshot-delta',
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

// ---------------------------------------------------------------------------
// Snapshot delta compression.
//
// A snapshot is a plain JSON tree that is mostly stable between frames: actor
// identity, config, map metadata and score stats rarely change while positions
// and timers do. `snapshotDelta` walks the tree and keeps only the leaves that
// differ from `base`, emitting a compact patch. `applySnapshotDelta` rebuilds
// the full tree from the same base. Both are pure and deterministic; they never
// mutate their arguments. The patch is self-describing so a client can fall
// back to a full snapshot whenever it lacks the base sequence.
// ---------------------------------------------------------------------------

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Structural equality for JSON leaf values. Objects/arrays are compared by
// reference only because the caller always feeds the delta the same immutable
// base tree it will later apply against; a shared reference means "unchanged"
// and anything else is walked. This keeps the walk O(changed nodes) instead of
// deep-comparing the whole snapshot every frame.
const sameLeaf = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));

// Encode a value that is present in the patch. Arrays are tagged so an empty
// array survives JSON round-tripping (an empty object would otherwise vanish).
const encode = value => Array.isArray(value) ? { $a: value } : isPlainObject(value) ? { $o: value } : value;

// Build a patch object describing `next` relative to `base`. Returns null when
// the two trees are structurally identical (nothing to send).
export function snapshotDelta(base, next) {
 if (!isPlainObject(base) || !isPlainObject(next)) return null;
 const patch = {};
 let changed = false;
 for (const key of Object.keys(next)) {
  const before = base[key];
  const after = next[key];
  if (sameLeaf(before, after)) continue;
  if (isPlainObject(before) && isPlainObject(after)) {
   const nested = snapshotDelta(before, after);
   if (nested) { patch[key] = nested; changed = true; }
  } else {
   patch[key] = encode(after);
   changed = true;
  }
 }
 for (const key of Object.keys(base)) {
  if (!Object.hasOwn(next, key)) {
   patch[key] = { $d: 1 };
   changed = true;
  }
 }
 return changed ? patch : null;
}

// Apply a patch produced by `snapshotDelta` to `base`, returning a fresh tree.
// `$d` markers delete a key, `$a`/`$o` markers restore empty containers.
export function applySnapshotDelta(base, patch) {
 if (!isPlainObject(patch)) return base;
 const out = { ...(isPlainObject(base) ? base : {}) };
 for (const key of Object.keys(patch)) {
  const value = patch[key];
  if (isPlainObject(value) && value.$d === 1) { delete out[key]; continue; }
  if (isPlainObject(value) && Object.hasOwn(value, '$a')) { out[key] = value.$a; continue; }
  if (isPlainObject(value) && Object.hasOwn(value, '$o')) { out[key] = value.$o; continue; }
  const before = out[key];
  if (isPlainObject(value) && isPlainObject(before)) out[key] = applySnapshotDelta(before, value);
  else out[key] = value;
 }
 return out;
}

// Byte size of a JSON payload as it would cross the wire, used by the
// bandwidth accounting on both ends.
export function wireSize(value) {
 try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch { return 0; }
}

// Rolling bandwidth meter. Feed it the size of every outbound/inbound frame and
// it reports the current rate over a sliding window without allocating.
export class BandwidthMeter {
 constructor({windowMs = 5000, capacity = 240} = {}) {
  this.windowMs = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 5000;
  this.capacity = Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : 240;
  this.samples = [];
  this.totalBytes = 0;
  this.totalFrames = 0;
 }
 record(bytes, at = 0) {
  const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const time = Number.isFinite(at) ? at : 0;
  this.totalBytes += size;
  this.totalFrames++;
  this.samples.push({ at: time, bytes: size });
  if (this.samples.length > this.capacity) this.samples.splice(0, this.samples.length - this.capacity);
  return size;
 }
 // Bytes/second over the window ending at `now`.
 rate(now = 0) {
  const cutoff = now - this.windowMs;
  let bytes = 0;
  for (let i = this.samples.length - 1; i >= 0; i--) {
   const sample = this.samples[i];
   if (sample.at < cutoff) break;
   bytes += sample.bytes;
  }
  return bytes * 1000 / this.windowMs;
 }
 // Average bytes per frame over the retained window.
 average(now = 0) {
  const cutoff = now - this.windowMs;
  let bytes = 0, frames = 0;
  for (let i = this.samples.length - 1; i >= 0; i--) {
   const sample = this.samples[i];
   if (sample.at < cutoff) break;
   bytes += sample.bytes; frames++;
  }
  return frames ? bytes / frames : 0;
 }
 reset() { this.samples.length = 0; this.totalBytes = 0; this.totalFrames = 0; }
}
