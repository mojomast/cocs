// Trusted, opt-in map data; no protocol command can invoke stage transitions.
// Gates are additional solid blocks. Every transaction creates a fresh arena
// identity so core's broadphase/floor caches cannot retain a prior gate mask.
import {floorAt, obstructed} from './core.mjs';

const fail=label=>{throw Error(`Invalid Horde stage plan: ${label}`);};
const keys=(o,names)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!names.includes(k)))fail('keys');};
const id=s=>typeof s==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(s);
const finite=n=>Number.isFinite(n)&&Math.abs(n)<=10000;
export function validateHordeStagePlan(plan,arena){
 keys(plan,['version','initialStage','stages','gates','transitions']);
 if(plan.version!==1||!Array.isArray(plan.stages)||plan.stages.length<2||plan.stages.length>8||!Array.isArray(plan.gates)||plan.gates.length!==2||!Array.isArray(plan.transitions)||plan.transitions.length>29)fail('envelope');
 const stages=new Set(),gates=new Set();
 for(const s of plan.stages){
  keys(s,['id','arrival','humanSpawns','enemySpawns']);
  if(!id(s.id)||stages.has(s.id))fail('stage id');stages.add(s.id);
  const r=s.arrival;keys(r,['minX','maxX','minZ','maxZ']);
  if(!Object.values(r).every(finite)||!(r.minX<r.maxX&&r.minZ<r.maxZ))fail('arrival');
  for(const [pool,min,max] of [[s.humanSpawns,2,4],[s.enemySpawns,4,32]]){
   if(!Array.isArray(pool)||pool.length<min||pool.length>max)fail('spawn pool');
   for(const p of pool){if(!Array.isArray(p)||p.length!==2||!p.every(finite))fail('spawn point');const y=floorAt(...p,arena);if(y===null||obstructed(p[0],y,p[1],1.2,arena))fail('spawn support');}
  }
  for(const [x,z] of [[r.minX,r.minZ],[r.maxX,r.maxZ],[(r.minX+r.maxX)/2,(r.minZ+r.maxZ)/2]])if(floorAt(x,z,arena)===null)fail('arrival support');
 }
 if(!stages.has(plan.initialStage))fail('initial stage');
 for(const g of plan.gates){
  keys(g,['id','x','z','w','d','h','baseY','material']);
  if(!id(g.id)||gates.has(g.id)||arena.blocks.some(b=>b.id===g.id))fail('gate id');gates.add(g.id);
  if(![g.x,g.z,g.w,g.d,g.h,g.baseY].every(finite)||g.w<=0||g.d<=0||g.h<=g.baseY||g.material!=='accent')fail('gate block');
 }
 let previous=0,from=plan.initialStage;
 for(const t of plan.transitions){
  keys(t,['afterWave','from','to','open','close']);
  if(!Number.isInteger(t.afterWave)||t.afterWave<=previous||t.afterWave>29||t.from!==from||!stages.has(t.to)||t.to===from)fail('transition');
  for(const list of [t.open,t.close])if(!Array.isArray(list)||list.length>2||new Set(list).size!==list.length||list.some(g=>!gates.has(g)))fail('gate reference');
  if(!t.open.length||t.close.some(g=>t.open.includes(g)))fail('gate targets');
  previous=t.afterWave;from=t.to;
 }
 return plan;
}

export function prepareHordeArena(arena,config){
 if(config.mode!=='horde'||config.endless||config.fragLimit>30)fail('bounded Horde only');
 // The immutable recipe never receives simulation writes, including at restart.
 const base=structuredClone(arena);
 validateHordeStagePlan(base.hordeStagePlan,base);
 const initial=base.hordeStagePlan.stages.find(s=>s.id===base.hordeStagePlan.initialStage);
 return {...base,blocks:[...base.blocks,...base.hordeStagePlan.gates],teamSpawns:{0:initial.humanSpawns,1:initial.enemySpawns}};
}

export function initializeHordeStages(match,state){
 const plan=match.arena.hordeStagePlan;if(!plan)return;
 state.stage={stageId:plan.initialStage,geometryRevision:0,gateMask:0,tick:0,serial:0,transit:null,closure:null};
}
function emit(match,type,data={}){match.emit(type,{stageTick:match.modeState.stage.tick,...data});}
function maskFor(plan,ids){return ids.reduce((mask,id)=>mask|(1<<plan.gates.findIndex(g=>g.id===id)),0);}
function gates(match,mask,type,data){
 const s=match.modeState.stage;if(s.gateMask===mask)return;
 match.applyHordeGateMask(mask);s.gateMask=mask;s.geometryRevision++;
 emit(match,type,{gateMask:mask,geometryRevision:s.geometryRevision,...data});
}
export function beginHordeTransit(match,state,causeEventId){
 const s=state.stage;if(!s)return;
 const t=match.arena.hordeStagePlan.transitions.find(t=>t.afterWave===state.wave);if(!t)return;
 s.closure=null;
 s.transit={id:++s.serial,from:t.from,to:t.to,causeEventId,begunTick:s.tick,phase:'warning',arrivalTicks:0,fallback:false};
 emit(match,'horde-transit-begin',{...s.transit});
}
// Conservatively expanded safety volume, including objects above the threshold.
function occupied(match,g){
 const inside=(p,r=1.45,h=3)=>p&&Math.abs(p.x-g.x)<=g.w/2+r&&Math.abs(p.z-g.z)<=g.d/2+r&&(p.y??0)<=g.h+.25&&(p.y??0)+h>=g.baseY-.25;
 return match.actors.some(a=>a.health>0&&inside(a,Math.max(1.45,(a.radius||0)+.25),Math.max(3,a.height||0)))||match.rockets.some(r=>inside(r.pos,Math.max(1.45,r.radius||0)))||match.deployables.some(d=>d.health>0&&d.life>0&&inside(d.pos||d));
}
export function stepHordeStages(match,state,dt){
 const s=state.stage;if(!s)return false;
 s.tick+=dt*60;
 const plan=match.arena.hordeStagePlan,c=s.closure;
 if(c){
  const age=s.tick-c.enteredTick;
  if(age>=600-1e-7){emit(match,'horde-gate-held-open',{transitId:c.id,gateMask:s.gateMask});s.closure=null;}
  else if(age>=180-1e-7&&!plan.gates.some(g=>c.gates.includes(g.id)&&occupied(match,g))){gates(match,s.gateMask&~maskFor(plan,c.gates),'horde-gate-closed',{transitId:c.id});s.closure=null;}
 }
 const t=s.transit;if(!t)return false;
 const schedule=plan.transitions.find(row=>row.afterWave===state.wave),age=s.tick-t.begunTick;
 if(age>=180-1e-7&&t.phase==='warning'){gates(match,s.gateMask|maskFor(plan,schedule.open),'horde-gate-open',{transitId:t.id});t.phase='travel';}
 if(age>=1200-1e-7&&!t.reminded){t.reminded=true;emit(match,'horde-transit-reminder',{transitId:t.id,to:t.to});}
 if(age>=2400-1e-7&&!t.fallback){t.fallback=true;s.closure=null;gates(match,3,'horde-gate-open',{transitId:t.id});emit(match,'horde-transit-fallback',{transitId:t.id,to:t.to});}
 const destination=plan.stages.find(row=>row.id===t.to),r=destination.arrival,p=match.actors.find(a=>a.id===0),y=p&&floorAt(p.x,p.z,match.arena);
 const arrived=p&&p.health>0&&p.grounded&&y!==null&&Math.abs(p.y-y)<.15&&p.x>=r.minX&&p.x<=r.maxX&&p.z>=r.minZ&&p.z<=r.maxZ&&!obstructed(p.x,p.y,p.z,p.radius,match.arena);
 t.arrivalTicks=arrived?t.arrivalTicks+dt*60:0;
 if(age>=240-1e-7&&t.phase==='travel'&&t.arrivalTicks>=30-1e-7&&state.timer<=0&&match.hordeStageReachable(destination)){
  s.stageId=t.to;match.teamSpawns={0:destination.humanSpawns,1:destination.enemySpawns};
  emit(match,'horde-stage-entered',{transitId:t.id,causeEventId:t.causeEventId,stageId:t.to,arrivalTicks:t.arrivalTicks});
  if(schedule.close.length&&!t.fallback){s.closure={id:t.id,gates:schedule.close,enteredTick:s.tick};emit(match,'horde-gate-closing',{transitId:t.id,gates:[...schedule.close]});}
  s.transit=null;
 }
 // Even committing holds this tick; next wave starts on the following step.
 return true;
}
