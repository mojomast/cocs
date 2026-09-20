// F08/F11 learning-summary view model.
//
// Pure reads of the frozen final snapshot, the award payload and saved
// progress. Nothing here mutates its inputs, grants rewards or records
// anything: rendering the results screen twice returns identical data, so a
// repeated visit can never duplicate credit. Every rendered number comes from
// the same authoritative record the simulation wrote (actor scoreStats, the
// cocs/coop snapshot, the singleplayer snapshot or the stored campaign
// progress); missing values read as an honest zero rather than a guess.
import {formatNumber, formatWhole, formatResource} from './format-ui.mjs';
import {isCocsMode, teamMode} from './config.mjs';
import {CAMPAIGN_MISSIONS, missionFor} from './campaign-data.mjs';
import {campaignMissionPar, checkpointFor, isMissionComplete, missionStars, nextMissionId} from './campaign-progress.mjs';
import {cocsResultSummary, modeColumns, scoreStats} from './hud.mjs';
import {challengeMatches, metricsFor} from './challenges.mjs';
import {matchXp} from './progression.mjs';

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const int = value => Math.max(0, Math.round(num(value, 0)));
// The scoreboard's filtered `scoreStats` deliberately omits some counters.
// Personal Lattice/Operations fields (orders, objective points, damage) live on
// the raw frozen `actor.scoreStats`, so read them from the record itself.
const rawStat = (actor, field) => num(actor?.scoreStats?.[field], 0);
const score = value => formatWhole(value);
// A stat row keeps the authoritative raw number beside its display text so the
// caller can assert the rendered value against the record.
const statRow = (id, label, value, raw = null, hint = null) => ({id, label, value, raw, hint});

// The authoritative outcome for the local player. Solo modes carry their own
// `winner`, team modes compare the actor's team against `result.winner`, and
// free-for-all modes compare the actor id. Null means no decision was recorded
// (practice with no opponents), never a guessed win.
export function resultOutcome(hud, actor) {
 if (!hud) return null;
 const single = hud.singleplayer;
 if (single && (single.winner === 0 || single.winner === 1)) return single.winner === 0 ? 'win' : 'loss';
 const mode = hud?.config?.mode;
 if (mode === 'puma-race') {
  const winner = hud?.race?.winnerId;
  return winner === null || winner === undefined ? null : winner === actor?.id ? 'win' : 'loss';
 }
 const winner = hud?.cocs?.winner ?? hud?.winner;
 if (winner === null || winner === undefined) return null;
 if (isCocsMode(mode) || teamMode(mode)) {
  const team = actor?.team === 0 || actor?.team === 1 ? Number(actor.team) : null;
  return team === null ? null : winner === team ? 'win' : 'loss';
 }
 return winner === actor?.id ? 'win' : 'loss';
}

function kindOf(hud, modeId) {
 if (hud?.singleplayer || modeId === 'horde' || modeId === 'campaign') return 'solo';
 if (hud?.cocs?.coop === true || modeId === 'cocs-coop') return 'operations';
 if (hud?.cocs || isCocsMode(modeId)) return 'lattice';
 return 'standard';
}

// `headline` must always name a real, personal contribution. Candidates are
// ordered so a defender or support player is credited before raw fragging:
// objective captures, successful orders, connected hold time, then damage.
function chooseHeadline(candidates) {
 for (const entry of candidates) {
  if (entry && entry.raw > 0) return {text: entry.text, source: entry.id};
 }
 return {text: 'No objective credit this round. The next match can start with a capture push.', source: 'none'};
}

function plural(n, one, many = `${one}s`) {
 return n === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// LATTICE STRIKE (cocs): captures, connected hold and order contribution.
// ---------------------------------------------------------------------------
function latticeContribution({hud, cocs, actor, kills, team, outcome, modeId, resultSummary}) {
 const scores = cocs?.scores ?? {};
 const nodes = Array.isArray(cocs?.nodes) ? cocs.nodes : [];
 const owned = {0: nodes.filter(node => node?.owner === 0).length, 1: nodes.filter(node => node?.owner === 1).length};
 const orders = cocs?.orderStats ?? {};
 const captures = int(rawStat(actor, 'objectiveCaptures'));
 const hold = num(rawStat(actor, 'objectiveTime'));
 const ordersContributed = int(rawStat(actor, 'ordersContributed'));
 const damage = num(rawStat(actor, 'damage'));
 const personal = [
  statRow('captures', 'NODE CAPTURES', score(captures), captures),
  statRow('hold', 'NODE HOLD', `${formatNumber(hold)}s`, hold, 'time on ground your team owns'),
  statRow('orders', 'ORDERS CONTRIBUTED', score(ordersContributed), ordersContributed),
  statRow('kills', 'ELIMINATIONS', score(kills), kills),
  statRow('damage', 'DAMAGE', score(damage), damage),
 ];
 const teamRows = [];
 if (team !== null && team !== undefined) {
  const enemy = team === 0 ? 1 : 0;
  teamRows.push(statRow('team-op', 'YOUR TEAM OP', score(scores[team]), num(scores[team])));
  teamRows.push(statRow('enemy-op', 'ENEMY OP', score(scores[enemy]), num(scores[enemy])));
  teamRows.push(statRow('nodes', 'NODES OWNED', `${owned[team]} / ${owned[0] + owned[1]}`, owned[team]));
  teamRows.push(statRow('orders-team', 'ORDERS COMPLETED', `${int(orders.completed)} / ${int(orders.issued)}`, int(orders.completed), 'completed / issued'));
  const fluxSpent = num(cocs?.fluxSpent?.[team]);
  if (fluxSpent > 0) teamRows.push(statRow('flux', 'FLUX SPENT', formatResource(fluxSpent), fluxSpent));
 }
 const headline = chooseHeadline([
  {id: 'captures', raw: captures, text: `You captured ${score(captures)} ${plural(captures, 'node')} for the lattice.`},
  {id: 'orders', raw: ordersContributed, text: `You completed ${score(ordersContributed)} ordered ${plural(ordersContributed, 'capture')} — support credit that moved the front.`},
  {id: 'hold', raw: hold, text: `You held owned ground for ${formatNumber(hold)}s.`},
  {id: 'damage', raw: damage, text: `You dealt ${score(damage)} damage in support of the push.`},
 ]);
 return {
  kind: 'lattice', modeId, title: 'LATTICE CONTRIBUTION', outcome,
  endReason: cocsResultSummary(hud, actor) || resultSummary || 'The lattice match ended.',
  personal, team: teamRows, saved: [], headline: headline.text, headlineSource: headline.source,
 };
}

// ---------------------------------------------------------------------------
// OPERATIONS (cocs-coop): waves, HQ siege work and intermission spend effects.
// ---------------------------------------------------------------------------
function operationsContribution({hud, cocs, actor, kills, outcome, modeId}) {
 const waves = cocs?.waves ?? {};
 const director = cocs?.director ?? {};
 const siege = director.siege ?? {};
 const cleared = int(waves.cleared);
 const par = int(waves.par) || int(director.waveCount) || 5;
 const current = Math.max(1, Math.min(par, int(waves.current) || cleared + 1));
 const reqEntry = (Array.isArray(cocs?.req) ? cocs.req : []).find(entry => entry && entry.id === actor?.id) ?? null;
 const reqSpent = int(reqEntry ? reqEntry.spent : actor?.reqSpent);
 const reqEarned = int(reqEntry ? reqEntry.earned : actor?.reqEarned);
 const captures = int(rawStat(actor, 'objectiveCaptures'));
 const hold = num(rawStat(actor, 'objectiveTime'));
 const ordersContributed = int(rawStat(actor, 'ordersContributed'));
 const damage = num(rawStat(actor, 'damage'));
 const reason = String(hud?.overReason ?? '');
 const waveLine = `${cleared} of ${par} waves cleared`;
 const endReason = reason === 'operation-complete' ? `All ${par} waves were cleared with the HQ standing.`
  : reason === 'operation-failed' ? `The operation clock ran out on wave ${current} of ${par} (${waveLine}).`
   : reason === 'hq-destroyed' ? `The Director siege destroyed the HQ on wave ${current} of ${par} (${waveLine}).`
    : reason === 'hq-lost' ? `HQ control was lost after ${waveLine}.`
     : reason === 'team-wipe' ? `The squad ran out of reserve tickets on wave ${current} (${waveLine}).`
      : reason === 'dominance' ? `The Director claimed lattice dominance after ${waveLine}.`
       : reason === 'time' ? `The clock ran out after ${waveLine}.`
        : `The operation ended after ${waveLine}.`;
 const personal = [
  statRow('captures', 'NODE CAPTURES', score(captures), captures),
  statRow('hold', 'NODE HOLD', `${formatNumber(hold)}s`, hold),
  statRow('orders', 'ORDERS CONTRIBUTED', score(ordersContributed), ordersContributed),
  statRow('req', 'REQ SPENT', formatResource(reqSpent), reqSpent, `${formatResource(reqEarned)} earned on the field`),
  statRow('kills', 'ELIMINATIONS', score(kills), kills),
  statRow('damage', 'DAMAGE', score(damage), damage),
 ];
 const bonusTelemetry = cocs?.bonusTelemetry ?? {};
 const bonusDone = Array.isArray(bonusTelemetry.done) ? bonusTelemetry.done.length : 0;
 const bonusFailed = Array.isArray(bonusTelemetry.failed) ? bonusTelemetry.failed.length : 0;
 const teamRows = [
  statRow('waves', 'WAVES CLEARED', `${cleared} / ${par}`, cleared),
  statRow('hq', 'HQ INTEGRITY', `${score(siege.health)} / ${score(siege.max)}`, num(siege.health), int(siege.repairs) > 0 ? `${score(siege.repairs)} repaired` : null),
 ];
 const fluxSpent = num(director?.intermission?.spent ?? director?.stats?.spent);
 if (fluxSpent > 0) teamRows.push(statRow('flux', 'FLUX SPENT', formatResource(fluxSpent), fluxSpent));
 if (bonusDone + bonusFailed > 0) teamRows.push(statRow('bonus', 'BONUS OBJECTIVES', `${bonusDone} / ${bonusDone + bonusFailed}`, bonusDone, 'secured / attempted'));
 const reserves = cocs?.reserves;
 if (reserves?.enabled === true) teamRows.push(statRow('reserve', 'RESERVE TICKETS', `${score(reserves.tickets)}`, num(reserves.tickets), int(reserves.burns) > 0 ? `${score(reserves.burns)} burned` : null));
 const headline = chooseHeadline([
  {id: 'req', raw: reqSpent, text: `You spent ${formatResource(reqSpent)} REQ on squad support purchases.`},
  {id: 'orders', raw: ordersContributed, text: `You completed ${score(ordersContributed)} ordered ${plural(ordersContributed, 'capture')} against the Director.`},
  {id: 'captures', raw: captures, text: `You captured ${score(captures)} ${plural(captures, 'node')} back from the Director.`},
  {id: 'hold', raw: hold, text: `You held captured ground for ${formatNumber(hold)}s.`},
  {id: 'damage', raw: damage, text: `You dealt ${score(damage)} damage to the Director's force.`},
  {id: 'kills', raw: kills, text: `You eliminated ${score(kills)} hostiles.`},
 ]);
 return {
  kind: 'operations', modeId, title: 'OPERATIONS CONTRIBUTION', outcome,
  endReason, personal, team: teamRows, saved: [], headline: headline.text, headlineSource: headline.source,
 };
}

// ---------------------------------------------------------------------------
// Solo modes: horde survival progress and campaign checkpoint/mission progress.
// `saved` reads the real stored records (campaign progress, the run summary).
// ---------------------------------------------------------------------------
function soloContribution({hud, actor, single, modeId, campaign, kills, outcome}) {
 const kind = single?.kind ?? (modeId === 'horde' ? 'horde' : 'campaign');
 const elapsed = Math.round(num(single?.elapsed ?? hud?.time));
 if (kind === 'horde') {
  const wave = int(single?.wave);
  const target = int(single?.waveTarget);
  const endless = single?.endless === true || target <= 0;
  const cleared = outcome === 'win' ? target : Math.max(0, Math.min(target || wave, wave - 1));
  const bestWave = int(single?.bestWave);
  const runScore = int(single?.score);
  const upgrades = Array.isArray(single?.upgrades) ? single.upgrades.length : int(single?.upgradeCount);
  const personal = [
   statRow('waves', 'WAVES CLEARED', endless ? score(cleared) : `${cleared} / ${target}`, cleared),
   statRow('kills', 'ELIMINATIONS', score(kills), kills),
   statRow('time', 'SURVIVAL TIME', `${score(elapsed)}s`, elapsed),
   statRow('upgrades', 'UPGRADES FIELDED', score(upgrades), upgrades),
  ];
  const saved = [
   statRow('best-wave', 'BEST WAVE', score(bestWave || wave), bestWave || wave),
   statRow('score', 'HORDE SCORE', score(runScore), runScore),
   statRow('deaths', 'DEATHS', score(int(single?.deaths ?? actor?.deaths)), int(single?.deaths ?? actor?.deaths)),
  ];
  const endReason = outcome === 'win' ? `All ${target} waves were cleared.`
   : endless ? `You survived ${wave} ${plural(wave, 'wave')} before being overrun.`
    : `The horde overran the line on wave ${Math.max(1, wave)} of ${target} (${cleared} cleared).`;
  const headline = chooseHeadline([
   {id: 'waves', raw: cleared, text: outcome === 'win' ? `You cleared all ${target} waves.` : `You survived ${cleared} ${plural(cleared, 'wave')}${endless ? '' : ` of ${target}`}.`},
   {id: 'kills', raw: kills, text: `You eliminated ${score(kills)} hostiles.`},
   {id: 'time', raw: elapsed, text: `You held the line for ${score(elapsed)}s.`},
  ]);
  return {kind: 'solo', soloKind: 'horde', modeId, title: 'HORDE PROGRESS', outcome, endReason, personal, team: [], saved, headline: headline.text, headlineSource: headline.source};
 }
 const mission = single?.mission ?? (single?.missionId ? missionFor(single.missionId) : null);
 const missionId = mission?.id ?? null;
 const steps = Array.isArray(single?.steps) ? single.steps : [];
 const stepsDone = steps.filter(step => step?.done === true).length;
 const stepTotal = steps.length;
 const checkpointRaw = single?.checkpoint;
 const runCheckpoint = checkpointRaw && typeof checkpointRaw === 'object' ? int(checkpointRaw.step) : Number.isFinite(Number(checkpointRaw)) ? int(checkpointRaw) : null;
 const savedCheckpoint = missionId ? checkpointFor(campaign, missionId) : null;
 const entry = (campaign?.completed ?? {})[missionId] ?? null;
 const attempts = int(entry?.attempts);
 const stars = mission && isMissionComplete(entry) ? missionStars(mission, entry) : 0;
 const personal = [
  statRow('steps', 'STEPS COMPLETE', stepTotal > 0 ? `${stepsDone} / ${stepTotal}` : score(stepsDone), stepsDone),
  statRow('kills', 'ELIMINATIONS', score(kills), kills),
  statRow('time', 'MISSION TIME', `${score(elapsed)}s`, elapsed),
  statRow('deaths', 'DEATHS', score(int(single?.deaths ?? actor?.deaths)), int(single?.deaths ?? actor?.deaths)),
 ];
 const saved = [
  statRow('checkpoint', 'BANKED CHECKPOINT', savedCheckpoint === null ? 'NONE' : `STEP ${savedCheckpoint}`, savedCheckpoint),
  statRow('attempts', 'ATTEMPTS', score(attempts), attempts),
  statRow('stars', 'BEST RESULT', stars > 0 ? `${stars} / 3 STARS` : 'NOT CLEARED', stars),
 ];
 const missionName = String(mission?.name ?? 'THE MISSION');
 const endReason = outcome === 'win' ? `${missionName.toUpperCase()} complete: ${String(single?.objective || 'objective secured')}.`
  : `${missionName.toUpperCase()} failed at step ${stepsDone + (steps[stepsDone] ? 1 : 0)} of ${stepTotal || '—'}: ${String(single?.objective || 'the objective was not held')}.`;
 const headline = chooseHeadline([
  {id: 'checkpoint', raw: savedCheckpoint === null ? 0 : savedCheckpoint + 1, text: `You banked a checkpoint at step ${savedCheckpoint} of ${stepTotal || '—'}.`},
  {id: 'steps', raw: stepsDone, text: `You reached step ${stepsDone} of ${stepTotal || '—'} before the mission ended.`},
  {id: 'time', raw: elapsed, text: `You held the line for ${score(elapsed)}s.`},
 ]);
 return {
  kind: 'solo', soloKind: 'campaign', modeId, missionId, title: 'MISSION PROGRESS', outcome, endReason, personal, team: [], saved,
  headline: outcome === 'win' ? `You completed ${missionName} in ${score(elapsed)}s.` : headline.text,
  headlineSource: outcome === 'win' ? 'complete' : headline.source,
  runCheckpoint,
 };
}

// ---------------------------------------------------------------------------
// Every other mode: reuse the scoreboard's authoritative mode columns so the
// results screen and the live standings can never disagree.
// ---------------------------------------------------------------------------
function standardContribution({hud, actor, stats, kills, deaths, team, outcome, modeId, resultSummary, modeName}) {
 const columns = modeColumns(modeId);
 const personal = [];
 for (const [field, label] of columns.slice(0, 4)) {
  const raw = field in stats ? num(stats[field]) : num(actor?.[field]);
  personal.push(statRow(field, label, formatNumber(raw, field === 'objectiveTime' ? 1 : 0) + (field === 'objectiveTime' ? 's' : ''), raw));
 }
  if (!personal.some(row => row.id === 'kills')) personal.push(statRow('kills', 'ELIMINATIONS', score(kills), kills));
 if (deaths > 0 || personal.length < 6) personal.push(statRow('deaths', 'DEATHS', score(deaths), deaths));
 const teamRows = [];
 if (team !== null && team !== undefined && hud?.teamScores) {
  const enemy = team === 0 ? 1 : 0;
  teamRows.push(statRow('team-score', 'YOUR TEAM', score(hud.teamScores[team]), num(hud.teamScores[team])));
  teamRows.push(statRow('enemy-score', 'ENEMY TEAM', score(hud.teamScores[enemy]), num(hud.teamScores[enemy])));
 }
 const headline = chooseHeadline([
  ...personal.filter(row => row.id !== 'kills' && row.id !== 'deaths').map(row => ({id: row.id, raw: num(row.raw), text: `You posted ${row.value} ${row.label.toLowerCase()}.`})),
  {id: 'kills', raw: kills, text: `You eliminated ${score(kills)} opponents.`},
  {id: 'time', raw: Math.round(num(hud?.time)), text: `You stayed in the fight for ${score(Math.round(num(hud?.time)))}s.`},
 ]);
 return {
  kind: 'standard', modeId, title: 'MATCH CONTRIBUTION', outcome,
  endReason: resultSummary || `${String(modeName || modeId).toUpperCase()} ended.`,
  personal, team: teamRows, saved: [], headline: headline.text, headlineSource: headline.source,
 };
}

/** Mode-specific contribution summary for the results screen. Pure read. */
export function contributionSummary({hud = null, actor = null, mode = null, campaign = null, resultSummary = null} = {}) {
 const modeId = String(mode ?? hud?.config?.mode ?? '');
 const modeName = String(hud?.modeName ?? modeId);
 const stats = scoreStats(actor);
 const kills = int(actor?.frags);
 const deaths = int(actor?.deaths);
 const team = actor?.team === 0 || actor?.team === 1 ? Number(actor.team) : null;
 const kind = kindOf(hud, modeId);
 const outcome = resultOutcome(hud, actor);
 if (kind === 'solo') return soloContribution({hud, actor, single: hud?.singleplayer ?? null, modeId, campaign, kills, outcome});
 if (kind === 'operations') return operationsContribution({hud, cocs: hud?.cocs ?? null, actor, kills, outcome, modeId});
 if (kind === 'lattice') return latticeContribution({hud, cocs: hud?.cocs ?? null, actor, kills, team, outcome, modeId, resultSummary});
 return standardContribution({hud, actor, stats, kills, deaths, team, outcome, modeId, resultSummary, modeName});
}

// ---------------------------------------------------------------------------
// XP breakdown. Categories always sum exactly to the awarded total: the match
// base is `matchXp` (the same function that granted the reward), the challenge
// share is the difference between the recorded base and that match formula,
// and any payload the model cannot itemize lands in a labelled adjustment.
// ---------------------------------------------------------------------------
export function rewardBreakdown({actor = null, reward = null, win = false} = {}) {
 const stats = scoreStats(actor);
 const frags = int(actor?.frags);
 const combat = frags * 12;
 const objective = Math.round(
  num(stats.objectiveTime) * 1.5
  + int(stats.objectiveCaptures) * 30
  + int(stats.captures) * 120
  + int(stats.flagPickups) * 15
  + int(stats.flagReturns) * 10,
 );
 const victory = win === true ? 80 : 0;
 const base = matchXp({win: win === true, actor});
 const baseFloor = Math.max(0, base - (40 + combat + objective + victory));
 const objectiveCredit = Math.max(0, base - combat - victory - 40 - baseFloor);
 const baseGained = int(reward?.baseGained);
 const challenge = baseGained > 0 ? Math.max(0, baseGained - base) : 0;
 const prestige = int(reward?.prestigeBonus);
 const achievements = int(reward?.achievementXp);
 const total = int(reward?.gained);
 const categories = [
  {id: 'match-base', label: 'MATCH BASE', raw: 40, value: score(40)},
  {id: 'combat', label: 'COMBAT', raw: combat, value: score(combat)},
  {id: 'objective', label: 'OBJECTIVE', raw: objectiveCredit, value: score(objectiveCredit)},
 ];
 if (victory > 0) categories.push({id: 'victory', label: 'VICTORY', raw: victory, value: score(victory)});
 if (baseFloor > 0) categories.push({id: 'minimum', label: 'MATCH MINIMUM', raw: baseFloor, value: score(baseFloor)});
 if (challenge > 0) categories.push({id: 'challenges', label: 'CHALLENGES', raw: challenge, value: score(challenge)});
 if (prestige > 0) categories.push({id: 'prestige', label: 'PRESTIGE BONUS', raw: prestige, value: score(prestige)});
 if (achievements > 0) categories.push({id: 'achievements', label: 'ACHIEVEMENTS', raw: achievements, value: score(achievements)});
 const subtotal = categories.reduce((sum, entry) => sum + entry.raw, 0);
 const residual = total - subtotal;
 if (residual !== 0) categories.push({id: 'adjustment', label: 'ADJUSTMENT', raw: residual, value: `${residual > 0 ? '+' : '-'}${score(Math.abs(residual))}`});
 return {
  available: total > 0,
  categories,
  total,
  totalLabel: `+${score(total)}`,
  objectiveCredit,
  challenge,
  sum: categories.reduce((sum, entry) => sum + entry.raw, 0),
 };
}

// ---------------------------------------------------------------------------
// One attainable challenge tied to this session, never a wall of progression.
// Prefers an objective this match advanced, then one whose mode/team gate the
// session satisfies, then the closest to completion. Daily beats weekly on a
// tie because its target is smaller and more attainable right now.
// ---------------------------------------------------------------------------
const METRIC_LABELS = Object.freeze({
 wins: 'WINS', kills: 'ELIMINATIONS', captures: 'FLAG CAPTURES', flagReturns: 'FLAG RETURNS',
 objectiveCaptures: 'CONTROL POINTS', objectiveTime: 'SECONDS HELD', matches: 'MATCHES',
 flawlessWins: 'FLAWLESS WINS', bestStreak: 'KILLSTREAK',
});
const metricText = (metric, value) => metric === 'objectiveTime' ? `${score(value)}s` : score(value);

export function suggestChallenge({actor = null, mode = null, team = null, win = false, challenges = [], weeklyChallenges = []} = {}) {
 const modeId = String(mode ?? '');
 const result = {win: win === true, actor, mode: modeId, team: Boolean(modeId && teamMode(modeId)) || team === 0 || team === 1};
 const metrics = metricsFor(result);
 const candidates = [
  ...(Array.isArray(challenges) ? challenges : []).map(def => ({def, source: 'daily'})),
  ...(Array.isArray(weeklyChallenges) ? weeklyChallenges : []).map(def => ({def, source: 'weekly'})),
 ];
 const scored = [];
 for (const {def, source} of candidates) {
  if (!def || def.done === true) continue;
  const target = int(def.target);
  if (target <= 0) continue;
  const progress = Math.min(int(def.progress), target);
  const remaining = target - progress;
  const gate = challengeMatches({mode: def.mode ?? undefined, team: def.team === true}, result);
  const gained = int(metrics[def.metric]);
  const closeness = 1 - remaining / target;
  const total = (gate ? 100 : 0) + (gained > 0 ? 60 : 0) + closeness * 30 + (def.mode ? 15 : 0) + (def.team === true ? 5 : 0) - (source === 'weekly' ? 8 : 0);
  scored.push({def, source, gained, remaining, total});
 }
 if (!scored.length) return null;
 scored.sort((a, b) => (b.total - a.total) || (a.remaining - b.remaining) || String(a.def.id).localeCompare(String(b.def.id)));
 const best = scored[0];
 const def = best.def;
 const progress = Math.min(int(def.progress), int(def.target));
 const label = METRIC_LABELS[def.metric] ?? String(def.metric ?? '').toUpperCase();
 return {
  id: def.id,
  label: def.label,
  metric: def.metric,
  source: best.source,
  target: int(def.target),
  progress,
  remaining: best.remaining,
  reward: int(def.reward),
  sessionGained: best.gained,
  detail: `${metricText(def.metric, progress)} / ${metricText(def.metric, def.target)} ${label}${best.gained > 0 ? ` · THIS MATCH +${metricText(def.metric, best.gained)}` : ''} · +${score(def.reward)} XP`,
 };
}

// ---------------------------------------------------------------------------
// Next-match plan. Each action carries a stable id and a stated reason so a
// caller can record voluntary second-match starts without inferring intent
// from session length. The model itself starts nothing.
// ---------------------------------------------------------------------------
const action = (id, label, detail, kind, extra = {}) => ({id, label, detail, kind, ...extra});

export function nextMatchPlan({hud = null, actor = null, mode = null, campaign = null, challenges = [], weeklyChallenges = [], ranked = null, rankedQueued = null, net = null, lastDemo = null, mapNameFor = null} = {}) {
 const modeId = String(mode ?? hud?.config?.mode ?? '');
 const config = hud?.config ?? {};
 const modeName = String(hud?.modeName ?? modeId);
 const mapId = hud?.mapId ?? null;
 const mapName = String(hud?.mapName ?? mapId ?? 'ARENA');
 const duration = Math.round(num(hud?.time));
 const settings = {
  bots: int(config.botCount),
  difficulty: config.difficulty ?? 'normal',
  timeLimit: Number.isFinite(Number(config.timeLimit)) ? Number(config.timeLimit) : null,
 };
 const outcome = resultOutcome(hud, actor);
 const single = hud?.singleplayer ?? null;
 const kind = kindOf(hud, modeId);
 const context = `${modeName.toUpperCase()} · ${mapName.toUpperCase()} · ${score(duration)}s`;
 const options = [];
 let primary = null;
 let savedProgress = null;
 let queue = null;
 let practice = null;

 const connected = Boolean(net?.connected);
 if (connected) {
  primary = action('return-lobby', 'RETURN TO LOBBY', `${context} · SERVER MATCH`, 'lobby', {reason: 'server-match'});
  options.push(action('ranked-again', 'FIND ANOTHER RANKED MATCH', ranked?.queue === 'ranked' || rankedQueued ? 'SERVER LADDER · RATED · SAME RULESET' : 'SERVER LADDER · RATED', 'ranked', {reason: 'rematch'}));
  if (rankedQueued) queue = {active: true, label: 'RANKED QUEUE · SEARCHING', detail: 'RATED · SERVER LADDER · LEAVE ANY TIME'};
  practice = {
   id: 'practice', label: rankedQueued ? 'LEAVE QUEUE & PRACTICE' : 'PRACTICE LOCALLY',
   detail: 'LOCAL VS BOTS · UNRANKED · NEVER RATED', modeId: 'deathmatch', botCount: 3,
   difficulty: String(config.difficulty ?? 'normal'), ranked: false, requiresQueueLeave: Boolean(rankedQueued),
  };
 } else if (kind === 'solo' && (single?.kind === 'campaign' || modeId === 'campaign')) {
  const mission = single?.mission ?? null;
  const missionId = mission?.id ?? null;
  const steps = Array.isArray(single?.steps) ? single.steps : [];
  const stepTotal = steps.length;
  const stepsDone = steps.filter(step => step?.done === true).length;
  const won = outcome === 'win';
  const checkpoint = missionId ? checkpointFor(campaign, missionId) : null;
  const entry = (campaign?.completed ?? {})[missionId] ?? null;
  const attempts = int(entry?.attempts);
  const stars = mission && isMissionComplete(entry) ? missionStars(mission, entry) : 0;
  const completedCount = CAMPAIGN_MISSIONS.filter(item => isMissionComplete((campaign?.completed ?? {})[item.id])).length;
  options.push(action('change-loadout', 'TRY A NEW LOADOUT', `KEEP ${String(mission?.name ?? 'CAMPAIGN').toUpperCase()}; SWAP OPERATOR OR HARNESS`, 'selection', {reason: 'new-loadout'}));
  if (won) {
   const next = nextMissionId(campaign);
   if (next) {
    const nextMission = missionFor(next);
    const nextMap = mapNameFor?.(nextMission.mapId)?.name ?? nextMission.mapId;
    primary = action('next-mission', `NEXT MISSION · ${String(nextMission.name).toUpperCase()}`, `${String(nextMission.tag ?? 'CAMPAIGN').toUpperCase()} · ${String(nextMap).toUpperCase()} · PAR ${score(campaignMissionPar(nextMission))}s`, 'campaign', {modeId: 'campaign', missionId: next, mapId: nextMission.mapId, mapName: String(nextMap), reason: 'campaign-progress'});
   } else {
    primary = action('mission-select', 'CAMPAIGN COMPLETE · REPLAY A MISSION', `ALL ${CAMPAIGN_MISSIONS.length} MISSIONS CLEARED · ${mapName.toUpperCase()}`, 'selection', {reason: 'campaign-complete'});
   }
   savedProgress = {campaign: {missionId, missionName: mission?.name ?? null, completed: true, stars, attempts, stepsDone, stepTotal, completedCount, total: CAMPAIGN_MISSIONS.length, nextMissionId: next ?? null}};
  } else if (checkpoint !== null) {
   primary = action('resume-checkpoint', `RESUME FROM CHECKPOINT · STEP ${checkpoint}`, `${String(mission?.name ?? 'CAMPAIGN').toUpperCase()} · ${String(mission?.tag ?? 'CAMPAIGN').toUpperCase()} · ${stepTotal || '—'} STEPS · ATTEMPTS ${attempts}`, 'campaign', {modeId: 'campaign', missionId, checkpointStep: checkpoint, reason: 'checkpoint'});
   savedProgress = {campaign: {missionId, missionName: mission?.name ?? null, completed: false, checkpointStep: checkpoint, stepsDone, stepTotal, stars, attempts, completedCount, total: CAMPAIGN_MISSIONS.length}};
  } else {
   primary = action('retry-campaign', `RETRY MISSION · ${String(mission?.name ?? 'CAMPAIGN').toUpperCase()}`, `${String(mission?.tag ?? 'CAMPAIGN').toUpperCase()} · STEP ${stepsDone} OF ${stepTotal || '—'}${attempts > 0 ? ` · ATTEMPTS ${attempts}` : ''}`, 'campaign', {modeId: 'campaign', missionId, reason: 'loss'});
   savedProgress = {campaign: {missionId, missionName: mission?.name ?? null, completed: false, checkpointStep: null, stepsDone, stepTotal, stars, attempts, completedCount, total: CAMPAIGN_MISSIONS.length}};
  }
 } else if (kind === 'solo') {
  const wave = int(single?.wave);
  const target = int(single?.waveTarget);
  const endless = single?.endless === true || target <= 0;
  const bestWave = int(single?.bestWave) || wave;
  const cleared = outcome === 'win' ? target : Math.max(0, Math.min(target || wave, wave - 1));
  primary = action('retry-horde', outcome === 'win' ? 'RUN HORDE AGAIN' : `RETRY HORDE · WAVE ${Math.max(1, wave)}`, `${modeName.toUpperCase()} · ${mapName.toUpperCase()} · ${score(duration)}s · BEST WAVE ${score(bestWave)}`, 'horde', {modeId: 'horde', reason: outcome === 'win' ? 'win' : 'loss'});
  options.push(action('change-loadout', 'TRY A NEW LOADOUT', `KEEP HORDE · ${mapName.toUpperCase()}; SWAP OPERATOR OR HARNESS`, 'selection', {reason: 'new-loadout'}));
  savedProgress = {horde: {wave, target, endless, cleared, bestWave, score: int(single?.score), kills: int(single?.kills), upgrades: Array.isArray(single?.upgrades) ? single.upgrades.length : int(single?.upgradeCount)}};
 } else if (kind === 'operations') {
  const waves = hud?.cocs?.waves ?? {};
  const director = hud?.cocs?.director ?? {};
  const tier = String(hud?.cocs?.tier ?? director.tier ?? '');
  const cleared = int(waves.cleared);
  const par = int(waves.par) || int(director.waveCount) || 5;
  const detail = `${tier ? `DIRECTOR ${tier} · ` : ''}${cleared}/${par} WAVES · ${mapName.toUpperCase()} · ${score(duration)}s`;
  primary = outcome === 'win'
   ? action('rematch', 'REMATCH · OPERATIONS', detail, 'rematch', {modeId, reason: 'win'})
   : action('retry-operation', `RETRY OPERATION · WAVE ${Math.min(par, cleared + 1)} OF ${par}`, detail, 'rematch', {modeId, reason: 'loss'});
  options.push(action('change-loadout', 'TRY A NEW LOADOUT', `KEEP OPERATIONS · ${mapName.toUpperCase()}; SWAP OPERATOR OR HARNESS`, 'selection', {reason: 'new-loadout'}));
 } else {
  const label = modeId === 'cocs' ? 'LATTICE STRIKE' : modeName.toUpperCase();
  const verb = outcome === 'win' ? 'REMATCH' : outcome === 'loss' ? 'RUN IT BACK' : 'PLAY AGAIN';
  primary = action('rematch', `${verb} · ${label}`, context, 'rematch', {modeId, reason: outcome ?? 'rematch'});
  options.push(action('change-loadout', 'TRY A NEW LOADOUT', `KEEP ${label} · ${mapName.toUpperCase()}; SWAP OPERATOR OR HARNESS`, 'selection', {reason: 'new-loadout'}));
 }
 const replay = lastDemo?.id ? {id: 'watch-replay', label: 'WATCH REPLAY', detail: `RECORDED · ${mapName.toUpperCase()} · ${score(duration)}s`, demoId: lastDemo.id} : null;
 return {
  primary,
  options,
  replay,
  queue,
  practice,
  savedProgress,
  settings,
  context,
  modeId,
  modeName,
  mapId,
  mapName,
  duration,
  challenge: suggestChallenge({actor, mode: modeId, win: outcome === 'win', challenges, weeklyChallenges}),
 };
}

/** One composition the results screen can render directly. Pure read. */
export function matchLearningSummary({hud = null, actor = null, mode = null, reward = null, campaign = null, challenges = [], weeklyChallenges = [], ranked = null, rankedQueued = null, net = null, lastDemo = null, resultSummary = null, mapNameFor = null} = {}) {
 const outcome = resultOutcome(hud, actor);
 const contribution = contributionSummary({hud, actor, mode, campaign, resultSummary});
 const xp = rewardBreakdown({actor, reward, win: outcome === 'win'});
 const next = nextMatchPlan({hud, actor, mode, campaign, challenges, weeklyChallenges, ranked, rankedQueued, net, lastDemo, mapNameFor});
 return {contribution, xp, next, outcome};
}
