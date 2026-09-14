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
