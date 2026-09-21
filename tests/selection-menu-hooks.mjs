// Minimal synchronous state driver for SelectionScreen's event-contract tests.
// Only that component's react import is redirected; child components and the
// markup renderer use real React. Browser focus/layout remain browser checks.
let slots = [];
let cursor = 0;
export function resetMenuState() { slots = []; cursor = 0; }
export function renderMenu(Component, ui) { cursor = 0; return Component({ui}); }
export function useState(initial) {
  const index = cursor++;
  if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
  return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
}
export function useRef(initial) {
  const index = cursor++;
  return slots[index] ??= {current: initial};
}
export function useEffect() { /* Effects need a browser; do not fake focus. */ }
