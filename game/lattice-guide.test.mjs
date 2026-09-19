import test from 'node:test';
import assert from 'node:assert/strict';
import {latticeCoach,latticeOrderKey,latticeBriefing} from './lattice-guide.mjs';

const map={nodes:[{id:'hq-0',x:0,z:0,r:4,archetype:'hq'},{id:'front-0',x:20,z:0,r:6,archetype:'front'},{id:'relay-0',x:40,z:0,r:6,archetype:'relay'}],lattice:[['hq-0','front-0'],['front-0','relay-0']]};
const fixture=()=>({config:{mode:'cocs'},cocs:{nodes:map.nodes.map(n=>({...n,owner:n.archetype==='hq'?0:null,live:n.archetype!=='hq'}))}});
const player={id:0,team:0,x:39,z:0,health:100};

test('coach never recommends a nearer node behind an uncaptured link',()=>{
 const hud=fixture();
 const initial=JSON.stringify(hud);
 const coach=latticeCoach(hud,player,map);
 assert.equal(coach.targetId,'front-0');
 assert.equal(coach.nodes.find(n=>n.id==='relay-0').legal,false);
 assert.equal(JSON.stringify(hud),initial,'guidance does not mutate authoritative state');
 hud.cocs.nodes[1].owner=0;
 const advanced=latticeCoach(hud,player,map);
 assert.equal(advanced.targetId,'relay-0');
 assert.match(advanced.detail,/automatic/);
});

test('coach explains contested capture and prioritizes a threatened supply link',()=>{
 const hud=fixture();hud.cocs.nodes[1].owner=0;hud.cocs.nodes[1].contested=true;
 const coach=latticeCoach(hud,{...player,x:0},map);
 assert.equal(coach.targetId,'front-0');assert.match(coach.detail,/Clear the enemies/);
 assert.equal(latticeCoach({...hud,config:{mode:'deathmatch'}},player,map),null);
 assert.match(latticeCoach(hud,{...player,health:0},map).title,/RESPAWN/);
});

test('order shortcuts preserve chat and weapon keys unless a LATTICE order is armed',()=>{
 for(const mode of ['cocs','cocs-coop']){
  assert.deepEqual(latticeOrderKey({mode,action:'commandGo'}),{type:'arm',verb:'GO'});
  assert.deepEqual(latticeOrderKey({mode,armed:true,code:'Digit3'}),{type:'pick',index:3});
  assert.deepEqual(latticeOrderKey({mode,armed:true,code:'Enter'}),{type:'issue'});
  assert.deepEqual(latticeOrderKey({mode,armed:true,code:'Escape'}),{type:'cancel'});
  for(const code of ['Enter','Digit3','Escape'])assert.equal(latticeOrderKey({mode,code}),null);
 }
 for(const options of [{mode:'deathmatch'},{mode:'cocs',spectate:true},{mode:'cocs',repeat:true}])assert.equal(latticeOrderKey({...options,action:'commandAttack'}),null);
});

test('briefings honor remaps and distinguish automatic capture from interact actions',()=>{
 const guide=latticeBriefing('cocs-coop',{interact:'KeyJ',mobility:'KeyL',commandScan:'KeyZ'});
 assert.match(guide.steps[0].detail,/automatic/);
 assert.match(guide.steps[2].detail,/Z SCAN/);
 assert.match(guide.steps[3].detail,/press J/);
 assert.match(guide.movement,/L uses/);
 assert.match(guide.objective,/five Director waves/);
 assert.equal(latticeBriefing('deathmatch'),null);
});
