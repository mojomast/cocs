import test from 'node:test';
import assert from 'node:assert/strict';
import {occlusionDistance} from './camera.mjs';

const head = { x: 0, y: 1.35, z: 0 };
const cam = { x: 0, y: 3.35, z: 10 };

test('occlusionDistance returns the stand-off or the full distance', () => {
  assert.equal(occlusionDistance(head, cam, 4), 3.6, 'blocked view pulls to the obstruction');
  assert.equal(occlusionDistance(head, cam, 20), Math.hypot(cam.x - head.x, cam.y - head.y, cam.z - head.z), 'clear view keeps full distance');
  assert.equal(occlusionDistance(head, cam, NaN), Math.hypot(cam.x - head.x, cam.y - head.y, cam.z - head.z));
  assert.equal(occlusionDistance(head, cam, .1), 1.3, 'never closer than the minimum');
  assert.equal(occlusionDistance(null, cam, 4), null);
});
