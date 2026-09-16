import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';

const arena={id:'spawn-test',background:'#000',blocks:[{x:0,z:0,w:4,h:4,d:2,kind:'cover'}],bounds:{minX:-30,maxX:30,minZ:-30,maxZ:30}};
function fixture(){
 const m=new Match('chatgpt','openclaw',()=>0,'exchange',{mode:'deathmatch',botCount:0,humanCount:2});
 m.arena=arena;m.pickups=[];m.vehicles=[];m.nav=[];m.edges=[];m.rockets=[];m.spawnHeat=new Map();m.random=()=>0;
 m.spawns=[{x:0,y:0,z:-5},{x:8,y:0,z:-5}]; // A: closer + covered, B: farther + exposed
 const [a,enemy]=m.actors;
 Object.assign(a,{vehicleId:null,health:100,team:undefined});
 Object.assign(enemy,{x:0,y:0,z:5,health:100,team:undefined});
 return {m,a,enemy};
}
const near=(a,x,z)=>Math.hypot(a.x-x,a.z-z);

test('a closer covered spawn beats a distant exposed one',()=>{
 const {m,a}=fixture();
 m.spawn(a);
 assert.ok(near(a,0,-5)<.001,`covered spawn chosen (got ${a.x},${a.z})`);
 assert.ok(!m.visible(m.actors[1],{x:0,y:1.2,z:-5}),'the chosen point is out of enemy line of sight');
 assert.ok(m.visible(m.actors[1],{x:8,y:1.2,z:-5}),'the exposed point is in enemy line of sight');
});

test('a nearby teammate does not make a safe spawn undesirable',()=>{
 const {m,a}=fixture();
 const mate=m.actors[1]; // reuse the second actor as a same-team ally
 m.config.mode='teamdeathmatch';m.config.botCount=0;
 m.teamSpawns={0:[[0,-5],[8,-5]],1:[[0,-5],[8,-5]]};
 a.team=0;mate.team=0;mate.x=3;mate.z=-5;mate.health=100;mate.vehicleId=null;
 m.spawn(a);
 assert.ok(near(a,0,-5)<.001,'teammate proximity keeps the covered spawn attractive');
 // Overlapping the ally is what gets rejected, not proximity itself.
 mate.x=0;mate.z=-5;
 m.spawn(a);
 assert.ok(near(a,8,-5)<.001,'an overlapping ally forces the other candidate');
});

test('recently lethal ground is penalized through the decaying heatmap',()=>{
 const {m,a,enemy}=fixture();
 // No enemies: only the heatmap separates the two otherwise-equal points.
 enemy.health=0;
 for(let i=0;i<5;i++)m._spawnHeatAdd(0,-5);
 const heatNear=m._spawnHeatAt(0,-5),heatFar=m._spawnHeatAt(15,-5);
 assert.ok(heatNear>0&&heatFar===0,'heat is localized to the fatal cell');
 m.spawns=[{x:0,y:0,z:-5},{x:15,y:0,z:-5}];
 m.spawn(a);
 assert.ok(near(a,15,-5)<.001,'spawn avoids the hot area');
 // The same cell is ignored once it has decayed well past the window.
 m.time+=200;
 assert.equal(m._spawnHeatAt(0,-5),0,'stale heat is pruned');
});
