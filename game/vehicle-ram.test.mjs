// Stretch fieldwork: deterministic vehicle-vs-vehicle contact. Slow contact
// separates position-only and harmless; above the closing-speed floor both
// hulls take mass-scaled damage and one `vehicle-ram` beat fires per pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {PUMA, TITAN, SCOUT, createVehicle} from './vehicles.mjs';

const rig = () => new Match('chatgpt', 'hermes', () => .5, 'blood-gulch', {mode: 'deathmatch', botCount: 0, respawn: 1});
const pair = (m, first, second) => {
  const a = m.vehicles[0], b = createVehicle(second);
  b.id = `ram-${second.id}`; b.kind = second.id;
  m.vehicles = [a, b];
  Object.assign(a.position, {x: 0, y: 20, z: 0});
  Object.assign(b.position, {x: first, y: 20, z: 0});
  a.velocity = {x: 0, z: 0}; b.velocity = {x: 0, z: 0};
  a.health = a.maxHealth; b.health = b.maxHealth;
  return [a, b];
};
const gap = (a, b) => Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);

test('slow chassis contact separates position-only without damage or a ram beat', () => {
  const m = rig(), [a, b] = pair(m, 1.9, PUMA);
  assert.equal(m.resolveVehicleRams(1 / 60), 0);
  assert.ok(gap(a, b) >= 2.1 - 1e-6, `overlap separated (${gap(a, b)})`);
  assert.equal(a.health, a.maxHealth);
  assert.equal(b.health, b.maxHealth);
  assert.equal(m.events.some(event => event.type === 'vehicle-ram'), false);
});

test('a slow driver pressing into a parked hull stays harmless across frames', () => {
  const m = rig(), [a, b] = pair(m, 2.0, PUMA);
  a.heading = Math.PI / 2;
  a.velocity = {x: 3, z: 0};
  for (let i = 0; i < 30; i++) m.step(1 / 60, {inputs: {}});
  assert.equal(m.events.some(event => event.type === 'vehicle-ram'), false, 'below the speed floor never rams');
  assert.equal(a.health, a.maxHealth);
  assert.equal(b.health, b.maxHealth);
  assert.ok(gap(a, b) >= 2.05, `the pair never interpenetrates (${gap(a, b)})`);
});

test('a fast ram damages both hulls, emits once per pair cooldown and scales by mass', () => {
  const m = rig(), [a, b] = pair(m, 2.4, TITAN);
  a.velocity = {x: 12, z: 0};
  const aBefore = a.health, bBefore = b.health;
  assert.equal(m.resolveVehicleRams(1 / 60), 1);
  const massA = 2.1 * 3.6, massB = 3.0 * 5.4, total = massA + massB, impact = (12 - 6) * 1.2;
  assert.ok(Math.abs((aBefore - a.health) - impact * (massB / total)) < 1e-9, `light chassis takes the larger share (${aBefore - a.health})`);
  assert.ok(Math.abs((bBefore - b.health) - impact * (massA / total)) < 1e-9, `heavy chassis takes the smaller share (${bBefore - b.health})`);
  const ram = m.events.find(event => event.type === 'vehicle-ram');
  assert.equal(ram.a, a.id);
  assert.equal(ram.b, b.id);
  assert.ok(Math.abs(ram.speed - 12) < 1e-9);
  assert.ok(Number.isFinite(ram.x) && Number.isFinite(ram.z));
  assert.equal(m.resolveVehicleRams(1 / 60), 0, 'the cooldown blocks a repeat beat');
  assert.equal(a.health, aBefore - impact * (massB / total), 'no second hit inside the cooldown');
  m.time += .5;
  b.position.x = a.position.x + 2.4;
  assert.equal(m.resolveVehicleRams(1 / 60), 1, 'the cooldown re-arms');
});

test('the heavier chassis is pushed less than the lighter one', () => {
  const m = rig(), a = m.vehicles[0], b = createVehicle(SCOUT);
  b.id = 'ram-scout'; b.kind = 'scout';
  m.vehicles = [a, b];
  Object.assign(a.position, {x: 0, y: 7, z: 0});
  Object.assign(b.position, {x: 1.5, y: 7, z: 0});
  a.velocity = {x: 0, z: 0}; b.velocity = {x: 0, z: 0};
  m.vehicleCollision = next => ({...next});
  const aBefore = a.position.x, bBefore = b.position.x;
  m.resolveVehicleRams(1 / 60);
  const movedA = Math.abs(a.position.x - aBefore), movedB = Math.abs(b.position.x - bBefore);
  assert.ok(movedB > movedA * 2.5, `scout moved ${movedB}, puma moved ${movedA}`);
  assert.ok(gap(a, b) >= 1.6 - 1e-6, `separated (${gap(a, b)})`);
});

test('a wedged chassis is never pushed through rejected geometry', () => {
  const m = rig(), [a, b] = pair(m, 1.8, PUMA);
  m.vehicleCollision = () => false;
  const before = {...a.position}, other = {...b.position};
  m.resolveVehicleRams(1 / 60);
  assert.deepEqual(a.position, before);
  assert.deepEqual(b.position, other);
});

test('the match step loop resolves a real high-speed ram between two Pumas', () => {
  const m = rig(), [a, b] = pair(m, 2.2, PUMA);
  a.heading = Math.PI / 2;
  a.velocity = {x: 14, z: 0};
  const aBefore = a.health, bBefore = b.health;
  m.step(1 / 60, {inputs: {}});
  assert.ok(a.health < aBefore && b.health < bBefore, `both hulls took the ram (${a.health}/${b.health})`);
  assert.ok(m.events.some(event => event.type === 'vehicle-ram'));
  assert.ok(gap(a, b) >= 2.1 - 1e-6, `separated after the ram (${gap(a, b)})`);
  for (let i = 0; i < 8; i++) m.step(1 / 60, {inputs: {}});
  assert.equal(m.events.filter(event => event.type === 'vehicle-ram').length, 1, 'one beat per cooldown window');
});
