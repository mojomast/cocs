import {clamp} from './math.mjs';

// Wire-format revisions. The envelope is additive: a peer that only knows
// version 1 simply never emits or consumes the version-2 snapshot-delta frame,
// so bumping this constant cannot strand an older client. Version 3 adds the
// held `mobility` input field and the `loadout` respawn-switch message
// (docs/design/CLASS_OVERHAUL.md §5, §12.2 Phase 4).
export const PROTOCOL_VERSION = 3;
// Snapshot-delta revisions. v2 diffs id-keyed arrays element-wise; a peer only
// receives deltas for a revision it advertised, so a v1 client keeps getting
// full snapshots instead of a patch it cannot apply.
export const SNAPSHOT_DELTA_VERSION = 2;
// Only send a delta when it beats a full frame by at least this many bytes; a
// frame that barely changed is not worth the apply complexity on the client.
export const SNAPSHOT_DELTA_MIN_BYTES = 48;

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
 // Additive v3 frame: a validated team-mode respawn loadout switch. FFA and
 // solo modes lock their pick, so the server refuses it there (Phase 4).
 LOADOUT:'loadout',
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
  grenade: source.grenade === true, mobility: source.mobility === true,
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
//
// Version 2 adds id-keyed array patches (`$A`): an array whose elements are
// plain objects with unique `id`s is diffed element-wise instead of being sent
// whole. That is what makes the frame small, because the actor/rocket arrays
// dominate every snapshot. Arrays without ids stay opaque leaves.
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

// An array is "id-keyed" when every element is a plain object carrying a unique
// `id`. Only then can a patch address elements by identity across reorders,
// inserts and removals. An empty list is vacuously id-keyed.
const isIdArray = list => {
 if (!Array.isArray(list)) return false;
 const seen = new Set();
 for (const item of list) {
  if (!isPlainObject(item) || !Object.hasOwn(item, 'id')) return false;
  const id = String(item.id);
  if (seen.has(id)) return false;
  seen.add(id);
 }
 return true;
};

// Diff two id-keyed arrays. `order` is emitted only when the id sequence
// changes; `set` holds nested patches for elements present in both; `add` holds
// the full value of inserted elements. Removals are implied by the new order.
function arrayDelta(before, after) {
 const prior = new Map();
 for (const item of before) prior.set(String(item.id), item);
 const patch = { $A: 1 };
 let orderChanged = before.length !== after.length;
 const order = new Array(after.length);
 const set = {};
 const add = {};
 for (let i = 0; i < after.length; i++) {
  const item = after[i];
  const id = String(item.id);
  order[i] = item.id;
  if (!orderChanged && String(before[i]?.id) !== id) orderChanged = true;
  const from = prior.get(id);
  if (!from) { add[id] = item; continue; }
  const nested = snapshotDelta(from, item);
  if (nested) set[id] = nested;
 }
 if (orderChanged) patch.order = order;
 if (Object.keys(set).length) patch.set = set;
 if (Object.keys(add).length) patch.add = add;
 return patch.order || patch.set || patch.add ? patch : null;
}

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
  if (Array.isArray(before) && Array.isArray(after)) {
   const pair = isIdArray(before) && isIdArray(after);
   const nested = pair ? arrayDelta(before, after) : null;
   if (nested) { patch[key] = nested; changed = true; }
   else if (!pair) { patch[key] = encode(after); changed = true; }
   continue;
  }
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

// Rebuild an id-keyed array from an `$A` patch. `order` carries the next frame's
// identity sequence; `set` patches elements that survived; `add` inserts new
// ones. Without `order` the identity set is unchanged, so the base order stands.
function applyArrayDelta(before, patch) {
 const prior = new Map();
 if (Array.isArray(before)) for (const item of before) if (isPlainObject(item) && Object.hasOwn(item, 'id')) prior.set(String(item.id), item);
 const set = isPlainObject(patch.set) ? patch.set : null;
 const add = isPlainObject(patch.add) ? patch.add : null;
 const rebuild = id => {
  const key = String(id);
  if (add && Object.hasOwn(add, key)) return add[key];
  const from = prior.get(key);
  if (set && Object.hasOwn(set, key)) return applySnapshotDelta(from, set[key]);
  return from;
 };
 if (Array.isArray(patch.order)) return patch.order.map(rebuild);
 if (!Array.isArray(before)) return [];
 return before.map(item => {
  const key = isPlainObject(item) && Object.hasOwn(item, 'id') ? String(item.id) : null;
  return key !== null && set && Object.hasOwn(set, key) ? applySnapshotDelta(item, set[key]) : item;
 });
}

// Apply a patch produced by `snapshotDelta` to `base`, returning a fresh tree.
// `$d` markers delete a key, `$a`/`$o` markers restore empty containers, and
// `$A` markers rebuild an id-keyed array.
export function applySnapshotDelta(base, patch) {
 if (!isPlainObject(patch)) return base;
 const out = { ...(isPlainObject(base) ? base : {}) };
 for (const key of Object.keys(patch)) {
  const value = patch[key];
  if (isPlainObject(value) && value.$d === 1) { delete out[key]; continue; }
  if (isPlainObject(value) && Object.hasOwn(value, '$a')) { out[key] = value.$a; continue; }
  if (isPlainObject(value) && Object.hasOwn(value, '$o')) { out[key] = value.$o; continue; }
  if (isPlainObject(value) && value.$A === 1) { out[key] = applyArrayDelta(out[key], value); continue; }
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
