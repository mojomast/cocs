import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {CHARACTERS,HARNESSES} from './data.mjs';
import {GAME_MODES,DIFFICULTIES} from './config.mjs';
import {resolveMapForMode} from './arenas.mjs';
import {botBehavior,botArchetype} from './bot-personalities.mjs';

const rng=()=>{let n=123;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
const combos=(behaviors)=>{const set=new Set(behaviors.map(behavior=>[behavior.strafePattern,behavior.weaponBand,behavior.engageBand.map(n=>n.toFixed(2)).join(',')].join('|')));return set;};

test('the roster resolves to several distinct archetypes across ids',()=>{
 const found=new Set();
 for(const character of CHARACTERS)for(const harness of HARNESSES)for(const id of [0,1,2,3,4,5])found.add(botBehavior({id,character:character.id,harness:harness.id}).archetype);
 assert.ok(found.size>=4,`expected a varied archetype roster, got ${[...found].join(',')}`);
 for(const archetype of found)assert.ok(['rusher','flanker','defender','support','sharpshooter'].includes(archetype),`unknown archetype ${archetype}`);
});

test('eight combat bots span at least four pattern/band/engage combinations',()=>{
 const roster=[
  {id:0,character:'grok',harness:'openclaw'},
  {id:1,character:'mistral',harness:'cline'},
  {id:2,character:'claude',harness:'claudecode'},
  {id:3,character:'meta',harness:'hermes'},
  {id:4,character:'kimi',harness:'opencode'},
  {id:5,character:'gemini',harness:'codex'},
  {id:6,character:'deepseek',harness:'hermes'},
  {id:7,character:'qwen',harness:'openclaw'},
 ];
 const behaviors=roster.map(actor=>botBehavior(actor));
 const distinct=combos(behaviors);
 assert.ok(distinct.size>=4,`expected at least four distinct combat styles, got ${distinct.size}`);
 for(const behavior of behaviors){
  assert.ok([0,1,2].includes(behavior.strafePattern));
  assert.ok(['close','mid','long'].includes(behavior.weaponBand));
  assert.ok(Array.isArray(behavior.engageBand)&&behavior.engageBand[0]>=behavior.range[0]&&behavior.engageBand[1]<=behavior.range[1]&&behavior.engageBand[1]>behavior.engageBand[0]);
  assert.ok(behavior.thinkScale>=.7&&behavior.thinkScale<=1.4);
 }
});

test('archetype resolution is deterministic for the same role, personality and id',()=>{
 for(const [role,personality] of [['duelist','brawler'],['anchor','sentinel'],['flanker','opportunist']])assert.equal(botArchetype(role,personality,4),botArchetype(role,personality,4));
 assert.deepEqual(botBehavior({id:3,character:'grok',harness:'cline'}),botBehavior({id:3,character:'grok',harness:'cline'}));
});

function strafeTrace(character,harness){
 const m=new Match(character,harness,()=>.5,'exchange',{mode:'deathmatch',botCount:1,difficulty:'normal'});
 m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};m.pickups=[];m.vehicles=[];
 const bot=m.actors.find(a=>a.bot),human=m.actors.find(a=>!a.bot);
 Object.assign(human,{x:6,y:0,z:0,health:200,armor:0});
 const trace=[];
 for(let i=0;i<300;i++){
  m.time+=1/60;
  Object.assign(bot,{x:-10,y:0,z:0,health:100,armor:0,protection:0,vx:0,vz:0,grounded:true});
  Object.assign(bot.bot,{target:human.id,memory:9,think:9,state:'engage',route:[],destination:null,standoff:null,strafeReverse:-99});
  const input=m.botInput(bot,1/60)||{};
  trace.push(Math.sign(Math.round((input.z||0)*100)/100));
 }
 return trace;
}

test('two archetypes actually strafe differently over time',()=>{
 const sine=botBehavior({id:1,character:'claude',harness:'openclaw'});
 const serpentine=botBehavior({id:1,character:'mistral',harness:'cline'});
 assert.notEqual(sine.strafePattern,serpentine.strafePattern,'fixtures must use different patterns');
 const a=strafeTrace('claude','openclaw'),b=strafeTrace('mistral','cline');
 assert.ok(a.some(Boolean)&&b.some(Boolean),'both bots must strafe while engaging');
 assert.notDeepEqual(a,b,'serpentine and sine strafing must diverge over time');
});

test('every combat mode still completes with archetype bots at every difficulty',()=>{
 for(const mode of GAME_MODES.filter(mode=>mode.rules?.score!=='laps'&&mode.id!=='puma-soccer'))for(const difficulty of DIFFICULTIES){
  const m=new Match('kimi','roo',rng(),resolveMapForMode('crosswire',mode.id,{legacy:true}),{mode:mode.id,difficulty:difficulty.id,botCount:8,timeLimit:60,fragLimit:5});
  for(let i=0;i<3601&&!m.over;i++)m.step(1/60);
  assert.ok(m.over,`${mode.id}/${difficulty.id}`);
  assert.ok(m.stats.shots>0,`${mode.id}/${difficulty.id} shots`);
  const settled=m.stats.kills>0||m.events.some(event=>['capture','zone-capture','assault-breach','payload-checkpoint','payload-delivered','objective-win'].includes(event.type));
  assert.ok(settled,`${mode.id}/${difficulty.id} resolves by combat or objective`);
  assert.ok(m.actors.every(a=>[a.x,a.y,a.z,a.health,a.frags].every(Number.isFinite)));
 }
});
