// Phase 3A added the 21 wing riders and the 7 behavioural spec passives
// (docs/design/CLASS_OVERHAUL.md §3.3, §3.6, §7.2, §12.2 Phase 3).
// Phase 3B wires them: `spec-effects.mjs` resolves descriptors and `Match`
// dispatches on the shared trigger / effect vocabulary only. These tests pin
// the shape *and* the applied behaviour — one positive case per rider, plus a
// source scan that no spec or operator id leaks into effect logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CHARACTERS, HARNESSES, WEAPONS, resolveLoadout} from './data.mjs';
import {Match, moveActor} from './core.mjs';
import {
  OPERATOR_KITS,
  SPECS,
  SPEC_EFFECT_TARGETS,
  SPEC_EFFECT_TYPES,
  SPEC_TRIGGERS,
  WINGS,
  resolveKit,
} from './kits.mjs';
import {riderAmount, riderBonus, riderEffect, riderOf, riderScale} from './spec-effects.mjs';

const WING_IDS = WINGS.map(wing => wing.id);
const SPEC_IDS = HARNESSES.map(harness => harness.id);
const CHARACTER_IDS = CHARACTERS.map(character => character.id);

const deepFrozen = value => !value || typeof value !== 'object'
  || (Object.isFrozen(value) && Object.values(value).every(deepFrozen));

// Raw stat axes are only legal as a labelled effect `type`, never as a key:
// `{type:'speed', bonus}` is fine, `{speedMultiplier}` or `{damagePct}` is not.
const FORBIDDEN_AXIS_KEY = /^(?:speed|damage|resist)/i;
const PERCENT_KEY = /(?:multiplier|percent|pct|ratio)$/i;
// A numeric shaper must sit on an object that names its axis in `type`.
const SHAPER_PARAMS = ['scale', 'amount', 'bonus'];

function walkDescriptors(node, visit, path = '') {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walkDescriptors(entry, visit, `${path}[${index}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  visit(node, path);
  for (const [key, value] of Object.entries(node)) walkDescriptors(value, visit, `${path}.${key}`);
}

// §3.3's passive column, pinned exactly: id/name come from the tradeoff display
// record, trigger/effects are the structured descriptor. Only Roo's design-
// pinned "damage −5%" tradeoff is allowed to name a stat axis.
const EXPECTED_PASSIVES = {
  openclaw: {
    id: 'grip', name: 'Grip', trigger: 'melee',
    effects: [{type: 'melee-arc', target: 'self', scale: 1.25}],
  },
  hermes: {
    id: 'express', name: 'Express', trigger: 'reload',
    effects: [{type: 'sprint', target: 'self', during: 'reload'}],
  },
  opencode: {
    id: 'multiplex', name: 'Multiplex', trigger: 'swap',
    effects: [{type: 'reload', target: 'self', during: 'swap', mode: 'continue'}],
  },
  claudecode: {
    id: 'linted', name: 'Linted', trigger: 'threat',
    effects: [{type: 'threat-ping', target: 'self', range: 35, duration: .75, cooldown: 3}],
  },
  codex: {
    id: 'green-build', name: 'Green Build', trigger: 'reload',
    effects: [{type: 'reload', target: 'self', scale: .85}],
  },
  cline: {
    id: 'off-road', name: 'Off-road', trigger: 'air',
    effects: [
      {type: 'air-control', target: 'self', scale: 1.25},
      {type: 'slide', target: 'self', bonus: .2},
    ],
  },
  roo: {
    id: 'flood-fill', name: 'Flood Fill', trigger: 'always',
    effects: [
      {type: 'radius', target: 'ability', scale: 1.25},
      {type: 'damage', target: 'self', scale: .95},
    ],
  },
};

test('the shared vocabularies expose the §3.6 events plus the passive states', () => {
  for (const table of [SPEC_TRIGGERS, SPEC_EFFECT_TYPES, SPEC_EFFECT_TARGETS]) {
    assert.ok(deepFrozen(table));
    assert.equal(new Set(table).size, table.length, 'vocabulary entries are unique');
    assert.ok(table.every(entry => typeof entry === 'string' && entry.length > 0));
  }
  for (const event of ['activate', 'air', 'land', 'end']) {
    assert.ok(SPEC_TRIGGERS.includes(event), `§3.6 event ${event} stays in the vocabulary`);
  }
  for (const type of ['pull', 'radius', 'speed', 'mitigation', 'reload', 'damage']) {
    assert.ok(SPEC_EFFECT_TYPES.includes(type), `effect type ${type} is in the vocabulary`);
  }
});

test('all 21 wing riders carry an id, a human sentence, a shared trigger and labelled effects', () => {
  const ids = new Set();
  let count = 0;
  for (const spec of SPECS) {
    assert.deepEqual(Object.keys(spec.riders).sort(), [...WING_IDS].sort(), spec.id);
    for (const wing of WING_IDS) {
      const rider = spec.riders[wing];
      count++;
      assert.ok(!ids.has(rider.id), `rider id ${rider.id} is unique`);
      ids.add(rider.id);
      assert.equal(rider.wing, wing);
      assert.ok(typeof rider.description === 'string' && rider.description.length > 0, `${spec.id}/${wing} description`);
      assert.ok(SPEC_TRIGGERS.includes(rider.trigger), `${spec.id}/${wing} trigger ${rider.trigger}`);
      assert.ok(Array.isArray(rider.effects) && rider.effects.length > 0, `${spec.id}/${wing} effects`);
      for (const effect of rider.effects) {
        assert.ok(SPEC_EFFECT_TYPES.includes(effect.type), `${rider.id} effect type ${effect.type}`);
        assert.ok(SPEC_EFFECT_TARGETS.includes(effect.target), `${rider.id} effect target ${effect.target}`);
      }
    }
  }
  assert.equal(count, 21);
  assert.equal(ids.size, 21);
});

test('the Cline worked row matches §3.3: distance, unstoppable, radar feint', () => {
  const cline = SPECS.find(spec => spec.id === 'cline');
  assert.equal(cline.riders.striker.id, 'step-distance');
  assert.equal(cline.riders.vanguard.id, 'step-unstoppable');
  assert.equal(cline.riders.tactician.id, 'step-feint');
  assert.ok(cline.riders.striker.description.includes('Longest distance'));
  assert.ok(cline.riders.vanguard.description.includes('Unstoppable'));
  assert.ok(cline.riders.tactician.description.includes('radar feint'));
  assert.ok(cline.riders.striker.effects.some(effect => effect.type === 'distance' && effect.scale > 1));
  assert.ok(cline.riders.striker.effects.some(effect => effect.type === 'holster' && effect.mode === 'ready'));
  assert.ok(cline.riders.vanguard.effects.some(effect => effect.type === 'unstoppable'));
  assert.ok(cline.riders.vanguard.effects.some(effect => effect.type === 'distance' && effect.scale < 1));
  assert.ok(cline.riders.tactician.effects.some(effect => effect.type === 'feint' && effect.mode === 'radar'));
});

test('all 63 character x harness combinations resolve the wing rider and the passive', () => {
  for (const kit of OPERATOR_KITS) {
    for (const spec of SPECS) {
      const expected = resolveLoadout(kit.id, spec.id);
      const resolvedSpec = SPECS.find(entry => entry.id === expected.harness);
      const resolved = resolveKit(kit.id, spec.id);
      assert.equal(resolved.rider, resolvedSpec.riders[kit.wing], `${kit.id}/${spec.id}`);
      assert.equal(resolved.rider.wing, kit.wing);
      assert.equal(resolved.passive, resolvedSpec.passive);
      assert.ok(Object.isFrozen(resolved.rider));
    }
  }
});

test('every rider and passive descriptor is deeply frozen', () => {
  for (const spec of SPECS) {
    assert.ok(deepFrozen(spec.passive), `${spec.id} passive`);
    assert.throws(() => { spec.passive.effects[0].type = 'pull'; }, TypeError);
    assert.throws(() => { spec.passive.effects.push({}); }, TypeError);
    for (const wing of WING_IDS) {
      const rider = spec.riders[wing];
      assert.ok(deepFrozen(rider), `${spec.id}/${wing}`);
      assert.throws(() => { rider.trigger = 'always'; }, TypeError);
      assert.throws(() => { rider.effects.push({}); }, TypeError);
      if (rider.effects[0]) assert.throws(() => { rider.effects[0].target = 'allies'; }, TypeError);
    }
  }
  assert.ok(deepFrozen(resolveKit('qwen', 'roo').rider));
  assert.ok(deepFrozen(resolveKit('qwen', 'roo').passive));
});

test('no descriptor smuggles an unlabelled speed, damage or resistance percentage', () => {
  const check = (root, label) => {
    walkDescriptors(root, (node, path) => {
      for (const key of Object.keys(node)) {
        assert.ok(!FORBIDDEN_AXIS_KEY.test(key), `${label}${path}.${key} is a raw stat key`);
        assert.ok(!PERCENT_KEY.test(key), `${label}${path}.${key} is an unlabelled percentage`);
      }
      const shaper = SHAPER_PARAMS.find(param => Object.hasOwn(node, param));
      if (shaper !== undefined) {
        assert.ok(typeof node.type === 'string' && SPEC_EFFECT_TYPES.includes(node.type),
          `${label}${path} carries ${shaper} without a labelled effect type`);
      }
    });
  };
  for (const spec of SPECS) {
    check(spec.passive, `${spec.id}.passive`);
    for (const wing of WING_IDS) check(spec.riders[wing], `${spec.id}.${wing}`);
  }
});

test('the 7 behavioural passives match §3.3 and hide no stat multiplier', () => {
  assert.deepEqual(SPECS.map(spec => spec.id), SPEC_IDS);
  for (const spec of SPECS) {
    const expected = EXPECTED_PASSIVES[spec.id];
    assert.ok(expected, spec.id);
    assert.equal(spec.passive.id, expected.id);
    assert.equal(spec.passive.name, expected.name);
    assert.equal(spec.passive.trigger, expected.trigger);
    assert.deepEqual(spec.passive.effects, expected.effects);
    assert.equal(spec.passive.description, spec.tradeoff.description, 'passive and tradeoff share one copy');
    assert.ok(spec.passive.description.length > 0);
  }
  assert.deepEqual(SPECS.map(spec => spec.passive.name),
    ['Grip', 'Express', 'Multiplex', 'Linted', 'Green Build', 'Off-road', 'Flood Fill']);

  const axes = SPECS.flatMap(spec => spec.passive.effects.map(effect => effect.type));
  assert.deepEqual([...new Set(axes)].sort(),
    ['air-control', 'damage', 'melee-arc', 'radius', 'reload', 'slide', 'sprint', 'threat-ping']);
  assert.ok(!axes.includes('speed'), 'no passive hides a speed multiplier');
  assert.ok(!axes.includes('resistance'), 'no passive hides a resistance multiplier');
  assert.equal(axes.filter(type => type === 'damage').length, 1, "only Roo's design-pinned damage tradeoff");
  const damage = SPECS.find(spec => spec.id === 'roo').passive.effects.find(effect => effect.type === 'damage');
  assert.deepEqual(damage, {type: 'damage', target: 'self', scale: .95});
});

test('no descriptor embeds a spec or operator id in its effect logic', () => {
  const ids = [...SPEC_IDS, ...CHARACTER_IDS];
  for (const spec of SPECS) {
    const visit = (label, descriptor) => {
      const logic = JSON.stringify({trigger: descriptor.trigger, effects: descriptor.effects});
      for (const id of ids) {
        assert.ok(!logic.includes(`"${id}"`), `${label} embeds ${id}`);
      }
    };
    visit(`${spec.id}.passive`, spec.passive);
    for (const wing of WING_IDS) visit(`${spec.id}.${wing}`, spec.riders[wing]);
  }
});

// ---------------------------------------------------------------------------
// Phase 3B: dispatch vocabulary and applied behaviour
// ---------------------------------------------------------------------------

test('effect dispatch reads only the shared vocabulary: no spec or operator id in the code path', () => {
  const source = readFileSync(new URL('./spec-effects.mjs', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const id of [...SPEC_IDS, ...CHARACTER_IDS]) {
    assert.ok(!source.includes(`'${id}'`) && !source.includes(`"${id}"`), `spec-effects.mjs mentions ${id}`);
  }
  const core = readFileSync(new URL('./core.mjs', import.meta.url), 'utf8');
  assert.ok(!/\.(?:harness|character)\s*===\s*['"]/.test(core), 'core.mjs never compares a harness or operator id in effect logic');
});

test('all 21 riders resolve and dispatch on their own trigger plus effect type', () => {
  for (const kit of OPERATOR_KITS) {
    for (const spec of SPECS) {
      const expected = resolveLoadout(kit.id, spec.id);
      const resolvedSpec = SPECS.find(entry => entry.id === expected.harness);
      const rider = riderOf(kit.id, spec.id);
      assert.equal(rider, resolvedSpec.riders[kit.wing], `${kit.id}/${spec.id}`);
      for (const effect of rider.effects) {
        assert.equal(riderEffect(kit.id, spec.id, effect.type, {trigger: rider.trigger}), effect);
      }
    }
  }
  assert.equal(riderOf(undefined, 'openclaw'), null);
  assert.equal(riderOf('mistral', null), null);
  assert.equal(riderOf('nobody', 'nothing'), null, 'unknown ids resolve to a neutral rider');
});

// --- applied riders ---------------------------------------------------------

const rng = (seed = 7) => { let n = seed >>> 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
const closed = {blocks: [], bounds: {minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000}};
const bout = (character, harness, options = {}) => {
  const m = new Match(character, harness, rng(), 'exchange', {mode: 'deathmatch', botCount: 0, humanCount: 2, ...options});
  m.arena = closed;
  m.pickups = [];
  m.vehicles = [];
  return m;
};
const quiet = actor => Object.assign(actor, {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, grounded: true,
  coyote: 0, jumpBuffer: 0, slideTimer: 0, slideCooldown: 0, slow: 0, active: 0,
  melee: 0, shotWait: 0, weaponSwitch: 0, reloading: false, spread: 0,
  punchYaw: 0, punchPitch: 0, protection: 0, cooldown: 0, armor: 0, health: 100,
});
const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);

test('OpenClaw riders: pull-in, bigger knockback and a wider radius', () => {
  const pull = bout('mistral', 'openclaw');
  const [puller, pulled] = pull.actors;
  quiet(puller); quiet(pulled);
  Object.assign(pulled, {x: 3, health: 1000, maxHealth: 1000});
  assert.equal(pull.power(puller), true);
  assert.ok(pulled.vx < 0, `the claw pulse drags the target in (vx ${pulled.vx})`);
  assert.equal(pulled.vy, 0, 'a pull never lifts');

  const shove = bout('deepseek', 'openclaw');
  const [shover, shoved] = shove.actors;
  quiet(shover); quiet(shoved);
  Object.assign(shoved, {x: 3, health: 1000, maxHealth: 1000});
  assert.equal(shove.power(shover), true);
  near(shoved.vx, 12 + 4, 1e-9);

  const wide = bout('chatgpt', 'openclaw');
  const [caster, caught] = wide.actors;
  quiet(caster); quiet(caught);
  Object.assign(caught, {x: 5.5, health: 1000, maxHealth: 1000});
  assert.equal(wide.power(caster), true);
  assert.ok(caught.health < 1000, 'radius 5 + 1.5 reaches 5.5 m');
});

test('Hermes riders: longer rush, 25% mitigation while active, cooldown −1 s', () => {
  const long = bout('mistral', 'hermes');
  const [rusher] = long.actors;
  quiet(rusher);
  assert.equal(long.power(rusher), true);
  near(rusher.active, 4, 1e-9, 'striker rush +1 s');

  const tough = bout('deepseek', 'hermes');
  const [tank, shooter] = tough.actors;
  quiet(tank); quiet(shooter);
  assert.equal(tough.power(tank), true);
  tough.damage(tank, 40, shooter);
  near(100 - tank.health, 30, 1e-9, '25% mitigation during the rush');

  const fast = bout('chatgpt', 'hermes');
  const [runner] = fast.actors;
  quiet(runner);
  assert.equal(fast.power(runner), true);
  near(runner.cooldown, 11, 1e-9, 'tactician cooldown −1 s');
});

test('OpenCode riders: faster while active, longer burst, one skipped holster', () => {
  assert.equal(riderBonus('mistral', 'opencode', 'speed', 0, {trigger: 'active'}), .75);
  const walk = active => ({
    character: 'mistral', harness: active ? 'opencode' : 'openclaw', moveSpeed: 9.2,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, coyote: 0,
    jumpBuffer: 0, slideTimer: 0, slideCooldown: 0, slow: 0, active: active ? 2 : 0,
    riderSpeedBonus: 0, riderSpeedTimer: 0,
  });
  const fast = walk(true), plain = walk(false);
  for (let i = 0; i < 90; i++) {
    moveActor(fast, {x: 1}, 1 / 60, closed);
    moveActor(plain, {x: 1}, 1 / 60, closed);
  }
  near(fast.vx - plain.vx, .75, 1e-6, 'the striker is +0.75 m/s while the burst is active');

  const long = bout('deepseek', 'opencode');
  const [burst] = long.actors;
  quiet(burst);
  assert.equal(long.power(burst), true);
  near(burst.active, 4, 1e-9, 'vanguard burst +1 s');

  const skip = bout('chatgpt', 'opencode');
  const [swapper] = skip.actors;
  quiet(swapper);
  swapper.weapon = 0;
  swapper.ammo[0] = Infinity;
  swapper.ammo[1] = 5;
  assert.equal(skip.power(swapper), true);
  assert.equal(skip.switchWeapon(swapper, 1), true);
  assert.equal(swapper.weaponSwitch, 0, 'the banked holster is skipped');
  assert.equal(swapper.holsterSkip, 0, 'the charge is consumed');
});

test('Claude Code riders: cleanse, max-not-sum mitigation, longer threat ping', () => {
  const clean = bout('mistral', 'claudecode');
  const [cleansed] = clean.actors;
  quiet(cleansed);
  cleansed.slow = 2;
  cleansed.slowMultiplier = .55;
  assert.equal(clean.power(cleansed), true);
  assert.equal(cleansed.slow, 0, 'the striker rider cleanses slow on activation');

  assert.equal(riderAmount('claude', 'claudecode', 'mitigation', 0, {trigger: 'active'}), .1);
  const guard = bout('deepseek', 'claudecode');
  const [tank, shooter] = guard.actors;
  quiet(tank); quiet(shooter);
  assert.equal(guard.power(tank), true);
  guard.damage(tank, 100, shooter);
  near(100 - tank.health, 50, 1e-9, 'Guardrail and the +10% rider take the max, never the sum');

  const ping = bout('kimi', 'claudecode');
  const [watcher, enemy] = ping.actors;
  quiet(watcher); quiet(enemy);
  Object.assign(enemy, {x: 0, z: -10, yaw: Math.PI});
  ping._stepThreatPing(watcher, 1 / 60);
  const event = ping.events.find(entry => entry.type === 'threat-ping');
  assert.ok(event);
  near(event.duration, 1.75, 1e-9, 'tactician ping lasts 1 s longer');
});

test('Codex riders: timed speed, capped overheal and a magazine refill', () => {
  const speedy = bout('mistral', 'codex');
  const [fast] = speedy.actors;
  quiet(fast);
  assert.equal(speedy.power(fast), true);
  near(fast.riderSpeedBonus, .6, 1e-9);
  near(fast.riderSpeedTimer, 1, 1e-9);

  const over = bout('deepseek', 'codex');
  const [tank] = over.actors;
  quiet(tank);
  tank.health = tank.maxHealth;
  assert.equal(over.power(tank), true);
  near(tank.temporaryShield, tank.maxHealth * .15, 1e-9, 'overheal is capped at +15%');
  assert.equal(over.power(tank), false, 'cooldown guard still holds');

  const heal = bout('deepseek', 'codex');
  const [hurt] = heal.actors;
  quiet(hurt);
  hurt.health = 10;
  assert.equal(heal.power(hurt), true);
  near(hurt.health, 45, 1e-9);
  assert.equal(hurt.temporaryShield, 0, 'a normal heal never overheals');

  const ammo = bout('chatgpt', 'codex');
  const [reloader] = ammo.actors;
  quiet(reloader);
  reloader.weapon = 1;
  reloader.ammo[1] = 0;
  assert.equal(ammo.power(reloader), true);
  assert.equal(reloader.ammo[1], WEAPONS[1].cap, 'the equipped magazine refills');
});

test('Cline riders: longer dash, unstoppable shorter dash, radar feint', () => {
  const far = bout('mistral', 'cline');
  const [longStep] = far.actors;
  quiet(longStep);
  assert.equal(far.power(longStep), true);
  assert.ok(Math.abs(longStep.z) > 7.3 && Math.abs(longStep.z) <= 7.5, `striker dash ~7.5 m (${longStep.z})`);

  const shortRun = bout('deepseek', 'cline');
  const [shortStep] = shortRun.actors;
  quiet(shortStep);
  assert.equal(shortRun.power(shortStep), true);
  assert.ok(Math.abs(shortStep.z) > 4.5 && Math.abs(shortStep.z) <= 4.8, `vanguard dash ~4.8 m (${shortStep.z})`);
  assert.equal(shortRun._knockbackScale(shortStep), 0, 'unstoppable during the dash');
  shortStep.active = 0;
  assert.equal(shortRun._knockbackScale(shortStep), 1);

  const push = bout('deepseek', 'cline');
  const [dashed, pusher] = push.actors;
  quiet(dashed); quiet(pusher);
  Object.assign(pusher, {z: -4});
  dashed.active = 1;
  push.movementAreaPush(pusher, 10, 10, 0);
  assert.equal(dashed.vz, 0, 'area knockback ignores the unstoppable dash');
  dashed.active = 0;
  push.movementAreaPush(pusher, 10, 10, 0);
  near(dashed.vz, 10, 1e-9);

  const feint = bout('chatgpt', 'cline');
  const [blinker] = feint.actors;
  quiet(blinker);
  assert.equal(feint.power(blinker), true);
  const event = feint.events.find(entry => entry.type === 'feint');
  assert.ok(event, 'the tactician dash leaves a radar feint');
  assert.deepEqual(event.pos, {x: 0, y: 1.45, z: 0});
  near(event.duration, 1.5, 1e-9);
});

test('Roo riders: jam dropped behind, stronger slow, wider radius', () => {
  const behind = bout('mistral', 'roo', {humanCount: 3});
  const [dropper, front, back] = behind.actors;
  quiet(dropper); quiet(front); quiet(back);
  Object.assign(front, {z: -8});
  Object.assign(back, {z: 8});
  assert.equal(behind.power(dropper), true);
  assert.equal(front.slow, 0, 'the field moves behind the striker: 8 m ahead is out of reach');
  assert.ok(back.slow > 0, 'the enemy chasing from behind is caught');

  const wide = bout('chatgpt', 'roo');
  const [caster, caught] = wide.actors;
  quiet(caster); quiet(caught);
  Object.assign(caught, {z: -9.5});
  assert.equal(wide.power(caster), true);
  assert.ok(caught.slow > 0, 'radius 8.75 + 1.5 reaches 9.5 m');

  const strong = bout('deepseek', 'roo');
  const [jammer, slowed] = strong.actors;
  quiet(jammer); quiet(slowed);
  Object.assign(slowed, {z: -4});
  assert.equal(strong.power(jammer), true);
  near(slowed.slowMultiplier, 1 - (1 - .55) * 1.2, 1e-9, 'the vanguard slow is 20% stronger');
  assert.ok(slowed.slowMultiplier >= .35, '§4.7 slow floor holds');
});
