import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {MothSpritePlayer} from './moth-sprite.mjs';

// Frame textures are caller-owned and shared (textures.mjs caches them), so the
// player tests only need tiny stand-ins: the player must never dispose them.
function fakeFrames(count = 3) {
  return Array.from({ length: count }, (_, index) => {
    const texture = new T.DataTexture(new Uint8Array([index, 0, 0, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  });
}

test('sprite player cycles frames, fades and retires a slot', () => {
  const frames = fakeFrames(3);
  const player = new MothSpritePlayer({ name: 'spark', frames, fps: 10, slots: 2, opacity: 0.8 });
  const slot = player.spawn({ x: 1, y: 2, z: 3 }, { size: 2, life: 0.3 });
  assert.ok(slot, 'a spawn returns its slot');
  assert.equal(player.active, 1);
  assert.equal(slot.mesh.visible, true);
  assert.deepEqual(slot.mesh.position.toArray(), [1, 2, 3]);
  assert.equal(slot.mesh.scale.x, 2);

  player.update(0.05);
  assert.equal(slot.index, 0, 'first frame while young');
  assert.ok(slot.material.opacity > 0.5, 'opacity starts near the configured value');
  player.update(0.11);
  assert.equal(slot.index, 1, 'middle frame at 160ms');
  player.update(0.11);
  assert.equal(slot.index, 2, 'final frame holds');
  player.update(0.05);
  assert.equal(player.active, 0, 'expired slots retire');
  assert.equal(slot.mesh.visible, false);
});

test('a full pool reuses the slot with the least remaining life', () => {
  const player = new MothSpritePlayer({ frames: fakeFrames(2), fps: 10, slots: 2, opacity: 0.7 });
  const first = player.spawn({ x: 0, y: 0, z: 0 });
  const second = player.spawn({ x: 1, y: 0, z: 0 });
  assert.notEqual(first, second);
  player.update(0.05);
  const reused = player.spawn({ x: 2, y: 0, z: 0 });
  assert.equal(reused, first, 'the oldest slot is overwritten');
  assert.equal(player.slots.length, 2, 'the pool never grows');
});

test('reduced motion freezes the frame index and growth', () => {
  const player = new MothSpritePlayer({ frames: fakeFrames(3), fps: 10, slots: 1 });
  const slot = player.spawn({ x: 0, y: 0, z: 0 }, { life: 1, grow: 2 });
  player.update(0.1);
  player.update(0.1);
  player.update(0.05);
  assert.equal(slot.index, 2, 'normal motion advances to the last frame');
  assert.ok(slot.scale > 1, 'normal motion grows the sprite');
  const reduced = player.spawn({ x: 0, y: 0, z: 0 }, { life: 1, grow: 2, size: 1 });
  assert.equal(reduced, slot);
  player.update(0.25, { reduced: true });
  assert.equal(slot.index, 0, 'reduced motion holds the first frame');
  assert.equal(slot.scale, 1, 'scale stays put under reduced motion');
});

test('billboard slots follow the camera and dispose never releases shared frames', () => {
  const frames = fakeFrames(2);
  let frameDisposals = 0;
  for (const frame of frames) frame.addEventListener('dispose', () => frameDisposals++);
  const player = new MothSpritePlayer({ frames, fps: 8, slots: 2 });
  const slot = player.spawn({ x: 0, y: 0, z: 0 });
  const camera = { quaternion: new T.Quaternion().setFromEuler(new T.Euler(0.2, 0.7, 0)) };
  player.update(0.02, { camera });
  assert.equal(slot.mesh.quaternion.x, camera.quaternion.x, 'billboard mirrors the camera orientation');
  let geometryDisposals = 0;
  player.geometry.addEventListener('dispose', () => geometryDisposals++);
  player.dispose();
  assert.equal(geometryDisposals, 1, 'pooled geometry is released exactly once');
  assert.equal(frameDisposals, 0, 'shared frames survive player disposal');
});

test('an empty sheet ignores spawns', () => {
  const player = new MothSpritePlayer({ name: 'missing', frames: [], fps: 10, slots: 1 });
  assert.equal(player.spawn({ x: 0, y: 0, z: 0 }), null);
  assert.equal(player.active, 0);
  player.dispose();
});

test('single-pass billboard bounds include growth and offscreen slots still expire', t => {
  const frames = fakeFrames(2), player = new MothSpritePlayer({frames, slots:1});
  t.after(() => { player.dispose();for(const frame of frames)frame.dispose(); });
  const camera = new T.PerspectiveCamera(60,1,.1,50);
  camera.updateMatrixWorld();
  const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const slot = player.spawn({x:6,y:0,z:-5},{size:1,grow:100,life:1});
  assert.equal(slot.material.side,T.DoubleSide);assert.equal(slot.material.forceSinglePass,true);
  assert.equal(slot.mesh.frustumCulled,true);
  slot.mesh.updateMatrixWorld(true);assert.equal(frustum.intersectsObject(slot.mesh),false);
  player.update(.1,{camera});slot.mesh.updateMatrixWorld(true);
  assert.equal(frustum.intersectsObject(slot.mesh),true,'growth expands the world-space bound');
  const reused = player.spawn({x:100,y:0,z:-5},{size:1,life:.15});
  assert.equal(reused,slot);slot.mesh.updateMatrixWorld(true);assert.equal(frustum.intersectsObject(slot.mesh),false);
  player.update(.1,{camera});player.update(.1,{camera});
  assert.equal(player.active,0);assert.equal(slot.mesh.visible,false);
});
