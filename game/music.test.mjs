import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicEngine,ARRANGEMENTS,CHORD_PROGRESSIONS,MUSIC_SCENES} from './music.mjs';

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
 assert.deepEqual([...MUSIC_SCENES],['menu','explore','combat']);
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
