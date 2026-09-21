// LATTICE STRIKE PvP-1 (section 12.3b) — rung ladder, two-team command,
// SABOTEUR, and the per-team `cocs` visibility shape.
//
// The rung ladder is data (`game/config.mjs`); the two-team command, the role
// board and the SABOTEUR verbs live in `game/cocs.mjs`. Everything here is
// deterministic: one injected RNG, fixed `RULES.dt`, id-sorted arrays.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {
  DEFAULT_CONFIG, GAME_MODES, COCS_RUNGS, COCS_RUNG_IDS, cocsRung, cocsRungForPlayers,
  cocsRungOf, cocsRoleAllowed, cocsRungRoles, normalizeConfig, cocsRungFill, cocsRungMeetsMinimum,
} from './config.mjs';
import {FLUX_CAP, FLUX_START, NEGLECT} from './cocs-economy.mjs';
import {COOP_ROLE_IDS, PVP_ROLE_IDS, ROLE_ABILITIES, coopRole, roleAbility} from './cocs-roles.mjs';
import {
  COCS_ROLE_TARGET_CONCURRENCY, COCS_SIPHON_FLUX, cocsBuyAction, cocsCommandAction,
  cocsDutyRolePolicy, cocsEconomyAction, cocsNeglectContext, cocsRoleActors,
  cocsRoleAllowedOnRung, cocsRoleBoardSnapshot, cocsRoleSpawn, cocsSaboteurAct, cocsSapper,
  cocsSiphon, cocsSnapshot, cocsTeamCommand, cocsTeamVisibility, cocsThreadsUsed, spawnScout,
} from './cocs.mjs';

const DT = 1 / 60;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A PvP `cocs` match on the warfront stand-in lattice. `rung` is explicit, like
// a laddered queue entry; `npc:false` keeps the roster deterministic.
const pvpMatch = (rung = null, over = {}) => new Match('chatgpt', 'openclaw', () => 0.5, 'warfront', {
  mode: 'cocs', ...(rung ? {rung} : {}), botCount: 3, humanCount: 1, timeLimit: 300, ...over,
});
const coopMatch = () => new Match('chatgpt', 'openclaw', mulberry32(11), 'warfront', {
  mode: 'cocs-coop', botCount: 2, humanCount: 4, aiSeats: true, timeLimit: 900,
});
const node = (state, id) => state.nodes.find(entry => entry.id === id);
const step = (match, ticks) => { for (let i = 0; i < ticks && !match.over; i++) match.step(DT, {inputs: {}}); };

// ---------------------------------------------------------------------------
// Rung ladder.
// ---------------------------------------------------------------------------
test('the 4v4 and 8v8 rungs publish the section 3.1 seat, role and economy data', () => {
  assert.deepEqual(COCS_RUNG_IDS, ['4v4', '8v8']);
  assert.equal(cocsRung('4v4'), COCS_RUNGS['4v4']);
  assert.equal(cocsRung(' 8V8 '), COCS_RUNGS['8v8'], 'rung ids resolve case-insensitively');
  assert.equal(cocsRung('12v12'), null, 'the gated flagship is not a rung row');
  assert.equal(cocsRungForPlayers(8), '4v4');
  assert.equal(cocsRungForPlayers(16), '8v8');
  assert.equal(cocsRungForPlayers(24), null, '12v12 is gated, not silently opened');

  const four = COCS_RUNGS['4v4'];
  const eight = COCS_RUNGS['8v8'];
  assert.deepEqual(four.roles, ['fighter', 'harvester', 'builder']);
  assert.deepEqual(eight.roles, ['fighter', 'harvester', 'builder', 'scout', 'saboteur']);
  assert.equal(four.total, 8);
  assert.equal(eight.total, 16);
  // The rung economy mirrors the one economy module (section 3.2/6.5).
  for (const rung of [four, eight]) {
    assert.equal(rung.fluxStart, FLUX_START);
    assert.equal(rung.fluxCap, FLUX_CAP);
    assert.equal(rung.threads, 3);
    assert.deepEqual(rung.live, {opening: 3, max: 5, endgame: 5});
  }
  // The allow-list gate: 4v4 can never field SCOUT or SABOTEUR.
  assert.equal(cocsRoleAllowed('4v4', 'scout'), false);
  assert.equal(cocsRoleAllowed('4v4', 'saboteur'), false);
  assert.equal(cocsRoleAllowed('4v4', 'fighter'), true);
  assert.equal(cocsRoleAllowed('8v8', 'saboteur'), true);
  assert.equal(cocsRoleAllowed(null, 'saboteur'), true, 'an un-laddered practice match keeps all five');
  assert.deepEqual(cocsRungRoles('4v4'), ['fighter', 'harvester', 'builder']);
  // Bot fill keeps a stable ratio to the rung's published total.
  assert.equal(cocsRungFill('4v4', 8), 0);
  assert.equal(cocsRungFill('8v8', 8), 8);
  assert.equal(cocsRungFill('8v8', 16), 0);
  assert.equal(cocsRungMeetsMinimum('4v4', 8), true);
  assert.equal(cocsRungMeetsMinimum('8v8', 7), false, 'below the 4v4 floor the queue falls back, never auto-starts');
  assert.equal(cocsRungMeetsMinimum('8v8', 8), true);
});

test('a rung rides the normalized config, and every other mode stays rung-free', () => {
  assert.equal(normalizeConfig({mode: 'cocs', rung: '8v8'}).rung, '8v8');
  assert.equal(normalizeConfig({mode: 'cocs', rung: 'nonsense'}).rung, undefined);
  assert.equal(normalizeConfig({mode: 'cocs'}).rung, undefined, 'an un-laddered practice match is untouched');
  assert.equal(normalizeConfig({mode: 'cocs-coop', rung: '8v8'}).rung, undefined, 'co-op never has a rung');
  assert.equal(normalizeConfig({mode: 'deathmatch', rung: '8v8'}).rung, undefined);
  assert.equal(cocsRungOf({rung: '4v4'}), '4v4');
  assert.equal(cocsRungOf({}), null);
  // `normalizeConfig(null)` still deep-equals the frozen default.
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  const cocsMode = GAME_MODES.find(mode => mode.id === 'cocs');
  assert.equal(cocsMode.rules.maxBots, 16, 'the 8v8 rung budgets 16 seats');
  assert.equal(cocsMode.rules.rungs, COCS_RUNGS);
  assert.equal(GAME_MODES.find(mode => mode.id === 'cocs-coop').rules.rungs, undefined);
});

test('the rung gates which roles the board can spawn, and co-op keeps its own set', () => {
  assert.deepEqual(COOP_ROLE_IDS, ['fighter', 'harvester', 'builder', 'scout']);
  assert.deepEqual(PVP_ROLE_IDS, ['fighter', 'harvester', 'builder', 'scout', 'saboteur']);
  assert.ok(coopRole('saboteur'), 'SABOTEUR is in the shared role table');

  const four = pvpMatch('4v4');
  assert.equal(four.objectiveState.rung, '4v4');
  assert.deepEqual(four.objectiveState.roleAllow, ['fighter', 'harvester', 'builder']);
  assert.equal(cocsRoleSpawn(four, four.objectiveState, 0, 'saboteur'), null, 'no SABOTEUR on 4v4');
  assert.equal(cocsRoleSpawn(four, four.objectiveState, 0, 'scout'), null, 'the role board never doubles the SCAN scout');
  assert.equal(spawnScout(four, four.objectiveState, 0, node(four.objectiveState, 'front-e')), null, '4v4 cannot spawn a SCAN scout');
  assert.ok(cocsRoleSpawn(four, four.objectiveState, 0, 'fighter'), 'a 4v4-legal role spawns');

  const eight = pvpMatch('8v8');
  assert.equal(eight.objectiveState.rung, '8v8');
  assert.deepEqual(eight.objectiveState.roleAllow, ['fighter', 'harvester', 'builder', 'scout', 'saboteur']);
  assert.ok(cocsRoleSpawn(eight, eight.objectiveState, 1, 'saboteur'), '8v8 fields SABOTEUR');
  assert.equal(cocsRoleAllowedOnRung(eight.objectiveState, 'saboteur'), true);
  assert.equal(cocsRoleAllowedOnRung(four.objectiveState, 'saboteur'), false);

  // The duty board never queues a role the rung excludes: 4v4 spawns only the
  // three-role set; 8v8 can rotate SABOTEUR in.
  const board = pvpMatch('4v4');
  for (let tick = 1; tick <= 2400; tick++) {
    board.objectiveState.tick = tick;
    cocsDutyRolePolicy(board, board.objectiveState, {tick});
    for (const team of [0, 1]) {
      assert.equal((board.objectiveState.roleStats[team].byRole.saboteur ?? 0), 0, `4v4 team ${team} never spawns SABOTEUR`);
      assert.equal((board.objectiveState.roleStats[team].byRole.scout ?? 0), 0, `4v4 team ${team} never spawns SCOUT`);
    }
  }
});

// ---------------------------------------------------------------------------
// Two-team command.
// ---------------------------------------------------------------------------
test('each team runs its own duty Chief with its own FLUX, THREADS and orders', () => {
  const match = pvpMatch('8v8');
  const state = match.objectiveState;
  step(match, 4);
  const command0 = cocsTeamCommand(match, state, 0);
  const command1 = cocsTeamCommand(match, state, 1);
  assert.deepEqual(command0.chief, 'chief-0');
  assert.deepEqual(command1.chief, 'chief-1');
  assert.equal(command0.team, 0);
  assert.equal(command1.team, 1);
  assert.deepEqual(command0.threads.cap, 3);
  assert.deepEqual(command1.threads.cap, 3);
  assert.equal(command0.flux, state.flux[0]);
  assert.equal(command1.flux, state.flux[1]);

  // Per-team orders are independent: a team-0 ATTACK task never becomes team 1's.
  const stateTask = {verb: 'ATTACK', nodeId: 'front-e', tick: 1, until: 9999, peerId: 'chief-0', cardId: '0-1'};
  state.tasks[0] = stateTask;
  assert.equal(cocsTeamCommand(match, state, 0).task.nodeId, 'front-e');
  assert.equal(cocsTeamCommand(match, state, 1).task, null);
});

test('two-team order processing is arrival-order independent', () => {
  const orders = [
    {tick: 1, peerId: 'c', cardId: '3', team: 1, verb: 'ATTACK', target: 'front-e'},
    {tick: 1, peerId: 'a', cardId: '1', team: 0, verb: 'ATTACK', target: 'front-w'},
    {tick: 1, peerId: 'b', cardId: '2', team: 0, verb: 'HOLD', target: 'front-w'},
    {tick: 1, peerId: 'a', cardId: '0', team: 1, verb: 'HOLD', target: 'front-e'},
  ];
  const runOrder = list => {
    const match = pvpMatch('8v8');
    const state = match.objectiveState;
    state.pendingOrders = [...list];
    // Consume both teams' tasks so the last valid order per team wins.
    match.step(DT, {inputs: {}});
    return JSON.stringify({0: state.tasks[0], 1: state.tasks[1]});
  };
  const forward = runOrder(orders);
  const reversed = runOrder([...orders].reverse());
  assert.equal(forward, reversed, 'reversing arrival order cannot change either team task');
});

test('the per-team role board spawns deterministically from the rung cadence', () => {
  const first = pvpMatch('8v8');
  const second = pvpMatch('8v8');
  for (const match of [first, second]) {
    for (let tick = 1; tick <= 1200 && !match.over; tick++) match.step(DT, {inputs: {}});
  }
  const board0 = cocsRoleBoardSnapshot(first, first.objectiveState, 0);
  const board1 = cocsRoleBoardSnapshot(second, second.objectiveState, 0);
  assert.deepEqual(board0, board1, 'a fixed seed yields a byte-identical role board');
  // The live roster never exceeds the board's target concurrency.
  for (const team of [0, 1]) {
    assert.ok(cocsRoleActors(first, first.objectiveState, team).length <= COCS_ROLE_TARGET_CONCURRENCY);
    assert.equal(cocsThreadsUsed(first, first.objectiveState, team), cocsTeamCommand(first, first.objectiveState, team).threads.used);
  }
});

// ---------------------------------------------------------------------------
// SABOTEUR.
// ---------------------------------------------------------------------------
test('SABOTEUR ships the SAPPER and SIPHON abilities and is 8v8-only', () => {
  const abilities = ROLE_ABILITIES.saboteur;
  assert.ok(Array.isArray(abilities) && abilities.length === 2);
  assert.equal(roleAbility('saboteur', 'ATTACK').label, 'SAPPER');
  assert.equal(roleAbility('saboteur', 'SIPHON').label, 'SIPHON');
  assert.ok(roleAbility('saboteur', 'ATTACK').enemyOnly);
  assert.ok(roleAbility('saboteur', 'SIPHON').enemyOnly);
  const def = coopRole('saboteur');
  assert.equal(def.spawnCost, 14);
  assert.equal(def.health, 90);
  assert.equal(def.lifespanSeconds, 90);
});

test('SAPPER cuts an enemy link, pays the denial bounty and expires its window', () => {
  const match = pvpMatch('8v8');
  const state = match.objectiveState;
  const saboteur = cocsRoleSpawn(match, state, 0, 'saboteur', 'front-e');
  assert.ok(saboteur);
  // Make front-e enemy-owned and connected so the cut actually denies income.
  const frontE = node(state, 'front-e');
  frontE.owner = 1;
  assert.equal(frontE.owner, 1);
  saboteur.x = frontE.x; saboteur.z = frontE.z; saboteur.y = frontE.y;
  const fluxBefore = state.flux[0];
  const result = cocsSapper(match, state, saboteur, 'front-e');
  assert.equal(result.ok, true);
  assert.ok(state.cuts.includes('front-e'), 'the sappered node is cut');
  assert.ok(state.sabotage['front-e'], 'the sapper window is tracked');
  assert.ok(state.flux[0] > fluxBefore, 'the cut pays the section 9.2 bounty');
  assert.equal(result.denied, 1, 'front-e itself is denied');

  // A second sapper on an already-cut node is refused (the siphon path owns it).
  assert.equal(cocsSapper(match, state, saboteur, 'front-e').ok, false);
  // The window expires and the link is repaired on the shared tick clock.
  state.tick = state.sabotage['front-e'].until + 1;
  step(match, 1);
  assert.equal(state.cuts.includes('front-e'), false, 'the cut cannot outlive its window');
});

test('SIPHON moves enemy FLUX into the saboteur team and cannot go negative', () => {
  const match = pvpMatch('8v8');
  const state = match.objectiveState;
  const saboteur = cocsRoleSpawn(match, state, 0, 'saboteur', 'econ-e');
  const econ = node(state, 'econ-e');
  econ.owner = 1;
  saboteur.x = econ.x; saboteur.z = econ.z;
  state.flux[1] = 40;
  const mine = state.flux[0];
  const taken = cocsSiphon(match, state, saboteur, 'econ-e');
  assert.equal(taken.ok, true);
  assert.equal(taken.flux, COCS_SIPHON_FLUX);
  assert.equal(state.flux[1], 28);
  assert.equal(state.flux[0], mine + COCS_SIPHON_FLUX);
  // Empty enemy pool: bounded, no negative FLUX.
  state.flux[1] = 1;
  assert.equal(cocsSiphon(match, state, saboteur, 'econ-e').flux, 1);
  assert.equal(state.flux[1], 0);
  assert.equal(cocsSiphon(match, state, saboteur, 'econ-e').ok, false);
});

test('the SABOTEUR act selects SAPPER on a live node and SIPHON on a cut one', () => {
  const match = pvpMatch('8v8');
  const state = match.objectiveState;
  const saboteur = cocsRoleSpawn(match, state, 0, 'saboteur', 'econ-e');
  const econ = node(state, 'econ-e');
  econ.owner = 1;
  saboteur.x = econ.x; saboteur.z = econ.z;
  const sapper = cocsSaboteurAct(match, state, saboteur);
  assert.equal(sapper.ok, true);
  assert.ok(state.sabotage['econ-e']);
  // Now cut: the same actor siphons instead of re-cutting.
  state.tick = 0;
  state.cuts.push('econ-e');
  state.flux[1] = 30;
  const siphon = cocsSaboteurAct(match, state, saboteur);
  assert.equal(siphon.ok, true);
  assert.equal(siphon.flux, COCS_SIPHON_FLUX);
});

// ---------------------------------------------------------------------------
// Visibility shape (section 11.4).
// ---------------------------------------------------------------------------
test('intel/contacts are computed per team and never share one value', () => {
  const match = pvpMatch('8v8');
  const state = match.objectiveState;
  state.flux[0] = 99;
  state.flux[1] = 11;
  const view0 = cocsTeamVisibility(match, state, 0);
  const view1 = cocsTeamVisibility(match, state, 1);
  assert.notEqual(view0.intel, view1.intel, 'each team gets its own intel object');
  assert.notEqual(view0.contacts, view1.contacts, 'each team gets its own contacts array');
  assert.equal(view0.intel.team, 0);
  assert.equal(view1.intel.team, 1);
  assert.equal(view0.intel.flux, 99);
  assert.equal(view1.intel.flux, 11);
  for (const intel of [view0.intel, view1.intel]) {
    for (const key of ['team', 'rung', 'knownNodes', 'enemyNodes', 'contacts', 'spots', 'flux', 'cutNodes']) {
      assert.ok(Object.hasOwn(intel, key), `intel.${key} is part of the shape`);
    }
  }
  const snapshot = cocsSnapshot(match);
  assert.equal(snapshot.intel[0].team, 0);
  assert.equal(snapshot.intel[1].team, 1);
  assert.ok(Array.isArray(snapshot.contacts[0]));
  assert.ok(Array.isArray(snapshot.contacts[1]));
});

test('PvP snapshot exposes rung/intel/contacts/roleBoard and co-op exposes none of them', () => {
  const pvp = pvpMatch('4v4');
  const pvpSnap = cocsSnapshot(pvp);
  assert.equal(pvpSnap.rung, '4v4');
  assert.ok(pvpSnap.intel && pvpSnap.contacts && pvpSnap.roleBoard);
  assert.deepEqual(pvpSnap.roleBoard[0].allow, ['fighter', 'harvester', 'builder']);

  const coop = coopMatch();
  const coopSnap = cocsSnapshot(coop);
  assert.equal(coopSnap.rung, undefined);
  assert.equal(coopSnap.intel, undefined);
  assert.equal(coopSnap.contacts, undefined);
  assert.equal(coopSnap.roleBoard, undefined);
  assert.equal(coop.objectiveState.rung, null);
  assert.equal(coop.objectiveState.roleAllow, null);
  assert.equal(coopSnap.coop, true, 'co-op keeps its own director/command surface');
});

// ---------------------------------------------------------------------------
// PvP wire action surface (command seat, role economy, personal REQ).
// ---------------------------------------------------------------------------
test('the PvP command seat is team-scoped and round-trips through the snapshot', () => {
 const match = pvpMatch('8v8', {humanCount: 2});
 const state = match.objectiveState;
 const take = cocsCommandAction(match, state, {team: 0, peerId: '0', action: 'take'});
 assert.equal(take.ok, true);
 assert.equal(take.seat, '0', 'the seat reply names the seated actor');
 assert.equal(state.command.seat[0], '0');
 assert.equal(state.command.seat[1], null, 'a team-0 take never seats team 1');
 assert.equal(cocsCommandAction(match, state, {team: 1, peerId: '1', action: 'release'}).reason, 'not-commander');
 state.command.seat[1] = '1';
 assert.equal(cocsCommandAction(match, state, {team: 1, peerId: '1', action: 'release'}).ok, true);
 assert.equal(state.command.seat[1], null);
 const snap = cocsSnapshot(match);
 assert.equal(snap.commander.seat[0], '0');
 assert.equal(snap.commander.seat[1], null);
});

test('the PvP role economy spends team FLUX through the rung allow-list', () => {
 const four = pvpMatch('4v4');
 const fourState = four.objectiveState;
 fourState.flux[0] = 240;
 assert.equal(cocsEconomyAction(four, fourState, {team: 0, action: 'reinforce', role: 'saboteur'}).reason, 'role', '4v4 cannot field SABOTEUR');
 assert.equal(cocsEconomyAction(four, fourState, {team: 0, action: 'fortify', target: 'front-e'}).reason, 'no-sink');
 const fighter = cocsEconomyAction(four, fourState, {team: 0, action: 'spawn', role: 'fighter'});
 assert.equal(fighter.ok, true);
 assert.equal(fourState.roleSpawns[0].length, 1);
 assert.equal(fourState.roleSpawns[1].length, 0, 'a team-0 spend never touches team 1');
 // THREADS gate: fill the cap, then refuse the next role.
 fourState.threads[0].cap = 1;
 assert.equal(cocsEconomyAction(four, fourState, {team: 0, action: 'reinforce', role: 'fighter'}).reason, 'no-thread');

 // 8v8 can field the SCOUT; a live scout retargets instead of spawning again.
 const eight = pvpMatch('8v8');
 const eightState = eight.objectiveState;
 eightState.flux[0] = 240;
 const first = cocsEconomyAction(eight, eightState, {team: 0, action: 'spawn', role: 'scout', target: 'front-w'});
 assert.equal(first.ok, true);
 const retarget = cocsEconomyAction(eight, eightState, {team: 0, action: 'spawn', role: 'scout', target: 'front-e'});
 assert.equal(retarget.retargeted, true);
 assert.equal(eight.actors[first.actor].scoutTargetNode, 'front-e', 'the live scout retargets for free');
});

test('PvP spends reach the sim only through Match.step and are deterministic', () => {
 const run = () => {
  const match = pvpMatch('8v8');
  const state = match.objectiveState;
  state.flux[0] = 240; state.flux[1] = 240;
  match.step(DT, {cocs: {
   commands: [{tick: 0, peerId: '0', cardId: 'c1', team: 0, action: 'take'}],
   spends: [{tick: 0, peerId: 'p1', cardId: 's1', team: 0, action: 'reinforce', role: 'fighter'}],
  }});
  for (let i = 0; i < 5; i++) match.step(DT, {inputs: {}});
  return JSON.stringify({command: state.command, players: state.roleSpawns});
 };
 assert.equal(run(), run(), 'the same seeded action order is byte-identical');
 const match = pvpMatch('8v8');
 const state = match.objectiveState;
 state.flux[0] = 240;
 match.step(DT, {cocs: {spends: [{tick: 0, peerId: 'p1', cardId: 's1', team: 0, action: 'reinforce', role: 'fighter'}]}});
 assert.equal(state.roleSpawns[0].length, 1, 'the spend reached the sim');
 assert.ok(state.flux[0] < 240, 'the role cost came out of team FLUX');
});

test('PvP personal REQ buys apply to the buying actor and honour the team seat', () => {
 const match = pvpMatch('8v8');
 const state = match.objectiveState;
 const actor = match.actors[0];
 actor.req = 100;
 // WP1.3 narrowed every effectless row, including the team-wide commander
 // items, out of the launch set: the buy is refused before any REQ moves.
 const gated = cocsBuyAction(match, state, {actorId: actor.id, peerId: 'p1', itemId: 'supply-drop'});
 assert.equal(gated.ok, false);
 assert.equal(gated.reason, 'not-launched');
 assert.equal(actor.req, 100, 'the refused commander row never debits');
 state.command.seat[0] = 'p1';
 const bought = cocsBuyAction(match, state, {actorId: actor.id, peerId: 'p1', itemId: 'field-repair'});
 assert.equal(bought.ok, true);
 assert.equal(actor.reqBuff, 'field-repair');
 assert.ok(actor.reqSpent >= 40);
 assert.equal(state.command.seat[1], null, 'the buy never seats the enemy team');
});

// ---------------------------------------------------------------------------
// Local team-FLUX spend dispatch + §6A.6 NEGLECT activation (fieldwork v8.6).
// ---------------------------------------------------------------------------
test('a local page-shaped {verb} spend reaches the sim through Match.step', () => {
  // The page queues `{verb}` for local practice; the sim must accept it exactly
  // like the wire/room `{action}` shape, case-insensitively.
  const local = pvpMatch('8v8');
  const localState = local.objectiveState;
  localState.flux[0] = 240;
  local.step(DT, {cocs: {spends: [{tick: 0, peerId: '0', cardId: 'local-1', team: 0, verb: 'reinforce', role: 'fighter', target: null}]}});
  assert.equal(localState.roleSpawns[0].length, 1, 'the local {verb} record applies');
  assert.equal(localState.spendLog.at(-1).verb, 'reinforce', 'the spend log normalises the verb');
  assert.equal(localState.spendLog.at(-1).ok, true);
  assert.ok(localState.flux[0] < 240, 'the role cost came out of team FLUX');

  const wire = pvpMatch('8v8');
  wire.objectiveState.flux[0] = 240;
  wire.step(DT, {cocs: {spends: [{tick: 0, peerId: 'p1', cardId: 'wire-1', team: 0, action: 'SPAWN', role: 'fighter'}]}});
  assert.equal(wire.objectiveState.roleSpawns[0].length, 1, 'the wire {action} shape still applies');

  // The SCAN purchase is the same economy call as the room's `spawn`+scout,
  // and it needs (and gets) a legal target node.
  const scan = pvpMatch('8v8');
  scan.objectiveState.flux[0] = 240;
  scan.step(DT, {cocs: {spends: [{tick: 0, peerId: '0', cardId: 'local-scan', team: 0, verb: 'spawn', role: 'scout', target: 'front-e'}]}});
  assert.ok(scan.objectiveState.scouts[0] !== null && scan.objectiveState.scouts[0] !== undefined, 'local SCAN spends spawn the scout');
  assert.ok(scan.objectiveState.flux[0] < 239, 'the scout cost came out of team FLUX');
});

test('NEGLECT accrues for a trailing human team and stays zero without a human commander', () => {
  // (a) Seated commander + a live order nobody is working: the meter rises
  // after the 45 s grace on the authored +1/s and stays inside the cap.
  const match = pvpMatch('8v8', {cocsPolicy: () => []});
  const state = match.objectiveState;
  match.step(DT, {inputs: {}});
  const human = match.actors.find(actor => actor.bot == null && actor.isNpc !== true);
  assert.ok(human, 'the practice roster fields a human seat');
  human.x = 500; human.z = 500;
  const hq = state.nodes.find(node => node.archetype === 'hq' && node.owner === 0);
  assert.ok(hq, 'team 0 starts with an HQ (an order there can never complete)');
  assert.equal(cocsCommandAction(match, state, {team: 0, peerId: String(human.id), action: 'take'}).ok, true);
  state.scores[1] = 80;
  for (let i = 0; i < 70 * 60 && !match.over; i++) {
    if (i % 90 === 0) match.step(DT, {cocs: {orders: [{tick: 0, peerId: 'commander', cardId: `hold-${i}`, team: 0, verb: 'HOLD', target: hq.id}]}});
    else match.step(DT, {inputs: {}});
  }
  assert.ok(state.neglect[0].value > 5, `expected NEGLECT to accrue, got ${state.neglect[0].value}`);
  assert.ok(state.neglect[0].value <= NEGLECT.max, 'the meter stays inside its authored cap');

  // (b) No human anywhere on the team: the same order pressure never moves it.
  const bots = pvpMatch('8v8', {cocsPolicy: () => []});
  const botState = bots.objectiveState;
  for (const actor of bots.actors) actor.bot = actor.bot ?? {route: [], think: 0, target: -1, memory: 0, reaction: 0, stuck: 0, last: {x: 0, y: 0, z: 0}, state: 'roam', patrol: 0, flank: null, flankDone: false, recover: 0, suppressed: 0, threat: -1, standoff: null, strafeReverse: -99};
  const botHq = botState.nodes.find(node => node.archetype === 'hq' && node.owner === 0);
  for (let i = 0; i < 70 * 60 && !bots.over; i++) {
    if (i % 90 === 0) bots.step(DT, {cocs: {orders: [{tick: 0, peerId: 'chief-0', cardId: `hold-${i}`, team: 0, verb: 'HOLD', target: botHq.id}]}});
    else bots.step(DT, {inputs: {}});
  }
  assert.equal(botState.neglect[0].value, 0, 'without a human commander NEGLECT stays zero');

  // (c) OPERATIONS stays inert exactly as before: co-op never reads the PvP
  // command seat or the order signal, so its neglect meter cannot move.
  const coop = coopMatch();
  coop.step(DT, {cocs: {orders: [{tick: 0, peerId: 'human-0', cardId: 'coop-1', team: 0, verb: 'HOLD', target: coop.objectiveState.nodes[0].id}]}});
  const context = cocsNeglectContext(coop, coop.objectiveState, 0);
  assert.equal(context.humanCommander, false, 'co-op keeps NEGLECT inert');
  assert.equal(context.activeOrder, false);
});

// ---------------------------------------------------------------------------
// Sweep harness.
// ---------------------------------------------------------------------------
test('the PvP sweep reports its rung/gates and alarms only team dominance', async () => {
  const {run, summarise, pvpBalanceAlarms} = await import('../scripts/cocs-validate.mjs');
  assert.deepEqual(
    pvpBalanceAlarms([{winner: 0, overReason: 'dominance'}, {winner: 0, overReason: 'dominance'}, {winner: 0, overReason: 'dominance'}, {winner: 0, overReason: 'dominance'}]),
    ['team-dominance:0/4'],
  );
  assert.deepEqual(
    pvpBalanceAlarms([{winner: 0, overReason: 'dominance'}, {winner: 1, overReason: 'dominance'}, {winner: 0, overReason: 'time'}, {winner: 1, overReason: 'time'}]),
    [],
    'a shared dominance win reason is the designed end condition, not a dominant strategy',
  );
  const runs = [run(1, {seconds: 20, rung: '4v4'})];
  const summary = summarise(runs);
  assert.equal(summary.result.rung, '4v4');
  assert.equal(summary.result.sample, 1);
  assert.ok(summary.economy.rolesByRole, 'the sweep reports the per-role spawn tally');
  assert.deepEqual(summary.gate, {strictContest: '>=35%', fightPoint: '>=60%', trailingHalfWins: '>=25%'});
});

test('the command policy and route accept only real stances and nodes and announce themselves', () => {
 const match = pvpMatch('8v8');
 const state = match.objectiveState;
 const events = [];
 match.emit = (type, payload) => events.push({type, payload});
 assert.equal(cocsCommandAction(match, state, {team: 0, peerId: '0', action: 'take'}).ok, true);
 const bad = cocsCommandAction(match, state, {team: 0, peerId: '0', action: 'policy', value: 'BERSERK'});
 assert.equal(bad.ok, false);
 assert.equal(bad.reason, 'stance', 'an unknown stance is refused');
 assert.equal(state.command.policy[0], null);
 const set = cocsCommandAction(match, state, {team: 0, peerId: '0', action: 'policy', value: 'fortify'});
 assert.equal(set.ok, true);
 assert.equal(set.policy, 'FORTIFY', 'the stance is normalized to upper case');
 assert.equal(state.command.policy[0], 'FORTIFY');
 const node = state.nodes.find(entry => entry.archetype !== 'hq' && entry.archetype !== 'array');
 const route = cocsCommandAction(match, state, {team: 0, peerId: '0', action: 'set-route', value: node.id});
 assert.equal(route.ok, true);
 assert.equal(state.command.route[0], node.id);
 const missing = cocsCommandAction(match, state, {team: 0, peerId: '0', action: 'set-route', value: 'not-a-node'});
 assert.equal(missing.ok, false);
 assert.equal(missing.reason, 'unknown-node');
 const cleared = cocsCommandAction(match, state, {team: 0, peerId: '0', action: 'set-route', value: null});
 assert.equal(cleared.ok, true);
 assert.equal(state.command.route[0], null);
 assert.ok(events.some(event => event.type === 'cocs-command' && event.payload.action === 'policy' && event.payload.policy === 'FORTIFY'), 'the stance change is announced');
 assert.ok(events.some(event => event.type === 'cocs-command' && event.payload.action === 'set-route' && event.payload.route === node.id), 'the route is announced');
});
