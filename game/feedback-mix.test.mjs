import test from 'node:test';
import assert from 'node:assert/strict';
import {SynthAudio,ENGINE_PROFILES,engineVoice,THUNDER_RECIPES,thunderRecipeFor} from './feedback.mjs';

// Audio-dynamics wave: master mix stage, ducking, engine/skid foley and the
// seeded thunder recipes. These tests build the real bus graph through
// _ensureBuses and capture eased parameter targets, so no wall clock or
// randomness is involved in the musical decisions.

const player={id:7,weapon:0,x:0,z:0,yaw:0,grounded:true,vx:0,vy:0,vz:0,health:100,maxHealth:100};

// A context whose AudioParams record the last setTargetAtTime target, so eased
// values are observable without a running clock. `biquad:false` omits the
// master filter factory to exercise the fallback chain.
function mixFixture({biquad=true}={}){
 const nodes=[];
 const param=(value=0)=>({value,target:undefined,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(target){this.target=target;},cancelScheduledValues(){}});
 const node=extra=>{const n={frequency:param(),gain:param(),Q:param(),pan:param(),type:'',buffer:null,loop:false,connect(to){this.to=to;},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;},...extra};nodes.push(n);return n;};
 const ctx={currentTime:0,state:'running',sampleRate:44100,destination:{},
  createOscillator:()=>node({type:'sine'}),createGain:()=>node(),
  createBufferSource:()=>node({}),createStereoPanner:()=>node(),
  createBuffer:(channels,length)=>({getChannelData:()=>new Float32Array(length)}),
  resume(){this.state='running';return Promise.resolve();},close(){this.closed=true;}};
 if(biquad)ctx.createBiquadFilter=()=>node({type:'lowpass'});
 const audio=new SynthAudio();
 audio.ctx=ctx;audio.noiseBuffer={};
 audio._ensureBuses();
 return {audio,ctx,nodes};
}

test('the music duck is bounded, applied by announcer cues and releases on its timer',async()=>{
 const {audio}=mixFixture();
 const ducks=[];
 audio.musicEngine={setDuck(value){ducks.push(value);return value;}};
 assert.equal(audio._duckMusic(.6,80),.6);
 assert.equal(ducks.at(-1),.6,'the duck amount reaches the soundtrack');
 assert.equal(audio.audioStatus().duck,.6);
 assert.equal(audio._duckMusic(5,80),1,'the duck amount clamps to one');
 await new Promise(resolve=>setTimeout(resolve,140));
 assert.equal(ducks.at(-1),0,'the duck releases after its window');
 assert.equal(audio.audioStatus().duck,0);
 assert.equal(audio._duckMusic(.4,60),.4,'a fresh duck after release applies again');
 audio.setAnnouncer(true);audio.ctx.currentTime=5;
 audio.announcerCue('goal');
 assert.ok(ducks.includes(.32),'an announcer cue ducks the soundtrack under the callout');
 audio.ctx.currentTime=9;
 audio.event({type:'explosion',id:1,time:1,actor:7,pos:{x:0,z:0}},player);
 assert.ok(ducks.includes(.5),'a local explosion ducks the soundtrack');
 const ducksBefore=ducks.length;
 audio.event({type:'explosion',id:2,time:2,actor:9,pos:{x:30,z:0}},player);
 assert.equal(ducks.length,ducksBefore,'a remote explosion never ducks the local mix');
 audio.dispose();
});

test('the master filter sits between the master and mute gains with neutral defaults',()=>{
 const {audio}=mixFixture();
 assert.ok(audio.masterFilter&&audio.mixGain,'the biquad and mix gain are built');
 assert.equal(audio.master.to,audio.masterFilter);
 assert.equal(audio.masterFilter.to,audio.mixGain);
 assert.equal(audio.mixGain.to,audio.muteGain);
 assert.equal(audio.masterFilter.type,'lowpass');
 assert.equal(audio.masterFilter.frequency.value,20000,'the default cutoff is wide open');
 assert.equal(audio.mixGain.gain.value,1,'the default mix level is unity');
 const status=audio.audioStatus();
 assert.equal(status.filter,'on');
 assert.equal(status.cutoff,20000);
 assert.equal(status.mixLevel,1);
 assert.equal(status.killcam,false);
 assert.equal(status.spectating,false);
 const filter=audio.masterFilter,mix=audio.mixGain;
 audio.dispose();
 assert.ok(filter.disconnected===true&&mix.disconnected===true,'the master stage is released on dispose');
});

test('without createBiquadFilter the master chain falls back cleanly and stays neutral',()=>{
 const {audio}=mixFixture({biquad:false});
 assert.equal(audio.masterFilter,null,'no biquad is built without the factory');
 assert.ok(audio.mixGain,'the mix gain still carries the level profile');
 assert.equal(audio.master.to,audio.mixGain);
 assert.equal(audio.mixGain.to,audio.muteGain);
 assert.equal(audio.audioStatus().filter,'off');
 assert.equal(audio.setKillcam(true),true,'killcam still applies with no biquad');
 assert.equal(audio.audioStatus().killcam,true);
 assert.equal(audio._mixCutoff,650);
 assert.equal(audio.setKillcam(false),false);
 audio.dispose();
});

test('setKillcam and setSpectating are idempotent mix profiles with one sub drop',()=>{
 const {audio}=mixFixture();
 const ducks=[];
 audio.musicEngine={setDuck(value){ducks.push(value);return value;}};
 const plays=[];
 audio._play=(duration,pan,build,opts)=>{plays.push({duration,pan,send:opts?.send});build?.(0,{},[]);};
 assert.equal(audio.setKillcam(true),true);
 assert.equal(audio.audioStatus().killcam,true);
 assert.equal(audio._mixCutoff,650);
 assert.equal(audio._mixLevel,.7);
 assert.equal(audio.masterFilter.frequency.target,650,'the cutoff eases to the killcam value');
 assert.equal(audio.mixGain.gain.target,.7,'the level eases to the killcam value');
 assert.equal(plays.length,1,'the killcam sub drop is one voice');
 assert.equal(audio.setKillcam(true),true,'a repeated killcam state is idempotent');
 assert.equal(plays.length,1,'a repeated killcam spends no new voice');
 assert.equal(ducks.at(-1),.6,'the killcam ducks the soundtrack');
 assert.equal(audio.setSpectating(true),true);
 assert.equal(audio.spectating,true);
 assert.equal(audio._mixCutoff,650,'an active killcam owns the mix over spectating');
 assert.equal(audio.setKillcam(false),false);
 assert.equal(audio._mixCutoff,6000,'clearing the killcam falls back to the spectate profile');
 assert.equal(audio._mixLevel,.86);
 assert.equal(audio.setSpectating(true),true,'spectating is idempotent');
 assert.equal(audio._mixLevel,.86);
 assert.equal(audio.setSpectating(false),false);
 assert.equal(audio._mixCutoff,20000,'leaving spectate restores the neutral profile');
 assert.equal(audio._mixLevel,1);
 assert.equal(audio.setKillcam(false),false,'a repeated killcam release is idempotent');
 audio.dispose();
});

test('engine timbres are keyed by vehicle kind with gear banding and a boost layer',()=>{
 for(const profile of Object.values(ENGINE_PROFILES))assert.ok(Object.isFrozen(profile),'engine profiles are immutable');
 const kinds=['puma','hornet','titan','scout','transport'];
 const signatures=new Set();
 for(const kind of kinds){
  const voice=engineVoice(kind,10,false);
  assert.equal(voice.kind,kind);
  assert.ok(voice.oscFreq>0&&voice.subFreq>0&&voice.filterFreq>0&&voice.gain>0,`${kind} voice is finite`);
  signatures.add(`${voice.oscFreq.toFixed(3)}:${voice.subFreq.toFixed(3)}:${voice.filterFreq.toFixed(3)}`);
 }
 assert.equal(signatures.size,kinds.length,'every vehicle kind has its own engine voice');
 assert.equal(engineVoice('not-a-kind',10,false).profile,ENGINE_PROFILES.default);
 assert.equal(engineVoice(null,10,false).kind,'default');
 // The historical numbers survive exactly for an unknown/legacy kind.
 const s=.5;
 assert.ok(Math.abs(engineVoice('guntruck',10,false).oscFreq-(55+s*120))<1e-9);
 assert.ok(Math.abs(engineVoice('guntruck',10,false).subFreq-(28+s*40))<1e-9);
 assert.ok(Math.abs(engineVoice('guntruck',10,false).gain-(.022+s*.05))<1e-9);
 assert.ok(Math.abs(engineVoice('guntruck',10,true).gain-(.022+s*.05)*1.2)<1e-9);
 // Gear banding: the pitch climbs inside a gear and drops at the shift.
 const below=engineVoice('puma',20*(1/4-.002),false),above=engineVoice('puma',20*(1/4+.002),false),slower=engineVoice('puma',20*(1/4-.004),false);
 assert.equal(below.gear,0);assert.equal(above.gear,1);
 assert.ok(slower.oscFreq<below.oscFreq,'the pitch climbs inside a gear');
 assert.ok(above.oscFreq<below.oscFreq,'a gear shift drops the engine pitch band');
 assert.ok(engineVoice('puma',7.4,false).oscFreq>below.oscFreq,'the next gear climbs past the previous top');
 // Boost opens the overtone and lifts the body.
 const boost=engineVoice('puma',10,true),plain=engineVoice('puma',10,false);
 assert.ok(boost.oscFreq>plain.oscFreq&&boost.gain>plain.gain,'boost shifts the engine up');
 assert.notEqual(engineVoice('titan',10,true).oscFreq,plain.oscFreq);
});

test('the running engine and puma skid loop are long-lived eased nodes, never per-frame voices',async()=>{
 const {audio}=mixFixture();
 const plays=[];audio._play=(...args)=>{plays.push(args);};
 audio._engine(10,true,false,'puma');
 assert.ok(audio.engine&&audio.engine.boost&&audio.engine.bg,'the profile engine owns its boost layer');
 assert.equal(audio.engine.kind,'puma');
 assert.equal(audio.engine.osc.frequency.target,engineVoice('puma',10,false).oscFreq);
 assert.equal(audio.engine.bg.gain.target,.0001,'the boost layer starts closed');
 const engine=audio.engine;
 audio._engine(10,true,true,'puma');
 assert.equal(audio.engine,engine,'the engine node set is reused while active');
 assert.ok(audio.engine.bg.gain.target>0,'boosting opens the overtone layer');
 assert.equal(plays.length,0,'the engine never spends a per-frame voice token');
 assert.equal(audio._skidLoop(true,8,'puma'),true);
 assert.ok(audio.skidLoop,'the puma slip builds the eased skid loop');
 const skid=audio.skidLoop;
 assert.equal(audio._skidLoop(true,9,'puma'),true);
 assert.equal(audio.skidLoop,skid,'the skid loop is reused, never recreated per frame');
 assert.equal(plays.length,0,'the skid loop spends no voice token');
 assert.equal(audio._skidLoop(true,8,'titan'),false,'a non-skid chassis never builds the loop');
 assert.equal(audio.skidLoop,null);
 audio.muted=true;
 assert.equal(audio._skidLoop(true,8,'puma'),false,'muting keeps the skid loop unbuilt');
 assert.equal(audio.skidLoop,null);
 audio.muted=false;
 assert.equal(audio._skidLoop(true,8,'puma'),true);
 const stopped=audio.skidLoop;
 assert.equal(audio._skidLoop(false),false);
 assert.equal(audio.skidLoop,null);
 audio._engine(0,false);
 assert.equal(audio.engine,null);
 await new Promise(resolve=>setTimeout(resolve,360));
 assert.ok(stopped.osc.stopped===true&&stopped.hum.stopped===true,'the released skid oscillators stop');
 assert.ok(engine.osc.stopped===true&&engine.sub.stopped===true&&engine.boost.stopped===true,'the released engine oscillators stop');
 audio.dispose();
});

test('update feeds the snapshot vehicle kind into the engine and derives skid from lateral slip',()=>{
 const {audio}=mixFixture();
 const riding={...player,vehicleId:'puma-1'};
 audio.update(riding,[{id:'puma-1',kind:'puma',yaw:0,vx:0,vz:10,driver:7}],1/60);
 assert.ok(audio.engine&&audio.engine.kind==='puma','the snapshot kind selects the engine timbre');
 assert.equal(audio.skidLoop,null,'a straight-line Puma does not skid');
 audio.update(riding,[{id:'puma-1',kind:'puma',yaw:0,vx:6,vz:0,driver:7}],1/60);
 assert.ok(audio.skidLoop,'a lateral slip opens the puma skid loop');
 audio.update(riding,[{id:'puma-1',kind:'titan',yaw:0,vx:6,vz:0,driver:7}],1/60);
 assert.equal(audio.skidLoop,null,'the skid loop follows the active chassis kind');
 // Health eases the optional master stage.
 audio.update({...riding,vehicleId:null,health:20},[],1/60);
 assert.ok(audio._mixCutoff<20000,'low health darkens the master mix');
 assert.ok(audio._mixLevel<1,'low health lowers the master mix level');
 audio.update({...player,health:100},[],1/60);
 assert.equal(audio._mixCutoff,20000,'full health restores the neutral cutoff');
 assert.equal(audio._mixLevel,1,'full health restores the neutral level');
 audio.dispose();
});

test('shell casings are one seeded metallic token on a bounded cadence',()=>{
 const capture=(seed,surface)=>{const {audio}=mixFixture(),layers=[];
  audio._play=(duration,pan,build)=>{build(0,{},[]);};
  audio._noise=(t,out,nodes,options)=>layers.push({kind:'noise',...options});
  audio._tone=(t,out,nodes,options)=>layers.push({kind:'tone',...options});
  const result=audio.shellCasing(0,seed,surface);
  audio.dispose();
  return {layers,result};
 };
 const first=capture(11,'metal');
 assert.equal(first.result,true);
 assert.ok(first.layers.some(layer=>layer.kind==='tone'&&layer.freq>1500),'the casing is a bright tinkle');
 assert.deepEqual(capture(11,'metal').layers,first.layers,'the same seed synthesizes identically');
 assert.notDeepEqual(capture(12,'metal').layers,first.layers,'the seed shifts the spin pitch');
 const metal=capture(7,'metal').layers,grass=capture(7,'grass').layers;
 assert.ok(metal.find(layer=>layer.kind==='tone').freq>grass.find(layer=>layer.kind==='tone').freq,'metal casings ring brighter than grass');
 const {audio}=mixFixture(),plays=[];
 audio._play=(duration,pan)=>{plays.push({duration,pan});return 1;};
 assert.equal(audio.shellCasing(0,1,'metal'),true);
 assert.equal(plays.length,1,'one casing is one voice token');
 assert.equal(audio.shellCasing(0,2,'metal'),false,'a second casing inside the cadence is dropped');
 assert.equal(plays.length,1);
 audio.ctx.currentTime+=.05;
 assert.equal(audio.shellCasing(0,1,'metal'),true,'the cadence releases');
 assert.equal(plays.length,2);
 audio.muted=true;
 assert.equal(audio.shellCasing(0,1,'metal'),false,'mute gates the casing');
 audio.muted=false;
 audio.ctx.currentTime+=.05;
 assert.equal(audio.shellCasing(0,1,'metal'),true,'a muted call does not consume the cadence slot');
 audio.dispose();
});

test('thunder recipes are frozen, seeded deterministically and keep the unseeded roll',async()=>{
 assert.ok(THUNDER_RECIPES.length>=2&&THUNDER_RECIPES.length<=3,'two or three frozen recipes');
 assert.ok(THUNDER_RECIPES.every(recipe=>Object.isFrozen(recipe)));
 assert.equal(thunderRecipeFor(null),THUNDER_RECIPES[0]);
 assert.equal(thunderRecipeFor(undefined),THUNDER_RECIPES[0]);
 assert.equal(thunderRecipeFor('nonsense'),THUNDER_RECIPES[0]);
 assert.equal(thunderRecipeFor(3),thunderRecipeFor(3),'the same seed resolves the same recipe');
 const reachable=new Set();
 for(let seed=0;seed<256;seed++)reachable.add(thunderRecipeFor(seed));
 assert.equal(reachable.size,THUNDER_RECIPES.length,'every recipe is reachable from a seed');
 const seedFor=recipe=>{for(let seed=0;seed<1024;seed++)if(thunderRecipeFor(seed)===recipe)return seed;return 0;};
 const capture=async (seed,positional=false)=>{const {audio}=mixFixture(),layers=[];
  audio._play=(duration,pan,build)=>{build(0,{},[]);};
  audio._noise=(t,out,nodes,options)=>layers.push({kind:'noise',...options});
  audio._tone=(t,out,nodes,options)=>layers.push({kind:'tone',...options});
  const base={distance:0,pan:0,intensity:1};
  const played=positional?audio.thunder(base.pan,base.distance,base.intensity,seed):audio.thunder(seed==null?base:{...base,seed});
  assert.equal(played,true);
  await new Promise(resolve=>setTimeout(resolve,140));
  audio.dispose();
  return layers;
 };
 const legacy=await capture(null);
 assert.ok(legacy.length>=5,'the historical roll still carries its full layer set');
 assert.deepEqual(await capture(seedFor(THUNDER_RECIPES[0])),legacy,'a recipe-0 seed reproduces the historical roll');
 for(const recipe of THUNDER_RECIPES.slice(1)){
  const variant=await capture(seedFor(recipe));
  assert.notDeepEqual(variant,legacy,'a seeded recipe differs from the historical roll');
  assert.deepEqual(await capture(seedFor(recipe)),variant,'the same seed is deterministic');
 }
 const positional=await capture(seedFor(THUNDER_RECIPES[1]),true);
 assert.deepEqual(positional,await capture(seedFor(THUNDER_RECIPES[1])),'the positional form matches the object form');
});
