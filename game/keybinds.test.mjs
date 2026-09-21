import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BINDINGS, KEYBIND_ACTIONS, KEYBIND_LABELS, KEYBIND_OPTIONS, actionBindingLabels, actionForCode, bindingConflicts, bindingLabel, bindingShortcut, normalizeBindings, rebindAction} from './keybinds.mjs';

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
  assert.equal(actionForCode(bindings, 'KeyZ'), 'altFire');
  assert.deepEqual(bindingConflicts({forward: 'KeyW', back: 'KeyW', jump: 'Space', sprint: 'Space'}), ['KeyW', 'Space']);
  assert.equal(KEYBIND_ACTIONS.length, Object.keys(DEFAULT_BINDINGS).length);
});

test('mobility binds to KeyX and stays remappable like every other action', () => {
  assert.equal(DEFAULT_BINDINGS.mobility, 'KeyX');
  assert.equal(KEYBIND_ACTIONS.length, 25, 'combat/order controls plus remappable tactical map and squads');
  assert.ok(KEYBIND_OPTIONS.includes('KeyX'), 'KeyX is offered in the settings dropdown');
  const rebound = rebindAction(DEFAULT_BINDINGS, 'mobility', 'KeyZ');
  assert.equal(rebound.mobility, 'KeyZ');
  assert.equal(rebound.altFire, 'KeyX', 'taking an occupied key hands KeyX to alt fire');
  assert.deepEqual(normalizeBindings(rebound), rebound, 'the swap still normalizes');
  assert.deepEqual(bindingConflicts(rebound), []);
  assert.deepEqual(normalizeBindings({mobility: 'nonsense'}).mobility, 'KeyX');
});

test('alt fire binds to KeyZ without colliding with the command board or the HUD key', () => {
  assert.equal(DEFAULT_BINDINGS.altFire, 'KeyZ');
  assert.equal(KEYBIND_LABELS.altFire, 'Alt fire');
  assert.ok(KEYBIND_OPTIONS.includes('KeyZ'), 'KeyZ is offered in the settings dropdown');
  assert.equal(actionForCode(normalizeBindings({}), 'KeyZ'), 'altFire');
  assert.notEqual(DEFAULT_BINDINGS.altFire, DEFAULT_BINDINGS.command, 'KeyB stays the command board');
  assert.notEqual(DEFAULT_BINDINGS.altFire, 'KeyH', 'KeyH stays the HUD hide toggle');
  const rebound = rebindAction(DEFAULT_BINDINGS, 'altFire', 'KeyJ');
  assert.equal(rebound.altFire, 'KeyJ');
  assert.equal(actionForCode(rebound, 'KeyJ'), 'altFire');
  assert.equal(actionForCode(rebound, 'KeyZ'), 'tacticalMap', 'the displaced tactical map receives the freed key');
  assert.equal(rebound.mobility, 'KeyX', 'unrelated actions keep their defaults');
  assert.deepEqual(bindingConflicts(rebound), []);
});

test('free cursor binds to AltLeft by default and stays remappable', () => {
  assert.equal(DEFAULT_BINDINGS.cursor, 'AltLeft');
  assert.equal(actionForCode(normalizeBindings({}), 'AltLeft'), 'cursor');
  assert.equal(actionForCode(normalizeBindings({}), 'AltRight'), null, 'only the bound Alt is the toggle');
  assert.ok(KEYBIND_OPTIONS.includes('AltLeft'), 'AltLeft is offered in the settings dropdown');
  assert.ok(KEYBIND_OPTIONS.includes('AltRight'), 'AltRight can be chosen as a replacement');
  const rebound = rebindAction(DEFAULT_BINDINGS, 'cursor', 'KeyZ');
  assert.equal(rebound.cursor, 'KeyZ');
  assert.equal(rebound.altFire, 'AltLeft', 'the displaced alt fire takes the freed AltLeft');
  assert.equal(actionForCode(rebound, 'AltLeft'), 'altFire');
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

test('aria-keyshortcuts tokens name the same key the HUD label shows', () => {
  assert.equal(bindingShortcut('KeyY'), 'Y');
  assert.equal(bindingShortcut('Digit7'), '7');
  assert.equal(bindingShortcut('ArrowUp'), 'ArrowUp', 'screen readers need the DOM arrow name, not the HUD "Up"');
  assert.equal(bindingShortcut('Space'), 'Space');
  assert.equal(bindingShortcut('ShiftLeft'), 'Shift');
  assert.equal(bindingShortcut('ControlRight'), 'Control');
  assert.equal(bindingShortcut('AltLeft'), 'Alt');
  assert.equal(bindingShortcut('Escape'), 'Escape');
  assert.equal(bindingShortcut('BracketLeft'), '[');
});

test('a remapped command/voice/interact/cursor set carries its real labels and shortcuts', () => {
  const bindings = normalizeBindings({...DEFAULT_BINDINGS, command: 'KeyY', voice: 'KeyI', interact: 'KeyL', cursor: 'KeyO'});
  const labels = actionBindingLabels(bindings);
  assert.equal(labels.command, 'Y');
  assert.equal(labels.voice, 'I');
  assert.equal(labels.interact, 'L');
  assert.equal(labels.cursor, 'O');
  assert.equal(bindingShortcut(bindings.command), 'Y');
  assert.equal(bindingShortcut(bindings.cursor), 'O');
  assert.equal(bindings.commandScan, DEFAULT_BINDINGS.commandScan, 'unrelated orders keep their defaults');
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
