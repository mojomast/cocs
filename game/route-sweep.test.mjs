// Route sweep — Phase 5 of the COCS class & harness overhaul
// (docs/design/CLASS_OVERHAUL.md §3.4, §4.4, §7.9, §12.2).
//
// Opt-in slow test: `COCS_SLOW_TESTS=1 node --test game/route-sweep.test.mjs`.
//
// Two sweeps cover all 41 registered arenas:
//   1. Geometry: every one of the nine movement verbs is driven, with real
//      terrain callbacks, on every arena and must stay inside the arena bounds
//      and the `min(58, arena.ceiling ?? 24)` ceiling, and must not translate
//      further in one activation than its §13.3 budget allows.
//   2. Bot navigation: a short real `Match` with bot seats on every non-race
//      arena must make progress (no stall) and never escape the same bounds.
//
// The geometry sweep is fast; the bot sweep pays the navigation-graph build
// per arena, which is why the whole file is opt-in.

import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS} from './maps.mjs';
import {Match, floorAt, obstructed, moveActor, rayWorld} from './core.mjs';
import {RULES} from './data.mjs';
import {OPERATOR_KITS} from './kits.mjs';
import {slowSkip} from './test-support.mjs';
import {MOVEMENT_SPECS, ceilingFor, createMovementState, stepMovement} from './movement.mjs';

const DT = RULES.dt;
const SKIP = slowSkip('slow test: set COCS_SLOW_TESTS=1 to run the all-arena route sweep');
const BOUNDS_MARGIN = 1.5;
const defaultBounds = {minX: -13.55, maxX: 13.55, minZ: -13.55, maxZ: 13.55};
const boundsOf = arena => arena.bounds ?? defaultBounds;
const OWNER_BY_VERB = Object.fromEntries(OPERATOR_KITS.map(kit => [kit.movement, kit.id]));

// The race maps have no infantry route; the other 39 arenas are the design's
// "39 non-race" set.
const COMBAT_ARENAS = MAPS.filter(arena => arena.id !== 'puma-circuit' && arena.id !== 'puma-pitch');

// A deterministic activation script per verb input family.
function inputAt(verbId, tick) {
  switch (verbId) {
    case 'air-dash':
    case 'double-jump':
      return tick === 0 ? {jump: true} : tick === 6 ? {jump: true} : {};
    case 'super-jump':
      return tick < 40 ? {crouch: true} : {};
    case 'hover-jets':
    case 'safety-glide':
      return tick === 0 ? {jump: true, jumpHeld: true} : tick < 120 ? {jumpHeld: true} : {};
    case 'brace-slam':
      return tick === 0 ? {slam: true} : {};
    default:
      return tick === 0 ? {mobility: true} : {};
  }
}

function startPoint(arena) {
  for (const [x, z] of arena.spawns) {
    const y = floorAt(x, z, arena);
    if (y !== null && !obstructed(x, y + 0.1, z, 0.42, arena) && !obstructed(x, y + 1, z, 0.42, arena)) return {x, y, z};
  }
  const b = boundsOf(arena), cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  for (let r = 0; r < Math.max(b.maxX - b.minX, b.maxZ - b.minZ); r += 1.5) {
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      const x = cx + dx, z = cz + dz;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const y = floorAt(x, z, arena);
      if (y !== null && !obstructed(x, y + 0.1, z, 0.42, arena) && !obstructed(x, y + 1, z, 0.42, arena)) return {x, y, z};
    }
  }
  return null;
}

// The activation events; `move-blocked`/misses do not count as a start.
const START_EVENTS = ['move-start', 'windup-start', 'charge-start', 'slam-launch'];
const ATTEMPT_EVENTS = ['move-miss', 'rope-miss', 'move-blocked'];

test('every movement verb is contained and budgeted on every registered arena', {skip: SKIP, timeout: 600000}, () => {
  assert.equal(MAPS.length, 41, 'the registry holds 41 arenas');
  assert.equal(COMBAT_ARENAS.length, 39, '39 non-race arenas');
  const attempted = Object.fromEntries(MOVEMENT_SPECS.map(spec => [spec.id, 0]));
  const started = Object.fromEntries(MOVEMENT_SPECS.map(spec => [spec.id, 0]));
  let maxTranslation = 0;
  for (const arena of MAPS) {
    const start = startPoint(arena);
    assert.ok(start, `${arena.id} has a supported start point`);
    const b = boundsOf(arena);
    const ceiling = ceilingFor(arena);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    for (const spec of MOVEMENT_SPECS) {
      const state = createMovementState({character: OWNER_BY_VERB[spec.id], harness: 'openclaw'}, {mode: 'deathmatch', verbId: spec.id});
      const actor = {x: start.x, y: start.y, z: start.z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, pitch: 0, inputJump: false, inputCrouch: false, inputMobility: false, eyeHeight: 1.45};
      actor.yaw = Math.atan2(-(cx - actor.x), -(cz - actor.z));
      let prevGrounded = actor.grounded;
      let maxDelta = 0;
      let didStart = false, didAttempt = false;
      for (let tick = 0; tick < 180; tick++) {
        const input = inputAt(spec.id, tick);
        const ctx = {
          dt: DT, x: actor.x, y: actor.y, z: actor.z, vy: actor.vy, yaw: actor.yaw, pitch: actor.pitch,
          grounded: actor.grounded, landed: !prevGrounded && actor.grounded === true,
          ceilingY: ceiling, carrying: false, vip: false, juggernaut: false,
          inVehicle: false, zipRide: false, traversalFlight: false,
          verbActive: state.phase === 'active', firing: false, dead: false,
          floorAt: (x, z) => floorAt(x, z, arena),
          obstructed: (x, y, z, r) => obstructed(x, y, z, r, arena),
          bounds: b,
          castRay: (origin, dir, maxDistance) => {
            const distance = rayWorld(origin, dir, maxDistance, arena);
            if (!(distance < maxDistance)) return null;
            return {x: origin.x + dir.x * distance, y: origin.y + dir.y * distance, z: origin.z + dir.z * distance};
          },
        };
        const frame = stepMovement(state, input, ctx);
        for (const event of frame.events) {
          if (START_EVENTS.includes(event.type)) didStart = true;
          if (ATTEMPT_EVENTS.includes(event.type)) didAttempt = true;
        }
        if (frame.motion.position) {
          const position = frame.motion.position;
          maxDelta = Math.max(maxDelta, Math.hypot(position.x - actor.x, position.z - actor.z));
          actor.x = position.x;
          actor.y = position.y;
          actor.z = position.z;
        }
        if (Number.isFinite(frame.motion.vy)) actor.vy = frame.motion.vy;
        prevGrounded = actor.grounded;
        // Settle through the real movement integrator, feeding the same jump /
        // crouch edge so jump-family verbs actually leave the ground.
        const length = Math.hypot(cx - actor.x, cz - actor.z) || 1;
        moveActor(actor, {
          jump: input.jump === true || input.jumpHeld === true,
          crouch: input.crouch === true,
          x: (cx - actor.x) / length,
          z: (cz - actor.z) / length,
        }, DT, arena);
        assert.ok(
          actor.x >= b.minX - BOUNDS_MARGIN && actor.x <= b.maxX + BOUNDS_MARGIN
          && actor.z >= b.minZ - BOUNDS_MARGIN && actor.z <= b.maxZ + BOUNDS_MARGIN,
          `${arena.id}/${spec.id}: escaped the horizontal bounds at tick ${tick} (${actor.x.toFixed(1)}, ${actor.z.toFixed(1)})`,
        );
        assert.ok(actor.y <= Math.max(start.y, ceiling) + BOUNDS_MARGIN, `${arena.id}/${spec.id}: escaped the ceiling at tick ${tick} (y ${actor.y.toFixed(1)} > ${Math.max(start.y, ceiling)})`);
      }
      // Aimed verbs may legitimately miss in open space; a miss still proves the
      // input reached the verb, so count it as an attempt.
      assert.ok(didStart || didAttempt, `${arena.id}/${spec.id}: the verb activated or attempted at least once`);
      if (didStart) started[spec.id] += 1;
      if (didStart || didAttempt) attempted[spec.id] += 1;
      // One activation can never translate further than the verb budget (+1.5 m
      // slack for the exact-final-probe sliver).
      const budget = (spec.distance || spec.reel * DT || 1) + BOUNDS_MARGIN;
      assert.ok(maxDelta <= budget, `${arena.id}/${spec.id}: single-activation translation ${maxDelta.toFixed(2)} > budget ${budget.toFixed(2)}`);
      maxTranslation = Math.max(maxTranslation, maxDelta);
    }
  }
  for (const spec of MOVEMENT_SPECS) {
    assert.equal(attempted[spec.id], MAPS.length, `${spec.id} was attempted on all 41 arenas`);
  }
  // Aimed verbs only hook where there is a surface downrange (19 of 41 here);
  // every other verb must genuinely start on every arena.
  for (const spec of MOVEMENT_SPECS) {
    if (spec.input === 'mobility') continue;
    assert.equal(started[spec.id], MAPS.length, `${spec.id} started on all 41 arenas`);
  }
  console.log(`route geometry: ${MAPS.length} arenas × ${MOVEMENT_SPECS.length} verbs, max single-activation translation ${maxTranslation.toFixed(2)} m, no bounds/ceiling escape`);
});

test('bots navigate without stalling and stay contained on every combat arena', {skip: SKIP, timeout: 1800000}, () => {
  const seeded = seed => {
    let n = seed >>> 0;
    return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
  };
  let totalStarts = 0;
  let minBotProgress = Infinity;
  const run = (arena, seed, verifyDeterminism = false) => {
    const match = new Match('chatgpt', 'openclaw', seeded(seed), arena.id, {
      mode: 'deathmatch', botCount: 3, humanCount: 1, aiSeats: true, difficulty: 'normal', timeLimit: 10, fragLimit: 40,
    });
    const starts = match.actors.map(actor => ({x: actor.x, z: actor.z}));
    const progress = match.actors.map(() => 0);
    const b = boundsOf(match.arena);
    let startsSeen = 0;
    for (let step = 0; step < Math.ceil(10 / DT); step++) {
      match.step(DT, {});
      match.actors.forEach((actor, index) => {
        progress[index] = Math.max(progress[index], Math.hypot(actor.x - starts[index].x, actor.z - starts[index].z));
        assert.ok(actor.x >= b.minX - 2 && actor.x <= b.maxX + 2 && actor.z >= b.minZ - 2 && actor.z <= b.maxZ + 2, `${arena.id}: actor ${actor.id} escaped bounds`);
        assert.ok(actor.y <= 30, `${arena.id}: actor ${actor.id} escaped the ceiling (y ${actor.y.toFixed(1)})`);
      });
      for (const event of match.events) if (START_EVENTS.includes(event.type)) startsSeen++;
      match.events.length = 0;
    }
    // Every bot except the leading seat (the local player slot, even with
    // aiSeats) must actually traverse the arena.
    for (let index = 1; index < match.actors.length; index++) {
      if (!match.actors[index].bot) continue;
      minBotProgress = Math.min(minBotProgress, progress[index]);
      assert.ok(progress[index] > 3, `${arena.id}: bot ${index} stalled (moved ${progress[index].toFixed(2)} m)`);
    }
    totalStarts += startsSeen;
    return match.snapshot();
  };
  for (const arena of COMBAT_ARENAS) run(arena, arena.id.length * 7919 + 13);
  // Determinism spot-check on the two cheapest arenas.
  for (const id of ['crosswire', 'aether']) {
    const arena = MAPS.find(entry => entry.id === id);
    assert.deepEqual(run(arena, 12345, true), run(arena, 12345, true), `${id} bot run is byte-identical`);
  }
  assert.ok(totalStarts > 0, 'bots spent movement verbs during the route sweep');
  console.log(`route bots: ${COMBAT_ARENAS.length} arenas, min bot progress ${minBotProgress.toFixed(2)} m, ${totalStarts} verb starts, no stall/bounds escape`);
});
