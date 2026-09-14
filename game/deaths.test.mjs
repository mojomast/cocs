import test from 'node:test';
import assert from 'node:assert/strict';
import {OVERKILL_GIB,deathPlan,deathStyleFor,deathPose,hashSeed,hashUnit,FALL_POSES,DEATH_STYLES} from './deaths.mjs';

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
   assert.ok(DEATH_STYLES.includes(plan.style),`weapon ${weapon} -> ${plan.style}`);
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

test('the style table adds crumple, spinout and collapse profiles',()=>{
 for(const style of ['crumple','spinout','collapse'])assert.ok(DEATH_STYLES.includes(style),`${style} is a known profile`);
 const seen=new Set();
 for(let weapon=0;weapon<=9;weapon++)for(let seed=0;seed<256;seed++)seen.add(deathStyleFor({weapon,overkill:0,seed}));
 for(const style of ['crumple','spinout','collapse'])assert.ok(seen.has(style),`${style} is reachable across weapons/seeds`);
 assert.ok(seen.size>=10,`expected a wide style pool, got ${[...seen].join(',')}`);
});

test('death poses are deterministic, bounded and vary with the kill context',()=>{
 const context={weapon:1,overkill:20,seed:99,actor:4};
 const plan=deathPlan(context);
 assert.deepEqual(deathPose(plan,context),deathPose(plan,context),'pose is a pure function of the context');
 for(let seed=0;seed<128;seed++){
  const p=deathPlan({weapon:seed%10,overkill:seed*3,seed,actor:seed%8});
  assert.ok(FALL_POSES.includes(p.pose)||p.pose==='none',`${p.pose} is a known pose`);
  assert.ok(p.spin>=-1.6-1e-9&&p.spin<=1.6+1e-9,`spin bounded: ${p.spin}`);
  assert.ok(p.splay>=0&&p.splay<=1,`splay bounded: ${p.splay}`);
  assert.ok(p.roll>=-1&&p.roll<=1,`roll bounded: ${p.roll}`);
  for(const value of [p.spin,p.splay,p.roll])assert.ok(Number.isFinite(value));
 }
 const fallPoses=new Set();for(let seed=0;seed<96;seed++)fallPoses.add(deathPlan({fall:true,seed}).pose);
 assert.ok(fallPoses.size>=3,`falling corpses take several stances, got ${[...fallPoses].join(',')}`);
 const spins=new Set();for(let seed=0;seed<96;seed++)spins.add(Math.round(deathPlan({weapon:1,seed}).spin*100));
 assert.ok(spins.size>=6,`spin tumble varies, got ${spins.size} buckets`);
});

test('spinning styles carry a larger tumble multiplier than ordinary ragdolls',()=>{
 let spinTotal=0,spinCount=0,plainTotal=0,plainCount=0;
 for(let seed=0;seed<256;seed++){
  const style=deathStyleFor({weapon:1,seed});
  if(style==='spinout'){spinTotal+=Math.abs(deathPlan({weapon:1,seed}).spin);spinCount++;}
  if(style==='ragdoll'){plainTotal+=Math.abs(deathPlan({weapon:0,seed}).spin);plainCount++;}
 }
 if(spinCount&&plainCount)assert.ok(spinTotal/spinCount>=plainTotal/plainCount,`spinout ${spinTotal/spinCount} >= ragdoll ${plainTotal/plainCount}`);
});
