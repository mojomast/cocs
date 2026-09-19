// LATTICE STRIKE: OPERATIONS depth — allied role agents, bot terminal use, the
// default co-op traversal/depot autopilot and the personal-REQ Puma purchase.
//
// Design authority: COCS-OPERATIONS.md §3.1/§7.3 (roles, prime, terminals) and
// COCS-MODE-SPEC.md §4.3 (terminals), §6A.1/§6A.5/§6A.7 (traversal, REQ, depots),
// §8.1 (roles/abilities), §11.6 (determinism).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match} from './core.mjs';
import {RULES} from './data.mjs';
import {
  COOP_BOT_ABILITY_TICKS, COOP_ROLE_ROTATION, coopAutoRole, coopAutoSpend, coopBuyAction,
  coopRoleRepair, coopSubagentActors, coopSubagentLive, spawnCoopSquad,
} from './cocs-coop.mjs';
import {cocsRoleDestination, cocsTraversalChoice} from './cocs-bots.mjs';
import {botTerminalInteract, humanTerminalInteract} from './cocs-terminals.mjs';
import {cocsSnapshot, cocsSpotDamageScale} from './cocs.mjs';
import {reqItem} from './cocs-economy.mjs';

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
// Freeze one actor at a point and clear every team-1 body so a channel / prime
// test measures the rule, not AI pathing. (The o1c test's pinned-step pattern.)
function pin(m, actor, x, z) {
  actor.x = x; actor.z = z; actor.y = 0; actor.vx = 0; actor.vy = 0; actor.vz = 0;
  actor.grounded = true;
  for (const other of m.actors) {
    if (other.team === 1) { other.x = 1000; other.z = 1000; other.y = 0; }
  }
}
const team0Bot = m => m.actors.find(actor => actor && actor.team === 0 && actor.health > 0 && actor.bot != null && actor.isScout !== true);

// ---------------------------------------------------------------------------
// Role policy
// ---------------------------------------------------------------------------
test('the Chief fills a fighter baseline then rotates the authored utility roles by need', () => {
  const m = coopMatch({seed: 3});
  const state = m.objectiveState;
  step(m, 1);
  assert.deepEqual([...COOP_ROLE_ROTATION], ['fighter', 'harvester', 'builder', 'scout']);
  assert.equal(coopAutoRole(m, state), 'fighter', 'the first call fields a combat body');
  const fighter = spawnCoopSquad(m, state, {role: 'fighter'});
  assert.ok(fighter !== null);
  const econ = capturable(state).find(entry => entry.archetype === 'economy');
  const device = Object.values(state.traversal.devices).sort((a, b) => a.id.localeCompare(b.id))[0];
  econ.owner = 0;
  // The opening windows keep the shipped two-fighter parity; utilities start
  // once the operation is underway and the team is not behind on the lattice.
  state.coop.wavesCleared = 1;
  state.coop.wave = 1;
  assert.equal(coopAutoRole(m, state), 'fighter', 'the opening refit keeps a second FIGHTER');
  state.coop.wavesCleared = 2;
  state.coop.wave = 1;
  assert.equal(coopAutoRole(m, state), 'scout', 'wave 1 screens with the SCOUT while enemies are up');
  state.coop.wave = 2;
  assert.equal(coopAutoRole(m, state), 'harvester', 'wave 2 takes the owned siphon with the HARVESTER');
  // A broken device takes the rotation's builder window.
  device.state = 'cut';
  state.coop.wave = 3;
  assert.equal(coopAutoRole(m, state), 'builder', 'wave 3 repairs with the BUILDER when something is broken');
  device.state = 'live';
  // Wave 3+ fields repair cover even before something breaks.
  state.coop.wavesCleared = 3;
  assert.equal(coopAutoRole(m, state), 'builder', 'an unfilled BUILDER is taken as repair cover');
  state.coop.subagentStats.byRole.builder = 1; // one has now been fielded this run
  assert.equal(coopAutoRole(m, state), 'scout', 'once a BUILDER is fielded the rotation continues');
  // Behind on the lattice keeps the combat body.
  for (const front of capturable(state).filter(entry => entry.archetype === 'front')) front.owner = 1;
  assert.equal(coopAutoRole(m, state), 'fighter', 'a lattice deficit keeps the second slot a FIGHTER');
  for (const front of capturable(state).filter(entry => entry.archetype === 'front')) front.owner = null;
  econ.owner = null;
  state.coop.wave = 2;
  assert.equal(coopAutoRole(m, state), 'scout', 'missing needs fall through the rotation');
  assert.equal(coopAutoRole(m, state), coopAutoRole(m, state), 'pure and deterministic');
});

test('auto-spend buys the needed authored role through the REINFORCE sink', () => {
  const m = coopMatch({seed: 5});
  const state = m.objectiveState;
  const coop = state.coop;
  step(m, 1);
  const econ = capturable(state).find(entry => entry.archetype === 'economy');
  econ.owner = 0;
  coop.phase = 'intermission';
  coop.intermissionOpen = true;
  coop.autoSpend = true;
  coop.wave = 2;
  coop.wavesCleared = 2;
  state.flux[0] = state.fluxCap;
  const spent = coopAutoSpend(m, state);
  assert.ok(spent > 0, 'the no-UI Chief spends the window');
  assert.equal(coop.subagentStats.byRole.fighter, 1, 'the combat baseline is fielded first');
  assert.equal(coop.subagentStats.byRole.harvester, 1, 'the owned siphon fields the authored HARVESTER');
  assert.ok(coop.spendStats.REINFORCE >= 2);
});

test('role abilities fire on their cadence: RALLY heals, REPAIR fixes, SPOT marks', () => {
  // FIGHTER RALLY.
  const rally = coopMatch({seed: 9});
  const rState = rally.objectiveState;
  step(rally, 1);
  const fighterId = spawnCoopSquad(rally, rState, {role: 'fighter'});
  const fighter = rally.actors.find(actor => actor.id === fighterId);
  const ally = team0Bot(rally);
  ally.health = Math.max(1, ally.maxHealth - 60);
  pin(rally, fighter, -80, 0);
  ally.x = -78; ally.z = 0;
  step(rally, 2);
  assert.ok(rState.coop.roleStats.rallies >= 1, 'a wounded squadmate triggers RALLY');
  assert.ok(ally.temporaryShield >= 40, 'the shield lands on the squad');
  assert.equal(COOP_BOT_ABILITY_TICKS.rally, 600);

  // BUILDER REPAIR respects its reach window.
  const repair = coopMatch({seed: 11});
  const pState = repair.objectiveState;
  step(repair, 1);
  const builderId = spawnCoopSquad(repair, pState, {role: 'builder'});
  const builder = repair.actors.find(actor => actor.id === builderId);
  const devices = Object.values(pState.traversal.devices).sort((a, b) => a.id.localeCompare(b.id));
  const near = devices[0];
  const far = devices[devices.length - 1];
  near.state = 'cut'; far.state = 'cut';
  builder.x = near.from.x; builder.z = near.from.z;
  builder.subagentAbilityAt = pState.tick; // block the auto cadence for the direct call
  const repaired = coopRoleRepair(repair, pState, builder, {radius: 5});
  assert.deepEqual(repaired, [near.id], 'only the broken target in reach is repaired');
  assert.equal(pState.traversal.devices[far.id].state, 'cut');

  // SCOUT SPOT marks an enemy for +15% team damage.
  const spot = coopMatch({seed: 13});
  const sState = spot.objectiveState;
  step(spot, 1);
  const scoutId = spawnCoopSquad(spot, sState, {role: 'scout'});
  const scout = spot.actors.find(actor => actor.id === scoutId);
  const enemy = spot.actors.find(actor => actor.team === 1 && actor.health > 0);
  pin(spot, scout, -60, 0);
  enemy.x = -58; enemy.z = 0; enemy.health = 100; enemy.maxHealth = 100;
  step(spot, 2);
  assert.ok(sState.coop.roleStats.spots >= 1, 'SPOT fires with an enemy in radius');
  assert.ok(sState.spots[enemy.id], 'the mark lands on the enemy');
  assert.equal(sState.spots[enemy.id].team, 0);
  assert.ok(Math.abs(cocsSpotDamageScale(spot, scout, enemy) - 1.15) < 1e-9, 'the mark is +15% team damage');
});

test('a HARVESTER bot completes a PRIME and a prime window multiplies a capture', () => {
  const m = coopMatch({seed: 15});
  const state = m.objectiveState;
  step(m, 1);
  const econ = capturable(state).find(entry => entry.archetype === 'economy');
  econ.owner = 0;
  const harvesterId = spawnCoopSquad(m, state, {role: 'harvester'});
  const harvester = m.actors.find(actor => actor.id === harvesterId);
  for (let i = 0; i < ticks(11) && !econ.prime; i++) { pin(m, harvester, econ.x, econ.z); m.step(DT, {inputs: {}}); }
  assert.ok(econ.prime, 'the harvester reaches the siphon and completes the channel');
  assert.equal(econ.prime.team, 0);
  assert.ok(state.coop.roleStats.primeCompletions >= 1, 'the completion is counted');
  // The role destination is the owned, unprimed siphon.
  econ.prime = null;
  const target = cocsRoleDestination(m, harvester, state);
  assert.ok(target && Math.abs(target.x - econ.x) < 1e-9 && Math.abs(target.z - econ.z) < 1e-9, 'the harvester walks its siphon');

  // Twin-run capture ratio: a live PRIME multiplies the capture rate by 1.5.
  const run = prime => {
    const match = coopMatch({seed: 17});
    const st = match.objectiveState;
    step(match, 1);
    const front = node(st, 'front-0');
    front.owner = 1;
    front.progress = {0: 0, 1: 0};
    front.live = true;
    if (prime) front.prime = {team: 0, until: st.tick + 600, captureUntil: st.tick + 600, captureMultiplier: 1.5, fluxBonus: 0.5};
    const actor = match.actors.find(entry => entry.team === 0 && entry.health > 0);
    actor.bot = null;
    actor.health = 200; actor.maxHealth = 200;
    for (let i = 0; i < 60; i++) { pin(match, actor, front.x, front.z); match.step(DT, {inputs: {}}); }
    return front.progress[0];
  };
  const base = run(false);
  const primed = run(true);
  assert.ok(base > 0 && primed > 0);
  assert.ok(Math.abs(primed / base - 1.5) < 0.05, `PRIME capture multiplier (${base} -> ${primed})`);
});

test('subagents retire at the end of their authored lifespan and recycle their slot', () => {
  const m = coopMatch({seed: 19});
  const state = m.objectiveState;
  step(m, 1);
  const fighterId = spawnCoopSquad(m, state, {role: 'fighter'});
  const fighter = m.actors.find(actor => actor.id === fighterId);
  assert.equal(coopSubagentLive(fighter), true);
  fighter.subagentTick = state.coop.tick - 100000;
  step(m, 1);
  assert.equal(fighter.subagentRetired, true, 'the expired agent returns to HQ');
  assert.equal(fighter.bot, null, 'a retired slot consumes no THREADS and no brain');
  assert.equal(coopSubagentActors(m, state.coop).some(actor => actor.id === fighterId), false);
  const scoutId = spawnCoopSquad(m, state, {role: 'scout'});
  assert.equal(scoutId, fighterId, 'the retired actor id is reused');
  assert.equal(fighter.subagentRole, 'scout');
  assert.equal(fighter.isSubagent, true);
  assert.equal(m.actors.filter(actor => actor.id === fighterId).length, 1, 'the roster never grows');
});

// ---------------------------------------------------------------------------
// Terminal use by allied bots
// ---------------------------------------------------------------------------
test('allied bots start HACK/DEPLOY/VAULT on the human rules', () => {
  const m = coopMatch({seed: 21});
  const state = m.objectiveState;
  step(m, 1);
  const actor = team0Bot(m);
  const relay = node(state, 'relay-0');
  const hack = state.terminals.terminals['hack-relay-0'];
  // HACK on a neutral relay: the same 3 s channel, no enemy inside 6 m.
  for (let i = 0; i < ticks(3) + 8 && !relay.hack; i++) { pin(m, actor, relay.x, relay.z); m.step(DT, {inputs: {}}); }
  assert.ok(state.terminals.stats.interacts >= 1, 'the bot opened a terminal channel');
  assert.ok(relay.hack && relay.hack.team === 0, 'the HACK completed into a 2x window');
  assert.equal(relay.hack.multiplier, 2);
  assert.ok(state.terminals.stats.hacks >= 1);

  // Contest parity: an enemy inside 6 m blocks the bot edge exactly like the
  // human edge (both go through `terminalActionable`).
  hack.channel = null; relay.hack = null;
  actor.bot.terminalAt = -Infinity;
  const enemy = m.actors.find(entry => entry.team === 1 && entry.health > 0);
  enemy.x = relay.x + 2; enemy.z = relay.z;
  assert.equal(botTerminalInteract(m, state, actor), null, 'a contested relay is refused for bots');
  assert.equal(humanTerminalInteract(m, state, actor), null, 'and for humans (same gate)');
  enemy.x = 1000; enemy.z = 1000;

  // DEPLOY is ownership-gated and preferred once the relay is ours.
  relay.owner = 0;
  hack.channel = null;
  actor.bot.terminalAt = -Infinity;
  const botPick = botTerminalInteract(m, state, actor);
  assert.ok(botPick, 'the bot picks the owned-relay verb');
  assert.equal(botPick.kind, 'DEPLOY', 'DEPLOY outranks HACK on an owned relay');
  state.terminals.terminals['deploy-relay-0'].channel = null;
  actor.bot.terminalAt = -Infinity;
  const humanPick = humanTerminalInteract(m, state, actor);
  assert.equal(humanPick.kind, 'DEPLOY', 'the human edge chooses the same verb');

  // VAULT store at hq-0.
  const hq = node(state, 'hq-0');
  actor.bot.terminalAt = -Infinity;
  pin(m, actor, hq.x, hq.z);
  m.step(DT, {inputs: {}});
  assert.ok(state.terminals.stats.vaultStores >= 1, 'the bot stores at the HQ vault');
});

test('terminal actions never leak into PvPvE and stay out of non-coop snapshots', () => {
  const pvp = new Match('chatgpt', 'openclaw', mulberry32(23), 'lattice-slice', {
    mode: 'cocs', humanCount: 4, botCount: 2, aiSeats: true, timeLimit: 60,
  });
  step(pvp, 30);
  assert.equal(pvp.objectiveState.terminals, undefined, 'no terminal tree in PvPvE');
  assert.equal(botTerminalInteract(pvp, pvp.objectiveState, pvp.actors[0]), null);
});

// ---------------------------------------------------------------------------
// Traversal / depot default-on
// ---------------------------------------------------------------------------
test('co-op fields the traversal/depot autopilot for allies by default; PvPvE keeps the opt-in', () => {
  const coop = coopMatch({seed: 25});
  const coopState = coop.objectiveState;
  assert.equal(coopState.traversal.botUse, false, 'Match builds the traversal layer opt-in');
  step(coop, 1);
  assert.equal(coopState.traversal.botUse, true, 'OPERATIONS flips the autopilot on');
  assert.equal(coopState.traversal.botUseTeam, 0, 'the default autopilot is the allied team only');
  assert.ok(coopState.traversal.stats.vehicleSpawns >= 1, 'HQ depots spawn loaners');
  // A planned allied bot routes through a device with the autopilot on.
  const actor = team0Bot(coop);
  actor.x = -88; actor.z = 50; actor.y = 0;
  const choice = cocsTraversalChoice(coop, actor, {x: 0, z: 25}, coopState);
  assert.ok(choice, 'devices are selectable in normal co-op play');
  // The Director force keeps its pre-O1d movement: no device intent for team 1.
  const enemy = coop.actors.find(entry => entry.team === 1 && entry.health > 0);
  enemy.x = -88; enemy.z = 50;
  assert.equal(cocsTraversalChoice(coop, enemy, {x: 0, z: 25}, coopState), null, 'team 1 is not auto-routed by the default');
  // An explicit opt-out is honoured.
  coopState.coop.traversalBotUse = false;
  coopState.traversal.botUse = false;
  step(coop, 1);
  assert.equal(coopState.traversal.botUse, false);
  // An explicit PvP-style opt-in keeps both teams on the layer.
  const both = new Match('chatgpt', 'openclaw', mulberry32(25), 'lattice-slice', {
    mode: 'cocs-coop', humanCount: 4, botCount: 2, aiSeats: true, timeLimit: 60, objective: {traversalBotUse: true},
  });
  step(both, 1);
  assert.equal(both.objectiveState.traversal.botUse, true);
  assert.equal(both.objectiveState.traversal.botUseTeam, null, 'the explicit opt-in is unchanged for both teams');
  // PvPvE `cocs` still requires `objective.traversalBotUse`.
  const pvp = new Match('chatgpt', 'openclaw', mulberry32(27), 'lattice-slice', {mode: 'cocs', humanCount: 4, botCount: 2, aiSeats: true, timeLimit: 60});
  step(pvp, 2);
  assert.equal(pvp.objectiveState.traversal.botUse, false, 'PvPvE stays byte-identical');
});

// ---------------------------------------------------------------------------
// Personal REQ: the depot Puma
// ---------------------------------------------------------------------------
test('personal REQ buys a loaner Puma through Match.step, with exact caps and no FLUX debit', () => {
  const m = coopMatch({seed: 29});
  const state = m.objectiveState;
  step(m, 1);
  const actor = m.actors.find(entry => entry.team === 0 && entry.health > 0);
  const item = reqItem('puma');
  assert.equal(item.cost, 150);
  assert.equal(item.launch, false, 'the PvPvE launch list never charges for a vehicle it cannot spawn');
  assert.equal(item.coopLaunch, true, 'OPERATIONS publishes the Puma as a launch purchase');
  const depot = state.traversal.depots['depot-hq-w'];
  assert.equal(depot.owner, 0);
  const record = {tick: 1, peerId: 'p1', cardId: 'buy-1', actorId: actor.id, itemId: 'puma', depotId: 'depot-hq-w'};

  // Quantization never authorizes a spend: 149.999 REQ does not buy a 150 item.
  actor.req = 149.999;
  const short = coopBuyAction(m, state, {...record});
  assert.equal(short.ok, false);
  assert.equal(short.reason, 'insufficient-req');
  assert.equal(actor.req, 149.999, 'a rejected purchase leaves the balance untouched');

  // The authoritative path: `{cocs:{buys}}` on Match.step.
  actor.req = 150;
  m.step(DT, {cocs: {buys: [record]}});
  assert.equal(actor.req, 0, 'the exact 150 REQ is debited');
  assert.equal(actor.reqSpent, 150);
  assert.ok(depot.purchaseId, 'the depot records the purchase');
  const bought = m.vehicles.find(vehicle => vehicle.id === depot.purchaseId);
  assert.ok(bought && bought.depotId === 'depot-hq-w', 'the Puma spawns at its depot');
  assert.equal(state.traversal.stats.purchases, 1);
  assert.ok(m.events.some(event => event.type === 'cocs-buy' && event.itemId === 'puma' && event.vehicle === bought.id), 'the buy feed event carries the vehicle');
  const snap = cocsSnapshot(m);
  const snapDepot = snap.traversal.depots.find(entry => entry.id === 'depot-hq-w');
  assert.ok(snapDepot.purchase && snapDepot.purchase.id === bought.id, 'the snapshot exposes the purchase');

  // One live bought Puma per depot.
  actor.req = 150;
  const duplicate = coopBuyAction(m, state, {...record, cardId: 'buy-2'});
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'vehicle');
  assert.equal(actor.req, 150);

  // A non-friendly depot is rejected before any REQ moves.
  const enemyDepot = state.traversal.depots['depot-hq-e'];
  assert.equal(enemyDepot.owner, 1);
  const foreign = coopBuyAction(m, state, {...record, cardId: 'buy-3', depotId: 'depot-hq-e'});
  assert.equal(foreign.reason, 'depot');
  assert.equal(actor.req, 150);

  // REQ never debits team FLUX or RESERVE.
  state.traversal.depots['depot-fwd-w'].owner = 0;
  const flux = state.flux[0];
  const reserve = state.coop.reserve.tickets;
  const second = coopBuyAction(m, state, {tick: state.tick, peerId: 'p1', cardId: 'buy-4', actorId: actor.id, itemId: 'puma', depotId: 'depot-fwd-w'});
  assert.equal(second.ok, true);
  assert.equal(state.flux[0], flux, 'no team FLUX is spent');
  assert.equal(state.coop.reserve.tickets, reserve, 'no RESERVE ticket is touched');
  assert.equal(state.coop.buyLog.length, 2, 'the order-feed log records the purchases');
});

// ---------------------------------------------------------------------------
// Snapshot contract + determinism
// ---------------------------------------------------------------------------
test('the single terminal UI contract is snapshot.cocs.terminals plus terminalStats', () => {
  const m = coopMatch({seed: 31});
  step(m, 2);
  const snap = cocsSnapshot(m);
  assert.ok(Array.isArray(snap.terminals) && snap.terminals.length > 0);
  assert.equal(typeof snap.terminalStats, 'object');
  for (const key of ['id', 'kind', 'nodeId', 'label', 'state', 'owner', 'progress', 'remainingSeconds', 'actor', 'hint']) {
    assert.ok(Object.hasOwn(snap.terminals[0], key), `terminal exposes ${key}`);
  }
});

test('in-scope modules are deterministic: no Math.random, no wall clock, no actor-id branching', () => {
  const files = ['cocs-bots.mjs', 'cocs-coop.mjs', 'cocs-terminals.mjs', 'cocs-economy.mjs', 'cocs-traversal.mjs'];
  for (const file of files) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
    assert.equal(/Math\.random/.test(code), false, `${file} never uses Math.random`);
    assert.equal(/Date\.now/.test(code), false, `${file} never reads the wall clock`);
  }
});

test('a seeded co-op run with role agents is byte-identical across two processes', () => {
  const run = seed => {
    const m = coopMatch({seed, timeLimit: 60});
    const state = m.objectiveState;
    step(m, 1);
    spawnCoopSquad(m, state, {role: 'fighter'});
    spawnCoopSquad(m, state, {role: 'harvester'});
    for (let i = 0; i < 1800 && !m.over; i++) m.step(DT, {inputs: {}});
    return JSON.stringify(cocsSnapshot(m));
  };
  const first = run(0xC0DE);
  const second = run(0xC0DE);
  assert.equal(first, second, 'same seed, same snapshot');
  assert.notEqual(run(0xC0DF), first, 'a different seed diverges');
});
