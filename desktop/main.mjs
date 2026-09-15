import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_INDEX_URL,
  CONTENT_SECURITY_POLICY,
  isAllowedNavigation,
  isAllowedWindowOpen,
  validateSender,
} from './security.mjs';
import { installAppProtocol, registerAppScheme } from './protocol.mjs';

const dirName = path.dirname(fileURLToPath(import.meta.url));
const distDir = process.env.COCS_DIST_DIR ? path.resolve(process.env.COCS_DIST_DIR) : path.join(dirName, '..', 'dist-desktop');
const devUrl = process.env.COCS_DEV_URL ? process.env.COCS_DEV_URL.trim() : null;
const devOrigins = (process.env.COCS_DEV_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
if (devUrl) {
  try {
    devOrigins.push(new URL(devUrl).origin);
  } catch {}
}

const STEAM_METHODS = new Set([
  'init',
  'createLobby',
  'joinLobby',
  'listLobbies',
  'openInviteDialog',
  'readCloud',
  'writeCloud',
  'deleteCloud',
  'setStat',
  'storeStats',
  'unlockAchievement',
  'setRichPresence',
  'isSteamDeck',
]);

let mainWindow = null;
let steamInstance = null;
let steamLoadAttempted = false;

function hardenWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedWindowOpen(url, devOrigins)) return { action: 'allow' };
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, devOrigins)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, devOrigins)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(dirName, 'preload.mjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  return win;
}

function applySecurityHeaders() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith('app://')) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });
}

async function getSteam() {
  if (steamLoadAttempted) return steamInstance;
  steamLoadAttempted = true;
  try {
    const mod = await import('./steam.mjs');
    if (typeof mod?.createSteam !== 'function') return null;
    const appId = Number.parseInt(process.env.STEAM_APP_ID ?? '', 10);
    steamInstance = mod.createSteam({ appId: Number.isFinite(appId) ? appId : undefined });
    await steamInstance.init();
  } catch {
    steamInstance = null;
  }
  return steamInstance;
}

function guard(handler) {
  return async (event, ...args) => {
    const allowedId = mainWindow?.webContents?.id;
    if (!validateSender(event, allowedId)) throw new Error('Unauthorized IPC sender');
    return handler(...args);
  };
}

function registerIpc() {
  ipcMain.handle('cocs:app:version', guard(() => app.getVersion()));
  ipcMain.handle('cocs:app:ping', guard(() => ({ ok: true, ts: Date.now() })));
  ipcMain.handle('cocs:app:platform', guard(() => process.platform));
  ipcMain.handle(
    'cocs:steam:invoke',
    guard(async (payload = {}) => {
      const { method, params } = payload ?? {};
      if (typeof method !== 'string' || !STEAM_METHODS.has(method)) {
        return { ok: false, available: false, reason: 'steam-method-not-allowed' };
      }
      const steam = await getSteam();
      if (!steam || typeof steam[method] !== 'function') {
        return { ok: false, available: false, reason: 'steam-unavailable' };
      }
      if (method !== 'init' && !steam.available) {
        return { ok: false, available: false, reason: 'steam-unavailable' };
      }
      try {
        const args = Array.isArray(params) ? params : params == null ? [] : [params];
        const value = await steam[method](...args);
        return { ok: true, available: !!steam.available, value: value ?? null };
      } catch (error) {
        return { ok: false, available: !!steam.available, reason: 'steam-error', message: String(error?.message ?? error) };
      }
    }),
  );
}

function attachSmokeTest(win) {
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(
        `(async () => {
          const spa = await fetch('app://bundle/missing-route').then(r => ({ status: r.status, type: r.headers.get('content-type') })).catch(e => ({ error: String(e) }));
          const traversal = await fetch('app://bundle/..%2f..%2fetc/passwd').then(r => r.status).catch(e => String(e));
          const scriptSrc = document.querySelector('script[type="module"][src]')?.src ?? null;
          const script = scriptSrc ? await fetch(scriptSrc).then(r => ({ status: r.status, type: r.headers.get('content-type') })).catch(e => ({ error: String(e) })) : null;
          const cssHref = document.querySelector('link[rel="stylesheet"]')?.href ?? null;
          const css = cssHref ? await fetch(cssHref).then(r => ({ status: r.status, type: r.headers.get('content-type') })).catch(e => ({ error: String(e) })) : null;
          return {
            hasApi: !!window.cocs,
            platform: window.cocs ? window.cocs.platform : null,
            version: window.cocs ? await window.cocs.getVersion() : null,
            ping: window.cocs ? await window.cocs.ping() : null,
            steam: window.cocs ? await window.cocs.steam.invoke('isSteamDeck', []) : null,
            assetLoaded: !!window.__assetLoaded,
            spaFallback: spa,
            traversalStatus: traversal,
            scriptSrc,
            script,
            cssHref,
            css,
            stylesheetCount: document.styleSheets.length,
          };
        })()`,
      );
      console.log('COCS_SMOKE_RESULT', JSON.stringify(result));
    } catch (error) {
      console.log('COCS_SMOKE_ERROR', String(error?.message ?? error));
    }
    setTimeout(() => app.quit(), 100);
  });
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.log('COCS_SMOKE_FAIL', errorCode, errorDescription, validatedURL);
    app.quit();
  });
}

async function start() {
  installAppProtocol({ rootDir: distDir, contentSecurityPolicy: CONTENT_SECURITY_POLICY });
  applySecurityHeaders();
  registerIpc();

  mainWindow = createWindow();
  if (process.env.COCS_SMOKE_TEST) attachSmokeTest(mainWindow);

  try {
    await mainWindow.loadURL(devUrl ?? APP_INDEX_URL);
  } catch (error) {
    console.error('COCS_LOAD_FAILED', String(error?.message ?? error));
  }
}

app.on('web-contents-created', (event, contents) => hardenWebContents(contents));
app.on('window-all-closed', () => app.quit());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.enableSandbox();
  registerAppScheme();
  app.whenReady().then(start);
}
