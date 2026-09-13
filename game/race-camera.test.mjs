import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RACE_DEMO_MODES,
  RACE_DEMO_MODE_SECONDS,
  raceDemoMode,
  raceDemoPose,
} from './race-camera.mjs';

const centerline = [
  { x: 0, z: -40 }, { x: 40, z: -40 }, { x: 56, z: -16 }, { x: 56, z: 16 },
  { x: 40, z: 40 }, { x: 0, z: 40 }, { x: -40, z: 40 }, { x: -56, z: 16 },
  { x: -56, z: -16 }, { x: -40, z: -40 },
];
const vehicles = Array.from({ length: 8 }, (_, id) => ({
  id, kind: 'puma', y: 0,
  x: Math.cos((id / 8) * Math.PI * 2) * 20,
  z: Math.sin((id / 8) * Math.PI * 2) * 20,
  yaw: id * 0.3,
}));

test('raceDemoMode cycles every rig in order and wraps', () => {
  assert.equal(RACE_DEMO_MODES.length, 4);
  assert.equal(RACE_DEMO_MODE_SECONDS, 7);
  assert.equal(raceDemoMode(0), 'chase');
  assert.equal(raceDemoMode(RACE_DEMO_MODE_SECONDS - 0.001), 'chase');
  assert.equal(raceDemoMode(RACE_DEMO_MODE_SECONDS), 'orbit');
  const seen = [];
  for (let t = 0; t < RACE_DEMO_MODE_SECONDS * RACE_DEMO_MODES.length; t += 0.5) {
    const mode = raceDemoMode(t);
    if (seen.at(-1) !== mode) seen.push(mode);
  }
  assert.deepEqual(seen, RACE_DEMO_MODES);
  assert.equal(raceDemoMode(RACE_DEMO_MODE_SECONDS * RACE_DEMO_MODES.length), 'chase');
  assert.equal(raceDemoMode(-5), 'chase');
  assert.equal(raceDemoMode(NaN), 'chase');
});

test('every rig yields finite in-bounds poses that differ and rotate featured cars', () => {
  const bounds = {
    minX: Math.min(...centerline.map(p => p.x)) - 30, maxX: Math.max(...centerline.map(p => p.x)) + 30,
    minZ: Math.min(...centerline.map(p => p.z)) - 30, maxZ: Math.max(...centerline.map(p => p.z)) + 30,
  };
  const poses = [];
  for (const mode of RACE_DEMO_MODES) {
    const pose = raceDemoPose({ mode, centerline, vehicles, elapsed: 2 });
    for (const key of ['x', 'y', 'z', 'lookX', 'lookY', 'lookZ']) {
      assert.ok(Number.isFinite(pose[key]), `${mode}.${key} is finite`);
    }
    assert.ok(pose.x >= bounds.minX && pose.x <= bounds.maxX, `${mode} stays in x bounds`);
    assert.ok(pose.z >= bounds.minZ && pose.z <= bounds.maxZ, `${mode} stays in z bounds`);
    assert.ok(pose.y > 0.5 && pose.y < 40, `${mode} keeps a sane height`);
    assert.equal(pose.mode, mode);
    poses.push(pose);
  }
  for (let i = 0; i < poses.length; i++) {
    for (let j = i + 1; j < poses.length; j++) {
      const a = poses[i], b = poses[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1, `${a.mode} and ${b.mode} are distinct shots`);
    }
  }
  const featured = new Set();
  for (let segment = 0; segment < vehicles.length; segment++) {
    featured.add(raceDemoPose({ mode: 'chase', centerline, vehicles, elapsed: segment * RACE_DEMO_MODE_SECONDS }).carId);
  }
  assert.equal(featured.size, vehicles.length, 'each demo segment features a different car');
  const empty = raceDemoPose({ mode: 'orbit' });
  for (const key of ['x', 'y', 'z', 'lookX', 'lookY', 'lookZ']) assert.ok(Number.isFinite(empty[key]), `empty-pose ${key}`);
  const unknown = raceDemoPose({ mode: 'not-a-rig', centerline, vehicles });
  assert.equal(unknown.mode, 'chase');
  for (const key of ['x', 'y', 'z', 'lookX', 'lookY', 'lookZ']) assert.ok(Number.isFinite(unknown[key]), `unknown-rig ${key}`);
});
