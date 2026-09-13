import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_VERSION,
  demoHeader,
  roundNumber,
  DemoRecorder,
  DemoPlayer,
  serializeDemo,
  parseDemo,
  compressDemo,
  decompressDemo,
  trimDemo,
} from './demo.mjs';

function actor(over = {}) {
  return {
    id: 0, character: 'chatgpt', harness: 'openclaw', name: 'A', team: 0,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0,
    health: 100, maxHealth: 100, armor: 0, dead: false, weapon: 0, ammo: [10, 0, 0],
    active: 0, cooldown: 0, sprinting: false, crouching: false, sliding: false, ads: false,
    grounded: true, eyeHeight: 1.6, vehicleId: null, protection: 0, slow: 0, reloading: false,
    punchYaw: 0, punchPitch: 0, frags: 0, deaths: 0, scoreStats: {}, powerups: {},
    bot: { state: 'idle', route: [1, 2, 3] },
    ...over,
  };
}

function stateAt(time, over = {}) {
  return {
    config: { mode: 'deathmatch', timeLimit: 300 },
    modeName: 'Deathmatch',
    mapId: 'exchange',
    mapName: 'Exchange',
    time,
    over: false,
    feed: [],
    actors: [actor()],
    vehicles: [{
      id: 0, kind: 'warthog', x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, roll: 0,
      pitchBody: 0, turretYaw: 0, health: 100, maxHealth: 100, driver: null, heat: 0,
      overheated: false, respawnTimer: 0,
    }],
    pickups: [{ kind: 'health', x: 1, y: 0, z: 2, wait: 0 }],
    flags: [],
    teamScores: { 0: 0, 1: 0 },
    winner: null,
    objectives: null,
    rockets: [{
      id: 0, owner: 0, weapon: 1, pos: { x: 0, y: 0, z: 0 }, dir: { x: 1, y: 0, z: 0 },
      vy: 0, damageMultiplier: 1, life: 5, bounces: 0,
    }],
    stats: { shots: 0, kills: 0, pickups: 0, powers: 0, respawns: 0, falls: 0 },
    leaders: ['A'],
    ...over,
  };
}

function twoFrameDemo() {
  const k0 = stateAt(0);
  const k1 = stateAt(1);
  Object.assign(k1.actors[0], { x: 10, z: 20, yaw: Math.PI - 0.1, pitch: 1, health: 50, vx: 4 });
  Object.assign(k0.actors[0], { x: 0, z: 0, yaw: -Math.PI + 0.1, pitch: 0, health: 100, vx: 0 });
  Object.assign(k1.vehicles[0], { x: 8, z: 16, yaw: Math.PI - 0.05, roll: 0.4, turretYaw: 1 });
  Object.assign(k0.vehicles[0], { x: 0, z: 0, yaw: -Math.PI + 0.05, roll: 0, turretYaw: 0 });
  Object.assign(k1.rockets[0].pos, { x: 6, y: 2, z: 4 });
  return {
    version: DEMO_VERSION,
    createdAt: '2020-01-01T00:00:00.000Z',
    header: demoHeader(k0),
    meta: {},
    keyframes: [{ time: 0, state: k0 }, { time: 1, state: k1 }],
    events: [],
  };
}

test('roundNumber rounds to the requested precision', () => {
  assert.equal(roundNumber(1.23456), 1.23);
  assert.equal(roundNumber(1.23556, 3), 1.236);
  assert.equal(roundNumber(-2.345), -2.35);
  assert.equal(roundNumber(Infinity), Infinity);
});

test('demoHeader extracts the serializable match identity', () => {
  const header = demoHeader(stateAt(3));
  assert.equal(header.version, DEMO_VERSION);
  assert.equal(header.mapId, 'exchange');
  assert.equal(header.mapName, 'Exchange');
  assert.equal(header.modeName, 'Deathmatch');
  assert.deepEqual(header.config, { mode: 'deathmatch', timeLimit: 300 });
  assert.deepEqual(header.teamScores, { 0: 0, 1: 0 });
});

test('recorder decimates 60Hz snapshots to recordHz keyframes', () => {
  const recorder = new DemoRecorder({ recordHz: 18 });
  for (let i = 0; i < 60; i++) recorder.frame(stateAt(i / 60));
  assert.equal(recorder.frameCount, 15);
  assert.ok(Math.abs(recorder.duration - 56 / 60) < 1e-9);
  assert.equal(recorder.sampleTime(), 59 / 60);
});

test('recorder always stores the first frame and clones the source state', () => {
  const recorder = new DemoRecorder({ recordHz: 1 });
  const live = stateAt(0);
  recorder.frame(live);
  live.actors[0].x = 999;
  live.actors[0].bot.route.push(4);
  const demo = recorder.finish({ createdAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(demo.keyframes.length, 1);
  assert.equal(demo.keyframes[0].state.actors[0].x, 0);
  assert.equal('bot' in demo.keyframes[0].state.actors[0], false);
});

test('recorder dedupes events by id but records events between keyframes', () => {
  const recorder = new DemoRecorder({ recordHz: 1 });
  recorder.frame(stateAt(0), [{ type: 'shot', id: 1, time: 0 }]);
  recorder.frame(stateAt(0.1), [{ type: 'shot', id: 1, time: 0.1 }, { type: 'pickup', id: 2, time: 0.1 }]);
  assert.equal(recorder.frameCount, 1);
  assert.equal(recorder.events.length, 2);
  assert.deepEqual(recorder.events.map(e => e.id), [1, 2]);
});

test('player linearly interpolates actors, vehicles and rockets', () => {
  const player = new DemoPlayer(twoFrameDemo());
  const mid = player.sample(0.5);
  assert.equal(mid.time, 0.5);
  assert.equal(mid.actors[0].x, 5);
  assert.equal(mid.actors[0].z, 10);
  assert.equal(mid.actors[0].vx, 2);
  assert.equal(mid.actors[0].pitch, 0.5);
  assert.equal(mid.actors[0].health, 100);
  assert.ok(Math.abs(Math.abs(mid.actors[0].yaw) - Math.PI) < 1e-6);
  assert.equal(mid.vehicles[0].x, 4);
  assert.equal(mid.vehicles[0].z, 8);
  assert.equal(mid.vehicles[0].roll, 0.2);
  assert.equal(mid.vehicles[0].turretYaw, 0.5);
  assert.ok(Math.abs(Math.abs(mid.vehicles[0].yaw) - Math.PI) < 1e-6);
  assert.equal(mid.rockets[0].pos.x, 3);
  assert.equal(mid.rockets[0].pos.y, 1);
  assert.equal(mid.rockets[0].pos.z, 2);
});

test('sample returns fresh objects and clamps time to the duration', () => {
  const player = new DemoPlayer(twoFrameDemo());
  const first = player.sample(0.5);
  first.actors[0].x = 123;
  assert.equal(player.sample(0.5).actors[0].x, 5);
  const before = player.sample(-10);
  assert.equal(before.time, 0);
  assert.equal(before.actors[0].x, 0);
  const after = player.sample(10);
  assert.equal(after.time, 1);
  assert.equal(after.actors[0].x, 10);
});

test('sample returns null for an empty demo', () => {
  const player = new DemoPlayer({ keyframes: [], events: [] });
  assert.equal(player.frameCount, 0);
  assert.equal(player.duration, 0);
  assert.equal(player.sample(0), null);
  assert.equal(new DemoPlayer({}).sample(1), null);
});

test('eventsBetween is bounded by (t0, t1] and sorted; nextEventTime walks forward', () => {
  const demo = twoFrameDemo();
  demo.events = [
    { type: 'death', id: 3, time: 3 },
    { type: 'shot', id: 1, time: 1 },
    { type: 'damage', id: 2, time: 2 },
    { type: 'spawn', id: 4, time: 1.5 },
  ];
  const player = new DemoPlayer(demo);
  assert.deepEqual(player.eventsBetween(1, 3).map(e => e.id), [4, 2, 3]);
  assert.deepEqual(player.eventsBetween(0, 1).map(e => e.id), [1]);
  assert.equal(player.nextEventTime(0), 1);
  assert.equal(player.nextEventTime(2.5), 3);
  assert.equal(player.nextEventTime(3), null);
});

test('serialize/parse round-trips essential fields', () => {
  const recorder = new DemoRecorder({ recordHz: 10, meta: { tag: 'theater' } });
  recorder.frame(stateAt(0), [{ type: 'shot', id: 1, time: 0 }]);
  recorder.frame(stateAt(0.5), [{ type: 'death', id: 2, time: 0.5 }]);
  const demo = recorder.finish({ createdAt: '2020-01-01T00:00:00.000Z' });
  const parsed = parseDemo(serializeDemo(demo));
  assert.deepEqual(parsed.header, demo.header);
  assert.equal(parsed.keyframes.length, demo.keyframes.length);
  assert.deepEqual(parsed.events, demo.events);
  assert.equal(parsed.meta.tag, 'theater');
  const fromBytes = parseDemo(new TextEncoder().encode(serializeDemo(demo)));
  assert.deepEqual(fromBytes, parsed);
});

test('parseDemo rejects wrong versions and malformed payloads', () => {
  assert.throws(() => parseDemo('{"version":2,"keyframes":[]}'), /version/);
  assert.throws(() => parseDemo('not json'), /Invalid demo JSON/);
  assert.throws(() => parseDemo(42), /string or Uint8Array/);
});

test('compress/decompress round-trips gzip when available and falls back to plain bytes', async () => {
  const demo = twoFrameDemo();
  const bytes = await compressDemo(demo);
  assert.ok(bytes instanceof Uint8Array);
  if (typeof CompressionStream !== 'undefined') {
    assert.equal(bytes[0], 0x1f);
    assert.equal(bytes[1], 0x8b);
    assert.deepEqual(await decompressDemo(bytes), demo);
  } else {
    assert.deepEqual(parseDemo(bytes), demo);
  }
  const plain = new TextEncoder().encode(serializeDemo(demo));
  assert.deepEqual(await decompressDemo(plain), demo);
});

test('trimDemo caps keyframes and events at maxSeconds', () => {
  const demo = {
    ...twoFrameDemo(),
    keyframes: [
      { time: 0, state: stateAt(0) },
      { time: 1, state: stateAt(1) },
      { time: 2, state: stateAt(2) },
    ],
    events: [{ type: 'shot', id: 1, time: 0.5 }, { type: 'shot', id: 2, time: 1.5 }],
  };
  const trimmed = trimDemo(demo, 1);
  assert.equal(trimmed.keyframes.length, 2);
  assert.equal(trimmed.keyframes[1].time, 1);
  assert.deepEqual(trimmed.events.map(e => e.id), [1]);
  assert.equal(demo.keyframes.length, 3);
});
test('player shows entities that appear after the first keyframe', () => {
  const demo = twoFrameDemo();
  demo.keyframes[0].state.rockets = [];
  const mid = new DemoPlayer(demo).sample(0.5);
  assert.equal(mid.rockets.length, 1);
  assert.equal(mid.rockets[0].id, 0);
  assert.deepEqual(mid.rockets[0].pos, { x: 6, y: 2, z: 4 });
});

test('player removes entities despawned by the next keyframe', () => {
  const demo = twoFrameDemo();
  demo.keyframes[1].state.rockets = [];
  assert.equal(new DemoPlayer(demo).sample(0.5).rockets.length, 0);
});

test('player includes actors and vehicles that appear mid-recording', () => {
  const demo = twoFrameDemo();
  demo.keyframes[0].state.actors = [];
  demo.keyframes[0].state.vehicles = [];
  const mid = new DemoPlayer(demo).sample(0.5);
  assert.equal(mid.actors.length, 1);
  assert.equal(mid.vehicles.length, 1);
});

test('recorder stops sampling keyframes once the max duration is reached', () => {
  const recorder = new DemoRecorder({ recordHz: 1, maxSeconds: 2 });
  for (let i = 0; i < 10; i++) recorder.frame(stateAt(i));
  assert.equal(recorder.frameCount, 3);
  assert.equal(recorder.keyframes.at(-1).time, 2);
});

test('recorder stops appending events once past maxSeconds and keeps pre-cutoff events', () => {
  const recorder = new DemoRecorder({ recordHz: 10, maxSeconds: 1 });
  for (let i = 0; i <= 100; i++) {
    const time = i / 10;
    recorder.frame(stateAt(time), [{ type: 'shot', id: i, time }]);
  }
  const demo = recorder.finish({ createdAt: '2020-01-01T00:00:00.000Z' });
  const cutoff = demo.keyframes[0].time + 1;
  assert.equal(recorder.duration, 1);
  assert.equal(demo.events.length, 11);
  assert.ok(demo.events.every(event => event.time <= cutoff));
  assert.ok(demo.events.every(event => event.time <= demo.keyframes.at(-1).time));
});
