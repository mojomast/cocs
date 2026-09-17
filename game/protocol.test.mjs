import test from 'node:test';
import assert from 'node:assert/strict';
import {MESSAGE,PROTOCOL_VERSION,SNAPSHOT_DELTA_VERSION,validPlayerId,validProgressToken,sanitizeText,parseInputEnvelope,snapshotDelta,applySnapshotDelta,wireSize,BandwidthMeter} from './protocol.mjs';

test('message types expose the canonical wire vocabulary',()=>{
 for(const type of [MESSAGE.JOIN,MESSAGE.CREATE,MESSAGE.LIST,MESSAGE.HISTORY,MESSAGE.HOST,MESSAGE.GEAR,MESSAGE.START,MESSAGE.INPUT,MESSAGE.CHAT,MESSAGE.LEAVE,MESSAGE.PING,MESSAGE.PONG,MESSAGE.WELCOME,MESSAGE.LOBBY,MESSAGE.ROOMS,MESSAGE.SNAPSHOT,MESSAGE.EVENTS,MESSAGE.RESULTS,MESSAGE.PROGRESSION,MESSAGE.ERROR,MESSAGE.VOICE_STATE,MESSAGE.VOICE_SIGNAL,MESSAGE.VOICE_CONFIG])assert.equal(typeof type,'string');
 assert.equal(MESSAGE.WELCOME,'welcome');
 assert.equal(MESSAGE.VOICE_CONFIG,'voice-config');
 assert.equal(MESSAGE.LOADOUT,'loadout','Phase 4 adds the respawn loadout-switch frame');
 assert.equal(PROTOCOL_VERSION,3,'the mobility input surface and loadout message bump the envelope');
 assert.equal(SNAPSHOT_DELTA_VERSION,2,'the snapshot-delta revision is unchanged');
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
 const input=parseInputEnvelope({input:{x:5,z:-9,fire:true,yaw:1,pitch:5,weapon:2,sprint:true,crouch:false,mobility:true},seq:7});
 assert.equal(input.seq,7);
 assert.equal(input.x,1);
 assert.equal(input.z,-1);
 assert.equal(input.fire,true);
 assert.equal(input.yaw,1);
 assert.equal(input.pitch,1.45);
 assert.equal(input.weapon,2);
 assert.equal(input.sprint,true);
 assert.equal(input.crouch,false);
 assert.equal(input.mobility,true,'the held mobility bind is validated as a boolean');
});

test('parseInputEnvelope accepts the flattened ext payload used by the room',()=>{
 const input=parseInputEnvelope({x:Infinity,z:2,yaw:Infinity,pitch:NaN,weapon:2.5,jump:true,mobility:true});
 assert.equal(input.seq,null);
 assert.equal(input.x,0);
 assert.equal(input.z,1);
 assert.equal(input.yaw,undefined);
 assert.equal(input.pitch,undefined);
 assert.equal(input.weapon,undefined);
 assert.equal(input.jump,true);
 assert.equal(input.mobility,true);
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
  assert.equal(input.mobility,false);
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

test('snapshotDelta v2 diffs id-keyed arrays element-wise and round-trips', () => {
 const base = {
  time: 1,
  actors: [
   {id: 0, x: 0, y: 0, ammo: [30, 0], gear: {speed: 1, spread: 2}},
   {id: 1, x: 5, y: 0, ammo: [10, 0], gear: {speed: 1, spread: 2}},
  ],
  tags: ['a', 'b'],
 };
 const next = {
  time: 2,
  actors: [
   {id: 1, x: 5.5, y: 0, ammo: [10, 1], gear: {speed: 1, spread: 2}},
   {id: 0, x: 0, y: 0.25, ammo: [30, 0], gear: {speed: 1, spread: 2}},
   {id: 2, x: 9, y: 0, ammo: [40, 0], gear: {speed: 1, spread: 2}},
  ],
  tags: ['a', 'b'],
 };
 const patch = snapshotDelta(base, next);
 assert.ok(patch, 'changed trees produce a patch');
 assert.equal(patch.actors.$A, 1, 'id-keyed arrays get a structured patch');
 assert.deepEqual(patch.actors.order, [1, 0, 2], 'the new identity order is recorded');
 assert.ok(patch.actors.set[1].ammo.$a, 'a nested array can still be replaced whole');
 assert.deepEqual(applySnapshotDelta(base, patch), next, 'the patch round-trips through a reorder and an insert');
 const removed = snapshotDelta(next, {time: 3, actors: [next.actors[0], next.actors[2]], tags: ['a']});
 assert.deepEqual(applySnapshotDelta(next, removed), {time: 3, actors: [next.actors[0], next.actors[2]], tags: ['a']}, 'removals and a shrunk opaque array round-trip');
});

test('snapshotDelta keeps non-id arrays opaque and preserves empty arrays', () => {
 const base = {leaders: ['A', 'B'], nums: [1, 2, 3], empty: []};
 const next = {leaders: ['A', 'C'], nums: [1, 2, 4], empty: []};
 const patch = snapshotDelta(base, next);
 assert.deepEqual(patch.leaders.$a, ['A', 'C'], 'string arrays are sent whole');
 assert.deepEqual(applySnapshotDelta(base, patch), next);
 assert.equal(snapshotDelta(base, {...base}), null, 'a reference-identical tree yields no patch');
 const shrunk = snapshotDelta({tags: ['a']}, {tags: []});
 assert.deepEqual(shrunk.tags.$a, [], 'an emptied array survives the round-trip');
});

test('snapshotDelta v2 cuts a real combat frame by at least 80%', async () => {
 const {Match} = await import('./core.mjs');
 const {quantizeClone} = await import('./quantize.mjs');
 let n = 1;
 const rng = () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
 const match = new Match('chatgpt', 'openclaw', rng, 'crosswire', {mode: 'deathmatch', difficulty: 'normal', humanCount: 8, botCount: 8, timeLimit: 300, fragLimit: 15});
 let frames = [];
 for (let i = 0; i < 240; i++) { match.step(1 / 60); if (i % 4 === 0) frames.push(quantizeClone(match.snapshot())); }
 let fullBytes = 0, deltaBytes = 0;
 for (let i = 1; i < frames.length; i++) {
  fullBytes += wireSize({type: 'snapshot', seq: i, acks: {}, state: frames[i]});
  deltaBytes += wireSize({type: 'snapshot-delta', seq: i, base: i - 1, patch: snapshotDelta(frames[i - 1], frames[i]) ?? {}});
 }
 assert.ok(fullBytes > 0 && deltaBytes > 0);
 assert.ok(deltaBytes < fullBytes * 0.2, `delta (${deltaBytes}) should be under 20% of full (${fullBytes})`);
 assert.deepEqual(applySnapshotDelta(frames[frames.length - 2], snapshotDelta(frames[frames.length - 2], frames[frames.length - 1])), frames[frames.length - 1], 'the real frame round-trips exactly');
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
