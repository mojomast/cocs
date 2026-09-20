import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView,weaponModel,WeaponInertia,RELOAD_TIMING} from './view.mjs';
import {WEAPONS} from './data.mjs';

test('every weapon exposes named anchors and a solved, sight-aligned ADS transform',()=>{
 for(let type=0;type<WEAPONS.length;type++){
  const model=weaponModel(type),anchors=model.userData.anchors;
  for(const name of ['muzzle','rearSight','frontSight','leftGrip','rightGrip','magazine','bolt','hinge'])assert.ok(anchors?.[name],`${type} exposes the ${name} anchor`);
  const aim=model.userData.aim;
  assert.ok(aim&&Number.isFinite(aim.pitch),`${type} derives an ADS pitch`);
  assert.ok(aim.quaternion&&Number.isFinite(aim.quaternion.w),`${type} solves an ADS rotation`);
  assert.notEqual(anchors.rearSight.position.z,anchors.frontSight.position.z,`${type} has a front/rear sight separation`);
  // The solver must place the real rear aperture on the weapon-camera center
  // ray at the fixed eye relief and point the bore down -Z.
  const err=model.userData.sightError;
  assert.ok(err,`${type} records a sight alignment error`);
  assert.ok(err.rearError<1e-6,`${type} rear aperture lands on the center ray (error ${err.rearError})`);
  assert.ok(err.angleError<1e-6,`${type} bore aligns with the camera forward axis (error ${err.angleError})`);
  assert.ok(err.lateral<1e-6,`${type} front tip stays centered (lateral ${err.lateral})`);
  ArenaView.prototype.disposeObject.call({},model);
 }
});

test('ADS positions differ per weapon instead of one shared offset',()=>{
 const ys=[],poses=[];
 for(let type=0;type<WEAPONS.length;type++){const model=weaponModel(type);ys.push(model.userData.aim.position.y.toFixed(3));poses.push([model.userData.aim.position.x,model.userData.aim.position.y,model.userData.aim.position.z].map(v=>v.toFixed(3)).join(','));ArenaView.prototype.disposeObject.call({},model);}
 assert.ok(new Set(ys).size>1,'weapons do not all share one ADS height');
 // The body distance is deliberately shared for consistent framing, but the
 // solved translation still differs per weapon through the aperture height.
 assert.ok(new Set(poses).size>1,'weapons do not all share one ADS pose');
});

test('reload progress drives the real magazine, barrel and energy-cell parts',()=>{
 const view=Object.create(ArenaView.prototype);view.feedback={kick:0};
 const smg=weaponModel(9),mag=smg.userData.parts.magazine;
 assert.ok(mag,'the SMG exposes its magazine group');
 const baseY=mag.position.y;
 view._animateWeaponParts(smg,{weapon:9,reloading:true,reloadTimer:.7,reloadDuration:1.4},false);
 assert.ok(mag.position.y<baseY,'the magazine drops during the reload');
 view._animateWeaponParts(smg,{weapon:9,reloading:false},false);
 view._animateWeaponParts(smg,{weapon:9,reloading:true,reloadTimer:.7,reloadDuration:1.4},true);
 assert.equal(mag.position.y,baseY,'reduced motion holds the magazine static');
 // The Pulse Rifle has no reload part to move, so its anchor stays put.
 const pulse=weaponModel(0),pulseAnchor=pulse.userData.anchors.magazine;
 view._animateWeaponParts(pulse,{weapon:0,reloading:true,reloadTimer:.5,reloadDuration:1},false);
 assert.equal(pulseAnchor.position.y,pulseAnchor.userData.baseY,'the infinite-ammo rifle invents no reload motion');
 // Rail Lance energy cell spins through the reload.
 const rail=weaponModel(2),cell=rail.userData.parts.cell;
 assert.ok(cell,'the Rail Lance exposes its energy cell');
 view._animateWeaponParts(rail,{weapon:2,reloading:true,reloadTimer:.55,reloadDuration:1.1},false);
 assert.ok(cell.rotation.z>0,'the energy cell cycles during the reload');
 [smg,pulse,rail].forEach(model=>ArenaView.prototype.disposeObject.call({},model));
});

test('the bolt cycles from the authoritative shot kick and resets under reduced motion',()=>{
 const view=Object.create(ArenaView.prototype);view.feedback={kick:.8};
 const model=weaponModel(0),bolt=model.userData.anchors.bolt,baseZ=bolt.position.z;
 view._animateWeaponParts(model,{weapon:0,reloading:false},false);
 // Model -Z is muzzle; rearward carrier travel is therefore positive Z.
 assert.ok(bolt.position.z>baseZ&&bolt.position.z<=baseZ+.05,'the bolt retracts toward the stock within its carrier stroke');
 view._animateWeaponParts(model,{weapon:0,reloading:false},true);
 assert.equal(bolt.position.z,baseZ,'reduced motion holds the bolt still');
 ArenaView.prototype.disposeObject.call({},model);
});

test('viewmodel inertia lags look, is bounded and snaps under reduced motion',()=>{
 const inertia=new WeaponInertia();
 inertia.update({dt:1/60,yaw:0,pitch:0});
 let frame=null;
 for(let i=0;i<120;i++)frame=inertia.update({dt:1/60,yaw:i*.05,pitch:i*.02});
 assert.ok(Math.abs(frame.yaw)<=.061&&Math.abs(frame.pitch)<=.051,`bounded lag (${frame.yaw}, ${frame.pitch})`);
 assert.ok(Math.abs(frame.yaw)>1e-4&&Math.abs(frame.pitch)>1e-4,'a continuous turn produces lag');
 assert.ok(Math.abs(frame.offsetX)<=.014&&Math.abs(frame.offsetY)<=.011&&frame.offsetZ>=0,'the composed offsets are bounded');
 const teleport=inertia.update({dt:1/60,yaw:1e6,pitch:-1e6});
 assert.ok(Math.abs(teleport.yaw)<=.061&&Math.abs(teleport.pitch)<=.051,'a look teleport stays bounded');
 const snapped=inertia.update({dt:1/60,yaw:2,pitch:1,reduced:true});
 assert.ok(Object.values(snapped).every(value=>value===0),'reduced motion zeroes every inertia output');
 assert.equal(inertia.yaw.pos,0);
 assert.equal(inertia.pitch.pos,0);
});

test('support hand follows the reload part, per-weapon bolts cycle and reduced motion rests everything',()=>{
 const view=Object.create(ArenaView.prototype);view.feedback={kick:0,channels:{punch:{pitch:0}}};view.hands=new T.Group();view.hands.visible=true;view._adsTransition=0;
 const smg=weaponModel(9),support=smg.userData.supportHand,mag=smg.userData.parts.magazine;
 assert.ok(support,'the viewmodel exposes a support-hand node');
 assert.equal(support.visible,false,'the support hand waits hidden at rest');
 view._animateWeaponParts(smg,{weapon:9,reloading:true,reloadTimer:.5,reloadDuration:1,yaw:0,pitch:0},false,.016);
 assert.equal(support.visible,true,'the support hand appears for the reload');
 assert.notEqual(support.position.z,support.userData.baseZ,'the support hand travels with the magazine');
 assert.ok(mag.position.y<mag.userData.baseY,'the magazine still drops');
 assert.ok(RELOAD_TIMING.length===WEAPONS.length,'every weapon has a reload timing row');
 // The marksman carrier cycles through its own reload window even with no shot kick.
 const marksman=weaponModel(8),bolt=marksman.userData.anchors.bolt;
 view._animateWeaponParts(marksman,{weapon:8,reloading:true,reloadTimer:.5,reloadDuration:1,yaw:0,pitch:0},false,.016);
 assert.ok(bolt.position.z>bolt.userData.baseZ,'the marksman bolt cycles on the reload');
 assert.ok(bolt.position.z-bolt.userData.baseZ<=.05,'the reload carrier stroke stays inside its budget');
 // The rail cell turns through more than one revolution over its own window.
 const rail=weaponModel(2);
 view._animateWeaponParts(rail,{weapon:2,reloading:true,reloadTimer:.5,reloadDuration:1,yaw:0,pitch:0},false,.016);
 assert.ok(rail.userData.parts.cell.rotation.z>Math.PI,'the rail cell spins through the reload');
 // Inertia composes onto the live hands pose and stays bounded. The ADS
 // compose resets the base quaternion every frame, so the test emulates that.
 let yaw=0;
 for(let i=0;i<60;i++){yaw+=.06;view.hands.quaternion.identity();view._animateWeaponParts(smg,{weapon:9,reloading:false,yaw,pitch:0},false,.016);}
 assert.ok(view.hands.quaternion.angleTo(new T.Quaternion())>1e-4,'inertia composes onto the hands pose');
 assert.ok(view.hands.quaternion.angleTo(new T.Quaternion())<.2,'the composed lag is bounded');
 // Reduced motion: parts rest, the support hand hides and the springs snap.
 view.hands.quaternion.identity();
 view._animateWeaponParts(smg,{weapon:9,reloading:true,reloadTimer:.5,reloadDuration:1,yaw:0,pitch:0},true,.016);
 assert.equal(support.visible,false);
 assert.equal(support.position.z,support.userData.baseZ);
 assert.equal(mag.position.y,mag.userData.baseY);
 assert.equal(view._weaponInertia.yaw.pos,0,'reduced motion snaps the inertia spring');
 assert.equal(view.hands.quaternion.angleTo(new T.Quaternion()),0,'reduced motion writes no lag');
 [smg,marksman,rail].forEach(model=>ArenaView.prototype.disposeObject.call({},model));
});
