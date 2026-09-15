import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_MODES,CAMERA_MODE_LABELS,cycleCameraMode,cameraModeRig,EXTRA_CAMERA_MODES,smoothFactor,smoothTowards,smoothAngle,extraModePose} from './camera-modes.mjs';
import {CAMERA_RIGS} from './director.mjs';

test('every camera mode has a non-empty label',()=>{
 for(const mode of CAMERA_MODES){
  assert.equal(typeof CAMERA_MODE_LABELS[mode],'string',`missing label for ${mode}`);
  assert.ok(CAMERA_MODE_LABELS[mode].length>0,`empty label for ${mode}`);
 }
 assert.equal(CAMERA_MODES[0],'auto');
 assert.equal(CAMERA_MODES[CAMERA_MODES.length-1],'free');
});

test('cycleCameraMode wraps in both directions',()=>{
 const n=CAMERA_MODES.length;
 assert.equal(cycleCameraMode('auto',1),'orbit');
 assert.equal(cycleCameraMode('free',1),'auto');
 assert.equal(cycleCameraMode('auto',-1),'free');
 for(let i=0;i<n;i++){
  const mode=CAMERA_MODES[i];
  assert.equal(cycleCameraMode(mode,1),CAMERA_MODES[(i+1)%n]);
  assert.equal(cycleCameraMode(mode,-1),CAMERA_MODES[(i-1+n)%n]);
 }
});

test('cycleCameraMode tolerates an unknown current mode',()=>{
 const n=CAMERA_MODES.length;
 assert.equal(cycleCameraMode('bogus',1),CAMERA_MODES[1]);
 assert.equal(cycleCameraMode('bogus',-1),CAMERA_MODES[n-1]);
 assert.equal(cycleCameraMode(undefined,1),CAMERA_MODES[1]);
});

test('cameraModeRig maps rigs and returns null for auto/free',()=>{
 for(const rig of CAMERA_RIGS)assert.equal(cameraModeRig(rig),rig);
 assert.equal(cameraModeRig('auto'),null);
 assert.equal(cameraModeRig('free'),null);
 assert.equal(cameraModeRig('bogus'),null);
});

test('smoothing is frame-rate independent and shortest-arc for angles',()=>{
 const oneStep=smoothTowards(0,10,{halfLife:.1,dt:.1});
 let split=0;for(let i=0;i<10;i++)split=smoothTowards(split,10,{halfLife:.1,dt:.01});
 assert.ok(Math.abs(oneStep-split)<1e-9,`${oneStep} vs ${split}`);
 assert.equal(smoothTowards(5,5),5);
 assert.equal(smoothTowards(NaN,7),7);
 assert.equal(smoothTowards(3,NaN),3);
 assert.equal(smoothFactor(0,1/60),1,'a zero half-life snaps');
 const near=Math.PI-.05;
 const wrapped=smoothAngle(near,-Math.PI+.05,{halfLife:.1,dt:.1});
 assert.ok(wrapped>Math.PI||wrapped<-Math.PI?Math.abs(wrapped)>near:Math.abs(wrapped)>near,'angle crosses the seam the short way');
});

test('extraModePose builds distinct, finite poses for each presentation mode',()=>{
 const player={x:0,y:0,z:0,yaw:0};
 const poses=EXTRA_CAMERA_MODES.map(mode=>extraModePose(mode,{player,elapsed:1}));
 for(const pose of poses)for(const key of ['x','y','z','lookX','lookY','lookZ','fov'])assert.ok(Number.isFinite(pose[key]),`${pose.mode}.${key}`);
 assert.equal(new Set(poses.map(p=>p.mode)).size,EXTRA_CAMERA_MODES.length);
 assert.notEqual(poses.find(p=>p.mode==='tactical').y,poses.find(p=>p.mode==='overshoulder').y);
 assert.equal(extraModePose('bogus',{player}).mode,'cinematic');
 const a=extraModePose('cinematic',{player,elapsed:2});
 const b=extraModePose('cinematic',{player,elapsed:2});
 assert.deepEqual(a,b,'poses are deterministic');
});
