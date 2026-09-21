import assert from 'node:assert/strict';
import test from 'node:test';
import {GAME_MODES,DIFFICULTIES} from './config.mjs';
import {MAPS} from './maps.mjs';
import {ARENA_GROUPS,arenaMeta,arenaSupportsMode,mapsForMode,maxBotsFor} from './arenas.mjs';
import {SINGLEPLAYER_MODES} from './singleplayer.mjs';
import {
 CURATED_SCENARIOS,DEMO_CATEGORY_BY_MODE,DEMO_MODE_EXCLUSIONS,DEMO_SETTINGS_DEFAULTS,DEMO_SETTINGS_KEY,DEMO_SETTINGS_LIMITS,DEFAULT_SCENARIO_SECONDS,ROTATIONS,SCENARIO_CATEGORIES,
 completeCatalog,createRotationState,curatedMapPool,demoCatalog,demoModeEligible,exclusionReport,normalizeDemoSettings,parseDemoSettings,pairEligibility,pickNext,pinScenario,releasePin,resetDemoSettings,scenarioSpec,seededRng,serializeDemoSettings,setRotationMode,shuffleIndices,validateDemoSettings,
} from './demo-playlist.mjs';

const MODE_IDS=GAME_MODES.map(mode=>mode.id);
const GROUP_IDS=new Set(ARENA_GROUPS.map(group=>group.id));
const mapsOf=scenario=>Array.isArray(scenario?.maps)?scenario.maps:(typeof scenario?.mapId==='string'?[scenario.mapId]:[]);

test('curated catalog is a deliberate spread of categories, modes and maps', () => {
 assert.ok(CURATED_SCENARIOS.length>=6,'the demo should show a variety of modes');
 assert.ok(Object.isFrozen(CURATED_SCENARIOS));
 assert.equal(DEFAULT_SCENARIO_SECONDS,75);
 const modes=new Set(CURATED_SCENARIOS.map(scenario=>scenario.mode));
  assert.ok(modes.size>=10,'varied modes, including both LATTICE destinations');
 const categories=new Set(CURATED_SCENARIOS.map(scenario=>scenario.category));
 assert.deepEqual([...categories].sort(),[...SCENARIO_CATEGORIES].sort(),'every required category is represented');
 const maps=new Set(CURATED_SCENARIOS.flatMap(mapsOf));
  assert.deepEqual([...maps].sort(),MAPS.filter(m=>m.collection==='destinations').map(m=>m.id).sort(),'the reel covers the full destination collection');
 const groups=new Set([...maps].map(mapId=>arenaMeta(mapId)?.group));
  assert.ok(groups.size>=4,`curated maps span several arena groups, got ${groups.size}`);
 for(const mapId of maps)assert.ok(GROUP_IDS.has(arenaMeta(mapId).group),`${mapId} group`);
 for(const scenario of CURATED_SCENARIOS){
  assert.ok(MODE_IDS.includes(scenario.mode),`${scenario.mode} registered`);
  assert.equal(scenario.source,'curated');
  assert.equal(scenario.category,DEMO_CATEGORY_BY_MODE[scenario.mode]);
  assert.ok(scenario.maps.length>0,`${scenario.id} authored maps`);
  for(const mapId of scenario.maps){
   assert.ok(MAPS.some(map=>map.id===mapId),`${mapId} registered`);
   assert.ok(arenaSupportsMode(mapId,scenario.mode),`${scenario.mode} playable on ${mapId}`);
  }
  assert.ok(scenario.bots>=0&&scenario.bots<=maxBotsFor(scenario.mode),`${scenario.mode} bot cap`);
  assert.ok(scenario.timeLimit>0&&scenario.timeLimit<=120);
  assert.ok(scenario.fragLimit>0);
  assert.ok(scenario.seatVehicles>=0&&scenario.seatVehicles<=1);
  assert.ok(DIFFICULTIES.some(difficulty=>difficulty.id===scenario.difficulty));
 }
 for(const mode of GAME_MODES)assert.ok(DEMO_CATEGORY_BY_MODE[mode.id],`${mode.id} category`);
});

test('complete catalog is exactly the compatibility-rule-eligible mode/map pairs', () => {
 for(const legacy of [true,false]){
  const catalog=completeCatalog({legacy});
  assert.ok(catalog.length>0);
  const expected=[];
  for(const mode of GAME_MODES){
   if(!demoModeEligible(mode.id))continue;
   for(const map of mapsForMode(mode.id,{legacy}))expected.push(`${mode.id}:${map.id}`);
  }
  assert.deepEqual(catalog.map(scenario=>scenario.id),expected,'derived from mapsForMode');
  assert.equal(new Set(catalog.map(scenario=>scenario.id)).size,catalog.length,'ids are unique');
  for(const scenario of catalog){
   assert.equal(scenario.source,'complete');
   assert.equal(scenario.maps.length,1);
   const [mapId]=scenario.maps;
   assert.equal(scenario.id,`${scenario.mode}:${mapId}`);
   assert.ok(arenaSupportsMode(mapId,scenario.mode),`${scenario.mode} playable on ${mapId}`);
   assert.ok(mapsForMode(scenario.mode,{legacy}).some(map=>map.id===mapId));
   assert.ok(scenario.bots>=0&&scenario.bots<=maxBotsFor(scenario.mode));
   assert.ok(SCENARIO_CATEGORIES.includes(scenario.category));
   if(!legacy)assert.notEqual(arenaMeta(mapId).legacy,true,`${mapId} excluded without legacy`);
   const spec=scenarioSpec(scenario,seededRng(3),{legacy});
   assert.equal(spec.mapId,mapId);
   assert.ok(spec.botCount>=0&&spec.botCount<=maxBotsFor(scenario.mode));
  }
 }
 const full=completeCatalog({legacy:true}),active=completeCatalog({legacy:false});
 assert.ok(full.length>active.length,'legacy arenas only widen the catalog');
 assert.ok(full.some(scenario=>scenario.id==='deathmatch:exchange'));
 assert.ok(!active.some(scenario=>scenario.id==='deathmatch:exchange'));
 assert.ok(full.some(scenario=>scenario.id==='puma-race:puma-circuit'));
 assert.ok(full.some(scenario=>scenario.id==='combined-arms:blood-gulch'));
 for(const mode of GAME_MODES){
  if(!demoModeEligible(mode.id))continue;
  assert.ok(full.some(scenario=>scenario.mode===mode.id),`${mode.id} represented in complete`);
 }
});

test('complete catalog includes legacy maps where playable and explains drops', () => {
 assert.deepEqual(ROTATIONS,['curated','complete']);
 const report=exclusionReport({legacy:false});
 assert.deepEqual(report.modes.map(entry=>entry.mode).sort(),['campaign','cocs-coop','horde']);
 for(const entry of [...report.modes,...report.maps,...report.pairs]){
  assert.equal(typeof entry.reason,'string');
  assert.ok(entry.reason.length>0,'a reason is always attached');
  assert.ok(typeof entry.detail==='string'&&entry.detail.length>0,'a detail explains the drop');
 }
 const legacyPair=report.pairs.find(entry=>entry.mode==='deathmatch'&&entry.mapId==='exchange');
 assert.equal(legacyPair.reason,'legacy-disabled');
 const incompatible=report.pairs.find(entry=>entry.mode==='puma-race'&&entry.mapId==='forge');
 assert.equal(incompatible.reason,'mode-map-incompatible');
 const singlePlayer=report.pairs.find(entry=>entry.mode==='horde'&&entry.mapId==='exchange');
 assert.equal(singlePlayer.reason,DEMO_MODE_EXCLUSIONS.horde.reason);
 assert.equal(report.summary.eligiblePairs,completeCatalog({legacy:false}).length);
 assert.equal(report.summary.excludedPairs,report.pairs.length);
 assert.equal(report.summary.allPairs,report.summary.eligiblePairs+report.summary.excludedPairs);
 const fullReport=exclusionReport({legacy:true});
 assert.ok(!fullReport.pairs.some(entry=>entry.reason==='legacy-disabled'),'legacy enabled keeps legacy pairs');
 const served=new Set(completeCatalog({legacy:true}).flatMap(scenario=>scenario.maps));
 for(const map of MAPS)assert.ok(served.has(map.id)||fullReport.maps.some(entry=>entry.mapId===map.id),`${map.id} never dropped silently`);
 assert.equal(fullReport.summary.mapsWithoutEligibleMode,fullReport.maps.length);
});

test('mode exclusions cover the single-player modes with explicit reasons', () => {
 for(const mode of SINGLEPLAYER_MODES){
  assert.ok(DEMO_MODE_EXCLUSIONS[mode],`${mode} has an exclusion`);
  assert.ok(typeof DEMO_MODE_EXCLUSIONS[mode].reason==='string'&&DEMO_MODE_EXCLUSIONS[mode].reason.length>0);
  assert.ok(typeof DEMO_MODE_EXCLUSIONS[mode].detail==='string'&&DEMO_MODE_EXCLUSIONS[mode].detail.length>0);
  assert.equal(demoModeEligible(mode),false);
 }
 assert.equal(demoModeEligible('deathmatch'),true);
 assert.equal(demoModeEligible('not-a-mode'),false);
 assert.equal(pairEligibility('ctf','frost-gate',{legacy:false}).eligible,true);
 assert.equal(pairEligibility('ctf','launchpad',{legacy:false}).reason,'legacy-disabled');
 assert.equal(pairEligibility('ctf','launchpad',{legacy:true}).eligible,true);
 assert.equal(pairEligibility('puma-race','forge').reason,'mode-map-incompatible');
 assert.equal(pairEligibility('not-a-mode','forge').reason,'unknown-mode');
 assert.equal(pairEligibility('ctf','not-a-map').reason,'unknown-map');
});

test('curated rotation plays every curated scenario once per pass without repeats', () => {
 const catalog=demoCatalog('curated');
 assert.equal(catalog,CURATED_SCENARIOS);
 const rng=seededRng(17);
 let state=null;
 const ids=[],maps=[],categories=new Set();
 for(let i=0;i<catalog.length;i++){
  const result=pickNext(state,{rng,rotation:'curated'});
  state=result.state;
  assert.ok(result.scenario.id);
  ids.push(result.scenario.id);
  maps.push(result.scenario.mapId);
  categories.add(result.scenario.category);
  assert.equal(result.coverage.catalogSize,catalog.length);
  assert.equal(result.coverage.remaining,catalog.length-1-i);
 }
 assert.deepEqual([...ids].sort(),catalog.map(scenario=>scenario.id).sort(),'a full pass covers the roster');
  assert.equal(new Set(maps.slice(0,9)).size,9,'all nine destinations precede map repeats');
 for(let i=1;i<maps.length;i++)assert.notEqual(maps[i],maps[i-1],'no immediate map repeat');
 assert.deepEqual([...categories].sort(),[...SCENARIO_CATEGORIES].sort());
 const next=pickNext(state,{rng:seededRng(3),rotation:'curated'});
 assert.equal(next.coverage.pass,2);
 assert.notEqual(next.scenario.id,ids[ids.length-1],'pass boundary avoids the last scenario');
});

test('rotation mode balance and full-pass coverage hold across many seeds', () => {
 for(const rotation of ROTATIONS){
  const catalog=demoCatalog(rotation,{legacy:true});
  for(const seed of [1,2,3,5,8,13,21]){
   let state=null;
   const rng=seededRng(seed);
    const passIds=[],passModes=[],passMaps=[];
   for(let i=0;i<catalog.length;i++){
    const result=pickNext(state,{rng,rotation,legacy:true,afterEnd:true});
    state=result.state;
    if(passIds.length)assert.notEqual(result.scenario.id,passIds[passIds.length-1],'no back-to-back repeats');
    passIds.push(result.scenario.id);
    passModes.push(result.scenario.mode);
    passMaps.push(result.scenario.mapId);
   }
   assert.equal(new Set(passIds).size,catalog.length,'every scenario once per pass');
   const firstRepeat=passModes.findIndex((mode,index)=>passModes.indexOf(mode)!==index);
   const distinctModes=new Set(passModes).size;
    if(rotation==='curated')assert.equal(new Set(passMaps.slice(0,9)).size,9,'all nine destinations precede repeats across seeds');
   else assert.equal(firstRepeat,distinctModes,'every mode appears before any mode repeats');
  }
 }
});

test('complete rotation avoids map repeats while an alternative map remains pending', () => {
 const catalog=demoCatalog('complete',{legacy:true});
 const byId=new Map(catalog.map(scenario=>[scenario.id,scenario]));
 let state=null,previous=null;
 const rng=seededRng(21);
 for(let i=0;i<catalog.length;i++){
  const beforeState=state;
  const pendingBefore=state?state.pending.slice():[];
  const result=pickNext(state,{rng,rotation:'complete',legacy:true,afterEnd:true});
  state=result.state;
  if(previous){
   assert.notEqual(result.scenario.id,previous.id,'no back-to-back scenario repeats');
   // The least-used-mode tier is the coverage priority: a pass must show every
   // mode before any repeat (the sibling test). Map variety is a tie-break
   // *within* that tier, so the assertion is scoped to tier candidates that
   // actually offer a different map. When the only unseen mode sits on the
   // previous map, replaying it is required coverage, not a scheduling miss.
   const counts=beforeState?beforeState.passCounts.modes:{};
   const minCount=Math.min(...pendingBefore.map(id=>counts[byId.get(id).mode]||0));
   const tier=pendingBefore.filter(id=>(counts[byId.get(id).mode]||0)===minCount);
   const alternative=tier.some(id=>byId.get(id).maps.some(mapId=>mapId!==previous.mapId));
   if(alternative)assert.notEqual(result.scenario.mapId,previous.mapId,`map variety on ${previous.mapId}`);
  }
  previous=result.scenario;
 }
 assert.equal(state.pass,1);
 assert.equal(state.pending.length,0);
});

test('manual pins stay pinned until released and recover when they become valid', () => {
 let state=createRotationState();
 assert.deepEqual(state.pin,null);
 state=pinScenario(state,{mode:'puma-race'});
 for(let i=0;i<3;i++){
  const result=pickNext(state,{rng:seededRng(100+i),rotation:'curated'});
  state=result.state;
  assert.equal(result.reason,'pin');
  assert.equal(result.scenario.mode,'puma-race');
  assert.equal(result.scenario.mapId,'ion-speedway');
  assert.deepEqual(state.pin,{scenarioId:null,mode:'puma-race',mapId:null});
 }
 assert.equal(state.pinPicks,3);
 assert.equal(state.picks,0,'pins do not consume the rotation pass');
 const pendingWhilePinned=state.pending.length;
 assert.equal(pendingWhilePinned,demoCatalog('curated').length);
 state=releasePin(state);
 assert.equal(state.pin,null);
 const resumed=pickNext(state,{rng:seededRng(9),rotation:'curated'});
 assert.equal(resumed.coverage.resumed,true);
 assert.notEqual(resumed.scenario.mode,'puma-race');
 assert.equal(resumed.state.pending.length,pendingWhilePinned-1,'rotation resumes where it paused');
 assert.equal(pinScenario(state,{}).pin,null,'an empty pin clears');
 assert.equal(releasePin(state).pin,null,'release is idempotent');
});

test('an invalid pin falls back gracefully and reapplies when it becomes eligible', () => {
 const pinned=pinScenario(createRotationState({rotation:'complete'}),{mode:'deathmatch',mapId:'exchange'});
 const fallback=pickNext(pinned,{rng:seededRng(4),rotation:'complete',legacy:false});
 assert.equal(fallback.reason,'pin-invalid');
 assert.notEqual(fallback.scenario.mapId,'exchange');
 assert.equal(fallback.invalidPin.reason,'pin-invalid');
 assert.ok(fallback.invalidPin.detail.includes('legacy'));
 assert.deepEqual(fallback.state.pin,{scenarioId:null,mode:'deathmatch',mapId:'exchange'},'the pin is kept for recovery');
 const recovered=pickNext(fallback.state,{rng:seededRng(5),rotation:'complete',legacy:true});
 assert.equal(recovered.reason,'pin');
 assert.equal(recovered.scenario.mode,'deathmatch');
 assert.equal(recovered.scenario.mapId,'exchange');
});

test('map and mode requests resolve once without consuming the pass', () => {
 const state=createRotationState();
 const request=pickNext(state,{rng:seededRng(1),rotation:'curated',mapId:'aurora-stadium'});
 assert.equal(request.reason,'request');
 assert.equal(request.scenario.mode,'puma-soccer');
 assert.equal(request.scenario.mapId,'aurora-stadium');
 assert.equal(request.state.picks,0,'requests do not advance the pass');
 assert.equal(request.state.pending.length,demoCatalog('curated').length);
 const modeRequest=pickNext(request.state,{rng:seededRng(2),rotation:'curated',mode:'ctf'});
 assert.equal(modeRequest.reason,'request','a game-mode id is a request, not a rotation');
 assert.equal(modeRequest.scenario.mode,'ctf');
 assert.equal(modeRequest.state.picks,0);
 const invalid=pickNext(modeRequest.state,{rng:seededRng(3),rotation:'curated',mapId:'atlantis'});
 assert.equal(invalid.reason,'request-invalid');
 assert.ok(invalid.invalidRequest.detail.length>0);
 assert.ok(invalid.scenario,'rotation continues after an invalid request');
 const legacyRequest=pickNext(invalid.state,{rng:seededRng(4),rotation:'curated',mapId:'exchange'});
 assert.equal(legacyRequest.reason,'request-invalid','curated has no exchange scenario');
 const complete=pickNext(createRotationState({rotation:'complete'}),{rng:seededRng(5),rotation:'complete',legacy:false,mapId:'exchange'});
 assert.equal(complete.reason,'request-invalid');
 const completeLegacy=pickNext(complete.state,{rng:seededRng(6),rotation:'complete',legacy:true,mapId:'exchange'});
 assert.equal(completeLegacy.reason,'request');
 assert.equal(completeLegacy.scenario.mode,'deathmatch');
 assert.equal(completeLegacy.scenario.mapId,'exchange');
 const switched=setRotationMode(createRotationState(),'complete');
 const first=pickNext(switched,{rng:seededRng(7),legacy:false});
 assert.equal(first.reason,'first');
 assert.equal(first.coverage.rotation,'complete');
 assert.equal(first.coverage.catalogSize,completeCatalog({legacy:false}).length);
 assert.equal(setRotationMode(switched,'nonsense').rotation,'complete','invalid rotations are ignored');
});

test('afterEnd distinguishes a completed scenario from a manual skip', () => {
 const first=pickNext(null,{rng:seededRng(1),rotation:'curated'});
 assert.equal(first.reason,'first');
 assert.equal(first.coverage.afterEnd,false);
 const advanced=pickNext(first.state,{rng:seededRng(2),rotation:'curated',afterEnd:true});
 assert.equal(advanced.reason,'advance');
 assert.equal(advanced.coverage.afterEnd,true);
 const skipped=pickNext(advanced.state,{rng:seededRng(3),rotation:'curated',afterEnd:false});
 assert.equal(skipped.reason,'skip');
 assert.equal(skipped.coverage.afterEnd,false);
});

test('a fixed seed yields identical sequences and pickNext never mutates its input', () => {
 for(const rotation of ROTATIONS)for(const legacy of [false,true]){
  const run=()=>{
   const rng=seededRng(1337);
   let state=null;
   const out=[];
   for(let i=0;i<20;i++){
    const result=pickNext(state,{rng,rotation,legacy});
    state=result.state;
    out.push({id:result.scenario.id,mapId:result.scenario.mapId,reason:result.reason,pass:result.coverage.pass,remaining:result.coverage.remaining});
   }
   return out;
  };
  assert.deepEqual(run(),run(),`${rotation} legacy=${legacy} replays identically`);
 }
 const state=createRotationState();
 const snapshot=structuredClone(state);
 const {state:next}=pickNext(state,{rng:seededRng(1)});
 assert.deepEqual(state,snapshot,'the input state is untouched');
 assert.notEqual(next,state);
 assert.ok(next.pending.length>0);
 const shuffled=shuffleIndices(11,seededRng(3));
 assert.deepEqual(shuffled,shuffleIndices(11,seededRng(3)));
 assert.deepEqual([...shuffled].sort((a,b)=>a-b),Array.from({length:11},(_,index)=>index));
 assert.ok(shuffled.some((value,index)=>value!==index));
});

test('settings validate, normalize and recover from malformed storage', () => {
 assert.deepEqual(resetDemoSettings(),DEMO_SETTINGS_DEFAULTS);
 assert.equal(validateDemoSettings(DEMO_SETTINGS_DEFAULTS).ok,true);
 const repaired=validateDemoSettings({rotation:'chaos',autoRotate:'yes',scenarioSeconds:'soon',botCount:'many',difficulty:'godlike'});
 assert.equal(repaired.ok,false);
 assert.deepEqual(repaired.settings,DEMO_SETTINGS_DEFAULTS);
 assert.equal(repaired.errors.length,5);
 assert.ok(repaired.errors.every(error=>typeof error.field==='string'&&error.message.length>0));
 assert.equal(normalizeDemoSettings({scenarioSeconds:9999}).scenarioSeconds,DEMO_SETTINGS_LIMITS.scenarioSeconds.max);
 assert.equal(normalizeDemoSettings({scenarioSeconds:10}).scenarioSeconds,DEMO_SETTINGS_LIMITS.scenarioSeconds.min);
 assert.equal(normalizeDemoSettings({botCount:-4}).botCount,0);
 assert.equal(normalizeDemoSettings({botCount:999}).botCount,DEMO_SETTINGS_LIMITS.botCount.max);
 assert.equal(normalizeDemoSettings({botCount:null}).botCount,null);
 assert.equal(normalizeDemoSettings({rotation:'complete'}).rotation,'complete');
 assert.equal(normalizeDemoSettings({difficulty:'hard'}).difficulty,'hard');
 assert.equal(normalizeDemoSettings({difficulty:'nope'}).difficulty,null);
 assert.equal(normalizeDemoSettings({autoRotate:false}).autoRotate,false);
 assert.equal(resetDemoSettings({rotation:'complete'}).rotation,'complete');
 assert.equal(resetDemoSettings({rotation:'complete'}).autoRotate,true,'reset restores untouched defaults');
 const text=serializeDemoSettings({rotation:'complete',autoRotate:false,scenarioSeconds:45,botCount:8,difficulty:'hard'});
 assert.equal(text,JSON.stringify({rotation:'complete',autoRotate:false,scenarioSeconds:45,botCount:8,difficulty:'hard'}));
 assert.deepEqual(parseDemoSettings(text),{rotation:'complete',autoRotate:false,scenarioSeconds:45,botCount:8,difficulty:'hard'});
 for(const junk of ['','{oops','null','[1,2]','"str"',null,undefined,42])assert.deepEqual(parseDemoSettings(junk),DEMO_SETTINGS_DEFAULTS,`${String(junk)} recovers`);
 const polluted=parseDemoSettings('{"__proto__":{"polluted":true},"scenarioSeconds":30}');
 assert.equal(polluted.scenarioSeconds,30);
 assert.equal({}.polluted,undefined,'malformed payloads cannot pollute prototypes');
 assert.ok(DEMO_SETTINGS_KEY.length>0);
 assert.ok(DEMO_SETTINGS_LIMITS.scenarioSeconds.min<DEMO_SETTINGS_LIMITS.scenarioSeconds.max);
 assert.ok(DEMO_SETTINGS_LIMITS.botCount.min<DEMO_SETTINGS_LIMITS.botCount.max);
});

test('bot-count and difficulty settings stay inside the mode rules', () => {
 let state=null;
 const seenModes=new Set();
 for(let i=0;i<CURATED_SCENARIOS.length;i++){
  const result=pickNext(state,{rng:seededRng(i+1),rotation:'curated',settings:{botCount:999,difficulty:'nightmare'}});
  state=result.state;
  const {scenario}=result;
  assert.ok(scenario.botCount>=0&&scenario.botCount<=maxBotsFor(scenario.mode),`${scenario.mode} cap`);
  assert.equal(scenario.difficulty,'nightmare');
  assert.notEqual(scenario.botCount,999,'out-of-range bot counts are clamped to the mode cap');
  if(scenario.mode==='combined-arms')assert.equal(scenario.botCount,16);
  seenModes.add(scenario.mode);
 }
  assert.equal(seenModes.size,new Set(CURATED_SCENARIOS.map(s=>s.mode)).size);
 const zero=pickNext(null,{rng:seededRng(2),rotation:'curated',settings:{botCount:0,scenarioSeconds:45}});
 assert.equal(zero.scenario.botCount,0);
 assert.equal(zero.scenarioSeconds,45);
 const eight=pickNext(null,{rng:seededRng(4),rotation:'complete',legacy:true,settings:{botCount:8,difficulty:'hard'}});
 assert.ok(eight.scenario.botCount<=maxBotsFor(eight.scenario.mode));
 assert.equal(eight.scenario.difficulty,'hard');
 for(const scenario of completeCatalog({legacy:true})){
  const spec=scenarioSpec(scenario,seededRng(6),{settings:{botCount:999,difficulty:'godlike'}});
  assert.ok(spec.botCount>=0&&spec.botCount<=maxBotsFor(scenario.mode));
  assert.equal(spec.difficulty,scenario.difficulty,'an invalid difficulty keeps the scenario default');
 }
 const clamped=scenarioSpec(CURATED_SCENARIOS[0],()=>.5,{settings:{botCount:-5}});
 assert.equal(clamped.botCount,0);
 const fallback=scenarioSpec(CURATED_SCENARIOS[0],()=>.5);
 assert.equal(fallback.botCount,Math.min(maxBotsFor(CURATED_SCENARIOS[0].mode),CURATED_SCENARIOS[0].bots));
 assert.ok(curatedMapPool({mode:'deathmatch',maps:['crosswire']},{legacy:true}).includes('crosswire'));
 assert.ok(!curatedMapPool({mode:'deathmatch',maps:['crosswire']},{legacy:false}).includes('crosswire'));
});
