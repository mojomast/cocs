// SSR + contract tests for the LATTICE STRIKE cursor-mode affordances.
//
// The spend window and command board are rendered with react-dom/server (the
// components are imported through the local esbuild TSX loader, no new
// dependency) so their real markup is asserted: banner, countdown, cost /
// effect / affordability words, mouse targets that are always in the DOM and
// the explicit way back to combat. The page/PlayingHud wiring is asserted from
// source in the same style as tests/ui-contract.test.mjs because the pointer
// lock APIs only exist in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

register('./tsx-loader.mjs', import.meta.url);
// RespawnOverlay imports the shared primitives without an extension and Node's
// ESM resolver has no extension probing. A tiny resolve fallback (registered
// after the tsx loader, so it runs first and only fires when the bare specifier
// fails) keeps the SSR import working without touching app code.
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier,context,nextResolve){try{return await nextResolve(specifier,context);}catch(error){if(!specifier.startsWith('.'))throw error;for(const ext of ['.tsx','.ts']){try{return await nextResolve(specifier+ext,context);}catch{}}throw error;}}`)}`);
const {SpendWindowHud} = await import('../app/ui/screens/SpendWindowHud.tsx');
const {CommandBoardHud,ReqStore} = await import('../app/ui/screens/CommandBoardHud.tsx');
const {RespawnOverlay} = await import('../app/ui/screens/RespawnOverlay.tsx');
const {reqPurchaseOptions} = await import('../game/cocs-economy.mjs');
const {latticeBriefing} = await import('../game/lattice-guide.mjs');
const {trainingControls} = await import('../game/lattice-training.mjs');

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

const sink = (overrides = {}) => ({
  id: 'FORTIFY', verb: 'FORTIFY', label: 'FORTIFY', cost: 40, target: 'front',
  description: 'Harden the front line', enabled: true, affordable: true, reason: null,
  ...overrides,
});

const spend = (overrides = {}) => ({
  open: true, secondsRemaining: 42.5, budget: 120, spent: 0, windows: 3,
  sinks: [
    sink(),
    sink({id: 'REPAIR', verb: 'REPAIR', label: 'REPAIR', cost: 30, description: 'Repair a cut link'}),
    sink({id: 'RESUPPLY', verb: 'RESUPPLY', label: 'RESUPPLY', cost: 55, description: 'Restore the team', enabled: false, affordable: false, reason: 'FLUX LOW'}),
    sink({id: 'REINFORCE', verb: 'REINFORCE', label: 'REINFORCE', cost: 65, description: 'Deploy a thread'}),
  ],
  allowance: {remaining: 60, allowance: 60, perPlayer: 60},
  threads: {used: 1, cap: 3, perPlayer: 1},
  executor: {label: 'CHIEF', secondsRemaining: 18.5, you: false},
  log: [{verb: 'FORTIFY', cost: 40, ok: true, cardId: 'spend-0-10-1'}],
  ...overrides,
});

const boardCard = (overrides = {}) => ({
  id: 'card-1', verb: 'HACK', verbMark: '⌁', targetLabel: 'RELAY', agentLabel: 'AGENT 3',
  status: 'blocked', statusLabel: 'BLOCKED', statusMark: '⚠', blockerLabel: 'NO THREAD',
  cost: 25, costPips: 2, reason: 'NO THREAD', target: 7, ...overrides,
});

const boardView = (overrides = {}) => ({
  widthPercent: 42,
  listboxIds: ['card-1', 'card-2'],
  summary: {chip: '⚠ 1 blocked · ▶ 1', needsYou: 1, running: 1, done: 0},
  cards: [boardCard(), boardCard({id: 'card-2', verb: 'FORTIFY', verbMark: '▣', targetLabel: 'FRONT', status: 'running', statusLabel: 'RUNNING', statusMark: '▶', blockerLabel: null, etaSeconds: 12})],
  sections: [
    {id: 'needs', label: 'NEEDS YOU', count: 1, cards: [boardCard()], expandable: false},
    {id: 'running', label: 'RUNNING', count: 3, cards: [boardCard({id: 'card-2', status: 'running'})], expandable: true},
    {id: 'done', label: 'DONE', count: 0, cards: [], expandable: false},
  ],
  ...overrides,
});

test('spend window SSR: opening banner, countdown and skip are always present', () => {
  const html = render(SpendWindowHud, {spend: spend(), onSpend: () => {}, onSkip: () => {}, reducedMotion: false});
  assert.match(html, /SPEND WINDOW OPEN/, 'prominent opening announcement');
  assert.match(html, /role="progressbar"/, 'the countdown has a shape-based progress cue');
  assert.match(html, /aria-valuenow="43"/, 'progressbar carries the remaining seconds');
  assert.match(html, /SKIP · RETURN TO COMBAT/, 'explicit way to skip back to combat');
  assert.match(html, /SPEND WINDOW/, 'region names the surface');
  assert.match(html, /aria-keyshortcuts="1 2 3 4 Enter S Escape"/, 'keyboard shortcuts are advertised');
  assert.match(html, /CLICK A SINK OR PRESS 1–4/, 'mouse and keyboard are both called out');
});

test('spend window SSR: sinks show cost, effect and affordability in words', () => {
  const html = render(SpendWindowHud, {spend: spend(), onSpend: () => {}, onSkip: () => {}, reducedMotion: false});
  for (const label of ['FORTIFY', 'REPAIR', 'RESUPPLY', 'REINFORCE']) assert.ok(html.includes(label), `${label} is rendered`);
  assert.match(html, /COST <b>40<\/b> FLUX/, 'cost is written, not only colour-coded');
  assert.match(html, /Harden the front line/, 'effect description is rendered');
  assert.match(html, /READY · AFFORDABLE/, 'affordability is stated');
  assert.match(html, /FLUX LOW · NEED MORE FLUX/, 'the disable reason is stated');
  const lockedLabel = html.indexOf('<b>RESUPPLY</b>');
  const lockedTag = html.slice(html.lastIndexOf('<button', lockedLabel), html.indexOf('>', lockedLabel));
  assert.match(lockedTag, /disabled/, 'unaffordable sinks are disabled, not hover-only');
  assert.match(html, /role="log" aria-label="Recent spends"/, 'purchase history feeds back');
});

test('command board SSR: every interactive affordance is in the markup', () => {
  const html = render(CommandBoardHud, {command: {boardView: boardView()}, open: true, collapsed: false, pinned: false, activeId: 'card-1', reducedMotion: false, commandKey: 'Y', commandShortcut: 'Y', onSelect: () => {}, onActivate: () => {}, onClose: () => {}, onTogglePin: () => {}});
  assert.match(html, /role="listbox"/, 'keyboard listbox stays intact');
  assert.match(html, /role="option"/, 'rows are options');
  assert.match(html, /aria-selected="true"/, 'the active row is exposed');
  assert.match(html, /aria-label="Close command board and return to combat"/, 'close is labelled');
  assert.match(html, /Unpin command board|Pin the command board open/, 'pin is labelled');
  assert.match(html, /RETRY/, 'blocked card actions are always rendered (never hover-only)');
  assert.match(html, /CHECK/);
  assert.match(html, /aria-keyshortcuts="Y Escape Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight Home End"/, 'the advertised shortcut is the bound command key');
  assert.match(html, /COMMAND <kbd>Y<\/kbd> \/ <kbd>ESC<\/kbd> \/ <b>× CLOSE<\/b> RETURNS TO COMBAT/, 'the footer names Command, Escape and CLOSE as the exits');
  assert.doesNotMatch(html, /CLICK TO FIGHT|CLICK THE ARENA/, 'the board never promises a cursor-key or arena-click exit');
  assert.match(html, /COLLAPSE|\+\d+ MORE|aria-expanded/, 'expand/collapse affordance stays available');
  assert.match(html, /Mouse input is active\. Press Y or Escape, or use CLOSE, to return to combat\./, 'aria label explains pointer behaviour truthfully');
});

test('command board SSR: exits and pinned copy name the real bound Command key', () => {
  const html = render(CommandBoardHud, {command: {boardView: boardView()}, open: true, collapsed: false, pinned: true, activeId: null, reducedMotion: true, commandKey: 'Y', commandShortcut: 'Y', onSelect: () => {}, onActivate: () => {}, onClose: () => {}, onTogglePin: () => {}});
  assert.match(html, /aria-pressed="true"/, 'pinned state is exposed');
  assert.match(html, /is-reduced/, 'reduced motion is honoured');
  assert.match(html, /Unpin command board \(closes with Y or Escape\)/, 'pinned help names the remapped command key');
  assert.doesNotMatch(html, /closes with B or Escape/, 'the default binding is not claimed after a remap');
});

test('command board SSR: the collapsed chip names the bound Command key', () => {
  const html = render(CommandBoardHud, {command: {boardView: boardView()}, open: false, collapsed: false, pinned: false, activeId: null, reducedMotion: false, commandKey: 'Y', commandShortcut: 'Y', onSelect: () => {}, onActivate: () => {}, onClose: () => {}, onTogglePin: () => {}});
  assert.match(html, /cocs-board-chip/);
  assert.match(html, /aria-label="Command board collapsed/, 'the chip explains how to open or pin');
  assert.match(html, /Press Y to open/, 'the chip names the remapped Command key');
  assert.match(html, /aria-keyshortcuts="Y"/, 'the chip advertises the remapped shortcut');
  assert.doesNotMatch(html, /Press B to open/, 'the stale default is not advertised');
  const fallback = render(CommandBoardHud, {command: {boardView: boardView()}, open: false, collapsed: false, pinned: false, activeId: null, reducedMotion: false, onSelect: () => {}, onActivate: () => {}, onClose: () => {}, onTogglePin: () => {}});
  assert.match(fallback, /Press B to open/, 'an unwired caller still gets the default binding label');
});

test('pointer-lock release reaches every interactive surface through the cursor machine', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /from '\.\.\/game\/cursor-mode\.mjs'/, 'the page uses the pure machine');
  for (const [surface, needle] of [
    ['SPEND', 'syncCursorSurface(CURSOR_SURFACE.SPEND,spendVisible)'],
    ['BOARD', 'syncCursorSurface(CURSOR_SURFACE.BOARD,cocsBoard.open===true&&!boardCollapsed)'],
    ['CHAT', 'syncCursorSurface(CURSOR_SURFACE.CHAT,chatOpen)'],
    ['SCOREBOARD', 'syncCursorSurface(CURSOR_SURFACE.SCOREBOARD,scoresInteractive)'],
    ['SETTINGS', 'syncCursorSurface(CURSOR_SURFACE.SETTINGS,settings)'],
    ['PAUSE', "syncCursorSurface(CURSOR_SURFACE.PAUSE,mode==='paused')"],
    ['RESULTS', "syncCursorSurface(CURSOR_SURFACE.RESULTS,mode==='results')"],
    ['RESPAWN', 'syncCursorSurface(CURSOR_SURFACE.RESPAWN,respawn.open===true&&respawnEditor)'],
  ]) assert.ok(page.includes(needle), `${surface} surface releases the pointer`);
  assert.match(page, /cursorLockLost\(cursorRef\.current/, 'the pointerlockchange path enters cursor mode');
  assert.match(page, /cursorLockGained\(cursorRef\.current/, 're-acquiring lock clears surfaces');
  assert.match(page, /if\(result\.effects\?\.unlock\)document\.exitPointerLock/, 'the machine owns exitPointerLock');
  assert.match(page, /if\(result\.effects\?\.clearInput\)clearInput\(\)/, 'held inputs clear on every cursor transition');
});

test('passive watching stays passive: the Tab glance never registers a surface', async () => {
  const page = await read('app/page.tsx');
  assert.doesNotMatch(page, /syncCursorSurface\(CURSOR_SURFACE\.SCOREBOARD,scores\)/, 'holding Tab no longer releases the pointer');
  assert.doesNotMatch(page, /syncCursorSurface\(CURSOR_SURFACE\.RESPAWN,respawn\.open===true\)/, 'the automatic death summary no longer releases the pointer');
  assert.match(page, /if\(cursorActive\(cursorRef\.current\)\)\{e\.preventDefault\(\);setScores\(true\);setScoresInteractiveOpen\(true\);return;\}/, 'a Tab with the cursor already free pins the interactive standings');
  assert.match(page, /if\(owner===CURSOR_SURFACE\.SCOREBOARD\)\{e\.preventDefault\(\);setScoresInteractiveOpen\(false\);setScores\(false\);return;\}/, 'Tab closes the pinned standings');
  assert.match(page, /if\(e\.code==='Tab'&&!scoresInteractiveRef\.current\)setScores\(false\)/, 'releasing Tab only hides the passive glance');
  assert.match(page, /if\(cursorKeyboardOwner\(current\)===CURSOR_SURFACE\.SCOREBOARD\)\{setScoresInteractiveOpen\(false\);setScores\(false\);return;\}/, 'a click dismisses the pinned standings');
  assert.match(page, /if\(scoresInteractiveRef\.current\)\{setScoresInteractiveOpen\(false\);setScores\(false\);return;\}/, 'the cursor key also closes it');
  const passive = render(RespawnOverlay, {ui: {respawn: {open: true, respawnIn: 2.4, character: 'chatgpt', harness: 'openclaw'}, killNotice: {text: 'ELIMINATED BY BOT'}, cursor: {key: 'ALT'}, switchRespawnLoadout: () => {}}});
  assert.match(passive, /RESPAWN IN 3S/, 'the countdown is visible without a click');
  assert.match(passive, /pointer-events:none/, 'the passive summary cannot intercept input');
  assert.match(passive, /ALT TO CHANGE LOADOUT/, 'the explicit path is advertised');
  assert.doesNotMatch(passive, /LOCK IN/, 'the passive summary has no interactive controls');
});

test('the explicit respawn editor queues a next-spawn switch with truthful feedback', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /if\(respawnOpenRef\.current\)\{setRespawnEditorOpen\(true\);return;\}/, 'the cursor key opens the editor while dead');
  assert.match(page, /if\(respawnEditorRef\.current\)\{setRespawnEditorOpen\(false\);return;\}/, 'the cursor key closes it again');
  assert.match(page, /setRespawnQueue\(\{character:loadout\.character,harness:loadout\.harness,status:/, 'the accepted request records next-spawn feedback');
  assert.match(page, /if\(!respawn\.open\)\{if\(respawnEditorRef\.current\)setRespawnEditorOpen\(false\);if\(respawnQueue\)setRespawnQueue\(null\);\}/, 'the request record clears when the respawn boundary passes');
  const html = render(RespawnOverlay, {ui: {respawn: {open: true, respawnIn: 1.2, character: 'chatgpt', harness: 'openclaw'}, killNotice: {text: 'ELIMINATED'}, cursor: {key: 'ALT'}, respawnEditor: true, setRespawnEditor: () => {}, respawnQueue: {character: 'claude', harness: 'claudecode', status: 'pending'}, switchRespawnLoadout: () => ({ok: true})}});
  assert.match(html, /OPERATOR/, 'the editor offers the operator pick');
  assert.match(html, /LOCK IN · NEXT SPAWN/, 'the action states its next-spawn semantics');
  assert.match(html, /NEXT SPAWN · <b>Claude \/ Claude Code<\/b> · PENDING/, 'the queued pair and its pending state are explicit');
  assert.match(html, /CLOSE · KEEP FIGHTING/, 'closing restores the quick respawn');
});

test('combat key routing is centralized and the board peek stays exempt', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /import \{[^}]*cursorCombatKeysBlocked[^}]*\} from '\.\.\/game\/cursor-mode\.mjs'/, 'the page consults the machine priority helper');
  const guard = page.indexOf('if(cursorCombatKeysBlocked(cursorRef.current))return;');
  const held = page.indexOf('keys.add(e.code)');
  assert.ok(guard > 0 && guard < held, 'the guard rejects held combat keys before they accumulate');
  assert.match(page, /if\(\(e\.code==='KeyT'\|\|e\.code==='Enter'\)&&r\.net\?\.started&&!cursorCombatKeysBlocked\(cursorRef\.current\)\)/, 'chat cannot open from an Enter press inside an owned surface');
  const hud = await read('app/ui/screens/SpendWindowHud.tsx');
  assert.match(hud, /event\.repeat && \/\^\(Enter\|Space\|Digit\[1-4\]\|KeyS\|Escape\)\$\//, 'the v8.3 repeat guard still owns spend shortcuts');
});

test('the arena never fires while a surface owns the cursor', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /if\(cursorActive\(cursorRef\.current\)\)\{cursorResumeCombat\(\);return;\}/, 'canvas clicks never fire in cursor mode');
  assert.match(page, /const wheel=\(e:WheelEvent\)=>\{const r=runtime\.current;if\(cursorActive\(cursorRef\.current\)\)return;/, 'wheel weapon cycling is blocked in cursor mode');
  assert.match(page, /!cursorRef\.current\.surfaces\.includes\(CURSOR_SURFACE\.SPEND\)/, 'digit weapon switches are blocked while the spend window is open');
  const hud = await read('app/ui/screens/PlayingHud.tsx');
  assert.match(hud, /cursor-resume__button/, 'the CLICK TO FIGHT affordance is rendered');
  assert.match(hud, /CLICK TO FIGHT/);
  assert.match(hud, /cursor-chip/, 'the HUD shows the cursor chip');
  assert.match(hud, /FREE CURSOR/, 'the bottom hint names the free-cursor control');
});

test('spend purchases take the same economy call in local co-op and on the wire', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /r\.net\.economy\(verbId\.toLowerCase\(\),\{cardId,target:target\?\?null\}\);return \{ok:true,reason:null,cardId\};/, 'network spends go through net.economy with a deterministic card id');
  assert.match(page, /\(r\.cocsSpends\?\?=\[\]\)\.push\(\{tick,peerId,cardId,team,verb:verbId,target:target\?\?null\}\);return \{ok:true,reason:null,cardId\};/, 'local co-op spends queue on the deterministic match path');
  assert.match(page, /const cardId=`spend-\$\{team\}-\$\{tick\}-\$\{seq\}`/, 'both paths share the same (tick, peerId, cardId) identity');
});

test('local identity is the actor id, and refusals are pre-flighted and visible', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /import \{coopOrderGate,coopSpendGate\} from '\.\.\/game\/cocs-coop\.mjs'/, 'the authoritative gates are imported read-only');
  assert.doesNotMatch(page, /peerId:'human'/, 'no local payload uses the literal human');
  assert.doesNotMatch(page, /peerId:\s*r\?\.net\?\.peerId\s*\?\?\s*'human'/, 'orders resolve a real id');
  assert.match(page, /peerId=latticePeerId\(r\?\.net,r\?\.match\)/, 'the order strip resolves the local actor id');
  assert.match(page, /coopSpendGate\(r\.match,r\.match\.objectiveState,\{verb:verbId,peerId\}\)/, 'spends pre-flight the authoritative slice/executor gate');
  assert.ok((page.match(/latticePeerId\(/g) ?? []).length >= 3, 'orders, spends and board activations all resolve the local actor id');
  assert.match(page, /coopOrderGate\(r\.match,r\.match\.objectiveState,\{verb:result\.order\.verb,peerId\}\)/, 'strip orders are pre-flighted');
  assert.match(page, /REJECTED · \$\{String\(gate\.reason\)\.toUpperCase\(\)\}/, 'a rejection lands in the strip notice');
});

test('the local board is derived from real snapshot data and stays actionable', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /import \{LOCAL_CARD_ACTION,LOCAL_CARD_SOURCE,latticePeerId,localBoardCards,mergeLocalBoard,withSinkTargets\} from '\.\.\/game\/lattice-board\.mjs'/, 'the local board module is wired');
  assert.match(page, /localBoardCards\(latticeBoard,hud\?\.cocs,player,\{spend:cocsSpendView,economy:cocsView\.economy,model:latticeModel,map:latticeMap\}\)/, 'cards come from nodes/sinks/roles/orderStats and the shared legal-target model');
  assert.match(page, /mergeLocalBoard\(cocsView\.boardView,localCards\)/, 'derived cards merge into the board view');
  assert.match(page, /boardView:mergedBoard\?\?cocsView\.boardView/, 'the merged board is what renders');
  assert.match(page, /withSinkTargets\(cocsView\?\.spend\?\?null,hud\?\.cocs,player\)/, 'sink targets are resolved against the snapshot');
  assert.match(page, /card\.action\?\?\(card\.status==='blocked'\?'retry':'check'\)/, 'Enter performs the card action instead of a hardcoded check');
  const hud = await read('app/ui/screens/PlayingHud.tsx');
  assert.match(hud, /cocs-spend-chip/, 'a skipped spend window leaves a visible countdown chip');
  assert.match(hud, /cocs-notice/, 'accepted/rejected actions surface outside the strip');
});

test('SSR: node sinks expose a real target and a picker when there are several', () => {
  const targeted = spend({sinks: [sink({id: 'FORTIFY', verb: 'FORTIFY', label: 'FORTIFY', cost: 60, target: 'front-0', targetLabel: 'FRONT-0', targetRequired: true, targetOptions: [{id: 'front-0', label: 'FRONT-0'}, {id: 'econ-n', label: 'ECON-N'}]})]});
  const html = render(SpendWindowHud, {spend: targeted, onSpend: () => ({ok: true}), onSkip: () => {}, reducedMotion: false});
  assert.match(html, /TARGET/, 'the target is visible without hovering');
  assert.match(html, /<select[^>]*aria-label="FORTIFY target node"/, 'multi-target sinks get a labelled picker');
  assert.match(html, /<option value="econ-n">ECON-N<\/option>/, 'every legal node is offered');
});

test('SSR: the board renders ACT for locally actionable cards', () => {
  const card = {...boardCard({id: 'local-node-front-0', verb: 'ATTACK', status: 'queued', statusLabel: 'QUEUED', statusMark: '◷', blockerLabel: null, blocker: null, source: 'local-order', action: 'issue', actionLabel: 'ISSUE ATTACK', targetLabel: 'FRONT-0'})};
  const view = boardView({cards: [card], listboxIds: [card.id], sections: [{id: 'running', label: 'RUNNING', count: 1, cards: [card], expandable: false}]});
  const html = render(CommandBoardHud, {command: {boardView: view}, open: true, collapsed: false, pinned: false, activeId: card.id, reducedMotion: false, cursorKey: 'ALT', onSelect: () => {}, onActivate: () => {}, onClose: () => {}, onTogglePin: () => {}});
  assert.match(html, /ISSUE ATTACK/, 'the actionable card exposes its verb');
  assert.match(html, /aria-label="ISSUE ATTACK ATTACK FRONT-0"/, 'the ACT button is labelled with verb and target');
});

test('the command board opens, peeks and toggles without loosing the pointer mid-press', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /BOARD_HOLD_MS=250/, 'tap-vs-hold threshold is explicit');
  assert.match(page, /if\(hold\.held&&performance\.now\(\)-hold\.at>=BOARD_HOLD_MS\)cocsBoardControlRef\.current\?\.close\(\)/, 'a hold closes on release');
  assert.match(page, /if\(wasOpen\)control\?\.close\(\);else control\?\.open\(true\)/, 'a second press toggles the board');
  assert.match(page, /spendVisible,skipSpend/, 'the page passes SKIP into the board/spend view');
});

// ---------------------------------------------------------------------------
// WP1.6 — binding-complete controls and truthful cursor copy. Command, Voice,
// Interact and the fixed spectator keys must agree across visible prompts,
// accessible names, aria-keyshortcuts, Help and Training.
// ---------------------------------------------------------------------------
const REMAPPED = {command: 'KeyY', voice: 'KeyI', interact: 'KeyL', cursor: 'KeyO'};

test('WP1.6 Help and Training copy agree with the remapped keys', () => {
  const brief = latticeBriefing('cocs', REMAPPED);
  assert.match(brief.steps[2].detail, /Hold Y for the command board/, 'Help names the remapped Command key');
  assert.match(brief.steps[3].detail, /press L when the prompt says RIDE/, 'Help names the remapped Interact key');
  assert.match(trainingControls('device', REMAPPED), /^L interact when the prompt says RIDE$/, 'Training names the remapped Interact key');
  assert.doesNotMatch(brief.steps[2].detail, /Hold B for the command board/, 'Help never falls back to the default Command key after a remap');
});

test('WP1.6 the page and HUD build every key prompt from the live bindings', async () => {
  const [page, hudSource, play, board] = await Promise.all([
    read('app/page.tsx'),
    read('game/hud.mjs'),
    read('app/ui/screens/PlayingHud.tsx'),
    read('app/ui/screens/CommandBoardHud.tsx'),
  ]);
  assert.match(page, /const voiceKey=keyLabel\(bindings\.voice\?\?DEFAULT_BINDINGS\.voice\)\.toUpperCase\(\)/, 'the page resolves the voice key from the binding');
  assert.match(page, /PTT \(hold \{voiceKey\}\)/, 'the voice mode option names the bound key');
  assert.match(page, /Hold to talk, or hold \$\{voiceKey\}/, 'the hold-to-talk accessible name names the bound key');
  assert.match(page, />Hold to talk \/ \{voiceKey\}</, 'the hold-to-talk button text names the bound key');
  assert.match(page, /vehicleHud\(player,hud\?\.vehicles,hud\?\.flags,hud\?\.spectate,bindings\)/, 'the vehicle prompt receives the live bindings');
  assert.match(page, /commandKey:latticeKeys\(bindings\)\.command/, 'the page passes the bound Command key into the board');
  assert.match(page, /commandShortcut:bindingShortcut\(bindings\.command\?\?DEFAULT_BINDINGS\.command\)/, 'the board shortcut is derived from the same binding');
  assert.doesNotMatch(page, /hold V|talk \/ V/, 'no literal V voice prompt remains');
  assert.match(hudSource, /boundLabel\(bindings, 'interact'\)/, 'the vehicle prompt resolves the interact binding');
  assert.match(hudSource, /SPECTATOR_RESERVED_KEYS/, 'fixed spectator keys live in one labelled table');
  assert.match(play, /voiceHint\(voiceState\.enabled,voiceState\.mode,ui\.bindings\)/, 'the HUD voice chip uses the live bindings');
  assert.match(play, /spectatorControls\(\{local:true/, 'spectator copy is built by the pure helper');
  assert.doesNotMatch(play, /\?\?'[BQ]'/, 'no literal default-key fallback remains in the HUD');
  assert.doesNotMatch(play, /WASD moves/, 'the pointer hint no longer hardcodes WASD');
  assert.match(board, /Press \$\{commandKey\} to open/, 'the collapsed chip names the bound Command key');
  assert.doesNotMatch(board, /CLICK TO FIGHT|cursorKey/, 'the board no longer advertises cursor-key or arena-click exits');
  assert.match(page, /if\(cursorActive\(current\)&&!cursorBlockingSurfaces\(current\)\.length\)applyCursor\(cursorClear\(current\)\);/, 'an arena click with the board open neither relocks nor clears the surface');
  assert.match(page, /if\(e\.code==='Escape'\)\{e\.preventDefault\(\);cocsBoardControlRef\.current\.close\(\);return;\}/, 'Escape still closes the board without falling through to Pause');
  assert.match(page, /if\(result\.effects\?\.unlock\)document\.exitPointerLock/, 'the cursor machine still owns pointer-lock exit after the board closes');
});

// ---------------------------------------------------------------------------
// WP1.3 — personal REQ purchase surface. Rendered with the real
// `reqPurchaseOptions` model so cost, effect copy, affordability, the single
// disabled reason, the authoritative balance and the pending wording all come
// from the shipped data layer, not a test-only fixture.
// ---------------------------------------------------------------------------
test('REQ store SSR: every row states name, cost, effect, affordability and one reason', async () => {
  const affordable = reqPurchaseOptions({team: 0, mode: 'cocs', actor: {id: 0, req: 30, reqBuff: null}, state: {command: {seat: [null, null]}, nodes: []}});
  const html = render(ReqStore, {req: affordable, pending: [], onBuy: () => {}, reducedMotion: false, defaultOpen: true});
  assert.match(html, /REQ STORE · <b>30<\/b> REQ/, 'the toggle names the authoritative balance');
  assert.match(html, /AUTHORITATIVE BALANCE <b>30<\/b> REQ/, 'the open store repeats the balance');
  assert.match(html, /Field Repair/, 'the real catalogue names are rendered');
  assert.match(html, /COST <b>40<\/b> REQ/, 'cost is written, never colour-only');
  assert.match(html, /Heal 50 health \(capped at max health\)/, 'effect copy is rendered');
  assert.match(html, /NEED MORE REQ/, 'the single disable reason is in words');
  assert.match(html, /WRONG MODE/, 'a mode-unsupported row also names its reason');
  assert.match(html, /READY · AFFORDABLE/, 'an affordable row states it');
  assert.match(html, /aria-expanded="true"/, 'the toggle exposes its state to assistive tech');
  assert.match(html, /aria-label="[^"]*Cost 40 REQ[^"]*Balance 30 REQ[^"]*"/, 'each row accessible name carries cost and balance');
  assert.match(html, /class="cocs-sink__buy"/, 'rows are real buttons');
  assert.doesNotMatch(html, /tabindex="-1"/i, 'no purchase row is removed from the tab order');
  const buffed = reqPurchaseOptions({team: 0, mode: 'cocs', actor: {id: 0, req: 100, reqBuff: 'overshield'}, state: {command: {seat: [null, null]}, nodes: []}});
  const buffedHtml = render(ReqStore, {req: buffed, pending: [], onBuy: () => {}, reducedMotion: false, defaultOpen: true});
  assert.match(buffedHtml, /ANOTHER BUFF IS ACTIVE/, 'the active-buff gate is named');
  const css = await read('app/globals.css');
  assert.match(css, /\.cocs-sink\{min-height:44px\}/, 'the shared sink row is a 44px target');
});

test('REQ store SSR: an outstanding buy reads QUEUED/REQUESTED and never CONFIRMED', async () => {
  const req = reqPurchaseOptions({team: 0, mode: 'cocs', actor: {id: 0, req: 200, reqBuff: null}, state: {command: {seat: [null, null]}, nodes: []}});
  const queued = render(ReqStore, {req, pending: [{itemId: 'ammo-crate', status: 'queued'}], onBuy: () => {}, reducedMotion: false, defaultOpen: true});
  assert.match(queued, /QUEUED · AWAITING AUTHORITY/, 'a local dispatch shows the queued state');
  assert.doesNotMatch(queued, /CONFIRMED/, 'a queued row never claims confirmation');
  assert.match(queued, /disabled=""/, 'the outstanding row cannot be double-bought');
  const requested = render(ReqStore, {req, pending: [{itemId: 'ammo-crate', status: 'requested'}], onBuy: () => {}, reducedMotion: false, defaultOpen: true});
  assert.match(requested, /REQUESTED · AWAITING AUTHORITY/, 'a network dispatch shows the requested state');
  assert.doesNotMatch(requested, /CONFIRMED/);
});

test('command board SSR: the REQ store is only rendered when the page provides the catalogue', () => {
  const req = reqPurchaseOptions({team: 0, mode: 'cocs', actor: {id: 0, req: 90, reqBuff: null}, state: {command: {seat: [null, null]}, nodes: []}});
  const base = {open: true, collapsed: false, pinned: false, activeId: 'card-1', reducedMotion: false, commandKey: 'B', commandShortcut: 'B', onSelect: () => {}, onActivate: () => {}, onClose: () => {}, onTogglePin: () => {}};
  const without = render(CommandBoardHud, {...base, command: {boardView: boardView()}});
  assert.doesNotMatch(without, /REQ STORE/, 'without a catalogue the board is unchanged');
  const withReq = render(CommandBoardHud, {...base, command: {boardView: boardView(), req, reqPending: [], onBuyReq: () => {}}});
  assert.match(withReq, /REQ STORE · <b>90<\/b> REQ/, 'the board hosts the store when the page provides it');
});
