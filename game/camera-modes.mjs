import {CAMERA_RIGS} from './director.mjs';

// Presentation-level camera modes that sit beside the director rigs. They are
// not director rigs (the director only understands CAMERA_RIGS); the view layer
// drives them directly. Keeping them in this list means the mode cycler and the
// label map stay the single source of truth for the HUD.
export const EXTRA_CAMERA_MODES=['cinematic','overshoulder','freelook','tactical'];

export const CAMERA_MODES=['auto',...CAMERA_RIGS,...EXTRA_CAMERA_MODES,'free'];

export const CAMERA_MODE_LABELS={
 auto:'Auto Cut',
 free:'Free Cam',
 orbit:'Orbit',
 chase:'Chase',
 dolly:'Dolly',
 crane:'Crane',
 tripod:'Tripod',
 follow:'Follow',
 firstperson:'First Person',
 flyover:'Flyover',
 cinematic:'Cinematic',
 overshoulder:'Over Shoulder',
 freelook:'Free Look',
 tactical:'Tactical Top-Down',
};

export function cycleCameraMode(current,dir=1){
 const n=CAMERA_MODES.length;
 const step=Math.round(Number.isFinite(dir)?dir:1)||1;
 const i=CAMERA_MODES.indexOf(current);
 const base=i<0?0:i;
 return CAMERA_MODES[((base+step)%n+n)%n];
}

export function cameraModeRig(mode){
 return CAMERA_RIGS.includes(mode)?mode:null;
}

export function isExtraCameraMode(mode){
 return EXTRA_CAMERA_MODES.includes(mode);
}

// ---------------------------------------------------------------------------
// Camera ownership.
//
// Exactly one controller writes the presentation camera per frame. The owner
// names that controller:
//  - `auto`   the view arbitrates: director / spectator / first-person and,
//             on a race match, the race-soccer demo rigs
//  - `race`   the runtime explicitly wants the race/soccer demo camera
//  - `manual` the runtime chose the framing (a pinned director rig or a manual
//             subject follow); race demo poses must never clobber it
//  - `free`   free roam; the page drives the pose with freeMove/freeLook
// ---------------------------------------------------------------------------
export const CAMERA_OWNERS=['auto','race','manual','free'];

export function normalizeCameraOwner(value){
 return CAMERA_OWNERS.includes(value)?value:'auto';
}

// Race/soccer presentation poses are only allowed to write the camera while the
// owner is automatic (back-compat: an unclaimed race match keeps its demo rigs)
// or explicitly `race`. Manual framing and free roam always win.
export function cameraOwnerAllowsRace(owner){
 const normalized=normalizeCameraOwner(owner);
 return normalized==='auto'||normalized==='race';
}

// Map a HUD camera mode onto the owner the page should request. `auto` lets the
// view arbitrate (race rigs included), `free` is free roam, and every explicit
// rig or presentation mode is a manual framing choice that must beat race.
export function cameraModeOwner(mode){
 if(mode==='free')return 'free';
 if(mode==='auto')return 'auto';
 return 'manual';
}

// ---------------------------------------------------------------------------
// Free-roam flight.
//
// Frame-rate independent and allocation-free: the velocity chases the input's
// target velocity with an exponential approach, then the pose advances by the
// average velocity across the step (trapezoid), so a 30 Hz and a 144 Hz client
// converge to the same path. `pose` and `velocity` are caller-owned scratch
// objects and are mutated in place. The input magnitude is normalized, so a
// diagonal WASD press or Space+forward is bounded by the same top speed.
// ---------------------------------------------------------------------------
export const FREE_CAM_DEFAULT_SPEED=16;
export const FREE_CAM_BOOST=2.4;
export const FREE_CAM_MAX_SPEED=64;
export const FREE_CAM_MIN_SPEED=2;
export const FREE_CAM_MAX_BASE_SPEED=40;
export const FREE_CAM_ACCEL_HALF_LIFE=.12;
export const FREE_CAM_BRAKE_HALF_LIFE=.08;
export const FREE_CAM_FLOOR=.4;

const finiteOr=(value,fallback)=>Number.isFinite(value)?value:fallback;

export function integrateFreeMove(pose,velocity,input,dt,speed=FREE_CAM_DEFAULT_SPEED,boost=FREE_CAM_BOOST){
 const step=Math.min(Math.max(finiteOr(dt,0),0),.1);
 const base=Math.max(0,finiteOr(speed,FREE_CAM_DEFAULT_SPEED));
 const boostScale=input&&input.boost===true?Math.max(0,finiteOr(boost,FREE_CAM_BOOST)):1;
 const top=Math.min(FREE_CAM_MAX_SPEED,base*boostScale);
 let forward=finiteOr(input&&input.forward,0),right=finiteOr(input&&input.right,0),up=finiteOr(input&&input.up,0);
 const magnitude=Math.hypot(forward,right,up);
 if(magnitude>1e-9){forward/=magnitude;right/=magnitude;up/=magnitude;}
 else{forward=0;right=0;up=0;}
 const moving=magnitude>1e-9;
 const poseObj=pose&&typeof pose==='object'?pose:{x:0,y:6,z:0,yaw:0,pitch:0};
 const vel=velocity&&typeof velocity==='object'?velocity:{x:0,y:0,z:0};
 const yaw=finiteOr(poseObj.yaw,0),pitch=Math.max(-1.5,Math.min(1.5,finiteOr(poseObj.pitch,0)));
 const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 // World-space target along the look basis: forward flies where the camera
 // looks, right strafes horizontally, up is world up (Space/Ctrl).
 const tx=moving?top*(forward*(-cp*sy)+right*cy):0;
 const ty=moving?top*(forward*sp+up):0;
 const tz=moving?top*(forward*(-cp*cy)+right*(-sy)):0;
 const k=smoothFactor(moving?FREE_CAM_ACCEL_HALF_LIFE:FREE_CAM_BRAKE_HALF_LIFE,step);
 const vx0=finiteOr(vel.x,0),vy0=finiteOr(vel.y,0),vz0=finiteOr(vel.z,0);
 let vx=vx0+(tx-vx0)*k,vy=vy0+(ty-vy0)*k,vz=vz0+(tz-vz0)*k;
 const speedNow=Math.hypot(vx,vy,vz);
 if(speedNow>top&&speedNow>1e-9){const scale=top/speedNow;vx*=scale;vy*=scale;vz*=scale;}
 vel.x=vx;vel.y=vy;vel.z=vz;
 const px=finiteOr(poseObj.x,0),py=finiteOr(poseObj.y,6),pz=finiteOr(poseObj.z,0);
 poseObj.x=px+(vx0+vx)*.5*step;
 poseObj.y=py+(vy0+vy)*.5*step;
 poseObj.z=pz+(vz0+vz)*.5*step;
 if(!(poseObj.y>=FREE_CAM_FLOOR))poseObj.y=FREE_CAM_FLOOR;
 if(!Number.isFinite(poseObj.x))poseObj.x=0;
 if(!Number.isFinite(poseObj.y))poseObj.y=6;
 if(!Number.isFinite(poseObj.z))poseObj.z=0;
 if(!Number.isFinite(poseObj.yaw))poseObj.yaw=0;
 if(!Number.isFinite(poseObj.pitch))poseObj.pitch=0;
 return poseObj;
}

// ---------------------------------------------------------------------------
// Deterministic camera smoothing.
//
// A frame-rate independent exponential ease: the same elapsed time produces the
// same blend regardless of how it is subdivided, so a 30 Hz and a 120 Hz client
// converge to the same pose. `halfLife` is the seconds for the remaining error
// to halve; 0 snaps. Pure and allocation-free.
// ---------------------------------------------------------------------------
export function smoothFactor(halfLife, dt){
 const life=Number(halfLife), step=Number(dt);
 if(!(life>0)||!(step>0))return 1;
 return 1-Math.pow(2,-step/life);
}

export function smoothTowards(current,target,{halfLife=.12,dt=1/60}={}){
 const a=Number(current),b=Number(target);
 if(!Number.isFinite(a))return Number.isFinite(b)?b:0;
 if(!Number.isFinite(b))return a;
 return a+(b-a)*smoothFactor(halfLife,dt);
}

// Shortest-arc angular smoothing, so a camera panning past ±π does not spin the
// long way around.
export function smoothAngle(current,target,{halfLife=.12,dt=1/60}={}){
 const a=Number(current),b=Number(target);
 if(!Number.isFinite(a))return Number.isFinite(b)?b:0;
 if(!Number.isFinite(b))return a;
 const delta=((((b-a)%(Math.PI*2))+Math.PI*3)%(Math.PI*2))-Math.PI;
 return a+delta*smoothFactor(halfLife,dt);
}

// Smooth a whole pose ({x,y,z,yaw,pitch}) toward a target pose in place or into
// a fresh object. Angle fields use shortest-arc smoothing; the rest linear.
const POSE_ANGLES=new Set(['yaw','pitch','roll','bodyYaw','turretYaw']);
export function smoothPose(current,target,{halfLife=.12,dt=1/60,out=null}={}){
 const result=out&&typeof out==='object'?out:{};
 for(const key of Object.keys(target||{})){
  const value=target[key];
  if(typeof value==='number'){
   result[key]=POSE_ANGLES.has(key)?smoothAngle(current?.[key],value,{halfLife,dt}):smoothTowards(current?.[key],value,{halfLife,dt});
  }else result[key]=value;
 }
 return result;
}

const num=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const finitePoint=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.z);

// Pure desired-pose builders for the extra presentation modes. They return a
// {x,y,z,lookX,lookY,lookZ,fov} pose that the view smooths with smoothPose, so
// the geometry is unit-testable without a renderer. `player` supplies the
// followed actor; `target` is an optional focus (e.g. an objective).
export function extraModePose(mode,{player,target=null,bounds=null,elapsed=0}={}){
 const p=player&&finitePoint(player)?player:null;
 const focus=target&&finitePoint(target)?target:p;
 const yaw=num(p?.yaw,0),sin=Math.sin(yaw),cos=Math.cos(yaw);
 const px=num(p?.x,0),py=num(p?.y,0),pz=num(p?.z,0);
 const fx=num(focus?.x,px),fy=num(focus?.y,py),fz=num(focus?.z,pz);
 const t=num(elapsed,0);
 let pose;
 if(mode==='overshoulder'){
  const side=.6;
  pose={x:px-sin*3.2+cos*side,y:py+1.75,z:pz-cos*3.2-sin*side,lookX:fx,lookY:fy+1.35,lookZ:fz,fov:62};
 }else if(mode==='freelook'){
  const orbit=t*.35;
  pose={x:px+Math.cos(orbit)*2.6,y:py+1.65,z:pz+Math.sin(orbit)*2.6,lookX:fx,lookY:fy+1.3,lookZ:fz,fov:70};
 }else if(mode==='tactical'){
  const height=Math.max(28,Math.min(70,Number.isFinite(bounds?.maxX)?Math.abs(bounds.maxX-bounds.minX)*.55:36));
  pose={x:px,y:py+height,z:pz+height*.35,lookX:fx,lookY:fy,lookZ:fz,fov:58};
 }else{
  // cinematic: a slow dolly arc that keeps the actor framed off-centre.
  const angle=t*.22,radius=7.5;
  pose={x:px+Math.cos(angle)*radius,y:py+3.4+Math.sin(t*.5)*.4,z:pz+Math.sin(angle)*radius,lookX:fx,lookY:fy+1.2,lookZ:fz,fov:66};
 }
 return {mode:isExtraCameraMode(mode)?mode:'cinematic',...pose};
}
