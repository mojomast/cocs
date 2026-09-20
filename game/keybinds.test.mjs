import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BINDINGS, KEYBIND_ACTIONS, KEYBIND_LABELS, KEYBIND_OPTIONS, actionBindingLabels, actionForCode, bindingConflicts, bindingLabel, normalizeBindings, rebindAction} from './keybinds.mjs';

test('explicit rebinding swaps occupied keys regardless of action order', () => {
  for (const [action, occupied] of [['forward', 'back'], ['back', 'forward']]) {
    const original = {...DEFAULT_BINDINGS};
    const rebound = rebindAction(original, action, original[occupied]);
    assert.deepEqual(rebound, {...original, [action]:original[occupied], [occupied]:original[action]});
    assert.deepEqual(original, DEFAULT_BINDINGS, 'does not mutate input');
    assert.deepEqual(bindingConflicts(rebound), []);
    assert.deepEqual(normalizeBindings(rebound), rebound, 'UI normalization preserves the swap');
  }
});

test('rebinding accepts free keys and ignores invalid actions or reserved keys', () => {
  assert.deepEqual(rebindAction(DEFAULT_BINDINGS, 'jump', 'ArrowUp'), {...DEFAULT_BINDINGS, jump:'ArrowUp'});
  assert.deepEqual(rebindAction(DEFAULT_BINDINGS, 'unknown', 'ArrowUp'), DEFAULT_BINDINGS);
  assert.deepEqual(rebindAction(DEFAULT_BINDINGS, 'jump', 'Tab'), DEFAULT_BINDINGS);
  assert.deepEqual(rebindAction(DEFAULT_BINDINGS, 'jump', 'Space'), DEFAULT_BINDINGS);
});

test('bindings normalize to valid defaults and reject junk', () => {
  assert.deepEqual(normalizeBindings(null), {...DEFAULT_BINDINGS});
  const custom = normalizeBindings({forward: 'ArrowUp', jump: 'nonsense', power: 42});
  assert.equal(custom.forward, 'ArrowUp');
  assert.equal(custom.jump, DEFAULT_BINDINGS.jump);
  assert.equal(custom.power, DEFAULT_BINDINGS.power);
});

test('duplicate bindings fall back to the default for the later action', () => {
  const bindings = normalizeBindings({forward: 'KeyW', back: 'KeyW'});
  assert.equal(bindings.forward, 'KeyW');
  assert.equal(bindings.back, DEFAULT_BINDINGS.back);
  assert.deepEqual(bindingConflicts(bindings), []);
});

test('codes resolve to actions and conflicts are reported', () => {
  const bindings = normalizeBindings({});
  assert.equal(actionForCode(bindings, 'KeyG'), 'grenade');
  assert.equal(actionForCode(bindings, 'KeyX'), 'mobility');
  assert.equal(actionForCode(bindings, 'KeyZ'), null);
  assert.deepEqual(bindingConflicts({forward: 'KeyW', back: 'KeyW', jump: 'Space', sprint: 'Space'}), ['KeyW', 'Space']);
  assert.equal(KEYBIND_ACTIONS.length, Object.keys(DEFAULT_BINDINGS).length);
});

test('mobility binds to KeyX and stays remappable like every other action', () => {
  assert.equal(DEFAULT_BINDINGS.mobility, 'KeyX');
  assert.equal(KEYBIND_ACTIONS.length, 21, '17 historical actions, the free-cursor toggle and the three O1c command surfaces');
  assert.ok(KEYBIND_OPTIONS.includes('KeyX'), 'KeyX is offered in the settings dropdown');
  assert.deepEqual(rebindAction(DEFAULT_BINDINGS, 'mobility', 'KeyZ'), {...DEFAULT_BINDINGS, mobility: 'KeyZ'});
  assert.deepEqual(normalizeBindings({mobility: 'nonsense'}).mobility, 'KeyX');
  assert.equal(actionForCode(normalizeBindings({}), 'KeyZ'), null, 'KeyZ stays free');
});

test('free cursor binds to AltLeft by default and stays remappable', () => {
  assert.equal(DEFAULT_BINDINGS.cursor, 'AltLeft');
  assert.equal(actionForCode(normalizeBindings({}), 'AltLeft'), 'cursor');
  assert.equal(actionForCode(normalizeBindings({}), 'AltRight'), null, 'only the bound Alt is the toggle');
  assert.ok(KEYBIND_OPTIONS.includes('AltLeft'), 'AltLeft is offered in the settings dropdown');
  assert.ok(KEYBIND_OPTIONS.includes('AltRight'), 'AltRight can be chosen as a replacement');
  const rebound = rebindAction(DEFAULT_BINDINGS, 'cursor', 'KeyZ');
  assert.equal(rebound.cursor, 'KeyZ');
  assert.equal(actionForCode(rebound, 'AltLeft'), null);
  assert.deepEqual(bindingConflicts(rebound), []);
  const swapped = rebindAction(DEFAULT_BINDINGS, 'cursor', 'KeyX');
  assert.equal(swapped.cursor, 'KeyX', 'choosing an occupied key takes it');
  assert.equal(swapped.mobility, 'AltLeft', 'and hands the old key to the displaced action');
});

test('every bindable action has a human label for the settings grid', () => {
  for (const action of KEYBIND_ACTIONS) assert.ok(KEYBIND_LABELS[action], `${action} has a label`);
  assert.match(KEYBIND_LABELS.cursor, /cursor/i);
  assert.match(KEYBIND_LABELS.command, /command board/i);
});

test('all player-facing surfaces share readable remapped key labels', () => {
  assert.equal(bindingLabel('KeyZ'), 'Z');
  assert.equal(bindingLabel('ShiftLeft'), 'Left Shift');
  assert.equal(bindingLabel('ArrowUp'), 'Up');
  const labels = actionBindingLabels({...DEFAULT_BINDINGS, power: 'KeyP', grenade: 'KeyZ'});
  assert.equal(labels.power, 'P');
  assert.equal(labels.grenade, 'Z');
});

test('normalization never produces duplicate bindings', () => {
  const forwardRemap = normalizeBindings({forward: 'KeyS'});
  assert.notEqual(forwardRemap.forward, forwardRemap.back);
  assert.deepEqual(bindingConflicts(forwardRemap), []);
  const collision = normalizeBindings({forward: 'KeyA', left: 'KeyA'});
  assert.deepEqual(bindingConflicts(collision), []);
  assert.equal(new Set(Object.values(collision)).size, KEYBIND_ACTIONS.length, 'one key per action');
});

test('reserved shell keys are rejected and not offered', () => {
  const bindings = normalizeBindings({jump: 'Tab', melee: 'KeyC', power: 'Enter', cursor: 'Escape'});
  assert.equal(bindings.jump, DEFAULT_BINDINGS.jump);
  assert.equal(bindings.melee, DEFAULT_BINDINGS.melee);
  assert.equal(bindings.power, DEFAULT_BINDINGS.power);
  assert.equal(bindings.cursor, 'AltLeft', 'the free-cursor toggle cannot steal Escape');
  for (const code of ['Tab', 'Escape', 'Enter', 'KeyT', 'KeyC', 'Digit1']) assert.ok(!KEYBIND_OPTIONS.includes(code), `${code} reserved`);
});
