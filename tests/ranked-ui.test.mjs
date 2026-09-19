import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);

// Ranked accessibility guard in the same read-the-source style as the UI
// contract test: every ranked state cue must pair its colour/shape with words,
// and the queue toggle must expose a labelled, checked state instead of relying
// on the accent colour alone.
test('ranked online screens pair colour cues with shape and words', async () => {
 const src = await readFile(new URL('app/ui/screens/NetScreens.tsx', root), 'utf8');
 const primitives = await readFile(new URL('app/ui/primitives.tsx', root), 'utf8');
 assert.match(src, /ariaLabel="Matchmaking queue"/, 'the ranked toggle is a labelled control');
 assert.match(src, /<Segmented value=\{queueMode\}/, 'the toggle reuses the accessible segmented primitive');
 assert.match(primitives, /role="tablist"/, 'the segmented primitive is a labelled group');
 assert.match(primitives, /aria-selected/, 'the segmented primitive exposes its selected state');
 assert.ok(src.includes("?'✓ ':''}UNRANKED"), 'the unranked choice shows a text check when selected');
 assert.ok(src.includes("?'✓ ':''}RANKED"), 'the ranked choice shows a text check when selected');
 assert.match(src, /RANKED LADDER/, 'the browse screen names the ladder panel');
 assert.match(src, /RATINGS ARE SERVER-AUTHORITATIVE/, 'the rating source is stated in words');
 assert.match(src, /PLACEMENTS \$\{/, 'placement progress is worded, not only numeric');
 assert.match(src, /deltaShape=\(delta:number\)=>/, 'gains and losses get a shape');
 assert.match(src, /▲/, 'the gain shape is rendered');
 assert.match(src, /▼/, 'the loss shape is rendered');
 assert.match(src, /deltaWord=\(delta:number\)=>/, 'gains and losses get a word');
 assert.match(src, /GAINED/, 'the gain word is rendered');
 assert.match(src, /LOST/, 'the loss word is rendered');
 assert.match(src, /aria-hidden="true"/, 'decorative glyphs are hidden from assistive tech');
 assert.match(src, /RANKED · RATED MATCH/, 'the lobby labels a rated room in words');
});

test('the page wires the ranked fields the screens read', async () => {
 const page = await readFile(new URL('app/page.tsx', root), 'utf8');
 for (const field of ['ranked:netRanked', 'rankedQueued:netQueued', 'queueRanked,cancelQueue']) {
  assert.ok(page.includes(field), `ui bag provides ${field}`);
 }
 assert.match(page, /ranked:true/, 'the client queues ranked over the existing message type');
 assert.match(page, /progressToken:n\.progressToken/, 'the queue request carries the career token for verification');
});
