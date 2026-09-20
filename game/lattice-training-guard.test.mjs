// WP2.4 completion-safe practice course. These tests drive the guard against a
// real `Match` (not a synthetic stub) because the whole point is that ordinary
// time/dominance/HQ/elimination paths cannot cut an active lesson short.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {coopSpend} from './cocs-coop.mjs';
import {
  TRAINING_STEPS, TRAINING_GUARD_RESPAWN_SECONDS,
  createTraining, continueTraining, evaluateTraining, skipTraining, trainingConfig,
  trainingGuardPlan, applyTrainingGuard,
} from './lattice-training.mjs';

const seed = () => .5;
const coopMatch = () => {
  const match = new Match('chatgpt', 'openclaw', seed, 'lattice-slice', {...trainingConfig('cocs-coop'), cocsPolicy: () => []});
  // The page disables auto-spend for a practice match so the local player owns
  // every purchase; tests mirror that so the lesson evidence is local.
  match.objectiveState.coop.autoSpend = false;
  return match;
};
const coopTraining = match => createTraining('cocs-coop', {start: {x: match.actors[0].x, z: match.actors[0].z}});
const lessonAt = (mode, id) => {
  const index = TRAINING_STEPS[mode].findIndex(step => step.id === id);
  return {index, completed: TRAINING_STEPS[mode].slice(0, index).map(step => step.id)};
};
const advance = (match, training, steps, input = {}) => {
  let blocked = 0;
  for (let i = 0; i < steps; i += 1) {
    match.step(1 / 60, input);
    const plan = applyTrainingGuard(match, training);
    if (plan.end) blocked += 1;
  }
  return blocked;
};

test('guard plan is pure and a real Operations match cannot end during an active course', () => {
  const match = coopMatch();
  const training = coopTraining(match);
  for (let i = 0; i < 30; i += 1) { match.step(1 / 60, {}); applyTrainingGuard(match, training); }
  const before = JSON.stringify(match.snapshot());
  const plan = trainingGuardPlan(match, training);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(JSON.stringify(match.snapshot()), before, 'planning never mutates the match');
  assert.equal(plan.active, true);

  // Time limit: step past the practice clock while running the guard.
  match.time = match.config.timeLimit - 0.5;
  const blocked = advance(match, training, 90);
  assert.ok(blocked > 0, 'the ordinary time-limit end actually fired and was blocked');
  assert.equal(match.over, false);
  assert.equal(match.overReason, null);
  assert.equal(match.snapshot().over, false);
  assert.equal(match.objectiveState.winner, null);
  assert.equal(match.events.filter(event => event.type === 'objective-win').length, 0, 'no phantom end beat reaches the HUD');

  // Dominance: even a resolved ratchet cannot end the active course.
  match.objectiveState.dominance = {team: 1, progress: 999, target: 120, fast: false};
  match.step(1 / 60, {});
  const dominancePlan = applyTrainingGuard(match, training);
  assert.equal(dominancePlan.end?.blocked, true, 'the dominance end was blocked');
  assert.equal(match.over, false);
  assert.equal(match.objectiveState.winner, null);

  // Once the course is skipped, the same match resolves on the next step.
  applyTrainingGuard(match, skipTraining(training));
  match.step(1 / 60, {});
  assert.equal(match.over, true, 'practice resolves normally after the course ends');
});

test('Field Training also blocks a resolved dominance or array ending', () => {
  const match = new Match('chatgpt', 'openclaw', seed, 'lattice-slice', {...trainingConfig('cocs'), cocsPolicy: () => []});
  const training = createTraining('cocs', {start: {x: match.actors[0].x, z: match.actors[0].z}});
  for (let i = 0; i < 10; i += 1) { match.step(1 / 60, {}); applyTrainingGuard(match, training); }
  // A dominance ratchet only holds while team 1 owns the majority; set both.
  for (const node of match.objectiveState.nodes.filter(entry => ['front', 'economy', 'relay'].includes(entry.archetype)).slice(0, 3)) node.owner = 1;
  match.objectiveState.dominance = {team: 1, progress: 999, target: 90, fast: false};
  match.step(1 / 60, {});
  assert.equal(applyTrainingGuard(match, training).end?.blocked, true);
  assert.equal(match.over, false);
  assert.equal(match.objectiveState.winner, null);
  match.objectiveState.dominance = {team: null, progress: 0, target: 90, fast: false};
  match.objectiveState.arrayWinner = 1;
  match.step(1 / 60, {});
  assert.equal(applyTrainingGuard(match, training).end?.blocked, true);
  assert.equal(match.over, false);
  assert.equal(match.objectiveState.winner, null);
  assert.equal(match.events.filter(event => event.type === 'objective-win').length, 0);
  // Releasing the guard resolves the deferred array win on the next step.
  applyTrainingGuard(match, skipTraining(training));
  match.step(1 / 60, {});
  assert.equal(match.over, true);
  assert.equal(match.objectiveState.winner, 1);
});

test('the local player is respawned quickly instead of being eliminated for the lesson', () => {
  const guarded = coopMatch();
  const training = coopTraining(guarded);
  const local = guarded.actors[0];
  local.protection = 0;
  guarded.damage(local, 10000);
  assert.equal(local.health, 0);
  assert.ok(local.dead > TRAINING_GUARD_RESPAWN_SECONDS, 'the mode delay would otherwise stall the course');
  applyTrainingGuard(guarded, training);
  assert.ok(local.dead <= TRAINING_GUARD_RESPAWN_SECONDS, 'death keeps its feedback but the respawn is capped');
  advance(guarded, training, 40);
  assert.ok(local.health > 0, 'the local player is back in the fight');
  assert.ok(local.deaths >= 1, 'the death still happened (not invulnerability)');

  // The same lethal hit without an active course keeps the ordinary delay.
  const control = coopMatch();
  const victim = control.actors[0];
  victim.protection = 0;
  control.damage(victim, 10000);
  for (let i = 0; i < 40; i += 1) control.step(1 / 60, {});
  assert.equal(victim.health, 0, 'normal play is untouched by the guard');
});

test('Operations HQ cannot be armed or consumed while the course is active', () => {
  const match = coopMatch();
  const training = coopTraining(match);
  match.step(1 / 60, {});
  applyTrainingGuard(match, training);
  const coop = match.objectiveState.coop;
  assert.equal(match.trainingGuard.hqHealth, coop.siege.health, 'the integrity floor is captured at the first guarded step');
  // Force the published arm rule: wave 5 with a Director capturable majority.
  coop.wave = 5;
  for (const node of match.objectiveState.nodes) if (['front', 'economy', 'relay'].includes(node.archetype)) node.owner = 1;
  coop.siege.health = 10;
  coop.siege.armed = false;
  const pressureBefore = coop.pressure;
  const waveBefore = coop.wave;
  advance(match, training, 10);
  assert.equal(coop.siege.armed, false, 'the siege never stays armed during the course');
  assert.equal(coop.siege.health, match.trainingGuard.hqHealth, 'HQ integrity is restored to the protected floor');
  assert.equal(coop.stats.hqDamage, 0, 'refunded damage is not reported as HQ damage');
  assert.equal(coop.wave, waveBefore, 'Director wave progression is untouched');
  assert.ok(coop.pressure >= pressureBefore, 'PRESSURE keeps accruing; only the HQ outcome is held');
  assert.equal(match.events.filter(event => event.type === 'director-siege' || event.type === 'director-hq-damage').length, 0);
  assert.equal(match.over, false);
});

test('a spend lesson deterministically finds a usable window and can complete', () => {
  const match = coopMatch();
  // Let the authored wave machine spawn a live wave force.
  let training = coopTraining(match);
  for (let i = 0; i < 360; i += 1) { match.step(1 / 60, {}); applyTrainingGuard(match, training); }
  training = {...training, ...lessonAt('cocs-coop', 'spend')};
  const coop = match.objectiveState.coop;
  assert.ok(coop.waveForceTotal > 0 && coop.waveIds.length > 0, 'a live authored wave is running');
  const plan = trainingGuardPlan(match, training);
  assert.equal(plan.spendWindow?.forceWaveEnd, true, 'a stalled wave is ended through the authored withdrawal');
  applyTrainingGuard(match, training);
  assert.ok(coop.waveTicks >= coop.waveTimerTicks && coop.overruns >= 1);
  advance(match, training, 4);
  assert.equal(coop.phase, 'intermission');
  assert.equal(coop.intermissionOpen, true, 'the between-wave spend window is open');
  const result = coopSpend(match, match.objectiveState, {verb: 'RESUPPLY', peerId: '0', cardId: 'lesson'});
  assert.equal(result.ok, true);
  const evaluation = evaluateTraining(training, {snapshot: match.snapshot(), events: match.events.filter(event => event.type === 'coop-spend'), playerId: 0, lattice: match.arena.lattice});
  assert.equal(evaluation.training.phase, 'complete', 'the spend lesson completes on the guaranteed window');

  // The pre-wave intermission beat (closed by authoring) is opened directly.
  const direct = coopMatch();
  const directTraining = {...coopTraining(direct), ...lessonAt('cocs-coop', 'spend')};
  const directCoop = direct.objectiveState.coop;
  directCoop.phase = 'intermission';
  directCoop.intermissionOpen = false;
  directCoop.intermissionTicks = 3;
  applyTrainingGuard(direct, directTraining);
  assert.equal(directCoop.intermissionOpen, true);
  assert.ok(directCoop.intermissionTicks >= 60 * 20, 'the window is refreshed to the authored tier length');
});

test('terminal and device lessons always keep one authored target available', () => {
  const match = coopMatch();
  const training = coopTraining(match);
  applyTrainingGuard(match, training);
  const state = match.objectiveState;
  const table = state.terminals.terminals;
  for (const terminal of Object.values(table)) if (terminal.kind !== 'VAULT') { terminal.state = 'cut'; terminal.timer = 999; terminal.channel = null; }
  for (const node of state.nodes) if (['front', 'economy', 'relay'].includes(node.archetype)) node.owner = 1;
  const terminalLesson = {...training, ...lessonAt('cocs-coop', 'terminal')};
  const terminalPlan = trainingGuardPlan(match, terminalLesson);
  assert.equal(terminalPlan.terminal?.revive, 'hack-relay-0', 'the first sorted cut terminal is the authored repair target');
  applyTrainingGuard(match, terminalLesson);
  assert.equal(table['hack-relay-0'].state, 'live');
  assert.equal(table['hack-relay-0'].timer, 0);
  assert.equal(state.cuts.includes('relay-0'), false);
  assert.equal(trainingGuardPlan(match, terminalLesson).terminal, null, 'a live terminal is a valid target');

  const devices = state.traversal.devices;
  for (const device of Object.values(devices)) device.state = 'locked';
  const deviceLesson = {...training, ...lessonAt('cocs-coop', 'device')};
  const devicePlan = trainingGuardPlan(match, deviceLesson);
  assert.equal(devicePlan.device?.revive, 'lap-n', 'the first sorted cut/locked device is restored');
  applyTrainingGuard(match, deviceLesson);
  assert.equal(devices['lap-n'].state, 'live');
  assert.equal(trainingGuardPlan(match, deviceLesson).device, null, 'a live device is a valid RIDE target');
});

test('the same seed and inputs produce an identical guarded snapshot', () => {
  const run = () => {
    const match = coopMatch();
    const training = coopTraining(match);
    for (let i = 0; i < 300; i += 1) { match.step(1 / 60, {x: 1, z: 0}); applyTrainingGuard(match, training); }
    return match;
  };
  const a = run(), b = run();
  assert.equal(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()));
  assert.equal(a.over, false);
  assert.equal(JSON.stringify(a.events.map(event => event.type)), JSON.stringify(b.events.map(event => event.type)));
});

test('a skipped or completed course stops guarding and leaves normal play untouched', () => {
  const plain = coopMatch();
  const skipped = coopMatch();
  const skippedTraining = skipTraining(coopTraining(skipped));
  for (let i = 0; i < 240; i += 1) {
    plain.step(1 / 60, {x: -1, z: 0});
    skipped.step(1 / 60, {x: -1, z: 0});
    applyTrainingGuard(skipped, skippedTraining);
  }
  assert.equal(JSON.stringify(plain.snapshot()), JSON.stringify(skipped.snapshot()), 'an inactive guard is a byte-for-byte no-op');

  assert.deepEqual(trainingGuardPlan(skipped, null), {active: false});
  assert.deepEqual(trainingGuardPlan(skipped, skippedTraining), {active: false});
  const finalLesson = TRAINING_STEPS['cocs-coop'].length - 1;
  const done = continueTraining({...skippedTraining, done: false, skipped: false, phase: 'complete', index: finalLesson});
  assert.equal(done.done, true);
  assert.equal(trainingGuardPlan(skipped, done).active, false, 'a completed course stops guarding');

  // An end that is already set stays set once the course is inactive, and is
  // reverted only while a course is active.
  skipped.over = true; skipped.overReason = 'time';
  applyTrainingGuard(skipped, skippedTraining);
  assert.equal(skipped.over, true);
  assert.equal(skipped.overReason, 'time');
  const active = coopMatch();
  active.over = true; active.overReason = 'time';
  applyTrainingGuard(active, coopTraining(active));
  assert.equal(active.over, false);
  assert.equal(active.overReason, null);
});
