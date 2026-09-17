import test from 'node:test';
import assert from 'node:assert/strict';
import {advancePhase, angleDelta, characterPose, CharacterRig, clamp, damp, dampAngle, strideFrequency, turnToward, TAU} from './character-anim.mjs';

const allAngles = pose => {
  const out = [];
  for (const key of ['hips', 'torso', 'chest', 'head']) out.push(pose[key].x, pose[key].y, pose[key].z);
  for (const key of ['armL', 'armR']) out.push(pose[key].shoulderX, pose[key].shoulderZ, pose[key].elbowX);
  for (const key of ['legL', 'legR']) out.push(pose[key].hipX, pose[key].kneeX, pose[key].ankleX);
  return out;
};

test('angle helpers wrap correctly and never overshoot', () => {
  assert.ok(Math.abs(angleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9);
  assert.equal(turnToward(0, Math.PI, 1), 1);
  assert.ok(Math.abs(turnToward(0, 0.1, 1) - 0.1) < 1e-9);
  let angle = 0;
  for (let i = 0; i < 200; i++) angle = dampAngle(angle, 2.4, 6, 1 / 60);
  assert.ok(Math.abs(angleDelta(angle, 2.4)) < 0.01);
  assert.ok(damp(0, 1, 0, 1) === 0);
  assert.ok(Math.abs(damp(0, 1, 100, 1) - 1) < 1e-9);
});

test('stride frequency rises with speed and stops in the air', () => {
  assert.ok(strideFrequency(0) < strideFrequency(1));
  assert.ok(strideFrequency(0.5) > 0);
  assert.equal(strideFrequency(1, false), 0);
});

test('advancePhase accumulates and stays wrapped in [0, TAU)', () => {
  let phase = 0;
  for (let i = 0; i < 500; i++) {
    phase = advancePhase(phase, 0.8, 1 / 60);
    assert.ok(phase >= 0 && phase < TAU);
  }
  assert.ok(phase > 0);
});

test('every pose keeps joints bounded and mirrored limbs are contra-lateral', () => {
  for (const speedNorm of [0, 0.35, 0.7, 1]) {
    for (const phase of [0, 1.1, 2.5, 4.2, 6]) {
      const pose = characterPose({phase, speedNorm, grounded: true});
      for (const angle of allAngles(pose)) assert.ok(Number.isFinite(angle) && Math.abs(angle) <= 1.3, `${angle}`);
      assert.ok(Math.abs(pose.legL.hipX + pose.legR.hipX) < 1e-9, 'legs should mirror');
    }
  }
});

test('crouch lowers the body and ads raises the gun arms', () => {
  const stand = characterPose({speedNorm: 0, grounded: true});
  const crouch = characterPose({speedNorm: 0, grounded: true, crouch: 1});
  assert.ok(crouch.rootY < stand.rootY);
  assert.ok(crouch.torso.x > stand.torso.x);
  const ads = characterPose({speedNorm: 0, grounded: true, ads: 1});
  assert.ok(ads.armL.shoulderX < stand.armL.shoulderX);
});

test('airborne pose tucks the legs and spreads the arms', () => {
  const air = characterPose({speedNorm: 1, grounded: false});
  assert.ok(air.legL.kneeX > 0.5);
  assert.ok(Math.abs(air.armL.shoulderZ) > 0.3);
});

test('the head tracks the focus direction within a sane arc', () => {
  const pose = characterPose({speedNorm: 0, grounded: true, focusYaw: 5, focusPitch: -5});
  assert.ok(Math.abs(pose.head.y) <= 0.6);
  assert.ok(Math.abs(pose.head.x) <= 0.5);
});

test('rig smooths speed and converges stance without popping', () => {
  const node = () => ({position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; }}});
  const joints = {root: node(), hips: node(), torso: node(), chest: node(), head: node(), armUpperL: node(), armUpperR: node(), forearmL: node(), forearmR: node(), legUpperL: node(), legUpperR: node(), legLowerL: node(), legLowerR: node(), footL: node(), footR: node()};
  const rig = new CharacterRig(joints);
  const start = rig.speedNorm;
  rig.update({dt: 1 / 60, speed: 8, maxSpeed: 8, grounded: true, time: 0});
  assert.ok(rig.speedNorm > start && rig.speedNorm < 1, 'speed should ramp in, not snap');
  for (let i = 0; i < 120; i++) rig.update({dt: 1 / 60, speed: 8, maxSpeed: 8, grounded: true, time: i / 60});
  assert.ok(rig.speedNorm > 0.95);
  assert.ok(rig.phase > 0);
  assert.ok(Number.isFinite(joints.legUpperL.rotation.x));
  assert.ok(clamp(rig.crouch, 0, 1) >= 0);
});

test('turn banking twists the chest alongside aim focus',()=>{
  assert.ok(Math.abs(characterPose({bank:1,focusYaw:0}).chest.y+0.08)<1e-9,'bank alone twists the chest');
  assert.ok(Math.abs(characterPose({bank:1,focusYaw:.5}).chest.y-(0.1-0.08))<1e-9,'bank and focus combine');
});

test('landing compression absorbs touchdown impact with knee flexion and root drop', () => {
  const stand = characterPose({ speedNorm: 0, grounded: true, land: 0 });
  const landing = characterPose({ speedNorm: 0, grounded: true, land: 1 });
  assert.ok(landing.rootY < stand.rootY, 'root drops during landing compression');
  assert.ok(landing.legL.kneeX > stand.legL.kneeX, 'knees flex to absorb impact');
  assert.ok(landing.legR.kneeX > stand.legR.kneeX, 'both knees flex symmetrically');
  assert.ok(landing.torso.x > stand.torso.x, 'torso leans forward to cushion momentum');
});

test('reload transition lowers offhand and repositions weapon arm', () => {
  const ready = characterPose({ speedNorm: 0, grounded: true, reload: 0 });
  const reloading = characterPose({ speedNorm: 0, grounded: true, reload: 1 });
  assert.ok(reloading.armL.shoulderX < ready.armL.shoulderX, 'offhand moves to reload position');
  assert.ok(reloading.armL.elbowX < ready.armL.elbowX, 'offhand elbow bends toward mag well');
  assert.ok(reloading.armR.shoulderX < ready.armR.shoulderX, 'weapon arm tilts for reload control');
});

test('CharacterRig arms landing compression on ground contact transition', () => {
  const node = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } });
  const joints = { root: node(), hips: node(), torso: node(), chest: node(), head: node(), armUpperL: node(), armUpperR: node(), forearmL: node(), forearmR: node(), legUpperL: node(), legUpperR: node(), legLowerL: node(), legLowerR: node(), footL: node(), footR: node() };
  const rig = new CharacterRig(joints);

  // In air
  rig.update({ dt: 1 / 60, grounded: false });
  assert.equal(rig.lastGrounded, false);
  assert.equal(rig.land, 0);

  // Touchdown triggers compression
  rig.update({ dt: 1 / 60, grounded: true });
  assert.equal(rig.lastGrounded, true);
  assert.ok(rig.land > 0.8, 'landing compression triggered on touchdown');

  // Recovers over time
  for (let i = 0; i < 30; i++) rig.update({ dt: 1 / 60, grounded: true });
  assert.ok(rig.land < 0.1, 'landing compression settles back to rest');
});

test('reduced motion plants the refined contact gait while full motion lifts the stride', () => {
  // The app intentionally keeps reduce-motion semantics: legs stay planted and
  // the arms/torso keep their readable pose. This pins that contract so a
  // future change cannot silently animate (or silently freeze) the stride.
  const shared = {contactGait:true, grounded:true, phase:1.3, time:2.4, speedNorm:1};
  const running = characterPose({...shared, reduced:false});
  const reduced = characterPose({...shared, reduced:true});
  assert.ok(running.legL.contactLift > 0, 'full motion lifts the planted foot');
  assert.equal(reduced.legL.contactLift, 0, 'reduced motion keeps the foot planted');
  assert.notEqual(reduced.legL.hipX, running.legL.hipX, 'the reduced stride angle differs from the running angle');
  assert.notEqual(reduced.legL.kneeX, running.legL.kneeX, 'the reduced knee angle differs from the running angle');
});

