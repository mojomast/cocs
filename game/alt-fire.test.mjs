// Alt-fire tests (game/alt-fire.mjs + Match.altFire in core.mjs).
//
// The table is frozen data: every WEAPONS index must resolve to one spec, and
// every spec must be internally valid. The behaviour tests drive the public
// Match surface (`altFire`, `step`, events, snapshot) and use a seedless arena
// (no blocks, huge bounds, floor at 0) so distances and impacts are exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {createVehicle} from './vehicles.mjs';
import {harnessWeaponHandling} from './harness-profiles.mjs';
import {ALT_FIRE,altSpecFor,hasAltFire,altModeLabel} from './alt-fire.mjs';
import {WEAPONS} from './data.mjs';

const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-9,`${message??''} ${actual} != ${expected}`);

// A deterministic, spread-free match (random()=.5 zeroes every spread draw) with
// a bare arena so alt shots hit exactly where the math says they should.
const fresh=(options={})=>{
 const m=new Match('chatgpt','openclaw',()=>.5,'exchange',{botCount:0,humanCount:2,...options});
 m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};
 m.pickups=[];m.vehicles=[];m.rockets=[];
 m.actors.forEach((a,i)=>Object.assign(a,{x:i*50,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,health:500,maxHealth:500,armor:0,protection:0,shotWait:0,reloading:false,weaponSwitch:0,alt:false}));
 return m;
};
const altShots=m=>m.events.filter(e=>e.type==='shot'&&e.alt===true);
const ammo=(a,index,count)=>Object.assign(a,{weapon:index,ammo:Array.from({length:WEAPONS.length},(_,i)=>i===index?count:0),shotWait:0});

test('alt table covers every weapon index and every spec is frozen and valid',()=>{
 assert.equal(ALT_FIRE.length,WEAPONS.length,'one alt mode per weapon');
 assert.deepEqual(ALT_FIRE.map(spec=>spec.id),['salvo','cluster','overload','slug','mortar','mine','chain','bomb','double','twin']);
 assert.equal(Object.isFrozen(ALT_FIRE),true);
 const ids=new Set();
 for(let i=0;i<WEAPONS.length;i++){
  const spec=altSpecFor(i);
  assert.ok(spec,`weapon ${i} has an alt spec`);
  assert.equal(Object.isFrozen(spec),true,`spec ${i} is frozen`);
  assert.equal(spec.index,i);
  assert.equal(hasAltFire(i),true);
  assert.equal(altModeLabel(i),spec.label);
  assert.ok(`${spec.id}`.length&&spec.label&&spec.summary&&spec.appearance&&spec.tracer&&spec.sound,`spec ${i} carries identity fields`);
  assert.ok(!ids.has(spec.id),'spec ids are unique');ids.add(spec.id);
  assert.ok(['hitscan','projectile'].includes(spec.kind));
  assert.ok(Number.isFinite(spec.interval)&&spec.interval>0,'interval is a positive fuse');
  assert.ok(Number.isInteger(spec.cost)&&spec.cost>=1,'cost is a whole number of rounds');
  assert.ok(spec.damage>=0&&spec.shots>=1&&spec.spread>=0&&spec.kick>=0);
  if(spec.kind==='projectile')assert.ok(spec.speed>0,`spec ${spec.id} travels`);
  if(spec.mine)assert.ok(spec.arm>0&&spec.triggerRadius>0&&spec.maxMines>0);
  if(spec.bomblets>0)assert.ok(spec.bombletRadius>0&&spec.bombletSplash>0&&spec.bombletDamage>0);
  if(spec.flak>0)assert.ok(spec.flakSpread>0&&spec.flakDamage>0);
 }
 assert.equal(ids.size,WEAPONS.length);
 assert.equal(altSpecFor(-1),null,'no spec below zero');
 assert.equal(altSpecFor(WEAPONS.length),null,'no spec past the table');
 assert.equal(altModeLabel(99),'');
 // The behaviour fields land on the weapons the HUD copy claims.
 assert.equal(altSpecFor(1).bomblets,3);
 assert.equal(altSpecFor(5).mine,true);
 assert.equal(altSpecFor(5).maxMines,2);
 assert.equal(altSpecFor(7).flak,8);
 assert.equal(altSpecFor(9).cost,2);
});

test('alt and primary share one trigger cadence and cannot fire twice in a step',()=>{
 const m=fresh(),a=m.actors[0];
 ammo(a,0,10);a.shotWait=0;
 const before=m.stats.shots;
 m.step(1/60,{inputs:{0:{fire:true,altFire:true}}});
 assert.equal(m.stats.shots-before,1,'exactly one trigger resolved');
 assert.equal(altShots(m).length,0,'the primary trigger won the shared wait');
 assert.ok(a.shotWait>0,'the wait is armed for the next trigger');
 // The other order: alt first locks the primary out.
 const m2=fresh(),b=m2.actors[0];
 ammo(b,9,6);b.shotWait=0;
 assert.equal(m2.altFire(b),true);
 assert.equal(m2.fire(b),false,'primary cannot fire during the alt wait');
 assert.equal(b.ammo[9],4,'twin spent its two rounds');
});

test('salvo fires three pellets from one round of ammo',()=>{
 const m=fresh(),a=m.actors[0];
 ammo(a,0,10);
 assert.equal(m.altFire(a),true);
 const shots=altShots(m);
 assert.equal(shots.length,3);
 assert.deepEqual(shots.map(shot=>shot.pellet),[0,1,2]);
 assert.ok(shots.every(shot=>shot.weapon===0&&shot.altId==='salvo'&&shot.alt===true));
 assert.equal(a.ammo[0],9,'one trigger spends one round');
 assert.ok(shots.every(shot=>Number.isFinite(shot.falloff)&&shot.falloff>=0));
});

test('alt hitscan respects wall cover and the shared raycast',()=>{
 const m=fresh({humanCount:2}),[a,target]=m.actors;
 ammo(a,2,5);a.protection=0;
 Object.assign(target,{x:0,y:0,z:-8,protection:0});
 m.arena.blocks=[{x:0,z:-4,w:8,d:1,h:8}];
 assert.equal(m.altFire(a),true);
 assert.equal(target.health,500,'a wall between the two actors blocks the beam');
 m.arena.blocks=[];a.shotWait=0;
 assert.equal(m.altFire(a),true);
 assert.ok(target.health<500,'the same shot connects once the cover is gone');
});

test('overload pierces a lined-up second target',()=>{
 const m=fresh({humanCount:3}),[a,first,second]=m.actors;
 ammo(a,2,5);a.protection=0;
 Object.assign(first,{x:0,y:0,z:-5,protection:0});
 Object.assign(second,{x:0,y:0,z:-10,protection:0});
 assert.equal(m.altFire(a),true);
 close(first.health,500-68,'first target takes the beam');
 close(second.health,500-51,'second target takes the frozen 0.75 pierce step');
 assert.equal(a.ammo[2],4);
});

test('slug uses its own falloff override instead of the primary curve',()=>{
 const m=fresh({humanCount:2}),[a,target]=m.actors;
 ammo(a,3,5);a.protection=0;
 Object.assign(target,{x:0,y:0,z:-20,protection:0});
 assert.equal(m.altFire(a),true);
 const shot=altShots(m).at(-1);
 assert.equal(shot.altId,'slug');
 close(shot.falloff,1,'the slug holds full damage inside its own 30 m start');
 const handling=harnessWeaponHandling(a.harness,3)||{},affinity=handling.favored?handling.damage:1;
 close(target.health,500-38*affinity,'the slug damage lands at 20 m');
 // Scattergun's own falloff at 20 m is ~.533: the spec override really won.
 const primaryFactor=1+(.4-1)*((20-6)/(24-6));
 assert.ok(Math.abs(primaryFactor-1)>.2,'the primary curve would already have fallen off');
});

test('cluster impacts into three deterministic bomblet blasts and carries the projectile id',()=>{
 const m=fresh({humanCount:2}),[a,target]=m.actors;
 ammo(a,1,5);a.protection=0;
 Object.assign(target,{x:0,y:0,z:-6,protection:0});
 assert.equal(m.altFire(a),true);
 const rocket=m.rockets.find(r=>r.alt===true);
 assert.ok(rocket,'alt rocket is in flight');
 assert.equal(rocket.bomblets,3);
 assert.equal(rocket.mine,false);
 const launch=m.events.find(e=>e.type==='launch'&&e.altId==='cluster');
 assert.equal(launch.alt,true);
 assert.equal(launch.id,rocket.id,'the launch event keys the projectile');
 assert.equal(launch.projectile,rocket.id,'the presentation alias keys the same projectile');
 assert.equal(launch.bomblets,3);
 for(let i=0;i<120&&m.rockets.length;i++)m.step(1/60);
 assert.equal(m.rockets.length,0,'cluster rocket resolved');
 const bomblets=m.events.filter(e=>e.type==='explosion'&&e.bomblet!==undefined);
 assert.equal(bomblets.length,3,'three bomblet blasts');
 assert.deepEqual(bomblets.map(e=>e.bomblet),[0,1,2]);
 assert.ok(bomblets.every(e=>e.alt===true&&e.altId==='cluster'));
 assert.ok(target.health<500,'the cluster damage landed');
});

test('mortar arcs under its own gravity',()=>{
 const m=fresh(),a=m.actors[0];
 ammo(a,4,5);a.protection=0;
 assert.equal(m.altFire(a),true);
 const rocket=m.rockets[0];
 close(rocket.gravity,.45,'the spec gravity rides the projectile');
 const startY=rocket.pos.y;
 for(let i=0;i<10;i++)m.step(1/60);
 assert.equal(m.rockets.length,1,'still in flight');
 assert.ok(rocket.pos.y<startY,'loses altitude');
 assert.ok(rocket.vy<0,'gains downward velocity');
});

test('proximity mines place, arm, trigger, cap at two and expire',()=>{
 const m=fresh({humanCount:3}),[a,enemy]=m.actors;
 ammo(a,5,5);a.protection=0;
 Object.assign(enemy,{x:400,y:0,z:400});
 assert.equal(m.altFire(a),true);
 const mine=m.rockets.find(r=>r.altId==='mine');
 assert.ok(mine,'mine in flight');
 assert.equal(mine.triggerRadius,2.6);
 for(let i=0;i<90&&mine.stuck!==true;i++)m.step(1/60);
 assert.equal(mine.stuck,true,'mine sticks on floor contact');
 assert.equal(mine.vy,0);
 assert.deepEqual(mine.dir,{x:0,y:0,z:0});
 assert.equal(mine.armed,false,'a fresh mine is not armed yet');
 const landing={...mine.pos};
 Object.assign(enemy,{x:landing.x,y:landing.y,z:landing.z});
 for(let i=0;i<10;i++)m.step(1/60);
 assert.ok(m.rockets.includes(mine),'an unarmed mine ignores proximity');
 for(let i=0;i<40&&m.rockets.includes(mine);i++)m.step(1/60);
 assert.ok(!m.rockets.includes(mine),'the armed mine detonates on proximity');
 assert.ok(enemy.health<500,'the trigger takes the blast');
 // Cap: a third mine detonates the oldest, never the newest.
 const m2=fresh(),b=m2.actors[0];
 ammo(b,5,9);b.protection=0;
 const place=()=>{b.shotWait=0;assert.equal(m2.altFire(b),true);const planted=m2.rockets.filter(r=>r.mine===true).at(-1);for(let i=0;i<90&&planted.stuck!==true;i++)m2.step(1/60);return planted;};
 const first=place(),second=place();
 assert.equal(m2.rockets.filter(r=>r.mine===true).length,2);
 const third=place(),planted=m2.rockets.filter(r=>r.mine===true);
 assert.equal(planted.length,2,'maxMines caps the deployed count');
 assert.deepEqual(planted.map(r=>r.id),[second.id,third.id],'the oldest mine detonates early');
 assert.ok(!m2.rockets.includes(first));
 // Expiry: a planted mine with nobody nearby detonates on its fuse.
 const last=place();
 const expirySteps=Math.ceil((last.life+.5)*60);
 for(let i=0;i<expirySteps;i++)m2.step(1/60);
 assert.ok(!m2.rockets.includes(last),'the life fuse always resolves a mine');
});

test('chain arcs to exactly three nearby enemies',()=>{
 const m=fresh({humanCount:6}),[a,first,...rest]=m.actors;
 ammo(a,6,5);a.protection=0;
 Object.assign(first,{x:0,y:0,z:-5,protection:0});
 rest.forEach((b,i)=>Object.assign(b,{x:(i-1)*2,y:0,z:-9,protection:0}));
 assert.equal(m.altFire(a),true);
 assert.ok(first.health<500,'the beam lands');
 const chained=rest.filter(b=>b.health<500);
 assert.equal(chained.length,3,'three arcs');
 assert.deepEqual(chained.map(b=>b.id),[2,3,4]);
 assert.equal(rest[3].health,500,'the fourth enemy is outside the arc budget');
 close(chained[0].health,500-32*.55);
});

test('flak bursts shrapnel in a forward cone and hits each actor once',()=>{
 const m=fresh({humanCount:3}),[a,enemy,far]=m.actors;
 ammo(a,7,5);a.protection=0;
 // The shell lands on the floor ahead; the enemy stands just beyond it in the
 // forward cone, out of the flight path so only shrapnel can reach it.
 Object.assign(enemy,{x:.5,y:0,z:-8.5,protection:0});
 Object.assign(far,{x:200,y:0,z:200});
 assert.equal(m.altFire(a),true);
 for(let i=0;i<90&&m.rockets.length;i++)m.step(1/60);
 assert.equal(m.rockets.length,0);
 const shrapnel=m.events.filter(e=>e.type==='shot'&&e.shrapnel!==undefined);
 assert.equal(shrapnel.length,8,'one ray per fragment');
 assert.ok(shrapnel.every(e=>e.alt===true&&e.altId==='bomb'&&e.weapon===7));
 assert.ok(shrapnel.some(e=>e.hit===enemy.id),'the cone catches the actor beside the impact');
 // Splash lands before the explosion event; shrapnel damage lands after it.
 const explosionAt=m.events.findIndex(e=>e.type==='explosion'&&e.altId==='bomb');
 assert.ok(explosionAt>=0);
 const shrapnelDamage=m.events.slice(explosionAt+1).filter(e=>e.type==='damage'&&e.actor===enemy.id);
 assert.equal(shrapnelDamage.length,1,'each unique actor takes shrapnel once');
 assert.ok(enemy.health<500);
});

test('double tap fires two pellets and twin spends two rounds',()=>{
 const m=fresh(),a=m.actors[0];
 ammo(a,8,4);a.protection=0;
 assert.equal(m.altFire(a),true);
 assert.equal(altShots(m).filter(s=>s.altId==='double').length,2);
 assert.equal(a.ammo[8],3,'double tap costs one round');
 ammo(a,9,4);
 assert.equal(m.altFire(a),true);
 assert.equal(altShots(m).filter(s=>s.altId==='twin').length,2);
 assert.equal(a.ammo[9],2,'twin costs two rounds');
 a.shotWait=0;a.ammo[9]=1;
 assert.equal(m.altFire(a),false,'a short twin cannot fire');
 assert.equal(a.reloading,true,'a short twin triggers the primary reload path');
 assert.equal(a.ammo[9],1,'the short magazine was not charged');
});

test('guards mirror primary fire and a stale trigger never fires',()=>{
 const m=fresh(),a=m.actors[0];
 ammo(a,0,4);a.protection=0;
 assert.equal(m.altFire(a),true);
 a.shotWait=.3;assert.equal(m.altFire(a),false,'shotWait guard');
 a.shotWait=0;a.reloading=true;assert.equal(m.altFire(a),false,'reloading guard');
 a.reloading=false;a.weaponSwitch=.2;assert.equal(m.altFire(a),false,'weapon switch guard');
 a.weaponSwitch=0;a.health=0;assert.equal(m.altFire(a),false,'dead guard');
 a.health=a.maxHealth;m.over=true;assert.equal(m.altFire(a),false,'match over guard');
 m.over=false;
 a.weapon=1;a.ammo[1]=0;a.shotWait=0;
 assert.equal(m.altFire(a),false,'empty magazine');
 assert.equal(a.reloading,true,'empty magazine reuses the reload path');
 assert.equal(a.ammo[1],0);
});

test('alt-state emits once per flip and the snapshot carries the held flag',()=>{
 const m=fresh(),a=m.actors[0];
 ammo(a,0,Infinity);
 m.step(1/60,{inputs:{0:{altFire:true}}});
 assert.equal(a.alt,true);
 let events=m.events.filter(e=>e.type==='alt-state');
 assert.equal(events.length,1,'one event on the flip up');
 assert.equal(events[0].actor,0);
 assert.equal(events[0].alt,true);
 assert.equal(events[0].weapon,0);
 assert.ok(Number.isFinite(events[0].pos.x)&&Number.isFinite(events[0].pos.y)&&Number.isFinite(events[0].pos.z),'the flip carries a position for remote audio');
 assert.equal(m.snapshot().actors.find(x=>x.id===0).alt,true);
 m.step(1/60,{inputs:{0:{altFire:true}}});
 assert.equal(m.events.filter(e=>e.type==='alt-state').length,1,'a held trigger does not re-emit');
 m.step(1/60,{inputs:{0:{altFire:false}}});
 events=m.events.filter(e=>e.type==='alt-state');
 assert.equal(events.length,2,'one event on the flip down');
 assert.equal(events.at(-1).alt,false);
 assert.equal(a.alt,false);
 assert.equal(m.snapshot().actors.find(x=>x.id===0).alt,false);
});

test('two matches with the same seed, inputs and alt trigger stay identical',()=>{
 const seeded=()=>{let n=987654321;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
 const run=()=>{
  const m=new Match('chatgpt','openclaw',seeded(),'exchange',{botCount:0,humanCount:3});
  m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};
  m.pickups=[];m.vehicles=[];m.rockets=[];
  m.actors.forEach((a,i)=>Object.assign(a,{x:i*30,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,health:500,maxHealth:500,armor:0,protection:0,shotWait:0,reloading:false,weaponSwitch:0,alt:false}));
  Object.assign(m.actors[1],{x:0,y:0,z:-8});
  Object.assign(m.actors[2],{x:0,y:0,z:-14});
  ammoIn(m.actors[0],0,20);
  for(let i=0;i<300;i++)m.step(1/60,{inputs:{0:{altFire:true,yaw:.3,pitch:.04}}});
  return m;
 };
 const first=run(),second=run();
 assert.ok(first.stats.shots>=8,`the run really fired alt (${first.stats.shots})`);
 assert.equal(first.stats.shots,second.stats.shots);
 assert.equal(first.rockets.length,second.rockets.length);
 for(let i=0;i<first.actors.length;i++){
  const x=first.actors[i],y=second.actors[i];
  assert.equal(x.health,y.health,`actor ${i} health`);
  assert.equal(x.alt,y.alt);
  assert.ok(Math.abs(x.x-y.x)<1e-12,`actor ${i} x`);
  assert.ok(Math.abs(x.y-y.y)<1e-12,`actor ${i} y`);
  assert.ok(Math.abs(x.z-y.z)<1e-12,`actor ${i} z`);
  assert.ok(Math.abs(x.vx-y.vx)<1e-12,`actor ${i} vx`);
  assert.ok(Math.abs(x.vz-y.vz)<1e-12,`actor ${i} vz`);
 }
 function ammoIn(actor,index,count){Object.assign(actor,{weapon:index,ammo:Array.from({length:WEAPONS.length},(_,i)=>i===index?count:0)});}
});

test('alt projectiles reuse the primary swept-hit path and can strike vehicles',()=>{
 const m=fresh({humanCount:2}),[a]=m.actors;
 ammo(a,1,3);a.protection=0;
 const vehicle=createVehicle('puma');
 vehicle.position.x=0;vehicle.position.y=0;vehicle.position.z=-6;
 m.vehicles=[vehicle];
 const before=vehicle.health;
 assert.equal(m.altFire(a),true);
 for(let i=0;i<60&&m.rockets.length;i++)m.step(1/60);
 assert.ok(vehicle.health<before,'the cluster rocket damages the vehicle body');
});
