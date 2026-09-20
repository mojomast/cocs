import test from 'node:test';
import assert from 'node:assert/strict';
import {FinishPass,FINISH_DITHER_MAX} from './finish-pass.mjs';

test('finish pass defaults are bounded and display-space', () => {
  const pass=new FinishPass();
  assert.equal(pass.name,'finish');
  assert.equal(pass.material.toneMapped,false);
  assert.equal(pass.uniforms.dither.value,1);
  assert.ok(pass.uniforms.sharpen.value>0&&pass.uniforms.sharpen.value<=1);
  assert.ok(FINISH_DITHER_MAX>0&&FINISH_DITHER_MAX<=1/255);
  pass.dispose();
});

test('configure clamps amounts, ignores junk and sizes the pass', () => {
  const pass=new FinishPass();
  pass.configure({dither:Infinity,sharpen:-3},844,390);
  assert.equal(pass.uniforms.dither.value,1,'non-finite keeps the current value');
  assert.equal(pass.uniforms.sharpen.value,0);
  assert.deepEqual(pass.uniforms.resolution.value.toArray(),[844,390]);
  pass.configure({dither:.5,sharpen:.25},1920,1080);
  assert.equal(pass.uniforms.dither.value,.5);
  assert.equal(pass.uniforms.sharpen.value,.25);
  assert.deepEqual(pass.uniforms.resolution.value.toArray(),[1920,1080]);
  pass.configure({},0,0);
  assert.deepEqual(pass.uniforms.resolution.value.toArray(),[1,1]);
  pass.dispose();
});

test('the shader is static and guarded: no time uniform, both effects toggled', () => {
  const pass=new FinishPass();
  const source=pass.material.fragmentShader;
  assert.ok(source.includes('if(sharpen>0.)'));
  assert.ok(source.includes('if(dither>0.)'));
  assert.ok(!/uniform\s+float\s+time\b/.test(source),'no clock uniform');
  assert.ok(!source.includes('uTime'));
  assert.ok(source.includes('resolution'));
  pass.dispose();
});
