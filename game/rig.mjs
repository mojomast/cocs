// Advanced procedural rigging and kinematics for TokenArena.
// Provides second-order springs, weapon sway/recoil solvers, two-bone IK, and rig hierarchy helpers.

import { clamp, lerp } from './math.mjs';
import * as T from 'three';
import {corpseRotation} from './deaths.mjs';
import {chassisFor} from './weapon-models/chassis.mjs';
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


// Character presentation ownership; never writes authoritative actor state.
// World transforms belong to the view while alive, exclusively here while dead.
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
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
    for(const side of ['L','R']) {
      const upper=j[`legUpper${side}`],lower=j[`legLower${side}`],foot=j[`foot${side}`];
      if(!upper||!lower||!foot) continue;
      const target=foot.getWorldPosition(new T.Vector3());
      const floor=sampleGround(target.x,target.z,origin.y);
      // null/NaN/void or another floor: leave procedural gait untouched.
      if(!Number.isFinite(floor)||Math.abs(floor-origin.y)>.12*scale.y) continue;
      const lift=d.rig?.pose?.[`leg${side}`]?.contactLift ?? 0;
      target.y=floor+(.0935+lift)*scale.y;
      placeLimb(upper,lower,foot,target,upright,new T.Vector3(0,0,-1));
      result.feet.push({side,target:target.toArray(),error:foot.getWorldPosition(new T.Vector3()).distanceTo(target)});
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
  }
  state(model) { return this.records.get(model)?.state ?? 'alive'; }
  ownsTransform(model) { return ['dying', 'settled'].includes(this.state(model)); }
  update(model, actor, {time = 0, plan = {}, reduced = false, sampleGround, hidden = false} = {}) {
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
      record = {state:'dying',start:time,age:0,bind,plan:{...plan},x:finite(actor.x),y:finite(actor.y),z:finite(actor.z),yaw:finite(actor.bodyYaw,finite(actor.yaw)),expired:false};
      this.records.set(model,record);this.active.set(model,record);
      model.userData.rig?.reset();
      model.userData.rig?.apply(characterPose({}));
      if (model.userData.rig) model.userData.rig.lifecycle = 'dying';
      record.contacts = bodyEnvelope(model);
      while (this.active.size > this.maxCorpses) {
        const [old,entry] = this.active.entries().next().value;
        entry.expired = true; entry.state = 'settled'; old.visible = false; this.active.delete(old);
      }
    }
    record.age = Math.max(record.age,time-record.start);
    const duration = record.plan.crumple ? 1.05 : .55;
    const fall = reduced ? 1 : clamp(record.age/duration,0,1);
    const ease = fall*fall*(3-2*fall);
    record.state = fall === 1 ? 'settled' : 'dying';
    if (model.userData.rig) model.userData.rig.lifecycle = record.state;
    model.userData.corpse = true;
    if (model.userData.head) model.userData.head.visible = record.plan.hideHead !== true;
    if (record.age >= Math.min(this.maxLifetime,Math.max(.1,finite(record.plan.duration,this.maxLifetime)))) {
      record.expired = true; this.active.delete(model);
    }
    model.visible = !hidden && !record.plan.hideBody && !record.expired;
    // Expired/evicted bodies never resume work or become visible before respawn.
    for (const node of [model.userData.shield,model.userData.base,...(model.userData.teamMarks??[])]) if(node) node.visible=false;
    if (!model.visible) return record.state;
    model.position.set(record.x,record.y,record.z);
    const rotation=corpseRotation(record.plan,fall,record.yaw,reduced);
    model.rotation.set(rotation.x,rotation.y,rotation.z,'YXZ');
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
    return record.state;
  }
  // Removal is a disposal hook, not a revive; callers discard the model.
  release(model) { this.active.delete(model); this.records.delete(model); }
  clear() { this.active.clear(); this.records = new WeakMap(); }
}
