import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {actorWon} from './outcome.mjs';
import {WEAPONS} from './data.mjs';

const openDeathmatch = (botCount = 0) => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'exchange', {mode: 'deathmatch', humanCount: 1, botCount});
  m.arena = {blocks: [], bounds: {minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000}};
  m.pickups = []; m.vehicles = [];
  return m;
};

test('BUG-2 bots execute melee through the step controls path', () => {
  const m = openDeathmatch(1);
  const [human, bot] = m.actors;
  Object.assign(human, {x: 0, y: 0, z: -1.2, health: 100, armor: 0, protection: 0, dead: 0});
  Object.assign(bot, {x: 0, y: 0, z: 0, yaw: 0, pitch: 0, melee: 0, protection: 0, weapon: 0});
  bot.ammo[0] = Infinity;
  m.step(1 / 60);
  assert.ok(m.events.some(e => e.type === 'melee' && e.actor === bot.id && e.hit === human.id), 'bot melee emitted a hit');
  assert.ok(human.health < 100, 'bot melee damaged the target');
});

test('BUG-3 an arms race finisher wins even when trailing on frags', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'proving-grounds', {mode: 'armsrace', botCount: 0, humanCount: 2, timeLimit: 120});
  const [finisher, other] = m.actors;
  finisher.ladder = WEAPONS.length - 1; finisher.frags = 2;
  other.ladder = WEAPONS.length - 1; other.frags = 9;
  m.advanceLadder(finisher);
  const state = m.snapshot();
  assert.equal(m.over, true);
  assert.equal(state.winner, finisher.id, 'snapshot credits the finisher');
  assert.equal(m.leaders()[0]?.id, finisher.id, 'leaders prefer the finisher');
  assert.equal(actorWon(state, 'armsrace', state.actors.find(a => a.id === finisher.id)), true);
  assert.equal(actorWon(state, 'armsrace', state.actors.find(a => a.id === other.id)), false);
});

test('SIM-F4 interact without a vehicle does not eat a movement tick', () => {
  const travel = interact => {
    const m = openDeathmatch(0);
    const a = m.actors[0];
    Object.assign(a, {x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, protection: 0, health: 100});
    m.step(1 / 60, {inputs: {0: {x: 0, z: -1, interact}}});
    return Math.hypot(a.x, a.z);
  };
  const plain = travel(false), interacting = travel(true);
  assert.ok(plain > 0.001, 'plain forward input moves the actor');
  assert.ok(interacting > 0.001, 'interact with no vehicle still moves the actor');
  assert.ok(Math.abs(plain - interacting) < 1e-6, 'movement matches the non-interact tick');
});

test('SIM-F7 self-inflicted lethal damage does not count as a kill', () => {
  const m = openDeathmatch(0);
  const a = m.actors[0];
  Object.assign(a, {health: 50, armor: 0, protection: 0});
  const before = m.stats.kills;
  m.damage(a, 1000, a);
  assert.equal(a.health, 0);
  assert.equal(m.stats.kills, before);
});

test('SIM-F8 the void kill-feed entry carries the match time', () => {
  const m = openDeathmatch(0);
  const a = m.actors[0];
  Object.assign(a, {health: 100, dead: 0});
  m.time = 12.5;
  m.fall(a);
  const entry = m.feed[0];
  assert.equal(entry.killer, 'The void');
  assert.ok(Number.isFinite(entry.time), 'fall feed entry has a finite time');
  assert.equal(entry.time, m.time);
});
