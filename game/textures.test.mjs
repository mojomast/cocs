import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceTextures,clearSurfaceTextures,wetSheenTexture} from './textures.mjs';

const withDocument = t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const ctx = {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{createElement:()=>({width:0,height:0,getContext:()=>ctx})}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
};

test('surface textures cache by key and are disposed exactly once on clear', t => {
  withDocument(t);
  const first = surfaceTextures('rock', {seed:3, repeat:[1,1]});
  assert.ok(first.map && first.normalMap && first.roughnessMap, 'all three maps are generated');
  assert.equal(surfaceTextures('rock', {seed:3, repeat:[1,1]}), first, 'identical requests reuse the cache');
  let disposed = 0;
  for (const texture of Object.values(first)) texture.addEventListener('dispose', () => disposed++);
  clearSurfaceTextures();
  assert.equal(disposed, 3, 'clearing disposes every cached map exactly once');
  assert.notEqual(surfaceTextures('rock', {seed:3, repeat:[1,1]}), first, 'cleared entries are rebuilt');
  clearSurfaceTextures();
});

test('surface textures return null without a document', () => {
  assert.equal(surfaceTextures('concrete'), null);
  assert.equal(wetSheenTexture(), null);
});

test('the wet sheen overlay caches by key and is disposed with the surface cache', t => {
  withDocument(t);
  const first = wetSheenTexture({ seed: 3 });
  assert.ok(first, 'the wet overlay is generated with a document');
  assert.equal(first.userData.surfaceKind, 'wet');
  assert.equal(wetSheenTexture({ seed: 3 }), first, 'identical requests reuse the cache');
  assert.notEqual(wetSheenTexture({ seed: 4 }), first, 'a new seed builds a distinct overlay');
  let disposed = 0;
  first.addEventListener('dispose', () => disposed++);
  clearSurfaceTextures();
  assert.equal(disposed, 1, 'clearing the surface cache releases the wet overlay exactly once');
  assert.notEqual(wetSheenTexture({ seed: 3 }), first, 'cleared overlays are rebuilt');
  clearSurfaceTextures();
});
