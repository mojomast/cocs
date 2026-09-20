import test from 'node:test';
import assert from 'node:assert/strict';
import { GUNTRUCK, PUMA, HORNET, TITAN, SCOUT, TRANSPORT, VEHICLE_TYPES, VEHICLE_KIND_IDS, VEHICLE_WEAKPOINT, VEHICLE_DISMOUNT, VEHICLE_PASSENGER_FIRE, createVehicle, respawnVehicle, stepVehicle, vehicleCanEnter, vehicleMuzzles, vehicleMuzzleCount, vehicleStats, vehicleCapacity, vehicleSeatFor, vehicleWeakPointMultiplier, vehicleDismountStun, passengerFireScale } from './vehicles.mjs';

const flat = () => ({ y: 0, normal: { x: 0, y: 1, z: 0 } });
const lateralOf = vehicle => vehicle.velocity.x * Math.cos(vehicle.heading) - vehicle.velocity.z * Math.sin(vehicle.heading);

test('config is frozen and runtime vehicles are independent clones', () => {
  assert.equal(PUMA.name, 'Puma');
  assert.equal(PUMA.id, 'puma');
  assert.equal(PUMA.kind, 'puma');
  assert.ok(PUMA.mountedChaingun && Number.isFinite(PUMA.mountedChaingun.heatPerShot));
  assert.ok(Object.isFrozen(GUNTRUCK));
  assert.ok(Object.isFrozen(GUNTRUCK.mountedChaingun));
  const a = createVehicle();
  const b = createVehicle();
  a.position.x = 4;
  a.heat = 0.5;
  assert.equal(b.position.x, 0);
  assert.equal(b.heat, 0);
});

test('createVehicle seeds the arcade dynamics fields', () => {
  const vehicle = createVehicle();
  assert.equal(vehicle.turretYaw, 0);
  assert.equal(vehicle.roll, 0);
  assert.equal(vehicle.pitchBody, 0);
  assert.equal(vehicle.speed, 0);
  assert.equal(vehicle.grounded, true);
  assert.equal(vehicle.handbrake, false);
});

test('only an unoccupied neutral truck accepts a living actor', () => {
  const vehicle = createVehicle();
  const actor = { health: 100, vehicle: null };
  assert.equal(vehicleCanEnter(vehicle, actor), true);
  vehicle.driver = actor;
  assert.equal(vehicleCanEnter(vehicle, { health: 100, vehicle: null }), false);
  vehicle.driver = null;
  actor.vehicle = vehicle;
  assert.equal(vehicleCanEnter(vehicle, actor), false);
});

test('reaches near top speed on flat ground and stops when blocked', () => {
  const vehicle = createVehicle();
  for (let i = 0; i < 600; i++) stepVehicle(vehicle, { throttle: 1 }, 1 / 60, next => next, flat);
  assert.ok(vehicle.speed > GUNTRUCK.speed - 1, `expected near top speed, got ${vehicle.speed}`);
  assert.ok(vehicle.speed <= GUNTRUCK.speed + 1e-6);
  assert.ok(Math.hypot(vehicle.velocity.x, vehicle.velocity.z) <= GUNTRUCK.speed + 1e-6);
  const before = { ...vehicle.position };
  stepVehicle(vehicle, { throttle: 1 }, 1 / 60, () => false, flat);
  assert.deepEqual(vehicle.position, before);
  assert.equal(vehicle.speed, 0);
  assert.equal(vehicle.velocity.x, 0);
  assert.equal(vehicle.velocity.z, 0);
});

test('handbrake increases lateral slip and rotation over normal turning', () => {
  const slide = handbrake => {
    const vehicle = createVehicle();
    vehicle.velocity = { x: 6, z: 10 };
    for (let i = 0; i < 30; i++) stepVehicle(vehicle, { brake: handbrake }, 1 / 60, next => next);
    return lateralOf(vehicle);
  };
  const normalSlip = slide(false);
  const handbrakeSlip = slide(true);
  assert.ok(Math.abs(handbrakeSlip) > Math.abs(normalSlip) + 0.5, `${handbrakeSlip} vs ${normalSlip}`);

  const rotate = handbrake => {
    const vehicle = createVehicle();
    vehicle.velocity = { x: 0, z: 12 };
    for (let i = 0; i < 10; i++) stepVehicle(vehicle, { steer: 1, brake: handbrake }, 1 / 60, next => next);
    return vehicle.heading;
  };
  assert.ok(rotate(true) > rotate(false));
});

test('driving up a slope raises the body and pitches the nose up', () => {
  const vehicle = createVehicle();
  vehicle.heading = Math.PI / 2;
  const slope = x => ({ y: x * 0.4, normal: { x: -0.3714, y: 0.9285, z: 0 } });
  for (let i = 0; i < 90; i++) stepVehicle(vehicle, { throttle: 1 }, 1 / 60, next => next, slope);
  assert.ok(vehicle.position.x > 1, `x ${vehicle.position.x}`);
  assert.ok(vehicle.position.y > 0.1, `y ${vehicle.position.y}`);
  assert.ok(vehicle.pitchBody > 0, `pitch ${vehicle.pitchBody}`);
  assert.ok(Math.abs(vehicle.pitchBody) <= GUNTRUCK.pitchMax + 1e-9);
});

test('suspension follows numeric ground heights and flags airborne bodies', () => {
  const vehicle = createVehicle();
  const ramp = x => Math.max(0, x) * 0.5;
  for (let i = 0; i < 60; i++) stepVehicle(vehicle, { throttle: 1 }, 1 / 60, next => next, ramp);
  assert.ok(vehicle.position.y > 0);
  assert.equal(vehicle.grounded, true);
  vehicle.position.y = 10;
  stepVehicle(vehicle, { throttle: 1 }, 1 / 60, next => next, ramp);
  assert.equal(vehicle.grounded, false);
});

test('turretYaw traverses toward a target at a bounded rate', () => {
  const vehicle = createVehicle();
  stepVehicle(vehicle, { turretYaw: 1.5 }, 1 / 60);
  assert.ok(vehicle.turretYaw > 0);
  assert.ok(vehicle.turretYaw <= GUNTRUCK.traverseRate / 60 + 1e-9);
  for (let i = 0; i < 120; i++) stepVehicle(vehicle, { turretYaw: 1.5 }, 1 / 60);
  assert.ok(Math.abs(vehicle.turretYaw - 1.5) < 1e-6);
  const held = vehicle.turretYaw;
  stepVehicle(vehicle, {}, 1 / 60);
  assert.equal(vehicle.turretYaw, held);
});

test('vehicleMuzzles returns paired turret muzzles carrying turret heading', () => {
  const vehicle = createVehicle();
  vehicle.heading = 0.7;
  vehicle.turretYaw = 0.5;
  const muzzles = vehicleMuzzles(vehicle);
  assert.equal(muzzles.length, 2);
  assert.equal(muzzles[0].heading, vehicle.heading + vehicle.turretYaw);
  assert.equal(muzzles[1].heading, vehicle.heading + vehicle.turretYaw);
  assert.notEqual(muzzles[0].x, muzzles[1].x);
  assert.notEqual(muzzles[0].z, muzzles[1].z);
});

test('collision-resolved terrain height follows slopes and blocked moves preserve position', () => {
  const vehicle = createVehicle();
  stepVehicle(vehicle, { throttle: 1 }, 1 / 60, next => ({ ...next, y: 3 }));
  assert.equal(vehicle.position.y, 3);
  stepVehicle(vehicle, { throttle: 1 }, 1 / 60, next => ({ ...next, y: 1 }));
  assert.equal(vehicle.position.y, 1);
  const before = { ...vehicle.position };
  stepVehicle(vehicle, { throttle: 1 }, 1 / 60, () => false);
  assert.deepEqual(vehicle.position, before);
});

test('muzzles remain paired and mounted on distinct sides', () => {
  const vehicle = createVehicle();
  vehicle.position = { x: 10, y: 2, z: 8 };
  vehicle.heading = Math.PI / 2;
  const muzzles = vehicleMuzzles(vehicle);
  assert.equal(muzzles.length, 2);
  assert.notEqual(muzzles[0].z, muzzles[1].z);
  assert.ok(Math.abs(muzzles[0].y - 3.18) < 1e-9);
  assert.equal(muzzles[0].heading, vehicle.heading);
});

test('chaingun alternates muzzles and fires continuously without overheating', () => {
  const vehicle = createVehicle();
  stepVehicle(vehicle, { fire: true }, 0.01);
  assert.equal(vehicle.lastStep.fired, true);
  assert.equal(vehicle.lastStep.muzzle, 0);
  assert.deepEqual(vehicle.lastStep.muzzles, [0, 1]);
  let fired = 0;
  for (let i = 0; i < 40; i++) { stepVehicle(vehicle, { fire: true }, 0.045); if (vehicle.lastStep.fired) fired++; }
  assert.ok(fired >= 39, `kept firing (${fired}/40)`);
  assert.equal(vehicle.heat, 0);
  assert.equal(vehicle.overheated, false);
});

test('respawnVehicle restores clean spawn state including arcade fields', () => {
  const vehicle = createVehicle();
  vehicle.health = 0;
  vehicle.respawnTimer = GUNTRUCK.respawn;
  vehicle.driver = { id: 1 };
  vehicle.heat = 1;
  vehicle.turretYaw = 1;
  vehicle.roll = 0.2;
  vehicle.pitchBody = -0.2;
  vehicle.speed = 12;
  vehicle.grounded = false;
  vehicle.handbrake = true;
  vehicle.boostTimer = 1;
  vehicle.boostCooldown = 2;
  respawnVehicle(vehicle, { x: 3, y: 1, z: -2 }, 1.5);
  assert.deepEqual(vehicle.position, { x: 3, y: 1, z: -2 });
  assert.equal(vehicle.health, GUNTRUCK.health);
  assert.equal(vehicle.respawnTimer, 0);
  assert.equal(vehicle.heat, 0);
  assert.deepEqual(vehicle.velocity, { x: 0, z: 0 });
  assert.equal(vehicle.turretYaw, 0);
  assert.equal(vehicle.roll, 0);
  assert.equal(vehicle.pitchBody, 0);
  assert.equal(vehicle.speed, 0);
  assert.equal(vehicle.grounded, true);
  assert.equal(vehicle.handbrake, false);
  assert.equal(vehicle.boostTimer, 0);
  assert.equal(vehicle.boostCooldown, 0);
});
test('driver harness skills scale top speed, boost and turret traverse', () => {
  const stock = createVehicle(), fast = createVehicle();
  for (let i = 0; i < 180; i++) { stepVehicle(stock, { throttle: 1 }, 1 / 60, next => next, flat); stepVehicle(fast, { throttle: 1, speedScale: 1.15 }, 1 / 60, next => next, flat); }
  assert.ok(Math.hypot(fast.velocity.x, fast.velocity.z) > Math.hypot(stock.velocity.x, stock.velocity.z), 'speedScale should raise top speed');
  const boost = createVehicle(), nitro = createVehicle();
  for (let i = 0; i < 90; i++) { stepVehicle(boost, { throttle: 1, boost: true }, 1 / 60, next => next, flat); stepVehicle(nitro, { throttle: 1, boost: true, boostScale: 1.6 }, 1 / 60, next => next, flat); }
  assert.ok(Math.hypot(nitro.velocity.x, nitro.velocity.z) > Math.hypot(boost.velocity.x, boost.velocity.z), 'boostScale should raise boost speed');
  const slow = createVehicle(), quick = createVehicle();
  stepVehicle(slow, { turretYaw: 2 }, 1 / 60); stepVehicle(quick, { turretYaw: 2, traverseScale: 1.5 }, 1 / 60);
  stepVehicle(slow, { turretYaw: 2 }, 1 / 60); stepVehicle(quick, { turretYaw: 2, traverseScale: 1.5 }, 1 / 60);
  assert.ok(quick.turretYaw > slow.turretYaw, 'traverseScale should speed turret rotation');
});

test('the roster exposes five distinct frozen chassis with stable ids', () => {
  assert.deepEqual(VEHICLE_KIND_IDS, ['puma', 'hornet', 'titan', 'scout', 'transport']);
  assert.equal(VEHICLE_TYPES.length, 5);
  assert.ok(VEHICLE_TYPES.every(Object.isFrozen));
  for (const vehicle of [TITAN, SCOUT, TRANSPORT]) {
    assert.ok(vehicle.mountedChaingun && Number.isFinite(vehicle.mountedChaingun.damage));
    assert.ok(vehicle.dimensions.length > 0 && vehicle.dimensions.width > 0);
    assert.ok(vehicle.health > 0 && vehicle.speed > 0);
  }
  assert.equal(TITAN.class, 'heavy');
  assert.equal(SCOUT.class, 'light');
  assert.equal(TRANSPORT.class, 'transport');
});

test('heavy, light and transport chassis handle distinctly on flat ground', () => {
  const run = template => {
    const vehicle = createVehicle(template);
    for (let i = 0; i < 600; i++) stepVehicle(vehicle, { throttle: 1 }, 1 / 60, next => next, flat);
    return vehicle.speed;
  };
  const titan = run(TITAN), scout = run(SCOUT), transport = run(TRANSPORT), puma = run(PUMA);
  assert.ok(scout > puma, `scout ${scout} should outrun puma ${puma}`);
  assert.ok(puma > transport, `puma ${puma} should outrun transport ${transport}`);
  assert.ok(transport > titan, `transport ${transport} should outrun titan ${titan}`);
  const heavy = createVehicle(TITAN), light = createVehicle(SCOUT);
  for (let i = 0; i < 60; i++) { stepVehicle(heavy, { steer: 1 }, 1 / 60, next => next, flat); stepVehicle(light, { steer: 1 }, 1 / 60, next => next, flat); }
  assert.ok(Math.abs(light.heading) > Math.abs(heavy.heading), 'the scout turns faster than the titan');
});

test('mounted weapons are type-aware: barrels, damage and overheat differ', () => {
  assert.equal(vehicleMuzzleCount(createVehicle(PUMA)), 2);
  assert.equal(vehicleMuzzleCount(createVehicle(TITAN)), 1);
  assert.equal(vehicleMuzzleCount(createVehicle(SCOUT)), 1);
  assert.equal(vehicleMuzzleCount(createVehicle(TRANSPORT)), 2);
  const titan = createVehicle(TITAN);
  stepVehicle(titan, { fire: true }, 0.01);
  assert.deepEqual(titan.lastStep.muzzles, [0]);
  assert.equal(titan.lastStep.muzzle, 0);
  assert.ok(titan.heat > 0, 'the cannon builds heat');
  for (let i = 0; i < 2; i++) stepVehicle(titan, { fire: true }, 0.9);
  assert.equal(titan.overheated, true, 'sustained cannon fire overheats');
  const scout = createVehicle(SCOUT);
  for (let i = 0; i < 30; i++) stepVehicle(scout, { fire: true }, 0.06);
  assert.equal(scout.overheated, false, 'the light gun never overheats');
  assert.equal(scout.heat, 0);
});

test('transport carries six seats and the scout carries two', () => {
  const transport = createVehicle(TRANSPORT), scout = createVehicle(SCOUT);
  assert.equal(vehicleCapacity(transport), 6);
  assert.equal(vehicleCapacity(scout), 2);
  assert.equal(vehicleSeatFor(transport).role, 'driver');
  transport.driver = 1;
  assert.equal(vehicleSeatFor(transport).role, 'gunner');
  transport.gunner = 2;
  assert.equal(vehicleSeatFor(transport).role, 'passenger');
  scout.driver = 1;
  assert.equal(vehicleSeatFor(scout).role, 'passenger');
});

test('vehicleStats summarizes each chassis without throwing', () => {
  const stats = vehicleStats(createVehicle(TITAN));
  assert.equal(stats.id, 'titan');
  assert.equal(stats.class, 'heavy');
  assert.equal(stats.capacity, 3);
  assert.equal(stats.weapon, 'mounted-cannon');
  assert.equal(stats.barrels, 1);
  assert.ok(Object.isFrozen(stats));
  assert.equal(vehicleStats(createVehicle(HORNET)).flight, true);
});

test('respawn resets the barrel count for every chassis', () => {
  const vehicle = createVehicle(TRANSPORT);
  vehicle.muzzleIndex = 1;
  respawnVehicle(vehicle);
  assert.equal(vehicle.muzzleIndex, 0);
  assert.equal(vehicle.barrelCount, 2);
  assert.equal(createVehicle(TITAN).barrelCount, 1);
});

test('every new chassis is placed on maps that can actually use it', async () => {
 const {MAPS} = await import('./maps.mjs');
 const known = new Set(VEHICLE_KIND_IDS);
 for (const arena of MAPS) for (const vehicle of arena.vehicles || []) {
  assert.ok(known.has(vehicle.kind || 'puma'), `${arena.id} uses a known chassis (${vehicle.kind})`);
 }
 for (const kind of ['titan', 'scout', 'transport']) {
  const hosts = MAPS.filter(arena => (arena.vehicles || []).some(vehicle => (vehicle.kind || 'puma') === kind));
  assert.ok(hosts.length >= 3, `${kind} should be reachable on several maps (${hosts.length})`);
 }
});

test('weak-point bearing pays rear and flank premiums but never for splash callers', () => {
  const vehicle = createVehicle();
  vehicle.heading = 0; // forward is +z at heading 0
  vehicle.position = { x: 0, y: 0, z: 0 };
  assert.equal(vehicleWeakPointMultiplier(vehicle, { from: { x: 0, z: -6 } }), VEHICLE_WEAKPOINT.rear);
  assert.equal(vehicleWeakPointMultiplier(vehicle, { from: { x: 6, z: 0 } }), VEHICLE_WEAKPOINT.flank);
  assert.equal(vehicleWeakPointMultiplier(vehicle, { from: { x: 0, z: 6 } }), 1);
  assert.equal(vehicleWeakPointMultiplier(vehicle), 1, 'splash and old call sites stay neutral');
  assert.equal(vehicleWeakPointMultiplier(vehicle, { bearing: Math.PI }), VEHICLE_WEAKPOINT.rear);
  assert.equal(vehicleWeakPointMultiplier(vehicle, { bearing: Math.PI / 2 }), VEHICLE_WEAKPOINT.flank);
  assert.equal(vehicleWeakPointMultiplier(vehicle, { bearing: 0 }), 1);
  assert.equal(vehicleWeakPointMultiplier(vehicle, { from: { x: 0, z: 0 } }), 1, 'a co-located attacker has no bearing');
  assert.ok(VEHICLE_WEAKPOINT.rear > VEHICLE_WEAKPOINT.flank && VEHICLE_WEAKPOINT.flank > 1);
});

test('dismount stun scales with exit speed, ignores respawns and counts flight vertical speed', () => {
  const ground = createVehicle();
  ground.velocity = { x: 0, z: VEHICLE_DISMOUNT.maxSpeed };
  const maxed = vehicleDismountStun(ground, 'exit');
  assert.equal(maxed.duration, VEHICLE_DISMOUNT.maxDuration);
  assert.equal(maxed.multiplier, VEHICLE_DISMOUNT.slowMultiplier);
  ground.velocity = { x: 0, z: VEHICLE_DISMOUNT.minSpeed };
  assert.equal(vehicleDismountStun(ground, 'exit').duration, VEHICLE_DISMOUNT.minDuration);
  ground.velocity = { x: 0, z: VEHICLE_DISMOUNT.minSpeed - 1 };
  assert.deepEqual(vehicleDismountStun(ground, 'exit'), { duration: 0, multiplier: 1 });
  ground.velocity = { x: VEHICLE_DISMOUNT.maxSpeed, z: 0 };
  assert.deepEqual(vehicleDismountStun(ground, 'respawn'), { duration: 0, multiplier: 1 }, 'respawn never stuns');
  const flight = createVehicle(HORNET);
  flight.velocity = { x: 0, z: 0 };
  flight.vy = 12;
  assert.ok(vehicleDismountStun(flight, 'exit').duration >= VEHICLE_DISMOUNT.minDuration, 'flight counts vertical speed');
  assert.ok(vehicleDismountStun(flight, 'exit').duration <= VEHICLE_DISMOUNT.maxDuration);
});

test('passenger personal fire pays a bounded scale that no other seat pays', () => {
  const foot = { vehicleId: null, vehicleSeat: null };
  const driver = { vehicleId: 1, vehicleSeat: 'driver' };
  const gunner = { vehicleId: 1, vehicleSeat: 'gunner' };
  const passenger = { vehicleId: 1, vehicleSeat: 'passenger' };
  assert.equal(passengerFireScale(passenger), VEHICLE_PASSENGER_FIRE);
  assert.equal(passengerFireScale(foot).spread, 1);
  assert.equal(passengerFireScale(driver).recoil, 1);
  assert.equal(passengerFireScale(gunner).spread, 1);
  assert.ok(VEHICLE_PASSENGER_FIRE.spread > 1 && VEHICLE_PASSENGER_FIRE.recoil > 1);
  assert.ok(Object.isFrozen(VEHICLE_WEAKPOINT) && Object.isFrozen(VEHICLE_DISMOUNT) && Object.isFrozen(VEHICLE_PASSENGER_FIRE));
});
