// LATTICE STRIKE: OPERATIONS O1c — per-player command gates, terminals,
// roles/multi-target abilities, prime and the D3/D4 published bands.
//
// Design authority: COCS-OPERATIONS.md §3.1/§3.3/§7.3 and COCS-MODE-SPEC.md
// §4.3 (terminals), §4.8 (prime), §5.1–5.3 (command), §8.1 (roles).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {RULES} from './data.mjs';
import {
  COOP_EXECUTOR_LEASE_TICKS, coopAutoSpend, coopBreachGateId, coopCommandState,
  coopHumanIds, coopOrderGate, coopPrimeNode, coopRequestLease, coopRoleAction,
  coopRoleRally, coopSpend, coopSpendGate, setCoopTier, spawnCoopSquad,
} from './cocs-coop.mjs';
import {COOP_ROLES, roleAbility, roleAbilityTargets} from './cocs-roles.mjs';
import {terminalInteract} from './cocs-terminals.mjs';
import {connectivityIncome, cocsSnapshot} from './cocs.mjs';
import {DIRECTOR_TIERS, directorWavePlan} from './cocs-difficulty.mjs';

const DT = RULES.dt;
const ticks = seconds => Math.max(1, Math.round(seconds / DT));
const mulberry32 = seed => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const coopMatch = (over = {}) => new Match('chatgpt', 'openclaw', mulberry32(over.seed ?? 7), 'lattice-slice', {
  mode: 'cocs-coop', humanCount: 4, botCount: 2, aiSeats: true, timeLimit: 900, ...over,
});
const step = (m, n = 1) => { for (let i = 0; i < n && !m.over; i++) m.step(DT, {inputs: {}}); return m; };
const node = (state, id) => state.nodes.find(entry => entry.id === id);
const capturable = state => state.nodes.filter(entry => ['front', 'economy', 'relay'].includes(entry.archetype));

// Promote `n` of the team-0 AI seats to humans (bot === null is the engine's
// human marker) and return their ids.
function promoteHumans(m, n = 2) {
  const seats = m.actors.filter(actor => actor.team === 0).sort((a, b) => a.id - b.id).slice(0, n);
  for (const actor of seats) actor.bot = null;
  return seats.map(actor => actor.id);
}

// Freeze one actor at a point and clear the field of hostiles so a channel /
// capture step measures the rule, not AI pathing.
function pin(m, actor, x, z) {
  actor.x = x; actor.z = z; actor.y = 0; actor.vx = 0; actor.vy = 0; actor.vz = 0;
  for (const other of m.actors) {
    if (other.team === 1) { other.x = 1000; other.z = 1000; other.y = 0; }
  }
}

test('a friendly role ability targets every team-0 actor in radius, not just actor 0', () => {
  const m = coopMatch({seed: 3});
  const state = m.objectiveState;
  step(m, 1);
  const allies = m.actors.filter(actor => actor.team === 0 && actor.health > 0).sort((a, b) => a.id - b.id);
  assert.ok(allies.length >= 3, 'a co-op roster has several team-0 actors');
  const caster = allies[0];
  // Put two allies beside the caster, one far away.
  allies[0].x = 0; allies[0].z = 0;
  allies[1].x = 2; allies[1].z = 0;
  allies[2].x = 3; allies[2].z = 1;
  const far = allies[allies.length - 1];
  far.x = 400; far.z = 400;
  const ability = roleAbility('fighter', 'RALLY');
  const targets = roleAbilityTargets(m, state, caster, ability);
  assert.ok(targets.length >= 2, 'the multi-target resolver returns every ally in radius');
  assert.ok(!targets.includes(caster.id), 'the caster is excluded by default');
  assert.ok(!targets.includes(far.id), 'a distant ally is out of the 14 m radius');
  assert.deepEqual(targets, [...targets].sort((a, b) => a - b), 'targets are id-sorted');
  const applied = coopRoleRally(m, state, caster, ability);
  assert.deepEqual(applied, targets);
  for (const id of applied) {
    const target = m.actors.find(actor => actor.id === id);
    assert.ok(target.temporaryShield >= ability.shield, 'the shield lands on every target');
  }
});

test('PRIME targets owned economy nodes and resolves through the role action', () => {
  const m = coopMatch({seed: 5});
  const state = m.objectiveState;
  step(m, 1);
  const econ = capturable(state).filter(entry => entry.archetype === 'economy');
  assert.ok(econ.length >= 1);
  for (const entry of econ) entry.owner = 0;
  const actor = m.actors.find(entry => entry.team === 0 && entry.health > 0);
  const targets = roleAbilityTargets(m, state, actor, roleAbility('harvester', 'PRIME'));
  assert.deepEqual(targets, econ.map(entry => entry.id).sort(), 'every owned siphon is a target');
  // A node-scoped explicit action starts the 8 s channel.
  const result = coopRoleAction(m, state, actor.id, 'PRIME', {target: econ[0].id});
  assert.equal(result.ok, true);
  assert.ok(node(state, econ[0].id).primeChannel, 'the prime channel is live');
  // A second prime on the same node is refused (one active prime per node).
  assert.equal(coopPrimeNode(m, state, actor, econ[0].id).ok, false);
});

test('the prime completes after 8 s and pays +50% FLUX and a faster capture', () => {
  const m = coopMatch({seed: 7});
  const state = m.objectiveState;
  step(m, 1);
  const econ = capturable(state).find(entry => entry.archetype === 'economy');
  econ.owner = 0;
  // Make the siphon connected: own the gate next to hq-0.
  node(state, 'front-0').owner = 0;
  const actor = m.actors.find(entry => entry.team === 0 && entry.health > 0);
  actor.bot = null;
  const before = connectivityIncome(state).income[0];
  coopPrimeNode(m, state, actor, econ.id);
  for (let i = 0; i < ticks(8) + 4 && !econ.prime; i++) {
    pin(m, actor, econ.x, econ.z);
    m.step(DT, {inputs: {}});
  }
  assert.ok(econ.prime, 'the channel completes into an active prime');
  assert.equal(econ.prime.team, 0);
  const primed = connectivityIncome(state).income[0];
  assert.ok(primed > before, 'an active prime raises connected income');
  // +50% on the siphon's 3/s base.
  assert.ok(Math.abs((primed - before) - 1.5) < 1e-9, `expected +1.5 FLUX/s, got ${primed - before}`);
  // A HARVESTER never primes from outside the leash: leaving interrupts.
  econ.prime = null;
  coopPrimeNode(m, state, actor, econ.id);
  actor.x = econ.x + 60; actor.z = econ.z;
  m.step(DT, {inputs: {}});
  assert.equal(econ.primeChannel, null, 'leaving the leash interrupts the prime');
});

test('the per-player slice cap, executor lease and THREADS gate two humans', () => {
  const m = coopMatch({seed: 11});
  const state = m.objectiveState;
  step(m, 1);
  const humans = promoteHumans(m, 2);
  assert.deepEqual(coopHumanIds(m), humans);
  const command = coopCommandState(m, state);
  assert.equal(command.slicePerPlayer, 2, 'slices = max(2, humans)');
  assert.equal(command.slices.length, 2, 'one slice per living human');
  assert.equal(command.threads.cap, Math.min(6, humans.length + 1), 'THREADS = min(6, humans+1)');
  state.flux[0] = 100;
  const executor0 = coopCommandState(m, state).executor;
  assert.equal(executor0, humans[0], 'the lease starts on the first id-sorted human');
  const other = humans.find(id => id !== executor0);
  assert.equal(coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: other}).ok, false, 'a non-executor cannot fire a big card');
  assert.equal(coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: executor0}).ok, true);
  // Rotate the lease after the 600-tick window.
  state.coop.tick = COOP_EXECUTOR_LEASE_TICKS;
  assert.equal(coopCommandState(m, state).executor, humans[1], 'the lease rotates');
  assert.equal(coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: humans[1]}).ok, true);
  assert.equal(coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: humans[0]}).ok, false);
  // A recorded request wins the next rotation.
  state.coop.tick = COOP_EXECUTOR_LEASE_TICKS * 2;
  coopRequestLease(state, humans[0], state.coop.tick);
  assert.equal(coopCommandState(m, state).executor, humans[0], 'the requested lease is granted next rotation');
  // The slice cap: a nearly dry pool blocks even the executor.
  state.flux[0] = 10; // allowance = 5 < SCAN 7
  const gate = coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: humans[0]});
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'slice');
  state.flux[0] = 100;
  const slice = coopCommandState(m, state).slices.find(entry => entry.id === humans[0]);
  assert.equal(slice.allowance, 50, 'allowance = floor(flux / slices)');
  assert.ok(slice.remaining <= slice.allowance);
});

test('no humans falls back to the duty Chief and auto-spend; a human seat disables it', () => {
  const m = coopMatch({seed: 13});
  const state = m.objectiveState;
  const coop = state.coop;
  step(m, 2);
  assert.deepEqual(coopHumanIds(m), [], 'aiSeats have no human seat');
  const command = coopCommandState(m, state);
  assert.equal(command.executor, 'chief');
  assert.equal(command.lease.chief, true);
  assert.equal(command.slices[0].id, 'chief');
  assert.equal(coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: 'chief-0'}).ok, true, 'the Chief proxies the big card');
  assert.equal(coopAutoSpend(m, state), 0, 'auto-spend only runs inside an open window');
  // A single promoted human disables the pooled auto-spend fallback.
  promoteHumans(m, 1);
  coop.autoSpend = true;
  coop.phase = 'intermission';
  coop.intermissionOpen = true;
  assert.equal(coopAutoSpend(m, state), 0, 'with a human seated the auto-spend fallback stays off');
});

test('the between-wave spend window applies the same slice/executor gates as orders', () => {
  const m = coopMatch({seed: 17});
  const state = m.objectiveState;
  const coop = state.coop;
  step(m, 1);
  const humans = promoteHumans(m, 2);
  coop.phase = 'intermission';
  coop.intermissionOpen = true;
  state.flux[0] = 300;
  const executor = coopCommandState(m, state).executor;
  const other = humans.find(id => id !== executor);
  // RESUPPLY is not a big sink: either human may buy it, slice permitting.
  assert.equal(coopSpendGate(m, state, {verb: 'RESUPPLY', peerId: other}).ok, true);
  const supply = coopSpend(m, state, {tick: coop.tick, peerId: other, cardId: 's1', verb: 'RESUPPLY'});
  assert.equal(supply.ok, true);
  assert.ok(coop.commandSpent.byPeer[String(other)] >= 35, 'the per-player spend is tracked for the HUD');
  // REINFORCE is a big sink: the non-executor cannot call it in.
  assert.deepEqual(coopSpendGate(m, state, {verb: 'REINFORCE', peerId: other}), {ok: false, reason: 'executor'});
  assert.equal(coopSpendGate(m, state, {verb: 'REINFORCE', peerId: executor}).ok, true);
  // A dry pool blocks the slice.
  state.flux[0] = 20; // allowance 10 < RESUPPLY 35
  const dry = coopSpendGate(m, state, {verb: 'RESUPPLY', peerId: executor});
  assert.deepEqual(dry, {ok: false, reason: 'slice'});
  assert.equal(coopSpend(m, state, {tick: coop.tick, peerId: executor, cardId: 'r1', verb: 'REINFORCE'}).ok, false);
  // A Chief-proxied spend bypasses the per-player caps (the no-human path).
  state.flux[0] = 300;
  assert.equal(coopSpendGate(m, state, {verb: 'REINFORCE', peerId: 'chief-0'}).ok, true);
});

test('terminals expose HACK/DEPLOY/VAULT/SABOTAGE lifecycles and a snapshot', () => {
  const m = coopMatch({seed: 19});
  const state = m.objectiveState;
  step(m, 1);
  const terminals = state.terminals;
  assert.ok(terminals, 'co-op builds a terminal tree from the lattice');
  const catalog = Object.values(terminals.terminals).map(entry => entry.id);
  assert.ok(catalog.includes('hack-relay-0') && catalog.includes('vault-hq-0') && catalog.includes('sabotage-relay-0'));
  const actor = m.actors.find(entry => entry.team === 0 && entry.health > 0);
  actor.bot = null;
  const relay = node(state, 'relay-0');
  const hackTerminal = terminals.terminals['hack-relay-0'];
  // HACK: a 3 s stable channel sets a 2x, 6 s capture window.
  assert.equal(typeof hackTerminal, 'object');
  actor.x = relay.x; actor.z = relay.z; actor.y = 0;
  const begin = terminalInteract(m, state, actor.id, 'hack-relay-0', 'HACK');
  assert.equal(begin.ok, true, JSON.stringify(begin));
  for (let i = 0; i < ticks(3) + 3 && !relay.hack; i++) { pin(m, actor, relay.x, relay.z); m.step(DT, {inputs: {}}); }
  assert.ok(relay.hack, 'the HACK channel completes into a capture window');
  assert.equal(relay.hack.multiplier, 2);
  assert.equal(relay.hack.team, 0);
  // DEPLOY: only while owned; enables ORACLE resolution.
  relay.owner = 0;
  assert.equal(terminalInteract(m, state, actor.id, 'deploy-relay-0', 'DEPLOY').ok, true);
  for (let i = 0; i < ticks(2) + 3 && !relay.oracle; i++) { pin(m, actor, relay.x, relay.z); m.step(DT, {inputs: {}}); }
  assert.equal(relay.oracle?.active, true, 'DEPLOY enables ORACLE while owned');
  // VAULT: store is free; pull costs 8 FLUX and pays a banked effect.
  const hq = node(state, 'hq-0');
  const hqTerminal = terminals.terminals['vault-hq-0'];
  actor.x = hq.x; actor.z = hq.z;
  assert.equal(terminalInteract(m, state, actor.id, hqTerminal.id, 'VAULT', 'store').ok, true);
  const fluxBefore = state.flux[0];
  const reqBefore = actor.req ?? 0;
  const pull = terminalInteract(m, state, actor.id, hqTerminal.id, 'VAULT', 'pull');
  assert.equal(pull.ok, true);
  assert.equal(pull.cost, 8);
  assert.equal(state.flux[0], fluxBefore - 8, 'a vault pull debits 8 FLUX');
  assert.equal((actor.req ?? 0) - reqBefore, 6, 'a vault pull pays the banked effect');
  // SABOTAGE: a cut link denies income until REPAIR.
  const sit = terminals.terminals['sabotage-relay-0'];
  relay.owner = 1;
  actor.x = relay.x; actor.z = relay.z; actor.y = 0;
  assert.equal(terminalInteract(m, state, actor.id, sit.id, 'SABOTAGE').ok, true);
  for (let i = 0; i < ticks(3) + 3 && sit.state !== 'cut'; i++) { pin(m, actor, relay.x, relay.z); m.step(DT, {inputs: {}}); }
  assert.equal(sit.state, 'cut');
  assert.ok(state.cuts.includes('relay-0'), 'the cut denies the relay link');
  // The snapshot exposes the flat UI contract array (id-sorted) and keeps the
  // raw id-keyed tree available on `terminalState`.
  const snap = cocsSnapshot(m);
  assert.ok(Array.isArray(snap.terminals), 'the cocs snapshot exposes a flat terminal array');
  const sabotageEntry = snap.terminals.find(entry => entry.id === 'sabotage-relay-0');
  assert.equal(sabotageEntry.state, 'blocked', 'a cut terminal maps to the blocked UI state');
  assert.equal(sabotageEntry.simState, 'cut', 'the raw sim state is preserved');
  assert.ok(snap.terminals.some(entry => entry.id === 'hack-relay-0'));
  for (const entry of snap.terminals) {
    for (const key of ['id', 'kind', 'nodeId', 'label', 'state', 'owner', 'progress', 'remainingSeconds', 'actor', 'hint']) {
      assert.ok(Object.hasOwn(entry, key), `terminal entry carries ${key}`);
    }
  }
  assert.ok(Array.isArray(snap.terminalState?.terminals), 'the raw id-keyed terminal tree stays available');
  assert.ok(snap.terminalState.terminals.some(entry => entry.id === 'hack-relay-0'));
  // A running channel surfaces as `active` with live progress on the UI array.
  assert.equal(terminalInteract(m, state, actor.id, 'hack-relay-0', 'HACK').ok, true);
  pin(m, actor, relay.x, relay.z);
  m.step(DT, {inputs: {}});
  const active = cocsSnapshot(m).terminals.find(entry => entry.id === 'hack-relay-0');
  assert.equal(active.state, 'active', 'a running channel reads active');
  assert.equal(active.actor, actor.id, 'the channel actor is surfaced');
  assert.ok(active.progress > 0 && active.progress < 1, 'progress advances with the channel');
  assert.ok(active.remainingSeconds > 0 && active.remainingSeconds <= 3, 'remaining seconds are exposed');
});

test('the HACK window doubles capture progress and expires on the tick clock', () => {
  const run = hack => {
    const m = coopMatch({seed: 23});
    const state = m.objectiveState;
    step(m, 2);
    const front = node(state, 'front-0');
    front.owner = null;
    front.progress = {0: 0, 1: 0};
    if (hack) front.hack = {team: 0, until: state.tick + 600, multiplier: 2};
    const actor = m.actors.find(entry => entry.team === 0 && entry.health > 0);
    actor.bot = null;
    for (let i = 0; i < 30; i++) { pin(m, actor, front.x, front.z); m.step(DT, {inputs: {}}); }
    return front.progress[0];
  };
  const base = run(false);
  const hacked = run(true);
  assert.ok(base > 0 && hacked > 0);
  assert.ok(Math.abs(hacked / base - 2) < 0.15, `hack doubles the rate (${base} -> ${hacked})`);
});

test('NO BREACH derives its gate from hq-0 adjacency, not a hardcoded id', () => {
  const m = coopMatch({seed: 29});
  const state = m.objectiveState;
  step(m, 1);
  assert.equal(coopBreachGateId(state), 'front-0', 'the hq-0-adjacent gate is derived from adjacency');
  // A renamed gate still resolves from adjacency.
  const gate = node(state, 'front-0');
  gate.id = 'breach-gate';
  state.adjacency[state.nodes.find(entry => entry.id === 'hq-0').id] = state.adjacency[state.nodes.find(entry => entry.id === 'hq-0').id].map(id => id === 'front-0' ? 'breach-gate' : id);
  assert.equal(coopBreachGateId(state), 'breach-gate');
});

test('roles spawn with the right envelope and register on the subagent roster', () => {
  const m = coopMatch({seed: 31});
  const state = m.objectiveState;
  step(m, 1);
  const id = spawnCoopSquad(m, state, {role: 'harvester'});
  assert.ok(id !== null);
  const actor = m.actors.find(entry => entry.id === id);
  assert.equal(actor.subagentRole, 'harvester');
  assert.equal(actor.isSubagent, true);
  assert.equal(actor.maxHealth, COOP_ROLES.harvester.health);
  assert.ok(state.coop.subagents[id]);
  assert.equal(state.coop.subagentStats.byRole.harvester, 1);
});

test('REPAIR also restores a cut terminal and a destroyed depot loaner', () => {
  const m = coopMatch({seed: 37});
  const state = m.objectiveState;
  const coop = state.coop;
  step(m, 1);
  coop.phase = 'intermission';
  coop.intermissionOpen = true;
  state.flux[0] = 300;
  const terminal = state.terminals.terminals['sabotage-relay-0'];
  terminal.state = 'cut';
  terminal.timer = 30;
  state.cuts.push('relay-0');
  const depot = Object.values(state.traversal.depots).find(entry => entry.hq !== true);
  depot.owner = 0;
  depot.vehicleId = 'ghost-vehicle';
  const result = coopSpend(m, state, {tick: coop.tick, peerId: 'chief-0', cardId: 'rep', verb: 'REPAIR'});
  assert.equal(result.ok, true);
  assert.equal(terminal.state, 'live', 'REPAIR fixes a cut terminal');
  assert.equal(state.cuts.includes('relay-0'), false);
  assert.equal(depot.vehicleId, null, 'REPAIR forces a destroyed loaner to respawn');
  assert.equal(depot.respawn, 0);
});

test('D3/D4 ship their published bands and tuned plans', () => {
  for (const tier of ['D3', 'D4']) {
    const data = DIRECTOR_TIERS[tier];
    assert.ok(Array.isArray(data.band) && data.band.length === 2, `${tier} band`);
    assert.ok(data.band[0] >= 0 && data.band[1] <= 1);
    assert.equal(data.hardened, true, `${tier} ships a hardened front`);
    assert.equal(data.denial, true, `${tier} ships denial events`);
  }
  const d3 = directorWavePlan(5, 'D3');
  const d4 = directorWavePlan(5, 'D4');
  assert.equal(d3.fronts, 3);
  assert.equal(d4.fronts, 3);
  assert.ok(d4.timer < d3.timer, 'D4 compresses the wave timer further');
  assert.ok(DIRECTOR_TIERS.D3.rewardMultiplier > DIRECTOR_TIERS.D2.rewardMultiplier);
  // The band shifts down monotonically with tier.
  assert.ok(DIRECTOR_TIERS.D1.band[0] > DIRECTOR_TIERS.D2.band[0]);
  assert.ok(DIRECTOR_TIERS.D2.band[0] > DIRECTOR_TIERS.D3.band[0]);
  assert.ok(DIRECTOR_TIERS.D3.band[0] > DIRECTOR_TIERS.D4.band[0]);
});

test('D3/D4 denial cuts a team link and the hardened front resists a recapture', () => {
  const m = coopMatch({seed: 43});
  const state = m.objectiveState;
  const coop = state.coop;
  setCoopTier(state, 'D3');
  step(m, 1);
  // Make the gate adjacent to hq-0 ours so the link is connected.
  node(state, 'front-0').owner = 0;
  coop.wave = 3;
  // Land exactly on the denial cadence, inside a live wave.
  coop.phase = 'build_up';
  coop.intermission = false;
  coop.waveTicks = 10;
  coop.waveTimerTicks = 100000;
  coop.tick = 45 * 60 - 1;
  m.step(DT, {inputs: {}});
  assert.ok(coop.denial, 'D3 cuts a team link on its cadence');
  assert.ok(state.cuts.includes(coop.denial.nodeId), 'the cut denies the link');
  // The cut lapses after its published window.
  coop.tick = coop.denial.until + 1;
  m.step(DT, {inputs: {}});
  assert.equal(coop.denial, null, 'the denial window ends');
  assert.equal(state.cuts.includes('front-0'), false, 'the link is repaired after the window');
  // Hardened: a Director-held front resists a recapture.
  const front = node(state, 'front-0');
  coop.hardenedNodeId = 'front-0';
  front.owner = 1;
  m.step(DT, {inputs: {}});
  assert.equal(front.captureResist, 0.5, 'the Director-held front is hardened');
  front.owner = 0;
  m.step(DT, {inputs: {}});
  assert.equal(Number(front.captureResist), 0, 'the resist clears when the front is retaken');
});

test('the engine order/spend path enforces the gates end to end', () => {
  const m = coopMatch({seed: 53});
  const state = m.objectiveState;
  const coop = state.coop;
  step(m, 2);
  const humans = promoteHumans(m, 2);
  state.flux[0] = 300;
  const executor = coopCommandState(m, state).executor;
  const other = humans.find(id => id !== executor);
  const target = capturable(state).find(entry => entry.owner === 0 || entry.live)?.id ?? 'front-0';
  // A big card from the non-executor is rejected with a reason in the log.
  m.step(DT, {cocs: {orders: [{tick: state.tick + 1, peerId: String(other), cardId: 'x', team: 0, verb: 'SCAN', target}]}});
  const rejected = state.orderLog.find(entry => entry.cardId === 'x');
  assert.ok(rejected && rejected.ok === false && rejected.reason === 'executor', 'the engine rejects the non-executor big card');
  // The executor's order is accepted (flux is ample).
  m.step(DT, {cocs: {orders: [{tick: state.tick + 1, peerId: String(executor), cardId: 'y', team: 0, verb: 'SCAN', target}]}});
  const accepted = state.orderLog.find(entry => entry.cardId === 'y');
  assert.ok(accepted && accepted.ok === true, 'the executor big card is accepted');
  // A between-wave spend from the non-executor for a big sink is rejected.
  coop.phase = 'intermission';
  coop.intermissionOpen = true;
  state.flux[0] = 300;
  m.step(DT, {cocs: {spends: [{tick: state.tick + 1, peerId: String(other), cardId: 'z', verb: 'REINFORCE'}]}});
  const spend = coop.spendLog.find(entry => entry.cardId === 'z');
  assert.ok(spend && spend.ok === false && spend.reason === 'executor', 'the engine rejects the non-executor big sink');
  // A lease request rides the `{cocs:{lease}}` input bag and wins the next rotation.
  const m2 = coopMatch({seed: 59});
  const s2 = m2.objectiveState;
  step(m2, 1);
  const h2 = promoteHumans(m2, 2);
  assert.equal(coopCommandState(m2, s2).executor, h2[0]);
  m2.step(DT, {cocs: {lease: h2[1]}});
  s2.coop.tick = COOP_EXECUTOR_LEASE_TICKS - 1;
  m2.step(DT, {inputs: {}});
  assert.equal(coopCommandState(m2, s2).executor, h2[1], 'the queued request rotates the lease to its owner');
  assert.equal(s2.coop.leaseRequests.length, 0, 'a granted request is consumed');
});

test('the D1-D4 gate table reports each tier band and flags out-of-band tiers', async () => {
  const {summariseCoop, summariseCoopTiers} = await import('../scripts/cocs-validate.mjs');
  const bands = {D1: [0.35, 0.65], D4: [0.12, 0.40]};
  const sample = (win, extra = {}) => ({win, wavesCleared: win ? 5 : 2, stepP95Ms: 3, hqDamage: 40, spend: {windows: 1, byType: {RESUPPLY: 1}, budgetClampedFraction: 0}, bonus: {done: [], failed: []}, rewards: {retention: 1}, ...extra});
  const d1 = summariseCoop([sample(true), sample(true), sample(false), sample(false)]);
  const inBand = summariseCoopTiers({D1: d1}, bands);
  assert.ok(inBand.tiers.D1.inBand, '2/4 = 50% sits inside 35-65%');
  const d4 = summariseCoop([sample(false), sample(false), sample(false), sample(false)]);
  const outOfBand = summariseCoopTiers({D4: d4}, bands);
  assert.equal(outOfBand.tiers.D4.inBand, false, '0/4 is below the 12-40% band');
  assert.equal(outOfBand.allInBand, false);
});

// The published D1–D4 band is a live-sweep gate, not a unit invariant, so it is
// opt-in (`COCS_SLOW_TESTS=1`) and reads the same validator the wave report uses.
test('D1-D4 sampled win rates sit inside their published bands', {skip: process.env.COCS_SLOW_TESTS !== '1'}, async () => {
  const {runCoop, summariseCoop, summariseCoopTiers} = await import('../scripts/cocs-validate.mjs');
  const seeds = [1, 2, 3, 4, 5];
  const byTier = {};
  for (const tier of ['D1', 'D2', 'D3', 'D4']) {
    byTier[tier] = summariseCoop(seeds.map(seed => runCoop(seed, {seconds: 900, tier})));
  }
  const table = summariseCoopTiers(byTier);
  for (const tier of ['D1', 'D2', 'D3', 'D4']) {
    const rate = byTier[tier].result.sample ? byTier[tier].result.wins / byTier[tier].result.sample : 0;
    const band = DIRECTOR_TIERS[tier].band;
    assert.ok(rate >= band[0] - 1e-9 && rate <= band[1] + 1e-9, `${tier} ${rate} not inside ${band}`);
  }
  assert.ok(table.tiers.D1 && table.tiers.D4);
});

test('O1c terminals/roles/command stay out of PvPvE `cocs` snapshots', () => {
  const pvp = new Match('chatgpt', 'openclaw', mulberry32(3), 'warfront', {mode: 'cocs', humanCount: 1, botCount: 3, aiSeats: true, timeLimit: 60});
  step(pvp, 30);
  const state = pvp.objectiveState;
  assert.equal(state.terminals, undefined, 'no terminal tree in PvPvE');
  const snap = cocsSnapshot(pvp);
  assert.equal(snap.terminals, undefined, 'no terminal snapshot in PvPvE');
  assert.equal(snap.director, undefined);
  assert.equal(snap.command, undefined);
  assert.equal(Object.hasOwn(snap.nodes[0], 'hack'), false, 'PvPvE nodes never carry a hack window');
  assert.equal(Object.hasOwn(snap.nodes[0], 'prime'), false, 'PvPvE nodes never carry a prime');
  // And a co-op frame does expose them.
  const coop = coopMatch({seed: 41});
  step(coop, 30);
  const coopSnap = cocsSnapshot(coop);
  assert.ok(Array.isArray(coopSnap.terminals) && coopSnap.terminals.length > 0, 'co-op exposes the flat terminal array');
  assert.ok(coopSnap.coop && Array.isArray(coopSnap.terminalState?.terminals), 'the raw id-keyed tree stays available as terminalState');
  assert.ok(coopSnap.command && coopSnap.command.lease, 'command.lease is exposed additively');
  assert.ok(Array.isArray(coopSnap.command.slices));
  assert.ok(coopSnap.roles && coopSnap.roles.threads, 'the role/thread tree is exposed');
});

test('the co-op snapshot feeds the terminal/role UI views end to end', async () => {
  const {cocsTerminalView} = await import('./cocs-orders.mjs');
  const m = coopMatch({seed: 67});
  step(m, 2);
  const snap = cocsSnapshot(m);
  const view = cocsTerminalView(snap, {id: 0, team: 0}, {nodes: [], front: null, hint: null});
  assert.equal(view.hasTerminals, true, 'the terminal panel lights up from the sim snapshot');
  assert.ok(view.terminals.length > 0);
  assert.equal(view.terminals.every(terminal => terminal.kindMark.length > 0 && terminal.stateLabel.length > 0), true);
  assert.equal(view.hasRoles, true, 'the W21 role object normalizes into entries');
  assert.deepEqual(view.roles.map(role => role.id).sort(), ['builder', 'fighter', 'harvester', 'scout']);
  assert.equal(view.roles.every(role => role.label.length > 0 && role.stateLabel.length > 0), true);
});
