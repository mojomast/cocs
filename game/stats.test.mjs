import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTERS} from './data.mjs';
import {Match,moveActor} from './core.mjs';
import {NetClient} from './net.mjs';
import {Room} from '../server/room.mjs';

// §13.3 Phase-2 spawn-stat re-cut (EHP ≤1.5×, speed within ±10% of the mean):
// Strikers 90/95/105 HP at 9.2/9.0/8.9 m/s; Vanguards 120 / 100+20 / 115+10 at
// 7.7/7.6/7.8 m/s; Tacticians 100+5 / 90+10 / 100+10 at 8.6/8.7/8.5 m/s.
// Gemini's 10 armor and every other unchanged field survive the re-cut.
const expected=[[100,5,8.6],[115,10,7.8],[105,0,8.9],[100,20,7.6],[95,10,9],[120,0,7.7],[90,0,9.2],[90,10,8.7],[100,10,8.5]];
for(const [i,c] of CHARACTERS.entries()){
 test(`${c.name}: spawn, respawn, snapshot and healing caps`,()=>{
  assert.deepEqual(c.stats,Object.fromEntries(['health','armor','speed'].map((key,j)=>[key,expected[i][j]])));
  const m=new Match(c.id,'codex',()=>.5,'crosswire',{botCount:1,lifeSteal:true}),[a,b]=m.actors;
  const check=()=>{assert.equal(a.health,c.stats.health);assert.equal(a.maxHealth,c.stats.health);assert.equal(a.armor,c.stats.armor);assert.equal(a.moveSpeed,c.stats.speed);};
  check();
  Object.assign(a,{health:0,armor:99,maxHealth:1,moveSpeed:1,dead:0});m.step(1/60);check();
  assert.equal(m.snapshot().actors[0].maxHealth,c.stats.health);assert.equal(m.snapshot().actors[0].moveSpeed,c.stats.speed);
  a.health=a.maxHealth-1;assert.equal(m.collect(a,{kind:'health'}),true);assert.equal(a.health,a.maxHealth);assert.equal(m.collect(a,{kind:'health'}),false);
  a.armor=99;m.collect(a,{kind:'armor'});assert.equal(a.armor,100);assert.equal(m.collect(a,{kind:'armor'}),false);
  if(c.id!=='claude'){a.health=a.maxHealth-1;m.power(a);assert.equal(a.health,a.maxHealth);a.cooldown=0;a.health=1;m.power(a);assert.equal(a.health,36);}
  a.health=a.maxHealth-1;b.protection=0;b.armor=0;m.damage(b,20,a);assert.equal(a.health,a.maxHealth);
  a.health=1;b.health=10;m.damage(b,1000,a);assert.equal(a.health,3.5);
 });
 test(`${c.name}: movement composes base speed, match modifier, boost and slow`,()=>{
  const m=new Match(c.id,'hermes',()=>.5,'crosswire',{botCount:0}),a=m.actors[0];
  for(const speed of [.75,1,1.5])for(const active of [0,3])for(const slow of [0,3]){
   Object.assign(a,{x:0,y:0,z:0,vx:0,vy:0,vz:0,active,slow});
   for(let j=0;j<30;j++)moveActor(a,{x:1},1/60,{blocks:[]},{speed,gravity:1});
    assert.ok(Math.abs(a.vx-c.stats.speed*speed*(active&&a.harness==='hermes'?1.6:1)*(slow?.55:1))<1e-10);
  }
  delete a.moveSpeed;Object.assign(a,{x:0,vx:0,active:0,slow:0});
  for(let j=0;j<30;j++)moveActor(a,{x:1},1/60,{blocks:[]});
   assert.equal(a.vx,c.stats.speed,'no hidden harness speed multiplier: walk speed is the class stat');
 });
 test(`${c.name}: Instagib stays lethal with full armor and Guardrail`,()=>{
  const m=new Match(c.id,'claudecode',()=>.5,'crosswire',{mode:'instagib',botCount:1});
  const [a,b]=m.actors;Object.assign(a,{armor:100,active:3,protection:0});m.damage(a,1,b);assert.equal(a.health,0);
 });
}

// §4.1 stat envelope, re-pinned with the §13.3 re-cut. Effective HP is
// `health + armor`: no table expresses a mitigation multiplier, and core treats
// armor as a one-for-one damage pool (per-hit absorb capped at 60%,
// `core.mjs` damage()). §13.3 pins the tighter ±10% speed band on top of the
// §4.1 ±15% envelope, so that is what is asserted here. The tolerance only
// absorbs binary rounding at the exact bound (Meta's 7.6 is exactly −10%);
// it never admits a stat outside the band.
test('spawn stats stay inside the §4.1 envelope: EHP span ≤1.5×, speed mean ±10%',()=>{
 const effective=CHARACTERS.map(c=>c.stats.health+c.stats.armor);
 const span=Math.max(...effective)/Math.min(...effective);
 assert.ok(span<=1.5,`effective HP span ${span.toFixed(4)} exceeds 1.5× (${Math.min(...effective)}..${Math.max(...effective)})`);
 const mean=CHARACTERS.reduce((sum,c)=>sum+c.stats.speed,0)/CHARACTERS.length;
 for(const c of CHARACTERS){
  const deviation=Math.abs(c.stats.speed-mean)/mean;
  assert.ok(deviation<=.1+1e-9,`${c.name} speed ${c.stats.speed} is ${(deviation*100).toFixed(3)}% from the ${mean.toFixed(4)} mean`);
 }
});

test('construction validates supplied human loadouts before the only initial spawn',()=>{
 const m=new Match('chatgpt','openclaw',()=>.5,'crosswire',{humanCount:2,botCount:0,loadouts:[{character:'invalid',harness:'invalid'},{character:'claude',harness:'hermes'}]});
 assert.equal(m.actors[0].character,'chatgpt');assert.equal(m.actors[0].health,100);
 assert.equal(m.actors[1].harness,'claudecode');assert.equal(m.actors[1].health,115);
 assert.equal(m.stats.respawns,2);assert.equal(m.events.length,2);
});

test('room start and rematch retain selected stats and predict a nonzero actor',()=>{
 const room=new Room('stats',()=>.5);room.join(1,'Host','deepseek','codex');room.join(2,'Guest','kimi','hermes');room.host(1,{botCount:0,speed:1.25},'crosswire');
 for(let round=0;round<2;round++){
  room.start(1);const m=room.match,[host,a]=m.actors;
  assert.equal(host.health,120);assert.equal(host.moveSpeed,7.7);assert.equal(a.health,90);assert.equal(a.armor,10);assert.equal(a.moveSpeed,8.7);assert.equal(a.name,'Guest');
  assert.equal(m.stats.respawns,2);assert.equal(m.events.filter(e=>e.type==='spawn').length,2);
  Object.assign(a,{x:0,y:0,z:5,vx:0,vy:0,vz:0,active:3,slow:3});m.pickups=[];
  const client=new NetClient();client.createShadow('crosswire',m.config);client.actorId=1;client.push({state:JSON.parse(JSON.stringify(m.snapshot()))});
  for(let j=0;j<30;j++){m.step(1/60,{inputs:{1:{x:1}}});client.predict({x:1});const p=client.shadow.actors[0];for(const key of ['id','maxHealth','moveSpeed','health','armor','x','z','vx'])assert.equal(p[key],a[key],key);}
  Object.assign(host,{health:1,armor:99,maxHealth:1,moveSpeed:1});Object.assign(a,{health:1,armor:99,maxHealth:1,moveSpeed:1});
 }
});
