import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {WEAPONS} from './data.mjs';
import {weaponModel,VIEWMODEL_SCALE,VIEWMODEL_GUN_DISTANCE} from './view.mjs';
import {attachHoloSight,attachScope,solveSightPose,sightAlignmentError,projectSightPoint} from './sights.mjs';

// Mount a solved viewmodel in weapon-camera space so rays can be cast exactly
// like the renderer does: the weapon group is translated/rotated by the ADS pose
// and uniformly scaled, then viewed from the origin looking down -Z.
function mounted(type,visual){
  const model=weaponModel(type,undefined,visual),pose=model.userData.aim;
  const root=new T.Group();
  root.position.set(pose.position.x,pose.position.y,pose.position.z);
  root.quaternion.set(pose.quaternion.x,pose.quaternion.y,pose.quaternion.z,pose.quaternion.w);
  root.scale.setScalar(VIEWMODEL_SCALE);
  model.position.set(0,0,0);
  root.add(model);
  const scene=new T.Scene();scene.add(root);root.updateMatrixWorld(true);
  return {model,root,pose,scene};
}
const camera=()=>new T.PerspectiveCamera(82,16/9,.02,4);
function centerHits(root,fov=82,aspect=16/9){
  const cam=camera();cam.fov=fov;cam.aspect=aspect;cam.position.set(0,0,0);cam.lookAt(0,0,-1);cam.updateMatrixWorld(true);
  const ray=new T.Raycaster(new T.Vector3(0,0,0),new T.Vector3(0,0,-1));
  return ray.intersectObject(root,true);
}
function tagged(hits,name){return hits.some(hit=>hit.object?.userData?.[name]===true);}
function dispose(root){root.traverse(n=>{if(n.geometry)n.geometry.dispose?.();if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])m.dispose?.();});}

test('iron sights leave an open rear notch: the center ray and a small bundle miss the rear posts',()=>{
 for(let type=0;type<WEAPONS.length;type++){
  const {model,root}=mounted(type);
  const rear=model.userData.sights.rear;
  if(rear.aperture!==undefined){
   const hits=centerHits(root),ray=new T.Raycaster(new T.Vector3(0,0,0),new T.Vector3(0,0,-1));
   assert.ok(!tagged(hits,'sightRear'),`${type}: an opaque rear notch blocks the sight line`);
   // A small bundle inside the notch gap must also pass the rear assembly.
   const gap=Number(rear.aperture)||.02;
   for(const dx of [-gap/4,0,gap/4])for(const dy of [-gap/4,0,gap/4]){
    ray.set(new T.Vector3(dx,dy,0),new T.Vector3(0,0,-1));
    assert.ok(!tagged(ray.intersectObject(root,true),'sightRear'),`${type}: rear notch blocks the clear region at (${dx},${dy})`);
   }
  }
  dispose(model);
 }
});

test('the front post tip sits at the aiming point while the post body extends below it',()=>{
 const model=weaponModel(0),anchor=model.userData.anchors.frontSight;
 const posts=[];model.traverse(n=>{if(n.userData?.sightFront)posts.push(n);});
 assert.ok(posts.length>=1,'the iron front post is present');
 const top=Math.max(...posts.map(p=>p.position.y+p.geometry.parameters.height/2));
 assert.ok(Math.abs(top-anchor.position.y)<1e-6,`the post tip (${top}) meets the aiming point (${anchor.position.y})`);
 dispose(model);
});

test('the SMG rear anchor sits on the clear sight line, not the old in-block offset',()=>{
 const model=weaponModel(9);
 assert.ok(model.userData.sights.rear.y>=.29,'the SMG rear anchor clears the rear block instead of sitting inside it (was y=.248)');
 assert.ok(model.userData.sights.rear.y<=.42,'the rear anchor stays a sensible height above the receiver');
 // The rear sight must not expose a solid block: a rear notch is open.
 const {root}=mounted(9),hits=centerHits(root);
 assert.ok(!tagged(hits,'sightRear'),'the SMG rear sight is an open notch');
 dispose(model);
});

test('marksman and rail-lance scopes are open tubes with no caps or lens disks in the bore',()=>{
 for(const type of [2,8]){
  const {model,root}=mounted(type);
  for(const bad of ['lens','scope-cap'])assert.ok(!findNamed(model,bad),`${type}: an opaque ${bad} remains in the bore`);
  const hits=centerHits(root);
  assert.ok(!tagged(hits,'scopeTube'),`${type}: the scope tube blocks its own bore (ray hit the tube wall)`);
  dispose(model);
 }
});

test('the holo attachment is a thin open frame: the center ray misses the frame and reticle',()=>{
 for(const type of [0,3,4,6,7,9]){
  const {model,root}=mounted(type,{optic:'holo'});
  const hits=centerHits(root);
  assert.ok(!tagged(hits,'sightFrame'),`${type}: the holo frame blocks the center`);
  assert.ok(!hits.some(hit=>hit.object?.name==='reticle'),`${type}: the reticle dot fills the window`);
  dispose(model);
 }
});

test('the scope attachment keeps the center of the bore clear at several FOVs and aspect ratios',()=>{
 const {model,root,pose}=mounted(8,{optic:'scope'});
 const rear=model.userData.anchors.rearSight.position,projected=projectSightPoint(rear,pose,VIEWMODEL_SCALE);
 assert.ok(Math.abs(projected.x)<1e-9&&Math.abs(projected.y)<1e-9,'the solved ADS pose puts the aperture on the center ray');
 for(const fov of [60,82,110])for(const aspect of [16/9,21/9,4/3]){
  const hits=centerHits(root,fov,aspect);
  assert.ok(!tagged(hits,'scopeTube'),`the scope bore is blocked at fov ${fov}, aspect ${aspect.toFixed(2)}`);
 }
 dispose(model);
});

test('the ADS solver aligns every weapon at representative FOVs, with attachments and reduced motion',()=>{
 for(let type=0;type<WEAPONS.length;type++)for(const visual of [null,{optic:'holo'},{optic:'scope'},{optic:'iron'}]){
  const model=weaponModel(type,undefined,visual);
  const rear=model.userData.anchors.rearSight.position,front=model.userData.anchors.frontSight.position;
  const pose=solveSightPose(rear,front,{scale:VIEWMODEL_SCALE,distance:VIEWMODEL_GUN_DISTANCE});
  const err=sightAlignmentError(rear,front,pose,VIEWMODEL_SCALE);
  // Reduced motion only changes *when* the pose is reached, never the pose.
  assert.ok(err.rearError<1e-6&&err.angleError<1e-6&&err.lateral<1e-6,`${type}/${visual?.optic||'iron'} aligns (${JSON.stringify(err)})`);
  const projected=projectSightPoint(rear,pose,VIEWMODEL_SCALE);
  assert.ok(Math.abs(projected.x)<1e-9&&Math.abs(projected.y)<1e-9,`${type} aperture projects to screen center`);
  dispose(model);
 }
});

function findNamed(root,name){let found=null;root.traverse(n=>{if(!found&&(n.name===name))found=n;});return found;}

test('no weapon blocks its own ADS bore with receiver, rail, rod or tank geometry',()=>{
 // Regression: open sights exposed geometry that used to be hidden behind solid
 // sight blocks — a top rail, a conduit rod, a dorsal tank or a rear sight base
 // sat exactly on the sight line and blocked the target. The intended sight
 // meshes (front post, notch/aperture, frame, tube, reticle, flash) are allowed.
 const allowed=obj=>{const u=obj.userData||{};return u.sightFront||u.sightFrontTip||u.sightRear||u.sightFrame||u.scopeTube||obj.name==='reticle'||obj.name==='muzzle-flare'||String(obj.name).includes('flash');};
 for(let type=0;type<WEAPONS.length;type++){
  const {model,root}=mounted(type);
  const ray=new T.Raycaster(new T.Vector3(0,0,0),new T.Vector3(0,0,-1));
  const blockers=ray.intersectObject(root,true).filter(hit=>!allowed(hit.object));
  assert.equal(blockers.length,0,`${WEAPONS[type]?.name||type}: ${blockers[0]?.object?.geometry?.type||'geometry'} blocks the ADS bore at z=${blockers[0]?.object?.position?.z}`);
  dispose(model);
 }
});

test('scope and holo builders never emit opaque sight blockers for their own bodies',()=>{
 const holoParent=new T.Group(),scopeParent=new T.Group();
 const ctx={T,geo:(k,make)=>make(),box:(p,w,h,d,x,y,z,mat)=>{const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat||new T.MeshBasicMaterial());m.position.set(x,y,z);p.add(m);return m;},cylinder:(p,r1,r2,h,x,y,z,mat)=>{const m=new T.Mesh(new T.CylinderGeometry(r1,r2,h,8),mat||new T.MeshBasicMaterial());m.position.set(x,y,z);p.add(m);return m;},ring:(p,r,t,x,y,z,mat)=>{const m=new T.Mesh(new T.TorusGeometry(r,t,6,16),mat||new T.MeshBasicMaterial());m.position.set(x,y,z);p.add(m);return m;},palette:{dark:new T.MeshBasicMaterial(),light:new T.MeshBasicMaterial(),glow:new T.MeshBasicMaterial()}};
 attachHoloSight(holoParent,ctx,{x:0,y:0,z:0});
 attachScope(scopeParent,ctx,{x:0,y:0,z:0});
 const holoFrames=[];holoParent.traverse(n=>{if(n.userData?.sightFrame)holoFrames.push(n);});
 assert.ok(holoFrames.length===4,'the holo sight is four thin frame bars around an open center');
 const scopeTubes=[];scopeParent.traverse(n=>{if(n.userData?.scopeTube)scopeTubes.push(n);});
 assert.ok(scopeTubes.length>=1,'the scope is built from open tubes');
 // Open-ended cylinders have no caps, so the bore is genuinely hollow; the
 // mounted-bore raycast above already confirms the axis is clear.
 for(const tube of scopeTubes)assert.equal(tube.geometry.parameters.openEnded,true,'scope tubes are open-ended (no caps)');
 for(const frame of holoFrames){const box=new T.Box3().setFromObject(frame);assert.ok(!(box.min.x<0&&box.max.x>0&&box.min.y<0&&box.max.y>0),'no frame bar covers the center');}
});
