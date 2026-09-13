import test from 'node:test';
import assert from 'node:assert/strict';
import {Room} from './room.mjs';
import {NetClient} from '../game/net.mjs';
import {RULES} from '../game/data.mjs';
import {MatchHistory} from './history.mjs';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function makeRoom(humans=8, options={}) {
 const room=new Room('race',()=>.25,options);
 for(let id=1;id<=humans;id++)room.join(id,`Racer ${id}`);
 room.host(1,{mode:'puma-race',botCount:7,fragLimit:2,timeLimit:60},'exchange');
 room.start(1);
 return room;
}
function deliver(room,client,id) {
 for(const {to,msg} of room.drain())if(to===null||to===id)client.onMessage(JSON.stringify(msg));
}

test('eight humans start with eight seats and no bots; lobby and start advertise runtime cap',()=>{
 const room=makeRoom();
 assert.equal(room.match.actors.length,8);
 assert.equal(room.match.actors.filter(a=>a.bot).length,0);
 assert.equal(room.config.botCount,0);
 assert.equal(room.mapId,'puma-circuit');
 const messages=room.drain().map(x=>x.msg);
 assert.equal(messages.findLast(m=>m.type==='lobby').config.botCount,0);
 assert.equal(messages.find(m=>m.type==='start').config.botCount,0);
 for(const peer of room.peers.values()) {
  const actor=room.match.actors[peer.actorId];
  assert.equal(actor.name,peer.name);
  assert.equal(actor.vehicleId,actor.id);
  assert.equal(room.match.vehicles[actor.vehicleId].driver,actor.id);
 }
 const mixed=makeRoom(3);
 assert.equal(mixed.match.actors.length,8);
 assert.equal(mixed.match.config.botCount,5);
});

test('authoritative slot seven reconnects without duplicate actors or a race shadow',()=>{
 const room=makeRoom(),client=new NetClient();
 deliver(room,client,8);
 room.tick(1/30);deliver(room,client,8);
 assert.equal(client.actorId,7);assert.equal(client.resynced,true);assert.equal(client.shadow,null);
 const token=room.peers.get(8).token;
 room.disconnect(8);room.drain();
 room.tick(RULES.dt);
 const before=JSON.parse(JSON.stringify(room.wireState()));
 client.reset();
 room.join(80,'Replacement','chatgpt','openclaw',token);
 deliver(room,client,80);
 assert.equal(room.peers.has(8),false);
 assert.equal(room.peers.size,8);
 assert.equal(client.actorId,7);assert.equal(client.resynced,true);assert.equal(client.shadow,null);
 assert.deepEqual(client.state,before);
 assert.equal(client.state.actors.length,8);
 assert.equal(new Set(client.state.actors.map(a=>a.id)).size,8);
 assert.equal(client.state.actors[7].vehicleId,7);
 assert.equal(client.state.vehicles[7].driver,7);
 client.input({x:1,jump:true});
 room.input(80,{seq:client.inputSeq,x:1,jump:true});
 room.tick(1/30);deliver(room,client,80);
 assert.equal(client.pendingInputs.length,0);
 assert.equal(room.peers.get(80).appliedSeq,1);
});

test('race countdown stays fixed on the grid and held brake survives repeated server ticks',()=>{
 const room=makeRoom(),vehicle=room.match.vehicles[7];
 const grid={...vehicle.position};
 room.input(8,{x:1,yaw:-Math.PI/2,jump:true});
 for(let i=0;i<120;i++)room.tick(RULES.dt);
 assert.deepEqual(vehicle.position,grid);
 assert.ok(room.wireState().race.countdown>0);
 for(let i=0;i<65;i++)room.tick(RULES.dt);
 for(let i=0;i<10;i++) {
  room.tick(RULES.dt);
  assert.equal(vehicle.handbrake,true);
 }
 room.input(8,{jump:true});room.input(8,{jump:false});
 room.tick(RULES.dt);
 assert.equal(vehicle.handbrake,false,'latest release wins even within one tick');
});

for(const button of ['fire','power'])test(`held ${button} consumes one race item until released`,()=>{
 const room=makeRoom(),racer=room.match.race.racers[7];
 for(let i=0;i<181;i++)room.tick(RULES.dt);
 racer.item='oil';
 room.input(8,{[button]:true});room.tick(RULES.dt);
 assert.equal(racer.item,null);assert.equal(room.match.race.hazards.length,1);
 racer.item='oil';
 for(let i=0;i<10;i++) {
  room.input(8,{[button]:true});room.tick(RULES.dt);
 }
 assert.equal(racer.item,'oil');assert.equal(room.match.race.hazards.length,1);
 room.input(8,{[button]:false});room.tick(RULES.dt);
 room.input(8,{[button]:true});room.tick(RULES.dt);
 assert.equal(racer.item,null);assert.equal(room.match.race.hazards.length,2);
 assert.equal(room.match.stats.shots,0);
});

test('room forwards final race standings through result.race to history exactly once',t=>{
 const dir=mkdtempSync(join(tmpdir(),'race-history-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'matches.json'),history=new MatchHistory(file);
 const records=[];
 const room=makeRoom(8,{history:{record:entry=>{records.push(structuredClone(entry));return history.record(entry);}}});
 room.drain();
 const race=room.match.race;
 race.phase='racing';race.countdown=0;race.elapsed=60-RULES.dt/2;
 race.racers[7].passed=4;race.racers[7].started=true;race.racers[7].completedLaps=1;race.racers[7].lap=2;
 room.tick(RULES.dt);
 const result=room.drain().find(({msg})=>msg.type==='results').msg.state;
 assert.equal(result.race.phase,'finished');assert.equal(result.race.winnerId,7);
 assert.equal(records.length,1);
 assert.deepEqual(records[0].result.race,result.race);
 assert.equal(records[0].winner,7);assert.equal(records[0].endingReason,'time');
 assert.equal(records[0].result.race.standings[0].completedLaps,1);
 const saved=new MatchHistory(file).all()[0];
 assert.equal(saved.winnerActorId,7);assert.equal(saved.leader,'Racer 8');
 assert.equal(saved.race.winnerId,7);assert.equal(saved.race.standings[0].actorId,7);
 assert.equal(saved.race.standings[0].completedLaps,1);
 assert.equal(saved.players[7].race.position,1);
 room.tick(1);assert.equal(records.length,1);
});
