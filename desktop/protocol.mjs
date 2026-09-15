import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let electronApi = null;

function loadElectron() {
  if (!electronApi) electronApi = require('electron');
  return electronApi;
}

export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.data': 'application/octet-stream',
});

export function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function resolveRequestPath(rootDir, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:`) return null;
  if (url.host !== APP_HOST) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const root = path.resolve(rootDir);
  const relative = pathname.replace(/^[/\\]+/, '');
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

export function registerAppScheme() {
  const { protocol } = loadElectron();
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true,
        allowServiceWorkers: true,
        corsEnabled: true,
        bypassCSP: false,
      },
    },
  ]);
}

async function fileInfo(candidate) {
  try {
    return await stat(candidate);
  } catch {
    return null;
  }
}

async function serveFile(filePath, contentSecurityPolicy) {
  const { net } = loadElectron();
  const response = await net.fetch(pathToFileURL(filePath).toString());
  const headers = new Headers(response.headers);
  headers.set('Content-Type', mimeTypeFor(filePath));
  headers.set('X-Content-Type-Options', 'nosniff');
  if (contentSecurityPolicy && mimeTypeFor(filePath).startsWith('text/html')) {
    headers.set('Content-Security-Policy', contentSecurityPolicy);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function errorResponse(status, message, contentSecurityPolicy) {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
  if (contentSecurityPolicy) headers['Content-Security-Policy'] = contentSecurityPolicy;
  return new Response(message, { status, headers });
}

export function installAppProtocol({ rootDir, contentSecurityPolicy = null }) {
  const { protocol } = loadElectron();
  const root = path.resolve(rootDir);
  protocol.handle(APP_SCHEME, async (request) => {
    const resolved = resolveRequestPath(root, request.url);
    if (!resolved) return errorResponse(403, 'Forbidden', contentSecurityPolicy);

    const info = await fileInfo(resolved);
    if (info?.isFile()) return serveFile(resolved, contentSecurityPolicy);
    if (info?.isDirectory()) {
      const dirIndex = path.join(resolved, 'index.html');
      if ((await fileInfo(dirIndex))?.isFile()) return serveFile(dirIndex, contentSecurityPolicy);
    }

    let hasExtension = true;
    try {
      hasExtension = path.extname(new URL(request.url).pathname) !== '';
    } catch {}
    if (!hasExtension) {
      const spaIndex = path.join(root, 'index.html');
      if ((await fileInfo(spaIndex))?.isFile()) return serveFile(spaIndex, contentSecurityPolicy);
    }
    return errorResponse(404, 'Not Found', contentSecurityPolicy);
  });
}
