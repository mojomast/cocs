import test from 'node:test';
import assert from 'node:assert/strict';
import {NEXTGEN_MAPS} from './nextgen-maps.mjs';
import {CTF_MAPS} from './ctf-maps.mjs';
import {floorAt,moveActor} from './core.mjs';

// Regressions from the grapple pass that changed moveActor's floor and ceiling
// resolution. Both cases are terrain-map behaviour and must hold for ordinary
// walking and jumping, not only for the grapple.
const grounded=(map,x,z,y)=>({x,z,y:y??floorAt(x,z,map),vx:0,vy:0,vz:0,grounded:true,coyote:0,jumpBuffer:0,moveSpeed:5});

test('sloped terrain never reads itself as a ceiling and cancels a jump',()=>{
 const map=CTF_MAPS.find(m=>m.id==='frostline');
 const start=floorAt(-76,0,map);
 const actor=grounded(map,-76,0,start);
 for(let i=0;i<24;i++)moveActor(actor,{jump:true},1/60,map);
 assert.ok(actor.y>start+.6,`jump gains height (${actor.y} vs ${start})`);
});

test('an actor embedded under the heightfield heals to the floor instead of falling',()=>{
 const map=NEXTGEN_MAPS.find(m=>m.id==='fortress');
 const x=-33.14285714285714,z=-12.857142857142858,floor=floorAt(x,z,map);
 const actor={x,z,y:floor-.9,vx:0,vy:0,vz:0,grounded:false,coyote:0,jumpBuffer:0,moveSpeed:5};
 for(let i=0;i<12;i++)moveActor(actor,{},1/60,map);
 assert.ok(actor.y>=floor-.05,`settles on the heightfield (${actor.y} vs ${floor})`);
 assert.equal(actor.grounded,true);
});

test('a boost pad on terrain still travels its full arc to the target',()=>{
 const map=CTF_MAPS.find(m=>m.id==='frostline');
 const link=map.jumpLinks.find(entry=>entry.id==='frost-west-launch');
 const actor={...link.source,vx:0,vy:0,vz:0,grounded:true,coyote:0,jumpBuffer:0};
 moveActor(actor,{},1/60,map);
 assert.equal(actor.traversalFlight,true);
 for(let i=0;i<400&&!actor.grounded;i++)moveActor(actor,{},1/60,map);
 assert.ok(actor.grounded,'the arc lands');
 assert.ok(Math.hypot(actor.x-link.target.x,actor.z-link.target.z)<1,'lands at the authored target');
});
