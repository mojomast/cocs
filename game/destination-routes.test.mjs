import test from 'node:test';
import assert from 'node:assert/strict';
import {DESTINATION_COMBAT_MAPS} from './destination-combat-maps.mjs';
import {DESTINATION_OBJECTIVE_MAPS} from './destination-objective-maps.mjs';
import {floorAt,obstructed,walkEdge,navigation} from './core.mjs';

for(const map of [...DESTINATION_COMBAT_MAPS,...DESTINATION_OBJECTIVE_MAPS])test(`${map.id}: authored district routes remain grounded and walkable in both directions`,()=>{
 const graph=navigation(map);
 for(const route of map.design?.routes??map.routes){
  let previous=null;
  for(let i=1;i<route.points.length;i++){
   const a=route.points[i-1],b=route.points[i],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.5);
   for(let j=0;j<=steps;j++){
    const x=a[0]+(b[0]-a[0])*j/steps,z=a[1]+(b[1]-a[1])*j/steps,y=floorAt(x,z,map),p={x,y,z};
    assert.ok(Number.isFinite(y),`${route.id}: supported ${x},${z}`);
    assert.equal(obstructed(x,y,z,.52,map),false,`${route.id}: clear ${x},${z}`);
    if(previous&&Math.hypot(x-previous.x,z-previous.z)>.01){assert.ok(walkEdge(previous,p,map),`${route.id}: forward ${x},${z}`);assert.ok(walkEdge(p,previous,map),`${route.id}: return ${x},${z}`);}
    previous=p;
   }
  }
  assert.ok(graph.nodes.some(n=>Math.hypot(n.x-previous.x,n.z-previous.z)>.1&&walkEdge(previous,n,map)&&walkEdge(n,previous,map)),`${route.id}: joins runtime graph`);
 }
});
