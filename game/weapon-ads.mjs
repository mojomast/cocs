// Presentation only. Never smooth camera yaw/pitch, input, or authoritative aim.
// One exponential drives all neutral presentation channels. Its semigroup
// property makes any partition of elapsed seconds equivalent for a fixed target.
import * as T from 'three';
import {adsFieldOfView,resolveActiveSight} from './reticle.mjs';
import {composeAdsQuaternion} from './sights.mjs';
export const ADS_PROFILES=Object.freeze([
 [15,19],[9,13],[10,15],[12,17],[13,18],
 [11,16],[13.5,18],[10.5,15],[11.5,17],[20,24],
].map(([enter,exit])=>Object.freeze({enter,exit})));
const finite=(n,fallback)=>Number.isFinite(n)?n:fallback;
const HIP=Object.freeze({x:.37,y:-.36,z:-.58});

export class AdsController {
 constructor(){
  // Per-controller scratch; no module-global mutable pose or per-frame geometry.
  this.targetPosition=new T.Vector3();this.targetQuaternion=new T.Quaternion();
  this.channelQuaternion=new T.Quaternion();
  this.state={progress:0,position:new T.Vector3(HIP.x,HIP.y,HIP.z),quaternion:new T.Quaternion(),fov:82,
   reticle:{adsOpacity:0,hipOpacity:1,ready:false,kind:'dot'}};
  this.initialized=false;
 }
 update(dt,input={}){
  const s=this.state,weapon=Number.isInteger(input.weapon)&&input.weapon>=0&&input.weapon<10?input.weapon:0;
  const changed=this.weapon!==undefined&&this.weapon!==weapon;
  this.weapon=weapon;
  const blocked=input.reloading===true||input.swapping===true||input.visible===false||input.sprinting===true||changed;
  const profile=ADS_PROFILES[weapon],target=input.aiming===true&&!blocked?1:0;
  const elapsed=Math.max(0,finite(dt,0)),blend=input.reduced?1:-Math.expm1(-(target?profile.enter:profile.exit)*elapsed);
  const base=Math.max(30,Math.min(130,finite(input.baseFov,82)));
  if(!this.initialized){s.fov=base;this.initialized=true;}
  const sight=input.sight||resolveActiveSight({weapon,aiming:!!target});
  const p=target?input.aim?.position:HIP;
  this.targetPosition.set(finite(p?.x,target?0:HIP.x),finite(p?.y,target?-.24:HIP.y),finite(p?.z,target?-.82:HIP.z));
  const q=target?input.aim?.quaternion:null;
  this.targetQuaternion.set(finite(q?.x,0),finite(q?.y,0),finite(q?.z,0),finite(q?.w,1)).normalize();
  s.progress+=(target-s.progress)*blend;
  s.position.lerp(this.targetPosition,blend);s.quaternion.slerp(this.targetQuaternion,blend);
  const targetFov=target?adsFieldOfView(base,sight):base+(input.sprinting?5:0);
  s.fov+=(targetFov-s.fov)*blend;
  s.reticle.adsOpacity=s.progress;s.reticle.hipOpacity=1-s.progress;
  s.reticle.ready=!!target&&s.progress>=.98;s.reticle.kind=sight.reticle||'dot';
  return s; // Borrowed mutable frame state; copy values if retaining evidence.
 }
 // Neutral pose is eased; feedback is applied NOW, once, never fed back into
 // the interpolator. Camera mouse look stays completely outside this helper.
 compose(position,quaternion,translation={},channels){
  const s=this.state,t=s.progress;
  position.copy(s.position);
  position.x+=finite(translation.x,0)*(1-.8*t);
  position.y+=finite(translation.y,0)*(1-.8*t);
  position.z+=finite(translation.z,0)*(1-.5*t);
  composeAdsQuaternion(this.channelQuaternion,null,t,channels);
  quaternion.copy(s.quaternion).multiply(this.channelQuaternion);
 }
 reset(baseFov=82){
  const s=this.state;s.progress=0;s.position.set(HIP.x,HIP.y,HIP.z);s.quaternion.identity();
  s.fov=Math.max(30,Math.min(130,finite(baseFov,82)));
  s.reticle.adsOpacity=0;s.reticle.hipOpacity=1;s.reticle.ready=false;s.reticle.kind='dot';
  this.weapon=undefined;this.initialized=true;
  return s;
 }
}
