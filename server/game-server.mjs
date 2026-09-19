import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomRegistry, Matchmaker, ratingFor } from './rooms.mjs';
import { MatchHistory } from './history.mjs';
import { ProgressionStore } from './progression.mjs';
import { MESSAGE } from '../game/protocol.mjs';
import { normalizeConfig, teamMode } from '../game/config.mjs';
import { actorWon } from '../game/outcome.mjs';
import { PLACEMENT_MATCHES, isRankedMode, settleMatch } from '../game/ranked.mjs';
import { createHmac } from 'node:crypto';

export function voiceConfig(peerId, env = process.env, now = Date.now()) {
 const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
 const urls = (env.TURN_URLS ?? '').split(',').map(url => url.trim()).filter(url => /^turns?:[^\s@]+$/i.test(url)).slice(0, 8);
 if (urls.length && env.TURN_SECRET) {
  const username = `${Math.floor(now / 1000) + 3600}:${peerId}`;
  iceServers.push({ urls, username, credential: createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
 }
 return { type: 'voice-config', iceServers };
}

const VOICE_BUFFER_LIMIT = 64 * 1024;
export const TRAFFIC_BUFFER_LIMIT = 512 * 1024;
export const HEARTBEAT_MS = 15000;
export const CONTROL_RATE_LIMIT = 60;
export const CONTROL_RATE_WINDOW = 1000;
export const MAX_CLIENTS = 256;

// Pure drain for a peer's coalesced essential queue. Sends every entry that fits
// in the remaining budget, in order, skipping entries addressed to a room the
// peer has already left. A single control message larger than the entire budget
// would otherwise block every later reply forever, so once the socket has
// drained it is sent rather than starving the queue. Returns the count sent.
export function drainEssential(queue, { bufferedAmount = 0, limit = TRAFFIC_BUFFER_LIMIT, current = null, send } = {}) {
 let sent = 0;
 while (queue.length && bufferedAmount < limit) {
  const entry = queue[0];
  if ((entry.room ?? null) !== current) { queue.shift(); continue; }
  const size = Number.isFinite(entry.size) ? entry.size : Buffer.byteLength(entry.text);
  if (size <= limit && bufferedAmount + size > limit) break;
  queue.shift();
  send(entry.text);
  bufferedAmount += size;
  sent++;
 }
 return sent;
}

export function createGameServer({ port = 0, random, tickDt = 1 / 60, tickMs = 1000 / 60, graceMs, snapshotHz, historyPath = null, progressionPath = null, maxClients = MAX_CLIENTS } = {}) {
 const history = new MatchHistory(historyPath);
 const progression = new ProgressionStore(progressionPath);
  const registry = new RoomRegistry({ random, graceMs, history, progression, snapshotHz, onError: (error, room) => console.error(`room ${room?.id ?? '?'} tick failed`, error) });
  const matchmaker = new Matchmaker({ random });
  // Ranked queue: a second Matchmaker with the same deterministic rules, kept
  // separate so unranked drafting is byte-for-byte the shipped behaviour and a
  // ranked queue can never be pulled into an unranked room (or vice versa).
  const rankedMatchmaker = new Matchmaker({ random });
  const sockets = new Map();
 const socketPeer = new WeakMap();
 const peerRoom = new Map();
 let historyCache = null;
 let historyCacheVersion = -1;
 const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  const players = [...registry.rooms.values()].reduce((n, r) => n + r.peers.size, 0);
  let deltaFrames = 0, fullFrames = 0;
  for (const room of registry.rooms.values()) { deltaFrames += room.deltaFrames ?? 0; fullFrames += room.fullFrames ?? 0; }
  res.end(JSON.stringify({ service: 'token-arena-game-server', rooms: registry.rooms.size, players, port: server.address()?.port ?? port, snapshot: { deltaFrames, fullFrames } }));
 });
 const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
 let nextPeer = 1;
 // Snapshots and voice traffic are replaceable; protocol transitions
 // (welcome/start/results/lobby/errors) are not. Essential messages that hit a
 // congested socket are coalesced by type and pumped once the buffer drains,
 // rather than being silently dropped.
 const REPLACEABLE = new Set([MESSAGE.SNAPSHOT, MESSAGE.SNAPSHOT_DELTA, MESSAGE.EVENTS, MESSAGE.VOICE_SIGNAL]);
  function queueEssential(ws, text, type) {
   const queue = ws.pendingEssential || (ws.pendingEssential = []);
   // Tag with the peer's room so messages queued for one room are never
   // delivered after the peer has switched to another. The byte size is cached
   // so the drain loop does not re-measure every entry every pass.
   const entry = { text, room: peerRoom.get(socketPeer.get(ws)) ?? null, type, size: Buffer.byteLength(text) };
   const index = queue.findIndex(item => item.type === type);
   if (index >= 0) queue[index] = entry;
   else if (queue.length >= 64) queue.shift();
   else queue.push(entry);
  }
  function pumpEssential(ws) {
   const queue = ws.pendingEssential;
   if (!queue?.length || ws.readyState !== ws.OPEN) return;
   const current = peerRoom.get(socketPeer.get(ws)) ?? null;
   drainEssential(queue, { bufferedAmount: ws.bufferedAmount, limit: TRAFFIC_BUFFER_LIMIT, current, send: text => ws.send(text) });
   if (!queue.length) ws.pendingEssential = null;
  }
  function deliver(ws, msg, text = JSON.stringify(msg)) {
   if (!ws || ws.readyState !== ws.OPEN) return false;
   // Only high-rate voice signalling uses the small voice budget; VOICE_CONFIG is
   // a one-shot control message, so a busy socket queues it instead of dying.
   const voice = msg?.type === MESSAGE.VOICE_SIGNAL;
   const limit = voice ? VOICE_BUFFER_LIMIT : TRAFFIC_BUFFER_LIMIT;
   if (ws.bufferedAmount + Buffer.byteLength(text) <= limit) { ws.send(text); return true; }
   if (REPLACEABLE.has(msg?.type)) return false;
   queueEssential(ws, text, msg?.type);
   return false;
  }
  function sendTo(peerId, msg) {
   const ws = sockets.get(peerId);
   if (!ws) return;
   deliver(ws, msg);
  }
 function releaseSeat(peerId) {
  const old = peerRoom.get(peerId);
  if (old) { old.leave(peerId); registry.removeIfEmpty(old); }
 }
 function joinPeer(peerId, msg) {
  const roomId = typeof msg.roomId === 'string' && msg.roomId ? msg.roomId : 'local';
  const room = registry.get(roomId);
  if (!room) { sendTo(peerId, { type: 'error', message: `room not found: ${roomId}` }); return; }
  room.join(peerId, msg.name, msg.character, msg.harness, msg.token, msg.spectate === true, msg.playerId, msg.progressToken, msg.delta);
  if (!room.peers.has(peerId)) return;
  if (peerRoom.get(peerId) !== room) releaseSeat(peerId);
  peerRoom.set(peerId, room);
 }
 function createRoom(peerId, msg) {
  const room = registry.create(msg.name);
  if (!room) { sendTo(peerId, { type: 'error', message: 'server is at the room limit' }); return; }
  room.join(peerId, msg.playerName ?? msg.name, msg.character, msg.harness, msg.token, false, msg.playerId, msg.progressToken, msg.delta);
  if (!room.peers.has(peerId)) return;
  releaseSeat(peerId);
  peerRoom.set(peerId, room);
 }
 // Pop a balanced draft from the matchmaking queue and seat every player in a
 // fresh room. Team assignments are sent to each peer so the client can show
 // the balanced sides before the host starts. Returns the new room or null.
 // A ranked draft marks the room server-side: the settlement pass only ever
 // touches rooms carrying that marker, so unranked play cannot move a rating.
 function draftQueue(queue = matchmaker, ranked = false) {
  const draft = queue.draft(ranked ? { even: true } : undefined);
  if (!draft) return null;
  const room = registry.create(ranked ? 'Ranked' : 'Matchmade');
  if (!room) { for (const player of draft.players) queue.enqueue(player); return null; }
  if (ranked) {
   room.ranked = { queue: 'ranked', matchId: null, matchCount: 0, settled: false, skipped: 0, lastSettlement: null };
   // Ranked lobbies run without bots: the lobby default is a clean team match
   // and the HOST/START dispatch paths pin botCount to 0 so a client cannot opt
   // back into AI opponents for a rated game.
   room.config = normalizeConfig({ mode: 'teamdeathmatch', botCount: 0 });
  }
  draft.teams.forEach((team, teamIndex) => {
   for (const player of team) {
    const ws = sockets.get(player.peerId);
    if (!ws || ws.readyState !== ws.OPEN) { queue.remove(player.peerId); continue; }
    room.join(player.peerId, player.name, undefined, undefined, '', false, player.playerId, player.progressToken);
    if (!room.peers.has(player.peerId)) continue;
    releaseSeat(player.peerId);
    peerRoom.set(player.peerId, room);
    sendTo(player.peerId, { type: 'matchmade', roomId: room.id, team: teamIndex, rating: player.rating, ranked, teams: draft.teams.map(t => t.map(p => ({ peerId: p.peerId, name: p.name, rating: p.rating }))) });
   }
  });
  return room;
 }
 function controlAllowed(ws, now = Date.now()) {
  if (ws.controlRate && now - ws.controlRate.at < CONTROL_RATE_WINDOW) {
   if (ws.controlRate.count >= CONTROL_RATE_LIMIT) return false;
  } else ws.controlRate = { at: now, count: 0 };
  ws.controlRate.count++;
  return true;
 }
 function dispatch(peerId, msg, ws) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
  if (msg.type !== MESSAGE.INPUT && !controlAllowed(ws)) {
   if (++ws.protocolErrors > 20) { ws.terminate(); return; }
   sendTo(peerId, { type: 'error', message: 'rate limit exceeded' });
   return;
  }
  switch (msg.type) {
   case MESSAGE.VOICE_STATE: peerRoom.get(peerId)?.voiceState(peerId, msg.enabled, voiceConfig); break;
   case MESSAGE.VOICE_SIGNAL: peerRoom.get(peerId)?.voiceSignal(peerId, msg); break;
  case MESSAGE.JOIN: joinPeer(peerId, msg); break;
  case MESSAGE.CREATE: createRoom(peerId, msg); break;
  case MESSAGE.LIST: sendTo(peerId, { type: 'rooms', rooms: registry.list() }); break;
  case 'ready': peerRoom.get(peerId)?.setReady(peerId, msg.ready !== false); break;
  case 'map-vote': peerRoom.get(peerId)?.mapVote(peerId, msg.mapId); break;
  case 'rematch': peerRoom.get(peerId)?.requestRematch(peerId); break;
  case 'warmup': {
   const room = peerRoom.get(peerId);
   if (room) { if (msg.cancel === true) room.cancelWarmup(); else room.beginWarmup(peerId); }
   break;
  }
  case 'queue': {
   // Ranked entries are only admitted when the peer proves ownership of a
   // career with its progress token: the queue rating then comes from the
   // server-side ladder, never from the message. `msg.rating` is ignored on
   // purpose so a client cannot hand itself a rating.
   const ranked = msg.ranked === true;
   const profile = progression.getOwned(msg.playerId, msg.progressToken);
   if (ranked && !profile) { sendTo(peerId, { type: 'error', message: 'ranked queue requires a verified career' }); break; }
   const queue = ranked ? rankedMatchmaker : matchmaker;
   const playerId = ranked ? profile.id : msg.playerId;
   const entry = queue.enqueue({ peerId, name: msg.name, rating: ranked ? progression.ladderRating(profile.id) : ratingFor(profile), playerId, progressToken: msg.progressToken, ranked });
   if (!entry) { sendTo(peerId, { type: 'error', message: 'matchmaking queue is full' }); break; }
   sendTo(peerId, { type: 'queue', status: 'queued', queue: ranked ? 'ranked' : 'unranked', position: queue.position(peerId), size: queue.size(), rating: entry.rating });
   break;
  }
  case 'queue-leave': matchmaker.remove(peerId); rankedMatchmaker.remove(peerId); sendTo(peerId, { type: 'queue', status: 'left', size: matchmaker.size(), rankedSize: rankedMatchmaker.size() }); break;
  case 'queue-list': sendTo(peerId, { type: 'queue', status: 'list', players: matchmaker.list(), ranked: rankedMatchmaker.list() }); break;
  case MESSAGE.HISTORY: {
   if (!historyCache || historyCacheVersion !== history.version) { historyCache = history.all(); historyCacheVersion = history.version; }
   sendTo(peerId, { type: 'history', matches: historyCache });
   break;
  }
  case 'leaderboard': sendTo(peerId, { type: 'leaderboard', mode: typeof msg.mode === 'string' ? msg.mode : null, rows: progression.leaderboard({ mode: typeof msg.mode === 'string' ? msg.mode : null }) }); break;
  case 'profile': {
   const profile = progression.getOwned(msg.playerId, msg.progressToken);
   sendTo(peerId, { type: 'profile', profile });
   break;
  }
    case MESSAGE.HOST: {
     const room = peerRoom.get(peerId);
     // Ranked policy: bots are pinned off before the room validates the config,
     // so a host cannot farm a rated match against the easy AI.
     if (room?.ranked && msg.config && typeof msg.config === 'object' && !Array.isArray(msg.config)) {
      msg = { ...msg, config: { ...msg.config, botCount: 0 } };
     }
     room?.host(peerId, msg.config, msg.mapId);
     break;
    }
    case MESSAGE.GEAR: peerRoom.get(peerId)?.setGear(peerId, msg.gear, msg.attachments, undefined, msg.finish); break;
    case MESSAGE.LOADOUT: peerRoom.get(peerId)?.setLoadout(peerId, msg.character, msg.harness); break;
    // LATTICE STRIKE actions (§11.2). Each handler applies its own per-peer
    // token bucket and validates against the authoritative match.
    case MESSAGE.ORDER: peerRoom.get(peerId)?.order(peerId, msg); break;
    case MESSAGE.ECONOMY: peerRoom.get(peerId)?.economy(peerId, msg); break;
    case MESSAGE.TERMINAL: peerRoom.get(peerId)?.terminal(peerId, msg); break;
    case MESSAGE.COMMAND: peerRoom.get(peerId)?.command(peerId, msg); break;
    case MESSAGE.BUY: peerRoom.get(peerId)?.buy(peerId, msg); break;
   case MESSAGE.START: {
     const room = peerRoom.get(peerId);
     if (room?.ranked && room.config) room.config = { ...room.config, botCount: 0 };
     room?.start(peerId);
     break;
   }
    case MESSAGE.INPUT: peerRoom.get(peerId)?.input(peerId, msg); break;
    case MESSAGE.CHAT: {
     const room = peerRoom.get(peerId);
     if (room) room.chat(peerId, msg.text);
     else sendTo(peerId, { type: 'error', message: 'not in a room' });
     break;
    }
   case MESSAGE.LEAVE: {
    const room = peerRoom.get(peerId);
    if (room) { room.leave(peerId); peerRoom.delete(peerId); registry.removeIfEmpty(room); }
    break;
   }
   case MESSAGE.PING: sendTo(peerId, { type: 'pong', time: Date.now() }); break;
   default: sendTo(peerId, { type: 'error', message: `unknown message type: ${msg.type}` });
  }
 }
 function rewindEvents(room, peerId, msg) {
  if (msg.type !== MESSAGE.EVENTS || !Array.isArray(msg.items) || !msg.items.length) return;
  const peer = room.peers.get(peerId);
  const first = msg.items[0]?.id;
  if (peer && Number.isInteger(first) && first > 0) peer.lastSerial = Math.min(peer.lastSerial, first - 1);
 }
 // Ranked lobby projection. Attached to the existing `lobby` message so the
 // client gets queue mode, live match id, the last settlement and each seated
 // player's public ladder row without a new wire type.
 function rankedLobbyView(room) {
  const players = {};
  let any = false;
  for (const peer of room.peers.values()) {
   if (!peer.playerId) continue;
   const record = progression.ladderFor(peer.playerId);
   players[peer.id] = { rating: record.rating, matches: record.matches, peak: record.peak, provisional: record.matches < PLACEMENT_MATCHES };
   any = true;
  }
  if (!any && !room.ranked) return null;
  return {
   queue: room.ranked ? 'ranked' : 'unranked',
   active: room.started === true && room.roundOver !== true,
   matchId: room.ranked?.matchId ?? null,
   settled: room.ranked?.matchCount ?? 0,
   skipped: room.ranked?.skipped ?? 0,
   ...(room.ranked?.lastSettlement ? { last: room.ranked.lastSettlement } : {}),
   players,
  };
 }
 // Settle every ranked room whose authoritative match just ended. Only rooms
 // marked by draftQueue are eligible, so unranked play can never move a rating.
 // Exactly once: `ranked.settled` arms per match and the progression store also
 // rejects a repeated match id, so a reconnect, duplicated tick or server
 // restart cannot apply the same delta twice.
 function settleRankedRooms() {
  for (const room of registry.rooms.values()) {
   const ranked = room.ranked;
   if (!ranked || !room.started) continue;
   if (!room.roundOver) {
    if (ranked.settled || ranked.matchId) { ranked.settled = false; ranked.matchId = null; }
    continue;
   }
   if (ranked.settled || !room.lastResult) continue;
   ranked.settled = true;
   const result = room.lastResult;
   const mode = result?.config?.mode ?? room.config?.mode ?? null;
   const config = { ...(room.config ?? {}), ...(result?.config ?? {}) };
   // Rated lobbies run without bots (HOST/START pin botCount to 0) and only in
   // ranked-eligible modes. Anything else is a practice result and is skipped.
   if (!isRankedMode(mode) || Number(config.botCount) > 0) { ranked.skipped++; continue; }
   const actors = new Map((Array.isArray(result.actors) ? result.actors : []).map(actor => [actor.id, actor]));
   const seated = [...room.peers.values()].filter(peer => !peer.spectate && peer.playerId && peer.actorId !== null && peer.actorId !== undefined && actors.has(peer.actorId));
   if (seated.length < 2) { ranked.skipped++; continue; }
   const isTeam = teamMode(mode);
   const groups = new Map();
   for (const peer of seated) {
    const actor = actors.get(peer.actorId);
    const key = isTeam && (actor.team === 0 || actor.team === 1) ? `team:${actor.team}` : `solo:${peer.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(peer);
   }
   if (groups.size < 2) { ranked.skipped++; continue; }
   const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
   const roster = {};
   const byPlayer = new Map();
   for (const peer of seated) {
    const record = progression.ladderFor(peer.playerId);
    roster[peer.playerId] = { rating: record.rating, matches: record.matches };
    byPlayer.set(peer.playerId, peer);
   }
   const settlement = settleMatch({
    teams: keys.map(key => groups.get(key).map(peer => peer.playerId)),
    scores: keys.map(key => {
     if (isTeam) {
      const team = Number(key.slice(key.indexOf(':') + 1));
      return result.winner === team ? 1 : result.winner === null || result.winner === undefined ? 0.5 : 0;
     }
     return groups.get(key).some(peer => actorWon(result, mode, actors.get(peer.actorId))) ? 1 : 0;
    }),
    players: roster,
   });
   if (!settlement) { ranked.skipped++; continue; }
   const matchId = `${room.id}:${ranked.matchCount + 1}`;
   const applied = progression.applyLadderSettlement(matchId, settlement.entries);
   ranked.matchCount++;
   ranked.matchId = matchId;
   const appliedById = new Map((applied ?? []).map(entry => [entry.playerId, entry]));
   ranked.lastSettlement = {
    matchId,
    mode,
    entries: settlement.entries.filter(entry => appliedById.has(entry.playerId)).map(entry => {
     const peer = byPlayer.get(entry.playerId);
     const record = appliedById.get(entry.playerId);
     return { peerId: peer?.id ?? null, playerId: entry.playerId, name: peer?.name ?? '', team: entry.team, win: entry.score === 1, placement: entry.placement, before: record.before, delta: record.delta, rating: record.after };
    }),
   };
   room.broadcast({ ...room.lobby(), ranked: rankedLobbyView(room) });
  }
 }
 function flush() {
  for (const room of registry.rooms.values()) {
   for (const entry of room.drain()) {
    const { to } = entry;
    let { msg } = entry;
    if (msg.type === 'lobby') {
     const ranked = rankedLobbyView(room);
     if (ranked) msg = { ...msg, ranked };
    }
    if (msg.type === MESSAGE.VOICE_SIGNAL && (!room.voicePeers(msg.from, to, msg) ||
     peerRoom.get(msg.from) !== room || peerRoom.get(to) !== room ||
     sockets.get(msg.from)?.readyState !== 1)) continue;
     const text = JSON.stringify(msg);
    if (to === null) {
     for (const ws of wss.clients) if (ws.readyState === ws.OPEN && peerRoom.get(socketPeer.get(ws)) === room) deliver(ws, msg, text);
    } else {
      const ws = sockets.get(to);
      if (msg.type === MESSAGE.VOICE_CONFIG && peerRoom.get(to) !== room) continue;
      if (!ws || ws.readyState !== ws.OPEN) { rewindEvents(room, to, msg); continue; }
      if (!deliver(ws, msg, text)) rewindEvents(room, to, msg);
    }
   }
  }
  for (const ws of wss.clients) if (ws.pendingEssential?.length) pumpEssential(ws);
 }
 wss.on('connection', ws => {
  if (wss.clients.size > maxClients) { try { ws.close(1013, 'server full'); } catch {} return; }
  const peerId = nextPeer++;
  ws.isAlive = true;
  sockets.set(peerId, ws);
  socketPeer.set(ws, peerId);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.protocolErrors = 0;
  ws.on('message', data => {
   let msg;
   try { msg = JSON.parse(data.toString()); }
   catch { if (++ws.protocolErrors > 20) { ws.terminate(); return; } sendTo(peerId, { type: 'error', message: 'invalid JSON' }); return; }
   try { dispatch(peerId, msg, ws); }
   catch (e) { if (++ws.protocolErrors > 20) { ws.terminate(); return; } sendTo(peerId, { type: 'error', message: String(e?.message ?? e) }); }
   flush();
  });
  ws.on('close', () => {
   sockets.delete(peerId);
   matchmaker.remove(peerId);
   rankedMatchmaker.remove(peerId);
   const room = peerRoom.get(peerId);
   if (room) { room.disconnect(peerId); peerRoom.delete(peerId); }
   flush();
  });
  ws.on('error', () => {});
 });
  const timer = setInterval(() => {
   try { registry.tickAll(tickDt); registry.expireAll(); } catch (error) { console.error('server tick failed', error); }
   // Settle ranked results before drafting so a finished match frees its room
   // and the next queue pops against fresh ratings.
   try { settleRankedRooms(); } catch (error) { console.error('ranked settlement failed', error); }
   try { while (matchmaker.size() >= matchmaker.teamSize * 2) { if (!draftQueue(matchmaker, false)) break; } } catch (error) { console.error('matchmaking draft failed', error); }
   try { while (rankedMatchmaker.size() >= rankedMatchmaker.minPlayers) { if (!draftQueue(rankedMatchmaker, true)) break; } } catch (error) { console.error('ranked matchmaking draft failed', error); }
  try {
   const pinned = new Set();
   for (const room of registry.rooms.values()) for (const p of room.peers.values()) if (p.playerId) pinned.add(p.playerId);
   progression.setPinned?.(pinned);
  } catch {}
  Promise.resolve(history.flush?.()).catch(error => console.error('history flush failed', error));
  Promise.resolve(progression.flush?.()).catch(error => console.error('progression flush failed', error));
  try { flush(); } catch (error) { console.error('outbound flush failed', error); }
 }, tickMs);
 const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (ws.isAlive === false) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch {} } }, HEARTBEAT_MS);
 async function close() {
  clearInterval(timer);
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close();
  wss.close();
  server.close();
  await Promise.allSettled([Promise.resolve(history.flush?.()), Promise.resolve(progression.flush?.())]);
 }
 return { server, wss, close, registry, history, progression };
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
 const { server, close } = createGameServer({ port: Number(process.env.PORT) || 4000, historyPath: fileURLToPath(new URL('./history.json', import.meta.url)), progressionPath: fileURLToPath(new URL('./progression.json', import.meta.url)) }); server.listen(Number(process.env.PORT) || 4000, () => {
  const { port } = server.address();
  console.log(`COCS game server listening on ws://0.0.0.0:${port} (http://localhost:${port})`);
  console.log('Join from the browser client at ws://localhost:' + port);
 });
 for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await close(); process.exit(0); });
}
