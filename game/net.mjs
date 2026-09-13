import {getMap} from './maps.mjs';
import {Match} from './core.mjs';
import {RULES} from './data.mjs';
import {clamp, lerp} from './math.mjs';
import {MESSAGE, validPlayerId, validProgressToken} from './protocol.mjs';

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
  this.onClose = null;
  this.onProgression = null;
  this.onVoiceSignal = null;
  this.baseRenderDelay = clamp(Number(options.renderDelay) || RENDER_DELAY_DEFAULT, RENDER_DELAY_MIN, RENDER_DELAY_MAX);
  this._pendingReject = null;
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
 join(name, character, harness, opts = {}) { this.send({ type: 'join', name, character, harness, token: this.token ?? '', roomId: opts.roomId || this.roomId || 'local', spectate: opts.spectate === true, playerId: this.playerId, progressToken: this.progressToken ?? '' }); }
 create(name, character, harness, playerName = '') { this.send({ type: 'create', name, playerName, character, harness, token: this.token ?? '', roomId: '', playerId: this.playerId, progressToken: this.progressToken ?? '' }); }
 list() { this.send({ type: 'list' }); }
 history() { this.send({ type: 'history' }); }
 host(config, mapId) { this.send({ type: 'host', config, mapId }); }
  start() { this.send({ type: 'start' }); }
  gear(gear, attachments, finish) { this.send({ type: 'gear', gear, ...(attachments !== undefined ? { attachments } : {}), ...(finish !== undefined ? { finish } : {}) }); }
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
    this.createShadow(msg.mapId, msg.config);
    this.onStart?.(msg);
    break;
   case MESSAGE.EVENTS:
    for (const item of (Array.isArray(msg.items) ? msg.items : [])) this.events.push(item);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    break;
    case MESSAGE.SNAPSHOT: this.push(msg); break;
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
   msg.recvAt = performance.now();
   msg.serverTime = Number.isFinite(msg.state?.time) ? msg.state.time : null;
   if (msg.serverTime !== null) { const sample=msg.recvAt-msg.serverTime*1000;this.clockOffset=this.clockOffset===null?sample:lerp(this.clockOffset,sample,.08); }
   this._observeArrival(msg);
   this.buffer.push(msg);
   this._adapt();
   while (this.buffer.length > this.bufferTarget) this.buffer.shift();
  this.state = msg.state;
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
  createShadow(mapId, config) {
    this.shadow = isVehicleMode(config?.mode) ? null : new Match('chatgpt', 'openclaw', Math.random, getMap(mapId).id, { ...(config || {}), humanCount: 1, botCount: 0 });
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
   let base, actors, rockets, vehicles;
  if (!b.length) {
   if (!this.state) return null;
   base = this.state;
    actors = base.actors;
    vehicles = base.vehicles ?? [];
    rockets = base.rockets ?? [];
  } else {
    const useServerClock=this.clockOffset!==null&&b.length>1&&b.every(m=>m.serverTime!==null),target=useServerClock?(now-this.clockOffset)/1000-this.renderDelay/1000:now-this.renderDelay;
    let hi = b.findIndex(m => useServerClock?m.serverTime>=target:m.recvAt>=target);
   if (hi < 0) hi = b.length - 1;
   const lo = Math.max(0, hi - 1);
   const s2 = b[hi], s1 = b[lo];
    const t1=useServerClock?s1.serverTime:s1.recvAt,t2=useServerClock?s2.serverTime:s2.recvAt;
    const alpha = hi === lo ? 1 : Math.max(0, Math.min(1, (target-t1)/(t2-t1||1)));
   base = s2.state;
   const prev = s1.state;
   actors = base.actors.map(actor => {
    const before = (prev.actors ?? []).find(x => x.id === actor.id);
      if (!before||(actor.id===this.actorId&&this.shadow&&this.resynced)) return actor;
    return { ...actor, x: lerp(before.x, actor.x, alpha), y: lerp(before.y, actor.y, alpha), z: lerp(before.z, actor.z, alpha),
     yaw: before.yaw + turn(before.yaw, actor.yaw) * alpha, pitch: lerp(before.pitch, actor.pitch, alpha) };
   });
    rockets = (base.rockets ?? []).map(r => {
    const before = (prev.rockets ?? []).find(x => x.id === r.id);
    if (!before) return r;
     return { ...r, pos: { x: lerp(before.pos.x, r.pos.x, alpha), y: lerp(before.pos.y, r.pos.y, alpha), z: lerp(before.pos.z, r.pos.z, alpha) } };
    });
    vehicles = (base.vehicles ?? []).map(vehicle => {
     const before = (prev.vehicles ?? []).find(item => item.id === vehicle.id);
     if (!before) return vehicle;
     return { ...vehicle, x: lerp(before.x, vehicle.x, alpha), y: lerp(before.y, vehicle.y, alpha), z: lerp(before.z, vehicle.z, alpha), yaw: before.yaw + turn(before.yaw, vehicle.yaw) * alpha };
    });
   }
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
   return { ...base, actors, vehicles, rockets, events: this.events };
 }
}
