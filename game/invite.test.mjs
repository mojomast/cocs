import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseRoomCode, inviteLink, roomFromLocation} from './invite.mjs';

test('room codes are normalized and validated', () => {
  assert.equal(normaliseRoomCode(' abcd '), 'ABCD');
  assert.equal(normaliseRoomCode('local'), 'LOCAL');
  assert.equal(normaliseRoomCode('a'), null);
  assert.equal(normaliseRoomCode('has space'), null);
  assert.equal(normaliseRoomCode(''), null);
  assert.equal(normaliseRoomCode(null), null);
});

test('invite links replace any existing room parameter', () => {
  assert.equal(inviteLink('https://arena.ussyco.de/?room=OLD', 'wxyz'), 'https://arena.ussyco.de/?room=WXYZ');
  assert.equal(inviteLink('https://arena.ussyco.de/', 'abcd'), 'https://arena.ussyco.de/?room=ABCD');
  assert.equal(inviteLink('https://arena.ussyco.de/#lobby', 'abcd'), 'https://arena.ussyco.de/?room=ABCD');
  assert.equal(inviteLink('https://arena.ussyco.de/', 'bad code'), null);
});

test('roomFromLocation reads room or join parameters', () => {
  assert.equal(roomFromLocation('?room=abcd'), 'ABCD');
  assert.equal(roomFromLocation('?join=WXYZ'), 'WXYZ');
  assert.equal(roomFromLocation('?room=bad%20code'), null);
  assert.equal(roomFromLocation(''), null);
});

test('a generated invite link round-trips through roomFromLocation', () => {
  const link = inviteLink('https://arena.ussyco.de/play', 'qwer');
  assert.ok(link);
  assert.equal(roomFromLocation(new URL(link).search), 'QWER');
});
