// WP2.1 — results/portrait reflow and the one-modal stack.
//
// The SSR checks render the real primitives, the real Results/Pause dialogs and
// the real SettingsDialog through the same tsx loader the results test uses.
// The footer geometry matrix and focus restoration run in headless Chromium
// (the tracked Playwright dependency); when that browser is unavailable the
// geometry test skips and the always-on CSS-contract guard still runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
 resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
   for (const ext of ['.tsx', '.ts', '.mjs', '.js']) {
    try { return nextResolve(specifier + ext, context); } catch {}
   }
  }
  return nextResolve(specifier, context);
 },
 load(url, context, nextLoad) {
  if (url.endsWith('.tsx') || url.endsWith('.ts')) {
   const source = readFileSync(new URL(url), 'utf8');
   const {code} = transformSync(source, {loader: url.endsWith('.tsx') ? 'tsx' : 'ts', format: 'esm', jsx: 'automatic', jsxImportSource: 'react', sourcefile: url, target: 'node22'});
   return {format: 'module', source: code, shortCircuit: true};
  }
  return nextLoad(url, context);
 },
});

const {rememberModalOpener, restoreModalFocus, firstFocusableIn} = await import('../app/ui/primitives.tsx');
const {PauseModal, ResultsModal, RESULT_ACTION_IDS, createResultActionDispatcher, resultFooterDescriptors} = await import('../app/ui/screens/ResultModals.tsx');
const {SettingsDialog} = await import('../app/ui/screens/SettingsDialog.tsx');

const render = (element) => renderToStaticMarkup(element);
const count = (html, needle) => (html.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

const baseUi = (over = {}) => ({
 mode: 'results', hud: null, awards: [], scoreboard: '<div>board</div>',
 resultTitle: () => 'DEFEAT', resultDescription: () => 'The enemy took the lattice.',
 start: () => {}, nextArena: () => {}, surpriseMe: () => {}, playDemo: () => {}, disconnectNet: () => {},
 changeMode: () => {}, lastDemo: null, net: {connected: false}, modalRef: null, settings: false,
 setSettings: () => {}, display: {}, bindings: {}, pauseQuick: null,
 toggleCaptions: () => {}, toggleReducedMotion: () => {}, openSettings: () => {},
 reward: null, matchSummary: null, campaign: null, challenges: [], weeklyChallenges: [],
 ranked: null, rankedQueued: null, history: {entries: []}, prefs: null,
 startSinglePlayer: () => {}, startCampaignMission: () => {}, queueRanked: () => {}, cancelQueue: () => {},
 quickStart: () => {}, getMap: (id) => ({name: String(id).toUpperCase()}),
 ...over,
});

function latticeFixture() {
 const actor = {id: 0, team: 0, frags: 7, deaths: 2, scoreStats: {objectiveCaptures: 0, objectiveTime: 74.5, ordersContributed: 3, damage: 810}};
 const hud = {
  config: {mode: 'cocs', botCount: 5, difficulty: 'normal', timeLimit: 600},
  modeName: 'Lattice Strike', mapId: 'foundry', mapName: 'Foundry', time: 412,
  overReason: 'dominance', winner: 1, teamScores: {0: 14, 1: 22},
  cocs: {winner: 1, scores: {0: 14, 1: 22}, orderStats: {issued: 9, completed: 5}, nodes: [], fluxSpent: {}},
  actorId: 0, actors: [actor],
 };
 return {hud, actor};
}

test('a covered lower dialog leaves exactly one aria-modal dialog that is inert and hidden', () => {
 const pauseUi = (settings) => baseUi({mode: 'paused', settings, hud: {config: {mode: 'cocs'}}});
 const settingsUi = (settings) => baseUi({settings, settingsTab: 'game'});
 const html = (settings) => render(React.createElement(React.Fragment, null,
  React.createElement(PauseModal, {ui: pauseUi(settings)}),
  React.createElement(SettingsDialog, {ui: settingsUi(settings), opener: null}),
 ));

 const alone = html(false);
 assert.equal(count(alone, 'aria-modal="true"'), 1, 'the pause dialog alone is the only modal');

 const stacked = html(true);
 assert.equal(count(stacked, 'aria-modal="true"'), 1, 'settings stacked over pause leaves exactly one modal');
 assert.match(stacked, /class="modal modal--covered" aria-hidden="true" inert=""/, 'the lower pause layer is inert and hidden');
 assert.match(stacked, /OPEN GRAPHICS &amp; SETTINGS/, 'the lower dialog stays rendered so closing settings returns to it');
 // Both dialog panels are still in the DOM; only the top one is exposed.
 assert.equal((stacked.match(/role="dialog"/g) || []).length, 2);
});

test('opener memory and restoration ignore body, document and detached elements', () => {
 const focused = [];
 const ownerDocument = {body: {}, documentElement: {}};
 const opener = {ownerDocument, isConnected: true, focus: (options) => focused.push(options)};
 assert.equal(rememberModalOpener(opener), opener);
 assert.equal(restoreModalFocus(opener), true);
 assert.deepEqual(focused, [{preventScroll: true}], 'the opener is focused without scrolling');
 assert.equal(rememberModalOpener(ownerDocument.body), null, 'body is never an opener');
 assert.equal(rememberModalOpener(ownerDocument.documentElement), null, 'the document element is never an opener');
 assert.equal(rememberModalOpener(null), null);
 const detached = {ownerDocument, isConnected: false, focus: () => { throw new Error('detached opener must not be focused'); }};
 assert.equal(restoreModalFocus(detached), false);
 assert.equal(restoreModalFocus(null), false);
});

test('focus entry picks the first visible control and skips hidden ones', () => {
 const visible = {getClientRects: () => [{width: 10, height: 10}]};
 const hidden = {getClientRects: () => []};
 assert.equal(firstFocusableIn({querySelectorAll: () => [hidden, visible]}), visible);
 assert.equal(firstFocusableIn({querySelectorAll: () => [hidden]}), null);
 assert.equal(firstFocusableIn(null), null);
 assert.equal(firstFocusableIn({}), null);
});

test('the next-match panel owns replay and loadout once; the footer keeps only its cluster actions', () => {
 const {hud, actor} = latticeFixture();
 const local = baseUi({hud, player: actor, lastDemo: {id: 'demo-1'}});
 const html = render(React.createElement(ResultsModal, {ui: local}));
 assert.match(html, /RUN IT BACK · LATTICE STRIKE/, 'the focused invitation stays');
 assert.equal(count(html, 'WATCH REPLAY'), 1, 'replay renders once, from the panel');
 assert.equal(count(html, 'TRY A NEW LOADOUT'), 1, 'loadout renders once, from the panel');
 assert.equal(count(html, 'CHANGE LOADOUT'), 0);
 assert.equal(count(html, 'PLAY AGAIN'), 0);
 assert.equal(count(html, 'SURPRISE ME'), 0);
 assert.equal(count(html, 'NEXT ARENA'), 0);
 assert.equal(count(html, 'class="modal-foot"'), 0, 'a local result with a plan renders no footer at all');

 const guest = baseUi({hud, player: actor, net: {connected: true, isHost: false}});
 const connected = render(React.createElement(ResultsModal, {ui: guest}));
 assert.equal(count(connected, 'class="modal-foot"'), 1);
 assert.match(connected, /WAITING FOR HOST/);
 assert.equal(count(connected, 'LEAVE SERVER'), 1);
 assert.equal(count(connected, 'WATCH REPLAY'), 0, 'no local replay action leaks into the online footer');
});

test('footer descriptors are cluster/fallback only and every id routes through the dispatcher', () => {
 const withPlan = {primary: {id: 'rematch'}, options: [], replay: null};
 assert.deepEqual(resultFooterDescriptors({connected: false, plan: withPlan}), [], 'a real plan suppresses the fallback');
 assert.deepEqual(resultFooterDescriptors({connected: true, isHost: true}).map(d => d.id), ['return-lobby', 'leave-server']);
 const guest = resultFooterDescriptors({connected: true, isHost: false});
 assert.equal(guest[0].kind, 'status', 'waiting-host state is not an action');
 assert.deepEqual(guest.slice(1).map(d => d.id), ['return-lobby', 'leave-server']);
 const fallback = resultFooterDescriptors({connected: false, plan: null, replayDemoId: 'demo-1'});
 assert.deepEqual(fallback.map(d => d.id), ['rematch', 'next-arena', 'surprise-me', 'watch-replay']);
 for (const descriptor of fallback) assert.ok(RESULT_ACTION_IDS.includes(descriptor.id), `${descriptor.id} is a stable action id`);

 const calls = [];
 const spy = (name) => (...args) => { calls.push([name, args]); return name; };
 const dispatch = createResultActionDispatcher({
  start: spy('start'), nextArena: spy('nextArena'), surpriseMe: spy('surpriseMe'),
  playDemo: spy('playDemo'), disconnectNet: spy('disconnectNet'), changeMode: spy('changeMode'),
  startSinglePlayer: spy('startSinglePlayer'), startCampaignMission: spy('startCampaignMission'),
  queueRanked: spy('queueRanked'), cancelQueue: spy('cancelQueue'), quickStart: spy('quickStart'),
 });
 assert.equal(dispatch({}), undefined, 'an id-less entry is ignored');

 dispatch({id: 'return-lobby'});
 dispatch({id: 'leave-server'});
 dispatch({id: 'rematch'});
 dispatch({id: 'next-arena'});
 dispatch({id: 'surprise-me'});
 dispatch({id: 'watch-replay', demoId: 'demo-1'});
 dispatch({id: 'practice', requiresQueueLeave: true, modeId: 'horde', botCount: 4, difficulty: 'hard'});
 dispatch({id: 'resume-checkpoint', missionId: 'convoy-run'});
 assert.deepEqual(calls.map(c => c[0]), ['changeMode', 'disconnectNet', 'start', 'nextArena', 'surpriseMe', 'playDemo', 'cancelQueue', 'quickStart', 'startSinglePlayer']);
 assert.deepEqual(calls[5][1], ['demo-1'], 'replay carries the demo id');
 assert.deepEqual(calls[8][1], ['campaign', 'convoy-run'], 'checkpoint actions carry their target mission');
});

test('the footer CSS wraps, stacks at narrow widths and bounds its own scroll region', () => {
 const css = readFileSync(join(ROOT, 'app/styles/ui.css'), 'utf8');
 const foot = css.slice(css.indexOf('.modal-foot{'), css.indexOf('.modal-foot .modal-foot-primary'));
 assert.match(foot, /flex-wrap:wrap/, 'the footer wraps by default');
 assert.match(foot, /min-width:0/, 'footer children may shrink');
 assert.match(foot, /overflow:auto/, 'a too-tall footer scrolls instead of clipping');
 assert.match(foot, /max-height:min\(45dvh,260px\)/, 'the footer is bounded to the panel');
 const narrow = css.slice(css.indexOf('@media (max-width:600px)'));
 assert.match(narrow, /\.modal-foot\{display:grid;grid-template-columns:minmax\(0,1fr\)/, 'phones stack the footer');
 assert.match(css, /@media \(pointer:coarse\)\{[\s\S]*?\.modal-foot \.btn[^{]*\{min-height:44px\}/, 'coarse pointers keep 44px targets');
});

test('the page wires Escape as Settings then Pause and passes the exact opener', () => {
 const page = readFileSync(join(ROOT, 'app/page.tsx'), 'utf8');
 const closeSettings = page.indexOf('if(settings){e.preventDefault();setSettings(false);return;}');
 const resumePause = page.indexOf("if(mode==='paused'){e.preventDefault();resumeRef.current();return;}");
 assert.ok(closeSettings >= 0, 'Escape closes settings');
 assert.ok(resumePause > closeSettings, 'the same press cannot close both: pause resumes only afterwards');
 assert.ok(page.includes('settingsOpenerRef.current='), 'the page captures the opener when settings opens');
 assert.ok(page.includes('opener={settingsOpenerRef.current}'), 'the opener reaches SettingsDialog');
 const settings = readFileSync(join(ROOT, 'app/ui/screens/SettingsDialog.tsx'), 'utf8');
 assert.ok(settings.includes('restoreFocus={opener}'), 'SettingsDialog hands the opener to the modal primitive');
});

// ---------------------------------------------------------------------------
// Real-engine geometry and focus restoration. Skips cleanly when no browser.
// ---------------------------------------------------------------------------
// The app's modal rules plus the real custom-property tokens they consume, so
// the fixture exercises the shipped CSS rather than a copy.
const uiStyles = () => {
 const css = readFileSync(join(ROOT, 'app/styles/ui.css'), 'utf8');
 const globals = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
 const tokens = [...globals.matchAll(/:root\s*\{[^}]*\}/g)].map((match) => match[0]).join('\n');
 return `${tokens}\n${css}`;
};

const SYNTHETIC_FOOTER = `<div class="modal"><section class="modal-panel modal-panel--lg" role="dialog" aria-label="Footer contract">
<header class="modal-head"><div><h2 class="modal-title">Footer contract</h2></div></header>
<div class="modal-body"><div style="height:240vh">Body content keeps its own vertical scroll.</div></div>
<footer class="modal-foot">
<button type="button" class="btn btn-primary modal-foot-primary">RUN IT BACK · LATTICE STRIKE</button>
<button type="button" class="btn">TRY A NEW LOADOUT</button>
<button type="button" class="btn">WATCH REPLAY</button>
<button type="button" class="btn">PLAY AGAIN</button>
<button type="button" class="btn">SURPRISE ME</button>
<button type="button" class="btn">NEXT ARENA</button>
<button type="button" class="btn btn-danger">LEAVE SERVER</button>
</footer></section></div>`;

const VIEWPORT_MATRIX = [
 {id: '1366x768', width: 1366, height: 768, uiScale: 1, touch: false},
 {id: '1920x1080', width: 1920, height: 1080, uiScale: 1, touch: false},
 {id: '844x390', width: 844, height: 390, uiScale: 1, touch: true},
 {id: '390x844', width: 390, height: 844, uiScale: 1, touch: true},
 {id: '844x390-ui1.4', width: 844, height: 390, uiScale: 1.4, touch: true},
];

test('the results modal stack and footer geometry hold at every required viewport', async (t) => {
 let chromium;
 try { ({chromium} = await import('playwright')); } catch { t.skip('playwright is not installed'); return; }
 let browser;
 try { browser = await chromium.launch({headless: true}); } catch (error) { t.skip(`chromium unavailable: ${error.message}`); return; }
 t.after(() => browser.close());

 await t.test('focus enters the top dialog and returns to its exact opener', async () => {
  const harness = `import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {Modal} from './app/ui/primitives.tsx';
function Harness(){
 const [settings,setSettings]=React.useState(false);
 const opener=React.useRef(null);
 const open=(event)=>{opener.current=event.currentTarget;setSettings(true);};
 return React.createElement(React.Fragment,null,
  React.createElement(Modal,{open:true,covered:settings,title:'Take a breath.',onClose:()=>{}},
   React.createElement('button',{id:'pause-opener',onClick:open},'OPEN GRAPHICS & SETTINGS')),
  React.createElement(Modal,{open:settings,title:'Tune your arena',onClose:()=>setSettings(false),restoreFocus:opener.current},
   React.createElement('button',{id:'settings-first'},'FIRST'),
   React.createElement('button',{id:'settings-close',onClick:()=>setSettings(false)},'CLOSE')));
}
window.__wp21={mount(element){createRoot(element).render(React.createElement(Harness));}};`;
  const {buildSync} = await import('esbuild');
  const bundle = buildSync({
   stdin: {contents: harness, resolveDir: ROOT, sourcefile: 'wp21-harness.tsx', loader: 'tsx'},
   bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', jsxImportSource: 'react',
   target: 'es2020', write: false, logLevel: 'silent',
  });
  const page = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${uiStyles()}\nhtml,body{margin:0;background:#050e13}</style></head><body><div id="root"></div></body></html>`);
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  await page.evaluate(() => window.__wp21.mount(document.getElementById('root')));
  await page.waitForSelector('#pause-opener');
  await page.waitForFunction(() => document.activeElement?.closest?.('.modal-panel')?.getAttribute('aria-modal') === 'true');

  await page.click('#pause-opener');
  await page.waitForFunction(() => {
   const panel = document.activeElement?.closest?.('.modal-panel');
   return panel?.getAttribute('aria-modal') === 'true' && panel.textContent.includes('Tune your arena');
  });
  const stacked = await page.evaluate(() => ({
   exposed: [...document.querySelectorAll('[role="dialog"]')].filter((dialog) => dialog.getAttribute('aria-modal') === 'true').length,
   covered: [...document.querySelectorAll('.modal--covered')].map((layer) => ({
    inert: layer.hasAttribute('inert'),
    hidden: layer.getAttribute('aria-hidden'),
    pointerEvents: getComputedStyle(layer).pointerEvents,
   })),
  }));
  assert.equal(stacked.exposed, 1, 'exactly one aria-modal dialog while settings is open');
  assert.equal(stacked.covered.length, 1);
  assert.equal(stacked.covered[0].inert, true);
  assert.equal(stacked.covered[0].hidden, 'true');
  assert.equal(stacked.covered[0].pointerEvents, 'none');

  await page.click('#settings-close');
  await page.waitForFunction(() => document.activeElement?.id === 'pause-opener');
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'pause-opener', 'focus stays on the exact opener after the uncover frame settles');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.modal--covered').length), 0, 'the lower dialog is no longer covered');
  await page.close();
 });

 await t.test('no document, panel or footer horizontal overflow and 44px footer targets', async () => {
  const {hud, actor} = latticeFixture();
  const markup = [
   render(React.createElement(PauseModal, {ui: baseUi({mode: 'paused', settings: false, hud: {config: {mode: 'cocs'}}})})),
   render(React.createElement(ResultsModal, {ui: baseUi({hud, player: actor, lastDemo: {id: 'demo-1'}})})),
   SYNTHETIC_FOOTER,
  ].join('\n');
  const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${uiStyles()}\nhtml,body{margin:0;min-height:100%;background:#050e13}</style></head><body>${markup}</body></html>`;

  for (const viewport of VIEWPORT_MATRIX) {
   const page = await browser.newPage({viewport: {width: viewport.width, height: viewport.height}, hasTouch: viewport.touch, isMobile: viewport.touch});
   await page.setContent(document);
   await page.evaluate((scale) => document.documentElement.style.setProperty('--ui-scale', String(scale)), viewport.uiScale);
   const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const panels = [...document.querySelectorAll('.modal-panel')].map((panel) => {
     const rect = panel.getBoundingClientRect();
     return {scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth, top: rect.top, bottom: rect.bottom};
    });
    const feet = [...document.querySelectorAll('.modal-foot')].map((foot) => {
     const rect = foot.getBoundingClientRect();
     return {scrollWidth: foot.scrollWidth, clientWidth: foot.clientWidth, bottom: rect.bottom, overflowY: getComputedStyle(foot).overflowY};
    });
    const buttons = [...document.querySelectorAll('.modal-foot .btn')].map((button) => {
     const rect = button.getBoundingClientRect();
     const panel = button.closest('.modal-panel').getBoundingClientRect();
     return {height: rect.height, left: rect.left, right: rect.right, panelLeft: panel.left, panelRight: panel.right};
    });
    const bodies = [...document.querySelectorAll('.modal-body')].map((body) => ({overflowY: getComputedStyle(body).overflowY, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight}));
    return {documentScrollWidth: root.scrollWidth, documentClientWidth: root.clientWidth, innerWidth, innerHeight, panels, feet, buttons, bodies, coarse: matchMedia('(pointer:coarse)').matches};
   });
   const label = `${viewport.id}${viewport.touch ? ' touch' : ''}`;
   assert.ok(metrics.documentScrollWidth <= metrics.documentClientWidth + 1, `${label}: document does not overflow horizontally`);
   assert.equal(metrics.panels.length >= 3, true, `${label}: all dialog panels are present`);
   for (const panel of metrics.panels) {
    assert.ok(panel.scrollWidth <= panel.clientWidth + 1, `${label}: panel content does not overflow (${panel.scrollWidth} > ${panel.clientWidth})`);
    assert.ok(panel.top >= -1 && panel.bottom <= metrics.innerHeight + 1, `${label}: panel stays inside the viewport`);
   }
   for (const foot of metrics.feet) {
    assert.ok(foot.scrollWidth <= foot.clientWidth + 1, `${label}: footer does not overflow (${foot.scrollWidth} > ${foot.clientWidth})`);
    assert.ok(foot.bottom <= metrics.innerHeight + 1, `${label}: footer stays inside the viewport`);
    assert.equal(foot.overflowY, 'auto', `${label}: a bounded footer scrolls instead of clipping`);
   }
   assert.equal(metrics.buttons.length > 0, true, `${label}: footer actions render`);
   for (const button of metrics.buttons) {
    assert.ok(button.right <= button.panelRight + 1 && button.left >= button.panelLeft - 1, `${label}: every action stays inside its panel`);
    assert.ok(button.right <= metrics.innerWidth + 1, `${label}: every action stays inside the viewport`);
    assert.ok(button.height >= 44, `${label}: every action is at least 44px tall (${button.height})`);
   }
   for (const body of metrics.bodies) assert.equal(body.overflowY, 'auto', `${label}: vertical body scrolling is preserved`);
   assert.ok(metrics.bodies.some((body) => body.scrollHeight > body.clientHeight + 10), `${label}: an overflowing body still scrolls`);
   if (viewport.touch) assert.equal(metrics.coarse, true, `${label}: the mobile profile reports a coarse pointer`);
   await page.close();
  }
 });
});
