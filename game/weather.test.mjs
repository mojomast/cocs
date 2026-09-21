import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView} from './view.mjs';
import {EffectPool,WeatherFX,SynthAudio} from './feedback.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';
import {
 WEATHER_KINDS,PRECIP_KINDS,TOD_PERIODS,
 selectWeather,weatherPreset,timeOfDayAt,biomeAmbience,precipParticleAdds,
 skyPhase,skyPalette,
} from './environment.mjs';

test('weather selection is deterministic, always a known preset and phase-aware',()=>{
 for(const id of ['frostline','warfront','derelict-station','aether','blood-gulch','exchange','custom-map']){
  const a=selectWeather({id},'day',17),b=selectWeather({id},'day',17);
  assert.equal(a,b,'the same arena, phase and seed reuse the same frozen preset');
  assert.ok(WEATHER_KINDS.includes(a.kind));
  assert.ok(Object.isFrozen(a));
  assert.equal(weatherPreset(a.kind),a,'a kind resolves back to its preset');
 }
 assert.equal(selectWeather({id:'frostline'},'day',2).kind,'snow','snow maps prefer snow');
 assert.equal(selectWeather({id:'warfront'},'day',2).kind,'ash','ashen maps prefer ash');
 assert.ok(['rain','storm','overcast','clear'].includes(selectWeather({id:'aether'},'night',4).kind));
 assert.equal(selectWeather({id:'frostline'},'day',2,{reduced:true}).kind,'clear','reduced motion forces clear skies');
 for(const kind of PRECIP_KINDS)assert.ok(kind,kind);
 assert.ok(weatherPreset('rain').particles>0);
 assert.ok(!(weatherPreset('clear').particles>0));
});

test('time-of-day is deterministic, phase-stable and cycles on a bounded period',()=>{
 const arena={id:'exchange',background:'#090f17'};
 const first=timeOfDayAt(arena,0,'selection'),second=timeOfDayAt(arena,0,'selection');
 assert.deepEqual(first,second,'the same elapsed time resolves to the same sample');
 assert.ok(Object.isFrozen(first));
 assert.ok(TOD_PERIODS.menu<TOD_PERIODS.play,'the title cycle is faster than gameplay');
 const seen=new Set();
 for(let i=0;i<40;i++)seen.add(timeOfDayAt(arena,i*TOD_PERIODS.menu/16,'selection').phase);
 for(const phase of ['day','dusk','night'])assert.ok(seen.has(phase),`the menu cycle reaches ${phase}`);
 assert.ok(seen.size<=3,'the cycle only ever reports the known phases');
 assert.equal(timeOfDayAt(arena,1234,'playing').phase,timeOfDayAt(arena,1234,'playing').phase);
 const pinned=timeOfDayAt({...arena,reducedMotion:true},999,'selection');
 assert.equal(pinned.phase,skyPhase(arena),'reduced motion pins the authored phase');
 assert.equal(timeOfDayAt({...arena,timeOfDayOverride:false},999).phase,skyPhase(arena));
 const sample=timeOfDayAt(arena,1234,'playing');
 assert.ok(['day','dusk','night'].includes(sample.from)&&['day','dusk','night'].includes(sample.to));
 assert.ok(sample.blend>=0&&sample.blend<=1,'the blend stays normalized');
});

test('biome ambience is pure, distinct and prefers authored ids over terrain',()=>{
 const snow=biomeAmbience({id:'frostline'}),volcanic=biomeAmbience({id:'foundry'}),forest=biomeAmbience({id:'riverbend'});
 assert.equal(snow.biome,'snow');assert.equal(snow.particles,'snow');assert.equal(snow.mood,'cold');
 assert.equal(volcanic.biome,'volcanic');assert.equal(volcanic.mood,'hot');
 assert.equal(forest.biome,'forest');
 assert.deepEqual(snow,biomeAmbience({id:'frostline'}),'the descriptor is a pure function');
 assert.ok(Object.isFrozen(snow));
 assert.notDeepEqual(snow,volcanic,'different biomes describe differently');
 for(const ambience of [snow,volcanic,forest]){
  assert.match(ambience.tint,/^#[0-9a-f]{6}$/i);
  assert.ok(['default','night','cold','hot','storm'].includes(ambience.mood));
 }
 const terrain=biomeAmbience({id:'custom',terrain:{surfaces:[]}});
 assert.equal(terrain.particles,'dust','an unrecognised map falls back to dust motes');
 assert.equal(biomeAmbience({id:'frostline',terrain:{surfaces:[]}}).particles,'snow','an authored id still wins with terrain present');
});

test('precipitation spawns are deterministic, bounded and fall toward the ground',()=>{
 const preset=weatherPreset('rain'),origin={x:2,y:1,z:-3};
 const a=precipParticleAdds(5,'rain',origin,9),b=precipParticleAdds(5,'rain',origin,9),c=precipParticleAdds(6,'rain',origin,9);
 assert.ok(a.length>0);
 assert.deepEqual(a,b,'the same serial emits an identical particle list');
 assert.notDeepEqual(a,c,'a new serial advances the deterministic stream');
 for(const add of a){
  assert.ok(Number.isFinite(add.pos.x)&&Number.isFinite(add.pos.y)&&Number.isFinite(add.pos.z));
  assert.ok(add.size>0&&add.life>0);
  assert.ok(add.velocity.y<0,'precipitation falls');
  assert.ok(Math.abs(add.pos.x-origin.x)<=9.5&&Math.abs(add.pos.z-origin.z)<=9.5,'spawns stay inside the radius');
  assert.equal(add.streak,preset.streakRatio);
 }
 assert.deepEqual(precipParticleAdds(1,'clear',origin,9),[],'clear weather emits nothing');
 assert.deepEqual(precipParticleAdds(NaN,'rain',origin,0).length>=1,true);
});

function audioFixture(){const audio=new SynthAudio(),nodes=[];const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}});const node=extra=>{const n={frequency:param(),gain:param(),Q:param(),pan:param(),type:'',buffer:null,loop:false,connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;},...extra};nodes.push(n);return n;};audio.ctx={currentTime:1,destination:{},createOscillator:()=>node({type:'sine'}),createGain:()=>node(),createBiquadFilter:()=>node({type:'lowpass'}),createBufferSource:()=>node({}),createStereoPanner:()=>node(),close(){this.closed=true;}};audio.noiseBuffer={};audio.master=node();return {audio,nodes};}

test('combat intensity drives the soundtrack layer while ducking the bed',()=>{
 const {audio}=audioFixture();
 const ctx=audio.ctx;
 audio.master=null; // build the real bus graph rather than the fixture stub
 audio._ensureBuses();
 assert.ok(audio.musicEngine,'the soundtrack engine is created with the buses');
 assert.equal(audio.intensity,0);
 assert.equal(audio.setIntensity(2),1,'intensity clamps to one');
 audio.setScene('game');
 for(let i=0;i<24;i++){ctx.currentTime+=.05;audio.tick();}
 assert.ok(audio.musicEngine.notesScheduled>0,'a loud fight schedules the combat soundtrack');
 assert.ok(audio.bedScale>1,'the bed lifts toward full level in a fight');
 audio.setIntensity(.05);
 assert.equal(audio.intensity,.05);
 assert.ok(audio.bedScale<1,'the bed eases back down when the fight ends');
 audio.setIntensity(NaN);
 assert.equal(audio.intensity,0,'non-finite intensity is a no-op');
 audio.dispose();
 assert.equal(audio.ctx,null);
 assert.equal(audio.musicEngine,null,'dispose tears the soundtrack down');
});

test('the announcer is opt-in, capped through the voice budget and tolerates unknown cues',()=>{
 const {audio}=audioFixture();
 assert.equal(audio.announcer,false);
 assert.equal(audio.announcerCue('goal').played,false,'a disabled announcer never spends a voice');
 assert.equal(audio.announcerCue('not-a-cue'),null,'an unknown event has no cue');
 assert.equal(audio.setAnnouncer(true),true);
 const cue=audio.announcerCue('goal');
 assert.equal(cue.cue,'goal');
 assert.equal(cue.played,true);
 assert.equal(audio.lastCue,'goal');
 assert.ok(audio.voices.size>=1,'the enabled announcer spends a voice');
 audio.muted=true;
 assert.equal(audio.announcerCue('capture').played,false,'muting silences the announcer');
 audio.dispose();
});

test('the dynamic audio layer drives nearby-action intensity from pooled projectiles',()=>{
 const audio={intensity:0,calls:[],setIntensity(value){this.intensity=value;this.calls.push(value);return value;}};
 const view=Object.assign(Object.create(ArenaView.prototype),{playerId:7,actorModels:new Map([['7',{position:{x:0,y:0,z:0}}]]),camera:{position:{x:0,y:0,z:0}},viewAudio:audio,lastEvent:0,_nearActionAt:10,_nearAction:.9});
 assert.ok(Math.abs(view.audioIntensity(10)-.9)<1e-9,'the action spike reads out immediately');
 assert.ok(view.audioIntensity(12.5)<.9&&view.audioIntensity(12.5)>0,'the stamp decays with time');
 assert.equal(view.audioIntensity(20),0,'a stale stamp decays to silence');
 const rockets=[{pos:{x:4,z:2}},{pos:{x:40,z:40}}];
 assert.ok(view._updateAudio({rockets,events:[]},15)>=.85,'a nearby projectile raises intensity');
 assert.ok(audio.calls.length>0);
 const quiet=Object.assign(Object.create(ArenaView.prototype),{playerId:7,actorModels:new Map(),viewAudio:null,lastEvent:5});
 assert.equal(quiet._updateAudio({rockets:[],events:[]},20),0,'no audio and no action stays silent');
});

test('weather FX reuses pooled slots, respects the cap and gates CPU/reduced motion',()=>{
 const pool=new EffectPool(new T.Scene(),32),fx=new WeatherFX(pool,{seed:1,preset:weatherPreset('storm'),cap:6}),origin={x:0,y:0,z:0};
 assert.equal(fx.update(.05,origin,{software:true}),0,'the CPU renderer emits no precipitation');
 assert.equal(fx.update(.05,origin,{reduced:true}),0,'reduced motion emits no precipitation');
 assert.equal(fx.update(.05,null,{}),0,'no origin emits nothing');
 const spawned=fx.update(.05,origin,{quality:1});
 assert.ok(spawned>0&&spawned<=6,'the per-frame cap bounds the emitter');
 assert.ok(pool.slots.some(slot=>slot.active),'precipitation lands in the shared pool');
 const replay=new WeatherFX(pool,{seed:1,preset:weatherPreset('storm'),cap:6});
 const before=JSON.stringify(replay.update(.05,origin,{quality:1}));
 assert.equal(before,JSON.stringify(fx.update(.05,origin,{quality:1})),'the serial drives deterministic spawn counts');
 fx.setPreset(weatherPreset('clear'));
 assert.equal(fx.update(.05,origin,{quality:1}),0,'clear weather spawns nothing');
 fx.setPreset(weatherPreset('rain'));
 assert.equal(fx.update(.05,origin,{quality:0}),0,'a zero quality scale suppresses precipitation');
 pool.dispose();
});

test('precipitation preserves its 60 Hz stream across presentation cadences and bounds hitch work',()=>{
 const origin={x:0,y:0,z:0},preset=weatherPreset('rain');
 const run=hz=>{const adds=[],fx=new WeatherFX({add:add=>adds.push(add)},{preset,cap:30});for(let i=0;i<hz*2;i++){fx.setPreset(preset);fx.update(1/hz,origin);}return {adds,fx};};
 const reference=run(60);
 assert.equal(reference.adds.length,120*Math.round(preset.particles/6));
 for(const hz of [30,120,144]){const result=run(hz);assert.deepEqual(result.adds,reference.adds,`${hz} Hz preserves the spawn sequence`);assert.equal(result.fx.serial,120);}
 assert.ok(reference.adds.every(add=>add.gravity===0),'terminal precipitation speed agrees with splash trajectories');
 const fx=new WeatherFX({add(){}},{preset,cap:30});
 for(const dt of [0,-1,NaN,Infinity])assert.equal(fx.update(dt,origin),0);
 assert.equal(fx.update(10,origin),30,'a long gap never exceeds the existing update cap');
 assert.equal(fx.update(0,origin),0,'dropped catch-up work is not retained as a backlog');
 assert.equal(fx.update(1/60,origin),15);
 const serial=fx.serial;fx.setPreset(preset);assert.equal(fx.serial,serial);
 fx.setPreset(weatherPreset('snow'));assert.equal(fx.serial,0);assert.equal(fx.acc,0);
});

function particleView(t,preset=weatherPreset('rain')){
 const view=Object.assign(Object.create(ArenaView.prototype),{
  scene:new T.Scene(),renderer:{isSoftware:false},camera:{position:new T.Vector3(0,5,0)},
  weatherState:{preset,kind:preset.kind,clock:0},_weatherSplashSerial:0,
  ambientConfig:{color:'#fff',rate:20,rise:.5,life:1},ambientAnchors:[],
  _quality:()=>({ambientMotes:3}),windGust:()=>1,_mothFx:()=>null,
 });
 t.after(()=>{view.ambientPool?.dispose();view.weatherPool?.dispose();view.ripplePool?.dispose();});
 return view;
}

test('the view ages atmospheric pools once, retires them when emission stops and clears reduced motion',t=>{
 const view=particleView(t),quality={particles:1};
 view._updateAmbient(null,.1,0,false);
 const mote=view.ambientPool.slots[0],start=mote.obj.position.y,life=mote.life;
 view._effectsScale=0;
 view._updateAmbient(null,.1,.1,false);
 assert.ok(Math.abs(mote.life-(life-.1))<1e-9);
 assert.ok(mote.obj.position.y>start);
 view.ambientConfig=null;view._updateAmbient(null,2,2,false);
 assert.ok(view.ambientPool.slots.every(slot=>!slot.active&&!slot.obj.visible));
 view.ambientConfig={color:'#fff',rate:20,life:1};view._effectsScale=1;
 view._updateAmbient(null,.1,3,false);view._updateAmbient(null,.1,3.1,true);
 assert.ok(view.ambientPool.slots.every(slot=>!slot.active&&!slot.obj.visible));
 assert.equal(view.ambientFx.acc,0);

 view._sampleWeatherGround=()=>0;
 view._updateWeatherFx(1/60,false,quality);
 const drop=view.weatherPool.slots[0],height=drop.obj.position.y,remaining=drop.life;
 view._effectsScale=0;view._updateWeatherFx(.1,false,quality);
 assert.ok(Math.abs(drop.life-(remaining-.1))<1e-9);assert.ok(drop.obj.position.y<height);
 view.weatherState={preset:weatherPreset('clear'),kind:'clear',clock:0};
 view._updateWeatherFx(2,false,quality);
 assert.ok(view.weatherPool.slots.every(slot=>!slot.active&&!slot.obj.visible));
 view.weatherState={preset:weatherPreset('rain'),kind:'rain',clock:0};view._effectsScale=1;
 view._updateWeatherFx(1/60,false,quality);view._updateWeatherFx(.1,true,quality);
 assert.ok(view.weatherPool.slots.every(slot=>!slot.active&&!slot.obj.visible));
 assert.ok(view.ripplePool.slots.every(slot=>!slot.active&&!slot.obj.visible));
 assert.equal(view.weatherFx.serial,0);assert.equal(view.weatherFx.acc,0);
});

test('weather uses the supplied arena for ground contacts and a full rain pool accepts snow',t=>{
 const view=particleView(t),quality={particles:1};
 const arena={id:'particle-ground',bounds:{minX:-30,maxX:30,minZ:-30,maxZ:30},blocks:[{x:0,z:0,w:60,d:60,h:3}]};
 for(let i=0;i<4;i++)view._updateWeatherFx(1/60,false,quality,arena);
 assert.equal(view.weatherPool.slots.length,48);
 assert.equal(view._sampleWeatherGround(0,0,10),3);
 assert.ok(view.ripplePool.slots.some(slot=>Math.abs(slot.obj.position.y-3.02)<1e-9));
 const serial=view.weatherFx.serial;view._updateWeatherFx(1/60,false,quality,arena);
 assert.equal(view.weatherFx.serial,serial+1,'view updates do not reset the preset stream');
 view.weatherState={preset:weatherPreset('snow'),kind:'snow',clock:0};
 view._updateWeatherFx(1/60,false,quality,arena);
 assert.ok(view.weatherPool.slots.some(slot=>slot.active&&!slot.line),'snow gets reusable mote slots after rain saturates the pool');
 assert.equal(view.weatherPool.slots.length,48);
});

test('the view resolves weather deterministically, tints on WebGL and skips wet work on software',()=>{
 const played=Object.assign(Object.create(ArenaView.prototype),{
  scene:Object.assign(new T.Scene(),{fog:new T.FogExp2("#090f17",.018)}),renderer:{isSoftware:false},motionQuery:{matches:false},display:{...DEFAULT_DISPLAY},
  _arenaLook:{background:'#090f17',fog:'#090f17',fogDensity:.018,exposure:1.15},
  _arenaLight:{hemi:1.8,sun:2.4,hemiColor:new T.Color('#8da5b1'),sunColor:new T.Color('#8da5b1'),groundColor:new T.Color('#20364f')},
  sky:null,camera:{position:{x:0,y:0,z:0}},
 });
 assert.equal(played.setWeather('snow'),'snow','a pinned kind is accepted');
 assert.equal(played.setWeather('bogus'),null,'an unknown kind clears the pin');
 assert.equal(played.setWeather(null),null);
 const arena={id:'frostline',background:'#090f17'};
 const first=played.initWeather(arena),_=played._updateWeather(arena,.016,'playing',false);
 assert.equal(first.kind,'snow','the snow biome selects snow');
 assert.equal(played._updateWeather(arena,.25,'playing',false).phase,played._updateWeather(arena,.25,'playing',false).phase);
 const again=Object.assign(Object.create(ArenaView.prototype),{scene:Object.assign(new T.Scene(),{fog:new T.FogExp2("#090f17",.018)}),renderer:{isSoftware:false},motionQuery:{matches:false},display:{...DEFAULT_DISPLAY},_arenaLook:played._arenaLook,_arenaLight:played._arenaLight,sky:null});
 again.initWeather(arena);
 for(let i=0;i<8;i++){played._updateWeather(arena,.1,'playing',false);again._updateWeather(arena,.1,'playing',false);}
 assert.equal(played._weatherState().kind,again._weatherState().kind,'two identical runs resolve the same weather');

 played.setWeather('storm');
 played._updateWeather(arena,.016,'playing',false);
 assert.ok(played.scene.fog.density>0,'the storm thickens the fog');
 assert.ok(played.weatherState.preset.material.wet>0,'the storm marks surfaces wet');
 assert.equal(played._updateWeatherFx(.05,false,{ambientMotes:6,particles:1})>0,true,'WebGL spawns precipitation');
 assert.ok(played.weatherPool&&played.weatherPool.slots.some(slot=>slot.active));
 const drawn=played.weatherPool.slots.filter(slot=>slot.active).length;

 const software=Object.assign(Object.create(ArenaView.prototype),{
  scene:Object.assign(new T.Scene(),{fog:new T.FogExp2("#090f17",.018)}),renderer:{isSoftware:true},motionQuery:{matches:false},display:{...DEFAULT_DISPLAY},
  _arenaLook:played._arenaLook,_arenaLight:played._arenaLight,sky:null,camera:{position:{x:0,y:0,z:0}},
 });
 software.initWeather(arena);software.setWeather('storm');software._updateWeather(arena,.016,'playing',false);
 assert.ok(software.scene.fog.density>0,'the CPU renderer still gets the cheap tint');
 assert.equal(software._updateWeatherFx(.05,false,{ambientMotes:6,particles:1}),0,'the CPU renderer spawns no precipitation');
 assert.ok(!software.weatherPool,'the CPU view never allocates the weather pool');
 assert.equal(played.weatherPool.slots.filter(slot=>slot.active).length,drawn,'the CPU guard adds no draw calls');
 played.weatherPool.dispose();
});
