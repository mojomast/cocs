import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicEngine,ARRANGEMENTS,CHORD_PROGRESSIONS,MUSIC_SCENES,SOUNDTRACKS,HALO_ARRANGEMENTS,HALO_PROGRESSIONS} from './music.mjs';

// Minimal Web Audio mock with a controllable clock. Every created node records
// whether it was connected, started, stopped and disconnected.
function mockContext(){
 const nodes=[];
 const param=(v=0)=>({value:v,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(v2){this.value=v2;},cancelScheduledValues(){}});
 const node=extra=>{const n={frequency:param(),gain:param(),Q:param(),type:'',connect(){this.connected=true;},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;},...extra};nodes.push(n);return n;};
 return {currentTime:0,state:'running',sampleRate:44100,destination:{},nodes,
  createGain:()=>node(),createOscillator:()=>node({type:'sine'})};
}
const theme={root:58,scale:[0,3,5,7]};
function engine(overrides={}){
 const ctx=overrides.ctx||mockContext();
 const e=new MusicEngine({ctx,destination:ctx.destination,theme,...overrides});
 return {e,ctx};
}

test('arrangements share a tonal centre and carry bass, percussion and higher content',()=>{
 assert.deepEqual([...MUSIC_SCENES],['menu','explore','combat','results']);
 for(const [scene,arr] of Object.entries(ARRANGEMENTS)){
  assert.ok(arr.bpm>=80&&arr.bpm<=140,`${scene} tempo is musical`);
  assert.ok(arr.bass.length>0,`${scene} has bass`);
  assert.ok(arr.kick.length>0,`${scene} has a kick`);
  assert.ok(arr.arp.length>0,`${scene} has an arpeggio`);
  assert.ok(CHORD_PROGRESSIONS[scene]?.length>=4,`${scene} has a four-bar progression`);
  assert.equal(arr.bass[0][1],0,`${scene} starts on the tonic`);
 }
 assert.ok(ARRANGEMENTS.combat.snare.length>0,'combat has a backbeat');
 assert.ok(ARRANGEMENTS.combat.hat.length>=4,'combat has higher-frequency hats');
 assert.ok(ARRANGEMENTS.menu.pad&&ARRANGEMENTS.explore.pad,'menu and explore carry a pad');
 assert.ok(ARRANGEMENTS.combat.bpm>ARRANGEMENTS.menu.bpm,'combat is faster than the menu');
});

test('the soundtrack schedules continuously in a quiet menu without any intensity',()=>{
 const {e,ctx}=engine();
 e.setScene('menu');
 let scheduled=0;
 for(let i=0;i<60;i++){ctx.currentTime+=.05;scheduled+=e.tick();}
 assert.ok(scheduled>=6,'music is scheduled from a quiet menu');
 assert.ok(e.notesScheduled>0);
 assert.ok(e.voices.length<=e.maxVoices,'simultaneous voices are bounded');
 assert.equal(e.status(),'playing');
});

test('look-ahead is bounded per tick and recovers from suspension without a backlog',()=>{
 const {e,ctx}=engine();
 e.setScene('combat');e.setIntensity(1);
 const first=e.tick();
 assert.ok(first<=8,`one tick schedules at most a bounded run of steps (${first})`);
 // A suspended tab advances currentTime by many seconds at once.
 const before=e.notesScheduled;
 ctx.currentTime+=20;
 const after=e.tick();
 assert.ok(after<=8,'a suspension gap does not fire a backlog of notes');
 assert.ok(e.notesScheduled-before<=8,'the scheduler is bounded after a long pause');
 assert.ok(Number.isFinite(e.nextTime)&&e.nextTime>=ctx.currentTime-0.5,'the transport resumes near the current time');
});

test('scene and intensity crossfade the arrangement buses instead of hard switching',()=>{
 const {e,ctx}=engine();
 e.setScene('menu');e.tick();
 assert.ok(e.buses.menu.gain.value>0&&e.buses.combat.gain.value<=0.01,'menu only');
 e.setScene('combat');e.setIntensity(0);e.tick();
 assert.ok(e.buses.explore.gain.value>0,'quiet combat scene falls back to exploration material');
 e.setIntensity(1);e.tick();
 assert.ok(e.buses.combat.gain.value>0,'a loud fight brings the combat layer up');
 assert.equal(e._activeScene(),'combat');
});

test('ducking lowers the music bus and releases cleanly',()=>{
 const {e,ctx}=engine();
 e.setScene('menu');
 for(let i=0;i<10;i++){ctx.currentTime+=.03;e.tick();}
 e.setDuck(1);ctx.currentTime+=1;e.tick();
 assert.equal(e.duck,1);
 e.setDuck(0);ctx.currentTime+=1;e.tick();
 assert.equal(e.duck,0);
});

test('disposal stops and disconnects every held note and bus',()=>{
 const {e,ctx}=engine();
 e.setScene('combat');e.setIntensity(1);
 for(let i=0;i<8;i++){ctx.currentTime+=.05;e.tick();}
 const held=e.voices.map(r=>r.o);
 assert.ok(held.length>0,'notes are held before disposal');
 const buses=Object.values(e.buses);
 e.dispose();
 assert.equal(e.ctx,null);
 assert.equal(e.voices.length,0);
 assert.ok(held.every(n=>n.stopped===true&&n.disconnected===true),'held notes were stopped and disconnected');
 assert.ok(buses.every(b=>b.disconnected===true),'the buses were disconnected');
});

// Real synthesis check, only where the browser provides OfflineAudioContext. In
// Node this is skipped; in a browser/Playwright run it proves the soundtrack
// produces non-silent output without excessive peaks.
test('offline render produces non-silent, non-clipping output when Web Audio is available',async t=>{
 if(typeof globalThis.OfflineAudioContext!=='function'){t.skip('OfflineAudioContext unavailable in this environment');return;}
 const ctx=new globalThis.OfflineAudioContext(1,44100,44100);
 const e=new MusicEngine({ctx,destination:ctx.destination,theme});
 e.setScene('combat');e.setIntensity(1);
 // Drive the scheduler across the render window, then render.
 const renderPromise=ctx.startRendering();
 for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,5));e.tick();}
 const buffer=await renderPromise;
 const data=buffer.getChannelData(0);
 let peak=0,energy=0;
 for(let i=0;i<data.length;i++){const v=Math.abs(data[i]);if(v>peak)peak=v;energy+=data[i]*data[i];}
 assert.ok(energy>1e-6,'the soundtrack is not silent');
 assert.ok(peak<=1.5,'the soundtrack does not grossly clip');
 e.dispose();
});

// The same render check with every expansion armed (tension tremolo, escalated
// short form, palette colour and a seeded variation). Skipped in Node for the
// same reason as the baseline check; in a browser it proves the added layers
// still render non-silent and inside the soft ceiling.
test('an expanded take renders non-silent and non-clipping when Web Audio is available',async t=>{
 if(typeof globalThis.OfflineAudioContext!=='function'){t.skip('OfflineAudioContext unavailable in this environment');return;}
 const ctx=new globalThis.OfflineAudioContext(1,44100,44100);
 const e=new MusicEngine({ctx,destination:ctx.destination,theme,seed:11});
 e.setScene('combat');e.setIntensity(1);
 e.setTension(1);e.setEscalation(3);e.setPalette('horde');e.setVariation('ironman');
 const renderPromise=ctx.startRendering();
 for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,5));e.tick();}
 const buffer=await renderPromise;
 const data=buffer.getChannelData(0);
 let peak=0,energy=0;
 for(let i=0;i<data.length;i++){const v=Math.abs(data[i]);if(v>peak)peak=v;energy+=data[i]*data[i];}
 assert.ok(energy>1e-6,'the expanded soundtrack is not silent');
 assert.ok(peak<=1.5,'the expanded soundtrack does not grossly clip');
 assert.ok(e.voices.length<=e.maxVoices);
 e.dispose();
});

test('the halo soundtrack pack is original modal material and swaps cleanly',()=>{
 const {e,ctx}=engine();
 assert.equal(e.arrangements,ARRANGEMENTS,'the baseline pack is the default');
 assert.equal(e.setSoundtrack('halo'),'halo');
 assert.deepEqual([...e.theme.scale],[0,2,3,5,7,8,10],'D natural minor');
 assert.ok(e.arrangements.menu.choir&&e.arrangements.menu.drone,'halo carries a choir pad and drone');
 assert.ok(e.arrangements.menu.taiko.length>0,'halo has tribal percussion');
 assert.ok(e.arrangements.menu.bpm<=72&&e.arrangements.combat.bpm<100,'halo is slow and ritualistic');
 e.setScene('menu');
 let scheduled=0;
 for(let i=0;i<80;i++){ctx.currentTime+=.05;scheduled+=e.tick();}
 assert.ok(scheduled>0&&e.notesScheduled>0,'the halo pack schedules continuously');
 assert.equal(e.setSoundtrack('bogus'),'default','an unknown pack falls back');
 assert.equal(e.arrangements,ARRANGEMENTS);
});

test('setReverb is a safe no-op without a convolver and attaches when available',()=>{
 const plain=engine();
 assert.equal(plain.e.setReverb({}),false,'no convolver means no reverb');
 const ctx=mockContext();
 ctx.createConvolver=()=>({connect(){this.connected=true;},disconnect(){this.disconnected=true;},buffer:null});
 const e=new MusicEngine({ctx,destination:ctx.destination,theme});
 e.setSoundtrack('halo');e.setScene('menu');
 assert.equal(e.setReverb({}),true);
 assert.ok(e.reverb,'the convolver is retained');
 for(let i=0;i<40;i++){ctx.currentTime+=.05;e.tick();}
 assert.ok(e.notesScheduled>0,'the halo pack schedules with reverb attached');
 const convolver=e.reverb;
 e.dispose();
 assert.equal(convolver.disconnected,true,'the convolver is released on dispose');
});

test('the built-in COCS leitmotif drives the halo lead and an external motif still quantises',()=>{
 const {e,ctx}=engine();
 e.setSoundtrack('halo');
 assert.equal(e.arrangements.combat.lead,'cocs','the halo combat layer reads the built-in leitmotif');
 const notes=[{step:0,midi:62,dur:4},{step:4,midi:65,dur:4},{step:8,midi:69,dur:4},{step:12,midi:72,dur:4}];
 assert.equal(e.setMotif({bpm:60,notes}),4,'every note maps to a scale degree');
 assert.ok(e.motifLead.every(d=>Number.isInteger(d)),'degrees are integers');
 e.setScene('combat');e.setIntensity(1);
 let scheduled=0;for(let i=0;i<40;i++){ctx.currentTime+=.05;scheduled+=e.tick();}
 assert.ok(scheduled>0&&e.notesScheduled>0,'the leitmotif lead schedules');
 assert.ok(e.notesBy.lead>0,'the developed motif actually sounds');
 assert.equal(e.setMotif(null),0,'clearing the motif disables the external motif');
 assert.equal(e.motifLead,null);
});

// --- Phase 2 musical behaviour -------------------------------------------------

// A fuller mock context with buffer sources, filters and panners so the cheap
// cinematic texture (noise risers, stereo width) is exercised for real.
function richContext(){
 const nodes=[];
 const param=(v=0)=>({value:v,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(v2){this.value=v2;},cancelScheduledValues(){}});
 const node=extra=>{const n={frequency:param(),gain:param(),Q:param(),pan:param(),type:'',buffer:null,loop:false,connect(){this.connected=true;},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;},...extra};nodes.push(n);return n;};
 return {currentTime:0,state:'running',sampleRate:44100,destination:{},nodes,
  createGain:()=>node(),createOscillator:()=>node({type:'sine'}),
  createBufferSource:()=>node(),createBiquadFilter:()=>node({type:'lowpass'}),
  createStereoPanner:()=>node(),
  createBuffer:(ch,len)=>({getChannelData:()=>new Float32Array(len)})};
}
const runTicks=(e,ctx,n)=>{for(let i=0;i<n;i++){ctx.currentTime+=.05;e.tick();}};

test('both packs carry eight-bar phrasing, multi-bar themes and counter-lines',()=>{
 for(const [name,pack] of Object.entries(SOUNDTRACKS)){
  for(const scene of MUSIC_SCENES){
   assert.equal(pack.progressions[scene].length,8,`${name}/${scene} is an eight-bar phrase`);
   assert.ok(pack.arrangements[scene]?.bass.length>0,`${name}/${scene} has bass`);
  }
 }
 const leadOf=arr=>Array.isArray(arr.lead)?arr.lead:arr.leadFallback;
 assert.ok(ARRANGEMENTS.menu.lead.length>=16&&ARRANGEMENTS.combat.lead.length>=16,'default leads are multi-bar themes');
 assert.ok(leadOf(HALO_ARRANGEMENTS.combat).length>=16,'the halo fallback lead is a developed line');
 assert.ok(leadOf(HALO_ARRANGEMENTS.menu).length>=4,'the halo menu augments the motif rather than dropping the lead');
 assert.ok(HALO_ARRANGEMENTS.combat.lead==='cocs'&&HALO_ARRANGEMENTS.results?.lead==='cocs','halo combat and results voice the leitmotif');
 for(const scene of MUSIC_SCENES){
  assert.ok(ARRANGEMENTS[scene].counter.length>=8,`default ${scene} has an offbeat counter-line`);
  assert.ok(HALO_ARRANGEMENTS[scene].counter.length>=8,`halo ${scene} has an offbeat counter-line`);
 }
 assert.ok(HALO_PROGRESSIONS.combat.length===8);
 assert.ok(Object.isFrozen(SOUNDTRACKS)&&Object.isFrozen(SOUNDTRACKS.halo.fills),'packs and fills are frozen');
 assert.ok(Object.isFrozen(ARRANGEMENTS.combat.bass[0])&&Object.isFrozen(CHORD_PROGRESSIONS.combat),'nested data is frozen');
});

test('a sixteen-note lead develops across four bars instead of looping every bar',()=>{
 const {e}=engine();
 const arr=ARRANGEMENTS.combat;
 assert.equal(e._leadIndex(arr,0),0);
 assert.equal(e._leadIndex(arr,4),1,'the second beat reads the second note');
 e.bar=1;
 assert.equal(e._leadIndex(arr,0),4,'the line continues into the next bar');
 e.bar=3;
 assert.equal(e._leadIndex(arr,12),15,'the phrase reaches its final note');
 e.bar=4;
 assert.equal(e._leadIndex(arr,0),0,'a sixteen-note theme wraps after four bars');
});

test('a long motif is played across bars rather than restarted each bar',()=>{
 const {e}=engine();
 e.setSoundtrack('halo');
 const notes=Array.from({length:16},(_,i)=>({step:i*4,midi:62+((i*2)%12),dur:4}));
 assert.equal(e.setMotif({bpm:60,notes}),16);
 assert.equal(e._leadIndex(HALO_ARRANGEMENTS.combat,0),0);
 e.bar=1;
 assert.equal(e._leadIndex(HALO_ARRANGEMENTS.combat,0),4,'bar two reads the motif second quarter');
});

test('combat layers enter in bands with intensity and release slowly when the scene leaves',()=>{
 const {e,ctx}=engine();
 e.setScene('combat');e.setIntensity(0.1);
 runTicks(e,ctx,40);
 assert.ok(e.layers.explore>0.8,'quiet combat uses exploration material');
 assert.ok(e.layers.combat<0.05,'the combat layer stays out of a quiet fight');
 assert.equal(e.notesBy.snare,0,'combat percussion waits for its layer');
 assert.ok(e.notesBy.counter>0,'the exploration counter-line is present');
 const low=e.buses.combat.gain.value;
 e.setIntensity(1);
 runTicks(e,ctx,120);
 assert.ok(e.layers.combat>0.95,`the combat layer settles in (${e.layers.combat})`);
 assert.ok(e.notesBy.snare>0&&e.notesBy.hat>0,'percussion enters with the layer');
 assert.ok(e.notesBy.lead>0,'the lead enters with the layer');
 assert.ok(e.buses.combat.gain.value>low*1.5,'the combat bus opens with intensity');
 const beforeMenu=e.layers.combat;
 e.setScene('menu');e.setIntensity(0);
 runTicks(e,ctx,4);
 assert.ok(e.layers.combat<beforeMenu&&e.layers.combat>0.5,'the combat layer releases rather than cuts');
 runTicks(e,ctx,240);
 assert.ok(e.layers.combat<0.02,'the combat layer eventually leaves');
 assert.ok(e.layers.menu>0.95,'the menu layer takes over');
});

test('scene changes run a bounded exit-swell/entrance-accent transition',()=>{
 const {e,ctx}=engine();
 runTicks(e,ctx,10);
 assert.equal(e.transition,null,'a steady scene has no transition');
 assert.equal(e.transitions,0);
 // In-game the arrangement follows intensity, not setScene: the transport keeps
 // running, so the rest of the current bar carries the exit swell.
 e.setScene('combat');e.setIntensity(0.1);
 // The transport is not reset: the entrance lands on the next downbeat.
 runTicks(e,ctx,60);
 assert.equal(e._activeScene(),'explore');
 assert.equal(e.transitions,1,'leaving the menu is one transition');
 assert.equal(e.transition.to,'explore','the first transition lands on exploration material');
 assert.ok(e.notesBy.impact>0,'the exploration entrance plays');
 e.setIntensity(1);
 ctx.currentTime+=.05;e.tick();
 assert.equal(e._activeScene(),'combat');
 assert.ok(e.transition,'an intensity change opens a transition');
 assert.equal(e.transition.from,'explore');
 assert.equal(e.transition.to,'combat');
 assert.equal(e.transition.phase,'outro','the exit swell starts first');
 assert.equal(e.transitions,2);
 runTicks(e,ctx,60);
 assert.notEqual(e.transition.phase,'outro','the swell resolves into the entrance');
 assert.ok(e.notesBy.impact>0,'the new scene gets an entrance accent');
 runTicks(e,ctx,220);
 assert.equal(e.transition.phase,'idle');
 assert.equal(e.transitions,2,'each resolved scene change makes one transition');
});

test('preview drives the transition into the auditioned scene and back',()=>{
 const {e,ctx}=engine();
 runTicks(e,ctx,6);
 e.preview('combat',1);
 assert.equal(e.previewScene,'combat');
 ctx.currentTime+=.05;e.tick();
 assert.equal(e.transition?.to,'combat','an audition changes the resolved scene');
 runTicks(e,ctx,40);
 assert.equal(e._activeScene(),'menu','the audition expires back to the menu');
 assert.equal(e.transition?.to,'menu','the return is a transition too');
});

test('the voice cap bounds layered combat under a long run',()=>{
 const {e,ctx}=engine({maxVoices:12});
 e.setScene('combat');e.setIntensity(1);
 for(let i=0;i<500;i++){ctx.currentTime+=.05;e.tick();assert.ok(e.voices.length<=12,`voice cap at tick ${i}`);}
 assert.ok(e.peakVoices>0&&e.peakVoices<=12,'the peak is capped');
 assert.ok(e.notesScheduled>0,'the soundtrack keeps scheduling');
});

test('scheduling is seed-deterministic and humanised per seed',()=>{
 const run=seed=>{const ctx=mockContext();const e=new MusicEngine({ctx,destination:ctx.destination,theme,seed});e.setScene('combat');e.setIntensity(1);runTicks(e,ctx,300);return e;};
 const a=run(7),b=run(7),c=run(9);
 assert.equal(a.scheduleChecksum,b.scheduleChecksum,'the same seed replays the same notes');
 assert.equal(a.notesScheduled,b.notesScheduled);
 assert.deepEqual(a.notesBy,b.notesBy);
 assert.notEqual(a.scheduleChecksum,c.scheduleChecksum,'a different seed humanises the take');
});

test('filtered-noise swells and stereo width appear when the context supports them',()=>{
 const ctx=richContext();
 const e=new MusicEngine({ctx,destination:ctx.destination,theme});
 e.setScene('combat');e.setIntensity(1);
 runTicks(e,ctx,420);
 assert.ok(e.noiseBuffer,'the engine provisions its own seeded noise buffer');
 assert.ok(e.notesBy.riser>0,'risers use the noise buffer');
 const pans=ctx.nodes.filter(n=>n.pan).map(n=>n.pan.value);
 assert.ok(pans.length>0,'voices use the stereo panner');
 assert.ok(pans.every(p=>p>=-1&&p<=1),'pan values stay in range');
 assert.ok(pans.some(p=>p!==0),'layers are spread off-centre');
 assert.ok(e.voices.length<=e.maxVoices);
});

test('without noise sources the engine falls back to tonal swells without crashing',()=>{
 const {e,ctx}=engine();
 e.setScene('combat');e.setIntensity(1);
 runTicks(e,ctx,420);
 assert.equal(e.notesBy.riser,0,'no buffer source means no noise riser');
 assert.ok(e.notesBy.swell>0,'a tonal swell still marks the phrase');
 assert.ok(e.notesBy.impact>0,'entrance accents are tonal too');
 assert.ok(e.voices.length<=e.maxVoices);
});

test('clearing an outcome releases the results take without stranding the scene',()=>{
 const {e}=engine();
 assert.equal(e.setOutcome('victory'),'victory');
 assert.equal(e.outcome,'victory');
 assert.equal(e.scene,'results','a win moves the arrangement to the results take');
 assert.equal(e.setOutcome(null),null);
 assert.equal(e.outcome,null,'the outcome is released for the next round');
 assert.equal(e.setOutcome('nonsense'),null);
 assert.equal(e.outcome,null,'an unknown outcome never latches');
 e.dispose();
});

test('a late frame advances past-due steps silently instead of stacking them',()=>{
 const {e,ctx}=engine();
 e.setScene('menu');
 e.tick();
 // Simulate a frame arriving late enough that several steps are already due.
 const times=[];
 const original=e._scheduleStep.bind(e);
 e._scheduleStep=(time,scene,step)=>{times.push(time);return original(time,scene,step);};
 const due=ctx.currentTime+0.02;
 e.nextTime=ctx.currentTime-0.3;
 ctx.currentTime=due;
 e.tick();
 assert.ok(times.length>=1,'the transport keeps moving forward');
 assert.ok(times.length<=2,`a late frame does not stack the missed run (${times.length})`);
 // Without the clamp this tick would have fired all four due steps at once
 // (-0.30, -0.14, +0.02, +0.18); the skipped two must never reach Web Audio.
 assert.ok(times.length<4,'the missed run is dropped, not replayed');
 for(const time of times)assert.ok(time>=due-0.02,`no step starts in the past (${time} < ${due})`);
 e.dispose();
});

test('auto tick is opt-in, idempotent and released on dispose',()=>{
 const {e}=engine();
 assert.equal(e._autoTickTimer,null,'no fallback clock until the host asks');
 assert.equal(e.setAutoTick(true),true);
 const first=e._autoTickTimer;
 assert.ok(first,'a fallback clock exists');
 e.setAutoTick(true);
 assert.equal(e._autoTickTimer,first,'enabling twice keeps one clock');
 e.setAutoTick(false);
 assert.equal(e._autoTickTimer,null,'disabling clears the clock');
 e.setAutoTick(true);
 e.dispose();
 assert.equal(e._autoTickTimer,null,'dispose clears the fallback clock');
});

test('the fallback clock schedules without a host frame',(t)=>{
 t.mock.timers.enable({apis:['setInterval']});
 const {e,ctx}=engine();
 e.setScene('menu');
 e.setAutoTick(true);
 ctx.currentTime+=4; // a throttled tab leaves the clock behind the context
 const before=e.notesScheduled;
 t.mock.timers.tick(150);
 assert.ok(e.notesScheduled>before,`the fallback clock scheduled ${e.notesScheduled-before} notes`);
 e.dispose();
});
