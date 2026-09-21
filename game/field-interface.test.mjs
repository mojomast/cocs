import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BINDINGS,normalizeBindings,actionForCode,bindingConflicts} from './keybinds.mjs';
import {CURSOR_SURFACE,initialCursorMode,cursorOpen,cursorClose,cursorCombatKeysBlocked,cursorKeyboardOwner} from './cursor-mode.mjs';

test('new field shortcuts preserve saved combat/order bindings without collisions',()=>{
 const previous={...DEFAULT_BINDINGS};delete previous.tacticalMap;delete previous.squads;
 previous.reload='KeyJ';previous.jump='KeyL';
 const bindings=normalizeBindings(previous);
 assert.equal(bindings.reload,'KeyJ');assert.equal(bindings.jump,'KeyL');
 assert.equal(bindings.commandGo,'KeyM');
 assert.deepEqual(bindingConflicts(bindings),[]);
 assert.equal(actionForCode(bindings,bindings.tacticalMap),'tacticalMap');
 assert.equal(actionForCode(bindings,bindings.squads),'squads');
});

test('field dialogs clear held combat, own keyboard over the board and hand cursor ownership back',()=>{
 for(const surface of [CURSOR_SURFACE.TACTICAL_MAP,CURSOR_SURFACE.SQUADS]){
  const open=cursorOpen(initialCursorMode(),surface);
  assert.equal(open.effects.unlock,true);assert.equal(open.effects.clearInput,true);
  assert.equal(cursorCombatKeysBlocked(open.state),true);
  const board=cursorOpen(open.state,CURSOR_SURFACE.BOARD);
  assert.equal(cursorKeyboardOwner(board.state),surface);
  const close=cursorClose(board.state,surface);
  assert.equal(close.effects.lock,false,'other interactive surfaces retain the cursor');
  assert.equal(cursorKeyboardOwner(close.state),CURSOR_SURFACE.BOARD);
  assert.equal(cursorClose(close.state,CURSOR_SURFACE.BOARD).effects.lock,true);
 }
});
