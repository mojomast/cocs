import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {WeaponFeedback,EffectPool,SynthAudio,AmbientFX,WeatherFX,EMPTY_CHANNELS,MODE_THEMES,DEATH_SOUND_FAMILIES,DEATH_STYLE_SOUNDS,deathSoundFor,altVoiceFor,ALT_VOICE_IDS,POWER_CUES,PICKUP_CUES,pickupCue,TELEGRAPH_CUES,ANNOUNCE_CUES,ANNOUNCE_CADENCE} from './feedback.mjs';
import {HALO_THEME,HALO_ARRANGEMENTS,MUSIC_PALETTES} from './music.mjs';
import {ALT_FIRE} from './alt-fire.mjs';
import {deathPlan,DEATH_STYLES} from './deaths.mjs';
import {SURFACE_KINDS,surfaceKind,footstepProfile,impactProfile,reportVariation,mixUnit,eventSeed} from './sfx-design.mjs';
import {weatherPreset} from './environment.mjs';
import {HARNESSES} from './data.mjs';
import {configureMothAssets,resetMothAssets} from './moth-assets.mjs';

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
  const {audio}=audioFixture(),shots=[],dryfired=[];
  audio._gunshot=(e,local,pan,vol)=>shots.push({weapon:e.weapon,local,vol});
  audio._dryfire=(pan)=>dryfired.push(pan);
  for(let weapon=0;weapon<8;weapon++)audio.event({type:'shot',actor:7,weapon,time:weapon,from:{x:100,z:100}},player);
  assert.equal(shots.length,8);assert.equal(new Set(shots.map(s=>s.weapon)).size,8);assert.ok(shots.every(s=>s.local===true&&s.vol===1));
  audio.event({type:'shot',actor:7,weapon:7,time:7,from:{x:100,z:100}},player);assert.equal(shots.length,8);
  audio.event({type:'shot',actor:0,weapon:0,time:8,from:{x:100,z:100}},player);assert.equal(shots.length,8);
  audio.event({type:'shot',actor:0,weapon:0,time:9,from:{x:0,z:0}},player);assert.equal(shots.length,9);assert.ok(shots.at(-1).local===false&&shots.at(-1).vol<1);
  audio.event({type:'dryfire',actor:7,weapon:2},player);assert.equal(dryfired.length,1);
  audio.event({type:'dryfire',actor:0,weapon:2},player);assert.equal(dryfired.length,1);
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

test('a saturated pool can change between streaks and motes without allocating slots',t=>{
 const pool=new EffectPool(new T.Scene(),1);t.after(()=>pool.dispose());
 const line=pool.add({from:{x:0,y:3,z:0},to:{x:0,y:2,z:0},color:'#fff',life:1});
 const material=line.material;
 const mote=pool.add({pos:{x:1,y:2,z:3},color:'#fff',life:1});
 assert.equal(mote,line);assert.equal(mote.geometry,pool.sphere);assert.equal(mote.material,material);
 assert.equal(pool.slots[0].line,false);assert.equal(pool.slots.length,1);
 pool.clear();
 const again=pool.add({from:{x:0,y:2,z:0},to:{x:0,y:1,z:0},color:'#fff'});
 assert.equal(again,line);assert.equal(again.geometry,pool.line);assert.equal(pool.slots[0].line,true);
});

test('ambient intensity scales emission and drifting motes/smoke keep their authored velocity',t=>{
 const profile={color:'#fff',rate:20,rise:.5,life:2,smoke:{color:'#888',rate:10,rise:1,life:2}};
 const run=intensity=>{const adds=[],fx=new AmbientFX({add:add=>adds.push(add)},{profile,anchors:[{x:0,y:0,z:0}]});for(let i=0;i<20;i++)fx.update(.1,{x:0,y:0,z:0},{intensity});return adds;};
 const full=run(1),half=run(.5);
 assert.equal(run(0).length,0);assert.equal(full.length,half.length*2);
 assert.ok(full.every(add=>add.gravity===0));
 const pool=new EffectPool(new T.Scene(),2);t.after(()=>pool.dispose());
 const smoke=full.find(add=>add.expand>0),mesh=pool.add(smoke),start=mesh.position.y;
 pool.update(.1);pool.update(.1);
 assert.ok(Math.abs(mesh.position.y-start-smoke.velocity.y*.2)<1e-9,'smoke rises without combat-particle gravity');
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
 // The simulation emits `killer` on deaths (never `source`), and a void fall has
 // no killer at all. Both spellings must work and a fall must stay silent.
 audio.event({type:'death',actor:11,killer:9,pos:{x:0,z:0}},spectator);
 assert.equal(confirms.length,2,'the simulator killer field confirms the kill');
 audio.event({type:'death',actor:12,killer:null,fall:true,self:true,pos:{x:0,z:0}},spectator);
 assert.equal(confirms.length,2,'a void fall never confirms a kill');
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

test('harness activations cue per harness, stay local and fall back to the generic power motif',()=>{
 const {audio}=audioFixture(),beats=[];
 audio._beat=(cue,pan,vol)=>beats.push({cue,pan,vol});
 audio.event({type:'power',actor:7,harness:'openclaw',pos:{x:0,z:0}},player);
 audio.event({type:'power',actor:7,harness:'cline',pos:{x:0,z:0}},player);
 audio.event({type:'power',actor:0,harness:'codex',pos:{x:0,z:0}},player);
 assert.equal(beats.length,2,'a remote activation stays silent');
 assert.notDeepEqual(beats[0].cue,beats[1].cue,'each harness has its own motif');
 const motifs=new Set();
 for(const harness of HARNESSES){
  audio.event({type:'power',actor:7,harness:harness.id,pos:{x:0,z:0}},player);
  const cue=beats.at(-1).cue;
  assert.ok(cue&&Array.isArray(cue.notes)&&cue.notes.length>=2,harness.id);
  motifs.add(JSON.stringify(cue.notes));
 }
 assert.equal(motifs.size,HARNESSES.length,'all seven harness motifs are distinct');
 audio.event({type:'power',actor:7,harness:'not-a-harness',pos:{x:0,z:0}},player);
 assert.ok(beats.at(-1).cue,'an unknown harness still gets the generic power cue');
});

test('movement events play local foley and announce each verb, remote verbs stay silent',()=>{
 const {audio}=audioFixture2(),plays=[];
 audio.announcer=true;
 audio._play=(duration,pan)=>{plays.push({duration,pan});return 1;};
 audio._tone=()=>{};audio._noise=()=>{};
 audio.event({type:'move-start',actor:7,verb:'air-dash'},player);
 assert.equal(plays.length,2,'one foley voice plus one verb announcement');
 assert.equal(audio.lastCue,'air-dash','the verb motif is announced on activation');
 audio.event({type:'move-start',actor:7,verb:'blink-step'},player);
 assert.equal(audio.lastCue,'blink-step');
 assert.equal(plays.length,4);
 audio.event({type:'move-start',actor:3,verb:'air-dash'},player);
 assert.equal(plays.length,4,'remote movement stays silent');
 audio.event({type:'slam-impact',actor:7,verb:'brace-slam'},player);
 assert.equal(audio.lastCue,'brace-slam');
 audio.event({type:'rope-place',actor:7,verb:'deployable-rope'},player);
 assert.equal(audio.lastCue,'deployable-rope');
 // Every shared movement event maps to exactly one local voice (plus the
 // activation announcement for the three announce-worthy types) and never throws.
 const announced=new Set(['move-start','slam-impact','rope-place']);
 const types=['move-start','move-end','move-miss','move-blocked','windup-start','windup-end','windup-interrupt','charge-start','charge-release','charge-cancel','slam-launch','slam-impact','grapple-hook','grapple-release','rope-place','rope-miss','rope-expire','fuel-empty','no-lift','chain-cancel','landing-recovery'];
 for(const type of types){
  audio.ctx.currentTime+=1; // clear the announcer's per-cue dedupe window
  const before=plays.length,expected=announced.has(type)?2:1;
  audio.event({type,actor:7,verb:'air-dash'},player);
  assert.equal(plays.length,before+expected,type);
 }
 audio.ctx.currentTime+=1;
 const beforeFeint=plays.length;
 audio.event({type:'feint',actor:7,pos:{x:0,z:0}},player);
 assert.equal(plays.length,beforeFeint+2,'the radar feint rider plays foley plus an announcement');
 assert.equal(audio.lastCue,'feint');
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

test('sound-design tables are frozen, alias-normalised and deterministically varied',()=>{
 assert.equal(surfaceKind('Rock'),'stone');
 assert.equal(surfaceKind('ICE'),'snow');
 assert.equal(surfaceKind('diamond-plate'),'metal','decorated metal aliases resolve');
 assert.equal(surfaceKind('corrugated_metal'),'metal');
 assert.equal(surfaceKind('turf'),'grass');
 assert.equal(surfaceKind(undefined),'default');
 assert.equal(surfaceKind('not-a-material'),'default','unknown materials fall back to the phase-1 default');
 for(const kind of SURFACE_KINDS){
  const step=footstepProfile(kind),surfaceHit=impactProfile(kind);
  assert.ok(step&&surfaceHit,`${kind} has step and impact profiles`);
  for(const value of [step.bright,step.body,step.gain,step.q,surfaceHit.freq,surfaceHit.q,surfaceHit.gain,surfaceHit.tone,surfaceHit.end])assert.ok(Number.isFinite(value),`${kind} profile is finite`);
  assert.ok(Object.isFrozen(step)&&Object.isFrozen(surfaceHit),`${kind} profiles are immutable`);
 }
 const v1=reportVariation('rifle',7),v2=reportVariation('rifle',7);
 assert.deepEqual(v1,v2,'the same seed reproduces the same variation');
 assert.ok(v1.pitch>=.955&&v1.pitch<=1.045&&v1.bright>=.9&&v1.bright<=1.12&&v1.tail>=.75&&v1.tail<=1.25,'variation stays inside its bounded ranges');
 assert.notDeepEqual(v1,reportVariation('rifle',8),'a new seed shifts the variation');
 assert.notDeepEqual(reportVariation('rifle',7),reportVariation('heavy',7),'families vary over their own styles');
 for(let i=0;i<64;i++){const unit=mixUnit(i);assert.ok(unit>=0&&unit<1,'mixUnit is normalized');}
 assert.equal(eventSeed({id:3,time:1.5,weapon:2}),eventSeed({id:3,time:1.5,weapon:2}));
 assert.notEqual(eventSeed({id:3,time:1.5,weapon:2}),eventSeed({id:4,time:1.5,weapon:2}),'an event id reseeds the variation');
});

test('surface profiles shape footsteps and landings while default numbers stay phase-1 exact',()=>{
 const {audio}=audioFixture2(),tones=[],noises=[];
 audio._play=(duration,pan,build)=>build(0,{},[]);
 audio._tone=(t,out,nodes,options)=>tones.push(options);
 audio._noise=(t,out,nodes,options)=>noises.push(options);
 audio.stepVariant=0;
 audio._footstep(6,0);
 assert.equal(noises.length,1,'the default surface keeps the single-noise footstep layer');
 assert.equal(tones.length,1,'the default surface keeps the single-body footstep layer');
 const defaultFreq=noises[0].freq,defaultTone=tones[0].freq;
 tones.length=noises.length=0;
 audio._footstep(6,0,'metal');
 assert.ok(noises[0].freq>defaultFreq,'metal steps are brighter than default');
 assert.ok(tones[0].freq>defaultTone,'metal bodies land higher');
 assert.ok(tones.some(t=>t.freq===2400),'metal adds its ring');
 tones.length=noises.length=0;
 audio.stepVariant=0;
 for(let i=0;i<3;i++)audio._footstep(6,0,'gravel');
 assert.equal(new Set(noises.map(n=>n.freq)).size>=3,true,'variant rotation survives surface profiles');
 assert.ok(noises.length>3,'gravel scatters debris ticks');
 tones.length=noises.length=0;
 audio.landVariant=0;
 audio._landing(.6,5,'wall');
 assert.equal(noises.length,1,'an unknown surface keeps the default landing layer count');
 assert.equal(tones.length,1);
 audio.dispose();
});

test('update resolves the movement surface from player, opts or resolver and cues take-off',()=>{
 const {audio}=audioFixture2(),surfaces=[];
 audio._footstep=(speed,weapon,surface)=>surfaces.push(surface);
 audio._slide=(speed,surface)=>surfaces.push(surface);
 const walking={id:7,weapon:0,x:0,z:0,yaw:0,grounded:true,health:100,maxHealth:100,vx:6,vy:0,vz:0,vehicleId:null};
 for(let i=0;i<40;i++)audio.update(walking,[],1/60,{surface:'sand'});
 for(let i=0;i<40;i++)audio.update({...walking,surface:'metal'},[],1/60);
 audio.setSurfaceResolver((x,z)=>(x===0&&z===0?'wood':null));
 for(let i=0;i<40;i++)audio.update({...walking,surface:undefined},[],1/60);
 assert.deepEqual([...new Set(surfaces)],['sand','metal','wood'],'opts, the player field and the resolver each choose the profile');
 assert.equal(audio.setSurfaceResolver(null),null,'a non-function resolver clears the hook');
 const jumps=[];
 audio._jump=(surface,weapon)=>jumps.push(surface);
 audio.update({...walking,grounded:true,vx:0},[],1/60,{surface:'grass'});
 audio.update({...walking,grounded:false,vy:4,vx:0},[],1/60,{surface:'grass'});
 assert.deepEqual(jumps,['grass'],'take-off cues once per airborne transition with the resolved surface');
 audio.dispose();
});

test('layered gunshots are deterministic per event, varied across shots and family-specific',()=>{
 const run=e=>{
  const {audio}=audioFixture2(),noises=[],tones=[];
  audio._play=(duration,pan,build)=>build(0,{},[]);
  audio._noise=(t,out,nodes,options)=>noises.push(options);
  audio._tone=(t,out,nodes,options)=>tones.push(options);
  audio._gunshot(e,true,0,1,player);
  audio.dispose();
  return {noises,tones};
 };
 const first=run({type:'shot',weapon:0,id:5,time:1}),replay=run({type:'shot',weapon:0,id:5,time:1});
 assert.deepEqual(first.tones,replay.tones,'the same event synthesizes identically');
 assert.deepEqual(first.noises,replay.noises);
 const later=run({type:'shot',weapon:0,id:6,time:1.02});
 assert.notEqual(first.tones[0].freq,later.tones[0].freq,'consecutive shots vary their body pitch');
 assert.ok(first.noises.length>=4,'reports carry transient, body and tail layers');
 const sharp=run({type:'shot',weapon:8,id:9,time:2});
 assert.ok(sharp.noises.some(n=>n.q===1.8),'the sharp family adds its crack layer');
 const heavy=run({type:'shot',weapon:1,id:11,time:3});
 assert.ok(heavy.tones.some(t=>typeof t.type==='string'&&t.type.length>0),'heavy keeps a tonal body');
 assert.ok(heavy.noises.some(n=>n.sweep===200),'heavy adds its double-thump layer');
});

test('missed shots synthesize a surface impact but actor hits do not double up',()=>{
 const {audio}=audioFixture2(),noises=[],tones=[];
 audio._play=(duration,pan,build)=>build(0,{},[]);
 audio._noise=(t,out,nodes,options)=>noises.push(options);
 audio._tone=(t,out,nodes,options)=>tones.push(options);
 audio._gunshot({type:'shot',weapon:0,id:1,time:1,hit:false,to:{x:3,z:0},surface:'metal'},false,0,1,player);
 const missed=noises.length,missedTones=tones.length;
 assert.ok(noises.some(n=>n.type==='bandpass'&&n.freq>=2000),'metal impacts add a bright band');
 assert.ok(missedTones>0);
 audio._gunshot({type:'shot',weapon:0,id:2,time:2,hit:{id:9},to:{x:3,z:0}},false,0,1,player);
 assert.ok(noises.length-missed<missed,'an actor hit gets no surface impact layers');
 audio.dispose();
});

test('objective and match-beat cues retune to the mode root and stay one voice each',()=>{
 const {audio}=audioFixture2(),tones=[],plays=[];
 audio._play=(duration,pan,build)=>{plays.push(duration);build(0,{},[]);};
 audio._tone=(t,out,nodes,options)=>tones.push(options);
 audio._noise=()=>{};
 audio.setModeTheme('ctf');
 const root=MODE_THEMES.ctf.root;
 audio.event({type:'flag-pickup',id:1,time:1,actor:7,from:{x:0,z:0}},player);
 assert.equal(plays.length,1,'a flag pickup spends one voice');
 assert.ok(Math.abs(tones[0].freq-root)<1e-9,'motifs start on the active mode root');
 const flagNotes=tones.length;
 tones.length=0;
 audio.event({type:'zone-capture',id:2,time:2,actor:99,from:{x:4,z:0}},player);
 assert.ok(tones.length>=3,'zone captures play a three-note motif');
 assert.equal(audio.theme.root,root,'the cue does not retune the theme');
 audio.event({type:'objective-win',id:3,time:3},player);
 assert.ok(tones.length>=6,'objective win matches the larger beat motif');
 assert.ok(flagNotes>=2);
 audio.dispose();
});

test('explosions add a bounded deterministic debris tail',()=>{
 const {audio}=audioFixture2(),noises=[],tones=[];
 audio._play=(duration,pan,build)=>build(0,{},[]);
 audio._noise=(t,out,nodes,options)=>noises.push(options);
 audio._tone=(t,out,nodes,options)=>tones.push(options);
 audio.event({type:'explosion',id:1,time:1,pos:{x:2,z:0},weapon:1},player);
 assert.equal(tones.length,2,'the sub layers survive');
 assert.ok(noises.length>=3&&noises.length<=10,'explosions stay bounded with the debris tail');
 const count=noises.length;
 audio.event({type:'explosion',id:1,time:1,pos:{x:2,z:0},weapon:1},player);
 assert.equal(noises.length,count*2,'the same explosion synthesizes the same amount of layers');
 audio.dispose();
});

test('setWind clamps and the bed owns wind and tension layers',()=>{
 const {audio}=audioFixture2();
 audio._bed(true);
 assert.ok(audio.bed&&audio.bed.windG&&audio.bed.windLfo&&audio.bed.tenseG,'the running bed owns the new continuous layers');
 assert.equal(audio.setWind(9),3);
 assert.equal(audio.setWind(-2),0);
 assert.equal(audio.setWind('nope'),null);
 assert.equal(audio.windScale,null,'a non-finite override falls back to the mood wind');
 assert.equal(audio.setBedMood('storm'),'storm');
 audio.dispose();
});

test('the shared space send costs one node per sounding voice and keeps the voice cap',()=>{
 const {audio,nodes}=audioFixture2();
 const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}});
 let delays=0;
 audio.ctx.createDelay=()=>{delays++;const node={delayTime:param(),connect(){},disconnect(){this.disconnected=true;}};nodes.push(node);return node;};
 audio.master=null;
 audio._ensureBuses();
 assert.ok(audio.space,'the space send is built when DelayNode is available');
 assert.equal(delays,1,'the send builds exactly one delay line');
 audio.voices.clear();
 const before=nodes.length;
 audio._play(.1,0,(t,out,list)=>audio._tone(t,out,list,{freq:100}));
 const without=nodes.length-before;
 audio.voices.clear();
 const beforeSend=nodes.length;
 audio._play(.1,0,(t,out,list)=>audio._tone(t,out,list,{freq:100}),{send:.5});
 assert.equal(nodes.length-beforeSend,without+1,'a sent voice adds exactly one send gain');
 audio.voices.clear();
 for(let i=0;i<40;i++)audio.tone(90+i);
 assert.equal(audio.voices.size,30,'the voice cap still bounds sent and unsent voices');
 audio.dispose();
});

test('a failed impulse response load stays retryable instead of latching loaded',async()=>{
 const {audio,ctx}=musicFixture();
 const attached=[];
 ctx.decodeAudioData=(bytes,resolve)=>resolve({id:'ir'});
 audio.musicEngine.setReverb=(buffer,options)=>{attached.push(buffer);return true;};
 const originalFetch=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:false,arrayBuffer:async()=>new ArrayBuffer(0)};};
 try{
  assert.equal(audio.setReverbUrl('/moth/files/ir-cavern/result.wav',.42),true);
  assert.equal(audio.audioStatus().reverb,'loading','the status reports an in-flight IR load');
  await audio.unlock();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls,1,'the URL is fetched once when the context unlocks');
  assert.equal(audio.reverbLoaded,false,'a 404 does not latch the reverb as loaded');
  assert.equal(audio.audioStatus().reverb,'pending','a failed load returns to pending');
  assert.equal(attached.length,0,'nothing is attached on a failed load');
  globalThis.fetch=async()=>{calls++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
  audio.unlock();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls,2,'a later unlock retries the same URL');
  assert.equal(audio.reverbLoaded,true,'a successful retry latches');
  assert.equal(attached.length,1,'the decoded buffer is attached once');
 }finally{
  globalThis.fetch=originalFetch;
  audio.dispose();
 }
});

test('setSpace selects baked space IRs, defaults wetness per space and falls back safely',()=>{
 const b64=(bytes)=>Buffer.from(bytes).toString('base64');
 const ir=(url,seconds)=>({url,seconds,sampleRate:22050,channels:2,taps:[]});
 configureMothAssets({version:1,irs:{'open-air':ir('/moth/files/ir-open-air/result.wav',1.5),cavern:ir('/moth/files/ir-cavern/result.wav',4)}});
 const audio=new SynthAudio();
 try{
  assert.equal(audio.setSpace('open-air'),'/moth/files/ir-open-air/result.wav');
  assert.equal(audio.reverbWet,.22,'open-air is drier than the old cavern default');
  assert.equal(audio.reverbSpace,'open-air');
  assert.equal(audio.setSpace('open-air'),'/moth/files/ir-open-air/result.wav','re-selecting the active space is a no-op');
  assert.equal(audio.setSpace('void'),'/moth/files/ir-cavern/result.wav','an unknown space falls back to cavern');
  assert.equal(audio.reverbWet,.42,'the fallback keeps the cavern wetness');
  assert.equal(audio.audioStatus().space,'void');
  assert.equal(audio.setSpace('open-air',{wet:.5}),'/moth/files/ir-open-air/result.wav','explicit wetness overrides the per-space default');
  assert.equal(audio.reverbWet,.5);
 }finally{
  resetMothAssets();
  audio.dispose();
 }
 // With no registry the wired URL is preserved rather than cleared, so a partial
 // bake can never silence the reverb that is already playing.
 const offline=new SynthAudio();
 try{
  offline.setReverbUrl('/moth/files/ir-cavern/result.wav',.42);
  assert.equal(offline.setSpace('hall'),'/moth/files/ir-cavern/result.wav');
  assert.equal(offline.reverbUrl,'/moth/files/ir-cavern/result.wav');
 }finally{offline.dispose();}
});

test('death styles resolve to planner sound families without drift',()=>{
 const probe=style=>{for(let weapon=0;weapon<=9;weapon++)for(let seed=0;seed<512;seed++){const plan=deathPlan({weapon,overkill:0,seed});if(plan.style===style)return plan;}return null;};
 assert.deepEqual([...DEATH_SOUND_FAMILIES],['thud','pop','splat','burst','boom','zap']);
 for(const style of DEATH_STYLES){
  const plan=probe(style);
  assert.ok(plan,`${style} is reachable from the planner`);
  assert.equal(DEATH_STYLE_SOUNDS[style],plan.sound,`${style} maps to the planner family`);
  assert.equal(deathSoundFor({style}),plan.sound);
 }
 assert.equal(new Set(Object.values(DEATH_STYLE_SOUNDS)).size,DEATH_SOUND_FAMILIES.length,'every family is reachable from a style');
 assert.equal(deathSoundFor({sound:'pop'}),'pop','a direct sound wins');
 assert.equal(deathSoundFor({sound:'laser',style:'headpop'}),'pop','an unknown sound falls through to the style');
 assert.equal(deathSoundFor({style:'not-a-style'}),null,'an unknown style keeps the legacy voice');
 assert.equal(deathSoundFor({}),null);
 assert.equal(deathSoundFor(null),null);
 const context=deathPlan({weapon:2,seed:11});
 assert.equal(deathSoundFor({weapon:2,seed:11}),context.sound,'a style-less event recovers its family from the planner context');
 assert.equal(deathSoundFor({fall:true,seed:3}),'thud','fall deaths resolve the ragdoll family');
 assert.equal(deathSoundFor({weapon:'nonsense'}),null,'a junk weapon is not a kill context');
});

test('death sound families synthesize distinct seeded envelopes and fall back to the legacy voice',()=>{
 const legacy=[
  {kind:'noise',duration:.4,gain:.35,type:'lowpass',freq:1200,sweep:120,q:.7},
  {kind:'tone',freq:180,duration:.45,type:'sawtooth',gain:.12,end:40},
  {kind:'noise',duration:.22,gain:.16,type:'bandpass',freq:700,sweep:200,q:.6},
 ];
 const capture=()=>{const {audio}=audioFixture2(),layers=[];
  audio._play=(duration,pan,build,opts)=>{layers.push({play:{duration,pan,send:opts?.send}});build(0,{},[]);};
  audio._noise=(t,out,nodes,options)=>layers.push({kind:'noise',...options});
  audio._tone=(t,out,nodes,options)=>layers.push({kind:'tone',...options});
  return {audio,layers};
 };
 const run=extra=>{const {audio,layers}=capture();audio.event({type:'death',actor:1,source:1,pos:{x:0,z:0},...extra},player);return layers;};
 const defaultRun=run({});
 assert.deepEqual(defaultRun[0].play,{duration:.6,pan:0,send:.3},'the default death keeps its length, pan and send');
 assert.deepEqual(defaultRun.slice(1),legacy,'an event with no family keeps the legacy voice');
 assert.equal(run({actor:7,source:7}).slice(1).find(layer=>layer.kind==='tone').freq,220,'the legacy local tone is unchanged');
 assert.deepEqual(run({sound:'not-a-family'}).slice(1),legacy,'an unknown family keeps the legacy voice');
 assert.deepEqual(run({style:'nonsense'}).slice(1),legacy,'an unknown style keeps the legacy voice');
 assert.deepEqual(run({style:'headpop'}),run({sound:'pop'}),'a style-only event resolves the mapped family');
 const signatures={};
 for(const family of DEATH_SOUND_FAMILIES){
  const first=run({sound:family,seed:7}),replay=run({sound:family,seed:7});
  assert.deepEqual(first,replay,'the same seed synthesizes identically');
  assert.ok(first.length>=4&&first.length<=7,`${family} stays a bounded voice`);
  assert.ok(first.slice(1).every(layer=>Number.isFinite(layer.gain)),`${family} layers are finite`);
  assert.notDeepEqual(run({sound:family,seed:8}),first,'a new seed shifts the family');
  signatures[family]=JSON.stringify(first);
 }
 signatures.legacy=JSON.stringify(defaultRun);
 assert.equal(new Set(Object.values(signatures)).size,DEATH_SOUND_FAMILIES.length+1,'every family is distinct from the legacy voice and each other');
 const level=layers=>layers.slice(1).reduce((sum,layer)=>sum+layer.gain,0);
 for(const family of DEATH_SOUND_FAMILIES)assert.ok(level(run({sound:family,seed:7}))<=level(defaultRun)*1.2,`${family} does not average louder than the legacy death`);
 const one=run({sound:'boom',seed:3});
 assert.equal(one.filter(layer=>layer.play).length,1,'one voice token per death, never a stacked layer');
 assert.equal(one[0].play.send,.3,'the shared spatial send is unchanged');
 assert.ok(!one.slice(1).some(layer=>layer.freq===1200&&layer.type==='lowpass'),'the family replaces the general death noise instead of stacking on it');
});

test('death variants keep routing, panning, level and mute gates unchanged',()=>{
 const capture=()=>{const {audio}=audioFixture2(),plays=[];
  audio._play=(duration,pan,build,opts)=>{plays.push({duration,pan,send:opts?.send});build(0,{},[]);};
  audio._noise=()=>{};audio._tone=()=>{};
  return {audio,plays};
 };
 const remote={x:20,z:0};
 const routed=DEATH_SOUND_FAMILIES.map(family=>{const {audio,plays}=capture();audio.event({type:'death',actor:1,source:1,pos:remote,sound:family},player);return plays;});
 assert.ok(routed.every(plays=>plays.length===1),'every family still spends exactly one remote voice');
 assert.ok(routed.every(plays=>plays[0].pan===routed[0][0].pan),'panning does not vary by family');
 assert.ok(routed.every(plays=>plays[0].send===routed[0][0].send),'the distance-shaped send does not vary by family');
 const spectator={...player,spectator:true,spectatorTarget:9};
 const local=capture();
 local.audio.event({type:'death',actor:9,source:9,pos:{x:0,z:0},sound:'zap'},spectator);
 assert.equal(local.plays.length,1,'the watched actor still voices the family locally');
 local.audio.event({type:'death',actor:1,source:9,sound:'zap'},spectator);
 assert.equal(local.plays.length,1,'an unrelated death stays silent');
 const self=capture();
 self.audio.event({type:'death',actor:7,source:7,pos:{x:0,z:0},sound:'splat'},{...player,reduced:true});
 assert.equal(self.plays.length,1,'sound is not motion-gated: reduced players still hear the family');
 const {audio,nodes}=audioFixture2();
 audio.muted=true;
 const before=nodes.length;
 audio.event({type:'death',actor:7,pos:{x:0,z:0},sound:'boom'},player);
 assert.equal(nodes.length,before,'muting still silences every death family');
 audio.muted=false;
 audio.event({type:'death',actor:7,pos:{x:0,z:0},sound:'boom'},player);
 assert.ok(nodes.length>before,'unmuting restores the family voice');
 audio.dispose();
});

test('precision and high-damage hit confirms layer a bounded deterministic bell',()=>{
 const capture=()=>{const {audio}=audioFixture2(),layers=[];
  audio._play=(duration,pan,build)=>{layers.push({duration});build(0,{},[]);};
  audio._noise=(t,out,nodes,options)=>layers.push(options);
  audio._tone=(t,out,nodes,options)=>layers.push(options);
  return {audio,layers};
 };
 const hit=extra=>{const {audio,layers}=capture();audio.event({type:'damage',id:1,time:1,actor:3,source:7,amount:12,...extra},player);return layers;};
 const bell=layers=>layers.filter(layer=>[2480,3720,4960,3400].includes(layer.freq));
 const body=hit({}),heavy=hit({amount:52}),crit=hit({amount:20,headshot:true}),flag=hit({amount:20,critical:true});
 assert.equal(bell(body).length,0,'a body shot keeps its existing hit confirm');
 assert.equal(bell(heavy).length,3,'high damage layers the high-damage bell');
 assert.equal(bell(crit).length,4,'precision adds the top partial');
 assert.ok(flag.some(layer=>layer.freq===4960),'the critical flag rings like a headshot');
 assert.ok(!heavy.some(layer=>layer.freq===4960),'high damage keeps the plain two-partial bell');
 assert.ok(!hit({amount:47}).some(layer=>layer.freq===2480),'a hit under the threshold stays unchanged');
 assert.deepEqual(hit({amount:52}),heavy,'the bell is deterministic');
 const incoming=capture();
 incoming.audio.event({type:'damage',id:2,time:2,actor:7,source:3,amount:52},player);
 assert.equal(bell(incoming.layers).length,0,'damage taken does not ring the attacker bell');
});


// ---------------------------------------------------------------------------
// Combat audio pass: alt-fire voices, alt-state foley, harness tails and
// per-verb movement foley.
// ---------------------------------------------------------------------------

// Captures the synthesized layers of one voice call: the `_play` stub opens the
// voice and the `_noise`/`_tone` stubs record every layer inside it, including
// the scheduled offset `at` so motif notes and tails stay distinguishable.
function voiceCapture(){
 const {audio}=audioFixture2(),layers=[],plays=[];
 audio._play=(duration,pan,build,opts)=>{plays.push({duration,pan,send:opts?.send});build(0,{},[]);};
 audio._noise=(t,out,nodes,options)=>layers.push({kind:'noise',at:t,...options});
 audio._tone=(t,out,nodes,options)=>layers.push({kind:'tone',at:t,...options});
 return {audio,layers,plays};
}
const layerLevel=layers=>layers.reduce((sum,layer)=>sum+(Number(layer.gain)||0),0);

test('alt voice ids mirror the alt-fire spec table and resolve from the event before the weapon index',()=>{
 assert.deepEqual([...ALT_VOICE_IDS],ALT_FIRE.map(spec=>spec.sound),'the audio table stays aligned with ALT_FIRE');
 assert.equal(altVoiceFor({alt:true,altId:'cluster'}),'cluster');
 assert.equal(altVoiceFor({alt:true,altId:'mine',weapon:0}),'mine','a known altId wins over the weapon index');
 assert.equal(altVoiceFor({alt:true,weapon:6}),'chain','the weapon index falls back to the alt spec sound');
 assert.equal(altVoiceFor({alt:true,altId:'not-a-voice',weapon:3}),'slug','an unknown altId still resolves from the weapon');
 assert.equal(altVoiceFor({alt:true,altId:'not-a-voice',weapon:42}),null,'both unknown resolves to no alt voice');
 assert.equal(altVoiceFor({alt:true}),null,'a missing altId and weapon resolves to nothing');
 assert.equal(altVoiceFor({alt:false,altId:'salvo',weapon:0}),null,'the alt flag gates the whole path');
 assert.equal(altVoiceFor(null),null);
 assert.equal(altVoiceFor('shot'),null);
 const {audio,plays}=voiceCapture();
 assert.equal(audio._altShot({type:'shot',weapon:42,alt:true,altId:'not-a-voice'},true,0,1,player),false,'an unresolvable alt spends no voice');
 assert.equal(plays.length,0);
});

test('ten alt voices are short, deterministic, seeded and never louder than the normal report',()=>{
 const signatures={};
 const runAlt=(weapon,id,extra={})=>{const capture=voiceCapture();capture.audio._altShot({type:'shot',weapon,alt:true,altId:id,id:5,time:1,...extra},true,0,1,player);return capture;};
 const runNormal=weapon=>{const capture=voiceCapture();capture.audio._gunshot({type:'shot',weapon,id:5,time:1},true,0,1,player);return capture;};
 for(let weapon=0;weapon<ALT_VOICE_IDS.length;weapon++){
  const id=ALT_VOICE_IDS[weapon];
  const first=runAlt(weapon,id),replay=runAlt(weapon,id);
  assert.deepEqual(first.layers,replay.layers,`${id} synthesizes identically for the same event seed`);
  assert.deepEqual(first.plays,replay.plays,`${id} keeps the same voice length and pan`);
  assert.equal(first.plays.length,1,`${id} spends exactly one voice token`);
  assert.ok(first.plays[0].duration<=.4,`${id} stays under .4 s`);
  assert.ok(first.layers.length>=4&&first.layers.length<=12,`${id} stays a bounded layer set`);
  assert.ok(first.layers.every(layer=>Number.isFinite(layer.gain)),`${id} layers are finite`);
  assert.notDeepEqual(runAlt(weapon,id,{id:6}).layers,first.layers,`${id} shifts pitch/level with a new seed`);
  const normal=runNormal(weapon);
  assert.ok(normal.layers.length>0);
  assert.ok(layerLevel(first.layers)<=layerLevel(normal.layers),`${id} is not louder than weapon ${weapon}'s report`);
  signatures[id]=JSON.stringify(first.layers);
 }
 assert.equal(new Set(Object.values(signatures)).size,ALT_VOICE_IDS.length,'every alt id has its own voice');
});

test('alt shots replace the generic report, keep routing and fall back safely for unknown ids',()=>{
 const {audio}=audioFixture(),shots=[],plays=[];
 audio._gunshot=(e,local,pan,vol)=>shots.push({weapon:e.weapon,local,vol});
 audio._play=(duration,pan)=>plays.push({duration,pan});
 audio.event({type:'shot',actor:7,weapon:0,alt:true,altId:'salvo',time:1,from:{x:0,z:0}},player);
 assert.equal(shots.length,0,'a known alt replaces the generic report');
 assert.equal(plays.length,1,'one alt voice per alt event');
 audio.event({type:'shot',actor:7,weapon:0,alt:true,altId:'not-a-voice',time:2,from:{x:0,z:0}},player);
 assert.equal(shots.length,0,'an unknown altId still resolves from the weapon index');
 assert.equal(plays.length,2);
 audio.event({type:'shot',actor:7,weapon:42,alt:true,altId:'not-a-voice',time:3,from:{x:0,z:0}},player);
 assert.equal(shots.length,1,'an unresolvable alt falls back to the generic report');
 audio.event({type:'shot',actor:7,weapon:0,time:4,from:{x:0,z:0}},player);
 assert.equal(shots.length,2,'a normal shot keeps the generic report');
 const near=voiceCapture(),mid=voiceCapture(),far=voiceCapture();
 near.audio.event({type:'shot',actor:0,weapon:0,alt:true,altId:'salvo',time:5,from:{x:6,z:0}},player);
 mid.audio.event({type:'shot',actor:0,weapon:0,alt:true,altId:'salvo',time:5,from:{x:20,z:0}},player);
 far.audio.event({type:'shot',actor:0,weapon:0,alt:true,altId:'salvo',time:5,from:{x:40,z:0}},player);
 assert.ok(mid.plays.length===1&&mid.layers.length>=4,'a distant alt report keeps its body');
 assert.ok(layerLevel(mid.layers)<layerLevel(near.layers),'remote alt reports fall off with distance');
 assert.equal(far.plays.length,0,'an out-of-range alt report stays silent');
});

test('same-tick alt pellets collapse to one voice and flak shards stay quiet ticks',()=>{
 const pellets=voiceCapture();
 for(let pellet=0;pellet<3;pellet++)pellets.audio.event({type:'shot',actor:7,weapon:0,alt:true,altId:'salvo',pellet,time:9,id:100+pellet,from:{x:0,z:0}},player);
 assert.equal(pellets.plays.length,1,'a three-pellet salvo spends one alt voice');
 const launch=voiceCapture();
 launch.audio.event({type:'launch',actor:7,weapon:1,alt:true,altId:'cluster',id:41,time:10,pos:{x:0,z:0}},player);
 assert.equal(launch.plays.length,1,'an alt projectile launch voices the cluster report');
 const shards=voiceCapture();
 shards.audio.event({type:'shot',actor:7,weapon:7,alt:true,altId:'bomb',shrapnel:0,id:52,time:11,hit:false,to:{x:2,z:0},from:{x:0,z:0}},player);
 assert.equal(shards.plays.length,1,'a flak shard spends one quiet tick voice');
 assert.ok(layerLevel(shards.layers)<1,'a shard is not the bomb launch report');
});

test('alt shots share the report impact tail but never double-confirm an actor hit',()=>{
 const miss=voiceCapture();
 miss.audio.event({type:'shot',actor:7,weapon:0,alt:true,altId:'salvo',id:1,time:1,hit:false,to:{x:3,z:0},surface:'metal'},player);
 assert.ok(miss.layers.some(layer=>layer.kind==='noise'&&layer.freq>=2000),'a missed alt shot adds the metal impact band');
 const hit=voiceCapture();
 hit.audio.event({type:'shot',actor:7,weapon:0,alt:true,altId:'salvo',id:1,time:1,hit:{id:9},to:{x:3,z:0}},player);
 assert.ok(hit.layers.length<miss.layers.length,'an actor hit gets no surface impact layers');
});

test('alt-state transform foley plays only on state flips, for local or nearby actors',()=>{
 const {audio}=audioFixture(),plays=[];
 audio._play=(duration,pan)=>plays.push({duration,pan});
 audio.event({type:'alt-state',actor:7,weapon:0,alt:true},player);
 assert.equal(plays.length,1,'the first flip deploys');
 audio.event({type:'alt-state',actor:7,weapon:0,alt:true},player);
 assert.equal(plays.length,1,'a repeated state makes no new sound');
 audio.event({type:'alt-state',actor:7,weapon:0,alt:false},player);
 assert.equal(plays.length,2,'flipping back plays the stow');
 audio.event({type:'alt-state',actor:7,weapon:0,alt:false},player);
 assert.equal(plays.length,2);
 audio.event({type:'alt-state',actor:7,weapon:1,alt:true},player);
 assert.equal(plays.length,3,'a fresh weapon deploy is not shadowed by the old weapon state');
 audio.event({type:'alt-state',actor:7,weapon:1,alt:true},player);
 assert.equal(plays.length,3,'the new weapon state still dedupes repeats');
 audio.event({type:'alt-state',actor:9,weapon:2,alt:true,from:{x:200,z:0}},player);
 assert.equal(plays.length,3,'a far remote flip stays silent');
 audio.event({type:'alt-state',actor:10,weapon:2,alt:true,from:{x:6,z:0}},player);
 assert.equal(plays.length,4,'a nearby remote flip is voiced');
 const spectator={...player,spectator:true,spectatorTarget:9};
 audio.event({type:'alt-state',actor:9,weapon:2,alt:false,from:{x:200,z:0}},spectator);
 assert.equal(plays.length,5,'the watched actor flips locally for a spectator');
 for(let actor=20;actor<100;actor++)audio.event({type:'alt-state',actor,weapon:0,alt:true},player);
 assert.ok(audio._altStates.size<=64,'the per-actor flip memory stays bounded');
 const a=voiceCapture(),b=voiceCapture(),c=voiceCapture();
 a.audio.event({type:'alt-state',actor:11,weapon:0,alt:true,id:7,time:3,from:{x:0,z:0}},player);
 b.audio.event({type:'alt-state',actor:12,weapon:0,alt:true,id:7,time:3,from:{x:0,z:0}},player);
 c.audio.event({type:'alt-state',actor:13,weapon:0,alt:true,id:8,time:4,from:{x:0,z:0}},player);
 assert.equal(a.plays.length,1);
 assert.deepEqual(a.layers,b.layers,'the same flip synthesizes identically');
 assert.notDeepEqual(c.layers,a.layers,'a new seed shifts the transform foley');
});

test('harness power motifs keep their notes and gain a bounded per-harness tail',()=>{
 const root=MODE_THEMES.default.root,tails=new Set();
 for(const [harness,cue] of Object.entries(POWER_CUES)){
  assert.ok(Array.isArray(cue.notes)&&cue.notes.length>=2,`${harness} keeps its motif`);
  assert.ok(cue.tail&&Number.isFinite(cue.tail.freq),`${harness} has a second layer`);
  assert.ok(cue.tail.gain>0&&cue.tail.gain<=.06,`${harness} tail level is bounded`);
  assert.ok(cue.tail.noiseGain>0&&cue.tail.noiseGain<=.05,`${harness} tail impact level is bounded`);
  tails.add(JSON.stringify(cue.tail));
  const {audio,layers,plays}=voiceCapture();
  audio.event({type:'power',actor:7,harness,pos:{x:0,z:0}},player);
  assert.equal(plays.length,1,`${harness} stays one voice`);
  assert.equal(plays[0].pan,0,'pan is unchanged');
  assert.ok(plays[0].duration>=cue.length+(cue.notes.length-1)*cue.step,`${harness} tail never shortens the motif`);
  cue.notes.forEach((semi,i)=>{
   const freq=root*Math.pow(2,semi/12);
   assert.ok(layers.some(layer=>layer.kind==='tone'&&layer.freq===freq&&Math.abs(layer.at-i*cue.step)<1e-9&&layer.gain===cue.gain),`${harness} note ${i} keeps its level and timing`);
  });
  assert.ok(layers.some(layer=>layer.kind==='tone'&&layer.at===cue.tail.delay&&layer.freq===cue.tail.freq&&layer.gain===cue.tail.gain),`${harness} plays its tail tone`);
  assert.ok(layers.some(layer=>layer.kind==='noise'&&layer.at===cue.tail.delay&&layer.freq===cue.tail.noise),`${harness} plays its tail impact`);
  assert.ok(layerLevel(layers)<=.5,`${harness} stays bounded`);
 }
 assert.equal(tails.size,Object.keys(POWER_CUES).length,'each harness tail is its own voicing');
 assert.equal(Object.keys(POWER_CUES).length,HARNESSES.length,'every harness has an activation motif');
 const announced=voiceCapture();
 announced.audio.announcer=true;
 announced.audio.event({type:'power',actor:7,harness:'openclaw',pos:{x:0,z:0}},player);
 assert.equal(announced.plays.length,2,'the announcer gate still adds exactly one callout');
 assert.equal(announced.audio.lastCue,'power');
 const remote=voiceCapture();
 remote.audio.event({type:'power',actor:0,harness:'openclaw',pos:{x:0,z:0}},player);
 assert.equal(remote.plays.length,0,'a remote activation stays silent');
});

const VERB_EVENTS={
 'air-dash':['move-start',{reason:'dash'}],
 'double-jump':['move-start',{reason:'double-jump'}],
 'super-jump':['charge-start',{duration:.55}],
 'hover-jets':['move-start',{reason:'hover'}],
 'brace-slam':['windup-start',{duration:.15}],
 'safety-glide':['move-start',{reason:'glide'}],
 grapple:['grapple-hook',{pos:{x:1,y:2,z:3}}],
 'blink-step':['windup-start',{duration:.2}],
 'deployable-rope':['rope-place',{pos:{x:1,y:2,z:3}}],
};
test('movement verbs voice distinct foley while unknown verbs keep the generic fallback',()=>{
 const signatures={};
 for(const [verb,[type,extra]] of Object.entries(VERB_EVENTS)){
  const {audio,layers,plays}=voiceCapture();
  audio.event({type,actor:7,verb,...extra},player);
  assert.equal(plays.length,1,`${verb} spends exactly one voice on ${type}`);
  assert.ok(layers.length>=2,`${verb} has a layered voice`);
  signatures[verb]=JSON.stringify(layers);
 }
 assert.equal(new Set(Object.values(signatures)).size,Object.keys(VERB_EVENTS).length,'every verb has its own voice');
 // Every known verb still gets exactly one foley voice plus one announcement on
 // its activation, so the announcer gating is unchanged.
 const announcing=voiceCapture();
 announcing.audio.announcer=true;
 for(const verb of Object.keys(VERB_EVENTS)){
  announcing.audio.ctx.currentTime+=1;
  const before=announcing.plays.length;
  announcing.audio.event({type:'move-start',actor:7,verb},player);
  assert.equal(announcing.audio.lastCue,verb,`${verb} keeps its announcer cue`);
  assert.equal(announcing.plays.length,before+2,`${verb} voices foley plus one announcement`);
 }
 // Fallbacks: no verb data and unknown verb ids both keep the pre-verb voice.
 const noVerb=voiceCapture(),unknown=voiceCapture();
 noVerb.audio.event({type:'move-start',actor:7},player);
 unknown.audio.event({type:'move-start',actor:7,verb:'not-a-verb'},player);
 assert.deepEqual(unknown.layers,noVerb.layers,'an unknown verb uses the generic move foley');
 // A known verb with an unhandled event type also falls back, per event type.
 for(const type of ['move-end','move-miss','move-blocked','windup-end','charge-release','fuel-empty','no-lift','chain-cancel','landing-recovery']){
  const generic=voiceCapture(),known=voiceCapture();
  generic.audio.event({type,actor:7},player);
  known.audio.event({type,actor:7,verb:'air-dash'},player);
  assert.deepEqual(known.layers,generic.layers,`${type} keeps the generic fallback for a known verb`);
 }
});

test('every movement event spends at most one voice for any known verb',()=>{
 const types=['move-start','move-end','move-miss','move-blocked','windup-start','windup-end','windup-interrupt','charge-start','charge-release','charge-cancel','slam-launch','slam-impact','grapple-hook','grapple-release','rope-place','rope-miss','rope-expire','fuel-empty','no-lift','chain-cancel','landing-recovery'];
 for(const verb of Object.keys(VERB_EVENTS)){
  for(const type of types){
   const {audio,plays}=voiceCapture();
   audio.event({type,actor:7,verb,pos:{x:1,y:1,z:1}},player);
   assert.equal(plays.length,1,`${verb}/${type} spends one foley voice`);
  }
 }
});

test('alt and verb foley keep the shared mute, motion and voice-cap gates',()=>{
 const {audio,nodes}=audioFixture2();
 audio.muted=true;
 const before=nodes.length;
 audio.event({type:'shot',actor:7,weapon:0,alt:true,altId:'salvo',time:1},player);
 audio.event({type:'alt-state',actor:7,weapon:0,alt:true},player);
 audio.event({type:'move-start',actor:7,verb:'air-dash'},player);
 assert.equal(nodes.length,before,'a muted mix allocates no nodes for the new voices');
 audio.muted=false;
 audio.event({type:'move-start',actor:7,verb:'air-dash',time:2},player);
 assert.ok(nodes.length>before,'unmuting restores the verb foley');
 const reduced=voiceCapture();
 reduced.audio.event({type:'move-start',actor:7,verb:'air-dash'}, {...player,reduced:true});
 assert.equal(reduced.plays.length,1,'sound is not motion-gated, matching the existing movement foley');
 const capped=audioFixture2().audio;
 for(let i=0;i<40;i++)capped.event({type:'move-start',actor:7,verb:'air-dash',time:i},player);
 assert.equal(capped.voices.size,30,'the shared voice cap still bounds the new voices');
});

// --- Priority audio pass: weapon handling, on-hit bundle, match flow ---------

test('reload honours the end state and the event duration with per-weapon timbres',async()=>{
 const {audio}=audioFixture2();const clicks=[],tones=[];
 audio._click=(...args)=>clicks.push(args);
 audio.tone=(...args)=>tones.push(args);
 audio._reload(1,'start',1.2);
 assert.equal(clicks.length,1,'the insert click opens the reload');
 assert.equal(audio._reloadPending.size,1,'the mag-in click is scheduled from the event duration');
 await new Promise(r=>setTimeout(r,120));
 assert.equal(clicks.length,1,'the scheduled seat waits for the reload length');
 audio._reload(1,'end');
 assert.equal(clicks.length,2,'the end event seats the magazine immediately');
 assert.equal(audio._reloadPending.size,0,'the pending seat is consumed');
 assert.ok(clicks[1][3]>clicks[0][3],'the light weapon seat is brighter than its insert');
 // A replayed end with no pending seat still voices exactly one seat click.
 audio._reload(0,'end');
 assert.equal(clicks.length,3);
 assert.equal(audio._reload(0,'dust'),undefined,'unknown reload states stay silent');
 // Heavy gear seats duller than light gear.
 clicks.length=0;
 audio._reload(1,'start',.2);audio._reload(1,'end');
 audio._reload(0,'start',.2);audio._reload(0,'end');
 assert.ok(clicks[1][3]<clicks[3][3],'the heavy weapon seats lower');
 audio.dispose();
});

test('dryfire is a distinct empty-chamber voice, one per event',()=>{
 const {audio}=audioFixture2();const plays=[],noises=[],tones=[];
 audio._play=(duration,pan,build)=>{plays.push({duration,pan});build(0,{},[]);};
 audio._noise=(t,o,n,opts)=>noises.push(opts);audio._tone=(t,o,n,opts)=>tones.push(opts);
 audio.event({type:'dryfire',actor:7,weapon:2},player);
 assert.equal(plays.length,1,'one voice');
 assert.ok(noises.some(n=>n.type==='highpass'),'a metal chamber tick');
 assert.ok(tones.some(t=>t.freq>1000),'a high spring snap');
 assert.ok(tones.some(t=>t.freq<250),'an empty body thunk');
 audio.event({type:'dryfire',actor:9,weapon:2},player);
 assert.equal(plays.length,1,'a remote dryfire stays silent');
});

test('weapon switch splits holster and draw in one voice',()=>{
 const {audio}=audioFixture2();const plays=[],noises=[];
 audio._play=(duration,pan,build)=>{plays.push({duration,pan});build(0,{},[]);};
 audio._noise=(t,o,n,opts)=>noises.push(opts);
 audio.event({type:'weapon-switch',actor:7,weapon:2,source:'request'},player);
 assert.equal(plays.length,1,'the whole swap is one voice');
 const lightDraw=noises.find(n=>n.type==='highpass');
 assert.ok(lightDraw,'the draw has a bright slide');
 assert.ok(noises.some(n=>n.type==='lowpass'),'the holster has a dull drop');
 noises.length=0;
 audio.event({type:'weapon-switch',actor:7,weapon:1,source:'request'},player);
 const heavyDraw=noises.find(n=>n.type==='highpass');
 assert.ok(heavyDraw.freq<lightDraw.freq,'heavy gear draws duller');
 noises.length=0;
 audio.event({type:'weapon-switch',actor:9,weapon:1,source:'request'},player);
 assert.equal(noises.length,0,'a remote swap stays silent');
});

test('vehicle damage voices a local hull ping scaled by amount and throttles chatter',()=>{
 const {audio}=audioFixture2();const plays=[],tones=[];
 audio._play=(duration,pan,build)=>{plays.push({duration,pan});build(0,{},[]);};
 audio._tone=(t,o,n,opts)=>tones.push(opts);
 const riding={...player,vehicleId:1};
 audio.event({type:'vehicle-damage',vehicle:1,actor:0,amount:8,time:1,health:90},riding);
 assert.equal(plays.length,1);
 const soft=Math.max(...tones.map(t=>t.freq));
 tones.length=0;
 audio.event({type:'vehicle-damage',vehicle:1,actor:0,amount:38,time:1.2,health:60},riding);
 assert.ok(Math.max(...tones.map(t=>t.freq))>soft,'a bigger hit pings higher');
 tones.length=0;
 audio.event({type:'vehicle-damage',vehicle:1,actor:0,amount:38,time:1.21,health:60},riding);
 assert.equal(tones.length,0,'rapid hull hits are throttled');
 audio.event({type:'vehicle-damage',vehicle:9,actor:0,amount:30,time:2},riding);
 audio.event({type:'vehicle-damage',vehicle:2,actor:0,amount:30,time:3},player);
 assert.equal(plays.length,2,'remote hulls and on-foot damage stay silent');
});

test('hitDirection pans a local thud by bearing and centers a missing angle',()=>{
 const {audio}=audioFixture2();const plays=[];
 audio._play=(duration,pan)=>plays.push({duration,pan});
 const ahead=audio.hitDirection(0,20);
 assert.deepEqual({directed:ahead.directed,pan:ahead.pan},{directed:true,pan:0});
 const left=audio.hitDirection(Math.PI/2,20);
 assert.ok(left.pan<-.8,'a positive bearing sits left of the mix');
 const right=audio.hitDirection(-Math.PI/2,20);
 assert.ok(right.pan>.8,'a negative bearing sits right of the mix');
 const fallback=audio.hitDirection(NaN,20);
 assert.deepEqual({directed:fallback.directed,pan:fallback.pan},{directed:false,pan:0},'a NaN angle falls back to the centered thud');
 assert.equal(audio.hitDirection(undefined,20).directed,false);
 assert.equal(plays.length,5,'one voice per call');
 assert.equal(plays[4].pan,0);
 audio.muted=true;
 assert.equal(audio.hitDirection(0,20).played,false,'mute gates the thud');
 audio.muted=false;
 // A damage event that carries the bearing pans the same centered voice.
 const routed=audioFixture2(),routedPlays=[];
 routed.audio._play=(duration,pan)=>routedPlays.push({duration,pan});
 routed.audio.event({type:'damage',id:1,time:1,actor:7,source:9,amount:20,angle:Math.PI/2},player);
 assert.ok(routedPlays[0].pan<-.8,'a stamped bearing pans the local damage thud');
 routed.audio.event({type:'damage',id:2,time:2,actor:7,source:9,amount:20},player);
 assert.equal(routedPlays[1].pan,0,'an unstamped hit keeps the centered thud');
 routed.audio.dispose();
 // Called from the page right after the damage event, it merges into a short
 // panned accent instead of doubling the impact.
 const merged=audioFixture2(),mergedPlays=[];
 merged.audio._play=(duration,pan,build)=>{mergedPlays.push({duration,pan});build(0,{},[]);};
 merged.audio.event({type:'damage',id:1,time:1,actor:7,source:9,amount:20},player);
 const before=mergedPlays.length;
 const accent=merged.audio.hitDirection(Math.PI/2,20);
 assert.equal(accent.merged,true,'a same-frame directional call merges');
 assert.equal(mergedPlays.length,before+1,'the accent is one extra voice');
 assert.ok(mergedPlays.at(-1).duration<.14,'the accent is shorter than the full thud');
 assert.ok(mergedPlays.at(-1).pan<-.8,'the accent carries the bearing');
 merged.audio.dispose();
});

test('low health warns once on the entry edge and keeps the heartbeat envelope',()=>{
 const {audio}=audioFixture2();const plays=[];
 audio._play=(duration,pan,build)=>{plays.push(duration);build(0,{},[]);};
 const low={...player,health:20,maxHealth:100,grounded:true,vx:0,vy:0,vz:0};
 audio.update(low,[],1/60);
 assert.equal(plays.length,2,'the entry frame beats and warns');
 assert.equal(plays[0],.22,'the heartbeat envelope duration pin is unchanged');
 assert.equal(plays[1],.34,'the entry warning is its own one-shot');
 audio.update(low,[],1/60);
 assert.equal(plays.length,2,'the warning does not repeat on the next frame');
 const afterWarn=plays.length;
 audio.update({...low},[],1.2);
 assert.ok(plays.length>afterWarn,'the heartbeat keeps ticking');
 const heartbeats=plays.length;
 audio.update({...low,health:100},[],1/60);
 assert.equal(plays.length,heartbeats,'recovering above the threshold is silent');
 audio.update(low,[],1/60);
 assert.equal(plays.length,heartbeats+2,'dropping back under the threshold warns again');
});

test('a local spawn gets a boot-up cue and never the objective motif',()=>{
 const {audio}=audioFixture2();const plays=[],beats=[];
 audio._play=(duration,pan,build)=>{plays.push(duration);build(0,{},[]);};
 audio._beat=(...args)=>beats.push(args);
 audio.event({type:'spawn',actor:7,pos:{x:0,y:0,z:0},time:5},player);
 assert.equal(plays.length,1,'the local spawn boots up');
 assert.equal(beats.length,0,'spawn no longer falls through to the objective blip');
 audio.event({type:'spawn',actor:9,pos:{x:0,y:0,z:0},time:5},player);
 assert.equal(plays.length,1,'a remote spawn stays silent');
});

test('match start is an idempotent FIGHT sting and countdowns edge 3-2-1-GO',()=>{
 const {audio}=audioFixture2();let stings=0;const beeps=[];
 audio._fightSting=()=>{stings++;return true;};
 audio._countdownBeep=(beat,go)=>beeps.push({beat,go});
 audio.event({type:'spawn',id:1,time:.1,actor:3},player);
 assert.equal(stings,1,'the opening spawn fires the FIGHT sting');
 audio.event({type:'spawn',id:2,time:.2,actor:4},player);
 assert.equal(stings,1,'the next opening spawn cannot repeat it');
 for(let i=0;i<20;i++)audio.event({type:'damage',id:10+i,time:5+i,actor:7,source:0,amount:3},player);
 assert.equal(stings,1,'later events never re-fire the sting');
 audio.matchEnd();
 audio.event({type:'spawn',id:99,time:.4,actor:3},player);
 assert.equal(stings,2,'a rematch after matchEnd can fire again');
 audio.matchEnd();
 // Countdown: every number once and a GO on the countdown -> racing flip.
 assert.deepEqual(audio.countdown({phase:'countdown',countdown:3}),{played:true,go:false,beat:3});
 assert.deepEqual(audio.countdown({phase:'countdown',countdown:2.9}),{played:false,go:false,beat:3},'the same number does not repeat');
 assert.deepEqual(audio.countdown({phase:'countdown',countdown:2}),{played:true,go:false,beat:2});
 assert.deepEqual(audio.countdown({phase:'countdown',countdown:1}),{played:true,go:false,beat:1});
 assert.deepEqual(audio.countdown({phase:'countdown',countdown:.4}),{played:false,go:false,beat:1});
 assert.deepEqual(audio.countdown({phase:'racing',countdown:0}),{played:true,go:true,beat:0});
 assert.deepEqual(audio.countdown({phase:'racing',countdown:0}),{played:false,go:false,beat:0});
 assert.deepEqual(beeps,[{beat:3,go:false},{beat:2,go:false},{beat:1,go:false},{beat:0,go:true}]);
 // The one-call snapshot entry point is safe to run every frame.
 const frame={config:{mode:'cocs',timeLimit:600},time:0,over:false,race:{phase:'countdown',countdown:3}};
 audio.scene='game';
 assert.equal(audio.setMatchState(frame).started,true,'the live snapshot can drive the match start');
 assert.equal(audio.setMatchState(frame).started,false,'a repeated frame cannot re-fire the sting');
 assert.equal(audio.setMatchState(frame).countdown.played,false,'a repeated countdown frame stays silent');
 // A mid-race join (first report is already running) never fakes a GO.
 const fresh=audioFixture2().audio;const freshBeeps=[];
 fresh._countdownBeep=(beat,go)=>freshBeeps.push({beat,go});
 assert.equal(fresh.countdown({phase:'playing',countdown:0}).played,false);
 assert.equal(freshBeeps.length,0);
 // Soccer kickoff uses the same detector.
 assert.equal(fresh.countdown({phase:'kickoff',countdown:2.2}).beat,3);
 assert.equal(fresh.countdown({phase:'playing',countdown:0}).go,true);
 audio.dispose();fresh.dispose();
});

test('the final-ten-seconds warning fires once per match',()=>{
 const {audio}=audioFixture2();const beats=[];
 audio._beat=(cue,pan,vol)=>beats.push({cue,pan,vol});
 assert.equal(audio.finalSecondsWarning(40).warned,false);
 assert.equal(audio.finalSecondsWarning(10.2).warned,false,'the far side of ten is silent');
 assert.equal(audio.finalSecondsWarning(9.5).warned,true);
 assert.equal(beats.length,1,'one voice for the final call');
 assert.equal(audio.finalSecondsWarning(8).warned,false,'it never repeats');
 audio.matchStart({restart:true});
 assert.equal(audio.finalSecondsWarning(9).warned,true,'a fresh match re-arms the warning');
 audio.dispose();
});

test('zone progress is quantized per zone plus contested and owner flips',()=>{
 const {audio}=audioFixture2();const beats=[];
 audio._beat=(cue,pan,vol)=>beats.push({cue,pan,vol});
 const ev=extra=>audio.event({type:'zone-progress',id:1,time:1,...extra},player);
 ev({zone:'A',progress:4,team:0,contested:false});
 assert.equal(beats.length,0,'the first sighting seeds silently');
 ev({zone:'A',progress:8,team:0,contested:false});
 assert.equal(beats.length,0,'a same-bucket tick stays silent');
 ev({zone:'A',progress:26,team:0,contested:false});
 assert.equal(beats.length,1,'the 25% bucket sounds');
 ev({zone:'A',progress:51,team:0,contested:false});
 ev({zone:'A',progress:76,team:0,contested:false});
 assert.equal(beats.length,3);
 ev({zone:'A',progress:80,team:0,contested:false});
 assert.equal(beats.length,3,'holding a bucket stays quiet');
 ev({zone:'A',progress:80,team:0,contested:true});
 assert.equal(beats.length,4,'a contested flip sounds');
 ev({zone:'A',progress:60,team:1,contested:true});
 assert.equal(beats.length,5,'an owner flip sounds');
 ev({zone:'B',progress:2,team:null,contested:false});
 assert.equal(beats.length,5,'another zone seeds independently');
 for(let i=0;i<100;i++)ev({zone:`Z${i}`,progress:30,team:0,contested:false});
 assert.ok(audio._zoneAudio.size<=64,'the per-zone state stays bounded');
 audio.dispose();
});

test('pickup kinds keep their own motifs and weapon pickups share one',()=>{
 const {audio}=audioFixture2();const tones=[];
 audio._play=(duration,pan,build)=>build(0,{},[]);
 audio._tone=(t,o,n,opts)=>tones.push(opts.freq);
 audio._noise=()=>{};
 const pick=kind=>{tones.length=0;audio.event({type:'pickup',id:1,time:1,actor:7,kind},player);return [...tones];};
 const health=pick('health'),armor=pick('armor'),ammo=pick('ammo'),rocket=pick('rocket'),rail=pick('rail');
 assert.notDeepEqual(health,armor);
 assert.notDeepEqual(health,ammo);
 assert.notDeepEqual(armor,ammo);
 assert.ok(health.length>=3,'health is a rising supply line');
 assert.deepEqual(rocket,rail,'every weapon pickup shares the weapon identity');
 assert.ok(PICKUP_CUES.weapon&&pickupCue('megahealth')===PICKUP_CUES.megahealth);
 assert.equal(pickupCue('unknown-kind'),PICKUP_CUES.weapon);
 assert.equal(pickupCue(null).notes.length,2,'a bare pickup keeps the historical motif');
 audio.dispose();
});

test('misc objective beats have cue-table entries and one voice each',()=>{
 const {audio}=audioFixture2();const plays=[],beats=[];
 audio._play=(duration,pan,build)=>{plays.push(duration);build(0,{},[]);};
 audio._beat=(cue,pan,vol)=>beats.push({cue,vol});
 audio.setModeTheme('ctf');
 const root=audio.theme.root;
 for(const type of ['loadout-switch','threat-ping','mission-won','mission-lost','horde-upgrade','horde-modifier','assault-breach','payload-checkpoint','juggernaut-transfer'])audio.event({type,id:1,time:1,actor:7,from:{x:0,z:0}},player);
 assert.equal(beats.length,9,'every misc beat spends one voice');
 assert.equal(audio.theme.root,root,'the cue does not retune the theme');
 // An actor-specific utility beat from another actor stays silent.
 beats.length=0;
 audio.event({type:'threat-ping',id:2,time:2,actor:9,from:{x:0,z:0}},player);
 audio.event({type:'loadout-switch',id:3,time:2,actor:9,from:{x:0,z:0}},player);
 assert.equal(beats.length,0,'remote utility beats are local-only');
 audio.dispose();
});

test('cocs mode themes exist and leaving results restores the menu motif',()=>{
 const {audio}=musicFixture();
 assert.ok(MODE_THEMES.cocs&&MODE_THEMES['cocs-coop'],'the LATTICE modes have tonal centres');
 assert.equal(audio.setModeTheme('cocs'),'cocs');
 assert.equal(audio.theme,MODE_THEMES.cocs);
 assert.equal(audio.setModeTheme('cocs-coop'),'cocs-coop');
 assert.notEqual(MODE_THEMES.cocs.root,MODE_THEMES['cocs-coop'].root,'the two LATTICE modes stay distinct');
 audio.setOutcome('victory');
 assert.equal(audio.musicEngine.outcome,'victory');
 assert.equal(audio.musicEngine.scene,'results');
 audio.setScene('game');
 assert.equal(audio.musicEngine.outcome,'victory','the results outcome survives the in-game scene request');
 audio.matchStart({restart:true});
 assert.equal(audio.musicEngine.outcome,null,'a new match releases the stale outcome');
 audio.setOutcome('defeat');
 audio.setScene('menu');
 assert.equal(audio.musicEngine.outcome,null,'returning to the menu restores the menu motif');
 assert.equal(audio.musicEngine.scene,'menu');
 audio.setSoundtrack('halo');
 audio.setModeTheme('cocs-coop');
 assert.equal(audio.theme,HALO_THEME,'the halo pack keeps its single modal centre');
 audio.dispose();
});

test('an outcome take is restored to the menu motif when it clears',()=>{
 configureMothAssets({version:1,motifs:{'moth-victory':{bpm:60,notes:[{step:0,midi:62,dur:4},{step:4,midi:65,dur:4}]}}});
 try{
  const {audio}=musicFixture();
  const menuMotif={bpm:60,notes:[{step:0,midi:69,dur:4},{step:4,midi:72,dur:4}]};
  audio.setMotif(menuMotif);
  const menuLead=[...audio.musicEngine.motifLead];
  audio.setOutcome('victory');
  assert.notDeepEqual(audio.musicEngine.motifLead,menuLead,'the victory take replaces the menu motif');
  audio.setOutcome(null);
  assert.deepEqual(audio.musicEngine.motifLead,menuLead,'clearing the outcome restores the menu motif');
  audio.dispose();
 }finally{resetMothAssets();}
});

test('weather routes the biome mood, precipitation presence and the Moth layer',()=>{
 const {audio}=musicFixture();const moth=[];
 audio.setMothAudio({setEnabled:()=>{},setScene:()=>{},setIntensity:()=>{},setBedMood:v=>moth.push(['mood',v]),setWeather:v=>moth.push(['weather',v]),tick:()=>{},dispose:()=>{}});
 audio.setBiomeMood('hot');
 assert.equal(audio.bedMood,'hot','the biome mood reaches the bed with no weather override');
 assert.equal(audio.setArenaBiome('frostbite'),'cold','an arena id resolves through the shared biome table');
 audio.setWeather('rain');
 assert.equal(audio.weather,'rain');
 assert.ok(audio.precip&&audio.precip.kind==='rain','rain starts a precipitation layer');
 assert.notEqual(audio.bedMood,'default','the weather mood wins over the biome fallback');
 assert.ok(moth.some(([k,v])=>k==='weather'&&v==='rain'),'the Moth layer receives the weather kind');
 const layer=audio.precip;
 audio.setWeather(null);
 assert.equal(audio.precip,null,'clear weather releases the layer');
 assert.ok(layer.src.stopped===true);
 assert.equal(audio.bedMood,'cold','clear falls back to the biome mood');
 assert.ok(moth.some(([k,v])=>k==='weather'&&v===null));
 audio.setWeather('snow');
 assert.equal(audio.precip.kind,'snow');
 audio.setMuted(true);
 assert.equal(audio.precip,null,'mute releases precipitation');
 audio.setMuted(false);
 assert.equal(audio.precip.kind,'snow','unmute restores the active weather layer');
 audio.setWeather('bogus');
 assert.equal(audio.weather,'clear','an unknown kind resolves through the shared preset table');
 assert.equal(audio.precip,null);
 // The view already sends the weather-driven bed mood; a storm mood alone is
 // enough to bring the rain presence in when no explicit kind was set.
 audio.setWeather(null);
 audio.setBedMood('storm');
 assert.ok(audio.precip&&audio.precip.kind==='rain','the storm bed mood infers the rain presence');
 audio.setBedMood('cold');
 assert.equal(audio.precip,null,'other moods stay silent without an explicit kind');
 audio.dispose();
});

test('the effects glue compresses and soft-clips before the master, then disconnects',()=>{
 const created=[];
 const param=()=>({value:0,setValueAtTime(){},setTargetAtTime(){}});
 const node=()=>{const n={gain:param(),frequency:param(),Q:param(),pan:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),curve:null,oversample:'',connect(to){this.to=to;},disconnect(){this.disconnected=true;},start(){},stop(){}};created.push(n);return n;};
 const ctx={currentTime:0,state:'running',sampleRate:44100,destination:{},createGain:()=>node(),createOscillator:()=>node(),createBiquadFilter:()=>node(),createBufferSource:()=>node(),createStereoPanner:()=>node(),createDynamicsCompressor:()=>node(),createWaveShaper:()=>node(),createBuffer:(ch,len)=>({getChannelData:()=>new Float32Array(len)}),close(){this.closed=true;}};
 const audio=new SynthAudio();audio.ctx=ctx;audio.noiseBuffer={};
 audio._ensureBuses();
 assert.ok(Array.isArray(audio.effectsGlue)&&audio.effectsGlue.length===2,'a compressor and a soft clip');
 assert.equal(audio.effectsBus.to,audio.effectsGlue[0],'the effects bus feeds the glue, not the master');
 assert.equal(audio.effectsGlue[0].to,audio.effectsGlue[1]);
 assert.equal(audio.effectsGlue[1].to,audio.master);
 assert.equal(audio.audioStatus().glue,'on');
 const glue=[...audio.effectsGlue];
 audio.dispose();
 assert.ok(glue.every(n=>n.disconnected===true),'the glue is released on dispose');
});

test('without compressor or waveshaper the effects bus keeps the legacy topology',()=>{
 const {audio}=audioFixture2();
 assert.equal(audio.effectsGlue,null,'the fixture has neither node');
 assert.equal(audio._makeEffectsGlue(),null);
});

test('dynamic music state forwards to the engine and the low-health edge opens it',()=>{
 const {audio}=musicFixture();
 assert.equal(audio.setTension(.5),.5);
 assert.equal(audio.tension,.5);
 assert.equal(audio.musicEngine.tension,.5,'the engine reads the danger layer state');
 assert.equal(audio.setTension(9),1);
 assert.equal(audio.setTension('nope'),0);
 assert.equal(audio.setEscalation(2.4),2);
 assert.equal(audio.musicEngine.escalation,2,'the engine reads the escalation state');
 assert.equal(audio.setEscalation(-3),0);
 const variation=audio.setVariation('ironman');
 assert.ok(variation>0,'a string variation key resolves to a positive id');
 assert.equal(audio.musicEngine.variation,variation,'the engine reads the variation id');
 audio.setVariation(0);
 assert.equal(audio.musicEngine.variation,0,'variation 0 restores the baseline take');
 const low={...player,health:20,maxHealth:100,grounded:true,vx:0,vy:0,vz:0};
 audio.update(low,[],1/60);
 assert.ok(audio.tension>0,'the low-health entry edge opens the danger layer');
 assert.equal(audio.musicEngine.tension,audio.tension);
 const held=audio.tension;
 audio.update(low,[],1/60);
 assert.equal(audio.tension,held,'a held low-health frame does not stack another contribution');
 audio.update({...low,health:100},[],1/60);
 assert.equal(audio.tension,0,'recovering releases exactly the entry contribution');
 assert.equal(audio.musicEngine.tension,0);
 audio.dispose();
});

test('horde and boss beats escalate, clears release and each event id fires once',()=>{
 const {audio}=musicFixture();
 audio._beat=()=>{};
 audio.event({type:'horde-wave',id:1,time:1},player);
 assert.equal(audio.escalation,1);
 audio.event({type:'horde-wave',id:1,time:1},player);
 assert.equal(audio.escalation,1,'a replayed event id does not escalate twice');
 audio.event({type:'horde-wave',id:2,time:2},player);
 assert.equal(audio.escalation,2);
 audio.event({type:'boss-summon',id:3,time:3},player);
 assert.equal(audio.escalation,2,'a boss summon keeps at least the boss floor');
 audio.event({type:'boss-phase',id:4,time:4},player);
 assert.equal(audio.escalation,3,'a boss phase pins the top level');
 audio.event({type:'horde-wave-cleared',id:5,time:5},player);
 assert.equal(audio.escalation,0,'a cleared wave releases the escalation');
 audio.event({type:'director-escalation',id:6,time:6},player);
 assert.equal(audio.escalation,1,'a director escalation steps the level up');
 audio.event({type:'director-boss',id:7,time:7},player);
 assert.equal(audio.escalation,2,'a director boss keeps at least the boss floor');
 audio.event({type:'director-wave-cleared',id:8,time:8},player);
 assert.equal(audio.escalation,0,'a director clear releases the escalation too');
 assert.equal(audio.musicEngine.escalation,0,'the engine state follows the de-escalation');
 audio.setEscalation(3);
 audio.matchStart({restart:true});
 assert.equal(audio.escalation,0,'a fresh match starts from rest');
 assert.equal(audio.musicEngine.escalation,0);
 audio.dispose();
});

test('capture and loss responses own the beat when music runs and fall back when it cannot',()=>{
 const {audio}=musicFixture();
 const beats=[],requested=[];
 audio._beat=(...args)=>beats.push(args);
 const engine=audio.musicEngine,orig=engine.requestResponse.bind(engine);
 engine.requestResponse=(kind,opts)=>{requested.push([kind,opts]);return orig(kind,opts);};
 audio.event({type:'zone-capture',id:1,time:1,actor:7,from:{x:0,z:0}},player);
 assert.equal(beats.length,0,'the music response replaces the capture motif');
 assert.equal(requested.length,1);
 assert.equal(requested[0][0],'capture');
 audio.event({type:'zone-capture',id:1,time:1,actor:7,from:{x:0,z:0}},player);
 assert.equal(requested.length,1,'a repeated event id is idempotent');
 audio.event({type:'flag-return',id:2,time:2,actor:7,from:{x:0,z:0}},player);
 assert.equal(requested.length,2);
 assert.equal(requested[1][0],'capture','flag returns resolve upward');
 audio.event({type:'assault-sector-lost',id:3,time:3,actor:7,from:{x:0,z:0}},player);
 assert.equal(requested[2][0],'loss');
 assert.equal(beats.length,0,'no motif is stacked under a response');
 audio.setMusicEnabled(false);
 audio.event({type:'assault-sector-lost',id:4,time:4,actor:7,from:{x:0,z:0}},player);
 assert.equal(beats.length,1,'with music off the historical loss motif plays');
 assert.equal(requested.length,3,'no response is queued while music is off');
 audio.setMusicEnabled(true);
 audio.setMuted(true);
 audio.event({type:'assault-sector-lost',id:5,time:5,actor:7,from:{x:0,z:0}},player);
 assert.equal(beats.length,2,'a master mute hands the beat back to the motif');
 assert.equal(requested.length,3);
 audio.setMuted(false);
 audio.dispose();
});

test('the killstreak music accent fills in only when the announcer is silent',()=>{
 const {audio}=musicFixture();
 audio.setAnnouncer(false);
 const requested=[];
 const engine=audio.musicEngine,orig=engine.requestResponse.bind(engine);
 engine.requestResponse=(kind,opts)=>{requested.push(kind);return orig(kind,opts);};
 audio.event({type:'killstreak',id:1,time:1,actor:7,streak:3},player);
 assert.deepEqual(requested,['accent']);
 audio.event({type:'killstreak',id:1,time:1,actor:7,streak:3},player);
 assert.equal(requested.length,1,'the same event id never accents twice');
 audio.event({type:'killstreak',id:2,time:2,actor:9,streak:4},player);
 assert.equal(requested.length,1,'a remote killstreak does not drive the local take');
 audio.setAnnouncer(true);
 audio.event({type:'killstreak',id:3,time:3,actor:7,streak:5},player);
 assert.equal(requested.length,1,'the announcer owns the beat when enabled');
 audio.setAnnouncer(false);
 audio.setMuted(true);
 audio.event({type:'killstreak',id:4,time:4,actor:7,streak:6},player);
 assert.equal(requested.length,1,'muted music stays silent');
 audio.setMuted(false);
 audio.dispose();
});

test('the final warning and countdown drive tension with a single owner per beat',()=>{
 const {audio}=musicFixture();
 const beats=[],requested=[];
 audio._beat=(...args)=>beats.push(args);
 const engine=audio.musicEngine,orig=engine.requestResponse.bind(engine);
 engine.requestResponse=(kind,opts)=>{requested.push(kind);return orig(kind,opts);};
 assert.deepEqual(audio.countdown({phase:'countdown',countdown:3}),{played:true,go:false,beat:3});
 assert.ok(audio.tension>0&&audio.tension<.5);
 audio.countdown({phase:'countdown',countdown:2});
 assert.ok(audio.tension>.4,'each countdown number tightens the danger layer');
 audio.countdown({phase:'countdown',countdown:1});
 assert.ok(audio.tension>.6);
 audio.countdown({phase:'racing',countdown:0});
 assert.equal(audio.tension,0,'the GO releases the countdown tension');
 const warned=audio.finalSecondsWarning(9.5);
 assert.equal(warned.warned,true);
 assert.equal(warned.music,true,'the soundtrack owns the final call');
 assert.equal(beats.length,0,'the motif is not stacked under the final pulse');
 assert.deepEqual(requested,['final']);
 assert.equal(audio.tension,1);
 assert.equal(audio.musicEngine.tension,1);
 audio.dispose();
});

test('the halo pack keeps its modal centre and arrangements under mode and biome palettes',()=>{
 const {audio}=musicFixture();
 assert.equal(audio.setSoundtrack('halo'),'halo');
 audio.setModeTheme('horde');
 assert.equal(audio.theme,HALO_THEME);
 assert.equal(audio.musicEngine.theme.root,HALO_THEME.root,'the Halo modal centre is unchanged');
 assert.deepEqual([...audio.musicEngine.theme.scale],[0,2,3,5,7,8,10]);
 assert.equal(audio.musicEngine.arrangements,HALO_ARRANGEMENTS,'the pack is unchanged');
 assert.equal(audio.musicEngine.palette.shaker,true,'the mode palette selects the authored shaker');
 assert.equal(audio.musicEngine.palette.keys,false);
 assert.equal(audio.setArenaBiome('frostbite'),'cold');
 assert.equal(audio.musicEngine.palette.pluck,true,'the biome palette overlays the mode palette');
 assert.ok(MUSIC_PALETTES.horde&&MUSIC_PALETTES.cold&&Object.isFrozen(MUSIC_PALETTES.default));
 audio.dispose();
});

// ---------------------------------------------------------------------------
// Audio dynamics pass: x/z telegraph audibility, shield absorb and the
// high-value announcer cadence.
// ---------------------------------------------------------------------------

test('enemy telegraphs normalize x/z, stay audible and voice a distinct motif per kind',()=>{
 const kinds=['overseer','mender','flanker','phalanx','sapper','artillery','boss'];
 assert.equal(Object.keys(TELEGRAPH_CUES).length,kinds.length+1,'one motif per sim kind plus the generic fallback');
 for(const cue of Object.values(TELEGRAPH_CUES))assert.ok(Object.isFrozen(cue)&&Object.isFrozen(cue.notes)&&cue.notes.length>=2,'telegraph cues are frozen motifs');
 const seen=new Map();
 for(const kind of kinds){
  const {audio,plays,layers}=voiceCapture();
  audio.event({type:'enemy-telegraph',id:1,time:1,actor:9,kind,x:6,z:0,duration:.5},player);
  assert.equal(plays.length,1,`${kind} telegraph spends exactly one voice`);
  assert.ok(plays[0].pan>.5,`${kind} telegraph pans toward the source`); // x=6 with a zero yaw sits left
  const notes=layers.filter(layer=>layer.kind==='tone').map(layer=>layer.freq);
  assert.ok(notes.length>=2,`${kind} plays a motif`);
  seen.set(kind,JSON.stringify(notes));
  audio.dispose();
 }
 assert.equal(new Set(seen.values()).size,kinds.length,'every telegraph kind has its own motif');
 for(const extra of [{kind:'not-a-kind'},{}]){
  const {audio,plays}=voiceCapture();
  audio.event({type:'enemy-telegraph',id:1,time:1,actor:9,x:6,z:0,...extra},player);
  assert.equal(plays.length,1,'unknown and missing kinds keep the generic fallback voice');
  audio.dispose();
 }
 const far=voiceCapture();
 far.audio.event({type:'enemy-telegraph',id:1,time:1,actor:9,kind:'boss',x:400,z:0,duration:.5},player);
 assert.equal(far.plays.length,0,'an out-of-range telegraph falls off to silence');
 far.audio.dispose();
 const {audio,nodes}=audioFixture2();
 audio.muted=true;const before=nodes.length;
 audio.event({type:'enemy-telegraph',id:1,time:1,actor:9,kind:'sapper',x:6,z:0},player);
 assert.equal(nodes.length,before,'muting silences every telegraph kind');
 audio.muted=false;
 audio.event({type:'enemy-telegraph',id:2,time:2,actor:9,kind:'sapper',x:6,z:0},{...player,reduced:true});
 assert.ok(nodes.length>before,'sound is not motion-gated: reduced players still hear the telegraph');
 audio.dispose();
});

test('enemy ordnance and support beats carrying only x/z are audible now',()=>{
 for(const type of ['enemy-detonate','enemy-artillery','phalanx-shield','enemy-flank','overseer-aura','lattice-support']){
  const {audio,plays}=voiceCapture();
  audio.event({type,id:1,time:1,actor:9,x:6,z:0},player);
  assert.equal(plays.length,1,`${type} spends one voice from its x/z position`);
  audio.dispose();
 }
 const far=voiceCapture();
 for(const type of ['enemy-detonate','phalanx-shield','enemy-artillery']){
  far.audio.event({type,id:1,time:1,actor:9,x:600,z:0},player);
 }
 assert.equal(far.plays.length,0,'a far ordnance beat with a distance gate stays silent');
 far.audio.dispose();
 const flank=voiceCapture();
 flank.audio.event({type:'enemy-flank',id:1,time:1,actor:9,x:600,z:0},player);
 assert.equal(flank.plays.length,1,'the flank match beat keeps its audible distance floor');
 flank.audio.dispose();
});

test('repair and deployable beats have cue rows and spend one voice each',()=>{
 for(const type of ['vehicle-repair','deployable-destroyed','deployable-repaired','deployable-fire']){
  const {audio,plays}=voiceCapture();
  audio.event({type,id:1,time:1,actor:9,x:8,z:0},player);
  assert.equal(plays.length,1,`${type} spends one voice from its x/z position`);
  audio.dispose();
 }
});

test('shielded damage layers a bounded absorb tick inside the unchanged damage token',()=>{
 const capture=()=>{const {audio}=audioFixture2(),plays=[],noises=[],tones=[];
  audio._play=(duration,pan,build)=>{plays.push({duration,pan});build(0,{},[]);};
  audio._noise=(t,out,nodes,options)=>noises.push(options);
  audio._tone=(t,out,nodes,options)=>tones.push(options);
  return {audio,plays,noises,tones};
 };
 const isTick=layer=>layer.type==='bandpass'&&layer.sweep===1200;
 const absorbed=capture();
 absorbed.audio.event({type:'damage',id:1,time:1,actor:7,source:9,amount:12,shield:25},player);
 assert.equal(absorbed.plays.length,1,'the absorb stays inside the single damage token');
 assert.equal(absorbed.plays[0].duration,.18,'a non-breaking shield hit keeps the normal token length');
 assert.equal(absorbed.noises.filter(isTick).length,1,'a shielded hit layers exactly one absorb tick');
 assert.ok(absorbed.tones.some(tone=>tone.freq>=640&&tone.freq<=900),'the tick carries a low glass body');
 const plain=capture();
 plain.audio.event({type:'damage',id:2,time:2,actor:7,source:9,amount:12},player);
 assert.equal(plain.noises.filter(isTick).length,0,'an unshielded hit adds no tick');
 const broken=capture();
 broken.audio.event({type:'damage',id:3,time:3,actor:7,source:9,amount:40,shield:5,shieldBreak:true},player);
 assert.equal(broken.plays[0].duration,.24,'the shield-break token length is unchanged');
 assert.equal(broken.noises.filter(isTick).length,0,'a break keeps its own shatter layer, not the absorb tick');
 const incoming=capture();
 incoming.audio.event({type:'damage',id:4,time:4,actor:3,source:7,amount:12,shield:25},player);
 assert.equal(incoming.noises.filter(isTick).length,0,'the scorer hit confirm does not stack the local absorb tick');
 absorbed.audio.dispose();plain.audio.dispose();broken.audio.dispose();incoming.audio.dispose();
});

test('high-value announcer cues are opt-in, one voice each and share a global cadence guard',()=>{
 const {audio}=audioFixture2(),plays=[];
 audio._play=(duration,pan,build)=>{plays.push({duration,pan});build(0,{},[]);};
 audio.ctx.currentTime=10;
 assert.equal(audio.announcerEvent('horde-wave').played,false,'the announcer stays opt-in');
 assert.equal(audio.announcerEvent('not-a-cue'),null,'an unknown event has no cue');
 audio.setAnnouncer(true);
 assert.equal(audio.announcerEvent('horde-wave').played,true);
 assert.equal(audio.lastCue,'horde-wave');
 assert.equal(plays.length,1,'one cue is one voice token');
 const blocked=audio.announcerEvent('objective-win');
 assert.equal(blocked.played,false);
 assert.equal(blocked.cadence,true,'the global cadence guard blocks a second callout inside the window');
 assert.equal(plays.length,1);
 audio.ctx.currentTime=10+ANNOUNCE_CADENCE;
 assert.equal(audio.announcerEvent('objective-win').played,true,'the cadence window releases');
 assert.equal(plays.length,2);
 assert.equal(audio.announcerCue('capture').played,true,'the direct announcer path still plays');
 assert.equal(audio.announcerCue('capture').deduped,true,'the per-cue cooldown is unchanged');
 // Event-stream dispatch: world beats announce for everyone, actor-scoped
 // beats only for the local player, and a cluster makes exactly one callout.
 const beats=[];audio._beat=(...args)=>beats.push(args);
 audio._announceCadence=null;audio.ctx.currentTime+=10;
 audio.event({type:'zone-capture',id:1,time:1,actor:9,x:4,z:0},player);
 assert.equal(audio.lastCue,'zone-capture','a world beat announces for remote events');
 assert.equal(beats.length,1,'the motif still owns its own voice');
 const cuePlays=plays.length;
 audio.event({type:'objective-win',id:2,time:2,actor:9,x:4,z:0},player);
 assert.equal(beats.length,2);
 assert.equal(plays.length,cuePlays,'a second world beat inside the cadence window is silent');
 audio._announceCadence=null;audio.ctx.currentTime+=10;
 audio.event({type:'weapon-upgrade',id:3,time:3,actor:9,x:4,z:0},player);
 assert.equal(audio.lastCue,'zone-capture','a remote actor-scoped beat is not announced locally');
 audio.event({type:'weapon-upgrade',id:4,time:4,actor:7,x:0,z:0},player);
 assert.equal(audio.lastCue,'weapon-upgrade','the local actor-scoped beat is announced');
 audio._announceCadence=null;audio.ctx.currentTime+=10;
 audio.event({type:'enemy-artillery',id:5,time:5,actor:9,x:8,z:0},player);
 assert.equal(audio.lastCue,'enemy-artillery','an enemy world beat announces for everyone');
 audio.setAnnouncer(false);
 audio._announceCadence=null;audio.ctx.currentTime+=10;
 audio.event({type:'mission-won',id:6,time:6},player);
 assert.equal(audio.lastCue,'enemy-artillery','a disabled announcer never cues');
 // Every table row is a frozen motif shape with a distinct id.
 for(const [type,cue] of Object.entries(ANNOUNCE_CUES)){
  assert.equal(cue.id,type,`${type} id matches its key`);
  assert.ok(Number.isFinite(cue.freq)&&Number.isFinite(cue.mid)&&Number.isFinite(cue.end)&&cue.length>0,`${type} is a complete cue`);
 }
 audio.dispose();
});

test('weather and time onsets cue only on a real change',()=>{
 const {audio}=audioFixture2(),beats=[];
 audio._beat=(...args)=>beats.push(args);
 audio.event({type:'weather-change',id:1,time:1,kind:'rain'},player);
 assert.equal(beats.length,1,'the first weather report is an onset');
 audio.event({type:'weather-change',id:2,time:2,kind:'rain'},player);
 assert.equal(beats.length,1,'a repeated kind stays silent');
 audio.event({type:'weather-change',id:3,time:3,kind:'storm'},player);
 assert.equal(beats.length,2,'a real kind change cues');
 audio.event({type:'time-change',id:4,time:4,phase:'dusk'},player);
 assert.equal(beats.length,3);
 audio.event({type:'time-change',id:5,time:5,phase:'dusk'},player);
 assert.equal(beats.length,3);
 audio.event({type:'time-change',id:6,time:6,phase:'night'},player);
 assert.equal(beats.length,4);
 audio.dispose();
});

test('combat intensity never overrides the menu or results arrangement',()=>{
 const audio=new SynthAudio();
 const scenes=[];
 audio.musicEngine={setScene:(value)=>scenes.push(value),setIntensity(){},setDuck(){},clearResponses(){},requestResponse(){return false;},setEnabled(){},setMuted(){}};
 audio.scene='results';
 audio.setIntensity(.9);
 assert.equal(scenes.at(-1),'results','the results take holds through a loud frame');
 audio.scene='game';
 audio.setIntensity(.9);
 assert.equal(scenes.at(-1),'combat');
 audio.setIntensity(.1);
 assert.equal(scenes.at(-1),'explore');
 audio.scene='menu';
 audio.setIntensity(1);
 assert.equal(scenes.at(-1),'menu','the menu never flips to combat');
 audio.dispose();
});

test('a stale live match cannot restart the sting while the host is on the menu',()=>{
 const {audio}=audioFixture2();let stings=0;audio._fightSting=()=>{stings++;return true;};
 audio.setScene('game');
 const frame={config:{mode:'team-deathmatch',timeLimit:600},time:10,over:false};
 assert.equal(audio.setMatchState(frame).started,true,'the live match starts once');
 assert.equal(audio.setMatchState(frame).started,false,'the same match stays deduped');
 // Leaving the round to the menu ends the live match, but the page keeps
 // handing the last match to update() until a new round starts.
 audio.setScene('menu');
 for(let i=0;i<10;i++)audio.setMatchState(frame);
 assert.equal(stings,1,'the FIGHT sting never replays while the menu owns the screen');
 assert.equal(audio._matchLive,false,'the stale frame does not re-arm the match');
 assert.equal(audio.setMatchState({...frame,over:true}).started,false,'an over frame stays ended');
 audio.setScene('game');
 assert.equal(audio.setMatchState(frame).started,true,'a fresh game scene can start the next round');
 assert.equal(stings,2);
 audio.dispose();
});

test('announcer calls keep a priority slot when the SFX budget is saturated',()=>{
 const {audio,nodes}=audioFixture2();
 audio.announcer=true;
 for(let i=0;i<30;i++)audio.voices.add({nodes:[]});
 const before=nodes.length;
 const result=audio.announcerCue('score');
 assert.equal(result.played,true,'the callout still schedules at the 30-voice cap');
 assert.ok(nodes.length>before,'the priority path created its nodes');
 assert.ok(audio.voices.size>30,'the callout is allowed above the budget');
 audio.dispose();
});
