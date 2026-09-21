// LATTICE STRIKE (`cocs`) V0b command layer — the one-button order strip and the
// economy/spot readout. Spec authority: docs/design/COCS-MODE-SPEC.md §5.5/§5.8
// (the tier-0 3-button strip), §5.9 (verb collapse), §6.5 (FLUX) and §8 (SCOUT).
//
// Pure, deterministic and engine-free: every helper is a function of its
// arguments, nothing here touches `Match`, `view` or the clock. The strip is a
// tiny state machine — arm a verb, pick a target from the live node picker, then
// issue — and `cocsCommandView` folds it together with the frozen
// `snapshot.cocs` surface into the model `CocsReadout` renders.
//
// The three strip buttons are `SCAN / GO / ATTACK`. `GO` collapses onto the
// engine's `HOLD` verb (§5.9 names cards, not keys) and `SCAN` is the V0b scout
// order. One verb per arm; a target is a node id; an order is the exact
// `{tick, peerId, cardId, team, verb, target}` object `Match.step(dt,{cocs})`
// consumes.
import {SUBAGENTS, TRAVERSAL, neglectEffect} from './cocs-economy.mjs';
import {coopRole} from './cocs-roles.mjs';
import {directorTier} from './cocs-difficulty.mjs';
import {RULES} from './data.mjs';
import {latticeNodeLabel, latticeTargetModel} from './lattice-guide.mjs';

const TICK_SECONDS = Number.isFinite(RULES?.dt) && RULES.dt > 0 ? RULES.dt : 1 / 60;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const num = (value, fallback = 0) => (finite(value) ? value : fallback);
const round = (value, places = 2) => {
  const scale = 10 ** places;
  return Math.round(num(value, 0) * scale) / scale;
};

// §8.1 SCOUT spawn cost is the `SCAN` price the strip gates on.
export const COCS_SCAN_COST = num(SUBAGENTS?.scout?.spawnCost, 7);
// How long a freshly-issued order reads as PENDING before it is filed as the
// last issued order. Mirrors the engine's 2 s order TTL.
export const COCS_ORDER_PENDING_SECONDS = 2;
// Anti-double-fire window on the strip itself.
export const COCS_ORDER_ISSUE_COOLDOWN_SECONDS = 0.5;
// Digit keys 1..9 are the fastest picker; longer lattices stay click-only.
export const COCS_STRIP_MAX_TARGETS = 9;

const cooldownTicks = Math.max(1, Math.round(COCS_ORDER_ISSUE_COOLDOWN_SECONDS / TICK_SECONDS));
const pendingTicks = Math.max(1, Math.round(COCS_ORDER_PENDING_SECONDS / TICK_SECONDS));

// The tier-0 buttons. `id` is what the UI arms; `verb` is what the engine
// receives. Kept frozen so a caller can never rename a verb mid-match. `ROUTE`
// is the commander's standing push: it issues a `set-route` command instead of
// an engine order, so `cocsIssueRoute` (not `cocsIssueOrder`) settles it.
export const COCS_STRIP_BUTTONS = Object.freeze([
  Object.freeze({id: 'SCAN', verb: 'SCAN', label: 'SCAN', hint: 'Send the scout to scan a node'}),
  Object.freeze({id: 'GO', verb: 'HOLD', label: 'GO', hint: 'Hold or reinforce a node'}),
  Object.freeze({id: 'ATTACK', verb: 'ATTACK', label: 'ATTACK', hint: 'Take an enemy or neutral node'}),
  Object.freeze({id: 'ROUTE', verb: 'ROUTE', label: 'ROUTE', hint: 'Set the squad push route'}),
]);

const BUTTON_BY_ID = new Map(COCS_STRIP_BUTTONS.map(button => [button.id, button]));
const BUTTON_BY_VERB = new Map(COCS_STRIP_BUTTONS.map(button => [button.verb, button]));

/** Resolve a strip button from its id (`SCAN|GO|ATTACK`) or engine verb. */
export function cocsStripButton(id) {
  if (id && typeof id === 'object') {
    return BUTTON_BY_ID.get(String(id.id)) ?? BUTTON_BY_VERB.get(String(id.verb)) ?? null;
  }
  const key = String(id ?? '').trim().toUpperCase();
  return BUTTON_BY_ID.get(key) ?? BUTTON_BY_VERB.get(key) ?? null;
}

/** Fresh strip state. `armed` is a button id; `target` is a node id. */
export function cocsStripState() {
  return {armed: null, target: null, pending: null, issued: null, notice: null, cooldownUntil: 0, pendingUntil: 0, seq: 0, lastRejected: null};
}

const baseOf = state => (state && typeof state === 'object' ? state : cocsStripState());

/**
 * Arm or disarm a verb. Arming the already-armed verb disarms it; arming a new
 * verb drops the previous target so a `HOLD` pick can never issue as `ATTACK`.
 */
export function cocsArmVerb(state, id) {
  const button = cocsStripButton(id);
  const base = baseOf(state);
  if (!button) return {...base, notice: 'UNKNOWN VERB'};
  if (base.armed === button.id) return {...base, armed: null, target: null, notice: null};
  return {...base, armed: button.id, target: null, notice: null, lastRejected: null};
}

/** Disarm the strip without issuing. */
export function cocsClearStrip(state) {
  const base = baseOf(state);
  return {...base, armed: null, target: null, notice: null};
}

/** True while `cocsArmVerb` has a verb selected. */
export const cocsStripArmed = state => baseOf(state).armed !== null && BUTTON_BY_ID.has(String(baseOf(state).armed));

/**
 * The live node picker for the armed verb. Returns `{id,label,mark,ownerLabel,
 * index,...}` entries (1-based `index` = the number key). With an F04
 * `options.model` (or an authoritative adjacency via `options.adjacency` /
 * `options.graph`) every entry is a node the shared legal-target model already
 * certified as adjacent and ground-route reachable: `HOLD` accepts your own
 * node or any legal capture; `ATTACK` only legal captures/retakes you do not
 * own; `SCAN` accepts any capturable node (the scout flies its own route).
 * Without a model the picker narrows to targets that can plausibly work and
 * legality stays the engine's call, exactly as before.
 */
export function cocsTargetableNodes(board, id, options = {}) {
  const button = cocsStripButton(id);
  if (!button || !board) return [];
  if (options.model?.nodes?.length) {
    const list = [];
    const ordered = [];
    const push = node => { if (node && !ordered.includes(node)) ordered.push(node); };
    if (options.model.siege?.active) push(options.model.byId?.[options.model.siege.nodeId] ?? null);
    for (const node of options.model.ranked ?? []) push(node);
    for (const node of options.model.nodes) push(node);
    for (const node of ordered) {
      let eligible = false;
      if (button.verb === 'SCAN') eligible = node.capturable === true;
      else if (button.verb === 'HOLD') eligible = node.mine === true || node.attackable === true;
      else if (button.verb === 'ROUTE') eligible = node.mine === true || node.attackable === true;
      else eligible = node.attackable === true;
      if (!eligible) continue;
      if (button.verb !== 'SCAN' && node.reachable === false) continue;
      list.push({...node, label: node.label ?? latticeNodeLabel(node, options.map), index: list.length + 1, verb: button.verb});
      if (list.length >= COCS_STRIP_MAX_TARGETS) break;
    }
    return list;
  }
  const nodes = Array.isArray(board.nodes) ? board.nodes : [];
  const list = [];
  for (const node of nodes) {
    if (!node) continue;
    const archetype = String(node.archetype ?? 'front');
    const anchor = archetype === 'hq' || archetype === 'array';
    const capturable = !anchor;
    const live = node.live === true;
    const mine = node.mine === true;
    let eligible = false;
    if (button.verb === 'SCAN') eligible = capturable;
    else if (button.verb === 'HOLD') eligible = mine || (capturable && live);
    else if (button.verb === 'ROUTE') eligible = mine || (capturable && live);
    else eligible = capturable && live && !mine;
    if (!eligible) continue;
    list.push({...node, index: list.length + 1, verb: button.verb});
    if (list.length >= COCS_STRIP_MAX_TARGETS) break;
  }
  return list;
}

/**
 * Pick a target by node id or 1-based picker index. An unknown target is a
 * no-op that surfaces a notice; the previously picked target is preserved.
 */
export function cocsPickTarget(state, target, nodes = []) {
  const base = baseOf(state);
  if (!cocsStripArmed(base)) return {...base, notice: 'ARM A VERB FIRST'};
  const list = Array.isArray(nodes) ? nodes : [];
  const byId = base.target;
  const found = list.find(node => String(node?.id) === String(target)) ?? list.find(node => Number(node?.index) === Number(target));
  if (!found) {
    return {...base, notice: byId !== null ? null : 'NO TARGET', lastRejected: target ?? null};
  }
  return {...base, target: String(found.id), notice: null, lastRejected: null};
}

/**
 * Issue the armed+targeted order. Returns `{state, order}`; `order` is null when
 * the strip is not ready and `state.notice` explains why. `ctx`:
 * `{tick, peerId, cardId, team, flux, scanCost}`.
 */
export function cocsIssueOrder(state, ctx = {}) {
  const base = baseOf(state);
  const button = cocsStripButton(base.armed);
  if (!button) return {state: {...base, notice: 'ARM A VERB'}, order: null};
  const tick = num(ctx.tick, 0);
  if (tick < num(base.cooldownUntil, 0)) return {state: {...base, notice: 'COOLDOWN'}, order: null};
  if (base.target === null || base.target === undefined) return {state: {...base, notice: 'PICK A TARGET'}, order: null};
  const scanCost = num(ctx.scanCost, COCS_SCAN_COST);
  if (button.verb === 'SCAN' && num(ctx.flux, 0) < scanCost) return {state: {...base, notice: 'FLUX LOW'}, order: null};
  const team = ctx.team;
  if (team !== 0 && team !== 1) return {state: {...base, notice: 'NO TEAM'}, order: null};
  const seq = num(base.seq, 0) + 1;
  const order = {
    tick,
    peerId: String(ctx.peerId ?? 'human'),
    cardId: String(ctx.cardId ?? `${button.verb}-${team}-${tick}-${seq}`),
    team,
    verb: button.verb,
    target: String(base.target),
  };
  return {
    state: {
      ...base,
      armed: null,
      target: null,
      pending: order,
      issued: null,
      notice: null,
      lastRejected: null,
      cooldownUntil: tick + cooldownTicks,
      pendingUntil: tick + pendingTicks,
      seq,
    },
    order,
  };
}

// --- Commander surface (PvP-1 §5.7/§11.3 + OPERATIONS command board) -------
// The three stances the `policy` command accepts. Kept frozen: the sim's
// normalization table is the authority, this is only the UI vocabulary.
export const COCS_POLICY_OPTIONS = Object.freeze([
  Object.freeze({id: 'ASSAULT', label: 'ASSAULT', hint: 'Commit the squad forward; only a token garrison stays home'}),
  Object.freeze({id: 'HOLD', label: 'HOLD', hint: 'Keep the balanced plan'}),
  Object.freeze({id: 'FORTIFY', label: 'FORTIFY', hint: 'Man the defence and pull hurt bots out early'}),
]);

/**
 * Issue the armed `ROUTE` command. Routes are commander commands (`set-route`),
 * not engine orders: the sim records them on the command state and the bot plan
 * reads them. Returns `{state, command}` — `command` is null when the strip is
 * not ready and `state.notice` explains why. `ctx`:
 * `{tick, peerId, cardId, team}`.
 */
export function cocsIssueRoute(state, ctx = {}) {
  const base = baseOf(state);
  const button = cocsStripButton(base.armed);
  if (!button || button.verb !== 'ROUTE') return {state: {...base, notice: 'ARM ROUTE'}, command: null};
  const tick = num(ctx.tick, 0);
  if (tick < num(base.cooldownUntil, 0)) return {state: {...base, notice: 'COOLDOWN'}, command: null};
  if (base.target === null || base.target === undefined) return {state: {...base, notice: 'PICK A TARGET'}, command: null};
  const team = ctx.team;
  if (team !== 0 && team !== 1) return {state: {...base, notice: 'NO TEAM'}, command: null};
  const seq = num(base.seq, 0) + 1;
  const command = {
    tick,
    peerId: String(ctx.peerId ?? 'human'),
    cardId: String(ctx.cardId ?? `ROUTE-${team}-${tick}-${seq}`),
    team,
    action: 'set-route',
    value: String(base.target),
  };
  return {
    state: {
      ...base,
      armed: null,
      target: null,
      pending: null,
      issued: command,
      notice: null,
      lastRejected: null,
      cooldownUntil: tick + cooldownTicks,
      seq,
    },
    command,
  };
}

/**
 * One commander command record, built with the same `(tick, peerId, cardId)`
 * envelope as an order so the wire's idempotency bookkeeping works unchanged.
 * `value` is the stance for `policy`, the node id for `set-route`, and ignored
 * for `take`/`release`/`mutiny-vote`.
 * @param {string} action
 * @param {{tick?:number,peerId?:string,cardId?:string|null,team?:number,value?:any,seq?:number}} [options]
 */
export function cocsCommandRecord(action, { tick = 0, peerId = 'human', cardId = null, team = 0, value = null, seq = 0 } = {}) {
  const act = String(action ?? '').toLowerCase();
  const id = cardId ?? `${act.toUpperCase()}-${team}-${tick}-${seq}`;
  return {tick, peerId: String(peerId), cardId: String(id), team: team === 1 ? 1 : 0, action: act, value: value ?? null};
}

// --- F04 order truth: QUEUED until the sim confirms, then completion/refusal.
// The engine emits `cocs-order` (accepted), `cocs-order-rejected` and
// `cocs-order-complete`; local matches also keep `state.orderLog`. Both shapes
// normalize here so the strip and the board read one vocabulary.
export const COCS_ORDER_RESULT_STATUS = Object.freeze(['queued', 'accepted', 'complete', 'refused']);
const COCS_REFUSAL_NEXT_ACTIONS = Object.freeze({
  contested: 'CLEAR THE NODE, THEN ISSUE AGAIN',
  'no-relay': 'PICK A NODE NEXT TO GROUND YOU OWN',
  flux: 'EARN FLUX OR HOLD THE LINE',
  'out-of-flux': 'EARN FLUX OR HOLD THE LINE',
  slice: 'WAIT FOR THE NEXT SLICE OR LET THE CHIEF SPEND',
  executor: 'TAKE THE COMMAND LEASE, THEN REISSUE',
  thread: 'FREE A THREAD OR PICK A NODE WITHIN REACH',
  'no-thread': 'FREE A THREAD OR PICK A NODE WITHIN REACH',
  dependency: 'PICK A LEGAL ADJACENT NODE',
  target: 'PICK A LEGAL ADJACENT NODE',
  'no-response': 'RETRY OR PICK A NODE NEXT TO GROUND YOU OWN',
  blocked: 'CHECK THE COMMAND BOARD FOR A LEGAL TARGET',
});

/** The single "useful next action" sentence for an accepted, complete or refused order. */
export function cocsOrderNextAction(reason = null, verb = null, status = null) {
  const key = String(reason ?? '').toLowerCase();
  const action = String(verb ?? '').toUpperCase();
  if (status === 'complete' || key === 'complete') {
    return action === 'SCAN' ? 'WATCH THE SCOUT REPORT' : action === 'HOLD' ? 'KEEP THE LINE LINKED' : 'HOLD THE NODE YOU TOOK';
  }
  if (status === 'accepted') return action === 'SCAN' ? 'WATCH FOR THE SCAN MARK' : 'WATCH THE NODE RING';
  return COCS_REFUSAL_NEXT_ACTIONS[key] ?? 'CHECK THE COMMAND BOARD FOR A LEGAL TARGET';
}

/** Normalize engine events and `orderLog` entries into one result vocabulary. */
export function cocsOrderResults(orders) {
  return (Array.isArray(orders) ? orders : []).filter(Boolean).map(entry => {
    const type = String(entry.type ?? '');
    const refused = entry.ok === false || entry.status === 'refused' || type === 'cocs-order-rejected';
    const complete = !refused && (entry.complete === true || entry.status === 'complete' || type === 'cocs-order-complete');
    const status = refused ? 'refused' : complete ? 'complete' : entry.status === 'queued' ? 'queued' : 'accepted';
    return {
      status,
      cardId: entry.cardId === null || entry.cardId === undefined ? null : String(entry.cardId),
      peerId: entry.peerId === null || entry.peerId === undefined ? null : String(entry.peerId),
      verb: entry.verb === null || entry.verb === undefined ? null : String(entry.verb).toUpperCase(),
      target: entry.target ?? entry.node ?? null,
      targetLabel: entry.targetLabel ?? null,
      reason: entry.reason ?? null,
      tick: num(entry.tick, 0),
    };
  });
}

function sameOrder(result, order) {
  const cardId = order?.cardId === null || order?.cardId === undefined ? null : String(order.cardId);
  if (cardId && result.cardId) return cardId === result.cardId;
  if (result.verb && order?.verb && String(order.verb).toUpperCase() !== result.verb) return false;
  if (result.target !== null && order?.target !== null && order?.target !== undefined && String(order.target) !== String(result.target)) return false;
  if (result.peerId && order?.peerId) return result.peerId === String(order.peerId);
  return true;
}

function findOrderResult(results, order) {
  for (let index = results.length - 1; index >= 0; index--) if (sameOrder(results[index], order)) return results[index];
  return null;
}

function acceptedOrder(order, result) {
  return {
    ...order,
    pending: undefined,
    accepted: true,
    complete: result.status === 'complete',
    unconfirmed: false,
    resultAt: num(result.tick, 0),
    resultReason: result.reason ?? null,
    statusLabel: result.status === 'complete' ? 'COMPLETE' : 'ACCEPTED',
  };
}

function refusalNotice(result, tick) {
  const reason = String(result.reason ?? 'blocked').toLowerCase();
  const nextAction = cocsOrderNextAction(reason, result.verb);
  const targetLabel = result.targetLabel ?? latticeNodeLabel({id: result.target}, null);
  return {
    nextAction,
    lastRejected: {
      verb: result.verb ?? null,
      target: result.target ?? null,
      targetLabel,
      reason: reason.toUpperCase(),
      nextAction,
      tick: num(result.tick, tick),
    },
    notice: reason === 'no-response' ? `NO CONFIRMATION · ${nextAction}` : `REJECTED · ${reason.toUpperCase()} · ${nextAction}`,
  };
}

/**
 * Advance the strip clock against authoritative order results. With
 * `ctx.orders` supplied (engine `cocs-order*` events or `orderLog` entries) the
 * pending order stays QUEUED until the sim accepts it, only then files as
 * ACCEPTED/COMPLETE, and a refusal clears both pending and issued so a rejected
 * order can never leave an accepted-success message behind. Without an
 * authoritative list the legacy TTL filing is kept, but the filed order is
 * flagged `unconfirmed`. Reference-stable when nothing changed.
 */
export function cocsSyncStrip(state, ctx = {}) {
  const base = baseOf(state);
  const tick = num(ctx.tick, 0);
  const results = cocsOrderResults(ctx.orders);
  if (!results.length) {
    if (base.pending && tick >= num(base.pendingUntil, 0)) {
      return {...base, issued: {...base.pending, unconfirmed: true}, pending: null};
    }
    return base;
  }
  if (base.pending) {
    const result = findOrderResult(results, base.pending);
    if (result?.status === 'refused') return {...base, pending: null, issued: null, ...refusalNotice(result, tick)};
    if (result?.status === 'accepted' || result?.status === 'complete') {
      return {...base, pending: null, issued: acceptedOrder(base.pending, result), notice: null, nextAction: cocsOrderNextAction(null, base.pending.verb, result.status)};
    }
    if (tick >= num(base.pendingUntil, 0)) {
      return {...base, pending: null, issued: null, ...refusalNotice({status: 'refused', reason: 'no-response', verb: base.pending.verb, target: base.pending.target, tick}, tick)};
    }
    return base;
  }
  if (base.issued) {
    const result = findOrderResult(results, base.issued);
    if (result?.status === 'refused') return {...base, pending: null, issued: null, ...refusalNotice(result, tick)};
    if (result?.status === 'complete' && base.issued.complete !== true) {
      return {...base, issued: acceptedOrder(base.issued, result), notice: null, nextAction: cocsOrderNextAction(null, base.issued.verb, 'complete')};
    }
    if (result?.status === 'accepted' && base.issued.unconfirmed === true) {
      return {...base, issued: acceptedOrder(base.issued, result), notice: null, nextAction: cocsOrderNextAction(null, base.issued.verb, 'accepted')};
    }
  }
  return base;
}

const orderView = (order, nodeLabels = {}) => {
  if (!order) return null;
  const button = cocsStripButton(order.verb);
  const node = nodeLabels[String(order.target)] ?? null;
  const targetLabel = node?.label ?? latticeNodeLabel({id: order.target}, null);
  const statusLabel = order.complete === true ? 'COMPLETE' : order.accepted === true ? 'ACCEPTED' : order.unconfirmed === true ? 'UNCONFIRMED' : 'QUEUED';
  return {
    verb: order.verb,
    label: button?.label ?? order.verb,
    target: order.target,
    targetLabel,
    targetMark: node?.mark ?? '●',
    text: `${button?.label ?? order.verb} · ${targetLabel}`,
    statusLabel,
    statusMark: statusLabel === 'COMPLETE' ? '✔' : statusLabel === 'ACCEPTED' ? '▶' : statusLabel === 'UNCONFIRMED' ? '⚠' : '◷',
    queued: statusLabel === 'QUEUED',
    accepted: order.accepted === true,
    complete: order.complete === true,
    unconfirmed: order.unconfirmed === true,
  };
};

/**
 * The render model for the strip. `ctx`: `{tick, flux, scanCost, nodes,
 * nodeLabels, teamName, orders}`. `orders` are the authoritative engine
 * results: with them a pending order reads QUEUED until the sim accepts it,
 * then ACCEPTED/COMPLETE, and a refusal is shown with a next action. `canIssue`
 * is the single gate the confirm button reads.
 */
export function cocsStripView(state, ctx = {}) {
  const tick = num(ctx.tick, 0);
  const flux = num(ctx.flux, 0);
  const scanCost = num(ctx.scanCost, COCS_SCAN_COST);
  const nodes = Array.isArray(ctx.nodes) ? ctx.nodes : [];
  const nodeLabels = ctx.nodeLabels && typeof ctx.nodeLabels === 'object' ? ctx.nodeLabels : {};
  const base = Array.isArray(ctx.orders) ? cocsSyncStrip(state, {tick, orders: ctx.orders}) : baseOf(state);
  const cooldown = Math.max(0, num(base.cooldownUntil, 0) - tick);
  const button = cocsStripButton(base.armed);
  const targetNode = base.target === null || base.target === undefined ? null : nodes.find(node => String(node.id) === String(base.target)) ?? null;
  const pendingActive = Boolean(base.pending) && tick < num(base.pendingUntil, 0);
  const pending = pendingActive ? orderView(base.pending, nodeLabels) : null;
  const issued = orderView(base.issued ?? (base.pending && !pendingActive ? base.pending : null), nodeLabels);
  const buttons = COCS_STRIP_BUTTONS.map(entry => {
    const scanLow = entry.verb === 'SCAN' && flux < scanCost;
    const cooling = cooldown > 0;
    const disabled = scanLow || cooling;
    return {
      ...entry,
      armed: base.armed === entry.id,
      disabled,
      reason: cooling ? 'COOLDOWN' : scanLow ? 'FLUX LOW' : null,
    };
  });
  const scanLow = button?.verb === 'SCAN' && flux < scanCost;
  return {
    armed: base.armed,
    armedLabel: button?.label ?? null,
    target: base.target,
    targetNode,
    targetLabel: targetNode?.label ?? (base.target === null || base.target === undefined ? null : latticeNodeLabel({id: base.target}, null)),
    buttons,
    nodes,
    maxTargets: COCS_STRIP_MAX_TARGETS,
    cooldown,
    cooldownSeconds: round(cooldown * TICK_SECONDS, 1),
    pending,
    pendingLabel: pending ? 'QUEUED' : null,
    issued,
    notice: base.notice ?? null,
    nextAction: base.nextAction ?? null,
    lastRejected: base.lastRejected ?? null,
    canIssue: Boolean(button) && Boolean(targetNode) && cooldown <= 0 && !scanLow,
    scanCost,
  };
}

/**
 * Live `SPOT` marks for one team, expressed from the frozen snapshot. `until` is
 * a sim tick, so the remaining window is `until - snapshot.tick`; expired marks
 * are dropped. Presentation only — the +15% damage is applied engine-side.
 */
export function cocsSpotView(snapshot, team) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const tick = num(snapshot.tick, 0);
  const raw = Array.isArray(snapshot.spots) ? snapshot.spots : [];
  const spots = [];
  for (const spot of raw) {
    if (!spot) continue;
    if (team !== 0 && team !== 1) continue;
    if (spot.team !== team) continue;
    const remaining = Math.max(0, (num(spot.until, 0) - tick) * TICK_SECONDS);
    if (!(remaining > 0)) continue;
    spots.push({
      id: spot.id,
      team: spot.team,
      x: num(spot.x, 0),
      z: num(spot.z, 0),
      by: spot.by ?? null,
      until: num(spot.until, 0),
      remaining,
      remainingSeconds: round(remaining, 1),
    });
  }
  return spots;
}

// §6A.6 NEGLECT words, one per tier. The effect's `tier` is the machine value;
// the label is what the readout shows beside the number.
const COCS_NEGLECT_LABELS = Object.freeze({none: 'NOMINAL', degrade: 'DEGRADED', cap: 'CAPPED'});

/**
 * The team FLUX bar, personal REQ chip, order tally, scout card, scan target
 * and the §6A.6 NEGLECT meter as a pure view of `snapshot.cocs`. Null when the
 * subtree is absent (every non-cocs mode), which is what keeps the readout
 * mode-isolated. `neglect` pairs the number with a word (`NOMINAL`,
 * `DEGRADED`, `CAPPED`) and the passive-income multiplier so the readout never
 * leans on colour.
 */
export function cocsEconomyView(snapshot, player) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const team = player?.team === 0 || player?.team === 1 ? Number(player.team) : null;
  const value = team === null ? 0 : num(snapshot.flux?.[team], 0);
  const cap = num(snapshot.fluxCap, 0);
  const income = team === null ? 0 : num(snapshot.fluxIncome?.[team], 0);
  const upkeep = team === null ? 0 : num(snapshot.fluxUpkeep?.[team], 0);
  const spent = team === null ? 0 : num(snapshot.fluxSpent?.[team], 0);
  const rawNeglect = team === null ? 0 : snapshot.neglect?.[team];
  const neglectValue = num(rawNeglect && typeof rawNeglect === 'object' ? rawNeglect.value : rawNeglect, 0);
  const neglect = neglectEffect({value: neglectValue});
  const reqEntry = Array.isArray(snapshot.req) ? snapshot.req.find(entry => entry && entry.id === player?.id) ?? null : null;
  const stats = snapshot.scoutStats?.[team] ?? {spawned: 0, killed: 0, expired: 0, scans: 0};
  const scout = team === null ? null : (Array.isArray(snapshot.scouts) ? snapshot.scouts.find(entry => entry && entry.team === team) ?? null : null);
  const scanNode = team === null ? null : snapshot.scans?.[team] ?? null;
  const spots = cocsSpotView(snapshot, team);
  return {
    team,
    flux: value,
    fluxCap: cap,
    fluxPercent: cap > 0 ? Math.max(0, Math.min(1, value / cap)) : 0,
    income,
    upkeep,
    net: round(income - upkeep, 3),
    spent,
    neglect: {
      value: round(neglectValue, 1),
      tier: neglect.tier,
      label: COCS_NEGLECT_LABELS[neglect.tier] ?? 'NOMINAL',
      multiplier: neglect.multiplier,
      reduction: neglect.reduction,
      capped: neglect.capped,
      percent: Math.max(0, Math.min(1, neglectValue / 100)),
    },
    req: reqEntry ? {value: num(reqEntry.req, 0), earned: num(reqEntry.earned, 0), spent: num(reqEntry.spent, 0)} : {value: 0, earned: 0, spent: 0},
    orders: {
      issued: num(snapshot.orderStats?.issued, 0),
      completed: num(snapshot.orderStats?.completed, 0),
      byVerb: {
        HOLD: num(snapshot.orderStats?.byVerb?.HOLD, 0),
        ATTACK: num(snapshot.orderStats?.byVerb?.ATTACK, 0),
        SCAN: num(snapshot.orderStats?.byVerb?.SCAN, 0),
      },
    },
    scout: scout
      ? {alive: true, id: scout.id, node: scout.node ?? null, scanned: scout.scanned === true, returning: scout.returning === true, idle: scout.idle === true, expireTick: num(scout.expireTick, 0)}
      : {alive: false, id: null, node: null, scanned: false, returning: false, idle: false, expireTick: 0},
    scoutCap: num(snapshot.scoutCap, 1),
    scoutStats: {
      spawned: num(stats?.spawned, 0),
      killed: num(stats?.killed, 0),
      expired: num(stats?.expired, 0),
      scans: num(stats?.scans, 0),
    },
    scan: {nodeId: scanNode, active: scanNode !== null && scanNode !== undefined},
    spots,
    spotCount: spots.length,
    spotBonus: num(snapshot.spotBonus, 0.15),
    scanRadius: num(snapshot.scanRadius, 12),
    spotSeconds: num(snapshot.spotSeconds, 8),
  };
}

// ---------------------------------------------------------------------------
// PvP-1 team FLUX purchase strip (§5.3/§11.2). The room/sim are the authority:
// this view only decides what the local team *can ask for* from the frozen
// snapshot (`roleBoard.allow`, `roleBoard.threads`, team FLUX, rung). Cards are
// REINFORCE (one per rung-legal role) and SCAN (the SCOUT; the fresh spawn
// needs a live node, so the view suggests one). Null outside a two-team role
// board, so co-op and every non-cocs mode stay dark. Spectators get
// `visible:false` and every card disabled — no purchase surface for them.
// ---------------------------------------------------------------------------
const COCS_PURCHASE_ROLE_MARKS = Object.freeze({fighter: '⚔', harvester: '⛏', builder: '⚒', scout: '⌖', saboteur: '✧'});
const COCS_PURCHASE_REASONS = Object.freeze({
  SPECTATING: 'SPECTATING',
  'NO-THREAD': 'NO THREAD',
  'FLUX-LOW': 'FLUX LOW',
  'ROLE-LOCKED': 'RUNG LOCKED',
  'NO-TARGET': 'NO TARGET',
});
/** Human words for a purchase blocker; null means the card is ready. */
export function cocsPurchaseReason(value) {
  if (!value) return null;
  return COCS_PURCHASE_REASONS[value] ?? String(value);
}

/** The SCAN suggestion: an enemy/contested/neutral live capturable node, id-sorted. */
function cocsScanHint(snapshot, team) {
  const nodes = (Array.isArray(snapshot?.nodes) ? snapshot.nodes : [])
    .filter(node => node && ['front', 'economy', 'relay'].includes(String(node.archetype)))
    .filter(node => node.live !== false)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const pick = nodes.find(node => node.owner === (1 - team))
    ?? nodes.find(node => node.contested === true)
    ?? nodes.find(node => node.owner === null || node.owner === undefined)
    ?? nodes.find(node => node.owner === team)
    ?? null;
  return pick ? {nodeId: String(pick.id), label: pick.label ?? latticeNodeLabel({id: pick.id}, null)} : null;
}

/**
 * The local team's REINFORCE / SCAN purchase cards as a pure read of the
 * frozen snapshot plus the caller's derived FLUX. The rung allow-list,
 * THREADS cap and team FLUX are the same gates the sim and the room apply, so
 * a disabled card is never a doomed request; the sim still decides.
 */
export function cocsPurchaseView(snapshot, player, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const team = player?.team === 0 || player?.team === 1 ? Number(player.team) : null;
  if (team === null) return null;
  const board = snapshot.roleBoard?.[team];
  const allow = Array.isArray(board?.allow) ? board.allow.map(role => String(role)) : null;
  if (!allow) return null;
  const spectate = options.spectate === true || player?.spectate === true;
  const threads = {used: num(board?.threads?.used, 0), cap: num(board?.threads?.cap, 0)};
  const threadFree = threads.cap > 0 ? threads.used < threads.cap : true;
  const flux = options.flux !== undefined ? num(options.flux, 0) : num(snapshot.flux?.[team], 0);
  const cards = [];
  for (const role of allow) {
    if (role === 'scout') continue;
    const def = coopRole(role);
    if (!def) continue;
    const cost = num(def.spawnCost, 0);
    const affordable = flux + 1e-9 >= cost;
    const reason = spectate ? 'SPECTATING' : !threadFree ? 'NO-THREAD' : !affordable ? 'FLUX-LOW' : null;
    cards.push({
      id: `reinforce-${role}`,
      verb: 'REINFORCE',
      action: 'reinforce',
      role,
      label: String(def.name ?? role).toUpperCase(),
      mark: COCS_PURCHASE_ROLE_MARKS[role] ?? '◆',
      cost,
      target: null,
      targetLabel: null,
      enabled: reason === null,
      reason,
    });
  }
  const scanAllowed = allow.includes('scout');
  const scan = cocsScanHint(snapshot, team);
  const scanAffordable = flux + 1e-9 >= COCS_SCAN_COST;
  const scanReason = spectate ? 'SPECTATING'
    : !scanAllowed ? 'ROLE-LOCKED'
      : !threadFree ? 'NO-THREAD'
        : !scanAffordable ? 'FLUX-LOW'
          : !scan ? 'NO-TARGET' : null;
  cards.push({
    id: 'scan-scout',
    verb: 'SCAN',
    action: 'spawn',
    role: 'scout',
    label: 'SCAN',
    mark: COCS_PURCHASE_ROLE_MARKS.scout,
    cost: COCS_SCAN_COST,
    target: scan?.nodeId ?? null,
    targetLabel: scan?.label ?? null,
    enabled: scanReason === null,
    reason: scanReason,
  });
  return {
    team,
    rung: snapshot.rung ?? null,
    flux: round(flux, 1),
    threads,
    threadFree,
    spectate,
    visible: !spectate && cards.some(card => card.role !== 'scout' || scanAllowed),
    cards,
    canSpend: !spectate && cards.some(card => card.enabled),
  };
}

/**
 * OPERATIONS Director read model (design §6.4). Pure view of `snapshot.director`
 * plus `snapshot.waves`/`snapshot.command`; null in PvPvE `cocs` so the same
 * `CocsReadout` stays mode-isolated and the new component only appears in co-op.
 */
export function cocsDirectorView(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.coop !== true) return null;
  const director = snapshot.director;
  if (!director || typeof director !== 'object') return null;
  const siege = director.siege ?? {};
  const waves = snapshot.waves ?? {};
  const command = snapshot.command ?? null;
  const fronts = Array.isArray(director.fronts) ? director.fronts : [];
  const nodeLabels = new Map((Array.isArray(snapshot.nodes) ? snapshot.nodes : []).map(node => [String(node?.id), String(node?.label ?? latticeNodeLabel(node, null))]));
  const labelledNode = id => id === null || id === undefined ? null : nodeLabels.get(String(id)) ?? latticeNodeLabel({id}, null);
  const tierCopy = director.tierCopy ?? {};
  const intermission = director.intermission ?? null;
  const bonus = Array.isArray(snapshot.bonus) ? snapshot.bonus : [];
  return {
    coop: true,
    tier: director.tier ?? 'D1',
    tierLabel: director.tierLabel ?? '',
    tierCopy: {
      label: tierCopy.label ?? director.tierLabel ?? '',
      copy: tierCopy.copy ?? '',
      modifiers: Array.isArray(tierCopy.modifiers) ? [...tierCopy.modifiers] : [],
      band: Array.isArray(tierCopy.band) ? [...tierCopy.band] : [],
    },
    phase: director.phase ?? 'intermission',
    wave: num(director.wave, 0),
    waveCount: num(director.waveCount, 5),
    waveLabel: director.waveLabel ?? '',
    modifier: director.modifier ?? null,
    budget: {
      current: num(director.budget?.current, 0),
      spent: num(director.budget?.spent, 0),
      rate: num(director.budget?.rate, 0),
      cap: num(director.budget?.cap, 0),
      peak: num(director.budget?.peak, 0),
    },
    pressure: num(director.pressure, 0),
    fronts: fronts.map(front => ({nodeId: front.nodeId, label: labelledNode(front.nodeId), strength: num(front.strength, 0)})),
    telegraph: director.telegraph ? {kind: director.telegraph.kind, nodeId: director.telegraph.nodeId ?? null, label: labelledNode(director.telegraph.nodeId), seconds: num(director.telegraph.seconds, 0)} : null,
    boss: director.boss ? {actorId: director.boss.actorId, type: director.boss.type, phase: num(director.boss.phase, 1)} : null,
    retarget: director.retarget ? {nodeId: director.retarget.nodeId, label: labelledNode(director.retarget.nodeId), reason: director.retarget.reason} : null,
    secondsRemaining: num(director.secondsRemaining, 0),
    siege: {
      armed: siege.armed === true,
      hqId: siege.hqId ?? 'hq-0',
      label: labelledNode(siege.hqId ?? 'hq-0'),
      health: num(siege.health, 0),
      max: num(siege.max, 1),
      percent: Math.max(0, Math.min(1, num(siege.percent, siege.max ? num(siege.health, 0) / siege.max : 0))),
      attackers: num(siege.attackers, 0),
      defenders: num(siege.defenders, 0),
      damage: num(siege.damage, 0),
      repairs: num(siege.repairs, 0),
    },
    waves: {cleared: num(waves.cleared, 0), par: num(waves.par, 5), forceAlive: num(waves.forceAlive, 0), forceTotal: num(waves.forceTotal, 0)},
    intermission: intermission ? {
      open: intermission.open === true,
      secondsRemaining: num(intermission.secondsRemaining, 0),
      budget: num(intermission.budget, 0),
      spent: num(intermission.spent, 0),
      windows: num(intermission.windows, 0),
      byType: {
        FORTIFY: num(intermission.byType?.FORTIFY, 0), REPAIR: num(intermission.byType?.REPAIR, 0),
        RESUPPLY: num(intermission.byType?.RESUPPLY, 0), REINFORCE: num(intermission.byType?.REINFORCE, 0),
      },
      sinks: (Array.isArray(intermission.sinks) ? intermission.sinks : []).map(sink => ({
        verb: sink.verb, id: sink.id ?? sink.verb, label: sink.label ?? sink.verb,
        cost: num(sink.cost, 0), target: sink.target ?? 'team',
        description: sink.description ?? '',
        available: sink.available !== false, affordable: sink.affordable !== false, enabled: sink.enabled === true,
      })),
      log: (Array.isArray(intermission.log) ? intermission.log : []).slice(-4).map(entry => ({...entry})),
    } : null,
    bonus: bonus.map(entry => ({
      id: entry.id, label: entry.label ?? entry.id, state: entry.state ?? 'open',
      progress: num(entry.progress, 0), target: Math.max(1, num(entry.target, 1)),
    })),
    bonusTelemetry: snapshot.bonusTelemetry ? {
      done: [...(snapshot.bonusTelemetry.done ?? [])],
      failed: [...(snapshot.bonusTelemetry.failed ?? [])],
      flux: num(snapshot.bonusTelemetry.flux, 0),
      req: num(snapshot.bonusTelemetry.req, 0),
      commendations: num(snapshot.bonusTelemetry.commendations, 0),
    } : {done: [], failed: [], flux: 0, req: 0, commendations: 0},
    reserve: snapshot.reserves ? {enabled: snapshot.reserves.enabled === true, tickets: num(snapshot.reserves.tickets, 0), burns: num(snapshot.reserves.burns, 0)} : null,
    rewards: snapshot.rewards ? {
      win: snapshot.rewards.win === true, retention: num(snapshot.rewards.retention, 1),
      tierRewardMultiplier: num(snapshot.rewards.tierRewardMultiplier, 1),
      commendations: num(snapshot.rewards.commendations, 0),
      leftover: num(snapshot.rewards.leftover, 0),
      bonusCommendations: num(snapshot.rewards.bonusCommendations, 0),
    } : null,
    command: command ? {
      humans: num(command.humans, 0),
      slicePerPlayer: num(command.slicePerPlayer, 0),
      executor: command.executor ?? null,
      threads: {used: num(command.threads?.used, 0), cap: num(command.threads?.cap, 0)},
    } : null,
  };
}

/**
 * §6A traversal + depot read model for the HUD. Pure view of `snapshot.traversal`
 * (the frozen `cocsTraversalSnapshot` subtree) and `snapshot.tick`/player team;
 * null when the subtree is absent, which keeps every other mode dark. Shapes
 * (per-kind mark, per-state mark, per-channel label) accompany the words so the
 * readout never leans on colour, and nothing here animates.
 */
const COCS_DEVICE_KINDS = Object.freeze({
  zipline: {label: 'ZIPLINE', mark: '⇢'},
  'jump-pad': {label: 'JUMP PAD', mark: '⤒'},
  launcher: {label: 'LAUNCHER', mark: '⟰'},
  teleporter: {label: 'TELEPORTER', mark: '◎'},
});
const COCS_DEVICE_STATES = Object.freeze({
  live: {label: 'LIVE', mark: '▶'},
  cut: {label: 'CUT', mark: '✂'},
  locked: {label: 'LOCKED', mark: '▣'},
});
const COCS_CHANNEL_ACTIONS = Object.freeze({cut: 'CUTTING', lock: 'LOCKING', repair: 'REPAIRING'});
const cocsDeviceKind = kind => COCS_DEVICE_KINDS[String(kind)] ?? {label: String(kind ?? 'DEVICE').toUpperCase(), mark: '◆'};
const cocsDeviceState = state => COCS_DEVICE_STATES[String(state)] ?? {label: String(state ?? 'LIVE').toUpperCase(), mark: '▶'};
const cocsDepotOwnerLabel = (owner, team, contested) => contested ? 'CONTESTED'
  : owner === null || owner === undefined ? 'NEUTRAL'
    : team !== null && owner === team ? 'YOURS'
      : team !== null ? 'ENEMY'
        : `TEAM ${owner}`;

// --- Human interact prompt (§6A.1 "one-input rule") ------------------------
// The 6 m sabotage/repair band matches `DEVICE_INTERACT_METERS`; the 0.9 m
// anchor use reach matches `TRAVERSAL.anchorReachMeters`. The view mirrors the
// engine's `humanDeviceInteract` selection so the verb on screen is the verb the
// `interact` edge will run. Mode-isolated: only a traversal terminal subtree
// produces a prompt, and the key label is injected by the page.
const COCS_INTERACT_REACH_METERS = 6;
const COCS_ANCHOR_REACH_METERS = num(TRAVERSAL?.anchorReachMeters, 0.9);
const COCS_TRAVERSABLE_KINDS = new Set(['zipline', 'jump-pad', 'teleporter', 'launcher']);
const COCS_DEVICE_VERBS = Object.freeze({use: 'RIDE', cut: 'CUT', lock: 'LOCK', repair: 'REPAIR'});
const COCS_TERMINAL_VERB_ORDER = Object.freeze(['DEPLOY', 'HACK', 'VAULT', 'SABOTAGE']);
const cocsInteractKey = options => String(options?.interactKey ?? 'E');
const cocsDistance = num => Math.round(Math.max(0, num) * 10) / 10;
const cocsSabotageVerb = kind => (kind === 'zipline' || kind === 'teleporter' ? 'cut' : 'lock');

// The nearest device inside the 6 m interact band, resolved to the verb the
// engine would run: RIDE at the 0.9 m anchor for a live traversable device,
// CUT/LOCK for a live cuttable/lockable one, REPAIR when it is dead.
function cocsDevicePrompt(devices, player, options) {
  if (!finite(player?.x) || !finite(player?.z)) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const device of devices) {
    const d = Math.hypot(player.x - device.x, player.z - device.z);
    if (!(d <= COCS_INTERACT_REACH_METERS)) continue;
    if (nearest === null || d < nearestDistance - 1e-9) { nearest = device; nearestDistance = d; }
  }
  if (!nearest) return null;
  const anchored = nearestDistance <= COCS_ANCHOR_REACH_METERS + 1e-9;
  let action = null;
  if (nearest.state === 'live') {
    if (anchored && COCS_TRAVERSABLE_KINDS.has(nearest.kind)) action = 'use';
    else if (COCS_TRAVERSABLE_KINDS.has(nearest.kind)) action = cocsSabotageVerb(nearest.kind);
  } else action = 'repair';
  if (!action) return null;
  const channelPercent = nearest.channel ? Math.round(Math.max(0, Math.min(1, nearest.channel.percent ?? 0)) * 100) : 0;
  const verb = COCS_DEVICE_VERBS[action];
  const distance = cocsDistance(nearestDistance);
  return {
    source: 'device',
    id: nearest.id,
    kind: nearest.kind,
    label: nearest.label,
    mark: nearest.mark,
    action,
    verb,
    key: cocsInteractKey(options),
    anchored,
    distance,
    distanceMeters: distance,
    state: nearest.state,
    stateLabel: nearest.stateLabel,
    channelPercent,
    channel: nearest.channel,
    hint: action === 'use' ? 'PRESS TO RIDE'
      : action === 'repair' ? 'PRESS TO REPAIR'
        : `PRESS TO ${verb}`,
    text: `${verb} ${nearest.label}`,
  };
}

// A capture/enter hint for the closest depot (inside a 12 m read band; the
// authored capture radius is not on the snapshot). Loaner state reuses the
// READY/SPAWNING/RETURN/NONE vocabulary already shown in the depot list.
function cocsDepotPrompt(depots, player) {
  if (!finite(player?.x) || !finite(player?.z)) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const depot of depots) {
    const d = Math.hypot(player.x - depot.x, player.z - depot.z);
    if (!(d <= 12)) continue;
    if (nearest === null || d < nearestDistance - 1e-9) { nearest = depot; nearestDistance = d; }
  }
  if (!nearest) return null;
  const hint = nearest.mine
    ? (nearest.vehicle.available ? `ENTER LOANER AT ${nearest.label}` : `LOANER ${nearest.vehicle.state}`)
    : nearest.contested ? `${nearest.label} CONTESTED`
      : `HOLD ${nearest.label} TO CAPTURE${nearest.capturePercent > 0 ? ` · ${nearest.capturePercent}%` : ''}`;
  return {
    id: nearest.id,
    label: nearest.label,
    mark: nearest.mark,
    ownerLabel: nearest.ownerLabel,
    capturePercent: nearest.capturePercent,
    vehicle: nearest.vehicle,
    mine: nearest.mine,
    distance: cocsDistance(nearestDistance),
    hint,
    text: hint,
  };
}

export function cocsTraversalView(snapshot, player, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const raw = snapshot.traversal;
  if (!raw || typeof raw !== 'object') return null;
  const team = player?.team === 0 || player?.team === 1 ? Number(player.team) : null;
  const devices = (Array.isArray(raw.devices) ? raw.devices : []).filter(Boolean).map(device => {
    const kind = cocsDeviceKind(device.kind);
    const state = cocsDeviceState(device.state);
    const channel = device.channel ? {
      actor: device.channel.actor,
      action: device.channel.action,
      label: COCS_CHANNEL_ACTIONS[String(device.channel.action)] ?? 'CHANNELLING',
      remaining: num(device.channel.remaining, 0),
      remainingSeconds: round(num(device.channel.remaining, 0), 1),
      total: num(device.channel.total, 0),
      percent: num(device.channel.total, 0) > 0 ? Math.max(0, Math.min(1, 1 - num(device.channel.remaining, 0) / num(device.channel.total, 0))) : 0,
    } : null;
    return {
      id: String(device.id),
      kind: String(device.kind ?? ''),
      lane: device.lane ?? null,
      label: kind.label,
      mark: kind.mark,
      state: String(device.state ?? 'live'),
      stateLabel: state.label,
      stateMark: state.mark,
      timer: num(device.timer, 0),
      timerSeconds: round(num(device.timer, 0), 1),
      x: num(device.x, 0),
      z: num(device.z, 0),
      to: device.to && typeof device.to === 'object' ? {x: num(device.to.x, 0), z: num(device.to.z, 0)} : null,
      channel,
      text: `${kind.label} · ${state.label}`,
    };
  });
  const depots = (Array.isArray(raw.depots) ? raw.depots : []).filter(Boolean).map(depot => {
    const owner = depot.owner === 0 || depot.owner === 1 ? Number(depot.owner) : null;
    const progress = Array.isArray(depot.progress) ? depot.progress : [0, 0];
    const contested = depot.contested === true;
    const myProgress = team === null ? Math.max(num(progress[0], 0), num(progress[1], 0)) : num(progress[team], 0);
    const ownerLabel = cocsDepotOwnerLabel(owner, team, contested);
    const vehicle = depot.vehicle && typeof depot.vehicle === 'object' ? depot.vehicle : {};
    const live = num(vehicle.health, 0) > 0;
    const respawn = Math.max(0, num(vehicle.respawn, 0));
    const available = owner === team && live;
    const vehicleState = available ? 'READY' : live ? 'ENEMY' : respawn > 0 ? `RETURN ${round(respawn, 1)}s` : owner !== null ? 'SPAWNING' : 'NONE';
    return {
      id: String(depot.id),
      lane: depot.lane ?? null,
      hq: depot.hq === true,
      label: depot.hq === true ? 'HQ DEPOT' : 'FWD DEPOT',
      mark: depot.hq === true ? '⌂' : '⬡',
      x: num(depot.x, 0),
      z: num(depot.z, 0),
      owner,
      ownerLabel,
      contested,
      mine: owner !== null && team !== null && owner === team,
      enemy: owner !== null && team !== null && owner !== team,
      myProgress,
      capturePercent: Math.round(Math.max(0, Math.min(1, myProgress)) * 100),
      vehicle: {id: vehicle.id ?? null, health: num(vehicle.health, 0), live, respawn, respawnSeconds: round(respawn, 1), available, state: vehicleState},
      text: `${depot.hq === true ? 'HQ' : 'FWD'} DEPOT · ${ownerLabel}${!contested && myProgress > 0 ? ` ${Math.round(Math.max(0, Math.min(1, myProgress)) * 100)}%` : ''}`,
    };
  });
  const arrivals = (Array.isArray(raw.arrivals) ? raw.arrivals : []).filter(Boolean).map(entry => ({
    actor: entry.actor,
    remaining: num(entry.remaining, 0),
    remainingSeconds: round(num(entry.remaining, 0), 1),
    x: num(entry.x, 0),
    z: num(entry.z, 0),
    telegraph: entry.telegraph === true,
  }));
  const channelDevice = devices.find(device => device.channel) ?? null;
  const channel = channelDevice?.channel ?? null;
  const ownDepot = depots.find(depot => depot.mine) ?? null;
  const targetDepot = depots.find(depot => !depot.mine && !depot.contested && depot.capturePercent > 0)
    ?? depots.find(depot => depot.ownerLabel === 'NEUTRAL')
    ?? null;
  let context = 'TRAVERSAL NOMINAL';
  if (channelDevice) context = `${channel.label} ${channelDevice.label} · ${channel.remainingSeconds}s`;
  else if (arrivals.length) context = `ARRIVAL PROTECTION · ${arrivals[0].remainingSeconds}s`;
  else if (targetDepot) context = `${targetDepot.label} · ${targetDepot.ownerLabel}${targetDepot.capturePercent > 0 ? ` ${targetDepot.capturePercent}%` : ''}`;
  else if (ownDepot) context = `${ownDepot.label} · LOANER ${ownDepot.vehicle.state}`;
  else if (devices.length) context = `${devices[0].label} · ${devices[0].stateLabel}`;
  return {
    team,
    devices,
    depots,
    arrivals,
    deviceCount: devices.length,
    depotCount: depots.length,
    arrivalActive: arrivals.length > 0,
    arrivalSeconds: arrivals.length ? Math.max(...arrivals.map(entry => entry.remainingSeconds)) : 0,
    channel,
    channelDevice,
    ownDepot,
    targetDepot,
    context,
    interactKey: cocsInteractKey(options),
    prompt: cocsDevicePrompt(devices, player, options),
    depotPrompt: cocsDepotPrompt(depots, player),
  };
}

// ---------------------------------------------------------------------------
// O1c — the command board (design §5.1/§5.4/§5.8), between-wave spend window
// (§5.2 of COCS-OPERATIONS) and terminals/roles (§12.3a). Everything here is a
// pure read of the frozen snapshot plus the already-derived `board`; the UI
// components are dumb renderers. Card telemetry is still thin on the sim side,
// so the derivations below prefer an explicit `snapshot.cards` (or
// `snapshot.command.cards`) array when a future wave exposes one and otherwise
// synthesise the exception list from the signals that already exist: the order
// log, the live scout, the traversal channel, terminals and the command gates.
// ---------------------------------------------------------------------------

/** The board never takes more than 42% of the viewport width (spec §5.4). */
export const COCS_BOARD_WIDTH_PERCENT = 42;
/** At most 6–8 cards on the face; everything else is a count behind an expander. */
export const COCS_BOARD_VISIBLE_CARDS = 8;
export const COCS_BOARD_MIN_VISIBLE_CARDS = 6;
export const COCS_BOARD_SECTION_LABELS = Object.freeze({needs: 'NEEDS YOU', running: 'RUNNING', done: 'DONE'});
/** One vocabulary, everywhere: queued | running | blocked | done (§5.2). */
export const COCS_BOARD_STATUS = Object.freeze({
  queued: Object.freeze({label: 'QUEUED', mark: '◷'}),
  running: Object.freeze({label: 'RUNNING', mark: '▶'}),
  blocked: Object.freeze({label: 'BLOCKED', mark: '⚠'}),
  done: Object.freeze({label: 'DONE', mark: '✔'}),
});
/** One blocker reason vocabulary (§5.1). */
export const COCS_BLOCKER_LABELS = Object.freeze({
  contested: 'CONTESTED',
  'no-relay': 'NO RELAY',
  'out-of-flux': 'OUT OF FLUX',
  'no-thread': 'NO THREAD',
  dependency: 'DEPENDENCY',
});
const COCS_BOARD_VERB_MARKS = Object.freeze({
  SCAN: '⌖', MOVE: '➤', HOLD: '⛨', ATTACK: '⚔', BUILD: '⚒',
  FORTIFY: '▤', REPAIR: '✚', RESUPPLY: '⇪', REINFORCE: '✦',
  HACK: '⌨', DEPLOY: '◱', VAULT: '▣',
});
const COCS_AGENT_LABELS = Object.freeze({
  scrapper: 'SCRAPPER', adept: 'ADEPT', oracle: 'ORACLE',
  scout: 'SCOUT', fighter: 'FIGHTER', harvester: 'HARVESTER', builder: 'BUILDER', saboteur: 'SABOTEUR', chief: 'CHIEF',
});
// §8.1 role glyphs for the synthesized (object-shaped) role surface. An
// explicit array keeps whatever mark it carries.
const COCS_ROLE_MARKS = Object.freeze({fighter: '⚔', harvester: '⛏', builder: '⚒', scout: '⌖'});
const COCS_BOARD_STATUS_IDS = Object.freeze(['queued', 'running', 'blocked', 'done']);
const COCS_BOARD_BLOCKER_IDS = Object.freeze(Object.keys(COCS_BLOCKER_LABELS));
const COCS_TERMINAL_KINDS = Object.freeze({
  HACK: Object.freeze({label: 'HACK', mark: '⌨', prompt: 'HACK THE RELAY'}),
  DEPLOY: Object.freeze({label: 'DEPLOY', mark: '◱', prompt: 'DEPLOY THE BEACON'}),
  VAULT: Object.freeze({label: 'VAULT', mark: '▣', prompt: 'CRACK THE VAULT'}),
  SABOTAGE: Object.freeze({label: 'SABOTAGE', mark: '✂', prompt: 'CUT THE SUPPLY LINK'}),
});
const COCS_TERMINAL_STATES = Object.freeze({
  locked: Object.freeze({label: 'LOCKED', mark: '▣'}),
  available: Object.freeze({label: 'AVAILABLE', mark: '▷'}),
  active: Object.freeze({label: 'ACTIVE', mark: '◈'}),
  complete: Object.freeze({label: 'COMPLETE', mark: '✔'}),
  blocked: Object.freeze({label: 'BLOCKED', mark: '⚠'}),
  contested: Object.freeze({label: 'CONTESTED', mark: '⚑'}),
});

const clamp01 = value => Math.max(0, Math.min(1, num(value, 0)));
const cocsBoardCostPips = (cost, flux) => {
  const c = num(cost, 0);
  if (c <= 0) return 0;
  const pool = Math.max(1, num(flux, 0));
  return Math.max(1, Math.min(5, Math.ceil((c / pool) * 5)));
};
const boardStatusId = value => (COCS_BOARD_STATUS_IDS.includes(String(value)) ? String(value) : 'queued');
const boardBlockerId = value => (COCS_BOARD_BLOCKER_IDS.includes(String(value)) ? String(value) : 'dependency');

/**
 * Normalize one card. `options.cards` / `snapshot.cards` entries already in the
 * card schema pass straight through with defaults filled in.
 */
function cocsBoardCard(input, ctx = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const verb = String(source.verb ?? 'HOLD').toUpperCase();
  const status = boardStatusId(source.status);
  const blocker = status === 'blocked' ? boardBlockerId(source.blocker) : null;
  const cost = num(source.cost, 0);
  const flux = num(ctx.flux, 0);
  const target = source.target ?? null;
  return {
    id: String(source.id ?? `${verb}-${target ?? 'team'}`),
    verb,
    verbMark: COCS_BOARD_VERB_MARKS[verb] ?? '●',
    target,
    targetLabel: String(source.targetLabel ?? source.label ?? (target === null ? 'TEAM' : latticeNodeLabel({id: target}, null))),
    agent: String(source.agent ?? 'chief').toLowerCase(),
    agentLabel: source.agentLabel ?? COCS_AGENT_LABELS[String(source.agent ?? 'chief').toLowerCase()] ?? String(source.agent ?? 'CHIEF').toUpperCase(),
    cost,
    costPips: num(source.costPips, cocsBoardCostPips(cost, flux)),
    status,
    statusLabel: COCS_BOARD_STATUS[status].label,
    statusMark: COCS_BOARD_STATUS[status].mark,
    blocker,
    blockerLabel: blocker ? COCS_BLOCKER_LABELS[blocker] : null,
    reason: source.reason ?? (blocker ? COCS_BLOCKER_LABELS[blocker] : null),
    nextAction: source.nextAction ? String(source.nextAction) : null,
    etaSeconds: round(num(source.etaSeconds ?? source.eta, 0), 1),
    owner: source.owner ?? null,
    repeat: Math.max(0, Math.floor(num(source.repeat, 0))),
    impact: String(source.impact ?? ''),
    focus: Math.max(0, Math.min(100, num(source.focus, 0))),
    confidence: ['good', 'fair', 'poor'].includes(source.confidence) ? source.confidence : null,
    dep: source.dep ?? null,
  };
}

const COCS_ORDER_FAIL_REASONS = Object.freeze({
  contested: 'contested', 'no-relay': 'no-relay', flux: 'out-of-flux', 'out-of-flux': 'out-of-flux',
  slice: 'out-of-flux', allowance: 'out-of-flux', executor: 'no-thread', thread: 'no-thread',
  'no-thread': 'no-thread', dependency: 'dependency', target: 'dependency',
});

const cocsNodeLabel = (board, id) => {
  if (id === null || id === undefined) return 'TEAM';
  const node = (board?.nodes ?? []).find(entry => String(entry?.id) === String(id));
  return node?.label ?? latticeNodeLabel({id}, null);
};

/** Pull an explicit card array from any of the places a wave may expose it. */
function cocsExplicitCards(snapshot, options) {
  for (const candidate of [options?.cards, snapshot?.cards, snapshot?.command?.cards, snapshot?.director?.cards]) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return null;
}

// `options.orders` carries the same event/log shapes the strip consumes, so a
// local match whose snapshot publishes only `orderStats` can still show the
// authoritative queue. An accepted order reads RUNNING (never DONE) until a
// completion event arrives; a refusal reads BLOCKED with its next action.
function cocsOrderCards(snapshot, board, options = {}) {
  const candidate = Array.isArray(options?.orders) ? options.orders
    : Array.isArray(snapshot?.orderLog) ? snapshot.orderLog
      : Array.isArray(snapshot?.command?.orderLog) ? snapshot.command.orderLog : [];
  return candidate.filter(Boolean).slice(-8).map((entry, index) => {
    const type = String(entry.type ?? '');
    const refused = entry.ok === false || entry.status === 'refused' || type === 'cocs-order-rejected';
    const complete = !refused && (entry.complete === true || entry.status === 'complete' || type === 'cocs-order-complete');
    const verb = String(entry.verb ?? 'HOLD').toUpperCase();
    const target = entry.target ?? entry.node ?? null;
    const reason = String(entry.reason ?? '');
    const blocker = refused ? (COCS_ORDER_FAIL_REASONS[reason] ?? 'dependency') : null;
    const status = complete ? 'done' : refused ? 'blocked' : 'running';
    return {
      id: `order-${entry.cardId ?? `${verb}-${target}-${index}`}`,
      verb,
      target,
      targetLabel: cocsNodeLabel(board, target),
      agent: verb === 'SCAN' ? 'scout' : 'chief',
      status,
      blocker,
      reason: refused && reason ? reason.toUpperCase() : refused ? COCS_BLOCKER_LABELS[blocker] : null,
      nextAction: cocsOrderNextAction(reason, verb, complete ? 'complete' : refused ? 'refused' : 'accepted'),
      impact: complete ? 'COMPLETE' : refused ? 'REFUSED' : 'ACCEPTED · IN PROGRESS',
      owner: entry.peerId ?? null,
    };
  });
}

/**
 * Derive the 3-section exception list (§5.1). Prefers an explicit card array;
 * otherwise synthesises from the order log, scout, traversal channel, terminals
 * and the shared command gates. Pure: no clock, no RNG.
 */
export function cocsBoardView(board, snapshot, player, options = {}) {
  if (!board || !snapshot || typeof snapshot !== 'object') return null;
  const economy = options.economy ?? null;
  const traversal = options.traversal ?? cocsTraversalView(snapshot, player);
  const terminals = options.terminals ?? cocsTerminalView(snapshot, player, board);
  const flux = num(economy?.flux, num(snapshot?.flux?.[player?.team === 1 ? 1 : 0], 0));
  const command = snapshot.command && typeof snapshot.command === 'object' ? snapshot.command : null;
  const ctx = {flux};
  const explicit = cocsExplicitCards(snapshot, options);
  const raw = explicit ? [...explicit] : [...cocsOrderCards(snapshot, board, options)];

  if (!explicit) {
    // RUNNING: the live scout and any traversal channel.
    if (economy?.scout?.alive) {
      const scout = economy.scout;
      raw.push({
        id: 'scout', verb: 'SCAN', target: scout.node, agent: 'scout',
        targetLabel: cocsNodeLabel(board, scout.node),
        status: scout.idle ? 'blocked' : 'running',
        blocker: scout.idle ? 'out-of-flux' : null,
        reason: scout.idle ? 'AGENT IDLE' : null,
        etaSeconds: 0,
      });
    }
    if (traversal?.channelDevice && traversal.channel) {
      raw.push({
        id: `channel-${traversal.channelDevice.id}`, verb: 'BUILD', target: traversal.channelDevice.id,
        agent: 'builder', targetLabel: traversal.channelDevice.label,
        status: 'running', etaSeconds: traversal.channel.remainingSeconds,
      });
    }
    for (const terminal of terminals?.terminals ?? []) {
      if (terminal.state === 'active') raw.push({
        id: `terminal-${terminal.id}`, verb: terminal.kind, target: terminal.id, agent: 'adept',
        targetLabel: terminal.label, status: 'running',
      });
      else if (terminal.state === 'contested' || terminal.state === 'blocked') raw.push({
        id: `terminal-${terminal.id}`, verb: terminal.kind, target: terminal.id, agent: 'adept',
        targetLabel: terminal.label, status: 'blocked', blocker: terminal.state === 'contested' ? 'contested' : 'dependency',
        reason: terminal.stateLabel,
      });
    }
    // NEEDS YOU: the shared gates. Only surface one card per gate. PvP-1 reads
    // the player's own team board (per-team THREADS) when the rung is live;
    // co-op falls back to the flat `command.threads` it always had.
    const boardTeam = player?.team === 1 ? 1 : 0;
    const roleThreads = snapshot?.roleBoard?.[boardTeam]?.threads ?? null;
    const threadsCap = num(roleThreads?.cap, num(command?.threads?.cap, 0));
    const threadsUsed = num(roleThreads?.used, num(command?.threads?.used, 0));
    const front = board.front;
    if (threadsCap > 0 && threadsUsed >= threadsCap) raw.push({
      id: 'gate-threads', verb: 'HOLD', target: front?.id ?? null, agent: 'scrapper',
      targetLabel: front?.label ?? 'TEAM', status: 'blocked', blocker: 'no-thread', reason: 'NO THREAD',
      impact: `THREADS ${threadsUsed}/${threadsCap}`,
    });
    if (flux <= 0) raw.push({
      id: 'gate-flux', verb: 'HOLD', target: front?.id ?? null, agent: 'scrapper',
      targetLabel: front?.label ?? 'TEAM', status: 'blocked', blocker: 'out-of-flux', reason: 'OUT OF FLUX',
    });
    if (front?.contested && !front.mine) raw.push({
      id: `gate-contested-${front.id}`, verb: 'HOLD', target: front.id, agent: 'fighter',
      targetLabel: front.label, status: 'blocked', blocker: 'contested', reason: 'CONTESTED',
      impact: `${front.progressPercent}% CAPTURED`,
    });
    // DONE: the completed-order tally, so the expander has real rows.
    const completed = Math.max(0, Math.floor(num(snapshot?.orderStats?.completed, 0)));
    for (let i = 0; i < completed; i++) raw.push({
      id: `done-${i}`, verb: 'HOLD', target: null, agent: 'chief', targetLabel: 'COMPLETED WORK', status: 'done',
    });
  }

  const cards = raw.filter(Boolean).map(card => cocsBoardCard(card, ctx));
  const needs = cards.filter(card => card.status === 'blocked');
  const running = cards.filter(card => card.status === 'running' || card.status === 'queued');
  const done = cards.filter(card => card.status === 'done');
  const visibleNeeds = needs.slice(0, COCS_BOARD_VISIBLE_CARDS);
  const runningRoom = Math.max(0, COCS_BOARD_VISIBLE_CARDS - visibleNeeds.length);
  const visibleRunning = running.slice(0, runningRoom);
  const doneRoom = Math.max(0, runningRoom - visibleRunning.length);
  const visibleDone = done.slice(0, doneRoom);
  const section = (id, list, visible) => ({
    id, label: COCS_BOARD_SECTION_LABELS[id], count: list.length,
    cards: visible, hidden: Math.max(0, list.length - visible.length),
    expandable: list.length > visible.length,
  });
  const sections = [section('needs', needs, visibleNeeds), section('running', running, visibleRunning), section('done', done, visibleDone)];
  const visibleCards = sections.flatMap(entry => entry.cards);
  return {
    widthPercent: COCS_BOARD_WIDTH_PERCENT,
    maxVisible: COCS_BOARD_VISIBLE_CARDS,
    sections,
    cards,
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
    hint: board.hint,
    front: board.front ? {id: board.front.id, label: board.front.label, ownerLabel: board.front.ownerLabel} : null,
  };
}

/** `aria-live` "Needs you" sentence for the board (§12.9). */
export function cocsBoardAnnouncement(view) {
  if (!view) return '';
  const needs = view.sections.find(section => section.id === 'needs');
  const count = needs?.count ?? 0;
  if (!count) return 'Needs you: none.';
  const first = needs.cards[0] ?? view.cards.find(card => card.status === 'blocked') ?? null;
  const detail = first ? `${first.verb} ${first.targetLabel} blocked: ${first.blockerLabel ?? first.reason ?? 'BLOCKED'}` : 'blocked work';
  return `Needs you: ${count}. ${detail}.`;
}

/** Keyboard listbox state for the board (§5.4: pointer-locked nav is keyboard-only). */
export function cocsBoardListbox(view) {
  const ids = view?.listboxIds ?? [];
  return {index: 0, activeId: ids[0] ?? null, count: ids.length};
}
export function cocsBoardMove(state, delta, length) {
  const count = Math.max(0, Math.floor(num(length, state?.count ?? 0)));
  if (!count) return {index: 0, activeId: null, count: 0};
  const from = Math.max(0, Math.min(count - 1, num(state?.index, 0)));
  const index = ((from + num(delta, 0)) % count + count) % count;
  return {index, activeId: state?.ids?.[index] ?? null, count};
}
export function cocsBoardSetActive(state, index, length) {
  const count = Math.max(0, Math.floor(num(length, state?.count ?? 0)));
  if (!count) return {index: 0, activeId: null, count: 0};
  const clamped = Math.max(0, Math.min(count - 1, Math.floor(num(index, 0))));
  return {index: clamped, activeId: state?.ids?.[clamped] ?? null, count};
}

/** Reduced-motion contract for the board/spend surfaces: snap, never animate. */
export function cocsBoardMotion(reduced) {
  const snap = reduced === true;
  return {reduced: snap, snap, transitionSeconds: snap ? 0 : 0.18, sweep: !snap, flashRateCapHz: 2};
}

// ---------------------------------------------------------------------------
// Between-wave spend window (COCS-OPERATIONS §5.2 / design §3.3).
// ---------------------------------------------------------------------------
function cocsAllowance(command, player, budget) {
  const humans = Math.max(0, Math.floor(num(command?.humans, 0)));
  const perPlayer = Math.max(0, Math.floor(num(command?.slicePerPlayer, 0))) || Math.max(1, humans);
  const team = player?.team === 0 || player?.team === 1 ? Number(player.team) : 0;
  const raw = command?.slices;
  const peer = String(player?.peerId ?? player?.id ?? '');
  let entry = null;
  if (Array.isArray(raw)) entry = raw.find(slice => slice && String(slice.peerId ?? slice.playerId ?? slice.id) === peer) ?? raw[team] ?? raw[0] ?? null;
  else if (raw && typeof raw === 'object') entry = raw[peer] ?? raw[team] ?? null;
  const allowance = entry ? num(entry.allowance, 0) : Math.floor(num(budget, 0) / Math.max(1, perPlayer));
  return {
    humans,
    perPlayer,
    team,
    allowance,
    cap: entry ? num(entry.cap, allowance) : perPlayer,
    remaining: entry ? num(entry.remaining ?? entry.allowance, allowance) : allowance,
    playerId: entry ? String(entry.peerId ?? entry.playerId ?? peer) : null,
  };
}

/**
 * The intermission spend window as a pure read. `null` outside co-op or before a
 * window exists, which keeps the panel mode-isolated. `sinks[].reason` is the
 * single disable explanation the UI renders (never colour-only).
 */
export function cocsSpendView(snapshot, player) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const director = snapshot.director;
  if (!director || typeof director !== 'object') return null;
  const intermission = director.intermission;
  if (!intermission || typeof intermission !== 'object') return null;
  const command = snapshot.command && typeof snapshot.command === 'object' ? snapshot.command : null;
  const tick = num(snapshot.tick, 0);
  const open = intermission.open === true;
  const budget = num(intermission.budget, num(snapshot.flux?.[0], 0));
  const allowance = cocsAllowance(command, player, budget);
  const sinks = (Array.isArray(intermission.sinks) ? intermission.sinks : []).filter(Boolean).map(sink => {
    const verb = String(sink.verb ?? sink.id ?? '').toUpperCase();
    const cost = num(sink.cost, 0);
    const available = sink.available !== false;
    const affordable = sink.affordable !== false && budget + 1e-9 >= cost;
    // The sim is the authority on the gate. A wave that publishes an explicit
    // slice enforcement flag (W21+) lets the HUD pre-block an overslice spend;
    // until then the allowance is surfaced as an indicator only.
    const sliceEnforced = command?.enforceSlices === true || sink.sliceEnforced === true || sink.sliceBlocked === true;
    const sliceBlocked = sliceEnforced && allowance.cap > 0 && cost > allowance.remaining + 1e-9;
    let reason = null;
    if (!open) reason = 'WINDOW CLOSED';
    else if (!available) reason = 'NOT AVAILABLE';
    else if (!affordable) reason = 'FLUX LOW';
    else if (sliceBlocked) reason = 'SLICE LOW';
    return {
      verb, id: String(sink.id ?? sink.verb ?? verb), label: String(sink.label ?? verb),
      cost, target: sink.target ?? 'team', description: String(sink.description ?? ''),
      available, affordable, sliceBlocked,
      enabled: open && available && affordable && !sliceBlocked,
      reason,
      effect: String(sink.description ?? sink.effect ?? ''),
    };
  });
  const executorId = command?.executor ?? command?.lease?.executor ?? null;
  const leaseUntil = command?.leaseUntil ?? command?.lease?.until ?? command?.lease?.leaseUntil ?? null;
  const leaseSeconds = leaseUntil !== null && Number.isFinite(Number(leaseUntil))
    ? round(Math.max(0, (Number(leaseUntil) - tick) * TICK_SECONDS), 1)
    : round(Math.max(0, num(command?.lease?.secondsRemaining ?? command?.executorSeconds, 0)), 1);
  const executorName = command?.executorName ?? command?.lease?.name ?? null;
  const you = executorId !== null && executorId !== undefined && player
    && (String(executorId) === String(player.peerId ?? player.id) || (player.name && String(executorId) === String(player.name)));
  const threadsUsed = num(command?.threads?.used, 0);
  const threadsCap = num(command?.threads?.cap, 0);
  const threadsPerPlayer = threadsCap > 0 && allowance.humans > 0 ? Math.ceil(threadsCap / allowance.humans) : threadsCap;
  return {
    open,
    secondsRemaining: round(num(intermission.secondsRemaining, 0), 1),
    totalSeconds: Math.max(1, num(intermission.totalSeconds, directorTier(snapshot?.director?.tier).intermissionSeconds)),
    budget: round(budget, 1),
    spent: round(num(intermission.spent, 0), 1),
    windows: num(intermission.windows, 0),
    byType: {
      FORTIFY: num(intermission.byType?.FORTIFY, 0), REPAIR: num(intermission.byType?.REPAIR, 0),
      RESUPPLY: num(intermission.byType?.RESUPPLY, 0), REINFORCE: num(intermission.byType?.REINFORCE, 0),
    },
    log: (Array.isArray(intermission.log) ? intermission.log : []).slice(-4).map(entry => ({...entry})),
    sinks,
    allowance,
    threads: {used: threadsUsed, cap: threadsCap, perPlayer: threadsPerPlayer},
    executor: {
      id: executorId, name: executorName,
      label: executorId === null || executorId === undefined ? 'CHIEF' : (executorName ?? (String(executorId) === 'chief' ? 'CHIEF' : String(executorId))),
      chief: executorId === null || executorId === undefined || String(executorId) === 'chief',
      you: Boolean(you),
      secondsRemaining: leaseSeconds,
    },
    canSpend: open && sinks.some(sink => sink.enabled),
    canAffordAny: sinks.some(sink => sink.affordable),
  };
}

// ---------------------------------------------------------------------------
// Terminals + the extra role surface (§12.3a: HACK / DEPLOY / VAULT).
// ---------------------------------------------------------------------------
function cocsTerminalList(snapshot) {
  for (const candidate of [snapshot?.terminals, snapshot?.coop?.terminals, snapshot?.director?.terminals, snapshot?.traversal?.terminals, snapshot?.command?.terminals]) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}
function cocsRoleList(snapshot) {
  const candidates = [snapshot?.roles, snapshot?.coop?.roles, snapshot?.command?.roles, snapshot?.director?.roles];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  // W21 publishes roles as an object `{threads, byRole, spawned, stats, agents}`.
  // Synthesize the flat UI list from it so the panel is never dark.
  for (const candidate of candidates) {
    const normalized = cocsRolesFromObject(candidate);
    if (normalized.length) return normalized;
  }
  return [];
}

/**
 * Normalize the object-shaped role surface into the UI's `{id,label,mark,state,
 * stateLabel,count,cap,detail}` entries: one per role, live `agents` supplying
 * `count` and the cumulative `byRole` tally supplying `cap`. Pure and sorted.
 */
function cocsRolesFromObject(roles) {
  if (!roles || typeof roles !== 'object') return [];
  const agents = Array.isArray(roles.agents) ? roles.agents.filter(Boolean) : [];
  const byRole = roles.byRole && typeof roles.byRole === 'object' ? roles.byRole : {};
  const ids = [];
  for (const id of Object.keys(byRole)) if (!ids.includes(id)) ids.push(id);
  for (const agent of agents) {
    const id = String(agent.role ?? '');
    if (id && !ids.includes(id)) ids.push(id);
  }
  ids.sort((a, b) => String(a).localeCompare(String(b)));
  return ids.map(id => {
    const live = agents.filter(agent => String(agent.role) === id && num(agent.health, 0) > 0);
    const count = live.length;
    const spawned = Math.max(count, Math.floor(num(byRole[id], count)));
    const idle = count > 0 && live.every(agent => agent.idle === true);
    const state = count > 0 ? (idle ? 'idle' : 'active') : spawned > 0 ? 'down' : 'ready';
    const nodes = [...new Set(live.map(agent => agent.nodeId).filter(value => value !== null && value !== undefined))].sort((a, b) => String(a).localeCompare(String(b)));
    const detail = state === 'active' ? `${count} LIVE${nodes.length ? ` · ${nodes[0]}` : ''}`
      : state === 'idle' ? `${count} IDLE`
        : state === 'down' ? 'REBUILDING'
          : '';
    return {
      id,
      label: COCS_AGENT_LABELS[id] ?? id.toUpperCase(),
      mark: COCS_ROLE_MARKS[id] ?? '◆',
      state,
      stateLabel: state.toUpperCase(),
      count,
      cap: spawned,
      detail,
    };
  });
}
const cocsTerminalKind = kind => COCS_TERMINAL_KINDS[String(kind ?? '').toUpperCase()] ?? {label: String(kind ?? 'TERMINAL').toUpperCase(), mark: '◆', prompt: 'USE TERMINAL'};
const cocsTerminalState = state => COCS_TERMINAL_STATES[String(state ?? '').toLowerCase()] ?? {label: String(state ?? 'LOCKED').toUpperCase(), mark: '▣'};

// Which terminal verb the `interact` edge would run for the local actor right
// now. Mirrors `humanTerminalInteract`: DEPLOY only on your own node, VAULT
// (store), HACK/SABOTAGE on a live terminal.
function cocsTerminalActionable(terminal, verb) {
  if (verb === 'DEPLOY') return terminal.mine === true;
  if (verb === 'VAULT') return true;
  if (verb === 'HACK' || verb === 'SABOTAGE') return terminal.state === 'available';
  return false;
}

function cocsTerminalPrompt(terminals, player, options) {
  if (!finite(player?.x) || !finite(player?.z)) return null;
  let chosen = null;
  let chosenDistance = Infinity;
  let chosenRank = Infinity;
  for (const terminal of terminals) {
    if (!finite(terminal.x) || !finite(terminal.z)) continue;
    const d = Math.hypot(player.x - terminal.x, player.z - terminal.z);
    if (!(d <= COCS_INTERACT_REACH_METERS)) continue;
    if (!cocsTerminalActionable(terminal, terminal.kind)) continue;
    const rank = COCS_TERMINAL_VERB_ORDER.indexOf(terminal.kind);
    if (chosen === null || d < chosenDistance - 1e-9 || (Math.abs(d - chosenDistance) <= 1e-9 && rank < chosenRank)) {
      chosen = terminal;
      chosenDistance = d;
      chosenRank = rank;
    }
  }
  if (!chosen) return null;
  const distance = cocsDistance(chosenDistance);
  return {
    source: 'terminal',
    id: chosen.id,
    kind: chosen.kind,
    label: chosen.label,
    mark: chosen.kindMark,
    verb: chosen.kind,
    key: cocsInteractKey(options),
    distance,
    distanceMeters: distance,
    state: chosen.state,
    stateLabel: chosen.stateLabel,
    channelPercent: chosen.progressPercent,
    owner: chosen.owner,
    mine: chosen.mine,
    enemy: chosen.enemy,
    hint: chosen.hint,
    text: `${chosen.kind} ${chosen.label}`,
  };
}

/**
 * Terminal prompts/states for HACK / DEPLOY / VAULT plus whatever role surface a
 * future wave exposes. Every entry carries a shape glyph *and* a word so state
 * is never colour-only. `hasTerminals` is what the HUD gates on.
 */
export function cocsTerminalView(snapshot, player, board, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const team = player?.team === 0 || player?.team === 1 ? Number(player.team) : null;
  const terminals = cocsTerminalList(snapshot).filter(Boolean).map((raw, index) => {
    const kind = cocsTerminalKind(raw.kind ?? raw.type ?? raw.verb);
    const stateId = String(raw.state ?? (raw.complete === true ? 'complete' : raw.active === true ? 'active' : raw.locked === true ? 'locked' : 'available')).toLowerCase();
    const state = cocsTerminalState(stateId);
    const owner = raw.owner === 0 || raw.owner === 1 ? Number(raw.owner) : null;
    const progress = clamp01(raw.progress ?? (num(raw.total, 0) > 0 ? 1 - num(raw.remaining, 0) / num(raw.total, 0) : 0));
    const id = String(raw.id ?? `${kind.label}-${index}`);
    return {
      id, kind: kind.label, kindMark: kind.mark, prompt: kind.prompt,
      label: String(raw.label ?? raw.name ?? `${kind.label} ${index + 1}`),
      nodeId: raw.nodeId ?? raw.node ?? null,
      x: num(raw.x, NaN), z: num(raw.z, NaN),
      state: stateId, stateLabel: state.label, stateMark: state.mark,
      owner, mine: owner !== null && team !== null && owner === team,
      enemy: owner !== null && team !== null && owner !== team,
      progress, progressPercent: Math.round(progress * 100),
      remainingSeconds: round(num(raw.remainingSeconds ?? raw.remaining, 0), 1),
      actor: raw.actor ?? raw.peerId ?? null,
      hint: String(raw.hint ?? kind.prompt),
      wired: raw.wired !== false,
    };
  });
  const roles = cocsRoleList(snapshot).filter(Boolean).map((raw, index) => {
    const id = String(raw.id ?? raw.role ?? raw.name ?? `role-${index}`);
    return {
      id, label: String(raw.label ?? raw.name ?? id).toUpperCase(),
      mark: String(raw.mark ?? '◆'),
      state: String(raw.state ?? 'ready').toLowerCase(),
      stateLabel: String(raw.stateLabel ?? raw.state ?? 'READY').toUpperCase(),
      count: num(raw.count, 0), cap: num(raw.cap, 0),
      detail: String(raw.detail ?? raw.description ?? ''),
    };
  });
  const active = terminals.filter(terminal => terminal.state === 'active').length;
  const available = terminals.filter(terminal => terminal.state === 'available').length;
  const blocked = terminals.filter(terminal => terminal.state === 'blocked' || terminal.state === 'contested' || terminal.state === 'locked').length;
  const boardHint = board?.front ? `AT ${board.front.label}` : null;
  return {
    hasTerminals: terminals.length > 0,
    count: terminals.length,
    active, available, blocked,
    terminals,
    roles,
    hasRoles: roles.length > 0,
    prompt: cocsTerminalPrompt(terminals, player, options),
    hint: terminals.length ? `${available} READY · ${active} ACTIVE · ${blocked} LOCKED` : (boardHint ?? 'NO TERMINALS'),
  };
}

/**
 * Fold the board, snapshot, player and strip state into the single object
 * `CocsReadout` renders. Returns null outside cocs (mode isolation). `board` is
 * `cocsBoard(hud, player)` so the HUD derivation stays in one place.
 */
export function cocsCommandView(board, snapshot, player, strip, options = {}) {
  if (!board || !snapshot || typeof snapshot !== 'object') return null;
  const economy = cocsEconomyView(snapshot, player);
  // F04: the strip uses the same legal-target model as the coach and board when
  // the caller has the graph (map/model/adjacency). Without it the picker keeps
  // its previous plausible-target narrowing, so existing callers are unchanged.
  const hasGraph = Boolean(options.model || options.map || options.graph || options.adjacency || options.edges
    || snapshot.adjacency || snapshot.edges || snapshot.cocs?.adjacency);
  const model = options.model ?? (hasGraph ? latticeTargetModel(snapshot, options.map, player, options) : null);
  const armed = strip?.armed ?? null;
  const nodes = cocsTargetableNodes(board, armed, {model, map: options.map});
  const nodeLabels = {};
  for (const node of (model?.nodes?.length ? model.nodes : board.nodes ?? [])) {
    nodeLabels[String(node.id)] = {label: node.label ?? latticeNodeLabel({id: node.id}, options.map), mark: node.mark, ownerLabel: node.ownerLabel};
  }
  const view = cocsStripView(strip, {
    tick: num(snapshot.tick, 0),
    flux: economy?.flux ?? 0,
    scanCost: COCS_SCAN_COST,
    nodes,
    nodeLabels,
    orders: options.orders,
  });
  const scanNode = economy?.scan?.nodeId ?? null;
  const scanLabel = scanNode === null || scanNode === undefined ? null : nodeLabels[String(scanNode)]?.label ?? latticeNodeLabel({id: scanNode}, options.map);
  const traversal = cocsTraversalView(snapshot, player, options);
  const terminals = cocsTerminalView(snapshot, player, board, options);
  // PvP-1 rung + own-team role board (section 3.1/§11.3). Null for co-op and
  // every non-laddered match, so the existing HUD stays mode-isolated.
  const team = economy?.team ?? (player?.team === 1 ? 1 : 0);
  const roleBoard = snapshot.roleBoard?.[team] ?? null;
  // Commander surface. PvP carries `snapshot.commander`; OPERATIONS carries the
  // same seat/votes/route/policy under `snapshot.command`. Both normalize to one
  // shape so the seat row and the stance row are mode-agnostic. `mine` is a
  // local hint (the client knows what it last took) — the sim seat itself is an
  // opaque peer id the client never learns about itself.
  const rawCommand = snapshot.commander ?? snapshot.command ?? null;
  const voteCount = value => Array.isArray(value) ? value.length : Math.max(0, num(value, 0));
  const commander = rawCommand ? {
    seat: rawCommand.seat?.[team] ?? null,
    route: rawCommand.route?.[team] ?? null,
    policy: rawCommand.policy?.[team] ?? null,
    votes: voteCount(rawCommand.votes?.[team]),
    mine: options.commandSeatMine === true,
    spectate: options.spectate === true,
  } : null;
  const policies = COCS_POLICY_OPTIONS.map(option => ({...option, active: commander?.policy === option.id}));
  return {
    board,
    model,
    economy,
    rung: snapshot.rung ?? null,
    roleBoard,
    commander,
    policies,
    spots: economy?.spots ?? [],
    scanTarget: {nodeId: scanNode ?? null, label: scanLabel, active: economy?.scan?.active === true},
    strip: view,
    traversal,
    director: cocsDirectorView(snapshot),
    spend: cocsSpendView(snapshot, player),
    // PvP-1 team FLUX purchases. Null for co-op (no role board) and for a
    // caller with no team; `spectate` hides the whole strip from viewers.
    purchases: cocsPurchaseView(snapshot, player, {flux: economy?.flux, spectate: options.spectate === true}),
    boardView: cocsBoardView(board, snapshot, player, {economy, traversal, terminals, orders: options.orders}),
    terminals,
    // The single nearest thing the `interact` bind would use: a §6A device
    // first, else an O1c terminal. `depotPrompt` is the separate capture/enter
    // hint, since depots deliberately do not ride the device bind.
    interactPrompt: traversal?.prompt ?? terminals?.prompt ?? null,
    depotPrompt: traversal?.depotPrompt ?? null,
  };
}
