import assert from 'node:assert/strict';
import test from 'node:test';
import {Match} from './core.mjs';
import {vehicleSeatFor, vehicleMounted, vehicleCapacity, VEHICLE_PASSENGER_FIRE, passengerFireScale} from './vehicles.mjs';

const rig = (options = {}) => new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'ctf', botCount: 0, humanCount: 2, respawn: 1, ...options});

test('driver right turns the vehicle toward screen-right instead of inverting', () => {
  const turn = (controlX) => {
    const m = rig(), a = m.actors[0];
    Object.assign(a, {x: -46, y: 0, z: 0, grounded: true, protection: 0});
    assert.ok(m.enterVehicle(a));
    a.yaw = Math.PI;
    const before = m.vehicles[0].heading;
    for (let i = 0; i < 30; i++) m.driveVehicle(a, {x: controlX, z: 0}, 1 / 60);
    return m.vehicles[0].heading - before;
  };
  assert.ok(turn(-1) < -.1, `screen-right should turn heading negative, got ${turn(-1)}`);
  assert.ok(turn(1) > .1, `screen-left should turn heading positive, got ${turn(1)}`);
});

test('vehicles expose driver, gunner and passenger seats in order', () => {
  const m = rig(), [a, b] = m.actors;
  const vehicle = m.vehicles[0];
  assert.equal(vehicleCapacity(vehicle), 4);
  Object.assign(a, {x: -46, y: 0, z: 0, grounded: true, protection: 0});
  Object.assign(b, {x: -45.6, y: 0, z: 0, grounded: true, protection: 0});
  assert.ok(m.enterVehicle(a));
  assert.equal(a.vehicleSeat, 'driver');
  assert.ok(m.enterVehicle(b));
  assert.equal(b.vehicleSeat, 'gunner');
  assert.equal(vehicle.gunner, b.id);
  assert.deepEqual(vehicleMounted(vehicle, b.id), {role: 'gunner', index: 0});
  assert.equal(vehicleSeatFor(vehicle).role, 'passenger');
  m.releaseVehicle(b);
  assert.equal(vehicle.gunner, null);
  assert.equal(vehicleSeatFor(vehicle).role, 'gunner');
});

test('a gunner firing the mounted gun damages enemies without driving the vehicle', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'ctf', botCount: 0, humanCount: 3, respawn: 1});
  const [driver, gunner, enemy] = m.actors;
  const v = m.vehicles[0];
  Object.assign(driver, {x: -46, y: 0, z: 0, grounded: true, protection: 0});
  Object.assign(gunner, {x: -45.6, y: 0, z: 0, grounded: true, protection: 0, shotWait: 0});
  m.enterVehicle(driver);
  m.enterVehicle(gunner);
  assert.equal(gunner.vehicleSeat, 'gunner');
  Object.assign(enemy, {x: -40, y: v.position.y, z: v.position.z + .82, health: 100, armor: 0, protection: 0, grounded: true, shotWait: 999});
  const before = {x: v.position.x, z: v.position.z};
  const yaw = Math.atan2(-(enemy.x - v.position.x), -(enemy.z - v.position.z));
  const pitch = Math.asin(((enemy.y + .2) - (v.position.y + 1.18)) / Math.hypot(enemy.x - v.position.x, enemy.z - v.position.z));
  for (let i = 0; i < 90; i++) m.step(1 / 60, {inputs: {1: {fire: true, yaw, pitch}}});
  assert.ok(enemy.health < 100 || enemy.deaths > 0, 'gunner should land mounted-gun damage');
  assert.ok(Math.abs(v.position.x - before.x) < .5 && Math.abs(v.position.z - before.z) < .5, 'gunner must not move the vehicle');
});

test('a mounted driver is a valid target for enemy fire', () => {
  const m = rig(), [driver, enemy] = m.actors;
  Object.assign(driver, {x: -46, y: 0, z: 0, grounded: true, protection: 0, health: driver.maxHealth});
  assert.ok(m.enterVehicle(driver));
  const dx = driver.x - (driver.x + 6), dz = 0, dy = (driver.y + .2) - (driver.y + 1.45), len = Math.hypot(dx, dy, dz) || 1;
  Object.assign(enemy, {x: driver.x + 6, y: driver.y, z: driver.z, grounded: true, protection: 0, shotWait: 0, weapon: 0});
  enemy.yaw = Math.atan2(-dx, -dz);
  enemy.pitch = Math.asin(dy / len);
  m.fire(enemy);
  assert.ok(driver.health < driver.maxHealth, 'mounted driver should take damage');
});

test('an auto-gunner harness fires the turret when driving without a gunner', () => {
  const m = rig({botCount: 0, humanCount: 2}), [driver, enemy] = m.actors;
  Object.assign(driver, {x: -46, y: 0, z: 0, grounded: true, protection: 0});
  assert.ok(m.enterVehicle(driver));
  Object.assign(enemy, {x: -38, y: m.vehicles[0].position.y, z: 0, health: 100, armor: 0, protection: 0, grounded: true, shotWait: 999});
  for (let i = 0; i < 150; i++) m.step(1 / 60, {inputs: {0: {}}});
  assert.ok(m.events.some(event => event.type === 'vehicle-shot'), 'auto-gunner should fire the mounted gun');
  assert.ok(enemy.health < 100 || enemy.deaths > 0, 'auto-gunner shots should connect');
});

test('a gunner keeps independent aim perpendicular to the chassis', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'ctf', botCount: 0, humanCount: 3, respawn: 1});
  const [driver, gunner, enemy] = m.actors, v = m.vehicles[0];
  Object.assign(driver, {x: -46, y: 0, z: 0, grounded: true, protection: 0});
  Object.assign(gunner, {x: -45.6, y: 0, z: 0, grounded: true, protection: 0, shotWait: 0});
  assert.ok(m.enterVehicle(driver));
  assert.ok(m.enterVehicle(gunner));
  Object.assign(v.position, {x: -46, y: 0, z: 0});
  v.heading = 0; v.turretYaw = 0; v.velocity = {x: 0, z: 0};
  Object.assign(enemy, {x: -40, y: 0, z: 0, health: 200, armor: 0, protection: 0, grounded: true, shotWait: 999});
  const aimYaw = -Math.PI / 2;
  for (let i = 0; i < 40; i++) m.step(1 / 60, {inputs: {1: {fire: true, yaw: aimYaw, pitch: 0}}});
  assert.equal(gunner.yaw, aimYaw, 'the seat sync must not overwrite the gunner aim');
  assert.ok(enemy.health < 200 || enemy.deaths > 0, 'perpendicular gunner fire should connect');
});

test('seat sync still orients passengers to the chassis', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'ctf', botCount: 0, humanCount: 4, respawn: 1});
  const [driver, gunner, passenger] = m.actors, v = m.vehicles[0];
  for (const a of [driver, gunner, passenger]) Object.assign(a, {x: -46, y: 0, z: 0, grounded: true, protection: 0});
  assert.ok(m.enterVehicle(driver));
  assert.ok(m.enterVehicle(gunner));
  assert.ok(m.enterVehicle(passenger));
  assert.equal(passenger.vehicleSeat, 'passenger');
  m.syncVehicleActor(passenger, v);
  assert.equal(passenger.yaw, v.heading - Math.PI, 'passengers keep the seat yaw');
});

test('passengers fire personal weapons while the driver and gunner keep the mounted gun', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'ctf', botCount: 0, humanCount: 4, respawn: 1});
  const [driver, gunner, passenger, enemy] = m.actors, v = m.vehicles[0];
  for (const a of [driver, gunner, passenger]) Object.assign(a, {x: v.position.x, y: v.position.y, z: v.position.z, grounded: true, protection: 0, shotWait: 0, slow: 0});
  assert.ok(m.enterVehicle(driver));
  assert.ok(m.enterVehicle(gunner));
  assert.ok(m.enterVehicle(passenger));
  v.heading = Math.PI / 2; v.turretYaw = 0; v.velocity = {x: 0, z: 0};
  m.syncVehicleActor(passenger, v);
  // The seat faces the chassis forward; put the enemy on that firing line.
  const dir = {x: Math.sin(v.heading), z: Math.cos(v.heading)};
  Object.assign(enemy, {x: passenger.x + dir.x * 9, y: passenger.y, z: passenger.z + dir.z * 9, health: 600, armor: 0, protection: 0, grounded: true, shotWait: 999, team: 1});
  for (const a of [driver, gunner, passenger]) { a.team = 0; a.weapon = 0; a.ammo[0] = 200; a.reloading = false; a.weaponSwitch = 0; a.spread = 0; }
  const pitch = Math.asin(((enemy.y + .9) - (passenger.y + 1.45)) / 9);
  for (let i = 0; i < 90; i++) m.step(1 / 60, {inputs: {[driver.id]: {fire: true, yaw: -Math.PI, pitch}, [gunner.id]: {fire: true, yaw: -Math.PI, pitch}, [passenger.id]: {fire: true, pitch}}});
  assert.ok(m.events.some(event => event.type === 'shot' && event.actor === passenger.id), 'the passenger fires a personal weapon');
  assert.equal(m.events.some(event => event.type === 'shot' && (event.actor === driver.id || event.actor === gunner.id)), false, 'driver and gunner never fire a personal weapon');
  assert.ok(enemy.health < 600 || enemy.deaths > 0, 'passenger fire connects');
  assert.equal(m.fire(driver), false, 'a mounted driver cannot fire a personal weapon');
  assert.equal(m.fire(gunner), false, 'a mounted gunner cannot fire a personal weapon');
  assert.deepEqual(passengerFireScale(passenger), VEHICLE_PASSENGER_FIRE, 'the passenger pays the handling penalty');
  assert.equal(passengerFireScale(driver).spread, 1, 'the driver pays nothing');
  // Recoil evidence is deterministic: the passenger punch outruns the boot punch.
  Object.assign(passenger, {shotWait: 0, punchYaw: 0, punchPitch: 0, punchVelYaw: 0, punchVelPitch: 0});
  Object.assign(enemy, {shotWait: 0, punchYaw: 0, punchPitch: 0, punchVelYaw: 0, punchVelPitch: 0});
  assert.equal(m.fire(passenger), true);
  assert.equal(m.fire(enemy), true);
  assert.ok(passenger.punchVelPitch > enemy.punchVelPitch, `passenger kick ${passenger.punchVelPitch} > boot kick ${enemy.punchVelPitch}`);
  assert.ok(Math.abs(passenger.punchVelPitch - enemy.punchVelPitch * VEHICLE_PASSENGER_FIRE.recoil) < 1e-9, 'the kick scales by exactly the passenger recoil factor');
  // Reloading and weapon swaps suppress the personal trigger.
  passenger.shotWait = 0; passenger.reloading = true;
  assert.equal(m.fire(passenger), false, 'no passenger fire mid-reload');
  passenger.reloading = false; passenger.weaponSwitch = .2;
  assert.equal(m.fire(passenger), false, 'no passenger fire mid-swap');
});
