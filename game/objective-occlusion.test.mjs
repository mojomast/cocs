import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView} from './view.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';
import {MAPS} from './maps.mjs';

const markerView = renderer => Object.assign(Object.create(ArenaView.prototype), {
  scene:new T.Scene(), worldGroup:new T.Group(), objectiveModels:new Map(),
  motionQuery:{matches:false}, renderer, display:{...DEFAULT_DISPLAY},
});

test('objective floor markers are depth-tested so bots occlude them', () => {
  const view = markerView({isSoftware:false});
  view.updateObjectives({time:1,objectives:{kind:'koth',zones:[{id:'hill',x:2,y:1,z:-3,radius:4,owner:0,captureTeam:0,progress:40}]}},MAPS[0]);
  const hill = view.objectiveModels.get('hill');
  for (const key of ['baseMat','areaMat','progressMat']) {
    assert.notEqual(hill.userData[key].depthTest,false,`${key} is depth tested`);
    assert.notEqual(hill.userData[key].depthWrite,true,`${key} never writes depth`);
  }
  for (const node of [hill.userData.area,hill.userData.progress,hill.userData.emblem]) {
    assert.notEqual(node.renderOrder,100,`marker node ${node.uuid.slice(0,4)} is not forced on top`);
  }
  hill.traverse(node => assert.equal(node.userData.noCameraOcclusion,true));
});

test('a thin always-visible beacon cue survives the depth fix', () => {
  for (const isSoftware of [false,true]) {
    const view = markerView({isSoftware});
    view.updateObjectives({time:1,objectives:{kind:'koth',zones:[{id:'hill',x:0,y:0,z:0,radius:4,owner:0,captureTeam:0,progress:0}]}},MAPS[0]);
    const hill = view.objectiveModels.get('hill');
    assert.equal(hill.userData.beaconMat.depthTest,false,'beacon stays visible through geometry');
    assert.equal(hill.userData.beacon.renderOrder,100,'beacon keeps the CPU always-on-top marker');
    assert.ok(hill.userData.beacon.geometry.parameters.height >= 2,'beacon clears a standing character');
    assert.equal(hill.userData.beaconMat.color.getHexString(),hill.userData.baseMat.color.getHexString(),'beacon matches the objective color');
  }
});
