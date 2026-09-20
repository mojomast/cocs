// Ability VFX module tests: pool bounds, per-harness and per-verb branch
// coverage, reduced-motion statics, rope cables, disposal and determinism.
//
// The module is presentation-only, so every test drives it exactly the way the
// view will: `handleEvent` for simulation events, `update(dt, snapshot)` once
// per frame with the match snapshot, and `stats()`/`debug()` to inspect the
// bounded pools without reaching into rendering internals.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createAbilityVfx,ABILITY_VFX_EVENTS,HARNESS_TINTS,ROPE_DISPLAY_CAP,VERB_TINTS} from './ability-vfx.mjs';
import {OPERATOR_VERBS} from './operator-verbs.mjs';

const HIGH = Object.freeze({tier: 2, particles: 1, deaths: 72});
const LOW = Object.freeze({tier: 0, particles: .4, deaths: 36});
const HARNESS_IDS = Object.freeze(Object.keys(HARNESS_TINTS));
// The live alignment-review pool size, so a tuning pass (or the pool change to
// 45 landing right now) never makes the pip expectations stale.
const REVIEW_ABSORB = OPERATOR_VERBS['alignment-review'].numbers.absorb;
const POS = {x: 4, y: 1.2, z: -3};

const make = (options = {}) => createAbilityVfx({quality: HIGH, reduced: false, ...options});

function snapshot(actors, time = 1) {
 return {time, actors};
}

function actor(id, verbState, over = {}) {
 return {
  id, character: 'mistral', harness: 'hermes', x: 1, y: 0, z: 2, vx: 0, vy: 0, vz: 0, yaw: 0,
  grounded: true, crouching: false, health: 100, armor: 0, spawnArmor: 0, verbState, ...over,
 };
}

function runUpdates(vfx, dt, match, steps) {
 for (let i = 0; i < steps; i++) vfx.update(dt, match);
}

const cueRows = vfx => vfx.debug().filter(row => row.pool === 'cues');
const channelRows = vfx => vfx.debug().filter(row => row.pool === 'channels');
const ropeRows = vfx => vfx.debug().filter(row => row.pool === 'ropes');

test('createAbilityVfx exposes the documented integration surface', () => {
 const vfx = make();
 for (const name of ['handleEvent', 'update', 'attach', 'detach', 'reset', 'stats', 'debug', 'dispose']) assert.equal(typeof vfx[name], 'function', `${name} is a function`);
 assert.ok(vfx.group instanceof T.Group, 'group is a THREE.Group');
 assert.deepEqual([...ABILITY_VFX_EVENTS], ['power', 'rope-place', 'rope-remove', 'rope-expire', 'weapon-switch', 'death']);
 assert.equal(Object.keys(VERB_TINTS).length, 9, 'one tint per signature verb');
 assert.ok(vfx.stats().limits.cues > 0 && vfx.stats().limits.channels > 0 && vfx.stats().limits.ropes > 0);
 const scene = new T.Scene();
 vfx.attach(scene);
 assert.equal(vfx.group.parent, scene);
 vfx.attach(scene);
 assert.equal(scene.children.filter(child => child === vfx.group).length, 1, 'attach is idempotent');
 vfx.detach();
 assert.equal(vfx.group.parent, null);
 vfx.dispose();
 assert.equal(vfx.stats().disposed, true);
});

test('each harness active spawns a distinct burst and every cue expires to zero', () => {
 const signatures = new Map();
 for (const harness of HARNESS_IDS) {
  const vfx = make();
  vfx.attach(new T.Scene());
  vfx.handleEvent({type: 'power', actor: 1, harness, pos: POS, duration: 3, id: 1});
  const stats = vfx.stats();
  assert.ok(stats.live > 0, `${harness} emits cues`);
  const kinds = cueRows(vfx).map(row => row.kind).sort();
  signatures.set(harness, kinds.join(','));
  assert.equal(vfx.stats().geometries, 9, 'geometry table stays fixed');
  runUpdates(vfx, .05, null, 600);
  const after = vfx.stats();
  assert.equal(after.live, 0, `${harness} cues expire to zero`);
  assert.equal(after.cues, 0);
  assert.equal(after.channels, 0);
  vfx.dispose();
 }
 assert.equal(new Set(signatures.values()).size, HARNESS_IDS.length, 'all seven harness signatures differ');
 assert.ok(HARNESS_IDS.every(id => typeof HARNESS_TINTS[id] === 'string' && HARNESS_TINTS[id].startsWith('#')), 'every harness has its own tint');
 // A future harness still reads as an activation and expires.
 const generic = make();
 generic.handleEvent({type: 'power', actor: 1, harness: 'future-harness', pos: POS, id: 1});
 assert.ok(cueRows(generic).length > 0, 'an unknown harness falls back to a generic burst');
 runUpdates(generic, .25, null, 8);
 assert.equal(generic.stats().live, 0);
 generic.dispose();
});

test('pool budgets bound a storm of events and rope placements', () => {
 const vfx = make({quality: LOW});
 const limits = vfx.stats().limits;
 for (let i = 0; i < 300; i++) {
  for (const harness of HARNESS_IDS) vfx.handleEvent({type: 'power', actor: (i % 4) + 1, harness, pos: {x: i, y: 1, z: -i}, duration: 3, id: i});
  vfx.handleEvent({type: 'rope-place', actor: 1, from: {x: 0, y: 0, z: 0}, to: {x: i, y: 2, z: i}, life: 20, id: i});
  vfx.update(1 / 60, snapshot([
   actor(1, {verb: 'heat', active: true, heat: .12}, {vx: 3, vz: 3}),
   actor(2, {verb: 'deep-compute', active: true, charge: .8}),
   actor(3, {verb: 'alignment-review', active: true, meter: .6, pool: 20, poolIn: 1}),
   actor(4, {verb: 'tool-use', active: true, windowIn: 2}),
  ]));
 }
 const stats = vfx.stats();
 assert.ok(stats.cues <= limits.cues, `cues ${stats.cues} <= ${limits.cues}`);
 assert.ok(stats.channels <= limits.channels, `channels ${stats.channels} <= ${limits.channels}`);
 assert.ok(stats.ropes <= limits.ropes, `ropes ${stats.ropes} <= ${limits.ropes}`);
 assert.ok(stats.live <= limits.total, `live ${stats.live} <= ${limits.total}`);
 assert.ok(vfx._cues.slots.length <= limits.cues, 'cue slot array never grows past its budget');
 assert.ok(vfx._channels.slots.length <= limits.channels, 'channel slot array never grows past its budget');
 assert.ok(vfx._ropes.slots.length <= limits.ropes, 'cable slot array never grows past its budget');
 const sharedGeometries = new Set([...vfx._cues.slots, ...vfx._channels.slots].map(slot => slot.mesh.geometry));
 const table = Object.values(vfx._geometry);
 assert.ok(sharedGeometries.size <= table.length && [...sharedGeometries].every(geometry => table.includes(geometry)), 'every cue reuses one shared geometry table');
 const high = make();
 assert.ok(high.stats().limits.cues > limits.cues && high.stats().limits.channels > limits.channels && high.stats().limits.ropes >= limits.ropes, 'budgets scale with the quality tier');
 high.dispose();
 vfx.handleEvent({type: 'death', actor: 1});
 vfx.update(.25, snapshot([]));
 runUpdates(vfx, .25, snapshot([]), 60);
 assert.equal(vfx.stats().live, 0, 'the storm drains to zero');
 vfx.dispose();
});

test('reduced motion spawns static cues and never animates', () => {
 const normal = make();
 const reduced = make({reduced: true});
 for (const harness of HARNESS_IDS) {
  normal.handleEvent({type: 'power', actor: 1, harness, pos: POS, duration: 3, id: 1});
  reduced.handleEvent({type: 'power', actor: 1, harness, pos: POS, duration: 3, id: 1});
 }
 const rows = cueRows(reduced);
 assert.ok(rows.length > 0, 'reduced motion still reads the activation');
 assert.ok(rows.every(row => row.grow === 0 && row.spin === 0), 'no growth and no spin under reduced');
 assert.ok(!rows.some(row => row.kind === 'streak' || row.kind === 'mote'), 'no streaks or motes under reduced');
 assert.ok(reduced.stats().spawned <= normal.stats().spawned, 'reduced motion never spawns more than normal');
 // Sample the static signature (position, scale, opacity) across real frames:
 // only the remaining lifetime may change, never a transform or a fade.
 const signature = vfx => cueRows(vfx).map(row => `${row.serial}|${row.kind}|${row.pos.join(',')}|${row.scale.join(',')}|${row.opacity}`).sort().join(';');
 const before = signature(reduced);
 for (let i = 0; i < 8; i++) reduced.update(1 / 60, snapshot([actor(1, {verb: 'heat', active: true, heat: .12})]));
 assert.equal(signature(reduced), before, 'reduced cues hold their transform and opacity');
 // Channels are state-driven, not time-animated.
 const channelBefore = channelRows(reduced).map(row => `${row.key}|${row.pos.join(',')}|${row.opacity}`).sort().join(';');
 reduced.update(1 / 60, snapshot([actor(1, {verb: 'heat', active: true, heat: .12})]));
 assert.equal(channelRows(reduced).map(row => `${row.key}|${row.pos.join(',')}|${row.opacity}`).sort().join(';'), channelBefore);
 runUpdates(reduced, .25, null, 40);
 assert.equal(reduced.stats().live, 0, 'reduced cues expire like all others');
 normal.dispose();
 reduced.dispose();
});

test('rope cables resolve their anchors, mirror replacements and release cleanly', () => {
 const vfx = make();
 vfx.attach(new T.Scene());
 vfx.handleEvent({type: 'rope-place', actor: 1, from: {x: 0, y: 0, z: 0}, to: {x: 6, y: 2, z: 0}, life: 20, id: 1});
 assert.equal(vfx.stats().ropes, 1);
 const cable = ropeRows(vfx)[0];
 assert.equal(cable.total, ROPE_DISPLAY_CAP, 'display life is capped like the telegraph hold');
 assert.equal(vfx.stats().ropesPlaced, 1);
 // A new placement from the same owner replaces the previous cable.
 vfx.handleEvent({type: 'rope-place', actor: 1, from: {x: 0, y: 0, z: 0}, to: {x: 3, y: 1, z: 3}, life: 20, id: 2});
 assert.equal(vfx.stats().ropes, 1, 'one owner keeps one cable');
 // Anchor expiry releases by position.
 vfx.handleEvent({type: 'rope-expire', actor: 1, pos: {x: 3, y: 1, z: 3}});
 assert.equal(vfx.stats().ropes, 0);
 // The movement event only carries `pos`; the placer's feet come from the frame.
 vfx.handleEvent({type: 'rope-place', actor: 2, pos: {x: 5, y: 0, z: 5}, life: 4, id: 3});
 assert.equal(vfx.stats().ropes, 0, 'the cable waits for its origin');
 vfx.update(1 / 60, snapshot([actor(2, {verb: 'heat', active: true, heat: .1}, {x: 2, y: 0, z: 1})]));
 assert.equal(vfx.stats().ropes, 1, 'the snapshot actor resolves the origin');
 assert.deepEqual(ropeRows(vfx)[0].to, [5, 0, 5]);
 runUpdates(vfx, .25, snapshot([actor(2, null, {x: 2, y: 0, z: 1})]), 24);
 assert.equal(vfx.stats().ropes, 0, 'the cable expires with its life');
 // Death clears the dead owner's cable like the sim does.
 vfx.handleEvent({type: 'rope-place', actor: 2, from: {x: 0, y: 0, z: 0}, to: {x: 1, y: 1, z: 1}, life: 20, id: 4});
 assert.equal(vfx.stats().ropes, 1);
 vfx.handleEvent({type: 'death', actor: 2});
 assert.equal(vfx.stats().ropes, 0);
 // rope-remove with a position is position-matched.
 vfx.handleEvent({type: 'rope-place', actor: 3, from: {x: 0, y: 0, z: 0}, to: {x: 2, y: 2, z: 2}, life: 20, id: 5});
 vfx.handleEvent({type: 'rope-remove', actor: 3, pos: {x: 2, y: 2, z: 2}});
 assert.equal(vfx.stats().ropes, 0);
 // Bounds and disposal.
 for (let i = 0; i < 60; i++) vfx.handleEvent({type: 'rope-place', actor: 10 + i, from: {x: 0, y: 0, z: 0}, to: {x: i, y: 0, z: i}, life: 20, id: i});
 assert.ok(vfx.stats().ropes <= vfx.stats().limits.ropes);
 vfx.dispose();
 assert.equal(vfx.stats().live, 0);
 assert.equal(vfx.group.children.length, 0, 'dispose detaches every cable mesh');
});

test('reduced motion keeps rope cables static and bounded', () => {
 const vfx = make({reduced: true});
 vfx.handleEvent({type: 'rope-place', actor: 1, from: {x: 0, y: 0, z: 0}, to: {x: 6, y: 2, z: 0}, life: 20, id: 1});
 assert.equal(vfx.stats().ropes, 1);
 const before = ropeRows(vfx)[0];
 vfx.update(1 / 60, null);
 vfx.update(1 / 60, null);
 const after = ropeRows(vfx)[0];
 assert.equal(after.pos.join(','), before.pos.join(','));
 assert.equal(after.opacity, before.opacity);
 assert.ok(after.life < before.life, 'only the lifetime advances');
 vfx.dispose();
});

test('signature verbs drive channels from the snapshot and clear when the state goes', () => {
 // Heat: the weapon glow ramps with the meter and clears at zero.
 const heat = make();
 heat.update(1 / 60, snapshot([actor(1, {verb: 'heat', active: true, heat: .02})]));
 const lowGlow = channelRows(heat).find(row => row.key === '1:heat');
 heat.update(1 / 60, snapshot([actor(1, {verb: 'heat', active: true, heat: .12})]));
 const highGlow = channelRows(heat).find(row => row.key === '1:heat');
 assert.ok(lowGlow && highGlow, 'heat glow exists while the meter is up');
 assert.ok(highGlow.opacity > lowGlow.opacity && highGlow.size > lowGlow.size, 'heat ramps with the meter');
 heat.update(1 / 60, snapshot([actor(1, {verb: 'heat', active: true, heat: 0})]));
 assert.ok(!channelRows(heat).some(row => row.key === '1:heat'), 'heat clears at zero');
 heat.dispose();
 // Deep Compute: charge ring ramp and a single full-charge flare per fill.
 const compute = make();
 compute.update(1 / 60, snapshot([actor(1, {verb: 'deep-compute', active: true, charge: .5})]));
 const half = channelRows(compute).find(row => row.key === '1:compute');
 assert.ok(half, 'charge ring exists');
 compute.update(1 / 60, snapshot([actor(1, {verb: 'deep-compute', active: true, charge: 1})]));
 const full = channelRows(compute).find(row => row.key === '1:compute');
 assert.ok(full.radius > half.radius, 'charge ring grows with the meter');
 assert.equal(cueRows(compute).filter(row => row.channel === 'compute-flare').length, 1, 'full charge flares');
 compute.update(1 / 60, snapshot([actor(1, {verb: 'deep-compute', active: true, charge: 1})]));
 assert.equal(cueRows(compute).filter(row => row.channel === 'compute-flare').length, 1, 'the flare does not refire while full');
 runUpdates(compute, 1 / 60, snapshot([actor(1, {verb: 'deep-compute', active: true, charge: 1})]), 30);
 compute.update(1 / 60, snapshot([actor(1, {verb: 'deep-compute', active: true, charge: 0})]));
 assert.ok(!channelRows(compute).some(row => row.key === '1:compute'), 'charge ring clears at zero');
 compute.update(1 / 60, snapshot([actor(1, {verb: 'deep-compute', active: true, charge: 1})]));
 assert.equal(cueRows(compute).filter(row => row.channel === 'compute-flare').length, 1, 'a fresh fill flares again');
 compute.dispose();
 // Alignment Review: pips scale with the live absorb pool and a spend flashes.
 const review = make();
 review.update(1 / 60, snapshot([actor(1, {verb: 'alignment-review', active: true, meter: .5, pool: REVIEW_ABSORB, poolIn: 2})]));
 assert.equal(channelRows(review).filter(row => String(row.key).startsWith('1:review-pip-')).length, 5, 'a full pool shows five pips');
 review.update(1 / 60, snapshot([actor(1, {verb: 'alignment-review', active: true, meter: 0, pool: REVIEW_ABSORB * .4, poolIn: 1})]));
 assert.equal(channelRows(review).filter(row => String(row.key).startsWith('1:review-pip-')).length, 2, 'pips follow the pool');
 assert.equal(cueRows(review).filter(row => row.channel === 'review-flash').length, 1, 'a spend flashes');
 review.update(1 / 60, snapshot([actor(1, {verb: 'alignment-review', active: true, meter: 0, pool: 0, poolIn: 0})]));
 assert.ok(!channelRows(review).some(row => String(row.key).startsWith('1:review')), 'an empty pool clears the ring and pips');
 review.dispose();
 // Braced: crouched regen out of combat spawns motes.
 const braced = make();
 braced.update(.25, snapshot([actor(1, {verb: 'braced', active: true, combatIn: 0}, {grounded: true, crouching: true, spawnArmor: 20, armor: 5})]));
 assert.ok(cueRows(braced).some(row => row.kind === 'mote'), 'braced regen emits motes');
 const moteSerial = Math.max(...cueRows(braced).filter(row => row.kind === 'mote').map(row => row.serial));
 braced.update(.25, snapshot([actor(1, {verb: 'braced', active: true, combatIn: 1.2}, {grounded: true, crouching: true, spawnArmor: 20, armor: 5})]));
 assert.equal(cueRows(braced).filter(row => row.kind === 'mote' && row.serial > moteSerial).length, 0, 'combat pauses the motes');
 runUpdates(braced, .25, snapshot([]), 8);
 assert.equal(braced.stats().live, 0, 'braced motes expire');
 braced.dispose();
 // Tool Use: the interaction window ring holds while windowIn is positive.
 const tool = make();
 tool.update(1 / 60, snapshot([actor(1, {verb: 'tool-use', active: true, windowIn: 2})]));
 assert.ok(channelRows(tool).some(row => row.key === '1:tool'), 'window ring exists');
 tool.update(1 / 60, snapshot([actor(1, {verb: 'tool-use', active: true, windowIn: 0})]));
 assert.ok(!channelRows(tool).some(row => row.key === '1:tool'), 'window ring clears');
 tool.dispose();
 // Long Context: recorded snapshot trails become ground markers.
 const context = make();
 context.update(1 / 60, snapshot([actor(1, {verb: 'long-context', active: true, trails: [{enemyId: 9, x: 5, z: -4, ttl: 1.5}], cooldowns: {9: 1.5}})]));
 assert.ok(channelRows(context).some(row => row.key === '1:trail:9'), 'trail marker exists');
 context.update(1 / 60, snapshot([actor(1, {verb: 'long-context', active: true, trails: [], cooldowns: {}})]));
 assert.ok(!channelRows(context).some(row => row.key === '1:trail:9'), 'trail marker clears with the trail');
 context.dispose();
 // Adaptive: a swap window flash on the open edge only.
 const adaptive = make();
 adaptive.update(1 / 60, snapshot([actor(1, {verb: 'adaptive', active: true, open: false, windowIn: 0})]));
 assert.equal(cueRows(adaptive).filter(row => row.channel === 'adaptive-swap').length, 0);
 adaptive.update(1 / 60, snapshot([actor(1, {verb: 'adaptive', active: true, open: true, windowIn: 6})]));
 assert.equal(cueRows(adaptive).filter(row => row.channel === 'adaptive-swap').length, 1, 'opening the window flashes');
 adaptive.update(1 / 60, snapshot([actor(1, {verb: 'adaptive', active: true, open: true, windowIn: 5.9})]));
 assert.equal(cueRows(adaptive).filter(row => row.channel === 'adaptive-swap').length, 1, 'the flash is edge-triggered');
 adaptive.dispose();
 // Effortless: airborne speed leaves streaks.
 const effortless = make();
 effortless.update(.2, snapshot([actor(1, {verb: 'effortless', active: true}, {grounded: false, vx: 6, vz: 0})]));
 assert.ok(cueRows(effortless).some(row => row.kind === 'streak'), 'air control leaves streaks');
 effortless.update(.2, snapshot([actor(1, {verb: 'effortless', active: true}, {grounded: true, vx: 6, vz: 0})]));
 effortless.dispose();
 // Revision: the instant-swap flash rides the weapon-switch event.
 const revision = make();
 revision.update(1 / 60, snapshot([actor(1, {verb: 'revision', active: true})]));
 revision.handleEvent({type: 'weapon-switch', actor: 1, weapon: 2});
 assert.ok(cueRows(revision).some(row => row.channel === 'revision-swap'), 'a revision swap flashes');
 const flashes = cueRows(revision).filter(row => row.channel === 'revision-swap').length;
 revision.handleEvent({type: 'weapon-switch', actor: 1, weapon: 1});
 assert.equal(cueRows(revision).filter(row => row.channel === 'revision-swap').length, flashes * 2, 'each swap flashes once more');
 revision.dispose();
 // A non-revision actor never gets the swap flash.
 const plain = make();
 plain.update(1 / 60, snapshot([actor(1, {verb: 'heat', active: true, heat: .1})]));
 plain.handleEvent({type: 'weapon-switch', actor: 1, weapon: 2});
 assert.equal(cueRows(plain).filter(row => row.channel === 'revision-swap').length, 0);
 plain.dispose();
 // Every channel clears once the actors leave the snapshot.
 const drain = make();
 drain.update(1 / 60, snapshot([
  actor(1, {verb: 'heat', active: true, heat: .12}),
  actor(2, {verb: 'deep-compute', active: true, charge: 1}),
  actor(3, {verb: 'alignment-review', active: true, meter: 1, pool: 35, poolIn: 2}),
  actor(4, {verb: 'tool-use', active: true, windowIn: 2}),
  actor(5, {verb: 'long-context', active: true, trails: [{enemyId: 9, x: 1, z: 1, ttl: 1.5}]}),
 ]));
 assert.ok(drain.stats().channels > 0);
 runUpdates(drain, .25, snapshot([]), 40);
 assert.equal(drain.stats().live, 0, 'all verb channels release with the snapshot');
 drain.dispose();
});

test('dispose releases every resource and further calls are inert', () => {
 const vfx = make();
 const scene = new T.Scene();
 vfx.attach(scene);
 for (const harness of HARNESS_IDS) vfx.handleEvent({type: 'power', actor: 1, harness, pos: POS, duration: 3, id: 1});
 vfx.handleEvent({type: 'rope-place', actor: 1, from: {x: 0, y: 0, z: 0}, to: {x: 4, y: 2, z: 0}, life: 20, id: 1});
 vfx.update(1 / 60, snapshot([actor(1, {verb: 'deep-compute', active: true, charge: 1})]));
 assert.ok(vfx.stats().live > 0);
 vfx.dispose();
 const stats = vfx.stats();
 assert.equal(stats.live, 0);
 assert.equal(stats.cues, 0);
 assert.equal(stats.channels, 0);
 assert.equal(stats.ropes, 0);
 assert.equal(stats.nodes, 0);
 assert.equal(stats.geometries, 0);
 assert.equal(scene.children.length, 0, 'the group left the scene');
 assert.equal(vfx.handleEvent({type: 'power', actor: 1, harness: 'openclaw', pos: POS, id: 2}), false);
 vfx.update(.25, snapshot([actor(1, {verb: 'heat', active: true, heat: .12})]));
 assert.equal(vfx.stats().live, 0);
 const before = vfx.stats();
 vfx.dispose();
 assert.deepEqual(vfx.stats(), before, 'dispose is idempotent');
});

test('the same event and snapshot sequence produces the same effect lifetimes', () => {
 const run = () => {
  const vfx = make();
  const trace = [];
  for (let i = 0; i < 40; i++) {
   for (const harness of HARNESS_IDS) vfx.handleEvent({type: 'power', actor: (i % 2) + 1, harness, pos: {x: i, y: 1, z: -i}, duration: 3, id: i});
   vfx.handleEvent({type: 'rope-place', actor: 1, from: {x: 0, y: 0, z: 0}, to: {x: i, y: 2, z: i}, life: 20, id: i});
   vfx.handleEvent({type: 'weapon-switch', actor: 2, weapon: i % 9});
   const match = snapshot([
    actor(1, {verb: 'heat', active: true, heat: (i % 5) * .03}, {vx: 4, vz: 1}),
    actor(2, {verb: 'deep-compute', active: true, charge: Math.min(1, i / 10)}),
    actor(3, {verb: 'long-context', active: true, trails: [{enemyId: 7, x: i, z: -i, ttl: 1.5}], cooldowns: {7: 1.5}}),
   ]);
   vfx.update(1 / 60, match);
   trace.push(JSON.stringify(vfx.debug()));
  }
  runUpdates(vfx, .25, snapshot([]), 60);
  trace.push(JSON.stringify(vfx.debug()));
  vfx.dispose();
  return trace;
 };
 assert.deepEqual(run(), run());
});

test('unknown events are ignored and never allocate', () => {
 const vfx = make();
 assert.equal(vfx.handleEvent(null), false);
 assert.equal(vfx.handleEvent({}), false);
 assert.equal(vfx.handleEvent({type: 'shot', actor: 1, from: {x: 0, y: 0, z: 0}, to: {x: 1, y: 1, z: 1}}), false);
 assert.equal(vfx.handleEvent({type: 'damage', actor: 1, amount: 10}), false);
 // The alt-fire presentation stream joins the same event loop; it is not an
 // ability cue and must fall through without disturbing existing handling.
 assert.equal(vfx.handleEvent({type: 'alt-state', actor: 1, weapon: 0, alt: true, pos: POS}), false);
 assert.equal(vfx.handleEvent({type: 'alt-fire', actor: 1, weapon: 0, pos: POS}), false);
 assert.equal(vfx.stats().events.ignored, 6);
 assert.equal(vfx.stats().events.handled, 0);
 assert.equal(vfx.stats().live, 0);
 vfx.update(.1, snapshot([actor(1, null)]));
 assert.equal(vfx.stats().live, 0);
 vfx.dispose();
});
