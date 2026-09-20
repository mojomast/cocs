// F08/F11 — results-screen SSR checks.
//
// The real ResultsModal is rendered with react-dom/server so the learned
// summary (why the match ended, personal vs team contribution, XP categories,
// next-match actions) is asserted as rendered text, not as a source string.
// The extensionless TS imports the app uses need a tiny in-test resolve hook;
// the TSX loader mirrors tests/tsx-loader.mjs (esbuild, no new dependency).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {transformSync} from 'esbuild';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {awardMatch, defaultProgression, matchRewardSummary, matchSummaryCard} from '../game/progression.mjs';

registerHooks({
 resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
   for (const ext of ['.tsx', '.ts', '.mjs', '.js']) {
    try { return nextResolve(specifier + ext, context); } catch {}
   }
  }
  return nextResolve(specifier, context);
 },
 load(url, context, nextLoad) {
  if (url.endsWith('.tsx') || url.endsWith('.ts')) {
   const source = readFileSync(new URL(url), 'utf8');
   const {code} = transformSync(source, {loader: url.endsWith('.tsx') ? 'tsx' : 'ts', format: 'esm', jsx: 'automatic', jsxImportSource: 'react', sourcefile: url, target: 'node22'});
   return {format: 'module', source: code, shortCircuit: true};
  }
  return nextLoad(url, context);
 },
});

const {ResultsModal} = await import('../app/ui/screens/ResultModals.tsx');
const render = ui => renderToStaticMarkup(React.createElement(ResultsModal, {ui}));

const baseUi = (over = {}) => ({
 awards: [], scoreboard: '<div>board</div>', resultTitle: () => 'DEFEAT',
 resultDescription: () => 'The enemy took the lattice.',
 start: () => {}, nextArena: () => {}, playDemo: () => {}, disconnectNet: () => {},
 changeMode: () => {}, lastDemo: null, net: {connected: false}, modalRef: null,
 player: null, mode: 'results', reward: null, matchSummary: null, campaign: null,
 challenges: [], weeklyChallenges: [], ranked: null, rankedQueued: null, history: {entries: []},
 startSinglePlayer: () => {}, startCampaignMission: () => {}, queueRanked: () => {}, cancelQueue: () => {},
 quickStart: () => {}, getMap: id => ({name: String(id).toUpperCase()}),
 ...over,
});

function latticeFixture() {
 const actor = {id: 0, team: 0, frags: 7, deaths: 2, scoreStats: {objectiveCaptures: 0, objectiveTime: 74.5, ordersContributed: 3, damage: 810}};
 const hud = {
  config: {mode: 'cocs', botCount: 5, difficulty: 'normal', timeLimit: 600},
  modeName: 'Lattice Strike', mapId: 'foundry', mapName: 'Foundry', time: 412,
  overReason: 'dominance', winner: 1, teamScores: {0: 14, 1: 22},
  cocs: {
   winner: 1, scores: {0: 14, 1: 22},
   orderStats: {issued: 9, completed: 5, byVerb: {HOLD: 2, ATTACK: 2, SCAN: 1}},
   nodes: [{id: 'hq-0', owner: 0}, {id: 'front-0', owner: 1}, {id: 'front-1', owner: 1}],
   fluxSpent: {0: 120, 1: 200},
  },
  actorId: 0, actors: [actor],
 };
 const award = awardMatch(defaultProgression(), {win: false, actor, mode: 'cocs', bonusXp: 120, challengesCompleted: 1});
 const reward = matchRewardSummary(award);
 return {hud, actor, reward, summary: matchSummaryCard({hud, reward, profile: award.profile, achievements: []})};
}

test('the results modal leads with outcome and contribution, then offers the next action before career progression', () => {
 const {hud, actor, reward, summary} = latticeFixture();
 const ui = baseUi({
  hud, player: actor, reward, matchSummary: summary,
  challenges: [{id: 'zone-caps', label: 'Capture 4 control points', metric: 'objectiveCaptures', target: 4, reward: 150, progress: 2, done: false, mode: 'cocs', team: true}],
  history: {entries: [{result: 'loss'}]},
 });
 const html = render(ui);
 const iNext = html.indexOf('NEXT MATCH');
 const iWhy = html.indexOf('WHY IT ENDED');
 const iXp = html.indexOf('XP BREAKDOWN');
 const iCareer = html.indexOf('match-summary');
 assert.ok(iNext >= 0, 'the next-match invitation renders');
 assert.ok(iWhy < iXp && iXp < iNext, 'why/contribution/XP lead the next-match invitation');
 assert.ok(iNext < iCareer, 'the focused next action remains before the career tracks');
 // Authoritative personal and team values, including the honest zero.
 assert.match(html, /NODE CAPTURES<\/dt><dd>0/);
 assert.match(html, /NODE HOLD<\/dt><dd>74\.5s/);
 assert.match(html, /ORDERS CONTRIBUTED<\/dt><dd>3/);
 assert.match(html, /YOUR TEAM OP<\/dt><dd>14/);
 assert.match(html, /ENEMY OP<\/dt><dd>22/);
 assert.match(html, /NODES OWNED<\/dt><dd>1 \/ 3/);
 assert.match(html, /ORDERS COMPLETED<\/dt><dd>5 \/ 9/);
 // A support player is credited without a high K/D and never sees a frags column.
 assert.match(html, /3 ordered captures/);
 assert.doesNotMatch(html, /FRAGS/);
 // XP categories sum to the award figure that was granted.
 assert.match(html, new RegExp(`CATEGORIES SUM TO <b>\\+${reward.gained} XP</b>`));
 for (const label of ['MATCH BASE', 'COMBAT', 'OBJECTIVE', 'CHALLENGES']) assert.ok(html.includes(label), label);
 // One attainable challenge, not a wall of progression.
 assert.match(html, /CHALLENGE · Capture 4 control points/);
 // Mode-appropriate next action with map/mode/duration.
 assert.match(html, /RUN IT BACK · LATTICE STRIKE/);
 assert.match(html, /LATTICE STRIKE · FOUNDRY · 412s/);
});

test('repeated results renders are identical and never double-count the award', () => {
 const {hud, actor, reward, summary} = latticeFixture();
 const ui = baseUi({hud, player: actor, reward, matchSummary: summary, history: {entries: [{result: 'loss'}]}});
 const first = render(ui);
 const second = render(ui);
 assert.equal(second, first, 'a repeated UI visit renders the same summary, not doubled credit');
 assert.equal((first.match(new RegExp(`\\+${reward.gained} XP`, 'g')) || []).length, (second.match(new RegExp(`\\+${reward.gained} XP`, 'g')) || []).length);
});

test('a failed campaign renders a real saved-checkpoint next action', () => {
 const campaign = {version: 1, completed: {'convoy-run': {wins: 0, attempts: 3}}, checkpoint: {missionId: 'convoy-run', step: 2}, updatedAt: 0};
 const hud = {
  config: {mode: 'campaign', botCount: 0, timeLimit: 900},
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
 const award = awardMatch(defaultProgression(), {win: false, actor, mode: 'campaign'});
 const reward = matchRewardSummary(award);
 const ui = baseUi({hud, player: actor, reward, campaign, matchSummary: matchSummaryCard({hud, reward, profile: award.profile, achievements: []}), history: {entries: [{result: 'loss'}]}});
 const html = render(ui);
 assert.match(html, /RESUME FROM CHECKPOINT · STEP 2/);
 assert.match(html, /BANKED CHECKPOINT<\/dt><dd>STEP 2/);
 assert.match(html, /ATTEMPTS<\/dt><dd>3/);
 assert.match(html, /SAVED PROGRESS/);
});

test('an online queue search renders an explicit leave-queue and local unranked practice path', () => {
 const {hud, actor, reward, summary} = latticeFixture();
 const ui = baseUi({
  hud, player: actor, reward, matchSummary: summary, net: {connected: true, isHost: false},
  ranked: {queue: 'ranked'}, rankedQueued: {status: 'queued'}, history: {entries: [{result: 'loss'}]},
 });
 const html = render(ui);
 assert.match(html, /RETURN TO LOBBY/);
 assert.match(html, /RANKED QUEUE · SEARCHING/);
 assert.match(html, /LEAVE QUEUE &amp; PRACTICE|LEAVE QUEUE & PRACTICE/);
 assert.match(html, /LOCAL VS BOTS · UNRANKED · NEVER RATED/);
});

test('the page ui bag provides every field the results modal reads', async () => {
 const page = await readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
 for (const field of [
  'campaign,', 'challenges:challengeStatus', 'weeklyChallenges:weeklyStatus', 'ranked:netRanked',
  'rankedQueued:netQueued', 'history,', 'startSinglePlayer', 'startCampaignMission', 'queueRanked,cancelQueue',
  'quickStart', 'getMap',
 ]) assert.ok(page.includes(field), `ui bag provides ${field}`);
});

test('the practice action leaves a rated queue before it starts a local match', async () => {
 const src = await readFileSync(new URL('../app/ui/screens/ResultModals.tsx', import.meta.url), 'utf8');
 const practice = src.indexOf("case 'practice':");
 const leave = src.indexOf('cancelQueue?.()', practice);
 const start = src.indexOf('quickStart?.(', practice);
 assert.ok(practice >= 0 && leave > practice && start > leave, 'cancelQueue runs before quickStart for practice');
 const checkpoint = src.indexOf("case 'resume-checkpoint':");
 const retryHorde = src.indexOf("case 'retry-horde':");
 const campaignStart = src.indexOf("startSinglePlayer?.('campaign')", checkpoint);
 const hordeStart = src.indexOf("startSinglePlayer?.('horde')", retryHorde);
 assert.ok(campaignStart > checkpoint && hordeStart > retryHorde, 'solo actions resume stored progress instead of a fresh local launch');
});
