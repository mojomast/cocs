import test from 'node:test';
import assert from 'node:assert/strict';
import {SynthAudio,RemoteStepPlanner,REMOTE_FOLEY,crowdLevel,EVENT_CUES,ANNOUNCE_CUES,ANNOUNCE_CADENCE} from './feedback.mjs';

// Wave-5 audio coverage: remote movement foley, the result beat (announcer +
// record sting), crowd ambience, the holdout/payload/flag cue rows and the
// SynthAudio.menuTab forward. Every test drives the real production methods
// through a deterministic Web Audio mock: no wall clock, no randomness.

const player={id:7,weapon:0,x:0,z:0,yaw:0,grounded:true,health:100,maxHealth:100,vx:0,vy:0,vz:0};

// Minimal context whose AudioParams record their last eased target, with the
// node factories the ambience bed, engine and foley paths need.
function contextMock(){
 const nodes=[];
 const param=(value=0)=>({value,target:undefined,setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.value=v;},setTargetAtTime(v){this.target=v;},cancelScheduledValues(){}});
 const node=extra=>{const n={frequency:param(),gain:param(),Q:param(),pan:param(),type:'',buffer:null,loop:false,connect(to){this.to=to;},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;},...extra};nodes.push(n);return n;};
 const ctx={currentTime:0,state:'running',sampleRate:44100,destination:{},nodes,
  createOscillator:()=>node({type:'sine'}),createGain:()=>node(),
  createBufferSource:()=>node({}),createBiquadFilter:()=>node({type:'lowpass'}),createStereoPanner:()=>node(),
  createBuffer:(ch,len)=>({getChannelData:()=>new Float32Array(len)}),
  resume(){this.state='running';return Promise.resolve();},close(){this.closed=true;}};
 return ctx;
}
function audioFixture(){
 const ctx=contextMock();
 const audio=new SynthAudio();
 audio.ctx=ctx;audio.noiseBuffer={};
 return {audio,ctx,nodes:ctx.nodes};
}

// ---------------------------------------------------------------------------
// Remote movement foley
// ---------------------------------------------------------------------------

test('remote step planning is frame-rate independent and deterministic',()=>{
 const actor={id:3,x:0,z:0,vx:6,vz:0,vy:0,grounded:true,health:100};
 const run=(frames,step)=>{
  const planner=new RemoteStepPlanner(),listener={x:0,z:0,yaw:0};
  const events=[];let time=0;
  for(let i=0;i<frames;i++){
   time+=step;
   for(const plan of planner.plan([actor],{time,dt:step,listener,localId:0}))events.push(plan);
  }
  return events;
 };
 const smooth=run(120,1/60),coarse=run(60,1/30);
 assert.ok(smooth.length>8,'a 2 s run at 6 m/s produces steps');
 assert.equal(smooth.length,coarse.length,'a 30 Hz host produces the same cadence as a 60 Hz one');
 assert.deepEqual(smooth,coarse,'the whole plan is frame-rate independent');
 assert.deepEqual(run(120,1/60),smooth,'the same dt sequence replays identically');
 for(const plan of smooth){
  assert.equal(plan.id,3);
  assert.equal(plan.kind,'step');
  assert.ok(Number.isFinite(plan.seed)&&plan.seed>=0);
  assert.ok(plan.variant>=0&&plan.variant<3);
 }
});

test('remote steps are gated, capped at two per frame and floored per actor',()=>{
 const listener={x:0,z:0,yaw:0};
 const cap=new RemoteStepPlanner();
 const crowd=[0,1,2,3].map(id=>({id,x:id*2,z:0,vx:6,vz:0,vy:0,grounded:true,health:100}));
 assert.deepEqual(cap.plan(crowd,{time:0,dt:1/60,listener,localId:99}),[],'the first sighting only seeds state');
 cap.plan(crowd,{time:.2,dt:.2,listener,localId:99});
 const burst=cap.plan(crowd,{time:.4,dt:.2,listener,localId:99});
 assert.equal(burst.length,REMOTE_FOLEY.maxSteps,'at most two remote steps leave one frame');
 assert.equal(burst.length,2);
 // The per-actor cadence floor drops a second crossing inside ~0.12 s.
 const cadence=new RemoteStepPlanner();
 const state=cadence._state(7);
 state.phase=Math.PI-.05;state.lastTime=0;
 const first=cadence.plan([{id:7,x:0,z:0,vx:6,vz:0,vy:0,grounded:true,health:100}],{time:.01,dt:.01,listener});
 assert.equal(first.length,1,'the crossing emits');
 state.phase=Math.PI*2-.05;
 const second=cadence.plan([{id:7,x:0,z:0,vx:6,vz:0,vy:0,grounded:true,health:100}],{time:.06,dt:.05,listener});
 assert.equal(second.length,0,'a crossing inside the per-actor cadence window is dropped');
 // Skip rules: local, dead, mounted and position-less actors never plan.
 const skip=new RemoteStepPlanner();
 const moving={id:4,x:0,z:0,vx:6,vz:0,vy:0,grounded:true,health:100};
 assert.deepEqual(skip.plan(null,{time:1,dt:.1,listener}),[]);
 assert.deepEqual(skip.plan([{...moving,id:7}],{time:1,dt:.1,listener,localId:7}),[]);
 assert.deepEqual(skip.plan([{...moving,id:1,health:0}],{time:1,dt:.1,listener}),[]);
 assert.deepEqual(skip.plan([{...moving,id:2,vehicleId:'puma-1'}],{time:1,dt:.1,listener}),[]);
 assert.deepEqual(skip.plan([{...moving,id:3,x:NaN}],{time:1,dt:.1,listener}),[]);
 // State stays bounded and evicts the oldest actor first.
 const bounded=new RemoteStepPlanner({cap:4});
 for(let i=0;i<10;i++)bounded.plan([{...moving,id:i}],{time:i,dt:.1,listener});
 assert.equal(bounded.states.size,4);
 assert.equal(bounded.states.has(0),false,'the oldest actor is evicted');
 assert.equal(bounded.states.has(9),true,'the newest actor is retained');
});

test('remote steps are panned, attenuated with a 20 m gate and never priority',()=>{
 const listener={x:0,z:0,yaw:0};
 const planner=new RemoteStepPlanner();
 const near={id:1,x:6,z:0,vx:6,vz:0,vy:0,grounded:true,health:100};
 const far={id:2,x:60,z:0,vx:6,vz:0,vy:0,grounded:true,health:100};
 planner.plan([near,far],{time:0,dt:1/60,listener});
 planner.plan([near,far],{time:.2,dt:.2,listener});
 const plans=planner.plan([near,far],{time:.4,dt:.2,listener});
 assert.equal(plans.length,1,'the out-of-gate actor is dropped');
 const step=plans[0];
 assert.equal(step.id,1);
 assert.ok(step.pan>.5,'a source to the left of a zero-yaw listener pans left');
 assert.ok(Math.abs(step.vol-(1-6/REMOTE_FOLEY.gate))<1e-9,'distance shapes the level');
 // The SynthAudio dispatch feeds those values straight into the foley and
 // never requests a priority voice.
 const {audio}=audioFixture();
 const seen=[];audio._play=(duration,pan,build,opts)=>{seen.push({duration,pan,priority:opts?.priority===true});};
 const local={...player,id:0};
 const remote={...near};
 const match={time:0,actors:[local,remote]};
 audio.update(local,[],1/60,{match});
 assert.equal(seen.length,0,'the first sighting seeds silently');
 match.time=.3;
 audio.update(local,[],.3,{match});
 assert.equal(seen.length,0,'the first half-stride has not crossed yet');
 match.time=.5;
 audio.update(local,[],.2,{match});
 assert.equal(seen.length,1,'the planned step spends exactly one foley voice');
 assert.ok(seen[0].pan>.5,'the step keeps the planned pan');
 assert.equal(seen[0].priority,false,'remote movement never takes a priority slot');
 match.actors=[local,{...remote,grounded:false,vy:-12}];
 match.time=.6;
 audio.update(local,[],.1,{match});
 assert.equal(seen.length,1,'an airborne actor makes no step');
 match.actors=[local,{...remote,grounded:true,vy:0}];
 match.time=.8;
 audio.update(local,[],.2,{match});
 assert.equal(seen.length,2,'the touchdown adds one landing voice');
 audio.dispose();
});

test('remote foley options never disturb the local variant counters',()=>{
 const {audio}=audioFixture();
 const tones=[],noises=[];
 audio._play=(duration,pan,build)=>build(0,{},[]);
 audio._tone=(t,out,nodes,options)=>tones.push(options);
 audio._noise=(t,out,nodes,options)=>noises.push(options);
 audio._footstep(6,0,null,{pan:.5,vol:.4,seed:9,variant:1});
 assert.equal(audio.stepVariant,0,'an explicit remote variant does not rotate the local counter');
 assert.ok(noises.length>0&&tones.length>0);
 const remoteNoise=noises[0].freq;
 noises.length=tones.length=0;
 audio._footstep(6,0);
 assert.equal(audio.stepVariant,1,'the next local step advances the shared rotation');
 assert.notEqual(noises[0].freq,remoteNoise,'the local step is not the remote variant');
 noises.length=tones.length=0;
 audio._landing(.6,5,null,{vol:.5,variant:2});
 assert.equal(audio.landVariant,0,'an explicit remote landing variant does not rotate the local counter');
 assert.ok(noises.length>0&&tones.length>0);
 audio.dispose();
});

// ---------------------------------------------------------------------------
// Result beat: announcer take and record sting
// ---------------------------------------------------------------------------

test('sting hands the outcome callout to the announcer exactly once per beat',()=>{
 const {audio,ctx}=audioFixture();
 const plays=[];
 audio._play=(duration,pan,build,opts)=>{plays.push({priority:opts?.priority===true});};
 audio.setAnnouncer(true);
 ctx.currentTime=5;
 assert.equal(audio.sting('victory').played,true);
 assert.equal(audio.lastSting,'victory');
 assert.equal(audio.lastCue,'victory','an enabled announcer takes the result callout');
 assert.equal(plays.length,2,'one sting motif plus one announcer take');
 assert.equal(plays[1].priority,true,'the callout keeps its priority slot');
 ctx.currentTime=5.1;
 audio.sting('defeat');
 assert.equal(audio.lastCue,'defeat');
 ctx.currentTime=5.15;
 const before=plays.length;
 audio.sting('defeat');
 assert.equal(audio.lastCue,'defeat');
 assert.equal(plays.length,before+1,'a repeated result inside the cue cooldown reuses the take');
 const off=audioFixture();
 off.audio._play=(duration,pan,build,opts)=>{plays.push({priority:opts?.priority===true});};
 off.ctx.currentTime=5;
 off.audio.sting('victory');
 assert.equal(off.audio.lastCue,null,'announcing stays opt-in');
 audio.dispose();off.audio.dispose();
});

test('recordSting queues one award response and falls back to one bounded motif',()=>{
 const {audio}=audioFixture();
 audio._ensureBuses();
 const requested=[],beats=[];
 audio._beat=(...args)=>beats.push(args);
 const engine=audio.musicEngine,orig=engine.requestResponse.bind(engine);
 engine.requestResponse=(kind,opts)=>{requested.push([kind,opts]);return orig(kind,opts);};
 assert.deepEqual(audio.recordSting(),{played:true,music:true});
 assert.deepEqual(requested,[['award',{vol:1}]],'the music owns the award beat');
 assert.equal(engine.pendingResponses.length,1,'exactly one award response is queued');
 assert.equal(beats.length,0,'no motif is stacked under the response');
 audio.setMusicEnabled(false);
 assert.deepEqual(audio.recordSting(),{played:true,music:false});
 assert.equal(beats.length,1,'with music off one bounded fallback motif keeps the beat');
 audio.dispose();
});

test('noteRecord dedupes one personal best and re-arms on a fresh match',()=>{
 const {audio}=audioFixture();
 const beats=[];audio._beat=(...args)=>beats.push(args);
 const first=audio.noteRecord('speedrun-1');
 assert.equal(first.played,true);
 assert.equal(first.key,'speedrun-1');
 assert.equal(audio.noteRecord('speedrun-1').deduped,true,'the same record never rings twice');
 assert.equal(beats.length,1);
 assert.equal(audio.noteRecord('speedrun-2').played,true);
 assert.equal(beats.length,2,'a new personal best rings again');
 assert.equal(audio.noteRecord().key,'personal-best');
 assert.equal(beats.length,3,'the bare host call uses the default key');
 audio.matchStart();
 assert.equal(audio.noteRecord('speedrun-2').played,true,'a fresh match re-arms the record beat');
 assert.equal(beats.length,4);
 audio.dispose();
});

// ---------------------------------------------------------------------------
// Crowd ambience
// ---------------------------------------------------------------------------

test('crowd level reads nearby vehicles, race progress and soccer phase',()=>{
 assert.equal(crowdLevel(null,player,[]),0);
 assert.equal(crowdLevel({},player,[{id:'v',x:80,z:0}]),0,'a distant vehicle stays out');
 const traffic=crowdLevel({},player,[{id:'v',x:5,z:0}]);
 assert.ok(traffic>0&&traffic<.2,'a nearby vehicle adds a murmur');
 assert.equal(crowdLevel({},player,[{id:'v',x:5,z:0,driver:player.id}]),0,'the local vehicle is engine foley, not crowd');
 const countdown=crowdLevel({race:{phase:'countdown',countdown:3}},player,[]);
 const racing=crowdLevel({race:{phase:'racing',laps:3,racers:[{actorId:0,completedLaps:1}]}},player,[]);
 assert.ok(racing>countdown&&countdown>0,'the race phase and leader progress swell the crowd');
 const leading=crowdLevel({race:{phase:'racing',laps:2,standings:[{actorId:0,completedLaps:2}]}},player,[]);
 const trailing=crowdLevel({race:{phase:'racing',laps:2,standings:[{actorId:0,completedLaps:0}]}},player,[]);
 assert.ok(leading>trailing,'a leader on the last lap is louder');
 const soccer=crowdLevel({soccer:{phase:'playing',goalLimit:5,standings:[{actorId:0,goals:1}]}},player,[]);
 assert.ok(soccer>0,'a soccer snapshot reads through opts.match.soccer');
 const over=crowdLevel({race:{phase:'over'}},player,[]);
 assert.ok(over>0&&over<racing,'the final whistle holds a quiet swell');
});

test('the crowd layer is silent at zero, eased with setCrowd and released with the bed',()=>{
 const {audio}=audioFixture();
 audio._ensureBuses();
 audio._bed(true);
 assert.ok(audio.bed.crowdSrc&&audio.bed.crowdF&&audio.bed.crowdG&&audio.bed.crowdLfo,'the bed owns the crowd layer');
 assert.equal(audio.bed.crowdG.gain.value,.0001,'zero crowd parks the gain at .0001');
 assert.equal(audio.setCrowd(0),0);
 assert.equal(audio.bed.crowdG.gain.target,.0001,'an unchanged zero level makes no new target call');
 audio.setCrowd(1);
 assert.equal(audio.crowdLevel,1);
 const up=audio.bed.crowdG.gain.target;
 assert.ok(up>.0001,'setCrowd eases the layer up');
 audio.setCrowd(.5);
 assert.ok(audio.bed.crowdG.gain.target>0&&audio.bed.crowdG.gain.target<up,'the level eases back down');
 const first=[audio.bed.crowdSrc,audio.bed.crowdF,audio.bed.crowdG,audio.bed.crowdLfo,audio.bed.crowdLfoGain];
 audio.setAmbient(false);
 assert.equal(audio.bed,null,'disabling ambience tears the bed down');
 assert.ok(first.every(n=>n.disconnected===true),'the crowd nodes disconnect with the bed');
 assert.ok(first.every(n=>n.stop===undefined||n.stopped===true),'the crowd sources stop with the bed');
 audio.setAmbient(true);
 const second=[audio.bed.crowdSrc,audio.bed.crowdF,audio.bed.crowdG,audio.bed.crowdLfo,audio.bed.crowdLfoGain];
 audio.dispose();
 assert.ok(second.every(n=>n.disconnected===true),'dispose releases the crowd nodes');
 assert.ok(second.every(n=>n.stop===undefined||n.stopped===true),'dispose stops the crowd sources');
});

// ---------------------------------------------------------------------------
// Cue coverage
// ---------------------------------------------------------------------------

test('holdout/payload/flag beats have cue rows and spend one voice each',()=>{
 for(const type of ['holdout-progress','payload-contest','flag-pass','flag-contest']){
  assert.ok(EVENT_CUES[type],`${type} has an EVENT_CUES row`);
  assert.ok(Object.isFrozen(EVENT_CUES[type])&&Object.isFrozen(EVENT_CUES[type].notes),`${type} is a frozen motif`);
  const {audio}=audioFixture();
  const beats=[];audio._beat=(...args)=>beats.push(args);
  audio.event({type,id:1,time:1,actor:9,x:6,z:0},player);
  assert.equal(beats.length,1,`${type} spends one motif voice`);
  audio.dispose();
 }
 const {audio}=audioFixture();
 const beats=[];audio._beat=(...args)=>beats.push(args);
 audio.event({type:'flag-pass',id:2,time:2,actor:9,x:6,z:0},player);
 assert.equal(beats.length,1,'a remote flag pass is a world beat and stays audible');
 audio.dispose();
});

test('contest and pass rows announce through the cadence-guarded announcer',()=>{
 const {audio,ctx}=audioFixture();
 const plays=[];audio._play=(duration,pan,build,opts)=>{plays.push({priority:opts?.priority===true});};
 for(const row of ['payload-contest','flag-pass','flag-contest']){
  assert.ok(ANNOUNCE_CUES[row],`${row} has an ANNOUNCE_CUES row`);
 }
 audio.setAnnouncer(true);
 ctx.currentTime=10;
 assert.equal(audio.announcerEvent('flag-contest').played,true);
 assert.equal(audio.lastCue,'flag-contest');
 assert.equal(plays.length,1,'one callout is one voice');
 const blocked=audio.announcerEvent('payload-contest');
 assert.equal(blocked.played,false);
 assert.equal(blocked.cadence,true,'the global cadence guard keeps a cluster to one callout');
 ctx.currentTime=10+ANNOUNCE_CADENCE;
 assert.equal(audio.announcerEvent('payload-contest').played,true,'the cadence window releases');
 // The event stream dispatches the contest/pass world beats, but the repeating
 // holdout progress tick stays motif-only.
 audio._announceCadence=null;ctx.currentTime+=10;
 const beats=[];audio._beat=(...args)=>beats.push(args);
 audio.event({type:'payload-contest',id:1,time:1,actor:9,x:4,z:0},player);
 assert.equal(audio.lastCue,'payload-contest');
 assert.equal(beats.length,1,'the motif still owns its own voice');
 const cuePlays=plays.length;
 audio.event({type:'holdout-progress',id:2,time:2,actor:9,x:4,z:0},player);
 assert.equal(plays.length,cuePlays,'a progress tick never announces');
 assert.equal(beats.length,2,'the holdout motif still plays');
 audio.dispose();
});

// ---------------------------------------------------------------------------
// Menu ornaments
// ---------------------------------------------------------------------------

test('setMenuTab forwards to the soundtrack and is re-applied when the engine builds',()=>{
 const audio=new SynthAudio();
 assert.equal(audio.setMenuTab('roster'),0,'no engine yet resolves to 0');
 assert.equal(audio.menuTab,'roster','the tab is remembered before start');
 const ctx=contextMock();
 audio.ctx=ctx;audio.noiseBuffer={};
 audio._ensureBuses();
 assert.ok(audio.musicEngine,'the deferred engine builds on demand');
 assert.equal(audio.musicEngine.menuTab,'roster','the remembered tab is applied when the engine builds');
 assert.ok(audio.musicEngine.menuTabSeed>0);
 const rosterSeed=audio.musicEngine.menuTabSeed;
 assert.equal(audio.setMenuTab('loadout'),audio.musicEngine.menuTabSeed,'the forward returns the engine seed');
 assert.notEqual(audio.musicEngine.menuTabSeed,rosterSeed,'a different tab forks the menu ornaments');
 assert.equal(audio.setMenuTab(null),0);
 assert.equal(audio.musicEngine.menuTabSeed,0,'clearing the tab restores the baseline take');
 assert.equal(audio.setMenuTab(7),0,'non-string tabs stay off');
 audio.dispose();
});
