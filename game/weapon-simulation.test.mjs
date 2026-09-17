import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,eye} from './core.mjs';
import {RULES,WEAPONS} from './data.mjs';
import {createVehicle} from './vehicles.mjs';

const fresh=(mode='deathmatch')=>{
 const m=new Match('chatgpt','openclaw',()=>.5,'exchange',{mode,botCount:0,humanCount:3});
 m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};m.pickups=[];m.vehicles=[];
 m.actors.forEach((a,i)=>Object.assign(a,{x:100+i*10,y:0,z:100,health:100,armor:0,protection:0}));
 return m;
};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('projectile free flight travels at weapon speed independent of step frequency',()=>{
 for(const weapon of [1,4,5])for(const hz of [30,60,120]){
  const m=fresh(),w=WEAPONS[weapon],r={owner:0,weapon,pos:{x:0,y:100,z:0},dir:{x:.6,y:0,z:.8},vy:0,life:4,bounces:0};
  m.rockets=[r];
  for(let i=0;i<hz;i++)m.step(1/hz);
  assert.equal(m.rockets.length,1);close(r.pos.x,w.speed*.6);close(r.pos.z,w.speed*.8);
  close(r.pos.y,100-RULES.gravity*(w.gravity||0)*(hz+1)/(2*hz));
 }
});

test('swept wall impacts keep clearance and cannot tunnel',()=>{
 const m=fresh();m.arena.blocks=[{x:2,z:0,w:.1,d:10,h:10}];
 m.rockets=[{owner:0,weapon:1,pos:{x:0,y:2,z:0},dir:{x:1,y:0,z:0},life:4,bounces:0}];
 m.step(.2);assert.equal(m.rockets.length,0);
 close(m.events.findLast(e=>e.type==='explosion').pos.x,1.95-.025);
});

test('team splash damages and boosts shooter and enemies, never teammates',()=>{
 for(const mode of ['teamdeathmatch','ctf','koth','domination']){
  const m=fresh(mode),[shooter,enemy,teammate]=m.actors;
  m.actors.forEach(a=>Object.assign(a,{x:0,z:0}));
  m.explode({owner:shooter.id,weapon:1,pos:eye(shooter)},null);
  close(shooter.health,40);close(enemy.health,40);close(teammate.health,100);
  close(shooter.vy,4);close(enemy.vy,4);close(teammate.vy,0);
  assert.deepEqual(m.events.filter(e=>e.type==='damage').map(e=>e.actor),[shooter.id,enemy.id]);
 }
});

test('self splash uses normal protection, armor and suicide scoring',()=>{
  const m=fresh('teamdeathmatch'),a=m.actors[0],r={owner:a.id,weapon:1,pos:eye(a)};
  a.protection=1;m.explode(r,null);close(a.health,100);
  a.protection=0;a.armor=50;m.explode(r,null);close(a.health,76);close(a.armor,14);
  a.health=1;a.armor=0;m.explode(r,null);
  assert.equal(a.deaths,1);assert.equal(a.frags,-1);assert.deepEqual(m.teamScores,{0:0,1:0});
});

test('rockets strike vehicle bodies instead of passing through them',()=>{
  const m=fresh(),vehicle=createVehicle('puma',{x:0,y:0,z:0,heading:0});
  m.vehicles=[vehicle];
  m.rockets=[{owner:0,weapon:1,pos:{x:-5,y:1,z:0},dir:{x:1,y:0,z:0},vy:0,life:4,bounces:0}];
  const before=vehicle.health;
  m.step(.5);
  assert.ok(vehicle.health<before,`rocket should damage the Puma (${before} -> ${vehicle.health})`);
  assert.equal(m.rockets.length,0,'impact should consume the rocket');
});

test('rockets never damage their own or a friendly vehicle',()=>{
  const own=fresh(),ownVehicle=createVehicle('puma',{x:0,y:0,z:0,heading:0});
  own.vehicles=[ownVehicle];ownVehicle.driver=0;own.actors[0].vehicleId=ownVehicle.id;
  own.rockets=[{owner:0,weapon:1,pos:{x:-5,y:1,z:0},dir:{x:1,y:0,z:0},vy:0,life:4,bounces:0}];
  const ownHealth=ownVehicle.health;
  own.step(.5);
  assert.equal(ownVehicle.health,ownHealth,'a driver rocket must not hit its own vehicle');

  const friendly=fresh('ctf'),friendlyVehicle=createVehicle('puma',{x:0,y:0,z:0,heading:0});
  friendly.vehicles=[friendlyVehicle];friendlyVehicle.driver=0;friendly.actors[0].vehicleId=friendlyVehicle.id;
  friendly.rockets=[{owner:2,weapon:1,pos:{x:-5,y:1,z:0},dir:{x:1,y:0,z:0},vy:0,life:4,bounces:0}];
  const friendlyHealth=friendlyVehicle.health;
  friendly.step(.5);
  assert.equal(friendlyVehicle.health,friendlyHealth,'friendly fire must not damage a team vehicle');
  assert.equal(friendly.actors[0].team,friendly.actors[2].team,'fixture keeps shooter and driver on one team');

  friendly.rockets=[{owner:1,weapon:1,pos:{x:-5,y:1,z:0},dir:{x:1,y:0,z:0},vy:0,life:4,bounces:0}];
  friendly.step(.5);
  assert.ok(friendlyVehicle.health<friendlyHealth,'an enemy rocket should still damage the vehicle');
});
