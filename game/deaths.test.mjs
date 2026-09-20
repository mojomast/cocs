import test from 'node:test';
import assert from 'node:assert/strict';
import {OVERKILL_GIB,deathPlan,deathStyleFor,deathPose,hitReaction,hashSeed,hashUnit,FALL_POSES,DEATH_STYLES,fallDuration,corpseRotation,corpseTreatment} from './deaths.mjs';

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

test('hit reactions are deterministic, bounded and scale with damage',()=>{
 const context={damage:20,dir:{x:1,z:0},seed:5,actor:2,serial:7};
 assert.deepEqual(hitReaction(context),hitReaction(context),'the same hit context reproduces the reaction');
 const light=hitReaction({damage:2,dir:{x:0,z:1},seed:1}),heavy=hitReaction({damage:35,dir:{x:0,z:1},seed:1});
 assert.ok(heavy.strength>light.strength,'more damage flinches harder');
 assert.equal(heavy.strength,1,'a 35-damage hit saturates the flinch');
 assert.ok(light.strength>=0&&light.strength<=1);
 for(const reaction of [light,heavy]){
  assert.ok(reaction.lean>=0&&reaction.lean<=.9,`lean bounded: ${reaction.lean}`);
  assert.ok(reaction.push>=0&&reaction.push<=.4,`push bounded: ${reaction.push}`);
  assert.ok(reaction.count>=0&&Number.isInteger(reaction.count));
  for(const key of ['pushX','pushZ','sprayX','sprayZ','seed'])assert.ok(Number.isFinite(reaction[key]),`${key} finite`);
 }
 const blood=hitReaction({damage:10,dir:{x:1,z:0}}),spark=hitReaction({damage:10,dir:{x:1,z:0},energy:true}),ember=hitReaction({damage:10,dir:{x:1,z:0},fire:true});
 assert.equal(blood.kind,'blood');assert.equal(spark.kind,'spark');assert.equal(ember.kind,'ember');
 assert.notEqual(blood.color,spark.color,'energy hits read differently from blood');
 const reduced=hitReaction({damage:30,dir:{x:1,z:0},reduced:true});
 assert.equal(reduced.lean,0,'reduced motion drops the flinch lean');
 assert.equal(reduced.push,0,'reduced motion drops the knockback push');
 assert.ok(reduced.count<=2,'reduced motion emits a minimal spray');
 const noDir=hitReaction({damage:10});
 assert.equal(noDir.pushX,0);assert.equal(noDir.pushZ,0);
});

test('an explicit validated style wins and invalid styles fall back to the hash',()=>{
 for(const style of DEATH_STYLES){
  assert.equal(deathStyleFor({style,weapon:0,seed:7}),style);
  const plan=deathPlan({style,weapon:0,seed:7,actor:2});
  assert.equal(plan.style,style);
  assert.equal(typeof plan.sound,'string');
  assert.equal(typeof plan.seed,'number');
 }
 assert.equal(deathStyleFor({style:'not-a-style',weapon:1,seed:7}),deathStyleFor({weapon:1,seed:7}));
 assert.equal(deathStyleFor({style:42}),deathStyleFor({}));
 assert.equal(deathPlan({style:'vaporize',weapon:1,seed:7}).energy,true);
 assert.equal(deathPlan({style:'combust',weapon:1,seed:7}).fire,true);
 assert.equal(deathPlan({style:'collapse',weapon:1,seed:7}).crumple,true);
 assert.ok(Math.abs(deathPlan({style:'spinout',weapon:1,seed:7}).spin)<=1.6);
 assert.equal(deathPlan({style:'headpop',weapon:1,seed:7}).hideHead,true);
 assert.equal(deathPlan({style:'headpop',weapon:1,seed:7}).sound,'pop');
});

test('every pose/style fall arc is distinct, bounded and settles horizontal-capable',()=>{
 const durations=new Set();
 for(const pose of FALL_POSES)for(const style of DEATH_STYLES){
  const value=fallDuration({pose,style});
  assert.ok(value>=.45-1e-9&&value<=1.15+1e-9,`${pose}/${style} duration ${value}`);
  durations.add(value.toFixed(3));
 }
 assert.ok(durations.size>=12,`wide duration variety, got ${durations.size}`);
 assert.notEqual(fallDuration({pose:'forward',style:'gibs'}),fallDuration({pose:'forward',style:'electrocute'}));
 assert.ok(fallDuration({pose:'crumple',style:'ragdoll'})>fallDuration({pose:'forward',style:'ragdoll'}),'a crumple buckles slower than a faceplant');
 assert.ok(fallDuration({pose:'foreward',style:'ragdoll'})>=.45,'unknown poses keep a bounded fallback');
 for(const pose of FALL_POSES){
  const side=pose==='left'||pose==='right';
  const settled=corpseRotation({pose,style:'ragdoll',roll:1,spin:1},1);
  const primary=side?settled.z:settled.x;
  assert.ok(Math.abs(Math.abs(primary)-Math.PI/2)<1e-9,`${pose} settles on its primary axis`);
  assert.ok((side?settled.x:settled.z)>0,'positive roll leans the settled corpse into the roll side');
  for(const value of [settled.x,settled.y,settled.z])assert.ok(Number.isFinite(value)&&Math.abs(value)<=1.9);
  const opposite=corpseRotation({pose,style:'ragdoll',roll:-1},1);
  assert.ok((side?opposite.x:opposite.z)<0,'negative roll leans the other way');
 }
 const tumble=style=>Math.abs(corpseRotation({pose:'sprawl',style,spin:1},.5).y);
 assert.ok(tumble('spinout')>tumble('collapse'),'spinout tumbles harder than a collapse');
 assert.ok(tumble('spinout')>tumble('crumple'),'spinout tumbles harder than a crumple');
 const reduced=corpseRotation({pose:'sprawl',style:'spinout',spin:1,roll:1},.2,0,true);
 assert.deepEqual(reduced,corpseRotation({pose:'sprawl',style:'spinout',spin:1,roll:1},1,0,true),'reduced motion settles instantly');
 const mid=new Set(FALL_POSES.map(pose=>{const r=corpseRotation({pose,style:'ragdoll'},.4);return `${r.x.toFixed(3)}|${r.z.toFixed(3)}`;}));
 assert.ok(mid.size>=5,`pose arcs differ mid-fall, got ${mid.size}`);
});

test('style treatments time the head, fade energy bodies and flatten splatter within bounds',()=>{
 assert.equal(corpseTreatment({style:'headpop',hideHead:true},0).hideHead,false,'the pop reads before the head vanishes');
 assert.equal(corpseTreatment({style:'headpop',hideHead:true},1).hideHead,true);
 assert.equal(corpseTreatment({style:'ragdoll',hideHead:true},0).hideHead,true,'ordinary styles drop the head at once');
 assert.equal(corpseTreatment({style:'gibs',hideBody:true},0).hideBody,false,'gibs keeps a beat before the body goes');
 assert.equal(corpseTreatment({style:'gibs',hideBody:true},.1).hideBody,true);
 assert.equal(corpseTreatment({hideBody:true},0).hideBody,true,'manual plans keep the immediate hide');
 const vapor=corpseTreatment({style:'vaporize',energy:true},1).scale;
 assert.ok(vapor.x<=.5+1e-9&&vapor.x>=.499&&vapor.y<1,'vaporize scales the corpse out');
 const splat=corpseTreatment({style:'splatter',flatten:true},1).scale;
 assert.ok(splat.x>1&&splat.z>1&&splat.y<1,'splatter stays low and wide');
 const combust=corpseTreatment({style:'combust',fire:true},1).scale;
 assert.ok(combust.y<1&&combust.x<=1,'combust sinks without shrinking the footprint');
 for(const style of DEATH_STYLES)for(const t of [0,.25,.5,.75,1]){
  const scale=corpseTreatment({style},t).scale;
  for(const value of [scale.x,scale.y,scale.z])assert.ok(Number.isFinite(value)&&value>=.4&&value<=1.2,`${style}@${t} scale ${value}`);
 }
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
