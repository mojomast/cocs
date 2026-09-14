import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {WEAPONS} from './data.mjs';

const seeded = () => { let n = 41; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
const kill = (m, a, b) => { Object.assign(b, {health: 1, protection: 0, armor: 0}); m.damage(b, 999, a); };

test('arms race advances the ladder on each kill and wins on the final weapon', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'proving-grounds', {mode: 'armsrace', botCount: 0, humanCount: 2, timeLimit: 120});
  const [a, b] = m.actors;
  assert.equal(a.weapon, 0);
  assert.equal(a.ladder, 0);
  kill(m, a, b);
  assert.equal(a.ladder, 1);
  assert.equal(a.weapon, 1);
  assert.ok(a.ammo[1] > 0, 'promoted weapon has ammunition');
  for (let rung = 1; rung < WEAPONS.length - 1; rung++) kill(m, a, b);
  assert.equal(a.ladder, WEAPONS.length - 1);
  assert.equal(m.over, false, 'the last rung is not a win yet');
  kill(m, a, b);
  assert.equal(m.over, true);
  assert.equal(m.overReason, 'objective');
  assert.ok(m.events.some(e => e.type === 'armsrace-win' && e.actor === a.id));
});

test('arms race forces the ladder weapon instead of manual switches', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'proving-grounds', {mode: 'armsrace', botCount: 0, humanCount: 1, timeLimit: 60});
  const a = m.actors[0];
  m.pickups = [];
  a.weapon = 0; a.ladder = 0;
  m.step(1 / 60, {inputs: {0: {weapon: 5}}});
  assert.equal(a.weapon, 0, 'weapon switch is ignored during arms race');
});

test('bots during arms race keep their promoted ladder weapon', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'proving-grounds', {mode: 'armsrace', botCount: 3, humanCount: 1, timeLimit: 40});
  const bot = m.actors.find(a => a.bot);
  bot.ladder = 4; bot.weapon = 4;
  for (let i = 0; i < 120; i++) m.step(1 / 60);
  assert.equal(bot.weapon, bot.ladder, 'bot uses its ladder weapon');
});

test('arms race demotes one rung on death and clamps at the first rung', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'proving-grounds', {mode: 'armsrace', botCount: 0, humanCount: 2, timeLimit: 60});
  const [a, b] = m.actors;
  kill(m, a, b); kill(m, a, b);
  assert.equal(a.ladder, 2);
  Object.assign(a, {health: 1, protection: 0, armor: 0});
  m.damage(a, 999, b);
  assert.equal(a.ladder, 1, 'dying drops the ladder one rung');
  assert.equal(a.weapon, 1, 'the demoted rung becomes the weapon');
  assert.ok(m.events.some(e => e.type === 'armsrace-demote' && e.actor === a.id));
  m.spawn(a);
  assert.equal(a.ladder, 1, 'the demoted rung survives respawn');
  assert.equal(a.weapon, 1, 'respawns on the demoted rung');
  assert.ok(a.ammo[1] > 0, 'demoted rung has ammunition');

  const floor = new Match('chatgpt', 'openclaw', seeded(), 'proving-grounds', {mode: 'armsrace', botCount: 0, humanCount: 2, timeLimit: 60});
  const [p, q] = floor.actors;
  Object.assign(p, {health: 1, protection: 0, armor: 0});
  floor.damage(p, 999, q);
  assert.equal(p.ladder, 0, 'the ladder never drops below the first rung');
});

test('a trailing arms race player gains a bonus rung on a kill without skipping the last rung', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'proving-grounds', {mode: 'armsrace', botCount: 0, humanCount: 3, timeLimit: 120});
  const [a, b, c] = m.actors;
  a.ladder = 0; a.weapon = 0;
  b.ladder = 5; b.weapon = 5;
  c.ladder = 0; c.weapon = 0;
  Object.assign(b, {health: 1, protection: 0, armor: 0});
  m.damage(b, 999, a);
  assert.equal(a.ladder, 2, 'a player two rungs behind the leader gains a bonus rung');
  assert.ok(m.events.some(e => e.type === 'armsrace-promote' && e.actor === a.id && e.bonus === true), 'promotion is labelled as a catch-up bonus');

  a.ladder = WEAPONS.length - 3; a.weapon = a.ladder;
  b.ladder = WEAPONS.length - 1; b.weapon = b.ladder;
  Object.assign(b, {health: 1, protection: 0, armor: 0});
  m.damage(b, 999, a);
  assert.equal(a.ladder, WEAPONS.length - 1, 'the bonus clamps to the final rung');
  assert.equal(a.weapon, WEAPONS.length - 1);
  assert.equal(m.over, false, 'a clamped bonus still leaves the final kill to win');
});

test('arms race ignores weapon pickups so the ladder stays authoritative', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'proving-grounds', {mode: 'armsrace', botCount: 0, humanCount: 1, timeLimit: 60});
  const a = m.actors[0];
  assert.equal(a.weapon, 0);
  m.collect(a, {kind: 'rocket', x: a.x, z: a.z, y: a.y, wait: 0});
  assert.equal(a.weapon, 0, 'pickup does not switch the arms race weapon');
});

test('bounty frags cannot end an arms race before the ladder finishes', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'proving-grounds', {mode: 'armsrace', botCount: 0, humanCount: 2, bounty: true, timeLimit: 120});
  const [a, b] = m.actors;
  for (let i = 0; i < 5; i++) { Object.assign(b, {health: 1, streak: 4, protection: 0, armor: 0}); m.damage(b, 999, a); }
  assert.equal(m.over, false, 'bounty frags must not win arms race');
  assert.ok(a.ladder >= 5);
});
