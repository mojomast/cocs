import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameServer, TRAFFIC_BUFFER_LIMIT, drainEssential} from './game-server.mjs';

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

test('drainEssential sends what fits in order and leaves the rest queued', () => {
 const entry = (type, size, room = null) => ({ type, text: JSON.stringify({ type }), room, size });
 const queue = [entry('a', 10), entry('b', 10), entry('c', 10)];
 const sent = [];
 const n = drainEssential(queue, { bufferedAmount: TRAFFIC_BUFFER_LIMIT - 15, limit: TRAFFIC_BUFFER_LIMIT, current: null, send: text => sent.push(text) });
 assert.equal(n, 1, 'only the entry that fits the remaining budget is sent');
 assert.deepEqual(sent.map(text => JSON.parse(text).type), ['a'], 'messages keep their order');
 assert.deepEqual(queue.map(item => item.type), ['b', 'c'], 'the remainder stays queued');
});

test('drainEssential cannot be starved by an oversized essential message', () => {
 const entry = (type, size, room = null) => ({ type, text: JSON.stringify({ type }), room, size });
 const queue = [entry('oversized', TRAFFIC_BUFFER_LIMIT + 1), entry('pong', 8)];
 const sent = [];
 const first = drainEssential(queue, { bufferedAmount: 0, limit: TRAFFIC_BUFFER_LIMIT, current: null, send: text => sent.push(text) });
 assert.equal(first, 1, 'the oversized message is sent once the socket has drained');
 assert.deepEqual(queue.map(item => item.type), ['pong'], 'the oversized message no longer blocks later replies forever');
 drainEssential(queue, { bufferedAmount: 0, limit: TRAFFIC_BUFFER_LIMIT, current: null, send: text => sent.push(text) });
 assert.deepEqual(sent.map(text => JSON.parse(text).type), ['oversized', 'pong'], 'later replies still arrive');
 assert.equal(queue.length, 0);
});

test('drainEssential discards entries addressed to a room the peer has left', () => {
 const entry = (type, size, room = null) => ({ type, text: JSON.stringify({ type }), room, size });
 const queue = [entry('stale', 8, 'ROOM1'), entry('fresh', 8, 'ROOM2')];
 const sent = [];
 const n = drainEssential(queue, { bufferedAmount: 0, limit: TRAFFIC_BUFFER_LIMIT, current: 'ROOM2', send: text => sent.push(text) });
 assert.equal(n, 1, 'stale entries are skipped, not sent');
 assert.deepEqual(sent.map(text => JSON.parse(text).type), ['fresh']);
 assert.equal(queue.length, 0);
});
