import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {
  MOTH_SURFACE_MARKER,
  MOTH_GRID_KINDS,
  MOTH_SURFACE_MODES,
  MOTH_STRUCTURE_WEAR_CAP,
  MOTH_STRUCTURE_ROUGH_CAP,
  mothSurfacePolicy,
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
    vertexShader: '#include <project_vertex>',
    fragmentShader: '#include <map_fragment>\n#include <roughnessmap_fragment>',
  };
  material.onBeforeCompile(shader, {});
  return shader;
}

test('mothSurfacePolicy classifies structure and organic kinds', () => {
  for (const kind of MOTH_GRID_KINDS) {
    const policy = mothSurfacePolicy(kind);
    assert.equal(policy.mode, MOTH_SURFACE_MODES.STRUCTURE, kind);
    assert.equal(policy.structure, true, kind);
    assert.ok(policy.wearStrength > 0 && policy.wearStrength <= MOTH_STRUCTURE_WEAR_CAP, kind);
    assert.ok(policy.roughStrength > 0 && policy.roughStrength <= MOTH_STRUCTURE_ROUGH_CAP, kind);
  }
  const rock = mothSurfacePolicy('rock');
  assert.equal(rock.mode, MOTH_SURFACE_MODES.ORGANIC);
  assert.equal(rock.structure, false);
  assert.equal(typeof rock.fractureStrength, 'number');
  assert.equal(mothSurfacePolicy('not_a_real_kind').mode, MOTH_SURFACE_MODES.ORGANIC, 'unknown kinds stay organic');
  assert.equal(mothSurfacePolicy(undefined).mode, MOTH_SURFACE_MODES.ORGANIC);
});

test('mothSurfaceBreakConfig aliases the policy and no longer returns null', () => {
  assert.deepEqual(mothSurfaceBreakConfig('rock'), mothSurfacePolicy('rock'));
  assert.deepEqual(mothSurfaceBreakConfig('concrete'), mothSurfacePolicy('concrete'));
  const grid = mothSurfaceBreakConfig('hazard_stripes');
  assert.ok(grid, 'grid kinds now return a policy instead of null');
  assert.equal(grid.mode, MOTH_SURFACE_MODES.STRUCTURE);
  // The numeric fields old callers spread are still present.
  for (const field of ['macroScale', 'macroStrength', 'breakScale', 'breakStrength', 'rotation', 'fractureStrength']) {
    assert.equal(typeof grid[field], 'number', `grid.${field} is a number`);
  }
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
  assert.equal(material.userData.mothSurfaceMode, 'organic');

  const shader = compile(material);
  assert.ok(shader.vertexShader.includes('vMothWorld'));
  assert.ok(shader.fragmentShader.includes(MOTH_SURFACE_MARKER));
  assert.ok(material.userData.mothSurfaceUniforms.uMothMacroStrength);
  assert.ok(shader.uniforms.uMothMacroStrength, 'uniform installed on the shader');
});

test('structure kinds now patch instead of being a no-op', () => {
  for (const kind of MOTH_GRID_KINDS) {
    const material = enhanceMothMaterial(makeMaterial(), { kind });
    assert.equal(material.userData.mothSurface, true, kind);
    assert.equal(material.userData.mothSurfaceMode, 'structure', kind);

    const shader = compile(material);
    assert.ok(shader.fragmentShader.includes(MOTH_SURFACE_MARKER), kind);
    assert.ok(shader.fragmentShader.includes('mothWear'), `${kind} injects the wear field`);
    assert.ok(shader.fragmentShader.includes('mothGuard'), `${kind} keeps the saturation guard`);
    assert.ok(
      shader.fragmentShader.includes('roughnessFactor = clamp( roughnessFactor + mothWear'),
      `${kind} modulates roughness independently`
    );
  }
});

test('structure kinds never rotate or rescale the base map sample', () => {
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'hazard_stripes' });
  const shader = compile(material);
  assert.ok(!shader.fragmentShader.includes('mothRot'), 'no rotation matrix');
  assert.ok(!shader.fragmentShader.includes('mat2('), 'no rotation matrix');
  assert.ok(!shader.fragmentShader.includes('vMapUv'), 'structural UVs are untouched');
  assert.ok(!shader.fragmentShader.includes('texture2D( map'), 'no second structural sample');
  assert.ok(shader.fragmentShader.includes('mix( 1.0, 0.35,'), 'saturated paint reduces wear');
  assert.ok(shader.fragmentShader.includes('vMothWorld, uMothWearScale'), 'wear is world-space');
});

test('structure strengths are clamped to conservative caps', () => {
  const material = enhanceMothMaterial(makeMaterial(), {
    kind: 'metal_grating',
    wearStrength: 5,
    roughStrength: 5,
  });
  const uniforms = material.userData.mothSurfaceUniforms;
  assert.equal(uniforms.uMothWearStrength.value, MOTH_STRUCTURE_WEAR_CAP);
  assert.equal(uniforms.uMothRoughStrength.value, MOTH_STRUCTURE_ROUGH_CAP);
});

test('organic path includes instancing support and vertical (Y) variation', () => {
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const shader = compile(material);
  assert.ok(shader.vertexShader.includes('#ifdef USE_INSTANCING'), 'instance path guarded');
  assert.ok(shader.vertexShader.includes('instanceMatrix * mothWorldPos'), 'instance transform applied');
  assert.ok(shader.vertexShader.includes('modelMatrix * mothWorldPos'));
  assert.ok(shader.fragmentShader.includes('p.xy * scale'), 'XY slice varies on walls');
  assert.ok(shader.fragmentShader.includes('p.zy * scale'), 'ZY slice varies on walls');
  assert.ok(shader.fragmentShader.includes('mothField( vMothWorld'), 'the 3D field feeds the patch');
});

test('organic macro term is mean-neutral and strength-controlled', () => {
  const macro = makeMap();
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock', macro });
  const shader = compile(material);
  assert.equal(shader.uniforms.uMothMacro, material.userData.mothSurfaceUniforms.uMothMacro);
  assert.ok(shader.fragmentShader.includes('uniform sampler2D uMothMacro;'));
  assert.ok(
    shader.fragmentShader.includes('( mothMacroTex - 0.5 ) * 2.0 * uMothMacroStrength'),
    'the 0.5 neutral is subtracted and the strength scales the deviation'
  );
  assert.ok(shader.fragmentShader.includes('uMothMacroScale'), 'the procedural field keeps its own scale');
});

test('organic roughness is modulated independently of albedo and normals stay untouched', () => {
  const shader = compile(enhanceMothMaterial(makeMaterial(), { kind: 'rock' }));
  assert.ok(shader.fragmentShader.includes('roughnessFactor = clamp( roughnessFactor +'));
  assert.ok(shader.fragmentShader.includes('( mothRegion - 0.5 ) * 2.0 * uMothRoughStrength'));
  assert.ok(!shader.fragmentShader.includes('normal ='), 'normals are deliberately not perturbed');
});

test('organic keeps the rotated second sample with a seeded UV offset', () => {
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const shader = compile(material);
  assert.ok(shader.fragmentShader.includes('texture2D( map, mothRotUv * uMothBreakScale )'));
  assert.ok(shader.fragmentShader.includes('+ uMothPhase * 0.13'), 'seed offsets the second sample UVs');
});

test('missing fragment anchor leaves the material unpatched without appending code', () => {
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const shader = {
    uniforms: {},
    vertexShader: '#include <project_vertex>',
    fragmentShader: 'void main() {}\n',
  };
  material.onBeforeCompile(shader, {});
  assert.equal(material.userData.mothSurface, false);
  assert.equal(material.userData.mothSurfaceFallback, 'missing-map-fragment-anchor');
  assert.equal(shader.fragmentShader, 'void main() {}\n', 'no executable body is appended');
  assert.equal(shader.vertexShader, '#include <project_vertex>', 'the vertex shader stays untouched too');
  assert.equal(shader.fragmentShader.includes(MOTH_SURFACE_MARKER), false);
});

test('missing vertex anchor leaves the fragment shader unpatched', () => {
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const shader = {
    uniforms: {},
    vertexShader: 'void main() {}',
    fragmentShader: '#include <map_fragment>\n',
  };
  material.onBeforeCompile(shader, {});
  assert.equal(material.userData.mothSurface, false);
  assert.equal(material.userData.mothSurfaceFallback, 'missing-project-vertex-anchor');
  assert.equal(shader.fragmentShader, '#include <map_fragment>\n');
});

test('missing roughness anchor still patches albedo and reports the partial fallback', () => {
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const shader = {
    uniforms: {},
    vertexShader: '#include <project_vertex>',
    fragmentShader: '#include <map_fragment>',
  };
  material.onBeforeCompile(shader, {});
  assert.equal(material.userData.mothSurface, true);
  assert.equal(material.userData.mothSurfaceFallback, 'missing-roughnessmap-anchor');
  assert.ok(shader.fragmentShader.includes('mothRegion'));
  assert.ok(!shader.fragmentShader.includes('roughnessFactor'), 'no orphan roughness statement');
});

test('program cache keys distinguish mode, macro and seed but stay stable', () => {
  const plain = makeMaterial();
  const rock = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const rockAgain = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const hazard = enhanceMothMaterial(makeMaterial(), { kind: 'hazard_stripes' });
  assert.notEqual(rock.customProgramCacheKey(), plain.customProgramCacheKey());
  assert.equal(rock.customProgramCacheKey(), rockAgain.customProgramCacheKey(), 'equal settings keep one key');
  assert.notEqual(rock.customProgramCacheKey(), hazard.customProgramCacheKey(), 'modes differ');
  const seeded = enhanceMothMaterial(makeMaterial(), { kind: 'rock', seed: 9 });
  const seededAgain = enhanceMothMaterial(makeMaterial(), { kind: 'rock', seed: 9 });
  assert.notEqual(seeded.customProgramCacheKey(), rock.customProgramCacheKey(), 'seeds differ');
  assert.equal(seeded.customProgramCacheKey(), seededAgain.customProgramCacheKey());
  assert.notEqual(
    enhanceMothMaterial(makeMaterial(), { kind: 'rock', macro: makeMap() }).customProgramCacheKey(),
    rock.customProgramCacheKey(),
    'macro presence differs'
  );
});

test('seeds are deterministic and derived from the material, not Math.random', () => {
  const first = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  const second = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  assert.equal(Number.isFinite(first.userData.mothSurfaceSeed), true);
  assert.equal(first.userData.mothSurfaceSeed, second.userData.mothSurfaceSeed, 'same kind, same seed');
  assert.equal(
    first.userData.mothSurfaceUniforms.uMothRotation.value,
    second.userData.mothSurfaceUniforms.uMothRotation.value
  );
  assert.equal(
    first.userData.mothSurfaceUniforms.uMothPhase.value.x,
    second.userData.mothSurfaceUniforms.uMothPhase.value.x
  );
  const otherKind = enhanceMothMaterial(makeMaterial(), { kind: 'concrete' });
  assert.notEqual(otherKind.userData.mothSurfaceSeed, first.userData.mothSurfaceSeed, 'kind feeds the seed');

  const alpha = enhanceMothMaterial(makeMaterial(), { kind: 'rock', seed: 'alpha' });
  const alphaAgain = enhanceMothMaterial(makeMaterial(), { kind: 'rock', seed: 'alpha' });
  const beta = enhanceMothMaterial(makeMaterial(), { kind: 'rock', seed: 'beta' });
  assert.equal(alpha.userData.mothSurfaceSeed, alphaAgain.userData.mothSurfaceSeed);
  assert.notEqual(alpha.userData.mothSurfaceSeed, beta.userData.mothSurfaceSeed);
  assert.notEqual(
    alpha.userData.mothSurfaceUniforms.uMothPhase.value.x,
    beta.userData.mothSurfaceUniforms.uMothPhase.value.x
  );
  const numeric = enhanceMothMaterial(makeMaterial(), { kind: 'rock', seed: 12 });
  assert.equal(numeric.userData.mothSurfaceSeed, 12, 'numeric seeds are kept as-is');
});

test('setters mutate live uniforms and clamp structural strengths', () => {
  const material = enhanceMothMaterial(makeMaterial(), { kind: 'metal_grating' });
  material.userData.setMothMacroStrength(0.9);
  assert.equal(material.userData.mothSurfaceUniforms.uMothMacroStrength.value, 0.9);
  material.userData.setMothBreakStrength(0.15);
  assert.equal(material.userData.mothSurfaceUniforms.uMothBreakStrength.value, 0.15);
  assert.equal(material.userData.setMothWearStrength(0.1), 0.1);
  assert.equal(material.userData.mothSurfaceUniforms.uMothWearStrength.value, 0.1);
  assert.equal(material.userData.setMothWearStrength(9), MOTH_STRUCTURE_WEAR_CAP);
  assert.equal(material.userData.mothSurfaceUniforms.uMothWearStrength.value, MOTH_STRUCTURE_WEAR_CAP);
  assert.equal(material.userData.setMothRoughStrength(0.05), 0.05);
  assert.equal(material.userData.setMothRoughStrength(9), MOTH_STRUCTURE_ROUGH_CAP);
  assert.equal(material.userData.setMothWearStrength('x'), MOTH_STRUCTURE_WEAR_CAP, 'non-finite input is ignored');
  const organic = enhanceMothMaterial(makeMaterial(), { kind: 'rock' });
  assert.equal(organic.userData.setMothRoughStrength(0.9), 0.9, 'organic roughness is not structurally capped');
});

test('structure wear is broader than the organic field and mean-neutral', () => {
  const hazard = mothSurfacePolicy('hazard_stripes');
  const rock = mothSurfacePolicy('rock');
  assert.ok(hazard.wearScale < rock.macroScale, 'structure grime is a lower frequency than the organic break field');
  const shader = compile(enhanceMothMaterial(makeMaterial(), { kind: 'hazard_stripes' }));
  assert.ok(shader.fragmentShader.includes('diffuseColor.rgb *= 1.0 + mothWear'), 'albedo wear is an additive factor');
  assert.ok(shader.fragmentShader.includes('roughnessFactor + mothWear'), 'roughness wear is additive, not a multiply');
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
  assert.equal(mothSurfaceBreakConfig('hazard_stripes').fractureStrength, 0, 'structure kinds carry no fractures');

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

test('an existing onBeforeCompile is chained, not overwritten', () => {
  const material = makeMaterial();
  let calls = 0;
  material.onBeforeCompile = (shader) => {
    calls += 1;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n// previous patch'
    );
  };
  enhanceMothMaterial(material, { kind: 'rock' });
  const shader = compile(material);
  assert.equal(calls, 1, 'the previous patch still runs');
  assert.ok(shader.fragmentShader.includes('// previous patch'));
  assert.ok(shader.fragmentShader.includes(MOTH_SURFACE_MARKER));
});

test('enhancing the same material twice does not inject the body twice', () => {
  const material = makeMaterial();
  enhanceMothMaterial(material, { kind: 'rock' });
  enhanceMothMaterial(material, { kind: 'rock', seed: 3 });
  const shader = compile(material);
  assert.equal(shader.fragmentShader.split('uniform float uMothRoughStrength;').length - 1, 1, 'one declaration');
  assert.equal(shader.fragmentShader.split('roughnessFactor = clamp( roughnessFactor +').length - 1, 1);
  assert.equal(
    shader.uniforms.uMothRoughStrength,
    material.userData.mothSurfaceUniforms.uMothRoughStrength,
    'the live uniforms match the latest enhance call'
  );
});

test('a material without a map still gets the structure wear patch', () => {
  const material = new T.MeshStandardMaterial();
  enhanceMothMaterial(material, { kind: 'hazard_stripes' });
  const shader = compile(material);
  assert.ok(shader.fragmentShader.includes('mothWear'));
  assert.ok(!shader.fragmentShader.includes('texture2D( map'));
});

test('updateMothSurface is deterministic and finite', () => {
  assert.equal(updateMothSurface(4), updateMothSurface(4));
  assert.equal(Number.isFinite(updateMothSurface(4)), true);
  assert.equal(updateMothSurface('x'), 0);
});
