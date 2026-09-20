import {RELEASE_CODENAME, RELEASE_VERSION} from './changelog.mjs';
import {PROTOCOL_VERSION} from './protocol.mjs';

// Build identity shared by the web app and the authoritative game server.
//
// One release must be able to state exactly which commit, artifact set and wire
// protocol it is: the deploy gate, the HTTP status endpoints and the deployment
// verifier all read this module. Everything here is pure and deterministic -
// the caller passes the environment in, and nothing touches the filesystem or
// the clock - so the same inputs always produce the same identity.
export const DEFAULT_SERVICE = 'token-arena-web';
export const UNKNOWN_COMMIT = 'unknown';
// Identity fields are labels, not free text. A malformed variable is clamped
// and sanitized rather than trusted.
export const IDENTITY_LIMITS = Object.freeze({service: 64, release: 32, codename: 32, commit: 64, buildId: 128});

// Keep a conservative charset, collapse everything else to a single dash and
// trim the result. A field that sanitizes to nothing falls back, so a bad
// value can never erase a valid default.
const UNSAFE_CHARS = /[^A-Za-z0-9._:+-]+/g;
const safeField = (value, fallback, max) => {
 if (typeof value !== 'string') return fallback;
 const cleaned = value.replace(UNSAFE_CHARS, '-').replace(/-+/g, '-').replace(/^[-]+|[-]+$/g, '').slice(0, max).replace(/^[-]+|[-]+$/g, '');
 return cleaned || fallback;
};

/** The major protocol revision of a wire value, or null when it is not numeric. */
export function protocolMajor(value) {
 let number = value;
 if (typeof value === 'string') {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  number = Number(text);
 }
 return Number.isInteger(number) && number >= 0 && number <= 0x7fffffff ? number : null;
}

/**
 * The frozen identity for one service. `release` and `codename` fall back to the
 * running changelog, `commit` to "unknown" and `buildId` to `<release>-<commit>`,
 * so an unconfigured process still reports a truthful, checkable identity
 * instead of pretending to be identified.
 */
export function buildIdentity(env = process.env, service = DEFAULT_SERVICE) {
 const source = env && typeof env === 'object' ? env : {};
 const release = safeField(source.TOKEN_ARENA_RELEASE, RELEASE_VERSION, IDENTITY_LIMITS.release);
 const codename = safeField(source.TOKEN_ARENA_CODENAME, RELEASE_CODENAME, IDENTITY_LIMITS.codename);
 const commit = safeField(source.TOKEN_ARENA_COMMIT, UNKNOWN_COMMIT, IDENTITY_LIMITS.commit);
 const buildId = safeField(source.TOKEN_ARENA_BUILD_ID, `${release}-${commit}`, IDENTITY_LIMITS.buildId);
 return Object.freeze({
  service: safeField(service, DEFAULT_SERVICE, IDENTITY_LIMITS.service),
  release,
  codename,
  commit,
  buildId,
  protocol: PROTOCOL_VERSION,
 });
}
