import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView} from './view.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';
import {RACE_DEMO_MODE_SECONDS} from './race-camera.mjs';
import {CAMERA_OWNERS,normalizeCameraOwner,cameraOwnerAllowsRace,cameraModeOwner,integrateFreeMove,FREE_CAM_DEFAULT_SPEED,FREE_CAM_BOOST,FREE_CAM_MAX_SPEED,FREE_CAM_MAX_BASE_SPEED} from './camera-modes.mjs';

// Minimal renderable view: the same shape the pinned race-demo test uses, plus
// a raycaster so the planned-shot collision pass is exercised for real.
function bareView({reduced=false,software=false}={}){
 const view=Object.assign(Object.create(ArenaView.prototype),{
  scene:new T.Scene(),worldGroup:new T.Group(),camera:new T.PerspectiveCamera(80,1,.08,220),hands:new T.Group(),
  renderer:{isSoftware:software,render(){}},resize(){},actorModels:new Map(),pickupModels:[],flagModels:new Map(),objectiveModels:new Map(),
  playerId:0,currentWeapon:-1,lastEvent:0,motionQuery:{matches:reduced},display:{...DEFAULT_DISPLAY,fov:80},raycaster:new T.Raycaster(),_renderPreview(){},
 });
 view.scene.add(view.worldGroup,view.camera);view.camera.add(view.hands);view.camera.rotation.order='YXZ';
 return view;
}

function cleanup(view){
 view.effectPool?.dispose();view.projectilePool?.dispose();view.railPool?.dispose();view.decalPool?.dispose();
 view.deathPool?.dispose();view.ambientPool?.dispose();view.weatherPool?.dispose();view.disposeObject(view.scene);
}

const actor=overrides=>({id:0,weapon:0,health:100,x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,...overrides});
const match=(actors,extra={})=>({actors,pickups:[],rockets:[],time:1,events:[],arena:{id:'test'},...extra});

function raceMatch(){
 const vehicles=[{id:0,kind:'puma',x:5,y:0,z:0,yaw:0}];
 const centerline=Array.from({length:8},(_,i)=>({x:Math.cos(i/8*Math.PI*2)*30,z:Math.sin(i/8*Math.PI*2)*30}));
 return {actors:[actor({vehicleId:0})],vehicles,pickups:[],rockets:[],race:{boxes:[],hazards:[],centerline},mapId:'puma-circuit',time:0,events:[],arena:{id:'puma-circuit'}};
}

const directorPose=()=>({x:0,y:5,z:10,pitch:-.4,yaw:0,roll:0,fov:70,cut:false});

test('camera ownership normalizes unknown values and gates race poses',()=>{
 for(const owner of CAMERA_OWNERS)assert.equal(normalizeCameraOwner(owner),owner);
 assert.equal(normalizeCameraOwner('bogus'),'auto');
 assert.equal(normalizeCameraOwner(undefined),'auto');
 assert.equal(normalizeCameraOwner(null),'auto');
 assert.equal(cameraOwnerAllowsRace('auto'),true,'the automatic owner still runs race rigs for back-compat');
 assert.equal(cameraOwnerAllowsRace('race'),true);
 assert.equal(cameraOwnerAllowsRace('manual'),false);
 assert.equal(cameraOwnerAllowsRace('free'),false);
 assert.equal(cameraModeOwner('auto'),'auto');
 assert.equal(cameraModeOwner('free'),'free');
 for(const mode of ['orbit','chase','dolly','crane','tripod','follow','firstperson','flyover','cinematic','overshoulder','freelook','tactical']){
  assert.equal(cameraModeOwner(mode),'manual',`${mode} is a manual framing choice`);
 }
});

test('switching owners takes effect immediately and clears cached camera state',()=>{
 const view=bareView();
 assert.equal(view.cameraOwner,'auto');
 view._camWant=4;view._raceCam={mode:'chase'};
 view.setCameraOwner('manual');
 assert.equal(view.cameraOwner,'manual');
 assert.equal(view._camWant,undefined,'collision hysteresis is dropped on an ownership change');
 assert.equal(view._raceCam,undefined,'race smoothing memory is dropped on an ownership change');
 view._camWant=4;view._raceCam={};
 assert.equal(view.setCameraOwner('race'),'race');
 assert.equal(view._camWant,undefined);
 assert.equal(view.setCameraOwner('bogus'),'auto','an unknown owner falls back to auto rather than latching');
 cleanup(view);
});

test('free roam enters from the current pose and never re-seeds a live camera',()=>{
 const view=bareView();
 view.camera.position.set(3,7,-2);view.camera.rotation.set(.3,.8,0,'YXZ');
 view.setFreeCam(true);
 assert.equal(view.freeCam,true);
 assert.equal(view.cameraOwner,'free');
 assert.deepEqual(view.freePose,{x:3,y:7,z:-2,yaw:.8,pitch:.3},'enabling seeds from the live camera pose, not the origin');
 // Moving the camera while already free must not wipe the flown pose.
 view.camera.position.set(9,9,9);view.camera.rotation.set(0,0,0,'YXZ');
 view.setFreeCam(true);
 assert.equal(view.freePose.x,3);
 assert.equal(view.freePose.y,7);
 view.setCameraOwner('free');
 assert.equal(view.freePose.x,3,'routing ownership through the setter is idempotent');
 cleanup(view);
});

test('freeMove accelerates with a settable base speed, boost multiplier and a hard ceiling',()=>{
 const view=bareView();
 view.setFreeCam(true);view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};view.clearFreeMotion();
 const frame=1/60;
 const startZ=view.freePose.z;
 view.freeMove({forward:1},frame);
 const firstStep=Math.abs(view.freePose.z-startZ);
 for(let i=0;i<600;i++)view.freeMove({forward:1},frame);
 const settled=view.freePose.z;view.freeMove({forward:1},frame);
 const cruising=Math.abs(view.freePose.z-settled);
 assert.ok(firstStep<cruising*.5,`acceleration ramps instead of snapping (${firstStep} vs ${cruising})`);
 assert.ok(cruising<=view.freeCamSpeed*frame*1.02,'the base speed bounds the cruise');
 assert.ok(cruising>=view.freeCamSpeed*frame*.95,'free roam reaches its settable base speed');
 // Boost multiplies the base speed, still inside the hard ceiling.
 const boostedTop=Math.min(FREE_CAM_MAX_SPEED,view.freeCamSpeed*FREE_CAM_BOOST);
 view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};view.clearFreeMotion();
 for(let i=0;i<600;i++)view.freeMove({forward:1,boost:true},frame);
 const boostedStart=view.freePose.z;view.freeMove({forward:1,boost:true},frame);
 const boosted=Math.abs(view.freePose.z-boostedStart);
 assert.ok(boosted>cruising*1.8,'boost is a real multiplier');
 assert.ok(boosted<=boostedTop*frame*1.02,'boost stays under the top speed');
 // A settable base speed can be raised, but the hard ceiling still wins.
 view.setFreeCamSpeed(999);
 assert.equal(view.freeCamSpeed,FREE_CAM_MAX_BASE_SPEED);
 view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};view.clearFreeMotion();
 for(let i=0;i<600;i++)view.freeMove({forward:1,boost:true},frame);
 const cappedStart=view.freePose.z;view.freeMove({forward:1,boost:true},frame);
 const capped=Math.abs(view.freePose.z-cappedStart);
 assert.ok(capped<=FREE_CAM_MAX_SPEED*frame*1.02,'the hard ceiling bounds boosted speed');
 assert.ok(capped>=FREE_CAM_MAX_SPEED*frame*.95,'the ceiling is actually reachable');
 // Diagonal WASD + vertical input is normalized, never faster than one axis.
 view.setFreeCamSpeed(FREE_CAM_DEFAULT_SPEED);
 view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};view.clearFreeMotion();
 for(let i=0;i<300;i++)view.freeMove({forward:1,right:1,up:1},frame);
 const start={x:view.freePose.x,y:view.freePose.y,z:view.freePose.z};
 view.freeMove({forward:1,right:1,up:1},frame);
 const diagonal=Math.hypot(view.freePose.x-start.x,view.freePose.y-start.y,view.freePose.z-start.z);
 assert.ok(diagonal<=FREE_CAM_DEFAULT_SPEED*frame*1.02,'diagonal input is bounded by the same top speed');
 assert.ok(diagonal>cruising*.9,'diagonal input still flies');
 cleanup(view);
});

test('freeMove is frame-rate independent and integrates in place',()=>{
 const fast=bareView(),slow=bareView();
 for(const view of [fast,slow]){view.setFreeCam(true);view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};view.clearFreeMotion();}
 for(let i=0;i<30;i++)fast.freeMove({forward:1,right:.5},1/60);
 for(let i=0;i<72;i++)slow.freeMove({forward:1,right:.5},1/144);
 assert.ok(Math.abs(fast._freeVel.x-slow._freeVel.x)<1e-6,`velocity matches across frame rates (${fast._freeVel.x} vs ${slow._freeVel.x})`);
 assert.ok(Math.abs(fast._freeVel.z-slow._freeVel.z)<1e-6);
 assert.ok(Math.abs(fast.freePose.z-slow.freePose.z)<.05,`displacement matches across frame rates (${fast.freePose.z} vs ${slow.freePose.z})`);
 const pose=fast.freePose,velocity=fast._freeVel;
 fast.freeMove({forward:1,right:.5},1/60);
 assert.equal(fast.freePose,pose,'the pose object is reused');
 assert.equal(fast._freeVel,velocity,'the velocity scratch vector is reused');
 assert.equal(fast.freeMove({forward:1},1/60),pose,'freeMove returns the same pose object');
 cleanup(fast);cleanup(slow);
});

test('movement state never persists across ownership or mode changes',()=>{
 const view=bareView();
 view.setFreeCam(true);view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};
 for(let i=0;i<60;i++)view.freeMove({forward:1},1/60);
 assert.ok(Math.abs(view._freeVel.z)>1,'velocity built up while flying');
 view.setCameraOwner('manual');
 assert.deepEqual([view._freeVel.x,view._freeVel.y,view._freeVel.z],[0,0,0],'leaving free zeroes the velocity');
 const held={...view.freePose};
 view.freeMove({forward:1},.1);
 assert.deepEqual(view.freePose,held,'freeMove never drives a non-free camera');
 view.setFreeCam(true);for(let i=0;i<60;i++)view.freeMove({forward:1},1/60);
 view.setFreeCam(false);
 assert.deepEqual([view._freeVel.x,view._freeVel.y,view._freeVel.z],[0,0,0]);
 view.setFreeCam(true);view.freeMove({forward:1},1/60);
 view.setCinema(false);
 assert.deepEqual([view._freeVel.x,view._freeVel.y,view._freeVel.z],[0,0,0],'a mode change drops movement state');
 assert.equal(view.cameraOwner,'auto');
 view.setFreeCam(true);view.freeMove({forward:1},1/60);
 view.clearFreeMotion();
 assert.deepEqual([view._freeVel.x,view._freeVel.y,view._freeVel.z],[0,0,0]);
 // A render-mode change (Escape pauses, blur changes the screen) also drops it.
 view.setFreeCam(true);for(let i=0;i<30;i++)view.freeMove({forward:1},1/60);
 assert.ok(Math.abs(view._freeVel.z)>0);
 view.render('paused',match([actor()]),1/60,2);
 assert.deepEqual([view._freeVel.x,view._freeVel.y,view._freeVel.z],[0,0,0],'a mode change drops movement state');
 cleanup(view);
});

test('resetFreeCam reframes onto the nearest subject and falls back cleanly',()=>{
 const view=bareView();
 const local=new T.Group();local.position.set(6,1,-3);local.rotation.y=Math.PI/2;
 view.actorModels.set(0,local);
 view.camera.position.set(-20,6,0);
 view.setFreeCam(true);
 view.resetFreeCam();
 for(const key of ['x','y','z','yaw','pitch'])assert.ok(Number.isFinite(view.freePose[key]),`${key} stays finite`);
 assert.ok(view.freePose.y>1,'the reset lifts the camera above the subject');
 assert.ok(view.freePose.pitch<0,'the reset looks down at the subject');
 assert.ok(view.freePose.x>6,'the camera sits behind a subject facing +x');
 assert.ok(Math.hypot(view.freePose.x-6,view.freePose.z+3)<16,'the reset stays near the framed subject');
 // The local player is preferred over a geometrically nearer bystander.
 const bystander=new T.Group();bystander.position.set(-19,0,0);
 view.actorModels.set(4,bystander);
 view.resetFreeCam();
 assert.ok(view.freePose.x>0,'the preferred player beats the nearest bystander');
 // Without a preferred id, the nearest subject wins.
 view.playerId=-1;
 const far=new T.Group();far.position.set(40,0,40);view.actorModels.set(5,far);
 view.camera.position.set(30,6,30);
 view.resetFreeCam();
 assert.ok(view.freePose.x>30,'the nearest actor is the fallback focus');
 // No actor context: the historic origin seed keeps bare views predictable.
 const empty=bareView();empty.setFreeCam(true);empty.resetFreeCam();
 assert.deepEqual(empty.freePose,{x:0,y:6,z:0,yaw:0,pitch:0});
 // Arena bounds are the next fallback.
 const arena=bareView();arena.setShowcase({arena:{bounds:{minX:-10,maxX:10,minZ:-4,maxZ:8}}});
 arena.setFreeCam(true);arena.resetFreeCam();
 assert.ok(Math.abs(arena.freePose.x-0)<1e-9&&Math.abs(arena.freePose.z-10)<1e-9,'the arena centre frames when no actor exists');
 cleanup(view);cleanup(empty);cleanup(arena);
});

test('leaving free cam damps into the next director shot and reframes it once',()=>{
 const view=bareView();
 const calls=[];
 const director={aim:{x:0,y:1.35,z:0},update:directorPose,reframe(state){calls.push(state);return director;}};
 view.setDirector(director);view.setCinema(true);
 view.camera.position.set(30,20,30);
 view.setFreeCam(true);view.freePose={x:30,y:20,z:30,yaw:0,pitch:0};
 const state=match([actor()]);
 view.render('playing',state,.016,1);
 assert.deepEqual(view.camera.position.toArray(),[30,20,30],'free roam owns the frame');
 view.setFreeCam(false);
 assert.equal(view.freeCam,false);
 assert.equal(view.cameraOwner,'auto');
 assert.equal(calls.length,1,'the director is asked to reframe exactly once on hand-off');
 assert.equal(calls[0],undefined,'reframe is called without a stale match state');
 view.render('playing',state,.016,1.016);
 const afterOne=view.camera.position.clone();
 const target=new T.Vector3(0,5,10);
 assert.ok(afterOne.distanceTo(new T.Vector3(30,20,30))>.01,'the hand-off moves the camera');
 assert.ok(afterOne.distanceTo(target)>2,'the first hand-off frame damps instead of snapping');
 for(let i=0;i<240;i++)view.render('playing',state,.016,1.016+i*.016);
 assert.ok(view.camera.position.distanceTo(target)<.1,'the camera reacquires the director pose');
 for(const key of ['x','y','z'])assert.ok(Number.isFinite(view.camera.position[key]));
 assert.equal(view._freeExit,null,'the blend ends and releases its scratch pose');
 assert.equal(calls.length,1,'the reframe is never spammed per frame');
 // Without a director there is no hand-off to blend into: the next controller
 // takes over immediately.
 const plain=bareView();
 plain.camera.position.set(0,0,0);
 plain.setFreeCam(true);plain.freePose={x:11,y:9,z:-7,yaw:0,pitch:0};
 plain.render('playing',state,.016,1);
 plain.setFreeCam(false);
 plain.render('playing',state,.016,1.016);
 assert.deepEqual(plain.camera.position.toArray(),[0,1.45,0],'no director means no damping delay');
 cleanup(view);cleanup(plain);
});

test('reduced motion reframes more slowly and adds no bob or roll to free roam',()=>{
 const build=reduced=>{
  const view=bareView({reduced});
  view.setDirector({aim:{x:0,y:1.35,z:0},update:directorPose});
  view.setCinema(true);
  view.camera.position.set(30,20,30);
  view.setFreeCam(true);view.freePose={x:30,y:20,z:30,yaw:0,pitch:0};
  return view;
 };
 const standard=build(false),reduced=build(true),state=match([actor()]);
 for(const view of [standard,reduced])view.render('playing',state,.016,1);
 for(const view of [standard,reduced])view.setFreeCam(false);
 for(const view of [standard,reduced])view.render('playing',state,.016,1.016);
 const start=new T.Vector3(30,20,30);
 assert.ok(standard.camera.position.distanceTo(start)>reduced.camera.position.distanceTo(start),'reduced motion leaves free roam more gently');
 // Reduced-motion free roam: vertical input is exactly vertical, and the
 // camera never rolls or bobs.
 const view=bareView({reduced:true});
 view.setFreeCam(true);view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};view.clearFreeMotion();
 view.freeMove({forward:1},1/60);
 assert.equal(view.freePose.y,6,'horizontal flight at pitch 0 adds no bob');
 for(let i=0;i<120;i++){view.freeMove({forward:1,right:1,up:1},1/60);view.render('playing',state,1/60,i/60);}
 assert.equal(view.camera.rotation.z,0,'free roam never rolls');
 assert.ok(view.camera.position.y>6,'vertical input still flies');
 for(let i=0;i<120;i++){view.freeMove({forward:1},1/60);view.render('playing',state,1/60,(120+i)/60);}
 assert.equal(view.camera.rotation.z,0);
 cleanup(standard);cleanup(reduced);cleanup(view);
});

test('manual follow beats race poses and uses the spectator and director targets',()=>{
 const view=bareView();
 const targets=[];
 const director={setTarget(id){targets.push(id);return true;},update:directorPose};
 view.setDirector(director);
 const state=raceMatch();
 view.setShowcase(state);
 assert.equal(view.setManualFollow(9),9);
 assert.deepEqual(targets,[9],'the director target helper is reused');
 assert.equal(view.cameraOwner,'manual');
 assert.equal(view.manualFollow,9);
 assert.equal(view.spectatorTarget,9,'the spectator target helper is reused');
 state.actors.push(actor({id:9,x:12,z:4}));
 view.render('selection',null,.05,.05);
 assert.ok(Math.abs(view.camera.position.x-12)<1e-9&&Math.abs(view.camera.position.z-4)<1e-9,'manual follow frames the subject, not the race rig');
 assert.equal(view._raceCam,undefined,'race smoothing state is cleared when manual takes over');
 // A cinematic director frames the pinned subject through its own target.
 view.setCinema(true);
 view.render('selection',null,.05,.075);
 assert.deepEqual(view.camera.position.toArray(),[0,5,10],'the cinematic director keeps the manual frame and race stays suppressed');
 assert.equal(view._raceCam,undefined);
 // Free roam temporarily wins, then damps back into the pinned director frame.
 view.setFreeCam(true);view.freePose={x:100,y:40,z:100,yaw:0,pitch:0};
 view.render('selection',null,.05,.1);
 assert.deepEqual(view.camera.position.toArray(),[100,40,100]);
 view.setFreeCam(false);
 assert.equal(view.cameraOwner,'manual','exiting free roam restores the follow');
 view.render('selection',null,.05,.15);
 assert.ok(view.camera.position.distanceTo(new T.Vector3(0,5,10))<Math.hypot(100,35,90),'the hand-off moves back toward the pinned target');
 for(let i=0;i<120;i++)view.render('selection',null,.05,.15+i*.05);
 assert.ok(view.camera.position.distanceTo(new T.Vector3(0,5,10))<.1,'the pinned director target resumes');
 view.setCinema(false);
 assert.equal(view.clearManualFollow(),null);
 assert.deepEqual(targets,[9,null]);
 assert.equal(view.manualFollow,null);
 assert.equal(view.cameraOwner,'auto','clearing the follow releases manual ownership');
 view.render('selection',null,.05,.3);
 assert.ok(view.camera.position.distanceTo(new T.Vector3(12,1.45,4))>1,'auto releases the subject follow');
 assert.equal(view.setManualFollow('9'),null,'non-integer ids are ignored');
 assert.equal(view.cameraOwner,'auto');
 cleanup(view);
});

test('auto keeps the race demo cycling while manual, free and directorLock suppress it',()=>{
 const view=bareView();
 const state=raceMatch();
 view.setShowcase(state);
 view.setDirector({update:()=>({x:0,y:50,z:0,pitch:0,yaw:0,roll:0,fov:70,cut:false})});
 view.setCinema(true);
 view.render('selection',null,.05,0);
 assert.ok(view._raceCam,'auto lets the race demo own the camera');
 assert.ok(view.camera.position.distanceTo(new T.Vector3(0,50,0))>1,'the race demo overwrites the director pose');
 const firstMode=view._raceCam.mode;
 state.time=RACE_DEMO_MODE_SECONDS;
 view.render('selection',null,.05,RACE_DEMO_MODE_SECONDS);
 assert.notEqual(view._raceCam.mode,firstMode,'the race demo keeps cycling rigs under auto');
 // Explicit race ownership keeps the demo running too.
 view.setCameraOwner('race');
 state.time=RACE_DEMO_MODE_SECONDS*2;
 view.render('selection',null,.05,RACE_DEMO_MODE_SECONDS*2);
 assert.ok(view._raceCam,'an explicit race owner runs the demo');
 // Manual framing suppresses the demo immediately.
 view.setCameraOwner('manual');
 view.render('selection',null,.05,RACE_DEMO_MODE_SECONDS*2+.05);
 assert.equal(view._raceCam,undefined);
 assert.deepEqual(view.camera.position.toArray(),[0,50,0],'manual returns to the director frame');
 cleanup(view);
});

test('directorLock keeps suppressing race poses for existing callers',()=>{
 const view=bareView();
 const state=raceMatch();
 const director={update:()=>({x:0,y:50,z:0,pitch:0,yaw:0,roll:0,fov:70,cut:false})};
 view.setShowcase(state);view.setCinema(true);view.setDirector(director);
 view.setDirectorLock(true);
 view.render('selection',null,.05,0);
 assert.deepEqual(view.camera.position.toArray(),[0,50,0],'the director keeps the frame while locked');
 assert.equal(view._raceCam,undefined);
 view.setDirectorLock(false);
 view.render('selection',null,.05,.05);
 assert.ok(view._raceCam,'unlocking hands the frame back to the race demo');
 cleanup(view);
});

test('planned director shots run the collision pass and hold a stable stand-off',()=>{
 const view=bareView();
 // `tour:true` must no longer disable the safety net.
 const director={tour:true,aim:{x:0,y:1.35,z:0},update:()=>({x:0,y:5,z:12,pitch:-.3,yaw:0,roll:0,fov:70,cut:false})};
 view.setDirector(director);view.setCinema(true);
 const wall=new T.Mesh(new T.BoxGeometry(6,6,2),new T.MeshBasicMaterial());
 wall.position.set(0,2,6);view.worldGroup.add(wall);view.worldGroup.updateMatrixWorld(true);
 const state=match([actor()]);
 view.render('playing',state,.016,1);
 const head=view._camHead,out=view._camOut;
 assert.ok(view.camera.position.z<12,`the blocked shot pulls in front of the wall (z ${view.camera.position.z})`);
 assert.ok(view.camera.position.z>2,'the camera never collapses into the subject');
 assert.ok(Number.isFinite(view._camWant),'the smoothed stand-off is finite');
 const settled=view.camera.position.z;
 for(let i=0;i<40;i++)view.render('playing',state,.016,1.016+i*.016);
 assert.ok(Math.abs(view.camera.position.z-settled)<.5,'hysteresis holds a stable pose instead of oscillating');
 assert.equal(view._camHead,head,'the collision scratch head is reused');
 assert.equal(view._camOut,out,'the collision scratch direction is reused');
 // Explicit per-director opt-out.
 director.cameraCollision=false;
 view.render('playing',state,.016,2);
 assert.equal(view.camera.position.z,12,'a director that opts out keeps its planned pose');
 cleanup(view);
});

test('free roam and focus resolution stay finite under malformed input',()=>{
 const view=bareView();
 view.setFreeCam(true);view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};
 for(const input of [undefined,null,{forward:NaN,right:Infinity,up:'x',boost:'yes'},{forward:{},right:[],up:{}},{forward:-Infinity,up:NaN}]){
  view.freeMove(input,.016);
  for(const key of ['x','y','z','yaw','pitch'])assert.ok(Number.isFinite(view.freePose[key]),`${key} finite for ${JSON.stringify(input)}`);
 }
 view.freeLook(NaN,undefined);view.freeLook(Infinity,-Infinity);
 for(const key of ['yaw','pitch'])assert.ok(Number.isFinite(view.freePose[key]));
 view.freePose={x:NaN,y:NaN,z:NaN,yaw:NaN,pitch:NaN};
 view.freeMove({forward:1},.016);
 for(const key of ['x','y','z','yaw','pitch'])assert.ok(Number.isFinite(view.freePose[key]),`${key} recovered from a poisoned pose`);
 assert.equal(view.setFreeCamSpeed(NaN),FREE_CAM_DEFAULT_SPEED);
 assert.equal(view.setFreeCamBoost(Infinity),FREE_CAM_BOOST);
 const broken=new T.Group();broken.position.set(NaN,NaN,NaN);view.actorModels.set(0,broken);
 view.resetFreeCam();
 for(const key of ['x','y','z'])assert.ok(Number.isFinite(view.freePose[key]),'a malformed subject cannot poison the reset');
 const velocity=view._freeVel;
 for(let i=0;i<30;i++)view.freeMove({forward:1,up:-1},1/60);
 assert.ok(view.freePose.y>=.4,'free roam never dips below the floor');
 assert.equal(view._freeVel,velocity);
 cleanup(view);
});

test('integrateFreeMove is pure scratch math and never mutates its input',()=>{
 const pose={x:0,y:6,z:0,yaw:0,pitch:0},velocity={x:0,y:0,z:0},input={forward:1,right:0,up:0,boost:false};
 const snapshot=JSON.stringify(input);
 const result=integrateFreeMove(pose,velocity,input,1/60,FREE_CAM_DEFAULT_SPEED,FREE_CAM_BOOST);
 assert.equal(result,pose);
 assert.notEqual(velocity.z,0,'the scratch velocity advances');
 assert.equal(JSON.stringify(input),snapshot,'the input object is never mutated');
 const bad=integrateFreeMove({x:NaN,y:NaN,z:NaN,yaw:NaN,pitch:NaN},{x:NaN,y:NaN,z:NaN},null,NaN,NaN,NaN);
 for(const key of ['x','y','z'])assert.ok(Number.isFinite(bad[key]));
});
