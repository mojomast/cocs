// LATTICE STRIKE (`cocs`) V0b traversal devices, arrival protection and depots.
//
// Spec authority: docs/design/COCS-MODE-SPEC.md §6A.1–§6A.3 and
// docs/design/COCS-MAP-ARCHITECTURE.md §6.8. The module is the engine half of
// the traversal doctrine: it owns the neutral device state machine
// (`live | cut | locked`), the per-actor shared 2.5 s chain cooldown, the 1.5 s /
// 50 % `arrivalProtection`, and the team-owned depot (`capture / deny / spawn /
// respawn / owner-only apron`) plus the first-come PUMA loaner.
//
// Determinism (§11.6): pure data, sorted iteration, one fixed clock. No `random`
// draw is taken anywhere in this file and no wall-clock is read. Device and
// depot updates are a pure function of the previous state + `dt` + living actor
// positions, so a seeded run is byte-identical.
import {DEVICE_PARAMS, TRAVERSAL, traversalKind, arrivalProtection, tickArrival} from './cocs-economy.mjs';
import {RULES} from './data.mjs';
import {buildZipRide} from './movement.mjs';
import {PUMA, createVehicle, respawnVehicle} from './vehicles.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const num = (value, fallback = 0) => (finite(value) ? value : fallback);
const round = (value, places = 3) => {
 const scale = 10 ** places;
 return Math.round(num(value, 0) * scale) / scale;
};

// Actor anchor reach for a cut/repair hold, and the §6A.1 stable-hold radius
// ("no enemy within 6 m of the anchor").
export const DEVICE_INTERACT_METERS = 6;
// Auto-use reach for a bot that deliberately routed to a device (the tactical
// planner posts `bot.cocsDevice`). Looser than the 0.9 m anchor point because a
// nav route lands *near* the anchor; the intent itself is the safety check.
export const DEVICE_USE_REACH_METERS = 3;

const point = value => {
 if (!value) return null;
 const x = Array.isArray(value) ? value[0] : value.x;
 const z = Array.isArray(value) ? value[1] : value.z;
 if (!finite(x) || !finite(z)) return null;
 const y = Array.isArray(value) ? (finite(value[2]) ? value[2] : null) : (finite(value.y) ? value.y : null);
 return {x, z, y};
};
const distance = (a, b) => Math.hypot(num(a?.x, 0) - num(b?.x, 0), num(a?.z, 0) - num(b?.z, 0));
const sortedIds = table => Object.keys(table ?? {}).map(Number).sort((a, b) => a - b);
const sortedStrings = table => Object.keys(table ?? {}).sort();

// ===========================================================================
// Layer parsing
// ===========================================================================
/** True when a map authors any cocs traversal layer. */
export function hasTraversalLayer(arena) {
 return Array.isArray(arena?.traversal) ? arena.traversal.length > 0 : Boolean(arena?.traversal && arena.traversal.devices?.length);
}

function normalizeDevice(raw, index) {
 if (!raw || typeof raw !== 'object') return null;
 const kind = traversalKind(raw.kind);
 if (!kind || kind === 'depot') return null;
 const from = point(raw.from ?? raw.anchor ?? raw.pad);
 const to = point(raw.to ?? raw.target ?? raw.destination);
 const arrival = point(raw.arrival);
 const params = DEVICE_PARAMS[kind] ?? {};
 return {
  id: String(raw.id ?? `${kind}-${index}`),
  kind,
  lane: typeof raw.lane === 'string' ? raw.lane : null,
  from,
  to,
  target: kind === 'launcher' ? (to ?? point(raw.target)) : to,
  arrival: arrival ? {...arrival, r: num(arrival.r, TRAVERSAL.arrivalMinRadius), seconds: num(arrival.seconds, TRAVERSAL.arrivalSeconds)} : null,
  power: num(raw.power, 16),
  speed: num(raw.speed, params.speed ?? TRAVERSAL.ziplineSpeed),
  sag: num(raw.sag, 0),
  lift: num(raw.lift, 0),
  minDuration: finite(raw.minDuration) ? raw.minDuration : null,
  blendMeters: finite(raw.blendMeters) ? raw.blendMeters : null,
  jumpOff: raw.jumpOff !== false,
  cuttable: raw.cuttable === true,
  lockable: raw.lockable === true,
  onFootOnly: params.onFootOnly !== false,
  arrivalProtection: raw.arrivalProtection === true || params.arrivalProtection === true,
  vehiclesAllowed: raw.vehiclesAllowed === true,
  bypassFraction: finite(raw.bypassFraction) ? raw.bypassFraction : null,
  approaches: num(raw.approaches ?? raw.approachCount, 0),
  cutSeconds: num(raw.cutSeconds, params.cutSeconds ?? TRAVERSAL.cutSeconds),
  cutChannelSeconds: num(raw.cutChannelSeconds, params.cutChannelSeconds ?? TRAVERSAL.cutChannelSeconds),
  lockSeconds: num(raw.lockSeconds, params.lockSeconds ?? TRAVERSAL.lockSeconds),
  lockChannelSeconds: num(raw.lockChannelSeconds, params.lockChannelSeconds ?? 2.5),
  repairSeconds: num(raw.repairSeconds, params.repairSeconds ?? TRAVERSAL.repairSeconds),
  sharedCooldown: num(params.sharedCooldown, TRAVERSAL.sharedCooldown),
 };
}

function normalizeDepot(raw, index) {
 if (!raw || typeof raw !== 'object') return null;
 const x = num(raw.x, 0);
 const z = num(raw.z, 0);
 const team = raw.team === 0 || raw.team === 1 ? raw.team : null;
 return {
  id: String(raw.id ?? `depot-${index}`),
  lane: typeof raw.lane === 'string' ? raw.lane : null,
  team,
  hq: raw.hq === true,
  x,
  z,
  y: num(raw.y, 0),
  radius: num(raw.radius, 8),
  exits: num(raw.exits, 2),
  vehicle: String(raw.vehicle ?? 'puma'),
  apronMeters: num(raw.apronMeters, DEVICE_PARAMS.depot.apronMeters),
  captureSeconds: num(raw.captureSeconds, DEVICE_PARAMS.depot.captureSeconds),
  respawnSeconds: num(raw.respawnSeconds, DEVICE_PARAMS.depot.vehicleRespawnSeconds),
  spawnImmunitySeconds: num(raw.spawnImmunitySeconds, DEVICE_PARAMS.depot.vehicleSpawnImmunitySeconds),
  vehicleOffset: point(raw.vehicleSpawn) ?? {x: x, z: z + 2.5, y: num(raw.y, 0)},
 };
}

/** Normalise `arena.traversal` / `arena.depots` into the frozen layer shape. */
export function readTraversalLayer(arena) {
 const rawDevices = Array.isArray(arena?.traversal) ? arena.traversal : Array.isArray(arena?.traversal?.devices) ? arena.traversal.devices : [];
 const rawDepots = Array.isArray(arena?.depots) ? arena.depots : [];
 const devices = rawDevices.map(normalizeDevice).filter(Boolean);
 const depots = rawDepots.map(normalizeDepot).filter(Boolean);
 return {devices, depots};
}

// ===========================================================================
// State
// ===========================================================================
/** Fresh traversal state, or null when the map authors no devices/depots. */
export function createTraversalState(arena, options = {}) {
 const layer = readTraversalLayer(arena);
 if (!layer.devices.length && !layer.depots.length) return null;
 const devices = {};
 for (const device of layer.devices) {
  devices[device.id] = {
   ...device,
   state: 'live',
   timer: 0,
   channel: null,
   uses: 0,
   cuts: 0,
   repairs: 0,
   locks: 0,
  };
 }
 const depots = {};
 for (const depot of layer.depots) {
  depots[depot.id] = {
   ...depot,
   owner: depot.hq ? depot.team : depot.team,
   progress: {0: 0, 1: 0},
   contested: false,
   vehicleId: null,
   respawn: 0,
   captureCooldown: 0,
   captures: 0,
   vehicleSpawns: 0,
  };
 }
 return {
  tick: 0,
  devices,
  depots,
  cooldowns: {},
  arrivals: {},
  near: {},
  // Bots do not yet path onto devices; the engine half and the explicit
  // `useDevice` hook are live, and a later bot-POI pass can enable auto-use.
  botUse: options.botUse === true,
  stats: {uses: 0, cuts: 0, repairs: 0, locks: 0, vehicleSpawns: 0, vehicleUses: 0, arrivals: 0, depotCaptures: 0},
 };
}

// ===========================================================================
// Arrival protection (§6A.3)
// ===========================================================================
/** Apply the §6A.3 arrival window to one actor and mirror it onto the actor. */
export function applyArrivalProtection(traversal, actor, tick = 0) {
 if (!actor || !traversal) return null;
 const protection = arrivalProtection();
 traversal.arrivals[actor.id] = {actor: actor.id, ...protection, atTick: tick, x: num(actor.x, 0), y: num(actor.y, 0), z: num(actor.z, 0)};
 actor.cocsArrival = {...protection};
 traversal.stats.arrivals = num(traversal.stats.arrivals, 0) + 1;
 return protection;
}

/**
 * Damage scale for one target from its live arrival window: `1` normally,
 * `1 - 0.5` while the 1.5 s window is active. Pure and mode-neutral — only a
 * cocs device sets `actor.cocsArrival`.
 */
export function arrivalDamageScale(actor) {
 const protection = actor?.cocsArrival;
 if (!protection || !(num(protection.remaining, 0) > 0)) return 1;
 return 1 - num(protection.damageReduction, TRAVERSAL.arrivalDamageReduction);
}

function tickArrivals(match, traversal, dt) {
 for (const id of sortedIds(traversal.arrivals)) {
  const entry = traversal.arrivals[id];
  if (!entry) continue;
  const next = tickArrival(entry, dt);
  const actor = match?.actors?.[id];
  if (next.active) {
   entry.remaining = next.remaining;
   entry.damageReduction = next.damageReduction;
   entry.telegraph = next.telegraph;
   if (actor) actor.cocsArrival = {remaining: next.remaining, damageReduction: next.damageReduction, telegraph: next.telegraph};
  } else {
   if (actor) actor.cocsArrival = null;
   delete traversal.arrivals[id];
  }
 }
}

// ===========================================================================
// Device state machine
// ===========================================================================
const sabotageAction = device => (device.kind === 'zipline' || device.kind === 'teleporter' ? 'cut' : 'lock');
const TRAVERSABLE_KINDS = new Set(['zipline', 'jump-pad', 'teleporter', 'launcher']);

function enemyNear(match, anchor, team, meters = DEVICE_INTERACT_METERS) {
 for (const actor of match?.actors ?? []) {
  if (!actor || actor.health <= 0) continue;
  if (actor.team !== 0 && actor.team !== 1) continue;
  if (actor.team === team) continue;
  if (distance(actor, anchor) <= meters) return true;
 }
 return false;
}

function actorAtAnchor(actor, anchor) {
 if (!actor || actor.health <= 0) return false;
 if (actor.vehicleId !== null && actor.vehicleId !== undefined) return false;
 if (actor.zipRide) return false; // a rider is not a stable channel anchor
 if (!anchor) return false;
 return distance(actor, anchor) <= DEVICE_INTERACT_METERS && Math.abs(num(actor.y, 0) - num(anchor.y, num(actor.y, 0))) <= 2;
}

/** Start (or refresh) a cut/lock/repair channel on one device. Returns true. */
export function startDeviceChannel(match, traversal, device, actor, action) {
 if (!device || !actor) return false;
 const channelSeconds = action === 'repair'
  ? device.repairSeconds
  : action === 'lock'
   ? device.lockChannelSeconds
   : device.cutChannelSeconds;
 device.channel = {actor: actor.id, action, remaining: channelSeconds, total: channelSeconds};
 return true;
}

function completeChannel(traversal, device, action) {
 if (action === 'repair') {
  device.state = 'live';
  device.timer = 0;
  device.repairs = num(device.repairs, 0) + 1;
  traversal.stats.repairs = num(traversal.stats.repairs, 0) + 1;
 } else if (action === 'lock') {
  device.state = 'locked';
  device.timer = device.lockSeconds;
  device.locks = num(device.locks, 0) + 1;
  traversal.stats.locks = num(traversal.stats.locks, 0) + 1;
 } else {
  device.state = 'cut';
  device.timer = device.cutSeconds;
  device.cuts = num(device.cuts, 0) + 1;
  traversal.stats.cuts = num(traversal.stats.cuts, 0) + 1;
 }
}

function tickDeviceChannel(match, traversal, device, dt) {
 const channel = device.channel;
 if (!channel) return;
 const actor = match?.actors?.[channel.actor];
 const anchor = device.from;
 const action = channel.action;
 const stable = actor && actorAtAnchor(actor, anchor) && !enemyNear(match, anchor, actor.team);
 if (!stable) { device.channel = null; return; }
 channel.remaining = Math.max(0, num(channel.remaining, 0) - dt);
 if (!(channel.remaining > 0)) {
  completeChannel(traversal, device, action);
  device.channel = null;
 }
}

function deviceUsable(device) {
 return device.state === 'live';
}

function useDeviceInternal(match, traversal, device, actor) {
 if (!deviceUsable(device)) return false;
 if (!actor || actor.health <= 0) return false;
 if (actor.team !== 0 && actor.team !== 1) return false;
 if (device.onFootOnly && !(actor.vehicleId === null || actor.vehicleId === undefined)) return false;
 if (actor.zipRide) return false;
 if (!device.from) return false;
 if (!(num(traversal.cooldowns[actor.id], 0) <= 0)) return false;
 if (device.kind === 'jump-pad' && actor.grounded !== true) return false;

 const destination = device.kind === 'launcher' ? (device.target ?? device.to) : device.to;
 const from = {x: num(actor.x, 0), y: num(actor.y, 0), z: num(actor.z, 0)};
 if (device.kind === 'jump-pad') {
  actor.vy = Math.max(num(actor.vy, 0), device.power);
  actor.grounded = false;
 } else if (device.kind === 'zipline' && destination) {
  // A zipline is ridden, not blinked: board at the authored cable anchor with a
  // real path the engine steps. Arrival protection is applied by the Match when
  // the cable releases the rider (`zipline-arrival`).
  const lift = num(device.lift, 0);
  const anchorY = (finite(device.from.y) ? device.from.y : from.y) + lift;
  const exitY = (finite(destination.y) ? destination.y : from.y) + lift;
  const ride = buildZipRide({
   id: device.id,
   from: {x: device.from.x, y: anchorY, z: device.from.z},
   to: {x: destination.x, y: exitY, z: destination.z},
   speed: device.speed,
   sag: num(device.sag, 0),
   cooldown: device.sharedCooldown,
   minDuration: device.minDuration ?? undefined,
   blendMeters: device.blendMeters ?? undefined,
   jumpOff: device.jumpOff,
  });
  if (!ride) return false;
  actor.x = device.from.x;
  actor.z = device.from.z;
  actor.y = anchorY;
  actor.vx = actor.vy = actor.vz = 0;
  actor.grounded = false;
  actor.zipRide = ride;
 } else if (device.kind === 'launcher' && destination) {
  // A launcher is a ballistic flight, not a blink. Same shape as the core
  // boost seam: solve the launch arc to the authored target and let the
  // actor's traversalTarget landing resolve over the next ticks.
  const gravity = RULES.gravity;
  const launchY = Math.max(.1, num(device.vy, num(device.power, 14) * .55));
  const dx = destination.x - num(actor.x, 0);
  const dz = destination.z - num(actor.z, 0);
  const flat = Math.hypot(dx, dz) || 1;
  const deltaY = (finite(destination.y) ? destination.y : num(actor.y, 0)) - num(actor.y, 0);
  const discriminant = launchY * launchY - 2 * gravity * deltaY;
  const time = discriminant >= 0 ? (launchY + Math.sqrt(discriminant)) / gravity : null;
  const horizontal = time && time > 0 ? flat / time : num(device.power, 14);
  actor.vx = dx / flat * horizontal;
  actor.vz = dz / flat * horizontal;
  actor.vy = launchY;
  actor.traversalTarget = {x: destination.x, y: finite(destination.y) ? destination.y : num(actor.y, 0), z: destination.z};
  actor.traversalFlight = true;
  actor.grounded = false;
 } else if (destination) {
  actor.x = destination.x;
  actor.z = destination.z;
  actor.y = finite(destination.y) ? destination.y : num(actor.y, 0);
  actor.vx = actor.vy = actor.vz = 0;
  actor.grounded = true;
  actor.lastValid = {x: actor.x, y: actor.y, z: actor.z};
 }
 actor.traversalCooldown = device.sharedCooldown;
 // The core traversal vocabulary names the portal event `teleport`; the device
 // kind is `teleporter`. Keep the wire event in the view/audio-safe form.
 const eventType = device.kind === 'teleporter' ? 'teleport' : device.kind;
 actor.traversalEvent = actor.zipRide
  ? {type: eventType, id: device.id, from: {...actor.zipRide.from}, to: {...actor.zipRide.to}}
  : {type: eventType, id: device.id, from, to: {x: num(actor.x, 0), y: num(actor.y, 0), z: num(actor.z, 0)}};
 if (device.kind !== 'zipline' && device.kind !== 'launcher' && (device.arrivalProtection || device.arrival)) applyArrivalProtection(traversal, actor, traversal.tick);
 // The shared gate opens one cooldown *after* the cable releases the rider, so
 // a long ride never spends its own lockout mid-air (actor.traversalCooldown
 // mirrors this because the core ride seam keeps it frozen while riding).
 traversal.cooldowns[actor.id] = device.sharedCooldown + (actor.zipRide ? num(actor.zipRide.duration, 0) : 0);
 device.uses = num(device.uses, 0) + 1;
 traversal.stats.uses = num(traversal.stats.uses, 0) + 1;
 match?.emit?.('cocs-device-use', {device: device.id, kind: device.kind, actor: actor.id, to: {x: actor.x, z: actor.z}});
 return true;
}

function tryDeviceUse(match, traversal) {
 if (traversal.botUse !== true) return;
 const nextNear = {};
 for (const id of sortedStrings(traversal.devices)) {
  const device = traversal.devices[id];
  if (!deviceUsable(device) || !device.from) continue;
  for (const actor of [...(match?.actors ?? [])].filter(Boolean).sort((a, b) => a.id - b.id)) {
   if (actor.health <= 0 || (actor.team !== 0 && actor.team !== 1)) continue;
   if (!actor.bot) continue;
   const intent = actor.bot.cocsDevice;
   // The tactical planner (`cocsTraversalChoice`) is authoritative: it posts an
   // id only for a device it deliberately routed the bot through, and `null`
   // means "stay off devices" (a live-but-tactically-poor option). Only an
   // unplanned bot — no field at all — keeps the legacy arm-then-fire path the
   // direct engine tests drive.
   if (intent === null) continue;
   if (intent !== undefined) {
    if (intent !== device.id) continue;
    if (!(distance(actor, device.from) <= DEVICE_USE_REACH_METERS)) continue;
    if (useDeviceInternal(match, traversal, device, actor)) {
     actor.bot.cocsDevice = null;
     actor.bot.deviceUses = num(actor.bot.deviceUses, 0) + 1;
     nextNear[`${actor.id}`] = device.id;
     break;
    }
    continue;
   }
   if (!(distance(actor, device.from) <= TRAVERSAL.anchorReachMeters)) continue;
   const key = `${actor.id}`;
   if (traversal.near[key] !== device.id) { nextNear[key] = device.id; continue; }
   if (useDeviceInternal(match, traversal, device, actor)) { nextNear[key] = device.id; break; }
  }
 }
 traversal.near = nextNear;
}

function tryDeviceSabotage(match, traversal, dt) {
 for (const id of sortedStrings(traversal.devices)) {
  const device = traversal.devices[id];
  if (device.channel) continue;
  if (device.state === 'live') {
   if (!device.cuttable && !device.lockable) continue;
   const action = sabotageAction(device);
   for (const actor of [...(match?.actors ?? [])].filter(Boolean).sort((a, b) => a.id - b.id)) {
    if (actor.health <= 0 || (actor.team !== 0 && actor.team !== 1)) continue;
    if (!actor.bot) continue;
    if (!actorAtAnchor(actor, device.from)) continue;
    if (enemyNear(match, device.from, actor.team)) continue;
    if (device.kind === 'jump-pad' && actor.grounded !== true) continue;
    if (startDeviceChannel(match, traversal, device, actor, action)) break;
   }
  } else if (device.cuttable || device.lockable) {
   for (const actor of [...(match?.actors ?? [])].filter(Boolean).sort((a, b) => a.id - b.id)) {
    if (actor.health <= 0 || (actor.team !== 0 && actor.team !== 1)) continue;
    if (!actor.bot) continue;
    if (!actorAtAnchor(actor, device.from)) continue;
    if (enemyNear(match, device.from, actor.team)) continue;
    if (startDeviceChannel(match, traversal, device, actor, 'repair')) break;
   }
  }
 }
 void dt;
}

function tickDevices(match, traversal, dt) {
 for (const id of sortedStrings(traversal.devices)) {
  const device = traversal.devices[id];
  if (device.timer > 0) {
   device.timer = Math.max(0, device.timer - dt);
   if (device.timer <= 0 && device.state !== 'live') device.state = 'live';
  }
  tickDeviceChannel(match, traversal, device, dt);
 }
}

// ===========================================================================
// Depots (§6A.1 / §6A.7)
// ===========================================================================
/**
 * True when `target` stands inside one of its own depots' 6 m owner-only apron.
 * Read by `Match.damage`; mode-neutral unless a cocs depot owns the ground.
 */
export function depotApronImmune(match, target, source) {
 const traversal = match?.objectiveState?.traversal;
 if (!traversal || !target) return false;
 const team = target.team;
 if (team !== 0 && team !== 1) return false;
 if (source && (source.team === team || source === target)) return false;
 for (const id of sortedStrings(traversal.depots)) {
  const depot = traversal.depots[id];
  if (depot.owner !== team) continue;
  if (distance(target, depot) <= depot.apronMeters) return true;
 }
 return false;
}

function spawnDepotVehicle(match, traversal, depot) {
 if (depot.vehicleId != null && match.vehicles.some(vehicle => vehicle.id === depot.vehicleId)) return null;
 const template = {...PUMA, id: `depot-${depot.id}`, kind: 'puma'};
 const vehicle = createVehicle(template);
 vehicle.id = `depot-${depot.id}`;
 vehicle.kind = 'puma';
 vehicle.depotId = depot.id;
 vehicle.ownerTeam = depot.owner;
 // A 25 s depot respawn (not the 5 s race loaner) rides the per-vehicle config
 // so the shared core vehicle step owns the clock.
 vehicle.config = {...vehicle.config, respawn: depot.respawnSeconds};
 const position = {x: num(depot.vehicleOffset.x, depot.x), y: num(depot.vehicleOffset.y, depot.y), z: num(depot.vehicleOffset.z, depot.z)};
 vehicle.spawn = {...position};
 respawnVehicle(vehicle, position, 0);
 vehicle.spawnImmunity = depot.spawnImmunitySeconds;
 vehicle.lastTeam = depot.owner;
 match.vehicles.push(vehicle);
 depot.vehicleId = vehicle.id;
 depot.respawn = 0;
 depot.vehicleSpawns = num(depot.vehicleSpawns, 0) + 1;
 traversal.stats.vehicleSpawns = num(traversal.stats.vehicleSpawns, 0) + 1;
 match.emit?.('cocs-depot-vehicle-spawn', {depot: depot.id, vehicle: vehicle.id, team: depot.owner, x: position.x, z: position.z});
 return vehicle;
}

function captureDepot(match, traversal, depot, team) {
 depot.owner = team;
 depot.progress = {0: 0, 1: 0};
 depot.contested = false;
 depot.captures = num(depot.captures, 0) + 1;
 traversal.stats.depotCaptures = num(traversal.stats.depotCaptures, 0) + 1;
 depot.vehicleId = null;
 match.emit?.('cocs-depot-capture', {depot: depot.id, team, x: depot.x, z: depot.z});
}

function stepDepot(match, traversal, depot, dt) {
 const present = {0: [], 1: []};
 for (const actor of match?.actors ?? []) {
  if (!actor || actor.health <= 0) continue;
  if (actor.team !== 0 && actor.team !== 1) continue;
  if (distance(actor, depot) > depot.radius) continue;
  present[actor.team].push(actor);
 }
 const occupied = {0: present[0].length > 0, 1: present[1].length > 0};
 depot.contested = occupied[0] && occupied[1];
 if (!depot.hq && !depot.contested) {
  const challenger = occupied[0] ? 0 : occupied[1] ? 1 : null;
  if (challenger !== null && depot.owner !== challenger) {
   const rate = dt / Math.max(0.5, depot.captureSeconds);
   depot.progress[challenger] = Math.min(1, num(depot.progress[challenger], 0) + rate);
   depot.progress[1 - challenger] = Math.max(0, num(depot.progress[1 - challenger], 0) - rate * 0.75);
   if (depot.progress[challenger] >= 1) captureDepot(match, traversal, depot, challenger);
  }
 } else if (!depot.hq && depot.contested) {
  depot.progress[0] = Math.max(0, num(depot.progress[0], 0) - dt / Math.max(0.5, depot.captureSeconds) * 0.75);
  depot.progress[1] = Math.max(0, num(depot.progress[1], 0) - dt / Math.max(0.5, depot.captureSeconds) * 0.75);
 }

 // Vehicle loaner: an owned depot keeps exactly one Puma in the world; a
 // destroyed one rides the core 25 s respawn timer and comes back immune.
 if (depot.owner !== 0 && depot.owner !== 1) return;
 const vehicle = depot.vehicleId != null ? match.vehicles.find(entry => entry.id === depot.vehicleId) : null;
 if (vehicle && vehicle.health > 0) { depot.respawn = 0; depot.vehicleHealth = vehicle.health; return; }
 if (vehicle && vehicle.health <= 0) { depot.respawn = num(vehicle.respawnTimer, depot.respawn); depot.vehicleHealth = 0; return; }
 depot.respawn = Math.max(0, num(depot.respawn, 0) - dt);
 if (!(num(depot.respawn, 0) > 0)) spawnDepotVehicle(match, traversal, depot);
}

/** Count a board/use of a depot vehicle (called by the engine's enter path). */
export function noteVehicleUse(traversal, vehicle) {
 if (!traversal || !vehicle?.depotId) return false;
 traversal.stats.vehicleUses = num(traversal.stats.vehicleUses, 0) + 1;
 return true;
}

/**
 * The §6A.5 `REQ`-purchase seam is deliberately stubbed for this wave: the
 * first-come depot loaner ships, while buying a Puma with personal `REQ` is
 * labelled but not wired. Kept here so the deployment menu has one stable call
 * to light up later without touching the engine.
 */
export function purchaseDepotVehicle() {
 return {ok: false, item: 'puma', cost: 150, reason: 'req-purchase-v1-later'};
}

// ===========================================================================
// Engine step
// ===========================================================================
/** Advance one fixed tick. Called by `stepCocs` after the actor loop. */
export function stepCocsTraversal(match, state, dt) {
 const traversal = state?.traversal;
 if (!traversal) return null;
 traversal.tick = num(traversal.tick, 0) + 1;
 for (const key of Object.keys(traversal.cooldowns)) {
  const next = num(traversal.cooldowns[key], 0) - dt;
  if (next > 0) traversal.cooldowns[key] = next;
  else delete traversal.cooldowns[key];
 }
 for (const vehicle of match?.vehicles ?? []) {
  if (vehicle && finite(vehicle.spawnImmunity)) vehicle.spawnImmunity = Math.max(0, vehicle.spawnImmunity - dt);
 }
 for (const id of sortedStrings(traversal.depots)) stepDepot(match, traversal, traversal.depots[id], dt);
 tickDevices(match, traversal, dt);
 tryDeviceUse(match, traversal);
 tryDeviceSabotage(match, traversal, dt);
 tickArrivals(match, traversal, dt);
 return traversal;
}

// ===========================================================================
// Explicit API (tests / input wiring)
// ===========================================================================
/** Force one device use for an actor when the live state allows it. */
export function useDevice(match, state, actorId, deviceId) {
 const traversal = state?.traversal;
 const device = traversal?.devices?.[deviceId];
 const actor = match?.actors?.[actorId];
 if (!traversal || !device || !actor) return false;
 return useDeviceInternal(match, traversal, device, actor);
}

/** Begin a cut/lock/repair hold for an actor (the `interact` edge). */
export function deviceInteract(match, state, actorId, deviceId, action = null) {
 const traversal = state?.traversal;
 const device = traversal?.devices?.[deviceId];
 const actor = match?.actors?.[actorId];
 if (!traversal || !device || !actor) return false;
 const resolved = action ?? (device.state === 'live' ? sabotageAction(device) : 'repair');
 if (resolved === 'repair') {
  if (device.state === 'live') return false;
 } else if (device.state !== 'live') return false;
 if (!actorAtAnchor(actor, device.from)) return false;
 return startDeviceChannel(match, traversal, device, actor, resolved);
}

/**
 * The human `interact` edge against the §6A device layer. Deterministic: one
 * nearest device within the 6 m interact reach, ties broken by sorted id. On a
 * live device the existing reaches disambiguate the single bind — at the 0.9 m
 * anchor a traversable device is ridden (`useDevice`), while anywhere else in
 * the 6 m band a cuttable/lockable one starts its cut/lock channel. A dead
 * device starts the repair channel. Returns `{deviceId, kind, action}` or null.
 *
 * This is the human twin of the bot-only `tryDeviceUse`/`tryDeviceSabotage`
 * path; bots never call it and their behaviour is untouched.
 */
export function humanDeviceInteract(match, state, actor) {
 const traversal = state?.traversal;
 if (!traversal || !actor || actor.health <= 0) return null;
 if (actor.team !== 0 && actor.team !== 1) return null;
 if (actor.vehicleId !== null && actor.vehicleId !== undefined) return null;
 if (actor.zipRide) return null; // no device channels while riding a cable
 let nearest = null;
 let nearestDistance = Infinity;
 for (const id of sortedStrings(traversal.devices)) {
  const device = traversal.devices[id];
  if (!device?.from) continue;
  const d = distance(actor, device.from);
  if (!(d <= DEVICE_INTERACT_METERS)) continue;
  if (nearest === null || d < nearestDistance - 1e-9) { nearest = device; nearestDistance = d; }
 }
 if (!nearest) return null;
 const anchored = nearestDistance <= TRAVERSAL.anchorReachMeters + 1e-9 && actorAtAnchor(actor, nearest.from);
 if (nearest.state === 'live') {
  if (anchored && TRAVERSABLE_KINDS.has(nearest.kind)) {
   return useDeviceInternal(match, traversal, nearest, actor) ? {deviceId: nearest.id, kind: nearest.kind, action: 'use'} : null;
  }
  if (nearest.cuttable === true || nearest.lockable === true) {
   const action = sabotageAction(nearest);
   return deviceInteract(match, state, actor.id, nearest.id, action) ? {deviceId: nearest.id, kind: nearest.kind, action} : null;
  }
  return null;
 }
 if (nearest.cuttable === true || nearest.lockable === true) {
  return deviceInteract(match, state, actor.id, nearest.id, 'repair') ? {deviceId: nearest.id, kind: nearest.kind, action: 'repair'} : null;
 }
 return null;
}

// ===========================================================================
// Snapshot (id-keyed, delta-friendly)
// ===========================================================================
/** Additive `snapshot.cocs.traversal` subtree, or null when unauthored. */
export function cocsTraversalSnapshot(state) {
 const traversal = state?.traversal;
 if (!traversal) return null;
 const devices = sortedStrings(traversal.devices).map(id => {
  const device = traversal.devices[id];
  return {
   id,
   kind: device.kind,
   lane: device.lane,
   state: device.state,
   timer: round(device.timer),
   x: num(device.from?.x, 0),
   z: num(device.from?.z, 0),
   to: {x: num((device.target ?? device.to)?.x, 0), z: num((device.target ?? device.to)?.z, 0)},
   channel: device.channel ? {actor: device.channel.actor, action: device.channel.action, remaining: round(device.channel.remaining), total: round(device.channel.total)} : null,
  };
 });
 const depots = sortedStrings(traversal.depots).map(id => {
  const depot = traversal.depots[id];
  return {
   id,
   lane: depot.lane,
   hq: depot.hq === true,
   x: depot.x,
   z: depot.z,
   owner: depot.owner,
   progress: [round(depot.progress?.[0]), round(depot.progress?.[1])],
   contested: depot.contested === true,
   vehicle: {id: depot.vehicleId, health: num(depot.vehicleHealth, 0), respawn: round(depot.respawn)},
  };
 });
 const arrivals = sortedIds(traversal.arrivals).map(id => ({actor: id, remaining: round(traversal.arrivals[id].remaining), telegraph: traversal.arrivals[id].telegraph === true, x: num(traversal.arrivals[id].x, 0), z: num(traversal.arrivals[id].z, 0)}));
 return {tick: num(traversal.tick, 0), devices, depots, arrivals, stats: {...traversal.stats}};
}
