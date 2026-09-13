import test from 'node:test';
import assert from 'node:assert/strict';
import {OVERKILL_GIB,deathPlan,deathStyleFor,hashSeed,hashUnit} from './deaths.mjs';

test('death hashing is deterministic and well distributed',()=>{
 assert.equal(hashSeed(1,2,3),hashSeed(1,2,3));
 assert.notEqual(hashSeed(1,2,3),hashSeed(3,2,1));
 for(let i=0;i<64;i++){const u=hashUnit(i,i*3,i*7);assert.ok(u>=0&&u<1);}
 const buckets=new Set();for(let i=0;i<64;i++)buckets.add(Math.floor(hashUnit(i)*4));assert.equal(buckets.size,4);
});

test('every weapon maps to a valid death style and plan',()=>{
 for(let weapon=0;weapon<=9;weapon++){
  for(let seed=0;seed<8;seed++){
   const plan=deathPlan({weapon,overkill:seed*4,seed});
   assert.ok(['ragdoll','headpop','gibs','burst','combust','vaporize','splatter','electrocute'].includes(plan.style),`weapon ${weapon} -> ${plan.style}`);
   assert.ok(Number.isInteger(plan.pieces)&&plan.pieces>=0);
   assert.ok(Number.isInteger(plan.gore)&&plan.gore>=0);
   assert.ok(Number.isFinite(plan.force)&&plan.force>=0);
   assert.ok(Number.isFinite(plan.duration)&&plan.duration>0);
   assert.equal(typeof plan.hideBody,'boolean');
   assert.equal(typeof plan.hideHead,'boolean');
   assert.match(plan.color,/^#[0-9a-f]{6}$/i);
  }
 }
});

test('the same kill context always produces the same plan',()=>{
 const context={weapon:1,overkill:30,seed:4242};
 assert.deepEqual(deathPlan(context),deathPlan(context));
 assert.equal(deathStyleFor(context),deathStyleFor(context));
});

test('massive overkill escalates to gore styles while normal kills vary',()=>{
 for(let seed=0;seed<32;seed++){
  const style=deathStyleFor({weapon:0,overkill:OVERKILL_GIB+80,seed});
  assert.ok(['gibs','burst','combust'].includes(style),`overkill -> ${style}`);
 }
 const styles=new Set();for(let seed=0;seed<64;seed++)styles.add(deathStyleFor({weapon:0,overkill:0,seed}));
 assert.ok(styles.size>=3,`expected variety, got ${[...styles].join(',')}`);
});

test('headshot and headshot weapons favour head pops',()=>{
 const headshots=new Set();for(let seed=0;seed<64;seed++)headshots.add(deathStyleFor({weapon:8,headshot:true,seed}));
 assert.ok(headshots.has('headpop'));
 const marksman=new Set();for(let seed=0;seed<64;seed++)marksman.add(deathStyleFor({weapon:8,seed}));
 assert.ok(marksman.has('headpop'));
 assert.ok(['ragdoll','gibs'].some(style=>marksman.has(style)),'precision rifle still has body variants');
});

test('void falls always collapse the body',()=>{
 for(let seed=0;seed<8;seed++){
  const plan=deathPlan({fall:true,seed});
  assert.equal(plan.style,'ragdoll');
  assert.equal(plan.hideBody,false);
  assert.equal(plan.topple,true);
 }
});
