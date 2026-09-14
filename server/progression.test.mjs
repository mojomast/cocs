import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProgressionStore,validPlayerId} from './progression.mjs';
import {Room} from './room.mjs';

const tempFile=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'token-arena-prog-')),'progression.json');
const ID='player-0001-test';

test('player ids are validated before storage',()=>{
 assert.equal(validPlayerId('short'),false);
 assert.equal(validPlayerId('player-0001-test'),true);
 assert.equal(validPlayerId('bad id with spaces'),false);
 assert.equal(validPlayerId(42),false);
});

test('awards accumulate xp, levels and unlocks and persist across reload',async()=>{
 const file=tempFile(),store=new ProgressionStore(file);
 assert.equal(store.get(ID),null);
 const first=store.award(ID,{win:true,actor:{frags:40,scoreStats:{captures:1}}});
 assert.ok(first.gained>0);
 assert.ok(first.levelUp);
 assert.equal(first.profile.matches,1);
 assert.equal(first.profile.wins,1);
 await store.whenPersisted();
 assert.ok(fs.existsSync(file));
 const reloaded=new ProgressionStore(file);
 assert.equal(reloaded.get(ID).xp,first.profile.xp);
 assert.equal(reloaded.get(ID).level,first.profile.level);
 assert.equal(reloaded.get(ID).matches,1);
});

test('gear is level-gated and saved',async()=>{
 const file=tempFile(),store=new ProgressionStore(file);
 store.ensure(ID);
 assert.deepEqual(store.setGear(ID,{armor:'plating'}).gear,{});
 store.award(ID,{actor:{frags:800,scoreStats:{captures:5}}});
 const saved=store.setGear(ID,{armor:'plating',utility:'stim',primary:'heavy-barrel'});
 assert.ok(saved.level>=8,`level ${saved.level}`);
 assert.equal(saved.gear.armor,'plating');
 assert.equal(saved.gear.primary,'heavy-barrel');
 await store.whenPersisted();
 const reloaded=new ProgressionStore(file);
 assert.equal(reloaded.get(ID).gear.primary,'heavy-barrel');
});

test('per-mode career stats round-trip through persistence',async()=>{
 const file=tempFile(),store=new ProgressionStore(file);
 store.award(ID,{win:true,mode:'deathmatch',actor:{frags:7,scoreStats:{}}});
 store.award(ID,{win:false,mode:'ctf',actor:{frags:2,scoreStats:{captures:1}}});
 const live=store.get(ID).byMode;
 assert.deepEqual(live.deathmatch,{matches:1,wins:1,kills:7,best:7});
 assert.deepEqual(live.ctf,{matches:1,wins:0,kills:2,best:2});
 await store.whenPersisted();
 const reloaded=new ProgressionStore(file);
 assert.deepEqual(reloaded.get(ID).byMode,live);
 assert.deepEqual(reloaded.get(ID).byMode.ctf,{matches:1,wins:0,kills:2,best:2});
 const copies=store.all();
 copies[0].byMode.deathmatch.kills=999;
 assert.equal(store.get(ID).byMode.deathmatch.kills,7,'all() returns copied mode stats');
});

test('achievements and prestige mirror through the server store and persistence',async()=>{
 const file=tempFile(),store=new ProgressionStore(file);
 const first=store.award(ID,{win:true,actor:{frags:5,deaths:0,scoreStats:{}}});
 assert.ok(first.achievements.some(a=>a.id==='first-blood'),'first win unlocks an achievement server-side');
 assert.ok(first.achievementXp>0);
 const second=store.award(ID,{win:true,actor:{frags:5,deaths:0,scoreStats:{}}});
 assert.equal(second.achievements.some(a=>a.id==='first-blood'),false,'achievements pay once');
 await store.whenPersisted();
 const reloaded=new ProgressionStore(file);
 assert.equal(reloaded.get(ID).achievements['first-blood'],true);
 assert.equal(reloaded.get(ID).prestige,0);
 const copies=store.all();
 copies[0].achievements['first-blood']=false;
 assert.equal(store.get(ID).achievements['first-blood'],true,'all() copies achievements');
});

test('invalid ids never create profiles and all() returns copies',()=>{
 const store=new ProgressionStore();
 assert.equal(store.award('bad',{actor:{frags:1}}),null);
 assert.equal(store.setGear('bad',{armor:'plating'}),null);
 assert.equal(store.ensure('nope'),null);
 store.ensure(ID);
 const list=store.all();
 list[0].gear.armor='mutated';
 assert.equal(store.get(ID).gear.armor,undefined);
});

test('a completed room awards persistent progression to its players',async()=>{
 const file=tempFile(),store=new ProgressionStore(file),room=new Room('local',()=>.5,{progression:store});
 room.join(1,'Kyle','chatgpt','openclaw','',false,ID);
 room.host(1,{mode:'deathmatch',fragLimit:1,timeLimit:60,botCount:0},'exchange');
 room.start(1);
 for(let i=0;i<4000&&!room.roundOver;i++)room.tick(1/60);
 assert.equal(room.roundOver,true);
 const messages=room.drain();
 assert.ok(messages.some(item=>item.to===1&&item.msg.type==='progression'),'progression message queued');
 assert.equal(store.get(ID).matches,1);
 assert.ok(store.get(ID).xp>0);
 await store.whenPersisted();
 const reloaded=new ProgressionStore(file);
 assert.equal(reloaded.get(ID).xp,store.get(ID).xp);
});
test('spectators cannot write gear and writes are rate limited',()=>{
 const store=new ProgressionStore(null),room=new Room('r',()=>.5,{progression:store});
 room.join(1,'Host','chatgpt','openclaw','',false,ID);room.join(2,'Watcher','chatgpt','openclaw','',true,ID);
 room.drain();
 room.setGear(2,{primary:'light-frame'},undefined,1000);
 assert.equal(room.drain().filter(m=>m.to===2&&m.msg.type==='progression').length,0,'spectator gear write should be ignored');
 room.setGear(1,{primary:'light-frame'},undefined,1000);
 assert.equal(room.drain().filter(m=>m.to===1&&m.msg.type==='progression').length,1,'first write should apply');
 room.setGear(1,{primary:'light-frame'},undefined,1200);
 assert.equal(room.drain().filter(m=>m.to===1&&m.msg.type==='progression').length,0,'rapid write should be throttled');
 room.setGear(1,{primary:'light-frame'},undefined,1600);
 assert.equal(room.drain().filter(m=>m.to===1&&m.msg.type==='progression').length,1,'write after the window should apply');
});

test('progression eviction prefers the least recently used player',()=>{
 const store=new ProgressionStore(null,{max:2});
 store.ensure('player-0001');store.ensure('player-0002');
 store.get('player-0001');
 store.ensure('player-0003');
 assert.ok(store.get('player-0001'),'recently used player should survive');
 assert.equal(store.get('player-0002'),null,'least recently used player should be evicted');
 assert.ok(store.get('player-0003'));
});
test('team-mode awards follow the authoritative winner, not individual frags',()=>{
 for(const mode of ['assault','payload','teamdeathmatch']){
  const store=new ProgressionStore(null),room=new Room('r',()=>.5,{progression:store});
  room.join(1,'Winner','chatgpt','openclaw','',false,'player-0001-test');
  room.join(2,'Loser','claude','claudecode','',false,'player-0002-test');
  room.host(1,{mode,botCount:0,timeLimit:60,fragLimit:5},'crosswire');
  room.start(1);room.drain();
  const [a,b]=room.match.actors;
  a.frags=1;b.frags=9;
  room.match.teamScores={0:0,1:0};
  room.match.teamScores[a.team]=room.match.config.fragLimit;
  room.match.over=true;
  const calls=[];
  const original=store.award.bind(store);
  store.award=(id,result)=>{calls.push({id,win:result.win,team:result.actor?.team});return original(id,result);};
  room.tick(1/60);
  const winner=calls.find(call=>call.team===a.team),loser=calls.find(call=>call.team===b.team);
  assert.ok(winner&&loser,`${mode}: both players awarded`);
  assert.equal(winner.win,true,`${mode}: winning team player`);
  assert.equal(loser.win,false,`${mode}: losing team frag leader`);
 }
});
