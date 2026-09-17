// Attract-demo session: the pure state machine, settings draft/apply layer,
// camera + subject ownership helpers and rotation bridge that back the
// "Back to Demo" control dock and Demo Options modal. No DOM, no React and no
// timers: page.tsx mirrors the returned plain objects into state and performs
// the side effects (view/director calls, match builds) that need a live
// runtime. Everything here is deterministic and unit-testable, including the
// free-cam step the page uses when game/view.mjs has no `freeMove` hook yet.
import {CAMERA_RIGS} from './director.mjs';
import {CAMERA_MODE_LABELS} from './camera-modes.mjs';
import {GAME_MODES} from './config.mjs';
import {
 DEMO_SETTINGS_DEFAULTS,createRotationState,demoCatalog,normalizeDemoSettings,
 pairEligibility,parseDemoSettings,pickNext,pinScenario,releasePin,resetDemoSettings,scenarioMaps,
 serializeDemoSettings,validateDemoSettings,
} from './demo-playlist.mjs';

// The states the demo session can occupy. `menu` is the title screen (the
// showcase still runs behind it), the three running states share the match but
// differ in camera ownership, `paused` freezes the reel, `options` is the modal.
export const DEMO_STATES=Object.freeze(['menu','auto','follow','free','paused','options']);
export const DEMO_RUNNING_STATES=Object.freeze(['auto','follow','free']);
export const DEMO_CAMERA_STYLES=Object.freeze(['auto',...CAMERA_RIGS]);
export const DEMO_FREE_SPEEDS=Object.freeze([8,16,28,48]);
export const DEMO_FREE_DEFAULT_SPEED=16;
export const DEMO_FREE_MIN_Y=.4;

// Guarded transition table. Same-state transitions are never required; a guard
// failure leaves the session untouched so the caller can keep rendering.
const TRANSITIONS=Object.freeze({
 menu:Object.freeze(['auto','options']),
 auto:Object.freeze(['menu','follow','free','paused','options']),
 follow:Object.freeze(['menu','auto','free','paused','options']),
 free:Object.freeze(['menu','auto','follow','paused','options']),
 paused:Object.freeze(['menu','auto','options']),
 options:Object.freeze(['menu','auto','follow','free','paused']),
});

export function canDemoTransition(from,to){
 if(!DEMO_STATES.includes(from)||!DEMO_STATES.includes(to))return false;
 if(from===to)return false;
 return TRANSITIONS[from].includes(to);
}

export function isDemoRunning(state){return DEMO_RUNNING_STATES.includes(state);}

export const demoStateLabel=state=>state==='auto'?'AUTO DIRECTOR':state==='follow'?'FOLLOW SUBJECT':state==='free'?'FREE ROAM':state==='paused'?'PAUSED':state==='options'?'DEMO OPTIONS':'STANDBY';

export function createDemoSession(overrides={}){
 const settings=normalizeDemoSettings(overrides.settings??DEMO_SETTINGS_DEFAULTS);
 const state=DEMO_STATES.includes(overrides.state)?overrides.state:'menu';
 return {
  version:1,
  state,
  resumeState:isDemoRunning(overrides.resumeState)?overrides.resumeState:'auto',
  hudVisible:overrides.hudVisible!==false,
  cameraStyle:DEMO_CAMERA_STYLES.includes(overrides.cameraStyle)?overrides.cameraStyle:'auto',
  subjectId:Number.isInteger(overrides.subjectId)?overrides.subjectId:null,
  subjectName:typeof overrides.subjectName==='string'?overrides.subjectName:null,
  freeSpeed:Number.isFinite(overrides.freeSpeed)&&overrides.freeSpeed>0?overrides.freeSpeed:DEMO_FREE_DEFAULT_SPEED,
  applied:settings,
  draft:{...settings},
  selection:{mode:null,mapId:null},
  draftSelection:{mode:null,mapId:null},
  rotation:createRotationState({rotation:settings.rotation,pin:overrides.pin??null}),
  coverage:null,
  lastPick:null,
  invalidPin:null,
  error:null,
  errors:[],
  notice:null,
 };
}

const copySession=session=>({
 ...session,
 applied:{...session.applied},
 draft:{...session.draft},
 selection:{...session.selection},
 draftSelection:{...session.draftSelection},
});

// ---------------------------------------------------------------------------
// Transition events. `applyDemoEvent` never throws and never performs I/O: an
// unknown event or a guarded transition returns the session unchanged (same
// reference), so callers can cheaply detect a no-op.
// ---------------------------------------------------------------------------
export function applyDemoEvent(session,event={}){
 if(!session||typeof session!=='object')return session;
 const type=event.type;
 if(type==='enter')return {...session,state:'auto',resumeState:'auto',cameraStyle:'auto',subjectId:null,subjectName:null,error:null,notice:event.notice??null};
 if(type==='exit')return {...session,state:'menu',resumeState:'auto',cameraStyle:'auto',subjectId:null,subjectName:null,error:null};
 if(type==='pause'){
  if(!isDemoRunning(session.state))return session;
  return {...session,state:'paused',resumeState:session.state,error:null};
 }
 if(type==='resume'){
  if(session.state!=='paused')return session;
  return {...releaseDemoPins(session),state:session.resumeState==='free'?'free':'auto',resumeState:'auto'};
 }
 if(type==='auto'){
  if(!isDemoRunning(session.state))return session;
  return {...releaseDemoPins(session),state:'auto'};
 }
 if(type==='follow'){
  const target=Number.isInteger(event.actorId)?{id:event.actorId,name:event.actorName??null}:null;
  if(!isDemoRunning(session.state)&&session.state!=='options')return session;
  if(!target&&!Number.isInteger(session.subjectId))return session;
  return {...session,state:'follow',subjectId:target?target.id:session.subjectId,subjectName:target?target.name:session.subjectName,error:null};
 }
 if(type==='free'){
  if(!isDemoRunning(session.state))return session;
  return {...session,state:'free',error:null};
 }
 if(type==='cycle-subject'){
  if(!isDemoRunning(session.state)&&session.state!=='options')return session;
  const next=nextDemoSubject(session,event.snapshot,event.dir);
  if(!next)return session;
  return {...session,state:'follow',subjectId:next.id,subjectName:next.name,error:null};
 }
 if(type==='cycle-camera'){
  const style=cycleDemoCameraStyle(session.cameraStyle,event.dir);
  if(style===session.cameraStyle)return session;
  return {...session,cameraStyle:style,error:null};
 }
 if(type==='cycle-speed'){
  const speed=cycleDemoSpeed(session.freeSpeed,event.dir);
  if(speed===session.freeSpeed)return session;
  return {...session,freeSpeed:speed};
 }
 if(type==='toggle-hud'){
  const hudVisible=typeof event.visible==='boolean'?event.visible:!session.hudVisible;
  if(hudVisible===session.hudVisible)return session;
  return {...session,hudVisible};
 }
 if(type==='release-pins')return releaseDemoPins(session,{rotation:event.rotation!==false});
 if(type==='open-options'){
  if(session.state==='options')return session;
  const resumeState=session.state==='paused'?'paused':isDemoRunning(session.state)?session.state:'auto';
  return {...session,state:'options',resumeState,draft:{...session.applied},draftSelection:{...session.selection},error:null,errors:[]};
 }
 if(type==='close-options'){
  if(session.state!=='options')return session;
  return {...session,state:session.resumeState==='options'?'auto':session.resumeState,error:null,errors:[]};
 }
 if(type==='set-draft'){
  const next=setDemoOptionDraft(session,event.patch);
  if(event.selection)return setDemoSelectionDraft(next,event.selection);
  return next;
 }
 if(type==='set-selection')return setDemoSelectionDraft(session,event.selection);
 if(type==='reset-draft')return resetDemoOptionDraft(session);
 if(type==='apply-options')return applyDemoOptions(session,event.options);
 if(type==='load-settings'){
  const settings=normalizeDemoSettings(event.settings);
  return {...session,applied:settings,draft:{...settings},rotation:createRotationState({rotation:settings.rotation,pin:session.rotation?.pin??null})};
 }
 if(type==='error')return {...session,error:String(event.message??''),errors:Array.isArray(event.errors)?event.errors:[]};
 if(type==='clear-error')return session.error===null?session:{...session,error:null,errors:[]};
 if(type==='notice')return {...session,notice:event.message==null?null:String(event.message)};
 return session;
}

// Guarded state switch used by tests and callers that do not go through an
// event: returns a new session when the transition is legal, null otherwise.
export function switchDemoState(session,to){
 if(!canDemoTransition(session?.state,to))return null;
 return {...session,state:to,resumeState:isDemoRunning(session.state)?session.state:session.resumeState};
}

// ---------------------------------------------------------------------------
// Camera style + subject cycling.
// ---------------------------------------------------------------------------
export function cycleDemoCameraStyle(current,dir=1){
 const n=DEMO_CAMERA_STYLES.length;
 const i=DEMO_CAMERA_STYLES.indexOf(current);
 const base=i<0?0:i;
 const step=Math.round(Number.isFinite(dir)?dir:1)||1;
 return DEMO_CAMERA_STYLES[((base+step)%n+n)%n];
}

export function demoCameraStyleLabel(style){return style==='auto'?'AUTO DIRECTOR':CAMERA_MODE_LABELS[style]??String(style??'').toUpperCase();}

export function cycleDemoSpeed(current,dir=1){
 const n=DEMO_FREE_SPEEDS.length;
 const i=DEMO_FREE_SPEEDS.indexOf(Number(current));
 const base=i<0?DEMO_FREE_SPEEDS.indexOf(DEMO_FREE_DEFAULT_SPEED):i;
 const step=Math.round(Number.isFinite(dir)?dir:1)||1;
 return DEMO_FREE_SPEEDS[((base+step)%n+n)%n];
}

// Deterministic subject order: live actors first, then by id. The same snapshot
// always produces the same order, so the dock can offer prev/next subject
// without the list reshuffling under the user's finger.
export function demoSubjectOrder(snapshot){
 const actors=Array.isArray(snapshot?.actors)?snapshot.actors:[];
 return actors
  .filter(actor=>actor&&actor.id!==null&&actor.id!==undefined&&actor.spectator!==true)
  .slice()
  .sort((a,b)=>(Number(b.health)>0?1:0)-(Number(a.health)>0?1:0)||Number(a.id)-Number(b.id))
  .map(actor=>({id:actor.id,name:String(actor.name||`BOT ${actor.id}`)}));
}

export function nextDemoSubject(session,snapshot,dir=1){
 const order=demoSubjectOrder(snapshot);
 if(!order.length)return null;
 const step=Math.round(Number.isFinite(dir)?dir:1)||1;
 const at=order.findIndex(subject=>subject.id===session?.subjectId);
 const base=at<0?(step>0?-1:0):at;
 return order[(((base+step)%order.length)+order.length)%order.length];
}

export function demoSubjectById(snapshot,id){
 if(id===null||id===undefined)return null;
 const found=demoSubjectOrder(snapshot).find(subject=>subject.id===id);
 return found??null;
}

// ---------------------------------------------------------------------------
// Options draft vs applied settings. `applyDemoOptions` validates first and,
// on any error, returns the running session untouched (plus the errors) so a
// failed Apply can never restart or corrupt the live demo.
// ---------------------------------------------------------------------------
export function setDemoOptionDraft(session,patch){
 const clean=patch&&typeof patch==='object'?patch:{};
 return {...copySession(session),draft:{...session.draft,...clean},error:null,errors:[]};
}

export function setDemoSelectionDraft(session,patch){
 const clean=patch&&typeof patch==='object'?patch:{};
 return {...copySession(session),draftSelection:{...session.draftSelection,...clean},error:null,errors:[]};
}

export function resetDemoOptionDraft(session){
 const defaults=resetDemoSettings();
 return {...copySession(session),draft:defaults,draftSelection:{mode:null,mapId:null},error:null,errors:[]};
}

const selectionKey=selection=>`${selection?.mode??''}|${selection?.mapId??''}`;
const settingsKey=settings=>JSON.stringify(normalizeDemoSettings(settings));

export function demoOptionsDirty(session){
 if(!session)return false;
 return settingsKey(session.applied)!==settingsKey(session.draft)||selectionKey(session.selection)!==selectionKey(session.draftSelection);
}

// Registry-validated mode/map selection: the pair must be demo-eligible *and*
// present in the rotation catalog the settings would activate, so a curated
// selection cannot pin a map the curated reel would never serve.
export function validateDemoSelection(selection,{rotation='curated',legacy=false}={}){
 const mode=typeof selection?.mode==='string'&&selection.mode?selection.mode:null;
 const mapId=typeof selection?.mapId==='string'&&selection.mapId?selection.mapId:null;
 const errors=[];
 if(mode&&!GAME_MODES.some(entry=>entry.id===mode))errors.push({field:'mode',message:`'${mode}' is not a registered game mode.`});
 const catalog=demoCatalog(rotation,{legacy});
 const matches=errors.length?[]:catalog.filter(scenario=>(!mode||scenario.mode===mode)&&(!mapId||scenarioMaps(scenario).includes(mapId)));
 if(!errors.length&&!matches.length)errors.push({field:mapId?'mapId':'mode',message:`${mode||'That selection'}${mapId?` on ${mapId}`:''} is not part of the ${rotation} rotation; switch rotation or pick an eligible pair.`});
 if(!errors.length&&mode&&mapId){
  const verdict=pairEligibility(mode,mapId,{legacy});
  if(!verdict.eligible)errors.push({field:'mapId',message:verdict.detail});
 }
 return {ok:errors.length===0,errors,mode,mapId,scenarioId:errors.length?null:matches[0].id};
}

export function applyDemoOptions(session,options={}){
 const validate=typeof options.validate==='function'?options.validate:validateDemoSettings;
 const legacy=options.legacy===true;
 const verdict=validate(session.draft);
 const draftRotation=normalizeDemoSettings(session.draft).rotation;
 const selection=validateDemoSelection(session.draftSelection,{rotation:draftRotation,legacy});
 const errors=[...verdict.errors,...selection.errors];
 if(errors.length)return {ok:false,session:{...session,error:errors[0].message,errors},errors,selectionChanged:false,settingsChanged:false};
 const applied=normalizeDemoSettings(verdict.settings);
 const selectionChanged=selectionKey(selection)!==selectionKey(session.selection);
 const settingsChanged=JSON.stringify(applied)!==JSON.stringify(normalizeDemoSettings(session.applied));
 let next={
  ...copySession(session),
  applied,
  draft:{...applied},
  selection:{mode:selection.mode,mapId:selection.mapId},
  draftSelection:{mode:selection.mode,mapId:selection.mapId},
  error:null,
  errors:[],
  lastPick:settingsChanged?null:session.lastPick,
 };
 next=selection.mode||selection.mapId?pinDemoSelection(next,{mode:selection.mode,mapId:selection.mapId}):releaseDemoPins(next,{rotation:true});
 if(session.state==='options')next={...next,state:session.resumeState==='options'?'auto':session.resumeState,resumeState:'auto'};
 return {ok:true,session:next,errors:[],selectionChanged,settingsChanged};
}

// ---------------------------------------------------------------------------
// Rotation bridge. Manual map/mode selections are rotation pins: they hold the
// reel until the user resumes automatic rotation, at which point they are
// released and the pass continues where it paused (`coverage.resumed`).
// ---------------------------------------------------------------------------
export function demoPinned(session){return Boolean(session?.rotation?.pin);}

export function pinDemoSelection(session,{mode=null,mapId=null,scenarioId=null}={}){
 if(!mode&&!mapId&&!scenarioId)return releaseDemoPins(session,{rotation:true});
 const rotation=pinScenario(session.rotation??createRotationState(),{mode,mapId,scenarioId});
 const pinnedScenario=scenarioId??([mode,mapId].filter(Boolean).join(' · ')||'selection');
 return {...session,rotation,selection:{mode:mode??null,mapId:mapId??null},notice:`Manual pin held on ${pinnedScenario}.`};
}

export function releaseDemoPins(session,{rotation=true}={}){
 const next={...session,subjectId:null,subjectName:null,cameraStyle:'auto'};
 if(!rotation)return next;
 return {...next,rotation:releasePin(session.rotation??createRotationState()),selection:{mode:null,mapId:null},invalidPin:null,notice:'Automatic rotation resumed.'};
}

// Pick the next scenario spec. The injected rng keeps a fixed seed replaying
// the exact same reel; the input session is never mutated.
export function pickDemoScenario(session,options={}){
 const rng=typeof options.rng==='function'?options.rng:Math.random;
 const applied=normalizeDemoSettings(session?.applied);
 const base=session?.rotation??createRotationState({rotation:applied.rotation});
 const result=pickNext(base,{
  rng,
  legacy:options.legacy===true,
  afterEnd:options.afterEnd===true,
  rotation:applied.rotation,
  settings:applied,
  scenarioId:typeof options.scenarioId==='string'?options.scenarioId:undefined,
  mode:typeof options.mode==='string'?options.mode:undefined,
  mapId:typeof options.mapId==='string'?options.mapId:undefined,
 });
 const spec=result.scenario?{...result.scenario,scenarioSeconds:applied.scenarioSeconds}:null;
 const next={
  ...session,
  rotation:result.state,
  coverage:result.coverage,
  invalidPin:result.invalidPin??null,
  lastPick:result.scenario?{reason:result.reason,details:result.details,id:result.scenario.id}:null,
  notice:result.scenario&&result.reason!=='pin'&&result.reason!=='advance'?result.details:null,
  error:null,
 };
 return {spec,result,session:next};
}

// ---------------------------------------------------------------------------
// Reel pacing. In the "Back to Demo" view the user can hold a scenario
// (autoRotate off): the reel then restarts the same scenario instead of
// rotating while still staying alive.
// ---------------------------------------------------------------------------
export function demoScenarioState(session,{elapsed=0,limit=0,over=false,active=true}={}){
 if(!active)return {paused:false,advance:true,restart:false,expired:false};
 if(!isDemoRunning(session?.state))return {paused:true,advance:false,restart:false,expired:false};
 const cap=Number.isFinite(limit)&&limit>0?limit:session.applied.scenarioSeconds;
 const expired=over===true||(Number.isFinite(elapsed)&&elapsed>=cap);
 if(!expired)return {paused:false,advance:false,restart:false,expired:false};
 if(session.applied.autoRotate)return {paused:false,advance:true,restart:false,expired:true};
 return {paused:false,advance:false,restart:true,expired:true};
}

// ---------------------------------------------------------------------------
// Labels. All strings the dock renders, including the actual running scenario
// (from the live match) next to the requested selection.
// ---------------------------------------------------------------------------
export function demoRunningLabels(session,{actual=/** @type {any} */(null),subjects=/** @type {any} */(null),legacy=false}={}){
 const subjectName=session?.subjectName??(Array.isArray(subjects)?subjects.find(subject=>subject.id===session?.subjectId)?.name:null);
 const remaining=Number.isFinite(session?.coverage?.remaining)?session.coverage.remaining:null;
 const rotation=session?.applied?.rotation??'curated';
 const pinned=demoPinned(session);
 const actualLabel=actual?`${actual.modeName??actual.mode??'DEMO'} · ${actual.mapName??actual.mapId??'ARENA'}`:null;
 const selectionLabel=session?.selection?.mode||session?.selection?.mapId
  ?`PINNED · ${[session.selection.mode,session.selection.mapId].filter(Boolean).join(' @ ')}`
  :'AUTO ROTATION';
 return {
  state:session?.state??'menu',
  stateLabel:demoStateLabel(session?.state),
  cameraLabel:session?.state==='follow'&&subjectName?`FOLLOWING ${String(subjectName).toUpperCase()}`:demoCameraStyleLabel(session?.cameraStyle),
  styleLabel:demoCameraStyleLabel(session?.cameraStyle),
  hudLabel:session?.hudVisible===false?'HUD HIDDEN':'HUD ON',
  rotationLabel:`${String(rotation).toUpperCase()}${session?.applied?.autoRotate===false?' · HELD':' · AUTO'}${remaining!==null?` · ${remaining} LEFT`:''}`,
  selectionLabel,
  pinnedLabel:pinned?`PINNED · ${[session.selection?.mode,session.selection?.mapId].filter(Boolean).join(' @ ')||'SELECTION'}`:null,
  actualLabel,
  actual,
  scenarioSeconds:session?.applied?.scenarioSeconds??DEMO_SETTINGS_DEFAULTS.scenarioSeconds,
  autoRotate:session?.applied?.autoRotate!==false,
  legacy:legacy===true,
 };
}

// ---------------------------------------------------------------------------
// Free-cam math. The page calls `view.freeMove` when a newer view.mjs exposes
// it; until then this mirrors the existing `view.updateFreeCam` integration
// (same axis convention) while adding an adjustable speed. Pure: the pose is
// never mutated.
// ---------------------------------------------------------------------------
export function freeCamStep(pose,dt,input={}){
 const current=pose&&typeof pose==='object'?pose:{};
 const step=Math.min(Math.max(Number.isFinite(dt)?dt:0,0),.1);
 const speed=Math.max(1,Number.isFinite(input.speed)?input.speed:DEMO_FREE_DEFAULT_SPEED)*(input.boost===true?2.4:1)*step;
 const fwd=Number.isFinite(input.forward)?input.forward:0;
 const strafe=Number.isFinite(input.right)?input.right:0;
 const rise=Number.isFinite(input.up)?input.up:0;
 const yaw=Number.isFinite(current.yaw)?current.yaw:0;
 const pitch=Number.isFinite(current.pitch)?current.pitch:0;
 const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 let x=(Number.isFinite(current.x)?current.x:0)+speed*(fwd*(-cp*sy)+strafe*cy);
 let y=(Number.isFinite(current.y)?current.y:0)+speed*(fwd*sp+rise);
 let z=(Number.isFinite(current.z)?current.z:0)+speed*(fwd*(-cp*cy)+strafe*(-sy));
 if(!(y>=DEMO_FREE_MIN_Y))y=DEMO_FREE_MIN_Y;
 if(!Number.isFinite(x))x=0;
 if(!Number.isFinite(y))y=DEMO_FREE_MIN_Y;
 if(!Number.isFinite(z))z=0;
 return {x,y,z,yaw,pitch};
}

// ---------------------------------------------------------------------------
// Persistence helpers kept here so page.tsx only touches one demo module.
// ---------------------------------------------------------------------------
export {DEMO_SETTINGS_KEY,DEMO_SETTINGS_LIMITS,DEMO_SETTINGS_DEFAULTS,ROTATIONS} from './demo-playlist.mjs';
export function loadDemoSettings(text){return parseDemoSettings(text);}
export function storeDemoSettings(settings){return serializeDemoSettings(settings);}
