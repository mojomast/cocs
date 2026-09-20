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
import {RAGDOLL_CHAIN, RAGDOLL_PARTICLES, RAGDOLL_REST} from './ragdoll.mjs';

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

// Bounded presentation-only channels applied after the main pose by the rig's
// secondary pass. Every consumer clamps through this table so a spring can
// never drag a joint outside its authored arc.
export const SECONDARY_BOUNDS = Object.freeze({
  headYaw: .45, headPitch: .4, chestYaw: .25, chestRoll: .3,
  flexX: .6, flexZ: .6, finL: .5, finR: .5, crestX: .45, crestZ: .45, packX: .3, packZ: .3,
});
export const SECONDARY_REST = Object.freeze(Object.fromEntries(Object.keys(SECONDARY_BOUNDS).map(key => [key, 0])));
// Copy a source channel into `out` (or a fresh object) with every value clamped.
export function secondaryChannel(source, out = {}) {
  for (const key in SECONDARY_BOUNDS) out[key] = clamp(Number(source?.[key]) || 0, -SECONDARY_BOUNDS[key], SECONDARY_BOUNDS[key]);
  return out;
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
//  accel       -1..1 damped forward acceleration lean
//  lateral     -1..1 damped lateral acceleration roll
//  landRoll    -1..1 asymmetric touchdown roll
//  slide       0..1 slide stance blend
//  secondary   bounded spring channel (see SECONDARY_BOUNDS)
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

  // Damped acceleration reads: speeding up leans the torso forward, braking
  // leans it back, and lateral acceleration rolls the shoulders into the turn.
  const accel = clamp(state.accel ?? 0, -1, 1);
  if (accel !== 0) {
    pose.torso.x = clamp(pose.torso.x + accel * 0.12, -1.25, 1.25);
    pose.hips.x = clamp(pose.hips.x - accel * 0.05, -1.25, 1.25);
  }
  const lateral = clamp(state.lateral ?? 0, -1, 1);
  if (lateral !== 0) {
    pose.torso.z = clamp(pose.torso.z - lateral * 0.16, -1.25, 1.25);
    pose.hips.z = clamp(pose.hips.z + lateral * 0.07, -1.25, 1.25);
    pose.chest.y = clamp(pose.chest.y - lateral * 0.05, -1.25, 1.25);
  }

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
  // Asymmetric touchdown roll keeps the touchdown readable after the
  // compression itself has decayed: the roll side leans through the knee.
  const landRoll = clamp(state.landRoll ?? 0, -1, 1);
  if (landRoll !== 0) {
    pose.torso.z = clamp(pose.torso.z + landRoll * 0.14, -1.25, 1.25);
    pose.hips.z = clamp(pose.hips.z + landRoll * 0.08, -1.25, 1.25);
    pose.chest.y = clamp(pose.chest.y - landRoll * 0.05, -1.25, 1.25);
  }

  // Slide stance: legs shoot forward, hips settle and the torso leans back so
  // the slide reads as grounded momentum instead of a sprint pose.
  const slide = clamp(state.slide ?? 0, 0, 1);
  if (slide > 0) {
    pose.rootY -= slide * 0.18;
    pose.torso.x = clamp(pose.torso.x - slide * 0.24, -1.25, 1.25);
    pose.legL.hipX = lerp(pose.legL.hipX, 0.6, slide);
    pose.legL.kneeX = lerp(pose.legL.kneeX, 0.3, slide);
    pose.legR.hipX = lerp(pose.legR.hipX, -0.15, slide);
    pose.legR.kneeX = lerp(pose.legR.kneeX, 0.7, slide);
    pose.armL.shoulderX = lerp(pose.armL.shoulderX, -0.7, slide);
    pose.armR.shoulderX = lerp(pose.armR.shoulderX, -0.7, slide);
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
    pose.rootY = -.012 - motion*.025 - crouch*.06 - land*.02 - slide*.12;
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

  // Post-pose secondary channel. Reduced motion (and a missing source) resolve
  // to the shared frozen rest channel so no spring can leak into a snapshot.
  pose.secondary = state.reduced || !state.secondary ? SECONDARY_REST : secondaryChannel(state.secondary);

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

// ---- Ragdoll joint adapter -------------------------------------------------
//
// The physics field lives in ragdoll.mjs; this adapter turns particle positions
// back into joint rotations. Each bone's world orientation is the minimal
// rotation from its rest direction to the current direction applied on top of
// its captured bind orientation; leaf joints (head, hands, feet) follow their
// parent. The quaternion math is local so this module stays free of an engine
// import.
const qMul = (out, a, b) => {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
};
const qConj = (out, q) => { out[0] = -q[0]; out[1] = -q[1]; out[2] = -q[2]; out[3] = q[3]; return out; };
const qFromUnitVectors = (out, ax, ay, az, bx, by, bz) => {
  const dot = ax * bx + ay * by + az * bz;
  if (dot < -.9999999) {
    let px = 1, py = 0, pz = 0;
    if (Math.abs(ax) > .9) { px = 0; py = 1; pz = 0; }
    const rx = ay * pz - az * py, ry = az * px - ax * pz, rz = ax * py - ay * px;
    const length = Math.hypot(rx, ry, rz) || 1;
    out[0] = rx / length; out[1] = ry / length; out[2] = rz / length; out[3] = 0;
    return out;
  }
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const w = 1 + dot, length = Math.hypot(cx, cy, cz, w) || 1;
  out[0] = cx / length; out[1] = cy / length; out[2] = cz / length; out[3] = w / length;
  return out;
};
const eulerXYZToQuaternion = (out, x, y, z) => {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  out[0] = s1 * c2 * c3 + c1 * s2 * s3;
  out[1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[2] = c1 * c2 * s3 + s1 * s2 * c3;
  out[3] = c1 * c2 * c3 - s1 * s2 * s3;
  return out;
};
const quaternionToEulerXYZ = (out, x, y, z, w) => {
  const sinY = clamp(2 * (x * z + w * y), -1, 1);
  out[1] = Math.asin(sinY);
  if (Math.abs(sinY) < .9999999) {
    out[0] = Math.atan2(2 * (w * x - y * z), 1 - 2 * (x * x + y * y));
    out[2] = Math.atan2(2 * (w * z - x * y), 1 - 2 * (y * y + z * z));
  } else {
    out[0] = Math.atan2(-2 * (y * z - w * x), 1 - 2 * (x * x + z * z));
    out[2] = 0;
  }
  return out;
};

// ---- Rig ------------------------------------------------------------------

// Applies poses to a joint hierarchy. Joint objects are plain Three.js
// Object3D-like nodes (anything with position/rotation), so this stays free of
// an engine import. Missing joints are ignored, which keeps the rig resilient
// while the model is being rebuilt.
export class CharacterRig {
  constructor(joints = {}) {
    this.joints = joints;
    this._ragdoll = null;
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
    // Smoothed presentation channels. `bank` is no longer consumed raw;
    // acceleration/lateral reads are damped from the rig's own smoothed inputs
    // so a snapshot step cannot pop the lean. `secondary` is the bounded
    // post-pose channel written by the secondary pass (rig.mjs).
    this.bank = 0;
    this.accel = 0;
    this.lateral = 0;
    this.landRoll = 0;
    this.slide = 0;
    this.slideTarget = 0;
    this.hitPitch = 0;
    this.hitRoll = 0;
    this.secondary = {...SECONDARY_REST};
  }

  captureBind() {
    this.bind = Object.values(this.joints).filter(n=>n?.position && n?.rotation).map(node=>{
      const quaternion=new Float64Array(4);
      if(node.quaternion && Number.isFinite(node.quaternion.x)) quaternion.set([node.quaternion.x,node.quaternion.y,node.quaternion.z,node.quaternion.w]);
      else eulerXYZToQuaternion(quaternion,node.rotation.x||0,node.rotation.y||0,node.rotation.z||0);
      return {
        node, position:{x:node.position.x,y:node.position.y,z:node.position.z},
        rotation:{x:node.rotation.x,y:node.rotation.y,z:node.rotation.z,order:node.rotation.order},
        scale:node.scale?{x:node.scale.x,y:node.scale.y,z:node.scale.z}:null,
        quaternion,
      };
    });
    // Bind data feeds the ragdoll joint frames; rebuild them on any recapture.
    this._ragdoll=null;
  }

  reset() {
    for (const b of this.bind) {
      Object.assign(b.node.position,b.position);
      b.node.rotation.set(b.rotation.x,b.rotation.y,b.rotation.z,b.rotation.order);
      if(b.scale) Object.assign(b.node.scale,b.scale);
    }
    for (const key of ['phase','speedNorm','crouch','ads','strafe','forward','hit','bodyYaw','land','reload','bank','accel','lateral','landRoll','slide','slideTarget','hitPitch','hitRoll']) this[key] = 0;
    Object.assign(this.secondary, SECONDARY_REST);
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
    const prevSpeed = this.speedNorm, prevStrafe = this.strafe;
    this.speedNorm = damp(this.speedNorm, speedNorm, 8, dt);
    this.crouch = damp(this.crouch, clamp(state.crouch ? 1 : 0, 0, 1), 10, dt);
    this.ads = damp(this.ads, clamp(state.ads ? 1 : 0, 0, 1), 10, dt);
    this.strafe = damp(this.strafe, clamp(state.strafe ?? 0, -1, 1), 8, dt);
    this.forward = damp(this.forward, clamp(state.forward ?? 0, -1, 1), 8, dt);
    // Bank, acceleration and slide are presentation reads: damp them here so a
    // one-frame snapshot change reads as body language instead of a pop.
    this.bank = damp(this.bank, clamp(state.bank ?? 0, -1, 1), 6, dt);
    const rates = dt > 1e-4 ? 1 / dt : 0;
    this.accel = damp(this.accel, clamp((this.speedNorm - prevSpeed) * rates / 6, -1, 1), 5, dt);
    this.lateral = damp(this.lateral, clamp((this.strafe - prevStrafe) * rates / 6, -1, 1), 5, dt);
    this.hit = Math.max(0, this.hit - dt * 4);
    if (state.hit) this.hit = Math.max(this.hit, clamp(state.hit, 0, 1));
    const grounded = state.grounded !== false;
    if (this.lastGrounded === false && grounded) {
      this.land = 1.0;
      // Touchdown roll keeps the lateral input the body landed with; the
      // decay is deliberately asymmetric (positive roll lingers longer).
      this.landRoll = clamp(-this.strafe, -1, 1);
    }
    this.lastGrounded = grounded;
    this.land = Math.max(0, this.land - dt * 5.5);
    this.landRoll = damp(this.landRoll, 0, this.landRoll >= 0 ? 3.4 : 6.2, dt);
    if (state.land !== undefined) this.land = Math.max(this.land, clamp(state.land, 0, 1));
    if (state.reload !== undefined) this.reload = damp(this.reload, clamp(state.reload, 0, 1), 8, dt);
    else this.reload = damp(this.reload, 0, 8, dt);
    const slideTarget = state.sliding === true ? 1 : clamp(state.slide ?? 0, 0, 1);
    // A host may feed the slide state through `setSliding` (the view's final
    // living pass does) so the stance can follow the actor without the actor
    // state pass needing a sliding field in its rig.update call.
    if (state.sliding !== undefined || state.slide !== undefined) this.slideTarget = slideTarget;
    this.slide = damp(this.slide, this.slideTarget, 7, dt);
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
      bank: this.bank,
      hit: this.hit,
      land: this.land,
      reload: this.reload,
      accel: this.accel,
      lateral: this.lateral,
      landRoll: this.landRoll,
      slide: this.slide,
      time: state.time,
    });
    // The live secondary channel is attached by reference (no per-frame copy);
    // the spring pass advances it and re-writes the head/chest afterwards.
    pose.secondary = this.secondary;
    this.apply(pose);
    return pose;
  }

  // Copies a bounded secondary channel produced by the spring pass into the
  // rig-live channel, clamped through SECONDARY_BOUNDS. Returns the live object
  // so callers can read it without allocating.
  setSecondary(channel) {
    return secondaryChannel(channel, this.secondary);
  }

  // Post-pose hit-direction pitch/roll. The model rotation already carries the
  // world-space lean; this pitches the rig joints so the flinch reads through
  // the spine as well. Bounded, and scaled by the decaying `hit` envelope at
  // write time so it fades with the rest of the flinch.
  setHitDirection(x, z, strength = 1) {
    const length = Math.hypot(Number(x) || 0, Number(z) || 0);
    const power = clamp(Number(strength) || 0, 0, 1) * clamp(this.hit, 0, 1);
    if (length < 1e-6) { this.hitPitch = 0; this.hitRoll = 0; return; }
    this.hitPitch = clamp((z / length) * power * 0.3, -0.4, 0.4);
    this.hitRoll = clamp((x / length) * power * 0.24, -0.35, 0.35);
  }

  // Host hook for the slide stance: the view's final living pass feeds the
  // actor's `sliding` flag here, and `update` damps toward it each frame.
  setSliding(value) {
    this.slideTarget = value === true ? 1 : clamp(Number(value) || 0, 0, 1);
    return this.slideTarget;
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

  // Captures the current local quaternion of every ragdoll joint into `out`
  // (16 x [x,y,z,w]) before the living pose is reset. The lifecycle stores this
  // snapshot in the pool slot and `applyRagdoll` blends it out over the
  // hand-off window instead of teleporting the corpse to bind.
  captureRagdollQuats(out) {
    const rig=this._ragdollRig(),temp=rig.temp;
    for(let k=0;k<rig.links.length;k++){
      const node=rig.links[k].node,o=k*4;
      if(node?.quaternion&&Number.isFinite(node.quaternion.x)){
        out[o]=node.quaternion.x;out[o+1]=node.quaternion.y;out[o+2]=node.quaternion.z;out[o+3]=node.quaternion.w;
      }else if(node?.rotation){
        eulerXYZToQuaternion(temp,node.rotation.x||0,node.rotation.y||0,node.rotation.z||0);
        out[o]=temp[0];out[o+1]=temp[1];out[o+2]=temp[2];out[o+3]=temp[3];
      }else{
        out[o]=0;out[o+1]=0;out[o+2]=0;out[o+3]=1;
      }
    }
    return out;
  }

  // Ragdoll corpse channel. `pose.particles` is the pool slot's model-local
  // particle field (Float64Array of 16 x/y/z triples). Only joint rotations are written;
  // the kinematic root above stays owned by the lifecycle. `blend` 1..0 mixes
  // the captured live quaternions back in so the kill frame keeps the living
  // pose and the final hit lean before physics takes over.
  applyRagdoll(pose, blend = 0, liveQuats = null) {
    if(!this.lifecycle||this.lifecycle==='alive')return;
    const particles=pose?.particles;
    if(!particles||particles.length<RAGDOLL_PARTICLES*3)return;
    const rig=this._ragdollRig(),mix=clamp(blend,0,1),euler=rig.euler;
    for(let k=0;k<rig.links.length;k++){
      const link=rig.links[k],target=rig.world[k];
      if(link.child>=0){
        const a=link.particle*3,b=link.child*3;
        const r0x=RAGDOLL_REST[b]-RAGDOLL_REST[a],r0y=RAGDOLL_REST[b+1]-RAGDOLL_REST[a+1],r0z=RAGDOLL_REST[b+2]-RAGDOLL_REST[a+2];
        const l0=Math.hypot(r0x,r0y,r0z)||1;
        const d1x=particles[b]-particles[a],d1y=particles[b+1]-particles[a+1],d1z=particles[b+2]-particles[a+2];
        const l1=Math.hypot(d1x,d1y,d1z);
        if(l1>1e-8){
          qFromUnitVectors(rig.delta,r0x/l0,r0y/l0,r0z/l0,d1x/l1,d1y/l1,d1z/l1);
          qMul(target,rig.delta,link.world);
        }else target.set(link.world);
      }else if(link.parent>=0)qMul(target,rig.world[link.parent],link.local);
      else target.set(link.local);
      let qx=target[0],qy=target[1],qz=target[2],qw=target[3];
      if(link.parent>=0){
        qConj(rig.inverse,rig.world[link.parent]);
        qMul(rig.local,rig.inverse,target);
        qx=rig.local[0];qy=rig.local[1];qz=rig.local[2];qw=rig.local[3];
      }
      if(mix>0&&liveQuats){
        const o=k*4;
        let lx=liveQuats[o],ly=liveQuats[o+1],lz=liveQuats[o+2],lw=liveQuats[o+3];
        if(lx*lx+ly*ly+lz*lz+lw*lw<.5){lx=link.local[0];ly=link.local[1];lz=link.local[2];lw=link.local[3];}
        if(qx*lx+qy*ly+qz*lz+qw*lw<0){lx=-lx;ly=-ly;lz=-lz;lw=-lw;}
        const t=1-mix;
        qx=qx*t+lx*mix;qy=qy*t+ly*mix;qz=qz*t+lz*mix;qw=qw*t+lw*mix;
        const length=Math.hypot(qx,qy,qz,qw)||1;
        qx/=length;qy/=length;qz/=length;qw/=length;
      }
      const node=link.node;
      if(!node)continue;
      if(node.quaternion&&typeof node.quaternion.set==='function')node.quaternion.set(qx,qy,qz,qw);
      else if(node.rotation&&typeof node.rotation.set==='function'){
        quaternionToEulerXYZ(euler,qx,qy,qz,qw);
        node.rotation.set(euler[0],euler[1],euler[2]);
      }
    }
    this.pose=pose;
  }

  // Builds and caches the ragdoll joint frames: bind local quaternions, bind
  // world orientations and the desired-world scratch used by applyRagdoll.
  // Joints added to `this.joints` after captureBind read their current
  // orientation as bind, which keeps test rigs and late-attached hands sane.
  _ragdollRig() {
    if(this._ragdoll)return this._ragdoll;
    const bindByNode=new Map();
    for(const entry of this.bind)bindByNode.set(entry.node,entry);
    const links=[],byJoint=new Map(),temp=new Float64Array(4);
    for(const link of RAGDOLL_CHAIN){
      const node=this.joints[link.joint]||null,bind=node?bindByNode.get(node):null;
      const local=new Float64Array(4);
      if(bind?.quaternion)local.set(bind.quaternion);
      else if(node?.quaternion&&Number.isFinite(node.quaternion.x))local.set([node.quaternion.x,node.quaternion.y,node.quaternion.z,node.quaternion.w]);
      else if(node?.rotation)eulerXYZToQuaternion(local,node.rotation.x||0,node.rotation.y||0,node.rotation.z||0);
      else local[3]=1;
      const parent=link.parent==null?-1:(byJoint.get(link.parent)?.index??-1);
      const entry={index:links.length,joint:link.joint,node,particle:link.particle,child:link.child,parent,local,world:new Float64Array(4)};
      links.push(entry);byJoint.set(link.joint,entry);
    }
    for(const entry of links){
      const parent=entry.parent>=0?links[entry.parent]:null;
      if(parent)qMul(entry.world,parent.world,entry.local);
      else entry.world.set(entry.local);
    }
    this._ragdoll={links,temp,world:links.map(()=>new Float64Array(4)),delta:new Float64Array(4),inverse:new Float64Array(4),local:new Float64Array(4),euler:new Float64Array(3)};
    return this._ragdoll;
  }

  _writePose(pose) {
    this.pose = pose;
    const j = this.joints;
    // The robot mesh faces -Z, but the rig poses are authored for a +Z front, so
    // negate the pitch axis on application (yaw/roll are unaffected).
    const ro = (node, x, y, z) => { if (!node) return; node.rotation.set(-(x ?? 0), y ?? 0, z ?? 0); };
    // Secondary head/chest lag is part of the pose channel when the caller
    // supplied one, otherwise the rig-live channel (post-pose pass) is used.
    // Corpse channels never inherit the living springs.
    const live = !this.lifecycle || this.lifecycle === 'alive';
    const sec = pose.secondary ? pose.secondary : (live && this.secondary ? this.secondary : SECONDARY_REST);
    if (j.root && pose.rootY !== undefined) j.root.position.y = (j.rootBaseY ?? 0) + pose.rootY;
    ro(j.hips, pose.hips.x, pose.hips.y, pose.hips.z);
    ro(j.torso, pose.torso.x, pose.torso.y, pose.torso.z);
    ro(j.chest, pose.chest.x, pose.chest.y + (sec.chestYaw || 0), pose.chest.z + (sec.chestRoll || 0));
    ro(j.head, pose.head.x + (sec.headPitch || 0), pose.head.y + (sec.headYaw || 0), pose.head.z);
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

  // Post-pose secondary re-write. Only the head and chest are touched, so a
  // solved wrist/ankle IK pose is never disturbed; a dead rig returns without
  // writing (the lifecycle owns every joint then).
  writeSecondary() {
    if (this.lifecycle && this.lifecycle !== 'alive') return false;
    const pose = this.pose, j = this.joints;
    if (!pose) return false;
    const sec = this.secondary ?? SECONDARY_REST;
    const ro = (node, x, y, z) => { if (node) node.rotation.set(-(x ?? 0), y ?? 0, z ?? 0); };
    ro(j.chest, pose.chest.x, pose.chest.y + (sec.chestYaw || 0), pose.chest.z + (sec.chestRoll || 0));
    ro(j.head, pose.head.x + (sec.headPitch || 0), pose.head.y + (sec.headYaw || 0), pose.head.z);
    return true;
  }

  // Post-pose hit-direction pitch/roll, applied on top of the current pose and
  // faded by the live hit envelope. Bounded by setHitDirection.
  writeHitLean() {
    if (this.lifecycle && this.lifecycle !== 'alive') return false;
    const pose = this.pose, j = this.joints;
    if (!pose || (!this.hitPitch && !this.hitRoll)) return false;
    const sec = this.secondary ?? SECONDARY_REST;
    const ro = (node, x, y, z) => { if (!node) return; node.rotation.set(-(x ?? 0), y ?? 0, z ?? 0); };
    ro(j.hips, pose.hips.x + this.hitPitch * 0.4, pose.hips.y, pose.hips.z + this.hitRoll * 0.3);
    ro(j.chest, pose.chest.x + this.hitPitch, pose.chest.y + (sec.chestYaw || 0), pose.chest.z + this.hitRoll + (sec.chestRoll || 0));
    return true;
  }
}
