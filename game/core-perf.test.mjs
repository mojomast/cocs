import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,navigation,floorAt,obstructed} from './core.mjs';
import {getMap} from './maps.mjs';
import {RULES} from './data.mjs';

const point=value=>Array.isArray(value)?{x:value[0],z:value[1]}:value;

test('navigation emits unique nodes per quantized coordinate',()=>{
 for(const id of ['exchange','substation','launchpad','citadel']){
  const {nodes}=navigation(getMap(id));
  const seen=new Set();
  for(const n of nodes){
   const key=`${n.x.toFixed(2)}|${n.y.toFixed(2)}|${n.z.toFixed(2)}`;
   assert.equal(seen.has(key),false,`${id} duplicate node ${key}`);
   seen.add(key);
  }
 }
});

test('patrol and flank use the filtered graph instead of embedded authored nodes',()=>{
 const m=new Match('chatgpt','openclaw',()=>0.5,'substation',{botCount:4,difficulty:'normal'});
 const embedded=(m.arena.navNodes||[]).map(point).filter(n=>{const y=floorAt(n.x,n.z,m.arena);return y===null||obstructed(n.x,y,n.z,RULES.radius,m.arena);});
 assert.ok(embedded.length>0,'substation authors nav nodes inside geometry');
 assert.ok(m.nav.length>0,'substation has a runtime graph');
 for(const n of m.nav){assert.ok(floorAt(n.x,n.z,m.arena)!==null);assert.ok(!obstructed(n.x,n.y,n.z,RULES.radius,m.arena));}
 const bot=m.actors.find(a=>a.bot);
 for(let i=0;i<m.nav.length;i++){
  bot.bot.patrol=i;
  const p=m.patrolPoint(bot);
  assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z),'patrol point finite');
  assert.ok(floorAt(p.x,p.z,m.arena)!==null,'patrol point on floor');
  assert.ok(!obstructed(p.x,p.y,p.z,RULES.radius,m.arena),'patrol point clear of geometry');
 }
 bot.bot.flank=null;bot.bot.flankDone=false;
 const f=m.flankDestination(bot,{x:m.center.x,y:0,z:m.center.z});
 assert.ok(Number.isFinite(f.x)&&Number.isFinite(f.y)&&Number.isFinite(f.z),'flank point finite');
 assert.ok(floorAt(f.x,f.z,m.arena)!==null,'flank point on floor');
 assert.ok(!obstructed(f.x,f.y,f.z,RULES.radius,m.arena),'flank point clear of geometry');
});

test('empty-nav spawn fallback recovers to a finite, clear point',()=>{
 const m=new Match('chatgpt','openclaw',()=>0.5,'exchange',{botCount:1,difficulty:'normal'});
 const a=m.actors.find(b=>b.bot)||m.actors[0];
 m.nav=[];m.edges=[];m.spawns=[{x:0,y:0,z:0}];m.teamSpawns={0:[],1:[]};
 m.spawn(a);
 assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y)&&Number.isFinite(a.z),'spawn point finite');
 assert.ok(floorAt(a.x,a.z,m.arena)!==null,'spawn point on floor');
 assert.ok(!obstructed(a.x,a.y,a.z,RULES.radius,m.arena),'spawn point clear of geometry');
});

test('ctf flags stay finite when team spawns are derived',()=>{
 for(const id of ['rampart','colosseum']){
  const m=new Match('chatgpt','openclaw',()=>0.5,id,{mode:'ctf',botCount:0,humanCount:1});
  for(const team of [0,1]){
   assert.ok(Number.isFinite(m.flagSpawns[team][0])&&Number.isFinite(m.flagSpawns[team][1]),`${id} flag spawn ${team} finite`);
   const flag=m.flags[team];
   assert.ok(Number.isFinite(flag.x)&&Number.isFinite(flag.y)&&Number.isFinite(flag.z),`${id} flag ${team} finite`);
  }
 }
});
