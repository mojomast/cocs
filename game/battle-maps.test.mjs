import test from 'node:test';
import assert from 'node:assert/strict';
import {BATTLE_MAPS} from './battle-maps.mjs';
import {MAPS,getMap} from './maps.mjs';
import {arenaMeta,arenaSupportsMode} from './arenas.mjs';
import {floorAt,obstructed} from './core.mjs';

const EXPECTED=['neon-vertical','substation','warfront','skyfall-basin'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const point=value=>Array.isArray(value)?{x:value[0],z:value[1]}:value;
const inside=(map,value)=>{const p=point(value);return finite(p.x)&&finite(p.z)&&p.x>=map.bounds.minX&&p.x<=map.bounds.maxX&&p.z>=map.bounds.minZ&&p.z<=map.bounds.maxZ;};
const traversal=map=>Object.values(map.traversal||{}).flat();
const allPoints=map=>[
 ...map.spawns,
 ...Object.values(map.teamSpawns||{}).flat(),
 ...Object.values(map.flagSpawns||{}),
 ...map.pickups.map(([,x,z])=>({x,z})),
 ...(map.objectiveZones||[]),
 ...traversal(map).flatMap(item=>[item.x!==undefined?item:null,item.from,item.to,item.target].filter(Boolean)),
 ...(map.vehicles||[]),
 ...(map.navNodes||[]),
 ...(map.landmarks||[]),
];

test('the battle pack exports four frozen, uniquely identified maps',()=>{
 assert.equal(BATTLE_MAPS.length,4);
 assert.deepEqual(BATTLE_MAPS.map(map=>map.id),EXPECTED);
 assert.equal(new Set(EXPECTED).size,EXPECTED.length);
 for(const map of BATTLE_MAPS){
  assert.equal(getMap(map.id),map,`${map.id} is registered`);
  assert.ok(map.bounds.minX<map.bounds.maxX&&map.bounds.minZ<map.bounds.maxZ,`${map.id} bounds`);
  assert.ok(typeof map.name==='string'&&map.name.length>0,`${map.id} name`);
  assert.ok(typeof map.description==='string'&&map.description.length>20,`${map.id} description`);
  assert.ok(map.teamSpawns?.[0]?.length>=2&&map.teamSpawns?.[1]?.length>=2,`${map.id} team spawns`);
  assert.ok(map.flagSpawns?.[0]&&map.flagSpawns?.[1],`${map.id} flag bases`);
  assert.ok(map.navNodes.length>=8,`${map.id} nav nodes`);
  assert.ok(map.landmarks.length>=3,`${map.id} landmarks`);
 }
});

test('every authored battle-map point stays inside the map bounds',()=>{
 for(const map of BATTLE_MAPS)
  for(const value of allPoints(map))assert.ok(inside(map,value),`${map.id} out-of-bounds point ${JSON.stringify(value)}`);
});

test('battle-map spawns, flags and supplies stand on clear ground',()=>{
 for(const map of BATTLE_MAPS){
  const places=[
   ...map.spawns.map(p=>['spawn',...p]),
   ...Object.values(map.teamSpawns).flat().map(p=>['team spawn',...p]),
   ...Object.values(map.flagSpawns).map(p=>['flag',p.x,p.z]),
   ...map.pickups.map(([kind,x,z])=>[`pickup ${kind}`,x,z]),
  ];
  for(const [kind,x,z] of places){
   const floor=floorAt(x,z,map);
   assert.notEqual(floor,null,`${map.id} ${kind} support at ${x},${z}`);
   assert.equal(obstructed(x,floor,z,.6,map),false,`${map.id} ${kind} clearance at ${x},${z}`);
  }
 }
});

test('battle-map objective zones sit on supported, unobstructed ground',()=>{
 for(const map of BATTLE_MAPS)for(const zone of map.objectiveZones){
  assert.ok(finite(zone.x)&&finite(zone.z)&&finite(zone.y),`${map.id} zone finite`);
  assert.ok(finite(zone.radius)&&zone.radius>0,`${map.id} zone radius`);
  const floor=floorAt(zone.x,zone.z,map);
  assert.notEqual(floor,null,`${map.id} zone support at ${zone.x},${zone.z}`);
  assert.equal(zone.y,floor,`${map.id} zone uses runtime floor height`);
  assert.equal(obstructed(zone.x,floor,zone.z,.6,map),false,`${map.id} zone clearance at ${zone.x},${zone.z}`);
 }
});

test('declared battle-map vehicles have clearance and valid kinds',()=>{
 const kinds=new Set(['puma','hornet']);
 for(const map of BATTLE_MAPS){
  const ids=(map.vehicles||[]).map(vehicle=>vehicle.id);
  assert.equal(new Set(ids).size,ids.length,`${map.id} vehicle ids unique`);
  for(const vehicle of map.vehicles||[]){
   assert.ok(kinds.has(vehicle.kind),`${map.id} vehicle kind ${vehicle.kind}`);
   const floor=floorAt(vehicle.x,vehicle.z,map);
   assert.notEqual(floor,null,`${map.id} vehicle support ${vehicle.id}`);
   assert.equal(obstructed(vehicle.x,floor,vehicle.z,2.1,map),false,`${map.id} vehicle clearance ${vehicle.id}`);
  }
 }
});

test('battle-map traversal ids are unique',()=>{
 for(const map of BATTLE_MAPS){
  const ids=traversal(map).map(item=>item.id);
  assert.equal(new Set(ids).size,ids.length,`${map.id} traversal ids unique`);
  assert.ok(ids.every(id=>typeof id==='string'&&id.length>0),`${map.id} traversal ids named`);
 }
});

test('battle maps advertise only modes they can actually play',()=>{
 for(const map of BATTLE_MAPS){
  assert.ok(arenaSupportsMode(map.id,'deathmatch')||arenaSupportsMode(map.id,'combined-arms'),`${map.id} advertises a playable mode`);
  assert.ok(arenaMeta(map.id).play.length>0,`${map.id} play list`);
 }
 for(const map of MAPS)assert.equal(arenaMeta(map.id).id,map.id);
});
