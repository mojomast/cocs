import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeRace, stepRace, raceSnapshot, raceStandings, crossRaceGates, resetRaceRacer,
  ITEMS, CAR_RADIUS, MIN_CAR_SEPARATION, paceMultiplier, itemWeights, rollItem, resolveCarCollisions,
  PACE_LEADER, PACE_TRAILER} from './race.mjs';
import {slowSkip} from './test-support.mjs';

function fixture(count=2, bots=false, seed=7, extras={}) {
  const centerline=Array.from({length:12},(_,i)=>({x:60*Math.sin(i*Math.PI/6),z:-48*Math.cos(i*Math.PI/6)}));
  const gates=centerline.map((p,i)=>{const dx=60*Math.cos(i*Math.PI/6),dz=48*Math.sin(i*Math.PI/6),len=Math.hypot(dx,dz);return {...p,nx:dx/len,nz:dz/len,halfWidth:12};});
  const grid=Array.from({length:8},(_,i)=>({x:-4-Math.floor(i/2)*5,z:-48+(i%2?3:-3),heading:Math.PI/2}));
  const track={centerline,gates,grid,itemBoxes:[{id:'box',x:20,z:-46}],...extras};
  let state=seed;
  const match={arena:{race:track},
    actors:Array.from({length:count},(_,id)=>({id,ammo:[1],bot:bots?{}:null})),config:{fragLimit:2,timeLimit:180},
    random(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;},time:0,over:false,
    vehicleById(id){return this.vehicles.find(v=>v.id===id);},
    vehicleCollision(next){return next;},syncVehicleActor(a,v){Object.assign(a,v.position,{vehicleId:v.id,vehicleSeat:'driver'});},
    endMatch(reason){this.over=true;this.overReason=reason;}};
  initializeRace(match);
  return match;
}
function crossing(state,racer,index,reverse=false,offset=0) {
  const g=state.gates[index],sign=reverse?-1:1;
  const from={x:g.x-sign*g.nx+g.nz*offset,y:0,z:g.z-sign*g.nz-g.nx*offset};
  const to={x:g.x+sign*g.nx+g.nz*offset,y:0,z:g.z+sign*g.nz-g.nx*offset};
  crossRaceGates(state,racer,from,to,10,1);
}

test('countdown freezes chassis and items; snapshots are detached',()=>{
  const m=fixture(),start={...m.vehicles[0].position};
  stepRace(m,3,{x:1,yaw:-Math.PI/2,fire:true});
  assert.deepEqual(m.vehicles[0].position,start);
  assert.equal(m.race.phase,'racing');assert.equal(m.race.elapsed,0);
  stepRace(m,.5,{x:1,yaw:-Math.PI/2});
  assert.ok(m.vehicles[0].position.x>start.x);
  const snap=raceSnapshot(m.race);snap.gates[0].x=999;snap.standings[0].effects.slow=99;
  assert.equal(m.race.gates[0].x,0);assert.equal(m.race.racers[0].effects.slow,0);
});

test('ordered, directional, finite swept gates require a complete lap',()=>{
  const m=fixture(),s=m.race,r=s.racers[0];
  crossing(s,r,1);crossing(s,r,0,true);crossing(s,r,0,false,13);
  assert.equal(r.passed,0);
  crossing(s,r,0);assert.equal(r.completedLaps,0);assert.equal(r.nextGate,1);
  crossing(s,r,0);crossing(s,r,2);assert.equal(r.passed,1);
  for(let i=1;i<12;i++)crossing(s,r,i);
  crossing(s,r,0);assert.equal(r.completedLaps,1);assert.equal(r.lap,2);
  for(let i=1;i<12;i++)crossing(s,r,i);
  crossing(s,r,0);assert.equal(r.completedLaps,2);assert.equal(r.finishTime,10.5);
});

test('gates validate swept intersection height, not just horizontal or end position',()=>{
  const attempt=(fromY,toY)=>{
    const m=fixture(),r=m.race.racers[0];
    crossRaceGates(m.race,r,{x:-1,y:fromY,z:-48},{x:1,y:toY,z:-48},0,1);
    return r.passed;
  };
  assert.equal(attempt(4,4),0);
  assert.equal(attempt(-1,-1),0);
  assert.equal(attempt(8,0),0);
  assert.equal(attempt(0,8),0);
  assert.equal(attempt(NaN,0),0);
  assert.equal(attempt(undefined,undefined),0);
  assert.equal(attempt(4,2),1);
  assert.equal(attempt(0,0),1);
});

test('jump and crouch apply the chassis handbrake with braking, slip and yaw',()=>{
  const drive=controls=>{
    const m=fixture(),v=m.vehicles[0];stepRace(m,3);
    v.velocity={x:10,z:4};v.speed=10;
    stepRace(m,1/60,{x:1,z:-.5,yaw:-Math.PI/2,...controls});
    return v;
  };
  const normal=drive({}),jump=drive({jump:true}),crouch=drive({crouch:true});
  assert.equal(normal.handbrake,false);assert.equal(jump.handbrake,true);assert.equal(crouch.handbrake,true);
  assert.ok(jump.speed<normal.speed);
  assert.ok(jump.heading>normal.heading);
  const lateral=v=>Math.abs(v.velocity.x*Math.cos(v.heading)-v.velocity.z*Math.sin(v.heading));
  assert.ok(lateral(jump)>lateral(normal));
  assert.deepEqual(jump.position,crouch.position);assert.deepEqual(jump.velocity,crouch.velocity);
});

test('sprint retains stock boost duration and cooldown; turbo stacks and slow still applies',()=>{
  const drive=(sprint,effect)=>{
    const m=fixture();stepRace(m,3,{x:1,yaw:-Math.PI/2,sprint});
    assert.equal(m.vehicles[0].boostTimer,0);
    if(effect)m.race.racers[0].effects[effect]=2;
    stepRace(m,1.5,{x:1,yaw:-Math.PI/2,sprint});
    return m;
  };
  const normal=drive(false),stock=drive(true),turbo=drive(true,'turbo'),slow=drive(true,'slow');
  const v=stock.vehicles[0];
  assert.ok(v.speed>normal.vehicles[0].speed+3);
  assert.ok(turbo.vehicles[0].speed>v.speed+5);
  assert.ok(slow.vehicles[0].speed<v.speed*.7);
  assert.ok(v.boostTimer>.49&&v.boostTimer<.54);assert.equal(v.boostCooldown,0);
  stepRace(stock,.1,{x:1,yaw:-Math.PI/2});
  assert.ok(v.boostTimer>.39&&v.boostTimer<.44);
  const held={x:1,yaw:-Math.PI/2,sprint:true};
  stepRace(stock,.5,held);
  assert.equal(v.boostTimer,0);assert.ok(v.boostCooldown>5.8&&v.boostCooldown<=6);
  const cooldown=v.boostCooldown;
  stepRace(stock,1,held);
  assert.equal(v.boostTimer,0);assert.ok(Math.abs(v.boostCooldown-(cooldown-1))<1e-8);
  stepRace(stock,v.boostCooldown-.05,held);assert.equal(v.boostTimer,0);
  stepRace(stock,.1,held);assert.ok(v.boostTimer>1.9);
});

test('reset preserves validated gates, freezes two seconds, and never sweeps teleport',()=>{
  const m=fixture(),s=m.race,r=s.racers[0];stepRace(m,3);
  crossing(s,r,0);crossing(s,r,1);
  m.vehicles[0].position={x:1000,y:0,z:1000};
  stepRace(m,1/60,{interact:true});
  assert.equal(r.nextGate,2);assert.equal(r.completedLaps,0);assert.equal(m.vehicles[0].driver,0);
  const reset={...m.vehicles[0].position};
  stepRace(m,1.9,{x:1,interact:true});assert.deepEqual(m.vehicles[0].position,reset);
  stepRace(m,.2,{x:1,interact:true});assert.notDeepEqual(m.vehicles[0].position,reset);
  assert.equal(r.nextGate,2);
});

test('items are seeded, single-slot, edge triggered, respawn after eight seconds',()=>{
  const m=fixture(),r=m.race.racers[0],box=m.race.boxes[0];stepRace(m,3);
  Object.assign(m.vehicles[0].position,{x:box.x,z:box.z});stepRace(m,1/60);
  assert.ok(ITEMS.includes(r.item));assert.equal(box.wait,8);assert.equal(raceSnapshot(m.race).boxes[0].ready,false);
  r.item='turbo';stepRace(m,1/60,{fire:true});assert.equal(r.item,null);assert.equal(r.effects.turbo,2);
  r.item='shield';stepRace(m,1/60,{fire:true});assert.equal(r.item,'shield');
  stepRace(m,1/60);stepRace(m,1/60,{power:true});assert.equal(r.item,null);assert.equal(r.effects.shield,5);
  r.item='oil';stepRace(m,8);assert.equal(box.wait,0);assert.equal(r.item,'oil');
  assert.equal(r.effects.shield,0);assert.equal(r.effects.turbo,0);
});

test('pulse slows nearest ahead, oil affects opponents, shields counter both',()=>{
  const m=fixture(3),[a,b,c]=m.race.racers;stepRace(m,3);
  a.progress=0;b.progress=2;c.progress=4;a.item='pulse';b.effects.shield=5;
  stepRace(m,1/60,{fire:true});assert.equal(b.effects.slow,0);assert.equal(c.effects.slow,0);
  stepRace(m,1/60);a.progress=0;b.progress=2;c.progress=4;a.item='pulse';b.effects.shield=0;
  stepRace(m,1/60,{power:true});assert.ok(b.effects.slow>1.9);assert.equal(c.effects.slow,0);
  stepRace(m,1/60);a.item='oil';stepRace(m,1/60,{fire:true});
  const h=m.race.hazards[0];assert.ok(h);assert.equal(h.ttl,8);
  Object.assign(m.vehicles[2].position,{x:h.x,z:h.z});c.effects.shield=5;c.effects.slow=0;
  stepRace(m,1/60);assert.equal(c.effects.slow,0);
  c.effects.shield=0;stepRace(m,1/60);assert.equal(c.effects.slow,2);
  Object.assign(m.vehicles[2].position,{x:100,z:100});stepRace(m,2.1);assert.equal(c.effects.slow,0);
});

test('same-tick finish order uses crossing time rather than actor iteration',()=>{
  const m=fixture(),s=m.race;stepRace(m,3);s.laps=1;
  for(const r of s.racers){r.started=true;r.completedLaps=0;r.passed=12;r.nextGate=0;}
  for(let i=0;i<2;i++){
    const v=m.vehicles[i];v.position={x:i===0?-.2:-.05,y:0,z:-48};v.heading=Math.PI/2;v.velocity={x:20,z:0};v.speed=20;
  }
  stepRace(m,1/60);
  assert.equal(s.phase,'finished');assert.equal(s.winnerId,1);
  assert.ok(s.racers[1].finishTime<s.racers[0].finishTime);
});

test('timeout selects exactly one progress winner with deterministic ties',()=>{
  const m=fixture();stepRace(m,3);m.config.timeLimit=.01;
  stepRace(m,.02);assert.equal(m.overReason,'time');assert.equal(m.race.winnerId,raceStandings(m.race)[0].actorId);
});

test('automatic recovery retains mount and checkpoint progress',()=>{
  const m=fixture(),r=m.race.racers[0];stepRace(m,3);crossing(m.race,r,0);
  m.vehicleCollision=()=>false;stepRace(m,3.5,{x:1,yaw:-Math.PI/2});
  assert.ok(r.resetWait>0);assert.equal(r.nextGate,1);assert.equal(m.vehicles[0].driver,0);
  resetRaceRacer(m,r);assert.equal(r.completedLaps,0);
});

test('eight bots complete actual driving laps deterministically without recovery',{skip:slowSkip('10k-step 8-bot race: run with COCS_SLOW_TESTS=1')},()=>{
  const run=()=>{
    const m=fixture(8,true);let resets=0;
    for(let i=0;i<10000&&!m.over;i++){stepRace(m,1/30,{inputs:{}});if(m.race.racers.some(r=>r.resetWait>0))resets++;}
    assert.equal(m.overReason,'race-finish');assert.equal(resets,0);
    assert.equal(raceStandings(m.race)[0].completedLaps,2);
    assert.ok(m.race.racers.every(r=>r.completedLaps>=1));
    return raceSnapshot(m.race);
  };
  assert.deepEqual(run(),run());
});

function carPositions(m){return m.race.racers.map(r=>m.vehicleById(r.vehicleId).position);}
function closestPair(m){
  const p=carPositions(m);let min=Infinity,pair=null;
  for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){
    const d=Math.hypot(p[i].x-p[j].x,p[i].z-p[j].z);if(d<min){min=d;pair=[i,j];}
  }
  return {min,pair};
}

test('after countdown all eight cars hold distinct, non-overlapping grid slots',()=>{
  const m=fixture(8,true),grid=m.arena.race.grid;
  stepRace(m,3,{inputs:{}});
  assert.equal(m.race.phase,'racing');
  const p=carPositions(m);
  for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){
    const d=Math.hypot(p[i].x-p[j].x,p[i].z-p[j].z);
    assert.ok(d>MIN_CAR_SEPARATION,`cars ${i},${j} only ${d.toFixed(3)} apart`);
  }
  assert.ok(m.race.gridMinSeparation>MIN_CAR_SEPARATION,`grid min ${m.race.gridMinSeparation}`);
  assert.equal(m.race.gridNudged,false);
  // Authored fixture grid (x stagger 5, z stagger 6) already clears 2*radius.
  assert.ok(grid.length>=8);
});

test('racing contacts keep every car separated, finite and on its chassis',()=>{
  const m=fixture(8,true,11);stepRace(m,3,{inputs:{}});
  let resets=0;
  for(let i=0;i<300;i++){stepRace(m,1/30,{inputs:{}});if(m.race.racers.some(r=>r.resetWait>0))resets++;}
  for(const p of carPositions(m))assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z),'position finite');
  for(const r of m.race.racers){
    const v=m.vehicleById(r.vehicleId),a=m.actors.find(a=>a.id===r.actorId);
    assert.equal(v.driver,r.actorId);assert.equal(a.vehicleId,v.id);
  }
  const {min,pair}=closestPair(m);
  assert.ok(min>=MIN_CAR_SEPARATION-.03,`cars ${pair} only ${min.toFixed(4)} apart after 10s`);
  assert.ok(resets===0,`unexpected recoveries: ${resets}`);
});

test('pole position does not always win across fixed seeds',()=>{
  const winners=[],order=[];
  for(const seed of [1,7,13,29,101,777]){
    const m=fixture(8,true,seed);
    for(let i=0;i<14000&&!m.over;i++)stepRace(m,1/30,{inputs:{}});
    assert.equal(m.overReason,'race-finish');
    winners.push(m.race.winnerId);
    order.push(raceStandings(m.race).map(r=>r.actorId).join(''));
  }
  assert.ok(new Set(winners).size>1,`all seeds won by ${winners[0]} (${winners})`);
  assert.ok(winners.some(w=>w!==0),`pole racer 0 won every seed (${winners})`);
});

test('mystery box rolls are weighted toward the trailer by rank',()=>{
  const sample=t=>{
    let state=1234567;const counts=Object.fromEntries(ITEMS.map(item=>[item,0]));
    for(let i=0;i<4000;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;counts[rollItem(()=>state/2**32,t)]++;}
    return counts;
  };
  const CATCHUP=['turbo','pulse','bolt','triple','star'],DENIAL=['shield','oil','mine'];
  const leader=sample(0),trailer=sample(1),catchup=c=>CATCHUP.reduce((s,item)=>s+c[item],0);
  assert.ok(catchup(trailer)>catchup(leader)*2,`leader ${JSON.stringify(leader)} trailer ${JSON.stringify(trailer)}`);
  assert.ok(catchup(leader)/4000<.35&&catchup(trailer)/4000>.65);
  for(const item of CATCHUP)assert.ok(trailer[item]>leader[item],`${item} should favor the trailer`);
  for(const item of DENIAL)assert.ok(leader[item]>trailer[item],`${item} should favor the leader`);
  const weights=itemWeights(.5),total=ITEMS.reduce((s,item)=>s+weights[item],0);
  assert.ok(Math.abs(total-1)<1e-9&&ITEMS.every(item=>weights[item]>=0));
  assert.equal(ITEMS.join(','),'turbo,shield,oil,pulse,mine,triple,bolt,star');
});

test('triple slows exactly the next three ahead; bolt slows every opponent ahead',()=>{
  const triple=fixture(5);stepRace(triple,3);
  const [a,b,c,d,e]=triple.race.racers;
  Object.assign(a,{progress:0,item:'triple'});Object.assign(b,{progress:1});Object.assign(c,{progress:2});Object.assign(d,{progress:3});Object.assign(e,{progress:4});
  stepRace(triple,1/60,{fire:true});
  for(const r of [b,c,d])assert.equal(r.effects.slow,1.5,`racer ${r.actorId} slowed`);
  assert.equal(e.effects.slow,0,'fourth ahead is untouched');
  const bolt=fixture(5);stepRace(bolt,3);
  const [f,g,h,i,j]=bolt.race.racers;
  Object.assign(f,{progress:0,item:'bolt'});Object.assign(g,{progress:1});Object.assign(h,{progress:2});Object.assign(i,{progress:3});Object.assign(j,{progress:4});
  stepRace(bolt,1/60,{power:true});
  for(const r of [g,h,i,j])assert.equal(r.effects.slow,2,`racer ${r.actorId} slowed`);
  assert.equal(f.effects.slow,0,'the caster is never slowed');
});

test('star grants immunity to pulse, bolt and oil slow',()=>{
  const m=fixture(3);stepRace(m,3);
  const [a,b,c]=m.race.racers;
  Object.assign(a,{progress:0,item:'pulse'});b.progress=1;c.progress=2;b.effects.star=3.5;
  stepRace(m,1/60,{fire:true});assert.equal(b.effects.slow,0,'star blocks pulse');
  stepRace(m,1/60);Object.assign(a,{progress:0,item:'bolt'});b.progress=1;c.progress=2;b.effects.star=0;c.effects.star=3.5;
  stepRace(m,1/60,{fire:true});assert.equal(c.effects.slow,0,'star blocks bolt');assert.ok(b.effects.slow>0,'plain racer still slowed');
  stepRace(m,1/60);Object.assign(c,{effects:{...c.effects,star:3.5,slow:0,shield:0}});
  a.item='oil';stepRace(m,1/60,{fire:true});
  const h=m.race.hazards.find(x=>x.type==='oil');
  Object.assign(m.vehicles[2].position,{x:h.x,z:h.z});stepRace(m,1/60);assert.equal(c.effects.slow,0,'star blocks oil');
});

test('mine drops a stationary trap; only non-immune cars are slowed for its value',()=>{
  const m=fixture(3);stepRace(m,3);
  const [a,b,c]=m.race.racers,v=m.vehicles[0];
  Object.assign(v.position,{x:5,z:5});a.item='mine';stepRace(m,1/60,{fire:true});
  const h=m.race.hazards.find(x=>x.type==='mine');
  assert.ok(h);assert.equal(h.x,5);assert.equal(h.z,5);assert.equal(h.ttl,12);
  assert.equal(h.slow,2.5);assert.equal(h.radius,3.5);assert.equal(h.owner,a.actorId);
  Object.assign(m.vehicles[1].position,{x:5,z:5});b.effects.star=3.5;b.effects.shield=0;
  stepRace(m,1/60);assert.equal(b.effects.slow,0,'star immune to mine');
  Object.assign(m.vehicles[2].position,{x:5,z:5});c.effects.shield=0;
  stepRace(m,1/60);assert.equal(c.effects.slow,2.5,'mine applies its slow');
});

test('coins collect, cap at ten, feed the speed multiplier, and drop two on a slow',()=>{
  const coins=[{id:'c0',x:5,z:5}];
  const m=fixture(1,false,7,{coins});stepRace(m,3);
  const a=m.race.racers[0],c0=m.race.coins[0];
  Object.assign(m.vehicles[0].position,{x:5,z:5});stepRace(m,1/60);
  assert.equal(a.coins,1);assert.equal(c0.wait,10);
  stepRace(m,1/60);assert.equal(a.coins,1,'cooldown blocks a second collect');
  a.coins=10;c0.wait=0;Object.assign(m.vehicles[0].position,{x:5,z:5});stepRace(m,1/60);
  assert.equal(a.coins,10,'cap holds at ten');
  const travel=n=>{const f=fixture(1,false,7);stepRace(f,3);f.race.racers[0].coins=n;
    const v=f.vehicles[0],start=f.arena.race.grid[0].x;stepRace(f,1,{x:1,yaw:-Math.PI/2});
    return Math.abs(v.position.x-start);};
  assert.ok(travel(10)>travel(0),'coins add speed');
  const slow=fixture(2);stepRace(slow,3);
  const [x,y]=slow.race.racers;Object.assign(x,{progress:0,item:'bolt'});y.progress=1;y.coins=5;
  stepRace(slow,1/60,{fire:true});assert.equal(y.coins,3,'slow drops two coins');
  y.coins=1;y.effects.slow=0;x.effects.slow=0;stepRace(slow,1/60);
  Object.assign(x,{progress:0,item:'bolt'});y.progress=1;
  stepRace(slow,1/60,{fire:true});assert.equal(y.coins,0,'coins never drop below zero');
});

test('boost pads trigger turbo with a per-racer cooldown and never go negative',()=>{
  const boostPads=[{id:'p0',x:5,z:5}];
  const m=fixture(1,false,7,{boostPads});stepRace(m,3);
  const r=m.race.racers[0];
  Object.assign(m.vehicles[0].position,{x:5,z:5});stepRace(m,1/60);
  assert.equal(r.effects.turbo,1.2);assert.equal(m.race.boostPads.length,1);
  assert.ok(r.boostPadWait>0&&r.boostPadWait<=1.2);
  stepRace(m,1/60);assert.ok(r.effects.turbo<1.2&&r.effects.turbo>1,'cooldown blocks re-trigger');
  const wait=r.boostPadWait;stepRace(m,wait+.02);
  assert.ok(r.effects.turbo>1,'pad re-triggers after its cooldown');
  assert.ok(r.boostPadWait>=0&&r.boostPadWait<=1.2);
});

test('snapshot exposes coins, star effects and hazard types; values stay finite',()=>{
  const m=fixture(2,false,7,{coins:[{id:'c0',x:5,z:5}],boostPads:[{id:'p0',x:9,z:9}]});
  stepRace(m,3);
  m.race.racers[0].coins=4;m.race.racers[0].item='mine';stepRace(m,1/60,{fire:true});
  const snap=raceSnapshot(m.race);
  assert.equal(snap.coins.length,1);assert.equal(typeof snap.coins[0].ready,'boolean');
  assert.ok(Number.isFinite(snap.coins[0].x)&&Number.isFinite(snap.coins[0].z));
  const row=snap.standings.find(r=>r.actorId===0);
  assert.equal(row.coins,4);assert.equal(row.effects.star,0);
  assert.ok(snap.hazards.length>=1&&snap.hazards.every(h=>typeof h.type==='string'));
  assert.ok(snap.hazards.every(h=>Number.isFinite(h.ttl)&&Number.isFinite(h.x)&&Number.isFinite(h.z)));
  m.race.racers[0].item='star';stepRace(m,1/60);stepRace(m,1/60,{fire:true});
  assert.ok(raceSnapshot(m.race).standings.find(r=>r.actorId===0).effects.star>3);
});

test('rubber-band pace is bounded and always helps the trailer',()=>{
  assert.equal(paceMultiplier(-1),PACE_LEADER);assert.equal(paceMultiplier(0),PACE_LEADER);
  assert.equal(paceMultiplier(1),PACE_TRAILER);assert.equal(paceMultiplier(5),PACE_TRAILER);
  for(let i=0;i<=20;i++){const p=paceMultiplier(i/20);assert.ok(Number.isFinite(p)&&p>=PACE_LEADER&&p<=PACE_TRAILER);}
  assert.ok(paceMultiplier(0)<paceMultiplier(.5)&&paceMultiplier(.5)<paceMultiplier(1));
  assert.ok(PACE_LEADER>=.93&&PACE_TRAILER<=1.11);
});

test('contacts push apart symmetrically, kill closing speed, and respect geometry',()=>{
  const m=fixture(2);stepRace(m,3,{inputs:{}});
  const a=m.vehicles[0],b=m.vehicles[1];
  a.position={x:0,y:0,z:0};b.position={x:1,y:0,z:0};
  a.velocity={x:6,z:0};b.velocity={x:-6,z:0};
  assert.ok(resolveCarCollisions(m,m.race,2)>0);
  assert.ok(Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z)>=MIN_CAR_SEPARATION-1e-6);
  assert.ok((a.velocity.x-b.velocity.x)<=1e-9,'closing normal velocity removed');
  assert.ok(Number.isFinite(a.velocity.x)&&Number.isFinite(b.velocity.x));
  // A world-blocked push is rejected rather than clipping through geometry.
  a.position={x:0,y:0,z:0};b.position={x:.5,y:0,z:0};m.vehicleCollision=()=>false;
  assert.equal(resolveCarCollisions(m,m.race,2),0);
  assert.deepEqual([a.position.x,a.position.z],[0,0]);
  assert.deepEqual([b.position.x,b.position.z],[.5,0]);
  assert.ok(Number.isFinite(a.position.x)&&Number.isFinite(b.position.z));
  // Reset-frozen cars are skipped entirely.
  m.vehicleCollision=next=>next;m.race.racers[1].resetWait=1;
  assert.equal(resolveCarCollisions(m,m.race,2),0);
});

test('collisions never duplicate or skip a racer gate/progress state',()=>{
  const m=fixture(8,true,5),s=m.race;stepRace(m,3,{inputs:{}});
  for(let i=0;i<900;i++)stepRace(m,1/30,{inputs:{}});
  for(const r of s.racers){
    assert.ok(Number.isInteger(r.passed)&&r.passed>=0);
    assert.ok(Number.isInteger(r.nextGate)&&r.nextGate>=0&&r.nextGate<s.gates.length);
    assert.equal(r.lap,Math.min(s.laps,r.completedLaps+1));
    assert.ok(r.completedLaps<=s.laps);
  }
});

test('a race with fewer than eight grid slots seats exactly the racers it can',()=>{
  const grid=Array.from({length:4},(_,i)=>({x:-4-i*5,z:-48+(i%2?3:-3),heading:Math.PI/2}));
  const m=fixture(4,false,7,{grid});
  assert.equal(m.vehicles.length,4);
  assert.equal(m.race.racers.length,4);
  assert.ok(m.vehicles.every(v=>Number.isFinite(v.position.x)&&Number.isFinite(v.position.z)));
});

test('a single-gate circuit never produces a NaN race progress',()=>{
  const gate={x:0,z:0,nx:1,nz:0,halfWidth:12};
  const state={gates:[gate],laps:2,elapsed:0};
  const racer={nextGate:0,passed:0,started:true,completedLaps:0,anchor:{x:0,z:0,heading:0},effects:{},checkpointAge:0,finishTime:null};
  crossRaceGates(state,racer,{x:0,z:0},{x:1,z:0},0,1);
  assert.ok(Number.isFinite(racer.progress),'progress stays finite when prev and next gates coincide');
});
