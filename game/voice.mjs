import {clamp01} from './math.mjs';
import {teamCallout} from './team-presentation.mjs';
const eligible = player => player?.connected === true && !player.spectate;

// ---------------------------------------------------------------------------
// Announcer callout queue.
//
// A small, bounded, disposable bus for objective/streak callouts. It mirrors the
// synth's voice cap discipline: at most `cap` callouts are live at once, a
// higher-priority callout may pre-empt a lower one, duplicates inside the
// dedupe window are dropped, and dispose() silences everything immediately.
// It is deliberately renderer/audio agnostic so the page can pump events into
// it and read the active list, and so it is unit-testable without WebAudio.
// ---------------------------------------------------------------------------
export class CalloutQueue {
 constructor({cap = 3, dedupeMs = 1500, onCallout = () => {}} = {}) {
  this.cap = Math.max(1, Math.floor(Number(cap) || 3));
  this.dedupeMs = Math.max(0, Number(dedupeMs) || 0);
  this.onCallout = onCallout;
  this.active = [];
  this.seen = new Map();
  this.disposed = false;
 }
 // Offer a match event; returns the accepted callout or null. `at` is a
 // monotonic time in ms (defaults to 0 so tests are deterministic).
 offer(event, at = 0) {
  if (this.disposed) return null;
  const callout = teamCallout(event);
  if (!callout) return null;
  const key = callout.id;
  const last = this.seen.get(key);
  if (last !== undefined && at - last < this.dedupeMs) return null;
  this.seen.set(key, at);
  // Pre-empt the lowest-priority live callout when full and this one outranks it.
  if (this.active.length >= this.cap) {
   let weakest = 0;
   for (let i = 1; i < this.active.length; i++) if (this.active[i].priority < this.active[weakest].priority) weakest = i;
   if (this.active[weakest].priority >= callout.priority) return null;
   this.active.splice(weakest, 1);
  }
  const entry = { ...callout, at };
  this.active.push(entry);
  try { this.onCallout(entry); } catch {}
  return entry;
 }
 // Offer a batch and return the accepted callouts, highest priority first.
 offerAll(events, at = 0) {
  const accepted = [];
  const ordered = [...(Array.isArray(events) ? events : [])].sort((a, b) => (teamCallout(b)?.priority ?? 0) - (teamCallout(a)?.priority ?? 0));
  for (const event of ordered) { const entry = this.offer(event, at); if (entry) accepted.push(entry); }
  return accepted;
 }
 // Drop callouts older than `ttlMs` relative to `at`.
 expire(at = 0, ttlMs = 2500) {
  if (!(ttlMs > 0)) return this.active.length;
  this.active = this.active.filter(entry => at - entry.at < ttlMs);
  return this.active.length;
 }
 clear() { this.active.length = 0; }
 dispose() {
  if (this.disposed) return;
  this.disposed = true;
  this.clear();
  this.seen.clear();
  this.onCallout = () => {};
 }
}
const stop = stream => { for (const track of stream?.getTracks() ?? []) { track.onended = null; track.stop(); } };
const disconnect = node => { try { node?.disconnect(); } catch {} };
const removeSink = sink => {
  if (!sink) return;
  sink.pause();
  sink.srcObject = null;
  sink.remove();
};

export class VoiceChat {
  constructor({net, onState = () => {}}) {
    this.net = net;
    this.onState = onState;
    this.state = {enabled: false, mode: 'ptt', status: 'off', error: '', talking: false, peers: 0};
    this.players = net.players ?? [];
    this.roomId = net.roomId;
    this.peers = new Map();
    this.generation = 0;
    this.volume = 1;
    this.threshold = .025;
    this.suppressed = false;
    this.pressed = false;
    this.lastLoud = -Infinity;
    this.audio = null;
    this.disposed = false;
    this.publish();
  }

  publish(patch = {}) {
    Object.assign(this.state, patch);
    this.onState({...this.state});
  }

  fail(error) {
    this.publish({status: 'error', error: error?.message || String(error)});
  }

  async enable(mode = 'ptt') {
    if (this.disposed) return false;
    this.setMode(mode);
    if (this.state.enabled) return true;
    if (this.audio) return false;
    this.players = this.net.players ?? [];
    this.roomId = this.net.roomId;
    if (!this.roomId || !eligible(this.players.find(p => p.peerId === this.net.peerId))) {
      this.fail(new Error('Join as a connected player to enable voice.'));
      return false;
    }
    const generation = ++this.generation;
    const audio = this.audio = {nodes: []};
    this.pressed = false;
    this.lastLoud = -Infinity;
    this.publish({status: 'requesting', error: '', talking: false});
    try {
      const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AudioContext || !globalThis.RTCPeerConnection || !globalThis.navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Voice requires a secure browser with microphone and WebRTC support.');
      }
      audio.context = new AudioContext();
      // Start resume in the gesture, but consume rejection even if capture is still pending.
      const resumed = Promise.resolve(audio.context.resume()).then(() => null, error => error);
      const stream = await navigator.mediaDevices.getUserMedia({audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      }, video: false});
      if (generation !== this.generation) { stop(stream); return false; }
      audio.stream = stream;
      const resumeError = await resumed;
      if (generation !== this.generation) return false;
      if (resumeError) throw resumeError;
      if (this.net.roomId !== this.roomId || !eligible(this.net.players?.find(p => p.peerId === this.net.peerId))) {
        this.disable();
        return false;
      }
      if (audio.context.state !== 'running') throw new Error('Voice audio is suspended. Enable voice to try again.');
      if (!stream.getAudioTracks().length) throw new Error('Microphone returned no audio track.');
      const context = audio.context;
      audio.source = context.createMediaStreamSource(stream);
      audio.nodes.push(audio.source);
      audio.analyser = context.createAnalyser();
      audio.nodes.push(audio.analyser);
      audio.analyser.fftSize = 512;
      audio.samples = new Float32Array(audio.analyser.fftSize);
      audio.gate = context.createGain();
      audio.nodes.push(audio.gate);
      audio.gate.gain.value = 0;
      audio.output = context.createMediaStreamDestination();
      audio.nodes.push(audio.output);
      audio.master = context.createGain();
      audio.nodes.push(audio.master);
      audio.master.gain.value = this.volume;
      audio.source.connect(audio.analyser);
      audio.analyser.connect(audio.gate);
      audio.gate.connect(audio.output);
      audio.master.connect(context.destination);
      context.onstatechange = () => {
        if (generation !== this.generation || context.state === 'running') return;
        this.setGate(false);
        this.fail(new Error('Voice audio is suspended. Disable and enable voice to retry.'));
      };
      for (const track of stream.getAudioTracks()) track.onended = () => {
        if (generation !== this.generation) return;
        this.disable();
        this.fail(new Error('Microphone disconnected. Enable voice to try again.'));
      };
      audio.timer = setInterval(() => {
        if (generation !== this.generation) return;
        try { this.tick(); } catch (error) { this.disable(); this.fail(error); }
      }, 25);
      this.publish({enabled: true, status: 'connecting'});
      if (await this.net.voiceState(true) === false) throw new Error('Voice could not start because the connection is closed. Reconnect and try again.');
      if (generation !== this.generation) return false;
      audio.readyTimer = setTimeout(() => {
        if (generation !== this.generation || this.players.find(p => p.peerId === this.net.peerId)?.voiceSession) return;
        this.disable();
        this.fail(new Error('The server did not enable voice. Wait 10 seconds, then try again.'));
      }, 10000);
      this.updateLobby({roomId: this.net.roomId, players: this.net.players});
      return this.state.enabled;
    } catch (error) {
      if (generation === this.generation) { this.disable(); this.fail(error); }
      return false;
    }
  }

  disable() {
    const generation = ++this.generation;
    this.pressed = false;
    this.lastLoud = -Infinity;
    this.setGate(false);
    for (const peer of this.peers.values()) this.closePeer(peer);
    const audio = this.audio;
    this.audio = null;
    if (audio) {
      clearInterval(audio.timer);
      clearTimeout(audio.readyTimer);
      stop(audio.stream);
      stop(audio.output?.stream);
      for (const node of audio.nodes) disconnect(node);
      if (audio.context) {
        audio.context.onstatechange = null;
        try { Promise.resolve(audio.context.close()).catch(() => {}); } catch {}
      }
    }
    this.snapshot = null;
    this.publish({enabled: false, talking: false, peers: 0, status: 'off', error: ''});
    try {
      Promise.resolve(this.net.voiceState(false)).catch(error => {
        if (generation === this.generation && !this.disposed) this.fail(error);
      });
    } catch (error) { if (!this.disposed) this.fail(error); }
  }

  setMode(mode) {
    if (mode !== 'ptt' && mode !== 'auto') throw new TypeError('Voice mode must be ptt or auto.');
    this.pressed = false;
    this.lastLoud = -Infinity;
    this.setGate(false);
    this.publish({mode});
  }

  setPushToTalk(pressed) {
    this.pressed = !!pressed && !this.suppressed && this.state.enabled;
    if (this.state.mode === 'ptt') this.setGate(this.pressed);
  }

  setSuppressed(suppressed) {
    this.suppressed = !!suppressed;
    this.pressed = false;
    this.lastLoud = -Infinity;
    this.setGate(false);
  }

  setVolume(value) {
    if (!Number.isFinite(value)) return;
    this.volume = clamp01(value);
    if (this.audio?.master) this.audio.master.gain.setTargetAtTime(this.volume, this.audio.context.currentTime, .03);
  }

  setThreshold(value) {
    if (Number.isFinite(value)) this.threshold = clamp01(value);
  }

  setGate(open) {
    open = !!open && this.state.enabled && !this.suppressed && this.audio?.context.state === 'running';
    if (this.audio?.gate) this.audio.gate.gain.setValueAtTime(open ? 1 : 0, this.audio.context.currentTime);
    if (this.state.talking !== open) this.publish({talking: open});
  }

  tick() {
    if (!this.state.enabled || this.suppressed) { this.setGate(false); return; }
    if (this.state.mode === 'ptt') { this.setGate(this.pressed); return; }
    const {analyser, samples} = this.audio;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const now = performance.now();
    if (Math.sqrt(sum / samples.length) > this.threshold) this.lastLoud = now;
    this.setGate(now - this.lastLoud < 200);
  }

  updateLobby(lobby) {
    const roomId = lobby?.roomId ?? this.net.roomId;
    if (roomId !== this.roomId || this.net.roomId !== this.roomId) {
      if (this.audio) this.disable();
      this.roomId = roomId;
    }
    this.players = (lobby?.players ?? this.net.players ?? []).map(p => ({...p}));
    const own = this.players.find(p => p.peerId === this.net.peerId);
    if (!eligible(own)) { if (this.audio) this.disable(); return; }
    for (const peer of this.peers.values()) if (!this.validPeer(peer)) this.closePeer(peer);
    if (!this.state.enabled || !own.voiceSession) return;
    clearTimeout(this.audio.readyTimer);
    this.peerStatus();
    for (const player of this.players) {
      if (player.peerId === own.peerId || !eligible(player) || !player.voiceSession || this.peers.has(player.peerId)) continue;
      try {
        const peer = this.createPeer(player, own.voiceSession);
        if (Number(own.peerId) < Number(player.peerId)) this.enqueue(peer, async () => {
          const offer = await peer.pc.createOffer();
          if (!this.validPeer(peer)) return;
          await peer.pc.setLocalDescription(offer);
          if (this.validPeer(peer)) await this.send(peer, {description: peer.pc.localDescription});
        });
      } catch (error) { this.fail(error); }
    }
    this.updateSpatial(this.snapshot);
  }

  validPeer(peer) {
    const own = this.players.find(p => p.peerId === this.net.peerId);
    const remote = this.players.find(p => p.peerId === peer.id);
    return this.state.enabled && this.peers.get(peer.id) === peer && this.roomId === peer.roomId &&
      this.net.roomId === peer.roomId && eligible(own) && eligible(remote) &&
      own.voiceSession === peer.localSession && remote.voiceSession === peer.session;
  }

  createPeer(player, localSession) {
    const pc = new RTCPeerConnection({iceServers: this.net.voiceIceServers ?? [{urls: 'stun:stun.l.google.com:19302'}]});
    const peer = {id: player.peerId, session: player.voiceSession, localSession, roomId: this.roomId,
      pc, queue: Promise.resolve(), candidates: [], pending: 0};
    this.peers.set(peer.id, peer);
    try {
      for (const track of this.audio.output.stream.getAudioTracks()) pc.addTrack(track, this.audio.output.stream);
      pc.onicecandidate = event => {
        if (!this.validPeer(peer)) return;
        this.enqueue(peer, () => this.send(peer, {candidate: event.candidate?.toJSON?.() ?? event.candidate}));
      };
      pc.ontrack = event => {
        if (!this.validPeer(peer) || event.track.kind !== 'audio') return;
        try {
          disconnect(peer.source);
          disconnect(peer.gain);
          removeSink(peer.sink);
          peer.sink = null;
          stop(peer.stream);
          peer.stream = new MediaStream([event.track]);
          peer.source = this.audio.context.createMediaStreamSource(peer.stream);
          peer.gain = this.audio.context.createGain();
          peer.gain.gain.value = 0;
          peer.source.connect(peer.gain);
          peer.gain.connect(this.audio.master);
          // Some browsers decode remote WebRTC audio only while a media element plays it.
          // Keep this sink muted: only the WebAudio proximity/master gains may emit sound.
          const sink = peer.sink = document.createElement('audio');
          sink.muted = true;
          sink.defaultMuted = true;
          sink.autoplay = true;
          sink.playsInline = true;
          sink.srcObject = peer.stream;
          const playbackError = error => {
            if (this.validPeer(peer) && peer.sink === sink) this.fail(new Error(
              `Voice playback for peer ${peer.id} could not start. Disable and enable voice to retry; allow audio playback in your browser. ${error?.message || ''}`));
          };
          try { Promise.resolve(sink.play()).catch(playbackError); } catch (error) { playbackError(error); }
          this.updateSpatial(this.snapshot);
        } catch (error) { this.closePeer(peer); this.fail(error); }
      };
      pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => {
        if (!this.validPeer(peer)) return;
        const states = [pc.connectionState, pc.iceConnectionState];
        if (states.includes('failed') || states.includes('closed')) {
          const ice = peer.iceError ? ` (${peer.iceError})` : '';
          this.closePeer(peer);
          this.fail(new Error(`Voice connection to peer ${peer.id} failed${ice}. Disable and enable voice to retry.`));
        } else if (states.includes('disconnected')) {
          this.fail(new Error(`Voice connection to peer ${peer.id} disconnected.`));
        } else this.peerStatus();
      };
      pc.onicecandidateerror = event => {
        // Transient candidate failures (for example a UDP TURN allocate timeout
        // while a TCP relay candidate succeeds) must not appear as a hard error.
        if (this.validPeer(peer)) peer.iceError = event?.errorText || `ICE error ${event?.errorCode ?? 'unknown'}`;
      };
      this.peerStatus();
      return peer;
    } catch (error) { this.closePeer(peer); throw error; }
  }

  peerStatus() {
    const connected = [...this.peers.values()].filter(({pc}) => pc.connectionState === 'connected' ||
      ['connected', 'completed'].includes(pc.iceConnectionState)).length;
    this.publish({peers: connected, ...(this.state.status === 'error' ? {} : {
      status: connected ? 'connected' : this.peers.size ? 'connecting' : 'ready',
    })});
  }

  enqueue(peer, operation) {
    if (++peer.pending > 128) {
      peer.pending--;
      this.closePeer(peer);
      this.fail(new Error('Voice signaling queue exceeded its limit.'));
      return Promise.resolve();
    }
    peer.queue = peer.queue.then(async () => {
      if (this.validPeer(peer)) await operation();
    }).catch(error => {
      if (this.validPeer(peer)) { this.closePeer(peer); this.fail(error); }
    }).finally(() => { peer.pending--; });
    return peer.queue;
  }

  async send(peer, payload) {
    if (!this.validPeer(peer)) return false;
    const sent = await this.net.voiceSignal(peer.id, {
      session: peer.localSession, targetSession: peer.session, ...payload,
    });
    if (sent === false) {
      this.closePeer(peer);
      this.fail(new Error('Voice signaling failed because the connection is closed or busy. Disable and enable voice to retry.'));
      return false;
    }
    return true;
  }

  // Server envelope: {roomId, from, session, targetSession, description | candidate}.
  handleSignal(msg) {
    const peer = this.peers.get(msg?.from);
    if (!peer || !this.validPeer(peer) || msg.roomId !== peer.roomId ||
      msg.session !== peer.session || msg.targetSession !== peer.localSession) return Promise.resolve();
    const description = msg.description;
    if (description) {
      const offer = description.type === 'offer';
      if ((!offer && description.type !== 'answer') || typeof description.sdp !== 'string' ||
        offer !== (Number(peer.id) < Number(this.net.peerId))) return Promise.resolve();
    } else if (!Object.hasOwn(msg, 'candidate')) return Promise.resolve();
    return this.enqueue(peer, async () => {
      if (description) {
        if (peer.pc.signalingState !== (description.type === 'offer' ? 'stable' : 'have-local-offer')) return;
        await peer.pc.setRemoteDescription(description);
        if (!this.validPeer(peer)) return;
        for (const candidate of peer.candidates.splice(0)) {
          await peer.pc.addIceCandidate(candidate);
          if (!this.validPeer(peer)) return;
        }
        if (description.type === 'offer') {
          const answer = await peer.pc.createAnswer();
          if (!this.validPeer(peer)) return;
          await peer.pc.setLocalDescription(answer);
          if (this.validPeer(peer)) await this.send(peer, {description: peer.pc.localDescription});
        }
      } else if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(msg.candidate);
      else {
        if (peer.candidates.length >= 128) throw new Error('Too many queued voice ICE candidates.');
        peer.candidates.push(msg.candidate);
      }
    });
  }

  updateSpatial(state) {
    this.snapshot = state;
    if (!this.audio?.master) return;
    const active = this.net.started && !this.net.roundOver;
    const actors = state?.actors ?? [];
    const own = this.players.find(p => p.peerId === this.net.peerId);
    const local = actors.find(a => a.id === own?.actorId);
    const alive = actor => actor && actor.health > 0 && !actor.dead &&
      [actor.x, actor.y, actor.z].every(Number.isFinite);
    for (const peer of this.peers.values()) {
      if (!peer.gain) continue;
      let gain = this.validPeer(peer) ? 1 : 0;
      if (active) {
        const player = this.players.find(p => p.peerId === peer.id);
        const remote = actors.find(a => a.id === player?.actorId);
        gain = gain && alive(local) && alive(remote) ? clamp01((30 - Math.hypot(
          local.x - remote.x, local.y - remote.y, local.z - remote.z)) / 25) : 0;
      }
      peer.gain.gain.setTargetAtTime(gain, this.audio.context.currentTime, .03);
    }
  }

  closePeer(peer) {
    if (this.peers.get(peer.id) !== peer) return;
    this.peers.delete(peer.id);
    peer.pc.onicecandidate = peer.pc.ontrack = peer.pc.onconnectionstatechange =
      peer.pc.oniceconnectionstatechange = peer.pc.onicecandidateerror = null;
    try { peer.pc.close(); } catch {}
    disconnect(peer.source);
    disconnect(peer.gain);
    removeSink(peer.sink);
    peer.sink = null;
    stop(peer.stream);
    peer.candidates.length = 0;
    peer.iceError = null;
    this.peerStatus();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.disable();
    this.onState = () => {};
  }
}
