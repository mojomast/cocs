import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,navigation,moveActor,rayWorld,visible,eye,aim,floorAt,obstructed} from './core.mjs';
import {CHARACTERS,HARNESSES,validLoadout,resolveLoadout,RULES} from './data.mjs';
function rng(){let n=42;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);}
const fresh=()=>new Match('chatgpt','openclaw',rng(),'exchange',{botCount:4,difficulty:'normal'});
function isolate(m){m.actors.forEach((a,i)=>Object.assign(a,{x:10+i*.1,y:0,z:10,protection:0,health:100,armor:0,harnessDamageMultiplier:1}));return m.actors;}
test('all roster / harness combinations enforce compatibility and correction',()=>{for(const c of CHARACTERS)for(const h of HARNESSES){assert.equal(validLoadout(c.id,h.id),c.id!=='claude'||h.id==='claudecode');const l=resolveLoadout(c.id,h.id);assert.ok(validLoadout(l.character,l.harness));}assert.equal(new Match('claude','hermes').actors[0].harness,'claudecode');assert.equal(validLoadout('unknown','hermes'),false);});
test('armor, Guardrail, protection and one-time kill scoring',()=>{const m=fresh(),[a,b]=isolate(m);b.protection=1;assert.equal(m.damage(b,100,a),0);b.protection=0;b.armor=50;b.harness='claudecode';b.active=3;m.damage(b,100,a);assert.equal(b.health,80);assert.equal(b.armor,20);m.damage(b,1000,a);m.damage(b,1000,a);assert.equal(a.frags,1);assert.equal(b.deaths,1);assert.equal(b.active,0);assert.equal(b.cooldown,0);});
test('suicide deducts one frag and match end locks scoring',()=>{const m=fresh(),[a,b]=isolate(m);m.damage(a,500,a);assert.equal(a.frags,-1);a.health=100;a.frags=14;m.damage(b,500,a);assert.equal(m.over,true);assert.equal(a.frags,15);m.damage(a,500,b);assert.equal(a.health,100);});
test('time limit returns all tied leaders',()=>{const m=fresh();m.time=299.995;m.actors.forEach(a=>{a.health=0;a.dead=100;});m.step(1/60);assert.equal(m.over,true);assert.equal(m.leaders().length,5);});
test('wall and reactor rays occlude; open line damages; muzzle checks',()=>{const m=fresh(),[a,b]=isolate(m);Object.assign(a,{x:0,y:0,z:5,shotWait:0,yaw:0,pitch:0});Object.assign(b,{x:0,y:0,z:-5});m.fire(a);assert.equal(b.health,100);assert.ok(rayWorld(eye(a),aim(0),30)<4);Object.assign(b,{x:0,y:0,z:3.5});a.shotWait=0;m.fire(a);assert.equal(b.health,89.44);});
test('pulse respects cover and applies damage and knockback in range',()=>{const m=fresh(),[a,b,c]=isolate(m);Object.assign(a,{x:0,y:0,z:2.8});Object.assign(b,{x:0,y:0,z:-2.8});Object.assign(c,{x:1,y:0,z:3});assert.equal(m.power(a),true);assert.equal(c.health,76);assert.ok(c.vx>0);assert.equal(b.health,100);assert.equal(m.power(a),false);});
test('powers expire on fixed time; Parallel Burst respects ammo',()=>{for(const h of HARNESSES){const m=new Match('qwen',h.id,rng()),a=m.actors[0];m.actors.slice(1).forEach(b=>{b.health=0;b.dead=100;});a.protection=0;assert.ok(m.power(a));for(let i=0;i<241;i++)m.step(1/60);assert.equal(a.active,0);assert.ok(a.cooldown>0);m.spawn(a);assert.equal(a.cooldown,0);}const m=fresh(),a=m.actors[0];a.harness='opencode';a.protection=0;a.shotWait=0;a.ammo[2]=1;a.weapon=2;m.power(a);m.fire(a);assert.equal(a.ammo[2],0);assert.ok(a.shotWait<1);a.shotWait=0;m.fire(a);assert.equal(a.weapon,2);assert.equal(a.reloading,true);});
test('rockets use swept hits, explode on solids, cause self splash',()=>{const m=fresh(),[a,b]=isolate(m);Object.assign(a,{x:0,y:0,z:3.3,weapon:1,ammo:[Infinity,2,0],shotWait:0,yaw:0,pitch:0});Object.assign(b,{x:0,y:0,z:-3.3});m.fire(a);for(let i=0;i<8;i++)m.step(1/60);assert.equal(m.rockets.length,0);assert.ok(a.health<100);assert.equal(b.health,100);assert.ok(m.events.some(e=>e.type==='explosion'));});
test('movement has equal diagonal cap, collision, jump, and both ramps reach deck',()=>{const m=fresh(),a=m.actors[0];const setup=(x,z)=>Object.assign(a,{x,y:floorAt(x,z),z,vx:0,vy:0,vz:0,grounded:true,jumpBuffer:0,coyote:0});setup(0,10);for(let i=0;i<35;i++)moveActor(a,{x:1,z:0},1/60);const speed=Math.hypot(a.vx,a.vz);setup(0,10);for(let i=0;i<35;i++)moveActor(a,{x:1,z:1},1/60);assert.ok(Math.abs(Math.hypot(a.vx,a.vz)-speed)<.01);setup(0,7);moveActor(a,{jump:true},1/60);assert.ok(a.y>0);for(let i=0;i<120;i++)moveActor(a,{},1/60);assert.equal(a.y,0);setup(0,5);for(let i=0;i<120;i++)moveActor(a,{z:-1},1/60);assert.ok(a.z>=2.4);for(const x of [-11,11]){setup(x,7);for(let i=0;i<160;i++)moveActor(a,{z:-1},1/60);assert.equal(a.y,3.8);assert.ok(a.z<-9);}assert.ok(!obstructed(a.x,a.y,a.z));});
test('entire navigation graph is connected, including upper deck',()=>{const NAV=navigation().nodes,EDGES=navigation().edges;const seen=new Set([0]),q=[0];while(q.length)for(const n of EDGES[q.shift()])if(!seen.has(n)){seen.add(n);q.push(n);}assert.equal(seen.size,NAV.length);assert.ok(NAV.some(n=>n.y===3.8));});
test('pickup usefulness, timed respawn, complete fresh match reset',()=>{const m=fresh(),a=m.actors[0],p=m.pickups[0];assert.equal(m.collect(a,p),false);a.health=20;assert.equal(m.collect(a,p),true);assert.equal(a.health,55);assert.equal(p.wait,12);m.damage(a,500,a);m.rockets.push({});const n=fresh();assert.equal(n.time,0);assert.equal(n.rockets.length,0);assert.ok(n.pickups.every(p=>p.wait===0));assert.ok(n.actors.every(a=>a.frags===0&&a.deaths===0&&a.cooldown===0&&a.active===0&&a.health===a.maxHealth));});
test('four bots complete deterministic deathmatch with supplies, powers and respawns',()=>{const m=fresh();let elevated=false;for(let i=0;i<18001&&!m.over;i++){m.step(1/60);elevated||=m.actors.slice(1).some(a=>a.y>3.5);}assert.ok(m.over);assert.ok(m.stats.kills>=15);assert.ok(m.stats.pickups>4);assert.ok(m.stats.powers>4);assert.ok(m.stats.respawns>5);assert.ok(elevated);console.log('Simulated match:',m.time.toFixed(2),'seconds',m.stats);});
test('deaths carry a deterministic varied style, weapon and direction',()=>{
 const m=fresh(),[a,b]=isolate(m);a.weapon=1;b.health=10;
 m.damage(b,400,a);
 const death=m.events.find(e=>e.type==='death'&&e.actor===b.id);
 assert.ok(death,'death event emitted');
 assert.ok(['ragdoll','headpop','gibs','burst','combust','vaporize','splatter','electrocute'].includes(death.style),`style ${death.style}`);
 assert.equal(death.weapon,1);
 assert.ok(death.overkill>200);
 assert.equal(death.self,false);
 assert.ok(death.direction&&Number.isFinite(death.direction.x)&&Number.isFinite(death.direction.z));
 assert.ok(Number.isInteger(death.seed));
 assert.ok(['gibs','burst','combust'].includes(death.style),`massive overkill -> ${death.style}`);
});
test('void falls emit a ragdoll death without a killer',()=>{
 const m=fresh(),a=m.actors[0];
 m.fall(a);
 const death=m.events.find(e=>e.type==='death'&&e.fall===true);
 assert.ok(death,'fall death emitted');
 assert.equal(death.style,'ragdoll');
 assert.equal(death.weapon,null);
 assert.equal(death.direction,null);
});
