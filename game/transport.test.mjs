import test from 'node:test';
import assert from 'node:assert/strict';
import {OPEN, WebSocketTransport, defaultTransport} from './transport.mjs';
import {NetClient} from './net.mjs';

const fakeStorage = () => {
 const store = new Map();
 return {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k)};
};

class FakeSocket {
 constructor() {
  this.readyState = 0;
  this.sent = [];
  this.closed = false;
  this.onopen = null;
  this.onerror = null;
  this.onclose = null;
  this.onmessage = null;
 }
 send(data) { this.sent.push(data); }
 close() { this.closed = true; this.readyState = 3; }
 open() { this.readyState = OPEN; this.onopen?.(); }
 message(data) { this.onmessage?.({data}); }
}

class FakeTransport {
 constructor() { this.sockets = []; this.urls = []; this.throwOnOpen = false; }
 open(url) {
  this.urls.push(url);
  if (this.throwOnOpen) throw new Error('open failed');
  const socket = new FakeSocket();
  this.sockets.push(socket);
  return socket;
 }
}

test('OPEN matches the WebSocket readyState constant', () => {
 assert.equal(OPEN, 1);
});

test('WebSocketTransport.open delegates to the global WebSocket and returns a WebSocketLike', t => {
 const opened = [];
 t.mock.method(globalThis, 'WebSocket', function(url) {
  const socket = {
   url,
   readyState: OPEN,
   bufferedAmount: 0,
   onopen: null,
   onerror: null,
   onclose: null,
   onmessage: null,
   send() {},
   close() {},
  };
  opened.push(socket);
  return socket;
 });
 const socket = new WebSocketTransport().open('ws://example:1');
 assert.equal(opened.length, 1);
 assert.equal(opened[0].url, 'ws://example:1');
 for (const key of ['readyState', 'bufferedAmount', 'send', 'close', 'onopen', 'onerror', 'onclose', 'onmessage']) {
  assert.ok(key in socket, `WebSocketLike exposes ${key}`);
 }
 assert.equal(typeof socket.send, 'function');
 assert.equal(typeof socket.close, 'function');
});

test('the default transport is a WebSocketTransport', t => {
 t.mock.method(globalThis, 'WebSocket', function(url) { return {url}; });
 assert.ok(defaultTransport instanceof WebSocketTransport);
 assert.equal(defaultTransport.open('ws://default:1').url, 'ws://default:1');
});

test('NetClient sends text frames through the injected transport', async () => {
 const transport = new FakeTransport();
 const client = new NetClient('ws://fake:1', {transport, storage: fakeStorage()});
 const pending = client.connect();
 transport.sockets[0].open();
 await pending;
 assert.deepEqual(transport.urls, ['ws://fake:1']);
 assert.equal(client.send({type: 'chat', text: 'hi'}), true);
 assert.equal(transport.sockets[0].sent.length, 1);
 assert.deepEqual(JSON.parse(transport.sockets[0].sent[0]), {type: 'chat', text: 'hi'});
 client.close();
});

test('NetClient dispatches transport onmessage data to the protocol handler', async () => {
 const transport = new FakeTransport();
 const client = new NetClient('ws://fake:1', {transport, storage: fakeStorage()});
 const pending = client.connect();
 transport.sockets[0].open();
 await pending;
 transport.sockets[0].message(JSON.stringify({type: 'rooms', rooms: [{roomId: 'live'}]}));
 assert.deepEqual(client.rooms, [{roomId: 'live'}]);
 client.close();
});

test('close and reconnect dispose the previous socket through the transport', async () => {
 const transport = new FakeTransport();
 const client = new NetClient('ws://fake:1', {transport, storage: fakeStorage()});
 const first = client.connect();
 transport.sockets[0].open();
 await first;
 const firstSocket = transport.sockets[0];
 const second = client.connect();
 transport.sockets[1].open();
 await second;
 assert.equal(firstSocket.closed, true, 'superseded socket is closed');
 assert.equal(transport.sockets.length, 2, 'reconnect opens a fresh socket through the transport');
 assert.equal(client.connected, true);
 client.close();
 assert.equal(transport.sockets[1].closed, true, 'close shuts the live socket');
});

test('send tolerates a missing bufferedAmount and includes it in the voice budget', async () => {
 const transport = new FakeTransport();
 const client = new NetClient('ws://fake:1', {transport, storage: fakeStorage()});
 const pending = client.connect();
 transport.sockets[0].open();
 await pending;
 const socket = transport.sockets[0];
 assert.equal('bufferedAmount' in socket, false);
 assert.equal(client.send({type: 'chat', text: 'a'}), true, 'missing bufferedAmount still sends');
 assert.equal(client.voiceSignal(2, {description: {type: 'offer', sdp: 'ok'}}), true);
 socket.bufferedAmount = 64 * 1024;
 assert.equal(client.voiceSignal(2, {description: {type: 'offer', sdp: 'ok'}}), false, 'bufferedAmount counts toward the voice budget');
 client.close();
});

test('NetClient routes sockets through options.transport and never the global WebSocket', async t => {
 let globalCalls = 0;
 class ExplodingWebSocket {
  constructor() { globalCalls++; throw new Error('global WebSocket must not be used'); }
 }
 t.mock.method(globalThis, 'WebSocket', ExplodingWebSocket);
 const transport = new FakeTransport();
 const client = new NetClient('ws://fake:1', {transport, storage: fakeStorage()});
 assert.equal(client.transport, transport);
 const pending = client.connect();
 transport.sockets[0].open();
 await pending;
 assert.deepEqual(transport.urls, ['ws://fake:1']);
 assert.equal(globalCalls, 0, 'the global WebSocket is never constructed');
 client.close();
});

test('a transport that throws on open rejects connect exactly like the constructor guard', async () => {
 const transport = new FakeTransport();
 transport.throwOnOpen = true;
 const client = new NetClient('ws://fake:1', {transport, storage: fakeStorage()});
 await assert.rejects(client.connect(), /open failed/);
 assert.equal(client.ws, null);
 assert.equal(client.connected, false);
});

test('NetClient defaults to a WebSocketTransport when none is injected', () => {
 const client = new NetClient('ws://fake:1', {storage: fakeStorage()});
 assert.ok(client.transport instanceof WebSocketTransport);
});
