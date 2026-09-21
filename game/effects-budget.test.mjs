import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {DecalPool,RipplePool,ContactShadowPool,RailBeamPool} from './effects-fx.mjs';

test('flat pooled effects remain two-sided in one pass and their transformed bounds support culling',t=>{
 const scene=new T.Scene(),decal=new DecalPool(scene,2),ripple=new RipplePool(scene,2),shadow=new ContactShadowPool(scene,2);
 t.after(()=>{decal.dispose();ripple.dispose();shadow.dispose();});
 decal.spawn({x:0,y:0,z:-5},{dir:{x:0,y:0,z:-1},size:2,life:1});
 ripple.spawn({x:0,y:0,z:-5},{delay:.01,size:2,life:1});ripple.update(.02);
 shadow.place('actor',0,0,-5,{radius:2});
 const camera=new T.PerspectiveCamera(60,1,.1,50),matrix=new T.Matrix4(),frustum=new T.Frustum();
 camera.updateMatrixWorld();matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(matrix);
 for(const pool of [decal,ripple,shadow]){
  const mesh=pool.slots[0].obj;
  assert.equal(mesh.material.side,T.DoubleSide);assert.equal(mesh.material.forceSinglePass,true);
  assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.frustumCulled,true);assert.equal(mesh.visible,true);
  mesh.updateMatrixWorld(true);assert.equal(frustum.intersectsObject(mesh),true);
  mesh.position.x=100;mesh.updateMatrixWorld(true);assert.equal(frustum.intersectsObject(mesh),false);
  mesh.position.x=0;mesh.scale.multiplyScalar(2);mesh.updateMatrixWorld(true);
  assert.equal(frustum.intersectsObject(mesh),true,'reused or growing effects return without disabling culling');
 }
});

test('volumetric rail beam and torus materials keep their two-pass policy',t=>{
 const pool=new RailBeamPool(new T.Scene(),1);t.after(()=>pool.dispose());
 const slot=pool.spawn({x:0,y:0,z:0},{x:0,y:0,z:-5});
 for(const material of [slot.beamMat,slot.ringMat]){
  assert.equal(material.side,T.DoubleSide);assert.equal(material.forceSinglePass,false);
 }
});
