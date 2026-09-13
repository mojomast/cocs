import test from 'node:test';
import assert from 'node:assert/strict';
import {navigation,floorAt,walkEdge,obstructed} from './core.mjs';
import {mapsForMode} from './arenas.mjs';
import {payloadTemplate,payloadPath,payloadPosition,stepPayload} from './payload.mjs';

const routing=arena=>({navigation:navigation(arena),floorAt,walkEdge,obstructed});
function checkRoute(arena,state,ground=floorAt){
 let previous=null;
 for(let distance=0;distance<state.total+.043;distance+=.043){
  state.distance=Math.min(distance,state.total);
  const point=payloadPosition(state);
  assert.equal(point.y,ground(point.x,point.z,arena),'cart stays on runtime ground');
  assert.equal(obstructed(point.x,point.y,point.z,.52,arena),false,`blocked at ${JSON.stringify(point)}`);
  if(previous)assert.ok(Math.abs(point.y-previous.y)<=.3,'no abrupt vertical transitions');
  previous=point;
 }
 state.distance=0;
 assert.equal(state.checkpoints.length,3);
 assert.equal(state.checkpoints.at(-1).distance,state.total);
 for(const checkpoint of state.checkpoints){
  state.distance=checkpoint.distance;
  const point=payloadPosition(state);
  assert.deepEqual(point,{x:checkpoint.x,y:checkpoint.y,z:checkpoint.z});
 }
 state.distance=0;
 const scores={0:0,1:0};
 stepPayload(state,[],1/60,{teamScores:scores});
 assert.equal(scores[0],0);
 for(let i=0;i<10000&&!state.delivered;i++){
  const point=payloadPosition(state),actor={...point,y:ground(point.x,point.z,arena),team:0,health:100};
  stepPayload(state,[actor],.1,{teamScores:scores});
 }
 assert.equal(state.delivered,true,'a grounded escort can deliver the cart');
 assert.equal(scores[0],3,'route bends do not award extra checkpoints');
}

for(const arena of mapsForMode('payload',{legacy:true}))test(`payload swept ground route: ${arena.id}`,()=>{
 const options=routing(arena),state=payloadTemplate(arena,options);
 checkRoute(arena,state);
});

test('payload detours around a solid deck and rejects a traversal shortcut',()=>{
 const arena={bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},blocks:[{x:0,z:0,w:2,d:4,h:4,kind:'deck'}],spawns:[[-6,0],[6,0]],pickups:[]};
 const options=routing(arena),graph=options.navigation;
 const from=graph.nodes.findIndex(p=>p.x===-6&&p.z===0),to=graph.nodes.findIndex(p=>p.x===6&&p.z===0);
 graph.edges[from].push(to);
 const state=payloadTemplate(arena,options);
 assert.ok(state.path.some(p=>Math.abs(p.z)>2.6));
 assert.ok(state.total>12);
 checkRoute(arena,state);
 for(const segments of [1,6]){
  const other=payloadTemplate(arena,{...options,segments});
  assert.deepEqual(other.path,state.path,'checkpoint count does not alter the safe route');
  assert.equal(other.checkpoints.length,segments);
 }
});

test('payload rejects disconnected walking routes instead of crossing a wall',()=>{
 const arena={id:'disconnected',spawns:[[-2,0],[2,0]],blocks:[{x:0,z:0,w:1,d:20,h:4}],pickups:[]};
 const graph={nodes:[{x:-2,y:0,z:0},{x:2,y:0,z:0}],edges:[[1],[0]]};
 assert.throws(()=>payloadTemplate(arena,{navigation:graph,floorAt,walkEdge,obstructed}),/no walking route/);
});

test('payload samples curved ground at the current position, not interpolated anchor heights',()=>{
 const arena={spawns:[[-3,0],[3,0]],blocks:[],pickups:[]};
 const ground=(x,z)=>1+Math.cos(x/3),graph={nodes:[{x:-3,y:ground(-3,0),z:0},{x:3,y:ground(3,0),z:0}],edges:[[1],[0]]};
 const state=payloadTemplate(arena,{navigation:graph,floorAt:ground,walkEdge:()=>true,obstructed});
 checkRoute(arena,state,ground);
});

test('static route cache skips validation while keeping match state and checkpoint counts independent',()=>{
 const arena={spawns:[[-3,0],[3,0]],blocks:[],pickups:[]};
 const graph=Object.freeze(navigation(arena)),calls={floor:0,walk:0,obstruction:0};
 const options={navigation:graph,
  floorAt:(...args)=>{calls.floor++;return floorAt(...args);},
  walkEdge:(...args)=>{calls.walk++;return walkEdge(...args);},
  obstructed:(...args)=>{calls.obstruction++;return obstructed(...args);}};
 const first=payloadTemplate(arena,options),original=structuredClone(first);
 assert.ok(calls.floor>3&&calls.walk>0&&calls.obstruction>0);
 const validated={...calls};
 const path=payloadPath(arena,1,options);
 assert.deepEqual(calls,validated,'a cached path performs no runtime geometry calls');
 path[0].x=999;path.pop();
 const second=payloadTemplate(arena,{...options,segments:6,radius:2,speed:7});
 assert.deepEqual(calls,{...validated,floor:validated.floor+6},'only the six checkpoint heights query ground');
 assert.deepEqual(second.path,original.path);
 assert.equal(second.checkpoints.length,6);
 assert.equal(second.radius,2);assert.equal(second.speed,7);
 assert.notStrictEqual(first.path,second.path);
 assert.notStrictEqual(first.path[0],second.path[0]);
 first.path[0].x=999;first.path.pop();first.waypointDistance[1]=999;
 first.checkpoints[0].owner=1;first.position.x=999;
 const third=payloadTemplate(arena,options);
 assert.deepEqual(third.path,original.path);
 assert.deepEqual(third.waypointDistance,original.waypointDistance);
 assert.deepEqual(third.checkpoints,original.checkpoints);
 assert.deepEqual(third.position,original.position);
 assert.deepEqual(second.path,original.path);
 second.checkpoints[0].owner=1;
 assert.equal(third.checkpoints[0].owner,null);

 for(const [label,map,changed] of [
  ['arena',{...arena},options],
  ['navigation',arena,{...options,navigation:Object.freeze({...graph})}],
  ...['floorAt','walkEdge','obstructed'].map(key=>[key,arena,{...options,[key]:(...args)=>options[key](...args)}]),
 ]){
  const before={...calls};
  payloadTemplate(map,changed);
  assert.ok(calls.walk>before.walk&&calls.floor>before.floor+3&&calls.obstruction>before.obstruction,`${label} identity invalidates validation`);
 }
});

test('mutable fixture navigation does not cache changing arena geometry',()=>{
 const arena={spawns:[[-3,0],[3,0]],blocks:[],pickups:[]};
 const options={...routing(arena),navigation:{nodes:[{x:-3,y:0,z:0},{x:3,y:0,z:0}],edges:[[1],[0]]}};
 assert.ok(payloadTemplate(arena,options).total>0);
 arena.blocks.push({x:0,z:0,w:1,d:20,h:4});
 assert.throws(()=>payloadTemplate(arena,options),/no walking route/);
});
