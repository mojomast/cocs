// WP3.2 — opt-in local study recorder tests.
//
// Everything here is pure: fixed clocks (`now` is a monotonic millisecond
// value, never `Date.now()`), a deterministic random source, no storage and no
// network. The privacy claims in `game/study-log.mjs` are asserted here rather
// than trusted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDY_EVENTS,
  STUDY_FORBIDDEN_KEYS,
  STUDY_LOG_CAP,
  STUDY_PAYLOAD_KEYS,
  STUDY_SCHEMA_VERSION,
  accessibilityFlagsFrom,
  appendStudyEvent,
  clearStudyLog,
  createStudyLog,
  deleteStudyLog,
  freshSessionId,
  inputClassFor,
  serializeStudyLog,
  setStudyConsent,
  setStudyLogBuild,
  studyLogSummary,
  validateStudyEvent,
  viewportBucketFor,
} from './study-log.mjs';

const RANDOM = () => 0.5;
const CONTEXT = Object.freeze({
  now: 1000,
  journeyStage: 'playing',
  inputClass: 'keyboard-mouse',
  viewportBucket: 'wide',
  accessibilityFlags: {reducedMotion: true},
});
const consentOn = (options = {}) => setStudyConsent(
  createStudyLog({buildCommit: 'abc123', random: RANDOM}),
  true,
  {random: RANDOM, clockBase: 1000, ...options},
);

test('consent is off by default and nothing is collected before it', () => {
  const fresh = createStudyLog({buildCommit: 'abc123'});
  assert.equal(fresh.enabled, false);
  assert.equal(fresh.ephemeralSessionId, null);
  assert.equal(fresh.events.length, 0);

  const gated = appendStudyEvent(fresh, 'match_started', {mode: 'cocs'}, CONTEXT);
  assert.equal(gated, fresh, 'a disabled log is returned unchanged');
  assert.equal(gated.events.length, 0);

  const on = setStudyConsent(fresh, true, {random: RANDOM, clockBase: 1000});
  assert.equal(on.enabled, true);
  assert.match(on.ephemeralSessionId, /^s-[0-9a-z]{10}$/);
  assert.equal(on.events.length, 0, 'enabling starts a fresh empty session');

  const off = setStudyConsent(appendStudyEvent(on, 'match_started', {mode: 'cocs'}, CONTEXT), false, {random: RANDOM});
  assert.equal(off.enabled, false);
  assert.equal(off.ephemeralSessionId, null);
  assert.equal(off.events.length, 0, 'withdrawing consent deletes the collected events');
});

test('the envelope carries version, build, ephemeral id, sequence and coarse buckets', () => {
  const log = consentOn();
  const first = appendStudyEvent(log, 'match_started', {mode: 'cocs'}, CONTEXT);
  assert.equal(first.events.length, 1);
  const event = first.events[0];
  assert.deepEqual(Object.keys(event), [
    'schemaVersion', 'buildCommit', 'ephemeralSessionId', 'sequence', 'monotonicMs',
    'eventName', 'journeyStage', 'inputClass', 'viewportBucket', 'accessibilityFlags', 'payload',
  ]);
  assert.equal(event.schemaVersion, STUDY_SCHEMA_VERSION);
  assert.equal(event.buildCommit, 'abc123');
  assert.equal(event.ephemeralSessionId, log.ephemeralSessionId);
  assert.equal(event.sequence, 1);
  assert.equal(event.monotonicMs, 0, 'the first accepted append defines offset zero');
  assert.equal(event.eventName, 'match_started');
  assert.equal(event.journeyStage, 'playing');
  assert.equal(event.inputClass, 'keyboard-mouse');
  assert.equal(event.viewportBucket, 'wide');
  assert.deepEqual(event.accessibilityFlags, {
    reducedMotion: true, highContrast: false, colorBlindPalette: false,
    captions: false, uiScaled: false, touchLayout: false,
  });
  assert.deepEqual(event.payload, {mode: 'cocs'});
  assert.ok(Object.isFrozen(event) && Object.isFrozen(event.payload), 'accepted events are frozen');
  assert.equal(log.events.length, 0, 'append never mutates the previous log');

  const second = appendStudyEvent(first, 'order_queued', {order: 'SCAN', source: 'strip'}, {...CONTEXT, now: 1125});
  assert.equal(second.sequence, 2);
  assert.equal(second.events[1].monotonicMs, 125);
  assert.equal(second.events.length, 2);
});

test('unknown envelope values clamp to the declared unknown bucket', () => {
  const log = consentOn();
  const next = appendStudyEvent(log, 'surface_viewed', null, {
    now: 1000,
    journeyStage: 'hq-basement',
    inputClass: 'keyboard',
    viewportBucket: '1920x1080',
    accessibilityFlags: {reducedMotion: 'yes', highContrast: 1, palette: 'protanopia', captions: true, uiScale: '1.4', touch: true, extra: true},
  });
  const event = next.events[0];
  assert.equal(event.journeyStage, 'unknown');
  assert.equal(event.inputClass, 'unknown');
  assert.equal(event.viewportBucket, 'unknown');
  assert.deepEqual(event.accessibilityFlags, {
    reducedMotion: false, highContrast: false, colorBlindPalette: true,
    captions: true, uiScaled: true, touchLayout: true,
  });
  assert.equal(event.payload, null);
  assert.deepEqual(Object.keys(event.accessibilityFlags), [
    'reducedMotion', 'highContrast', 'colorBlindPalette', 'captions', 'uiScaled', 'touchLayout',
  ]);
});

test('validation ignores unknown payload keys and unsafe values', () => {
  assert.deepEqual(validateStudyEvent('order_queued', {verb: 'FORTIFY', colour: 'red'}),
    {ok: true, reason: null, payload: {verb: 'FORTIFY'}});
  // Free text is dropped: spaces/length/characters outside the token alphabet.
  assert.deepEqual(validateStudyEvent('order_queued', {verb: 'FORTIFY please', reason: 'no flux left'}).payload, null);
  assert.deepEqual(validateStudyEvent('order_queued', {verb: 'x'.repeat(33)}).payload, null);
  // Identifier-shaped values are dropped even under an allowed key.
  assert.equal(validateStudyEvent('order_queued', {item: '123e4567-e89b-12d3-a456-426614174000'}).payload, null);
  assert.equal(validateStudyEvent('order_queued', {item: '10.0.0.7'}).payload, null);
  assert.equal(validateStudyEvent('order_queued', {item: 'deadbeefdeadbeefdeadbeef'}).payload, null);
  // Numbers are bounded and rounded; booleans pass; non-scalars drop.
  assert.deepEqual(validateStudyEvent('spend_opened', {window: 123456789.9876, count: -0.111, flag: true}),
    {ok: true, reason: null, payload: {count: -0.11, flag: true, window: 100000}});
  assert.deepEqual(validateStudyEvent('spend_opened', {count: NaN, window: [1, 2]}),
    {ok: true, reason: null, payload: null});
  // Payload shape and event name are still rejected as a whole.
  assert.deepEqual(validateStudyEvent('order_queued', [1, 2]), {ok: false, reason: 'payload-not-object', payload: null});
  assert.deepEqual(validateStudyEvent('order_queued', 'free text'), {ok: false, reason: 'payload-not-object', payload: null});
  assert.deepEqual(validateStudyEvent('made_up_event', {mode: 'cocs'}), {ok: false, reason: 'unknown-event', payload: null});
});

test('forbidden identity, chat, voice, key and geometry keys reject the payload', () => {
  const log = consentOn();
  const banned = ['name', 'playerId', 'progressToken', 'uuid', 'ip', 'chat', 'voice', 'text', 'keys', 'keyCode', 'x', 'y', 'position', 'coordinates'];
  for (const key of banned) {
    const result = validateStudyEvent('match_started', {mode: 'cocs', [key]: 'secret-value'});
    assert.equal(result.ok, false, `${key} must reject the payload`);
    assert.equal(result.reason, `payload-forbidden-key:${key.toLowerCase()}`);
    const next = appendStudyEvent(log, 'match_started', {mode: 'cocs', [key]: 'secret-value'}, CONTEXT);
    assert.equal(next, log, `${key} must not append an event`);
  }
  assert.equal(log.events.length, 0);
});

test('unknown keys cannot smuggle a token into the export', () => {
  // A caller that puts an identity in an unknown (ignored) key still cannot
  // reach the log; a forbidden key is rejected outright.
  const log = appendStudyEvent(consentOn(), 'match_started', {mode: 'cocs', note: 'player-token-abcdef0123456789'}, CONTEXT);
  assert.deepEqual(log.events[0].payload, {mode: 'cocs'});
  const text = serializeStudyLog(log);
  assert.ok(!text.includes('abcdef0123456789'), 'no smuggled token reaches the serialized log');
  assert.ok(!text.includes('progressToken') && !text.includes('"name"'));
});

test('oversized payloads are rejected, near-limit payloads are accepted', () => {
  const tooManyKeys = {};
  for (const key of STUDY_PAYLOAD_KEYS.slice(0, 13)) tooManyKeys[key] = true;
  assert.equal(validateStudyEvent('surface_viewed', tooManyKeys).reason, 'payload-too-many-keys');

  const tooLarge = {};
  for (const key of STUDY_PAYLOAD_KEYS.slice(0, 12)) tooLarge[key] = 'a'.repeat(32);
  const size = JSON.stringify(tooLarge).length;
  assert.ok(size > 512, `fixture is ${size} bytes`);
  assert.equal(validateStudyEvent('surface_viewed', tooLarge).reason, 'payload-too-large');

  const circular = {action: 'ok'};
  circular.count = circular;
  assert.equal(validateStudyEvent('surface_viewed', circular).reason, 'payload-unserializable');

  const log = consentOn();
  assert.equal(appendStudyEvent(log, 'surface_viewed', tooLarge, CONTEXT), log);
  assert.equal(appendStudyEvent(log, 'surface_viewed', {action: 'a'.repeat(32)}, CONTEXT).events.length, 1);
});

test('the ring buffer keeps the newest events and counts the drops', () => {
  let log = createStudyLog({enabled: true, buildCommit: 'abc123', cap: 3, random: RANDOM, clockBase: 0});
  for (let i = 0; i < 5; i++) log = appendStudyEvent(log, 'surface_viewed', {surface: `s${i}`}, {...CONTEXT, now: 1000 + i});
  assert.equal(log.cap, 3);
  assert.equal(log.events.length, 3);
  assert.deepEqual(log.events.map(event => event.sequence), [3, 4, 5]);
  assert.deepEqual(log.events.map(event => event.payload.surface), ['s2', 's3', 's4']);
  assert.equal(log.dropped, 2);
  assert.equal(log.sequence, 5);
  assert.equal(STUDY_LOG_CAP, 512, 'the declared default cap is part of the contract');
  assert.equal(createStudyLog().cap, STUDY_LOG_CAP);
});

test('monotonic offsets never decrease even when the clock goes backwards', () => {
  let log = consentOn({clockBase: 2000});
  const times = [2000, 2500, 2200, 2500, 3001];
  for (const now of times) log = appendStudyEvent(log, 'surface_viewed', {surface: 'selection'}, {...CONTEXT, now});
  const offsets = log.events.map(event => event.monotonicMs);
  assert.deepEqual(offsets, [0, 500, 500, 500, 1001]);
  for (let i = 1; i < offsets.length; i++) assert.ok(offsets[i] >= offsets[i - 1], `offset ${i} is monotonic`);
  assert.deepEqual(log.events.map(event => event.sequence), [1, 2, 3, 4, 5]);
  // A missing clock keeps the previous offset instead of reading a wall clock.
  const clamped = appendStudyEvent(log, 'surface_viewed', null, {journeyStage: 'playing'});
  assert.equal(clamped.events.at(-1).monotonicMs, 1001);
  assert.ok(!JSON.stringify(log).match(/20\d\d-\d\d-\d\dT/), 'no wall-clock timestamps anywhere');
});

test('serialization is deterministic and ordered', () => {
  const left = appendStudyEvent(
    appendStudyEvent(consentOn(), 'match_started', {mode: 'cocs', source: 'local'}, CONTEXT),
    'order_queued', {source: 'strip', order: 'SCAN'}, {...CONTEXT, now: 1200},
  );
  const right = appendStudyEvent(
    appendStudyEvent(consentOn(), 'match_started', {source: 'local', mode: 'cocs'}, CONTEXT),
    'order_queued', {order: 'SCAN', source: 'strip'}, {...CONTEXT, now: 1200},
  );
  assert.equal(serializeStudyLog(left), serializeStudyLog(right), 'payload key order cannot change the bytes');
  assert.equal(serializeStudyLog(left), serializeStudyLog(left), 'the same log serializes the same way twice');

  const parsed = JSON.parse(serializeStudyLog(left));
  assert.equal(parsed.schemaVersion, STUDY_SCHEMA_VERSION);
  assert.equal(parsed.device, 'local-only');
  assert.equal(parsed.consent, true);
  assert.equal(parsed.cap, STUDY_LOG_CAP);
  assert.equal(parsed.buildCommit, 'abc123');
  assert.equal(parsed.sessionId, left.ephemeralSessionId);
  assert.equal(parsed.eventCount, 2);
  assert.deepEqual(parsed.events.map(event => event.eventName), ['match_started', 'order_queued']);
  assert.deepEqual(Object.keys(parsed.events[0].payload), ['mode', 'source'], 'payload keys are sorted');
  assert.equal(serializeStudyLog(createStudyLog()), JSON.stringify({
    schemaVersion: STUDY_SCHEMA_VERSION,
    device: 'local-only',
    consent: false,
    cap: STUDY_LOG_CAP,
    buildCommit: 'unknown',
    sessionId: null,
    droppedCount: 0,
    eventCount: 0,
    events: [],
  }, null, 2), 'a consent-off log exports an empty, honest document');
});

test('delete and clear semantics at the pure-module level', () => {
  const filled = appendStudyEvent(
    appendStudyEvent(consentOn(), 'match_started', {mode: 'cocs'}, CONTEXT),
    'match_ended', {mode: 'cocs', win: true}, {...CONTEXT, now: 5000},
  );
  const cleared = clearStudyLog(filled);
  assert.equal(cleared.events.length, 0);
  assert.equal(cleared.sequence, 0);
  assert.equal(cleared.ephemeralSessionId, filled.ephemeralSessionId, 'clear keeps the session');
  assert.equal(cleared.enabled, true);
  assert.equal(cleared.dropped, 0);

  const deleted = deleteStudyLog(filled, {random: () => 0.25});
  assert.equal(deleted.events.length, 0);
  assert.equal(deleted.enabled, true);
  assert.notEqual(deleted.ephemeralSessionId, filled.ephemeralSessionId, 'delete breaks linkability');
  assert.match(deleted.ephemeralSessionId, /^s-[0-9a-z]{10}$/);
  assert.equal(JSON.parse(serializeStudyLog(deleted)).eventCount, 0);

  const deletedWhileOff = deleteStudyLog(createStudyLog());
  assert.equal(deletedWhileOff.enabled, false);
  assert.equal(deletedWhileOff.ephemeralSessionId, null);

  const relabelled = setStudyLogBuild(filled, 'deadbeef');
  assert.equal(relabelled.buildCommit, 'deadbeef');
  assert.equal(filled.buildCommit, 'abc123', 'the previous log is untouched');
  assert.equal(setStudyLogBuild(filled, '').buildCommit, 'unknown');
  assert.equal(setStudyLogBuild(filled, 'abc123'), filled, 'no change, no new object');
});

test('summary reports only non-sensitive bookkeeping', () => {
  const log = appendStudyEvent(consentOn(), 'match_started', {mode: 'cocs'}, CONTEXT);
  const summary = studyLogSummary(log);
  assert.deepEqual(Object.keys(summary), [
    'schemaVersion', 'enabled', 'eventCount', 'cap', 'dropped', 'sequence', 'sessionId', 'buildCommit',
  ]);
  assert.equal(summary.enabled, true);
  assert.equal(summary.eventCount, 1);
  assert.equal(summary.sessionId, log.ephemeralSessionId);
  assert.equal(studyLogSummary(createStudyLog()).sessionId, null);
});

test('viewport, input and accessibility helpers are coarse and total', () => {
  assert.equal(viewportBucketFor(390), 'narrow');
  assert.equal(viewportBucketFor(599), 'narrow');
  assert.equal(viewportBucketFor(844), 'medium');
  assert.equal(viewportBucketFor(1366), 'wide');
  assert.equal(viewportBucketFor(1920), 'ultrawide');
  assert.equal(viewportBucketFor(0), 'unknown');
  assert.equal(viewportBucketFor(NaN), 'unknown');
  assert.equal(viewportBucketFor(undefined), 'unknown');

  assert.equal(inputClassFor(), 'keyboard-mouse');
  assert.equal(inputClassFor({touch: true}), 'touch');
  assert.equal(inputClassFor({gamepad: true}), 'gamepad');
  assert.equal(inputClassFor({touch: true, gamepad: true}), 'mixed');

  assert.deepEqual(accessibilityFlagsFrom(null), {
    reducedMotion: false, highContrast: false, colorBlindPalette: false,
    captions: false, uiScaled: false, touchLayout: false,
  });
  assert.equal(accessibilityFlagsFrom({palette: 'default'}).colorBlindPalette, false);
  assert.equal(accessibilityFlagsFrom({palette: 'tritanopia'}).colorBlindPalette, true);

  assert.equal(freshSessionId(() => 0), 's-0000000000', 'session ids are deterministic given the injected random');
  assert.equal(freshSessionId(() => 0.999999999).length, 12);
  assert.equal(STUDY_EVENTS.length, 21);
  assert.ok(STUDY_EVENTS.includes('second_match_started'));
  const overlap = STUDY_PAYLOAD_KEYS.filter(key => STUDY_FORBIDDEN_KEYS.includes(key));
  assert.deepEqual(overlap, [], 'allowed and forbidden payload keys never overlap');
});
