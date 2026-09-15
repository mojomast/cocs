import assert from 'node:assert/strict';
import test from 'node:test';
import {cover,coverBuilder,flagData,flagSpawns,freeze,pad,platform,teamData,teamSpawns,teleporter,tp,wall,zone} from './map-schema.mjs';

test('freeze deeply freezes objects and arrays and returns the value',()=>{
  const value=freeze({a:[{b:1}],c:null});
  assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.a)&&Object.isFrozen(value.a[0]));
  assert.equal(freeze(null),null);
  assert.equal(freeze(5),5);
  assert.equal(freeze('x'),'x');
});

test('wall and cover builders emit the canonical schema defaults',()=>{
  assert.deepEqual(wall(1,2,3,4),{x:1,z:2,w:3,d:4,h:9,kind:'wall'});
  assert.deepEqual(wall(1,2,3,4,5,'deck'),{x:1,z:2,w:3,d:4,h:5,kind:'deck'});
  assert.deepEqual(cover(1,2),{x:1,z:2,w:3,d:2,h:2,kind:'cover'});
  assert.deepEqual(cover(1,2,3,4,5,'rock'),{x:1,z:2,w:3,d:4,h:5,kind:'rock'});
});

test('coverBuilder parameterizes the default height while keeping explicit overrides',()=>{
  assert.deepEqual(coverBuilder()(1,2,3,4),cover(1,2,3,4));
  const tall=coverBuilder({h:2.2});
  assert.deepEqual(tall(1,2,3,4),{x:1,z:2,w:3,d:4,h:2.2,kind:'cover'});
  assert.deepEqual(tall(1,2,3,4,5,'landmark'),{x:1,z:2,w:3,d:4,h:5,kind:'landmark'});
});

test('platform and pad builders preserve field defaults',()=>{
  assert.deepEqual(platform(1,2,3,4,'middle'),{x:1,z:2,w:3,d:4,y:0,thickness:.7,kind:'platform',route:'middle'});
  assert.deepEqual(platform(1,2,3,4,'high',7),{x:1,z:2,w:3,d:4,y:7,thickness:.7,kind:'platform',route:'high'});
  assert.deepEqual(pad('p',1,2),{id:'p',x:1,z:2,y:0,power:18,cooldown:2});
  assert.deepEqual(pad('p',1,2,20),{id:'p',x:1,z:2,y:0,power:20,cooldown:2});
});

test('tp emits target as the canonical teleporter destination',()=>{
  assert.deepEqual(tp('t',1,2,3,4),{id:'t',x:1,z:2,y:0,target:{x:3,y:0,z:4},cooldown:1});
  assert.deepEqual(tp('t',1,2,3,4,5,6),{id:'t',x:1,z:2,y:5,target:{x:3,y:6,z:4},cooldown:1});
});

test('teleporter normalizes authored to into canonical target',()=>{
  const normalized=teleporter({to:{x:1,y:2,z:3},cooldown:2});
  assert.deepEqual(normalized,{cooldown:2,target:{x:1,y:2,z:3}});
  assert.equal('to' in normalized,false);
  assert.deepEqual(teleporter({id:'t',target:{x:1,y:0,z:2}}),{id:'t',target:{x:1,y:0,z:2}});
  assert.deepEqual(teleporter({id:'t',to:{x:1,y:0,z:2},target:{x:9,y:0,z:9}}),{id:'t',target:{x:9,y:0,z:9}});
});

test('zone keeps label optional',()=>{
  assert.deepEqual(zone(1,2),{x:1,z:2,y:0,radius:3.5});
  assert.deepEqual(zone(1,2,4.5),{x:1,z:2,y:0,radius:4.5});
  assert.deepEqual(zone(1,2,4.5,'alpha'),{x:1,z:2,y:0,radius:4.5,label:'alpha'});
});

test('team and flag spawn builders emit numeric and colour aliases',()=>{
  assert.equal(teamData,teamSpawns);
  assert.equal(flagData,flagSpawns);
  assert.deepEqual(teamSpawns(['w'],['e']),{0:['w'],1:['e'],red:['w'],blue:['e']});
  assert.deepEqual(flagSpawns(-5,5),{0:{x:-5,z:0},1:{x:5,z:0},red:{x:-5,z:0},blue:{x:5,z:0}});
});

import {validateMapSchema,isMapSchemaValid,LEVELGEN_SCHEMA_VERSION,REQUIRED_MAP_ARRAYS} from './map-schema.mjs';

const validMap=()=>({
 id:'fixture',name:'Fixture',bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},
 blocks:[{x:0,z:0,w:2,d:2,h:3}],spawns:[[1,1]],pickups:[['health',2,2]],navNodes:[{x:0,z:0}],
});

test('validateMapSchema accepts a well-formed map and reports structural errors',()=>{
 assert.equal(LEVELGEN_SCHEMA_VERSION,2);
 assert.deepEqual(validateMapSchema(validMap()),[]);
 assert.equal(isMapSchemaValid(validMap()),true);
 const missing=validateMapSchema({});
 assert.ok(missing.some(e=>e.includes('map.id')));
 assert.ok(missing.some(e=>e.includes('map.bounds')));
 for(const key of REQUIRED_MAP_ARRAYS)assert.ok(missing.some(e=>e.includes(`map.${key}`)));
});

test('validateMapSchema rejects out-of-bounds placements and degenerate blocks',()=>{
 const map=validMap();
 map.spawns=[[99,0]];
 map.pickups=[['health',0,99]];
 map.navNodes=[{x:0,z:50}];
 map.blocks=[{x:0,z:0,w:0,d:2,h:3}];
 const errors=validateMapSchema(map);
 assert.ok(errors.some(e=>e.includes('spawns[0]')));
 assert.ok(errors.some(e=>e.includes('pickups[0]')));
 assert.ok(errors.some(e=>e.includes('navNodes[0]')));
 assert.ok(errors.some(e=>e.includes('blocks[0]')));
 assert.equal(isMapSchemaValid(map),false);
 assert.deepEqual(validateMapSchema(null),['map must be an object']);
});

test('validateMapSchema checks team and flag spawn bounds',()=>{
 const map=validMap();
 map.teamSpawns={0:[[0,0]],1:[[99,0]]};
 map.flagSpawns={0:{x:0,z:0},1:[0,99]};
 const errors=validateMapSchema(map);
 assert.ok(errors.some(e=>e.includes('teamSpawns.1[0]')));
 assert.ok(errors.some(e=>e.includes('flagSpawns.1')));
});
