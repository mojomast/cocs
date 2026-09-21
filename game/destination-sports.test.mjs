import test from 'node:test';
import assert from 'node:assert/strict';
import {DESTINATION_SPORTS_MAPS} from './destination-sports-maps.mjs';
import {Match,floorAt,obstructed} from './core.mjs';
import {GAME_MODES} from './config.mjs';
import {arenaMeta,arenaSupportsMode,mapsForMode} from './arenas.mjs';
import {crossRaceGates,raceSnapshot,raceStandings} from './race.mjs';

const speedway=DESTINATION_SPORTS_MAPS.find(map=>map.id==='ion-speedway');
const stadium=DESTINATION_SPORTS_MAPS.find(map=>map.id==='aurora-stadium');
const CLEARANCE=2.1,EPS=1e-8;
const seeded=(seed=71)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const make=(map,options={})=>{
 const match=new Match('chatgpt','openclaw',seeded(),map.id,{
  mode:map.arena.play[0],humanCount:map.race.grid.length,botCount:0,fragLimit:2,timeLimit:300,...options,
 });
 assert.equal(match.arena.id,map.id,'exercise the destination, never the fallback sports map');
 return match;
};
const inside=(polygon,{x,z})=>{
 let result=false;
 for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[i],b=polygon[j];
  if((a.z>z)!==(b.z>z)&&x<a.x+(b.x-a.x)*(z-a.z)/(b.z-a.z))result=!result;
 }
 return result;
};
function sampleSegment(a,b,visit,spacing=.5){
 const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),steps=Math.max(1,Math.ceil(length/spacing));
 for(let i=0;i<=steps;i++)visit({x:a.x+dx*i/steps,z:a.z+dz*i/steps},i/steps,{x:dx/length,z:dz/length});
}
function clear(map,p,label){
 assert.equal(floorAt(p.x,p.z,map),0,`${label}: flat driving surface`);
 assert.equal(obstructed(p.x,0,p.z,CLEARANCE,map),false,`${label}: ${CLEARANCE} m radius at ${p.x},${p.z}`);
}
function cross(state,racer,index,{reverse=false,offset=0,y=0}={}){
 const g=state.gates[index],sign=reverse?-1:1;
 crossRaceGates(state,racer,
  {x:g.x-sign*g.nx+g.nz*offset,y,z:g.z-sign*g.nz-g.nx*offset},
  {x:g.x+sign*g.nx+g.nz*offset,y,z:g.z+sign*g.nz-g.nx*offset},10,1);
}
function playingSoccer(){
 const match=make(stadium,{fragLimit:15});
 match.step(3,{inputs:{}});
 assert.equal(match.race.phase,'playing');
 return match;
}
function placeBall(match,{x,z,vx=0,vz=0}){
 Object.assign(match.race.ball,{x,z,y:match.race.ball.r,vx,vz});
 match.race.ballRest=0;
 match.race.ballEscapes=0;
}

test('destination sports metadata admits only the corresponding sport, including single-player exclusions',()=>{
 assert.equal(DESTINATION_SPORTS_MAPS.length,2);
 for(const [map,mode] of [[speedway,'puma-race'],[stadium,'puma-soccer']]){
  assert.equal(map.collection,'destinations');
  const meta=arenaMeta(map.id);
  assert.equal(meta.group,'vehicle');assert.equal(meta.scale,'battle');assert.deepEqual(meta.play,[mode]);
  assert.deepEqual(arenaMeta(map),meta,'authored metadata fallback also accepts a map object');
  for(const id of new Set([...GAME_MODES.map(entry=>entry.id),'horde','campaign'])){
   assert.equal(arenaSupportsMode(map.id,id),id===mode,`${map.id}/${id} eligibility`);
   assert.equal(mapsForMode(id).some(entry=>entry.id===map.id),id===mode,`${map.id}/${id} picker`);
  }
 }
});

for(const map of [speedway,stadium]){
 test(`${map.name}: complete centerline, corner sweeps, furniture and grid clear a 2.1 m chassis`,()=>{
  const {centerline,grid}=map.race,lanes=map===speedway?[-6,0,6]:[0];
  for(let i=0;i<centerline.length;i++){
   sampleSegment(centerline[i],centerline[(i+1)%centerline.length],(p,t,dir)=>{
    for(const lane of lanes)clear(map,{x:p.x-dir.z*lane,z:p.z+dir.x*lane},`segment ${i}/${t}, lane ${lane}`);
   });
   // Probe the whole corner, not just the incoming/outgoing line segments.
   const radius=map===speedway?6:1.5;
   for(let j=0;j<16;j++){
    const angle=j*Math.PI/8;
    clear(map,{x:centerline[i].x+Math.cos(angle)*radius,z:centerline[i].z+Math.sin(angle)*radius},`corner ${i}/${j}`);
   }
  }
  for(const [i,p] of grid.entries()){
   clear(map,p,`grid ${i}`);
   assert.deepEqual(map.spawns[i],[p.x,p.z]);
   assert.deepEqual(map.vehicles[i],{id:i,kind:'puma',x:p.x,y:0,z:p.z,yaw:p.heading});
   for(const q of grid.slice(i+1))assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>2*CLEARANCE,'full grid has no chassis overlaps');
  }
  for(const kind of ['itemBoxes','boostPads','coins'])for(const p of map.race[kind]??[])clear(map,p,`${kind}/${p.id}`);
 });

 test(`${map.name}: the full mounted grid remains in its authored slots throughout kickoff`,()=>{
  const match=make(map),before=match.vehicles.map(v=>({...v.position}));
  assert.equal(match.vehicles.length,map.race.grid.length);
  assert.equal(match.actors.length,map.race.grid.length);
  assert.deepEqual(before.map(p=>`${p.x},${p.z}`).sort(),map.race.grid.map(p=>`${p.x},${p.z}`).sort());
  match.step(3,{inputs:Object.fromEntries(match.actors.map(a=>[a.id,{x:1,sprint:true,fire:true,power:true}]))});
  assert.deepEqual(match.vehicles.map(v=>v.position),before,'kickoff inputs cannot move a chassis');
  for(const racer of match.race.racers){
   const actor=match.actors.find(a=>a.id===racer.actorId),vehicle=match.vehicleById(racer.vehicleId);
   assert.equal(vehicle.driver,actor.id);assert.equal(actor.vehicleId,vehicle.id);assert.equal(actor.vehicleSeat,'driver');
   clear(map,vehicle.position,`mounted grid ${actor.id}`);
   if(map===stadium){
    assert.equal(racer.team,actor.team);
    assert.ok(map.teamSpawns[racer.team].some(([x,z])=>x===vehicle.position.x&&z===vehicle.position.z));
    assert.ok(Math.sin(vehicle.heading)*vehicle.position.x<0,'both teams face the centre');
   }
  }
  if(map===speedway){assert.equal(match.race.gridNudged,false);assert.equal(match.race.phase,'racing');}
  else{
   assert.equal(match.race.phase,'playing');assert.deepEqual(match.teamScores,{0:0,1:0});
   for(const team of [0,1])assert.equal(match.race.racers.filter(r=>r.team===team).length,2);
   assert.deepEqual([match.race.ball.x,match.race.ball.z,match.race.ball.vx,match.race.ball.vz],[0,0,0,0]);
  }
 });
}

test('Ion Speedway gates face forward and reject reverse, missed, airborne and out-of-order crossings',()=>{
 const match=make(speedway),state=match.race,racer=state.racers[0],points=speedway.race.centerline;
 assert.equal(state.gates.length,points.length);
 for(const [i,g] of state.gates.entries()){
  const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];
  assert.ok(Math.abs(Math.hypot(g.nx,g.nz)-1)<EPS);
  assert.ok((g.x-prev.x)*g.nx+(g.z-prev.z)*g.nz>0,`gate ${i} admits the incoming segment`);
  assert.ok((next.x-g.x)*g.nx+(next.z-g.z)*g.nz>0,`gate ${i} points down the outgoing segment`);
  for(const options of [{reverse:true},{offset:g.halfWidth+1},{offset:-g.halfWidth-1},{y:4}]){
   const probe={...racer,nextGate:i,passed:0};
   cross(state,probe,i,options);assert.equal(probe.passed,0,`gate ${i} rejects ${JSON.stringify(options)}`);
  }
 }
 cross(state,racer,1);assert.equal(racer.passed,0,'a skipped start is not a checkpoint');
 cross(state,racer,0);assert.equal(racer.passed,1);assert.equal(racer.completedLaps,0);
 cross(state,racer,2);cross(state,racer,0);assert.equal(racer.passed,1,'skip and repeated finish do not advance');
 for(let i=1;i<state.gates.length;i++)cross(state,racer,i);
 assert.equal(racer.completedLaps,0,'the final corner alone is not a lap');
 cross(state,racer,0);
 assert.equal(racer.completedLaps,1);assert.equal(racer.passed,state.gates.length+1);assert.equal(racer.nextGate,1);
});

test('Ion Speedway keeps both reverse-curvature sections contained and seals infield and outside cutoffs',()=>{
 const {centerline,boundary}=speedway.race;
 const turns=centerline.map((b,i)=>{
  const a=centerline[(i+centerline.length-1)%centerline.length],c=centerline[(i+1)%centerline.length];
  return (b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x);
 });
 assert.ok(turns.some(t=>t>EPS)&&turns.some(t=>t<-EPS),'road course must retain its dogleg rather than become a convex oval');
 for(const p of boundary.inner)assert.ok(inside(boundary.outer,p),'inner loop nests inside the outer loop');
 for(let i=0;i<centerline.length;i++)sampleSegment(centerline[i],centerline[(i+1)%centerline.length],p=>{
  assert.ok(inside(boundary.outer,p),'racing line stays inside the outer loop');
  assert.equal(inside(boundary.inner,p),false,'racing line stays out of the infield');
 });
 for(const side of ['inner','outer']){
  const polygon=boundary[side],rails=speedway.blocks.filter(b=>b.kind==='race-rail'&&b.side===side);
  assert.ok(rails.length>0);
  for(let i=0;i<polygon.length;i++)sampleSegment(polygon[i],polygon[(i+1)%polygon.length],(p,t,dir)=>{
   assert.ok(rails.some(b=>Math.abs(p.x-b.x)<=b.w/2+EPS&&Math.abs(p.z-b.z)<=b.d/2+EPS&&b.h>=CLEARANCE),`${side} edge ${i}/${t} has no gap`);
   for(const offset of [-.75,0,.75])assert.equal(obstructed(p.x-dir.z*offset,0,p.z+dir.x*offset,CLEARANCE,speedway),true,`${side} edge ${i}/${t} blocks crossing from either side`);
  });
 }
 // One chord attempts an infield shortcut; the other skips the recessed
 // return straight via the outside apron. Endpoints themselves are on track.
 for(const [from,to] of [[0,9],[8,11]]){
  let blocked=0;
  sampleSegment(centerline[from],centerline[to],p=>{if(obstructed(p.x,0,p.z,CLEARANCE,speedway))blocked++;});
  assert.ok(blocked>0,`shortcut ${from}->${to} must cross a solid cutoff`);
 }
 assert.equal(obstructed(0,0,0,CLEARANCE,speedway),true,'the infield is physically filled');
});

test('Ion Speedway eight real collision-aware bots finish driving laps deterministically within 10,000 ticks',()=>{
 const run=()=>{
  // aiSeats uses the normal Match vehicle/collision path for all eight seats;
  // no teleports, synthetic gate crossings or collision-free fixture movement.
  const match=make(speedway,{aiSeats:true});
  assert.ok(match.actors.every(a=>a.bot));
  let recoveryTicks=0;
  for(let tick=0;tick<10000&&!match.over;tick++){
   match.step(1/30,{inputs:{}});
   if(match.race.racers.some(r=>r.resetWait>0))recoveryTicks++;
  }
  const standings=raceStandings(match.race),diagnostic=JSON.stringify(standings);
  assert.equal(match.overReason,'race-finish',diagnostic);
  assert.equal(recoveryTicks,0,`laps must be driven without automatic checkpoint recovery: ${diagnostic}`);
  assert.equal(standings[0].completedLaps,2);
  assert.ok(standings.every(r=>r.completedLaps>=1),`every bot drives a full lap: ${diagnostic}`);
  assert.ok(match.race.elapsed<=300);
  for(const vehicle of match.vehicles){
   assert.ok([vehicle.position.x,vehicle.position.y,vehicle.position.z].every(Number.isFinite));
   assert.equal(vehicle.driver,match.race.racers.find(r=>r.vehicleId===vehicle.id).actorId);
  }
  return raceSnapshot(match.race);
 };
 assert.deepEqual(run(),run(),'same seed reproduces finish times, positions, rewards and standings');
});

test('Aurora Stadium keeps an empty symmetric play surface and matching board/goal collisions',()=>{
 const {pitch,goals,ball}=stadium.race;
 assert.ok(pitch.maxX-pitch.minX>60&&pitch.maxZ-pitch.minZ>36,'larger than the original pitch');
 assert.equal(pitch.minX,-pitch.maxX);assert.equal(pitch.minZ,-pitch.maxZ);
 for(let x=pitch.minX+3;x<=pitch.maxX-3;x+=3)for(let z=pitch.minZ+3;z<=pitch.maxZ-3;z+=3)clear(stadium,{x,z},'pitch interior');
 for(const block of stadium.blocks)for(const [sx,sz] of [[-1,1],[1,-1]]){
  assert.ok(stadium.blocks.some(other=>Math.abs(other.x-sx*block.x)<EPS&&Math.abs(other.z-sz*block.z)<EPS&&other.w===block.w&&other.d===block.d&&other.h===block.h&&other.kind===block.kind),'stadium collision has no team- or flank-biased architecture');
 }
 assert.equal(goals.length,2);
 for(const goal of goals){
  assert.equal(goal.x,goal.team===0?pitch.minX:pitch.maxX);
  assert.equal(goal.nx,goal.team===0?-1:1);assert.equal(goal.nz,0);assert.equal(goal.z,0);
  assert.ok(goal.depth>2*ball.r,'net is deep enough to accept the whole ball');
  for(const z of [-goal.halfWidth+3,0,goal.halfWidth-3])clear(stadium,{x:goal.x,z},'open goal mouth');
 }
});

for(const goal of stadium.race.goals){
 test(`Aurora goal ${goal.team}: central and near-post shots score for the opponent and reset the ball`,()=>{
  for(const z of [0,-goal.halfWidth+stadium.race.ball.r+.3,goal.halfWidth-stadium.race.ball.r-.3]){
   const match=playingSoccer(),team=1-goal.team,scorer=match.race.racers.find(r=>r.team===team);
   match.race.lastTouch=scorer.actorId;
   placeBall(match,{x:goal.x-goal.nx*.2,z,vx:goal.nx*18});
   match.step(1/60,{inputs:{}});
   assert.equal(match.race.scores[team],1,`valid shot at z=${z}`);assert.equal(match.race.scores[goal.team],0);
   assert.equal(match.teamScores[team],1);assert.equal(scorer.goals,1);assert.equal(match.race.serial,1);
   const ball=match.race.ball;
   assert.deepEqual([ball.x,ball.z,ball.vx,ball.vz],[0,0,0,0]);assert.equal(ball.y,ball.r);
   assert.ok(match.events.some(e=>e.type==='soccer-goal'&&e.team===team&&e.actor===scorer.actorId));
  }
 });

 test(`Aurora goal ${goal.team}: posts, end boards and all three net walls reject invalid shots`,()=>{
  const r=stadium.race.ball.r;
  for(const sign of [-1,1]){
   const post=playingSoccer();
   placeBall(post,{x:goal.x-goal.nx*(r+.2),z:sign*goal.halfWidth,vx:goal.nx*24});
   post.step(.1,{inputs:{}});
   assert.deepEqual(post.race.scores,{0:0,1:0});assert.ok(post.race.ball.vx*goal.nx<0,'post returns a head-on shot');
   const board=playingSoccer();
   placeBall(board,{x:goal.x-goal.nx*(r+.05),z:sign*(goal.halfWidth+3),vx:goal.nx*30});
   board.step(.1,{inputs:{}});
   assert.deepEqual(board.race.scores,{0:0,1:0});assert.ok(board.race.ball.vx*goal.nx<0);
   assert.ok((board.race.ball.x-goal.x)*goal.nx<=-r+EPS,'end board agrees with analytic ball bounds');
   const netSide=playingSoccer();
   placeBall(netSide,{x:goal.x+goal.nx*2,z:sign*(goal.halfWidth-r-.15),vz:sign*18});
   netSide.step(1/30,{inputs:{}});
   assert.deepEqual(netSide.race.scores,{0:0,1:0},'starting behind the goal line grants no goal');
   assert.ok(netSide.race.ball.vz*sign<0,'net side closes the pocket');
   assert.ok(Math.abs(netSide.race.ball.z)<=goal.halfWidth-r+EPS);
  }
  const back=playingSoccer();
  placeBall(back,{x:goal.x+goal.nx*(goal.depth-r-.2),z:0,vx:goal.nx*18});
  back.step(1/30,{inputs:{}});
  assert.deepEqual(back.race.scores,{0:0,1:0});assert.ok(back.race.ball.vx*goal.nx<0,'back net reflects the ball');
  assert.ok((back.race.ball.x-goal.x)*goal.nx<=goal.depth-r+EPS);
  const reverse=playingSoccer();
  placeBall(reverse,{x:goal.x+goal.nx*.2,z:0,vx:-goal.nx*18});
  reverse.step(1/60,{inputs:{}});
  assert.deepEqual(reverse.race.scores,{0:0,1:0},'returning out of the net cannot score');
  assert.ok((reverse.race.ball.x-goal.x)*goal.nx<0,'reverse shot actually crosses the line');
 });
}

test('Aurora touchline boards reflect the ball at both analytic pitch limits',()=>{
 for(const side of [-1,1]){
  const match=playingSoccer(),ball=match.race.ball,edge=side<0?match.race.pitch.minZ:match.race.pitch.maxZ;
  placeBall(match,{x:0,z:edge-side*(ball.r+.05),vz:side*30});
  match.step(.1,{inputs:{}});
  assert.ok(ball.vz*side<0);assert.ok((ball.z-edge)*side<=-ball.r+EPS);
  assert.deepEqual(match.race.scores,{0:0,1:0});
 }
});

test('both destination sports bypass infantry combat, damage, pickups and dismounting',()=>{
 for(const map of [speedway,stadium]){
  const match=make(map),[actor,target]=match.actors,health=match.actors.map(a=>a.health),ammo=match.actors.map(a=>[...a.ammo]);
  match.botInput=()=>assert.fail('combat AI called during a sport');
  match.objective=()=>assert.fail('infantry objective called during a sport');
  match.damage(target,99999,actor);match.damageVehicle(match.vehicles[1],99999,actor);match.fire(actor);match.power(actor);
  assert.equal(match.releaseVehicle(actor),false);
  match.step(3,{inputs:{}});
  const inputs=Object.fromEntries(match.actors.map(a=>[a.id,{fire:true,power:true,grenade:true,melee:true,reload:true,weapon:1}]));
  match.step(.1,{inputs});
  assert.deepEqual(match.actors.map(a=>a.health),health);assert.deepEqual(match.actors.map(a=>a.ammo),ammo);
  assert.ok(match.vehicles.every(v=>v.health===v.maxHealth&&v.lastStep.fired===false));
  assert.ok(match.actors.every(a=>a.frags===0&&a.active===0&&a.vehicleSeat==='driver'));
  assert.equal(match.stats.shots,0);assert.equal(match.stats.kills,0);assert.equal(match.stats.powers,0);
  assert.equal(match.rockets.length,0);assert.equal(match.pickups.length,0);
 }
});
