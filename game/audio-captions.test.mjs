import test from 'node:test';
import assert from 'node:assert/strict';
import {audioCaption,bearingWord} from './hud.mjs';

// The caption pipeline for the priority audio pass: every new cue that has a
// readable line must name the beat, the bearing variants must be exact, and an
// unknown type must keep returning null.

test('damage captions name the bearing and keep a plain fallback',()=>{
 assert.equal(bearingWord(0),'front');
 assert.equal(bearingWord(Math.PI/4),'front-left');
 assert.equal(bearingWord(Math.PI/2),'left');
 assert.equal(bearingWord(3*Math.PI/4),'back-left');
 assert.equal(bearingWord(Math.PI),'back');
 assert.equal(bearingWord(-3*Math.PI/4),'back-right');
 assert.equal(bearingWord(-Math.PI/2),'right');
 assert.equal(bearingWord(-Math.PI/4),'front-right');
 assert.equal(bearingWord(undefined),null);
 assert.equal(audioCaption({type:'damage',angle:0}).text,'Damage taken · front');
 assert.equal(audioCaption({type:'damage',angle:Math.PI/2}).text,'Damage taken · left');
 assert.equal(audioCaption({type:'damage',angle:-Math.PI/2}).text,'Damage taken · right');
 assert.equal(audioCaption({type:'damage',angle:Math.PI}).text,'Damage taken · back');
 assert.equal(audioCaption({type:'damage',bearing:Math.PI/4}).text,'Damage taken · front-left');
 assert.equal(audioCaption({type:'damage'}).text,'Damage taken');
 assert.equal(audioCaption({type:'damage',angle:NaN}).text,'Damage taken','a bad angle never invents a direction');
});

test('new weapon, vehicle and mode beats have caption rows',()=>{
 assert.equal(audioCaption({type:'vehicle-damage'}).text,'Vehicle damaged');
 assert.equal(audioCaption({type:'dryfire'}).text,'Empty magazine');
 assert.equal(audioCaption({type:'weapon-switch'}).text,'Weapon switch');
 assert.equal(audioCaption({type:'loadout-switch'}).text,'Loadout changed');
 assert.equal(audioCaption({type:'horde-modifier',name:'Frenzy'}).text,'Wave modifier');
});

test('pickup captions name the supply kind and keep the bare pickup line',()=>{
 assert.equal(audioCaption({type:'pickup'}).text,'Pickup');
 assert.equal(audioCaption({type:'pickup',kind:'health'}).text,'Health acquired');
 assert.equal(audioCaption({type:'pickup',kind:'armor'}).text,'Armor acquired');
 assert.equal(audioCaption({type:'pickup',kind:'ammo'}).text,'Ammo acquired');
 assert.equal(audioCaption({type:'pickup',kind:'megahealth'}).text,'Mega health acquired');
 assert.equal(audioCaption({type:'pickup',kind:'rocket'}).text,'Weapon acquired');
 assert.equal(audioCaption({type:'pickup',kind:'smg'}).text,'Weapon acquired');
});

test('flag relay, objective contest and holdout beats have one-line captions',()=>{
 assert.equal(audioCaption({type:'flag-pass',actor:1,to:2}).text,'Flag passed');
 assert.equal(audioCaption({type:'flag-contest',team:0,count:1,actor:1}).text,'Flag contested');
 assert.equal(audioCaption({type:'payload-contest',team:1,attacker:0,defender:1}).text,'Payload contested');
 assert.equal(audioCaption({type:'holdout-progress',team:0,progress:10,window:30}).text,'Holdout progress');
});

test('spawn captions real events but never the bare probe',()=>{
 assert.equal(audioCaption({type:'spawn'}),null,'a bare probe stays uncaptioned');
 assert.equal(audioCaption({type:'spawn',actor:0,pos:{x:1,z:2}}).text,'Respawn');
 assert.equal(audioCaption({type:'spawn',actor:3,pos:{x:0,z:0}}).text,'Respawn','a remote spawn reads the same');
});

test('director and coop beats caption through the lattice table',()=>{
 assert.match(audioCaption({type:'director-spawn-telegraph',kind:'boss'}).text,/Boss telegraph/);
 assert.equal(audioCaption({type:'director-spawn-telegraph',kind:'spawn'}).text,'Spawn telegraph');
 assert.match(audioCaption({type:'director-hq-damage',health:400}).text,/HQ UNDER FIRE/);
 assert.match(audioCaption({type:'director-modifier',id:'frenzy'}).text,/FRENZY/);
 assert.match(audioCaption({type:'coop-bonus',state:'done',label:'Convoy'}).text,/Bonus done/);
 assert.match(audioCaption({type:'cocs-order-complete',verb:'hold'}).text,/Order complete · HOLD/);
 assert.equal(audioCaption({type:'coop-spend',verb:'repair',cost:12}).text,'Spend REPAIR · 12 FLUX','the HUD keeps its own spend wording');
 assert.equal(audioCaption({type:'coop-reserve',tickets:1,burn:2}).text,'Reserve ticket burned');
 assert.equal(audioCaption({type:'operation-summary',reason:'wave-failed'}).text,'Operation summary · wave failed');
});

test('unknown caption types stay null and existing captions are untouched',()=>{
 assert.equal(audioCaption(null),null);
 assert.equal(audioCaption(undefined),null);
 assert.equal(audioCaption({}),null);
 assert.equal(audioCaption({type:'not-a-beat'}),null);
 assert.equal(audioCaption({type:'shot'}).text,'Gunfire');
 assert.equal(audioCaption({type:'shot',alt:true,weapon:2}).text,'Alt fire · OVERLOAD');
 assert.equal(audioCaption({type:'launch',weapon:4}),null,'a normal rocket launch keeps its silent caption');
});

test('depot loaners, role agents and the prime channel caption through the lattice table',()=>{
 assert.equal(audioCaption({type:'cocs-depot-vehicle-spawn',depot:'depot-0',vehicle:'depot-depot-0'}).text,'LOANER READY · DEPOT 0');
 assert.equal(audioCaption({type:'cocs-depot-purchase',depot:'depot-0',item:'puma'}).text,'PUMA REQUISITIONED · DEPOT 0');
 assert.match(audioCaption({type:'cocs-terminal-sabotage',terminal:'terminal-1'}).text,/Terminal sabotage/);
 assert.match(audioCaption({type:'cocs-sapper',node:'relay-1',denied:2}).text,/Link cut · RELAY 1 · 2 DENIED/);
 assert.match(audioCaption({type:'cocs-siphon',node:'siphon-0',flux:9}).text,/Flux siphoned · 9 FLUX/);
 assert.equal(audioCaption({type:'cocs-scan',marked:3}).text,'Scan sweep · 3 MARKED');
 assert.equal(audioCaption({type:'cocs-scan',marked:0}).text,'Scan sweep');
 assert.equal(audioCaption({type:'cocs-role-spawn',role:'saboteur'}).text,'Role deployed · SABOTEUR');
 assert.equal(audioCaption({type:'cocs-role-rally',targets:[0,1]}).text,'Rally · 2 LINKED');
 assert.equal(audioCaption({type:'cocs-role-repair',repaired:['device:a','terminal:b']}).text,'Repairs done · 2 RESTORED');
 assert.equal(audioCaption({type:'cocs-role-spot',targets:[3,4,5]}).text,'Spot · 3 MARKED');
 assert.equal(audioCaption({type:'cocs-prime-start',node:'siphon-0'}).text,'Prime started · SIPHON 0');
 assert.equal(audioCaption({type:'cocs-prime',node:'siphon-0'}).text,'Node primed · SIPHON 0');
 assert.equal(audioCaption({type:'cocs-prime-interrupt',node:'siphon-0'}).text,'Prime interrupted · SIPHON 0');
});
