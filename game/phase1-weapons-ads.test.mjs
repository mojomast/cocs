import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {AdsController,ADS_PROFILES} from './weapon-ads.mjs';
import {resolveActiveSight,adsFieldOfView} from './reticle.mjs';

const aim={position:{x:0,y:-.20,z:-.82},quaternion:new T.Quaternion().setFromEuler(new T.Euler(.04,.02,0))};
const input=(weapon=0)=>({weapon,aiming:true,visible:true,baseFov:82,aim,sight:resolveActiveSight({weapon,aiming:true})});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('ten per-weapon profiles coordinate position, rotation, FOV and reticle independent of frame partition',()=>{
 assert.equal(ADS_PROFILES.length,10);assert.ok(ADS_PROFILES[9].enter>ADS_PROFILES[1].enter);
 for(let weapon=0;weapon<10;weapon++){
  const a=new AdsController(),b=new AdsController(),i=input(weapon);
  const sa=a.update(.125,i);for(let j=0;j<18;j++)b.update(.125/18,i);const sb=b.state;
  close(sa.progress,sb.progress);close(sa.fov,sb.fov);
  assert.ok(sa.position.distanceTo(sb.position)<1e-9);assert.ok(1-Math.abs(sa.quaternion.dot(sb.quaternion))<1e-9);
  close(sa.position.x,.37*(1-sa.progress));
  close(sa.fov,82+(adsFieldOfView(82,i.sight)-82)*sa.progress);
  close(sa.reticle.adsOpacity,sa.progress);close(sa.reticle.hipOpacity,1-sa.progress);
 }
});

test('rapid reversals and reload/swap/hidden interruptions preserve current pose and resume safely',()=>{
 for(const interruption of [{reloading:true},{swapping:true},{visible:false},{sprinting:true},{weapon:8}]){
  const ads=new AdsController();ads.update(.2,input());
  const before={p:ads.state.progress,f:ads.state.fov,pos:ads.state.position.clone(),q:ads.state.quaternion.clone()};
  ads.update(0,{...input(),...interruption});
  assert.ok(ads.state.position.equals(before.pos));close(ads.state.fov,before.f);assert.equal(ads.state.reticle.ready,false);
  const interrupted={...input(),...interruption,swapping:true};
  ads.update(.02,interrupted);assert.ok(ads.state.progress<before.p);assert.ok(ads.state.fov>before.f);
  const p=ads.state.progress;ads.update(.01,{...input(),weapon:interrupted.weapon});assert.ok(ads.state.progress>p);
 }
 const ads=new AdsController();for(let n=0;n<100;n++){
  ads.update(.004,{...input(),aiming:n%2===0});assert.ok(ads.state.progress>=0&&ads.state.progress<=1);assert.ok(Number.isFinite(ads.state.fov));
 }
});

test('presentation adds recoil exactly once without filtering immediate movement or mutating aim',()=>{
 const ads=new AdsController(),i=input();ads.update(.1,i);
 const p=new T.Vector3(),q=new T.Quaternion(),channels={recoil:{pitch:.12,roll:0}};
 const before=ads.state.quaternion.clone();
 ads.compose(p,q,{x:.03,y:.04,z:.02},channels);
 const expected=before.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.12));
 assert.ok(1-Math.abs(q.dot(expected))<1e-10);
 close(p.x,ads.state.position.x+.03*(1-.8*ads.state.progress));
 // Presentation calls are stateless: no accumulation/double recoil per render.
 ads.compose(p,q,{x:.03,y:.04,z:.02},channels);assert.ok(1-Math.abs(q.dot(expected))<1e-10);
 assert.deepEqual(i.aim,aim);
});

test('invalid delta is inert, large elapsed time converges, reduced motion snaps, reset clears zoom',()=>{
 const ads=new AdsController();ads.update(.1,input());const old=ads.state.progress;
 for(const dt of [-1,NaN,Infinity]){ads.update(dt,input());close(ads.state.progress,old);}
 ads.update(20,input());close(ads.state.progress,1);
 ads.update(.016,{...input(),reduced:true,reloading:true});close(ads.state.progress,0);close(ads.state.fov,82);
 ads.update(0,{...input(2),reduced:true});
 ads.reset(95);close(ads.state.progress,0);close(ads.state.fov,95);close(ads.state.position.x,.37);assert.equal(ads.state.reticle.ready,false);
});
