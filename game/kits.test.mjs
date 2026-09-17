import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTERS, HARNESSES, WEAPONS, resolveLoadout} from './data.mjs';
import {abilityOf, harnessAbility, harnessBotHints, harnessVehicle} from './harness-profiles.mjs';
import {resolveGear} from './progression.mjs';
import {KINDS, WINGS, OPERATOR_KITS, SPECS, MOVEMENT_VERBS, MOVEMENT_HOOK_BY_SPEC, SPEC_TRIGGERS, SPEC_EFFECT_TYPES, SPEC_EFFECT_TARGETS, resolveKit} from './kits.mjs';

const deepFrozen = value => !value || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value).every(deepFrozen));
const indexById = list => Object.fromEntries(list.map(entry => [entry.id, entry]));
const WEAPON_IDS = WEAPONS.map((_, index) => index);

// Historical operator-profiles.mjs values. The first two entries of every kit's
// three-weapon band must stay exactly these, in this order, so the shim remains
// byte-compatible for existing consumers.
const LEGACY_PREFERRED = {chatgpt: [0, 4], claude: [2, 6], grok: [1, 5], meta: [4, 6], gemini: [3, 2], deepseek: [5, 4], mistral: [3, 7], kimi: [6, 0], qwen: [0, 2]};
const LEGACY_ROLES = {chatgpt: 'adaptive', claude: 'anchor', grok: 'disruptor', meta: 'connector', gemini: 'duelist', deepseek: 'ambusher', mistral: 'flanker', kimi: 'orbiter', qwen: 'optimizer'};
const EXPECTED_MOVEMENT = {mistral: 'air-dash', gemini: 'double-jump', grok: 'super-jump', deepseek: 'hover-jets', meta: 'brace-slam', claude: 'safety-glide', chatgpt: 'grapple', kimi: 'blink-step', qwen: 'deployable-rope'};
const EXPECTED_KIND = {openclaw: 'burst', hermes: 'buff', opencode: 'buff', claudecode: 'buff', codex: 'heal', cline: 'dash', roo: 'slow'};
const EXPECTED_BUFF = {openclaw: null, hermes: 'speed', opencode: 'fireRate', claudecode: 'resistance', codex: null, cline: null, roo: null};
const EXPECTED_HOOK = {openclaw: 'landing-control', hermes: 'economy', opencode: 'usage', claudecode: 'landing-self', codex: 'landing-self', cline: 'chaining', roo: 'landing-control'};
const EXPECTED_LIFT = {'air-dash': false, 'double-jump': true, 'super-jump': true, 'hover-jets': true, 'brace-slam': true, 'safety-glide': false, grapple: true, 'blink-step': true, 'deployable-rope': true};
const EXPECTED_BUDGETS = {
  'air-dash': {charges: 1, distance: 5.5, cooldown: 3.5, windup: 0, landing: .15},
  'double-jump': {charges: 1, impulse: 7.4, cooldown: 0, windup: 0, landing: 0},
  'super-jump': {charges: 1, impulse: 12.5, windup: .55, cooldown: 6, landing: .25},
  'hover-jets': {fuel: 2.5, fuelRecharge: 1.8, climb: .35, descent: 2.2, windup: 0, landing: .2},
  'brace-slam': {windup: .15, radius: 4, knockback: 9, cooldown: 8, landing: null},
  'safety-glide': {fuel: null, descent: 2, steer: 4, windup: 0, landing: 0},
  grapple: {distance: 14, reel: 12, cooldown: 7, missCooldown: 3, windup: 0, landing: 0},
  'blink-step': {distance: 6, windup: .3, cooldown: 6, landing: 0},
  'deployable-rope': {charges: 1, anchorLife: 20, cooldown: 12, windup: 0, landing: 0},
};

test('three wings, nine kits, seven specs and nine movement verbs, all uniquely identified', () => {
  assert.deepEqual(KINDS, ['burst', 'buff', 'dash', 'heal', 'slow', 'deploy', 'recon', 'stance']);
  assert.equal(WINGS.length, 3);
  assert.equal(OPERATOR_KITS.length, 9);
  assert.equal(SPECS.length, 7);
  assert.equal(MOVEMENT_VERBS.length, 9);
  for (const list of [WINGS, OPERATOR_KITS, SPECS, MOVEMENT_VERBS]) {
    assert.equal(new Set(list.map(entry => entry.id)).size, list.length);
  }
  assert.deepEqual(SPECS.map(spec => spec.id), HARNESSES.map(harness => harness.id));
  assert.deepEqual(OPERATOR_KITS.map(kit => kit.id).sort(), CHARACTERS.map(character => character.id).sort());
});

test('wings group three operators each and publish a complete role summary', () => {
  assert.deepEqual(WINGS.map(wing => wing.id), ['striker', 'vanguard', 'tactician']);
  assert.deepEqual(WINGS.map(wing => wing.family), ['burst', 'deliberate', 'tool']);
  for (const wing of WINGS) {
    for (const field of ['id', 'name', 'label', 'color', 'domain', 'pays', 'fantasy']) {
      assert.ok(typeof wing[field] === 'string' && wing[field].length > 0, `${wing.id}.${field}`);
    }
    assert.equal(OPERATOR_KITS.filter(kit => kit.wing === wing.id).length, 3);
  }
  assert.deepEqual(OPERATOR_KITS.map(kit => kit.id), ['mistral', 'gemini', 'grok', 'deepseek', 'meta', 'claude', 'chatgpt', 'kimi', 'qwen']);
  OPERATOR_KITS.forEach((kit, index) => assert.equal(kit.wing, WINGS[Math.floor(index / 3)].id));
});

test('operator kits keep the legacy band prefix, a full affinity band and a movement verb each', () => {
  for (const kit of OPERATOR_KITS) {
    assert.equal(kit.role, LEGACY_ROLES[kit.id]);
    assert.deepEqual(kit.preferred.slice(0, 2), LEGACY_PREFERRED[kit.id]);
    assert.equal(kit.preferred.length, 3);
    assert.equal(new Set(kit.preferred).size, 3);
    assert.ok(kit.preferred.every(index => Number.isInteger(index) && WEAPON_IDS.includes(index)));
    assert.ok(kit.strafe >= .5 && kit.strafe <= 1.2);
    assert.equal(kit.movement, EXPECTED_MOVEMENT[kit.id]);
    assert.ok(indexById(MOVEMENT_VERBS)[kit.movement], `${kit.id} movement verb resolves`);
    assert.ok(kit.verb.id.length > 0 && kit.verb.name.length > 0 && kit.verb.description.length > 0);
    assert.ok(['rusher', 'flanker', 'defender', 'support', 'sharpshooter'].includes(kit.bot.archetype));
    assert.ok(['engage', 'escape', 'hold', 'route', 'reposition'].includes(kit.bot.mobility));
    assert.equal(Object.keys(kit.affinity).length, WEAPONS.length);
    let bonuses = 0;
    for (const index of WEAPON_IDS) {
      const expected = kit.preferred.includes(index) ? 1.08 : 1;
      assert.equal(kit.affinity[index], expected, `${kit.id} weapon ${index}`);
      if (expected > 1) bonuses++;
    }
    assert.equal(bonuses, 3);
  }
  assert.equal(new Set(OPERATOR_KITS.map(kit => kit.verb.id)).size, 9);
  assert.equal(new Set(OPERATOR_KITS.map(kit => kit.verb.name)).size, 9);
});

test('each movement verb carries family, input, budget and carrier rules', () => {
  assert.deepEqual(MOVEMENT_VERBS.map(verb => verb.id), ['air-dash', 'double-jump', 'super-jump', 'hover-jets', 'brace-slam', 'safety-glide', 'grapple', 'blink-step', 'deployable-rope']);
  const verbs = indexById(MOVEMENT_VERBS);
  for (const verb of MOVEMENT_VERBS) {
    assert.ok(['burst', 'deliberate', 'tool'].includes(verb.family));
    assert.ok(['jump', 'crouch', 'jump-hold', 'crouch-jump', 'mobility'].includes(verb.input));
    assert.equal(verb.carrier.drop, true);
    assert.equal(verb.carrier.lift, EXPECTED_LIFT[verb.id]);
    assert.deepEqual(verb.budget, EXPECTED_BUDGETS[verb.id]);
    assert.ok(CHARACTERS.some(character => character.id === verb.owner), `${verb.id} owner is a character`);
  }
  assert.deepEqual(MOVEMENT_VERBS.filter(verb => verb.input === 'mobility').map(verb => verb.id), ['grapple', 'blink-step', 'deployable-rope']);
  assert.deepEqual(MOVEMENT_VERBS.filter(verb => verb.carrier.weakened).map(verb => verb.id), ['deployable-rope']);
  for (const wing of WINGS) {
    const families = OPERATOR_KITS.filter(kit => kit.wing === wing.id).map(kit => verbs[kit.movement].family);
    assert.deepEqual(families, [wing.family, wing.family, wing.family]);
  }
  assert.deepEqual(MOVEMENT_HOOK_BY_SPEC, EXPECTED_HOOK);
  assert.deepEqual([...new Set(Object.values(MOVEMENT_HOOK_BY_SPEC))].sort(), ['chaining', 'economy', 'landing-control', 'landing-self', 'usage']);
});

test('specs map harness ids to kinds, tradeoffs, riders and movement hooks', () => {
  for (const spec of SPECS) {
    assert.equal(spec.kind, EXPECTED_KIND[spec.id]);
    assert.equal(spec.buff, EXPECTED_BUFF[spec.id]);
    assert.ok(KINDS.includes(spec.kind));
    assert.equal(spec.active, abilityOf(spec.id), 'active shares the harness descriptor');
    assert.equal(spec.active.kind, spec.kind);
    assert.equal(spec.movementHook, EXPECTED_HOOK[spec.id]);
    assert.equal(spec.vehicle, harnessVehicle(spec.id));
    assert.equal(spec.bot, harnessBotHints(spec.id));
    assert.ok(spec.tradeoff.id.length > 0 && spec.tradeoff.name.length > 0 && spec.tradeoff.description.length > 0);
    assert.equal(spec.passive.id, spec.tradeoff.id);
    assert.equal(spec.passive.name, spec.tradeoff.name);
    assert.equal(spec.passive.description, spec.tradeoff.description, 'passive reuses the tradeoff copy');
    assert.ok(SPEC_TRIGGERS.includes(spec.passive.trigger), `${spec.id} passive trigger`);
    assert.ok(Array.isArray(spec.passive.effects) && spec.passive.effects.length > 0);
    for (const effect of spec.passive.effects) {
      assert.ok(SPEC_EFFECT_TYPES.includes(effect.type), `${spec.id} passive effect ${effect.type}`);
      assert.ok(SPEC_EFFECT_TARGETS.includes(effect.target), `${spec.id} passive target ${effect.target}`);
    }
    assert.deepEqual(Object.keys(spec.riders).sort(), ['striker', 'tactician', 'vanguard']);
    for (const [wing, rider] of Object.entries(spec.riders)) {
      assert.equal(rider.wing, wing);
      assert.ok(typeof rider.id === 'string' && rider.id.length > 0);
      assert.ok(typeof rider.description === 'string' && rider.description.length > 0);
      assert.ok(SPEC_TRIGGERS.includes(rider.trigger), `${spec.id}/${wing} trigger`);
      assert.ok(Array.isArray(rider.effects) && rider.effects.length > 0);
      for (const effect of rider.effects) {
        assert.ok(SPEC_EFFECT_TYPES.includes(effect.type), `${spec.id}/${wing} effect ${effect.type}`);
        assert.ok(SPEC_EFFECT_TARGETS.includes(effect.target), `${spec.id}/${wing} target ${effect.target}`);
      }
    }
  }
  assert.equal(new Set(SPECS.map(spec => spec.tradeoff.id)).size, 7);
  assert.equal(new Set(SPECS.map(spec => spec.tradeoff.name)).size, 7);
  assert.equal(SPECS.reduce((count, spec) => count + Object.keys(spec.riders).length, 0), 21);
});

test('every exported table is deeply frozen', () => {
  for (const table of [KINDS, WINGS, OPERATOR_KITS, SPECS, MOVEMENT_VERBS, MOVEMENT_HOOK_BY_SPEC, SPEC_TRIGGERS, SPEC_EFFECT_TYPES, SPEC_EFFECT_TARGETS]) {
    assert.ok(deepFrozen(table));
  }
  assert.throws(() => { OPERATOR_KITS[0].preferred[0] = 9; }, TypeError);
  assert.throws(() => { OPERATOR_KITS[0].affinity[0] = 2; }, TypeError);
  assert.throws(() => { OPERATOR_KITS[0].bot.archetype = 'rusher'; }, TypeError);
  assert.throws(() => { WINGS[0].family = 'tool'; }, TypeError);
  assert.throws(() => { SPECS[0].riders.striker = ''; }, TypeError);
  assert.throws(() => { SPECS[0].riders.striker.description = ''; }, TypeError);
  assert.throws(() => { SPECS[0].riders.striker.effects[0].type = 'pull'; }, TypeError);
  assert.throws(() => { SPECS[0].riders.striker.effects.push({}); }, TypeError);
  assert.throws(() => { SPECS[0].passive.effects[0] = {}; }, TypeError);
  assert.throws(() => { SPECS[0].tradeoff.id = 'other'; }, TypeError);
  assert.throws(() => { MOVEMENT_VERBS[0].budget.distance = 99; }, TypeError);
  assert.throws(() => { MOVEMENT_VERBS[0].carrier.drop = false; }, TypeError);
  assert.throws(() => { MOVEMENT_HOOK_BY_SPEC.hermes = 'usage'; }, TypeError);
  assert.ok(deepFrozen(SPECS[0].riders.striker));
  assert.ok(deepFrozen(SPECS[0].passive));
});

test('resolveKit normalises loadouts exactly like resolveLoadout', () => {
  assert.equal(resolveKit('nobody', 'nothing').character, 'chatgpt');
  assert.equal(resolveKit('nobody', 'nothing').harness, 'openclaw');
  assert.equal(resolveKit('mistral', 'nothing').harness, 'openclaw');
  assert.equal(resolveKit(undefined, undefined).character, 'chatgpt');
  assert.equal(resolveKit('claude', 'hermes').harness, 'claudecode', 'the Claude lock survives resolution');
  assert.equal(resolveKit('claude', 'openclaw').harness, 'claudecode');
  assert.equal(resolveKit('claude', 'hermes').kind, 'buff');
  for (const character of ['mistral', 'claude', 'nobody', undefined]) {
    for (const harness of ['cline', 'opencode', 'nothing', undefined]) {
      const expected = resolveLoadout(character, harness);
      const resolved = resolveKit(character, harness);
      assert.equal(resolved.character, expected.character);
      assert.equal(resolved.harness, expected.harness);
    }
  }
});

test('resolveKit joins class, spec, stats and gear deterministically', () => {
  const specs = indexById(SPECS);
  const kits = indexById(OPERATOR_KITS);
  const resolved = resolveKit('mistral', 'cline');
  assert.equal(resolved.gear, null);
  assert.equal(resolveKit('mistral', 'cline', null).gear, null);
  assert.equal(resolveKit('mistral', 'cline', undefined).gear, null);
  assert.equal(resolved.wing, 'striker');
  assert.equal(resolved.kind, 'dash');
  assert.equal(resolved.active, abilityOf('cline'));
  assert.equal(resolved.tradeoff, specs.cline.tradeoff);
  assert.equal(resolved.passive, specs.cline.passive);
  assert.equal(resolved.rider, specs.cline.riders.striker);
  assert.equal(resolved.movement, indexById(MOVEMENT_VERBS)['air-dash']);
  assert.equal(resolved.movementHook, 'chaining');
  assert.equal(resolved.affinity, kits.mistral.affinity);
  assert.deepEqual(resolved.stats, CHARACTERS.find(character => character.id === 'mistral').stats);
  assert.ok(Object.isFrozen(resolved));
  assert.ok(Object.isFrozen(resolved.stats));
  assert.ok(deepFrozen(resolveKit('mistral', 'cline')), 'resolved kit is deeply frozen');
  assert.equal(resolved.fingerprint, resolveKit('mistral', 'cline').fingerprint);
  assert.notEqual(resolved.fingerprint, resolveKit('gemini', 'cline').fingerprint);
  assert.notEqual(resolved.fingerprint, resolveKit('mistral', 'codex').fingerprint);
  assert.notEqual(resolved.fingerprint, resolveKit('claude', 'claudecode').fingerprint);
  assert.ok(/^[a-z0-9-]+:[a-z]+:[a-z-]+:[a-z-]+:[a-z]+$/.test(resolved.fingerprint), resolved.fingerprint);
});

test('resolveKit resolves, snapshots and fingerprints gear without touching the live table', () => {
  const gearMap = {primary: 'scope', utility: 'servo'};
  const resolved = resolveKit('mistral', 'cline', gearMap);
  assert.deepEqual(resolved.gear.items.map(item => item.id), ['scope', 'servo']);
  // Derived from the resolver so gear re-tuning (P3-C caps, axis budgets) does
  // not silently stale this pin: resolveKit's snapshot must equal the live result.
  const expected = resolveGear(gearMap).modifiers;
  assert.equal(resolved.gear.modifiers.spread, expected.spread);
  assert.equal(resolved.gear.modifiers.speed, expected.speed);
  assert.ok(deepFrozen(resolved), 'geared kit is deeply frozen');
  assert.ok(deepFrozen(resolved.gear), 'resolved gear is deeply frozen');
  assert.ok(!Object.isFrozen(gearMap), 'caller gear map is untouched');
  assert.equal(resolveKit('mistral', 'cline').gear, null);

  // A snapshot copy, never a reference into the shared GEAR table.
  const live = resolveGear(gearMap);
  assert.notEqual(resolved.gear, live);
  assert.notEqual(resolved.gear.items[0], live.items[0]);
  assert.equal(Object.isFrozen(live.items[0]), false, 'the live GEAR entry stays mutable for progression.mjs');

  // Fingerprint identity: same gear regardless of key order, different gear
  // changes the tail, no gear keeps the five-segment form.
  const reordered = resolveKit('mistral', 'cline', {utility: 'servo', primary: 'scope'});
  assert.equal(resolved.fingerprint, reordered.fingerprint);
  assert.notEqual(resolved.fingerprint, resolveKit('mistral', 'cline').fingerprint);
  assert.notEqual(resolved.fingerprint, resolveKit('mistral', 'cline', {primary: 'scope'}).fingerprint);
  assert.ok(resolved.fingerprint.endsWith(':gear-scope+servo'), resolved.fingerprint);

  // An already-resolved record (core stores `actor.gear` in that shape) is
  // accepted and resolves to the same identity.
  const already = resolveGear(gearMap);
  const reResolved = resolveKit('mistral', 'cline', already);
  assert.equal(reResolved.fingerprint, resolved.fingerprint);
  assert.equal(reResolved.gear.modifiers.spread, resolved.gear.modifiers.spread);
  assert.ok(deepFrozen(reResolved));

  // Supplied gear that names no known item still gets a stable segment.
  const none = resolveKit('mistral', 'cline', {primary: 'not-an-item'});
  assert.deepEqual(none.gear.items, []);
  assert.ok(none.fingerprint.endsWith(':gear-none'), none.fingerprint);
  assert.notEqual(none.fingerprint, resolveKit('mistral', 'cline').fingerprint);
});

test('abilityOf memoizes one frozen descriptor per harness', () => {
  for (const harness of HARNESSES) {
    const ability = abilityOf(harness.id);
    assert.equal(ability, abilityOf(harness.id));
    assert.equal(ability, abilityOf({id: harness.id}));
    assert.equal(ability, harnessAbility(harness.id));
    assert.ok(Object.isFrozen(ability));
  }
  assert.equal(abilityOf('not-a-harness'), null);
  assert.equal(abilityOf(null), null);
  assert.equal(abilityOf(undefined), null);
  assert.equal(abilityOf({}), null);
});

test('all 63 operator x spec combinations resolve through the lock and fallbacks', () => {
  for (const kit of OPERATOR_KITS) {
    for (const spec of SPECS) {
      const expected = resolveLoadout(kit.id, spec.id);
      const resolved = resolveKit(kit.id, spec.id);
      assert.equal(resolved.character, expected.character);
      assert.equal(resolved.harness, expected.harness);
      assert.equal(resolved.wing, kit.wing);
      assert.equal(resolved.kind, EXPECTED_KIND[expected.harness]);
      assert.equal(resolved.rider, indexById(SPECS)[expected.harness].riders[kit.wing]);
      assert.equal(resolved.rider.wing, kit.wing);
      assert.equal(resolved.passive, indexById(SPECS)[expected.harness].passive);
      assert.equal(resolved.movement.id, kit.movement);
      assert.equal(resolved.movementHook, EXPECTED_HOOK[expected.harness]);
      assert.ok(Object.isFrozen(resolved));
    }
  }
});
