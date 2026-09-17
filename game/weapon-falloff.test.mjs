import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,damageFalloff} from './core.mjs';
import {WEAPONS} from './data.mjs';

const falloff={start:10,end:30,min:.5};
test('damageFalloff keeps full damage inside the start range and tapers linearly',()=>{
 assert.equal(damageFalloff({},5),1);
 assert.equal(damageFalloff({falloff},0),1);
 assert.equal(damageFalloff({falloff},10),1);
 assert.equal(damageFalloff({falloff},20),.75);
 assert.equal(damageFalloff({falloff},30),.5);
 assert.equal(damageFalloff({falloff},300),.5);
 assert.equal(damageFalloff({falloff},NaN),1);
 assert.equal(damageFalloff({falloff:{start:10,min:.5}},40),.5);
});

const open=(weaponIndex,distance)=>{
 const m=new Match('chatgpt','openclaw',()=>.5,'exchange',{mode:'deathmatch',botCount:0,humanCount:2});
 m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};m.pickups=[];m.vehicles=[];
 const [a,b]=m.actors;
 Object.assign(a,{x:0,y:0,z:0,health:100,armor:0,protection:0,shotWait:0,reloading:false,weaponSwitch:0,punchYaw:0,punchPitch:0,spread:0,yaw:0,pitch:0,weapon:weaponIndex});
 Object.assign(b,{x:0,y:0,z:-distance,health:1000,maxHealth:1000,armor:0,protection:0});
 a.ammo[weaponIndex]=5;
 m.fire(a);
 return 1000-b.health;
};

test('hitscan damage falls off with distance on falloff weapons',()=>{
 const close=open(0,5),far=open(0,70);
 assert.ok(close>0&&far>0);
 assert.ok(far<close,`far ${far} should be below close ${close}`);
 const ratio=far/close;
 assert.ok(Math.abs(ratio-.62)<.02,`expected ~0.62 falloff ratio, got ${ratio}`);
});

test('hitscan weapons without falloff deal equal damage at any range',()=>{
 const close=open(2,5),far=open(2,70);
 assert.ok(close>0);
 assert.equal(close,far);
});

test('every falloff entry is well-formed',()=>{
 for(const weapon of WEAPONS)if(weapon.falloff)assert.ok(Number.isFinite(weapon.falloff.start)&&weapon.falloff.end>weapon.falloff.start&&weapon.falloff.min>0&&weapon.falloff.min<=1,`${weapon.name} falloff`);
});
