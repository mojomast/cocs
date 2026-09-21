import assert from 'node:assert/strict';
import test from 'node:test';
import {
 DEMO_CAMERA_STYLES,DEMO_FREE_SPEEDS,DEMO_STATES,applyDemoEvent,applyDemoOptions,canDemoTransition,
 createDemoSession,cycleDemoCameraStyle,cycleDemoSpeed,demoCameraStyleLabel,demoOptionsDirty,demoPinned,
 demoRunningLabels,demoScenarioState,demoSubjectOrder,freeCamStep,isDemoRunning,loadDemoSettings,nextDemoSubject,
 pickDemoScenario,pinDemoSelection,releaseDemoPins,resetDemoOptionDraft,setDemoOptionDraft,setDemoSelectionDraft,
 storeDemoSettings,switchDemoState,validateDemoSelection,
} from './demo-session.mjs';
import {DEMO_SETTINGS_DEFAULTS,DEMO_SETTINGS_KEY,demoCatalog,seededRng} from './demo-playlist.mjs';

const snapshot=(actors)=>({actors});
const actors=[
 {id:3,name:'Qwen',health:0},
 {id:1,name:'Claude',health:100},
 {id:2,name:'Gemini',health:100},
 {id:4,name:'Mistral',health:100,spectator:true},
];

test('session states cover the dock and guarded transitions hold', () => {
 assert.deepEqual(DEMO_STATES,['menu','auto','follow','free','paused','options']);
 let session=createDemoSession();
 assert.equal(session.state,'menu');
 assert.equal(canDemoTransition('menu','auto'),true);
 assert.equal(canDemoTransition('menu','free'),false);
 assert.equal(switchDemoState(session,'free'),null,'guarded switch returns null');
 session=switchDemoState(session,'auto');
 assert.equal(session.state,'auto');
 session=applyDemoEvent(session,{type:'follow'});
 assert.equal(session.state,'auto','follow without a subject is a no-op');
 session=applyDemoEvent(session,{type:'follow',actorId:2,actorName:'Gemini'});
 assert.equal(session.state,'follow');
 assert.equal(session.subjectId,2);
 assert.equal(session.subjectName,'Gemini');
 session=applyDemoEvent(session,{type:'free'});
 assert.equal(session.state,'free');
 session=applyDemoEvent(session,{type:'pause'});
 assert.equal(session.state,'paused');
 assert.equal(session.resumeState,'free');
 session=applyDemoEvent(session,{type:'resume'});
 assert.equal(session.state,'free','resuming a free-roam pause returns to free roam');
 session=applyDemoEvent(session,{type:'pause'});
 session=applyDemoEvent(session,{type:'open-options'});
 assert.equal(session.state,'options');
 assert.equal(session.resumeState,'paused','options remembers a paused demo');
 session=applyDemoEvent(session,{type:'close-options'});
 assert.equal(session.state,'paused','cancelling options returns to the paused demo');
 session=applyDemoEvent(session,{type:'resume'});
 assert.equal(session.state,'auto','resuming from pause releases pins and returns to auto');
 assert.equal(isDemoRunning('free'),true);
 assert.equal(isDemoRunning('options'),false);
 session=applyDemoEvent(session,{type:'free'});
 session=applyDemoEvent(session,{type:'open-options'});
 assert.equal(session.state,'options');
 assert.equal(session.resumeState,'free');
 session=applyDemoEvent(session,{type:'close-options'});
 assert.equal(session.state,'free');
 const exited=applyDemoEvent(session,{type:'exit'});
 assert.equal(exited.state,'menu');
 assert.equal(exited.subjectId,null);
 assert.equal(applyDemoEvent(exited,{type:'nonsense'}),exited,'unknown events are a no-op');
});

test('subject order is deterministic and cycles live actors before dead ones', () => {
 assert.deepEqual(demoSubjectOrder(snapshot(actors)).map(subject=>subject.id),[1,2,3]);
 assert.deepEqual(demoSubjectOrder({}) ,[]);
 const session=createDemoSession({state:'auto'});
 const first=nextDemoSubject(session,snapshot(actors),1);
 assert.deepEqual(first,{id:1,name:'Claude'});
 const atTwo={...session,subjectId:2};
 assert.deepEqual(nextDemoSubject(atTwo,snapshot(actors),1),{id:3,name:'Qwen'});
 assert.deepEqual(nextDemoSubject(atTwo,snapshot(actors),-1),{id:1,name:'Claude'});
 const wrapped=applyDemoEvent({...session,subjectId:3},{type:'cycle-subject',snapshot:snapshot(actors),dir:1});
 assert.equal(wrapped.state,'follow');
 assert.equal(wrapped.subjectId,1);
 assert.equal(wrapped.subjectName,'Claude');
 assert.equal(applyDemoEvent(session,{type:'cycle-subject',snapshot:snapshot([]),dir:1}),session);
});

test('camera styles cycle through the director rigs and back to auto', () => {
 assert.equal(cycleDemoCameraStyle('auto',1),DEMO_CAMERA_STYLES[1]);
 assert.equal(cycleDemoCameraStyle('auto',-1),DEMO_CAMERA_STYLES[DEMO_CAMERA_STYLES.length-1]);
 let style='auto';
 const seen=[];
 for(let i=0;i<DEMO_CAMERA_STYLES.length-1;i++){style=cycleDemoCameraStyle(style,1);seen.push(style);}
 assert.deepEqual(seen,DEMO_CAMERA_STYLES.slice(1));
 assert.equal(cycleDemoCameraStyle(style,1),'auto','a full cycle returns to auto');
 assert.equal(demoCameraStyleLabel('auto'),'AUTO DIRECTOR');
 assert.equal(demoCameraStyleLabel('firstperson'),'First Person');
 const session=applyDemoEvent(createDemoSession({state:'auto'}),{type:'cycle-camera',dir:1});
 assert.equal(session.cameraStyle,DEMO_CAMERA_STYLES[1]);
 assert.deepEqual(DEMO_FREE_SPEEDS,[8,16,28,48]);
 assert.equal(cycleDemoSpeed(16,1),28);
 assert.equal(cycleDemoSpeed(48,1),8);
});

test('the HUD toggle changes only HUD visibility', () => {
 const session=createDemoSession({state:'auto'});
 const hidden=applyDemoEvent(session,{type:'toggle-hud'});
 assert.equal(hidden.hudVisible,false);
 assert.equal(hidden.applied.scenarioSeconds,session.applied.scenarioSeconds);
 assert.equal(applyDemoEvent(hidden,{type:'toggle-hud'}).hudVisible,true,'toggling again restores the HUD');
 assert.equal(applyDemoEvent(hidden,{type:'toggle-hud',visible:false}),hidden,'an explicit unchanged state is a no-op');
 assert.equal(applyDemoEvent(hidden,{type:'toggle-hud',visible:true}).hudVisible,true);
});

test('apply validates the draft and a failure keeps the running session', () => {
 let session=createDemoSession({state:'free'});
 session=applyDemoEvent(session,{type:'set-draft',patch:{scenarioSeconds:9999,rotation:'complete'}});
 const failed=applyDemoOptions(session);
 assert.equal(failed.ok,false);
 assert.ok(failed.errors.some(error=>error.field==='scenarioSeconds'));
 assert.equal(failed.session.applied.scenarioSeconds,DEMO_SETTINGS_DEFAULTS.scenarioSeconds);
 assert.equal(failed.session.applied.rotation,'curated');
 assert.equal(failed.session.state,'free','a failed apply never leaves the demo');
 assert.ok(failed.session.error);
 const good=applyDemoOptions(setDemoOptionDraft(session,{scenarioSeconds:120,rotation:'complete'}));
 assert.equal(good.ok,true);
 assert.equal(good.settingsChanged,true);
 assert.equal(good.session.applied.rotation,'complete');
 assert.equal(good.session.applied.scenarioSeconds,120);
 assert.equal(good.session.state,'free','settings apply without restarting the match');
});

test('manual selections pin the rotation and resume releases the pin', () => {
 let session=createDemoSession({state:'auto'});
 session=applyDemoEvent(session,{type:'open-options'});
 assert.equal(session.state,'options');
 session=setDemoOptionDraft(session,{rotation:'complete'});
 session=setDemoSelectionDraft(session,{mode:'deathmatch',mapId:'exchange'});
 assert.equal(demoOptionsDirty(session),true);
 const applied=applyDemoOptions(session,{legacy:true});
 assert.equal(applied.ok,true,JSON.stringify(applied.errors));
 assert.equal(applied.selectionChanged,true);
 assert.equal(applied.session.state,'auto','applying closes the modal back to the running state');
 assert.equal(demoPinned(applied.session),true);
 assert.equal(demoOptionsDirty(applied.session),false);
 const first=pickDemoScenario(applied.session,{rng:seededRng(2),legacy:true});
 assert.equal(first.result.reason,'pin');
 assert.equal(first.spec.mode,'deathmatch');
 assert.equal(first.spec.mapId,'exchange');
 assert.equal(first.spec.scenarioSeconds,applied.session.applied.scenarioSeconds);
 const held=pickDemoScenario(first.session,{rng:seededRng(3),legacy:true});
 assert.equal(held.result.reason,'pin','the pin holds across scenarios');
 const released=releaseDemoPins(held.session);
 assert.equal(demoPinned(released),false);
 assert.deepEqual(released.selection,{mode:null,mapId:null});
 const resumed=pickDemoScenario(released,{rng:seededRng(4),legacy:true});
 assert.equal(resumed.result.coverage.resumed,true,'coverage resumes where it paused');
 assert.notEqual(resumed.result.reason,'pin');
 // Pausing and resuming releases manual pins too.
 const paused=applyDemoEvent(first.session,{type:'pause'});
 const afterResume=applyDemoEvent(paused,{type:'resume'});
 assert.equal(demoPinned(afterResume),false);
 assert.equal(afterResume.state,'auto');
});

test('invalid selections are rejected and leave the running demo alone', () => {
 assert.equal(validateDemoSelection({mode:'not-a-mode'}).ok,false);
 assert.equal(validateDemoSelection({mode:'deathmatch',mapId:'exchange'},{rotation:'curated',legacy:true}).ok,false,'curated has no exchange');
 assert.equal(validateDemoSelection({mode:'deathmatch',mapId:'exchange'},{rotation:'complete',legacy:false}).ok,false,'legacy arena needs the legacy flag');
 assert.equal(validateDemoSelection({mode:'deathmatch',mapId:'exchange'},{rotation:'complete',legacy:true}).ok,true);
 assert.equal(validateDemoSelection({mode:'ctf',mapId:'tidal-citadel'},{rotation:'curated'}).scenarioId,'ctf');
 let session=applyDemoEvent(createDemoSession({state:'follow',subjectId:1,subjectName:'Claude'}),{type:'open-options'});
 session=setDemoSelectionDraft(session,{mode:'deathmatch',mapId:'exchange'});
 const failed=applyDemoOptions(session,{legacy:false});
 assert.equal(failed.ok,false);
 assert.equal(failed.session.state,'options','a failed apply keeps the modal open for correction');
 assert.equal(failed.session.subjectId,1,'the live subject is untouched by a failed apply');
 assert.equal(demoPinned(failed.session),false);
});

test('resetting the draft restores defaults without touching the applied settings', () => {
 let session=createDemoSession({state:'auto',settings:{rotation:'complete',autoRotate:false,scenarioSeconds:120,botCount:4,difficulty:'hard'}});
 session=applyDemoEvent(session,{type:'open-options'});
 session=setDemoOptionDraft(session,{rotation:'curated'});
 session=setDemoSelectionDraft(session,{mode:'ctf'});
 session=resetDemoOptionDraft(session);
 assert.equal(demoOptionsDirty(session),true,'reset drafts defaults, which differ from the applied values');
 assert.equal(session.draft.rotation,'curated');
 assert.equal(session.applied.rotation,'complete');
 assert.deepEqual(session.draftSelection,{mode:null,mapId:null});
});

test('scenario pacing advances only with auto-rotate and restarts otherwise', () => {
 const session=createDemoSession({state:'auto',settings:{autoRotate:true,scenarioSeconds:30}});
 assert.deepEqual(demoScenarioState(session,{elapsed:10,limit:30}),{paused:false,advance:false,restart:false,expired:false});
 assert.equal(demoScenarioState(session,{elapsed:31,limit:30}).advance,true);
 assert.equal(demoScenarioState(session,{elapsed:10,limit:30,over:true}).advance,true);
 const held=createDemoSession({state:'auto',settings:{autoRotate:false,scenarioSeconds:30}});
 const heldPlan=demoScenarioState(held,{elapsed:31,limit:30});
 assert.equal(heldPlan.advance,false);
 assert.equal(heldPlan.restart,true,'a held scenario restarts instead of rotating');
 // The title (inactive) path now paces the reel exactly like the demo view: a
 // shot is held until it ends or its limit expires, instead of rebuilding the
 // scenario on every rendered frame.
 assert.deepEqual(demoScenarioState(session,{elapsed:10,limit:30,active:false}),{paused:false,advance:false,restart:false,expired:false},'the title holds a running shot');
 assert.deepEqual(demoScenarioState(session,{elapsed:30,limit:30,active:false}),{paused:false,advance:true,restart:false,expired:true},'the title rotates once the scenario expires');
 assert.equal(demoScenarioState(session,{elapsed:10,limit:30,over:true,active:false}).advance,true,'an ended match rotates the title too');
 assert.deepEqual(demoScenarioState(held,{elapsed:31,limit:30,active:false}),{paused:false,advance:false,restart:true,expired:true},'rotation off restarts the same title scenario');
 assert.equal(demoScenarioState(createDemoSession({state:'menu'}),{elapsed:10,limit:30,active:false}).paused,false,'the title never pauses for a menu session');
 // Only the absence of a scenario forces an immediate advance (first build).
 assert.equal(demoScenarioState(null,{active:false}).advance,true,'without a session the title asks for the initial build');
 assert.equal(demoScenarioState({state:'menu'},{active:false}).advance,true,'without applied settings there is no scenario clock to pace');
 assert.equal(demoScenarioState(createDemoSession({state:'paused'}),{elapsed:99}).paused,true);
});

test('pickDemoScenario is deterministic for a seeded rng and never mutates its input', () => {
 const catalog=demoCatalog('curated');
 const run=()=>{
  let session=createDemoSession({state:'auto'});
  const ids=[];
  for(let i=0;i<catalog.length;i++){
   const result=pickDemoScenario(session,{rng:seededRng(23+i),legacy:true,afterEnd:true});
   assert.ok(result.spec,result.result.details);
   ids.push(result.spec.id);
   session=result.session;
  }
  return ids;
 };
 const a=run(),b=run();
 assert.deepEqual(a,b,'the same seeds replay the same reel');
 assert.deepEqual([...a].sort(),catalog.map(scenario=>scenario.id).sort(),'a full pass covers the curated catalog');
 const before=createDemoSession({state:'auto'});
 const frozen=JSON.stringify(before);
 pickDemoScenario(before,{rng:seededRng(1),legacy:true});
 assert.equal(JSON.stringify(before),frozen,'the input session is not mutated');
});

test('labels describe the running scenario, camera, HUD and rotation', () => {
 const session=applyDemoEvent(createDemoSession({state:'follow',settings:{scenarioSeconds:90}}),{type:'cycle-subject',snapshot:snapshot(actors),dir:1});
 const picked=pickDemoScenario(session,{rng:seededRng(1),legacy:true});
 const labels=demoRunningLabels(picked.session,{actual:{modeName:'Deathmatch',mapName:'Colosseum',mode:'deathmatch',mapId:'colosseum'}});
 assert.equal(labels.stateLabel,'FOLLOW SUBJECT');
 assert.equal(labels.cameraLabel,'FOLLOWING CLAUDE');
 assert.equal(labels.actualLabel,'Deathmatch · Colosseum');
 assert.equal(labels.scenarioSeconds,90);
 assert.equal(labels.hudLabel,'HUD ON');
 assert.match(labels.rotationLabel,/CURATED · AUTO · \d+ LEFT/);
 const hidden=applyDemoEvent(picked.session,{type:'toggle-hud'});
 assert.equal(demoRunningLabels(hidden).hudLabel,'HUD HIDDEN');
 const pinned=pinDemoSelection(hidden,{mode:'ctf',mapId:'frost-gate'});
 assert.equal(demoRunningLabels(pinned).pinnedLabel,'PINNED · ctf @ frost-gate');
});

test('free camera steps match the view axis convention and clamp to the floor', () => {
 const start={x:0,y:6,z:0,yaw:0,pitch:0};
 assert.deepEqual(freeCamStep(start,.1,{forward:1,right:0,up:0}),{x:0,y:6,z:-1.6,yaw:0,pitch:0});
 const boosted=freeCamStep(start,.1,{forward:1,right:0,up:0,boost:true});
 assert.equal(boosted.z,-1.6*2.4);
 const strafed=freeCamStep(start,.1,{forward:0,right:1,up:0});
 assert.equal(strafed.x,1.6);
 const up=freeCamStep({...start,pitch:Math.PI/2},.1,{forward:1,right:0,up:0});
 assert.ok(up.y>6);
 assert.equal(freeCamStep(start,1,{forward:0,right:0,up:-100}).y,.4,'never below the floor');
 assert.equal(freeCamStep(start,.1,{forward:1,speed:8}).z,-.8,'speed is adjustable');
 assert.deepEqual(freeCamStep(start,.1,{forward:0,right:0,up:0}),start,'idle does not move');
});

test('settings persistence round-trips validated preferences', () => {
 const stored=storeDemoSettings({rotation:'complete',autoRotate:false,scenarioSeconds:120,botCount:6,difficulty:'hard'});
 assert.equal(typeof stored,'string');
 const loaded=loadDemoSettings(stored);
 assert.deepEqual(loaded,{rotation:'complete',autoRotate:false,scenarioSeconds:120,botCount:6,difficulty:'hard'});
 assert.deepEqual(loadDemoSettings('{not json'),DEMO_SETTINGS_DEFAULTS);
 assert.equal(typeof DEMO_SETTINGS_KEY,'string');
 const loadedSession=applyDemoEvent(createDemoSession(),{type:'load-settings',settings:loaded});
 assert.deepEqual(loadedSession.applied,loaded);
 assert.deepEqual(loadedSession.rotation.rotation,'complete');
});
