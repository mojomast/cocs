import test from 'node:test';
import assert from 'node:assert/strict';
import {quantizeNumbers,quantizeClone,wireBytes,quantizeSaving} from './quantize.mjs';

test('quantizeNumbers rounds finite numbers at the requested precision',()=>{
 const value={a:1.23456,b:1.23456,c:[1.9999,{d:0.0004}],e:'∞',f:Infinity,g:null,h:true};
 quantizeNumbers(value,3);
 assert.equal(value.a,1.235);
 assert.equal(value.b,1.235);
 assert.equal(value.c[0],2);
 assert.equal(value.c[1].d,0);
 assert.equal(value.e,'∞');
 assert.equal(value.f,Infinity);
 assert.equal(value.g,null);
 assert.equal(value.h,true);
});

test('quantizeNumbers supports a custom precision and preserves object identity',()=>{
 const value={x:1.23456,nested:{y:-9.87654}};
 const same=quantizeNumbers(value,2);
 assert.equal(same,value);
 assert.equal(value.x,1.23);
 assert.equal(value.nested.y,-9.88);
});

test('quantized snapshots serialize smaller than raw physics floats',()=>{
 const raw={actors:[{x:1.23456789,y:2.3456789,z:3.456789,vx:.987654321,yaw:Math.PI/7}],time:12.3456789};
 const quantized=quantizeNumbers(structuredClone(raw));
 assert.ok(JSON.stringify(quantized).length<JSON.stringify(raw).length);
});

test('quantizeClone leaves the source untouched and wireBytes measures the wire form', () => {
 const raw = {x: 1.23456, nested: {y: 9.87654}};
 const copy = quantizeClone(raw, 3);
 assert.equal(copy.x, 1.235);
 assert.equal(copy.nested.y, 9.877);
 assert.equal(raw.x, 1.23456, 'the source is not mutated');
 assert.notEqual(copy.nested, raw.nested, 'nested objects are cloned');
 assert.ok(wireBytes(raw) > 0);
});

test('quantizeSaving reports the byte reduction from rounding', () => {
 const raw = {a: 1.23456789, b: 9.87654321, c: [1.11111111, 2.22222222]};
 const saving = quantizeSaving(raw, 3);
 assert.ok(saving.raw >= saving.quantized);
 assert.ok(saving.saved >= 0);
 assert.ok(saving.ratio >= 0 && saving.ratio <= 1);
 assert.equal(quantizeSaving({}, 3).ratio, 0, 'an empty payload saves nothing');
});
