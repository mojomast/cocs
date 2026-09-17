// Balance sweep library — COCS class & harness overhaul Phase 3D
// (docs/design/CLASS_OVERHAUL.md §7.5, §14).
//
// Pure and deterministic: every match is seeded by
//   seed = fnv1a32('mode|map|matchup|seedIndex|geared')
// and driven by an injected RNG, so a single manifest item re-runs identically
// on any host. There is no wall clock, no Math.random and no filesystem access
// in this module — the CLI (scripts/balance-sweep.mjs) owns I/O and timing.
//
// The report is a smoke alarm, not a judge (§4.2, §14): god/garbage tier
// bounds, locked-mode pairing floors, team-mode reachable answers, ability
// damage share and the §4.1 stat envelope. Sweeps are run twice: policy-on
// (class AI policies, for expression) and policy-neutral (one archetype for
// every seat, for balance). Tier alarms gate on the neutral sweep.
//
// Win rule: team modes use the authoritative team result; 4-player FFA pods
// count a top-half placement as a win, so every sample shares the same 50%
// baseline the 55/45 tier bounds assume (see `placementWinners`).

import {Match} from './core.mjs';
import {CHARACTERS, HARNESSES, RULES, WEAPONS} from './data.mjs';
import {teamMode} from './config.mjs';
import {arenaMeta, arenaSupportsMode, mapsForMode} from './arenas.mjs';
import {OPERATOR_KITS, SPECS} from './kits.mjs';
import {GEAR, GEAR_SLOTS, resolveGear} from './progression.mjs';
import {actorWon, compareRanks, rankTuple} from './outcome.mjs';

export const SWEEP_FORMAT = 1;
// 99% two-sided normal quantile for the Wilson score interval (§14).
export const WILSON_Z99 = 2.5758293035489004;
export const SEED_FORMULA = 'mode|map|matchup|seedIndex|geared';
// The neutral policy every seat shares on the balance sweep (§14): one
// mid-range archetype with no class or harness personality vote.
export const NEUTRAL_POLICY = Object.freeze({role: 'adaptive', personality: 'skirmisher', archetype: 'flanker'});

// Profile tables. Match count per policy = cycles × modes × maps × seeds:
//   smoke 9×4×2×2 = 144; full 9×5×4×5 = 900. Both profiles run two policies,
// so the documented budgets cover ~300 / ~1,800 matches (§14).
export const SWEEP_PROFILES = Object.freeze({
  smoke: Object.freeze({
    modes: Object.freeze(['deathmatch', 'teamdeathmatch', 'ctf', 'domination']),
    mapsPerMode: 2, seedIndexes: 2, cycles: 9, timeLimit: 60, difficulty: 'normal',
  }),
  full: Object.freeze({
    modes: Object.freeze(['deathmatch', 'teamdeathmatch', 'ctf', 'domination', 'koth']),
    mapsPerMode: 4, seedIndexes: 5, cycles: 9, timeLimit: 60, difficulty: 'normal',
  }),
});

// Balance-relevant map pools: compact arenas only. A warzone map's navigation
// graph costs ~20× a skirmish map per match, which would spend the whole budget
// before the sample size is useful, so the sweep curates small/fast arenas and
// falls back to a scale-then-span ranking for any mode without an entry.
export const SWEEP_MAPS = Object.freeze({
  deathmatch: Object.freeze(['crosswire', 'aether', 'skybreak', 'launchpad']),
  teamdeathmatch: Object.freeze(['crosswire', 'launchpad', 'citadel', 'aether']),
  ctf: Object.freeze(['citadel', 'launchpad', 'aether', 'skybreak']),
  domination: Object.freeze(['crosswire', 'aether', 'launchpad', 'citadel']),
  koth: Object.freeze(['crosswire', 'launchpad', 'aether', 'citadel']),
});
const SCALE_RANK = Object.freeze({skirmish: 0, battle: 1, warzone: 2});
const mapSpan = map => {
  const bounds = map.bounds || {minX: -14, maxX: 14, minZ: -14, maxZ: 14};
  return Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
};
// Deterministic map pool for a mode: curated list first (filtered to maps that
// actually support the mode), otherwise smallest scale, then smallest span,
// then map id. Pure, so the manifest is identical on every host.
export function sweepMapsForMode(mode, count) {
  const curated = (SWEEP_MAPS[mode] ?? []).filter(id => arenaSupportsMode(id, mode));
  const pool = curated.length ? curated : mapsForMode(mode).slice().sort((a, b) => {
    const scale = (SCALE_RANK[arenaMeta(a.id).scale] ?? 1) - (SCALE_RANK[arenaMeta(b.id).scale] ?? 1);
    return scale || mapSpan(a) - mapSpan(b) || a.id.localeCompare(b.id);
  }).map(map => map.id);
  return pool.slice(0, Math.max(1, count));
}

// Mode groups for the report and the Locked-mode / team-mode alarms (§4.2).
export const MODE_GROUPS = Object.freeze({
  locked: Object.freeze(['deathmatch', 'armsrace', 'juggernaut', 'instagib', 'rockets', 'arsenal']),
  team: Object.freeze(['ctf', 'koth', 'domination', 'assault', 'teamdeathmatch', 'combined-arms', 'payload', 'holdout', 'uplink', 'team-elimination', 'vip-escort', 'puma-soccer', 'horde', 'campaign']),
  race: Object.freeze(['puma-race']),
});
export function modeGroup(mode) {
  for (const group of Object.keys(MODE_GROUPS)) if (MODE_GROUPS[group].includes(mode)) return group;
  return teamMode(mode) ? 'team' : 'locked';
}
// Modes whose objective state can be completed by an actor. The garbage-tier
// "zero objective completions" alarm only applies to these (§14).
export function objectiveMode(mode) {
  return ['ctf', 'koth', 'domination', 'assault', 'combined-arms', 'payload', 'holdout', 'uplink', 'team-elimination', 'vip-escort', 'juggernaut', 'puma-soccer'].includes(mode);
}

// "Max gear" pass: the highest-level item in every slot (§4.8.6 runs the tier
// sweep stock and at max gear).
const highestBySlot = slot => GEAR.filter(item => item.slot === slot).sort((a, b) => b.level - a.level || String(a.id).localeCompare(String(b.id)))[0].id;
export const MAX_GEAR = Object.freeze(Object.fromEntries(GEAR_SLOTS.map(slot => [slot.id, highestBySlot(slot.id)])));

// ---------------------------------------------------------------------------
// Deterministic primitives
// ---------------------------------------------------------------------------
export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  const value = String(text);
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Repo deterministic-RNG pattern (game/core.test.mjs): a seeded 32-bit PRNG.
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sweepSeed(mode, map, matchup, seedIndex, geared) {
  return fnv1a32([mode, map, matchup, seedIndex, geared].join('|'));
}

// Wilson score interval (§14). n=0 returns the whole unit interval.
export function wilsonInterval(wins, n, z = WILSON_Z99) {
  const total = Math.max(0, Math.floor(n));
  if (!(total > 0)) return {lower: 0, upper: 1};
  const p = Math.min(1, Math.max(0, Number(wins) / total));
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return {lower: Math.max(0, (center - margin) / denominator), upper: Math.min(1, (center + margin) / denominator)};
}

// Linear-interpolated quantile over an ascending array (advisory TTK stats).
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

// ---------------------------------------------------------------------------
// Seed manifest
// ---------------------------------------------------------------------------
// One manifest item is one seeded match: {mode,map,matchup,seedIndex,geared}
// plus the pinned actor loadouts. `matchup` names the rotation pod (`ffa-<c>` /
// `team-<c>`), so `--only=<mode,matchup,seed>` reproduces alarms one match at a
// time. Map selection is deterministic (non-legacy maps that support the mode,
// sorted by id, first N); pods rotate 9 operators and 7 specs so every kit gets
// equal exposure inside a cycle.
export function buildManifest({profile = 'smoke', policy = 'neutral', geared = 'stock', modes, mapsPerMode, seedIndexes, cycles, timeLimit, difficulty} = {}) {
  const table = SWEEP_PROFILES[profile] ?? SWEEP_PROFILES.smoke;
  const modeList = modes ?? table.modes;
  const mapCount = mapsPerMode ?? table.mapsPerMode;
  const seedCount = seedIndexes ?? table.seedIndexes;
  const cycleCount = cycles ?? table.cycles;
  const items = [];
  for (let cycle = 0; cycle < cycleCount; cycle++) {
    for (const mode of modeList) {
      const team = modeGroup(mode) === 'team' && teamMode(mode);
      const size = team ? 6 : 4;
      const pool = sweepMapsForMode(mode, mapCount);
      const matchup = `${team ? 'team' : 'ffa'}-${cycle}`;
      for (const map of pool) {
        for (let seedIndex = 0; seedIndex < seedCount; seedIndex++) {
          const seed = sweepSeed(mode, map, matchup, seedIndex, geared);
          const actors = Array.from({length: size}, (_, seat) => {
            const index = cycle * size + seat;
            const character = CHARACTERS[index % CHARACTERS.length].id;
            const harness = HARNESSES[index % HARNESSES.length].id;
            const loadout = {id: seat, character, harness};
            if (geared === 'max') loadout.gear = {...MAX_GEAR};
            return loadout;
          });
          items.push({
            id: `${policy}:${geared}:${mode}:${map}:${matchup}:${seedIndex}`,
            policy, geared, mode, map, matchup, seedIndex, seed, team, size,
            timeLimit: timeLimit ?? table.timeLimit,
            difficulty: difficulty ?? table.difficulty,
            actors,
          });
        }
      }
    }
  }
  return {profile, policy, geared, seedFormula: SEED_FORMULA, items};
}

// `--only=<mode,matchup,seed>` filter. `seed` may be the manifest seedIndex or
// the full numeric seed; the map is deliberately ignored so a filter covers
// every map the manifest planned for that pod. A 4th field pins a map.
export function filterManifest(manifest, only) {
  const spec = parseOnly(only);
  if (!spec) return manifest.items;
  return manifest.items.filter(item => item.mode === spec.mode && item.matchup === spec.matchup
    && (spec.map === null || item.map === spec.map)
    && (spec.seed === String(item.seedIndex) || spec.seed === String(item.seed)));
}

export function parseOnly(only) {
  if (only === null || only === undefined || only === '') return null;
  const parts = String(only).split(',').map(part => part.trim());
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return {mode: parts[0], matchup: parts[1], seed: parts[2], map: parts[3] || null};
}

// ---------------------------------------------------------------------------
// Match execution
// ---------------------------------------------------------------------------
// Win rule. Team modes use the authoritative team result and the Juggernaut
// crown uses `actorWon`; every other locked mode (4-player FFA pods) counts a
// top-half placement as a win so the sample has the same 50% baseline as a
// team match (§14 compares win rates against 55/45).
//
// Ties are broken by damage dealt (descending), then actor id. Rank tuples are
// frags/objective-only, so on maps where deaths are frequently unattributed
// (falls/void, e.g. aether) two seats routinely tie; a bare `id` tie-break let
// the low-id seat win the pod for free and biased every FFA row. Damage dealt
// is already tracked per actor and is deterministic, so it is the fair second
// key. The id fallback only fires when damage also ties (e.g. 0-damage pods in
// synthetic fixtures), so a pod always has exactly floor(size/2) winners.
export const WIN_RULE = 'team=team-win; ffa=top-half-placement; tie=damage,id; juggernaut=actorWon';
const placementDamage = actor => Number(actor?.scoreStats?.damage) || 0;
export function placementWinners(match, mode) {
  if (teamMode(mode) || mode === 'juggernaut' || mode === 'puma-race' || mode === 'puma-soccer') return null;
  const actors = [...match.actors];
  actors.sort((a, b) => compareRanks(rankTuple(a, mode), rankTuple(b, mode))
    || placementDamage(b) - placementDamage(a)
    || a.id - b.id);
  return new Set(actors.slice(0, Math.floor(actors.length / 2)).map(actor => actor.id));
}

// Objective completions per actor, per mode. Win state is not an objective: a
// kit that never captures/returns/goals in objective modes is the garbage-tier
// signal, not a kit that simply lost.
export function objectiveCompletions(actor, mode) {
  const stats = actor?.scoreStats ?? {};
  const number = key => Number(stats[key]) || 0;
  if (mode === 'ctf') return number('captures');
  if (mode === 'puma-soccer') return Number(stats.goals) || 0;
  if (mode === 'juggernaut') return Number(actor?.points) > 0 ? 1 : 0;
  if (['assault', 'payload', 'uplink', 'vip-escort', 'koth', 'domination', 'combined-arms', 'holdout', 'team-elimination'].includes(mode)) {
    return number('objectiveCaptures');
  }
  return 0;
}

// Simulate one manifest item. The event buffer is drained every tick so the
// tracker sees every event even though core keeps only the last 300 (§14
// ability damage share needs tagged damage events end-to-end).
export function runManifestItem(item) {
  const rng = mulberry32(item.seed);
  const options = {
    mode: item.mode,
    botCount: item.actors.length - 1,
    humanCount: 1,
    aiSeats: true,
    difficulty: item.difficulty,
    timeLimit: item.timeLimit,
    loadouts: {0: item.actors[0]},
    botLoadouts: item.actors.slice(1),
  };
  if (item.policy === 'neutral') options.botPolicy = NEUTRAL_POLICY;
  const match = new Match(item.actors[0].character, item.actors[0].harness, rng, item.map, options);
  const tracker = createTracker(match, item);
  const maxSteps = Math.ceil(item.timeLimit / RULES.dt) + 4;
  while (!match.over && tracker.steps < maxSteps) {
    match.step(RULES.dt, {inputs: {}});
    tracker.afterStep();
  }
  return tracker.finish(match);
}

function createTracker(match, item) {
  const eventState = {
    moveStarted: new Map(),
    powers: new Map(),
    abilityDamage: new Map(),
    swaps: 0,
    ttkSamples: [],
    ttkByKit: new Map(),
    firstHit: new Map(), // victim id -> Map(killer id -> time of first hit since spawn)
  };
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const tracker = {
    steps: 0,
    afterStep() {
      this.steps++;
      for (const event of match.events) {
        const actor = Number.isInteger(event.actor) ? event.actor : null;
        if (event.type === 'spawn' && actor !== null) eventState.firstHit.set(actor, new Map());
        else if (event.type === 'damage' && actor !== null && Number.isInteger(event.source) && event.source !== actor) {
          let hits = eventState.firstHit.get(actor);
          if (!hits) { hits = new Map(); eventState.firstHit.set(actor, hits); }
          if (!hits.has(event.source)) hits.set(event.source, match.time);
          if (event.ability === true) eventState.abilityDamage.set(event.source, (eventState.abilityDamage.get(event.source) || 0) + (Number(event.amount) || 0));
        } else if (event.type === 'death' && actor !== null && Number.isInteger(event.killer) && event.killer !== actor && event.fall !== true) {
          const hits = eventState.firstHit.get(actor);
          const first = hits ? hits.get(event.killer) : undefined;
          if (Number.isFinite(first) && match.time >= first) {
            const sample = match.time - first;
            eventState.ttkSamples.push(sample);
            const killer = match.actors.find(entry => entry.id === event.killer);
            const key = killer ? `${killer.character}/${killer.harness}` : 'unknown';
            if (!eventState.ttkByKit.has(key)) eventState.ttkByKit.set(key, []);
            eventState.ttkByKit.get(key).push(sample);
          }
        } else if (event.type === 'move-start' && actor !== null) bump(eventState.moveStarted, actor);
        else if (event.type === 'power' && actor !== null) bump(eventState.powers, actor);
        else if (event.type === 'loadout-swap' || event.type === 'loadout-switch' || event.type === 'loadout') eventState.swaps++;
      }
      match.events.length = 0;
    },
    finish(finishedMatch) {
      const snapshot = finishedMatch.snapshot();
      const placement = placementWinners(finishedMatch, item.mode);
      const appearances = [];
      for (const actor of finishedMatch.actors) {
        const won = placement ? placement.has(actor.id) : actorWon(snapshot, item.mode, actor);
        appearances.push({
          id: actor.id,
          character: actor.character,
          harness: actor.harness,
          team: Number.isFinite(actor.team) ? actor.team : null,
          won,
          rank: rankTuple(actor, item.mode),
          frags: Number(actor.frags) || 0,
          deaths: Number(actor.deaths) || 0,
          damage: Number(actor.scoreStats?.damage) || 0,
          objectives: objectiveCompletions(actor, item.mode),
          objectiveTime: Number(actor.scoreStats?.objectiveTime) || 0,
          verbUses: eventState.moveStarted.get(actor.id) || 0,
          powers: eventState.powers.get(actor.id) || 0,
          abilityDamage: eventState.abilityDamage.get(actor.id) || 0,
          ttk: eventState.ttkByKit.get(`${actor.character}/${actor.harness}`) || [],
        });
      }
      return {
        item: {id: item.id, mode: item.mode, map: item.map, matchup: item.matchup, seedIndex: item.seedIndex, geared: item.geared, seed: item.seed},
        time: finishedMatch.time,
        over: finishedMatch.over,
        overReason: finishedMatch.overReason ?? null,
        teamScores: {...finishedMatch.teamScores},
        swaps: eventState.swaps,
        ttkSamples: eventState.ttkSamples.length,
        appearances,
      };
    },
  };
  return tracker;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
const mean = (sum, n) => (n > 0 ? sum / n : 0);
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

function emptyRow(key, label, wing = null) {
  return {
    key, label, wing, n: 0, wins: 0, draws: 0, kills: 0, deaths: 0, damage: 0,
    objectives: 0, objectiveMatches: 0, verbUses: 0, powers: 0, abilityDamage: 0,
    ttk: [], byMode: {}, byModeGroup: {},
  };
}

function rowMode(row, mode) {
  if (!row.byMode[mode]) row.byMode[mode] = emptyRow(mode, mode);
  return row.byMode[mode];
}

function addToRow(row, appearance) {
  const won = appearance.won === true ? 1 : 0;
  row.n++;
  row.wins += won;
  row.kills += appearance.frags;
  row.deaths += appearance.deaths;
  row.damage += appearance.damage;
  row.objectives += appearance.objectives;
  if (objectiveMode(appearance.mode)) row.objectiveMatches++;
  row.verbUses += appearance.verbUses;
  row.powers += appearance.powers;
  row.abilityDamage += appearance.abilityDamage;
  row.ttk.push(...appearance.ttk);
}

function finalizeRow(row) {
  const wins = row.wins, n = row.n;
  const interval = wilsonInterval(wins, n);
  const ttk = [...row.ttk].sort((a, b) => a - b);
  return {
    key: row.key,
    label: row.label,
    ...(row.wing ? {wing: row.wing} : {}),
    n, wins,
    winRate: round(mean(wins, n)),
    lower: round(interval.lower),
    upper: round(interval.upper),
    kills: row.kills,
    deaths: row.deaths,
    kd: round(row.deaths > 0 ? row.kills / row.deaths : row.kills),
    damage: round(row.damage, 2),
    damagePerLife: round(mean(row.damage, row.deaths + n)),
    objectives: row.objectives,
    objectiveMatches: row.objectiveMatches,
    verbUses: row.verbUses,
    verbUsesPerMatch: round(mean(row.verbUses, n)),
    powers: row.powers,
    abilityDamage: round(row.abilityDamage, 2),
    abilityShare: round(row.damage > 0 ? Math.min(1, row.abilityDamage / row.damage) : 0),
    ttk: ttk.length ? {n: ttk.length, p25: round(quantile(ttk, .25), 3), median: round(quantile(ttk, .5), 3), p75: round(quantile(ttk, .75), 3)} : null,
    byMode: Object.fromEntries(Object.entries(row.byMode).map(([mode, entry]) => [mode, finalizeRow(entry)])),
    byModeGroup: Object.fromEntries(Object.entries(row.byModeGroup).map(([group, entry]) => [group, finalizeRow(entry)])),
  };
}

function groupInto(map, key, label, appearance, wing = null) {
  if (!map.has(key)) map.set(key, emptyRow(key, label, wing));
  const row = map.get(key);
  addToRow(row, appearance);
  addToRow(rowMode(row, appearance.mode), appearance);
  const group = modeGroup(appearance.mode);
  if (!row.byModeGroup[group]) row.byModeGroup[group] = emptyRow(group, group);
  addToRow(row.byModeGroup[group], appearance);
}

const WING_BY_CHARACTER = Object.fromEntries(OPERATOR_KITS.map(kit => [kit.id, kit.wing]));

// Aggregate the executed items into the metric tree: tier rows by operator,
// spec, wing and combo, plus mode and mode-group breakdowns and the pairing
// tables used by the locked-floor / team-answers alarms.
export function summarizeRun({items, appearances, matches, policy, geared, profile}) {
  const operators = new Map(), specs = new Map(), wings = new Map(), kits = new Map(), byMode = new Map(), byModeGroup = new Map();
  for (const appearance of appearances) {
    const wing = WING_BY_CHARACTER[appearance.character] ?? null;
    groupInto(operators, appearance.character, appearance.character, appearance, wing);
    groupInto(specs, appearance.harness, appearance.harness, appearance);
    groupInto(wings, wing ?? 'unknown', wing ?? 'unknown', appearance, wing);
    groupInto(kits, `${appearance.character}/${appearance.harness}`, `${appearance.character}/${appearance.harness}`, appearance, wing);
    groupInto(byMode, appearance.mode, appearance.mode, appearance);
    groupInto(byModeGroup, modeGroup(appearance.mode), modeGroup(appearance.mode), appearance);
  }
  const lockedPairs = new Map(), teamPairs = new Map();
  for (const match of matches) {
    if (match.over !== true) continue;
    const group = modeGroup(match.mode);
    if (group === 'locked') {
      for (let a = 0; a < match.appearances.length; a++) {
        for (let b = a + 1; b < match.appearances.length; b++) {
          const first = match.appearances[a], second = match.appearances[b];
          if (first.character === second.character) continue;
          const [left, right] = String(first.character) < String(second.character) ? [first, second] : [second, first];
          const key = `${left.character}|${right.character}`;
          if (!lockedPairs.has(key)) lockedPairs.set(key, {a: left.character, b: right.character, aWins: 0, bWins: 0, n: 0});
          const pair = lockedPairs.get(key);
          const compare = compareRanks(rankTuple(first, match.mode), rankTuple(second, match.mode));
          const firstIsA = first === left;
          if (compare < 0) { if (firstIsA) pair.aWins += 1; else pair.bWins += 1; }
          else if (compare > 0) { if (firstIsA) pair.bWins += 1; else pair.aWins += 1; }
          else { pair.aWins += .5; pair.bWins += .5; }
          pair.n++;
        }
      }
    } else if (group === 'team') {
      const winners = match.appearances.filter(entry => entry.won === true);
      const losers = match.appearances.filter(entry => entry.won !== true);
      for (const winner of winners) for (const loser of losers) {
        if (winner.character === loser.character) continue;
        const key = `${winner.character}|${loser.character}`;
        if (!teamPairs.has(key)) teamPairs.set(key, {character: winner.character, opponent: loser.character, wins: 0, losses: 0});
        teamPairs.get(key).wins++;
        const reverse = `${loser.character}|${winner.character}`;
        if (!teamPairs.has(reverse)) teamPairs.set(reverse, {character: loser.character, opponent: winner.character, wins: 0, losses: 0});
        teamPairs.get(reverse).losses++;
      }
    }
  }
  const locked = [...lockedPairs.values()].map(pair => {
    const total = pair.aWins + pair.bWins;
    const aRate = total > 0 ? pair.aWins / total : 0;
    return {...pair, n: Math.round(total), aRate: round(aRate), bRate: round(1 - aRate), worst: round(Math.min(aRate, 1 - aRate))};
  }).sort((a, b) => a.worst - b.worst || a.a.localeCompare(b.a));
  const team = [...teamPairs.values()].map(pair => {
    const n = pair.wins + pair.losses;
    return {...pair, n, winRate: round(n > 0 ? pair.wins / n : 0)};
  }).sort((a, b) => a.character.localeCompare(b.character) || a.opponent.localeCompare(b.opponent));
  let swaps = 0;
  for (const match of matches) swaps += match.swaps || 0;
  const totalAppearances = Math.max(1, appearances.length);
  const withPresence = rows => rows.map(finalizeRow).map(row => ({...row, presence: round(row.n / totalAppearances)})).sort((a, b) => b.winRate - a.winRate || a.key.localeCompare(b.key));
  const operatorRows = withPresence([...operators.values()]);
  const specRows = withPresence([...specs.values()]);
  const wingRows = withPresence([...wings.values()]);
  const kitRows = withPresence([...kits.values()]);
  const modeGroupRows = [...byModeGroup.values()].map(finalizeRow).sort((a, b) => a.key.localeCompare(b.key));
  const summary = {
    policy, geared, profile,
    matches: matches.length,
    planned: items.length,
    winRule: WIN_RULE,
    operatorRows,
    specRows,
    wingRows,
    kitRows,
    modeRows: [...byMode.values()].map(finalizeRow).sort((a, b) => a.key.localeCompare(b.key)),
    modeGroupRows,
    lockedPairs: locked,
    teamPairs: team,
    teamSwapRate: round(matches.length ? swaps / matches.length : 0),
    tierNotes: {
      minSample: 24,
      belowSample: [...operatorRows, ...specRows, ...wingRows].filter(row => row.n < 24).map(row => ({key: row.key, n: row.n})),
    },
    ttk: (() => {
      const sorted = appearances.flatMap(entry => entry.ttk).sort((a, b) => a - b);
      return sorted.length ? {n: sorted.length, p25: round(quantile(sorted, .25), 3), median: round(quantile(sorted, .5), 3), p75: round(quantile(sorted, .75), 3)} : null;
    })(),
  };
  // Mode viability is computed at the full sample the summary actually holds,
  // so the report carries the team-answer / locked-floor numbers directly
  // instead of forcing a caller to re-derive them from alarms.
  summary.modeViability = modeViability(summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Alarms (§4.2, §14)
// ---------------------------------------------------------------------------
export function envelopeReport(geared = 'stock') {
  const gearHealth = geared === 'max' ? resolveGear(MAX_GEAR).modifiers.health : 0;
  const gearArmor = geared === 'max' ? resolveGear(MAX_GEAR).modifiers.armor : 0;
  const rows = CHARACTERS.map(character => {
    const stats = character.stats;
    const health = stats.health + gearHealth;
    const armor = stats.armor + gearArmor;
    // Armour absorbs 60% of incoming damage, so one armour point is 1/0.6 EHP.
    return {character: character.id, health, armor, ehp: health + armor / 0.6, speed: stats.speed};
  });
  const ehpValues = rows.map(row => row.ehp);
  const speeds = rows.map(row => row.speed);
  const ehpMin = Math.min(...ehpValues), ehpMax = Math.max(...ehpValues);
  const speedMean = mean(speeds.reduce((sum, value) => sum + value, 0), speeds.length);
  const speedBand = [speedMean * .85, speedMean * 1.15];
  const breaches = [];
  const ehpRatio = ehpMin > 0 ? ehpMax / ehpMin : 1;
  if (ehpRatio > 1.5) breaches.push({kind: 'ehp', ratio: round(ehpRatio), limit: 1.5, max: rows.find(row => row.ehp === ehpMax).character, min: rows.find(row => row.ehp === ehpMin).character});
  for (const row of rows) if (row.speed < speedBand[0] || row.speed > speedBand[1]) breaches.push({kind: 'speed', character: row.character, speed: row.speed, band: speedBand.map(value => round(value, 3))});
  return {geared, ehpRatio: round(ehpRatio), speedMean: round(speedMean, 3), speedBand: speedBand.map(value => round(value, 3)), rows, breaches};
}

// Mode viability at full sample (§4.2 / §7.6): the team-mode "≥2 reachable
// answers at ≤60% aggregate" count and the locked-mode worst-pairing floor,
// computed only once a row has the minimum sample. Exported so the report can
// carry the numbers and a caller can read them without parsing alarms.
export function modeViability(summary, {minSample = 24, answerSample = 8, answerCap = .6, floor = .35} = {}) {
  const teamAnswers = summary.operatorRows.map(row => {
    const team = row.byModeGroup?.team ?? null;
    const answers = summary.teamPairs
      .filter(pair => pair.character === row.key && pair.n >= answerSample && pair.winRate <= answerCap)
      .map(pair => ({opponent: pair.opponent, n: pair.n, winRate: pair.winRate}));
    const tested = Boolean(team && team.n >= minSample);
    return {
      operator: row.key, teamN: team?.n ?? 0, tested,
      answerSample, answerCap, answerCount: answers.length, answers,
      viable: !tested || answers.length >= 2,
    };
  });
  const lockedFloors = summary.lockedPairs
    .filter(pair => pair.n >= minSample)
    .map(pair => ({a: pair.a, b: pair.b, n: pair.n, worst: pair.worst, pass: pair.worst >= floor}));
  return {minSample, answerSample, answerCap, floor, teamAnswers, lockedFloors, teamViable: teamAnswers.every(entry => entry.viable), lockedViable: lockedFloors.every(entry => entry.pass)};
}

// A truncated run is not a gate (§14 / P3-tune finding): the budget clips whole
// manifest items from the tail, so the surviving sample is not the planned
// rotation and low-n rows are artifacts. `computeAlarms` refuses to emit any
// sample-derived tier alarm from a truncated run and returns exactly one loud
// `truncated` warning instead. Envelope checks are data-only and still run.
export function computeAlarms(summary, {envelope = envelopeReport(summary.geared), profile = summary.profile, truncated = false} = {}) {
  const alarms = [];
  const truncationAlarm = {
    kind: 'truncated', severity: 'warning',
    subject: `${summary.policy}/${summary.geared}`, n: summary.matches,
    value: summary.matches, bound: summary.planned ?? null,
    detail: `run was ${summary.matches}/${summary.planned ?? '?'} matches (budget-clipped); every tier/mode alarm is suppressed because the sample is truncated`,
    replay: `--profile ${summary.profile} --policy ${summary.policy} --gear ${summary.geared}`,
  };
  if (truncated === true) {
    for (const breach of envelope.breaches) {
      if (breach.kind === 'ehp') alarms.push({kind: 'envelope', severity: 'alarm', axis: 'ehp', subject: `${breach.max} vs ${breach.min}`, n: 0, value: breach.ratio, bound: breach.limit, detail: `spawn EHP ratio ${breach.ratio} > ${breach.limit}`, replay: `--profile ${profile} --policy ${summary.policy} --gear ${summary.geared}`});
      else alarms.push({kind: 'envelope', severity: 'alarm', axis: 'speed', subject: breach.character, n: 0, value: breach.speed, bound: breach.band, detail: `base speed ${breach.speed} outside [${breach.band.join(', ')}]`, replay: `--profile ${profile} --policy ${summary.policy} --gear ${summary.geared}`});
    }
    alarms.unshift(truncationAlarm);
    return alarms;
  }
  const aggregateReplay = `--profile ${profile} --policy ${summary.policy}`;
  const replayFor = (key, mode = null, group = null) => {
    const match = summary.matchesRef?.find(entry =>
      (mode === null || entry.mode === mode)
      && (group === null || modeGroup(entry.mode) === group)
      && entry.appearances.some(appearance => appearance.character === key || appearance.harness === key || WING_BY_CHARACTER[appearance.character] === key));
    if (!match) return aggregateReplay;
    return `--profile ${profile} --policy ${summary.policy} --only=${match.mode},${match.matchup},${match.seedIndex}`;
  };
  const tierRows = [
    ...summary.operatorRows.map(row => ({...row, kind: 'operator'})),
    ...summary.specRows.map(row => ({...row, kind: 'spec'})),
    ...summary.wingRows.map(row => ({...row, kind: 'wing'})),
  ];
  for (const row of tierRows) {
    if (row.n >= 24 && row.lower > .55) alarms.push({kind: 'god', severity: 'alarm', subject: row.key, subjectKind: row.kind, n: row.n, value: row.winRate, bound: .55, detail: `Wilson-99 lower bound ${row.lower} > 0.55`, replay: replayFor(row.key)});
    if (row.n >= 24 && row.upper < .45) alarms.push({kind: 'garbage', severity: 'alarm', subject: row.key, subjectKind: row.kind, n: row.n, value: row.winRate, bound: .45, detail: `Wilson-99 upper bound ${row.upper} < 0.45`, replay: replayFor(row.key)});
    for (const [mode, entry] of Object.entries(row.byMode)) {
      if (!objectiveMode(mode) || entry.n < 8) continue;
      if (entry.objectives === 0) alarms.push({kind: 'garbage-objectives', severity: 'alarm', subject: row.key, subjectKind: row.kind, mode, n: entry.n, value: 0, bound: '>0', detail: `zero objective completions across ${entry.n} ${mode} appearances`, replay: replayFor(row.key, mode)});
    }
  }
  const viability = summary.modeViability ?? modeViability(summary);
  for (const pair of viability.lockedFloors) {
    if (pair.pass) continue;
    alarms.push({
      kind: 'locked-floor', severity: 'alarm', subject: `${pair.a} vs ${pair.b}`, n: pair.n, value: pair.worst, bound: viability.floor,
      detail: `worst locked-mode pairing win share ${pair.worst} < ${viability.floor}`, replay: replayFor(pair.a < pair.b ? pair.a : pair.b, null, 'locked'),
    });
  }
  for (const entry of viability.teamAnswers) {
    if (!entry.tested || entry.viable) continue;
    alarms.push({
      kind: 'team-answers', severity: 'alarm', subject: entry.operator, subjectKind: 'operator', n: entry.teamN,
      value: entry.answerCount, bound: '>=2', detail: `only ${entry.answerCount} reachable answer(s) at <=${viability.answerCap * 100}% aggregate win rate`, replay: replayFor(entry.operator, null, 'team'),
    });
  }
  const totalDamage = summary.operatorRows.reduce((sum, row) => sum + row.damage, 0);
  const totalAbility = summary.operatorRows.reduce((sum, row) => sum + row.abilityDamage, 0);
  const share = totalDamage > 0 ? totalAbility / totalDamage : 0;
  if (share > .3) alarms.push({kind: 'ability-share', severity: 'alarm', subject: 'overall', n: summary.matches, value: round(share), bound: .3, detail: `ability damage share ${round(share)} > 0.30`, replay: aggregateReplay});
  for (const row of [...summary.operatorRows, ...summary.specRows]) {
    if (row.n >= 24 && row.abilityShare > .3) alarms.push({kind: 'ability-share', severity: 'alarm', subject: row.key, n: row.n, value: row.abilityShare, bound: .3, detail: `ability damage share ${row.abilityShare} > 0.30`, replay: replayFor(row.key)});
  }
  for (const breach of envelope.breaches) {
    if (breach.kind === 'ehp') alarms.push({kind: 'envelope', severity: 'alarm', axis: 'ehp', subject: `${breach.max} vs ${breach.min}`, n: 0, value: breach.ratio, bound: breach.limit, detail: `spawn EHP ratio ${breach.ratio} > ${breach.limit}`, replay: aggregateReplay});
    else alarms.push({kind: 'envelope', severity: 'alarm', axis: 'speed', subject: breach.character, n: 0, value: breach.speed, bound: breach.band, detail: `base speed ${breach.speed} outside [${breach.band.join(', ')}]`, replay: aggregateReplay});
  }
  if (summary.policy === 'on') {
    for (const row of summary.operatorRows) {
      if (row.n >= 24 && row.verbUsesPerMatch < .05) alarms.push({kind: 'expression', severity: 'info', subject: row.key, n: row.n, value: row.verbUsesPerMatch, bound: .05, detail: `movement verb used ${row.verbUsesPerMatch}/match on the policy-on sweep`, replay: replayFor(row.key)});
    }
  }
  return alarms;
}

// ---------------------------------------------------------------------------
// Data hash
// ---------------------------------------------------------------------------
// Deterministic fingerprint of the balance-relevant data tables. Any tuning
// edit changes it, so a report can be tied to the exact data it measured.
export function balanceDataHash() {
  return fnv1a32(JSON.stringify([CHARACTERS, HARNESSES, WEAPONS, OPERATOR_KITS, SPECS, GEAR]));
}

// ---------------------------------------------------------------------------
// §4.8.6 gear tier invariant
// ---------------------------------------------------------------------------
// Spearman rank correlation over the keys present in both tier lists, plus the
// max rank shift, the max-gear win-rate gain in points and the classes that
// crossed the 45/55 band. Both lists are already sorted by win rate descending,
// so ranks are re-derived from the win rate so a caller can pass either order.
export function rankCorrelation(rowsA = [], rowsB = []) {
  const rankOf = rows => {
    const order = [...rows].sort((a, b) => (Number(b.winRate) || 0) - (Number(a.winRate) || 0) || String(a.key).localeCompare(String(b.key)));
    return new Map(order.map((row, index) => [row.key, index]));
  };
  const keysB = new Set(rowsB.map(row => row.key));
  const shared = rowsA.filter(row => keysB.has(row.key));
  const n = shared.length;
  if (n < 2) return {n, rho: n === 1 ? 1 : 0, maxShift: 0, maxGain: 0, crossings: []};
  const rankA = rankOf(shared);
  const rankBFull = rankOf(rowsB);
  const rankB = new Map(shared.map(row => [row.key, rankBFull.get(row.key)]));
  const byKey = new Map(rowsB.map(row => [row.key, row]));
  let sumSq = 0, maxShift = 0, maxGain = 0;
  const crossings = [];
  for (const row of shared) {
    const d = rankA.get(row.key) - rankB.get(row.key);
    sumSq += d * d;
    maxShift = Math.max(maxShift, Math.abs(d));
    const other = byKey.get(row.key) ?? {};
    const a = Number(row.winRate) || 0, b = Number(other.winRate) || 0;
    maxGain = Math.max(maxGain, (b - a) * 100);
    if ((a - .5) * (b - .5) < 0 && Math.abs(a - .5) > .05 && Math.abs(b - .5) > .05) crossings.push({key: row.key, stock: round(a), geared: round(b)});
  }
  const rho = 1 - (6 * sumSq) / (n * (n * n - 1));
  return {n, rho: round(rho), maxShift, maxGain: round(maxGain), crossings};
}

// §4.8.6: run the sweep stock and at max gear; rank correlation >= 0.85, max
// rank shift <= 2, no class crossing 45/55 and max-gear gain <= 4 points.
export function gearTierInvariant(stockRun, gearedRun, {minRho = .85, maxShift = 2, maxGain = 4} = {}) {
  const kinds = {};
  for (const kind of ['operators', 'specs', 'wings']) {
    const stats = rankCorrelation(stockRun?.tierlist?.[kind] ?? [], gearedRun?.tierlist?.[kind] ?? []);
    kinds[kind] = {...stats, pass: stats.n >= 2 ? stats.rho >= minRho && stats.maxShift <= maxShift && stats.maxGain <= maxGain && stats.crossings.length === 0 : true};
  }
  return {minRho, maxShift, maxGain, kinds, pass: Object.values(kinds).every(entry => entry.pass)};
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
export function createReport({release, profile, policy, geared, manifest, summary, alarms, items, planned, completed, truncated, elapsedMs, budgetMs, errors}) {
  return {
    format: SWEEP_FORMAT,
    kind: 'balance-sweep-run',
    release, dataHash: balanceDataHash(),
    seedFormula: SEED_FORMULA,
    profile, policy, geared,
    planned, completed, truncated, budgetMs: budgetMs ?? null, elapsedMs: round(elapsedMs, 1),
    seedManifest: {seedFormula: SEED_FORMULA, items: manifest.items.map(item => ({mode: item.mode, map: item.map, matchup: item.matchup, seedIndex: item.seedIndex, geared: item.geared, seed: item.seed, actors: item.actors.map(actor => ({id: actor.id, character: actor.character, harness: actor.harness, ...(actor.gear ? {gear: actor.gear} : {})}))}))},
    tierlist: {
      operators: summary.operatorRows,
      specs: summary.specRows,
      wings: summary.wingRows,
      kits: summary.kitRows,
    },
    metrics: {
      modes: summary.modeRows,
      modeGroups: summary.modeGroupRows,
      ttk: summary.ttk,
      winRule: summary.winRule,
      teamSwapRate: summary.teamSwapRate,
      tierNotes: summary.tierNotes,
      lockedPairs: summary.lockedPairs,
      teamPairs: summary.teamPairs,
      modeViability: summary.modeViability,
      envelope: envelopeReportOf(geared),
    },
    alarms,
    items,
    errors: errors ?? [],
  };
}

function envelopeReportOf(geared) {
  const report = envelopeReport(geared);
  return {geared: report.geared, ehpRatio: report.ehpRatio, speedMean: report.speedMean, speedBand: report.speedBand, rows: report.rows, breaches: report.breaches};
}

// Evidence rows stay compact and stable: the per-appearance TTK arrays, rank
// vectors and objective-time detail are aggregated into the run metrics, so
// they are dropped from the report's raw item log.
const compactAppearance = ({id, character, harness, team, won, frags, deaths, damage, objectives, verbUses, powers, abilityDamage}) =>
  ({id, character, harness, team, won, frags, deaths, damage, objectives, verbUses, powers, abilityDamage});

// ---------------------------------------------------------------------------
// Sweep runner
// ---------------------------------------------------------------------------
// `now` is injectable so truncation is deterministic under test. Truncation
// never cuts a match in half: only whole manifest items are dropped, in
// manifest order, so every remaining item stays reproducible with --only.
export function runSweep({
  profile = 'smoke', policy = 'neutral', geared = 'stock', only = null, budgetMs = null,
  maxMatches = null, modes, mapsPerMode, seedIndexes, cycles, timeLimit, difficulty,
  now = () => Date.now(), release = null, onProgress = null, isCancelled = null,
} = {}) {
  const manifest = buildManifest({profile, policy, geared, modes, mapsPerMode, seedIndexes, cycles, timeLimit, difficulty});
  const filtered = filterManifest(manifest, only);
  const start = now();
  const deadline = Number.isFinite(budgetMs) && budgetMs > 0 ? start + budgetMs : Infinity;
  const items = [], matches = [], appearances = [], errors = [];
  let truncated = false;
  const limit = Number.isFinite(maxMatches) && maxMatches > 0 ? Math.floor(maxMatches) : Infinity;
  for (const item of filtered) {
    if (items.length >= limit) { truncated = items.length < filtered.length; break; }
    if (items.length > 0 && now() >= deadline) { truncated = true; break; }
    if (typeof isCancelled === 'function' && isCancelled()) { truncated = true; break; }
    try {
      const result = runManifestItem(item);
      if (result.over !== true) {
        errors.push({item: item.id, mode: item.mode, map: item.map, matchup: item.matchup, seedIndex: item.seedIndex, error: `match did not finish within ${item.timeLimit}s`});
      }
      // Evidence rows stay compact: drop the per-appearance TTK arrays and rank
      // detail (they are aggregated into the run metrics already).
      items.push({...result, appearances: result.appearances.map(compactAppearance)});
      matches.push({mode: item.mode, map: item.map, matchup: item.matchup, seedIndex: item.seedIndex, seed: item.seed, geared: item.geared, over: result.over, swaps: result.swaps, appearances: result.appearances.map(appearance => ({id: appearance.id, character: appearance.character, harness: appearance.harness, team: appearance.team, won: appearance.won, rank: appearance.rank, frags: appearance.frags, deaths: appearance.deaths}))});
      for (const appearance of result.appearances) appearances.push({...appearance, mode: item.mode, map: item.map, matchup: item.matchup, seedIndex: item.seedIndex, itemId: item.id, geared: item.geared, policy: item.policy});
    } catch (error) {
      errors.push({item: item.id, mode: item.mode, map: item.map, matchup: item.matchup, seedIndex: item.seedIndex, error: error?.message ?? String(error)});
    }
    if (onProgress && items.length % 10 === 0) onProgress({completed: items.length, planned: filtered.length, elapsedMs: now() - start});
  }
  const summary = summarizeRun({items: filtered, appearances, matches, policy, geared, profile});
  summary.matchesRef = matches;
  const alarms = computeAlarms(summary, {truncated});
  const report = createReport({
    release, profile, policy, geared,
    manifest: {profile, policy, geared, seedFormula: SEED_FORMULA, items: filtered},
    summary, alarms, items,
    planned: filtered.length, completed: items.length, truncated, elapsedMs: now() - start, budgetMs: budgetMs ?? null, errors,
  });
  report.metrics.matches = matches.length;
  report.metrics.truncation = {truncated, completed: items.length, planned: filtered.length, budgetMs: budgetMs ?? null};
  return report;
}

// ---------------------------------------------------------------------------
// Human-readable tier list (CLI --print-tierlist)
// ---------------------------------------------------------------------------
const percent = value => `${(value * 100).toFixed(1)}%`;
const pad = (value, width) => String(value).padEnd(width, ' ');
const padStart = (value, width) => String(value).padStart(width, ' ');

export function formatTierList(report) {
  const lines = [];
  const run = report.runs?.[0] ?? report;
  lines.push(`Balance sweep ${report.release ?? run.release ?? 'unreleased'} · profile ${run.profile} · data ${run.dataHash}`);
  for (const entry of report.runs ?? [run]) {
    lines.push('');
    lines.push(`== policy:${entry.policy} geared:${entry.geared} · ${entry.completed}/${entry.planned} matches${entry.truncated ? ' (budget-truncated)' : ''} ==`);
    if (entry.truncated) lines.push(`!! TRUNCATED: only ${entry.completed}/${entry.planned} planned matches ran. Tier rows and alarms are NOT a gate; re-run to completion (no --budget-ms) before reading them.`);
    const rows = entry.tierlist.operators.slice(0, 3);
    lines.push(`podium: ${rows.map(row => `${row.key} ${percent(row.winRate)} [${percent(row.lower)}, ${percent(row.upper)}] n=${row.n}`).join(' · ') || 'n/a'}`);
    lines.push('');
    lines.push(`${pad('OPERATOR', 10)} ${padStart('WIN', 6)} ${padStart('WILSON-99', 18)} ${padStart('N', 5)} ${padStart('K/D', 6)} ${padStart('DMG/LIFE', 9)} ${padStart('OBJ', 5)} ${padStart('VERB/M', 7)} ${padStart('ABILITY', 8)}`);
    for (const row of entry.tierlist.operators) {
      lines.push(`${pad(row.key, 10)} ${padStart(percent(row.winRate), 6)} ${padStart(`[${percent(row.lower)},${percent(row.upper)}]`, 18)} ${padStart(row.n, 5)} ${padStart(row.kd.toFixed(2), 6)} ${padStart(row.damagePerLife.toFixed(1), 9)} ${padStart(row.objectives, 5)} ${padStart(row.verbUsesPerMatch.toFixed(2), 7)} ${padStart(percent(row.abilityShare), 8)}`);
    }
    lines.push('');
    lines.push(`${pad('SPEC', 10)} ${padStart('WIN', 6)} ${padStart('WILSON-99', 18)} ${padStart('N', 5)} ${padStart('K/D', 6)} ${padStart('DMG/LIFE', 9)} ${padStart('OBJ', 5)} ${padStart('VERB/M', 7)} ${padStart('ABILITY', 8)}`);
    for (const row of entry.tierlist.specs) {
      lines.push(`${pad(row.key, 10)} ${padStart(percent(row.winRate), 6)} ${padStart(`[${percent(row.lower)},${percent(row.upper)}]`, 18)} ${padStart(row.n, 5)} ${padStart(row.kd.toFixed(2), 6)} ${padStart(row.damagePerLife.toFixed(1), 9)} ${padStart(row.objectives, 5)} ${padStart(row.verbUsesPerMatch.toFixed(2), 7)} ${padStart(percent(row.abilityShare), 8)}`);
    }
    if (entry.metrics?.ttk) lines.push(`sampled TTK p25/median/p75: ${entry.metrics.ttk.p25}s / ${entry.metrics.ttk.median}s / ${entry.metrics.ttk.p75}s (n=${entry.metrics.ttk.n}, advisory)`);
    if (entry.metrics?.teamSwapRate) lines.push(`team swap rate: ${entry.metrics.teamSwapRate}/match`);
  }
  const alarms = report.alarms ?? run.alarms ?? [];
  lines.push('');
  lines.push(alarms.length ? `ALARMS (${alarms.length}):` : 'ALARMS: none');
  for (const alarm of alarms) {
    lines.push(`  [${alarm.severity}] ${alarm.kind}: ${alarm.subject} — ${alarm.detail}${alarm.replay ? ` · replay: ${alarm.replay}` : ''}`);
  }
  return lines.join('\n');
}
