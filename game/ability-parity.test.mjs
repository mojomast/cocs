// Golden parity traces for `Match.power()` — Phase 1 of the COCS class &
// harness overhaul (docs/design/CLASS_OVERHAUL.md §7.1, §12.2 tasks 4-5, §13.2).
//
// §13.2 contract pinned here: `power()` owns all shared bookkeeping — guards,
// cooldown, `active`, `activeSpeedMultiplier`, `emit('power')` and
// `stats.powers` — and must stay byte-identical while the dispatch moves to an
// `ability.kind` router. This test captures the pre-refactor behaviour for all
// 7 harnesses on two modes/maps by replaying a fixed 260-step script with a
// seeded RNG (never `Math.random`, never wall-clock time).
//
// Recorded per harness:
//   trace        per-step cooldown / active / activeSpeedMultiplier /
//                stats.powers (arrays indexed by step);
//   events       every event emitted during the script, with step + payload, so
//                presence/order/timing of power-related events is pinned;
//   checkpoints  actor/target/third snapshots (health, armor, slow, position,
//                velocity, shotWait) at fixed steps — each power's observable
//                effect, rounded to 6 decimals;
//   guards       direct `power()` calls that must be refused (cooldown, CTF
//                flag carrier), including their return value and state delta.
//
// Intentionally not covered: bot AI, vehicles, weapons other than the pulse
// rifle, net prediction, and any path that does not flow through `power()`.
// Ability numbers are never hard-coded: the fixture is the observation.
//
// Regenerate deliberately (review the diff first — intended drift only):
//   COCS_UPDATE_ABILITY_PARITY=1 node --test --test-timeout=120000 game/ability-parity.test.mjs
// Compare (normal test run):
//   node --test --test-timeout=120000 game/ability-parity.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Match, floorAt, obstructed} from './core.mjs';
import {HARNESSES, RULES} from './data.mjs';

const DT = RULES.dt;
const STEPS = 260;
const ROUNDING = 6;
const CHARACTER = 'chatgpt';
// Targets stay on a harness with resistance 0 so damage arithmetic is exact.
const TARGET_HARNESS = 'openclaw';
const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/ability-parity.json', import.meta.url));
const UPDATE = process.env.COCS_UPDATE_ABILITY_PARITY === '1';

// Two representative modes/maps. Scripted placements are flat, open ground and
// are validated before use, so a blocked or unsupported spot fails generation.
const SCENARIOS = [
  {
    id: 'deathmatch-crosswire',
    mapId: 'crosswire',
    config: {mode: 'deathmatch', botCount: 0, difficulty: 'normal', timeLimit: 300, startingWeapon: 0},
    // FFA: actor 0, enemy target, second enemy within Claw Burst radius.
    placement: {actor: [9, 0], target: [5, 0], third: [9, 3]},
    powerStep: 20,
    pressSteps: [20, 21, 30],
    cooldownProbeStep: 25,
    postProbeStep: 210, // active (max 3 s from step 20) has expired
    sampleSteps: [19, 20, 21, 40, 60, 120, 200, 210, 259],
  },
  {
    id: 'ctf-launchpad',
    mapId: 'launchpad',
    config: {mode: 'ctf', botCount: 0, difficulty: 'normal', timeLimit: 300, startingWeapon: 0},
    // CTF: target is an enemy, third is a teammate inside the burst radius so
    // the team filter is observable; a second activation is forced at step 50.
    placement: {actor: [-10, 0], target: [-6, 0], third: [-7, 1.5]},
    powerStep: 20,
    pressSteps: [20, 21, 30, 50, 60],
    resyncCooldownStep: 50,
    carrierProbeStep: 35,
    postProbeStep: 250, // second activation (step 50) has expired again
    sampleSteps: [19, 20, 21, 40, 60, 120, 200, 250, 259],
  },
];

// Repo deterministic-RNG pattern (game/core.test.mjs): a seeded LCG.
function seededRng(seed) {
  let n = seed >>> 0;
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function seedFor(scenarioIndex, harnessIndex) {
  return (0xc0c5 + scenarioIndex * 101 + harnessIndex * 7) >>> 0;
}

// Round to 6 decimals and normalise -0; throw on non-finite values so the
// fixture can never silently serialise `null` (JSON has no Infinity/NaN).
function r6(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`ability parity: non-finite fixture value ${String(value)}`);
  }
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

const point = value => ({x: r6(value.x), y: r6(value.y), z: r6(value.z)});

function actorState(actor) {
  return {
    health: r6(actor.health),
    armor: r6(actor.armor),
    slow: r6(actor.slow || 0),
    slowMultiplier: r6(actor.slowMultiplier ?? 1),
    cooldown: r6(actor.cooldown),
    active: r6(actor.active),
    activeSpeedMultiplier: r6(actor.activeSpeedMultiplier),
    shotWait: r6(actor.shotWait),
    grounded: actor.grounded === true,
    position: [r6(actor.x), r6(actor.y), r6(actor.z)],
    velocity: [r6(actor.vx), r6(actor.vy), r6(actor.vz)],
  };
}

function checkpoint(match) {
  const [actor, target, third] = match.actors;
  return {actor: actorState(actor), target: actorState(target), third: actorState(third)};
}

// Fixed payload whitelist keeps the diff readable and stable; presence, order
// and step/timing of events are pinned by the events array itself.
const EVENT_FIELDS = ['actor', 'source', 'harness', 'duration', 'amount', 'shield', 'shieldBreak', 'weapon', 'hit', 'falloff', 'kind'];
function recordEvent(step, event) {
  const out = {step, type: event.type};
  for (const key of EVENT_FIELDS) {
    if (event[key] === undefined) continue;
    out[key] = typeof event[key] === 'number' ? r6(event[key]) : event[key];
  }
  if (event.pos) out.pos = point(event.pos);
  if (event.from) out.from = point(event.from);
  if (event.to) out.to = point(event.to);
  return out;
}

function probePower(match, step, kind) {
  const actor = match.actors[0];
  const before = match.events.reduce((max, event) => Math.max(max, event.id), 0);
  const result = match.power(actor);
  return {
    step,
    kind,
    result,
    cooldown: r6(actor.cooldown),
    active: r6(actor.active),
    activeSpeedMultiplier: r6(actor.activeSpeedMultiplier),
    powers: match.stats.powers,
    eventsAdded: match.events.filter(event => event.id > before).length,
  };
}

function placeActor(match, actor, [x, z]) {
  const y = floorAt(x, z, match.arena);
  assert.ok(y !== null && !obstructed(x, y, z, RULES.radius, match.arena),
    `ability parity: blocked placement (${x}, ${z}) on ${match.arena.id}`);
  Object.assign(actor, {x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, grounded: true, lastValid: {x, y, z}});
}

function runHarness(scenario, harness, seed) {
  const match = new Match(CHARACTER, harness, seededRng(seed), scenario.mapId, {
    ...scenario.config,
    humanCount: 3,
    loadouts: {
      0: {character: CHARACTER, harness},
      1: {character: CHARACTER, harness: TARGET_HARNESS},
      2: {character: CHARACTER, harness: TARGET_HARNESS},
    },
  });
  assert.equal(match.actors.length, 3, 'ability parity: scenario expects exactly three controlled actors');
  const [actor, target, third] = match.actors;
  placeActor(match, actor, scenario.placement.actor);
  placeActor(match, target, scenario.placement.target);
  placeActor(match, third, scenario.placement.third);
  for (const a of match.actors) {
    a.protection = 0;
    a.cooldown = 0;
    a.active = 0;
    a.slow = 0;
    a.slowMultiplier = .55;
    a.shotWait = 0;
    a.reloading = false;
  }
  if (harness === 'codex') actor.health = 40; // Recompile's heal must be observable

  const inputs = new Map();
  const pre = new Map();
  const guards = [];
  const addInput = (step, input) => {
    assert.ok(step >= 0 && step < STEPS, `ability parity: script step ${step} out of range`);
    inputs.set(step, {...(inputs.get(step) || {}), ...input});
  };
  for (const step of scenario.pressSteps) addInput(step, {power: true});

  if (scenario.resyncCooldownStep !== undefined) {
    // The second activation is deliberate; zero the cooldown so it is not the
    // cooldown guard under test.
    pre.set(scenario.resyncCooldownStep, () => { actor.cooldown = 0; });
  }
  if (scenario.cooldownProbeStep !== undefined) {
    const step = scenario.cooldownProbeStep;
    pre.set(step, () => { guards.push(probePower(match, step, 'cooldown')); });
  }
  if (scenario.carrierProbeStep !== undefined) {
    const step = scenario.carrierProbeStep;
    pre.set(step, () => {
      actor.cooldown = 0; // isolate the carrier guard from the cooldown guard
      const flag = match.flags[1];
      flag.carrier = actor.id;
      actor.carryingFlag = true;
      guards.push(probePower(match, step, 'carrier'));
      flag.carrier = null;
      actor.carryingFlag = false;
      const [fx, fz] = match.flagSpawns[1];
      Object.assign(flag, {x: fx, y: floorAt(fx, fz, match.arena) ?? 0, z: fz});
    });
  }
  if (harness === 'hermes') {
    // Courier Rush's effect is the speed multiplier read by moveActor: walk
    // during the active window only, then stand still.
    for (let step = scenario.powerStep + 1; step <= scenario.powerStep + 30; step++) addInput(step, {z: -1});
  }
  if (harness === 'opencode') {
    // Parallel Burst's effect is the fire interval: fire while active, then
    // fire again after expiry (postProbeStep is past the last active window).
    addInput(40, {fire: true});
    addInput(scenario.postProbeStep, {fire: true});
  }
  if (harness === 'claudecode') {
    // Guardrail halves incoming damage: same hit while active and after expiry.
    const hurt = () => { match.damage(actor, 60, target); };
    pre.set(40, hurt);
    pre.set(scenario.postProbeStep, hurt);
  }

  const trace = {cooldown: [], active: [], activeSpeedMultiplier: [], powers: []};
  const checkpoints = {};
  const events = [];
  let lastSerial = match.events.reduce((max, event) => Math.max(max, event.id), 0);

  for (let step = 0; step < STEPS; step++) {
    pre.get(step)?.();
    match.step(DT, inputs.get(step));
    trace.cooldown.push(r6(actor.cooldown));
    trace.active.push(r6(actor.active));
    trace.activeSpeedMultiplier.push(r6(actor.activeSpeedMultiplier));
    trace.powers.push(match.stats.powers);
    if (scenario.sampleSteps.includes(step)) checkpoints[step] = checkpoint(match);
    for (const event of match.events) {
      if (event.id <= lastSerial) continue;
      lastSerial = event.id;
      events.push(recordEvent(step, event));
    }
  }

  return {trace, checkpoints, guards, events};
}

function buildFixture() {
  const scenarios = {};
  SCENARIOS.forEach((scenario, scenarioIndex) => {
    const harnesses = {};
    HARNESSES.forEach((harness, harnessIndex) => {
      harnesses[harness.id] = runHarness(scenario, harness.id, seedFor(scenarioIndex, harnessIndex));
    });
    scenarios[scenario.id] = {
      map: scenario.mapId,
      mode: scenario.config.mode,
      character: CHARACTER,
      steps: STEPS,
      powerStep: scenario.powerStep,
      pressSteps: [...scenario.pressSteps],
      postProbeStep: scenario.postProbeStep,
      harnesses,
    };
  });
  return {
    format: 1,
    kind: 'ability-parity',
    note: 'Golden traces for Match.power() bookkeeping and per-harness effects, captured before the Phase 1 ability.kind router (docs/design/CLASS_OVERHAUL.md section 13.2). Values are rounded to 6 decimals. Do not hand-edit: regenerate with COCS_UPDATE_ABILITY_PARITY=1.',
    rounding: ROUNDING,
    stepSeconds: r6(DT),
    scenarios,
  };
}

// ---------------------------------------------------------------------------
// Fixture comparison: report the first mismatching path so a behaviour drift is
// readable in one line.
// ---------------------------------------------------------------------------
function firstMismatch(expected, actual, path = 'fixture') {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== typeof actual) {
    return {path, expected, actual};
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return {path, expected, actual};
    if (expected.length !== actual.length) return {path: `${path}.length`, expected: expected.length, actual: actual.length};
    for (let i = 0; i < expected.length; i++) {
      const found = firstMismatch(expected[i], actual[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (typeof expected === 'object') {
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);
    for (const key of expectedKeys) {
      if (!Object.hasOwn(actual, key)) return {path: `${path}.${key}`, expected: expected[key], actual: undefined};
    }
    for (const key of actualKeys) {
      if (!Object.hasOwn(expected, key)) return {path: `${path}.${key}`, expected: undefined, actual: actual[key]};
    }
    for (const key of expectedKeys) {
      const found = firstMismatch(expected[key], actual[key], `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return {path, expected, actual};
}

function formatValue(value) {
  if (value === undefined) return 'undefined';
  const text = JSON.stringify(value);
  return text === undefined ? String(value) : text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

test('Match.power() golden parity for all 7 harnesses on two modes/maps', {timeout: 120000}, () => {
  const actual = buildFixture();
  if (UPDATE) {
    mkdirSync(dirname(FIXTURE_PATH), {recursive: true});
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`ability-parity: wrote ${FIXTURE_PATH}`);
    return;
  }
  let expected;
  try {
    expected = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  } catch (error) {
    assert.fail(`ability parity fixture missing or unreadable at ${FIXTURE_PATH} (${error.code ?? error.message}). Generate it with COCS_UPDATE_ABILITY_PARITY=1 node --test --test-timeout=120000 game/ability-parity.test.mjs`);
  }
  const mismatch = firstMismatch(expected, actual);
  assert.equal(mismatch, null, mismatch
    ? `ability parity mismatch at ${mismatch.path}\n  expected: ${formatValue(mismatch.expected)}\n  actual:   ${formatValue(mismatch.actual)}\n\nReview the diff; if the drift is intended, regenerate with COCS_UPDATE_ABILITY_PARITY=1 node --test --test-timeout=120000 game/ability-parity.test.mjs`
    : undefined);
});
