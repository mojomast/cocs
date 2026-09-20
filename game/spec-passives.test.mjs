// Phase 3B: the 7 behavioural spec passives (§3.3, §4.7, §12.2 Phase 3).
//
// Every passive is a named thing the engine does — melee arc, sprint posture,
// reload continuation, threat ping, reload speed, air control/slide and the
// Flood Fill radius/damage tradeoff — never a hidden speed/damage/resistance
// multiplier. Each test has a positive and a negative case: the spec's actor
// gets the behaviour, an otherwise identical actor on another spec does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match, MELEE, MOVE, moveActor} from './core.mjs';
import {HARNESSES, RULES, WEAPONS} from './data.mjs';
import {harnessWeaponHandling} from './harness-profiles.mjs';
import {SPECS, SPEC_EFFECT_TYPES, SPEC_EFFECT_TARGETS, SPEC_TRIGGERS} from './kits.mjs';
import {EFFECT_BOUNDS, passiveBonus, passiveEffect, passiveOf, passiveScale} from './spec-effects.mjs';

const rng = (seed = 7) => { let n = seed >>> 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
const closedArena = {blocks: [], bounds: {minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000}};
const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);

const match = (harness, options = {}, character = 'chatgpt') => {
  const m = new Match(character, harness, rng(), 'exchange', {mode: 'deathmatch', botCount: 0, ...options});
  m.arena = closedArena;
  m.pickups = [];
  m.vehicles = [];
  return m;
};

const quiet = actor => Object.assign(actor, {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, grounded: true,
  coyote: 0, jumpBuffer: 0, slideTimer: 0, slideCooldown: 0, slow: 0, active: 0,
  melee: 0, shotWait: 0, weaponSwitch: 0, reloading: false, spread: 0,
  punchYaw: 0, punchPitch: 0, protection: 0,
});

// ---------------------------------------------------------------------------
// Vocabulary and bounds
// ---------------------------------------------------------------------------

test('the 7 passives dispatch on the shared vocabulary and stay inside the §4.7 bounds', () => {
  assert.equal(SPECS.length, 7);
  const ids = new Set();
  for (const spec of SPECS) {
    ids.add(spec.passive.id);
    assert.ok(SPEC_TRIGGERS.includes(spec.passive.trigger), `${spec.id} trigger`);
    for (const effect of spec.passive.effects) {
      assert.ok(SPEC_EFFECT_TYPES.includes(effect.type), `${spec.id} ${effect.type}`);
      assert.ok(SPEC_EFFECT_TARGETS.includes(effect.target), `${spec.id} ${effect.target}`);
      const bounds = EFFECT_BOUNDS[effect.type];
      if (!bounds) continue;
      for (const [field, [min, max]] of Object.entries(bounds)) {
        if (!Number.isFinite(effect[field])) continue;
        assert.ok(effect[field] >= min && effect[field] <= max, `${spec.id} ${effect.type}.${field}=${effect[field]} outside [${min}, ${max}]`);
      }
    }
  }
  assert.equal(ids.size, 7);
  assert.equal(passiveOf('not-a-harness'), null);
  assert.equal(passiveOf(undefined), null);
  const roo = SPECS.find(spec => spec.id === 'roo').passive;
  assert.deepEqual(roo.effects, [
    {type: 'radius', target: 'ability', scale: 1.25},
    {type: 'damage', target: 'self', scale: .95},
  ]);
  // The engine-facing values are the descriptor values, clamped by EFFECT_BOUNDS.
  assert.equal(passiveScale('roo', 'radius'), 1.25);
  assert.equal(passiveScale('roo', 'damage'), .95);
  assert.equal(passiveBonus('cline', 'slide'), .2);
  assert.equal(passiveScale('openclaw', 'melee-arc'), 1.25);
  assert.equal(passiveScale('openclaw', 'damage'), 1, 'unknown axis falls back neutral');
  assert.ok(passiveEffect('hermes', 'sprint', {during: 'reload'}));
  assert.equal(passiveEffect('hermes', 'sprint', {during: 'air'}), null, 'query fields are matched');
  assert.ok(passiveEffect('opencode', 'reload', {during: 'swap', mode: 'continue'}));
});

test('no spec injects a hidden walk-speed multiplier: speed is the class stat only', () => {
  const walked = HARNESSES.map(harness => {
    const a = match(harness).actors[0];
    quiet(a);
    for (let i = 0; i < 60; i++) moveActor(a, {x: 1}, 1 / 60, closedArena);
    return a.vx;
  });
  assert.equal(new Set(walked.map(value => value.toFixed(9))).size, 1, `walk speeds differ: ${walked.join(', ')}`);
});

// ---------------------------------------------------------------------------
// OpenClaw · Grip — melee arc +25%
// ---------------------------------------------------------------------------

test('OpenClaw Grip widens the melee arc by 25% and misses outside the base arc otherwise', () => {
  // Target sits at a ~79.8° bearing: inside the relaxed 0.16 Grip threshold but
  // outside the base 0.2 threshold (the threshold is a minimum alignment dot).
  const place = harness => {
    const m = match(harness, {humanCount: 2});
    const [a, b] = m.actors;
    quiet(a);
    quiet(b);
    Object.assign(a, {health: 100, armor: 0});
    Object.assign(b, {x: 1, y: 0, z: -.18, health: 100, armor: 0});
    return {m, a, b};
  };
  const positive = place('openclaw');
  assert.equal(positive.m.melee(positive.a), true);
  assert.equal(positive.b.health, 100 - MELEE.damage, 'Grip threshold 0.16 catches the 0.177 dot');

  const negative = place('hermes');
  assert.equal(negative.m.melee(negative.a), true);
  assert.equal(negative.b.health, 100, 'without Grip the 0.177 dot stays outside the 0.2 threshold');
  assert.ok(positive.m.events.some(event => event.type === 'melee' && event.hit === positive.b.id));
  assert.ok(negative.m.events.some(event => event.type === 'melee' && event.hit === null));
});

// ---------------------------------------------------------------------------
// Hermes · Express — can sprint while reloading
// ---------------------------------------------------------------------------

test('Hermes Express is the only spec allowed to sprint while reloading', () => {
  const hermes = match('hermes').actors[0];
  const baseline = match('openclaw').actors[0];
  for (const actor of [hermes, baseline]) { quiet(actor); actor.reloading = true; }
  for (let i = 0; i < 30; i++) moveActor(hermes, {x: 1, sprint: true}, 1 / 60, closedArena);
  for (let i = 0; i < 30; i++) moveActor(baseline, {x: 1, sprint: true}, 1 / 60, closedArena);
  assert.equal(hermes.sprinting, true);
  assert.equal(baseline.sprinting, false, 'non-Hermes loses the sprint posture while reloading');
  assert.ok(hermes.vx > baseline.vx);

  baseline.reloading = false;
  baseline.vx = 0;
  for (let i = 0; i < 30; i++) moveActor(baseline, {x: 1, sprint: true}, 1 / 60, closedArena);
  assert.equal(baseline.sprinting, true, 'once the reload ends the sprint posture returns');
});

// ---------------------------------------------------------------------------
// OpenCode · Multiplex — reload continues while swapped
// ---------------------------------------------------------------------------

test('OpenCode Multiplex keeps a reload running across a weapon swap and finishes it', () => {
  const multiplex = match('opencode', {humanCount: 2});
  const cancels = match('openclaw', {humanCount: 2});
  for (const m of [multiplex, cancels]) {
    const a = m.actors[0];
    quiet(a);
    a.weapon = 1; // Rocket Launcher has a real reload (2.5 s)
    a.ammo[1] = 1;
    a.ammo[0] = Infinity;
    assert.equal(m.startReload(a, 1), true);
    assert.equal(a.reloading, true);
    assert.equal(m.switchWeapon(a, 0), true);
  }
  const kept = multiplex.actors[0];
  assert.equal(kept.reloading, true, 'Multiplex keeps the reload alive');
  assert.equal(kept.reloadWeapon, 1);
  assert.ok(kept.reloadTimer > 0);

  const dropped = cancels.actors[0];
  assert.equal(dropped.reloading, false, 'every other spec cancels the reload on swap');
  assert.equal(dropped.reloadWeapon, -1);

  for (let i = 0; i < 300 && kept.reloading; i++) multiplex.step(1 / 60);
  assert.equal(kept.reloading, false);
  assert.equal(kept.ammo[1], 7, 'the swapped-out magazine still refilled');
});

// ---------------------------------------------------------------------------
// Claude Code · Linted — threat ping
// ---------------------------------------------------------------------------

test('Claude Code Linted pings a threat on cooldown and ignores beads that are not held', () => {
  // Mistral (striker) has no threat-ping rider, so the base descriptor shows.
  const m = match('claudecode', {humanCount: 2}, 'mistral');
  const [a, b] = m.actors;
  quiet(a); quiet(b);
  a.health = b.health = 100;
  Object.assign(b, {x: 0, y: 0, z: -10});
  b.yaw = Math.PI; // aim(pi) = (0, 0, 1): the enemy holds a bead on the actor
  assert.equal(m.visible(m.actors[1] && {x: b.x, y: b.y + 1.45, z: b.z}, {x: a.x, y: a.y + 1.45, z: a.z}), true);

  m._stepThreatPing(a, 1 / 60);
  const pings = m.events.filter(event => event.type === 'threat-ping');
  assert.equal(pings.length, 1);
  assert.equal(pings[0].actor, a.id);
  assert.equal(pings[0].source, b.id);
  close(pings[0].duration, .75);

  const before = m.events.length;
  m._stepThreatPing(a, 1 / 60);
  assert.equal(m.events.length, before, 'the 3 s cooldown blocks a second ping');

  for (let i = 0; i < Math.ceil(3 / (1 / 60)) + 2; i++) m._stepThreatPing(a, 1 / 60);
  assert.ok(m.events.filter(event => event.type === 'threat-ping').length >= 2, 'the ping returns after the cooldown');

  // Negative: enemy facing away, out of range, or the wrong spec.
  b.yaw = 0;
  a.threatPing = 0;
  const away = m.events.length;
  m._stepThreatPing(a, 1 / 60);
  assert.equal(m.events.length, away, 'a bead that is not held never pings');

  Object.assign(b, {z: -40});
  b.yaw = Math.PI;
  a.threatPing = 0;
  const far = m.events.length;
  m._stepThreatPing(a, 1 / 60);
  assert.equal(m.events.length, far, '35 m range is enforced');

  const other = match('hermes', {humanCount: 2});
  const [plain, enemy] = other.actors;
  quiet(plain); quiet(enemy);
  Object.assign(enemy, {x: 0, y: 0, z: -10, yaw: Math.PI});
  other._stepThreatPing(plain, 1 / 60);
  assert.equal(other.events.filter(event => event.type === 'threat-ping').length, 0);
});

// ---------------------------------------------------------------------------
// Codex · Green Build — reload 15% faster
// ---------------------------------------------------------------------------

test('Codex Green Build shortens the reload timer by exactly 15%', () => {
  const green = match('codex', {humanCount: 2});
  const plain = match('hermes', {humanCount: 2});
  for (const m of [green, plain]) {
    const a = m.actors[0];
    quiet(a);
    a.weapon = 1;
    a.ammo[1] = 1;
    assert.equal(m.startReload(a, 1), true);
  }
  const fast = green.actors[0];
  const slow = plain.actors[0];
  close(fast.reloadDuration, WEAPONS[1].reload * .85, 1e-12);
  close(slow.reloadDuration, WEAPONS[1].reload, 1e-12);
  const event = green.events.at(-1);
  assert.equal(event.type, 'reload');
  close(event.duration, WEAPONS[1].reload * .85, 1e-12);
  assert.ok(fast.reloadDuration < slow.reloadDuration);

  // The timer actually runs down at the shortened rate: the wait is over inside
  // one base reload duration.
  const ticks = Math.ceil(WEAPONS[1].reload / (1 / 60)) + 1;
  for (let i = 0; i < ticks && fast.reloading; i++) green.step(1 / 60);
  assert.equal(fast.reloading, false);
});

// ---------------------------------------------------------------------------
// Cline · Off-road — extra air control + longer slide
// ---------------------------------------------------------------------------

test('Cline Off-road adds bounded air control and a longer slide', () => {
  const airActor = harness => Object.assign({
    character: 'mistral', harness, moveSpeed: 9.2, x: 0, y: 100, z: 0,
    vx: 0, vy: 0, vz: 0, grounded: false, yaw: 0, coyote: 0, jumpBuffer: 0,
    slideTimer: 0, slideCooldown: 0, slow: 0, active: 0,
  });
  const cline = airActor('cline');
  const neutral = airActor('openclaw');
  for (let i = 0; i < 10; i++) moveActor(cline, {x: 1}, 1 / 60, closedArena);
  for (let i = 0; i < 10; i++) moveActor(neutral, {x: 1}, 1 / 60, closedArena);
  assert.ok(cline.vx > neutral.vx, `air control stacks (${cline.vx} > ${neutral.vx})`);
  close(cline.vx, neutral.vx * 1.25, 1e-6);

  const slideActor = harness => Object.assign({
    character: 'mistral', harness, moveSpeed: 9.2, x: 0, y: 0, z: 0,
    vx: 9, vy: 0, vz: 0, grounded: true, yaw: 0, coyote: 0, jumpBuffer: 0,
    slideTimer: 0, slideCooldown: 0, crouching: false, sprinting: true, slow: 0, active: 0,
  });
  const slider = slideActor('cline');
  const plain = slideActor('openclaw');
  moveActor(slider, {x: 1, sprint: true, crouch: true}, 1 / 60, closedArena);
  moveActor(plain, {x: 1, sprint: true, crouch: true}, 1 / 60, closedArena);
  assert.equal(slider.sliding, true);
  assert.equal(plain.sliding, true);
  close(slider.slideTimer - plain.slideTimer, .2, 1e-9, 'Off-road adds 0.2 s to the slide');
  close(slider.slideTimer, MOVE.slideMin + .2 - 1 / 60, 1e-9, 'the entered slide keeps the bonus for its whole timer');
});

// ---------------------------------------------------------------------------
// Roo · Flood Fill — ability radius +25%, damage −5%
// ---------------------------------------------------------------------------

test('Roo Flood Fill reaches 25% further and pays with 5% less outgoing damage', () => {
  const slowMatch = harness => {
    const m = match(harness, {humanCount: 2});
    const [a, b] = m.actors;
    quiet(a); quiet(b);
    a.cooldown = 0;
    Object.assign(b, {x: 0, y: 0, z: -8, health: 100, armor: 0});
    assert.equal(m.power(a), true);
    return b.slow;
  };
  assert.ok(slowMatch('roo') > 0, 'Flood Fill radius 10 (plus the +1.5 rider) reaches the target at 8 m');
  assert.equal(slowMatch('openclaw'), 0, 'the base 6 m Claw Burst plus its +1.5 rider does not reach 8 m');

  const shot = harness => {
    const m = match(harness, {humanCount: 2});
    m.random = () => .5; // spread resolves on the aim line; the hit is deterministic
    const [a, b] = m.actors;
    quiet(a); quiet(b);
    a.weapon = 0;
    a.ammo[0] = Infinity;
    Object.assign(a, {z: 8, health: 100});
    Object.assign(b, {z: 0, health: 1000, maxHealth: 1000, armor: 0});
    assert.equal(m.fire(a), true);
    return 1000 - b.health;
  };
  const rooDamage = shot('roo');
  const handling = harnessWeaponHandling('roo', 0);
  close(rooDamage, WEAPONS[0].damage * (handling.favored ? handling.damage : 1) * .95, 1e-9);
  assert.ok(rooDamage < shot('openclaw'), 'the same shot on a spec without Flood Fill deals more');

  // Incoming damage is never scaled by the passive.
  const m = match('roo', {humanCount: 2});
  const [a, b] = m.actors;
  quiet(a); quiet(b);
  a.armor = 0;
  const before = a.health;
  m.damage(a, 20, b);
  assert.equal(before - a.health, 20);
});
