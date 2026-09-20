// Alt-fire presentation gates: ten weapon morphs, the spec-coloured muzzle,
// bounded hit-scan styles and the keyed projectile pool (cluster/mortar/bomb/
// mine) including the mine lifecycle and disposal. Everything here is
// presentation-only; the authoritative simulation is never read or written.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView,weaponModel} from './view.mjs';
import {ALT_FIRE,altSpecFor} from './alt-fire.mjs';
import {ALT_MORPHS,altMorphFor,altMorphNodes,applyAltMorph} from './weapon-models/alt-parts.mjs';
import {AltProjectilePool,ModelAssets,MuzzleLightPool,altRocketKind,altProjectileColor,ALT_PROJECTILE_COLORS} from './effects-fx.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';

// Same shape as the view.test fixture: a fully stubbed renderer plus the
// minimum presentation state `effect()` touches.
function harness(){
 const view=Object.assign(Object.create(ArenaView.prototype),{renderer:{isSoftware:false},camera:new T.PerspectiveCamera(),scene:new T.Scene(),hands:new T.Group(),actorModels:new Map(),playerId:7,currentWeapon:-1,lastEvent:0,motionQuery:{matches:false},display:{...DEFAULT_DISPLAY},feedback:{shot(){}}});
 return view;
}
const snapshot=nodes=>nodes.map(name=>{const n=name?.node??name;return n?[n.name,n.position.toArray(),n.rotation.toArray().slice(0,3),n.scale.toArray(),n.visible]:null;});
const flashColors=model=>{const colors=new Set();model.userData.flash.traverse(n=>{if(n.isMesh&&n.material?.color)colors.add(n.material.color.getHexString());});return colors;};

test('all ten alt morphs exist, resolve their nodes and stay within the part budget',()=>{
 assert.equal(ALT_MORPHS.length,ALT_FIRE.length);
 for(let type=0;type<10;type++){
  const model=weaponModel(type),morph=altMorphFor(type),nodes=altMorphNodes(type);
  assert.equal(morph.id,ALT_FIRE[type].id,`${type}: morph id follows the frozen spec`);
  assert.ok(nodes.length>=1);
  for(const name of nodes)assert.ok(model.getObjectByName(name),`${type}: ${name} exists on the assembled model`);
  let meshes=0,triangles=0;
  model.traverse(n=>{if(!n.userData.altPart)return;meshes++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});
  assert.ok(meshes>=1&&meshes<=6,`${type}: ${meshes} hidden alt meshes`);
  assert.ok(triangles<600,`${type}: ${Math.round(triangles)} alt triangles stay small`);
  const hidden=model.userData.altParts.filter(part=>part.userData.altPart);
  assert.equal(hidden.length,meshes);
  assert.ok(hidden.every(part=>part.visible===false),`${type}: alt parts start hidden`);
  const rest=snapshot(nodes.map(name=>({node:model.getObjectByName(name)})));
  applyAltMorph(model,type,1,{reduced:false,time:.2});
  assert.notEqual(JSON.stringify(snapshot(nodes.map(name=>({node:model.getObjectByName(name)})))),JSON.stringify(rest),`${type}: the morph is a real transformation`);
  assert.ok(nodes.some(name=>model.getObjectByName(name).visible===true),`${type}: the morph reveals extra geometry`);
  applyAltMorph(model,type,0,{reduced:true});
  assert.deepEqual(snapshot(nodes.map(name=>({node:model.getObjectByName(name)}))),rest,`${type}: t=0 restores the authored pose`);
  ArenaView.prototype.disposeObject.call({},model);
 }
});

test('the view morph lerps to one and back to zero, snapping under reduced motion',()=>{
 const view=Object.create(ArenaView.prototype),model=weaponModel(0);
 assert.equal(view._animateWeaponAlt(model,{weapon:0,alt:false},false,.08,0),0);
 assert.equal(view._animateWeaponAlt(model,{weapon:0,alt:true},false,.08,.08),.5,'~0.16 s blend is half way after 80 ms');
 assert.equal(view._animateWeaponAlt(model,{weapon:0,alt:true},false,.08,.16),1,'the morph reaches 1');
 assert.equal(model.getObjectByName('alt-salvo-prong-l').visible,true);
 assert.equal(view._animateWeaponAlt(model,{weapon:0,alt:false},false,.08,.24),.5);
 assert.equal(view._animateWeaponAlt(model,{weapon:0,alt:false},false,.08,.32),0,'the morph returns to 0');
 assert.equal(model.getObjectByName('alt-salvo-prong-l').visible,false);
 assert.equal(view._animateWeaponAlt(model,{weapon:0,alt:true},true,0,0),1,'reduced motion snaps up');
 assert.equal(model.getObjectByName('alt-salvo-prong-l').visible,true);
 assert.equal(view._animateWeaponAlt(model,{weapon:0,alt:false},true,0,0),0,'reduced motion snaps down');
 assert.equal(model.getObjectByName('alt-salvo-prong-c').visible,false);
 for(let i=0;i<64;i++){const amount=view._animateWeaponAlt(model,{weapon:0,alt:i%3!==0},false,1/60,i/60);assert.ok(amount>=0&&amount<=1,'the blend stays bounded under long frames');}
});

test('the alt muzzle flash takes the spec tracer colour and restores the base tint',()=>{
 const view=Object.create(ArenaView.prototype);
 for(let type=0;type<10;type++){
  const model=weaponModel(type),base=flashColors(model);
  assert.ok(base.size>=1);
  view._animateWeaponAlt(model,{weapon:type,alt:true},true,0,0);
  const tinted=flashColors(model);
  assert.deepEqual([...tinted],[ALT_FIRE[type].tracer.replace('#','')],`${type}: every flash mesh uses the alt tracer`);
  view._animateWeaponAlt(model,{weapon:type,alt:false},true,0,0);
  assert.deepEqual(flashColors(model),base,`${type}: the base muzzle tint returns`);
  ArenaView.prototype.disposeObject.call({},model);
 }
});

test('an alt shot flashes the muzzle light in the spec tracer colour',()=>{
 const view=harness();
 view.muzzleLights=new MuzzleLightPool(view.scene,2);
 view.effect({type:'shot',actor:7,weapon:0,alt:true,altId:'salvo',pellet:0,time:1,from:{x:0,y:1,z:0},to:{x:0,y:1,z:-9},hit:null});
 assert.ok(view.muzzleLights.lights.some(light=>light.visible&&light.color.getHexString()===ALT_FIRE[0].tracer.replace('#','')),'the muzzle light carries the salvo tracer colour');
 view.muzzleLights.dispose();
});

test('every alt hit-scan style spawns pooled effects inside the fixed budget',()=>{
 const view=harness();
 const styles=ALT_FIRE.filter(spec=>spec.kind==='hitscan');
 assert.equal(styles.length,6);
 for(const spec of styles){
  const event=Object.freeze({type:'shot',actor:7,weapon:spec.index,alt:true,altId:spec.id,pellet:0,time:spec.index,from:Object.freeze({x:0,y:1,z:0}),to:Object.freeze({x:0,y:1,z:-12}),hit:null});
  const copy=structuredClone(event);
  view.effect(event);
  assert.ok(view.effectPool.slots.some(slot=>slot.active),`${spec.id} spawns effects`);
  assert.deepEqual(event,copy,`${spec.id} never mutates the authoritative event`);
 }
 assert.ok(view.effectPool.slots.length<=view.effectPool.limit);
 for(let i=0;i<view.effectPool.limit*3;i++)view.effect({type:'shot',actor:7,weapon:0,alt:true,altId:'salvo',time:i,from:{x:0,y:1,z:0},to:{x:0,y:1,z:-8}});
 assert.equal(view.effectPool.slots.length,view.effectPool.limit,'a salvo cannot grow the pool');
 assert.ok(view.effectPool.slots.filter(slot=>slot.active).length<=view.effectPool.limit);
 view.effectPool.dispose();
});

test('twin alt-fire alternates barrel anchors while energy alts skip casings',t=>{
 const view=harness();
 view.scene.add(view.hands);view.hands.visible=true;
 view.firstPerson=view._acquireWeapon(9,null,null);view.hands.add(view.firstPerson);view.hands.updateWorldMatrix(true,true);
 const seen=[];
 view.shotEffect=event=>seen.push({from:event.from,side:event.muzzleSide,alt:event.alt});
 for(const pellet of [0,1,2,3])view.effect({type:'shot',actor:7,weapon:9,alt:true,altId:'twin',pellet,time:1,from:{x:0,y:1,z:0},to:{x:0,y:1,z:-9},hit:null});
 assert.equal(seen.length,4);
 const [a,b]=seen;
 assert.ok(a.side&&b.side,'both twin pellets expose a barrel-side offset');
 assert.equal(Math.sign(a.side.x),-Math.sign(b.side.x),'consecutive pellets alternate sides');
 assert.ok(Math.abs(a.side.x-b.side.x)>.05,`the anchors are visibly apart (${Math.abs(a.side.x-b.side.x).toFixed(3)})`);
 assert.equal(view._ejectShell({type:'shot',actor:7,weapon:0,alt:true,altId:'salvo',id:1})?.active,true,'a kinetic alt still ejects a casing');
 assert.equal(view._ejectShell({type:'shot',actor:7,weapon:6,alt:true,altId:'chain',id:2}),null,'the chain alt is energy and skips casings');
 assert.equal(view._ejectShell({type:'shot',actor:7,weapon:5,alt:true,altId:'mine',id:3}),null,'a projectile alt never throws a casing');
 view.shellPool?.dispose();
});

test('snapshot rockets sync kinds, adopt ids and drive distinct alt visuals',()=>{
 const view=harness();
 assert.equal(altRocketKind({alt:true,weapon:1}),'cluster');
 assert.equal(altRocketKind({alt:true,weapon:4}),'mortar');
 assert.equal(altRocketKind({mine:true,weapon:5}),'mine');
 assert.equal(altRocketKind({bomblets:3,weapon:1}),'cluster');
 assert.equal(altRocketKind({flak:8,weapon:7}),'bomb');
 assert.equal(altRocketKind({alt:false,weapon:1}),null);
 assert.equal(altProjectileColor('mortar'),ALT_PROJECTILE_COLORS.mortar);
 view._syncAltProjectiles([
  {id:5,weapon:1,alt:true,altId:'cluster',pos:{x:1,y:1,z:-1}},
  {id:6,weapon:4,alt:true,altId:'mortar',pos:{x:2,y:2,z:-2}},
  {id:7,weapon:7,flak:8,pos:{x:3,y:1,z:-3}},
  {id:8,weapon:5,mine:true,pos:{x:4,y:0,z:-4},life:5,arm:.45},
  {id:9,weapon:0,pos:{x:9,y:0,z:9}},
 ],1,false);
 const pool=view.altProjectiles;
 assert.equal(pool.activeCount(),4,'only alt rockets get a visual');
 assert.deepEqual(pool.slots.filter(slot=>slot.active).map(slot=>slot.kind).sort(),['bomb','cluster','mine','mortar']);
 assert.ok(pool.slots.filter(slot=>slot.active).every(slot=>slot.group.visible));
 assert.equal(pool.explode(7,{x:3,y:1,z:-3}).kind,'bomb');
 assert.equal(pool.activeCount(),3);
 pool.update(2,{time:5,reduced:false});
 assert.equal(pool.slots.filter(slot=>slot.active&&slot.kind!=='mine').length,0,'stale flyers expire when the snapshot drops them');
 assert.equal(pool.slots.filter(slot=>slot.active&&slot.kind==='mine').length,1,'a mine holds until its life expires');
 pool.update(2,{time:7,reduced:false});
 assert.equal(pool.activeCount(),0);
 pool.dispose();
});

test('alt launch events spawn the four distinct projectile visuals',()=>{
 const view=harness();
 for(const [weapon,id] of [[1,'cluster'],[4,'mortar'],[5,'mine'],[7,'bomb']])view.effect({type:'launch',actor:7,weapon,alt:true,altId:id,projectile:100+weapon,from:{x:weapon,y:1,z:0},time:1+weapon,arm:.4,life:6});
 const pool=view.altProjectiles,active=pool.slots.filter(slot=>slot.active);
 assert.equal(active.length,4,'each launch spawns one keyed visual');
 assert.deepEqual(active.map(slot=>slot.kind).sort(),['bomb','cluster','mine','mortar']);
 const byKind=Object.fromEntries(active.map(slot=>[slot.kind,slot]));
 assert.equal(byKind.cluster.material.color.getHexString(),ALT_PROJECTILE_COLORS.cluster.replace('#',''));
 assert.equal(byKind.mortar.material.color.getHexString(),ALT_PROJECTILE_COLORS.mortar.replace('#',''));
 assert.equal(byKind.bomb.material.color.getHexString(),ALT_PROJECTILE_COLORS.bomb.replace('#',''));
 assert.equal(byKind.mine.material.color.getHexString(),ALT_PROJECTILE_COLORS.mine.replace('#',''));
 assert.notEqual(byKind.cluster.body.geometry,byKind.mortar.body.geometry,'the pod and orb are distinct shapes');
 assert.notEqual(byKind.mortar.body.geometry,byKind.bomb.body.geometry);
 assert.equal(byKind.mine.disc.visible,true,'the mine is a disc with prongs');
 assert.equal(byKind.mine.prongs.visible,true);
 assert.ok(view.telegraphPool?.slots.some(slot=>slot.active),'the mine deploy pings a sensor ring');
 for(let i=0;i<pool.limit*3;i++)view.effect({type:'launch',actor:7,weapon:1,alt:true,altId:'cluster',projectile:200+i,from:{x:i,y:1,z:0},time:2+i*.01});
 assert.ok(pool.slots.length<=pool.limit,'launch visuals stay inside the pool budget');
 pool.dispose();
 if(view.telegraphPool)view.telegraphPool.dispose();
 if(view.effectPool)view.effectPool.dispose();
});

test('mine lifecycle: spawn, arm/blink, explosion removal and expiry leave zero live objects',()=>{
 const view=harness();
 view.effect({type:'launch',actor:7,weapon:5,alt:true,altId:'mine',projectile:42,from:{x:0,y:1,z:0},time:1,arm:.45,life:7});
 const pool=view.altProjectiles,slot=pool.slots.find(entry=>entry.active);
 assert.ok(slot&&slot.kind==='mine','the launch event spawns the keyed mine visual');
 assert.equal(slot.key,null,'the snapshot id is adopted later');
 assert.equal(slot.pendingKey,'42');
 assert.equal(slot.group.visible,true);
 assert.equal(slot.eye.visible,false,'the sensor is dark before arming');
 pool.update(.1,{time:1.2,reduced:false});
 assert.equal(slot.eye.visible,false);
 pool.update(.1,{time:1.5,reduced:false});
 assert.equal(slot.eye.visible,true,'the sensor blinks after arming');
 pool.update(.1,{time:1.6,reduced:false});
 assert.equal(slot.eye.visible,false,'the blink alternates');
 pool.update(.1,{time:1.6,reduced:true});
 assert.equal(slot.eye.visible,true,'reduced motion holds the sensor static');
 pool.sync([{id:42,kind:'mine',pos:{x:0,y:1,z:-1},life:5,arm:0}],{time:1.7});
 assert.equal(slot.key,'42','the snapshot adopts the launch visual by position');
 view.effect({type:'explosion',actor:7,weapon:5,alt:true,altId:'mine',projectile:42,pos:{x:0,y:1,z:-1},time:1.8});
 assert.equal(pool.activeCount(),0,'the matching explosion removes the mine');
 view.effect({type:'launch',actor:7,weapon:5,alt:true,altId:'mine',projectile:43,from:{x:1,y:1,z:1},time:2,arm:.2,life:.3});
 assert.equal(pool.activeCount(),1);
 pool.update(.1,{time:2.4,reduced:false});
 assert.equal(pool.activeCount(),0,'life expiry removes an orphaned mine');
 for(let i=0;i<pool.limit*3;i++)view.effect({type:'launch',actor:7,weapon:5,alt:true,altId:'mine',projectile:100+i,from:{x:i,y:1,z:0},time:3+i*.01,arm:.2,life:8});
 assert.ok(pool.slots.length<=pool.limit,'the keyed pool stays bounded');
 assert.ok(pool.activeCount()<=pool.limit);
 assert.ok(pool.slots.every(entry=>entry.active||entry.group.visible===false));
 pool.dispose();
 assert.equal(view.scene.children.filter(child=>child.name==='alt-projectile').length,0);
});

test('the alt projectile pool disposes geometry and materials exactly once',()=>{
 const scene=new T.Scene(),pool=new AltProjectilePool(scene,6);
 for(let i=0;i<12;i++)pool.spawn({kind:i%2?'mine':'cluster',pos:{x:i,y:1,z:0},time:i,life:6});
 assert.equal(pool.slots.length,6,'slots reuse oldest-first at the budget');
 const resources=new Set();
 scene.traverse(node=>{if(node.geometry)resources.add(node.geometry);if(node.material)resources.add(node.material);});
 const counts=new Map();for(const resource of resources){const entry={count:0};counts.set(resource,entry);resource.addEventListener('dispose',()=>entry.count++);}
 pool.dispose();
 assert.equal(scene.children.filter(child=>child.name==='alt-projectile').length,0);
 assert.ok([...counts.values()].every(entry=>entry.count===1));
 pool.dispose();
});

test('the weapon cache grows by nothing after repeated alt-capable acquire/release',()=>{
 const view=Object.create(ArenaView.prototype);view.hands=new T.Group();view.modelAssets=new ModelAssets();
 const warm=()=>{for(let i=0;i<10;i++){const model=view._acquireWeapon(i,null,null);view._releaseWeapon(model);}};
 warm();
 const assets=view.modelAssets,counts=[assets.geometries.size,assets.materials.size,assets.resources.size],cached=view._weaponCache.size;
 warm();warm();
 assert.deepEqual([assets.geometries.size,assets.materials.size,assets.resources.size],counts,'alt parts allocate no new shared resources');
 assert.equal(view._weaponCache.size,cached);
 assert.ok(cached<=16);
 assert.ok(view._weaponCache.size>=10);
});

test('alt geometry disposes with the assembled model exactly once',()=>{
 for(const type of [0,2,7,9]){
  const model=weaponModel(type),resources=new Set();
  let altMeshes=0;
  model.traverse(node=>{if(node.userData.altPart)altMeshes++;if(node.geometry)resources.add(node.geometry);if(node.material)resources.add(node.material);});
  assert.ok(altMeshes>=2,`${type}: alt geometry is part of the model`);
  const counts=new Map();for(const resource of resources){const entry={count:0};counts.set(resource,entry);resource.addEventListener('dispose',()=>entry.count++);}
  ArenaView.prototype.disposeObject.call({},model);
  assert.ok([...counts.values()].every(entry=>entry.count===1),`${type}: every alt resource disposes once`);
 }
});
