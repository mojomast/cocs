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
  let fired = false;
  for (let i = 0; i < 20 && !fired; i++) {
    m.step(1 / 60, {inputs: {0: {fire: true}}});
    fired = m.stats.shots - before >= 1;
  }
  assert.ok(fired, 'should fire once fully charged');
  // The charged projectile is only guaranteed in flight on the frame it fires:
  // at the faster launch speed it can already have impacted and despawned in
  // any later frame of this window.
  assert.ok(m.rockets[0] && m.rockets[0].damageMultiplier > 1.5, 'charged shot should carry bonus damage');
});

test('a charge-coil charged hit is clamped for every class, not just DeepSeek', () => {
  // P5-2 bug: only DEEP_COMPUTE.onShot applied the §4.7 clamp, so a non-DeepSeek
  // charge-coil hit (Shock 44 × coil 1.15 × attachment charge 2.2 ≈ 111) removed
  // a full-HP Kimi (90) in one shot. The clamp now lives at the shared fire()/
  // explode() sites via clampSingleHit.
  const m = new Match('mistral', 'openclaw', () => .5, 'exchange', {
    mode: 'deathmatch', botCount: 0, humanCount: 2,
    loadouts: {
      0: {character: 'mistral', harness: 'openclaw', attachments: {barrel: 'charge-coil'}},
      1: {character: 'kimi', harness: 'openclaw'},
    },
  });
  const [a, b] = m.actors;
  Object.assign(a, {x: 0, y: 0, z: 5, yaw: 0, pitch: 0, shotWait: 0, protection: 0, weapon: 6});
  a.ammo[6] = 5;
  Object.assign(b, {x: 0, y: 0, z: 2.5, yaw: 0, pitch: 0, protection: 0, armor: 0, health: b.maxHealth});
  assert.equal(b.maxHealth, 90, 'Kimi is the lightest full-HP target');
  assert.ok(m.weaponFor(a).chargeTime > 0, 'charge coil arms a charged shot');
  // Force the coil into its firing state without spending the charge window.
  a.charge = m.weaponFor(a).chargeTime;
  a.chargeAt = m.time;
  assert.equal(m.fire(a), true);
  assert.equal(b.health, 9, `full-HP Kimi clamps to 81 damage (${b.health} HP left)`);
  assert.ok(b.health > 0, 'a charge-coil hit cannot one-shot a full-health target');
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
