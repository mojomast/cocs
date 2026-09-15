import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceChat} from './voice.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};

function setup(t, peerId = 2) {
  const contexts = [], connections = [], timers = new Map(), captures = [], voices = [], signals = [], sinks = [];
  let now = 0, amplitude = 0, capture, resume, playback;
  class Track {
    kind = 'audio';
    stopped = false;
    stop() { this.stopped = true; }
  }
  class Stream {
    constructor(tracks = [new Track()]) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks; }
  }
  class Node {
    connections = [];
    gain = {value: 1, setValueAtTime(value) { this.value = value; },
      setTargetAtTime(value, time, smoothing) { this.value = value; this.smoothing = smoothing; }};
    connect(node) { this.connections.push(node); }
    disconnect() { this.connections = []; this.disconnected = true; }
    getFloatTimeDomainData(samples) { samples.fill(amplitude); }
  }
  class Context {
    currentTime = 0;
    state = 'running';
    destination = new Node();
    nodes = [];
    constructor() { contexts.push(this); }
    resume() { return resume?.promise ?? Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    node() { const node = new Node(); this.nodes.push(node); return node; }
    createMediaStreamSource(stream) { const node = this.node(); node.stream = stream; return node; }
    createAnalyser() { return this.node(); }
    createGain() { return this.node(); }
    createMediaStreamDestination() { const node = this.node(); node.stream = new Stream(); return node; }
  }
  class PC {
    log = [];
    signalingState = 'stable';
    connectionState = 'new';
    iceConnectionState = 'new';
    constructor(config) { this.config = config; connections.push(this); }
    addTrack(track, stream) { this.log.push('track'); this.track = track; this.stream = stream; }
    async createOffer() { this.log.push('offer'); return {type: 'offer', sdp: 'offer'}; }
    async createAnswer() { this.log.push('answer'); return {type: 'answer', sdp: 'answer'}; }
    async setLocalDescription(description) {
      this.log.push(`local:${description.type}`);
      this.localDescription = description;
      this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    }
    async setRemoteDescription(description) {
      this.log.push(`remote:${description.type}`);
      this.remoteDescription = description;
      this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
    }
    async addIceCandidate(candidate) { this.log.push(`ice:${candidate?.candidate ?? 'end'}`); }
    close() { this.closed = true; }
  }
  const globals = {AudioContext: Context, RTCPeerConnection: PC, MediaStream: Stream,
    document: {createElement(tag) {
      assert.equal(tag, 'audio');
      const sink = {muted: false, autoplay: false, playsInline: false, srcObject: null,
        play() {
          this.played = true;
          assert.equal(this.muted, true);
          assert.equal(this.autoplay, true);
          assert.equal(this.playsInline, true);
          assert.ok(this.srcObject instanceof Stream);
          return playback?.promise ?? Promise.resolve();
        },
        pause() { this.paused = true; },
        remove() { this.removed = true; }};
      sinks.push(sink);
      return sink;
    }},
    navigator: {mediaDevices: {getUserMedia(constraints) {
      captures.push(constraints);
      return capture?.promise ?? Promise.resolve(new Stream());
    }}}, performance: {now: () => now},
    setInterval(callback) { const id = Symbol(); timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); }};
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  const net = {peerId, roomId: 'room', started: false, roundOver: true,
    players: [1, 2].map(id => ({peerId: id, actorId: id + 10, connected: true, spectate: false, voiceSession: `session-${id}`})),
    voiceState(value) { voices.push(value); },
    voiceSignal(to, payload) { signals.push({to, ...payload}); }};
  const states = [];
  const voice = new VoiceChat({net, onState: state => states.push(state)});
  t.after(() => voice.dispose());
  return {voice, net, contexts, connections, captures, voices, signals, timers, states, Stream, sinks,
    playback(value) { playback = value; },
    capture(value) { capture = value; }, resume(value) { resume = value; },
    tick(value, advance = 25) { amplitude = value; now += advance; for (const callback of timers.values()) callback(); },
    signal(payload = {}) { return voice.handleSignal({roomId: 'room', from: peerId === 1 ? 2 : 1,
      session: `session-${peerId === 1 ? 2 : 1}`, targetSession: `session-${peerId}`, ...payload}); },
    async settle() { for (const peer of voice.peers.values()) await peer.queue; },
  };
}

test('off is inert; explicit enable captures processed audio without local monitoring', async t => {
  const h = setup(t);
  h.voice.updateLobby({players: h.net.players});
  h.voice.setPushToTalk(true);
  await h.signal({description: {type: 'offer', sdp: 'ignored'}});
  assert.equal(h.captures.length, 0);
  assert.deepEqual(h.states[0], {enabled: false, mode: 'ptt', status: 'off', error: '', talking: false, peers: 0});
  assert.equal(await h.voice.enable(), true);
  assert.deepEqual(h.captures[0], {audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});
  const a = h.voice.audio;
  assert.equal(a.gate.gain.value, 0);
  assert.deepEqual(a.source.connections, [a.analyser]);
  assert.deepEqual(a.analyser.connections, [a.gate]);
  assert.deepEqual(a.gate.connections, [a.output]);
  assert.deepEqual(a.output.connections, []);
  assert.deepEqual(a.master.connections, [a.context.destination]);
  assert.equal(h.connections[0].track, a.output.stream.getAudioTracks()[0]);
  assert.notEqual(h.connections[0].track, a.stream.getAudioTracks()[0]);
  assert.deepEqual(h.voices, [true]);
});

test('PTT, mode changes and suppression close instantly without stuck keys', async t => {
  const h = setup(t);
  await h.voice.enable();
  h.voice.setPushToTalk(true);
  assert.equal(h.voice.audio.gate.gain.value, 1);
  h.voice.setSuppressed(true);
  assert.equal(h.voice.audio.gate.gain.value, 0);
  h.voice.setPushToTalk(true);
  h.tick(.5);
  assert.equal(h.voice.state.talking, false);
  h.voice.setSuppressed(false);
  h.tick(.5);
  assert.equal(h.voice.state.talking, false);
  h.voice.setPushToTalk(true);
  h.voice.setMode('auto');
  assert.equal(h.voice.state.talking, false);
  h.tick(.1);
  assert.equal(h.voice.state.talking, true);
  h.voice.setSuppressed(true);
  assert.equal(h.voice.audio.gate.gain.value, 0);
  h.voice.setSuppressed(false);
  h.tick(0);
  assert.equal(h.voice.state.talking, false);
  h.voice.setMode('ptt');
  h.tick(.1);
  assert.equal(h.voice.state.talking, false);
});

test('pre-gate RMS VAD uses independent timer, threshold and 200ms release', async t => {
  const h = setup(t);
  await h.voice.enable('auto');
  assert.equal(h.voice.state.talking, false);
  h.tick(.02);
  assert.equal(h.voice.state.talking, false);
  h.tick(.03);
  assert.equal(h.voice.state.talking, true);
  h.tick(0, 199);
  assert.equal(h.voice.state.talking, true);
  h.tick(0, 1);
  assert.equal(h.voice.state.talking, false);
  h.voice.setThreshold(.1);
  h.tick(.05);
  assert.equal(h.voice.state.talking, false);
  h.voice.setThreshold(2);
  assert.equal(h.voice.threshold, 1);
  h.voice.setVolume(-2);
  assert.equal(h.voice.audio.master.gain.value, 0);
  h.voice.setVolume(.4);
  assert.equal(h.voice.audio.master.gain.value, .4);
});

test('only lower numeric peer offers, with track first and configured TURN', async t => {
  const h = setup(t, 1);
  h.net.players[1].peerId = 10;
  h.net.voiceIceServers = [{urls: 'turn:relay.example', username: 'u', credential: 'p'}];
  await h.voice.enable();
  await h.settle();
  assert.deepEqual(h.connections[0].config.iceServers, h.net.voiceIceServers);
  assert.deepEqual(h.connections[0].log, ['track', 'offer', 'local:offer']);
  assert.deepEqual(h.signals[0], {to: 10, session: 'session-1', targetSession: 'session-2', description: {type: 'offer', sdp: 'offer'}});
});

test('responder queues ICE until serialized remote description and adds track before answer', async t => {
  const h = setup(t);
  await h.voice.enable();
  assert.deepEqual(h.connections[0].log, ['track']);
  assert.match(h.connections[0].config.iceServers[0].urls, /^stun:/);
  await h.signal({candidate: {candidate: 'first'}});
  const offer = h.signal({description: {type: 'offer', sdp: 'remote'}});
  const ice = h.signal({candidate: {candidate: 'second'}});
  await Promise.all([offer, ice]);
  assert.deepEqual(h.connections[0].log, ['track', 'remote:offer', 'ice:first', 'answer', 'local:answer', 'ice:second']);
  await h.signal({candidate: null});
  assert.equal(h.connections[0].log.at(-1), 'ice:end');
  assert.equal(h.signals[0].description.type, 'answer');
  h.connections[0].onicecandidate({candidate: {toJSON: () => ({candidate: 'outgoing'})}});
  await h.settle();
  assert.deepEqual(h.signals.at(-1).candidate, {candidate: 'outgoing'});
});

test('signaling rejects wrong room, membership, sessions and offer direction', async t => {
  const h = setup(t);
  await h.voice.enable();
  for (const patch of [{roomId: 'other'}, {from: 99}, {session: 'old'}, {targetSession: 'old'},
    {description: {type: 'answer', sdp: 'wrong direction'}}]) {
    await h.signal({description: {type: 'offer', sdp: 'remote'}, ...patch});
  }
  assert.deepEqual(h.connections[0].log, ['track']);
  h.net.players = h.net.players.map(p => p.peerId === 1 ? {...p, voiceSession: 'replacement'} : p);
  h.voice.updateLobby({players: h.net.players});
  assert.equal(h.connections[0].closed, true);
  await h.signal({candidate: {candidate: 'stale'}});
  assert.deepEqual(h.connections[1].log, ['track']);
  h.net.players[0].spectate = true;
  h.voice.updateLobby({players: h.net.players});
  assert.equal(h.connections[1].closed, true);
  assert.equal(h.voice.peers.size, 0);
});

test('proximity uses actorId, match flags, distances and dead/missing actors', async t => {
  const h = setup(t);
  await h.voice.enable();
  const pc = h.connections[0];
  pc.ontrack({track: new h.Stream().getAudioTracks()[0]});
  const peer = h.voice.peers.get(1);
  assert.equal(peer.gain.gain.value, 1);
  assert.deepEqual(peer.gain.connections, [h.voice.audio.master]);
  h.net.started = true;
  h.net.roundOver = false;
  h.voice.updateSpatial(null);
  assert.equal(peer.gain.gain.value, 0);
  const local = {id: 12, x: 0, y: 0, z: 0, health: 100, dead: 0};
  const remote = {id: 11, x: 5, y: 0, z: 0, health: 100, dead: 0};
  const state = {actors: [remote, local]};
  for (const [distance, expected] of [[0, 1], [5, 1], [17.5, .5], [30, 0], [50, 0]]) {
    remote.x = distance;
    h.voice.updateSpatial(state);
    assert.equal(peer.gain.gain.value, expected);
  }
  remote.x = 0;
  remote.health = 0;
  h.voice.updateSpatial(state);
  assert.equal(peer.gain.gain.value, 0);
  remote.health = 100;
  local.dead = 1;
  h.voice.updateSpatial(state);
  assert.equal(peer.gain.gain.value, 0);
  local.dead = 0;
  h.voice.updateSpatial({actors: [remote]});
  assert.equal(peer.gain.gain.value, 0);
  h.net.roundOver = true;
  h.voice.updateSpatial(null);
  assert.equal(peer.gain.gain.value, 1);
  assert.equal(peer.gain.gain.smoothing, .03);
});

test('disable cleans tracks, graphs, RTC, context and timer; disposed cannot capture', async t => {
  const h = setup(t);
  await h.voice.enable();
  const audio = h.voice.audio, pc = h.connections[0], remote = new h.Stream().getAudioTracks()[0];
  pc.ontrack({track: remote});
  h.voice.setPushToTalk(true);
  h.voice.disable();
  assert.equal(audio.gate.gain.value, 0);
  assert.equal(audio.context.closed, true);
  assert.equal(audio.stream.getTracks()[0].stopped, true);
  assert.equal(audio.output.stream.getTracks()[0].stopped, true);
  assert.equal(remote.stopped, true);
  assert.ok(audio.context.nodes.every(node => node.disconnected));
  assert.equal(pc.closed, true);
  assert.equal(pc.ontrack, null);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.voices, [true, false]);
  h.voice.dispose();
  assert.equal(await h.voice.enable(), false);
  assert.equal(h.captures.length, 1);
});

test('late capture from disabled generation is stopped without affecting newer enable', async t => {
  const h = setup(t), pending = deferred();
  h.capture(pending);
  const first = h.voice.enable();
  h.voice.disable();
  h.capture(null);
  assert.equal(await h.voice.enable(), true);
  const late = new h.Stream();
  pending.resolve(late);
  assert.equal(await first, false);
  assert.equal(late.getTracks()[0].stopped, true);
  assert.equal(h.voice.state.enabled, true);
  assert.deepEqual(h.voices, [false, true]);
  assert.equal(h.contexts[0].closed, true);
});

test('disable during context resume cleans capture and never announces ready', async t => {
  const h = setup(t), pending = deferred();
  h.resume(pending);
  const enabling = h.voice.enable();
  await Promise.resolve();
  const audio = h.voice.audio;
  h.voice.disable();
  pending.resolve();
  assert.equal(await enabling, false);
  assert.equal(audio.stream.getTracks()[0].stopped, true);
  assert.deepEqual(h.voices, [false]);
  assert.equal(h.timers.size, 0);
});

test('permission failure surfaces error and permits retry without touching text chat', async t => {
  const h = setup(t), pending = deferred();
  h.capture(pending);
  h.net.chat = () => 'text still works';
  const enabling = h.voice.enable();
  pending.reject(new Error('Permission denied'));
  assert.equal(await enabling, false);
  assert.equal(h.voice.state.enabled, false);
  assert.match(h.voice.state.error, /Permission denied/);
  assert.equal(h.contexts[0].closed, true);
  assert.equal(h.net.chat(), 'text still works');
  h.capture(null);
  assert.equal(await h.voice.enable(), true);
});

test('ICE failure and rejected signaling are handled and visible', async t => {
  const h = setup(t);
  await h.voice.enable();
  const pc = h.connections[0];
  pc.iceConnectionState = 'connected';
  pc.oniceconnectionstatechange();
  assert.equal(h.voice.state.peers, 1);
  pc.onicecandidateerror({errorText: 'TURN allocate request timed out'});
  assert.equal(h.voice.state.error, '', 'transient candidate errors stay quiet while connected');
  assert.equal(h.voice.state.status, 'connected');
  pc.iceConnectionState = 'disconnected';
  pc.oniceconnectionstatechange();
  assert.match(h.voice.state.error, /disconnected/);
  pc.iceConnectionState = 'failed';
  pc.oniceconnectionstatechange();
  assert.equal(pc.closed, true);
  assert.equal(h.voice.state.peers, 0);
  assert.match(h.voice.state.error, /failed/);
  assert.match(h.voice.state.error, /TURN allocate request timed out/, 'failed connection keeps relay context');
  h.voice.updateLobby({players: h.net.players});
  h.net.voiceSignal = async () => { throw new Error('Signal failed'); };
  await h.signal({description: {type: 'offer', sdp: 'offer'}});
  assert.match(h.voice.state.error, /Signal failed/);
  assert.equal(h.connections[1].closed, true);
});

test('room departure and becoming spectator stop capture, not just peer playback', async t => {
  const h = setup(t);
  await h.voice.enable();
  const stream = h.voice.audio.stream;
  h.net.roomId = 'elsewhere';
  h.voice.updateLobby({roomId: 'elsewhere', players: h.net.players});
  assert.equal(stream.getTracks()[0].stopped, true);
  assert.equal(h.voice.state.enabled, false);
  h.net.players[1].spectate = true;
  assert.equal(await h.voice.enable(), false);
  assert.equal(h.captures.length, 1);
});

test('replacement during remote description prevents stale answers', async t => {
  const h = setup(t), pending = deferred();
  await h.voice.enable();
  h.connections[0].setRemoteDescription = () => pending.promise;
  const signal = h.signal({description: {type: 'offer', sdp: 'offer'}});
  await Promise.resolve();
  h.net.players[0].voiceSession = 'replacement';
  h.voice.updateLobby({players: h.net.players});
  pending.resolve();
  await signal;
  assert.equal(h.signals.length, 0);
  assert.equal(h.connections[0].closed, true);
});

test('initiator serializes answer and queued ICE, ignoring duplicate descriptions', async t => {
  const h = setup(t, 1);
  await h.voice.enable();
  await h.settle();
  await h.signal({candidate: {candidate: 'early'}});
  await h.signal({description: {type: 'offer', sdp: 'wrong initiator'}});
  await h.signal({description: {type: 'answer', sdp: 'answer'}});
  await h.signal({description: {type: 'answer', sdp: 'duplicate'}});
  assert.deepEqual(h.connections[0].log, ['track', 'offer', 'local:offer', 'remote:answer', 'ice:early']);
});

test('room change during permission prompt cannot announce voice in the new room', async t => {
  const h = setup(t), pending = deferred();
  h.capture(pending);
  const enabling = h.voice.enable();
  h.net.roomId = 'new-room';
  const stream = new h.Stream();
  pending.resolve(stream);
  assert.equal(await enabling, false);
  assert.equal(stream.getTracks()[0].stopped, true);
  assert.deepEqual(h.voices, [false]);
});

test('local session replacement closes peers and reconnects with new session tags', async t => {
  const h = setup(t);
  await h.voice.enable();
  h.net.players[1].voiceSession = 'new-local';
  h.voice.updateLobby({players: h.net.players});
  assert.equal(h.connections[0].closed, true);
  await h.signal({description: {type: 'offer', sdp: 'stale'}});
  assert.equal(h.signals.length, 0);
  await h.signal({targetSession: 'new-local', description: {type: 'offer', sdp: 'valid'}});
  assert.equal(h.signals[0].session, 'new-local');
});

test('microphone ending shuts down capture and suspended context cannot open gate', async t => {
  const h = setup(t);
  await h.voice.enable();
  const audio = h.voice.audio;
  h.voice.setPushToTalk(true);
  audio.context.state = 'suspended';
  audio.context.onstatechange();
  h.tick(.5);
  assert.equal(audio.gate.gain.value, 0);
  assert.match(h.voice.state.error, /suspended/);
  audio.stream.getTracks()[0].onended();
  assert.equal(h.voice.state.enabled, false);
  assert.match(h.voice.state.error, /Microphone disconnected/);
  assert.equal(h.timers.size, 0);
});

test('resume rejection is consumed while permission is pending and cleans late capture', async t => {
  const h = setup(t), capture = deferred(), resume = deferred();
  h.capture(capture);
  h.resume(resume);
  const enabling = h.voice.enable();
  resume.reject(new Error('Resume rejected'));
  await new Promise(resolve => setImmediate(resolve));
  const stream = new h.Stream();
  capture.resolve(stream);
  assert.equal(await enabling, false);
  assert.match(h.voice.state.error, /Resume rejected/);
  assert.equal(stream.getTracks()[0].stopped, true);
  assert.equal(h.contexts[0].closed, true);
});

test('a rejected voice signal closes the peer and surfaces the failure', async t => {
  const h = setup(t);
  await h.voice.enable();
  h.net.voiceSignal = () => false;
  h.connections[0].onicecandidate({candidate: {toJSON: () => ({candidate: 'outgoing'})}});
  await h.settle();
  assert.equal(h.connections[0].closed, true);
  assert.equal(h.voice.peers.size, 0);
  assert.equal(h.voice.state.status, 'error');
  assert.match(h.voice.state.error, /Voice signaling failed/);
});

test('unbounded pre-description ICE is rejected and peer resources are closed', async t => {
  const h = setup(t);
  await h.voice.enable();
  for (let i = 0; i < 129; i++) await h.signal({candidate: {candidate: String(i)}});
  assert.equal(h.voice.peers.size, 0);
  assert.equal(h.connections[0].closed, true);
  assert.match(h.voice.state.error, /Too many queued/);
});

test('remote decoder sink plays muted while sound remains on the proximity/master chain', async t => {
  const h = setup(t);
  await h.voice.enable();
  assert.equal(h.sinks.length, 0);
  h.connections[0].ontrack({track: new h.Stream().getAudioTracks()[0]});
  const peer = h.voice.peers.get(1), sink = h.sinks[0];
  assert.equal(peer.sink, sink);
  assert.equal(sink.srcObject, peer.stream);
  assert.equal(sink.played, true);
  assert.equal(sink.defaultMuted, true);
  assert.deepEqual(peer.source.connections, [peer.gain]);
  assert.deepEqual(peer.gain.connections, [h.voice.audio.master]);
  h.voice.setVolume(0);
  h.net.started = true;
  h.net.roundOver = false;
  h.voice.updateSpatial(null);
  assert.equal(peer.gain.gain.value, 0);
  assert.equal(h.voice.audio.master.gain.value, 0);
  assert.equal(sink.muted, true);
});

test('track replacement cleans old sink and ignores its late playback rejection', async t => {
  const h = setup(t), pending = deferred();
  h.playback(pending);
  await h.voice.enable();
  const pc = h.connections[0], oldTrack = new h.Stream().getAudioTracks()[0];
  pc.ontrack({track: oldTrack});
  const old = h.sinks[0];
  h.playback(null);
  pc.ontrack({track: new h.Stream().getAudioTracks()[0]});
  assert.equal(old.paused, true);
  assert.equal(old.srcObject, null);
  assert.equal(old.removed, true);
  assert.equal(oldTrack.stopped, true);
  assert.equal(h.voice.peers.get(1).sink, h.sinks[1]);
  pending.reject(new Error('Old playback aborted'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.voice.state.error, '');
});

test('current sink playback rejection is consumed and surfaces actionable error', async t => {
  const h = setup(t), pending = deferred();
  h.playback(pending);
  await h.voice.enable();
  h.connections[0].ontrack({track: new h.Stream().getAudioTracks()[0]});
  pending.reject(new Error('Autoplay blocked'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.voice.state.status, 'error');
  assert.match(h.voice.state.error, /Disable and enable voice/);
  assert.match(h.voice.state.error, /Autoplay blocked/);
  assert.equal(h.sinks[0].muted, true);
  assert.equal(h.voice.state.enabled, true);
});

for (const lifecycle of ['session replacement', 'departure', 'disable', 'dispose']) {
  test(`${lifecycle} removes sink and ignores pending playback failure`, async t => {
    const h = setup(t), pending = deferred();
    h.playback(pending);
    await h.voice.enable();
    h.connections[0].ontrack({track: new h.Stream().getAudioTracks()[0]});
    const peer = h.voice.peers.get(1), sink = h.sinks[0];
    if (lifecycle === 'session replacement') {
      h.net.players[0].voiceSession = 'replacement';
      h.voice.updateLobby({players: h.net.players});
    } else if (lifecycle === 'departure') {
      h.net.players = h.net.players.filter(p => p.peerId !== 1);
      h.voice.updateLobby({players: h.net.players});
    } else h.voice[lifecycle]();
    assert.equal(sink.paused, true);
    assert.equal(sink.srcObject, null);
    assert.equal(sink.removed, true);
    assert.equal(peer.sink, null);
    const count = h.states.length;
    pending.reject(new Error('Playback aborted after cleanup'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.states.length, count);
    assert.equal(h.voice.state.error, '');
  });
}

import {CalloutQueue} from './voice.mjs';

test('CalloutQueue caps live callouts, dedupes by id and pre-empts weaker cues',()=>{
 const seen=[];
 const queue=new CalloutQueue({cap:2,dedupeMs:1000,onCallout:entry=>seen.push(entry.id)});
 assert.ok(queue.offer({type:'flag-drop'},0));
 assert.equal(queue.offer({type:'flag-drop'},500),null,'a duplicate inside the window is dropped');
 assert.ok(queue.offer({type:'capture'},600));
 assert.equal(queue.active.length,2);
 const preempt=queue.offer({type:'payload-delivered'},700);
 assert.ok(preempt,'a higher-priority cue pre-empts the weakest live one');
 assert.equal(queue.active.length,2);
 assert.deepEqual(seen,['flag-drop','capture','payload-delivered']);
 assert.equal(queue.offer({type:'victory'},800).priority,5);
 queue.expire(5000,2500);
 assert.equal(queue.active.length,0,'stale callouts expire');
});

test('CalloutQueue disposes cleanly and ignores later offers',()=>{
 const queue=new CalloutQueue({cap:2});
 queue.offer({type:'capture'},0);
 queue.dispose();
 assert.equal(queue.disposed,true);
 assert.equal(queue.active.length,0);
 assert.equal(queue.offer({type:'victory'},10),null,'a disposed queue accepts nothing');
 queue.dispose();
});
