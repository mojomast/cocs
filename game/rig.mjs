// Advanced procedural rigging and kinematics for TokenArena.
// Provides second-order springs, weapon sway/recoil solvers, two-bone IK, and rig hierarchy helpers.

import { clamp, lerp } from './math.mjs';
import { CharacterRig, characterPose, advancePhase, strideFrequency, TAU } from './character-anim.mjs';

export { CharacterRig, characterPose, advancePhase, strideFrequency, TAU };

// Critically damped second-order spring for smooth, natural movement responses without popping.
export class ProceduralSpring {
  constructor({ frequency = 8, damping = 1, initial = 0 } = {}) {
    this.frequency = frequency;
    this.damping = damping;
    this.pos = initial;
    this.vel = 0;
    this.target = initial;
  }

  setTarget(target) {
    this.target = target;
  }

  snapTo(val) {
    this.pos = val;
    this.target = val;
    this.vel = 0;
  }

  update(dt) {
    const clampedDt = Math.max(0, Math.min(dt || 0, 0.1));
    const omega = 2 * Math.PI * this.frequency;
    const f = 1 + 2 * clampedDt * this.damping * omega;
    const oo = omega * omega;
    const ho = clampedDt * oo;
    const hho = clampedDt * ho;
    const detInv = 1 / (f + hho);
    const detPos = (f * this.pos + clampedDt * this.vel + hho * this.target) * detInv;
    this.vel = (this.vel + ho * (this.target - this.pos)) * detInv;
    this.pos = detPos;
    return this.pos;
  }
}

// Procedural 3D spring vector
export class VectorSpring3D {
  constructor({ frequency = 10, damping = 0.85, initial = { x: 0, y: 0, z: 0 } } = {}) {
    this.x = new ProceduralSpring({ frequency, damping, initial: initial.x });
    this.y = new ProceduralSpring({ frequency, damping, initial: initial.y });
    this.z = new ProceduralSpring({ frequency, damping, initial: initial.z });
  }

  setTarget(target) {
    if (target.x !== undefined) this.x.setTarget(target.x);
    if (target.y !== undefined) this.y.setTarget(target.y);
    if (target.z !== undefined) this.z.setTarget(target.z);
  }

  update(dt) {
    return {
      x: this.x.update(dt),
      y: this.y.update(dt),
      z: this.z.update(dt),
    };
  }
}

// Procedural weapon sway and recoil solver
export class WeaponRig {
  constructor() {
    this.swaySpring = new VectorSpring3D({ frequency: 8, damping: 0.82 });
    this.recoilSpring = new VectorSpring3D({ frequency: 14, damping: 0.75 });
    this.idleTimer = 0;
    this.jumpLand = 0;
    this.lastGrounded = true;
  }

  recoilImpulse({ kickZ = 0.08, pitch = 0.06, yaw = 0.02 } = {}) {
    this.recoilSpring.vel += kickZ * 12;
    this.recoilSpring.x.vel += (Math.random() - 0.5) * yaw * 10;
    this.recoilSpring.y.vel += pitch * 10;
  }

  update({
    dt = 1 / 60,
    mouseDeltaX = 0,
    mouseDeltaY = 0,
    velocity = { x: 0, y: 0, z: 0 },
    grounded = true,
    ads = false,
    speed = 0,
  } = {}) {
    this.idleTimer += dt;

    // Sway from mouse look
    const lookSwayX = clamp(-mouseDeltaX * 0.0012, -0.06, 0.06);
    const lookSwayY = clamp(mouseDeltaY * 0.0012, -0.05, 0.05);

    // Movement inertia sway
    const moveSwayX = clamp(-velocity.x * 0.003, -0.04, 0.04);
    const moveSwayZ = clamp(velocity.z * 0.003, -0.04, 0.04);

    // Idle breathing bob
    const idleScale = ads ? 0.2 : (1 - clamp(speed / 6, 0, 0.8));
    const idleX = Math.sin(this.idleTimer * 1.8) * 0.003 * idleScale;
    const idleY = Math.cos(this.idleTimer * 3.6) * 0.002 * idleScale;

    // Jump / landing compression
    if (this.lastGrounded === false && grounded) {
      this.jumpLand = 0.03;
    }
    this.lastGrounded = grounded;
    this.jumpLand = Math.max(0, this.jumpLand - dt * 6);

    const adsFactor = ads ? 0.25 : 1.0;
    this.swaySpring.setTarget({
      x: (lookSwayX + moveSwayX + idleX) * adsFactor,
      y: (lookSwayY + idleY - this.jumpLand) * adsFactor,
      z: moveSwayZ * adsFactor,
    });

    const sway = this.swaySpring.update(dt);
    const recoil = this.recoilSpring.update(dt);

    return {
      offset: {
        x: sway.x + recoil.x,
        y: sway.y + recoil.y,
        z: sway.z + recoil.z,
      },
      rotation: {
        pitch: recoil.y * 0.8 + sway.y * 0.4,
        yaw: recoil.x * 0.5 + sway.x * 0.5,
        roll: sway.x * 0.6,
      },
    };
  }
}

// Two-bone analytical IK solver (e.g. for legs and arms)
export function solveTwoBoneIK(rootPos, targetPos, upperLength, lowerLength, poleNormal = { x: 0, y: 0, z: 1 }) {
  const dx = targetPos.x - rootPos.x;
  const dy = targetPos.y - rootPos.y;
  const dz = targetPos.z - rootPos.z;
  const dist = Math.hypot(dx, dy, dz);
  const maxReach = (upperLength + lowerLength) * 0.9999;
  const minReach = Math.abs(upperLength - lowerLength) * 1.0001;
  const targetDist = clamp(dist, minReach, maxReach);

  // Law of cosines
  const cosUpper = (upperLength * upperLength + targetDist * targetDist - lowerLength * lowerLength) / (2 * upperLength * targetDist);
  const cosElbow = (upperLength * upperLength + lowerLength * lowerLength - targetDist * targetDist) / (2 * upperLength * lowerLength);

  const upperAngle = Math.acos(clamp(cosUpper, -1, 1));
  const elbowAngle = Math.PI - Math.acos(clamp(cosElbow, -1, 1));

  return {
    reachRatio: dist / (upperLength + lowerLength),
    upperAngle,
    elbowAngle,
    fullyExtended: dist >= maxReach,
  };
}
