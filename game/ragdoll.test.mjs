// Deterministic presentation ragdolls: pool budgeting, seeded typed-array
// determinism, fixed-step frame-rate independence, sleep-freeze, late-plan
// reseeding, slot eviction and ground/block clearance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {CharacterLifecycle, CharacterRig} from './rig.mjs';
import {
  RAGDOLL_BONES, RAGDOLL_CHAIN, RAGDOLL_CONSTRAINTS, RAGDOLL_CONTACT_SLOP,
  RAGDOLL_FIXED_DT, RAGDOLL_MAX_AWAKE, RAGDOLL_MAX_SUBSTEPS, RAGDOLL_PARTICLES,
  RAGDOLL_RADIUS, RAGDOLL_REST, RagdollPool,
} from './ragdoll.mjs';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const frame = overrides => ({
  matrix: IDENTITY,
  invMatrix: IDENTITY,
  sampleGround: () => 0,
  fallbackGround: 0,
  blocks: null,
  ...overrides,
});

// Minimal articulated operator rig with the refined proportions so live
// capture and the joint adapter both have real hierarchy to walk.
function rigModel() {
  const model = new T.Group();
  const root = new T.Group();
  model.add(root);
  const joints = {root, rootBaseY: 0};
  const add = (key, parent, x, y, z) => {
    const node = new T.Group();
    node.position.set(x, y, z);
    parent.add(node);
    joints[key] = node;
    return node;
  };
  const hips = add('hips', root, 0, .7835, 0);
  const torso = add('torso', hips, 0, .22, 0);
  const chest = add('chest', torso, 0, .30, 0);
  add('head', chest, 0, .28, 0);
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'L' : 'R';
    const shoulder = add(`armUpper${key}`, chest, side * .3, .22, 0);
    const elbow = add(`forearm${key}`, shoulder, 0, -.29, 0);
    add(`hand${key}`, elbow, 0, -.275, 0);
    const hip = add(`legUpper${key}`, hips, side * .15, 0, 0);
    const knee = add(`legLower${key}`, hip, 0, -.34, 0);
    add(`foot${key}`, knee, 0, -.35, 0);
  }
  model.userData = {joints, rig: new CharacterRig(joints)};
  return model;
}

const deadActor = {id: 1, x: 0, y: 2, z: 0, yaw: 0, bodyYaw: 0, vx: 0, vy: 0, vz: 0, health: 0};
const plan = extra => ({pose: 'forward', style: 'ragdoll', seed: 7, splay: .7, roll: .3, spin: .6, force: 3, duration: 3, ...extra});

test('the particle table mirrors the operator mesh inside the 19-constraint budget', () => {
  assert.equal(RAGDOLL_PARTICLES, 16);
  assert.equal(RAGDOLL_CONSTRAINTS, 19);
  assert.equal(RAGDOLL_BONES.length, RAGDOLL_CONSTRAINTS * 2);
  assert.equal(RAGDOLL_REST.length, RAGDOLL_PARTICLES * 3);
  assert.equal(RAGDOLL_RADIUS.length, RAGDOLL_PARTICLES);
  assert.equal(RAGDOLL_CHAIN.length, RAGDOLL_PARTICLES);
  for (let i = 0; i < RAGDOLL_PARTICLES; i++) {
    assert.ok(RAGDOLL_RADIUS[i] > 0 && RAGDOLL_RADIUS[i] < .4, `radius ${i}`);
    assert.ok(Number.isFinite(RAGDOLL_REST[i * 3]) && Number.isFinite(RAGDOLL_REST[i * 3 + 1]) && Number.isFinite(RAGDOLL_REST[i * 3 + 2]), `rest ${i}`);
  }
  assert.equal(RAGDOLL_REST[0 * 3 + 1], .7835, 'pelvis sits at the refined hip height');
  assert.equal(RAGDOLL_REST[12 * 3 + 1], .0935, 'feet sit on the refined sole offset');
  const covered = new Set(RAGDOLL_CHAIN.map(link => link.particle));
  assert.equal(covered.size, RAGDOLL_PARTICLES, 'every particle drives one joint');
});

test('the pool caps capacity and awake corpses, sleeping the oldest', () => {
  const pool = new RagdollPool({capacity: 2, maxAwake: 1});
  const first = pool.acquire({seed: 1, plan: plan()});
  const second = pool.acquire({seed: 2, plan: plan({pose: 'back'})});
  assert.ok(first && second);
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.awakeCount, 1);
  assert.equal(first.awake, false, 'the oldest awake corpse was put to sleep');
  assert.equal(first.settled, true);
  assert.equal(second.awake, true);
  assert.equal(pool.acquire({seed: 3, plan: plan({pose: 'left'})}), null, 'a full pool refuses new corpses');
  const scratch = first.pos;
  assert.equal(pool.release(first), true);
  const third = pool.acquire({seed: 3, plan: plan({pose: 'left'})});
  assert.equal(third.pos, scratch, 'released slots reuse their typed-array scratch');
  assert.equal(pool.awakeCount, 1);
  assert.ok(RAGDOLL_MAX_AWAKE >= 2);
});

test('the lifecycle keeps at most six corpse physics bodies awake', () => {
  const life = new CharacterLifecycle({maxCorpses: 8});
  const models = [];
  for (let i = 0; i < RAGDOLL_MAX_AWAKE + 1; i++) {
    const model = rigModel();
    models.push(model);
    life.update(model, {...deadActor, id: 10 + i}, {time: 0, plan: plan({seed: i}), sampleGround: () => 0});
  }
  assert.equal(life.ragdolls.activeCount, RAGDOLL_MAX_AWAKE + 1);
  assert.equal(life.ragdolls.awakeCount, RAGDOLL_MAX_AWAKE);
  assert.equal(life.records.get(models[0]).ragdoll.awake, false, 'the oldest corpse was slept to free physics');
  assert.equal(life.records.get(models.at(-1)).ragdoll.awake, true);
  life.clear();
});

test('the same seed and frame stream produce identical typed arrays', () => {
  const run = () => {
    const pool = new RagdollPool({capacity: 1, maxAwake: 1});
    const slot = pool.acquire({
      seed: 11, plan: plan({seed: 11, splay: .8, spin: .7, roll: .4, force: 4}),
      velocity: {x: 1, y: .4, z: -2}, direction: {x: .6, z: .8},
    });
    const frameOnce = frame();
    for (let f = 1; f <= 90; f++) pool.advance(slot, f * RAGDOLL_FIXED_DT, frameOnce);
    return slot;
  };
  const a = run(), b = run();
  assert.deepEqual(a.pos, b.pos);
  assert.deepEqual(a.vel, b.vel);
  assert.notDeepEqual(a.pos, new Float64Array(a.pos.length), 'the seed actually moves the field');
});

test('fixed 1/60 substeps make the trajectory frame-rate independent', () => {
  const pool60 = new RagdollPool({capacity: 1, maxAwake: 1});
  const slot60 = pool60.acquire({seed: 5, plan: plan({seed: 5, force: 3})});
  const frame60 = frame();
  for (let i = 1; i <= 120; i++) pool60.advance(slot60, i / 60, frame60);

  const pool30 = new RagdollPool({capacity: 1, maxAwake: 1});
  const slot30 = pool30.acquire({seed: 5, plan: plan({seed: 5, force: 3})});
  const frame30 = frame();
  for (let i = 1; i <= 60; i++) pool30.advance(slot30, i / 30, frame30);

  assert.deepEqual(slot60.pos, slot30.pos);
  assert.deepEqual(slot60.vel, slot30.vel);

  // A stalled frame may only catch up four substeps; the rest is left for the
  // next advance so a long frame cannot block the render loop.
  const stalled = new RagdollPool({capacity: 1, maxAwake: 1});
  const slot = stalled.acquire({seed: 5, plan: plan({seed: 5})});
  stalled.advance(slot, .9, frame());
  assert.equal(slot.steps, RAGDOLL_MAX_SUBSTEPS);
  stalled.advance(slot, .9 + RAGDOLL_FIXED_DT, frame());
  assert.equal(slot.steps, RAGDOLL_MAX_SUBSTEPS * 2);
});

test('a slept corpse freezes its pose and stops sampling until reseeded', () => {
  const pool = new RagdollPool({capacity: 1, maxAwake: 1});
  const slot = pool.acquire({seed: 8, plan: plan({seed: 8, pose: 'sprawl'})});
  let calls = 0;
  const ground = frame({sampleGround: () => { calls++; return 0; }});
  for (let f = 1; f <= 400 && slot.awake; f++) pool.advance(slot, f * RAGDOLL_FIXED_DT, ground);
  assert.equal(slot.awake, false, 'the corpse settles');
  assert.ok(slot.simTime < 4, 'it rests from velocity, not only the 4 s cap');
  assert.ok(calls > 0);
  const pos = slot.pos.slice(), vel = slot.vel.slice(), sampled = calls;
  for (let f = 401; f <= 500; f++) pool.advance(slot, f * RAGDOLL_FIXED_DT, ground);
  assert.deepEqual(slot.pos, pos, 'a slept pose never changes');
  assert.deepEqual(slot.vel, vel);
  assert.equal(calls, sampled, 'a slept corpse never samples the world again');
  pool.reseed(slot, {seed: 9, plan: plan({seed: 9, pose: 'crumple'})});
  assert.equal(slot.awake, true);
  assert.equal(slot.steps, 0);
  pool.advance(slot, 1, ground);
  assert.ok(calls > sampled, 'reseeding wakes physics again');
});

test('reduced motion, the CPU renderer, hidden bodies and hidden corpses never acquire', () => {
  const cases = [
    ['software', {software: true}],
    ['reduced', {reduced: true}],
    ['hideBody', {plan: plan({hideBody: true})}],
    ['hidden corpse', {hidden: true}],
    ['explicit opt-out', {ragdoll: false}],
  ];
  const life = new CharacterLifecycle();
  for (const [label, options] of cases) {
    const model = rigModel();
    life.update(model, deadActor, {time: 0, ...options, sampleGround: () => 0});
    assert.equal(life.records.get(model).ragdoll, null, `${label} keeps the fallback`);
  }
  const model = rigModel();
  life.update(model, deadActor, {time: 0, plan: plan(), sampleGround: () => 0});
  assert.ok(life.records.get(model).ragdoll, 'the default path acquires a ragdoll');
});

test('the gated fallback keeps the exact 31 samples/frame authored contract', () => {
  const life = new CharacterLifecycle();
  const model = rigModel();
  let calls = 0;
  const sampleGround = () => { calls++; return 2; };
  life.update(model, {...deadActor, y: 2}, {time: 0, software: true, plan: plan(), sampleGround});
  life.update(model, {...deadActor, y: 2}, {time: 1.2, software: true, plan: plan(), sampleGround});
  assert.equal(calls, 62, 'software corpses never run physics contacts');
  assert.equal(life.ragdolls.activeCount, 0);
});

test('a late authoritative plan reseeds the ragdoll from the captured hand-off pose', () => {
  const life = new CharacterLifecycle();
  const model = rigModel();
  life.update(model, deadActor, {time: 0, plan: plan({seed: 2}), sampleGround: () => 0});
  const record = life.records.get(model);
  const slot = record.ragdoll;
  assert.ok(slot);
  const handoff = slot.live.slice();
  for (let f = 1; f <= 6; f++) life.update(model, deadActor, {time: f / 60, plan: plan({seed: 2}), sampleGround: () => 0});
  assert.ok(slot.steps > 0);
  life.update(model, deadActor, {
    time: 6 / 60 + 1e-3, authoritative: true, direction: {x: -1, z: 0},
    plan: plan({pose: 'crumple', style: 'spinout', seed: 77, roll: -.5, spin: 1}), sampleGround: () => 0,
  });
  assert.equal(slot.steps, 0, 'the accumulator restarts');
  assert.equal(slot.poseName, 'crumple');
  assert.equal(slot.style, 'spinout');
  assert.equal(slot.seed, 77 >>> 0);
  assert.deepEqual(slot.pos, handoff, 'particles restart from the captured live pose');
  assert.equal(record.planLocked, true);
});

test('capacity eviction, lifetime expiry and release all free pool slots', () => {
  const life = new CharacterLifecycle({maxCorpses: 1, maxLifetime: 1});
  const first = rigModel(), second = rigModel();
  life.update(first, deadActor, {time: 0, plan: plan({duration: .5}), sampleGround: () => 0});
  assert.ok(life.records.get(first).ragdoll);
  life.update(second, deadActor, {time: 0, plan: plan({duration: .5}), sampleGround: () => 0});
  assert.equal(life.records.get(first).ragdoll, null, 'eviction releases the slot');
  assert.equal(life.ragdolls.activeCount, 1);
  life.update(second, deadActor, {time: 2, plan: plan({duration: .5}), sampleGround: () => 0});
  assert.equal(life.ragdolls.activeCount, 0, 'lifetime expiry releases the slot');
  const third = rigModel();
  life.update(third, deadActor, {time: 0, plan: plan(), sampleGround: () => 0});
  assert.equal(life.ragdolls.activeCount, 1);
  life.release(third);
  assert.equal(life.ragdolls.activeCount, 0, 'release frees the slot');
  life.clear();
  assert.equal(life.ragdolls.activeCount, 0);
});

test('settled particles stay above sampled ground and outside block AABBs', () => {
  const pool = new RagdollPool({capacity: 1, maxAwake: 1});
  const block = {x: 0, z: -1.4, w: 1.4, d: 1.4, h: 1.1};
  const slot = pool.acquire({seed: 5, plan: plan({seed: 5, pose: 'sprawl', splay: .9, force: 4, spin: .4})});
  const ground = frame({sampleGround: () => 0, blocks: [block]});
  for (let f = 1; f <= 400 && slot.awake; f++) pool.advance(slot, f * RAGDOLL_FIXED_DT, ground);
  assert.equal(slot.awake, false);
  for (let i = 0; i < RAGDOLL_PARTICLES; i++) {
    const o = i * 3, x = slot.pos[o], y = slot.pos[o + 1], z = slot.pos[o + 2];
    assert.ok(y + RAGDOLL_RADIUS[i] >= -1e-6, `particle ${i} penetrated the floor by ${(-y - RAGDOLL_RADIUS[i]).toFixed(4)}`);
    const dx = Math.max(Math.abs(x - block.x) - block.w / 2, 0);
    const dy = Math.max(-y, y - block.h, 0);
    const dz = Math.max(Math.abs(z - block.z) - block.d / 2, 0);
    const distance = Math.hypot(dx, dy, dz);
    assert.ok(distance >= RAGDOLL_RADIUS[i] - RAGDOLL_CONTACT_SLOP - 1e-6, `particle ${i} penetrated the block`);
  }
});

test('stepping reuses the slot scratch without swapping buffers', () => {
  const pool = new RagdollPool({capacity: 1, maxAwake: 1});
  const slot = pool.acquire({seed: 4, plan: plan({seed: 4})});
  const pos = slot.pos, vel = slot.vel, live = slot.live, world = slot.world;
  const step = frame();
  for (let f = 1; f <= 90; f++) pool.advance(slot, f * RAGDOLL_FIXED_DT, step);
  assert.equal(slot.pos, pos);
  assert.equal(slot.vel, vel);
  assert.equal(slot.live, live);
  assert.equal(slot.world, world);
  assert.equal(slot.pose.particles, pos);
  pool.release(slot);
  const again = pool.acquire({seed: 4, plan: plan({seed: 4})});
  assert.equal(again.pos, pos, 'acquire reuses the preallocated slot arrays');
  assert.equal(again.liveQuats, slot.liveQuats);
});
