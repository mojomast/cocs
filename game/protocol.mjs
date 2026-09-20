import {clamp} from './math.mjs';

// Wire-format revisions. The envelope is additive: a peer that only knows
// version 1 simply never emits or consumes the version-2 snapshot-delta frame,
// so bumping this constant cannot strand an older client. Version 3 adds the
// held `mobility` input field and the `loadout` respawn-switch message
// (docs/design/CLASS_OVERHAUL.md §5, §12.2 Phase 4).
//
// LATTICE STRIKE V2 per-team snapshot filtering (`game/cocs-intel.mjs`,
// `server/room.mjs`) deliberately does NOT bump this version: it removes fields
// from the existing `cocs` subtree for the non-recipient team, and every client
// reader already treats an absent `cocs` section as empty. A v3 peer keeps
// receiving valid v3 envelopes, so no compatibility statement changes.
//
// The v8.6 held `altFire` input is additive in the same way: it rides inside
// the existing `input` payload and a peer that does not know it simply never
// emits or reads it, so it deliberately does not bump PROTOCOL_VERSION either.
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
 // Additive v3 frames: the LATTICE STRIKE wire surface (§11.2). A v3 peer that
 // does not know them never receives them (the server only answers a client
 // that sends them), so the envelope stays backward compatible. `cocs-reject`
 // is the S→C reason for a refused C→S action.
 ORDER:'order', ECONOMY:'economy', TERMINAL:'terminal', COMMAND:'command', BUY:'buy',
 COCS_REJECT:'cocs-reject',
});

// ---------------------------------------------------------------------------
// LATTICE STRIKE action vocabulary + strict validators (§11.2).
//
// Every field is bounded: ids are short safe strings, enums are allow-lists,
// actor ids are non-negative integers. Anything else is `null`, which the room
// treats as a protocol rejection. These parsers never read the authoritative
// sim, so a quantized client value can never authorise a spend (§11.6.6).
// ---------------------------------------------------------------------------
export const COCS_ORDER_VERBS = Object.freeze(['HOLD', 'ATTACK', 'SCAN']);
// §11.2 lists the agent/card verbs; the intermission FLUX sinks (FORTIFY /
// REPAIR / RESUPPLY / REINFORCE) ride the same frame as additive aliases so one
// economy surface covers both. `spawn` is the wire alias for a REINFORCE squad.
export const COCS_ECONOMY_ACTIONS = Object.freeze(['spawn', 'recall', 'compact', 'retry', 'escalate', 'pull', 'opt-out-orders', 'fortify', 'repair', 'resupply', 'reinforce']);
export const COCS_TERMINAL_ACTIONS = Object.freeze(['hack', 'deploy', 'vault-store', 'vault-pull', 'repair', 'lock', 'cut', 'depot-capture']);
// The Board presents a SABOTAGE card; the wire vocabulary calls that same
// channel `cut`. The alias is accepted additively so the displayed control and
// the authoritative action are one vertical slice (WP0.3). It never changes the
// canonical list, so existing frames stay valid.
export const COCS_TERMINAL_ALIASES = Object.freeze({sabotage: 'cut'});
export const COCS_COMMAND_ACTIONS = Object.freeze(['take', 'release', 'mutiny-vote', 'set-route', 'policy']);
export const COCS_ACTION_ID_MAX = 64;
export const COCS_ACTION_STRING_MAX = 64;
export const COCS_AGENT_MAX = 24;
export const COCS_COUNTER_MAX = 0x7fffffff;
// Card-failure state and the reject feed share one bound (§11.2/§11.5): keep
// the newest entries and drop the oldest.
export const COCS_REJECT_LIMIT = 300;

const safeId = value => (typeof value === 'string' && value.length >= 1 && value.length <= COCS_ACTION_ID_MAX && /^[A-Za-z0-9_:.-]+$/.test(value) ? value : null);
const optionalId = value => value === null || value === undefined ? null : safeId(value);
const safeString = (value, max = COCS_ACTION_STRING_MAX) => (typeof value === 'string' && value.length >= 1 && value.length <= max ? value : null);
const enumValue = (value, list) => {
 const text = typeof value === 'string' ? value : '';
 for (const entry of list) {
  if (entry === text) return entry;
  if (entry.toUpperCase() === text.toUpperCase()) return entry;
 }
 return null;
};
const actorIndex = value => (Number.isInteger(value) && value >= 0 && value <= 65535 ? value : null);
const tickOf = value => (Number.isInteger(value) && value >= 0 && value <= 0x7fffffff ? value : null);
// Round/action identity for the transitional v3 adapter (WP0.3). Both fields
// are optional and additive: a frame that omits them still parses and the server
// scopes its `cardId` by round + authenticated seat. A frame that *carries* them
// must carry valid bounded safe integers, or it is malformed. They deliberately
// never bump PROTOCOL_VERSION: an old peer keeps speaking v3 without them.
const roundRevOf = value => (Number.isInteger(value) && value >= 0 && value <= COCS_COUNTER_MAX ? value : null);
const actionSeqOf = value => (Number.isInteger(value) && value >= 1 && value <= COCS_COUNTER_MAX ? value : null);
const identityOf = msg => {
 const hasRev = msg.roundRev !== undefined && msg.roundRev !== null;
 const hasSeq = msg.actionSeq !== undefined && msg.actionSeq !== null;
 const roundRev = hasRev ? roundRevOf(msg.roundRev) : null;
 const actionSeq = hasSeq ? actionSeqOf(msg.actionSeq) : null;
 if ((hasRev && roundRev === null) || (hasSeq && actionSeq === null)) return null;
 return {hasRev, hasSeq, roundRev, actionSeq};
};
const identityFields = identity => ({
 ...(identity.hasRev ? {roundRev: identity.roundRev} : {}),
 ...(identity.hasSeq ? {actionSeq: identity.actionSeq} : {}),
});

/** Parse a C→S `order` frame: `{cardId, verb, target, agent, roundRev?, actionSeq?}`. */
export function parseOrderMessage(msg) {
 if (!object(msg)) return null;
 const cardId = safeId(msg.cardId);
 const verb = enumValue(msg.verb, COCS_ORDER_VERBS);
 const target = safeId(msg.target);
 if (!cardId || !verb || !target) return null;
 if (msg.agent !== undefined && msg.agent !== null && !safeId(msg.agent)) return null;
 const identity = identityOf(msg);
 if (!identity) return null;
 return {cardId, verb, target, agent: optionalId(msg.agent), tick: tickOf(msg.tick), ...identityFields(identity)};
}

/** Parse a C→S `economy` frame: `{action, cardId, role, target, actorId?, roundRev?, actionSeq?}`. */
export function parseEconomyMessage(msg) {
 if (!object(msg)) return null;
 const cardId = safeId(msg.cardId);
 const action = enumValue(msg.action ?? msg.verb, COCS_ECONOMY_ACTIONS);
 if (!cardId || !action) return null;
 const actorId = msg.actorId === undefined || msg.actorId === null ? null : actorIndex(msg.actorId);
 if (msg.actorId !== undefined && msg.actorId !== null && actorId === null) return null;
 if ((msg.role !== undefined && msg.role !== null && !safeId(msg.role)) || (msg.target !== undefined && msg.target !== null && !safeId(msg.target))) return null;
 const identity = identityOf(msg);
 if (!identity) return null;
 return {
  cardId, action,
  role: optionalId(msg.role),
  target: optionalId(msg.target),
  actorId,
  tick: tickOf(msg.tick),
  ...identityFields(identity),
 };
}

/** Parse a C→S `terminal` frame: `{terminalId, action, roundRev?, actionSeq?}`. */
export function parseTerminalMessage(msg) {
 if (!object(msg)) return null;
 const terminalId = safeId(msg.terminalId);
 let action = enumValue(msg.action, COCS_TERMINAL_ACTIONS);
 if (!action && typeof msg.action === 'string') action = COCS_TERMINAL_ALIASES[msg.action.trim().toLowerCase()] ?? null;
 if (!terminalId || !action) return null;
 const actorId = msg.actorId === undefined || msg.actorId === null ? null : actorIndex(msg.actorId);
 if (msg.actorId !== undefined && msg.actorId !== null && actorId === null) return null;
 if (msg.cardId !== undefined && msg.cardId !== null && !safeId(msg.cardId)) return null;
 const identity = identityOf(msg);
 if (!identity) return null;
 return {terminalId, action: action.toLowerCase(), cardId: optionalId(msg.cardId), actorId, tick: tickOf(msg.tick), ...identityFields(identity)};
}

/** Parse a C→S `command` frame: `{action, value, roundRev?, actionSeq?}`. */
export function parseCommandMessage(msg) {
 if (!object(msg)) return null;
 const action = enumValue(msg.action, COCS_COMMAND_ACTIONS);
 if (!action) return null;
 if (msg.cardId !== undefined && msg.cardId !== null && !safeId(msg.cardId)) return null;
 const raw = msg.value;
 if (raw !== undefined && raw !== null && !Number.isInteger(raw) && typeof raw !== 'string') return null;
 const value = raw === undefined || raw === null ? null : (typeof raw === 'string' ? safeString(raw) : actorIndex(raw));
 if (raw !== undefined && raw !== null && value === null) return null;
 const identity = identityOf(msg);
 if (!identity) return null;
 return {action: action.toLowerCase(), value, cardId: optionalId(msg.cardId), tick: tickOf(msg.tick), ...identityFields(identity)};
}

/** Parse a C→S `buy` frame: `{itemId, depotId?, targetCardId?, roundRev?, actionSeq?}`. */
export function parseBuyMessage(msg) {
 if (!object(msg)) return null;
 const itemId = safeId(msg.itemId);
 if (!itemId) return null;
 for (const key of ['depotId', 'targetCardId', 'cardId']) {
  if (msg[key] !== undefined && msg[key] !== null && !safeId(msg[key])) return null;
 }
 const actorId = msg.actorId === undefined || msg.actorId === null ? null : actorIndex(msg.actorId);
 if (msg.actorId !== undefined && msg.actorId !== null && actorId === null) return null;
 const identity = identityOf(msg);
 if (!identity) return null;
 return {
  itemId,
  depotId: optionalId(msg.depotId),
  targetCardId: optionalId(msg.targetCardId),
  cardId: optionalId(msg.cardId),
  actorId,
  tick: tickOf(msg.tick),
  ...identityFields(identity),
 };
}

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
  altFire: source.altFire === true,
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
