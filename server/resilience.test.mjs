import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MatchHistory} from './history.mjs';
import {ProgressionStore} from './progression.mjs';
import {RoomRegistry} from './rooms.mjs';

function rng(){let n=23;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);}
// Point the store at a path whose parent is a regular file, so mkdirSync throws
// ENOTDIR exactly like a hostile or full filesystem would.
function blockedPath(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'token-arena-block-'));const blocker=path.join(dir,'blocker');fs.writeFileSync(blocker,'x');return {blocker,file:path.join(blocker,'store.json')};}
const ID='player-0001-test';

test('a failing history write keeps the record in memory and retries later',async()=>{
 const {blocker,file}=blockedPath();
 const history=new MatchHistory(file);
 const entry=history.record({roomId:'A',mapId:'crosswire',config:{mode:'deathmatch',fragLimit:5,timeLimit:60},time:10,actors:[{name:'Alice',character:'chatgpt',harness:'openclaw',frags:3,deaths:1}]});
 assert.equal(entry.mode,'deathmatch');
 assert.equal(history.all().length,1,'the record survives in memory');
 await history.whenPersisted();
 assert.ok(history.lastPersistError,'the write failure is observable');
 assert.equal(await history.flush(),false,'backoff prevents an immediate retry');
 fs.rmSync(blocker);
 delete history._retryAt;
 assert.equal(await history.flush(),true,'the retry succeeds once the filesystem recovers');
 const reloaded=new MatchHistory(file);
 assert.equal(reloaded.all().length,1,'the recovered record is durable');
});

test('a failing progression write keeps the award and does not double-award',async()=>{
 const {blocker,file}=blockedPath();
 const store=new ProgressionStore(file);
 const first=store.award(ID,{win:true,actor:{frags:5,deaths:2},mode:'deathmatch'});
 assert.ok(first,'the award is returned despite the write failure');
 await store.whenPersisted();
 assert.ok(store.lastPersistError,'the write failure is observable');
 const level=store.get(ID).level;
 const retry=await store.flush();
 if(retry===false) delete store._retryAt;
 fs.rmSync(blocker);
 assert.equal(await store.flush(),true,'the retry succeeds once the filesystem recovers');
 const reloaded=new ProgressionStore(file);
 assert.equal(reloaded.get(ID).level,level,'the recovered award is durable and not duplicated');
});

test('a failing persistence write cannot stop results or other rooms',async()=>{
 const {file}=blockedPath();
 const history=new MatchHistory(file);
 const progression=new ProgressionStore(null);
 const registry=new RoomRegistry({random:rng(),history,progression});
 const room=registry.create('A');
 room.join(1,'A','chatgpt','openclaw','',false,ID);
 room.host(1,{botCount:0,timeLimit:30},'crosswire');
 room.start(1);
 room.drain();
 room.match.over=true;
 assert.doesNotThrow(()=>room.tick(1/60));
 const messages=room.drain();
 assert.ok(messages.some(m=>m.msg.type==='results'),'results are still broadcast');
 assert.equal(history.all().length,1,'the failed write still retains the record in memory');
 await history.whenPersisted();
 assert.ok(history.lastPersistError,'the store reports the failed write');

 const other=registry.create('B');
 other.join(2,'B','chatgpt','openclaw','',false,ID);
 other.host(2,{botCount:0,timeLimit:30},'crosswire');
 other.start(2);
 other.drain();
 const before=other.match.time;
 registry.tickAll(1/60);
 assert.ok(other.match.time>before,'the other room keeps ticking');
});

test('a throwing room does not stop the registry from ticking the rest',()=>{
 const registry=new RoomRegistry({random:rng()});
 let errors=0;
 registry.onError=()=>{errors++;};
 const broken=registry.create('A'),healthy=registry.create('B');
 broken.tick=()=>{throw new Error('boom');};
 healthy.join(2,'B','chatgpt','openclaw','',false,ID);
 healthy.host(2,{botCount:0,timeLimit:30},'crosswire');
 healthy.start(2);
 healthy.drain();
 const before=healthy.match.time;
 assert.doesNotThrow(()=>registry.tickAll(1/60));
 assert.equal(errors,1);
 assert.ok(healthy.match.time>before,'the healthy room kept ticking');
 assert.ok(registry.lastTickError);
});
