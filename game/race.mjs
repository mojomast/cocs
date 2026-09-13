import {createVehicle, PUMA, respawnVehicle, takeVehicleSeat, stepVehicle} from './vehicles.mjs';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angle = n => Math.atan2(Math.sin(n), Math.cos(n));
const ITEMS = ['turbo', 'shield', 'oil', 'pulse'];

export function initializeRace(match) {
  const track = match.arena.race;
  if (!track?.gates?.length || track.grid.length < match.actors.length) throw new Error('Race requires a circuit and enough grid slots');
  match.pickups = [];
  match.rockets = [];
  match.race = {
    phase: 'countdown', countdown: 3, laps: match.config.fragLimit, elapsed: 0,
    winnerId: null, gates: track.gates.map(g => ({...g})), centerline: track.centerline,
    boxes: track.itemBoxes.map(b => ({...b, wait: 0})), hazards: [], serial: 0, racers: []
  };
  // Each racer owns a chassis; cars deliberately ghost through one another.
  match.vehicles = Array.from({length: 8}, (_,id) => {
    const vehicle = createVehicle(PUMA), grid = track.grid[id];
    vehicle.id = id; vehicle.kind = 'puma';
    vehicle.spawn = {x: grid.x, y: 0, z: grid.z};
    respawnVehicle(vehicle, vehicle.spawn, grid.heading);
    return vehicle;
  });
  match.actors.forEach((actor, index) => {
    const vehicle = match.vehicles[index], grid = track.grid[index];
    takeVehicleSeat(vehicle, actor.id, 'driver');
    actor.yaw = grid.heading - Math.PI;
    actor.active = actor.cooldown = actor.temporaryShield = actor.armor = 0;
    actor.powerups = {}; actor.ammo = actor.ammo.map(() => 0);
    actor.harnessSpeedMultiplier = actor.harnessDamageMultiplier = actor.speedMultiplier = 1;
    actor.harnessResistance = 0;
    match.syncVehicleActor(actor, vehicle);
    match.race.racers.push({actorId: actor.id, vehicleId: vehicle.id, lap: 1, completedLaps: 0,
      nextGate: 0, passed: 0, started: false, progress: -1, finishTime: null, item: null,
      effects: {turbo: 0, shield: 0, slow: 0}, resetWait: 0, stuck: 0, checkpointAge: 0,
      anchor: {...grid}, useHeld: false, resetHeld: false});
  });
  return match.race;
}

export function raceStandings(state) {
  if (!state) return [];
  return [...state.racers].sort((a,b) => {
    if (a.finishTime !== null || b.finishTime !== null) return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || a.actorId - b.actorId;
    return b.progress - a.progress || a.actorId - b.actorId;
  }).map((r,index) => ({actorId: r.actorId, vehicleId: r.vehicleId, position: index + 1,
    lap: r.lap, completedLaps: r.completedLaps, nextGate: r.nextGate, progress: r.progress,
    finishTime: r.finishTime, item: r.item, effects: {...r.effects}}));
}

export function raceSnapshot(state) {
  if (!state) return null;
  return {phase: state.phase, countdown: state.countdown, laps: state.laps, elapsed: state.elapsed,
    winnerId: state.winnerId, standings: raceStandings(state),
    boxes: state.boxes.map(({id,x,z,wait}) => ({id,x,z,ready: wait <= 0})),
    hazards: state.hazards.map(({id,x,z,ttl}) => ({id,x,z,ttl})), gates: state.gates.map(g => ({...g}))};
}

// Only the expected gate can advance progress. Intersections use the swept center,
// the forward normal, and the finite ground-level opening, never proximity.
export function crossRaceGates(state, racer, from, to, startTime, dt) {
  let lastT = -1;
  for (let count = 0; count < state.gates.length; count++) {
    const gate = state.gates[racer.nextGate];
    const before = (from.x-gate.x)*gate.nx + (from.z-gate.z)*gate.nz;
    const after = (to.x-gate.x)*gate.nx + (to.z-gate.z)*gate.nz;
    if (before > 0 || after <= 0 || after <= before) break;
    const t = -before/(after-before);
    const x = from.x+(to.x-from.x)*t-gate.x, z = from.z+(to.z-from.z)*t-gate.z;
    const y = from.y+(to.y-from.y)*t;
    if (t <= lastT || !Number.isFinite(y) || y < -.25 || y > 3 || Math.abs(x*gate.nz-z*gate.nx) > gate.halfWidth) break;
    lastT = t;
    if (racer.nextGate === 0) {
      if (racer.started) racer.completedLaps++;
      racer.started = true;
      racer.lap = Math.min(state.laps, racer.completedLaps+1);
    }
    racer.passed++;
    racer.anchor = {x: gate.x+gate.nx*.5, z: gate.z+gate.nz*.5, heading: Math.atan2(gate.nx,gate.nz)};
    racer.nextGate = (racer.nextGate+1)%state.gates.length;
    racer.checkpointAge = 0;
    if (racer.completedLaps >= state.laps) {
      racer.finishTime = startTime+t*dt;
      break;
    }
  }
  const prev = state.gates[(racer.nextGate+state.gates.length-1)%state.gates.length], next = state.gates[racer.nextGate];
  const dx = next.x-prev.x, dz = next.z-prev.z;
  const fraction = clamp(((to.x-prev.x)*dx+(to.z-prev.z)*dz)/(dx*dx+dz*dz),0,.999999);
  racer.progress = racer.started ? racer.passed-1+fraction : -distance(to,state.gates[0])/1000;
}

export function resetRaceRacer(match, racer) {
  const vehicle = match.vehicleById(racer.vehicleId), a = racer.anchor;
  respawnVehicle(vehicle, {x:a.x,y:0,z:a.z}, a.heading);
  takeVehicleSeat(vehicle,racer.actorId,'driver');
  racer.resetWait = 2; racer.stuck = 0; racer.checkpointAge = 0;
  racer.effects.turbo = 0;
  const actor = match.actors.find(a => a.id === racer.actorId);
  actor.yaw = a.heading-Math.PI;
  match.syncVehicleActor(actor,vehicle);
  // Teleports are not swept, and cannot grant a gate or undo banked checkpoints.
  crossRaceGates(match.race,racer,vehicle.position,vehicle.position,match.race.elapsed,0);
}

function botControls(state, racer, vehicle) {
  const points = state.centerline, n = points.length;
  const next = racer.nextGate, prev = (next+n-1)%n;
  const a = points[prev], b = points[next], dx = b.x-a.x, dz = b.z-a.z, length = Math.hypot(dx,dz);
  let along = clamp(((vehicle.position.x-a.x)*dx+(vehicle.position.z-a.z)*dz)/length,0,length);
  let look = Math.max(5,Math.abs(vehicle.speed)*.65), index = prev, target;
  for (let i=0;i<n;i++) {
    const p = points[index], q = points[(index+1)%n], len = distance(p,q);
    if (along+look <= len) { const t=(along+look)/len; target={x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t}; break; }
    look -= len-along; along=0; index=(index+1)%n;
  }
  target ||= b;
  const error = angle(Math.atan2(target.x-vehicle.position.x,target.z-vehicle.position.z)-vehicle.heading);
  return {throttle: Math.abs(error)>1 ? .35 : .85, steer: clamp(error*1.8,-1,1),
    sprint: Math.abs(error)<.08&&distance(vehicle.position,b)>18, fire: Boolean(racer.item)&&!racer.useHeld};
}

function useItem(match, racer) {
  const state=match.race, vehicle=match.vehicleById(racer.vehicleId), item=racer.item;
  if (!item) return;
  racer.item=null;
  if (item==='turbo') racer.effects.turbo=2;
  if (item==='shield') {racer.effects.shield=5; racer.effects.slow=0;}
  if (item==='oil') state.hazards.push({id:++state.serial,owner:racer.actorId,
    x:vehicle.position.x-Math.sin(vehicle.heading)*4,z:vehicle.position.z-Math.cos(vehicle.heading)*4,ttl:8});
  if (item==='pulse') {
    const target=state.racers.filter(r=>r.actorId!==racer.actorId&&r.progress>racer.progress&&r.finishTime===null)
      .sort((a,b)=>a.progress-b.progress||a.actorId-b.actorId)[0];
    if (target && target.effects.shield<=0) target.effects.slow=2;
  }
}

export function stepRace(match, dt, inputs={}) {
  const state=match.race;
  if (!state || match.over || !Number.isFinite(dt) || dt<=0) return;
  // Fixed-size physics slices also make large host ticks safe for vehicle physics.
  let remaining=dt;
  const given=inputs.inputs||{0:inputs};
  while (remaining>1e-9 && !match.over) {
    let step=Math.min(remaining,1/60);
    if (state.phase==='countdown') {
      step=Math.min(step,state.countdown);
      state.countdown=Math.max(0,state.countdown-step); match.time+=step; remaining-=step;
      for (const r of state.racers) {r.useHeld=Boolean(given[r.actorId]?.fire||given[r.actorId]?.power); r.resetHeld=Boolean(given[r.actorId]?.interact);}
      if (state.countdown<1e-9) {state.countdown=0;state.phase='racing';}
      continue;
    }
    step=Math.min(step,Math.max(0,match.config.timeLimit-state.elapsed));
    const start=state.elapsed;
    state.elapsed+=step; match.time+=step; remaining-=step;
    for (const box of state.boxes) box.wait=Math.max(0,box.wait-step);
    for (const hazard of state.hazards) hazard.ttl-=step;
    state.hazards=state.hazards.filter(h=>h.ttl>0);
    for (const r of state.racers) for (const effect of Object.keys(r.effects)) r.effects[effect]=Math.max(0,r.effects[effect]-step);
    for (const r of state.racers) {
      const actor=match.actors.find(a=>a.id===r.actorId), vehicle=match.vehicleById(r.vehicleId);
      const external=given[actor.id], controls=external||(actor.bot?botControls(state,r,vehicle):{});
      if (Number.isFinite(controls.yaw)) actor.yaw=controls.yaw;
      const use=Boolean(controls.fire||controls.power), reset=Boolean(controls.interact);
      if (reset&&!r.resetHeld) resetRaceRacer(match,r);
      if (use&&!r.useHeld&&r.resetWait<=0) useItem(match,r);
      r.useHeld=use; r.resetHeld=reset;
      if (r.resetWait>0) {r.resetWait=Math.max(0,r.resetWait-step); continue;}
      const from={...vehicle.position};
      const automatic=actor.bot&&!external;
      const throttle=automatic?controls.throttle:clamp(-(controls.x||0)*Math.sin(actor.yaw)-(controls.z||0)*Math.cos(actor.yaw),-1,1);
      const steer=automatic?controls.steer:clamp(-(controls.x||0)*Math.cos(actor.yaw)+(controls.z||0)*Math.sin(actor.yaw),-1,1);
      const speedScale=r.effects.slow>0?.5:r.effects.turbo>0?1.6:1;
      stepVehicle(vehicle,{throttle,steer,brake:controls.jump===true||controls.crouch===true,
        boost:controls.sprint===true,speedScale,boostScale:speedScale,fire:false},step,
        next=>match.vehicleCollision(next,vehicle),()=>0);
      if (automatic) actor.yaw=vehicle.heading-Math.PI;
      match.syncVehicleActor(actor,vehicle);
      crossRaceGates(state,r,from,vehicle.position,start,step);
      for (const box of state.boxes) if (!r.item&&box.wait<=0&&distance(vehicle.position,box)<3) {
        r.item=ITEMS[Math.min(3,Math.floor(match.random()*4))]; box.wait=8;
      }
      for (const h of state.hazards) if (h.owner!==r.actorId&&r.effects.shield<=0&&distance(vehicle.position,h)<3) r.effects.slow=2;
      r.stuck=Math.abs(throttle)>.1&&distance(from,vehicle.position)<.015?r.stuck+step:0;
      r.checkpointAge+=step;
      if (r.finishTime===null&&(r.stuck>3||r.checkpointAge>20||!Number.isFinite(vehicle.position.x)||!Number.isFinite(vehicle.position.z))) resetRaceRacer(match,r);
    }
    // Resolve after every racer moved, using sub-tick crossing times, not actor order.
    const order=raceStandings(state);
    if (order[0]?.finishTime!==null || state.elapsed>=match.config.timeLimit) {
      state.phase='finished'; state.winnerId=order[0]?.actorId??null;
      match.endMatch(order[0]?.finishTime!==null?'race-finish':'time');
    }
  }
}
