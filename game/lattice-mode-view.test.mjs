import test from 'node:test';
import assert from 'node:assert/strict';
import {GAME_MODES,isCocsMode} from './config.mjs';
import {cocsBoard} from './hud.mjs';
import {cocsCommandView,cocsStripState} from './cocs-orders.mjs';

test('mode records used by the playing HUD enable the LATTICE command surfaces',()=>{
 for(const mode of GAME_MODES){
  const expected=['cocs','cocs-coop'].includes(mode.id);
  assert.equal(isCocsMode(mode),expected,`${mode.id} record`);
  assert.equal(isCocsMode(mode.id),expected,`${mode.id} id`);
  assert.equal(isCocsMode({mode:mode.id}),expected,`${mode.id} config`);
  if(expected){
   const player={id:0,team:0,x:0,y:0,z:0};
   const hud={config:{mode:mode.id},cocs:{tick:0,nodes:[],scores:[0,0],flux:[30,30]}};
   const command=isCocsMode(mode)?cocsCommandView(cocsBoard(hud,player),hud.cocs,player,cocsStripState()):null;
   assert.ok(command?.strip.buttons.length,'real UI composition exposes orders');
  }
 }
 assert.equal(isCocsMode(null),false);
});
