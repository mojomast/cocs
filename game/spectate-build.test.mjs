import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSpectateMatch} from './spectate-build.mjs';
import {RULES} from './data.mjs';

const rng=(seed=1)=>{let n=seed>>>0||1;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
const assertFinite=(value,path='snapshot')=>{if(Array.isArray(value)){value.forEach((item,index)=>assertFinite(item,`${path}[${index}]`));return;}if(value&&typeof value==='object'){for(const [key,nested] of Object.entries(value))assertFinite(nested,`${path}.${key}`);return;}if(typeof value==='number')assert.ok(Number.isFinite(value),`${path} should be finite (got ${value})`);};

test('spectate match fills every seat with a bot brain',()=>{
 const {match}=buildSpectateMatch({mapId:'colosseum',config:{mode:'deathmatch',botCount:7,difficulty:'normal'},random:rng(7)});
 assert.ok(match.actors.length>=4,'the bot match fields a squad');
 assert.ok(match.actors.every(a=>a.bot&&Array.isArray(a.bot.route)),'every actor is bot-driven');
 assert.ok(Number.isFinite(match.time)&&match.time>0,'the match is warmed past the countdown');
 const snapshot=match.snapshot();
 assertFinite(snapshot);
 assert.doesNotThrow(()=>JSON.stringify(snapshot),'the snapshot stays JSON-serializable');
});

test('spectate bots step deterministically with empty inputs',()=>{
 const build=()=>buildSpectateMatch({mapId:'colosseum',config:{mode:'deathmatch',botCount:7,difficulty:'normal'},random:rng(11)}).match;
 const first=build(),second=build();
 for(let tick=0;tick<120;tick++){first.step(RULES.dt,{inputs:{}});second.step(RULES.dt,{inputs:{}});}
 assert.deepEqual(first.snapshot(),second.snapshot());
 assert.equal(first.serial,second.serial);
});

test('combined-arms spectate seats bots inside vehicles',()=>{
 const {match}=buildSpectateMatch({mapId:'skyfall-basin',config:{mode:'combined-arms',botCount:16,difficulty:'normal'},random:rng(3)});
 assert.ok(match.vehicles.length>0,'combined arms fields vehicles');
 assert.ok(match.actors.some(a=>a.vehicleId!=null),'at least one bot is seated before the first frame');
});
