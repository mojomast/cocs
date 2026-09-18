import test from 'node:test';
import assert from 'node:assert/strict';
import { MothAudioBank, MothAudio, MOTH_SCENE_BEDS, MOTH_MOOD_BEDS, MOTH_WEATHER_BEDS } from './moth-audio.mjs';
import { configureMothAssets, resetMothAssets } from './moth-assets.mjs';
import { SynthAudio } from './feedback.mjs';

// Minimal Web Audio mock: every created node records connects/starts/stops so
// the player's graph and disposal can be asserted without a browser.
function stubContext({ failDecode = false } = {}) {
  const created = { sources: [], gains: [], panners: [], delays: [] };
  const ctx = {
    currentTime: 0,
    state: 'running',
    sampleRate: 22050,
    createBufferSource() {
      const node = { buffer: null, loop: false, loopStart: 0, loopEnd: 0, started: false, stopped: false, connected: false, disconnected: false, start() { this.started = true; }, stop() { this.stopped = true; }, connect() { this.connected = true; }, disconnect() { this.disconnected = true; } };
      created.sources.push(node);
      return node;
    },
    createGain() {
      const node = { gain: { value: 1, setTargetAtTime(v) { this.value = v; } }, connected: false, disconnected: false, connect() { this.connected = true; }, disconnect() { this.disconnected = true; } };
      created.gains.push(node);
      return node;
    },
    createStereoPanner() {
      const node = { pan: { value: 0 }, disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
      created.panners.push(node);
      return node;
    },
    createDelay() {
      const node = { delayTime: { value: 0 }, disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
      created.delays.push(node);
      return node;
    },
    decodeAudioData(bytes, ok, err) {
      if (failDecode) { err?.(new Error('decode failed')); return; }
      ok?.({ duration: 12, length: 12 * 22050, numberOfChannels: 1, sampleRate: 22050, getChannelData: () => new Float32Array(8) });
    },
  };
  return { ctx, created };
}

const fetchOk = () => async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
const fetchFail = () => async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });

const DESCRIPTORS = {
  a: { url: '/moth/files/a/clip.wav', seconds: 4, loopStart: 0.5, loopEnd: 3.5 },
  b: { url: '/moth/files/b/clip.wav', seconds: 4 },
  c: { url: '/moth/files/c/clip.wav', seconds: 4 },
  d: { url: '/moth/files/d/clip.wav', seconds: 4 },
  sting: { url: '/moth/files/sting/clip.wav', seconds: 0.4 },
  inverted: { url: '/moth/files/inverted/clip.wav', seconds: 4, loopStart: 3, loopEnd: 1 },
};

function makeBank(overrides = {}) {
  const { ctx } = overrides;
  return new MothAudioBank({ ctx, resolve: (name) => DESCRIPTORS[name] || null, fetchImpl: fetchOk(), ...overrides });
}

test('the bank and player are inert without an AudioContext', async () => {
  const bank = new MothAudioBank();
  assert.equal(bank.enabled, false);
  assert.equal(bank.state('a'), 'unsupported');
  assert.equal(await bank.preload('a'), null, 'preload resolves null without a context');
  assert.deepEqual(bank.status().ready, 0);

  const audio = new MothAudio({ bank });
  assert.equal(audio.enabled, false);
  assert.equal(audio.playBed('a'), false);
  assert.equal(audio.playStinger('a'), false);
  assert.equal(audio.setSpace('arena'), null);
  assert.equal(audio.status().active, false);
  assert.deepEqual(audio.status().beds, []);
});

test('clips decode lazily, cache, and remember failures', async () => {
  const { ctx } = stubContext();
  const bank = makeBank({ ctx });
  assert.equal(bank.state('a'), 'idle');
  const buffer = await bank.preload('a');
  assert.ok(buffer, 'a decodable clip becomes ready');
  assert.equal(bank.state('a'), 'ready');
  assert.equal(await bank.preload('a'), buffer, 'the decoded buffer is cached');
  assert.equal(bank.status().ready, 1);

  const failing = new MothAudioBank({ ctx, resolve: (name) => DESCRIPTORS[name] || null, fetchImpl: fetchFail() });
  assert.equal(await failing.preload('a'), null);
  assert.equal(failing.state('a'), 'failed');
  assert.equal(await failing.preload('a'), null, 'a failed clip is latched, not retried');
  assert.equal(failing.status().failed, 1);
});

test('loop windows clamp to the clip and fall back to the whole buffer', async () => {
  const { ctx } = stubContext();
  const bank = makeBank({ ctx });
  await bank.preloadGroup(['a', 'inverted']);
  assert.deepEqual(bank.loopWindow('a'), { start: 0.5, end: 3.5, duration: 12 });
  assert.deepEqual(bank.loopWindow('inverted'), { start: 0, end: 12, duration: 12 }, 'an inverted window falls back to the full clip');
  assert.deepEqual(bank.loopWindow('missing'), { start: 0, end: 0, duration: 0 });
});

test('the decoded-bytes budget evicts the oldest buffer first', async () => {
  const { ctx } = stubContext();
  const perBuffer = 12 * 22050 * 4;
  const bank = makeBank({ ctx, maxBytes: perBuffer * 2 });
  await bank.preloadGroup(['a', 'b', 'c']);
  const status = bank.status();
  assert.equal(status.ready, 2);
  assert.equal(status.evictions, 1);
  assert.equal(status.active, true);
});

test('the player keeps at most maxBeds looped beds and honours loop points', async () => {
  const { ctx, created } = stubContext();
  const bank = makeBank({ ctx });
  await bank.preloadGroup(['a', 'b', 'c', 'd']);
  const audio = new MothAudio({ ctx, bank, destinations: { ambience: ctx.createGain() }, maxBeds: 3 });
  assert.equal(audio.playBed('a'), true);
  assert.equal(audio.playBed('b'), true);
  assert.equal(audio.playBed('c'), true);
  assert.equal(audio.playBed('d'), true);
  assert.deepEqual(audio.status().beds, ['b', 'c', 'd'], 'the oldest bed is evicted');
  assert.ok(created.sources.some((source) => source.stopped === true), 'the evicted bed was stopped');
  const bed = created.sources.find((source) => source.buffer && source.started && source.loop);
  assert.equal(bed.loopStart, 0.5);
  assert.equal(bed.loopEnd, 3.5);
  audio.dispose();
  assert.equal(audio.status().active, false);
});

test('scene, intensity, mood and weather select beds deterministically', async () => {
  const { ctx } = stubContext();
  const bank = makeBank({ ctx });
  const audio = new MothAudio({ ctx, bank, destinations: { ambience: ctx.createGain() } });
  assert.equal(audio.setScene('game'), 'game');
  assert.deepEqual(audio.desiredBeds(), [MOTH_SCENE_BEDS.explore]);
  audio.setIntensity(1);
  assert.deepEqual(audio.desiredBeds(), [MOTH_SCENE_BEDS.combat]);
  audio.setBedMood('storm');
  assert.deepEqual(audio.desiredBeds(), [MOTH_SCENE_BEDS.combat, MOTH_MOOD_BEDS.storm]);
  audio.setWeather('ash');
  const expected = [MOTH_SCENE_BEDS.combat, MOTH_MOOD_BEDS.storm, MOTH_WEATHER_BEDS.ash];
  assert.deepEqual(audio.desiredBeds(), expected);
  assert.equal(audio.setWeather('bogus'), null);
  assert.deepEqual(audio.desiredBeds(), [MOTH_SCENE_BEDS.combat, MOTH_MOOD_BEDS.storm], 'an unknown weather kind clears the weather bed');
  const again = new MothAudio({ ctx, bank, destinations: { ambience: ctx.createGain() } });
  again.setScene('game'); again.setIntensity(1); again.setBedMood('storm'); again.setWeather('ash');
  assert.deepEqual(again.desiredBeds(), expected, 'routing never uses randomness');
});

test('stingers are one-shots that tick() prunes when finished', async () => {
  const { ctx } = stubContext();
  const bank = makeBank({ ctx });
  await bank.preload('sting');
  const audio = new MothAudio({ ctx, bank, destinations: { effects: ctx.createGain() } });
  assert.equal(audio.playStinger('sting', { pan: 0.5, duck: 1 }), true);
  assert.equal(audio.status().stingers, 1);
  ctx.currentTime = 20;
  assert.equal(audio.tick(), 1);
  assert.equal(audio.status().stingers, 0);
});

test('reduced motion disables the bank and the player', () => {
  const { ctx } = stubContext();
  const bank = makeBank({ ctx, reducedMotion: true });
  assert.equal(bank.enabled, false);
  const audio = new MothAudio({ ctx, bank, destinations: { ambience: ctx.createGain() }, reducedMotion: true });
  assert.equal(audio.enabled, false);
  assert.equal(audio.playBed('a'), false);
});

test('setSpace reads a baked echo map and owns its delay graph', () => {
  const { ctx, created } = stubContext();
  const bank = makeBank({ ctx });
  const audio = new MothAudio({ ctx, bank, destinations: { effects: ctx.createGain() } });
  configureMothAssets({ version: 1, spaces: { arena: { lattice: 'square', sites: 20, depth: 8, seed: 12345, count: 2, taps: [{ site: 0, depth: 4, level: 0.9, timeMs: 120 }, { site: 1, depth: 5, level: 0.5 }] } } });
  try {
    const space = audio.setSpace('arena');
    assert.equal(space.name, 'arena');
    assert.equal(space.count, 2);
    assert.ok(Math.abs(space.delay - 0.12) < 1e-9, 'the first tap time seeds the delay');
    assert.equal(audio.spaceGraph !== null, true, 'a delay graph is built when the context supports one');
    assert.equal(created.delays.length, 1);
    assert.equal(audio.setSpace('missing'), null);
  } finally {
    resetMothAssets();
    audio.dispose();
  }
});

test('SynthAudio forwards its state to an attached Moth layer and stays guarded', () => {
  const calls = [];
  const fake = {
    setScene: (v) => calls.push(['scene', v]),
    setIntensity: (v) => calls.push(['intensity', v]),
    setBedMood: (v) => calls.push(['mood', v]),
    tick: () => calls.push(['tick']),
    dispose: () => calls.push(['dispose']),
    status: () => ({ active: true }),
  };
  const audio = new SynthAudio();
  assert.equal(audio.mothAudioStatus(), null, 'no layer attached is a no-op');
  audio.setIntensity(0.6); // no layer yet
  audio.setMothAudio(fake);
  assert.equal(calls[0][0], 'scene', 'attaching seeds the current scene');
  audio.setScene('game');
  audio.setIntensity(0.9);
  audio.setBedMood('hot');
  audio.tick();
  assert.deepEqual(audio.audioStatus().moth, { active: true });
  assert.ok(calls.some(([name, value]) => name === 'scene' && value === 'game'), 'scene changes are forwarded');
  assert.ok(calls.some(([name, value]) => name === 'intensity' && value === 0.9), 'intensity changes are forwarded');
  assert.ok(calls.some(([name, value]) => name === 'mood' && value === 'hot'), 'bed mood changes are forwarded');
  assert.ok(calls.some(([name]) => name === 'tick'), 'tick is forwarded');
  audio.setMothAudio(null);
  assert.equal(audio.mothAudioStatus(), null);
  audio.dispose();
});
