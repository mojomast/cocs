import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeRace, stepRace, raceSnapshot, raceStandings, crossRaceGates, resetRaceRacer} from './race.mjs';

function fixture(count=2, bots=false) {
  const centerline=Array.from({length:12},(_,i)=>({x:60*Math.sin(i*Math.PI/6),z:-48*Math.cos(i*Math.PI/6)}));
  const gates=centerline.map((p,i)=>{const dx=60*Math.cos(i*Math.PI/6),dz=48*Math.sin(i*Math.PI/6),len=Math.hypot(dx,dz);return {...p,nx:dx/len,nz:dz/len,halfWidth:12};});
  const grid=Array.from({length:8},(_,i)=>({x:-4-Math.floor(i/2)*5,z:-48+(i%2?3:-3),heading:Math.PI/2}));
  let seed=7;
  const match={arena:{race:{centerline,gates,grid,itemBoxes:[{id:'box',x:20,z:-46}]}},
    actors:Array.from({length:count},(_,id)=>({id,ammo:[1],bot:bots?{}:null})),config:{fragLimit:2,timeLimit:180},
    random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;},time:0,over:false,
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
  assert.equal(r.item,'turbo');assert.equal(box.wait,8);assert.equal(raceSnapshot(m.race).boxes[0].ready,false);
  stepRace(m,1/60,{fire:true});assert.equal(r.item,null);assert.equal(r.effects.turbo,2);
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

test('eight bots complete actual driving laps deterministically without recovery',()=>{
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
