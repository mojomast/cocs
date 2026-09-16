import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {chooseWeaponIndex,weaponSwitchAllowed} from './bots.mjs';
import {WEAPONS} from './data.mjs';

const rng=(seed=7)=>{let n=seed>>>0;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
const fresh=options=>new Match('chatgpt','openclaw',rng(),'exchange',{botCount:0,...options});

test('switchWeapon validates, delays, cancels reload and emits one shared event',()=>{
 const m=fresh(),a=m.actors[0];
 a.ammo=a.ammo.map((v,i)=>i===0?Infinity:i===4?4:0);
 assert.equal(m.switchWeapon(a,4),true,'switches to an available weapon');
 assert.equal(a.weapon,4);assert.equal(a.weaponSwitch,.45,'applies the switching delay');
 assert.equal(m.events.at(-1).type,'weapon-switch');assert.equal(m.events.at(-1).actor,a.id);assert.equal(m.events.at(-1).source,'request');
 assert.equal(m.switchWeapon(a,4),false,'a no-op switch is not re-emitted');
 assert.equal(m.switchWeapon(a,2),false,'an empty weapon cannot be selected');
 assert.equal(m.switchWeapon(a,-1),false);assert.equal(m.switchWeapon(a,99),false);assert.equal(m.switchWeapon(a,1.5),false);
 a.weapon=0;a.ammo[0]=Infinity;a.ammo[1]=2;a.reloading=true;a.reloadTimer=1;a.reloadDuration=1;a.reloadWeapon=0;
 m.switchWeapon(a,1);
 assert.equal(a.reloading,false,'switching cancels reload state');
 assert.equal(a.reloadTimer,0);assert.equal(a.reloadWeapon,-1);
});

test('bots switch through the shared operation instead of assigning weapon directly',()=>{
 const m=new Match('chatgpt','openclaw',rng(),'exchange',{botCount:3,humanCount:1,difficulty:'normal'});
 let switches=0,sawBotSwitch=false;
 for(let i=0;i<4000&&!m.over;i++){
  const before=m.events.length;m.step(1/60);
  for(const e of m.events.slice(before))if(e.type==='weapon-switch'){switches++;if(e.source==='bot')sawBotSwitch=true;}
 }
 assert.ok(switches>0,'weapon switches happen during a live match');
 assert.ok(sawBotSwitch,'bot weapon changes are emitted through the shared operation');
});

test('explicit weapon selection keeps index zero as a deliberate choice',()=>{
 assert.equal(chooseWeaponIndex([0,5,6]),0,'index zero wins when it is first');
 assert.equal(chooseWeaponIndex([-1,-1,3,0]),3,'negative placeholders are skipped');
 assert.equal(chooseWeaponIndex([-1,-1],2),2,'fallback is used when no candidate is valid');
 assert.equal(chooseWeaponIndex([undefined,null,NaN,-1],0),0);
});

test('weapon-selection hysteresis stops threshold oscillation but allows empty magazines',()=>{
 const a={weapon:0,ammo:[Infinity,8]};
 assert.equal(weaponSwitchAllowed(a,1,1,2.5),false,'committed bot holds its choice');
 assert.equal(weaponSwitchAllowed(a,1,3,2.5),true,'commit expires and the switch is allowed');
 assert.equal(weaponSwitchAllowed(a,0,3,2.5),false,'switching to the same weapon is a no-op');
 assert.equal(weaponSwitchAllowed({weapon:0,ammo:[0,8]},1,1,2.5),true,'a dry magazine overrides hysteresis');
 assert.equal(weaponSwitchAllowed(a,-1,9,0),false,'invalid indices are rejected');
 assert.equal(WEAPONS.length>=10,true);
});
