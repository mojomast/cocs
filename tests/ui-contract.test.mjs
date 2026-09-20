import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

const root = new URL('../', import.meta.url);

// The `ui` bag in app/page.tsx is loosely typed, so a screen that reads a field
// the page never provides compiles fine but throws at runtime (undefined field
// used as a value/function). This guards that contract.
test('every app/ui screen field exists in the page ui bag', async () => {
  const page = await readFile(new URL('app/page.tsx', root), 'utf8');
  const start = page.indexOf('const ui:UiBag={');
  const end = page.indexOf('};', start);
  assert.ok(start >= 0 && end > start, 'ui bag literal found in app/page.tsx');
  const bag = page.slice(start, end);

  const dir = new URL('app/ui/screens/', root);
  const has = name => new RegExp('(^|[,{\\s])' + name + '\\s*[:,}]').test(bag);
  const failures = [];

  for (const file of await readdir(dir)) {
    if (!file.endsWith('.tsx')) continue;
    const src = await readFile(new URL(file, dir), 'utf8');
    // Module specifiers are not bag fields. Without this, importing
    // `game/class-ui.mjs` scans as a `ui.mjs` field read and fails the contract.
    const source = src.replace(/['"][^'"]*\.(?:mjs|js|ts|tsx)['"]/g, '""');
    const names = new Set();
    for (const m of source.matchAll(/const \{([^}]*)\}\s*=\s*ui;/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(':').pop().trim();
        if (name && !name.includes('=')) names.add(name);
      }
    }
    for (const m of source.matchAll(/\bui\.([A-Za-z0-9_]+)/g)) names.add(m[1]);
    const missing = [...names].filter(name => !has(name));
    if (missing.length) failures.push(`${file}: ${missing.join(', ')}`);
  }

  assert.deepEqual(failures, [], `screens read ui fields the page does not provide:\n${failures.join('\n')}`);
});

// The lobby lifecycle surface and the measured RTT are consumed through the bag
// and the `net` snapshot. A screen reading these without a page binding would
// throw at runtime, so pin the exact wiring here.
test('the page wires the lobby lifecycle senders and the measured RTT', async () => {
 const page = await readFile(new URL('app/page.tsx', root), 'utf8');
 for (const field of ['netReady', 'netMapVote', 'netRematch', 'netWarmup']) {
  assert.ok(new RegExp(`(^|[,{\\s])${field}\\s*[,:]`).test(page), `the ui bag provides ${field}`);
  assert.ok(new RegExp(`const ${field}=`).test(page), `the page defines ${field}`);
 }
 assert.match(page, /rtt:Number\.isFinite\(n\?\.rtt\)\?n\.rtt:null/, 'netInfo carries the measured RTT');
 assert.match(page, /lifecycle:n\?\.lifecycle\?\?null/, 'netInfo carries the lobby lifecycle verbatim');
 assert.match(page, /disconnectedAt:Number\.isFinite\(n\?\.disconnectedAt\)/, 'netInfo carries the observed disconnect for the seat-hold estimate');
 assert.match(page, /stampLocalPing\(hud,/, 'the live scoreboard stamps the measured RTT onto the local row');
});
