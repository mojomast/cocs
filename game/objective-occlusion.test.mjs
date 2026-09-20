import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView} from './view.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';
import {MAPS} from './maps.mjs';
import {teamMark} from './team-presentation.mjs';

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

test('a contested zone pulses and never hides its owner mark', () => {
  const view = markerView({isSoftware:false});
  const zone = {id:'hill',x:2,y:1,z:-3,radius:4,owner:0,captureTeam:1,progress:60,contested:true};
  view.updateObjectives({time:.642,objectives:{kind:'koth',zones:[zone]}},MAPS[0]);
  const hill = view.objectiveModels.get('hill');
  const beat = hill.scale.y;
  assert.notEqual(beat,1,'a contested zone pulses');
  assert.ok(Math.abs(beat-1)<=.15,'the contested pulse stays bounded');
  view.updateObjectives({time:.9,objectives:{kind:'koth',zones:[zone]}},MAPS[0]);
  assert.notEqual(hill.scale.y,beat,'the contested pulse tracks the clock');
  view.motionQuery={matches:true};
  view.updateObjectives({time:1.2,objectives:{kind:'koth',zones:[zone]}},MAPS[0]);
  assert.equal(hill.scale.y,1,'reduced motion holds the contested pulse');
  // The frame pass keeps the mark readable: the owner bars when owned, one
  // centred neutral bar for a split or unowned contest.
  const mark = hill.userData.teamMark = teamMark();
  view._styleZoneMark(mark,zone);
  assert.equal(mark.visible,true,'an owned contest keeps the owner mark');
  assert.equal(mark.children[0].material.color.getHexString(),'ffd166','the contest tints the mark');
  assert.equal(mark.children[0].position.x,0,'a team-0 owner keeps one centred bar');
  view._styleZoneMark(mark,{contested:true,owner:null,captureTeam:0});
  assert.equal(mark.visible,true,'an unowned contest shows a split/neutral mark');
  assert.equal(mark.children[0].visible,true);
  assert.equal(mark.children[0].position.x,0);
  assert.equal(mark.children[1].visible,false);
  view._styleZoneMark(mark,{contested:false,owner:1});
  assert.equal(mark.visible,true);
  assert.equal(mark.children[1].visible,true,'a calm team-1 zone shows both bars');
  assert.equal(mark.children[0].material.color.getHexString(),'fff4dc','the calm mark returns to ivory');
  view.disposeObject(view.scene);
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
