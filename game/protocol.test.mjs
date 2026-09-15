import test from 'node:test';
import assert from 'node:assert/strict';
import {MESSAGE,validPlayerId,validProgressToken,sanitizeText,parseInputEnvelope,snapshotDelta,applySnapshotDelta,wireSize,BandwidthMeter} from './protocol.mjs';

test('message types expose the canonical wire vocabulary',()=>{
 for(const type of [MESSAGE.JOIN,MESSAGE.CREATE,MESSAGE.LIST,MESSAGE.HISTORY,MESSAGE.HOST,MESSAGE.GEAR,MESSAGE.START,MESSAGE.INPUT,MESSAGE.CHAT,MESSAGE.LEAVE,MESSAGE.PING,MESSAGE.PONG,MESSAGE.WELCOME,MESSAGE.LOBBY,MESSAGE.ROOMS,MESSAGE.SNAPSHOT,MESSAGE.EVENTS,MESSAGE.RESULTS,MESSAGE.PROGRESSION,MESSAGE.ERROR,MESSAGE.VOICE_STATE,MESSAGE.VOICE_SIGNAL,MESSAGE.VOICE_CONFIG])assert.equal(typeof type,'string');
 assert.equal(MESSAGE.WELCOME,'welcome');
 assert.equal(MESSAGE.VOICE_CONFIG,'voice-config');
});

test('player ids accept only the canonical uuid-like shape',()=>{
 assert.equal(validPlayerId('player-0001-test'),true);
 assert.equal(validPlayerId('a1b2c3d4'),true);
 assert.equal(validPlayerId('short'),false);
 assert.equal(validPlayerId('bad id with spaces'),false);
 assert.equal(validPlayerId('under_score-12345'),false);
 assert.equal(validPlayerId('a'.repeat(65)),false);
 assert.equal(validPlayerId(42),false);
 assert.equal(validPlayerId(null),false);
});

test('progress tokens are bounded and url-safe',()=>{
 const token='A'.repeat(24);
 assert.equal(validProgressToken(token),true);
 assert.equal(validProgressToken('abc'),false);
 assert.equal(validProgressToken('has.dot.token.123456'),false);
 assert.equal(validProgressToken('A'.repeat(129)),false);
 assert.equal(validProgressToken(42),false);
 assert.equal(validProgressToken(null),false);
});

test('sanitizeText strips control characters, trims and truncates names and chat',()=>{
 assert.equal(sanitizeText('  he\u0000llo  ',20),'hello');
 assert.equal(sanitizeText('  \u007fchat\u001f  ',200),'chat');
 assert.equal(sanitizeText('abcdef',3),'abc');
 assert.equal(sanitizeText(null,20),'');
 assert.equal(sanitizeText(undefined,200),'');
});

test('parseInputEnvelope validates and clamps the nested wire envelope',()=>{
 const input=parseInputEnvelope({input:{x:5,z:-9,fire:true,yaw:1,pitch:5,weapon:2,sprint:true,crouch:false},seq:7});
 assert.equal(input.seq,7);
 assert.equal(input.x,1);
 assert.equal(input.z,-1);
 assert.equal(input.fire,true);
 assert.equal(input.yaw,1);
 assert.equal(input.pitch,1.45);
 assert.equal(input.weapon,2);
 assert.equal(input.sprint,true);
 assert.equal(input.crouch,false);
});

test('parseInputEnvelope accepts the flattened ext payload used by the room',()=>{
 const input=parseInputEnvelope({x:Infinity,z:2,yaw:Infinity,pitch:NaN,weapon:2.5,jump:true});
 assert.equal(input.seq,null);
 assert.equal(input.x,0);
 assert.equal(input.z,1);
 assert.equal(input.yaw,undefined);
 assert.equal(input.pitch,undefined);
 assert.equal(input.weapon,undefined);
 assert.equal(input.jump,true);
});

test('parseInputEnvelope prefers the envelope sequence over the inner one',()=>{
 assert.equal(parseInputEnvelope({seq:3,input:{seq:9,x:0,z:0}}).seq,3);
 assert.equal(parseInputEnvelope({input:{seq:4,x:0,z:0}}).seq,4);
 assert.equal(parseInputEnvelope({input:{seq:-1,x:0,z:0}}).seq,null);
 assert.equal(parseInputEnvelope({seq:1e9,x:0,z:0}).seq,1e9);
});

test('parseInputEnvelope tolerates malformed frames with safe defaults',()=>{
 for(const frame of [null,undefined,'input',42,[],{input:null},{input:'nope'},{}]){
  const input=parseInputEnvelope(frame);
  assert.equal(input.seq,null);
  assert.equal(input.x,0);
  assert.equal(input.z,0);
  assert.equal(input.fire,false);
  assert.equal(input.jump,false);
  assert.equal(input.power,false);
  assert.equal(input.reload,false);
 }
});

test('snapshotDelta round-trips through applySnapshotDelta and marks deletions', () => {
 const base = {time: 1, actors: [{id: 0, x: 0, y: 0}], flags: {0: {x: 1, z: 2}}, gone: 5};
 const next = {time: 2, actors: [{id: 0, x: 3, y: 0}], flags: {0: {x: 1, z: 4}}};
 const patch = snapshotDelta(base, next);
 assert.ok(patch, 'a changed tree produces a patch');
 assert.equal(patch.gone.$d, 1, 'a removed key is marked for deletion');
 const rebuilt = applySnapshotDelta(base, patch);
 assert.deepEqual(rebuilt, next);
 assert.equal(snapshotDelta(base, { ...base }), null, 'an unchanged tree yields no patch');
});

test('wireSize and BandwidthMeter report bytes and a sliding rate', () => {
 assert.ok(wireSize({a: 1}) > 0);
 const meter = new BandwidthMeter({windowMs: 1000, capacity: 8});
 for (let i = 0; i < 5; i++) meter.record(100, i * 100);
 assert.equal(meter.totalBytes, 500);
 assert.equal(meter.totalFrames, 5);
 assert.equal(meter.rate(400), 500);
 assert.equal(meter.rate(1100), 400, 'older samples fall out of the window');
 assert.ok(meter.average(400) > 0);
});
