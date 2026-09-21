import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView,robotModel,weaponModel,simpleWeaponModel,createWeaponPreview} from './view.mjs';
import {CHARACTERS,WEAPONS} from './data.mjs';
import {ModelAssets} from './effects-fx.mjs';
import {applyActorTeam} from './team-presentation.mjs';
import {modelCost,selectModelLOD,measureLatticeModels} from '../scripts/measure-lattice-models.mjs';
import {OPERATOR_FORMS,OPERATOR_MODEL_BUDGETS} from './models.mjs';
import {measureOperatorModels} from '../scripts/measure-operator-models.mjs';

test('nine sculpted identities retain outward-facing visors and team-owned shell materials',()=>{
 const assets=new ModelAssets(),shapes=new Set(),optics=new Set();
 for(const c of CHARACTERS){
  const model=robotModel(c.id,assets),data=model.userData,head=data.head;
  assert.equal(data.operatorIdentity.id,c.id);
  const shell=head.getObjectByName(`helmet-shell-${c.id}`),visor=head.getObjectByName('inset-visor');
  assert.equal(shell.material,data.armor);shapes.add(JSON.stringify(shell.geometry.parameters));
  optics.add(head.getObjectByName(`optics-${OPERATOR_FORMS[c.id].eyes}`).name);
  assert.ok(shell.geometry.index.count/3>=800,'near helmet spends geometry on the focal silhouette');
  const chest=model.getObjectByName(`chest-${c.id}`);assert.ok(chest.geometry.index.count/3>=600);
  const normal=visor.geometry.attributes.normal;assert.ok(normal.getZ(Math.floor(normal.count/2))<-.9,`${c.id}: visor faces viewer at -Z`);
  const identityColor=data.color;applyActorTeam(model,0);assert.equal(shell.material,data.armor);assert.equal(data.color,identityColor);
  assert.ok(head.getObjectByName('helmet-mandible-and-comms'));assert.ok(data.characterRefinement.gripL&&data.characterRefinement.gripR);
 }
 assert.equal(shapes.size,9);assert.equal(optics.size,8,'intentional two split-eye variants have different shell/jaw proportions');
 assets.dispose();
});

test('native distance LOD preserves joints, material references and returns to the high model',()=>{
 const assets=new ModelAssets(),m=robotModel('qwen',assets),j=m.userData.joints,rig=m.userData.rig;
 selectModelLOD(m,{distance:2});
 const near=modelCost(m),head=j.head,grip=m.userData.characterRefinement.gripR;
 selectModelLOD(m,{distance:50,detail:0});const far=modelCost(m);
 assert.ok(far.triangles<near.triangles*.60);assert.ok(far.drawObjects<=near.drawObjects);
 assert.equal(j.head,head);assert.equal(m.userData.rig,rig);assert.equal(m.userData.characterRefinement.gripR,grip);
 for(const lod of m.userData.modelLOD.levels){assert.equal(lod.levels[0].object.material,lod.levels[1].object.material);assert.equal(lod.levels.filter(l=>l.object.visible).length,1);}
 selectModelLOD(m,{distance:2,detail:1});assert.deepEqual(modelCost(m),near);
 const resources=assets.resources.size;robotModel('qwen',assets);assert.equal(assets.resources.size,resources,'both LODs reuse owned geometry and materials');
 const software=robotModel('qwen',assets,true);assert.equal(software.userData.modelLOD.software,true);
 for(const lod of software.userData.modelLOD.levels){assert.equal(lod.autoUpdate,false);assert.equal(lod.levels[1].object.visible,true);}
 assets.dispose();
});

test('mechanical anatomy stays inside the authored limb and standing envelopes at every LOD',()=>{
 // Independent dimensions from the original rig. Mechanical assemblies may be
 // slimmer than the original capsules, but may never inflate their envelopes.
 const authored={armUpper:[.082,.20,'arm'],forearm:[.068,.19,'forearm'],legUpper:[.10,.25,'thigh'],legLower:[.082,.23,'shin']};
 const assets=new ModelAssets();
 for(const c of CHARACTERS)for(const software of [false,true]){
  const model=robotModel(c.id,assets,software),j=model.userData.joints;
  for(const distance of [5,50]){
   selectModelLOD(model,{distance,detail:distance<18?1:0});
   for(const [limb,[radius,height,part]] of Object.entries(authored))for(const side of ['L','R']){
    const joint=j[`${limb}${side}`],lod=joint.children.find(n=>n.isLOD&&n.levels[0].object.userData.operatorSurface?.part===part);
    assert.ok(lod,`${c.id} ${limb}${side}: mechanical assembly stays on its articulation joint`);
    assert.equal(lod.levels.filter(level=>level.object.visible).length,1);
    for(const {object:mesh} of lod.levels){
     const g=mesh.geometry;g.computeBoundingBox();const size=g.boundingBox.getSize(new T.Vector3());
     const label=`${c.id} ${limb}${side}, distance=${distance}, software=${software}`;
     assert.ok(Math.abs(size.y-(height+radius*2))<1e-6,`${label}: axle endpoints retain authored limb length`);
     assert.ok(size.x<=radius*2+1e-6&&size.z<=radius*2+1e-6,`${label}: sculpted surfaces do not inflate limb girth`);
     assert.deepEqual(mesh.scale.toArray(),[1,1,1],`${label}: dimensions are not concealed by corrective scaling`);
    }
   }
   // The upper arm and shin share a radius, but have different heights. Cache
   // keys must distinguish them for both subdivisions, across the whole roster.
   const assembly=(joint,part)=>joint.children.find(n=>n.isLOD&&n.levels[0].object.userData.operatorSurface?.part===part);
   for(let level=0;level<2;level++)assert.notEqual(assembly(j.armUpperL,'arm').levels[level].object.geometry,assembly(j.legLowerL,'shin').levels[level].object.geometry);
   const bounds=new T.Box3().setFromObject(j.root,true);
   assert.ok(bounds.min.y>=-.004,`${c.id}: no body mesh protrudes below the planted soles (${bounds.min.y})`);
   assert.ok(bounds.max.y<2.1,`${c.id}: body and harness remain within the authored standing envelope (${bounds.max.y})`);
  }
  ArenaView.prototype.disposeObject.call({sharedResources:assets.resources},model);
 }
 assets.dispose();
});

test('crafted operator near, far and software geometry respect stricter submission budgets',()=>{
 const report=measureOperatorModels();
  for(const row of report.operators)for(const tier of ['close','near','far','software']){
  for(const metric of ['drawObjects','triangles'])assert.ok(row[tier][metric]<=OPERATOR_MODEL_BUDGETS[tier][metric],`${row.id} ${tier} ${metric}: ${row[tier][metric]}`);
 }
 assert.equal(new Set(report.operators.map(r=>r.design)).size,9);
  assert.ok(report.baseCacheBytes<2_800_000,'existing combat/distance geometry working set remains unchanged');
  assert.ok(report.cacheBytes<11_000_000,'all nine precision assemblies share a bounded close-up geometry cache');
});

test('32-actor assembled roster and all weapon bodies stay inside deliberate draw/triangle budgets',()=>{
 const report=measureLatticeModels();
 for(const row of report.operators){assert.ok(row.near.drawObjects<=65);assert.ok(row.near.triangles<13000);assert.ok(row.distantLow.triangles<7100);}
 for(const row of report.weapons){assert.equal(row.world.drawObjects,5);assert.ok(row.world.triangles<=800);assert.ok(row.detailed.drawObjects<=40);assert.ok(row.detailed.triangles<6500);}
 assert.ok(report.scene32.near.drawObjects<2200);assert.ok(report.scene32.near.triangles<410000);
 assert.ok(report.scene32.eightNear24Far.triangles<260000);assert.ok(report.scene32.distantLow.drawObjects<1750);
  assert.ok(report.cache.baseBytes<4_000_000,'existing roster + both weapon levels retain their memory budget');
  assert.ok(report.cache.bytes<12_000_000,'precision geometry is explicitly accounted for');
  assert.ok(report.scene32.fourCloseFourNear24Far.triangles<310000,'mixed roster budgets four simultaneous close-ups');
});

test('turned bores end on actual muzzle anchors and remain open across transformed runtime/preview models',()=>{
 const assets=new ModelAssets(),origin=new T.Vector3(),direction=new T.Vector3(0,0,1);
 const preview=createWeaponPreview({assets});
 for(let type=0;type<WEAPONS.length;type++){
  const model=weaponModel(type,assets),world=simpleWeaponModel(type,assets),barrels=[];
  model.userData.parts.barrel.traverse(n=>{if(n.name==='barrel')barrels.push(n);});model.updateMatrixWorld(true);
  assert.equal(barrels.length,type===3?2:1);
  for(const [i,barrel] of barrels.entries()){
   const muzzle=model.userData.muzzles[i];origin.copy(muzzle.position);origin.z-=.001;
   const ray=new T.Raycaster(origin,direction,0,.025);
   assert.equal(ray.intersectObject(barrel).length,0,`${type}: bore is not capped`);
   const bounds=new T.Box3().setFromObject(barrel);assert.ok(Math.abs(bounds.min.z-muzzle.position.z)<1e-6);
  }
  assert.ok(Math.abs(new T.Box3().setFromObject(world.getObjectByName('barrel')).min.z-world.userData.muzzle.position.z)<1e-6);
  model.position.set(4,2,-7);model.rotation.set(.2,.8,-.1);model.scale.setScalar(.73);model.updateMatrixWorld(true);
  for(const muzzle of model.userData.muzzles)assert.ok(muzzle.getWorldPosition(new T.Vector3()).distanceTo(muzzle.position.clone().applyMatrix4(model.matrixWorld))<1e-8);
  const inspected=preview.mount({type});preview.resize(640,360);preview.update(3,{reduced:true});preview.scene.updateMatrixWorld(true);
  assert.equal(inspected.userData.chassis.receiver.geometry,model.userData.chassis.receiver.geometry,'preview shares the actual runtime receiver');
  for(const muzzle of inspected.userData.muzzles)assert.ok(muzzle.getWorldPosition(new T.Vector3()).distanceTo(muzzle.position.clone().applyMatrix4(inspected.matrixWorld))<1e-8);
 }
 preview.dispose();
 assets.dispose();
});

test('uncached LOD model disposal releases hidden low geometry exactly once',()=>{
 const model=robotModel('kimi'),resources=new Map();
 model.traverse(n=>{for(const r of [n.geometry,n.material])if(r&&!resources.has(r)){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}});
 selectModelLOD(model,{distance:50,detail:0});ArenaView.prototype.disposeObject.call({},model);
 assert.ok([...resources.values()].every(n=>n===1));
});
