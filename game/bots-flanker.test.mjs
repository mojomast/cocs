import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {spawnGroup} from './singleplayer.mjs';
import {coverPoint} from './bots.mjs';

const seeded=()=>{let n=1337;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};

test('a flanker seeks deterministic cover from a synthetic nav graph',()=>{
 const match={nav:[{x:0,y:0,z:0},{x:-6,y:0,z:0},{x:6,y:0,z:0}],arena:{blocks:[]},visible:(from,to)=>Math.abs(from.z-to.z)<2};
 const bot={x:0,y:0,z:0},threat={x:0,y:0,z:6};
 const first=coverPoint(match,bot,threat);
 assert.deepEqual(first,{x:-6,y:0,z:0});
 assert.deepEqual(coverPoint(match,bot,threat),first,'the same inputs resolve to the same cover');
 assert.equal(coverPoint({nav:[],arena:{},visible:()=>false},bot,threat),null,'no nav means no cover');
});

test('two identical flanker deployments emit identical flank beats',()=>{
 const run=()=>{
  const match=new Match('chatgpt','openclaw',seeded(),'colosseum',{mode:'horde',botCount:3,humanCount:1,timeLimit:900,fragLimit:1});
  const state=match.modeState,player=match.actors[0];player.protection=1e9;player.health=player.maxHealth;
  state.phase='wave';state.wave=1;
  const id=spawnGroup(match,state,{type:'lancer',count:1,zone:{x:player.x,z:player.z,r:8,leash:14,kind:'hold'}},{team:1})[0];
  const lancer=match.actors.find(actor=>actor.id===id);
  const events=[];
  const original=match.emit.bind(match);
  match.emit=(type,data)=>{if(type==='enemy-telegraph'||type==='enemy-flank')events.push({type,kind:data.kind??null,actor:data.actor});original(type,data);};
  for(let i=0;i<600&&!match.over;i++){player.x=lancer.x+3;player.z=lancer.z;match.updateSinglePlayer(1/60);}
  return events;
 };
 const a=run(),b=run();
 assert.ok(a.length>0,'the flanker produces flank beats');
 assert.deepEqual(a,b,'identical seeds produce identical flank beats');
});
