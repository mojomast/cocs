import test from 'node:test';
import assert from 'node:assert/strict';
import {MOVEMENT_VERBS} from './kits.mjs';
import {MOVEMENT_SPECS} from './movement.mjs';
import {ABILITY_BLOCK_REASONS, abilityBlockReason, abilityRing, movementHud} from './hud-class.mjs';

const closeTo = (actual, expected, eps = 1e-9, label = '') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${label} expected ${expected} ± ${eps}, got ${actual}`);

const player = (over = {}) => ({health: 100, cooldown: 0, active: 0, character: 'mistral', harness: 'openclaw', ...over});
const verb = id => MOVEMENT_VERBS.find(entry => entry.id === id);

// ---------------------------------------------------------------------------
// abilityRing: the ring must agree with Match.power()'s guards and formula.
// ---------------------------------------------------------------------------

test('a fresh ability is full and ready and an active window reads as full', () => {
  const ready = abilityRing(player(), {cooldown: 12}, {});
  assert.equal(ready.ready, true);
  assert.equal(ready.active, false);
  assert.equal(ready.disabled, false);
  closeTo(ready.ratio, 1);
  assert.equal(ready.label, 'READY');
  const active = abilityRing(player({cooldown: 9, active: 1.5}), {cooldown: 12}, {});
  assert.equal(active.active, true);
  assert.equal(active.ready, false);
  closeTo(active.ratio, 1, 1e-9, 'an active window fills the ring');
  assert.equal(active.seconds, 1.5);
  assert.equal(active.label, 'ACTIVE 1.5s');
});

test('the ring divides by the Haste cooldown multiplier, not the raw cooldown', () => {
  const plain = abilityRing(player({cooldown: 3.5}), {cooldown: 10}, {});
  closeTo(plain.ratio, 0.65, 1e-9, 'no Haste');
  const haste = abilityRing(player({cooldown: 3.5, cooldownMultiplier: .7}), {cooldown: 10}, {});
  closeTo(haste.ratio, 0.5, 1e-9, 'Haste 0.7 shrinks the effective cooldown');
  closeTo(haste.max, 7);
  assert.equal(haste.label, '3.5s');
});

test('fastPowers halves the effective cooldown like core and the rider bonus stacks on top', () => {
  const fast = abilityRing(player({cooldown: 5}), {cooldown: 10}, {fastPowers: true});
  closeTo(fast.max, 5);
  closeTo(fast.ratio, 0);
  // Hermes' tactician rider is "Courier rush cooldown −1 s." (trigger: end).
  const rider = abilityRing(player({character: 'chatgpt', harness: 'hermes', cooldown: 5.5}), {cooldown: 12}, {});
  closeTo(rider.max, 11, 1e-9, 'rider cooldown bonus');
  closeTo(rider.ratio, 0.5);
  const noRider = abilityRing(player({character: 'mistral', harness: 'hermes', cooldown: 5.5}), {cooldown: 12}, {});
  closeTo(noRider.max, 12);
  closeTo(noRider.ratio, 1 - 5.5 / 12);
});

test('abilityBlockReason mirrors the core power() guards', () => {
  assert.equal(abilityBlockReason(player(), {}), null);
  assert.equal(abilityBlockReason(player({vehicleId: 3}), {}), 'vehicle');
  assert.equal(abilityBlockReason(player(), {mode: 'instagib'}), 'instagib');
  assert.equal(abilityBlockReason(player(), {instagib: true}), 'instagib');
  assert.equal(abilityBlockReason(player({health: 0}), {}), 'dead');
  assert.equal(abilityBlockReason(player({carryingFlag: true}), {mode: 'ctf'}, {}), 'carrier');
  assert.equal(abilityBlockReason(player(), {}, {over: true}), 'over');
  assert.equal(abilityBlockReason(player(), {mode: 'puma-race'}), 'race');
  assert.equal(abilityBlockReason(player({isVip: true}), {}), 'vip');
  assert.equal(abilityBlockReason(player({movement: {carrier: {suppressActive: true}}}), {}), 'suppressed');
  assert.deepEqual(ABILITY_BLOCK_REASONS, ['over', 'race', 'dead', 'instagib', 'vehicle', 'carrier', 'vip', 'suppressed']);
});

test('disabled ability cards report DRIVING for vehicles and OFF otherwise', () => {
  const driving = abilityRing(player({vehicleId: 1, cooldown: 3}), {cooldown: 10}, {});
  assert.equal(driving.disabled, true);
  assert.equal(driving.ready, false);
  assert.equal(driving.label, 'DRIVING');
  assert.equal(driving.reason, 'vehicle');
  const carrier = abilityRing(player({carryingFlag: true, cooldown: 3}), {cooldown: 10}, {mode: 'ctf'});
  assert.equal(carrier.label, 'OFF');
  assert.equal(carrier.reason, 'carrier');
  const recharging = abilityRing(player({cooldown: 4}), {cooldown: 10}, {});
  assert.equal(recharging.disabled, false);
  assert.equal(recharging.label, '4s');
  // A flag carrier in any other mode still shows the normal ring.
  assert.equal(abilityRing(player({carryingFlag: true}), {cooldown: 10}, {mode: 'deathmatch'}).disabled, false);
});

// ---------------------------------------------------------------------------
// movementHud: the movement card's snapshot-only economy view.
// ---------------------------------------------------------------------------

test('a charge verb reads ready at full, spent during cooldown, off when stripped', () => {
  const ready = movementHud({phase: 'ready', enabled: true, verb: 'grapple', charges: 1, maxCharges: 1, cooldown: 0, fuel: 0, maxFuel: 0}, verb('grapple'));
  assert.equal(ready.ready, true);
  assert.equal(ready.name, 'Grapple');
  assert.equal(ready.note, '1/1');
  closeTo(ready.progress, 1);
  const spent = movementHud({phase: 'ready', enabled: true, verb: 'grapple', charges: 0, maxCharges: 1, cooldown: 2, fuel: 0, maxFuel: 0}, verb('grapple'));
  assert.equal(spent.ready, false);
  assert.equal(spent.note, '0/1 · 2s');
  closeTo(spent.progress, 0);
  const stripped = movementHud({phase: 'ready', enabled: false, verb: 'grapple', charges: 0, maxCharges: 1, cooldown: 0, fuel: 0, maxFuel: 0}, verb('grapple'));
  assert.equal(stripped.ready, false);
  assert.equal(stripped.note, 'OFF');
});

test('a fuel verb shows a percentage, drains while active and clamps malformed fuel', () => {
  const full = movementHud({phase: 'ready', enabled: true, verb: 'hover-jets', charges: 0, maxCharges: 0, cooldown: 0, fuel: 2.5, maxFuel: 2.5}, verb('hover-jets'));
  assert.equal(full.ready, true);
  assert.equal(full.name, 'Hover Jets');
  assert.equal(full.note, '100%');
  closeTo(full.progress, 1);
  const half = movementHud({phase: 'active', enabled: true, verb: 'hover-jets', charges: 0, maxCharges: 0, cooldown: 0, fuel: 1.25, maxFuel: 2.5}, verb('hover-jets'));
  assert.equal(half.ready, false);
  assert.equal(half.note, 'ACTIVE');
  closeTo(half.progress, 1, 1e-9, 'active verbs fill the ring');
  const clamped = movementHud({phase: 'ready', enabled: true, verb: 'hover-jets', fuel: 99, maxFuel: 2.5, cooldown: 0}, verb('hover-jets'));
  closeTo(clamped.fuel, 2.5);
  closeTo(clamped.progress, 1);
});

test('wind-up and charging phases report charge progress', () => {
  const charging = movementHud({phase: 'charging', enabled: true, verb: 'super-jump', charges: 1, maxCharges: 1, cooldown: 0, windup: .22, windupTotal: .55}, verb('super-jump'));
  assert.equal(charging.ready, false);
  closeTo(charging.charge, .4);
  assert.equal(charging.note, 'CHARGING 40%');
  assert.equal(charging.phase, 'charging');
  const windup = movementHud({phase: 'windup', enabled: true, verb: 'blink-step', charges: 0, maxCharges: 0, cooldown: 0, windup: .15, windupTotal: .3}, verb('blink-step'));
  assert.equal(windup.name, 'Blink Step');
  closeTo(windup.charge, .5);
  assert.equal(windup.note, 'CHARGING 50%');
});

test('cooldown-only verbs progress against the kit budget and snapshot-only snapshots still label', () => {
  const cooling = movementHud({phase: 'ready', enabled: true, verb: 'blink-step', charges: 0, maxCharges: 0, cooldown: 3, fuel: 0, maxFuel: 0}, verb('blink-step'));
  assert.equal(cooling.ready, false);
  assert.equal(cooling.note, '3s');
  closeTo(cooling.progress, .5, 1e-9, 'half of the 6 s blink budget');
  const bare = movementHud({phase: 'ready', enabled: true, verb: 'blink-step', cooldown: 0});
  assert.equal(bare.name, 'Blink Step', 'the verb id is title-cased without the kit record');
  assert.equal(bare.note, 'READY');
  assert.equal(bare.ready, true);
});

test('movementHud is total for missing or malformed snapshots', () => {
  const missing = movementHud(null, null);
  assert.equal(missing.ready, false);
  assert.equal(missing.note, 'OFF');
  assert.equal(missing.name, 'MOVEMENT');
  const junk = movementHud({phase: 'ready', enabled: true, verb: 'grapple', charges: 'x', maxCharges: NaN, fuel: Infinity, maxFuel: -1, cooldown: -5});
  assert.equal(junk.charges, 0);
  assert.equal(junk.cooldown, 0);
  assert.equal(junk.fuel, 0);
  assert.equal(junk.ready, true);
});

test('every movement verb maps to a stable card name from the kit table', () => {
  assert.deepEqual(MOVEMENT_SPECS.map(spec => spec.id), MOVEMENT_VERBS.map(entry => entry.id));
  for (const entry of MOVEMENT_VERBS) {
    const spec = MOVEMENT_SPECS.find(candidate => candidate.id === entry.id);
    const hud = movementHud({phase: 'ready', enabled: true, verb: entry.id, charges: spec.maxCharges, maxCharges: spec.maxCharges, fuel: spec.fuel, maxFuel: spec.fuel, cooldown: 0}, entry);
    assert.equal(hud.name, entry.name, `${entry.id} keeps its kit name`);
    assert.equal(hud.verb, entry.id);
    assert.equal(hud.ready, true, `${entry.id} is ready at full resources`);
  }
});
