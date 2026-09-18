// LATTICE STRIKE O1c UI-side view derivation. Covers the between-wave spend
// window, the 3-section command board, the HACK/DEPLOY/VAULT terminal + role
// surface, the keyboard listbox, reduced-motion snapping, the UI text scale and
// the O1c keybindings. Pure: no React, no Match, no clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeDisplay} from './config.mjs';
import {DEFAULT_BINDINGS,KEYBIND_ACTIONS,KEYBIND_OPTIONS,actionForCode} from './keybinds.mjs';
import {
  COCS_BOARD_VISIBLE_CARDS, COCS_SCAN_COST,
  cocsBoardAnnouncement, cocsBoardListbox, cocsBoardMotion, cocsBoardMove, cocsBoardSetActive, cocsBoardView,
  cocsCommandView, cocsSpendView, cocsTerminalView,
} from './cocs-orders.mjs';

const sampleBoard = () => ({
  nodes: [
    {id: 'front-0', label: 'FRONT', mark: '▲', ownerLabel: 'YOURS', mine: true, enemy: false, contested: false, live: true},
    {id: 'relay-0', label: 'RELAY', mark: '⬢', ownerLabel: 'NEUTRAL', mine: false, enemy: false, contested: true, live: true, progressPercent: 60},
  ],
  front: {id: 'relay-0', label: 'RELAY', mark: '⬢', ownerLabel: 'NEUTRAL', mine: false, enemy: false, contested: true, live: true, progressPercent: 60},
  hint: 'CONTEST RELAY · 60%',
  liveCount: 2,
});

const spendSnapshot = () => ({
  tick: 600,
  flux: {0: 210, 1: 40},
  director: {
    intermission: {
      open: true, secondsRemaining: 12.5, budget: 210, spent: 95, windows: 2,
      byType: {FORTIFY: 1, REPAIR: 0, RESUPPLY: 1, REINFORCE: 0},
      sinks: [
        {verb: 'RESUPPLY', label: 'RESUPPLY', cost: 35, target: 'team', description: 'Refill team health and armour.', available: true, affordable: true, enabled: true},
        {verb: 'REPAIR', label: 'REPAIR', cost: 45, target: 'hq', description: 'Restore HQ integrity.', available: true, affordable: true, enabled: true},
        {verb: 'FORTIFY', label: 'FORTIFY', cost: 60, target: 'node', description: 'Harden a held node.', available: false, affordable: true, enabled: false},
        {verb: 'REINFORCE', label: 'REINFORCE', cost: 50, target: 'team', description: 'Call in a squad bot.', available: true, affordable: false, enabled: false},
      ],
      log: [{verb: 'RESUPPLY', cost: 35, ok: true, cardId: 'a'}, {verb: 'FORTIFY', cost: 60, ok: false, reason: 'window-closed', cardId: 'b'}],
    },
  },
  command: {humans: 4, slicePerPlayer: 4, executor: 2, leaseUntil: 900, threads: {used: 1, cap: 5}, slices: [{id: 0, allowance: 52}, {id: 1, allowance: 52}]},
});

test('the spend window renders the four FLUX sinks with cost, effect and one disable reason', () => {
  const view = cocsSpendView(spendSnapshot(), {id: 0, team: 0});
  assert.ok(view);
  assert.equal(view.open, true);
  assert.equal(view.secondsRemaining, 12.5);
  assert.equal(view.budget, 210);
  assert.equal(view.spent, 95);
  assert.deepEqual(view.sinks.map(sink => sink.verb), ['RESUPPLY', 'REPAIR', 'FORTIFY', 'REINFORCE']);
  const byVerb = Object.fromEntries(view.sinks.map(sink => [sink.verb, sink]));
  assert.equal(byVerb.RESUPPLY.cost, 35);
  assert.equal(byVerb.RESUPPLY.enabled, true, 'an available, affordable sink is enabled');
  assert.equal(byVerb.RESUPPLY.reason, null);
  assert.ok(byVerb.REPAIR.effect.includes('HQ'), 'the effect copy is surfaced');
  assert.equal(byVerb.FORTIFY.reason, 'NOT AVAILABLE');
  assert.equal(byVerb.FORTIFY.enabled, false);
  assert.equal(byVerb.REINFORCE.reason, 'FLUX LOW');
  assert.equal(byVerb.REINFORCE.enabled, false);
  assert.equal(view.canSpend, true);
});

test('the spend window surfaces the slice allowance, executor lease and THREADS', () => {
  const view = cocsSpendView(spendSnapshot(), {id: 0, team: 0});
  assert.equal(view.allowance.remaining, 52);
  assert.equal(view.allowance.allowance, 52);
  assert.equal(view.allowance.humans, 4);
  assert.equal(view.threads.used, 1);
  assert.equal(view.threads.cap, 5);
  assert.equal(view.threads.perPlayer, 2, 'ceil(5 threads / 4 humans)');
  assert.equal(view.executor.id, 2);
  assert.equal(view.executor.you, false);
  assert.equal(view.executor.chief, false);
  assert.equal(view.executor.secondsRemaining, 5, '(900 - 600) ticks at 60 Hz');
  // The lease holder reads as YOU.
  const holder = cocsSpendView(spendSnapshot(), {id: 2, team: 0});
  assert.equal(holder.executor.you, true);
  // No human executor -> the duty Chief proxies.
  const chief = spendSnapshot();
  chief.command.executor = 'chief';
  const chiefView = cocsSpendView(chief, {id: 1, team: 0});
  assert.equal(chiefView.executor.chief, true);
  assert.equal(chiefView.executor.label, 'CHIEF');
  // A per-player slice entry wins over the team fallback.
  const perPlayer = spendSnapshot();
  perPlayer.command.slices = [{id: 0, peerId: '9', allowance: 11, remaining: 3, cap: 11}];
  const scoped = cocsSpendView(perPlayer, {id: 9, team: 0});
  assert.equal(scoped.allowance.remaining, 3);
  assert.equal(scoped.allowance.playerId, '9');
});

test('an explicit slice enforcement flag pre-blocks an overslice spend', () => {
  const snapshot = spendSnapshot();
  snapshot.command.enforceSlices = true;
  snapshot.command.slices = [{id: 0, allowance: 30, remaining: 30, cap: 30}];
  snapshot.director.intermission.sinks = [{verb: 'FORTIFY', label: 'FORTIFY', cost: 60, target: 'node', description: 'Harden a held node.', available: true, affordable: true, enabled: true}];
  const view = cocsSpendView(snapshot, {id: 0, team: 0});
  assert.equal(view.allowance.remaining, 30);
  assert.equal(view.sinks[0].sliceBlocked, true);
  assert.equal(view.sinks[0].reason, 'SLICE LOW');
  assert.equal(view.sinks[0].enabled, false);
  // Without the enforcement flag the sim stays the authority and the spend is ready.
  const soft = spendSnapshot();
  soft.command.slices = [{id: 0, allowance: 30, remaining: 30, cap: 30}];
  soft.director.intermission.sinks = [{verb: 'FORTIFY', label: 'FORTIFY', cost: 60, target: 'node', available: true, affordable: true, enabled: true}];
  const softView = cocsSpendView(soft, {id: 0, team: 0});
  assert.equal(softView.sinks[0].sliceBlocked, false);
  assert.equal(softView.sinks[0].enabled, true);
});

test('the spend window closes with the window and is null outside co-op', () => {
  const closed = spendSnapshot();
  closed.director.intermission.open = false;
  const view = cocsSpendView(closed, {id: 0, team: 0});
  assert.equal(view.open, false);
  assert.equal(view.canSpend, false);
  assert.ok(view.sinks.every(sink => sink.reason === 'WINDOW CLOSED' && sink.enabled === false));
  assert.equal(cocsSpendView({flux: {0: 10}}, {id: 0, team: 0}), null, 'no director subtree means no window');
  assert.equal(cocsSpendView(null, {id: 0, team: 0}), null);
});

test('the command board groups cards into NEEDS YOU / RUNNING / DONE with one chip and one blocker', () => {
  const cards = [
    {id: 'n1', verb: 'HACK', target: 'relay-0', targetLabel: 'RELAY', agent: 'adept', status: 'blocked', blocker: 'contested', cost: 7, impact: '−3 FLUX/s'},
    {id: 'n2', verb: 'BUILD', target: 'front-0', targetLabel: 'FRONT', agent: 'builder', status: 'blocked', blocker: 'no-thread', cost: 0},
    {id: 'r1', verb: 'HOLD', target: 'front-0', targetLabel: 'FRONT', agent: 'scrapper', status: 'running', cost: 12, repeat: 2},
    {id: 'r2', verb: 'SCAN', target: 'relay-0', targetLabel: 'RELAY', agent: 'scout', status: 'queued', cost: 7},
    {id: 'd1', verb: 'HOLD', target: 'front-0', targetLabel: 'FRONT', agent: 'chief', status: 'done'},
  ];
  const view = cocsBoardView(sampleBoard(), {cards}, {team: 0}, {economy: {scout: {alive: false}}});
  assert.ok(view);
  assert.equal(view.widthPercent, 42, 'the peek panel never takes more than 42% of the viewport');
  assert.deepEqual(view.sections.map(section => section.label), ['NEEDS YOU', 'RUNNING', 'DONE']);
  assert.equal(view.sections[0].count, 2);
  assert.equal(view.sections[1].count, 2);
  assert.equal(view.sections[2].count, 1);
  assert.equal(view.summary.chip, '⚠ 2 blocked · ▶ 2');
  const hack = view.cards.find(card => card.id === 'n1');
  assert.equal(hack.statusLabel, 'BLOCKED');
  assert.equal(hack.statusMark, '⚠');
  assert.equal(hack.blockerLabel, 'CONTESTED');
  assert.equal(hack.verbMark, '⌨');
  assert.equal(hack.agentLabel, 'ADEPT');
  assert.ok(hack.costPips >= 1 && hack.costPips <= 5);
  const hold = view.cards.find(card => card.id === 'r1');
  assert.equal(hold.statusLabel, 'RUNNING');
  assert.equal(hold.repeat, 2);
  assert.equal(hold.blockerLabel, null, 'a running card carries no blocker');
});

test('the board caps the visible cards at 8 and reports the hidden remainder', () => {
  const cards = Array.from({length: 11}, (_, index) => ({id: `b${index}`, verb: 'HOLD', target: `n${index}`, status: 'blocked', blocker: 'contested'}));
  const view = cocsBoardView(sampleBoard(), {cards}, {team: 0}, {economy: {scout: {alive: false}}});
  assert.ok(view.visibleCount <= COCS_BOARD_VISIBLE_CARDS);
  assert.equal(view.visibleCount, 8);
  assert.equal(view.sections[0].count, 11);
  assert.equal(view.sections[0].cards.length, 8);
  assert.equal(view.sections[0].hidden, 3);
  assert.equal(view.sections[0].expandable, true);
  assert.equal(view.listboxIds.length, 8);
});

test('the board synthesises the exception list from the live signals', () => {
  const snapshot = {
    flux: {0: 0, 1: 20}, fluxCap: 240, tick: 120,
    coop: true,
    command: {humans: 2, executor: 'chief', threads: {used: 3, cap: 3}, slices: [{id: 0, allowance: 0}, {id: 1, allowance: 0}]},
    orderStats: {issued: 4, completed: 2, byVerb: {HOLD: 1, ATTACK: 2, SCAN: 1}},
    orderLog: [
      {tick: 100, peerId: 'human', cardId: 'o1', verb: 'ATTACK', target: 'relay-0', ok: true},
      {tick: 101, peerId: 'human', cardId: 'o2', verb: 'ATTACK', target: 'relay-0', ok: false, reason: 'slice'},
    ],
    scout: {0: {id: 9, team: 0, node: 'relay-0', idle: true}},
    scouts: [{id: 9, team: 0, node: 'relay-0', idle: true}],
    scoutStats: {0: {spawned: 1, killed: 0, expired: 0, scans: 0}},
    terminals: [{id: 't1', kind: 'DEPLOY', label: 'BEACON', state: 'active'}],
  };
  const economy = {flux: 0, scout: {alive: true, idle: true, node: 'relay-0'}, spots: []};
  const view = cocsBoardView(sampleBoard(), snapshot, {team: 0}, {economy});
  assert.ok(view);
  const blockers = view.cards.filter(card => card.status === 'blocked').map(card => card.blocker);
  assert.ok(blockers.includes('out-of-flux'), 'zero FLUX is a NEEDS YOU blocker');
  assert.ok(blockers.includes('no-thread'), 'a full THREADS budget is a NEEDS YOU blocker');
  assert.ok(blockers.includes('contested'), 'a contested front is a NEEDS YOU blocker');
  assert.ok(view.cards.some(card => card.verb === 'SCAN' && card.status === 'blocked' && card.blocker === 'out-of-flux'), 'an idle scout reads as blocked');
  assert.ok(view.cards.some(card => card.verb === 'DEPLOY' && card.status === 'running'), 'the active terminal reads as running');
  assert.equal(view.cards.filter(card => card.status === 'done').length, 3, 'two completed orders plus the ok log entry');
  assert.ok(view.summary.blocked >= 3);
});

test('the board listbox moves, wraps and exposes an aria-live Needs you sentence', () => {
  const view = cocsBoardView(sampleBoard(), {
    cards: [
      {id: 'a', verb: 'HOLD', target: 'front-0', status: 'blocked', blocker: 'contested'},
      {id: 'b', verb: 'HOLD', target: 'front-0', status: 'running'},
      {id: 'c', verb: 'HOLD', target: 'front-0', status: 'done'},
    ],
  }, {team: 0}, {economy: {scout: {alive: false}}});
  const listbox = {...cocsBoardListbox(view), ids: view.listboxIds};
  assert.equal(listbox.count, 3);
  assert.equal(listbox.activeId, 'a');
  const down = {...cocsBoardMove(listbox, 1, listbox.count), ids: view.listboxIds};
  assert.equal(down.index, 1);
  assert.equal(down.activeId, 'b');
  const wrapped = {...cocsBoardMove(down, 2, listbox.count), ids: view.listboxIds};
  assert.equal(wrapped.index, 0, 'navigation wraps');
  const clamped = cocsBoardSetActive(listbox, 99, listbox.count);
  assert.equal(clamped.index, 2);
  assert.equal(cocsBoardAnnouncement(view), 'Needs you: 1. HOLD front-0 blocked: CONTESTED.');
  assert.equal(cocsBoardAnnouncement(null), '');
});

test('the board motion contract snaps under reduced motion', () => {
  const reduced = cocsBoardMotion(true);
  assert.equal(reduced.snap, true);
  assert.equal(reduced.transitionSeconds, 0);
  const normal = cocsBoardMotion(false);
  assert.equal(normal.snap, false);
  assert.equal(normal.transitionSeconds, 0.18);
});

test('terminals read as HACK / DEPLOY / VAULT with shape + word prompts and states', () => {
  const snapshot = {
    terminals: [
      {id: 't-hack', kind: 'HACK', label: 'RELAY TERMINAL', state: 'available', nodeId: 'relay-0'},
      {id: 't-deploy', kind: 'DEPLOY', label: 'FWD BEACON', state: 'active', progress: 0.5, owner: 0},
      {id: 't-vault', kind: 'VAULT', label: 'VAULT 2', state: 'locked', owner: 1, remainingSeconds: 30},
    ],
    roles: [{id: 'builder', label: 'builder', mark: '⚒', state: 'active', stateLabel: 'ACTIVE', count: 1, cap: 2}],
  };
  const view = cocsTerminalView(snapshot, {id: 0, team: 0}, sampleBoard());
  assert.ok(view);
  assert.equal(view.hasTerminals, true);
  assert.equal(view.count, 3);
  assert.equal(view.available, 1);
  assert.equal(view.active, 1);
  assert.equal(view.blocked, 1);
  const hack = view.terminals.find(terminal => terminal.id === 't-hack');
  assert.equal(hack.kind, 'HACK');
  assert.equal(hack.kindMark, '⌨');
  assert.equal(hack.prompt, 'HACK THE RELAY');
  assert.equal(hack.stateLabel, 'AVAILABLE');
  assert.equal(hack.stateMark, '▷');
  const deploy = view.terminals.find(terminal => terminal.id === 't-deploy');
  assert.equal(deploy.stateLabel, 'ACTIVE');
  assert.equal(deploy.progressPercent, 50);
  assert.equal(deploy.mine, true);
  const vault = view.terminals.find(terminal => terminal.id === 't-vault');
  assert.equal(vault.kind, 'VAULT');
  assert.equal(vault.stateLabel, 'LOCKED');
  assert.equal(vault.enemy, true);
  assert.equal(vault.remainingSeconds, 30);
  assert.equal(view.hasRoles, true);
  assert.equal(view.roles[0].label, 'BUILDER');
  assert.equal(view.roles[0].mark, '⚒');
  // Every terminal carries both a glyph and a word, never colour alone.
  for (const terminal of view.terminals) {
    assert.ok(terminal.kindMark.length > 0 && terminal.kind.length > 0);
    assert.ok(terminal.stateMark.length > 0 && terminal.stateLabel.length > 0);
  }
  // The defensive read also accepts the director/command subtree shapes.
  const nested = cocsTerminalView({director: {terminals: snapshot.terminals}}, {id: 0, team: 0}, sampleBoard());
  assert.equal(nested.count, 3);
  const empty = cocsTerminalView({terminals: []}, {id: 0, team: 0}, sampleBoard());
  assert.equal(empty.hasTerminals, false);
  assert.equal(empty.hasRoles, false);
});

test('cocsCommandView folds the board, spend window and terminals together and stays mode-isolated', () => {
  const snapshot = {...spendSnapshot(), terminals: [{id: 't1', kind: 'HACK', state: 'available'}], coop: true};
  const command = cocsCommandView(sampleBoard(), snapshot, {id: 0, team: 0}, null);
  assert.ok(command.boardView, 'the board view is folded in');
  assert.ok(command.spend, 'the spend view is folded in');
  assert.ok(command.terminals.hasTerminals, 'the terminal view is folded in');
  assert.equal(command.boardView.widthPercent, 42);
  assert.equal(command.spend.sinks.length, 4);
  const pvp = {...spendSnapshot()};
  delete pvp.director;
  const pvpCommand = cocsCommandView(sampleBoard(), pvp, {id: 0, team: 0}, null);
  assert.equal(pvpCommand.spend, null, 'PvPvE has no intermission spend window');
  assert.equal(cocsCommandView(null, snapshot, {id: 0, team: 0}, null), null);
});

test('O1c registers command, ping and radial as remappable bindings', () => {
  assert.equal(DEFAULT_BINDINGS.command, 'KeyB');
  assert.ok(KEYBIND_ACTIONS.includes('command'));
  assert.ok(KEYBIND_ACTIONS.includes('ping'));
  assert.ok(KEYBIND_ACTIONS.includes('radial'));
  assert.ok(KEYBIND_OPTIONS.includes('KeyB'), 'KeyB is offered in the settings dropdown');
  assert.equal(actionForCode(DEFAULT_BINDINGS, 'KeyB'), 'command');
  assert.equal(actionForCode(DEFAULT_BINDINGS, 'KeyU'), 'ping');
  assert.equal(actionForCode(DEFAULT_BINDINGS, 'KeyK'), 'radial');
  assert.equal(DEFAULT_BINDINGS.commandScan, 'KeyN', 'the V0b strip verbs are untouched');
});

test('the UI text scale clamps to 0.8–1.4 and defaults to 1', () => {
  assert.equal(normalizeDisplay({}).uiScale, 1);
  assert.equal(normalizeDisplay({uiScale: 5}).uiScale, 1.4);
  assert.equal(normalizeDisplay({uiScale: 0.1}).uiScale, 0.8);
  assert.equal(normalizeDisplay({uiScale: 1.2}).uiScale, 1.2);
  assert.equal(normalizeDisplay({uiScale: 'nope'}).uiScale, 1);
});

test('the page and components wire the O1c surfaces end to end', async () => {
  const root = new URL('../', import.meta.url);
  const page = await readFile(new URL('app/page.tsx', root), 'utf8');
  for (const token of ['spendCocs', 'cocsSpends', 'cocsBoardControlRef', 'spends:cocsSpends', 'autoSpend=false', 'cocsBoardRef']) {
    assert.ok(page.includes(token), `page wires ${token}`);
  }
  const board = await readFile(new URL('app/ui/screens/CommandBoardHud.tsx', root), 'utf8');
  assert.ok(board.includes('role="listbox"'), 'the board is a keyboard listbox');
  assert.ok(board.includes('aria-live="polite"'), 'the Needs you region is aria-live');
  assert.ok(board.includes('cocsBoardAnnouncement'), 'the announcement is derived, not hard-coded');
  assert.ok(board.includes('42'), 'the 42% peek-panel width is expressed in the component');
  const spend = await readFile(new URL('app/ui/screens/SpendWindowHud.tsx', root), 'utf8');
  for (const token of ['SPEND WINDOW', 'EXECUTOR', 'THREADS', 'SLICE']) assert.ok(spend.includes(token), `SpendWindowHud surfaces ${token}`);
  const terminals = await readFile(new URL('app/ui/screens/CocsTerminalsHud.tsx', root), 'utf8');
  for (const token of ['TERMINALS', 'ROLES', 'cocs-terminal']) assert.ok(terminals.includes(token), `CocsTerminalsHud surfaces ${token}`);
});

test('the stylesheet keeps the board reduced-motion and small-screen safe', async () => {
  const root = new URL('../', import.meta.url);
  const css = await readFile(new URL('app/globals.css', root), 'utf8');
  assert.ok(css.includes('.cocs-board.is-reduced'), 'the board has a reduced-motion class');
  assert.ok(css.includes('prefers-reduced-motion'), 'the stylesheet honours the OS preference');
  assert.ok(css.includes('--ui-scale'), 'the new surfaces read the UI text scale');
  assert.match(css, /\.cocs-board\{[^}]*max-width:42vw/, 'the board is capped at 42% of the viewport');
  assert.ok(css.includes('@media(max-width:900px)'), 'small screens reflow the board');
});

test('the O1c captions route through audioCaption', async () => {
  const {audioCaption} = await import('./hud.mjs');
  assert.equal(audioCaption({type: 'coop-spend', verb: 'FORTIFY', cost: 60}).text, 'Spend FORTIFY · 60 FLUX');
  assert.equal(audioCaption({type: 'director-intermission', nextWave: 3}).text, 'Intermission · wave 3');
  assert.equal(audioCaption({type: 'coop-intermission-open'}).text, 'Spend window open');
  assert.equal(audioCaption({type: 'cocs-order', verb: 'ATTACK', node: 'relay-0'}).text, 'Order ATTACK relay-0');
  assert.equal(audioCaption({type: 'not-a-real-event'}), null);
});

test('the spend cost constant stays pinned to the SCAN price', () => {
  assert.equal(COCS_SCAN_COST, 7);
});
