// Phase 2 integration tests: the movement-verb framework (game/movement.mjs)
// and the nine operator signature verbs (game/operator-verbs.mjs) wired into
// the authoritative `Match` (docs/design/CLASS_OVERHAUL.md §3.2, §3.4, §3.6,
// §3.7, §4.4, §4.7, §12.2 Phase 2).
//
// These tests deliberately drive `Match.step` with scripted inputs and assert
// observable sim state — never module internals — so they cover the wiring
// itself: actor lifecycle, per-tick stepping, carrier weakening, death resets,
// the Deep Compute one-shot clamp through `Match.fire`/`Match.damage`, Kimi's
// trail TTL and a JSON/structured-clone-safe snapshot round trip.

import test from 'node:test';
import assert from 'node:assert/strict';
import {Match, floorAt} from './core.mjs';
import {RULES} from './data.mjs';
import {MOVEMENT_EVENTS, MOVEMENT_SNAPSHOT_FIELDS} from './movement.mjs';
import {DEEP_COMPUTE, TOOL_USE} from './operator-verbs.mjs';
import {snapshotDelta, applySnapshotDelta} from './protocol.mjs';
import {botMovementIntent} from './bots.mjs';

const DT = RULES.dt;
const seeded = (seed = 7) => {
  let n = seed >>> 0;
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
};

// A deterministic one-human match on flat, supported ground with pickups removed
// so supplies cannot contaminate the assertions.
function rig(character, harness, options = {}) {
  const match = new Match(character, harness, seeded(options.seed ?? 7), options.mapId ?? 'exchange', {
    mode: options.mode ?? 'deathmatch',
    botCount: 0,
    humanCount: options.humanCount ?? 1,
    ...(options.loadouts ? {loadouts: options.loadouts} : {}),
    ...(options.config ?? {}),
  });
  match.pickups = [];
  const [first] = match.actors;
  place(match, first, options.spot ?? [0, 8], options.yaw ?? 0);
  first.protection = 0;
  return match;
}

function place(match, actor, [x, z], yaw = 0, pitch = 0) {
  const y = floorAt(x, z, match.arena);
  assert.ok(y !== null, `placement (${x}, ${z}) is supported on ${match.arena.id}`);
  Object.assign(actor, {x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch, grounded: true, lastValid: {x, y, z}});
  return actor;
}

const tick = (match, id, input) => match.step(DT, {inputs: {[id]: input}});
const eventsOf = (match, type) => match.events.filter(event => event.type === type);

// ---------------------------------------------------------------------------
// 1. Lifecycle and inertness
// ---------------------------------------------------------------------------

test('actor creation and spawn attach a live movement and signature-verb state', () => {
  for (const [character, harness, verb] of [['mistral', 'openclaw', 'air-dash'], ['qwen', 'hermes', 'deployable-rope'], ['deepseek', 'cline', 'hover-jets']]) {
    const match = rig(character, harness);
    const actor = match.actors[0];
    assert.equal(actor.movement.verb, verb, `${character} movement verb`);
    assert.equal(actor.verbState.operator, character, `${character} signature verb`);
    assert.equal(actor.movement.phase, 'ready');
    assert.equal(actor.movement.enabled, true);
  }
});

test('a loadout applied after actor creation still resolves the right class state', () => {
  // Match.actor() is built with a cycled character; room loadouts overwrite
  // character/harness before spawn. Both states must follow the final loadout.
  const match = new Match('chatgpt', 'openclaw', seeded(5), 'crosswire', {
    mode: 'deathmatch', botCount: 0, humanCount: 2,
    loadouts: {0: {character: 'claude', harness: 'claudecode'}, 1: {character: 'grok', harness: 'hermes'}},
  });
  const [claude, grok] = match.actors;
  assert.deepEqual([claude.character, claude.harness], ['claude', 'claudecode']);
  assert.equal(claude.verbState.verb, 'alignment-review');
  assert.equal(claude.movement.verb, 'safety-glide');
  assert.equal(claude.movement.character, 'claude');
  assert.equal(grok.verbState.verb, 'heat');
  assert.equal(grok.movement.verb, 'super-jump');
  assert.equal(grok.movement.harness, 'hermes');
});

test('no input, grounded and idle: the movement verb never moves and never emits', () => {
  for (const character of ['mistral', 'gemini', 'grok', 'deepseek', 'meta', 'claude', 'chatgpt', 'kimi', 'qwen']) {
    const match = rig(character, 'openclaw');
    const actor = match.actors[0];
    actor.cooldown = 1e9; // keep the harness active out of the picture
    const start = {x: actor.x, y: actor.y, z: actor.z};
    const charges = actor.movement.charges;
    const fuel = actor.movement.fuel;
    for (let i = 0; i < 240; i++) match.step(DT, {});
    assert.equal(actor.movement.phase, 'ready', `${character} stays ready`);
    assert.equal(actor.movement.charges, charges, `${character} charge untouched`);
    assert.equal(actor.movement.fuel, fuel, `${character} fuel untouched`);
    assert.ok(Math.hypot(actor.x - start.x, actor.z - start.z) < 0.35, `${character} stays put`);
    const movementEvents = match.events.filter(event => MOVEMENT_EVENTS.includes(event.type));
    assert.deepEqual(movementEvents, [], `${character} emits no movement events while idle`);
  }
});

// ---------------------------------------------------------------------------
// 2. Movement verbs end to end through Match.step
// ---------------------------------------------------------------------------

test('air dash end to end: jump, airborne jump edge, 5.5 m translation and landing recovery', () => {
  const match = rig('mistral', 'openclaw');
  const actor = match.actors[0];
  const startZ = actor.z;
  tick(match, 0, {jump: true}); // normal hop first
  assert.equal(actor.grounded, false);
  for (let i = 0; i < 2; i++) match.step(DT, {});
  tick(match, 0, {jump: true}); // second press while airborne -> air dash
  assert.equal(actor.movement.phase, 'active', 'the dash is active');
  assert.equal(actor.movement.charges, 0, 'the dash spends its one charge');
  assert.ok(Math.abs((actor.z - startZ) + 5.5) < 0.25, `dashed 5.5 m toward -z (got ${(actor.z - startZ).toFixed(2)})`);
  assert.ok(eventsOf(match, 'move-start').some(event => event.reason === 'dash'));
  for (let i = 0; i < 150; i++) match.step(DT, {});
  assert.equal(actor.movement.phase, 'ready');
  assert.ok(actor.movement.cooldown > 0, 'the 2.5 s cooldown starts at the end');
  assert.ok(eventsOf(match, 'landing-recovery').length >= 1, 'a clean landing pays the recovery beat');
});

test('blink step end to end: 0.3 s wind-up then a 6 m aimed translation with a 6 s cooldown', () => {
  const match = rig('kimi', 'openclaw', {spot: [0, 11]});
  const actor = match.actors[0];
  const startZ = actor.z;
  tick(match, 0, {mobility: true});
  assert.equal(actor.movement.phase, 'windup');
  assert.ok(eventsOf(match, 'windup-start').length === 1);
  for (let i = 0; i < 25; i++) match.step(DT, {});
  assert.equal(actor.movement.phase, 'ready');
  assert.ok(Math.abs((actor.z - startZ) + 6) < 0.3, `blinked ~6 m toward -z (got ${(actor.z - startZ).toFixed(2)})`);
  assert.ok(actor.movement.cooldown > 5.5 && actor.movement.cooldown <= 6, 'the 6 s cooldown starts at the end');
  assert.ok(eventsOf(match, 'windup-end').length === 1);
});

test('deployable rope end to end: placement registers a per-match line a rider can use', () => {
  const match = rig('qwen', 'openclaw', {yaw: Math.PI}); // aim +z, at the shell wall
  const actor = match.actors[0];
  tick(match, 0, {mobility: true});
  assert.equal(actor.movement.phase, 'ready');
  assert.equal(actor.movement.charges, 0, 'placing the anchor spends the charge');
  assert.equal(match.ropeLines.length, 1, 'the anchor lives in per-match state, not the arena tables');
  const line = match.ropeLines[0];
  assert.equal(line.owner, actor.id);
  assert.ok(line.to.z > actor.z, 'anchor placed downrange');
  // Ride it: stand at the line base and step; moveActor boards the rope.
  place(match, actor, [line.from.x, line.from.z], Math.PI);
  actor.y = line.from.y;
  match.step(DT, {});
  assert.ok(actor.zipRide, 'the rider boards the rope');
  for (let i = 0; i < 150 && actor.zipRide; i++) match.step(DT, {});
  assert.equal(actor.zipRide, null);
  assert.ok(actor.z > line.from.z + 3, `the ride carries the rider (z ${actor.z.toFixed(2)})`);
});

// ---------------------------------------------------------------------------
// 3. Carrier weakening and juggernaut lift
// ---------------------------------------------------------------------------

test('carrier weakening: the Qwen/Hermes exception survives pickup and refreshes on drop', () => {
  const match = rig('deepseek', 'hermes', {
    mode: 'ctf',
    humanCount: 2,
    loadouts: {0: {character: 'deepseek', harness: 'hermes'}, 1: {character: 'chatgpt', harness: 'openclaw'}},
  });
  const [actor] = match.actors;
  const enemyFlag = match.flags[1];
  place(match, actor, [enemyFlag.x, enemyFlag.z]);
  match.objective(actor);
  assert.equal(actor.carryingFlag, true, 'flag picked up');
  assert.equal(actor.movement.carrier.weakened, true);
  assert.equal(actor.movement.carrier.reason, 'spec');
  assert.equal(actor.movement.params.liftScale, 0, 'no vertical lift while carrying');
  assert.ok(actor.movement.maxFuel < 2.5, 'half fuel pool');
  actor.cooldown = 0;
  assert.equal(match.power(actor), false, 'the harness active is suppressed while carrying');
  match.dropFlag(actor);
  assert.equal(actor.movement.carrier.weakened, false);
  assert.equal(actor.movement.params.liftScale, 1, 'the verb comes back on drop');
  assert.ok(actor.movement.maxFuel >= 2.5, 'full fuel pool returns');
});

test('a default carrier loses the verb entirely; the juggernaut keeps it at x0.7 lift', () => {
  const ctf = rig('mistral', 'openclaw', {
    mode: 'ctf',
    humanCount: 2,
    loadouts: {0: {character: 'mistral', harness: 'openclaw'}, 1: {character: 'chatgpt', harness: 'openclaw'}},
  });
  const carrier = ctf.actors[0];
  const enemyFlag = ctf.flags[1];
  place(ctf, carrier, [enemyFlag.x, enemyFlag.z]);
  ctf.objective(carrier);
  assert.equal(carrier.carryingFlag, true);
  assert.equal(carrier.movement.enabled, false, 'a Striker carrier loses the dash');
  tick(ctf, 0, {jump: true});
  assert.ok(!eventsOf(ctf, 'move-start').length, 'a disabled verb cannot start');

  const jug = rig('gemini', 'openclaw', {mode: 'juggernaut'});
  const holder = jug.actors[0];
  jug.setJuggernaut(holder.id);
  assert.equal(holder.juggernaut, true);
  assert.ok(Math.abs(holder.movement.params.liftScale - 0.7) < 1e-9, 'Juggernaut lift x0.7');
  assert.equal(holder.movement.carrier.shieldFrozenAirborne, true);
});

// ---------------------------------------------------------------------------
// 4. Death lifecycle
// ---------------------------------------------------------------------------

test('death resets the movement verb and the signature verb, and clears placed ropes', () => {
  const match = rig('qwen', 'openclaw', {
    yaw: Math.PI,
    humanCount: 2,
    loadouts: {0: {character: 'qwen', harness: 'openclaw'}, 1: {character: 'chatgpt', harness: 'openclaw'}},
  });
  const [actor, killer] = match.actors;
  tick(match, 0, {mobility: true}); // place a rope
  assert.equal(match.ropeLines.length, 1);
  TOOL_USE.onPickup(actor.verbState, {magazine: 30, ammo: 0, cap: 30});
  assert.ok(actor.verbState.windowIn > 0);
  actor.health = 1;
  match.damage(actor, 50, killer);
  assert.equal(actor.health, 0);
  assert.equal(actor.movement.phase, 'ready');
  assert.equal(actor.movement.charges, actor.movement.maxCharges, 'charges refill on death');
  assert.equal(actor.movement.cooldown, 0);
  assert.equal(actor.movement.chains, 0);
  assert.equal(actor.verbState.windowIn, 0, 'the Tool Use window clears on death');
  assert.equal(actor.verbState.lastReset, 'death');
  assert.equal(match.ropeLines.length, 0, 'a dead placer leaves no rope behind');
});

// ---------------------------------------------------------------------------
// 5. Deep Compute through the real fire/damage path
// ---------------------------------------------------------------------------

for (const [targetCharacter, maxHealth] of [['chatgpt', 100], ['deepseek', 120]]) {
  test(`Deep Compute never one-shots a full-health ${maxHealth} HP target through Match.fire`, () => {
    const match = new Match('deepseek', 'openclaw', seeded(11), 'exchange', {
      mode: 'deathmatch', botCount: 0, humanCount: 2,
      loadouts: {0: {character: 'deepseek', harness: 'openclaw'}, 1: {character: targetCharacter, harness: 'openclaw'}},
    });
    match.pickups = [];
    const [shooter, target] = match.actors;
    place(match, shooter, [0, 6]);
    place(match, target, [0, 4]);
    shooter.weapon = 2; // Rail Lance: 82 direct damage, the case the clamp exists for
    shooter.ammo = shooter.ammo.map((rounds, index) => (index === 2 ? 5 : 0));
    shooter.shotWait = 0;
    shooter.protection = 0;
    target.health = target.maxHealth;
    target.armor = 0;
    target.protection = 0;
    DEEP_COMPUTE.step(shooter.verbState, 1.2, {firing: true});
    assert.equal(DEEP_COMPUTE.charge(shooter.verbState), 1, 'the meter fills');
    assert.equal(match.fire(shooter), true);
    assert.equal(DEEP_COMPUTE.charge(shooter.verbState), 0, 'the shot consumes the charge');
    assert.ok(target.health > 0, `the full-health target survives (${target.health} HP)`);
    const ceiling = Math.min(90, 0.9 * target.maxHealth);
    assert.ok(target.maxHealth - target.health <= ceiling + 1e-9, 'damage respects the one-shot ceiling');
    assert.equal(target.health, target.maxHealth - ceiling, 'the charged rail lands exactly at the ceiling');
  });
}

// ---------------------------------------------------------------------------
// 6. Kimi trails
// ---------------------------------------------------------------------------

test('Kimi trails: a visible enemy leaves a <=1.5 s trail; cloak suppresses and TTL expires', () => {
  const match = new Match('kimi', 'openclaw', seeded(3), 'exchange', {
    mode: 'deathmatch', botCount: 0, humanCount: 2,
    loadouts: {0: {character: 'kimi', harness: 'openclaw'}, 1: {character: 'chatgpt', harness: 'openclaw'}},
  });
  match.pickups = [];
  const [kimi, enemy] = match.actors;
  place(match, kimi, [0, 5]);
  place(match, enemy, [0, 3.5]);
  for (let i = 0; i < 6; i++) match.step(DT, {});
  assert.equal(kimi.verbState.trails.length, 1, 'a visible enemy is recorded');
  const trail = kimi.verbState.trails[0];
  assert.equal(trail.enemyId, enemy.id);
  assert.ok(trail.ttl > 0 && trail.ttl <= 1.5, 'TTL is capped at 1.5 s');
  enemy.powerups = {cloak: 60};
  for (let i = 0; i < 100; i++) match.step(DT, {});
  assert.equal(kimi.verbState.trails.length, 0, 'trails expire and cloak stops new records');
  assert.deepEqual(kimi.verbState.trails, []);
});

// ---------------------------------------------------------------------------
// 7. Snapshots
// ---------------------------------------------------------------------------

test('snapshots carry movement/verbState per actor and survive JSON, clone and delta round trips', () => {
  const match = rig('qwen', 'openclaw', {yaw: Math.PI});
  tick(match, 0, {mobility: true}); // an anchor plus a spent charge
  const actor = match.actors[0];
  TOOL_USE.onPickup(actor.verbState, {magazine: 12, ammo: 0, cap: 30});
  const first = match.snapshot();
  for (const entry of first.actors) {
    assert.ok(entry.movement && typeof entry.movement === 'object', `actor ${entry.id} has a movement snapshot`);
    assert.deepEqual(Object.keys(entry.movement), [...MOVEMENT_SNAPSHOT_FIELDS], `actor ${entry.id} movement fields are the documented list`);
    assert.ok(entry.verbState && typeof entry.verbState === 'object', `actor ${entry.id} has a verb snapshot`);
    assert.equal(entry.verbState.verb, 'tool-use');
    assert.equal(entry.verbState.active, true);
  }
  assert.ok(first.actors[0].movement.anchor, 'the placed anchor rides the snapshot');
  // JSON-safe and clone-safe.
  assert.doesNotThrow(() => JSON.stringify(first));
  assert.deepEqual(structuredClone(first), first);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(first))), JSON.stringify(first));
  // Delta-friendly: patching the first snapshot reproduces the second.
  for (let i = 0; i < 3; i++) match.step(DT, {});
  const second = match.snapshot();
  const patch = snapshotDelta(first, second);
  assert.ok(patch, 'a delta is produced');
  const patched = applySnapshotDelta(first, patch);
  assert.deepEqual(patched.actors.map(entry => entry.movement), second.actors.map(entry => entry.movement), 'movement deltas round-trip');
  assert.deepEqual(patched.actors.map(entry => entry.verbState), second.actors.map(entry => entry.verbState), 'verb deltas round-trip');
  assert.deepEqual(patched, second, 'the full delta round trip is lossless');
});

// ---------------------------------------------------------------------------
// 8. Bots
// ---------------------------------------------------------------------------

test('bots use their movement verbs deterministically and never touch Math.random', () => {
  const run = () => {
    const match = new Match('mistral', 'openclaw', seeded(21), 'crosswire', {
      mode: 'deathmatch', botCount: 5, difficulty: 'hard', timeLimit: 30, fragLimit: 40,
    });
    let used = 0;
    for (let i = 0; i < 30 * 60; i++) {
      match.step(DT, {});
      for (const actor of match.actors) {
        if (!actor.bot || !actor.movement) continue;
        if (actor.movement.phase !== 'ready' || actor.movement.chains > 0) used++;
      }
    }
    return {match, used, snapshot: match.snapshot()};
  };
  const first = run();
  const second = run();
  assert.ok(first.used > 0, 'at least one bot spent a movement verb');
  assert.deepEqual(first.snapshot, second.snapshot, 'two identical runs are byte-identical');
});

// Regression: bots signal Brace Slam through `input.slam` (botMovementIntent
// mvHoldKind==='slam'); Match.step must forward it or the verb never fires.
test('brace slam fires from a direct slam input edge', () => {
  const match = rig('meta', 'openclaw');
  const actor = match.actors[0];
  actor.cooldown = 1e9; // keep the Claw Burst out of the frame
  tick(match, 0, {slam: true});
  assert.equal(actor.movement.phase, 'windup', 'the slam winds up from the slam edge');
  assert.equal(eventsOf(match, 'windup-start').length, 1);
  for (let i = 0; i < 240; i++) match.step(DT, {inputs: {0: {slam: true}}});
  assert.ok(eventsOf(match, 'slam-launch').length >= 1, 'the leap launched');
  assert.ok(eventsOf(match, 'slam-impact').length >= 1, 'the impact resolved on landing');
  assert.equal(actor.movement.charges, 0, 'the slam spent its charge');
  assert.ok(actor.movement.cooldown > 0, 'the 8 s cooldown started');
});

// Regression: the Meta bot intent pressed `slam` only while airborne/descending
// (`!grounded && vy < 0`), but the verb refuses to start unless `grounded`, so
// Brace Slam fired zero times per match. The intent now presses while planted
// and in range. These two tests pin the intent condition and a real match.
test('the Meta bot intent presses Brace Slam from the ground and only in range', () => {
  const match = new Match('meta', 'openclaw', seeded(5), 'crosswire', {
    mode: 'deathmatch', humanCount: 1, botCount: 1, difficulty: 'normal', timeLimit: 30, fragLimit: 40,
  });
  const actor = match.actors[0];
  const bot = actor.bot ?? (actor.bot = {});
  Object.assign(actor, {grounded: true, vy: 0, health: actor.maxHealth, active: 0, cooldown: 1e9});
  assert.equal(actor.movement.phase, 'ready');
  assert.equal(botMovementIntent(match, actor, bot, {}, DT, 4).slam, true, 'grounded and in range presses the slam');
  // Out of range: the band opens the leap once the target is close enough.
  const held = {};
  assert.equal(botMovementIntent(match, actor, held, {}, DT, 12).slam, undefined, 'a far target does not spend the slam');
  // Airborne: the verb requires the ground, so the intent must not press there.
  Object.assign(actor, {grounded: false, vy: -3});
  assert.equal(botMovementIntent(match, actor, {}, {}, DT, 4).slam, undefined, 'the intent never presses while airborne');
});

test('a Meta bot spends Brace Slam in a deterministic match', () => {
  const run = () => {
    const match = new Match('chatgpt', 'openclaw', seeded(31), 'crosswire', {
      mode: 'koth', humanCount: 1, botCount: 5, difficulty: 'hard', timeLimit: 30, fragLimit: 40,
      botLoadouts: Array.from({length: 5}, () => ({character: 'meta', harness: 'openclaw'})),
    });
    let spent = 0;
    for (let i = 0; i < 30 * 60; i++) {
      match.step(DT, {});
      for (const actor of match.actors) {
        if (!actor.bot || actor.movement?.verb !== 'brace-slam') continue;
        if (actor.movement.phase !== 'ready' || actor.movement.chains > 0) spent++;
      }
    }
    return {match, spent, snapshot: match.snapshot()};
  };
  const first = run(), second = run();
  assert.ok(first.match.actors.filter(a => a.bot).every(a => a.character === 'meta'), 'the bots are Meta');
  assert.ok(first.spent > 0, 'a Meta bot spent Brace Slam');
  assert.deepEqual(first.snapshot, second.snapshot, 'two identical runs are byte-identical');
});
