import assert from 'node:assert/strict';
import test from 'node:test';
import {createGameServer} from '../server/game-server.mjs';
import {buildIdentity} from '../game/build-identity.mjs';
import {PROTOCOL_VERSION} from '../game/protocol.mjs';

function connect(url) {
 return new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.onopen = () => resolve(ws);
  ws.onerror = () => reject(new Error('connection failed'));
 });
}

function waitFor(ws, type, timeout = 10000) {
 return new Promise((resolve, reject) => {
  const timer = setTimeout(() => { ws.removeEventListener('message', onMessage); reject(new Error(`timeout waiting for ${type}`)); }, timeout);
  const onMessage = event => {
   const msg = JSON.parse(event.data);
   if (msg.type !== type) return;
   clearTimeout(timer);
   ws.removeEventListener('message', onMessage);
   resolve(msg);
  };
  ws.addEventListener('message', onMessage);
 });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the HTTP status reports the server identity plus the existing counters', async () => {
 const identity = buildIdentity({
  TOKEN_ARENA_RELEASE: 'v9.9',
  TOKEN_ARENA_CODENAME: 'TESTCELL',
  TOKEN_ARENA_COMMIT: 'deadbee',
  TOKEN_ARENA_BUILD_ID: 'v9.9-deadbee',
 }, 'token-arena-game-server');
 const {server, close, registry} = createGameServer({identity});
 await new Promise(resolve => server.listen(0, resolve));
 try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {cache: 'no-store'});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, 'token-arena-game-server');
  assert.equal(body.release, 'v9.9');
  assert.equal(body.version, 'v9.9');
  assert.equal(body.codename, 'TESTCELL');
  assert.equal(body.commit, 'deadbee');
  assert.equal(body.buildId, 'v9.9-deadbee');
  assert.equal(body.protocol, PROTOCOL_VERSION);
  assert.equal(body.rooms, registry.rooms.size);
  assert.equal(body.players, 0);
  assert.deepEqual(body.snapshot, {deltaFrames: 0, fullFrames: 0});
 } finally { close(); }
});

test('JOIN stores the advertised protocol version on the peer record', async () => {
 const {server, close, registry} = createGameServer({identity: buildIdentity({TOKEN_ARENA_COMMIT: 'test000'}, 'token-arena-game-server')});
 await new Promise(resolve => server.listen(0, resolve));
 const ws = await connect(`ws://127.0.0.1:${server.address().port}`);
 try {
  const welcome = waitFor(ws, 'welcome');
  ws.send(JSON.stringify({type: 'join', name: 'Identified', character: 'chatgpt', harness: 'openclaw', v: PROTOCOL_VERSION}));
  const frame = await welcome;
  const room = registry.rooms.get(frame.roomId);
  assert.ok(room, 'the room exists');
  assert.equal(room.peers.get(frame.peerId).protocolVersion, PROTOCOL_VERSION);
 } finally { try { ws.close(); } catch {} close(); }
});

test('CREATE stores the advertised protocol version on the peer record', async () => {
 const {server, close, registry} = createGameServer({identity: buildIdentity({}, 'token-arena-game-server')});
 await new Promise(resolve => server.listen(0, resolve));
 const ws = await connect(`ws://127.0.0.1:${server.address().port}`);
 try {
  const welcome = waitFor(ws, 'welcome');
  ws.send(JSON.stringify({type: 'create', name: 'Created', playerName: 'Maker', v: PROTOCOL_VERSION}));
  const frame = await welcome;
  const room = registry.rooms.get(frame.roomId);
  assert.ok(room, 'the room exists');
  assert.equal(room.peers.get(frame.peerId).protocolVersion, PROTOCOL_VERSION);
 } finally { try { ws.close(); } catch {} close(); }
});

test('a peer whose major protocol differs is refused with a clear error and no seat', async () => {
 const {server, close, registry} = createGameServer({identity: buildIdentity({}, 'token-arena-game-server')});
 await new Promise(resolve => server.listen(0, resolve));
 const url = `ws://127.0.0.1:${server.address().port}`;
 const join = await connect(url);
 const create = await connect(url);
 const roomsBefore = registry.rooms.size;
 try {
  const joinError = waitFor(join, 'error');
  join.send(JSON.stringify({type: 'join', name: 'Future', v: PROTOCOL_VERSION + 1}));
  const error = await joinError;
  assert.equal(error.code, 'protocol-mismatch');
  assert.match(error.message, /protocol v4 is incompatible/);
  assert.match(error.message, /major v3/);
  const createError = waitFor(create, 'error');
  create.send(JSON.stringify({type: 'create', name: 'Future Room', v: PROTOCOL_VERSION + 1}));
  const second = await createError;
  assert.equal(second.code, 'protocol-mismatch');
  assert.equal(registry.rooms.size, roomsBefore, 'a refused peer never creates or joins a room');
  assert.equal(registry.defaultRoom.peers.size, 0, 'a refused peer is never seated');
  await delay(50);
 } finally { try { join.close(); } catch {} try { create.close(); } catch {} close(); }
});

test('a legacy JOIN without an advertised version still seats the peer', async () => {
 const {server, close, registry} = createGameServer({identity: buildIdentity({}, 'token-arena-game-server')});
 await new Promise(resolve => server.listen(0, resolve));
 const ws = await connect(`ws://127.0.0.1:${server.address().port}`);
 try {
  const welcome = waitFor(ws, 'welcome');
  ws.send(JSON.stringify({type: 'join', name: 'Legacy', character: 'claude', harness: 'hermes'}));
  const frame = await welcome;
  assert.equal(frame.v, PROTOCOL_VERSION);
  assert.equal(registry.rooms.get(frame.roomId).peers.get(frame.peerId).protocolVersion, null);
 } finally { try { ws.close(); } catch {} close(); }
});
