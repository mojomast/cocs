import test from 'node:test';
import assert from 'node:assert/strict';
import {SynthAudio} from './feedback.mjs';

// Minimal Web Audio mock covering the nodes the announcer path uses.
function fixture({announcer = true} = {}) {
  const audio = new SynthAudio({announcer});
  const nodes = [];
  const param = () => ({value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {}});
  const node = extra => { const n = {frequency: param(), gain: param(), Q: param(), pan: param(), type: '', buffer: null, loop: false, connect() {}, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; }, ...extra}; nodes.push(n); return n; };
  audio.ctx = {currentTime: 1, destination: {}, createOscillator: () => node({type: 'sine'}), createGain: () => node(), createBiquadFilter: () => node({type: 'lowpass'}), createBufferSource: () => node({}), createStereoPanner: () => node(), decodeAudioData(bytes, resolve) { resolve({duration: 1.25}); }, close() {}};
  audio.noiseBuffer = {};
  audio.master = node();
  return {audio, nodes};
}

const CLIPS = [
  {cue: 'capture', file: 'capture-42.wav', seed: 42},
  {cue: 'capture', file: 'capture-137.wav', seed: 137},
  {cue: 'capture', file: 'capture-526.wav', seed: 526},
  {cue: 'victory', file: 'victory-42.wav', seed: 42},
];
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

test('the first beat uses the motif, the decoded take owns the next one', async () => {
  const {audio, nodes} = fixture();
  const fetched = [];
  audio.announcerFetch = async url => { fetched.push(url); return {ok: true, arrayBuffer: async () => new ArrayBuffer(16)}; };
  audio.loadAnnouncerPack({clips: CLIPS, base: '/audio/announcer'});
  assert.ok(audio.announcerPack, 'the pack installs synchronously from a manifest');
  const first = audio.announcerCue('capture');
  assert.equal(first.played, true);
  assert.equal(first.sampled, undefined, 'the first hearing falls back to the motif');
  await flush();
  assert.ok(fetched.some(url => url.endsWith('/capture-42.wav')), 'the take was fetched on demand');
  assert.ok(audio.announcerPack.buffers.size >= 1, 'the take decoded');
  audio.ctx.currentTime = 2;
  const second = audio.announcerCue('capture');
  assert.equal(second.played, true);
  assert.equal(second.sampled, true, 'the decoded take is played');
  assert.ok(nodes.some(n => n.buffer && n.started), 'the sampled take started through the effects bus');
  audio.dispose();
});

test('speech does not overlap: a second cue while a take is speaking is dropped', async () => {
  const {audio} = fixture();
  audio.announcerFetch = async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(16)});
  audio.loadAnnouncerPack({clips: CLIPS});
  audio.announcerCue('capture'); // kicks the decode
  await flush();
  audio.ctx.currentTime = 2;
  const played = audio.announcerCue('capture');
  assert.equal(played.sampled, true);
  audio.ctx.currentTime = 2.4;
  const busy = audio.announcerCue('victory');
  assert.equal(busy.played, false);
  assert.equal(busy.busy, true, 'the second vocal take waits instead of talking over the first');
  audio.ctx.currentTime = 6;
  const after = audio.announcerCue('victory');
  assert.equal(after.played, true, 'the next cue speaks once the previous take ended');
  audio.dispose();
});

test('fetch and decode failures keep the procedural motif without retrying forever', async () => {
  const {audio, nodes} = fixture();
  let calls = 0;
  audio.announcerFetch = async () => { calls++; throw new Error('offline'); };
  audio.loadAnnouncerPack({clips: CLIPS});
  const first = audio.announcerCue('capture');
  assert.equal(first.played, true);
  await flush();
  assert.equal(audio.announcerPack.failed.size, 3, 'every failed take is remembered');
  assert.equal(audio.announcerPack.pending.size, 0, 'no decode is left pending');
  audio.ctx.currentTime = 2;
  const second = audio.announcerCue('capture');
  assert.equal(second.played, true);
  assert.equal(second.sampled, undefined, 'the motif still covers the beat');
  const before = calls;
  audio.ctx.currentTime = 4;
  audio.announcerCue('capture');
  assert.equal(calls, before, 'a failed take is never fetched again');
  assert.ok(nodes.length > 0);
  audio.dispose();
});

test('the announcer preference and mute gate the pack exactly like the motif', async () => {
  const off = fixture({announcer: false});
  off.audio.announcerFetch = async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(16)});
  off.audio.loadAnnouncerPack({clips: CLIPS});
  off.audio.announcerCue('capture');
  await flush();
  off.audio.ctx.currentTime = 3;
  assert.equal(off.audio.announcerCue('capture').played, false, 'announcer off never speaks');
  off.audio.dispose();

  const muted = fixture();
  muted.audio.announcerFetch = async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(16)});
  muted.audio.loadAnnouncerPack({clips: CLIPS});
  muted.audio.announcerCue('capture');
  await flush();
  muted.audio.setMuted(true);
  muted.audio.ctx.currentTime = 3;
  assert.equal(muted.audio.announcerCue('capture').played, false, 'mute silences the pack');
  muted.audio.dispose();
});

test('the manifest URL installs the pack and dispose drops every decoded take', async () => {
  const {audio} = fixture();
  audio.announcerFetch = async url => {
    if (url.endsWith('manifest.json')) return {ok: true, json: async () => ({clips: CLIPS})};
    return {ok: true, arrayBuffer: async () => new ArrayBuffer(16)};
  };
  assert.equal(audio.loadAnnouncerPack(), null, 'the manifest load is asynchronous');
  await flush();
  assert.ok(audio.announcerPack, 'the fetched manifest installs the pack');
  assert.equal(audio.audioStatus().announcerVoice.loaded, true);
  audio.dispose();
  assert.equal(audio.announcerPack, null, 'dispose releases the pack');
});
