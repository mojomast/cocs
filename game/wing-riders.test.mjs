// Phase 3A: the 21 wing riders and the 7 behavioural spec passives
// (docs/design/CLASS_OVERHAUL.md §3.3, §3.6, §7.2, §12.2 Phase 3).
//
// Riders and passives are still inert data: nothing in core.mjs/movement.mjs
// consumes them yet. These tests pin the shape the Phase-3 dispatch work will
// consume — one shared trigger vocabulary, labelled effect axes, no spec or
// operator id inside effect logic, and no unlabelled stat percentage anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTERS, HARNESSES, resolveLoadout} from './data.mjs';
import {
  OPERATOR_KITS,
  SPECS,
  SPEC_EFFECT_TARGETS,
  SPEC_EFFECT_TYPES,
  SPEC_TRIGGERS,
  WINGS,
  resolveKit,
} from './kits.mjs';

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
