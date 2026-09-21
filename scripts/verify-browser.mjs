#!/usr/bin/env node
// Tracked browser verification harness (v8.4 improvement plan, cross-cutting
// gate 4: "Before WP1.1 acceptance: track a Playwright runner, browser matrix,
// traces, screenshots and console/network logs...").
//
// It verifies an ALREADY-RUNNING app. It never starts, restarts or stops the
// app, the build or the game server:
//
//   npm run dev -- --host 127.0.0.1 --port 4173   # in one shell
//   BROWSER_BASE_URL=http://127.0.0.1:4173 npm run test:browser
//
// What it proves (technical evidence only):
//   - fresh profile: localStorage `token-arena-onboarded=1` skips onboarding,
//     the title entry action opens the selection screen;
//   - the LATTICE / OPERATIONS (cocs-coop) practice briefing launches;
//   - no console/page errors during the flow;
//   - the HUD is present;
//   - `documentElement.scrollWidth <= innerWidth` and no visible element
//     sticking out of the viewport horizontally (document.scrollWidth is not a
//     Chromium property; the root scroll width is its portable equivalent);
//   - the persistent HUD panels do not intersect the crosshair corridor;
//   - `elementsFromPoint()` at the centre of every visible touch action button
//     returns that button (the B1 class of touch-capture regression);
//   - the required viewport matrix: 1366x768, 1920x1080, 844x390, 390x844 and
//     844x390 repeated at `--ui-scale:1.4`.
//
// It does NOT prove fun, readability, comfort, device behaviour or human
// comprehension; see docs/TESTING.md.
//
// Stdout is exactly one line of machine-readable JSON summary. Human-readable
// progress goes to stderr. Exit codes: 0 pass, 1 assertion/manifest failure,
// 2 harness setup failure (e.g. Chromium is not installed).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SCHEMA = 'cocs-browser-verify/1';
export const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
export const DEFAULT_ARTIFACT_DIR = 'artifacts/browser';
// Half-size (CSS px) of the minimum square kept clear around the crosshair
// centre. The box grows with the crosshair element plus a small margin.
export const CORRIDOR_MIN_HALF_PX = 48;

// The required matrix lives here, in one place.
export const VIEWPORT_MATRIX = Object.freeze([
  {id: '1366x768', label: '1366x768', width: 1366, height: 768, uiScale: 1, inputMode: 'mouse'},
  {id: '1920x1080', label: '1920x1080', width: 1920, height: 1080, uiScale: 1, inputMode: 'mouse'},
  {id: '844x390', label: '844x390', width: 844, height: 390, uiScale: 1, inputMode: 'touch'},
  {id: '390x844', label: '390x844', width: 390, height: 844, uiScale: 1, inputMode: 'touch'},
  {id: '844x390-ui1.4', label: '844x390 @ ui-scale 1.4', width: 844, height: 390, uiScale: 1.4, inputMode: 'touch'},
]);

// Persistent HUD panels that must stay out of the central aiming corridor.
// Transient state overlays (death/respawn, preparing, damage, banners) are not
// panels and are deliberately excluded; they are still caught by the
// screenshot and console evidence. `.hud-lower` is a transparent layout
// container (its visible children are transient centre messages), and
// `.cocs-strip` is a section inside the scrollable `.cocs-readout` whose
// bounding box can extend into the panel's clipped scroll area.
export const CORRIDOR_PANELS = Object.freeze([
  '.match-top',
  '.cocs-readout',
  '.director-readout',
  '.kill-feed',
  '.stat-card--vitals',
  '.ammo-stack',
  '[aria-label="Ability, movement and grenade status"]',
  '.objective-bar',
  '.cocs-spend-chip',
  '.cocs-notice',
  '.cursor-chip',
]);

const HUD_REQUIRED = Object.freeze([
  ['.game-hud', 'HUD root'],
  ['.match-top', 'live match status'],
  ['[aria-label="Player status"]', 'player status'],
  ['.cocs-readout', 'LATTICE front readout'],
  ['.cocs-strip', 'order strip'],
]);

const SETUP_INSTRUCTIONS = [
  'Chromium for Playwright is not available.',
  'Install it with: npx playwright install chromium',
  'If a cache already exists elsewhere, point the harness at it:',
  '  PLAYWRIGHT_BROWSERS_PATH=/path/to/ms-playwright npm run test:browser',
].join('\n');

// Console errors that are known, documented and not product failures. They are
// recorded in the manifest (never silently dropped); only unmatched errors fail
// the run. Keep this list tiny and every entry justified.
export const KNOWN_CONSOLE_IGNORES = Object.freeze([
  {
    // docs/PHASE2-FIXLIST.md F4: the dev preview emits the metadataBase-absolute
    // favicon URL and the preview CSP blocks it. Production is same-origin.
    pattern: /Refused to load the image '.*\/favicon\.svg' because it violates the following Content Security Policy/,
    reason: 'preview-only absolute-favicon CSP noise (F4); the production origin serves it same-origin',
  },
]);

export function isKnownConsoleNoise(text) {
  return KNOWN_CONSOLE_IGNORES.some(ignore => ignore.pattern.test(String(text)));
}

function parseArgs(argv) {
  const options = {url: null, out: null, headed: false, trace: null, only: null, help: false};
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--trace') options.trace = true;
    else if (arg === '--no-trace') options.trace = false;
    else if (arg.startsWith('--url=')) options.url = arg.slice(6);
    else if (arg.startsWith('--out=')) options.out = arg.slice(6);
    else if (arg.startsWith('--only=')) options.only = arg.slice(7).split(',').map(value => value.trim()).filter(Boolean);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

// Browser cache candidates in priority order. A pre-populated cache (for
// example the opencode cache) is reused before Playwright's default
// (~/.cache/ms-playwright), which keeps CI and dev boxes from re-downloading
// Chromium when a complete matching build already exists.
export function browserPathCandidates(env = process.env, home = os.homedir()) {
  const paths = [];
  if (env.PLAYWRIGHT_BROWSERS_PATH) paths.push(env.PLAYWRIGHT_BROWSERS_PATH);
  paths.push(path.join(home, '.cache', 'ms-playwright'));
  paths.push(path.join(home, '.opencode-v2', 'cache', 'ms-playwright'));
  return [...new Set(paths)].filter(candidate => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });
}

// Pick the first candidate whose Chromium build matches the pinned Playwright
// revision. Returns the chosen PLAYWRIGHT_BROWSERS_PATH value (null = default).
export function selectBrowsersPath(chromium, env = process.env, home = os.homedir()) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) {
    return fs.existsSync(chromium.executablePath()) ? env.PLAYWRIGHT_BROWSERS_PATH : null;
  }
  for (const candidate of [null, ...browserPathCandidates(env, home)]) {
    if (candidate) process.env.PLAYWRIGHT_BROWSERS_PATH = candidate;
    else delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (fs.existsSync(chromium.executablePath())) return process.env.PLAYWRIGHT_BROWSERS_PATH ?? null;
  }
  return null;
}

function gitIdentity() {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim();
    return {commit, commitShort: commit.slice(0, 7), commitDirty: status.length > 0};
  } catch {
    return {commit: null, commitShort: null, commitDirty: null};
  }
}

async function readVersion(baseUrl) {
  const url = new URL('/api/version', baseUrl).href;
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(10000), cache: 'no-store'});
    let body = null;
    try { body = await response.json(); } catch {}
    return {url, status: response.status, ok: response.ok, body};
  } catch (error) {
    return {url, status: null, ok: false, error: String(error?.message || error)};
  }
}

function pathToArtifact(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function makeRunId(commitShort) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  return `${stamp}${commitShort ? `-${commitShort}` : ''}`;
}

// Runs inside the page. Returns geometry evidence; the Node side decides pass/fail.
function probeBrowserState({panels, corridorHalfMin}) {
  // checkVisibility walks ancestors too, so a knob inside an opacity:0 idle
  // stick base is not treated as visible.
  const isRendered = (element) => {
    if (typeof element.checkVisibility === 'function') {
      try {
        if (!element.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
      } catch {}
    }
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };
  const visible = (element) => {
    if (!isRendered(element)) return false;
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  };
  const boxOf = (element) => {
    const box = element.getBoundingClientRect();
    return {x: box.x, y: box.y, left: box.left, top: box.top, width: box.width, height: box.height, right: box.right, bottom: box.bottom};
  };
  // Scrollable tracks and bounded side rails expose only their clipped area.
  // Keep viewport overflow distinct from content reachable by local scrolling.
  const visibleBoxOf = element => {
    const box=boxOf(element);
    for(let parent=element.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
      const style=getComputedStyle(parent),r=parent.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(style.overflowX)){box.left=Math.max(box.left,r.left);box.right=Math.min(box.right,r.right);}
      if(/auto|scroll|hidden|clip/.test(style.overflowY)){box.top=Math.max(box.top,r.top);box.bottom=Math.min(box.bottom,r.bottom);}
    }
    return {...box,x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top};
  };
  const root = document.documentElement;
  const body = document.body;
  const innerWidth = window.innerWidth;
  const scrollWidths = {
    documentElement: root.scrollWidth,
    body: body ? body.scrollWidth : 0,
    // Chromium does not expose document.scrollWidth; keep the alias if an
    // engine provides it so the recorded evidence is explicit.
    documentAlias: typeof document.scrollWidth === 'number' ? document.scrollWidth : null,
  };
  const describeElement = (element) => {
    const chain = [];
    let node = element;
    while (node && node !== document.body && chain.length < 4) {
      chain.unshift(`${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(/\s+/).join('.')}` : ''}`);
      node = node.parentElement;
    }
    return chain.join(' > ');
  };
  // Visible elements that stick out of the viewport are evidence of clipped or
  // overlapping HUD content; hidden idle decorations (opacity 0) are ignored.
  const visibleOverflow = [];
  for (const element of document.querySelectorAll('body *')) {
    if (!isRendered(element)) continue;
    const box = visibleBoxOf(element);
    if (box.width <= 1 || box.height <= 1) continue;
    if (box.right > innerWidth + 1 || box.left < -1) {
      visibleOverflow.push({element: describeElement(element), left: box.left, right: box.right, width: box.width});
    }
  }
  visibleOverflow.sort((a, b) => b.right - a.right);
  const overflow = {
    innerWidth,
    scrollWidths,
    maxScrollWidth: Math.max(scrollWidths.documentElement, scrollWidths.documentAlias ?? 0),
    bodyScrollWidth: scrollWidths.body,
    visibleOverflow: visibleOverflow.slice(0, 10),
    visibleOverflowCount: visibleOverflow.length,
    ok: scrollWidths.documentElement <= innerWidth && visibleOverflow.length === 0,
  };

  const crosshair = document.querySelector('.aim-layer .crosshair');
  const crosshairRect = crosshair && visible(crosshair) ? boxOf(crosshair) : null;
  const center = crosshairRect
    ? {x: crosshairRect.x + crosshairRect.width / 2, y: crosshairRect.y + crosshairRect.height / 2}
    : {x: innerWidth / 2, y: window.innerHeight / 2};
  const half = Math.max(
    corridorHalfMin,
    crosshairRect ? crosshairRect.width / 2 + 36 : 0,
    crosshairRect ? crosshairRect.height / 2 + 36 : 0,
  );
  const corridorBox = {left: center.x - half, top: center.y - half, right: center.x + half, bottom: center.y + half};
  const panelBoxes = [];
  for (const selector of panels) {
    for (const element of document.querySelectorAll(selector)) {
      if (!visible(element)) continue;
      const box = visibleBoxOf(element);
      if(box.width<=1||box.height<=1)continue;
      const intersects = box.right > corridorBox.left && box.x < corridorBox.right && box.bottom > corridorBox.top && box.y < corridorBox.bottom;
      panelBoxes.push({selector, ...box, intersects});
    }
  }
  const app = document.querySelector('.arena-app');
  return {
    overflow,
    corridor: {
      crosshair: crosshairRect,
      center,
      half,
      box: corridorBox,
      panels: panelBoxes,
      ok: !panelBoxes.some(panel => panel.intersects),
    },
    uiScale: app ? getComputedStyle(app).getPropertyValue('--ui-scale').trim() : null,
  };
}

// Runs inside the page. Touch action buttons must be the topmost element at
// their own centre; move/look capture zones sit above them when this regresses.
function probeTouchTargets() {
  const selector = '.touch-actions .touch-button, .touch-primary .touch-button, .touch-util .touch-button';
  const results = [];
  for (const element of document.querySelectorAll(selector)) {
    if (element.disabled) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    if (typeof element.checkVisibility === 'function') {
      try { if (!element.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) continue; } catch {}
    }
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
    const top = stack[0] ?? null;
    const describe = (node) => node ? {tag: node.tagName?.toLowerCase?.() ?? null, className: String(node.className ?? ''), label: node.getAttribute?.('aria-label') ?? null} : null;
    results.push({
      label: element.getAttribute('aria-label') || (element.textContent || '').trim(),
      className: String(element.className),
      center: {x, y},
      top: describe(top),
      stack: stack.slice(0, 4).map(describe),
      reachable: Boolean(top) && (top === element || element.contains(top)),
    });
  }
  return {
    selector,
    count: results.length,
    ok: results.length > 0 && results.every(result => result.reachable),
    results,
  };
}

// The title accepts a click or any key, but the SSR document is interactive-
// looking before React hydrates, so a single early click can be a no-op. Retry
// until the title actually leaves the DOM.
async function enterTitle(page, timeoutMs) {
  const title = page.locator('.title-stage');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await title.count() === 0) return true;
    await page.getByRole('button', {name: 'Enter the arena'}).click({timeout: 10000}).catch(() => {});
    await page.waitForTimeout(200);
  }
  return (await title.count()) === 0;
}

// Enter the title, open the LATTICE/OPERATIONS briefing and deploy a practice
// match. A dev server can hot-reload the document mid-flow (or before the first
// click), so this retries instead of recording a false product failure.
async function launchOperations(page, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= options.launchAttempts; attempt++) {
    try {
      if (await page.locator('.arena-app.mode-playing').count()) {
        await page.locator('.game-hud').waitFor({state: 'visible', timeout: options.hudTimeoutMs});
        await page.locator('.cocs-strip').waitFor({state: 'visible', timeout: options.hudTimeoutMs});
        return;
      }
      if (await page.locator('.title-stage').count()) {
        if (!(await enterTitle(page, options.timeoutMs))) throw new Error('could not enter the title screen');
      }
      await page.waitForFunction(() => !document.querySelector('.shell--awaiting'), null, {timeout: options.timeoutMs});
      await page.getByRole('button', {name: 'OPERATIONS · CO-OP', exact:true}).click({timeout: options.timeoutMs});
      await page.getByRole('button', {name: 'DEPLOY OPERATIONS', exact: true}).click({timeout: options.timeoutMs});
      await page.locator('.game-hud').waitFor({state: 'visible', timeout: options.hudTimeoutMs});
      await page.locator('.cocs-strip').waitFor({state: 'visible', timeout: options.hudTimeoutMs});
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000);
    }
  }
  throw new Error(`could not launch the Operations practice match: ${String(lastError?.message || lastError)}`);
}

async function verifyViewport(browser, options) {
  const viewport = options.definition;
  const directory = path.join(options.runDirectory, viewport.id);
  await fsp.mkdir(directory, {recursive: true});
  const record = {
    id: viewport.id,
    label: viewport.label,
    viewport: {width: viewport.width, height: viewport.height},
    deviceScaleFactor: options.deviceScaleFactor,
    uiScale: viewport.uiScale,
    inputMode: viewport.inputMode,
    hasTouch: viewport.inputMode === 'touch',
    isMobile: viewport.inputMode === 'touch',
    renderer: null,
    screenshot: null,
    failureScreenshot: null,
    trace: null,
    consoleErrors: [],
    ignoredConsoleErrors: [],
    pageErrors: [],
    networkFailures: [],
    assertions: null,
    result: 'fail',
    failures: [],
  };
  const failures = record.failures;
  const context = await browser.newContext({
    viewport: {width: viewport.width, height: viewport.height},
    deviceScaleFactor: options.deviceScaleFactor,
    hasTouch: viewport.inputMode === 'touch',
    isMobile: viewport.inputMode === 'touch',
    locale: 'en-US',
  });
  context.setDefaultTimeout(options.timeoutMs);
  context.setDefaultNavigationTimeout(options.navigationTimeoutMs);
  await context.addInitScript(({uiScale, touch}) => {
    try {
      // Fresh-profile seed: skip onboarding, mute audio, disable the menu
      // showcase, and apply the requested UI text scale.
      localStorage.setItem('token-arena-onboarded', '1');
      localStorage.setItem('token-arena-settings', JSON.stringify({touch, muted: true, showcase: false}));
      localStorage.setItem('token-arena-customization', JSON.stringify({display: {uiScale}}));
    } catch {}
  }, {uiScale: viewport.uiScale, touch: viewport.inputMode === 'touch'});
  if (options.trace) {
    await context.tracing.start({name: `${options.runId}-${viewport.id}`, screenshots: true, snapshots: true, sources: false});
  }
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() !== 'error') return;
    let location = null;
    try { location = message.location(); } catch {}
    record.consoleErrors.push({text: message.text(), location});
  });
  page.on('pageerror', error => record.pageErrors.push(String(error?.message || error)));
  page.on('requestfailed', request => record.networkFailures.push({url: request.url(), failure: request.failure()?.errorText ?? null}));
  page.on('response', response => {
    if (response.status() >= 400) record.networkFailures.push({url: response.url(), status: response.status()});
  });

  const screenshotPath = path.join(directory, 'hud.png');
  try {
    // Observe /api/version before navigation: the page requests it from a mount
    // effect, so the response means React has hydrated and handlers are attached.
    const versionSeen = page.waitForResponse(response => response.url().includes('/api/version'), {timeout: 15000}).catch(() => null);
    await page.goto(options.baseUrl, {waitUntil: 'domcontentloaded'});
    await versionSeen;
    await launchOperations(page, options);
    await page.waitForTimeout(options.settleMs);

    const probe = await page.evaluate(probeBrowserState, {panels: [...CORRIDOR_PANELS], corridorHalfMin: CORRIDOR_MIN_HALF_PX});
    const hud = {};
    for (const [selector, description] of HUD_REQUIRED) {
      hud[selector] = {description, visible: await page.locator(selector).first().isVisible().catch(() => false)};
    }
    const hudOk = Object.values(hud).every(entry => entry.visible);
    const touchTargets = viewport.inputMode === 'touch'
      ? await page.evaluate(probeTouchTargets)
      : {skipped: true, reason: 'input mode is mouse'};
    const renderer = await page.evaluate(() => {
      const snapshot = typeof window.tokenArenaSnapshot === 'function' ? window.tokenArenaSnapshot() : null;
      return snapshot?.renderer ?? null;
    }).catch(() => null);
    record.renderer = renderer;

    await page.screenshot({path: screenshotPath});
    record.screenshot = pathToArtifact(screenshotPath);

    if (!hudOk) {
      failures.push(`HUD panels missing: ${Object.entries(hud).filter(([, entry]) => !entry.visible).map(([selector]) => selector).join(', ')}`);
    }
    if (!probe.overflow.ok) {
      const offenders = probe.overflow.visibleOverflow.map(item => `${item.element} (right ${Math.round(item.right)} > ${probe.overflow.innerWidth})`).join('; ');
      failures.push(`horizontal overflow: documentElement.scrollWidth ${probe.overflow.scrollWidths.documentElement} vs innerWidth ${probe.overflow.innerWidth}${offenders ? `; visible overflow: ${offenders}` : ''}`);
    }
    if (!probe.corridor.ok) {
      failures.push(`crosshair corridor blocked by: ${probe.corridor.panels.filter(panel => panel.intersects).map(panel => panel.selector).join(', ')}`);
    }
    if (!touchTargets.skipped && !touchTargets.ok) {
      failures.push(`touch targets unreachable: ${touchTargets.results.filter(target => !target.reachable).map(target => target.label || target.className).join(', ') || 'no touch action buttons found'}`);
    }
    record.ignoredConsoleErrors = record.consoleErrors.filter(entry => isKnownConsoleNoise(entry.text));
    const fatalConsoleErrors = record.consoleErrors.filter(entry => !isKnownConsoleNoise(entry.text));
    if (fatalConsoleErrors.length) failures.push(`${fatalConsoleErrors.length} console error(s): ${fatalConsoleErrors.map(entry => entry.text).join(' | ').slice(0, 300)}`);
    if (record.pageErrors.length) failures.push(`${record.pageErrors.length} page error(s)`);
    record.assertions = {
      hud: {ok: hudOk, selectors: hud},
      overflow: probe.overflow,
      corridor: probe.corridor,
      touchTargets,
      console: {
        ok: fatalConsoleErrors.length === 0 && record.pageErrors.length === 0,
        total: record.consoleErrors.length,
        fatal: fatalConsoleErrors.length,
        ignored: record.ignoredConsoleErrors.length,
        ignores: KNOWN_CONSOLE_IGNORES.map(ignore => ({pattern: String(ignore.pattern), reason: ignore.reason})),
      },
      uiScale: {expected: viewport.uiScale, observed: probe.uiScale, ok: Number.parseFloat(probe.uiScale) === viewport.uiScale},
    };
    if (!record.assertions.uiScale.ok) {
      failures.push(`ui scale observed ${probe.uiScale}, expected ${viewport.uiScale}`);
    }
  } catch (error) {
    failures.push(`flow error: ${String(error?.message || error)}`);
    try {
      const failurePath = path.join(directory, 'failure.png');
      await page.screenshot({path: failurePath});
      record.failureScreenshot = pathToArtifact(failurePath);
    } catch {}
  }
  if (options.trace) {
    const tracePath = path.join(directory, 'trace.zip');
    try {
      await context.tracing.stop({path: tracePath});
      record.trace = pathToArtifact(tracePath);
    } catch (error) {
      failures.push(`trace write failed: ${String(error?.message || error)}`);
    }
  }
  record.failures = failures;
  record.result = failures.length === 0 ? 'pass' : 'fail';
  await context.close();
  return record;
}

function humanLine(line) {
  process.stderr.write(`${line}\n`);
}

function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    humanLine(String(error.message));
    emitJson({schema: SCHEMA, ok: false, error: String(error.message)});
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    humanLine('Usage: node scripts/verify-browser.mjs [--url=URL] [--out=DIR] [--only=id,id] [--headed] [--trace] [--no-trace]');
    humanLine('Env: BROWSER_BASE_URL, BROWSER_ARTIFACT_DIR, BROWSER_DPR, BROWSER_HEADED=1, BROWSER_TRACE=1,');
    humanLine('     BROWSER_TIMEOUT_MS, BROWSER_NAVIGATION_TIMEOUT_MS, BROWSER_HUD_TIMEOUT_MS, BROWSER_LAUNCH_ATTEMPTS,');
    humanLine('     BROWSER_SETTLE_MS, PLAYWRIGHT_BROWSERS_PATH');
    emitJson({schema: SCHEMA, ok: true, help: true});
    return;
  }

  const baseUrl = options.url || process.env.BROWSER_BASE_URL || DEFAULT_BASE_URL;
  const artifactRoot = path.resolve(ROOT, options.out || process.env.BROWSER_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR);
  const deviceScaleFactor = Number(process.env.BROWSER_DPR || 1);
  const timeoutMs = Number(process.env.BROWSER_TIMEOUT_MS || 60000);
  const navigationTimeoutMs = Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS || Math.max(timeoutMs, 120000));
  const hudTimeoutMs = Number(process.env.BROWSER_HUD_TIMEOUT_MS || 90000);
  const launchAttempts = Number(process.env.BROWSER_LAUNCH_ATTEMPTS || 3);
  const settleMs = Number(process.env.BROWSER_SETTLE_MS || 1200);
  const headed = options.headed || process.env.BROWSER_HEADED === '1';
  // Traces are powerful and large (tens of MB per viewport), so they are
  // opt-in: --trace or BROWSER_TRACE=1. --no-trace wins over the environment.
  const trace = options.trace ?? process.env.BROWSER_TRACE === '1';
  const identity = gitIdentity();
  const runId = makeRunId(identity.commitShort);
  const runDirectory = path.join(artifactRoot, runId);
  const startedAt = new Date();
  const startedMs = Date.now();

  let chromium;
  try {
    ({chromium} = await import('playwright'));
  } catch (error) {
    humanLine(`Playwright is not installed: ${String(error?.message || error)}`);
    humanLine('Install it with: npm install');
    emitJson({schema: SCHEMA, ok: false, error: 'playwright-missing'});
    process.exitCode = 2;
    return;
  }
  selectBrowsersPath(chromium);
  const executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath)) {
    humanLine(SETUP_INSTRUCTIONS);
    humanLine(`Expected executable: ${executablePath}`);
    emitJson({schema: SCHEMA, ok: false, error: 'chromium-missing', executablePath, browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null});
    process.exitCode = 2;
    return;
  }

  const app = await readVersion(baseUrl);
  const launchArgs = ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--mute-audio'];
  humanLine(`browser-verify ${app.body?.version ?? '(unknown version)'} ${identity.commitShort ? `@ ${identity.commitShort}` : ''} (${baseUrl})`);
  humanLine(`artifacts: ${pathToArtifact(runDirectory)}`);

  let browser;
  const viewports = [];
  const manifestFailures = [];
  try {
    browser = await chromium.launch({headless: !headed, args: launchArgs});
    humanLine(`chromium ${browser.version()} headless=${!headed} browsersPath=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(default)'}`);
    const matrix = VIEWPORT_MATRIX.filter(viewport => !options.only || options.only.includes(viewport.id));
    if (!matrix.length) throw new Error(`--only matched no viewports: ${options.only?.join(',')}`);
    for (const definition of matrix) {
      humanLine(`  running ${definition.label} (${definition.inputMode}${definition.uiScale !== 1 ? `, ui-scale ${definition.uiScale}` : ''})...`);
      const record = await verifyViewport(browser, {
        definition,
        baseUrl,
        runId,
        runDirectory,
        deviceScaleFactor,
        timeoutMs,
        navigationTimeoutMs,
        hudTimeoutMs,
        launchAttempts,
        settleMs,
        trace,
      });
      viewports.push(record);
      humanLine(`  ${record.result === 'pass' ? 'PASS' : 'FAIL'} ${definition.label} renderer=${record.renderer ?? 'unknown'}${record.screenshot ? ` ${record.screenshot}` : ''}`);
      for (const failure of record.failures) humanLine(`       - ${failure}`);
    }

    const finishedAt = new Date();
    const ok = app.ok && Boolean(app.body?.version) && viewports.every(record => record.result === 'pass');
    const manifest = {
      schema: SCHEMA,
      ok,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Date.now() - startedMs,
      command: 'node scripts/verify-browser.mjs',
      argv: process.argv.slice(2),
      baseUrl,
      commit: identity.commit,
      commitShort: identity.commitShort,
      commitDirty: identity.commitDirty,
      app: {
        source: '/api/version',
        version: app.body?.version ?? null,
        buildId: app.body?.buildId ?? null,
        buildIdNote: app.body?.buildId ? 'reported by /api/version' : '/api/version exposes no buildId as of v8.4; the git commit above is point-in-time harness evidence',
        status: app.status,
        ok: app.ok && Boolean(app.body?.version),
        response: app.body ?? null,
        error: app.error ?? null,
      },
      browser: {
        name: 'chromium',
        version: browser.version(),
        headless: !headed,
        launchArgs,
        executablePath,
        browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
      },
      matrix: matrix.map(({id, label, width, height, uiScale, inputMode}) => ({id, label, width, height, uiScale, inputMode})),
      deviceScaleFactor,
      trace,
      knownConsoleIgnores: KNOWN_CONSOLE_IGNORES.map(ignore => ({pattern: String(ignore.pattern), reason: ignore.reason})),
      viewports,
      failures: [
        ...(app.ok && app.body?.version ? [] : [`/api/version did not return a version: ${app.error ?? `status ${app.status}`}`]),
        ...viewports.flatMap(record => record.failures.map(failure => `${record.id}: ${failure}`)),
      ],
      notes: [
        'Technical evidence only: this is not human fun, comprehension, comfort or physical-device validation.',
        'The app must be running separately; this harness never starts or stops it.',
      ],
    };
    const manifestPath = path.join(runDirectory, 'manifest.json');
    let manifestWritten = false;
    try {
      await fsp.mkdir(runDirectory, {recursive: true});
      await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      manifestWritten = fs.existsSync(manifestPath);
      if (!manifestWritten) throw new Error('manifest file missing after write');
    } catch (error) {
      manifestFailures.push(`manifest write failed: ${String(error?.message || error)}`);
    }

    const failures = [...manifest.failures, ...manifestFailures];
    const okFinal = manifest.ok && manifestWritten && failures.length === 0;
    const passed = viewports.filter(record => record.result === 'pass').length;
    humanLine(`${passed}/${viewports.length} viewports passed in ${(manifest.durationMs / 1000).toFixed(1)}s${manifestWritten ? ` · ${pathToArtifact(manifestPath)}` : ' · MANIFEST NOT WRITTEN'}`);
    if (!manifestWritten) humanLine('manifest write failed; treating the run as failed');
    emitJson({
      schema: SCHEMA,
      ok: okFinal,
      baseUrl,
      version: manifest.app.version,
      commit: manifest.commit,
      commitDirty: manifest.commitDirty,
      browser: `${manifest.browser.name}/${manifest.browser.version}`,
      artifacts: pathToArtifact(runDirectory),
      manifest: manifestWritten ? pathToArtifact(manifestPath) : null,
      durationMs: manifest.durationMs,
      viewports: viewports.map(record => ({
        id: record.id,
        result: record.result,
        renderer: record.renderer,
        screenshot: record.screenshot,
        trace: record.trace,
        failures: record.failures,
      })),
      failures,
    });
    process.exitCode = okFinal ? 0 : 1;
  } catch (error) {
    humanLine(`browser-verify failed to run: ${String(error?.stack || error)}`);
    emitJson({schema: SCHEMA, ok: false, error: String(error?.message || error), artifacts: pathToArtifact(runDirectory)});
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
  }
}

main().catch(error => {
  humanLine(String(error?.stack || error));
  emitJson({schema: SCHEMA, ok: false, error: String(error?.message || error)});
  process.exitCode = 1;
});
