import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURSOR_MODE, CURSOR_SURFACE, ESCAPE_GUARD_MS,
  cursorActive, cursorBlockingSurfaces, cursorClear, cursorClose, cursorEscape,
  cursorHint, cursorLockGained, cursorLockLost, cursorOpen, cursorReset,
  cursorSurfaceText, cursorToggle, initialCursorMode,
} from './cursor-mode.mjs';

const combat = () => initialCursorMode();
const cursor = (...surfaces) => ({mode: CURSOR_MODE.CURSOR, surfaces, escapeAt: -Infinity});
const effectsOf = result => result.effects;

test('opening the first surface releases the pointer and clears combat inputs', () => {
  const opened = cursorOpen(combat(), CURSOR_SURFACE.SPEND);
  assert.equal(opened.changed, true);
  assert.equal(opened.state.mode, CURSOR_MODE.CURSOR);
  assert.deepEqual(opened.state.surfaces, ['spend']);
  assert.deepEqual(effectsOf(opened), {unlock: true, lock: false, clearInput: true, requestPause: false, consumed: false, blocked: false});
  assert.equal(cursorActive(opened.state), true);
});

test('opening a second surface keeps the cursor and does not re-clear inputs', () => {
  const first = cursorOpen(combat(), CURSOR_SURFACE.SPEND).state;
  const second = cursorOpen(first, CURSOR_SURFACE.CHAT);
  assert.equal(second.changed, true);
  assert.deepEqual(second.state.surfaces, ['spend', 'chat']);
  assert.equal(second.effects.unlock, false);
  assert.equal(second.effects.clearInput, false);
  assert.equal(cursorOpen(second.state, CURSOR_SURFACE.CHAT).changed, false, 'surface registration is idempotent');
});

test('closing the last surface returns to combat and requests lock', () => {
  const open = cursorOpen(combat(), CURSOR_SURFACE.BOARD).state;
  const stillOpen = cursorOpen(open, CURSOR_SURFACE.CHAT).state;
  const partial = cursorClose(stillOpen, CURSOR_SURFACE.BOARD);
  assert.equal(partial.changed, true);
  assert.equal(partial.state.mode, CURSOR_MODE.CURSOR);
  assert.equal(partial.effects.lock, false);
  const closed = cursorClose(partial.state, CURSOR_SURFACE.CHAT);
  assert.equal(closed.state.mode, CURSOR_MODE.COMBAT);
  assert.deepEqual(closed.state.surfaces, []);
  assert.equal(closed.effects.lock, true);
  assert.equal(closed.effects.clearInput, true);
  assert.equal(cursorClose(closed.state, CURSOR_SURFACE.CHAT).changed, false, 'closing twice is a no-op');
});

test('browser Escape (pointer lock lost) enters cursor mode and never pauses', () => {
  const lost = cursorLockLost(combat(), {at: 1000});
  assert.equal(lost.changed, true);
  assert.equal(lost.escaped, true);
  assert.equal(lost.state.mode, CURSOR_MODE.CURSOR);
  assert.deepEqual(lost.state.surfaces, [CURSOR_SURFACE.ESCAPE]);
  assert.equal(lost.state.escapeAt, 1000);
  assert.equal(lost.effects.clearInput, true);
  assert.equal(lost.effects.unlock, false, 'the browser already released it');
  assert.equal(lost.effects.requestPause, false, 'Escape-exits-lock must not double-trigger pause');
  const again = cursorLockLost(lost.state, {at: 1200});
  assert.equal(again.changed, false);
});

test('the same physical Escape is consumed by the guard window', () => {
  const lost = cursorLockLost(combat(), {at: 1000});
  const during = cursorEscape(lost.state, {at: 1000 + ESCAPE_GUARD_MS - 1});
  assert.equal(during.effects.consumed, true);
  assert.equal(during.effects.requestPause, false);
  const after = cursorEscape(lost.state, {at: 1000 + ESCAPE_GUARD_MS + 1});
  assert.equal(after.effects.requestPause, true, 'a later Escape can pause');
  assert.equal(after.effects.consumed, false);
});

test('Escape with only the free cursor asks the page for pause; explicit surfaces block it', () => {
  const free = cursorToggle(combat(), CURSOR_SURFACE.FREE).state;
  assert.equal(cursorEscape(free, {at: 9000}).effects.requestPause, true);
  const board = cursorOpen(combat(), CURSOR_SURFACE.BOARD).state;
  const routed = cursorEscape(board, {at: 9000});
  assert.equal(routed.effects.requestPause, false);
  assert.equal(routed.effects.blocked, true, 'the board owns its own Escape handling');
  assert.equal(routed.changed, false);
});

test('free cursor toggles in place and returns to combat from the implicit reasons', () => {
  const on = cursorToggle(combat());
  assert.equal(on.state.mode, CURSOR_MODE.CURSOR);
  assert.deepEqual(on.state.surfaces, [CURSOR_SURFACE.FREE]);
  assert.equal(on.effects.unlock, true);
  const off = cursorToggle(on.state);
  assert.equal(off.state.mode, CURSOR_MODE.COMBAT);
  assert.equal(off.effects.lock, true);
  const escaped = cursorToggle(cursor(CURSOR_SURFACE.ESCAPE));
  assert.equal(escaped.state.mode, CURSOR_MODE.COMBAT, 'Alt returns from a browser-released cursor');
  assert.equal(escaped.effects.lock, true);
});

test('free cursor refuses to swallow an explicit surface', () => {
  const board = cursorOpen(combat(), CURSOR_SURFACE.BOARD).state;
  const refused = cursorToggle(board);
  assert.equal(refused.changed, false);
  assert.equal(refused.effects.blocked, true);
  assert.deepEqual(refused.state.surfaces, [CURSOR_SURFACE.BOARD]);
});

test('acquiring pointer lock clears surfaces and re-enters combat', () => {
  const board = cursorOpen(combat(), CURSOR_SURFACE.BOARD).state;
  const gained = cursorLockGained(board);
  assert.equal(gained.changed, true);
  assert.equal(gained.state.mode, CURSOR_MODE.COMBAT);
  assert.deepEqual(gained.state.surfaces, []);
  assert.equal(gained.effects.clearInput, true);
  assert.equal(cursorLockGained(combat()).changed, false);
});

test('cursorClear is the single user "back to combat" transition', () => {
  const lost = cursorLockLost(combat(), {at: 10}).state;
  const clear = cursorClear(lost);
  assert.equal(clear.state.mode, CURSOR_MODE.COMBAT);
  assert.equal(clear.effects.lock, true);
  assert.equal(clear.effects.clearInput, true);
  assert.equal(cursorClear(combat()).effects.lock, false);
});

test('cursorReset is silent so mode changes do not request lock', () => {
  const board = cursorOpen(combat(), CURSOR_SURFACE.BOARD).state;
  const reset = cursorReset(board);
  assert.equal(reset.changed, true);
  assert.equal(reset.state.mode, CURSOR_MODE.COMBAT);
  assert.equal(reset.effects.lock, false);
  assert.equal(reset.effects.unlock, false);
  assert.equal(reset.effects.clearInput, false);
});

test('labels and hints describe the active reasons in words', () => {
  const board = cursorOpen(combat(), CURSOR_SURFACE.BOARD).state;
  assert.equal(cursorSurfaceText(board), 'COMMAND BOARD');
  assert.deepEqual(cursorBlockingSurfaces(board), ['board']);
  const both = cursorOpen(board, CURSOR_SURFACE.SPEND).state;
  assert.equal(cursorSurfaceText(both), 'COMMAND BOARD · SPEND WINDOW');
  assert.match(cursorHint(both), /COMMAND BOARD \/ SPEND WINDOW/);
  assert.match(cursorHint(both), /CLICK TO FIGHT/);
  const free = cursorToggle(combat()).state;
  assert.match(cursorHint(free, {key: 'AltLeft'}), /^ALT OR CLICK TO FIGHT$/);
  assert.equal(cursorHint(combat()), '');
});

test('junk state normalizes to combat instead of throwing', () => {
  assert.deepEqual(cursorReset(null).state, {mode: CURSOR_MODE.COMBAT, surfaces: [], escapeAt: -Infinity});
  assert.equal(cursorActive(undefined), false);
  assert.equal(cursorOpen(null, '').changed, false);
  assert.equal(cursorClose(null, 'board').changed, false);
});
