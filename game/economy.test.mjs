import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {ECONOMY_PICKUPS,ECONOMY_PICKUP_IDS,POWERUPS,WEAPONS} from './data.mjs';
import {MAPS,SUPPLY_KINDS} from './maps.mjs';

const seeded=(n=29)=>{let a=n;return()=>((a=(Math.imul(a,1664525)+1013904223)>>>0)/4294967296);};
const quiet=(options={})=>new Match('chatgpt','openclaw',seeded(),'crosswire',{mode:'deathmatch',botCount:1,humanCount:1,timeLimit:60,...options});

test('economy pickups are a separate, stable table from the timed powerups',()=>{
 assert.equal(ECONOMY_PICKUPS.length,2);
 assert.deepEqual([...ECONOMY_PICKUP_IDS],['weaponUpgrade','deployable']);
 assert.equal(new Set(ECONOMY_PICKUP_IDS).size,ECONOMY_PICKUP_IDS.length);
 for(const pickup of ECONOMY_PICKUPS){
  assert.equal(typeof pickup.name,'string');
  assert.ok(pickup.duration>0);
  assert.match(pickup.color,/^#[0-9a-f]{6}$/i);
  assert.ok(pickup.description.length>0);
 }
 for(const id of ECONOMY_PICKUP_IDS)assert.ok(SUPPLY_KINDS.includes(id),`${id} is a recognised supply kind`);
});

test('a weapon upgrade promotes the holder one tier and reverts on expiry',()=>{
 const m=quiet(),a=m.actors[0];
 a.weapon=0;a.ammo[0]=Infinity;a.ammo[1]=0;
 assert.equal(m.collect(a,{kind:'weaponUpgrade',x:a.x,z:a.z,y:a.y,wait:0}),true);
 assert.equal(a.weapon,1,'the holder is promoted to the next weapon');
 assert.equal(a.upgradeWeapon,1);
 assert.equal(a.upgradeBase,0,'the original weapon is remembered');
 assert.ok(a.upgradeTimer>0);
 assert.ok(a.ammo[1]>0,'the promoted weapon is loaded');
 assert.ok(m.events.some(event=>event.type==='weapon-upgrade'&&event.weapon===1));
 for(let i=0;i<Math.ceil(12*60)+5;i++)m.step(1/60,{inputs:{}});
 assert.equal(a.weapon,0,'the promotion reverts when the timer expires');
 assert.equal(a.upgradeWeapon,null);
 assert.ok(m.events.some(event=>event.type==='weapon-upgrade'&&event.expired===true));
});

test('a weapon upgrade honours the mode loadout and never leaks a banned weapon',()=>{
 const m=quiet({loadout:{weapons:[2,8],start:2,infinite:true}}),a=m.actors[0];
 a.weapon=2;
 assert.equal(m.collect(a,{kind:'weaponUpgrade',x:a.x,z:a.z,y:a.y,wait:0}),true);
 assert.ok([2,8].includes(a.weapon),`promotion stayed inside the loadout (${a.weapon})`);
});

test('re-collecting a weapon upgrade refreshes the timer without re-basing',()=>{
 const m=quiet(),a=m.actors[0];
 a.weapon=0;a.ammo[0]=Infinity;
 m.collect(a,{kind:'weaponUpgrade',x:a.x,z:a.z,y:a.y,wait:0});
 a.upgradeTimer=2;
 m.collect(a,{kind:'weaponUpgrade',x:a.x,z:a.z,y:a.y,wait:0});
 assert.equal(a.upgradeBase,0,'the original weapon is unchanged by a refresh');
 assert.ok(a.upgradeTimer>2,'the refresh extends the window');
});

test('a deployable sentry fires on the nearest visible enemy and expires',()=>{
 const m=quiet(),a=m.actors[0],b=m.actors[1];
 Object.assign(b,{x:a.x+6,z:a.z,y:a.y,health:100,protection:0,armor:0});
 const before=b.health;
 assert.equal(m.collect(a,{kind:'deployable',x:a.x,z:a.z,y:a.y,wait:0}),true);
 assert.equal(m.deployables.length,1);
 assert.equal(m.snapshot().deployables.length,1);
 assert.ok(m.events.some(event=>event.type==='deployable'&&event.actor===a.id));
 for(let i=0;i<60;i++)m.step(1/60,{inputs:{}});
 assert.ok(m.events.some(event=>event.type==='deployable-fire'&&event.target===b.id),'the sentry acquires and fires');
 assert.ok(b.health<before,'the sentry damages the enemy');
 for(let i=0;i<Math.ceil(18*60)+10;i++)m.step(1/60,{inputs:{}});
 assert.equal(m.deployables.length,0,'the sentry expires');
 assert.ok(m.events.some(event=>event.type==='deployable-expire'));
});

test('a sentry never targets its owner or a teammate',()=>{
 const m=quiet({mode:'teamdeathmatch',botCount:1,humanCount:2}),[a,b,c]=m.actors;
 a.team=0;b.team=0;c.team=1;
 Object.assign(b,{x:a.x+4,z:a.z,y:a.y,health:100,protection:0});
 Object.assign(c,{x:a.x+40,z:a.z,y:a.y,health:100,protection:0});
 m.collect(a,{kind:'deployable',x:a.x,z:a.z,y:a.y,wait:0});
 for(let i=0;i<120;i++)m.step(1/60,{inputs:{}});
 assert.ok(!m.events.some(event=>event.type==='deployable-fire'&&event.target===b.id),'the sentry ignores its teammate');
 assert.ok(!m.events.some(event=>event.type==='deployable-fire'&&event.target===a.id),'the sentry ignores its owner');
});

test('next-gen maps carry the economy pickups and every map pickup kind is known',()=>{
 const known=new Set([...SUPPLY_KINDS,...Object.keys({rocket:1,rail:2,scatter:3,plasma:4,grenade:5,shock:6,flak:7,marksman:8,smg:9}),...POWERUPS.map(powerup=>powerup.id)]);
 const withEconomy=MAPS.filter(map=>map.pickups.some(([kind])=>ECONOMY_PICKUP_IDS.includes(kind)));
 assert.ok(withEconomy.length>=3,'the economy pickups appear on the active rotation');
 for(const map of MAPS)for(const [kind] of map.pickups)assert.ok(known.has(kind),`${map.id} pickup kind ${kind}`);
});
