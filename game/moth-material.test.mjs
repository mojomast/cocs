import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {
  createMothLutMaterial,
  updateMoth,
  MOTH_LUT_SHADER_MARKER,
} from './moth-material.mjs';

function makeLut() {
  const data = new Uint8Array(4 * 4 * 3);
  for (let i = 0; i < data.length; i++) data[i] = (i * 17) % 256;
  const lut = new T.DataTexture(data, 4, 4, T.RGBFormat, T.UnsignedByteType);
  lut.needsUpdate = true;
  return lut;
}

function compile(material) {
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
  material.onBeforeCompile(shader, {});
  return shader;
}

test('createMothLutMaterial builds a patched standard material', () => {
  const lut = makeLut();
  const material = createMothLutMaterial({ lut });
  assert.ok(material instanceof T.Material, 'returns a three material');
  assert.ok(material instanceof T.MeshStandardMaterial, 'standard material');
  assert.equal(material.userData.moth, true);
  assert.equal(typeof material.onBeforeCompile, 'function');
  assert.equal(lut.wrapS, T.RepeatWrapping);
  assert.equal(lut.wrapT, T.RepeatWrapping);
  assert.equal(lut.colorSpace, T.NoColorSpace);
});

test('onBeforeCompile installs LUT uniforms and the shader marker', () => {
  const material = createMothLutMaterial({ lut: makeLut() });
  const shader = compile(material);
  assert.ok(shader.uniforms.uMothLut, 'lut uniform installed');
  assert.equal(
    shader.uniforms.uMothLut.value,
    material.userData.mothUniforms.uMothLut.value
  );
  assert.ok(material.userData.mothUniforms.uMothPhase, 'phase uniform tracked');
  assert.ok(
    shader.fragmentShader.includes(MOTH_LUT_SHADER_MARKER),
    'injected fragment shader contains the marker'
  );
});

test('program cache keys distinguish LUT from no-LUT materials', () => {
  const withLut = createMothLutMaterial({ lut: makeLut() });
  const withoutLut = createMothLutMaterial({ lut: null });
  assert.notEqual(withLut.customProgramCacheKey(), withoutLut.customProgramCacheKey());
});

test('setMothPhase and setMothIntensity update the live uniforms', () => {
  const material = createMothLutMaterial({ lut: makeLut(), phase: 0.2, intensity: 0.4 });
  material.userData.setMothPhase(0.5);
  assert.equal(material.userData.mothUniforms.uMothPhase.value, 0.5);
  material.userData.setMothIntensity(1.1);
  assert.equal(material.userData.mothUniforms.uMothIntensity.value, 1.1);
  const shader = compile(material);
  shader.uniforms.uMothPhase.value = 0.7;
  assert.equal(
    material.userData.mothUniforms.uMothPhase.value,
    0.7,
    'compiled uniform shares the stored object'
  );
});

test('a null LUT returns a usable, unpatched material', () => {
  const material = createMothLutMaterial({ lut: null });
  assert.ok(material instanceof T.MeshStandardMaterial);
  assert.equal(material.userData.moth, true);
  const shader = compile(material);
  assert.equal(shader.fragmentShader.includes(MOTH_LUT_SHADER_MARKER), false);
});

test('base parameters are applied and updateMoth is deterministic', () => {
  const material = createMothLutMaterial({
    lut: makeLut(),
    base: { metalness: 0.62, roughness: 0.12, color: 0x223344 },
  });
  assert.equal(material.metalness, 0.62);
  assert.equal(material.roughness, 0.12);
  assert.equal(updateMoth(4), updateMoth(4));
  const phase = updateMoth(4);
  assert.ok(phase >= 0 && phase < 1);
});

test('an optional secondary LUT is sampled when supplied', () => {
  const material = createMothLutMaterial({ lut: makeLut(), lutT: makeLut() });
  const shader = compile(material);
  assert.ok(shader.uniforms.uMothLutT, 'secondary uniform installed');
  assert.ok(shader.fragmentShader.includes('uMothLutT'));
});
