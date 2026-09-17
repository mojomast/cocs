import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import * as T from 'three';
import * as rigs from './rig.mjs';
import {robotModel,simpleWeaponModel,weaponModel} from './view.mjs';

const world=n=>n.getWorldPosition(new T.Vector3());
function modelFor(type=0){
 const m=robotModel('chatgpt');
 const d=m.userData;d.gunAnchor.remove(d.weapon);d.weapon=simpleWeaponModel(type);d.gunAnchor.add(d.weapon);
 d.rig.update({dt:.1,grounded:true});return m;
}
test('unapplied view patch runs final living pass with explicit support and leaves view untouched',async()=>{
 const url=new URL('./view.mjs',import.meta.url),original=readFileSync(url,'utf8');let candidate=original;
 if(!candidate.includes('_alignLivingCharacters(match){')){
  const patch=readFileSync(new URL('../docs/phase1-grips-integration.patch',import.meta.url),'utf8');
  for(const hunk of patch.split(/^@@ .* @@.*\n/m).slice(1)){
   const lines=hunk.split('\n');if(lines.at(-1)==='')lines.pop();
   const before=lines.filter(l=>l[0]===' '||l[0]==='-').map(l=>l.slice(1)+'\n').join('');
   const after=lines.filter(l=>l[0]===' '||l[0]==='+').map(l=>l.slice(1)+'\n').join('');
   assert.ok(candidate.includes(before),'lead view drift: rebase patch without applying it');
   candidate=candidate.replace(before,after);
  }
 }
 assert.match(candidate,/this\._updateHitReactions\(\);this\._alignLivingCharacters\(match\);/);
 const checked=spawnSync(process.execPath,['--input-type=module','--check'],{input:candidate,encoding:'utf8'});
 assert.equal(checked.status,0,checked.stderr);
 candidate=candidate.replace(/(from\s*['"])([^'"]+)(['"])/g,(_,a,p,b)=>a+(p.startsWith('.')?new URL(p,url).href:import.meta.resolve(p))+b);
 const {ArenaView}=await import('data:text/javascript;base64,'+Buffer.from(candidate).toString('base64'));
 const models=new Map(Array.from({length:5},(_,id)=>[id,modelFor()]));models.get(1).visible=false;
 const match={actors:[{id:0,health:100},{id:1,health:100},{id:2,health:0},{id:3,health:100,vehicleId:4},{id:4,health:100}]};
 const calls=[];
 const view={actorModels:models,characterLifecycle:{state:m=>m===models.get(4)?'respawning':'alive'},characterGroundAt:(x,z,y,source)=>{calls.push([x,z,y]);assert.equal(source,match);return .05;}};
 ArenaView.prototype._alignLivingCharacters.call(view,match);
 assert.equal(calls.length,2);
 for(const side of ['L','R'])assert.ok(Math.abs(world(models.get(0).userData.joints[`foot${side}`]).y-.1435)<1e-5);
 assert.equal(readFileSync(url,'utf8'),original);
});

test('authored anchors are honored and legacy defaults remain byte-for-byte unmodified',()=>{
 const m=modelFor(),d=m.userData;
 for(const type of [0,1,8,9]){
  d.gunAnchor.remove(d.weapon);d.weapon=weaponModel(type);d.weapon.scale.setScalar(1);d.gunAnchor.add(d.weapon);
  const anchors=d.weapon.userData.anchors;
  const before=[anchors.leftGrip.position.toArray(),anchors.rightGrip.position.toArray()];
  let result=rigs.alignLivingCharacter(m);
  assert.equal(result.hands.length,2);
  assert.deepEqual([anchors.leftGrip.position.toArray(),anchors.rightGrip.position.toArray()],before);
  anchors.leftGrip.position.set(-.1,-.08,-.22);anchors.rightGrip.position.set(0,-.17,-.035);
  result=rigs.alignLivingCharacter(m);
  for(const h of result.hands){
   assert.ok(h.error<1e-5);
   assert.ok(new T.Vector3(...h.target).distanceTo(world(anchors[h.side==='L'?'leftGrip':'rightGrip']))<1e-6);
  }
 }
});

test('aim, crouch, gait, reload and weapon replacement keep finite fixed-length limbs',()=>{
 const m=modelFor(),d=m.userData;
 for(const state of [{ads:true},{crouch:true},{speed:8,strafe:1,forward:1},{reload:1},{grounded:false},{reduced:true}]){
  d.rig.update({dt:.1,...state});d.gunAnchor.rotation.set(.65,.85,0);
  const result=rigs.alignLivingCharacter(m,{grounded:state.grounded!==false});
  for(const hand of result.hands){assert.ok(Number.isFinite(hand.error));assert.ok(hand.error<.3);}
  for(const side of ['L','R']){
   assert.equal(d.joints[`forearm${side}`].parent.position.length(),.29);
   assert.equal(d.joints[`hand${side}`].position.length(),.275);
  }
 }
});

test('null, invalid, remote floors and airborne states do not pull feet to an invented floor',()=>{
 for(const floor of [null,undefined,NaN,Infinity,3,-3]){
  const m=modelFor(),before=['L','R'].map(s=>world(m.userData.joints[`foot${s}`]).toArray());let calls=0;
  const result=rigs.alignLivingCharacter(m,{sampleGround:()=>{calls++;return floor;}});
  assert.equal(calls,2);assert.equal(result.feet.length,0);
  assert.deepEqual(['L','R'].map(s=>world(m.userData.joints[`foot${s}`]).toArray()),before);
 }
 const m=modelFor();let calls=0;
 rigs.alignLivingCharacter(m,{grounded:false,sampleGround:()=>{calls++;return 0;}});assert.equal(calls,0);
});

test('reduced support is deterministic; modest platform movement tracks after base pose',()=>{
 const m=modelFor(),d=m.userData;
 d.rig.update({dt:.1,reduced:true,speed:8});
 let result=rigs.alignLivingCharacter(m,{sampleGround:()=>.06});
 const before=result.feet.map(f=>f.target);
 result=rigs.alignLivingCharacter(m,{sampleGround:()=>.06});
 for(let i=0;i<2;i++)assert.ok(new T.Vector3(...result.feet[i].target).distanceTo(new T.Vector3(...before[i]))<1e-6);
 d.rig.update({dt:.1,reduced:true,speed:8});
 result=rigs.alignLivingCharacter(m,{sampleGround:()=>.08});
 for(const f of result.feet){assert.ok(f.error<1e-5);assert.ok(Math.abs(f.target[1]-.1735)<1e-6);}
});

test('corpse ownership rejects alignment and respawn restores every IK joint and mount',()=>{
 const m=modelFor(),d=m.userData,life=new rigs.CharacterLifecycle();
 rigs.alignLivingCharacter(m,{sampleGround:()=>.06});
 life.update(m,{health:0,x:0,y:0,z:0,yaw:0},{reduced:true,sampleGround:()=>0});
 const snapshot=()=>{const out=[];m.traverse(n=>out.push([...n.position,...n.quaternion,...n.scale]));return out;};
 const dead=snapshot();let calls=0;
 const result=rigs.alignLivingCharacter(m,{sampleGround:()=>{calls++;return 8;}});
 assert.deepEqual(result,{hands:[],feet:[]});assert.equal(calls,0);assert.deepEqual(snapshot(),dead);
 life.update(m,{health:100,x:2,y:0,z:0,yaw:0});
 assert.equal(d.rig.pose,null);assert.equal(d.rig.lifecycle,'alive');
 for(const b of d.rig.bind){
  assert.deepEqual(b.node.position.toArray(),[b.position.x,b.position.y,b.position.z]);
  assert.ok(Math.abs(b.node.rotation.x-b.rotation.x)<1e-6);
  assert.ok(Math.abs(b.node.rotation.y-b.rotation.y)<1e-6);
  assert.ok(Math.abs(b.node.rotation.z-b.rotation.z)<1e-6);
 }
});

test('base pose clears solved wrist rotations and weaponless feet still work',()=>{
 const m=modelFor(),d=m.userData;
 rigs.alignLivingCharacter(m);
 d.rig.update({dt:0});
 for(const side of ['L','R']) assert.ok(d.joints[`hand${side}`].quaternion.angleTo(new T.Quaternion())<1e-6);
 d.weapon=null;let calls=0;
 const result=rigs.alignLivingCharacter(m,{sampleGround:()=>{calls++;return .04;}});
 assert.equal(calls,2);assert.equal(result.feet.length,2);assert.equal(result.hands.length,0);
});

test('each grounded foot samples its own world support and preserves actor transforms',()=>{
 const m=modelFor();m.position.set(3,2,4);m.rotation.y=.8;m.scale.setScalar(1.2);
 const initial=['L','R'].map(s=>world(m.userData.joints[`foot${s}`]));
 const calls=[];
 const result=rigs.alignLivingCharacter(m,{sampleGround:(x,z,referenceY)=>{
  calls.push([x,z,referenceY]);return calls.length===1?2.07:2;
 }});
 assert.equal(calls.length,2);assert.equal(result.feet.length,2);
 for(let i=0;i<2;i++){
  assert.ok(Math.abs(calls[i][0]-initial[i].x)<1e-6);
  assert.ok(Math.abs(calls[i][1]-initial[i].z)<1e-6);assert.equal(calls[i][2],2);
  const ankle=world(m.userData.joints[`foot${i===0?'L':'R'}`]);
  assert.ok(Math.abs(ankle.y-(i===0?2.07:2)-.0935*1.2)<1e-5);
 }
 assert.deepEqual(m.position.toArray(),[3,2,4]);assert.equal(m.rotation.y,.8);
});

test('all ten living weapons align both hand sockets without moving weapon or actor',()=>{
 assert.equal(typeof rigs.alignLivingCharacter,'function');
 for(let type=0;type<10;type++){
  const m=modelFor(type),d=m.userData;m.position.set(4,2,-3);m.rotation.y=.7;m.scale.setScalar(1.2);
  const weaponPosition=d.weapon.position.clone(),anchorPosition=d.gunAnchor.position.clone();
  const result=rigs.alignLivingCharacter(m,{grounded:true});
  assert.equal(result.hands.length,2);
  for(const hand of result.hands){
   assert.ok(hand.error<1e-5,`${type} ${hand.side}: ${hand.error}`);
   assert.ok(world(d.characterRefinement[`grip${hand.side}`]).distanceTo(new T.Vector3(...hand.target))<1e-5);
  }
  assert.ok(new T.Vector3(...result.hands[0].target).distanceTo(new T.Vector3(...result.hands[1].target))>.1);
  assert.deepEqual(d.weapon.position,weaponPosition);assert.deepEqual(d.gunAnchor.position,anchorPosition);
  assert.deepEqual(m.position.toArray(),[4,2,-3]);assert.equal(m.rotation.y,.7);
 }
});
