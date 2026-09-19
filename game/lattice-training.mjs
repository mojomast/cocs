// LATTICE FIELD TRAINING — pure step engine.
//
// The training itself is an ordinary local match (`cocs` or `cocs-coop`) with
// this plan attached as presentation state. Steps advance from authoritative
// match events and snapshots only: no wall clock, no RNG, no mutation, so a
// synthetic test can drive the whole course and a real match replays it
// deterministically.
//
// The UI renders `trainingView` beside the existing field coach; this module
// owns no DOM.
import {isCocsMode} from './config.mjs';

const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

const step = (id, title, detail) => Object.freeze({id, title, detail});

// Shared first minute. Every operator can complete every step on foot: the
// device step accepts any traversal interaction, not only a grapple or ride.
export const TRAINING_STEPS = freeze({
  cocs: Object.freeze([
    step('move', 'MOVE OUT', 'Follow the link marker away from your HQ. WASD to move, Shift to sprint, Space to jump.'),
    step('fire', 'LIVE FIRE', 'Left mouse fires, right mouse aims, R reloads. Land five shots on the range or on an enemy.'),
    step('capture', 'TAKE YOUR FRONT', 'Stand inside the Bastion capture ring and stay there. Capture is automatic; clear enemies so it can finish.'),
    step('connect', 'KEEP THE LINE', 'Own the front gate and keep the supply link home. Connected nodes pay team FLUX; a cut node stops.'),
    step('order', 'ISSUE AN ORDER', 'Arm SCAN, GO/HOLD or ATTACK, pick a numbered target, then press Enter. Orders ride the team command strip.'),
    step('device', 'RIDE THE ROUTE', 'Find a traversal anchor, read the prompt and press Interact. Ziplines carry you; teleporters cross the map in a blink.'),
    step('depot', 'SECURE A DEPOT', 'Hold a depot apron to capture it, then Interact at the pad to take the loaner Puma.'),
  ]),
  'cocs-coop': Object.freeze([
    step('move', 'MOVE OUT', 'Follow the link marker away from your HQ. WASD to move, Shift to sprint, Space to jump.'),
    step('fire', 'LIVE FIRE', 'Left mouse fires, right mouse aims, R reloads. Land five shots on the range or on an enemy.'),
    step('capture', 'TAKE YOUR FRONT', 'Stand inside the Bastion capture ring and stay there. Capture is automatic; clear enemies so it can finish.'),
    step('connect', 'KEEP THE LINE', 'Own the front gate and keep the supply link home. Connected nodes pay team FLUX; a cut node stops.'),
    step('spend', 'SPEND THE WINDOW', 'Between Director waves the spend window opens. Use the mouse or number keys to buy FORTIFY, REPAIR, RESUPPLY or REINFORCE.'),
    step('order', 'ISSUE AN ORDER', 'Arm SCAN, GO/HOLD or ATTACK, pick a numbered target, then press Enter. Orders ride the team command strip.'),
    step('terminal', 'START A TERMINAL', 'At an Operations terminal, Interact starts the displayed HACK, DEPLOY or VAULT action. Protect the channel while it runs.'),
    step('wave', 'HOLD THE WAVE', 'Clear a Director wave and watch the HQ siege meter. Fall back before a breach.'),
    step('device', 'RIDE THE ROUTE', 'Find a traversal anchor, read the prompt and press Interact. Ziplines carry you; teleporters cross the map in a blink.'),
  ]),
});

export const TRAINING_TITLES = freeze({cocs: 'LATTICE FIELD TRAINING', 'cocs-coop': 'OPERATIONS FIELD TRAINING'});

const TRAINING_EVENT_MATCHERS = freeze({
  shot: event => event?.type === 'shot' ? 'shot' : null,
  capture: event => event?.type === 'cocs-capture' && event.team === 0 ? 'capture' : null,
  depot: event => event?.type === 'cocs-depot-capture' && event.team === 0 ? 'depot' : null,
  device: event => event?.type === 'cocs-device-use' ? 'device' : null,
  order: event => event?.type === 'cocs-order' && (event.team === 0 || event.team === undefined) ? 'order' : null,
  spend: event => event?.type === 'coop-spend' ? 'spend' : null,
  wave: event => event?.type === 'director-wave-cleared' ? 'wave' : null,
});

const TERMINAL_EVENTS = Object.freeze(['cocs-terminal-hack', 'cocs-terminal-deploy', 'cocs-terminal-vault', 'cocs-terminal-sabotage']);

/** Fresh training state. `start` anchors the MOVE OUT step at the spawn point.
 * @param {string} mode
 * @param {{start?: {x:number,z:number}|null, skipped?: boolean}} [options]
 */
export function createTraining(mode, {start = null, skipped = false} = {}) {
  if (!isCocsMode(mode)) return null;
  return {
    mode,
    title: TRAINING_TITLES[mode] ?? TRAINING_TITLES.cocs,
    index: 0,
    completed: [],
    counts: {},
    start: start && Number.isFinite(start.x) && Number.isFinite(start.z) ? {x: start.x, z: start.z} : null,
    skipped: skipped === true,
    done: false,
  };
}

const ownedConnected = (snapshot, lattice) => {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const byId = new Map(nodes.map(node => [String(node?.id ?? ''), node]));
  for (const node of nodes) {
    if (node?.owner !== 0) continue;
    for (const link of lattice ?? []) {
      const [a, b] = Array.isArray(link) ? link : [];
      const here = byId.get(String(a)) === node ? b : byId.get(String(b)) === node ? a : null;
      if (here === null) continue;
      const other = byId.get(String(here));
      if (other?.owner === 0 && (other?.archetype === 'hq' || other?.archetype === 'array')) return true;
    }
  }
  return false;
};

const actorDistance = (snapshot, playerId, start) => {
  const actor = (snapshot?.actors ?? []).find(entry => entry?.id === playerId) ?? snapshot?.actors?.[0];
  if (!actor || !start) return 0;
  return Math.hypot((Number(actor.x) || 0) - start.x, (Number(actor.z) || 0) - start.z);
};

// One evaluated step's completion check. Returning true consumes the step.
const stepSatisfied = (id, {snapshot, events, playerId, lattice, counts}) => {
  switch (id) {
    case 'move': return counts.move === true;
    case 'fire': return (counts.shot ?? 0) >= 5;
    case 'capture': return (counts.capture ?? 0) >= 1;
    case 'connect': return ownedConnected(snapshot, lattice);
    case 'order': return (counts.order ?? 0) >= 1;
    case 'device': return (counts.device ?? 0) >= 1;
    case 'depot': return (counts.depot ?? 0) >= 1;
    case 'spend': return (counts.spend ?? 0) >= 1;
    case 'wave': return (counts.wave ?? 0) >= 1;
    case 'terminal': return (counts.terminal ?? 0) >= 1;
    default: return false;
  }
};

/**
 * Advance the training by one authoritative beat. `events` are this frame's
 * `Match.events`; `snapshot` is `{actors, nodes}` from the match snapshot.
 * Returns a new training object plus the step that just completed.
 * @param {any} training
 * @param {{snapshot?: any, events?: any[], playerId?: number, lattice?: any[], moveDistance?: number}} [context]
 */
export function evaluateTraining(training, {snapshot = null, events = [], playerId = 0, lattice = [], moveDistance = 12} = {}) {
  if (!training || training.done) return {training, completedNow: null};
  const mode = training.mode;
  const plan = TRAINING_STEPS[mode] ?? TRAINING_STEPS.cocs;
  const counts = {...training.counts};

  if (counts.move !== true && actorDistance(snapshot, playerId, training.start) >= moveDistance) counts.move = true;
  for (const event of events) {
    if (!event) continue;
    const local = event.actor === undefined || event.actor === playerId || event.team === 0;
    for (const [key, match] of Object.entries(TRAINING_EVENT_MATCHERS)) {
      if (!local) continue;
      if (match(event) === null) continue;
      counts[key] = (counts[key] ?? 0) + 1;
      break;
    }
    if (TERMINAL_EVENTS.includes(event.type) && (event.team === 0 || event.team === undefined)) counts.terminal = (counts.terminal ?? 0) + 1;
  }

  let index = training.index;
  const completed = [...training.completed];
  let completedNow = null;
  while (index < plan.length) {
    const current = plan[index];
    if (!stepSatisfied(current.id, {snapshot, events, playerId, lattice, counts})) break;
    completed.push(current.id);
    completedNow = current;
    index += 1;
  }
  const done = index >= plan.length;
  return {
    training: {...training, index, completed, counts, done},
    completedNow,
  };
}

/** The render model for the training banner: current step, progress, next hint. */
export function trainingView(training) {
  if (!training) return null;
  const plan = TRAINING_STEPS[training.mode] ?? TRAINING_STEPS.cocs;
  const current = plan[Math.min(training.index, plan.length - 1)] ?? null;
  return {
    title: training.title,
    mode: training.mode,
    index: training.index,
    total: plan.length,
    done: training.done === true,
    step: training.done ? null : current,
    next: training.done ? null : plan[training.index + 1] ?? null,
    completed: [...training.completed],
    progress: plan.length ? training.completed.length / plan.length : 1,
  };
}

/** Training never gates the match; the player may end it at any step. */
export function skipTraining(training) {
  if (!training || training.done) return training;
  return {...training, skipped: true, done: true};
}
