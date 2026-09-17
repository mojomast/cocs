import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView} from './view.mjs';
import {mothEffectTextures, mothMaterialLutTexture, clearSurfaceTextures} from './textures.mjs';
import {configureMothAssets, resetMothAssets} from './moth-assets.mjs';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

const fixture = () => ({
  version: 1,
  textures: {},
  normals: {},
  materials: { entanglement: { size: 2, r: b64(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), t: b64(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4])) } },
  sky: { void: { width: 2, height: 2, equirect: true, data: b64(Uint8Array.from([5, 10, 20, 255, 6, 11, 21, 255, 7, 12, 22, 255, 8, 13, 23, 255])) } },
  effects: {
    'spark-impact': { fps: 14, frames: [
      { width: 2, height: 2, data: b64(Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255])) },
      { width: 2, height: 2, data: b64(Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255])) },
    ] },
  },
  levels: {}, seeds: {}, motifs: {},
});

test('effect frames and LUTs are shared caches marked for the disposal traversal', () => {
  configureMothAssets(fixture());
  try {
    const effect = mothEffectTextures('spark-impact');
    assert.ok(effect && effect.textures.length === 2);
    assert.equal(mothEffectTextures('spark-impact'), effect, 'frames are cached per name');
    for (const frame of effect.textures) assert.equal(frame.userData.mothShared, true);
    const lut = mothMaterialLutTexture('entanglement');
    assert.ok(lut);
    assert.equal(mothMaterialLutTexture('entanglement'), lut, 'the same LUT is shared');
    assert.equal(lut.userData.mothShared, true);
    clearSurfaceTextures();
    assert.notEqual(mothEffectTextures('spark-impact'), effect, 'clearing the surface cache drops the frames');
    assert.notEqual(mothMaterialLutTexture('entanglement'), lut, 'clearing the surface cache drops the LUT');
  } finally {
    resetMothAssets();
    clearSurfaceTextures();
  }
});

test('disposeObject never releases a shared Moth texture', () => {
  const shared = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  shared.userData.mothShared = true;
  const owned = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  let sharedDisposed = 0, ownedDisposed = 0;
  shared.addEventListener('dispose', () => sharedDisposed++);
  owned.addEventListener('dispose', () => ownedDisposed++);
  const group = new T.Group();
  group.add(new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shared })));
  group.add(new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: owned })));
  ArenaView.prototype.disposeObject.call({}, group);
  assert.equal(sharedDisposed, 0, 'the shared cache texture survives object disposal');
  assert.equal(ownedDisposed, 1, 'an object-owned texture is still released');
});
