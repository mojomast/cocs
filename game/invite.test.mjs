import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseRoomCode, inviteLink, roomFromLocation, spectateFromLocation} from './invite.mjs';

test('room codes are normalized and validated', () => {
  assert.equal(normaliseRoomCode(' abcd '), 'ABCD');
  assert.equal(normaliseRoomCode('local'), 'local');
  assert.equal(normaliseRoomCode('LOCAL'), 'local');
  assert.equal(normaliseRoomCode('a'), null);
  assert.equal(normaliseRoomCode('has space'), null);
  assert.equal(normaliseRoomCode(''), null);
  assert.equal(normaliseRoomCode(null), null);
});

test('invite links replace any existing room parameter', () => {
  assert.equal(inviteLink('https://arena.ussyco.de/?room=OLD', 'wxyz'), 'https://arena.ussyco.de/?room=WXYZ');
  assert.equal(inviteLink('https://arena.ussyco.de/', 'abcd'), 'https://arena.ussyco.de/?room=ABCD');
  assert.equal(inviteLink('https://arena.ussyco.de/#lobby', 'abcd'), 'https://arena.ussyco.de/?room=ABCD');
  assert.equal(inviteLink('https://arena.ussyco.de/', 'local'), 'https://arena.ussyco.de/?room=local');
  assert.equal(inviteLink('https://arena.ussyco.de/', 'bad code'), null);
});

test('spectate links round-trip the watch intent', () => {
  const link = inviteLink('https://arena.ussyco.de/', 'qwer', {spectate: true});
  assert.equal(link, 'https://arena.ussyco.de/?room=QWER&spectate=1');
  assert.equal(spectateFromLocation(new URL(link).search), true);
  assert.equal(spectateFromLocation('?room=QWER'), false);
  assert.equal(spectateFromLocation('?watch=1'), true);
});

test('roomFromLocation reads room or join parameters', () => {
  assert.equal(roomFromLocation('?room=abcd'), 'ABCD');
  assert.equal(roomFromLocation('?join=WXYZ'), 'WXYZ');
  assert.equal(roomFromLocation('?room=local'), 'local');
  assert.equal(roomFromLocation('?room=bad%20code'), null);
  assert.equal(roomFromLocation(''), null);
});
