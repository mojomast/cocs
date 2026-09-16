import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {WeaponFeedback,EffectPool,SynthAudio,AmbientFX,WeatherFX,EMPTY_CHANNELS,MODE_THEMES} from './feedback.mjs';
import {weatherPreset} from './environment.mjs';

const player={id:7,weapon:0,x:0,z:0,yaw:0,grounded:true,vx:0,vy:0,vz:0};
test('weapon kicks are distinct, bounded, pellet-deduplicated and recover exponentially',()=>{
 const poses=[];
  for(let weapon=0;weapon<8;weapon++){const f=new WeaponFeedback(),p={...player,weapon};f.shot(weapon,1);f.shot(weapon,1);assert.equal(f.kick,1);poses.push(f.update(p,0).z);for(let i=0;i<100;i++)f.shot(weapon,i+2);assert.equal(f.kick,1.4);let last=f.update(p,0).z;for(let i=0;i<120;i++){const pose=f.update(p,1/60);assert.ok(pose.z<=last);last=pose.z;}assert.ok(last<1e-8);}
  assert.equal(new Set(poses).size,8);
 const a=new WeaponFeedback(),b=new WeaponFeedback();a.shot(0,1);b.shot(0,1);a.update(player,.1);for(let i=0;i<6;i++)b.update(player,1/60);assert.ok(Math.abs(a.kick-b.kick)<1e-12);
});
test('weapon feedback exposes distinct sway/recoil/reload/switch channels that sum to pitch and roll',()=>{
 const f=new WeaponFeedback();
 f.shot(0,1);
 const reloading={...player,vx:5,vz:0,punchYaw:.1,punchPitch:.5,reloading:true,reloadTimer:.2,reloadDuration:.5};
 const pose=f.update(reloading,1/60);
 const ch=f.channels;
 assert.ok(ch&&ch.recoil&&ch.movement&&ch.reload&&ch.swap&&ch.punch,'all presentation channels are named');
 assert.ok(ch.recoil.pitch>0,'the shot kick lands in the recoil channel');
 const pitchSum=ch.recoil.pitch+ch.punch.pitch+ch.reload.pitch+ch.swap.pitch;
 const rollSum=ch.movement.roll+ch.reload.roll+ch.swap.roll+ch.recoil.roll;
 assert.ok(Math.abs(pitchSum-pose.pitch)<1e-12,'channels sum to the returned pitch');
 assert.ok(Math.abs(rollSum-pose.roll)<1e-12,'channels sum to the returned roll');
 assert.notEqual(ch.movement.roll,0,'movement sway is kept distinct from recoil');
 f.update({...player},1/60,true);
 assert.deepEqual(f.channels,EMPTY_CHANNELS,'reduced motion zeroes every channel without allocating');
});

test('motion is presentation-only, disabled for hidden/reduced weapons, with bounded landing',()=>{
 const f=new WeaponFeedback(),p={...player,vx:7,vy:-12,grounded:false},copy={...p};f.update(p,.016);assert.deepEqual(p,copy);
 const landed=f.update({...p,grounded:true,vy:0},.016);assert.ok(landed.y<0&&landed.y>-.05);
 for(const [reduced,visible] of [[true,true],[false,false]]){f.shot(0,2);assert.deepEqual(f.update(player,.016,reduced,visible),{x:0,y:0,z:0,pitch:0,roll:0});}
 f.shot(0,3);assert.equal(f.update({...player,weapon:1},0).z,0);
});
test('effect slots reuse resources, retain endpoints, expire and dispose once',()=>{
 const scene=new T.Scene(),pool=new EffectPool(scene,12),from=new T.Vector3(1,2,3),to=new T.Vector3(4,6,-2);
 const line=pool.add({from,to,color:'#ffffff'});line.updateMatrixWorld();assert.ok(new T.Vector3(0,0,1).applyMatrix4(line.matrixWorld).distanceTo(to)<1e-10);
 for(let i=0;i<1000;i++)pool.add(i%2?{from,to,color:'#ff0000'}:{pos:to,color:'#ffffff'});
 assert.equal(scene.children.length,12);assert.equal(pool.slots.length,12);assert.equal(new Set(pool.slots.map(s=>s.obj.geometry)).size,2);
 const resources=[pool.line,pool.sphere,...pool.slots.map(s=>s.obj.material)],counts=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));
 pool.update(1);assert.ok(pool.slots.every(s=>!s.active&&!s.obj.visible));pool.add({from,to,color:'#ffffff'});assert.equal(pool.slots.length,12);pool.clear();assert.ok(pool.slots.every(s=>!s.active));pool.dispose();assert.equal(scene.children.length,0);assert.ok(counts.every(n=>n===1));
});
function audioFixture(){const audio=new SynthAudio(),nodes=[];const param=()=>({setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});const node=()=>{const n={frequency:param(),gain:param(),connect(){},disconnect(){this.disconnected=true;},start(){},stop(){}};nodes.push(n);return n;};audio.ctx={currentTime:1,destination:{},createOscillator:node,createGain:node,close(){this.closed=true;}};return {audio,nodes};}
test('pooled mesh traces honor widths and reset orientation and width on reuse',()=>{
 const pool=new EffectPool(new T.Scene(),1),from=new T.Vector3(1,2,3),to=new T.Vector3(-4,5,6);
 const trace=pool.add({from,to,size:.045,color:'#fff'});assert.ok(trace.isMesh);assert.equal(trace.scale.x,.045);pool.clear();
 assert.equal(pool.add({from:to,to:from,size:.12,color:'#fff'}),trace);assert.equal(trace.scale.x,.12);assert.equal(trace.scale.y,.12);trace.updateMatrixWorld();assert.ok(new T.Vector3(0,0,1).applyMatrix4(trace.matrixWorld).distanceTo(from)<1e-10);
 pool.clear();pool.add({from,to:from,size:.1,color:'#fff'});assert.equal(trace.scale.z,0);assert.ok(trace.quaternion.toArray().every(Number.isFinite));pool.dispose();
});
test('audio routes local and remote shots with identity falloff and dedupes bursts',()=>{
  const {audio}=audioFixture(),shots=[],clicks=[];
  audio._gunshot=(e,local,pan,vol)=>shots.push({weapon:e.weapon,local,vol});
  audio._click=(...args)=>clicks.push(args);
  for(let weapon=0;weapon<8;weapon++)audio.event({type:'shot',actor:7,weapon,time:weapon,from:{x:100,z:100}},player);
  assert.equal(shots.length,8);assert.equal(new Set(shots.map(s=>s.weapon)).size,8);assert.ok(shots.every(s=>s.local===true&&s.vol===1));
  audio.event({type:'shot',actor:7,weapon:7,time:7,from:{x:100,z:100}},player);assert.equal(shots.length,8);
  audio.event({type:'shot',actor:0,weapon:0,time:8,from:{x:100,z:100}},player);assert.equal(shots.length,8);
  audio.event({type:'shot',actor:0,weapon:0,time:9,from:{x:0,z:0}},player);assert.equal(shots.length,9);assert.ok(shots.at(-1).local===false&&shots.at(-1).vol<1);
  audio.event({type:'dryfire',actor:7,weapon:2},player);assert.equal(clicks.length,1);
  audio.event({type:'dryfire',actor:0,weapon:2},player);assert.equal(clicks.length,1);
});
test('local damage, player hits and player kills give feedback while unrelated events stay silent',()=>{
  const {audio}=audioFixture(),plays=[];audio._play=(duration,pan)=>plays.push({duration,pan});audio._gunshot=()=>{};
  audio.event({type:'shot',actor:0,weapon:0,hit:{id:1},from:{x:100,z:100}},player);assert.equal(plays.length,0);
  audio.event({type:'damage',id:1,time:2,actor:7,source:0,amount:20},player);assert.equal(plays.length,1);
  audio.event({type:'damage',id:2,time:2,actor:0,source:7,amount:20},player);assert.equal(plays.length,2);
  audio.event({type:'death',id:3,time:2,actor:0,pos:{x:0,z:0}},player);assert.equal(plays.length,3);
  const count=plays.length;
  audio.event({type:'damage',id:4,time:2,actor:1,source:0,amount:20},player);assert.equal(plays.length,count);
  audio.event({type:'death',id:5,time:2,actor:1},player);assert.equal(plays.length,count);
});
test('audio voices are capped, disconnected on disposal, and muted without allocation',()=>{
  const {audio,nodes}=audioFixture();audio.muted=true;audio.tone(100);assert.equal(nodes.length,0);audio.muted=false;
  for(let i=0;i<100;i++)audio.tone(100);assert.equal(audio.voices.size,30);assert.equal(nodes.length,90);
  const ctx=audio.ctx;audio.dispose();assert.equal(audio.voices.size,0);assert.ok(ctx.closed);assert.ok(nodes.every(n=>n.disconnected));
});
test('mounted chaingun uses its own heavier voice and dedupes the paired barrels',()=>{
 const {audio}=audioFixture(),chains=[];
 audio._chaingun=(pan,vol)=>chains.push({pan,vol});
 audio.event({type:'vehicle-shot',actor:7,vehicle:1,weapon:0,time:1,from:{x:0,z:0}},player);
 audio.event({type:'vehicle-shot',actor:7,vehicle:1,weapon:0,time:1,from:{x:0,z:0}},player);
 assert.equal(chains.length,1,'paired barrels share a single report');
 audio.event({type:'vehicle-shot',actor:7,vehicle:1,weapon:0,time:2,from:{x:0,z:0}},player);
 assert.equal(chains.length,2);
 audio.event({type:'vehicle-shot',actor:0,vehicle:1,weapon:0,time:3,from:{x:20,z:0}},player);
 assert.equal(chains.length,3);
 assert.ok(chains.at(-1).vol<1,'remote chaingun falls off with distance');
});

test('ambient particles are deterministic, bounded and gated off for CPU/reduced motion',()=>{
 const profile={kind:'dust',color:'#c9d8e6',size:.03,life:3.6,rate:5,drift:.6,rise:.08,additive:false,smoke:{color:'#8f9a86',size:.3,life:6,rise:.5,rate:2}};
 const run=()=>{const pool={adds:[],add(o){this.adds.push(o);}};const fx=new AmbientFX(pool,{profile,seed:1234,anchors:[{x:1,y:.4,z:2},{x:-3,y:.4,z:4}],moteCap:4});let spawned=0;for(let i=0;i<30;i++)spawned+=fx.update(1/30,{x:0,y:0,z:0},{radius:8});return {pool,spawned,fx};};
 const a=run(),b=run();
 assert.deepEqual(a.pool.adds,b.pool.adds,'the same seed and dt sequence emit identical motes');
 assert.ok(a.pool.adds.length>0&&a.spawned===a.pool.adds.length);
 assert.ok(a.spawned<=30*4,'the per-update spawn cap bounds the emitter');
 for(const add of a.pool.adds){assert.ok(Number.isFinite(add.pos.x)&&Number.isFinite(add.pos.y)&&Number.isFinite(add.pos.z));assert.ok(add.size>0&&add.life>0);}
 const quiet=new AmbientFX({add(){}},{profile,seed:9,anchors:[]});
 assert.equal(quiet.update(1,{x:0,y:0,z:0},{reduced:true}),0,'reduced motion emits nothing');
 assert.equal(quiet.update(1,{x:0,y:0,z:0},{software:true}),0,'the CPU renderer emits nothing');
 assert.equal(quiet.update(1,null,{}),0,'no origin emits nothing');
 const different=run();different.fx.setProfile({...profile,rate:0});
 assert.equal(different.fx.update(1,{x:0,y:0,z:0}),0);
});

test('pooled effects switch to additive blending per spawn and reset it on reuse',()=>{
 const pool=new EffectPool(new T.Scene(),1),from=new T.Vector3(1,2,3),to=new T.Vector3(-4,5,6);
 const trace=pool.add({from,to,color:'#fff',additive:true});
 assert.equal(trace.material.blending,T.AdditiveBlending);
 pool.clear();
 const reused=pool.add({from,to,color:'#fff'});
 assert.equal(reused,trace);
 assert.equal(trace.material.blending,T.NormalBlending,'reusing a slot resets blending');
 pool.dispose();
});

test('EffectPool supports velocity damping, custom gravity, spin, fade curves and color interpolation',()=>{
 const pool=new EffectPool(new T.Scene(),2),pos=new T.Vector3(0,5,0),vel=new T.Vector3(10,20,0);
 const spark=pool.add({pos,color:'#ffffff',endColor:'#ff4400',life:1,velocity:vel,damping:2,gravity:5,spin:3,fade:'smooth',startOpacity:1});
 assert.equal(spark.position.y,5);
 pool.update(0.1);
 assert.ok(spark.position.x>0);
 assert.ok(spark.position.y>5);
 assert.ok(spark.rotation.x>0);
 assert.ok(spark.material.opacity<1);
 // After 1 full second, particle should be deactivated
 pool.update(1.0);
 assert.equal(pool.slots[0].active,false);
 assert.equal(spark.visible,false);
 pool.dispose();
});

test('EffectPool reuses scratch vectors and colors across cycles without GC churn',()=>{
 const pool=new EffectPool(new T.Scene(),1);
 const pos=new T.Vector3(0,0,0),vel=new T.Vector3(1,2,3);
 pool.add({pos,color:'#ffffff',endColor:'#000000',velocity:vel,spin:2});
 const slot=pool.slots[0];
 const allocatedVel=slot.velVec;
 const allocatedSpin=slot.spinVec;
 const allocatedColor=slot.startCol;
 assert.ok(allocatedVel&&allocatedSpin&&allocatedColor);
 pool.clear();
 assert.equal(slot.velocity,null);
 assert.equal(slot.spin,null);
 assert.equal(slot.endColor,null);
 pool.add({pos,color:'#ff0000'});
 assert.equal(slot.velocity,null);
 pool.clear();
 pool.add({pos,color:'#00ff00',endColor:'#0000ff',velocity:vel,spin:4});
 assert.equal(slot.velVec,allocatedVel,'velocity vector instance is reused');
 assert.equal(slot.spinVec,allocatedSpin,'spin vector instance is reused');
 assert.equal(slot.startCol,allocatedColor,'color instance is reused');
 pool.dispose();
});

function audioFixture2(){const audio=new SynthAudio(),nodes=[];const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}});const node=extra=>{const n={frequency:param(),gain:param(),Q:param(),pan:param(),type:'',buffer:null,loop:false,connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;},...extra};nodes.push(n);return n;};audio.ctx={currentTime:1,destination:{},createOscillator:()=>node({type:'sine'}),createGain:()=>node(),createBiquadFilter:()=>node({type:'lowpass'}),createBufferSource:()=>node({}),createStereoPanner:()=>node(),close(){this.closed=true;}};audio.noiseBuffer={};audio.master=node();return {audio,nodes};}
// A fuller context for soundtrack tests: mutable clock, resume(), buffers, and
// the same node factories the real graph uses. Buses are built through the real
// _ensureBuses path so the tests exercise production wiring.
function musicFixture(){
 const nodes=[];
 const param=(v=0)=>({value:v,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}});
 const node=extra=>{const n={frequency:param(),gain:param(),Q:param(),pan:param(),type:'',buffer:null,loop:false,connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;},...extra};nodes.push(n);return n;};
 const ctx={currentTime:0,state:'running',sampleRate:44100,destination:{},
  createOscillator:()=>node({type:'sine'}),createGain:()=>node(),createBiquadFilter:()=>node({type:'lowpass'}),
  createBufferSource:()=>node({}),createStereoPanner:()=>node(),
  createBuffer:(ch,len)=>({getChannelData:()=>new Float32Array(len)}),
  resume(){this.state='running';return Promise.resolve();},close(){this.closed=true;}};
 const audio=new SynthAudio({announcer:true});
 audio.ctx=ctx;audio.noiseBuffer={};
 audio._ensureBuses();
 audio._bed(true);
 return {audio,ctx,nodes};
}

test('footstep and landing variants rotate deterministically per weapon family',()=>{
 const {audio}=audioFixture2(),tones=[],noises=[];
 audio._play=(d,p,build)=>build(0,{},[]);
 audio._tone=(t,out,nodes,options)=>tones.push(options);
 audio._noise=(t,out,nodes,options)=>noises.push(options);
 for(let i=0;i<3;i++)audio._footstep(6,0);
 assert.deepEqual(audio.stepVariant,0,'three light footsteps cycle the variant counter');
 assert.equal(new Set(tones.map(t=>t.freq)).size,3,'each footstep variant chooses a distinct body tone');
 assert.equal(new Set(noises.map(n=>n.freq)).size,3);
 tones.length=noises.length=0;
 for(let i=0;i<3;i++)audio._landing(.6,5);
 assert.equal(new Set(tones.map(t=>t.freq)).size,3,'landing variants differ');
 const heavy=tones.map(t=>t.freq);
 tones.length=0;audio.landVariant=0;for(let i=0;i<3;i++)audio._landing(.6,0);
 assert.ok(Math.max(...heavy)<Math.max(...tones.map(t=>t.freq)),'heavy gear lands lower than light gear');
});

test('reload foley rotates its sequence and melee plays a whoosh plus hit crack',()=>{
 const {audio}=audioFixture2(),clicks=[],noises=[],tones=[];
 audio._click=(...args)=>clicks.push(args);
 audio._noise=(t,out,nodes,options)=>noises.push(options);
 audio._tone=(...args)=>tones.push(args);
 audio._reload(0,'start');audio._reload(9,'start');audio._reload(0,'start');
 assert.equal(audio.reloadVariant,0,'three reloads cycle the variant counter');
 assert.equal(clicks.length>=3,true,'each reload starts with an insert click');
 assert.equal(audio._reload(0,'end'),undefined,'non-start reload states are silent');
 noises.length=0;
 audio._melee(0,true);
 assert.ok(noises.some(n=>n.sweep===260),'melee has a whoosh sweep');
 assert.ok(noises.some(n=>n.type==='lowpass'),'a connecting melee adds an impact crack');
});

test('the ambient bed starts on demand and is torn down exactly once on dispose',()=>{
 const {audio,nodes}=audioFixture2();
 audio._bed(true);
 assert.ok(audio.bed&&audio.bed.src.started&&audio.bed.osc.started,'the bed starts its noise and sub oscillators');
 const bed=audio.bed;
 audio.setAmbient(false);
 assert.equal(audio.bed,null,'disabling ambience drops the bed');
 assert.ok(bed.src.stopped&&bed.osc.stopped,'the bed nodes stop');
 audio.tone(120);assert.ok(audio.voices.size>0);
 audio.dispose();
 assert.equal(audio.ctx,null);
 assert.ok(nodes.every(n=>n.disconnected===true||n===audio.master),'every live node is disconnected');
});

test('kill confirmations layer into the death voice and follow the spectated actor',()=>{
 const {audio}=audioFixture(),plays=[],confirms=[];
 audio._play=(duration,pan,build)=>{plays.push({duration,pan});build?.(0,{},[]);};
 audio._noise=()=>{};audio._tone=()=>{};
 audio._killConfirm=(...args)=>confirms.push(args);
 const spectator={...player,spectator:true,spectatorTarget:9};
 assert.equal(audio._isLocal({actor:9},spectator),true,'spectator treats the watched actor as local');
 assert.equal(audio._isLocal({actor:3},spectator),false,'an unrelated actor is not local while spectating');
 assert.equal(audio._isScorer(9,spectator),true);
 assert.equal(audio._isScorer(3,spectator),false);
 audio.event({type:'death',actor:9,source:9,pos:{x:0,z:0}},spectator);
 assert.equal(plays.length,1,'a watched self-death still plays one voice');
 assert.equal(confirms.length,0,'a suicide is not a kill confirmation');
 audio.event({type:'death',actor:5,source:9,pos:{x:0,z:0}},spectator);
 assert.equal(plays.length,2);
 assert.equal(confirms.length,1,'the watched actor scoring a kill adds one confirmation');
 audio.event({type:'death',actor:7,source:7,pos:{x:0,z:0}},spectator);
 assert.equal(confirms.length,1,'a local death never confirms a kill');
});

test('the soundtrack plays from a quiet menu and layers combat with intensity',()=>{
 const {audio,ctx}=musicFixture();
 assert.equal(audio.setScene('menu'),'menu');
 // Quiet menu: no gunfire, no rockets. Music must still schedule notes.
 for(let i=0;i<20;i++){ctx.currentTime+=.05;audio.tick();}
 assert.ok(audio.musicEngine.notesScheduled>0,'a quiet menu still produces music');
 assert.equal(audio.musicEngine._activeScene(),'menu');
 const menuNotes=audio.musicEngine.notesScheduled;
 // Quiet gameplay starts on exploration material, then combat layers in.
 audio.setScene('game');audio.setIntensity(0);
 for(let i=0;i<20;i++){ctx.currentTime+=.05;audio.tick();}
 assert.equal(audio.musicEngine._activeScene(),'explore','quiet play uses the exploration arrangement');
 audio.setIntensity(1);
 assert.equal(audio.musicEngine._activeScene(),'combat','a loud fight layers the combat arrangement');
 for(let i=0;i<20;i++){ctx.currentTime+=.05;audio.tick();}
 assert.ok(audio.musicEngine.notesScheduled>menuNotes,'combat keeps scheduling after the menu theme');
 assert.ok(audio.musicEngine.voices.length<=audio.musicEngine.maxVoices,'simultaneous voices are bounded');
 audio.dispose();
 assert.equal(audio.ctx,null);
});

test('music toggles and master mute silence only the intended branch',()=>{
 const {audio,ctx}=musicFixture();
 for(let i=0;i<10;i++){ctx.currentTime+=.05;audio.tick();}
 const before=audio.musicEngine.notesScheduled;
 assert.equal(audio.setMusicEnabled(false),false);
 assert.equal(audio.musicEngine.enabled,false);
 for(let i=0;i<10;i++){ctx.currentTime+=.05;audio.tick();}
 assert.equal(audio.musicEngine.notesScheduled,before,'music off pauses the soundtrack scheduler');
 audio.tone(100);
 assert.ok(audio.voices.size>0,'effects still play while music is disabled');
 assert.equal(audio.muted,false,'the music toggle does not mute the whole mix');
 assert.equal(audio.setMusicEnabled(true),true);
 assert.equal(audio.musicEngine.enabled,true);
 for(let i=0;i<10;i++){ctx.currentTime+=.05;audio.tick();}
 assert.ok(audio.musicEngine.notesScheduled>before,'re-enabling resumes the soundtrack');
 // Master mute silences every branch immediately.
 assert.equal(audio.setMuted(true),true);
 assert.equal(audio.muteGain.gain.value,0,'master mute drives the mute gain to zero');
 assert.equal(audio.musicEngine.muted,true);
 assert.equal(audio.bed,null,'muting stops the ambience bed');
 const muted=audio.musicEngine.notesScheduled;
 for(let i=0;i<10;i++){ctx.currentTime+=.05;audio.tick();}
 assert.equal(audio.musicEngine.notesScheduled,muted,'muting pauses the soundtrack scheduler');
 assert.equal(audio.setMuted(false),false);
 assert.equal(audio.muteGain.gain.value,1,'unmuting restores the master gain');
 assert.ok(audio.bed,'unmuting restarts the ambience bed');
 audio.dispose();
});

test('per-mode themes retune the soundtrack in place',()=>{
 const {audio,ctx}=musicFixture();
 assert.equal(audio.mode,'default');
 assert.equal(audio.setModeTheme('ctf'),'ctf');
 assert.equal(audio.theme,MODE_THEMES.ctf);
 assert.equal(audio.musicEngine.theme.root,MODE_THEMES.ctf.root,'the engine reads the shared mode theme');
 assert.equal(audio.setModeTheme('not-a-mode'),'default','an unknown mode falls back to the default theme');
 for(let i=0;i<20;i++){ctx.currentTime+=.05;audio.tick();}
 assert.ok(audio.musicEngine.notesScheduled>0);
 assert.ok(MODE_THEMES.horde.root!==MODE_THEMES.default.root,'modes have distinct roots');
 for(const [key,theme] of Object.entries(MODE_THEMES)){
  assert.ok(Number.isFinite(theme.root)&&theme.root>0,`${key} root`);
  assert.ok(Array.isArray(theme.scale)&&theme.scale.length>0,`${key} scale`);
  assert.ok(Object.isFrozen(theme)&&Object.isFrozen(theme.scale));
 }
 audio.dispose();
});

test('the announcer cue is opt-in, returns the cue id and respects mute and the voice cap',()=>{
 const {audio}=audioFixture2();
 assert.equal(audio.announcer,false);
 assert.equal(audio.announcerCue('goal').played,false,'a disabled announcer never spends a voice');
 assert.equal(audio.announcerCue('not-a-cue'),null,'an unknown event has no cue');
 assert.equal(audio.announcerCue('capture').played,false,'an unknown-but-known event is still gated when off');
 assert.equal(audio.setAnnouncer(true),true);
  const played=audio.announcerCue('goal');
  assert.equal(played.cue,'goal');
  assert.equal(played.played,true);
  assert.equal(audio.lastCue,'goal');
  const scorePlayed=audio.announcerCue('score');
  assert.equal(scorePlayed.cue,'score');
  assert.equal(scorePlayed.played,true);
  assert.equal(audio.lastCue,'score');
  assert.ok(audio.voices.size>=1,'an enabled announcer spends a voice');
  audio.muted=true;
  assert.equal(audio.announcerCue('victory').played,false,'muting silences the announcer');
 audio.dispose();
});

test('duplicate announcer reports of one moment are deduped',()=>{
 const {audio}=audioFixture2();
 audio.announcer=true;
 audio.ctx.currentTime=5;
 assert.equal(audio.announcerCue('capture').played,true);
 assert.equal(audio.announcerCue('capture').deduped,true,'the same cue within the cooldown is dropped');
 assert.equal(audio.announcerCue('capture').played,false);
 audio.ctx.currentTime=5.4;
 assert.equal(audio.announcerCue('capture').played,true,'the cue plays again after the cooldown');
 audio.dispose();
});

test('weather precipitation reuses pooled slots, respects the cap and gates CPU/reduced motion',()=>{
 const pool=new EffectPool(new T.Scene(),32),fx=new WeatherFX(pool,{seed:1,preset:weatherPreset('storm'),cap:6}),origin={x:0,y:0,z:0};
 assert.equal(fx.update(.05,origin,{software:true}),0,'the CPU renderer emits no precipitation');
 assert.equal(fx.update(.05,origin,{reduced:true}),0,'reduced motion emits no precipitation');
 assert.equal(fx.update(.05,null,{}),0,'no origin emits nothing');
 const spawned=fx.update(.05,origin,{quality:1});
 assert.ok(spawned>0&&spawned<=6,'the per-frame cap bounds the emitter');
 assert.ok(pool.slots.some(slot=>slot.active),'precipitation lands in the shared pool');
 assert.equal(fx.update(.05,origin,{quality:0}),0,'a zero quality scale suppresses precipitation');
 fx.setPreset(weatherPreset('clear'));
 assert.equal(fx.update(.05,origin,{quality:1}),0,'clear weather spawns nothing');
 pool.dispose();
});

test('victory and defeat stings reuse the voice cap and honour mute',()=>{
 const {audio}=audioFixture2();
 assert.equal(audio.sting('not-an-outcome'),null,'an unknown outcome has no sting');
 assert.equal(audio.sting('victory').played,true);
 assert.equal(audio.lastSting,'victory');
 assert.ok(audio.voices.size>=1,'an enabled sting spends a voice');
 const before=audio.voices.size;
 audio.muted=true;
 assert.equal(audio.sting('defeat').played,false,'muting silences the sting');
 assert.equal(audio.voices.size,before,'a muted sting spends no voice');
 audio.muted=false;
 audio.sting('defeat');
 assert.equal(audio.lastSting,'defeat');
 audio.dispose();
});

test('distant thunder is distance-scaled, panned and respects mute',async()=>{
 const {audio}=audioFixture2();
 assert.equal(audio.thunder({distance:.5,pan:.4,intensity:1}),true,'a strike schedules thunder');
 assert.equal(audio.thunder({distance:1,pan:0,intensity:0}),false,'a silent strike is a no-op');
 audio.muted=true;
 assert.equal(audio.thunder({distance:.5}),false,'muted thunder is a no-op');
 audio.dispose();
});

test('wind gusts scale ambient particle drift without changing the seed contract',()=>{
 const profile={kind:'dust',color:'#c9d8e6',size:.03,life:3.6,rate:5,drift:.6,rise:.08,additive:false,smoke:null};
 const run=wind=>{const pool={adds:[],add(o){this.adds.push(o);}};const fx=new AmbientFX(pool,{profile,seed:77,moteCap:6});for(let i=0;i<12;i++)fx.update(1/30,{x:0,y:0,z:0},{radius:6,wind});return pool.adds;};
 const calm=run(1),gusty=run(2);
 assert.ok(calm.length>0&&gusty.length>0);
 const spread=adds=>adds.reduce((sum,add)=>sum+Math.abs(add.velocity.x),0);
 assert.ok(spread(gusty)>spread(calm),'a stronger gust throws motes further');
 const replay=run(1);
 assert.deepEqual(replay,calm,'the same wind reproduces the same motes');
});

test('ambient bed mood is remembered before start and eases the running nodes',()=>{
 const {audio}=audioFixture2();
 assert.equal(audio.bed,null);
 assert.equal(audio.setBedMood('hot'),'hot','the mood is remembered before the bed starts');
 audio._bed(true);
 assert.ok(audio.bed,'the bed starts with the remembered mood');
 assert.equal(audio.bed.f.frequency.value,200,'the hot mood uses a darker filter');
 assert.equal(audio.setBedMood('cold'),'cold');
 assert.equal(audio.bedMood,'cold');
 assert.equal(audio.setBedMood('nonsense'),'default','an unknown mood falls back to default');
 audio._bed(false);
 assert.equal(audio.bed,null);
});

test('weapons 8 and 9 use sharp and rapid gunshot synthesis styles and reports',()=>{
 const {audio}=audioFixture();
 const shots=[];
 audio._gunshot=(e,local,pan,vol)=>shots.push({weapon:e.weapon,local,vol});
 for(let w=0;w<10;w++)audio.event({type:'shot',actor:7,weapon:w,time:w,from:{x:0,z:0}},player);
 assert.equal(shots.length,10);
 assert.equal(shots[8].weapon,8);
 assert.equal(shots[9].weapon,9);
});

test('grenade toss, sliding friction and race audio events trigger feedback voices',()=>{
 const {audio}=audioFixture();
 const plays=[];
 audio._play=(duration,pan)=>plays.push({duration,pan});
 audio.event({type:'grenade',actor:7,pos:{x:0,z:0}},player);
 assert.equal(plays.length,1);
 audio.event({type:'race-coin',actor:7,coins:1,pos:{x:0,z:0}},player);
 assert.equal(plays.length,2);
 audio.event({type:'race-box',actor:7,item:'turbo',pos:{x:0,z:0}},player);
 assert.equal(plays.length,3);
 audio.event({type:'race-boost',actor:7,pos:{x:0,z:0}},player);
 assert.equal(plays.length,4);
 audio.event({type:'race-item',actor:7,item:'turbo',pos:{x:0,z:0}},player);
 assert.equal(plays.length,5);
 audio.event({type:'race-hazard-hit',actor:7,hazard:'oil',pos:{x:0,z:0}},player);
 assert.equal(plays.length,6);
 audio.event({type:'race-lap',actor:7,lap:2,total:3},player);
 assert.equal(plays.length,7);
 audio.event({type:'race-finish',actor:7,time:45},player);
 assert.equal(plays.length,8);
  // Sliding audio
  const slidePlayer={...player,sliding:true,vx:6,vz:0,grounded:true,health:100};
  audio.update(slidePlayer,[],1/60);
  assert.equal(plays.length,9);
  // Vehicle and soccer goal audio events
  const clicks=[];
  audio._click=(...args)=>clicks.push(args);
  audio.event({type:'vehicle-destroyed',actor:7,pos:{x:0,z:0}},player);
  assert.equal(plays.length,10);
  audio.event({type:'soccer-goal',team:0,pos:{x:0,z:0}},player);
  assert.equal(plays.length,11);
  // Real soccer-goal emission without pos and with actorId
  audio.event({type:'soccer-goal',team:0,actorId:7,scorerId:7},player);
  assert.equal(plays.length,12);
  audio.event({type:'vehicle-enter',actor:7},player);
  assert.equal(clicks.length,1);
  audio.event({type:'vehicle-exit',actor:7},player);
  assert.equal(clicks.length,2);
  // Vehicle destroyed recognizes driver or occupant as local
  audio.event({type:'vehicle-destroyed',actor:99,driver:7,pos:{x:0,z:0}},player);
  assert.equal(plays.length,13);
  audio.event({type:'vehicle-destroyed',actor:99,driver:50,occupants:[7],pos:{x:0,z:0}},player);
  assert.equal(plays.length,14);
});

test('reload variant 2 invokes tone method and does not throw',async()=>{
  const {audio}=audioFixture2();
  const tones=[];
  audio.tone=(...args)=>tones.push(args);
  audio.reloadVariant=1; // so next is 2
  audio._reload(0,'start');
  assert.equal(audio.reloadVariant,2);
  await new Promise(r=>setTimeout(r,250));
  assert.equal(tones.length,1);
  assert.equal(tones[0][0],320); // heavy?180:320 -> kick is 18 >= 14 -> 320
  assert.equal(tones[0][2],'square');
});

test('extended mode themes are defined and selectable without error',()=>{
  const {audio}=audioFixture2();
  for(const mode of ['team-elimination','vip-escort','holdout','uplink']){
    assert.ok(MODE_THEMES[mode],`theme defined for ${mode}`);
    assert.equal(audio.setModeTheme(mode),mode);
    assert.equal(audio.mode,mode);
  }
});

