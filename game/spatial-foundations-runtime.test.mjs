import test from 'node:test';
import assert from 'node:assert/strict';
import {createLevel} from './levelgen.mjs';
import {floorAt,obstructed,walkEdge,moveActor,rayWorld} from './core.mjs';

const walk=(map,start,end)=>{
 const steps=Math.ceil(Math.hypot(end.x-start.x,end.z-start.z)/2);
 let a={...start,y:floorAt(start.x,start.z,map)};
 for(let i=1;i<=steps;i++){
  const x=start.x+(end.x-start.x)*i/steps,z=start.z+(end.z-start.z)*i/steps,b={x,z,y:floorAt(x,z,map)};
  assert.equal(walkEdge(a,b,map),true,`runtime edge ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);a=b;
 }
 const actor={...start,y:floorAt(start.x,start.z,map),vx:0,vy:0,vz:0,grounded:true,moveSpeed:5,jumpBuffer:0,coyote:0};
 const len=Math.hypot(end.x-start.x,end.z-start.z),input={x:(end.x-start.x)/len,z:(end.z-start.z)/len};
 for(let i=0;i<600&&Math.hypot(end.x-actor.x,end.z-actor.z)>.18;i++)moveActor(actor,input,1/60,map);
 assert.ok(Math.hypot(end.x-actor.x,end.z-actor.z)<.18,`actor stopped at ${JSON.stringify(actor)}`);
 assert.equal(obstructed(actor.x,actor.y,actor.z,.52,map),false);
 return actor;
};

test('authoritative movement and nav cross the raised doorway without jumping',()=>{
 const map=createLevel({id:'spatial-runtime-door',amplitude:0,relief:0,layout(c){c.addBuilding({x:0,z:0,w:10,d:8,y:2});}});
 const a=walk(map,{x:0,z:15},{x:0,z:0});assert.ok(Math.abs(a.y-2)<1e-6);
});

test('authoritative movement and nav traverse both crossing cavern portals',()=>{
 const map=createLevel({id:'spatial-runtime-cavern',amplitude:0,relief:0,base:2,layout(c){c.addCavern({x:0,z:0,radius:8,height:7});c.addTunnel([[0,2,-20],[0,2,20]],3);}});
 walk(map,{x:0,z:-18},{x:0,z:18});
});

test('legacy blocks including deck and y metadata remain ground-to-top ray and movement solids',()=>{
 for(const kind of ['wall','deck','foundation']){
  const map={bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20},blocks:[{x:0,z:0,w:4,d:4,h:8,y:6,minY:6,kind}]};
  assert.equal(obstructed(0,1,0,.52,map),true);
  assert.equal(rayWorld({x:-5,y:1,z:0},{x:1,y:0,z:0},20,map),3);
 }
});
