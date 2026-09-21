import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {RELEASE_CODENAME,RELEASE_VERSION} from '../game/changelog.mjs';
import {PROTOCOL_VERSION} from '../game/protocol.mjs';
import {buildIdentity,protocolMajor} from '../game/build-identity.mjs';

// The title-screen footer is the release of record. Matching it exactly (and
// only there) rejects a document whose footer still names an older release even
// when the new version string appears elsewhere in the HTML.
const TITLE_FOOTER = /<div[^>]*class="title-footer"[^>]*>\s*<span>([^<]*)<\/span>/;

/** The exact release string from the title footer, or null when it is absent. */
export function titleFooter(html) {
 const match = String(html).match(TITLE_FOOTER);
 return match ? match[1].trim() : null;
}

export function linkedAssets(html) {
 const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:css|js))(?:\?[^"]*)?"/g)].map(match => match[1]).filter(path => path.startsWith('/'));
 return [...new Set(refs)];
}

export async function verifyDeployment(base, {fetchImpl = fetch, version = RELEASE_VERSION, codename = RELEASE_CODENAME, assetsDir = null} = {}) {
 const response = await fetchImpl(new URL('/', base), {signal: AbortSignal.timeout(15000), cache: 'no-store'});
 assert.equal(response.status, 200, 'HTML must return 200');
 assert.match(response.headers.get('content-type') || '', /^text\/html\b/i);
 // The document references content-hashed assets, so it must revalidate. A
 // cached HTML can otherwise keep a browser on a bundle that no longer exists.
 assert.match(response.headers.get('cache-control') || '', /no-cache|no-store/i, 'HTML must send Cache-Control: no-cache/no-store');
 const html = await response.text();
 // A caller may pass either a bare version or an already-complete release
 // string; the served footer must equal it exactly.
 const expectedFooter = version.includes(' · ') ? version : `${version} · ${codename}`;
 assert.equal(titleFooter(html), expectedFooter, `Title footer must be exactly "${expectedFooter}"`);
 const assets = linkedAssets(html);
 assert.ok(assets.some(path => path.endsWith('.css')), 'HTML must link a stylesheet');
 assert.ok(assets.some(path => path.endsWith('.js')), 'HTML must link a JavaScript entry');
 await Promise.all(assets.map(async path => {
  const asset = await fetchImpl(new URL(path, base), {signal: AbortSignal.timeout(15000), cache: 'no-store'});
  assert.equal(asset.status, 200, `${path} must return 200`);
  const css = path.endsWith('.css');
  assert.match(asset.headers.get('content-type') || '', css ? /^text\/css\b/i : /^(?:application|text)\/(?:javascript|ecmascript)\b/i, `${path} content type`);
  const body = await asset.text();
  assert.ok(body.length > 0, `${path} must not be empty`);
  if (assetsDir) {
   const root = resolve(assetsDir);
   const localPath = resolve(root, `.${decodeURIComponent(new URL(path, base).pathname)}`);
   assert.ok(localPath.startsWith(root + sep), `${path} must resolve inside the built client directory`);
   let built;
   try { built = await readFile(localPath, 'utf8'); }
   catch { assert.fail(`${path} is absent from this build; the service may be serving a stale checkout`); }
   assert.ok(body === built, `${path} must match the freshly built asset bytes`);
  }
 }));
 return assets;
}

const readIdentity = async (fetchImpl, url, label) => {
 const response = await fetchImpl(url, {signal: AbortSignal.timeout(15000), cache: 'no-store'});
 assert.equal(response.status, 200, `${label} identity endpoint must return 200`);
 let body;
 try { body = await response.json(); } catch { assert.fail(`${label} identity endpoint must return JSON`); }
 assert.ok(body && typeof body === 'object' && !Array.isArray(body), `${label} identity must be a JSON object`);
 return body;
};

/**
 * Verify the exact web and game-server build identities. Every field checked is
 * compared with strict equality: a version substring or a value that merely
 * contains the expected commit never passes. `server: 'compatible'` is the
 * declared-compatibility mode for a web-only release, where the previous game
 * server may keep serving as long as its protocol major matches; the exact mode
 * is the default and requires both services to report the same identity.
 */
export async function verifyIdentities(base, serverBase, {fetchImpl = fetch, expected = {}, server = 'exact'} = {}) {
 assert.ok(expected && typeof expected === 'object', 'expected identity must be an object');
 assert.ok(server === 'exact' || server === 'compatible', `unknown server identity mode: ${server}`);
 const want = {
  release: expected.release ?? RELEASE_VERSION,
  codename: expected.codename ?? RELEASE_CODENAME,
  commit: expected.commit,
  buildId: expected.buildId,
  protocol: expected.protocol ?? PROTOCOL_VERSION,
 };
 const web = await readIdentity(fetchImpl, new URL('/api/version', base), 'web');
 const game = await readIdentity(fetchImpl, new URL('/', serverBase), 'game server');
 assert.equal(web.service, 'token-arena-web', 'web identity must report service "token-arena-web"');
 assert.equal(game.service, 'token-arena-game-server', 'game server identity must report service "token-arena-game-server"');
 assert.equal(typeof web.commit, 'string', 'web identity must report a commit');
 assert.equal(typeof web.buildId, 'string', 'web identity must report a buildId');
 assert.equal(web.release ?? web.version, want.release, `web release must be exactly "${want.release}"`);
 if (want.codename) assert.equal(web.codename, want.codename, `web codename must be exactly "${want.codename}"`);
 if (want.commit !== undefined) assert.equal(web.commit, want.commit, `web commit must be exactly "${want.commit}"`);
 if (want.buildId !== undefined) assert.equal(web.buildId, want.buildId, `web buildId must be exactly "${want.buildId}"`);
 if (want.protocol !== undefined) assert.equal(web.protocol, want.protocol, `web protocol must be exactly ${want.protocol}`);
 if (server === 'compatible') {
  // Web-only releases may retain the previous identified server. It must still
  // declare the same protocol major and expose a real identity; commit,
  // buildId and release are allowed to lag behind the web build.
  assert.equal(typeof game.commit, 'string', 'game server identity must report a commit');
  assert.equal(typeof game.buildId, 'string', 'game server identity must report a buildId');
  assert.equal(typeof (game.release ?? game.version), 'string', 'game server identity must report a release');
  const serverMajor = protocolMajor(game.protocol);
  const expectedMajor = protocolMajor(want.protocol);
  assert.ok(expectedMajor !== null, `expected protocol must be numeric, got ${want.protocol}`);
  assert.equal(serverMajor, expectedMajor, `game server protocol major must be exactly v${expectedMajor}`);
  return {web, server: game};
 }
 if (want.commit !== undefined) assert.equal(game.commit, want.commit, `game server commit must be exactly "${want.commit}"`);
 if (want.buildId !== undefined) assert.equal(game.buildId, want.buildId, `game server buildId must be exactly "${want.buildId}"`);
 assert.equal(game.release ?? game.version, want.release, `game server release must be exactly "${want.release}"`);
 if (want.codename) assert.equal(game.codename, want.codename, `game server codename must be exactly "${want.codename}"`);
 if (want.protocol !== undefined) assert.equal(game.protocol, want.protocol, `game server protocol must be exactly ${want.protocol}`);
 // The pair is only a matching release when both services report the same
 // identified artifacts, not merely the same release label.
 assert.equal(game.commit, web.commit, `game server commit "${game.commit}" must match web commit "${web.commit}"`);
 assert.equal(game.buildId, web.buildId, `game server buildId "${game.buildId}" must match web buildId "${web.buildId}"`);
 return {web, server: game};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const flags = new Set();
 const positional = [];
  let serverBase = process.env.TOKEN_ARENA_SERVER_URL || `http://127.0.0.1:${process.env.GAME_SERVER_PORT || 4000}`;
  let assetsDir = null;
 const argv = process.argv.slice(2);
 for (let index = 0; index < argv.length; index++) {
  const arg = argv[index];
   if (arg === '--server') { serverBase = argv[++index] ?? serverBase; continue; }
   if (arg === '--assets-dir') { assetsDir = argv[++index]; assert.ok(assetsDir, '--assets-dir requires a directory'); continue; }
  if (arg.startsWith('--server=')) { serverBase = arg.slice('--server='.length); continue; }
  if (arg.startsWith('--')) { flags.add(arg); continue; }
  positional.push(arg);
 }
 try {
  const base = positional[0] || 'https://arena.ussyco.de';
  const local = buildIdentity(process.env);
  const version = positional[1] || local.release;
  const release = version.includes(' · ') ? version : `${version} · ${local.codename}`;
   const assets = await verifyDeployment(base, {version, codename: local.codename, assetsDir});
  console.log(`Verified ${base}: title footer "${release}" and ${assets.length} linked CSS/JavaScript assets`);
  for (const asset of assets) console.log(`  200 ${asset}`);
  // Identity checks run when the caller can name the expected commit
  // (deploy.sh exports TOKEN_ARENA_COMMIT) or explicitly asks with
  // --identities. Without a known commit the pair must still agree with each
  // other and with the local release/protocol.
  if (flags.has('--identities') || process.env.TOKEN_ARENA_COMMIT) {
   const expected = {...local};
   if (!process.env.TOKEN_ARENA_COMMIT) { delete expected.commit; delete expected.buildId; }
   const mode = flags.has('--compatible-server') ? 'compatible' : 'exact';
   const {web, server} = await verifyIdentities(base, serverBase, {expected, server: mode});
   console.log(`Verified ${mode} identities: web ${web.commit} ${web.buildId} protocol ${web.protocol}; game server ${server.commit} ${server.buildId} protocol ${server.protocol}`);
  }
 } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
 }
}
