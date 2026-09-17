import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceTextures,clearSurfaceTextures,wetSheenTexture,canonicalTextureKind,TEXTURE_KINDS,MATERIAL_PRESETS,materialPreset,mothMaterialLutTexture,mothSkyTexture,mothEffectTextures} from './textures.mjs';
import {configureMothAssets,resetMothAssets} from './moth-assets.mjs';

const withDocument = t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const ctx = {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{createElement:()=>({width:0,height:0,getContext:()=>ctx})}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
};

test('surface textures cache by key and are disposed exactly once on clear', t => {
  withDocument(t);
  const first = surfaceTextures('rock', {seed:3, repeat:[1,1]});
  assert.ok(first.map && first.normalMap && first.roughnessMap, 'all three maps are generated');
  assert.equal(surfaceTextures('rock', {seed:3, repeat:[1,1]}), first, 'identical requests reuse the cache');
  let disposed = 0;
  for (const texture of Object.values(first)) texture.addEventListener('dispose', () => disposed++);
  clearSurfaceTextures();
  assert.equal(disposed, 3, 'clearing disposes every cached map exactly once');
  assert.notEqual(surfaceTextures('rock', {seed:3, repeat:[1,1]}), first, 'cleared entries are rebuilt');
  clearSurfaceTextures();
});

test('surface textures return null without a document', () => {
  assert.equal(surfaceTextures('concrete'), null);
  assert.equal(wetSheenTexture(), null);
});

test('the wet sheen overlay caches by key and is disposed with the surface cache', t => {
  withDocument(t);
  const first = wetSheenTexture({ seed: 3 });
  assert.ok(first, 'the wet overlay is generated with a document');
  assert.equal(first.userData.surfaceKind, 'wet');
  assert.equal(wetSheenTexture({ seed: 3 }), first, 'identical requests reuse the cache');
  assert.notEqual(wetSheenTexture({ seed: 4 }), first, 'a new seed builds a distinct overlay');
  let disposed = 0;
  first.addEventListener('dispose', () => disposed++);
  clearSurfaceTextures();
  assert.equal(disposed, 1, 'clearing the surface cache releases the wet overlay exactly once');
  assert.notEqual(wetSheenTexture({ seed: 3 }), first, 'cleared overlays are rebuilt');
  clearSurfaceTextures();
});

test('rich procedural textures generate complete map sets and respect aliases', t => {
  withDocument(t);
  const kinds = [
    'carbon_fiber',
    'metal_grating',
    'hex_paneling',
    'hazard_stripes',
    'weathered_concrete',
    'holographic_grid',
    'diamond_plate',
    'riveted_armor',
    'circuit_board',
    'brushed_metal',
    'corrugated_metal',
    'alien_chitin',
    'rough_stucco',
    'industrial_mesh',
  ];
  for (const kind of kinds) {
    const tex = surfaceTextures(kind, { seed: 5, size: 64, repeat: [2, 2] });
    assert.ok(tex, `textures generated for ${kind}`);
    assert.ok(tex.map, `map generated for ${kind}`);
    assert.ok(tex.roughnessMap, `roughnessMap generated for ${kind}`);
    assert.ok(tex.normalMap, `normalMap generated for ${kind}`);
    assert.equal(tex.map.userData.surfaceKind, kind);
  }

  // Check aliases resolve to valid textures
  const carbon = surfaceTextures('carbon', { seed: 7, size: 48 });
  assert.ok(carbon?.map, 'carbon alias generated');
  const grating = surfaceTextures('grating', { seed: 7, size: 48 });
  assert.ok(grating?.map, 'grating alias generated');
  const hex = surfaceTextures('hex', { seed: 7, size: 48 });
  assert.ok(hex?.map, 'hex alias generated');
  const hazard = surfaceTextures('hazard', { seed: 7, size: 48 });
  assert.ok(hazard?.map, 'hazard alias generated');
  const hologrid = surfaceTextures('hologrid', { seed: 7, size: 48 });
  assert.ok(hologrid?.map, 'hologrid alias generated');

  const diamond = surfaceTextures('diamond', { seed: 7, size: 48 });
  assert.ok(diamond?.map && diamond?.normalMap, 'diamond alias generated');
  const riveted = surfaceTextures('riveted', { seed: 7, size: 48 });
  assert.ok(riveted?.map && riveted?.normalMap, 'riveted alias generated');
  const circuit = surfaceTextures('circuit', { seed: 7, size: 48 });
  assert.ok(circuit?.map && circuit?.normalMap, 'circuit alias generated');
  const brushed = surfaceTextures('brushed', { seed: 7, size: 48 });
  assert.ok(brushed?.map && brushed?.normalMap, 'brushed alias generated');
  const corrugated = surfaceTextures('corrugated', { seed: 7, size: 48 });
  assert.ok(corrugated?.map && corrugated?.normalMap, 'corrugated alias generated');
  const chitin = surfaceTextures('chitin', { seed: 7, size: 48 });
  assert.ok(chitin?.map && chitin?.normalMap, 'chitin alias generated');
  const stucco = surfaceTextures('stucco', { seed: 7, size: 48 });
  assert.ok(stucco?.map && stucco?.normalMap, 'stucco alias generated');
  const mesh = surfaceTextures('mesh', { seed: 7, size: 48 });
  assert.ok(mesh?.map && mesh?.normalMap, 'mesh alias generated');

  clearSurfaceTextures();
});

test('canonicalTextureKind resolves canonical kinds, known aliases and defaults unknown kinds', () => {
  for (const kind of TEXTURE_KINDS) {
    assert.equal(canonicalTextureKind(kind), kind, `${kind} resolves to itself`);
  }
  assert.equal(canonicalTextureKind('diamond'), 'diamond_plate');
  assert.equal(canonicalTextureKind('riveted'), 'riveted_armor');
  assert.equal(canonicalTextureKind('circuit'), 'circuit_board');
  assert.equal(canonicalTextureKind('brushed'), 'brushed_metal');
  assert.equal(canonicalTextureKind('corrugated'), 'corrugated_metal');
  assert.equal(canonicalTextureKind('chitin'), 'alien_chitin');
  assert.equal(canonicalTextureKind('stucco'), 'rough_stucco');
  assert.equal(canonicalTextureKind('mesh'), 'industrial_mesh');
  assert.equal(canonicalTextureKind('carbon'), 'carbon_fiber');
  assert.equal(canonicalTextureKind('hologrid'), 'holographic_grid');
  assert.equal(canonicalTextureKind('unknown_bogus_kind'), 'concrete');
  assert.equal(canonicalTextureKind(null), 'concrete');
  assert.equal(canonicalTextureKind(undefined), 'concrete');
});

test('surfaceTextures tags canonical surfaceKind on aliases and supports bumpMap option', t => {
  withDocument(t);
  const result = surfaceTextures('diamond', { seed: 12, size: 64, bump: true });
  assert.ok(result, 'textures returned');
  assert.equal(result.map.userData.surfaceKind, 'diamond_plate', 'alias tags canonical surfaceKind');
  assert.ok(result.bumpMap, 'bumpMap is generated when requested');
  let disposed = 0;
  result.bumpMap.addEventListener('dispose', () => disposed++);
  clearSurfaceTextures();
  assert.equal(disposed, 1, 'bumpMap is disposed on clearSurfaceTextures');
});

test('the entanglement preset is a distinct, frozen surface and looks up by name', () => {
  assert.ok(Object.isFrozen(MATERIAL_PRESETS));
  const { entanglement } = MATERIAL_PRESETS;
  assert.ok(entanglement.metalness > 0.4 && entanglement.roughness < 0.3, 'entanglement is a sharp metallic surface');
  assert.equal(materialPreset('entanglement'), entanglement);
});

test('configured Moth assets replace the albedo map while procedural maps remain', t => {
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  configureMothAssets({
    version: 1,
    textures: { concrete: { width: 2, height: 2, data: b64(Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255])) } },
    normals: { concrete: { width: 2, height: 2, data: b64(Uint8Array.from([128, 128, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255])) } },
    materials: { entanglement: { size: 2, r: b64(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), t: b64(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4])) } },
    sky: { nebula: { width: 2, height: 2, equirect: true, data: b64(Uint8Array.from([5, 10, 20, 255, 6, 11, 21, 255, 7, 12, 22, 255, 8, 13, 23, 255])) } },
    effects: { rift: { fps: 8, frames: [{ width: 2, height: 2, data: b64(Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255])) }] } },
    levels: {}, seeds: {}, motifs: {},
  });
  try {
    withDocument(t);
    const maps = surfaceTextures('concrete', { seed: 1, size: 32, repeat: [2, 3] });
    assert.ok(maps.map, 'albedo is produced');
    assert.equal(maps.map.isDataTexture, true, 'albedo comes from the baked Moth tile');
    assert.equal(maps.map.userData.source, 'moth');
    assert.equal(maps.map.image.width, 2);
    assert.equal(maps.map.image.height, 2);
    assert.deepEqual([...maps.map.image.data.slice(0, 4)], [10, 20, 30, 255]);
    assert.equal(maps.map.repeat.x, 2);
    assert.equal(maps.map.repeat.y, 3);
    assert.ok(maps.roughnessMap && maps.roughnessMap.isDataTexture !== true, 'roughness stays procedural');
    assert.equal(maps.normalMap.isDataTexture, true, 'normal comes from the baked Moth map');
    assert.equal(maps.normalMap.userData.source, 'moth');
    assert.deepEqual([...maps.normalMap.image.data.slice(0, 4)], [128, 128, 255, 255]);
    clearSurfaceTextures();

    const lut = mothMaterialLutTexture('entanglement', { repeat: [1, 1] });
    assert.ok(lut, 'the baked LUT is exposed as a texture');
    assert.equal(lut.isDataTexture, true);
    assert.equal(lut.image.width, 2);
    assert.equal(lut.userData.mothLut, 'entanglement');
    assert.deepEqual([...lut.image.data.slice(0, 3)], [1, 2, 3]);
    lut.dispose();
    assert.equal(mothMaterialLutTexture('missing'), null);

    const sky = mothSkyTexture('nebula');
    assert.ok(sky && sky.texture.isDataTexture, 'the baked sky is a DataTexture');
    assert.equal(sky.equirect, true);
    assert.equal(typeof sky.texture.mapping, 'number');
    assert.deepEqual([...sky.texture.image.data.slice(0, 3)], [5, 10, 20]);
    assert.equal(mothSkyTexture('missing'), null);

    const effect = mothEffectTextures('rift');
    assert.equal(effect.textures.length, 1);
    assert.equal(effect.fps, 8);
    assert.equal(effect.textures[0].isDataTexture, true);
    assert.equal(mothEffectTextures('missing'), null);
  } finally {
    clearSurfaceTextures();
    resetMothAssets();
  }
});

test('without a configured registry surfaceTextures keeps the procedural albedo', t => {
  resetMothAssets();
  withDocument(t);
  const maps = surfaceTextures('concrete', { seed: 1, size: 32 });
  assert.equal(maps.map.isDataTexture, undefined, 'no baked override leaks into the default path');
  clearSurfaceTextures();
});


