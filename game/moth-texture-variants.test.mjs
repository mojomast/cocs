// Node-only contract tests for the runtime half of G2/G3 (MOTH-GRAPHICS-PLAN.md
// §4.2, §5.1, §5.3, §5.5): game/textures.mjs consumes the offline material
// variants and applies one explicit sampling policy to every Moth DataTexture.
// No browser, no network, no timers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

import {
  applyMothSampling,
  clearSurfaceTextures,
  configureMothSampling,
  mothMacroTexture,
  mothSamplingState,
  surfaceTextures,
} from './textures.mjs';
import { configureMothAssets, resetMothAssets } from './moth-assets.mjs';
import {
  configureMothVariants,
  mothBakedVariantNames,
  mothVariantFor,
  mothVariantNames,
  mothVariantRecord,
  mothVariantStatus,
  resetMothVariants,
} from './moth-variants-runtime.mjs';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// surfaceTextures still short-circuits without a document (SSR), so variant
// assertions install the same minimal canvas stub as game/textures.test.mjs.
const withDocument = (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
};

// Smallest deterministic key that selects a known variant id, so the tests do
// not hard-code the runtime hash.
const keyFor = (kind, id) => {
  for (let i = 0; i < 600; i++) {
    const key = `panel-${i}`;
    if (mothVariantFor(kind, key) === id) return key;
  }
  throw new Error(`no key selects ${kind}/${id}`);
};

// A complete synthetic asset registry: only the textures/normals passed here
// are present, so missing-record behavior is easy to exercise without the real
// (and still changing) paid bake data.
const assetsFixture = ({ textures = {}, normals = {} } = {}) => ({
  version: 1,
  textures,
  normals,
  materials: {},
  sky: {},
  effects: {},
  levels: {},
  seeds: {},
  motifs: {},
});

test('a variant kind maps its albedo and roughness payloads onto Moth DataTextures', (t) => {
  resetMothVariants();
  withDocument(t);
  t.after(() => clearSurfaceTextures());

  const key = keyFor('metal', 'worn');
  const record = mothVariantRecord('metal', 'worn');
  assert.ok(record?.albedo && record?.roughness, 'the committed registry decodes metal/worn');

  const maps = surfaceTextures('metal', { seed: 1, size: 32, repeat: [2, 3], variantKey: key });
  assert.ok(maps?.map && maps.roughnessMap && maps.normalMap, 'all three maps are produced');

  // Albedo: the variant payload byte-for-byte, sRGB, repeating, smooth sampling.
  assert.equal(maps.map.isDataTexture, true, 'variant albedo is a DataTexture');
  assert.equal(maps.map.image.width, record.albedo.width);
  assert.equal(maps.map.image.height, record.albedo.height);
  assert.deepEqual([...maps.map.image.data.slice(0, 8)], [...record.albedo.data.slice(0, 8)]);
  assert.equal(maps.map.colorSpace, SRGBColorSpace);
  assert.equal(maps.map.wrapS, RepeatWrapping);
  assert.equal(maps.map.wrapT, RepeatWrapping);
  assert.equal(maps.map.repeat.x, 2);
  assert.equal(maps.map.repeat.y, 3);
  assert.equal(maps.map.magFilter, LinearFilter);
  assert.equal(maps.map.minFilter, LinearMipmapLinearFilter);
  assert.equal(maps.map.generateMipmaps, true);
  assert.equal(maps.map.anisotropy, 4);
  assert.equal(maps.map.userData.surfaceKind, 'metal');
  assert.equal(maps.map.userData.mothShared, true, 'shared textures are never disposed by the view traversal');
  assert.deepEqual(maps.map.userData.mothVariant, { kind: 'metal', id: 'worn' });

  // Roughness: numeric data, linear color space, same variant identity.
  assert.equal(maps.roughnessMap.isDataTexture, true);
  assert.equal(maps.roughnessMap.image.width, record.roughness.width);
  assert.equal(maps.roughnessMap.image.height, record.roughness.height);
  assert.equal(maps.roughnessMap.colorSpace, NoColorSpace);
  assert.equal(maps.roughnessMap.wrapS, RepeatWrapping);
  assert.equal(maps.roughnessMap.magFilter, LinearFilter);
  assert.equal(maps.roughnessMap.minFilter, LinearMipmapLinearFilter);
  assert.equal(maps.roughnessMap.generateMipmaps, true);
  assert.equal(maps.roughnessMap.userData.surfaceKind, 'metal');
  assert.equal(maps.roughnessMap.userData.mothShared, true);
  assert.deepEqual(maps.roughnessMap.userData.mothVariant, { kind: 'metal', id: 'worn' });
  assert.notEqual(maps.roughnessMap, maps.map, 'albedo and roughness are distinct textures');
  for (let i = 0; i < 16; i += 4) {
    assert.equal(maps.roughnessMap.image.data[i], maps.roughnessMap.image.data[i + 1], 'roughness stays grayscale');
  }
});

test('variantKey defaults to the seed and variant tiles are uploaded once', (t) => {
  resetMothVariants();
  withDocument(t);
  t.after(() => clearSurfaceTextures());

  // Find a seed whose default selection is a generated (paired-payload)
  // variant: the baked variants would take the albedo-only path and cannot
  // exercise the shared upload cache this test is about.
  let seed = null;
  for (let i = 0; i < 600 && seed === null; i++) {
    const id = mothVariantFor('metal', i);
    if (id && id !== 'original' && !mothBakedVariantNames('metal').includes(id)) seed = i;
  }
  assert.ok(seed !== null, 'metal has a reachable generated non-original variant');
  const seedId = mothVariantFor('metal', seed);
  const viaSeed = surfaceTextures('metal', { seed, size: 32, repeat: [1, 1] });
  assert.deepEqual(viaSeed.map.userData.mothVariant, { kind: 'metal', id: seedId }, 'the default variantKey is the seed');
  assert.equal(surfaceTextures('metal', { seed, size: 32, repeat: [1, 1] }), viaSeed, 'equal options reuse the cache entry');

  // A different seed with an explicit key that resolves to the same variant
  // reuses the uploaded tile instead of decoding/uploading a second copy.
  const viaKey = surfaceTextures('metal', { seed: seed + 77, size: 32, repeat: [1, 1], variantKey: seed });
  assert.equal(viaKey.map.userData.mothVariant.id, seedId);
  assert.equal(viaKey.map, viaSeed.map, 'the same variant tile is shared across seeds');
  assert.equal(viaKey.roughnessMap, viaSeed.roughnessMap);

  // Aliases resolve to the canonical kind before variant lookup.
  const aliasId = mothVariantNames('riveted_armor').find((id) => id !== 'original');
  assert.ok(aliasId, 'riveted_armor has a non-original variant');
  const viaAlias = surfaceTextures('riveted', { seed: 1, size: 32, repeat: [1, 1], variantKey: keyFor('riveted_armor', aliasId) });
  assert.equal(viaAlias.map.userData.surfaceKind, 'riveted_armor');
  assert.equal(viaAlias.map.userData.mothVariant?.kind, 'riveted_armor');
  assert.equal(viaAlias.map.userData.mothVariant?.id, aliasId);
});

test('many keys reach at least two distinct variants with distinct texture objects', (t) => {
  resetMothVariants();
  withDocument(t);
  t.after(() => clearSurfaceTextures());

  const seen = new Set();
  for (let i = 0; i < 48; i++) {
    const maps = surfaceTextures('metal', { seed: 5, size: 32, repeat: [1, 1], variantKey: `panel-${i}` });
    seen.add(maps.map.userData.mothVariant?.id ?? 'original');
  }
  assert.ok(seen.has('worn') && seen.has('stained'), `keys reach both wear states (${[...seen].join(', ')})`);

  const worn = surfaceTextures('metal', { seed: 5, size: 32, repeat: [1, 1], variantKey: keyFor('metal', 'worn') });
  const stained = surfaceTextures('metal', { seed: 5, size: 32, repeat: [1, 1], variantKey: keyFor('metal', 'stained') });
  assert.equal(worn.map.userData.mothVariant.id, 'worn');
  assert.equal(stained.map.userData.mothVariant.id, 'stained');
  assert.notEqual(worn.map, stained.map, 'different variants are different textures');
  assert.notEqual(worn.roughnessMap, stained.roughnessMap);
});

test('kinds without variants and the original variant keep the pre-change path', (t) => {
  resetMothVariants();
  withDocument(t);
  t.after(() => clearSurfaceTextures());

  assert.equal(mothVariantFor('sand', 4), null, 'sand has no variants');
  for (const kind of ['sand', 'concrete', 'grass']) {
    const maps = surfaceTextures(kind, { seed: 4, size: 32, bump: true });
    assert.equal(maps.map.isCanvasTexture, true, `${kind} albedo stays procedural`);
    assert.equal(maps.map.userData.mothVariant, undefined, `${kind} albedo carries no variant tag`);
    assert.equal(maps.roughnessMap.isCanvasTexture, true, `${kind} roughness stays procedural`);
    assert.equal(maps.roughnessMap.userData.mothVariant, undefined);
    assert.equal(maps.bumpMap.isCanvasTexture, true, `${kind} bump stays procedural`);
  }

  // 'original' is an explicit instruction to use the pre-variant path even
  // though the kind does have variants.
  const originalKey = keyFor('metal', 'original');
  const maps = surfaceTextures('metal', { seed: 4, size: 32, bump: true, variantKey: originalKey });
  assert.equal(maps.map.isCanvasTexture, true, 'original keeps the procedural albedo');
  assert.equal(maps.map.userData.mothVariant, undefined);
  assert.equal(maps.roughnessMap.isCanvasTexture, true, 'original keeps procedural roughness');
  assert.equal(maps.bumpMap.isCanvasTexture, true);
});

test('configured Moth assets still win for kinds without variants, with the sampling policy', (t) => {
  withDocument(t);
  configureMothAssets({
    version: 1,
    textures: { sand: { width: 2, height: 2, data: b64(Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255])) } },
    normals: { sand: { width: 2, height: 2, data: b64(Uint8Array.from([128, 128, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255])) } },
    materials: {}, sky: {}, effects: {}, levels: {}, seeds: {}, motifs: {},
  });
  try {
    const maps = surfaceTextures('sand', { seed: 4, size: 32 });
    assert.equal(maps.map.isDataTexture, true, 'the baked albedo is still used');
    assert.equal(maps.map.userData.source, 'moth');
    assert.equal(maps.map.userData.mothVariant, undefined);
    assert.equal(maps.map.minFilter, LinearMipmapLinearFilter);
    assert.equal(maps.map.generateMipmaps, true);
    assert.equal(maps.map.anisotropy, 4);
    assert.equal(maps.normalMap.isDataTexture, true, 'the baked normal is still used');
    assert.equal(maps.normalMap.minFilter, LinearMipmapLinearFilter);
    assert.equal(maps.roughnessMap.isCanvasTexture, true, 'roughness stays procedural');
  } finally {
    clearSurfaceTextures();
    resetMothAssets();
  }
});

test('the sampling policy defaults are explicit, clamped and returned as copies', () => {
  assert.deepEqual(mothSamplingState(), { smooth: true, anisotropy: 4 }, 'default is the smooth policy');
  try {
    assert.deepEqual(configureMothSampling({ anisotropy: 99 }), { smooth: true, anisotropy: 16 });
    assert.deepEqual(configureMothSampling({ anisotropy: 0 }), { smooth: true, anisotropy: 1 });
    assert.deepEqual(configureMothSampling({ anisotropy: -3 }), { smooth: true, anisotropy: 1 });
    assert.deepEqual(configureMothSampling({ anisotropy: '3' }), { smooth: true, anisotropy: 3 });
    assert.deepEqual(configureMothSampling({ anisotropy: NaN }), { smooth: true, anisotropy: 1 });
    assert.deepEqual(configureMothSampling({ anisotropy: Infinity }), { smooth: true, anisotropy: 1 });
    assert.deepEqual(configureMothSampling({ smooth: 'nope', anisotropy: 2 }), { smooth: true, anisotropy: 2 }, 'unknown smooth values keep the safe default');
    assert.deepEqual(configureMothSampling(null), { smooth: true, anisotropy: 4 }, 'a null options object restores the defaults');

    const copy = mothSamplingState();
    copy.smooth = false;
    copy.anisotropy = 99;
    assert.deepEqual(mothSamplingState(), { smooth: true, anisotropy: 4 }, 'the read-back is a copy');
  } finally {
    configureMothSampling();
  }
});

test('the retro switch applies to new and already-built Moth textures', (t) => {
  withDocument(t);
  configureMothAssets({
    version: 1,
    textures: { 'macro-organic': { width: 2, height: 2, data: b64(Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255])) } },
    normals: {}, materials: {}, sky: {}, effects: {}, levels: {}, seeds: {}, motifs: {},
  });
  try {
    const macro = mothMacroTexture();
    assert.ok(macro?.isDataTexture, 'the macro bake is a DataTexture');
    assert.equal(macro.colorSpace, NoColorSpace);
    assert.equal(macro.magFilter, LinearFilter);
    assert.equal(macro.minFilter, LinearMipmapLinearFilter);
    assert.equal(macro.generateMipmaps, true);
    assert.equal(macro.anisotropy, 4);

    assert.deepEqual(configureMothSampling({ smooth: false, anisotropy: 8 }), { smooth: false, anisotropy: 8 });
    // Already-built Moth textures switch immediately (needsUpdate re-uploads).
    assert.equal(macro.magFilter, NearestFilter);
    assert.equal(macro.minFilter, NearestFilter);
    assert.equal(macro.generateMipmaps, false);

    const retro = surfaceTextures('metal', { seed: 6, size: 32, repeat: [1, 1], variantKey: keyFor('metal', 'stained') });
    assert.equal(retro.map.magFilter, NearestFilter);
    assert.equal(retro.map.minFilter, NearestFilter);
    assert.equal(retro.map.generateMipmaps, false);
    assert.equal(retro.roughnessMap.magFilter, NearestFilter);
    assert.equal(retro.roughnessMap.minFilter, NearestFilter);
    assert.equal(retro.roughnessMap.generateMipmaps, false);

    assert.deepEqual(configureMothSampling(), { smooth: true, anisotropy: 4 }, 'a bare call restores the smooth default');
    assert.equal(macro.magFilter, LinearFilter);
    assert.equal(macro.minFilter, LinearMipmapLinearFilter);
    assert.equal(retro.map.magFilter, LinearFilter, 'restoring also re-stamps existing textures');
    assert.equal(retro.map.minFilter, LinearMipmapLinearFilter);
    assert.equal(retro.map.generateMipmaps, true);
    assert.equal(retro.map.anisotropy, 4);
  } finally {
    configureMothSampling();
    clearSurfaceTextures();
    resetMothAssets();
  }
});

test('applyMothSampling is total and honours the per-call mipmap override', async () => {
  const { DataTexture, RGBAFormat, UnsignedByteType } = await import('three');
  const texture = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
  assert.equal(applyMothSampling(null), null, 'a null texture is passed through');
  const version = texture.version;
  applyMothSampling(texture, { mipmaps: false });
  assert.equal(texture.wrapS, RepeatWrapping);
  assert.equal(texture.wrapT, RepeatWrapping);
  assert.equal(texture.magFilter, LinearFilter);
  assert.equal(texture.minFilter, LinearFilter, 'no mip chain means no mip filter');
  assert.equal(texture.generateMipmaps, false);
  assert.equal(texture.anisotropy, 4);
  assert.ok(texture.version > version, 'the helper marks the texture for re-upload');
});

test('clearing releases variant textures once and a later call rebuilds them', (t) => {
  resetMothVariants();
  withDocument(t);

  const key = keyFor('metal', 'worn');
  const first = surfaceTextures('metal', { seed: 1, size: 32, repeat: [1, 1], variantKey: key });
  let albedoDisposed = 0;
  let roughDisposed = 0;
  first.map.addEventListener('dispose', () => albedoDisposed++);
  first.roughnessMap.addEventListener('dispose', () => roughDisposed++);
  clearSurfaceTextures();
  assert.equal(albedoDisposed, 1, 'variant albedo disposed exactly once');
  assert.equal(roughDisposed, 1, 'variant roughness disposed exactly once');

  const second = surfaceTextures('metal', { seed: 1, size: 32, repeat: [1, 1], variantKey: key });
  assert.notEqual(second, first, 'cleared entries are rebuilt');
  assert.notEqual(second.map, first.map, 'cleared variant textures are re-uploaded');
  clearSurfaceTextures();
});

test('a variant texture shared by two surface entries is disposed exactly once', (t) => {
  resetMothVariants();
  withDocument(t);

  const key = keyFor('metal', 'stained');
  const a = surfaceTextures('metal', { seed: 1, size: 32, repeat: [1, 1], variantKey: key });
  const b = surfaceTextures('metal', { seed: 2, size: 32, repeat: [1, 1], variantKey: key });
  assert.notEqual(a, b, 'different seeds keep their own surface entries');
  assert.equal(a.map, b.map, 'but share the uploaded variant tile');
  let disposed = 0;
  a.map.addEventListener('dispose', () => disposed++);
  clearSurfaceTextures();
  assert.equal(disposed, 1, 'shared variant textures are not disposed once per entry');
});

test('malformed or missing variant payloads fall back without throwing', (t) => {
  withDocument(t);
  t.after(() => { resetMothVariants(); clearSurfaceTextures(); });

  // The id is selectable but its base64 tile does not decode to the declared
  // dimensions, which is exactly the malformed-payload case.
  configureMothVariants({ kinds: { metal: [{ id: 'worn', albedo: { width: 2, height: 2, data: 'AAAA' }, roughness: { width: 2, height: 2, data: 'AAAA' } }] } });
  const wornKey = keyFor('metal', 'worn');
  assert.equal(mothVariantFor('metal', wornKey), 'worn', 'the malformed id is selectable');
  let maps;
  assert.doesNotThrow(() => { maps = surfaceTextures('metal', { seed: 7, size: 32, variantKey: wornKey }); });
  assert.equal(maps.map.isCanvasTexture, true, 'malformed albedo falls back to procedural');
  assert.equal(maps.map.userData.mothVariant, undefined);
  assert.equal(maps.roughnessMap.isCanvasTexture, true, 'malformed roughness falls back to procedural');
  clearSurfaceTextures();

  // A missing registry (SSR/tests) is the same signal as an unknown kind.
  configureMothVariants(null);
  assert.equal(mothVariantFor('metal', 3), null, 'no registry selects no variant');
  assert.doesNotThrow(() => { maps = surfaceTextures('metal', { seed: 8, size: 32 }); });
  assert.equal(maps.map.isCanvasTexture, true);
  assert.equal(maps.map.userData.mothVariant, undefined);
});

test('without a document variant kinds still return null without decoding (SSR path)', () => {
  resetMothVariants();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  delete globalThis.document;
  try {
    assert.equal(surfaceTextures('metal', { seed: 3, size: 32, variantKey: 3 }), null);
    assert.equal(surfaceTextures('sand', { seed: 3, size: 32 }), null);
    assert.deepEqual(mothVariantStatus().decodedKinds, [], 'the SSR path never decodes variant tiles');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
  }
});

test('a baked variant maps its albedo and keeps procedural roughness plus the baked normal', (t) => {
  resetMothVariants();
  withDocument(t);
  t.after(() => { clearSurfaceTextures(); resetMothAssets(); resetMothVariants(); });

  const albedo = Uint8Array.from([5, 15, 25, 255, 35, 45, 55, 255, 65, 75, 85, 255, 95, 105, 115, 255]);
  const normal = Uint8Array.from([128, 128, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255]);
  configureMothAssets(assetsFixture({
    textures: {
      metal: { width: 1, height: 1, data: b64(Uint8Array.from([200, 200, 200, 255])) },
      'metal-oxide': { width: 2, height: 2, data: b64(albedo) },
    },
    normals: { metal: { width: 2, height: 2, data: b64(normal) } },
  }));

  const key = keyFor('metal', 'metal-oxide');
  const maps = surfaceTextures('metal', { seed: 1, size: 32, repeat: [2, 3], variantKey: key });
  assert.ok(maps?.map && maps?.roughnessMap && maps?.normalMap, 'all three maps are produced');

  // Albedo: the baked variant payload byte-for-byte, sRGB, repeating, smooth.
  assert.equal(maps.map.isDataTexture, true, 'the baked variant albedo is the map');
  assert.equal(maps.map.image.width, 2);
  assert.equal(maps.map.image.height, 2);
  assert.deepEqual([...maps.map.image.data], [...albedo], 'the baked tile is used byte-for-byte');
  assert.equal(maps.map.colorSpace, SRGBColorSpace);
  assert.equal(maps.map.wrapS, RepeatWrapping);
  assert.equal(maps.map.wrapT, RepeatWrapping);
  assert.equal(maps.map.repeat.x, 2);
  assert.equal(maps.map.repeat.y, 3);
  assert.equal(maps.map.magFilter, LinearFilter);
  assert.equal(maps.map.minFilter, LinearMipmapLinearFilter);
  assert.equal(maps.map.generateMipmaps, true);
  assert.equal(maps.map.anisotropy, 4);
  assert.equal(maps.map.userData.surfaceKind, 'metal');
  assert.equal(maps.map.userData.source, 'moth-variant');
  assert.equal(maps.map.userData.mothShared, true, 'shared textures are never disposed by the view traversal');
  assert.deepEqual(maps.map.userData.mothVariant, { kind: 'metal', id: 'metal-oxide', source: 'baked' });

  // Roughness: no baked payload exists, so the procedural field stays.
  assert.equal(maps.roughnessMap.isCanvasTexture, true, 'baked variants keep procedural roughness');
  assert.equal(maps.roughnessMap.repeat.x, 2);
  assert.equal(maps.roughnessMap.userData.surfaceKind, 'metal');
  assert.equal(maps.roughnessMap.userData.mothVariant, undefined);
  assert.notEqual(maps.roughnessMap, maps.map, 'albedo and roughness are distinct textures');

  // Normal: the baked normal path is untouched and carries no variant tag.
  assert.equal(maps.normalMap.isDataTexture, true, 'the baked normal is still used');
  assert.equal(maps.normalMap.image.width, 2);
  assert.equal(maps.normalMap.image.height, 2);
  assert.equal(maps.normalMap.repeat.x, 2);
  assert.equal(maps.normalMap.userData.source, 'moth');
  assert.equal(maps.normalMap.userData.mothVariant, undefined);

  // Equal options reuse the entry; a different seed shares the uploaded tile
  // but keeps its own procedural roughness (and is disposed exactly once).
  assert.equal(surfaceTextures('metal', { seed: 1, size: 32, repeat: [2, 3], variantKey: key }), maps, 'equal options reuse the cache entry');
  const again = surfaceTextures('metal', { seed: 9, size: 32, repeat: [2, 3], variantKey: key });
  assert.notEqual(again, maps, 'a different seed keeps its own surface entry');
  assert.equal(again.map, maps.map, 'the baked albedo tile is uploaded once');
  assert.notEqual(again.roughnessMap, maps.roughnessMap, 'procedural roughness stays per surface entry');
  let disposed = 0;
  maps.map.addEventListener('dispose', () => disposed++);
  clearSurfaceTextures();
  assert.equal(disposed, 1, 'the shared baked variant tile is disposed exactly once');
});

test('different surface keys reach different baked variants of one kind', (t) => {
  resetMothVariants();
  withDocument(t);
  t.after(() => { clearSurfaceTextures(); resetMothAssets(); resetMothVariants(); });

  configureMothAssets(assetsFixture({
    textures: {
      'weathered_concrete-worn': { width: 2, height: 2, data: b64(Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255])) },
      'weathered_concrete-damp': { width: 2, height: 2, data: b64(Uint8Array.from([30, 60, 90, 255, 60, 90, 120, 255, 90, 120, 150, 255, 120, 150, 180, 255])) },
    },
  }));

  const seen = new Set();
  for (let i = 0; i < 64; i++) {
    const maps = surfaceTextures('weathered_concrete', {
      seed: 5,
      size: 16,
      repeat: [1, 1],
      variantKey: `arena|weathered_concrete|1x1|panel-${i}`,
    });
    seen.add(maps.map.userData.mothVariant?.id ?? 'original');
  }
  assert.ok(seen.has('weathered_concrete-worn'), 'the worn bake is selectable');
  assert.ok(seen.has('weathered_concrete-damp'), 'the damp bake is selectable');
  assert.ok(
    [...seen].some((id) => ['original', 'worn', 'stained'].includes(id)),
    'generated variants of the same kind stay in the mix',
  );
});

test('a missing baked record falls back silently and a later registry still upgrades', (t) => {
  resetMothVariants();
  withDocument(t);
  t.after(() => { clearSurfaceTextures(); resetMothAssets(); resetMothVariants(); });

  const key = keyFor('metal', 'metal-oxide');
  configureMothAssets(assetsFixture());
  let first;
  assert.doesNotThrow(() => { first = surfaceTextures('metal', { seed: 1, size: 32, repeat: [1, 1], variantKey: key }); });
  assert.ok(first?.map, 'the fallback still produces a surface');
  assert.equal(first.map.userData.mothVariant, undefined, 'the fallback is not tagged as a variant');
  assert.equal(first.roughnessMap.userData.mothVariant, undefined);

  // The same options after the record lands must not hit a poisoned
  // variant-keyed cache entry left behind by the earlier fallback.
  const albedo = Uint8Array.from([7, 17, 27, 255, 37, 47, 57, 255, 67, 77, 87, 255, 97, 107, 117, 255]);
  configureMothAssets(assetsFixture({ textures: { 'metal-oxide': { width: 2, height: 2, data: b64(albedo) } } }));
  const second = surfaceTextures('metal', { seed: 1, size: 32, repeat: [1, 1], variantKey: key });
  assert.equal(second.map.isDataTexture, true, 'the newly landed baked record is picked up');
  assert.deepEqual([...second.map.image.data], [...albedo]);
  assert.deepEqual(second.map.userData.mothVariant, { kind: 'metal', id: 'metal-oxide', source: 'baked' });
  assert.equal(second.roughnessMap.isCanvasTexture, true);
});
