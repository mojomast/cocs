import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAINING_STEPS,createTraining,evaluateTraining,trainingView,skipTraining} from './lattice-training.mjs';

const actors = [{id:0,x:0,z:0},{id:1,x:40,z:0}];
const snapshot = overrides => ({actors, nodes:[], ...overrides});
const drive = (training, events = [], snap = snapshot()) => evaluateTraining(training, {snapshot:snap, events, playerId:0, lattice:[['hq-0','front-0'],['front-0','relay-0']]});

test('training exists only for LATTICE modes and never mutates its inputs',()=>{
 assert.equal(createTraining('deathmatch'),null);
 assert.equal(createTraining(null),null);
 const training=createTraining('cocs',{start:{x:0,z:0}});
 const frozen=JSON.stringify(training);
 const first=drive(training);
 assert.equal(JSON.stringify(training),frozen,'input state is untouched');
 assert.equal(first.training.index,0,'no step completes without input');
 assert.match(trainingView(training).title,/FIELD TRAINING/);
 assert.equal(trainingView(null),null);
});

test('a synthetic cocs course advances in authored order to completion',()=>{
 let training=createTraining('cocs',{start:{x:0,z:0}});
 assert.equal(TRAINING_STEPS.cocs[0].id,'move');
 // MOVE OUT from the start anchor.
 training=drive(training,[],snapshot({actors:[{id:0,x:15,z:0}]})).training;
 assert.deepEqual(training.completed,['move']);
 // Five shots, only the local actor's count.
 training=drive(training,[{type:'shot',actor:1},{type:'shot',actor:0}]).training;
 for(let i=0;i<4;i++)training=drive(training,[{type:'shot',actor:0}]).training;
 assert.deepEqual(training.completed,['move','fire']);
 // Capture the front and claim the connected link.
 training=drive(training,[{type:'cocs-capture',team:1,node:'front-0'}]).training;
 assert.deepEqual(training.completed,['move','fire'],'enemy captures do not teach the player');
 training=drive(training,[{type:'cocs-capture',team:0,node:'front-0'}]).training;
 const linked=snapshot({nodes:[{id:'hq-0',owner:0,archetype:'hq'},{id:'front-0',owner:0,archetype:'front'}]});
 training=drive(training,[],linked).training;
 assert.deepEqual(training.completed,['move','fire','capture','connect']);
 // An order, a device and a depot finish the course.
 training=drive(training,[{type:'cocs-order',team:0,verb:'ATTACK'}]).training;
 training=drive(training,[{type:'cocs-device-use',actor:0,kind:'zipline'}]).training;
 const finished=drive(training,[{type:'cocs-depot-capture',team:0,depot:'depot-0'}]);
 assert.equal(finished.training.done,true);
 assert.deepEqual(finished.training.completed,['move','fire','capture','connect','order','device','depot']);
 assert.equal(finished.completedNow.id,'depot');
 const view=trainingView(finished.training);
 assert.equal(view.done,true);assert.equal(view.step,null);assert.equal(view.progress,1);
});

test('an owned node cut from HQ does not complete the supply step',()=>{
 let training=createTraining('cocs',{start:{x:0,z:0}});
 training=drive(training,[],snapshot({actors:[{id:0,x:15,z:0}]})).training;
 training=drive(training,[{type:'shot',actor:0},{type:'shot',actor:0},{type:'shot',actor:0},{type:'shot',actor:0},{type:'shot',actor:0}]).training;
 training=drive(training,[{type:'cocs-capture',team:0,node:'front-0'}]).training;
 const orphaned=snapshot({nodes:[{id:'hq-0',owner:0,archetype:'hq'},{id:'front-0',owner:1,archetype:'front'},{id:'relay-0',owner:0,archetype:'relay'}]});
 const held=drive(training,[],orphaned).training;
 assert.ok(!held.completed.includes('connect'),'a relay with no owned link home is not enough');
 const linked=snapshot({nodes:[{id:'hq-0',owner:0,archetype:'hq'},{id:'front-0',owner:0,archetype:'front'}]});
 assert.ok(drive(held,[],linked).training.completed.includes('connect'));
});

test('the operations course teaches spend, terminals and waves',()=>{
 let training=createTraining('cocs-coop',{start:{x:0,z:0}});
 training=drive(training,[],snapshot({actors:[{id:0,x:15,z:0}]})).training;
 training=drive(training,Array.from({length:5},()=>({type:'shot',actor:0}))).training;
 training=drive(training,[{type:'cocs-capture',team:0,node:'front-0'}]).training;
 const linked=snapshot({nodes:[{id:'hq-0',owner:0,archetype:'hq'},{id:'front-0',owner:0,archetype:'front'}]});
 training=drive(training,[],linked).training;
 training=drive(training,[{type:'coop-spend',verb:'FORTIFY',cost:30}]).training;
 assert.ok(training.completed.includes('spend'));
 training=drive(training,[{type:'cocs-order',team:0,verb:'HOLD'}]).training;
 training=drive(training,[{type:'cocs-terminal-hack',team:0,terminal:'term-0'}]).training;
 assert.ok(training.completed.includes('terminal'));
 const finished=drive(training,[{type:'director-wave-cleared',wave:1}]);
 assert.ok(finished.training.completed.includes('wave'));
 assert.ok(!finished.training.done,'the device step remains after the wave');
 assert.ok(TRAINING_STEPS['cocs-coop'].some(entry=>entry.id==='device'));
});

test('skipping is honored and idempotent',()=>{
 const training=createTraining('cocs',{start:{x:0,z:0}});
 const skipped=skipTraining(training);
 assert.equal(skipped.done,true);assert.equal(skipped.skipped,true);
 assert.equal(skipTraining(skipped),skipped,'an ended course is not rewritten');
 assert.equal(trainingView(skipped).done,true);
});
