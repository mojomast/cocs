import {CAMPAIGN_MISSIONS,campaignOrder} from './campaign-data.mjs';

// Local-only campaign progress (unlocked missions, best results, last
// checkpoint). Stored under its own key because the progression normalizer
// drops unknown fields.
export const CAMPAIGN_STORAGE_KEY = 'token-arena-campaign';
export const CAMPAIGN_PROGRESS_VERSION = 1;

const text = (value, max = 48) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';

export function defaultCampaignProgress() {
 return {version:CAMPAIGN_PROGRESS_VERSION,completed:{},checkpoint:null,updatedAt:0};
}

export function normalizeCampaignProgress(value) {
 const source = value && typeof value === 'object' ? value : {};
 const completed = {};
 for (const mission of CAMPAIGN_MISSIONS) {
  const entry = source.completed?.[mission.id];
  if (!entry || typeof entry !== 'object' || entry.won !== true) continue;
  completed[mission.id] = {
   wins:Math.max(0, Math.round(Number(entry.wins) || 1)),
   attempts:Math.max(0, Math.round(Number(entry.attempts) || 0)),
   bestTime:Number.isFinite(Number(entry.bestTime)) ? Number(entry.bestTime) : null,
   bestScore:Number.isFinite(Number(entry.bestScore)) ? Number(entry.bestScore) : null,
   at:Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0,
  };
 }
 const checkpoint = source.checkpoint && typeof source.checkpoint === 'object' && CAMPAIGN_MISSIONS.some(m => m.id === source.checkpoint.missionId)
  ? {missionId:source.checkpoint.missionId, step:Math.max(0, Math.round(Number(source.checkpoint.step) || 0))}
  : null;
 return {version:CAMPAIGN_PROGRESS_VERSION,completed,checkpoint,updatedAt:Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : 0};
}

const orderIds = () => campaignOrder();
export function isMissionUnlocked(progress, id) {
 const order = orderIds(), index = order.indexOf(id);
 if (index <= 0) return true;
 return Boolean(progress?.completed?.[order[index - 1]]);
}
export function firstIncompleteMission(progress) {
 const order = orderIds();
 return order.find(id => !progress?.completed?.[id]) || order[order.length - 1] || null;
}
export function missionIndex(id) {
 const index = orderIds().indexOf(id);
 return index < 0 ? 0 : index;
}
export function nextMissionId(progress) {
 // The next mission to play is the first one not yet completed; null once the
 // whole campaign is finished. (Returning the mission after it skipped one.)
 return orderIds().find(id => !progress?.completed?.[id]) || null;
}
/** @param {any} progress @param {{id:string,won:boolean,time?:number|null,score?:number|null}} [options] */
export function recordMission(progress, {id, won, time = null, score = null} = {}) {
 if (!won || !CAMPAIGN_MISSIONS.some(m => m.id === id)) return progress;
 const current = progress?.completed?.[id];
 const next = {
  wins:(current?.wins || 0) + 1,
  attempts:(current?.attempts || 0) + 1,
  bestTime:Number.isFinite(time) ? (Number.isFinite(current?.bestTime) ? Math.min(current.bestTime, time) : time) : (current?.bestTime ?? null),
  bestScore:Number.isFinite(score) ? (current?.bestScore === null || current?.bestScore === undefined ? score : Math.max(current.bestScore, score)) : (current?.bestScore ?? null),
  at:Date.now(),
 };
 return {...progress, completed:{...progress.completed, [id]:next}, updatedAt:Date.now()};
}
export function setCheckpoint(progress, missionId, step) {
 if (!CAMPAIGN_MISSIONS.some(m => m.id === missionId)) return progress;
 return {...progress, checkpoint:{missionId, step:Math.max(0, Math.round(step) || 0)}, updatedAt:Date.now()};
}
/** Reads the banked resume step for a mission, or null when there is none. */
export function checkpointFor(progress, missionId) {
 const checkpoint = progress?.checkpoint;
 if (!checkpoint || checkpoint.missionId !== missionId) return null;
 return Math.max(0, Math.round(Number(checkpoint.step) || 0));
}
/** Drops a banked checkpoint once its mission is completed or abandoned. */
export function clearCheckpoint(progress) {
 return progress?.checkpoint ? {...progress, checkpoint:null, updatedAt:Date.now()} : progress;
}

// ---------------------------------------------------------------------------
// Per-mission stars, medals and rewards.
//
// Everything here is derived from the immutable mission definition plus the
// stored best time/score, so it stays version-stable: no extra fields need to
// be persisted and old saves keep resolving correctly. The par time matches the
// mission-select presentation adapter (120s + 45s per authored step) so the
// stars shown in the UI and the stars awarded here always agree.
const missionById = idOrMission => typeof idOrMission === 'string'
 ? CAMPAIGN_MISSIONS.find(mission => mission.id === idOrMission) || null
 : (idOrMission && typeof idOrMission === 'object' ? idOrMission : null);

/** Deterministic par time for a mission, shared with the mission-select UI. */
export function campaignMissionPar(mission) {
 const steps = Array.isArray(mission?.steps) ? mission.steps.length : 0;
 return 120 + steps * 45;
}
/** Total number of enemies a mission actually authors across steps and script. */
export function missionEnemyBudget(mission) {
 let budget = 0;
 const add = action => {
  if (!action || !action.spawn) return;
  budget += Number.isFinite(action.spawn.count) ? Math.max(0, Math.round(action.spawn.count)) : 1;
 };
 for (const step of mission?.steps || []) {
  for (const action of step.onStart || []) add(action);
  for (const action of step.onComplete || []) add(action);
 }
 for (const event of mission?.script || []) add(event);
 return budget;
}
/** Kills needed for the score star: 60% of the authored enemy budget. */
export function missionScoreTarget(mission) {
 return Math.max(1, Math.ceil(missionEnemyBudget(mission) * .6));
}
// Completion is the bronze floor. Two stars need a strong result on time OR
// score; the third requires both the par time and the score target, so a
// flawless medal reflects the whole mission rather than a single stat.
export function missionStars(mission, entry) {
 if (!entry) return 0;
 const par = campaignMissionPar(mission);
 if (!Number.isFinite(par) || par <= 0) return 1;
 const time = Number(entry.bestTime), score = Number(entry.bestScore);
 const hasTime = Number.isFinite(entry.bestTime) && Number.isFinite(time), hasScore = Number.isFinite(entry.bestScore) && Number.isFinite(score);
 const fast = hasTime && time <= par;
 const quick = hasTime && time <= par * 1.5;
 const lethal = hasScore && score >= missionScoreTarget(mission);
 if (fast && lethal) return 3;
 if (fast || quick || lethal) return 2;
 return 1;
}
/** Medal tier for an entry: GOLD needs all three stars. */
export function missionMedal(mission, entry) {
 const stars = missionStars(mission, entry);
 if (stars <= 0) return null;
 if (stars >= 3) return 'GOLD';
 if (stars >= 2) return 'SILVER';
 return 'BRONZE';
}
/** Pure reward descriptor for a mission result. Null until the mission is won. */
export function missionReward(mission, entry) {
 const resolved = missionById(mission);
 if (!resolved) return null;
 const stars = missionStars(resolved, entry), medal = missionMedal(resolved, entry);
 if (stars <= 0) return null;
 const gold = medal === 'GOLD';
 return {missionId:resolved.id, stars, medal, xp:150 + stars * 120 + (gold ? 100 : 0), emblem:`${resolved.id}-${stars}`};
}
/** Resolves every authored threshold and the reward for one mission. */
export function missionProgress(progress, idOrMission) {
 const mission = missionById(idOrMission);
 if (!mission) return null;
 const entry = progress?.completed?.[mission.id] || null;
 return {
  missionId:mission.id,
  completed:Boolean(entry),
  stars:missionStars(mission, entry),
  medal:missionMedal(mission, entry),
  bestTime:Number.isFinite(Number(entry?.bestTime)) ? Number(entry.bestTime) : null,
  bestScore:Number.isFinite(Number(entry?.bestScore)) ? Number(entry.bestScore) : null,
  parTime:campaignMissionPar(mission),
  scoreTarget:missionScoreTarget(mission),
  reward:missionReward(mission, entry),
 };
}
/** Total stars banked across the whole campaign (0..missions*3). */
export function campaignStarTotal(progress) {
 return CAMPAIGN_MISSIONS.reduce((sum, mission) => sum + missionStars(mission, progress?.completed?.[mission.id] || null), 0);
}
/** Medal tally across completed missions. */
export function campaignMedalCounts(progress) {
 const counts = {GOLD:0, SILVER:0, BRONZE:0};
 for (const mission of CAMPAIGN_MISSIONS) {
  const medal = missionMedal(mission, progress?.completed?.[mission.id] || null);
  if (medal) counts[medal] += 1;
 }
 return counts;
}
/** Combined XP value of every medal currently banked. */
export function campaignRewardTotal(progress) {
 return CAMPAIGN_MISSIONS.reduce((sum, mission) => sum + (missionReward(mission, progress?.completed?.[mission.id] || null)?.xp || 0), 0);
}
