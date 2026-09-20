// Living secondary motion: deterministic springs for head lag, antenna/
// backpack flex, wing-fin beat and crest sway, plus the bounded channel that
// `CharacterRig` writes after the main pose. Reduced motion and the cheap
// software path must snap to rest; dead rigs must never be written.
import test from 'node:test';
import assert from 'node:assert/strict';
import {robotModel} from './view.mjs';
import {applyLivingSecondary, SecondaryMotion} from './rig.mjs';
import {SECONDARY_BOUNDS} from './character-anim.mjs';

const tagged = (model, role) => {
  const out = [];
  model.traverse(node => { if (node.userData?.secondary === role) out.push(node); });
  return out;
};

test('secondary springs converge, stay bounded and reuse one channel object', () => {
  const model = robotModel('chatgpt');
  const rig = model.userData.rig;
  rig.update({dt: .1, speed: 8, maxSpeed: 8, grounded: true});
  const first = applyLivingSecondary(model, {dt: 1 / 60, speed: 8, maxSpeed: 8, yaw: 0, turnRate: 6});
  assert.ok(first && typeof first.headYaw === 'number', 'the pass returns a channel');
  const motion = model.userData.secondaryRig;
  assert.ok(motion instanceof SecondaryMotion, 'the model caches one spring rig');
  for (let i = 0; i < 300; i++) {
    const channel = applyLivingSecondary(model, {dt: 1 / 60, speed: 8, maxSpeed: 8, yaw: 0, turnRate: 6});
    assert.equal(channel, motion.channels, 'the pass reuses its channel object');
    assert.equal(model.userData.secondaryRig, motion, 'the spring rig is never rebuilt');
    for (const key in SECONDARY_BOUNDS) {
      assert.ok(Number.isFinite(channel[key]) && Math.abs(channel[key]) <= SECONDARY_BOUNDS[key] + 1e-9, `${key} bounded (${channel[key]})`);
    }
  }
  // Constant input converges: one more step moves the channel less than a
  // thousandth of a radian.
  const settled = {...motion.channels};
  applyLivingSecondary(model, {dt: 1 / 60, speed: 8, maxSpeed: 8, yaw: 0, turnRate: 6});
  for (const key in SECONDARY_BOUNDS) assert.ok(Math.abs(motion.channels[key] - settled[key]) < 1e-3, `${key} converged`);

  const antenna = tagged(model, 'antenna')[0];
  assert.ok(antenna && antenna.userData.secondaryBase, 'the operator carries a tagged antenna with a cached rest transform');
  assert.ok(
    Math.abs(antenna.rotation.z - antenna.userData.secondaryBase.rz) > .001 ||
    Math.abs(antenna.rotation.x - antenna.userData.secondaryBase.rx) > .001,
    'the antenna flexes with the turn'
  );
  assert.ok(Math.abs(rig.joints.head.rotation.y) > 1e-4 || Math.abs(rig.joints.head.rotation.x) > 1e-4, 'head lag reaches the rig');
});

test('every tagged role flexes inside the channel bounds', () => {
  const cases = [
    ['mistral', 'finL', .06, .2],
    ['mistral', 'finR', .06, .2],
    ['deepseek', 'crest', .26, .23],
    ['chatgpt', 'pack', .05, .05],
    ['chatgpt', 'sensor', .25, .26],
  ];
  for (const [character, role, limitX, limitZ] of cases) {
    const model = robotModel(character);
    model.userData.rig.update({dt: .1, speed: 8, maxSpeed: 8, grounded: true});
    for (let i = 0; i < 90; i++) applyLivingSecondary(model, {dt: 1 / 60, speed: 8, maxSpeed: 8, yaw: 0, hit: 1});
    const nodes = tagged(model, role);
    assert.ok(nodes.length > 0, `${character}/${role} is tagged`);
    for (const node of nodes) {
      const base = node.userData.secondaryBase;
      assert.ok(base, `${character}/${role} caches its rest rotation`);
      const dx = Math.abs(node.rotation.x - base.rx), dz = Math.abs(node.rotation.z - base.rz);
      assert.ok(Number.isFinite(dx) && dx <= limitX, `${character}/${role} x bounded (${dx})`);
      assert.ok(Number.isFinite(dz) && dz <= limitZ, `${character}/${role} z bounded (${dz})`);
    }
  }
});

test('reduced and cheap modes snap to rest without dropping the channel', () => {
  const model = robotModel('chatgpt');
  const rig = model.userData.rig;
  rig.update({dt: .1, speed: 8, maxSpeed: 8, grounded: true});
  const antenna = tagged(model, 'antenna')[0];
  for (let i = 0; i < 60; i++) applyLivingSecondary(model, {dt: 1 / 60, speed: 8, maxSpeed: 8, yaw: 1, turnRate: 6});
  assert.ok(Math.abs(antenna.rotation.z - antenna.userData.secondaryBase.rz) > .001, 'the antenna is displaced first');
  for (const mode of [{reduced: true}, {cheap: true}]) {
    const channel = applyLivingSecondary(model, {dt: 1 / 60, speed: 8, maxSpeed: 8, yaw: 1, turnRate: 6, ...mode});
    for (const key in SECONDARY_BOUNDS) assert.equal(channel[key], 0, `${Object.keys(mode)[0]} zeroes ${key}`);
    assert.equal(antenna.rotation.z, antenna.userData.secondaryBase.rz, 'the antenna returns to its rest rotation');
    assert.equal(antenna.rotation.x, antenna.userData.secondaryBase.rx);
    assert.equal(rig.joints.head.rotation.y, rig.pose.head.y, 'head lag snaps back to the posed head');
  }
});

test('dead rigs are never written by the secondary pass', () => {
  const model = robotModel('chatgpt');
  const rig = model.userData.rig;
  rig.update({dt: .1, speed: 8, maxSpeed: 8, grounded: true});
  const snapshot = () => JSON.stringify([
    rig.joints.head.rotation.x, rig.joints.head.rotation.y, rig.joints.head.rotation.z,
    rig.joints.chest.rotation.y, rig.joints.chest.rotation.z,
    tagged(model, 'antenna')[0].rotation.z,
  ]);
  rig.lifecycle = 'dying';
  const before = snapshot();
  for (let i = 0; i < 30; i++) {
    assert.equal(applyLivingSecondary(model, {dt: 1 / 60, speed: 8, maxSpeed: 8, yaw: 2, turnRate: 8, hit: 1}), null, 'a dead rig returns no channel');
  }
  assert.equal(snapshot(), before, 'no joint or tagged node moved while dead');
});
