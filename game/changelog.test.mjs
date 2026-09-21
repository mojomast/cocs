import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CHANGELOG,RELEASE_VERSION,RELEASE_CODENAME,changelogReleases,FULL_CHANGELOG_URL} from './changelog.mjs';

test('the changelog is ordered newest-first with complete entries', () => {
  const releases = changelogReleases();
  assert.equal(releases.length, CHANGELOG.length);
  assert.equal(releases[0].version, RELEASE_VERSION, 'the newest entry is the running release');
  for (const release of releases) {
    assert.match(release.version, /^v\d+\.\d+(?:\.\d+)?$/, 'version is vX.Y or vX.Y.Z');
    assert.ok(Array.isArray(release.highlights) && release.highlights.length > 0, `${release.version} has highlights`);
    assert.ok(release.highlights.every(line => typeof line === 'string' && line.length > 0), `${release.version} highlights are non-empty strings`);
  }
  const numbers = releases.map(release => release.version.replace(/^v/, '').split('.').map(Number));
  for (let i = 1; i < numbers.length; i++) {
    const [a1, a2, a3=0] = numbers[i - 1], [b1, b2, b3=0] = numbers[i];
    assert.ok(a1 > b1 || (a1 === b1 && (a2 > b2 || (a2 === b2 && a3 >= b3))), `release order at index ${i} is descending`);
  }
});

test('the running release matches the title-screen footer', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const footer = page.match(/<div className="title-footer"><span>([^<]+)</);
  assert.ok(footer, 'the footer literal is present in app/page.tsx');
  assert.equal(footer[1], `${RELEASE_VERSION} · ${RELEASE_CODENAME}`);
});

test('the full changelog link points at the repository docs', () => {
  assert.match(FULL_CHANGELOG_URL, /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/main\/docs\/CHANGELOG\.md$/);
});
