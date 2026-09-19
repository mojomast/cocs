import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 START_RATING,
 RATING_FLOOR,
 RATING_CEILING,
 PLACEMENT_MATCHES,
 K_PLACEMENT,
 K_DUEL,
 K_TEAM,
 MAX_DELTA,
 clampRating,
 expectedScore,
 isProvisional,
 kFor,
 isRankedMode,
 rankFor,
 settleMatch,
 normalizeLadderRecord,
 defaultLadderRecord,
} from './ranked.mjs';

const settled = rating => ({rating, matches: PLACEMENT_MATCHES});
const fresh = rating => ({rating, matches: 0});

test('expectedScore is symmetric and monotonic in rating', () => {
 assert.equal(expectedScore(1000, 1000), 0.5);
 assert.ok(expectedScore(1200, 1000) > 0.5);
 assert.ok(expectedScore(1000, 1200) < 0.5);
 assert.ok(Math.abs(expectedScore(1000, 1200) + expectedScore(1200, 1000) - 1) < 1e-12);
 assert.equal(expectedScore(NaN, 1000), 0.5);
});

test('K factor rises for placements and falls for team modes', () => {
 assert.equal(kFor(0, 1), K_PLACEMENT);
 assert.equal(kFor(PLACEMENT_MATCHES - 1, 4), K_PLACEMENT);
 assert.equal(kFor(PLACEMENT_MATCHES, 1), K_DUEL);
 assert.equal(kFor(PLACEMENT_MATCHES, 4), K_TEAM);
 assert.equal(isProvisional(0), true);
 assert.equal(isProvisional(PLACEMENT_MATCHES), false);
});

test('a 1v1 between equal settled players is zero-sum and symmetric', () => {
 const settlement = settleMatch({teams: [['a'], ['b']], scores: [1, 0], players: {a: settled(1000), b: settled(1000)}});
 assert.ok(settlement);
 const [winner, loser] = settlement.entries;
 assert.equal(winner.delta, K_DUEL / 2, 'even matchup swings by half the K factor');
 assert.equal(loser.delta, -K_DUEL / 2);
 assert.equal(winner.ratingAfter, 1016);
 assert.equal(loser.ratingAfter, 984);
 assert.equal(settlement.totalDelta, 0);
 assert.equal(settlement.zeroSum, true);
 assert.equal(settlement.entries.every(entry => entry.placement === false), true);
});

test('an underdog win pays more than a favourite win', () => {
 const underdog = settleMatch({teams: [['a'], ['b']], scores: [1, 0], players: {a: settled(800), b: settled(1200)}});
 const favourite = settleMatch({teams: [['a'], ['b']], scores: [1, 0], players: {a: settled(1200), b: settled(800)}});
 assert.ok(underdog.entries[0].delta > favourite.entries[0].delta, 'the underdog winner gains more');
 assert.ok(favourite.entries[1].delta > underdog.entries[1].delta, 'the favourite loser drops more than the underdog loser');
 assert.equal(underdog.totalDelta, 0);
 assert.equal(favourite.totalDelta, 0);
});

test('placement matches use the larger K and are flagged', () => {
 const settlement = settleMatch({teams: [['a'], ['b']], scores: [1, 0], players: {a: fresh(1000), b: fresh(1000)}});
 assert.equal(settlement.entries[0].delta, K_PLACEMENT / 2);
 assert.equal(settlement.entries[0].placement, true);
 assert.equal(settlement.provisionalCount, 2);
});

test('team modes stay zero-sum and reward the under-rated team-mate', () => {
 const players = {a: settled(900), b: settled(1300), c: settled(1100), d: settled(1100)};
 const settlement = settleMatch({teams: [['a', 'b'], ['c', 'd']], scores: [1, 0], players});
 assert.equal(settlement.totalDelta, 0);
 assert.equal(settlement.zeroSum, true);
 const gain = id => settlement.entries.find(entry => entry.playerId === id);
 assert.ok(gain('a').delta > gain('b').delta, 'the 900-rated winner gains more than the 1300-rated winner');
 assert.ok(gain('d').delta < 0 && gain('c').delta < 0);
 assert.equal(gain('a').k, K_TEAM);
 assert.ok(Math.abs(gain('a').delta) <= MAX_DELTA);
});

test('a mixed provisional/settled team still settles exactly zero-sum', () => {
 const players = {a: fresh(1000), b: settled(1000), c: settled(1000), d: settled(1000)};
 const settlement = settleMatch({teams: [['a', 'b'], ['c', 'd']], scores: [1, 0], players});
 assert.equal(settlement.totalDelta, 0);
 assert.equal(settlement.provisionalCount, 1);
 assert.equal(settlement.entries.find(entry => entry.playerId === 'a').placement, true);
});

test('draws move nobody when ratings are level', () => {
 const settlement = settleMatch({teams: [['a'], ['b']], scores: [0.5, 0.5], players: {a: settled(1000), b: settled(1000)}});
 assert.deepEqual(settlement.entries.map(entry => entry.delta), [0, 0]);
});

test('floor and ceiling clamp deltas and absorb the overflow', () => {
 const atTop = settleMatch({teams: [['a'], ['b']], scores: [1, 0], players: {a: settled(RATING_CEILING), b: settled(RATING_CEILING - 50)}});
 assert.equal(atTop.entries[0].ratingAfter, RATING_CEILING);
 assert.equal(atTop.entries[0].delta, 0);
 assert.equal(atTop.entries[0].capped, true);
 const atBottom = settleMatch({teams: [['a'], ['b']], scores: [1, 0], players: {a: settled(RATING_FLOOR + 50), b: settled(RATING_FLOOR)}});
 assert.equal(atBottom.entries[1].ratingAfter, RATING_FLOOR);
 assert.equal(atBottom.entries[1].delta, 0);
 assert.equal(atBottom.entries[1].capped, true);
 assert.ok(atBottom.entries[0].delta > 0);
 assert.equal(clampRating(-500), RATING_FLOOR);
 assert.equal(clampRating(99999), RATING_CEILING);
});

test('individual deltas never exceed the cap and settling is deterministic', () => {
 const input = {teams: [['a', 'b'], ['c', 'd']], scores: [0, 1], players: {a: settled(3000), b: settled(300), c: settled(500), d: settled(2500)}};
 const first = settleMatch(input);
 const again = settleMatch({...input, players: {...input.players}});
 assert.deepEqual(first, again);
 assert.equal(first.totalDelta, 0);
 for (const entry of first.entries) assert.ok(Math.abs(entry.rawDelta) <= MAX_DELTA, `${entry.playerId} raw ${entry.rawDelta}`);
 assert.equal(input.players.a.rating, 3000, 'the input roster is never mutated');
});

test('repeated mirrored matches keep the ladder bounded (no inflation)', () => {
 const players = {a: settled(1000), b: settled(1000)};
 let first = players.a.rating, second = players.b.rating;
 for (let i = 0; i < 200; i++) {
  const winner = i % 2 === 0 ? 0 : 1;
  const settlement = settleMatch({teams: [['a'], ['b']], scores: winner === 0 ? [1, 0] : [0, 1], players: {a: {rating: first, matches: PLACEMENT_MATCHES}, b: {rating: second, matches: PLACEMENT_MATCHES}}});
  assert.equal(settlement.totalDelta, 0, `match ${i} created points`);
  first = settlement.entries.find(entry => entry.playerId === 'a').ratingAfter;
  second = settlement.entries.find(entry => entry.playerId === 'b').ratingAfter;
  assert.ok(Math.abs(first - START_RATING) <= MAX_DELTA, `rating ${first} stayed bounded`);
 }
 assert.equal(first + second, START_RATING * 2, 'alternating results conserve the total');
});

test('multi-side FFA settlements are zero-sum too', () => {
 const players = {a: settled(1000), b: settled(1100), c: settled(900), d: settled(1050)};
 const settlement = settleMatch({teams: [['a'], ['b'], ['c'], ['d']], scores: [1, 0, 0, 0], players});
 assert.equal(settlement.totalDelta, 0);
 assert.ok(settlement.entries.find(entry => entry.playerId === 'a').delta > 0);
});

test('rankFor maps every rating band to a named division', () => {
 const bands = [RATING_FLOOR, 600, 900, 1200, 1500, 1800, RATING_CEILING];
 const labels = bands.map(rating => rankFor(rating, 0));
 assert.deepEqual(labels.map(rank => rank.tierName), ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'MASTER']);
 for (const rank of labels) {
  assert.match(rank.label, /^[A-Z]+ (I|II|III)$/);
  assert.ok(rank.progress >= 0 && rank.progress < 1);
 }
 assert.equal(rankFor(START_RATING, 0).label, 'GOLD II');
 assert.equal(rankFor(START_RATING, PLACEMENT_MATCHES - 1).provisional, true);
 assert.equal(rankFor(START_RATING, PLACEMENT_MATCHES).provisional, false);
 assert.ok(rankFor(START_RATING + 50).progress > rankFor(START_RATING).progress);
});

test('normalizeLadderRecord sanitizes persisted ratings', () => {
 assert.equal(normalizeLadderRecord(null), null);
 assert.equal(normalizeLadderRecord({rating: 'nope'}), null);
 const record = normalizeLadderRecord({rating: 99999, matches: -3, peak: 4000, lastDelta: 900, lastMatchId: 'm'.repeat(120)});
 assert.equal(record.rating, RATING_CEILING);
 assert.equal(record.matches, 0);
 assert.equal(record.lastDelta, MAX_DELTA);
 assert.equal(record.lastMatchId.length, 64);
 assert.deepEqual(defaultLadderRecord(), {rating: START_RATING, matches: 0, peak: START_RATING, lastDelta: 0, lastMatchId: null});
});

test('isRankedMode excludes vehicle, solo and co-op modes', () => {
 for (const mode of ['deathmatch', 'teamdeathmatch', 'ctf', 'cocs', 'juggernaut']) assert.equal(isRankedMode(mode), true, mode);
 for (const mode of ['puma-race', 'puma-soccer', 'horde', 'campaign', 'cocs-coop', 'unknown', null]) assert.equal(isRankedMode(mode), false, String(mode));
});

test('malformed settlements return null instead of throwing', () => {
 assert.equal(settleMatch({teams: [['a']], scores: [1], players: {a: settled(1000)}}), null);
 assert.equal(settleMatch({teams: [['a'], []], scores: [1, 0], players: {a: settled(1000)}}), null);
 assert.equal(settleMatch({teams: [['a'], ['a']], scores: [1, 0], players: {a: settled(1000)}}), null);
 assert.equal(settleMatch({}), null);
});

test('the pure module never reads randomness or the clock', async () => {
 const source = await readFile(new URL('./ranked.mjs', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /Math\.random|Date\.now|new Date|performance\.now/);
});
