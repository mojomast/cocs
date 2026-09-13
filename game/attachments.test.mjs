import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WEAPONS} from './data.mjs';
import {ATTACHMENT_SLOTS,ATTACHMENTS,applyAttachmentsToWeapon,attachmentById,attachmentsForWeapon,normalizeAttachments,resolveAttachments,unlockedAttachments} from './attachments.mjs';

const close=(actual,expected,eps=1e-9)=>assert.ok(Math.abs(actual-expected)<eps,`${actual} !== ${expected}`);
const SLOT_IDS=ATTACHMENT_SLOTS.map(slot=>slot.id);

test('definitions use unique ids, valid slots, weapon indices 0..9, positive levels',()=>{
 assert.equal(ATTACHMENT_SLOTS.length,4);
 assert.deepEqual(SLOT_IDS,['optic','barrel','magazine','underbarrel']);
 assert.ok(ATTACHMENTS.length>=12&&ATTACHMENTS.length<=16);
 const ids=new Set();
 for(const item of ATTACHMENTS){
  assert.ok(!ids.has(item.id),`duplicate ${item.id}`);ids.add(item.id);
  assert.ok(/^[a-z]+(-[a-z]+)*$/.test(item.id),item.id);
  assert.ok(SLOT_IDS.includes(item.slot),item.id);
  assert.ok(Number.isInteger(item.level)&&item.level>0&&item.level<=30,item.id);
  assert.ok(Array.isArray(item.weapons),item.id);
  for(const index of item.weapons)assert.ok(Number.isInteger(index)&&index>=0&&index<=9,item.id);
  assert.equal(typeof item.modifiers,'object');
  assert.equal(typeof item.behavior,'object');
  assert.equal(typeof item.visual,'object');
  assert.equal(attachmentById(item.id),item);
 }
 for(const required of ['long-barrel','suppressor','extended-mag','drum-mag','quickdraw-grip','grenade-launcher','scope','holo-sight','burst-module','charge-coil','piercing-rounds','explosive-tips','homing-beacon','chain-capacitor'])assert.ok(ids.has(required),required);
});

test('attachmentsForWeapon respects weapon fit and level gating',()=>{
 const level1=attachmentsForWeapon(0,1).map(item=>item.id);
 assert.ok(level1.includes('extended-mag'));
 assert.ok(!level1.includes('holo-sight'));
 const maxed=attachmentsForWeapon(0,30).map(item=>item.id);
 assert.ok(maxed.includes('long-barrel')&&maxed.includes('grenade-launcher')&&maxed.includes('scope'));
 assert.ok(!maxed.includes('charge-coil'),'charge-coil is not a pulse-rifle attachment');
 const smg=attachmentsForWeapon(9,30).map(item=>item.id);
 assert.ok(smg.includes('grenade-launcher')&&smg.includes('drum-mag'));
 const shotgun=attachmentsForWeapon(3,30).map(item=>item.id);
 assert.ok(!shotgun.includes('drum-mag'),'drum only for automatics');
 assert.ok(!shotgun.includes('scope'),'scope only for ranged weapons');
 const grenade=attachmentsForWeapon(5,30).map(item=>item.id);
 assert.ok(grenade.includes('quickdraw-grip'),'universal attachments fit every weapon');
 assert.ok(!grenade.includes('drum-mag'));
 assert.ok(attachmentsForWeapon(8,13).every(item=>item.id!=='piercing-rounds'));
 assert.ok(attachmentsForWeapon(8,14).some(item=>item.id==='piercing-rounds'));
 assert.ok(unlockedAttachments(1).every(item=>item.level===1));
 assert.equal(unlockedAttachments(30).length,ATTACHMENTS.length);
});

test('resolveAttachments aggregates modifiers, ignores unknown ids and is order-independent',()=>{
 const single=resolveAttachments(['long-barrel']);
 close(single.modifiers.damage,1.06);
 close(single.modifiers.spread,.92);
 close(single.modifiers.range,1.25);
 close(single.modifiers.interval,1);
 assert.equal(single.items.length,1);
 const reversed=resolveAttachments(['scope','drum-mag','long-barrel']);
 const forward=resolveAttachments(['long-barrel','drum-mag','scope']);
 assert.deepEqual(reversed.modifiers,forward.modifiers);
 assert.deepEqual(resolveAttachments({optic:'scope',barrel:'long-barrel'}).modifiers,resolveAttachments(['scope','long-barrel']).modifiers);
 const unknown=resolveAttachments(['not-real','long-barrel']);
 assert.equal(unknown.items.length,1);
 assert.equal(resolveAttachments({optic:'nope'}).items.length,0);
 const additive=resolveAttachments(['drum-mag','burst-module']);
 assert.equal(additive.modifiers.cap,45);
 assert.equal(additive.modifiers.burst,3);
 assert.equal(resolveAttachments(['extended-mag']).modifiers.cap,12);
 assert.ok(additive.modifiers.reload>1);
});

const MOD_RANGE={damage:[.25,3],spread:[.2,2],interval:[.2,2],range:[.4,3],bloomPerShot:[.2,2],bloomMax:[.2,2],recoilKick:[.2,2],reload:[.3,2],cap:[0,200],pellets:[0,20],burst:[0,8]};
test('resolveAttachments clamps modifiers, orders behaviors by slot and merges visuals',()=>{
 const clamped=resolveAttachments(['long-barrel','scope','holo-sight','suppressor']);
 assert.ok(clamped.modifiers.damage>=MOD_RANGE.damage[0]&&clamped.modifiers.damage<=MOD_RANGE.damage[1]);
 const ordered=resolveAttachments(['chain-capacitor','explosive-tips','charge-coil','scope']);
 assert.deepEqual(ordered.behaviors.map(behavior=>behavior.mode),['charge','explosive','chain']);
 assert.deepEqual(ordered.behaviors.map(behavior=>behavior.slot),['barrel','magazine','underbarrel']);
 const visual=resolveAttachments(['scope','long-barrel','extended-mag']).visual;
 assert.equal(visual.optic,'scope');assert.equal(visual.barrel,'long');assert.equal(visual.magazine,'extended');
 assert.equal(resolveAttachments([]).visual.optic,'none');
 assert.equal(resolveAttachments([]).visual.underbarrel,'none');
 const grip=resolveAttachments(['quickdraw-grip']);
 assert.equal(grip.visual.underbarrel,'quickdraw-grip');
 assert.equal(grip.visual.color,'#4a5a62');
 assert.equal(resolveAttachments(['scope','grenade-launcher']).visual.underbarrel,'grenade-launcher');
 assert.equal(resolveAttachments(['burst-module']).visual.underbarrel,'burst-module');
 assert.equal(resolveAttachments(['homing-beacon']).visual.underbarrel,'homing-beacon');
 assert.equal(resolveAttachments(['chain-capacitor']).visual.underbarrel,'chain-capacitor');
});

test('applyAttachmentsToWeapon never mutates input and applies known values',()=>{
 const base=WEAPONS[0],beforeDamage=base.damage,beforeRange=base.range,beforeBase=base.bloom.base,beforeKick=base.recoil.kick;
 const applied=applyAttachmentsToWeapon(base,resolveAttachments(['long-barrel']));
 close(applied.damage,beforeDamage*1.06);
 close(applied.range,beforeRange*1.25);
 close(applied.bloom.base,beforeBase*.92);
 close(applied.bloom.perShot,base.bloom.perShot);
 close(applied.recoil.kick,beforeKick);
 assert.equal(applied.cap,Infinity);
 assert.equal(base.damage,beforeDamage);assert.equal(base.range,beforeRange);
 assert.equal(base.bloom.base,beforeBase);assert.equal(base.recoil.kick,beforeKick);
 assert.notEqual(applied,base);
 const plasma=applyAttachmentsToWeapon(WEAPONS[4],resolveAttachments(['drum-mag']));
 assert.equal(plasma.cap,WEAPONS[4].cap+45);
 close(plasma.reload,WEAPONS[4].reload*1.35);
 const suppressed=applyAttachmentsToWeapon(WEAPONS[0],resolveAttachments(['suppressor']));
 close(suppressed.damage,11*.92);
 assert.ok(suppressed.recoil.kick<base.recoil.kick);
});

test('applyAttachmentsToWeapon materializes behavior fields',()=>{
 const pulse=ids=>applyAttachmentsToWeapon(WEAPONS[0],resolveAttachments(ids));
 const burst=pulse(['burst-module']);
 assert.equal(burst.autoBurst,true);close(burst.burstDelay,.16);assert.equal(burst.burst,3);
 const charge=pulse(['charge-coil']);
 close(charge.chargeTime,.5);close(charge.chargeDamage,2.2);
 const pierce=pulse(['piercing-rounds']);
 assert.equal(pierce.pierce,2);
 const explosive=pulse(['grenade-launcher']);
 close(explosive.explosiveRadius,3.2);close(explosive.explosiveDamage,.5);
 const homing=pulse(['homing-beacon']);
 close(homing.homing,.6);close(homing.homingTurnRate,3);
 const chain=pulse(['chain-capacitor']);
 assert.equal(chain.chain,2);assert.equal(chain.chainRange,6);
 const plain=pulse([]);
 assert.equal(plain.autoBurst,false);assert.equal(plain.pierce,0);assert.equal(plain.chain,0);
 assert.equal(plain.chargeDamage,1);
});

test('normalizeAttachments drops invalid slots and locked items',()=>{
 assert.deepEqual(normalizeAttachments({optic:'scope',barrel:'long-barrel',magazine:'drum-mag',underbarrel:'quickdraw-grip',garbage:'x'},4),{barrel:'long-barrel',underbarrel:'quickdraw-grip'});
 assert.deepEqual(normalizeAttachments({optic:'not-real'},30),{});
 assert.deepEqual(normalizeAttachments({optic:'long-barrel'},30),{});
 assert.deepEqual(normalizeAttachments(null,30),{});
 assert.deepEqual(normalizeAttachments({magazine:'drum-mag'},11),{});
 assert.deepEqual(normalizeAttachments({magazine:'drum-mag'},12),{magazine:'drum-mag'});
 const value={optic:'scope'},normalized=normalizeAttachments(value,30);
 assert.notEqual(normalized,value);
 normalized.optic='mutated';
 assert.equal(value.optic,'scope');
});
