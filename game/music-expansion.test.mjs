import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MusicEngine, ARRANGEMENTS, FORM_BARS, MUSIC_ORNAMENTS, MUSIC_PALETTES, MUSIC_RESPONSES, LAYER_THRESHOLDS,
} from './music.mjs';

// A full Web Audio mock: oscillators, buffer sources, filters, panners and a
// delay line, so every new voice (shaker/keys/pluck/tremolo) can voice its
// preferred path and the fallbacks can be exercised on the minimal context.
function audioContext({ rich = true } = {}) {
  const nodes = [];
  const param = (v = 0) => ({ value: v, setValueAtTime(v2) { this.value = v2; }, linearRampToValueAtTime(v2) { this.value = v2; }, exponentialRampToValueAtTime(v2) { this.value = v2; }, setTargetAtTime(v2) { this.value = v2; }, cancelScheduledValues() {} });
  const node = (extra) => { const n = { frequency: param(), detune: param(), playbackRate: param(), gain: param(), Q: param(), pan: param(), delayTime: param(), type: '', buffer: null, loop: false, loopStart: 0, loopEnd: 0, connect() { this.connected = true; }, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; }, ...extra }; nodes.push(n); return n; };
  const ctx = {
    currentTime: 0, state: 'running', sampleRate: 44100, destination: {}, nodes,
    createGain: () => node(), createOscillator: () => node({ type: 'sine' }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
  if (rich) {
    ctx.createBufferSource = () => node({});
    ctx.createBiquadFilter = () => node({ type: 'lowpass' });
    ctx.createStereoPanner = () => node();
    ctx.createDelay = () => node({ delayTime: param() });
  }
  return ctx;
}

const theme = { root: 58, scale: [0, 3, 5, 7] };
const engine = (overrides = {}) => {
  const { rich = true, ...rest } = overrides;
  const ctx = rest.ctx || audioContext({ rich });
  return { e: new MusicEngine({ ...rest, ctx, destination: ctx.destination, theme }), ctx };
};
const runTicks = (e, ctx, n) => { for (let i = 0; i < n; i++) { ctx.currentTime += 0.05; e.tick(); } };
const combatTake = (setup, seed = 7) => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed });
  setup?.(e);
  e.setScene('combat');
  e.setIntensity(1);
  runTicks(e, ctx, 400);
  return { e, ctx };
};

// --- dynamic state -----------------------------------------------------------

test('tension and escalation default to rest and leave the baseline take bit-identical', () => {
  const a = combatTake();
  const b = combatTake((e) => { e.setTension(0); e.setEscalation(0); e.setPalette('default'); e.setBiomePalette('default'); e.setVariation(0); });
  assert.equal(a.e.tension, 0);
  assert.equal(a.e.escalation, 0);
  assert.equal(a.e.variation, 0);
  assert.deepEqual({ ...a.e.palette }, { shaker: false, keys: false, pluck: false }, 'the default palette is all-off');
  assert.equal(a.e.scheduleChecksum, b.e.scheduleChecksum, 'rest state reproduces the baseline take');
  assert.equal(a.e.notesScheduled, b.e.notesScheduled);
  assert.deepEqual(a.e.notesBy, b.e.notesBy);
  assert.equal(a.e.notesBy.tremolo, 0);
  assert.equal(a.e.notesBy.shaker + a.e.notesBy.keys + a.e.notesBy.pluck + a.e.notesBy.pizz, 0, 'no optional colour while the default palette is active');
});

test('setTension and setEscalation are bounded pure state setters', () => {
  const { e } = engine();
  assert.equal(e.setTension(-1), 0);
  assert.equal(e.setTension(2), 1);
  assert.equal(e.setTension(0.42), 0.42);
  assert.equal(e.setTension('nope'), 0);
  assert.equal(e.setEscalation(-4), 0);
  assert.equal(e.setEscalation(1.6), 2, 'a level rounds to the nearest whole step');
  assert.equal(e.setEscalation(9), 3);
  assert.equal(e.setEscalation(NaN), 0);
});

test('tension adds the low-string tremolo danger layer inside the voice budget', () => {
  const quiet = combatTake();
  const tense = combatTake((e) => e.setTension(1));
  assert.ok(tense.e.notesBy.tremolo > 0, 'a full tension take voices the tremolo');
  assert.equal(quiet.e.notesBy.tremolo, 0, 'at rest there is no tremolo');
  assert.notEqual(tense.e.scheduleChecksum, quiet.e.scheduleChecksum, 'the danger layer changes the take');
  assert.ok(tense.e.voices.length <= tense.e.maxVoices);
  assert.ok(tense.e.peakVoices > 0 && tense.e.peakVoices <= 44);
  assert.ok(tense.e.sustainVoices <= tense.e.sustainBudget);
  const faint = combatTake((e) => e.setTension(0.1));
  assert.equal(faint.e.notesBy.tremolo, 0, 'below the danger threshold the layer stays silent');
});

test('escalation compresses the form and speeds the grid', () => {
  const { e } = engine();
  const restStep = e._stepDur('combat');
  assert.deepEqual({ ...e._formBars() }, { ...FORM_BARS }, 'level 0 is the shared 32-bar form');
  e.setEscalation(3);
  assert.ok(e._stepDur('combat') < restStep, 'escalation drives the grid faster');
  const bars = e._formBars();
  assert.equal(Object.values(bars).reduce((sum, n) => sum + n, 0), 8, 'level 3 is an eight-bar short form');
  const sectionOf = (bar) => { e.bar = bar; return e._formSection(); };
  assert.equal(sectionOf(0), 'intro');
  assert.equal(sectionOf(2), 'build');
  assert.equal(sectionOf(4), 'climax');
  assert.equal(sectionOf(6), 'transition');
  assert.equal(sectionOf(7), 'outro');
  assert.equal(sectionOf(8), 'intro', 'the short form loops');
  e.bar = bars.intro - 1;
  assert.equal(e._fillLevel(), 2, 'the last bar of each short section is a big fill');
  const escalated = combatTake((x) => x.setEscalation(3));
  assert.ok(escalated.e.notesScheduled > 0);
  assert.ok(escalated.e.voices.length <= escalated.e.maxVoices);
});

// --- palettes ----------------------------------------------------------------

test('palettes are frozen authored flag sets with a deterministic fallback', () => {
  assert.ok(Object.isFrozen(MUSIC_PALETTES) && Object.isFrozen(MUSIC_PALETTES.default));
  assert.deepEqual({ ...MUSIC_PALETTES.default }, { shaker: false, keys: false, pluck: false });
  assert.ok(Object.isFrozen(MUSIC_ORNAMENTS) && Object.isFrozen(MUSIC_ORNAMENTS.rotations[0]));
  const { e } = engine();
  assert.equal(e.setPalette('not-a-palette'), 'default');
  assert.deepEqual({ ...e.palette }, { ...MUSIC_PALETTES.default }, 'an unknown mode falls back to all-off');
  assert.equal(e.setBiomePalette('not-a-mood'), 'default');
  assert.equal(e.setPalette('horde'), 'horde');
  assert.equal(e.palette.shaker, true);
  assert.equal(e.palette.pluck, true);
  assert.equal(e.setBiomePalette('night'), 'night');
  assert.equal(e.palette.keys, true, 'the biome palette adds its own flag');
  assert.equal(e.palette.shaker, true, 'the mode palette survives the biome overlay');
  assert.equal(e.setBiomePalette('default'), 'default');
  assert.equal(e.palette.keys, false, 'clearing the biome releases its overlay');
  assert.equal(e.palette.pluck, true, 'the mode palette is still in force');
});

test('palettes never touch the theme and gate the authored colour layers', () => {
  const { e } = engine();
  e.setTheme({ root: 61, scale: [0, 2, 4] });
  e.setPalette('horde');
  assert.deepEqual([...e.theme.scale], [0, 2, 4], 'a palette never retunes the engine');
  const off = combatTake();
  const on = combatTake((x) => x.setPalette('team-elimination'));
  assert.equal(off.e.notesBy.shaker + off.e.notesBy.keys + off.e.notesBy.pluck, 0);
  assert.ok(on.e.notesBy.shaker > 0, 'the combat shaker grid is authored and palette-approved');
  assert.ok(on.e.notesBy.keys > 0, 'FM keys answer when the palette allows them');
  assert.ok(on.e.voices.length <= on.e.maxVoices);
  const pluck = combatTake((x) => x.setPalette('horde'));
  assert.ok(pluck.e.notesBy.pluck > 0, 'the plucked-string answer is palette-approved separately');
  assert.equal(pluck.e.notesBy.keys, 0, 'horde does not authorise keys');
  const sameA = combatTake((x) => x.setPalette('horde'));
  const sameB = combatTake((x) => x.setPalette('horde'));
  assert.equal(sameA.e.scheduleChecksum, sameB.e.scheduleChecksum, 'one palette and one seed reproduce one take');
});

// --- new voices --------------------------------------------------------------

test('the new voices each spend exactly one voice slot and fold into the checksum', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme });
  const before = e.scheduleChecksum;
  assert.equal(e._shaker(0, e.buses.menu, 0.03), true);
  assert.equal(e.voices.length, 1);
  assert.equal(e.notesBy.shaker, 1);
  const keysAt = e.voices.length;
  assert.equal(e._keys(0, e.buses.menu, 440, 0.5, 0.04, { bell: true }), true);
  assert.equal(e.voices.length - keysAt, 1, 'carrier and modulator ride inside one voice record');
  assert.equal(e.voices[keysAt].oscs.length, 2);
  assert.equal(e.notesBy.keys, 1);
  const pluckAt = e.voices.length;
  assert.equal(e._pluck(0, e.buses.menu, 220, 0.4, 0.04), true);
  assert.equal(e.voices.length - pluckAt, 1);
  assert.equal(e.notesBy.pluck, 1);
  assert.equal(e._pizz(0, e.buses.menu, 220, 0.3, 0.03), true);
  assert.equal(e.notesBy.pizz, 1);
  assert.equal(e._tremolo(0, e.buses.menu, 73, 0.2, 0.03), true);
  assert.equal(e.notesBy.tremolo, 1);
  assert.ok(e.voices.every((rec) => rec.end > 0), 'every voice carries a prune time');
  assert.notEqual(e.scheduleChecksum, before);
  e.dispose();
});

test('the new voices fall back on a context without buffers, filters or delay', () => {
  const { e } = engine({ rich: false });
  assert.equal(e._shaker(0, e.buses.menu, 0.03), true, 'a tonal tick stands in for the shaker');
  assert.equal(e.notesBy.shaker, 1);
  assert.equal(e._keys(0, e.buses.menu, 440, 0.4, 0.04), true);
  assert.equal(e.notesBy.keys, 1);
  assert.equal(e._pluck(0, e.buses.menu, 220, 0.4, 0.04), true, 'the triangle pluck stands in for Karplus-Strong');
  assert.equal(e.notesBy.pluck, 1);
  assert.ok(e.voices.length <= e.maxVoices);
});

test('the new voices respect the total cap and the colour layers are dropped first', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme, maxVoices: 8 });
  while (e.voices.length < e.maxVoices) e.voices.push({ o: null, g: null, extra: [], end: 1e9 });
  const before = e.notesScheduled;
  assert.equal(e._shaker(0, e.buses.menu, 0.03), false);
  assert.equal(e._keys(0, e.buses.menu, 440, 0.4, 0.04), false);
  assert.equal(e._pluck(0, e.buses.menu, 220, 0.4, 0.04), false);
  assert.equal(e.notesScheduled, before, 'a saturated engine never overcommits a colour voice');
  assert.equal(e.notesBy.shaker + e.notesBy.keys + e.notesBy.pluck, 0);
  e.dispose();
  // Under pressure in a real run the core parts still sound; the colour is the
  // layer that gives way first.
  const tight = combatTake((x) => { x.setPalette('team-elimination'); x.maxVoices = 10; });
  assert.ok(tight.e.notesBy.kick > 0 && tight.e.notesBy.bass > 0);
  assert.ok(tight.e.voices.length <= 10);
  assert.ok(tight.e.peakVoices <= 10);
});

// --- seeded variation --------------------------------------------------------

test('variation 0 is bit-identical to the baseline; other ids fork it deterministically', () => {
  const baseline = combatTake();
  for (const value of [0, null, undefined, -3, '', false]) {
    const run = combatTake((e) => { e.setVariation(value); });
    assert.equal(run.e.variation, 0, `variation ${String(value)} is off`);
    assert.equal(run.e.scheduleChecksum, baseline.e.scheduleChecksum, `variation ${String(value)} keeps the baseline take`);
  }
  const keyA = combatTake((e) => e.setVariation('ironman'));
  const keyB = combatTake((e) => e.setVariation('ironman'));
  const keyC = combatTake((e) => e.setVariation('vanguard'));
  assert.ok(keyA.e.variation > 0, 'a string key resolves to a positive id');
  assert.equal(keyA.e.scheduleChecksum, keyB.e.scheduleChecksum, 'one key and one seed reproduce one take');
  assert.notEqual(keyA.e.scheduleChecksum, keyC.e.scheduleChecksum, 'different keys fork the take');
  assert.notEqual(keyA.e.scheduleChecksum, baseline.e.scheduleChecksum);
  const n3 = combatTake((e) => e.setVariation(3));
  const n4 = combatTake((e) => e.setVariation(4));
  assert.equal(n3.e.variation, 3);
  assert.notEqual(n3.e.scheduleChecksum, n4.e.scheduleChecksum, 'different numeric ids differ');
});

test('the variation ornament plan is a pure hash of seed, scene, bar and id', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed: 7 });
  e.setVariation('ironman');
  e.bar = 5;
  const first = e._ornament('combat');
  const second = e._ornament('combat');
  assert.equal(first, second, 'the per-bar plan is cached and stable');
  assert.ok(MUSIC_ORNAMENTS.fillTurns.includes(first.fillTurn));
  assert.ok(first.ghostSteps.length >= 2);
  assert.ok(MUSIC_ORNAMENTS.counterOctaves.includes(first.counterOctave));
  assert.ok(MUSIC_ORNAMENTS.arpDirections.includes(first.arpDirection));
  assert.ok(MUSIC_ORNAMENTS.leadTurns.includes(first.leadTurn));
  assert.ok(MUSIC_ORNAMENTS.rotations.includes(first.rotation));
  const twin = new MusicEngine({ ctx: audioContext(), destination: {}, theme, seed: 7, });
  twin.setVariation('ironman');
  twin.bar = 5;
  assert.deepEqual(twin._ornament('combat'), first, 'the same seed and id produce the same plan');
  twin.bar = 6;
  assert.notDeepEqual(twin._ornament('combat'), first, 'the next bar selects a new plan');
  // Direction transforms without mutating the frozen table.
  const list = [0, 1, 2, 3];
  assert.equal(e._ornamentArp(list, { arpDirection: 'written' }), list);
  assert.deepEqual(e._ornamentArp(list, { arpDirection: 'reverse' }), [3, 2, 1, 0]);
  assert.deepEqual(e._ornamentArp(list, { arpDirection: 'updown' }), [0, 1, 2, 3, 3, 2, 1, 0]);
  assert.deepEqual(e._ornamentArp(list, { arpDirection: 'octave' }), [0, 8, 2, 10]);
  assert.deepEqual([...ARRANGEMENTS.combat.hat], [2, 6, 10, 14], 'the authored grid is never mutated');
});

test('a ghost-16th ornament adds a quiet hat only off the authored grid', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed: 7 });
  e.setVariation(1);
  e.setScene('combat');
  e.setIntensity(1);
  e.layers.combat = 1;
  let tested = 0;
  for (let bar = 0; bar < 16 && !tested; bar++) {
    e.bar = bar;
    const orn = e._ornament('combat');
    const hat = ARRANGEMENTS.combat.hat;
    const ghost = orn.ghostSteps.find((step) => !hat.includes(step));
    if (ghost == null || e._fillLevel() !== 0) continue;
    const before = e.notesBy.hat;
    e._scheduleStep(0, 'combat', ghost);
    assert.ok(e.notesBy.hat > before, `bar ${bar} step ${ghost} adds a ghost hat`);
    tested++;
  }
  assert.equal(tested, 1, 'at least one bar offers a ghost step off the grid');
});

// --- harmonic responses ------------------------------------------------------

test('responses are bounded, drained on the next step and dropped when stale', () => {
  assert.deepEqual([...MUSIC_RESPONSES], ['capture', 'loss', 'accent', 'final', 'award']);
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme });
  assert.equal(e.requestResponse('capture'), true);
  assert.equal(e.requestResponse('not-a-response'), false);
  for (let i = 0; i < 3; i++) assert.equal(e.requestResponse('loss'), true);
  assert.equal(e.requestResponse('final'), false, 'the queue is capped at four pending responses');
  assert.equal(e.pendingResponses.length, 4);
  assert.equal(e.pendingResponses[0].kind, 'capture');
  e._scheduleStep(0.1, 'explore', 0);
  assert.equal(e.notesBy.response, 1, 'the next scheduled step voices one response');
  assert.equal(e.pendingResponses.length, 3);
  assert.notEqual(e.scheduleChecksum, 0);
  // A response older than two seconds (music was paused) never fires late.
  const queued = e.pendingResponses.length;
  e.pendingResponses[0].at = -100;
  e._scheduleStep(0.2, 'explore', 1);
  assert.equal(e.pendingResponses.length, queued - 1);
  assert.equal(e.notesBy.response, 1, 'the stale response is dropped, not voiced');
  assert.equal(e.clearResponses(), 2);
  assert.equal(e.pendingResponses.length, 0);
  // The award hook is a normal response kind: one voice, drained on the next
  // step, and it never fires without a live graph.
  assert.equal(e.requestResponse('award', { vol: 1 }), true);
  e._scheduleStep(0.3, 'results', 0);
  assert.equal(e.notesBy.response, 2, 'the award sting is voiced on the next step');
  assert.ok(e.notesBy.accent > 0, 'the award sting counts as a bright accent');
  assert.equal(e.requestResponse('award', { vol: 0 }), true);
  e._scheduleStep(0.4, 'results', 0);
  assert.equal(e.notesBy.response, 2, 'a zero-volume award never spends a voice');
  e.setMuted(true);
  e.requestResponse('capture');
  assert.equal(e.pendingResponses.length, 0);
});

test('a saturated engine drops a response without exceeding the cap', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme, maxVoices: 6 });
  while (e.voices.length < e.maxVoices) e.voices.push({ o: null, g: null, extra: [], end: 1e9 });
  e.requestResponse('capture');
  e._scheduleStep(0.1, 'explore', 0);
  assert.equal(e.notesBy.response, 0, 'no voice is committed past the cap');
  assert.equal(e.pendingResponses.length, 0, 'the request is consumed rather than fired late');
  e.dispose();
});
