import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,navigation,walkEdge} from './core.mjs';
import {raceStandings} from './race.mjs';

const make=options=>new Match('chatgpt','openclaw',()=>.25,'exchange',{mode:'puma-race',fragLimit:2,timeLimit:180,...options});

test('direct Match falls back to circuit and caps eight humans plus bots',()=>{
  const m=make({humanCount:8,botCount:7});
  assert.equal(m.arena.id,'puma-circuit');assert.equal(m.actors.length,8);assert.equal(m.config.botCount,0);
  assert.equal(m.actors.filter(a=>!a.bot).length,8);
  assert.deepEqual(m.vehicles.map(v=>v.id),[0,1,2,3,4,5,6,7]);
  for(const a of m.actors){assert.equal(a.vehicleId,a.id);assert.equal(a.vehicleSeat,'driver');assert.equal(m.vehicleById(a.vehicleId).driver,a.id);}
  const snap=m.snapshot();assert.equal(snap.race.standings.length,8);assert.equal(snap.race.countdown,3);assert.equal(snap.race.laps,2);assert.equal(snap.winner,null);
});

test('race navigation uses only authored nodes and valid connected neighbor edges',t=>{
  const m=make({botCount:0}),authored=[...m.arena.navNodes,...m.arena.race.centerline,...m.arena.race.grid,...m.arena.race.itemBoxes];
  assert.deepEqual(m.nav,[]);
  const start=performance.now(),{nodes,edges}=navigation(m.arena);
  t.diagnostic(`Circuit navigation: ${(performance.now()-start).toFixed(1)} ms, ${nodes.length} nodes, ${m.arena.blocks.length} blocks`);
  assert.ok(nodes.length<200);
  for(const n of nodes)assert.ok(authored.some(p=>Math.hypot(n.x-p.x,n.z-p.z)<.1));
  for(const p of authored)assert.ok(nodes.some(n=>Math.hypot(n.x-p.x,n.z-p.z)<.1));
  const seen=new Set([0]),queue=[0];
  for(let i=0;i<queue.length;i++)for(const j of edges[queue[i]])if(!seen.has(j)){seen.add(j);queue.push(j);}
  assert.equal(seen.size,nodes.length);
  edges.forEach((list,i)=>list.forEach(j=>{
    assert.ok(edges[j].includes(i));assert.ok(walkEdge(nodes[i],nodes[j],m.arena));
  }));
});

test('all eight mounted racers get stock boost regardless of harness and no frags',()=>{
  const m=make({humanCount:8,botCount:0}),inputs={inputs:{}};
  m.actors.forEach((a,i)=>{
    a.harness=i%2?'hermes':'openclaw';a.active=10;
    inputs.inputs[a.id]={x:1,yaw:-Math.PI/2,sprint:true,fire:true,power:true};
  });
  m.step(3,inputs);m.step(1.5,inputs);
  for(const a of m.actors){
    const v=m.vehicleById(a.vehicleId);
    assert.equal(v.driver,a.id);assert.ok(v.speed>20);assert.ok(v.boostTimer>0);assert.equal(a.frags,0);
  }
  assert.equal(m.stats.shots,0);assert.equal(m.stats.kills,0);
});

test('race step bypasses combat, weapons, abilities, pickups, dismount and harness driving bonuses',()=>{
  const m=make({humanCount:8,botCount:0}),a=m.actors[0],b=m.actors[1];
  m.botInput=()=>{throw new Error('combat bot invoked');};
  m.objective=()=>{throw new Error('combat objective invoked');};
  const health=m.actors.map(a=>a.health),ammo=[...a.ammo];
  m.damage(b,99999,a);m.damageVehicle(m.vehicles[1],99999,a);m.fire(a);m.power(a);
  assert.equal(m.releaseVehicle(a),false);
  const controls={x:1,yaw:-Math.PI/2,fire:true,power:true,grenade:true,melee:true,reload:true,weapon:1};
  m.step(3,controls);m.step(1,controls);
  assert.deepEqual(m.actors.map(a=>a.health),health);assert.deepEqual(a.ammo,ammo);
  assert.equal(m.vehicles[1].health,m.vehicles[1].maxHealth);assert.equal(a.active,0);
  assert.equal(m.stats.shots,0);assert.equal(m.stats.powers,0);assert.equal(m.rockets.length,0);assert.equal(m.pickups.length,0);
  assert.equal(a.vehicleId,0);assert.equal(m.vehicles[0].lastStep.fired,false);
  assert.ok(m.vehicles[0].position.x>m.arena.race.grid[0].x);
  const before=m.race.racers[0].nextGate;m.step(1/60,{interact:true});assert.equal(a.vehicleId,0);assert.equal(m.race.racers[0].nextGate,before);
});

test('one human plus seven race bots drive the registered circuit to completion',()=>{
  const m=make({botCount:7});
  assert.equal(m.actors.filter(a=>a.bot).length,7);
  let resets=0;
  for(let i=0;i<10000&&!m.over;i++){m.step(1/30);if(m.race.racers.slice(1).some(r=>r.resetWait>0))resets++;}
  assert.equal(m.overReason,'race-finish',JSON.stringify(raceStandings(m.race)));
  assert.equal(resets,0);assert.notEqual(m.race.winnerId,0);
  assert.equal(m.actors.length,8);assert.ok(m.actors.every(a=>a.frags===0));
  const winner=m.race.winnerId;m.actors[0].frags=999;
  assert.deepEqual(m.leaders().map(a=>a.id),[winner]);
  const snapshot=m.snapshot();assert.equal(snapshot.winner,winner);assert.equal(snapshot.race.winnerId,winner);
  assert.equal(snapshot.race.standings[0].actorId,winner);assert.equal(snapshot.race.standings[0].completedLaps,2);
  const elapsed=m.race.elapsed;m.step(1);assert.equal(m.race.elapsed,elapsed);
});
