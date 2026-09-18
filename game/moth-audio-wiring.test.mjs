import test from 'node:test';
import assert from 'node:assert/strict';
import { MothAudioBank, MothAudio } from './moth-audio.mjs';
import { SynthAudio } from './feedback.mjs';
import { configureMothAssets, resetMothAssets, mothMotif } from './moth-assets.mjs';

// A Web Audio mock rich enough for the real bus graph: gains, delay/filter for
// the shared space send, buffer sources for beds, decodeAudioData for both the
// Moth bank and (inertly) the sampled bank. Global fetch is stubbed per test so
// no manifest request ever leaves the process.
function stubContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} });
  const created = { sources: [], gains: [], delays: [], filters: [], panners: [] };
  const node = (extra = {}) => ({
    frequency: param(), gain: param(), Q: param(), pan: param(), delayTime: param(), type: '', buffer: null,
    loop: false, loopStart: 0, loopEnd: 0, connected: false, disconnected: false, started: false, stopped: false,
    connect() { this.connected = true; }, disconnect() { this.disconnected = true; },
    start() { this.started = true; }, stop() { this.stopped = true; },
    ...extra,
  });
  const ctx = {
    currentTime: 0, state: 'running', sampleRate: 22050, destination: {},
    createGain() { const n = node(); created.gains.push(n); return n; },
    createBufferSource() { const n = node(); created.sources.push(n); return n; },
    createStereoPanner() { const n = node(); created.panners.push(n); return n; },
    createDelay() { const n = node(); created.delays.push(n); return n; },
    createBiquadFilter() { const n = node(); created.filters.push(n); return n; },
    createOscillator() { return node({ type: 'sine' }); },
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; },
    decodeAudioData(bytes, ok) { ok?.({ duration: 10.68, length: Math.floor(10.68 * 22050), numberOfChannels: 1, sampleRate: 22050, getChannelData: () => new Float32Array(8) }); },
    resume() { this.state = 'running'; return Promise.resolve(); },
    close() { this.closed = true; },
  };
  return { ctx, created };
}

async function withFetchStub(run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('the deferred Moth factory mounts on the first context and disposes with the host', async () => {
  await withFetchStub(async () => {
    const { ctx } = stubContext();
    const descriptors = { 'bed-ritual': { url: '/moth/files/bed-ritual/clip.wav', seconds: 10.68, loopStart: 0.5, loopEnd: 10.5 } };
    const audio = new SynthAudio();
    let built = null;
    try {
      audio.setMothAudioFactory((context) => {
        const bank = new MothAudioBank({ ctx: context, resolve: (name) => descriptors[name] || null, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }) });
        built = new MothAudio({ ctx: context, bank, destinations: { ambience: audio.ambienceBus, effects: audio.effectsBus }, sceneBeds: { menu: 'bed-ritual', explore: 'bed-ritual', combat: null }, gain: 0.4 });
        return built;
      });
      assert.equal(audio.mothAudio, null, 'the factory waits for a context');
      audio.ctx = ctx; audio.noiseBuffer = {};
      audio._ensureBuses();
      assert.equal(audio.mothAudio, built, 'the built layer attaches once the buses exist');
      assert.equal(audio.mothAudioStatus().scene, 'menu', 'the current scene seeds the layer');
      await new Promise((resolve) => setTimeout(resolve, 0));
      audio.setScene('menu'); // the frame loop reconciles each tick after a lazy decode
      assert.deepEqual(audio.mothAudioStatus().beds, ['bed-ritual'], 'menu ambience is selected');
      audio.dispose();
      assert.equal(audio.mothAudio, null, 'dispose releases the layer');
      assert.equal(built.enabled, false, 'the layer is switched off on disposal');
    } finally {
      if (audio.mothAudio) audio.dispose();
    }
  });
});

test('the game bed override keeps bed-ritual for menu/explore and stays out of combat', () => {
  const { ctx } = stubContext();
  const bank = new MothAudioBank({ ctx, resolve: () => null, fetchImpl: async () => ({ ok: false }) });
  const audio = new MothAudio({ ctx, bank, sceneBeds: { menu: 'bed-ritual', explore: 'bed-ritual', combat: null } });
  try {
    audio.setScene('menu');
    assert.deepEqual(audio.desiredBeds(), ['bed-ritual'], 'menu reads the ritual bed');
    audio.setScene('game'); audio.setIntensity(0);
    assert.deepEqual(audio.desiredBeds(), ['bed-ritual'], 'explore reads the ritual bed');
    audio.setIntensity(1);
    assert.deepEqual(audio.desiredBeds(), [], 'combat leaves the Moth bed to the score and SFX');
    audio.setScene('results'); audio.setIntensity(0);
    assert.deepEqual(audio.desiredBeds(), ['bed-ritual'], 'the results screen keeps the low ambience');
  } finally {
    audio.dispose();
  }
});

test('reduced motion and setEnabled keep the layer inert and stop live beds', async () => {
  const { ctx, created } = stubContext();
  const bank = new MothAudioBank({ ctx, resolve: (name) => (name === 'bed-ritual' ? { url: '/x', seconds: 4 } : null), fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }) });
  const audio = new MothAudio({ ctx, bank, destinations: { ambience: ctx.createGain() } });
  try {
    await bank.preload('bed-ritual');
    assert.equal(audio.playBed('bed-ritual'), true);
    assert.equal(audio.status().bedCount, 1);
    assert.equal(audio.setEnabled(false), false);
    assert.equal(audio.status().bedCount, 0, 'disabling stops the live bed');
    assert.ok(created.sources.some((source) => source.stopped), 'the source was stopped');
    assert.equal(audio.playBed('bed-ritual'), false, 'a disabled layer starts nothing');
    assert.equal(audio.setEnabled(true), true);
    assert.equal(audio.playBed('bed-ritual'), true, 're-enabling restores playback');
    assert.equal(audio.setReducedMotion(true), false, 'reduced motion wins over the requested state');
    assert.equal(audio.status().bedCount, 0);
    assert.equal(audio.playBed('bed-ritual'), false);
    assert.equal(audio.setReducedMotion(false), true, 'clearing reduced motion restores the requested state');
  } finally {
    audio.dispose();
  }
});

test('a Moth layer constructed under reduced motion never plays', () => {
  const { ctx } = stubContext();
  const bank = new MothAudioBank({ ctx, resolve: () => ({ url: '/x', seconds: 4 }), fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }), reducedMotion: true });
  const audio = new MothAudio({ ctx, bank, destinations: { ambience: ctx.createGain() }, reducedMotion: true });
  try {
    assert.equal(audio.enabled, false);
    assert.equal(audio.playBed('bed-ritual'), false);
    assert.equal(audio.setEnabled(true), false, 'a host cannot override reduced motion');
    assert.equal(audio.setReducedMotion(false), true, 'clearing the preference enables it');
  } finally {
    audio.dispose();
  }
});

test('victory and defeat select the baked Moth motif for the results lead', async () => {
  await withFetchStub(async () => {
    const { ctx, created } = stubContext();
    configureMothAssets({
      version: 1,
      motifs: {
        'moth-oracle': { bpm: 120, notes: [{ step: 0, midi: 62, dur: 4 }] },
        'moth-victory': { bpm: 120, notes: [{ step: 0, midi: 69, dur: 4 }, { step: 4, midi: 72, dur: 4 }] },
        'moth-defeat': { bpm: 120, notes: [{ step: 0, midi: 63, dur: 4 }, { step: 4, midi: 58, dur: 4 }] },
      },
    });
    const audio = new SynthAudio();
    try {
      audio.ctx = ctx; audio.noiseBuffer = {};
      audio._ensureBuses();
      audio.setSoundtrack('halo');
      audio.setMotif(mothMotif('moth-oracle'));
      assert.ok(audio.musicEngine.arrangements.results.leadMotif, 'the results scene opts into an external motif');
      audio.setOutcome('victory');
      const victory = [...audio.musicEngine.motifLead];
      assert.equal(victory.length, 2, 'the victory motif is quantised into the lead');
      assert.deepEqual(audio.musicEngine._leadFor(audio.musicEngine.arrangements.results, 0), victory, 'the results lead voices the loaded motif');
      audio.setOutcome('defeat');
      assert.notDeepEqual([...audio.musicEngine.motifLead], victory, 'defeat loads a different take');
      // The real path is the sting, which routes through setOutcome.
      audio.setMotif(mothMotif('moth-oracle'));
      assert.equal(audio.sting('victory').played, true);
      assert.deepEqual([...audio.musicEngine.motifLead], victory, 'the victory sting selects the baked motif');
      assert.ok(created.sources.length >= 0);
    } finally {
      resetMothAssets();
      audio.dispose();
    }
  });
});

test('the arena echo map retunes the shared gunfire send and reports honestly', () => {
  const { ctx } = stubContext();
  configureMothAssets({ version: 1, spaces: { arena: { lattice: 'square', sites: 24, depth: 8, seed: 1, count: 3, taps: [{ level: 0.9 }, { level: 0.5 }] } } });
  const audio = new SynthAudio();
  try {
    audio.ctx = ctx; audio.noiseBuffer = {};
    audio._ensureBuses();
    assert.ok(audio.space, 'the effects space send is built');
    assert.equal(audio.space.fb.gain.value, 0.34, 'the built-in feedback starts dry');
    assert.equal(audio.setEchoMap('arena'), 'arena');
    assert.equal(audio.echoMap, 'arena');
    assert.ok(Math.abs(audio.space.fb.gain.value - (0.25 + 8 * 0.02)) < 1e-9, 'the map depth drives the feedback tail');
    assert.equal(audio.audioStatus().echo, 'arena', 'audioStatus reports the echo map');
    // With no context the selection is still recorded for the next bus build.
    const offline = new SynthAudio();
    try {
      assert.equal(offline.setEchoMap('arena'), 'arena');
      assert.equal(offline.audioStatus().echo, 'arena');
      assert.equal(offline.space, null);
    } finally { offline.dispose(); }
  } finally {
    resetMothAssets();
    audio.dispose();
  }
});

test('SynthAudio.setMothEnabled forwards the host gate to an attached layer', () => {
  const calls = [];
  const fake = {
    setEnabled: (v) => calls.push(['enabled', v]),
    setScene: (v) => calls.push(['scene', v]),
    setIntensity: (v) => calls.push(['intensity', v]),
    setBedMood: (v) => calls.push(['mood', v]),
    status: () => ({ active: true }),
  };
  const audio = new SynthAudio();
  try {
    audio.setMothAudio(fake);
    assert.equal(audio.setMothEnabled(false), false);
    assert.equal(audio.setMothEnabled(true), true);
    assert.ok(calls.some(([name, value]) => name === 'enabled' && value === false), 'disable is forwarded');
    assert.ok(calls.some(([name, value]) => name === 'enabled' && value === true), 'enable is forwarded');
    assert.ok(calls.some(([name, value]) => name === 'scene' && value === 'menu'), 'enabling reseeds the scene');
  } finally {
    audio.dispose();
  }
});
