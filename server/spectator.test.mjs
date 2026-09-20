import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,PLAYER_LIMIT,SPECTATOR_LIMIT} from './room.mjs';
import {quantizeNumbers} from '../game/quantize.mjs';
function rng(){let n=11;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);}
const find=(msgs,type,to)=>msgs.find(m=>m.msg.type===type&&(to===undefined||m.to===to))?.msg;
const last=(msgs,type)=>[...msgs].reverse().find(m=>m.msg.type===type)?.msg;
test('spectators join without a seat and never become host',()=>{
 const room=new Room('r',rng());
 room.join(1,'Watcher','chatgpt','openclaw','',true);
 const msgs=room.drain();
 assert.equal(find(msgs,'welcome',1).spectate,true);
 assert.equal(find(msgs,'welcome',1).host,false);
 assert.equal(room.hostId,null,'spectator cannot be first host');
 const lobby=last(msgs,'lobby');
 assert.equal(lobby.players.length,1);
 assert.equal(lobby.players[0].spectate,true);
 assert.equal(lobby.players[0].actorId,null);
 room.join(2,'Alice');
 room.join(3,'Bob');
 assert.equal(room.hostId,2,'first player becomes host');
 const lobby2=last(room.drain(),'lobby');
 assert.equal(lobby2.players.length,3);
 assert.equal(lobby2.players[0].spectate,true);
 assert.equal(lobby2.players[1].spectate,false);
});
test('spectators do not count toward the player limit',()=>{
 const room=new Room('r',rng());
 for(let i=1;i<=PLAYER_LIMIT;i++)room.join(i,`P${i}`);
 room.drain();
 room.join(PLAYER_LIMIT+1,'Overflow');
 assert.ok(find(room.drain(),'error',PLAYER_LIMIT+1),'9th player rejected');
 room.join(PLAYER_LIMIT+2,'Spectator One','chatgpt','openclaw','',true);
 room.join(PLAYER_LIMIT+3,'Spectator Two','chatgpt','openclaw','',true);
 const msgs=room.drain();
 assert.ok(!find(msgs,'error',PLAYER_LIMIT+2),'spectators join a full room');
 assert.ok(!find(msgs,'error',PLAYER_LIMIT+3));
});
test('start excludes spectators from humanCount and actor slots',()=>{
 const room=new Room('r',rng());
 room.join(1,'Watcher','chatgpt','openclaw','',true);
 room.join(2,'A');room.join(3,'B');
 room.host(2,{botCount:2,fragLimit:5,timeLimit:60},'crosswire');
 room.start(2);
 const msgs=room.drain();
 assert.equal(room.match.humanCount,2);
 assert.equal(room.match.actors.length,4,'two humans plus two bots');
 assert.equal(room.match.actors[0].name,'A');
 assert.equal(room.match.actors[1].name,'B');
 assert.ok(room.match.actors[0].bot===null&&room.match.actors[1].bot===null);
 const lobby=last(msgs,'lobby');
 const watcher=lobby.players.find(p=>p.name==='Watcher');
 assert.equal(watcher.actorId,null,'spectator has no actor id');
 assert.equal(watcher.spectate,true);
});
test('spectators cannot host or start',()=>{
 const room=new Room('r',rng());
 room.join(1,'Snoop','chatgpt','openclaw','',true);
 room.join(2,'Host');
 room.host(1,{botCount:2,fragLimit:5},'crosswire');
 let msgs=room.drain();
 assert.ok(find(msgs,'error',1));
 assert.equal(room.config,null);
 room.start(1);
 msgs=room.drain();
 assert.ok(find(msgs,'error',1));
 assert.equal(room.match,null);
});
test('spectator inputs are ignored while player inputs flow',()=>{
 const room=new Room('r',rng());
 room.join(1,'Snoop','chatgpt','openclaw','',true);
 room.join(2,'A');
 room.host(2,{botCount:0,timeLimit:30},'crosswire');
 room.start(2);
 room.drain();
 const [a]=room.match.actors;
 Object.assign(a,{x:0,y:0,z:0,protection:0,shotWait:0,health:100});
 room.input(1,{x:5,z:5,yaw:2,fire:true,jump:true,power:true});
 room.input(2,{yaw:Math.PI/2});
 room.tick(1/60);
 assert.equal(a.yaw,Math.PI/2,'player look applied');
 assert.equal(a.shots,0,'spectator fire ignored');
 room.input(2,{fire:true});
 for(let i=0;i<5;i++)room.tick(1/60);
 assert.ok(a.shots>0,'player fire still works');
});
test('spectators receive snapshots, event deltas and results',()=>{
 const room=new Room('r',rng());
 room.join(1,'Snoop','chatgpt','openclaw','',true);
 room.join(2,'A');room.join(3,'B');
 room.host(2,{botCount:0,fragLimit:5,timeLimit:60,respawn:1},'crosswire');
 room.start(2);
 room.drain();
 const [a,b]=room.match.actors;
 Object.assign(a,{x:-10,y:0,z:3.3,weapon:1,ammo:[Infinity,1,0,0,0],protection:0,shotWait:0,yaw:0,pitch:0});
 Object.assign(b,{x:-10,y:0,z:-3.3,protection:0,health:40});
 room.input(2,{yaw:0,fire:true});
 let sawEvents=false,sawSnapshot=false,sawResults=false;
 for(let i=0;i<3700&&!room.roundOver;i++){
  room.tick(1/60);
  const msgs=room.drain();
  if(msgs.some(m=>m.to===1&&m.msg.type==='events'))sawEvents=true;
  if(msgs.some(m=>m.msg.type==='snapshot')){sawSnapshot=true;const s=msgs.find(m=>m.msg.type==='snapshot').msg;assert.equal(s.state.actors.length,2);}
  if(msgs.some(m=>m.msg.type==='results')){sawResults=true;assert.equal(msgs.find(m=>m.msg.type==='results').to,null,'results broadcast reaches spectators');assert.equal(msgs.find(m=>m.msg.type==='results').msg.state.over,true);}
 }
 assert.ok(sawSnapshot,'spectator received snapshots');
 assert.ok(sawEvents,'spectator received event deltas');
 assert.ok(sawResults,'spectator received the broadcast results');
});
test('spectator session tokens survive disconnect and reattach',()=>{
 const room=new Room('r',rng(),{graceMs:60000});
 room.join(1,'Snoop','chatgpt','openclaw','',true);
 const msgs=room.drain();
 const token=find(msgs,'welcome',1).token;
 room.join(2,'A');
 room.host(2,{botCount:0,timeLimit:60},'crosswire');
 room.start(2);
 room.drain();
 room.disconnect(1);
 room.join(3,'ignored','chatgpt','openclaw',token,true);
 const m=room.drain();
 assert.equal(find(m,'welcome',3).reconnected,true);
 assert.equal(find(m,'welcome',3).spectate,true);
 const lobby=last(m,'lobby');
 const watcher=lobby.players.find(p=>p.name==='Snoop');
 assert.equal(watcher.actorId,null);
 assert.equal(watcher.spectate,true);
});
test('active spectator joins and reconnects receive lobby, targeted start and immediate snapshot',()=>{
 const room=new Room('r',rng());
 room.join(1,'Host');
 room.host(1,{botCount:0,timeLimit:60},'crosswire');
 room.start(1);
 room.tick(.1);
 const match=room.match;
 // Pending room settings must not replace the active round settings.
 room.host(1,{botCount:2,timeLimit:120},'exchange');
 room.drain();
 let token='';
 for(const id of [2,3]){
  const seq=room.seq;
  room.join(id,'Watcher','chatgpt','openclaw',token,true);
  const msgs=room.drain();
  assert.deepEqual(msgs.map(m=>m.msg.type),['welcome','lobby','start','snapshot']);
  assert.equal(find(msgs,'welcome',id).spectate,true);
  assert.deepEqual(find(msgs,'start',id),{type:'start',mapId:match.arena.id,config:match.config,roundRevision:room.roundRevision});
  assert.deepEqual(find(msgs,'snapshot',id).state,quantizeNumbers(structuredClone(match.snapshot())));
  assert.ok(find(msgs,'snapshot',id).seq>seq);
  assert.ok(msgs.filter(m=>['start','snapshot'].includes(m.msg.type)).every(m=>m.to===id));
  assert.equal(room.peers.get(id).actorId,null);
  assert.equal(room.match,match);
  assert.equal(match.actors.length,1);
  token=find(msgs,'welcome',id).token;
  room.disconnect(id);
  room.drain();
 }
});
test('spectator joins outside an active round do not receive start or snapshot',()=>{
 const room=new Room('r',rng());
 room.join(1,'Host');
 for(const id of [2,3]){
   room.drain();
   room.join(id,'Watcher','chatgpt','openclaw','',true);
   const joinTypes=room.drain().map(m=>m.msg.type);
   assert.deepEqual(joinTypes,id===2?['welcome','lobby']:['welcome','lobby','results']);
  room.start(1);
  room.match.over=true;
  room.tick(1/60);
 }
});
test('reconnecting spectator cannot claim a vacant host role',()=>{
 const room=new Room('r',rng());
 room.join(1,'Watcher','chatgpt','openclaw','',true);
 const token=find(room.drain(),'welcome',1).token;
 room.join(2,'Host');
 room.disconnect(1);
 room.leave(2);
 assert.equal(room.hostId,null);
 room.drain();
 room.join(3,'ignored','chatgpt','openclaw',token);
 const msgs=room.drain();
 assert.equal(find(msgs,'welcome',3).reconnected,true);
 assert.equal(find(msgs,'welcome',3).host,false);
 assert.equal(room.hostId,null);
 assert.equal(last(msgs,'lobby').hostId,null);
 room.join(4,'Next host');
 assert.equal(room.hostId,4);
});
test('spectators are capped so a room cannot be used as a fan-out amplifier',()=>{
 const room=new Room('r',rng());
 for(let i=1;i<=SPECTATOR_LIMIT;i++)room.join(i,`S${i}`,'chatgpt','openclaw','',true);
 room.drain();
 room.join(SPECTATOR_LIMIT+1,'Overflow','chatgpt','openclaw','',true);
 assert.ok(find(room.drain(),'error',SPECTATOR_LIMIT+1),'spectator past the limit is rejected');
 assert.equal([...room.peers.values()].filter(p=>p.spectate).length,SPECTATOR_LIMIT);
});
