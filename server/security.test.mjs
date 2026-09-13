import test from 'node:test';
import assert from 'node:assert/strict';
import {ProgressionStore} from './progression.mjs';
import {Room} from './room.mjs';
import {createGameServer, TRAFFIC_BUFFER_LIMIT} from './game-server.mjs';

const token = ch => ch.repeat(24);
const PID = 'player-aaaa-0001';

test('identities are bound to their secret token, not the public player id', () => {
 const store = new ProgressionStore(null, {max: 8});
 const a = store.identify(PID, token('A'));
 assert.equal(a.profile.id, PID);
 assert.equal(a.token, token('A'));
 const b = store.identify(PID, token('B'));
 assert.notEqual(b.profile.id, PID, 'a second token cannot claim the same profile');
 assert.equal(store.getOwned(PID, token('B')), null, 'wrong token cannot read the profile');
 assert.equal(store.getOwned(PID, token('A')).id, PID);
 assert.equal(store.setGearOwned(PID, token('B'), {armor: 'plating'}), null, 'wrong token cannot write gear');
});

test('reconnecting with the same token keeps the same identity and progress', () => {
 const store = new ProgressionStore(null, {max: 8});
 const first = store.identify(PID, token('A'));
 store.awardOwned(first.profile.id, token('A'), {win: true, actor: {frags: 30}});
 const again = store.identify('', token('A'));
 assert.equal(again.profile.id, first.profile.id);
 assert.ok(again.profile.xp > 0, 'progress survives re-identification by token');
});

test('a room never exposes one player profile to another', () => {
 const store = new ProgressionStore(null, {max: 8});
 const room = new Room('r', () => 0.5, {progression: store});
 room.join(1, 'A', 'chatgpt', 'openclaw', '', false, PID, token('A'));
 room.join(2, 'B', 'chatgpt', 'openclaw', '', false, PID, token('B'));
 const a = room.peers.get(1), b = room.peers.get(2);
 assert.notEqual(a.playerId, b.playerId);
 assert.equal(store.getOwned(a.playerId, b.playerToken), null);
 const welcomes = room.drain().filter(m => m.msg.type === 'welcome');
 assert.equal(welcomes.length, 2);
 assert.ok(welcomes.every(m => typeof m.msg.progressToken === 'string'));
});

test('pinned connected profiles survive eviction pressure', () => {
 const store = new ProgressionStore(null, {max: 2});
 const pinned = store.identify('player-pinned-01', token('P')).profile.id;
 store.setPinned(new Set([pinned]));
 store.identify('player-other-01', token('O'));
 store.identify('player-other-02', token('Q'));
 store.identify('player-other-03', token('R'));
 assert.ok(store.getOwned(pinned, token('P')), 'the connected profile is never evicted');
});

test('essential replies coalesce by type instead of dropping lifecycle messages', async () => {
 const { server, close, wss } = createGameServer({});
 await new Promise(resolve => server.listen(0, resolve));
 const port = server.address().port;
 const ws = await new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen = () => resolve(socket);
  socket.onerror = () => reject(new Error('connection failed'));
 });
 try {
  await new Promise(resolve => setTimeout(resolve, 50));
  const serverWs = [...wss.clients][0];
  Object.defineProperty(serverWs, 'bufferedAmount', { configurable: true, get: () => TRAFFIC_BUFFER_LIMIT + 1 });
  for (let i = 0; i < 20; i++) {
   ws.send(JSON.stringify({ type: 'ping' }));
   ws.send(JSON.stringify({ type: 'list' }));
   ws.send(JSON.stringify({ type: 'history' }));
  }
  await new Promise(resolve => setTimeout(resolve, 120));
  const queue = serverWs.pendingEssential ?? [];
  const types = queue.map(entry => entry.type);
  assert.ok(queue.length <= 4, `queue is coalesced, got ${queue.length}`);
  assert.equal(new Set(types).size, types.length, 'each essential type is retained at most once');
  assert.ok(types.includes('pong'), 'the ping reply survives');
  assert.ok(types.includes('rooms'), 'the list reply survives');
  assert.ok(types.includes('history'), 'the history reply survives');
 } finally { try { ws.close(); } catch {} close(); }
});
