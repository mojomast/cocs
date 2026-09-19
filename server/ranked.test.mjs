import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGameServer} from './game-server.mjs';
import {ratingFor} from './rooms.mjs';
import {START_RATING, rankFor} from '../game/ranked.mjs';

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'token-arena-ranked-')), 'progression.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TOKEN_A = 'A'.repeat(24), TOKEN_B = 'B'.repeat(24);
const ID_A = 'player-ranked-000a', ID_B = 'player-ranked-000b';

function connect(url) {
 return new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.onopen = () => resolve(ws);
  ws.onerror = () => reject(new Error('connection failed'));
 });
}
function send(ws, msg) { ws.send(JSON.stringify(msg)); }
const queues = new WeakMap();
function queue(ws) {
 let q = queues.get(ws);
 if (q) return q;
 q = {items: [], waiters: []};
 queues.set(ws, q);
 ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  const index = q.waiters.findIndex(w => w.type === msg.type && (!w.where || w.where(msg)));
  if (index >= 0) {
   const waiter = q.waiters[index];
   q.waiters.splice(index, 1);
   clearTimeout(waiter.timer);
   waiter.resolve(msg);
   return;
  }
  q.items.push(msg);
 });
 return q;
}
function until(ws, type, where = null, timeout = 30000) {
 const q = queue(ws);
 const index = q.items.findIndex(m => m.type === type && (!where || where(m)));
 if (index >= 0) return Promise.resolve(q.items.splice(index, 1)[0]);
 return new Promise((resolve, reject) => {
  const waiter = {type, where, resolve, reject,
   timer: setTimeout(() => { q.waiters = q.waiters.filter(w => w !== waiter); reject(new Error(`timeout waiting for ${type}`)); }, timeout)};
  q.waiters.push(waiter);
 });
}
async function waitFor(predicate, timeout = 5000) {
 const started = Date.now();
 while (Date.now() - started < timeout) {
  if (predicate()) return true;
  await sleep(25);
 }
 return predicate();
}
async function listen(server) { await new Promise(resolve => server.listen(0, resolve)); return `ws://127.0.0.1:${server.address().port}`; }
const rankedRoom = registry => [...registry.rooms.values()].find(room => room.ranked);

test('ranked queue rejects unverified careers and ignores client-supplied ratings', {timeout: 20000}, async () => {
 const {server, close, progression} = createGameServer({tickDt: 1 / 6});
 const url = await listen(server);
 const ws = await connect(url);
 try {
  send(ws, {type: 'queue', ranked: true, name: 'Spoofer', rating: 99999});
  const denied = await until(ws, 'error');
  assert.match(denied.message, /verified career/i);

  send(ws, {type: 'join', name: 'Rated', character: 'chatgpt', harness: 'openclaw', playerId: ID_A, progressToken: TOKEN_A});
  const welcome = await until(ws, 'welcome');
  assert.equal(welcome.profile.id, ID_A);
  assert.equal(welcome.profile.ladder.rating, START_RATING, 'welcome carries the server ladder record');

  // A token proves ownership of one profile; another player id is refused.
  send(ws, {type: 'queue', ranked: true, name: 'Thief', playerId: ID_B, progressToken: TOKEN_A, rating: 5000});
  const mismatch = await until(ws, 'error');
  assert.match(mismatch.message, /verified career/i);

  send(ws, {type: 'queue', ranked: true, name: 'Rated', playerId: ID_A, progressToken: TOKEN_A, rating: 5000});
  const queued = await until(ws, 'queue');
  assert.equal(queued.status, 'queued');
  assert.equal(queued.queue, 'ranked');
  assert.equal(queued.rating, START_RATING, 'the server rating wins over the client-supplied number');

  // There is no wire path that can write a rating.
  send(ws, {type: 'settle-ranked', playerId: ID_A, delta: 500});
  const unknown = await until(ws, 'error');
  assert.match(unknown.message, /unknown message type/);
  assert.equal(progression.get(ID_A).ladder.rating, START_RATING);

  send(ws, {type: 'queue-leave'});
  const left = await until(ws, 'queue');
  assert.equal(left.status, 'left');
 } finally {
  try { ws.close(); } catch {}
  await close();
 }
});

test('two ranked clients are drafted, rated exactly once and survive a reconnect', {timeout: 40000}, async () => {
 const file = tempFile();
 const {server, close, registry, progression} = createGameServer({tickDt: 1 / 6, progressionPath: file});
 const url = await listen(server);
 const a = await connect(url), b = await connect(url);
 let a2 = null;
 try {
  send(a, {type: 'join', name: 'Alpha', character: 'chatgpt', harness: 'openclaw', playerId: ID_A, progressToken: TOKEN_A});
  send(b, {type: 'join', name: 'Bravo', character: 'claude', harness: 'claudecode', playerId: ID_B, progressToken: TOKEN_B});
  const firstA = await until(a, 'welcome'), firstB = await until(b, 'welcome');
  assert.equal(firstA.profile.ladder.rating, START_RATING);
  assert.equal(firstB.profile.ladder.rating, START_RATING);

  send(a, {type: 'queue', ranked: true, name: 'Alpha', playerId: ID_A, progressToken: TOKEN_A});
  send(b, {type: 'queue', ranked: true, name: 'Bravo', playerId: ID_B, progressToken: TOKEN_B});
  const queuedA = await until(a, 'queue'), queuedB = await until(b, 'queue');
  assert.equal(queuedA.queue, 'ranked');
  assert.equal(queuedB.rating, START_RATING);

  const draftedA = await until(a, 'welcome', msg => msg.roomId !== firstA.roomId, 15000);
  const draftedB = await until(b, 'welcome', msg => msg.roomId !== firstB.roomId, 15000);
  assert.equal(draftedA.roomId, draftedB.roomId, 'both queued players land in one room');
  const matchmade = await until(a, 'matchmade');
  assert.equal(matchmade.ranked, true, 'the existing matchmade status carries the ranked flag');
  const lobby = await until(a, 'lobby', msg => msg.ranked?.queue === 'ranked' && msg.players.length === 2);
  assert.equal(lobby.ranked.matchId, null, 'no match id before the first start');
  assert.equal(lobby.ranked.players[draftedA.peerId].rating, START_RATING);

  const host = draftedA.host ? a : b;
  // botCount 2 is deliberately requested: the ranked policy must pin it to 0.
  send(host, {type: 'host', config: {mode: 'teamdeathmatch', botCount: 2, fragLimit: 5, timeLimit: 60}, mapId: 'crosswire'});
  send(host, {type: 'start'});
  await until(a, 'start', null, 15000);
  await until(b, 'start', null, 15000);

  const room = rankedRoom(registry);
  assert.ok(room, 'a ranked room exists');
  assert.equal(room.config.botCount, 0, 'ranked lobbies run without bots');
  assert.equal(room.match.config.botCount, 0);
  const alphaActor = room.match.actors.find(actor => actor.name === 'Alpha');
  assert.ok(alphaActor);
  room.match.winner = alphaActor.team;
  room.match.teamScores = {0: alphaActor.team === 0 ? 1 : 0, 1: alphaActor.team === 1 ? 1 : 0};
  room.match.over = true;
  assert.ok(await waitFor(() => room.ranked.settled === true && room.ranked.matchCount === 1, 8000), 'the match settles on the server tick');

  const ratingA = progression.get(ID_A).ladder.rating;
  const ratingB = progression.get(ID_B).ladder.rating;
  assert.ok(ratingA > START_RATING, `the winner climbed (${ratingA})`);
  assert.ok(ratingB < START_RATING, `the loser dropped (${ratingB})`);
  assert.equal(ratingA + ratingB, START_RATING * 2, 'the rated match is zero-sum');
  assert.equal(progression.get(ID_A).ladder.matches, 1);
  assert.deepEqual(progression.ladderBoard().map(row => row.playerId), [ID_A, ID_B]);
  assert.equal(progression.ladderBoard()[0].rank.label, rankFor(ratingA, 1).label);
  const settlement = room.ranked.lastSettlement;
  assert.equal(settlement.entries.length, 2);
  assert.equal(settlement.entries.find(entry => entry.playerId === ID_A).delta, ratingA - START_RATING);

  // Exactly once: a manual replay of the same match id is refused and the
  // ratings stay put across further server ticks.
  await sleep(350);
  assert.equal(progression.get(ID_A).ladder.rating, ratingA);
  assert.equal(progression.get(ID_B).ladder.rating, ratingB);
  assert.equal(progression.applyLadderSettlement(room.ranked.matchId, settlement.entries.map(entry => ({playerId: entry.playerId, delta: entry.delta}))), null);

  // Reconnect to the finished room: the seat returns, no second settlement.
  a2 = await connect(url);
  send(a2, {type: 'join', name: 'Alpha', character: 'chatgpt', harness: 'openclaw', token: draftedA.token, roomId: draftedA.roomId, playerId: ID_A, progressToken: TOKEN_A});
  const back = await until(a2, 'welcome', msg => msg.reconnected === true, 15000);
  assert.equal(back.roomId, draftedA.roomId);
  await sleep(250);
  assert.equal(progression.get(ID_A).ladder.rating, ratingA, 'reconnect does not re-apply the settlement');

  // Ratings survive a full server restart on the same store.
  await progression.whenPersisted();
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.ladder.players[ID_A].rating, ratingA);
  await close();
  const second = createGameServer({progressionPath: file});
  await listen(second.server);
  try {
   assert.equal(second.progression.get(ID_A).ladder.rating, ratingA);
   assert.equal(second.progression.ladderFor(ID_B).rating, ratingB);
   assert.ok(second.progression.ladderSettled.has(room.ranked.matchId), 'the settlement id reloads with the store');
   assert.equal(second.progression.applyLadderSettlement(room.ranked.matchId, [{playerId: ID_A, delta: 50}]), null);
   assert.equal(second.progression.get(ID_A).ladder.rating, ratingA);
  } finally {
   await second.close();
  }
 } finally {
  try { a.close(); b.close(); a2?.close(); } catch {}
  await close();
 }
});

test('unranked queue and rooms never touch the ladder', {timeout: 30000}, async () => {
 const file = tempFile();
 const {server, close, registry, progression} = createGameServer({tickDt: 1 / 6, progressionPath: file});
 const url = await listen(server);
 const a = await connect(url), b = await connect(url);
 try {
  send(a, {type: 'create', name: 'Casual', playerName: 'Alpha', character: 'chatgpt', harness: 'openclaw', playerId: ID_A, progressToken: TOKEN_A});
  const created = await until(a, 'welcome');
  send(b, {type: 'join', name: 'Bravo', character: 'claude', harness: 'claudecode', roomId: created.roomId, playerId: ID_B, progressToken: TOKEN_B});
  await until(b, 'welcome');
  const lobby = await until(a, 'lobby', msg => msg.players.length === 2);
  assert.equal(lobby.ranked.queue, 'unranked');
  assert.equal(lobby.ranked.matchId, null);
  assert.equal(lobby.ranked.players[created.peerId].rating, START_RATING, 'the lobby still reports the public ladder row');

  const room = [...registry.rooms.values()].find(entry => entry.id === created.roomId);
  assert.ok(room);
  assert.equal(room.ranked, undefined, 'unranked rooms carry no settlement marker');

  send(a, {type: 'host', config: {mode: 'teamdeathmatch', botCount: 0, fragLimit: 5, timeLimit: 60}, mapId: 'crosswire'});
  send(a, {type: 'start'});
  await until(a, 'start', null, 15000);
  await until(b, 'start', null, 15000);
  const alphaActor = room.match.actors.find(actor => actor.name === 'Alpha');
  room.match.winner = alphaActor.team;
  room.match.over = true;
  assert.ok(await waitFor(() => room.roundOver === true, 8000));
  await sleep(300);

  assert.equal(progression.get(ID_A).ladder.rating, START_RATING, 'unranked wins do not move the ladder');
  assert.equal(progression.get(ID_B).ladder.rating, START_RATING);
  assert.equal(progression.get(ID_A).ladder.matches, 0);
  assert.deepEqual(progression.ladderBoard(), []);

  // The shipped unranked queue keeps using the career-derived rating, not the ladder.
  send(a, {type: 'queue', name: 'Alpha', playerId: ID_A, progressToken: TOKEN_A});
  const queued = await until(a, 'queue');
  assert.equal(queued.queue, 'unranked');
  assert.equal(queued.rating, ratingFor(progression.get(ID_A)));
  assert.notEqual(queued.rating, START_RATING);
  send(a, {type: 'queue-leave'});
  await until(a, 'queue', msg => msg.status === 'left');
 } finally {
  try { a.close(); b.close(); } catch {}
  await close();
 }
});
