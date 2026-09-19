// LATTICE STRIKE — local command-board + spend-target derivation.
//
// The authoritative `cocsBoardView` (game/cocs-orders.mjs) synthesizes its
// exception list from telemetry that only exists once orders have run: locally
// a fresh Operations match has no `orderLog`/`cards`, so the board renders empty
// and its listbox is inert. This module derives a board that is never empty
// from data the local snapshot *does* carry — nodes, the field-support board,
// the director sink list, terminals, roles and `orderStats` — and resolves the
// concrete node a sink must name (the UI used to send the literal `'node'`,
// which the sim rejects).
//
// Everything here is pure: plain snapshot/board in, plain card/view out. The
// page owns dispatch; each actionable card carries `source` + `action` so both
// the keyboard Enter path and the mouse ACT/RETRY/CHECK buttons can route it.
const ARCHETYPE_RANK = Object.freeze({front: 0, economy: 1, relay: 2});
const CAPTURABLE_ARCHETYPES = Object.freeze(['front', 'economy', 'relay']);

export const LOCAL_CARD_SOURCE = Object.freeze({
  ORDER: 'local-order',
  SPEND: 'local-spend',
  TERMINAL: 'local-terminal',
  INFO: 'local-info',
});

export const LOCAL_CARD_ACTION = Object.freeze({ISSUE: 'issue', BUY: 'buy', CHECK: 'check'});

const STATUS = Object.freeze({
  queued: Object.freeze({label: 'QUEUED', mark: '◷'}),
  running: Object.freeze({label: 'RUNNING', mark: '▶'}),
  blocked: Object.freeze({label: 'BLOCKED', mark: '⚠'}),
  done: Object.freeze({label: 'DONE', mark: '✔'}),
});
const VERB_MARKS = Object.freeze({
  SCAN: '⌖', MOVE: '➤', HOLD: '⛨', ATTACK: '⚔', BUILD: '⚒',
  FORTIFY: '▤', REPAIR: '✚', RESUPPLY: '⇪', REINFORCE: '✦',
});
const BLOCKER_LABELS = Object.freeze({
  contested: 'CONTESTED', 'no-relay': 'NO RELAY', 'out-of-flux': 'OUT OF FLUX',
  'no-thread': 'NO THREAD', dependency: 'DEPENDENCY', target: 'NO TARGET',
});
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const teamOf = player => (player?.team === 1 ? 1 : 0);
const nodeLabel = (board, id) => {
  const node = (board?.nodes ?? []).find(entry => String(entry?.id) === String(id));
  return String(node?.label ?? id ?? 'TEAM');
};

/**
 * The peer identity local records must carry: the live network peer id online,
 * otherwise the local human actor's id (normally 0). The co-op gates resolve a
 * slice by matching this against living team-0 human actor ids, so the old
 * literal `'human'` was rejected as `executor` and every local order/spend
 * silently vanished.
 */
export function latticePeerId(net, match) {
  const peer = net?.started === true ? net?.peerId : null;
  if (peer !== null && peer !== undefined && peer !== '') return String(peer);
  const actor = Array.isArray(match?.actors) ? match.actors.find(entry => entry && (entry.team === 0 || entry.team === 1) && entry.bot == null) ?? match.actors[0] : null;
  return String(actor?.id ?? 0);
}

function rankTargets(nodes) {
  return [...nodes].sort((a, b) => {
    const rank = (ARCHETYPE_RANK[a.archetype] ?? 9) - (ARCHETYPE_RANK[b.archetype] ?? 9);
    if (rank !== 0) return rank;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** Nodes a node-targeted sink may legally name: owned front / economy / relay. */
export function ownedSinkTargets(snapshot, player) {
  const team = teamOf(player);
  return rankTargets((snapshot?.nodes ?? [])
    .filter(node => node && node.owner === team && CAPTURABLE_ARCHETYPES.includes(String(node.archetype)))
    .map(node => ({id: String(node.id), label: String(node.label ?? node.id), archetype: String(node.archetype)})));
}

/** The team HQ id for `target: 'hq'` sinks (REPAIR). */
export function hqSinkTarget(snapshot, player) {
  const team = teamOf(player);
  const hq = (snapshot?.nodes ?? []).find(node => node && node.owner === team && String(node.archetype) === 'hq');
  return hq ? {id: String(hq.id), label: String(hq.label ?? 'HQ'), archetype: 'hq'} : null;
}

/**
 * Resolve one sink's target against the snapshot. Returns
 * `{target, label, options, required, missing}` — `missing` is true when the
 * sink needs a node the team does not own yet, which the UI renders as a
 * disabled sink with an explicit reason instead of a doomed request.
 */
export function resolveSinkTarget(sink, snapshot, player) {
  const kind = String(sink?.target ?? 'team');
  if (kind === 'node') {
    const options = ownedSinkTargets(snapshot, player);
    const best = options[0] ?? null;
    return {target: best?.id ?? null, label: best?.label ?? null, options, required: true, missing: best === null};
  }
  if (kind === 'hq') {
    const hq = hqSinkTarget(snapshot, player);
    return {target: hq?.id ?? null, label: hq?.label ?? null, options: hq ? [hq] : [], required: true, missing: hq === null};
  }
  return {target: sink?.target ?? 'team', label: null, options: [], required: false, missing: false};
}

/** Enrich a `cocsSpendView` so every sink carries a concrete, legal target. */
export function withSinkTargets(spend, snapshot, player) {
  if (!spend || !Array.isArray(spend.sinks)) return spend;
  const sinks = spend.sinks.map(sink => {
    const resolved = resolveSinkTarget(sink, snapshot, player);
    const blocked = resolved.required && resolved.missing;
    return {
      ...sink,
      target: resolved.target,
      targetLabel: resolved.label,
      targetOptions: resolved.options,
      targetMissing: blocked,
      enabled: sink.enabled === true && !blocked,
      reason: blocked ? (String(sink.target) === 'hq' ? 'NO HQ' : 'NO OWNED NODE') : sink.reason,
      blocker: blocked ? 'dependency' : null,
    };
  });
  return {...spend, sinks};
}

function cardStatus(status) {
  return STATUS[status] ?? STATUS.queued;
}

function baseCard(input) {
  const status = cardStatus(input.status);
  const verb = String(input.verb ?? 'HOLD').toUpperCase();
  const blocker = input.blocker && BLOCKER_LABELS[input.blocker] ? input.blocker : null;
  return {
    id: String(input.id),
    verb,
    verbMark: VERB_MARKS[verb] ?? '●',
    target: input.target ?? null,
    targetLabel: String(input.targetLabel ?? input.target ?? 'TEAM'),
    agent: String(input.agent ?? 'chief').toLowerCase(),
    agentLabel: String(input.agentLabel ?? input.agent ?? 'CHIEF').toUpperCase(),
    cost: Math.max(0, num(input.cost, 0)),
    costPips: Math.max(0, Math.min(5, Math.round(num(input.costPips, input.cost > 0 ? 2 : 0)))),
    status: status === STATUS.blocked ? 'blocked' : status === STATUS.running ? 'running' : status === STATUS.done ? 'done' : 'queued',
    statusLabel: status.label,
    statusMark: status.mark,
    blocker,
    blockerLabel: blocker ? BLOCKER_LABELS[blocker] : null,
    reason: input.reason ? String(input.reason).toUpperCase() : blocker ? BLOCKER_LABELS[blocker] : null,
    etaSeconds: num(input.etaSeconds, 0),
    owner: input.owner ?? null,
    repeat: 0,
    impact: String(input.impact ?? ''),
    focus: Math.max(0, Math.min(100, num(input.focus, 0))),
    confidence: null,
    dep: null,
    source: input.source ?? LOCAL_CARD_SOURCE.INFO,
    action: input.action ?? null,
    actionLabel: input.actionLabel ?? null,
    local: input.local === true,
  };
}

/**
 * Cards derived from what exists locally. Actionable first: neutral live nodes
 * (ATTACK), the intermission sinks (BUY), live terminals (CHECK), then status
 * rows (front, threads, executor, slice, in-flight orders) so the board is
 * never empty even in the opening lull.
 */
export function localBoardCards(board, snapshot, player, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const cards = [];
  const team = teamOf(player);
  const nodes = Array.isArray(board?.nodes) ? board.nodes : [];
  const live = Array.isArray(board?.live) ? board.live : nodes.filter(node => node.live === true);
  const front = board?.front ?? null;
  const spend = options.spend ?? null;

  // 1. Attackable neutral nodes (the mode's core verb).
  const attackable = live.filter(node => !node.mine && !node.enemy).slice(0, 4);
  for (const node of attackable) {
    cards.push(baseCard({
      id: `local-node-${node.id}`, verb: 'ATTACK', target: node.id, targetLabel: node.label,
      agent: 'fighter', status: 'queued', source: LOCAL_CARD_SOURCE.ORDER, action: LOCAL_CARD_ACTION.ISSUE,
      actionLabel: 'ISSUE ATTACK', local: true, impact: node.contested ? `${node.progressPercent}% CONTESTED` : 'CAPTURABLE',
    }));
  }

  // 2. Intermission sinks with their resolved node/spend targets.
  if (snapshot.director?.intermission?.open === true) {
    for (const sink of spend?.sinks ?? []) {
      const blocked = sink.enabled !== true;
      cards.push(baseCard({
        id: `local-sink-${String(sink.id ?? sink.verb)}`, verb: sink.verb, target: sink.target,
        targetLabel: sink.targetLabel ?? sink.label, agent: 'chief',
        status: blocked ? 'blocked' : 'queued', blocker: blocked ? (sink.blocker ?? 'out-of-flux') : null,
        reason: blocked ? (sink.reason ?? 'UNAVAILABLE') : null, cost: sink.cost, costPips: 2,
        source: LOCAL_CARD_SOURCE.SPEND, action: LOCAL_CARD_ACTION.BUY, actionLabel: 'BUY',
        local: true, impact: sink.description ?? '',
      }));
    }
  }

  // 3. Terminals/roles that are actually on the field.
  const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
  for (const terminal of terminals.slice(0, 3)) {
    const blocked = terminal.state === 'blocked' || terminal.state === 'contested';
    cards.push(baseCard({
      id: `local-terminal-${terminal.id}`, verb: terminal.kind ?? 'HACK', target: terminal.id,
      targetLabel: terminal.label ?? terminal.id, agent: 'adept',
      status: terminal.state === 'active' || terminal.state === 'complete' ? 'running' : blocked ? 'blocked' : 'queued',
      blocker: blocked ? (terminal.state === 'contested' ? 'contested' : 'dependency') : null,
      reason: blocked ? (terminal.stateLabel ?? terminal.state) : null,
      source: LOCAL_CARD_SOURCE.TERMINAL, action: LOCAL_CARD_ACTION.CHECK, actionLabel: 'CHECK',
      local: true, impact: terminal.kindMark ? `${terminal.kindMark} ${terminal.stateLabel ?? ''}`.trim() : '',
    }));
  }

  const byRole = snapshot.roles?.byRole ?? null;
  for (const [role, count] of Object.entries(byRole ?? {})) {
    if (num(count, 0) > 0) cards.push(baseCard({
      id: `local-role-${role}`, verb: 'BUILD', targetLabel: `${num(count, 0)} ${role.toUpperCase()}`,
      agent: role, status: 'running', source: LOCAL_CARD_SOURCE.INFO, local: true,
      impact: 'AGENT ACTIVE',
    }));
  }

  // 4. Status rows: only the ones that explain the current gates.
  const threads = snapshot.command?.threads ?? snapshot.roles?.threads ?? null;
  const economy = options.economy ?? null;
  const slice = economy?.allowance ?? null;
  if (front) cards.push(baseCard({
    id: 'local-front', verb: front.mine ? 'HOLD' : 'ATTACK', target: front.id, targetLabel: front.label,
    agent: 'chief', status: front.contested ? 'blocked' : front.mine ? 'running' : 'queued',
    blocker: front.contested && !front.mine ? 'contested' : null,
    reason: front.contested && !front.mine ? 'CONTESTED' : null,
    source: LOCAL_CARD_SOURCE.INFO, local: true,
    impact: front.mine ? 'HELD' : `${front.progressPercent ?? 0}% CAPTURED`,
  }));
  if (threads && num(threads.cap, 0) > 0) cards.push(baseCard({
    id: 'local-threads', verb: 'HOLD', targetLabel: 'THREADS', agent: 'scrapper',
    status: num(threads.used, 0) >= num(threads.cap, 0) ? 'blocked' : 'running',
    blocker: num(threads.used, 0) >= num(threads.cap, 0) ? 'no-thread' : null,
    source: LOCAL_CARD_SOURCE.INFO, local: true,
    impact: `${num(threads.used, 0)} / ${num(threads.cap, 0)} COMMITTED`,
  }));
  if (slice) cards.push(baseCard({
    id: 'local-slice', verb: 'RESUPPLY', targetLabel: 'YOUR SLICE', agent: 'chief',
    status: num(slice.remaining, 0) > 0 ? 'running' : 'blocked',
    blocker: num(slice.remaining, 0) > 0 ? null : 'out-of-flux',
    source: LOCAL_CARD_SOURCE.INFO, local: true,
    impact: `${num(slice.remaining, 0)} / ${num(slice.allowance, 0)} FLUX`,
  }));
  const issued = num(snapshot.orderStats?.issued, 0);
  const completed = num(snapshot.orderStats?.completed, 0);
  if (issued > 0 || completed > 0) cards.push(baseCard({
    id: 'local-orders', verb: 'HOLD', targetLabel: 'ORDER LOG', agent: 'chief',
    status: issued > completed ? 'running' : 'done',
    source: LOCAL_CARD_SOURCE.INFO, local: true,
    impact: `${issued} ISSUED · ${completed} COMPLETED`,
  }));
  return cards;
}

/**
 * Merge locally derived cards into an authoritative board view and recompute
 * the sections/listbox/summary exactly like `cocsBoardView` does. Cards with an
 * id that already exists are dropped so the same work is never shown twice.
 */
export function mergeLocalBoard(view, cards, options = {}) {
  if (!view) return view;
  const existing = new Set((view.cards ?? []).map(card => card.id));
  const extra = (cards ?? []).filter(card => card && card.id && !existing.has(card.id)).map(baseCard);
  if (!extra.length) return view;
  const all = [...(view.cards ?? []), ...extra];
  const maxVisible = Math.max(1, num(options.maxVisible, view.maxVisible ?? 8));
  const needs = all.filter(card => card.status === 'blocked');
  const running = all.filter(card => card.status === 'running' || card.status === 'queued');
  const done = all.filter(card => card.status === 'done');
  const visibleNeeds = needs.slice(0, maxVisible);
  const runningRoom = Math.max(0, maxVisible - visibleNeeds.length);
  const visibleRunning = running.slice(0, runningRoom);
  const doneRoom = Math.max(0, runningRoom - visibleRunning.length);
  const visibleDone = done.slice(0, doneRoom);
  const section = (id, label, list, visible) => ({
    id, label, count: list.length, cards: visible,
    hidden: Math.max(0, list.length - visible.length), expandable: list.length > visible.length,
  });
  const sections = [
    section('needs', 'NEEDS YOU', needs, visibleNeeds),
    section('running', 'RUNNING', running, visibleRunning),
    section('done', 'DONE', done, visibleDone),
  ];
  const visibleCards = sections.flatMap(entry => entry.cards);
  return {
    ...view,
    sections,
    cards: all,
    visibleCards,
    visibleCount: visibleCards.length,
    listboxIds: visibleCards.map(card => card.id),
    summary: {
      needsYou: needs.length,
      running: running.length,
      done: done.length,
      blocked: needs.length,
      chip: `⚠ ${needs.length} blocked · ▶ ${running.length}`,
    },
    localCount: extra.length,
  };
}
