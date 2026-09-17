import {Match} from '../game/core.mjs';
import {normalizeConfig} from '../game/config.mjs';
import {isSinglePlayerMode} from '../game/singleplayer.mjs';
import {actorWon} from '../game/outcome.mjs';
import {getMap} from '../game/maps.mjs';
import {resolveMapForMode} from '../game/arenas.mjs';
import {CHARACTERS,resolveLoadout,RULES} from '../game/data.mjs';
import {randomUUID} from 'node:crypto';
import {validPlayerId,sanitizeText,parseInputEnvelope,PROTOCOL_VERSION,SNAPSHOT_DELTA_VERSION,SNAPSHOT_DELTA_MIN_BYTES,snapshotDelta,wireSize,MESSAGE} from '../game/protocol.mjs';

export const PLAYER_LIMIT = 8;
export const SPECTATOR_LIMIT = 24;
// Clients send inputs at 60 Hz; allow generous headroom and drop the excess so a
// flooding client cannot burn simulation time or unbounded server work.
export const INPUT_RATE_LIMIT = 120;
// Warmup countdown and the minimum fraction of connected players that must
// ready-up before a warmup-gated start is allowed. Defaults keep the direct
// host-start path (used everywhere else) unaffected.
export const WARMUP_SECONDS = 5;
export const REMATCH_RATIO = 0.5;
export const LIFECYCLE_PHASES = Object.freeze(['lobby', 'warmup', 'live', 'results']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, max) => typeof value === 'string' && value.length <= max;
// Match.snapshot() shares mutable or deeply frozen nested branches (powerups,
// objectiveNodes, ...), so quantizing it in place would corrupt authoritative
// state or throw on frozen map data. The shared non-mutating clone quantizer
// keeps client-visible rounding identical to the client codec.
import {quantizeClone as quantizedCopy} from '../game/quantize.mjs';

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
  this.seq = 0;
  // A delta chain needs a periodic full keyframe so a client that missed a
  // frame (the transport drops replaceable snapshots under backpressure) can
  // re-sync without waiting for the next match. Default: one keyframe a second.
  this.keyframeEvery = Math.max(0, Math.floor(Number(options.keyframeEvery) || this.snapshotHz));
  this.lastSnapshot = null;
  this.deltaFrames = 0;
  this.fullFrames = 0;
  this.out = [];
  // Deterministic lifecycle. `phase` is one of LIFECYCLE_PHASES; warmup runs a
  // fixed countdown before the host start is honored, and map votes are tallied
  // from connected players. `rematchVotes` gates the post-round rematch.
  this.phase = 'lobby';
  this.warmupSeconds = Math.max(0, Number(options.warmupSeconds ?? WARMUP_SECONDS));
  this.warmupTimer = 0;
  this.ready = new Set();
  this.mapVotes = new Map();
  this.rematchVotes = new Set();
  this.lifecycleRevision = 0;
  this.lastResult = null;
 }
 send(peerId, msg) { this.out.push({ to: peerId, msg }); }
 broadcast(msg) { this.out.push({ to: null, msg }); }
 drain() { const msgs = this.out; this.out = []; return msgs; }
 summary() {
  return { roomId: this.id, name: this.name, players: [...this.peers.values()].filter(p => p.disconnectedAt === null).length, started: this.started, mapId: this.mapId, config: this.config ? { ...this.config } : null };
 }
 // Outbound snapshots are quantized from a deep copy so the authoritative match
 // state (shared nested references such as powerups/gear) is never mutated.
 wireState() {
  if (!this.match) return null;
  return quantizedCopy(this.match.snapshot());
 }
 // Deterministic lifecycle view shared by the lobby message and the tests.
 lifecycle() {
  const players = [...this.peers.values()].filter(p => p.spectate !== true);
  const connected = players.filter(p => p.disconnectedAt === null);
  const readyCount = connected.filter(p => this.ready.has(p.id)).length;
  const needed = Math.max(1, Math.ceil(connected.length * REMATCH_RATIO));
  // A rematch needs a strict majority (> half), not a ratio-rounded quorum, so
  // one of two players cannot restart the match on their own.
  const rematchNeeded = Math.max(1, Math.floor(connected.length / 2) + 1);
  // Only connected, non-spectator peers count toward a vote quorum: a seat held
  // open after a disconnect (or superseded by a reconnect) must not keep voting.
  const live = new Set(connected.map(p => p.id));
  const votes = {};
  for (const [mapId, voters] of this.mapVotes) { const count = [...voters].filter(id => live.has(id)).length; if (count) votes[mapId] = count; }
  const winner = Object.entries(votes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const rematch = [...this.rematchVotes].filter(id => live.has(id)).length;
  return {
   phase: this.phase,
   revision: this.lifecycleRevision,
   warmup: this.phase === 'warmup' ? Math.max(0, Math.ceil(this.warmupTimer)) : 0,
   ready: readyCount,
   readyNeeded: needed,
   readyRatio: connected.length ? readyCount / connected.length : 0,
   mapVotes: votes,
   mapVoteWinner: winner,
    rematch,
    rematchNeeded,
    rematchReady: this.roundOver && this.started && rematch >= rematchNeeded,
  };
 }
 lobby() {
  return { type: 'lobby', roomId: this.id, name: this.name, hostId: this.hostId, started: this.started,
   config: this.config ? { ...this.config } : null, mapId: this.mapId, lifecycle: this.lifecycle(),
   players: [...this.peers.values()].map(p => ({ peerId: p.id, name: p.name, character: p.character, harness: p.harness, actorId: p.actorId, ready: this.ready.has(p.id) || p.ready, connected: p.disconnectedAt === null, spectate: p.spectate === true, voiceSession: p.voiceSession })) };
 }
 // Mark a player ready for the warmup gate. Ready state is keyed by the stable
 // peer id and cleared on join/leave so a reconnecting peer must re-ready.
 setReady(peerId, ready = true) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate) return false;
  const next = ready !== false;
  if (next) this.ready.add(peerId); else this.ready.delete(peerId);
  if (peer.ready !== next) { peer.ready = next; this.lifecycleRevision++; this.broadcast(this.lobby()); }
  return next;
 }
 // One vote per player. Voting replaces the player's previous choice so the
 // tally always reflects current intent rather than a running total.
 mapVote(peerId, mapId) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate || typeof mapId !== 'string' || !mapId) return null;
  for (const voters of this.mapVotes.values()) voters.delete(peerId);
  const voters = this.mapVotes.get(mapId) || new Set();
  voters.add(peerId);
  this.mapVotes.set(mapId, voters);
  this.lifecycleRevision++;
  this.broadcast(this.lobby());
  return mapId;
 }
 // A rematch needs a majority of connected players; once met the host may
 // restart without re-running warmup.
 requestRematch(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate || !this.roundOver) return false;
  this.rematchVotes.add(peerId);
  this.lifecycleRevision++;
  this.broadcast(this.lobby());
  return this.lifecycle().rematchReady;
 }
 // Enter warmup: the host start arms a countdown; the match itself is created
 // when the countdown reaches zero (see tick). A zero warmup starts immediately.
 beginWarmup(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate || peerId !== this.hostId) return false;
  const players = [...this.peers.values()].filter(p => p.spectate !== true && p.disconnectedAt === null);
  if (!players.length) return false;
  const needed = Math.max(1, Math.ceil(players.length * REMATCH_RATIO));
  if (this.warmupSeconds <= 0 || this.ready.size >= needed) return this.start(peerId);
  this.phase = 'warmup';
  this.warmupTimer = this.warmupSeconds;
  this.lifecycleRevision++;
  this.broadcast(this.lobby());
  return true;
 }
 cancelWarmup() {
  if (this.phase !== 'warmup') return false;
  this.phase = 'lobby';
  this.warmupTimer = 0;
  this.lifecycleRevision++;
  this.broadcast(this.lobby());
  return true;
 }
 nextConnectedHost() { for (const p of this.peers.values()) if (p.spectate !== true && p.disconnectedAt === null) return p.id; return null; }
 progressProfile(peer) { if (!this.progression || !peer?.playerId || !peer.playerToken) return null; return this.progression.getOwned(peer.playerId, peer.playerToken); }
 join(peerId, name = '', character = 'chatgpt', harness = 'openclaw', token = '', spectate = false, playerId = '', progressToken = '', deltaVersion = 0) {
  if (this.peers.has(peerId)) return;
  const delta = Math.min(SNAPSHOT_DELTA_VERSION, Math.max(0, Math.floor(Number(deltaVersion) || 0)));
  if (token) {
   const existing = [...this.peers.values()].find(p => p.token === token);
   if (existing) {
    if (existing.disconnectedAt === null) {
     // A reconnect can arrive before the old socket's close event is processed.
     // Newest connection wins: adopt the peer and seat on this socket. The old
     // socket's later close is a no-op because the peer id is reassigned below.
     existing.disconnectedAt = Date.now();
    }
    const oldId = existing.id;
    this.peers.delete(oldId);
      existing.id = peerId;
      existing.deltaVersion = delta;
       this.ready.delete(oldId); this.rematchVotes.delete(oldId); for (const voters of this.mapVotes.values()) voters.delete(oldId); existing.ready = false;
       existing.disconnectedAt = null;
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
    this.send(peerId, { type: 'welcome', v: PROTOCOL_VERSION, peerId, roomId: this.id, host: peerId === this.hostId, reconnected: true, token: existing.token, spectate: existing.spectate === true, profile: this.progressProfile(existing), progressToken: existing.playerToken ?? null });
    this.broadcast(this.lobby());
    if (this.started && !this.roundOver && this.match) {
     this.send(peerId, { type: 'start', config: { ...this.match.config }, mapId: this.match.arena.id });
     const state = this.wireState(), seq = ++this.seq;
     existing.snapshotBase = { seq, state };
     this.send(peerId, { type: 'snapshot', seq, acks: { [existing.actorId]: existing.appliedSeq }, state });
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
  const identity = this.progression ? this.progression.identify(validPlayerId(playerId) ? playerId : '', progressToken) : null;
  if (this.phase === 'warmup') this.cancelWarmup();
  const peer = { id: peerId, name: sanitizeText(name, 20) || CHARACTERS.find(c => c.id === l.character).name,
    character: l.character, harness: l.harness, actorId: null, ready: false, latest: null, receivedSeq: 0, latestSeq: 0, appliedSeq: 0, lastSerial: active ? this.match.serial : 0,
     lastJump: false, lastPower: false, lastInteract: false, lastReload: false, edgeFire: false, edgeJump: false, edgePower: false, edgeInteract: false, edgeMelee: false, lastMelee: false, edgeReload: false, edgeGrenade: false, lastGrenade: false,
   token: randomUUID(), disconnectedAt: null, spectate: isSpectator, voiceSession: null, playerId: identity?.profile.id ?? null, playerToken: identity?.token ?? null, deltaVersion: delta, snapshotBase: null };
  this.peers.set(peerId, peer);
  if (!this.hostId && !isSpectator) this.hostId = peerId;
  this.send(peerId, { type: 'welcome', v: PROTOCOL_VERSION, peerId, roomId: this.id, host: peerId === this.hostId, token: peer.token, spectate: isSpectator, profile: identity?.profile ?? null, progressToken: peer.playerToken });
  this.broadcast(this.lobby());
  if (requestedPlayer && active) this.send(peerId, { type: 'error', message: 'Match in progress — you joined as a spectator.' });
  if (isSpectator && this.started && !this.roundOver && this.match) {
   this.send(peerId, { type: 'start', config: { ...this.match.config }, mapId: this.match.arena.id });
    const state = this.wireState(), seq = ++this.seq;
    peer.snapshotBase = { seq, state };
    this.send(peerId, { type: 'snapshot', seq, acks: { [this.peers.get(peerId)?.actorId ?? -1]: 0 }, state });
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
  // Single-player modes are local-only; never let a network host start one.
  if (isSinglePlayerMode(this.config.mode)) { this.send(peerId, { type: 'error', message: 'single-player modes are local only' }); this.config.mode = 'deathmatch'; }
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
    this.match = new Match('chatgpt', 'openclaw', this.random, this.mapId, { ...this.config ?? {}, humanCount, loadouts: players.map(p => { const profile = this.progressProfile(p); return { character: p.character, harness: p.harness, gear: profile?.gear, attachments: profile?.attachments, finish: profile?.finish }; }) });
   if (this.match.race) this.config = { ...this.match.config };
  let i = 0;
   for (const p of players) { p.actorId = i; this.match.actors[i].name = p.name; p.latest = null; p.receivedSeq = p.latestSeq = p.appliedSeq = 0; p.lastSerial = 0; p.edgeJump = p.edgePower = p.edgeInteract = false; p.lastJump = p.lastPower = p.lastInteract = false; p.edgeMelee = p.lastMelee = false; p.edgeReload = p.lastReload = false; p.edgeGrenade = false; p.lastGrenade = false; i++; }
   for (const p of this.peers.values()) { p.edgeFire = false; p.edgeReload = p.lastReload = false; p.edgeGrenade = false; p.lastGrenade = false; if (p.spectate) p.lastSerial = 0; }
  this.started = true;
  this.roundOver = false;
  this.phase = 'live';
  this.warmupTimer = 0;
  this.rematchVotes.clear();
  this.tickAcc = 0;
  this.broadcastAt = 0;
  // A new match invalidates every delta chain: the first post-start frame is a
  // full snapshot and each peer's base is reset.
  this.lastSnapshot = null;
  for (const p of this.peers.values()) p.snapshotBase = null;
  this.broadcast(this.lobby());
  this.broadcast({ type: 'start', config: { ...this.config }, mapId: this.mapId });
  return true;
 }
 input(peerId, input) {
  const peer = this.peers.get(peerId);
   if (!peer || peer.disconnectedAt !== null || peer.spectate || peer.actorId === null || !this.match || this.roundOver) return;
  const now = Date.now();
  if (!peer.inputRate || now - peer.inputRate.at >= 1000) peer.inputRate = { at: now, count: 0 };
  if (peer.inputRate.count >= INPUT_RATE_LIMIT) return;
  peer.inputRate.count++;
  const i = parseInputEnvelope(input);
   const requested = i.seq ?? peer.receivedSeq + 1;
   // A rogue or buggy client could jump its sequence far ahead, after which every
   // real input looks stale. Accept modest forward progress only; a stale or
   // duplicate sequence is ignored as before.
   const seq = requested > peer.receivedSeq + 600 ? peer.receivedSeq + 1 : requested;
   if (seq <= peer.receivedSeq) return;
   peer.receivedSeq = seq;
     const ext = { x: i.x, z: i.z, fire: i.fire };
   if (this.match.race) Object.assign(ext, { jump: i.jump, power: i.power, interact: i.interact });
  if (i.yaw !== undefined) ext.yaw = i.yaw;
  if (i.pitch !== undefined) ext.pitch = i.pitch;
  if (i.weapon !== undefined) ext.weapon = i.weapon;
  if (i.sprint) ext.sprint = true;
  if (i.crouch) ext.crouch = true;
  if (i.ads) ext.ads = true;
  // The class movement verb is a held state, never an edge: the client keeps
  // sending true while the bind is down, and the core derives the press/release
  // edges. A forwarded pulse would fake a release and cancel an active grapple.
  if (i.mobility) ext.mobility = true;
    peer.latest = ext;
    peer.latestSeq = seq;
    if (i.fire && !this.match.race) peer.edgeFire = true;
   if (i.jump && !peer.lastJump && !this.match.race) peer.edgeJump = true;
  peer.lastJump = i.jump;
    if (i.power && !peer.lastPower && !this.match.race) peer.edgePower = true;
   peer.lastPower = i.power;
    if (i.interact && !peer.lastInteract && !this.match.race) peer.edgeInteract = true;
   peer.lastInteract = i.interact;
   if (i.reload && !peer.lastReload) peer.edgeReload = true;
   peer.lastReload = i.reload;
   if (i.melee && !peer.lastMelee) peer.edgeMelee = true;
   peer.lastMelee = i.melee;
   if (i.grenade && !peer.lastGrenade) peer.edgeGrenade = true;
   peer.lastGrenade = i.grenade;
 }
 setGear(peerId, gear, attachments, now = Date.now(), finish) {
  const peer = this.peers.get(peerId);
  if (!peer || !peer.playerId || !this.progression || peer.spectate || peer.disconnectedAt !== null) return;
  if (peer.lastGearAt && now - peer.lastGearAt < 500) return;
  peer.lastGearAt = now;
  const profile = this.progression.setGearOwned(peer.playerId, peer.playerToken, gear, attachments, finish);
  if (profile) this.send(peerId, { type: 'progression', profile, gear: profile.gear, attachments: profile.attachments });
 }
 chat(peerId, text, now = Date.now()) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  const clean = sanitizeText(text, 200);
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
  peer.playerToken = null;
  this.peers.delete(peerId);
  this.ready.delete(peerId);
  this.rematchVotes.delete(peerId);
  for (const voters of this.mapVotes.values()) voters.delete(peerId);
  if (this.phase === 'warmup') { this.phase = 'lobby'; this.warmupTimer = 0; }
  if (this.hostId === peerId) this.hostId = this.nextConnectedHost();
  this.broadcast(this.lobby());
 }
 deliverEvents() {
  let first = Infinity;
  for (const p of this.peers.values()) {
   if (p.disconnectedAt !== null || (p.actorId === null && !p.spectate)) continue;
   if (p.lastSerial < first) first = p.lastSerial;
  }
  if (first === Infinity) return;
  const items = this.match.events.filter(e => e.id > first);
  if (!items.length) return;
  const shared = quantizedCopy(items);
  const newest = shared[shared.length - 1].id;
  for (const p of this.peers.values()) {
   if (p.disconnectedAt !== null || (p.actorId === null && !p.spectate) || p.lastSerial >= newest) continue;
   let index = 0;
   while (shared[index].id <= p.lastSerial) index++;
   const delta = shared.slice(index);
   p.lastSerial = newest;
   this.send(p.id, { type: 'events', items: delta });
  }
 }
 tick(dt) {
  if (this.phase === 'warmup') {
   this.warmupTimer -= Math.min(dt, .25);
   if (this.warmupTimer <= 0) {
    this.warmupTimer = 0;
    const host = this.hostId ?? this.nextConnectedHost();
    if (host !== null) this.start(host);
    else { this.phase = 'lobby'; this.lifecycleRevision++; this.broadcast(this.lobby()); }
   }
   return;
  }
  if (!this.match || this.roundOver) return;
  this.tickAcc += Math.min(dt, .25);
  let steps = 0;
  let broadcasted = false;
  let ended = false;
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
    for (const p of this.peers.values()) if (p.actorId !== null && p.latest) p.appliedSeq = p.latestSeq;
   this.tickAcc -= RULES.dt;
   steps++;
    this.broadcastAt += RULES.dt;
     if (!broadcasted && this.broadcastAt >= this.snapshotInterval) {
      broadcasted = true; this.broadcastAt = 0;
      const state = this.wireState();
      const seq = ++this.seq;
      const acks = {};
      for (const p of this.peers.values()) if (p.actorId !== null) acks[p.actorId] = p.appliedSeq;
      const prev = this.lastSnapshot;
      const keyframe = this.keyframeEvery > 0 && seq % this.keyframeEvery === 0;
      // The patch is identical for every peer whose base is the previous
      // broadcast, so it is computed once per tick rather than once per peer.
      let patch = null;
      if (!keyframe && prev) {
       patch = snapshotDelta(prev.state, state);
       if (patch && wireSize({ type: MESSAGE.SNAPSHOT_DELTA, seq, base: prev.seq, acks, patch }) + SNAPSHOT_DELTA_MIN_BYTES >= wireSize({ type: MESSAGE.SNAPSHOT, seq, acks, state })) patch = null;
      }
      for (const p of this.peers.values()) {
       const canDelta = !!patch && p.deltaVersion >= SNAPSHOT_DELTA_VERSION && prev && p.snapshotBase?.seq === prev.seq;
       if (canDelta) { this.send(p.id, { type: MESSAGE.SNAPSHOT_DELTA, v: PROTOCOL_VERSION, seq, base: prev.seq, acks, patch }); this.deltaFrames++; }
       else { this.send(p.id, { type: MESSAGE.SNAPSHOT, v: PROTOCOL_VERSION, seq, acks, state }); this.fullFrames++; }
       p.snapshotBase = { seq, state };
      }
      this.lastSnapshot = { seq, state };
     }
     if (this.match.over) { ended = true; break; }
  }
  this.deliverEvents();
  if (ended) {
   this.roundOver = true;
   this.phase = 'results';
   this.lifecycleRevision++;
   const result = this.match.snapshot();
   this.lastResult = result;
   const mode = this.match.config.mode;
    try { this.history?.record({ roomId: this.id, mapId: this.match.arena.id, config: this.match.config, time: this.match.time, actors: result.actors, teamScores: result.teamScores, winner: result.winner, endingReason: result.overReason ?? null, result }); }
   catch {}
   if (this.progression) {
    for (const p of this.peers.values()) {
     if (!p.playerId || p.actorId === null || p.spectate) continue;
     const actor = result.actors.find(a => a.id === p.actorId);
     const win = actorWon(result, mode, actor);
     try { const award = this.progression.awardOwned(p.playerId, p.playerToken, { win, actor, mode }); if (award) this.send(p.id, { type: 'progression', ...award }); }
     catch {}
    }
   }
   this.broadcast({ type: 'results', state: result });
  }
 }
}
