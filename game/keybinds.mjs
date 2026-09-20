// Remappable keyboard bindings. Pure and engine-free so validation, duplicate
// handling and code-to-action resolution are unit-testable.
export const KEYBIND_STORAGE_KEY = 'token-arena-keybinds';

export const DEFAULT_BINDINGS = Object.freeze({
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sprint: 'ShiftLeft', crouch: 'ControlLeft',
  reload: 'KeyR', melee: 'KeyF', grenade: 'KeyG', power: 'KeyQ', mobility: 'KeyX', interact: 'KeyE', voice: 'KeyV',
  // Free-cursor toggle (LATTICE UX). Releases pointer lock in place — without
  // pausing or opening a menu — so any HUD surface can be clicked, then toggles
  // combat back on. Remappable like every other action.
  cursor: 'AltLeft',
  // LATTICE STRIKE (`cocs`) V0b order strip. SCAN / GO / ATTACK arm the strip's
  // three verbs; a node is then picked with the number keys or a click. Bound
  // like every other action so a player can remap them in Settings.
  commandScan: 'KeyN', commandGo: 'KeyM', commandAttack: 'KeyP',
  // O1c command surfaces (design §13.4): the board hold-to-peek, the ping
  // marker and the order radial. Registered so they are remappable in Settings.
  command: 'KeyB', ping: 'KeyU', radial: 'KeyK',
});

export const KEYBIND_ACTIONS = Object.freeze(Object.keys(DEFAULT_BINDINGS));

// Human labels for the Settings UI and assistive tech. Every action has one so
// the keybind grid never falls back to a raw identifier.
export const KEYBIND_LABELS = Object.freeze({
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  jump: 'Jump', sprint: 'Sprint', crouch: 'Crouch',
  reload: 'Reload', melee: 'Melee', grenade: 'Frag', power: 'Harness ability', mobility: 'Mobility verb',
  interact: 'Interact / use', voice: 'Push to talk', cursor: 'Free cursor (release mouse)',
  commandScan: 'Order: scan', commandGo: 'Order: go / hold', commandAttack: 'Order: attack',
  command: 'Command board (hold or toggle)', ping: 'Ping marker', radial: 'Order radial',
});

// Keys the shell owns (scoreboard, pause, chat, weapons, digits, crouch-alt).
export const RESERVED_CODES = Object.freeze(['Tab', 'Escape', 'Enter', 'KeyT', 'KeyC', 'BracketLeft', 'BracketRight', 'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']);
const RESERVED = new Set(RESERVED_CODES);

const CODE = /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|Tab|Enter|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backslash|Backquote|Minus|Equal)$/;

// The single source of truth for both validation and the settings dropdown, so
// every accepted binding is representable and no reserved key is offered.
const EXTRA_CODES = ['KeyB','KeyH', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyU', 'KeyY', 'KeyZ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftRight', 'ControlRight', 'AltLeft', 'AltRight', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Backquote', 'Minus', 'Equal'];
export const KEYBIND_OPTIONS = Object.freeze([...new Set([...Object.values(DEFAULT_BINDINGS), ...EXTRA_CODES])].filter(code => !RESERVED.has(code)));

// One player-facing label for every input surface (setup, HUD and training).
// Keeping code prettification here prevents remapped labels from drifting.
export function bindingLabel(code) {
  return String(code || '?').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '')
    .replace('ShiftLeft', 'Left Shift').replace('ShiftRight', 'Right Shift')
    .replace('ControlLeft', 'Left Ctrl').replace('ControlRight', 'Right Ctrl')
    .replace('AltLeft', 'Left Alt').replace('AltRight', 'Right Alt');
}

export function actionBindingLabels(bindings = {}) {
  return Object.fromEntries(KEYBIND_ACTIONS.map(action => [action, bindingLabel(bindings[action] ?? DEFAULT_BINDINGS[action])]));
}

export const isKeybindCode = value => typeof value === 'string' && CODE.test(value) && !RESERVED.has(value);

export function normalizeBindings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const used = new Set(), out = {};
  for (const action of KEYBIND_ACTIONS) {
    let candidate = isKeybindCode(source[action]) ? source[action] : DEFAULT_BINDINGS[action];
    if (used.has(candidate)) candidate = null;
    if (!candidate) candidate = Object.values(DEFAULT_BINDINGS).find(code => !used.has(code)) || null;
    if (!candidate) candidate = KEYBIND_OPTIONS.find(code => !used.has(code)) || null;
    if (!candidate) candidate = DEFAULT_BINDINGS[action];
    out[action] = candidate;
    used.add(candidate);
  }
  return out;
}

export function rebindAction(bindings, action, code) {
  const next = normalizeBindings(bindings);
  if (!KEYBIND_ACTIONS.includes(action) || !isKeybindCode(code)) return next;
  const occupied = actionForCode(next, code);
  if (occupied) next[occupied] = next[action];
  next[action] = code;
  return next;
}

export function actionForCode(bindings, code) {
  if (typeof code !== 'string') return null;
  for (const action of KEYBIND_ACTIONS) if (bindings?.[action] === code) return action;
  return null;
}

export function bindingConflicts(bindings) {
  const seen = new Set(), conflicts = new Set();
  for (const action of KEYBIND_ACTIONS) {
    const key = bindings?.[action];
    if (!key) continue;
    if (seen.has(key)) conflicts.add(key); else seen.add(key);
  }
  return [...conflicts];
}
