// §4.8 gear: asymmetric but testable. This file is the automated gate for the
// item pool (declared power/cost axes, slot budget parity, in-slot
// non-dominance) and for the envelope caps resolveGear enforces on every
// caller. §10.1 S8 upgrades scope, heavy-barrel and servo and pins their stat
// vectors; the other five items keep their pre-overhaul raw modifiers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GEAR,GEAR_AXES,GEAR_BUDGET,GEAR_CAPS,GEAR_SLOTS,gearBudget,gearById,resolveGear} from './progression.mjs';

const EPS=1e-9;
const AXES=['health','armor','speed','damage','spread'];
const statVector=item=>{
 const modifiers=item?.modifiers||{},read=(axis,fallback)=>Number.isFinite(modifiers[axis])?modifiers[axis]:fallback;
 return {health:read('health',0),armor:read('armor',0),speed:read('speed',1),damage:read('damage',1),spread:read('spread',1)};
};
// Spread is the one axis where lower is better; everything else is higher.
const atLeast=(a,b,axis)=>axis==='spread'?a[axis]<=b[axis]+EPS:a[axis]>=b[axis]-EPS;
const better=(a,b,axis)=>axis==='spread'?a[axis]<b[axis]-EPS:a[axis]>b[axis]+EPS;
const dominates=(a,b)=>AXES.every(axis=>atLeast(a,b,axis))&&AXES.some(axis=>better(a,b,axis));

test('every item declares a power axis, a different cost axis and its slot budget',()=>{
 for(const item of GEAR){
  assert.ok(GEAR_AXES.includes(item.powerAxis),`${item.id} has a power axis`);
  assert.ok(GEAR_AXES.includes(item.costAxis),`${item.id} has a cost axis`);
  assert.notEqual(item.powerAxis,item.costAxis,`${item.id} power and cost axes differ`);
  assert.equal(item.budget,GEAR_BUDGET[item.slot],`${item.id} declares its slot budget`);
 }
});

test('same-slot items share one net budget and none overspends it',()=>{
 assert.deepEqual({...GEAR_BUDGET},{primary:15,armor:25,utility:24});
 for(const slot of GEAR_SLOTS){
  const items=GEAR.filter(item=>item.slot===slot.id),budget=GEAR_BUDGET[slot.id];
  assert.ok(items.length>=2,`${slot.id} keeps competing items`);
  for(const item of items)assert.ok(gearBudget(item).net<=budget+EPS,`${item.id} net ${gearBudget(item).net} exceeds ${budget}`);
  assert.ok(items.some(item=>Math.abs(gearBudget(item).net-budget)<=EPS),`${slot.id} budget is reached`);
 }
});

test('the §10.1 S8 upgrades pay for their power (cost ≥60% of power)',()=>{
 for(const id of ['scope','heavy-barrel','servo']){
  const spend=gearBudget(gearById(id));
  assert.ok(spend.power>0,`${id} spends on its power axis`);
  assert.ok(spend.cost>=.6*spend.power-EPS,`${id} cost ${spend.cost} is under 60% of power ${spend.power}`);
 }
});

test('no item dominates any other on every axis',()=>{
 // §4.8's normative rule is in-slot (same-budget) dominance; checking the whole
 // pool is stricter and catches cross-slot god items too.
 for(const a of GEAR)for(const b of GEAR){
  if(a.id===b.id)continue;
  assert.ok(!dominates(statVector(a),statVector(b)),`${a.id} strictly dominates ${b.id}`);
 }
});

test('the three S8-upgraded stat vectors are pinned',()=>{
 assert.deepEqual(statVector(gearById('scope')),{health:0,armor:0,speed:.9,damage:1.1,spread:.85});
 assert.deepEqual(statVector(gearById('heavy-barrel')),{health:0,armor:0,speed:.97,damage:1.15,spread:1.1});
 assert.deepEqual(statVector(gearById('servo')),{health:0,armor:0,speed:1.1,damage:1,spread:1.07});
 const solo=id=>resolveGear([id]).modifiers;
 for(const id of ['scope','heavy-barrel','servo'])assert.deepEqual(statVector({modifiers:solo(id)}),statVector(gearById(id)),`${id} resolves exactly as declared`);
});

test('the five non-upgraded items keep their pre-overhaul raw modifiers',()=>{
 assert.deepEqual(gearById('light-frame').modifiers,{damage:1.08,spread:.9,armor:-5});
 assert.deepEqual(gearById('plating').modifiers,{armor:25,speed:.98});
 assert.deepEqual(gearById('reactive').modifiers,{armor:15,health:10});
 assert.deepEqual(gearById('stim').modifiers,{health:20,speed:1.04});
 assert.deepEqual(gearById('mag').modifiers,{spread:.92,speed:.99});
});

test('resolveGear enforces the §4.8 envelope caps on every loadout',()=>{
 assert.deepEqual({...GEAR_CAPS},{offense:1.15,mobility:1.1,ehp:15,spread:.85,handling:.9});
 const bySlot=GEAR_SLOTS.map(slot=>GEAR.filter(item=>item.slot===slot.id));
 const loadouts=[[]];
 for(const primary of bySlot[0])for(const armor of bySlot[1])for(const utility of bySlot[2])loadouts.push([primary.id,armor.id,utility.id]);
 loadouts.push(['scope','heavy-barrel'],['scope','mag'],['heavy-barrel','mag'],['servo','stim'],['plating','stim']);
 for(const ids of loadouts){
  const label=ids.join('+')||'empty',modifiers=resolveGear(ids).modifiers;
  assert.ok(modifiers.damage<=GEAR_CAPS.offense+EPS,`${label} damage ${modifiers.damage}`);
  assert.ok(modifiers.speed<=GEAR_CAPS.mobility+EPS,`${label} speed ${modifiers.speed}`);
  assert.ok(modifiers.spread>=GEAR_CAPS.spread-EPS,`${label} spread floor ${modifiers.spread}`);
  assert.ok(modifiers.spread<=1/GEAR_CAPS.handling+EPS,`${label} handling floor ${modifiers.spread}`);
  assert.ok(modifiers.health+modifiers.armor<=GEAR_CAPS.ehp+EPS,`${label} pooled EHP ${modifiers.health+modifiers.armor}`);
  assert.ok(modifiers.health>=0&&modifiers.armor>=0,`${label} pools stay non-negative`);
 }
 assert.equal(resolveGear(['scope','heavy-barrel']).modifiers.damage,GEAR_CAPS.offense,'duplicate primaries cannot pass the offense cap');
 assert.equal(resolveGear(['scope','mag']).modifiers.spread,GEAR_CAPS.spread,'stacked accuracy cannot pass the spread floor');
 assert.equal(resolveGear(['servo','stim']).modifiers.speed,GEAR_CAPS.mobility,'stacked mobility cannot pass the mobility cap');
 const pooled=resolveGear(['plating','stim']).modifiers;
 assert.ok(Math.abs(pooled.health+pooled.armor-GEAR_CAPS.ehp)<EPS,'stacked EHP is trimmed to the pooled cap');
});

test('resolveGear keeps its merge contract, freezes the result and stays deterministic',()=>{
 const list=resolveGear(['scope','plating','stim']),keyed=resolveGear({primary:'scope',armor:'plating',utility:'stim'});
 assert.deepEqual(keyed.modifiers,list.modifiers);
 assert.deepEqual(list.items.map(item=>item.id),['scope','plating','stim']);
 assert.deepEqual(Object.keys(list.modifiers).sort(),['armor','damage','health','speed','spread']);
 assert.deepEqual(resolveGear(['scope','plating','stim']).modifiers,list.modifiers);
 assert.equal(resolveGear(['nope','']).items.length,0);
 assert.ok(Object.isFrozen(list)&&Object.isFrozen(list.items)&&Object.isFrozen(list.modifiers));
 assert.throws(()=>{list.modifiers.damage=9;},TypeError);
});
