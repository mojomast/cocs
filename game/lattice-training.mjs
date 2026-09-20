// Pure, self-paced LATTICE lessons. Only the visible lesson collects evidence;
// a completed lesson stays visible until the player explicitly continues.
import {isCocsMode, normalizeConfig} from './config.mjs';
import {RULES} from './data.mjs';
import {directorTier} from './cocs-difficulty.mjs';
import {DEFAULT_BINDINGS, bindingLabel} from './keybinds.mjs';

const step = (id, title, detail, success) => Object.freeze({id, title, detail, success});
const shared = [
  step('move', 'MOVE OUT', 'Follow the link away from HQ. Travel 12 m from your starting point.', 'You can move between objectives. Next, practise your weapon.'),
  step('fire', 'LIVE FIRE', 'Fire five shots. Hits are optional: this lesson teaches the weapon controls.', 'Five shots fired. Reload before approaching the front.'),
  step('capture', 'TAKE YOUR FRONT', 'Stand in your front gate’s capture ring and clear enemies. Capture is automatic. If already owned, defend inside the ring for 3 seconds.', 'Front secured. Keeping its link home is what makes captured ground useful.'),
  step('connect', 'KEEP THE LINE', 'Keep an owned front, relay or siphon connected to your HQ for 3 seconds. Follow the supply-map links; an isolated node is not enough.', 'Supply confirmed. Connected ground earns team FLUX.'),
];
const order = step('order', 'ISSUE AN ORDER', 'Arm SCAN, GO/HOLD or ATTACK, choose a numbered target, then confirm. The lesson counts an accepted order, not a rejected attempt.', 'Order accepted. Your team now has a shared objective.');
const device = step('device', 'RIDE THE ROUTE', 'Find a traversal anchor and use it when the prompt says RIDE. CUT, LOCK and REPAIR do not count as a ride.', 'Route used. These shortcuts help you reinforce a threatened link.');
export const TRAINING_STEPS = Object.freeze({
  cocs: Object.freeze([...shared, order, device,
    step('depot', 'SECURE A DEPOT', 'Capture a neutral depot apron. If already owned, stand on it for 3 seconds. After securing it, the loaner vehicle is optional.', 'Depot secured. Use the vehicle prompt to enter the loaner, or continue on foot.'),
  ]),
  'cocs-coop': Object.freeze([...shared,
    step('spend', 'SPEND THE WINDOW', 'Wait for the between-wave spend window, then buy one available FORTIFY, REPAIR, RESUPPLY or REINFORCE action. If you missed it, wait for the next window.', 'Purchase confirmed. Spend windows turn team FLUX into support.'),
    order,
    step('terminal', 'USE A TERMINAL', 'Find a HACK, DEPLOY or SABOTAGE terminal and start its displayed action. Stay nearby and keep enemies away until your channel finishes.', 'Your terminal channel completed. Interrupted channels do not apply their effect.'),
    step('wave', 'HOLD THE WAVE', 'Help your team clear the next Director wave. Watch the HQ siege meter and fall back before a breach.', 'Wave cleared. Protecting HQ keeps the operation alive.'),
    device,
  ]),
});
export const TRAINING_TITLES = Object.freeze({cocs: 'LATTICE FIELD TRAINING', 'cocs-coop': 'OPERATIONS FIELD TRAINING'});
export const TRAINING_HOLD_SECONDS = 3;
const terminalEvents = ['cocs-terminal-hack', 'cocs-terminal-deploy', 'cocs-terminal-sabotage'];
const planFor = training => TRAINING_STEPS[training.mode] ?? TRAINING_STEPS.cocs;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nodesOf = snapshot => snapshot?.cocs?.nodes ?? snapshot?.nodes ?? [];
const localActor = (snapshot, playerId) => snapshot?.actors?.find(actor => actor?.id === playerId);
const distance = (a, b) => a && b && [a.x, a.z, b.x, b.z].every(finite) ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity;
const capturable = node => ['front', 'relay', 'economy'].includes(node?.archetype);

/** Predictable practice rules: only the display name is inherited from setup. */
export function trainingConfig(mode, {playerName = ''} = {}) {
  if (!isCocsMode(mode)) return null;
  return normalizeConfig({mode, playerName, botCount: mode === 'cocs' ? 3 : 1, difficulty: 'easy', timeLimit: 900});
}

/** `time` is match simulation time, never a wall clock.
 * @param {string} mode
 * @param {{start?: {x:number,z:number}|null, skipped?: boolean, time?: number}} [options]
 */
export function createTraining(mode, {start = null, skipped = false, time = 0} = {}) {
  if (!isCocsMode(mode)) return null;
  return {mode, title: TRAINING_TITLES[mode], index: 0, completed: [], counts: {},
    start: start && finite(start.x) && finite(start.z) ? {x: start.x, z: start.z} : null,
    phase: skipped ? 'skipped' : 'active', skipped: skipped === true, done: skipped === true,
    startedAt: time, lastTime: time, lastEventId: 0, hold: 0, goal: null, localChannels: []};
}

// Walk the entire owned supply chain; HQ/array links alone are not a front.
function ownedConnected(snapshot, lattice, team) {
  const nodes = nodesOf(snapshot), owned = new Map(nodes.filter(node => node.owner === team).map(node => [node.id, node]));
  const reached = new Set(nodes.filter(node => node.owner === team && node.archetype === 'hq').map(node => node.id));
  const queue = [...reached];
  for (const id of queue) for (const [a, b] of lattice) {
    const next = a === id ? b : b === id ? a : null;
    if (owned.has(next) && !reached.has(next)) { reached.add(next); queue.push(next); }
  }
  return [...reached].some(id => capturable(owned.get(id)));
}

function frontNode(snapshot, lattice, team, start) {
  const nodes = nodesOf(snapshot), homes = nodes.filter(node => node.owner === team && node.archetype === 'hq');
  const fronts = nodes.filter(node => node.archetype === 'front' && lattice.some(([a, b]) =>
    a === node.id && homes.some(home => home.id === b) || b === node.id && homes.some(home => home.id === a)));
  return fronts.sort((a, b) => distance(a, start) - distance(b, start))[0] ?? null;
}

const eventFor = (id, event, playerId, team, front) => {
  // An explicit actor/issuer always takes precedence over team membership.
  if (event.actor !== undefined && event.actor !== playerId) return false;
  if (event.team !== undefined && event.team !== team) return false;
  switch (id) {
    case 'fire': return event.type === 'shot' && event.actor === playerId;
    case 'capture': return event.type === 'cocs-capture' && event.team === team && event.node === front?.id && event.participants?.includes(playerId);
    case 'order': return event.type === 'cocs-order' && (event.peerId === undefined || String(event.peerId) === String(playerId));
    case 'device': return event.type === 'cocs-device-use' && event.actor === playerId;
    case 'depot': return event.type === 'cocs-depot-capture' && event.team === team;
    case 'spend': return event.type === 'coop-spend';
    case 'wave': return event.type === 'director-wave-cleared';
    case 'terminal': return terminalEvents.includes(event.type) && event.team === team;
    default: return false;
  }
};

const goalView = (value, target, label) => ({value: Math.min(target, Math.max(0, value)), target, label, ratio: Math.min(1, Math.max(0, value / target))});
const goalLabels = {fire: 'shots fired', capture: 'front secured', connect: 'seconds connected', order: 'order accepted', device: 'route used', depot: 'depot secured', spend: 'purchase confirmed', terminal: 'terminal action completed', wave: 'wave cleared'};

/** Evaluate one authoritative update. Repeated event IDs and pre-lesson events
 * are ignored. Completed lessons consume no evidence until continueTraining.
 * Snapshot is the real Match.snapshot() shape (including snapshot.cocs.nodes).
 */
export function evaluateTraining(training, {snapshot = null, events = [], playerId = 0, lattice = [], moveDistance = 12} = {}) {
  if (!training || training.done) return {training, completedNow: null};
  const now = finite(snapshot?.time) ? Math.max(training.lastTime, snapshot.time) : training.lastTime;
  let lastEventId = training.lastEventId;
  const fresh = [];
  for (const event of events) {
    if (!event || finite(event.id) && event.id <= lastEventId) continue;
    if (finite(event.id)) lastEventId = event.id;
    if (finite(event.time) && event.time <= training.startedAt) continue;
    fresh.push(event);
  }
  const base = {...training, lastTime: now, lastEventId};
  if (training.phase !== 'active') return {training: base, completedNow: null};
  const current = planFor(training)[training.index], id = current.id;
  const actor = localActor(snapshot, playerId), team = actor?.team ?? 0;
  const front = frontNode(snapshot, lattice, team, training.start);
  const terminals = snapshot?.cocs?.terminalState?.terminals ?? [];
  const localChannels = terminals.filter(terminal => terminal.channel?.actor === playerId).map(terminal => ({id: terminal.id, action: terminal.channel.action}));
  const counts = {...training.counts};
  for (const event of fresh) if (eventFor(id, event, playerId, team, front)) {
    // Completion events are team-wide. Attribute a terminal effect to the
    // local channel observed on the previous beat, never to a teammate's use.
    if (id === 'terminal' && !(training.localChannels ?? []).some(channel => channel.id === event.terminal && `cocs-terminal-${channel.action.toLowerCase()}` === event.type)) continue;
    // Depot events lack participants: require the local actor on the apron.
    if (id === 'depot') {
      const depot = snapshot?.cocs?.traversal?.depots?.find(entry => entry.id === event.depot);
      if (!depot || depot.hq || distance(actor, depot) > (depot.radius ?? 8) || actor?.health <= 0) continue;
    }
    counts[id] = (counts[id] ?? 0) + 1;
  }
  let holdCondition = false, holdTarget = null;
  if (id === 'connect') { holdCondition = ownedConnected(snapshot, lattice, team); holdTarget = 'supply'; }
  if (id === 'capture') {
    const zone = snapshot?.objective?.zones?.find(entry => entry.id === front?.id);
    holdCondition = !!front && front.owner === team && !front.contested && actor?.health > 0 && distance(actor, front) <= (zone?.radius ?? front.r ?? 8);
    holdTarget = front?.id;
  }
  if (id === 'depot') {
    const depot = snapshot?.cocs?.traversal?.depots?.find(entry => !entry.hq && entry.owner === team && !entry.contested && actor?.health > 0 && distance(actor, entry) <= (entry.radius ?? 8));
    holdCondition = !!depot; holdTarget = depot?.id;
  }
  // Do not credit the interval before first observing the condition, or carry
  // time across different objectives. Match time does not advance while paused.
  const hold = holdCondition ? (training.holdTarget === holdTarget ? training.hold + now - training.lastTime : 0) : 0;
  let goal;
  if (id === 'move') {
    const travelled = distance(actor, training.start);
    counts.move = Math.max(counts.move ?? 0, Number.isFinite(travelled) && actor?.health > 0 ? travelled : 0);
    goal = goalView(counts.move, moveDistance, 'm from start');
  } else if (['capture', 'depot'].includes(id) && !(counts[id] > 0)) {
    goal = goalView(hold, TRAINING_HOLD_SECONDS, 'seconds defending owned ring');
    if (id === 'capture' && front && front.owner !== team) goal = goalView((front.progress?.[team] ?? 0) * 100, 100, 'percent captured');
  } else if (id === 'connect') goal = goalView(hold, TRAINING_HOLD_SECONDS, goalLabels[id]);
  else goal = goalView(counts[id] ?? 0, id === 'fire' ? 5 : 1, goalLabels[id]);
  // Capture progress alone can reflect bots; only a participating capture or
  // a fresh local defence hold completes that lesson.
  const satisfied = ['capture', 'depot'].includes(id) ? counts[id] > 0 || hold >= TRAINING_HOLD_SECONDS : goal.ratio >= 1;
  const next = {...base, counts, localChannels, hold, holdTarget: holdCondition ? holdTarget : null, goal,
    ...(satisfied ? {phase: 'complete', completed: [...training.completed, id]} : {})};
  return {training: next, completedNow: satisfied ? current : null};
}

/** Explicit acknowledgement starts the next lesson with fresh evidence. */
export function continueTraining(training, {time = training?.lastTime ?? 0} = {}) {
  if (!training || training.done || training.phase !== 'complete') return training;
  const index = training.index + 1, done = index >= planFor(training).length;
  return {...training, index, done, phase: done ? 'done' : 'active', counts: {}, hold: 0, holdTarget: null, goal: null, localChannels: [],
    startedAt: Math.max(training.lastTime, time), lastTime: Math.max(training.lastTime, time)};
}

/** Copy is resolved from the same remappable bindings used by input. */
export function trainingControls(id, bindings = {}) {
  const key = action => bindingLabel(bindings[action] ?? DEFAULT_BINDINGS[action]);
  switch (id) {
    case 'move': return `${['forward', 'left', 'back', 'right'].map(key).join(' / ')} move · ${key('sprint')} sprint · ${key('jump')} jump`;
    case 'fire': return `Left mouse fire · Right mouse aim · ${key('reload')} reload`;
    case 'capture': case 'connect': return 'Capture is automatic · Follow the supply map in the field panel';
    case 'order': return `${key('commandScan')} SCAN / ${key('commandGo')} GO / ${key('commandAttack')} ATTACK → 1–9 target → Enter issue`;
    case 'spend': return 'While spend window is open: 1–4 buy · Arrows select · Enter confirm · Or click an available purchase';
    case 'device': return `${key('interact')} interact when the prompt says RIDE`;
    case 'depot': return `Stand on the apron to capture · ${key('interact')} enters the loaner (optional)`;
    case 'terminal': return `${key('interact')} starts the displayed action · Stay nearby through the channel`;
    case 'wave': return 'Watch the Director wave and HQ siege readouts';
    default: return '';
  }
}

export function trainingView(training) {
  if (!training) return null;
  const plan = planFor(training), current = plan[training.index] ?? null;
  return {title: training.title, mode: training.mode, index: training.index, total: plan.length,
    done: training.done, skipped: training.skipped, phase: training.phase,
    step: training.done ? null : current, next: training.done ? null : plan[training.index + 1] ?? null,
    goal: training.goal ?? goalView(0, current?.id === 'move' ? 12 : current?.id === 'fire' ? 5 : ['capture', 'connect', 'depot'].includes(current?.id) ? TRAINING_HOLD_SECONDS : 1, current?.id === 'move' ? 'm from start' : ['capture', 'depot'].includes(current?.id) ? 'seconds defending owned ring' : goalLabels[current?.id] ?? ''),
    completed: [...training.completed], progress: training.completed.length / plan.length};
}

/** Ending the tutorial does not end its ordinary local match. */
export function skipTraining(training) {
  if (!training || training.done) return training;
  return {...training, skipped: true, done: true, phase: 'skipped'};
}

// ---------------------------------------------------------------------------
// WP2.4 completion-safe practice course.
//
// Training runs inside an ordinary local match, so time, dominance, frags, an
// Operations HQ breach or a permanent elimination could otherwise end a lesson
// early. The guard is a pure plan plus a thin apply called once per fixed step:
//
//   1. an active course cannot end the match. An end already set by the
//      ordinary outcome paths is reverted, and the suppressed end beat is
//      removed from `match.events` so no phantom victory/defeat is presented;
//   2. the local player is never permanently out. A death keeps its kill
//      feedback and item/drop consequences, but the respawn delay is capped at
//      TRAINING_GUARD_RESPAWN_SECONDS: the player is not made invulnerable;
//   3. the Operations HQ cannot be armed or consumed while the course runs.
//      The plan disarms the siege and restores every point of integrity it
//      removed that step; Director waves, pacing and PRESSURE stay untouched;
//   4. a lesson that needs a spend window gets one through the authored wave
//      machine (or directly when no wave force remains), and terminal/device
//      lessons get the first authored target restored to `live` when every one
//      is currently cut/locked. Nothing teleports the player and no target is
//      invented outside the authored lattice.
//
// Nothing here reads a wall clock or consumes randomness. The plan never
// mutates; `applyTrainingGuard` performs the returned deltas. Once the course is
// skipped or completed the plan reports `active:false`, so the practice match
// resolves normally and stays reward/history/replay-free (that identity is the
// page's practice-match flag; the guard never touches rewards).
// ---------------------------------------------------------------------------
export const TRAINING_GUARD_RESPAWN_SECONDS = 0.5;
// The authored traversable device vocabulary (`cocs-traversal.mjs`) is
// duplicated here on purpose: this module is imported by the selection screen,
// so it must not pull the whole traversal engine into that bundle.
const TRAINING_DEVICE_KINDS = Object.freeze(['zipline', 'jump-pad', 'teleporter', 'launcher']);
const GUARD_WINDOW_FALLBACK_SECONDS = 30;
const guardNum = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const guardTicks = seconds => Math.max(1, Math.round(guardNum(seconds, GUARD_WINDOW_FALLBACK_SECONDS) / (RULES.dt || 1 / 60)));
const guardCourseActive = (match, training) => Boolean(training) && training.done !== true && training.skipped !== true
  && isCocsMode(match?.config?.mode ?? training.mode) === true;
const guardStepId = training => planFor(training)[training.index]?.id ?? null;

// An open spend window is `intermissionOpen(coop)` in `cocs-coop.mjs`. A living
// or telegraphed/pending authored wave is resolved through the shipped overrun
// withdrawal so the wave is still credited; with no wave force left there is
// nothing to clear and the window opens directly.
function guardSpendWindowPlan(coop) {
  if (!coop) return null;
  if (coop.phase === 'intermission' && coop.intermissionOpen === true) return null;
  if (guardNum(coop.waveForceTotal) > 0 || (coop.pending?.length ?? 0) > 0) return {forceWaveEnd: true};
  const seconds = Number(directorTier(coop.tier)?.intermissionSeconds);
  const windowTicks = guardTicks(Number.isFinite(seconds) && seconds > 0 ? seconds : GUARD_WINDOW_FALLBACK_SECONDS);
  return {open: true, ticks: Math.max(guardNum(coop.intermissionTicks), windowTicks)};
}

// HACK/SABOTAGE need a live, unchanneled terminal; DEPLOY is actionable while
// the player's team owns the node. When none qualifies, the first sorted
// cut/locked terminal is the authored repair target.
function guardTerminalPlan(state, team) {
  const table = state?.terminals?.terminals;
  if (!table) return null;
  const nodes = state?.nodes ?? [];
  let revive = null;
  for (const id of Object.keys(table).sort()) {
    const terminal = table[id];
    if (!terminal) continue;
    const kind = String(terminal.kind ?? '').toUpperCase();
    if (kind === 'DEPLOY') {
      const node = nodes.find(entry => String(entry?.id) === String(terminal.nodeId));
      if (node && node.owner === team) return null;
      continue;
    }
    if (kind !== 'HACK' && kind !== 'SABOTAGE') continue;
    if (terminal.state === 'live' && !terminal.channel) return null;
    if (revive === null && terminal.state !== 'live') revive = id;
  }
  return revive === null ? null : {revive};
}

// Any live authored traversable device is a valid RIDE target; otherwise the
// first sorted cut/locked one is restored.
function guardDevicePlan(state) {
  const devices = state?.traversal?.devices;
  if (!devices) return null;
  let revive = null;
  for (const id of Object.keys(devices).sort()) {
    const device = devices[id];
    if (!device?.from || !TRAINING_DEVICE_KINDS.includes(String(device.kind))) continue;
    if (device.state === 'live') return null;
    if (revive === null) revive = id;
  }
  return revive === null ? null : {revive};
}

/** Pure decision for one fixed step. Never mutates `match` or `training`.
 * @param {{actors?:Array, objectiveState?:object, config?:object, over?:boolean, overReason?:string, events?:Array, trainingGuard?:object}} match
 * @param {{mode?:string,index?:number,done?:boolean,skipped?:boolean}|null} training
 * @param {{playerId?:number}} [options]
 * @returns {{active:boolean,end?:object,respawn?:object,hq?:object,spendWindow?:object,terminal?:object,device?:object,suppressEvents?:string[]}}
 */
export function trainingGuardPlan(match, training, {playerId = 0} = {}) {
  if (!guardCourseActive(match, training)) return Object.freeze({active: false});
  const state = match?.objectiveState ?? null;
  const coop = state?.coop ?? null;
  const book = match?.trainingGuard ?? null;
  const actor = (match?.actors ?? []).find(entry => entry?.id === playerId) ?? null;
  const team = actor?.team === 1 ? 1 : 0;
  const plan = {active: true};
  const suppressed = ['objective-win'];
  if (match?.over === true) plan.end = {reason: match.overReason ?? null, blocked: true};
  if (actor && actor.health <= 0 && guardNum(actor.dead) > TRAINING_GUARD_RESPAWN_SECONDS) {
    plan.respawn = {actorId: playerId, seconds: TRAINING_GUARD_RESPAWN_SECONDS};
  }
  if (coop?.siege) {
    const floor = Number.isFinite(book?.hqHealth) ? book.hqHealth : guardNum(coop.siege.health);
    const restore = Math.max(0, floor - guardNum(coop.siege.health, floor));
    if (!Number.isFinite(book?.hqHealth) || coop.siege.armed === true || restore > 0) {
      plan.hq = {floor, restore, disarm: coop.siege.armed === true};
    }
    if (coop.siege.armed === true) suppressed.push('director-siege');
    if (restore > 0) suppressed.push('director-hq-damage');
  }
  const stepId = guardStepId(training);
  if (stepId === 'spend') plan.spendWindow = guardSpendWindowPlan(coop);
  if (stepId === 'terminal') plan.terminal = guardTerminalPlan(state, team);
  if (stepId === 'device') plan.device = guardDevicePlan(state);
  plan.suppressEvents = suppressed;
  return Object.freeze(plan);
}

/** Apply the pure plan to the live match. Returns the plan for inspection. */
export function applyTrainingGuard(match, training, options) {
  const plan = trainingGuardPlan(match, training, options);
  if (plan.active !== true || !match || typeof match !== 'object') return plan;
  const state = match.objectiveState ?? null;
  if (plan.hq && state?.coop?.siege) {
    const book = match.trainingGuard ?? (match.trainingGuard = {});
    if (!Number.isFinite(book.hqHealth)) book.hqHealth = plan.hq.floor;
    if (plan.hq.disarm) state.coop.siege.armed = false;
    if (plan.hq.restore > 0) {
      state.coop.siege.health = guardNum(state.coop.siege.health) + plan.hq.restore;
      // Refund the Director's siege telemetry for damage the guard reversed so
      // a protected practice run cannot report HQ damage that never landed.
      if (Number.isFinite(state.coop.siege.damage)) state.coop.siege.damage = Math.max(0, state.coop.siege.damage - plan.hq.restore);
      if (Number.isFinite(state.coop.stats?.hqDamage)) state.coop.stats.hqDamage = Math.max(0, state.coop.stats.hqDamage - plan.hq.restore);
    }
  }
  if (plan.end) {
    match.over = false; match.overReason = null;
    if (state && state.winner !== undefined) state.winner = null;
    if (state && state.winReason !== undefined) state.winReason = null;
  }
  if (plan.respawn) {
    const actor = (match.actors ?? []).find(entry => entry?.id === plan.respawn.actorId);
    if (actor) actor.dead = Math.min(guardNum(actor.dead, plan.respawn.seconds), plan.respawn.seconds);
  }
  if (plan.spendWindow) {
    const coop = state?.coop;
    if (coop) {
      if (plan.spendWindow.forceWaveEnd) {
        coop.waveTicks = Math.max(guardNum(coop.waveTicks), guardNum(coop.waveTimerTicks));
        coop.overruns = Math.max(guardNum(coop.overruns), 1);
      } else if (plan.spendWindow.open) {
        coop.phase = 'intermission'; coop.intermission = true; coop.intermissionOpen = true;
        coop.intermissionTicks = Math.max(guardNum(coop.intermissionTicks), plan.spendWindow.ticks);
      }
    }
  }
  if (plan.terminal?.revive) {
    const terminal = state?.terminals?.terminals?.[plan.terminal.revive];
    if (terminal) {
      terminal.state = 'live'; terminal.timer = 0; terminal.channel = null;
      terminal.repairs = guardNum(terminal.repairs) + 1;
      if (state.terminals.stats) state.terminals.stats.repairs = guardNum(state.terminals.stats.repairs) + 1;
      if (Array.isArray(state.cuts)) state.cuts = state.cuts.filter(id => id !== terminal.nodeId);
    }
  }
  if (plan.device?.revive) {
    const device = state?.traversal?.devices?.[plan.device.revive];
    if (device) { device.state = 'live'; device.timer = 0; device.channel = null; device.repairs = guardNum(device.repairs) + 1; }
  }
  if (plan.suppressEvents?.length && Array.isArray(match.events)) {
    const blocked = new Set(plan.suppressEvents);
    for (let index = match.events.length - 1; index >= 0; index -= 1) if (blocked.has(match.events[index]?.type)) match.events.splice(index, 1);
  }
  return plan;
}
