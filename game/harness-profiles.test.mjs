import test from 'node:test';
import assert from 'node:assert/strict';
import {HARNESSES, WEAPONS} from './data.mjs';
import {Match,moveActor} from './core.mjs';
import {SPECS, SPEC_TRIGGERS, SPEC_EFFECT_TYPES, SPEC_EFFECT_TARGETS} from './kits.mjs';
import {
  HARNESS_PROFILES,
  HARNESS_PROFILE_IDS,
  abilityOf,
  getHarnessProfile,
  harnessAbility,
  harnessBotHints,
  harnessWeaponHandling,
  preferredHarnessWeapon,
} from './harness-profiles.mjs';

test('profiles preserve the seven shipped harness IDs and are immutable', () => {
  assert.deepEqual(HARNESS_PROFILE_IDS, HARNESSES.map(harness => harness.id));
  assert.equal(Object.keys(HARNESS_PROFILES).length, 7);
  assert.equal(getHarnessProfile('not-a-harness'), null);
  assert.throws(() => { HARNESS_PROFILES.openclaw.weapons.damage = 2; }, TypeError);
});

test('every harness has a distinct active contract and no hidden stat passive', () => {
  const abilityFingerprints = new Set();
  for (const harness of HARNESSES) {
    const profile = getHarnessProfile(harness.id);
    const ability = harnessAbility(harness.id);
    abilityFingerprints.add(JSON.stringify(ability));
    assert.equal(profile.passive, undefined, `${harness.id} carries no hidden stat passive`);
    assert.ok(!('speed' in profile) && !('damage' in profile) && !('resistance' in profile), `${harness.id} profile`);
    assert.ok(ability.cooldown >= 10 && ability.cooldown <= 16);
  }
  assert.equal(abilityFingerprints.size, 7);
});

test('the seven behavioural passives live in kits.mjs with triggers and labelled effects', () => {
  const ids = new Set();
  for (const spec of SPECS) {
    const passive = spec.passive;
    ids.add(passive.id);
    assert.ok(SPEC_TRIGGERS.includes(passive.trigger), `${spec.id} trigger`);
    assert.ok(Array.isArray(passive.effects) && passive.effects.length > 0, `${spec.id} effects`);
    for (const effect of passive.effects) {
      assert.ok(SPEC_EFFECT_TYPES.includes(effect.type), `${spec.id} effect ${effect.type}`);
      assert.ok(SPEC_EFFECT_TARGETS.includes(effect.target), `${spec.id} target ${effect.target}`);
      assert.ok(effect.type !== 'speed', `${spec.id} must not hide a speed multiplier`);
      assert.ok(effect.type !== 'resistance', `${spec.id} must not hide a resistance multiplier`);
    }
  }
  assert.equal(ids.size, 7);
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
      assert.equal(handling.favored, profile.weapons.preferred.includes(WEAPONS.indexOf(weapon)), 'favored matches the preferred band');
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

test('profiles affect the authoritative actor simulation through named behaviour only',()=>{
 const hermes=new Match('chatgpt','hermes',()=>.5,'crosswire',{botCount:0}).actors[0];
 const baseline=new Match('chatgpt','openclaw',()=>.5,'crosswire',{botCount:0}).actors[0];
 for(const actor of [hermes,baseline]){Object.assign(actor,{x:0,y:0,z:0,vx:0,vy:0,vz:0,grounded:true});for(let i=0;i<30;i++)moveActor(actor,{x:1},1/60,{blocks:[]});}
 assert.equal(hermes.vx,baseline.vx,'walk speed carries no hidden harness multiplier');
 // Express: only Hermes keeps the sprint posture while a reload is running.
 for(const actor of [hermes,baseline])Object.assign(actor,{x:0,vx:0,reloading:true});
 for(let i=0;i<30;i++)moveActor(hermes,{x:1,sprint:true},1/60,{blocks:[]});
 for(let i=0;i<30;i++)moveActor(baseline,{x:1,sprint:true},1/60,{blocks:[]});
 assert.equal(hermes.sprinting,true,'Hermes can sprint while reloading');
 assert.equal(baseline.sprinting,false,'every other spec must wait out the reload');
 assert.ok(hermes.vx>baseline.vx);
 const guarded=new Match('chatgpt','claudecode',()=>.5,'crosswire',{botCount:0}).actors[0];
 assert.equal(guarded.harnessResistance,undefined,'Guardrail is the only resistance source');
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

// Phase-5 tune pin: the shipped active numbers, one row per harness. The
// golden parity fixture is the behavioural observation; this keeps the data
// table and the resolved profile from drifting apart when either is re-tuned.
test('the seven active abilities carry the tuned numbers',()=>{
 const expected={
  openclaw:{radius:6,damage:30,knockback:14,lift:5,cooldown:10},
  hermes:{duration:3.5,speed:1.6,cooldown:10},
  opencode:{duration:3.5,fireRate:1/.55,cooldown:14},
  claudecode:{duration:3.5,resistance:.5,cooldown:10},
  codex:{duration:2,heal:45,cooldown:16},
  cline:{duration:.35,distance:7,cooldown:11},
  roo:{duration:3,radius:8,slow:.5,cooldown:12},
 };
 for(const [id,fields] of Object.entries(expected)){
  const ability=abilityOf(id);
  for(const [key,value] of Object.entries(fields))assert.equal(ability[key],value,`${id}.${key}`);
 }
});
