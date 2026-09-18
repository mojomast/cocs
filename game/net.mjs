import {getMap} from './maps.mjs';
import {Match} from './core.mjs';
import {RULES} from './data.mjs';
import {clamp, lerp} from './math.mjs';
import {MESSAGE, PROTOCOL_VERSION, SNAPSHOT_DELTA_VERSION, SNAPSHOT_DELTA_MIN_BYTES, validPlayerId, validProgressToken, snapshotDelta, applySnapshotDelta, wireSize, BandwidthMeter} from './protocol.mjs';

export const DEFAULT_SERVER_URL = 'ws://localhost:4000';
const createPlayerId=()=>{try{return globalThis.crypto?.randomUUID?.()??`p-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;}catch{return `p-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;}};
const createProgressToken=()=>{let token=createPlayerId();while(token.length<32)token+=createPlayerId().replace(/^p-/,'');return token.slice(0,64);};
const RENDER_DELAY_DEFAULT = 100;
const RENDER_DELAY_MIN = 90;
const RENDER_DELAY_MAX = 160;
const BUFFER_MIN = 4;
const BUFFER_MAX = 16;
const JITTER_REF = 50;
const turn = (a, b) => ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const VEHICLE_MODES = new Set(['puma-race', 'puma-soccer']);
const isVehicleMode = mode => VEHICLE_MODES.has(mode);
// How long a client keeps a sent snapshot as a delta base before falling back
// to full snapshots. Bounded so the base map cannot grow without limit.
const DELTA_HISTORY = 64;

// Pure entity interpolation shared by the live render path and the test
// harness. Given two authoritative snapshots and an alpha in [0,1], returns a
// new state with actors, rockets and vehicles blended. The local actor is never
// interpolated when `localId` is supplied and the shadow owns it, so prediction
// stays authoritative for the player's own body. Angles take the shortest arc.
export function interpolateSnapshots(prev, next, alpha, {localId = null, predicted = false} = {}) {
 if (!next) return prev ?? null;
 const t = clamp(Number.isFinite(alpha) ? alpha : 0, 0, 1);
 const before = prev ?? next;
 const blendList = (source, linear, angles, {local = false} = {}) => {
  const list = Array.isArray(next[source]) ? next[source] : [];
  const priorList = Array.isArray(before?.[source]) ? before[source] : [];
  return list.map(item => {
   if (!item || typeof item !== 'object') return item;
   const prior = priorList.find(x => x && x.id === item.id);
   if (!prior || (local && item.id === localId && predicted)) return item;
   const out = { ...item };
   for (const key of linear) {
    const a = prior[key], b = item[key];
    if (Number.isFinite(a) && Number.isFinite(b)) out[key] = lerp(a, b, t);
   }
   for (const key of angles) {
    const a = prior[key], b = item[key];
    if (Number.isFinite(a) && Number.isFinite(b)) out[key] = a + turn(a, b) * t;
   }
   if (item.pos && prior.pos) {
    const pos = { ...item.pos };
    for (const axis of ['x', 'y', 'z']) {
     const a = prior.pos[axis], b = item.pos[axis];
     if (Number.isFinite(a) && Number.isFinite(b)) pos[axis] = lerp(a, b, t);
    }
    out.pos = pos;
   }
   return out;
  });
 };
 return {
  ...next,
  actors: blendList('actors', ['x', 'y', 'z'], ['yaw', 'pitch'], {local: true}),
  rockets: blendList('rockets', [], []),
  vehicles: blendList('vehicles', ['x', 'y', 'z'], ['yaw'], {local: true}),
 };
}

export class NetClient {
 constructor(url = DEFAULT_SERVER_URL, options = {}) {
  this.url = url;
  this.storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  this.storageKey = `token-arena-net:${url}`;
  this.roomKey = `token-arena-room:${url}`;
  this.playerKey = 'token-arena-player-id';
  this.progressKey = 'token-arena-progress-token';
  this.progressToken = null;
  this.onStart = null;
  this.onResults = null;
  this.onLobby = null;
  this.onRooms = null;
  this.onHistory = null;
  this.onChat = null;
  this.onError = null;
  this.onProtocolMismatch = null;
  this.onClose = null;
  this.onProgression = null;
  this.onVoiceSignal = null;
  this.baseRenderDelay = clamp(Number(options.renderDelay) || RENDER_DELAY_DEFAULT, RENDER_DELAY_MIN, RENDER_DELAY_MAX);
  this.protocolVersion = PROTOCOL_VERSION;
  this.bandwidth = new BandwidthMeter({windowMs: 5000, capacity: 300});
  this._pendingReject = null;
  // The seat's latest operator/harness pair. It lives apart from the `loadout`
  // send method (which would otherwise shadow a same-named data field) so a
  // reconnect or a fresh prediction shadow is built from the most recent pick.
  this.seatLoadout = null;
  this.reset();
 }
 _disposeSocket() {
  if (this._pendingReject) { const reject = this._pendingReject; this._pendingReject = null; try { reject(new Error('superseded')); } catch {} }
  const ws = this.ws;
  if (!ws) return;
  try { ws.onopen = ws.onerror = ws.onclose = ws.onmessage = null; } catch {}
  try { ws.close(); } catch {}
  if (this.ws === ws) this.ws = null;
 }
 reset() {
  this.ws = null;
  this.connected = false;
  this.closedByUser = false;
  this.peerId = null;
  this.hostId = null;
  this.isHost = false;
  this.spectate = false;
  this.players = [];
  this.rooms = [];
  this.matches = [];
  this.config = null;
  this.mapId = 'exchange';
  this.started = false;
  this.roundOver = true;
  this.actorId = null;
  this.token = this.storage ? this.storage.getItem(this.storageKey) : null;
  this.roomId = this.storage ? this.storage.getItem(this.roomKey) : null;
  this.playerId = (()=>{if(!this.storage)return createPlayerId();const saved=this.storage.getItem(this.playerKey);if(saved&&validPlayerId(saved))return saved;const created=createPlayerId();try{this.storage.setItem(this.playerKey,created);}catch{}return created;})();
  this.progressToken = this.storage ? this.storage.getItem(this.progressKey) : null;
  if (!validProgressToken(this.progressToken)) { this.progressToken = createProgressToken(); if (this.storage) { try { this.storage.setItem(this.progressKey, this.progressToken); } catch {} } }
  this.progression = null;
   this.buffer = [];
   this.snapshotSeq = 0;
   this.events = [];
  this.state = null;
  this.shadow = null;
   this.resynced = false;
   this.inputSeq = 0;
   this.pendingInputs = [];
   this.clockOffset = null;
   this.renderDelay = this.baseRenderDelay;
   this.bufferTarget = BUFFER_MIN;
   // Delta decoding: sequence -> authoritative state, plus the last applied
   // sequence so a delta with a missing base can be rejected and re-requested.
   this.deltaBase = new Map();
   this.deltaSent = new Map();
   this.deltaApplied = 0;
   this.deltaMisses = 0;
   this.deltaHits = 0;
   this._resetTiming();
  this.lastError = '';
  this.chatLog = [];
  this.voiceIceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
 }
 connect(url = this.url) {
  if (url) this.url = url;
  // A reconnect supersedes any existing socket: close it and detach its
  // handlers before installing the replacement so stale events cannot corrupt
  // the new connection's state.
  this._disposeSocket();
  this.reset();
  this.closedByUser = false;
  return new Promise((resolve, reject) => {
   let ws;
   try { ws = new WebSocket(this.url); } catch (e) { reject(e); return; }
   const current = () => this.ws === ws;
   this.ws = ws;
   this._pendingReject = reject;
   ws.onopen = () => { if (!current()) return; this._pendingReject = null; this.connected = true; resolve(); };
   ws.onerror = () => { if (!current()) return; this._pendingReject = null; if (!this.connected) reject(new Error('connection failed')); };
   ws.onclose = () => { if (!current()) return; const reject = this._pendingReject; this._pendingReject = null; this.connected = false; if (reject) reject(new Error('connection closed before open')); if (this.onClose && !this.closedByUser) this.onClose(); };
   ws.onmessage = e => { if (!current()) return; this.onMessage(e.data); };
  });
 }
 close() { this.closedByUser = true; this._disposeSocket(); this.connected = false; }
 send(msg) {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
  const text = JSON.stringify(msg);
  if (msg.type === MESSAGE.VOICE_SIGNAL &&
   new TextEncoder().encode(text).length + (this.ws.bufferedAmount ?? 0) > 64 * 1024) return false;
  this.ws.send(text);
  return true;
 }
 join(name, character, harness, opts = {}) { this.seatLoadout = { character, harness }; this.send({ type: 'join', name, character, harness, token: this.token ?? '', roomId: opts.roomId || this.roomId || 'local', spectate: opts.spectate === true, playerId: this.playerId, progressToken: this.progressToken ?? '', v: PROTOCOL_VERSION, delta: SNAPSHOT_DELTA_VERSION }); }
 create(name, character, harness, playerName = '') { this.send({ type: 'create', name, playerName, character, harness, token: this.token ?? '', roomId: '', playerId: this.playerId, progressToken: this.progressToken ?? '', v: PROTOCOL_VERSION, delta: SNAPSHOT_DELTA_VERSION }); }
 list() { this.send({ type: 'list' }); }
 history() { this.send({ type: 'history' }); }
 host(config, mapId) { this.send({ type: 'host', config, mapId }); }
  start() { this.send({ type: 'start' }); }
  gear(gear, attachments, finish) { this.send({ type: 'gear', gear, ...(attachments !== undefined ? { attachments } : {}), ...(finish !== undefined ? { finish } : {}) }); }
  // Team-mode respawn switch (§3.7, §12.2 Phase 4): remember the latest pair so a
  // reconnect or a fresh prediction shadow is built from it (createShadow reads
  // `seatLoadout`), then ask the authoritative server to validate and apply it.
  loadout(character, harness) {
   if (typeof character === 'string' && character) this.seatLoadout = { ...(this.seatLoadout ?? {}), character, ...(harness !== undefined ? { harness } : {}) };
   this.send({ type: MESSAGE.LOADOUT, character, harness });
  }
  voiceState(enabled) { return typeof enabled === 'boolean' && this.send({ type: 'voice-state', enabled }); }
  voiceSignal(to, payload) {
   if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
   return this.send({ ...payload, type: 'voice-signal', roomId: this.roomId, to });
  }
 leave() {
  this.send({ type: 'leave' });
  this.token = null;
  this.roomId = null;
  if (this.storage) { this.storage.removeItem(this.storageKey); this.storage.removeItem(this.roomKey); }
 }
   input(input) { const seq=++this.inputSeq,value={...(input||{})};this.pendingInputs.push({seq,input:value});if(this.pendingInputs.length>240)this.pendingInputs.splice(0,this.pendingInputs.length-240);this.send({type:'input',seq,input:value});return seq; }
  chat(text) { this.send({ type: 'chat', text }); }
 onMessage(data) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
  try {
  switch (msg.type) {
   case MESSAGE.VOICE_SIGNAL: this.onVoiceSignal?.(msg); break;
   case MESSAGE.VOICE_CONFIG:
    if (!Array.isArray(msg.iceServers) || msg.iceServers.length > 16 || !msg.iceServers.every(server =>
     server && typeof server === 'object' && !Array.isArray(server) &&
     (typeof server.urls === 'string' || (Array.isArray(server.urls) && server.urls.every(url => typeof url === 'string'))))) break;
    this.voiceIceServers = msg.iceServers;
    break;
   case MESSAGE.WELCOME:
    this.peerId = msg.peerId;
    this.isHost = msg.host;
    this.spectate = msg.spectate === true;
    if (msg.roomId) { this.roomId = msg.roomId; if (this.storage) this.storage.setItem(this.roomKey, msg.roomId); }
    if (msg.token) { this.token = msg.token; if (this.storage) this.storage.setItem(this.storageKey, msg.token); }
    if (typeof msg.progressToken === 'string' && msg.progressToken) { this.progressToken = msg.progressToken; if (this.storage) { try { this.storage.setItem(this.progressKey, msg.progressToken); } catch {} } }
    if (msg.profile) { this.progression = msg.profile; this.onProgression?.({ profile: msg.profile, reconnected: msg.reconnected === true }); }
    if (Number.isInteger(msg.v) && msg.v !== PROTOCOL_VERSION) this.onProtocolMismatch?.({ client: PROTOCOL_VERSION, server: msg.v });
    break;
   case MESSAGE.LOBBY:
    this.players = Array.isArray(msg.players) ? msg.players.filter(p => p && typeof p === 'object') : [];
    this.hostId = msg.hostId;
    this.isHost = this.peerId === msg.hostId;
    this.config = msg.config;
    this.mapId = msg.mapId;
    this.started = msg.started;
    this.spectate = this.players.find(p => p.peerId === this.peerId)?.spectate === true;
    this.actorId = this.players.find(p => p.peerId === this.peerId)?.actorId ?? null;
    this.onLobby?.(msg);
    break;
   case MESSAGE.ROOMS: this.rooms = Array.isArray(msg.rooms) ? msg.rooms : []; this.onRooms?.(msg); break;
   case MESSAGE.HISTORY: this.matches = Array.isArray(msg.matches) ? msg.matches : []; this.onHistory?.(msg); break;
   case MESSAGE.START:
    this.started = true;
    this.roundOver = false;
     this.buffer = [];
     this.snapshotSeq = 0;
     this.events = [];
     this.state = null;
     this.inputSeq = 0;
     this.pendingInputs = [];
     this.clockOffset = null;
     this.deltaBase.clear();
     this.deltaSent.clear();
     this.deltaApplied = 0;
     this.deltaMisses = 0;
     this.deltaHits = 0;
    this.createShadow(msg.mapId, msg.config, this.seatLoadout);
    this.onStart?.(msg);
    break;
   case MESSAGE.EVENTS:
    for (const item of (Array.isArray(msg.items) ? msg.items : [])) this.events.push(item);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    break;
    case MESSAGE.SNAPSHOT: this.push(msg); break;
    case MESSAGE.SNAPSHOT_DELTA: this.pushDelta(msg); break;
     case MESSAGE.PROGRESSION: this.progression = msg.profile ?? this.progression; this.onProgression?.(msg); break;
     case MESSAGE.RESULTS: this.roundOver = true; this.state = msg.state; this.onResults?.(msg); break;
    case MESSAGE.CHAT:
     this.chatLog.push(msg);
     if (this.chatLog.length > 100) this.chatLog.splice(0, this.chatLog.length - 100);
     this.onChat?.(msg);
     break;
    case MESSAGE.ERROR: this.lastError = msg.message; this.onError?.(msg); break;
   }
   } catch {}
   }
   push(msg) {
   if (Number.isInteger(msg.seq) && msg.seq > 0 && msg.seq <= this.snapshotSeq) return;
   if (Number.isInteger(msg.seq) && msg.seq > 0) this.snapshotSeq = msg.seq;
   this.bandwidth.record(wireSize(msg), this._now());
   msg.recvAt = performance.now();
   msg.serverTime = Number.isFinite(msg.state?.time) ? msg.state.time : null;
   if (msg.serverTime !== null) { const sample=msg.recvAt-msg.serverTime*1000;this.clockOffset=this.clockOffset===null?sample:lerp(this.clockOffset,sample,.08); }
   this._observeArrival(msg);
   this.buffer.push(msg);
   this._adapt();
   while (this.buffer.length > this.bufferTarget) this.buffer.shift();
  this.state = msg.state;
   this._rememberBase(msg);
   const actors = Array.isArray(msg.state?.actors) ? msg.state.actors.filter(a => a && typeof a === 'object') : [];
   if (msg.state?.race) {
    // Race IDs, inventory and standings belong exclusively to the server.
    this.shadow = null;
    this.resynced = this.actorId !== null && actors.some(a => a.id === this.actorId);
    const ack = msg.acks?.[this.actorId];
    if (Number.isInteger(ack)) this.pendingInputs = this.pendingInputs.filter(item => item.seq > ack);
   }
  if (this.shadow && this.actorId !== null) {
   const own = actors.find(a => a.id === this.actorId);
    if (own) {
      this.resync(own);
      this.resyncVehicles(msg.state?.vehicles);
     // Prediction runs on a shadow match, so restore its clock and terminal
     // state before replaying pending inputs; otherwise each replay counts the
     // same elapsed time again until the shadow times out and freezes.
     if (this.shadow) {
      if (Number.isFinite(msg.state.time)) this.shadow.time = msg.state.time;
      if (typeof msg.state.over === 'boolean') this.shadow.over = msg.state.over;
     }
     const ack=Number.isInteger(msg.acks?.[this.actorId])?msg.acks[this.actorId]:null;
     if(ack!==null){this.pendingInputs=this.pendingInputs.filter(item=>item.seq>ack);for(const item of this.pendingInputs)this.shadow.step(RULES.dt,{inputs:{[this.shadow.actors[0].id]:item.input}});}
     this.resynced = true;
    }
   }
  }
  _now() {
   try { return performance.now(); } catch { return 0; }
  }
  // Keep a bounded map of sequence -> authoritative state so a later delta can
  // be reconstructed. Only full snapshots become bases.
  _rememberBase(msg) {
   if (!Number.isInteger(msg.seq) || msg.seq <= 0 || !msg.state) return;
   this.deltaBase.set(msg.seq, msg.state);
   this.deltaApplied = msg.seq;
   while (this.deltaBase.size > DELTA_HISTORY) {
    const oldest = this.deltaBase.keys().next().value;
    this.deltaBase.delete(oldest);
   }
  }
  // Decode a version-2 delta frame. `base` names the sequence the patch was
  // computed against; when that base is missing (dropped or evicted) the frame
  // is counted as a miss and ignored, and the next full snapshot re-syncs.
  pushDelta(msg) {
   if (!msg || !Number.isInteger(msg.seq) || msg.seq <= 0) return false;
   const base = this.deltaBase.get(msg.base);
   if (!base) { this.deltaMisses++; return false; }
   if (msg.seq <= this.snapshotSeq) return false;
   let state;
   try { state = applySnapshotDelta(base, msg.patch); } catch { this.deltaMisses++; return false; }
   this.deltaHits++;
   this.push({ seq: msg.seq, acks: msg.acks, state });
   return true;
  }
  // Build the next outbound frame for a sequence: a delta against the last
  // sent base when it saves bytes, otherwise a full snapshot. The server owns
  // the authoritative state and calls this once per broadcast. Every emitted
  // frame is remembered so the next one can patch against it; a full snapshot
  // becomes the new base.
  encodeSnapshot(seq, state, {acks = {}, base = null, force = false} = {}) {
   const priorSeq = Number.isInteger(base) ? base : this.deltaApplied;
   if (!force && Number.isInteger(priorSeq) && priorSeq > 0) {
    const prior = this.deltaSent.get(priorSeq);
    if (prior) {
     const patch = snapshotDelta(prior, state);
     if (patch) {
      const delta = { type: MESSAGE.SNAPSHOT_DELTA, v: PROTOCOL_VERSION, seq, base: priorSeq, acks, patch };
      if (wireSize(delta) + SNAPSHOT_DELTA_MIN_BYTES < wireSize({ type: MESSAGE.SNAPSHOT, seq, acks, state })) {
       this._rememberSent(seq, state);
       return delta;
      }
     }
    }
   }
   this._rememberSent(seq, state);
   return { type: MESSAGE.SNAPSHOT, v: PROTOCOL_VERSION, seq, acks, state };
  }
  _rememberSent(seq, state) {
   if (!Number.isInteger(seq) || seq <= 0 || !state) return;
   this.deltaSent.set(seq, state);
   this.deltaApplied = seq;
   while (this.deltaSent.size > DELTA_HISTORY) {
    const oldest = this.deltaSent.keys().next().value;
    this.deltaSent.delete(oldest);
   }
  }
  _resetTiming() {
  this._lastRecvAt = null;
  this._lastSeq = null;
  this._lastServerTime = null;
  this._intervalMean = null;
  this.jitter = 0;
  this.lossRate = 0;
 }
 _observeArrival(msg) {
  const seq = Number.isInteger(msg.seq) && msg.seq > 0 ? msg.seq : null;
  if (this._lastRecvAt !== null) {
   const gap = msg.recvAt - this._lastRecvAt;
   let expected = this._intervalMean;
   if (msg.serverTime !== null && this._lastServerTime !== null) {
    const serverGap = (msg.serverTime - this._lastServerTime) * 1000;
    if (serverGap > 1 && serverGap < 1000) expected = serverGap;
   }
   if (!(expected > 0)) expected = gap;
   const deviation = Math.abs(gap - expected);
   this.jitter = this.jitter + (deviation - this.jitter) * 0.15;
   this._intervalMean = this._intervalMean === null ? expected : this._intervalMean + (expected - this._intervalMean) * 0.1;
   const lost = seq !== null && this._lastSeq !== null && seq > this._lastSeq ? Math.min(10, seq - this._lastSeq - 1) : 0;
   this.lossRate = this.lossRate + ((lost > 0 ? 1 : 0) - this.lossRate) * 0.2;
  }
  this._lastRecvAt = msg.recvAt;
  this._lastSeq = seq;
  if (msg.serverTime !== null) this._lastServerTime = msg.serverTime;
 }
 _adapt() {
  const stress = clamp(this.jitter / JITTER_REF + this.lossRate, 0, 1);
  const desiredDelay = RENDER_DELAY_MIN + (RENDER_DELAY_MAX - RENDER_DELAY_MIN) * stress;
  this.renderDelay = clamp(this.renderDelay + (desiredDelay - this.renderDelay) * 0.1, RENDER_DELAY_MIN, RENDER_DELAY_MAX);
  const desiredBuffer = Math.round(BUFFER_MIN + (BUFFER_MAX - BUFFER_MIN) * stress);
  if (desiredBuffer > this.bufferTarget) this.bufferTarget = Math.min(desiredBuffer, this.bufferTarget + 1);
  else if (desiredBuffer < this.bufferTarget) this.bufferTarget = Math.max(desiredBuffer, this.bufferTarget - 1);
 }
  createShadow(mapId, config, loadout) {
    const character = loadout?.character ?? 'chatgpt', harness = loadout?.harness ?? 'openclaw';
    // M0 §4: the prediction shadow never pathfinds, so skip the 0.1 m nav flood
    // (respawn/reconnect included). The floor lattice is still baked by Match,
    // so moveActor/ray prediction stays on the fast path.
    this.shadow = isVehicleMode(config?.mode) ? null : new Match(character, harness, Math.random, getMap(mapId).id, { ...(config || {}), humanCount: 1, botCount: 0, skipNav: true, ...(loadout ? { loadouts: { 0: loadout } } : {}) });
   this.resynced = false;
   this.inputSeq = 0;
   this.pendingInputs = [];
   this.clockOffset = null;
   this._resetTiming();
 }
  resync(actor) {
  if (!this.shadow || !actor || typeof actor !== 'object') return;
  const p = this.shadow.actors[0];
   Object.assign(p, structuredClone(actor));
   p.ammo = Array.isArray(actor.ammo) ? actor.ammo.map(n => Number.isFinite(n) ? n : Infinity) : p.ammo;
  }
   resyncVehicles(vehicles = []) {
   if (!this.shadow) return;
    for (const state of Array.isArray(vehicles) ? vehicles : []) {
     if (!state || typeof state !== 'object') continue;
     const vehicle = this.shadow.vehicles.find(item => item.id === state.id);
     if (!vehicle) continue;
     vehicle.position = { x: Number.isFinite(state.x) ? state.x : vehicle.position.x, y: Number.isFinite(state.y) ? state.y : vehicle.position.y, z: Number.isFinite(state.z) ? state.z : vehicle.position.z };
     vehicle.velocity = { x: Number.isFinite(state.vx) ? state.vx : vehicle.velocity.x, z: Number.isFinite(state.vz) ? state.vz : vehicle.velocity.z };
     vehicle.heading = Number.isFinite(state.yaw) ? state.yaw : vehicle.heading;
     vehicle.health = Number.isFinite(state.health) ? state.health : vehicle.health;
     vehicle.maxHealth = Number.isFinite(state.maxHealth) ? state.maxHealth : vehicle.maxHealth;
     if (Number.isFinite(state.vy)) vehicle.vy = state.vy;
     if (typeof state.flight === 'boolean') vehicle.flight = state.flight;
     if (Number.isFinite(state.altitude)) vehicle.altitude = state.altitude;
     if (state.gunner !== undefined) vehicle.gunner = state.gunner;
     if (Array.isArray(state.passengers)) vehicle.passengers = [...state.passengers];
    vehicle.driver = state.driver;
    vehicle.heat = state.heat;
    vehicle.overheated = state.overheated;
    vehicle.respawnTimer = state.respawnTimer;
    if (Number.isFinite(state.turretYaw)) vehicle.turretYaw = state.turretYaw;
    if (Number.isFinite(state.roll)) vehicle.roll = state.roll;
    if (Number.isFinite(state.pitchBody)) vehicle.pitchBody = state.pitchBody;
    if (Number.isFinite(state.speed)) vehicle.speed = state.speed;
   }
  }
 predict(input) {
  if (this.shadow) this.shadow.step(RULES.dt, { inputs: { [this.shadow.actors[0].id]: input } });
 }
 viewMatch() {
  const st = this.state;
  const mapId = st?.mapId || this.mapId;
    return { arena: getMap(mapId), actors: st ? st.actors : [], vehicles: st ? st.vehicles ?? [] : [], pickups: st ? st.pickups : [], ...(st?.race ? { race: st.race } : {}), rockets: [], events: [], serial: 0 };
  }
 renderState(now = performance.now()) {
  const b = this.buffer;
   let base, prev, alpha;
  if (!b.length) {
   if (!this.state) return null;
    base = prev = this.state;
    alpha = 0;
  } else {
    const useServerClock=this.clockOffset!==null&&b.length>1&&b.every(m=>m.serverTime!==null),target=useServerClock?(now-this.clockOffset)/1000-this.renderDelay/1000:now-this.renderDelay;
    let hi = b.findIndex(m => useServerClock?m.serverTime>=target:m.recvAt>=target);
   if (hi < 0) hi = b.length - 1;
   const lo = Math.max(0, hi - 1);
   const s2 = b[hi], s1 = b[lo];
    const t1=useServerClock?s1.serverTime:s1.recvAt,t2=useServerClock?s2.serverTime:s2.recvAt;
    alpha = hi === lo ? 1 : Math.max(0, Math.min(1, (target-t1)/(t2-t1||1)));
   base = s2.state;
   prev = s1.state;
  }
  // The exported pure helper owns actor/rocket/vehicle blending so the live
  // render path and the test harness cannot drift apart.
  const resynced = Boolean(this.shadow && this.resynced);
  const view = interpolateSnapshots(prev, base, alpha, { localId: this.actorId, predicted: resynced });
  let { actors, vehicles } = view;
   if (this.shadow && this.resynced) {
   const own = this.shadow.actors[0];
   const idx = actors.findIndex(a => a.id === this.actorId);
    if (idx >= 0) actors = actors.slice(0, idx).concat(own, actors.slice(idx + 1));
    if (own.vehicleId !== null) {
     const local = this.shadow.vehicles.find(vehicle => vehicle.id === own.vehicleId);
     const idx = vehicles.findIndex(vehicle => vehicle.id === own.vehicleId);
     if (local && idx >= 0) { const state = { id: local.id, kind: local.kind, x: local.position.x, y: local.position.y, z: local.position.z, vx: local.velocity.x, vz: local.velocity.z, yaw: local.heading, health: local.health, maxHealth: local.maxHealth, driver: local.driver, heat: local.heat, overheated: local.overheated, respawnTimer: local.respawnTimer, turretYaw: local.turretYaw, roll: local.roll, pitchBody: local.pitchBody, speed: local.speed }; vehicles = vehicles.slice(0, idx).concat(state, vehicles.slice(idx + 1)); }
    }
   }
   return { ...view, actors, vehicles, events: this.events };
  }
 }

// ---------------------------------------------------------------------------
// Deterministic netcode harness.
//
// A seeded, in-process simulation of a server and one predicting client. It
// models one-way latency, jitter and packet loss deterministically so the
// prediction/reconciliation path can be asserted frame-for-frame in tests
// without a socket, a clock or a browser. The harness steps the authoritative
// `Match`, delivers snapshots (optionally as deltas), and exposes the client's
// shadow actor for divergence checks.
// ---------------------------------------------------------------------------
export class NetHarness {
 constructor({mapId = 'crosswire', config = {}, seed = 1, latency = 2, jitter = 0, loss = 0, delta = true, keyframeEvery = 0, humanCount = 1, botCount = 0, loadout = null} = {}) {
  let state = seed >>> 0 || 1;
  this.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  this.server = new Match(loadout?.character ?? 'chatgpt', loadout?.harness ?? 'openclaw', this.random, mapId, { ...config, humanCount, botCount, ...(loadout ? { loadouts: { 0: loadout } } : {}) });
  this.client = new NetClient();
  this.client.createShadow(mapId, { ...config, humanCount, botCount }, loadout);
  this.client.actorId = this.server.actors[0]?.id ?? 0;
  this.latency = Math.max(0, Math.floor(latency));
  this.jitter = Math.max(0, Math.floor(jitter));
  this.loss = clamp(Number(loss) || 0, 0, 1);
  this.delta = delta;
  // Emit a full snapshot every N frames so a client that missed a delta base
  // can re-sync without waiting for the next match. 0 disables keyframes.
  this.keyframeEvery = Math.max(0, Math.floor(keyframeEvery) || 0);
  this.dt = RULES.dt;
  this.seq = 0;
  this.tick = 0;
  this.inFlight = [];
  this.pendingInputs = [];
  this.stats = { sent: 0, delivered: 0, dropped: 0, deltaFrames: 0, fullFrames: 0, bytes: 0, deltaBytes: 0, fullBytes: 0 };
 }
 // Queue an input for the next tick, exactly like NetClient.input + predict.
 send(input) {
  const seq = this.client.input(input);
  this.client.predict(input);
  this.pendingInputs.push({ seq, input: { ...input } });
  return seq;
 }
 // Advance one authoritative tick: apply every queued input, step the server,
 // then deliver any snapshot whose latency has elapsed.
 step(input = null) {
  if (input) this.send(input);
  const inputs = {};
  for (const item of this.pendingInputs) inputs[this.server.actors[0].id] = item.input;
  this.pendingInputs = [];
  this.server.step(this.dt, { inputs });
  this.tick++;
  const ack = this.client.inputSeq;
  const state = this.server.snapshot();
  const keyframe = this.keyframeEvery > 0 && this.seq > 0 && this.seq % this.keyframeEvery === 0;
  const frame = this.delta && this.seq > 0
   ? this.client.encodeSnapshot(this.seq + 1, state, { acks: { [this.client.actorId]: ack }, base: this.seq, force: keyframe })
   : { type: MESSAGE.SNAPSHOT, seq: this.seq + 1, acks: { [this.client.actorId]: ack }, state };
  this.seq++;
  const size = wireSize(frame);
  this.stats.sent++;
  this.stats.bytes += size;
  if (frame.type === MESSAGE.SNAPSHOT_DELTA) { this.stats.deltaFrames++; this.stats.deltaBytes += size; }
  else { this.stats.fullFrames++; this.stats.fullBytes += size; }
  const jitter = this.jitter ? Math.floor(this.random() * (this.jitter + 1)) : 0;
  this.inFlight.push({ at: this.tick + this.latency + jitter, frame });
  const ready = [];
  for (const packet of this.inFlight) {
   if (packet.at > this.tick) { ready.push(packet); continue; }
   if (this.loss > 0 && this.random() < this.loss) { this.stats.dropped++; continue; }
   if (packet.frame.type === MESSAGE.SNAPSHOT_DELTA) this.client.pushDelta(packet.frame);
   else this.client.push(packet.frame);
   this.stats.delivered++;
  }
  this.inFlight = ready;
  return this.server.snapshot();
 }
 // Absolute divergence between the predicted shadow actor and the server.
 divergence() {
  const a = this.client.shadow?.actors?.[0];
  const b = this.server.actors[0];
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
 }
 flush() {
  while (this.inFlight.length) {
   this.tick++;
   const ready = [];
   for (const packet of this.inFlight) {
    if (packet.at > this.tick) { ready.push(packet); continue; }
    if (this.loss > 0 && this.random() < this.loss) { this.stats.dropped++; continue; }
    if (packet.frame.type === MESSAGE.SNAPSHOT_DELTA) this.client.pushDelta(packet.frame);
    else this.client.push(packet.frame);
    this.stats.delivered++;
   }
   this.inFlight = ready;
  }
  return this.client;
 }
}
