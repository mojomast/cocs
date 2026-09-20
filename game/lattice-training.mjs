// Pure, self-paced LATTICE lessons. Only the visible lesson collects evidence;
// a completed lesson stays visible until the player explicitly continues.
import {isCocsMode, normalizeConfig} from './config.mjs';
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
