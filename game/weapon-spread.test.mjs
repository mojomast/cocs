import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,effectiveSpread,spreadDirection,aimBasis} from './core.mjs';
import {WEAPONS} from './data.mjs';

const rng=(seed=1)=>{let n=seed>>>0;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const len=a=>Math.hypot(a.x,a.y,a.z);

test('spread perturbs perpendicular to the aim line instead of along each world axis',()=>{
 for(const base of [{x:0,y:0,z:-1},{x:Math.SQRT1_2,y:0,z:-Math.SQRT1_2},{x:Math.sin(.6),y:Math.cos(.6),z:-Math.sin(.4)}]){
  const unit=base.x*base.x+base.y*base.y+base.z*base.z;
  const axis={x:base.x/Math.sqrt(unit),y:base.y/Math.sqrt(unit),z:base.z/Math.sqrt(unit)};
  const {right,up}=aimBasis(axis);
  assert.ok(Math.abs(dot(right,axis))<1e-9&&Math.abs(dot(up,axis))<1e-9,'basis is perpendicular to aim');
  assert.ok(Math.abs(dot(right,up))<1e-9&&Math.abs(len(right)-1)<1e-9&&Math.abs(len(up)-1)<1e-9,'basis is orthonormal');
  const random=rng(7);
  for(let i=0;i<400;i++){
   const d=spreadDirection(axis,.3,random);
   assert.ok(Math.abs(len(d)-1)<1e-9,'perturbed direction stays unit length');
   // A perpendicular offset only changes the aim component to second order; an
   // all-axis perturbation of the same magnitude would move it linearly.
   assert.ok(Math.abs(dot(d,axis)-1)<.3*.3+.01,`offset stays in the aim plane (${dot(d,axis)})`);
  }
 }
 assert.deepEqual(spreadDirection({x:0,y:0,z:-1},0,rng(1)),{x:0,y:0,z:-1},'zero spread returns the aim line untouched');
});

test('movement penalty no longer dominates base accuracy on precision weapons',()=>{
 const still=w=>effectiveSpread({vx:0,vz:0,moveSpeed:8,spread:0},w);
 const moving=w=>effectiveSpread({vx:8,vz:0,moveSpeed:8,spread:0},w);
 const penalty=w=>moving(w)-still(w);
 assert.ok(Math.abs(penalty(WEAPONS[0])-.035)<1e-9,'Pulse Rifle movement penalty is 0.035');
 assert.ok(Math.abs(penalty(WEAPONS[9])-.06)<1e-9,'SMG movement penalty is 0.06');
 assert.ok(Math.abs(penalty(WEAPONS[2])-.015)<1e-9,'Rail Lance movement penalty is 0.015');
 assert.ok(Math.abs(penalty(WEAPONS[8])-.025)<1e-9,'Marksman movement penalty is 0.025');
 for(const index of [1,4,5])assert.equal(penalty(WEAPONS[index]),0,`${WEAPONS[index].short} has no movement spread`);
 for(const index of [0,2,8,9])assert.ok(penalty(WEAPONS[index])<.07,`${WEAPONS[index].short} movement penalty stays well under the old value`);
});

test('pellet weapons keep a large fixed spread as their principal constraint',()=>{
 for(const index of [3,7]){const w=WEAPONS[index];assert.ok(w.pellets>1&&w.spread>.1);assert.ok((w.bloom?.moveFactor??0)<=.1,'movement does not dwarf pellet spread');}
});

const openArena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};
function distribution(weaponIndex,distance,moving,shots=400){
 const m=new Match('chatgpt','openclaw',rng(99),'exchange',{mode:'deathmatch',botCount:0,humanCount:2});
 m.arena=openArena;m.pickups=[];m.vehicles=[];
 const [a,b]=m.actors;
 Object.assign(a,{x:0,y:0,z:0,health:100,armor:0,protection:0,shotWait:0,reloading:false,weaponSwitch:0,punchYaw:0,punchPitch:0,spread:0,yaw:0,pitch:0,vx:moving?8:0,vz:0,moveSpeed:8,vehicleId:null,traversalCooldown:0});
 Object.assign(b,{x:0,y:0,z:-distance,health:100000,maxHealth:100000,armor:0,protection:0,harnessResistance:0});
 a.ammo[weaponIndex]=Infinity;a.weapon=weaponIndex;
 let hits=0;
 for(let i=0;i<shots;i++){
  // Reset recoil/bloom each shot so the sample isolates movement spread rather
  // than aim drift accumulating without a step() to recover it.
  a.shotWait=0;a.punchYaw=0;a.punchPitch=0;a.punchVelYaw=0;a.punchVelPitch=0;a.spread=0;
  const before=b.health;m.fire(a);if(b.health<before)hits++;
 }
 return {hits,rate:hits/shots,damage:100000-b.health};
}
test('seeded moving-shot scenarios report stable hit distributions after the retune',()=>{
 const pulse=distribution(0,26,true);
 const rail=distribution(2,60,true);
 const smg=distribution(9,20,true);
 assert.ok(pulse.rate>.4,`moving Pulse Rifle lands a useful share at 26m (${pulse.rate})`);
 assert.ok(rail.rate>.35,`moving Rail Lance keeps its precision at 60m (${rail.rate})`);
 assert.ok(smg.rate>.35,`moving SMG stays usable at 20m (${smg.rate})`);
 console.log('spread scenarios',JSON.stringify({pulse:pulse.rate,rail:rail.rate,smg:smg.rate}));
});
