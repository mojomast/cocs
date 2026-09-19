// Ranked V2 ladder math.
//
// Pure by construction: no randomness, no wall clock, no I/O and no mutation of
// inputs. The server owns the authoritative profiles and match results; this
// module only turns a finished match into rating deltas so the queue, the
// settlement pass and the tests all agree on one deterministic contract.
//
// Rating contract (v1)
// --------------------
// * Every career starts at START_RATING (1000) and is clamped to
//   [RATING_FLOOR, RATING_CEILING].
// * Expected score is the classic Elo curve: E(a, b) = 1 / (1 + 10^((b-a)/400)).
// * A team's score is 1 for a win, 0 for a loss and 0.5 for a draw. Each member
//   is rated against the *opponent roster average*, so an under-rated player on
//   a winning team gains more than their over-rated team-mate and converges to
//   their own skill instead of the team's average.
// * K factor: 48 while a career is provisional (< PLACEMENT_MATCHES rated
//   matches), then 32 in duels (team size 1) and 24 in team modes. Provisional
//   players move faster; settled teams move slower to damp 4v4 noise.
// * Each individual delta is capped at +/-MAX_DELTA.
// * Every settlement is made zero-sum: after rounding, a deterministic
//   1-point correction redistributes any drift so the sum of applied deltas is
//   exactly 0. A match therefore creates no ladder points. Clamping at the
//   floor/ceiling is the only exception: points pushed into a boundary are
//   absorbed there and never respawn elsewhere.
// * Placement matches are ordinary rated matches with a larger K; a career
//   stops being provisional after PLACEMENT_MATCHES.
export const LADDER_VERSION = 1;
export const START_RATING = 1000;
export const RATING_FLOOR = 100;
export const RATING_CEILING = 3500;
export const PLACEMENT_MATCHES = 10;
export const K_PLACEMENT = 48;
export const K_DUEL = 32;
export const K_TEAM = 24;
export const MAX_DELTA = 64;
export const RATING_SCALE = 400;
// Ranked queue admission. Vehicle modes, single-player operations and the
// co-op LATTICE operation are excluded; the PvPvE `cocs` rung is included.
export const RANKED_MODES = Object.freeze([
 'deathmatch', 'teamdeathmatch', 'ctf', 'koth', 'domination', 'assault',
 'payload', 'juggernaut', 'armsrace', 'team-elimination', 'vip-escort', 'cocs',
]);
// Tier bands are 300 wide above Silver so a climb reads as a steady ladder.
// `min` is the lowest rating still inside the tier.
export const TIERS = Object.freeze([
 Object.freeze({id: 'bronze', name: 'BRONZE', min: RATING_FLOOR}),
 Object.freeze({id: 'silver', name: 'SILVER', min: 600}),
 Object.freeze({id: 'gold', name: 'GOLD', min: 900}),
 Object.freeze({id: 'platinum', name: 'PLATINUM', min: 1200}),
 Object.freeze({id: 'diamond', name: 'DIAMOND', min: 1500}),
 Object.freeze({id: 'master', name: 'MASTER', min: 1800}),
]);
const DIVISIONS = ['I', 'II', 'III'];

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const count = value => Math.max(0, Math.floor(finite(value) ?? 0));

export function clampRating(value) {
 const rating = finite(value);
 if (rating === null) return START_RATING;
 return Math.max(RATING_FLOOR, Math.min(RATING_CEILING, Math.round(rating)));
}

export function expectedScore(rating, opponent) {
 const a = finite(rating), b = finite(opponent);
 if (a === null || b === null) return 0.5;
 return 1 / (1 + Math.pow(10, (b - a) / RATING_SCALE));
}

export function isProvisional(matches) {
 return count(matches) < PLACEMENT_MATCHES;
}

export function kFor(matches, teamSize = 1) {
 if (isProvisional(matches)) return K_PLACEMENT;
 return count(teamSize) > 1 ? K_TEAM : K_DUEL;
}

export function isRankedMode(mode) {
 const id = typeof mode === 'string' ? mode : mode?.mode;
 return RANKED_MODES.includes(id);
}

export function defaultLadderRecord() {
 return {rating: START_RATING, matches: 0, peak: START_RATING, lastDelta: 0, lastMatchId: null};
}

// Sanitize a persisted ladder record. Returns null when the entry cannot be a
// rating at all so a corrupt store drops the row instead of mutating numbers.
export function normalizeLadderRecord(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
 if (finite(value.rating) === null) return null;
 const rating = clampRating(value.rating);
 const peak = finite(value.peak) === null ? rating : Math.max(rating, clampRating(value.peak));
 return {
  rating,
  matches: count(value.matches),
  peak,
  lastDelta: Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(finite(value.lastDelta) ?? 0))),
  lastMatchId: typeof value.lastMatchId === 'string' && value.lastMatchId ? value.lastMatchId.slice(0, 64) : null,
 };
}

// Display projection for the ladder: tier, division and progress to the next
// tier. Pure so the server lobby payload and the client render agree.
export function rankFor(rating, matches = 0) {
 const value = clampRating(rating);
 const played = count(matches);
 let index = 0;
 for (let i = 0; i < TIERS.length; i++) if (value >= TIERS[i].min) index = i;
 const tier = TIERS[index];
 const next = TIERS[index + 1] ?? null;
 const span = (next ? next.min : RATING_CEILING + 1) - tier.min;
 const progress = span > 0 ? Math.max(0, Math.min(0.999, (value - tier.min) / span)) : 0;
 const division = progress < 1 / 3 ? 3 : progress < 2 / 3 ? 2 : 1;
 return {
  rating: value,
  tier: tier.id,
  tierName: tier.name,
  division,
  label: `${tier.name} ${DIVISIONS[division - 1]}`,
  min: tier.min,
  nextAt: next ? next.min : null,
  progress,
  provisional: played < PLACEMENT_MATCHES,
  matches: played,
 };
}

// Deterministic +-1 correction so the sum of deltas is exactly zero. The
// largest magnitude delta absorbs the drift first; ties break on roster order,
// so the same input always produces the same output.
function balanceDeltas(deltas) {
 const out = [...deltas];
 let sum = out.reduce((total, delta) => total + delta, 0);
 let guard = out.length * MAX_DELTA + out.length;
 while (sum !== 0 && guard-- > 0) {
  let pick = -1;
  for (let i = 0; i < out.length; i++) {
   if (sum > 0 ? out[i] <= 0 : out[i] >= 0) continue;
   if (pick < 0 || Math.abs(out[i]) > Math.abs(out[pick])) pick = i;
  }
  if (pick < 0) break;
  out[pick] += sum > 0 ? -1 : 1;
  sum += sum > 0 ? -1 : 1;
 }
 return out;
}

// Turn a finished match into rating deltas.
//
// `teams`   - array of arrays of player ids (two or more teams; in FFA pass one
//             team per player).
// `scores`  - per-team result in [0,1]: 1 win, 0 loss, 0.5 draw.
// `players` - map (or plain object) of player id -> {rating, matches}.
//
// Returns null for malformed input (fewer than two sides, empty sides or a
// player listed twice) instead of throwing, so a bad authoritative snapshot
// can never crash the settlement pass.
export function settleMatch({teams = [], scores = [], players = {}} = {}) {
 const roster = players instanceof Map ? players : new Map(Object.entries(players ?? {}));
 const groups = (Array.isArray(teams) ? teams : []).map((team, index) => ({
  index,
  members: (Array.isArray(team) ? team : []).map(id => String(id)).filter(Boolean),
  score: Math.max(0, Math.min(1, finite(scores?.[index]) ?? 0)),
 })).filter(group => group.members.length);
 if (groups.length < 2) return null;
 const seen = new Set();
 for (const group of groups) for (const id of group.members) {
  if (seen.has(id)) return null;
  seen.add(id);
 }
 const ratingOf = id => {
  const entry = roster.get(id);
  return {rating: clampRating(entry?.rating), matches: count(entry?.matches)};
 };
 const entries = [];
 groups.forEach((group, groupIndex) => {
  const opponents = [];
  groups.forEach((other, otherIndex) => { if (otherIndex !== groupIndex) opponents.push(...other.members.map(ratingOf)); });
  const opponentAverage = opponents.length ? opponents.reduce((total, entry) => total + entry.rating, 0) / opponents.length : START_RATING;
  group.opponentAverage = opponentAverage;
  group.raw = [];
  group.members.forEach(id => {
   const record = ratingOf(id);
   const expected = expectedScore(record.rating, opponentAverage);
   const k = kFor(record.matches, group.members.length);
   const raw = Math.round(k * (group.score - expected)) + 0;
   group.raw.push(Math.max(-MAX_DELTA, Math.min(MAX_DELTA, raw)));
  });
 });
 const flatRaw = groups.flatMap(group => group.raw);
 const balanced = balanceDeltas(flatRaw);
 let cursor = 0;
 for (const group of groups) {
  const members = group.members.map(id => {
   const record = ratingOf(id);
   const rawDelta = balanced[cursor];
   const ratingAfter = clampRating(record.rating + rawDelta);
   const entry = {
    playerId: id,
    team: group.index,
    expected: Number(expectedScore(record.rating, group.opponentAverage).toFixed(6)),
    score: group.score,
    k: kFor(record.matches, group.members.length),
    ratingBefore: record.rating,
    ratingAfter,
    delta: ratingAfter - record.rating,
    rawDelta,
    capped: ratingAfter - record.rating !== rawDelta,
    matchesBefore: record.matches,
    matchesAfter: record.matches + 1,
    placement: isProvisional(record.matches),
   };
   cursor++;
   return entry;
  });
  entries.push(...members);
 }
 const totalDelta = entries.reduce((total, entry) => total + entry.delta, 0);
 return {
  version: LADDER_VERSION,
  teams: groups.map(group => ({
   index: group.index,
   members: [...group.members],
   average: Math.round(group.members.reduce((total, id) => total + ratingOf(id).rating, 0) / group.members.length),
   opponentAverage: Math.round(group.opponentAverage),
   score: group.score,
   delta: group.members.reduce((total, id) => {
    const entry = entries.find(item => item.playerId === id);
    return total + (entry?.delta ?? 0);
   }, 0),
  })),
  entries,
  totalDelta,
  zeroSum: totalDelta === 0,
  provisionalCount: entries.filter(entry => entry.placement).length,
 };
}
