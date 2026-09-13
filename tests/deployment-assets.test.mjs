import assert from 'node:assert/strict';
import test from 'node:test';
import {linkedAssets, verifyDeployment} from '../scripts/verify-deployment.mjs';

const html = '<link rel="stylesheet" href="/assets/index-abc.css"><script src="/assets/index-xyz.js"></script>v2.62';
const serve = broken => async url => {
  if (url.pathname === '/') return new Response(html, {headers: {'content-type': 'text/html'}});
  if (broken && url.pathname.endsWith('.css')) return new Response('Not found', {status: 404});
  return new Response('content', {headers: {'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'}});
};

test('asset verification checks and deduplicates stylesheet and script references', async () => {
  assert.deepEqual(linkedAssets(html + html), ['/assets/index-abc.css', '/assets/index-xyz.js']);
  assert.equal((await verifyDeployment('https://example.test', {fetchImpl: serve(false), version: 'v2.62'})).length, 2);
});

test('successful HTML cannot hide missing CSS or a stale release', async () => {
  await assert.rejects(verifyDeployment('https://example.test', {fetchImpl: serve(true)}), /index-abc.css must return 200/);
  await assert.rejects(verifyDeployment('https://example.test', {fetchImpl: serve(false), version: 'v9.99'}), /Expected release/);
});

test('asset HTML fallbacks are rejected even when they return 200', async () => {
  await assert.rejects(verifyDeployment('https://example.test', {fetchImpl: async () => new Response(html, {headers: {'content-type': 'text/html'}})}), /content type/);
});
