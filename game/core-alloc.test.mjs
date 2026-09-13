import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,moveActor,traversalTables} from './core.mjs';
import {stepAssault,assaultTemplate,assignAssaultTeams} from './assault.mjs';

const arena={id:'alloc-kit',raised:false,bounds:{minX:-30,maxX:30,minZ:-20,maxZ:20},blocks:[{kind:'cover',x:0,z:0,w:1,d:40,h:6}],spawns:[[-20,0],[20,0]],pickups:[],traversal:{jumpPads:[{id:'jump',x:8,z:8,power:17}],boostLaunchers:[{id:'launch',x:3,z:0,dir:[1,0],power:16,cooldown:2}],teleporters:[{id:'gate',x:-15,z:0,to:{x:15,y:0,z:0}}],ziplines:[{id:'zip',from:{x:-15,y:0,z:10},to:{x:15,y:2,z:10},speed:20}]}};
const actor=(values={})=>Object.assign({x:0,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,coyote:0,jumpBuffer:0,moveSpeed:8,character:'chatgpt',traversalCooldown:0,traversalPad:null,vehicleId:null,baseHeight:1.8,zipRide:null},values);

test('moveActor reuses one derived traversal table per arena',()=>{
 const first=traversalTables(arena),second=traversalTables(arena);
 assert.equal(first,second);
 assert.equal(first.pads,second.pads);
 assert.equal(first.teleporters,second.teleporters);
 assert.equal(first.ziplines,second.ziplines);
 const a=actor({x:8,z:8,y:0});
 moveActor(a,{},1/60,arena,{speed:1,gravity:1});
 moveActor(a,{},1/60,arena,{speed:1,gravity:1});
 assert.equal(traversalTables(arena),first);
});

test('objective scratch buffers are reused across ticks',()=>{
 const m=new Match('chatgpt','openclaw',()=>.5,'crosswire',{mode:'koth',botCount:0});
 m.updateObjectives(1/60);
 const scratch=m.objectiveState._zoneScratch;
 assert.ok(scratch&&Array.isArray(scratch.inside),'objective scratch created');
 m.updateObjectives(1/60);
 assert.equal(m.objectiveState._zoneScratch,scratch);
 assert.equal(m.objectiveState._zoneScratch.inside,scratch.inside);
});

test('assault reuses the captured list until ownership changes',()=>{
 const state=assaultTemplate({id:'alloc-kit',bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},blocks:[],navNodes:[]});
 assignAssaultTeams(state);
 const active=state.sectors[0],attacker={team:0,health:100,x:active.x,z:active.z};
 const first=stepAssault(state,[attacker],1/60,{});
 const second=stepAssault(state,[attacker],1/60,{});
 assert.equal(second.captured,first.captured);
 assert.deepEqual(second.captured,[]);
});
