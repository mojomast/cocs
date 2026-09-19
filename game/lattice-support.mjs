// Authoritative field hooks, called only by stepCocs. Dispatch is on a small
// shared vocabulary, never a character/spec id. No RNG, wall clock, or UI state.
import {RULES} from './data.mjs';
import {OPERATOR_KITS, SPECS} from './kits.mjs';
import {TOOL_USE} from './operator-verbs.mjs';

const operators = Object.fromEntries(OPERATOR_KITS.map(kit => [kit.id, kit.lattice.hook]));
const harnesses = Object.fromEntries(SPECS.map(spec => [spec.id, spec.lattice.hook]));
const num = value => Number.isFinite(value) ? value : 0;
const ticks = seconds => Math.ceil(seconds / RULES.dt);
const speed = actor => Math.hypot(num(actor.vx), num(actor.vz));
const life = actor => `${actor.character}:${actor.harness}:${actor.deaths}`;
const point = actor => ({x: actor.x, y: num(actor.y) + 1, z: actor.z});
const nearby = (a, b, range) => Math.hypot(a.x - b.x, a.z - b.z) <= range && Math.abs(num(a.y) - num(b.y)) <= 5;
const lattice = match => match?.objectiveState?.kind === 'cocs' && ['cocs', 'cocs-coop'].includes(match.config?.mode);
const eligible = (match, actor) => lattice(match) && actor?.health > 0 && actor.isNpc !== true
  && actor.isSubagent !== true && actor.isScout !== true && actor.isDirectorWave !== true
  && actor.isVip !== true && actor.vehicleId == null && actor.verbState?.active === true
  && !match.mutators?.instagib && (actor.team === 0 || actor.team === 1);
const fieldState = state => state.fieldSupport ??= {actors: {}, recipients: {}, nodes: {}, intel: {0: {}, 1: {}}};

/** Queue only after Match.power accepted the activation. Effects wait for stepCocs. */
export function queueLatticePower(match, actor) {
  if (!eligible(match, actor)) return;
  (match.objectiveState.fieldPowers ??= {})[actor.id] = {harness: actor.harness, deaths: actor.deaths};
}

/** Accepted swaps, including the first simulation tick; not input polling. */
export function queueLatticeSwap(match, actor) {
  if (eligible(match, actor)) (match.objectiveState.fieldSwaps ??= {})[actor.id] = life(actor);
}

/** Missing Tool Use hook for LATTICE channels (NPCs and other modes are neutral). */
export function latticeInteractionRate(match, actor) {
  if (!eligible(match, actor)) return 1;
  const hook = operators[actor.character];
  return Math.min(1.35, Math.max(hook?.type === 'interaction' ? hook.scale : 1,
    TOOL_USE.interactionMultiplier(actor.verbState, {kind: 'objective'})));
}

function condition(actor, hook) {
  if (hook.when === 'moving') return speed(actor) >= hook.speed;
  if (hook.when === 'still') return actor.grounded === true && speed(actor) < .5;
  if (hook.when === 'holding' || hook.when === 'braced') return actor.grounded === true && speed(actor) < .5
    && !actor.firingThisTick && (hook.when !== 'braced' || (actor.crouching && !(actor.verbState.combatIn > 0)));
  if (hook.when === 'adaptive') return actor.verbState.open === true && actor.verbState.windowIn > 0;
  if (hook.when === 'heat') return num(actor.verbState.heat) + 1e-9 >= hook.minimum;
  return true;
}

/** Strongest contributor wins; physical presence, ownership legality and contest
 * stay with cocs capture. Orders and NPCs cannot inherit a player's bonus. */
export function latticeCaptureRate(match, actors) {
  let scale = 1;
  const state = match.objectiveState;
  for (const actor of actors ?? []) {
    if (!eligible(match, actor)) continue;
    scale = Math.max(scale, latticeInteractionRate(match, actor));
    const hook = operators[actor.character];
    const memory = state.fieldSupport?.actors?.[actor.id];
    if (hook?.type === 'capture' && hook.when !== 'swap' && condition(actor, hook)) scale = Math.max(scale, hook.scale);
    if (memory?.loadout === life(actor) && memory.captureUntil > state.tick) scale = Math.max(scale, memory.captureScale);
  }
  return Math.min(1.35, scale);
}

export function latticeCaptureResist(state, node, team) {
  const ward = state.fieldSupport?.nodes?.[node.id]?.ward;
  return ward && ward.team === node.owner && ward.team !== team && ward.until > state.tick ? ward.resist : 0;
}

function repair(state, node) {
  const index = (state.cuts ?? []).indexOf(node.id);
  if (index < 0) return false;
  state.cuts.splice(index, 1);
  delete state.sabotage?.[node.id];
  // Clear the cut's source too: a sabotaged terminal must become usable again.
  for (const terminal of Object.values(state.terminals?.terminals ?? {})) {
    if (terminal.nodeId !== node.id || terminal.state !== 'cut') continue;
    terminal.state = 'live'; terminal.timer = 0;
  }
  return true;
}

function applyHook(match, state, actor, memory, hook, node, connectedToHq) {
  const field = fieldState(state), now = state.tick;
  if (hook.type === 'capture') {
    memory.captureUntil = now + ticks(hook.seconds);
    memory.captureScale = hook.scale;
    return true;
  }
  if (!node) return false;
  const safeOwned = node.owner === actor.team && !node.contested;
  const nodeMemory = field.nodes[node.id] ??= {};
  if (hook.type === 'repair') return safeOwned && repair(state, node);
  if (hook.type === 'delivery') {
    if (!safeOwned || node.archetype !== 'economy' || !connectedToHq(state, node.id, actor.team)
      || nodeMemory.deliveryUntil > now || num(actor.req) < hook.req) return false;
    const flux = Math.min(hook.flux, Math.max(0, state.fluxCap - state.flux[actor.team]));
    if (!(flux > 0)) return false;
    const cost = hook.req * flux / hook.flux;
    actor.req -= cost;
    actor.reqSpent = num(actor.reqSpent) + cost;
    state.flux[actor.team] += flux;
    state.fluxEarned[actor.team] = num(state.fluxEarned[actor.team]) + flux;
    nodeMemory.deliveryUntil = now + ticks(hook.cooldown);
    return true;
  }
  if (hook.type === 'disrupt') {
    if (nodeMemory.disruptUntil > now) return false;
    const enemy = 1 - actor.team, before = num(node.progress[enemy]);
    node.progress[enemy] = Math.max(0, before - hook.amount);
    if (node.progress[enemy] < before) nodeMemory.disruptUntil = now + ticks(hook.cooldown);
    return node.progress[enemy] < before;
  }
  if (hook.type === 'ward') {
    if (node.owner !== actor.team || nodeMemory.wardUntil > now) return false;
    nodeMemory.ward = {team: actor.team, until: now + ticks(hook.seconds), resist: hook.resist};
    nodeMemory.wardUntil = now + ticks(hook.cooldown);
    return true;
  }
  const ordered = [...match.actors].sort((a, b) => a.id - b.id);
  if (hook.type === 'recon') {
    const enemy = ordered.find(target => target.health > 0 && target.team === 1 - actor.team
      && !(target.powerups?.cloak > 0) && nearby(actor, target, hook.range)
      && match.visible(point(actor), point(target)));
    if (!enemy) return false;
    const intel = {until: now + ticks(hook.seconds), x: enemy.x, z: enemy.z, by: actor.id};
    field.intel[actor.team][enemy.id] = intel;
    // Reuse the shipped team marker in local and network play. A real SCAN
    // remains stronger; this informational mark never gives its damage bonus.
    const spot = state.spots[enemy.id];
    if (!spot || spot.until < now || spot.intelOnly === true) {
      state.spots[enemy.id] = {...intel, team: actor.team, atTick: now, intelOnly: true};
    }
    return true;
  }
  let count = 0;
  for (const target of ordered) {
    if (target === actor || target.health <= 0 || target.team !== actor.team || !nearby(actor, target, hook.range)) continue;
    const received = field.recipients[target.id] ??= {};
    if (received[hook.type] > now) continue;
    if (hook.type === 'cleanse') {
      if (!(target.slow > 0)) continue;
      target.slow = 0;
      target.slowMultiplier = 1;
    } else if (hook.type === 'supply') {
      const index = target.weapon, weapon = match.weaponForIndex(target, index);
      const have = target.ammo?.[index], stock = actor.ammo?.[index];
      if (!Number.isFinite(have) || !Number.isFinite(stock) || !Number.isFinite(weapon?.cap)) continue;
      const rounds = Math.min(Math.floor(num(weapon.ammo) * hook.fraction), Math.max(0, stock - 1), Math.max(0, weapon.cap - have));
      if (!(rounds > 0)) continue;
      actor.ammo[index] -= rounds;
      target.ammo[index] += rounds;
    } else continue;
    received[hook.type] = now + ticks(hook.cooldown);
    if (++count >= hook.targets) break;
  }
  return count > 0;
}

/** One call per authoritative objective step, after presence/contest refresh. */
export function stepLatticeSupport(match, state, dt, {connectedToHq}) {
  if (!lattice(match) || match.over) return;
  const field = fieldState(state), powers = state.fieldPowers ?? {}, swaps = state.fieldSwaps ?? {};
  state.fieldPowers = {}; state.fieldSwaps = {};
  const now = state.tick;
  for (const team of [0, 1]) for (const [id, intel] of Object.entries(field.intel[team])) {
    const target = match.actors.find(actor => String(actor.id) === id);
    if (intel.until <= now || !target || target.health <= 0 || target.powerups?.cloak > 0) {
      delete field.intel[team][id];
      if (state.spots[id]?.intelOnly === true) delete state.spots[id];
    }
  }
  for (const actor of [...match.actors].sort((a, b) => a.id - b.id)) {
    const memory = field.actors[actor.id] ??= {};
    const loadout = life(actor);
    if (memory.loadout !== loadout || !eligible(match, actor)) {
      // Cooldowns survive death/loadout switching: respawns cannot farm support.
      memory.loadout = loadout; memory.captureUntil = 0; memory.channel = 0;
    }
    if (!eligible(match, actor)) continue;
    const swapped = swaps[actor.id] === loadout;
    const candidates = state.nodes.filter(node => node.live && !['hq', 'array'].includes(node.archetype))
      .sort((a, b) => Math.hypot(actor.x - a.x, actor.z - a.z) - Math.hypot(actor.x - b.x, actor.z - b.z) || a.id.localeCompare(b.id));
    for (const [slot, hook] of [['operator', operators[actor.character]], ['harness', harnesses[actor.harness]]]) {
      if (!hook || hook.type === 'interaction') continue;
      const activation = powers[actor.id];
      if (slot === 'harness' && (!activation || activation.harness !== actor.harness || activation.deaths !== actor.deaths)) continue;
      if (slot === 'operator' && hook.when === 'swap' && !swapped) continue;
      const node = candidates.find(node => nearby(actor, node, slot === 'operator' ? node.r : (hook.range ?? node.r)));
      const valid = condition(actor, hook) && (node || hook.type === 'capture')
        && (hook.when !== 'holding' || node?.owner === actor.team);
      if (hook.channel) {
        if (!valid || !node || node.owner !== actor.team || node.contested || !(state.cuts ?? []).includes(node.id)) { memory.channel = 0; memory.channelNode = null; continue; }
        if (memory.channelNode !== node.id) memory.channel = 0;
        memory.channelNode = node.id;
        memory.channel = Math.min(hook.channel, num(memory.channel) + dt);
        if (memory.channel + 1e-9 < hook.channel) continue;
      }
      // Continuous capture conditions are read by latticeCaptureRate instead.
      if (hook.type === 'capture' && slot === 'operator' && hook.when !== 'swap') continue;
      if (!valid || memory[`${slot}Until`] > now) continue;
      if (applyHook(match, state, actor, memory, hook, node, connectedToHq)) {
        memory[`${slot}Until`] = now + ticks(hook.cooldown);
        memory.channel = 0;
        match.emit('lattice-support', {actor: actor.id, team: actor.team, source: slot, effect: hook.type, node: node?.id ?? null});
      }
    }
  }
}

/** Detached numeric state for authoritative snapshots / reconnects. */
export function latticeSupportSnapshot(state) {
  return state?.fieldSupport ? JSON.parse(JSON.stringify(state.fieldSupport)) : null;
}
