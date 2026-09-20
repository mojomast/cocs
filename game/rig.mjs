// Advanced procedural rigging and kinematics for TokenArena.
// Provides second-order springs, weapon sway/recoil solvers, two-bone IK, and rig hierarchy helpers.

import { clamp, lerp } from './math.mjs';
import * as T from 'three';
import {corpseRotation,corpseTreatment,fallDuration} from './deaths.mjs';
import {chassisFor} from './weapon-models/chassis.mjs';
import { CharacterRig, characterPose, deathLimbPose, advancePhase, strideFrequency, TAU, SECONDARY_BOUNDS, SECONDARY_REST, secondaryChannel, angleDelta } from './character-anim.mjs';
import { RagdollPool, RAGDOLL_CHAIN, RAGDOLL_JOINT_NAMES, RAGDOLL_PARTICLES, RAGDOLL_REST, RAGDOLL_BLEND, RAGDOLL_MAX_AWAKE } from './ragdoll.mjs';

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
    this.stridePhase = 0;
    this.jumpLand = 0;
    this.lastGrounded = true;
    this.reloadTimer = 0;
    this.reloadDuration = 1.0;
    this.swapTimer = 0;
    this.swapDuration = 0.35;
    this.swapDirection = 1;
  }

  triggerReload(duration = 1.2) {
    this.reloadDuration = Math.max(0.1, duration);
    this.reloadTimer = this.reloadDuration;
  }

  triggerSwap(direction = 1, duration = 0.35) {
    this.swapDuration = Math.max(0.05, duration);
    this.swapTimer = this.swapDuration;
    this.swapDirection = direction;
  }

  recoilImpulse({ kickZ = 0.08, pitch = 0.06, yaw = 0.02 } = {}) {
    this.recoilSpring.z.vel += kickZ * 12;
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

    // Idle breathing bob (dual frequency Lissajous curve with smooth exhale plateau)
    const idleScale = ads ? 0.2 : (1 - clamp(speed / 6, 0, 0.8));
    const idleX = Math.sin(this.idleTimer * 1.6) * 0.003 * idleScale;
    const idleY = (Math.cos(this.idleTimer * 3.2) + Math.sin(this.idleTimer * 1.6) * 0.25) * 0.002 * idleScale;

    // Stride bob tied to movement cadence
    if (grounded && speed > 0.1) {
      this.stridePhase = (this.stridePhase + clamp(speed / 6, 0.2, 1.2) * TAU * 1.8 * dt) % TAU;
    }
    const strideScale = ads ? 0.15 : clamp(speed / 6, 0, 1);
    const strideX = Math.sin(this.stridePhase * 0.5) * 0.006 * strideScale;
    const strideY = -Math.abs(Math.sin(this.stridePhase)) * 0.005 * strideScale;

    // Dynamic strafe banking roll
    const strafeRoll = clamp(-velocity.x * 0.014, -0.07, 0.07);

    // Jump / landing compression
    if (this.lastGrounded === false && grounded) {
      this.jumpLand = 0.038;
    }
    this.lastGrounded = grounded;
    this.jumpLand = Math.max(0, this.jumpLand - dt * 6);

    // Procedural reload dip and tilt
    let reloadDipY = 0, reloadPitch = 0, reloadRoll = 0, reloadOffsetX = 0;
    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      const prog = 1 - this.reloadTimer / this.reloadDuration;
      reloadDipY = -0.055 * Math.sin(prog * Math.PI);
      reloadPitch = -0.05 * Math.sin(prog * Math.PI);
      reloadRoll = 0.07 * Math.sin(prog * Math.PI * 0.9);
      reloadOffsetX = -0.02 * Math.sin(prog * Math.PI);
    }

    // Procedural weapon swap tuck-down and raise-up with directional roll and shift
    let swapDipY = 0, swapPitch = 0, swapRoll = 0, swapOffsetX = 0;
    if (this.swapTimer > 0) {
      this.swapTimer = Math.max(0, this.swapTimer - dt);
      const prog = 1 - this.swapTimer / this.swapDuration;
      const swapEnv = Math.sin(prog * Math.PI);
      swapDipY = -0.12 * swapEnv;
      swapPitch = -0.07 * swapEnv;
      swapRoll = (this.swapDirection || 1) * 0.05 * swapEnv;
      swapOffsetX = (this.swapDirection || 1) * 0.02 * swapEnv;
    }

    const adsFactor = ads ? 0.25 : 1.0;
    this.swaySpring.setTarget({
      x: (lookSwayX + moveSwayX + idleX + strideX) * adsFactor,
      y: (lookSwayY + idleY + strideY - this.jumpLand) * adsFactor,
      z: moveSwayZ * adsFactor,
    });

    const sway = this.swaySpring.update(dt);
    const recoil = this.recoilSpring.update(dt);

    return {
      offset: {
        x: sway.x + recoil.x + reloadOffsetX + swapOffsetX,
        y: sway.y + recoil.y + reloadDipY + swapDipY,
        z: sway.z + recoil.z,
      },
      rotation: {
        pitch: recoil.y * 0.8 + sway.y * 0.4 + reloadPitch + swapPitch,
        yaw: recoil.x * 0.5 + sway.x * 0.5,
        roll: sway.x * 0.6 + strafeRoll + reloadRoll + swapRoll,
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

// ---- Living secondary motion ----------------------------------------------
//
// Deterministic, allocation-free spring layer for living actors. One
// SecondaryMotion instance per model owns scalar ProceduralSprings for head
// lag, antenna/backpack flex, wing-fin beat and crest sway; the pass advances
// them from the actor's own smoothed speed/turn/acceleration reads and writes:
//   - a bounded `secondary` channel on the rig (head/chest lag), and
//   - the tagged ancillary nodes (see node tags in view.mjs/models.mjs).
// Reduced motion and the cheap software path snap every spring to rest and
// write the rest pose once, so those modes cost a constant few assignments.
// Dead rigs are never written, which keeps `applyRagdoll` ownership intact.
export class SecondaryMotion {
  constructor() {
    // Frequencies are deliberately underdamped relative to the rig damping so
    // the parts trail the body; each is bounded again at channel write time.
    this.headYaw = new ProceduralSpring({ frequency: 3.4, damping: .78 });
    this.headPitch = new ProceduralSpring({ frequency: 3.8, damping: .8 });
    this.flexX = new ProceduralSpring({ frequency: 5.2, damping: .62 });
    this.flexZ = new ProceduralSpring({ frequency: 4.6, damping: .66 });
    this.finL = new ProceduralSpring({ frequency: 6.0, damping: .7 });
    this.finR = new ProceduralSpring({ frequency: 6.0, damping: .7 });
    this.crestX = new ProceduralSpring({ frequency: 4.4, damping: .6 });
    this.crestZ = new ProceduralSpring({ frequency: 4.0, damping: .62 });
    this.packX = new ProceduralSpring({ frequency: 3.2, damping: .85 });
    this.packZ = new ProceduralSpring({ frequency: 3.0, damping: .85 });
    this.channels = secondaryChannel(null);
    this.lastYaw = null;
    this.lastSpeed = 0;
  }

  // Every spring back to its rest value (and every channel zeroed) in place.
  snap() {
    this.headYaw.snapTo(0); this.headPitch.snapTo(0);
    this.flexX.snapTo(0); this.flexZ.snapTo(0);
    this.finL.snapTo(0); this.finR.snapTo(0);
    this.crestX.snapTo(0); this.crestZ.snapTo(0);
    this.packX.snapTo(0); this.packZ.snapTo(0);
    secondaryChannel(null, this.channels);
    this.lastSpeed = 0;
    return this.channels;
  }

  step({ dt = 0, speedNorm = 0, yaw = 0, turnRate = null, hit = 0, reduced = false, cheap = false } = {}) {
    const seconds = clamp(Number(dt) || 0, 0, .1);
    const speed = clamp(Number(speedNorm) || 0, 0, 1);
    const yawValue = Number.isFinite(yaw) ? yaw : 0;
    if (reduced || cheap) {
      this.snap();
      // Keep the input history current so leaving reduced motion cannot read a
      // stale yaw/speed delta as a one-frame whip.
      this.lastYaw = yawValue;
      this.lastSpeed = speed;
      return this.channels;
    }
    const impact = clamp(Number(hit) || 0, 0, 1);
    const turn = Number.isFinite(turnRate)
      ? clamp(turnRate, -8, 8)
      : (seconds > 1e-4 && this.lastYaw !== null ? clamp(angleDelta(this.lastYaw, yawValue) / seconds, -8, 8) : 0);
    const accel = seconds > 1e-4
      ? clamp((speed - this.lastSpeed) / seconds / 6, -1, 1)
      : 0;
    this.lastYaw = yawValue;
    this.lastSpeed = speed;
    const turnRead = clamp(turn / 6, -1, 1);
    const B = SECONDARY_BOUNDS;
    this.headYaw.setTarget(clamp(-turnRead * .42, -B.headYaw, B.headYaw));
    this.headPitch.setTarget(clamp(-accel * .26 - impact * .16, -B.headPitch, B.headPitch));
    this.flexX.setTarget(clamp(accel * .5 + impact * .42, -B.flexX, B.flexX));
    this.flexZ.setTarget(clamp(turnRead * .5, -B.flexZ, B.flexZ));
    this.finL.setTarget(clamp(speed * .24 + turnRead * .16, -B.finL, B.finL));
    this.finR.setTarget(clamp(speed * .24 - turnRead * .16, -B.finR, B.finR));
    this.crestX.setTarget(clamp(accel * .4, -B.crestX, B.crestX));
    this.crestZ.setTarget(clamp(turnRead * .42, -B.crestZ, B.crestZ));
    this.packX.setTarget(clamp(accel * .3, -B.packX, B.packX));
    this.packZ.setTarget(clamp(turnRead * .3, -B.packZ, B.packZ));
    const channels = this.channels;
    // Springs may overshoot their target slightly; every written channel is
    // clamped so the bounded contract holds for consumers.
    channels.headYaw = clamp(this.headYaw.update(seconds), -B.headYaw, B.headYaw);
    channels.headPitch = clamp(this.headPitch.update(seconds), -B.headPitch, B.headPitch);
    channels.flexX = clamp(this.flexX.update(seconds), -B.flexX, B.flexX);
    channels.flexZ = clamp(this.flexZ.update(seconds), -B.flexZ, B.flexZ);
    channels.finL = clamp(this.finL.update(seconds), -B.finL, B.finL);
    channels.finR = clamp(this.finR.update(seconds), -B.finR, B.finR);
    channels.crestX = clamp(this.crestX.update(seconds), -B.crestX, B.crestX);
    channels.crestZ = clamp(this.crestZ.update(seconds), -B.crestZ, B.crestZ);
    channels.packX = clamp(this.packX.update(seconds), -B.packX, B.packX);
    channels.packZ = clamp(this.packZ.update(seconds), -B.packZ, B.packZ);
    // Torso lag is derived from the head channel so the chest never leads the
    // head; both stay inside the shared bounds.
    channels.chestYaw = clamp(channels.headYaw * .45, -B.chestYaw, B.chestYaw);
    channels.chestRoll = clamp(-channels.flexZ * .3, -B.chestRoll, B.chestRoll);
    return channels;
  }
}

// Role -> flex gains for the tagged ancillary nodes. A tag may name several
// nodes; the pass caches the node list and its rest rotation on first sight.
const SECONDARY_ROLE_GAINS = Object.freeze({
  antenna: Object.freeze({ x: .55, z: .55 }),
  sensor: Object.freeze({ x: .35, z: .4 }),
  pack: Object.freeze({ x: .12, z: .12 }),
  crest: Object.freeze({ x: .5, z: .45 }),
  finL: Object.freeze({ x: .05, z: .32 }),
  finR: Object.freeze({ x: .05, z: -.32 }),
});
function secondaryNodes(model) {
  const data = model.userData;
  if (data.secondaryNodes) return data.secondaryNodes;
  const lists = { antenna: [], sensor: [], pack: [], crest: [], finL: [], finR: [] };
  model.traverse(node => {
    const role = node.userData?.secondary;
    if (!role || !lists[role] || !node.rotation) return;
    if (!node.userData.secondaryBase) node.userData.secondaryBase = { rx: node.rotation.x, ry: node.rotation.y, rz: node.rotation.z };
    lists[role].push(node);
  });
  data.secondaryNodes = lists;
  return lists;
}
function applySecondaryNodes(model, channels) {
  const lists = secondaryNodes(model);
  for (const role in lists) {
    const list = lists[role], gain = SECONDARY_ROLE_GAINS[role];
    if (!list.length) continue;
    const x = (role === 'finL' ? channels.finL : role === 'finR' ? channels.finR : role === 'pack' ? channels.packX : role === 'crest' ? channels.crestX : channels.flexX) * gain.x;
    const z = (role === 'finL' ? channels.finL : role === 'finR' ? channels.finR : role === 'pack' ? channels.packZ : role === 'crest' ? channels.crestZ : channels.flexZ) * gain.z;
    for (let i = 0; i < list.length; i++) {
      const node = list[i], base = node.userData.secondaryBase;
      node.rotation.x = base.rx + x;
      node.rotation.z = base.rz + z;
    }
  }
}

// Advances one living model's secondary pass after `CharacterRig.update` and
// the final alignment. `yaw` defaults to the model's own yaw; `turnRate` can be
// supplied by a host that already has it. Returns the live channel (never a
// fresh object) or null when the model has no rig or is no longer alive.
export function applyLivingSecondary(model, { dt = 0, reduced = false, cheap = false, speed = 0, maxSpeed = 8, hit = 0, yaw = null, turnRate = null } = {}) {
  const data = model?.userData, rig = data?.rig, joints = data?.joints;
  if (!model || !rig || !joints || data.corpse) return null;
  // Secondary motion is a living-only channel; the lifecycle owns joints once
  // a death record exists, so never write on a dying/settled rig.
  if (rig.lifecycle && rig.lifecycle !== 'alive') return null;
  const motion = data.secondaryRig ?? (data.secondaryRig = new SecondaryMotion());
  const speedNorm = clamp((Number(speed) || 0) / Math.max(.001, Number(maxSpeed) || 8), 0, 1);
  const yawValue = Number.isFinite(yaw) ? yaw : (Number.isFinite(model.rotation?.y) ? model.rotation.y : 0);
  motion.step({ dt, speedNorm, yaw: yawValue, turnRate, hit, reduced: reduced === true, cheap: cheap === true });
  // Cheap/reduced passes leave the channel at rest; the rig and the tagged
  // nodes are written with that rest pose, which is the same constant cost as
  // any other frame.
  rig.setSecondary(motion.channels);
  rig.writeSecondary();
  applySecondaryNodes(model, motion.channels);
  return motion.channels;
}


// Character presentation ownership; never writes authoritative actor state.
// World transforms belong to the view while alive, exclusively here while dead.
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
// Directional deaths fall away from the killing shot (the old view code used
// atan2(-dir.x,-dir.z)); void falls and self-damage carry no direction and keep
// the actor's own yaw. Returns null when the direction is absent or degenerate.
function deathYaw(direction) {
  const dx = Number.isFinite(direction?.x) ? direction.x : null;
  const dz = Number.isFinite(direction?.z) ? direction.z : null;
  if (dx !== null && dz !== null && Math.hypot(dx, dz) > 1e-6) return Math.atan2(-dx, -dz);
  return null;
}
// One-time conservative body envelope in model-local coordinates. Excludes
// floor rings, shields and labels: these are siblings of the articulated root.
function bodyEnvelope(model) {
  model.updateWorldMatrix(true,true);
  const inverse = model.matrixWorld.clone().invert(), matrix = new T.Matrix4();
  const bounds = new T.Box3(), point = new T.Vector3();
  (model.userData.joints?.root ?? model).traverseVisible(node => {
    if (!node.isMesh || !node.geometry || node.userData.noCharacterContact) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const b=node.geometry.boundingBox;if (!b || b.isEmpty()) return;
    matrix.multiplyMatrices(inverse,node.matrixWorld);
    for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])
      bounds.expandByPoint(point.set(x,y,z).applyMatrix4(matrix));
  });
  if(bounds.isEmpty()) bounds.set(new T.Vector3(-.3,0,-.2),new T.Vector3(.3,1.8,.2));
  // Fixed 3x3x3 contact lattice captures ends, sides and middle over steps.
  const points=[];
  for(const x of [bounds.min.x,(bounds.min.x+bounds.max.x)/2,bounds.max.x])
    for(const y of [bounds.min.y,(bounds.min.y+bounds.max.y)/2,bounds.max.y])
      for(const z of [bounds.min.z,(bounds.min.z+bounds.max.z)/2,bounds.max.z])points.push(new T.Vector3(x,y,z));
  return points;
}

// Analytic limb solve in the upper joint's parent space. Fixed-length bones,
// deterministic pole, no iteration and no actor/root translation. Uniform actor
// scale is supported; non-uniform ancestor scale is not an IK contract.
function placeLimb(upper, lower, end, target, orientation, pole) {
  const parent=upper.parent;
  parent.updateWorldMatrix(true,false);
  const local=parent.worldToLocal(target.clone()).sub(upper.position);
  const a=lower.parent.position.length(), b=end.position.length();
  const distance=local.length();
  if(!Number.isFinite(distance)||a<=0||b<=0) return false;
  const direction=local.clone().normalize();
  if(distance<1e-8) direction.set(0,-1,0);
  const reach=clamp(distance,Math.abs(a-b)+1e-5,a+b-1e-5);
  const along=(a*a+reach*reach-b*b)/(2*reach);
  const bend=pole.clone().addScaledVector(direction,-pole.dot(direction));
  if(bend.lengthSq()<1e-8) bend.set(0,0,1).addScaledVector(direction,-direction.z);
  bend.normalize().multiplyScalar(Math.sqrt(Math.max(0,a*a-along*along)));
  const elbow=direction.clone().multiplyScalar(along).add(bend);
  upper.quaternion.setFromUnitVectors(new T.Vector3(0,-1,0),elbow.clone().normalize());
  const lowerDirection=direction.multiplyScalar(reach).sub(elbow).normalize();
  const lowerQ=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,-1,0),lowerDirection);
  lower.quaternion.copy(upper.quaternion).invert().multiply(lowerQ);
  lower.updateWorldMatrix(true,false);
  end.quaternion.copy(lower.getWorldQuaternion(new T.Quaternion()).invert()).multiply(orientation);
  end.updateWorldMatrix(true,true);
  return true;
}

// Post-pose pass: call AFTER rig.update, gun aim and weapon replacement.
// Existing distinct authored anchors win. Legacy coincident defaults are only
// read as the frame for chassis-derived contact offsets, never edited.
// Max world distance an ankle may drift before the foot is replanted, and the
// vertical window that also forces a replant (a teleport/platform step).
const FOOT_PLANT_STEP=.25;
const FOOT_PLANT_DROP=.3;
export function alignLivingCharacter(model, {grounded=true, sampleGround} = {}) {
  const result={hands:[],feet:[]},d=model?.userData,j=d?.joints;
  if(!j?.contactGait || d.corpse || (d.rig?.lifecycle && d.rig.lifecycle!=='alive')) return result;
  const weapon=d.weapon;
  const anchors=weapon?.userData.anchors;
  const distinct=anchors?.leftGrip && anchors?.rightGrip &&
    anchors.leftGrip.getWorldPosition(new T.Vector3()).distanceTo(anchors.rightGrip.getWorldPosition(new T.Vector3()))>1e-5;
  const [width,height,length,,y]=chassisFor(weapon?.userData.type);
  const orientation=weapon?.getWorldQuaternion(new T.Quaternion());
  for(const side of weapon?['L','R']:[]) {
    const upper=j[`armUpper${side}`],lower=j[`forearm${side}`],hand=j[`hand${side}`],grip=d.characterRefinement?.[`grip${side}`];
    if(!upper||!lower||!hand||!grip) continue;
    const anchor=anchors?.[side==='L'?'leftGrip':'rightGrip'];
    const contact=new T.Vector3(side==='L'?-width/2-.025:0,y-height/2-(side==='L'?.015:.08),side==='L'?-length*.48:-.035);
    let target;
    if(distinct) target=anchor.getWorldPosition(new T.Vector3());
    else if(anchor) {
      // Calibrated offset relative to the existing fallback socket's frame.
      target=anchor.localToWorld(contact.sub(anchor.position));
    } else target=weapon.localToWorld(contact); // simple third-person chassis has no grip nodes
    const scale=hand.getWorldScale(new T.Vector3());
    const wrist=target.clone().sub(grip.position.clone().multiply(scale).applyQuaternion(orientation));
    placeLimb(upper,lower,hand,wrist,orientation,new T.Vector3(side==='L'?-1:1,-.4,.25));
    const error=grip.getWorldPosition(new T.Vector3()).distanceTo(target);
    result.hands.push({side,target:target.toArray(),error});
  }
  if(grounded && typeof sampleGround==='function') {
    const origin=model.getWorldPosition(new T.Vector3());
    const scale=model.getWorldScale(new T.Vector3());
    const upright=model.getWorldQuaternion(new T.Quaternion());
    const plants=d.footPlantRig??(d.footPlantRig={L:{x:0,z:0,y:0,top:0,set:false},R:{x:0,z:0,y:0,top:0,set:false}});
    const samples=[];
    // World-space foot planting. Exactly one ground query per foot, in L/R
    // order (the phase1-grips budget is pinned at two samples per eligible
    // living model). A foot keeps its planted world target until the ankle
    // walks more than FOOT_PLANT_STEP past it; slope stance derives its
    // toe/heel gradient from the two planted heights instead of extra probes.
    for(const side of ['L','R']) {
      const upper=j[`legUpper${side}`],lower=j[`legLower${side}`],foot=j[`foot${side}`];
      if(!upper||!lower||!foot){samples.push(null);continue;}
      const current=foot.getWorldPosition(new T.Vector3());
      const plant=plants[side];
      const stepped=!plant.set||Math.hypot(current.x-plant.x,current.z-plant.z)>FOOT_PLANT_STEP||Math.abs(current.y-plant.top)>FOOT_PLANT_DROP;
      if(stepped){plant.x=current.x;plant.z=current.z;plant.top=current.y;plant.set=true;}
      const floor=sampleGround(plant.x,plant.z,origin.y);
      // null/NaN/void or another floor: leave procedural gait untouched.
      if(!Number.isFinite(floor)||Math.abs(floor-origin.y)>.12*scale.y){samples.push(null);continue;}
      plant.y=floor;
      samples.push({side,upper,lower,foot,plant,stepped,floor});
    }
    const left=samples[0],right=samples[1],scratch=d.alignScratch??(d.alignScratch={gradient:new T.Vector3(),orientation:new T.Quaternion(),axisX:new T.Vector3(1,0,0),axisZ:new T.Vector3(0,0,1),tilt:new T.Quaternion(),forward:new T.Vector3(),right:new T.Vector3(),hip:new T.Vector3()});
    // Toe/heel + cross-slope stance from the planted pair: the gradient's
    // forward component pitches the foot and its lateral component rolls it.
    let slopePitch=0,slopeRoll=0;
    if(left&&right){
      const dx=left.plant.x-right.plant.x,dz=left.plant.z-right.plant.z,span=Math.hypot(dx,dz);
      if(span>1e-4){
        scratch.gradient.set((left.floor-right.floor)*dx/(span*span),0,(left.floor-right.floor)*dz/(span*span));
        scratch.forward.set(0,0,-1).applyQuaternion(upright).setY(0);
        if(scratch.forward.lengthSq()>1e-6){slopePitch=clamp(Math.atan(scratch.gradient.dot(scratch.forward.normalize())),-.32,.32);}
        scratch.right.set(1,0,0).applyQuaternion(upright).setY(0);
        if(scratch.right.lengthSq()>1e-6){slopeRoll=clamp(Math.atan(scratch.gradient.dot(scratch.right.normalize())),-.28,.28);}
      }
    }
    // Pelvis compensation runs before the IK placement so the solved ankle
    // targets stay exact: the root follows the mean support height, clamped to
    // the reach slack of the most distant foot so raising the pelvis can never
    // over-extend a leg (a clamped leg would otherwise miss its floor target).
    if(left&&right&&j.root&&d.rig?.pose){
      const mean=(left.floor+right.floor)/2;
      let comp=clamp(mean-origin.y,-.14,.14)*.5;
      if(comp>0){
        let slack=Infinity;
        for(const entry of [left,right]){
          const reach=(entry.lower.parent.position.length()+entry.foot.position.length())*scale.y*.9999;
          entry.upper.getWorldPosition(scratch.hip);
          const distance=Math.hypot(entry.plant.x-scratch.hip.x,entry.floor+.0935*scale.y-scratch.hip.y,entry.plant.z-scratch.hip.z);
          slack=Math.min(slack,reach-distance);
        }
        // `slack` is world-space; the root offset is model-space.
        comp=Math.max(0,Math.min(comp,Number.isFinite(slack)?slack/scale.y:0));
      }
      j.root.position.y=(j.rootBaseY??0)+d.rig.pose.rootY+comp;
      j.root.updateWorldMatrix(true,false);
    }
    for(const entry of samples) {
      if(!entry) continue;
      const {side,upper,lower,foot,plant,stepped,floor}=entry;
      const lift=d.rig?.pose?.[`leg${side}`]?.contactLift ?? 0;
      // The ankle target sits on the planted world spot, never below the
      // sampled floor (no penetration) and never above floor + sole + lift.
      const target=new T.Vector3(plant.x,floor+(.0935+lift)*scale.y,plant.z);
      const footOrientation=scratch.orientation.copy(upright);
      if(slopePitch||slopeRoll){
        footOrientation.multiply(scratch.tilt.setFromAxisAngle(scratch.axisX,slopePitch));
        footOrientation.multiply(scratch.tilt.setFromAxisAngle(scratch.axisZ,slopeRoll));
      }
      placeLimb(upper,lower,foot,target,footOrientation,new T.Vector3(0,0,-1));
      result.feet.push({side,target:target.toArray(),error:foot.getWorldPosition(new T.Vector3()).distanceTo(target),replanted:stepped===true,slope:{pitch:slopePitch,roll:slopeRoll}});
    }
  }
  return result;
}

export class CharacterLifecycle {
  constructor({maxCorpses = 24, maxLifetime = 4} = {}) {
    this.maxCorpses = clamp(Math.floor(finite(maxCorpses, 24)), 1, 64);
    this.maxLifetime = clamp(finite(maxLifetime, 4), .1, 8);
    this.active = new Map();
    this.records = new WeakMap();
    this.point = new T.Vector3();
    this.normal = new T.Vector3();
    this.up = new T.Vector3(0,1,0);
    this.slope = new T.Quaternion();
    // Presentation-only ragdoll pool. Capacity follows the corpse budget and
    // at most six corpses run physics at once; slots are reused across deaths.
    this.ragdolls = new RagdollPool({capacity:this.maxCorpses,maxAwake:RAGDOLL_MAX_AWAKE});
    this.ragdollFrame = {matrix:null,invMatrix:null,sampleGround:null,fallbackGround:0,blocks:null};
    this.inverseMatrix = new T.Matrix4();
    this.liveMatrix = new T.Matrix4();
    this.livePoint = new T.Vector3();
    this.ragdollLive = new Float64Array(RAGDOLL_PARTICLES*3);
    this.ragdollQuats = new Float64Array(RAGDOLL_CHAIN.length*4);
  }
  // A ragdoll is presentation sugar: reduced motion, the CPU renderer, hidden
  // bodies and the hidden local corpse all keep the authored fallback byte for
  // byte (including the 31-sample settled contract). An explicit option can
  // only tighten that gate, never widen it.
  _ragdollWanted(plan, {reduced=false,software=false,hidden=false,ragdoll=null}={}) {
    if(reduced===true||software===true||hidden===true)return false;
    if(plan?.hideBody===true)return false;
    return ragdoll!==false;
  }
  _ragdollBlend(age) {
    return Math.max(0,Math.min(1,1-finite(age,0)/RAGDOLL_BLEND));
  }
  // Model-local particle field of the living pose, captured before the rig is
  // reset. Joints that are missing (or implausibly far from their rest slot on
  // simple test rigs) fall back to the authored rest position.
  _captureLive(model, rig) {
    model.updateWorldMatrix(true,true);
    this.liveMatrix.copy(model.matrixWorld).invert();
    const live=this.ragdollLive,point=this.livePoint,joints=rig?.joints;
    for(let i=0;i<RAGDOLL_PARTICLES;i++){
      let x=RAGDOLL_REST[i*3],y=RAGDOLL_REST[i*3+1],z=RAGDOLL_REST[i*3+2];
      const node=joints?.[RAGDOLL_JOINT_NAMES[i]];
      if(typeof node?.getWorldPosition==='function'){
        node.getWorldPosition(point).applyMatrix4(this.liveMatrix);
        const dx=point.x-x,dy=point.y-y,dz=point.z-z;
        if(Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.z)&&dx*dx+dy*dy+dz*dz<.5625){x=point.x;y=point.y;z=point.z;}
      }
      live[i*3]=x;live[i*3+1]=y;live[i*3+2]=z;
    }
    return live;
  }
  // Killed-actor context for the pool: killing direction and actor velocity are
  // rotated into the corpse's model-local frame, and the live rig channels/hit
  // envelope are folded into the deterministic seed.
  _ragdollSeed(model, record, actor, direction, hit, slot = null) {
    const yaw=finite(record.yaw,0),c=Math.cos(yaw),s=Math.sin(yaw);
    const dx=Number.isFinite(direction?.x)?direction.x:0,dz=Number.isFinite(direction?.z)?direction.z:0;
    let localDirection=null;
    if(Math.hypot(dx,dz)>1e-6)localDirection={x:dx*c-dz*s,z:dx*s+dz*c};
    const vx=finite(actor?.vx,0),vy=finite(actor?.vy,0),vz=finite(actor?.vz,0);
    const rig=model.userData.rig;
    // A reseed must reuse the original hand-off snapshot: by then the joints
    // already hold physics, not the living pose.
    return {
      seed:record.plan.seed,
      plan:record.plan,
      direction:localDirection,
      velocity:{x:vx*c-vz*s,y:vy,z:vx*s+vz*c},
      live:slot?slot.live:this._captureLive(model,rig),
      liveQuats:slot?slot.liveQuats:(rig?.captureRagdollQuats?rig.captureRagdollQuats(this.ragdollQuats):null),
      hit,
    };
  }
  _ragdollFrame(model, sampleGround, blocks, fallbackY) {
    const frame=this.ragdollFrame;
    frame.matrix=model.matrixWorld.elements;
    this.inverseMatrix.copy(model.matrixWorld).invert();
    frame.invMatrix=this.inverseMatrix.elements;
    frame.sampleGround=typeof sampleGround==='function'?sampleGround:null;
    frame.fallbackGround=Number.isFinite(fallbackY)?fallbackY:0;
    frame.blocks=Array.isArray(blocks)?blocks:null;
    return frame;
  }
  state(model) { return this.records.get(model)?.state ?? 'alive'; }
  ownsTransform(model) { return ['dying', 'settled'].includes(this.state(model)); }
  update(model, actor, {time = 0, plan = {}, reduced = false, sampleGround, hidden = false, direction = null, authoritative = false, software = false, ragdoll = null, arena = null, blocks = null} = {}) {
    time = finite(time);
    let record = this.records.get(model);
    if (actor.health > 0) {
      if (record && this.ownsTransform(model)) {
        for (const b of record.bind) {
          b.node.position.copy(b.position); b.node.quaternion.copy(b.quaternion);
          b.node.rotation.order = b.order; b.node.scale.copy(b.scale); b.node.visible = b.visible;
        }
        model.position.set(finite(actor.x),finite(actor.y),finite(actor.z));
        model.rotation.set(0,finite(actor.bodyYaw,finite(actor.yaw)),0,'XYZ');
        if(record.ragdoll){this.ragdolls.release(record.ragdoll);record.ragdoll=null;}
        model.userData.rig?.reset();
        model.userData.corpse = false;
        model.userData.hitUntil = 0;
        record.state = 'respawning';
        this.active.delete(model);
      } else if (record?.state === 'respawning') record.state = 'alive';
      return this.state(model);
    }
    if (!record || !this.ownsTransform(model)) {
      const bind = [];
      model.traverse(node => bind.push({node,position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone(),order:node.rotation.order,visible:node.visible}));
      const directed = deathYaw(direction);
      record = {state:'dying',start:time,age:0,bind,plan:{...plan},planLocked:authoritative===true,x:finite(actor.x),y:finite(actor.y),z:finite(actor.z),yaw:directed ?? finite(actor.bodyYaw,finite(actor.yaw)),yawLocked:directed !== null,expired:false,limbed:false,ragdoll:null,leanX:0,leanZ:0,baseScale:{x:finite(model.scale?.x,1),y:finite(model.scale?.y,1),z:finite(model.scale?.z,1)}};
      this.records.set(model,record);this.active.set(model,record);
      // Evict before acquiring so the oldest corpse's pool slot is free for the
      // new one when the corpse budget is already full.
      while (this.active.size > this.maxCorpses) {
        const [old,entry] = this.active.entries().next().value;
        entry.expired = true; entry.state = 'settled'; old.visible = false;
        if (entry.ragdoll) { this.ragdolls.release(entry.ragdoll); entry.ragdoll = null; }
        this.active.delete(old);
      }
      // Capture the living pose and the final hit lean before the rig settles,
      // so a ragdoll corpse continues out of the kill frame instead of snapping
      // through rig.reset(). Reduced motion, the CPU renderer, hidden bodies and
      // the hidden local corpse keep the authored fallback path untouched.
      const wantRagdoll = this._ragdollWanted(record.plan,{reduced,software,hidden,ragdoll}) && typeof model.userData.rig?.applyRagdoll === 'function';
      record.leanX = clamp(finite(model.rotation.x,0),-.4,.4);
      record.leanZ = clamp(finite(model.rotation.z,0),-.4,.4);
      if (wantRagdoll) {
        const hit = Math.max(finite(model.userData.hitStrength,0),finite(model.userData.rig?.hit,0));
        const slot = this.ragdolls.acquire(this._ragdollSeed(model,record,actor,direction,hit));
        if (slot) record.ragdoll = slot;
      }
      if (record.ragdoll) {
        // Keep the live rig channels for the hand-off; the lifecycle flag is
        // what stops the living path from writing again.
        model.userData.rig.lifecycle = 'dying';
      } else {
        model.userData.rig?.reset();
        model.userData.rig?.apply(characterPose({}));
        if (model.userData.rig) model.userData.rig.lifecycle = 'dying';
      }
      record.head = model.userData.head ?? null;
      record.contacts = bodyEnvelope(model);
    }
    // The view poses the corpse in the actor pass before the death event is
    // dispatched, so the authoritative plan and the killing direction can both
    // arrive one frame after the record was created. Adopt them during that
    // first beat and restart the fall clock so the whole arc replays from the
    // authoritative context; after the window the settled timeline stands.
    if (authoritative === true && record.planLocked !== true && record.age <= .12) {
      record.plan = {...plan};
      record.planLocked = true;
      record.start = time;
      record.age = 0;
      record.limbed = false;
      // The view can learn the authoritative plan one frame late. Reseed the
      // ragdoll from the captured hand-off pose (zeroing its accumulator so the
      // whole fall replays from the new context), or acquire one now when the
      // fallback plan had no body. A body-hiding plan releases physics.
      const lateHit = Math.max(finite(model.userData.hitStrength,0),finite(model.userData.rig?.hit,0));
      if (record.plan.hideBody === true || hidden === true) {
        if (record.ragdoll) { this.ragdolls.release(record.ragdoll); record.ragdoll = null; }
      } else if (record.ragdoll) {
        this.ragdolls.reseed(record.ragdoll,this._ragdollSeed(model,record,actor,direction,lateHit,record.ragdoll));
      } else if (this._ragdollWanted(record.plan,{reduced,software,hidden,ragdoll}) && model.userData.rig) {
        const slot = this.ragdolls.acquire(this._ragdollSeed(model,record,actor,direction,lateHit));
        if (slot) record.ragdoll = slot;
      }
    }
    if (!record.yawLocked) {
      const late = deathYaw(direction);
      if (late !== null) { record.yaw = late; record.yawLocked = true; }
    }
    record.age = Math.max(record.age,time-record.start);
    const fall = reduced ? 1 : clamp(record.age/fallDuration(record.plan),0,1);
    const ease = fall*fall*(3-2*fall);
    const treatment = corpseTreatment(record.plan,fall);
    record.state = fall === 1 ? 'settled' : 'dying';
    if (model.userData.rig) model.userData.rig.lifecycle = record.state;
    model.userData.corpse = true;
    if (record.head) record.head.visible = !treatment.hideHead;
    if (record.baseScale) model.scale.set(record.baseScale.x*treatment.scale.x,record.baseScale.y*treatment.scale.y,record.baseScale.z*treatment.scale.z);
    if (record.age >= Math.min(this.maxLifetime,Math.max(.1,finite(record.plan.duration,this.maxLifetime)))) {
      record.expired = true; this.active.delete(model);
      if (record.ragdoll) { this.ragdolls.release(record.ragdoll); record.ragdoll = null; }
    }
    model.visible = !hidden && !treatment.hideBody && !record.expired;
    // Expired/evicted bodies never resume work or become visible before respawn.
    for (const node of [model.userData.shield,model.userData.base,...(model.userData.teamMarks??[])]) if(node) node.visible=false;
    if (!model.visible) return record.state;
    model.position.set(record.x,record.y,record.z);
    const rotation=corpseRotation(record.plan,fall,record.yaw,reduced);
    // The final hit lean decays into the fall over the ragdoll hand-off window
    // instead of being cleared the instant the corpse record appears.
    const handoff=record.ragdoll?this._ragdollBlend(record.age):0;
    model.rotation.set(rotation.x+record.leanX*handoff,rotation.y,rotation.z+record.leanZ*handoff,'YXZ');
    // Caller supplies authoritative floor/platform selection. null means void;
    // referenceY lets stacked-platform queries choose the actual supporting layer.
    const ground = (x,z) => {
      const value = sampleGround ? sampleGround(x,z,record.y) : record.y;
      return Number.isFinite(value) ? value : null;
    };
    const left=ground(record.x-.4,record.z),right=ground(record.x+.4,record.z);
    const back=ground(record.x,record.z-.4),front=ground(record.x,record.z+.4);
    if([left,right,back,front].every(Number.isFinite)) {
      this.normal.set(-clamp((right-left)/.8,-.6,.6)*ease,1,-clamp((front-back)/.8,-.6,.6)*ease).normalize();
      this.slope.setFromUnitVectors(this.up,this.normal);
      model.quaternion.premultiply(this.slope);
    }
    model.updateWorldMatrix(true,false);
    let lift=-Infinity;
    for(const contact of record.contacts) {
      this.point.copy(contact).applyMatrix4(model.matrixWorld);
      const floor=ground(this.point.x,this.point.z);
      if(floor!==null) lift=Math.max(lift,floor-this.point.y+.012);
    }
    // No fake floor in voids; bounded gravity until the lifetime cap hides it.
    model.position.y += Number.isFinite(lift) ? lift : -Math.min(20,4.9*record.age*record.age);
    model.updateWorldMatrix(true,true);
    // Ragdoll pass: particle physics in model-local space writes joint
    // rotations only. It stops writing the frame the corpse sleeps; a seeked
    // corpse settles on the authored silhouette once and then never samples.
    const slot = record.ragdoll;
    const ragdollRig = slot ? model.userData.rig : null;
    if (slot && ragdollRig) {
      if (slot.awake) {
        this.ragdolls.advance(slot,record.age,this._ragdollFrame(model,sampleGround,blocks ?? arena?.blocks ?? null,record.y));
        if (slot.awake) ragdollRig.applyRagdoll(slot.pose,this._ragdollBlend(record.age),slot.liveQuats);
      }
      if (!slot.awake && slot.dirty) {
        if (slot.snapped) ragdollRig.applyCorpse(deathLimbPose({pose:record.plan.pose,style:record.plan.style,seed:record.plan.seed??0,splay:record.plan.splay,roll:record.plan.roll,spin:record.plan.spin,progress:1,reduced:false}));
        else ragdollRig.applyRagdoll(slot.pose,this._ragdollBlend(record.age),null);
        slot.dirty = false;
      }
    }
    // Seeded limb splay while the fall advances; the frame that reaches the
    // settled pose writes once more and then the corpse is left untouched.
    if (model.userData.rig && !record.limbed && !slot) {
      model.userData.rig.applyCorpse(deathLimbPose({pose:record.plan.pose,style:record.plan.style,seed:record.plan.seed??0,splay:record.plan.splay,roll:record.plan.roll,spin:record.plan.spin,progress:fall,reduced}));
      if (fall >= 1) record.limbed = true;
    }
    return record.state;
  }
  // Removal is a disposal hook, not a revive; callers discard the model.
  release(model) {
    const record = this.records.get(model);
    if (record?.ragdoll) { this.ragdolls.release(record.ragdoll); record.ragdoll = null; }
    this.active.delete(model); this.records.delete(model);
  }
  // Match replacement reuses the pool scratch; dispose drops it entirely.
  clear() { this.active.clear(); this.records = new WeakMap(); this.ragdolls.clear(); }
  dispose() { this.clear(); this.ragdolls.dispose(); }
}
