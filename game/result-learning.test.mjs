// F08/F11 — result learning summary: contribution, XP breakdown and next
// action. These assert semantic values against the authoritative records the
// simulation writes, plus the idempotence guarantee (a results screen visit is
// a pure read and can never duplicate credit).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 contributionSummary, matchLearningSummary, nextMatchPlan, resultOutcome, rewardBreakdown, suggestChallenge,
} from './result-learning.mjs';
import {awardMatch, defaultProgression, matchRewardSummary, MAX_LEVEL, totalXpForLevel, xpForLevel} from './progression.mjs';

const latticeHud = (over = {}) => ({
 config: {mode: 'cocs', botCount: 5, difficulty: 'normal', timeLimit: 600},
 modeName: 'Lattice Strike', mapId: 'foundry', mapName: 'Foundry', time: 412,
 overReason: 'dominance', winner: 1, teamScores: {0: 14, 1: 22},
 cocs: {
  winner: 1, scores: {0: 14, 1: 22},
  orderStats: {issued: 9, completed: 5, byVerb: {HOLD: 2, ATTACK: 2, SCAN: 1}},
  nodes: [{id: 'hq-0', owner: 0}, {id: 'front-0', owner: 1}, {id: 'front-1', owner: 1}],
  fluxSpent: {0: 120, 1: 200},
 },
 actorId: 0,
 actors: [{id: 0, team: 0, frags: 7, deaths: 2, scoreStats: {objectiveCaptures: 0, objectiveTime: 74.5, ordersContributed: 3, damage: 810}}],
 ...over,
});

test('LATTICE contribution separates personal credit from team totals without a frags column', () => {
 const hud = latticeHud();
 const summary = contributionSummary({hud, actor: hud.actors[0]});
 assert.equal(summary.kind, 'lattice');
 const personal = Object.fromEntries(summary.personal.map(row => [row.id, row]));
 assert.equal(personal.captures.value, '0', 'a zero capture count still matches the record');
 assert.equal(personal.hold.value, '74.5s');
 assert.equal(personal.hold.raw, 74.5);
 assert.equal(personal.orders.value, '3');
 assert.equal(personal.kills.value, '7');
 assert.ok(!summary.personal.some(row => row.label === 'FRAGS'), 'no second contradictory frags column');
 assert.equal(personal.damage.raw, 810);
 const team = Object.fromEntries(summary.team.map(row => [row.id, row]));
 assert.equal(team['team-op'].value, '14');
 assert.equal(team['enemy-op'].value, '22');
 assert.equal(team.nodes.value, '1 / 3');
 assert.equal(team['orders-match'].value, '5 / 9');
 assert.equal(team['orders-match'].label, 'MATCH ORDERS COMPLETED');
 assert.match(team['orders-match'].hint, /both teams/);
 assert.equal(summary.team.some(row => row.id === 'orders-team'), false, 'no row implies the global tally is team-scoped');
 assert.equal(team.flux.raw, 120);
 assert.match(summary.headline, /3 ordered captures/, 'a support player is credited before K/D');
 assert.match(summary.endReason, /dominance|took the lattice/i, 'the terminal reason comes from the authoritative result summary');
});

test('LATTICE defender with zero captures is credited for objective hold time', () => {
 const hud = latticeHud({actors: [{id: 0, team: 0, frags: 1, deaths: 9, scoreStats: {objectiveCaptures: 0, objectiveTime: 120.25, ordersContributed: 0, damage: 90}}]});
 const summary = contributionSummary({hud, actor: hud.actors[0]});
 assert.match(summary.headline, /held owned ground for 120\.(2|3)s/, summary.headline);
 assert.equal(summary.headlineSource, 'hold');
});

test('OPERATIONS partial loss reports waves, HQ integrity and spend effects with truthful zeros', () => {
 const actor = {id: 0, team: 0, frags: 9, deaths: 3, scoreStats: {objectiveCaptures: 1, objectiveTime: 40, ordersContributed: 2, damage: 2100}, reqSpent: 185, reqEarned: 210};
 const hud = {
  config: {mode: 'cocs-coop', botCount: 4, difficulty: 'normal', timeLimit: 900},
  modeName: 'Operations', mapId: 'lattice-slice', mapName: 'Lattice Slice', time: 900, overReason: 'hq-destroyed', winner: 1,
  cocs: {
   coop: true, tier: 'D2', winner: 1, scores: {0: 30, 1: 44},
   waves: {cleared: 2, par: 5, current: 3, forceAlive: 0, forceTotal: 42},
   director: {tier: 'D2', waveCount: 5, siege: {health: 0, max: 1000, repairs: 120}, intermission: {spent: 340}, stats: {spent: 340}},
   bonusTelemetry: {done: ['no-breach'], failed: ['under-time']},
   req: [{id: 0, req: 25, earned: 210, spent: 185}],
  },
  actorId: 0,
  actors: [actor],
 };
 const summary = contributionSummary({hud, actor});
 assert.equal(summary.kind, 'operations');
 assert.match(summary.endReason, /wave 3 of 5/);
 assert.match(summary.endReason, /2 of 5 waves cleared/);
 const personal = Object.fromEntries(summary.personal.map(row => [row.id, row]));
 assert.equal(personal.req.value, '185');
 assert.match(personal.req.hint, /210 earned/);
 assert.equal(personal.hold.value, '40s');
 assert.equal(personal.captures.value, '1');
 const team = Object.fromEntries(summary.team.map(row => [row.id, row]));
 assert.equal(team.waves.value, '2 / 5');
 assert.equal(team.hq.value, '0 / 1000');
 assert.match(team.hq.hint, /120 repaired/);
 assert.equal(team.flux.value, '340');
 assert.equal(team.bonus.value, '1 / 2');
 assert.match(summary.headline, /spent 185 REQ on squad support/, 'a supporting spender is credited before kills');
});

test('OPERATIONS zero-spend defender still sees personal ground time', () => {
 const actor = {id: 0, team: 0, frags: 0, deaths: 4, scoreStats: {objectiveCaptures: 0, objectiveTime: 12, ordersContributed: 0, damage: 0}};
 const hud = {
  config: {mode: 'cocs-coop', botCount: 4}, modeName: 'Operations', mapId: 'lattice-slice', mapName: 'Lattice Slice', time: 300, overReason: 'operation-failed', winner: 1,
  cocs: {coop: true, winner: 1, scores: {0: 5, 1: 12}, waves: {cleared: 1, par: 5, current: 2}, director: {siege: {health: 400, max: 1000, repairs: 0}}},
  actorId: 0, actors: [actor],
 };
 const summary = contributionSummary({hud, actor});
 assert.equal(summary.personal.find(row => row.id === 'req').value, '0');
 assert.match(summary.headline, /held captured ground for 12s/, summary.headline);
});

const campaign = (over = {}) => ({
 version: 1,
 completed: {'convoy-run': {wins: 0, attempts: 3, bestTime: null, bestScore: null, at: 0}},
 checkpoint: {missionId: 'convoy-run', step: 2},
 updatedAt: 0,
 ...over,
});

test('CAMPAIGN loss reports the stored checkpoint and attempts, and its next action resumes it', () => {
 const campaignState = campaign();
 const hud = {
  config: {mode: 'campaign', botCount: 0, timeLimit: 900, checkpoint: 2},
  modeName: 'Campaign', mapId: 'convoy-line', mapName: 'Convoy Line', time: 333, overReason: 'objective',
  singleplayer: {
   kind: 'campaign', winner: 1, elapsed: 333, kills: 14, deaths: 2, objective: 'Destroy the relay',
   steps: [{done: true}, {done: true}, {done: false}],
   mission: {id: 'convoy-run', name: 'The Long Haul', tag: 'ESCORT', index: 0, total: 5},
   checkpoint: {step: 2, missionId: 'convoy-run'},
  },
  actorId: 0, actors: [{id: 0, frags: 14, deaths: 2, scoreStats: {}}],
 };
 const actor = hud.actors[0];
 const summary = contributionSummary({hud, actor, campaign: campaignState});
 const saved = Object.fromEntries(summary.saved.map(row => [row.id, row]));
 assert.equal(saved.checkpoint.value, 'STEP 2');
 assert.equal(saved.attempts.value, '3');
 assert.equal(saved.stars.value, 'NOT CLEARED', 'an unwon mission is not awarded stars');
 const plan = nextMatchPlan({hud, actor, campaign: campaignState});
 assert.equal(plan.primary.id, 'resume-checkpoint');
 assert.match(plan.primary.label, /STEP 2/);
 assert.match(plan.primary.detail, /ATTEMPTS 3/);
 assert.equal(plan.primary.reason, 'checkpoint', 'the stated reason is available for tracking a voluntary rematch');
 assert.equal(plan.savedProgress.campaign.checkpointStep, 2);
 assert.equal(plan.savedProgress.campaign.completed, false);
 assert.ok(plan.options.some(option => option.id === 'change-loadout'));
});

test('CAMPAIGN win points at the real next mission from saved progress', () => {
 const campaignState = campaign({completed: {'convoy-run': {wins: 1, attempts: 2, bestTime: 200, bestScore: 30, at: 0}}, checkpoint: null});
 const hud = {
  config: {mode: 'campaign', botCount: 0}, modeName: 'Campaign', mapId: 'convoy-line', mapName: 'Convoy Line', time: 210, overReason: 'objective',
  singleplayer: {
   kind: 'campaign', winner: 0, elapsed: 210, kills: 20, deaths: 0, objective: 'Reach extraction',
   steps: [{done: true}, {done: true}, {done: true}],
   mission: {id: 'convoy-run', name: 'The Long Haul', tag: 'ESCORT', index: 0, total: 5},
   checkpoint: null,
  },
  actorId: 0, actors: [{id: 0, frags: 20, deaths: 0, scoreStats: {}}],
 };
 const summary = contributionSummary({hud, actor: hud.actors[0], campaign: campaignState});
 assert.match(summary.headline, /completed The Long Haul in 210s/);
 const plan = nextMatchPlan({hud, actor: hud.actors[0], campaign: campaignState, mapNameFor: id => id === 'titan-valley' ? {name: 'Titan Valley'} : null});
 assert.equal(plan.primary.id, 'next-mission');
 assert.equal(plan.primary.missionId, 'reactor-run');
 assert.match(plan.primary.label, /REACTOR RUN/);
 assert.match(plan.primary.detail, /TITAN VALLEY/);
 assert.equal(plan.savedProgress.campaign.nextMissionId, 'reactor-run');
});

test('HORDE next action keeps the authoritative run record', () => {
 const hud = {
  config: {mode: 'horde', botCount: 0}, modeName: 'Horde', mapId: 'foundry', mapName: 'Foundry', time: 420, overReason: 'objective',
  singleplayer: {
   kind: 'horde', winner: 1, wave: 4, waveTarget: 8, bestWave: 4, score: 3200, elapsed: 420, kills: 22, deaths: 1,
   upgrades: [{id: 'armor'}, {id: 'haste'}], lives: 0,
  },
  actorId: 0, actors: [{id: 0, frags: 22, deaths: 1, scoreStats: {}}],
 };
 const summary = contributionSummary({hud, actor: hud.actors[0]});
 assert.match(summary.endReason, /wave 4 of 8/);
 assert.match(summary.headline, /survived 3 waves of 8/);
 const plan = nextMatchPlan({hud, actor: hud.actors[0]});
 assert.equal(plan.primary.id, 'retry-horde');
 assert.equal(plan.primary.reason, 'loss');
 assert.equal(plan.savedProgress.horde.bestWave, 4);
 assert.equal(plan.savedProgress.horde.score, 3200);
 assert.match(plan.primary.detail, /BEST WAVE 4/);
});

const zeroActor = {id: 0, team: 0, frags: 0, deaths: 0, scoreStats: {}};

test('a LATTICE win leads with a same-rules rematch that keeps the map, mode and settings', () => {
 const hud = latticeHud({winner: 0, cocs: {...latticeHud().cocs, winner: 0}, actors: [{id: 0, team: 0, frags: 12, deaths: 1, scoreStats: {objectiveCaptures: 2, objectiveTime: 60}}]});
 const actor = hud.actors[0];
 const plan = nextMatchPlan({hud, actor});
 assert.deepEqual(plan.primary, {
  id: 'rematch', label: 'REMATCH · LATTICE STRIKE', detail: 'LATTICE STRIKE · FOUNDRY · 412s', kind: 'rematch', modeId: 'cocs', reason: 'win',
 });
 assert.equal(plan.settings.bots, 5);
 assert.equal(plan.settings.timeLimit, 600);
 assert.equal(plan.options.find(option => option.id === 'change-loadout').reason, 'new-loadout');
});

test('reward breakdown categories sum exactly to the awarded XP for win, loss and zero-stat matches', () => {
 const richActor = {id: 0, team: 0, frags: 12, deaths: 3, scoreStats: {captures: 2, flagPickups: 3, flagReturns: 1, objectiveTime: 45, objectiveCaptures: 4, shots: 80, hits: 30, damage: 900}};
 const cases = [
  {label: 'loss', profile: defaultProgression(), actor: richActor, win: false},
  {label: 'win', profile: defaultProgression(), actor: richActor, win: true},
  {label: 'zero-stat draw', profile: defaultProgression(), actor: zeroActor, win: false},
  {label: 'challenge bonus', profile: defaultProgression(), actor: richActor, win: true, bonusXp: 150, challengesCompleted: 1},
  {label: 'prestige overflow', profile: {...defaultProgression(), xp: totalXpForLevel(MAX_LEVEL) + 7000}, actor: richActor, win: true},
 ];
 for (const entry of cases) {
  const award = awardMatch(entry.profile, {win: entry.win, actor: entry.actor, mode: 'ctf', bonusXp: entry.bonusXp ?? 0, challengesCompleted: entry.challengesCompleted ?? 0});
  const reward = matchRewardSummary(award);
  const breakdown = rewardBreakdown({actor: entry.actor, reward, win: entry.win});
  assert.equal(breakdown.sum, reward.gained, `${entry.label}: categories sum to the award`);
  assert.equal(breakdown.total, reward.gained);
  assert.ok(breakdown.available);
  for (const category of breakdown.categories) assert.equal(Number.isInteger(category.raw), true, `${entry.label}: ${category.id} is integral`);
 }
});

test('reward breakdown exposes the documented categories and a prestige bonus', () => {
 const actor = {id: 0, team: 0, frags: 5, deaths: 1, scoreStats: {objectiveCaptures: 2, objectiveTime: 30, captures: 1, damage: 400}};
 const profile = {...defaultProgression(), xp: totalXpForLevel(MAX_LEVEL) + 12000};
 const award = awardMatch(profile, {win: true, actor, mode: 'ctf', bonusXp: 90, challengesCompleted: 1});
 const reward = matchRewardSummary(award);
 const breakdown = rewardBreakdown({actor, reward, win: true});
 const ids = breakdown.categories.map(category => category.id);
 assert.ok(ids.includes('match-base'));
 assert.ok(ids.includes('combat'));
 assert.ok(ids.includes('objective'));
 assert.ok(ids.includes('victory'));
 assert.ok(ids.includes('challenges'));
 assert.ok(ids.includes('prestige'));
 assert.equal(breakdown.categories.find(category => category.id === 'prestige').raw, reward.prestigeBonus);
 assert.equal(breakdown.categories.find(category => category.id === 'challenges').raw, 90);
 assert.equal(breakdown.sum, reward.gained);
});

test('a legacy reward payload without itemization still sums through an adjustment row', () => {
 const actor = {id: 0, team: 0, frags: 4, deaths: 2, scoreStats: {}};
 const reward = {gained: 305, level: 3, progress: 0.2, toNext: 400};
 const breakdown = rewardBreakdown({actor, reward, win: false});
 assert.equal(breakdown.sum, 305);
 const adjustment = breakdown.categories.find(category => category.id === 'adjustment');
 assert.ok(adjustment && adjustment.raw === 305 - (40 + 48));
});

test('repeated learning-summary reads are identical and never mutate the profile or reward', () => {
 const actor = {id: 0, team: 0, frags: 6, deaths: 1, scoreStats: {objectiveCaptures: 1, objectiveTime: 20, damage: 300}};
 const profile = defaultProgression();
 const award = awardMatch(profile, {win: true, actor, mode: 'cocs', bonusXp: 60});
 const reward = matchRewardSummary(award);
 const profileBefore = JSON.stringify(award.profile);
 const rewardBefore = JSON.stringify(reward);
 const first = matchLearningSummary({hud: latticeHud({actors: [actor]}), actor, mode: 'cocs', reward});
 const second = matchLearningSummary({hud: latticeHud({actors: [actor]}), actor, mode: 'cocs', reward});
 assert.deepEqual(second, first, 'two renders produce identical data');
 assert.equal(JSON.stringify(award.profile), profileBefore, 'the career profile is untouched');
 assert.equal(JSON.stringify(reward), rewardBefore, 'the reward payload is untouched');
});

test('a spectator summary is actor-neutral: match totals only, no contribution, no reward', () => {
 const hud = latticeHud();
 const staleReward = {gained: 999, level: 9, progress: 0.5, toNext: 100, achievementXp: 60};
 const summary = matchLearningSummary({hud, actor: null, viewer: null, mode: 'cocs', reward: staleReward});
 assert.equal(summary.viewer, 'spectator');
 assert.equal(summary.contribution.viewer, 'spectator');
 assert.equal(summary.contribution.outcome, null, 'no personal win/loss is claimed');
 assert.deepEqual(summary.contribution.personal, [], 'no personal rows exist for a spectator');
 assert.deepEqual(summary.contribution.saved, [], 'no personal saved progress is shown');
 assert.equal(summary.contribution.teamLabel, 'MATCH TOTALS');
 assert.equal(summary.xp.available, false, 'a stale reward never becomes the spectator prize');
 assert.equal(summary.xp.total, 0);
 assert.equal(summary.xp.categories.length, 0);
 // The public totals still come from the frozen snapshot, not from actor 0.
 const team = Object.fromEntries(summary.contribution.team.map(row => [row.id, row]));
 assert.equal(team['team-0-op'].value, '14');
 assert.equal(team['team-1-op'].value, '22');
 assert.equal(team['orders-match'].value, '5 / 9');
 assert.equal(team['nodes'].value, '1 / 2');
 const text = `${summary.contribution.headline} ${summary.contribution.endReason}`;
 assert.doesNotMatch(text, /\bYou\b|YOUR|your/, 'spectator copy never addresses the viewer personally');
 assert.doesNotMatch(text, /No objective credit this round/, 'the player fallback headline is not reused');
});

test('an actor record is hidden from a viewer that is spectating it', () => {
 const hud = latticeHud();
 const spectating = matchLearningSummary({hud, actor: hud.actors[0], viewer: null, mode: 'cocs'});
 assert.equal(spectating.viewer, 'spectator');
 assert.deepEqual(spectating.contribution.personal, []);
 const seated = matchLearningSummary({hud, actor: hud.actors[0], viewer: hud.actors[0], mode: 'cocs'});
 assert.equal(seated.viewer, 'player');
 assert.equal(seated.contribution.personal.find(row => row.id === 'orders').value, '3');
 assert.match(seated.contribution.headline, /You completed 3 ordered captures/);
});

test('challenge suggestion picks one attainable objective this session advanced', () => {
 const actor = {id: 0, team: 0, frags: 3, deaths: 1, scoreStats: {objectiveCaptures: 3, objectiveTime: 25}};
 const challenges = [
  {id: 'done-one', label: 'Play 3 matches', metric: 'matches', target: 3, reward: 90, progress: 3, done: true, mode: null, team: false},
  {id: 'zone-caps', label: 'Capture 4 control points', metric: 'objectiveCaptures', target: 4, reward: 150, progress: 2, done: false, mode: 'cocs', team: true},
  {id: 'kills', label: 'Score 25 eliminations', metric: 'kills', target: 25, reward: 130, progress: 20, done: false, mode: null, team: false},
 ];
 const weekly = [{id: 'week-kills', label: 'Score 60 eliminations this week', metric: 'kills', target: 60, reward: 320, progress: 55, done: false, mode: null, team: false}];
 const suggestion = suggestChallenge({actor, mode: 'cocs', win: false, challenges, weeklyChallenges: weekly});
 assert.ok(suggestion);
 assert.equal(suggestion.id, 'zone-caps', 'the mode-gated session objective wins');
 assert.equal(suggestion.sessionGained, 3);
 assert.match(suggestion.detail, /THIS MATCH \+3/);
 assert.equal(suggestion.source, 'daily');
});

test('online queue search offers leave-queue and local unranked practice', () => {
 const hud = latticeHud({actors: [zeroActor]});
 const plan = nextMatchPlan({hud, actor: zeroActor, net: {connected: true, isHost: false}, rankedQueued: {status: 'queued'}, ranked: {queue: 'ranked'}});
 assert.equal(plan.primary.id, 'return-lobby');
 assert.ok(plan.queue?.active);
 assert.equal(plan.practice.requiresQueueLeave, true);
 assert.match(plan.practice.detail, /LOCAL/);
 assert.match(plan.practice.detail, /UNRANKED/);
 assert.match(plan.practice.detail, /NEVER RATED/);
 assert.equal(plan.practice.ranked, false, 'practice is explicitly unranked');
 const local = nextMatchPlan({hud, actor: zeroActor});
 assert.equal(local.practice, null, 'a local result has no queue to leave');
 assert.equal(local.queue, null);
});

test('match-end reasons and outcomes read the authoritative winner', () => {
 const coop = {config: {mode: 'cocs-coop'}, cocs: {coop: true, winner: 0}, actors: [zeroActor]};
 assert.equal(resultOutcome(coop, zeroActor), 'win');
 assert.equal(resultOutcome({...coop, cocs: {coop: true, winner: 1}}, zeroActor), 'loss');
 const ffa = {config: {mode: 'deathmatch'}, winner: 1, actors: [zeroActor, {id: 1}]};
 assert.equal(resultOutcome(ffa, zeroActor), 'loss');
 assert.equal(resultOutcome({config: {mode: 'deathmatch'}, winner: null}, zeroActor), null);
});
