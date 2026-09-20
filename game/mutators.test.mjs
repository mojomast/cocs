import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {normalizeConfig,activeMutators,mutatorEffects,MUTATORS} from './config.mjs';

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

test('mutators compose in a deterministic order regardless of list order', () => {
  const one = normalizeConfig({mutators: ['bigHead', 'turbo', 'oneShot', 'lowGravity', 'noRecoil']});
  const two = normalizeConfig({mutators: ['noRecoil', 'lowGravity', 'oneShot', 'turbo', 'bigHead']});
  assert.deepEqual(activeMutators(one), activeMutators(two), 'the canonical order is input-order independent');
  assert.deepEqual(mutatorEffects(one), mutatorEffects(two), 'the folded effect view is input-order independent');
  assert.deepEqual(activeMutators(one), ['turbo', 'lowGravity', 'oneShot', 'bigHead', 'noRecoil']);
});

test('a mutator stack layers movement, lethality and recoil in one match', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 2, mutators: ['turbo', 'lowGravity', 'oneShot', 'noRecoil', 'bigHead'], timeLimit: 60});
  const [a, b] = m.actors;
  assert.equal(m.mutators.speedMultiplier, 1.25);
  assert.equal(m.mutators.gravityMultiplier, .4);
  assert.equal(m.mutators.oneShot, true);
  assert.equal(m.mutators.noRecoil, true);
  assert.equal(a.hitScale, 1.5);
  Object.assign(b, {health: 100, protection: 0, armor: 0});
  m.damage(b, 1, a);
  assert.ok(b.health <= 0, 'one-shot still applies inside a stack');
  const [n, c] = [m, a];
  c.weapon = 0; c.ammo[0] = Infinity; c.shotWait = 0;
  n.fire(c);
  assert.equal(c.punchPitch, 0, 'no-recoil still applies inside a stack');
  assert.equal(c.spread, 0, 'no-recoil clears bloom inside a stack');
});

test('the mutators list and explicit flags produce identical matches', () => {
  const viaList = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 2, mutators: ['oneShot', 'bigHead'], timeLimit: 60});
  const viaFlags = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 2, oneShot: true, bigHead: true, timeLimit: 60});
  assert.deepEqual(viaList.mutators, viaFlags.mutators);
  assert.equal(viaList.actors[0].hitScale, viaFlags.actors[0].hitScale);
});

test('sudden death and endless join the canonical fold append-only', () => {
  assert.deepEqual(MUTATORS.slice(-2).map(entry => entry.id), ['suddenDeath', 'endless'], 'new mutators are appended, never interleaved');
  const late = normalizeConfig({mutators: ['endless', 'suddenDeath']});
  assert.deepEqual(activeMutators(late), ['suddenDeath', 'endless'], 'the new mutators fold in catalog order');
  assert.equal(late.suddenDeath, true);
  assert.equal(late.endless, true);
  const effects = mutatorEffects(late);
  assert.equal(effects.suddenDeath, true, 'the effect view surfaces sudden death');
  assert.equal(effects.endless, true, 'the effect view surfaces endless');
  assert.deepEqual(effects.active, ['suddenDeath', 'endless']);
  const flags = normalizeConfig({suddenDeath: true, endless: true});
  assert.deepEqual(activeMutators(flags), activeMutators(late), 'list and bare flags resolve identically');
  const launch = normalizeConfig({mutators: ['noRecoil', 'lowGravity', 'oneShot', 'turbo', 'bigHead']});
  assert.deepEqual(activeMutators(launch), ['turbo', 'lowGravity', 'oneShot', 'bigHead', 'noRecoil'], 'the launch set keeps its pinned order');
});
