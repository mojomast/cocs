import test from 'node:test';
import assert from 'node:assert/strict';
import {Match, obstructed, floorAt} from '../core.mjs';
import {MAPS} from '../maps.mjs';
import {arenaMeta} from '../arenas.mjs';
import {RULES} from '../data.mjs';
import {actorWon} from '../outcome.mjs';
import {payloadTemplate, stepPayload} from '../payload.mjs';
import {botBehavior} from '../bot-personalities.mjs';

const seeded = () => { let n = 17; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };

test('an assault score-limit capture ends the match for the attackers', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'rampart', {mode: 'assault', botCount: 0, humanCount: 2, fragLimit: 1, timeLimit: 60});
  const state = m.objectiveState, sector = state.sectors[state.active], attacker = m.actors[0];
  Object.assign(attacker, {x: sector.x, y: sector.y ?? 0, z: sector.z, health: 100, protection: 0});
  for (let i = 0; i < 8 * 60 && !m.over; i++) m.step(1 / 60);
  assert.equal(m.over, true, 'capturing the configured sector count must end the round');
  assert.equal(m.snapshot().winner, state.attacker, 'the attacker wins, not the defender on the clock');
});

test('a payload score-limit win ends the match', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'convoy-line', {mode: 'payload', botCount: 0, humanCount: 2, timeLimit: 60});
  const state = m.objectiveState;
  assert.equal(state.kind, 'payload');
  state.winner = state.attacker ?? 0;
  m.updatePayload(1 / 60);
  assert.equal(m.over, true);
  assert.equal(m.snapshot().winner, state.attacker ?? 0);
});

test('payload routes stay finite and never collapse to instant delivery', () => {
  const arena = {bounds: {minX: -50, maxX: 50, minZ: -50, maxZ: 50}, teamSpawns: {0: [[NaN, NaN]], 1: [[NaN, NaN]]}, spawns: [[NaN, NaN]], blocks: [], objectiveZones: [{x: NaN, z: NaN}], navNodes: [{x: NaN, z: NaN}], pickups: []};
  const state = payloadTemplate(arena, {segments: 3});
  assert.ok(state.path.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)), 'route is finite');
  assert.ok(state.total > 0, 'route has length');
  const actor = {x: state.position.x, y: state.position.y, z: state.position.z, team: 0, health: 100};
  stepPayload(state, [actor], 1 / 60, {teamScores: {0: 0, 1: 0}, scoreLimit: 3});
  assert.equal(state.delivered, false, 'a degenerate route must not deliver in one tick');
});

test('objective zones land on navigable ground on every objective map', () => {
  for (const map of MAPS) {
    const meta = arenaMeta(map.id);
    if (!meta) continue;
    for (const mode of ['koth', 'domination']) {
      if (!meta.play.includes(mode)) continue;
      const m = new Match('chatgpt', 'openclaw', seeded(), map.id, {mode, botCount: 0, humanCount: 1, timeLimit: 5, fragLimit: 5});
      for (const zone of m.objectiveState.zones) {
        let nearest = Infinity;
        for (const node of m.nav) nearest = Math.min(nearest, Math.hypot(node.x - zone.x, node.z - zone.z));
        assert.ok(nearest <= 2.5, `${map.id} ${mode} zone ${zone.id} must be navigable (nearest ${nearest.toFixed(1)}m)`);
      }
    }
  }
});

test('combined-arms bots engage on titan-valley instead of idling on unreachable ground', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'titan-valley', {mode: 'combined-arms', botCount: 7, humanCount: 1, difficulty: 'normal', timeLimit: 60, fragLimit: 20});
  for (let i = 0; i < 60 * 60 && !m.over; i++) m.step(1 / 60);
  assert.ok(m.stats.shots > 0, `bots must fire (shots ${m.stats.shots})`);
  assert.ok(m.teamScores[0] + m.teamScores[1] > 0 || m.stats.kills > 0, `objective must progress (${m.teamScores[0]}/${m.teamScores[1]}, kills ${m.stats.kills})`);
});

test('a zero-frag free-for-all is a draw, not a win', () => {
  assert.equal(actorWon({actors: [{frags: 0}]}, 'deathmatch', {frags: 0}), false);
  assert.equal(actorWon({actors: []}, 'instagib', {frags: 0}), false);
  assert.equal(actorWon({actors: [{frags: 3}, {frags: 1}]}, 'deathmatch', {frags: 3}), true);
});

test('bots start with the ledge guard armed and bail out of passenger seats', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'blood-gulch', {mode: 'ctf', botCount: 2, humanCount: 2});
  const bots = m.actors.filter(a => a.bot);
  assert.ok(bots.every(a => a.bot.recover === 0), 'recover initialised so void avoidance is active from spawn');
  const vehicle = m.vehicles[0], [h1, h2, passenger] = m.actors;
  for (const [index, actor] of [h1, h2, passenger].entries()) Object.assign(actor, {x: vehicle.position.x + index * .4, y: vehicle.position.y, z: vehicle.position.z, grounded: true, protection: 0});
  m.enterVehicle(h1); m.enterVehicle(h2); m.enterVehicle(passenger);
  assert.equal(passenger.vehicleSeat, 'passenger');
  assert.equal(m.botInput(passenger, 1 / 60).interact, true, 'a passenger bot asks to exit');
});

test('mounted bots keep advancing instead of parking on their own vehicle', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'ctf', botCount: 7, timeLimit: 120});
  for (let i = 0; i < 10 * 60 && !m.over; i++) m.step(1 / 60);
  const mounted = m.actors.filter(a => a.bot && a.vehicleId !== null);
  const parked = mounted.filter(a => { const v = m.vehicleById(a.vehicleId); return a.bot.destination && v && Math.hypot(a.bot.destination.x - v.position.x, a.bot.destination.z - v.position.z) < 1.5; });
  assert.ok(m.stats.shots > 0, 'mounted bots engage');
  assert.equal(parked.length, 0, 'no mounted bot retargets its own rig');
});

test('a bot gunner fires the mounted chaingun at a visible enemy', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'deathmatch', botCount: 2, humanCount: 1});
  const driver = m.actors[0], gunner = m.actors[1], enemy = m.actors[2], vehicle = m.vehicles[0];
  Object.assign(vehicle.position, {x: 0, y: 0, z: 0});
  vehicle.heading = 0; vehicle.turretYaw = 0; vehicle.velocity = {x: 0, z: 0};
  Object.assign(driver, {x: 0, y: 0, z: 0, grounded: true, protection: 0});
  m.enterVehicle(driver);
  Object.assign(gunner, {x: .4, y: 0, z: 0, grounded: true, protection: 0, yaw: Math.PI, pitch: 0});
  m.enterVehicle(gunner);
  Object.assign(enemy, {x: 0, y: 0, z: 8, health: 300, armor: 0, protection: 0, grounded: true});
  gunner.bot.target = enemy.id; gunner.bot.memory = 1; gunner.bot.think = 99;
  const before = enemy.health;
  for (let i = 0; i < 40; i++) { gunner.bot.memory = 1; m.gunnerVehicle(gunner, {}, 1 / 60); }
  assert.ok(m.events.some(event => event.type === 'vehicle-shot'), 'bot gunner should fire');
  assert.ok(enemy.health < before || enemy.deaths > 0, 'bot gunner shots should connect');
});

test('Roo Context Jam spares teammates', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'exchange', {mode: 'teamdeathmatch', botCount: 0, humanCount: 3});
  const [roo, mate, enemy] = m.actors, spot = m.spawns[0];
  roo.harness = 'roo'; roo.team = 0; mate.team = 0; enemy.team = 1;
  Object.assign(roo, {x: spot.x, y: spot.y, z: spot.z, health: 100, protection: 0, cooldown: 0});
  Object.assign(mate, {x: spot.x + 1, y: spot.y, z: spot.z, health: 100, protection: 0, slow: 0});
  Object.assign(enemy, {x: spot.x, y: spot.y, z: spot.z + 1, health: 100, protection: 0, slow: 0});
  assert.equal(m.power(roo), true, 'Context Jam activates');
  assert.equal(mate.slow, 0, 'teammate must not be jammed');
  assert.ok(enemy.slow > 0, 'enemy is jammed');
});

test('personality strafe actually varies between harnesses', () => {
  const a = botBehavior({character: 'chatgpt', harness: 'openclaw', id: 5}).strafe;
  const b = botBehavior({character: 'chatgpt', harness: 'roo', id: 5}).strafe;
  assert.notEqual(a, b, 'different personalities must produce different strafe values');
});

test('bots make objective progress on a large combined-arms map', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'titan-valley', {mode: 'combined-arms', botCount: 9, difficulty: 'normal', timeLimit: 120, fragLimit: 200});
  for (let i = 0; i < 45 * 60 && !m.over; i++) m.step(1 / 60);
  const zones = m.objectiveState.zones;
  assert.ok(zones.some(zone => zone.owner !== null || zone.progress > 0), 'bots should contest or capture objectives');
  assert.ok(m.stats.shots > 0, 'bots should engage');
});

test('bots get a standable objective slot when the centre is inside geometry', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'koth', botCount: 1, humanCount: 1});
  m.arena = {id: 'slots', bounds: {minX: -20, maxX: 20, minZ: -20, maxZ: 20}, blocks: [{kind: 'cover', x: 0, z: 0, w: 6, d: 6, h: 5}], spawns: [[-10, 0], [10, 0]], teamSpawns: {0: [[-10, 0]], 1: [[10, 0]]}, pickups: [], vehicles: []};
  m.nav = [{x: 4, z: 0}, {x: -4, z: 0}, {x: 0, z: 5}];
  m.spawns = [{x: -10, y: 0, z: 0}, {x: 10, y: 0, z: 0}];
  m.teamSpawns = {0: [[-10, 0]], 1: [[10, 0]]};
  const bot = m.actors.find(a => a.bot);
  const zone = {id: 'alpha', x: 0, z: 0, radius: 3.5, owner: null, captureTeam: null, progress: 0, y: 0};
  const slot = m.zoneSlot(bot, zone, bot.team ?? 0);
  assert.ok(Number.isFinite(slot.x) && Number.isFinite(slot.z));
  assert.equal(obstructed(slot.x, slot.y, slot.z, RULES.radius * .9, m.arena), false, 'slot must be standable');
});

test('bots do not churn into and out of passenger seats', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'ctf', botCount: 7, timeLimit: 120});
  let enters = 0, exits = 0;
  const emit = m.emit.bind(m);
  m.emit = (type, data) => { if (type === 'vehicle-enter') enters++; if (type === 'vehicle-exit') exits++; return emit(type, data); };
  for (let i = 0; i < 15 * 60 && !m.over; i++) m.step(1 / 60);
  assert.ok(enters + exits < 30, `vehicle seat churn (${enters} enter / ${exits} exit)`);
  assert.equal(m.actors.filter(a => a.bot && a.vehicleSeat === 'passenger').length, 0, 'no bot rides as cargo');
});

test('a blocked spawn point is nudged to clear ground', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 1});
  m.arena = {id: 'spawnsafe', bounds: {minX: -20, maxX: 20, minZ: -20, maxZ: 20}, blocks: [{kind: 'cover', x: 0, z: 0, w: 8, d: 8, h: 5}], spawns: [[0, 0]], teamSpawns: {0: [[0, 0]], 1: [[0, 0]]}, pickups: [], vehicles: []};
  m.spawns = [{x: 0, y: 0, z: 0}];
  m.nav = [{x: 8, z: 0}, {x: -8, z: 0}];
  const actor = m.actors[0];
  m.spawn(actor);
  assert.equal(obstructed(actor.x, actor.y, actor.z, RULES.radius, m.arena), false, 'spawn is nudged clear');
});

test('a bot gunner dismounts from a vehicle whose driver has left', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'blood-gulch', {mode: 'ctf', botCount: 3, humanCount: 1, timeLimit: 30});
  const tank = m.vehicles[0], bots = m.actors.filter(a => a.bot);
  const driver = bots[0], gunner = bots[1];
  for (const a of [driver, gunner]) Object.assign(a, {x: tank.position.x, y: tank.position.y, z: tank.position.z, grounded: true});
  assert.ok(m.enterVehicle(driver));
  assert.ok(m.enterVehicle(gunner));
  assert.equal(gunner.vehicleSeat, 'gunner', 'setup: gunner boarded');
  m.releaseVehicle(driver, tank, 'exit');
  driver.bot.vehicleCooldown = 99;
  for (let i = 0; i < 60 && gunner.vehicleId !== null; i++) m.step(1 / 60);
  assert.equal(gunner.vehicleId, null, 'orphaned gunner must dismount instead of freezing');
});

test('a mounted bot does not fire its personal weapon', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'blood-gulch', {mode: 'ctf', botCount: 1, humanCount: 1, timeLimit: 30});
  const tank = m.vehicles[0], bot = m.actors.find(a => a.bot), human = m.actors[0];
  Object.assign(bot, {x: tank.position.x, y: tank.position.y, z: tank.position.z, grounded: true});
  assert.ok(m.enterVehicle(bot));
  assert.equal(bot.vehicleSeat, 'driver');
  Object.assign(human, {x: tank.position.x + 8, y: tank.position.y, z: tank.position.z, health: 100, protection: 0});
  bot.bot.target = human.id;
  bot.bot.memory = 2;
  let personal = 0;
  const emit = m.emit.bind(m);
  m.emit = (type, data) => { if (type === 'shot' && data.actor === bot.id) personal++; return emit(type, data); };
  for (let i = 0; i < 120; i++) m.step(1 / 60);
  assert.equal(personal, 0, 'mounted bot fired its personal weapon');
});

test('a mounted actor cannot pick up the flag', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'blood-gulch', {mode: 'ctf', botCount: 0, humanCount: 2, timeLimit: 30});
  const a = m.actors[0], flag = m.flags[1], tank = m.vehicles[0];
  Object.assign(a, {x: tank.position.x, y: tank.position.y, z: tank.position.z, grounded: true});
  assert.ok(m.enterVehicle(a));
  Object.assign(a, {x: flag.x, y: flag.y ?? tank.position.y, z: flag.z});
  m.objective(a);
  assert.equal(flag.state, 'at-base', 'mounted actor must not carry the flag');
  assert.equal(flag.carrier, null);
});

test('exiting a flying vehicle keeps the actor aloft instead of teleporting down', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'titan-valley', {mode: 'combined-arms', botCount: 0, humanCount: 1, timeLimit: 30});
  const a = m.actors[0], hornet = m.vehicles.find(v => v.config?.flight === true);
  assert.ok(hornet, 'map has a flying vehicle');
  Object.assign(a, {x: hornet.position.x, y: hornet.position.y, z: hornet.position.z, grounded: true});
  assert.ok(m.enterVehicle(a));
  hornet.position.y = 40;
  m.syncVehicleActor(a, hornet);
  m.releaseVehicle(a, hornet, 'exit');
  assert.ok(a.y > 15, `exit should keep altitude, got ${a.y}`);
  assert.equal(a.grounded, false);
});

test('an empty vehicle keeps its crew team for friendly-fire protection', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'blood-gulch', {mode: 'ctf', botCount: 0, humanCount: 2, timeLimit: 30});
  const a = m.actors[0], tank = m.vehicles[0];
  tank.lastTeam = a.team;
  const before = tank.health;
  assert.equal(m.damageVehicle(tank, 60, a), 0, 'friendly fire must not damage an owned empty vehicle');
  assert.equal(tank.health, before);
});

test('a tied timed match enters sudden death and the next score decides it', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'colosseum', {mode: 'teamdeathmatch', botCount: 0, humanCount: 2, timeLimit: 5, fragLimit: 50, suddenDeath: true});
  m.teamScores[0] = 3; m.teamScores[1] = 3;
  m.time = m.config.timeLimit - 1 / 60;
  m.step(1 / 60);
  assert.equal(m.suddenDeath, true, 'a tied clock enters sudden death');
  assert.equal(m.over, false, 'the match continues');
  assert.equal(m.snapshot().suddenDeath, true);
  m.teamScores[0] = 4;
  m.step(1 / 60);
  assert.equal(m.over, true);
  assert.equal(m.overReason, 'sudden-death');
});

test('a decisive timed match still ends on the clock', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'colosseum', {mode: 'teamdeathmatch', botCount: 0, humanCount: 2, timeLimit: 5, fragLimit: 50});
  m.teamScores[0] = 3; m.teamScores[1] = 1;
  m.time = m.config.timeLimit - 1 / 60;
  m.step(1 / 60);
  assert.equal(m.over, true);
  assert.equal(m.overReason, 'time');
  assert.equal(m.suddenDeath, false);
});

test('bots do not acquire cloaked enemies at range', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'proving-grounds', {mode: 'deathmatch', botCount: 1, humanCount: 2, timeLimit: 60});
  const bot = m.actors.find(a => a.bot), enemy = m.actors.find(a => a !== bot && !a.bot);
  const put = (a, x, z) => { a.x = x; a.z = z; a.y = floorAt(x, z, m.arena) ?? 0; };
  put(bot, -6, 0); put(enemy, 6, 0);
  enemy.powerups = {};
  bot.bot.target = -1;
  for (let i = 0; i < 30; i++) { bot.bot.think = 0; m.step(1 / 60); }
  assert.equal(bot.bot.target, enemy.id, 'a visible enemy is acquired');
  put(bot, -6, 0); put(enemy, 6, 0);
  enemy.powerups = {cloak: 10}; bot.bot.target = -1;
  for (let i = 0; i < 12; i++) { bot.bot.think = 0; m.step(1 / 60); }
  assert.notEqual(bot.bot.target, enemy.id, 'a cloaked enemy is not acquired at range');
});

test('death and falling clear traversal and streak state', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 2, timeLimit: 60});
  const [a] = m.actors;
  a.streak = 4; a.zipRide = {t: 0, duration: 1, from: {x: 0, y: 0, z: 0}, to: {x: 1, y: 0, z: 1}}; a.traversalFlight = true;
  m.fall(a);
  assert.equal(a.streak, 0, 'fall resets the streak');
  assert.equal(a.zipRide, null, 'fall clears the zipline');
  assert.equal(a.traversalFlight, false);

  const m2 = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'deathmatch', botCount: 0, humanCount: 2, timeLimit: 60});
  const [c, d] = m2.actors;
  c.streak = 3; c.zipRide = {t: 0, duration: 1, from: {x: 0, y: 0, z: 0}, to: {x: 1, y: 0, z: 1}}; c.traversalFlight = true;
  Object.assign(c, {health: 1, protection: 0, armor: 0});
  m2.damage(c, 999, d);
  assert.equal(c.streak, 0, 'death resets the streak');
  assert.equal(c.zipRide, null, 'death clears the zipline');
  assert.equal(c.traversalFlight, false);
});

test('assault credits objective time and captures to attackers on the active sector', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'rampart', { mode: 'assault', botCount: 0, humanCount: 2, fragLimit: 3, timeLimit: 60 });
  const state = m.objectiveState, sector = state.sectors[state.active], attacker = m.actors.find(a => a.team === state.attacker);
  Object.assign(attacker, { x: sector.x, y: sector.y ?? 0, z: sector.z, health: 100, protection: 0 });
  for (let i = 0; i < 7 * 60 && !m.over; i++) m.updateAssault(1 / 60);
  assert.ok(attacker.scoreStats.objectiveTime > 5, `sector time should accrue (${attacker.scoreStats.objectiveTime})`);
  assert.ok(attacker.scoreStats.objectiveCaptures >= 1, `a fallen sector credits present attackers (${attacker.scoreStats.objectiveCaptures})`);
});

test('a flag dropped over the void falls back to reachable ground', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'skybreak', { mode: 'ctf', botCount: 0, humanCount: 2, timeLimit: 30 });
  const carrier = m.actors[0], flag = m.flags[1], x = -48, z = -30;
  assert.equal(floorAt(x, z, m.arena), null, 'probe point is over the void');
  Object.assign(carrier, { x, y: 12, z, health: 100, grounded: false, lastValid: { x: 0, y: floorAt(0, 0, m.arena) ?? 0, z: 0 } });
  flag.state = 'carried'; flag.carrier = carrier.id;
  m.dropFlag(carrier, { x, y: 12, z });
  assert.equal(flag.carrier, null, 'carrier releases the flag');
  assert.notEqual(flag.state, 'carried');
  assert.ok(floorAt(flag.x, flag.z, m.arena) !== null, `flag must rest on support (${flag.x},${flag.y},${flag.z})`);
  assert.deepEqual([flag.x, flag.z], [0, 0], 'flag falls back to the carrier lastValid');
});

test('an assault breach does not inflate the scoreboard past the capture count', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'rampart', {mode: 'assault', botCount: 0, humanCount: 2, fragLimit: 9, timeLimit: 60});
  const state = m.objectiveState;
  state.winner = state.attacker;
  m.updateAssault(1 / 60);
  assert.equal(m.over, true);
  assert.equal(m.snapshot().winner, state.attacker);
  assert.ok(m.teamScores[state.attacker] < 9, `score reflects captures (${m.teamScores[state.attacker]})`);
});

test('a simultaneous objective score-limit tie is not awarded to team 0', () => {
  const m = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {mode: 'domination', botCount: 0, humanCount: 2, fragLimit: 5, timeLimit: 60});
  const state = m.objectiveState, [a, b] = m.actors;
  const [z0, z1] = state.zones;
  Object.assign(z0, {owner: 0, progress: 100, captureTeam: null});
  Object.assign(z1, {owner: 1, progress: 100, captureTeam: null});
  Object.assign(a, {team: 0, x: z0.x, z: z0.z, y: z0.y ?? 0, health: 100, protection: 0});
  Object.assign(b, {team: 1, x: z1.x, z: z1.z, y: z1.y ?? 0, health: 100, protection: 0});
  m.teamScores[0] = m.config.fragLimit - 0.001;
  m.teamScores[1] = m.config.fragLimit - 0.001;
  m.updateObjectives(1 / 60);
  assert.equal(m.over, false, 'a tie does not end the match');
  assert.equal(m.teamScores[0], m.teamScores[1]);
});
