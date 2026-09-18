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
import {coopKillReport, coopRewardSummary, coopSpendReport, setCoopTier} from '../game/cocs-coop.mjs';
import {COOP_SINK_ORDER} from '../game/cocs-difficulty.mjs';

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

// OPERATIONS (`cocs-coop`) acceptance harness. A first-time team is simulated
// with `aiSeats:true` "human" seats driven by the duty Chief; team 1 is the
// persistent garrison plus the Director wave force. Reports the D1 wave-5 win
// rate, per-wave durations, HQ siege activity and the step p95 at 24 actors.
export function runCoop(seed, {seconds = 900, tier = 'D1', humans = 4, bots = 2, mapId = 'lattice-slice'} = {}) {
  const m = new Match('chatgpt', 'openclaw', seeded(seed), mapId, {
    mode: 'cocs-coop', humanCount: humans, botCount: bots, aiSeats: true, timeLimit: seconds,
  });
  if (tier && tier !== 'D1') setCoopTier(m.objectiveState, tier);
  const total = Math.round(seconds / DT);
  const samples = [];
  let ticks = 0;
  for (let i = 0; i < total && !m.over; i++) {
    const t0 = process.hrtime.bigint();
    m.step(DT, {inputs: {}});
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    ticks++;
  }
  samples.sort((a, b) => a - b);
  const p95 = samples.length ? samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] : 0;
  const st = m.objectiveState, coop = st.coop;
  const spend = coopSpendReport(m, st);
  const rewards = coop.rewards ?? coopRewardSummary(m, st);
  const report = coopKillReport(m, st);
  return {
    seed, tier, seconds, ticks, over: m.over, overReason: m.overReason || null, winner: st.winner ?? null,
    wavesCleared: coop.wavesCleared, waveCount: coop.waveCount, win: m.overReason === 'operation-complete',
    waveDurations: coop.stats.waveDurations.map(d => Math.round(d * 10) / 10),
    peakPressure: Math.round(coop.stats.peakPressure * 10) / 10,
    hqDamage: Math.round(coop.stats.hqDamage), hqRepairs: Math.round(coop.stats.hqRepairs),
    siege: coop.siege.armed === true, spawns: coop.stats.spawns,
    stepP95Ms: Math.round(p95 * 1000) / 1000, actors: m.actors.length,
    spend,
    bonus: {done: report.bonus.done, failed: report.bonus.failed, flux: report.bonus.flux, req: report.bonus.req, commendations: report.bonus.commendations},
    rewards: {
      win: rewards.win, retention: rewards.retention, tierRewardMultiplier: rewards.tierRewardMultiplier,
      leftover: rewards.leftover, commendations: rewards.commendations, bonusCommendations: rewards.bonusCommendations,
    },
    fluxPinnedFraction: spend.fluxPinnedFraction,
  };
}

const totalSpends = run => {
  const byType = run?.spend?.byType ?? {};
  return Object.values(byType).reduce((sum, value) => sum + (Number(value) || 0), 0);
};

/**
 * `director-exploit` sweep alarm (design §6.7). A run matrix is unhealthy when
 * the visible levers stop mattering: the Director budget pinning at the cap, the
 * team FLUX pinning at the cap (the V0b gap O1b's sinks must close), the spend
 * window never being used, or a win with no pressure taken at all.
 */
export function exploitAlarms(runs) {
  const total = Math.max(1, runs.length);
  const alarms = [];
  const wins = runs.filter(r => r.win).length;
  const winRate = wins / total;
  // Team FLUX pinning at the cap is the V0b acceptance gap the sinks must close.
  const pinned = runs.filter(r => Number(r.fluxPinnedFraction ?? 0) > 0.30).length;
  if (pinned / total > 0.5) alarms.push(`flux-pinned:${pinned}/${total}`);
  // A spend window that never spends means the sinks are dead weight.
  const noSpend = runs.filter(r => Number(r.spend?.windows ?? 0) > 0 && totalSpends(r) === 0).length;
  if (noSpend > 0) alarms.push(`no-intermission-spends:${noSpend}`);
  // The real trivialisation signal: a budget clamped at the cap *and* an
  // effortless win. On a normal D1 the live-force cap can hold the budget at the
  // cap for a while without the wave being trivial, so a clamp alone is only a
  // reported warning (see `exploitWarnings`), never an alarm.
  const clamped = runs.filter(r => Number(r.spend?.budgetClampedFraction ?? 0) > 0.30).length;
  if (clamped / total > 0.5 && winRate > 0.9) alarms.push(`trivial-win:${clamped}/${total}`);
  const freeWin = runs.filter(r => r.win && Number(r.hqDamage ?? 0) <= 0 && totalSpends(r) === 0).length;
  if (freeWin > 0) alarms.push(`free-win:${freeWin}`);
  return alarms;
}

/** Non-gating health warnings (reported, never fail a sweep on their own). */
export function exploitWarnings(runs) {
  const total = Math.max(1, runs.length);
  const clamped = runs.filter(r => Number(r.spend?.budgetClampedFraction ?? 0) > 0.30).length;
  return clamped / total > 0.5 ? [`pressure-clamped:${clamped}/${total}`] : [];
}

export function summariseCoop(runs) {
  const wins = runs.filter(r => r.win).length;
  const byReason = runs.reduce((acc, r) => { const k = r.overReason ?? 'clock'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  const maxStepP95Ms = Math.max(0, ...runs.map(r => r.stepP95Ms || 0));
  const avgWaves = runs.length ? runs.reduce((a, r) => a + r.wavesCleared, 0) / runs.length : 0;
  const spendByType = COOP_SINK_ORDER.reduce((acc, verb) => { acc[verb] = 0; return acc; }, {});
  let windows = 0, fluxSpent = 0, bonusDone = 0, bonusFailed = 0, partialPayouts = 0;
  for (const run of runs) {
    for (const verb of COOP_SINK_ORDER) spendByType[verb] += Number(run.spend?.byType?.[verb] ?? 0);
    windows += Number(run.spend?.windows ?? 0);
    fluxSpent += Number(run.spend?.fluxSpent ?? 0);
    bonusDone += (run.bonus?.done ?? []).length;
    bonusFailed += (run.bonus?.failed ?? []).length;
    if (run.rewards && run.rewards.retention < 1) partialPayouts++;
  }
  const alarms = exploitAlarms(runs);
  const warnings = exploitWarnings(runs);
  return {
    gate: {
      d1Wave5WinRate: '35-65%', d2WinRate: '28-58%',
      stepP95: '<=8ms @24 actors', fluxPinned: '<=30% of match',
    },
    result: {
      sample: runs.length,
      wins,
      winRate: `${runs.length ? ((wins / runs.length) * 100).toFixed(1) : '0.0'}%`,
      avgWavesCleared: avgWaves.toFixed(2),
      byReason,
      maxStepP95Ms,
      alarms,
      warnings,
      directorExploit: alarms.length > 0,
    },
    intermission: {windows, byType: spendByType, fluxSpent: Math.round(fluxSpent * 100) / 100, partialPayouts},
    bonus: {done: bonusDone, failed: bonusFailed},
    runs,
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
  if (mode === 'cocs-coop') {
    const tier = (process.env.TIER || 'D1').toUpperCase();
    const humans = Number(process.env.HUMANS || 4);
    const bots = Number(process.env.BOTS || 2);
    const runs = seeds.map(seed => runCoop(seed, {seconds: Number(process.env.SECS || 900), tier, humans, bots, mapId}));
    console.log(JSON.stringify(summariseCoop(runs), null, 2));
  } else {
    const runs = seeds.map(seed => run(seed, { seconds, mapId, mode }));
    console.log(JSON.stringify(summarise(runs), null, 2));
  }
}
