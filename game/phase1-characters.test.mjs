import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import * as rigs from './rig.mjs';
import {CharacterRig,characterPose} from './character-anim.mjs';
import * as models from './models.mjs';
import {corpseRotation} from './deaths.mjs';

function actorModel(){
 const model=new T.Group(),root=new T.Group(),head=new T.Group();model.add(root);root.add(head);
 const body=new T.Mesh(new T.BoxGeometry(.6,1.8,.4));body.position.y=.9;root.add(body);
 const shield=new T.Group();shield.visible=false;model.add(shield);
 const rig=new CharacterRig({root,head});model.userData={joints:{root,head},rig,head,shield};
 return model;
}
const actor={id:1,x:2,y:3,z:4,yaw:.2,health:0};
test('lifecycle exclusively owns dead transforms and resets every captured transform/visibility on respawn',()=>{
 assert.equal(typeof rigs.CharacterLifecycle,'function');
 const m=actorModel(),life=new rigs.CharacterLifecycle();
 life.update(m,actor,{time:0,plan:{pose:'forward',duration:2},sampleGround:()=>3});
 assert.equal(life.state(m),'dying');assert.equal(life.ownsTransform(m),true);
 life.update(m,{...actor,x:200},{time:1,sampleGround:()=>3});
 assert.equal(life.state(m),'settled');assert.equal(m.position.x,2);
 const frozen=m.userData.joints.root.position.y;m.userData.rig.update({dt:.1,speed:8});
 assert.equal(m.userData.joints.root.position.y,frozen);
 m.scale.set(2,3,4);m.userData.head.visible=false;m.userData.shield.visible=true;
 life.update(m,{...actor,health:100,x:9,y:1,z:7},{time:1.1});
 assert.equal(life.state(m),'respawning');assert.equal(m.position.x,9);assert.equal(m.position.y,1);
 assert.deepEqual(m.scale.toArray(),[1,1,1]);assert.equal(m.userData.head.visible,true);assert.equal(m.userData.shield.visible,false);
 assert.equal(m.rotation.x,0);assert.equal(m.rotation.z,0);assert.equal(m.userData.rig.speedNorm,0);
 life.update(m,{...actor,health:100},{time:1.2});assert.equal(life.state(m),'alive');assert.equal(life.ownsTransform(m),false);
});

for(const terrain of [()=>2,(x,z)=>2+.18*x-.12*z,(x,z)=>z>.65?2.35:2]) {
 for(const reduced of [false,true]) test(`corpse body extent clears multi-point floor (${terrain}, reduced=${reduced})`,()=>{
  const m=actorModel(),life=new rigs.CharacterLifecycle();let calls=0;
  const sampleGround=(x,z)=>{calls++;return terrain(x,z);};
  life.update(m,{...actor,x:0,y:2,z:0},{time:0,reduced,plan:{pose:'crumple',duration:3},sampleGround});
  life.update(m,actor,{time:1.2,reduced,sampleGround});
  m.updateMatrixWorld(true);
  const body=m.userData.joints.root.children.find(n=>n.isMesh),v=new T.Vector3();let gap=Infinity;
  for(let i=0;i<body.geometry.attributes.position.count;i++){
   v.fromBufferAttribute(body.geometry.attributes.position,i).applyMatrix4(body.matrixWorld);
   const clearance=v.y-terrain(v.x,v.z);assert.ok(clearance>=-1e-6,`penetration ${clearance}`);gap=Math.min(gap,clearance);
  }
  assert.ok(gap<.15,`floating ${gap}`);assert.ok(calls>2&&calls<=70,`bounded samples ${calls}`);
 });
}
test('all corpse poses finish horizontally, reduced motion included',()=>{
 for(const pose of ['forward','back','left','right','crumple','sprawl'])for(const reduced of [true,false]){
  const m=actorModel(),life=new rigs.CharacterLifecycle();
  life.update(m,actor,{time:0,reduced,plan:{pose,duration:3},sampleGround:()=>3});
  life.update(m,actor,{time:1.2,reduced,sampleGround:()=>3});
  const up=new T.Vector3(0,1,0).applyQuaternion(m.quaternion);assert.ok(Math.abs(up.y)<.1,pose);
 }
});
test('corpse lifetime, eviction and missing floor stay bounded without resurrection',()=>{
 const life=new rigs.CharacterLifecycle({maxCorpses:2,maxLifetime:1}),models=[actorModel(),actorModel(),actorModel()];
 models.forEach(m=>life.update(m,actor,{time:0,sampleGround:()=>null}));
 assert.equal(models[0].visible,false);assert.equal(life.active.size,2);
 life.update(models[0],actor,{time:.1,sampleGround:()=>0});assert.equal(models[0].visible,false);
 for(const m of models)life.update(m,actor,{time:1000,sampleGround:()=>null});
 assert.equal(life.active.size,0);assert.ok(models.every(m=>!m.visible&&Number.isFinite(m.position.y)));
});

test('idle has no phantom stride and grounded crouch/landing feet remain level at the floor',()=>{
 const a=characterPose({phase:0,speedNorm:0}),b=characterPose({phase:Math.PI/2,speedNorm:0});
 assert.deepEqual(a.legL,b.legL);
 for(const crouch of [0,.5,1])for(const land of [0,1])for(const phase of [0,1,2,3,4,5]) {
  const p=characterPose({phase,speedNorm:.6,crouch,land,contactGait:true});
  for(const leg of [p.legL,p.legR]) {
   const y=.7835+p.rootY-.34*Math.cos(leg.hipX)-.35*Math.cos(leg.hipX+leg.kneeX)-.0935;
   assert.ok(y>=-1e-6&&y<.15,`foot floor offset ${y}`);
   assert.ok(Math.abs(leg.hipX+leg.kneeX+leg.ankleX)<1e-6,'flat foot');
  }
 }
});
test('rig reset restores bind joint transforms, not stale airborne/crouch offsets',()=>{
 const root=new T.Group(),head=new T.Group(),rig=new CharacterRig({root,head});
 root.position.set(1,-.3,4);root.scale.set(2,3,4);head.rotation.set(.3,.4,.5);rig.phase=3;rig.reset();
 assert.deepEqual(root.position.toArray(),[0,0,0]);assert.deepEqual(root.scale.toArray(),[1,1,1]);assert.equal(head.rotation.x,0);assert.equal(rig.phase,0);
});
test('death directional profiles preserve distinct left/right/back silhouettes',()=>{
 assert.ok(corpseRotation({pose:'left'}).z>1.5);assert.ok(corpseRotation({pose:'right'}).z< -1.5);assert.ok(corpseRotation({pose:'back'}).x< -1.5);
});
test('operator refinement attaches armor to chest and hands/grip sockets to forearms',()=>{
 assert.equal(typeof models.refineOperatorCharacter,'function');
 const m=actorModel(),j=m.userData.joints;
 for(const name of ['hips','chest','forearmL','forearmR']){j[name]=new T.Group();j.root.add(j[name]);}
 m.userData.chest=j.chest;
 const result=models.refineOperatorCharacter(m);
 assert.equal(j.hips.position.y,.7835);
 assert.equal(result.armor.parent,j.chest);
 assert.equal(result.handL.parent,j.forearmL);assert.equal(result.handR.parent,j.forearmR);
 assert.equal(result.gripL.parent,result.handL);assert.equal(result.gripR.parent,result.handR);
 const count=j.root.children.length;assert.equal(models.refineOperatorCharacter(m),result);assert.equal(j.root.children.length,count);
});

test('settled corpses follow a sampled platform without exceeding 31 samples/frame',()=>{
 const life=new rigs.CharacterLifecycle(),m=actorModel();let floor=3,calls=0;
 const sampleGround=(x,z,referenceY)=>{calls++;assert.equal(referenceY,actor.y);return floor;};
 life.update(m,actor,{time:0,reduced:true,sampleGround});const y=m.position.y;
 calls=0;floor=3.5;life.update(m,actor,{time:.2,reduced:true,sampleGround});
 assert.ok(Math.abs(m.position.y-y-.5)<1e-9);assert.equal(calls,31);
});
test('direct pose application cannot overwrite dead joints',()=>{
 const m=actorModel(),life=new rigs.CharacterLifecycle();life.update(m,actor,{time:0});
 const y=m.userData.joints.root.position.y;
 m.userData.rig.apply(characterPose({crouch:1}));assert.equal(m.userData.joints.root.position.y,y);
});
test('real refined operator soles stay planted through crouch and landing',async()=>{
 const {robotModel}=await import('./view.mjs');
 const m=robotModel('chatgpt');models.refineOperatorCharacter(m);
 for(const crouch of [0,1])for(const land of [0,1]){
  const pose=characterPose({speedNorm:0,crouch,land,contactGait:true});m.userData.rig.apply(pose);m.updateMatrixWorld(true);
  for(const foot of [m.userData.joints.footL,m.userData.joints.footR]){
   const bounds=new T.Box3().setFromObject(foot);assert.ok(Math.abs(bounds.min.y)<.004,`sole ${bounds.min.y}`);
  }
 }
});

test('hidden death bodies do no ground sampling and suppress shield/base until respawn',()=>{
 const m=actorModel(),life=new rigs.CharacterLifecycle();m.userData.shield.visible=true;
 let samples=0;life.update(m,actor,{time:0,plan:{hideBody:true},sampleGround:()=>{samples++;return 0;}});
 assert.equal(m.visible,false);assert.equal(m.userData.shield.visible,false);assert.equal(samples,0);
 life.update(m,{...actor,health:100},{time:.1});assert.equal(m.userData.shield.visible,true);
});
test('removed models release active lifecycle storage and reset ownership',()=>{
 const m=actorModel(),life=new rigs.CharacterLifecycle();life.update(m,actor,{time:0});
 assert.equal(typeof life.release,'function');life.release(m);assert.equal(life.active.size,0);assert.equal(life.state(m),'alive');
});
