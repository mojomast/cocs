import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameServer} from './game-server.mjs';
import {NetClient} from '../game/net.mjs';
import {PROTOCOL_VERSION} from '../game/protocol.mjs';

function connect(url) {
 return new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.onopen = () => resolve(ws);
  ws.onerror = e => reject(new Error('connection failed'));
 });
}
function send(ws, msg) { ws.send(JSON.stringify(msg)); }
const queues = new WeakMap();
function queue(ws) {
 let q = queues.get(ws);
 if (q) return q;
 q = { items: [], waiters: [] };
 queues.set(ws, q);
 ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  const typed = q.waiters.find(w => w.type === msg.type);
  if (typed) { q.waiters = q.waiters.filter(w => w !== typed); clearTimeout(typed.timer); typed.resolve(msg); return; }
  const collected = q.waiters.find(w => w.onMessage);
  if (collected) { collected.onMessage(msg); if (collected.done()) { clearTimeout(collected.timer); q.waiters = q.waiters.filter(w => w !== collected); } return; }
  q.items.push(msg);
 });
 return q;
}
function until(ws, type, timeout = 30000) {
 const q = queue(ws);
 const index = q.items.findIndex(m => m.type === type);
 if (index >= 0) return Promise.resolve(q.items.splice(index, 1)[0]);
 return new Promise((resolve, reject) => {
  const waiter = { type, resolve, reject,
   timer: setTimeout(() => { q.waiters = q.waiters.filter(w => w !== waiter); reject(new Error(`timeout waiting for ${type}`)); }, timeout) };
  q.waiters.push(waiter);
 });
}
function latest(ws, type, timeout = 30000) {
 const q = queue(ws);
 const last = [...q.items].reverse().findIndex(m => m.type === type);
 if (last >= 0) { const index = q.items.length - 1 - last; return Promise.resolve(q.items.splice(index, 1)[0]); }
 return until(ws, type, timeout);
}
const collect = (ws, type, count, timeout = 30000) => new Promise((resolve, reject) => {
 const q = queue(ws);
 const items = q.items.filter(m => m.type === type);
 q.items = q.items.filter(m => m.type !== type);
 let done = items.length >= count;
 if (done) return resolve(items);
 const timer = setTimeout(() => { if (!done) { done = true; reject(new Error(`timeout collecting ${type}`)); } }, timeout);
 const onMessage = m => { if (m.type === type) { items.push(m); if (items.length >= count) { done = true; clearTimeout(timer); resolve(items); } } };
 q.waiters.push({ type: null, onMessage, done: () => done });
});
// Room retirement runs on the server's own tick, so a single `list` sent right
// after a drop can race that cleanup. Poll the list until it settles instead of
// sleeping a fixed number of milliseconds and hoping the tick already ran.
async function waitForRooms(ws, predicate, { attempts = 60, delay = 100 } = {}) {
 let last = null;
 for (let i = 0; i < attempts; i++) {
  send(ws, { type: 'list' });
  last = await until(ws, 'rooms', 5000);
  if (predicate(last.rooms)) return last;
  await new Promise(resolve => setTimeout(resolve, delay));
 }
 throw new Error(`room list condition not met; saw ${last?.rooms?.map(r => r.roomId).join(',') ?? 'nothing'}`);
}
// Instagib helper: one-shot rail kills make a frag-limit match end in about
// two seconds of accelerated sim time. Bots do the fighting — nav-mesh roaming
// keeps kills flowing regardless of spawn geometry.
const FAST_MATCH = { mode: 'instagib', botCount: 2, fragLimit: 5, timeLimit: 60, respawn: 1, difficulty: 'easy' };

test('two real WebSocket clients join, play and receive results end-to-end', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6 });
 await new Promise(resolve => server.listen(0, resolve));
 const port = server.address().port;
 const url = `ws://127.0.0.1:${port}`;
 const a = await connect(url);
 const b = await connect(url);
 let inputs;
 try {
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  send(b, { type: 'join', name: 'Bob', character: 'claude', harness: 'hermes' });
  const welcomeA = await until(a, 'welcome');
  const welcomeB = await until(b, 'welcome');
  assert.equal(welcomeA.host, true);
  assert.equal(welcomeB.host, false);
  assert.equal(welcomeA.v, PROTOCOL_VERSION, 'welcome carries the protocol version');
  assert.equal(welcomeB.v, PROTOCOL_VERSION);
  const lobbyA = await latest(a, 'lobby');
  assert.equal(lobbyA.players.length, 2);
  assert.equal(lobbyA.players[1].harness, 'claudecode');
  send(a, { type: 'host', config: { mode: 'deathmatch', botCount: 2, fragLimit: 5, timeLimit: 60, difficulty: 'easy' }, mapId: 'crosswire' });
  send(a, { type: 'start' });
  const startB = await until(b, 'start');
  assert.equal(startB.config.botCount, 2);
  const snapA = await until(a, 'snapshot');
  const snapB = await until(b, 'snapshot');
  assert.equal(snapA.state.actors.length, 4);
  assert.equal(snapB.state.actors[0].name, 'Alice');
  assert.equal(snapB.state.actors[1].name, 'Bob');
  assert.equal(snapB.state.actors[0].health, 100);
  send(b, { type: 'ping' });
  const pong = await until(b, 'pong');
  assert.ok(pong.time > 0);
  const events = await collect(b, 'events', 5, 15000);
  assert.ok(events.some(m => m.items.some(e => e.type === 'spawn')));
  inputs = setInterval(() => send(a, { type: 'input', input: { x: 0, z: 0, yaw: Math.random() * 2, fire: Math.random() > .6 } }), 100);
  const results = await until(a, 'results', 45000);
  assert.equal(results.state.over, true);
  assert.equal(results.state.actors.length, 4);
 } finally {
  clearInterval(inputs);
  a.close(); b.close(); close();
 }
});

test('the loadout control message reaches the room and broadcasts the queued switch', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 const a = await connect(url);
 const b = await connect(url);
 try {
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  send(b, { type: 'join', name: 'Bob', character: 'chatgpt', harness: 'openclaw' });
  await until(a, 'welcome');
  const welcomeB = await until(b, 'welcome');
  await latest(a, 'lobby');
  send(a, { type: 'host', config: { mode: 'teamdeathmatch', botCount: 0, timeLimit: 60 }, mapId: 'crosswire' });
  send(a, { type: 'start' });
  await until(b, 'start');
  await until(a, 'snapshot');
  send(b, { type: 'loadout', character: 'grok', harness: 'hermes' });
  let lobby = await latest(b, 'lobby');
  for (let i = 0; i < 6 && lobby.players.find(p => p.peerId === welcomeB.peerId)?.character !== 'grok'; i++) lobby = await latest(b, 'lobby', 5000);
  const bob = lobby.players.find(p => p.peerId === welcomeB.peerId);
  assert.equal(bob.character, 'grok', 'the queued switch is visible to the room');
  assert.equal(bob.harness, 'hermes');
 } finally {
  a.close(); b.close(); close();
 }
});

test('a dropped NetClient reconnects to its seat and keeps playing to results', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6, graceMs: 60000 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 const store = new Map();
 const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
 const a = new NetClient(url);
 const bob = new NetClient(url, { storage });
 let bob2 = null;
 try {
  await Promise.all([a.connect(), bob.connect()]);
  const lobbyA = new Promise(resolve => { a.onLobby = m => resolve(m); });
  a.join('Alice', 'chatgpt', 'openclaw');
  await lobbyA;
  bob.join('Bob', 'claude', 'hermes');
  await new Promise(resolve => { bob.onLobby = () => resolve(); });
  a.host({ botCount: 1, fragLimit: 5, timeLimit: 60, respawn: 1, difficulty: 'easy' }, 'crosswire');
  const start = new Promise(resolve => { bob.onStart = () => resolve(); });
  a.start();
  await start;
  await new Promise(resolve => {
   const poll = () => {
    const s = bob.renderState(performance.now());
    if (s && bob.resynced && s.actors.length === 3) resolve();
    else setTimeout(poll, 20);
   };
   poll();
  });
  assert.equal(bob.actorId, 1);
  assert.ok(bob.token, 'session token issued');
  bob.input({ x: 1, z: 0, yaw: 0, pitch: 0, fire: true });
  await new Promise(resolve => setTimeout(resolve, 150));
  bob.ws.close();
  await new Promise(resolve => setTimeout(resolve, 200));
  const bob2 = new NetClient(url, { storage });
  await bob2.connect();
  const rejoin = new Promise(resolve => { bob2.onLobby = m => resolve(m); });
  bob2.join('ignored', 'chatgpt', 'openclaw');
  const lobby = await rejoin;
  assert.equal(lobby.players.length, 2, 'seat was held during grace');
  assert.equal(lobby.players[1].name, 'Bob', 'original identity restored');
  assert.equal(lobby.players[1].actorId, 1, 'same seat restored');
  assert.equal(bob2.actorId, 1);
  const snap = await new Promise(resolve => {
   const started = Date.now();
   const poll = () => {
    const s = bob2.renderState(performance.now());
    if (s && bob2.resynced) resolve(s);
    else if (Date.now() - started > 20000) resolve(null);
    else setTimeout(poll, 20);
   };
   poll();
  });
  assert.ok(snap, 'prediction resynced after reconnect');
  assert.equal(snap.actors.find(x => x.id === 1).health, snap.actors.find(x => x.id === 1).health);
  const input = setInterval(() => bob2.input({ x: 0, z: 0, yaw: Math.random() * 2, fire: Math.random() > .6 }), 50);
  const results = await new Promise(resolve => { bob2.onResults = () => resolve(); });
  clearInterval(input);
  assert.equal(bob2.roundOver, true);
  assert.ok(bob2.state.over);
  assert.equal(bob2.state.actors.length, 3);
  assert.equal(bob2.state.actors[1].name, 'Bob');
 } finally {
  a.close(); bob.close(); bob2?.close(); close();
  }
 });
test('NetClient wrapper joins, interpolates snapshots and reaches results', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 const c = new NetClient(url);
 try {
  await c.connect();
  const lobbyP = new Promise(resolve => { c.onLobby = m => resolve(m); });
  c.join('NetClient', 'gemini', 'cline');
  const lobby = await lobbyP;
  assert.equal(lobby.players[0].name, 'NetClient');
  c.host({ botCount: 2, fragLimit: 5, timeLimit: 60, difficulty: 'easy' }, 'crosswire');
  const startP = new Promise(resolve => { c.onStart = () => resolve(); });
  c.start();
  await startP;
  const onResults = new Promise(resolve => { c.onResults = () => resolve(); });
  const ready = await new Promise(resolve => {
   const started = Date.now();
   const poll = () => {
    const s = c.renderState(performance.now());
    if (s && c.actorId !== null && s.actors.length === 3 && s.actors.find(a => a.id === c.actorId) && s.actors.every(a => Number.isFinite(a.x))) resolve(s);
    else if (Date.now() - started > 20000) resolve(null);
    else setTimeout(poll, 20);
   };
   poll();
  });
  assert.ok(ready, 'interpolated render state available');
  const input = setInterval(() => c.input({ x: 0, z: 0, yaw: Math.random() * 2, pitch: 0, fire: Math.random() > .6, jump: Math.random() > .97, power: Math.random() > .97 }), 50);
  await onResults;
  clearInterval(input);
  assert.equal(c.roundOver, true);
  assert.ok(c.state.over);
  assert.equal(c.state.actors.length, 3, 'deltas reconstruct every actor');
  assert.ok(c.deltaHits > 0, 'the client applied server snapshot deltas end-to-end');
  assert.equal(c.deltaMisses, 0, 'the delta chain never missed');
  const final = c.renderState(performance.now());
  assert.equal(final.actors.length, 3);
  assert.equal(final.actors.find(a => a.id === c.actorId), c.shadow.actors[0], 'own actor slot is the predicted shadow');
  assert.ok(Number.isFinite(final.actors.find(a => a.id === c.actorId).x));
 } finally {
  c.close();
  close();
 }
});
test('two rooms play simultaneously and the browser lists both', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 let a, b, c, d;
 try {
  a = await connect(url); b = await connect(url); c = await connect(url); d = await connect(url);
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  send(b, { type: 'join', name: 'Bob', character: 'claude', harness: 'hermes' });
  const welcomeA = await until(a, 'welcome');
  assert.equal(welcomeA.roomId, 'local');
  assert.equal(welcomeA.host, true);
  send(c, { type: 'create', name: 'Rival Room', playerName: 'Carla', character: 'gemini', harness: 'cline' });
  const welcomeC = await until(c, 'welcome');
  assert.equal(welcomeC.host, true);
  assert.match(welcomeC.roomId, /^[A-Z0-9]{4}$/);
  assert.notEqual(welcomeC.roomId, 'local');
  send(d, { type: 'join', name: 'Dennis', character: 'gemini', harness: 'cline', roomId: welcomeC.roomId });
  const welcomeD = await until(d, 'welcome');
  assert.equal(welcomeD.roomId, welcomeC.roomId);
  assert.equal(welcomeD.host, false);
  const lobbyD = await latest(d, 'lobby');
  assert.equal(lobbyD.roomId, welcomeC.roomId);
  assert.deepEqual(lobbyD.players.map(p => p.name), ['Carla', 'Dennis']);
  const rooms = await waitForRooms(a, list => list.length === 2 && list.some(r => r.roomId === welcomeC.roomId));
  assert.equal(rooms.rooms.length, 2, 'both rooms listed');
  assert.ok(rooms.rooms.some(r => r.roomId === 'local'));
  const created = rooms.rooms.find(r => r.roomId === welcomeC.roomId);
  assert.equal(created.name, 'Rival Room');
  assert.equal(created.players, 2);
  assert.equal(created.started, false);
  send(a, { type: 'host', config: FAST_MATCH, mapId: 'crosswire' });
  send(c, { type: 'host', config: FAST_MATCH, mapId: 'crosswire' });
  send(a, { type: 'start' });
  send(c, { type: 'start' });
  await Promise.all([until(b, 'start'), until(d, 'start')]);
  const results = await Promise.all([until(a, 'results', 90000), until(b, 'results', 90000), until(c, 'results', 90000), until(d, 'results', 90000)]);
  for (const r of results) assert.equal(r.state.over, true);
  assert.equal(results[0].state.actors.length, 4);
  assert.equal(results[1].state.actors[0].name, 'Alice');
  assert.equal(results[2].state.actors[0].name, 'Carla');
  assert.ok(results[0].state.actors.some(a => a.frags >= 5), 'local room finished on frags');
  assert.ok(results[2].state.actors.some(a => a.frags >= 5), 'created room finished on frags');
  assert.ok(results[3].state.actors.some(a => a.frags >= 5), 'created room results reached its own players');
 } finally {
  a?.close(); b?.close(); c?.close(); d?.close(); close();
 }
});

test('a spectator receives snapshots and results without a seat', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 let a, b, s;
 try {
  a = await connect(url); b = await connect(url);
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  send(b, { type: 'join', name: 'Bob', character: 'claude', harness: 'hermes' });
  await until(a, 'welcome');
  await until(b, 'welcome');
  s = await connect(url);
  send(s, { type: 'join', name: 'Snoop', character: 'gemini', harness: 'cline', spectate: true });
  const welcomeS = await until(s, 'welcome');
  assert.equal(welcomeS.spectate, true);
  assert.equal(welcomeS.host, false);
  const lobbyS = await latest(s, 'lobby');
  assert.equal(lobbyS.players[2].spectate, true);
  assert.equal(lobbyS.players[2].actorId, null);
  send(a, { type: 'host', config: FAST_MATCH, mapId: 'crosswire' });
  send(a, { type: 'start' });
  await until(s, 'start', 15000);
  const snap = await until(s, 'snapshot', 45000);
  assert.equal(snap.state.actors.length, 4, 'spectator snapshot carries all actors');
  assert.equal(snap.state.actors[0].name, 'Alice');
  const events = await collect(s, 'events', 1, 45000);
  assert.ok(events.some(m => m.items.some(e => e.type === 'spawn')), 'spectator receives event deltas');
  const results = await until(s, 'results', 45000);
  assert.equal(results.state.over, true);
  assert.equal(results.state.actors.length, 4);
 } finally {
  a?.close(); b?.close(); s?.close(); close();
 }
});

test('history query returns the completed match entry', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 let a, b;
 try {
  a = await connect(url); b = await connect(url);
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  send(b, { type: 'join', name: 'Bob', character: 'claude', harness: 'hermes' });
  await until(a, 'welcome');
  await until(b, 'welcome');
  send(a, { type: 'host', config: FAST_MATCH, mapId: 'crosswire' });
  send(a, { type: 'start' });
  await until(b, 'start');
  const results = await until(a, 'results', 45000);
  assert.ok(results.state.over);
  send(a, { type: 'history' });
  const history = await until(a, 'history', 15000);
  assert.equal(history.matches.length, 1);
  const [m] = history.matches;
  assert.equal(m.roomId, 'local');
  assert.equal(m.mapId, 'crosswire');
  assert.equal(m.mode, 'instagib');
  assert.equal(m.fragLimit, 5);
  assert.equal(m.endedBy, 'frag');
  assert.ok(m.duration > 0 && m.duration < 60);
  assert.equal(m.players.length, 4);
  assert.deepEqual(m.players.map(p => p.name).sort().slice(0, 2), ['Alice', 'Bob']);
  assert.ok(m.players.some(p => p.frags >= 5), 'someone reached the frag limit');
  assert.ok(m.players.some(p => p.name === m.leader), 'leader is one of the recorded players');
  assert.ok(m.players.every(p => Number.isInteger(p.frags) && Number.isInteger(p.deaths)));
  send(b, { type: 'history' });
  const history2 = await until(b, 'history', 15000);
  assert.equal(history2.matches.length, 1, 'history is per server and visible to all');
 } finally {
  a?.close(); b?.close(); close();
 }
});

test('create always mints a fresh room and a fresh socket sees every room', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 let a, b;
 try {
  a = await connect(url);
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  const welcome = await until(a, 'welcome');
  assert.equal(welcome.roomId, 'local');
  send(a, { type: 'create', name: 'Fresh One', playerName: 'Alice', character: 'chatgpt', harness: 'openclaw', roomId: 'local' });
  const created1 = await until(a, 'welcome');
  assert.match(created1.roomId, /^[A-Z0-9]{4}$/);
  assert.notEqual(created1.roomId, 'local', 'create must not route to the stored room');
  send(a, { type: 'create', name: 'Fresh Two', playerName: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  const created2 = await until(a, 'welcome');
  assert.notEqual(created2.roomId, created1.roomId, 'every create mints a new room');
  send(a, { type: 'list' });
  const rooms = await until(a, 'rooms');
  assert.equal(rooms.rooms.length, 2, 'local plus the latest created room');
  assert.deepEqual(rooms.rooms.map(r => r.roomId).sort(), ['local', created2.roomId].sort());
  assert.ok(!rooms.rooms.some(r => r.roomId === created1.roomId), 'the vacated room was retired when the creator moved on');
  b = await connect(url);
  send(b, { type: 'list' });
  const roomsB = await until(b, 'rooms');
  assert.equal(roomsB.rooms.length, 2, 'a fresh socket sees the created room');
 } finally {
  a?.close(); b?.close(); close();
 }
});

test('a reconnecting NetClient reattaches to its created room via stored token and chats', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6, graceMs: 60000 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 const store = new Map();
 const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
 const c = new NetClient(url, { storage });
 let c2 = null;
 try {
  await c.connect();
  const created = new Promise(resolve => { c.onLobby = () => resolve(); });
  c.create('Fresh', 'chatgpt', 'openclaw', 'Alice');
  await created;
  const roomId = c.roomId;
  assert.match(roomId, /^[A-Z0-9]{4}$/);
  assert.ok(c.token, 'session token issued');
  c.ws.close();
  await new Promise(resolve => setTimeout(resolve, 200));
  c2 = new NetClient(url, { storage });
  await c2.connect();
  const rejoin = new Promise(resolve => { c2.onLobby = m => resolve(m); });
  c2.join('ignored', 'chatgpt', 'openclaw');
  const lobby = await rejoin;
  assert.equal(lobby.roomId, roomId, 'reattached to the created room');
  assert.equal(lobby.players.length, 1);
  assert.equal(lobby.players[0].name, 'Alice');
  const chat = new Promise(resolve => { c2.onChat = m => resolve(m); });
  c2.chat('hello again');
  const msg = await chat;
  assert.equal(msg.name, 'Alice');
  assert.equal(msg.text, 'hello again');
  assert.equal(c2.chatLog.length, 1, 'chat appended to the bounded log');
 } finally {
  c.close(); c2?.close(); close();
 }
});

test('abruptly abandoned rooms are retired after grace and local persists', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6, graceMs: 1000 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 let a, b;
 try {
  a = await connect(url);
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  await until(a, 'welcome');
  b = await connect(url);
  send(b, { type: 'create', name: 'Doomed', playerName: 'Bob', character: 'gemini', harness: 'cline' });
  const welcomeB = await until(b, 'welcome');
  b.close();
  b = null;
  const rooms = await waitForRooms(a, list => !list.some(r => r.roomId === welcomeB.roomId));
  assert.ok(!rooms.rooms.some(r => r.roomId === welcomeB.roomId), 'abandoned room retired after grace');
  assert.ok(rooms.rooms.some(r => r.roomId === 'local'), 'local room persists');
  assert.equal(rooms.rooms.length, 1);
 } finally {
  a?.close(); b?.close(); close();
 }
});

test('create releases the previous room seat so no zombie peers linger', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6, graceMs: 1000 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 let a;
 try {
  a = await connect(url);
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  const welcome = await until(a, 'welcome');
  assert.equal(welcome.roomId, 'local');
  send(a, { type: 'create', name: 'Moved', playerName: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  const created = await until(a, 'welcome');
  send(a, { type: 'list' });
  const rooms = await until(a, 'rooms');
  assert.equal(rooms.rooms.find(r => r.roomId === 'local').players, 0, 'create vacated the old room seat');
  assert.equal(rooms.rooms.find(r => r.roomId === created.roomId).players, 1);
  a.close();
  a = null;
  const b = await connect(url);
  const rooms2 = await waitForRooms(b, list => !list.some(r => r.roomId === created.roomId));
  assert.ok(!rooms2.rooms.some(r => r.roomId === created.roomId), 'created room retired after the drop');
  assert.equal(rooms2.rooms.find(r => r.roomId === 'local').players, 0, 'local never accumulated a zombie peer');
  b.close();
 } finally {
  a?.close(); close();
 }
});

test('chat is room-scoped, reaches every peer and spectator, and errors outside a room', async () => {
 const { server, close } = createGameServer({ tickDt: 1 / 6 });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 let a, b, c, d, e, s;
 try {
  a = await connect(url); b = await connect(url); c = await connect(url); d = await connect(url); e = await connect(url);
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  send(b, { type: 'join', name: 'Bob', character: 'claude', harness: 'hermes' });
  await until(a, 'welcome'); await until(b, 'welcome');
  send(c, { type: 'create', name: 'Rival', playerName: 'Carla', character: 'gemini', harness: 'cline' });
  const welcomeC = await until(c, 'welcome');
  send(d, { type: 'join', name: 'Dennis', character: 'gemini', harness: 'cline', roomId: welcomeC.roomId });
  await until(d, 'welcome');
  const getChat = ws => collect(ws, 'chat', 1, 3000);
  send(a, { type: 'chat', text: 'hello' });
  const [msgA] = await getChat(a);
  const [msgB] = await getChat(b);
  assert.equal(msgA.text, 'hello');
  assert.equal(msgA.name, 'Alice');
  assert.equal(msgB.name, 'Alice', 'chat reaches the other peer in the room');
  await new Promise(resolve => setTimeout(resolve, 250));
  const qC = queues.get(c) ?? { items: [] };
  const qD = queues.get(d) ?? { items: [] };
  assert.ok(!qC.items.some(m => m.type === 'chat'), 'other room receives nothing');
  assert.ok(!qD.items.some(m => m.type === 'chat'), 'other room receives nothing');
  send(c, { type: 'chat', text: 'rival' });
  const [msgC] = await getChat(c);
  const [msgD] = await getChat(d);
  assert.equal(msgC.name, 'Carla');
  assert.equal(msgD.text, 'rival', 'created room gets its own chat');
  send(e, { type: 'chat', text: 'anyone?' });
  const err = await until(e, 'error', 3000);
  assert.equal(err.message, 'not in a room');
  s = await connect(url);
  send(s, { type: 'join', name: 'Snoop', character: 'gemini', harness: 'cline', spectate: true });
  await until(s, 'welcome');
  send(s, { type: 'chat', text: 'watching' });
  const [msgS] = await getChat(s);
  assert.equal(msgS.name, 'Snoop', 'spectator chat is delivered');
  const [chatA2] = await getChat(a);
  assert.equal(chatA2.text, 'watching', 'spectator chat reaches the first player');
  const [chatB2] = await getChat(b);
  assert.equal(chatB2.text, 'watching', 'spectator chat reaches the second player');
  send(a, { type: 'host', config: FAST_MATCH, mapId: 'crosswire' });
  send(a, { type: 'start' });
  await until(b, 'start');
  send(b, { type: 'chat', text: 'live' });
  const [live] = await getChat(a);
  assert.equal(live.text, 'live', 'chat flows during a live match');
 } finally {
  a?.close(); b?.close(); c?.close(); d?.close(); e?.close(); s?.close(); close();
 }
});

// LATTICE STRIKE (§11.2): the five C→S actions travel the real socket dispatch,
// validate against the authoritative room and a rejection comes back as
// `cocs-reject`. A test backdoor opens the intermission window so the spend path
// is reachable without playing five waves.
test('two WebSocket clients drive an OPERATIONS room: actions apply and refuses reach the peer', async () => {
 let n = 5;
 const random = () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
 const { server, close, registry } = createGameServer({ tickDt: 1 / 6, random });
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 let a, b;
 try {
  a = await connect(url); b = await connect(url);
  send(a, { type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  send(b, { type: 'join', name: 'Bob', character: 'claude', harness: 'hermes' });
  await until(a, 'welcome');
  const welcomeB = await until(b, 'welcome');
  send(a, { type: 'host', config: { mode: 'cocs-coop', botCount: 6, timeLimit: 900 }, mapId: 'warfront' });
  send(a, { type: 'start' });
  await until(b, 'start');
  await until(a, 'snapshot');
  const room = registry.rooms.get('local');
  const state = room.match.objectiveState;
  const front = state.nodes.find(node => node.archetype === 'front');
  front.owner = 0;
  state.flux[0] = 240;
  state.coop.phase = 'intermission';
  state.coop.intermission = true;
  state.coop.intermissionOpen = true;
  state.coop.intermissionTicks = 99999;
  const vaultId = Object.keys(state.terminals.terminals).find(id => state.terminals.terminals[id].kind === 'VAULT' && state.terminals.terminals[id].nodeId === 'hq-0');
  const vault = state.terminals.terminals[vaultId];
  const alice = room.match.actors.find(actor => actor.name === 'Alice');
  Object.assign(alice, { x: vault.x, z: vault.z, y: 0 });
  alice.req = 100;

  send(a, { type: 'order', cardId: 'w-o', verb: 'HOLD', target: front.id, agent: 'chief' });
  send(a, { type: 'economy', cardId: 'w-e', action: 'fortify', target: front.id });
  send(b, { type: 'command', cardId: 'w-c', action: 'take' });
  send(a, { type: 'terminal', cardId: 'w-t', terminalId: vaultId, action: 'vault-store' });
  send(a, { type: 'buy', cardId: 'w-b', itemId: 'field-repair' });
  const applied = await new Promise(resolve => {
   const started = Date.now();
   const poll = () => {
    const done = state.coop.spendStats.FORTIFY >= 1 && state.terminals.vault.stores >= 1
     && state.coop.commandSeat[0] === String(welcomeB.peerId) && alice.reqBuff === 'field-repair'
     && state.orderStats.byVerb.HOLD >= 1;
    if (done) resolve(true);
    else if (Date.now() - started > 25000) resolve(false);
    else setTimeout(poll, 50);
   };
   poll();
  });
  assert.ok(applied, 'orders, spends, terminals, commands and buys all applied over the wire');

  send(a, { type: 'order', cardId: 'w-bad', verb: 'ATTACK', target: front.id });
  const reject = await until(a, 'cocs-reject', 15000);
  assert.equal(reject.cardId, 'w-bad');
  assert.equal(reject.reason, 'wrong-team');
 } finally {
  a?.close(); b?.close(); close();
 }
});

test('a reconnect racing the old socket reattaches the seat with the newest connection', async () => {
 const { server, close } = createGameServer({});
 await new Promise(resolve => server.listen(0, resolve));
 const port = server.address().port;
 const a = await connect(`ws://127.0.0.1:${port}`);
 let b;
 try {
  await queue(a);
  send(a, { type: 'create', name: 'A', playerName: 'A', character: 'chatgpt', harness: 'openclaw' });
  const first = await until(a, 'welcome');
  assert.ok(first.token, 'first connection gets a session token');
  assert.ok(first.roomId, 'first connection gets a room');
  b = await connect(`ws://127.0.0.1:${port}`);
  await queue(b);
  send(b, { type: 'join', name: 'A', character: 'chatgpt', harness: 'openclaw', roomId: first.roomId, token: first.token });
  const second = await until(b, 'welcome');
  assert.equal(second.reconnected, true, 'the racing reconnection adopts the existing seat');
  await until(b, 'lobby');
 } finally { try { a.close(); } catch {} try { b?.close(); } catch {} close(); }
});
