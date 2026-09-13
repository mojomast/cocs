import test from 'node:test';
import assert from 'node:assert/strict';
import {hasAmmo, cycleWeapon, blocksGameplay, posture, controlsFromState, INPUT_CODES} from './input.mjs';
import {applyTouchAction} from './touch.mjs';

test('mouse and touch holds are independent and short touch taps survive release', () => {
  const state = {fire:true, ads:true, fireTap:false};
  applyTouchAction(state, 'fire', true);
  applyTouchAction(state, 'ads', true);
  applyTouchAction(state, 'fire', false);
  applyTouchAction(state, 'ads', false);
  state.fireTap = false;
  assert.equal(controlsFromState(state).fire, true, 'touch release preserves mouse fire');
  assert.equal(controlsFromState(state).ads, true, 'touch release preserves mouse ADS');
  applyTouchAction(state, 'fire', true);
  applyTouchAction(state, 'ads', true);
  state.fire = state.ads = state.fireTap = false;
  assert.equal(controlsFromState(state).fire, true, 'mouse release preserves touch fire');
  assert.equal(controlsFromState(state).ads, true, 'mouse release preserves touch ADS');
  applyTouchAction(state, 'fire', false);
  applyTouchAction(state, 'ads', false);
  assert.equal(controlsFromState(state).fire, false);
  assert.equal(controlsFromState(state).ads, undefined);
  applyTouchAction(state, 'fire', true);
  applyTouchAction(state, 'fire', false);
  assert.equal(controlsFromState(state).fire, true, 'tap survives until consumed');
  state.fireTap = false;
  assert.equal(controlsFromState(state).fire, false);
});

test('cycling accepts live and serialized unlimited ammo, skips empty slots and wraps', () => {
  assert.equal(hasAmmo(Infinity), true);
  assert.equal(hasAmmo('\u221e'), true);
  for (const ammo of [0, -1, NaN, undefined, null]) assert.equal(hasAmmo(ammo), false);
  assert.equal(cycleWeapon([1, 0, Infinity, '\u221e'], 0, -1, 1), 2);
  assert.equal(cycleWeapon([1, 0, Infinity, '\u221e'], 0, -1, -1), 3);
  assert.equal(cycleWeapon([1, 0, Infinity, '\u221e'], 3, -1, 1), 0);
  assert.equal(cycleWeapon([0, 0], 0, -1, 1), -1);
});

test('rapid cycling starts from pending selection and ignores zero or invalid delta', () => {
  const ammo = [Infinity, Infinity, Infinity];
  assert.equal(cycleWeapon(ammo, 0, 1, 1), 2);
  assert.equal(cycleWeapon(ammo, 2, 0, -1), 2);
  for (const delta of [0, -0, NaN, Infinity]) assert.equal(cycleWeapon(ammo, 0, 1, delta), -1);
});

test('posture reads sprint and crouch from held keys in sets or arrays', () => {
  assert.deepEqual(posture(['KeyW']), {sprint:false,crouch:false});
  assert.deepEqual(posture(['ShiftLeft','KeyW']), {sprint:true,crouch:false});
  assert.deepEqual(posture(new Set(['ControlLeft'])), {sprint:false,crouch:true});
  assert.deepEqual(posture(['KeyC','ShiftLeft']), {sprint:true,crouch:true});
  assert.deepEqual(posture(undefined), {sprint:false,crouch:false});
});

test('input codes cover every movement, stance, interact and reload key', () => {
  for (const code of ['ShiftLeft','ControlLeft','KeyC','KeyR','Space','KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE']) assert.ok(INPUT_CODES.includes(code));
});

test('controlsFromState builds movement and only sets active flags', () => {
  const forward = controlsFromState({keys:['KeyW'],look:{yaw:0,pitch:0}});
  assert.equal(forward.z, -1);
  assert.equal(forward.fire, false);
  assert.equal(forward.jump, undefined);
  assert.equal(forward.sprint, undefined);
  const full = controlsFromState({keys:['KeyW','ShiftLeft','ControlLeft'],look:{yaw:0,pitch:0},fire:true,jump:true,power:true,interact:true,weapon:2,ads:true,reload:true});
  assert.equal(full.sprint, true);
  assert.equal(full.crouch, true);
  assert.equal(full.ads, true);
  assert.equal(full.reload, true);
  assert.equal(full.jump, true);
  assert.equal(full.power, true);
  assert.equal(full.interact, true);
  assert.equal(full.weapon, 2);
  assert.equal(full.fire, true);
});

test('holding jump produces autohop while a one-shot tap still jumps', () => {
  assert.equal(controlsFromState({keys:['Space']}).jump, true);
  assert.equal(controlsFromState({keys:['KeyW'],jump:true}).jump, true);
  assert.equal(controlsFromState({keys:['KeyW']}).jump, undefined);
});

test('controlsFromState treats fireTap as fire and ignores negative weapon ids', () => {
  const tapped = controlsFromState({keys:[],fireTap:true,weapon:-1});
  assert.equal(tapped.fire,true);
  assert.equal(tapped.weapon,undefined);
  assert.ok(Math.abs(tapped.x) === 0);
  assert.ok(Math.abs(tapped.z) === 0);
});

test('chat, spectator and editable focus or targets block gameplay', () => {
  assert.equal(blocksGameplay(false, false, null, null), false);
  assert.equal(blocksGameplay(true, false, null, null), true);
  assert.equal(blocksGameplay(false, true, null, null), true);
  for (const element of [{tagName:'INPUT'}, {tagName:'TEXTAREA'}, {tagName:'SELECT'}, {isContentEditable:true}]) {
    assert.equal(blocksGameplay(false, false, element, null), true);
    assert.equal(blocksGameplay(false, false, null, element), true);
  }
});
test('analog touch move overrides keys and explicit posture flags register', () => {
  const analog = controlsFromState({ move: { x: 1, y: 0 }, look: { yaw: 0 } });
  assert.ok(Math.abs(analog.x - 1) < 1e-9 && Math.abs(analog.z) < 1e-9);
  const backward = controlsFromState({ move: { x: 0, y: -1 }, look: { yaw: 0 } });
  assert.ok(backward.z > 0);
  const mixed = controlsFromState({ keys: ['KeyA'], move: { x: 0, y: -1 }, look: { yaw: 0 } });
  assert.ok(Math.abs(mixed.z - 1) < 1e-9 && Math.abs(mixed.x) < 1e-9, 'analog wins over keys');
  const held = controlsFromState({ sprint: true, crouch: true });
  assert.equal(held.sprint, true);
  assert.equal(held.crouch, true);
});
test('melee registers as a provided one-shot control', () => {
  assert.equal(controlsFromState({ melee: true }).melee, true);
  assert.equal(controlsFromState({}).melee, undefined);
});
test('an idle joystick does not suppress keyboard movement', () => {
  // The runtime always supplies a touch vector shaped like this, so a centered
  // joystick must fall back to WASD instead of zeroing local and online input.
  const touchMove = touch => ({ x: touch.moveX || 0, y: touch.moveY || 0 });
  const idle = touchMove({moveX: 0, moveY: 0, sprint: false, crouch: false});
  const forward = controlsFromState({keys: ['KeyW'], look: {yaw: 0}, move: idle});
  assert.equal(forward.z, -1, 'W moves forward with an idle joystick');
  const right = controlsFromState({keys: ['KeyD'], look: {yaw: 0}, move: idle});
  assert.ok(Math.abs(right.x - 1) < 1e-9, 'D strafes right with an idle joystick');
  const still = controlsFromState({keys: [], look: {yaw: 0}, move: idle});
  assert.ok(Math.abs(still.x) < 1e-9 && Math.abs(still.z) < 1e-9, 'idle stays still');
});
test('an active joystick still drives analog movement', () => {
  const pushed = controlsFromState({keys: ['KeyW'], look: {yaw: 0}, move: {x: 0, y: .5}});
  assert.ok(Math.abs(pushed.z - (-.5)) < 1e-9, 'analog forward wins over keys');
  const released = controlsFromState({keys: ['KeyW'], look: {yaw: 0}, move: {x: 0, y: 0}, sprint: true});
  assert.equal(released.z, -1, 'keyboard resumes after the stick returns to center');
  assert.equal(released.sprint, true);
});

test('custom keybinds remap movement and one-shot actions', () => {
  const keys = new Set(['ArrowUp', 'Space']);
  const remapped = controlsFromState({keys, bindings: {forward: 'ArrowUp', jump: 'Enter'}});
  assert.ok(remapped.z < 0, 'ArrowUp drives forward after remap');
  assert.equal(remapped.jump, undefined, 'Space does not jump when jump is remapped');
  assert.equal(controlsFromState({keys, bindings: {forward: 'ArrowUp', jump: 'Space'}}).jump, true, 'Space jumps when bound');
});
