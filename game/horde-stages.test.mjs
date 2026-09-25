import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,obstructed} from './core.mjs';
import {updateSinglePlayer,singlePlayerSnapshot,hordeWavePlan} from './singleplayer.mjs';
import {validateHordeStagePlan} from './horde-stages.mjs';

// Controlled source fixtures, deliberately not evidence of natural combat wins.
const arena=()=>({id:'stage-fixture',name:'Stage fixture',bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20},blocks:[],spawns:[[-8,8],[8,8]],pickups:[],navNodes:[],raised:false,hordeStagePlan:{version:1,initialStage:'B',stages:['B','C','D'].map((id,i)=>({id,arrival:{minX:-2,maxX:2,minZ:8-i*8,maxZ:10-i*8},humanSpawns:[[-8,8-i*8],[8,8-i*8]],enemySpawns:[[-12,8-i*8],[12,8-i*8],[-12,10-i*8],[12,10-i*8]]})),gates:[{id:'BC',x:0,z:4,w:12,d:1,h:5,baseY:0,material:'accent'},{id:'CD',x:0,z:-4,w:12,d:1,h:5,baseY:0,material:'accent'}],transitions:[{afterWave:2,from:'B',to:'C',open:['BC'],close:[]},{afterWave:5,from:'C',to:'D',open:['CD'],close:['BC']}]}});
const make=(target=10,a=arena())=>new Match('chatgpt','openclaw',()=>.5,'exchange',{mode:'horde',difficulty:'normal',botCount:0,fragLimit:target,timeLimit:1800,hordeArena:a});
const tick=(m,n=1)=>{for(let i=0;i<n;i++)updateSinglePlayer(m,1/60);};
const clear=(m,w)=>{m.modeState.wave=w;m.modeState.phase='wave';m.modeState.enemies=[];tick(m);};
const arrive=(m,stage)=>{const r=m.arena.hordeStagePlan.stages.find(s=>s.id===stage).arrival;Object.assign(m.actors[0],{x:0,z:(r.minZ+r.maxZ)/2,y:0,grounded:true});};

test('clear causal chain, exact warning, arrival hold, subsequent wave and gates/rays',()=>{
 const m=make();clear(m,2);const s=m.modeState.stage,t=s.transit;
 assert.equal(m.events.find(e=>e.id===t.causeEventId).type,'horde-wave-cleared');
 assert.equal(m.events.filter(e=>e.type==='horde-transit-begin').length,1);
 assert(obstructed(0,0,4,.5,m.arena));assert(m.rayWorld({x:0,y:2,z:8},{x:0,y:0,z:-1},8)<8);
 tick(m,179);assert.equal(s.gateMask,0);tick(m);assert.equal(s.gateMask,1);
 assert(!obstructed(0,0,4,.5,m.arena));assert.equal(m.rayWorld({x:0,y:2,z:8},{x:0,y:0,z:-1},8),8);
 tick(m,180);assert.equal(m.modeState.wave,2);arrive(m,'C');tick(m,29);assert(s.transit);tick(m);assert.equal(s.transit,null);assert.equal(m.modeState.wave,2);
 tick(m);assert.equal(m.modeState.wave,3);assert.equal(s.stageId,'C');assert.deepEqual(m.teamSpawns[1],m.arena.hordeStagePlan.stages[1].enemySpawns);
});
test('fallback opens routes but never waives living grounded arrival',()=>{
 const m=make();clear(m,2);tick(m,2400);assert.equal(m.modeState.stage.gateMask,3);assert(m.modeState.stage.transit.fallback);assert.equal(m.modeState.wave,2);
 arrive(m,'C');m.actors[0].grounded=false;tick(m,40);assert.equal(m.modeState.stage.transit.arrivalTicks,0);
 m.actors[0].grounded=true;m.actors[0].health=0;tick(m,40);assert(m.modeState.stage.transit);
 m.actors[0].health=100;tick(m,30);assert.equal(m.modeState.stage.stageId,'C');
});
test('closure defers for actors/projectiles/deployables and cancels without damage',()=>{
 for(const kind of ['actor','rocket','deployable']){
  const m=make();clear(m,2);arrive(m,'C');tick(m,302);clear(m,5);arrive(m,'D');tick(m,302);
  assert(m.modeState.stage.closure);
  if(kind==='actor')Object.assign(m.actors[0],{x:0,y:0,z:4});
  if(kind==='rocket')m.rockets.push({pos:{x:0,y:2,z:4}});
  if(kind==='deployable')m.deployables.push({x:0,y:0,z:4,health:100,life:30});
  // Prevent combat fixture from spawning while testing the independent closure.
  m.modeState.timer=100;tick(m,180);assert.equal(m.modeState.stage.gateMask,3);
  tick(m,420);assert.equal(m.modeState.stage.closure,null);assert.equal(m.modeState.stage.gateMask,3);
  assert(m.events.some(e=>e.type==='horde-gate-held-open'));
 }
});
test('unoccupied closure changes source collision and clears cached bot routes',()=>{
 const m=make();clear(m,2);arrive(m,'C');tick(m,302);clear(m,5);arrive(m,'D');tick(m,302);m.modeState.timer=100;tick(m,180);
 assert.equal(m.modeState.stage.gateMask,2);assert(obstructed(0,0,4,.5,m.arena));
});
test('target victory, clock and last life outrank transitions; restart is independent',()=>{
 for(const target of [1,2,5,10,30]){const m=make(target);clear(m,target);assert(m.over);assert.equal(m.modeState.stage.transit,null);}
 for(const end of ['death','clock']){const m=make();clear(m,2);if(end==='death'){m.modeState.lives=1;m.actors[0].deaths++;m.actors[0].health=0;}else m.time=m.config.timeLimit;tick(m,300);assert(m.over);assert.equal(m.modeState.stage.gateMask,0);}
 const base=arena(),m=make(10,base);clear(m,2);tick(m,2400);const next=make(10,base);assert.equal(next.modeState.stage.gateMask,0);assert.equal(base.blocks.length,0);assert.equal(next.modeState.lives,3);
 const snap=singlePlayerSnapshot(m.modeState,m);snap.stage.gateMask=0;assert.equal(m.modeState.stage.gateMask,3);
});
test('strict negative plan validation and mode refusal',()=>{
 for(const mutate of [a=>a.hordeStagePlan.stages.push(a.hordeStagePlan.stages[0]),a=>a.hordeStagePlan.transitions[0].open=['missing'],a=>a.hordeStagePlan.transitions[1].afterWave=2,a=>a.hordeStagePlan.stages[0].arrival.maxX=-100,a=>a.hordeStagePlan.gates[0].w=0,a=>a.hordeStagePlan.transitions[0].teleport=true,a=>a.hordeStagePlan.initialStage='E',a=>a.hordeStagePlan.stages[0].humanSpawns=[[NaN,0]]]){const a=arena();mutate(a);assert.throws(()=>validateHordeStagePlan(a.hordeStagePlan,a));}
 assert.throws(()=>new Match('chatgpt','openclaw',()=>.5,'exchange',{mode:'deathmatch',hordeArena:arena()}));
 assert.throws(()=>new Match('chatgpt','openclaw',()=>.5,'exchange',{mode:'horde',endless:true,hordeArena:arena()}));
 for(const wave of [9,18,27])assert(hordeWavePlan(wave,'normal').counts.boss);
});
