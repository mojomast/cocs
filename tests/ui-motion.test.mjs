// UI motion contract: the in-game reduced-motion toggle must gate the same
// animations/transitions as the OS query, the new overlay entrances must stay
// short and reduced-aware, and the known regressions (hard-coded HUD flag,
// orphaned title keyframe, unguarded low-health pulse / Radix keyframes) stay
// fixed. Pure source/CSS checks plus one SSR render of the real HUD.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

register('./tsx-loader.mjs', import.meta.url);
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier,context,nextResolve){try{return await nextResolve(specifier,context);}catch(error){if(!specifier.startsWith('.'))throw error;for(const ext of ['.tsx','.ts']){try{return await nextResolve(specifier+ext,context);}catch{}}throw error;}}`)}`);
// The training HUD imports a CSS module; Node has no CSS loader, so stub it.
register(`data:text/javascript,${encodeURIComponent(`export async function load(url,context,nextLoad){if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true};return nextLoad(url,context);}`)}`);

const {PlayingHud} = await import('../app/ui/screens/PlayingHud.tsx');
const {damageNumberStyle} = await import('../game/hud.mjs');

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A `.motion-reduced` selector twin that disables the same animation.
const classGate = (css, selector) => new RegExp(`\\.motion-reduced[^{}]*${escape(selector)}[^{}]*\\{[^}]*animation:\\s*none`).test(css);
// The matching OS-query gate, wherever it sits in the sheet. Brace matching
// keeps the check inside each reduced-motion block (a media block can hold
// several rules).
const motionMediaBlocks = css => {
  const blocks = [];
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  let match;
  while ((match = re.exec(css))) {
    let depth = 1, index = re.lastIndex;
    for (; index < css.length && depth > 0; index++) {
      if (css[index] === '{') depth++;
      else if (css[index] === '}') depth--;
    }
    blocks.push(css.slice(re.lastIndex, index));
  }
  return blocks;
};
const mediaGate = (css, selector) => motionMediaBlocks(css).some(block => new RegExp(`${escape(selector)}[^{}]*\\{[^}]*animation:\\s*none`).test(block));

const UI_CSS = 'app/styles/ui.css';
const GLOBALS_CSS = 'app/globals.css';

test('the app root carries motion-reduced for the in-game toggle and the OS query', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /const \[osReducedMotion,setOsReducedMotion\]=useState\(false\)/, 'the OS preference is sampled into state, never during render');
  assert.match(page, /const motionReduced=display\.reducedMotion===true\|\|osReducedMotion/, 'the in-game toggle and the OS query combine');
  assert.match(page, /document\.documentElement\.classList\.toggle\('motion-reduced',motionReduced\)/, 'portalled surfaces get the class on <html>');
  assert.match(page, /className=\{`arena-app\$\{motionReduced\?' motion-reduced':''\}/, 'the class is rendered on the app root');
});

test('every OS animation gate has an in-game motion-reduced twin', async () => {
  const [ui, globals] = await Promise.all([read(UI_CSS), read(GLOBALS_CSS)]);
  const matrix = [
    [globals, ['radar-sweep', 'hitmarker.hit', 'ammo-warning.pulse', 'damage-direction', 'damage-flash', 'kill-banner', 'kill-callout', 'objective-announcer', 'title-pulse', 'title-screen', 'title-letter', 'kill-feed>div', 'stat-card--vitals.is-low', 'ability-card.is-ready']],
    [ui, ['logo-letter', 'logo-glyph::after', 'spin-slow', 'demo-broadcast', 'demo-broadcast__track']],
  ];
  for (const [css, selectors] of matrix) {
    for (const selector of selectors) {
      assert.ok(mediaGate(css, selector), `the OS query still disables ${selector}`);
      assert.ok(classGate(css, selector), `${selector} is disabled by the in-game toggle too`);
    }
  }
  // The spend banner rides the whole-surface wildcard gate in both paths.
  assert.ok(motionMediaBlocks(globals).some(block => /\.cocs-spend\s*\*[^{}]*\{[^}]*animation:\s*none!important/.test(block)), 'the OS query disables the whole spend surface');
  assert.match(globals, /\.motion-reduced \.cocs-spend[^{}]*\{[^}]*animation:none!important/, 'the in-game toggle disables the whole spend surface');
});

test('every OS transition gate has an in-game motion-reduced twin', async () => {
  const [ui, globals] = await Promise.all([read(UI_CSS), read(GLOBALS_CSS)]);
  const matrix = [
    [globals, ['reload-track > i', 'hud-bar>i', 'cocs-interact', 'cocs-verb']],
    [ui, ['btn', 'meter > i', 'mission-select', 'achievement-row']],
  ];
  for (const [css, selectors] of matrix) {
    for (const selector of selectors) {
      const twin = new RegExp(`\\.motion-reduced[^{}]*${escape(selector)}[^{}]*\\{[^}]*transition:\\s*none`).test(css);
      assert.ok(twin, `${selector} transitions are cut by the in-game toggle too`);
    }
  }
});

test('dialogs, toasts, notices and menu screens gain short reduced-aware entrances', async () => {
  const ui = await read(UI_CSS);
  for (const keyframe of ['ui-fade-in', 'ui-toast-in', 'ui-toast-out', 'ui-notice-in']) {
    assert.ok(ui.includes(`@keyframes ${keyframe}{`), `${keyframe} is defined`);
  }
  const entrances = [
    '.modal:not(.modal--hidden){animation:ui-fade-in',
    '.modal:not(.modal--hidden) .modal-panel{animation:ui-fade-in',
    '.unlock-toast,.achievement-toast{animation:ui-toast-in',
    '.graphics-hotkey-notice,.cocs-notice{animation:ui-notice-in',
    '.cocs-notice.is-leaving{animation:ui-toast-out',
    '.sp-notice{animation:ui-fade-in',
    '.title-stage,.shell--showcase:not(.shell--awaiting){animation:ui-fade-in',
  ];
  for (const entrance of entrances) assert.ok(ui.includes(entrance), `${entrance} planned`);
  // The entrances themselves are gated by both paths.
  const gateBlock = ui.slice(ui.lastIndexOf('@media (prefers-reduced-motion:reduce){'));
  const motionBlock = ui.slice(ui.lastIndexOf('.motion-reduced .modal:not(.modal--hidden)'));
  for (const selector of ['.modal:not(.modal--hidden)', '.unlock-toast', '.achievement-toast', '.graphics-hotkey-notice', '.cocs-notice', '.cocs-notice.is-leaving', '.sp-notice', '.title-stage', '.shell--showcase:not(.shell--awaiting)']) {
    assert.ok(gateBlock.includes(selector), `${selector} entrance is cut under the OS query`);
    assert.ok(motionBlock.includes(selector), `${selector} entrance is cut by the in-game toggle`);
  }
  // Phones lay toasts out un-centred, so the slide is dropped there.
  assert.match(ui, /@media \(max-width:720px\)\{\s*\.unlock-toast,\.achievement-toast\{animation-name:ui-fade-in\}/, 'mobile toasts only fade');
});

test('the title screen keyframe exists instead of dangling', async () => {
  const globals = await read(GLOBALS_CSS);
  assert.match(globals, /@keyframes fadeIn\{from\{opacity:0\}to\{opacity:1\}\}/, 'fadeIn is defined');
  assert.match(globals, /\.title-screen\{[^}]*animation:fadeIn/, 'the title screen still uses it');
});

test('the Radix select enter/exit keyframes are gated', async () => {
  const ui = await read(UI_CSS);
  assert.ok(ui.includes('[data-slot="select-content"][data-state]{animation:none!important}'), 'the portal surface is gated');
  assert.ok(ui.includes('.motion-reduced [data-slot="select-content"][data-state]{animation:none!important}'), 'the in-game toggle reaches the portal');
});

test('the HUD passes the real reduced-motion value and keeps damage numbers bounded', async () => {
  const hud = await read('app/ui/screens/PlayingHud.tsx');
  assert.match(hud, /<CocsTerminalsHud terminals=\{command\.terminals\} reducedMotion=\{reducedMotion\}/, 'terminals receive the live value');
  assert.doesNotMatch(hud, /reducedMotion\/>/, 'no hard-coded always-reduced flag remains');
  assert.match(hud, /<CocsReadout command=\{cocsCommand\} teamName=\{teamName\} player=\{player\} reducedMotion=\{reducedMotion\(\)\}/, 'the readout resolves the live value once');
  assert.match(hud, /const reduced=reducedMotion\(\);/, 'damage numbers resolve the live value');
  assert.match(hud, /const emphasis=n\.critical\|\|n\.kill\?1\.35:1/, 'criticals/kills rise further');
  assert.match(hud, /const pop=reduced\|\|fade\.done\?1:/, 'the scale pop is bounded and reduced-aware');
  assert.match(hud, /n\.kill\?\.05:\.07/, 'the pop amount is bounded');

  const page = await read('app/page.tsx');
  assert.match(page, /const leaving=setTimeout\(\(\)=>setCocsNotice\(\(notice:any\)=>notice\?\{\.\.\.notice,leaving:true\}:notice\),4050\)/, 'the notice is marked leaving before unmount');
  assert.match(page, /const clear=setTimeout\(\(\)=>setCocsNotice\(null\),4200\)/, 'unmount keeps the existing 4.2s beat');
  assert.match(hud, /notice\.leaving\?' is-leaving'/, 'the leaving class reaches the notice');
});

// ---------------------------------------------------------------------------
// SSR: the real HUD renders the bounded emphasis, and the reduced path drops
// both the scale pop and the rise without touching the damage-number contract.
// ---------------------------------------------------------------------------
const player = (overrides = {}) => ({
  id: 0, name: 'CHATGPT', team: 0, character: 'chatgpt', harness: 'openclaw',
  health: 100, maxHealth: 100, armor: 50, frags: 3, deaths: 0, weapon: 0,
  ammo: {0: 30}, dead: 0, slow: 0, powerups: {}, cooldown: 0, protection: 0,
  streak: 0, grenadeCooldown: 0, movement: null, scoreStats: {}, isVip: false, ladder: 0,
  ...overrides,
});
const hud = (overrides = {}) => ({
  time: 12.3, mapName: 'Colosseum', modeName: 'Deathmatch', route: 'ARENA',
  config: {timeLimit: 300, botCount: 0, fragLimit: 25, mode: 'deathmatch', startingWeapon: 0},
  net: false, spectate: false, actors: [player()], actorId: 0, feed: [], objectives: null,
  teamScores: {0: 0, 1: 0}, quality: null, fps: 60, renderer: 'webgl', pickup: '',
  over: false, suddenDeath: false, damageNumbers: [], captureNotice: null,
  ...overrides,
});
const ui = (overrides = {}) => ({
  hud: hud(), player: player(), display: {showKillFeed: true, showRadar: true, showDamageNumbers: true},
  brief: {title: 'HUNT THE NEXT TOKEN', action: 'Find an angle and secure the next frag.', detail: 'FIRST TO 25 FRAGS', status: '3 / 25'},
  phase: 'OPENING', hudRoute: 'ARENA', hudMap: {}, hudMode: {id: 'deathmatch'},
  isTeamMode: () => false, teamName: team => (Number(team) === 0 ? 'RED' : 'BLUE'), modeGoal: () => 'FRAGS',
  ladderStatus: () => ({rung: 0, label: 'LADDER 1/10'}), flagText: () => '', armsrace: false,
  WEAPONS: [{name: 'RAIL', cap: 10, interval: .8, ammo: 10, short: 'RAIL'}], activePower: null,
  powerIcon: () => null, radar: {contacts: []}, radarCols: {}, radarBlip: () => null,
  marker: null, reloadFill: 0, reloading: false, posture: null, killNotice: null,
  suddenBanner: null, startBanner: null, scoreCue: null, damageIndicator: null,
  damageNumberStyle, reducedMotion: () => false,
  vehiclePrompt: '', vehicle: null, ammoEmpty: false, ammoLow: false, hideHud: false,
  touchControls: false, pointerHint: false, requestLock: () => {}, chatOpen: false,
  isSingle: false, single: null, selectHordeUpgrade: () => {}, resumeSingleplayer: () => {},
  spectatorTeams: () => [], CAMERA_MODE_LABELS: {}, runtime: {current: null},
  changeMode: () => {}, grenadeStatus: () => ({ready: true, cooldown: 0, label: 'FRAG READY'}),
  streakStatus: () => null, killFeedWeapon: () => null, voiceState: {enabled: false, mode: 'ptt'},
  voiceHint: () => null, escapeHint: () => 'ESC / PAUSE', clock: () => '4:47',
  teamScoreText: () => '', ammoText: value => String(value), weaponTag: () => null, cocsCommand: null,
  cursor: {active: false, key: 'ALT', blocked: false, label: '', resume: () => {}},
  bindings: {},
  ...overrides,
});

test('SSR: damage numbers keep a bounded pop, and reduced motion drops it and the rise', () => {
  const born = performance.now();
  const numbers = [
    {id: 'hit-1', amount: 24, x: 100, y: 120, born, critical: false, kill: false},
    {id: 'crit-1', amount: 72, x: 140, y: 90, born, critical: true, kill: false},
  ];
  const normal = render(PlayingHud, {ui: ui({hud: hud({damageNumbers: numbers})})});
  assert.match(normal, /class="damage-number critical"/, 'the critical row still renders');
  assert.match(normal, /scale\(1\.0\d\d\)/, 'motion-allowed rows settle with a bounded scale pop');
  assert.match(normal, /translateY\(-\d+(\.\d+)?px\)/, 'motion-allowed rows rise');

  const reduced = render(PlayingHud, {ui: ui({hud: hud({damageNumbers: numbers}), reducedMotion: () => true})});
  assert.doesNotMatch(reduced, /scale\(/, 'reduced motion skips the scale pop');
  assert.match(reduced, /translateY\(0px\)/, 'reduced motion skips the rise');
});
