import test from 'node:test';
import assert from 'node:assert/strict';
import {MOVEMENT_VERBS} from './kits.mjs';
import {MOVEMENT_SPECS} from './movement.mjs';
import {HEAT,OPERATOR_VERBS} from './operator-verbs.mjs';
import {ABILITY_BLOCK_REASONS, abilityBlockReason, abilityRing, movementHud, verbMeters} from './hud-class.mjs';

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
  closeTo(cooling.progress, .4, 1e-9, 'two-fifths of the 5 s blink budget');
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

// ---------------------------------------------------------------------------
// verbMeters: the operator signature-verb row reads the plain
// operatorVerbSnapshot() record and clamps every reading into 0..1.
// ---------------------------------------------------------------------------

test('verbMeters reads Heat, Deep Compute and Braced from their snapshots', () => {
  const hot = {verb: 'heat', active: true, heat: .08, decayIn: 1.2};
  const heat = verbMeters({verbState: hot})[0];
  assert.equal(heat.label, 'HEAT');
  closeTo(heat.value, HEAT.glow(hot), 1e-9, 'the meter is the live glow fraction');
  assert.equal(heat.text, `+${Math.round(HEAT.glow(hot) * OPERATOR_VERBS.heat.numbers.maxFireRateBonus * 100)}%`, 'the text reports the real bonus, not the fraction');
  const idle = verbMeters({verbState: {verb: 'heat', active: true, heat: 0}})[0];
  assert.equal(idle.value, 0);
  assert.equal(idle.text, 'IDLE');
  const compute = verbMeters({verbState: {verb: 'deep-compute', active: true, charge: .25}})[0];
  assert.equal(compute.label, 'COMPUTE');
  closeTo(compute.value, .25);
  assert.equal(compute.text, '25%');
  const braced = verbMeters({verbState: {verb: 'braced', active: true, combatIn: .75}})[0];
  closeTo(braced.value, 1 - .75 / OPERATOR_VERBS.braced.numbers.combatSeconds, 1e-9, 'the live out-of-combat window');
  assert.ok(braced.text.startsWith('OUT ') && braced.text.endsWith('s'), 'the text names the remaining window');
  const regen = verbMeters({verbState: {verb: 'braced', active: true, combatIn: 0}})[0];
  assert.equal(regen.value, 1);
  assert.equal(regen.text, 'REGEN');
});

test('verbMeters prefers the live Review absorb pool and reports the tool/adaptive windows', () => {
  const pool = verbMeters({verbState: {verb: 'alignment-review', active: true, meter: .4, pool: 22.5, poolIn: 2}})[0];
  assert.equal(pool.label, 'ABSORB');
  closeTo(pool.value, 22.5 / OPERATOR_VERBS['alignment-review'].numbers.absorb, 1e-9, 'the pool reads against the live absorb size');
  assert.equal(pool.text, '23 HP');
  const meter = verbMeters({verbState: {verb: 'alignment-review', active: true, meter: .4, pool: 0, poolIn: 0, suppressIn: 0}})[0];
  assert.equal(meter.label, 'ALIGN');
  closeTo(meter.value, .4);
  assert.equal(meter.text, '40%');
  const paused = verbMeters({verbState: {verb: 'alignment-review', active: true, meter: 0, pool: 0, poolIn: 0, suppressIn: 1}})[0];
  assert.equal(paused.text, 'PAUSED');
  const tool = verbMeters({verbState: {verb: 'tool-use', active: true, windowIn: 1.5}})[0];
  assert.equal(tool.label, 'TOOL USE');
  closeTo(tool.value, 1.5 / OPERATOR_VERBS['tool-use'].numbers.handlingSeconds, 1e-9, 'the window reads against the live handling time');
  assert.equal(tool.text, '1.5s');
  const adaptive = verbMeters({verbState: {verb: 'adaptive', active: true, open: true, windowIn: 3, shotsLeft: 12}})[0];
  assert.equal(adaptive.label, 'FIRST MAG');
  closeTo(adaptive.value, 3 / OPERATOR_VERBS.adaptive.numbers.firstMagSeconds, 1e-9, 'the window reads against the live ceiling');
  assert.equal(adaptive.text, '3s');
  const closed = verbMeters({verbState: {verb: 'adaptive', active: true, open: false, windowIn: 0, shotsLeft: 0}})[0];
  assert.equal(closed.text, 'CLOSED');
});

test('verbMeters names passive verbs and long-context trails, and stays total', () => {
  const passive = verbMeters({verbState: {verb: 'effortless', active: true}})[0];
  assert.equal(passive.passive, true);
  assert.equal(passive.label, 'EFFORTLESS');
  assert.equal(passive.value, 1);
  assert.equal(verbMeters({verbState: {verb: 'revision', active: true}})[0].label, 'REVISION');
  const trails = verbMeters({verbState: {verb: 'long-context', active: true, trails: [{ttl: 1}, {ttl: .2}, {ttl: 0}], cooldowns: {}}})[0];
  assert.equal(trails.label, 'TRAILS');
  assert.equal(trails.text, '2');
  closeTo(trails.value, 2 / 3);
  assert.deepEqual(verbMeters({verbState: {verb: 'heat', active: false, heat: .06}}), [], 'an inert verb renders nothing');
  assert.deepEqual(verbMeters({verbState: null}), []);
  assert.deepEqual(verbMeters({}), []);
  assert.deepEqual(verbMeters({verbState: {verb: 'unknown', active: true}}), []);
  assert.equal(verbMeters({verbState: {verb: 'heat', active: true, heat: 'x'}})[0].value, 0, 'malformed readings clamp to 0');
  for (const player of [
    {verbState: {verb: 'heat', active: true, heat: 99}},
    {verbState: {verb: 'deep-compute', active: true, charge: -4}},
    {verbState: {verb: 'braced', active: true, combatIn: -1}},
    {verbState: {verb: 'alignment-review', active: true, meter: 9, pool: 0, poolIn: 0, suppressIn: 0}},
  ]) for (const meter of verbMeters(player)) assert.ok(meter.value >= 0 && meter.value <= 1, `${meter.id} stays bounded`);
});
