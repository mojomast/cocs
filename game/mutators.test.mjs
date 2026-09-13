import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {normalizeConfig} from './config.mjs';

const seeded = (n = 31) => { let a = n; return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296); };

test('one-shot makes any unprotected hit lethal', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 2, oneShot: true, timeLimit: 60});
  const [a, b] = m.actors;
  Object.assign(b, {health: 100, protection: 0, armor: 0});
  m.damage(b, 1, a);
  assert.ok(b.health <= 0 || b.deaths > 0, 'a single point of damage is lethal under one-shot');
});

test('random loadout grants a valid spawn weapon with ammunition', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 1, randomLoadout: true, timeLimit: 60});
  const a = m.actors[0];
  for (let i = 0; i < 6; i++) {
    assert.ok(Number.isInteger(a.weapon) && a.weapon >= 0 && a.weapon < 10, 'weapon index is valid');
    assert.ok(a.ammo[a.weapon] > 0 || a.ammo[a.weapon] === Infinity, 'spawn weapon has ammo');
    m.spawn(a);
  }
});

test('config normalizes the new mutators and defaults them off', () => {
  const on = normalizeConfig({randomLoadout: true, oneShot: true});
  assert.equal(on.randomLoadout, true);
  assert.equal(on.oneShot, true);
  const off = normalizeConfig({});
  assert.equal(off.randomLoadout, false);
  assert.equal(off.oneShot, false);
});

test('bounty heals and bonuses killing a hot streak', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 2, bounty: true, timeLimit: 60});
  const [a, b] = m.actors;
  Object.assign(a, {health: 40, protection: 0});
  Object.assign(b, {health: 1, streak: 4, protection: 0, armor: 0});
  const frags = a.frags;
  m.damage(b, 999, a);
  assert.ok(a.health > 40, 'bounty heals the killer');
  assert.equal(a.frags, frags + 2, 'the kill plus the bounty frag');
  assert.ok(m.events.some(e => e.type === 'bounty' && e.actor === a.id));
});

test('berserk boosts damage at a three kill streak', () => {
  const base = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 2, timeLimit: 60});
  const [ba, bb] = base.actors;
  Object.assign(bb, {health: 100, armor: 0, protection: 0});
  base.damage(bb, 20, ba);
  const normal = 100 - bb.health;
  const zerk = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 2, berserk: true, timeLimit: 60});
  const [za, zb] = zerk.actors;
  za.streak = 3;
  Object.assign(zb, {health: 100, armor: 0, protection: 0});
  zerk.damage(zb, 20, za);
  const boosted = 100 - zb.health;
  assert.ok(boosted > normal, `berserk increases damage (${normal} -> ${boosted})`);
});

test('random loadout with unlimited ammo spawns a usable infinite gun', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 1, randomLoadout: true, unlimitedAmmo: true, timeLimit: 60});
  const a = m.actors[0];
  assert.equal(a.ammo[a.weapon], Infinity, 'random weapon has infinite ammo');
  a.shotWait = 0;
  assert.equal(m.fire(a), true, 'the random weapon can fire');
});
