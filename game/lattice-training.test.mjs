import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {TRAINING_STEPS,createTraining,evaluateTraining,continueTraining,trainingView,trainingControls,skipTraining,trainingConfig} from './lattice-training.mjs';

const lattice = [['hq-0','front-0'],['front-0','relay-0']];
const nodes = [
 {id:'hq-0',owner:0,archetype:'hq',x:0,z:0},
 {id:'front-0',owner:0,archetype:'front',x:20,z:0,progress:[0,0]},
 {id:'relay-0',owner:null,archetype:'relay',x:40,z:0},
];
const depot = {id:'depot-0',owner:0,hq:false,x:20,z:0};
const snapshot = (time=1, overrides={}) => ({time,actors:[{id:0,team:0,health:100,x:20,z:0}],cocs:{nodes,traversal:{depots:[depot]}},...overrides});
const drive = (training, events=[], snap=snapshot(training.lastTime+1)) => evaluateTraining(training,{snapshot:snap,events,playerId:0,lattice});
const at = (id, mode='cocs') => {
 const index=TRAINING_STEPS[mode].findIndex(step=>step.id===id);
 return {...createTraining(mode,{start:{x:0,z:0}}),index,completed:TRAINING_STEPS[mode].slice(0,index).map(step=>step.id)};
};
const shots = (extra={}) => Array.from({length:5},()=>({type:'shot',actor:0,...extra}));
const hold = (training, snap=snapshot()) => {
 training=drive(training,[],snap).training;
 return drive(training,[],{...snap,time:snap.time+3});
};

test('training exists only for LATTICE, stays pure, and exposes current goal and next lesson',()=>{
 assert.equal(createTraining('deathmatch'),null);
 assert.equal(createTraining(null),null);
 const training=createTraining('cocs',{start:{x:0,z:0}}), before=JSON.stringify(training);
 const view=trainingView(training);
 assert.equal(view.step.id,'move');assert.equal(view.next.id,'fire');
 assert.deepEqual(view.goal,{value:0,target:12,label:'m from start',ratio:0});
 drive(training);assert.equal(JSON.stringify(training),before);
 assert.equal(trainingView(null),null);
 assert.equal(continueTraining(training),training,'an unfinished lesson cannot be advanced');
});

test('one event batch cannot clear multiple lessons; completion waits indefinitely for acknowledgement',()=>{
 let training=createTraining('cocs',{start:{x:0,z:0}});
 const result=drive(training,[...shots(),{type:'cocs-capture',team:0,node:'front-0',participants:[0]},{type:'cocs-order',team:0}]);
 training=result.training;
 assert.equal(result.completedNow.id,'move');assert.equal(training.index,0);
 assert.deepEqual(training.completed,['move']);assert.equal(training.phase,'complete');
 const frozen=JSON.stringify(training);
 training=drive(training,shots(),snapshot(500)).training;
 assert.equal(training.phase,'complete');assert.equal(training.index,0);
 assert.equal(trainingView(training).step.id,'move');assert.equal(trainingView(training).next.id,'fire');
 assert.equal(JSON.stringify(result.training),frozen);
 training=continueTraining(training);
 assert.equal(training.index,1);assert.equal(training.phase,'active');assert.deepEqual(training.counts,{});
 training=drive(training).training;
 assert.equal(training.completed.length,1,'early shots did not spill into live fire');
 assert.equal(trainingView(training).goal.value,0);
});

test('only fresh local evidence counts; teammate actions and duplicate or pre-lesson events do not',()=>{
 let training=at('fire');
 training=drive(training,[...shots({actor:1,team:0}),{type:'shot',team:0},{type:'shot',actor:0,id:10,time:1}]).training;
 assert.equal(training.counts.fire,1);
 training=drive(training,[{type:'shot',actor:0,id:10,time:1}]).training;
 assert.equal(training.counts.fire,1,'replaying the event is not another shot');
 training=drive(training,shots()).training;
 assert.equal(training.phase,'complete');
 training=continueTraining(training,{time:20});
 training=drive(training,[{id:11,time:19,type:'cocs-capture',team:0,node:'front-0',participants:[0]}],snapshot(21,{actors:[]})).training;
 assert.equal(training.phase,'active','delayed pre-lesson capture is stale');
 const deviceTraining=drive(at('device'),[{type:'cocs-device-use',actor:1,team:0}]).training;
 assert.equal(deviceTraining.phase,'active');
 assert.equal(drive(at('order'),[{type:'cocs-order',team:0,peerId:'bot-0'}]).training.phase,'active');
 assert.equal(drive(at('order'),[{type:'cocs-order-rejected',team:0,peerId:'0'}]).training.phase,'active');
});

test('the full courses require each authored lesson and explicit final acknowledgement',()=>{
 for(const mode of ['cocs','cocs-coop']){
  let training=createTraining(mode,{start:{x:0,z:0}});
  const evidence={fire:shots(),capture:[{type:'cocs-capture',team:0,node:'front-0',participants:[0]}],
   order:[{type:'cocs-order',team:0,peerId:'0'}],device:[{type:'cocs-device-use',actor:0}],
   depot:[{type:'cocs-depot-capture',team:0,depot:'depot-0'}],spend:[{type:'coop-spend'}],
   terminal:[{type:'cocs-terminal-hack',team:0,terminal:'terminal-0'}],wave:[{type:'director-wave-cleared'}]};
  for(const lesson of TRAINING_STEPS[mode]){
   if(lesson.id==='terminal')training=drive(training,[],snapshot(training.lastTime+1,{cocs:{nodes,terminalState:{terminals:[{id:'terminal-0',channel:{actor:0,action:'HACK'}}]}}})).training;
   const result=lesson.id==='connect'?hold(training,snapshot(training.lastTime+1)):drive(training,evidence[lesson.id]??[]);
   assert.equal(result.completedNow?.id,lesson.id,`${mode}: ${lesson.id}`);
   training=result.training;
   assert.equal(training.phase,'complete');assert.equal(training.done,false);
   assert.equal(trainingView(training).step.id,lesson.id,'completed instruction is retained');
   training=continueTraining(training);
  }
  assert.equal(training.done,true);assert.equal(training.phase,'done');
  assert.deepEqual(training.completed,TRAINING_STEPS[mode].map(step=>step.id));
  const view=trainingView(training);assert.equal(view.step,null);assert.equal(view.next,null);assert.equal(view.progress,1);
  assert.equal(continueTraining(training),training);
 }
});

test('supply uses nested real snapshot nodes and requires a fresh uninterrupted three-second hold',()=>{
 let training=at('connect');
 const disconnected=snapshot(1,{cocs:{nodes:[nodes[0],{...nodes[1],owner:1},{...nodes[2],owner:0}]}});
 assert.equal(hold(training,disconnected).training.phase,'active');
 const arrayOnly=snapshot(1,{cocs:{nodes:[nodes[0],{...nodes[1],archetype:'array'}]}});
 assert.equal(hold(training,arrayOnly).training.phase,'active','HQ plus array is not a supplied objective');
 training=drive(training,[],snapshot(10)).training;
 assert.equal(trainingView(training).goal.value,0,'existing ownership earns no earlier time');
 training=drive(training,[],snapshot(12)).training;
 assert.equal(trainingView(training).goal.value,2);assert.equal(training.phase,'active');
 training=drive(training,[],{...disconnected,time:13}).training;
 assert.equal(trainingView(training).goal.value,0,'broken link resets the hold');
 training=drive(training,[],snapshot(14)).training;
 training=drive(training,[],snapshot(14)).training;
 assert.equal(training.hold,0,'paused simulation does not advance a hold');
 training=drive(training,[],snapshot(17)).training;
 assert.equal(training.phase,'complete');
});

test('pre-owned front can be learned by a local defence; remote, dead and contested holds do not count',()=>{
 const training=at('capture');
 assert.equal(hold(training).training.phase,'complete','no forced recapture after a teammate took the front');
 for(const snap of [snapshot(1,{actors:[]}),snapshot(1,{actors:[{id:1,health:100,x:20,z:0}]}),snapshot(1,{actors:[{id:0,health:0,x:20,z:0}]}),snapshot(1,{cocs:{nodes:[nodes[0],{...nodes[1],contested:true}]}})]){
  assert.equal(hold(training,snap).training.phase,'active');
 }
 const neutral=snapshot(1,{actors:[{id:0,health:100,x:0,z:0}],cocs:{nodes:[nodes[0],{...nodes[1],owner:null,progress:[.6,0]}]}});
 const result=drive(training,[{type:'cocs-capture',team:0,node:'front-0',participants:[1]}],neutral);
 assert.equal(result.training.phase,'active');assert.equal(trainingView(result.training).goal.value,60);
 assert.equal(drive(training,[{type:'cocs-capture',team:1,node:'front-0',participants:[0]}],neutral).training.phase,'active');
});

test('depot requires local presence at a non-HQ apron, and supports defending one already captured',()=>{
 const training=at('depot'), event={type:'cocs-depot-capture',team:0,depot:'depot-0'};
 const remote=snapshot(1,{actors:[{id:0,team:0,health:100,x:80,z:0}]});
 assert.equal(drive(training,[event],remote).training.phase,'active');
 assert.equal(hold(training).training.phase,'complete');
 const hq=snapshot(1,{cocs:{nodes,traversal:{depots:[{...depot,hq:true}]}}});
 assert.equal(hold(training,hq).training.phase,'active');
});

test('movement never falls back to a different actor or invalid coordinates',()=>{
 const training=createTraining('cocs',{start:{x:0,z:0}});
 for(const actors of [[{id:1,x:100,z:0,health:100}],[{id:0,x:NaN,z:0,health:100}],[{id:0,x:100,z:0,health:0}]]){
  assert.equal(drive(training,[],snapshot(1,{actors})).training.phase,'active');
 }
 const partial=drive(training,[],snapshot(1,{actors:[{id:0,x:6,z:0,health:100}]})).training;
 assert.equal(trainingView(partial).goal.value,6);assert.equal(trainingView(partial).goal.ratio,.5);
});

test('instructions resolve remapped controls, distinguish firing from hits and terminal start from completion',()=>{
 assert.match(trainingControls('move',{forward:'ArrowUp',sprint:'ShiftRight'}),/Up.*Right Shift/);
 assert.match(trainingControls('fire',{reload:'KeyL'}),/L reload/);
 assert.match(trainingControls('order',{commandScan:'KeyY',commandGo:'KeyJ',commandAttack:'KeyO'}),/Y SCAN \/ J GO \/ O ATTACK → 1–9 target → Enter/);
 assert.match(trainingControls('device',{interact:'KeyI'}),/I interact.*RIDE/);
 assert.match(trainingControls('spend'),/While spend window is open: 1–4/);
 assert.match(TRAINING_STEPS.cocs[1].detail,/Hits are optional/);
 assert.equal(drive(at('terminal','cocs-coop'),[{type:'cocs-terminal-start',team:0}]).training.phase,'active');
 assert.equal(drive(at('terminal','cocs-coop'),[{type:'cocs-terminal-hack',team:1}]).training.phase,'active');
});

test('terminal effects must follow a locally observed channel, not an unrelated bot channel',()=>{
 const training=at('terminal','cocs-coop'), event={type:'cocs-terminal-hack',team:0,terminal:'terminal-0'};
 assert.equal(drive(training,[event]).training.phase,'active','team-wide completion alone is not local practice');
 const channelSnap=actor=>snapshot(1,{cocs:{nodes,terminalState:{terminals:[{id:'terminal-0',channel:{actor,action:'HACK'}}]}}});
 const bot=drive(training,[],channelSnap(1)).training;
 assert.equal(drive(bot,[event]).training.phase,'active');
 const local=drive(training,[],channelSnap(0)).training;
 assert.equal(drive(local,[event]).training.phase,'complete');
 const interrupted=drive(local).training;
 assert.equal(drive(interrupted,[event]).training.phase,'active','a canceled local channel cannot credit a later bot completion');
});

test('practice preset does not inherit saved mutators, weapons, objectives or difficulty',()=>{
 for(const mode of ['cocs','cocs-coop']){
  const config=trainingConfig(mode,{playerName:'Learner',oneShot:true,mutators:['instagib'],speed:1.5,damage:2,startingWeapon:9,rung:'8v8',timeLimit:60,difficulty:'nightmare'});
  assert.equal(config.mode,mode);assert.equal(config.playerName,'Learner');
  assert.equal(config.oneShot,false);assert.equal(config.instagib,false);assert.equal(config.speed,1);assert.equal(config.damage,1);
  assert.equal(config.startingWeapon,0);assert.equal(config.difficulty,'easy');assert.equal(config.timeLimit,900);
  assert.equal(config.botCount,mode==='cocs'?3:1);assert.notEqual(config.rung,'8v8');
 }
});

test('skipping is honest, honored and idempotent',()=>{
 const training=at('fire'), skipped=skipTraining(training);
 assert.equal(skipped.done,true);assert.equal(skipped.skipped,true);assert.equal(skipped.phase,'skipped');
 assert.equal(skipTraining(skipped),skipped);assert.equal(continueTraining(skipped),skipped);
 assert.equal(drive(skipped,shots()).training,skipped);
 assert.equal(trainingView(skipped).progress,1/7,'skipping does not claim all lessons complete');
 assert.equal(createTraining('cocs',{skipped:true}).done,true);
});

test('a real Match drives movement, live fire, and the nested supply snapshot',()=>{
 const match=new Match('chatgpt','openclaw',()=>.5,'lattice-slice',{mode:'cocs',botCount:3,humanCount:1,timeLimit:300,cocsPolicy:()=>[]});
 const actor=match.actors[0];
 let training=createTraining('cocs',{start:{x:actor.x,z:actor.z}});
 const evaluate=()=>{training=evaluateTraining(training,{snapshot:match.snapshot(),events:match.events,playerId:0,lattice:match.arena.lattice}).training;};
 for(let i=0;i<60*30&&training.phase==='active';i++){match.step(1/60,{x:1,z:0});evaluate();}
 assert.equal(training.phase,'complete');assert.equal(training.completed[0],'move');
 training=continueTraining(training,{time:match.time});
 for(let i=0;i<60*4&&training.phase==='active';i++){match.step(1/60,{fire:true,fireTap:true});evaluate();}
 assert.equal(training.phase,'complete');assert.equal(training.completed[1],'fire');
 const snap=match.snapshot();
 assert.ok(snap.cocs.nodes.length);assert.equal(snap.nodes,undefined);
 const front=match.objectiveState.nodes.find(node=>node.archetype==='front'&&match.arena.lattice.some(([a,b])=>a===node.id&&b==='hq-0'||b===node.id&&a==='hq-0'));
 assert.ok(front,'authored front exists');front.owner=0;
 training=at('connect');
 training=evaluateTraining(training,{snapshot:match.snapshot(),lattice:match.arena.lattice}).training;
 const later={...match.snapshot(),time:match.time+3};
 training=evaluateTraining(training,{snapshot:later,lattice:match.arena.lattice}).training;
 assert.equal(training.phase,'complete','supply reads Match.snapshot().cocs.nodes');
});
