import assert from 'node:assert/strict';
import test from 'node:test';
import {Match, floorAt, obstructed} from './core.mjs';
import {GUNTRUCK, PUMA, TITAN, SCOUT, TRANSPORT, VEHICLE_DISMOUNT, VEHICLE_WEAKPOINT, createVehicle, vehicleConfig, vehicleSeatFor, takeVehicleSeat} from './vehicles.mjs';

const match=()=>new Match('chatgpt','openclaw',()=>.5,'blood-gulch',{mode:'ctf',botCount:0,respawn:1});

test('Blood Gulch matches clone supported polygon terrain and both Pumas',()=>{
  const a=match(),b=match();
  assert.equal(a.vehicles.length,2);
  assert.notEqual(a.vehicles,b.vehicles);
  assert.ok(floorAt(0,0,a.arena)>5&&floorAt(0,0,a.arena)<8);
  assert.ok(floorAt(0,-19,a.arena)>1&&floorAt(0,-19,a.arena)<1.5);
  assert.equal(a.vehicles[0].position.y,0);
  a.vehicles[0].position.x=-20;
  assert.equal(b.vehicles[0].position.x,-46);
  assert.equal(b.vehicles[1].position.x,46);
});

test('Puma enter, drive, paired chainguns, turret tracking and exit remain authoritative',()=>{
  const m=match(),a=m.actors[0];
  Object.assign(a,{x:-46,y:0,z:0,yaw:Math.PI/2,pitch:0,grounded:true,protection:0});
  m.step(1/60,{inputs:{0:{interact:true}}});
  assert.equal(a.vehicleId,m.vehicles[0].id);
  for(let i=0;i<60;i++)m.step(1/60,{inputs:{0:{x:1,z:0,yaw:-Math.PI/2,pitch:0,fire:true}}});
  assert.ok(a.x>-42);
  assert.ok(m.vehicles[0].heat>0&&m.vehicles[0].heat<1,'a one-second chaingun burst builds heat without locking out');
  assert.equal(m.vehicles[0].overheated,false);
  const shots=m.events.filter(e=>e.type==='vehicle-shot').length;
  assert.ok(shots>=38&&shots<=48,`rapid chaingun fire produced ${shots} barrel shots`);
  assert.equal(shots%2,0,'both barrels fire per cycle');
  assert.ok(m.vehicles[0].turretYaw>=-1e-9&&m.vehicles[0].turretYaw<=1e-9);
  const snapshot=m.snapshot().vehicles[0];
  assert.ok(Number.isFinite(snapshot.turretYaw)&&Number.isFinite(snapshot.roll)&&Number.isFinite(snapshot.pitchBody));
  m.step(1/60,{inputs:{0:{interact:true}}});
  assert.equal(a.vehicleId,null);
  assert.equal(m.vehicles[0].driver,null);
});

test('Puma chainguns resolve an actor hit through the authoritative ray path',()=>{
  const m=new Match('chatgpt','openclaw',()=>.5,'blood-gulch',{mode:'ctf',botCount:1});
  const [a,target]=m.actors;
  Object.assign(a,{x:-46,y:0,z:0,yaw:-Math.PI/2,pitch:0,grounded:true,protection:0});
  Object.assign(target,{x:-40,y:0,z:0.82,health:100,armor:0,protection:0,grounded:true});
  m.step(1/60,{inputs:{0:{interact:true}}});
  for(let i=0;i<12;i++)m.step(1/60,{inputs:{0:{x:0,z:0,yaw:-Math.PI/2,pitch:0,fire:true}}});
  assert.ok(target.health<100);
  assert.ok(m.events.some(event=>event.type==='vehicle-shot'&&event.hit===target.id));
});

test('a moving Puma runs over and splatters a grounded non-occupant',()=>{
  const m=new Match('chatgpt','openclaw',()=>.5,'blood-gulch',{mode:'deathmatch',botCount:1,respawn:5});
  const [a,target]=m.actors;
  Object.assign(a,{x:-46,y:0,z:0,yaw:Math.PI/2,pitch:0,grounded:true,protection:0});
  Object.assign(target,{x:-38,y:0,z:0,health:5000,armor:0,protection:0,grounded:true,bot:null});
  m.step(1/60,{inputs:{0:{interact:true}}});
  for(let i=0;i<120&&target.health>0;i++)m.step(1/60,{inputs:{0:{x:1,z:0,yaw:-Math.PI/2,pitch:0}}});
  assert.ok(target.health<5000);
  assert.ok(m.events.some(e=>e.type==='vehicle-splatter'&&e.actor===target.id));
});

test('Puma damage releases its driver and respawns from its authored slot',()=>{
  const m=match(),a=m.actors[0],vehicle=m.vehicles[0];
  Object.assign(a,{x:-46,y:0,z:0,yaw:Math.PI/2,pitch:0,grounded:true,protection:0});
  m.step(1/60,{inputs:{0:{interact:true}}});
  assert.equal(vehicle.driver,a.id);
  m.damageVehicle(vehicle,vehicle.maxHealth,a);
  assert.equal(vehicle.health,0);
  assert.equal(a.vehicleId,null);
  for(let i=0;i<Math.ceil(GUNTRUCK.respawn/(1/60))+1;i++)m.step(1/60);
  assert.equal(vehicle.health,vehicle.maxHealth);
  assert.deepEqual(vehicle.position,vehicle.spawn);
  assert.ok(m.events.some(e=>e.type==='vehicle-respawn'));
});

test('Pumas can leave both garages, cross either valley lane, and exit safely',()=>{
  for(const side of [-1,1])for(const lane of [-1,1]){
    const m=match(),a=m.actors[0],vehicle=m.vehicles[side<0?0:1];
    Object.assign(a,{x:side*46,y:0,z:0,grounded:true});
    assert.ok(m.enterVehicle(a));
    for(const [axis,target,direction] of [['z',lane*8,lane],['x',-side*20,-side],['z',0,-lane]]){
      vehicle.heading=axis==='x'?direction*Math.PI/2:direction>0?0:Math.PI;
      vehicle.velocity.x=vehicle.velocity.z=0;
      a.yaw=vehicle.heading-Math.PI;
      let frames=0;
      while(direction*(target-vehicle.position[axis])>.12&&frames++<600)m.driveVehicle(a,{[axis]:direction},1/60);
      assert.ok(frames<600,`route ${side}/${lane} stalled on ${axis}`);
    }
    assert.ok(Math.abs(vehicle.position.x+side*20)<.8,`route ${side}/${lane} crossing`);
    assert.ok(m.releaseVehicle(a));
    assert.equal(a.vehicleId,null);
    assert.equal(a.y,floorAt(a.x,a.z,m.arena));
    assert.ok(!obstructed(a.x,a.y,a.z,.52,m.arena));
  }
});
test('team modes keep friendly fire off against vehicles but let mounted guns kill armour',()=>{
  const m=new Match('chatgpt','openclaw',()=>.5,'blood-gulch',{mode:'ctf',botCount:0,humanCount:2,respawn:1}),[a,b]=m.actors,v=m.vehicles[0],enemy=m.vehicles[1];
  a.team=0;b.team=0;v.driver=a.id;enemy.driver=b.id;
  const before=v.health;
  assert.equal(m.damageVehicle(v,50,b),0,'friendly vehicle damage should be ignored');
  assert.equal(v.health,before);
  b.team=1;
  assert.ok(m.damageVehicle(v,50,b)>0,'enemy vehicle damage should apply');
  Object.assign(v,{position:{x:0,y:20,z:0},heading:0,velocity:{x:0,y:0,z:0},vy:0});
  Object.assign(enemy,{position:{x:0,y:20,z:-8},heading:0,velocity:{x:0,y:0,z:0},vy:0});
  Object.assign(a,{x:0,y:20,z:0,yaw:0,pitch:0,punchYaw:0,punchPitch:0});
  v.lastStep={fired:true,muzzles:[0]};
  const armour=enemy.health;
  m.fireVehicle(v,a,0,0);
  assert.ok(enemy.health<armour,`mounted chaingun should damage enemy armour (${armour} -> ${enemy.health})`);
});

test('a mounted gunner does not double the chaingun timer progression',()=>{
  const timers=(mount)=>{
    const m=new Match('chatgpt','openclaw',()=>.5,'blood-gulch',{mode:'ctf',botCount:0,humanCount:3,respawn:1});
    const v=m.vehicles[0],[driver,gunner]=m.actors;
    v.heat=.5;v.fireCooldown=5;v.overheated=false;v.overheatTimer=0;
    Object.assign(driver,{x:v.position.x,y:v.position.y,z:v.position.z,grounded:true,protection:0});
    Object.assign(gunner,{x:v.position.x,y:v.position.y,z:v.position.z,grounded:true,protection:0});
    if(mount==='driver'||mount==='driver+gunner')m.enterVehicle(driver);
    if(mount==='driver+gunner')m.enterVehicle(gunner);
    if(mount==='gunner'){takeVehicleSeat(v,gunner.id,'gunner',0);m.syncVehicleActor(gunner,v);}
    for(let i=0;i<60;i++)m.step(1/60);
    return {heat:v.heat,cooldown:v.fireCooldown};
  };
  const reference=timers('none');
  assert.ok(reference.cooldown>3.9&&reference.cooldown<4.01,`single progression should leave ~4s cooldown, got ${reference.cooldown}`);
  for(const mount of ['driver','driver+gunner','gunner']){
    const result=timers(mount);
    assert.ok(Math.abs(result.cooldown-reference.cooldown)<1e-9,`${mount} cooldown advanced twice (${result.cooldown} vs ${reference.cooldown})`);
    assert.ok(Math.abs(result.heat-reference.heat)<1e-9,`${mount} heat cooled twice (${result.heat} vs ${reference.heat})`);
  }
});

test('destroyed or respawning vehicles reject entry until they respawn',()=>{
  const m=match(),a=m.actors[0],v=m.vehicles[0];
  Object.assign(a,{x:v.position.x,y:v.position.y,z:v.position.z,grounded:true,protection:0});
  v.health=0;v.respawnTimer=1;
  assert.equal(vehicleSeatFor(v),null,'a wreck exposes no seats');
  assert.equal(m.enterVehicle(a),false);
  assert.equal(a.vehicleId,null);
  v.health=v.maxHealth;v.respawnTimer=0;
  assert.ok(vehicleSeatFor(v));
  assert.equal(m.enterVehicle(a),true);
});

test('direct vehicle hits read the attacker bearing while splash stays neutral',()=>{
  const m=new Match('chatgpt','openclaw',()=>.5,'blood-gulch',{mode:'deathmatch',botCount:1,respawn:1});
  const [attacker]=m.actors,v=m.vehicles[0];
  v.driver=null;v.position={x:0,y:0,z:0};v.heading=0;
  const hit=opts=>{v.health=v.maxHealth;return m.damageVehicle(v,100,attacker,opts);};
  const front=hit({from:{x:0,y:0,z:6}});
  const flank=hit({from:{x:6,y:0,z:0}});
  const rear=hit({from:{x:0,y:0,z:-6}});
  assert.ok(Math.abs(front-100)<1e-9,`front keeps the base (${front})`);
  assert.ok(Math.abs(flank-120)<1e-9,`flank pays 1.2x (${flank})`);
  assert.ok(Math.abs(rear-135)<1e-9,`rear pays 1.35x (${rear})`);
  // Splash call sites never pass a bearing: a rear-facing blast still pays base.
  v.health=v.maxHealth;
  m.detonate({x:0,y:0,z:0},8,100,attacker);
  assert.ok(Math.abs((v.maxHealth-v.health)-100)<1e-9,`splash stays neutral (${v.maxHealth-v.health})`);
});

test('team friendly-fire guards still ignore even a rear-bearing hit',()=>{
  const m=new Match('chatgpt','openclaw',()=>.5,'blood-gulch',{mode:'ctf',botCount:0,humanCount:2,respawn:1});
  const [a,b]=m.actors,v=m.vehicles[0];
  a.team=0;b.team=0;v.driver=a.id;
  const before=v.health;
  assert.equal(m.damageVehicle(v,50,b,{from:{x:0,y:0,z:-6},bearing:Math.PI}),0,'friendly rear shots stay ignored');
  assert.equal(v.health,before);
});

test('bailing out of a moving Puma stuns briefly, parked exits do not, and the window expires',()=>{
  const m=new Match('chatgpt','openclaw',()=>.5,'blood-gulch',{mode:'deathmatch',botCount:1,respawn:1});
  const [a,b]=m.actors,v=m.vehicles[0];
  Object.assign(a,{x:v.position.x,y:v.position.y,z:v.position.z,grounded:true,protection:0,slow:0,slowMultiplier:.55});
  assert.ok(m.enterVehicle(a));
  v.velocity.x=0;v.velocity.z=VEHICLE_DISMOUNT.maxSpeed;
  assert.ok(m.releaseVehicle(a,v,'exit'));
  assert.ok(a.slow>=VEHICLE_DISMOUNT.minDuration&&a.slow<=VEHICLE_DISMOUNT.maxDuration,`moving exit stun ${a.slow}`);
  assert.equal(a.slowMultiplier,VEHICLE_DISMOUNT.slowMultiplier);
  const stun=a.slow;
  for(let i=0;i<Math.ceil((stun+.2)*60);i++)m.step(1/60);
  assert.equal(a.slow,0,'the dismount stun expires');
  // A parked bail-out is free.
  const parked=m.vehicles[1];
  Object.assign(b,{x:parked.position.x,y:parked.position.y,z:parked.position.z,grounded:true,protection:0,slow:0});
  assert.ok(m.enterVehicle(b));
  parked.velocity.x=parked.velocity.z=0;
  m.releaseVehicle(b,parked,'exit');
  assert.equal(b.slow,0,'a parked exit never stuns');
  // The destroy path releases the crew before zeroing velocity, so a moving
  // wreck still stuns while a respawn release never does.
  parked.velocity.z=12;parked.driver=b.id;
  m.releaseVehicle(b,parked,'destroyed');
  assert.ok(b.slow>0,'a moving wreck stuns its crew');
  b.slow=0;
  m.releaseVehicle(b,parked,'respawn');
  assert.equal(b.slow,0,'respawn releases never stun');
});

test('every chassis fires its own mounted gun for the authored per-volley damage',()=>{
 const volley=(template)=>{
  const m=new Match('chatgpt','hermes',()=>.5,'blood-gulch',{mode:'deathmatch',botCount:0,respawn:1}),a=m.actors[0];
  const shooter=createVehicle(template),target=createVehicle(template);
  shooter.id=`shooter-${template.id}`;shooter.kind=template.id;target.id=`target-${template.id}`;target.kind=template.id;
  Object.assign(shooter.position,{x:0,y:20,z:0});Object.assign(target.position,{x:0,y:20,z:-30});
  shooter.heading=0;target.heading=0;target.velocity={x:0,z:0};target.health=target.maxHealth;
  shooter.lastStep={fired:true,muzzles:Array.from({length:shooter.barrelCount},(_,i)=>i)};
  m.vehicles=[shooter,target];
  const before=target.health;
  m.fireVehicle(shooter,a,0,0);
  return {gun:vehicleConfig(shooter).mountedChaingun,dealt:before-target.health,shots:m.events.filter(event=>event.type==='vehicle-shot').length};
 };
 for(const template of [PUMA,TITAN,SCOUT,TRANSPORT]){
  const {gun,dealt,shots}=volley(template);
  assert.equal(shots,gun.barrels,`${template.id} fires every authored barrel per volley`);
  assert.ok(Math.abs(dealt-gun.damage)<1e-9,`${template.id} volley deals ${gun.damage} hull damage (dealt ${dealt})`);
 }
});

test('the oriented chassis hitbox resolves side-on fire and reports the struck face',()=>{
 const m=new Match('chatgpt','claudecode',()=>.5,'blood-gulch',{mode:'deathmatch',botCount:0,humanCount:1,respawn:1});
 const a=m.actors[0],v=m.vehicles[0];
 v.driver=null;v.health=v.maxHealth;v.velocity={x:0,z:0};v.position={x:0,y:20,z:0};v.heading=Math.PI/2;
 a.weapon=0;a.ammo[0]=Infinity;a.shotWait=0;a.spread=0;a.punchYaw=0;a.punchPitch=0;a.reloading=false;a.weaponSwitch=0;a.protection=0;
 const shoot=(from,to)=>{
  Object.assign(a,{x:from.x,z:from.z,y:v.position.y,grounded:true});
  a.yaw=Math.atan2(-(to.x-a.x),-(to.z-a.z));a.pitch=0;a.shotWait=0;a.punchYaw=0;a.punchPitch=0;a.spread=0;
  v.health=v.maxHealth;
  assert.ok(m.fire(a),'the aimed shot fires');
  return v.maxHealth-v.health;
 };
 const side=shoot({x:1.5,z:5},{x:1.5,z:0});
 const front=shoot({x:5,z:0},{x:0,z:0});
 assert.ok(front>=11-1e-9,`the nose takes the base hit (${front})`);
 // The side line at x=1.5 only exists once the ray is rotated into the
 // chassis frame (world-axis width was 2.1/2 = 1.05); it pays the flank 1.2x.
 assert.ok(Math.abs(side-front*VEHICLE_WEAKPOINT.flank)<1e-6,`the flank pays ${VEHICLE_WEAKPOINT.flank}x (${side} vs ${front})`);
 const rear=shoot({x:-6,z:0},{x:0,z:0});
 assert.ok(Math.abs(rear-front*VEHICLE_WEAKPOINT.rear)<1e-6,`the rear pays ${VEHICLE_WEAKPOINT.rear}x (${rear} vs ${front})`);
 const events=m.events.filter(event=>event.type==='shot'&&event.hit===v.id);
 assert.ok(events.length>=3,'all three aimed shots connected with the chassis');
 assert.ok(m.events.some(event=>event.type==='vehicle-damage'&&Math.abs(event.amount-rear)<1e-9),'the struck face pays through damageVehicle');
});

test('driver field repair applies the authored harness/class rates with a throttled heartbeat',()=>{
 const drive=(character,harness)=>{
  const m=new Match(character,harness,()=>.5,'blood-gulch',{mode:'ctf',botCount:0,respawn:1});
  const a=m.actors[0],v=m.vehicles[0];
  Object.assign(a,{x:v.position.x,y:v.position.y,z:v.position.z,grounded:true,protection:0});
  m.step(1/60,{inputs:{0:{interact:true}}});
  assert.equal(a.vehicleSeat,'driver');
  v.health=v.maxHealth/2;
  return {m,a,v};
 };
 const codex=drive('chatgpt','codex');
 const half=codex.v.maxHealth/2;
 for(let i=0;i<30;i++)codex.m.step(1/60,{inputs:{0:{}}});
 assert.ok(Math.abs(codex.v.health-(half+6))<1e-9,`codex repairs 12/s (${codex.v.health})`);
 const heartbeats=codex.m.events.filter(event=>event.type==='vehicle-repair');
 assert.equal(heartbeats.length,1,'0.5 s of repair emits one heartbeat');
 const beat=heartbeats[0];
 assert.equal(beat.vehicleId,codex.v.id);assert.equal(beat.kind,'puma');
 assert.ok(Number.isFinite(beat.x)&&Number.isFinite(beat.z)&&beat.amount>0);
 const qwen=drive('qwen','hermes');
 const qhalf=qwen.v.maxHealth/2;
 for(let i=0;i<30;i++)qwen.m.step(1/60,{inputs:{0:{}}});
 assert.ok(Math.abs(qwen.v.health-(qhalf+2))<1e-9,`tool use repairs 4/s (${qwen.v.health})`);
 // Guards: a full chassis, a parked empty seat and a wreck never repair.
 codex.v.health=codex.v.maxHealth;
 for(let i=0;i<30;i++)codex.m.step(1/60,{inputs:{0:{}}});
 assert.equal(codex.v.health,codex.v.maxHealth,'a full chassis never over-heals');
 codex.m.releaseVehicle(codex.a);
 codex.v.health=codex.v.health-40;
 const empty=codex.v.health;
 for(let i=0;i<30;i++)codex.m.step(1/60,{inputs:{0:{}}});
 assert.equal(codex.v.health,empty,'an empty seat never repairs');
 codex.v.driver=codex.a.id;codex.a.vehicleId=codex.v.id;codex.a.vehicleSeat='driver';
 codex.v.health=0;codex.v.respawnTimer=codex.v.config.respawn;
 for(let i=0;i<30;i++)codex.m.step(1/60,{inputs:{0:{}}});
 assert.equal(codex.v.health,0,'a respawning wreck never repairs');
});

test('a destroyed chassis respawns on its authored yaw and announces the respawn',()=>{
 const m=match(),a=m.actors[0],v=m.vehicles[0];
 assert.ok(Math.abs(v.spawnYaw-Math.PI/2)<1e-9,`spawn yaw stored (${v.spawnYaw})`);
 Object.assign(a,{x:v.position.x,y:v.position.y,z:v.position.z,grounded:true,protection:0});
 m.enterVehicle(a);
 v.heading=-2.1;
 m.damageVehicle(v,v.maxHealth+1,a);
 assert.equal(v.health,0);
 for(let i=0;i<Math.ceil(v.config.respawn/(1/60))+2;i++)m.step(1/60,{inputs:{}});
 assert.ok(Math.abs(v.heading-Math.PI/2)<1e-9,`respawn restores the authored yaw (${v.heading})`);
 const event=m.events.find(candidate=>candidate.type==='vehicle-respawn');
 assert.equal(event.vehicleId,v.id);
 assert.equal(event.kind,'puma');
 assert.ok(Number.isFinite(event.x)&&Number.isFinite(event.z));
});
