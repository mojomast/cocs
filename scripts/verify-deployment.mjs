import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export function linkedAssets(html) {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:css|js))(?:\?[^"]*)?"/g)].map(match => match[1]).filter(path => path.startsWith('/'));
  return [...new Set(refs)];
}

export async function verifyDeployment(base, {fetchImpl = fetch, version = ''} = {}) {
  const response = await fetchImpl(new URL('/', base), {signal: AbortSignal.timeout(15000), cache: 'no-store'});
  assert.equal(response.status, 200, 'HTML must return 200');
  assert.match(response.headers.get('content-type') || '', /^text\/html\b/i);
  // The document references content-hashed assets, so it must revalidate. A
  // cached HTML can otherwise keep a browser on a bundle that no longer exists.
  assert.match(response.headers.get('cache-control') || '', /no-cache|no-store/i, 'HTML must send Cache-Control: no-cache/no-store');
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
