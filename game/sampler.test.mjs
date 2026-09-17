import test from 'node:test';
import assert from 'node:assert/strict';
import {SampleBank, parseManifest, nearestSamples, selectSample, sampleRateFor, loopWindow, SAMPLED_INSTRUMENTS} from './sampler.mjs';
import {MusicEngine} from './music.mjs';

// A minimal decoded-buffer stand-in: the sampler only reads `duration`.
const fakeBuffer = (duration = 1.5) => ({ duration, length: Math.round(duration * 44100), sampleRate: 44100 });

// A manifest with two velocity layers of one strings pitch, a soft/strong bell
// and a pitch-less extra so nearest-pitch and layer fallback can be exercised.
const RAW_MANIFEST = {
  version: 1,
  generator: 'test',
  sampleRate: 44100,
  samples: [
    { id: 'strings-a', instrument: 'strings-pad', midi: 50, velocity: 1, file: 'samples/strings-a.ogg', fallback: 'samples/strings-a.m4a', mime: 'audio/ogg', fallbackMime: 'audio/mp4', loopStart: 0.25, loopEnd: 1.5, gain: 0.9 },
    { id: 'strings-b', instrument: 'strings-pad', midi: 50, velocity: 2, file: 'samples/strings-b.ogg', fallback: null, mime: 'audio/ogg', gain: 0.9 },
    { id: 'strings-c', instrument: 'strings-pad', midi: 62, velocity: 2, file: 'samples/strings-c.ogg', fallback: null, mime: 'audio/ogg', loopStart: 0.2, loopEnd: 1.2, gain: 0.9 },
    { id: 'bells-a', instrument: 'bells', midi: 72, velocity: 1, file: 'samples/bells-a.ogg', fallback: 'samples/bells-a.m4a', mime: 'audio/ogg', loopStart: null, loopEnd: null, gain: 0.65 },
    { id: 'bells-b', instrument: 'bells', midi: 72, velocity: 2, file: 'samples/bells-b.ogg', fallback: 'samples/bells-b.m4a', mime: 'audio/ogg', loopStart: null, loopEnd: null, gain: 0.65 },
  ],
};
const MANIFEST = parseManifest(RAW_MANIFEST);

function richContext() {
  const nodes = [];
  const param = (v = 0) => ({ value: v, setValueAtTime(v2) { this.value = v2; }, linearRampToValueAtTime(v2) { this.value = v2; }, exponentialRampToValueAtTime(v2) { this.value = v2; }, setTargetAtTime(v2) { this.value = v2; }, cancelScheduledValues() {} });
  const node = (extra) => { const n = { frequency: param(), gain: param(), Q: param(), pan: param(), type: '', buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1), connect() { this.connected = true; }, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; }, ...extra }; nodes.push(n); return n; };
  return {
    currentTime: 0, state: 'running', sampleRate: 44100, destination: {}, nodes,
    createGain: () => node(),
    createOscillator: () => node({ type: 'sine' }),
    createBufferSource: () => node({}),
    createBiquadFilter: () => node({ type: 'lowpass' }),
    createStereoPanner: () => node(),
    createDelay: () => node({ delayTime: param() }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
}

// fetch/decoder stub: `failOgg` rejects the Ogg so the AAC fallback is used.
function fakeBank({ failOgg = false, failAll = false, decodeAudioData = true } = {}) {
  const ctx = richContext();
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => RAW_MANIFEST };
    // The AAC fallback is tagged with a different length so the failOgg decoder
    // can reject the Ogg bytes and still succeed on the .m4a.
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(url.endsWith('.m4a') ? 8 : 4) };
  };
  if (decodeAudioData) {
    ctx.decodeAudioData = (bytes, ok) => {
      if (failAll || (failOgg && bytes.byteLength !== 8)) return Promise.reject(new Error('bad audio'));
      return Promise.resolve(ok(fakeBuffer(1.5)));
    };
  }
  const bank = new SampleBank({ ctx, baseUrl: '/music', fetchImpl, manifest: MANIFEST });
  return { bank, ctx, fetched };
}

// --- pure helpers ------------------------------------------------------------

test('manifest parsing normalises loop points and builds the instrument index', () => {
  assert.equal(MANIFEST.version, 1);
  assert.equal(MANIFEST.samples.length, 5);
  assert.equal(MANIFEST.samples.find((s) => s.id === 'strings-a').looped, true);
  assert.deepEqual(MANIFEST.samples.find((s) => s.id === 'bells-a').loopStart, null);
  assert.deepEqual(MANIFEST.instruments['strings-pad'].samples.sort(), ['strings-a', 'strings-b', 'strings-c']);
  assert.equal(MANIFEST.instruments.bells.type, 'oneshot');
  assert.deepEqual([...SAMPLED_INSTRUMENTS], ['strings-pad', 'low-brass', 'timpani', 'bells', 'taiko']);
  assert.equal(parseManifest({ version: 2, samples: [] }), null, 'unknown versions are rejected');
  assert.equal(parseManifest('{not json'), null);
  assert.equal(parseManifest({ version: 1, samples: [{ id: 'x', instrument: 'y' }] }), null, 'samples without a midi note are dropped');
  // A bogus loop window is treated as a one-shot rather than trusted.
  const odd = parseManifest({ version: 1, samples: [{ id: 'x', instrument: 'bells', midi: 60, velocity: 1, loopStart: 2, loopEnd: 1 }] });
  assert.equal(odd.samples[0].loopStart, null);
});

test('nearest-pitch selection is stable and layer-aware', () => {
  assert.deepEqual(nearestSamples(MANIFEST, 'strings-pad', 50).map((s) => s.id), ['strings-a', 'strings-b']);
  assert.deepEqual(nearestSamples(MANIFEST, 'strings-pad', 55).map((s) => s.id), ['strings-a', 'strings-b'], '55 is nearest to the 50 pair');
  assert.deepEqual(nearestSamples(MANIFEST, 'strings-pad', 61).map((s) => s.id), ['strings-c'], '61 sits closest to the 62 sample');
  assert.deepEqual(nearestSamples(MANIFEST, 'nope', 50), []);
  // Layer preference picks the matching velocity; a missing layer falls back.
  assert.equal(selectSample(MANIFEST, 'strings-pad', 50, 1, 0).id, 'strings-a');
  assert.equal(selectSample(MANIFEST, 'strings-pad', 50, 2, 0).id, 'strings-b');
  assert.equal(selectSample(MANIFEST, 'strings-pad', 50, 3, 0).id, 'strings-a', 'an unknown layer uses the nearest pool');
  assert.equal(selectSample(MANIFEST, 'bells', 72, 2, 0.75).id, 'bells-b', 'the round-robin pick selects within the layer');
});

test('sample rate, loop and one-shot math are exact', () => {
  assert.ok(Math.abs(sampleRateFor(440, 69) - 1) < 1e-9);
  assert.ok(Math.abs(sampleRateFor(880, 69) - 2) < 1e-9, 'an octave up doubles playback rate');
  assert.deepEqual(loopWindow({ loopStart: 0.25, loopEnd: 1.5 }), { loopStart: 0.25, loopEnd: 1.5 });
  assert.equal(loopWindow({ loopStart: null, loopEnd: null }), null);
  assert.equal(loopWindow({ loopStart: 1, loopEnd: 1 }), null, 'a zero-length loop is not a loop');
});

// --- bank loading ------------------------------------------------------------

test('a bank stays inert without a decoder or fetch', async () => {
  const empty = new SampleBank({});
  assert.equal(await empty.loadManifest(), false);
  assert.equal(empty.preload('strings-pad'), null);
  assert.equal(empty.has('strings-pad'), false);
});

test('the bank fetches, decodes and falls back from Ogg to AAC', async () => {
  const { bank, fetched } = fakeBank({ failOgg: true });
  assert.equal(await bank.loadManifest('/music/manifest.json'), true);
  assert.equal(bank.has('strings-pad'), true);
  assert.equal(await bank.preload('strings-pad'), true);
  assert.equal(bank.isReady('strings-pad'), true);
  assert.ok(fetched.some((u) => u.endsWith('strings-a.ogg')), 'Ogg is attempted first');
  assert.ok(fetched.some((u) => u.endsWith('strings-a.m4a')), 'a rejected Ogg falls through to AAC');
  assert.ok(fetched.some((u) => u.endsWith('strings-c.ogg')), 'every sample in the instrument is attempted');
  assert.ok(bank.bufferFor(MANIFEST.samples.find((s) => s.id === 'strings-a')), 'the AAC-decoded buffer is cached');
});

test('a persistent decode failure is remembered, not retried per note', async () => {
  const ctx = richContext();
  let calls = 0;
  ctx.decodeAudioData = () => { calls++; return Promise.reject(new Error('nope')); };
  const bank = new SampleBank({ ctx, baseUrl: '/music', manifest: MANIFEST, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }) });
  assert.equal(await bank.preload('bells'), false);
  assert.equal(bank.state('bells'), 'failed');
  const after = calls;
  assert.equal(await bank.preload('bells'), false);
  assert.equal(calls, after, 'a failed instrument is not re-decoded');
  assert.equal(bank.bufferFor(MANIFEST.samples.find((s) => s.id === 'bells-a')), null);
});

test('status reports loaded/total counts per instrument', async () => {
  const { bank } = fakeBank();
  await bank.loadManifest('/music/manifest.json');
  await bank.preload('strings-pad');
  const status = bank.status();
  assert.equal(status.manifest, true);
  assert.equal(status.ready, 1);
  assert.deepEqual(status.instruments['strings-pad'], { state: 'ready', loaded: 3, total: 3 });
  assert.equal(status.instruments.bells.state, 'idle');
});

// --- engine integration ------------------------------------------------------

test('the engine voices a decoded sample with the schedule note contract and a seeded checksum', async () => {
  const { bank } = fakeBank();
  await bank.loadManifest('/music/manifest.json');
  await bank.preload('strings-pad');
  const ctx = richContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, sampleBank: bank, seed: 7 });
  e.setSoundtrack('default');
  assert.equal(e._scheduleSampled(0, e.buses.menu, 'strings-pad', 220, 1, 0.05, 0.3, 0), true);
  assert.equal(e.notesScheduled, 1);
  assert.ok(e.voices.length === 1, 'a sampled note is one voice slot');
  assert.notEqual(e.scheduleChecksum, 0);
  const src = e.voices[0].o;
  assert.equal(src.loop, true, 'a sustained sample loops');
  assert.ok(src.loopStart > 0 && src.loopEnd > src.loopStart, 'loop points come from the manifest');
  assert.ok(src.playbackRate.value > 0, 'the sample is pitch-shifted to the requested note');
  e.dispose();
});

test('sampled selection and the checksum replay identically for one seed', async () => {
  const run = async () => {
    const { bank } = fakeBank();
    await bank.loadManifest('/music/manifest.json');
    await bank.preload('strings-pad');
    const ctx = richContext();
    const e = new MusicEngine({ ctx, destination: ctx.destination, sampleBank: bank, seed: 11 });
    for (let i = 0; i < 12; i++) e._scheduleSampled(i * 0.1, e.buses.menu, 'strings-pad', 180 + i * 12, 0.5, 0.05, 0.2, 0);
    const checksum = e.scheduleChecksum;
    e.dispose();
    return checksum;
  };
  assert.equal(await run(), await run(), 'the same seed reproduces the same sample choices');
});

test('an undecoded instrument falls back without scheduling a sampled voice or consuming a slot', async () => {
  const { bank } = fakeBank();
  await bank.loadManifest('/music/manifest.json');
  const ctx = richContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, sampleBank: bank, seed: 3 });
  const before = e.notesScheduled;
  assert.equal(e._scheduleSampled(0, e.buses.menu, 'bells', 1046, 1, 0.05, 0.3, 0), false, 'no decoded buffer means no voice');
  assert.equal(e.notesScheduled, before);
  assert.equal(e.voices.length, 0);
  // The fallback voice is still available with the same contract.
  assert.equal(e._bell(0, e.buses.menu, 0.05, 1046), true);
  assert.ok(e.voices.length > 0, 'the synth bell fallback still schedules');
  e.dispose();
});

test('without a decodable context the engine never builds a bank and sampleStatus stays empty', () => {
  const ctx = { currentTime: 0, state: 'running', sampleRate: 44100, destination: {}, createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} }), createOscillator: () => ({ type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }) };
  const e = new MusicEngine({ ctx, destination: ctx.destination, seed: 1 });
  assert.equal(e._ensureSampleBank(), null);
  const status = e.sampleStatus();
  assert.equal(status.manifest, false);
  assert.equal(status.loaded, 0);
  e.dispose();
});
