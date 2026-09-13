import {Match} from '../game/core.mjs';
import {normalizeConfig} from '../game/config.mjs';
import {actorWon} from '../game/outcome.mjs';
import {getMap} from '../game/maps.mjs';
import {resolveMapForMode} from '../game/arenas.mjs';
import {CHARACTERS,resolveLoadout,RULES} from '../game/data.mjs';
import {quantizeNumbers} from '../game/quantize.mjs';
import {randomUUID} from 'node:crypto';
import {validPlayerId} from './progression.mjs';

export const PLAYER_LIMIT = 8;
export const SPECTATOR_LIMIT = 24;
// Clients send inputs at 60 Hz; allow generous headroom and drop the excess so a
// flooding client cannot burn simulation time or unbounded server work.
export const INPUT_RATE_LIMIT = 120;
const clean = name => String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, max) => typeof value === 'string' && value.length <= max;

export class Room {
 constructor(id = 'local', random = Math.random, options = {}) {
  this.id = id;
  this.name = String(options.name ?? id);
  this.random = random;
  this.graceMs = Math.max(1000, options.graceMs ?? 20000);
  this.history = options.history ?? null;
  this.progression = options.progression ?? null;
  this.peers = new Map();
  this.nextPeerId = 1;
  this.hostId = null;
  this.config = null;
  this.mapId = 'exchange';
  this.match = null;
  this.started = false;
  this.roundOver = true;
  this.tickAcc = 0;
  this.broadcastAt = 0;
  this.snapshotHz = Math.max(1, Math.min(120, Number(options.snapshotHz) || 30));
  this.snapshotInterval = 1 / this.snapshotHz;
  this.transformHistory = [];
  this.transformHistoryLimit = Math.max(4, Math.min(240, Number(options.transformHistoryLimit) || 32));
  this.lagCompEnabled = false;
  this.seq = 0;
  this.out = [];
 }
 send(peerId, msg) { this.out.push({ to: peerId, msg }); }
 broadcast(msg) { this.out.push({ to: null, msg }); }
 drain() { const msgs = this.out; this.out = []; return msgs; }
 summary() {
  return { roomId: this.id, name: this.name, players: [...this.peers.values()].filter(p => p.disconnectedAt === null).length, started: this.started, mapId: this.mapId, config: this.config ? { ...this.config } : null };
 }
 // Outbound snapshots are quantized from a deep clone so the authoritative match
 // state (shared nested references such as powerups/gear) is never mutated.
 wireState() {
  if (!this.match) return null;
  return quantizeNumbers(structuredClone(this.match.snapshot()));
 }
 lobby() {
  return { type: 'lobby', roomId: this.id, name: this.name, hostId: this.hostId, started: this.started,
   config: this.config ? { ...this.config } : null, mapId: this.mapId,
   players: [...this.peers.values()].map(p => ({ peerId: p.id, name: p.name, character: p.character, harness: p.harness, actorId: p.actorId, ready: p.ready, connected: p.disconnectedAt === null, spectate: p.spectate === true, voiceSession: p.voiceSession })) };
 }
 nextConnectedHost() { for (const p of this.peers.values()) if (p.spectate !== true && p.disconnectedAt === null) return p.id; return null; }
 join(peerId, name = '', character = 'chatgpt', harness = 'openclaw', token = '', spectate = false, playerId = '') {
  if (this.peers.has(peerId)) return;
  if (token) {
   const existing = [...this.peers.values()].find(p => p.token === token);
   if (existing) {
    if (existing.disconnectedAt === null) {
     // A reconnect can arrive before the old socket's close event is processed.
     // Newest connection wins: adopt the peer and seat on this socket instead of
     // rejecting the reattach. The old socket's later close is a no-op because
     // the peer id is reassigned below.
     if (existing.id === peerId) { this.send(peerId, { type: 'error', message: 'session is already connected' }); return; }
     existing.disconnectedAt = Date.now();
    }
    const oldId = existing.id;
    this.peers.delete(oldId);
    existing.id = peerId;
     existing.disconnectedAt = null;
     if (validPlayerId(playerId)) existing.playerId = playerId;
     existing.voiceSession = null;
     existing.inputRate = null;
     existing.latest = null;
     existing.receivedSeq = existing.appliedSeq = existing.latestSeq = 0;
      existing.edgeFire = existing.edgeJump = existing.edgePower = existing.edgeInteract = false;
     existing.lastJump = existing.lastPower = existing.lastInteract = false;
     existing.edgeMelee = existing.lastMelee = false; existing.edgeReload = existing.lastReload = false; existing.edgeGrenade = false; existing.lastGrenade = false;
    this.peers.set(peerId, existing);
    if (this.hostId === oldId) this.hostId = peerId;
    else if (!this.hostId && existing.spectate !== true) this.hostId = peerId;
    this.send(peerId, { type: 'welcome', peerId, roomId: this.id, host: peerId === this.hostId, reconnected: true, token: existing.token, spectate: existing.spectate === true, profile: this.progression?.get(existing.playerId) ?? null });
    this.broadcast(this.lobby());
    if (this.started && !this.roundOver && this.match) {
     this.send(peerId, { type: 'start', config: { ...this.match.config }, mapId: this.match.arena.id });
     this.send(peerId, { type: 'snapshot', seq: ++this.seq, acks: { [existing.actorId]: existing.appliedSeq }, state: this.wireState() });
     } else if (this.match?.over) {
      this.send(peerId, { type: 'results', state: this.match.snapshot() });
     }
    return;
   }
  }
  const active = this.started && !this.roundOver && !!this.match;
  const requestedPlayer = spectate !== true;
  const playerCount = [...this.peers.values()].filter(p => p.spectate !== true).length;
  if (requestedPlayer && !active && playerCount >= PLAYER_LIMIT) { this.send(peerId, { type: 'error', message: 'room is full' }); return; }
  let isSpectator = spectate === true;
  if (requestedPlayer && active) isSpectator = true;
  if (isSpectator && [...this.peers.values()].filter(p => p.spectate === true).length >= SPECTATOR_LIMIT) { this.send(peerId, { type: 'error', message: 'spectator limit reached' }); return; }
  const l = resolveLoadout(character, harness) || { character: 'chatgpt', harness: 'openclaw' };
  const peer = { id: peerId, name: clean(name) || CHARACTERS.find(c => c.id === l.character).name,
    character: l.character, harness: l.harness, actorId: null, ready: false, latest: null, receivedSeq: 0, latestSeq: 0, appliedSeq: 0, lastSerial: active ? this.match.serial : 0,
     lastJump: false, lastPower: false, lastInteract: false, lastReload: false, edgeFire: false, edgeJump: false, edgePower: false, edgeInteract: false, edgeMelee: false, lastMelee: false, edgeReload: false, edgeGrenade: false, lastGrenade: false,
   token: randomUUID(), disconnectedAt: null, spectate: isSpectator, voiceSession: null, playerId: validPlayerId(playerId) ? playerId : null };
  this.peers.set(peerId, peer);
  if (!this.hostId && !isSpectator) this.hostId = peerId;
  this.send(peerId, { type: 'welcome', peerId, roomId: this.id, host: peerId === this.hostId, token: peer.token, spectate: isSpectator, profile: this.progression?.get(peer.playerId) ?? null });
  this.broadcast(this.lobby());
  if (requestedPlayer && active) this.send(peerId, { type: 'error', message: 'Match in progress — you joined as a spectator.' });
  if (isSpectator && this.started && !this.roundOver && this.match) {
   this.send(peerId, { type: 'start', config: { ...this.match.config }, mapId: this.match.arena.id });
     this.send(peerId, { type: 'snapshot', seq: ++this.seq, acks: { [this.peers.get(peerId)?.actorId ?? -1]: 0 }, state: this.wireState() });
   } else if (isSpectator && this.match?.over) {
    this.send(peerId, { type: 'results', state: this.match.snapshot() });
   }
 }
 disconnect(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  peer.disconnectedAt = Date.now();
  peer.voiceSession = null;
  peer.latest = null;
    peer.edgeFire = peer.edgeJump = peer.edgePower = peer.edgeInteract = false;
   peer.lastJump = peer.lastPower = peer.lastInteract = false;
   peer.edgeMelee = peer.lastMelee = false; peer.edgeReload = peer.lastReload = false; peer.edgeGrenade = false; peer.lastGrenade = false;
  this.broadcast(this.lobby());
 }
 expireGrace(now = Date.now()) {
  for (const [id, peer] of this.peers) if (peer.disconnectedAt && now - peer.disconnectedAt > this.graceMs) this.leave(id);
 }
 host(peerId, config, mapId) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  if (peer.spectate) { this.send(peerId, { type: 'error', message: 'spectators cannot change match settings' }); return; }
  if (peerId !== this.hostId) { this.send(peerId, { type: 'error', message: 'only the host can change match settings' }); return; }
  this.config = normalizeConfig(config);
  this.mapId = resolveMapForMode(getMap(mapId).id, this.config.mode, { legacy: true });
  this.broadcast(this.lobby());
 }
 start(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  if (peer.spectate) { this.send(peerId, { type: 'error', message: 'spectators cannot start the match' }); return; }
  if (peerId !== this.hostId) { this.send(peerId, { type: 'error', message: 'only the host can start' }); return; }
  if (this.peers.size === 0) { this.send(peerId, { type: 'error', message: 'no players in the room' }); return; }
  const players = [...this.peers.values()].filter(p => p.spectate !== true);
  if (players.length === 0) { this.send(peerId, { type: 'error', message: 'no players in the room' }); return; }
  const mode = this.config?.mode ?? normalizeConfig({}).mode;
  const mapId = resolveMapForMode(this.mapId, mode, { legacy: true });
  if (mapId !== this.mapId) this.mapId = mapId;
  const humanCount = Math.min(PLAYER_LIMIT, players.length);
    this.match = new Match('chatgpt', 'openclaw', this.random, this.mapId, { ...this.config ?? {}, humanCount, loadouts: players.map(p => { const profile = this.progression?.get(p.playerId); return { character: p.character, harness: p.harness, gear: profile?.gear, attachments: profile?.attachments }; }) });
   if (this.match.race) this.config = { ...this.match.config };
  let i = 0;
   for (const p of players) { p.actorId = i; this.match.actors[i].name = p.name; p.latest = null; p.receivedSeq = p.latestSeq = p.appliedSeq = 0; p.lastSerial = 0; p.edgeJump = p.edgePower = p.edgeInteract = false; p.lastJump = p.lastPower = p.lastInteract = false; p.edgeMelee = p.lastMelee = false; p.edgeReload = p.lastReload = false; p.edgeGrenade = false; p.lastGrenade = false; i++; }
   for (const p of this.peers.values()) { p.edgeFire = false; p.edgeReload = p.lastReload = false; p.edgeGrenade = false; p.lastGrenade = false; if (p.spectate) p.lastSerial = 0; }
  this.started = true;
  this.roundOver = false;
  this.tickAcc = 0;
  this.broadcastAt = 0;
  this.broadcast(this.lobby());
  this.broadcast({ type: 'start', config: { ...this.config }, mapId: this.mapId });
 }
 input(peerId, input) {
  const peer = this.peers.get(peerId);
   if (!peer || peer.disconnectedAt !== null || peer.spectate || peer.actorId === null || !this.match || this.roundOver) return;
  const now = Date.now();
  if (!peer.inputRate || now - peer.inputRate.at >= 1000) peer.inputRate = { at: now, count: 0 };
  if (peer.inputRate.count >= INPUT_RATE_LIMIT) return;
  peer.inputRate.count++;
  const i = input && typeof input === 'object' ? input : {};
   const requested = Number.isInteger(i.seq) && i.seq > 0 ? i.seq : peer.receivedSeq + 1;
   // A rogue or buggy client could jump its sequence far ahead, after which every
   // real input looks stale. Accept modest forward progress only; a stale or
   // duplicate sequence is ignored as before.
   const seq = requested > peer.receivedSeq + 600 ? peer.receivedSeq + 1 : requested;
   if (seq <= peer.receivedSeq) return;
   peer.receivedSeq = seq;
    const axis = value => { const n = Number(value); return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0; };
    const x = axis(i.x), z = axis(i.z);
     const ext = { x, z, fire: i.fire === true };
   if (this.match.race) Object.assign(ext, { jump: i.jump === true, power: i.power === true, interact: i.interact === true });
  if (Number.isFinite(i.yaw)) ext.yaw = i.yaw;
  if (Number.isFinite(i.pitch)) ext.pitch = Math.max(-1.45, Math.min(1.45, i.pitch));
  if (Number.isInteger(i.weapon)) ext.weapon = i.weapon;
  if (i.sprint === true) ext.sprint = true;
  if (i.crouch === true) ext.crouch = true;
  if (i.ads === true) ext.ads = true;
    peer.latest = ext;
    peer.latestSeq = seq;
    if (ext.fire && !this.match.race) peer.edgeFire = true;
   if (i.jump === true && !peer.lastJump && !this.match.race) peer.edgeJump = true;
  peer.lastJump = i.jump === true;
    if (i.power === true && !peer.lastPower && !this.match.race) peer.edgePower = true;
   peer.lastPower = i.power === true;
    if (i.interact === true && !peer.lastInteract && !this.match.race) peer.edgeInteract = true;
   peer.lastInteract = i.interact === true;
   if (i.reload === true && !peer.lastReload) peer.edgeReload = true;
   peer.lastReload = i.reload === true;
   if (i.melee === true && !peer.lastMelee) peer.edgeMelee = true;
   peer.lastMelee = i.melee === true;
   if (i.grenade === true && !peer.lastGrenade) peer.edgeGrenade = true;
   peer.lastGrenade = i.grenade === true;
 }
 setGear(peerId, gear, attachments, now = Date.now()) {
  const peer = this.peers.get(peerId);
  if (!peer || !peer.playerId || !this.progression || peer.spectate || peer.disconnectedAt !== null) return;
  if (peer.lastGearAt && now - peer.lastGearAt < 500) return;
  peer.lastGearAt = now;
  const profile = this.progression.setGear(peer.playerId, gear, attachments);
  if (profile) this.send(peerId, { type: 'progression', profile, gear: profile.gear, attachments: profile.attachments });
 }
 chat(peerId, text, now = Date.now()) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  const clean = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  if (!clean) return;
  if (peer.lastChatAt && now - peer.lastChatAt < 300) return;
  peer.lastChatAt = now;
  this.broadcast({ type: 'chat', peerId, name: peer.name, text: clean, time: now });
 }
 voiceState(peerId, enabled, config = () => ({ type: 'voice-config', iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate || peer.disconnectedAt !== null || typeof enabled !== 'boolean') return;
  if (enabled === (peer.voiceSession !== null)) return;
  // Disabling always works, even after exhausting the signaling budget.
  if (enabled) {
   if (!this.voiceBudget(peer, 0)) return;
   this.send(peerId, config(peerId));
   peer.voiceSession = randomUUID();
  } else peer.voiceSession = null;
  this.broadcast(this.lobby());
 }
 voiceBudget(peer, bytes, now = Date.now()) {
  if (!peer.voiceRate || now - peer.voiceRate.at >= 10000) peer.voiceRate = { at: now, count: 0, bytes: 0 };
  const rate = peer.voiceRate;
  if (rate.count >= 128 || rate.bytes + bytes > 256 * 1024) return false;
  rate.count++;
  rate.bytes += bytes;
  return true;
 }
 voicePeers(from, to, msg) {
  const source = this.peers.get(from), target = this.peers.get(to);
  return msg.roomId === this.id && from !== to && source && target &&
   !source.spectate && !target.spectate && source.disconnectedAt === null && target.disconnectedAt === null &&
   typeof msg.session === 'string' && msg.session.length === 36 && source.voiceSession === msg.session &&
   typeof msg.targetSession === 'string' && msg.targetSession.length === 36 && target.voiceSession === msg.targetSession;
 }
 voiceSignal(peerId, msg) {
  const peer = this.peers.get(peerId);
  if (!object(msg) || !peer || !this.voicePeers(peerId, msg.to, msg)) return;
  const description = Object.hasOwn(msg, 'description'), candidate = Object.hasOwn(msg, 'candidate');
  if (description === candidate) return;
  let payload;
  if (description) {
   const d = msg.description;
   if (!object(d) || !['offer', 'answer'].includes(d.type) || !bounded(d.sdp, 32 * 1024)) return;
   payload = { description: { type: d.type, sdp: d.sdp } };
  } else {
   const c = msg.candidate;
   if (c !== null && (!object(c) || !bounded(c.candidate, 4096) ||
    !(c.sdpMid === null || bounded(c.sdpMid, 256)) ||
    !(c.sdpMLineIndex === null || (Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex <= 65535)) ||
    !(c.usernameFragment === undefined || bounded(c.usernameFragment, 256)))) return;
   payload = { candidate: c === null ? null : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex,
    ...(c.usernameFragment === undefined ? {} : { usernameFragment: c.usernameFragment }) } };
  }
  const relay = { type: 'voice-signal', roomId: this.id, from: peerId, session: msg.session, targetSession: msg.targetSession, ...payload };
  if (this.voiceBudget(peer, Buffer.byteLength(JSON.stringify(relay)))) this.send(msg.to, relay);
 }
 leave(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  if (peer.actorId !== null && this.match && this.started && !this.roundOver) {
   const a = this.match.actors[peer.actorId];
   a.name = `${a.name} · BOT`;
   a.bot = { route: [], think: 0, target: -1, memory: 0, reaction: 0, stuck: 0, last: { x: a.x, y: a.y, z: a.z }, state: 'roam' };
  }
  peer.latest = null;
    peer.edgeFire = peer.edgeJump = peer.edgePower = peer.edgeInteract = false;
   peer.lastJump = peer.lastPower = peer.lastInteract = false;
   peer.edgeMelee = peer.lastMelee = false; peer.edgeReload = peer.lastReload = false; peer.edgeGrenade = false; peer.lastGrenade = false;
  peer.actorId = null;
  peer.voiceSession = null;
  this.peers.delete(peerId);
  if (this.hostId === peerId) this.hostId = this.nextConnectedHost();
  this.broadcast(this.lobby());
 }
 enableLagCompensation(enabled = true) {
  this.lagCompEnabled = enabled === true;
  if (!this.lagCompEnabled) this.transformHistory = [];
 }
 recordTransforms(time) {
  if (!this.lagCompEnabled || !this.match) return;
  this.transformHistory.push({ time, actors: this.match.actors.map(a => ({ id: a.id, x: a.x, y: a.y, z: a.z })) });
  while (this.transformHistory.length > this.transformHistoryLimit) this.transformHistory.shift();
 }
 transformsAt(time) {
  let found = null;
  for (const frame of this.transformHistory) {
   if (frame.time <= time) found = frame;
   else break;
  }
  return found;
 }
 tick(dt) {
  if (!this.match || this.roundOver) return;
  this.tickAcc += Math.min(dt, .25);
  let steps = 0;
  let broadcasted = false;
  while (this.tickAcc >= RULES.dt && steps < 5) {
     const inputs = {};
     for (const p of this.peers.values()) if (p.actorId !== null && (p.latest || p.edgeFire || p.edgeJump || p.edgePower || p.edgeInteract || p.edgeReload || p.edgeMelee || p.edgeGrenade)) {
     const ext = { ...(p.latest ?? {}) };
     if (p.edgeFire) { ext.fire = true; p.edgeFire = false; }
    if (p.edgeJump) { ext.jump = true; p.edgeJump = false; }
     if (p.edgePower) { ext.power = true; p.edgePower = false; }
     if (p.edgeInteract) { ext.interact = true; p.edgeInteract = false; }
     if (p.edgeReload) { ext.reload = true; p.edgeReload = false; }
     if (p.edgeMelee) { ext.melee = true; p.edgeMelee = false; }
     if (p.edgeGrenade) { ext.grenade = true; p.edgeGrenade = false; }
    inputs[p.actorId] = ext;
   }
     this.match.step(RULES.dt, { inputs });
     if (this.lagCompEnabled) this.recordTransforms(this.match.time);
    for (const p of this.peers.values()) if (p.actorId !== null && p.latest) p.appliedSeq = p.latestSeq;
   this.tickAcc -= RULES.dt;
   steps++;
    for (const p of this.peers.values()) if (p.actorId !== null || p.spectate) {
     const items = this.match.events.filter(e => e.id > p.lastSerial);
     if (items.length) { p.lastSerial = items[items.length - 1].id; this.send(p.id, { type: 'events', items: quantizeNumbers(structuredClone(items)) }); }
    }
    this.broadcastAt += RULES.dt;
     if (!broadcasted && this.broadcastAt >= this.snapshotInterval) { broadcasted = true; this.broadcastAt = 0; const acks = {}; for (const p of this.peers.values()) if (p.actorId !== null) acks[p.actorId] = p.appliedSeq; this.broadcast({ type: 'snapshot', seq: ++this.seq, acks, state: this.wireState() }); }
     if (this.match.over) {
      this.roundOver = true;
      const result = this.match.snapshot();
      const mode = this.match.config.mode;
       try { this.history?.record({ roomId: this.id, mapId: this.match.arena.id, config: this.match.config, time: this.match.time, actors: result.actors, teamScores: result.teamScores, winner: result.winner, endingReason: result.overReason ?? null, result }); }
      catch (error) { this.lastPersistError = error; }
      if (this.progression) {
       for (const p of this.peers.values()) {
        if (!p.playerId || p.actorId === null || p.spectate) continue;
        const actor = result.actors.find(a => a.id === p.actorId);
        const win = actorWon(result, mode, actor);
        try { const award = this.progression.award(p.playerId, { win, actor, mode }); if (award) this.send(p.id, { type: 'progression', ...award }); }
        catch (error) { this.lastPersistError = error; }
       }
      }
      this.broadcast({ type: 'results', state: result }); break;
    }
  }
 }
}
