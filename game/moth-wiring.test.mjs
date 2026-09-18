import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView, mothAtmosphereFor, mothSpaceFor, mothEchoFor} from './view.mjs';
import {MAPS} from './maps.mjs';
import {DEFAULT_DISPLAY} from './config.mjs';
import {ModelAssets} from './effects-fx.mjs';
import {mothEffectTextures, mothMaterialLutTexture, clearSurfaceTextures} from './textures.mjs';
import {configureMothAssets, resetMothAssets} from './moth-assets.mjs';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

const fixture = () => ({
  version: 1,
  textures: {},
  normals: {},
  materials: { entanglement: { size: 2, r: b64(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), t: b64(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4])) } },
  sky: { void: { width: 2, height: 2, equirect: true, data: b64(Uint8Array.from([5, 10, 20, 255, 6, 11, 21, 255, 7, 12, 22, 255, 8, 13, 23, 255])) } },
  effects: {
    'spark-impact': { fps: 14, frames: [
      { width: 2, height: 2, data: b64(Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255])) },
      { width: 2, height: 2, data: b64(Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255])) },
    ] },
  },
  levels: {}, seeds: {}, motifs: {},
});

test('map atmospheres pick the baked sky by theatre and leave the rest procedural', () => {
  assert.equal(mothAtmosphereFor('ember-caldera'), 'ashen');
  assert.equal(mothAtmosphereFor('slagworks'), 'ashen');
  assert.equal(mothAtmosphereFor('forge'), 'ashen');
  assert.equal(mothAtmosphereFor('ashen-rift'), 'ashen');
  assert.equal(mothAtmosphereFor('frostline'), 'frost');
  assert.equal(mothAtmosphereFor('frost-gate'), 'frost');
  assert.equal(mothAtmosphereFor('neon-vertical'), 'void');
  assert.equal(mothAtmosphereFor('aether'), 'void');
  assert.equal(mothAtmosphereFor('substation'), 'void');
  assert.equal(mothAtmosphereFor('derelict-station'), 'void');
  assert.equal(mothAtmosphereFor('ironfall-megastructure'), 'void');
  assert.equal(mothAtmosphereFor('moth-backrooms'), 'void');
  assert.equal(mothAtmosphereFor('exchange'), null, 'unlisted maps keep addSky');
  assert.equal(mothAtmosphereFor(undefined), null);
});

test('map spaces pick the baked reverb by room and default to open-air', () => {
  assert.equal(mothSpaceFor('moth-backrooms'), 'cavern');
  assert.equal(mothSpaceFor('catacombs'), 'tunnel');
  assert.equal(mothSpaceFor('substation'), 'tunnel');
  assert.equal(mothSpaceFor('atrium'), 'cathedral');
  assert.equal(mothSpaceFor('colosseum'), 'hall');
  assert.equal(mothSpaceFor('derelict-station'), 'hall');
  assert.equal(mothSpaceFor('blood-gulch'), 'open-air', 'outdoor maps default to open-air');
  assert.equal(mothSpaceFor(undefined), 'open-air');
  // The void theatres fill the sixth baked space, so every IR has a map.
  assert.equal(mothSpaceFor('neon-vertical'), 'void');
  assert.equal(mothSpaceFor('aether'), 'void');
  assert.equal(mothSpaceFor('ironfall-megastructure'), 'void');
  const reachable = new Set(['open-air', 'tunnel', 'hall', 'cathedral', 'cavern', 'void'].map(id => mothSpaceFor({ 'open-air': 'blood-gulch', tunnel: 'catacombs', hall: 'colosseum', cathedral: 'atrium', cavern: 'moth-backrooms', void: 'neon-vertical' }[id])));
  assert.equal(reachable.size, 6, 'all six baked spaces are selected by some arena');
});

test('map echo maps default to the baked arena send', () => {
  assert.equal(mothEchoFor('blood-gulch'), 'arena');
  assert.equal(mothEchoFor('moth-backrooms'), 'arena');
  assert.equal(mothEchoFor(undefined), 'arena');
});

test('_mothFx prefers a dedicated sequence and falls back to the old cue', () => {
  const base = fixture();
  const frame = { width: 2, height: 2, data: b64(Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255])) };
  configureMothAssets({ ...base, effects: { ...base.effects, 'effect-explosion': { fps: 14, frames: [frame] } } });
  try {
    const scene = new T.Scene();
    const view = Object.assign(Object.create(ArenaView.prototype), { scene, renderer: { isSoftware: false }, reduced: () => false });
    const dedicated = view._mothFx('effect-explosion', 'arc-burst', { x: 0, y: 0, z: 0 }, { slots: 2, life: 0.3 });
    assert.ok(dedicated && dedicated.mesh.parent === scene, 'the dedicated sequence spawns');
    // A missing sequence falls back to the caller's existing cue, not nothing.
    const fallback = view._mothFx('missing-effect', 'spark-impact', { x: 0, y: 0, z: 0 }, { slots: 2, life: 0.3 });
    assert.ok(fallback && fallback.mesh.parent === scene, 'the fallback cue still spawns');
    assert.equal(view._mothSpriteCache.get('missing-effect'), null, 'a missing sheet is cached as null');
    view._disposeMothSprites();
  } finally {
    resetMothAssets();
    clearSurfaceTextures();
  }
});

test('effect frames and LUTs are shared caches marked for the disposal traversal', () => {
  configureMothAssets(fixture());
  try {
    const effect = mothEffectTextures('spark-impact');
    assert.ok(effect && effect.textures.length === 2);
    assert.equal(mothEffectTextures('spark-impact'), effect, 'frames are cached per name');
    for (const frame of effect.textures) assert.equal(frame.userData.mothShared, true);
    const lut = mothMaterialLutTexture('entanglement');
    assert.ok(lut);
    assert.equal(mothMaterialLutTexture('entanglement'), lut, 'the same LUT is shared');
    assert.equal(lut.userData.mothShared, true);
    clearSurfaceTextures();
    assert.notEqual(mothEffectTextures('spark-impact'), effect, 'clearing the surface cache drops the frames');
    assert.notEqual(mothMaterialLutTexture('entanglement'), lut, 'clearing the surface cache drops the LUT');
  } finally {
    resetMothAssets();
    clearSurfaceTextures();
  }
});

test('disposeObject never releases a shared Moth texture', () => {
  const shared = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  shared.userData.mothShared = true;
  const owned = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  let sharedDisposed = 0, ownedDisposed = 0;
  shared.addEventListener('dispose', () => sharedDisposed++);
  owned.addEventListener('dispose', () => ownedDisposed++);
  const group = new T.Group();
  group.add(new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shared })));
  group.add(new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: owned })));
  ArenaView.prototype.disposeObject.call({}, group);
  assert.equal(sharedDisposed, 0, 'the shared cache texture survives object disposal');
  assert.equal(ownedDisposed, 1, 'an object-owned texture is still released');
});

test('the view swaps the sky material and plays/disposes baked sprites', () => {
  configureMothAssets(fixture());
  try {
    const scene = new T.Scene();
    const view = Object.assign(Object.create(ArenaView.prototype), {
      scene,
      renderer: { isSoftware: false },
      reduced: () => false,
    });
    // Atmosphere: the generated gradient is replaced, the mesh itself kept.
    const skyMesh = { material: new T.MeshBasicMaterial(), userData: {} };
    view.sky = skyMesh;
    assert.equal(view._applyMothAtmosphere('void'), skyMesh);
    assert.equal(skyMesh.material.map?.userData.mothSky, 'void');
    assert.equal(skyMesh.userData.mothAtmosphere, 'void');
    assert.equal(view._applyMothAtmosphere('missing'), null, 'unknown atmospheres leave the dome alone');
    // Sprite pool: created lazily, parented to the scene, shared frames intact.
    assert.equal(view._mothSprite('spark-impact', { slots: 2 }), view._mothSprite('spark-impact', { slots: 2 }));
    const slot = view._spawnMothSprite('spark-impact', { x: 1, y: 1, z: 1 }, { size: 0.5, life: 0.3 });
    assert.ok(slot && slot.mesh.parent === scene, 'sprites parent into the scene');
    assert.equal(view._updateMothSprites(0.05, { quaternion: new T.Quaternion() }), 1);
    view._clearMothSprites();
    assert.equal(view._updateMothSprites(0.05, null), 0);
    assert.equal(view._disposeMothSprites(), 1, 'one player was cached and released');
    assert.equal(view._mothSprite('spark-impact', { slots: 2 }) !== null, true, 'a fresh pool can be built');
    view._disposeMothSprites();
  } finally {
    resetMothAssets();
    clearSurfaceTextures();
  }
});

test('LUT materials are a WebGL-only opt-in', () => {
  configureMothAssets(fixture());
  try {
    const software = Object.assign(Object.create(ArenaView.prototype), { renderer: { isSoftware: true } });
    assert.equal(software._mothLutMaterial('entanglement'), null);
    const plain = Object.assign(Object.create(ArenaView.prototype), { renderer: { isSoftware: false } });
    assert.equal(plain._mothLutMaterial('entanglement'), null, 'a non-WebGL renderer keeps the flat material');
    const webgl = Object.assign(Object.create(ArenaView.prototype), { renderer: { isSoftware: false, isWebGLRenderer: true }, renderResources: new Set() });
    const material = webgl._mothLutMaterial('entanglement', { base: { color: '#102030' } });
    assert.ok(material && material.userData.moth === true, 'WebGL gets the iridescent material');
    assert.equal(webgl._mothLutMaterial('entanglement', { track: true }).userData.moth, true);
    assert.equal(webgl.renderResources.size, 1, 'tracked LUT materials join the arena resource set');
  } finally {
    resetMothAssets();
    clearSurfaceTextures();
  }
});

test('next-gen props, tunnels and race surfaces pick up the baked maps', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillText() {}, fillRect() {}, strokeText() {}, measureText: () => ({ width: 4 }) };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  configureMothAssets(fixture());
  try {
    const view = Object.assign(Object.create(ArenaView.prototype), {
      scene: new T.Scene(), renderResources: new Set(), sharedResources: new Set(), modelAssets: new ModelAssets(),
      renderer: { isSoftware: false }, display: { ...DEFAULT_DISPLAY }, reduced: () => false,
    });
    view.buildArena(MAPS.find(map => map.id === 'frost-gate'));
    const kinds = new Set();
    let tunnelUv = false;
    view.worldGroup.traverse(node => {
      if (!node.isMesh) return;
      const kind = node.material?.map?.userData?.surfaceKind;
      if (kind) kinds.add(kind);
      if (node.userData.tunnelShell && node.geometry?.attributes?.uv) tunnelUv = true;
    });
    assert.ok(kinds.has('rock'), 'rocks/props carry the rock bake');
    assert.ok(kinds.has('alien_chitin'), 'tree canopies carry the organic chitin bake');
    assert.ok(kinds.has('rough_stucco'), 'next-gen structure walls carry the stucco bake');
    assert.ok(tunnelUv, 'tunnel shells generate world-unit UVs for their rock map');
    // Race and soccer presentation share the same helper through options.surface.
    view.buildArena(MAPS.find(map => map.id === 'puma-pitch'));
    const raceKinds = new Set();
    view.worldGroup.traverse(node => { if (node.isMesh && node.material?.map) raceKinds.add(node.material.map.userData.surfaceKind); });
    assert.ok(raceKinds.has('grass'), 'the soccer pitch carries the grass bake');
    assert.ok(raceKinds.has('brushed_metal'), 'goal frames carry the brushed-metal bake');
    assert.ok(raceKinds.has('hazard_stripes'), 'race barriers carry the caution-stripe bake');
    view.disposeObject(view.worldGroup);
    for (const resource of view.renderResources) resource.dispose();
    view._disposeMothSprites();
    clearSurfaceTextures();
  } finally {
    resetMothAssets();
    clearSurfaceTextures();
  }
});
