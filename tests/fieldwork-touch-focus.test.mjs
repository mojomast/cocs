// WP1.1 focused contracts: touch hit ownership, surface focus scopes and the
// layout guards the tracked browser harness reproduces (B1, C1, portrait
// header). These are cheap source/SSR/geometry guards; the real hit testing,
// focus and multi-touch behaviour lives in the browser harness and on physical
// devices (docs/V8.4-IMPROVEMENT-PLAN.md WP1.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

register('./tsx-loader.mjs', import.meta.url);
// Stub CSS-module imports for the SSR component imports below.
register(`data:text/javascript,${encodeURIComponent(`export async function load(url,context,nextLoad){if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true};return nextLoad(url,context);}`)}`);
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier,context,nextResolve){try{return await nextResolve(specifier,context);}catch(error){if(!specifier.startsWith('.'))throw error;for(const ext of ['.tsx','.ts']){try{return await nextResolve(specifier+ext,context);}catch{}}throw error;}}`)}`);
const {LatticeTrainingHud,trainingFocusTarget} = await import('../app/ui/screens/LatticeTrainingHud.tsx');

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

const trainingView = (overrides = {}) => ({
  title: 'LATTICE FIELD TRAINING', mode: 'cocs', index: 2, total: 4,
  done: false, skipped: false, phase: 'complete',
  step: {id: 'capture', title: 'TAKE YOUR FRONT', detail: 'Stand in the ring.', success: 'Front secured.'},
  next: {id: 'connect', title: 'KEEP THE LINE'},
  goal: {value: 3, target: 3, label: 'seconds defending owned ring'},
  completed: ['move', 'fire'], progress: .5,
  ...overrides,
});

test('training focus beat: completion lands on START NEXT LESSON, the end lands on KEEP PLAYING', async () => {
  assert.equal(trainingFocusTarget(trainingView()), 'continue', 'completion targets the primary continue action');
  assert.equal(trainingFocusTarget(trainingView({phase: 'active'})), null, 'a live lesson never steals focus');
  assert.equal(trainingFocusTarget(trainingView({phase: 'done', done: true, step: null, next: null})), 'keep', 'the finished tutorial targets KEEP PLAYING');
  assert.equal(trainingFocusTarget(null), null);

  const props = {bindings: {}, cursorKey: 'ALT', onContinue: () => {}, onEnd: () => {}};
  const complete = render(LatticeTrainingHud, {training: trainingView(), ...props});
  assert.match(complete, /data-training-phase="complete"/);
  assert.match(complete, /START NEXT LESSON/);

  const last = render(LatticeTrainingHud, {training: trainingView({index: 3, next: null}), ...props});
  assert.match(last, /FINISH TRAINING/, 'the final lesson offers FINISH TRAINING');
  assert.doesNotMatch(last, /START NEXT LESSON/);

  const done = render(LatticeTrainingHud, {training: trainingView({phase: 'done', done: true, step: null, next: null}), ...props});
  assert.match(done, /KEEP PLAYING/, 'the finished tutorial offers KEEP PLAYING');
  assert.doesNotMatch(done, /END TUTORIAL/);

  const source = await read('app/ui/screens/LatticeTrainingHud.tsx');
  assert.match(source, /export function trainingFocusTarget/, 'the focus target is a pure, testable helper');
  assert.match(source, /continueRef\.current/, 'the completion beat has an explicit focus target');
  assert.match(source, /keepRef\.current/, 'the KEEP PLAYING beat has an explicit focus target');
  assert.match(source, /\.focus\(\{preventScroll: true\}\)/, 'focus moves with preventScroll');
  const page = await read('app/page.tsx');
  assert.match(page, /canvas\.current\?\.focus\(\{preventScroll:true\}\)/, 'leaving a lesson returns focus to the combat canvas rather than body');
});

test('touch capture is suspended while an explicit COCS surface or the Training beat owns input', async () => {
  const controls = await read('app/game-ui/touch-controls.tsx');
  assert.match(controls, /suspended\?:boolean/, 'the touch layer takes a suspension prop');
  assert.match(controls, /touch-layer--suspended/, 'the layer marks itself suspended');
  assert.match(controls, /if\(suspended\)return;/, 'handlers refuse to seed input while suspended');
  assert.match(controls, /capture\(e\.currentTarget,e\.pointerId\)/, 'pointer capture failure cannot surface as a page error');

  const page = await read('app/page.tsx');
  assert.match(page, /const touchSuspended=Boolean\(spendVisible\|\|\(cocsBoard\.open===true&&!boardCollapsed\)\|\|hud\?\.training\?\.phase==='complete'\|\|hud\?\.training\?\.done===true\);/, 'suspension is derived from the owning surfaces');
  assert.match(page, /suspended=\{touchSuspended\}/, 'the rendered touch layer receives the state');

  const css = await read('app/globals.css');
  for (const selector of ['.touch-layer--suspended .touch-move-zone', '.touch-layer--suspended .touch-look', '.touch-layer--suspended .touch-primary > *', '.touch-layer--suspended .touch-actions > *']) {
    assert.ok(css.includes(selector), `${selector} is inert while suspended`);
  }
});

test('only actionable surfaces outrank touch capture and non-actionable space stays transparent', async () => {
  const css = await read('app/globals.css');
  for (const selector of ['.cocs-board{position:absolute', '.cocs-spend{position:absolute', '.cocs-spend-chip{position:absolute', '.cocs-board-chip{position:absolute', '.cursor-resume{position:absolute']) {
    const start = css.indexOf(selector);
    assert.ok(start > -1, `${selector.replace('{position:absolute', '')} has a positioned rule`);
    const rule = css.slice(start, css.indexOf('}', start));
    assert.match(rule, /z-index:calc\(var\(--z-touch,6\) \+ 1\)/, `${selector.replace('{position:absolute', '')} sits above touch capture`);
  }
  assert.match(css, /\.cocs-board__hint\{[^}]*pointer-events:none/, 'the board hint never blocks the last card');
  assert.match(css, /\.cocs-spend\{[^}]*scroll-padding-bottom:68px/, 'keyboard focus scrolling clears the sticky spend footer');
  assert.match(css, /\.cocs-spend__footer\{position:sticky[^}]*pointer-events:none/, 'the spend footer background never blocks the last sink');
  assert.match(css, /\.cocs-spend__footer \.cocs-spend__skip\{pointer-events:auto/, 'SKIP stays tappable');
  assert.match(css, /\.touch-layer\{z-index:var\(--z-touch\)\}/, 'the touch layer keeps the capture layer token');

  const guide = await read('app/styles/lattice-guide.css');
  assert.ok(guide.includes('.lattice-hud .cocs-readout{z-index:calc(var(--z-touch,6) + 1)}'), 'the readout controls outrank touch capture');
  assert.match(guide, /@media\(pointer:coarse\)\{\.lattice-hud \.cocs-readout\{pointer-events:none\}\}/, 'touch pointers pass through the readout background');
  assert.ok(guide.includes('.cocs-readout :is(summary,button,select,input,a,[role="button"]){pointer-events:auto}'), 'the readout controls accept pointer input');
  assert.match(guide, /\.cocs-readout :is\(button,select,summary\):focus-visible\{outline:2px solid var\(--accent\)/, 'readout controls keep a visible focus ring');

  const training = await read('app/ui/screens/LatticeTrainingHud.module.css');
  assert.match(training, /z-index:calc\(var\(--z-touch,6\) \+ 1\)/, 'the training card sits above touch capture');
  assert.match(training, /\.panel :is\(button,summary,a,input,select,\[role="button"\]\)\{pointer-events:auto\}/, 'training actions stay tappable');
  assert.match(training, /\.panel\[data-training-phase="complete"\],\.panel\[data-training-phase="done"\]/, 'the paused completion card is a full surface');
  assert.match(training, /@media\(pointer:coarse\)\{[^}]*\.panel\{pointer-events:none\}/, 'touch pointers pass through the live training card background');
  assert.match(training, /position:sticky;bottom:-2px/, 'the training actions pin to the visible card bottom');
});

test('Tab stays in the owning Board/Spend/Training surface without opening standings', async () => {
  const page = await read('app/page.tsx');
  assert.ok(page.includes(`const surfaceFocusSelectors:Record<string,string>={[CURSOR_SURFACE.BOARD]:'.cocs-board',[CURSOR_SURFACE.SPEND]:'.cocs-spend',[CURSOR_SURFACE.TRAINING]:'[data-training-phase]'}`), 'the scoped surfaces are explicit');
  assert.match(page, /if\(owner&&cycleSurfaceFocus\(owner,e\.shiftKey\)\)\{e\.preventDefault\(\);return;\}/, 'Tab cycles inside the owning panel before standings');
  assert.match(page, /button:not\(:disabled\),input:not\(:disabled\),select:not\(:disabled\)/, 'the Spend target picker and SKIP are reachable');
  assert.ok(page.includes("if((e.code==='Enter'||e.code==='Space')&&(e.target as HTMLElement)?.closest?.('.cocs-board button'))return;"), 'a focused board control keeps native Enter/Space activation');
  // The preserved contracts from the cursor work:
  assert.match(page, /if\(owner===CURSOR_SURFACE\.SCOREBOARD\)\{e\.preventDefault\(\);setScoresInteractiveOpen\(false\);setScores\(false\);return;\}/, 'Tab still closes the pinned standings');
  assert.match(page, /if\(cursorCombatKeysBlocked\(cursorRef\.current\)\)return;/, 'combat seeding is still blocked by surface owners');
});

test('portrait and short-landscape HUD clears the reticle corridor without hiding match truth', async () => {
  const guide = await read('app/styles/lattice-guide.css');
  assert.ok(guide.includes('max-height:min(280px,calc(50dvh - var(--safe-top) - 134px))'), 'the portrait readout stops above the corridor and stays scrollable');
  assert.match(guide, /\.lattice-hud \.frag-counter strong\{font-size:clamp\(12px,3\.3vw,18px\);line-height:1\.2;white-space:normal\}/, 'the portrait match score wraps instead of overflowing');
  assert.ok(guide.includes('.lattice-hud .cocs-spend-chip{top:auto;bottom:calc(var(--safe-bottom) + 94px)'), 'the short-landscape spend chip anchors below the corridor');
  assert.ok(guide.includes('.lattice-hud.touch-mode .cocs-spend-chip{left:auto;right:var(--safe-right);top:calc(var(--safe-top) + 269px);bottom:auto;'), 'the portrait chip keeps its column');
  const css = await read('app/globals.css');
  assert.match(css, /\.frag-counter strong\{white-space:normal;line-height:1\.15\}/, 'narrow match headers can wrap their score');
  assert.match(css, /\.cocs-board\{[^}]*scroll-padding-bottom:52px/, 'keyboard focus scrolling clears the board hint');
});

test('the theater retention/bookmark, unlock and help/compare controls keep 44px rows and no live regions', async () => {
 const [ui, theater, settings, selection, results] = await Promise.all([
  read('app/styles/ui.css'),
  read('app/ui/screens/TheaterScreen.tsx'),
  read('app/ui/screens/SettingsDialog.tsx'),
  read('app/ui/screens/SelectionScreen.tsx'),
  read('app/ui/screens/ResultModals.tsx'),
 ]);
 for (const rule of ['.theater-bookmarks .btn{min-height:44px}', '.theater-retention select{min-height:44px', '.weapon-compare-picks select{min-height:44px', '.help-filter input{min-height:44px']) {
  assert.ok(ui.includes(rule), `${rule} keeps the touch floor`);
 }
 assert.match(theater, /role="group" aria-label="Replay bookmarks"/, 'bookmarks are a named, non-live group beside the highlights');
 assert.match(theater, /role="group" aria-label="Replay retention"/, 'retention is a named, non-live group');
 assert.match(settings, /id="help-filter-input"/, 'the help filter is a labelled input');
 assert.match(settings, /OF \{sections\.length\} TOPICS/, 'the help count is static text');
 for (const [name, source] of [['theater', theater], ['settings', settings], ['selection', selection], ['results', results]]) {
  assert.doesNotMatch(source, /aria-live/, `${name} adds no live region`);
 }
});

test('touch display settings keep the 44px floor and the capture-layer token', async () => {
  const css = await read('app/globals.css');
  assert.match(css, /\.touch-layer\{z-index:var\(--z-touch\)\}/, 'the pinned capture-layer token is byte-identical');
  assert.match(css, /\.touch-layer\s*\{[^}]*opacity: var\(--touch-opacity,1\)/, 'opacity stays a layer variable');
  assert.match(css, /width: max\(44px, calc\(46px \* var\(--touch-scale,1\)\)\)/, 'the base button keeps the 44px floor');
  assert.match(css, /width: max\(44px, calc\(40px \* var\(--touch-scale,1\)\)\)/, 'the short-landscape button keeps the 44px floor');
  const compact = css.replace(/\s+/g, ' ');
  for (const selector of ['.touch-layer--left-hand .touch-move-zone { left: auto; right: 0;', '.touch-layer--left-hand .touch-look { left: 0; right: 50%;', '.touch-layer--left-hand .touch-actions { right: auto; left: max(18px, env(safe-area-inset-left));', '.touch-layer--left-hand .touch-primary { right: auto; left: max(18px, env(safe-area-inset-left));', '.touch-layer--left-hand .touch-util { right: auto; left: max(14px, env(safe-area-inset-left));']) {
    assert.ok(compact.includes(selector), `${selector} mirrors the layout`);
  }
  const hud = await read('app/ui/screens/PlayingHud.tsx');
  assert.match(hud, /teamStatusHud\(player,hud\)/, 'the team strip is fed by the pure helper');
  assert.match(hud, /economyHud\(player,hud,WEAPONS\)/, 'the economy chips are fed by the pure helper');
  assert.match(hud, /className="hud-pills team-status" role="group"/, 'the strip is one non-live group');
  assert.doesNotMatch(hud, /team-status[^>]*role="status"/, 'the strip never becomes a live region');
});
