import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ArenaView, BOT_LAYER} from './view.mjs';
import {createFrameWindow, qualitySettings} from './post.mjs';

// Small render-graph fixtures only: no renderer/context, assets, arena builds or
// simulation. The browser harness owns GPU timing and final-image verification.
function layeredView(t) {
  const view = Object.create(ArenaView.prototype);
  const scene = view.scene = new T.Scene();
  const camera = view.camera = new T.PerspectiveCamera(75, 1, .08, 220);
  camera.layers.enable(BOT_LAYER);
  const model = new T.Group();
  const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial());
  mesh.layers.set(BOT_LAYER);model.add(mesh);model.position.z = -5;scene.add(model);
  t.after(() => { mesh.geometry.dispose();mesh.material.dispose(); });
  view.actorModels = new Map([[1, model]]);
  view._botLab = {};view._botTarget = {};view._labDisplayTarget = {};
  view.perf = {};
  const work = { matrices: 0, world: 0, shadow: 0, bot: 0 };
  const update = scene.updateMatrixWorld.bind(scene);
  scene.updateMatrixWorld = (...args) => { work.matrices++;update(...args); };
  view.renderer = { autoClear: true };
  const render = () => { if(scene.matrixWorldAutoUpdate)scene.updateMatrixWorld(); };
  view.composer = { readBuffer: {}, render() { work.world++;render(); } };
  view._refreshBotShadowCasters = () => { work.shadow++;render(); };
  view._renderBotLayer = () => { work.bot++;render(); };
  return { view, model, mesh, work };
}

test('styled world shares one transform update across shadow, world and bot draws', t => {
  const {view, work} = layeredView(t);
  view._renderWorldLayers(true);
  assert.deepEqual(work, { matrices: 1, world: 1, shadow: 1, bot: 1 });
  assert.equal(view.scene.matrixWorldAutoUpdate, true);
  assert.equal(view.perf.botLayer, true);
  assert.equal(view.worldCamera.layers.mask & (1 << BOT_LAYER), 0);
  assert.equal(view.renderer.autoClear, true);
});

test('offscreen and hidden bots skip layer work and reappear without a visibility mutation', t => {
  const {view, model, work} = layeredView(t);
  model.position.x = 100;
  view._renderWorldLayers(true);
  assert.deepEqual(work, { matrices: 1, world: 1, shadow: 0, bot: 0 });
  assert.equal(model.visible, true);
  assert.equal(view.perf.botLayer, false);
  assert.ok(view.worldCamera.layers.mask & (1 << BOT_LAYER), 'normal world draw retains all casters');
  model.position.x = 0;model.visible = false;
  view._renderWorldLayers(true);
  assert.equal(work.bot, 0);
  model.visible = true;
  view._renderWorldLayers(true);
  assert.equal(work.bot, 1);
  assert.equal(work.shadow, 1);
});

test('styled draw restores matrix and clear state even when the composer fails', t => {
  const {view} = layeredView(t);
  view.composer.render = () => { throw new Error('draw failed'); };
  assert.throws(() => view._renderWorldLayers(true), /draw failed/);
  assert.equal(view.scene.matrixWorldAutoUpdate, true);
  assert.equal(view.renderer.autoClear, true);
});

test('stable viewport skips post/target sync while OS reduced-motion changes invalidate it', t => {
  const old = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  t.after(() => { if(old === undefined)delete globalThis.window;else globalThis.window = old; });
  const view = Object.create(ArenaView.prototype);
  let reduced = false, post = 0, targets = 0;
  Object.assign(view, {
    width: 800, height: 450, pixelRatio: 1, _postReduced: false,
    renderer: { domElement: { clientWidth: 800, clientHeight: 450 } },
    reduced: () => reduced, _syncPost: () => post++, _syncLabTargets: () => targets++,
  });
  for(let i = 0; i < 120; i++)view.resize();
  assert.equal(post, 0);assert.equal(targets, 0);
  reduced = true;view.resize();view.resize();
  assert.equal(post, 1);assert.equal(targets, 1);
});

test('intentional 30fps cap preserves quality and resolution but genuinely slow frames shed', () => {
  const view = Object.assign(Object.create(ArenaView.prototype), {
    display: { fpsCap: 30 }, renderer: {}, reduced: () => false,
    quality: 'high', qualitySettings: qualitySettings('high'),
    _drs: { scale: 1, cool: 0 }, _frameWindow: createFrameWindow(), perf: {},
    _onQualityChange() {}, resize() {},
  });
  for(let i = 0; i < 400; i++)view._sampleQuality(1 / 30);
  assert.equal(view.quality, 'high');assert.equal(view._drs.scale, 1);
  assert.ok(Math.abs(view.perf.medianFrameMs - 1000 / 30) < 1e-9);
  for(let i = 0; i < 120; i++)view._sampleQuality(.05);
  assert.notEqual(view.quality, 'high');assert.ok(view._drs.scale < 1);
  const scale = view._drs.scale;
  view._sampleQuality(10);
  assert.equal(view._drs.scale, scale, 'suspend gaps do not drop resolution');
});

test('display changes still sync post when the pixel cap makes a scale change a sizing no-op', t => {
  const old = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  t.after(() => { if(old === undefined)delete globalThis.window;else globalThis.window = old; });
  let post = 0, targets = 0;
  const view = Object.assign(Object.create(ArenaView.prototype), {
    width: 3840, height: 2160, pixelRatio: .5, _postReduced: false,
    renderer: { domElement: { clientWidth: 3840, clientHeight: 2160 } },
    display: { resolutionScale: 1, resolutionCap: 'auto' },
    camera: { updateProjectionMatrix() {} }, reduced: () => false,
    _applyQuality() {}, _applyShadows() {}, _applyEffectsQuality() {},
    _syncPost: () => post++, _syncLabTargets: () => targets++,
  });
  view.setDisplay({ resolutionScale: 1.5, resolutionCap: 'auto', bloom: 0 });
  assert.equal(view.pixelRatio, .5, 'the 1080p pixel budget still caps a 4K canvas');
  assert.equal(post, 1);assert.equal(targets, 1);
});

test('drawn-frame lab sampling includes cap carry and excludes preview-only frames', () => {
  const samples = [];
  const view = Object.assign(Object.create(ArenaView.prototype), {
    display: { fpsCap: 30 }, renderer: {}, _labDrawnLast: true,
    _renderAt: performance.now(), _sampleLabBudget: dt => samples.push(dt),
    _renderFrame() {}, _capturePerf() {},
  });
  assert.equal(view.render('playing', {}, .02, 1), false);
  view._renderAt = -1e9;
  view.render('playing', {}, .02, 1);
  assert.deepEqual(samples, [.04]);
  view._renderAt = -1e9;
  view.render('selection', null, .02, 1);
  assert.deepEqual(samples, [.04], 'a preview frame cannot trigger restoration');
});

test('previews skip hidden/unmounted/offscreen work, clip without shifting, and restore on failure', () => {
  const view = Object.assign(Object.create(ArenaView.prototype), { width: 800, height: 450 });
  const calls = [];
  const renderer = view.renderer = {
    autoClear: false,
    setScissorTest: (...args) => calls.push(['test', ...args]),
    setViewport: (...args) => calls.push(['viewport', ...args]),
    setScissor: (...args) => calls.push(['scissor', ...args]),
    render: () => { throw new Error('preview failed'); },
  };
  const rect = view.previewRect = { left: -40, bottom: 200, width: 320, height: 180 };
  view.preview = { model: {}, pivot: { visible: false } };
  assert.equal(view.renderWeaponPreview(), false);
  view.preview.pivot.visible = true;view.preview.model = null;
  assert.equal(view.renderWeaponPreview(), false);
  assert.equal(view._renderSceneInto(renderer, {...rect, left: 900}, {}, {}), false);
  assert.equal(calls.length, 0);
  assert.throws(() => view._renderSceneInto(renderer, rect, {}, {}), /preview failed/);
  assert.deepEqual(calls[1], ['viewport', -40, 250, 320, 180], 'partial clipping retains the authored framing');
  assert.equal(renderer.autoClear, false);
  assert.deepEqual(calls.at(-3), ['test', false]);
  assert.deepEqual(calls.at(-2), ['viewport', 0, 0, 800, 450]);
});
