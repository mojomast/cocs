import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {NetClient, NetHarness, interpolateSnapshots} from './net.mjs';
function rng(){let n=3;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);}
const config={humanCount:1,botCount:0,timeLimit:60};
test('connection and reconnection preserve registered UI callbacks',async t=>{
 class Socket {
  constructor(){queueMicrotask(()=>this.onopen());}
  close(){this.onclose?.();}
 }
 t.mock.method(globalThis,'WebSocket',function(){return new Socket();});
 const client=new NetClient();
 const names=['onStart','onResults','onLobby','onRooms','onHistory','onChat','onError','onClose'];
 const handlers=Object.fromEntries(names.map(name=>[name,t.mock.fn()]));
 Object.assign(client,handlers);
 for(let attempt=0;attempt<2;attempt++){
  await client.connect();
  for(const name of names)assert.equal(client[name],handlers[name],name);
  const rooms={type:'rooms',rooms:[{roomId:'local'}]};
  client.ws.onmessage({data:JSON.stringify(rooms)});
  assert.deepEqual(handlers.onRooms.mock.calls[attempt].arguments,[rooms]);
  client.close();
 }
 assert.equal(handlers.onClose.mock.callCount(),0,'intentional close does not notify');
});
for(const id of [1,7])test(`prediction applies controls after resync to actor ${id}`,()=>{
 const client=new NetClient();
 client.createShadow('crosswire',config);
 const actor={...client.shadow.actors[0],id,x:0,y:0,z:5,vx:0,vy:0,vz:0,grounded:true,shotWait:0,protection:0};
 client.resync(actor);
 client.predict({x:1,z:0,jump:true,yaw:.7,pitch:.2,fire:true});
 const predicted=client.shadow.actors[0];
 assert.equal(predicted.id,id);
 assert.equal(predicted.yaw,.7);
 assert.equal(predicted.pitch,.2);
 assert.ok(predicted.vx>0);
 assert.ok(predicted.vy>0);
 assert.equal(predicted.shots,1);
});
test('shadow prediction mirrors the authoritative simulation step-for-step',()=>{
 const server=new Match('chatgpt','openclaw',rng(),'crosswire',config);
 const client=new NetClient();
 client.createShadow('crosswire',config);
 const s=server.actors[0],p=client.shadow.actors[0];
 const seed={x:0,y:0,z:5,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,protection:0,health:100,jumpBuffer:0,coyote:0,shotWait:0};
 Object.assign(s,seed);Object.assign(p,seed);
 const moves=[
  {x:1,z:0,yaw:0,pitch:0,fire:false},
  {x:1,z:0,jump:true},
  {x:.5,z:.5,yaw:.4,pitch:.1,fire:true},
  {x:0,z:0,yaw:1.2,pitch:.3,fire:true},
  {x:0,z:0,yaw:1.2,power:true},
  {x:-1,z:.5,yaw:2,fire:false},
 ];
 for(let t=0;t<300;t++){
  const input={...moves[t%moves.length]};
  server.step(1/60,{inputs:{0:{...input}}});
  client.predict(input);
  const a=client.shadow.actors[0];
  assert.equal(a.x,server.actors[0].x,`x diverged at ${t}`);
  assert.equal(a.y,server.actors[0].y,`y diverged at ${t}`);
  assert.equal(a.z,server.actors[0].z,`z diverged at ${t}`);
  assert.equal(a.vy,server.actors[0].vy,`vy diverged at ${t}`);
  assert.equal(a.grounded,server.actors[0].grounded,`grounded diverged at ${t}`);
 }
});
test('snapshot resync converges the shadow to the authoritative state',()=>{
 const server=new Match('chatgpt','openclaw',rng(),'crosswire',config);
 const client=new NetClient();
 client.createShadow('crosswire',config);
 client.actorId=0;
 const s=server.actors[0],p=client.shadow.actors[0];
 Object.assign(s,{x:0,y:0,z:5,protection:0,health:100,ammo:[Infinity,0,0,0,0]});
 Object.assign(p,{x:8,y:0,z:8,protection:0,health:40,ammo:[Infinity,0,0,0,0]});
 server.spawn(s);
 const snap={state:{actors:[{...s}],rockets:[],pickups:[],time:0,over:false,feed:[],config:{},mapId:'crosswire',mapName:'',modeName:'',projectiles:0,stats:{},leaders:[]}};
 client.push(snap);
 assert.equal(client.resynced,true);
 assert.equal(client.shadow.actors[0].x,s.x);
 assert.equal(client.shadow.actors[0].z,s.z);
 assert.equal(client.shadow.actors[0].health,100);
 assert.equal(client.shadow.actors[0].ammo[0],Infinity);
});
test('acknowledged snapshots rebase and replay only unacknowledged inputs',()=>{
 const client=new NetClient();client.createShadow('crosswire',config);client.actorId=0;
 const seed={...client.shadow.actors[0],id:0,x:0,y:0,z:5,vx:0,vy:0,vz:0,grounded:true,protection:0,health:100,ammo:[Infinity,0,0,0,0,0,0,0]};client.resync(seed);
 const first={x:1,z:0,yaw:0,pitch:0,fire:false},second={x:1,z:0,yaw:.4,pitch:0,fire:false};client.input(first);client.predict(first);const authoritative={...client.shadow.actors[0]};client.input(second);client.predict(second);
 client.push({seq:1,acks:{0:1},state:{time:1,actors:[authoritative],rockets:[],pickups:[],feed:[],config:{},mapId:'crosswire',mapName:'',modeName:'',projectiles:0,stats:{},leaders:[]}});
 const expected=new Match('chatgpt','openclaw',rng(),'crosswire',config);expected.actors[0].id=0;Object.assign(expected.actors[0],authoritative);expected.step(1/60,{inputs:{0:second}});
 assert.deepEqual(client.pendingInputs.map(item=>item.seq),[2]);assert.equal(client.shadow.actors[0].x,expected.actors[0].x);assert.equal(client.shadow.actors[0].z,expected.actors[0].z);assert.equal(client.shadow.actors[0].yaw,.4);
});
test('resync, replay and prediction keep received nested actor state isolated',()=>{
 const server=new Match('chatgpt','openclaw',rng(),'crosswire',config);
 Object.assign(server.actors[0],{x:0,y:0,z:5,shotWait:0,powerups:{haste:5}});
 const state=JSON.parse(JSON.stringify(server.snapshot()));
 const original=structuredClone(state);
 const client=new NetClient();client.createShadow('crosswire',config);client.actorId=0;
 client.input({x:1,fire:true});
 client.push({seq:1,acks:{0:0},state});
 assert.deepEqual(state,original,'resync and pending input replay leave snapshot unchanged');
 const predicted=client.shadow.actors[0];
 for(const [key,value] of Object.entries(state.actors[0])){
  if(value&&typeof value==='object')assert.notEqual(predicted[key],value,`${key} is prediction-owned`);
 }
 client.predict({x:1,fire:true});
 predicted.scoreStats.captures++;
 predicted.powerups.haste=1;
 predicted.ammo[1]=99;
 assert.deepEqual(state,original,'subsequent prediction and nested writes leave snapshot unchanged');
 assert.equal(client.state,state);
 assert.equal(client.buffer[0].state,state);
 client.resync(state.actors[0]);
 assert.equal(predicted.scoreStats.captures,original.actors[0].scoreStats.captures);
 assert.equal(predicted.powerups.haste,5);
 assert.equal(predicted.ammo[0],Infinity,'wire ammo sentinel remains normalized');
});
test('older snapshots are ignored after a newer sequence',()=>{
 const client=new NetClient();client.push({seq:2,state:{time:2,actors:[{id:0,x:2}],rockets:[]}});client.push({seq:1,state:{time:1,actors:[{id:0,x:1}],rockets:[]}});assert.equal(client.state.actors[0].x,2);assert.equal(client.snapshotSeq,2);
});
test('NetClient persists and reuses the session token across reconnects',()=>{
 const store=new Map();
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const c=new NetClient('ws://test:1',{storage});
 assert.equal(c.token,null);
 c.onMessage(JSON.stringify({type:'welcome',peerId:5,host:true,token:'abc-123'}));
 assert.equal(c.token,'abc-123');
 assert.equal(store.get(c.storageKey),'abc-123');
 const c2=new NetClient('ws://test:1',{storage});
 assert.equal(c2.token,'abc-123','new instance loads the persisted token');
 c2.leave();
 assert.equal(c2.token,null,'explicit leave clears the token');
 assert.equal(store.get(c2.storageKey)??null,null);
  const c3=new NetClient('ws://test:2',{storage});
  assert.equal(c3.token,null,'tokens are scoped per server URL');
 });
test('renderState replaces the own actor with the predicted shadow',()=>{
 const client=new NetClient();
 client.createShadow('crosswire',config);
 client.actorId=1;
 const mk=(dx,dz)=>({state:{time:1,over:false,actors:[
  {id:0,name:'A',character:'chatgpt',harness:'openclaw',x:2,y:0,z:2,vx:0,vy:0,vz:0,yaw:0,pitch:0,health:100,armor:0,frags:0,deaths:0,dead:0,weapon:0,ammo:[Infinity,0,0,0,0],cooldown:0,active:0,slow:0,shotWait:0,protection:0,shots:0,bot:null},
  {id:1,name:'B',character:'gemini',harness:'cline',x:dx,y:0,z:dz,vx:0,vy:0,vz:0,yaw:0,pitch:0,health:100,armor:0,frags:0,deaths:0,dead:0,weapon:0,ammo:[Infinity,0,0,0,0],cooldown:0,active:0,slow:0,shotWait:0,protection:0,shots:0,bot:null},
 ],rockets:[],pickups:[],feed:[],config:{},mapId:'crosswire',mapName:'',modeName:'',projectiles:0,stats:{},leaders:[]}});
 client.push(mk(1,1));
 const p=client.shadow.actors[0];
 p.x=5;
 p.yaw=.9;
 const s=client.renderState(performance.now());
 assert.equal(s.actors.find(a=>a.id===1).x,5,'own actor uses predicted position');
 assert.equal(s.actors.find(a=>a.id===1).yaw,.9,'own actor uses predicted yaw');
 assert.equal(s.actors.find(a=>a.id===0).x,2,'remote actor stays interpolated');
  assert.equal(s.actors.find(a=>a.id===1).character,'gemini','predicted actor keeps server identity');
});
const snapShot=(seq,time,x=0,y=0)=>({seq,state:{time,over:false,actors:[{id:0,x,y,z:0,yaw:0,pitch:0}],rockets:[],vehicles:[]}});
test('render delay defaults to 100ms and decays toward the 90ms floor on a stable stream',t=>{
 let clock=1000;
 t.mock.method(performance,'now',()=>clock);
 const client=new NetClient();
 assert.equal(client.renderDelay,100,'default render delay');
 const step=1000/30;
 for(let i=0;i<80;i++){
  clock+=step;
  client.push(snapShot(i+1,i*step/1000,i));
 }
 assert.ok(client.renderDelay>=90&&client.renderDelay<95,`stable delay settles near the floor: ${client.renderDelay}`);
 assert.equal(client.bufferTarget,4,'stable buffer target stays at the minimum');
 assert.ok(client.buffer.length<=4,'stable buffer stays bounded');
 assert.equal(client.buffer[client.buffer.length-1].seq,80,'newest snapshot is retained');
});
test('render delay and buffer target rise under jitter and loss, within bounds',t=>{
 let clock=1000;
 t.mock.method(performance,'now',()=>clock);
 const client=new NetClient();
 const step=60;
 let seq=0,time=0;
 for(let i=0;i<80;i++){
  clock+=step+(i%2?50:-50);
  const drop=i>0&&i%7===0;
  seq+=drop?2:1;
  time+=(drop?2:1)*step/1000;
  client.push(snapShot(seq,time,i));
 }
 assert.ok(client.renderDelay>=90&&client.renderDelay<=160,`delay stays bounded: ${client.renderDelay}`);
 assert.ok(client.renderDelay>130,`delay rises under stress: ${client.renderDelay}`);
 assert.ok(client.bufferTarget>=4&&client.bufferTarget<=16,`buffer target stays bounded: ${client.bufferTarget}`);
 assert.ok(client.bufferTarget>4,`buffer target rises under stress: ${client.bufferTarget}`);
 assert.equal(client.buffer[client.buffer.length-1].seq,seq,'newest snapshot is never dropped');
 assert.ok(client.buffer.length<=16,'buffer never exceeds the maximum');
});
test('render delay can be seeded through options',t=>{
 const client=new NetClient('ws://test:9',{renderDelay:5});
 assert.equal(client.renderDelay,90,'out-of-range seed is clamped to the floor');
 const client2=new NetClient('ws://test:9',{renderDelay:300});
 assert.equal(client2.renderDelay,160,'out-of-range seed is clamped to the ceiling');
 const client3=new NetClient('ws://test:9',{renderDelay:120});
 assert.equal(client3.renderDelay,120,'in-range seed is honored');
});
test('renderState interpolates remote actors using the adaptive delay',t=>{
 let clock=1000;
 t.mock.method(performance,'now',()=>clock);
 const client=new NetClient();
 const mk=(time,x)=>({state:{time,over:false,actors:[{id:0,x,y:0,z:0,yaw:0,pitch:0}],rockets:[],vehicles:[]}});
 client.push(mk(0,0));
 clock=1033;
 client.push(mk(0.033,10));
 const now=1000+1000*(0.0165+client.renderDelay/1000);
 const s=client.renderState(now);
 assert.ok(Math.abs(s.actors[0].x-5)<0.01,`remote actor interpolates to the midpoint, got ${s.actors[0].x}`);
});
test('prediction clock stays bounded by authoritative time across delayed acks',()=>{
 const config={humanCount:1,botCount:0,timeLimit:60};
 const client=new NetClient();client.createShadow('crosswire',config);client.actorId=0;
 client.resync({...client.shadow.actors[0],id:0,x:0,y:0,z:5,vx:0,vy:0,vz:0,grounded:true,protection:0,health:100,ammo:[Infinity]});
 const dt=1/60,lag=6;let serverTime=0,snapshot=0;
 for(let tick=0;tick<30*60;tick++){
  const input={x:1,z:0,yaw:tick*.001,pitch:0};
  const sent=client.input(input);
  client.predict(input);
  serverTime+=dt;
  if(tick%2===1){
   snapshot++;
   const ack=Math.max(0,sent-lag);
   client.push({seq:snapshot,acks:{0:ack},state:{time:serverTime,over:false,actors:[{...client.shadow.actors[0]}],rockets:[],pickups:[],feed:[],config:{},mapId:'crosswire',mapName:'',modeName:'',projectiles:0,stats:{},leaders:[]}});
  }
 }
 assert.equal(client.shadow.over,false,'an active match must not time out the prediction shadow');
 assert.ok(client.shadow.time<serverTime+lag*dt+.25,`shadow clock ${client.shadow.time.toFixed(2)} should track server ${serverTime.toFixed(2)}`);
 const before=client.shadow.actors[0].yaw;
 client.predict({x:0,z:0,yaw:before+1,pitch:0});
 assert.equal(client.shadow.actors[0].yaw,before+1,'prediction must stay responsive');
});
test('an authoritative over state still stops prediction',()=>{
 const config={humanCount:1,botCount:0,timeLimit:60};
 const client=new NetClient();client.createShadow('crosswire',config);client.actorId=0;
 client.resync({...client.shadow.actors[0],id:0,x:0,y:0,z:5,protection:0,health:100,ammo:[Infinity]});
 client.push({seq:1,acks:{0:0},state:{time:60,over:true,actors:[{...client.shadow.actors[0]}],rockets:[],pickups:[],feed:[],config:{},mapId:'crosswire',mapName:'',modeName:'',projectiles:0,stats:{},leaders:[]}});
 assert.equal(client.shadow.over,true);
 assert.equal(client.shadow.time,60);
});
test('reconnecting disposes the previous socket and ignores stale events',async t=>{
 const sockets=[];
 class Socket{
  constructor(){this.readyState=0;this.closed=false;sockets.push(this);}
  close(){this.closed=true;this.readyState=3;}
  open(){this.readyState=1;this.onopen?.();}
  message(data){this.onmessage?.({data});}
  remoteClose(){this.readyState=3;this.onclose?.();}
 }
 t.mock.method(globalThis,'WebSocket',function(){return new Socket();});
 const client=new NetClient();
 const first=client.connect(),a=sockets[0];a.open();await first;
 const stale={onopen:a.onopen,onerror:a.onerror,onclose:a.onclose,onmessage:a.onmessage};
 const second=client.connect(),b=sockets[1];b.open();await second;
 assert.equal(a.closed,true,'the superseded socket is closed');
 assert.equal(client.connected,true);
 stale.onclose();
 assert.equal(client.connected,true,'a stale close must not drop the live connection');
 stale.onmessage({data:JSON.stringify({type:'welcome',peerId:999,host:true})});
 assert.notEqual(client.peerId,999,'a stale message must not overwrite the current peer');
 const rooms={type:'rooms',rooms:[{roomId:'live'}]};client.ws.onmessage({data:JSON.stringify(rooms)});
 assert.deepEqual(client.rooms,rooms.rooms,'the current socket still delivers messages');
 client.close();
});
test('a superseded connect promise rejects instead of hanging',async t=>{
 const sockets=[];
 class Socket{constructor(){this.readyState=0;sockets.push(this);}close(){this.readyState=3;}}
 t.mock.method(globalThis,'WebSocket',function(){return new Socket();});
 const client=new NetClient();
 const first=client.connect();
 const second=client.connect();
 await assert.rejects(first,/superseded/);
 const b=sockets[1];b.readyState=1;b.onopen?.();
 await second;
 assert.equal(client.connected,true);
 client.close();
});

test('malformed protocol frames never throw or corrupt client state',()=>{
 const client=new NetClient();
 client.peerId=1;
 assert.doesNotThrow(()=>client.onMessage(JSON.stringify({type:'lobby',players:null})));
 assert.deepEqual(client.players,[]);
 const events=client.events.length;
 assert.doesNotThrow(()=>client.onMessage(JSON.stringify({type:'events'})));
 assert.equal(client.events.length,events);
 assert.doesNotThrow(()=>client.onMessage(JSON.stringify({type:'rooms',rooms:null})));
 assert.deepEqual(client.rooms,[]);
 assert.doesNotThrow(()=>client.onMessage(JSON.stringify({type:'history',matches:'nope'})));
 assert.deepEqual(client.matches,[]);
 client.createShadow('crosswire',config);
  assert.doesNotThrow(()=>client.push({seq:99,state:{time:0}}));
});

test('race disables shadows, acknowledges input and interpolates the local driver and car',t=>{
 let clock=1000;
 t.mock.method(performance,'now',()=>clock);
 const client=new NetClient();
 client.createShadow('crosswire',config);
 client.onMessage(JSON.stringify({type:'start',mapId:'puma-circuit',config:{mode:'puma-race',botCount:7}}));
 assert.equal(client.shadow,null,'never construct a one-player race shadow');
 assert.equal(client.resynced,false);
 client.actorId=7;
 const match=new Match('chatgpt','openclaw',rng(),'puma-circuit',{mode:'puma-race',humanCount:8,botCount:0});
 const first=JSON.parse(JSON.stringify(match.snapshot()));
 client.input({jump:true,fire:true});
 client.push({seq:1,acks:{7:1},state:first});
 assert.equal(client.resynced,true,'input sending remains enabled without prediction');
 assert.equal(client.pendingInputs.length,0);
 const second=structuredClone(first);
 second.time=.1;
 second.actors[7].x+=10;second.vehicles[7].x+=10;
 second.race.countdown=2.9;second.race.standings[7].item='shield';
 clock=1100;
 client.push({seq:2,acks:{7:1},state:second});
 const original=structuredClone(second);
 client.predict({x:1,jump:true,fire:true});
 const view=client.renderState(client.clockOffset+50+client.renderDelay);
 assert.ok(Math.abs(view.actors[7].x-first.actors[7].x-5)<1e-8);
 assert.ok(Math.abs(view.vehicles[7].x-first.vehicles[7].x-5)<1e-8);
 assert.equal(view.actors[7].vehicleId,7);
 assert.equal(view.vehicles[7].driver,7);
 assert.deepEqual(view.race,second.race,'countdown, items and laps are never predicted');
 assert.deepEqual(client.viewMatch().race,second.race);
 assert.deepEqual(second,original);
});

test('soccer disables the prediction shadow and forwards the authoritative race state',()=>{
 const client=new NetClient();
 client.createShadow('crosswire',config);
 assert.notEqual(client.shadow,null,'combat modes still build a prediction shadow');
 client.onMessage(JSON.stringify({type:'start',mapId:'puma-pitch',config:{mode:'puma-soccer',botCount:0}}));
 assert.equal(client.shadow,null,'never construct a one-player soccer shadow');
 assert.equal(client.resynced,false);
 client.actorId=0;
 const match=new Match('chatgpt','openclaw',rng(),'puma-pitch',{mode:'puma-soccer',humanCount:2,botCount:0});
 const snap=JSON.parse(JSON.stringify(match.snapshot()));
 assert.equal(snap.race.kind,'soccer');
 client.input({jump:true,power:true,fire:true});
 client.push({seq:1,acks:{0:1},state:snap});
 assert.equal(client.shadow,null,'a soccer snapshot never re-enables prediction');
 assert.equal(client.resynced,true,'input sending remains enabled without prediction');
 assert.equal(client.pendingInputs.length,0);
 const view=client.viewMatch();
 assert.equal(view.race.kind,'soccer');
 assert.deepEqual(view.race,client.state.race);
 assert.equal(client.renderState(performance.now()).race.kind,'soccer');
});

test('connect rejects when the socket closes before opening',async t=>{
 const sockets=[];
 class Socket{constructor(){this.readyState=0;sockets.push(this);}close(){this.readyState=3;}}
 t.mock.method(globalThis,'WebSocket',function(){return new Socket();});
 const client=new NetClient();
 const pending=client.connect();
 const ws=sockets[0];
 ws.readyState=3;
 ws.onclose?.();
 await assert.rejects(pending,/connection closed before open/);
 assert.equal(client.connected,false);
 assert.equal(client._pendingReject,null);
});

test('malformed snapshots do not throw or block subsequent valid frames',()=>{
 const client=new NetClient();
 client.createShadow('crosswire',config);
 client.actorId=0;
 assert.doesNotThrow(()=>client.onMessage(JSON.stringify({type:'snapshot',seq:1,acks:{0:0},state:{time:0,over:false,actors:[{id:0,ammo:null},null],vehicles:[null],rockets:[]}})));
 assert.equal(client.resynced,true);
 assert.doesNotThrow(()=>client.onMessage(JSON.stringify({type:'snapshot',seq:2,acks:{0:0},state:{time:0,over:false,actors:[{id:0,x:1,y:0,z:5,ammo:[Infinity,0,0,0,0]}],vehicles:[null],rockets:[]}})));
 assert.equal(client.shadow.actors[0].x,1);
 assert.equal(client.shadow.actors[0].ammo[0],Infinity);
});

test('vehicle resync applies vy, flight, altitude, gunner and passengers',()=>{
 const client=new NetClient();
 client.createShadow('crosswire',config);
 client.shadow.vehicles=[{id:'v1',position:{x:0,y:0,z:0},velocity:{x:0,z:0},heading:0,health:100,maxHealth:100,driver:null,gunner:null,passengers:[],vy:0}];
 client.resyncVehicles([{id:'v1',x:1,y:2,z:3,vx:4,vz:5,yaw:6,vy:7,flight:true,altitude:8,gunner:2,passengers:[3,4]}]);
 const v=client.shadow.vehicles[0];
 assert.equal(v.vy,7);
 assert.equal(v.flight,true);
 assert.equal(v.altitude,8);
 assert.equal(v.gunner,2);
 assert.deepEqual(v.passengers,[3,4]);
});

test('voiceSignal propagates a rejected send instead of reporting success',t=>{
 class Socket{constructor(){this.readyState=1;this.bufferedAmount=0;this.sent=[];}send(text){this.sent.push(text);}}
 Socket.OPEN=1;
 t.mock.method(globalThis,'WebSocket',Socket);
 const client=new NetClient('ws://voice:1');
 assert.equal(client.voiceSignal(2,{description:{type:'offer',sdp:'x'}}),false,'no socket reports failure');
 client.ws=new Socket();
 const oversized={description:{type:'offer',sdp:'x'.repeat(70000)}};
 assert.equal(client.voiceSignal(2,oversized),false,'oversized signal is rejected');
 assert.equal(client.ws.sent.length,0,'oversized signal is never written');
 assert.equal(client.voiceSignal(2,null),false,'malformed payload reports failure');
 assert.equal(client.voiceSignal(2,{description:{type:'offer',sdp:'ok'}}),true,'valid signal reports success');
 assert.equal(client.ws.sent.length,1);
 assert.equal(JSON.parse(client.ws.sent[0]).type,'voice-signal');
});

test('progression token is generated, transported and persisted',t=>{
 const store=new Map();
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const sent=[];
 class Socket{constructor(){this.readyState=1;}send(text){sent.push(JSON.parse(text));}}
 Socket.OPEN=1;
 t.mock.method(globalThis,'WebSocket',Socket);
 const client=new NetClient('ws://test:3',{storage});
 client.ws=new Socket();
 const token=client.progressToken;
 assert.equal(typeof token,'string');
 assert.ok(token.length>=32,`token is at least 32 chars: ${token}`);
 assert.equal(store.get('token-arena-progress-token'),token);
 client.join('n','chatgpt','openclaw');
 client.create('n','chatgpt','openclaw');
 assert.equal(sent[0].progressToken,token);
 assert.equal(sent[1].progressToken,token);
 client.onMessage(JSON.stringify({type:'welcome',peerId:1,host:true,progressToken:'server-issued-token-abcdefghijklmnopqrstuvwxyz'}));
 assert.equal(client.progressToken,'server-issued-token-abcdefghijklmnopqrstuvwxyz');
 assert.equal(store.get('token-arena-progress-token'),'server-issued-token-abcdefghijklmnopqrstuvwxyz');
});

test('interpolateSnapshots blends linearly, wraps angles and leaves the predicted local actor untouched', () => {
 const prev = {actors: [{id: 0, x: 0, y: 0, z: 0, yaw: -Math.PI + .1}, {id: 1, x: 0, y: 0, z: 0, yaw: 0}], rockets: [], vehicles: []};
 const next = {actors: [{id: 0, x: 10, y: 4, z: -6, yaw: Math.PI - .1}, {id: 1, x: 20, y: 0, z: 0, yaw: 0}], rockets: [], vehicles: []};
 const mid = interpolateSnapshots(prev, next, .5);
 assert.equal(mid.actors[0].x, 5);
 assert.equal(mid.actors[0].y, 2);
 assert.equal(mid.actors[0].z, -3);
 assert.ok(Math.abs(Math.abs(mid.actors[0].yaw) - Math.PI) < 1e-9, 'shortest arc crosses the seam');
 assert.equal(mid.actors[1].x, 10);
 const predicted = interpolateSnapshots(prev, next, .5, {localId: 0, predicted: true});
 assert.equal(predicted.actors[0].x, 10, 'predicted local actor is not smoothed');
 assert.equal(interpolateSnapshots(prev, null, .5), prev, 'a missing next frame returns prev');
});

test('NetHarness reconciles prediction under latency with zero divergence and delta savings', () => {
 const harness = new NetHarness({mapId: 'crosswire', config: {humanCount: 1, botCount: 0, timeLimit: 60}, seed: 7, latency: 3, delta: true, keyframeEvery: 5});
 for (let i = 0; i < 60; i++) harness.step({forward: 1, right: i % 3 === 0 ? 1 : 0, jump: i === 20});
 harness.flush();
 assert.ok(harness.divergence() < 1e-6, `shadow converged (${harness.divergence()})`);
 assert.ok(harness.stats.deltaFrames > 0, 'deltas are emitted');
 assert.ok(harness.stats.deltaBytes / harness.stats.deltaFrames < harness.stats.fullBytes / harness.stats.fullFrames, 'deltas are smaller on average than full frames');
 assert.ok(harness.stats.dropped === 0);
});

test('NetHarness delta frames shrink sharply with id-keyed array diffing', () => {
 const harness = new NetHarness({mapId: 'crosswire', config: {humanCount: 1, botCount: 7, timeLimit: 60}, seed: 3, latency: 3, delta: true, keyframeEvery: 30});
 for (let i = 0; i < 180; i++) harness.step({forward: 1, right: i % 5 === 0 ? 1 : 0});
 harness.flush();
 const avgDelta = harness.stats.deltaBytes / harness.stats.deltaFrames;
 const avgFull = harness.stats.fullBytes / harness.stats.fullFrames;
 assert.ok(harness.stats.deltaFrames > 5, 'deltas are emitted');
 assert.ok(avgDelta < avgFull * 0.5, `average delta ${avgDelta.toFixed(0)}B should be far below a full frame ${avgFull.toFixed(0)}B`);
 assert.ok(harness.divergence() < 1e-6, `shadow still converges (${harness.divergence()})`);
});

test('NetHarness recovers from packet loss and re-syncs on a keyframe', () => {
 const harness = new NetHarness({mapId: 'crosswire', config: {humanCount: 1, botCount: 0, timeLimit: 60}, seed: 9, latency: 2, loss: .5, delta: true, keyframeEvery: 4});
 for (let i = 0; i < 120; i++) harness.step({forward: 1});
 harness.flush();
 assert.ok(harness.stats.dropped > 0, 'some frames were dropped');
 assert.ok(harness.client.deltaMisses > 0, 'a missing delta base is counted');
 assert.ok(harness.client.snapshotSeq > 0, 'the client kept applying snapshots');
 assert.ok(harness.divergence() < 1e-6, `lossy link still converges (${harness.divergence()})`);
});
