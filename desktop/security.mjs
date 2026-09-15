export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https: wss: ws:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function isAppUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST;
}

function matchesAllowedOrigin(value, allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return allowedOrigins.some((origin) => {
    try {
      return url.origin === new URL(origin).origin;
    } catch {
      return false;
    }
  });
}

export function isAllowedNavigation(value, allowedOrigins = []) {
  return isAppUrl(value) || matchesAllowedOrigin(value, allowedOrigins);
}

export function isAllowedWindowOpen(value, allowedOrigins = []) {
  return isAppUrl(value) || matchesAllowedOrigin(value, allowedOrigins);
}

export function validateSender(event, allowedWebContentsId) {
  const sender = event?.sender;
  if (!sender) return false;
  if (typeof allowedWebContentsId !== 'number' || sender.id !== allowedWebContentsId) return false;
  const frame = event?.senderFrame;
  if (frame && sender.mainFrame && frame !== sender.mainFrame) return false;
  if (frame && typeof frame.url === 'string' && frame.url !== '' && !isAppUrl(frame.url)) return false;
  return true;
}
