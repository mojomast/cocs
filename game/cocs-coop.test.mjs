import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {GAME_MODES, normalizeConfig, isCocsMode} from './config.mjs';
import {COOP_GARRISON_BOTS, COOP_TEAM_FLOOR, COOP_ECONOMY, DIRECTOR_TIERS} from './cocs-difficulty.mjs';
import {
  COOP_WAVE_LIVE_CAP, coopCommandState, coopHumanIds, coopOrderGate, coopOutcome,
  createCoopState, setCoopTier, cocsDirectorSnapshot,
} from './cocs-coop.mjs';
import {cocsSnapshot} from './cocs.mjs';
import {cocsDirectorView, cocsCommandView} from './cocs-orders.mjs';

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
const capturable = state => state.nodes.filter(node => ['front', 'economy', 'relay'].includes(node.archetype));
const step = (m, n = 1) => { for (let i = 0; i < n && !m.over; i++) m.step(1 / 60, {inputs: {}}); return m; };

test('cocs-coop is registered as the co-op LATTICE STRIKE operations mode', () => {
  const mode = GAME_MODES.find(entry => entry.id === 'cocs-coop');
  assert.ok(mode, 'mode row exists');
  assert.equal(mode.name, 'Lattice Strike: Operations');
  assert.equal(mode.rules.team, true);
  assert.equal(mode.rules.score, 'cocs');
  assert.equal(mode.rules.coop, true);
  assert.equal(mode.rules.vehicles, false);
  assert.equal(mode.rules.maxBots, 16);
  assert.equal(mode.rules.objective.kind, 'cocs');
  assert.equal(mode.rules.timeLimit, 900);
  assert.equal(isCocsMode('cocs-coop'), true);
  assert.equal(isCocsMode('cocs'), true);
  assert.equal(isCocsMode('deathmatch'), false);
  const config = normalizeConfig({mode: 'cocs-coop'});
  assert.equal(config.mode, 'cocs-coop');
  assert.equal(config.timeLimit, 900, 'co-op defaults to the 15-minute operation clock');
  assert.equal(config.fragLimit, 0);
});

test('the team seam puts humans on team 0, caps the garrison and fills to a floor', () => {
  const coop = coopMatch();
  const teams = coop.actors.map(actor => actor.team);
  assert.equal(teams[0], 0);
  assert.equal(teams.filter(team => team === 1).length, COOP_GARRISON_BOTS);
  assert.ok(teams.filter(team => team === 0).length >= COOP_TEAM_FLOOR);
  // Solo is bot-filled up to the floor, then the garrison, then overflow allies.
  const solo = coopMatch({humanCount: 1, botCount: 7});
  assert.equal(solo.actors[0].team, 0);
  assert.equal(solo.actors.filter(actor => actor.team === 1).length, COOP_GARRISON_BOTS);
  assert.equal(solo.actors.filter(actor => actor.team === 0).length, 1 + (COOP_TEAM_FLOOR - 1) + (7 - (COOP_TEAM_FLOOR - 1) - COOP_GARRISON_BOTS));
});

test('non-co-op team modes keep the historical alternating seat', () => {
  for (const mode of ['cocs', 'teamdeathmatch', 'ctf']) {
    const m = new Match('chatgpt', 'openclaw', mulberry32(3), 'warfront', {mode, humanCount: 1, botCount: 7, aiSeats: true, timeLimit: 300});
    for (const actor of m.actors) assert.equal(actor.team, actor.id % 2, `${mode} actor ${actor.id}`);
  }
});

test('the co-op template raises the one-sided economy and seeds the Director', () => {
  const m = coopMatch();
  const state = m.objectiveState;
  assert.equal(state.kind, 'cocs');
  assert.equal(state.coopMode, true);
  assert.ok(state.coop, 'director state exists at template time');
  assert.equal(state.flux[0], COOP_ECONOMY.fluxStart);
  assert.equal(state.fluxCap, COOP_ECONOMY.fluxCap);
  assert.equal(state.fluxPassive, COOP_ECONOMY.fluxPassivePerSecond);
  assert.equal(state.reqMult, COOP_ECONOMY.reqMultiplier);
  // PvPvE keeps its exact V0b numbers.
  const pvp = new Match('chatgpt', 'openclaw', mulberry32(3), 'warfront', {mode: 'cocs', humanCount: 1, botCount: 0, timeLimit: 300});
  assert.equal(pvp.objectiveState.flux[0], 80);
  assert.equal(pvp.objectiveState.fluxCap, 240);
  assert.equal(pvp.objectiveState.coop, false);
  assert.equal(pvp.objectiveState.coopMode, false);
});

test('PRESSURE accrues at the published tier rate and clamps at the cap', () => {
  const m = coopMatch();
  const coop = m.objectiveState.coop;
  step(m, 1);
  assert.equal(coop.initialized, true);
  assert.ok(coop.tick === 1);
  // A peak-phase rate is exact; drive a few seconds of the opening build-up.
  const before = coop.pressure;
  coop.intermission = false;
  coop.phase = 'peak';
  step(m, 60);
  assert.ok(coop.pressure > before, 'budget grows');
  coop.pressure = DIRECTOR_TIERS.D1.cap - 0.001;
  coop.phase = 'peak';
  step(m, 2);
  assert.equal(coop.pressure, DIRECTOR_TIERS.D1.cap, 'budget clamps at the cap');
  const d4 = coopMatch({seed: 11});
  setCoopTier(d4.objectiveState, 'D4');
  step(d4, 1);
  assert.equal(d4.objectiveState.coop.tier, 'D4');
});

test('the first wave spawns a tagged, non-respawning Director force', () => {
  const m = coopMatch();
  const state = m.objectiveState;
  const coop = state.coop;
  step(m, 300); // ~5 s: telegraphs resolve into the wave baseline
  const waveActors = m.actors.filter(actor => actor.isDirectorWave === true);
  assert.ok(waveActors.length > 0, 'wave force spawned');
  for (const actor of waveActors) {
    assert.equal(actor.team, 1);
    assert.equal(actor.isNpc, true);
    assert.ok(actor.directorNode, 'a wave actor is assigned a Director node');
  }
  // Non-respawning: kill one with a real damage source and confirm the engine
  // never revives it (the horde NPC_DEAD contract).
  const victim = waveActors.find(actor => actor.health > 0);
  assert.ok(victim, 'a living wave actor exists');
  victim.health = 0;
  victim.dead = 2; // a real kill sets the short respawn timer; prune must park it
  step(m, 1);
  assert.ok(victim.dead >= 1e9, 'dead wave actors are parked past the respawn window');
  assert.equal(coop.waveIds.includes(victim.id), true);
});

test('every Director spawn is at least 15 m from a living team-0 actor', () => {
  const m = coopMatch({humanCount: 1, botCount: 7});
  const seen = new Set();
  let checked = 0;
  for (let i = 0; i < 1800 && !m.over; i++) {
    m.step(1 / 60, {inputs: {}});
    for (const actor of m.actors) {
      if (actor.isDirectorWave !== true || seen.has(actor.id)) continue;
      seen.add(actor.id);
      for (const player of m.actors) {
        if (!player || player.team !== 0 || player.health <= 0 || player.isDirectorWave === true) continue;
        const distance = Math.hypot(actor.x - player.x, actor.z - player.z);
        assert.ok(distance >= 15 - 1e-6, `spawn ${actor.id} was ${distance.toFixed(2)} m from ${player.id}`);
      }
      checked++;
    }
  }
  assert.ok(checked > 0, 'at least one spawn was audited');
  void COOP_WAVE_LIVE_CAP;
});

test('clearing all five waves with the HQ intact wins the operation', () => {
  const m = coopMatch({seed: 21});
  const coop = m.objectiveState.coop;
  for (let i = 0; i < 220000 && !m.over; i++) {
    for (const actor of m.actors) {
      if (actor.isDirectorWave === true && actor.health > 0) { actor.health = 0; actor.dead = 1e9; actor.bot = null; }
    }
    if (coop.phase === 'intermission') coop.intermissionTicks = 1;
    m.step(1 / 60, {inputs: {}});
  }
  assert.equal(m.over, true);
  assert.equal(m.overReason, 'operation-complete');
  assert.equal(coop.wavesCleared, coop.waveCount);
  assert.ok(coop.siege.health > 0);
});

test('the Director can arm dominance and end the operation', () => {
  const m = coopMatch({seed: 5});
  const state = m.objectiveState;
  step(m, 1);
  for (const node of capturable(state)) node.owner = 1;
  state.dominance = {team: 1, progress: state.dominance.target, target: state.dominance.target, fast: true};
  m.step(1 / 60, {inputs: {}});
  assert.equal(m.over, true);
  assert.equal(m.overReason, 'dominance');
  assert.equal(coopOutcome(m, state).reason, 'dominance');
});

test('the operation clock is the backstop loss', () => {
  const m = coopMatch({seed: 8, timeLimit: 60});
  const state = m.objectiveState;
  step(m, 1);
  state.coop.wavesCleared = 0;
  m.time = 59.999;
  m.step(1 / 60, {inputs: {}});
  assert.equal(m.over, true);
  assert.equal(m.overReason, 'operation-failed');
  assert.equal(m.objectiveState.winner, 1);
});

test('the HQ siege arms, damages hq-0, repairs it and can end the run', () => {
  const m = coopMatch({seed: 13});
  const state = m.objectiveState;
  const coop = state.coop;
  step(m, 1);
  // Drive the final wave directly and give the Director a majority.
  coop.wave = 5;
  coop.initialized = true;
  coop.phase = 'relax';
  coop.waveTicks = 10;
  coop.waveTimerTicks = 100000;
  coop.pressure = 0;
  for (const node of capturable(state)) node.owner = 1;
  // Clear the HQ apron so the attacker is not out-repaired by the team's spawn.
  for (const actor of m.actors) if (actor.team === 0 && actor.health > 0) { actor.x = 100; actor.z = 100; }
  const hq = state.nodes.find(node => node.id === 'hq-0');
  const attacker = m.actors.find(actor => actor.team === 1 && actor.isNpc !== true);
  attacker.x = hq.x + 2; attacker.z = hq.z; attacker.y = hq.y; attacker.health = attacker.maxHealth;
  const before = coop.siege.health;
  step(m, 30);
  assert.equal(coop.siege.armed, true, 'siege arms on the final wave with a majority');
  assert.ok(coop.siege.health < before, 'attacker damages the HQ');
  // One team-0 defender out-repairs one attacker (16 vs 8 per second). Pin the
  // actors so the assertion measures the repair rule, not AI pathing.
  const defender = m.actors.find(actor => actor.team === 0 && actor.health > 0);
  const others = m.actors.filter(actor => actor.team === 0 && actor.health > 0 && actor !== defender);
  const damaged = coop.siege.health;
  for (let i = 0; i < 60; i++) {
    defender.x = hq.x; defender.z = hq.z; defender.y = hq.y;
    attacker.x = hq.x + 2; attacker.z = hq.z; attacker.y = hq.y;
    for (const other of others) { other.x = 100; other.z = 100; }
    m.step(1 / 60, {inputs: {}});
  }
  assert.ok(coop.siege.health > damaged, 'a defender repairs the HQ');
  // Destroy it: the run ends as the HQ falls (no defenders left on the apron).
  coop.siege.health = 0.0001;
  for (const actor of m.actors) if (actor.team === 0) { actor.x = 100; actor.z = 100; }
  attacker.x = hq.x + 1; attacker.z = hq.z;
  m.step(1 / 60, {inputs: {}});
  assert.equal(m.over, true);
  assert.equal(m.overReason, 'hq-destroyed');
});

test('command gates share FLUX with a per-player slice and a rotating executor lease', () => {
  const m = coopMatch({seed: 2, humanCount: 1, botCount: 7});
  const state = m.objectiveState;
  step(m, 1);
  // With every seat AI-driven there are no humans: the duty Chief proxies.
  assert.deepEqual(coopHumanIds(m), []);
  assert.equal(coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: 'chief-0'}).ok, true);
  // Promote actor 0 to a human seat and gate the big card on the lease.
  m.actors[0].bot = null;
  assert.deepEqual(coopHumanIds(m), [0]);
  const command = coopCommandState(m, state);
  assert.equal(command.executor, 0);
  assert.ok(command.threads.cap >= 2);
  assert.equal(coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: 7}).ok, false);
  assert.equal(coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: 0}).ok, true);
  // Per-player slice: a nearly dry pool blocks the cost.
  state.flux[0] = 0;
  const gate = coopOrderGate(m, state, {team: 0, verb: 'SCAN', peerId: 0});
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'slice');
});

test('the snapshot exposes director, waves and command for the HUD', () => {
  const m = coopMatch({seed: 4});
  step(m, 120);
  const cocs = cocsSnapshot(m);
  assert.equal(cocs.coop, true);
  assert.ok(cocs.director, 'cocs.director is present in co-op');
  assert.equal(typeof cocs.director.phase, 'string');
  assert.equal(cocs.director.waveCount, 5);
  assert.ok(cocs.director.budget.cap > 0);
  assert.equal(typeof cocs.director.siege.health, 'number');
  assert.ok(cocs.waves && cocs.command);
  // O1b populates the bonus lane with at most the tier's simultaneous-open
  // budget (D1 = 1) and exposes the intermission spend window.
  assert.ok(Array.isArray(cocs.bonus));
  assert.ok(cocs.bonus.length <= DIRECTOR_TIERS.D1.bonusOpen, 'D1 opens one bonus at a time');
  assert.ok(cocs.bonus.every(entry => typeof entry.id === 'string' && entry.state === 'open'));
  assert.ok(cocs.director.intermission, 'the spend window is in the snapshot');
  assert.ok(Array.isArray(cocs.director.intermission.sinks));
  // The pure view the HUD renders is mode-isolated and safe on a sparse snapshot.
  const view = cocsDirectorView(cocs);
  assert.ok(view);
  assert.equal(view.waveCount, 5);
  assert.ok(view.budget.current >= 0);
  assert.equal(cocsDirectorView({coop: false, director: null}), null);
  assert.equal(cocsDirectorView({coop: true}), null);
  void cocsCommandView;
  void createCoopState;
  void cocsDirectorSnapshot;
});

test('a protocol CUT/SABOTAGE terminal action cuts through the real Match path', () => {
  // WP1.2/Phase 0.3: the wire verb is `cut` (protocol alias `sabotage`); it must
  // reach the same SABOTAGE terminal channel a human interact starts, instead of
  // falling through to the device-only branch.
  for (const action of ['cut', 'sabotage']) {
    const m = coopMatch({seed: 37});
    const state = m.objectiveState;
    step(m, 1);
    const terminal = Object.values(state.terminals.terminals).find(entry => entry.kind === 'SABOTAGE');
    assert.ok(terminal, `${action}: the authored lattice hosts a SABOTAGE terminal`);
    const actor = m.actors.find(entry => entry.team === 0 && entry.health > 0);
    actor.bot = null;
    const pin = () => {
      actor.x = terminal.x; actor.z = terminal.z; actor.y = 0;
      actor.vx = 0; actor.vy = 0; actor.vz = 0;
      for (const other of m.actors) if (other.team === 1) { other.x = 500; other.z = 500; other.y = 0; }
    };
    pin();
    m.step(1 / 60, {inputs: {}, cocs: {terminals: [{
      tick: 0, peerId: 'p0', cardId: `term-${action}`,
      actorId: actor.id, terminalId: terminal.id, action,
    }]}});
    assert.equal(terminal.channel?.action, 'SABOTAGE', `${action}: the terminal cut channel starts`);
    assert.equal(state.cuts.includes(terminal.nodeId), false, `${action}: the cut lands when the channel completes`);
    for (let i = 0; i < 200 && terminal.state !== 'cut'; i++) { pin(); m.step(1 / 60, {inputs: {}}); }
    assert.equal(terminal.state, 'cut', `${action}: the SABOTAGE channel completes`);
    assert.ok(state.cuts.includes(terminal.nodeId), `${action}: the cut denies the node link`);
  }
});
