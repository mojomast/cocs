// WP3.2 — opt-in, device-local study recorder (pure and deterministic).
//
// This module is the whole storage layer: it never reads a clock, a storage
// API, the DOM, `Math.random` (the caller injects a random source) or the
// network. The page keeps the returned immutable state in memory, feeds a
// monotonic clock (`performance.now()`) in as `now`, and offers the player an
// explicit consent toggle plus download/delete. Nothing is collected while
// `enabled` is false, and nothing is ever persisted anywhere.
//
// Privacy contract, enforced here rather than by convention:
//   * no player UUID / progress token / peer id / name — the session id is a
//     fresh random token minted on consent and forgotten on disable;
//   * no IP, chat, voice, raw input, exact key values, free text, precise
//     world coordinates or wall-clock timestamps;
//   * the envelope carries only coarse buckets (journey stage, input class,
//     viewport bucket, accessibility booleans);
//   * payload keys must come from `STUDY_PAYLOAD_KEYS`; unknown keys are
//     ignored, key/value pairs that look like identifiers or free text are
//     dropped, and an oversized or explicitly forbidden payload is rejected
//     outright (`validateStudyEvent` returns why);
//   * events are bounded by a ring buffer (`STUDY_LOG_CAP`, newest wins).
//
// Event envelope (one object per accepted event):
//   {schemaVersion, buildCommit, ephemeralSessionId, sequence, monotonicMs,
//    eventName, journeyStage, inputClass, viewportBucket, accessibilityFlags,
//    payload}
//
// Expected payload use by event (all values optional and coarse):
//   surface_viewed          {surface}
//   onboarding_outcome      {outcome:'completed'|'skipped'}
//   match_intent_selected   {intent, count?}
//   match_started           {mode, source, variant?}
//   training_step_shown     {lesson, index, total?}
//   training_step_completed {lesson, index}
//   training_step_skipped   {lesson, index}
//   order_queued            {order, source}
//   order_accepted          {order, source}
//   order_rejected          {order, source}
//   order_completed         {order, source}
//   spend_opened            {window}
//   spend_attempted         {verb, source}
//   spend_resolved          {verb, outcome, source}
//   death                   {mode}
//   respawn                 {mode}
//   first_meaningful_action {mode}
//   match_ended             {mode, win?, source?}
//   results_viewed          {mode?}
//   result_action_selected  {action}
//   second_match_started    {mode}

export const STUDY_SCHEMA_VERSION = 1;
/** Bounded ring buffer: the newest `STUDY_LOG_CAP` events are kept. */
export const STUDY_LOG_CAP = 512;
/** A payload may carry at most this many keys and this many serialized bytes. */
export const STUDY_PAYLOAD_MAX_KEYS = 12;
export const STUDY_PAYLOAD_MAX_BYTES = 512;
/** Payload strings are coarse tokens; numbers are clamped to this magnitude. */
export const STUDY_STRING_MAX = 32;
export const STUDY_NUMBER_MAX = 100000;

/** The full event vocabulary. Unknown names are rejected, never recorded. */
export const STUDY_EVENTS = Object.freeze([
  'surface_viewed',
  'onboarding_outcome',
  'match_intent_selected',
  'match_started',
  'training_step_shown',
  'training_step_completed',
  'training_step_skipped',
  'order_queued',
  'order_accepted',
  'order_rejected',
  'order_completed',
  'spend_opened',
  'spend_attempted',
  'spend_resolved',
  'death',
  'respawn',
  'first_meaningful_action',
  'match_ended',
  'results_viewed',
  'result_action_selected',
  'second_match_started',
]);

export const STUDY_JOURNEY_STAGES = Object.freeze([
  'boot', 'selection', 'onboarding', 'browse', 'lobby', 'theater', 'playing',
  'paused', 'results', 'progression', 'changelog', 'unknown',
]);

export const STUDY_INPUT_CLASSES = Object.freeze([
  'keyboard-mouse', 'touch', 'gamepad', 'mixed', 'unknown',
]);

export const STUDY_VIEWPORT_BUCKETS = Object.freeze([
  'narrow', 'medium', 'wide', 'ultrawide', 'unknown',
]);

/** Coarse booleans only; never a preference value or a device fingerprint. */
export const STUDY_ACCESSIBILITY_FLAGS = Object.freeze([
  'reducedMotion', 'highContrast', 'colorBlindPalette', 'captions', 'uiScaled', 'touchLayout',
]);

/** Payload keys that may be stored. Everything else is ignored. */
export const STUDY_PAYLOAD_KEYS = Object.freeze([
  'action', 'bucket', 'count', 'durationS', 'flag', 'index', 'intent', 'item',
  'lesson', 'map', 'mode', 'order', 'outcome', 'phase', 'reason', 'result',
  'slot', 'source', 'stage', 'step', 'surface', 'targeted', 'total', 'variant',
  'verb', 'win', 'window',
]);

// An explicit second guardrail: these keys reject the whole payload instead of
// being silently dropped, so a caller that tries to record an identity, chat,
// voice or geometry learns immediately in the tests.
export const STUDY_FORBIDDEN_KEYS = Object.freeze([
  'name', 'player', 'playername', 'playerid', 'peer', 'peerid', 'id', 'uuid',
  'token', 'progresstoken', 'careerid', 'ip', 'address', 'host', 'chat',
  'message', 'text', 'transcript', 'voice', 'audio', 'raw', 'input', 'stream',
  'key', 'keys', 'keycode', 'code', 'position', 'pos', 'coords', 'coordinates',
  'x', 'y', 'z', 'yaw', 'pitch', 'exact',
]);

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LONG_HEX = /^[0-9a-f]{16,}$/i;

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asInteger = value => (Number.isInteger(value) && value > 0 ? value : null);

/** Label-style clamp shared with the build identity rules. */
function clampBuildCommit(value) {
  const cleaned = typeof value === 'string'
    ? value.replace(/[^A-Za-z0-9._:+-]+/g, '-').replace(/-+/g, '-').replace(/^[-]+|[-]+$/g, '').slice(0, 64).replace(/^[-]+|[-]+$/g, '')
    : '';
  return cleaned || 'unknown';
}

/** A fresh random, non-identifying session token. Forgets nothing else. */
export function freshSessionId(random = Math.random) {
  let roll = 0;
  try { roll = Number(random()); } catch { roll = 0; }
  const bounded = Number.isFinite(roll) ? Math.min(0.999999999, Math.max(0, roll)) : 0;
  return `s-${Math.floor(bounded * 36 ** 10).toString(36).padStart(10, '0')}`;
}

/** Coarse width bucket; unknown/non-finite widths never guess. */
export function viewportBucketFor(width) {
  const value = Number(width);
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  if (value < 600) return 'narrow';
  if (value < 1024) return 'medium';
  if (value < 1600) return 'wide';
  return 'ultrawide';
}

/** Coarse pointer/input class; a device can honestly be mixed. */
export function inputClassFor({touch = false, gamepad = false} = {}) {
  if (touch && gamepad) return 'mixed';
  if (touch) return 'touch';
  if (gamepad) return 'gamepad';
  return 'keyboard-mouse';
}

/** Reduce accessibility state to the declared coarse booleans. */
export function accessibilityFlagsFrom(source = {}) {
  const value = isPlainObject(source) ? source : {};
  return Object.freeze({
    reducedMotion: value.reducedMotion === true,
    highContrast: value.highContrast === true,
    colorBlindPalette: typeof value.palette === 'string' && value.palette !== '' && value.palette !== 'default',
    captions: value.captions === true,
    uiScaled: Number(value.uiScale) > 1,
    touchLayout: value.touch === true,
  });
}

/**
 * Clamp one payload value. Returns `undefined` for anything unsafe: non-token
 * or free-text strings, strings that look like UUIDs/IPs/long hex tokens, and
 * every non boolean/number/string value. Numbers are finite, bounded and
 * rounded to hundredths so a precise coordinate-like float cannot ride along.
 */
export function clampStudyValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const bounded = Math.max(-STUDY_NUMBER_MAX, Math.min(STUDY_NUMBER_MAX, value));
    return Math.round(bounded * 100) / 100;
  }
  if (typeof value === 'string') {
    if (!value || value.length > STUDY_STRING_MAX) return undefined;
    if (UUID.test(value) || IPV4.test(value) || LONG_HEX.test(value)) return undefined;
    if (!TOKEN.test(value)) return undefined;
    return value;
  }
  return undefined;
}

/**
 * The single validation/clamping entry point. Unknown event names, forbidden
 * keys, payloads over the key/byte budget and non-object payloads are rejected
 * (`ok:false` with a machine-readable reason). Unknown payload keys and unsafe
 * values are ignored. Accepted payloads are frozen with alphabetically sorted
 * keys so serialization is deterministic.
 */
export function validateStudyEvent(name, payload) {
  if (typeof name !== 'string' || !STUDY_EVENTS.includes(name)) {
    return {ok: false, reason: 'unknown-event', payload: null};
  }
  if (payload === undefined || payload === null) return {ok: true, reason: null, payload: null};
  if (!isPlainObject(payload)) return {ok: false, reason: 'payload-not-object', payload: null};
  const keys = Object.keys(payload);
  if (keys.length > STUDY_PAYLOAD_MAX_KEYS) return {ok: false, reason: 'payload-too-many-keys', payload: null};
  let raw;
  try { raw = JSON.stringify(payload); } catch { return {ok: false, reason: 'payload-unserializable', payload: null}; }
  if (typeof raw !== 'string' || raw.length > STUDY_PAYLOAD_MAX_BYTES) return {ok: false, reason: 'payload-too-large', payload: null};
  for (const key of keys) {
    if (STUDY_FORBIDDEN_KEYS.includes(key.toLowerCase())) {
      return {ok: false, reason: `payload-forbidden-key:${key.toLowerCase()}`, payload: null};
    }
  }
  const clean = {};
  for (const key of [...keys].sort()) {
    if (!STUDY_PAYLOAD_KEYS.includes(key)) continue;
    const value = clampStudyValue(payload[key]);
    if (value === undefined) continue;
    clean[key] = value;
  }
  return {ok: true, reason: null, payload: Object.keys(clean).length ? Object.freeze(clean) : null};
}

/**
 * A fresh, disabled log. Collection starts only after an explicit
 * `setStudyConsent(log, true)`; `cap` exists for tests and is otherwise the
 * declared `STUDY_LOG_CAP`.
 */
export function createStudyLog({enabled = false, buildCommit = 'unknown', cap = STUDY_LOG_CAP, random = Math.random, clockBase = null} = {}) {
  const bounded = asInteger(cap) ?? STUDY_LOG_CAP;
  const on = enabled === true;
  const base = Number.isFinite(clockBase) ? Number(clockBase) : null;
  return Object.freeze({
    schemaVersion: STUDY_SCHEMA_VERSION,
    enabled: on,
    ephemeralSessionId: on ? freshSessionId(random) : null,
    buildCommit: clampBuildCommit(buildCommit),
    cap: bounded,
    events: Object.freeze([]),
    sequence: 0,
    dropped: 0,
    lastMonotonicMs: 0,
    clockBase: base,
    lastClock: base,
  });
}

/** Replace the build label for events appended after this call. */
export function setStudyLogBuild(log, buildCommit) {
  if (!log) return log;
  const next = clampBuildCommit(buildCommit);
  return next === log.buildCommit ? log : Object.freeze({...log, buildCommit: next});
}

function emptiedLog(log, {enabled, buildCommit, ephemeralSessionId, clockBase}) {
  return Object.freeze({
    ...log,
    enabled,
    buildCommit,
    ephemeralSessionId,
    events: Object.freeze([]),
    sequence: 0,
    dropped: 0,
    lastMonotonicMs: 0,
    clockBase,
    lastClock: clockBase,
  });
}

/**
 * Consent gate. Enabling starts a brand-new ephemeral session (pre-consent
 * events never exist). Disabling stops collection and deletes everything the
 * log held, so withdrawing consent never leaves a study copy behind.
 * @param {any} log
 * @param {boolean} enabled
 * @param {{buildCommit?: string, random?: () => number, clockBase?: number|null}} [options]
 */
export function setStudyConsent(log, enabled, {buildCommit, random = Math.random, clockBase = null} = {}) {
  const on = enabled === true;
  const commit = buildCommit === undefined ? log?.buildCommit ?? 'unknown' : clampBuildCommit(buildCommit);
  const base = Number.isFinite(clockBase) ? Number(clockBase) : null;
  if (!log) return createStudyLog({enabled: on, buildCommit: commit, random, clockBase: base});
  if (on === log.enabled) {
    return commit === log.buildCommit ? log : Object.freeze({...log, buildCommit: commit});
  }
  return emptiedLog(log, {
    enabled: on,
    buildCommit: commit,
    ephemeralSessionId: on ? freshSessionId(random) : null,
    clockBase: on ? base : null,
  });
}

/** Empty the buffer but keep consent and the current session token. */
export function clearStudyLog(log) {
  if (!log) return log;
  return emptiedLog(log, {
    enabled: log.enabled,
    buildCommit: log.buildCommit,
    ephemeralSessionId: log.enabled ? log.ephemeralSessionId : null,
    clockBase: log.clockBase,
  });
}

/**
 * Delete the collected events and mint a fresh ephemeral session when consent
 * is still on, so nothing collected before the delete can be correlated with
 * anything collected after it.
 */
export function deleteStudyLog(log, {random = Math.random} = {}) {
  if (!log) return log;
  return emptiedLog(log, {
    enabled: log.enabled,
    buildCommit: log.buildCommit,
    ephemeralSessionId: log.enabled ? freshSessionId(random) : null,
    clockBase: null,
  });
}

/**
 * Append one event. Pure: returns the same log when consent is off or the
 * event is invalid, otherwise a new frozen log sharing the old event records.
 * `context.now` is a monotonic millisecond clock (never `Date.now()`);
 * `monotonicMs` is the non-decreasing offset from the first accepted append.
 */
export function appendStudyEvent(log, name, payload, context = {}) {
  if (!log || log.enabled !== true) return log;
  const validated = validateStudyEvent(name, payload);
  if (!validated.ok) return log;
  const rawClock = Number(context.now);
  const clock = Number.isFinite(rawClock) ? rawClock : (Number.isFinite(log.lastClock) ? log.lastClock : 0);
  const base = Number.isFinite(log.clockBase) ? log.clockBase : clock;
  const monotonicMs = Math.max(Number(log.lastMonotonicMs) || 0, Math.round(clock - base));
  const sequence = (Number(log.sequence) || 0) + 1;
  const event = Object.freeze({
    schemaVersion: STUDY_SCHEMA_VERSION,
    buildCommit: log.buildCommit,
    ephemeralSessionId: log.ephemeralSessionId,
    sequence,
    monotonicMs,
    eventName: name,
    journeyStage: clampStage(context.journeyStage),
    inputClass: clampInput(context.inputClass),
    viewportBucket: clampViewport(context.viewportBucket),
    accessibilityFlags: accessibilityFlagsFrom(context.accessibilityFlags),
    payload: validated.payload,
  });
  const overflow = log.events.length >= log.cap;
  const events = Object.freeze(overflow
    ? [...log.events.slice(log.events.length - log.cap + 1), event]
    : [...log.events, event]);
  return Object.freeze({
    ...log,
    events,
    sequence,
    dropped: (Number(log.dropped) || 0) + (overflow ? 1 : 0),
    lastMonotonicMs: monotonicMs,
    clockBase: base,
    lastClock: clock,
  });
}

export function clampStage(value) {
  return STUDY_JOURNEY_STAGES.includes(value) ? value : 'unknown';
}
export function clampInput(value) {
  return STUDY_INPUT_CLASSES.includes(value) ? value : 'unknown';
}
export function clampViewport(value) {
  return STUDY_VIEWPORT_BUCKETS.includes(value) ? value : 'unknown';
}

/** A small, non-sensitive view for the settings panel. */
export function studyLogSummary(log) {
  return Object.freeze({
    schemaVersion: STUDY_SCHEMA_VERSION,
    enabled: log?.enabled === true,
    eventCount: Array.isArray(log?.events) ? log.events.length : 0,
    cap: Number(log?.cap) || STUDY_LOG_CAP,
    dropped: Number(log?.dropped) || 0,
    sequence: Number(log?.sequence) || 0,
    sessionId: log?.enabled === true ? log.ephemeralSessionId : null,
    buildCommit: log?.buildCommit ?? 'unknown',
  });
}

/**
 * Deterministic, inspectable JSON. Key order is fixed and payloads were
 * sorted at validation time, so the same log always serializes byte-for-byte
 * the same way. No wall clock, no identity, no free text.
 */
export function serializeStudyLog(log) {
  const events = Array.isArray(log?.events) ? log.events : [];
  return JSON.stringify({
    schemaVersion: STUDY_SCHEMA_VERSION,
    device: 'local-only',
    consent: log?.enabled === true,
    cap: Number(log?.cap) || STUDY_LOG_CAP,
    buildCommit: log?.buildCommit ?? 'unknown',
    sessionId: log?.enabled === true ? log.ephemeralSessionId ?? null : null,
    droppedCount: Number(log?.dropped) || 0,
    eventCount: events.length,
    events,
  }, null, 2);
}
