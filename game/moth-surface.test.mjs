import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {
  MOTH_SURFACE_MARKER,
  MOTH_GRID_KINDS,
  mothSurfaceBreakConfig,
  enhanceMothMaterial,
  updateMothSurface,
} from './moth-surface.mjs';

function makeMap() {
  const map = new T.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
  map.needsUpdate = true;
  return map;
}

function makeMaterial() {
  return new T.MeshStandardMaterial({ map: makeMap() });
}

function compile(material) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <fog_vertex>',
    fragmentShader: '#include <map_fragment>',
  };
  material.onBeforeCompile(shader, {});
  return shader;
}

test('config returns settings for natural kinds and null for grid kinds', () => {
  const rock = mothSurfaceBreakConfig('rock');
  assert.equal(typeof rock, 'object');
  assert.ok(rock);
  for (const field of [
    'macroScale',
    'macroStrength',
    'breakScale',
    'breakStrength',
    'rotation',
  ]) {
    assert.equal(typeof rock[field], 'number', `rock.${field} is a number`);
  }
  assert.equal(mothSurfaceBreakConfig('hazard_stripes'), null);
  assert.equal(mothSurfaceBreakConfig('hex_paneling'), null);
});

test('unknown kinds fall back to a natural config', () => {
  const config = mothSurfaceBreakConfig('not_a_real_kind');
  assert.ok(config);
  assert.equal(typeof config.macroScale, 'number');
});

test('MOTH_GRID_KINDS includes the canonical grid textures', () => {
  for (const kind of [
    'hazard_stripes',
    'hex_paneling',
    'circuit_board',
    'metal_grating',
    'diamond_plate',
    'industrial_mesh',
    'corrugated_metal',
    'carbon_fiber',
    'riveted_armor',
    'brushed_metal',
  ]) {
    assert.ok(MOTH_GRID_KINDS.includes(kind), `${kind} is a grid kind`);
  }
  assert.ok(Object.isFrozen(MOTH_GRID_KINDS));
});

test('enhanceMothMaterial patches a natural material and injects the shader', () => {
  const material = makeMaterial();
  const returned = enhanceMothMaterial(material, { kind: 'rock' });
  assert.equal(returned, material);
  assert.equal(material.userData.mothSurface, true);

  const shader = compile(material);
  assert.ok(shader.vertexShader.includes('vMothWorld'));
  assert.ok(shader.fragmentShader.includes(MOTH_SURFACE_MARKER));
  assert.ok(material.userData.mothSurfaceUniforms.uMothMacroStrength);
  assert.ok(shader.uniforms.uMothMacroStrength, 'uniform installed on the shader');
});

test('the enhancer is a no-op for grid kinds', () => {
  const material = makeMaterial();
  const returned = enhanceMothMaterial(material, { kind: 'hazard_stripes' });
  assert.equal(returned, material);
  assert.equal(material.userData.mothSurface, false);

  const shader = {
    uniforms: {},
    vertexShader: '#include <fog_vertex>',
    fragmentShader: '#include <map_fragment>',
  };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.fragmentShader.includes(MOTH_SURFACE_MARKER), false);
});

test('program cache keys distinguish enhanced from plain materials', () => {
  const plain = makeMaterial();
  const enhanced = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  assert.notEqual(enhanced.customProgramCacheKey(), plain.customProgramCacheKey());
});

test('setMothMacroStrength and setMothBreakStrength mutate live uniforms', () => {
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  material.userData.setMothMacroStrength(0.9);
  assert.equal(material.userData.mothSurfaceUniforms.uMothMacroStrength.value, 0.9);
  material.userData.setMothBreakStrength(0.15);
  assert.equal(material.userData.mothSurfaceUniforms.uMothBreakStrength.value, 0.15);
});

test('a supplied macro map is wired into the uniforms and shader', () => {
  const macro = makeMap();
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock', macro });
  assert.equal(material.userData.mothSurfaceUniforms.uMothMacro.value, macro);

  const shader = compile(material);
  assert.equal(shader.uniforms.uMothMacro, material.userData.mothSurfaceUniforms.uMothMacro);
  assert.ok(shader.fragmentShader.includes('uMothMacro'));
  assert.ok(shader.fragmentShader.includes('uniform sampler2D uMothMacro;'));
  assert.notEqual(
    material.customProgramCacheKey(),
    enhanceMothMaterial(makeMaterial(), { kind: 'rock' }).customProgramCacheKey()
  );
});

test('fracture strength is a per-kind default and reaches the injected shader', () => {
  const rock = mothSurfaceBreakConfig('rock');
  assert.equal(typeof rock.fractureStrength, 'number');
  assert.ok(rock.fractureStrength > 0 && rock.fractureStrength <= 1, `rock fracture ${rock.fractureStrength}`);
  assert.equal(mothSurfaceBreakConfig('rough_stucco').fractureStrength > 0, true);
  assert.equal(mothSurfaceBreakConfig('hazard_stripes'), null, 'grid kinds still opt out');

  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const uniforms = material.userData.mothSurfaceUniforms;
  assert.equal(uniforms.uMothFractureStrength.value, rock.fractureStrength, 'the kind default is installed');
  assert.equal(material.userData.setMothFractureStrength(0.2), 0.2);
  assert.equal(uniforms.uMothFractureStrength.value, 0.2, 'the setter mutates the live uniform');
  const custom = enhanceMothMaterial(makeMaterial(), { kind: 'rock', fractureStrength: .31 });
  assert.equal(custom.userData.mothSurfaceUniforms.uMothFractureStrength.value, .31, 'callers can override the default');

  const shader = compile(material);
  assert.ok(shader.uniforms.uMothFractureStrength, 'the fracture uniform is installed on the shader');
  assert.ok(shader.fragmentShader.includes('uMothFractureStrength'));
  assert.ok(shader.fragmentShader.includes('mothRidge'), 'a ridged fracture function is injected');
});

test('the macro field is sampled at two scales and cracks are masked by region', () => {
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const shader = compile(material);
  assert.ok(shader.fragmentShader.includes('mothRegion'), 'a broad region field is injected');
  assert.ok(shader.fragmentShader.includes('mothVeil'), 'the fracture layer is masked, not uniform');
  assert.ok(shader.fragmentShader.includes('mothP * 2.6'), 'the ridge layer runs at its own scale');
  assert.ok(shader.fragmentShader.includes('mothP * 0.37'), 'the region field mixes two scales');
});

test('macroMap spelling is accepted and shared textures are not modified', () => {
  const macro = makeMap();
  const map = makeMap();
  const material = new T.MeshStandardMaterial({ map });
  const beforeMapWrap = map.wrapS;
  const beforeMacroColorSpace = macro.colorSpace;
  enhanceMothMaterial(material, { kind: 'rock', macroMap: macro });
  assert.equal(material.userData.mothSurfaceUniforms.uMothMacro.value, macro);
  assert.equal(map.wrapS, beforeMapWrap);
  assert.equal(macro.colorSpace, beforeMacroColorSpace);
});

test('updateMothSurface is deterministic and finite', () => {
  assert.equal(updateMothSurface(4), updateMothSurface(4));
  assert.equal(Number.isFinite(updateMothSurface(4)), true);
  assert.equal(updateMothSurface('x'), 0);
});
