import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MusicEngine, COCS_MOTIF, CHORD_TONES, FORM_BARS, HALO_THEME,
  HALO_ARRANGEMENTS, HALO_PROGRESSIONS, HALO_QUALITIES, MUSIC_SCENES,
} from './music.mjs';
import { parseManifest } from './sampler.mjs';

// A Web Audio mock with the nodes the orchestral voices touch: oscillators,
// buffer sources (with playbackRate), filters, panners and a seeded noise buffer.
function audioContext() {
  const nodes = [];
  const param = (v = 0) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v2) { this.value = v2; }, cancelScheduledValues() {} });
  const node = (extra) => {
    const n = { frequency: param(), detune: param(), playbackRate: param(), gain: param(), Q: param(), pan: param(), type: '', buffer: null, loop: false, loopStart: 0, loopEnd: 0, connect() { this.connected = true; }, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; }, ...extra };
    nodes.push(n);
    return n;
  };
  return {
    currentTime: 0, state: 'running', sampleRate: 44100, destination: {}, nodes,
    createGain: () => node(), createOscillator: () => node({ type: 'sine' }),
    createBufferSource: () => node(), createBiquadFilter: () => node({ type: 'lowpass' }),
    createStereoPanner: () => node(),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
}

// A decoded-instrument stand-in: only the instruments it is given are "ready",
// so the M1 gaps (choir/cymbals/brass-marcato/...) exercise the fallback paths.
function stubBank(instruments = ['strings-pad', 'low-brass']) {
  const samples = [];
  for (const instrument of instruments) {
    // Two same-pitch layers so the seeded round-robin has something to choose.
    for (let k = 0; k < 2; k++) samples.push({ id: `${instrument}-${k}`, instrument, midi: 62, velocity: 1, file: null });
  }
  const manifest = parseManifest({ version: 1, samples });
  return {
    manifest,
    isReady: (name) => Boolean(manifest.instruments[name]),
    isPending: () => false,
    preload: () => null,
    bufferFor: () => ({ duration: 2 }),
    status: () => ({ manifest: true }),
    dispose() {},
  };
}

const runTicks = (e, ctx, n) => { for (let i = 0; i < n; i++) { ctx.currentTime += 0.05; e.tick(); } };

test('the halo progressions are the planned 8-bar functional shapes with qualities', () => {
  assert.deepEqual([...MUSIC_SCENES], ['menu', 'explore', 'combat', 'results']);
  assert.deepEqual([...HALO_PROGRESSIONS.menu], [0, 5, 2, 6, 0, 5, 3, 4]);
  assert.deepEqual([...HALO_PROGRESSIONS.explore], [0, 5, 3, 4, 0, 6, 5, 4]);
  assert.deepEqual([...HALO_PROGRESSIONS.combat], [0, 5, 2, 6, 3, 4, 4, 0]);
  assert.deepEqual([...HALO_PROGRESSIONS.results], [0, 5, 2, 3, 4, 0, 4, 0]);
  for (const scene of MUSIC_SCENES) {
    assert.equal(HALO_PROGRESSIONS[scene].length, 8, `${scene} is an eight-bar phrase`);
    assert.equal(HALO_QUALITIES[scene].length, 8, `${scene} has one quality per bar`);
    assert.ok(HALO_QUALITIES[scene].every((q) => CHORD_TONES[q]), `${scene} qualities are known`);
  }
  assert.equal(HALO_QUALITIES.combat[6], 'M', 'combat borrows a major V before the tonic');
  assert.equal(HALO_QUALITIES.results[7], 'M', 'results closes on a Picardy I');
});

test('the quality table fixes the third and fifth of a chord', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME });
  assert.equal(e._chordTone(HALO_THEME.scale, 0, 'm', 1), 3, 'minor third');
  assert.equal(e._chordTone(HALO_THEME.scale, 0, 'M', 1), 4, 'major third');
  assert.equal(e._chordTone(HALO_THEME.scale, 0, 'm', 2), 7, 'perfect fifth');
  assert.equal(e._chordTone(HALO_THEME.scale, 4, 'M', 1), 11, 'borrowed A major has a C#');
});

test('the COCS leitmotif is shared and developed per scene', () => {
  assert.deepEqual([...COCS_MOTIF], [0, 2, 4, 3, 2, 4, 6, 4, 5, 4, 3, 2, 1, 2, 0, 0]);
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME });
  e.setSoundtrack('halo');
  assert.deepEqual([...HALO_ARRANGEMENTS.menu.lead], [0, 2, 4, 3], 'menu augments the first four degrees');
  e.bar = 0;
  assert.deepEqual([...e._leadFor(HALO_ARRANGEMENTS.explore)], [...COCS_MOTIF], 'explore states the motif');
  assert.deepEqual([...e._leadFor(HALO_ARRANGEMENTS.combat)], [...COCS_MOTIF], 'combat states the motif in bars 1–4');
  e.bar = 5;
  assert.deepEqual([...e._leadFor(HALO_ARRANGEMENTS.explore)], COCS_MOTIF.map((d) => d + 2), 'bars 5–8 sequence up a third');
  assert.deepEqual([...e._leadFor(HALO_ARRANGEMENTS.combat)], COCS_MOTIF.map((d) => -(d + 2)), 'combat inverts the sequence in bars 5–8');
  // Picardy: the same F is raised to F# only in the results development.
  e.bar = 0;
  assert.equal(e._leadTone(HALO_ARRANGEMENTS.explore, 2, 0), 3, 'explore keeps F natural');
  assert.equal(e._leadTone(HALO_ARRANGEMENTS.results, 2, 0), 4, 'results raises F to F#');
});

test('the augmented menu motif advances at half speed', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME });
  e.setSoundtrack('halo');
  const arr = HALO_ARRANGEMENTS.menu;
  e.bar = 0;
  assert.equal(e._leadIndex(arr, 0), 0, 'bar one starts on the tonic');
  e.bar = 1;
  assert.equal(e._leadIndex(arr, 0), 2, 'one bar later two half-speed notes have passed');
  e.bar = 2;
  assert.equal(e._leadIndex(arr, 0), 0, 'the four-note augmentation wraps after two bars');
});

test('section changes keep the transport running instead of restarting at bar 1', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME });
  e.setSoundtrack('halo');
  runTicks(e, ctx, 40);
  const step = e.step;
  const bar = e.bar;
  assert.ok(bar > 0 || step > 0, 'the transport has advanced');
  e.setScene('combat');
  assert.equal(e.step, step, 'setScene keeps the step');
  assert.equal(e.bar, bar, 'setScene keeps the bar');
  e.setIntensity(1);
  assert.equal(e.step, step, 'setIntensity keeps the step');
  e.setScene('menu');
  assert.equal(e.bar, bar, 'returning to the menu keeps the phrase position');
  e.setSoundtrack('halo');
  assert.equal(e.step, step, 'setSoundtrack does not reset the transport');
  e.setOutcome('victory');
  assert.equal(e.scene, 'results');
  assert.equal(e.bar, bar, 'the results scene continues the form');
});

test('the 32-bar form places fills on the four/eight/sixteen/twenty-eight bars', () => {
  assert.deepEqual({ ...FORM_BARS }, { intro: 8, build: 8, climax: 8, transition: 4, outro: 4 });
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME });
  const sectionOf = (bar) => { e.bar = bar; return e._formSection(); };
  const fillOf = (bar) => { e.bar = bar; return e._fillLevel(); };
  assert.equal(sectionOf(0), 'intro');
  assert.equal(sectionOf(8), 'build');
  assert.equal(sectionOf(16), 'climax');
  assert.equal(sectionOf(24), 'transition');
  assert.equal(sectionOf(28), 'outro');
  assert.equal(sectionOf(32), 'intro', 'the form loops');
  for (const bar of [3, 7, 15, 23, 27, 31]) assert.equal(fillOf(bar), bar === 3 ? 1 : 2, `fill level at bar ${bar + 1}`);
});

test('the voice budget raises the cap and keeps a separate sustained budget', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME });
  assert.equal(e.maxVoices, 44);
  assert.ok(e.sustainBudget >= 8 && e.sustainBudget <= 12, 'sustains are bounded separately');
  assert.ok(e.sustainBudget <= e.maxVoices - 4, 'transient slots are reserved');
  // _bass spends exactly one voice per note (body + sub in one slot).
  const before = e.voices.length;
  e._bass(0, e.buses.menu, HALO_THEME.root, 1, 0.09);
  assert.equal(e.voices.length - before, 1, 'the bass is one voice, not two');
  e.sustainVoices = e.sustainBudget;
  assert.equal(e._canVoice(true), false, 'sustains cannot exceed their budget');
  assert.equal(e._canVoice(false), true, 'short notes still allocate');
});

test('a long combat run stays under the raised cap and includes sampled strings', () => {
  const ctx = audioContext();
  const bank = stubBank(['strings-pad', 'low-brass', 'taiko', 'bells', 'timpani']);
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME, sampleBank: bank });
  e.setSoundtrack('halo');
  e.setScene('combat');
  e.setIntensity(1);
  for (let i = 0; i < 600; i++) { ctx.currentTime += 0.05; e.tick(); assert.ok(e.voices.length <= 44, `voice cap at tick ${i}`); }
  assert.ok(e.notesBy.pad > 0, 'combat still voices the string bed');
  assert.ok(e.notesBy.lead > 0, 'the leitmotif sounds');
  assert.ok(e.peakVoices > 0 && e.peakVoices <= 44);
});

test('the combat climax adds the staccato ostinato and marcato brass', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME });
  e.setSoundtrack('halo');
  e.setScene('combat');
  e.setIntensity(1);
  e.layers.combat = 1;
  e.bar = 17; // climax
  for (let step = 0; step < 16; step += 1) e._scheduleStep(0.1 * step, 'combat', step);
  assert.ok(e.notesBy.ostinato > 0, 'the motif runs as a low-string staccato ostinato');
  assert.ok(e.notesBy.marcato > 0, 'marcato brass accents the climax');
});

test('sampled round-robin selection is seeded and folded into the checksum', () => {
  const run = (seed) => {
    const ctx = audioContext();
    const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME, sampleBank: stubBank(), seed });
    e.setSoundtrack('halo');
    for (let i = 0; i < 24; i++) e._scheduleSampled(0, e.buses.menu, 'strings-pad', 146.83 + i, 1, 0.16, 0, 0, { velocity: 1 });
    return e;
  };
  const a = run(7);
  const b = run(7);
  const c = run(9);
  assert.ok(a.notesScheduled > 0, 'sampled voices were scheduled');
  assert.equal(a.scheduleChecksum, b.scheduleChecksum, 'one seed reproduces one sampled take');
  assert.notEqual(a.scheduleChecksum, c.scheduleChecksum, 'a different seed humanises the round-robin');
});

test('missing M1 instruments fall back to the synth without throwing', () => {
  const ctx = audioContext();
  const bank = stubBank(['strings-pad']); // no choir, cymbals, marcato, trumpet, gong...
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme: HALO_THEME, sampleBank: bank });
  e.setSoundtrack('halo');
  const needs = e._packSampleNeeds();
  for (const id of ['low-strings-stacc', 'brass-stacc', 'trumpet-pad', 'timpani-roll', 'cymbal-swell', 'cymbal-crash', 'tubular-bells', 'gong', 'harp']) {
    assert.ok(needs.includes(id), `${id} is requested when the pack needs it`);
  }
  assert.ok(!needs.includes('choir'), 'no choir sample is baked; the synth fallback is kept');
  assert.equal(e._sampleReady('choir'), false, 'an absent instrument is not ready');
  assert.equal(e._scheduleSampled(0, e.buses.menu, 'choir', 147, 1, 0.07), false, 'sampled choir declines');
  assert.ok(e._choir(0, e.buses.menu, HALO_THEME.root, HALO_THEME.scale, 0, 1, 'm'), 'the synth choir stands in');
  assert.ok(e._cymbal(0, e.buses.drums, 1, 0.08, 0), 'the noise cymbal stands in');
  assert.ok(e._brassMarcato(0, e.buses.menu, 147, 0.3, 0.18, 0), 'the synth marcato stands in');
  assert.ok(e.notesBy.choir > 0 && e.notesBy.cymbal > 0 && e.notesBy.marcato > 0);
});
