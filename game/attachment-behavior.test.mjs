import assert from 'node:assert/strict';
import test from 'node:test';
import {Match} from './core.mjs';

const rig = (attachments) => new Match('chatgpt', 'openclaw', () => .5, 'exchange', {mode: 'deathmatch', botCount: 0, loadouts: {0: {character: 'chatgpt', harness: 'openclaw', attachments}}});
test('a burst module keeps firing after the initial trigger pull', () => {
  const m = rig({underbarrel: 'burst-module'}), a = m.actors[0];
  a.weapon = 0; a.ammo[0] = 50; a.shotWait = 0; a.protection = 0;
  const before = m.stats.shots;
  m.fire(a);
  assert.equal(a.burstLeft, 2);
  for (let i = 0; i < 40; i++) m.step(1 / 60, {});
  assert.ok(m.stats.shots - before >= 3, `expected a 3-round burst, got ${m.stats.shots - before}`);
});

test('attachment stat modifiers change the derived weapon', () => {
  const m = rig({barrel: 'long-barrel', magazine: 'extended-mag'}), a = m.actors[0];
  a.weapon = 0;
  const w = m.weaponFor(a);
  assert.ok(w.range > 60, `long barrel should extend range, got ${w.range}`);
  assert.ok(w.cap > 30, `extended magazine should raise capacity, got ${w.cap}`);
});

test('a charge coil holds a shot until charged then fires it boosted', () => {
  const m = rig({barrel: 'charge-coil'}), a = m.actors[0];
  a.weapon = 4; a.ammo[4] = 5; a.shotWait = 0;
  const before = m.stats.shots;
  for (let i = 0; i < 20; i++) m.step(1 / 60, {inputs: {0: {fire: true}}});
  assert.equal(m.stats.shots - before, 0, 'should not fire before the charge completes');
  for (let i = 0; i < 20; i++) m.step(1 / 60, {inputs: {0: {fire: true}}});
  assert.ok(m.stats.shots - before >= 1, 'should fire once fully charged');
  assert.ok(m.rockets[0] && m.rockets[0].damageMultiplier > 1.5, 'charged shot should carry bonus damage');
});

test('a homing beacon steers its rocket toward a nearby enemy', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'deathmatch', botCount: 0, humanCount: 2, loadouts: {0: {character: 'chatgpt', harness: 'openclaw', attachments: {underbarrel: 'homing-beacon'}}}});
  const [a, enemy] = m.actors;
  Object.assign(a, {x: 0, y: 0, z: 0, yaw: Math.PI, pitch: 0, shotWait: 0, protection: 0, weapon: 1});
  a.ammo[1] = 5;
  Object.assign(enemy, {x: 12, y: 0, z: 0, health: 100, armor: 0, protection: 0});
  m.fire(a);
  const rocket = m.rockets[0];
  assert.ok(rocket && rocket.homing > 0, 'rocket should carry homing data');
  const beforeX = rocket.dir.x;
  for (let i = 0; i < 6 && m.rockets.includes(rocket); i++) m.step(1 / 60, {});
  assert.ok(rocket.dir.x > beforeX, 'homing rocket should curve toward the enemy');
});

test('magazine attachments raise the reload ceiling and quickdraw shortens the reload', () => {
  const m = rig({magazine: 'extended-mag'}), a = m.actors[0];
  a.weapon = 3; a.ammo[3] = 39; a.shotWait = 0;
  const cap = m.weaponFor(a).cap;
  assert.equal(cap, 42);
  assert.equal(m.startReload(a, 3), true);
  assert.equal(a.reloadCap, 42);
  for (let i = 0; i < 200; i++) m.step(1 / 60, {});
  assert.equal(a.ammo[3], 42, `reload should respect the extended capacity (${a.ammo[3]})`);
  const g = rig({underbarrel: 'quickdraw-grip'}), b = g.actors[0];
  b.weapon = 3; b.ammo[3] = 10; b.shotWait = 0;
  g.startReload(b, 3);
  assert.ok(Math.abs(b.reloadDuration - 1.9 * .82) < 1e-6, `quickdraw reload ${b.reloadDuration}`);
});
