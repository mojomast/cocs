import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTERS, HARNESSES} from './data.mjs';
import {MOVEMENT_VERBS, OPERATOR_KITS, SPECS, WINGS, resolveKit} from './kits.mjs';
import {
  HOOK_LABELS, INPUT_LABELS, KIND_LABELS,
  budgetLine, comboLine, inputLabel, kitView, kindLabel, hookLabel, movementRow,
  operatorCard, signatureVerb, specSheet, triggerLabel, wingChip, wingRider,
} from './class-ui.mjs';

const EXPECTED_BUDGET_LINES = {
  'air-dash': '1 charge · 5.5 m · 2.5 s cooldown · 0.15 s landing',
  'double-jump': '1 charge · 7.4 impulse',
  'super-jump': '1 charge · 12.5 impulse · 0.55 s wind-up · 6 s cooldown · 0.25 s landing',
  'hover-jets': '2.5 s fuel · 1.8 s recharge · 0.35 climb · 2.2 m/s descent · 0.2 s landing',
  'brace-slam': '0.15 s wind-up · 4 m radius · 9 knockback · 8 s cooldown',
  'safety-glide': '2 m/s descent · 4 steer',
  grapple: '14 m · 12 m/s reel · 7 s cooldown · 3 s on miss',
  'blink-step': '6 m · 0.3 s wind-up · 6 s cooldown',
  'deployable-rope': '1 charge · 20 s anchor · 12 s cooldown',
};

test('input, kind, hook and trigger labels are human copy with total fallbacks', () => {
  assert.deepEqual(Object.keys(INPUT_LABELS).sort(), ['crouch', 'crouch-jump', 'jump', 'jump-hold', 'mobility']);
  assert.equal(inputLabel('mobility'), 'X');
  assert.equal(inputLabel('jump-hold'), 'HOLD JUMP');
  assert.equal(inputLabel('warp'), 'WARP');
  assert.equal(inputLabel(null), null);
  assert.equal(kindLabel('burst'), 'BURST');
  assert.equal(kindLabel('heal'), 'HEAL');
  assert.equal(kindLabel('unknown'), 'UNKNOWN');
  assert.equal(kindLabel(undefined), null);
  assert.equal(hookLabel('economy'), 'ECONOMY');
  assert.equal(hookLabel('landing-self'), 'LANDING · SELF');
  assert.equal(hookLabel('nope'), 'NOPE');
  assert.equal(hookLabel(''), null);
  assert.equal(triggerLabel('impact'), 'ON IMPACT');
  assert.equal(triggerLabel('ride'), 'RIDE');
  assert.equal(triggerLabel(null), null);
  assert.ok(Object.keys(KIND_LABELS).length >= 8);
  assert.ok(Object.keys(HOOK_LABELS).length === 5);
});

test('budgetLine renders every movement verb in the canonical field order', () => {
  for (const verb of MOVEMENT_VERBS) {
    assert.equal(budgetLine(verb), EXPECTED_BUDGET_LINES[verb.id], verb.id);
  }
  assert.equal(budgetLine(null), null);
  assert.equal(budgetLine({}), null);
  assert.equal(budgetLine({budget: {cooldown: 0}}), null, 'a zero budget reads as no cost');
});

test('wingChip resolves by wing id, operator id, wing record and rejects unknowns', () => {
  for (const wing of WINGS) {
    const chip = wingChip(wing.id);
    assert.equal(chip.id, wing.id);
    assert.equal(chip.label, wing.label);
    assert.equal(chip.color, wing.color);
    assert.equal(chip.family, wing.family);
    assert.equal(chip.domain, wing.domain);
    assert.equal(chip.pays, wing.pays);
    assert.equal(chip.fantasy, wing.fantasy);
    assert.ok(Object.isFrozen(chip));
    assert.equal(wingChip(wing).id, wing.id, 'a full wing record resolves too');
  }
  assert.equal(wingChip('mistral').id, 'striker', 'an operator id resolves through its kit');
  assert.equal(wingChip('qwen').id, 'tactician');
  assert.equal(wingChip('nobody'), null);
  assert.equal(wingChip(null), null);
  assert.equal(wingChip(7), null);
});

test('operatorCard publishes wing, role, signature verb, movement verb and stats', () => {
  assert.equal(OPERATOR_KITS.length, CHARACTERS.length);
  for (const kit of OPERATOR_KITS) {
    const card = operatorCard(kit.id);
    assert.equal(card.id, kit.id);
    assert.equal(card.wingId, kit.wing);
    assert.equal(card.wing.id, kit.wing);
    assert.equal(card.role, kit.role);
    assert.equal(card.roleLabel, kit.role.toUpperCase());
    assert.equal(card.signature.id, kit.verb.id);
    assert.equal(card.signature.name, kit.verb.name);
    assert.equal(card.signature.line, kit.verb.description);
    assert.equal(card.movement.id, kit.movement);
    assert.equal(card.strength, card.wing.domain);
    assert.equal(card.weakness, card.wing.pays);
    assert.ok(/HP · \d+ ARM · \d+(\.\d+)? m\/s/.test(card.statsLine), card.statsLine);
    assert.ok(Object.isFrozen(card));
  }
  assert.equal(operatorCard('mistral').movement.name, 'Air Dash');
  assert.equal(operatorCard('claude').signature.name, 'Alignment Review');
  assert.equal(operatorCard('nobody'), null);
  assert.equal(operatorCard(undefined), null);
});

test('signatureVerb and movementRow accept ids and records, and stay total', () => {
  assert.equal(signatureVerb('grok').name, 'Heat');
  assert.equal(signatureVerb('grok').id, 'heat');
  assert.equal(signatureVerb('nobody'), null);
  for (const verb of MOVEMENT_VERBS) {
    const row = movementRow(verb.id);
    assert.equal(row.id, verb.id);
    assert.equal(row.name, verb.name);
    assert.equal(row.family, verb.family);
    assert.equal(row.input, verb.input);
    assert.equal(row.inputLabel, INPUT_LABELS[verb.input] ?? verb.input.toUpperCase());
    assert.equal(row.budgetLine, EXPECTED_BUDGET_LINES[verb.id]);
    assert.equal(row.carrier.drop, true);
    assert.equal(movementRow(verb).id, verb.id, 'a record resolves too');
  }
  assert.equal(movementRow('mistral').id, 'air-dash', 'an operator id resolves through its kit');
  assert.equal(movementRow('qwen').id, 'deployable-rope');
  assert.equal(movementRow('nobody'), null);
  assert.equal(movementRow(null), null);
});

test('specSheet reads the active, tradeoff passive and movement hook for all seven harnesses', () => {
  assert.equal(SPECS.length, HARNESSES.length);
  for (const spec of SPECS) {
    const sheet = specSheet(spec.id);
    assert.equal(sheet.id, spec.id);
    assert.equal(sheet.name, spec.name);
    assert.equal(sheet.kind, spec.kind);
    assert.equal(sheet.kindLabel, spec.kind.toUpperCase());
    assert.equal(sheet.active.name, spec.active.name);
    assert.equal(sheet.active.description, HARNESSES.find(h => h.id === spec.id).description);
    assert.equal(sheet.tradeoff.id, spec.tradeoff.id);
    assert.equal(sheet.tradeoff.description, spec.tradeoff.description);
    assert.equal(sheet.passive.trigger, spec.passive.trigger);
    assert.ok(sheet.passive.triggerLabel.includes(' ') || sheet.passive.triggerLabel.length > 0);
    assert.equal(sheet.movementHook, spec.movementHook);
    assert.ok(sheet.hookLabel.length > 0);
    assert.ok(Object.isFrozen(sheet));
  }
  assert.equal(specSheet('cline').tradeoff.name, 'Off-road');
  assert.equal(specSheet('cline').hookLabel, 'CHAINING');
  assert.equal(specSheet('claudecode').passive.trigger, 'threat');
  assert.equal(specSheet('nobody'), null);
  assert.equal(specSheet(null), null);
});

test('wingRider resolves the 21 rider rows across the 63 operator/spec pairs', () => {
  let combos = 0;
  for (const character of CHARACTERS) {
    for (const harness of HARNESSES) {
      const rider = wingRider(character.id, harness.id);
      const resolved = resolveKit(character.id, harness.id);
      assert.equal(rider.wing, resolved.wing);
      assert.equal(rider.id, resolved.rider.id);
      assert.equal(rider.description, resolved.rider.description);
      assert.equal(rider.trigger, resolved.rider.trigger);
      assert.ok(rider.description.length > 0);
      combos++;
    }
  }
  assert.equal(combos, 63);
  // The worked Cline row (§3.3) stays the same text the engine ships.
  assert.equal(wingRider('mistral', 'cline').description, 'Longest distance, weapon ready on arrival.');
  assert.equal(wingRider('meta', 'cline').description, 'Unstoppable during the dash, shorter distance.');
  assert.equal(wingRider('qwen', 'cline').description, 'The dash leaves a brief radar feint at the origin.');
  const known = new Set(SPECS.flatMap(spec => Object.values(spec.riders).map(rider => rider.id)));
  assert.equal(known.size, 21, '21 distinct rider rows');
});

test('comboLine names the pair and appends the wing rider sentence', () => {
  const line = comboLine('mistral', 'cline');
  assert.ok(line.startsWith('Mistral + Phase Step — '), line);
  assert.ok(line.endsWith('Longest distance, weapon ready on arrival.'), line);
  assert.match(comboLine('claude', 'claudecode'), /^Claude \+ Guardrail — /);
  assert.match(comboLine('qwen', 'roo'), /Wider jam radius\.$/);
  assert.equal(comboLine('nobody', 'cline'), null);
  assert.equal(comboLine(null, null), null);
});

test('kitView composes the preview tab from resolveKit for every pair', () => {
  for (const character of CHARACTERS) {
    for (const harness of HARNESSES) {
      const view = kitView(character.id, harness.id);
      const resolved = resolveKit(character.id, harness.id);
      assert.equal(view.character, resolved.character);
      assert.equal(view.harness, resolved.harness);
      assert.equal(view.wing.id, resolved.wing);
      assert.equal(view.kind, resolved.kind);
      assert.equal(view.kindLabel, resolved.kind.toUpperCase());
      assert.equal(view.tradeoff.id, resolved.tradeoff.id);
      assert.equal(view.rider.id, resolved.rider.id);
      assert.equal(view.movementHook, resolved.movementHook);
      assert.equal(view.movement.id, resolved.movement.id);
      assert.equal(view.active.name, resolved.active.name);
      assert.equal(view.combo, comboLine(resolved.character, resolved.harness));
      assert.ok(view.roleLabel.length > 0 && view.statsLine.length > 0);
      assert.ok(Object.isFrozen(view));
    }
  }
  // Unknown pairs normalise exactly like every other loadout path (resolveKit),
  // so the preview never blanks out mid-keystroke.
  const fallback = kitView('nobody', 'nothing');
  assert.equal(fallback.character, 'chatgpt');
  assert.equal(fallback.harness, 'openclaw');
  assert.equal(fallback.rider.wing, 'tactician');
});
