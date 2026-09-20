// Weapon/impact presentation wave: sustained-fire barrel heat, muzzle smoke,
// surface-aware impacts, decal hold-then-fade, combat particle scaling and the
// guarded casing audio hook. Presentation-only; the simulation is never read.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView,weaponModel,impactSurfaceStyle,muzzleSmokePeriod} from './view.mjs';
import {DecalPool} from './effects-fx.mjs';
import {EffectPool} from './feedback.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';
import {qualitySettings} from './post.mjs';

const viewHarness=(overrides={})=>Object.assign(Object.create(ArenaView.prototype),{
 renderer:{isSoftware:false},
 camera:new T.PerspectiveCamera(),
 scene:new T.Scene(),
 actorModels:new Map(),
 playerId:7,
 display:{...DEFAULT_DISPLAY},
 motionQuery:{matches:false},
 qualitySettings:qualitySettings('high'),
 _effectsScale:1,
 ...overrides,
});

test('sustained fire heats one barrel sleeve that decays, rests and stays bounded',()=>{
 const model=weaponModel(0),glow=model.userData.heatGlow;
 let sleeves=0;model.traverse(node=>{if(node.name==='heat-glow')sleeves++;});
 assert.equal(sleeves,1,'exactly one heat sleeve per assembled weapon');
 assert.equal(glow.visible,false,'the sleeve rests hidden');
 assert.equal(model.userData.heatShots,0);
 const view=viewHarness({firstPerson:model});
 assert.equal(view._heatShot({type:'shot',actor:7,weapon:0},null),.17,'heat rises with the local shot');
 for(let i=0;i<20;i++)view._heatShot({type:'shot',actor:7,weapon:0},null);
 assert.equal(model.userData.heat,1,'heat saturates at one');
 assert.equal(model.userData.heatShots,21,'the counter is per weapon');
 const hot=view._updateWeaponHeat(model,false,1/60);
 assert.ok(hot>.9&&hot<=1,'the first frame carries near-full heat');
 assert.equal(glow.visible,true,'the sleeve shows while hot');
 assert.ok(glow.material.opacity>0&&glow.material.opacity<=.85,'glow opacity stays bounded');
 for(let i=0;i<300;i++)view._updateWeaponHeat(model,false,1/60);
 assert.ok(model.userData.heat<.01,'heat decays exponentially');
 assert.equal(glow.visible,false,'the sleeve hides when cold');
 assert.equal(glow.material.opacity,0);
 view._heatShot({type:'shot',actor:7,weapon:0},null);
 view._updateWeaponHeat(model,true,1/60);
 assert.equal(glow.visible,false,'reduced motion rests the sleeve');
 view.qualitySettings={tier:0,particles:.4};
 view._heatShot({type:'shot',actor:7,weapon:0},null);
 view._updateWeaponHeat(model,false,1/60);
 assert.equal(glow.visible,false,'the low tier drops the sleeve');
 // Remote fire heats the actor weapon's own counter, never the local viewmodel.
 const remote=weaponModel(1),remoteModel={userData:{weapon:remote}};
 view.actorModels.set(8,remoteModel);
 view._heatShot({type:'shot',actor:8,weapon:1},remoteModel);
 assert.equal(remote.userData.heatShots,1,'actor weapons keep their own counter');
 assert.equal(model.userData.heatShots,23,'local heat is untouched by remote fire');
 view.disposeObject(model);view.disposeObject(remote);
});

test('muzzle smoke emits every Nth local shot, scales with the tier and skips reduced motion',()=>{
 const high=muzzleSmokePeriod(1,1),medium=muzzleSmokePeriod(.7,1),low=muzzleSmokePeriod(.4,1);
 assert.ok(high<medium&&medium<low,'denser tiers smoke sooner');
 assert.equal(muzzleSmokePeriod(1,1,true),0,'reduced motion disables smoke');
 assert.equal(muzzleSmokePeriod(0,0),0,'the lowest budget disables smoke');
 const view=viewHarness({characterGroundAt:()=>0,firstPerson:weaponModel(0)});
 const added=[];view.effectPool={add:entry=>{added.push(entry);return entry;}};
 const smoke=()=>added.filter(entry=>entry.color==='#4a4d52').length;
 for(let i=0;i<7;i++)view._muzzleSmoke({x:1,y:2,z:-1},i);
 assert.equal(smoke(),Math.floor(7/high),'one mote every Nth call');
 assert.deepEqual(added[0].pos.toArray(),[1,2,-1],'the mote starts at the muzzle');
 assert.ok(added.every(mote=>mote.fade==='smooth'&&mote.velocity.y>0&&mote.gravity<0&&mote.life>.5&&mote.startOpacity<=.3),'reuses the slow grey smoke recipe');
 // The event path only smokes local `shot` events.
 view._muzzleSmokeCount=0;
 const before=smoke();
 const shot=(actor,id,type='shot')=>view.effect({type,actor,id,weapon:0,time:id,from:{x:0,y:1,z:0},to:{x:0,y:1,z:-8},muzzleFrom:{x:0,y:1,z:-1}});
 for(let i=0;i<6;i++)shot(7,100+i);
 assert.equal(smoke()-before,Math.floor(6/high),'local shots feed the counter');
 const remote=smoke();
 for(let i=0;i<6;i++)shot(8,200+i);
 assert.equal(smoke(),remote,'remote fire never smokes the local muzzle');
 shot(7,300,'launch');
 assert.equal(smoke(),remote,'launch events do not smoke');
 view.motionQuery={matches:true};
 const reduced=smoke();
 for(let i=0;i<6;i++)view._muzzleSmoke({x:0,y:0,z:0},i);
 assert.equal(smoke(),reduced,'reduced motion never emits');
 // Pooled smoke stays inside the fixed effect budget.
 const pooled=viewHarness();
 pooled.effectPool=new EffectPool(pooled.scene,8);
 for(let i=0;i<60;i++)pooled._muzzleSmoke({x:0,y:1,z:0},i);
 assert.ok(pooled.effectPool.slots.length<=8,'the fixed pool budget holds');
 pooled.effectPool.dispose();
 view.effectPool=null;
});

test('world impacts pick dust on terrain floors, sparks on walls and tinted decals',()=>{
 const floor=impactSurfaceStyle({x:0,y:-1,z:0},{ground:0,y:0});
 const elevated=impactSurfaceStyle({x:0,y:-1,z:0},{ground:4,y:0});
 const wall=impactSurfaceStyle({x:1,y:0,z:0});
 assert.equal(floor.floor,true);assert.equal(floor.terrain,true);assert.equal(floor.wall,false);
 assert.equal(elevated.floor,true);assert.equal(elevated.terrain,false,'an elevated floor is not terrain');
 assert.equal(wall.wall,true);assert.equal(wall.floor,false);
 assert.notEqual(floor.dust,wall.dust);
 assert.notEqual(floor.decal,wall.decal);
 const view=viewHarness({characterGroundAt:()=>0});
 view.effectPool=new EffectPool(view.scene,96);
 view.impact(0,{x:2,y:0,z:1},'#88ffcc',false,null,{x:2,y:3,z:1});
 const floorMark=view.decalPool.slots.filter(slot=>slot.active).at(-1);
 assert.equal(floorMark.obj.material.color.getHexString(),'241d14','terrain floor decals carry the dirt tint');
 assert.ok(view.effectPool.slots.some(slot=>slot.active&&slot.obj.material.color.getHexString()==='8a7f6b'),'terrain floors emit dust motes');
 view.effectPool.clear();
 view.impact(0,{x:2,y:2,z:1},'#88ffcc',false,null,{x:2,y:2,z:9});
 const wallMark=view.decalPool.slots.filter(slot=>slot.active).at(-1);
 assert.equal(wallMark.obj.material.color.getHexString(),'14161c','wall decals carry the cool soot tint');
 assert.ok(view.effectPool.slots.some(slot=>slot.active&&slot.obj.material.color.getHexString()==='ffcf9a'),'walls throw metal sparks');
 assert.ok(!view.effectPool.slots.some(slot=>slot.active&&slot.obj.material.color.getHexString()==='8a7f6b'),'walls emit no floor dust');
 // Actor hits keep the legacy gore path: default soot, no surface accents.
 view.effectPool.clear();
 view.impact(1,{x:2,y:1,z:1},'#ffffff',false,true,{x:2,y:1,z:9});
 const hitMark=view.decalPool.slots.filter(slot=>slot.active).at(-1);
 assert.equal(hitMark.obj.material.color.getHexString(),'171310','actor hits keep the legacy decal colour');
 const hitColors=view.effectPool.slots.filter(slot=>slot.active).map(slot=>slot.obj.material.color.getHexString());
 assert.ok(!hitColors.includes('8a7f6b')&&!hitColors.includes('ffcf9a'),'actor hits spawn no surface accents');
 view.effectPool.dispose();view.decalPool.dispose();
});

test('combat particle scaling keeps the high-tier baseline and thins lower tiers',()=>{
 const view=viewHarness({characterGroundAt:()=>0});
 const added=[];view.effectPool={add:entry=>{added.push(entry);return entry;}};
 const chips=()=>added.filter(entry=>entry.color==='#6b7681').length;
 view._applyEffectsQuality();
 assert.equal(view._particleScale(),1,'high tier + auto slider is the baseline');
 assert.equal(view._impactSparkCount(4),4);
 assert.equal(view._impactSparkCount(5),5);
 view.impact(3,{x:0,y:0,z:0},'#ffffff',false,null,{x:0,y:0,z:5});
 assert.equal(chips(),4,'high-tier rail chips are byte-identical');
 added.length=0;
 view.display={...DEFAULT_DISPLAY,effectsQuality:'medium'};view._applyEffectsQuality();
 assert.ok(Math.abs(view._particleScale()-.7)<1e-9,'the effects slider folds into the tier budget');
 view.impact(3,{x:0,y:0,z:0},'#ffffff',false,null,{x:0,y:0,z:5});
 assert.equal(chips(),3,'medium tier thins the chip loop');
 added.length=0;
 view.display={...DEFAULT_DISPLAY,effectsQuality:'low'};view._applyEffectsQuality();
 assert.ok(Math.abs(view._particleScale()-.4)<1e-9);
 view.impact(3,{x:0,y:0,z:0},'#ffffff',false,null,{x:0,y:0,z:5});
 assert.equal(chips(),2,'low tier thins further');
 added.length=0;
 view.display={...DEFAULT_DISPLAY};view._applyEffectsQuality();
 view.impact(6,{x:0,y:0,z:0},'#ffffff',false,null,{x:0,y:0,z:5});
 assert.equal(added.filter(entry=>entry.wireframe===true).length,5,'high-tier chain shatter is unchanged');
 // Partially constructed views fall back to the live tier and slider directly.
 view.qualitySettings={tier:1,particles:.7};view._combatParticleScale=undefined;view._effectsScale=1;
 assert.ok(Math.abs(view._particleScale()-.7)<1e-9,'the fallback tracks the tier');
 view.effectPool=null;
});

test('decals hold full opacity for the first 60% of life then fade through the tail',()=>{
 const scene=new T.Scene(),pool=new DecalPool(scene,4);
 assert.equal(pool.limit,4);
 assert.equal(pool.spawn({x:0,y:0,z:0},{seed:1,life:10}),true);
 const slot=pool.slots[0];
 assert.equal(slot.total,10,'the stored lifetime is unchanged');
 pool.update(3);
 assert.ok(Math.abs(slot.obj.material.opacity-.58)<1e-9,'full opacity through the hold');
 pool.update(3);
 assert.ok(Math.abs(slot.obj.material.opacity-.58)<1e-9,'the hold reaches 60% of life');
 pool.update(2);
 const mid=slot.obj.material.opacity;
 assert.ok(mid>0&&mid<.58,'the tail fades');
 pool.update(2);
 assert.equal(slot.active,false,'the decal expires at its full lifetime');
 assert.equal(slot.obj.visible,false);
 pool.spawn({x:0,y:0,z:0},{seed:2,life:4,reduced:true});
 const dim=pool.slots.find(entry=>entry.active);
 pool.update(1);
 assert.ok(Math.abs(dim.obj.material.opacity-.46)<1e-9,'reduced motion holds the dimmer stamp');
 pool.dispose();
});

test('casing ejection calls the optional audio hook and tolerates a missing one',()=>{
 const view=viewHarness({hands:new T.Group()});
 view.scene.add(view.hands);view.hands.visible=true;
 view.firstPerson=view._acquireWeapon(0,null,null);
 view.hands.add(view.firstPerson);
 const calls=[];
 view.audio={shellCasing(...args){calls.push(args);return args;}};
 const slot=view._ejectShell({type:'shot',actor:7,weapon:0,id:9,surface:'metal'});
 assert.ok(slot?.active===true,'the casing still spawns');
 assert.equal(calls.length,1,'one call per ejected casing');
 const [pan,seed,surface]=calls[0];
 assert.ok(Number.isFinite(pan)&&pan>=-1&&pan<=1,'pan is bounded');
 assert.equal(seed,((9*31)+(0+1)*131)>>>0,'the deterministic casing seed is forwarded');
 assert.equal(surface,'metal');
 assert.ok(view._ejectShell({type:'shot',actor:7,weapon:0,id:10,material:'wood'})?.active===true);
 assert.equal(calls[1][2],'wood','material is the surface fallback');
 view.audio={};
 assert.ok(view._ejectShell({type:'shot',actor:7,weapon:0,id:11})?.active===true,'a hook-less audio object is safe');
 view.audio=null;view.viewAudio=null;
 assert.ok(view._ejectShell({type:'shot',actor:7,weapon:0,id:12})?.active===true,'no audio object is safe');
 view.shellPool.dispose();view.shellPool=null;
 view.disposeObject(view.firstPerson);
});
