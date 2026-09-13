// Procedural character animation for the COCS operators.
//
// This module is intentionally free of Three.js so the motion model can be
// unit-tested and shared by the authoritative simulation (bot facing) and the
// renderer (rig posing). The rig itself is a small hierarchy of joints; this
// file only decides the angles, not the meshes.
//
// Design notes from the Three.js/game-animation research:
// - Use exponential damping (a critically-damped spring approximation) for all
//   blended values so nothing pops when a bot changes state.
// - Drive the gait from an accumulated *phase* advanced by stride frequency,
//   not from absolute time, so stride length follows speed and blends cleanly.
// - Keep every angle bounded and symmetric; contra-lateral limbs swing opposite
//   so the walk never reads as a "puppet" flail.

import {clamp, lerp} from './math.mjs';

export const TAU = Math.PI * 2;

export {clamp, lerp};

// Frame-rate independent exponential smoothing toward a target.
export function damp(current, target, lambda, dt) {
  const amount = 1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt));
  return current + (target - current) * amount;
}

// Shortest signed angular difference in (-PI, PI].
export function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function dampAngle(current, target, lambda, dt) {
  return current + angleDelta(current, target) * (1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt)));
}

// Move `current` toward `target` by at most `maxStep` radians (shortest way).
export function turnToward(current, target, maxStep) {
  const delta = angleDelta(current, target), step = Math.max(0, maxStep);
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}

// Stride frequency in cycles/second for a normalised ground speed (0..1).
// Idle has a slow breathing cadence; a full sprint is roughly 3.4 strides/s.
export function strideFrequency(speedNorm, grounded = true) {
  const s = clamp(speedNorm, 0, 1);
  if (!grounded) return 0;
  return lerp(1.35, 3.4, s);
}

export function advancePhase(phase, speedNorm, dt, grounded = true) {
  return (phase + strideFrequency(speedNorm, grounded) * TAU * Math.max(0, dt)) % TAU;
}

// ---- Pose solver ----------------------------------------------------------

// A neutral, relaxed standing pose used as the base for every state.
function basePose() {
  return {
    rootY: 0,
    hips: { x: 0, y: 0, z: 0 },
    torso: { x: 0.04, y: 0, z: 0 },
    chest: { x: 0, y: 0, z: 0 },
    head: { x: 0, y: 0, z: 0 },
    armL: { shoulderX: 0.05, shoulderZ: 0.12, elbowX: -0.35 },
    armR: { shoulderX: 0.05, shoulderZ: -0.12, elbowX: -0.35 },
    legL: { hipX: 0, kneeX: 0.08, ankleX: 0.04 },
    legR: { hipX: 0, kneeX: 0.08, ankleX: 0.04 },
  };
}

// `state` fields:
//  phase       accumulated stride phase (radians)
//  speedNorm   0..1 horizontal speed / max speed
//  grounded    feet on ground
//  crouch      0..1 crouch amount
//  ads         0..1 aim-down-sights amount
//  strafe      -1..1 lateral input (right positive)
//  forward     -1..1 forward input
//  focusYaw    head/chest yaw offset toward the aim point (radians, body-local)
//  focusPitch  head pitch offset toward the aim point (radians, body-local)
//  hit         0..1 recent-hit flinch envelope
//  time        seconds, for idle micro-motion
export function characterPose(state = {}) {
  const pose = basePose();
  const speed = clamp(state.speedNorm ?? 0, 0, 1);
  const grounded = state.grounded !== false;
  const crouch = clamp(state.crouch ?? 0, 0, 1);
  const ads = clamp(state.ads ?? 0, 0, 1);
  const strafe = clamp(state.strafe ?? 0, -1, 1);
  const forward = clamp(state.forward ?? 0, -1, 1);
  const time = state.time ?? 0;
  const hit = clamp(state.hit ?? 0, 0, 1);
  const phase = state.phase ?? 0;
  const swing = Math.sin(phase);
  const bob = Math.abs(Math.sin(phase));

  if (!grounded) {
    // Airborne: tuck the trailing leg, spread the arms for balance.
    pose.legL = { hipX: -0.55, kneeX: 0.95, ankleX: 0.15 };
    pose.legR = { hipX: -0.32, kneeX: 0.6, ankleX: 0.2 };
    pose.armL = { shoulderX: -0.5, shoulderZ: 0.5, elbowX: -0.6 };
    pose.armR = { shoulderX: -0.5, shoulderZ: -0.5, elbowX: -0.6 };
    pose.torso.x = 0.12;
    pose.rootY = 0.02;
  } else {
    const stride = 0.34 + 0.52 * speed;
    pose.legL.hipX = swing * stride;
    pose.legR.hipX = -swing * stride;
    // Knees bend most as the leg travels behind the body.
    pose.legL.kneeX = 0.1 + Math.max(0, -swing) * (0.35 + 0.7 * speed);
    pose.legR.kneeX = 0.1 + Math.max(0, swing) * (0.35 + 0.7 * speed);
    pose.legL.ankleX = -pose.legL.hipX * 0.35;
    pose.legR.ankleX = -pose.legR.hipX * 0.35;
    // Arms counter-swing the legs; held arms shrink the swing during ADS.
    const armSwing = (0.28 + 0.5 * speed) * (1 - ads * 0.75);
    pose.armL.shoulderX = -swing * armSwing;
    pose.armR.shoulderX = swing * armSwing;
    pose.armL.elbowX = -0.3 - Math.max(0, swing) * 0.35 * speed;
    pose.armR.elbowX = -0.3 - Math.max(0, -swing) * 0.35 * speed;
    pose.rootY = -bob * 0.045 * speed + (1 - speed) * Math.sin(time * 1.6) * 0.008;
    pose.torso.x = 0.05 + 0.16 * speed + forward * 0.05;
    pose.torso.z = -strafe * 0.12 * (0.4 + speed);
    pose.hips.z = strafe * 0.05;
    pose.hips.y = swing * 0.08 * speed;
  }

  // Crouch lowers the whole body and folds the knees.
  if (crouch > 0) {
    pose.rootY -= crouch * 0.34;
    pose.legL.kneeX = lerp(pose.legL.kneeX, 1.05, crouch);
    pose.legR.kneeX = lerp(pose.legR.kneeX, 1.05, crouch);
    pose.legL.hipX = lerp(pose.legL.hipX, -0.7, crouch);
    pose.legR.hipX = lerp(pose.legR.hipX, -0.7, crouch);
    pose.torso.x = lerp(pose.torso.x, 0.34, crouch);
    pose.armL.elbowX -= crouch * 0.25;
    pose.armR.elbowX -= crouch * 0.25;
  }

  // ADS raises both gun arms and squares the torso to the aim direction.
  if (ads > 0) {
    pose.armL.shoulderX = lerp(pose.armL.shoulderX, -0.95, ads);
    pose.armR.shoulderX = lerp(pose.armR.shoulderX, -0.95, ads);
    pose.armL.elbowX = lerp(pose.armL.elbowX, -0.55, ads);
    pose.armR.elbowX = lerp(pose.armR.elbowX, -0.55, ads);
    pose.armL.shoulderZ = lerp(pose.armL.shoulderZ, 0.22, ads);
    pose.armR.shoulderZ = lerp(pose.armR.shoulderZ, -0.22, ads);
    pose.chest.x = lerp(pose.chest.x, -0.06, ads);
  }

  // Bank into turns so sharp direction changes read as body language, not a spin.
  const bank = clamp(state.bank ?? 0, -1, 1);
  if (bank) { pose.torso.z += bank * 0.16; pose.hips.z += bank * 0.08; pose.chest.y -= bank * 0.08; }

  // Head and chest track the aim point relative to the body.
  const focusYaw = clamp(state.focusYaw ?? 0, -0.9, 0.9);
  const focusPitch = clamp(state.focusPitch ?? 0, -0.6, 0.6);
  pose.head.y = focusYaw * 0.65;
  pose.chest.y = focusYaw * 0.2 - bank * 0.08;
  pose.torso.y = focusYaw * 0.12;
  pose.head.x = focusPitch * 0.6 - pose.torso.x * 0.35;

  // Brief hit flinch: recoil the chest, throw the head back, raise an arm.
  if (hit > 0) {
    pose.chest.x -= hit * 0.22;
    pose.head.x -= hit * 0.3;
    pose.torso.z += hit * 0.12;
    pose.armL.shoulderX -= hit * 0.4;
    pose.armR.shoulderX -= hit * 0.25;
  }
  return pose;
}

// ---- Rig ------------------------------------------------------------------

// Applies poses to a joint hierarchy. Joint objects are plain Three.js
// Object3D-like nodes (anything with position/rotation), so this stays free of
// an engine import. Missing joints are ignored, which keeps the rig resilient
// while the model is being rebuilt.
export class CharacterRig {
  constructor(joints = {}) {
    this.joints = joints;
    this.phase = 0;
    this.speedNorm = 0;
    this.crouch = 0;
    this.ads = 0;
    this.strafe = 0;
    this.forward = 0;
    this.hit = 0;
    this.bodyYaw = 0;
  }

  update(state = {}) {
    const dt = clamp(state.dt ?? 0, 0, 0.1);
    const maxSpeed = Math.max(0.001, state.maxSpeed ?? 8);
    const speedNorm = clamp((state.speed ?? 0) / maxSpeed, 0, 1);
    this.speedNorm = damp(this.speedNorm, speedNorm, 8, dt);
    this.crouch = damp(this.crouch, clamp(state.crouch ? 1 : 0, 0, 1), 10, dt);
    this.ads = damp(this.ads, clamp(state.ads ? 1 : 0, 0, 1), 10, dt);
    this.strafe = damp(this.strafe, clamp(state.strafe ?? 0, -1, 1), 8, dt);
    this.forward = damp(this.forward, clamp(state.forward ?? 0, -1, 1), 8, dt);
    this.hit = Math.max(0, this.hit - dt * 4);
    if (state.hit) this.hit = Math.max(this.hit, clamp(state.hit, 0, 1));
    this.phase = advancePhase(this.phase, this.speedNorm, dt, state.grounded !== false);
    const pose = characterPose({
      phase: this.phase,
      speedNorm: this.speedNorm,
      grounded: state.grounded,
      crouch: this.crouch,
      ads: this.ads,
      strafe: this.strafe,
      forward: this.forward,
      focusYaw: state.focusYaw,
      focusPitch: state.focusPitch,
      bank: state.bank,
      hit: this.hit,
      time: state.time,
    });
    this.apply(pose);
    return pose;
  }

  apply(pose) {
    const j = this.joints;
    const ro = (node, x, y, z) => { if (!node) return; node.rotation.set(x ?? 0, y ?? 0, z ?? 0); };
    if (j.root && pose.rootY !== undefined) j.root.position.y = (j.rootBaseY ?? 0) + pose.rootY;
    ro(j.hips, pose.hips.x, pose.hips.y, pose.hips.z);
    ro(j.torso, pose.torso.x, pose.torso.y, pose.torso.z);
    ro(j.chest, pose.chest.x, pose.chest.y, pose.chest.z);
    ro(j.head, pose.head.x, pose.head.y, pose.head.z);
    ro(j.armUpperL, pose.armL.shoulderX, 0, pose.armL.shoulderZ);
    ro(j.armUpperR, pose.armR.shoulderX, 0, pose.armR.shoulderZ);
    ro(j.forearmL, pose.armL.elbowX, 0, 0);
    ro(j.forearmR, pose.armR.elbowX, 0, 0);
    ro(j.legUpperL, pose.legL.hipX, 0, 0);
    ro(j.legUpperR, pose.legR.hipX, 0, 0);
    ro(j.legLowerL, pose.legL.kneeX, 0, 0);
    ro(j.legLowerR, pose.legR.kneeX, 0, 0);
    ro(j.footL, pose.legL.ankleX, 0, 0);
    ro(j.footR, pose.legR.ankleX, 0, 0);
  }
}
