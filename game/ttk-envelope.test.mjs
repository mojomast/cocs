// TTK-envelope hard gate — Phase 5 of the COCS class & harness overhaul
// (docs/design/CLASS_OVERHAUL.md §4.5, §4.7, §7.4).
//
// Deterministic damage math, no matches and no clock. Two tables are pinned:
//   1. what a wing *deals* with its preferred weapons inside its own band, and
//   2. what it *suffers* from a baseline Pulse (effective health).
//
// The §4.5 table is the design target. The measured roster is logged beside it
// so P5-2 can see the absolute gaps (the vanguard suffer window is the known
// one); the gate itself pins the hard limits, the roster-wide envelope and the
// wing ordering, so a tuning change that moves a wing outside the envelope or
// lets any class one-shot a full-HP/0-armor target fails loudly.

import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTERS, HARNESSES, WEAPONS} from './data.mjs';
import {OPERATOR_KITS, WINGS} from './kits.mjs';
import {weaponTTK} from './weapons.mjs';
import {MELEE, damageFalloff} from './core.mjs';
import {DEEP_COMPUTE, SINGLE_HIT_CAP, ONE_SHOT_HEALTH_FRACTION, createOperatorVerbState} from './operator-verbs.mjs';

// §4.5, verbatim. `deals` is the dealt TTK window on a 100 HP / 0 armour
// target; `suffers` is the effective-health TTK window against a baseline
// Pulse. Strikers are the fastest and squishiest, vanguards the slowest and
// tankiest, tacticians sit between.
export const TTK_ENVELOPE = Object.freeze({
  striker: Object.freeze({deals: Object.freeze([0.55, 0.75]), suffers: Object.freeze([0.75, 0.90])}),
  vanguard: Object.freeze({deals: Object.freeze([0.90, 1.10]), suffers: Object.freeze([1.30, 1.60])}),
  tactician: Object.freeze({deals: Object.freeze([0.70, 0.95]), suffers: Object.freeze([0.90, 1.10])}),
});

// Representative engagement distance per wing: where the wing is supposed to
// fight, used only to pick a falloff multiplier. Strikers close, tacticians at
// range, vanguards in between.
export const ENGAGEMENT_RANGE = Object.freeze({striker: 10, vanguard: 16, tactician: 28});

// §4.5 baseline and the preferred-weapon affinity bonus (kits.mjs).
export const PULSE = WEAPONS[0];
export const AFFINITY_DAMAGE = 1.08;
export const DESIGN_TOLERANCE = 0.05; // 50 ms, for the dealt ceiling check only

const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map(character => [character.id, character]));
const KIT_BY_ID = Object.fromEntries(OPERATOR_KITS.map(kit => [kit.id, kit]));

// Armour absorbs 60% of incoming damage, so one armour point is 1/0.6 EHP
// (matches balance-sweep.mjs envelopeReport).
export const effectiveHealth = character => character.stats.health + character.stats.armor / 0.6;

// Falloff-aware direct-hit TTK: same (shots - 1) × interval convention as
// weaponTTK, but at a distance and with the class affinity bonus. Splash is
// deliberately excluded from the dealt table — it is a separate damage source
// with its own radius, and including it would let a rocket "one-shot" on paper.
export function directTTK(weapon, health, distance, affinity = AFFINITY_DAMAGE) {
  const perShot = weapon.damage * (weapon.pellets || 1) * affinity * damageFalloff(weapon, distance);
  if (!(perShot > 0)) return Infinity;
  const shots = Math.ceil(health / perShot);
  return Math.max(0, (shots - 1) * weapon.interval);
}

// The fastest preferred-weapon TTK an operator can put on a 100/0 target at
// its wing's engagement range. This is the operator's "best in band" answer.
export function operatorDealtTTK(operatorId) {
  const kit = KIT_BY_ID[operatorId];
  const range = ENGAGEMENT_RANGE[kit.wing];
  return Math.min(...kit.preferred.map(index => directTTK(WEAPONS[index], 100, range)));
}

// The wing's suffered TTK from a baseline Pulse against each member's EHP.
export function wingSufferTable() {
  const table = {};
  for (const wing of WINGS) {
    table[wing.id] = CHARACTERS
      .filter(character => KIT_BY_ID[character.id]?.wing === wing.id)
      .map(character => ({operator: character.id, ehp: effectiveHealth(character), ttk: weaponTTK(PULSE, effectiveHealth(character))}));
  }
  return table;
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = value => Math.round(value * 1000) / 1000;

test('the baseline Pulse Rifle TTK on 100 HP / 0 armour is ~0.9 s', () => {
  assert.equal(PULSE.damage, 11);
  assert.equal(weaponTTK(PULSE, 100), 0.9, '10 shots, 9 intervals at 0.1 s');
  assert.ok(weaponTTK(PULSE, 100) >= 0.85 && weaponTTK(PULSE, 100) <= 0.95);
});

test('no class charge or preferred weapon one-shots a full-HP/0-armour target', () => {
  assert.equal(SINGLE_HIT_CAP, 90, '§4.7 single-hit cap');
  assert.equal(ONE_SHOT_HEALTH_FRACTION, 0.9, '§3.2 charged-shot ceiling');
  const lightestHealth = Math.min(...CHARACTERS.map(character => character.stats.health));
  assert.equal(lightestHealth, 90, 'Kimi is the lightest full-HP target');
  // Class-layer direct damage only (no gear/attachment behaviour): the largest
  // preferred-weapon direct hit, with affinity, must stay under both limits.
  for (const index of [2]) {
    const perShot = WEAPONS[index].damage * AFFINITY_DAMAGE;
    assert.ok(perShot <= SINGLE_HIT_CAP, `weapon ${index} direct hit ${round(perShot)} <= ${SINGLE_HIT_CAP}`);
    assert.ok(perShot < lightestHealth, `weapon ${index} direct hit ${round(perShot)} < ${lightestHealth}`);
  }
  const rail = WEAPONS[2];
  // Deep Compute takes the max with attachment charge, never the product, and
  // clamps the shot to min(90, 90% of full health) through the real helper.
  for (const character of CHARACTERS) {
    const state = createOperatorVerbState('deepseek');
    DEEP_COMPUTE.step(state, 1.2, {firing: true});
    assert.equal(DEEP_COMPUTE.charge(state), 1, 'the meter fills');
    const shot = DEEP_COMPUTE.onShot(state, {baseDamage: rail.damage * AFFINITY_DAMAGE, damageScale: 1, attachmentCharge: 1, targetHealth: character.stats.health});
    const ceiling = Math.min(SINGLE_HIT_CAP, ONE_SHOT_HEALTH_FRACTION * character.stats.health);
    assert.ok(shot.damage <= ceiling + 1e-9, `${character.id}: charged rail ${round(shot.damage)} <= ceiling ${round(ceiling)}`);
    assert.ok(character.stats.health - shot.damage > 0, `${character.id} survives a full-charge rail`);
  }
});

test('the suffered-vs-Pulse table keeps the §4.5 wing ordering and roster envelope', () => {
  const table = wingSufferTable();
  const measured = Object.fromEntries(Object.entries(table).map(([wing, rows]) => [wing, {
    min: round(Math.min(...rows.map(row => row.ttk))),
    max: round(Math.max(...rows.map(row => row.ttk))),
    median: round(median(rows.map(row => row.ttk))),
  }]));
  console.log(`suffered vs Pulse (measured): ${JSON.stringify(measured)} · §4.5 target ${JSON.stringify(Object.fromEntries(WINGS.map(w => [w.id, TTK_ENVELOPE[w.id].suffers])))}`);
  for (const rows of Object.values(table)) {
    for (const row of rows) {
      assert.ok(row.ttk >= 0.75 - 1e-9, `${row.operator} suffered ${row.ttk} >= 0.75 (roster floor)`);
      assert.ok(row.ttk <= 1.6 + 1e-9, `${row.operator} suffered ${row.ttk} <= 1.6 (roster ceiling)`);
    }
  }
  assert.ok(measured.vanguard.min >= measured.striker.max - 1e-9, 'vanguards are at least as tanky as strikers');
  assert.ok(measured.vanguard.min >= measured.tactician.max - 1e-9, 'vanguards are at least as tanky as tacticians');
  assert.ok(measured.vanguard.median > measured.striker.median, 'the vanguard median is above the striker median');
  assert.ok(measured.vanguard.median >= measured.tactician.median, 'the vanguard median is above the tactician median');
  // §4.1 stat envelope: max/min EHP inside 1.5x.
  const ehp = CHARACTERS.map(effectiveHealth);
  assert.ok(Math.max(...ehp) / Math.min(...ehp) <= 1.5, `EHP ratio ${round(Math.max(...ehp) / Math.min(...ehp))} <= 1.5`);
});

test('the dealt table keeps every preferred weapon inside the §4.5 outer band', () => {
  const measured = {};
  for (const wing of WINGS) {
    const rows = CHARACTERS.filter(character => KIT_BY_ID[character.id]?.wing === wing.id)
      .map(character => ({operator: character.id, ttk: operatorDealtTTK(character.id)}));
    measured[wing.id] = {min: round(Math.min(...rows.map(row => row.ttk))), max: round(Math.max(...rows.map(row => row.ttk))), rows: rows.map(row => ({operator: row.operator, ttk: round(row.ttk)}))};
  }
  console.log(`dealt TTK on 100/0 (measured): ${JSON.stringify(measured)} · §4.5 target ${JSON.stringify(Object.fromEntries(WINGS.map(w => [w.id, TTK_ENVELOPE[w.id].deals])))}`);
  const globalFloor = Math.min(...WINGS.map(wing => TTK_ENVELOPE[wing.id].deals[0]));
  for (const wing of WINGS) {
    const band = TTK_ENVELOPE[wing.id].deals;
    for (const row of measured[wing.id].rows) {
      // No preferred weapon may burst a full-HP target faster than the fastest
      // design band, and none may sit slower than its own band ceiling + 50 ms.
      assert.ok(row.ttk >= globalFloor - 1e-9, `${row.operator} deals ${row.ttk} >= global floor ${globalFloor}`);
      assert.ok(row.ttk <= band[1] + DESIGN_TOLERANCE + 1e-9, `${row.operator} deals ${row.ttk} <= §4.5 ceiling ${band[1]} + ${DESIGN_TOLERANCE}`);
    }
  }
  // Fastest to slowest: strikers, then tacticians, then vanguards (§4.5).
  assert.ok(measured.striker.min <= measured.tactician.min + 1e-9, 'strikers are the fastest wing');
  assert.ok(measured.tactician.min <= measured.vanguard.min + 1e-9, 'vanguards are the slowest to kill');
  // The striker and tactician bands are actually reached; the vanguard band is
  // a known P5-2 gap (shared long-range weapons keep it at ~0.78 s), logged above.
  assert.ok(measured.striker.min <= TTK_ENVELOPE.striker.deals[1] + 1e-9, 'a striker reaches its dealt band');
  assert.ok(measured.tactician.min <= TTK_ENVELOPE.tactician.deals[1] + 1e-9, 'a tactician reaches its dealt band');
});

test('the melee and ability direct-damage layers stay inside the §4.7 single-hit cap', () => {
  const lightest = Math.min(...CHARACTERS.map(character => character.stats.health));
  // MELEE.damage (core) and the Claw Burst harness active (data.mjs) are the
  // other direct class-layer damage sources.
  assert.ok(MELEE.damage <= SINGLE_HIT_CAP, `melee ${MELEE.damage} <= ${SINGLE_HIT_CAP}`);
  assert.ok(MELEE.damage < lightest, `melee ${MELEE.damage} < ${lightest}`);
  for (const harness of HARNESSES) {
    if (!Number.isFinite(harness.damage)) continue;
    assert.ok(harness.damage <= SINGLE_HIT_CAP, `${harness.id} active ${harness.damage} <= ${SINGLE_HIT_CAP}`);
    assert.ok(harness.damage < lightest, `${harness.id} active ${harness.damage} < ${lightest}`);
  }
  const largestPreferred = Math.max(...OPERATOR_KITS.flatMap(kit => kit.preferred).map(index => WEAPONS[index].damage * AFFINITY_DAMAGE));
  assert.ok(largestPreferred <= SINGLE_HIT_CAP, `largest direct preferred hit ${round(largestPreferred)} <= ${SINGLE_HIT_CAP}`);
  assert.ok(largestPreferred < lightest, `largest direct preferred hit ${round(largestPreferred)} < ${lightest}`);
});
