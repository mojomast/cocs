import {createVehicle,PUMA,respawnVehicle,takeVehicleSeat,stepVehicle} from './vehicles.mjs';
import {CAR_RADIUS,resolveCarCollisions} from './race.mjs';
import {clamp} from './math.mjs';

export const SOCCER_MODE_ID='puma-soccer';
export const SOCCER_KICKOFF=3;
const SLICE=1/60;
const BALL_FRICTION=0.6;
const BALL_BOUNCE=0.55;
const BALL_SPIN=0.45;
const BALL_REST_SPEED=1.1;
const BALL_REST_TIME=1;
const BALL_ESCAPE=7;
const DEFAULT_PITCH={minX:-30,maxX:30,minZ:-18,maxZ:18};
const DEFAULT_GOALS=[
 {team:0,x:-30,z:0,nx:-1,nz:0,halfWidth:6,height:4,depth:2},
 {team:1,x:30,z:0,nx:1,nz:0,halfWidth:6,height:4,depth:2},
];
const DEFAULT_CENTERLINE=[{x:-30,z:-18},{x:30,z:-18},{x:30,z:18},{x:-30,z:18}];
const angle=n=>Math.atan2(Math.sin(n),Math.cos(n));

function groundY(match,x,z){
 const sample=typeof match.vehicleGround==='function'?match.vehicleGround(x,z):null;
 if(sample===null||sample===undefined) return 0;
 if(typeof sample==='number') return Number.isFinite(sample)?sample:0;
 return Number.isFinite(sample.y)?sample.y:0;
}

function setBallNormalSpeed(ball,nx,nz,target){
 const current=ball.vx*nx+ball.vz*nz,delta=target-current;
 if(!Number.isFinite(delta)) return;
 ball.vx+=nx*delta;
 ball.vz+=nz*delta;
 if(!Number.isFinite(ball.vx)) ball.vx=0;
 if(!Number.isFinite(ball.vz)) ball.vz=0;
}

function resetBall(match,state){
 const ball=state.ball,r=Number.isFinite(ball.r)?ball.r:1.1;
 ball.x=0;ball.z=0;ball.vx=0;ball.vz=0;
 ball.y=groundY(match,0,0)+r;
 if(!Number.isFinite(ball.y)) ball.y=r;
 state.ballRest=0;state.ballContact=false;state.ballEscapes=0;
}

function slotPool(pitch,arena,team){
 const slots=[];
 for(const g of pitch.grid||[]) if((g.x<0?0:1)===team) slots.push({x:g.x,z:g.z,heading:Number.isFinite(g.heading)?g.heading:0});
 if(slots.length) return slots;
 const spawns=pitch.teamSpawns||arena?.teamSpawns||{};
 for(const raw of spawns[team]||spawns[team===0?'red':'blue']||[]){
  if(Array.isArray(raw)&&Number.isFinite(raw[0])&&Number.isFinite(raw[1])) slots.push({x:raw[0],z:raw[1],heading:team===0?Math.PI/2:-Math.PI/2});
  else if(raw&&Number.isFinite(raw.x)&&Number.isFinite(raw.z)) slots.push({x:raw.x,z:raw.z,heading:Number.isFinite(raw.heading)?raw.heading:(team===0?Math.PI/2:-Math.PI/2)});
 }
 if(slots.length) return slots;
 return [{x:team===0?-24:24,z:0,heading:team===0?Math.PI/2:-Math.PI/2}];
}

export function initializeSoccer(match){
 const pitch=match.arena?.race;
 if(!pitch) throw new Error('Soccer requires a pitch map');
 const goals=(pitch.goals||DEFAULT_GOALS).map(g=>({...g}));
 const ball={...{x:0,y:1.1,z:0,r:1.1},...(pitch.ball||{})};
 const centerline=(pitch.centerline||DEFAULT_CENTERLINE).map(p=>({...p}));
 match.race={
  kind:'soccer',phase:'kickoff',countdown:SOCCER_KICKOFF,elapsed:0,
  timeLimit:Number.isFinite(match.config?.timeLimit)?match.config.timeLimit:180,
  goalLimit:Number.isFinite(match.config?.fragLimit)?match.config.fragLimit:3,
  scores:{0:0,1:0},winnerTeam:null,ball,goals,
  pitch:pitch.pitch?{...pitch.pitch}:{...DEFAULT_PITCH},
  centerline,racers:[],serial:0,contacts:0,lastTouch:null,
 };
 match.teamScores=match.teamScores||{0:0,1:0};
 match.teamScores[0]=0;match.teamScores[1]=0;
 const pools={0:slotPool(pitch,match.arena,0),1:slotPool(pitch,match.arena,1)};
 const used={0:0,1:0};
 const actors=(match.actors||[]).slice(0,4);
 match.vehicles=[];
 actors.forEach((actor,index)=>{
  const team=Number.isFinite(actor.team)?(actor.team===0?0:1):index%2;
  const pool=pools[team];
  const slot=pool[Math.min(used[team],pool.length-1)]||{x:0,z:0,heading:0};
  used[team]++;
  const vehicle=createVehicle(PUMA);
  vehicle.id=index;vehicle.kind='puma';
  vehicle.spawn={x:slot.x,y:0,z:slot.z};
  respawnVehicle(vehicle,vehicle.spawn,slot.heading);
  takeVehicleSeat(vehicle,actor.id,'driver');
  actor.yaw=slot.heading-Math.PI;
  actor.active=0;actor.cooldown=0;actor.vehicleId=vehicle.id;actor.vehicleSeat='driver';
  match.vehicles.push(vehicle);
  match.syncVehicleActor(actor,vehicle);
  match.race.racers.push({actorId:actor.id,vehicleId:vehicle.id,team,goals:0});
 });
 resetBall(match,match.race);
 return match.race;
}

export function soccerStandings(state){
 if(!state) return [];
 return [...state.racers]
  .sort((a,b)=>(b.goals||0)-(a.goals||0)||a.actorId-b.actorId)
  .map(r=>({actorId:r.actorId,team:r.team,goals:r.goals||0,vehicleId:r.vehicleId}));
}

export function soccerSnapshot(state){
 if(!state) return null;
 return {
  kind:'soccer',phase:state.phase,countdown:state.countdown,elapsed:state.elapsed,
  timeLimit:state.timeLimit,goalLimit:state.goalLimit,
  scores:{0:state.scores[0],1:state.scores[1]},winnerTeam:state.winnerTeam,
  ball:{x:state.ball.x,y:state.ball.y,z:state.ball.z,vx:state.ball.vx,vz:state.ball.vz,r:state.ball.r},
  goals:state.goals.map(g=>({...g})),
  pitch:{...state.pitch},
  standings:soccerStandings(state),
 };
}

// One bot per team attacks the ball; its partner holds a support line between
// the ball and its own goal. Both steer around team-mates (and the pile-up at
// the ball) and reverse out if they wedge against a wall or each other.
export function soccerBotControls(match,racer){
 const vehicle=match.vehicleById?.(racer.vehicleId),state=match.race;
 if(!vehicle||!state) return {throttle:0,steer:0};
 const pos=vehicle.position;
 if(!Number.isFinite(pos?.x)||!Number.isFinite(pos?.z)||!Number.isFinite(vehicle.heading)) return {throttle:0,steer:0};
 const ai=racer.ai||(racer.ai={reverse:0,stuck:0,lane:((racer.actorId*2654435761>>>0)%1000/1000-.5)*3});
 const ball=state.ball;
 const ownGoal=state.goals.find(g=>g.team===racer.team)||state.goals[0];
 const targetGoal=state.goals.find(g=>g.team!==racer.team)||state.goals[1];
 const chaser=state.chaser?.[racer.team]===racer.actorId;
 let targetX,targetZ;
 if(chaser){
  const ax=(targetGoal.x-ball.x),az=(targetGoal.z-ball.z),al=Math.hypot(ax,az)||1;
  const px=-az/al,pz=ax/al,back=Math.min(2.8,2.0+CAR_RADIUS*.5);
  targetX=ball.x-(ax/al)*back+px*ai.lane;
  targetZ=ball.z-(az/al)*back+pz*ai.lane;
 }else{
  const gx=ball.x-(ownGoal?ownGoal.x:0),gz=ball.z-(ownGoal?ownGoal.z:0),gl=Math.hypot(gx,gz)||1;
  targetX=ball.x-(gx/gl)*9+(gz/gl)*ai.lane;
  targetZ=ball.z-(gz/gl)*9-(gx/gl)*ai.lane;
 }
 let tx=targetX-pos.x,tz=targetZ-pos.z;
 const others=match.vehicles||[];
 for(const other of others){
  if(other===vehicle) continue;
  const ox=pos.x-other.position.x,oz=pos.z-other.position.z,od=Math.hypot(ox,oz);
  if(od>3.6||od<1e-4) continue;
  const push=(3.6-od)/3.6*4.5;
  tx+=(ox/od)*push;tz+=(oz/od)*push;
 }
 if(!Number.isFinite(tx)||!Number.isFinite(tz)||(tx===0&&tz===0)){tx=Math.sin(vehicle.heading);tz=Math.cos(vehicle.heading);}
 const error=angle(Math.atan2(tx,tz)-vehicle.heading);
 const speed=Math.hypot(vehicle.velocity?.x||0,vehicle.velocity?.z||0);
 if(speed<1.1) ai.stuck+=SLICE; else ai.stuck=Math.max(0,ai.stuck-SLICE*1.5);
 if(ai.stuck>1&&ai.reverse<=0){ai.reverse=.75;ai.stuck=0;}
 if(ai.reverse>0){ai.reverse-=SLICE;return {throttle:-.7,steer:clamp(-error*1.4,-1,1)};}
 const ballDistance=Math.hypot(ball.x-pos.x,ball.z-pos.z);
 const close=ballDistance<5;
 return {
  throttle:Math.abs(error)>1.05?.4:.95,
  steer:clamp(error*1.9,-1,1),
  sprint:chaser&&close&&Math.abs(error)<.5,
  brake:!chaser&&Math.abs(error)>1.6,
  jump:!chaser&&Math.abs(error)>1.6,
 };
}

function resolveBallCars(match,state){
 const ball=state.ball,contact=CAR_RADIUS+ball.r;
 let hits=0;state.ballContact=false;
 for(const racer of state.racers){
  const vehicle=match.vehicleById?.(racer.vehicleId);
  if(!vehicle||vehicle.driver==null) continue;
  const p=vehicle.position;
  if(!Number.isFinite(p?.x)||!Number.isFinite(p?.z)||!Number.isFinite(ball.x)||!Number.isFinite(ball.z)) continue;
  const dx=ball.x-p.x,dz=ball.z-p.z,d=Math.hypot(dx,dz);
  if(d<contact+0.4) state.ballContact=true;
  if(!(d<contact)) continue;
  let nx,nz;
  if(d>1e-6){nx=dx/d;nz=dz/d;}
  else{nx=Math.sin(vehicle.heading);nz=Math.cos(vehicle.heading);if(!Number.isFinite(nx)||!Number.isFinite(nz)||(nx===0&&nz===0)){nx=1;nz=0;}}
  // Clear the chassis by a hair so the next tick is not a zero-length
  // re-collision, which is what left the ball pinned in place.
  ball.x=p.x+nx*(contact+.05);
  ball.z=p.z+nz*(contact+.05);
  const cvx=vehicle.velocity?.x||0,cvz=vehicle.velocity?.z||0;
  const carN=cvx*nx+cvz*nz;
  const ballN=ball.vx*nx+ball.vz*nz;
  if(carN>ballN) setBallNormalSpeed(ball,nx,nz,carN);
  // A glancing hit adds a slice of the chassis's sideways speed, so the ball
  // deflects out of a scrum instead of being bulldozed straight into it.
  const tx=cvx-carN*nx,tz=cvz-carN*nz;
  if(Number.isFinite(tx)&&Number.isFinite(tz)){ball.vx+=tx*BALL_SPIN;ball.vz+=tz*BALL_SPIN;}
  state.lastTouch=racer.actorId;
  hits++;
 }
 return hits;
}

function resolveBallBounds(ball,pitch,goals){
 if(!pitch) return;
 const r=ball.r,list=Array.isArray(goals)?goals:[];
 const inMouth=z=>list.some(g=>Math.abs(z-(Number.isFinite(g.z)?g.z:0))<=(Number.isFinite(g.halfWidth)?g.halfWidth:6));
 if(ball.z<pitch.minZ+r){ball.z=pitch.minZ+r;ball.vz=Math.abs(ball.vz)*BALL_BOUNCE;}
 else if(ball.z>pitch.maxZ-r){ball.z=pitch.maxZ-r;ball.vz=-Math.abs(ball.vz)*BALL_BOUNCE;}
 if(ball.x<pitch.minX+r&&!inMouth(ball.z)){ball.x=pitch.minX+r;ball.vx=Math.abs(ball.vx)*BALL_BOUNCE;}
 else if(ball.x>pitch.maxX-r&&!inMouth(ball.z)){ball.x=pitch.maxX-r;ball.vx=-Math.abs(ball.vx)*BALL_BOUNCE;}
}

function resolveBallBlocks(ball,blocks){
 const r=ball.r;
 for(const b of blocks){
  if(!b||!(b.h>0)) continue;
  if(ball.y-r>=b.h) continue;
  const hw=b.w/2,hd=b.d/2;
  if(Math.abs(ball.x-b.x)>hw+r||Math.abs(ball.z-b.z)>hd+r) continue;
  const cx=clamp(ball.x,b.x-hw,b.x+hw),cz=clamp(ball.z,b.z-hd,b.z+hd);
  const dx=ball.x-cx,dz=ball.z-cz,d2=dx*dx+dz*dz;
  if(d2>=r*r) continue;
  let nx,nz;
  if(d2>1e-12){
   const d=Math.sqrt(d2),push=r-d;
   nx=dx/d;nz=dz/d;
   ball.x+=nx*push;ball.z+=nz*push;
  }else{
   const px=(hw+r)-Math.abs(ball.x-b.x),pz=(hd+r)-Math.abs(ball.z-b.z);
   if(px<pz){nx=Math.sign(ball.x-b.x)||1;nz=0;ball.x=b.x+nx*(hw+r);}
   else{nx=0;nz=Math.sign(ball.z-b.z)||1;ball.z=b.z+nz*(hd+r);}
  }
  const vn=ball.vx*nx+ball.vz*nz;
  if(vn<0){ball.vx-=(1+BALL_BOUNCE)*vn*nx;ball.vz-=(1+BALL_BOUNCE)*vn*nz;}
 }
}

function stepBall(match,state,dt){
 const ball=state.ball;
 const damp=Math.max(0,1-BALL_FRICTION*dt);
 ball.vx*=damp;ball.vz*=damp;
 if(!Number.isFinite(ball.vx)) ball.vx=0;
 if(!Number.isFinite(ball.vz)) ball.vz=0;
 ball.x+=ball.vx*dt;
 ball.z+=ball.vz*dt;
 resolveBallBounds(ball,state.pitch,state.goals);
 resolveBallBlocks(ball,match.arena?.blocks||[]);
 ball.y=groundY(match,ball.x,ball.z)+ball.r;
 if(!Number.isFinite(ball.x)||!Number.isFinite(ball.z)||!Number.isFinite(ball.y)){resetBall(match,state);return;}
 // Anti-stuck: a ball wedged against a board or a crowd of idle chassis can sit
 // at rest forever. If it is slow while touching a car or a board, give it a
 // shove away from the obstruction; if that keeps failing, reset to the centre.
 const speed=Math.hypot(ball.vx,ball.vz),pitch=state.pitch;
 const nearBoard=pitch&&(ball.x<pitch.minX+ball.r+.7||ball.x>pitch.maxX-ball.r-.7||ball.z<pitch.minZ+ball.r+.7||ball.z>pitch.maxZ-ball.r-.7);
 state.ballRest=speed<BALL_REST_SPEED?(state.ballRest||0)+dt:0;
 if(state.ballRest>=BALL_REST_TIME&&(state.ballContact||nearBoard)){
  let nearest=null,nearestDistance=Infinity;
  for(const racer of state.racers){const vehicle=match.vehicleById?.(racer.vehicleId);if(!vehicle)continue;const distance=Math.hypot(ball.x-vehicle.position.x,ball.z-vehicle.position.z);if(distance<nearestDistance){nearestDistance=distance;nearest=vehicle;}}
  let ex,ez;
  if(nearest&&nearestDistance<CAR_RADIUS+ball.r+2.5){
   const dx=ball.x-nearest.position.x,dz=ball.z-nearest.position.z,d=Math.hypot(dx,dz)||1;
   ex=(dx/d)*BALL_ESCAPE+Math.cos(nearest.heading)*BALL_ESCAPE*.5;
   ez=(dz/d)*BALL_ESCAPE-Math.sin(nearest.heading)*BALL_ESCAPE*.5;
  }else{
   const centreX=pitch?(pitch.minX+pitch.maxX)/2:0,centreZ=pitch?(pitch.minZ+pitch.maxZ)/2:0;
   const dx=centreX-ball.x,dz=centreZ-ball.z,d=Math.hypot(dx,dz)||1;
   ex=(dx/d)*BALL_ESCAPE;ez=(dz/d)*BALL_ESCAPE;
  }
  ball.vx+=ex;ball.vz+=ez;
  state.ballRest=0;state.ballEscapes=(state.ballEscapes||0)+1;
  if(state.ballEscapes>8){resetBall(match,state);return;}
 }
}

function crossSoccerGoals(state,from,to){
 const ball=state.ball;
 for(const goal of state.goals){
  const before=(from.x-goal.x)*goal.nx+(from.z-goal.z)*goal.nz;
  const after=(to.x-goal.x)*goal.nx+(to.z-goal.z)*goal.nz;
  if(before>0||after<=0||after<=before) continue;
  const t=-before/(after-before);
  const x=from.x+(to.x-from.x)*t-goal.x,z=from.z+(to.z-from.z)*t-goal.z;
  if(Math.abs(x*goal.nz-z*goal.nx)>goal.halfWidth) continue;
  if(!Number.isFinite(ball.y)||ball.y<0||ball.y>goal.height) continue;
  return goal;
 }
 return null;
}

function scoreGoal(match,state,goal){
 const team=goal.team===0?1:0;
 state.scores[team]=(state.scores[team]||0)+1;
 const scorerId=Number.isFinite(state.lastTouch)?state.lastTouch:null;
 if(scorerId!==null){
  const racer=state.racers.find(r=>r.actorId===scorerId);
  if(racer&&racer.team===team) racer.goals=(racer.goals||0)+1;
 }
 match.teamScores[0]=state.scores[0];match.teamScores[1]=state.scores[1];
 match.emit('soccer-goal',{team,actorId:scorerId,scorerId});
 resetBall(match,state);
 state.lastTouch=null;
 state.serial++;
 if(state.scores[team]>=state.goalLimit){
  state.winnerTeam=team;state.phase='over';
  match.endMatch('score');
 }
}

export function stepSoccer(match,dt,inputs={}){
 const state=match.race;
 if(!state||match.over||!Number.isFinite(dt)||dt<=0) return;
 let remaining=dt;
 const given=inputs.inputs||{0:inputs};
 while(remaining>1e-9&&!match.over){
  match.teamScores[0]=state.scores[0];match.teamScores[1]=state.scores[1];
  let step=Math.min(remaining,SLICE);
  if(state.phase==='kickoff'){
   step=Math.min(step,state.countdown);
   state.countdown=Math.max(0,state.countdown-step);
   match.time+=step;remaining-=step;
   if(state.countdown<1e-9){state.countdown=0;state.phase='playing';}
   continue;
  }
  if(state.phase!=='playing') break;
  step=Math.min(step,Math.max(0,state.timeLimit-state.elapsed));
  state.elapsed+=step;match.time+=step;remaining-=step;
  const ballPrev={x:state.ball.x,z:state.ball.z};
  const chaser={0:null,1:null},closest={0:Infinity,1:Infinity};
  for(const racer of state.racers){
   const vehicle=match.vehicleById(racer.vehicleId);
   if(!vehicle) continue;
   const distance=Math.hypot(state.ball.x-vehicle.position.x,state.ball.z-vehicle.position.z);
   if(distance<closest[racer.team]){closest[racer.team]=distance;chaser[racer.team]=racer.actorId;}
  }
  state.chaser=chaser;
  for(const racer of state.racers){
   const actor=match.actors.find(a=>a.id===racer.actorId);
   const vehicle=match.vehicleById(racer.vehicleId);
   if(!actor||!vehicle) continue;
   const external=given[actor.id];
   const automatic=Boolean(actor.bot)&&!external;
   const controls=external||(actor.bot?soccerBotControls(match,racer):{});
   if(Number.isFinite(controls.yaw)) actor.yaw=controls.yaw;
   const throttle=automatic?clamp(controls.throttle??0,-1,1):clamp(-(controls.x||0)*Math.sin(actor.yaw)-(controls.z||0)*Math.cos(actor.yaw),-1,1);
   const steer=automatic?clamp(controls.steer??0,-1,1):clamp(-(controls.x||0)*Math.cos(actor.yaw)+(controls.z||0)*Math.sin(actor.yaw),-1,1);
   stepVehicle(vehicle,{throttle,steer,
    brake:controls.jump===true||controls.crouch===true,
    boost:controls.sprint===true||controls.power===true,
    speedScale:1,boostScale:1,fire:false},step,
    next=>match.vehicleCollision(next,vehicle),
    (x,z)=>groundY(match,x,z));
   if(automatic) actor.yaw=vehicle.heading-Math.PI;
   match.syncVehicleActor(actor,vehicle);
  }
  state.contacts+=resolveCarCollisions(match,state,2);
  state.contacts+=resolveBallCars(match,state);
  stepBall(match,state,step);
  const goal=crossSoccerGoals(state,ballPrev,{x:state.ball.x,z:state.ball.z});
  if(goal) scoreGoal(match,state,goal);
  if(state.phase!=='over'&&state.elapsed>=state.timeLimit-1e-9){
   state.elapsed=state.timeLimit;
   state.winnerTeam=state.scores[0]===state.scores[1]?null:(state.scores[0]>state.scores[1]?0:1);
   state.phase='over';
   match.endMatch('time');
  }
 }
}
