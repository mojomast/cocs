import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_MODES,CAMERA_MODE_LABELS,cycleCameraMode,cameraModeRig} from './camera-modes.mjs';
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
