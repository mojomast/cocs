import test from 'node:test';
import assert from 'node:assert/strict';
import {MOVEMENT_VERBS, MOVEMENT_HOOK_BY_SPEC} from './kits.mjs';
import {
  MOVEMENT_FAMILIES, HOOK_NAMES, HOOK_VALUES, MOVEMENT_HOOK_TRIGGERS, MOVEMENT_SPECS, MOVEMENT_EVENTS, MOVEMENT_BLOCKS,
  MOVEMENT_INPUT_FIELDS, MOVEMENT_SNAPSHOT_FIELDS, WEAKENED_CARRIER, JUGGERNAUT_RULE, CHAIN_LINK_SCALE,
  CHAIN_DISTANCE_CAP, INTERACTION_BONUS_CAP, VEHICLE_MAX_ALTITUDE, CEILING_DEFAULT,
  movementSpec, movementHookFor, movementModeRule, movementAllowed, resolveCarrierRule,
  resolveMovementParams, chainLinkScale, ceilingFor, aimVector, createMovementState,
  refreshMovementParams, resetMovement, movementActive, movementChargeProgress, ropeLine,
  movementLandingActions, stepMovement, interruptMovement, movementSnapshot,
  applyMovementSnapshot,
} from './movement.mjs';

const DT = 1 / 60;
const EPS = 1e-6;

const closeTo = (actual, expected, eps = 1e-3, label = '') =>
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= eps, `${label} expected ${expected} ± ${eps}, got ${actual}`);

// A generous synthetic world: flat floor at y=0, no walls, big bounds, ceiling 24.
const ctx = (over = {}) => ({
  dt: DT,
  x: 0, y: 5, z: 0, vy: 0, grounded: false, yaw: 0, pitch: 0,
  landed: false,
  floorAt: () => 0,
  obstructed: () => false,
  bounds: {minX: -100, maxX: 100, minZ: -100, maxZ: 100},
  ceilingY: CEILING_DEFAULT,
  ...over,
});

const step = (state, input = {}, over = {}) => stepMovement(state, input, ctx(over));

const run = (state, ticks, inputAt = () => ({}), ctxAt = () => ({})) => {
  const frames = [];
  for (let i = 0; i < ticks; i++) frames.push(step(state, inputAt(i), ctxAt(i)));
  return frames;
};

const eventTypes = frames => frames.flatMap(frame => frame.events.map(event => event.type));
const actionsOf = frames => frames.flatMap(frame => frame.actions);
const hasEvent = (frames, type) => eventTypes(frames).includes(type);
const snapshotJson = value => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------
// 1. Resolved table
// ---------------------------------------------------------------------------

test('MOVEMENT_SPECS flattens the nine §13.3 verbs in wing order with exact budgets', () => {
  assert.deepEqual(MOVEMENT_SPECS.map(spec => spec.id), MOVEMENT_VERBS.map(verb => verb.id));
  assert.deepEqual(MOVEMENT_SPECS.map(spec => spec.id), [
    'air-dash', 'double-jump', 'super-jump', 'hover-jets', 'brace-slam',
    'safety-glide', 'grapple', 'blink-step', 'deployable-rope',
  ]);
  assert.deepEqual(MOVEMENT_SPECS.map(spec => spec.family), [
    'burst', 'burst', 'burst', 'deliberate', 'deliberate', 'deliberate', 'tool', 'tool', 'tool',
  ]);
  assert.deepEqual(MOVEMENT_SPECS.map(spec => spec.input), [
    'jump', 'jump', 'crouch', 'jump-hold', 'crouch-jump', 'jump-hold', 'mobility', 'mobility', 'mobility',
  ]);
  assert.deepEqual(MOVEMENT_FAMILIES, ['burst', 'deliberate', 'tool']);
  const byId = Object.fromEntries(MOVEMENT_SPECS.map(spec => [spec.id, spec]));
  assert.deepEqual(
    {charges: byId['air-dash'].maxCharges, distance: byId['air-dash'].distance, cooldown: byId['air-dash'].cooldown, windup: byId['air-dash'].windup, landing: byId['air-dash'].landing, duration: byId['air-dash'].duration},
    {charges: 1, distance: 5.5, cooldown: 2.5, windup: 0, landing: 0.15, duration: 0.25},
  );
  assert.deepEqual(
    {charges: byId['double-jump'].maxCharges, impulse: byId['double-jump'].impulse, cooldown: byId['double-jump'].cooldown, landing: byId['double-jump'].landing, refreshOnGround: byId['double-jump'].refreshOnGround},
    {charges: 1, impulse: 7.4, cooldown: 0, landing: 0, refreshOnGround: true},
  );
  assert.deepEqual(
    {charges: byId['super-jump'].maxCharges, impulse: byId['super-jump'].impulse, windup: byId['super-jump'].windup, cooldown: byId['super-jump'].cooldown, landing: byId['super-jump'].landing},
    {charges: 1, impulse: 12.5, windup: 0.55, cooldown: 6, landing: 0.25},
  );
  assert.deepEqual(
    {fuel: byId['hover-jets'].fuel, recharge: byId['hover-jets'].fuelRecharge, climb: byId['hover-jets'].climb, descent: byId['hover-jets'].descent, landing: byId['hover-jets'].landing},
    {fuel: 2.5, recharge: 1.8, climb: 0.35, descent: 2.2, landing: 0.2},
  );
  assert.deepEqual(
    {windup: byId['brace-slam'].windup, radius: byId['brace-slam'].radius, knockback: byId['brace-slam'].knockback, cooldown: byId['brace-slam'].cooldown, landing: byId['brace-slam'].landing, leap: byId['brace-slam'].leap, slamDescent: byId['brace-slam'].slamDescent},
    {windup: 0.15, radius: 4, knockback: 9, cooldown: 8, landing: 0.4, leap: 7.5, slamDescent: 16},
  );
  assert.deepEqual(
    {fuel: byId['safety-glide'].fuel, recharge: byId['safety-glide'].fuelRecharge, descent: byId['safety-glide'].descent, steer: byId['safety-glide'].steer, landing: byId['safety-glide'].landing},
    {fuel: 2.5, recharge: 1.8, descent: 2, steer: 4, landing: 0},
  );
  assert.deepEqual(
    {distance: byId.grapple.distance, reel: byId.grapple.reel, cooldown: byId.grapple.cooldown, missCooldown: byId.grapple.missCooldown, landing: byId.grapple.landing},
    {distance: 14, reel: 12, cooldown: 7, missCooldown: 3, landing: 0},
  );
  assert.deepEqual(
    {distance: byId['blink-step'].distance, windup: byId['blink-step'].windup, cooldown: byId['blink-step'].cooldown, landing: byId['blink-step'].landing},
    {distance: 6, windup: 0.3, cooldown: 6, landing: 0},
  );
  assert.deepEqual(
    {charges: byId['deployable-rope'].maxCharges, anchorLife: byId['deployable-rope'].anchorLife, cooldown: byId['deployable-rope'].cooldown, distance: byId['deployable-rope'].distance, rideSpeed: byId['deployable-rope'].rideSpeed},
    {charges: 1, anchorLife: 20, cooldown: 12, distance: 14, rideSpeed: 9},
  );
  for (const spec of MOVEMENT_SPECS) {
    for (const [key, value] of Object.entries(spec)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${spec.id}.${key} finite`);
    }
  }
});

test('movementSpec / movementHookFor resolve from kits.mjs and unknown ids return null', () => {
  assert.equal(movementSpec('air-dash').id, 'air-dash');
  assert.equal(movementSpec('nope'), null);
  for (const [specId, hook] of Object.entries(MOVEMENT_HOOK_BY_SPEC)) {
    assert.equal(movementHookFor(specId), hook);
    assert.ok(HOOK_NAMES.includes(hook));
  }
  assert.equal(movementHookFor('unknown'), null);
});

test('hook values are exactly the §3.6/§4.7 bounded numbers', () => {
  assert.deepEqual(Object.keys(HOOK_VALUES).sort(), [...HOOK_NAMES].sort());
  assert.deepEqual(MOVEMENT_HOOK_TRIGGERS, {
    economy: ['activate', 'end'],
    chaining: ['air'],
    usage: ['activate'],
    'landing-self': ['land'],
    'landing-control': ['land'],
  });
  assert.equal(HOOK_VALUES.economy.chargeBonus, 1);
  assert.equal(HOOK_VALUES.economy.fuelScale, 1.25);
  assert.equal(HOOK_VALUES.economy.cooldownScale, 0.8);
  assert.equal(HOOK_VALUES.chaining.linkScale, 0.7);
  assert.equal(HOOK_VALUES.chaining.distanceCap, 1.4);
  assert.equal(HOOK_VALUES.chaining.allowCancel, true);
  assert.equal(HOOK_VALUES.usage.allowWhileFiring, true);
  assert.equal(HOOK_VALUES['landing-self'].codex.action, 'heal');
  assert.equal(HOOK_VALUES['landing-self'].codex.amount, 8);
  assert.equal(HOOK_VALUES['landing-self'].codex.noFallDamage, true);
  const brace = HOOK_VALUES['landing-self'].claudecode;
  assert.ok(brace.duration > 0 && brace.mitigation > 0 && brace.mitigation <= 0.6, 'brace mitigation ≤60% (§4.7)');
  assert.ok(brace.knockbackScale > 0 && brace.knockbackScale <= 0.5);
  const claw = HOOK_VALUES['landing-control'].openclaw;
  assert.ok(claw.radius > 0 && claw.radius <= 3.5, 'OpenClaw field ≤3.5 m (§4.7)');
  assert.ok(claw.knockback > 0);
  const roo = HOOK_VALUES['landing-control'].roo;
  assert.ok(roo.radius > 0 && roo.radius <= 3.5, 'Roo field ≤3.5 m (§4.7)');
  assert.ok(roo.duration > 0 && roo.duration <= 2.5, 'Roo field ≤2.5 s (§4.7)');
  assert.ok(roo.slowMultiplier >= 0.65 && roo.slowMultiplier < 1, 'Roo slow ≤35% (§4.7)');
  assert.equal(CHAIN_LINK_SCALE, 0.7);
  assert.equal(CHAIN_DISTANCE_CAP, 1.4);
  assert.equal(INTERACTION_BONUS_CAP, 1.35);
  assert.equal(VEHICLE_MAX_ALTITUDE, 58);
  assert.equal(CEILING_DEFAULT, 24);
  assert.deepEqual(WEAKENED_CARRIER, {charges: 1, fuelScale: 0.5, cooldownScale: 1.5, liftScale: 0, suppressActive: true, interactionScale: 1});
  assert.deepEqual(JUGGERNAUT_RULE, {liftScale: 0.7, shieldFrozenAirborne: true});
  assert.ok(MOVEMENT_EVENTS.includes('windup-interrupt'));
  assert.ok(MOVEMENT_BLOCKS.includes('busy'));
  assert.deepEqual(MOVEMENT_INPUT_FIELDS, ['jump', 'jumpHeld', 'jumpReleased', 'crouch', 'crouchReleased', 'mobility', 'mobilityReleased', 'interrupted']);
  assert.deepEqual(Object.keys(movementSnapshot(createMovementState({character: 'mistral', harness: 'hermes'}))), [...MOVEMENT_SNAPSHOT_FIELDS]);
});

// ---------------------------------------------------------------------------
// 2. Chain decay and ceiling
// ---------------------------------------------------------------------------

test('chainLinkScale: 1× first link, ×0.7 decay, hard 1.4× cap', () => {
  assert.equal(chainLinkScale(0), 1);
  assert.equal(chainLinkScale(1), CHAIN_DISTANCE_CAP);
  assert.equal(chainLinkScale(2), CHAIN_DISTANCE_CAP);
  assert.equal(chainLinkScale(10), CHAIN_DISTANCE_CAP);
  assert.equal(chainLinkScale(-3), 1);
  assert.equal(chainLinkScale(NaN), 1);
  assert.equal(chainLinkScale(1.9), CHAIN_DISTANCE_CAP);
  for (let links = 0; links < 8; links++) {
    const scale = chainLinkScale(links);
    assert.ok(scale >= 1 && scale <= CHAIN_DISTANCE_CAP, `links ${links} bounded`);
  }
});

test('ceilingFor clamps to min(58, arena.ceiling ?? 24)', () => {
  assert.equal(ceilingFor({}), CEILING_DEFAULT);
  assert.equal(ceilingFor({ceiling: 12}), 12);
  assert.equal(ceilingFor({ceiling: 100}), VEHICLE_MAX_ALTITUDE);
  assert.equal(ceilingFor({ceiling: 58}), 58);
  assert.equal(ceilingFor(null), CEILING_DEFAULT);
  assert.deepEqual(aimVector(0, 0), {x: -0, y: 0, z: -1});
  closeTo(aimVector(Math.PI / 2, 0).x, -1, EPS);
  closeTo(aimVector(0, Math.PI / 2).y, 1, EPS);
});

// ---------------------------------------------------------------------------
// 3. Mode coverage
// ---------------------------------------------------------------------------

test('mode coverage: off in Puma, NPCs never in horde/campaign, weakened in instagib family', () => {
  for (const mode of ['puma-race', 'puma-soccer']) {
    assert.equal(movementModeRule(mode).disabled, true, mode);
    assert.equal(movementAllowed(mode), false);
    assert.equal(movementAllowed(mode, {npc: true}), false);
  }
  for (const mode of ['horde', 'campaign']) {
    assert.equal(movementAllowed(mode), true, `${mode} players keep the verb`);
    assert.equal(movementAllowed(mode, {npc: true}), false, `${mode} NPCs never inherit kits`);
  }
  assert.equal(movementAllowed('deathmatch'), true);
  assert.equal(movementAllowed('vip-escort'), true);
  assert.equal(movementAllowed('unknown-mode'), true);
  assert.equal(movementModeRule('unknown-mode').dashDistanceMax, null);
  for (const mode of ['instagib', 'rockets', 'arsenal']) {
    const rule = movementModeRule(mode);
    assert.equal(rule.dashDistanceMax, 4, `${mode} dash ≤4 m`);
    assert.equal(rule.blinkWindup, 0.45, `${mode} blink wind-up 0.45 s`);
    assert.equal(rule.disabled, false);
  }
  assert.equal(movementModeRule('ctf').disabled, false);
});

// ---------------------------------------------------------------------------
// 4. Parameter resolution: economy, mode weakening, carriers
// ---------------------------------------------------------------------------

test('resolveMovementParams starts from §13.3 and applies the economy hook', () => {
  const base = resolveMovementParams('air-dash', {});
  assert.equal(base.maxCharges, 1);
  assert.equal(base.cooldown, 2.5);
  assert.equal(base.liftScale, 1);
  assert.equal(base.disabled, false);
  assert.equal(base.hook, null);
  const economy = resolveMovementParams('air-dash', {spec: 'hermes'});
  assert.equal(economy.hook, 'economy');
  assert.equal(economy.maxCharges, 2, '+1 charge');
  closeTo(economy.cooldown, 2, EPS, '−20% cooldown');
  const hover = resolveMovementParams('hover-jets', {spec: 'hermes'});
  closeTo(hover.fuel, 3.125, EPS, '+25% fuel');
  assert.equal(hover.cooldown, 0);
  const rope = resolveMovementParams('deployable-rope', {spec: 'hermes'});
  assert.equal(rope.maxCharges, 2);
  closeTo(rope.cooldown, 9.6, EPS);
});

test('mode weakening caps dash distance and raises blink wind-up', () => {
  assert.equal(resolveMovementParams('air-dash', {mode: 'instagib'}).distance, 4);
  assert.equal(resolveMovementParams('air-dash', {mode: 'deathmatch'}).distance, 5.5);
  assert.equal(resolveMovementParams('blink-step', {mode: 'rockets'}).windup, 0.45);
  assert.equal(resolveMovementParams('blink-step', {mode: 'deathmatch'}).windup, 0.3);
  assert.equal(resolveMovementParams('air-dash', {mode: 'puma-race'}).disabled, true);
});

test('the weakened carrier exception applies most-specific first with one rule', () => {
  const qwenClass = resolveCarrierRule({mode: 'ctf', carrying: true, character: 'qwen', harness: 'openclaw'});
  const hermesSpec = resolveCarrierRule({mode: 'ctf', carrying: true, character: 'mistral', harness: 'hermes'});
  const qwenHermes = resolveCarrierRule({mode: 'ctf', carrying: true, character: 'qwen', harness: 'hermes'});
  assert.equal(qwenClass.reason, 'class');
  assert.equal(hermesSpec.reason, 'spec');
  assert.equal(qwenHermes.reason, 'class', 'Qwen class wins the order');
  for (const rule of [qwenClass, hermesSpec, qwenHermes]) {
    assert.equal(rule.weakened, true);
    assert.equal(rule.disabled, false);
    assert.equal(rule.liftScale, WEAKENED_CARRIER.liftScale);
    assert.equal(rule.suppressActive, true);
    assert.equal(rule.interactionScale, 1, 'no interaction-speed bonus');
  }
  const dropped = resolveCarrierRule({mode: 'ctf', carrying: true, character: 'mistral', harness: 'openclaw'});
  assert.equal(dropped.disabled, true);
  assert.equal(dropped.weakened, false);
  const free = resolveCarrierRule({mode: 'ctf', carrying: false, character: 'mistral', harness: 'openclaw'});
  assert.equal(free.disabled, false);
  assert.equal(free.weakened, false);
  assert.equal(free.liftScale, 1);
  assert.equal(free.interactionScale, null);
});

test('carrier weakening numbers: one charge, half fuel, +50% cooldown, no lift', () => {
  const dash = resolveMovementParams('air-dash', {spec: 'hermes', carrying: true, character: 'qwen'});
  assert.equal(dash.hook, 'economy');
  assert.equal(dash.maxCharges, WEAKENED_CARRIER.charges, 'economy 2 → weakened 1');
  closeTo(dash.cooldown, 2.5 * 0.8 * 1.5, EPS, '−20% then +50%');
  assert.equal(dash.liftScale, 0);
  const hover = resolveMovementParams('hover-jets', {spec: 'hermes', carrying: true, character: 'deepseek'});
  closeTo(hover.fuel, 2.5 * 1.25 * 0.5, EPS, 'half of the economy pool');
  assert.equal(hover.liftScale, 0);
  const rope = resolveMovementParams('deployable-rope', {carrying: true, character: 'qwen'});
  assert.equal(rope.maxCharges, 1);
  closeTo(rope.cooldown, 18, EPS, '12 s +50%');
  assert.equal(rope.disabled, false, 'Qwen keeps the verb');
});

test('Juggernaut keeps the verb at lift ×0.7 and freezes the shield airborne; VIP loses it', () => {
  const jug = resolveMovementParams('double-jump', {juggernaut: true});
  assert.equal(jug.disabled, false);
  closeTo(jug.liftScale, 0.7, EPS);
  assert.equal(jug.carrier.shieldFrozenAirborne, true);
  assert.equal(jug.carrier.weakened, false);
  const vip = resolveMovementParams('air-dash', {vip: true, mode: 'vip-escort'});
  assert.equal(vip.disabled, true);
  assert.equal(vip.carrier.suppressActive, true, 'harness active suppressed for the VIP');
  const npc = resolveMovementParams('air-dash', {npc: true, mode: 'horde'});
  assert.equal(npc.disabled, true);
});

// ---------------------------------------------------------------------------
// 5. Air dash — start / step / end / cooldown / landing
// ---------------------------------------------------------------------------

test('air dash: airborne jump edge translates 5.5 m, spends the charge and preserves momentum', () => {
  const state = createMovementState({character: 'mistral', harness: 'openclaw'});
  assert.equal(state.verb, 'air-dash');
  assert.equal(state.hook, 'landing-control');
  const grounded = step(state, {jump: true}, {grounded: true, y: 0, vy: 0});
  assert.equal(grounded.blocked, 'grounded');
  assert.equal(state.charges, 1);
  const frame = step(state, {jump: true}, {grounded: false, y: 4, vy: 0});
  assert.equal(state.phase, 'active');
  assert.equal(state.charges, 0);
  assert.equal(state.chains, 1);
  assert.equal(frame.motion.mode, 'dash');
  assert.equal(frame.motion.keepMomentum, true);
  closeTo(frame.motion.position.moved, 5.5, 0.13, '5.5 m dash');
  closeTo(frame.motion.position.z, -5.5, 0.13);
  closeTo(frame.motion.position.y, 4, EPS);
  assert.ok(frame.events.some(event => event.type === 'move-start' && event.reason === 'dash'));
});

test('air dash: 0.25 s active window then cooldown 2.5 s, recharge on the timer, landing recovery 0.15 s', () => {
  const state = createMovementState({character: 'mistral', harness: 'openclaw'});
  step(state, {jump: true}, {grounded: false, y: 4, vy: 0});
  const frames = [];
  for (let i = 0; i < 40 && state.phase !== 'ready'; i++) frames.push(step(state, {}, {grounded: false, y: 4, vy: 0}));
  assert.equal(state.phase, 'ready');
  assert.ok(hasEvent(frames, 'move-end'));
  closeTo(state.cooldown, 2.5, EPS, 'cooldown starts at end');
  // Resource gate while empty.
  const blocked = step(state, {jump: true}, {grounded: false, y: 4, vy: 0});
  assert.equal(blocked.blocked, 'resources');
  // Recharge on the cooldown timer while grounded.
  run(state, Math.ceil(2.5 / DT) + 4, () => ({}), () => ({grounded: true, y: 0, vy: 0}));
  assert.equal(state.charges, 1);
  assert.equal(state.cooldown, 0);
  // Landing recovery.
  step(state, {jump: true}, {grounded: false, y: 4, vy: 0});
  const landed = step(state, {}, {grounded: true, landed: true, y: 0, vy: -2});
  assert.ok(landed.events.some(event => event.type === 'landing-recovery' && Math.abs(event.duration - 0.15) < EPS));
  closeTo(state.recovery, 0.15, EPS);
  const duringRecovery = step(state, {jump: true}, {grounded: false, y: 4, vy: 0});
  assert.equal(duringRecovery.blocked, 'recovery');
});

test('air dash: Cline chaining is the only cancel and chain links stay under the 1.4× cap', () => {
  const chained = createMovementState({character: 'mistral', harness: 'cline'});
  assert.equal(chained.hook, 'chaining');
  const first = step(chained, {jump: true}, {grounded: false, y: 4, vy: 0});
  closeTo(first.motion.position.moved, 5.5, 0.13);
  chained.charges = 1; // bank a second link (Cline's hook is about chaining, not economy)
  // Let the dash finish while pretending another source (class dash) is active.
  const frames = run(chained, 20, () => ({jump: true}), () => ({grounded: false, y: 4, vy: 0, verbActive: true}));
  const second = frames.find(frame => frame.motion.position);
  assert.ok(second, 'a second link activated while busy');
  assert.ok(second.actions.some(action => action.type === 'cancel-verb'), 'chaining cancels the other source');
  assert.ok(second.events.some(event => event.type === 'chain-cancel'));
  closeTo(second.motion.position.moved, 5.5 * CHAIN_DISTANCE_CAP, 0.13, 'chained distance is capped at 1.4×');
  assert.ok(second.motion.position.moved > 5.5, 'chain travels further than a single dash');

  const plain = createMovementState({character: 'mistral', harness: 'openclaw'});
  const busy = step(plain, {jump: true}, {grounded: false, y: 4, vy: 0, verbActive: true});
  assert.equal(busy.blocked, 'busy');
  assert.equal(plain.charges, 1, 'a blocked verb pays nothing');
});

test('air dash: held fire blocks activation unless the usage hook (OpenCode) allows it', () => {
  const plain = createMovementState({character: 'mistral', harness: 'openclaw'});
  const blocked = step(plain, {jump: true}, {grounded: false, y: 4, vy: 0, firing: true});
  assert.equal(blocked.blocked, 'firing');
  const usage = createMovementState({character: 'mistral', harness: 'opencode'});
  assert.equal(usage.hook, 'usage');
  const allowed = step(usage, {jump: true}, {grounded: false, y: 4, vy: 0, firing: true});
  assert.equal(allowed.blocked, null);
  assert.equal(usage.phase, 'active');
});

// ---------------------------------------------------------------------------
// 6. Double jump
// ---------------------------------------------------------------------------

test('double jump: impulse 7.4, one charge, refresh on ground only', () => {
  const state = createMovementState({character: 'gemini', harness: 'openclaw'});
  const frame = step(state, {jump: true}, {grounded: false, y: 3, vy: -3});
  closeTo(frame.motion.vy, 7.4, EPS);
  assert.equal(state.charges, 0);
  assert.equal(state.cooldown, 0);
  const again = step(state, {jump: true}, {grounded: false, y: 4, vy: 2});
  assert.equal(again.blocked, 'resources');
  const airborne = run(state, 60, () => ({}), () => ({grounded: false, y: 5, vy: 0}));
  assert.equal(state.charges, 0, 'no mid-air refresh');
  assert.ok(!hasEvent(airborne, 'move-start'));
  const landed = step(state, {}, {grounded: true, landed: true, y: 0, vy: -2});
  assert.equal(state.charges, 1, 'refreshes on ground');
  assert.equal(landed.blocked, null);
});

test('double jump: carrier lift scales — Juggernaut ×0.7, weakened ×0, blocked charges still spend', () => {
  const jug = createMovementState({character: 'gemini', harness: 'openclaw'}, {juggernaut: true});
  const jugFrame = step(jug, {jump: true}, {grounded: false, y: 3, vy: -3});
  closeTo(jugFrame.motion.vy, 7.4 * 0.7, EPS, 'Juggernaut lift ×0.7');

  const weakened = createMovementState({character: 'qwen', harness: 'hermes'}, {verbId: 'double-jump', carrying: true});
  assert.equal(weakened.params.liftScale, 0);
  const weakFrame = step(weakened, {jump: true}, {grounded: false, y: 3, vy: -3});
  assert.equal(weakFrame.motion.vy, null, 'no vertical lift');
  assert.ok(weakFrame.events.some(event => event.type === 'no-lift'));
  assert.equal(weakened.charges, 0, 'the weakened charge is still spent');
});

// ---------------------------------------------------------------------------
// 7. Super jump
// ---------------------------------------------------------------------------

test('super jump: crouch charge 0.55 s, release launches 12.5, early release cancels free', () => {
  const state = createMovementState({character: 'grok', harness: 'openclaw'});
  const started = step(state, {crouch: true}, {grounded: true, y: 0, vy: 0});
  assert.equal(state.phase, 'charging');
  assert.ok(started.events.some(event => event.type === 'charge-start'));
  run(state, 10, () => ({crouch: true}), () => ({grounded: true, y: 0, vy: 0}));
  closeTo(movementChargeProgress(state), 10 / 60 / 0.55, 1e-3);
  const cancelled = step(state, {}, {grounded: true, y: 0, vy: 0});
  assert.equal(state.phase, 'ready');
  assert.equal(state.charges, 1, 'early release refunds the charge');
  assert.equal(state.cooldown, 0);
  assert.ok(cancelled.events.some(event => event.type === 'charge-cancel'));

  step(state, {crouch: true}, {grounded: true, y: 0, vy: 0});
  let guard = 0;
  while (state.windup < state.windupTotal && guard++ < 100) step(state, {crouch: true}, {grounded: true, y: 0, vy: 0});
  const launched = step(state, {}, {grounded: true, y: 0, vy: 0});
  closeTo(launched.motion.vy, 12.5, EPS);
  assert.equal(state.phase, 'ready');
  assert.equal(state.charges, 0);
  closeTo(state.cooldown, 6, EPS, 'cooldown starts at end');
  assert.ok(launched.events.some(event => event.type === 'charge-release'));

  const landed = step(state, {}, {grounded: true, landed: true, y: 0, vy: -3});
  assert.ok(landed.events.some(event => event.type === 'landing-recovery' && Math.abs(event.duration - 0.25) < EPS));
  closeTo(state.recovery, 0.25, EPS);
});

test('super jump: a wind-up interrupt refunds the charge and starts no cooldown', () => {
  const state = createMovementState({character: 'grok', harness: 'openclaw'});
  step(state, {crouch: true}, {grounded: true, y: 0, vy: 0});
  run(state, 5, () => ({crouch: true}), () => ({grounded: true, y: 0, vy: 0}));
  const frame = step(state, {}, {grounded: true, y: 0, vy: 0, interrupted: true, interruptReason: 'hit'});
  assert.equal(state.phase, 'ready');
  assert.equal(state.charges, 1);
  assert.equal(state.cooldown, 0);
  assert.ok(frame.events.some(event => event.type === 'windup-interrupt' && event.reason === 'hit'));
  const again = step(state, {crouch: true}, {grounded: true, y: 0, vy: 0});
  assert.equal(again.blocked, null, 'the verb is usable again immediately');
});

// ---------------------------------------------------------------------------
// 8. Hover jets
// ---------------------------------------------------------------------------

test('hover jets: jump-hold climbs 0.35 m/s and burns fuel/s, release ends it, landing is soft', () => {
  const state = createMovementState({character: 'deepseek', harness: 'openclaw'});
  const start = step(state, {jumpHeld: true}, {grounded: false, y: 5, vy: -1});
  assert.equal(state.phase, 'active');
  assert.ok(start.events.some(event => event.type === 'move-start' && event.reason === 'hover'));
  const climb = step(state, {jumpHeld: true}, {grounded: false, y: 5, vy: -1});
  closeTo(climb.motion.vy, 0.35, EPS);
  closeTo(state.fuel, 2.5 - DT, 1e-9);
  run(state, 59, () => ({jumpHeld: true}), () => ({grounded: false, y: 6, vy: 0}));
  closeTo(state.fuel, 2.5 - 60 * DT, 1e-6, 'fuel/s drain');
  const release = step(state, {}, {grounded: false, y: 6, vy: 0});
  assert.equal(state.phase, 'ready');
  assert.ok(release.events.some(event => event.type === 'move-end' && event.reason === 'release'));
  const land = step(state, {}, {grounded: true, landed: true, y: 0, vy: -4});
  assert.equal(state.phase, 'ready');
  closeTo(state.recovery, 0.2, EPS, 'soft landing 0.2 s');
  assert.ok(land.events.some(event => event.type === 'landing-recovery'));
});

test('hover jets: crouch brakes a fast descent to 2.2 m/s, no input cuts the jets', () => {
  const state = createMovementState({character: 'deepseek', harness: 'openclaw'});
  step(state, {jumpHeld: true}, {grounded: false, y: 8, vy: -1});
  const brake = step(state, {crouch: true}, {grounded: false, y: 8, vy: -12});
  closeTo(brake.motion.vy, -2.2, EPS);
  const slowFall = step(state, {crouch: true}, {grounded: false, y: 8, vy: -1});
  assert.equal(slowFall.motion.vy, null, 'no brake needed when already slow');
  const cut = step(state, {}, {grounded: false, y: 8, vy: -1});
  assert.equal(state.phase, 'ready');
  assert.ok(cut.events.some(event => event.type === 'move-end'));
});

test('hover jets: fuel empties, recharges only on the ground over 1.8 s, and never crosses the ceiling', () => {
  const state = createMovementState({character: 'deepseek', harness: 'openclaw'});
  step(state, {jumpHeld: true}, {grounded: false, y: 5, vy: -1});
  const frames = run(state, 200, () => ({jumpHeld: true}), () => ({grounded: false, y: 5, vy: -1}));
  assert.equal(state.fuel, 0);
  assert.equal(state.phase, 'ready');
  assert.ok(hasEvent(frames, 'fuel-empty'));
  // Recharge while grounded: 2.5 fuel over 1.8 s.
  run(state, Math.ceil(1.8 / DT) + 4, () => ({}), () => ({grounded: true, y: 0, vy: 0}));
  closeTo(state.fuel, 2.5, EPS, 'full recharge');
  // Ceiling: standing on the ceiling with the button held yields no climb.
  step(state, {jumpHeld: true}, {grounded: false, y: 24, vy: 0, ceilingY: 24});
  const ceiling = step(state, {jumpHeld: true}, {grounded: false, y: 24, vy: 0, ceilingY: 24});
  assert.equal(ceiling.motion.vy, 0, 'clamped at the ceiling');
  assert.equal(state.phase, 'active', 'jets still run at the ceiling');
  const nearCeiling = step(state, {jumpHeld: true}, {grounded: false, y: 24 - 0.001, vy: 0, ceilingY: 24});
  closeTo(nearCeiling.motion.vy, 0.001 / DT, 1e-6, 'approach speed capped by remaining headroom');
  // A lowered arena ceiling also clamps.
  assert.equal(ceilingFor({ceiling: 12}), 12);
});

// ---------------------------------------------------------------------------
// 9. Brace slam
// ---------------------------------------------------------------------------

test('brace slam: 0.15 s wind-up, leap, fast descent, impact and 0.4 s recovery', () => {
  const state = createMovementState({character: 'meta', harness: 'cline'});
  assert.equal(state.verb, 'brace-slam');
  assert.equal(state.hook, 'chaining');
  const windup = step(state, {jump: true, crouch: true}, {grounded: true, y: 0, vy: 0});
  assert.equal(state.phase, 'windup');
  assert.ok(windup.events.some(event => event.type === 'windup-start' && Math.abs(event.duration - 0.15) < EPS));
  const frames = run(state, 12, () => ({}), () => ({grounded: false, y: 1, vy: 3}));
  assert.ok(hasEvent(frames, 'slam-launch'));
  assert.equal(state.phase, 'active');
  const launch = frames.find(frame => frame.motion.vy !== null);
  closeTo(launch.motion.vy, 7.5, EPS, 'leap 7.5');
  const rise = step(state, {}, {grounded: false, y: 2, vy: 2});
  assert.equal(rise.motion.vy, null, 'no slam while rising');
  const dive = step(state, {}, {grounded: false, y: 2, vy: -1});
  closeTo(dive.motion.vy, -16, EPS, 'slam descent');
  const impact = step(state, {}, {grounded: true, landed: true, y: 0, vy: -8});
  assert.equal(state.phase, 'ready');
  closeTo(state.cooldown, 8, EPS);
  closeTo(state.recovery, 0.4, EPS);
  assert.ok(impact.actions.some(action => action.type === 'slam-impact' && action.radius === 4 && action.knockback === 9));
  assert.ok(hasEvent([impact], 'slam-impact'));
});

test('brace slam: wind-up interrupt cancels before the leap fires', () => {
  const state = createMovementState({character: 'meta', harness: 'cline'});
  step(state, {jump: true, crouch: true}, {grounded: true, y: 0, vy: 0});
  const frame = step(state, {}, {grounded: true, y: 0, vy: 0, interrupted: true});
  assert.equal(state.phase, 'ready');
  assert.equal(state.cooldown, 0, 'no cost before the leap');
  assert.ok(frame.events.some(event => event.type === 'windup-interrupt' && event.phase === 'windup'));
  assert.equal(interruptMovement(state, 'idle').interrupted, false);
});

// ---------------------------------------------------------------------------
// 10. Safety glide
// ---------------------------------------------------------------------------

test('safety glide: hold in air, clamp descent to 2 m/s, steer 4, fuel/s, no upward lift', () => {
  const state = createMovementState({character: 'claude', harness: 'claudecode'});
  assert.equal(state.verb, 'safety-glide');
  const rising = step(state, {jumpHeld: true}, {grounded: false, y: 6, vy: 3});
  assert.equal(state.phase, 'ready', 'no glide while rising');
  const start = step(state, {jumpHeld: true}, {grounded: false, y: 6, vy: -1});
  assert.equal(state.phase, 'active');
  const glide = step(state, {jumpHeld: true}, {grounded: false, y: 6, vy: -9});
  closeTo(glide.motion.vy, -2, EPS);
  closeTo(glide.motion.airControl, 4, EPS);
  assert.ok(glide.motion.vy <= 0, 'no upward mobility');
  closeTo(state.fuel, 2.5 - DT, 1e-9);
  const release = step(state, {}, {grounded: false, y: 6, vy: -1});
  assert.equal(state.phase, 'ready');
  assert.ok(release.events.some(event => event.type === 'move-end'));
  const empty = createMovementState({character: 'claude', harness: 'claudecode'});
  empty.fuel = 0;
  const noFuel = step(empty, {jumpHeld: true}, {grounded: false, y: 6, vy: -1});
  assert.equal(noFuel.blocked, 'resources');
});

// ---------------------------------------------------------------------------
// 11. Grapple
// ---------------------------------------------------------------------------

test('grapple: aim + hook reels at 12 m/s, arrival ends it and starts the 7 s cooldown', () => {
  const state = createMovementState({character: 'chatgpt', harness: 'openclaw'});
  const anchor = {x: 0, y: 6, z: -10};
  const castRay = () => anchor;
  const start = step(state, {mobility: true}, {grounded: false, x: 0, y: 6, z: 0, vy: 0, castRay});
  assert.equal(state.phase, 'active');
  assert.deepEqual(state.grapple, anchor);
  assert.ok(hasEvent([start], 'grapple-hook'));
  const pull = step(state, {}, {grounded: false, x: 0, y: 6, z: 0, vy: 0, castRay});
  assert.equal(pull.motion.mode, 'pull');
  closeTo(pull.motion.position.z, -Math.min(12 * DT, 10), 0.13, 'reel 12 m/s');
  const frames = run(state, 5, () => ({}), () => ({grounded: false, x: 0, y: 6, z: -9.8, vy: 0, castRay}));
  assert.equal(state.phase, 'ready');
  assert.ok(hasEvent(frames, 'grapple-release'));
  closeTo(state.cooldown, 7 - 4 * DT, 0.05, 'hook cooldown');
});

test('grapple: a miss costs the 3 s miss cooldown, release cancels a hook', () => {
  const state = createMovementState({character: 'chatgpt', harness: 'openclaw'});
  const miss = step(state, {mobility: true}, {grounded: false, x: 0, y: 6, z: 0, castRay: () => null});
  assert.equal(state.miss, 3);
  closeTo(state.cooldown, 3, EPS);
  assert.ok(hasEvent([miss], 'move-miss'));
  const blocked = step(state, {mobility: true}, {grounded: false, x: 0, y: 6, z: 0, castRay: () => ({x: 0, y: 6, z: -5})});
  assert.equal(blocked.blocked, 'cooldown');
  run(state, Math.ceil(3 / DT) + 2, () => ({}), () => ({grounded: false, x: 0, y: 6, z: 0, vy: 0}));
  const hook = step(state, {mobility: true}, {grounded: false, x: 0, y: 6, z: 0, castRay: () => ({x: 0, y: 6, z: -10})});
  assert.equal(hook.blocked, null);
  const released = step(state, {mobilityReleased: true}, {grounded: false, x: 0, y: 6, z: 0, vy: 0});
  assert.equal(state.phase, 'ready');
  assert.ok(released.events.some(event => event.type === 'grapple-release' && event.reason === 'release'));
  closeTo(state.cooldown, 7, EPS);
});

test('grapple: the no-world gate and weakened no-lift rule', () => {
  const state = createMovementState({character: 'chatgpt', harness: 'openclaw'});
  const noWorld = step(state, {mobility: true}, {grounded: false, x: 0, y: 6, z: 0});
  assert.equal(noWorld.blocked, 'no-world');
  const weakened = createMovementState({character: 'qwen', harness: 'hermes'}, {verbId: 'grapple', carrying: true});
  const castRay = () => ({x: 0, y: 12, z: -6});
  step(weakened, {mobility: true}, {grounded: false, x: 0, y: 6, z: 0, vy: 0, castRay});
  const pull = step(weakened, {}, {grounded: false, x: 0, y: 6, z: 0, vy: 0, castRay});
  assert.ok(pull.motion.position.y <= 6 + EPS, 'no vertical lift while carrying');
  assert.ok(pull.motion.position.z < 0);
});

// ---------------------------------------------------------------------------
// 12. Blink step
// ---------------------------------------------------------------------------

test('blink step: 0.3 s wind-up then a 6 m aimed translation and 6 s cooldown', () => {
  const state = createMovementState({character: 'kimi', harness: 'openclaw'});
  const start = step(state, {mobility: true}, {grounded: false, x: 0, y: 5, z: 0, aim: {x: 0, y: 0, z: -1}});
  assert.equal(state.phase, 'windup');
  assert.ok(hasEvent([start], 'windup-start'));
  assert.equal(state.cooldown, 0, 'nothing paid during wind-up');
  const frames = run(state, 20, i => (i === 0 ? {mobility: true} : {}), () => ({grounded: false, x: 0, y: 5, z: 0, aim: {x: 0, y: 0, z: -1}}));
  const blink = frames.find(frame => frame.motion.mode === 'blink');
  assert.ok(blink, 'blink fired');
  closeTo(blink.motion.position.z, -6, 0.13, '6 m translation');
  assert.equal(state.phase, 'ready');
  assert.ok(state.cooldown > 5.5 && state.cooldown <= 6, '6 s cooldown starts at end');
  assert.ok(hasEvent(frames, 'windup-end'));
});

test('blink step: an interrupt during wind-up refunds the attempt; instagib raises wind-up to 0.45 s', () => {
  const state = createMovementState({character: 'kimi', harness: 'openclaw'});
  step(state, {mobility: true}, {grounded: false, x: 0, y: 5, z: 0});
  const frame = step(state, {}, {grounded: false, x: 0, y: 5, z: 0, interrupted: true});
  assert.equal(state.phase, 'ready');
  assert.equal(state.cooldown, 0);
  assert.ok(frame.events.some(event => event.type === 'windup-interrupt'));

  const instagib = createMovementState({character: 'kimi', harness: 'openclaw'}, {mode: 'instagib'});
  assert.equal(instagib.params.windup, 0.45);
  step(instagib, {mobility: true}, {grounded: false, x: 0, y: 5, z: 0});
  run(instagib, 25, () => ({}), () => ({grounded: false, x: 0, y: 5, z: 0}));
  assert.equal(instagib.phase, 'windup', '0.45 s is longer than 25 ticks');
});

test('blink step: vertical aims clamp to the ceiling', () => {
  const state = createMovementState({character: 'kimi', harness: 'openclaw'});
  step(state, {mobility: true}, {grounded: false, x: 0, y: 5, z: 0, aim: {x: 0, y: 1, z: 0}});
  const frames = run(state, 20, i => (i === 0 ? {mobility: true} : {}), () => ({grounded: false, x: 0, y: 5, z: 0, ceilingY: 6, aim: {x: 0, y: 1, z: 0}}));
  const blink = frames.find(frame => frame.motion.mode === 'blink');
  assert.ok(blink);
  assert.equal(blink.motion.position.y, 6, 'clamped at min(58, ceiling)');
});

// ---------------------------------------------------------------------------
// 13. Deployable rope
// ---------------------------------------------------------------------------

test('deployable rope: places a 20 s anchor, charges one, cooldown 12 s, exposes the ride line', () => {
  const state = createMovementState({character: 'qwen', harness: 'openclaw'});
  const castRay = () => ({x: 4, y: 3, z: -8});
  const frame = step(state, {mobility: true}, {grounded: false, x: 0, y: 2, z: 0, castRay});
  assert.ok(state.anchor);
  closeTo(state.anchor.life, 20, EPS);
  assert.equal(state.charges, 0);
  closeTo(state.cooldown, 12, EPS);
  const place = frame.actions.find(action => action.type === 'rope-place');
  assert.ok(place, 'rope-place action for the per-match zipline table');
  assert.deepEqual({x: place.to.x, y: place.to.y, z: place.to.z}, {x: 4, y: 3, z: -8});
  assert.equal(place.speed, 9);
  assert.ok(place.from);
  assert.ok(hasEvent([frame], 'rope-place'));
  const line = ropeLine(state);
  assert.deepEqual(line.to, {x: 4, y: 3, z: -8});
  assert.equal(line.speed, 9);
  assert.ok(line.from);
  const blocked = step(state, {mobility: true}, {grounded: false, x: 0, y: 2, z: 0, castRay});
  assert.equal(blocked.blocked, 'resources');
});

test('deployable rope: the anchor expires after 20 s with a rope-remove and recharges after 12 s', () => {
  const state = createMovementState({character: 'qwen', harness: 'openclaw'});
  const castRay = () => ({x: 4, y: 3, z: -8});
  step(state, {mobility: true}, {grounded: false, x: 0, y: 2, z: 0, castRay});
  run(state, Math.ceil(12 / DT) + 4, () => ({}), () => ({grounded: true, y: 0, vy: 0}));
  assert.equal(state.charges, 1, 'recharge after the 12 s cooldown');
  assert.ok(state.anchor, 'the 20 s anchor is still alive');
  const frames = run(state, Math.ceil(8 / DT) + 4, () => ({}), () => ({grounded: false, x: 0, y: 2, z: 0}));
  assert.equal(state.anchor, null);
  assert.ok(hasEvent(frames, 'rope-expire'));
  assert.ok(actionsOf(frames).some(action => action.type === 'rope-remove'));
  assert.equal(ropeLine(state), null);
  assert.equal(state.charges, 1);
});

test('deployable rope: a miss is free (no charge, no cooldown)', () => {
  const state = createMovementState({character: 'qwen', harness: 'openclaw'});
  const frame = step(state, {mobility: true}, {grounded: false, x: 0, y: 2, z: 0, castRay: () => null});
  assert.equal(state.anchor, null);
  assert.equal(state.charges, 1);
  assert.equal(state.cooldown, 0);
  assert.ok(hasEvent([frame], 'rope-miss'));
});

// ---------------------------------------------------------------------------
// 14. Landing hooks
// ---------------------------------------------------------------------------

test('landing hooks: Codex heals, Claude Code braces, OpenClaw knocks back, Roo slows', () => {
  const codex = createMovementState({character: 'gemini', harness: 'codex'});
  assert.equal(codex.hook, 'landing-self');
  const codexActions = movementLandingActions(codex);
  assert.deepEqual(codexActions.map(action => action.type), ['heal']);
  assert.equal(codexActions[0].amount, 8);
  assert.equal(codexActions[0].noFallDamage, true);

  const claudecode = createMovementState({character: 'claude', harness: 'claudecode'});
  assert.equal(claudecode.hook, 'landing-self');
  const brace = movementLandingActions(claudecode)[0];
  assert.equal(brace.type, 'brace');
  closeTo(brace.duration, 1.2, EPS);
  closeTo(brace.mitigation, 0.1, EPS);
  closeTo(brace.knockbackScale, 0.5, EPS);

  const openclaw = createMovementState({character: 'mistral', harness: 'openclaw'});
  const knock = movementLandingActions(openclaw)[0];
  assert.equal(knock.type, 'knockback');
  closeTo(knock.radius, 3.5, EPS);
  assert.equal(knock.knockback, 6);

  const roo = createMovementState({character: 'mistral', harness: 'roo'});
  const slow = movementLandingActions(roo)[0];
  assert.equal(slow.type, 'slow-field');
  closeTo(slow.radius, 3.5, EPS);
  closeTo(slow.slowMultiplier, 0.65, EPS);
  closeTo(slow.duration, 2.5, EPS);

  // The landing tables are resolved by hook + spec id only: hooks that have no
  // landing action (economy/usage/chaining) stay empty for every spec.
  for (const harness of ['hermes', 'opencode', 'cline']) {
    assert.deepEqual(movementLandingActions(createMovementState({character: 'mistral', harness})), [], harness);
  }
  assert.equal(HOOK_VALUES['landing-control'].roo.action, 'slow-field');
  assert.equal(HOOK_VALUES['landing-control'].openclaw.action, 'knockback');
});

test('landing hooks fire only on a clean ctx.landed and not while an active verb handles its own landing', () => {
  const codex = createMovementState({character: 'gemini', harness: 'codex'});
  const groundedOnly = step(codex, {}, {grounded: true, y: 0, vy: 0, landed: false});
  assert.equal(groundedOnly.actions.length, 0, 'a plain grounded tick is not a land event');
  const landed = step(codex, {}, {grounded: true, y: 0, vy: -1, landed: true});
  assert.equal(landed.actions.length, 1);
  assert.equal(landed.actions[0].type, 'heal');

  const slam = createMovementState({character: 'meta', harness: 'roo'});
  step(slam, {jump: true, crouch: true}, {grounded: true, y: 0, vy: 0});
  run(slam, 10, () => ({}), () => ({grounded: false, y: 1, vy: 2}));
  const impact = step(slam, {}, {grounded: true, y: 0, vy: -6, landed: true});
  assert.ok(impact.actions.some(action => action.type === 'slow-field'), 'the land hook still fires');
  assert.ok(impact.actions.some(action => action.type === 'slam-impact'), 'the verb impact also fires');
});

// ---------------------------------------------------------------------------
// 15. Carrier behavior end to end
// ---------------------------------------------------------------------------

test('carrier weakening: a weakened hover cannot climb but still brakes; the flag drop refreshes back', () => {
  const hover = createMovementState({character: 'deepseek', harness: 'hermes'}, {carrying: true, mode: 'ctf'});
  assert.equal(hover.carrier.reason, 'spec');
  assert.equal(hover.carrier.suppressActive, true);
  closeTo(hover.maxFuel, 2.5 * 1.25 * 0.5, EPS);
  step(hover, {jumpHeld: true}, {grounded: false, y: 5, vy: -1});
  const climb = step(hover, {jumpHeld: true}, {grounded: false, y: 5, vy: -1});
  assert.equal(climb.motion.vy, null, 'no vertical lift');
  const brake = step(hover, {crouch: true}, {grounded: false, y: 5, vy: -9});
  closeTo(brake.motion.vy, -2.2, EPS, 'braking is not lift');
  refreshMovementParams(hover, {carrying: false, mode: 'ctf'});
  assert.equal(hover.carrier.weakened, false);
  assert.equal(hover.params.liftScale, 1);
  closeTo(hover.maxFuel, 3.125, EPS);
  assert.ok(hover.fuel <= hover.maxFuel, 'unchanged fuel is clamped to the refreshed pool');
});

test('carrier rule: a default carrier loses the verb, the VIP loses it plus the harness active', () => {
  const dropped = createMovementState({character: 'mistral', harness: 'openclaw'}, {carrying: true, mode: 'ctf'});
  assert.equal(dropped.enabled, false);
  const frame = step(dropped, {jump: true}, {grounded: false, y: 5, vy: 0});
  assert.equal(frame.blocked, 'disabled');
  assert.equal(frame.motion.position, null);
  refreshMovementParams(dropped, {carrying: false});
  assert.equal(dropped.enabled, true);
  assert.equal(step(dropped, {jump: true}, {grounded: false, y: 5, vy: 0}).blocked, null);

  const vip = createMovementState({character: 'mistral', harness: 'hermes'}, {vip: true, mode: 'vip-escort'});
  assert.equal(vip.enabled, false);
  assert.equal(vip.carrier.suppressActive, true, 'VIP harness active suppressed');
});

test('refreshMovementParams cancels a live grapple when the carrier rule disables the verb', () => {
  const state = createMovementState({character: 'chatgpt', harness: 'openclaw'}, {mode: 'ctf'});
  const castRay = () => ({x: 0, y: 6, z: -10});
  step(state, {mobility: true}, {grounded: false, x: 0, y: 6, z: 0, vy: 0, castRay});
  assert.equal(state.phase, 'active');
  refreshMovementParams(state, {carrying: true});
  assert.equal(state.enabled, false);
  assert.equal(state.phase, 'ready');
  assert.equal(state.grapple, null);
});

// ---------------------------------------------------------------------------
// 16. Interruption, vehicle and traversal gates
// ---------------------------------------------------------------------------

test('interruptMovement is a no-op when idle and starts the cooldown after a committed effect', () => {
  const idle = createMovementState({character: 'mistral', harness: 'hermes'});
  assert.deepEqual(interruptMovement(idle, 'test'), {interrupted: false, phase: 'ready', reason: null, refunded: null});
  step(idle, {jump: true}, {grounded: false, y: 4, vy: 0});
  const info = interruptMovement(idle, 'vehicle');
  assert.equal(info.interrupted, true);
  assert.equal(info.phase, 'active');
  assert.equal(info.refunded, null);
  closeTo(idle.cooldown, 2, EPS, 'committed dash keeps its (economy) cooldown');
});

test('one movement source: vehicles, ziplines and traversal flight block activation', () => {
  for (const [flag, reason] of [['inVehicle', 'vehicle'], ['zipRide', 'zipride'], ['traversalFlight', 'traversal'], ['dead', 'dead']]) {
    const state = createMovementState({character: 'mistral', harness: 'hermes'});
    const frame = step(state, {jump: true}, {grounded: false, y: 4, vy: 0, [flag]: true});
    assert.equal(frame.blocked, reason, flag);
  }
});

// ---------------------------------------------------------------------------
// 17. Snapshot contract and reset
// ---------------------------------------------------------------------------

test('movementSnapshot lists exactly MOVEMENT_SNAPSHOT_FIELDS, round-trips JSON and restores', () => {
  const state = createMovementState({character: 'qwen', harness: 'openclaw'});
  const castRay = () => ({x: 4, y: 3, z: -8});
  step(state, {mobility: true}, {grounded: false, x: 0, y: 2, z: 0, castRay});
  const snapshot = movementSnapshot(state);
  assert.deepEqual(Object.keys(snapshot), [...MOVEMENT_SNAPSHOT_FIELDS]);
  assert.deepEqual(snapshotJson(snapshot), snapshot);
  const clone = createMovementState({character: 'qwen', harness: 'openclaw'});
  applyMovementSnapshot(clone, snapshot);
  assert.deepEqual(movementSnapshot(clone), snapshot);
  resetMovement(clone);
  assert.equal(clone.anchor, null);
  assert.equal(clone.charges, 1);
  assert.equal(clone.fuel, clone.maxFuel);
  assert.equal(clone.recovery, 0);
  assert.equal(clone.chains, 0);
  assert.equal(movementSnapshot(null), null);
});

test('movementActive / movementChargeProgress describe the live phase', () => {
  const state = createMovementState({character: 'kimi', harness: 'openclaw'});
  assert.equal(movementActive(state), false);
  assert.equal(movementChargeProgress(state), 0);
  step(state, {mobility: true}, {grounded: false, x: 0, y: 5, z: 0});
  assert.equal(movementActive(state), false);
  closeTo(movementChargeProgress(state), 0, EPS, 'wind-up progress starts at 0 and fills to 1');
  run(state, 9, () => ({}), () => ({grounded: false, x: 0, y: 5, z: 0}));
  closeTo(movementChargeProgress(state), 0.5, 0.02, 'half-way through the 0.3 s wind-up');
  const dash = createMovementState({character: 'mistral', harness: 'openclaw'});
  step(dash, {jump: true}, {grounded: false, y: 4, vy: 0});
  assert.equal(movementActive(dash), true);
});

// ---------------------------------------------------------------------------
// 18. Determinism
// ---------------------------------------------------------------------------

function determinismScenario() {
  const states = [
    createMovementState({character: 'mistral', harness: 'openclaw'}),
    createMovementState({character: 'deepseek', harness: 'hermes'}),
    createMovementState({character: 'qwen', harness: 'openclaw'}),
  ];
  const trace = [];
  for (let i = 0; i < 300; i++) {
    const grounded = i % 30 < 10;
    const shared = {
      dt: DT, x: i * 0.01, y: grounded ? 0 : 4, z: -i * 0.02, vy: grounded ? 0 : -1,
      grounded, landed: i > 0 && i % 30 === 0, yaw: i * 0.01, pitch: 0,
      floorAt: () => 0, obstructed: () => false,
      bounds: {minX: -100, maxX: 100, minZ: -100, maxZ: 100}, ceilingY: 24,
      interrupted: i === 120,
    };
    const frames = [
      stepMovement(states[0], {jump: i % 7 === 0, jumpHeld: i % 7 < 3}, shared),
      stepMovement(states[1], {jumpHeld: i % 5 < 3, crouch: i % 11 === 0}, shared),
      stepMovement(states[2], {mobility: i === 40 || i === 160}, {...shared, castRay: () => ({x: 2, y: 3, z: -3})}),
    ];
    trace.push(JSON.stringify({frames, snapshots: states.map(movementSnapshot)}));
  }
  return {trace, snapshots: states.map(movementSnapshot)};
}

test('two identical runs produce byte-identical frames and snapshots (no hidden randomness)', () => {
  const first = determinismScenario();
  const second = determinismScenario();
  assert.deepEqual(first.snapshots, second.snapshots);
  assert.equal(first.trace.length, second.trace.length);
  for (let i = 0; i < first.trace.length; i++) assert.equal(first.trace[i], second.trace[i], `tick ${i}`);
  const walk = value => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), 'every number is finite');
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(first.snapshots);
});

// ---------------------------------------------------------------------------
// 19. §4.7 bound sweeps over the resolved table
// ---------------------------------------------------------------------------

test('§4.7 sweep: every resolved verb respects the chain, ceiling, field and interaction caps', () => {
  for (const spec of MOVEMENT_SPECS) {
    const params = resolveMovementParams(spec.id, {});
    assert.ok(params.maxCharges === 0 || params.maxCharges >= 1, `${spec.id} charges`);
    for (const field of ['cooldown', 'windup', 'landing', 'duration', 'distance', 'reel', 'missCooldown', 'radius', 'knockback', 'impulse', 'leap', 'slamDescent', 'fuel', 'fuelRecharge', 'climb', 'descent', 'steer', 'anchorLife']) {
      assert.ok(Number.isFinite(params[field]) && params[field] >= 0, `${spec.id}.${field} ≥ 0`);
    }
    if (spec.id === 'blink-step') assert.ok(params.distance <= 6, 'blink ≤6 m');
    if (spec.id === 'grapple') assert.ok(params.distance <= 14, 'grapple ≤14 m');
    if (spec.id === 'brace-slam') {
      assert.ok(params.radius <= 4, 'slam radius is the pinned 4 m');
      assert.ok(params.knockback <= 9, 'slam knockback is the pinned 9');
    }
  }
  assert.equal(INTERACTION_BONUS_CAP, 1.35);
});
