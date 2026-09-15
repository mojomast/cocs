import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameServer, attachConnection, TRAFFIC_BUFFER_LIMIT} from './game-server.mjs';
import {Room} from './room.mjs';

const rng = () => { let n = 11; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };

class FakeSocket {
 constructor(transport) {
  this.transport = transport;
  this.OPEN = 1;
  this.readyState = 1;
  this.bufferedAmount = 0;
  this.isAlive = true;
  this.protocolErrors = 0;
  this.sent = [];
  this.handlers = new Map();
 }
 on(event, cb) { const list = this.handlers.get(event); if (list) list.push(cb); else this.handlers.set(event, [cb]); }
 emit(event, ...args) { for (const cb of [...(this.handlers.get(event) ?? [])]) cb(...args); }
 send(text) { this.sent.push(text); return true; }
 close(code = 1000, reason = '') {
  if (this.readyState === 3) return;
  this.readyState = 3;
  this.transport.clients.delete(this);
  this.emit('close', code, reason);
 }
 terminate() {
  if (this.readyState === 3) return;
  this.readyState = 3;
  this.transport.clients.delete(this);
  this.emit('close', 1006, 'terminated');
 }
 ping() { this.emit('pong'); }
 receive(msg) { this.emit('message', typeof msg === 'string' ? msg : JSON.stringify(msg)); }
 messages() { return this.sent.map(text => JSON.parse(text)); }
}

class FakeTransport {
 constructor() {
  this.clients = new Set();
  this.connectionHandlers = [];
  this.closed = false;
 }
 on(event, cb) { if (event === 'connection') this.connectionHandlers.push(cb); }
 connect() {
  const socket = new FakeSocket(this);
  this.clients.add(socket);
  for (const cb of this.connectionHandlers) cb(socket);
  return socket;
 }
 close(cb) { this.closed = true; if (cb) cb(); }
}

function connect(url) {
 return new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.onopen = () => resolve(ws);
  ws.onerror = () => reject(new Error('connection failed'));
 });
}
const queues = new WeakMap();
function queue(ws) {
 let q = queues.get(ws);
 if (q) return q;
 q = { items: [], waiters: [] };
 queues.set(ws, q);
 ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  const waiter = q.waiters.find(w => w.type === msg.type);
  if (waiter) { q.waiters = q.waiters.filter(w => w !== waiter); clearTimeout(waiter.timer); waiter.resolve(msg); return; }
  q.items.push(msg);
 });
 return q;
}
function until(ws, type, timeout = 5000) {
 const q = queue(ws);
 const index = q.items.findIndex(m => m.type === type);
 if (index >= 0) return Promise.resolve(q.items.splice(index, 1)[0]);
 return new Promise((resolve, reject) => {
  const waiter = { type, resolve, timer: setTimeout(() => { q.waiters = q.waiters.filter(w => w !== waiter); reject(new Error(`timeout waiting for ${type}`)); }, timeout) };
  q.waiters.push(waiter);
 });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('repeated malformed messages are bounded and the offender is terminated', async () => {
 const { server, close, wss } = createGameServer({});
 await new Promise(resolve => server.listen(0, resolve));
 const ws = await connect(`ws://127.0.0.1:${server.address().port}`);
 const closed = new Promise(resolve => ws.addEventListener('close', resolve));
 try {
  for (let i = 0; i < 25; i++) ws.send('{not json');
  await Promise.race([closed, delay(5000).then(() => { throw new Error('offender was never terminated'); })]);
  assert.equal(ws.readyState, 3, 'the connection is closed after too many protocol errors');
  assert.ok([...wss.clients].length === 0 || [...wss.clients].every(socket => socket.readyState !== 1), 'no live server socket is left behind');
 } finally { try { ws.close(); } catch {} close(); }
});

test('essential replies survive backpressure and arrive after recovery', async () => {
 const { server, close, wss } = createGameServer({});
 await new Promise(resolve => server.listen(0, resolve));
 const ws = await connect(`ws://127.0.0.1:${server.address().port}`);
 try {
  await delay(50);
  const serverWs = [...wss.clients][0];
  assert.ok(serverWs, 'server socket is registered');
  let buffered = TRAFFIC_BUFFER_LIMIT + 1;
  Object.defineProperty(serverWs, 'bufferedAmount', { configurable: true, get: () => buffered });
  ws.send(JSON.stringify({ type: 'ping' }));
  await delay(80);
  assert.ok((serverWs.pendingEssential?.length ?? 0) > 0, 'the pong is retained instead of silently dropped');
  buffered = 0;
  ws.send(JSON.stringify({ type: 'ping' }));
  const pong = await until(ws, 'pong');
  assert.equal(pong.type, 'pong');
 } finally { try { ws.close(); } catch {} close(); }
});

test('createGameServer injects a ServerTransport and a virtual connection receives welcome', async () => {
 const transport = new FakeTransport();
 let transportArg = null;
 const engine = createGameServer({ createTransport: arg => { transportArg = arg; return transport; }, tickMs: 100000 });
 await new Promise(resolve => engine.server.listen(0, resolve));
 try {
  assert.equal(transportArg, engine.server, 'createTransport is called with the node:http server');
  const socket = transport.connect();
  assert.equal(engine.sockets.size, 1, 'the connection is registered on the engine');
  socket.receive({ type: 'join', name: 'Alice', character: 'chatgpt', harness: 'openclaw' });
  const messages = socket.messages();
  const types = messages.map(m => m.type);
  assert.equal(types[0], 'welcome', 'the virtual peer receives welcome first');
  assert.equal(messages[0].roomId, 'local');
  assert.equal(messages[0].host, true);
  assert.ok(types.includes('lobby'), 'join is flushed to the room lobby');
  const lobby = messages.filter(m => m.type === 'lobby').at(-1);
  assert.equal(lobby.players.length, 1);
  assert.equal(lobby.players[0].name, 'Alice');
 } finally { await engine.close(); }
});

test('attachConnection is the shared seam for both backends', async () => {
 const transport = new FakeTransport();
 const engine = createGameServer({ createTransport: () => transport, tickMs: 100000 });
 await new Promise(resolve => engine.server.listen(0, resolve));
 try {
  const injected = transport.connect();
  injected.receive({ type: 'join', name: 'Injected', character: 'chatgpt', harness: 'openclaw' });
  const injectedTypes = injected.messages().map(m => m.type);
  assert.deepEqual(injectedTypes, ['welcome', 'lobby']);
  const direct = new FakeSocket(transport);
  transport.clients.add(direct);
  attachConnection(engine, direct);
  direct.receive({ type: 'join', name: 'Direct', character: 'chatgpt', harness: 'openclaw' });
  assert.deepEqual(direct.messages().map(m => m.type), injectedTypes, 'direct attachConnection runs the same dispatch/flush pipeline');
 } finally { await engine.close(); }
});

test('Room is isomorphic: no Buffer and tokens from globalThis.crypto', () => {
 const bufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
 const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
 const tokenValue = '11111111-1111-4111-8111-111111111111';
 let calls = 0;
 try {
  Object.defineProperty(globalThis, 'Buffer', { configurable: true, get() { throw new Error('Room touched Buffer'); } });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => { calls++; return tokenValue; } } });
  const room = new Room('iso', rng());
  room.join(1, 'A');
  room.join(2, 'B');
  const welcome = room.drain().find(m => m.to === 1 && m.msg.type === 'welcome').msg;
  assert.equal(welcome.token, tokenValue, 'the session token is generated through globalThis.crypto');
  room.voiceState(1, true);
  room.voiceState(2, true);
  room.drain();
  const session = room.peers.get(1).voiceSession;
  const targetSession = room.peers.get(2).voiceSession;
  room.voiceSignal(1, { type: 'voice-signal', roomId: room.id, to: 2, session, targetSession, description: { type: 'offer', sdp: 'v=0' } });
  assert.equal(room.drain().length, 1, 'voice relay byte accounting runs without Buffer');
  assert.ok(calls >= 4, 'randomUUID drove both session tokens and both voice sessions');
 } finally {
  if (bufferDescriptor) Object.defineProperty(globalThis, 'Buffer', bufferDescriptor);
  if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
 }
});
