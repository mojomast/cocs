import assert from 'node:assert/strict';
import test from 'node:test';
import {MAPS,pickupWeapon} from './maps.mjs';
import {ARSENAL_MAPS} from './arsenal-maps.mjs';
import {VEHICLE_KIND_IDS} from './vehicles.mjs';

const WEAPON_KINDS=['rocket','rail','scatter','plasma','grenade','shock','flak','marksman','smg'];
const EXPECTED_IDS=['trenchline','signal-ridge','rampart','catwalk-breach'];
const ASSAULT_IDS=['rampart','catwalk-breach'];
const within=(map,x,z)=>x>=map.bounds.minX&&x<=map.bounds.maxX&&z>=map.bounds.minZ&&z<=map.bounds.maxZ;
const clearance=0.65;
const inBlock=(map,x,z,r=clearance)=>map.blocks.some(b=>Math.abs(x-b.x)<b.w/2+r&&Math.abs(z-b.z)<b.d/2+r);
const finite=(...values)=>values.every(value=>Number.isFinite(value));

test('arsenal maps are frozen, unique, and registered in MAPS',()=>{
 assert.deepEqual(ARSENAL_MAPS.map(map=>map.id),EXPECTED_IDS);
 assert.ok(Object.isFrozen(ARSENAL_MAPS));
 assert.equal(new Set(ARSENAL_MAPS.map(map=>map.id)).size,ARSENAL_MAPS.length);
 const existing=new Set(MAPS.map(map=>map.id));
 for(const map of ARSENAL_MAPS){
  assert.ok(existing.has(map.id),`${map.id} missing from MAPS`);
  assert.ok(Object.isFrozen(map)&&Object.isFrozen(map.blocks)&&Object.isFrozen(map.pickups),`${map.id} not deeply frozen`);
 }
});

test('arsenal map bounds are valid and contain every block',()=>{
 for(const map of ARSENAL_MAPS){
  const {minX,maxX,minZ,maxZ}=map.bounds;
  assert.ok(finite(minX,maxX,minZ,maxZ),map.id);
  assert.ok(minX<maxX&&minZ<maxZ,map.id);
  for(const block of map.blocks){
   assert.ok(within(map,block.x-block.w/2,block.z-block.d/2)&&within(map,block.x+block.w/2,block.z+block.d/2),`${map.id} block`);
  }
 }
});

test('arsenal maps have at least ten grounded spawns clear of blocks',()=>{
 for(const map of ARSENAL_MAPS){
  assert.ok(map.spawns.length>=10,`${map.id} spawns`);
  for(const [x,z] of map.spawns){
   assert.ok(Number.isFinite(x)&&Number.isFinite(z),`${map.id} spawn finite`);
   assert.ok(within(map,x,z),`${map.id} spawn bounds`);
   assert.equal(inBlock(map,x,z),false,`${map.id} spawn in block`);
  }
 }
});

test('arsenal maps have pickups including health, armor and resolvable weapons',()=>{
 for(const map of ARSENAL_MAPS){
  assert.ok(map.pickups.length>=6,`${map.id} pickups`);
  const kinds=map.pickups.map(([kind])=>kind);
  assert.ok(kinds.includes('health'),`${map.id} health`);
  assert.ok(kinds.includes('armor'),`${map.id} armor`);
  const weapons=[...new Set(kinds.filter(kind=>WEAPON_KINDS.includes(kind)))];
  assert.ok(weapons.length>=3,`${map.id} weapon variety`);
  for(const [,x,z] of map.pickups){
   assert.ok(within(map,x,z),`${map.id} pickup bounds`);
   assert.equal(inBlock(map,x,z,1),false,`${map.id} pickup in block`);
  }
  for(const weapon of weapons)assert.ok(Number.isFinite(pickupWeapon(weapon)),`${map.id} ${weapon} resolves`);
 }
});

test('arsenal map navNodes are inside bounds and unobstructed by blocks',()=>{
 for(const map of ARSENAL_MAPS){
  assert.ok(map.navNodes.length>=10,`${map.id} navNodes`);
  for(const node of map.navNodes){
   const x=node.x,z=node.z;
   assert.ok(Number.isFinite(x)&&Number.isFinite(z),`${map.id} nav finite`);
   assert.ok(within(map,x,z),`${map.id} nav bounds`);
   assert.equal(inBlock(map,x,z),false,`${map.id} nav in block`);
  }
 }
});

test('arsenal map vehicles use valid kinds and clear slots',()=>{
 for(const map of ARSENAL_MAPS)for(const unit of map.vehicles||[]){
  assert.ok(VEHICLE_KIND_IDS.includes(unit.kind),`${map.id} vehicle kind`);
  assert.ok(finite(unit.x,unit.z)&&within(map,unit.x,unit.z),`${map.id} vehicle bounds`);
  assert.equal(inBlock(map,unit.x,unit.z,1.5),false,`${map.id} vehicle in block`);
 }
 const trenchline=ARSENAL_MAPS.find(map=>map.id==='trenchline');
 const signal=ARSENAL_MAPS.find(map=>map.id==='signal-ridge');
 assert.deepEqual(trenchline.vehicles.map(v=>v.kind).sort(),['hornet','puma','puma','scout','scout','titan','titan','transport','transport']);
 assert.deepEqual(signal.vehicles.map(v=>v.kind).sort(),['hornet','hornet','puma','scout','scout','titan','titan']);
});

test('arsenal traversal points and teleporter targets are finite and in bounds',()=>{
 for(const map of ARSENAL_MAPS){
  for(const point of map.traversal?.jumpPads||[]){
   assert.ok(finite(point.x,point.z)&&within(map,point.x,point.z),`${map.id} jump pad`);
  }
  for(const point of map.traversal?.trampolines||[]){
   assert.ok(finite(point.x,point.z)&&within(map,point.x,point.z),`${map.id} trampoline`);
  }
  for(const teleporter of map.traversal?.teleporters||[]){
   assert.ok(finite(teleporter.x,teleporter.z),`${map.id} teleporter origin`);
   assert.ok(within(map,teleporter.x,teleporter.z),`${map.id} teleporter bounds`);
   const target=teleporter.target;
   assert.ok(target&&finite(target.x,target.z),`${map.id} teleporter target`);
   assert.ok(within(map,target.x,target.z),`${map.id} teleporter target bounds`);
  }
  for(const line of map.traversal?.ziplines||[]){
   assert.ok(line.from&&line.to&&finite(line.from.x,line.from.z)&&finite(line.to.x,line.to.z),`${map.id} zipline`);
   assert.ok(within(map,line.from.x,line.from.z)&&within(map,line.to.x,line.to.z),`${map.id} zipline bounds`);
  }
 }
});

test('assault maps expose three ordered objective zones',()=>{
 for(const id of ASSAULT_IDS){
  const map=ARSENAL_MAPS.find(entry=>entry.id===id);
  assert.ok(map.objectiveZones.length>=3,`${id} zones`);
  assert.deepEqual(map.objectiveZones.map(zone=>zone.label),['alpha','bravo','charlie'],`${id} order`);
  for(const zone of map.objectiveZones){
   assert.ok(finite(zone.x,zone.z,zone.radius),`${id} zone finite`);
   assert.ok(within(map,zone.x,zone.z),`${id} zone bounds`);
   assert.ok(zone.radius>0,`${id} zone radius`);
  }
 }
 for(const map of ARSENAL_MAPS)assert.ok(map.objectiveZones.length>=3,`${map.id} objectiveZones`);
});
