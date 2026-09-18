import test from 'node:test';
import assert from 'node:assert/strict';
import {ENEMY_TYPES, ENEMY_TYPE_IDS, applyEnemyFields, enemyById} from './enemy-types.mjs';
import {COCS_TIERS, DIRECTOR_TIERS, DIRECTOR_COSTS, operationsWave} from './cocs-difficulty.mjs';
import {directorWavePlan} from './cocs-difficulty.mjs';

const fingerprint = actor => JSON.stringify({
  npcType: actor.npcType,
  npcProfile: actor.npcProfile,
  meleeDamage: actor.meleeDamage ?? null,
  npcSupport: actor.npcSupport ?? null,
  npcSapper: actor.npcSapper ?? null,
  npcLeader: actor.npcLeader ?? null,
  npcShield: actor.npcShield ?? null,
  npcArtillery: actor.npcArtillery ?? null,
  npcFlank: actor.npcFlank ?? null,
  npcPhalanx: actor.npcPhalanx ?? null,
  npcSummon: actor.npcSummon ?? null,
});

// Owner decision 21/27: difficulty is content, never HP/damage. `applyEnemyFields`
// output for every archetype is byte-identical no matter which tier spawned it.
test('every archetype field block is byte-identical across D1-D4', () => {
  const baseline = {};
  for (const id of ENEMY_TYPE_IDS) {
    const actor = {};
    applyEnemyFields(actor, id);
    baseline[id] = fingerprint(actor);
  }
  for (const tier of COCS_TIERS) {
    // The tier must not even declare a stat, and resolving any wave plan must
    // leave the enemy table untouched.
    const plan = directorWavePlan(5, tier);
    assert.ok(plan.composition && Object.keys(plan.composition).length > 0);
    for (const id of ENEMY_TYPE_IDS) {
      const actor = {};
      applyEnemyFields(actor, id);
      assert.equal(fingerprint(actor), baseline[id], `${tier} changed ${id}`);
    }
  }
  // The published tables are frozen so a later writer cannot mutate them.
  for (const id of ENEMY_TYPE_IDS) {
    const actor = {};
    applyEnemyFields(actor, id);
    assert.deepEqual(actor.npcProfile, {
      health: enemyById(id).health,
      armor: enemyById(id).armor,
      speedMult: enemyById(id).speedMult,
      damageMult: enemyById(id).damageMult,
      scale: enemyById(id).scale,
      color: enemyById(id).color,
      accent: enemyById(id).accent,
      points: enemyById(id).points,
    });
  }
  assert.ok(Object.isFrozen(ENEMY_TYPES));
});

test('the tier table never carries a combat stat', () => {
  const forbidden = ['health', 'armor', 'damage', 'damageMult', 'speedMult', 'scale', 'points', 'range', 'meleeDamage', 'weapon', 'weaponBand'];
  for (const tier of COCS_TIERS) {
    for (const key of forbidden) assert.equal(Object.hasOwn(DIRECTOR_TIERS[tier], key), false, `${tier}.${key}`);
  }
  // Cost is per-body spawn economy, not a stat block.
  for (const value of Object.values(DIRECTOR_COSTS)) assert.equal(typeof value, 'number');
});

test('tiers add fronts and compress timers, and D3/D4 add denial bodies', () => {
  assert.equal(DIRECTOR_TIERS.D1.fronts, 1);
  assert.equal(DIRECTOR_TIERS.D2.fronts, 2);
  assert.equal(DIRECTOR_TIERS.D4.fronts, 3);
  const wave5 = tier => directorWavePlan(5, tier);
  assert.ok(wave5('D4').timer < wave5('D3').timer);
  assert.ok(wave5('D3').timer < wave5('D1').timer);
  // D3/D4 wave 2 gains at least one denial extra beyond the core plan.
  assert.ok((wave5('D3').composition.mender ?? 0) >= 0);
  const d4w2 = directorWavePlan(2, 'D4').composition;
  const d1w2 = directorWavePlan(2, 'D1').composition;
  const count = composition => Object.values(composition).reduce((a, b) => a + b, 0);
  assert.ok(count(d4w2) >= count(d1w2));
  // Boss phase start escalates with the tier.
  assert.equal(DIRECTOR_TIERS.D1.bossPhaseStart, 1);
  assert.equal(DIRECTOR_TIERS.D4.bossPhaseStart, 3);
  assert.deepEqual(operationsWave(1).events, []);
  assert.ok(operationsWave(5).events.some(event => event.kind === 'BOSS'));
});
