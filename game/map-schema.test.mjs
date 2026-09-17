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

import {validateMapSchema,isMapSchemaValid,LEVELGEN_SCHEMA_VERSION,REQUIRED_MAP_ARRAYS,node,edge,lane,terminal,validateLattice,isLatticeValid,NODE_ARCHETYPES,LANE_TRAVERSAL_KINDS,TERMINAL_KINDS} from './map-schema.mjs';

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

// ---- schema v3 lattice layer ---------------------------------------------

const latticeMap=()=>({
 ...validMap(),
 playBounds:{minX:-60,maxX:60,minZ:-60,maxZ:60,frontage:120,laneSep:40,maxNodeSpacing:60},
 nodes:[node('hq-0',-50,0,8,'hq'),node('hq-1',50,0,8,'hq'),node('front-0',-20,0,6,'front'),node('front-1',20,0,6,'front'),node('relay-0',0,0,6,'relay')],
 lattice:[edge('hq-0','front-0'),edge('front-0','relay-0'),edge('relay-0','front-1'),edge('front-1','hq-1')],
 terminals:[terminal('t0','relay-0','relay',0,4)],
 lanes:[lane('n','vehicle-road',[[-55,-40],[55,-40]]),lane('c','cqc',[[-55,0],[55,0]]),lane('s','zipline-flank',[[-55,40],[55,40]])],
});

test('lattice builders emit the frozen interface shape',()=>{
 assert.deepEqual(node('n1',1,2),{id:'n1',x:1,z:2,r:8,archetype:'front'});
 assert.deepEqual(node('n2',1,2,4,'hq'),{id:'n2',x:1,z:2,r:4,archetype:'hq'});
 assert.deepEqual(edge('a','b'),['a','b']);
 assert.deepEqual(lane('l','cqc',[[0,0],[1,1]]),{id:'l',kind:'cqc',waypoints:[[0,0],[1,1]],traversal:{kind:'cqc'}});
 assert.deepEqual(lane('l','vehicle-road',[[0,0],[1,1]],{width:8,traversal:{bypassFraction:.5}}),{id:'l',kind:'vehicle-road',waypoints:[[0,0],[1,1]],traversal:{kind:'vehicle-road',bypassFraction:.5},width:8});
 assert.deepEqual(terminal('t','relay-0','relay',3,4),{id:'t',nodeId:'relay-0',kind:'relay',x:3,z:4,y:0});
 assert.deepEqual(terminal('t','relay-0','array-relay',3,4,2),{id:'t',nodeId:'relay-0',kind:'array-relay',x:3,z:4,y:2});
 assert.deepEqual(NODE_ARCHETYPES,['front','economy','relay','hq','array']);
 assert.deepEqual(LANE_TRAVERSAL_KINDS,['vehicle-road','cqc','zipline-flank']);
 assert.deepEqual(TERMINAL_KINDS,['relay','vault','array-relay']);
});

test('legacy maps keep the v2 contract and the schema version is unchanged',()=>{
 assert.equal(LEVELGEN_SCHEMA_VERSION,2);
 assert.deepEqual(validateMapSchema(validMap()),[]);
 assert.deepEqual(validateLattice(validMap()),[]);
 assert.equal(isLatticeValid(validMap()),true);
});

test('validateMapSchema accepts an opted-in lattice map',()=>{
 assert.deepEqual(validateMapSchema(latticeMap()),[]);
 assert.deepEqual(validateLattice(latticeMap()),[]);
 assert.equal(isMapSchemaValid(latticeMap()),true);
 assert.equal(isLatticeValid(latticeMap()),true);
});

test('validateMapSchema rejects malformed playBounds, nodes, edges, terminals and lanes',()=>{
 const bad=()=>latticeMap();
 let map=bad();map.playBounds.frontage=241;
 assert.ok(validateMapSchema(map).some(e=>e.includes('frontage')));
 map=bad();map.nodes[1].id='hq-0';
 assert.ok(validateMapSchema(map).some(e=>e.includes('duplicated')));
 map=bad();map.nodes[0].archetype='castle';
 assert.ok(validateMapSchema(map).some(e=>e.includes('archetype')));
 map=bad();map.nodes[0].x=-999;
 assert.ok(validateMapSchema(map).some(e=>e.includes('playBounds')));
 map=bad();map.nodes[0].r=0;
 assert.ok(validateMapSchema(map).some(e=>e.includes('capture radius')));
 map=bad();map.lattice.push(edge('hq-0','ghost'));
 assert.ok(validateMapSchema(map).some(e=>e.includes('unknown node ghost')));
 map=bad();map.lattice.push(edge('hq-0','hq-0'));
 assert.ok(validateMapSchema(map).some(e=>e.includes('self-reference')));
 map=bad();map.terminals[0]={...map.terminals[0],nodeId:'front-0'};
 assert.ok(validateMapSchema(map).some(e=>e.includes('relay/array/HQ')));
 map=bad();map.terminals[0]={...map.terminals[0],x:99,z:0};
 assert.ok(validateMapSchema(map).some(e=>e.includes('capture radius')));
 map=bad();map.terminals[0]={...map.terminals[0],nodeId:'ghost'};
 assert.ok(validateMapSchema(map).some(e=>e.includes('unknown node')));
 map=bad();map.lanes[0].kind='teleport-road';
 assert.ok(validateMapSchema(map).some(e=>e.includes('lanes[0].kind')));
 map=bad();map.lanes[0].waypoints=[[0,0]];
 assert.ok(validateMapSchema(map).some(e=>e.includes('at least two')));
 map=bad();map.lanes[0].waypoints=[[0,0],[999,0]];
 assert.ok(validateMapSchema(map).some(e=>e.includes('playBounds')));
 map=bad();map.lanes[0].width=3;
 assert.ok(validateMapSchema(map).some(e=>e.includes('at least 6')));
 assert.equal(isMapSchemaValid(bad()),true);
});

test('validateLattice enforces graph doctrine beyond structure',()=>{
 const bad=()=>latticeMap();
 let map=bad();map.lattice=[edge('hq-0','front-0'),edge('relay-0','front-1'),edge('front-1','hq-1')];
 assert.ok(validateLattice(map).some(e=>e.includes('connected')));
 map=bad();map.nodes=map.nodes.filter(n=>n.id!=='hq-1');map.lattice=map.lattice.filter(([a,b])=>a!=='hq-1'&&b!=='hq-1');
 assert.ok(validateLattice(map).some(e=>e.includes('HQ anchors must come in pairs')));
 map=bad();map.nodes=map.nodes.map(n=>n.archetype==='front'?'hq':n.archetype);
 assert.ok(validateLattice(map).some(e=>e.includes('capturable nodes')));
 map=bad();map.lattice=[edge('front-0','front-1'),edge('front-1','relay-0'),edge('hq-0','hq-1')];
 assert.ok(validateLattice(map).some(e=>e.includes('must be adjacent to a capturable node')));
 map=bad();map.nodes.push(node('array-0',5,5,5,'array'));map.lattice.push(edge('array-0','relay-0'));
 assert.ok(validateLattice(map).some(e=>e.includes('anchor behind')));
 assert.ok(validateLattice(map).some(e=>e.includes('needs at least 2 approach vectors')));
 // Rebuild with the array anchored behind a front and a second relay approach.
 map=bad();
 map.nodes=[node('hq-0',-50,0,8,'hq'),node('hq-1',50,0,8,'hq'),node('front-0',-20,0,6,'front'),node('front-1',20,0,6,'front'),node('array-0',0,0,6,'array'),node('relay-0',10,30,6,'relay')];
 map.lattice=[edge('hq-0','front-0'),edge('front-0','array-0'),edge('array-0','front-1'),edge('front-1','hq-1'),edge('array-0','relay-0')];
 map.terminals=[];
 assert.deepEqual(validateLattice(map),[]);
});

