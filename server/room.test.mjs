import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,PLAYER_LIMIT,LOADOUT_LOCKOUT_MS,LOADOUT_FLOOD_MS} from './room.mjs';
import {MatchHistory} from './history.mjs';
import {RULES} from '../game/data.mjs';
import {applySnapshotDelta,wireSize,SNAPSHOT_DELTA_VERSION} from '../game/protocol.mjs';
function rng(){let n=11;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);}
const find=(msgs,type,to)=>msgs.find(m=>m.msg.type===type&&(to===undefined||m.to===to))?.msg;
const last=(msgs,type)=>[...msgs].reverse().find(m=>m.msg.type===type)?.msg;
test('first joiner becomes host; Claude restriction and names are applied',()=>{
 const room=new Room('r',rng());
 room.join(1,'Alice','chatgpt','openclaw');
 room.join(2,'Bob','claude','hermes');
 room.join(3,'','unknown','hermes');
 const msgs=room.drain();
 assert.equal(find(msgs,'welcome',1).host,true);
 assert.equal(find(msgs,'welcome',2).host,false);
 const lobby=last(msgs,'lobby');
 assert.equal(lobby.hostId,1);
 assert.equal(lobby.players.length,3);
 assert.equal(lobby.players[1].name,'Bob');
 assert.equal(lobby.players[1].harness,'claudecode');
 assert.equal(lobby.players[2].name,'ChatGPT');
 assert.equal(lobby.players[2].character,'chatgpt');
 assert.equal(room.hostId,1);
});
test('host sets normalized config; non-host cannot host or start',()=>{
 const room=new Room('r',rng());
 room.join(1,'Host');room.join(2,'Peon');
 room.drain();
 room.host(2,{botCount:99,fragLimit:1},'bogus');
 let msgs=room.drain();
 assert.ok(find(msgs,'error',2));
 assert.equal(room.config,null);
 room.host(1,{botCount:2,fragLimit:5,timeLimit:60,damage:2},'crosswire');
 room.drain();
 assert.equal(room.config.botCount,2);
 assert.equal(room.config.fragLimit,5);
 assert.equal(room.config.damage,2);
 assert.equal(room.mapId,'crosswire');
 room.start(2);
 assert.ok(find(room.drain(),'error',2));
 assert.equal(room.match,null);
});
test('start creates a match with one actor per peer plus bots; actor ids and names align',()=>{
 const room=new Room('r',rng());
 room.join(1,'Alice');room.join(2,'Bob');
 room.host(1,{botCount:2,fragLimit:5,timeLimit:60},'crosswire');
 room.start(1);
 const msgs=room.drain();
 assert.equal(room.started,true);
 assert.equal(room.roundOver,false);
 assert.equal(room.match.actors.length,4);
 assert.equal(room.match.humanCount,2);
 assert.equal(room.match.actors[0].name,'Alice');
 assert.equal(room.match.actors[1].name,'Bob');
 assert.ok(room.match.actors[0].bot===null&&room.match.actors[1].bot===null);
 assert.ok(room.match.actors[2].bot&&room.match.actors[3].bot);
 const lobby=last(msgs,'lobby');
 assert.deepEqual(lobby.players.map(p=>p.actorId),[0,1]);
});
test('remote inputs drive look, fire and events stream back as deltas',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');room.join(2,'B');
 room.host(1,{botCount:0,timeLimit:30},'crosswire');
 room.start(1);
 room.drain();
 const [a,b]=room.match.actors;
 Object.assign(a,{x:-9,y:0,z:8,protection:0,shotWait:0,yaw:0,pitch:0});
 Object.assign(b,{x:-9,y:0,z:-2,protection:0,shotWait:0,yaw:0,pitch:0});
  room.input(1,{seq:10,yaw:0,fire:true});
  room.input(2,{seq:20,yaw:Math.PI,fire:true});
 for(let i=0;i<4;i++)room.tick(1/60);
 const msgs=room.drain();
 // Phase 2's spawn-stat re-cut gives ChatGPT 5 spawn armor; armor soaks the
 // first 5 of the 11 shot, so the hit takes 6 health (100 - 6 = 94).
 assert.equal(a.health,94);
 assert.equal(b.health,94);
 assert.ok(Math.abs(b.yaw-Math.PI)<1e-9);
 const ev1=find(msgs,'events',1).items,ev2=find(msgs,'events',2).items;
 assert.ok(ev1.some(e=>e.type==='damage'&&e.actor===1&&e.source===0));
 assert.ok(ev2.some(e=>e.type==='damage'&&e.actor===0&&e.source===1));
  assert.ok(find(msgs,'snapshot').state.actors[1].health===94);
  assert.ok(find(msgs,'snapshot').state.actors[0].health===94);
  assert.deepEqual(find(msgs,'snapshot').acks,{0:10,1:20});
});
test('start and rematch preserve every human validated loadout',()=>{
 const room=new Room('r',rng());
 room.join(1,'Alice','kimi','hermes');
 room.join(2,'Watcher','chatgpt','openclaw','',true);
 room.join(3,'Bob','claude','hermes');
 room.join(4,'Carol','invalid','invalid');
 room.host(1,{botCount:1},'crosswire');
 const expected=[['Alice','kimi','hermes'],['Bob','claude','claudecode'],['Carol','chatgpt','openclaw']];
 for(let round=0;round<2;round++){
  room.drain();
  room.start(1);
  assert.deepEqual(room.match.actors.slice(0,3).map(a=>[a.name,a.character,a.harness]),expected);
  assert.ok(room.match.actors.slice(0,3).every(a=>a.bot===null));
  assert.ok(room.match.actors[3].bot);
  const msgs=room.drain();
  assert.ok(msgs.findIndex(m=>m.msg.type==='lobby')<msgs.findIndex(m=>m.msg.type==='start'));
  room.match.over=true;
  room.tick(1/60);
  assert.equal(room.roundOver,true);
 }
});
test('match completes on the timer and results broadcast once with final events delivered',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');room.join(2,'B');
 room.host(1,{botCount:0,fragLimit:5,timeLimit:60,respawn:1},'crosswire');
 room.start(1);
 room.drain();
 const [a,b]=room.match.actors;
 Object.assign(a,{x:-10,y:0,z:3.3,weapon:1,ammo:[Infinity,1,0,0,0],protection:0,shotWait:0,yaw:0,pitch:0});
 Object.assign(b,{x:-10,y:0,z:-3.3,protection:0,health:40});
 room.input(1,{yaw:0,fire:true});
 for(let i=0;i<3700&&!room.roundOver;i++)room.tick(1/60);
 const msgs=room.drain();
 assert.equal(room.roundOver,true);
 assert.equal(room.match.over,true);
 assert.equal(a.frags,1);
 assert.equal(msgs[msgs.length-1].msg.type,'results');
 assert.equal(msgs[msgs.length-1].msg.state.over,true);
 const ev=msgs.filter(m=>m.msg.type==='events'&&m.to===1).flatMap(m=>m.msg.items);
 assert.ok(ev.some(e=>e.type==='death'));
 assert.ok(ev.some(e=>e.type==='damage'&&e.source===0));
});
test('leave mid-match hands the seat to a bot; pre-start leave frees the slot',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');room.join(2,'B');
 room.host(1,{botCount:0,timeLimit:30},'crosswire');
 room.start(1);
 room.drain();
 const [a,b]=room.match.actors;
 Object.assign(b,{x:-9,y:0,z:0,protection:0});
 room.input(2,{x:1,z:1});
 room.leave(2);
 let moved=false;
 for(let i=0;i<240;i++){room.tick(1/60);if(Math.hypot(b.x+9,b.z)>1)moved=true;}
 assert.ok(b.bot,'seat is handed to a bot');
 assert.ok(moved,'bot takes over the vacated seat');
 assert.equal(room.peers.size,1);
 assert.equal(room.hostId,1);
 room2: {
  const r=new Room('r2',rng());
  r.join(1,'A');r.join(2,'B');
  r.leave(1);
  r.host(2,{botCount:0},'crosswire');
  r.start(2);
  assert.equal(r.match.actors.length,1);
  assert.equal(r.match.actors[0].name,'B');
  assert.equal(r.hostId,2);
 }
});
test('jump and power arrive as one-shot edges while fire stays level',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');
 room.host(1,{botCount:0,timeLimit:30},'crosswire');
 room.start(1);
 room.drain();
 const [a]=room.match.actors;
 Object.assign(a,{x:0,y:0,z:0,protection:0,shotWait:0,health:100});
 room.input(1,{jump:true});
 room.input(1,{jump:true});
 room.tick(1/60);
 assert.ok(a.vy>0,'first edge should jump');
 const vy1=a.vy;
 for(let i=0;i<10;i++)room.tick(1/60);
 assert.ok(a.vy<=vy1,'repeated held edge must not re-jump');
 a.health=100;a.cooldown=0;
 room.input(1,{power:true});
 room.input(1,{power:true});
 room.tick(1/60);
 assert.equal(room.match.stats.powers,1);
 assert.ok(a.cooldown>0);
 const shots=a.shots;
  for(let i=0;i<20;i++)room.tick(1/60);
  assert.equal(room.match.stats.powers,1,'power edge consumed exactly once');
});
test('short fire taps survive one tick without sticking; held fire still repeats',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);
 const a=room.match.actors[0],peer=room.peers.get(1);
 a.shotWait=0;
 room.input(1,{seq:1,fire:true});room.input(1,{seq:2,fire:false});
 room.tick(1/120);
 assert.equal(a.shots,0);
 assert.equal(peer.edgeFire,true);
 room.tick(1/120);
 assert.equal(a.shots,1);
 assert.equal(peer.edgeFire,false);
 assert.equal(peer.latest.fire,false);
 for(let i=0;i<60;i++)room.tick(1/60);
 assert.equal(a.shots,1,'released tap must not repeat');
 room.input(1,{seq:3,fire:true,weapon:0});
 for(let i=0;i<60;i++)room.tick(1/60);
 assert.ok(a.shots>2,'held fire repeats beyond the latched tick');
 room.input(1,{seq:4,fire:false});
 room.input(1,{seq:3,fire:true});
 const shots=a.shots;
 for(let i=0;i<60;i++)room.tick(1/60);
 assert.equal(a.shots,shots,'release stops held fire and stale presses are ignored');
});
for(const lifecycle of ['start','disconnect','reconnect','leave','expireGrace'])test(`${lifecycle} clears pending and held fire`,()=>{
 const room=new Room('r',rng(),{graceMs:1000});
 room.join(1,'A');room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);
 const peer=room.peers.get(1);
 assert.equal(peer.edgeFire,false);
 room.input(1,{fire:true});
 room.input(1,{reload:true});
 assert.equal(peer.edgeFire,true);
 assert.equal(peer.edgeReload,true);
 if(lifecycle==='reconnect'||lifecycle==='expireGrace')room.disconnect(1);
 if(lifecycle==='reconnect')room.join(2,'','','',peer.token);
 else if(lifecycle==='expireGrace')room.expireGrace(peer.disconnectedAt+1001);
 else room[lifecycle](1);
 assert.equal(peer.edgeFire,false);
 assert.equal(peer.edgeReload,false,'one-shot reload edge is cleared');
 assert.equal(peer.lastReload,false,'held reload is cleared');
 assert.equal(peer.latest,null);
 if(lifecycle==='disconnect'){
  room.input(1,{fire:true});
  room.input(1,{reload:true});
  assert.equal(peer.edgeFire,false,'late disconnected input cannot rearm fire');
  assert.equal(peer.edgeReload,false,'late disconnected input cannot rearm reload');
  assert.equal(peer.latest,null);
 }
 if(lifecycle!=='leave'&&lifecycle!=='expireGrace'){
  for(let i=0;i<60;i++)room.tick(1/60);
  assert.equal(room.match.actors[0].shots,0,'no stale fire after lifecycle reset');
 }
});
test('disconnect holds the seat; token reattach restores mid-match play',()=>{
 const room=new Room('r',rng(),{graceMs:60000});
 room.join(1,'A');room.join(2,'B');
 const msgs=room.drain();
 const tokenB=find(msgs,'welcome',2).token;
 room.host(1,{botCount:0,timeLimit:60},'crosswire');
 room.start(1);
 room.drain();
 assert.equal(room.match.actors[1].name,'B');
 room.disconnect(2);
 let lobby=last(room.drain(),'lobby');
 assert.equal(lobby.players.length,2);
 assert.equal(lobby.players[1].connected,false);
 room.join(3,'ignored','chatgpt','openclaw',tokenB);
 const m=room.drain();
 assert.equal(find(m,'welcome',3).reconnected,true);
 lobby=last(m,'lobby');
 assert.equal(lobby.players.length,2);
 assert.equal(lobby.players[1].name,'B');
 assert.equal(lobby.players[1].actorId,1);
 room.input(3,{yaw:0,fire:true});
 for(let i=0;i<30;i++)room.tick(1/60);
 const ev=room.drain().filter(x=>x.msg.type==='events').flatMap(x=>x.msg.items);
 assert.ok(ev.some(e=>e.type==='shot'&&e.actor===1));
});
test('grace expiry converts the seat to a bot and migrates the host',()=>{
 const room=new Room('r',rng(),{graceMs:1000});
 room.join(1,'Host');room.join(2,'B');
 const msgs=room.drain();
 const token1=find(msgs,'welcome',1).token;
 room.host(1,{botCount:0,timeLimit:60},'crosswire');
 room.start(1);
 room.drain();
 assert.equal(room.match.actors[0].bot,null);
 room.disconnect(1);
 assert.equal(room.hostId,1,'host stays reserved during grace');
 room.expireGrace(Date.now()+5000);
 assert.equal(room.hostId,2,'host migrates after grace');
 assert.ok(room.match.actors[0].bot,'seat becomes a bot');
 assert.ok(room.match.actors[0].name.endsWith('· BOT'));
 room.join(3,'','','',token1);
 const m=room.drain();
 assert.equal(find(m,'welcome',3)?.reconnected,undefined,'expired token reattaches nothing');
 assert.equal(find(m,'welcome',3)?.token===token1,false,'expired token gets a fresh session');
 assert.equal(last(m,'lobby').players.length,2,'rejoin creates a fresh seat');
});
test('explicit leave mid-match converts the seat to a bot immediately',()=>{
 const room=new Room('r',rng(),{graceMs:60000});
 room.join(1,'A');room.join(2,'B');
 room.host(1,{botCount:0,timeLimit:60},'crosswire');
 room.start(1);
 room.drain();
 room.leave(2);
 assert.ok(room.match.actors[1].bot);
 assert.equal(room.match.actors[1].name,'B · BOT');
 assert.equal(room.peers.size,1);
 assert.equal(room.hostId,1);
});
test('disconnected host who reconnects inside grace stays host; play resumes',()=>{
 const room=new Room('r',rng(),{graceMs:60000});
 room.join(1,'Host');room.join(2,'B');
 const msgs=room.drain();
 const token1=find(msgs,'welcome',1).token;
 room.host(1,{botCount:0,timeLimit:60},'crosswire');
 room.start(1);
 room.drain();
 room.disconnect(1);
 room.join(3,'','','',token1);
 const m=room.drain();
 assert.equal(find(m,'welcome',3).reconnected,true);
 assert.equal(room.hostId,3,'reconnected host keeps the host role');
 assert.equal(room.match.actors[0].bot,null,'seat was never converted');
 room.input(3,{yaw:0,fire:true});
 for(let i=0;i<30;i++)room.tick(1/60);
 assert.ok(room.match.actors[0].shots>0,'inputs flow again after reattach');
});
test('start can rematch after a completed round; inputs ignored while round over',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');room.join(2,'B');
 room.host(1,{botCount:0,fragLimit:5,timeLimit:60,respawn:1},'crosswire');
 room.start(1);
 room.drain();
 const [a,b]=room.match.actors;
 Object.assign(a,{x:-10,y:0,z:3.3,weapon:1,ammo:[Infinity,1,0,0,0],protection:0,shotWait:0,yaw:0});
 Object.assign(b,{x:-10,y:0,z:-3.3,protection:0,health:40});
 room.input(1,{yaw:0,fire:true});
 for(let i=0;i<3700&&!room.roundOver;i++)room.tick(1/60);
 room.drain();
 room.input(1,{fire:true});
 const m1=room.match;
 room.start(1);
 assert.notEqual(room.match,m1);
 assert.equal(room.roundOver,false);
 assert.equal(room.match.actors[0].health,100);
 assert.equal(room.match.actors[0].frags,0);
 assert.ok(find(room.drain(),'start'));
});
test('non-finite movement input is ignored rather than poisoning the actor state',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);room.drain();
 room.input(1,{x:Infinity,z:-Infinity,yaw:0});room.tick(1/60);
 const actor=room.match.actors[0];
 assert.ok([actor.x,actor.y,actor.z,actor.vx,actor.vy,actor.vz].every(Number.isFinite));
});
test('reconnecting after a completed round receives the final result',()=>{
 const room=new Room('r',rng(),{graceMs:60000});
 room.join(1,'A');const token=find(room.drain(),'welcome',1).token;
 room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);room.drain();
 room.match.over=true;room.tick(1/60);room.drain();room.disconnect(1);room.drain();
 room.join(2,'ignored','','',token);const result=find(room.drain(),'results',2);
 assert.equal(result.state.over,true);
 assert.equal(result.state.time,room.match.time);
});
test('final results and history preserve cloned scoreStats',()=>{
 const history=new MatchHistory();
 const room=new Room('r',rng(),{history});
 room.join(1,'A');const token=find(room.drain(),'welcome',1).token;
 room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);room.drain();
 const stats=room.match.actors[0].scoreStats;
 stats.captures=2;stats.objectiveTime=7.5;stats.goals=stats.goals??0;
 room.match.over=true;room.tick(1/60);
 const result=find(room.drain(),'results').state;
 assert.deepEqual(result.actors[0].scoreStats,{...stats});
 assert.deepEqual(history.all()[0].players[0].scoreStats,{...stats});
 stats.captures=99;
 assert.equal(result.actors[0].scoreStats.captures,2);
 assert.equal(history.all()[0].players[0].scoreStats.captures,2);
 room.disconnect(1);room.join(2,'ignored','','',token);
   assert.deepEqual(find(room.drain(),'results',2).state.actors[0].scoreStats,{...stats,captures:99});
});
test('history records the map actually played, not a pending mid-match change',()=>{
 const history=new MatchHistory();
 const room=new Room('r',rng(),{history});
 room.join(1,'A');room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);room.drain();
 assert.equal(room.match.arena.id,'crosswire');
 room.host(1,{botCount:0,timeLimit:30},'exchange');
 assert.equal(room.match.arena.id,'crosswire','the running match keeps its arena');
 room.match.over=true;room.tick(1/60);room.drain();
 assert.equal(history.all()[0].mapId,'crosswire','history records the map that was played');
});
test('a soccer room starts, scores through the sim and records the team result',()=>{
 const history=new MatchHistory();
 const room=new Room('soccer',rng(),{history});
 room.join(1,'Alice');room.join(2,'Bob');
 room.host(1,{mode:'puma-soccer',botCount:0,fragLimit:1,timeLimit:60},'puma-pitch');
 room.start(1);
 assert.equal(room.mapId,'puma-pitch');
 assert.equal(room.match.config.mode,'puma-soccer');
 assert.equal(room.match.race.kind,'soccer');
 assert.equal(room.match.race.racers.length,4);
 assert.equal(room.match.race.racers.filter(racer=>racer.team===0).length,2);
 assert.equal(room.match.race.racers.filter(racer=>racer.team===1).length,2,'bots fill the empty seats for 2v2');
 for(let i=0;i<Math.ceil(3/RULES.dt)+10&&room.match.race.phase!=='playing';i++)room.tick(RULES.dt);
 assert.equal(room.match.race.phase,'playing','kickoff countdown runs on room ticks');
 const scorer=room.match.race.racers.find(racer=>racer.team===0);
 room.match.race.lastTouch=scorer.actorId;
 const ball=room.match.race.ball;
 ball.x=29.9;ball.z=0;ball.y=1.1;ball.vx=12;ball.vz=0;
 for(let i=0;i<240&&!room.roundOver;i++)room.tick(RULES.dt);
 assert.equal(room.match.race.scores[0],1);
 assert.equal(room.match.race.winnerTeam,0);
 assert.equal(room.roundOver,true);
 const results=room.drain().filter(m=>m.msg.type==='results');
 assert.equal(results.length,1);
 assert.equal(results[0].msg.state.winner,0);
 assert.equal(results[0].msg.state.race.kind,'soccer');
 const entry=history.all()[0];
 assert.equal(entry.mode,'puma-soccer');
 assert.equal(entry.mapId,'puma-pitch');
 assert.equal(entry.winnerTeam,0);
 assert.deepEqual(entry.scores,{0:1,1:0});
 assert.equal(entry.leader,'Alice');
 assert.equal(entry.players[0].goals,1);
 assert.equal(entry.race.standings.find(standing=>standing.actorId===scorer.actorId).goals,1);
});

test('snapshot broadcast rate defaults to 30 Hz and is configurable',()=>{
 const count=(options,steps)=>{
  const room=new Room('r',rng(),options);
  room.join(1,'A');room.host(1,{botCount:0,timeLimit:300},'crosswire');room.start(1);room.drain();
  for(let i=0;i<steps;i++)room.tick(1/60);
  return room.drain().filter(m=>m.msg.type==='snapshot').length;
 };
 assert.equal(count(undefined,60),30,'default broadcast is 30 Hz');
 assert.equal(count({snapshotHz:20},60),20,'broadcast rate is configurable');
});
test('a spectator joining mid-match does not replay buffered events',()=>{
 const room=new Room('r',rng(),{graceMs:1000});
 room.join(1,'Host');room.host(1,{botCount:2,timeLimit:60,fragLimit:5},'crosswire');room.start(1);
 for(let i=0;i<180;i++)room.tick(1/60);
 const serial=room.match.serial;
 assert.ok(serial>0,'expected some match events before the join');
 room.join(2,'Watcher','chatgpt','openclaw','',true);
 room.drain();
 room.tick(1/60);
 const events=room.drain().filter(m=>m.to===2&&m.msg.type==='events').flatMap(m=>m.msg.items);
 assert.ok(events.every(e=>e.id>serial),`spectator should not replay history (${events.map(e=>e.id).join(',')})`);
});

test('mid-match player joins become spectators instead of ghost seats',()=>{
 const room=new Room('r',rng(),{graceMs:1000});
 room.join(1,'Host');room.host(1,{botCount:1,timeLimit:60,fragLimit:5},'crosswire');room.start(1);
 room.drain();
 room.join(2,'Latecomer','chatgpt','openclaw');
 const welcome=room.drain().find(m=>m.to===2&&m.msg.type==='welcome')?.msg;
 assert.equal(welcome.spectate,true);
 assert.equal(room.peers.get(2).actorId,null);
});
test('hosting a mode repairs an incompatible arena and start uses the repaired map',()=>{
 const room=new Room('r',rng());
 room.join(1,'Host');room.drain();
 room.host(1,{mode:'ctf',botCount:0,timeLimit:60},'colosseum');
 assert.notEqual(room.mapId,'colosseum','incompatible arena is repaired');
 room.start(1);
 const start=last(room.drain(),'start');
 assert.equal(start.mapId,room.mapId);
 assert.equal(room.match.config.mode,'ctf');
 assert.ok(room.match.flagSpawns[0]&&room.match.flagSpawns[1],'repaired map authors flag bases');
});
test('a compatible arena is preserved when hosting',()=>{
 const room=new Room('r',rng());
 room.join(1,'Host');room.drain();
 room.host(1,{mode:'ctf',botCount:0},'launchpad');
 assert.equal(room.mapId,'launchpad');
});
test('inputs are magnitude-clamped and cannot be poisoned by an absurd sequence jump',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');room.join(2,'B');
 room.host(1,{botCount:0,timeLimit:30},'crosswire');
 room.start(1);room.drain();
 const peer=room.peers.get(1);
 room.input(1,{seq:5,x:5,z:-9,fire:false});
 assert.equal(peer.latest.x,1);
 assert.equal(peer.latest.z,-1);
 assert.equal(peer.receivedSeq,5);
 // A rogue jump is snapped to the next expected sequence instead of honored.
 room.input(1,{seq:1e9,x:0,z:0});
 assert.equal(peer.receivedSeq,6);
 assert.equal(peer.latestSeq,6);
 // A stale sequence is ignored.
 room.input(1,{seq:6,yaw:1,x:0,z:0});
 assert.equal(peer.receivedSeq,6);
 // Non-finite axes and look become safe defaults; finite axes still clamp.
 room.input(1,{seq:7,x:NaN,yaw:Infinity,z:2});
 assert.equal(peer.receivedSeq,7);
 assert.equal(peer.latest.x,0);
 assert.equal(peer.latest.z,1);
 assert.equal(peer.latest.yaw,undefined);
});
test('broadcast snapshots are quantized without mutating authoritative match state',()=>{
 const room=new Room('r',rng(),{snapshotHz:30});
 room.join(1,'A');room.host(1,{botCount:1,timeLimit:60},'crosswire');room.start(1);room.drain();
 const actor=room.match.actors[0];
 Object.assign(actor,{x:1.23456789,z:2.987654321,vx:0,vz:0,grounded:true,powerups:{haste:30.123456789}});
 for(let i=0;i<4;i++)room.tick(1/60);
 const snap=last(room.drain(),'snapshot');
 assert.ok(snap,'a snapshot was broadcast');
 const wire=snap.state.actors.find(a=>a.id===actor.id);
 assert.equal(wire.x,Math.round(wire.x*1000)/1000);
 assert.equal(wire.z,Math.round(wire.z*1000)/1000);
 assert.equal(snap.state.time,Math.round(snap.state.time*1000)/1000);
 assert.equal(wire.powerups.haste,Math.round(wire.powerups.haste*1000)/1000);
 // The clone is quantized; the real actor keeps full precision.
 assert.notEqual(actor.powerups.haste,wire.powerups.haste);
 assert.ok(Math.abs(actor.x-1.23456789)<1e-6);
});
test('a melee press is forwarded as a one-shot edge and consumed on tick',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);room.drain();
 const peer=room.peers.get(1);
 room.input(1,{seq:1,melee:true});
 assert.equal(peer.edgeMelee,true);
 room.input(1,{seq:2,melee:true});
 assert.equal(peer.edgeMelee,true,'holding melee does not re-arm it');
 room.tick(1/60);
 assert.equal(peer.edgeMelee,false,'the tick consumes the edge');
 room.input(1,{seq:3,melee:false});
 assert.equal(peer.edgeMelee,false);
 room.input(1,{seq:4,melee:true});
 assert.equal(peer.edgeMelee,true,'release then press re-arms');
});
test('game inputs are rate limited per peer',()=>{
 const room=new Room('r',rng());
 room.join(1,'A');room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);room.drain();
 const peer=room.peers.get(1);
 for(let i=1;i<=300;i++)room.input(1,{seq:i,x:0,z:0});
 assert.ok(peer.receivedSeq<=120,`accepted too many: ${peer.receivedSeq}`);
 assert.ok(peer.receivedSeq>=100,`accepted too few: ${peer.receivedSeq}`);
 // A fresh window accepts again.
 peer.inputRate=null;
 room.input(1,{seq:200,x:0,z:0});
 assert.equal(peer.receivedSeq,200);
});
test('grenade is a one-shot edge and cannot auto-repeat while held',()=>{
 const room=new Room('r',rng(),{graceMs:1000});
 room.join(1,'A');room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);
 const peer=room.peers.get(1);
 room.input(1,{grenade:true});
 assert.equal(peer.edgeGrenade,true,'first press arms the edge');
 room.tick(1/60);
 assert.equal(peer.edgeGrenade,false,'tick consumes the edge');
 room.input(1,{grenade:true});
 assert.equal(peer.edgeGrenade,false,'holding does not re-arm');
 room.input(1,{grenade:false});
 room.input(1,{grenade:true});
 assert.equal(peer.edgeGrenade,true,'a fresh press re-arms');
});

test('mobility is forwarded as a held input, never as an edge',()=>{
 const room=new Room('r',rng());
 room.join(1,'A','chatgpt','openclaw');room.host(1,{botCount:0,timeLimit:30},'crosswire');room.start(1);room.drain();
 const peer=room.peers.get(1),a=room.match.actors[0];
 room.input(1,{seq:1,mobility:true});
 assert.equal(peer.latest.mobility,true,'the held bind reaches the simulation');
 room.input(1,{seq:2,mobility:true,x:.5});
 assert.equal(peer.latest.mobility,true,'holding keeps forwarding it like sprint/crouch/ads');
 room.tick(1/60);
 assert.equal(peer.latest.mobility,true,'a tick does not consume the held field');
 assert.equal(a.inputMobility,true,'core latched the held state for edge derivation');
 room.input(1,{seq:3,mobility:false});
 assert.equal(peer.latest.mobility,undefined,'release clears the held field');
 room.tick(1/60);
 assert.equal(a.inputMobility,false);
});

test('votes from a disconnected peer stop counting toward quorum',()=>{
 const room=new Room('r',rng(),{graceMs:600000});
 room.join(1,'A');room.join(2,'B');room.join(3,'C');room.join(4,'D');
 room.drain();
 room.mapVote(1,'forge');room.mapVote(2,'forge');
 room.requestRematch(1);room.requestRematch(2);
 assert.equal(room.lifecycle().mapVotes.forge,2);
 assert.equal(room.lifecycle().rematch,2);
 room.disconnect(2);
 assert.equal(room.lifecycle().mapVotes.forge,1,'a disconnected voter no longer counts');
 assert.equal(room.lifecycle().rematch,1);
});

test('a reconnecting peer must ready up again',()=>{
 const room=new Room('r',rng());
 room.join(1,'A','chatgpt','openclaw');
 const token=room.drain().find(m=>m.msg.type==='welcome')?.msg.token;
 assert.ok(token,'the server issued a reconnect token');
 assert.equal(room.setReady(1,true),true);
 assert.equal(room.lifecycle().ready,1);
 room.drain();
 room.join(9,'A','chatgpt','openclaw',token);
 const lobby=room.drain().find(m=>m.msg.type==='lobby')?.msg;
 assert.equal(lobby.players.find(p=>p.peerId===9).ready,false,'reconnect clears ready');
 assert.equal(room.lifecycle().ready,0);
});

test('capable peers receive id-keyed deltas that rebuild the authoritative state',()=>{
 const room=new Room('r',rng(),{snapshotHz:30,keyframeEvery:0});
 room.join(1,'Alice','chatgpt','openclaw','',false,'','',SNAPSHOT_DELTA_VERSION);
 room.join(2,'Bob','claude','claudecode','',false,'','',SNAPSHOT_DELTA_VERSION);
 room.host(1,{botCount:2,fragLimit:5,timeLimit:60},'crosswire');
 room.start(1);
 room.drain();
 const bases=new Map();
 let fulls=0,deltas=0,fullBytes=0,deltaBytes=0;
 for(let i=0;i<70;i++){
  room.tick(1/60);
  for(const {to,msg} of room.drain()){
   if(to===null) continue;
   if(msg.type==='snapshot'){ bases.set(to,msg.state); fulls++; fullBytes+=wireSize(msg); }
   else if(msg.type==='snapshot-delta'){ bases.set(to,applySnapshotDelta(bases.get(to),msg.patch)); deltas++; deltaBytes+=wireSize(msg); }
  }
 }
 assert.ok(fulls>=1,'the first frame for each capable peer is a full keyframe');
 assert.ok(deltas>10,`deltas dominate the stream, got ${deltas}`);
 assert.ok(deltaBytes/deltas<fullBytes/fulls*0.25,`deltas (${(deltaBytes/deltas).toFixed(0)}B) should be far smaller than a full frame (${(fullBytes/fulls).toFixed(0)}B)`);
 assert.deepEqual(bases.get(1),room.wireState(),'replaying peer 1 frames rebuilds the authoritative state');
 assert.deepEqual(bases.get(2),room.wireState(),'replaying peer 2 frames rebuilds the authoritative state');
});

test('a capable peer is sent a periodic full keyframe',()=>{
 const room=new Room('r',rng(),{snapshotHz:30,keyframeEvery:5});
 room.join(1,'Alice','chatgpt','openclaw','',false,'','',SNAPSHOT_DELTA_VERSION);
 room.host(1,{botCount:2,fragLimit:5,timeLimit:60},'crosswire');
 room.start(1);
 room.drain();
 let fulls=0,deltas=0;
 for(let i=0;i<60;i++){
  room.tick(1/60);
  for(const {to,msg} of room.drain()){ if(to===null) continue; if(msg.type==='snapshot')fulls++; else if(msg.type==='snapshot-delta')deltas++; }
 }
 assert.ok(deltas>0,'frames between keyframes are deltas');
 assert.ok(fulls>=5,`a keyframe arrives at the configured cadence, got ${fulls}`);
});

test('a peer without delta capability only ever receives full snapshots',()=>{
 const room=new Room('r',rng(),{snapshotHz:30});
 room.join(1,'Alice','chatgpt','openclaw');
 room.host(1,{botCount:2,fragLimit:5,timeLimit:60},'crosswire');
 room.start(1);
 room.drain();
 for(let i=0;i<40;i++) room.tick(1/60);
 const frames=room.drain().filter(m=>m.to===1&&(m.msg.type==='snapshot'||m.msg.type==='snapshot-delta'));
 assert.ok(frames.length>0,'the peer is streamed frames');
 assert.ok(frames.every(m=>m.msg.type==='snapshot'),'an old client never gets a delta it cannot apply');
 assert.equal(room.deltaFrames,0);
 assert.ok(room.fullFrames>0);
});

test('a peer that joins after the chain started is sent a full keyframe first',()=>{
 const room=new Room('r',rng(),{snapshotHz:30,keyframeEvery:0});
 room.join(1,'Alice','chatgpt','openclaw','',false,'','',SNAPSHOT_DELTA_VERSION);
 room.host(1,{botCount:2,fragLimit:5,timeLimit:60},'crosswire');
 room.start(1);
 room.drain();
 for(let i=0;i<10;i++) room.tick(1/60);
 room.drain();
 room.join(9,'Carl','gemini','cline','',true,'','',SNAPSHOT_DELTA_VERSION);
 const joinMsgs=room.drain();
 assert.equal(joinMsgs.find(m=>m.to===9&&m.msg.type==='snapshot')?.msg.type,'snapshot','a late joiner gets a full snapshot immediately');
 room.tick(1/60);room.tick(1/60);
 const first=room.drain().find(m=>m.to===9&&(m.msg.type==='snapshot'||m.msg.type==='snapshot-delta'));
 assert.equal(first?.msg.type,'snapshot','the late joiner has no matching base, so the next frame is full again');
});

// ---------------------------------------------------------------------------
// Phase 4 team-mode respawn switching (§3.7, §12.2). `teamMode` alone would
// admit puma-soccer, horde and campaign, so the gate also uses the movement and
// single-player mode rules.
// ---------------------------------------------------------------------------
test('respawn switching rejects locked modes, spectators, unknown and disconnected peers',()=>{
  const ffa=new Room('ffa',rng());
  ffa.join(1,'A');ffa.host(1,{mode:'deathmatch',botCount:0,timeLimit:60},'crosswire');ffa.start(1);ffa.drain();
  assert.equal(ffa.setLoadout(1,'grok','hermes'),false,'FFA locks the pick');
  const soccer=new Room('soccer',rng());
  soccer.join(1,'A');soccer.host(1,{mode:'puma-soccer',botCount:0,timeLimit:60},'puma-pitch');soccer.start(1);soccer.drain();
  assert.equal(soccer.setLoadout(1,'grok','hermes'),false,'soccer strips combat kits');
  const pre=new Room('pre',rng());
  pre.join(1,'A','chatgpt','openclaw');
  pre.host(1,{mode:'ctf',botCount:0,timeLimit:60},'crosswire');
  assert.equal(pre.setLoadout(1,'grok','hermes'),false,'there is no live match to switch into');
  const room=new Room('r',rng());
  room.join(1,'A');room.join(2,'B');room.join(3,'Watch','chatgpt','openclaw','',true);
  room.host(1,{mode:'teamdeathmatch',botCount:0,timeLimit:60},'crosswire');
  room.start(1);room.drain();
  assert.equal(room.setLoadout(3,'grok','hermes'),false,'spectators cannot switch');
  assert.equal(room.setLoadout(99,'grok','hermes'),false,'unknown peer');
  room.disconnect(2);
  assert.equal(room.setLoadout(2,'grok','hermes'),false,'a disconnected peer cannot switch');
  assert.equal(room.setLoadout(1,'grok','hermes'),true,'a connected team-mode player may switch');
});
test('a team-mode switch queues on the peer, the room and the match and lands on respawn',()=>{
  const room=new Room('r',rng());
  room.join(1,'A');room.join(2,'B');
  room.host(1,{mode:'teamdeathmatch',botCount:0,timeLimit:60},'crosswire');
  room.start(1);room.drain();
  const actor=room.match.actors[0];
  assert.equal(room.setLoadout(1,'claude','openclaw'),true);
  assert.deepEqual(room.pendingLoadouts.get(1),{character:'claude',harness:'claudecode'});
  assert.deepEqual(room.peers.get(1).pendingLoadout,{character:'claude',harness:'claudecode'});
  assert.equal(actor.character,'chatgpt','the switch is queued, not applied while alive');
  const lobby=last(room.drain(),'lobby');
  assert.equal(lobby.players.find(p=>p.peerId===1).character,'claude','teammates see the queued choice');
  actor.protection=0;
  room.match.damage(actor,1e6,actor);
  for(let i=0;i<600&&actor.health<=0;i++)room.tick(1/60);
  assert.equal(actor.character,'claude');
  assert.equal(actor.harness,'claudecode');
  assert.equal(actor.health,actor.maxHealth);
});
test('respawn switching honours the 60 s lockout and the 500 ms anti-flood floor',()=>{
  const room=new Room('r',rng());
  room.join(1,'A');room.host(1,{mode:'teamdeathmatch',botCount:0,timeLimit:60},'crosswire');room.start(1);room.drain();
  const t0=1_000_000;
  assert.equal(room.setLoadout(1,'grok','hermes',t0),true);
  assert.equal(room.peers.get(1).loadoutLockUntil,t0+LOADOUT_LOCKOUT_MS);
  assert.equal(room.setLoadout(1,'mistral','openclaw',t0+LOADOUT_FLOOD_MS-1),false,'anti-flood floor');
  assert.equal(room.setLoadout(1,'mistral','openclaw',t0+2000),false,'within the 60 s lockout');
  assert.equal(room.setLoadout(1,'mistral','openclaw',t0+LOADOUT_LOCKOUT_MS-1),false);
  assert.equal(room.setLoadout(1,'mistral','openclaw',t0+LOADOUT_LOCKOUT_MS),true,'the lockout expires');
});
test('sudden death and the VIP lock respawn switching',()=>{
  const room=new Room('r',rng());
  room.join(1,'A');room.host(1,{mode:'ctf',botCount:0,timeLimit:60},'crosswire');room.start(1);room.drain();
  room.match.suddenDeath=true;
  assert.equal(room.setLoadout(1,'grok','hermes'),false,'sudden death locks the pick');
  room.match.suddenDeath=false;
  room.match.actors[0].isVip=true;
  assert.equal(room.setLoadout(1,'grok','hermes'),false,'the VIP is locked');
  room.match.actors[0].isVip=false;
  assert.equal(room.setLoadout(1,'grok','hermes'),true);
});
