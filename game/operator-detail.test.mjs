import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {robotModel,ArenaView} from './view.mjs';
import {ModelAssets} from './effects-fx.mjs';
import {CHARACTERS} from './data.mjs';
import {operatorDetailGeometry} from './operator-detail.mjs';
import {selectModelLOD,modelCost} from '../scripts/measure-lattice-models.mjs';

test('close assemblies follow articulation, disappear at combat distance and return without changing rigs',()=>{
 const assets=new ModelAssets();
 for(const {id} of CHARACTERS){
  const m=robotModel(id,assets),data=m.userData,details=data.modelLOD.closeDetails;
  assert.equal(details.length,22);
  selectModelLOD(m,{distance:2});const close=modelCost(m);
  for(const lod of details){
   assert.equal(lod.levels[0].object.visible,true);
   assert.equal(lod.levels[1].object.visible,false);
   assert.equal(lod.levels[0].object.geometry.groups.length,0,'one batch per articulation');
   assert.equal(lod.levels[0].object.castShadow,false,'tiny hardware does not add shadow submissions');
   assert.ok(lod.levels[0].object.geometry.attributes.color);
  }
  const hand=data.characterRefinement.handL,detail=hand.getObjectByName('close-detail-hand');
  assert.equal(detail.parent,hand);
  const before=detail.getWorldPosition(new T.Vector3());
  data.joints.forearmL.rotation.x+=.6;m.updateMatrixWorld(true);
  assert.ok(detail.getWorldPosition(new T.Vector3()).distanceTo(before)>.05,'fingers follow the animated forearm');
  data.joints.forearmL.rotation.x-=.6;
  selectModelLOD(m,{distance:10});const medium=modelCost(m);
  assert.equal(close.drawObjects-medium.drawObjects,22);
  assert.ok(close.triangles>medium.triangles*2,'close geometry is a substantial detail pass');
  for(const lod of details)assert.equal(lod.levels[0].object.visible,false);
  selectModelLOD(m,{distance:2});assert.deepEqual(modelCost(m),close);
  selectModelLOD(m,{distance:2,detail:.65});
  for(const lod of details)assert.equal(lod.visible,false,'medium/low world quality sheds precision assemblies');
  selectModelLOD(m,{distance:2});assert.deepEqual(modelCost(m),close);
  const bounds=new T.Box3().setFromObject(data.joints.root,true);
  assert.ok(bounds.min.y>=-.004&&bounds.max.y<2.1,`${id}: standing envelope preserved`);
  ArenaView.prototype.disposeObject.call({sharedResources:assets.resources},m);
 }
 assets.dispose();
});

test('precision hardware respects limb radii and produces finite coloured geometry',()=>{
 for(const {id} of CHARACTERS)for(const [part,r,length] of [['arm',.082,.364],['forearm',.068,.326],['thigh',.10,.45],['shin',.082,.394]]){
  const g=operatorDetailGeometry(id,part);g.computeBoundingBox();
  const b=g.boundingBox;
  assert.ok(b.min.x>=-r&&b.max.x<=r&&b.min.z>=-r&&b.max.z<=r,`${id} ${part}: hardware stays within capsule girth`);
  assert.ok(b.min.y>=-length/2&&b.max.y<=length/2);
  for(const attr of Object.values(g.attributes))assert.ok([...attr.array].every(Number.isFinite));
  g.dispose();
 }
});

test('scaled preview keeps precision detail and software does not allocate its cache',()=>{
 const assets=new ModelAssets(),software=robotModel('chatgpt',assets,true);
 assert.equal(software.userData.modelLOD.closeDetails,undefined);
 assert.equal([...assets.geometries.keys()].some(k=>k.includes('precision-')),false);
 const model=robotModel('chatgpt',assets);model.scale.setScalar(2.15);
 const camera=new T.PerspectiveCamera();camera.position.set(5,3.3,10);camera.zoom=1.22;camera.updateMatrixWorld();model.updateMatrixWorld(true);
 for(const lod of model.userData.modelLOD.closeDetails){lod.update(camera);assert.equal(lod.levels[0].object.visible,true,'menu camera resolves the close-up model');}
 const size=assets.resources.size;robotModel('chatgpt',assets);assert.equal(assets.resources.size,size,'details reuse resources for a repeated actor');
 assets.dispose();
});
