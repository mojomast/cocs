import test from 'node:test';
import assert from 'node:assert/strict';
import {advancePhase, angleDelta, characterPose, CharacterRig, deathLimbPose, clamp, damp, dampAngle, strideFrequency, turnToward, TAU, SECONDARY_BOUNDS, SECONDARY_REST} from './character-anim.mjs';
import {RAGDOLL_CHAIN, RAGDOLL_REST} from './ragdoll.mjs';

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

test('death limb solver is deterministic, seeded, pose-aware and bounded', () => {
 const opts = {pose: 'forward', style: 'ragdoll', seed: 7, splay: .8, roll: .3, spin: 1, progress: 1};
 const first = deathLimbPose(opts);
 assert.deepEqual(first, deathLimbPose(opts), 'same plan and seed settle the same silhouette');
 const neutral = deathLimbPose({...opts, progress: 0});
 const neutralOther = deathLimbPose({...opts, progress: 0, seed: 99});
 assert.deepEqual(neutral.armL, neutralOther.armL, 'progress zero is a seed-independent rest pose');
 assert.deepEqual(neutral.legL, neutralOther.legL);
 assert.notDeepEqual(neutral.armL, first.armL, 'the settle blends away from the rest arms');
 assert.notDeepEqual(neutral.legL, first.legL, 'the settle blends away from the rest legs');
 assert.deepEqual(deathLimbPose({...opts, progress: 0, reduced: true}), first, 'reduced motion snaps to the settled pose');
 const silhouettes = new Set();
 for (let seed = 0; seed < 12; seed++) {
  const pose = deathLimbPose({...opts, seed});
  silhouettes.add([pose.armL.shoulderZ, pose.armR.shoulderZ, pose.legL.kneeX, pose.legR.kneeX].map(v => v.toFixed(3)).join(','));
  for (const angle of allAngles(pose)) assert.ok(Number.isFinite(angle) && Math.abs(angle) <= 1.25, `bounded ${angle}`);
 }
 assert.ok(silhouettes.size >= 10, `different seeds spread differently, got ${silhouettes.size}`);
 const crumple = deathLimbPose({pose: 'crumple', style: 'crumple', seed: 1, progress: 1});
 const sprawl = deathLimbPose({pose: 'sprawl', style: 'sprawl', seed: 1, progress: 1});
 assert.ok(Math.abs(sprawl.armL.shoulderZ) > Math.abs(crumple.armL.shoulderZ), 'sprawl spreads wider than a crumple');
 assert.notDeepEqual([sprawl.armL.shoulderX, sprawl.legL.hipX], [crumple.armL.shoulderX, crumple.legL.hipX]);
});

test('corpse posing is lifecycle-only while apply keeps refusing dead writes', () => {
 const node = () => ({position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; }}});
 const joints = {root: node(), hips: node(), torso: node(), chest: node(), head: node(), armUpperL: node(), armUpperR: node(), forearmL: node(), forearmR: node(), legUpperL: node(), legUpperR: node(), legLowerL: node(), legLowerR: node(), footL: node(), footR: node()};
 const rig = new CharacterRig(joints);
 rig.applyCorpse(deathLimbPose({seed: 1}));
 assert.ok(!rig.pose, 'a living rig refuses corpse posing');
 rig.reset();
 rig.lifecycle = 'dying';
 rig.apply(characterPose({crouch: 1}));
 assert.ok(!rig.pose, 'apply still refuses dead writes');
 const pose = deathLimbPose({pose: 'sprawl', style: 'sprawl', seed: 2, progress: 1});
 rig.applyCorpse(pose);
 assert.equal(rig.pose, pose);
 assert.ok(Math.abs(joints.armUpperL.rotation.z) > 0, 'the corpse channel writes the limbs');
});

test('the ragdoll channel writes only dead joints and blends the live pose out', () => {
 const node = () => ({position: {x: 0, y: 0, z: 0, set() {}}, rotation: {x: 0, y: 0, z: 0, order: 'XYZ', set(x, y, z) { this.x = x; this.y = y; this.z = z; }}});
 const joints = {};
 for (const key of ['root', 'hips', 'torso', 'chest', 'head', 'armUpperL', 'armUpperR', 'forearmL', 'forearmR', 'legUpperL', 'legUpperR', 'legLowerL', 'legLowerR', 'footL', 'footR']) joints[key] = node();
 const rig = new CharacterRig(joints);
 const particles = new Float64Array(RAGDOLL_REST);
 particles[6 * 3] -= .28; particles[6 * 3 + 1] -= .18;
 const pose = {particles};
 rig.applyRagdoll(pose);
 assert.ok(!rig.pose, 'a living rig refuses ragdoll writes');
 rig.lifecycle = 'dying';
 // A posed live rig captured right before death is restored exactly at blend 1.
 joints.chest.rotation.set(.1, .2, .05);
 joints.armUpperL.rotation.set(-.2, 0, .3);
 const live = rig.captureRagdollQuats(new Float64Array(RAGDOLL_CHAIN.length * 4));
 assert.ok(live.some((value, index) => index % 4 === 3 ? value !== 1 : value !== 0), 'live joint quats were captured');
 rig.applyRagdoll(pose, 1, live);
 assert.ok(Math.abs(joints.chest.rotation.x - .1) < 1e-9 && Math.abs(joints.chest.rotation.y - .2) < 1e-9, 'the kill frame keeps the living chest');
 assert.ok(Math.abs(joints.armUpperL.rotation.z - .3) < 1e-9, 'the killing hit lean/pose survives frame zero');
 // At blend 0 the dropped hand bends the elbow and every joint stays finite.
 rig.applyRagdoll(pose, 0, null);
 assert.ok(Math.abs(joints.forearmL.rotation.x) + Math.abs(joints.forearmL.rotation.z) > 1e-6, 'the particle field drives the elbow');
 for (const key of ['hips', 'torso', 'chest', 'head', 'armUpperL', 'armUpperR', 'forearmL', 'forearmR', 'legUpperL', 'legUpperR', 'legLowerL', 'legLowerR', 'footL', 'footR'])
  for (const axis of ['x', 'y', 'z']) assert.ok(Number.isFinite(joints[key].rotation[axis]), `${key}.${axis}`);
 const first = [joints.forearmL.rotation.x, joints.forearmL.rotation.z];
 rig.applyRagdoll(pose, 0, null);
 assert.deepEqual([joints.forearmL.rotation.x, joints.forearmL.rotation.z], first, 'the adapter is deterministic');
 assert.equal(rig.pose, pose);
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

test('secondary channel is bounded, allocation-free under reduced motion and rest by default', () => {
  const over = characterPose({secondary: {headYaw: 99, headPitch: -99, chestYaw: 99, chestRoll: 99, flexX: 99, flexZ: -99, finL: 99, finR: -99, crestX: 99, crestZ: 99, packX: 99, packZ: -99}});
  for (const key in SECONDARY_BOUNDS) {
    assert.ok(Math.abs(over.secondary[key]) <= SECONDARY_BOUNDS[key] + 1e-12, `${key} clamped`);
  }
  assert.equal(over.secondary.headYaw, SECONDARY_BOUNDS.headYaw);
  assert.equal(characterPose({}).secondary, SECONDARY_REST, 'a missing channel resolves to the shared rest object');
  const reduced = characterPose({secondary: {headYaw: 1}, reduced: true});
  assert.equal(reduced.secondary, SECONDARY_REST, 'reduced motion snaps the channel to rest');
  const nan = characterPose({secondary: {headYaw: NaN, flexZ: 'nope'}});
  assert.ok(Number.isFinite(nan.secondary.headYaw) && Number.isFinite(nan.secondary.flexZ));
});

test('rig smooths bank, acceleration, slide and asymmetric landing roll', () => {
  const node = () => ({position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; }}});
  const joints = () => ({root: node(), hips: node(), torso: node(), chest: node(), head: node(), armUpperL: node(), armUpperR: node(), forearmL: node(), forearmR: node(), legUpperL: node(), legUpperR: node(), legLowerL: node(), legLowerR: node(), footL: node(), footR: node()});

  // Bank is no longer passed raw: the rig ramps toward the snapshot value.
  const bankRig = new CharacterRig(joints());
  bankRig.update({dt: 1 / 60, bank: 1, grounded: true});
  assert.ok(bankRig.bank > 0 && bankRig.bank < 1, 'bank leans in, it does not snap');
  for (let i = 0; i < 180; i++) bankRig.update({dt: 1 / 60, bank: 1, grounded: true});
  assert.ok(bankRig.bank > .95, 'bank converges to the snapshot value');

  // Acceleration lean: the first accelerating frame leans further forward than
  // the same pose without the acceleration read.
  const steady = new CharacterRig(joints());
  for (let i = 0; i < 240; i++) steady.update({dt: 1 / 60, speed: 8, maxSpeed: 8, grounded: true});
  const launching = new CharacterRig(joints());
  launching.update({dt: 1 / 60, speed: 8, maxSpeed: 8, grounded: true});
  assert.ok(launching.accel > steady.accel, 'a launch reads as positive acceleration');
  const sharedPose = {speedNorm: .5, grounded: true};
  assert.ok(characterPose({...sharedPose, accel: 1}).torso.x > characterPose(sharedPose).torso.x, 'acceleration leans the torso forward');
  assert.ok(characterPose({...sharedPose, accel: -1}).torso.x < characterPose(sharedPose).torso.x, 'braking leans the torso back');
  for (let i = 0; i < 240; i++) launching.update({dt: 1 / 60, speed: 8, maxSpeed: 8, grounded: true});
  assert.ok(Math.abs(launching.accel - steady.accel) < 1e-6, 'the lean decays once speed is steady');

  // Slide stance: lower root, torso leans back, legs shoot forward.
  const stood = characterPose({speedNorm: 0, grounded: true});
  const slide = characterPose({speedNorm: 0, grounded: true, slide: 1});
  assert.ok(slide.rootY < stood.rootY, 'a slide drops the root');
  assert.ok(slide.torso.x < stood.torso.x, 'a slide leans the torso back');
  assert.ok(slide.legL.hipX > stood.legL.hipX && slide.legR.hipX < stood.legR.hipX, 'the legs shoot forward asymmetrically');
  const slideRig = new CharacterRig(joints());
  slideRig.update({dt: 1 / 60, sliding: true, grounded: true});
  assert.ok(slideRig.slide > 0 && slideRig.slide < 1, 'the slide stance ramps in');

  // Landing roll is asymmetric: the positive side lingers longer.
  const left = new CharacterRig(joints());
  for (let i = 0; i < 30; i++) left.update({dt: 1 / 60, grounded: false, strafe: 1});
  left.update({dt: 1 / 60, grounded: true, strafe: 1});
  const right = new CharacterRig(joints());
  for (let i = 0; i < 30; i++) right.update({dt: 1 / 60, grounded: false, strafe: -1});
  right.update({dt: 1 / 60, grounded: true, strafe: -1});
  assert.ok(left.landRoll < 0 && right.landRoll > 0, 'touchdown rolls away from the lateral input');
  for (let i = 0; i < 20; i++) { left.update({dt: 1 / 60, grounded: true, strafe: 1}); right.update({dt: 1 / 60, grounded: true, strafe: -1}); }
  assert.ok(Math.abs(right.landRoll) > Math.abs(left.landRoll) + .05, 'the positive landing roll decays slower');
});

test('hit direction pitches the rig channel within bounds and never writes a corpse', () => {
  const node = () => ({position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; }}});
  const joints = {root: node(), hips: node(), torso: node(), chest: node(), head: node(), armUpperL: node(), armUpperR: node(), forearmL: node(), forearmR: node(), legUpperL: node(), legUpperR: node(), legLowerL: node(), legLowerR: node(), footL: node(), footR: node()};
  const rig = new CharacterRig(joints);
  rig.update({dt: 1 / 60, hit: 1, grounded: true});
  rig.setHitDirection(0, 1, 1);
  assert.ok(rig.hitPitch > 0, 'a shot from the front pitches the spine');
  assert.ok(Math.abs(rig.hitRoll) < 1e-9);
  rig.setHitDirection(1000, -1000, 1);
  assert.ok(Math.abs(rig.hitPitch) <= .4 + 1e-9 && Math.abs(rig.hitRoll) <= .35 + 1e-9, 'the hit channel is bounded');
  rig.setHitDirection(0, 1, 1);
  const chestBefore = joints.chest.rotation.x;
  assert.ok(rig.writeHitLean(), 'the living hit lean writes');
  assert.notEqual(joints.chest.rotation.x, chestBefore);
  assert.equal(rig.writeHitLean(), true);
  rig.lifecycle = 'dying';
  const frozen = joints.chest.rotation.x;
  rig.setHitDirection(1, 0, 1);
  assert.equal(rig.writeHitLean(), false, 'the corpse channel refuses the living hit lean');
  assert.equal(joints.chest.rotation.x, frozen);
});

