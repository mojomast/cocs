const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Mounted-gun tables are authored per *volley*: one trigger pull fires every
// authored barrel and the weapon step splits `damage` evenly across them, so
// the real sustained output is `damage / interval` — exactly `sustainedDps`.
// `heatPerShot` accrues once per volley; `heatPerShot > coolRate * interval`
// is what lets a long burst overheat (the chainguns used to author 0 and could
// never lock out).
const CHAINGUN = freeze({
  id: 'mounted-chaingun',
  name: 'Mounted Chaingun',
  damage: 5,
  interval: 0.045,
  sustainedDps: 111.1111111111,
  barrels: 2,
  range: 55,
  heatPerShot: 0.035,
  maxHeat: 1,
  coolRate: 0.4,
  overheatCooldown: 1.6
});

export const PUMA = freeze({
  id: 'puma',
  name: 'Puma',
  kind: 'puma',
  dimensions: { length: 3.6, width: 2.1, height: 1.7 },
  speed: 20,
  acceleration: 14,
  reverseSpeed: 6,
  brake: 22,
  drag: 0.035,
  turnRate: 1.8,
  maxSteer: 0.55,
  steerAssist: 1.4,
  steerAssistSpeed: 3,
  maxYawRate: 3.5,
  handbrakeYaw: 1.6,
  maxHandbrakeYawRate: 5,
  grip: 8,
  handbrakeGrip: 1.8,
  driftLateral: 4,
  boostSpeed: 26,
  boostAcceleration: 24,
  boostDuration: 2,
  boostCooldown: 6,
  traverseRate: 1.75,
  rollMax: 0.35,
  pitchMax: 0.35,
  suspensionRate: 12,
  bodyRate: 8,
  health: 300,
  respawn: 5,
  capacity: 4,
  seatLayout: {
    driver: { x: -0.4, y: 0.2, z: 0.05 },
    gunner: { x: 0, y: 0.55, z: -1.0 },
    passengers: [{ x: 0.4, y: 0.2, z: 0.05 }, { x: 0, y: 0.2, z: -0.7 }]
  },
  mountedChaingun: CHAINGUN,
  muzzles: [
    { x: -0.82, y: 1.18, z: 0.2 },
    { x: 0.82, y: 1.18, z: 0.2 }
  ]
});

// GUNTRUCK remains the integration name for the first vehicle chassis.
export const GUNTRUCK = PUMA;

export const HORNET = freeze({
  id: 'hornet',
  name: 'Hornet',
  kind: 'hornet',
  flight: true,
  dimensions: { length: 5.4, width: 5.2, height: 1.7 },
  speed: 36,
  acceleration: 28,
  reverseSpeed: 9,
  brake: 20,
  drag: 0.02,
  turnRadius: 9,
  maxSteer: 0.5,
  steerAssist: 1.1,
  maxYawRate: 2.4,
  grip: 3,
  boostSpeed: 54,
  boostAcceleration: 42,
  boostDuration: 2.5,
  boostCooldown: 6,
  climbRate: 16,
  maxAltitude: 58,
  hoverGravity: 14,
  hoverHeight: 1.6,
  pitchMax: 0.5,
  rollMax: 0.7,
  bodyRate: 6,
  traverseRate: 2.2,
  health: 240,
  respawn: 8,
  capacity: 3,
  seatLayout: {
    driver: { x: -0.7, y: 0.35, z: 0.35 },
    gunner: { x: 0.7, y: 0.35, z: 0.35 },
    passengers: [{ x: 0, y: 0.3, z: 1.2 }]
  },
  mountedChaingun: CHAINGUN,
  muzzles: [
    { x: -1.6, y: 0.1, z: 0.2 },
    { x: 1.6, y: 0.1, z: 0.2 }
  ]
});

const CANNON = freeze({
  id: 'mounted-cannon',
  name: 'Mounted Cannon',
  damage: 34,
  interval: 0.9,
  sustainedDps: 37.7777777778,
  barrels: 1,
  range: 70,
  heatPerShot: 0.6,
  maxHeat: 1,
  coolRate: 0.25,
  overheatCooldown: 2.5
});

const LIGHT_GUN = freeze({
  id: 'mounted-light-gun',
  name: 'Mounted Light Gun',
  damage: 3,
  interval: 0.06,
  sustainedDps: 50,
  barrels: 1,
  range: 45,
  heatPerShot: 0.042,
  maxHeat: 1,
  coolRate: 0.3,
  overheatCooldown: 1.8
});

// Heavy siege chassis: slow, heavily armoured, single high-calibre barrel.
export const TITAN = freeze({
  id: 'titan',
  name: 'Titan',
  kind: 'titan',
  class: 'heavy',
  dimensions: { length: 5.4, width: 3.0, height: 2.2 },
  speed: 13,
  acceleration: 7,
  reverseSpeed: 4,
  brake: 18,
  drag: 0.05,
  wheelBase: 4.2,
  trackWidth: 2.6,
  maxSteer: 0.38,
  steerAssist: 0.8,
  steerAssistSpeed: 2,
  maxYawRate: 1.6,
  handbrakeYaw: 1.2,
  maxHandbrakeYawRate: 2.2,
  grip: 9,
  handbrakeGrip: 2.2,
  driftLateral: 3.5,
  boostSpeed: 17,
  boostAcceleration: 12,
  boostDuration: 1.6,
  boostCooldown: 8,
  traverseRate: 1.1,
  rollMax: 0.22,
  pitchMax: 0.3,
  suspensionRate: 9,
  bodyRate: 5,
  health: 650,
  respawn: 10,
  capacity: 3,
  seatLayout: {
    driver: { x: -0.6, y: 0.3, z: 0.2 },
    gunner: { x: 0, y: 0.75, z: -1.4 },
    passengers: [{ x: 0.6, y: 0.3, z: 0.2 }]
  },
  mountedChaingun: CANNON,
  muzzles: [{ x: 0, y: 1.5, z: 1.6 }]
});

// Light recon chassis: fastest ground vehicle, fragile, single fast barrel.
export const SCOUT = freeze({
  id: 'scout',
  name: 'Scout',
  kind: 'scout',
  class: 'light',
  dimensions: { length: 2.2, width: 1.1, height: 1.3 },
  speed: 30,
  acceleration: 24,
  reverseSpeed: 8,
  brake: 26,
  drag: 0.03,
  wheelBase: 1.5,
  trackWidth: 0.9,
  maxSteer: 0.7,
  steerAssist: 2,
  steerAssistSpeed: 4,
  maxYawRate: 4.6,
  handbrakeYaw: 1.9,
  maxHandbrakeYawRate: 6.5,
  grip: 6,
  handbrakeGrip: 1.4,
  driftLateral: 5,
  boostSpeed: 40,
  boostAcceleration: 36,
  boostDuration: 2.4,
  boostCooldown: 5,
  traverseRate: 2.6,
  rollMax: 0.5,
  pitchMax: 0.4,
  suspensionRate: 14,
  bodyRate: 10,
  health: 140,
  respawn: 4,
  capacity: 2,
  seatLayout: {
    driver: { x: -0.2, y: 0.2, z: 0.1 },
    passengers: [{ x: 0.2, y: 0.2, z: -0.5 }]
  },
  mountedChaingun: LIGHT_GUN,
  muzzles: [{ x: 0, y: 0.9, z: 0.6 }]
});

// Armoured personnel carrier: six seats, defensive twin-barrel turret.
export const TRANSPORT = freeze({
  id: 'transport',
  name: 'Transport',
  kind: 'transport',
  class: 'transport',
  dimensions: { length: 6.2, width: 2.6, height: 2.4 },
  speed: 17,
  acceleration: 10,
  reverseSpeed: 6,
  brake: 20,
  drag: 0.04,
  wheelBase: 4.6,
  trackWidth: 2.2,
  maxSteer: 0.45,
  steerAssist: 1,
  steerAssistSpeed: 3,
  maxYawRate: 2,
  handbrakeYaw: 1.4,
  maxHandbrakeYawRate: 3,
  grip: 7.5,
  handbrakeGrip: 2,
  driftLateral: 3.5,
  boostSpeed: 22,
  boostAcceleration: 16,
  boostDuration: 2,
  boostCooldown: 7,
  traverseRate: 1.4,
  rollMax: 0.28,
  pitchMax: 0.32,
  suspensionRate: 10,
  bodyRate: 6,
  health: 480,
  respawn: 9,
  capacity: 6,
  seatLayout: {
    driver: { x: -0.7, y: 0.35, z: 0.2 },
    gunner: { x: 0, y: 0.8, z: -1.8 },
    passengers: [
      { x: 0.7, y: 0.35, z: 0.2 },
      { x: -0.7, y: 0.35, z: -1.2 },
      { x: 0.7, y: 0.35, z: -1.2 },
      { x: 0, y: 0.35, z: -2.4 }
    ]
  },
  mountedChaingun: CHAINGUN,
  muzzles: [
    { x: -0.7, y: 1.35, z: -0.4 },
    { x: 0.7, y: 1.35, z: -0.4 }
  ]
});

const VEHICLE_KINDS = { puma: PUMA, hornet: HORNET, titan: TITAN, scout: SCOUT, transport: TRANSPORT };
const vehicleConfig = vehicle => VEHICLE_KINDS[vehicle?.config?.kind] || VEHICLE_KINDS[vehicle?.kind] || vehicle?.config || GUNTRUCK;
export { vehicleConfig };

export const VEHICLE_TYPES = freeze([PUMA, HORNET, TITAN, SCOUT, TRANSPORT]);
export const VEHICLE_KIND_IDS = freeze(VEHICLE_TYPES.map(vehicle => vehicle.id));
// Resolves the mounted gun's barrel count without assuming the legacy pair.
export const vehicleMuzzleCount = vehicle => {
  const template = vehicleConfig(vehicle);
  const barrels = Math.round(number(template?.mountedChaingun?.barrels, 0));
  if (barrels > 0) return barrels;
  return Math.max(1, Math.round(template?.muzzles?.length || 2));
};
// Pure handling descriptor for UI/tests. `class` distinguishes the chassis roles.
export const vehicleStats = vehicle => {
  const template = vehicleConfig(vehicle);
  return freeze({
    id: template.id,
    name: template.name,
    class: template.class || 'standard',
    flight: template.flight === true,
    health: number(template.health, GUNTRUCK.health),
    speed: number(template.speed, GUNTRUCK.speed),
    acceleration: number(template.acceleration, GUNTRUCK.acceleration),
    turnRate: number(template.maxYawRate, GUNTRUCK.maxYawRate),
    capacity: 1 + (template.seatLayout?.gunner ? 1 : 0) + (template.seatLayout?.passengers?.length || 0),
    weapon: template.mountedChaingun?.id || null,
    barrels: vehicleMuzzleCount(vehicle)
  });
};

import {clamp} from './math.mjs';

const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
const approach = (value, target, amount) =>
  value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
const wrapAngle = value => {
  const tau = Math.PI * 2;
  let angle = (value + Math.PI) % tau;
  if (angle < 0) angle += tau;
  return angle - Math.PI;
};
const approachAngle = (value, target, amount) => value + clamp(wrapAngle(target - value), -amount, amount);
const normalize = vector => {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};
const readNormal = value => {
  if (Array.isArray(value)) return { x: value[0], y: value[1], z: value[2] };
  if (value && typeof value === 'object') return { x: value.x, y: value.y, z: value.z };
  return null;
};

export function createVehicle(template = PUMA) {
  const source = template || GUNTRUCK;
  const config = VEHICLE_KINDS[source.kind] || source || GUNTRUCK;
  const barrelCount = Math.max(1, Math.round(config?.mountedChaingun?.barrels || config?.muzzles?.length || 2));
  return {
    barrelCount,
    template: source.id || 'vehicle',
    config,
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    spawnYaw: 0,
    velocity: { x: 0, z: 0 },
    vy: 0,
    driver: null,
    gunner: null,
    passengers: [],
    owner: null,
    health: number(config.health, GUNTRUCK.health),
    maxHealth: number(config.health, GUNTRUCK.health),
    respawnTimer: 0,
    heat: 0,
    overheated: false,
    overheatTimer: 0,
    fireCooldown: 0,
    muzzleIndex: 0,
    turretYaw: 0,
    roll: 0,
    pitchBody: 0,
    speed: 0,
    grounded: true,
    handbrake: false,
    boostTimer: 0,
    boostCooldown: 0,
    lastStep: { fired: false, muzzle: -1 }
  };
}

export function vehicleMuzzles(vehicle) {
  const template = vehicleConfig(vehicle);
  const offsets = template?.muzzles || GUNTRUCK.muzzles;
  const heading = number(vehicle?.heading, 0) + number(vehicle?.turretYaw, 0);
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const x = number(vehicle?.position?.x, 0);
  const y = number(vehicle?.position?.y, 0);
  const z = number(vehicle?.position?.z, 0);
  return offsets.map(offset => ({
    x: x + offset.x * cos + offset.z * sin,
    y: y + offset.y,
    z: z - offset.x * sin + offset.z * cos,
    heading
  }));
}

export function vehicleCanEnter(vehicle, actor, role = 'driver') {
  if (!vehicle || !actor || vehicle.health <= 0 || vehicle.respawnTimer > 0 || actor.vehicle != null || actor.vehicleId != null || actor.health <= 0) return false;
  return vehicleSeatOpen(vehicle, role);
}

export function vehicleCapacity(vehicle) {
  const layout = vehicleConfig(vehicle)?.seatLayout || GUNTRUCK.seatLayout;
  return 1 + (layout.gunner ? 1 : 0) + (layout.passengers?.length || 0);
}

const seatOccupied = (vehicle, role, index) => {
  if (role === 'driver') return vehicle.driver != null;
  if (role === 'gunner') return vehicle.gunner != null;
  return vehicle.passengers?.[index] != null;
};

export function vehicleSeatOpen(vehicle, role = 'driver', index = 0) {
  if (!vehicle) return false;
  if (role === 'passenger') {
    const layout = vehicleConfig(vehicle)?.seatLayout || GUNTRUCK.seatLayout;
    if (index < 0 || index >= (layout.passengers?.length || 0)) return false;
  } else if (role !== 'driver' && role !== 'gunner') return false;
  if (role === 'gunner' && !(vehicleConfig(vehicle)?.seatLayout || GUNTRUCK.seatLayout).gunner) return false;
  return !seatOccupied(vehicle, role, index);
}

export function vehicleSeatFor(vehicle) {
  if (!vehicle || vehicle.health <= 0 || vehicle.respawnTimer > 0) return null;
  if (vehicleSeatOpen(vehicle, 'driver')) return { role: 'driver', index: 0 };
  if (vehicleSeatOpen(vehicle, 'gunner')) return { role: 'gunner', index: 0 };
  const layout = vehicleConfig(vehicle)?.seatLayout || GUNTRUCK.seatLayout;
  for (let index = 0; index < (layout.passengers?.length || 0); index++) if (vehicleSeatOpen(vehicle, 'passenger', index)) return { role: 'passenger', index };
  return null;
}

export function vehicleMounted(vehicle, actorId) {
  if (vehicle.driver === actorId) return { role: 'driver', index: 0 };
  if (vehicle.gunner === actorId) return { role: 'gunner', index: 0 };
  const index = vehicle.passengers?.indexOf(actorId) ?? -1;
  return index >= 0 ? { role: 'passenger', index } : null;
}

// World-space seat anchor (front of the chassis is +z at heading 0).
export function vehicleSeatPosition(vehicle, role = 'driver', index = 0) {
  const layout = vehicleConfig(vehicle)?.seatLayout || GUNTRUCK.seatLayout;
  const offset = role === 'driver' ? layout.driver : role === 'gunner' ? layout.gunner : layout.passengers?.[index];
  const base = offset || layout.driver;
  const heading = number(vehicle?.heading, 0), sin = Math.sin(heading), cos = Math.cos(heading);
  return {
    x: number(vehicle?.position?.x, 0) + base.x * cos + base.z * sin,
    y: number(vehicle?.position?.y, 0) + base.y,
    z: number(vehicle?.position?.z, 0) - base.x * sin + base.z * cos,
    yaw: heading - Math.PI,
  };
}

export function takeVehicleSeat(vehicle, actorId, seat = 'driver', index = 0) {
  if (!vehicle || actorId == null) return false;
  if (seat === 'driver') vehicle.driver = actorId;
  else if (seat === 'gunner') vehicle.gunner = actorId;
  else {
    vehicle.passengers ||= [];
    while (vehicle.passengers.length <= index) vehicle.passengers.push(null);
    vehicle.passengers[index] = actorId;
  }
  return true;
}

export function leaveVehicleSeat(vehicle, actorId) {
  if (!vehicle) return null;
  let seat = null;
  if (vehicle.driver === actorId) { vehicle.driver = null; seat = 'driver'; }
  else if (vehicle.gunner === actorId) { vehicle.gunner = null; seat = 'gunner'; }
  else if (vehicle.passengers) {
    const index = vehicle.passengers.indexOf(actorId);
    if (index >= 0) { vehicle.passengers[index] = null; seat = 'passenger'; }
  }
  return seat;
}

// ---------------------------------------------------------------------------
// Vehicle counterplay (v8.6 fieldwork). Three pure tables keep the simulation,
// the HUD-facing scale and the tests reading the same numbers:
//  - VEHICLE_WEAKPOINT: direct fire into the rear/flank arcs of a chassis.
//  - VEHICLE_DISMOUNT: the brief slow window for bailing out at speed.
//  - VEHICLE_PASSENGER_FIRE: firing a personal weapon over the rail.
// No new actor/vehicle fields ride along; the dismount reuses `slow` and
// `slowMultiplier`, which are already snapshotted and honoured by movement.
export const VEHICLE_WEAKPOINT = freeze({
  rear: 1.35,
  flank: 1.2,
  rearCone: (Math.PI * 2) / 3,
  flankCone: Math.PI / 2
});
export const VEHICLE_DISMOUNT = freeze({
  minSpeed: 4,
  maxSpeed: 16,
  minDuration: 0.6,
  maxDuration: 1.2,
  slowMultiplier: 0.55
});
export const VEHICLE_PASSENGER_FIRE = freeze({ spread: 1.35, recoil: 1.25 });
export const VEHICLE_PASSENGER_FIRE_NEUTRAL = freeze({ spread: 1, recoil: 1 });

// Bearing-aware weak point for direct vehicle fire. `opts.face` is the actual
// struck chassis face reported by the oriented hitbox (front/rear/left/right/
// top) and wins when present; otherwise `opts.from` is the attacker's world
// position and `opts.bearing` may instead name the angle (radians) between the
// chassis forward face (+z at heading 0) and the incoming shot. Callers that
// pass none of them (every splash path) get the neutral 1x, so only aimed
// direct hits can exploit the rear/flank cones. Pure and deterministic.
export function vehicleWeakPointMultiplier(vehicle, opts = null) {
  if (!opts || typeof opts !== 'object') return 1;
  if (typeof opts.face === 'string') {
    if (opts.face === 'rear') return VEHICLE_WEAKPOINT.rear;
    if (opts.face === 'left' || opts.face === 'right') return VEHICLE_WEAKPOINT.flank;
    if (opts.face === 'front' || opts.face === 'top') return 1;
  }
  let bearing = Number.isFinite(opts.bearing) ? opts.bearing : null;
  if (bearing === null) {
    const from = opts.from ?? opts.source ?? null;
    if (!from) return 1;
    const heading = number(vehicle?.heading, 0);
    const dx = number(from.x, NaN) - number(vehicle?.position?.x, NaN);
    const dz = number(from.z, NaN) - number(vehicle?.position?.z, NaN);
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return 1;
    const length = Math.hypot(dx, dz);
    if (!(length > 1e-6)) return 1;
    bearing = Math.acos(clamp((Math.sin(heading) * dx + Math.cos(heading) * dz) / length, -1, 1));
  }
  if (!Number.isFinite(bearing)) return 1;
  if (bearing >= VEHICLE_WEAKPOINT.rearCone) return VEHICLE_WEAKPOINT.rear;
  if (bearing >= VEHICLE_WEAKPOINT.flankCone) return VEHICLE_WEAKPOINT.flank;
  return 1;
}

// A brief slow window after bailing out of a fast chassis (or a wreck: the
// destroy path releases the crew before it zeroes velocity). Duration rides the
// exit speed between the authored bounds; respawns never stun.
export function vehicleDismountStun(vehicle, reason = 'exit', flight = null) {
  if (!vehicle || reason === 'respawn') return { duration: 0, multiplier: 1 };
  const flying = flight === null ? vehicle?.config?.flight === true : flight === true;
  const speed = flying
    ? Math.hypot(number(vehicle.velocity?.x, 0), number(vehicle.velocity?.z, 0), number(vehicle.vy, 0))
    : Math.hypot(number(vehicle.velocity?.x, 0), number(vehicle.velocity?.z, 0));
  if (!(speed >= VEHICLE_DISMOUNT.minSpeed)) return { duration: 0, multiplier: 1 };
  const range = Math.max(1e-6, VEHICLE_DISMOUNT.maxSpeed - VEHICLE_DISMOUNT.minSpeed);
  const t = clamp((speed - VEHICLE_DISMOUNT.minSpeed) / range, 0, 1);
  return {
    duration: VEHICLE_DISMOUNT.minDuration + (VEHICLE_DISMOUNT.maxDuration - VEHICLE_DISMOUNT.minDuration) * t,
    multiplier: VEHICLE_DISMOUNT.slowMultiplier
  };
}

// Passenger personal fire pays a handling cost for firing over the rail; every
// other seat (driver, gunner) and every actor on foot returns the neutral scale.
export function passengerFireScale(actor) {
  return actor && actor.vehicleId != null && actor.vehicleSeat === 'passenger'
    ? VEHICLE_PASSENGER_FIRE
    : VEHICLE_PASSENGER_FIRE_NEUTRAL;
}

function stepFlight(vehicle, input, dt, collision, ground, config, gun) {
  // A gunner owns the mounted gun: skip its timers here so the weapon-only
  // step does not advance heat, cooldown and overheat twice per tick.
  if (vehicle.gunner == null) {
    vehicle.heat = Math.max(0, vehicle.heat - gun.coolRate * dt);
    vehicle.fireCooldown = Math.max(0, vehicle.fireCooldown - dt);
    if (vehicle.overheated) {
      vehicle.overheatTimer = Math.max(0, vehicle.overheatTimer - dt);
      vehicle.overheated = vehicle.overheatTimer > 0;
    }
  }
  const position = vehicle.position, velocity = vehicle.velocity;
  let heading = number(vehicle.heading, 0);
  const fwd = { x: Math.sin(heading), z: Math.cos(heading) };
  const right = { x: Math.cos(heading), z: -Math.sin(heading) };
  const throttle = clamp(number(input.throttle, 0), -1, 1);
  const steer = clamp(number(input.steer, 0), -1, 1);
  const lift = clamp(number(input.lift, 0), -1, 1);
  const speedScale = clamp(number(input.speedScale, 1), 0.5, 2);
  const boostScale = clamp(number(input.boostScale, 1), 0.5, 2);
  const handbrake = input.brake === true;
  const wasBoosting = number(vehicle.boostTimer, 0) > 0;
  vehicle.boostTimer = Math.max(0, number(vehicle.boostTimer, 0) - dt);
  vehicle.boostCooldown = Math.max(0, number(vehicle.boostCooldown, 0) - dt);
  if (wasBoosting && vehicle.boostTimer <= 0) vehicle.boostCooldown = Math.max(vehicle.boostCooldown, number(config.boostCooldown, 6));
  if (input.boost === true && throttle > 0 && vehicle.boostTimer <= 0 && vehicle.boostCooldown <= 0) vehicle.boostTimer = number(config.boostDuration, 2);
  const boosting = vehicle.boostTimer > 0;
  const prevSpeed = number(vehicle.speed, velocity.x * fwd.x + velocity.z * fwd.z);
  let speed = velocity.x * fwd.x + velocity.z * fwd.z;
  let lateral = velocity.x * right.x + velocity.z * right.z;
  const thrust = throttle >= 0
    ? throttle * (boosting ? number(config.boostAcceleration, 42) * boostScale : number(config.acceleration, 28)) * speedScale
    : throttle * number(config.acceleration, 28) * 0.4;
  const drag = number(config.drag, 0.02);
  speed = clamp(speed + (thrust - drag * speed * Math.abs(speed)) * dt, -number(config.reverseSpeed, 9), boosting ? number(config.boostSpeed, 54) * boostScale : number(config.speed, 36) * speedScale);
  if (throttle === 0) speed = approach(speed, 0, 2 * dt);
  lateral *= Math.max(0, 1 - number(config.grip, 3) * dt);
  velocity.x = fwd.x * speed + right.x * lateral;
  velocity.z = fwd.z * speed + right.z * lateral;
  let yawRate = (speed / number(config.turnRadius, 9)) * Math.tan(steer * number(config.maxSteer, 0.5)) + steer * number(config.steerAssist, 1.1);
  if (handbrake) yawRate *= 1.4;
  yawRate = clamp(yawRate, -number(config.maxYawRate, 2.4), number(config.maxYawRate, 2.4));
  heading += yawRate * dt;
  vehicle.heading = Number.isFinite(heading) ? heading : 0;
  vehicle.speed = speed;
  const climb = number(config.climbRate, 16), hover = number(config.hoverGravity, 14);
  vehicle.vy = approach(number(vehicle.vy, 0), lift * climb, (lift === 0 ? hover : climb) * dt);
  const next = { x: position.x + velocity.x * dt, y: position.y + number(vehicle.vy, 0) * dt, z: position.z + velocity.z * dt };
  const sample = typeof ground === 'function' ? ground(next.x, next.z) : 0;
  const floorY = sample == null ? 0 : typeof sample === 'number' ? sample : number(sample.y, 0);
  const minY = floorY + number(config.hoverHeight, 1.6), maxY = number(config.maxAltitude, 58);
  const resolved = typeof collision === 'function' ? collision(next, vehicle) : next;
  if (resolved === false) {
    velocity.x = velocity.z = 0;
    vehicle.speed = speed = 0;
    vehicle.vy = 0;
  } else if (resolved && Number.isFinite(resolved.x) && Number.isFinite(resolved.z)) {
    position.x = resolved.x;
    position.z = resolved.z;
    position.y = clamp(Number.isFinite(resolved.y) ? resolved.y : next.y, minY, maxY);
    if (position.y <= minY + 1e-3 && vehicle.vy < 0) vehicle.vy = 0;
  } else {
    position.x = next.x;
    position.z = next.z;
    position.y = clamp(next.y, minY, maxY);
  }
  const pitchTarget = clamp(-number(vehicle.vy, 0) * 0.028 + (speed - prevSpeed) * 0.0015, -number(config.pitchMax, 0.5), number(config.pitchMax, 0.5));
  const rollTarget = clamp(-yawRate * speed * 0.01, -number(config.rollMax, 0.7), number(config.rollMax, 0.7));
  const blend = clamp(1 - Math.exp(-number(config.bodyRate, 6) * dt), 0, 1);
  vehicle.pitchBody = number(vehicle.pitchBody, 0) + (pitchTarget - number(vehicle.pitchBody, 0)) * blend;
  vehicle.roll = number(vehicle.roll, 0) + (rollTarget - number(vehicle.roll, 0)) * blend;
  vehicle.grounded = position.y <= minY + 1e-3;
  if (vehicle.gunner == null) {
    if (Number.isFinite(input.turretYaw)) {
      const traverse = number(config.traverseRate, 2.2) * clamp(number(input.traverseScale, 1), 0.5, 2) * dt;
      vehicle.turretYaw = wrapAngle(approachAngle(number(vehicle.turretYaw, 0), input.turretYaw, traverse));
    } else {
      vehicle.turretYaw = number(vehicle.turretYaw, 0);
    }
    if (input.fire === true && !vehicle.overheated && vehicle.fireCooldown <= 0) {
      const barrels = vehicle.barrelCount || 2;
      vehicle.heat = Math.min(gun.maxHeat, vehicle.heat + gun.heatPerShot);
      vehicle.fireCooldown = gun.interval;
      vehicle.lastStep = { fired: true, muzzle: vehicle.muzzleIndex, muzzles: Array.from({ length: barrels }, (_, i) => i) };
      vehicle.muzzleIndex = (vehicle.muzzleIndex + 1) % barrels;
      if (vehicle.heat >= gun.maxHeat) {
        vehicle.overheated = true;
        vehicle.overheatTimer = gun.overheatCooldown;
      }
    }
  }
  return vehicle;
}

export function stepVehicle(vehicle, input = {}, dt = 0, collision, ground) {
  if (!vehicle || !Number.isFinite(dt) || dt <= 0) return vehicle;
  const config = vehicleConfig(vehicle);
  const gun = config.mountedChaingun || GUNTRUCK.mountedChaingun;
  const duration = dt;
  const position = vehicle.position || (vehicle.position = { x: 0, y: 0, z: 0 });
  const velocity = vehicle.velocity || (vehicle.velocity = { x: 0, z: 0 });
  vehicle.lastStep = { fired: false, muzzle: -1 };

  if (vehicle.respawnTimer > 0) {
    vehicle.respawnTimer = Math.max(0, vehicle.respawnTimer - duration);
    velocity.x = velocity.z = 0;
    vehicle.speed = 0;
    vehicle.handbrake = false;
    vehicle.turretYaw = number(vehicle.turretYaw, 0);
    return vehicle;
  }

  if (config.flight) return stepFlight(vehicle, input, duration, collision, ground, config, gun);

  // A gunner owns the mounted gun: skip its timers here so the weapon-only
  // step does not advance heat, cooldown and overheat twice per tick.
  if (vehicle.gunner == null) {
    vehicle.heat = Math.max(0, vehicle.heat - gun.coolRate * duration);
    vehicle.fireCooldown = Math.max(0, vehicle.fireCooldown - duration);
    if (vehicle.overheated) {
      vehicle.overheatTimer = Math.max(0, vehicle.overheatTimer - duration);
      vehicle.overheated = vehicle.overheatTimer > 0;
    }
  }

  const throttle = clamp(number(input.throttle, 0), -1, 1);
  const steer = clamp(number(input.steer, 0), -1, 1);
  const speedScale = clamp(number(input.speedScale, 1), 0.5, 2);
  const boostScale = clamp(number(input.boostScale, 1), 0.5, 2);
  const handbrake = input.brake === true;
  vehicle.handbrake = handbrake;

  const wasBoosting = number(vehicle.boostTimer, 0) > 0;
  vehicle.boostTimer = Math.max(0, number(vehicle.boostTimer, 0) - duration);
  vehicle.boostCooldown = Math.max(0, number(vehicle.boostCooldown, 0) - duration);
  if (wasBoosting && vehicle.boostTimer <= 0) {
    vehicle.boostCooldown = Math.max(vehicle.boostCooldown, number(config.boostCooldown, 6));
  }
  if (input.boost === true && throttle > 0 && vehicle.boostTimer <= 0 && vehicle.boostCooldown <= 0) {
    vehicle.boostTimer = number(config.boostDuration, 2);
  }
  const boosting = vehicle.boostTimer > 0;

  let heading = number(vehicle.heading, 0);
  const fwd = { x: Math.sin(heading), z: Math.cos(heading) };
  const right = { x: Math.cos(heading), z: -Math.sin(heading) };
  const prevSpeed = number(vehicle.speed, velocity.x * fwd.x + velocity.z * fwd.z);
  let speed = velocity.x * fwd.x + velocity.z * fwd.z;
  let lateral = velocity.x * right.x + velocity.z * right.z;
  const dimensions = config.dimensions || GUNTRUCK.dimensions;
  const wheelBase = number(config.wheelBase, dimensions.length);
  const track = number(config.trackWidth, dimensions.width);

  let groundY = null;
  let groundNormal = null;
  let groundPitch = 0;
  let groundRoll = 0;
  let grounded = true;
  if (typeof ground === 'function') {
    const halfTrack = track / 2;
    const halfBase = wheelBase / 2;
    const samples = [];
    for (const ox of [-halfTrack, halfTrack]) {
      for (const oz of [halfBase, -halfBase]) {
        const sample = ground(
          position.x + ox * right.x + oz * fwd.x,
          position.z + ox * right.z + oz * fwd.z
        );
        if (sample == null) continue;
        const y = typeof sample === 'number' ? sample : number(sample.y, NaN);
        if (!Number.isFinite(y)) continue;
        const normal = typeof sample === 'object' ? readNormal(sample.normal) : null;
        const valid = normal && Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z);
        samples.push({ ox, oz, y, normal: valid ? normal : null });
      }
    }
    if (samples.length) {
      groundY = samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length;
      const normals = samples.filter(sample => sample.normal);
      if (normals.length) {
        const sum = normals.reduce((acc, sample) => ({
          x: acc.x + sample.normal.x,
          y: acc.y + sample.normal.y,
          z: acc.z + sample.normal.z
        }), { x: 0, y: 0, z: 0 });
        groundNormal = normalize(sum);
      }
      const front = samples.filter(sample => sample.oz > 0);
      const rear = samples.filter(sample => sample.oz < 0);
      const left = samples.filter(sample => sample.ox < 0);
      const rightSide = samples.filter(sample => sample.ox > 0);
      if (front.length && rear.length) {
        const frontY = front.reduce((sum, sample) => sum + sample.y, 0) / front.length;
        const rearY = rear.reduce((sum, sample) => sum + sample.y, 0) / rear.length;
        groundPitch = Math.atan2(frontY - rearY, wheelBase);
      }
      if (left.length && rightSide.length) {
        const leftY = left.reduce((sum, sample) => sum + sample.y, 0) / left.length;
        const rightY = rightSide.reduce((sum, sample) => sum + sample.y, 0) / rightSide.length;
        groundRoll = Math.atan2(leftY - rightY, track);
      }
      grounded = position.y - groundY <= 0.4;
    }
  }
  if (groundNormal) {
    groundPitch = -Math.asin(clamp(groundNormal.x * fwd.x + groundNormal.z * fwd.z, -1, 1));
    groundRoll = Math.asin(clamp(groundNormal.x * right.x + groundNormal.z * right.z, -1, 1));
  }

  const engineAir = grounded ? 1 : 0.35;
  const thrust = throttle >= 0
    ? throttle * (boosting ? number(config.boostAcceleration, 24) * boostScale : number(config.acceleration, 14)) * engineAir * speedScale
    : throttle * number(config.acceleration, 14) * 0.35 * engineAir;
  const drag = number(config.drag, 0.035);
  let acceleration = thrust - drag * speed * Math.abs(speed);
  if (handbrake) acceleration -= Math.sign(speed) * number(config.brake, 22);
  speed += acceleration * duration;
  const topSpeed = boosting ? number(config.boostSpeed, 26) * boostScale : number(config.speed, 20) * speedScale;
  speed = clamp(speed, -number(config.reverseSpeed, 6), topSpeed);
  if (throttle === 0 && !handbrake) speed = approach(speed, 0, 2 * duration);

  const slopeGrip = groundNormal ? clamp(groundNormal.y, 0.4, 1) : 1;
  let grip = (handbrake ? number(config.handbrakeGrip, 1.8) : number(config.grip, 8)) * slopeGrip;
  if (!grounded) grip *= 0.25;
  if (Math.abs(lateral) > number(config.driftLateral, 4)) grip *= 0.5;
  lateral *= Math.max(0, 1 - grip * duration);
  if (!Number.isFinite(lateral)) lateral = 0;

  velocity.x = fwd.x * speed + right.x * lateral;
  velocity.z = fwd.z * speed + right.z * lateral;

  let yawRate = (speed / wheelBase) * Math.tan(steer * number(config.maxSteer, 0.55));
  if (Math.abs(speed) < number(config.steerAssistSpeed, 3)) {
    yawRate += steer * number(config.steerAssist, 1.4) * (speed < -0.1 ? -1 : 1);
  }
  if (!grounded) yawRate *= 0.25;
  yawRate = clamp(yawRate, -number(config.maxYawRate, 3.5), number(config.maxYawRate, 3.5));
  if (handbrake) yawRate *= number(config.handbrakeYaw, 1.6);
  yawRate = clamp(yawRate, -number(config.maxHandbrakeYawRate, 5), number(config.maxHandbrakeYawRate, 5));
  heading += yawRate * duration;
  vehicle.heading = Number.isFinite(heading) ? heading : 0;
  vehicle.speed = speed;

  if (vehicle.gunner == null) {
    if (Number.isFinite(input.turretYaw)) {
      const traverse = number(config.traverseRate, 1.75) * clamp(number(input.traverseScale, 1), 0.5, 2) * duration;
      vehicle.turretYaw = wrapAngle(approachAngle(number(vehicle.turretYaw, 0), input.turretYaw, traverse));
    } else {
      vehicle.turretYaw = number(vehicle.turretYaw, 0);
    }
  }

  const next = {
    x: position.x + velocity.x * duration,
    y: position.y,
    z: position.z + velocity.z * duration
  };
  const resolved = typeof collision === 'function' ? collision(next, vehicle) : next;
  if (resolved === false) {
    velocity.x = velocity.z = 0;
    vehicle.speed = speed = 0;
  } else if (resolved && Number.isFinite(resolved.x) && Number.isFinite(resolved.z)) {
    position.x = resolved.x;
    position.z = resolved.z;
  } else {
    position.x = next.x;
    position.z = next.z;
  }

  if (groundY !== null) {
    const suspension = clamp(number(config.suspensionRate, 12) * duration, 0, 1);
    position.y = number(position.y, 0) + (groundY - number(position.y, 0)) * suspension;
    if (!Number.isFinite(position.y)) position.y = groundY;
  } else if (resolved && Number.isFinite(resolved.y)) {
    position.y = resolved.y;
  }

  const accelerationPitch = clamp(((speed - prevSpeed) / duration) * 0.006, -0.12, 0.12);
  const accelerationRoll = clamp(-(yawRate * speed) * 0.02, -number(config.rollMax, 0.35), number(config.rollMax, 0.35));
  const pitchTarget = clamp(groundPitch + accelerationPitch, -number(config.pitchMax, 0.35), number(config.pitchMax, 0.35));
  const rollTarget = clamp(groundRoll + accelerationRoll, -number(config.rollMax, 0.35), number(config.rollMax, 0.35));
  const bodyBlend = clamp(1 - Math.exp(-number(config.bodyRate, 8) * duration), 0, 1);
  vehicle.pitchBody = number(vehicle.pitchBody, 0) + (pitchTarget - number(vehicle.pitchBody, 0)) * bodyBlend;
  vehicle.roll = number(vehicle.roll, 0) + (rollTarget - number(vehicle.roll, 0)) * bodyBlend;
  if (!Number.isFinite(vehicle.pitchBody)) vehicle.pitchBody = 0;
  if (!Number.isFinite(vehicle.roll)) vehicle.roll = 0;
  vehicle.grounded = groundY === null ? true : grounded;

  if (vehicle.gunner == null && input.fire === true && !vehicle.overheated && vehicle.fireCooldown <= 0) {
    const barrels = vehicle.barrelCount || 2;
    vehicle.heat = Math.min(gun.maxHeat, vehicle.heat + gun.heatPerShot);
    vehicle.fireCooldown = gun.interval;
    vehicle.lastStep = { fired: true, muzzle: vehicle.muzzleIndex, muzzles: Array.from({ length: barrels }, (_, i) => i) };
    vehicle.muzzleIndex = (vehicle.muzzleIndex + 1) % barrels;
    if (vehicle.heat >= gun.maxHeat) {
      vehicle.overheated = true;
      vehicle.overheatTimer = gun.overheatCooldown;
    }
  }
  return vehicle;
}

// Weapon-only step for a gunner riding a vehicle whose driver is already moving it.
export function stepVehicleWeapon(vehicle, input = {}, dt = 0) {
  if (!vehicle || !Number.isFinite(dt) || dt <= 0) return vehicle;
  const config = vehicleConfig(vehicle), gun = config.mountedChaingun || GUNTRUCK.mountedChaingun;
  vehicle.lastStep = { fired: false, muzzle: -1 };
  if (vehicle.respawnTimer > 0 || vehicle.health <= 0) return vehicle;
  vehicle.heat = Math.max(0, vehicle.heat - gun.coolRate * dt);
  vehicle.fireCooldown = Math.max(0, vehicle.fireCooldown - dt);
  if (vehicle.overheated) {
    vehicle.overheatTimer = Math.max(0, vehicle.overheatTimer - dt);
    vehicle.overheated = vehicle.overheatTimer > 0;
  }
  if (Number.isFinite(input.turretYaw)) {
    const traverse = number(config.traverseRate, 2.2) * dt;
    vehicle.turretYaw = wrapAngle(approachAngle(number(vehicle.turretYaw, 0), input.turretYaw, traverse));
  }
  if (input.fire === true && !vehicle.overheated && vehicle.fireCooldown <= 0) {
    const barrels = vehicle.barrelCount || 2;
    vehicle.heat = Math.min(gun.maxHeat, vehicle.heat + gun.heatPerShot);
    vehicle.fireCooldown = gun.interval;
    vehicle.lastStep = { fired: true, muzzle: vehicle.muzzleIndex, muzzles: Array.from({ length: barrels }, (_, i) => i) };
    vehicle.muzzleIndex = (vehicle.muzzleIndex + 1) % barrels;
    if (vehicle.heat >= gun.maxHeat) {
      vehicle.overheated = true;
      vehicle.overheatTimer = gun.overheatCooldown;
    }
  }
  return vehicle;
}

export function respawnVehicle(vehicle, position = { x: 0, y: 0, z: 0 }, heading = 0) {
  vehicle.position = { x: number(position.x, 0), y: number(position.y, 0), z: number(position.z, 0) };
  vehicle.heading = number(heading, 0);
  vehicle.velocity = { x: 0, z: 0 };
  vehicle.vy = 0;
  vehicle.health = vehicle.maxHealth;
  vehicle.driver = null;
  vehicle.gunner = null;
  vehicle.passengers = [];
  vehicle.respawnTimer = 0;
  vehicle.heat = 0;
  vehicle.overheated = false;
  vehicle.overheatTimer = 0;
  vehicle.fireCooldown = 0;
  vehicle.muzzleIndex = 0;
  vehicle.turretYaw = 0;
  vehicle.roll = 0;
  vehicle.pitchBody = 0;
  vehicle.speed = 0;
  vehicle.grounded = true;
  vehicle.handbrake = false;
  vehicle.boostTimer = 0;
  vehicle.boostCooldown = 0;
  vehicle.lastStep = { fired: false, muzzle: -1 };
  return vehicle;
}
