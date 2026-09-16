import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaView,raceTrackModel,vehicleModel,weaponModel,robotModel,shadowTick} from './view.mjs';
import {RACE_DEMO_MODE_SECONDS} from './race-camera.mjs';
import {SoftwareRenderer} from './software.mjs';
import {ModelAssets,CameraShake,MuzzleLightPool,LowHealthOverlay,DeathPool,DecalPool,killcamPose,KILLCAM_DURATION} from './effects-fx.mjs';
import {ambientProfile} from './environment.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';
import * as T from 'three';
import BLOOD_GULCH from './blood-gulch.mjs';
import {MAPS} from './maps.mjs';
import {terrainTriangles,terrainWallTriangles} from './terrain.mjs';
import {resolveAttachments} from './attachments.mjs';
import {surfaceTextures,clearSurfaceTextures} from './textures.mjs';

function fixture(t,{dpr=1,software=false,width=800,height=450}={}){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{devicePixelRatio:dpr}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
 const camera=()=>({fov:82,aspect:1,updates:0,updateProjectionMatrix(){this.updates++;}});
 const renderer={isSoftware:software,domElement:{clientWidth:width,clientHeight:height,style:{}},ratios:[],sizes:[],
  setPixelRatio(ratio){this.ratio=ratio;this.ratios.push(ratio);},
  setSize(w,h,style){this.sizes.push([w,h,style]);this.domElement.width=Math.floor(w*this.ratio);this.domElement.height=Math.floor(h*this.ratio);}};
 const view=Object.assign(Object.create(ArenaView.prototype),{renderer,camera:camera(),menu:{camera:camera()},display:{...DEFAULT_DISPLAY}});
 return {view,renderer};
}

test('WebGL scales the capped DPR baseline and keeps both camera aspects in CSS pixels',t=>{
 const {view,renderer}=fixture(t,{dpr:3,width:801,height:451});
 for(const scale of [1,.5,1.5]){
  view.setDisplay({...DEFAULT_DISPLAY,resolutionScale:scale});view.resize();
  assert.equal(renderer.ratio,1.5*scale);
  assert.equal(renderer.domElement.width,Math.floor(801*1.5*scale));
  assert.equal(renderer.domElement.height,Math.floor(451*1.5*scale));
  assert.equal(view.camera.aspect,801/451);assert.equal(view.menu.camera.aspect,801/451);
  assert.deepEqual(renderer.sizes.at(-1),[801,451,false]);assert.deepEqual(renderer.domElement.style,{});
 }
});

test('CPU scale uses a fixed 0.85 baseline regardless of DPR',t=>{
 const {view,renderer}=fixture(t,{dpr:3,software:true});
 for(const scale of [1,.5,1.5]){view.setDisplay({resolutionScale:scale});view.resize();assert.equal(renderer.ratio,.85*scale);}
 window.devicePixelRatio=1;view.resize();assert.equal(renderer.sizes.length,3);
});

test('live scale, size and DPR changes resize, but unrelated display changes do not',t=>{
 const {view,renderer}=fixture(t);
 view.resize();view.setDisplay({resolutionScale:.7,fov:100,showWeapon:false});
 assert.equal(renderer.ratio,.7);assert.equal(view.camera.fov,100);assert.equal(view.showWeapon,false);
 const calls=renderer.sizes.length;
 view.setDisplay({...view.display,crosshair:'dot',color:'#abcdef',size:1.5,showFps:true});view.resize();
 assert.equal(renderer.sizes.length,calls);
 renderer.domElement.clientWidth=900;view.resize();assert.equal(view.camera.aspect,2);assert.equal(view.menu.camera.aspect,2);
 window.devicePixelRatio=2;
 view.render('playing',null,0,0);
 assert.equal(renderer.ratio,1.5*.7);assert.equal(renderer.sizes.length,calls+2);
 view.render('playing',null,0,0);assert.equal(renderer.sizes.length,calls+2);
 view.setDisplay(null);assert.deepEqual(view.display,DEFAULT_DISPLAY);assert.equal(view.camera.fov,82);assert.equal(view.showWeapon,true);assert.equal(renderer.ratio,1.5*DEFAULT_DISPLAY.resolutionScale);
 view.setDisplay({resolutionScale:Infinity,fov:NaN});assert.deepEqual(view.display,DEFAULT_DISPLAY);
});

test('tiny and hidden canvases retain positive backing dimensions and finite aspects',t=>{
 const {view,renderer}=fixture(t,{width:0,height:0});
 view.resize();
 assert.equal(renderer.domElement.width,1);assert.equal(renderer.domElement.height,1);
 assert.equal(view.camera.aspect,1);assert.equal(view.menu.camera.aspect,1);
 for(const dpr of [undefined,NaN,Infinity,0,-1]){window.devicePixelRatio=dpr;view.resize();assert.equal(renderer.ratio,.5);}
 renderer.domElement.clientWidth=1;renderer.domElement.clientHeight=2;view.resize();
 assert.equal(view.camera.aspect,.5);assert.ok(renderer.domElement.width>=1);assert.ok(renderer.domElement.height>=1);
});

test('software canvas honors pixel ratio arguments and guards minimum dimensions without CSS writes',()=>{
 const canvas={style:{width:'100%',height:'100%'},getContext:()=>({})},renderer=new SoftwareRenderer(canvas);
 assert.equal(renderer.ratio,.85);
 for(const ratio of [.425,.85,1,1.275,2]){renderer.setPixelRatio(ratio);renderer.setSize(800,450,false);assert.equal(canvas.width,Math.round(800*ratio));assert.equal(canvas.height,Math.round(450*ratio));}
 renderer.setPixelRatio(.425);renderer.setSize(0,1,false);assert.equal(canvas.width,1);assert.equal(canvas.height,1);
 assert.deepEqual(canvas.style,{width:'100%',height:'100%'});
});

test('view keeps camera aim authoritative while weapon feedback respects visibility and reduced motion',t=>{
 const {view,renderer}=fixture(t);view.camera=new T.PerspectiveCamera();view.scene=new T.Scene();view.hands=new T.Group();view.camera.add(view.hands);view.scene.add(view.camera);view.actorModels=new Map();view.pickupModels=[];view.playerId=7;view.currentWeapon=-1;view.lastEvent=0;view.motionQuery={matches:false};renderer.render=()=>{};
 const player={id:7,weapon:3,health:100,x:1,y:2,z:3,yaw:.7,pitch:.2,vx:5,vz:0,vy:0,grounded:true};
 const match={actors:[player],pickups:[],rockets:[],time:1,events:[{id:1,type:'shot',actor:7,weapon:3,time:1,from:{x:1,y:3,z:3},to:{x:2,y:3,z:2},hit:{id:2}}]};
   view.render('playing',match,.016,1);assert.deepEqual(view.camera.position.toArray(),[1,3.45,3]);assert.equal(view.camera.rotation.x,.2);assert.equal(view.camera.rotation.y,.7);assert.equal(view.camera.rotation.z,0);assert.ok(view.hands.position.z>-.58);assert.ok(view.effectPool.slots.some(s=>!s.line&&s.obj.scale.x>.1));
  const kick=view.feedback.kick;
  view.render('playing',{...match,actors:[{...player}],events:[]},.016,1.016);
  assert.ok(view.feedback.kick>0&&view.feedback.kick<kick,'fresh network snapshots preserve recoil recovery');
  assert.ok(view.effectPool.slots.some(s=>s.active),'fresh snapshots preserve live effects');
 view.showWeapon=false;view.render('playing',match,.016,1);assert.equal(view.hands.visible,false);assert.equal(view.hands.position.z,-.58);
  view.showWeapon=true;view.motionQuery.matches=true;view.render('playing',match,.016,1);assert.deepEqual(view.hands.position.toArray(),[.37,-.36,-.58]);assert.equal(view.firstPerson.userData.flash.visible,false);assert.equal(view.hands.rotation.x,0);
  view.mapId='crosswire';view.setMatch({arena:{id:'crosswire'},actors:[],pickups:[],serial:0});
  assert.equal(view.feedback.kick,0);assert.ok(view.effectPool.slots.every(s=>!s.active),'new rounds clear effects');
 view.effectPool.dispose();view.projectilePool.dispose();view.disposeObject(view.scene);
});

test('ADS transitions viewmodel smoothly toward iron-sights center line and returns on hipfire',t=>{
 const {view,renderer}=fixture(t);view.camera=new T.PerspectiveCamera();view.scene=new T.Scene();view.hands=new T.Group();view.camera.add(view.hands);view.scene.add(view.camera);view.actorModels=new Map();view.pickupModels=[];view.playerId=7;view.currentWeapon=-1;view.lastEvent=0;view.motionQuery={matches:false};renderer.render=()=>{};
 const player={id:7,weapon:0,health:100,x:1,y:2,z:3,yaw:0,pitch:0,vx:0,vz:0,vy:0,grounded:true,ads:false};
 const match={actors:[player],pickups:[],rockets:[],time:1,events:[]};
 view.render('playing',match,.016,1);
 const hipX=view.hands.position.x;
 assert.ok(hipX>.35,'hipfire viewmodel sits off-center to the right');
 player.ads=true;
 for(let i=0;i<20;i++)view.render('playing',match,.016,1+(i+1)*.016);
 assert.ok(view.hands.position.x<hipX*.4,'ADS smoothly centers viewmodel towards iron-sight line');
 assert.ok(view.hands.position.y>-0.34,'ADS elevates viewmodel towards sightline');
  view.motionQuery.matches=true;
  view.render('playing',match,.016,2);
  // Reduced motion must snap to the solved ADS pose (not fall back to hip): the
  // sight line has to be usable, just without the animated transition.
  assert.ok(Math.abs(view.hands.position.x)<.05,'reduced motion snaps to the centered ADS pose');
  view.effectPool?.dispose();view.disposeObject(view.scene);
});

test('vehicle nitro exhaust emits particles behind boosting and turbo vehicles under standard motion',t=>{
 const {view}=fixture(t);view.scene=new T.Scene();view.motionQuery={matches:false};view.vehicleModels=new Map();
 const model=new T.Group();model.userData={wheels:[],guns:[]};view.vehicleModels.set('veh-1',model);view.scene.add(model);
 const matchBoosting={vehicles:[{id:'veh-1',position:{x:5,y:1,z:5},yaw:0,health:100,boosting:true,vx:12,vz:0}],time:1};
 view.updateVehicleModels(matchBoosting);
 assert.ok(view.effectPool,'effectPool initialized for exhaust particles');
 const activeSlot=view.effectPool.slots.find(s=>s.active);
 assert.ok(activeSlot,'nitro exhaust particles emitted during boost');
 assert.ok(activeSlot.obj.position.z>5.5,'exhaust particle spawns behind vehicle along z axis');
 assert.ok(activeSlot.velocity.z>1,'exhaust particle shoots backwards trailing behind car');
 view.motionQuery.matches=true;view.effectPool.clear();matchBoosting.time=1.1;
 view.updateVehicleModels(matchBoosting);
 assert.ok(view.effectPool.slots.every(s=>!s.active),'reduced motion suppresses vehicle exhaust particles');
 view.effectPool?.dispose();view.disposeObject(view.scene);
});

test('energy shields render visible 3D mesh for overshield and Juggernaut, and shieldBreak emits shatter VFX',t=>{
 const {view,renderer}=fixture(t);view.scene=new T.Scene();view.camera=new T.PerspectiveCamera();view.hands=new T.Group();view.camera.add(view.hands);view.scene.add(view.camera);view.actorModels=new Map();view.pickupModels=[];view.playerId=7;view.currentWeapon=-1;view.lastEvent=0;view.motionQuery={matches:false};renderer.render=()=>{};
 const juggernaut={id:2,character:'claude',weapon:0,health:100,x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vz:0,vy:0,grounded:true,juggernautShield:120};
 const overshieldActor={id:3,character:'gemini',weapon:0,health:100,x:5,y:0,z:5,yaw:0,pitch:0,vx:0,vz:0,vy:0,grounded:true,temporaryShield:75};
 const match={actors:[{id:7,character:'chatgpt',weapon:0,health:100,x:0,y:0,z:-10,yaw:0,pitch:0,vx:0,vz:0,vy:0,grounded:true},juggernaut,overshieldActor],pickups:[],rockets:[],time:1,events:[]};
 view.syncActors(match);
 view.render('playing',match,.016,1);
 const jugModel=view.actorModels.get(2);
 assert.ok(jugModel?.userData?.shield?.visible,'juggernaut 3D shield mesh visible');
 assert.equal(jugModel.userData.shield.material.color.getHexString(),'ffd166','juggernaut shield is golden amber');
 const overModel=view.actorModels.get(3);
 assert.ok(overModel?.userData?.shield?.visible,'temporaryShield 3D shield mesh visible');
 assert.equal(overModel.userData.shield.material.color.getHexString(),'70ffe6','overshield is glowing cyan');

 view.effectPool?.clear();
 view.effect({type:'damage',actor:3,shieldBreak:true,amount:75,pos:{x:5,y:0,z:5}});
 assert.ok(view.effectPool.slots.some(s=>s.active&&s.obj.material.wireframe),'shieldBreak emits wireframe shatter particles');
 view.effectPool?.dispose();view.disposeObject(view.scene);
});

test('object disposal deduplicates shared geometry, material and texture',()=>{
  const view=Object.create(ArenaView.prototype),group=new T.Group(),geometry=new T.BoxGeometry(),texture=new T.Texture(),material=new T.MeshBasicMaterial({map:texture}),counts=[0,0,0];
  [geometry,material,texture].forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));group.add(new T.Mesh(geometry,material),new T.Mesh(geometry,material));view.disposeObject(group);assert.deepEqual(counts,[1,1,1]);
 });

test('traversal and flags tolerate metadata variants and clean shared resources',()=>{
 const view=Object.create(ArenaView.prototype);view.renderResources=new Set();view.flagModels=new Map();view.motionQuery={matches:false};const scene=new T.Scene();view.scene=scene;const arena={id:'new-map',color:'#55ddcc',bounds:{minX:-20,maxX:20,minZ:-10,maxZ:14},traversal:{pads:[{x:-3,y:0,z:2}],launchers:[{x:4,y:0,z:-2,yaw:Math.PI/2}]}};
 view.addTraversal(scene,arena,new T.MeshBasicMaterial({color:arena.color}));assert.equal(scene.children.filter(x=>x.userData.traversal).length,2);
 view.updateFlags({time:1,flags:[{team:'alpha',x:1,y:0,z:2,state:'dropped'},{team:'beta',x:-1,y:0,z:2,carrierId:9}]},arena);assert.equal(view.flagModels.size,2);assert.equal(view.flagModels.get('alpha').visible,true);assert.equal(view.flagModels.get('beta').visible,false);
 view.updateFlags({flags:undefined},arena);assert.ok([...view.flagModels.values()].every(flag=>!flag.visible));view.disposeObject(scene);for(const resource of view.renderResources)resource.dispose();
   });

test('targeted launchers face their landing route and carry decorative stripes',()=>{
  const view=Object.create(ArenaView.prototype);view.renderResources=new Set();const scene=new T.Scene();const glow=new T.MeshBasicMaterial({color:'#55ddcc'});
  const arena={id:'targeted',color:'#55ddcc',traversal:{boostLaunchers:[{id:'route',x:4,y:2,z:-2,dir:[-1,0]}]},jumpLinks:[{traversal:'route',source:{x:4,y:2,z:-2},target:{x:9,y:2,z:-2}}]};
  view.addTraversal(scene,arena,glow);const launcher=scene.children.find(child=>child.userData.traversal==='boost-launcher');
  assert.equal(launcher.rotation.y,Math.PI/2);assert.equal(launcher.userData.stripes.length,2);assert.ok(launcher.userData.stripes.every(stripe=>stripe.parent===launcher));
  assert.deepEqual(launcher.userData.stripes.map(stripe=>stripe.position.toArray()),[[-.25,.08,0],[.25,.08,0]]);
  launcher.updateMatrixWorld(true);const stripeWorld=launcher.userData.stripes[0].getWorldPosition(new T.Vector3());assert.ok(Math.abs(stripeWorld.x-4)<1e-9&&Math.abs(stripeWorld.z+1.75)<1e-9);
  view.disposeObject(scene);glow.dispose();
 });

test('KOTH and Domination objective areas show state and clean stale zones',()=>{
  const view=Object.create(ArenaView.prototype),scene=new T.Scene(),world=new T.Group();scene.add(world);
  view.scene=scene;view.worldGroup=world;view.objectiveModels=new Map();view.motionQuery={matches:true};
  const arena={id:'crosswire',color:'#55ddcc'};
  view.updateObjectives({time:2,objectives:{kind:'koth',zones:[{id:'hill',x:2,y:1,z:-3,radius:4,owner:0,captureTeam:0,progress:40}]}},arena);
  const hill=view.objectiveModels.get('hill');
     assert.ok(hill&&hill.userData.objective);assert.equal(hill.position.y,1);assert.equal(hill.scale.y,1);assert.equal(hill.userData.radius,4);assert.equal(hill.userData.area.geometry.parameters.radiusTop,4);assert.equal(hill.userData.base.geometry.parameters.radius,4);assert.equal(hill.userData.identifier,'hill');assert.ok(hill.userData.emblem.visible);
     hill.traverse(n=>assert.equal(n.userData.noCameraOcclusion,true,'objective zone children never block the camera ray'));
    assert.ok(hill.userData.area.material.opacity>0,'neutral and owned areas have a filled footprint');
    assert.equal(hill.userData.progress.visible,true);assert.equal(hill.userData.baseMat.color.getHexString(),'ed514b');
   const progressGeometry=hill.userData.progress.geometry;
   assert.equal(progressGeometry.drawRange.count,78);
   view.updateObjectives({time:2,objectives:{kind:'koth',zones:[{id:'hill',x:2,y:1,z:-3,radius:4,owner:0,captureTeam:0,progress:41}]}},arena);
   assert.equal(hill.userData.progress.geometry,progressGeometry);
   assert.equal(progressGeometry.drawRange.count,84);
   view.updateObjectives({time:2,objectives:{kind:'domination',zones:[{id:'alpha',x:0,z:0,owner:null,progress:0,contested:true},{id:'bravo',x:5,z:0,owner:1,progress:75}]}},arena);
  assert.equal(view.objectiveModels.size,2);assert.equal(view.objectiveModels.get('alpha').userData.baseMat.color.getHexString(),'ffd166');
    assert.equal(view.objectiveModels.get('bravo').userData.baseMat.color.getHexString(),'438eff');assert.equal(view.objectiveModels.get('bravo').userData.areaMat.color.getHexString(),'438eff');assert.equal(view.objectiveModels.get('bravo').userData.progressMat.color.getHexString(),'438eff');assert.equal(view.objectiveModels.get('alpha').userData.progress.visible,false);
    view.updateObjectives({objectives:{kind:'domination',zones:[{id:'alpha',x:0,z:0,owner:0,captureTeam:1,progress:25}]}},arena);const alpha=view.objectiveModels.get('alpha');assert.equal(alpha.userData.areaMat.color.getHexString(),'ed514b');assert.equal(alpha.userData.progressMat.color.getHexString(),'438eff');assert.equal(alpha.userData.progress.visible,true);
   const stale=view.objectiveModels.get('alpha'),disposed=[0,0];stale.userData.area.geometry.addEventListener('dispose',()=>disposed[0]++);stale.userData.areaMat.addEventListener('dispose',()=>disposed[1]++);
   view.updateObjectives({objectives:{kind:'ctf',zones:[]}},arena);assert.equal(view.objectiveModels.size,0);assert.equal(world.children.length,0);assert.deepEqual(disposed,[1,1]);
});

test('unknown weapons produce typed models and effects do not index past weapon data',t=>{
 const model=weaponModel(7);assert.equal(model.userData.type,7);assert.ok(model.userData.flash);
 const {view,renderer}=fixture(t);view.scene=new T.Scene();view.hands=new T.Group();view.camera=new T.PerspectiveCamera();view.actorModels=new Map();view.pickupModels=[];view.flagModels=new Map();view.playerId=1;view.currentWeapon=-1;view.lastEvent=0;view.motionQuery={matches:true};renderer.render=()=>{};
 const actor={id:1,weapon:7,health:100,x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true};view.render('playing',{actors:[actor],pickups:[],rockets:[{weapon:7,pos:{x:0,y:1,z:0}}],events:[{id:1,type:'shot',weapon:7,actor:1,pos:{x:0,y:1,z:0}}]},.016,1);assert.ok(view.firstPerson.userData.flash);view.effectPool?.dispose();view.projectilePool?.dispose();
  });

test('weapon finishes resolve to palette colors instead of parsing the finish id',()=>{
 const warnings=[],original=console.warn;
 console.warn=(...args)=>warnings.push(args.join(' '));
 try{
  const model=weaponModel(0,undefined,null,'finish-ion');
  const colors=new Set();
  model.traverse(node=>{if(!node.material)return;for(const mat of Array.isArray(node.material)?node.material:[node.material])if(mat.color)colors.add(mat.color.getHexString());});
  assert.ok(colors.has('22d3ee'),'the ion primary colors the glow');
  assert.ok(colors.has('0e7490'),'the ion secondary colors the dark accents');
  assert.ok(colors.has('a5f3fc'),'the ion accent colors the light accents');
  assert.ok(!warnings.some(line=>/Unknown color/.test(line)),'a finish id never reaches the color parser');
  const fallback=weaponModel(0,undefined,null,null),fallbackColors=new Set();
  fallback.traverse(node=>{if(node.material?.color)fallbackColors.add(node.material.color.getHexString());});
  assert.ok(fallbackColors.has('70ffe6'),'an absent finish keeps the weapon fallback color');
  weaponModel(0,undefined,null,'finish-missing');
  assert.ok(!warnings.some(line=>/Unknown color/.test(line)),'an unknown finish keeps the weapon fallback color without warnings');
 }finally{console.warn=original;}
});

test('local Puma coins hide until their wait elapses while snapshots use ready',()=>{
 const local=Object.assign(Object.create(ArenaView.prototype),{worldGroup:new T.Group(),reduced:()=>false});
 local.updateRace({race:{boxes:[],hazards:[],coins:[{id:'l1',x:0,z:0,wait:5},{id:'l2',x:1,z:1,wait:0}]}},0);
 assert.equal(local.raceModels.get('coin:l1').visible,false,'a local coin still waiting stays hidden');
 assert.equal(local.raceModels.get('coin:l2').visible,true,'a local coin with no wait shows immediately');
 const snapshot=Object.assign(Object.create(ArenaView.prototype),{worldGroup:new T.Group(),reduced:()=>false});
 snapshot.updateRace({race:{boxes:[],hazards:[],coins:[{id:'s1',x:0,z:0,ready:true},{id:'s2',x:1,z:1,ready:false}]}},0);
 assert.equal(snapshot.raceModels.get('coin:s1').visible,true,'ready snapshots stay visible');
 assert.equal(snapshot.raceModels.get('coin:s2').visible,false,'unready snapshots stay hidden');
 local.updateRace({},1);snapshot.updateRace({},1);
});

test('Puma model exposes two readable side chainguns',()=>{
  const model=vehicleModel('puma');
  assert.equal(model.userData.vehicle,true);
  assert.equal(model.userData.guns.length,2);
  assert.notEqual(model.userData.guns[0].mount.position.x,model.userData.guns[1].mount.position.x);
  model.traverse(child=>{if(child.geometry)child.geometry.dispose();if(child.material){for(const m of Array.isArray(child.material)?child.material:[child.material])m.dispose();}});
 });

test('Blood Gulch builds polygon terrain and cliff geometry without platform assumptions',()=>{
  const view=Object.create(ArenaView.prototype);view.scene=new T.Scene();view.renderResources=new Set();view.mapId='exchange';
  view.buildArena(BLOOD_GULCH);
  const meshes=view.worldGroup.children.filter(child=>child.userData.terrain);
   assert.ok(meshes.length>0);
   assert.equal(meshes.reduce((count,mesh)=>count+mesh.geometry.attributes.position.count/3,0),terrainTriangles(BLOOD_GULCH.terrain).length+terrainWallTriangles(BLOOD_GULCH.terrain).length);
  assert.ok(meshes.some(mesh=>mesh.material.side===T.DoubleSide));
 view.disposeObject(view.worldGroup);for(const resource of view.renderResources)resource.dispose();
 });

test('rebuilding a terrain arena releases traversal resources instead of accumulating them',()=>{
  const view=Object.create(ArenaView.prototype);view.scene=new T.Scene();view.renderResources=new Set();view.mapId='exchange';
  view.buildArena(BLOOD_GULCH);const initial=view.renderResources.size;assert.ok(initial>0);
  for(let i=0;i<20;i++)view.buildArena(BLOOD_GULCH);
  assert.equal(view.renderResources.size,initial);
  view.disposeObject(view.worldGroup);for(const resource of view.renderResources)resource.dispose();
  });

test('every canonical arena has batched polish, faithful collision boxes and software-readable materials',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(x,y){assert.ok(Number.isFinite(x)&&Number.isFinite(y));},lineTo(x,y){assert.ok(Number.isFinite(x)&&Number.isFinite(y));},closePath(){},stroke(){},fill(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>ctx})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx}),view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),renderResources:new Set(),renderer});
 view.scene.add(new T.HemisphereLight(),new T.DirectionalLight());
 const signatures=new Set();
 for(const arena of MAPS){
  const before=JSON.stringify(arena);view.buildArena(arena);
  const children=view.worldGroup.children,details=children.filter(n=>n.userData.arenaDetail),blocks=children.filter(n=>Number.isInteger(n.userData.block));
  assert.ok(details.length>0&&details.length<=8,`${arena.id}: bounded detail batches`);
  assert.equal(blocks.length,arena.blocks.length);
  for(const mesh of blocks){const b=arena.blocks[mesh.userData.block];assert.deepEqual(mesh.position.toArray(),[b.x,b.h/2,b.z]);assert.deepEqual([mesh.geometry.parameters.width,mesh.geometry.parameters.height,mesh.geometry.parameters.depth],[b.w,b.h,b.d]);}
  signatures.add(`${blocks[0].material.color.getHexString()}/${view.scene.fog.density}`);
  for(const mesh of details){assert.equal(mesh.material.isMeshStandardMaterial,true);assert.ok(mesh.material.roughness>=.3);assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));}
  if(arena.platforms){const platforms=children.filter(n=>n.userData.platform);assert.equal(platforms.length,arena.platforms.length);assert.ok(platforms.every(n=>n.material.emissive.getHex()===0),'landing surfaces are not washed out by full-deck emission');}
   if(arena.terrain){const cliffs=[...terrainWallTriangles(arena.terrain),...terrainTriangles(arena.terrain).filter(tri=>tri.walkable===false)];if(cliffs.length)assert.ok(children.some(n=>n.userData.strata),`${arena.id}: cliff terrain draws strata`);const actual=children.filter(n=>n.userData.terrain).flatMap(n=>Array.from(n.geometry.attributes.position.array));const expected=[...terrainTriangles(arena.terrain),...terrainWallTriangles(arena.terrain)].flatMap(t=>t.vertices.flat());assert.equal(actual.length,expected.length);assert.deepEqual(actual.sort((a,b)=>a-b),Array.from(new Float32Array(expected)).sort((a,b)=>a-b));}
  const camera=new T.PerspectiveCamera(82,320/180,.08,220);camera.position.set(0,12,24);camera.lookAt(0,0,0);renderer.render(view.scene,camera);assert.ok(renderer.info.render.triangles>0,`${arena.id}: CPU scene renders`);
  assert.equal(JSON.stringify(arena),before,'rendering never mutates canonical maps');
  // Every attached resource must be disposed exactly once when the arena is replaced.
  const resources=new Set();view.worldGroup.traverse(n=>{if(n.geometry)resources.add(n.geometry);if(n.material){resources.add(n.material);if(n.material.map)resources.add(n.material.map);}});
  for(const resource of view.renderResources)resources.add(resource);
  const counts=new Map();for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
  view.buildArena(arena);assert.ok([...counts.values()].every(count=>count===1),`${arena.id}: map replacement disposes resources once`);
 }
 assert.equal(signatures.size,MAPS.length,'all canonical maps have a distinct material/atmosphere identity');
 view.disposeObject(view.worldGroup);for(const resource of view.renderResources)resource.dispose();renderer.dispose();
});

function playable(t,{fov=80,reduced=false}={}){
 const {view,renderer}=fixture(t);view.camera=new T.PerspectiveCamera(fov,1,.08,220);view.scene=new T.Scene();view.hands=new T.Group();view.camera.add(view.hands);view.scene.add(view.camera);view.actorModels=new Map();view.pickupModels=[];view.playerId=7;view.currentWeapon=-1;view.lastEvent=0;view.motionQuery={matches:reduced};view.display={...DEFAULT_DISPLAY,fov};renderer.render=()=>{};
 return {view,renderer};
}

test('dynamic FOV lerps toward sprint and ADS targets and never drops below 55',t=>{
 const {view}=playable(t,{fov:80});
 const base={id:7,weapon:0,health:100,x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true};
 const frame=player=>view.render('playing',{actors:[player],pickups:[],rockets:[],time:1,events:[]},.05,1);
 for(let i=0;i<120;i++)frame(base);assert.ok(Math.abs(view.camera.fov-80)<.01,'idle FOV stays at the configured value');
 for(let i=0;i<120;i++)frame({...base,sprinting:true});assert.ok(view.camera.fov>84.5&&view.camera.fov<=85.0001,'sprint widens the field of view');
 for(let i=0;i<160;i++)frame({...base,ads:true});assert.ok(view.camera.fov>=55&&view.camera.fov<66.5,'ADS narrows the field of view');
 view.setAim(true);for(let i=0;i<160;i++)frame(base);assert.ok(view.camera.fov<66.5,'setAim drives ADS without a snapshot flag');
 view.setAim(false);for(let i=0;i<200;i++)frame({...base,sprinting:true});assert.ok(view.camera.fov>84.5);
 view.setDisplay({...DEFAULT_DISPLAY,fov:50});for(let i=0;i<240;i++)frame({...base,ads:true});assert.ok(view.camera.fov>=55,'FOV never drops below 55');
});

test('low health toggles the public flag and the camera vignette',t=>{
 const {view}=playable(t,{fov:80});
 const base={id:7,weapon:0,health:100,maxHealth:100,x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true};
 view.render('playing',{actors:[base],pickups:[],rockets:[],time:1,events:[]},.05,1);assert.equal(view.lowHealth,false);
 view.render('playing',{actors:[{...base,health:20}],pickups:[],rockets:[],time:1,events:[]},.05,2);assert.equal(view.lowHealth,true);
 view.render('playing',{actors:[{...base,health:0}],pickups:[],rockets:[],time:1,events:[]},.05,3);assert.equal(view.lowHealth,false,'dead players do not pulse');
});

test('camera shake responds to local damage and death but not reduced motion',t=>{
 const {view}=playable(t,{fov:80});
 view.effect({type:'damage',actor:7,amount:40});assert.ok(view.cameraShake.magnitude>0);
 view.cameraShake.reset();view.effect({type:'damage',actor:8,amount:40});assert.equal(view.cameraShake.magnitude,0,'other actors never shake the local camera');
 view.cameraShake.reset();view.effect({type:'death',actor:7});assert.ok(view.cameraShake.magnitude>0);
 view.cameraShake.reset();view.motionQuery.matches=true;view.effect({type:'damage',actor:7,amount:40});assert.equal(view.cameraShake.magnitude,0);
});

test('shared model assets reuse robot materials and geometries across instances',()=>{
 const assets=new ModelAssets(),first=robotModel('chatgpt',assets),before=assets.resources.size;
 assert.ok(before>0);
 const second=robotModel('chatgpt',assets);
 assert.equal(assets.resources.size,before,'a duplicate robot allocates no new materials or geometries');
 const geosA=new Set(),geosB=new Set();first.traverse(n=>n.geometry&&geosA.add(n.geometry));second.traverse(n=>n.geometry&&geosB.add(n.geometry));
 assert.ok([...geosA].some(geometry=>geosB.has(geometry)),'duplicate robots share geometry instances');
 let meshes=0;first.traverse(n=>{if(n.isMesh)meshes++;});
 assert.ok(before<meshes*2,'resources are shared instead of one per mesh slot');
 assets.dispose();
});

test('muzzle light pool stays fixed size, flashes colored light and disposes',()=>{
 const scene=new T.Scene(),pool=new MuzzleLightPool(scene,2);
 pool.flash('#ff0000',{x:1,y:2,z:3},.1);
 assert.equal(scene.children.length,2);assert.equal(pool.lights[1].position.x,1);assert.equal(pool.lights[1].visible,true);
 for(let i=0;i<40;i++)pool.flash('#00ff00',{x:0,y:0,z:0},.05);
 assert.equal(scene.children.length,2,'pool never grows');
 for(let i=0;i<10;i++)pool.update(.05);
 assert.ok(pool.lights.every(light=>!light.visible&&light.intensity===0));
 pool.dispose();assert.equal(scene.children.length,0);
});

test('camera shake is bounded, decays and is suppressed for reduced motion',()=>{
 const camera=new T.PerspectiveCamera();camera.rotation.order='YXZ';
 const shake=new CameraShake();
 for(let i=0;i<40;i++)shake.add(.2);assert.ok(shake.magnitude<=1.4);
 camera.position.set(1,2,3);camera.rotation.set(0,0,0,'YXZ');shake.apply(camera,2,false);
 assert.ok(camera.position.x!==1||camera.position.y!==2,'shake perturbs the presentation camera');
 shake.update(2);assert.equal(shake.magnitude,0);
 shake.add(1);camera.position.set(1,2,3);camera.rotation.set(0,0,0,'YXZ');shake.apply(camera,2,true);
 assert.deepEqual(camera.position.toArray(),[1,2,3]);assert.equal(camera.rotation.z,0);
});

test('low health overlay fades in under pressure and out on recovery',()=>{
 const camera=new T.PerspectiveCamera(80,1.5,.08,220),overlay=new LowHealthOverlay(camera);
 overlay.update(true,0,.1,false,camera);assert.equal(overlay.mesh.visible,true);assert.ok(overlay.opacity>0);assert.ok(overlay.mesh.scale.x>0);
 overlay.update(true,0,.1,true,camera);assert.ok(overlay.opacity>0,'reduced motion keeps a static tint');
 for(let i=0;i<120;i++)overlay.update(false,i*.1,.1,false,camera);
 assert.ok(overlay.opacity<.01);assert.equal(overlay.mesh.visible,false);
 overlay.dispose();assert.equal(camera.children.length,0);
});
test('the CPU renderer draws every instance of an InstancedMesh',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>ctx})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx});
 const scene=new T.Scene();scene.background=new T.Color('#000');
 const geometry=new T.BoxGeometry(1,1,1),material=new T.MeshBasicMaterial({color:'#ffffff'});
 const camera=new T.PerspectiveCamera(82,320/180,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);
 const singles=[];
 for(let i=0;i<4;i++){const mesh=new T.Mesh(geometry,material);mesh.position.set((i-1.5)*1.2,0,0);scene.add(mesh);singles.push(mesh);}
 renderer.render(scene,camera);const separate=renderer.info.render.triangles;
 assert.ok(separate>0,'plain meshes draw');
 for(const mesh of singles)scene.remove(mesh);
 const instanced=new T.InstancedMesh(geometry,material,4),dummy=new T.Object3D();
 for(let i=0;i<4;i++){dummy.position.set((i-1.5)*1.2,0,0);dummy.updateMatrix();instanced.setMatrixAt(i,dummy.matrix);}
 instanced.instanceMatrix.needsUpdate=true;scene.add(instanced);
 renderer.render(scene,camera);
 assert.equal(renderer.info.render.triangles,separate,`instanced mesh should match the same four separate meshes (${separate} -> ${renderer.info.render.triangles})`);
});
test('shadow refresh throttles to a fixed cadence',()=>{
 assert.deepEqual(shadowTick(undefined,2),{tick:1,refresh:false});
 assert.deepEqual(shadowTick(1,2),{tick:0,refresh:true});
 assert.deepEqual(shadowTick(0,3),{tick:1,refresh:false});
 assert.deepEqual(shadowTick(1,3),{tick:2,refresh:false});
 assert.deepEqual(shadowTick(2,3),{tick:0,refresh:true});
});
test('death pool bounds flung pieces and lingering splats',()=>{
 const scene={children:[],add(o){this.children.push(o);},remove(o){const i=this.children.indexOf(o);if(i>=0)this.children.splice(i,1);}};
 const pool=new DeathPool(scene,4,2);
 assert.equal(pool.spawn({x:0,y:0,z:0},{pieces:10,force:6,color:'#8f1a1a',seed:3}),4);
 assert.equal(pool.slots.length,4);
 assert.equal(pool.spawn({x:1,y:0,z:1},{pieces:3,force:6,seed:4}),0,'no free slots while every piece is live');
 pool.update(2.5);
 assert.equal(pool.spawn({x:1,y:0,z:1},{pieces:3,force:6,seed:4}),3);
 assert.equal(pool.slots.length,4,'reuses slots instead of growing');
 assert.equal(pool.splat({x:0,y:0,z:0},{seed:1}),true);
 pool.splat({x:2,y:0,z:2},{seed:2});pool.splat({x:3,y:0,z:3},{seed:3});
 assert.equal(pool.splats.length,2,'splat pool bounded');
 pool.update(.05);
 pool.clear();
 assert.ok(pool.slots.every(s=>!s.obj.visible)&&pool.splats.every(s=>!s.obj.visible));
 pool.dispose();
 assert.equal(pool.slots.length,0);assert.equal(pool.splats.length,0);assert.equal(scene.children.length,0);
});
test('the app Reduce Motion preference drives view effects as well as the OS query',t=>{
 const {view}=fixture(t);
 view.motionQuery={matches:false};view.display={...DEFAULT_DISPLAY,reducedMotion:true};
 assert.equal(view.reduced(),true,'app preference alone reduces motion');
 view.display={...DEFAULT_DISPLAY,reducedMotion:false};view.motionQuery={matches:true};
 assert.equal(view.reduced(),true,'OS preference alone reduces motion');
 view.motionQuery={matches:false};view.display={...DEFAULT_DISPLAY,reducedMotion:false};
 assert.equal(view.reduced(),false,'neither preference reduces motion');
});

test('flags recolor with the team palette and rebuild their geometry after an arena swap',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>ctx})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const renderer=new SoftwareRenderer({width:160,height:90,getContext:()=>ctx}),view=Object.create(ArenaView.prototype);
 Object.assign(view,{scene:new T.Scene(),renderResources:new Set(),renderer,flagModels:new Map(),display:{...DEFAULT_DISPLAY}});
 view.scene.add(new T.HemisphereLight(),new T.DirectionalLight());
 const arena=MAPS[0];
 view.buildArena(arena);
 const flags={time:1,flags:[{team:0,x:1,y:0,z:2}]};
 view.updateFlags(flags,arena);
 const material=view.flagModels.get('0').userData.material;
 assert.equal(material.color.getHexString(),'ed514b');
 view.display.teamPalette='colorblind';
 view.updateFlags(flags,arena);
 assert.equal(material.color.getHexString(),'ff9d2e','flag recolors with the active palette');
 const firstPole=view.flagAssets.pole,disposes=[];
 firstPole.addEventListener('dispose',()=>disposes.push(1));
 view.flagModels.clear();
 view.buildArena(arena);
 assert.equal(disposes.length,1,'old flag geometry disposed exactly once');
 assert.equal(view.flagAssets,null,'flag geometry cache resets on rebuild');
 view.updateFlags(flags,arena);
 assert.notEqual(view.flagAssets.pole,firstPole,'flag geometry recreated after a rebuild');
 renderer.dispose();
});

test('boundary rails merge into clean non-duplicated wall geometry, dispose once and fall back to gates',()=>{
 const boundary={
  outer:[{x:0,z:-40},{x:40,z:-40},{x:40,z:40},{x:0,z:40}],
  inner:[{x:0,z:-20},{x:20,z:-20},{x:20,z:20},{x:0,z:20}],
 };
 const race={gates:[{x:0,z:-40,nx:0,nz:1,halfWidth:12}],grid:[],centerline:[{x:0,z:-40},{x:0,z:40}],boundary};
 const model=raceTrackModel(race,'#ffba59');
 const walls=[];model.traverse(n=>{if(n.userData.raceBarrier)walls.push(n);});
 const stripes=[];model.traverse(n=>{if(n.userData.raceStripe)stripes.push(n);});
 assert.equal(walls.length,2,'one merged wall per boundary polygon');
 assert.equal(stripes.length,2);
 for(const wall of walls){
  assert.ok(wall.geometry.attributes.normal,'wall normals are computed');
  const positions=wall.geometry.attributes.position.array;
  assert.ok(positions.length>0&&[...positions].every(Number.isFinite));
  const seen=new Set();
  for(let i=0;i<positions.length;i+=9){
   const key=Array.from(positions.slice(i,i+9)).map(value=>Math.round(value*1e4)).join(',');
   assert.ok(!seen.has(key),'no duplicated coplanar wall triangle');seen.add(key);
  }
 }
 const finite=node=>[...node.geometry.attributes.position.array].every(Number.isFinite);
 assert.ok(stripes.every(stripe=>finite(stripe)));
 model.traverse(node=>{if(node.userData.raceBarrier)assert.notEqual(node.userData.noCameraOcclusion,true,'solid race rails still occlude the camera');else assert.equal(node.userData.noCameraOcclusion,true,'decorative race geometry never blocks the occlusion ray');});
 const resources=new Set();model.traverse(n=>{if(n.geometry)resources.add(n.geometry);if(n.material)resources.add(n.material);});
 let disposed=0;for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);
 ArenaView.prototype.disposeObject.call({},model);
 assert.equal(disposed,resources.size,'every wall resource is disposed exactly once');
 const fallback=raceTrackModel({gates:[{x:0,z:0,nx:0,nz:1,halfWidth:12},{x:20,z:0,nx:1,nz:0,halfWidth:12}],grid:[],centerline:[]},'#ffba59');
 let fallbackWalls=0;fallback.traverse(n=>{if(n.userData.raceBarrier)fallbackWalls++;});
 assert.equal(fallbackWalls,2,'older fixtures rebuild both rails from gate normals');
 fallback.traverse(n=>{if(n.geometry)assert.ok(finite(n));});
 ArenaView.prototype.disposeObject.call({},fallback);
});

test('cinematic race demo cycles camera rigs while the non-cinematic chase is untouched',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),worldGroup:new T.Group(),camera:new T.PerspectiveCamera(),hands:new T.Group(),renderer:{render(){}},resize(){},actorModels:new Map(),pickupModels:[],playerId:-1,currentWeapon:-1,lastEvent:0,motionQuery:{matches:false},_renderPreview(){}});
 view.scene.add(view.worldGroup,view.camera);view.camera.add(view.hands);
 const vehicles=Array.from({length:8},(_,id)=>({id,kind:'puma',x:id*5,y:0,z:0,yaw:0}));
 const centerline=Array.from({length:8},(_,i)=>({x:Math.cos(i/8*Math.PI*2)*30,z:Math.sin(i/8*Math.PI*2)*30}));
 const match={actors:[{id:0,vehicleId:0,weapon:0,health:100,x:0,y:0,z:0}],vehicles,race:{boxes:[],hazards:[],centerline},mapId:'puma-circuit',time:0};
 view.setShowcase(match);view.setCinema(true);view.setDirector({tour:true,update:()=>({x:0,y:50,z:0,pitch:0,yaw:0,roll:0,fov:70})});
 const positions=[],directions=[],modes=[];
 for(const time of [0,1,RACE_DEMO_MODE_SECONDS,RACE_DEMO_MODE_SECONDS*2,RACE_DEMO_MODE_SECONDS*3,RACE_DEMO_MODE_SECONDS*4]){
  match.time=time;view.render('selection',null,.05,time);
  positions.push(view.camera.position.clone());directions.push(view.camera.getWorldDirection(new T.Vector3()));modes.push(view._raceCam.mode);
 }
 assert.deepEqual(modes,['chase','chase','orbit','flyover','trackside','chase']);
 assert.ok(positions.some((position,index)=>index>0&&position.distanceTo(positions[index-1])>1),'the demo camera moves between rigs');
 assert.ok(directions.some((direction,index)=>index>0&&direction.distanceTo(directions[index-1])>1e-3),'the demo look direction changes');
 view.setCinema(false);view.playerId=0;match.time=40;
 view.render('playing',match,.016,40);
 assert.ok(view.camera.position.distanceTo(new T.Vector3(0,5,-9))<1e-9,'local race chase is unchanged');
 view.disposeObject(view.scene);for(const resource of view.sharedResources??[])resource.dispose();
});

test('raceTrackModel draws one flat chevron group per boost pad facing the centerline',()=>{
 const race={gates:[],grid:[],centerline:[{x:-10,z:0},{x:0,z:0},{x:0,z:10}],boostPads:[{id:'boost-1',x:0,z:5},{id:'boost-2',x:-5,z:0}]};
 const model=raceTrackModel(race,'#ffba59');
 const pads=model.children.filter(n=>n.userData.raceBoost!==undefined);
 assert.equal(pads.length,2,'one group per boost pad');
 for(const pad of pads){
  assert.equal(pad.children.length,3,'each pad is a flat chevron set');
  assert.equal(pad.position.y,.06,'pads sit flush on the track');
  pad.traverse(n=>assert.equal(n.userData.objective,true,'boost pads never block the occlusion ray'));
  pad.traverse(n=>{if(n.geometry)assert.ok([...n.geometry.attributes.position.array].every(Number.isFinite));});
 }
 const straight=Object.fromEntries(pads.map(p=>[p.userData.raceBoost,p]));
 assert.ok(Math.abs(straight['boost-1'].rotation.y-0)<1e-9,'nearest straight is +z');
 assert.ok(Math.abs(straight['boost-2'].rotation.y-Math.PI/2)<1e-9,'nearest straight is +x');
 const reversed=raceTrackModel({gates:[],grid:[],centerline:[{x:0,z:10},{x:0,z:0}],boostPads:[{id:'r',x:0,z:5}]},'#ffba59');
 const back=reversed.children.find(n=>n.userData.raceBoost!==undefined);
 assert.ok(Math.abs(back.rotation.y-Math.PI)<1e-9,'pad follows the centerline direction, not its winding');
 ArenaView.prototype.disposeObject.call({},model);
 ArenaView.prototype.disposeObject.call({},reversed);
});

test('coins spin in place, hide when not ready and dispose when they expire',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{worldGroup:new T.Group(),reduced:()=>false});
 const match={race:{boxes:[],hazards:[],coins:[{id:'c1',x:1,z:1,ready:true},{id:'c2',x:2,z:2,ready:false}]}};
 view.updateRace(match,0);
 const coin=view.raceModels.get('coin:c1'),hidden=view.raceModels.get('coin:c2');
 assert.ok(coin&&hidden,'ready and hidden coins both exist while present');
 assert.equal(coin.visible,true);assert.equal(hidden.visible,false);
 assert.equal(coin.position.y,1.2,'coins float above the track');
 assert.equal(coin.children[0].geometry.type,'CylinderGeometry');
 const spun=coin.rotation.y;view.updateRace(match,2);
 assert.ok(coin.rotation.y>spun,'coins rotate with time');
 let disposed=0;for(const child of hidden.children)child.geometry?.addEventListener('dispose',()=>disposed++);
 match.race.coins=[{id:'c1',x:1,z:1,ready:false}];view.updateRace(match,3);
 assert.equal(view.raceModels.has('coin:c2'),false,'expired coin is removed');
 assert.ok(disposed>=2,'expired coin geometry is disposed');
 assert.equal(view.raceModels.get('coin:c1').visible,false);
 view.updateRace({},4);assert.equal(view.worldGroup.children.length,0);
});

test('reduced motion freezes coin spin',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{worldGroup:new T.Group(),reduced:()=>true});
 const match={race:{boxes:[],hazards:[],coins:[{id:'r',x:0,z:0,ready:true}]}};
 view.updateRace(match,0);const coin=view.raceModels.get('coin:r'),before=coin.rotation.y;
 view.updateRace(match,9);assert.equal(coin.rotation.y,before,'reduced motion holds the coin static');
 view.updateRace({},10);assert.equal(view.worldGroup.children.length,0);
});

test('oil and mine hazards render distinct models and dispose with the lifecycle',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{worldGroup:new T.Group(),reduced:()=>false});
 const match={race:{boxes:[],hazards:[{id:'o',x:1,z:2,ttl:3,type:'oil'},{id:'m',x:4,z:5,ttl:3,type:'mine'}]}};
 view.updateRace(match,1);
 const oil=view.raceModels.get('oil:o'),mine=view.raceModels.get('mine:m');
 assert.ok(oil&&mine,'each hazard type keeps its own keyed model');
 assert.notEqual(oil,mine);
 assert.equal(oil.children[0].geometry.type,'CylinderGeometry','oil keeps its slick as the first child');
 assert.equal(mine.children.length,8,'mine is a core, six spikes and a halo');
 assert.equal(mine.children[7].geometry.type,'TorusGeometry');
 assert.equal(mine.position.y,0);assert.equal(oil.position.y,.1);
 const pulsing=mine.userData.ring.scale.x;
 view.updateRace(match,1.2);assert.notEqual(mine.userData.ring.scale.x,pulsing,'mine halo pulses');
 view.updateRace({},2);assert.equal(view.worldGroup.children.length,0);
});

test('race model lifecycles reuse models and dispose each resource exactly once',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{worldGroup:new T.Group(),reduced:()=>false});
 const match={race:{boxes:[{id:'b',x:0,z:0,ready:true}],hazards:[{id:'o',x:0,z:0,ttl:4,type:'oil'},{id:'m',x:1,z:1,ttl:4,type:'mine'}],coins:[{id:'c',x:2,z:2,ready:true}]}};
 view.updateRace(match,0);
 const box=view.raceModels.get('box:b'),oil=view.raceModels.get('oil:o'),mine=view.raceModels.get('mine:m'),coin=view.raceModels.get('coin:c');
 view.updateRace(match,1);
 assert.equal(view.raceModels.get('box:b'),box);assert.equal(view.raceModels.get('oil:o'),oil);
 assert.equal(view.raceModels.get('mine:m'),mine);assert.equal(view.raceModels.get('coin:c'),coin,'models are reused across frames');
 const resources=new Set();for(const model of [box,oil,mine,coin])model.traverse(n=>{if(n.geometry)resources.add(n.geometry);if(n.material)resources.add(n.material);});
 const disposed=new Map();for(const resource of resources){disposed.set(resource,0);resource.addEventListener('dispose',()=>disposed.set(resource,disposed.get(resource)+1));}
 match.race.boxes=[];match.race.hazards=[];match.race.coins=[];
 view.updateRace(match,2);
  assert.ok([...disposed.values()].every(count=>count===1),'each live resource is disposed exactly once');
  assert.equal(view.raceModels.size,0);assert.equal(view.worldGroup.children.length,0);
});

function payloadView(reduced=false){
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),worldGroup:new T.Group(),motionQuery:{matches:reduced},renderer:{isSoftware:true},display:{...DEFAULT_DISPLAY}});
 view.scene.add(view.worldGroup);
 return view;
}
const payloadArena={id:'crosswire',color:'#55ddcc'};
const rawPayload={kind:'payload',attacker:0,defender:1,contested:false,position:{x:1,y:2,z:3},distance:5,total:50,path:[{x:0,y:2,z:0},{x:10,y:2,z:0}],waypointDistance:[0,10]};

test('payload pig renders from a raw objectiveState, hovers with a bob and hides when idle',()=>{
 const view=payloadView();
 view.updatePayloadModel({objectiveState:rawPayload},payloadArena,0);
 const pig=view.payloadModel;
 assert.ok(pig&&pig.userData.payload,'raw objectiveState builds the pig without a snapshot');
 assert.equal(pig.visible,true);
 let meshes=0;pig.traverse(n=>{if(n.isMesh)meshes++;});
 assert.ok(meshes>=10,`pig is assembled from detailed sub-meshes (${meshes})`);
 assert.equal(pig.userData.wings.length,2);assert.equal(pig.userData.trotters.length,4);
 pig.traverse(n=>{if(n.isMesh)assert.equal(n.userData.objective,true,'every pig sub-mesh is ignored by camera occlusion');});
 assert.ok(Math.abs(pig.position.y-(2+1.35))<1e-9,'pig hovers 1.35m above the ground point');
 assert.equal(pig.position.x,1);assert.equal(pig.position.z,3);
 assert.ok(Math.abs(pig.rotation.y-Math.PI/2)<1e-6,'pig yaws along the route tangent');
 view.updatePayloadModel({objectiveState:rawPayload},payloadArena,1);
 assert.ok(Math.abs(pig.position.y-(2+1.35+Math.sin(1*2.5)*.18))<1e-9,'the hover adds a gentle bob');
 view.updatePayloadModel({objectiveState:{kind:'koth',zones:[]}},payloadArena,2);
 assert.equal(pig.visible,false,'pig hides without a payload objective');
 view.disposeObject(view.scene);
});

test('reduced motion freezes the payload bob and wing flap while keeping the hover',()=>{
 const view=payloadView(true);
 view.updatePayloadModel({objectiveState:rawPayload},payloadArena,0);
 const pig=view.payloadModel,wing=pig.userData.wings[0],baseY=pig.position.y,beat=wing.rotation.z;
 assert.equal(baseY,2+1.35,'reduced motion keeps a static hover height');
 view.updatePayloadModel({objectiveState:rawPayload},payloadArena,3);
 assert.equal(pig.position.y,baseY,'no bob under reduced motion');
 assert.equal(wing.rotation.z,beat,'no wing flap under reduced motion');
 view.disposeObject(view.scene);
});

test('in-world objective markers render from a raw objectiveState Match',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),worldGroup:new T.Group(),objectiveModels:new Map(),motionQuery:{matches:true},renderer:{isSoftware:true},display:{...DEFAULT_DISPLAY}});
 view.scene.add(view.worldGroup);
 view.updateObjectives({objectiveState:{kind:'koth',zones:[{id:'hill',x:2,y:1,z:-3,radius:4,owner:0,captureTeam:0,progress:40}]}},payloadArena);
 const hill=view.objectiveModels.get('hill');
 assert.ok(hill&&hill.userData.objective,'raw objectiveState produces the hill marker');
 assert.equal(hill.position.y,1);
 assert.equal(hill.userData.baseMat.color.getHexString(),'ed514b');
 view.disposeObject(view.scene);
});

test('the active assault sector is highlighted while inactive sectors are dimmed',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),worldGroup:new T.Group(),objectiveModels:new Map(),motionQuery:{matches:false},renderer:{isSoftware:true},display:{...DEFAULT_DISPLAY}});
 view.scene.add(view.worldGroup);
 const zones=[{id:'alpha',x:0,y:0,z:0,radius:3,owner:0,progress:100,captureTeam:null},{id:'bravo',x:6,y:0,z:0,radius:3,owner:null,progress:0,captureTeam:null},{id:'charlie',x:12,y:0,z:0,radius:3,owner:null,progress:0,captureTeam:null}];
 view.updateObjectives({time:1,objectiveState:{kind:'assault',attacker:0,defender:1,active:1,zones}},payloadArena);
 const alpha=view.objectiveModels.get('alpha'),bravo=view.objectiveModels.get('bravo'),charlie=view.objectiveModels.get('charlie');
 assert.equal(bravo.userData.assaultActive,true);
 assert.equal(alpha.userData.assaultActive,false);
 assert.equal(charlie.userData.assaultActive,false);
 assert.ok(bravo.userData.baseMat.emissiveIntensity>alpha.userData.baseMat.emissiveIntensity,'active sector is brighter than captured sectors');
 assert.ok(bravo.userData.baseMat.emissiveIntensity>charlie.userData.baseMat.emissiveIntensity,'active sector is brighter than future sectors');
 assert.ok(bravo.userData.areaMat.opacity>charlie.userData.areaMat.opacity,'inactive sectors are dimmed');
 const before=bravo.scale.y;
 view.updateObjectives({time:1.3,objectiveState:{kind:'assault',attacker:0,defender:1,active:1,zones}},payloadArena);
 assert.notEqual(bravo.scale.y,before,'the active sector pulses without reduced motion');
 view.motionQuery={matches:true};
 view.updateObjectives({time:1.6,objectiveState:{kind:'assault',attacker:0,defender:1,active:1,zones}},payloadArena);
 assert.equal(bravo.scale.y,1,'reduced motion holds the active sector pulse');
 view.disposeObject(view.scene);
});

test('underbarrel attachments add a distinct mesh and honor their visual color',()=>{
 const underbarrels=['quickdraw-grip','burst-module','grenade-launcher','homing-beacon','chain-capacitor'];
 let base=0;weaponModel(0).traverse(n=>{if(n.isMesh)base++;});
 for(const id of underbarrels){
  const {visual}=resolveAttachments([id]);
  const model=weaponModel(0,undefined,visual);
  let meshes=0;const colors=new Set();
  model.traverse(n=>{if(!n.isMesh)return;meshes++;if(n.material?.color)colors.add(n.material.color.getHexString());});
  assert.ok(meshes>base,`${id} produces extra underbarrel geometry`);
  assert.ok(colors.has((resolveAttachments([id]).visual.color||'').replace('#','')),`${id} paints the attachment with its visual color`);
  model.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material){for(const m of Array.isArray(n.material)?n.material:[n.material])m.dispose();}});
 }
});

test('dispose clears the global surface-texture cache',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>ctx})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const first=surfaceTextures('rock',{seed:21,repeat:[1,1]});assert.ok(first);
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),menu:{scene:new T.Scene()},renderResources:new Set(),sharedResources:new Set(),modelAssets:new ModelAssets(),renderer:{dispose(){}}});
 view.dispose();
 assert.notEqual(surfaceTextures('rock',{seed:21,repeat:[1,1]}),first,'dispose drops cached canvas textures');
 clearSurfaceTextures();
});

test('procedural textures are wired across arena floors, blocks, and weapon detailing', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const ctx = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    fillText() {},
    strokeText() {},
    fillRect() {},
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });

  const view = Object.assign(Object.create(ArenaView.prototype), {
    scene: new T.Scene(),
    menu: { scene: new T.Scene() },
    renderResources: new Set(),
    sharedResources: new Set(),
    modelAssets: new ModelAssets(),
    renderer: { isSoftware: false, dispose() {} },
    display: { ...DEFAULT_DISPLAY },
    reduced: () => false,
  });

  // Verify hazard_stripes on foundry reactor blocks
  const foundry = MAPS.find(m => m.id === 'foundry');
  view.buildArena(foundry);
  const reactorMesh = view.worldGroup.children.find(m => {
    const b = foundry.blocks[m.userData.block];
    return b && b.kind === 'reactor';
  });
  assert.ok(reactorMesh, 'foundry builds reactor mesh');
  assert.equal(reactorMesh.material.map?.userData.surfaceKind, 'hazard_stripes', 'reactor uses hazard_stripes texture');

  // Verify holographic_grid on neon-vertical floor
  const neon = MAPS.find(m => m.id === 'neon-vertical');
  view.buildArena(neon);
  const floorMesh = view.worldGroup.children.find(m => m.position.y === -0.25);
  assert.ok(floorMesh, 'neon-vertical builds floor mesh');
  assert.equal(floorMesh.material.map?.userData.surfaceKind, 'holographic_grid', 'neon floor uses holographic_grid');

  // Verify the viewmodel exposes named per-weapon anchors; the old unconditional
  // shared rail/sights/deflector is replaced by builder-owned sight lines.
  const weapon = weaponModel(0);
  assert.ok(weapon.userData.anchors?.rearSight && weapon.userData.anchors?.frontSight, 'weaponModel exposes named sight anchors');
  assert.ok(weapon.userData.anchors?.muzzle, 'weaponModel exposes a muzzle anchor');
  assert.ok(weapon.userData.aim?.position && Number.isFinite(weapon.userData.aim.pitch), 'ADS is derived from the sight anchors');

  view.dispose();
  clearSurfaceTextures();
});

 test('race builds reuse cached geometry for identical tiles',()=>{
  const race={gates:[{x:0,z:0,nx:0,nz:1,halfWidth:12},{x:20,z:0,nx:1,nz:0,halfWidth:12}],grid:[{x:0,z:0,heading:0},{x:4,z:0,heading:0}],centerline:[]};
  const assets=new ModelAssets();
  const buckets=model=>{const map=new Map();model.traverse(n=>{if(!n.isMesh||n.geometry?.type!=='BoxGeometry')return;const p=n.geometry.parameters,key=`${p.width}|${p.height}|${p.depth}`;const entry=map.get(key)||{count:0,geometries:new Set()};entry.count++;entry.geometries.add(n.geometry);map.set(key,entry);});return map;};
  const first=raceTrackModel(race,'#83f4d5',undefined,assets),repeated=[...buckets(first).entries()].filter(([,entry])=>entry.count>1);
  assert.ok(repeated.length>0,'the track has repeated tile dimensions');
  for(const [key,entry] of repeated)assert.equal(entry.geometries.size,1,`${key} shares one geometry across ${entry.count} tiles`);
  const firstGeometries=new Set();first.traverse(n=>{if(n.geometry)firstGeometries.add(n.geometry);});
  const second=raceTrackModel(race,'#83f4d5',undefined,assets),secondGeometries=new Set();second.traverse(n=>{if(n.geometry)secondGeometries.add(n.geometry);});
  assert.ok([...secondGeometries].some(geometry=>firstGeometries.has(geometry)),'a rebuild reuses cached geometry instances');
  ArenaView.prototype.disposeObject.call({},first);ArenaView.prototype.disposeObject.call({},second);assets.dispose();
});

test('reduced motion keeps the static arena backdrop while freezing animation',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const ctx={fillRect(){},fillText(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>ctx})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const view=Object.create(ArenaView.prototype);
 Object.assign(view,{scene:new T.Scene(),renderResources:new Set(),renderer:{isSoftware:false},reduced:()=>true});
 view.buildArena(MAPS[0]);
 const environment=[];view.worldGroup.traverse(n=>{if(n.userData.environment)environment.push(n);});
 assert.ok(environment.some(n=>n.userData.sky),'reduced motion keeps the sky dome');
 assert.ok(environment.some(n=>n.userData.mountains),'reduced motion keeps the mountain ring');
 view.disposeObject(view.worldGroup);for(const resource of view.renderResources)resource.dispose();
});

test('first-person viewmodel rebuilds when attachments or finish change',t=>{
 const {view}=playable(t);
 const base={id:7,weapon:0,health:100,x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true};
 const frame=(player,dt=.016)=>view.render('playing',{actors:[player],pickups:[],rockets:[],time:1,events:[]},dt,1);
 frame(base);const initial=view.firstPerson;
 frame(base);assert.equal(view.firstPerson,initial,'unchanged gear keeps the same viewmodel');
 const scoped={...base,weaponSwitch:.4,attachments:{visual:{optic:'scope',barrel:'stock',magazine:'stock',underbarrel:'none'}}};
 frame(scoped);
 assert.ok(view._swap,'a presentation change starts a swap');
 assert.equal(view.firstPerson,initial,'the outgoing weapon is retained while lowering');
 for(let i=0;i<30;i++)frame(scoped);
 const afterScope=view.firstPerson;assert.notEqual(afterScope,initial,'the incoming viewmodel is raised after the swap');
 const finished={...scoped,finish:'finish-ion'};
 frame(finished);for(let i=0;i<30;i++)frame(finished);
 assert.notEqual(view.firstPerson,afterScope,'a finish change rebuilds the viewmodel');
 view.disposeObject(view.scene);
});

test('soccer presentation renders one keyed ball and skips race pickups',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{worldGroup:new T.Group(),reduced:()=>false});
 const match={race:{kind:'soccer',ball:{x:1,y:2,z:3,vx:4,vz:5,r:1.1},boxes:[{id:'b',x:0,z:0,ready:true}],coins:[{id:'c',x:0,z:0,ready:true}],hazards:[{id:'h',x:0,z:0,ttl:1,type:'oil'}]}};
 view.updateRace(match,0);
 const ball=view.raceModels.get('soccer-ball');
 assert.ok(ball&&ball.name==='soccer-ball','the ball keeps its keyed model');
 assert.deepEqual(ball.position.toArray(),[1,2,3]);
 const [hex,pent]=ball.children;
 assert.equal(hex.geometry.type,'BufferGeometry');
 assert.ok(hex.geometry.attributes.position.count/3>=1000,'the ball has a high-poly panel shell');
 assert.notEqual(pent.material.color.getHexString(),hex.material.color.getHexString(),'panels use a contrasting colour');
 assert.ok(view.sharedResources.has(hex.geometry)&&view.sharedResources.has(pent.geometry),'ball geometry is shared, not owned by the model');
 ball.traverse(node=>{assert.equal(node.userData.objective,true);assert.equal(node.userData.noCameraOcclusion,true);});
 assert.equal(view.raceModels.size,1,'soccer skips race boxes, hazards and coins');
 const before=ball.quaternion.toArray();
 view.updateRace({race:{kind:'soccer',ball:{x:5,y:1,z:6,r:1.1,vx:4,vz:0}}},1);
 assert.equal(ball.position.x,5);
 assert.notDeepEqual(ball.quaternion.toArray(),before,'the ball rolls when it moves');
 view.updateRace({},2);assert.equal(view.raceModels.size,0);assert.equal(view.worldGroup.children.length,0);
});

test('soccer pitch draws markings and goals while posts still occlude the camera',()=>{
 const race={kind:'soccer',pitch:{minX:-30,maxX:30,minZ:-18,maxZ:18},goals:[{team:0,x:-30,z:0,nx:-1,nz:0,halfWidth:6,height:4,depth:2},{team:1,x:30,z:0,nx:1,nz:0,halfWidth:6,height:4,depth:2}],boundary:{outer:[{x:-34,z:-22},{x:34,z:-22},{x:34,z:22},{x:-34,z:22}]}};
 const model=raceTrackModel(race,'#55ddcc'),posts=[],nets=[],paint=[],arcs=[];
 model.traverse(node=>{if(node.userData.soccerPost)posts.push(node);if(node.userData.soccerNet)nets.push(node);if(node.isMesh&&node.userData.pitchArc)arcs.push(node);if(node.isMesh&&node.userData.arenaDetail)paint.push(node);});
 assert.equal(posts.length,6,'each goal contributes two posts and a crossbar');
 assert.equal(nets.length,2,'each goal gets one line-lattice net instead of four solid panels');
 for(const net of nets){
  assert.equal(net.isLineSegments,true,'nets are built from LineSegments');
  assert.equal(net.userData.noCameraOcclusion,true);
  const positions=net.geometry.attributes.position.array;
  assert.ok(positions.length>0&&[...positions].every(Number.isFinite),'net lattice is finite');
 }
 assert.ok(arcs.length>=6,'corner, goal-area and penalty arcs are flat arena detail');
 for(const arc of arcs){assert.equal(arc.userData.arenaDetail,true);assert.equal(arc.geometry.type,'RingGeometry');assert.ok([...arc.geometry.attributes.position.array].every(Number.isFinite));}
 assert.ok(paint.length>0,'pitch paint is flat arena detail');
 for(const post of posts)assert.notEqual(post.userData.noCameraOcclusion,true,'solid posts stay occluders');
 for(const net of nets)assert.equal(net.userData.noCameraOcclusion,true);
 ArenaView.prototype.disposeObject.call({},model);
});

test('software actors and vehicles carry flat contact shadows that dispose with the model',()=>{
 const blobCount=model=>{let count=0;model.traverse(n=>{if(n.userData.blobShadow)count++;});return count;};
 const softwareActor=robotModel('chatgpt',undefined,true),softwareVehicle=vehicleModel('puma',undefined,true),softwareHornet=vehicleModel('hornet',undefined,true);
 const artActor=robotModel('chatgpt',undefined,false),artVehicle=vehicleModel('puma',undefined,false);
 assert.equal(blobCount(softwareActor),1,'software actors get a contact shadow');
 assert.equal(blobCount(softwareVehicle),1,'software pumas get a contact shadow');
 assert.equal(blobCount(softwareHornet),1,'software hornets get a contact shadow');
 assert.equal(blobCount(artActor),0,'WebGL actors rely on shadow maps');
 assert.equal(blobCount(artVehicle),0,'WebGL vehicles rely on shadow maps');
 for(const model of [softwareActor,softwareVehicle,softwareHornet]){
  model.traverse(n=>{if(n.userData.blobShadow){assert.equal(n.userData.noCameraOcclusion,true);assert.equal(n.isMesh,true);assert.ok([...n.geometry.attributes.position.array].every(Number.isFinite));}});
 }
 let disposed=0;softwareActor.traverse(n=>{if(n.userData.blobShadow)n.geometry.addEventListener('dispose',()=>disposed++);});
 ArenaView.prototype.disposeObject.call({},softwareActor);
 assert.equal(disposed,1,'the blob shadow geometry is disposed with the model');
 ArenaView.prototype.disposeObject.call({},softwareVehicle);ArenaView.prototype.disposeObject.call({},softwareHornet);
 ArenaView.prototype.disposeObject.call({},artActor);ArenaView.prototype.disposeObject.call({},artVehicle);
});

test('next-gen props carry paintGeometry vertex colors that the CPU renderer reads',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{renderResources:new Set(),renderer:{isSoftware:true}});
 const world=new T.Group();
 view.buildNextGen(world,{color:'#55ddcc',terrain:{height:()=>0},structures:[],props:[{type:'rock',x:0,z:0,y:0,seed:1},{type:'tree',x:4,z:0,y:0,seed:2},{type:'barrel',x:-4,z:2,y:0,seed:3}]});
 const instanced=[];world.traverse(n=>{if(n.isInstancedMesh)instanced.push(n);});
 assert.ok(instanced.length>=2,'rock/tree families build as instanced props');
 for(const inst of instanced)assert.ok(inst.geometry.attributes.color,'every prop family ships vertex colors');
 const painted=instanced.find(inst=>inst.geometry.attributes.color);
 const colors=Array.from(painted.geometry.attributes.color.array);
 assert.ok(colors.every(Number.isFinite)&&colors.some(value=>value!==1),'the tint varies rather than staying flat white');
 const fills=[];
 const ctx={fillStyle:'',strokeStyle:'',lineWidth:0,font:'',textAlign:'',fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){fills.push(String(ctx.fillStyle));}};
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx});
 const scene=new T.Scene();scene.background=new T.Color('#000');
 scene.add(new T.Mesh(painted.geometry,new T.MeshBasicMaterial({color:'#ffffff'})));
 const camera=new T.PerspectiveCamera(90,320/180,.1,100);camera.position.set(0,3,6);camera.lookAt(0,0,0);
 renderer.render(scene,camera);
 assert.ok(fills.length>0,'the painted prop draws on the CPU renderer');
 assert.ok(fills.some(fill=>!/rgba\(255,255,255/.test(fill)),'vertex tint reaches the software fill color');
 view.disposeObject(world);for(const resource of view.renderResources)resource.dispose();
});

test('destructible props break deterministically into pooled debris and never move collision',()=>{
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 const build=()=>{
  const view=Object.assign(Object.create(ArenaView.prototype),{renderResources:new Set(),renderer:{isSoftware:false},scene:new T.Scene(),motionQuery:{matches:false},display:{...DEFAULT_DISPLAY}});
  view.qualitySettings={tier:2,deaths:72};
  const world=new T.Group();view.worldGroup=world;view.scene.add(world);
  const props=[{type:'crate',x:0,z:0,y:0,seed:1},{type:'barrel',x:3,z:0,y:0,seed:2},{type:'rock',x:-3,z:0,y:0,seed:3}];
  view.buildNextGen(world,{color:'#55ddcc',terrain:{height:()=>0},structures:[],props});
  return {view,world};
 };
 const first=build(),second=build();
 const a=first.view.breakPropsAt({x:0,y:0,z:0},{radius:5,amount:40,serial:1});
 const b=second.view.breakPropsAt({x:0,y:0,z:0},{radius:5,amount:40,serial:1});
 assert.equal(a,2,'the crate and barrel both shatter');
 assert.equal(b,a,'the same hit breaks the same props');
 assert.equal(first.view.breakPropsAt({x:0,y:0,z:0},{radius:5,amount:40,serial:2}),0,'an already-broken prop never re-breaks');
 assert.ok(first.view.debrisPool,'debris is pooled on WebGL');
 assert.deepEqual(first.view.debrisPool.slots.map(s=>s.obj.position.toArray()),second.view.debrisPool.slots.map(s=>s.obj.position.toArray()),'debris transforms are deterministic');
 assert.ok(first.view.debrisPool.slots.every(s=>[s.obj.position.x,s.obj.position.y,s.obj.position.z].every(Number.isFinite)));
 assert.ok(first.view.debrisPool.slots.length<=first.view.debrisPool.limit,'debris stays within the pool limit');
 // The collision blocks are untouched: breaking is presentation only.
 assert.equal(first.world.blocks,undefined,'props carry no collision blocks');
 first.view.disposeObject(first.world);first.view.debrisPool.dispose();
 second.view.disposeObject(second.world);second.view.debrisPool.dispose();
});

test('prop breaks and debris are skipped entirely on the software renderer',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{renderResources:new Set(),renderer:{isSoftware:true},scene:new T.Scene(),motionQuery:{matches:false},display:{...DEFAULT_DISPLAY}});
 view.qualitySettings={tier:0,deaths:36};
 const world=new T.Group();view.worldGroup=world;view.scene.add(world);
 view.buildNextGen(world,{color:'#55ddcc',terrain:{height:()=>0},structures:[],props:[{type:'crate',x:0,z:0,y:0,seed:1}]});
 assert.equal(view.breakPropsAt({x:0,y:0,z:0},{radius:5,amount:40,serial:1}),0,'the CPU renderer never shatters props');
 assert.ok(!view.debrisPool,'the CPU renderer never allocates debris');
 assert.equal(view._updateDebris(.1),0);
 view.disposeObject(world);
});

test('reduced motion suppresses prop debris',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{renderResources:new Set(),renderer:{isSoftware:false},scene:new T.Scene(),motionQuery:{matches:false},display:{...DEFAULT_DISPLAY}});
 view.qualitySettings={tier:2,deaths:72};
 const world=new T.Group();view.worldGroup=world;view.scene.add(world);
 view.buildNextGen(world,{color:'#55ddcc',terrain:{height:()=>0},structures:[],props:[{type:'crate',x:0,z:0,y:0,seed:1}]});
 assert.equal(view.breakPropsAt({x:0,y:0,z:0},{radius:5,amount:40,serial:1,reduced:true}),0,'reduced motion emits no debris');
 view.disposeObject(world);
});

test('free camera seeds from the live camera, clamps its look and resets cleanly',()=>{
 const view=Object.create(ArenaView.prototype);
 view.camera=new T.PerspectiveCamera();view.camera.rotation.order='YXZ';
 view.camera.position.set(3,7,-2);view.camera.rotation.set(.3,.8,0,'YXZ');
 assert.equal(view.freeCam,false);assert.equal(view.directorLock,false);
 view.setFreeCam(true);
 assert.equal(view.freeCam,true);
 assert.deepEqual(view.freePose,{x:3,y:7,z:-2,yaw:.8,pitch:.3},'enabling seeds the pose without a jump');
 view.camera.position.set(9,9,9);view.camera.rotation.set(0,0,0,'YXZ');
 view.setFreeCam(true);
 assert.equal(view.freePose.x,3,'a repeated enable keeps the seeded pose');
 view.setDirectorLock(true);assert.equal(view.directorLock,true);
 view._camWant={};view._raceCam={};
 view.setFreeCam(false);
 assert.equal(view.freeCam,false);assert.equal(view._camWant,undefined);assert.equal(view._raceCam,undefined,'disabling clears cached camera state');
 view.resetFreeCam();assert.deepEqual(view.freePose,{x:0,y:6,z:0,yaw:0,pitch:0});
 view.setFreeCam(true);view.freeLook(0,9);assert.ok(Math.abs(view.freePose.pitch-1.5)<1e-9,'pitch clamps looking up');
 view.freeLook(0,-9);assert.ok(Math.abs(view.freePose.pitch+1.5)<1e-9,'pitch clamps looking down');
 view.freeLook(.4,0);assert.ok(Math.abs(view.freePose.yaw-.4)<1e-9);
});

test('updateFreeCam flies along yaw/pitch, clamps dt and keeps the pose finite',()=>{
 const view=Object.create(ArenaView.prototype);
 view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};
 view.updateFreeCam(.1,{forward:1});
 assert.ok(Math.abs(view.freePose.x)<1e-9);assert.ok(Math.abs(view.freePose.y-6)<1e-9);assert.ok(Math.abs(view.freePose.z+1.6)<1e-9,'forward flies along the look direction at yaw 0');
 view.freePose={x:0,y:6,z:0,yaw:Math.PI/2,pitch:0};
 view.updateFreeCam(.1,{forward:1});
 assert.ok(Math.abs(view.freePose.x+1.6)<1e-9,'yaw turns the flight direction');assert.ok(Math.abs(view.freePose.z)<1e-9);
 view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};
 view.updateFreeCam(.1,{right:1});
 assert.ok(Math.abs(view.freePose.x-1.6)<1e-9,'strafe uses the horizontal right vector');
 view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};
 view.updateFreeCam(.1,{up:1});
 assert.ok(Math.abs(view.freePose.y-7.6)<1e-9,'vertical movement uses world up');
 view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};
 view.updateFreeCam(10,{forward:1});
 assert.ok(Math.abs(view.freePose.z+1.6)<1e-9,'dt clamps to .1');
 view.freePose={x:0,y:6,z:0,yaw:0,pitch:0};
 view.updateFreeCam(.1,{forward:1,boost:true});
 assert.ok(Math.abs(view.freePose.z+3.84)<1e-9,'boost multiplies speed by 2.4');
 view.freePose={x:0,y:.1,z:0,yaw:0,pitch:0};
 view.updateFreeCam(.1,{up:-1});
 assert.equal(view.freePose.y,.4,'the camera never dips below the floor');
 view.freePose={x:NaN,y:6,z:0,yaw:0,pitch:0};
 view.updateFreeCam(.1,{forward:1});
 assert.ok(Number.isFinite(view.freePose.x)&&Number.isFinite(view.freePose.y)&&Number.isFinite(view.freePose.z));
});

test('free camera renders over a race match and restores the normal path when disabled',t=>{
 const {view}=playable(t,{fov:80});
 const actor={id:7,weapon:0,health:100,x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,vehicleId:1};
 const match={actors:[actor],pickups:[],rockets:[],vehicles:[{id:1,kind:'puma',x:5,y:0,z:1,yaw:0}],race:{boxes:[],hazards:[],coins:[],centerline:[{x:0,z:0},{x:0,z:10}]},time:1,events:[]};
 view.setFreeCam(true);
 view.freePose={x:11,y:9,z:-7,yaw:.5,pitch:-.25};
 view.render('playing',match,.016,1);
 assert.deepEqual(view.camera.position.toArray(),[11,9,-7],'the race chase never overrides the free pose');
 assert.equal(view.camera.rotation.x,-.25);assert.equal(view.camera.rotation.y,.5);assert.equal(view.camera.rotation.order,'YXZ');
 assert.equal(view.hands.visible,false,'free cam hides the viewmodel');
 view.setFreeCam(false);
 assert.equal(view.freeCam,false);
 view.render('playing',match,.016,1.016);
 assert.ok(view.camera.position.distanceTo(new T.Vector3(11,9,-7))>1,'disabling free cam leaves the free pose behind');
 view.render('playing',{...match,actors:[{...actor,vehicleId:undefined}],vehicles:[]},.016,1.032);
 assert.deepEqual(view.camera.position.toArray(),[0,1.45,0],'the first-person path returns');
});

test('single-player waypoint marker is created, moved and cleared',t=>{
 const {view,renderer}=fixture(t);view.scene=new T.Scene();view.renderer=renderer;
 view.updateWaypoint({waypoint:{id:'objective-a',x:3,y:0,z:-4,radius:5,label:'GO'}},MAPS[0]);
 assert.ok(view.waypointModel,'waypoint model created');
 assert.equal(view.waypointModel.position.x,3);
 view.updateWaypoint({waypoint:{id:'objective-a',x:9,y:0,z:-4,radius:5,label:'GO'}},MAPS[0]);
 assert.equal(view.waypointModel.position.x,9,'same waypoint moves');
 const first=view.waypointModel;
 view.updateWaypoint({waypoint:{id:'objective-b',x:1,y:0,z:1,radius:5,label:'NEXT'}},MAPS[0]);
 assert.notEqual(view.waypointModel,first,'new objective rebuilds the beacon');
 view.updateWaypoint({waypoint:null},MAPS[0]);
 assert.equal(view.waypointModel,null,'cleared with no waypoint');
});

test('operator model adds shoulder, visor and backpack detail without moving rig joints',()=>{
 const assets=new ModelAssets(),first=robotModel('chatgpt',assets),before=assets.resources.size;
 const data=first.userData;
 assert.equal(data.shoulderPads.length,2,'both shoulders get a pad');
 for(const pad of data.shoulderPads)assert.ok(pad.geometry.type.startsWith('SphereGeometry'));
 assert.ok(data.backpack&&data.backpack.name==='backpack','a backpack group is tagged');
 assert.ok(data.backpack.children.length>=4,'backpack carries canisters, a vent and an antenna');
 assert.ok(data.visor?.brow&&data.visor?.nub,'visor brow and sensor nub exist');
 assert.equal(data.head.getObjectByName('visor-brow'),data.visor.brow);
 const jointKeys=['root','hips','torso','chest','head','armUpperL','armUpperR','forearmL','forearmR','legUpperL','legUpperR','legLowerL','legLowerR','footL','footR'];
 for(const key of jointKeys)assert.ok(data.joints[key],`${key} joint survives the detail pass`);
 assert.ok(Math.abs(data.gunAnchor.position.x-.16)<1e-9&&Math.abs(data.gunAnchor.position.z+.26)<1e-9,'the gun anchor keeps its mount point');
 assert.ok(Math.abs(data.chest.position.x)<1e-12,'the chest was never reparented');
 const second=robotModel('chatgpt',assets);
 assert.equal(assets.resources.size,before,'detail geometry and materials are shared, not reallocated');
 assets.dispose();ArenaView.prototype.disposeObject.call({},first);ArenaView.prototype.disposeObject.call({},second);
});

test('muzzle flash keeps its indexed flare and adds a layered burst per muzzle',()=>{
 for(const model of [weaponModel(0),weaponModel(3)]){
  const {muzzles,flash}=model.userData,feel=model.userData.feel;
  assert.equal(flash.children.length>=muzzles.length*2,true,'each muzzle contributes a flare plus a burst');
  for(const [i,anchor] of muzzles.entries()){
   const flare=flash.children[i];
   assert.equal(flare.geometry.type,'SphereGeometry');
   assert.equal(flare.geometry.parameters.radius,feel.muzzle[0]);
   assert.deepEqual(flare.position.toArray(),anchor.position.toArray());
   const bursts=flash.children.filter(child=>child.userData.muzzleFlash);
   assert.equal(bursts.length,muzzles.length,'one tagged burst per muzzle');
   assert.ok(bursts[i].children.some(child=>child.name==='flash-cone'),'the burst has a cone core');
   assert.equal(bursts[i].children.filter(child=>child.name==='flash-petal').length,2,'the burst has crossed petals');
  }
  const anchors=model.userData.anchors;
  assert.ok(anchors?.rearSight&&anchors?.frontSight,'every weapon exposes rear and front sight anchors');
  assert.equal(anchors.rearSight.userData.weaponDetail,'sight');
  assert.equal(anchors.frontSight.userData.weaponDetail,'sight');
  ArenaView.prototype.disposeObject.call({},model);
 }
});

test('impact decals are pooled on WebGL, skipped on software and bounded',()=>{
 const scene=new T.Scene(),pool=new DecalPool(scene,3);
 for(let i=0;i<6;i++)assert.equal(pool.spawn({x:i,y:0,z:0},{seed:i}),true);
 assert.equal(pool.slots.length,3,'the decal pool never grows past its limit');
 assert.ok(pool.slots.every(slot=>slot.obj.visible&&slot.obj.userData.decal===true));
 pool.update(10);
 assert.ok(pool.slots.every(slot=>!slot.obj.visible),'decals expire and hide');
 const resources=new Set();scene.traverse(n=>{if(n.geometry)resources.add(n.geometry);if(n.material)resources.add(n.material);});
 const counts=new Map();for(const r of resources){counts.set(r,0);r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));}
 pool.dispose();
 assert.ok([...counts.values()].every(count=>count===1),'decal geometry and materials dispose exactly once');
 const webgl=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),renderer:{isSoftware:false},motionQuery:{matches:false},display:{...DEFAULT_DISPLAY}});
 webgl._spawnImpactDecal({x:1,y:2,z:3},false,0);
 assert.ok(webgl.decalPool&&webgl.decalPool.slots.some(slot=>slot.active),'WebGL impacts stamp a decal');
 const software=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),renderer:{isSoftware:true},motionQuery:{matches:false},display:{...DEFAULT_DISPLAY}});
 software._spawnImpactDecal({x:1,y:2,z:3},false,0);
 assert.ok(!software.decalPool,'the CPU renderer never allocates decals');
 webgl.decalPool.dispose();
});

test('the Puma mounts spare-wheel and utility accessories without losing its guns',()=>{
 const model=vehicleModel('puma');
 assert.equal(model.userData.guns.length,2);
 const {spareTire,jerryCan,winch,towHook}=model.userData.accessories;
 assert.ok(spareTire&&jerryCan&&winch&&towHook,'accessories are exposed on userData');
 assert.equal(spareTire.parent,model);
 assert.equal(spareTire.geometry.type,'TorusGeometry');
 assert.equal(jerryCan.name,'jerry-can');
 assert.equal(winch.name,'winch-drum');
 model.traverse(child=>{if(child.geometry)child.geometry.dispose();if(child.material){for(const m of Array.isArray(child.material)?child.material:[child.material])m.dispose();}});
});

test('throne and gauntlet render with distinct arena identities',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>ctx})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),renderResources:new Set(),renderer:{isSoftware:true}});
 const signatures=new Map();
 for(const id of ['throne','gauntlet']){
  const arena=MAPS.find(map=>map.id===id);assert.ok(arena,`${id} is a canonical map`);
  view.buildArena(arena);
  const block=view.worldGroup.children.find(n=>Number.isInteger(n.userData.block));
  signatures.set(id,`${block.material.color.getHexString()}/${view.scene.fog.density}`);
 }
 assert.notEqual(signatures.get('throne'),signatures.get('gauntlet'),'each map has its own palette and fog');
 view.buildArena(MAPS.find(map=>map.id==='exchange'));
 const exchangeBlock=view.worldGroup.children.find(n=>Number.isInteger(n.userData.block));
 const exchangeSig=`${exchangeBlock.material.color.getHexString()}/${view.scene.fog.density}`;
 for(const id of ['throne','gauntlet'])assert.notEqual(signatures.get(id),exchangeSig,`${id} no longer falls back to exchange`);
 view.disposeObject(view.worldGroup);for(const resource of view.renderResources)resource.dispose();
});


test('kill-cam framing is deterministic, bounded and collapses under reduced motion',()=>{
 const args={elapsed:.9,duration:KILLCAM_DURATION,focus:{x:2,y:1,z:-3},killer:{x:8,y:2,z:5},seed:42};
 const a=killcamPose(args),b=killcamPose(args),c=killcamPose({...args,seed:43});
 assert.deepEqual(a,b,'the same kill context frames the same shot');
 assert.notDeepEqual(a,c,'the seed varies the framing');
 for(const value of [a.x,a.y,a.z,a.lookX,a.lookY,a.lookZ,a.fov,a.phase])assert.ok(Number.isFinite(value));
 assert.ok(a.phase>=0&&a.phase<=1);
 assert.ok(a.fov>=50&&a.fov<=100);
 const first=killcamPose({...args,elapsed:0});
 assert.ok(Math.abs(first.phase)<1e-9);
 assert.ok(killcamPose({...args,elapsed:KILLCAM_DURATION*2}).phase===1,'the phase saturates at one');
 const reduced=killcamPose({...args,reduced:true});
 const reducedLater=killcamPose({...args,reduced:true,elapsed:1.7});
 assert.deepEqual([reduced.x,reduced.y,reduced.z,reduced.lookX,reduced.lookY,reduced.lookZ,reduced.fov],[reducedLater.x,reducedLater.y,reducedLater.z,reducedLater.lookX,reducedLater.lookY,reducedLater.lookZ,reducedLater.fov],'reduced motion holds a stable stand-off');
 assert.ok(reduced.fov===62);
});

test('a local death triggers a short kill-cam that only moves the presentation camera',t=>{
 const {view}=playable(t,{fov:80});
 view.deathContext=new Map();
 const player={id:7,weapon:0,health:100,maxHealth:100,x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true};
 view.effect({type:'death',actor:7,pos:{x:3,y:0,z:2},time:10,seed:5,killer:8});
 assert.ok(view.killcam,'killing the local player starts a kill-cam');
 assert.equal(view.killcam.duration,KILLCAM_DURATION);
 const match={actors:[player],pickups:[],rockets:[],time:10.5,events:[]};
 const before=JSON.stringify(player);
 view.render('playing',match,.016,10.5);
 assert.ok(view.killcamActive(),'the kill-cam is still running mid-shot');
 assert.ok(view.camera.position.distanceTo(new T.Vector3(3,0,2))>1,'the camera orbits the death anchor');
 assert.equal(JSON.stringify(player),before,'the authoritative player is never mutated by the framing');
 view.render('playing',{...match,time:10+2*KILLCAM_DURATION},.016,10+2*KILLCAM_DURATION);
 assert.equal(view.killcam,null,'the kill-cam ends after its duration');
 assert.ok(view.camera.position.distanceTo(new T.Vector3(0,1.45,0))<.2,'the normal camera path resumes');
 view.setKillcam(false);
 view.effect({type:'death',actor:7,pos:{x:1,y:0,z:1},time:20});
 assert.equal(view.killcam,null,'the option disables the kill-cam');
});

test('ambient emitters are WebGL-only, bounded and skipped under reduced motion',t=>{
 const {view}=playable(t);
 view.ambientConfig=ambientProfile({id:'foundry'},'day');
 view.ambientAnchors=[{x:0,y:.4,z:0}];
 let spawned=0;for(let i=0;i<40;i++)spawned+=view._updateAmbient(null,.1,i*.1,false);
 assert.ok(view.ambientFx&&view.ambientPool,'WebGL lazily allocates the ambient pool');
 assert.ok(spawned>0,'ambient motes spawn');
 assert.ok(view.ambientPool.slots.some(slot=>slot.active));
 assert.equal(view._updateAmbient(null,.1,9,true),0,'reduced motion emits nothing');
 const drawn=view.ambientPool.slots.filter(slot=>slot.active).length;
 view.renderer.isSoftware=true;
 assert.equal(view._updateAmbient(null,.1,9,false),0,'the CPU renderer emits nothing');
 assert.equal(view.ambientPool.slots.filter(slot=>slot.active).length,drawn,'the CPU guard adds no draw calls');
 const software=Object.assign(Object.create(ArenaView.prototype),{renderer:{isSoftware:true},scene:new T.Scene(),motionQuery:{matches:false},display:{...DEFAULT_DISPLAY},ambientConfig:view.ambientConfig});
 assert.equal(software._updateAmbient(null,.1,0,false),0);
 assert.ok(!software.ambientPool,'the CPU view never allocates the ambient pool');
 view.ambientPool.dispose();
});

test('wind sway is gated to WebGL, disabled by reduced motion and tagged to vegetation',t=>{
 const {view}=playable(t);
 const mesh=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial(),1);
 mesh.count=1;mesh.setMatrixAt(0,new T.Matrix4());
 mesh.userData.scatterWind={base:Float32Array.from(mesh.instanceMatrix.array),phase:new Float32Array([0]),amp:new Float32Array([.03])};
 view.scatterWind=[mesh];
 assert.ok(view._updateWind(1,false)>0,'WebGL sways the tagged vegetation');
 assert.equal(view._updateWind(1,true),0,'reduced motion freezes the sway');
 view.renderer.isSoftware=true;
 assert.equal(view._updateWind(1,false),0,'the CPU renderer never sways');
 view.renderer.isSoftware=false;view.scatterWind=[];
 assert.equal(view._updateWind(1,false),0,'no tagged vegetation means no work');
});

test('soccer net density follows the quality detail hint',()=>{
 const race={kind:'soccer',pitch:{minX:-30,maxX:30,minZ:-18,maxZ:18},goals:[{team:0,x:-30,z:0,nx:-1,nz:0,halfWidth:6,height:4,depth:2}]};
 const lattice=model=>{let count=0;model.traverse(node=>{if(node.userData.soccerNet)count+=node.geometry.attributes.position.count;});return count;};
 const high=raceTrackModel(race,'#55ddcc',undefined,undefined,{quality:{scatterDetail:1}});
 const low=raceTrackModel(race,'#55ddcc',undefined,undefined,{quality:{scatterDetail:.3}});
 assert.ok(lattice(high)>0&&lattice(low)>0,'both tiers build a net');
 assert.ok(lattice(low)<lattice(high),`low detail ${lattice(low)} < high detail ${lattice(high)}`);
 ArenaView.prototype.disposeObject.call({},high);ArenaView.prototype.disposeObject.call({},low);
});

test('the software next-gen prop detail stays within the CPU triangle budget',()=>{
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx});
 const props=[];for(let i=0;i<48;i++)props.push({type:i%3===0?'rock':i%3===1?'tree':'barrel',x:(i%8)*3-12,z:Math.floor(i/8)*3-6,y:0,seed:i+1});
 const build=software=>{
  const view=Object.assign(Object.create(ArenaView.prototype),{renderResources:new Set(),renderer:{isSoftware:software}}),world=new T.Group();
  view.buildNextGen(world,{color:'#55ddcc',terrain:{height:()=>0},structures:[],props});
  const scene=new T.Scene();scene.background=new T.Color('#000');scene.add(world);
  const camera=new T.PerspectiveCamera(90,320/180,.1,200);camera.position.set(0,7,18);camera.lookAt(0,0,0);
  renderer.render(scene,camera);
  const triangles=renderer.info.render.triangles;
  view.disposeObject(world);for(const resource of view.renderResources)resource.dispose();
  return triangles;
 };
 const low=build(true),high=build(false);
 assert.ok(low>0,'the software prop pass draws geometry');
 assert.ok(low<=high,`software props ${low} triangles <= WebGL props ${high}`);
 assert.ok(low<=200000,`software prop triangles ${low} stay bounded`);
});

test('quality tiers resolve from the renderer and pin through the display path',t=>{
 const {view}=fixture(t,{software:true});
 view._quality();
 assert.equal(view.quality,'low');
 assert.equal(view.qualityTier(),0);
 assert.equal(view._quality().decals,8);
 view.setQuality('high');
 assert.equal(view.quality,'high');
 assert.equal(view._quality().shadows,2);
 view.setDisplay({...DEFAULT_DISPLAY,quality:'medium'});
 assert.equal(view.quality,'medium','the display path pins a requested tier');
 assert.equal(view._quality().decals,14);
 const webgl=fixture(t).view;
 webgl._quality();
 assert.equal(webgl.quality,'high','a hardware renderer defaults to high');
 webgl.setDisplay({...DEFAULT_DISPLAY,reducedMotion:true});
 assert.equal(webgl.quality,'medium','reduced motion caps the auto tier at medium');
 webgl.setQuality(null);
 assert.equal(webgl._qualityOverride,null,'clearing the override unpins quality');
});

test('quality budgets drive decal, death and ambient pool sizes',t=>{
 const {view}=fixture(t);view.scene=new T.Scene();
 view.setQuality('low');
 view._spawnImpactDecal({x:0,y:0,z:0},false,0);
 assert.ok(view.decalPool,'a low tier still stamps decals');
 assert.equal(view.decalPool.limit,8,'the decal pool uses the low-tier slot count');
 const deaths=view.deathFx();
 assert.equal(deaths.limit,36);assert.equal(deaths.splatLimit,10);
 assert.equal(view._quality().ambientMotes,3);
 view.setQuality('high');
 view._spawnImpactDecal({x:1,y:0,z:1},false,0);
 assert.equal(view.decalPool.limit,8,'an existing pool keeps its allocation but is reused');
 assert.equal(view.deathFx().limit,36);
 view.decalPool.dispose();deaths.dispose();
});

test('the quality controller demotes on sustained low FPS, holds a cooldown, and recovers without pinning',t=>{
 const {view}=playable(t);
 view._quality();
 assert.equal(view.quality,'high');
 // A short slow spell must not demote; the governor requires sustained pressure.
 for(let i=0;i<5;i++)view._sampleQuality(.2);
 assert.equal(view.quality,'high','a short slow spell (1s) does not demote');
 for(let i=0;i<4;i++)view._sampleQuality(.2);
 assert.equal(view.quality,'medium','sustained slow frames (~1.8s) demote a tier');
 // Immediately after a change the cooldown blocks the next one.
 for(let i=0;i<15;i++)view._sampleQuality(.2);
 assert.equal(view.quality,'medium','the cooldown prevents one-second oscillation');
 assert.ok(view._qualityOverride==null,'the controller never pins quality');
 // A fresh view recovers one tier at a time from sustained fast frames.
 const fast=playable(t).view;fast._quality();fast._qualityState={level:'low',bad:0,good:0,cool:0};fast.quality='low';
 for(let i=0;i<400;i++)fast._sampleQuality(.008);
 assert.notEqual(fast.quality,'low','sustained fast frames recover quality');
 assert.ok(fast._qualityOverride==null,'recovery never pins quality');
});

test('the weapon preview mounts a real weapon through ModelAssets and disposes exactly once',()=>{
 const view=Object.create(ArenaView.prototype);
 const rig=view.mountWeaponPreview({type:2});
 assert.ok(rig,'the view exposes a preview rig');
 assert.ok(rig.model&&rig.model.userData.type===2,'the preview builds the requested weapon');
 const box=new T.Box3().setFromObject(rig.model),center=box.getCenter(new T.Vector3());
 assert.ok(Math.abs(center.x)<.05&&Math.abs(center.y)<.05&&Math.abs(center.z)<.05,'the preview recenters the weapon on the turntable');
 const shared=rig.assets.resources;
 assert.ok(shared.size>0,'the preview reuses the shared ModelAssets registry');
 const sharedCounts=[...shared].map(()=>0);[...shared].forEach((r,i)=>r.addEventListener('dispose',()=>sharedCounts[i]++));
 view.unmountWeaponPreview();
 assert.ok(sharedCounts.every(c=>c===0),'unmounting keeps shared assets alive');
 assert.equal(rig.model,null,'unmounting releases the preview model');
 rig.mount({type:3});
 assert.equal(rig.model.userData.type,3,'switching weapons rebuilds the preview');
 const owned=new Set();rig.model.traverse(n=>{if(n.geometry&&!shared.has(n.geometry))owned.add(n.geometry);if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])if(!shared.has(m))owned.add(m);});
 const ownedCounts=[...owned].map(()=>0);[...owned].forEach((r,i)=>r.addEventListener('dispose',()=>ownedCounts[i]++));
 rig.dispose();
 assert.ok(ownedCounts.every(c=>c===1),'dispose releases each preview-owned resource exactly once');
 assert.ok(sharedCounts.every(c=>c===0),'a rig never disposes assets it does not own');
 view.previewAssets.dispose();
 assert.ok(sharedCounts.every(c=>c===1),'the view releases the shared preview assets exactly once');
 view.preview=null;view.previewAssets=null;
});

test('the weapon preview pose is deterministic and freezes under reduced motion',()=>{
 const view=Object.create(ArenaView.prototype);
 const rig=view.mountWeaponPreview({type:0});
 const a=view.updateWeaponPreview(2,{reduced:false}),b=view.updateWeaponPreview(2,{reduced:false});
 assert.deepEqual(a,b,'the same time reproduces the preview pose');
 const frozen=view.updateWeaponPreview(10,{reduced:true}),frozenLater=view.updateWeaponPreview(99,{reduced:true});
 assert.deepEqual(frozen,frozenLater,'reduced motion pins the preview');
 assert.equal(view.updateWeaponPreview(1,{visible:false}).pivot.visible,false,'visibility is applied without breaking the pose');
 assert.equal(view.updateWeaponPreview(1,{visible:true}).pivot.visible,true);
 rig.dispose();view.preview=null;
});

test('the preview rect resizes the inspect camera without touching the gameplay camera',t=>{
 const {view}=fixture(t);
 const rig=view.mountWeaponPreview({type:1,rect:{left:10,bottom:20,width:320,height:180}});
 assert.equal(rig.camera.aspect,320/180,'the inspect camera matches the mount rect');
 view.updateWeaponPreview(1,{reduced:false});
 assert.equal(view.camera.aspect,1,'the gameplay camera is untouched');
 rig.dispose();
});

test('the weapon preview renders into its mount rect through the shared renderer',t=>{
 const {view,renderer}=fixture(t);
 view.width=800;view.height=450;
 const calls=[];renderer.autoClear=true;
 renderer.setScissorTest=v=>calls.push(['scissorTest',v]);
 renderer.setViewport=(...a)=>calls.push(['viewport',...a]);
 renderer.setScissor=(...a)=>calls.push(['scissor',...a]);
 renderer.render=(scene,camera)=>calls.push(['render',scene===view.preview.scene,camera===view.preview.camera]);
 view.mountWeaponPreview({type:0,rect:{left:10,bottom:20,width:320,height:180}});
 assert.equal(view.renderWeaponPreview(),true,'the preview renders into the mount rect');
 assert.deepEqual(calls[0],['scissorTest',true]);
 assert.deepEqual(calls[1],['viewport',10,430,320,180],'the viewport is derived from the CSS rect');
 assert.deepEqual(calls[2],['scissor',10,430,320,180]);
 assert.deepEqual(calls[3],['render',true,true]);
 assert.ok(calls.some(call=>call[0]==='scissorTest'&&call[1]===false),'scissor testing is disabled again');
 assert.deepEqual(calls.at(-2),['viewport',0,0,800,450],'the full viewport is restored');
 assert.deepEqual(calls.at(-1),['scissor',0,0,800,450]);
 view.previewRect=null;
 assert.equal(view.renderWeaponPreview(),false,'no mount rect means no preview draw');
 view.previewRect={left:0,bottom:0,width:4,height:4};
 assert.equal(view.renderWeaponPreview(),false,'a tiny rect is ignored');
 view.previewRect={left:0,bottom:0,width:320,height:180};
 view.renderer={isSoftware:true};
 assert.equal(view.renderWeaponPreview(),false,'a software renderer never previews');
 view.preview.dispose();view.preview=null;
});

test('hit reactions are deterministic, directional and gated off the CPU renderer',t=>{
 const {view,renderer}=playable(t);
 view.scene=new T.Scene();view.actorModels=new Map([[7,new T.Group()]]);
 const event={type:'damage',id:5,actor:7,amount:20,seed:3,direction:{x:1,z:0},pos:{x:0,y:1,z:0}};
 const first=view.applyHitReaction(event,false);
 assert.ok(first&&first.strength>0,'a hit produces a reaction');
 const copy={...event};
 view.applyHitReaction(copy,false);
 assert.deepEqual(copy,event,'the authoritative event is never mutated');
 assert.ok(view.hitPool&&view.hitPool.slots.some(s=>s.active),'WebGL spawns directional feedback');
 renderer.isSoftware=true;
 const before=view.hitPool.slots.filter(s=>s.active).length;
 view.applyHitReaction({...event,id:6,pos:{x:3,y:1,z:0}},false);
 assert.equal(view.hitPool.slots.filter(s=>s.active).length,before,'the CPU renderer spawns no hit feedback');
 const reduced=view.applyHitReaction({...event,id:7},true);
 assert.equal(reduced.lean,0,'reduced motion drops the flinch');
 assert.ok(view._updateHitReactions(.016)>=0);
 // Knockback is re-applied while the hit is live, then the flinch expires.
 const pushed=view.actorModels.get(7).position.x;
 view._updateHitReactions();
 assert.ok(view.actorModels.get(7).position.x>=pushed,'the flinch keeps nudging the model');
 view.hitFlinch.set(7,{strength:.5,until:0,lean:.2,pushX:.1,pushZ:0});
 assert.equal(view._updateHitReactions(),0,'an expired flinch is dropped');
 assert.equal(view.hitFlinch.has(7),false);
 view.hitPool.dispose();
});

test('storm weather schedules lightning, plays thunder and applies a wet sheen on WebGL',t=>{
 const {view}=playable(t);
 view.scene.userData.sky={background:'#090f17',phase:'night',seed:1};
 view._arenaLook={background:'#090f17',fog:'#090f17',fogDensity:.018,exposure:1.15};
 view._arenaLight={hemi:1.8,sun:2.4,hemiColor:new T.Color('#8da5b1'),sunColor:new T.Color('#8da5b1'),groundColor:new T.Color('#20364f')};
 view.worldGroup=new T.Group();
 const floor=new T.Mesh(new T.BoxGeometry(4,.5,4),new T.MeshStandardMaterial({color:'#888888',roughness:.9,metalness:0}));
 view.worldGroup.add(floor);
 let thunder=0;view.viewAudio={thunder(){thunder++;}};
 view.setWeather('storm');view.initWeather({id:'aether',background:'#090f17'});
 view._updateWeather({id:'aether',background:'#090f17'},.016,'playing');
 assert.ok(view._lightningSchedule().length>0,'the storm builds a deterministic strike schedule');
 let fired=0;for(let i=0;i<200;i++)fired+=view._updateLightning(.05,false,false);
 assert.ok(fired>0,'strikes fire across the window');
 // A long storm loops its schedule instead of falling silent after the window.
 let later=0;for(let i=0;i<4000;i++)later+=view._updateLightning(.05,false,false);
 assert.ok(later>0,'a storm past its first window keeps striking');
 assert.ok(thunder>0,'fired strikes schedule thunder');
 assert.ok(view._flash>=0&&view._flash<=1,'the flash envelope stays bounded');
 assert.equal(view.scene.userData.sky.wet>0,true,'the storm marks the sky wet');
 const authoredExposure=view._arenaLook.exposure;
 view.renderer.toneMappingExposure=authoredExposure;
 view._applyLightningFlash(1);
 assert.ok(view.renderer.toneMappingExposure>authoredExposure,'a flash brightens the exposure');
 view._flashApplied=1;view._applyLightningFlash(0);
 assert.equal(view.renderer.toneMappingExposure,authoredExposure,'the flash restores the authored exposure');
 assert.equal(view._applyWetSheen(view._weatherState()),true,'the first wet pass applies');
 const base=floor.material.userData.wetBase;
 assert.ok(floor.material.roughness<base.roughness,'wet floors are smoother');
 assert.equal(view._applyWetSheen(view._weatherState()),false,'an unchanged wetness band is a no-op');
 view.setWeather('clear');view._updateWeather({id:'aether',background:'#090f17'},3,'playing');
 view._weatherState().wetness=0;
 assert.equal(view._applyWetSheen(view._weatherState()),true,'drying re-applies the dry look');
 assert.ok(Math.abs(floor.material.roughness-base.roughness)<1e-9,'a fully dry surface matches its authored roughness');
});

test('the CPU renderer gets a cheap lightning pass with no thunder',t=>{
 const {view,renderer}=playable(t);renderer.isSoftware=true;
 view.scene.userData.sky={background:'#090f17',phase:'night',seed:1};
 view.setWeather('storm');view.initWeather({id:'aether',background:'#090f17'});
 let thunder=0;view.viewAudio={thunder(){thunder++;}};
 let fired=0;for(let i=0;i<200;i++)fired+=view._updateLightning(.05,false,true);
 assert.ok(fired>0,'the CPU renderer still flashes');
 assert.equal(thunder,0,'the CPU renderer never schedules thunder');
 assert.equal(view._applyWetSheen(view._weatherState()),false,'the CPU renderer skips the wet sheen');
});

test('wind gusts drive vegetation sway and ambient drift deterministically',t=>{
 const {view}=playable(t);
 view.ambientConfig=ambientProfile({id:'foundry'},'day');
 view.ambientAnchors=[];
 view.setWeather('storm');view.initWeather({id:'aether',background:'#090f17'});
 assert.ok(view.windGust(3)>=.4&&view.windGust(3)<=1.7);
 assert.equal(view.windGust(3),view.windGust(3),'the gust is a pure function of time');
 const mesh=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial(),1);
 mesh.count=1;mesh.setMatrixAt(0,new T.Matrix4());
 mesh.userData.scatterWind={base:Float32Array.from(mesh.instanceMatrix.array),phase:new Float32Array([0]),amp:new Float32Array([.03])};
 view.scatterWind=[mesh];
 assert.ok(view._updateWind(2,false)>0,'gusty wind still sways vegetation');
 assert.ok(view._updateAmbient(null,.1,2,false)>=0,'ambient drift accepts the gust without throwing');
 view.ambientPool?.dispose();
});

test('the view forwards the mode theme and the victory/defeat sting to audio',t=>{
 const {view}=playable(t);
 const calls=[];view.viewAudio={setModeTheme(mode){calls.push(['mode',mode]);return mode;},sting(outcome){calls.push(['sting',outcome]);return {outcome,played:true};}};
 view.setAudio(view.viewAudio);
 view.buildArena=()=>{};view.clearObjectiveMarkers=()=>{};view.syncVehicles=()=>{};view.updateFlags=()=>{};view.updateObjectives=()=>{};view._trackAssets=()=>{};
 view.actorModels=new Map();view.pickupModels=[];view.flagModels=new Map();view.vehicleModels=new Map();view.modelAssets=new ModelAssets();view.mapId=MAPS[0].id;
 view.setMatch({arena:MAPS[0],config:{mode:'ctf'},actors:[],pickups:[],vehicles:[]});
 assert.deepEqual(calls[0],['mode','ctf'],'setMatch forwards the mode theme');
 assert.equal(view.setOutcome('victory').played,true);
 assert.deepEqual(calls.at(-1),['sting','victory']);
 assert.equal(view.setOutcome('bogus'),null,'an unknown outcome is ignored');
});

test('the software renderer receives a finite triangle budget from the quality tier',t=>{
 const {view,renderer}=fixture(t,{software:true});
 const budgets=[];renderer.setTriangleBudget=budget=>{budgets.push(budget);return budget;};
 view._applyQuality();
 assert.ok(budgets.length>0,'the software renderer is given a budget');
 assert.ok(Number.isFinite(budgets.at(-1))&&budgets.at(-1)>0,'the budget is finite and positive');
 const low=budgets.at(-1);
 view.setQuality('high');
 assert.ok(budgets.at(-1)>=low,'a higher tier raises the CPU triangle ceiling');
 const webgl=fixture(t).view;
 const webglRenderer=webgl.renderer;let called=0;webglRenderer.setTriangleBudget=()=>{called++;};
 webgl._applyQuality();
 assert.equal(called,0,'the WebGL renderer is never given a CPU triangle cap');
});

test('death debris spin and splay options are deterministic, bounded and opt-in',()=>{
 const mk=()=>({children:[],add(o){this.children.push(o);},remove(o){const i=this.children.indexOf(o);if(i>=0)this.children.splice(i,1);}});
 const a=new DeathPool(mk(),6,2),b=new DeathPool(mk(),6,2);
 a.spawn({x:0,y:0,z:0},{pieces:5,force:6,seed:3,spin:1.4,splay:1});
 b.spawn({x:0,y:0,z:0},{pieces:5,force:6,seed:3,spin:1.4,splay:1});
 assert.deepEqual(a.slots.map(s=>s.spin),b.slots.map(s=>s.spin),'debris spin is deterministic for a seed');
 assert.ok(a.slots.every(s=>Math.abs(s.spin.x)<=14&&Math.abs(s.spin.y)<=14&&Math.abs(s.spin.z)<=14),'spin stays bounded');
 const flat=new DeathPool(mk(),6,2);
 flat.spawn({x:0,y:0,z:0},{pieces:5,force:6,seed:3,spin:0,splay:0});
 assert.ok(flat.slots.every(s=>s.spin.x===0&&s.spin.y===0&&s.spin.z===0),'a zero tumble multiplier removes angular motion');
 const defaults=new DeathPool(mk(),6,2);
 assert.equal(defaults.spawn({x:0,y:0,z:0},{pieces:5,force:6,seed:3}),5,'the new options keep the old default call signature');
 a.dispose();b.dispose();flat.dispose();defaults.dispose();
});
