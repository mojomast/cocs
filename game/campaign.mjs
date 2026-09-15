// Single-player campaign management and cinematic progression.
// Bridges campaign data, story transmissions, and objective sequencing.

import { CAMPAIGN_MISSIONS, CAMPAIGN_MISSION_IDS, DEFAULT_MISSION_ID, campaignOrder, missionFor } from './campaign-data.mjs';
import { SPEAKERS, MISSION_LORE, getMissionLore, formatTransmission } from './story.mjs';

export {
  CAMPAIGN_MISSIONS,
  CAMPAIGN_MISSION_IDS,
  DEFAULT_MISSION_ID,
  campaignOrder,
  missionFor,
  SPEAKERS,
  MISSION_LORE,
  getMissionLore,
  formatTransmission,
};

export function getMissionBriefing(missionId) {
  const mission = missionFor(missionId);
  const lore = getMissionLore(missionId);
  return {
    id: mission.id,
    name: mission.name,
    chapter: mission.chapter || 'ACT I',
    tag: mission.tag,
    brief: mission.brief,
    location: lore?.location || 'Unknown Sector',
    intel: lore?.intel || mission.brief,
    threatLevel: lore?.threatLevel || 'Standard',
    lives: mission.lives ?? 3,
    stepsCount: mission.steps?.length ?? 0,
    intro: mission.intro,
    outro: mission.outro,
  };
}

export function getMissionTransmissions(missionId) {
  const lore = getMissionLore(missionId);
  return lore?.transmissions || [];
}

export function validateMissionProgression(completedIds = []) {
  const order = campaignOrder();
  const completed = new Set(completedIds);
  const unlocked = [];
  for (const id of order) {
    unlocked.push(id);
    if (!completed.has(id)) break;
  }
  return {
    order,
    unlocked,
    nextMission: unlocked[unlocked.length - 1] || order[0],
    isComplete: order.every(id => completed.has(id)),
  };
}
