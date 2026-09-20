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

// The lobby lifecycle surface mirrors server-owned tallies and sends only the
// four verbs. Every control is a labelled, worded button in a named group; the
// surface adds no live region (the existing polite channels stay the only ones).
test('the lobby lifecycle surface is labelled, word-cued and free of new live regions', async () => {
 const src = await readFile(new URL('app/ui/screens/NetScreens.tsx', root), 'utf8');
 assert.match(src, /aria-label="Lobby readiness"/, 'the readiness block is a named group');
 assert.match(src, /aria-label="Map votes"/, 'the map-vote block is a named group');
 assert.match(src, /aria-label="Rematch vote"/, 'the rematch block is a named group');
 assert.match(src, /aria-pressed=\{p\.ready===true\}/, 'the ready toggle exposes its pressed state');
 assert.match(src, /aria-label=\{p\.ready===true\?/, 'the ready toggle is labelled with its action');
 assert.match(src, /START WARMUP/, 'the warmup gate names the host start path');
 assert.match(src, /READINESS/, 'readiness is named in words');
 assert.match(src, /VOTE FOR MAP/, 'the vote control is a worded button');
 assert.match(src, /REMATCH VOTE CAST/, 'the rematch button names the cast state in words');
 assert.ok(!src.includes('aria-live'), 'the surface adds no live region');
});

// Destructive leaves: a live or rated-unfinished room confirms first, and the
// seat-hold window is surfaced where the reconnect affordance already exists.
test('leaving a live or rated room asks first and surfaces the seat-hold window', async () => {
 const [screens, modals] = await Promise.all([
  readFile(new URL('app/ui/screens/NetScreens.tsx', root), 'utf8'),
  readFile(new URL('app/ui/screens/ResultModals.tsx', root), 'utf8'),
 ]);
 assert.ok(screens.includes('leaveNeedsConfirm({started:net.started===true,roundOver:net.roundOver===true,rated:ratedRoom})'), 'the lobby gates DISCONNECT');
 assert.ok(screens.includes('title="Leave this match?"'), 'the lobby confirm dialog exists');
 assert.ok(screens.includes("SEAT HELD ~"), 'the lobby names the seat-hold estimate');
 assert.ok(screens.includes('onClick={reconnectNet}'), 'the reconnect affordance stays');
 assert.ok(modals.includes('leaveNeedsConfirm({started:net?.started===true,roundOver:net?.roundOver===true,rated:ratedRoom})'), 'the results footer gates LEAVE SERVER');
 assert.ok(modals.includes('title="Leave the server?"'), 'the results confirm dialog exists');
 assert.ok(modals.includes('disconnectNet:requestLeave'), 'the leave-server action routes through the gate');
});
