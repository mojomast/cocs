// Graphics-fidelity pass: oriented decals, explosion kit, weather streaks and
// splashes, WebGL contact shadows and the shared sampling/cap/tuning helpers.
// Every assertion here is presentation-only; the simulation is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView,bloomTuning,weatherParticleCap,SHADOW_FIT_EXTENT,muzzleLightCount} from './view.mjs';
import {ContactShadowPool,DecalPool,MuzzleLightPool,RipplePool} from './effects-fx.mjs';
import {EffectPool} from './feedback.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';
import {qualitySettings} from './post.mjs';

const withDocument=t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>ctx})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
};

const viewHarness=(overrides={})=>Object.assign(Object.create(ArenaView.prototype),{
 renderer:{isSoftware:false},
 camera:new T.PerspectiveCamera(),
 scene:new T.Scene(),
 actorModels:new Map(),
 vehicleModels:new Map(),
 playerId:7,
 lastEvent:0,
 motionQuery:{matches:false},
 display:{...DEFAULT_DISPLAY},
 ...overrides,
});

test('decals orient to the impact surface and keep the flat fallback for vertical hits',t=>{
 withDocument(t);
 const scene=new T.Scene(),pool=new DecalPool(scene,6);
 // A wall hit: the incoming ray is horizontal, so the quad normal must be
 // horizontal too (the old code always laid it on the floor).
 const wall={x:0,y:2,z:0},dir={x:1,y:0,z:0};
 assert.equal(pool.spawn(wall,{seed:1,dir}),true);
 const wallSlot=pool.slots[0];
 const normal=new T.Vector3(0,0,1).applyQuaternion(wallSlot.obj.quaternion);
 assert.ok(Math.abs(normal.y)<1e-6,'a wall impact stands the quad up');
 assert.ok(Math.abs(normal.x)>.99,'the wall decal faces back along the ray');
 assert.ok(Math.abs(wallSlot.obj.position.x-(wall.x+normal.x*.02))<1e-9,'the decal lifts off the surface along its normal');
 // A vertical hit keeps the ground-parallel stamp and the floor offset.
 const floor={x:1,y:0,z:1};
 pool.spawn(floor,{seed:2,dir:{x:0,y:-1,z:0}});
 const floorSlot=pool.slots[1];
 const flatNormal=new T.Vector3(0,0,1).applyQuaternion(floorSlot.obj.quaternion);
 assert.ok(Math.abs(Math.abs(flatNormal.y)-1)<1e-6,'a vertical hit stays flat');
 assert.ok(Math.abs(floorSlot.obj.position.y-(floor.y+.025))<1e-9,'the flat fallback keeps the historical floor offset');
 assert.equal(pool.mask?.isCanvasTexture,true,'the pool generates one shared radial mask');
 assert.equal(pool.slots.filter(slot=>slot.material.map===pool.mask).length,2,'every slot samples the one mask');
 // Bounds and exactly-once disposal, mask included.
 for(let i=0;i<24;i++)pool.spawn({x:i,y:0,z:0},{seed:i});
 assert.equal(pool.slots.length,6,'the pool never grows past its limit');
 const resources=new Set([pool.geometry,pool.mask]);for(const slot of pool.slots)resources.add(slot.material);
 const counts=new Map();for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
 pool.dispose();
 assert.ok([...counts.values()].every(count=>count===1),'geometry, mask and materials dispose exactly once');
});

test('the blast scorch stamps a ring and a core without growing the decal budget',t=>{
 withDocument(t);
 const scene=new T.Scene(),pool=new DecalPool(scene,3);
 pool.scorch({x:2,y:0,z:-1},{size:1,seed:9});
 assert.equal(pool.slots.filter(slot=>slot.active).length,2,'a scorch is a ring plus a dense core');
 const scales=pool.slots.filter(slot=>slot.active).map(slot=>slot.obj.scale.x).sort((a,b)=>a-b);
 assert.ok(scales[1]>scales[0]*1.5,'the ring is the wider stamp');
 pool.dispose();
});

test('the muzzle light pool carries four fixed slots and honours an intensity pulse',()=>{
 const scene=new T.Scene(),pool=new MuzzleLightPool(scene,4);
 assert.equal(scene.children.length,4);
 pool.flash('#ff8844',{x:1,y:2,z:3},.24,4.2);
 const light=pool.lights[1];
 assert.equal(light.intensity,4.2,'the pulse uses the requested peak');
 assert.equal(light.parent,scene);
 pool.update(.12);
 assert.ok(light.intensity>0&&light.intensity<4.2,'the pulse decays');
 pool.update(.2);
 assert.ok(light.intensity===0&&!light.visible,'the pulse ends');
 for(let i=0;i<40;i++)pool.flash('#ffffff',{x:0,y:0,z:0});
 assert.equal(scene.children.length,4,'the pool stays fixed-size');
 pool.dispose();assert.equal(scene.children.length,0);
});

test('the muzzle-light budget follows the tier and nearby flashes keep their own slot',()=>{
 assert.equal(muzzleLightCount(0),2);assert.equal(muzzleLightCount(1),3);assert.equal(muzzleLightCount(2),4);
 assert.equal(muzzleLightCount(9),4,'the high tier keeps the historical four slots');
 assert.equal(muzzleLightCount(-1),2);assert.equal(muzzleLightCount(),2);
 const scene=new T.Scene(),pool=new MuzzleLightPool(scene,4);
 assert.equal(pool.flash('#ff8844',{x:0,y:0,z:0},.5,3).intensity,3);
 assert.equal(pool.lights[1].intensity,3,'the historical slot order is preserved');
 for(const position of [{x:0,y:0,z:0},{x:10,y:0,z:0},{x:0,y:0,z:10}])pool.flash('#ffffff',position,.5,2);
 assert.ok(pool.lights.every(light=>light.userData.remaining>0),'all four lights are busy');
 const before=pool.lights.map(light=>light.position.clone());
 const chosen=pool.flash('#ffffff',{x:0,y:0,z:0},.5,2);
 const recycled=pool.lights.indexOf(chosen),farthest=Math.max(...before.map(point=>point.lengthSq()));
 assert.ok(Math.abs(before[recycled].lengthSq()-farthest)<1e-9,'the farthest pulse is recycled');
 assert.ok(before[recycled].lengthSq()>1,'a nearby pulse is not recycled');
 pool.update(.6);
 assert.ok(pool.lights.every(light=>!light.visible&&light.intensity===0));
 // A tiered view resizes the fixed bank on a quality change.
 const view=viewHarness({scene:new T.Scene(),qualitySettings:qualitySettings('high')});
 view.muzzleLights=new MuzzleLightPool(view.scene,4);
 view.qualitySettings=qualitySettings('low');view._onQualityChange();
 assert.equal(view.muzzleLights.lights.length,2,'the low tier drops to two lights');
 assert.equal(view.scene.children.length,2);
 view.qualitySettings=qualitySettings('medium');view._onQualityChange();
 assert.equal(view.muzzleLights.lights.length,3);
 view.qualitySettings=qualitySettings('high');view._onQualityChange();
 assert.equal(view.muzzleLights.lights.length,4,'the high tier restores four');
 view.muzzleLights.dispose();pool.dispose();
});

test('weather particle caps follow the preset budget, not the ambient mote count',()=>{
 const rain={particles:90},storm={particles:130},clear={particles:0};
 assert.equal(weatherParticleCap(clear,{particles:1},1),0);
 assert.ok(weatherParticleCap(storm,{particles:1},1)>weatherParticleCap(rain,{particles:1},1),'a heavier preset raises the cap');
 assert.ok(weatherParticleCap(rain,{particles:1},1)>weatherParticleCap(rain,{particles:.4},1),'the tier scales the cap');
 assert.ok(weatherParticleCap(rain,{particles:1},.7)<weatherParticleCap(rain,{particles:1},1));
 assert.equal(weatherParticleCap(rain,{particles:1,ambientMotes:99},1),weatherParticleCap(rain,{particles:1},1),'the ambient mote count is irrelevant');
 for(const scale of [0,.4,1,4]){const cap=weatherParticleCap(storm,{particles:1},scale,44);assert.ok(Number.isFinite(cap)&&cap>=2&&cap<=44,`cap ${cap} stays bounded`);}
});

test('bloom tuning keeps the historical low-tier values and opens up the higher tiers',()=>{
 assert.deepEqual(bloomTuning(0),{threshold:.9,radius:.72},'low tier is byte-identical to the old fixed values');
 assert.deepEqual(bloomTuning(-1),bloomTuning(0));
 for(const tier of [1,2]){const tune=bloomTuning(tier);assert.ok(tune.threshold<.9&&tune.radius<.72,`tier ${tier} tightens bloom`);}
});

test('rain and storm adds render as velocity-aligned streaks and schedule splashes',()=>{
 const view=viewHarness({mapId:'crosswire'});
 view.weatherPool=new EffectPool(view.scene,48);
 view.characterGroundAt=()=>0;
 const add=desc=>view._weatherAdd(desc);
 const base={color:'#aebccb',size:.028,life:1.1,streak:1.3,pos:{x:0,y:5,z:0},velocity:{x:0,y:-19,z:0}};
 add(base);
 const streak=view.weatherPool.slots.find(slot=>slot.active);
 assert.ok(streak?.line===true,'a rain add becomes a line slot');
 assert.ok(Math.abs(streak.obj.position.y-5)<1e-9);
 const tail=new T.Vector3(0,0,1).applyQuaternion(streak.obj.quaternion);
 assert.ok(tail.y<-.99,'the streak points along the fall velocity');
 // Every fifth drop schedules a delayed ground splash (three per frame max).
 for(let i=0;i<20;i++)add({...base,pos:{x:i,y:5,z:0}});
 assert.ok(view.ripplePool,'a ground splash lazily allocates the ripple pool');
 const ripples=view.ripplePool.slots.filter(slot=>slot.active);
 assert.ok(ripples.length>0&&ripples.length<=3,'splashes stay bounded per frame');
 assert.ok(ripples.every(slot=>slot.delay>0),'the splash waits for the drop to land');
 assert.ok(ripples.every(slot=>Math.abs(slot.obj.position.y-.02)<1e-9),'splashes sit on the sampled ground');
 // Non-streak weather keeps the ambient pool path unchanged.
 const snow={color:'#eef6ff',size:.045,life:3,streak:.4,pos:{x:0,y:6,z:0},velocity:{x:0,y:-2.4,z:0}};
 const before=view.weatherPool.slots.filter(slot=>slot.active).length;
 add(snow);
 assert.equal(view.weatherPool.slots.filter(slot=>slot.active).length,before+1,'snow stays a pooled mote');
 assert.ok(view.weatherPool.slots.some(slot=>slot.active&&!slot.line),'snow uses the sphere path');
 view.ripplePool.dispose();view.weatherPool.dispose();
});

test('ripple slots stay hidden until their landing delay and dispose exactly once',()=>{
 const scene=new T.Scene(),pool=new RipplePool(scene,3);
 const slot=pool.spawn({x:1,y:0,z:2},{delay:.15,life:.5,size:.4,seed:4});
 assert.equal(slot.active,true);
 assert.equal(slot.obj.visible,false,'the ripple waits for contact');
 pool.update(.1);
 assert.equal(slot.obj.visible,false);
 pool.update(.1);
 assert.equal(slot.obj.visible,true,'the ripple appears after the delay');
 const scale=slot.obj.scale.x;
 pool.update(.2);
 assert.ok(slot.obj.scale.x>scale,'the ripple expands');
 for(let i=0;i<20;i++)pool.spawn({x:i,y:0,z:0},{delay:0,life:.4,seed:i});
 assert.ok(pool.slots.length<=3,'the ripple pool is bounded');
 const resources=new Set([pool.geometry]);if(pool.mask)resources.add(pool.mask);for(const entry of pool.slots)resources.add(entry.material);
 const counts=new Map();for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
 pool.dispose();
 assert.ok([...counts.values()].every(count=>count===1),'ripple resources dispose exactly once');
});

test('contact shadow slots key on presentation ids, hide the missing and stay bounded',t=>{
 withDocument(t);
 const scene=new T.Scene(),pool=new ContactShadowPool(scene,3);
 assert.ok(pool.place('a:1',1,0,1,{radius:.6,opacity:.4}));
 assert.ok(pool.place('a:2',2,0,2,{radius:.6,opacity:.4}));
 pool.end();
 assert.equal(scene.children.filter(child=>child.visible).length,2);
 assert.ok(pool.place('a:1',5,0,5,{radius:.5,opacity:.3}),'a tracked id keeps its slot');
 assert.equal(pool.byId.get('a:1').obj.position.x,5);
 pool.end();
 assert.equal(scene.children.filter(child=>child.visible).length,1,'a missing id hides its shadow');
 for(let i=0;i<10;i++)pool.place(`x:${i}`,i,0,0);
 pool.end();
 assert.ok(pool.slots.length<=3,'the pool budget holds');
 assert.equal(scene.children.filter(child=>child.visible).length,3);
 const resources=new Set([pool.geometry,pool.mask]);for(const slot of pool.slots)resources.add(slot.material);
 const counts=new Map();for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
 pool.dispose();
 assert.ok([...counts.values()].every(count=>count===1),'contact shadow resources dispose exactly once');
 assert.equal(scene.children.length,0);
});

test('the view grounds WebGL contact shadows, clears them under reduced motion and never allocates on software',()=>{
 const actor={id:2,character:'claude',health:100,x:1,y:0,z:2,vehicleId:null};
 const match={arena:{id:'crosswire'},actors:[actor],vehicles:[],time:1};
 const view=viewHarness({actorModels:new Map([[2,new T.Group()]])});
 view.characterGroundAt=()=>0;
 assert.equal(view._syncContactShadows(match,false),1,'a living actor gets one grounded shadow');
 const slot=view.contactShadows.slots.find(entry=>entry.active);
 assert.ok(slot&&Math.abs(slot.obj.position.y-.035)<1e-9,'the shadow sits on the sampled ground');
 view._syncContactShadows(match,true);
 assert.ok(view.contactShadows.slots.every(entry=>!entry.active),'reduced motion hides contact shadows');
 const software=viewHarness({renderer:{isSoftware:true}});
 assert.equal(software._syncContactShadows(match,false),0);
 assert.ok(!software.contactShadows,'the CPU renderer never allocates the pool');
 view.contactShadows.dispose();
});

test('blast scorches are WebGL-only, grounded and static under reduced motion',()=>{
 const view=viewHarness({});
 view.characterGroundAt=()=>0;
 const reduced=view._spawnScorchDecal({x:3,y:4,z:1},true,1,5);
 assert.ok(reduced,'reduced motion still stamps the static scorch');
 const marks=view.decalPool.slots.filter(slot=>slot.active);
 assert.equal(marks.length,2,'the scorch is a ring plus a core');
 assert.ok(marks.every(slot=>Math.abs(slot.obj.position.y-.025)<1e-9),'a mid-air blast is grounded on support');
 view.decalPool.dispose();
 const software=viewHarness({renderer:{isSoftware:true}});
 assert.equal(software._spawnScorchDecal({x:0,y:0,z:0},false,1,1),null,'the CPU renderer never stamps');
 assert.ok(!software.decalPool);
});

test('the explosion kit is pooled, deterministic and drops animated parts under reduced motion',()=>{
 const view=viewHarness({});
 const first=view._explosionKit({x:0,y:1,z:0},'#ffb066',false,11,1);
 const second=view._explosionKit({x:0,y:1,z:0},'#ffb066',false,11,1);
 assert.ok(first>=3&&second===first,'same seed, same spawn count');
 const smoke=view.effectPool.slots.filter(slot=>slot.active&&!slot.line);
 assert.ok(smoke.length>=6,'each blast adds a few smoke motes');
 assert.ok(smoke.every(slot=>slot.velocity.y>0),'smoke rises');
 assert.equal(view._explosionKit({x:0,y:1,z:0},'#fff',true,1,1),0,'reduced motion drops the animated kit');
 view.effectPool.dispose();
});

test('the shadow fit constant is the promised view-tight box',()=>{
 assert.ok(SHADOW_FIT_EXTENT>=17.5&&SHADOW_FIT_EXTENT<=20,'a 35-40 m box');
});

test('deployable sentries build one shared-geometry model per id, aim and dispose by id',()=>{
 const view=viewHarness({mapId:'crosswire'});
 const match={time:1,arena:{id:'crosswire',color:'#55ddcc'},deployables:[
  {id:1,team:0,x:2,y:0,z:3,life:10,range:22},
  {id:2,team:1,x:-4,y:0,z:1,life:5,range:22},
 ],actors:[{id:9,team:1,health:100,x:3,y:0,z:3}]};
 assert.equal(view.updateDeployables(match,false),2,'one model per live deployable');
 const first=view.deployableModels.get(1),second=view.deployableModels.get(2);
 assert.ok(first&&second,'models are keyed by sentry id');
 assert.deepEqual(first.position.toArray(),[2,0,3]);
 assert.equal(first.parent,view.scene,'the sentry joins the scene');
 assert.notEqual(first.userData.head.rotation.y,0,'the turret head tracks the nearest enemy');
 assert.ok(Math.abs(first.userData.eye.material.emissiveIntensity-.85)<.26,'the eye carries a bounded idle glow');
 view.updateDeployables(match,false);
 assert.equal(view.deployableModels.get(1),first,'the same id reuses its model');
 let eyeDisposed=0;
 first.userData.eye.material.addEventListener('dispose',()=>eyeDisposed++);
 view.updateDeployables({...match,deployables:[match.deployables[1]]},false);
 assert.equal(view.deployableModels.size,1,'an expired sentry leaves the map');
 assert.equal(eyeDisposed,1,'the removed sentry material disposes exactly once');
 assert.equal(second.parent,view.scene,'the sibling sentry stays in the scene');
 const many=Array.from({length:7},(_,i)=>({id:i+10,team:0,x:i,y:0,z:0,life:5,range:22,owner:0}));
 view.updateDeployables({...match,deployables:many},false);
 assert.equal(view.deployableModels.size,4,'the sentry budget is four');
 const headGeometry=view.deployableModels.get(10).userData.head.children[0].geometry;
 assert.equal(view.deployableModels.get(11).userData.head.children[0].geometry,headGeometry,'sentries share cached primitives');
 assert.ok(view.sharedResources?.has(headGeometry),'shared sentry geometry is tracked once for view disposal');
 view.disposeObject(view.scene);for(const resource of view.sharedResources??[])resource.dispose();
});

test('deployable events spawn a ring, tracer and smoke, and reduced motion keeps them quiet',()=>{
 const match={time:1,arena:{id:'crosswire',color:'#55ddcc'},deployables:[{id:2,team:1,x:-4,y:0,z:1,life:5,range:22}],actors:[{id:9,team:1,health:100,x:3,y:0,z:3}]};
 const view=viewHarness({mapId:'crosswire'});
 view._matchRef=match;
 view.updateDeployables(match,false);
 view.effect({type:'deployable',sentry:2,x:-4,y:0,z:1});
 assert.equal(view.telegraphPool?.slots.filter(slot=>slot.active).length,1,'the spawn cue draws one pooled ring');
 assert.ok(view.effectPool.slots.some(slot=>slot.active),'the spawn cue adds the burst cue');
 view.effect({type:'deployable-fire',sentry:2,actor:3,target:9});
 assert.ok(view.effectPool.slots.some(slot=>slot.active&&slot.line),'the fire cue adds a pooled tracer to the target');
 const smokeBefore=view.effectPool.slots.filter(slot=>slot.active&&!slot.line).length;
 view.effect({type:'deployable-expire',sentry:2,actor:3});
 const expired=view.effectPool.slots.filter(slot=>slot.active&&!slot.line).length-smokeBefore;
 assert.ok(expired>0,'the expire cue emits pooled smoke');
 assert.ok(expired<=2,'the expire cue stays bounded');
 view.effect({type:'deployable-destroyed',sentry:2,actor:3});
 const destroyed=view.effectPool.slots.filter(slot=>slot.active&&!slot.line).length-smokeBefore;
 assert.ok(destroyed>expired,'a destroyed sentry smokes harder than an expired one');
 const reduced=viewHarness({mapId:'crosswire',motionQuery:{matches:true}});
 reduced._matchRef=match;
 reduced.updateDeployables(match,true);
 const head=reduced.deployableModels.get(2).userData.head,rotation=head.rotation.y,eye=reduced.deployableModels.get(2).userData.eye,intensity=eye.material.emissiveIntensity;
 reduced.updateDeployables({...match,time:2},true);
 assert.equal(head.rotation.y,rotation,'reduced motion freezes the sentry head');
 assert.equal(eye.material.emissiveIntensity,intensity,'reduced motion holds the eye glow');
 reduced.effect({type:'deployable',sentry:2,x:-4,y:0,z:1});
 reduced.effect({type:'deployable-fire',sentry:2,actor:3,target:9});
 reduced.effect({type:'deployable-expire',sentry:2,actor:3});
 assert.ok(!reduced.telegraphPool||reduced.telegraphPool.slots.every(slot=>!slot.active),'no spawn ring under reduced motion');
 assert.ok(reduced.effectPool.slots.every(slot=>!slot.active),'no tracer or smoke under reduced motion');
 view.effectPool.dispose();view.telegraphPool?.dispose();
 reduced.effectPool.dispose();
});

test('lightning thunder forwards the deterministic weather seed',()=>{
 const calls=[];
 const view=viewHarness({camera:new T.PerspectiveCamera(),viewAudio:{thunder:payload=>{calls.push(payload);return true;}},_weatherSeed:99});
 view._spawnMothSprite=()=>null;
 view._onLightningStrike({time:1,distance:.4,intensity:.8,thunderGain:1,pan:-.2},false);
 assert.equal(calls.length,1,'a WebGL strike rings the thunder voice once');
 assert.equal(calls[0].seed,99,'the weather seed rides along for deterministic thunder variants');
 assert.equal(calls[0].distance,.4);
 assert.equal(calls[0].intensity,.8);
 view._lightningScheduleSeed=123;
 view._onLightningStrike({distance:.5,intensity:.5},false);
 assert.equal(calls[1].seed,123,'a live schedule seed wins over the base weather seed');
 const software=viewHarness({camera:new T.PerspectiveCamera(),viewAudio:{thunder:()=>{calls.push({software:true});return true;}}});
 software._onLightningStrike({distance:.4,intensity:.8},true);
 assert.equal(calls.length,2,'the CPU renderer stays silent');
});

test('software sentries carry a flat blob shadow and still build from the snapshot',()=>{
 const view=viewHarness({mapId:'crosswire',renderer:{isSoftware:true}});
 const match={time:1,arena:{id:'crosswire',color:'#55ddcc'},deployables:[{id:4,team:0,x:1,y:0,z:-2,life:5,range:22}],actors:[]};
 view.updateDeployables(match,false);
 const model=view.deployableModels.get(4);
 let blobs=0;model.traverse(node=>{if(node.userData.blobShadow)blobs++;});
 assert.equal(blobs,1,'software sentries get one flat contact shadow');
 assert.ok(model.userData.head.children.length>=3,'the shared turret kit still builds on the CPU renderer');
 view.disposeObject(view.scene);for(const resource of view.sharedResources??[])resource.dispose();
});

test('interior volumes thicken the fog and damp the key lights from stored base values',()=>{
 const scene=new T.Scene();scene.fog=new T.FogExp2('#090f17',.018);
 const hemi=new T.HemisphereLight('#8da5b1','#20364f',1.8),sun=new T.DirectionalLight('#8da5b1',2.4),rim=new T.DirectionalLight('#7fd8ff',.55);
 rim.userData.rimLight=true;scene.add(hemi,sun,rim);
 const camera=new T.PerspectiveCamera();camera.position.set(0,1.5,0);
 const view=Object.assign(Object.create(ArenaView.prototype),{
  scene,camera,renderer:{isSoftware:false},motionQuery:{matches:false},display:{...DEFAULT_DISPLAY},
  _arenaLook:{fogDensity:.018},_arenaLight:{hemi:1.8,sun:2.4},
  interiors:[{kind:'box',x:0,z:0,base:0,height:6,hw:5,hd:5}],
  weatherState:{clock:0,kind:'clear',preset:{density:1,material:{}},wetness:0,phase:'day'},
 });
 assert.equal(view._updateInteriorAmbience(1,true),1,'the camera inside a volume blends fully');
 assert.ok(Math.abs(scene.fog.density-.018*1.55)<1e-9,'interior fog is the weather density times the bounded multiplier');
 assert.ok(Math.abs(hemi.intensity-1.8*(1-.18))<1e-9,'hemisphere damp is bounded and recomputed from base');
 assert.ok(Math.abs(sun.intensity-2.4*(1-.22))<1e-9,'sun damp is bounded and recomputed from base');
 assert.equal(rim.intensity,.55,'the rim light is never damped');
 camera.position.set(50,1.5,0);
 assert.equal(view._updateInteriorAmbience(1,true),0);
 assert.ok(Math.abs(scene.fog.density-.018)<1e-9,'leaving the volume restores the arena density');
 assert.ok(Math.abs(hemi.intensity-1.8)<1e-9&&Math.abs(sun.intensity-2.4)<1e-9,'lights return to the stored base');
 view.weatherState={clock:0,kind:'storm',preset:{density:1.8,material:{dark:.2,wet:.5}},wetness:.5,phase:'day'};
 camera.position.set(0,1.5,0);
 view._updateInteriorAmbience(1,true);
 assert.ok(Math.abs(scene.fog.density-.018*1.8*1.55)<1e-9,'the weather scale survives the interior multiplier');
 const software=Object.assign(Object.create(ArenaView.prototype),{scene,camera,renderer:{isSoftware:true},motionQuery:{matches:false},display:{...DEFAULT_DISPLAY},interiors:view.interiors});
 assert.equal(software._updateInteriorAmbience(1,false),0,'the CPU renderer never touches scene.fog');
 assert.ok(Math.abs(scene.fog.density-.018*1.8*1.55)<1e-9,'the software pass leaves the density alone');
});

test('objective beacons grow with capture progress without breaking the thin always-on cue',()=>{
 const view=viewHarness({worldGroup:new T.Group(),objectiveModels:new Map()});
 const arena={id:'crosswire',color:'#55ddcc'};
 view.updateObjectives({time:1,objectives:{kind:'koth',zones:[{id:'hill',x:0,y:0,z:0,radius:4,owner:0,captureTeam:0,progress:0}]}},arena);
 const hill=view.objectiveModels.get('hill');
 assert.equal(hill.userData.beacon.scale.y,1,'an empty zone keeps the authored beam height');
 assert.equal(hill.userData.beaconMat.emissiveIntensity,.6,'an empty zone keeps the authored beam intensity');
 view.updateObjectives({time:1,objectives:{kind:'koth',zones:[{id:'hill',x:0,y:0,z:0,radius:4,owner:0,captureTeam:0,progress:100}]}},arena);
 assert.ok(hill.userData.beacon.scale.y>1.5,'the beacon grows with captured progress');
 assert.ok(Math.abs(hill.userData.beacon.position.y-1.2*hill.userData.beacon.scale.y)<1e-9,'the beam stays rooted at the zone');
 assert.ok(hill.userData.beaconMat.emissiveIntensity>.6,'the beam brightens with progress');
 assert.equal(hill.userData.beacon.geometry.parameters.height,2.4,'the thin beacon geometry is untouched');
 assert.equal(hill.userData.beaconMat.depthTest,false,'the beacon stays visible through geometry');
 assert.equal(hill.userData.beaconMat.color.getHexString(),hill.userData.baseMat.color.getHexString(),'the beacon colour still matches the zone');
 assert.equal(hill.userData.beacon.renderOrder,100);
 assert.ok(hill.scale.y>=1&&hill.scale.y<=1.1,'the zone group keeps its own bounded pulse');
 view.updateCocsObjectives({time:1,objectives:{kind:'cocs',nodes:[{id:'n1',archetype:'front',x:5,y:0,z:5,r:6,live:true,contested:false,owner:0,progress:[1,0]}]}},arena);
 const node=view.objectiveModels.get('n1');
 assert.ok(node.userData.beacon.scale.y>1.5,'a captured Lattice node also beams its progress');
 assert.equal(node.userData.beacon.geometry.parameters.height,2.4,'the Lattice beam keeps its thin geometry');
 view.disposeObject(view.scene);
});

test('shield hits pulse the shell without touching its colour and low health emits bounded smoke',()=>{
 const view=viewHarness({actorModels:new Map()});
 const model=new T.Group();model.position.set(1,0,2);
 model.userData.shield=new T.Mesh(new T.SphereGeometry(1.15,8,6),new T.MeshBasicMaterial({color:'#70ffe6',transparent:true,opacity:.24,wireframe:true}));
 model.userData.shield.scale.set(.7,1,.7);
 view.actorModels.set(5,model);
 view._matchRef={actors:[{id:5,health:20,maxHealth:100}]};
 assert.equal(view._damageReadability({actor:5,shield:4,shieldBreak:false,amount:10},false),2,'a low-health absorbing hit smokes and sparks');
 const pulse=view._pulseShield(model,true);
 assert.ok(pulse>0&&pulse<=1,'a shield hit leaves a decaying pulse');
 assert.ok(model.userData.shield.scale.x>.7,'the shell pulses outward');
 assert.equal(model.userData.shield.material.color.getHexString(),'70ffe6','the pulse never recolours the shell');
 assert.equal(model.scale.x,1,'the actor transform is untouched');
 assert.equal(view._damageReadability({actor:5,shield:4,shieldBreak:false,amount:10},false),0,'the next hit is throttled');
 assert.ok(view.effectPool.slots.filter(slot=>slot.active&&!slot.line).length<=2,'each damage event emits at most a smoke mote and a spark');
 model.userData.lowHealthSmokeAt=-Infinity;model.userData.lowHealthSparkAt=-Infinity;
 assert.equal(view._damageReadability({actor:5,shield:0,shieldBreak:false,amount:10},false),2,'the throttle window re-opens');
 model.userData.shieldPulseUntil=0;
 view._matchRef.actors[0].health=100;
 assert.equal(view._damageReadability({actor:5,shield:4,shieldBreak:false,amount:10},false),0,'a healthy actor emits no low-health smoke');
 assert.ok(model.userData.shieldPulseUntil>0,'an absorbing shield hit still leaves its pulse');
 assert.equal(view._pulseShield(model,false,performance.now()+1000),0,'the pulse expires');
 assert.equal(model.userData.shield.scale.x,.7,'the shell returns to its authored scale');
 assert.equal(model.userData.shield.material.opacity,.13,'the shell returns to its authored opacity');
 const reduced=viewHarness({actorModels:new Map(),motionQuery:{matches:true}});
 const reducedModel=new T.Group();reducedModel.userData.shield=new T.Mesh(new T.SphereGeometry(1,4,3),new T.MeshBasicMaterial({color:'#70ffe6'}));
 reduced.actorModels.set(5,reducedModel);reduced._matchRef={actors:[{id:5,health:10,maxHealth:100}]};
 assert.equal(reduced._damageReadability({actor:5,shield:4},true),0,'reduced motion suppresses the damage reads');
 assert.equal(reducedModel.userData.shieldPulseUntil,undefined);
 const software=viewHarness({actorModels:new Map(),renderer:{isSoftware:true}});
 software.actorModels.set(5,reducedModel);software._matchRef={actors:[{id:5,health:10,maxHealth:100}]};
 assert.equal(software._damageReadability({actor:5,shield:4},false),0,'the CPU renderer suppresses the damage reads');
 view.effectPool.dispose();
});
