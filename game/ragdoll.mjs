// Deterministic, presentation-only ragdoll physics for dead COCS operators.
//
// The authoritative simulation never reads this module. Ragdolls simulate in
// the model's local space and are applied by `CharacterRig.applyRagdoll`, which
// writes only joint rotations; `CharacterLifecycle` keeps owning the kinematic
// root so every existing root/arc/slope contract survives untouched.
//
// Everything is seeded from the death plan's deterministic hash (seed, pose,
// spin, splay, roll, force) plus the killing direction, the actor velocity and
// the live rig channels captured at the moment of death. There is no
// `Math.random`, no wall clock and no allocation during a physics step: every
// pool slot owns fixed typed arrays and the solver reuses them in place.
//
// Fixed 1/60 s substeps behind an accumulator make the motion frame-rate
// independent and replayable. Contacts answer from the presentation ground
// adapter (the same `sampleGround(x,z,referenceY)` the lifecycle already uses)
// and from `arena.blocks` AABBs; nothing here casts a world ray or mutates the
// simulation.

import {clamp} from './math.mjs';
import {hashUnit} from './deaths.mjs';

export const RAGDOLL_PARTICLES = 16;
export const RAGDOLL_CONSTRAINTS = 19;
export const RAGDOLL_ITERATIONS = 2;
export const RAGDOLL_FIXED_DT = 1 / 60;
export const RAGDOLL_MAX_SUBSTEPS = 4;
export const RAGDOLL_MAX_AWAKE = 6;
export const RAGDOLL_SLEEP_SPEED_SQ = .06;
export const RAGDOLL_SLEEP_STEPS = 20;
export const RAGDOLL_MAX_SIM = 4;
export const RAGDOLL_SEEK_GAP = 1;
export const RAGDOLL_PREROLL_STEPS = 240;
export const RAGDOLL_PREROLL_PASSES = 16;
// Ground samples per substep (every particle) plus the AABB scans that follow
// them. Keeping the probes on the particles themselves - prioritised by the
// ground pass first - is what stops unsupported limbs sinking through a floor.
export const RAGDOLL_CONTACT_PROBES = 16;
export const RAGDOLL_GRAVITY = 9.8;
export const RAGDOLL_RESTITUTION = .05;
export const RAGDOLL_FRICTION = .6;
export const RAGDOLL_DAMPING = .5;
export const RAGDOLL_MAX_PUSH = .6;
// A near-contact shell where support still settles the normal velocity even
// without a position correction. Resting particles hover a hair above the
// surface while constraints tug them, and without this shell a corpse would
// never meet the sleep contract.
export const RAGDOLL_CONTACT_SLOP = .025;
export const RAGDOLL_REST_SPEED = .55;
// Living -> corpse hand-off: the authored live pose and the final hit lean are
// blended out over this window instead of snapping through `rig.reset()`.
export const RAGDOLL_BLEND = .1;

// Particle order is the contract between this module, the live capture in
// `rig.mjs` and the joint adapter in `character-anim.mjs`.
export const RAGDOLL_NAMES = Object.freeze([
  'pelvis', 'torso', 'chest', 'head',
  'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR',
]);
// Joint-node key owning each particle (refined operator proportions).
export const RAGDOLL_JOINT_NAMES = Object.freeze([
  'hips', 'torso', 'chest', 'head',
  'armUpperL', 'forearmL', 'handL', 'armUpperR', 'forearmR', 'handR',
  'legUpperL', 'legLowerL', 'footL', 'legUpperR', 'legLowerR', 'footR',
]);
// Rest particle field in model-local space, taken from the operator mesh
// (view.mjs robotModel joints after refineOperatorCharacter: hips at .7835,
// thigh .34, shin .35, sole .0935, arm .29/.275, shoulder span .6).
export const RAGDOLL_REST = new Float64Array([
  0, .7835, 0, 0, 1.0035, 0, 0, 1.3035, 0, 0, 1.5835, 0,
  -.3, 1.5235, 0, -.3, 1.2335, 0, -.3, .9585, 0,
  .3, 1.5235, 0, .3, 1.2335, 0, .3, .9585, 0,
  -.15, .7835, 0, -.15, .4435, 0, -.15, .0935, 0,
  .15, .7835, 0, .15, .4435, 0, .15, .0935, 0,
]);
// Sphere radii from the same mesh values (ball/capsule radii at lines ~443-490
// of view.mjs; hands read the forearm ball, feet the flattened sole).
export const RAGDOLL_RADIUS = new Float64Array([
  .17, .26, .25, .19, .13, .082, .078, .13, .082, .078, .115, .09, .105, .115, .09, .105,
]);
// Relative inverse masses: the trunk resists limb impulses, the head and hands
// are light so the settle reads as a flop rather than a rigid lever.
export const RAGDOLL_INV_MASS = new Float64Array([
  .5, .4, .45, .75, .9, 1, 1, .9, 1, 1, .8, 1, 1.1, .8, 1, 1.1,
]);
// 15 chain bones plus 4 stiffeners (shoulder span, hip span, both body sides).
// The first fifteen entries are also the joint-direction bones the animation
// adapter reads; the last four only keep the torso from folding in half.
export const RAGDOLL_BONES = new Int16Array([
  0, 1, 1, 2, 2, 3,
  2, 4, 4, 5, 5, 6, 2, 7, 7, 8, 8, 9,
  0, 10, 10, 11, 11, 12, 0, 13, 13, 14, 14, 15,
  4, 7, 10, 13, 4, 10, 7, 13,
]);
// Presentation joint chain: which joint node follows which particle bone.
// `child` is -1 for leaf joints that rigidly follow their parent; `parent`
// names the joint that owns their local frame.
export const RAGDOLL_CHAIN = Object.freeze([
  Object.freeze({joint: 'hips', particle: 0, child: 1, parent: null}),
  Object.freeze({joint: 'torso', particle: 1, child: 2, parent: 'hips'}),
  Object.freeze({joint: 'chest', particle: 2, child: 3, parent: 'torso'}),
  Object.freeze({joint: 'head', particle: 3, child: -1, parent: 'chest'}),
  Object.freeze({joint: 'armUpperL', particle: 4, child: 5, parent: 'chest'}),
  Object.freeze({joint: 'forearmL', particle: 5, child: 6, parent: 'armUpperL'}),
  Object.freeze({joint: 'handL', particle: 6, child: -1, parent: 'forearmL'}),
  Object.freeze({joint: 'armUpperR', particle: 7, child: 8, parent: 'chest'}),
  Object.freeze({joint: 'forearmR', particle: 8, child: 9, parent: 'armUpperR'}),
  Object.freeze({joint: 'handR', particle: 9, child: -1, parent: 'forearmR'}),
  Object.freeze({joint: 'legUpperL', particle: 10, child: 11, parent: 'hips'}),
  Object.freeze({joint: 'legLowerL', particle: 11, child: 12, parent: 'legUpperL'}),
  Object.freeze({joint: 'footL', particle: 12, child: -1, parent: 'legLowerL'}),
  Object.freeze({joint: 'legUpperR', particle: 13, child: 14, parent: 'hips'}),
  Object.freeze({joint: 'legLowerR', particle: 14, child: 15, parent: 'legUpperR'}),
  Object.freeze({joint: 'footR', particle: 15, child: -1, parent: 'legLowerR'}),
]);
// Pose axis the authored fall arc topples around (matches deaths.mjs POSE_ARCS
// signs after the mesh's -Z front correction): the head travels this way while
// the root arc plays, so the limb flop agrees with the cinematic fall.
const TOPPLE = Object.freeze({
  forward: Object.freeze([0, 1]), back: Object.freeze([0, -1]),
  left: Object.freeze([-1, 0]), right: Object.freeze([1, 0]),
  crumple: Object.freeze([0, 1]), sprawl: Object.freeze([0, -1]),
});
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function createSlot(index) {
  const rest = new Float64Array(RAGDOLL_REST);
  const restLen = new Float64Array(RAGDOLL_CONSTRAINTS);
  for (let c = 0; c < RAGDOLL_CONSTRAINTS; c++) {
    const a = RAGDOLL_BONES[c * 2] * 3, b = RAGDOLL_BONES[c * 2 + 1] * 3;
    restLen[c] = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]);
  }
  const slot = {
    index,
    rest,
    restLen,
    pos: new Float64Array(RAGDOLL_PARTICLES * 3),
    vel: new Float64Array(RAGDOLL_PARTICLES * 3),
    live: new Float64Array(RAGDOLL_PARTICLES * 3),
    liveQuats: new Float64Array(RAGDOLL_CHAIN.length * 4),
    world: new Float64Array(RAGDOLL_PARTICLES * 3),
    active: false,
    awake: false,
    settled: false,
    snapped: false,
    dirty: false,
    serial: 0,
    seed: 0,
    plan: null,
    poseName: 'forward',
    style: 'ragdoll',
    force: 2,
    splay: .5,
    spin: 0,
    roll: 0,
    steps: 0,
    simTime: 0,
    still: 0,
    pose: null,
  };
  slot.pose = {particles: slot.pos};
  return slot;
}

// Fills one slot's velocity field from the deterministic seed. Impulses only
// read plan data, the killing direction (already rotated into local space), the
// actor velocity and the live hit envelope.
function seedVelocities(slot, opts) {
  const plan = opts.plan || {};
  const seed = slot.seed;
  const splay = clamp(finite(plan.splay, .5), 0, 1);
  const force = clamp(finite(plan.force, 2), 0, 12);
  const spin = clamp(finite(plan.spin, 0), -1.6, 1.6);
  const roll = clamp(finite(plan.roll, 0), -1, 1);
  const hit = clamp(finite(opts.hit, 0), 0, 1);
  const velocity = opts.velocity || null;
  const vx0 = finite(velocity?.x, 0), vy0 = finite(velocity?.y, 0), vz0 = finite(velocity?.z, 0);
  const axis = TOPPLE[slot.poseName] || TOPPLE.forward;
  const dx = axis[0], dz = axis[1];
  const direction = opts.direction || null;
  let sx = 0, sz = 0;
  const length = direction ? Math.hypot(finite(direction.x, 0), finite(direction.z, 0)) : 0;
  if (length > 1e-6) { sx = finite(direction.x, 0) / length; sz = finite(direction.z, 0) / length; }
  const pelvisX = slot.rest[0], pelvisZ = slot.rest[2];
  for (let i = 0; i < RAGDOLL_PARTICLES; i++) {
    const o = i * 3;
    const rx = slot.pos[o] - pelvisX, rz = slot.pos[o + 2] - pelvisZ;
    const u = hashUnit(seed, i * 5 + 1), v = hashUnit(seed, i * 5 + 2), w = hashUnit(seed, i * 5 + 3);
    let vx = (u - .5) * 1.6 * (.3 + .7 * splay) + dx * (.45 + force * .14) + sx * (.55 + force * .14) + vx0;
    let vy = (v - .5) * 1.4 * (.2 + .8 * splay) + (.35 + force * .05) * (.3 + hashUnit(seed, i * 5 + 4) * .7) + vy0;
    let vz = (w - .5) * 1.6 * (.3 + .7 * splay) + dz * (.45 + force * .14) + sz * (.55 + force * .14) + vz0;
    vx += -rz * spin * .9 + roll * .55;
    vz += rx * spin * .9;
    vy += hit * (.6 + u * .5);
    slot.vel[o] = vx;
    slot.vel[o + 1] = vy;
    slot.vel[o + 2] = vz;
  }
}

/**
 * Fixed-capacity pool of deterministic ragdoll slots.
 *
 * `capacity` should match the lifecycle corpse budget; `maxAwake` bounds how
 * many corpses may run physics at once. Sleeping slots keep their frozen pose
 * until released, so a settled corpse costs nothing per frame.
 */
export class RagdollPool {
  constructor({capacity = 24, maxAwake = RAGDOLL_MAX_AWAKE, fixedDt = RAGDOLL_FIXED_DT} = {}) {
    const size = clamp(Math.floor(finite(capacity, 24)), 1, 64);
    this.capacity = size;
    this.maxAwake = clamp(Math.floor(finite(maxAwake, RAGDOLL_MAX_AWAKE)), 1, size);
    this.fixedDt = fixedDt > 0 ? fixedDt : RAGDOLL_FIXED_DT;
    this.slots = [];
    for (let i = 0; i < size; i++) this.slots.push(createSlot(i));
    this.serial = 0;
    this.activeCount = 0;
    this.awakeCount = 0;
  }

  // Claims a free slot and seeds it from the death context. Returns null when
  // every slot is in use; the caller then keeps the authored fallback corpse.
  acquire(opts = {}) {
    let slot = null;
    for (const candidate of this.slots) if (!candidate.active) { slot = candidate; break; }
    if (!slot) return null;
    slot.active = true;
    slot.serial = ++this.serial;
    this.activeCount++;
    this._seed(slot, opts);
    this.awakeCount++;
    if (this.awakeCount > this.maxAwake) this._sleepOldest(slot);
    return slot;
  }

  // Re-seeds an owned slot from a late authoritative plan. Particle positions
  // restart from the captured live snapshot, so the new fall replays from the
  // same hand-off pose instead of inheriting the stale plan's motion.
  reseed(slot, opts = {}) {
    if (!slot?.active) return false;
    const wasAwake = slot.awake;
    this._seed(slot, opts);
    if (!wasAwake) {
      this.awakeCount++;
      if (this.awakeCount > this.maxAwake) this._sleepOldest(slot);
    }
    return true;
  }

  // Advances toward `age` seconds of simulated time with fixed 1/60 substeps.
  // At most `RAGDOLL_MAX_SUBSTEPS` run per call so a long stall cannot block a
  // frame; a replay/seek jump (>= 1 s behind) pre-rolls and then settles.
  advance(slot, age, frame) {
    if (!slot?.active || !slot.awake) return slot;
    const target = Math.max(0, finite(age, 0));
    const want = Math.floor(target / this.fixedDt + 1e-6);
    if (want <= slot.steps) return slot;
    const gap = target - slot.steps * this.fixedDt;
    if (gap >= RAGDOLL_SEEK_GAP) { this._preroll(slot, want, frame); return slot; }
    let taken = 0;
    while (slot.steps < want && taken < RAGDOLL_MAX_SUBSTEPS && slot.awake) {
      this.substep(slot, frame, true);
      taken++;
    }
    return slot;
  }

  release(slot) {
    if (!slot?.active) return false;
    if (slot.awake) { slot.awake = false; this.awakeCount--; }
    slot.active = false;
    slot.dirty = false;
    slot.settled = false;
    slot.snapped = false;
    slot.plan = null;
    this.activeCount--;
    return true;
  }

  clear() {
    for (const slot of this.slots) if (slot.active) this.release(slot);
    this.serial = 0;
  }

  dispose() {
    this.clear();
    this.slots = [];
    this.capacity = 0;
    this.maxAwake = 0;
  }

  _seed(slot, opts) {
    const plan = opts.plan || {};
    const seedValue = Number(opts.seed ?? plan.seed);
    slot.seed = Number.isFinite(seedValue) ? seedValue >>> 0 : 0;
    slot.plan = plan;
    slot.poseName = typeof plan.pose === 'string' ? plan.pose : 'forward';
    slot.style = typeof plan.style === 'string' ? plan.style : 'ragdoll';
    slot.force = clamp(finite(plan.force, 2), 0, 12);
    slot.splay = clamp(finite(plan.splay, .5), 0, 1);
    slot.spin = clamp(finite(plan.spin, 0), -1.6, 1.6);
    slot.roll = clamp(finite(plan.roll, 0), -1, 1);
    const live = opts.live;
    for (let i = 0; i < slot.pos.length; i++) {
      const value = live ? live[i] : NaN;
      slot.pos[i] = Number.isFinite(value) ? value : slot.rest[i];
    }
    if (live) slot.live.set(live);
    else slot.live.set(slot.rest);
    if (opts.liveQuats) slot.liveQuats.set(opts.liveQuats);
    else {
      slot.liveQuats.fill(0);
      for (let q = 0; q < RAGDOLL_CHAIN.length; q++) slot.liveQuats[q * 4 + 3] = 1;
    }
    seedVelocities(slot, opts);
    slot.steps = 0;
    slot.simTime = 0;
    slot.still = 0;
    slot.settled = false;
    slot.snapped = false;
    slot.awake = true;
    slot.dirty = false;
  }

  _sleepOldest(except) {
    let oldest = null;
    for (const slot of this.slots) {
      if (slot === except || !slot.active || !slot.awake) continue;
      if (!oldest || slot.serial < oldest.serial) oldest = slot;
    }
    if (oldest) this._sleep(oldest);
  }

  _sleep(slot) {
    if (!slot.awake) return;
    slot.awake = false;
    slot.settled = true;
    slot.dirty = true;
    this.awakeCount--;
  }

  // Replay/seek catch-up: pre-roll up to 240 fixed steps (contacts spread over
  // a bounded number of passes), then settle on the authored corpse pose so a
  // seeked corpse matches every other presentation of the same plan.
  _preroll(slot, want, frame) {
    const steps = Math.min(RAGDOLL_PREROLL_STEPS, want - slot.steps);
    if (steps <= 0) return;
    const stride = Math.max(1, Math.ceil(steps / RAGDOLL_PREROLL_PASSES));
    for (let i = 0; i < steps && slot.awake; i++) this.substep(slot, frame, i % stride === 0, false);
    if (slot.awake) {
      slot.snapped = true;
      this._sleep(slot);
    }
  }

  // One fixed physics step: gravity/damping, distance constraints (two
  // Gauss-Seidel iterations) and the lowest-particle ground/block contacts.
  // Contacts stay a pure function of the substep index so the trajectory is
  // identical no matter how frames are sliced. `timeout` is false during a
  // seek pre-roll so only a real settle can end it; the caller then snaps.
  substep(slot, frame, contact, timeout = true) {
    const dt = this.fixedDt;
    const pos = slot.pos, vel = slot.vel;
    const inv = frame?.invMatrix;
    let gx = 0, gy = -RAGDOLL_GRAVITY, gz = 0;
    if (inv) {
      gx = inv[4] * -RAGDOLL_GRAVITY;
      gy = inv[5] * -RAGDOLL_GRAVITY;
      gz = inv[6] * -RAGDOLL_GRAVITY;
    }
    const damp = Math.max(0, 1 - RAGDOLL_DAMPING * dt);
    for (let i = 0; i < RAGDOLL_PARTICLES; i++) {
      const o = i * 3;
      let vx = (vel[o] + gx * dt) * damp;
      let vy = (vel[o + 1] + gy * dt) * damp;
      let vz = (vel[o + 2] + gz * dt) * damp;
      vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
      pos[o] += vx * dt;
      pos[o + 1] += vy * dt;
      pos[o + 2] += vz * dt;
    }
    this._constrain(slot);
    if (contact !== false) this._contacts(slot, frame);
    slot.steps++;
    slot.simTime = slot.steps * dt;
    let maxSq = 0;
    for (let i = 0; i < RAGDOLL_PARTICLES; i++) {
      const o = i * 3;
      const sq = vel[o] * vel[o] + vel[o + 1] * vel[o + 1] + vel[o + 2] * vel[o + 2];
      if (sq > maxSq) maxSq = sq;
    }
    if (maxSq < RAGDOLL_SLEEP_SPEED_SQ) slot.still++;
    else slot.still = 0;
    if (slot.still >= RAGDOLL_SLEEP_STEPS || (timeout && slot.simTime >= RAGDOLL_MAX_SIM)) this._sleep(slot);
    return slot;
  }

  _constrain(slot) {
    const pos = slot.pos, restLen = slot.restLen;
    for (let iteration = 0; iteration < RAGDOLL_ITERATIONS; iteration++) {
      for (let c = 0; c < RAGDOLL_CONSTRAINTS; c++) {
        const a = RAGDOLL_BONES[c * 2] * 3, b = RAGDOLL_BONES[c * 2 + 1] * 3;
        const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1e-9) continue;
        const diff = (dist - restLen[c]) / dist;
        const wa = RAGDOLL_INV_MASS[a / 3], wb = RAGDOLL_INV_MASS[b / 3], sum = wa + wb;
        if (!(sum > 0)) continue;
        const ka = diff * wa / sum, kb = diff * wb / sum;
        pos[a] += dx * ka; pos[a + 1] += dy * ka; pos[a + 2] += dz * ka;
        pos[b] -= dx * kb; pos[b + 1] -= dy * kb; pos[b + 2] -= dz * kb;
      }
    }
  }

  // Ground contacts for every particle (the floor is the dominant support, so
  // skipping the higher ones would let them sink through it) plus block AABB
  // probes for all of them. That is one ground sample and one AABB scan per
  // particle per substep, at most four substeps per frame; reduced frames take
  // the byte-identical fallback and never come here. Block scans never cast a
  // world ray and never allocate.
  _contacts(slot, frame) {
    const matrix = frame?.matrix, inv = frame?.invMatrix;
    if (!matrix || !inv) return 0;
    const pos = slot.pos, vel = slot.vel, world = slot.world;
    const m0 = matrix[0], m1 = matrix[1], m2 = matrix[2], m4 = matrix[4], m5 = matrix[5], m6 = matrix[6];
    const m8 = matrix[8], m9 = matrix[9], m10 = matrix[10], m12 = matrix[12], m13 = matrix[13], m14 = matrix[14];
    const i0 = inv[0], i1 = inv[1], i2 = inv[2], i4 = inv[4], i5 = inv[5], i6 = inv[6];
    const i8 = inv[8], i9 = inv[9], i10 = inv[10];
    for (let i = 0; i < RAGDOLL_PARTICLES; i++) {
      const o = i * 3, lx = pos[o], ly = pos[o + 1], lz = pos[o + 2];
      world[o] = m0 * lx + m4 * ly + m8 * lz + m12;
      world[o + 1] = m1 * lx + m5 * ly + m9 * lz + m13;
      world[o + 2] = m2 * lx + m6 * ly + m10 * lz + m14;
    }
    const scaleY = Math.hypot(m4, m5, m6) || 1;
    const scaleAvg = (Math.hypot(m0, m1, m2) + Math.hypot(m4, m5, m6) + Math.hypot(m8, m9, m10)) / 3 || 1;
    const friction = 1 - RAGDOLL_FRICTION;
    // Ground: every particle answers from the presentation support adapter.
    for (let i = 0; i < RAGDOLL_PARTICLES; i++) {
      const o = i * 3, radius = RAGDOLL_RADIUS[i];
      const wx = world[o], wy = world[o + 1], wz = world[o + 2];
      const support = frame.sampleGround ? frame.sampleGround(wx, wz, wy) : frame.fallbackGround;
      if (!Number.isFinite(support)) continue;
      const gap = support + radius * scaleY - wy;
      if (gap < -RAGDOLL_CONTACT_SLOP) continue;
      if (gap > 0) {
        const pen = Math.min(gap, RAGDOLL_MAX_PUSH);
        pos[o] += i4 * pen; pos[o + 1] += i5 * pen; pos[o + 2] += i6 * pen;
        world[o] += i4 * pen; world[o + 1] += i5 * pen; world[o + 2] += i6 * pen;
      }
      let wvx = m0 * vel[o] + m4 * vel[o + 1] + m8 * vel[o + 2];
      let wvy = m1 * vel[o] + m5 * vel[o + 1] + m9 * vel[o + 2];
      let wvz = m2 * vel[o] + m6 * vel[o + 1] + m10 * vel[o + 2];
      if (wvy < 0) wvy = wvy > -RAGDOLL_REST_SPEED ? 0 : -wvy * RAGDOLL_RESTITUTION;
      wvx *= friction; wvz *= friction;
      vel[o] = i0 * wvx + i4 * wvy + i8 * wvz;
      vel[o + 1] = i1 * wvx + i5 * wvy + i9 * wvz;
      vel[o + 2] = i2 * wvx + i6 * wvy + i10 * wvz;
    }
    if (!frame.blocks || !frame.blocks.length) return RAGDOLL_PARTICLES;
    let probes = RAGDOLL_PARTICLES;
    for (let i = 0; i < RAGDOLL_CONTACT_PROBES; i++) {
      probes++;
      const o = i * 3, radius = RAGDOLL_RADIUS[i];
      const lx = pos[o], ly = pos[o + 1], lz = pos[o + 2];
      const cx = m0 * lx + m4 * ly + m8 * lz + m12;
      const cy = m1 * lx + m5 * ly + m9 * lz + m13;
      const cz = m2 * lx + m6 * ly + m10 * lz + m14;
      const sphere = radius * scaleAvg;
      for (let bi = 0; bi < frame.blocks.length; bi++) {
        const block = frame.blocks[bi];
        if (!block) continue;
        const bw = finite(block.w, 0), bd = finite(block.d, 0);
        if (!(bw > 0 && bd > 0)) continue;
        const minX = block.x - bw / 2, maxX = block.x + bw / 2;
        const minZ = block.z - bd / 2, maxZ = block.z + bd / 2;
        const base = Number.isFinite(block.y) ? block.y : 0;
        const top = Number.isFinite(block.y) && Number.isFinite(block.thickness) ? block.y + block.thickness
          : Number.isFinite(block.h) ? block.h : base;
        if (!(top > base)) continue;
        const px = clamp(cx, minX, maxX), py = clamp(cy, base, top), pz = clamp(cz, minZ, maxZ);
        let dx = cx - px, dy = cy - py, dz = cz - pz;
        const distSq = dx * dx + dy * dy + dz * dz;
        const limit = sphere + RAGDOLL_CONTACT_SLOP;
        if (distSq >= limit * limit) continue;
        let nx = 0, ny = 0, nz = 0, pen = 0;
        if (distSq > 1e-12) {
          const dist = Math.sqrt(distSq);
          nx = dx / dist; ny = dy / dist; nz = dz / dist;
          pen = Math.min(sphere - dist, RAGDOLL_MAX_PUSH);
        } else {
          // Center inside the box: escape along the shallowest face.
          const ex = Math.min(cx - minX, maxX - cx), ey = Math.min(cy - base, top - cy), ez = Math.min(cz - minZ, maxZ - cz);
          if (ey <= ex && ey <= ez) { ny = cy - base < top - cy ? -1 : 1; pen = Math.min(sphere + ey, RAGDOLL_MAX_PUSH); }
          else if (ex <= ez) { nx = cx - minX < maxX - cx ? -1 : 1; pen = Math.min(sphere + ex, RAGDOLL_MAX_PUSH); }
          else { nz = cz - minZ < maxZ - cz ? -1 : 1; pen = Math.min(sphere + ez, RAGDOLL_MAX_PUSH); }
        }
        if (pen > 0) {
          pos[o] += i0 * nx * pen + i4 * ny * pen + i8 * nz * pen;
          pos[o + 1] += i1 * nx * pen + i5 * ny * pen + i9 * nz * pen;
          pos[o + 2] += i2 * nx * pen + i6 * ny * pen + i10 * nz * pen;
        }
        let wvx = m0 * vel[o] + m4 * vel[o + 1] + m8 * vel[o + 2];
        let wvy = m1 * vel[o] + m5 * vel[o + 1] + m9 * vel[o + 2];
        let wvz = m2 * vel[o] + m6 * vel[o + 1] + m10 * vel[o + 2];
        const vn = wvx * nx + wvy * ny + wvz * nz;
        if (vn < 0) {
          const bounce = vn > -RAGDOLL_REST_SPEED ? 0 : RAGDOLL_RESTITUTION;
          wvx -= nx * vn * (1 + bounce);
          wvy -= ny * vn * (1 + bounce);
          wvz -= nz * vn * (1 + bounce);
        }
        wvx *= friction; wvy *= friction; wvz *= friction;
        vel[o] = i0 * wvx + i4 * wvy + i8 * wvz;
        vel[o + 1] = i1 * wvx + i5 * wvy + i9 * wvz;
        vel[o + 2] = i2 * wvx + i6 * wvy + i10 * wvz;
      }
    }
    return probes;
  }
}
