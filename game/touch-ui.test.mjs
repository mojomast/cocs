import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {TOUCH_BUTTONS,applyTouchAction,touchDisplay,touchTargetSize,TOUCH_TARGET_MIN} from './touch.mjs';

async function loadTouchControls(){
  const file = new URL('../app/game-ui/touch-controls.tsx', import.meta.url);
  const source = await readFile(file, 'utf8');
  // Render the actual TSX without requiring a production build or a browser.
  const {outputText} = ts.transpileModule(source, {compilerOptions:{jsx:ts.JsxEmit.ReactJSX, module:ts.ModuleKind.ESNext}});
  const executable = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, specifier) =>
    `from ${quote}${specifier.startsWith('.') ? new URL(specifier, file).href : import.meta.resolve(specifier)}${quote}`);
  return import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
}

test('the rendered touch cluster includes every action, including grenade', async () => {
  const {TouchControls} = await loadTouchControls();
  const props = {runtime:{current:{}}, visible:true, onLook(){}, onSwap(){}, onPause(){}};
  const html = renderToStaticMarkup(createElement(TouchControls, props));
  for (const action of TOUCH_BUTTONS) assert.ok(html.includes(`touch-button touch-${action}"`), `${action} is rendered`);
  assert.match(html, /aria-label="GRENADE"/);
  assert.match(html, /aria-label="MOBILITY"/);
  assert.equal(renderToStaticMarkup(createElement(TouchControls, {...props, visible:false})), '');
});

test('the rendered soccer cluster exposes boost, brake and reset without combat actions', async () => {
  const {TouchControls} = await loadTouchControls();
  const props = {runtime:{current:{}}, visible:true, mode:'puma-soccer', onLook(){}, onSwap(){}, onPause(){}};
  const html = renderToStaticMarkup(createElement(TouchControls, props));
  for (const label of ['BOOST','BRAKE','RESET']) assert.ok(html.includes(label), `${label} is rendered`);
  for (const action of ['fire','ads','reload','swap','grenade','melee','jump','mobility']) assert.ok(!html.includes(`touch-${action}`), `${action} is hidden`);
});

test('touch display settings become CSS variables, a left-hand class and scaled stick metrics', async () => {
  const view = touchDisplay({touchScale:1.3, touchOpacity:.5, touchLeftHanded:true});
  assert.equal(view.scale, 1.3);
  assert.equal(view.opacity, .5);
  assert.equal(view.leftHanded, true);
  assert.equal(view.className, 'touch-layer--left-hand');
  assert.equal(view.style['--touch-scale'], '1.3');
  assert.equal(view.style['--touch-opacity'], '0.5');
  assert.equal(view.metrics.stickRadius, Math.round(66 * 1.3));
  assert.ok(view.metrics.knobRadius >= 20);
  assert.ok(view.metrics.lookTravel > 0);
  // The pure clamp table backs legacy/garbage saves.
  const clamped = touchDisplay({touchScale:9, touchOpacity:-1, touchLeftHanded:1});
  assert.equal(clamped.scale, 1.3);
  assert.equal(clamped.opacity, .4);
  assert.equal(clamped.leftHanded, false);
  assert.equal(touchDisplay().scale, 1);
  assert.equal(touchDisplay(null).opacity, 1, 'a missing display reads the default layout');
  // The hard 44px target floor survives the 0.8x scale stop.
  assert.equal(TOUCH_TARGET_MIN, 44);
  assert.equal(touchTargetSize(46, .8), 44);
  assert.equal(touchTargetSize(40, .8), 44);
  assert.equal(touchTargetSize(74, .8), 59);
});

test('the rendered touch layer carries the display variables and the left-hand class', async () => {
  const {TouchControls} = await loadTouchControls();
  const props = {runtime:{current:{}}, visible:true, onLook(){}, onSwap(){}, onPause(){}};
  const html = renderToStaticMarkup(createElement(TouchControls, {...props, display:{touchScale:1.3, touchOpacity:.5, touchLeftHanded:true}}));
  assert.match(html, /class="touch-layer[^"]*touch-layer--left-hand/);
  assert.match(html, /--touch-scale:1\.3/);
  assert.match(html, /--touch-opacity:0\.5/);
  const clamped = renderToStaticMarkup(createElement(TouchControls, {...props, display:{touchScale:9, touchOpacity:-1, touchLeftHanded:false}}));
  assert.match(clamped, /--touch-scale:1\.3/);
  assert.match(clamped, /--touch-opacity:0\.4/);
  assert.doesNotMatch(clamped, /touch-layer--left-hand/);
});

test('the touch layer passes the hold-vs-toggle prefs without changing the rendered cluster', async () => {
  const source = await readFile(new URL('../app/game-ui/touch-controls.tsx', import.meta.url), 'utf8');
  assert.match(source, /const togglePrefs=\{adsToggle:display\?\.adsToggle===true,crouchToggle:display\?\.crouchToggle===true\}/, 'the live display prefs are read once');
  assert.match(source, /applyTouchAction\(runtime\.current,action,true,togglePrefs\)/, 'presses latch through the shared handler');
  assert.match(source, /applyTouchAction\(runtime\.current,action,false,togglePrefs\)/, 'releases leave a latch in place');
  const {TouchControls} = await loadTouchControls();
  const props = {runtime: {current: {}}, visible: true, onLook() {}, onSwap() {}, onPause() {}};
  const off = renderToStaticMarkup(createElement(TouchControls, {...props, display: {adsToggle: false, crouchToggle: false}}));
  const on = renderToStaticMarkup(createElement(TouchControls, {...props, display: {adsToggle: true, crouchToggle: true}}));
  assert.equal(on, off, 'the prefs are additive: the cluster is identical for either value');
});

test('toggle prefs latch touch ADS and crouch while release leaves them held', () => {
  const runtime = {display: {adsToggle: true, crouchToggle: true}};
  applyTouchAction(runtime, 'ads', true);
  assert.equal(runtime.touch.ads, true, 'a press arms the latched ADS');
  applyTouchAction(runtime, 'ads', false);
  assert.equal(runtime.touch.ads, true, 'release does not clear a latched ADS');
  applyTouchAction(runtime, 'ads', true);
  assert.equal(runtime.touch.ads, false, 'a second press turns it off again');
  applyTouchAction(runtime, 'crouch', true);
  applyTouchAction(runtime, 'crouch', false);
  assert.equal(runtime.touch.crouch, true, 'crouch latches the same way');
  applyTouchAction(runtime, 'crouch', true);
  assert.equal(runtime.touch.crouch, false);
  // The prefs default off: bare and explicit-off runtimes keep held behavior.
  const held = {};
  applyTouchAction(held, 'ads', true);
  applyTouchAction(held, 'ads', false);
  assert.equal(held.touch.ads, false, 'a bare runtime keeps the shipped held ADS');
  const off = {display: {adsToggle: false, crouchToggle: false}};
  applyTouchAction(off, 'crouch', true);
  applyTouchAction(off, 'crouch', false);
  assert.equal(off.touch.crouch, false, 'an explicit off keeps the shipped held crouch');
  // The touch layer may pass the live prefs directly instead of the synced display.
  const explicit = {};
  applyTouchAction(explicit, 'ads', true, {adsToggle: true});
  applyTouchAction(explicit, 'ads', false, {adsToggle: true});
  assert.equal(explicit.touch.ads, true, 'explicit prefs latch on press and survive release');
});

test('the touch stylesheet mirrors the left-hand layout and keeps a 44px floor', async () => {
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.touch-layer\s*\{[^}]*opacity: var\(--touch-opacity,1\)/, 'opacity is a layer-level variable');
  assert.match(css, /\.touch-button\s*\{[^}]*width: max\(44px, calc\(46px \* var\(--touch-scale,1\)\)\)/, 'the base button floors at 44px');
  assert.match(css, /\.touch-util \.touch-button\s*\{[^}]*width: max\(44px, calc\(42px \* var\(--touch-scale,1\)\)\)/, 'the utility buttons floor at 44px');
  assert.match(css, /width: max\(44px, calc\(40px \* var\(--touch-scale,1\)\)\)/, 'the short-landscape button floors at 44px');
  for (const selector of ['.touch-layer--left-hand .touch-move-zone','.touch-layer--left-hand .touch-look','.touch-layer--left-hand .touch-actions','.touch-layer--left-hand .touch-primary','.touch-layer--left-hand .touch-util']) {
    assert.ok(css.includes(selector), `${selector} mirrors the layout`);
  }
});
