import test from 'node:test';
import assert from 'node:assert/strict';
import {
 WEAPON_FINISHES,
 CROSSHAIR_STYLES,
 FINISH_IDS,
 CROSSHAIR_IDS,
 finishById,
 crosshairById,
 unlockedFinishes,
 unlockedCrosshairs,
 resolveFinish,
 finishRgb,
 applyFinishToColor,
} from './cosmetics.mjs';

const HEX_RE=/^#[0-9a-f]{6}$/i;
const SHAPES=new Set(['cross','dot','ring','chevron','split']);

test('finishes: six entries with unique ids and matching id list',()=>{
 assert.equal(WEAPON_FINISHES.length,6);
 assert.equal(new Set(FINISH_IDS).size,FINISH_IDS.length);
 assert.deepEqual(FINISH_IDS,WEAPON_FINISHES.map(item=>item.id));
 assert.deepEqual(FINISH_IDS,['finish-ion','finish-ember','finish-void','finish-toxic','finish-solar','finish-crimson']);
});

test('crosshairs: five entries with unique ids and matching id list',()=>{
 assert.equal(CROSSHAIR_STYLES.length,5);
 assert.equal(new Set(CROSSHAIR_IDS).size,CROSSHAIR_IDS.length);
 assert.deepEqual(CROSSHAIR_IDS,['cross','dot','ring','chevron','split']);
});

test('finishes: color strings are valid #rrggbb and rgb channels are 0..1',()=>{
 for(const item of WEAPON_FINISHES){
  const {primary,secondary,accent,emissive,rgb}=item.colors;
  for(const hex of [primary,secondary,accent,emissive])assert.match(hex,HEX_RE,`${item.id} ${hex}`);
  assert.equal(rgb.length,3);
  for(const channel of rgb){
   assert.equal(typeof channel,'number');
   assert.ok(channel>=0&&channel<=1,`${item.id} channel ${channel}`);
  }
  assert.deepEqual(rgb.slice(),[
   parseInt(primary.slice(1,3),16)/255,
   parseInt(primary.slice(3,5),16)/255,
   parseInt(primary.slice(5,7),16)/255,
  ]);
 }
});

test('finishes: levels stay within 1..25',()=>{
 for(const item of WEAPON_FINISHES)assert.ok(Number.isInteger(item.level)&&item.level>=1&&item.level<=25,item.id);
});

test('crosshairs: shapes are valid and gaps/thickness/dot are finite numbers',()=>{
 for(const item of CROSSHAIR_STYLES){
  assert.ok(SHAPES.has(item.shape),`${item.id} shape ${item.shape}`);
  for(const key of ['gap','thickness','dot'])assert.ok(Number.isFinite(item[key]),`${item.id} ${key}`);
 }
});

test('finishById returns item or null',()=>{
 assert.equal(finishById('finish-ion')?.id,'finish-ion');
 assert.equal(finishById('nope'),null);
});

test('crosshairById returns item or null',()=>{
 assert.equal(crosshairById('chevron')?.shape,'chevron');
 assert.equal(crosshairById('nope'),null);
});

test('unlockedFinishes gates by level',()=>{
 assert.equal(unlockedFinishes(0).length,0);
 assert.equal(unlockedFinishes(1).length,0);
 assert.deepEqual(unlockedFinishes(4).map(item=>item.id),['finish-ion']);
 assert.deepEqual(unlockedFinishes(10).map(item=>item.id),['finish-ion','finish-ember','finish-toxic']);
 assert.equal(unlockedFinishes(25).length,WEAPON_FINISHES.length);
 assert.deepEqual(unlockedFinishes('bad').map(item=>item.id),[]);
});

test('unlockedCrosshairs gates by level',()=>{
 assert.deepEqual(unlockedCrosshairs(1).map(item=>item.id),['cross','dot','ring']);
 assert.deepEqual(unlockedCrosshairs(8).map(item=>item.id),['cross','dot','ring','chevron']);
 assert.deepEqual(unlockedCrosshairs(16).map(item=>item.id),['cross','dot','ring','chevron','split']);
 assert.equal(unlockedCrosshairs(0).length,3);
});

test('resolveFinish returns colors or fallback',()=>{
 const colors=resolveFinish('finish-void','#000000');
 assert.equal(colors.primary,'#8b5cf6');
 const fallback={primary:'#123456'};
 assert.equal(resolveFinish('unknown',fallback),fallback);
});

test('resolveFinish resolves finish ids and preserves the fallback for null or unknown',()=>{
 const ion=resolveFinish('finish-ion');
 assert.ok(ion,'a known finish id resolves to its palette');
 assert.equal(ion.primary,'#22d3ee');
 const fallback={primary:'#123456'};
 assert.equal(resolveFinish(null,fallback),fallback);
 assert.equal(resolveFinish(undefined,fallback),fallback);
});

test('finishRgb returns channels or null for unknown',()=>{
 const rgb=finishRgb('finish-crimson');
 assert.ok(Array.isArray(rgb)&&rgb.length===3);
 assert.equal(finishRgb('unknown'),null);
 assert.equal(finishRgb(undefined),null);
});

test('applyFinishToColor is deterministic and returns valid hex',()=>{
 const first=applyFinishToColor('finish-ion','#ffffff');
 const second=applyFinishToColor('finish-ion','#ffffff');
 assert.equal(first,second);
 assert.match(first,HEX_RE);
 assert.match(applyFinishToColor('finish-ember','#000000'),HEX_RE);
});

test('applyFinishToColor returns base unchanged for unknown finish or invalid base',()=>{
 assert.equal(applyFinishToColor('unknown','#abcdef'),'#abcdef');
 assert.equal(applyFinishToColor('finish-ion','not-a-color'),'not-a-color');
 assert.equal(applyFinishToColor('finish-ion',undefined),undefined);
});
