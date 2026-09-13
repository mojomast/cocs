import test from 'node:test';
import assert from 'node:assert/strict';
import { NetClient } from './net.mjs';

test('voice callbacks survive reset and reconnect; ICE configuration updates before lobby callback', async t => {
 class Socket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor() { queueMicrotask(() => this.onopen()); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.onclose?.(); }
 }
 t.mock.method(globalThis, 'WebSocket', function () { return new Socket(); });
 const client = new NetClient();
 assert.equal(client.onVoiceSignal, null);
 const signals = [];
 const onSignal = msg => signals.push(msg);
 client.onVoiceSignal = onSignal;
 const config = { type: 'voice-config', iceServers: [{ urls: ['turn:example.com'], username: 'time:1', credential: 'temporary' }] };
 for (let attempt = 0; attempt < 2; attempt++) {
  await client.connect();
  assert.equal(client.onVoiceSignal, onSignal);
  assert.deepEqual(client.voiceIceServers, [{ urls: 'stun:stun.l.google.com:19302' }]);
  client.onMessage(JSON.stringify(config));
  assert.deepEqual(client.voiceIceServers, config.iceServers);
  client.onLobby = () => assert.deepEqual(client.voiceIceServers, config.iceServers);
  client.onMessage(JSON.stringify({ type: 'lobby', players: [] }));
  const relay = { type: 'voice-signal', roomId: 'local', from: 2, session: 'session', targetSession: 'target', candidate: null };
  client.onMessage(JSON.stringify(relay));
  assert.deepEqual(signals[attempt], relay);
  client.roomId = 'local';
  assert.equal(client.voiceState(true), true);
  assert.equal(client.voiceState(false), true);
  assert.equal(client.voiceState(null), false);
  client.voiceSignal(2, { type: 'spoof', roomId: 'elsewhere', to: 3, session: 'session', targetSession: 'target', candidate: null });
  assert.deepEqual(client.ws.sent, [{ type: 'voice-state', enabled: true }, { type: 'voice-state', enabled: false },
   { type: 'voice-signal', roomId: 'local', to: 2, session: 'session', targetSession: 'target', candidate: null }]);
  client.ws.bufferedAmount = 65537;
  client.voiceSignal(2, { candidate: null });
  assert.equal(client.voiceState(true), true);
  assert.equal(client.voiceState(false), true);
  assert.deepEqual(client.ws.sent.slice(3), [{ type: 'voice-state', enabled: true }, { type: 'voice-state', enabled: false }]);
  client.ws.bufferedAmount = 0;
  client.voiceSignal(2, { description: { type: 'offer', sdp: 'x'.repeat(65536) } });
  client.voiceSignal(2, null); client.voiceSignal(2, []);
  assert.equal(client.ws.sent.length, 5);
  for (const state of [0, 2, 3]) {
   client.ws.readyState = state;
   assert.equal(client.voiceState(true), false);
   assert.equal(client.voiceState(false), false);
  }
  assert.equal(client.ws.sent.length, 5);
  client.close();
  assert.equal(client.voiceState(true), false);
  assert.equal(client.voiceState(false), false);
 }
 client.reset(); assert.equal(client.onVoiceSignal, onSignal);
});

test('parsed null, arrays, and malformed ICE configs are ignored', () => {
 const client = new NetClient();
 for (const msg of [null, [], 1, { type: 'voice-config', iceServers: null },
  { type: 'voice-config', iceServers: [null] }, { type: 'voice-config', iceServers: [[]] },
  { type: 'voice-config', iceServers: [{ urls: [1] }] }]) assert.doesNotThrow(() => client.onMessage(JSON.stringify(msg)));
 assert.deepEqual(client.voiceIceServers, [{ urls: 'stun:stun.l.google.com:19302' }]);
});
