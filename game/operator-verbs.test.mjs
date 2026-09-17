// Tests for the nine operator signature verbs (Phase 2, docs/design/
// CLASS_OVERHAUL.md §3.2, §4.6, §4.7). The module is pure data + hooks, so
// every test drives explicit state and explicit dt: no Match, no clock, no
// RNG. The Deep Compute sweep is the §4.7 one-shot proof and the last test
// pins determinism plus the absence of clocks/RNG in the module source.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CHARACTERS, WEAPONS} from './data.mjs';
import {OPERATOR_KITS, WINGS} from './kits.mjs';
import {
  OPERATOR_VERB_IDS,
  OPERATOR_VERBS,
  OPERATOR_HOOKS,
  operatorVerbById,
  operatorVerbFor,
  operatorHooks,
  createOperatorVerbState,
  resetOperatorVerbState,
  setOperatorVerbActive,
  stepOperatorVerbState,
  operatorVerbSnapshot,
  EFFORTLESS,
  REVISION,
  REVISION_PRIMARY_BAND,
  HEAT,
  DEEP_COMPUTE,
  SINGLE_HIT_CAP,
  ONE_SHOT_HEALTH_FRACTION,
  BRACED,
  ALIGNMENT_REVIEW,
  ADAPTIVE,
  LONG_CONTEXT,
  TOOL_USE,
} from './operator-verbs.mjs';

const close = (actual, expected, eps = 1e-9, message) => {
  const tolerance = typeof eps === 'string' ? 1e-9 : eps;
  assert.ok(Math.abs(actual - expected) < tolerance, message ?? (typeof eps === 'string' ? eps : `${actual} !== ${expected}`));
};
const deepFrozen = value => !value || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value).every(deepFrozen));
const KIT_VERB_IDS = OPERATOR_KITS.map(kit => kit.verb.id);

// Drive each verb into a non-default state so the death reset has something to
// clear.
function exercisedState(character) {
  const state = createOperatorVerbState(character);
  switch (state.verb) {
    case 'heat':
      HEAT.onHitLanded(state);
      break;
    case 'deep-compute':
      DEEP_COMPUTE.step(state, 1, {firing: true});
      break;
    case 'braced':
      BRACED.onDamage(state);
      break;
    case 'alignment-review':
      ALIGNMENT_REVIEW.step(state, 1, {});
      ALIGNMENT_REVIEW.onDamage(state);
      break;
    case 'adaptive':
      ADAPTIVE.onSwap(state, {magazine: 5});
      break;
    case 'long-context':
      LONG_CONTEXT.record(state, {enemyId: 1, x: 1, z: 2});
      break;
    case 'tool-use':
      TOOL_USE.onPickup(state, {magazine: 10, ammo: 0, cap: 30});
      break;
    default:
      break;
  }
  return state;
}

test('nine frozen descriptors cover every operator kit and publish their numbers', () => {
  assert.equal(OPERATOR_VERB_IDS.length, 9);
  assert.deepEqual(OPERATOR_VERB_IDS, KIT_VERB_IDS, 'descriptor order follows the kit table');
  assert.deepEqual(Object.keys(OPERATOR_HOOKS), OPERATOR_VERB_IDS);
  assert.ok(deepFrozen(OPERATOR_VERBS));
  for (const id of OPERATOR_VERB_IDS) {
    const descriptor = OPERATOR_VERBS[id];
    assert.equal(descriptor.id, id);
    assert.ok(descriptor.name.length > 0);
    assert.ok(descriptor.summary.length > 0);
    assert.ok(CHARACTERS.some(character => character.id === descriptor.operator), `${id} operator resolves`);
    assert.ok(WINGS.some(wing => wing.id === descriptor.wing), `${id} wing resolves`);
    assert.ok(descriptor.numbers && typeof descriptor.numbers === 'object');
    assert.equal(Object.values(descriptor.numbers).filter(value => typeof value === 'number').every(Number.isFinite), true, `${id} numbers are finite`);
    assert.ok(Array.isArray(descriptor.integration) && descriptor.integration.length > 0, `${id} documents its core sites`);
    for (const entry of descriptor.integration) {
      assert.ok(typeof entry.site === 'string' && entry.site.length > 0);
      assert.ok(typeof entry.call === 'string' && entry.call.length > 0);
      assert.ok(typeof entry.effect === 'string' && entry.effect.length > 0);
    }
    const hooks = OPERATOR_HOOKS[id];
    assert.ok(hooks && typeof hooks.step === 'function' && typeof hooks.snapshot === 'function', `${id} exposes step/snapshot`);
    assert.equal(operatorVerbById(id), descriptor);
    assert.equal(operatorVerbFor(descriptor.operator), descriptor);
    assert.equal(operatorHooks(descriptor.operator), hooks);
    assert.equal(operatorHooks(id), hooks);
  }
  assert.equal(operatorVerbById('not-a-verb'), null);
  assert.equal(operatorVerbFor('not-a-character'), null);
  assert.equal(operatorHooks('not-a-character'), null);
  assert.equal(operatorHooks(null), null);
  assert.equal(operatorHooks({verb: 'not-a-verb'}), null);
  assert.throws(() => { OPERATOR_VERBS.heat.numbers.perHit = 1; }, TypeError);
  assert.throws(() => { OPERATOR_VERBS.heat.integration.push('x'); }, TypeError);
  assert.throws(() => { REVISION_PRIMARY_BAND[0] = 9; }, TypeError);
});

test('state factory builds one state per operator, unknown characters get none', () => {
  for (const character of CHARACTERS) {
    const state = createOperatorVerbState(character.id);
    assert.ok(state, character.id);
    assert.equal(state.operator, character.id);
    assert.equal(state.verb, OPERATOR_KITS.find(kit => kit.id === character.id).verb.id);
    assert.equal(state.active, true);
    assert.equal(operatorVerbSnapshot(state).active, true);
  }
  assert.equal(createOperatorVerbState('nobody'), null);
  assert.equal(createOperatorVerbState(undefined), null);
  assert.equal(createOperatorVerbState('claude', {active: false}).active, false);
  assert.ok(Object.isFrozen(TOOL_USE.vehicle(createOperatorVerbState('qwen'))));
});

test('reset clears every per-life resource at spawn and at death', () => {
  for (const character of CHARACTERS) {
    const fresh = operatorVerbSnapshot(createOperatorVerbState(character.id));
    const state = exercisedState(character.id);
    if (!['effortless', 'revision'].includes(state.verb)) {
      assert.notDeepEqual(operatorVerbSnapshot(state), fresh, `${character.id} was exercised`);
    }
    resetOperatorVerbState(state, 'death');
    assert.deepEqual(operatorVerbSnapshot(state), fresh, `${character.id} death reset`);
    assert.equal(state.lastReset, 'death');
    exercisedState(character.id);
    resetOperatorVerbState(state, 'spawn');
    assert.deepEqual(operatorVerbSnapshot(state), fresh, `${character.id} spawn reset`);
    assert.equal(state.lastReset, 'spawn');
  }
  assert.equal(resetOperatorVerbState(null, 'death'), null);
});

test('nothing applies unless the verb is active', () => {
  const heat = createOperatorVerbState('grok');
  HEAT.onHitLanded(heat);
  assert.ok(HEAT.heat(heat) > 0);
  setOperatorVerbActive(heat, false);
  assert.equal(HEAT.heat(heat), 0);
  assert.equal(HEAT.glow(heat), 0);
  assert.equal(HEAT.fireRateMultiplier(heat), 1);
  assert.equal(HEAT.onHitLanded(heat), 0);
  assert.equal(HEAT.step(heat, 1), 0);
  setOperatorVerbActive(heat, true);
  assert.equal(HEAT.heat(heat), 0, 'reactivation starts clean');

  assert.deepEqual(EFFORTLESS.airControl(null), {airAccelMultiplier: 1, airCapMultiplier: 1});
  assert.deepEqual(EFFORTLESS.slide(null), {boostMultiplier: 1, frictionMultiplier: 1, minSecondsBonus: 0});
  assert.deepEqual(EFFORTLESS.hopWindow(null), {jumpBufferBonus: 0, coyoteBonus: 0});
  close(REVISION.swapSeconds(null, {from: 3, to: 2, base: .45}), .45);
  assert.equal(REVISION.skipsHolster({verb: 'revision', active: false}, {from: 3, to: 2}), false);
  assert.equal(HEAT.fireRateMultiplier({verb: 'adaptive', active: true}), 1);
  close(DEEP_COMPUTE.multiplier(null, {attachmentCharge: 2.2}), 2.2, 1e-12);
  assert.equal(DEEP_COMPUTE.clampShot(null, 1000, {targetHealth: 50}), 1000, 'the clamp is DeepSeek-only');
  assert.equal(BRACED.armorRegen(null, 1, {spawnArmor: 20, currentArmor: 0}), 0);
  assert.equal(BRACED.knockbackMultiplier(null, {crouching: true}), 1);
  assert.deepEqual(ALIGNMENT_REVIEW.status(null), {meter: 0, pool: 0, poolIn: 0, suppressed: false, active: false});
  assert.deepEqual(ALIGNMENT_REVIEW.absorb(null, 10), {absorbed: 0, remaining: 10, pool: 0, broke: false});
  close(ADAPTIVE.swapDelay(null, .45), .45);
  assert.deepEqual(ADAPTIVE.handling(null), {interval: 1, spread: 1});
  assert.equal(ADAPTIVE.onShot(null), 0);
  assert.deepEqual(LONG_CONTEXT.trails(null), []);
  assert.equal(LONG_CONTEXT.record(null, {enemyId: 1, x: 0, z: 0}), null);
  assert.equal(LONG_CONTEXT.rangeMultiplier(null), 1);
  assert.equal(TOOL_USE.interactionMultiplier(null), 1);
  assert.deepEqual(TOOL_USE.onPickup(null), {reload: 0, active: false});
  assert.deepEqual(TOOL_USE.handling(null), {interval: 1, spread: 1});
  close(TOOL_USE.meleeRange(null, 2.4), 2.4);
  assert.equal(TOOL_USE.vehicle(null), null);
});

test('Mistral Effortless: stronger air control, longer slides, forgiving hop timing (movement only)', () => {
  const state = createOperatorVerbState('mistral');
  const air = EFFORTLESS.airControl(state);
  close(air.airAccelMultiplier, 1.35);
  close(air.airCapMultiplier, 1.2);
  assert.ok(air.airAccelMultiplier > 1 && air.airCapMultiplier > 1);
  const slide = EFFORTLESS.slide(state);
  close(slide.boostMultiplier, 1.15);
  close(slide.frictionMultiplier, .8);
  close(slide.minSecondsBonus, .12);
  assert.ok(slide.boostMultiplier > 1 && slide.frictionMultiplier < 1);
  close(.35 + slide.minSecondsBonus, .47, 1e-12);
  const hop = EFFORTLESS.hopWindow(state);
  close(hop.jumpBufferBonus, .04);
  close(hop.coyoteBonus, .03);
  close(.12 + hop.jumpBufferBonus, .16);
  close(.1 + hop.coyoteBonus, .13);
  // Movement identity only: no damage/resistance/fire-rate keys, no top-speed multiplier.
  for (const key of Object.keys(OPERATOR_VERBS.effortless.numbers)) {
    assert.ok(!/damage|resistance|fireRate|speed|velocity/i.test(key), key);
  }
  assert.equal('speedMultiplier' in air, false);
  assert.equal('speedMultiplier' in slide, false);
});

test('Gemini Revision: the two-primary band comes from the kit and skips holster time', () => {
  const kit = OPERATOR_KITS.find(entry => entry.id === 'gemini');
  assert.deepEqual([...REVISION_PRIMARY_BAND], kit.preferred.slice(0, 2));
  assert.deepEqual([...REVISION_PRIMARY_BAND], [3, 2]);
  const state = createOperatorVerbState('gemini');
  assert.equal(REVISION.isPrimary(3), true);
  assert.equal(REVISION.isPrimary(2), true);
  assert.equal(REVISION.isPrimary(1), false);
  assert.equal(REVISION.skipsHolster(state, {from: 3, to: 2}), true);
  assert.equal(REVISION.skipsHolster(state, {from: 2, to: 3}), true);
  close(REVISION.swapSeconds(state, {from: 3, to: 2, base: .45}), 0);
  close(REVISION.swapSeconds(state, {from: 3, to: 2, base: .6}), 0, 'the band skips any base holster');
  close(REVISION.swapSeconds(state, {from: 0, to: 3, base: .45}), .45);
  close(REVISION.swapSeconds(state, {from: 3, to: 9, base: .45}), .45);
  close(REVISION.swapSeconds(state, {from: 0, to: 9, base: .6}), .6);
  close(REVISION.swapSeconds(state, {}), .45, 'unknown endpoints keep the base');
});

test('Grok Heat: +12% cap, six-hit build, decay 1.5 s after the last hit, death reset', () => {
  const state = createOperatorVerbState('grok');
  assert.equal(HEAT.fireRateMultiplier(state), 1);
  for (let hit = 0; hit < 6; hit++) HEAT.onHitLanded(state);
  close(HEAT.heat(state), .12, 1e-12);
  close(HEAT.fireRateMultiplier(state), 1.12, 1e-12);
  close(HEAT.glow(state), 1);
  for (let hit = 0; hit < 20; hit++) HEAT.onHitLanded(state);
  close(HEAT.heat(state), .12, 1e-12, 'the cap holds');
  HEAT.step(state, 1.49);
  close(HEAT.heat(state), .12, 1e-12, 'no decay before 1.5 s');
  HEAT.step(state, .02);
  assert.ok(HEAT.heat(state) < .12 && HEAT.heat(state) > .11, 'decay begins after the 1.5 s window');
  HEAT.step(state, 1);
  close(HEAT.heat(state), 0);
  close(HEAT.fireRateMultiplier(state), 1);
  HEAT.onHitLanded(state);
  resetOperatorVerbState(state, 'death');
  close(HEAT.heat(state), 0);
  assert.equal(HEAT.fireRateMultiplier(state), 1);
  HEAT.onHitLanded(state, {amount: 3});
  close(HEAT.heat(state), .06, 1e-12);
});

test('DeepSeek Deep Compute: build, decay, max-with-attachment and charge consumption', () => {
  const state = createOperatorVerbState('deepseek');
  assert.equal(DEEP_COMPUTE.charge(state), 0);
  close(DEEP_COMPUTE.multiplier(state), 1);
  DEEP_COMPUTE.step(state, .6, {firing: true});
  close(DEEP_COMPUTE.charge(state), .5, 1e-12);
  DEEP_COMPUTE.step(state, .6, {firing: true});
  close(DEEP_COMPUTE.charge(state), 1, 1e-12);
  close(DEEP_COMPUTE.multiplier(state), 1.35, 1e-12);
  close(DEEP_COMPUTE.multiplier(state, {attachmentCharge: 1.2}), 1.35, 1e-12);
  close(DEEP_COMPUTE.multiplier(state, {attachmentCharge: 2.2}), 2.2, 1e-12, 'max with attachment, never 1.35 * 2.2');
  const shot = DEEP_COMPUTE.onShot(state, {baseDamage: 20, attachmentCharge: 1, targetHealth: 120});
  close(shot.damage, 27, 1e-12);
  close(shot.multiplier, 1.35, 1e-12);
  close(shot.bonus, 7, 1e-12);
  close(shot.charge, 1, 1e-12);
  assert.equal(shot.capped, false);
  close(DEEP_COMPUTE.charge(state), 0, 1e-12, 'the shot consumes the charge');
  DEEP_COMPUTE.step(state, 10, {firing: true});
  const coiled = DEEP_COMPUTE.onShot(state, {baseDamage: 20, attachmentCharge: 2.2, targetHealth: 120});
  close(coiled.damage, 44, 1e-12);
  close(coiled.multiplier, 2.2, 1e-12);
  close(coiled.bonus, 24, 1e-12);
  // Idle decay: 1.5 s of grace, then half a meter per second.
  DEEP_COMPUTE.step(state, 10, {firing: true});
  close(DEEP_COMPUTE.charge(state), 1, 1e-12);
  DEEP_COMPUTE.step(state, 1.49);
  close(DEEP_COMPUTE.charge(state), 1, 1e-12);
  DEEP_COMPUTE.step(state, .01);
  DEEP_COMPUTE.step(state, .5);
  close(DEEP_COMPUTE.charge(state), .75, 1e-12);
  // Reset on death.
  DEEP_COMPUTE.step(state, 10, {firing: true});
  resetOperatorVerbState(state, 'death');
  close(DEEP_COMPUTE.charge(state), 0);
});

test('Deep Compute clamp: the max multiplier can never one-shot a full-health target (swept proof)', () => {
  const state = createOperatorVerbState('deepseek');
  assert.equal(OPERATOR_VERBS['deep-compute'].numbers.maxBonusMultiplier, .35);
  assert.equal(SINGLE_HIT_CAP, 90);
  assert.equal(ONE_SHOT_HEALTH_FRACTION, .9);
  // Direct-hit ceiling helper.
  assert.equal(DEEP_COMPUTE.clampShot(state, 500, {targetHealth: 120}), 90);
  close(DEEP_COMPUTE.clampShot(state, 500, {targetHealth: 60}), 54, 1e-9);
  assert.equal(DEEP_COMPUTE.clampShot(state, 20, {targetHealth: 100}), 20);
  assert.equal(DEEP_COMPUTE.clampShot(state, 1000), 90, 'no target info still gets the flat §4.7 cap');
  // Sweep every weapon direct damage, the roster healths plus a 1..200 range,
  // and every plausible attachment charge at full compute charge.
  const healths = [...new Set([...CHARACTERS.map(character => character.stats.health), ...Array.from({length: 200}, (_, index) => index + 1)])];
  const attachments = [1, 1.15, 1.25, 2.2, 3];
  let cases = 0;
  for (const [index, weapon] of WEAPONS.entries()) {
    for (const health of healths) {
      for (const attachment of attachments) {
        DEEP_COMPUTE.step(state, 10, {firing: true});
        const shot = DEEP_COMPUTE.onShot(state, {baseDamage: weapon.damage, attachmentCharge: attachment, targetHealth: health});
        const ceiling = Math.min(SINGLE_HIT_CAP, ONE_SHOT_HEALTH_FRACTION * health);
        assert.ok(shot.damage <= ceiling + 1e-9, `weapon ${index} health ${health} attachment ${attachment}: ${shot.damage} > ${ceiling}`);
        assert.ok(shot.damage < health, `weapon ${index} health ${health} attachment ${attachment} one-shots`);
        assert.ok(shot.damage <= SINGLE_HIT_CAP + 1e-9, `weapon ${index} > §4.7 single-hit cap`);
        cases++;
      }
    }
  }
  assert.ok(cases >= 1000, `sweep covered ${cases} cases`);
  // The sweep's worst case is explicit: a full-charge rail vs a 90 HP Striker
  // clamps to 81 (90% of full health), never a one-shot.
  DEEP_COMPUTE.step(state, 10, {firing: true});
  const rail = DEEP_COMPUTE.onShot(state, {baseDamage: WEAPONS[2].damage, attachmentCharge: 1, targetHealth: 90});
  close(rail.damage, 81, 1e-9);
  assert.equal(rail.capped, true);
});

test('Meta Braced: spawn-armor regen out of combat and crouch halving knockback', () => {
  const state = createOperatorVerbState('meta');
  close(BRACED.armorRegen(state, 4, {spawnArmor: 20, currentArmor: 0}), 20);
  close(BRACED.armorRegen(state, .5, {spawnArmor: 20, currentArmor: 19.9}), .1, 1e-12);
  assert.equal(BRACED.armorRegen(state, 1, {spawnArmor: 20, currentArmor: 20}), 0, 'never past spawn armor');
  assert.equal(BRACED.armorRegen(state, 1, {spawnArmor: 20, currentArmor: 26}), 0, 'gear armor is not a regen cap target');
  assert.equal(BRACED.armorRegen(state, 1, {spawnArmor: 0, currentArmor: 0}), 0, 'no spawn armor, no regen');
  assert.equal(BRACED.armorRegen(state, 1, {spawnArmor: 20, currentArmor: 5, grounded: false}), 0, 'disabled airborne');
  BRACED.onDamage(state);
  close(BRACED.armorRegen(state, 1, {spawnArmor: 20, currentArmor: 0}), 0);
  assert.equal(BRACED.regenActive(state, {spawnArmor: 20, currentArmor: 0}), false);
  BRACED.step(state, 1.49);
  close(BRACED.armorRegen(state, .5, {spawnArmor: 20, currentArmor: 0}), 0);
  BRACED.step(state, .02);
  close(BRACED.armorRegen(state, .5, {spawnArmor: 20, currentArmor: 0}), 2.5, 1e-12, 'regen resumes 1.5 s after damage');
  assert.equal(BRACED.regenActive(state, {spawnArmor: 20, currentArmor: 0}), true);
  close(BRACED.knockbackMultiplier(state, {crouching: true}), .5);
  close(BRACED.knockbackMultiplier(state, {crouching: true, firing: false}), .5);
  close(BRACED.knockbackMultiplier(state, {crouching: true, firing: true}), 1, 'crouching without firing only');
  close(BRACED.knockbackMultiplier(state, {crouching: false, firing: true}), 1);
});

test('Claude Alignment Review: 3 s hold builds a 35 HP / 2.5 s absorb pool, no stacking', () => {
  const state = createOperatorVerbState('claude');
  ALIGNMENT_REVIEW.step(state, 1, {grounded: false});
  close(ALIGNMENT_REVIEW.meter(state), 0, 1e-12, 'airborne does not build');
  ALIGNMENT_REVIEW.step(state, 1, {sprinting: true});
  close(ALIGNMENT_REVIEW.meter(state), 0, 1e-12, 'sprinting does not build');
  ALIGNMENT_REVIEW.step(state, 1, {firing: true});
  close(ALIGNMENT_REVIEW.meter(state), 0, 1e-12, 'firing does not build');
  ALIGNMENT_REVIEW.step(state, 2.99, {});
  assert.ok(ALIGNMENT_REVIEW.meter(state) < 1 && ALIGNMENT_REVIEW.absorbPool(state) === 0);
  ALIGNMENT_REVIEW.step(state, .01, {});
  close(ALIGNMENT_REVIEW.absorbPool(state), 35, 1e-12, 'the pool is ~35 HP');
  close(ALIGNMENT_REVIEW.status(state).poolIn, 2.5, 1e-12, 'the pool lasts 2.5 s');
  assert.equal(ALIGNMENT_REVIEW.absorbActive(state), true);
  ALIGNMENT_REVIEW.step(state, 1, {});
  close(ALIGNMENT_REVIEW.meter(state), 0, 1e-12, 'the pool blocks recharge, so it never stacks');
  close(ALIGNMENT_REVIEW.absorbPool(state), 35, 1e-12);
  ALIGNMENT_REVIEW.step(state, 1.49, {});
  close(ALIGNMENT_REVIEW.absorbPool(state), 35, 1e-12);
  ALIGNMENT_REVIEW.step(state, .02, {});
  assert.equal(ALIGNMENT_REVIEW.absorbActive(state), false, 'the pool expires after 2.5 s');
  close(ALIGNMENT_REVIEW.absorbPool(state), 0);
  // Absorb consumes before armor/health and reports the remainder.
  ALIGNMENT_REVIEW.step(state, 3, {});
  const first = ALIGNMENT_REVIEW.absorb(state, 20);
  close(first.absorbed, 20);
  close(first.remaining, 0);
  close(first.pool, 15);
  assert.equal(first.broke, false);
  const second = ALIGNMENT_REVIEW.absorb(state, 30);
  close(second.absorbed, 15);
  close(second.remaining, 15);
  close(second.pool, 0);
  assert.equal(second.broke, true);
  assert.equal(ALIGNMENT_REVIEW.absorbActive(state), false);
  // Damage pauses the build for 1.5 s but does not reset it.
  ALIGNMENT_REVIEW.step(state, 1, {});
  const held = ALIGNMENT_REVIEW.meter(state);
  assert.ok(held > 0);
  ALIGNMENT_REVIEW.onDamage(state);
  ALIGNMENT_REVIEW.step(state, 1, {});
  close(ALIGNMENT_REVIEW.meter(state), held, 1e-12);
  ALIGNMENT_REVIEW.step(state, .51, {});
  assert.ok(ALIGNMENT_REVIEW.meter(state) > held, 'the build resumes');
  // One huge dt still grants exactly one capped pool.
  const burst = createOperatorVerbState('claude');
  ALIGNMENT_REVIEW.step(burst, 100, {});
  close(ALIGNMENT_REVIEW.absorbPool(burst), 35, 1e-12);
  close(ALIGNMENT_REVIEW.status(burst).poolIn, 2.5, 1e-12);
});

test('ChatGPT Adaptive: half holster time and a bounded first-magazine handling window', () => {
  const state = createOperatorVerbState('chatgpt');
  close(ADAPTIVE.swapDelay(state, .45), .225, 1e-12);
  close(ADAPTIVE.swapDelay(state, 0), 0);
  assert.deepEqual(ADAPTIVE.handling(state), {interval: 1, spread: 1});
  assert.equal(ADAPTIVE.windowActive(state), false);
  ADAPTIVE.onSwap(state, {magazine: 10});
  assert.equal(ADAPTIVE.windowActive(state), true);
  assert.deepEqual(ADAPTIVE.handling(state), {interval: .94, spread: .95});
  for (let shot = 0; shot < 9; shot++) ADAPTIVE.onShot(state);
  assert.equal(ADAPTIVE.windowActive(state), true, 'nine of ten rounds still count as the first magazine');
  ADAPTIVE.onShot(state);
  assert.equal(ADAPTIVE.windowActive(state), false, 'the magazine ends the window');
  assert.deepEqual(ADAPTIVE.handling(state), {interval: 1, spread: 1});
  ADAPTIVE.onSwap(state, {magazine: 10});
  ADAPTIVE.onReload(state);
  assert.equal(ADAPTIVE.windowActive(state), false, 'a reload ends the window');
  ADAPTIVE.onSwap(state, {magazine: 0});
  assert.equal(ADAPTIVE.windowActive(state), true, 'an unlimited magazine still gets the time window');
  ADAPTIVE.step(state, 5.99);
  assert.equal(ADAPTIVE.windowActive(state), true);
  ADAPTIVE.step(state, .02);
  assert.equal(ADAPTIVE.windowActive(state), false, 'the 6 s ceiling closes it');
  setOperatorVerbActive(state, false);
  close(ADAPTIVE.swapDelay(state, .45), .45);
  assert.deepEqual(ADAPTIVE.handling(state), {interval: 1, spread: 1});
});

test('Kimi Long Context: 1.5 s trail TTL, one per enemy per 3 s, cloak suppression, longer band', () => {
  const state = createOperatorVerbState('kimi');
  const trail = LONG_CONTEXT.record(state, {enemyId: 1, x: 3, z: -4});
  assert.deepEqual(trail, {enemyId: 1, x: 3, z: -4, ttl: 1.5});
  assert.equal(LONG_CONTEXT.record(state, {enemyId: 1, x: 9, z: 9}), null, 'one per enemy per 3 s');
  assert.ok(LONG_CONTEXT.record(state, {enemyId: 2, x: 1, z: 1}), 'each enemy has its own cadence');
  assert.equal(LONG_CONTEXT.record(state, {enemyId: 3, x: 1, z: 1, cloaked: true}), null, 'cloak suppresses');
  assert.equal(LONG_CONTEXT.record(state, {enemyId: 3, x: 1, z: 1, visible: false}), null);
  LONG_CONTEXT.step(state, 1);
  for (const entry of LONG_CONTEXT.trails(state)) assert.ok(entry.ttl <= 1.5 && entry.ttl > 0, 'TTL is bounded by 1.5 s');
  LONG_CONTEXT.step(state, .5);
  assert.deepEqual(LONG_CONTEXT.trails(state), [], 'both trails expire at 1.5 s');
  LONG_CONTEXT.step(state, 1.49);
  assert.equal(LONG_CONTEXT.record(state, {enemyId: 1, x: 0, z: 0}), null, 'the 3 s cadence outlives the trail');
  LONG_CONTEXT.step(state, .02);
  assert.ok(LONG_CONTEXT.record(state, {enemyId: 1, x: 0, z: 0}), 'the cadence reopens at 3 s');
  close(LONG_CONTEXT.rangeMultiplier(state), 1.08);
  assert.ok(LONG_CONTEXT.rangeMultiplier(state) <= 1.1, 'the band stays slight');
});

test('Qwen Tool Use: 1.35x capped interactions, pickup reload + handling, reach and vehicles', () => {
  const state = createOperatorVerbState('qwen');
  close(TOOL_USE.interactionMultiplier(state, {kind: 'objective'}), 1.35);
  close(TOOL_USE.interactionMultiplier(state, {kind: 'pickup'}), 1.35);
  assert.equal(TOOL_USE.interactionMultiplier(state, {kind: 'flag'}), 1, 'never on flag pickup');
  assert.equal(TOOL_USE.interactionMultiplier(state, {kind: 'flag-capture'}), 1, 'never on flag capture');
  assert.equal(TOOL_USE.interactionMultiplier(state, {kind: 'unknown'}), 1);
  const pickup = TOOL_USE.onPickup(state, {magazine: 10, ammo: 2, cap: 30});
  assert.deepEqual(pickup, {reload: 5, active: true});
  assert.deepEqual(TOOL_USE.handling(state), {interval: .92, spread: .94});
  TOOL_USE.step(state, 1.99);
  assert.equal(TOOL_USE.windowActive(state), true);
  TOOL_USE.step(state, .02);
  assert.equal(TOOL_USE.windowActive(state), false, '2 s handling window');
  assert.deepEqual(TOOL_USE.handling(state), {interval: 1, spread: 1});
  assert.equal(TOOL_USE.onPickup(state, {magazine: 10, ammo: 28, cap: 30}).reload, 2, 'bounded by the missing ammo');
  assert.equal(TOOL_USE.onPickup(state, {magazine: Infinity, ammo: Infinity, cap: Infinity}).reload, 0, 'no partial reload into an infinite magazine');
  close(TOOL_USE.meleeRange(state, 2.4), 2.76, 1e-12);
  close(TOOL_USE.meleeRange(state), 2.4 * 1.15, 1e-12);
  const vehicle = TOOL_USE.vehicle(state);
  assert.deepEqual(vehicle, {traverse: 1.15, speed: 1.05, boost: 1.1, repairPerSecond: 4});
  assert.ok(Object.isFrozen(vehicle));
  assert.ok(vehicle.speed <= 1.1, 'class vehicle handling stays a slight edge');
  assert.ok(vehicle.repairPerSecond > 0, 'the only additive vehicle effect');
});

test('§4.7 bounded stacking: caps hold and no verb adds a top-speed multiplier', () => {
  for (const id of OPERATOR_VERB_IDS) {
    for (const key of Object.keys(OPERATOR_VERBS[id].numbers)) {
      assert.ok(!/^(speed|velocity|damage|resistance)/i.test(key), `${id}.${key} must not be a raw stat multiplier`);
    }
  }
  const grok = createOperatorVerbState('grok');
  for (let hit = 0; hit < 50; hit++) HEAT.onHitLanded(grok);
  assert.ok(HEAT.fireRateMultiplier(grok) <= 1.12 + 1e-12);
  const qwen = createOperatorVerbState('qwen');
  assert.ok(TOOL_USE.interactionMultiplier(qwen) <= 1.35);
  TOOL_USE.onPickup(qwen, {magazine: 10, ammo: 0, cap: 30});
  assert.ok(TOOL_USE.handling(qwen).interval >= .88);
  const chatgpt = createOperatorVerbState('chatgpt');
  ADAPTIVE.onSwap(chatgpt, {magazine: 10});
  assert.ok(ADAPTIVE.handling(chatgpt).interval >= .88);
  const kimi = createOperatorVerbState('kimi');
  LONG_CONTEXT.record(kimi, {enemyId: 1, x: 0, z: 0});
  for (const trail of LONG_CONTEXT.trails(kimi)) assert.ok(trail.ttl <= 1.5);
  const claude = createOperatorVerbState('claude');
  ALIGNMENT_REVIEW.step(claude, 100, {});
  assert.ok(ALIGNMENT_REVIEW.absorbPool(claude) <= 35);
  assert.ok(ALIGNMENT_REVIEW.status(claude).poolIn <= 2.5);
  const deepseek = createOperatorVerbState('deepseek');
  DEEP_COMPUTE.step(deepseek, 100, {firing: true});
  DEEP_COMPUTE.step(deepseek, 0, {firing: true});
  close(DEEP_COMPUTE.charge(deepseek), 1, 1e-12, 'the charge meter caps at 1');
});

// A fixed script over all nine states: no clock, no RNG, no external inputs.
function scriptedRun() {
  const characters = ['mistral', 'gemini', 'grok', 'deepseek', 'meta', 'claude', 'chatgpt', 'kimi', 'qwen'];
  const [mistral, gemini, grok, deepseek, meta, claude, chatgpt, kimi, qwen] = characters.map(character => createOperatorVerbState(character));
  for (let step = 0; step < 300; step++) {
    const dt = 1 / 60;
    const firing = step % 3 !== 0;
    stepOperatorVerbState(mistral, dt, {});
    stepOperatorVerbState(gemini, dt, {});
    stepOperatorVerbState(grok, dt, {});
    stepOperatorVerbState(deepseek, dt, {firing});
    stepOperatorVerbState(meta, dt, {grounded: step % 11 !== 0});
    stepOperatorVerbState(claude, dt, {grounded: step % 5 !== 1, sprinting: step % 7 === 0, firing});
    stepOperatorVerbState(chatgpt, dt, {});
    stepOperatorVerbState(kimi, dt, {});
    stepOperatorVerbState(qwen, dt, {});
    if (step % 4 === 0) HEAT.onHitLanded(grok);
    if (step % 40 === 0) DEEP_COMPUTE.onShot(deepseek, {baseDamage: 11, attachmentCharge: 1, targetHealth: 100});
    if (step % 25 === 0) BRACED.onDamage(meta);
    if (step % 31 === 0) ALIGNMENT_REVIEW.onDamage(claude);
    if (step % 50 === 0) ADAPTIVE.onSwap(chatgpt, {magazine: 8});
    if (step % 4 === 0) ADAPTIVE.onShot(chatgpt);
    if (step % 12 === 0) LONG_CONTEXT.record(kimi, {enemyId: step / 12 % 3, x: step * .25, z: -step * .5});
    if (step % 60 === 0) TOOL_USE.onPickup(qwen, {magazine: 10, ammo: 2, cap: 30});
    if (step % 90 === 0) ALIGNMENT_REVIEW.absorb(claude, 12);
  }
  resetOperatorVerbState(meta, 'death');
  HEAT.onHitLanded(grok);
  return JSON.stringify([mistral, gemini, grok, deepseek, meta, claude, chatgpt, kimi, qwen].map(state => operatorVerbSnapshot(state)));
}

test('two identical scripted runs are byte-identical (deterministic)', () => {
  assert.equal(scriptedRun(), scriptedRun());
});

test('the module source has no clock, RNG, DOM or timer dependency', () => {
  const source = readFileSync(new URL('./operator-verbs.mjs', import.meta.url), 'utf8');
  for (const token of ['Math.random', 'Date.now', 'performance.now', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'document.', 'window.']) {
    assert.ok(!source.includes(token), `module must not use ${token}`);
  }
});
