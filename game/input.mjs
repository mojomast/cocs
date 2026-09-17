import {DEFAULT_BINDINGS} from './keybinds.mjs';

export const hasAmmo = ammo => ammo === '\u221e' || (typeof ammo === 'number' && ammo > 0);

export function cycleWeapon(ammo, current, pending, delta) {
  if (!Number.isFinite(delta) || delta === 0 || !ammo?.length) return -1;
  const start = Number.isInteger(pending) && pending >= 0 && pending < ammo.length ? pending : current;
  for (let step = 1; step <= ammo.length; step++) {
    const next = ((start + Math.sign(delta) * step) % ammo.length + ammo.length) % ammo.length;
    if (hasAmmo(ammo[next])) return next;
  }
  return -1;
}

export function isEditable(element) {
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)));
}

export function blocksGameplay(chatOpen, spectate, target, activeElement) {
  return Boolean(chatOpen || spectate || isEditable(target) || isEditable(activeElement));
}

function codeSet(keys) {
  if (!keys) return new Set();
  if (typeof keys.has === 'function') return keys;
  if (typeof keys[Symbol.iterator] === 'function') return new Set(keys);
  return new Set();
}

export function posture(keys, bindings = DEFAULT_BINDINGS) {
  const codes = codeSet(keys);
  return { sprint: codes.has(bindings?.sprint ?? 'ShiftLeft'), crouch: codes.has(bindings?.crouch ?? 'ControlLeft') || codes.has('KeyC') };
}

export function controlsFromState(state = {}) {
  const bindings = {...DEFAULT_BINDINGS, ...(state.bindings || {})};
  const codes = codeSet(state.keys), look = state.look || {}, held = action => codes.has(bindings[action] ?? DEFAULT_BINDINGS[action]);
  const move = state.move && Number.isFinite(state.move.x) && Number.isFinite(state.move.y) ? state.move : null;
  // An idle joystick reports (0,0); treat it as "no override" so desktop and
  // hybrid keyboard movement still works when touch controls are present.
  const analog = Boolean(move) && (move.x !== 0 || move.y !== 0);
  const forward = analog ? Math.max(-1, Math.min(1, move.y)) : (held('forward') ? 1 : 0) - (held('back') ? 1 : 0);
  const right = analog ? Math.max(-1, Math.min(1, move.x)) : (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  const yaw = Number.isFinite(state.yaw) ? state.yaw : Number.isFinite(look.yaw) ? look.yaw : 0;
  const pitch = Number.isFinite(state.pitch) ? state.pitch : Number.isFinite(look.pitch) ? look.pitch : 0;
  const controls = { x: -Math.sin(yaw) * forward + Math.cos(yaw) * right, z: -Math.cos(yaw) * forward - Math.sin(yaw) * right, yaw, pitch, fire: state.fire === true || state.touch?.fire === true || state.fireTap === true };
  const { sprint, crouch } = posture(codes, bindings);
  if (sprint || state.sprint === true) controls.sprint = true;
  if (crouch || state.crouch === true) controls.crouch = true;
  if (state.ads || state.touch?.ads === true) controls.ads = true;
  if (state.reload) controls.reload = true;
  // Holding jump auto-hops: the buffer re-arms on every landing frame.
  if (state.jump || held('jump')) controls.jump = true;
  if (state.power) controls.power = true;
  // The class movement verb (grapple / blink step / deployable rope) is a held
  // input: the engine derives its press and release edges from the held state.
  if (state.mobility === true || state.touch?.mobility === true || held('mobility')) controls.mobility = true;
  if (state.interact) controls.interact = true;
  if (state.melee) controls.melee = true;
  if (state.grenade) controls.grenade = true;
  if (Number.isInteger(state.weapon) && state.weapon >= 0) controls.weapon = state.weapon;
  return controls;
}
