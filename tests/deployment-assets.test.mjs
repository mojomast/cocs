import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {linkedAssets, titleFooter, verifyDeployment, verifyIdentities} from '../scripts/verify-deployment.mjs';
import {buildIdentity, protocolMajor, IDENTITY_LIMITS, UNKNOWN_COMMIT} from '../game/build-identity.mjs';
import {RELEASE_CODENAME, RELEASE_VERSION} from '../game/changelog.mjs';
import {PROTOCOL_VERSION} from '../game/protocol.mjs';

const footer = 'v2.62 · ECHO';
const html = `<link rel="stylesheet" href="/assets/index-abc.css"><script src="/assets/index-xyz.js"></script><div class="title-footer"><span>${footer}</span></div>`;
const serve = (broken, body = html) => async url => {
  if (url.pathname === '/') return new Response(body, {headers: {'content-type': 'text/html', 'cache-control': 'no-cache'}});
  if (broken && url.pathname.endsWith('.css')) return new Response('Not found', {status: 404});
  return new Response('content', {headers: {'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'}});
};

test('asset verification checks and deduplicates stylesheet and script references', async () => {
  assert.deepEqual(linkedAssets(html + html), ['/assets/index-abc.css', '/assets/index-xyz.js']);
  assert.equal(titleFooter(html), footer);
  assert.equal((await verifyDeployment('https://example.test', {fetchImpl: serve(false), version: 'v2.62', codename: 'ECHO'})).length, 2);
});

test('preload and modulepreload asset references are verified too', async () => {
  const preload = '<link rel="modulepreload" href="/assets/chunk-def.js"><link rel="preload" as="style" href="/assets/theme-ghi.css">';
  assert.deepEqual(linkedAssets(preload), ['/assets/chunk-def.js', '/assets/theme-ghi.css']);
});

test('a cacheable HTML document is rejected', async () => {
  const cached = async url => url.pathname === '/'
    ? new Response(html, {headers: {'content-type': 'text/html'}})
    : new Response('content', {headers: {'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'}});
  await assert.rejects(verifyDeployment('https://example.test', {fetchImpl: cached}), /Cache-Control/);
});

test('successful HTML cannot hide missing CSS or a stale release', async () => {
  await assert.rejects(verifyDeployment('https://example.test', {fetchImpl: serve(true), version: 'v2.62', codename: 'ECHO'}), /index-abc.css must return 200/);
  await assert.rejects(verifyDeployment('https://example.test', {fetchImpl: serve(false), version: 'v9.99', codename: 'FIELDCRAFT'}), /Title footer/);
});

test('a stale title footer is rejected even when the expected release appears elsewhere', async () => {
  const stale = html.replace(footer, 'v8.3 · CLARITY') + '<p>Now running v8.4 · FIELDCRAFT</p>';
  // The previous substring check would have accepted this document.
  assert.ok(stale.includes('v8.4 · FIELDCRAFT'));
  await assert.rejects(
    verifyDeployment('https://example.test', {fetchImpl: serve(false, stale), version: 'v8.4', codename: 'FIELDCRAFT'}),
    /Title footer must be exactly "v8\.4 · FIELDCRAFT"/,
  );
});

test('HTML without a title footer is rejected', async () => {
  const noFooter = '<link rel="stylesheet" href="/assets/index-abc.css"><script src="/assets/index-xyz.js"></script>';
  await assert.rejects(verifyDeployment('https://example.test', {fetchImpl: serve(false, noFooter), version: 'v2.62', codename: 'ECHO'}), /Title footer/);
});

test('asset HTML fallbacks are rejected even when they return 200', async () => {
  const fallback = async () => new Response(html, {headers: {'content-type': 'text/html', 'cache-control': 'no-cache'}});
  await assert.rejects(verifyDeployment('https://example.test', {fetchImpl: fallback, version: 'v2.62', codename: 'ECHO'}), /content type/);
});

test('SSR deployments verify actual artifact bytes without needing a client index.html', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arena-assets-'));
  try {
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets/index-abc.css'), 'content');
    await writeFile(join(dir, 'assets/index-xyz.js'), 'content');
    const options = {fetchImpl: serve(false), version: 'v2.62', codename: 'ECHO', assetsDir: dir};
    assert.equal((await verifyDeployment('https://example.test', options)).length, 2);
    await writeFile(join(dir, 'assets/index-xyz.js'), 'new build');
    await assert.rejects(verifyDeployment('https://example.test', options), /freshly built asset bytes/);
    await rm(join(dir, 'assets/index-xyz.js'));
    await assert.rejects(verifyDeployment('https://example.test', options), /absent from this build/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

// --- build identity ----------------------------------------------------------

const webIdentity = (overrides = {}) => ({
  service: 'token-arena-web',
  version: 'v2.62', release: 'v2.62', codename: 'ECHO',
  commit: 'abc1234', buildId: 'v2.62-abc1234', protocol: 3,
  ...overrides,
});
const gameIdentity = (overrides = {}) => webIdentity({service: 'token-arena-game-server', ...overrides});
const serveIdentities = (web, server) => async url => {
  if (url.pathname === '/api/version') return Response.json(web);
  if (url.pathname === '/') return Response.json(server);
  return new Response('Not found', {status: 404});
};
const expected = {release: 'v2.62', codename: 'ECHO', commit: 'abc1234', buildId: 'v2.62-abc1234', protocol: 3};

test('buildIdentity defaults to the changelog release and freezes the result', () => {
  const identity = buildIdentity({});
  assert.deepEqual(identity, {
    service: 'token-arena-web',
    release: RELEASE_VERSION,
    codename: RELEASE_CODENAME,
    commit: UNKNOWN_COMMIT,
    buildId: `${RELEASE_VERSION}-${UNKNOWN_COMMIT}`,
    protocol: PROTOCOL_VERSION,
  });
  assert.ok(Object.isFrozen(identity));
  assert.throws(() => { identity.commit = 'mutated'; }, TypeError);
});

test('buildIdentity honors explicit env overrides and the service argument', () => {
  const identity = buildIdentity({
    TOKEN_ARENA_RELEASE: 'v9.9',
    TOKEN_ARENA_CODENAME: 'TESTCELL',
    TOKEN_ARENA_COMMIT: 'deadbee',
    TOKEN_ARENA_BUILD_ID: 'build-42',
  }, 'token-arena-game-server');
  assert.equal(identity.service, 'token-arena-game-server');
  assert.equal(identity.release, 'v9.9');
  assert.equal(identity.codename, 'TESTCELL');
  assert.equal(identity.commit, 'deadbee');
  assert.equal(identity.buildId, 'build-42');
  assert.equal(identity.protocol, PROTOCOL_VERSION);
  assert.equal(buildIdentity({TOKEN_ARENA_COMMIT: 'deadbee'}).buildId, `${RELEASE_VERSION}-deadbee`);
});

test('buildIdentity clamps long fields and rejects unsafe or empty values', () => {
  const identity = buildIdentity({
    TOKEN_ARENA_RELEASE: 'v'.repeat(200),
    TOKEN_ARENA_CODENAME: 'FIELD\nCRAFT\u0000',
    TOKEN_ARENA_COMMIT: 'c'.repeat(400),
    TOKEN_ARENA_BUILD_ID: 'b'.repeat(400),
  });
  assert.equal(identity.release.length, IDENTITY_LIMITS.release);
  assert.equal(identity.codename, 'FIELD-CRAFT');
  assert.equal(identity.commit.length, IDENTITY_LIMITS.commit);
  assert.equal(identity.buildId.length, IDENTITY_LIMITS.buildId);
  assert.equal(buildIdentity({TOKEN_ARENA_COMMIT: 12345}).commit, UNKNOWN_COMMIT);
  assert.equal(buildIdentity({TOKEN_ARENA_CODENAME: '   '}).codename, RELEASE_CODENAME);
  assert.equal(buildIdentity(null).release, RELEASE_VERSION);
  assert.equal(protocolMajor('3'), 3);
  assert.equal(protocolMajor('2.5'), null);
  assert.equal(protocolMajor(-1), null);
  assert.equal(protocolMajor('two'), null);
});

test('buildIdentity is deterministic and does not mutate or ignore its environment', () => {
  const env = Object.freeze({TOKEN_ARENA_COMMIT: 'f00baa'});
  const first = buildIdentity(env);
  const second = buildIdentity(env);
  assert.deepEqual(first, second);
  assert.equal(first.commit, 'f00baa');
  const saved = process.env.TOKEN_ARENA_COMMIT;
  process.env.TOKEN_ARENA_COMMIT = 'from-process-env';
  try {
    assert.equal(buildIdentity({}).commit, UNKNOWN_COMMIT, 'an explicit env argument never falls through to process.env');
    assert.equal(buildIdentity().commit, 'from-process-env', 'the default argument reads process.env');
  } finally {
    if (saved === undefined) delete process.env.TOKEN_ARENA_COMMIT;
    else process.env.TOKEN_ARENA_COMMIT = saved;
  }
});

test('verifyIdentities accepts two services with the exact same identity', async () => {
  const {web, server} = await verifyIdentities('https://web.test', 'https://game.test', {
    fetchImpl: serveIdentities(webIdentity(), gameIdentity()),
    expected,
  });
  assert.equal(web.commit, 'abc1234');
  assert.equal(server.buildId, 'v2.62-abc1234');
});

test('verifyIdentities rejects a commit or buildId that only contains the expected value', async () => {
  // A substring check would accept abc12345 for abc1234; exact identity must not.
  await assert.rejects(
    verifyIdentities('https://web.test', 'https://game.test', {fetchImpl: serveIdentities(webIdentity({commit: 'abc12345'}), gameIdentity()), expected}),
    /web commit must be exactly "abc1234"/,
  );
  await assert.rejects(
    verifyIdentities('https://web.test', 'https://game.test', {fetchImpl: serveIdentities(webIdentity(), gameIdentity({buildId: 'v2.62-abc1234-extra'})), expected}),
    /game server buildId must be exactly "v2\.62-abc1234"/,
  );
});

test('verifyIdentities rejects a differing protocol or release', async () => {
  await assert.rejects(
    verifyIdentities('https://web.test', 'https://game.test', {fetchImpl: serveIdentities(webIdentity({protocol: PROTOCOL_VERSION + 1}), gameIdentity()), expected}),
    /web protocol must be exactly/,
  );
  await assert.rejects(
    verifyIdentities('https://web.test', 'https://game.test', {fetchImpl: serveIdentities(webIdentity(), gameIdentity({protocol: 99})), expected}),
    /game server protocol must be exactly/,
  );
  await assert.rejects(
    verifyIdentities('https://web.test', 'https://game.test', {fetchImpl: serveIdentities(webIdentity({release: 'v2.62.1', version: 'v2.62.1'}), gameIdentity()), expected}),
    /web release must be exactly "v2\.62"/,
  );
  await assert.rejects(
    verifyIdentities('https://web.test', 'https://game.test', {fetchImpl: serveIdentities(webIdentity(), gameIdentity({service: 'token-arena-web'})), expected}),
    /game server identity must report service/,
  );
});

test('verifyIdentities requires the web and game server to agree on the pair', async () => {
  const noCommit = {release: 'v2.62', codename: 'ECHO', protocol: 3};
  await assert.rejects(
    verifyIdentities('https://web.test', 'https://game.test', {
      fetchImpl: serveIdentities(webIdentity({commit: 'aaaaaaa'}), gameIdentity({commit: 'bbbbbbb'})),
      expected: noCommit,
    }),
    /game server commit "bbbbbbb" must match web commit "aaaaaaa"/,
  );
});

test('verifyIdentities compatible mode allows an older identified server with the same protocol', async () => {
  const older = gameIdentity({release: 'v2.61', version: 'v2.61', commit: '9999999', buildId: 'v2.61-9999999'});
  const {server} = await verifyIdentities('https://web.test', 'https://game.test', {
    fetchImpl: serveIdentities(webIdentity(), older),
    expected,
    server: 'compatible',
  });
  assert.equal(server.commit, '9999999');
  await assert.rejects(
    verifyIdentities('https://web.test', 'https://game.test', {
      fetchImpl: serveIdentities(webIdentity(), gameIdentity({protocol: PROTOCOL_VERSION + 1})),
      expected,
      server: 'compatible',
    }),
    /game server protocol major must be exactly/,
  );
  await assert.rejects(
    verifyIdentities('https://web.test', 'https://game.test', {
      fetchImpl: serveIdentities(webIdentity(), gameIdentity({protocol: null})),
      expected,
      server: 'compatible',
    }),
    /protocol major/,
  );
});
