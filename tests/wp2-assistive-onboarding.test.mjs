// WP2.2 + WP2.3 UI contract: one assistive announcement channel, non-live
// readouts, FFA/team respawn parity and the title-first onboarding sequence.
//
// The transition semantics (announce once, no churn) live in
// `game/assistive-announce.test.mjs`. This file proves the real components
// render that contract: the HUD ships exactly one always-mounted live region
// for combat beats, every countdown/cooldown readout is a non-live group, and
// the passive respawn surface never becomes a second announcement channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

register('./tsx-loader.mjs', import.meta.url);
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier,context,nextResolve){try{return await nextResolve(specifier,context);}catch(error){if(!specifier.startsWith('.'))throw error;for(const ext of ['.tsx','.ts']){try{return await nextResolve(specifier+ext,context);}catch{}}throw error;}}`)}`);
// The training HUD imports a CSS module; Node has no CSS loader, so stub it.
register(`data:text/javascript,${encodeURIComponent(`export async function load(url,context,nextLoad){if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true};return nextLoad(url,context);}`)}`);
const {PlayingHud} = await import('../app/ui/screens/PlayingHud.tsx');
const {RespawnOverlay} = await import('../app/ui/screens/RespawnOverlay.tsx');
const {SpendWindowHud} = await import('../app/ui/screens/SpendWindowHud.tsx');
const {LatticeTrainingHud} = await import('../app/ui/screens/LatticeTrainingHud.tsx');

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const liveCount = html => (html.match(/role="status"/g) ?? []).length;
const politeCount = html => (html.match(/aria-live="polite"/g) ?? []).length;
const announcer = html => {
  const match = html.match(/<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">([\s\S]*?)<\/div>/);
  return match ? match[1] : null;
};
const abilityLabel = html => (html.match(/aria-label="Ability [^"]*"/) ?? [''])[0];

const player = (overrides = {}) => ({
  id: 0, name: 'CHATGPT', team: 0, character: 'chatgpt', harness: 'openclaw',
  health: 100, maxHealth: 100, armor: 50, frags: 3, deaths: 0, weapon: 0,
  ammo: {0: 30}, dead: 0, slow: 0, powerups: {}, cooldown: 0, protection: 0,
  streak: 0, grenadeCooldown: 0, movement: null, scoreStats: {}, isVip: false, ladder: 0,
  ...overrides,
});
const hud = (overrides = {}) => ({
  time: 12.3, mapName: 'Colosseum', modeName: 'Deathmatch', route: 'ARENA',
  config: {timeLimit: 300, botCount: 0, fragLimit: 25, mode: 'deathmatch', startingWeapon: 0},
  net: false, spectate: false, actors: [player()], actorId: 0, feed: [], objectives: null,
  teamScores: {0: 0, 1: 0}, quality: null, fps: 60, renderer: 'webgl', pickup: '',
  over: false, suddenDeath: false, damageNumbers: [], captureNotice: null,
  ...overrides,
});
const ui = (overrides = {}) => ({
  hud: hud(), player: player(), display: {showKillFeed: true, showRadar: true, showDamageNumbers: true},
  brief: {title: 'HUNT THE NEXT TOKEN', action: 'Find an angle and secure the next frag.', detail: 'FIRST TO 25 FRAGS', status: '3 / 25'},
  phase: 'OPENING', hudRoute: 'ARENA', hudMap: {}, hudMode: {id: 'deathmatch'},
  isTeamMode: () => false, teamName: team => (Number(team) === 0 ? 'RED' : 'BLUE'), modeGoal: () => 'FRAGS',
  ladderStatus: () => ({rung: 0, label: 'LADDER 1/10'}), flagText: () => '', armsrace: false,
  WEAPONS: [{name: 'RAIL', cap: 10, interval: .8, ammo: 10, short: 'RAIL'}], activePower: null,
  powerIcon: () => null, radar: {contacts: []}, radarCols: {}, radarBlip: () => null,
  marker: null, reloadFill: 0, reloading: false, posture: null, killNotice: null,
  suddenBanner: null, startBanner: null, scoreCue: null, damageIndicator: null,
  damageNumberStyle: () => ({opacity: 1, dy: 0}), reducedMotion: () => false,
  vehiclePrompt: '', vehicle: null, ammoEmpty: false, ammoLow: false, hideHud: false,
  touchControls: false, pointerHint: false, requestLock: () => {}, chatOpen: false,
  isSingle: false, single: null, selectHordeUpgrade: () => {}, resumeSingleplayer: () => {},
  spectatorTeams: () => [], CAMERA_MODE_LABELS: {}, runtime: {current: null},
  changeMode: () => {}, grenadeStatus: () => ({ready: true, cooldown: 0, label: 'FRAG READY'}),
  streakStatus: () => null, killFeedWeapon: () => null, voiceState: {enabled: false, mode: 'ptt'},
  voiceHint: () => null, escapeHint: () => 'ESC / PAUSE', clock: () => '4:47',
  teamScoreText: () => '', ammoText: value => String(value), weaponTag: () => null, cocsCommand: null,
  cursor: {active: false, key: 'ALT', blocked: false, label: '', resume: () => {}},
  bindings: {},
  ...overrides,
});

test('PlayingHud ships one always-mounted live channel and no live countdown readouts', () => {
  const first = render(PlayingHud, {ui: ui()});
  // 80 ms later the snapshot has ticked: cooldowns and the clock moved.
  const later = render(PlayingHud, {ui: ui({
    hud: hud({time: 12.38}),
    player: player({cooldown: 4.2, grenadeCooldown: 3.6, ammo: {0: 29}}),
  })});

  assert.equal(liveCount(first), 1, 'exactly one live region in steady combat');
  assert.equal(politeCount(first), 1, 'that region is the polite announcement channel');
  assert.equal(announcer(first), '', 'steady combat leaves the channel empty');
  assert.equal(announcer(later), '', 'a ticked snapshot does not churn the channel');
  assert.equal(abilityLabel(later) !== abilityLabel(first), true, 'the snapshot really did change the ability readout');
  assert.match(later, /aria-label="Ability recharging [\d.]+ seconds"/, 'the ability readout still carries its state for on-demand reading');
  assert.match(first, /class="ability-card frag-card/, 'cooldown cards are present');

  // The source keeps every continuously changing readout non-live.
  return read('app/ui/screens/PlayingHud.tsx').then(source => {
    const grouped = [
      ['lattice-coach', 'lattice-coach" role="group"'],
      ['field role', 'lattice-kit-details'],
      ['rung', 'cocs-readout__rung" role="group"'],
      ['traversal channel', 'cocs-traversal__channel" role="group"'],
      ['arrival protection', 'cocs-traversal__arrival" role="group"'],
      ['idle interact prompt', 'cocs-interact--idle" role="group"'],
      ['depot prompt', 'cocs-interact--depot" role="group"'],
      ['strip context', 'cocs-strip__context" role="group"'],
      ['strip prompt', 'cocs-strip__prompt" role="group"'],
      ['strip pending', 'cocs-strip__pending" role="group"'],
      ['strip issued', 'cocs-strip__issued" role="group"'],
      ['action notice', 'cocs-notice'],
      ['cursor chip', 'cursor-chip'],
      ['ability card', 'ability-card'],
    ];
    for (const [name, needle] of grouped) assert.ok(source.includes(needle), `${name} is a non-live group`);
    for (const className of ['lattice-coach', 'cocs-readout__rung', 'cocs-traversal__channel', 'cocs-traversal__arrival', 'cocs-interact', 'cocs-strip__context', 'cocs-strip__prompt', 'cocs-strip__pending', 'cocs-strip__issued', 'ability-card', 'cursor-chip', 'cocs-notice', 'kill-banner', 'kill-callout', 'objective-announcer', 'death-message']) {
      assert.doesNotMatch(source, new RegExp(`${className}[^>]*role="status"`), `${className} is not a live region`);
    }
    assert.match(source, /className="kill-feed" role="log" aria-live="off"/, 'the kill feed stays silent but present');
    assert.match(source, /alive:Boolean\(hud&&player\)&&Number\(player\.health\)>0/, 'death/respawn are health edges, not countdown reads');
    assert.match(source, /death:hud&&!hud\.spectate&&killNotice&&killNotice\.age<1\.5&&\(killNotice\.kind==='death'\|\|killNotice\.kind==='self'\)/, 'the elimination line carries the killer/ability when known');
    assert.match(source, /useEffect\(\(\)=>\{[\s\S]*?assistiveChannelStep\(assistiveRef\.current,assistiveView/, 'the channel advances once per snapshot outside render');
    assert.match(source, /<div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">\{assistiveText\}<\/div>/, 'the channel is the one always-mounted live region');
    assert.equal((source.match(/role="status"/g) || []).length, 1, 'the HUD source ships exactly one live channel');
  });
});

test('PlayingHud: death is a non-live group and mounting while dead fabricates no announcement', () => {
  const dead = render(PlayingHud, {ui: ui({player: player({health: 0, dead: 3.4}), ammoEmpty: true})});
  assert.match(dead, /<div class="death-message" role="group" aria-label="Eliminated\. Respawning\.">/, 'the FFA death summary is a named non-live group');
  assert.match(dead, /<p aria-hidden="true">Respawning in 4…<\/p>/, 'the countdown ticks visually without being announced');
  assert.equal(liveCount(dead), 1, 'the death screen does not add a second live region');
  assert.equal(announcer(dead), '', 'a fresh mount while already dead is not a new elimination');
});

test('PlayingHud: alt mode chip, live ALT hint and non-live operator verb meters', () => {
  const alt = render(PlayingHud, {ui: ui({
    player: player({alt: true, weapon: 0, verbState: {verb: 'heat', active: true, heat: .06, decayIn: 0}}),
    bindings: {altFire: 'KeyJ'},
  })});
  assert.match(alt, /class="weapon-tag weapon-tag--alt">SALVO<\/b>/, 'the held alt mode replaces the AUTO/SEMI tag');
  assert.match(alt, /class="weapon-alt-hint"[^>]*>ALT J<\/kbd>/, 'the ALT hint follows the live binding');
  assert.match(alt, /class="verb-meters" role="group" aria-label="Operator verb: HEAT \+6%"/, 'the verb row is one labelled, non-live group');
  assert.match(alt, /class="stat-label"><span class="weapon-name">RAIL<\/span>/, 'the weapon name has its own nowrap element');
  assert.ok(alt.indexOf('weapon-alt-row') > alt.indexOf('stat-bar'), 'the ALT hint sits on the note row under the ammo bar');
  assert.ok(alt.indexOf('verb-meters') < alt.indexOf('ability-card'), 'the verb readout is its own card outside the ability card');
  assert.equal(liveCount(alt), 1, 'the meters add no live region');
  assert.equal(announcer(alt), '', 'a steady meter reading does not churn the announcement channel');

  const plain = render(PlayingHud, {ui: ui()});
  assert.doesNotMatch(plain, /weapon-tag--alt/, 'the alt chip only appears while alt fire is held');
  assert.doesNotMatch(plain, /verb-meters/, 'an actor without verb state renders no meter row');
  assert.match(plain, /class="weapon-alt-hint"[^>]*>ALT Z<\/kbd>/, 'the default hint names the default KeyZ binding');
});

test('PlayingHud: captions and the hit chip stay non-live and add no announcement', () => {
  const hitText = 'HIT BY GROK · RAIL · 42 · 18 HP';
  const html = render(PlayingHud, {ui: ui({
    hud: hud({caption: 'Gunfire'}),
    damageIndicator: {angle: .5, hasSource: true, text: hitText},
  })});
  assert.equal(liveCount(html), 1, 'exactly one live region while a caption and a hit chip are showing');
  assert.equal(politeCount(html), 1);
  assert.match(html, /class="audio-caption" role="group" aria-label="Caption\. Gunfire"/, 'the caption is readable on demand, not live');
  assert.match(html, /class="damage-source" role="group" aria-label="Incoming hit\. HIT BY GROK · RAIL · 42 · 18 HP"/, 'the hit chip names the source, weapon, amount and remaining health');
  assert.equal(announcer(html), '', 'a hit never churns the single announcement channel');
  return read('app/ui/screens/PlayingHud.tsx').then(source => {
    assert.doesNotMatch(source, /audio-caption[^>]*role="status"/, 'the caption never becomes a second live region');
    assert.doesNotMatch(source, /damage-source[^>]*role="status"/, 'the hit chip is non-live by construction');
  });
});

test('PlayingHud: the FFA death card names the killer and weapon without a new live region', () => {
  const html = render(PlayingHud, {ui: ui({
    player: player({health: 0, dead: 2.6}),
    killNotice: {kind: 'death', text: 'GROK ELIMINATED YOU', detail: 'RAIL', age: .3},
  })});
  assert.match(html, /class="death-attribution">GROK ELIMINATED YOU · RAIL</, 'the FFA death card carries the attribution');
  assert.match(html, /aria-label="Eliminated\. Respawning\."/, 'the group label stays stable for assistive tech');
  assert.equal(liveCount(html), 1, 'attribution adds no live region');
  assert.equal(announcer(html), '', 'the attribution is not a new announcement');
});

test('RespawnOverlay: passive team summary stays non-live and FFA never mounts the editor', () => {
  const passive = render(RespawnOverlay, {ui: {respawn: {open: true, allowed: true, respawnIn: 2.4, character: 'chatgpt', harness: 'openclaw'}, killNotice: {text: 'BOT 3 ELIMINATED YOU', detail: 'RAIL'}, cursor: {key: 'ALT'}, switchRespawnLoadout: () => {}}});
  assert.match(passive, /role="region"/, 'the passive summary is a region');
  assert.equal(liveCount(passive), 0, 'the passive summary is not a live region');
  assert.match(passive, /aria-hidden="true">RESPAWN IN 3S</, 'the countdown is visual only');
  assert.match(passive, /BOT 3 ELIMINATED YOU/, 'the death cause is readable on demand');
  assert.match(passive, /ALT TO CHANGE LOADOUT/, 'the explicit team path is still advertised');
  assert.doesNotMatch(passive, /LOCK IN/, 'no editor controls in the passive summary');

  const ffa = render(RespawnOverlay, {ui: {respawn: {open: true, allowed: false, respawnIn: 2, character: 'chatgpt', harness: 'openclaw'}, respawnEditor: true, killNotice: {text: 'ELIMINATED'}, cursor: {key: 'ALT'}, switchRespawnLoadout: () => {}}});
  assert.equal(ffa, '', 'an FFA respawn never mounts the team loadout editor or the overlay');

  const editor = render(RespawnOverlay, {ui: {respawn: {open: true, allowed: true, respawnIn: 1.2, character: 'chatgpt', harness: 'openclaw'}, killNotice: {text: 'ELIMINATED'}, cursor: {key: 'ALT'}, respawnEditor: true, setRespawnEditor: () => {}, respawnQueue: {character: 'claude', harness: 'claudecode', status: 'pending'}, switchRespawnLoadout: () => ({ok: true})}});
  assert.match(editor, /role="dialog" aria-label="Respawn loadout queue"/, 'the explicit team editor is still a dialog');
  assert.match(editor, /aria-hidden="true">RESPAWN IN 2S</, 'the editor countdown is visual only');
  assert.match(editor, /LOCK IN · NEXT SPAWN/, 'the team-only lock-in remains');
  assert.match(editor, /NEXT SPAWN · <b>Claude \/ Claude Code<\/b> · PENDING/, 'queue feedback is event-gated, not per tick');
});

test('spend and training beats sit on event-gated live regions, not countdown ticks', () => {
  const spendView = seconds => ({
    open: true, secondsRemaining: seconds, totalSeconds: 60, budget: 120, spent: 0, windows: 2,
    sinks: [{id: 'FORTIFY', verb: 'FORTIFY', label: 'FORTIFY', cost: 40, target: 'front', description: 'Harden the front line', enabled: true, affordable: true}],
    allowance: {remaining: 60, allowance: 60, perPlayer: 60}, threads: {used: 1, cap: 3, perPlayer: 1},
    executor: {label: 'CHIEF', secondsRemaining: seconds, you: false}, log: [],
  });
  const spendAnnouncement = html => (html.match(/<span class="sr-only">([\s\S]*?)<\/span>/) ?? ['', ''])[1];
  const spend = seconds => render(SpendWindowHud, {spend: spendView(seconds), onSpend: () => ({ok: true}), onSkip: () => {}, reducedMotion: false});
  const firstSpend = spend(42.5), laterSpend = spend(41.2);
  assert.equal(spendAnnouncement(firstSpend), spendAnnouncement(laterSpend), 'the announced spend line does not tick');
  assert.match(spendAnnouncement(firstSpend), /Spend window open/);
  assert.match(firstSpend, /aria-live="off"/, 'the visible countdown is silent');
  assert.match(firstSpend, /role="progressbar"/, 'the countdown is a meter, not a live region');
  assert.match(firstSpend, /aria-valuenow="43"/, 'the countdown meter carries the first reading');
  assert.match(laterSpend, /aria-valuenow="41"/, 'the countdown meter still moves for sighted players');

  const trainingView = overrides => ({
    title: 'LATTICE FIELD TRAINING', mode: 'cocs', index: 0, total: 4, done: false, skipped: false, phase: 'active',
    step: {id: 'move', title: 'MOVE OUT', detail: 'Travel 12 m from your starting point.', success: 'You can move.'},
    next: {id: 'fire', title: 'LIVE FIRE'}, goal: {value: 3, target: 12, label: 'm from start'}, completed: [], progress: 0,
    ...overrides,
  });
  const training = overrides => render(LatticeTrainingHud, {training: trainingView(overrides), bindings: {}, cursorKey: 'ALT', onContinue: () => {}, onEnd: () => {}});
  const trainingBeat = html => (html.match(/<div role="status" aria-live="polite" aria-atomic="true">([\s\S]*?)<\/div>/) ?? ['', ''])[1];
  const firstTraining = training({}), tickedTraining = training({goal: {value: 9, target: 12, label: 'm from start'}});
  assert.equal(trainingBeat(firstTraining), trainingBeat(tickedTraining), 'goal progress ticks outside the live region');
  assert.ok(trainingBeat(firstTraining).includes('MOVE OUT'), 'the lesson beat is announced once when it changes');
  const completeTraining = training({phase: 'complete'});
  assert.notEqual(trainingBeat(completeTraining), trainingBeat(firstTraining), 'the completion beat announces once');
  assert.match(firstTraining, /GOAL PROGRESS/, 'the ticking goal stays visible but non-live');
});

test('first-run sequence: the page waits for arena entry and reopens from Help', async () => {
  const [page, onboarding, setup] = await Promise.all([
    read('app/page.tsx'),
    read('game/onboarding.mjs'),
    read('app/ui/screens/SetupModals.tsx'),
  ]);
  assert.match(page, /\{entered&&mode==='selection'&&<OnboardingModal ui=\{ui\}\/>\}/, 'the coach mounts only after explicit entry');
  assert.match(page, /readOnboardingState\(onboardingStore\(\)\)/, 'the versioned record is read once behind a storage guard');
  assert.match(page, /if\(entered&&mode==='selection'&&onboarding===null&&shouldShowOnboarding\(onboardingStateRef\.current,true\)\)setOnboarding\(0\)/, 'fresh storage waits for the entry flag');
  assert.match(page, /finishOnboarding=\(status:string='skipped'\)/, 'closing without choosing records a skip');
  assert.match(page, /persistOnboardingState\(onboardingStore\(\),status\)/, 'completion and skip persist separately');
  assert.doesNotMatch(page, /localStorage\.setItem\(ONBOARDING_STORAGE_KEY/, 'the legacy single bit is no longer written');
  assert.match(page, /const reopenOnboarding=\(\)=>\{/, 'a reopen action exists');
  assert.match(page, /reopenOnboarding,modalRef/, 'the reopen action reaches the screens');
  assert.match(page, /OPEN THE COACH/, 'Help offers the reopen control');
  assert.match(page, /onClick=\{reopenOnboarding\}/, 'the Help control calls the reopen action');
  assert.match(onboarding, /ONBOARDING_CONTENT_VERSION = 2/, 'the stored record carries a content version');
  assert.match(onboarding, /ONBOARDING_STATE_KEY = 'token-arena-onboarding'/, 'versioned records use their own key');
  assert.match(setup, /onboardingStepView\(ONBOARDING_STEPS\[onboarding\],ui\.bindings\)/, 'the modal copy follows the live bindings');
  assert.match(setup, /finishOnboarding\?\.\('completed'\)/, 'GOT IT records a completion');
  assert.match(setup, /onClick=\{\(\)=>finishOnboarding\?\.\('skipped'\)\}>SKIP</, 'SKIP records a skip');
});
