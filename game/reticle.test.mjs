import test from 'node:test';
import assert from 'node:assert/strict';
import {WEAPONS} from './data.mjs';
import {weaponModel} from './view.mjs';
import {BUILTIN_SIGHT,resolveActiveSight,adsFieldOfView,sightFovFloor,reticleWarp} from './reticle.mjs';

test('the built-in sight table matches the real weapon models',()=>{
 for(let type=0;type<WEAPONS.length;type++){
  const model=weaponModel(type);
  const kind=model.userData.sights?.kind||'iron';
  assert.equal(BUILTIN_SIGHT[type],kind,`${WEAPONS[type]?.name||type}: resolver says ${BUILTIN_SIGHT[type]}, model ships ${kind}`);
  model.traverse(n=>{if(n.geometry)n.geometry.dispose?.();if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])m.dispose?.();});
 }
});

test('built-in rail-lance and marksman scopes resolve without an optic and magnify',()=>{
 for(const type of [2,8]){
  const sight=resolveActiveSight({weapon:type});
  assert.equal(sight.kind,'scope',`${WEAPONS[type].name} has an integrated scope`);
  assert.ok(sight.magnification>1.5,`${WEAPONS[type].name} magnifies (${sight.magnification})`);
  assert.equal(sight.reticle,'cross');
  assert.equal(sight.lensWarp,true);
 }
 assert.ok(resolveActiveSight({weapon:2}).magnification>resolveActiveSight({weapon:8}).magnification,'the rail lance zooms harder than the marksman rifle');
});

test('irons and holos use a dot reference and never magnify beyond 1x',()=>{
 for(const type of [0,1,3,4,5,6,7,9]){
  const iron=resolveActiveSight({weapon:type});
  assert.equal(iron.kind,'iron');
  assert.equal(iron.reticle,'dot');
  assert.equal(iron.magnification,1);
  const holo=resolveActiveSight({weapon:type,optic:'holo'});
  assert.equal(holo.kind,'holo');
  assert.equal(holo.reticle,'dot');
  assert.equal(holo.magnification,1);
 }
});

test('a mounted scope is a middle magnification and never downgrades an integrated scope',()=>{
 const attached=resolveActiveSight({weapon:0,optic:'scope'});
 assert.equal(attached.kind,'scope');
 assert.ok(attached.magnification>1.5&&attached.magnification<2.8,`attached scope magnifies modestly (${attached.magnification})`);
 const onRail=resolveActiveSight({weapon:2,optic:'scope'});
 assert.equal(onRail.magnification,resolveActiveSight({weapon:2}).magnification,'the stronger integrated optic wins');
 const holoOnScope=resolveActiveSight({weapon:8,optic:'holo'});
 assert.equal(holoOnScope.kind,'scope','a holo never downgrades an integrated scope');
});

test('ADS field of view keeps the mild iron pull-in and zooms scopes hard',()=>{
 const iron=resolveActiveSight({weapon:0}),scope=resolveActiveSight({weapon:2});
 const ironFov=adsFieldOfView(80,iron);
 assert.ok(ironFov>=55&&ironFov<80,'iron ADS pulls in mildly but never below 55');
 assert.equal(adsFieldOfView(50,iron),55,'the iron floor still holds at a narrow base FOV');
 const scopeFov=adsFieldOfView(80,scope);
 assert.ok(scopeFov<30,`the rail scope zooms hard (${scopeFov.toFixed(1)})`);
 assert.ok(adsFieldOfView(80,resolveActiveSight({weapon:8}))>scopeFov,'the marksman zooms less than the rail lance');
 assert.ok(adsFieldOfView(80,resolveActiveSight({weapon:0,optic:'scope'}))>scopeFov,'an attached scope zooms less than the rail lance');
 assert.equal(adsFieldOfView(60,scope,{scopeFloor:20}),20,'the scope floor clamps the zoom');
 assert.equal(sightFovFloor(scope),12);
 assert.equal(sightFovFloor(iron),55);
});

test('reticle warp is scope-only, grows with magnification and stays bounded',()=>{
 assert.equal(reticleWarp(resolveActiveSight({weapon:0})),0);
 assert.equal(reticleWarp(resolveActiveSight({weapon:0,optic:'holo'})),0);
 const rail=reticleWarp(resolveActiveSight({weapon:2}));
 const marksman=reticleWarp(resolveActiveSight({weapon:8}));
 assert.ok(rail>0&&rail<=5,'the rail warp is bounded');
 assert.ok(marksman>0&&marksman<=5);
 assert.ok(rail>=marksman,'more magnification means more warp');
 assert.ok(reticleWarp({kind:'scope',magnification:999})<=5,'warp is capped');
});
