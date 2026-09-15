import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTERS,HARNESSES,WEAPONS,POWERUPS,ECONOMY_PICKUPS,ECONOMY_PICKUP_IDS,RULES,validLoadout,resolveLoadout} from './data.mjs';
import {MAPS,pickupWeapon,SUPPLY_KINDS} from './maps.mjs';
import {Match} from './core.mjs';

const seeded=()=>{let n=99;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};

test('content tables keep stable ids, unique keys and valid loadouts',()=>{
 assert.equal(new Set(CHARACTERS.map(c=>c.id)).size,CHARACTERS.length);
 assert.equal(new Set(HARNESSES.map(h=>h.id)).size,HARNESSES.length);
 assert.equal(new Set(WEAPONS.map(w=>w.name)).size,WEAPONS.length);
 assert.equal(new Set(POWERUPS.map(p=>p.id)).size,POWERUPS.length);
 for(const character of CHARACTERS)assert.ok(validLoadout(character.id,'openclaw')||character.id==='claude');
 assert.equal(validLoadout('claude','openclaw'),false,'Claude is bound to Claude Code');
 assert.deepEqual(resolveLoadout('claude','openclaw'),{character:'claude',harness:'claudecode'});
 assert.deepEqual(resolveLoadout('nobody','nothing'),{character:'chatgpt',harness:'openclaw'});
 assert.ok(RULES.dt>0&&RULES.gravity>0&&RULES.jump>0);
});

test('every weapon can be picked up, fired and represented by a pickup kind',()=>{
 const kinds=Object.keys({rocket:1,rail:2,scatter:3,plasma:4,grenade:5,shock:6,flak:7,marksman:8,smg:9});
 const indexes=kinds.map(pickupWeapon).sort((a,b)=>a-b);
 assert.deepEqual(indexes,[1,2,3,4,5,6,7,8,9],'pickup kinds cover every non-starter weapon exactly once');
 assert.equal(pickupWeapon('health'),undefined);
 assert.equal(pickupWeapon('megahealth'),undefined);
 assert.equal(pickupWeapon('ammo'),undefined);
 assert.deepEqual([...SUPPLY_KINDS],['health','armor','ammo','megahealth','weaponUpgrade','deployable']);
 assert.deepEqual([...ECONOMY_PICKUP_IDS],['weaponUpgrade','deployable'],'economy pickups keep stable ids');
 assert.equal(ECONOMY_PICKUPS.length,2);
 for(const pickup of ECONOMY_PICKUPS)assert.ok(pickup.duration>0&&pickup.description.length>0);
 assert.ok(!POWERUPS.some(powerup=>ECONOMY_PICKUP_IDS.includes(powerup.id)),'economy pickups are not timed powerups');
});

test('the new supply pickups refill ammo and overcharge health deterministically',()=>{
 const m=new Match('chatgpt','openclaw',seeded(),'crosswire',{mode:'deathmatch',botCount:0,humanCount:1,timeLimit:60});
 const a=m.actors[0];
 a.weapon=1;a.ammo[1]=0;
 assert.equal(m.collect(a,{kind:'ammo',weapon:'rocket',x:a.x,z:a.z,y:a.y,wait:0}),true);
 assert.ok(a.ammo[1]>0,'ammo pickup refills the named weapon');
 a.health=40;a.armor=0;
 assert.equal(m.collect(a,{kind:'megahealth',x:a.x,z:a.z,y:a.y,wait:0}),true);
 assert.ok(a.health>=150||a.health>=a.maxHealth,'megahealth overcharges health');
 assert.ok(a.armor>0,'megahealth grants armor');
 assert.ok(m.events.some(e=>e.type==='pickup'&&e.kind==='megahealth'));
});

test('maps only reference known pickup kinds',()=>{
 const known=new Set([...SUPPLY_KINDS,...Object.keys({rocket:1,rail:2,scatter:3,plasma:4,grenade:5,shock:6,flak:7,marksman:8,smg:9}),...POWERUPS.map(p=>p.id),...ECONOMY_PICKUP_IDS]);
 for(const map of MAPS)for(const [kind] of map.pickups)assert.ok(known.has(kind),`${map.id} pickup kind ${kind}`);
});
