// Graphics-fidelity pass: oriented decals, explosion kit, weather streaks and
// splashes, WebGL contact shadows and the shared sampling/cap/tuning helpers.
// Every assertion here is presentation-only; the simulation is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView,bloomTuning,weatherParticleCap,SHADOW_FIT_EXTENT} from './view.mjs';
import {ContactShadowPool,DecalPool,MuzzleLightPool,RipplePool} from './effects-fx.mjs';
import {EffectPool} from './feedback.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';

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
