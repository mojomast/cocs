import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export function linkedAssets(html) {
  return [...new Set(html.match(/\/assets\/[A-Za-z0-9_.-]+\.(?:css|js)\b/g) || [])];
}

export async function verifyDeployment(base, {fetchImpl = fetch, version = ''} = {}) {
  const response = await fetchImpl(new URL('/', base), {signal: AbortSignal.timeout(15000), cache: 'no-store'});
  assert.equal(response.status, 200, 'HTML must return 200');
  assert.match(response.headers.get('content-type') || '', /^text\/html\b/i);
  const html = await response.text();
  if (version) assert.ok(html.includes(version), `Expected release ${version}`);
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
  }));
  return assets;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const base = process.argv[2] || 'https://arena.ussyco.de';
    const assets = await verifyDeployment(base, {version: process.argv[3] || ''});
    console.log(`Verified ${base}: HTML and ${assets.length} linked CSS/JavaScript assets`);
    for (const asset of assets) console.log(`  200 ${asset}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
