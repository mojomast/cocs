// V0a LATTICE STRIKE (`cocs`) acceptance harness.
//
// Measures the D0 gate table on a live 4v4 AI match: strict contested-node
// time, fight@point time, multi-front time, average live nodes, and the
// leader/trailing-at-half win rates. Prints the gate table as JSON so a wave
// report can paste it straight into a receipt.
//
// Method (fixed, from the D0 diagnosis):
//   * The mode's LATTICE target is 4v4, so a run is 8 AI seats —
//     `humanCount:1` + `botCount:7` + `aiSeats:true` — and every seat is stepped
//     with `{inputs:{}}` so the leading "human" seat is driven by the bot AI
//     too. Counting `botCount:8` (9 seats, a 5v4 imbalance) and stepping with
//     `{}` (which leaves seat 0 inert) are both known artifacts; neither is used
//     here.
//   * Strict contest is living actors of both teams inside the node's authored
//     capture radius. Fight@point widens that by 10 m. Multi-front counts ticks
//     with >= 2 simultaneously strict-contested live nodes.
//   * A match is decided when `winner !== null`; the half-time leader is the
//     last sampled score at or before 50% of the match's real duration.
//
// Usage:
//   node scripts/cocs-validate.mjs
//   SEEDS=1,2,3,4,5,6 SECS=600 node scripts/cocs-validate.mjs
//   POLICY=off node scripts/cocs-validate.mjs          # disable the bot policy
//   MAP=lattice-slice MODE=cocs node scripts/cocs-validate.mjs
import {pathToFileURL} from 'node:url';
import {Match} from '../game/core.mjs';

const DT = 1 / 60;
const seeded = seed => { let n = seed >>> 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
const near = (a, n, extra = 0) => Math.hypot(a.x - n.x, a.z - n.z) <= n.r + extra;

export function run(seed, { seconds = 600, players = 8, mapId = 'lattice-slice', mode = 'cocs' } = {}) {
  const options = {
    mode, botCount: players - 1, humanCount: 1, aiSeats: true, difficulty: 'normal', timeLimit: seconds, fragLimit: 9999,
  };
  if (process.env.POLICY === 'off') options.cocsPolicy = () => [];
  const m = new Match('chatgpt', 'openclaw', seeded(seed), mapId, options);
  m.pickups = [];
  const total = Math.round(seconds / DT);
  let ticks = 0, contest = 0, fight = 0, multi = 0, liveSum = 0;
  const trace = [];
  for (let i = 0; i < total && !m.over; i++) {
    m.step(DT, { inputs: {} });
    ticks++;
    const st = m.objectiveState;
    if (st && Array.isArray(st.nodes)) {
      let live = 0, contested = 0, anyC = false, anyF = false;
      for (const n of st.nodes) {
        if (!n.live) continue;
        live++;
        let a = 0, b = 0, a2 = 0, b2 = 0;
        for (const act of m.actors) {
          if (act.health <= 0) continue;
          if (near(act, n)) { if (act.team === 0) a++; else if (act.team === 1) b++; }
          if (near(act, n, 10)) { if (act.team === 0) a2++; else if (act.team === 1) b2++; }
        }
        if (a > 0 && b > 0) { anyC = true; contested++; }
        if (a2 > 0 && b2 > 0) anyF = true;
      }
      liveSum += live;
      if (anyC) contest++;
      if (anyF) fight++;
      if (contested >= 2) multi++;
    }
    if (i % 30 === 0) trace.push([m.time, { ...m.teamScores }]);
  }
  const s = m.teamScores || { 0: 0, 1: 0 };
  const winner = s[0] === s[1] ? null : (s[0] > s[1] ? 0 : 1);
  // Half-time leader: 50% of elapsed match time. If the match ended early, half
  // is 50% of its real duration.
  const halfTime = (m.over ? m.time : seconds) / 2;
  let half = null;
  for (const [t, scores] of trace) if (t <= halfTime + 1e-9) half = scores;
  if (!half && trace.length) half = trace[0][1];
  const st = m.objectiveState;
  const traversal = st?.traversal?.stats ?? {};
  const economy = {
    fluxSpent: { 0: st?.fluxSpent?.[0] ?? 0, 1: st?.fluxSpent?.[1] ?? 0 },
    fluxRemaining: { 0: st?.flux?.[0] ?? 0, 1: st?.flux?.[1] ?? 0 },
    fluxEarned: { 0: st?.fluxEarned?.[0] ?? 0, 1: st?.fluxEarned?.[1] ?? 0 },
    scoutsSpawned: (st?.scoutStats?.[0]?.spawned ?? 0) + (st?.scoutStats?.[1]?.spawned ?? 0),
    scoutsKilled: (st?.scoutStats?.[0]?.killed ?? 0) + (st?.scoutStats?.[1]?.killed ?? 0),
    scoutsExpired: (st?.scoutStats?.[0]?.expired ?? 0) + (st?.scoutStats?.[1]?.expired ?? 0),
    scoutsScans: (st?.scoutStats?.[0]?.scans ?? 0) + (st?.scoutStats?.[1]?.scans ?? 0),
    ordersCompleted: st?.orderStats?.completed ?? 0,
    ordersByVerb: { ...(st?.orderStats?.byVerb ?? {}) },
    deviceUses: traversal.uses ?? 0,
    deviceCuts: traversal.cuts ?? 0,
    deviceLocks: traversal.locks ?? 0,
    deviceRepairs: traversal.repairs ?? 0,
    vehicleSpawns: traversal.vehicleSpawns ?? 0,
    vehicleUses: traversal.vehicleUses ?? 0,
    arrivals: traversal.arrivals ?? 0,
    depotCaptures: traversal.depotCaptures ?? 0,
  };
  return {
    seed, seconds, ticks, over: m.over, overReason: m.overReason || null,
    strict: ticks ? contest / ticks : 0,
    fightPoint: ticks ? fight / ticks : 0,
    multiFront: ticks ? multi / ticks : 0,
    avgLive: ticks ? liveSum / ticks : 0,
    half, winner, scores: s,
    economy,
  };
}

export function summarise(runs) {
  const avg = k => (runs.length ? runs.reduce((a, r) => a + r[k], 0) / runs.length : 0);
  const decided = runs.filter(r => r.winner !== null);
  const leaderAtHalfWins = decided.filter(r => {
    const h = r.half; if (!h || h[0] === h[1]) return false;
    return (h[0] > h[1] ? 0 : 1) === r.winner;
  }).length;
  const trailingAtHalfWins = decided.filter(r => {
    const h = r.half; if (!h || h[0] === h[1]) return false;
    return (h[0] < h[1] ? 0 : 1) === r.winner;
  }).length;
  const pct = v => `${(v * 100).toFixed(1)}%`;
  const total = k => runs.reduce((a, r) => a + (Number(r.economy?.[k]) || 0), 0);
  const totalPair = k => ({
    0: runs.reduce((a, r) => a + (Number(r.economy?.[k]?.[0]) || 0), 0),
    1: runs.reduce((a, r) => a + (Number(r.economy?.[k]?.[1]) || 0), 0),
  });
  const byVerb = runs.reduce((acc, r) => {
    for (const [verb, count] of Object.entries(r.economy?.ordersByVerb ?? {})) acc[verb] = (acc[verb] ?? 0) + count;
    return acc;
  }, {});
  return {
    gate: { strictContest: '>=35%', fightPoint: '>=60%', trailingHalfWins: '>=25%' },
    result: {
      strictContest: pct(avg('strict')),
      fightPoint: pct(avg('fightPoint')),
      multiFront: pct(avg('multiFront')),
      avgLiveNodes: avg('avgLive').toFixed(2),
      leaderAtHalfWins: `${leaderAtHalfWins}/${decided.length}`,
      trailingAtHalfWins: `${trailingAtHalfWins}/${decided.length}`,
    },
    economy: {
      fluxSpent: totalPair('fluxSpent'),
      fluxRemaining: totalPair('fluxRemaining'),
      fluxEarned: totalPair('fluxEarned'),
      scoutsSpawned: total('scoutsSpawned'),
      scoutsKilled: total('scoutsKilled'),
      scoutsExpired: total('scoutsExpired'),
      scoutsScans: total('scoutsScans'),
      ordersCompleted: total('ordersCompleted'),
      ordersByVerb: byVerb,
      deviceUses: total('deviceUses'),
      deviceCuts: total('deviceCuts'),
      deviceLocks: total('deviceLocks'),
      deviceRepairs: total('deviceRepairs'),
      vehicleSpawns: total('vehicleSpawns'),
      vehicleUses: total('vehicleUses'),
      arrivals: total('arrivals'),
      depotCaptures: total('depotCaptures'),
    },
    runs: runs.map(r => ({
      seed: r.seed, over: r.over, reason: r.overReason, duration: `${(r.ticks / 60).toFixed(1)}s`,
      strict: pct(r.strict), fightPoint: pct(r.fightPoint), multiFront: pct(r.multiFront),
      half: r.half, winner: r.winner, scores: r.scores, economy: r.economy,
    })),
  };
}

// CLI entry: only run when executed directly, not when imported by a test.
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const seeds = (process.env.SEEDS || '1,2,3').split(',').map(Number);
  const seconds = Number(process.env.SECS || 600);
  const mapId = process.env.MAP || 'lattice-slice';
  const mode = process.env.MODE || 'cocs';
  const runs = seeds.map(seed => run(seed, { seconds, mapId, mode }));
  console.log(JSON.stringify(summarise(runs), null, 2));
}
