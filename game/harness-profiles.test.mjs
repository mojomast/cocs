import test from 'node:test';
import assert from 'node:assert/strict';
import {HARNESSES, WEAPONS} from './data.mjs';
import {Match,moveActor} from './core.mjs';
import {
  HARNESS_PROFILES,
  HARNESS_PROFILE_IDS,
  abilityOf,
  getHarnessProfile,
  harnessAbility,
  harnessBotHints,
  harnessPassive,
  harnessWeaponHandling,
  preferredHarnessWeapon,
} from './harness-profiles.mjs';

test('profiles preserve the seven shipped harness IDs and are immutable', () => {
  assert.deepEqual(HARNESS_PROFILE_IDS, HARNESSES.map(harness => harness.id));
  assert.equal(Object.keys(HARNESS_PROFILES).length, 7);
  assert.equal(getHarnessProfile('not-a-harness'), null);
  assert.throws(() => { HARNESS_PROFILES.openclaw.passive.speed = 2; }, TypeError);
});

test('every harness has a distinct, bounded passive and active contract', () => {
  const passiveFingerprints = new Set();
  const abilityFingerprints = new Set();
  for (const harness of HARNESSES) {
    const passive = harnessPassive(harness.id);
    const ability = harnessAbility(harness.id);
    passiveFingerprints.add(JSON.stringify(passive));
    abilityFingerprints.add(JSON.stringify(ability));
    assert.ok(passive.speed >= .95 && passive.speed <= 1.05);
    assert.ok(passive.damage >= .97 && passive.damage <= 1.05);
    assert.ok(passive.resistance >= 0 && passive.resistance <= .05);
    assert.ok(ability.cooldown >= 10 && ability.cooldown <= 16);
  }
  assert.equal(passiveFingerprints.size, 7);
  assert.equal(abilityFingerprints.size, 7);
});

test('weapon handling covers all slots without runaway stacking', () => {
  for (const harness of HARNESSES) {
    const profile = getHarnessProfile(harness.id);
    assert.equal(profile.weapons.preferred.length, 2);
    assert.equal(new Set(profile.weapons.preferred).size, 2);
    for (const weapon of WEAPONS) {
      const handling = harnessWeaponHandling(harness.id, WEAPONS.indexOf(weapon));
      assert.ok(handling);
      assert.ok(handling.damage >= .9 && handling.damage <= 1.12);
      assert.ok(handling.interval >= .88 && handling.interval <= 1.08);
      assert.ok(handling.spread >= .88 && handling.spread <= 1.14);
      assert.ok(handling.affinity === 1 || handling.affinity === 1.08);
    }
  }
  assert.equal(harnessWeaponHandling('openclaw', 99), null);
  assert.equal(preferredHarnessWeapon('codex', [0, 6]), 6);
});

test('bot hints create seven distinct personalities with usable combat ranges', () => {
  const personalities = new Set();
  for (const harness of HARNESSES) {
    const bot = harnessBotHints(harness.id);
    personalities.add(bot.personality);
    assert.equal(bot.range.length, 2);
    assert.ok(bot.range[0] > 0 && bot.range[1] > bot.range[0]);
    assert.ok(bot.retreatHealth > 0 && bot.retreatHealth < 1);
    assert.ok(['close', 'escape', 'visible', 'hurt', 'approach', 'cluster'].includes(bot.power));
  }
 assert.equal(personalities.size, 7);
});

test('profiles affect the authoritative actor simulation',()=>{
 const hermes=new Match('chatgpt','hermes',()=>.5,'crosswire',{botCount:0}).actors[0];
 const baseline=new Match('chatgpt','openclaw',()=>.5,'crosswire',{botCount:0}).actors[0];
 for(const actor of [hermes,baseline]){Object.assign(actor,{x:0,y:0,z:0,vx:0,vy:0,vz:0,grounded:true});for(let i=0;i<30;i++)moveActor(actor,{x:1},1/60,{blocks:[]});}
 assert.ok(hermes.vx>baseline.vx);
 const guarded=new Match('chatgpt','claudecode',()=>.5,'crosswire',{botCount:0}).actors[0];
 assert.equal(guarded.harnessResistance,.04);
});

test('ability kinds, buffs and magnitudes are data-driven and memoized',()=>{
 const kinds={openclaw:'burst',hermes:'buff',opencode:'buff',claudecode:'buff',codex:'heal',cline:'dash',roo:'slow'};
 const buffs={openclaw:null,hermes:'speed',opencode:'fireRate',claudecode:'resistance',codex:null,cline:null,roo:null};
 for(const harness of HARNESSES){
  const ability=abilityOf(harness.id);
  assert.equal(ability,harnessAbility(harness.id),'abilityOf shares the resolved profile descriptor');
  assert.equal(abilityOf(harness.id),abilityOf(harness.id),'memoized by id');
  assert.equal(abilityOf(HARNESS_PROFILES[harness.id]),abilityOf(harness.id),'accepts a profile object');
  assert.equal(abilityOf(harness.id).kind,kinds[harness.id]);
  assert.equal(abilityOf(harness.id).buff,buffs[harness.id]);
  assert.equal(abilityOf(harness.id).magnitude,harness.magnitude,'magnitude mirrors the harness table');
  assert.ok(Object.isFrozen(ability));
 }
 assert.equal(abilityOf('not-a-harness'),null);
 assert.equal(abilityOf(null),null);
 assert.equal(abilityOf(undefined),null);
 assert.equal(abilityOf({}),null);
});
