import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaView,weaponModel} from './view.mjs';
import {WEAPONS} from './data.mjs';

test('every weapon exposes named anchors and a sight-derived ADS transform',()=>{
 for(let type=0;type<WEAPONS.length;type++){
  const model=weaponModel(type),anchors=model.userData.anchors;
  for(const name of ['muzzle','rearSight','frontSight','leftGrip','rightGrip','magazine','bolt','hinge'])assert.ok(anchors?.[name],`${type} exposes the ${name} anchor`);
  const aim=model.userData.aim;
  assert.ok(aim&&Number.isFinite(aim.pitch),`${type} derives an ADS pitch`);
  assert.ok(Math.abs(aim.position.x-(-anchors.rearSight.position.x))<1e-9,'ADS x is derived from the rear sight');
  assert.ok(Math.abs(aim.position.y-(-anchors.rearSight.position.y))<1e-9,'ADS y is derived from the rear sight');
  assert.notEqual(anchors.rearSight.position.z,anchors.frontSight.position.z,`${type} has a front/rear sight separation`);
  ArenaView.prototype.disposeObject.call({},model);
 }
});

test('ADS positions differ per weapon instead of one shared offset',()=>{
 const ys=[],xs=[];
 for(let type=0;type<WEAPONS.length;type++){const model=weaponModel(type);ys.push(model.userData.aim.position.y.toFixed(3));xs.push(model.userData.aim.position.z.toFixed(3));ArenaView.prototype.disposeObject.call({},model);}
 assert.ok(new Set(ys).size>1,'weapons do not all share one ADS height');
 assert.ok(new Set(xs).size>1,'weapons do not all share one ADS depth');
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
 assert.ok(bolt.position.z<baseZ,'the bolt retracts on the shot kick');
 view._animateWeaponParts(model,{weapon:0,reloading:false},true);
 assert.equal(bolt.position.z,baseZ,'reduced motion holds the bolt still');
 ArenaView.prototype.disposeObject.call({},model);
});
