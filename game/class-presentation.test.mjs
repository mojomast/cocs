// Phase 4.3 — wing silhouettes and movement/spec telegraphs.
//
// Part A pins the additive wing presentation layer: every operator still builds
// with the pinned rig contract, wing geometry/materials come from the shared
// ModelAssets cache (a rebuild never grows `assets.resources`), the silhouette
// language is keyed to the wing (not the operator), small greebles never cast
// shadows, and team colouring is untouched.
//
// Part B pins the new telegraph cues: each branch emits under normal motion and
// collapses to a static cue (or nothing) under reduced motion — never a flung
// particle or an expanding ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView,robotModel} from './view.mjs';
import {ModelAssets} from './effects-fx.mjs';
import {CHARACTERS} from './data.mjs';
import {OPERATOR_KITS,WINGS} from './kits.mjs';
import {applyActorTeam,teamPresentation} from './team-presentation.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';

const WING_OF=Object.fromEntries(OPERATOR_KITS.map(kit=>[kit.id,kit.wing]));
const WING_COLOR=Object.fromEntries(WINGS.map(wing=>[wing.id,wing.color]));
const WING_PIECES={
 striker:['wing-fin-L','wing-fin-R','wing-fin-spar-L','wing-fin-spar-R','wing-collar'],
 vanguard:['wing-pauldron-L','wing-pauldron-R','wing-pauldron-rim-L','wing-pauldron-rim-R','wing-chest-plate','wing-collar'],
 tactician:['wing-sensor-mast','wing-sensor-bulb','wing-sensor-dish','wing-toolkit','wing-tool-module','wing-tool-pouch'],
};
const JOINT_KEYS=['root','hips','torso','chest','head','armUpperL','armUpperR','forearmL','forearmR','legUpperL','legUpperR','legLowerL','legLowerR','footL','footR'];
const TELEGRAPH_CASES=[
 {type:'windup-start',duration:.3},
 {type:'windup-interrupt',reason:'hit',phase:'windup'},
 {type:'charge-start',duration:.55},
 {type:'move-start',reason:'dash'},
 {type:'move-start',reason:'hover'},
 {type:'move-start',reason:'double-jump'},
 {type:'landing-recovery',duration:.15},
 {type:'fuel-empty'},
 {type:'slam-launch'},
 {type:'slam-impact',radius:4,knockback:9},
 {type:'grapple-hook',pos:{x:3,y:1,z:-2}},
 {type:'grapple-release',reason:'arrive'},
 {type:'rope-place',pos:{x:1,y:0,z:4},life:20},
 {type:'rope-expire',pos:{x:1,y:0,z:4}},
 {type:'threat-ping',source:2,duration:.75},
];

function buildRoster(assets){return new Map(CHARACTERS.map(c=>[c.id,robotModel(c.id,assets)]));}
function wingPiecesOf(model){const out=[];model.traverse(node=>{if(String(node.name).startsWith('wing-'))out.push(node);});return out;}
function disposeAll(models){for(const model of models)ArenaView.prototype.disposeObject.call({},model);}
// A minimal presentation-only view: actor models, a scene and a motion
// preference are all `effect()` and `telegraphEffect()` read.
function fxView(reduced=false){
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),actorModels:new Map(),motionQuery:{matches:reduced},display:{...DEFAULT_DISPLAY}});
 const assets=new ModelAssets();
 const actor=robotModel('claude',assets);actor.position.set(0,0,0);view.actorModels.set(1,actor);
 const enemy=robotModel('mistral',assets);enemy.position.set(5,0,2);view.actorModels.set(2,enemy);
 return {
  view,assets,
  dispose(){view.effectPool?.dispose();view.telegraphPool?.dispose();assets.dispose();},
 };
}
function activeSlots(view){
 return {fx:view.effectPool?.slots.filter(slot=>slot.active)??[],tel:view.telegraphPool?.slots.filter(slot=>slot.active)??[]};
}

test('every operator builds with its wing layer and keeps the pinned rig contract',()=>{
 const assets=new ModelAssets(),roster=buildRoster(assets);
 for(const [id,model] of roster){
  const data=model.userData,wing=WING_OF[id];
  assert.equal(data.wing,wing,`${id} exposes its wing`);
  assert.equal(data.wingColor,WING_COLOR[wing],`${id} exposes the wing palette colour`);
  for(const key of JOINT_KEYS)assert.ok(data.joints[key],`${id} keeps the ${key} joint`);
  assert.ok(Math.abs(data.joints.hips.position.y-.7835)<1e-9,`${id} hips bind`);
  assert.equal(data.joints.chest.position.x,0,`${id} chest was never reparented`);
  assert.deepEqual(data.gunAnchor.position.toArray().map(value=>+value.toFixed(6)),[.04,.06,-.08],`${id} carry mount`);
  assert.equal(data.shoulderPads.length,2,`${id} keeps exactly two shoulder pads`);
  assert.ok(data.backpack.children.length>=4,`${id} backpack greebles intact`);
  assert.equal(data.head.getObjectByName('visor-brow'),data.visor.brow);
  assert.equal(data.head.getObjectByName('visor-nub'),data.visor.nub);
  assert.equal(wingPiecesOf(model).length,WING_PIECES[wing].length,`${id} carries the ${wing} silhouette`);
 }
 const before=assets.resources.size,second=buildRoster(assets);
 assert.equal(assets.resources.size,before,'rebuilding the roster reuses the cached wing resources');
 for(const [id,model] of second)assert.equal(wingPiecesOf(model).length,WING_PIECES[WING_OF[id]].length,`${id} rebuilds the wing layer`);
 disposeAll([...roster.values(),...second.values()]);
 assets.dispose();
});

test('the silhouette language is keyed to the wing, not the operator',()=>{
 const assets=new ModelAssets(),roster=buildRoster(assets);
 for(const [id,model] of roster){
  const wing=WING_OF[id],names=wingPiecesOf(model).map(node=>node.name).sort();
  assert.deepEqual(names,[...WING_PIECES[wing]].sort(),`${id} carries the ${wing} piece set`);
  const accent=new T.Color(WING_COLOR[wing]).getHexString(),lit=wingPiecesOf(model).filter(node=>node.material?.color?.getHexString?.()===accent);
  assert.ok(lit.length>=1,`${id} shows the ${wing} accent colour`);
 }
 assert.notDeepEqual(WING_PIECES.striker,WING_PIECES.vanguard);
 assert.notDeepEqual(WING_PIECES.vanguard,WING_PIECES.tactician);
 assert.notDeepEqual(WING_PIECES.striker,WING_PIECES.tactician);
 disposeAll(roster.values());
 assets.dispose();
});

test('small wing greebles are tagged lodDetail, never cast shadows, and a shape piece reads at range',()=>{
 const assets=new ModelAssets();
 for(const id of ['mistral','claude','chatgpt']){
  const model=robotModel(id,assets),pieces=wingPiecesOf(model),tagged=pieces.filter(node=>node.userData?.lodDetail===true);
  assert.ok(tagged.length>=1,`${id} tags its small wing pieces`);
  assert.ok(pieces.some(node=>node.userData?.lodDetail!==true),`${id} keeps a shape piece in the default LOD`);
  model.traverse(node=>{if(node.isMesh&&node.userData?.lodDetail===true)assert.equal(node.castShadow,false,`${id} ${node.name} must not cast`);});
  ArenaView.prototype.disposeObject.call({},model);
 }
 assets.dispose();
});

test('wing accents survive team styling and the team contract is unchanged',()=>{
 for(const c of CHARACTERS){
  const model=robotModel(c.id),data=model.userData,wing=WING_OF[c.id],accent=new T.Color(WING_COLOR[wing]).getHexString();
  const shield=data.shield.material.color.clone(),head=data.head.children.map(node=>node.geometry?.type),pieces=wingPiecesOf(model);
  const wingColors=pieces.map(piece=>piece.material.color.getHexString());
  assert.ok(wingColors.includes(accent),`${c.id} shows the wing accent colour`);
  for(const team of [0,1,'blue',undefined]){
   applyActorTeam(model,team);
   const p=teamPresentation(team);
   assert.equal(data.armor.color.getHexString(),new T.Color(p?.color??c.accent).getHexString(),`${c.id} armor identity`);
   assert.equal(data.color,c.color,`${c.id} hull colour`);
   assert.ok(data.shield.material.color.equals(shield),`${c.id} shield status colour`);
   assert.deepEqual(data.head.children.map(node=>node.geometry?.type),head,`${c.id} head anatomy`);
   assert.equal(data.wing,wing,`${c.id} wing survives team styling`);
   assert.deepEqual(pieces.map(piece=>piece.material.color.getHexString()),wingColors,`${c.id} wing accents are not team-coloured`);
  }
  ArenaView.prototype.disposeObject.call({},model);
 }
});

test('wind-up and charge telegraphs scale with the wind-up duration',()=>{
 for(const [type,short,long] of [['windup-start',.15,.55],['charge-start',.3,.9]]){
  const radii=[];
  for(const duration of [short,long]){
   const fixture=fxView(false);
   fixture.view.effect({type,actor:1,duration});
   const slot=fixture.view.telegraphPool.slots.find(entry=>entry.active);
   assert.ok(slot,`${type} emits a ring`);
   const tail=type==='charge-start'?.35:.2;
   assert.ok(Math.abs(slot.total-(duration+tail))<1e-9,`${type} cue lasts the wind-up plus a beat`);
   radii.push(slot.mesh.scale.x);
   fixture.dispose();
  }
  assert.ok(radii[1]>radii[0],`${type} ring grows with the charge`);
 }
});

test('every telegraph branch emits normally and collapses to a static cue under reduced motion',()=>{
 for(const e of TELEGRAPH_CASES){
  const label=`${e.type}${e.reason?`/${e.reason}`:''}`,normal=fxView(false),reduced=fxView(true);
  normal.view.effect({...e,actor:1});
  reduced.view.effect({...e,actor:1});
  const n=activeSlots(normal.view),r=activeSlots(reduced.view);
  assert.ok(n.fx.length+n.tel.length>0,`${label} emits a cue`);
  assert.ok(r.fx.length+r.tel.length<=n.fx.length+n.tel.length,`${label} reduced cue never grows past normal`);
  for(const slot of r.fx)assert.ok(!slot.velocity,`${label} reduced motion drops flung particles`);
  for(const slot of r.tel)assert.equal(slot.grow,0,`${label} reduced ring never expands`);
  normal.dispose();reduced.dispose();
 }
});

test('unknown event types stay untouched and the threat ping is a directional arc',()=>{
 const fixture=fxView(false),{view}=fixture;
 view.effect({type:'not-a-telegraph',actor:1});
 assert.equal(activeSlots(view).fx.length+activeSlots(view).tel.length,0,'unknown events emit nothing');
 const target=view.actorModels.get(1),enemy=view.actorModels.get(2);
 view.effect({type:'threat-ping',actor:1,source:2,duration:.75});
 const arc=view.telegraphPool.slots.find(slot=>slot.active&&slot.mesh.geometry===view.telegraphPool.arcGeo);
 assert.ok(arc,'the ping draws an arc');
 const dx=enemy.position.x-target.position.x,dz=enemy.position.z-target.position.z;
 assert.ok(Math.abs(arc.holder.rotation.y-Math.atan2(-dx,-dz))<1e-12,'the arc aims at the threat');
 assert.equal(view.telegraphPool.slots.filter(slot=>slot.active&&slot.mesh.geometry===view.telegraphPool.ringGeo).length,1,'a pulse ring runs outside the arc');
 fixture.dispose();
});

test('rope markers hold the anchor life and hook anchors are consumed on release',()=>{
 const fixture=fxView(false),{view}=fixture;
 view.effect({type:'rope-place',actor:1,pos:{x:2,y:0,z:-3},life:20});
 assert.ok(view.telegraphPool.slots.some(slot=>slot.active&&slot.total>10),'the anchor marker is long-lived');
 view.effect({type:'grapple-hook',actor:1,pos:{x:3,y:1,z:-2}});
 assert.deepEqual(view.actorModels.get(1).userData.grappleAnchor,{x:3,y:1,z:-2},'the hook records its anchor');
 view.effect({type:'grapple-release',actor:1,reason:'arrive'});
 assert.equal(view.actorModels.get(1).userData.grappleAnchor,undefined,'the hook anchor is consumed');
 fixture.dispose();
});
