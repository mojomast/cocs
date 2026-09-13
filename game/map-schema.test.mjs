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
