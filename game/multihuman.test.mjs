import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
function rng(){let n=7;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);}
test('humanCount marks leading actors as humans and keeps the rest as bots',()=>{
 const m=new Match('chatgpt','openclaw',rng(),'exchange',{humanCount:2,botCount:1});
 assert.equal(m.actors.length,3);
 assert.equal(m.humanCount,2);
 assert.equal(m.actors[0].id,0);assert.equal(m.actors[0].bot,null);
 assert.equal(m.actors[1].id,1);assert.equal(m.actors[1].bot,null);
 assert.equal(m.actors[2].id,2);assert.ok(m.actors[2].bot);
});
test('per-actor inputs drive look, fire, movement and weapon switching independently',()=>{
 const m=new Match('chatgpt','openclaw',rng(),'crosswire',{humanCount:2,botCount:0});
 const [a,b]=m.actors;
 Object.assign(a,{x:-9,y:0,z:8,protection:0,shotWait:0,health:100,armor:0,yaw:0,pitch:0});
 Object.assign(b,{x:-9,y:0,z:-2,protection:0,shotWait:0,health:100,armor:0,yaw:0,pitch:0});
 m.step(1/60,{inputs:{0:{yaw:0,fire:true},1:{yaw:Math.PI,fire:true}}});
  assert.equal(a.health,89);assert.equal(b.health,89);
 assert.ok(Math.abs(a.yaw)<1e-9);assert.ok(Math.abs(b.yaw-Math.PI)<1e-9);
 const ax=a.x,bx=b.x;
 m.step(1/60,{inputs:{0:{x:1,z:0},1:{}}});
 assert.ok(a.x!==ax);assert.equal(b.x,bx);
 b.ammo[3]=10;
 m.step(1/60,{inputs:{1:{weapon:3}}});
 assert.equal(b.weapon,3);
 b.ammo[2]=0;
 m.step(1/60,{inputs:{1:{weapon:2}}});
 assert.equal(b.weapon,3);
});
test('a human without inputs idles safely and never runs bot AI',()=>{
 const m=new Match('chatgpt','openclaw',rng(),'exchange',{humanCount:2,botCount:0});
 const [a,b]=m.actors,start={x:a.x,z:a.z,yaw:a.yaw,health:a.health};
 for(let i=0;i<120;i++)m.step(1/60,{inputs:{0:{},1:{}}});
 assert.equal(a.x,start.x);assert.equal(a.z,start.z);assert.equal(a.yaw,start.yaw);assert.equal(a.health,start.health);
 const bx=b.x;
 for(let i=0;i<60;i++)m.step(1/60,{inputs:{0:{x:1}}});
 assert.equal(b.x,bx);
});
test('mixed human and bot match is deterministic under identical input traces',()=>{
 const run=()=>{const m=new Match('gemini','cline',rng(),'foundry',{humanCount:2,botCount:2,fragLimit:5,timeLimit:120});
  const drive=(a,sign)=>({x:Math.sin(m.time*2+sign),z:Math.cos(m.time*1.3+sign),yaw:a.yaw+.01*Math.sin(m.time+sign),pitch:.2*Math.sin(m.time+sign),fire:Math.sin(m.time*5+sign)>.4,jump:Math.sin(m.time*2.7+sign)>.5,power:Math.sin(m.time*7+sign)>.92,weapon:Math.round(m.time)%2});
  for(let i=0;i<7200&&!m.over;i++)m.step(1/60,{inputs:{0:drive(m.actors[0],1),1:drive(m.actors[1],-1)}});
  return m.snapshot();};
 assert.deepEqual(run(),run());
});
test('legacy single-input step shape still drives actor zero',()=>{
 const m=new Match('chatgpt','openclaw',rng(),'crosswire');
 const [a,b]=m.actors;
 Object.assign(a,{x:-9,y:0,z:8,protection:0,shotWait:0,health:100,yaw:0,pitch:0});
  Object.assign(b,{x:-9,y:0,z:4,protection:0,health:100,armor:0});
 m.step(1/60,{fire:true});
  assert.equal(b.health,89);
});
