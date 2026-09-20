import test from 'node:test';
import assert from 'node:assert/strict';
import {HORNET,createVehicle,stepVehicle,vehicleMuzzles} from './vehicles.mjs';
import {Match} from './core.mjs';

const floor=()=>0;
const collide=next=>({...next,y:Math.max(next.y,1.6)});

test('Hornet is a flight chassis with resolved config and paired muzzles',()=>{
 const h=createVehicle({id:'troop',kind:'hornet',x:0,y:0,z:0});
 assert.equal(h.config.flight,true);
 assert.equal(h.template,'troop');
 assert.equal(h.health,HORNET.health);
 assert.equal(vehicleMuzzles(h).length,2);
 assert.equal(HORNET.mountedChaingun.barrels,2);
});
test('flight lifts off, respects the ceiling and descends on command',()=>{
 const v=createVehicle(HORNET);v.position={x:0,y:1.6,z:0};
 for(let i=0;i<360;i++)stepVehicle(v,{lift:1},1/60,collide,floor);
 assert.ok(v.position.y>20,`climbed to ${v.position.y}`);
 assert.ok(v.position.y<=HORNET.maxAltitude+1e-6,`ceiling ${v.position.y}`);
 assert.ok(v.grounded===false);
 const peak=v.position.y;
 for(let i=0;i<720;i++)stepVehicle(v,{lift:-1},1/60,collide,floor);
 assert.ok(v.position.y<peak-5,`descended to ${v.position.y}`);
});
test('flight hovers when neutral and boost raises top speed',()=>{
 const v=createVehicle(HORNET);v.position={x:0,y:20,z:0};v.vy=0;
 for(let i=0;i<180;i++)stepVehicle(v,{},1/60,collide,floor);
 assert.ok(Math.abs(v.position.y-20)<1.5,`hover drift ${v.position.y}`);
 assert.ok(Math.abs(v.vy)<1,`hover vy ${v.vy}`);
 let maxSpeed=0;
 for(let i=0;i<180;i++){stepVehicle(v,{throttle:1,boost:true},1/60,collide,floor);maxSpeed=Math.max(maxSpeed,Math.hypot(v.velocity.x,v.velocity.z));}
 assert.ok(maxSpeed>HORNET.speed+2,`boosted to ${maxSpeed}`);
});
test('a mounted Hornet climbs with the jump input and reports flight altitude',()=>{
 const m=new Match('chatgpt','openclaw',()=>.37,'skyfall-basin',{mode:'combined-arms',botCount:0});
 const hornet=m.vehicles.find(v=>v.kind==='hornet'),a=m.actors[0];
 Object.assign(a,{x:hornet.spawn.x,z:hornet.spawn.z,y:0,vx:0,vy:0,vz:0,grounded:true,vehicleId:null,traversalCooldown:9});
 assert.equal(m.enterVehicle(a),true);
 for(let i=0;i<150;i++)m.step(1/60,{inputs:{0:{jump:true}}});
 const snap=m.snapshot().vehicles.find(v=>v.id===hornet.id);
 assert.equal(snap.flight,true);
 assert.ok(snap.altitude>5,`altitude ${snap.altitude}`);
 assert.ok(Number.isFinite(snap.vy));
 assert.equal(a.vehicleId,hornet.id);
});
test('bailing out of a moving Hornet applies the flight-speed dismount stun', () => {
 const m=new Match('chatgpt','openclaw',()=>.37,'skyfall-basin',{mode:'combined-arms',botCount:0});
 const hornet=m.vehicles.find(v=>v.kind==='hornet'),a=m.actors[0];
 Object.assign(a,{x:hornet.spawn.x,z:hornet.spawn.z,y:0,vx:0,vy:0,vz:0,grounded:true,vehicleId:null,traversalCooldown:9,slow:0,slowMultiplier:.55});
 assert.equal(m.enterVehicle(a),true);
 hornet.velocity={x:8,z:0};hornet.vy=8;
 assert.equal(m.releaseVehicle(a,hornet),true);
 assert.ok(a.slow>=.6&&a.slow<=1.2,`flight dismount stun ${a.slow}`);
 assert.equal(a.slowMultiplier,.55);
 assert.equal(a.vehicleId,null);
 hornet.velocity={x:0,z:0};hornet.vy=0;
 a.slow=0;a.slowMultiplier=.55;
 assert.equal(m.enterVehicle(a),true);
 assert.equal(m.releaseVehicle(a,hornet),true);
 assert.equal(a.slow,0,'a hovering bail-out never stuns');
});
