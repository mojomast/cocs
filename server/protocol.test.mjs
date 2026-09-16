import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MESSAGE} from '../game/protocol.mjs';

const source = await readFile(new URL('./game-server.mjs', import.meta.url), 'utf8');

test('every message type the game server dispatches is declared in MESSAGE', () => {
  const known = new Set(Object.values(MESSAGE));
  const dispatched = [...source.matchAll(/case\s+'([a-z][a-z-]*)'\s*:/g)].map(match => match[1]);
  assert.ok(dispatched.length > 0, 'the dispatch switch was found');
  const undeclared = dispatched.filter(type => !known.has(type));
  assert.deepEqual(undeclared, [], `undeclared server message types: ${undeclared.join(', ')}`);
});

test('MESSAGE values are unique and lowercase-hyphenated', () => {
  const values = Object.values(MESSAGE);
  assert.equal(new Set(values).size, values.length, 'no duplicate message types');
  for (const value of values) assert.match(value, /^[a-z][a-z-]*$/, `${value} is a wire literal`);
});
