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
import {hashUnit} from './deaths.mjs';

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
    const stride = speed * (0.34 + 0.52 * speed);
    pose.legL.hipX = swing * stride;
    pose.legR.hipX = -swing * stride;
    // Knees bend most as the leg travels behind the body.
    pose.legL.kneeX = 0.1 + Math.max(0, -swing) * (0.35 + 0.7 * speed) * speed;
    pose.legR.kneeX = 0.1 + Math.max(0, swing) * (0.35 + 0.7 * speed) * speed;
    pose.legL.ankleX = -pose.legL.hipX * 0.35;
    pose.legR.ankleX = -pose.legR.hipX * 0.35;
    // Arms counter-swing the legs; held arms shrink the swing during ADS.
    const armSwing = speed * (0.28 + 0.5 * speed) * (1 - ads * 0.75);
    pose.armL.shoulderX = -swing * armSwing;
    pose.armR.shoulderX = swing * armSwing;
    pose.armL.elbowX = -0.3 - Math.max(0, swing) * 0.35 * speed;
    pose.armR.elbowX = -0.3 - Math.max(0, -swing) * 0.35 * speed;
    pose.rootY = -bob * 0.045 * speed + (1 - speed) * Math.sin(time * 1.6) * 0.008;
    const sprintLean = speed > 0.6 ? (speed - 0.6) * 0.1 : 0;
    pose.torso.x = 0.05 + 0.16 * speed + forward * 0.05 + sprintLean;
    pose.torso.z = -strafe * 0.12 * (0.4 + speed);
    pose.hips.z = strafe * 0.05;
    pose.hips.y = swing * 0.08 * speed;
    const idleBreath = (1 - speed) * Math.sin(time * 2.0) * 0.012;
    pose.chest.x += idleBreath;
    pose.head.x += idleBreath * 0.4;
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

  // Dynamic strafe banking leg flexion and head stabilization
  if (strafe !== 0) {
    pose.legL.kneeX = clamp(pose.legL.kneeX + strafe * 0.06 * speed, -1.25, 1.25);
    pose.legR.kneeX = clamp(pose.legR.kneeX - strafe * 0.06 * speed, -1.25, 1.25);
  }
  pose.head.z = clamp(strafe * 0.04 - bank * 0.05, -0.5, 0.5);

  // Jump landing compression absorbs touchdown impact with knee flexion and torso lean
  const land = clamp(state.land ?? 0, 0, 1);
  if (land > 0) {
    pose.rootY -= land * 0.12;
    pose.legL.kneeX = clamp(pose.legL.kneeX + land * 0.22, -1.25, 1.25);
    pose.legR.kneeX = clamp(pose.legR.kneeX + land * 0.22, -1.25, 1.25);
    pose.torso.x = clamp(pose.torso.x + land * 0.08, -1.25, 1.25);
    pose.armL.shoulderZ = clamp(pose.armL.shoulderZ + land * 0.12, -1.25, 1.25);
    pose.armR.shoulderZ = clamp(pose.armR.shoulderZ - land * 0.12, -1.25, 1.25);
  }

  // Reload / weapon transition animation lowers offhand and angles main weapon arm
  const reload = clamp(state.reload ?? 0, 0, 1);
  if (reload > 0) {
    pose.armL.shoulderX = lerp(pose.armL.shoulderX, -0.65, reload);
    pose.armL.elbowX = lerp(pose.armL.elbowX, -1.05, reload);
    pose.armL.shoulderZ = lerp(pose.armL.shoulderZ, 0.18, reload);
    pose.armR.shoulderX = lerp(pose.armR.shoulderX, -0.75, reload);
    pose.armR.elbowX = lerp(pose.armR.elbowX, -0.85, reload);
    pose.chest.x = clamp(pose.chest.x + reload * 0.05, -1.25, 1.25);
  }

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

  // Opt-in measured limb lengths used by the refined operator model. Solve a
  // planted ankle, not independent hip/knee sine waves; no raycasts or iteration.
  // Keep generic/legacy rigs on their existing dimensions until opted in.
  if (grounded && state.contactGait) {
    const motion = state.reduced ? 0 : speed;
    pose.rootY = -.012 - motion*.025 - crouch*.06 - land*.02;
    pose.hips.x = pose.hips.y = pose.hips.z = 0;
    const direction = forward < -.05 ? -1 : 1;
    for (const [leg,offset] of [[pose.legL,0],[pose.legR,Math.PI]]) {
      const p=phase+offset;
      const lift=Math.max(0,Math.sin(p))*.05*motion*(1-crouch*.6)*(1-land*.5);
      const z=Math.cos(p)*.15*motion*direction*(1-crouch*.5);
      leg.contactLift=lift;
      const height=.69+pose.rootY-lift;
      const distance=clamp(Math.hypot(height,z),.011,.6899);
      const bend=Math.acos(clamp((.34*.34+distance*distance-.35*.35)/(2*.34*distance),-1,1));
      leg.hipX=Math.atan2(z,height)-bend;
      leg.kneeX=Math.PI-Math.acos(clamp((.34*.34+.35*.35-distance*distance)/(2*.34*.35),-1,1));
      leg.ankleX=-leg.hipX-leg.kneeX;
    }
  }

  // Final safety clamping ensures all rig angles remain strictly bounded
  for (const part of [pose.hips, pose.torso, pose.chest, pose.head]) {
    part.x = clamp(part.x, -1.25, 1.25);
    part.y = clamp(part.y, -1.25, 1.25);
    part.z = clamp(part.z, -1.25, 1.25);
  }
  for (const arm of [pose.armL, pose.armR]) {
    arm.shoulderX = clamp(arm.shoulderX, -1.25, 1.25);
    arm.shoulderZ = clamp(arm.shoulderZ, -1.25, 1.25);
    arm.elbowX = clamp(arm.elbowX, -1.25, 1.25);
  }
  for (const leg of [pose.legL, pose.legR]) {
    leg.hipX = clamp(leg.hipX, -1.25, 1.25);
    leg.kneeX = clamp(leg.kneeX, -1.25, 1.25);
    leg.ankleX = clamp(leg.ankleX, -1.25, 1.25);
  }

  return pose;
}

// ---- Corpse limb solver ----------------------------------------------------
//
// Deterministic, bounded limb splay for lifecycle-owned corpses. The living
// path never reads this; `CharacterRig.applyCorpse` is the only writer while a
// rig is dead, so `apply` keeps refusing stray living-path writes. Arms and
// legs settle from plan.splay/plan.pose/plan.roll plus a per-limb seeded
// offset, so two corpses of the same style never share one silhouette. Pure:
// no clock and no Math.random.
export function deathLimbPose({pose='forward',style='ragdoll',seed=0,splay=.5,roll=0,spin=0,progress=1,reduced=false}={}){
 const out=basePose();
 const s=clamp(splay,0,1),p=reduced?1:clamp(progress,0,1),settle=p*p*(3-2*p);
 const lean=clamp(roll,-1,1),tumble=clamp(spin,-1.6,1.6);
 const rnd=salt=>hashUnit(seed,salt);
 const aL=rnd(11),aR=rnd(17),lL=rnd(23),lR=rnd(29),loll=rnd(41);
 const wide=.6+.85*s+(Math.abs(tumble)>.9?.15:0);
 const armL={shoulderX:-.5,shoulderZ:.4,elbowX:-.7};
 const armR={shoulderX:-.45,shoulderZ:-.45,elbowX:-.65};
 const legL={hipX:.15,kneeX:.4,ankleX:-.05};
 const legR={hipX:.1,kneeX:.5,ankleX:-.04};
 if(pose==='back'){
  armL.shoulderX=-.1-.35*aL;armL.shoulderZ=.65+.25*wide+.35*aL;armL.elbowX=-.2-.3*aL;
  armR.shoulderX=-.15-.4*aR;armR.shoulderZ=-(.7+.4*aR);armR.elbowX=-.3-.35*aR;
  legL.hipX=.08+.25*lL;legL.kneeX=.35+.55*lL;legR.hipX=.06+.3*lR;legR.kneeX=.4+.6*lR;
 }else if(pose==='left'||pose==='right'){
  const side=pose==='left'?1:-1;
  const under=side>0?armL:armR,over=side>0?armR:armL,underLeg=side>0?legL:legR,overLeg=side>0?legR:legL;
  under.shoulderX=-.05-.1*aL;under.shoulderZ=side*(.3+.2*aL);under.elbowX=-1.05-.15*aL;
  over.shoulderX=-.5-.3*aR;over.shoulderZ=-side*(.45+.35*aR);over.elbowX=-.45-.35*aR;
  underLeg.hipX=.2+.25*lL;underLeg.kneeX=.35+.4*lL;
  overLeg.hipX=-.25-.25*lR;overLeg.kneeX=.8+.35*lR;
 }else if(pose==='crumple'){
  armL.shoulderX=-.3-.2*aL;armL.shoulderZ=.4+.15*aL;armL.elbowX=-1.1-.1*aL;
  armR.shoulderX=-.35-.2*aR;armR.shoulderZ=-(.4+.15*aR);armR.elbowX=-1.05-.1*aR;
  legL.hipX=-(.5+.2*lL);legL.kneeX=1.0+.2*lL;legR.hipX=-(.45+.25*lR);legR.kneeX=1.05+.15*lR;
 }else if(pose==='sprawl'){
  armL.shoulderX=-.35-.3*aL;armL.shoulderZ=.9+.35*aL;armL.elbowX=-.25-.45*aL;
  armR.shoulderX=-.3-.35*aR;armR.shoulderZ=-(.95+.3*aR);armR.elbowX=-.3-.4*aR;
  legL.hipX=.35+.4*lL;legL.kneeX=.25+.4*lL;legR.hipX=.2+.45*lR;legR.kneeX=.35+.5*lR;
 }else{
  // forward faceplant: arms reach out ahead, one shoulder leading the seed.
  armL.shoulderX=-.55-.45*aL;armL.shoulderZ=.3+.4*wide*.55+.35*aL;armL.elbowX=-.95-.25*aL;
  armR.shoulderX=-.35-.5*aR;armR.shoulderZ=-(.2+.4*wide*.55+.35*aR);armR.elbowX=-.6-.4*aR;
  legL.hipX=.12+.3*lL;legL.kneeX=.3+.5*lL;legR.hipX=.05+.42*lR;legR.kneeX=.45+.6*lR;
 }
 // Style beats: disintegrating styles fold in, spin/sprawl spreads wider, the
 // splatter flatten recipe straightens the legs so the wide body reads.
 if(style==='crumple'||style==='collapse'){armL.elbowX-=.15;armR.elbowX-=.15;legL.kneeX+=.15;legR.kneeX+=.15;}
 if(style==='spinout'){armL.shoulderZ+=.14;armR.shoulderZ-=.14;}
 if(style==='splatter'||style==='vaporize'){legL.kneeX*=.7;legR.kneeX*=.7;}
 // Roll bias shifts both arms and legs toward the settled lean side.
 armL.shoulderZ+=lean*.12;armR.shoulderZ+=lean*.12;
 legL.hipX+=lean*.08;legR.hipX+=lean*.08;
 const bound=(value,limit=1.25)=>Math.max(-limit,Math.min(limit,Number.isFinite(value)?value:0));
 const blend=(target,source)=>target.map((value,index)=>clamp(lerp(value,source[index],settle),-1.25,1.25));
 [out.armL.shoulderX,out.armL.shoulderZ,out.armL.elbowX]=blend([out.armL.shoulderX,out.armL.shoulderZ,out.armL.elbowX],[bound(armL.shoulderX),bound(armL.shoulderZ),bound(armL.elbowX)]);
 [out.armR.shoulderX,out.armR.shoulderZ,out.armR.elbowX]=blend([out.armR.shoulderX,out.armR.shoulderZ,out.armR.elbowX],[bound(armR.shoulderX),bound(armR.shoulderZ),bound(armR.elbowX)]);
 [out.legL.hipX,out.legL.kneeX,out.legL.ankleX]=blend([out.legL.hipX,out.legL.kneeX,out.legL.ankleX],[bound(legL.hipX),bound(legL.kneeX),bound(-legL.hipX*.35)]);
 [out.legR.hipX,out.legR.kneeX,out.legR.ankleX]=blend([out.legR.hipX,out.legR.kneeX,out.legR.ankleX],[bound(legR.hipX),bound(legR.kneeX),bound(-legR.hipX*.35)]);
 out.torso={x:clamp(lerp(out.torso.x,.05+lean*.08,settle),-1.25,1.25),y:clamp((aR-aL)*.25*settle,-.6,.6),z:clamp(lean*.2*settle,-.5,.5)};
 out.chest={x:0,y:clamp((aL-aR)*.12*settle,-.4,.4),z:clamp(lean*.12*settle,-.4,.4)};
 out.head={x:clamp(lerp(out.head.x,.08+lean*.12,settle),-1.25,1.25),y:clamp((loll-.5)*.6*settle,-.6,.6),z:clamp((lean*.3+(aL-.5)*.2)*settle,-.6,.6)};
 return out;
}

// ---- Rig ------------------------------------------------------------------

// Applies poses to a joint hierarchy. Joint objects are plain Three.js
// Object3D-like nodes (anything with position/rotation), so this stays free of
// an engine import. Missing joints are ignored, which keeps the rig resilient
// while the model is being rebuilt.
export class CharacterRig {
  constructor(joints = {}) {
    this.joints = joints;
    this.captureBind();
    this.phase = 0;
    this.speedNorm = 0;
    this.crouch = 0;
    this.ads = 0;
    this.strafe = 0;
    this.forward = 0;
    this.hit = 0;
    this.bodyYaw = 0;
    this.land = 0;
    this.reload = 0;
    this.lastGrounded = true;
  }

  captureBind() {
    this.bind = Object.values(this.joints).filter(n=>n?.position && n?.rotation).map(node=>({
      node, position:{x:node.position.x,y:node.position.y,z:node.position.z},
      rotation:{x:node.rotation.x,y:node.rotation.y,z:node.rotation.z,order:node.rotation.order},
      scale:node.scale?{x:node.scale.x,y:node.scale.y,z:node.scale.z}:null,
    }));
  }

  reset() {
    for (const b of this.bind) {
      Object.assign(b.node.position,b.position);
      b.node.rotation.set(b.rotation.x,b.rotation.y,b.rotation.z,b.rotation.order);
      if(b.scale) Object.assign(b.node.scale,b.scale);
    }
    for (const key of ['phase','speedNorm','crouch','ads','strafe','forward','hit','bodyYaw','land','reload']) this[key] = 0;
    this.lastGrounded = true;
    this.lifecycle = 'alive';
    this.pose = null;
  }

  update(state = {}) {
    // The lifecycle owns all joint writes while dead, including dt=0 callers.
    if (this.lifecycle && this.lifecycle !== 'alive') return null;
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
    const grounded = state.grounded !== false;
    if (this.lastGrounded === false && grounded) {
      this.land = 1.0;
    }
    this.lastGrounded = grounded;
    this.land = Math.max(0, this.land - dt * 5.5);
    if (state.land !== undefined) this.land = Math.max(this.land, clamp(state.land, 0, 1));
    if (state.reload !== undefined) this.reload = damp(this.reload, clamp(state.reload, 0, 1), 8, dt);
    else this.reload = damp(this.reload, 0, 8, dt);
    this.phase = advancePhase(this.phase, this.speedNorm, dt, grounded);
    const pose = characterPose({
      phase: this.phase,
      contactGait: this.joints.contactGait === true,
      reduced: state.reduced === true,
      speedNorm: this.speedNorm,
      grounded,
      crouch: this.crouch,
      ads: this.ads,
      strafe: this.strafe,
      forward: this.forward,
      focusYaw: state.focusYaw,
      focusPitch: state.focusPitch,
      bank: state.bank,
      hit: this.hit,
      land: this.land,
      reload: this.reload,
      time: state.time,
    });
    this.apply(pose);
    return pose;
  }

  apply(pose) {
    if (this.lifecycle && this.lifecycle !== 'alive') return;
    this._writePose(pose);
  }

  // Lifecycle-only corpse channel. `apply` keeps refusing dead writes so the
  // living view path can never fight the death pose; this is the single writer
  // CharacterLifecycle uses for its seeded limb splay while a rig is dead.
  applyCorpse(pose) {
    if (!this.lifecycle || this.lifecycle === 'alive') return;
    this._writePose(pose);
  }

  _writePose(pose) {
    this.pose = pose;
    const j = this.joints;
    // The robot mesh faces -Z, but the rig poses are authored for a +Z front, so
    // negate the pitch axis on application (yaw/roll are unaffected).
    const ro = (node, x, y, z) => { if (!node) return; node.rotation.set(-(x ?? 0), y ?? 0, z ?? 0); };
    if (j.root && pose.rootY !== undefined) j.root.position.y = (j.rootBaseY ?? 0) + pose.rootY;
    ro(j.hips, pose.hips.x, pose.hips.y, pose.hips.z);
    ro(j.torso, pose.torso.x, pose.torso.y, pose.torso.z);
    ro(j.chest, pose.chest.x, pose.chest.y, pose.chest.z);
    ro(j.head, pose.head.x, pose.head.y, pose.head.z);
    ro(j.armUpperL, pose.armL.shoulderX, 0, pose.armL.shoulderZ);
    ro(j.armUpperR, pose.armR.shoulderX, 0, pose.armR.shoulderZ);
    ro(j.forearmL, pose.armL.elbowX, 0, 0);
    ro(j.forearmR, pose.armR.elbowX, 0, 0);
    // Wrist orientation belongs to the optional post-pose grip pass. Clear it
    // with the base pose so missing weapons/disabled passes never retain IK.
    ro(j.handL, 0, 0, 0);
    ro(j.handR, 0, 0, 0);
    ro(j.legUpperL, pose.legL.hipX, 0, 0);
    ro(j.legUpperR, pose.legR.hipX, 0, 0);
    ro(j.legLowerL, pose.legL.kneeX, 0, 0);
    ro(j.legLowerR, pose.legR.kneeX, 0, 0);
    ro(j.footL, pose.legL.ankleX, 0, 0);
    ro(j.footR, pose.legR.ankleX, 0, 0);
  }
}
