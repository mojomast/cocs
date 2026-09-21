import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {armorPanel} from './model-geometry.mjs';
import {OPERATOR_ANATOMY,operatorPartGeometry} from './operator-anatomy.mjs';

test('rolled armor has outward planar faces, finite normals and an exact bounded bevel',()=>{
 const g=armorPanel([[-.1,-.2],[.1,-.2],[.1,.2],[-.1,.2]],.04);
 g.computeBoundingBox();
 assert.ok(g.boundingBox.min.x>=-.100001&&g.boundingBox.max.x<=.100001);
 assert.ok(g.boundingBox.min.y>=-.200001&&g.boundingBox.max.y<=.200001);
 const mesh=new T.Mesh(g,new T.MeshBasicMaterial()),ray=new T.Raycaster(new T.Vector3(0,0,-1),new T.Vector3(0,0,1));
 const hit=ray.intersectObject(mesh)[0];assert.ok(hit);assert.ok(hit.face.normal.z<-.99);
 assert.ok([...g.attributes.normal.array].every(Number.isFinite));g.dispose();mesh.material.dispose();
});

test('all mechanical load-bearing assemblies fit original articulated limb envelopes',()=>{
 const limbs={arm:[.082,.20],forearm:[.068,.19],thigh:[.10,.25],shin:[.082,.23]};
 for(const id of Object.keys(OPERATOR_ANATOMY))for(const [part,[r,h]] of Object.entries(limbs))for(const low of [false,true]){
  const g=operatorPartGeometry(id,part,{low});g.computeBoundingBox();const b=g.boundingBox;
  for(const axis of ['x','z'])assert.ok(b.min[axis]>=-r-1e-6&&b.max[axis]<=r+1e-6,`${id} ${part} ${axis} low=${low}`);
  assert.ok(Math.abs(b.min.y+(h/2+r))<1e-6&&Math.abs(b.max.y-(h/2+r))<1e-6,`${id} ${part}: axle endpoints`);
  assert.equal(g.groups.length,0,'fixed hardware is one draw, not multi-material groups');
  assert.ok([...g.attributes.position.array,...g.attributes.normal.array].every(Number.isFinite));g.dispose();
 }
});

test('nine chest mechanisms have distinct topology and cheap native far counterparts',()=>{
 const fingerprints=new Set();
 for(const id of Object.keys(OPERATOR_ANATOMY)){
  const near=operatorPartGeometry(id,'sternum'),far=operatorPartGeometry(id,'sternum',{low:true});
  fingerprints.add(JSON.stringify([...near.attributes.position.array]));
  assert.ok(far.index.count<near.index.count*.7,`${id}: far chest has a real triangle reduction`);
  assert.equal(near.groups.length,0);near.dispose();far.dispose();
 }
 assert.equal(fingerprints.size,9);
});
