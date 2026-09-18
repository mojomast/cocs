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
import {SUBAGENTS} from './cocs-economy.mjs';
import {RULES} from './data.mjs';

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

// The three tier-0 buttons. `id` is what the UI arms; `verb` is what the engine
// receives. Kept frozen so a caller can never rename a verb mid-match.
export const COCS_STRIP_BUTTONS = Object.freeze([
  Object.freeze({id: 'SCAN', verb: 'SCAN', label: 'SCAN', hint: 'Send the scout to scan a node'}),
  Object.freeze({id: 'GO', verb: 'HOLD', label: 'GO', hint: 'Hold or reinforce a node'}),
  Object.freeze({id: 'ATTACK', verb: 'ATTACK', label: 'ATTACK', hint: 'Take an enemy or neutral node'}),
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
 * index,...}` entries (1-based `index` = the number key). `HOLD` accepts your
 * own node or any live capturable; `ATTACK` only live capturable nodes you do
 * not own; `SCAN` accepts any capturable node. Snapshot nodes carry no
 * adjacency, so legality stays the engine's call and the strip only narrows to
 * targets that can plausibly work.
 */
export function cocsTargetableNodes(board, id) {
  const button = cocsStripButton(id);
  if (!button || !board) return [];
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

/** Advance the strip clock: a pending order files as issued once its window ends. */
export function cocsSyncStrip(state, ctx = {}) {
  const base = baseOf(state);
  const tick = num(ctx.tick, 0);
  if (base.pending && tick >= num(base.pendingUntil, 0)) {
    return {...base, issued: base.pending, pending: null};
  }
  return base;
}

const orderView = (order, nodeLabels = {}) => {
  if (!order) return null;
  const button = cocsStripButton(order.verb);
  const node = nodeLabels[String(order.target)] ?? null;
  return {
    verb: order.verb,
    label: button?.label ?? order.verb,
    target: order.target,
    targetLabel: node?.label ?? String(order.target),
    targetMark: node?.mark ?? '●',
    text: `${button?.label ?? order.verb} · ${node?.label ?? order.target}`,
  };
};

/**
 * The render model for the strip. `ctx`: `{tick, flux, scanCost, nodes,
 * nodeLabels, teamName}`. `disabled` is why a verb cannot be used; `canIssue`
 * is the single gate the confirm button reads.
 */
export function cocsStripView(state, ctx = {}) {
  const base = baseOf(state);
  const tick = num(ctx.tick, 0);
  const flux = num(ctx.flux, 0);
  const scanCost = num(ctx.scanCost, COCS_SCAN_COST);
  const nodes = Array.isArray(ctx.nodes) ? ctx.nodes : [];
  const nodeLabels = ctx.nodeLabels && typeof ctx.nodeLabels === 'object' ? ctx.nodeLabels : {};
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
    targetLabel: targetNode?.label ?? (base.target === null || base.target === undefined ? null : String(base.target)),
    buttons,
    nodes,
    maxTargets: COCS_STRIP_MAX_TARGETS,
    cooldown,
    cooldownSeconds: round(cooldown * TICK_SECONDS, 1),
    pending,
    issued,
    notice: base.notice ?? null,
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

/**
 * The team FLUX bar, personal REQ chip, order tally, scout card and scan target
 * as a pure view of `snapshot.cocs`. Null when the subtree is absent (every
 * non-cocs mode), which is what keeps the readout mode-isolated.
 */
export function cocsEconomyView(snapshot, player) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const team = player?.team === 0 || player?.team === 1 ? Number(player.team) : null;
  const value = team === null ? 0 : num(snapshot.flux?.[team], 0);
  const cap = num(snapshot.fluxCap, 0);
  const income = team === null ? 0 : num(snapshot.fluxIncome?.[team], 0);
  const upkeep = team === null ? 0 : num(snapshot.fluxUpkeep?.[team], 0);
  const spent = team === null ? 0 : num(snapshot.fluxSpent?.[team], 0);
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
    fronts: fronts.map(front => ({nodeId: front.nodeId, strength: num(front.strength, 0)})),
    telegraph: director.telegraph ? {kind: director.telegraph.kind, nodeId: director.telegraph.nodeId ?? null, seconds: num(director.telegraph.seconds, 0)} : null,
    boss: director.boss ? {actorId: director.boss.actorId, type: director.boss.type, phase: num(director.boss.phase, 1)} : null,
    retarget: director.retarget ? {nodeId: director.retarget.nodeId, reason: director.retarget.reason} : null,
    secondsRemaining: num(director.secondsRemaining, 0),
    siege: {
      armed: siege.armed === true,
      hqId: siege.hqId ?? 'hq-0',
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
 * Fold the board, snapshot, player and strip state into the single object
 * `CocsReadout` renders. Returns null outside cocs (mode isolation). `board` is
 * `cocsBoard(hud, player)` so the HUD derivation stays in one place.
 */
export function cocsCommandView(board, snapshot, player, strip) {
  if (!board || !snapshot || typeof snapshot !== 'object') return null;
  const economy = cocsEconomyView(snapshot, player);
  const armed = strip?.armed ?? null;
  const nodes = cocsTargetableNodes(board, armed);
  const nodeLabels = {};
  for (const node of board.nodes ?? []) nodeLabels[String(node.id)] = {label: node.label, mark: node.mark, ownerLabel: node.ownerLabel};
  const view = cocsStripView(strip, {
    tick: num(snapshot.tick, 0),
    flux: economy?.flux ?? 0,
    scanCost: COCS_SCAN_COST,
    nodes,
    nodeLabels,
  });
  const scanNode = economy?.scan?.nodeId ?? null;
  const scanLabel = scanNode === null || scanNode === undefined ? null : nodeLabels[String(scanNode)]?.label ?? String(scanNode);
  return {
    board,
    economy,
    spots: economy?.spots ?? [],
    scanTarget: {nodeId: scanNode ?? null, label: scanLabel, active: economy?.scan?.active === true},
    strip: view,
    director: cocsDirectorView(snapshot),
  };
}
